import { describe, expect, it, vi } from 'vitest';
import {
  parseDomain,
  parseProjectName,
  parseServiceId,
  provisionRailwayWorker,
  provisionVariableArgs,
  type ProvisionInputs,
} from '../src/automations/railwayProvision.js';

const INPUTS: ProvisionInputs = {
  workspaceRoot: '/tmp/ws',
  railwayToken: 'rw-token',
  timezone: 'America/Toronto',
  workerToken: 'worker-secret',
  creatorosKey: 'sk_' + 'a'.repeat(64),
  ai: { kind: 'ANTHROPIC_API_KEY', value: 'sk-ant-xyz' },
  healthAttempts: 1,
  healthDelayMs: 1,
};

describe('provisioning building blocks', () => {
  it('sets every variable the worker needs, including the Dockerfile selector', () => {
    const args = provisionVariableArgs(INPUTS);
    const joined = args.join(' ');
    expect(joined).toContain('CREATOROS_API_KEY=');
    expect(joined).toContain('ANTHROPIC_API_KEY=sk-ant-xyz');
    expect(joined).toContain('SOCIAL_AGENTS_WORKER_TOKEN=worker-secret');
    expect(joined).toContain('TZ=America/Toronto');
    expect(joined).toContain('RAILWAY_DOCKERFILE_PATH=Dockerfile.worker');
  });

  it('uses the oauth env var name when the credential is a setup-token', () => {
    const args = provisionVariableArgs({ ...INPUTS, ai: { kind: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'tok' } });
    expect(args.join(' ')).toContain('CLAUDE_CODE_OAUTH_TOKEN=tok');
    expect(args.join(' ')).not.toContain('ANTHROPIC_API_KEY=');
  });

  it('deploys WITHOUT an AI credential — the environment ships, the brain key comes later', () => {
    const args = provisionVariableArgs({ ...INPUTS, ai: null });
    const joined = args.join(' ');
    expect(joined).toContain('CREATOROS_API_KEY=');
    expect(joined).toContain('SOCIAL_AGENTS_WORKER_TOKEN=');
    expect(joined).not.toContain('ANTHROPIC_API_KEY=');
    expect(joined).not.toContain('CLAUDE_CODE_OAUTH_TOKEN=');
  });

  it('parses the generated domain and service id from CLI output', () => {
    expect(parseDomain('Service Domain created:\nhttps://social-agents-worker-production.up.railway.app\n')).toBe(
      'https://social-agents-worker-production.up.railway.app',
    );
    expect(parseDomain('social-agents-abc123.up.railway.app')).toBe('https://social-agents-abc123.up.railway.app');
    expect(parseDomain('no domain here')).toBe(null);
    expect(parseServiceId(JSON.stringify({ services: { edges: [{ node: { id: 'svc-1' } }] } }))).toBe('svc-1');
    expect(parseServiceId('garbage')).toBe(null);
  });
});

describe('provisionRailwayWorker orchestration (mocked CLI)', () => {
  const cli = (outputs: Record<string, { code: number; stdout: string; stderr: string }>) =>
    vi.fn(async (args: string[]) => outputs[args[0]!] ?? { code: 0, stdout: '', stderr: '' });

  it('happy path: init → variables → up → domain → status, reports the url', async () => {
    const runner = cli({
      domain: { code: 0, stdout: 'https://social-agents-w.up.railway.app', stderr: '' },
      status: { code: 0, stdout: JSON.stringify({ services: { edges: [{ node: { id: 'svc-9' } }] } }), stderr: '' },
    });
    // Health-check fetch will fail (no server) — result is ok-but-not-healthy.
    const progress: string[] = [];
    const result = await provisionRailwayWorker(
      { ...INPUTS, workspaceRoot: '/nonexistent' },
      (l) => progress.push(l),
      runner as never,
    );
    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://social-agents-w.up.railway.app');
    expect(result.serviceId).toBe('svc-9');
    expect(progress.some((l) => l.includes('Uploading'))).toBe(true);
  });

  it('a failed upload stops the run with the step named', async () => {
    const runner = cli({ up: { code: 1, stdout: '', stderr: 'build blew up' } });
    const result = await provisionRailwayWorker(INPUTS, () => {}, runner as never);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('railway up');
    expect(result.error).toContain('build blew up');
  });

  it('any init failure stops the run — no silent reuse of existing projects', async () => {
    const runner = cli({
      init: { code: 1, stdout: '', stderr: 'Project already exists and is linked' },
    });
    const result = await provisionRailwayWorker(INPUTS, () => {}, runner as never);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('railway init');
  });

  it('ALWAYS unlinks first — every run gets a brand-new project', async () => {
    const calls: string[][] = [];
    const runner = vi.fn(async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'status') return { code: 0, stdout: JSON.stringify({ name: 'social-agents-worker' }), stderr: '' };
      if (args[0] === 'domain') return { code: 0, stdout: 'social-agents-w.up.railway.app', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    });
    const result = await provisionRailwayWorker(INPUTS, () => {}, runner as never);
    expect(result.ok).toBe(true);
    // unlink comes before init — the stale link is gone before anything is created
    expect(calls.findIndex((a) => a[0] === 'unlink')).toBeLessThan(calls.findIndex((a) => a[0] === 'init'));
    // --no-gitignore is load-bearing: plain `railway up` drops the
    // gitignored social-agents/ and ships a worker with no workspace.
    expect(calls.find((a) => a[0] === 'up')).toContain('--no-gitignore');
  });

  it('REFUSES to deploy onto a mismatched project (stale link that will not clear)', async () => {
    const runner = cli({
      status: { code: 0, stdout: JSON.stringify({ project: { name: 'my-old-blog' } }), stderr: '' },
    });
    const result = await provisionRailwayWorker(INPUTS, () => {}, runner as never);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('my-old-blog');
    expect(result.error).toContain('social-agents-worker');
    // and crucially: no variables were set, nothing was uploaded
    expect(runner.mock.calls.map((c) => (c[0] as string[])[0])).not.toContain('variables');
    expect(runner.mock.calls.map((c) => (c[0] as string[])[0])).not.toContain('up');
  });

  it('parses the project name from both status shapes', () => {
    expect(parseProjectName(JSON.stringify({ name: 'social-agents-worker' }))).toBe('social-agents-worker');
    expect(parseProjectName(JSON.stringify({ project: { name: 'other' } }))).toBe('other');
    expect(parseProjectName('not json')).toBe(null);
  });
});

describe('upload manifest', () => {
  it('writes .railwayignore before upload when missing, and respects an existing one', async () => {
    const { mkdtemp, readFile: rf, writeFile: wf } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join: j } = await import('node:path');
    const { ensureRailwayIgnore } = await import('../src/automations/railwayProvision.js');
    const root = await mkdtemp(j(tmpdir(), 'social-agents-rwignore-'));
    await ensureRailwayIgnore(root);
    const written = await rf(j(root, '.railwayignore'), 'utf8');
    expect(written).toContain('node_modules');
    expect(written).toContain('.git');
    await wf(j(root, '.railwayignore'), 'custom\n', 'utf8');
    await ensureRailwayIgnore(root);
    expect(await rf(j(root, '.railwayignore'), 'utf8')).toBe('custom\n');
  });
});
