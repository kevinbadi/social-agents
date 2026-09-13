import "server-only";
import { query } from "@/lib/insforge/db";
import { resolveResourceUrls } from "@/lib/comments/dm-copy";
import { getPost } from "@/lib/zernio/client";
import type { ZernioPost, ZernioPostPlatform } from "@/lib/zernio/types";

// YouTube leg of the Agent Posts funnel (Kevin 2026-09-13).
//
// Instagram/Facebook get a real comment-to-DM automation. YouTube has no DM
// channel, but descriptions can carry links, so:
//   1. the resource link(s) are embedded in the video description at schedule
//      time (`withResourceLinks`), and
//   2. anyone who comments the keyword gets a public reply pointing them at the
//      description (`replyToYoutubeKeywordComment`), fed by the Zernio
//      comment.received webhook AND a 5-minute poll of Zernio's inbox for the
//      YouTube legs of recent agent posts (the webhook is not guaranteed to
//      carry YouTube comments).

const ZERNIO_BASE = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1";
const YT_DESCRIPTION_MAX = 4900;
const POLL_EVERY_MS = 5 * 60_000;
const POLL_WINDOW_DAYS = 14;
const MAX_REPLIES_PER_POLL = 20;

function zernioKey(): string | null {
  return process.env.CREATOR_OS_API_KEY || process.env.ZERNIO_API_KEY || null;
}

/** Append the funnel resource link(s) to a YouTube description (idempotent). */
export function withResourceLinks(
  description: string,
  resourceUrl: string | null | undefined,
  keyword: string | null | undefined,
): string {
  const base = (description ?? "").trim().replace(/[–—]/g, "-");
  const urls = resolveResourceUrls(resourceUrl ?? "").filter((u) => !base.includes(u));
  if (!urls.length) return base.slice(0, YT_DESCRIPTION_MAX);
  const kw = (keyword ?? "").trim().toUpperCase();
  const head = kw ? `🔗 You commented "${kw}"? Here is the link:` : "🔗 Link from the video:";
  const block = `${head}\n${urls.join("\n")}`;
  const room = YT_DESCRIPTION_MAX - block.length - 2;
  const body = base.length > room ? `${base.slice(0, Math.max(0, room - 1)).trimEnd()}…` : base;
  return `${body}\n\n${block}`.trim();
}

/** Public reply under a keyword comment on YouTube. */
export function youtubeKeywordReply(keyword: string): string {
  const kw = keyword.trim().toUpperCase();
  return `you commented ${kw} so here you go: the link is in this video's description, tap the title to expand it 🔗`;
}

/**
 * Keyword match for YouTube comments. Exact match after trimming punctuation
 * and emoji ("iOS 😮"), or the keyword as a whole word inside a short comment
 * ("ios please"). Long comments that merely mention the word are ignored.
 */
