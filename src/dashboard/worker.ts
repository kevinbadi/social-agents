/**
 * Dashboard-side client for the Railway worker's status surface, plus the
 * pure mapping from worker run records to the flow view's shapes. The
 * fetch degrades to { reachable: false } on any failure — the automations
 * page renders the worker as unreachable, everything else still works.
 */
import type { RunRecord } from '../storage/store.js';
import type { WorkerHealth } from '../worker/server.js';
import type { WorkerAutomation } from '../worker/automations.js';
import type { ActivityEntry } from '../util/activityLog.js';
import { EMPTY_STATS, flowHealth, type Flow, type FlowRun, type FlowStats } from './flows.js';
import { describeSchedule } from './workflows.js';

export interface WorkerState {
  configured: boolean;
  reachable: boolean;
  health: WorkerHealth | null;
  runs: RunRecord[];
  /** The worker's per-action activity log — merged into the overview. */
  activity: ActivityEntry[];
}

export async function fetchWorkerState(
  url: string | undefined,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkerState> {
  if (!url) return { configured: false, reachable: false, health: null, runs: [], activity: [] };
  const base = url.replace(/\/+$/, '');
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const [healthRes, runsRes, activityRes] = await Promise.all([
      fetchImpl(`${base}/health`, { headers }),
      fetchImpl(`${base}/runs?limit=60`, { headers }),
      fetchImpl(`${base}/activity?limit=1000`, { headers }).catch(() => null),
    ]);
    if (!healthRes.ok || !runsRes.ok) return { configured: true, reachable: false, health: null, runs: [], activity: [] };
    const health = (await healthRes.json()) as WorkerHealth;
    const runsBody = (await runsRes.json()) as { runs?: RunRecord[] };
    let activity: ActivityEntry[] = [];
    if (activityRes?.ok) {
      const body = (await activityRes.json()) as { entries?: ActivityEntry[] };
      if (Array.isArray(body.entries)) activity = body.entries;
    }
    return { configured: true, reachable: true, health, runs: Array.isArray(runsBody.runs) ? runsBody.runs : [], activity };
  } catch {
    return { configured: true, reachable: false, health: null, runs: [], activity: [] };
  }
}

/** Worker run records → per-automation FlowStats. */
export function workerRunStats(runs: RunRecord[], automation: string): FlowStats {
  const stats: FlowStats = { ...EMPTY_STATS };
  for (const run of runs) {
    if (run.automation !== automation) continue;
    if (!stats.lastTs) {
      stats.lastTs = run.finishedAt ?? run.startedAt;
      stats.lastOutcome = run.status === 'ok' ? 'ok' : run.status;
    }
    if (run.status === 'ok') stats.sent++;
    else if (run.status === 'skipped') stats.skipped++;
    else if (run.status === 'failed') stats.failed++;
  }
  return stats;
}

/**
 * Flows for the worker's scheduled automations — the Railway pathway's
 * answer to cronFlows, built from social-agents/automations.json + the worker's
 * own run journal (real outcomes, not inferred from the activity log).
 */
export function workerCronFlows(automations: WorkerAutomation[], runs: RunRecord[]): Flow[] {
  return automations.map((automation) => {
    const stats = workerRunStats(runs, automation.name);
    const lastFailed = runs.find((r) => r.automation === automation.name && r.status === 'failed');
    return {
      id: `worker-${automation.name}`,
      name: automation.name,
      origin: 'railway' as const,
      enabled: automation.enabled,
      nodes: [
        { kind: 'trigger' as const, icon: '↻', label: 'Schedule', sub: describeSchedule(automation.schedule) },
        { kind: 'action' as const, icon: '⚙', label: automation.skill, sub: automation.model ?? 'agent runs the playbook' },
        { kind: 'outcome' as const, icon: '➤', label: 'Run journaled', sub: 'worker reports the outcome' },
      ],
      stats,
      health: flowHealth(automation.enabled, stats),
      lastError: lastFailed?.error,
      detail: automation.description,
    };
  });
}

/** Worker runs → rows in the merged executions feed. */
export function workerFlowRuns(runs: RunRecord[]): FlowRun[] {
  return runs
    .filter((run) => run.status !== 'running')
    .map((run) => ({
      ts: run.finishedAt ?? run.startedAt,
      flow: run.automation,
      origin: 'railway' as const,
      action: run.skill,
      outcome: run.status,
      target: run.summary ? (run.summary.length > 80 ? `${run.summary.slice(0, 77)}…` : run.summary) : undefined,
      error: run.error,
    }));
}
