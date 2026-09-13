/**
 * Pure renderers for the files Midas reads forever after. Everything
 * Midas writes later — captions, descriptions, CTAs — flows from BRAND.md.
 */
import type { BrandAnswers, InterviewState, ProductOffer } from './state.js';
import type { SocialAccount } from '../client/types.js';
import { platformLabel } from '../client/platformMatrix.js';

/**
 * Parse the combined "what do you sell" answer: one offer per line,
 * `link, explainer` — or just an explainer when there's no link yet.
 */
export function parseProducts(raw: string): ProductOffer[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const commaAt = line.indexOf(',');
      const first = (commaAt === -1 ? line : line.slice(0, commaAt)).trim();
      const rest = commaAt === -1 ? '' : line.slice(commaAt + 1).trim();
      const looksLikeLink = /^(https?:\/\/|www\.)\S+$/i.test(first) || (/^\S+\.\S{2,}/.test(first) && !first.includes(' '));
      if (looksLikeLink) {
        const link = first.startsWith('http') ? first : `https://${first}`;
        return { link, description: rest || first };
      }
      return { description: line };
    });
}

export function renderBrandMd(brand: BrandAnswers): string {
  const competitors =
    brand.competitors.length > 0
      ? brand.competitors.map((c) => `- ${c}`).join('\n')
      : '_None given yet — add handles here and ask Midas to research them._';
  const links =
    brand.products.length > 0
      ? brand.products
          .map((p) => (p.link ? `- ${p.description} — ${p.link}` : `- ${p.description} _(no link yet)_`))
          .join('\n')
      : '_Nothing listed yet — every CTA needs a destination; add offers here as `description — link`._';

  return `# Brand Pack

Midas reads this before writing anything. Every caption, description, and
CTA flows from here. Edit freely — Midas always uses the latest version.

## What this brand is about

${brand.about}

## What we sell — products, services & CTA destinations

${links}

## Voice

- Sounds like: ${brand.voiceAdjectives.join(', ')}
- Never: ${brand.voiceNever}
- Emoji policy: ${brand.emojiPolicy}
- Hashtag policy: ${brand.hashtagPolicy}

## Target audience

${brand.audience}

## Competitors to watch

${competitors}

Research findings live in \`knowledge/COMPETITORS.md\` — ask Midas to refresh them any time.
`;
}

export function renderProfilesMd(
  accounts: Array<Pick<SocialAccount, '_id' | 'platform' | 'username'> & { username?: string }>,
): string {
  const rows = accounts
    .map((a) => `| ${platformLabel(a.platform)} | @${a.username ?? 'unknown'} | \`${a._id}\` |`)
    .join('\n');
  return `# Profile Map

Every post targets account IDs — these are the source of truth. If an
account is reconnected and gets a new ID, update this file (or re-run setup).

| Platform | Username | Account ID |
|---|---|---|
${rows}
`;
}

export function renderTutorialsMd(): string {
  return `# Tutorials Index — KevBuildsApps

Before building an automation pattern it hasn't built before, Midas checks
this index, fetches the tutorial transcript, and follows the taught pattern.

Adding a tutorial is a one-line edit: \`- [Title](URL) — what it teaches\`.

## Index

- _(none yet — add KevBuildsApps YouTube tutorials here as they ship)_
`;
}

/** One human line about a live worker's schedule, for the interview and chat. */
export function describeWorkerHealth(health: {
  automations: Array<{ name: string; enabled: boolean; nextRun: string | null }>;
  running: string | null;
}): string {
  const enabled = health.automations.filter((a) => a.enabled);
  if (enabled.length === 0) {
    return 'No automations scheduled yet — pick them in our chat and the worker starts running them within 30 seconds, no redeploy.';
  }
  const nexts = enabled
    .filter((a) => a.nextRun)
    .sort((a, b) => ((a.nextRun ?? '') < (b.nextRun ?? '') ? -1 : 1))
    .slice(0, 3)
    .map((a) => `${a.name} at ${a.nextRun}`);
  const runningNote = health.running ? ` Right now it's running ${health.running}.` : '';
  return `${enabled.length} automation(s) scheduled${nexts.length ? ` — next up: ${nexts.join(', ')}` : ''}.${runningNote}`;
}

