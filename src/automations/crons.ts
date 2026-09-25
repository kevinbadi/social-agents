/**
 * The whole point: all four pillars running on cron jobs. Social Agents delegates
 * the mechanics (launchd plists on macOS, Docker scaffolds for Railway) to
 * `creatoros automations:create` — it already handles both pathways.
 * Social Agents' layer: pick the crons, prepare the pipeline so scheduled runs
 * succeed with zero judgment gaps, create, verify, explain.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AutomationTarget } from '../config/socialAgentsConfig.js';

export interface StarterCron {
  name: string;
  /** Strict 5-field cron (no MON/JAN names). */
  schedule: string;
  skill: string;
  pillar: 'content' | 'calendar' | 'engagement' | 'analytics';
  description: string;
}

/** The four starter crons offered during onboarding — one per pillar. */
export const STARTER_CRONS: StarterCron[] = [
  {
    name: 'daily-shortform',
    schedule: '0 10 * * *',
    skill: 'post-shortform',
    pillar: 'content',
    description:
      'Daily at 10:00 — pull the next clip from content-library/, caption it from the brand pack, post it to TikTok, Reels, and Shorts.',
  },
  {
    name: 'weekly-calendar',
    schedule: '0 17 * * 0',
    skill: 'schedule-posts',
    pillar: 'calendar',
    description:
      'Sundays at 17:00 — plan the coming week and schedule it. CreatorOS servers publish; nothing local needs to stay awake after scheduling.',
  },
  {
    name: 'engagement-sweep',
    schedule: '0 9,15,21 * * *',
    skill: 'respond-to-comments',
    pillar: 'engagement',
    description:
      'Three times a day — triage new comments, reply on-brand, escalate the sensitive ones, keep the funnel fed. (DMs: cron the respond-to-messages skill separately.)',
  },
  {
    name: 'weekly-analytics',
    schedule: '0 8 * * 1',
    skill: 'analytics-report',
    pillar: 'analytics',
    description:
      'Mondays at 08:00 — follower growth, best posts, competitor movement, and one concrete recommendation.',
  },
];


/** Build the argv for `creatoros automations:create` on either pathway. */
export function automationCreateArgs(cron: StarterCron, target: AutomationTarget): string[] {
  const args = [
    'automations:create',
    cron.name,
    '--schedule',
    cron.schedule,
    '--skill',
    cron.skill,
  ];
  if (target === 'railway') args.push('--target', 'railway');
  return args;
}

/**
 * The creatoros CLI looks for skills at `<cwd>/creatoros/skills/<skill>/SKILL.md`.
 * Social Agents' skills live in `social-agents/skills/` — write a shim that points the
 * scheduled agent run at the real playbook.
 */
export async function ensureCliSkillShim(workspaceRoot: string, skill: string): Promise<string> {
  const shimDir = join(workspaceRoot, 'creatoros', 'skills', skill);
  const shimPath = join(shimDir, 'SKILL.md');
  if (!existsSync(shimPath)) {
    await mkdir(shimDir, { recursive: true });
    await writeFile(
      shimPath,
      `# ${skill}\n\nRead \`social-agents/skills/${skill}/SKILL.md\` in this workspace and execute today's run by its playbook. Read \`social-agents/BRAND.md\`, \`social-agents/PROFILES.md\`, and \`social-agents/social-agents.json\` first — never contradict them.\n`,
      'utf8',
    );
  }
  return shimPath;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCreatorosCli(args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['--no-install', 'creatoros', ...args], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: String(error) }));
  });
}

/**
 * Create one automation on the chosen pathway. Railway = one always-on
 * worker reading social-agents/automations.json (no per-cron service, no CLI);
 * local = launchd via the creatoros CLI, shim included.
 */
export async function createAutomation(
  workspaceRoot: string,
  cron: StarterCron & { model?: string },
  target: AutomationTarget,
): Promise<CommandResult> {
  if (target === 'railway') {
    try {
      const { upsertWorkerAutomation } = await import('../worker/automations.js');
      await upsertWorkerAutomation(workspaceRoot, {
        name: cron.name,
        schedule: cron.schedule,
        skill: cron.skill,
        enabled: true,
        model: cron.model,
        description: cron.description || undefined,
      });
      return {
        code: 0,
        stdout: `${cron.name} saved to social-agents/automations.json. A worker running against this workspace picks it up within 30 seconds; a DEPLOYED Railway worker needs a sync — run \`railway up --detach\` (or ask me to) so the change ships.`,
        stderr: '',
      };
    } catch (error) {
      return { code: 1, stdout: '', stderr: (error as Error).message };
    }
  }
  await ensureCliSkillShim(workspaceRoot, cron.skill);
  return runCreatorosCli(automationCreateArgs(cron, target), workspaceRoot);
}

/** Verify automations are actually loaded, not just recorded. */
export async function verifyAutomations(
  workspaceRoot: string,
  target: AutomationTarget = 'local',
): Promise<CommandResult> {
  if (target === 'railway') {
    const { loadWorkerAutomations } = await import('../worker/automations.js');
    const automations = await loadWorkerAutomations(workspaceRoot);
    const lines = automations.map(
      (a) => `${a.name}  [${a.enabled ? 'on' : 'off'}]  ${a.schedule}  → ${a.skill}${a.model ? `  (${a.model})` : ''}`,
    );
    return { code: 0, stdout: lines.join('\n'), stderr: '' };
  }
  return runCreatorosCli(['automations:list'], workspaceRoot);
}

/** Remove a worker automation (Railway pathway only — local uses the CLI). */
export async function deleteAutomation(
  workspaceRoot: string,
  name: string,
  target: AutomationTarget,
): Promise<CommandResult> {
  if (target !== 'railway') {
    return { code: 1, stdout: '', stderr: 'Deleting local (launchd) automations is a manual step — ask the human to remove it via the creatoros CLI.' };
  }
  const { removeWorkerAutomation } = await import('../worker/automations.js');
  await removeWorkerAutomation(workspaceRoot, name);
  return { code: 0, stdout: `${name} removed — the worker drops it within 30 seconds.`, stderr: '' };
}
