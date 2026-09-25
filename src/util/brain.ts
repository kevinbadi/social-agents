import { spawnSync } from 'node:child_process';

/**
 * How Social Agents thinks. Default: Claude — the user's plan via the logged-in
 * claude CLI (preferred, zero API keys) or ANTHROPIC_API_KEY. Fallback: any
 * model behind an Anthropic-compatible API (base URL + key + model id),
 * driven through the same Agent SDK by pointing ANTHROPIC_BASE_URL at it.
 */
export type BrainStatus = 'plan' | 'api-key' | 'custom' | 'missing';

export interface CustomBrain {
  provider: 'custom';
  /** Anthropic-compatible API base, e.g. https://api.moonshot.ai/anthropic */
  baseUrl: string;
  apiKey: string;
  /** Model id exactly as the provider names it. */
  model: string;
}

export interface ClaudeBrain {
  provider: 'claude';
}

export type BrainConfig = ClaudeBrain | CustomBrain;

export interface BrainCheck {
  ok: boolean;
  /** What answered the check: "your Claude plan", "ANTHROPIC_API_KEY", "<model> at <url>". */
  via: string;
  detail?: string;
}

export function claudeCliAvailable(): boolean {
  try {
    return spawnSync('claude', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

export function detectBrain(custom?: BrainConfig | null): BrainStatus {
  if (custom?.provider === 'custom') return 'custom';
  if (process.env.ANTHROPIC_API_KEY) return 'api-key';
  if (claudeCliAvailable()) return 'plan';
  return 'missing';
}

/** POST target for a custom base — tolerates bases given with or without /v1. */
export function messagesUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
}

async function checkCustom(brain: CustomBrain): Promise<BrainCheck> {
  const via = `${brain.model} at ${brain.baseUrl}`;
  try {
    const res = await fetch(messagesUrl(brain.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': brain.apiKey,
        authorization: `Bearer ${brain.apiKey}`,
      },
      body: JSON.stringify({
        model: brain.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return { ok: true, via };
    const body = (await res.text().catch(() => '')).slice(0, 300);
    return { ok: false, via, detail: `HTTP ${res.status}${body ? ` — ${body}` : ''}` };
  } catch (error) {
    return { ok: false, via, detail: (error as Error).message };
  }
}

async function checkAnthropicApiKey(): Promise<BrainCheck> {
  const via = 'Claude via ANTHROPIC_API_KEY';
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return { ok: true, via };
    return { ok: false, via, detail: `HTTP ${res.status} from the Anthropic API — check the key` };
  } catch (error) {
    return { ok: false, via, detail: (error as Error).message };
  }
}

function checkClaudePlan(): BrainCheck {
  const via = 'your Claude plan (claude CLI)';
  try {
    const run = spawnSync('claude', ['-p', 'Reply with the single word: ok'], {
      encoding: 'utf8',
      timeout: 120_000,
      env: process.env,
    });
    if (run.status === 0) return { ok: true, via };
    const detail = (run.stderr || run.stdout || 'the claude CLI returned an error').trim().slice(-300);
    return { ok: false, via, detail };
  } catch (error) {
    return { ok: false, via, detail: (error as Error).message };
  }
}

/**
 * The live end-to-end check — an actual round-trip to whatever brain is
 * configured, not just an env sniff. Setup blocks on this passing.
 */
export async function verifyBrain(brain: BrainConfig): Promise<BrainCheck> {
  if (brain.provider === 'custom') return checkCustom(brain);
  if (process.env.ANTHROPIC_API_KEY) return checkAnthropicApiKey();
  if (claudeCliAvailable()) return checkClaudePlan();
  return {
    ok: false,
    via: 'none',
    detail: 'no Claude plan login and no ANTHROPIC_API_KEY',
  };
}
