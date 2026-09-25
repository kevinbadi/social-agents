/**
 * One CreatorOS API key = one CreatorOS workspace = one set of connected
 * socials. Each lives in its own folder under `workspaces/<slug>/`, and that
 * folder is a complete Social Agents workspace root: `social-agents/`
 * (brand pack, profile map, config, skills), `logs/`, `content-library/`,
 * and its own CLAUDE.md / AGENTS.md. Everything downstream (the chat, tools,
 * skills, dashboard, worker) runs against one workspace root at a time, so
 * brands never mix. The keys themselves live outside the repo, in
 * ~/.social-agents/credentials.json, matched by CreatorOS workspace id.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { CreatorOSClient } from './client/client.js';
import { resolveApiKey } from './config/credentials.js';
import { loadConfig } from './config/socialAgentsConfig.js';
import { migrateLegacyWorkspace, socialAgentsPaths } from './paths.js';

export const WORKSPACES_DIRNAME = 'workspaces';

export interface WorkspaceEntry {
  /** Folder name under workspaces/, e.g. "creator-os-socials". */
  slug: string;
  /** Display name, from the CreatorOS workspace. */
  name: string;
  /** CreatorOS workspace id (from /v1/me) — how the key is found. */
  workspaceId?: string;
  /** The workspace root every other module takes. */
  root: string;
}

export function workspacesDir(repoRoot: string): string {
  return join(repoRoot, WORKSPACES_DIRNAME);
}

export function workspaceRoot(repoRoot: string, slug: string): string {
  return join(workspacesDir(repoRoot), slug);
}

/** Onboarding state spans every key, so it lives beside the workspaces. */
export function setupStatePath(repoRoot: string): string {
  return join(workspacesDir(repoRoot), '.setup-state.json');
}

/** Every set-up workspace (one with a config file), sorted by name. */
export async function listWorkspaces(repoRoot: string): Promise<WorkspaceEntry[]> {
  const dir = workspacesDir(repoRoot);
  if (!existsSync(dir)) return [];
  const entries: WorkspaceEntry[] = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
    const root = join(dir, dirent.name);
    const config = await loadConfig(socialAgentsPaths(root).configJson);
    if (!config) continue;
    entries.push({
      slug: dirent.name,
      name: config.workspaceName ?? dirent.name,
      ...(config.workspaceId ? { workspaceId: config.workspaceId } : {}),
      root,
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** A folder-safe slug for a workspace name, unique among `taken`. */
export function slugify(name: string, taken: Iterable<string> = []): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

/** Find a workspace by slug or (case-insensitive) name. */
export function findWorkspace(workspaces: WorkspaceEntry[], wanted: string | undefined): WorkspaceEntry | undefined {
  if (!wanted) return undefined;
  const lower = wanted.trim().toLowerCase();
  return workspaces.find((w) => w.slug === lower || w.name.toLowerCase() === lower);
}

/** The key found for a workspace belongs to a different CreatorOS workspace. */
export class WorkspaceKeyMismatchError extends Error {
  constructor(expected: WorkspaceEntry, actualName: string | undefined) {
    super(
      `The CreatorOS API key in use belongs to "${actualName ?? 'another workspace'}", not "${expected.name}". ` +
        'Nothing was sent. Re-add this workspace with `npm start creatoros add` (or unset a CREATOROS_API_KEY ' +
        'meant for another workspace).',
    );
    this.name = 'WorkspaceKeyMismatchError';
  }
}

/**
 * The client for one workspace, verified against CreatorOS: the key's
 * workspace must be this workspace, so a stray key can never post to the
 * wrong brand.
 */
export async function clientForWorkspace(workspace: WorkspaceEntry): Promise<CreatorOSClient> {
  const apiKey = await resolveApiKey(workspace.workspaceId);
  if (!apiKey) {
    throw new Error(`No CreatorOS API key saved for "${workspace.name}". Add it with \`npm start creatoros add\`.`);
  }
  const client = new CreatorOSClient({ apiKey });
  if (workspace.workspaceId) {
    const me = await client.getMe();
    if (me.workspace?.id !== workspace.workspaceId) throw new WorkspaceKeyMismatchError(workspace, me.workspace?.name);
  }
  return client;
}

/**
 * Before workspaces, a repo held ONE workspace at its root (`social-agents/`,
 * `logs/`, `content-library/`, `CLAUDE.md`). Move it into
 * `workspaces/<name>/` once, so it runs exactly like a freshly added one.
 * Returns the new workspace root, or null when there was nothing to move.
 */
export function migrateToWorkspaces(repoRoot: string): string | null {
  migrateLegacyWorkspace(repoRoot); // midas/ → social-agents/ first
  const legacy = socialAgentsPaths(repoRoot);
  if (!existsSync(legacy.configJson)) return null;
  let name = 'main';
  try {
    const config = JSON.parse(readFileSync(legacy.configJson, 'utf8')) as { workspaceName?: string };
    if (config.workspaceName) name = config.workspaceName;
  } catch {
    // unreadable config: still move it, under "main"
  }
  const taken = existsSync(workspacesDir(repoRoot)) ? readdirSync(workspacesDir(repoRoot)) : [];
  const target = workspaceRoot(repoRoot, slugify(name, taken));
  mkdirSync(target, { recursive: true });
  for (const entry of ['social-agents', 'logs', 'content-library', 'CLAUDE.md', 'AGENTS.md']) {
    const from = join(repoRoot, entry);
    if (existsSync(from)) renameSync(from, join(target, entry));
  }
  return target;
}

/**
 * One worker runs ONE workspace. SOCIAL_AGENTS_WORKSPACE names its folder
 * under workspaces/; unset, a lone workspace is used, and a repo still in
 * the pre-workspace layout runs from its root.
 */
export async function resolveWorkerRoot(repoRoot: string, wanted = process.env.SOCIAL_AGENTS_WORKSPACE): Promise<string> {
  migrateToWorkspaces(repoRoot);
  const workspaces = await listWorkspaces(repoRoot);
  if (wanted) {
    const match = findWorkspace(workspaces, wanted);
    if (!match) throw new Error(`SOCIAL_AGENTS_WORKSPACE="${wanted}" matches no folder in workspaces/.`);
    return match.root;
  }
  if (workspaces.length === 1) return workspaces[0]!.root;
  if (workspaces.length > 1) {
    throw new Error(`Several workspaces exist (${workspaces.map((w) => w.slug).join(', ')}); set SOCIAL_AGENTS_WORKSPACE to the one this worker runs.`);
  }
  return repoRoot;
}
