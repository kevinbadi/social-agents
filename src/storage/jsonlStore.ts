/**
 * File adapter for the storage port: append-only JSONL, latest-line-wins
 * per id on read. Same discipline as the activity log — corrupt lines are
 * skipped, reads of missing files return empty, and the write path only
 * ever appends (safe under concurrent dashboard reads).
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ContentItem,
  ContentQuery,
  SocialAgentsStore,
  RunQuery,
  RunRecord,
} from './store.js';

export function runsLogPath(workspaceRoot: string): string {
  return join(workspaceRoot, 'logs', 'runs.jsonl');
}

export function contentItemsPath(workspaceRoot: string): string {
  return join(workspaceRoot, 'social-agents', 'content', 'items.jsonl');
}

async function appendLine(path: string, entry: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
}

/** Parse a JSONL file into latest-wins-per-id records, insertion order kept. */
async function readLatestById<T extends { id: string }>(path: string): Promise<T[]> {
  if (!existsSync(path)) return [];
  let raw = '';
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const byId = new Map<string, T>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as T;
      if (parsed && typeof parsed.id === 'string' && parsed.id) {
        byId.delete(parsed.id); // re-insert so later writes also sort later
        byId.set(parsed.id, parsed);
      }
    } catch {
      // corrupt line — skip, never fail the read
    }
  }
  return [...byId.values()];
}

export class JsonlStore implements SocialAgentsStore {
  constructor(private readonly workspaceRoot: string) {}

  async recordRun(run: RunRecord): Promise<void> {
    await appendLine(runsLogPath(this.workspaceRoot), run);
  }

  async listRuns(query: RunQuery = {}): Promise<RunRecord[]> {
    let runs = await readLatestById<RunRecord>(runsLogPath(this.workspaceRoot));
    if (query.automation) runs = runs.filter((r) => r.automation === query.automation);
    if (query.status) runs = runs.filter((r) => r.status === query.status);
    runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    return runs.slice(0, query.limit ?? 100);
  }

  async saveContentItem(item: ContentItem): Promise<void> {
    await appendLine(contentItemsPath(this.workspaceRoot), item);
  }

  async listContentItems(query: ContentQuery = {}): Promise<ContentItem[]> {
    let items = await readLatestById<ContentItem>(contentItemsPath(this.workspaceRoot));
    if (query.status) items = items.filter((i) => i.status === query.status);
    items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return items.slice(0, query.limit ?? 100);
  }
}
