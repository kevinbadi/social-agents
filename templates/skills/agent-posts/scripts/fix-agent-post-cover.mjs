#!/usr/bin/env node
import "./lib/creatoros-key.js";
/**
 * fix-agent-post-cover — swap the cover on already-scheduled agent posts.
 *
 * Usage: node --env-file=.env.local scripts/fix-agent-post-cover.mjs <png> <agent_post_id> [<agent_post_id> ...]
 *
 * Uploads the PNG to Insforge (media bucket), sets agent_posts.thumbnail_url
 * on every id, then PUTs each Zernio post: mediaItems thumbnail +
 * instagramThumbnail and the instagram / youtube platformSpecificData
 * thumbnail fields. Echoes platforms with STRING ids and the full mediaItems
 * (omitting mediaItems drops the IG cover).
 */
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const [png, ...ids] = process.argv.slice(2);
if (!png || !ids.length || !fs.existsSync(png)) {
  console.error("usage: fix-agent-post-cover <png> <agent_post_id...>");
  process.exit(1);
}
const IBASE = (process.env.INSFORGE_API_BASE_URL || "").replace(/\/$/, "");
const IKEY = process.env.INSFORGE_API_KEY;
const ZBASE = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1";
const ZKEY = process.env.CREATOR_OS_API_KEY || process.env.ZERNIO_API_KEY;
if (!IBASE || !IKEY || !ZKEY || !process.env.DATABASE_URL) {
  console.error("need INSFORGE_API_BASE_URL, INSFORGE_API_KEY, CREATOR_OS_API_KEY, DATABASE_URL");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
const sid = (v) => (v && typeof v === "object" ? v._id : v);

async function uploadCover(file) {
  const bytes = fs.readFileSync(file);
  const filename = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-agent-cover-${path.parse(file).name}.png`;
  const contentType = "image/png";
  const auth = { Authorization: `Bearer ${IKEY}` };
  const sr = await fetch(`${IBASE}/api/storage/buckets/media/upload-strategy`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType, size: bytes.length }),
  });
  if (!sr.ok) throw new Error(`upload strategy ${sr.status}`);
  const s = await sr.json();
  const blob = new Blob([bytes], { type: contentType });
  if (s.method === "presigned") {
    const fd = new FormData();
    for (const [k, v] of Object.entries(s.fields ?? {})) fd.append(k, v);
    fd.append("file", blob, filename);
    const up = await fetch(s.uploadUrl, { method: "POST", body: fd });
    if (up.status < 200 || up.status >= 300) throw new Error(`s3 ${up.status}: ${(await up.text()).slice(0, 200)}`);
    const cf = await fetch(`${IBASE}${s.confirmUrl}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ size: bytes.length, contentType }) });
    if (!cf.ok) throw new Error(`confirm ${cf.status}`);
    return (await cf.json()).url;
  }
  const fd = new FormData();
  fd.append("file", blob, filename);
  const up = await fetch(`${IBASE}${s.uploadUrl}`, { method: "PUT", headers: auth, body: fd });
  if (!up.ok) throw new Error(`upload ${up.status}: ${(await up.text()).slice(0, 200)}`);
  const j = await up.json().catch(() => ({}));
  return j.url || `${IBASE}/api/storage/buckets/media/objects/${s.key}`;
}

async function z(p, init = {}) {
  const res = await fetch(`${ZBASE}${p}`, { ...init, headers: { Authorization: `Bearer ${ZKEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${p}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function patchZernio(pid, url) {
  const got = await z(`/posts/${encodeURIComponent(pid)}`);
  const post = got.post ?? got;
  const platforms = (post.platforms || []).map((p) => {
    const psd = { ...(p.platformSpecificData || {}) };
    const plat = String(p.platform).toLowerCase();
    if (plat === "youtube" && psd.thumbnailUrl) psd.thumbnailUrl = url;
    if (plat === "instagram") {
      if (psd.instagramThumbnail) psd.instagramThumbnail = url;
      if (psd.thumbnailUrl) psd.thumbnailUrl = url;
    }
    return {
      platform: p.platform, accountId: sid(p.accountId), profileId: sid(p.profileId),
      ...(p.customContent ? { customContent: p.customContent } : {}),
      ...(Object.keys(psd).length ? { platformSpecificData: psd } : {}),
    };
  });
  const mediaItems = (post.mediaItems || []).map((m) => ({
    type: m.type, url: m.url,
    ...(m.thumbnail ? { thumbnail: url } : {}),
    ...(m.instagramThumbnail ? { instagramThumbnail: url } : {}),
  }));
  const body = { platforms, mediaItems, ...(post.title ? { title: post.title } : {}) };
  await z(`/posts/${encodeURIComponent(pid)}`, { method: "PUT", body: JSON.stringify(body) });
  return { media: mediaItems.length, platforms: platforms.length };
}

async function main() {
  const url = await uploadCover(png);
  console.log(`✓ uploaded ${url}`);
  for (const id of ids) {
    const { rows: [row] } = await pool.query(`update agent_posts set thumbnail_url = $2, updated_at = now() where id = $1 returning zernio_post_id, status`, [id, url]);
    if (!row) { console.warn(`! no agent post ${id}`); continue; }
    if (!row.zernio_post_id) { console.log(`✓ ${id} db only (no zernio post, status ${row.status})`); continue; }
    const r = await patchZernio(row.zernio_post_id, url);
    console.log(`✓ ${id} -> zernio ${row.zernio_post_id} (media ${r.media}, platforms ${r.platforms})`);
  }
  await pool.end();
}

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
