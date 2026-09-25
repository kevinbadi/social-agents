import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const OURS = 'cos_live_' + 'o'.repeat(32);
const CLI = 'cos_live_' + 'c'.repeat(32);
const ENV = 'cos_test_' + 'e'.repeat(32);
const LEGACY = 'sk_' + 'ab'.repeat(32);

let home: string;
const saved = { HOME: process.env.HOME, KEY: process.env.CREATOROS_API_KEY, DIR: process.env.CREATOROS_CONFIG_DIR };

async function put(dir: string, file: string, data: unknown): Promise<void> {
  await mkdir(join(home, dir), { recursive: true });
  await writeFile(join(home, dir, file), JSON.stringify(data));
}

/** credentials.ts pins paths to the home dir at import, so import it fresh per test. */
async function resolve(): Promise<string | null> {
  vi.resetModules();
  const { resolveApiKey } = await import('../src/config/credentials.js');
  return resolveApiKey();
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'social-agents-home-'));
  process.env.HOME = home;
  delete process.env.CREATOROS_API_KEY;
  delete process.env.CREATOROS_CONFIG_DIR;
});

afterEach(() => {
  process.env.HOME = saved.HOME;
  for (const [name, value] of [['CREATOROS_API_KEY', saved.KEY], ['CREATOROS_CONFIG_DIR', saved.DIR]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('API key resolution order', () => {
  it('returns null when no key exists anywhere', async () => {
    expect(await resolve()).toBeNull();
  });

  it('CREATOROS_API_KEY wins over every file', async () => {
    await put('.social-agents', 'credentials.json', { apiKey: OURS });
    await put('.creatoros', 'config.json', { api_key: CLI });
    process.env.CREATOROS_API_KEY = ENV;
    expect(await resolve()).toBe(ENV);
  });

  it('then ~/.social-agents/credentials.json', async () => {
    await put('.social-agents', 'credentials.json', { apiKey: OURS });
    await put('.creatoros', 'config.json', { api_key: CLI });
    expect(await resolve()).toBe(OURS);
  });

  it('then the pre-rename ~/.midas and ~/.kairos files', async () => {
    await put('.kairos', 'credentials.json', { apiKey: 'cos_live_' + 'k'.repeat(32) });
    await put('.midas', 'credentials.json', { apiKey: OURS });
    expect(await resolve()).toBe(OURS);
  });

  it('then ~/.creatoros/config.json, written by `npx @creatoros/cli init`', async () => {
    await put('.creatoros', 'config.json', { api_key: CLI });
    expect(await resolve()).toBe(CLI);
  });

  it('honors CREATOROS_CONFIG_DIR for the CLI config', async () => {
    await put('custom-cos', 'config.json', { api_key: CLI });
    process.env.CREATOROS_CONFIG_DIR = join(home, 'custom-cos');
    expect(await resolve()).toBe(CLI);
  });

  it('skips a legacy sk_ key when a current key exists further down', async () => {
    await put('.social-agents', 'credentials.json', { apiKey: LEGACY });
    await put('.creatoros', 'config.json', { api_key: CLI });
    expect(await resolve()).toBe(CLI);
  });

  it('fails clearly when the only key is a legacy sk_ key', async () => {
    process.env.CREATOROS_API_KEY = LEGACY;
    await expect(resolve()).rejects.toThrow(/cos_live_.*creatoros\.ca.*npx @creatoros\/cli init/s);
  });
});
