/**
 * The onboarding form — deliberately tiny. Two things and done:
 *   1. creator or agency,
 *   2. the CreatorOS API key (validated live).
 * Everything else — the brand pack, the automation pathway, the automation
 * menu — is a conversation with the marketing agent afterwards, because a
 * form is the worst place to have it. Resumable: state saves after every step.
 */
import { confirm, input, password, select } from '@inquirer/prompts';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreatorOSClient, isLegacyKey, isValidKeyShape, LegacyApiKeyError } from '../client/client.js';
import { platformLabel } from '../client/platformMatrix.js';
import type { SocialAccount } from '../client/types.js';
import { maskKey } from '../util/mask.js';
import { socialAgentsPaths, type SocialAgentsPaths } from '../paths.js';
import { resolveApiKey, saveApiKey, saveCredentials } from '../config/credentials.js';
import { saveConfig, type SocialAgentsConfig } from '../config/socialAgentsConfig.js';
import { isStepDone, loadState, markStepDone, saveState, type InterviewState } from './state.js';
import {
  renderClaudeMd,
  renderProfilesMd,
  renderRailwayGuide,
  renderSetupPrompt,
  renderTutorialsMd,
} from './render.js';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');

function say(text: string): void {
  console.log(`\n${text}`);
}

export interface InterviewResult {
  client: CreatorOSClient;
  config: SocialAgentsConfig;
}

export async function runInterview(root: string = process.cwd()): Promise<InterviewResult> {
  const paths = socialAgentsPaths(root);
  await mkdir(paths.socialAgentsDir, { recursive: true });
  const state = await loadState(paths.setupStateJson);
  const resuming = state.completed.length > 0;

  say(
    resuming
      ? `Social Agents here, picking up where we left off. ${state.completed.length} step(s) already done.`
      : `Hey, we're Social Agents, your marketing team of AI agents. Two quick things and you're in: creator or agency, and your CreatorOS API key. Everything else we figure out together in chat.

What CreatorOS is: the service we run on. It holds your connected socials and does the actual posting, replying, and analytics. We're the agents that drive it. You need one thing from it, an API key:
  1. Sign up at ${GET_KEY_URL}
  2. Connect at least one social account there
  3. Settings, API keys: copy it (it starts with cos_live_)
     (or run \`npx @creatoros/cli init\` and we'll find it)
Don't have it yet? Say no at the key question and we'll stop here; run us again when you do and we pick up where we left off.`,
  );

  // ---- Creator or agency ----
  if (!isStepDone(state, 'mode')) {
    await stepMode(state);
    await saveState(paths.setupStateJson, state);
  }

  // ---- Key(s) + accounts ----
  const client = await stepKey(paths, state);

  // ---- Write the workspace and hand off to the agent ----
  const config = await stepFinish(client, paths, state);
  return { client, config };
}

async function stepMode(state: InterviewState): Promise<void> {
  const mode = await select({
    message: 'Creator or agency?',
    choices: [
      { name: 'Creator', value: 'creator' as const },
      { name: 'Agency', value: 'agency' as const },
    ],
  });
  state.answers.mode = mode;
  markStepDone(state, 'mode');
}

/** Collect and validate one key on a loop until it passes shape + live check. */
async function collectValidKey(promptMessage: string): Promise<{ key: string; client: CreatorOSClient }> {
  while (true) {
    const key = (await password({ message: promptMessage, mask: '*' })).trim();
    if (!isValidKeyShape(key)) {
      console.log(
        isLegacyKey(key)
          ? `That's an old sk_ key, which no longer works. Get a cos_live_ key from ${GET_KEY_URL} under Settings, API keys (or run \`npx @creatoros/cli init\`).`
          : `That doesn't look like a CreatorOS API key (expected cos_live_ followed by 32 characters). Copy it from ${GET_KEY_URL} under Settings, API keys.`,
      );
      continue;
    }
    const client = new CreatorOSClient({ apiKey: key });
    process.stdout.write(`Checking ${maskKey(key)} against CreatorOS servers... `);
    const valid = await client.validateKey();
    if (!valid) {
      console.log(`rejected. Double-check it at ${GET_KEY_URL} (Settings, API keys) and paste it again.`);
      continue;
    }
    console.log('valid.');
    return { key, client };
  }
}

const MAX_AGENCY_KEYS = 10;
const GET_KEY_URL = 'https://www.creatoros.ca/';

