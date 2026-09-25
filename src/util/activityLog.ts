/**
 * The agent's structured activity log — logs/activity.jsonl, append-only,
 * one JSON line per action the agent actually took. Written from the tool
 * layer (every engine goes through it), read by the dashboard.
 *
 * Reads and failures here must never break the agent: logging is
 * best-effort, and a corrupt line is skipped, not fatal.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export type ActivityOutcome = 'sent' | 'ok' | 'skipped' | 'failed';

export interface ActivityEntry {
  /** ISO 8601 timestamp. */
  ts: string;
  /** What drove the action: 'chat', a skill name, or a cron name. */
  workflow: string;
  /** The tool/action name, e.g. reply_to_comment, send_message, create_post. */
  action: string;
  platform?: string;
  /** What was acted on: post id, comment id, conversation id, filename… */
  target?: string;
  outcome: ActivityOutcome;
  /** The actual error message when outcome is 'failed'. */
  error?: string;
}

export function activityLogPath(workspaceRoot: string): string {
  return join(workspaceRoot, 'logs', 'activity.jsonl');
}

/** Append one entry. Never throws — a broken log must not break the agent. */
export async function appendActivity(workspaceRoot: string, entry: ActivityEntry): Promise<void> {
  try {
    const path = activityLogPath(workspaceRoot);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // best-effort only
  }
}

export interface ActivityFilter {
  workflow?: string;
  platform?: string;
  outcome?: string;
  limit?: number;
}

/**
 * Workspace admin — creating crons/webhooks/funnels, editing config. Real
 * agent work for the raw Logs page, but NOT audience-facing activity: the
 * overview's counters, heatmap, and live feed track replies/DMs/posts,
 * not setup.
 */
const SETUP_ACTIONS = new Set([
  'create_cron_automation',
  'delete_cron_automation',
  'create_webhook',
  'delete_webhook',
  'test_webhook',
  'create_funnel',
  'update_funnel',
  'delete_funnel',
]);

export function isSetupAction(action: string): boolean {
  return SETUP_ACTIONS.has(action);
}

/** Apply an ActivityFilter to already-loaded entries (newest first). */
export function filterActivity(entries: ActivityEntry[], filter: ActivityFilter = {}): ActivityEntry[] {
  const filtered = entries.filter(
    (e) =>
      (!filter.workflow || e.workflow === filter.workflow) &&
      (!filter.platform || e.platform === filter.platform) &&
      (!filter.outcome || e.outcome === filter.outcome),
  );
  return filter.limit ? filtered.slice(0, filter.limit) : filtered;
}

/**
 * Merge activity from several sources (local log + the Railway worker's),
 * newest first, deduped — a local worker sharing this workspace would
 * otherwise double every entry.
 */
