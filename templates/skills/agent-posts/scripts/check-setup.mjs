#!/usr/bin/env node
// First-run check for the Agent Posts workflow.
//
// Creator OS (https://www.creatoros.ca/) issues each user an API key that is a
// profile-scoped key on Zernio, the underlying posting layer. This script:
//   1. prints the onboarding instruction until a CreatorOS key is found (env, .env.local, or ~/.midas credentials),
//   2. verifies the key live against Zernio (profiles + connected accounts),
//   3. tells the user to connect socials / enable the comment-to-DM funnel at
//      creatoros.ca when nothing is connected yet.
import fs from "node:fs";
import path from "node:path";
import { creatorOsKeySource } from "./lib/creatoros-key.js";

const ENV_FILE = path.resolve(process.cwd(), ".env.local");
const env = { ...process.env };
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const BASE = env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";

const ONBOARD = `
  CreatorOS API key required
  ---------------------------
  To run Agent Posts you need your CreatorOS API key (the same key Midas onboarding asks for).

    1. Go to https://www.creatoros.ca/ (or the CreatorOS iOS app) and sign in.
    2. Open Settings -> API key and copy it.
    3. Run Midas onboarding (npm start creatoros midas) and paste it there, or
       export CREATOROS_API_KEY=<your key> in your shell.
       Never paste the key into a repo file.

  That key is what connects your social accounts to the agent and sets up the
  comment-to-DM funnel. Until it is present nothing can be scheduled and
  "comment the word X" replies will not fire.

  Then connect your socials and enable the comment-to-DM funnel on the same
  page at creatoros.ca, and run this check again.
`;

async function zget(p) {
  const r = await fetch(`${BASE}${p}`, {
    headers: { Authorization: `Bearer ${env.CREATOR_OS_API_KEY}` },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

const key = env.CREATOR_OS_API_KEY || process.env.CREATOR_OS_API_KEY;
if (!key) {
  console.log(ONBOARD);
  process.exit(1);
}
env.CREATOR_OS_API_KEY = key;
if (creatorOsKeySource) console.log(`  CreatorOS key: found via ${creatorOsKeySource}`);

const prof = await zget("/profiles");
if (prof.status === 401 || prof.status === 403) {
  console.log("  Your CreatorOS API key was rejected. Copy it again from https://www.creatoros.ca/ (Settings -> API key).");
  process.exit(1);
}
if (prof.status >= 400) {
  console.log(`  Could not reach the posting layer (HTTP ${prof.status}). Try again in a minute.`);
  process.exit(1);
}
const profiles = prof.body.profiles ?? [];
const pinned = (env.CREATOR_OS_PROFILE_ID ?? "").trim();
const targets = pinned ? profiles.filter((p) => p._id === pinned) : profiles;
if (!targets.length) {
  console.log("  Key is valid but has no profile yet. Finish onboarding at https://www.creatoros.ca/ (create your profile), then rerun.");
  process.exit(1);
}

let connected = 0;
for (const p of targets) {
  const acc = await zget(`/accounts?profileId=${encodeURIComponent(p._id)}`);
  const accounts = (acc.body.accounts ?? []).filter((a) => a.isActive !== false);
  connected += accounts.length;
  const handles = accounts.map((a) => `${a.platform}:@${(a.username ?? "").replace(/^@/, "")}`);
  console.log(`  profile ${p.name ?? p._id}  ->  ${accounts.length} connected ${handles.length ? `(${handles.join(", ")})` : ""}`);
}
if (!connected) {
  console.log(`
  Your key works but no socials are connected yet. Go to https://www.creatoros.ca/,
  connect your TikTok / Instagram / YouTube / X accounts, and enable the
  comment-to-DM funnel there. Then rerun this check.
`);
  process.exit(1);
}

const missing = ["DATABASE_URL", "INSFORGE_API_BASE_URL", "INSFORGE_API_KEY", "OLLAMA_API_KEY"].filter((k) => !env[k]);
if (missing.length) {
  console.log(`  CreatorOS key OK, but missing env: ${missing.join(", ")} (see ENV_VARS.txt)`);
  process.exit(1);
}
console.log(`
  agent-posts setup ok: CreatorOS key valid, ${connected} social account(s) connected.
  Comment-to-DM: each post arms its own "comment <KEYWORD>" automation through
  your key; make sure the funnel is enabled at https://www.creatoros.ca/.
`);
