/**
 * The onboarding interview — Midas holding the user's hand on day one.
 * Conversational, one question at a time; every answer lands in a file
 * Midas reads forever after. Resumable: state saves after every step.
 */
import { confirm, input, password, select } from '@inquirer/prompts';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreatorOSClient, isValidKeyShape } from '../client/client.js';
import { platformLabel } from '../client/platformMatrix.js';
import type { SocialAccount } from '../client/types.js';
import { maskKey } from '../util/mask.js';
import { midasPaths, type MidasPaths } from '../paths.js';
import {
  resolveApiKey,
  resolveRailwayToken,
  resolveWorkerAiCredential,
  saveApiKey,
  saveCredentials,
  saveRailwayToken,
} from '../config/credentials.js';
import { provisionRailwayWorker } from '../automations/railwayProvision.js';
import { saveConfig, type MidasConfig } from '../config/midasConfig.js';
import {
  isStepDone,
  loadState,
  markStepDone,
  saveState,
  type BrandAnswers,
  type InterviewState,
} from './state.js';
import {
  describeWorkerHealth,
  parseProducts,
  renderBrandMd,
  renderClaudeMd,
  renderProfilesMd,
  renderRailwayGuide,
  renderSetupPrompt,
  renderSetupSummary,
  renderTutorialsMd,
} from './render.js';
import { askBlock, askList } from '../ui/prompts.js';
import { fetchWorkerState } from '../dashboard/worker.js';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');

function say(text: string): void {
  console.log(`\n${text}`);
}

export interface InterviewResult {
  client: CreatorOSClient;
  config: MidasConfig;
}

export async function runInterview(root: string = process.cwd()): Promise<InterviewResult> {
  const paths = midasPaths(root);
  await mkdir(paths.midasDir, { recursive: true });
  const state = await loadState(paths.setupStateJson);
  const resuming = state.completed.length > 0;

  say(
    resuming
      ? `Midas here — picking up where we left off. ${state.completed.length} step(s) already done.`
      : "Hey — I'm Midas. I run your social presence on CreatorOS: posting at scale, automations, replies, analytics. This form is just the briefing — no AI setup here, no API keys for a model. When it's done I write your whole workspace to disk (CLAUDE.md + midas/), and you hand ANY agent chat the initialization prompt. About five minutes.",
  );

  // ---- Creator or agency ----
  if (!isStepDone(state, 'mode')) {
    await stepMode(state);
    await saveState(paths.setupStateJson, state);
  }

  // ---- Key(s) + accounts ----
  const client = await stepKey(paths, state);

  // ---- The infrastructure call — with both keys in hand, the finish
  // step can provision Railway and light up the dashboard ----
  if (!isStepDone(state, 'pathway')) {
    await stepPathway(state, paths);
    await saveState(paths.setupStateJson, state);
  }

  // ---- Step 2: brand pack ----
  if (!isStepDone(state, 'brand')) {
    state.answers.brand = await stepBrand();
    await writeFile(paths.brandMd, renderBrandMd(state.answers.brand), 'utf8');
    markStepDone(state, 'brand');
    await saveState(paths.setupStateJson, state);
    say(`Brand pack saved to midas/BRAND.md — everything I write flows from it.`);
  }

  // ---- Step 3: profile map ----
  let accounts: SocialAccount[] = [];
  if (!isStepDone(state, 'profiles')) {
    accounts = await stepProfiles(client, paths, state);
  } else {
    accounts = (await client.listAccounts()).accounts;
  }

  // ---- Finish in character ----
  const config = await stepFinish(client, paths, state, accounts);
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
        "That doesn't look like a CreatorOS API key (expected sk_ + 64 hex characters). Check the CreatorOS app under Settings → API Key.",
      );
      continue;
    }
    const client = new CreatorOSClient({ apiKey: key });
    process.stdout.write(`Checking ${maskKey(key)} against CreatorOS servers... `);
    const valid = await client.validateKey();
    if (!valid) {
      console.log('rejected. Double-check it in the CreatorOS app and paste it again.');
      continue;
    }
    console.log('valid.');
    return { key, client };
  }
}

