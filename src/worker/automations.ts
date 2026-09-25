/**
 * The worker's automation list — social-agents/automations.json. On the Railway
 * pathway this file IS the schedule: one always-on worker reads it and
 * runs every entry in-process (one container for any number of
 * automations, vs the old one-service-per-cron scaffold). The agent's
 * create/list tools write and read it; the dashboard renders it.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseCron } from './schedule.js';

export interface WorkerAutomation {
  /** lowercase-with-hyphens, unique. */
  name: string;
  /** Strict 5-field cron. */
  schedule: string;
  /** A skill in social-agents/skills/. */
  skill: string;
  enabled: boolean;
  /** Optional model override for this automation's runs (cheap models for engagement). */
  model?: string;
  description?: string;
}

export function automationsPath(workspaceRoot: string): string {
  return join(workspaceRoot, 'social-agents', 'automations.json');
}

export async function loadWorkerAutomations(workspaceRoot: string): Promise<WorkerAutomation[]> {
  const path = automationsPath(workspaceRoot);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { automations?: WorkerAutomation[] };
    return Array.isArray(parsed.automations) ? parsed.automations : [];
  } catch {
    return [];
  }
}

async function save(workspaceRoot: string, automations: WorkerAutomation[]): Promise<void> {
  const path = automationsPath(workspaceRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ automations }, null, 2)}\n`, 'utf8');
}

/** Add or replace by name. Validates the cron before anything lands on disk. */
export async function upsertWorkerAutomation(
  workspaceRoot: string,
  automation: WorkerAutomation,
): Promise<WorkerAutomation[]> {
  parseCron(automation.schedule); // throws on a bad schedule
  const automations = await loadWorkerAutomations(workspaceRoot);
  const next = automations.filter((a) => a.name !== automation.name);
  next.push(automation);
  await save(workspaceRoot, next);
  return next;
}

export async function removeWorkerAutomation(workspaceRoot: string, name: string): Promise<WorkerAutomation[]> {
  const automations = await loadWorkerAutomations(workspaceRoot);
  const next = automations.filter((a) => a.name !== name);
  await save(workspaceRoot, next);
  return next;
}
