#!/usr/bin/env node
// First-run check for Agent Posts. Nothing here needs a database or a hosted
// service: the CreatorOS key does the posting, ffmpeg builds the cover, and
// whisper (optional) transcribes locally. Exit code 1 = something required is
// missing; the message says exactly what.
import "./lib/creatoros-key.js";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { creatorOsKeySource } from "./lib/creatoros-key.js";

const BASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";
const IDENTITY_DIR = path.resolve(process.env.AGENT_POSTS_IDENTITY_DIR || "social-agents/assets/identity");

const ONBOARD = `
  CreatorOS API key required
  ---------------------------
  Agent Posts posts through your CreatorOS API key, the same key Social Agents
  onboarding asks for.

    1. Go to https://www.creatoros.ca/ and sign in (sign up first if you are new).
    2. Open Settings -> API key and copy it.
    3. Run Social Agents onboarding (npm start creatoros social-agents) and paste it there, or
       export CREATOROS_API_KEY=<your key> in your shell.
       Never paste the key into a repo file.

  That key is what connects your social accounts to the agent. Until it is
  present nothing can be scheduled.
`;

function has(bin) {
  try {
    execFileSync(bin, ["-version"], { stdio: "pipe" });
    return true;
  } catch {
    try {
      execFileSync(bin, ["--help"], { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
}

async function zget(p) {
  const r = await fetch(`${BASE}${p}`, {
    headers: { Authorization: `Bearer ${process.env.CREATOR_OS_API_KEY}` },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

let failed = false;
const fail = (msg) => {
  failed = true;
  console.log(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✔ ${msg}`);
const note = (msg) => console.log(`  · ${msg}`);

if (!process.env.CREATOR_OS_API_KEY) {
  console.log(ONBOARD);
  process.exit(1);
}
ok(`CreatorOS key found via ${creatorOsKeySource}`);

const prof = await zget("/profiles");
if (prof.status === 401 || prof.status === 403) {
  fail("the CreatorOS API key was rejected. Copy it again from https://www.creatoros.ca/ (Settings -> API key).");
} else if (prof.status >= 400) {
  fail(`could not reach CreatorOS (HTTP ${prof.status}). Try again in a minute.`);
} else {
  const profiles = prof.body.profiles ?? [];
  let connected = 0;
  for (const p of profiles) {
    const acc = await zget(`/accounts?profileId=${encodeURIComponent(p._id)}`);
    const accounts = (acc.body.accounts ?? []).filter((a) => a.isActive !== false);
    connected += accounts.length;
    const handles = accounts.map((a) => `${a.platform}:@${(a.username ?? "").replace(/^@/, "")}`);
    note(`profile ${p.name ?? p._id} -> ${accounts.length} connected${handles.length ? ` (${handles.join(", ")})` : ""}`);
  }
  if (!profiles.length) fail("key is valid but has no profile yet. Finish onboarding at https://www.creatoros.ca/, then rerun.");
  else if (!connected) fail("key works but no socials are connected. Connect TikTok / Instagram / YouTube / X at https://www.creatoros.ca/, then rerun.");
  else ok(`${connected} social account(s) connected`);
}

// Local tooling. ffmpeg is required for the cover; whisper is the free local
// transcript (fal whisper is the fallback when FAL_KEY is set).
if (has("ffmpeg")) ok("ffmpeg on PATH");
else fail("ffmpeg missing (brew install ffmpeg) — needed to build the cover");
if (has("whisper")) ok("whisper on PATH (local transcript)");
else if (process.env.FAL_KEY) note("no local whisper; transcripts will use fal whisper via FAL_KEY");
else fail("no transcription available: install whisper (pip install openai-whisper) or set FAL_KEY");

// Optional: fal scene covers need FAL_KEY, FAL_ALLOW, and identity photos.
const identity = fs.existsSync(IDENTITY_DIR)
  ? fs.readdirSync(IDENTITY_DIR).filter((f) => /\.(png|jpe?g)$/i.test(f))
  : [];
const falOn = (process.env.FAL_ALLOW ?? "").split(",").map((s) => s.trim().toLowerCase()).some((s) => s === "*" || s === "video-thumbnail");
if (process.env.FAL_KEY && falOn && identity.length >= 2) ok(`fal scene covers enabled (${identity.length} identity photos in ${path.relative(process.cwd(), IDENTITY_DIR)})`);
else note(`covers use a real video frame. For generated scenes: FAL_KEY + FAL_ALLOW=video-thumbnail + 2 photos in ${path.relative(process.cwd(), IDENTITY_DIR)}/`);

console.log(failed ? "\n  agent-posts setup: fix the ✗ items above, then rerun." : "\n  agent-posts setup ok.");
process.exit(failed ? 1 : 0);
