/**
 * Entry point. npm forwards positional args to the start script:
 *   npm start creatoros social-agents [workspace]
 *   npm start creatoros add
 *   npm start creatoros dashboard
 * First run (no workspaces yet): the onboarding form — a pure form, no AI in
 * it. It collects the CreatorOS API key(s) and writes one workspace folder
 * per key under workspaces/. Every later run: pick a workspace (asked only
 * when there are several) and enter the Social Agents REPL for it.
 * Setup is resumable — killing the process mid-form and re-running resumes
 * where it left off.
 */
import { existsSync } from 'node:fs';
import { socialAgentsPaths } from './paths.js';
import { loadConfig } from './config/socialAgentsConfig.js';
import { loadState, isInterviewComplete } from './onboarding/state.js';
import {
  clientForWorkspace,
  findWorkspace,
  listWorkspaces,
  migrateToWorkspaces,
  setupStatePath,
  type WorkspaceEntry,
} from './workspaces.js';

export type Route = 'social-agents' | 'add' | 'dashboard' | 'usage';

const CHAT_COMMAND = /^(social[- ]?agents|social|midas)\b/;

/**
 * Route on positional args: `creatoros social-agents`, `creatoros social agents`,
 * `creatoros add`, `creatoros dashboard`. `creatoros midas` still works for
 * pre-rename muscle memory.
 */
export function routeArgs(argv: string[]): Route {
  const args = argv.filter((a) => a !== '--');
  const index = args.indexOf('creatoros');
  if (index === -1) return 'usage';
  const command = args.slice(index + 1, index + 3).join(' ').toLowerCase();
  if (CHAT_COMMAND.test(command)) return 'social-agents';
  const first = command.split(' ')[0];
  if (first === 'add') return 'add';
  if (first === 'dashboard') return 'dashboard';
  return 'usage';
}

/** `creatoros social-agents <workspace>` (or SOCIAL_AGENTS_WORKSPACE) names the workspace to open. */
export function requestedWorkspace(argv: string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  const args = argv.filter((a) => a !== '--');
  const index = args.indexOf('creatoros');
  if (index !== -1) {
    let rest = args.slice(index + 1);
    if (/^social$/i.test(rest[0] ?? '') && /^agents$/i.test(rest[1] ?? '')) rest = rest.slice(2);
    else if (CHAT_COMMAND.test((rest[0] ?? '').toLowerCase())) rest = rest.slice(1);
    else rest = [];
    if (rest.length) return rest.join(' ');
  }
  return env.SOCIAL_AGENTS_WORKSPACE?.trim() || undefined;
}

export function usage(): string {
  return [
    'Social Agents: your CreatorOS agents.',
    '',
    'Usage:',
    '  npm start creatoros social-agents              start Social Agents (first run = setup: your CreatorOS API key(s))',
    '  npm start creatoros social-agents <workspace>  open one workspace directly',
    '  npm start creatoros add                        add another CreatorOS API key (a new workspace)',
    '  npm start creatoros dashboard                  the Social Agents dashboard — every workspace, in the browser',
    '  social-agents                                  open a session from any terminal (run `npm link` once to enable)',
    '  social-agents dashboard                        same dashboard, from anywhere',
    '',
    'Each CreatorOS API key is one workspace (one set of socials) in workspaces/<name>/.',
    'Sessions are independent conversations — open as many terminals as you like.',
  ].join('\n');
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  migrateToWorkspaces(repoRoot);
  const argv = process.argv.slice(2);
  const route = routeArgs(argv);
  if (route === 'usage') {
    console.log(usage());
    return;
  }

  if (route === 'dashboard') {
    await runDashboard(repoRoot);
    return;
  }

  const { runInterview } = await import('./onboarding/interview.js');
  if (route === 'add') {
    await runInterview(repoRoot, { adding: true });
    return;
  }

  const statePath = setupStatePath(repoRoot);
  const state = await loadState(statePath);
  const workspaces = await listWorkspaces(repoRoot);
  const setupPending = workspaces.length === 0 || (existsSync(statePath) && !isInterviewComplete(state));

  if (setupPending) {
    // First run: CreatorOS animation → Social Agents animation → capability
    // checkmarks → the form. Resumed forms skip the show.
    if (state.completed.length === 0 && !state.answers.workspaces?.length) {
      const { showIntro } = await import('./ui/banner.js');
      await showIntro();
    }
    // The form prints the handoff; the user's next move is to talk to the
    // agents (`social-agents`), which run the brand interview themselves.
    await runInterview(repoRoot);
    return;
  }

  const workspace = await pickWorkspace(workspaces, requestedWorkspace(argv));
  if (!workspace) {
    await runInterview(repoRoot, { adding: true });
    return;
  }
  let client;
  try {
    client = await clientForWorkspace(workspace);
  } catch (error) {
    // No key, or a key for another workspace: a clear stop, not a crash.
    console.error(`\n${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(socialAgentsPaths(workspace.root).configJson);
  const { runRepl } = await import('./agent/repl.js');
  await runRepl(client, config, workspace.root);
}

/** One workspace opens directly; several ask. null = "add another key" was picked. */
async function pickWorkspace(workspaces: WorkspaceEntry[], wanted: string | undefined): Promise<WorkspaceEntry | null> {
  if (wanted) {
    const match = findWorkspace(workspaces, wanted);
    if (match) return match;
    console.log(`No workspace called "${wanted}". Pick one:`);
  } else if (workspaces.length === 1) {
    return workspaces[0]!;
  }
  const { select } = await import('@inquirer/prompts');
  const ADD = '__add__';
  const choice = await select({
    message: 'Which workspace?',
    choices: [
      ...workspaces.map((w) => ({ name: w.name, value: w.slug, description: `workspaces/${w.slug}/` })),
      { name: '+ Add another CreatorOS API key', value: ADD },
    ],
  });
  return choice === ADD ? null : workspaces.find((w) => w.slug === choice)!;
}

/** `social-agents dashboard` — the same server `npm run dashboard` boots. Zero-config:
 * missing credentials render a connect state instead of crashing. */
async function runDashboard(repoRoot: string): Promise<void> {
  const { startDashboard, openBrowser } = await import('../dashboard/server.js');
  const { url } = await startDashboard(repoRoot);
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
