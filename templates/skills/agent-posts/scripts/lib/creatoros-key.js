// Resolve the CreatorOS API key for the Agent Posts scripts.
//
// Midas already holds this key: onboarding saves it to ~/.midas/credentials.json
// (or the CREATOROS_API_KEY env var wins). The Agent Posts pipeline reads it as
// CREATOR_OS_API_KEY, so this module fills that variable in from whatever the
// harness has, without ever writing the key to a file. Import it first.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function fromEnvFile() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*CREATOR_OS_API_KEY\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "").trim() || null;
  }
  return null;
}

function fromCredentials() {
  for (const dir of [".midas", ".kairos"]) {
    const file = path.join(os.homedir(), dir, "credentials.json");
    if (!fs.existsSync(file)) continue;
    try {
      const key = JSON.parse(fs.readFileSync(file, "utf8")).apiKey;
      if (key) return { key, source: `~/${dir}/credentials.json` };
    } catch {
      // unreadable file: keep looking
    }
  }
  return null;
}

export function resolveCreatorOsKey() {
  if (process.env.CREATOR_OS_API_KEY) return { key: process.env.CREATOR_OS_API_KEY, source: "CREATOR_OS_API_KEY" };
  if (process.env.CREATOROS_API_KEY) return { key: process.env.CREATOROS_API_KEY, source: "CREATOROS_API_KEY" };
  const fromFile = fromEnvFile();
  if (fromFile) return { key: fromFile, source: ".env.local" };
  return fromCredentials();
}

const resolved = resolveCreatorOsKey();
if (resolved && !process.env.CREATOR_OS_API_KEY) process.env.CREATOR_OS_API_KEY = resolved.key;
export const creatorOsKeySource = resolved?.source ?? null;
