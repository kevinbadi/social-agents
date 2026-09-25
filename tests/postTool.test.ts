import { describe, expect, it, vi } from 'vitest';
import { CreatorOSClient } from '../src/client/client.js';
import { buildToolRegistry } from '../src/agent/registry.js';
import type { SocialAgentsConfig } from '../src/config/socialAgentsConfig.js';

const KEY = 'cos_live_' + 'p'.repeat(32);
const config = { version: 1, automationTarget: 'local', timezone: 'America/Toronto' } as SocialAgentsConfig;
const ACCOUNTS = {
  accounts: [
    { id: 'acc_ig-1', platform: 'instagram', username: 'brand', isActive: true },
    { id: 'acc_tt-1', platform: 'tiktok', username: 'brand', isActive: true },
  ],
};

function setup(routes: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ method: String(init.method), path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const reply = routes[`${init.method} ${path}`] ?? { id: 'post_new', status: 'scheduled' };
    return new Response(JSON.stringify(reply), { status: 200 });
  });
  const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: impl as unknown as typeof fetch });
  const tools = buildToolRegistry(client, '/tmp/workspace', config);
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  return { calls, tool };
}

describe('create_post tool', () => {
  it('sends the simple form with cover and the configured timezone', async () => {
    const { calls, tool } = setup();
    const out = await tool('create_post').handler({
      content: 'New drop',
      platforms: ['instagram', 'tiktok'],
      media: ['med_vid'],
      cover: 'med_cover',
      schedule_at: '2026-10-01T09:00:00',
    });
    expect(out.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/v1/posts' });
    expect(calls[0]!.body).toEqual({
      content: 'New drop',
      platforms: ['instagram', 'tiktok'],
      media: ['med_vid'],
      cover: 'med_cover',
      schedule_at: '2026-10-01T09:00:00',
      timezone: 'America/Toronto',
    });
  });

  it('passes cover_timestamp_ms and the advanced form through', async () => {
    const { calls, tool } = setup();
    await tool('create_post').handler({
      targets: [{ platform: 'youtube', account_id: 'acc_yt-1', options: { title: 'Launch', visibility: 'unlisted' } }],
      media: ['med_vid'],
      cover_timestamp_ms: 1500,
      queuedFromProfile: true,
    });
    expect(calls[0]!.body).toMatchObject({
      platforms: [{ platform: 'youtube', account_id: 'acc_yt-1', options: { title: 'Launch', visibility: 'unlisted' } }],
      cover_timestamp_ms: 1500,
      queuedFromProfile: true,
    });
  });

  it('pins simple-form drafts to account ids (drafts otherwise save with no targets)', async () => {
    const { calls, tool } = setup({ 'GET /v1/accounts': ACCOUNTS });
    await tool('create_post').handler({ content: 'Draft', platforms: ['ig', 'tiktok'], draft: true });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v1/accounts', 'POST /v1/posts']);
    expect((calls[1]!.body as { platforms: unknown }).platforms).toEqual([
      { platform: 'instagram', account_id: 'acc_ig-1' },
      { platform: 'tiktok', account_id: 'acc_tt-1' },
    ]);
  });

  it('refuses a draft for a network that is not connected, without posting', async () => {
    const { calls, tool } = setup({ 'GET /v1/accounts': ACCOUNTS });
    const out = await tool('create_post').handler({ content: 'Draft', platforms: ['linkedin'], draft: true });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/No connected linkedin account/);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('requires exactly one of platforms or targets', async () => {
    const { calls, tool } = setup();
    expect((await tool('create_post').handler({ content: 'x' })).isError).toBe(true);
    expect(
      (await tool('create_post').handler({ content: 'x', platforms: ['instagram'], targets: [{ platform: 'instagram', account_id: 'acc_ig-1' }] })).isError,
    ).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('surfaces the error envelope message to the agent', async () => {
    const impl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_request', message: 'schedule_at must be in the future.', status: 400 } }), { status: 400 }));
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: impl as unknown as typeof fetch });
    const tool = buildToolRegistry(client, '/tmp/workspace', config).find((t) => t.name === 'create_post')!;
    const out = await tool.handler({ content: 'x', platforms: ['instagram'], schedule_at: '2020-01-01T00:00:00Z' });
    expect(out).toEqual({ text: 'Error: schedule_at must be in the future.', isError: true });
  });
});

describe('workspace tool', () => {
  it('get_workspace reads /v1/me (there are no profiles)', async () => {
    const { calls, tool } = setup({ 'GET /v1/me': { user: { id: 'u1' }, workspace: { id: 'ws1', name: 'Brand', ready: true } } });
    const out = await tool('get_workspace').handler({});
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/v1/me' });
    expect(out.text).toContain('"ws1"');
  });
});
