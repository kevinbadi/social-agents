import { describe, expect, it } from 'vitest';
import { mkdtemp, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlStore, runsLogPath } from '../src/storage/jsonlStore.js';
import type { RunRecord } from '../src/storage/store.js';

async function tmpRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'social-agents-store-'));
}

const run = (overrides: Partial<RunRecord>): RunRecord => ({
  id: 'r1',
  automation: 'engagement-sweep',
  skill: 'respond-to-comments',
  startedAt: '2026-07-18T09:00:00Z',
  status: 'running',
  source: 'worker',
  ...overrides,
});

describe('JsonlStore runs journal', () => {
  it('upserts by id — the finish line wins over the start line', async () => {
    const store = new JsonlStore(await tmpRoot());
    await store.recordRun(run({ status: 'running' }));
    await store.recordRun(run({ status: 'ok', finishedAt: '2026-07-18T09:03:00Z', summary: '4 replies' }));
    const runs = await store.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('ok');
    expect(runs[0]!.summary).toBe('4 replies');
  });

  it('lists newest first and filters by automation and status', async () => {
    const store = new JsonlStore(await tmpRoot());
    await store.recordRun(run({ id: 'a', startedAt: '2026-07-18T08:00:00Z', status: 'ok' }));
    await store.recordRun(run({ id: 'b', startedAt: '2026-07-18T09:00:00Z', status: 'failed', error: 'boom' }));
    await store.recordRun(run({ id: 'c', automation: 'weekly-analytics', skill: 'analytics-report', startedAt: '2026-07-18T10:00:00Z', status: 'ok' }));
    const all = await store.listRuns();
    expect(all.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect((await store.listRuns({ automation: 'engagement-sweep' })).map((r) => r.id)).toEqual(['b', 'a']);
    expect((await store.listRuns({ status: 'failed' }))[0]!.error).toBe('boom');
  });

  it('skips corrupt lines instead of failing the read', async () => {
    const root = await tmpRoot();
    const store = new JsonlStore(root);
    await store.recordRun(run({ id: 'good', status: 'ok' }));
    await appendFile(runsLogPath(root), 'not json at all\n{"id":\n', 'utf8');
    await store.recordRun(run({ id: 'later', startedAt: '2026-07-18T11:00:00Z', status: 'ok' }));
    const runs = await store.listRuns();
    expect(runs.map((r) => r.id)).toEqual(['later', 'good']);
  });

  it('returns empty on a missing file', async () => {
    const store = new JsonlStore(await tmpRoot());
    expect(await store.listRuns()).toEqual([]);
    expect(await store.listContentItems()).toEqual([]);
  });
});

describe('JsonlStore content pipeline', () => {
  it('upserts items through status transitions, newest updatedAt first', async () => {
    const store = new JsonlStore(await tmpRoot());
    const base = { id: 'v1', title: 'Gym clip #1', createdAt: '2026-07-18T08:00:00Z' };
    await store.saveContentItem({ ...base, status: 'draft', updatedAt: '2026-07-18T08:00:00Z' });
    await store.saveContentItem({ ...base, status: 'approved', updatedAt: '2026-07-18T09:00:00Z' });
    await store.saveContentItem({ id: 'v2', title: 'Gym clip #2', status: 'draft', createdAt: '2026-07-18T08:30:00Z', updatedAt: '2026-07-18T08:30:00Z' });
    const items = await store.listContentItems();
    expect(items.map((i) => i.id)).toEqual(['v1', 'v2']);
    expect(items[0]!.status).toBe('approved');
    expect((await store.listContentItems({ status: 'draft' })).map((i) => i.id)).toEqual(['v2']);
  });
});