/** Creator: one key. Agency: up to 10 keys, pick who we set up now. */
async function collectKeysInteractively(state: InterviewState): Promise<CreatorOSClient> {
  const plural = state.answers.mode === 'agency' ? '(s)' : '';
  const hasKeys = await confirm({
    message: `Do you have your CreatorOS API key${plural}?`,
    default: true,
  });
  if (!hasKeys) {
    say(`No problem. Get it at ${GET_KEY_URL}: sign up, connect at least one social, then Settings, API keys (or run \`npx @creatoros/cli init\`). Run us again and we pick up right here.`);
    process.exit(0);
  }

  if (state.answers.mode !== 'agency') {
    const { key, client } = await collectValidKey('Paste your CreatorOS API key:');
    await saveApiKey(key);
    return client;
  }

  const collected: Array<{ label: string; apiKey: string; client: CreatorOSClient }> = [];
  while (collected.length < MAX_AGENCY_KEYS) {
    const label = (
      await input({
        message: `Client ${collected.length + 1} name:`,
        validate: (v) => v.trim().length > 0 || 'A name so we can tell the keys apart.',
      })
    ).trim();
    const { key, client } = await collectValidKey(`CreatorOS API key for ${label}:`);
    collected.push({ label, apiKey: key, client });
    if (collected.length === MAX_AGENCY_KEYS) {
      say(`That's ${MAX_AGENCY_KEYS} — the max per setup.`);
      break;
    }
    const more = await confirm({
      message: `Add another client key? (${collected.length}/${MAX_AGENCY_KEYS})`,
      default: false,
    });
    if (!more) break;
  }

  const activeIndex =
    collected.length === 1
      ? 0
      : await select({
          message: 'Which client are we setting up right now? (the rest stay saved for their own workspaces)',
          choices: collected.map((entry, index) => ({ name: entry.label, value: index })),
        });
  const active = collected[activeIndex]!;
  await saveCredentials({
    apiKey: active.apiKey,
    keys: collected.map(({ label, apiKey }) => ({ label, apiKey })),
  });
  state.answers.clientLabels = collected.map((entry) => entry.label);
  say(`Working on ${active.label} now. ${collected.length > 1 ? `The other ${collected.length - 1} key(s) are saved and validated.` : ''}`);
  return active.client;
}

async function stepKey(paths: SocialAgentsPaths, state: InterviewState): Promise<CreatorOSClient> {
  let client: CreatorOSClient;

  let envKey: string | null = null;
  try {
    envKey = await resolveApiKey();
  } catch (error) {
    if (!(error instanceof LegacyApiKeyError)) throw error;
    say(error.message);
  }
  if (envKey && isValidKeyShape(envKey)) {
    client = new CreatorOSClient({ apiKey: envKey });
    process.stdout.write(`Found a saved key — checking ${maskKey(envKey)}... `);
    if (await client.validateKey()) {
      console.log('valid.');
    } else {
      console.log('rejected — let\'s get a fresh one.');
      client = await collectKeysInteractively(state);
    }
  } else {
    client = await collectKeysInteractively(state);
  }

  const { accounts } = await client!.listAccounts();
  if (!isStepDone(state, 'key')) {
    say(`You have ${accounts.length} connected account(s):`);
    let health: { accounts?: Array<{ accountId: string; status: string; needsReconnect?: boolean }> } = {};
    try {
      health = (await client!.accountsHealth()) as typeof health;
    } catch {
      // health endpoint can be add-on gated; the account list is enough
    }
    for (const account of accounts) {
      const accountHealth = health.accounts?.find((h) => h.accountId === account.id);
      const healthNote = accountHealth?.needsReconnect
        ? ' — needs a reconnect (ask us in chat for the link)'
        : accountHealth
          ? ` — ${accountHealth.status}`
          : account.isActive
            ? ' — active'
            : ' — inactive';
      console.log(`  • ${platformLabel(account.platform)}  @${account.username ?? '?'}${healthNote}`);
    }
    if (accounts.length === 0) {
      // Without a connected social there is nothing to post to and nothing
      // to map — stop here (the key step stays undone, so the re-run lands
      // right back on this check without re-asking for the key).
      say(
        `Your key works, but no social accounts are connected yet, so there is nothing for us to run. Connect TikTok, Instagram, YouTube, or X at ${GET_KEY_URL}, then run us again, and we pick up right here.`,
      );
      process.exit(0);
    }
    markStepDone(state, 'key');
    await saveState(paths.setupStateJson, state);
  }
  return client!;
}

