/**
 * The onboarding form — deliberately tiny:
 *   1. Do you have a CreatorOS API key? (yes / no)
 *   2. How many?
 *   3. Each key, validated live. One key = one CreatorOS workspace = one set
 *      of connected socials, and each gets its own workspace folder.
 * Everything else — the brand pack, the automation pathway, the automation
 * menu — is a conversation with the agents afterwards, per workspace,
 * because a form is the worst place to have it. Resumable: state saves
 * after every key.
 */
import { confirm, input, password } from '@inquirer/prompts';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreatorOSClient, isLegacyKey, isValidKeyShape, LegacyApiKeyError } from '../client/client.js';
import { platformLabel } from '../client/platformMatrix.js';
import type { Me, SocialAccount } from '../client/types.js';
import { maskKey } from '../util/mask.js';
import { socialAgentsPaths } from '../paths.js';
import { findExistingKey, saveWorkspaceKey } from '../config/credentials.js';
import { saveConfig, type SocialAgentsConfig } from '../config/socialAgentsConfig.js';
import {
  listWorkspaces,
  setupStatePath,
  slugify,
  workspaceRoot,
  type WorkspaceEntry,
} from '../workspaces.js';
import { clearState, isStepDone, loadState, markStepDone, saveState, type InterviewState, type SetupWorkspace } from './state.js';
import {
  renderClaudeMd,
  renderProfilesMd,
  renderRailwayGuide,
  renderRootIndexMd,
  renderSetupPrompt,
  renderTutorialsMd,
} from './render.js';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');
const GET_KEY_URL = 'https://www.creatoros.ca/';
const MAX_KEYS = 10;

function say(text: string): void {
  console.log(`\n${text}`);
}

export interface InterviewResult {
  workspaces: WorkspaceEntry[];
}

/**
 * First run (or `npm start creatoros add`): collect keys, then write one
 * workspace folder per key. `adding` skips the greeting and the yes/no.
 */
export async function runInterview(repoRoot: string = process.cwd(), opts: { adding?: boolean } = {}): Promise<InterviewResult> {
  // Adding keys later keeps its own scratch state: a cancelled `add` must
  // never make the next launch think first-run setup is unfinished.
  const statePath = opts.adding ? join(dirname(setupStatePath(repoRoot)), '.add-state.json') : setupStatePath(repoRoot);
  const state = opts.adding ? freshState() : await loadState(statePath);
  const resuming = !opts.adding && state.completed.length + (state.answers.workspaces?.length ?? 0) > 0;

  if (!opts.adding) {
    say(
      resuming
        ? `Social Agents here, picking up where we left off.`
        : `Hey, we're Social Agents, your marketing team of AI agents. Setup is just your CreatorOS API key(s). Everything else we figure out together in chat.

What CreatorOS is: the service we run on. It holds your connected socials and does the actual posting, replying, and analytics. We're the agents that drive it. Each CreatorOS API key is one set of socials, and gets its own workspace here:
  1. Sign up at ${GET_KEY_URL}
  2. Connect your social accounts there
  3. Settings, API keys: copy the key (it starts with cos_live_)
     (or run \`npx @creatoros/cli init\` and we'll find it)`,
    );
  }

  if (!isStepDone(state, 'keys')) {
    await stepKeys(state, statePath, repoRoot, opts.adding === true);
  }

  const workspaces = await stepFinish(repoRoot, state, statePath);
  return { workspaces };
}

function freshState(): InterviewState {
  return { completed: [], answers: {} };
}

