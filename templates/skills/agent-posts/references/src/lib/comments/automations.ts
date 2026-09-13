import "server-only";
import { dbConfigured, query } from "@/lib/insforge/db";
import {
  buildDmMessage,
  publicReply,
  resolveResourceUrls,
} from "@/lib/comments/dm-copy";
import {
  createCommentAutomation,
  getPost,
  listCommentAutomations,
  updateCommentAutomation,
} from "@/lib/zernio/client";
import type { ZernioPost, ZernioPostPlatform } from "@/lib/zernio/types";

export {
  DEFAULT_COMMENT_REPLY,
  resolveResourceUrl,
  resolveResourceUrls,
} from "@/lib/comments/dm-copy";

// Per-post comments-to-DM via Zernio's native /v1/comment-automations.
// Instagram + Facebook only. platformPostId isn't always on the create-post
// response (publish is async, scheduled posts don't have it yet), so we persist
// a pending row and flush once the platform id exists.

export const COMMENT_DM_PLATFORMS = new Set(["instagram", "facebook"]);

const TABLE = `create table if not exists comment_dm_setups (
  id bigserial primary key,
  zernio_post_id text not null,
  profile_id text not null,
  account_id text not null,
  platform text not null,
  platform_post_id text,
  keyword text not null,
  dm_message text not null default '',
  resource_url text not null,
  zernio_automation_id text,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  wired_at timestamptz
)`;

const ADD_DM_MESSAGE = `alter table comment_dm_setups
  add column if not exists dm_message text not null default ''`;

const ADD_COMMENT_REPLY = `alter table comment_dm_setups
  add column if not exists comment_reply text not null default 'Awesome, check DMs!'`;

const ADD_SCHEDULED_FOR = `alter table comment_dm_setups
  add column if not exists scheduled_for timestamptz`;

const UNIQUE_IDX = `create unique index if not exists comment_dm_setups_post_account
  on comment_dm_setups (zernio_post_id, account_id)`;

const PENDING_DUE_IDX = `create index if not exists comment_dm_setups_pending_due
  on comment_dm_setups (scheduled_for, created_at)
  where status = 'pending'`;

let schemaReady = false;

async function ensureSchema(): Promise<boolean> {
  if (!dbConfigured) return false;
  if (schemaReady) return true;
  await query(TABLE);
  await query(ADD_DM_MESSAGE);
  await query(ADD_COMMENT_REPLY);
  await query(ADD_SCHEDULED_FOR);
  await query(UNIQUE_IDX);
  await query(PENDING_DUE_IDX);
  schemaReady = true;
  return true;
}

export function isCommentDmPlatform(platform: string): boolean {
  return COMMENT_DM_PLATFORMS.has(platform.toLowerCase());
}

export type CommentDmOverlay = {
  zernioPostId: string;
  keyword: string;
  dmMessage: string;
  resourceUrl: string;
  commentReply: string;
  status: string;
};

/** Newest comment-to-DM setup per Zernio post (Instagram/Facebook funnel). */
export async function listCommentDmByPostIds(
  ids: string[],
): Promise<Map<string, CommentDmOverlay>> {
  const out = new Map<string, CommentDmOverlay>();
  if (!ids.length || !(await ensureSchema())) return out;
  const rows = await query<
    SetupRow & { created_at?: Date | string }
  >(
    `select zernio_post_id, keyword, dm_message, resource_url, comment_reply, status
       from comment_dm_setups
      where zernio_post_id = any($1::text[])
      order by created_at desc`,
    [ids],
  );
  for (const r of rows) {
    if (out.has(r.zernio_post_id)) continue;
    out.set(r.zernio_post_id, {
      zernioPostId: r.zernio_post_id,
      keyword: r.keyword,
      dmMessage: r.dm_message ?? "",
      resourceUrl: r.resource_url,
      commentReply: r.comment_reply ?? "",
      status: r.status,
    });
  }
  return out;
}

function platformAccountId(pl: ZernioPostPlatform): string | null {
  if (!pl.accountId) return null;
  if (typeof pl.accountId === "string") return pl.accountId;
  return pl.accountId._id ?? null;
}

