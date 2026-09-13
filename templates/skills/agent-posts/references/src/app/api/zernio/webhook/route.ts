import { NextResponse } from "next/server";
import crypto from "crypto";
import { query } from "@/lib/insforge/db";
import {
  failPendingCommentDmSetups,
  flushPendingCommentDmSetups,
} from "@/lib/comments/automations";
import {
  ctaInstagramAccountIds,
  matchesKeyword,
  postCommentReply,
} from "@/lib/comments/cta";
import {
  findAgentFunnelByZernioPost,
  replyToYoutubeKeywordComment,
} from "@/lib/agent-posts/youtube";

export const dynamic = "force-dynamic";

// Zernio webhook receiver. Authenticated by HMAC-SHA256 (X-Zernio-Signature),
// NOT the dashboard session — the path is exempted in src/proxy.ts.
//
// comment.received → log to `comment_events`, then reply inline when the
// comment is the CTA keyword on a persona's Instagram. If the reply can't be
// sent yet (Inbox addon off / transient error) the row stays `pending` so the
// instagram-comment-cta skill can retry it.
//
// post.published / post.partial / post.platform.published → attach any queued
// comments-to-DM funnel now that a platformPostId should exist.
// post.failed / post.cancelled → mark that funnel failed so we don't poll forever.

type CommentEvent = {
  id: string;
  event: string;
  comment?: {
    id: string;
    postId: string | null;
    platformPostId: string;
    platform: string;
    text: string;
    author?: { id?: string; username?: string; name?: string };
    createdAt?: string;
    isReply?: boolean;
    parentCommentId?: string | null;
  };
  post?: {
    id?: string | null;
    _id?: string;
    platformPostId?: string;
  };
  postId?: string;
  data?: { post?: { id?: string; _id?: string }; postId?: string };
  account?: { id: string; platform: string; username?: string };
  timestamp?: string;
};

const POST_FLUSH_EVENTS = new Set([
  "post.published",
  "post.partial",
  "post.platform.published",
  "post.platform.failed",
]);
const POST_FAIL_EVENTS = new Set(["post.failed", "post.cancelled"]);

function zernioPostId(evt: CommentEvent): string | null {
  const candidates = [
    evt.post?._id,
    evt.post?.id,
    evt.postId,
    evt.comment?.postId,
    evt.data?.post?._id,
    evt.data?.post?.id,
    evt.data?.postId,
  ];
  for (const id of candidates) {
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

function validSignature(raw: string, header: string | null): boolean {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!secret) return false; // never accept unsigned traffic without a secret
  if (!header) return false;
  const given = header.replace(/^sha256=/, "").trim();
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(given, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// The Zernio webhook subscribed to comment.received predates the Inbox-addon
// gate and points here; the CREATOROS app consumed it before. Relay every
// event onward (raw body + original signature) so that app keeps working.
// Fire-and-forget: a dead forward target must never break our own handling.
function forwardEvent(raw: string, signature: string | null): void {
  const target = process.env.ZERNIO_FORWARD_URL;
  if (!target) return;
  fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signature ? { "X-Zernio-Signature": signature } : {}),
    },
    body: raw,
  }).catch((e) => console.error("[zernio-webhook] forward failed:", e?.message));
}

