import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

/** Which of the two automation pathways this client runs on. */
export type AutomationTarget = 'local' | 'railway';

export interface FunnelConfig {
  enabled: boolean;
  keywords: string[];
  matchMode: 'exact' | 'contains';
  dmMessage: string;
  link?: string;
  /** 'account-wide' or a specific platformPostId per funnel. */
  scope: 'account-wide' | 'per-post';
  /** Which connected IG/FB account ids the funnel applies to. */
  accountIds: string[];
}

/**
 * Which AI brain Midas thinks with. 'claude' = the user's Claude plan (via
 * the logged-in claude CLI) or ANTHROPIC_API_KEY. 'custom' = any model
 * behind an Anthropic-compatible API, driven through the same Agent SDK
 * by pointing it at the base URL. The API key for a custom brain lives in
 * ~/.midas/credentials.json — NEVER here.
 */
export interface BrainSettings {
  provider: 'claude' | 'custom';
  /** Anthropic-compatible API base, e.g. https://api.moonshot.ai/anthropic */
  baseUrl?: string;
  /** Model id exactly as the provider names it. */
  model?: string;
}

export type EngagementObjective = 'book-calls' | 'funnel' | 'free-value' | 'rapport' | 'other';

/**
 * Programs the comment & messaging agents: who they are when they chat,
 * and what every conversation drives toward. Used directly by the
 * engagement automations.
 */
export interface EngagementAgentConfig {
  persona: string;
  objective: EngagementObjective;
  /** Booking link, website/app URL, freebie description — the destination. */
  objectiveDetail?: string;
}

export interface AutoReplyConfig {
  enabled: boolean;
  platforms: string[];
  tone?: string;
  /** Topics that always escalate to the human instead of auto-replying. */
  escalate: string[];
}

/** Where the always-on worker lives, so the dashboard can poll it. */
export interface WorkerConfig {
  /** Public URL of the Railway worker service, e.g. https://midas-worker-x.up.railway.app */
  url?: string;
  /** Bearer token matching the worker's MIDAS_WORKER_TOKEN. Env MIDAS_WORKER_TOKEN overrides. */
  token?: string;
}

/** Railway identifiers for deploy-status checks (RAILWAY_API_TOKEN stays in env, never here). */
export interface RailwayConfig {
  projectId?: string;
  serviceId?: string;
}

export interface MidasConfig {
  version: 1;
  /** Agency running client brands, or a creator running their own. */
  mode?: 'creator' | 'agency';
  automationTarget: AutomationTarget;
  timezone: string;
  worker?: WorkerConfig;
  railway?: RailwayConfig;
  profileId?: string;
  brain?: BrainSettings;
  funnel?: FunnelConfig;
  engagementAgent?: EngagementAgentConfig;
  autoReplies?: {
    comments: AutoReplyConfig;
    messages: AutoReplyConfig;
  };
  onboardedAt?: string;
}

export const DEFAULT_ESCALATION_TOPICS = ['refunds', 'complaints', 'legal'];

export function defaultConfig(): MidasConfig {
  return {
    version: 1,
    automationTarget: 'local',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
  };
}

export async function loadConfig(path: string): Promise<MidasConfig | null> {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as MidasConfig;
}

export async function saveConfig(path: string, config: MidasConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/** Resolve the automation pathway. Defaults to local when unset. */
export function resolveAutomationTarget(config: MidasConfig | null): AutomationTarget {
  return config?.automationTarget === 'railway' ? 'railway' : 'local';
}
