#!/usr/bin/env node
import "./lib/creatoros-key.js";
/**
 * fix-agent-post-title — retitle an agent post AFTER it was scheduled on Zernio.
 *
 * Usage: node --env-file=.env.local scripts/fix-agent-post-title.mjs <agent_post_id> "<new title>" [--wait]
 *
 * Updates agent_posts.youtube_title, then PUTs the Zernio post: top-level
 * title + youtube platformSpecificData.title. Echoes mediaItems (type/url/
 * thumbnail/instagramThumbnail) and platforms with STRING account/profile ids
 * (a PUT that omits mediaItems drops the IG cover; populated objects = 400).
 * --wait polls the row until zernio_post_id exists (max 20 min).
 */
import { Pool } from "pg";

const [id, title, ...rest] = process.argv.slice(2);
if (!id || !title) {
  console.error("usage: fix-agent-post-title <id> <title> [--wait]");
  process.exit(1);
}
const WAIT = rest.includes("--wait");
const BASE = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1";
const KEY = process.env.CREATOR_OS_API_KEY || process.env.ZERNIO_API_KEY;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function z(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
const sid = (v) => (v && typeof v === "object" ? v._id : v);

async function main() {
  await pool.query(`update agent_posts set youtube_title = $2, updated_at = now() where id = $1`, [id, title]);
  let row;
  const t0 = Date.now();
  for (;;) {
    ({ rows: [row] } = await pool.query(`select status, step, zernio_post_id from agent_posts where id = $1`, [id]));
    if (!row) throw new Error("no such agent post");
    if (row.zernio_post_id) break;
    if (!WAIT || Date.now() - t0 > 20 * 60_000) {
      console.log(`no zernio post yet (status ${row.status}/${row.step}); DB title set.`);
      await pool.end();
      return;
    }
    await sleep(10_000);
  }
  const pid = row.zernio_post_id;
  const got = await z(`/posts/${encodeURIComponent(pid)}`);
  const post = got.post ?? got;
  const platforms = (post.platforms || []).map((p) => {
    const psd = { ...(p.platformSpecificData || {}) };
    if (String(p.platform).toLowerCase() === "youtube") psd.title = title;
    return {
      platform: p.platform,
      accountId: sid(p.accountId),
      profileId: sid(p.profileId),
      ...(p.customContent ? { customContent: p.customContent } : {}),
      ...(Object.keys(psd).length ? { platformSpecificData: psd } : {}),
    };
  });
  const mediaItems = (post.mediaItems || []).map((m) => ({
    type: m.type,
    url: m.url,
    ...(m.thumbnail ? { thumbnail: m.thumbnail } : {}),
    ...(m.instagramThumbnail ? { instagramThumbnail: m.instagramThumbnail } : {}),
  }));
  const body = { title, platforms, mediaItems };
  const out = await z(`/posts/${encodeURIComponent(pid)}`, { method: "PUT", body: JSON.stringify(body) });
  const upd = out.post ?? out;
  console.log(`✓ zernio ${pid} title -> ${upd.title ?? title}; media ${mediaItems.length}, platforms ${platforms.length}`);
  await pool.end();
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
