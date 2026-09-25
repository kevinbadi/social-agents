/**
 * The API key never lands in any repo file. Interactive keys are persisted
 * to ~/.social-agents/credentials.json (mode 0600); CREATOROS_API_KEY always wins.
 */
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CREDENTIALS_DIR = join(homedir(), '.social-agents');
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, 'credentials.json');
// Pre-rename installs saved under ~/.midas (or ~/.kairos before that); read from there until the first save migrates them.
const LEGACY_CREDENTIALS_PATHS = ['.midas', '.kairos'].map((dir) => join(homedir(), dir, 'credentials.json'));

function credentialsPath(): string {
  if (existsSync(CREDENTIALS_PATH)) return CREDENTIALS_PATH;
  return LEGACY_CREDENTIALS_PATHS.find((path) => existsSync(path)) ?? CREDENTIALS_PATH;
}

export async function resolveApiKey(): Promise<string | null> {
  const fromEnv = process.env.CREATOROS_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (!existsSync(credentialsPath())) return null;
  try {
    const parsed = JSON.parse(await readFile(credentialsPath(), 'utf8')) as { apiKey?: string };
    return parsed.apiKey ?? null;
  } catch {
    return null;
  }
}

export interface StoredCredentials {
  /** The key for the workspace being run right now. */
  apiKey: string;
  /** Agency mode: one CreatorOS key per client brand. */
  keys?: Array<{ label: string; apiKey: string }>;
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

export async function saveApiKey(apiKey: string): Promise<void> {
  await saveCredentials({ apiKey });
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
