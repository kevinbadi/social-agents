import { describe, expect, it, vi } from 'vitest';
import { fetchWorkerState, workerCronFlows, workerFlowRuns, workerRunStats } from '../src/dashboard/worker.js';
import { deployLooksBroken, fetchRailwayDeploy } from '../src/dashboard/railway.js';
import type { RunRecord } from '../src/storage/store.js';

const RUNS: RunRecord[] = [
  { id: 'a', automation: 'engagement-sweep', skill: 'respond-to-comments', startedAt: '2026-07-18T09:00:00Z', finishedAt: '2026-07-18T09:04:00Z', status: 'ok', summary: '4 replies, 1 escalation', source: 'worker' },
  { id: 'b', automation: 'engagement-sweep', skill: 'respond-to-comments', startedAt: '2026-07-18T15:00:00Z', finishedAt: '2026-07-18T15:01:00Z', status: 'failed', error: 'rate limit', source: 'worker' },
  { id: 'c', automation: 'weekly-analytics', skill: 'analytics-report', startedAt: '2026-07-18T08:00:00Z', status: 'running', source: 'worker' },
];

describe('worker → flow view mapping', () => {
  it('computes per-automation stats from the run journal', () => {
    const stats = workerRunStats(RUNS, 'engagement-sweep');
    expect(stats).toMatchObject({ sent: 1, failed: 1, lastTs: '2026-07-18T09:04:00Z' });
  });

  it('builds railway-origin flows and surfaces the last error', () => {
    const flows = workerCronFlows(
      [{ name: 'engagement-sweep', schedule: '0 9,15,21 * * *', skill: 'respond-to-comments', enabled: true, model: 'claude-haiku-4-5-20251001' }],
      RUNS,
    );
    expect(flows).toHaveLength(1);
    expect(flows[0]!.origin).toBe('railway');
    expect(flows[0]!.lastError).toBe('rate limit');
    expect(flows[0]!.nodes[1]!.sub).toBe('claude-haiku-4-5-20251001');
  });

  it('maps finished runs into the executions feed, skipping in-flight ones', () => {
    const feed = workerFlowRuns(RUNS);
    expect(feed).toHaveLength(2);
    expect(feed.every((r) => r.origin === 'railway')).toBe(true);
    expect(feed.find((r) => r.outcome === 'failed')?.error).toBe('rate limit');
  });
});

describe('worker state fetch degrades, never breaks', () => {
  it('unconfigured → not configured, no fetch', async () => {
    const impl = vi.fn();
    const state = await fetchWorkerState(undefined, undefined, impl as unknown as typeof fetch);
    expect(state).toMatchObject({ configured: false, reachable: false });
    expect(impl).not.toHaveBeenCalled();
  });

  it('healthy worker → reachable with runs, and the token travels as a bearer header', async () => {
    const impl = vi.fn(async (url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(String(url).endsWith('/runs?limit=60') ? { runs: RUNS } : { service: 'midas-worker', automations: [], running: null, startedAt: 'x', timezone: 'UTC' }), { status: 200 }));
    const state = await fetchWorkerState('https://w.example', 'tok', impl as unknown as typeof fetch);
    expect(state.reachable).toBe(true);
    expect(state.runs).toHaveLength(3);
    const headers = (impl.mock.calls[0]![1] as { headers: Record<string, string> } | undefined)?.headers;
    expect(headers?.Authorization).toBe('Bearer tok');
  });

  it('network failure → configured but unreachable', async () => {
    const impl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const state = await fetchWorkerState('https://w.example', undefined, impl as unknown as typeof fetch);
    expect(state).toMatchObject({ configured: true, reachable: false });
  });
});

describe('partial configs never crash the flow view', () => {
  it('a messages-only autoReplies renders both engagement flows', async () => {
    const { engagementFlows } = await import('../src/dashboard/flows.js');
    const config = {
      version: 1 as const,
      automationTarget: 'railway' as const,
      timezone: 'UTC',
      // hand-edited config: comments block missing entirely
      autoReplies: { messages: { enabled: true, platforms: ['instagram'], escalate: ['refunds'] } },
    };
    const flows = engagementFlows(config as never, []);
    expect(flows).toHaveLength(2);
    expect(flows.find((f) => f.id === 'reply-to-messages')?.enabled).toBe(true);
    expect(flows.find((f) => f.id === 'reply-to-comments')?.enabled).toBe(false);
  });
});

describe('railway deploy status', () => {
  it('parses the deployments query response', async () => {
    const impl = vi.fn(async () =>
      new Response(JSON.stringify({ data: { deployments: { edges: [{ node: { status: 'SUCCESS', createdAt: '2026-07-18T00:00:00Z', staticUrl: 'w.up.railway.app' } }] } } }), { status: 200 }));
    const deploy = await fetchRailwayDeploy('tok', 'svc1', impl as unknown as typeof fetch);
    expect(deploy).toEqual({ status: 'SUCCESS', createdAt: '2026-07-18T00:00:00Z', url: 'https://w.up.railway.app' });
  });

  it('no token or service id → null, no call; API errors → null', async () => {
    const impl = vi.fn(async () => new Response('{}', { status: 500 }));
    expect(await fetchRailwayDeploy(undefined, 'svc', impl as unknown as typeof fetch)).toBe(null);
    expect(impl).not.toHaveBeenCalled();
    expect(await fetchRailwayDeploy('tok', 'svc', impl as unknown as typeof fetch)).toBe(null);
  });

  it('classifies broken deploy states', () => {
    expect(deployLooksBroken('CRASHED')).toBe(true);
    expect(deployLooksBroken('FAILED')).toBe(true);
    expect(deployLooksBroken('SUCCESS')).toBe(false);
    expect(deployLooksBroken('DEPLOYING')).toBe(false);
  });
});
