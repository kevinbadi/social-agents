#!/usr/bin/env node
import "./lib/creatoros-key.js";
/**
 * publish-agent-post-now.mjs <agent_post_id> [--wait] [--at <ISO datetime>]
 *
 * --at moves the post to a specific time instead of now+2min (e.g. to fill a
 * freed slot: --at 2026-09-11T22:00:00Z).
 *
 * Pull a scheduled agent post forward: PUT the Zernio post's scheduledFor to
 * now+2min (Zernio publishes on its next tick), echoing mediaItems and the
 * platform list with STRING ids so the IG cover and per-platform copy survive.
 * Mirrors the new time onto agent_posts.scheduled_for and any pending
 * comment_dm_setups so the drain + DM flush stay on the same clock.
 * --wait polls Zernio until every platform leaves "pending" (max 15 min).
 *
 *   node --env-file=.env.local scripts/publish-agent-post-now.mjs <id> --wait
 */
import { Pool } from "pg";

const [id, ...rest] = process.argv.slice(2);
if (!id) {
  console.error("usage: publish-agent-post-now.mjs <agent_post_id> [--wait]");
  process.exit(1);
}
const WAIT = rest.includes("--wait");
const atIdx = rest.indexOf("--at");
const AT = atIdx >= 0 ? rest[atIdx + 1] : null;
if (AT && !Number.isFinite(Date.parse(AT))) {
  console.error("--at needs an ISO datetime");
  process.exit(1);
}
const BASE = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1";
const KEY = process.env.CREATOR_OS_API_KEY || process.env.ZERNIO_API_KEY;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function z(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
const sid = (v) => (v && typeof v === "object" ? v._id : v);

async function main() {
  const {
    rows: [row],
  } = await pool.query(
    `select id, status, zernio_post_id, youtube_title, profile_id from agent_posts where id = $1`,
    [id],
  );
  if (!row) throw new Error("no such agent post");
  if (!row.zernio_post_id) throw new Error(`no zernio post yet (status ${row.status})`);
  if (row.status !== "scheduled") throw new Error(`agent post is ${row.status}, not scheduled`);

  const pid = row.zernio_post_id;
  const got = await z(`/posts/${encodeURIComponent(pid)}`);
  const post = got.post ?? got;
  if ((post.status || "").toLowerCase() !== "scheduled") {
    throw new Error(`zernio post is ${post.status}, refusing to touch it`);
  }

  const when = AT ? new Date(AT).toISOString() : new Date(Date.now() + 2 * 60_000).toISOString();
  const platforms = (post.platforms || []).map((p) => ({
    platform: p.platform,
    accountId: sid(p.accountId),
    profileId: sid(p.profileId),
    ...(p.customContent ? { customContent: p.customContent } : {}),
    ...(p.platformSpecificData && Object.keys(p.platformSpecificData).length
      ? { platformSpecificData: p.platformSpecificData }
      : {}),
  }));
  const mediaItems = (post.mediaItems || []).map((m) => ({
    type: m.type,
    url: m.url,
    ...(m.thumbnail ? { thumbnail: m.thumbnail } : {}),
    ...(m.instagramThumbnail ? { instagramThumbnail: m.instagramThumbnail } : {}),
  }));
  const out = await z(`/posts/${encodeURIComponent(pid)}`, {
    method: "PUT",
    body: JSON.stringify({ scheduledFor: when, platforms, mediaItems }),
  });
  const upd = out.post ?? out;
  console.log(
    `✓ zernio ${pid} "${row.youtube_title}" scheduledFor -> ${upd.scheduledFor ?? when} (media ${mediaItems.length}, platforms ${platforms.length})`,
  );

  await pool.query(
    `update agent_posts set scheduled_for = $2, updated_at = now() where id = $1`,
    [id, when],
  );
  const dm = await pool.query(
    `update comment_dm_setups set scheduled_for = $2 where zernio_post_id = $1 and status = 'pending' returning id`,
    [pid, when],
  );
  console.log(`✓ agent_posts + ${dm.rowCount} pending comment-dm row(s) moved to ${when}`);

  if (WAIT) {
    const t0 = Date.now();
    for (;;) {
      await sleep(20_000);
      const g = await z(`/posts/${encodeURIComponent(pid)}`);
      const p = g.post ?? g;
      const states = (p.platforms || []).map((x) => `${x.platform}:${x.status}`);
      console.log(`  ${p.status}  ${states.join("  ")}`);
      const pending = (p.platforms || []).some((x) => x.status === "pending" || x.status === "publishing");
      if (!pending || Date.now() - t0 > 15 * 60_000) break;
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