export function mergeActivity(...sources: ActivityEntry[][]): ActivityEntry[] {
  const seen = new Set<string>();
  const merged: ActivityEntry[] = [];
  for (const entries of sources) {
    for (const entry of entries) {
      const key = `${entry.ts}|${entry.action}|${entry.workflow}|${entry.target ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
    }
  }
  merged.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return merged;
}

/** Read entries, newest first. Corrupt lines are skipped. */
export async function readActivity(
  workspaceRoot: string,
  filter: ActivityFilter = {},
): Promise<ActivityEntry[]> {
  const path = activityLogPath(workspaceRoot);
  if (!existsSync(path)) return [];
  let raw = '';
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const entries: ActivityEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as ActivityEntry;
      if (entry && entry.ts && entry.action) entries.push(entry);
    } catch {
      // skip corrupt lines
    }
  }
  entries.reverse(); // newest first
  return filterActivity(entries, filter);
}

export interface ActivitySummary {
  today: { actions: number; replies: number; dms: number; posts: number; skipped: number; failed: number };
  week: { actions: number; replies: number; dms: number; posts: number; skipped: number; failed: number };
  /** 365 days of {date: 'YYYY-MM-DD', count} for the heatmap, oldest first. */
  heatmap: Array<{ date: string; count: number }>;
  perWorkflow: Array<{
    workflow: string;
    lastTs: string;
    sent: number;
    skipped: number;
    failed: number;
  }>;
  workflows: string[];
  platforms: string[];
  lastAction: ActivityEntry | null;
}

const REPLY_ACTIONS = new Set(['reply_to_comment', 'private_reply_to_comment']);
const DM_ACTIONS = new Set(['send_message', 'private_reply_to_comment']);
const POST_ACTIONS = new Set(['create_post', 'retry_post']);

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

/** Aggregate the counters, heatmap buckets, and per-workflow health. */
export function summarizeActivity(entries: ActivityEntry[], now: Date = new Date()): ActivitySummary {
  const empty = () => ({ actions: 0, replies: 0, dms: 0, posts: 0, skipped: 0, failed: 0 });
  const today = empty();
  const week = empty();
  const todayKey = dayKey(now);
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const yearAgo = now.getTime() - 364 * 86_400_000;

  const byDay = new Map<string, number>();
  const byWorkflow = new Map<string, { lastTs: string; sent: number; skipped: number; failed: number }>();
  const workflows = new Set<string>();
  const platforms = new Set<string>();

  for (const entry of entries) {
    const ts = Date.parse(entry.ts);
    if (Number.isNaN(ts)) continue;
    // Setup/admin actions never count as agent activity — the overview
    // tracks audience-facing work (replies, DMs, posts), not "create cron".
    if (isSetupAction(entry.action)) continue;
    workflows.add(entry.workflow);
    if (entry.platform) platforms.add(entry.platform);

    const bump = (bucket: ReturnType<typeof empty>) => {
      bucket.actions++;
      if (REPLY_ACTIONS.has(entry.action)) bucket.replies++;
      if (DM_ACTIONS.has(entry.action)) bucket.dms++;
      if (POST_ACTIONS.has(entry.action)) bucket.posts++;
      if (entry.outcome === 'skipped') bucket.skipped++;
      if (entry.outcome === 'failed') bucket.failed++;
    };
    const key = entry.ts.slice(0, 10);
    if (key === todayKey) bump(today);
    if (ts >= weekAgo) bump(week);
    if (ts >= yearAgo) byDay.set(key, (byDay.get(key) ?? 0) + 1);

    const wf = byWorkflow.get(entry.workflow) ?? { lastTs: entry.ts, sent: 0, skipped: 0, failed: 0 };
    if (entry.ts > wf.lastTs) wf.lastTs = entry.ts;
    if (entry.outcome === 'sent' || entry.outcome === 'ok') wf.sent++;
    if (entry.outcome === 'skipped') wf.skipped++;
    if (entry.outcome === 'failed') wf.failed++;
    byWorkflow.set(entry.workflow, wf);
  }

  const heatmap: ActivitySummary['heatmap'] = [];
  for (let i = 364; i >= 0; i--) {
    const date = dayKey(new Date(now.getTime() - i * 86_400_000));
    heatmap.push({ date, count: byDay.get(date) ?? 0 });
  }

  return {
    today,
    week,
    heatmap,
    perWorkflow: [...byWorkflow.entries()]
      .map(([workflow, stats]) => ({ workflow, ...stats }))
      .sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1)),
    workflows: [...workflows].sort(),
    platforms: [...platforms].sort(),
    lastAction: entries[0] ?? null,
  };
}

/**
 * Which tool calls count as agent ACTIONS (vs. reads). Only these land in
 * the activity log — list_/get_ calls would drown the signal.
 */
const MUTATING_PREFIXES = ['create_', 'send_', 'reply_', 'private_reply', 'like_', 'hide_', 'update_', 'delete_', 'retry_', 'upload_', 'unpublish_', 'edit_'];
export function isLoggedAction(toolName: string): boolean {
  return MUTATING_PREFIXES.some((prefix) => toolName.startsWith(prefix));
}

/** Best-effort platform/target extraction from tool args, for the log line. */
export function describeToolCall(args: Record<string, unknown>): { platform?: string; target?: string } {
  // create_post: simple-form network names, or advanced-form targets.
  const networks = [
    ...(Array.isArray(args.platforms) ? (args.platforms as unknown[]) : []),
    ...(Array.isArray(args.targets) ? (args.targets as unknown[]) : []),
  ]
    .map((p) => (typeof p === 'string' ? p : (p as { platform?: string } | null)?.platform))
    .filter((p): p is string => Boolean(p));
  const platform = (args.platform as string | undefined) ?? (networks.length ? networks.join(',') : undefined);
  const target =
    (args.postId as string | undefined) ??
    (args.commentId as string | undefined) ??
    (args.conversationId as string | undefined) ??
    (args.automationId as string | undefined) ??
    (args.filePath as string | undefined);
  return { platform, target };
}
