/**
 * The Social Agents worker — the always-on Railway service that runs every
 * scheduled automation for one workspace in a single process.
 *
 *   npm run worker        (Railway start command; locally for testing)
 *
 * Reads social-agents/automations.json, computes next-run times, executes each
 * due automation SERIALLY through the headless runner (one at a time —
 * no API bursts, no activity-log races), journals every run through the
 * storage port, and serves /health + /runs for the dashboard.
 *
 * Required env on Railway: CREATOROS_API_KEY, and an AI credential
 * (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN). Recommended:
 * SOCIAL_AGENTS_WORKER_TOKEN (protects the status routes), TZ (the user's
 * timezone so cron hours mean their hours), PORT (Railway injects it).
 */
import { CreatorOSClient, isValidKeyShape } from '../client/client.js';
import { loadConfig } from '../config/socialAgentsConfig.js';
import { resolveApiKey } from '../config/credentials.js';
import { migrateLegacyWorkspace, socialAgentsPaths } from '../paths.js';
import { JsonlStore } from '../storage/jsonlStore.js';
import { loadWorkerAutomations, type WorkerAutomation } from './automations.js';
import { nextRun } from './schedule.js';
import { runSkillHeadless } from './runner.js';
import { createWorkerServer, type WorkerHealth } from './server.js';

const TICK_MS = 30_000;
const RETRY_DELAY_MS = 60_000;

async function main(): Promise<void> {
  const root = process.cwd();
  migrateLegacyWorkspace(root);
  const paths = socialAgentsPaths(root);
  const config = await loadConfig(paths.configJson);
  const apiKey = await resolveApiKey();
  if (!apiKey || !isValidKeyShape(apiKey)) {
    console.error('worker: no CreatorOS API key (set CREATOROS_API_KEY). Exiting.');
    process.exit(1);
  }
  const client = new CreatorOSClient({ apiKey });
  const store = new JsonlStore(root);
  const startedAt = new Date().toISOString();

  // A 'running' record surviving boot means the last worker died mid-run.
  for (const stale of await store.listRuns({ status: 'running', limit: 20 })) {
    await store.recordRun({ ...stale, status: 'failed', finishedAt: startedAt, error: 'worker restarted mid-run' });
  }

  let automations: WorkerAutomation[] = await loadWorkerAutomations(root);
  const nextAt = new Map<string, Date>();
  const scheduleAll = (from: Date): void => {
    nextAt.clear();
    for (const automation of automations) {
      if (!automation.enabled) continue;
      try {
        nextAt.set(automation.name, nextRun(automation.schedule, from));
      } catch (error) {
        console.error(`worker: bad schedule on ${automation.name}: ${(error as Error).message}`);
      }
    }
  };
  scheduleAll(new Date());

  let running: string | null = null;

  const execute = async (automation: WorkerAutomation, attempt = 1): Promise<void> => {
    running = automation.name;
    const startedRun = new Date().toISOString();
    const id = `${automation.name}-${startedRun}`;
    await store.recordRun({
      id,
      automation: automation.name,
      skill: automation.skill,
      startedAt: startedRun,
      status: 'running',
      source: 'worker',
    });
    console.log(`worker: ${automation.name} started (attempt ${attempt})`);
    const outcome = await runSkillHeadless({
      client,
      config,
      workspaceRoot: root,
      skill: automation.skill,
      workflow: automation.name,
      model: automation.model,
    });
    await store.recordRun({
      id,
      automation: automation.name,
      skill: automation.skill,
      startedAt: startedRun,
      finishedAt: new Date().toISOString(),
      status: outcome.ok ? 'ok' : 'failed',
      summary: outcome.summary.slice(0, 500) || undefined,
      error: outcome.error,
      source: 'worker',
    });
    console.log(`worker: ${automation.name} ${outcome.ok ? 'ok' : `FAILED — ${outcome.error}`}`);
    running = null;
    if (!outcome.ok && outcome.retryable && attempt === 1) {
      console.log(`worker: ${automation.name} failure looks transient — one retry in ${RETRY_DELAY_MS / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      await execute(automation, 2);
    }
  };

  let ticking = false;
  const tick = async (): Promise<void> => {
    if (ticking) return;
    ticking = true;
    try {
      // Pick up edits to automations.json without a redeploy.
      automations = await loadWorkerAutomations(root);
      for (const automation of automations) {
        if (!automation.enabled) {
          nextAt.delete(automation.name);
          continue;
        }
        if (!nextAt.has(automation.name)) {
          try {
            nextAt.set(automation.name, nextRun(automation.schedule, new Date()));
          } catch {
            continue;
          }
        }
        const due = nextAt.get(automation.name)!;
        if (Date.now() >= due.getTime()) {
          // Reschedule from NOW before running: a missed window while the
          // worker was down or busy fires once, never in a backlog burst.
          nextAt.set(automation.name, nextRun(automation.schedule, new Date()));
          await execute(automation); // serial — the tick waits
        }
      }
    } finally {
      ticking = false;
    }
  };
  setInterval(() => void tick(), TICK_MS);

  const getHealth = (): WorkerHealth => ({
    service: 'social-agents-worker',
    startedAt,
    timezone: process.env.TZ ?? config?.timezone ?? 'UTC',
    automations: automations.map((a) => ({
      name: a.name,
      schedule: a.schedule,
      skill: a.skill,
      enabled: a.enabled,
      nextRun: nextAt.get(a.name)?.toISOString() ?? null,
    })),
    running,
  });

  const token = process.env.SOCIAL_AGENTS_WORKER_TOKEN ?? process.env.MIDAS_WORKER_TOKEN;
  if (!token) console.warn('worker: SOCIAL_AGENTS_WORKER_TOKEN not set — /health and /runs are unauthenticated.');
  const port = Number(process.env.PORT ?? 8790);
  createWorkerServer({ token, getHealth, store, workspaceRoot: root }).listen(port, () => {
    console.log(`social-agents-worker up on :${port} — ${automations.filter((a) => a.enabled).length} automation(s) scheduled.`);
  });
}

void main();
