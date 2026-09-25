// Resolve the CreatorOS API key and API URL for the Agent Posts scripts.
//
// Social Agents already holds the key. Same order as the harness:
// CREATOROS_API_KEY, then ~/.social-agents/credentials.json (~/.midas,
// ~/.kairos from older installs), then ~/.creatoros/config.json (written by
// `npx @creatoros/cli init`). CREATOR_OS_API_KEY and .env.local are read as
// deprecated fallbacks. The key is never written to a file. Import this first.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CREATOROS_API_URL = (process.env.CREATOROS_API_URL || "https://creatoros-production-5658.up.railway.app").replace(/\/+$/, "");
export const GET_KEY_HELP =
  "Get a CreatorOS API key (cos_live_...) at https://www.creatoros.ca/ under Settings, API keys, or run `npx @creatoros/cli init`.";

const isLegacy = (key) => key.startsWith("sk_");

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null; // unreadable file: keep looking
  }
}

function fromEnvFile() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*CREATORO?_?OS_API_KEY\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "").trim() || null;
  }
  return null;
}

function candidates() {
  const found = [];
  if (process.env.CREATOROS_API_KEY) found.push({ key: process.env.CREATOROS_API_KEY, source: "CREATOROS_API_KEY" });
  for (const dir of [".social-agents", ".midas", ".kairos"]) {
    const key = readJson(path.join(os.homedir(), dir, "credentials.json"))?.apiKey;
    if (key) found.push({ key, source: `~/${dir}/credentials.json` });
  }
  const cliDir = process.env.CREATOROS_CONFIG_DIR || path.join(os.homedir(), ".creatoros");
  const cliKey = readJson(path.join(cliDir, "config.json"))?.api_key;
  if (cliKey) found.push({ key: cliKey, source: "~/.creatoros/config.json" });
  // Deprecated names, kept so older setups keep working.
  if (process.env.CREATOR_OS_API_KEY) found.push({ key: process.env.CREATOR_OS_API_KEY, source: "CREATOR_OS_API_KEY (deprecated: use CREATOROS_API_KEY)" });
  const envFile = fromEnvFile();
  if (envFile) found.push({ key: envFile, source: ".env.local" });
  return found.map((c) => ({ ...c, key: c.key.trim() })).filter((c) => c.key);
}

/** { key, source } for the first current key; { legacy: true } when only sk_ keys exist; null when none. */
export function resolveCreatorOsKey() {
  const found = candidates();
  const current = found.find((c) => !isLegacy(c.key));
  if (current) return current;
  return found.length ? { legacy: true, source: found[0].source } : null;
}

const resolved = resolveCreatorOsKey();
if (resolved?.key) process.env.CREATOROS_API_KEY = resolved.key;
export const creatorOsKeySource = resolved?.key ? resolved.source : null;
export const creatorOsLegacyKey = Boolean(resolved?.legacy);
