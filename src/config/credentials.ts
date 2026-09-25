/**
 * API keys never land in any repo file. Interactive keys are persisted to
 * ~/.social-agents/credentials.json (mode 0600), one per CreatorOS
 * workspace. CREATOROS_API_KEY covers any workspace without a saved key.
 */
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isLegacyKey, LegacyApiKeyError } from '../client/client.js';

const CREDENTIALS_DIR = join(homedir(), '.social-agents');
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, 'credentials.json');
// Pre-rename installs saved under ~/.midas (or ~/.kairos before that); read from there until the first save migrates them.
const LEGACY_CREDENTIALS_PATHS = ['.midas', '.kairos'].map((dir) => join(homedir(), dir, 'credentials.json'));

function credentialsPath(): string {
  if (existsSync(CREDENTIALS_PATH)) return CREDENTIALS_PATH;
  return LEGACY_CREDENTIALS_PATHS.find((path) => existsSync(path)) ?? CREDENTIALS_PATH;
}

/** Where `npx @creatoros/cli init` saves the key. */
export function creatorosCliConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CREATOROS_CONFIG_DIR || join(homedir(), '.creatoros'), 'config.json');
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** One saved key per CreatorOS workspace. */
export interface WorkspaceKey {
  /** CreatorOS workspace id, from /v1/me. */
  workspaceId: string;
  name: string;
  apiKey: string;
}

type Candidate = { key: string; source: string };

async function candidates(workspaceId?: string): Promise<Candidate[]> {
  const ours = await readJson(credentialsPath());
  const cli = await readJson(creatorosCliConfigPath());
  const saved = Array.isArray(ours?.workspaces) ? (ours.workspaces as WorkspaceKey[]) : [];
  const forWorkspace = workspaceId ? saved.find((w) => w.workspaceId === workspaceId)?.apiKey : undefined;
  return [
    // A key saved for THIS workspace wins, so one exported env var can't
    // hijack every workspace. The Railway worker has no saved keys: env.
    { key: forWorkspace, source: '~/.social-agents/credentials.json' },
    { key: process.env.CREATOROS_API_KEY, source: 'CREATOROS_API_KEY' },
    { key: ours?.apiKey, source: '~/.social-agents/credentials.json' },
    { key: cli?.api_key, source: '~/.creatoros/config.json' },
  ]
    .filter((c): c is Candidate => typeof c.key === 'string' && c.key.trim().length > 0)
    .map((c) => ({ ...c, key: c.key.trim() }));
}

/**
 * Key resolution, first hit wins: the key saved for this workspace, then
 * CREATOROS_API_KEY, then a single saved key from older installs, then the
 * CreatorOS CLI's config. A pre-CreatorOS `sk_` key is skipped when a
 * current key exists anywhere; when it is the only key found, this throws
 * with how to get a new one. Callers check the key's workspace against the
 * one they expect (see assertKeyMatchesWorkspace).
 */
export async function resolveApiKey(workspaceId?: string): Promise<string | null> {
  return (await findExistingKey(workspaceId))?.key ?? null;
}

/** Like resolveApiKey, plus where the key came from (onboarding offers it). */
export async function findExistingKey(workspaceId?: string): Promise<Candidate | null> {
  const found = await candidates(workspaceId);
  const current = found.find((c) => !isLegacyKey(c.key));
  if (current) return current;
  if (found.length > 0) throw new LegacyApiKeyError();
  return null;
}

/** Every workspace key saved by onboarding. */
export async function savedWorkspaceKeys(): Promise<WorkspaceKey[]> {
  const ours = await readJson(credentialsPath());
  return Array.isArray(ours?.workspaces) ? (ours.workspaces as WorkspaceKey[]) : [];
}

/** Save (or replace) the key for one CreatorOS workspace. */
export async function saveWorkspaceKey(entry: WorkspaceKey): Promise<void> {
  const others = (await savedWorkspaceKeys()).filter((w) => w.workspaceId !== entry.workspaceId);
  await saveCredentials({ workspaces: [...others, entry] } as unknown as StoredCredentials);
}

export interface StoredCredentials {
  /** Pre-workspace installs saved a single key here; still read as a fallback. */
  apiKey?: string;
  /** One CreatorOS key per workspace (one set of socials each). */
  workspaces?: WorkspaceKey[];
  /** API key for a custom (Anthropic-compatible) brain. */
  aiApiKey?: string;
  /** Railway account API token — lets the agent provision the worker. */
  railwayApiToken?: string;
  /** AI credential destined for the cloud worker's environment. */
  workerAiKey?: string;
  /** Which env var the worker AI credential belongs in. */
  workerAiKind?: 'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_OAUTH_TOKEN';
}

export async function resolveWorkerAiCredential(): Promise<{ kind: 'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_OAUTH_TOKEN'; value: string } | null> {
  if (existsSync(credentialsPath())) {
    try {
      const parsed = JSON.parse(await readFile(credentialsPath(), 'utf8')) as StoredCredentials;
      if (parsed.workerAiKey && parsed.workerAiKind) return { kind: parsed.workerAiKind, value: parsed.workerAiKey };
    } catch {
      // fall through to env
    }
  }
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  return fromEnv ? { kind: 'ANTHROPIC_API_KEY', value: fromEnv } : null;
}

export async function saveWorkerAiCredential(kind: 'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_OAUTH_TOKEN', value: string): Promise<void> {
  await saveCredentials({ workerAiKey: value, workerAiKind: kind } as unknown as StoredCredentials);
}

/** Railway account token: RAILWAY_API_TOKEN env wins, then the saved one. */
export async function resolveRailwayToken(): Promise<string | null> {
  const fromEnv = process.env.RAILWAY_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (!existsSync(credentialsPath())) return null;
  try {
    const parsed = JSON.parse(await readFile(credentialsPath(), 'utf8')) as StoredCredentials;
    return parsed.railwayApiToken ?? null;
  } catch {
    return null;
  }
}

export async function saveRailwayToken(railwayApiToken: string): Promise<void> {
  await saveCredentials({ railwayApiToken } as unknown as StoredCredentials);
}

/** Custom-brain API key: AI_API_KEY env wins, then the saved one. */
export async function resolveAiApiKey(): Promise<string | null> {
  const fromEnv = process.env.AI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (!existsSync(credentialsPath())) return null;
  try {
    const parsed = JSON.parse(await readFile(credentialsPath(), 'utf8')) as StoredCredentials;
    return parsed.aiApiKey ?? null;
  } catch {
    return null;
  }
}

export async function saveAiApiKey(aiApiKey: string): Promise<void> {
  await saveCredentials({ aiApiKey } as unknown as StoredCredentials);
}

export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  let existing: Partial<StoredCredentials> = {};
  if (existsSync(credentialsPath())) {
    try {
      existing = JSON.parse(await readFile(credentialsPath(), 'utf8')) as StoredCredentials;
    } catch {
      existing = {};
    }
  }
  const merged = { ...existing, ...credentials };
  await writeFile(CREDENTIALS_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  await chmod(CREDENTIALS_PATH, 0o600);
}
