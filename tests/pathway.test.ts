import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultConfig,
  loadConfig,
  resolveAutomationTarget,
  saveConfig,
} from '../src/config/midasConfig.js';
import { automationCreateArgs, STARTER_CRONS } from '../src/automations/crons.js';

describe('automation pathway selection', () => {
  it('defaults to local', () => {
    expect(resolveAutomationTarget(null)).toBe('local');
    expect(resolveAutomationTarget(defaultConfig())).toBe('local');
  });

  it('persists and reloads the railway pathway from midas.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'midas-pathway-'));
    const path = join(dir, 'midas', 'midas.json');
    await saveConfig(path, { ...defaultConfig(), automationTarget: 'railway' });
    const loaded = await loadConfig(path);
    expect(resolveAutomationTarget(loaded)).toBe('railway');
  });

  it('returns null config when no setup exists yet', async () => {
    expect(await loadConfig('/nonexistent/midas.json')).toBeNull();
  });
});

describe('starter crons', () => {
  it('covers all four pillars', () => {
    const pillars = new Set(STARTER_CRONS.map((c) => c.pillar));
    expect(pillars).toEqual(new Set(['content', 'calendar', 'engagement', 'analytics']));
  });

  it('uses strict 5-field cron schedules (no names)', () => {
    for (const cron of STARTER_CRONS) {
      expect(cron.schedule.split(' ')).toHaveLength(5);
      expect(cron.schedule).not.toMatch(/[a-zA-Z@]/);
    }
  });

  it('builds local args without a target flag', () => {
    const cron = STARTER_CRONS[0]!;
    expect(automationCreateArgs(cron, 'local')).toEqual([
      'automations:create',
      cron.name,
      '--schedule',
      cron.schedule,
      '--skill',
      cron.skill,
    ]);
  });

  it('builds railway args with --target railway', () => {
    const cron = STARTER_CRONS[0]!;
    expect(automationCreateArgs(cron, 'railway')).toContain('--target');
    expect(automationCreateArgs(cron, 'railway')).toContain('railway');
  });
});
