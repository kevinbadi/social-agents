import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyState,
  isInterviewComplete,
  loadState,
  markStepDone,
  nextStep,
  saveState,
  INTERVIEW_STEPS,
  type InterviewState,
} from '../src/onboarding/state.js';
import { describeWorkerHealth, parseProducts, renderBrandMd, renderClaudeMd, renderProfilesMd, renderRailwayGuide, renderSetupPrompt } from '../src/onboarding/render.js';

async function tmpStatePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'social-agents-test-'));
  return join(dir, 'social-agents', '.setup-state.json');
}

describe('interview persistence & resume', () => {
  it('is the CreatorOS key(s), then the handoff — no AI, brand, creator/agency, or infrastructure step', () => {
    const state = emptyState();
    expect(INTERVIEW_STEPS).toEqual(['keys', 'finish']);
    expect(nextStep(state)).toBe('keys');
    expect(isInterviewComplete(state)).toBe(false);
    markStepDone(state, 'keys');
    expect(nextStep(state)).toBe('finish');
  });

  it('records each key\'s workspace by id, name, and folder — never the key itself', async () => {
    const path = await tmpStatePath();
    const state = emptyState();
    state.answers.keyCount = 2;
    state.answers.workspaces = [
      { workspaceId: 'ws-1', name: 'Acme Fitness', slug: 'acme-fitness' },
      { workspaceId: 'ws-2', name: 'Bolt Coffee', slug: 'bolt-coffee' },
    ];
    markStepDone(state, 'keys');
    await saveState(path, state);
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('Acme Fitness');
    expect(raw).not.toMatch(/cos_live_|sk_[0-9a-f]/i);
    const resumed = await loadState(path);
    expect(resumed.answers.workspaces?.map((w) => w.slug)).toEqual(['acme-fitness', 'bolt-coffee']);
    expect(nextStep(resumed)).toBe('finish');
  });

  it('resumes mid-keys: the count and the keys already validated survive a restart', async () => {
    const path = await tmpStatePath();
    const state = emptyState();
    state.answers.keyCount = 3;
    state.answers.workspaces = [{ workspaceId: 'ws-1', name: 'Acme Fitness', slug: 'acme-fitness' }];
    await saveState(path, state);
    // Simulate the process being killed and re-run.
    const resumed = await loadState(path);
    expect(nextStep(resumed)).toBe('keys');
    expect(resumed.answers.keyCount).toBe(3);
    expect(resumed.answers.workspaces).toHaveLength(1);
  });

  it('brand, pathway, profiles, automations, AI, and creator/agency are conversations, not form steps', () => {
    for (const notAStep of ['funnel', 'autoReplies', 'brain', 'brand', 'pathway', 'profiles', 'mode']) {
      expect(INTERVIEW_STEPS as readonly string[]).not.toContain(notAStep);
    }
  });

  it('is complete only after every step, in the spec order', () => {
    const state = emptyState();
    for (const step of INTERVIEW_STEPS) {
      expect(isInterviewComplete(state)).toBe(false);
      markStepDone(state, step);
    }
    expect(isInterviewComplete(state)).toBe(true);
    expect(nextStep(state)).toBeNull();
  });

  it('survives a corrupt state file by starting over', async () => {
    const path = await tmpStatePath();
    const state: InterviewState = emptyState();
    await saveState(path, state);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, 'not json', 'utf8');
    const recovered = await loadState(path);
    expect(recovered.completed).toEqual([]);
  });
});