/**
 * The Railway deploy guide, written the moment the user picks the Railway
 * pathway — every value they need is filled in (worker token generated,
 * timezone from their answer), so the deploy is copy-paste.
 */
export function renderRailwayGuide(opts: { timezone: string; workerToken: string }): string {
  return `# Deploy the Midas worker on Railway

One always-on service runs ALL your automations — your machine can be off.
Ten minutes, one time. Every value below is already filled in for you.

Deploy with the Railway CLI from THIS folder — a GitHub deploy can't work
here, because your workspace (midas/) is gitignored and never reaches
GitHub. The CLI uploads the folder itself.

## 1. Create the project and set the variables

From this folder:

\`\`\`
npx -y @railway/cli login
npx -y @railway/cli init --name midas-worker
npx -y @railway/cli variables \\
  --set "CREATOROS_API_KEY=<your CreatorOS API key — CreatorOS app → Settings → API Key>" \\
  --set "ANTHROPIC_API_KEY=<your Anthropic key — or set CLAUDE_CODE_OAUTH_TOKEN from claude setup-token instead>" \\
  --set "MIDAS_WORKER_TOKEN=${opts.workerToken}" \\
  --set "TZ=${opts.timezone}" \\
  --set "RAILWAY_DOCKERFILE_PATH=Dockerfile.worker" \\
  --skip-deploys
\`\`\`

Tip: if you're using a pay-per-use API key, a spend limit at console.anthropic.com → Billing → Limits caps the worker's AI bill. (A Claude plan token rides your plan — no separate bill.)

## 2. Upload and deploy

\`\`\`
npx -y @railway/cli up --detach --no-gitignore
\`\`\`

\`--no-gitignore\` is REQUIRED — without it Railway drops gitignored files,
and midas/ (your config, skills, automations) is gitignored. The
.railwayignore file keeps node_modules, .env, and logs out either way.

## 3. Expose and connect it

1. \`npx -y @railway/cli domain\` — generates the public URL.
2. Tell Midas in chat: "my worker is live at https://<that-domain>" — or paste it
   into \`midas/midas.json\` under \`worker.url\` yourself.
3. Optional, for deploy status on the dashboard: set \`RAILWAY_API_TOKEN\` in the
   dashboard's environment and put the service id in \`midas.json\` → \`railway.serviceId\`.

## 4. Verify

Open the dashboard's Automations page — the "▲ Railway worker" strip should read
**up · on schedule** (its /health should list your automations, not 0).
Automations you create in chat land in \`midas/automations.json\`; after changing
them, sync the deployed worker with \`npx -y @railway/cli up --detach --no-gitignore\`
— or just ask Midas to redeploy.
`;
}

/**
 * The repo-root CLAUDE.md, written when the form finishes. Any agent chat
 * opened in this folder — Claude Code, `midas`, several in parallel — reads
 * it automatically, so the handoff needs no AI wired into the form itself.
 */
export function renderClaudeMd(state: InterviewState): string {
  const pathway = state.answers.pathway;
  const mode = state.answers.mode ?? 'creator';
  return `# Midas — CreatorOS agent workspace

Generated at onboarding — the form's answers live in the files below, never in
any one chat. Sessions are parallel-safe: open as many agent chats here as you
like; files are the source of truth, so re-read before you write.

You are Midas. You run this ${mode === 'agency' ? "agency's client brands" : "creator's brand"} on CreatorOS: posting at
scale, automations, comment & DM replies, analytics.

## Read these first, every session

1. \`midas/midas.json\` — config: mode, timezone, automation pathway, worker.
2. \`midas/BRAND.md\` — the brand pack. Every caption, description, and CTA flows from it.
3. \`midas/PROFILES.md\` — the profile map. Posts target account IDs, never bare handles.

## Not initialized yet?

Onboarding is a two-question form (creator/agency + API key); the real
briefing happens in chat. If \`midas/BRAND.md\` does not exist, your FIRST job is
the brand interview — follow \`midas/skills/brand-interview/SKILL.md\`, write the
file, and get sign-off before writing a single caption.
\`midas/SETUP_PROMPT.md\` is the full initialization brief (brand, pathway,
automation menu, analytics read). If its tasks haven't run yet, execute it.

## The workspace

- \`midas/skills/\` — playbooks, one \`SKILL.md\` each. Before building an automation or workflow, check for a matching skill and follow it. A finished vertical video to post is the \`agent-posts\` skill: run its \`scripts/check-setup.mjs\` first.
- \`midas/knowledge/\` — research base: \`COMPETITORS.md\`, \`TUTORIALS.md\`.
- \`midas/automations.json\` — the schedule. A deployed worker re-reads it every 30 seconds; no restarts needed.
- \`midas/RAILWAY.md\` — pre-filled cloud-worker deploy guide (railway pathway only).
- \`content-library/\` — media staged for posting.

## Ground rules

- Automation pathway: ${pathway?.automationTarget ?? 'local'} · timezone ${pathway?.timezone ?? 'UTC'}.
- Confirm anything that publishes, DMs strangers, or spends money BEFORE it goes live.
- Credentials live in \`~/.midas/credentials.json\` — never print them and never copy them into this repo.
- \`midas/\` is gitignored on purpose: it is the user's private workspace. So is this file.
`;
}