/**
 * Materialize the workspace from the two answers plus what the key can see,
 * then point the user at their marketing agent. No questions asked here:
 * the profile map comes straight from the connected accounts, the timezone
 * from the machine, and the pathway defaults to local until the agent and
 * the user decide otherwise in chat.
 */
async function stepFinish(client: CreatorOSClient, paths: SocialAgentsPaths, state: InterviewState): Promise<SocialAgentsConfig> {
  const { accounts } = await client.listAccounts();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  // A worker auth token exists from day one, so a later switch to Railway
  // in chat has everything it needs (provision-railway reads worker.token).
  const workerToken = state.answers.pathway?.workerToken ?? randomBytes(24).toString('hex');
  state.answers.pathway = { automationTarget: 'local', timezone, workerToken, ...state.answers.pathway };

  // Profile map — straight from the API, the user never re-types handles.
  state.answers.profiles = accounts.map((a: SocialAccount) => ({
    accountId: a.id,
    platform: a.platform,
    username: a.username ?? '',
  }));
  await writeFile(paths.profilesMd, renderProfilesMd(accounts), 'utf8');

  // The key is pinned to one workspace; remember which, for the dashboard.
  const workspaceId = (await client.getMe().catch(() => null))?.workspace?.id;
  const config: SocialAgentsConfig = {
    version: 1,
    mode: state.answers.mode ?? 'creator',
    // The form never asks about AI — the built-in `social-agents` chat defaults to
    // Claude and reconfigures itself lazily on first launch if needed.
    brain: { provider: 'claude' },
    automationTarget: 'local',
    timezone,
    ...(workspaceId ? { workspaceId } : {}),
    worker: { token: workerToken },
    // No automations are configured at onboarding — the user picks their
    // set in the first chat, and the agent fills these in with sign-off.
    funnel: { enabled: false, keywords: [], matchMode: 'contains', dmMessage: '', scope: 'account-wide', accountIds: [] },
    onboardedAt: new Date().toISOString(),
  };
  await saveConfig(paths.configJson, config);

  // Skills, knowledge base, content library, and the pre-filled Railway
  // guide (used only if the agent and user pick the cloud pathway later).
  await mkdir(paths.knowledgeDir, { recursive: true });
  const skillsTemplate = join(TEMPLATES_DIR, 'skills');
  if (existsSync(skillsTemplate)) {
    await cp(skillsTemplate, paths.skillsDir, { recursive: true });
  }
  if (!existsSync(paths.tutorialsMd)) {
    await writeFile(paths.tutorialsMd, renderTutorialsMd(), 'utf8');
  }
  await mkdir(paths.contentLibraryDir, { recursive: true });
  await writeFile(join(paths.socialAgentsDir, 'RAILWAY.md'), renderRailwayGuide({ timezone, workerToken }), 'utf8');

  // CLAUDE.md at the repo root — the briefing ANY agent opened in this
  // folder reads automatically — plus the initialization prompt for agents
  // that don't read it on their own.
  await writeFile(paths.claudeMd, renderClaudeMd(state), 'utf8');
  const setupPrompt = renderSetupPrompt(state);
  await writeFile(
    join(paths.socialAgentsDir, 'SETUP_PROMPT.md'),
    `# Initialization Prompt\n\nOnboarding is done and the workspace is written. The built-in \`social-agents\` chat\nstarts from this on its own. For any other agent opened in this folder, send\nthis as the first message:\n\n\`\`\`\n${setupPrompt}\n\`\`\`\n`,
    'utf8',
  );

  markStepDone(state, 'finish');
  await saveState(paths.setupStateJson, state);

  say(
    `That's the whole form. Your workspace is on disk (CLAUDE.md + social-agents/) with ${accounts.length} connected account(s) mapped, and your marketing agents are ready.

Come talk to us. We take it from here:
  • we interview you about your brand (what you sell, voice, audience, competitors)
  • we ask where automations should live (this Mac, or an always-on cloud worker we build for you)
  • we offer the automation menu and set up only what you approve

Start the chat with:   social-agents        (or: npm start creatoros social-agents)
Or open \`claude\` in this folder: it reads CLAUDE.md and picks up the same brief.`,
  );
  return config;
}
