/**
 * Flow builder for the Automations page — every automation rendered the
 * way n8n/Make draw them: trigger → filter → action → outcome nodes.
 *
 * Two origins, honestly labeled:
 *   'cloud'          — runs on CreatorOS servers (comment→DM funnels);
 *                      stats come from the funnel's own execution logs.
 *   'local'/'railway'— runs through the agent on the chosen pathway
 *                      (auto-replies, scheduled crons); stats come from
 *                      the agent's activity log.
 *
 * Pure functions only — the server fills in live stats, this module
 * decides shape and health.
 */
import type { SocialAgentsConfig } from '../config/socialAgentsConfig.js';
import { STARTER_CRONS } from '../automations/crons.js';
import { describeSchedule } from './workflows.js';
import type { ActivityEntry } from '../util/activityLog.js';

export type FlowOrigin = 'cloud' | 'local' | 'railway';
export type FlowHealth = 'healthy' | 'idle' | 'failing' | 'off';

export interface FlowNode {
  kind: 'trigger' | 'filter' | 'action' | 'outcome';
  icon: string;
  label: string;
  sub?: string;
}

export interface FlowStats {
  lastTs: string | null;
  lastOutcome: string | null;
  sent: number;
  skipped: number;
  failed: number;
}

export interface Flow {
  id: string;
  name: string;
  origin: FlowOrigin;
  enabled: boolean;
  nodes: FlowNode[];
  stats: FlowStats;
  health: FlowHealth;
  lastError?: string;
  /** Free-form config shown in the card's expandable section. */
  detail?: string;
}

/** One row in the merged real-time executions feed. */
export interface FlowRun {
  ts: string;
  flow: string;
  origin: FlowOrigin;
  action: string;
  outcome: string;
  platform?: string;
  target?: string;
  error?: string;
}

export const EMPTY_STATS: FlowStats = { lastTs: null, lastOutcome: null, sent: 0, skipped: 0, failed: 0 };

/** House health rules: off < failing < idle < healthy, judged on the log. */
export function flowHealth(enabled: boolean, stats: FlowStats): FlowHealth {
  if (!enabled) return 'off';
  if (stats.lastOutcome === 'failed' || stats.failed > stats.sent) return 'failing';
  if (stats.sent > 0) return 'healthy';
  return 'idle';
}

/** Compute stats from activity entries matching a predicate (newest first). */
export function statsFrom(entries: ActivityEntry[], match: (e: ActivityEntry) => boolean): FlowStats {
  const stats: FlowStats = { ...EMPTY_STATS };
  for (const entry of entries) {
    if (!match(entry)) continue;
    if (!stats.lastTs) {
      stats.lastTs = entry.ts;
      stats.lastOutcome = entry.outcome;
    }
    if (entry.outcome === 'sent' || entry.outcome === 'ok') stats.sent++;
    else if (entry.outcome === 'skipped') stats.skipped++;
    else if (entry.outcome === 'failed') stats.failed++;
  }
  return stats;
}

const REPLY_ACTIONS = new Set(['reply_to_comment', 'private_reply_to_comment']);

/**
 * The engagement flows driven by social-agents.json: auto-replies to comments
 * and DMs. They run through the agent on the configured pathway.
 */
export function engagementFlows(config: SocialAgentsConfig | null, entries: ActivityEntry[]): Flow[] {
  const origin: FlowOrigin = config?.automationTarget === 'railway' ? 'railway' : 'local';
  const persona = config?.engagementAgent?.persona ?? null;
  const personaSub = persona ? (persona.length > 42 ? `${persona.slice(0, 39)}…` : persona) : 'no persona set yet';
  // Partial hand-edited configs happen — a messages-only autoReplies must
  // never 500 the automations API. Optional chain every leaf.
  const escalate = config?.autoReplies?.comments?.escalate ?? config?.autoReplies?.messages?.escalate ?? [];
  const flows: Flow[] = [];

  const comments = config?.autoReplies?.comments;
  {
    const stats = statsFrom(entries, (e) => REPLY_ACTIONS.has(e.action));
    flows.push({
      id: 'reply-to-comments',
      name: 'Auto-reply to comments',
      origin,
      enabled: Boolean(comments?.enabled),
      nodes: [
        { kind: 'trigger', icon: '⚡', label: 'New comment', sub: comments?.platforms?.join(', ') || 'no platforms yet' },
        { kind: 'action', icon: '✦', label: 'Reply in persona', sub: personaSub },
        { kind: 'filter', icon: '⚑', label: 'Escalation gate', sub: escalate.length ? escalate.join(', ') : 'defaults' },
        { kind: 'outcome', icon: '➤', label: 'Reply posted' },
      ],
      stats,
      health: flowHealth(Boolean(comments?.enabled), stats),
      detail: config?.autoReplies?.comments?.tone ?? undefined,
    });
  }

  const messages = config?.autoReplies?.messages;
  {
    const stats = statsFrom(entries, (e) => e.action === 'send_message');
    flows.push({
      id: 'reply-to-messages',
      name: 'Auto-reply to messages (DMs)',
      origin,
      enabled: Boolean(messages?.enabled),
      nodes: [
        { kind: 'trigger', icon: '⚡', label: 'New DM', sub: messages?.platforms?.join(', ') || 'no platforms yet' },
        { kind: 'action', icon: '✦', label: 'Reply in persona', sub: personaSub },
        { kind: 'filter', icon: '⚑', label: 'Escalation gate', sub: escalate.length ? escalate.join(', ') : 'defaults' },
        { kind: 'outcome', icon: '➤', label: 'Message sent' },
      ],
      stats,
      health: flowHealth(Boolean(messages?.enabled), stats),
      detail: config?.autoReplies?.messages?.tone ?? undefined,
    });
  }

  return flows;
}