describe('brand pack rendering', () => {
  const brand = {
    about: 'Streetwear drops',
    products: [
      { link: 'https://shop.example/drop', description: 'Limited hoodies' },
      { description: 'Styling service (no link yet)' },
    ],
    voiceAdjectives: ['bold', 'scarce', 'playful'],
    voiceNever: 'thirsty',
    emojiPolicy: 'sparingly (max one per caption)',
    hashtagPolicy: 'a few relevant ones (2-4)',
    audience: 'sneakerheads 18-30',
    competitors: ['@rivalbrand', '@otherbrand'],
  };

  it('everything Social Agents write later flows from BRAND.md', () => {
    const md = renderBrandMd(brand);
    expect(md).toContain('bold, scarce, playful');
    expect(md).toContain('Never: thirsty');
    expect(md).toContain('Limited hoodies — https://shop.example/drop');
    expect(md).toContain('Styling service (no link yet)');
    expect(md).toContain('@rivalbrand');
    expect(md).toContain('sneakerheads 18-30');
  });

  it('parses "link, explainer" rows — with and without links', () => {
    const products = parseProducts(
      [
        'https://shop.example/guide, my $29 training guide',
        'coach.example/call, free strategy call',
        'merch drop coming in Q4, no link yet',
      ].join('\n'),
    );
    expect(products[0]).toEqual({ link: 'https://shop.example/guide', description: 'my $29 training guide' });
    expect(products[1]).toEqual({ link: 'https://coach.example/call', description: 'free strategy call' });
    expect(products[2]?.link).toBeUndefined();
    expect(products[2]?.description).toContain('merch drop');
  });

  it('the setup prompt hands off automations as a menu — it never pre-commits any', () => {
    const prompt = renderSetupPrompt({
      brandDone: true,
      pathway: { automationTarget: 'railway', timezone: 'America/Toronto' },
    });
    expect(prompt).toContain('social-agents/social-agents.json');
    expect(prompt).toContain('railway');
    // brand already on disk → no interview task
    expect(prompt).not.toContain('brand-interview');
    expect(prompt).toMatch(/ZERO automations/i);
    expect(prompt).toMatch(/ONLY what I approve/);
    expect(prompt).toMatch(/none for now/i);
    expect(prompt).toMatch(/follower stats/i);
    // no automation is described as already-decided
    expect(prompt).not.toMatch(/create the comment-to-DM funnel/i);
    expect(prompt).not.toMatch(/starter crons I still need/);
  });

  it('with no brand pack yet, the agent is told to run the brand interview first, then ask about the pathway', () => {
    const prompt = renderSetupPrompt({ pathway: { automationTarget: 'local', timezone: 'America/Toronto' } });
    const lines = prompt.split('\n');
    expect(lines.find((l) => l.startsWith('1. '))).toContain('brand-interview');
    expect(prompt).toContain('social-agents/BRAND.md');
    expect(prompt).toMatch(/where my automations should live/);
    expect(prompt).toContain('provision-railway');
    expect(prompt).toMatch(/ZERO automations/i);
  });

  it('a railway pathway without a deployed worker adds the right deploy task', () => {
    // Token saved → the AGENT provisions; the user never touches Railway.
    const withToken = renderSetupPrompt({ pathway: { automationTarget: 'railway', timezone: 'America/Toronto', workerToken: 'tok', railwayTokenSaved: true } });
    expect(withToken).toContain('Provision my Railway worker for me');
    expect(withToken).toContain('provision-railway');
    // No spend-limit gating anywhere — the user knows how their credentials work.
    expect(withToken).not.toMatch(/spend limit/i);
    // Credentials already collected → the agent is told NOT to re-ask.
    const fullyCollected = renderSetupPrompt({
      pathway: {
        automationTarget: 'railway',
        timezone: 'America/Toronto',
        workerToken: 'tok',
        railwayTokenSaved: true,
        aiCredentialSaved: true,
      },
    });
    expect(fullyCollected).toContain('ALREADY SAVED');
    expect(fullyCollected).toContain('do NOT ask me for it again');
    expect(fullyCollected).not.toMatch(/spend limit/i);
    // No token → manual walkthrough, with the token shortcut offered.
    const withoutToken = renderSetupPrompt({ pathway: { automationTarget: 'railway', timezone: 'America/Toronto', workerToken: 'tok' } });
    expect(withoutToken).toContain('social-agents/RAILWAY.md');
    expect(withoutToken).toContain('worker.url');
    // Worker already live → no deploy task at all.
    const withWorker = renderSetupPrompt({ pathway: { automationTarget: 'railway', timezone: 'America/Toronto', workerUrl: 'https://w.up.railway.app' } });
    expect(withWorker).not.toContain('social-agents/RAILWAY.md');
    expect(withWorker).not.toContain('Provision my Railway worker');
  });

  it('a workspace CLAUDE.md briefs any agent: one workspace only, files first, parallel-safe, no secrets', () => {
    const md = renderClaudeMd({
      workspaceName: 'Acme Fitness',
      pathway: { automationTarget: 'railway', timezone: 'America/Toronto' },
    });
    expect(md).toContain('# Social Agents: Acme Fitness');
    expect(md).toMatch(/ONE CreatorOS workspace/);
    expect(md).toMatch(/"Acme Fitness" only/);
    expect(md).toContain('social-agents/social-agents.json');
    expect(md).toContain('social-agents/BRAND.md');
    expect(md).toContain('social-agents/PROFILES.md');
    expect(md).toContain('social-agents/SETUP_PROMPT.md');
    expect(md).toContain('brand-interview');
    expect(md).toContain('railway · timezone America/Toronto');
    expect(md).toMatch(/parallel-safe/i);
    expect(md).toMatch(/never print it/i);
    expect(md).not.toMatch(/cos_live_[A-Za-z0-9_-]{32}|sk_[0-9a-f]/i); // never a key in a committed-adjacent file
  });

  it('describes a live worker in one human line', () => {
    expect(describeWorkerHealth({ automations: [], running: null })).toContain('within 30 seconds');
    const busy = describeWorkerHealth({
      automations: [
        { name: 'engagement-sweep', enabled: true, nextRun: '2026-07-18T15:00:00.000Z' },
        { name: 'weekly-analytics', enabled: true, nextRun: '2026-07-20T08:00:00.000Z' },
        { name: 'paused-one', enabled: false, nextRun: null },
      ],
      running: 'engagement-sweep',
    });
    expect(busy).toContain('2 automation(s) scheduled');
    expect(busy).toContain('engagement-sweep at 2026-07-18T15:00:00.000Z');
    expect(busy).toContain("running engagement-sweep");
  });

  it('the Railway guide ships with every value pre-filled', () => {
    const guide = renderRailwayGuide({ timezone: 'America/Toronto', workerToken: 'abc123token' });
    expect(guide).toContain('Dockerfile.worker');
    expect(guide).toContain('abc123token');
    expect(guide).toContain('America/Toronto');
    expect(guide).toContain('SOCIAL_AGENTS_WORKER_TOKEN');
    expect(guide).toContain('spend limit');
    expect(guide).not.toMatch(/cos_live_[A-Za-z0-9_-]{32}|sk_[0-9a-f]/i); // never a real key in a file
  });

  it('renders the profile map with account IDs', () => {
    const md = renderProfilesMd([
      { id: 'acc_Tt-9x_1', platform: 'tiktok', username: 'brand.tt' },
      { id: 'acc_Ig-4k_2', platform: 'instagram', username: 'brand.ig' },
    ]);
    // Opaque ids are copied exactly, never shortened.
    expect(md).toContain('| TikTok | @brand.tt | `acc_Tt-9x_1` |');
    expect(md).toContain('| Instagram | @brand.ig | `acc_Ig-4k_2` |');
    expect(md).toMatch(/opaque/);
  });
});
