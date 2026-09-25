/**
 * The brain chooser + verifier. Social Agents thinks with Claude by default (plan or
 * ANTHROPIC_API_KEY); any model behind an Anthropic-compatible API works
 * as a custom brain — same Agent SDK engine, pointed at their base URL.
 * This prompt runs as the FIRST question whenever no Claude connection is
 * detected, and every choice is verified with a live round-trip.
 */
import { confirm, input, password, select } from '@inquirer/prompts';
import {
  claudeCliAvailable,
  detectBrain,
  verifyBrain,
  type BrainConfig,
  type CustomBrain,
} from '../util/brain.js';
import { resolveAiApiKey, saveAiApiKey } from './credentials.js';
import type { BrainSettings } from './socialAgentsConfig.js';

/** Strip the secret for anything that lands in the workspace. */
export function toSettings(brain: BrainConfig): BrainSettings {
  if (brain.provider === 'custom') {
    return { provider: 'custom', baseUrl: brain.baseUrl, model: brain.model };
  }
  return { provider: 'claude' };
}

/** Rebuild a runnable BrainConfig from saved settings + stored key. */
export async function hydrateBrain(settings: BrainSettings | undefined): Promise<BrainConfig | null> {
  if (!settings || settings.provider === 'claude') return { provider: 'claude' };
  const apiKey = await resolveAiApiKey();
  if (!settings.baseUrl || !settings.model || !apiKey) return null;
  return { provider: 'custom', baseUrl: settings.baseUrl, model: settings.model, apiKey };
}

async function collectCustomBrain(): Promise<CustomBrain> {
  const baseUrl = (
    await input({
      message: 'Anthropic-compatible API base URL (e.g. https://api.moonshot.ai/anthropic):',
      validate: (v) => /^https?:\/\/\S+$/.test(v.trim()) || 'A full URL, e.g. https://api.provider.com/anthropic',
    })
  )
    .trim()
    .replace(/\/+$/, '');
  const model = (
    await input({
      message: 'Model id (exactly as that provider names it):',
      validate: (v) => v.trim().length > 0 || 'The model id the API expects.',
    })
  ).trim();
  const existing = await resolveAiApiKey();
  let apiKey = existing ?? '';
  if (existing) {
    const reuse = await confirm({ message: 'Found a saved AI API key — use it?', default: true });
    if (!reuse) apiKey = '';
  }
  if (!apiKey) {
    apiKey = (await password({ message: 'API key for that endpoint:', mask: '*' })).trim();
    if (apiKey) await saveAiApiKey(apiKey);
  }
  return { provider: 'custom', baseUrl, apiKey, model };
}

/** Ask which brain to think with. */
export async function promptBrainChoice(): Promise<BrainConfig> {
  const provider = await select({
    message: 'Which AI model should I think with?',
    choices: [
      {
        name: 'Claude (recommended) — your Claude plan or an Anthropic API key',
        value: 'claude' as const,
      },
      {
        name: 'Another model via API — any Anthropic-compatible endpoint (Moonshot/Kimi, DeepSeek, GLM…)',
        value: 'custom' as const,
      },
    ],
  });

  if (provider === 'custom') return collectCustomBrain();

  if (detectBrain() === 'missing') {
    console.log(
      '\nTwo ways to plug Claude in:\n' +
        '  1. Your Claude plan (easiest): npm i -g @anthropic-ai/claude-code, then run `claude` once and log in.\n' +
        '  2. An API key: export ANTHROPIC_API_KEY=sk-ant-...\n',
    );
    await confirm({
      message: 'Set it up in another terminal — ready to verify?',
      default: true,
    });
  }
  return { provider: 'claude' };
}

/**
 * Live-verify a brain with a real round-trip; on failure, loop with
 * retry / reconfigure until one actually answers. Nothing moves forward
 * on a dead brain — Ctrl+C pauses, and onboarding resumes at this step.
 */
export async function verifyBrainInteractive(initial: BrainConfig): Promise<BrainConfig> {
  let brain = initial;
  while (true) {
    const planPath = brain.provider === 'claude' && !process.env.ANTHROPIC_API_KEY;
    process.stdout.write(
      `Checking the brain (${describeBrain(brain)}) with a live round-trip${planPath ? ' — a plan login takes ~20s to answer' : ''}… `,
    );
    const check = await verifyBrain(brain);
    if (check.ok) {
      console.log(`connected via ${check.via}.`);
      return brain;
    }
    console.log(`failed.\n  ${check.detail ?? 'no detail'}`);
    const next = await select({
      message: "I can't move forward without a working brain — what now?",
      choices: [
        { name: 'Try again (I fixed it)', value: 'retry' as const },
        { name: 'Pick a different model / fix the details', value: 'reconfigure' as const },
      ],
    });
    if (next === 'reconfigure') brain = await promptBrainChoice();
  }
}

/**
 * REPL-start readiness. Healthy starts stay fast (no live ping — the first
 * turn surfaces real errors). But if the Claude connection is missing or a
 * custom brain lost its key, the first question is which model to use, and
 * that choice fully initializes — a live round-trip — before any chat.
 */
export async function ensureBrainReady(settings: BrainSettings | undefined): Promise<BrainConfig> {
  const hydrated = await hydrateBrain(settings);
  if (hydrated?.provider === 'custom') return hydrated;
  if (hydrated?.provider === 'claude' && detectBrain() !== 'missing') return hydrated;
  if (settings?.provider === 'custom') {
    console.log('\nYour custom brain is missing pieces (key, URL, or model) — let\'s re-plug it.');
  } else {
    console.log('\nThe Claude connection failed — no Claude Code login and no ANTHROPIC_API_KEY found.');
  }
  return verifyBrainInteractive(await promptBrainChoice());
}

export function describeBrain(brain: BrainConfig | BrainSettings | undefined): string {
  if (!brain || brain.provider === 'claude') {
    return claudeCliAvailable() || process.env.ANTHROPIC_API_KEY ? 'claude' : 'claude (not connected)';
  }
  return `${brain.model ?? '?'} @ ${(brain.baseUrl ?? '').replace(/^https?:\/\//, '')}`;
}