/**
 * The prompt the user hands their AI agent to actually get everything set
 * up — every task traces back to a questionnaire answer already
 * materialized in midas/. Printed at the finish and saved to
 * midas/SETUP_PROMPT.md.
 */
export function renderSetupPrompt(state: InterviewState): string {
  const pathway = state.answers.pathway;
  const brandDone = Boolean(state.answers.brand);

  const tasks: string[] = [];
  if (!brandDone) {
    tasks.push(
      'Interview me about my brand, one question at a time, following the brand-interview skill: what the brand is about, what I sell and where each offer lives, my voice (three adjectives and one "never"), emoji and hashtag policy, target audience, competitors to watch. Write the result to midas/BRAND.md in that skill\'s format and read it back to me for sign-off. Research any competitors I name and write midas/knowledge/COMPETITORS.md.',
    );
  }
  tasks.push(
    'Verify every connected account is healthy (account_health) and flag anything that needs a reconnect.',
  );
  if (pathway?.automationTarget === 'railway' && !pathway.workerUrl) {
    if (pathway.railwayTokenSaved) {
      const aiNote = pathway.aiCredentialSaved
        ? 'My cloud AI credential is ALREADY SAVED in ~/.midas/credentials.json (workerAiKey; workerAiKind names its env var) — use it, do NOT ask me for it again.'
        : 'You will need to ask me for an AI credential for the cloud worker.';
      tasks.push(
        `Provision my Railway worker for me — my Railway API token is saved in ~/.midas. ${aiNote} Follow the provision-railway skill: railway init, upload this workspace with railway up, set every variable, generate the domain, save worker.url + railway.serviceId to midas/midas.json, and verify /health. Never print any secret.`,
      );
    } else {
      tasks.push(
        'My Railway worker is not deployed yet. Walk me through midas/RAILWAY.md step by step when I am ready — or if I give you a Railway API token, provision it yourself via the provision-railway skill. Once live, save the URL to midas/midas.json under worker.url.',
      );
    }
  } else if (pathway?.automationTarget !== 'railway') {
    tasks.push(
      'Ask me where my automations should live: local (this machine, must be awake at scheduled times) or Railway (an always-on cloud worker you build for me from a Railway API token, via the provision-railway skill — recommended for anyone who wants replies answered the moment they land). Save automationTarget and timezone to midas/midas.json. Local is a fine answer.',
    );
  }
  tasks.push(
    `Onboarding set up ZERO automations on purpose — I pick my own set. Walk me through the menu one item at a time and ask what I want: auto-replies to comments and DMs (with a persona I define), comments-to-DM funnels, scheduled content posting, recurring analytics reports. Set up ONLY what I approve on the ${pathway?.automationTarget ?? 'local'} pathway, confirm exact copy with me before anything goes live, save the choices to midas/midas.json, and verify with list_funnels / list_cron_automations. "None for now" is a valid answer — don't push.`,
  );
  tasks.push(
    'Pull follower stats and recent post analytics, then give me an honest state-of-the-socials read with ONE recommended first move.',
  );

  return `Read midas/midas.json and midas/PROFILES.md first${brandDone ? ', and midas/BRAND.md' : ''} — they hold what setup collected. Then, in order:

${tasks.map((task, index) => `${index + 1}. ${task}`).join('\n')}

Confirm anything that publishes or DMs strangers with me before it goes live. Report what you did, what you verified, and what's left.`;
}
