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
  it('is mode, then the CreatorOS key, then the handoff — no AI, brand, or infrastructure step in the form', () => {
    const state = emptyState();
    expect(INTERVIEW_STEPS).toEqual(['mode', 'key', 'finish']);
    expect(nextStep(state)).toBe('mode');
    expect(isInterviewComplete(state)).toBe(false);
    markStepDone(state, 'mode');
    expect(nextStep(state)).toBe('key');
    markStepDone(state, 'key');
    expect(nextStep(state)).toBe('finish');
  });

  it('records agency mode with client labels but never the keys themselves', async () => {
    const path = await tmpStatePath();
    const state = emptyState();
    state.answers.mode = 'agency';
    state.answers.clientLabels = ['Acme Fitness', 'Bolt Coffee'];
    markStepDone(state, 'mode');
    await saveState(path, state);
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('Acme Fitness');
    expect(raw).not.toMatch(/sk_[0-9a-f]/i);
    const resumed = await loadState(path);
    expect(resumed.answers.mode).toBe('agency');
    expect(nextStep(resumed)).toBe('key');
  });

  it('persists every step and resumes from the next one', async () => {
    const path = await tmpStatePath();
    const state = emptyState();
    markStepDone(state, 'mode');
    markStepDone(state, 'key');
    // The brand pack is written by the agent in chat, but the state file
    // still carries it when present.
    state.answers.brand = {
      about: 'Fitness coaching',
      products: [{ link: 'https://coach.example/buy', description: '1:1 programs' }],
      voiceAdjectives: ['direct', 'warm', 'practical'],
      voiceNever: 'corporate',
      emojiPolicy: 'none',
      hashtagPolicy: 'none',
      audience: 'busy parents',
      competitors: ['@bigcoach'],
    };
    await saveState(path, state);

    // Simulate the process being killed and re-run.
    const resumed = await loadState(path);
    expect(resumed.completed).toEqual(['mode', 'key']);
    expect(nextStep(resumed)).toBe('finish');
    expect(resumed.answers.brand?.products[0]?.link).toBe('https://coach.example/buy');
  });

  it('brand, pathway, profiles, automations, and AI are all conversations, not form steps', () => {
    for (const notAStep of ['funnel', 'autoReplies', 'brain', 'brand', 'pathway', 'profiles']) {
      expect(INTERVIEW_STEPS as readonly string[]).not.toContain(notAStep);
    }
    expect(INTERVIEW_STEPS.indexOf('key')).toBe(1);
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

  it('everything Social Agents writes later flows from BRAND.md', () => {
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
    const state: InterviewState = {
      completed: [],
      answers: {
        brand: { ...brand },
        pathway: { automationTarget: 'railway', timezone: 'America/Toronto' },
      },
    };
    const prompt = renderSetupPrompt(state);
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
    const prompt = renderSetupPrompt({
      completed: ['mode', 'key', 'finish'],
      answers: { mode: 'creator', pathway: { automationTarget: 'local', timezone: 'America/Toronto' } },
    });
    const lines = prompt.split('\n');
    expect(lines.find((l) => l.startsWith('1. '))).toContain('brand-interview');
    expect(prompt).toContain('social-agents/BRAND.md');
    expect(prompt).toMatch(/where my automations should live/);
    expect(prompt).toContain('provision-railway');
    expect(prompt).toMatch(/ZERO automations/i);
  });

  it('a railway pathway without a deployed worker adds the right deploy task', () => {
    // Token saved → the AGENT provisions; the user never touches Railway.
    const withToken = renderSetupPrompt({
      completed: [],
      answers: { pathway: { automationTarget: 'railway', timezone: 'America/Toronto', workerToken: 'tok', railwayTokenSaved: true } },
    });
    expect(withToken).toContain('Provision my Railway worker for me');
    expect(withToken).toContain('provision-railway');
    // No spend-limit gating anywhere — the user knows how their credentials work.
    expect(withToken).not.toMatch(/spend limit/i);
    // Credentials already collected → the agent is told NOT to re-ask.
    const fullyCollected = renderSetupPrompt({
      completed: [],
      answers: {
        pathway: {
          automationTarget: 'railway',
          timezone: 'America/Toronto',
          workerToken: 'tok',
          railwayTokenSaved: true,
          aiCredentialSaved: true,
        },
      },
    });
    expect(fullyCollected).toContain('ALREADY SAVED');
    expect(fullyCollected).toContain('do NOT ask me for it again');
    expect(fullyCollected).not.toMatch(/spend limit/i);
    // No token → manual walkthrough, with the token shortcut offered.
    const withoutToken = renderSetupPrompt({
      completed: [],
      answers: { pathway: { automationTarget: 'railway', timezone: 'America/Toronto', workerToken: 'tok' } },
    });
    expect(withoutToken).toContain('social-agents/RAILWAY.md');
    expect(withoutToken).toContain('worker.url');
    // Worker already live → no deploy task at all.
    const withWorker = renderSetupPrompt({
      completed: [],
      answers: { pathway: { automationTarget: 'railway', timezone: 'America/Toronto', workerUrl: 'https://w.up.railway.app' } },
    });
    expect(withWorker).not.toContain('social-agents/RAILWAY.md');
    expect(withWorker).not.toContain('Provision my Railway worker');
  });

  it('CLAUDE.md briefs any agent: files first, init prompt, parallel-safe sessions, no secrets', () => {
    const md = renderClaudeMd({
      completed: [],
      answers: {
        mode: 'creator',
        brand: { ...brand },
        pathway: { automationTarget: 'railway', timezone: 'America/Toronto' },
      },
    });
    expect(md).toContain('social-agents/social-agents.json');
    expect(md).toContain('social-agents/BRAND.md');
    expect(md).toContain('social-agents/PROFILES.md');
    expect(md).toContain('social-agents/SETUP_PROMPT.md');
    expect(md).toContain('brand-interview');
    expect(md).toContain('railway · timezone America/Toronto');
    expect(md).toMatch(/parallel-safe/i);
    expect(md).toMatch(/never print them/i);
    expect(md).not.toMatch(/sk_[0-9a-f]/i); // never a key in a committed-adjacent file
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
    expect(guide).not.toMatch(/sk_[0-9a-f]/i); // never a real key in a file
  });

  it('renders the profile map with account IDs', () => {
    const md = renderProfilesMd([
      { _id: 'acc1', platform: 'tiktok', username: 'brand.tt' },
      { _id: 'acc2', platform: 'instagram', username: 'brand.ig' },
    ]);
    expect(md).toContain('| TikTok | @brand.tt | `acc1` |');
    expect(md).toContain('| Instagram | @brand.ig | `acc2` |');
  });
});
