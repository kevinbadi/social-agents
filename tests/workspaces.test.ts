import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRootIndexMd } from '../src/onboarding/render.js';
import { findWorkspace, listWorkspaces, migrateToWorkspaces, resolveWorkerRoot, slugify } from '../src/workspaces.js';

async function repo(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'social-agents-repo-'));
}

async function addWorkspace(root: string, slug: string, name: string, workspaceId: string): Promise<void> {
  const dir = join(root, 'workspaces', slug, 'social-agents');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'social-agents.json'), JSON.stringify({ version: 1, automationTarget: 'local', timezone: 'UTC', workspaceId, workspaceName: name }));
}

describe('workspace registry (one CreatorOS API key = one folder)', () => {
  it('lists set-up workspaces by name, skipping folders without a config', async () => {
    const root = await repo();
    await addWorkspace(root, 'zebra-co', 'Zebra Co', 'ws-z');
    await addWorkspace(root, 'acme-fitness', 'Acme Fitness', 'ws-a');
    await mkdir(join(root, 'workspaces', 'half-made'), { recursive: true });
    const list = await listWorkspaces(root);
    expect(list.map((w) => w.name)).toEqual(['Acme Fitness', 'Zebra Co']);
    expect(list[0]).toMatchObject({ slug: 'acme-fitness', workspaceId: 'ws-a', root: join(root, 'workspaces', 'acme-fitness') });
  });

  it('no workspaces folder means no workspaces (first run)', async () => {
    expect(await listWorkspaces(await repo())).toEqual([]);
  });

  it('slugs are folder-safe and unique', () => {
    expect(slugify('creator OS socials')).toBe('creator-os-socials');
    expect(slugify('Café & Co!!')).toBe('cafe-co');
    expect(slugify('Acme', ['acme', 'acme-2'])).toBe('acme-3');
    expect(slugify('***')).toBe('workspace');
  });

  it('finds a workspace by slug or by name, case-insensitively', async () => {
    const root = await repo();
    await addWorkspace(root, 'acme-fitness', 'Acme Fitness', 'ws-a');
    const list = await listWorkspaces(root);
    expect(findWorkspace(list, 'acme-fitness')?.slug).toBe('acme-fitness');
    expect(findWorkspace(list, 'ACME FITNESS')?.slug).toBe('acme-fitness');
    expect(findWorkspace(list, 'bolt')).toBeUndefined();
  });

  it('moves a pre-workspace repo (social-agents/ at the root) into workspaces/<name>/', async () => {
    const root = await repo();
    await mkdir(join(root, 'social-agents'), { recursive: true });
    await writeFile(join(root, 'social-agents', 'social-agents.json'), JSON.stringify({ version: 1, workspaceName: 'Old Brand' }));
    await writeFile(join(root, 'social-agents', 'BRAND.md'), '# Brand Pack');
    await mkdir(join(root, 'logs'));
    await writeFile(join(root, 'CLAUDE.md'), 'old brief');
    const moved = migrateToWorkspaces(root);
    expect(moved).toBe(join(root, 'workspaces', 'old-brand'));
    expect(await readFile(join(moved!, 'social-agents', 'BRAND.md'), 'utf8')).toBe('# Brand Pack');
    expect(existsSync(join(moved!, 'logs'))).toBe(true);
    expect(existsSync(join(moved!, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(root, 'social-agents'))).toBe(false);
    expect(migrateToWorkspaces(root)).toBeNull(); // idempotent
  });

  it('the repo-root brief lists every workspace and says to work in one at a time', () => {
    const md = renderRootIndexMd([
      { slug: 'acme-fitness', name: 'Acme Fitness' },
      { slug: 'bolt-coffee', name: 'Bolt Coffee' },
    ]);
    expect(md).toContain('| Acme Fitness | `workspaces/acme-fitness/` |');
    expect(md).toContain('| Bolt Coffee | `workspaces/bolt-coffee/` |');
    expect(md).toMatch(/ONE workspace at a time/);
    expect(md.replace(/\s+/g, " ")).toMatch(/Never carry a caption, account ID, or setting from one workspace into another/);
    expect(md).toContain('npm start creatoros add');
  });
});

describe('worker picks exactly one workspace', () => {
  it('uses SOCIAL_AGENTS_WORKSPACE, or the lone workspace', async () => {
    const root = await repo();
    await addWorkspace(root, 'acme-fitness', 'Acme Fitness', 'ws-a');
    expect(await resolveWorkerRoot(root, undefined)).toBe(join(root, 'workspaces', 'acme-fitness'));
    await addWorkspace(root, 'bolt-coffee', 'Bolt Coffee', 'ws-b');
    expect(await resolveWorkerRoot(root, 'bolt-coffee')).toBe(join(root, 'workspaces', 'bolt-coffee'));
  });

  it('refuses to guess between several, and rejects an unknown name', async () => {
    const root = await repo();
    await addWorkspace(root, 'acme-fitness', 'Acme Fitness', 'ws-a');
    await addWorkspace(root, 'bolt-coffee', 'Bolt Coffee', 'ws-b');
    await expect(resolveWorkerRoot(root, undefined)).rejects.toThrow(/set SOCIAL_AGENTS_WORKSPACE/);
    await expect(resolveWorkerRoot(root, 'nope')).rejects.toThrow(/matches no folder/);
  });
});

describe('a session can only use its own workspace key', () => {
  const saved = { HOME: process.env.HOME, KEY: process.env.CREATOROS_API_KEY };
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'social-agents-home-'));
    process.env.HOME = home;
    delete process.env.CREATOROS_API_KEY;
  });
  afterEach(() => {
    process.env.HOME = saved.HOME;
    if (saved.KEY === undefined) delete process.env.CREATOROS_API_KEY;
    else process.env.CREATOROS_API_KEY = saved.KEY;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function freshModules() {
    vi.resetModules();
    const credentials = await import('../src/config/credentials.js');
    const workspaces = await import('../src/workspaces.js');
    return { ...credentials, ...workspaces };
  }

  function stubMe(workspace: { id: string; name: string }) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: { id: 'u' }, workspace }), { status: 200 })));
  }

  it('resolves the key saved for that workspace, over a global CREATOROS_API_KEY', async () => {
    const m = await freshModules();
    await m.saveWorkspaceKey({ workspaceId: 'ws-a', name: 'Acme', apiKey: 'cos_live_' + 'a'.repeat(32) });
    await m.saveWorkspaceKey({ workspaceId: 'ws-b', name: 'Bolt', apiKey: 'cos_live_' + 'b'.repeat(32) });
    process.env.CREATOROS_API_KEY = 'cos_live_' + 'e'.repeat(32);
    expect(await m.resolveApiKey('ws-a')).toBe('cos_live_' + 'a'.repeat(32));
    expect(await m.resolveApiKey('ws-b')).toBe('cos_live_' + 'b'.repeat(32));
    // A workspace with no saved key (e.g. the Railway worker) uses the env var.
    expect(await m.resolveApiKey('ws-c')).toBe('cos_live_' + 'e'.repeat(32));
  });

  it('re-saving a workspace replaces its key and keeps the others', async () => {
    const m = await freshModules();
    await m.saveWorkspaceKey({ workspaceId: 'ws-a', name: 'Acme', apiKey: 'cos_live_' + 'a'.repeat(32) });
    await m.saveWorkspaceKey({ workspaceId: 'ws-b', name: 'Bolt', apiKey: 'cos_live_' + 'b'.repeat(32) });
    await m.saveWorkspaceKey({ workspaceId: 'ws-a', name: 'Acme', apiKey: 'cos_live_' + 'z'.repeat(32) });
    const keys = await m.savedWorkspaceKeys();
    expect(keys.map((k) => k.workspaceId).sort()).toEqual(['ws-a', 'ws-b']);
    expect(await m.resolveApiKey('ws-a')).toBe('cos_live_' + 'z'.repeat(32));
  });

  it('opens the client when CreatorOS confirms the key is this workspace', async () => {
    const m = await freshModules();
    await m.saveWorkspaceKey({ workspaceId: 'ws-a', name: 'Acme', apiKey: 'cos_live_' + 'a'.repeat(32) });
    stubMe({ id: 'ws-a', name: 'Acme' });
    const client = await m.clientForWorkspace({ slug: 'acme', name: 'Acme', workspaceId: 'ws-a', root: '/x' });
    expect(client.maskedKey).toBe('cos_live_...aaaa');
  });

  it('refuses a key that belongs to another workspace, before any other call', async () => {
    const m = await freshModules();
    process.env.CREATOROS_API_KEY = 'cos_live_' + 'b'.repeat(32);
    stubMe({ id: 'ws-b', name: 'Bolt Coffee' });
    await expect(m.clientForWorkspace({ slug: 'acme', name: 'Acme', workspaceId: 'ws-a', root: '/x' })).rejects.toThrow(
      /belongs to "Bolt Coffee", not "Acme"/,
    );
  });

  it('says how to add a workspace that has no key at all', async () => {
    const m = await freshModules();
    await expect(m.clientForWorkspace({ slug: 'acme', name: 'Acme', workspaceId: 'ws-a', root: '/x' })).rejects.toThrow(
      /npm start creatoros add/,
    );
  });
});
