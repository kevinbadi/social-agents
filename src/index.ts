/**
 * Entry point. npm forwards positional args to the start script:
 *   npm start creatoros midas
 * First run (no midas/ setup): the onboarding interview — a pure form, no
 * AI in it. Finishing writes the workspace (CLAUDE.md + midas/) and hands
 * the user an initialization prompt for whatever agent chat they open.
 * Every later run: load the saved setup and enter the Midas REPL.
 * Setup is resumable — killing the process mid-interview and re-running
 * resumes where it left off.
 */
import { existsSync } from 'node:fs';
import { midasPaths } from './paths.js';
import { loadConfig } from './config/midasConfig.js';
import { loadState, isInterviewComplete } from './onboarding/state.js';
import { resolveApiKey } from './config/credentials.js';
import { CreatorOSClient } from './client/client.js';

export type Route = 'midas' | 'dashboard' | 'usage';

/** Route on positional args: `creatoros midas`, `creatoros dashboard`. */
export function routeArgs(argv: string[]): Route {
  const args = argv.filter((a) => a !== '--');
  const index = args.indexOf('creatoros');
  if (index === -1) return 'usage';
  const command = (args[index + 1] ?? '').toLowerCase();
  if (command === 'midas') return 'midas';
  if (command === 'dashboard') return 'dashboard';
  return 'usage';
}

export function usage(): string {
  return [
    'Midas — the CreatorOS agent.',
    '',
    'Usage:',
    '  npm start creatoros midas    start Midas (first run = onboarding interview)',
    '  npm start creatoros midas       same thing, shorter',
    '  npm start creatoros dashboard the Midas dashboard — automations, workflows, analytics, chat in the browser',
    '  midas                           open a session from any terminal (run `npm link` once to enable)',
    '  midas dashboard                 same dashboard, from anywhere',
    '',
    'Sessions are independent conversations — open as many terminals as you like;',
    'they all share the same midas/ workspace, brand pack, and credentials.',
  ].join('\n');
}

async function main(): Promise<void> {
  const route = routeArgs(process.argv.slice(2));
  if (route === 'usage') {
    console.log(usage());
    return;
  }

  if (route === 'dashboard') {
    await runDashboard();
    return;
  }

  const paths = midasPaths();
  const state = await loadState(paths.setupStateJson);
  const setupDone =
    existsSync(paths.midasDir) && existsSync(paths.configJson) && isInterviewComplete(state);

  if (!setupDone) {
    // First run: CreatorOS animation → Midas animation → capability
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
    // talk to the agent (`midas`), which runs the brand interview itself.
    return;
  }

  const apiKey = await resolveApiKey();
  if (!apiKey) {
    console.error(
      'No CreatorOS API key found. Set CREATOROS_API_KEY or re-run setup (delete midas/.setup-state.json).',
    );
    process.exitCode = 1;
    return;
  }
  const client = new CreatorOSClient({ apiKey });
  const config = await loadConfig(paths.configJson);
  const { runRepl } = await import('./agent/repl.js');
  await runRepl(client, config, paths.root);
}

/** `midas dashboard` — the same server `npm run dashboard` boots. Zero-config:
 * missing credentials render a connect state instead of crashing. */
async function runDashboard(): Promise<void> {
  const { startDashboard, openBrowser } = await import('../dashboard/server.js');
  const { url } = await startDashboard(midasPaths().root);
  console.log(`\nMidas Dashboard → ${url}`);
  console.log('\x1b[2mAutomations, workflows, brand, training, logs, and Midas chat. Ctrl-C stops it.\x1b[0m');
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
      console.log('\nPaused. Run `npm start creatoros midas` to pick up where you left off.');
      return;
    }
    console.error(`Midas crashed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