async function stepKeys(state: InterviewState, statePath: string, repoRoot: string, adding: boolean): Promise<void> {
  if (!adding && state.answers.keyCount === undefined) {
    const hasKey = await confirm({ message: 'Do you have a CreatorOS API key?', default: true });
    if (!hasKey) {
      say(`No problem. Get one at ${GET_KEY_URL}: sign up, connect your socials, then Settings, API keys (or run \`npx @creatoros/cli init\`). Run us again and we pick up right here.`);
      process.exit(0);
    }
  }

  if (state.answers.keyCount === undefined) {
    const count = await input({
      message: adding
        ? 'How many CreatorOS API keys are you adding?'
        : 'How many CreatorOS API keys do you have? (each key is one set of CreatorOS socials)',
      default: '1',
      validate: (value) => {
        const n = Number(value.trim());
        return (Number.isInteger(n) && n >= 1 && n <= MAX_KEYS) || `A whole number from 1 to ${MAX_KEYS}.`;
      },
    });
    state.answers.keyCount = Number(count.trim());
    await saveState(statePath, state);
  }

  const collected = state.answers.workspaces ?? [];
  // Workspaces set up earlier count as taken: the same key twice is a mistake.
  const existing = await listWorkspaces(repoRoot);
  const takenIds = new Set([...existing.map((w) => w.workspaceId), ...collected.map((w) => w.workspaceId)]);
  const takenSlugs = new Set([...existing.map((w) => w.slug), ...collected.map((w) => w.slug)]);
  // A key the user already has (env var, or the CreatorOS CLI's config) is offered for key 1.
  let offered = collected.length === 0 && !adding ? await existingKeyOffer() : null;

  while (collected.length < state.answers.keyCount) {
    const n = collected.length + 1;
    const label = state.answers.keyCount > 1 ? ` ${n} of ${state.answers.keyCount}` : '';
    let key: string | null = null;
    if (offered) {
      const use = await confirm({
        message: `Found a CreatorOS API key in ${offered.source} (${maskKey(offered.key)}). Use it as key${label || ' 1'}?`,
        default: true,
      });
      if (use) key = offered.key;
      offered = null;
    }
    const { client, me, apiKey } = await collectValidKey(`Paste CreatorOS API key${label}:`, key);
    const workspaceId = me.workspace!.id;
    const name = me.workspace!.name?.trim() || `Workspace ${n}`;
    if (takenIds.has(workspaceId)) {
      console.log(`That key belongs to "${name}", which is already set up. Paste a key for a different set of socials.`);
      continue;
    }
    await showAccounts(client, name);
    await saveWorkspaceKey({ workspaceId, name, apiKey });
    const slug = slugify(name, takenSlugs);
    takenIds.add(workspaceId);
    takenSlugs.add(slug);
    collected.push({ workspaceId, name, slug });
    state.answers.workspaces = collected;
    await saveState(statePath, state);
  }

  markStepDone(state, 'keys');
  await saveState(statePath, state);
}

async function existingKeyOffer(): Promise<{ key: string; source: string } | null> {
  try {
    return await findExistingKey();
  } catch (error) {
    if (!(error instanceof LegacyApiKeyError)) throw error;
    say(error.message);
    return null;
  }
}

/** Shape check + live check, on a loop until a key passes. `preset` skips the paste. */
async function collectValidKey(
  promptMessage: string,
  preset: string | null,
): Promise<{ client: CreatorOSClient; me: Me; apiKey: string }> {
  let candidate = preset;
  while (true) {
    const key = (candidate ?? (await password({ message: promptMessage, mask: '*' }))).trim();
    candidate = null;
    if (!isValidKeyShape(key)) {
      console.log(
        isLegacyKey(key)
          ? `That's an old sk_ key, which no longer works. Get a cos_live_ key from ${GET_KEY_URL} under Settings, API keys (or run \`npx @creatoros/cli init\`).`
          : `That doesn't look like a CreatorOS API key (expected cos_live_ followed by 32 characters). Copy it from ${GET_KEY_URL} under Settings, API keys.`,
      );
      continue;
    }
    const client = new CreatorOSClient({ apiKey: key });
    process.stdout.write(`Checking ${maskKey(key)} against CreatorOS... `);
    const me = await client.getMe().catch((error: { status?: number }) => {
      if (error.status === 401 || error.status === 403) return null;
      throw error;
    });
    if (!me) {
      console.log(`rejected. Double-check it at ${GET_KEY_URL} (Settings, API keys) and paste it again.`);
      continue;
    }
    if (!me.workspace?.id) {
      console.log(`valid, but CreatorOS hasn't finished setting up its workspace yet. Open ${GET_KEY_URL}, finish setup, then paste it again.`);
      continue;
    }
    console.log('valid.');
    return { client, me, apiKey: key };
  }
}

/** The socials behind a key, with health, so the user sees what they just connected. */
async function showAccounts(client: CreatorOSClient, name: string): Promise<void> {
  const { accounts } = await client.listAccounts();
  let health: { accounts?: Array<{ accountId: string; status: string; needsReconnect?: boolean }> } = {};
  try {
    health = (await client.accountsHealth()) as typeof health;
  } catch {
    // health can be plan-gated; the account list is enough
  }
  if (accounts.length === 0) {
    say(`"${name}" has no connected socials yet. We'll set it up anyway; connect them at ${GET_KEY_URL} and we'll see them next time.`);
    return;
  }
  say(`"${name}": ${accounts.length} connected account(s):`);
  for (const account of accounts) {
    const accountHealth = health.accounts?.find((h) => h.accountId === account.id);
    const note = accountHealth?.needsReconnect
      ? ' — needs a reconnect (ask us in chat for the link)'
      : accountHealth
        ? ` — ${accountHealth.status}`
        : account.isActive
          ? ' — active'
          : ' — inactive';
    console.log(`  • ${platformLabel(account.platform)}  @${account.username ?? '?'}${note}`);
  }
}

/**
 * Materialize one workspace folder per collected key, plus the repo-root
 * index. No questions asked here: the profile map comes straight from the
 * connected accounts, the timezone from the machine, and the pathway
 * defaults to local until the agents and the user decide otherwise in chat.
 */