export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-zernio-signature");
  if (!validSignature(raw, signature)) {
    return new NextResponse("Bad signature", { status: 401 });
  }

  forwardEvent(raw, signature);

  let evt: CommentEvent;
  try {
    evt = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  // Comments-to-DM on scheduled posts: attach as soon as Zernio publishes.
  // Ack immediately — Zernio wants 2xx within 5s; flush can take longer.
  if (POST_FLUSH_EVENTS.has(evt.event)) {
    const postId = zernioPostId(evt);
    if (postId) {
      void flushPendingCommentDmSetups({ postId }).catch((e) =>
        console.error(
          "[zernio-webhook] comment-dm flush:",
          e instanceof Error ? e.message : e,
        ),
      );
      if (evt.event === "post.published" || evt.event === "post.partial") {
        void import("@/lib/agent-posts/store")
          .then(({ markAgentPostsPublished }) => markAgentPostsPublished([postId]))
          .catch((e) =>
            console.error(
              "[zernio-webhook] agent-post published:",
              e instanceof Error ? e.message : e,
            ),
          );
      }
    }
    return NextResponse.json({ ok: true, queued: Boolean(postId) });
  }
  if (POST_FAIL_EVENTS.has(evt.event)) {
    const postId = zernioPostId(evt);
    if (postId) {
      void failPendingCommentDmSetups(postId, evt.event).catch((e) =>
        console.error(
          "[zernio-webhook] comment-dm fail:",
          e instanceof Error ? e.message : e,
        ),
      );
    }
    return NextResponse.json({ ok: true, failed: Boolean(postId) });
  }

  // Only comment events are handled further; ack everything else so Zernio is happy.
  if (evt.event !== "comment.received" || !evt.comment || !evt.account) {
    return NextResponse.json({ ok: true, ignored: evt.event });
  }

  const c = evt.comment;
  const acct = evt.account;

  // YouTube leg of an Agent Post funnel: "comment KEYWORD" -> public reply
  // pointing at the description (the link lives there). Own-comment and
  // duplicate handling happen inside.
  if (acct.platform === "youtube") {
    const zpid = zernioPostId(evt);
    const funnel = zpid ? await findAgentFunnelByZernioPost(zpid) : null;
    if (!funnel) return NextResponse.json({ ok: true, status: "skipped", reason: "not_agent_post" });
    const out = await replyToYoutubeKeywordComment({
      eventId: evt.id,
      accountId: acct.id,
      accountUsername: acct.username ?? null,
      platformPostId: c.platformPostId,
      zernioPostId: zpid,
      commentId: c.id,
      text: c.text ?? "",
      authorId: c.author?.id ?? null,
      authorName: c.author?.name ?? c.author?.username ?? null,
      createdAt: c.createdAt ?? null,
      funnel,
      raw: evt,
    });
    return NextResponse.json({ ok: true, ...out });
  }

  // Classify before insert so the row lands with its final status when no
  // reply is needed. Own-account comments are skipped to avoid reply loops.
  let status = "skipped";
  let reason: string | null = null;

  const ownComment =
    (c.author?.id && c.author.id === acct.id) ||
    (c.author?.username && acct.username && c.author.username === acct.username);

  if (ownComment) {
    reason = "own_comment";
  } else if (acct.platform !== "instagram") {
    reason = "not_instagram";
  } else if (!matchesKeyword(c.text)) {
    reason = "no_keyword";
  } else {
    const ctaAccounts = await ctaInstagramAccountIds();
    if (!ctaAccounts.has(acct.id)) {
      reason = "not_cta_account";
    } else {
      status = "pending"; // keyword hit on a persona account → reply below
    }
  }

  const inserted = await query<{ event_id: string }>(
    `insert into comment_events (
       event_id, platform, account_id, account_username, post_id,
       platform_post_id, comment_id, comment_text, author_id, author_username,
       author_name, is_reply, parent_comment_id, comment_created_at,
       status, status_reason, raw
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     on conflict do nothing
     returning event_id`,
    [
      evt.id,
      c.platform,
      acct.id,
      acct.username ?? null,
      c.postId ?? evt.post?.id ?? null,
      c.platformPostId,
      c.id,
      c.text ?? null,
      c.author?.id ?? null,
      c.author?.username ?? null,
      c.author?.name ?? null,
      Boolean(c.isReply),
      c.parentCommentId ?? null,
      c.createdAt ?? null,
      status,
      reason,
      raw,
    ],
  );

  // Duplicate delivery — already handled, don't reply twice.
  if (inserted.length === 0) {
    return NextResponse.json({ ok: true, dedup: true });
  }

  if (status !== "pending") {
    return NextResponse.json({ ok: true, status, reason });
  }

  // Reply inline — this is what makes the CTA feel instant.
  const outcome = await postCommentReply({
    postId: c.postId ?? c.platformPostId,
    accountId: acct.id,
    commentId: c.id,
  });

  if (outcome.ok) {
    await query(
      `update comment_events
          set status = 'replied', replied_at = now(), reply_comment_id = $2, status_reason = null
        where event_id = $1`,
      [evt.id, outcome.replyCommentId],
    );
    return NextResponse.json({ ok: true, status: "replied" });
  }

  await query(
    `update comment_events
        set status = $2, status_reason = $3
      where event_id = $1`,
    [evt.id, outcome.retryable ? "pending" : "failed", outcome.error],
  );
  return NextResponse.json({
    ok: true,
    status: outcome.retryable ? "pending" : "failed",
    error: outcome.error,
  });
}