export function matchesYoutubeKeyword(text: string | null | undefined, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!text || !kw) return false;
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/[\s!.…,"'🤍❤️🔥🙌👀✨😮🙏💯👍]+$/gu, "")
    .replace(/^[\s!.…,"']+/u, "");
  if (cleaned === kw) return true;
  if (cleaned.length > 40) return false;
  const words = cleaned.split(/[^a-z0-9]+/u).filter(Boolean);
  return words.includes(kw);
}

type YoutubeLeg = { accountId: string; platformPostId: string };

function accountIdOf(pl: ZernioPostPlatform): string | null {
  const raw = (pl as { accountId?: unknown }).accountId;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof (raw as { _id?: unknown })._id === "string") {
    return (raw as { _id: string })._id;
  }
  return null;
}

export function youtubeLegOf(post: ZernioPost | null | undefined): YoutubeLeg | null {
  for (const pl of post?.platforms ?? []) {
    if ((pl.platform ?? "").toLowerCase() !== "youtube") continue;
    const accountId = accountIdOf(pl);
    const platformPostId = (pl as { platformPostId?: string }).platformPostId;
    if (accountId && platformPostId) return { accountId, platformPostId };
  }
  return null;
}

type AgentFunnelRow = { id: string; zernio_post_id: string; keyword: string | null; resource_url: string };

/** The agent post behind a Zernio post id, when it carries a keyword funnel. */
export async function findAgentFunnelByZernioPost(
  zernioPostId: string,
): Promise<{ id: string; keyword: string; resourceUrl: string } | null> {
  const rows = await query<AgentFunnelRow>(
    `select id, zernio_post_id, keyword, resource_url
       from agent_posts
      where zernio_post_id = $1 and coalesce(keyword, '') <> ''
      order by created_at desc limit 1`,
    [zernioPostId],
  );
  const r = rows[0];
  if (!r || !r.keyword) return null;
  return { id: r.id, keyword: r.keyword, resourceUrl: r.resource_url };
}

/**
 * A comment is handled once we replied (or a reply is pending/failed under this
 * funnel). The generic webhook logs every YouTube comment as
 * `skipped / not_instagram` first, so those rows must NOT count as handled;
 * they get upgraded in place below (comment_id is unique).
 */
async function alreadyHandled(commentId: string): Promise<boolean> {
  const rows = await query<{ n: string }>(
    `select count(*)::text as n from comment_events
      where comment_id = $1
        and (status = 'replied' or status_reason = 'agent_post_keyword')`,
    [commentId],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

export type YoutubeReplyOutcome =
  | { ok: true; replyCommentId: string | null }
  | { ok: false; retryable: boolean; error: string };

async function postYoutubeReply(args: {
  platformPostId: string;
  accountId: string;
  commentId: string;
  message: string;
}): Promise<YoutubeReplyOutcome> {
  const key = zernioKey();
  if (!key) return { ok: false, retryable: false, error: "no posting key" };
  const res = await fetch(
    `${ZERNIO_BASE}/inbox/comments/${encodeURIComponent(args.platformPostId)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: args.accountId,
        commentId: args.commentId,
        message: args.message,
      }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    status?: string;
    data?: { commentId?: string; id?: string };
    error?: string;
    code?: string;
  };
  if (res.ok && data.success !== false && data.status !== "error") {
    return { ok: true, replyCommentId: data.data?.commentId ?? data.data?.id ?? null };
  }
  const retryable = data.code === "INBOX_REQUIRED" || res.status === 403 || res.status >= 500;
  return {
    ok: false,
    retryable,
    error: `${res.status} ${data.code ?? ""} ${data.error ?? ""}`.trim().slice(0, 500),
  };
}

/**
 * Reply to one YouTube keyword comment and log it to comment_events. Returns
 * the classification so callers (webhook / poller) can report it. Never
 * replies twice to the same comment id.
 */
export async function replyToYoutubeKeywordComment(args: {
  eventId: string;
  accountId: string;
  accountUsername?: string | null;
  platformPostId: string;
  zernioPostId: string | null;
  commentId: string;
  text: string;
  authorId?: string | null;
  authorName?: string | null;
  isOwner?: boolean;
  createdAt?: string | null;
  funnel: { keyword: string };
  raw?: unknown;
}): Promise<{ status: "replied" | "pending" | "failed" | "skipped"; reason?: string }> {
  if (args.isOwner || (args.authorId && args.authorId === args.accountId)) {
    return { status: "skipped", reason: "own_comment" };
  }
  if (!matchesYoutubeKeyword(args.text, args.funnel.keyword)) {
    return { status: "skipped", reason: "no_keyword" };
  }
  if (await alreadyHandled(args.commentId)) {
    return { status: "skipped", reason: "dedup" };
  }

  const inserted = await query<{ event_id: string }>(
    `insert into comment_events (
       event_id, platform, account_id, account_username, post_id,
       platform_post_id, comment_id, comment_text, author_id, author_username,
       author_name, is_reply, parent_comment_id, comment_created_at,
       status, status_reason, raw
     ) values ($1,'youtube',$2,$3,$4,$5,$6,$7,$8,$9,$10,false,null,$11,'pending','agent_post_keyword',$12)
     on conflict (comment_id) do update
       set status = 'pending',
           status_reason = 'agent_post_keyword',
           post_id = coalesce(excluded.post_id, comment_events.post_id)
     where comment_events.status = 'skipped'
     returning event_id`,
    [
      args.eventId,
      args.accountId,
      args.accountUsername ?? null,
      args.zernioPostId,
      args.platformPostId,
      args.commentId,
      args.text,
      args.authorId ?? null,
      args.authorName ?? null,
      args.authorName ?? null,
      args.createdAt ?? null,
      JSON.stringify(args.raw ?? {}),
    ],
  );
  if (!inserted.length) return { status: "skipped", reason: "dedup" };

  const outcome = await postYoutubeReply({
    platformPostId: args.platformPostId,
    accountId: args.accountId,
    commentId: args.commentId,
    message: youtubeKeywordReply(args.funnel.keyword),
  });
  if (outcome.ok) {
    await query(
      `update comment_events
          set status = 'replied', replied_at = now(), reply_comment_id = $2, status_reason = 'agent_post_keyword'
        where comment_id = $1`,
      [args.commentId, outcome.replyCommentId],
    );
    return { status: "replied" };
  }
  await query(
    `update comment_events set status = $2, status_reason = 'agent_post_keyword', raw = raw::jsonb || $3::jsonb where comment_id = $1`,
    [args.commentId, outcome.retryable ? "pending" : "failed", JSON.stringify({ youtubeReplyError: outcome.error })],
  );
  return { status: outcome.retryable ? "pending" : "failed", reason: outcome.error };
}

// ─────────────────────────── inbox poller ───────────────────────────

type InboxComment = {
  id: string;
  message?: string;
  createdTime?: string;
  from?: { id?: string; name?: string; isOwner?: boolean };
  replies?: { from?: { id?: string; name?: string; isOwner?: boolean } }[];
  replyCount?: number;
};

/** True when the channel owner already answered this comment thread. */
function ownerAlreadyReplied(c: InboxComment, accountId: string): boolean {
  return (c.replies ?? []).some(
    (r) => Boolean(r?.from?.isOwner) || (r?.from?.id != null && r.from.id === accountId),
  );
}

async function listInboxComments(platformPostId: string, accountId: string): Promise<InboxComment[]> {
  const key = zernioKey();
  if (!key) return [];
  const res = await fetch(
    `${ZERNIO_BASE}/inbox/comments/${encodeURIComponent(platformPostId)}?accountId=${encodeURIComponent(accountId)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { comments?: InboxComment[] };
  return Array.isArray(data.comments) ? data.comments : [];
}

const legCache = new Map<string, YoutubeLeg | null>();
let lastPoll = 0;

/**
 * Poll the YouTube legs of recent agent posts for keyword comments and reply.
 * Throttled to once per 5 minutes; called from the agent-posts drain.
 */
export async function pollYoutubeKeywordComments(opts: { force?: boolean } = {}): Promise<{
  checked: number;
  replied: number;
}> {
  const now = Date.now();
  if (!opts.force && now - lastPoll < POLL_EVERY_MS) return { checked: 0, replied: 0 };
  lastPoll = now;

  const rows = await query<AgentFunnelRow>(
    `select distinct on (zernio_post_id) id, zernio_post_id, keyword, resource_url
       from agent_posts
      where zernio_post_id is not null
        and coalesce(keyword, '') <> ''
        and status in ('scheduled', 'published')
        and scheduled_for <= now()
        and scheduled_for >= now() - ($1 || ' days')::interval
      order by zernio_post_id, created_at desc`,
    [String(POLL_WINDOW_DAYS)],
  );

  let checked = 0;
  let replied = 0;
  for (const r of rows) {
    if (replied >= MAX_REPLIES_PER_POLL) break;
    let leg = legCache.get(r.zernio_post_id);
    if (leg === undefined) {
      const post = await getPost(r.zernio_post_id).catch(() => null);
      leg = youtubeLegOf(post);
      // Only cache resolved legs; an unpublished YouTube leg may resolve later.
      if (leg) legCache.set(r.zernio_post_id, leg);
    }
    if (!leg) continue;
    checked += 1;
    const comments = await listInboxComments(leg.platformPostId, leg.accountId).catch(() => []);
    for (const c of comments) {
      if (replied >= MAX_REPLIES_PER_POLL) break;
      if (!c?.id) continue;
      if (ownerAlreadyReplied(c, leg.accountId)) continue;
      const out = await replyToYoutubeKeywordComment({
        eventId: `yt:${c.id}`,
        accountId: leg.accountId,
        platformPostId: leg.platformPostId,
        zernioPostId: r.zernio_post_id,
        commentId: c.id,
        text: c.message ?? "",
        authorId: c.from?.id ?? null,
        authorName: c.from?.name ?? null,
        isOwner: Boolean(c.from?.isOwner),
        createdAt: c.createdTime ?? null,
        funnel: { keyword: r.keyword ?? "" },
        raw: c,
      }).catch((e) => {
        console.error("[agent-posts] youtube reply:", e instanceof Error ? e.message : e);
        return { status: "failed" as const };
      });
      if (out.status === "replied") {
        replied += 1;
        console.log(
          `[agent-posts] youtube keyword reply -> ${c.from?.name ?? c.from?.id ?? "?"} on ${leg.platformPostId}`,
        );
      }
    }
  }
  return { checked, replied };
}