const MAX_AGENCY_KEYS = 10;
const GET_KEY_URL = 'https://creatoros.ca';

/** Creator: one key. Agency: up to 10 keys, pick who we set up now. */
async function collectKeysInteractively(state: InterviewState): Promise<CreatorOSClient> {
  const plural = state.answers.mode === 'agency' ? '(s)' : '';
  const hasKeys = await confirm({
    message: `Do you have your CreatorOS API key${plural}?`,
    default: true,
  });
  if (!hasKeys) {
    say(`Get it at ${GET_KEY_URL} — then run me again and we pick up right here.`);
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

async function stepKey(paths: MidasPaths, state: InterviewState): Promise<CreatorOSClient> {
  let client: CreatorOSClient;

  const envKey = await resolveApiKey();
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
    let health: { accounts?: Array<{ accountId: string; status: string }> } = {};
    try {
      health = (await client!.accountsHealth()) as typeof health;
    } catch {
      // health endpoint can be add-on gated; the account list is enough
    }
    for (const account of accounts) {
      const accountHealth = health.accounts?.find((h) => h.accountId === account._id)?.status;
      const healthNote = accountHealth ? ` — ${accountHealth}` : account.isActive ? ' — active' : ' — inactive';
      console.log(`  • ${platformLabel(account.platform)}  @${account.username ?? '?'}${healthNote}`);
    }
    if (accounts.length === 0) {
      say('No accounts connected yet — connect them in the CreatorOS app, then re-run me. Continuing setup anyway.');
    }
    markStepDone(state, 'key');
    await saveState(paths.setupStateJson, state);
  }
  return client!;
}

async function stepBrand(): Promise<BrandAnswers> {
  say("Now the part that matters most — the brand pack. Everything I ever write for you flows from this, so give it to me straight.");

  const about = await askBlock('What is this brand actually about? What are you marketing?', {
    required: true,
  });
  const productsRaw = await askBlock(
    'What do you sell? One offer per line as "link, what it is" — e.g. "https://shop.example/guide, my $29 training guide". No link yet? Just describe it.',
    { required: true },
  );
  const products = parseProducts(productsRaw);
  const adjectivesRaw = await input({
    message: 'Your voice in three adjectives (comma-separated):',
    validate: (v) => v.split(',').filter((s) => s.trim()).length >= 3 || 'Give me three.',
  });
  const voiceNever = await input({
    message: 'And one "never" — what should my copy never sound like?',
    validate: (v) => v.trim().length > 0 || 'One thing, e.g. "corporate" or "thirsty".',
  });
  const emojiPolicy = await select({
    message: 'Emoji policy:',
    choices: [
      { name: 'None — clean text only', value: 'none' },
      { name: 'Sparingly — max one per caption', value: 'sparingly (max one per caption)' },
      { name: 'Free — emojis are part of the voice', value: 'free — part of the voice' },
    ],
  });
  const hashtagPolicy = await select({
    message: 'Hashtag policy:',
    choices: [
      { name: 'None', value: 'none' },
      { name: 'A few relevant ones (2-4)', value: 'a few relevant ones (2-4)' },
      { name: 'Aggressive — as many as the platform tolerates', value: 'aggressive' },
    ],
  });
  const audience = await askBlock('Target audience in one sentence:', { required: true });
  const competitors = await askList(
    'Competitor accounts to watch — handles or URLs, up to 5 (empty line to skip):',
    { max: 5 },
  );

  return {
    about,
    products,
    voiceAdjectives: adjectivesRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    voiceNever: voiceNever.trim(),
    emojiPolicy,
    hashtagPolicy,
    audience,
    competitors,
  };
}

async function stepProfiles(
  client: CreatorOSClient,
  paths: MidasPaths,
  state: InterviewState,
): Promise<SocialAccount[]> {
  say('Profile map — I post to account IDs, so let me confirm each handle.');
  const { accounts } = await client.listAccounts();
  const confirmed: Array<{ accountId: string; platform: string; username: string }> = [];
  for (const account of accounts) {
    const username = await input({
      message: `${platformLabel(account.platform)} username:`,
      default: account.username ?? '',
    });
    confirmed.push({ accountId: account._id, platform: account.platform, username: username.trim() });
  }
  state.answers.profiles = confirmed;
  await writeFile(
    paths.profilesMd,
    renderProfilesMd(confirmed.map((c) => ({ _id: c.accountId, platform: c.platform as SocialAccount['platform'], username: c.username }))),
    'utf8',
  );
  markStepDone(state, 'profiles');
  await saveState(paths.setupStateJson, state);
  say('Profile map saved to midas/PROFILES.md.');
  return accounts;
}

async function stepPathway(state: InterviewState, paths: MidasPaths): Promise<void> {
  say(
    'First infrastructure call, and it shapes everything after it: where does your automation system live?',
  );
  say(
    'Why I recommend Railway: automations are only as reliable as the machine they run on. ' +
      "A laptop that's asleep at post time misses the post — and the comment, and the DM sitting behind it. " +
      'The Railway worker keeps your agent alive 24/7 in the cloud, so engagement gets answered the moment it happens. ' +
      'Local is great for trying things out on your Claude plan; the cloud is where the agent actually earns its keep.',
  );
  const automationTarget = await select({
    message: 'Automation pathway:',
    choices: [
      {
        name: 'Railway (recommended) — one always-on cloud worker runs everything; your machine can be off; scales from solo to client work',
        value: 'railway' as const,
      },
      {
        name: 'Local (this Mac) — free, runs on your Claude plan; the machine must be awake at scheduled times',
        value: 'local' as const,
      },
    ],
  });
  const timezone = (
    await input({
      message: 'Your timezone (IANA name — schedules run in it):',
      default: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    })
  ).trim();

  if (automationTarget === 'local') {
    say('Local it is — runs use your Claude plan through the claude CLI, no extra keys. Switch to Railway any time by re-running setup or asking me in chat.');
    state.answers.pathway = { automationTarget, timezone };
    markStepDone(state, 'pathway');
    return;
  }

  // Railway: the user's only job is creating the account — with their API
  // token the AGENT provisions the whole environment (project, upload,
  // variables, domain) in the first chat. Already deployed → verify LIVE
  // right here. No token, no deploy → guide fallback.
  say(
    'Cloud it is. The whole setup boils down to two keys that power the engine up there:\n' +
      '  1. Your CreatorOS key ✓ — already have it from a minute ago. That\'s how the worker posts and replies.\n' +
      "  2. An AI key — the worker's brain. NOT this form's business: after setup, your agent asks for it in chat\n" +
      '     (an Anthropic API key, or a Claude plan token from `claude setup-token`) and installs it — no redeploy.',
  );
  say(
    "The building itself is my job, not yours. Create a Railway account (railway.app, the Hobby plan is fine), grab an API token at railway.app/account/tokens (an account token — a project-scoped one can't create new projects), and paste it here — in our first chat I'll assemble everything: project created, this workspace uploaded, both keys installed, live URL generated and health-checked.",
  );
  const railwayApiToken = (
    await password({
      message: 'Railway API token (blank — skip, and I\'ll give you a manual deploy guide instead):',
      mask: '*',
    })
  ).trim();
  if (railwayApiToken) {
    await saveRailwayToken(railwayApiToken);
    say('Token saved securely to ~/.midas (never into this repo).');
  }

  const workerUrl = (
    await input({
      message: "Already have a Railway worker running? Paste its URL (blank — not yet, I'll build it):",
    })
  ).trim();

  let workerToken: string | undefined;
  if (workerUrl) {
    workerToken =
      (await password({
        message: 'The MIDAS_WORKER_TOKEN you set on that service (blank if you did not set one):',
        mask: '*',
      })).trim() || undefined;
    process.stdout.write(`Checking the worker at ${workerUrl} ... `);
    const worker = await fetchWorkerState(workerUrl, workerToken);
    if (worker.reachable && worker.health) {
      console.log('live.');
      say(`Worker verified. ${describeWorkerHealth(worker.health)}`);
    } else {
      console.log('unreachable.');
      say(
        "Couldn't reach /health there — saving it anyway. Check the URL and token, then tell me \"verify my worker\" in chat; midas/RAILWAY.md has the full checklist.",
      );
    }
  } else {
    workerToken = randomBytes(24).toString('hex');
  }

  const railwayServiceId = railwayApiToken || workerUrl
    ? ''
    : (
        await input({
          message: 'Railway service ID, for live deploy status on the dashboard (blank to skip):',
        })
      ).trim();

  if (!workerUrl) {
    await mkdir(paths.midasDir, { recursive: true });
    await writeFile(join(paths.midasDir, 'RAILWAY.md'), renderRailwayGuide({ timezone, workerToken: workerToken! }), 'utf8');
    say(
      railwayApiToken
        ? `Everything on my side is staged: worker auth token generated, deploy plan written to midas/RAILWAY.md as the reference. The deploy runs AUTOMATICALLY at the end of this setup — a few more questions and you'll watch it build.

Once it's live: automations you pick in chat land in midas/automations.json, and I ship changes to the worker with a quick sync each time — you never touch Railway again.`
        : `Everything I can do without you is done: your worker auth token is generated and the full deploy guide is at midas/RAILWAY.md — every value pre-filled, ~10 minutes of copy-paste on railway.app. (Shortcut: paste a Railway API token in chat any time and I'll do the whole deploy for you.)

How it works once deployed: the worker re-reads midas/automations.json every 30 seconds, so automations you pick in our chat start running the moment it's live — no restarts, no redeploys, ever. Its /health endpoint (and the dashboard's Automations page) shows the loaded schedule with next-run times. Want a preview first? \`npm run worker\` runs the same thing right here on this machine.`,
    );
  }

  state.answers.pathway = {
    automationTarget,
    timezone,
    workerToken,
    workerUrl: workerUrl || undefined,
    railwayServiceId: railwayServiceId || undefined,
    railwayTokenSaved: Boolean(railwayApiToken),
  };
  markStepDone(state, 'pathway');
}

async function stepFinish(
  client: CreatorOSClient,
  paths: MidasPaths,
  state: InterviewState,
  accounts: SocialAccount[],
): Promise<MidasConfig> {
  const pathway = state.answers.pathway ?? { automationTarget: 'local' as const, timezone: 'UTC' };

  // Hands-free Railway: everything was collected up front, so the deploy
  // happens HERE — the user watches, they don't click. Failure never fails
  // onboarding; chat (provision-railway skill) is the retry vehicle.
  let provisionedUrl: string | undefined;
  let provisionedServiceId: string | undefined;
  if (
    pathway.automationTarget === 'railway' &&
    !pathway.workerUrl &&
    pathway.railwayTokenSaved &&
    pathway.workerToken
  ) {
    const railwayToken = await resolveRailwayToken();
    const creatorosKey = await resolveApiKey();
    if (railwayToken && creatorosKey) {
      // The environment ALWAYS deploys at the end of onboarding — no
      // automations required, no AI credential required. The form never
      // asks for an AI key; one may still exist in ~/.midas from a prior
      // run, and a missing key just means the worker idles until the
      // agent installs one in chat.
      const ai = (await resolveWorkerAiCredential()) ?? null;
      if (ai && state.answers.pathway) state.answers.pathway.aiCredentialSaved = true;
      say('Building your Railway environment now — sit back, this is the part you never have to do.');
      const result = await provisionRailwayWorker(
        {
          workspaceRoot: paths.root,
          railwayToken,
          timezone: pathway.timezone,
          workerToken: pathway.workerToken,
          creatorosKey,
          ai,
        },
        (line) => console.log(`  ${line}`),
      );
      if (result.ok) {
        provisionedUrl = result.url;
        provisionedServiceId = result.serviceId;
        say(
          result.healthy
            ? `Railway worker is LIVE at ${result.url} — /health verified. Automations you pick in chat run in the cloud from now on.`
            : `Railway accepted the deploy — the worker is building and will come up at ${result.url}. The dashboard's Automations page shows it the moment it's live.`,
        );
        if (!ai) {
          say(
            'One thing missing, on purpose: the worker has no AI key yet, so it idles (alive, but not thinking). Hand one to your agent in chat — an Anthropic API key or a `claude setup-token` token — and it installs in seconds, no redeploy.',
          );
        } else if (ai.kind === 'ANTHROPIC_API_KEY') {
          say(
            '⚠ That key bills per use and the worker runs unattended — if you haven\'t already, set a spend limit at console.anthropic.com → Billing → Limits.',
          );
        }
      } else {
        say(
          `Provisioning hit a wall (${result.error}). No stress — everything is saved; say "build my Railway worker" in our chat and I'll pick it up from the failed step.`,
        );
      }
    }
  }

  // Persist config + knowledge scaffolding — the durable artifacts.
  const profileId = typeof accounts[0]?.profileId === 'string' ? accounts[0]?.profileId : accounts[0]?.profileId?._id;
  const config: MidasConfig = {
    version: 1,
    mode: state.answers.mode ?? 'creator',
    // The form never asks about AI — the built-in `midas` chat defaults to
    // Claude and reconfigures itself lazily on first launch if needed.
    brain: { provider: 'claude' },
    automationTarget: pathway.automationTarget,
    timezone: pathway.timezone,
    profileId,
    ...(pathway.automationTarget === 'railway' && (pathway.workerUrl || provisionedUrl || pathway.workerToken)
      ? { worker: { url: pathway.workerUrl ?? provisionedUrl, token: pathway.workerToken } }
      : {}),
    ...(pathway.railwayServiceId || provisionedServiceId
      ? { railway: { serviceId: pathway.railwayServiceId ?? provisionedServiceId } }
      : {}),
    // No automations are configured at onboarding — the user picks their
    // set in the first chat, and the agent fills these in with sign-off.
    funnel: { enabled: false, keywords: [], matchMode: 'contains', dmMessage: '', scope: 'account-wide', accountIds: [] },
    onboardedAt: new Date().toISOString(),
  };
  await saveConfig(paths.configJson, config);

  // Install Midas's skills and knowledge base.
  await mkdir(paths.knowledgeDir, { recursive: true });
  const skillsTemplate = join(TEMPLATES_DIR, 'skills');
  if (existsSync(skillsTemplate)) {
    await cp(skillsTemplate, paths.skillsDir, { recursive: true });
  }
  if (!existsSync(paths.tutorialsMd)) {
    await writeFile(paths.tutorialsMd, renderTutorialsMd(), 'utf8');
  }
  await mkdir(paths.contentLibraryDir, { recursive: true });

  // CLAUDE.md at the repo root — the briefing ANY agent opened in this
  // folder reads automatically. This is what makes the handoff work: the
  // form's answers live in files, so every parallel session starts primed.
  await writeFile(paths.claudeMd, renderClaudeMd(state), 'utf8');

  // Deliberately no automations here: everyone runs a different playbook,
  // so nothing gets created on the user's behalf. The chat is where they
  // pick, and the agent sets up only what they approve.
  say(
    `Setup's done — and on purpose, NOTHING is automated yet. Everyone runs a different playbook, so you pick what turns on. Once we're chatting, say the word and I'll set up any of these, one at a time, with your sign-off:
  • Auto-replies to comments and DMs (I chat in a persona you define)
  • Comments-to-DM funnels (keyword comment → automatic DM with your link)
  • Scheduled content posting from your library
  • Recurring analytics reports
Want none of them? Also fine — everything works manually through chat too.`,
  );
  if (pathway.automationTarget === 'railway' && !pathway.workerUrl && !provisionedUrl) {
    say(
      pathway.railwayTokenSaved
        ? 'Infrastructure: your Railway token is saved, so the deploy is MY job — first thing in chat, say "build my Railway worker" and I\'ll provision the whole environment. Automations you pick are saved either way and start the moment it\'s live.'
        : 'One infrastructure step remains on your side: deploy the worker with midas/RAILWAY.md (10 minutes, every value pre-filled) — or hand me a Railway API token in chat and I\'ll do it for you. Automations you pick are saved either way and start the moment it goes live.',
    );
  }

  // State of the socials: follower stats + recent posts, with an honest read.
  say('Here\'s where your socials actually stand:');
  try {
    const stats = (await client.followerStats()) as {
      accounts?: Array<{ platform: string; username: string; currentFollowers: number; growth: number; growthPercentage: number }>;
    };
    for (const s of stats.accounts ?? []) {
      console.log(
        `  • ${platformLabel(s.platform)} @${s.username}: ${s.currentFollowers} followers (${s.growth >= 0 ? '+' : ''}${s.growth} / ${s.growthPercentage}% last 30 days)`,
      );
    }
  } catch {
    console.log('  (Follower stats need the analytics add-on — data will appear once it\'s active.)');
  }
  try {
    const recent = await client.listPosts({ limit: 5, sortBy: 'created-desc' });
    console.log(`  • ${recent.posts.length} recent post(s) on record via CreatorOS.`);
  } catch {
    // non-fatal
  }

  say(`Setup summary:\n${renderSetupSummary(state)}`);
  say(
    "Honest read: the fastest lever from here is consistency — a full content-library/ and a daily posting automation beats any single viral swing. Drop 10+ clips into content-library/, then tell me \"schedule the week\" or pick your automations. That's my suggested first move.",
  );

  // The handoff: everything answered is now materialized on disk — CLAUDE.md
  // plus midas/ — and this prompt makes an agent act on all of it. The form
  // never touched an AI; the user's own agent chat takes it from here.
  const setupPrompt = renderSetupPrompt(state);
  await writeFile(
    join(paths.midasDir, 'SETUP_PROMPT.md'),
    `# Initialization Prompt\n\nYour onboarding form is done and the workspace files are written. Open an agent\nchat in this folder — \`claude\`, \`midas\`, or any agent that reads CLAUDE.md — and\nsend this as your first message to get everything initialized:\n\n\`\`\`\n${setupPrompt}\n\`\`\`\n`,
    'utf8',
  );
  say(
    `You finished your onboarding form — everything you answered now lives on disk:
  • CLAUDE.md — the briefing any agent in this folder reads automatically
  • midas/ — config, brand pack, profile map, skills, knowledge base
Now send in this prompt to your AI agent and it'll go get everything initialized. Open a chat in this folder — \`claude\`, \`midas\`, whichever agent you run — paste it, and because setup lives in files (not in one chat), you can spin up as many parallel agent sessions as you like. It's also saved to midas/SETUP_PROMPT.md:\n\n${'─'.repeat(60)}\n${setupPrompt}\n${'─'.repeat(60)}`,
  );

  // The dashboard is the home base — offer it running before the goodbye.
  const openDash = await confirm({
    message: 'Open your dashboard now? (your socials, agent, and automations in one place)',
    default: true,
  });
  if (openDash) {
    spawn('npm', ['run', 'dashboard'], { cwd: paths.root, detached: true, stdio: 'ignore' }).unref();
    say('Dashboard launching — it opens in your browser in a few seconds (http://localhost:4180, `midas dashboard` any time).');
  }

  markStepDone(state, 'finish');
  await saveState(paths.setupStateJson, state);
  return config;
}