/**
 * Cloud funnel flows. Built from LIVE CreatorOS automations when the API
 * returns them (truth), falling back to the local config otherwise.
 */
export interface LiveFunnel {
  id: string;
  name: string;
  platform?: string;
  keywords: string[];
  isActive: boolean;
}

export function funnelFlows(
  config: SocialAgentsConfig | null,
  live: LiveFunnel[],
  statsById: Map<string, FlowStats>,
): Flow[] {
  const link = config?.funnel?.link ?? null;
  const dm = config?.funnel?.dmMessage || null;
  const toFlow = (id: string, name: string, keywords: string[], enabled: boolean, platform?: string): Flow => {
    const stats = statsById.get(id) ?? { ...EMPTY_STATS };
    return {
      id,
      name,
      origin: 'cloud',
      enabled,
      nodes: [
        { kind: 'trigger', icon: '⚡', label: 'Comment contains', sub: keywords.map((k) => `"${k}"`).join(', ') || 'any keyword' },
        { kind: 'filter', icon: '⊞', label: platform ? platform : 'Instagram / Facebook' },
        { kind: 'action', icon: '➤', label: 'Auto-DM', sub: dm ? (dm.length > 42 ? `${dm.slice(0, 39)}…` : dm) : 'saved DM copy' },
        { kind: 'outcome', icon: '✓', label: 'Lead captured', sub: link ?? undefined },
      ],
      stats,
      health: flowHealth(enabled, stats),
      detail: dm ?? undefined,
    };
  };

  if (live.length > 0) {
    return live.map((f) => toFlow(f.id, f.name || 'Comments → DM funnel', f.keywords, f.isActive, f.platform));
  }
  return [toFlow('comment-dm-funnel', 'Comments → DM funnel', config?.funnel?.keywords ?? [], Boolean(config?.funnel?.enabled))];
}

/**
 * Scheduled cron flows, parsed from `creatoros automations:list` output.
 * Known starter crons get their full shape; anything else found in the
 * output gets a generic schedule→run node pair (never silently dropped).
 */
export function cronFlows(listOutput: string, config: SocialAgentsConfig | null, entries: ActivityEntry[]): Flow[] {
  const origin: FlowOrigin = config?.automationTarget === 'railway' ? 'railway' : 'local';
  const listed = listOutput.toLowerCase();
  const flows: Flow[] = [];
  const OUTCOMES: Record<string, FlowNode> = {
    content: { kind: 'outcome', icon: '➤', label: 'Posted', sub: 'TikTok, Reels, Shorts' },
    calendar: { kind: 'outcome', icon: '➤', label: 'Week scheduled', sub: 'CreatorOS servers publish' },
    engagement: { kind: 'outcome', icon: '➤', label: 'Replies + escalations' },
    analytics: { kind: 'outcome', icon: '➤', label: 'Report delivered' },
  };

  for (const cron of STARTER_CRONS) {
    if (!listed.includes(cron.name.toLowerCase())) continue;
    const stats = statsFrom(entries, (e) => e.workflow === cron.name || e.workflow === cron.skill);
    flows.push({
      id: cron.name,
      name: cron.name,
      origin,
      enabled: true,
      nodes: [
        { kind: 'trigger', icon: '↻', label: 'Schedule', sub: describeSchedule(cron.schedule) },
        { kind: 'action', icon: '⚙', label: cron.skill, sub: 'agent runs the playbook' },
        OUTCOMES[cron.pillar]!,
      ],
      stats,
      health: flowHealth(true, stats),
      detail: cron.description,
    });
  }
  return flows;
}

/** Merge local activity entries and cloud funnel runs into one feed, newest first. */
export function mergeRuns(local: FlowRun[], cloud: FlowRun[], limit = 40): FlowRun[] {
  return [...local, ...cloud].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, limit);
}