function findPlatform(
  post: ZernioPost,
  platform: string,
  accountId: string,
): ZernioPostPlatform | undefined {
  const plats = post.platforms ?? [];
  const exact = plats.find(
    (pl) => pl.platform === platform && platformAccountId(pl) === accountId,
  );
  if (exact) return exact;
  const same = plats.filter((pl) => pl.platform === platform);
  return same.length === 1 ? same[0] : undefined;
}

function postScheduledFor(post: ZernioPost): string | null {
  return (
    post.scheduledFor ||
    post.platforms?.map((pl) => pl.scheduledFor).filter(Boolean).sort()[0] ||
    null
  );
}

function clickTag(keyword: string): string {
  const slug = keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
  return slug ? `comment-dm-${slug}` : "comment-dm";
}

/** Claude / claude / CLAUDE / Claude (title case). Deduped. */
function keywordVariants(raw: string): string[] {
  const k = raw.trim();
  if (!k) return [];
  const title = k.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
  return [...new Set([k, k.toLowerCase(), k.toUpperCase(), title])];
}

type SetupRow = {
  id: number;
  zernio_post_id: string;
  profile_id: string;
  account_id: string;
  platform: string;
  platform_post_id: string | null;
  keyword: string;
  dm_message: string | null;
  resource_url: string;
  comment_reply: string | null;
  zernio_automation_id: string | null;
  status: string;
  scheduled_for?: string | null;
};

let flushInFlight = false;