async function stepFinish(repoRoot: string, state: InterviewState, statePath: string): Promise<WorkspaceEntry[]> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const pending = state.answers.workspaces ?? [];
  for (const workspace of pending) {
    await writeWorkspace(repoRoot, workspace, timezone);
  }

  const workspaces = await listWorkspaces(repoRoot);
  const index = renderRootIndexMd(workspaces);
  await writeFile(join(repoRoot, 'CLAUDE.md'), index, 'utf8');
  await writeFile(join(repoRoot, 'AGENTS.md'), index, 'utf8');

  markStepDone(state, 'finish');
  await saveState(statePath, state);
  if (statePath !== setupStatePath(repoRoot)) await clearState(statePath);

  const names = pending.map((w) => `  • ${w.name}   (workspaces/${w.slug}/)`).join('\n');
  say(
    `That's the whole form. ${pending.length === 1 ? 'Your workspace is' : `Your ${pending.length} workspaces are`} on disk, one per API key:
${names}

Come talk to us. In each workspace we take it from here:
  • we interview you about the brand (what you sell, voice, audience, competitors)
  • we ask where automations should live (this Mac, or an always-on cloud worker we build for you)
  • we offer the automation menu and set up only what you approve

Start the chat with:   social-agents        (or: npm start creatoros social-agents)${workspaces.length > 1 ? '\n                       you pick the workspace each time' : ''}
Add another API key:   npm start creatoros add
Or open any AI agent (Claude Code, Codex, Cursor...) in a workspace folder: it reads CLAUDE.md or AGENTS.md and picks up that workspace's brief.`,
  );
  return workspaces;
}

async function writeWorkspace(repoRoot: string, workspace: SetupWorkspace, timezone: string): Promise<void> {
  const root = workspaceRoot(repoRoot, workspace.slug);
  const paths = socialAgentsPaths(root);
  await mkdir(paths.socialAgentsDir, { recursive: true });
  const key = (await findExistingKey(workspace.workspaceId))?.key;
  const accounts: SocialAccount[] = key ? (await new CreatorOSClient({ apiKey: key }).listAccounts()).accounts : [];
  await writeFile(paths.profilesMd, renderProfilesMd(accounts), 'utf8');

  // A worker auth token exists from day one, so a later switch to Railway
  // in chat has everything it needs (provision-railway reads worker.token).
  const workerToken = randomBytes(24).toString('hex');
  const pathway = { automationTarget: 'local' as const, timezone, workerToken };
  const config: SocialAgentsConfig = {
    version: 1,
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.name,
    // The form never asks about AI — the built-in `social-agents` chat defaults to
    // Claude and reconfigures itself lazily on first launch if needed.
    brain: { provider: 'claude' },
    automationTarget: 'local',
    timezone,
    worker: { token: workerToken },
    // No automations are configured at onboarding — the user picks their
    // set in the first chat, and the agents fill these in with sign-off.
    funnel: { enabled: false, keywords: [], matchMode: 'contains', dmMessage: '', scope: 'account-wide', accountIds: [] },
    onboardedAt: new Date().toISOString(),
  };
  await saveConfig(paths.configJson, config);

  // Skills, knowledge base, content library, and the pre-filled Railway
  // guide (used only if the agents and user pick the cloud pathway later).
  await mkdir(paths.knowledgeDir, { recursive: true });
  const skillsTemplate = join(TEMPLATES_DIR, 'skills');
  if (existsSync(skillsTemplate)) await cp(skillsTemplate, paths.skillsDir, { recursive: true });
  if (!existsSync(paths.tutorialsMd)) await writeFile(paths.tutorialsMd, renderTutorialsMd(), 'utf8');
  await mkdir(paths.contentLibraryDir, { recursive: true });
  await writeFile(
    join(paths.socialAgentsDir, 'RAILWAY.md'),
    renderRailwayGuide({ timezone, workerToken, workspaceSlug: workspace.slug }),
    'utf8',
  );

  // CLAUDE.md + AGENTS.md in the workspace folder — the same briefing, so ANY
  // agent opened there (Claude Code, Codex, Cursor...) reads it — plus the
  // initialization prompt for agents that don't read it on their own.
  const brief = renderClaudeMd({ workspaceName: workspace.name, pathway });
  await writeFile(paths.claudeMd, brief, 'utf8');
  await writeFile(paths.agentsMd, brief, 'utf8');
  const setupPrompt = renderSetupPrompt({ pathway, brandDone: false });
  await writeFile(
    join(paths.socialAgentsDir, 'SETUP_PROMPT.md'),
    `# Initialization Prompt\n\nOnboarding is done and the workspace is written. The built-in \`social-agents\` chat\nstarts from this on its own. For any other agent opened in this folder, send\nthis as the first message:\n\n\`\`\`\n${setupPrompt}\n\`\`\`\n`,
    'utf8',
  );
}
