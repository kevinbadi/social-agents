import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIDAS_CAPABILITY_SECTIONS, showIntro } from '../src/ui/banner.js';

describe('first-run intro', () => {
  let lines: string[];
  beforeEach(() => {
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      lines.push(String(msg ?? ''));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('plays CreatorOS, Midas, the Claude brain link, then the capability checkmarks (plain fallback in non-TTY)', async () => {
    await showIntro();
    const output = lines.join('\n');
    const creatorosAt = output.indexOf('CREATOR OS');
    const midasAt = output.indexOf('MIDAS');
    const claudeAt = output.indexOf('Claude:');
    const checksAt = output.indexOf('✔');
    expect(creatorosAt).toBeGreaterThanOrEqual(0);
    expect(midasAt).toBeGreaterThan(creatorosAt);
    expect(claudeAt).toBeGreaterThan(midasAt);
    expect(checksAt).toBeGreaterThan(claudeAt);
    expect(output).toMatch(/Claude: (connected|not found)/);
    // every capability in every section gets its checkmark line
    for (const section of MIDAS_CAPABILITY_SECTIONS) {
      expect(output).toContain(section.heading);
      for (const item of section.items) {
        expect(output).toContain(`✔ ${item.name} — ${item.detail}`);
      }
    }
  });

  it('covers the capability surface: posting types, analytics, messaging matrix, agent skills', () => {
    const text = MIDAS_CAPABILITY_SECTIONS.map(
      (s) => `${s.heading} ${s.items.map((i) => `${i.name} ${i.detail}`).join(' ')}`,
    )
      .join(' ')
      .toLowerCase();
    // posting types
    for (const needle of ['shortform', 'longform', 'carousels', 'blog-style', 'threads', 'multiposting', 'scheduling']) {
      expect(text).toContain(needle);
    }
    // analytics
    expect(text).toContain('follower growth');
    expect(text).toContain('post analytics');
    // messaging & comments matrix
    expect(text).toContain('webhooks');
    expect(text).toContain('every platform but tiktok');
    expect(text).toContain('comment-to-dm');
    expect(text).toContain('facebook & instagram');
    // agent skills
    expect(text).toContain('kevbuildsapps');
    expect(text).toContain('tutorials');
    // branding
    expect(text).not.toMatch(/zernio/i);
    // not in this version
    expect(text).not.toMatch(/bluesky/i);
  });
});

describe('narrow terminals still get the CreatorOS animation', () => {
  it('stacks the words instead of dropping to plain text at 60 columns', async () => {
    const { showWordmark } = await import('../src/ui/banner.js');
    const stdout = process.stdout as unknown as { isTTY: boolean; columns: number };
    const saved = {
      isTTY: stdout.isTTY,
      columns: stdout.columns,
      ci: process.env.CI,
      noColor: process.env.NO_COLOR,
    };
    const writes: string[] = [];
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      stdout.isTTY = true;
      stdout.columns = 60; // narrower than the 78-col CREATOR OS mark
      delete process.env.CI;
      delete process.env.NO_COLOR;
      await showWordmark('CREATOR OS', 'the operating system for social media', [
        [0, 229, 255],
        [225, 232, 240],
        [56, 189, 248],
      ]);
      const output = writes.join('');
      // animated path taken: gradient frames rendered, no plain-text fallback
      expect(output).toContain('\x1b[38;2;');
      expect(output).toContain('█');
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      stdout.isTTY = saved.isTTY;
      stdout.columns = saved.columns;
      if (saved.ci !== undefined) process.env.CI = saved.ci;
      if (saved.noColor !== undefined) process.env.NO_COLOR = saved.noColor;
      writeSpy.mockRestore();
      logSpy.mockRestore();
    }
  }, 15000);
});

describe('wordmark font', () => {
  it('has a glyph for every letter of both wordmarks', async () => {
    const { showWordmark } = await import('../src/ui/banner.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      // non-TTY: plain fallback, but renderRows still runs and throws on a missing glyph
      await expect(showWordmark('CREATOR OS', 'x', [[0, 0, 0], [1, 1, 1]])).resolves.toBeUndefined();
      await expect(showWordmark('MIDAS', 'x', [[0, 0, 0], [1, 1, 1]])).resolves.toBeUndefined();
    } finally {
      logSpy.mockRestore();
    }
  });
});