async function findExistingAutomationId(row: {
  profileId: string;
  accountId: string;
  zernioPostId: string;
  platformPostId: string;
}): Promise<string | null> {
  try {
    const list = await listCommentAutomations({
      profileId: row.profileId,
      accountId: row.accountId,
    });
    const match =
      list.find((a) => a.platformPostId && a.platformPostId === row.platformPostId) ??
      list.find((a) => a.postId && a.postId === row.zernioPostId);
    return match?.id ?? null;
  } catch (e) {
    console.error(
      "[comment-dm] list automations failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

async function createOnZernio(row: {
  profileId: string;
  accountId: string;
  zernioPostId: string;
  platformPostId: string;
  keyword: string;
  dmMessage: string;
  resourceUrl: string;
  commentReply?: string;
  existingAutomationId?: string | null;
}): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const urls = resolveResourceUrls(row.resourceUrl);
  const dmMessage = buildDmMessage(row.keyword, row.dmMessage, urls);
  const payload = {
    dmMessage,
    // Plain-text DM: Instagram often hides generic URL buttons, which is how
    // the first test went out with copy and no links. Links live in the body.
    buttons: [] as [],
    commentReply: publicReply(row.commentReply),
    linkTracking: false,
    clickTag: clickTag(row.keyword),
  };

  if (row.existingAutomationId) {
    const updated = await updateCommentAutomation(row.existingAutomationId, payload);
    if (updated.ok) return { ok: true, id: updated.id };
  }

  const created = await createCommentAutomation({
    profileId: row.profileId,
    accountId: row.accountId,
    postId: row.zernioPostId,
    platformPostId: row.platformPostId,
    trigger: "comment",
    name: `comment "${row.keyword}" → DM`,
    keywords: keywordVariants(row.keyword),
    matchMode: "word",
    alsoMatchInDms: true,
    ...payload,
  });
  if (created.ok && !created.already) return created;
  if (!created.ok && created.status !== 409) return created;

  const existingId = await findExistingAutomationId(row);
  if (!existingId) {
    return {
      ok: false,
      error: created.ok
        ? "Automation already exists but could not be updated."
        : created.error,
    };
  }
  const updated = await updateCommentAutomation(existingId, payload);
  if (updated.ok) return { ok: true, id: updated.id };
  return updated;
}

/**
 * Mirror the setup outcome onto the agent_posts job (Agent Posts desk badge).
 * queueCommentToDm() stamps "pending" at schedule time; the flush loop wires
 * the automation hours later once the platform post id exists, and without
 * this the desk kept saying "pending" forever even though the DM funnel was
 * live (Kevin 2026-09-11, "comment to dm not working on Kev AI").
 */
async function syncAgentPostDmStatus(setupId: number) {
  try {
    await query(
      `update agent_posts ap
          set comment_dm_status = agg.status,
              updated_at = now()
         from (
           select s.zernio_post_id,
                  case
                    when bool_and(s.status = 'wired') then 'wired'
                    when bool_or(s.status = 'pending') then 'pending'
                    else 'error'
                  end as status
             from comment_dm_setups s
            where s.zernio_post_id = (
              select zernio_post_id from comment_dm_setups where id = $1
            )
            group by s.zernio_post_id
         ) agg
        where (ap.zernio_post_id = agg.zernio_post_id
               or ap.followup_zernio_post_id = agg.zernio_post_id)
          and ap.comment_dm_status is distinct from agg.status
          and to_regclass('agent_posts') is not null`,
      [setupId],
    );
  } catch (e) {
    console.error(
      "[comment-dm] agent_posts status sync failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

async function markWired(id: number, automationId: string | null) {
  await query(
    `update comment_dm_setups
        set status = 'wired',
            zernio_automation_id = coalesce($2, zernio_automation_id),
            error = null,
            wired_at = now()
      where id = $1`,
    [id, automationId],
  );
  await syncAgentPostDmStatus(id);
}

async function markFailed(id: number, error: string) {
  await query(
    `update comment_dm_setups set status = 'failed', error = $2 where id = $1`,
    [id, error.slice(0, 500)],
  );
  await syncAgentPostDmStatus(id);
}

export type CommentDmOutcome = {
  status: "wired" | "pending" | "error";
  wired: number;
  pending: number;
  failed: number;
  error?: string;
};

/**
 * Persist + attempt to wire comments-to-DM for every IG/FB account on a post.
 * Missing platformPostId leaves the row pending for the flush loop.
 */
export async function queueCommentToDm(args: {
  post: ZernioPost;
  platforms: { platform: string; accountId?: string; profileId?: string }[];
  keyword: string;
  dmMessage: string;
  resourceUrl: string;
  commentReply?: string;
  scheduledFor?: string | null;
}): Promise<CommentDmOutcome> {
  const keyword = args.keyword.trim();
  const commentReply = publicReply(args.commentReply);
  const urls = resolveResourceUrls(args.resourceUrl);
  const resourceUrl = urls.join("\n") || args.resourceUrl.trim();
  const dmMessage = buildDmMessage(keyword, args.dmMessage, urls);
  const targets = args.platforms.filter(
    (p) => p.accountId && isCommentDmPlatform(p.platform),
  );
  if (targets.length === 0) {
    return {
      status: "error",
      wired: 0,
      pending: 0,
      failed: 0,
      error: "No Instagram or Facebook account on this post.",
    };
  }

  const persisted = await ensureSchema();
  let wired = 0;
  let pending = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (const t of targets) {
    const accountId = t.accountId!;
    const profileId = t.profileId || args.post.platforms[0]?.profileId || "";
    const fromPost = findPlatform(args.post, t.platform, accountId);
    const platformPostId = fromPost?.platformPostId ?? null;

    let rowId: number | null = null;
    let existingAutomationId: string | null = null;
    if (persisted) {
      const rows = await query<{ id: number; zernio_automation_id: string | null }>(
        `insert into comment_dm_setups (
           zernio_post_id, profile_id, account_id, platform,
           platform_post_id, keyword, dm_message, resource_url,
           comment_reply, scheduled_for, status
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
         on conflict (zernio_post_id, account_id) do update set
           keyword = excluded.keyword,
           dm_message = excluded.dm_message,
           resource_url = excluded.resource_url,
           comment_reply = excluded.comment_reply,
           scheduled_for = coalesce(excluded.scheduled_for, comment_dm_setups.scheduled_for),
           platform_post_id = coalesce(excluded.platform_post_id, comment_dm_setups.platform_post_id),
           status = 'pending',
           error = null
         returning id, zernio_automation_id`,
        [
          args.post._id,
          profileId,
          accountId,
          t.platform,
          platformPostId,
          keyword,
          dmMessage,
          resourceUrl,
          commentReply,
          args.scheduledFor || postScheduledFor(args.post),
        ],
      );
      rowId = rows[0]?.id ?? null;
      existingAutomationId = rows[0]?.zernio_automation_id ?? null;
    }

    if (!platformPostId) {
      if (persisted) pending += 1;
      else {
        failed += 1;
        lastError = "Post is not live yet; cannot queue comments-to-DM without a database.";
      }
      continue;
    }

    const result = await createOnZernio({
      profileId,
      accountId,
      zernioPostId: args.post._id,
      platformPostId,
      keyword,
      dmMessage,
      resourceUrl,
      commentReply,
      existingAutomationId,
    });

    if (result.ok) {
      wired += 1;
      if (rowId != null) await markWired(rowId, result.id);
      continue;
    }

    lastError = result.error;
    const hardFail = /INBOX_REQUIRED|feature_not_available|401|403/i.test(
      result.error,
    );
    if (hardFail) {
      failed += 1;
      if (rowId != null) await markFailed(rowId, result.error);
    } else {
      pending += 1;
    }
  }

  const status: CommentDmOutcome["status"] =
    failed > 0 && wired === 0 && pending === 0
      ? "error"
      : wired > 0 && pending === 0 && failed === 0
        ? "wired"
        : pending > 0
          ? "pending"
          : wired > 0
            ? "wired"
            : "error";

  return { status, wired, pending, failed, error: lastError };
}

async function wireRow(row: SetupRow, platformPostId: string): Promise<boolean> {
  const result = await createOnZernio({
    profileId: row.profile_id,
    accountId: row.account_id,
    zernioPostId: row.zernio_post_id,
    platformPostId,
    keyword: row.keyword,
    dmMessage: row.dm_message ?? "",
    resourceUrl: row.resource_url,
    commentReply: row.comment_reply ?? "",
    existingAutomationId: row.zernio_automation_id,
  });
  if (result.ok) {
    await markWired(row.id, result.id);
    if (platformPostId !== row.platform_post_id) {
      await query(
        `update comment_dm_setups set platform_post_id = $2 where id = $1`,
        [row.id, platformPostId],
      );
    }
    return true;
  }
  // Inbox addon / auth: don't hammer. Everything else stays pending.
  if (/INBOX_REQUIRED|feature_not_available|401|403/i.test(result.error)) {
    await markFailed(row.id, result.error);
    return false;
  }
  console.error(
    `[comment-dm] wire failed post=${row.zernio_post_id} acct=${row.account_id}: ${result.error}`,
  );
  return false;
}

/** Point a pending comment-to-DM row at a companion Zernio post that actually went live. */
export async function retargetCommentDmPost(
  fromPostId: string,
  toPostId: string,
  platformPostId?: string | null,
): Promise<number> {
  if (!fromPostId || !toPostId || !(await ensureSchema())) return 0;
  const rows = await query<{ id: number }>(
    `update comment_dm_setups
        set zernio_post_id = $2,
            platform_post_id = coalesce($3, platform_post_id),
            status = 'pending',
            error = null
      where zernio_post_id = $1
        and status = 'pending'
      returning id`,
    [fromPostId, toPostId, platformPostId || null],
  );
  return rows.length;
}

export async function failPendingCommentDmSetups(
  zernioPostId: string,
  reason: string,
): Promise<void> {
  if (!dbConfigured) return;
  await ensureSchema();
  await query(
    `update comment_dm_setups
        set status = 'failed', error = $2
      where zernio_post_id = $1 and status = 'pending'`,
    [zernioPostId, reason.slice(0, 500)],
  );
}

/**
 * Drain pending rows whose posts now have a platformPostId.
 * Scheduled posts stay pending until due (or until a webhook names this post).
 */
export async function flushPendingCommentDmSetups(opts?: {
  postId?: string;
}): Promise<void> {
  if (!dbConfigured) return;
  const targeted = Boolean(opts?.postId);
  if (!targeted) {
    if (flushInFlight) return;
    flushInFlight = true;
  }
  try {
    await ensureSchema();
    const postIdFilter = opts?.postId ?? null;
    const rows = await query<SetupRow>(
      `select id, zernio_post_id, profile_id, account_id, platform,
              platform_post_id, keyword, dm_message, resource_url,
              comment_reply, zernio_automation_id, status, scheduled_for
         from comment_dm_setups
        where status = 'pending'
          and ($1::text is null or zernio_post_id = $1)
          and (
            $1::text is not null
            or scheduled_for is null
            or scheduled_for <= now() + interval '15 minutes'
          )
        order by
          case when scheduled_for is null then 0 else 1 end,
          scheduled_for asc nulls first,
          created_at asc
        limit 80`,
      [postIdFilter],
    );
    if (rows.length === 0) return;

    const byPost = new Map<string, SetupRow[]>();
    for (const row of rows) {
      const list = byPost.get(row.zernio_post_id) ?? [];
      list.push(row);
      byPost.set(row.zernio_post_id, list);
    }

    for (const [postId, group] of byPost) {
      let post: ZernioPost | null = null;
      try {
        post = await getPost(postId);
      } catch (e) {
        console.error(
          `[comment-dm] getPost ${postId} failed:`,
          e instanceof Error ? e.message : e,
        );
        continue;
      }

      if (!post) {
        await query(
          `update comment_dm_setups
              set status = 'failed', error = 'post not found'
            where zernio_post_id = $1
              and status = 'pending'
              and created_at < now() - interval '2 days'
              and (scheduled_for is null or scheduled_for < now() - interval '1 day')`,
          [postId],
        );
        continue;
      }

      const status = (post.status ?? "").toLowerCase();
      if (status === "failed" || status === "cancelled") {
        await failPendingCommentDmSetups(postId, `post ${status}`);
        continue;
      }

      const nextSched = postScheduledFor(post);
      if (nextSched) {
        await query(
          `update comment_dm_setups
              set scheduled_for = coalesce(scheduled_for, $2::timestamptz)
            where zernio_post_id = $1 and status = 'pending'`,
          [postId, nextSched],
        );
      }

      for (const row of group) {
        const pl = findPlatform(post, row.platform, row.account_id);
        if (pl?.status === "failed") {
          await markFailed(row.id, "platform publish failed");
          continue;
        }
        const platformPostId = pl?.platformPostId ?? row.platform_post_id;
        if (!platformPostId) continue;
        await wireRow(row, platformPostId);
      }
    }
  } finally {
    if (!targeted) flushInFlight = false;
  }
}

/** Keep pending comment-to-DM rows on the same clock as a rescheduled post. */
export async function updatePendingCommentDmSchedule(
  zernioPostId: string,
  scheduledFor: string | null,
): Promise<number> {
  if (!zernioPostId || !(await ensureSchema())) return 0;
  const rows = await query<{ id: number }>(
    `update comment_dm_setups
        set scheduled_for = $2
      where zernio_post_id = $1
        and status = 'pending'
      returning id`,
    [zernioPostId, scheduledFor],
  );
  return rows.length;
}

/** PATCH wired automations so the DM body includes the stored resource URLs. */
export async function resyncWiredCommentDmMessages(): Promise<number> {
  if (!dbConfigured) return 0;
  await ensureSchema();
  const rows = await query<SetupRow>(
    `select id, zernio_post_id, profile_id, account_id, platform,
            platform_post_id, keyword, dm_message, resource_url,
            comment_reply, zernio_automation_id, status
       from comment_dm_setups
      where status = 'wired'
      order by wired_at desc nulls last
      limit 20`,
  );
  let updated = 0;
  for (const row of rows) {
    const platformPostId = row.platform_post_id;
    if (!platformPostId) continue;
    const result = await createOnZernio({
      profileId: row.profile_id,
      accountId: row.account_id,
      zernioPostId: row.zernio_post_id,
      platformPostId,
      keyword: row.keyword,
      dmMessage: row.dm_message ?? "",
      resourceUrl: row.resource_url,
      commentReply: row.comment_reply ?? "",
      existingAutomationId: row.zernio_automation_id,
    });
    if (result.ok) {
      await markWired(row.id, result.id);
      updated += 1;
    } else {
      console.error(
        `[comment-dm] resync failed post=${row.zernio_post_id}: ${result.error}`,
      );
    }
  }
  return updated;
}
