/**
 * Entry point. npm forwards positional args to the start script:
 *   npm start creatoros social-agents
 * First run (no social-agents/ setup): the onboarding interview — a pure form, no
 * AI in it. Finishing writes the workspace (CLAUDE.md + social-agents/) and hands
 * the user an initialization prompt for whatever agent chat they open.
 * Every later run: load the saved setup and enter the Social Agents REPL.
 * Setup is resumable — killing the process mid-interview and re-running
 * resumes where it left off.
 */
import { existsSync } from 'node:fs';
import { migrateLegacyWorkspace, socialAgentsPaths } from './paths.js';
import { loadConfig } from './config/socialAgentsConfig.js';
import { loadState, isInterviewComplete } from './onboarding/state.js';
import { resolveApiKey } from './config/credentials.js';
import { CreatorOSClient } from './client/client.js';

export type Route = 'social-agents' | 'dashboard' | 'usage';

/**
 * Route on positional args: `creatoros social-agents`, `creatoros social agents`,
 * `creatoros dashboard`. `creatoros midas` still works for pre-rename muscle memory.
 */
export function routeArgs(argv: string[]): Route {
  const args = argv.filter((a) => a !== '--');
  const index = args.indexOf('creatoros');
  if (index === -1) return 'usage';
  const command = args.slice(index + 1, index + 3).join(' ').toLowerCase();
  if (/^(social[- ]?agents|social|midas)\b/.test(command)) return 'social-agents';
  if (command.split(' ')[0] === 'dashboard') return 'dashboard';
  return 'usage';
}

export function usage(): string {
  return [
    'Social Agents: your CreatorOS agents.',
    '',
    'Usage:',
    '  npm start creatoros social-agents  start Social Agents (first run = onboarding interview)',
    '  npm start creatoros social agents  same thing',
    '  npm start creatoros dashboard      the Social Agents dashboard — automations, workflows, analytics, chat in the browser',
    '  social-agents                      open a session from any terminal (run `npm link` once to enable)',
    '  social-agents dashboard            same dashboard, from anywhere',
    '',
    'Sessions are independent conversations — open as many terminals as you like;',
    'they all share the same social-agents/ workspace, brand pack, and credentials.',
  ].join('\n');
}

async function main(): Promise<void> {
  migrateLegacyWorkspace();
  const route = routeArgs(process.argv.slice(2));
  if (route === 'usage') {
    console.log(usage());
    return;
  }

  if (route === 'dashboard') {
    await runDashboard();
    return;
  }

  const paths = socialAgentsPaths();
  const state = await loadState(paths.setupStateJson);
  const setupDone =
    existsSync(paths.socialAgentsDir) && existsSync(paths.configJson) && isInterviewComplete(state);

  if (!setupDone) {
    // First run: CreatorOS animation → Social Agents animation → capability
    // checkmarks → the interview. Resumed interviews skip the show.
    if (state.completed.length === 0) {
      const { showIntro } = await import('./ui/banner.js');
      await showIntro();
    }
    const { runInterview } = await import('./onboarding/interview.js');
    await runInterview(paths.root);
    // The form is done and the workspace is on disk — the harness's job
    // ends here. No agent launches from onboarding: the user opens their
    // own chat(s) and sends the initialization prompt.
    // The form already printed the handoff — the user's next move is to
    // talk to the agent (`social-agents`), which runs the brand interview itself.
    return;
  }

  const apiKey = await resolveApiKey();
  if (!apiKey) {
    console.error(
      'No CreatorOS API key found. Set CREATOROS_API_KEY or re-run setup (delete social-agents/.setup-state.json).',
    );
    process.exitCode = 1;
    return;
  }
  const client = new CreatorOSClient({ apiKey });
  const config = await loadConfig(paths.configJson);
  const { runRepl } = await import('./agent/repl.js');
  await runRepl(client, config, paths.root);
}

/** `social-agents dashboard` — the same server `npm run dashboard` boots. Zero-config:
 * missing credentials render a connect state instead of crashing. */
async function runDashboard(): Promise<void> {
  const { startDashboard, openBrowser } = await import('../dashboard/server.js');
  const { url } = await startDashboard(socialAgentsPaths().root);
  console.log(`\nSocial Agents Dashboard → ${url}`);
  console.log('\x1b[2mAutomations, workflows, brand, training, logs, and Social Agents chat. Ctrl-C stops it.\x1b[0m');
  openBrowser(url);
  // Keep the process alive until the user stops it.
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log('\nDashboard stopped. Your automations keep running on their schedules.');
      resolve();
    });
  });
}

// Only run when executed directly (not when imported by tests).
const invokedDirectly = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (invokedDirectly) {
  main().catch((error) => {
    if ((error as Error).name === 'ExitPromptError') {
      // Ctrl-C mid-interview — state is saved; next run resumes.
      console.log('\nPaused. Run `npm start creatoros social-agents` to pick up where you left off.');
      return;
    }
    console.error(`Social Agents crashed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
