import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextRun, parseCron } from '../src/worker/schedule.js';
import { isTransientError } from '../src/worker/runner.js';
import { authorized } from '../src/worker/server.js';
import {
  loadWorkerAutomations,
  removeWorkerAutomation,
  upsertWorkerAutomation,
} from '../src/worker/automations.js';
import { createAutomation, verifyAutomations } from '../src/automations/crons.js';
import type { IncomingMessage } from 'node:http';

// nextRun works in the process's local time on purpose (the worker runs
// with TZ set to the user's zone) — so tests build and assert LOCAL dates.
const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi);
const stamp = (date: Date) =>
  `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

describe('cron schedule math (local time)', () => {
  it('daily at 10:00', () => {
    expect(stamp(nextRun('0 10 * * *', local(2026, 7, 18, 9, 59)))).toBe('2026-7-18 10:00');
    expect(stamp(nextRun('0 10 * * *', local(2026, 7, 18, 10, 0)))).toBe('2026-7-19 10:00');
  });

  it('list of hours (engagement-sweep: 9,15,21)', () => {
    expect(stamp(nextRun('0 9,15,21 * * *', local(2026, 7, 18, 9, 0)))).toBe('2026-7-18 15:00');
    expect(stamp(nextRun('0 9,15,21 * * *', local(2026, 7, 18, 22, 0)))).toBe('2026-7-19 9:00');
  });

  it('day-of-week (Sunday 17:00) — 2026-07-18 is a Saturday', () => {
    expect(stamp(nextRun('0 17 * * 0', local(2026, 7, 18, 12, 0)))).toBe('2026-7-19 17:00');
  });

  it('day 7 normalizes to Sunday, steps and ranges work', () => {
    expect(stamp(nextRun('0 17 * * 7', local(2026, 7, 18, 12, 0)))).toBe('2026-7-19 17:00');
    expect(stamp(nextRun('*/15 * * * *', local(2026, 7, 18, 10, 7)))).toBe('2026-7-18 10:15');
    expect(stamp(nextRun('0 9-11 * * *', local(2026, 7, 18, 10, 30)))).toBe('2026-7-18 11:00');
  });

  it('rejects malformed expressions loudly', () => {
    expect(() => parseCron('0 10 * *')).toThrow(/5 fields/);
    expect(() => parseCron('0 25 * * *')).toThrow(/hour/);
    expect(() => parseCron('0 10 * * MON')).toThrow(/day-of-week/);
  });
});

describe('transient error classification (retry once, not forever)', () => {
  it('flags rate limits, 5xx, network blips, timeouts', () => {
    for (const message of [
      'Rate limit exceeded, retry after 60s',
      'CreatorOS request failed (503)',
      'fetch failed: ECONNRESET',
      'request timed out',
      'Overloaded',
    ]) {
      expect(isTransientError(message)).toBe(true);
    }
  });

  it('does not flag real bugs as transient', () => {
    for (const message of [
      'A funnel needs a DM message — that is the whole point of the funnel.',
      "That endpoint isn't part of CreatorOS.",
      'Comment replies are not supported on TikTok',
    ]) {
      expect(isTransientError(message)).toBe(false);
    }
  });
});

describe('worker automations file + pathway integration', () => {
  it('upserts, lists, and removes automations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'midas-worker-'));
    await upsertWorkerAutomation(root, { name: 'engagement-sweep', schedule: '0 9,15,21 * * *', skill: 'respond-to-comments', enabled: true, model: 'claude-haiku-4-5-20251001' });
    await upsertWorkerAutomation(root, { name: 'weekly-analytics', schedule: '0 8 * * 1', skill: 'analytics-report', enabled: true });
    await upsertWorkerAutomation(root, { name: 'engagement-sweep', schedule: '0 9 * * *', skill: 'respond-to-comments', enabled: false });
    const automations = await loadWorkerAutomations(root);
    expect(automations).toHaveLength(2);
    expect(automations.find((a) => a.name === 'engagement-sweep')?.schedule).toBe('0 9 * * *');
    await removeWorkerAutomation(root, 'weekly-analytics');
    expect(await loadWorkerAutomations(root)).toHaveLength(1);
  });

  it('rejects a bad schedule before anything lands on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'midas-worker-'));
    await expect(
      upsertWorkerAutomation(root, { name: 'x', schedule: 'every day', skill: 's', enabled: true }),
    ).rejects.toThrow();
    expect(await loadWorkerAutomations(root)).toEqual([]);
  });

  it('createAutomation on the railway pathway writes the file — no CLI, no network', async () => {
    const root = await mkdtemp(join(tmpdir(), 'midas-worker-'));
    const result = await createAutomation(
      root,
      { name: 'daily-shortform', schedule: '0 10 * * *', skill: 'post-shortform', pillar: 'content', description: 'daily clip' },
      'railway',
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('automations.json');
    const listed = await verifyAutomations(root, 'railway');
    expect(listed.stdout).toContain('daily-shortform');
    expect(listed.stdout).toContain('0 10 * * *');
  });
});

describe('worker HTTP auth', () => {
  const req = (header?: string) => ({ headers: { authorization: header } }) as unknown as IncomingMessage;
  it('requires the exact bearer token when one is set', () => {
    expect(authorized(req('Bearer secret'), 'secret')).toBe(true);
    expect(authorized(req('Bearer wrong'), 'secret')).toBe(false);
    expect(authorized(req(undefined), 'secret')).toBe(false);
  });
  it('is open only when no token is configured', () => {
    expect(authorized(req(undefined), undefined)).toBe(true);
  });
});
