/**
 * The Midas Dashboard server — `npm run dashboard`.
 *
 * A small zero-config local server: static UI from dashboard/public/ plus
 * JSON endpoints under /api/*. No database, no auth, no build step — it
 * reads the same workspace files the agent reads (midas/BRAND.md,
 * midas/midas.json, midas/skills/) and the structured activity log the
 * tool layer writes (logs/activity.jsonl).
 *
 * Endpoints (all local, all JSON — build your own UI against them):
 *   GET  /api/health       credentials, config files, brain, last action
 *   GET  /api/activity     log entries + counters + heatmap (?workflow=&platform=&outcome=&limit=)
 *   GET  /api/automations  every automation: state, prompts, per-workflow stats
 *   GET  /api/understanding the agent's mind: persona, goals, KPIs, rules, system prompt
 *   GET  /api/brand        the brand identity file ({path, mtime, content})
 *   PUT  /api/brand        save edits back to disk ({content})
 *   GET  /api/workflows    training/workflow files the agent runs on
 *   PUT  /api/workflows    save one file ({id, content})
 *   POST /api/chat         talk to the agent; streams NDJSON events
 *
 * Missing credentials never crash anything: endpoints answer with
 * {connected:false} shapes and the UI renders a connect state.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, stat, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, resolve, extname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { CreatorOSClient } from '../src/client/client.js';
import { loadConfig, type MidasConfig } from '../src/config/midasConfig.js';
import { resolveApiKey } from '../src/config/credentials.js';
import { hydrateBrain, describeBrain } from '../src/config/brainSetup.js';
import type { BrainConfig } from '../src/util/brain.js';
import { buildSystemPrompt } from '../src/agent/systemPrompt.js';
import { buildToolServer } from '../src/agent/tools.js';
import { verifyAutomations } from '../src/automations/crons.js';
import { loadWorkerAutomations } from '../src/worker/automations.js';
import {
  fetchWorkerState,
  workerCronFlows,
  workerFlowRuns,
  type WorkerState,
} from '../src/dashboard/worker.js';
import { deployLooksBroken, fetchRailwayDeploy, type RailwayDeployStatus } from '../src/dashboard/railway.js';
import { workflowCatalog } from '../src/dashboard/workflows.js';
import { parseBrandMd, deriveKpis, describeObjective, MISSION_PILLARS } from '../src/dashboard/understanding.js';
import {
  engagementFlows,
  funnelFlows,
  cronFlows,
  mergeRuns,
  scopeToProfile,
  type FlowRun,
  type FlowStats,
  type LiveFunnel,
} from '../src/dashboard/flows.js';
import {
  filterActivity,
  isSetupAction,
  mergeActivity,
  readActivity,
  summarizeActivity,
  type ActivityEntry,
} from '../src/util/activityLog.js';
import { midasPaths } from '../src/paths.js';
import { sanitize } from '../src/util/sanitize.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, 'public');
const REPO_ROOT = join(HERE, '..');

export const DEFAULT_PORT = 4180;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(sanitize(JSON.stringify(body)));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += String(chunk);
      if (data.length > 2_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolvePromise(data));
    req.on('error', reject);
  });
}

export function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // the URL is printed either way
  }
}

/** Session state resolved once at boot; the dashboard reflects it honestly. */
interface Session {
  workspaceRoot: string;
  client: CreatorOSClient | null;
  config: MidasConfig | null;
  brain: BrainConfig | null;
}

async function loadSession(workspaceRoot: string): Promise<Session> {
  const paths = midasPaths(workspaceRoot);
  const apiKey = await resolveApiKey();
  const client = apiKey ? new CreatorOSClient({ apiKey }) : null;
  const config = existsSync(paths.configJson) ? await loadConfig(paths.configJson) : null;
  const brain = await hydrateBrain(config?.brain ?? undefined);
  return { workspaceRoot, client, config, brain };
}

/**
 * Config read once at boot goes stale the moment onboarding or the agent
 * writes midas.json (worker.url added after boot → "unreachable forever"
 * until restart). It's a tiny local file — re-read it per request, 3s TTL.
 */
let sessionRefreshedAt = 0;
async function refreshSession(session: Session): Promise<void> {
  if (Date.now() - sessionRefreshedAt < 3_000) return;
  sessionRefreshedAt = Date.now();
  try {
    const paths = midasPaths(session.workspaceRoot);
    const config = existsSync(paths.configJson) ? await loadConfig(paths.configJson) : null;
    const brainChanged = JSON.stringify(config?.brain) !== JSON.stringify(session.config?.brain);
    session.config = config;
    if (brainChanged) session.brain = await hydrateBrain(config?.brain ?? undefined);
    if (!session.client) {
      const apiKey = await resolveApiKey();
      if (apiKey) session.client = new CreatorOSClient({ apiKey });
    }
  } catch {
    // a malformed config mid-edit keeps the last good session
  }
}

/* ------------------------------------------------------------------ */
/* /api/health — "is my agent working?" in one payload                 */
/* ------------------------------------------------------------------ */

// Credential checks hit the real API; cache for 60s so the UI can poll.
let credCache: { at: number; result: { present: boolean; valid: boolean; maskedKey?: string; error?: string } } | null = null;

async function healthPayload(session: Session): Promise<unknown> {
  const paths = midasPaths(session.workspaceRoot);

  if (!credCache || Date.now() - credCache.at > 60_000) {
    if (!session.client) {
      credCache = { at: Date.now(), result: { present: false, valid: false } };
    } else {
      try {
        const valid = await session.client.validateKey();
        credCache = {
          at: Date.now(),
          result: {
            present: true,
            valid,
            maskedKey: session.client.maskedKey,
            ...(valid ? {} : { error: 'CreatorOS rejected the key — copy it again from https://www.creatoros.ca/ (Settings → API key).' }),
          },
        };
      } catch (error) {
        credCache = {
          at: Date.now(),
          result: { present: true, valid: false, maskedKey: session.client.maskedKey, error: (error as Error).message },
        };
      }
    }
  }

  const fileInfo = async (label: string, path: string) => {
    try {
      const s = await stat(path);
      return { label, path: relative(session.workspaceRoot, path), exists: true, mtime: s.mtime.toISOString() };
    } catch {
      return { label, path: relative(session.workspaceRoot, path), exists: false };
    }
  };
  const files = await Promise.all([
    fileInfo('config', paths.configJson),
    fileInfo('brand', paths.brandMd),
    fileInfo('profiles', paths.profilesMd),
  ]);

  const { entries } = await allActivity(session);
  const lastAction = entries[0] ?? null;
  const automationsOn = Boolean(
    session.config?.funnel?.enabled ||
      session.config?.autoReplies?.comments?.enabled ||
      session.config?.autoReplies?.messages?.enabled,
  );
  const silentMs = lastAction ? Date.now() - Date.parse(lastAction.ts) : null;

  return {
    now: new Date().toISOString(),
    credentials: credCache.result,
    configLoaded: session.config !== null,
    files,
    brain: { label: describeBrain(session.config?.brain), ready: session.brain !== null },
    automationsOn,
    lastAction,
    // Silent >24h while automations are on = something is probably stuck.
    stale: automationsOn && (silentMs === null || silentMs > 24 * 3_600_000),
  };
}

/* ------------------------------------------------------------------ */
/* /api/automations — every flow, n8n-style, cloud + local, with a     */
/* merged real-time executions feed. The panel polls this endpoint, so */
/* the expensive pieces (CLI spawn, funnel-log fetches) are cached.    */
/* ------------------------------------------------------------------ */

let cronListCache: { at: number; output: string; ok: boolean } | null = null;
let cloudCache: { at: number; funnels: LiveFunnel[]; statsById: Map<string, FlowStats>; runs: FlowRun[] } | null = null;
let workerCache: { at: number; state: WorkerState } | null = null;
let railwayCache: { at: number; deploy: RailwayDeployStatus | null } | null = null;

/**
 * ALL agent activity, one stream. On the Railway pathway the WORKER's log
 * is the primary source — that's where automations actually run — with
 * this machine's chat-session actions merged in behind it. Local logs are
 * only the primary source on the local pathway or when no worker exists.
 */
async function allActivity(session: Session): Promise<{ entries: ActivityEntry[]; source: 'railway' | 'local' }> {
  const local = await readActivity(session.workspaceRoot);
  const worker = await fetchWorkerCached(session.config);
  const railwayPrimary = session.config?.automationTarget === 'railway' && worker.reachable;
  if (railwayPrimary) {
    return { entries: mergeActivity(worker.activity, local), source: 'railway' };
  }
  return {
    entries: worker.activity.length ? mergeActivity(local, worker.activity) : local,
    source: 'local',
  };
}

/** Worker status — env overrides config so secrets can stay out of files. */
async function fetchWorkerCached(config: MidasConfig | null): Promise<WorkerState> {
  if (workerCache && Date.now() - workerCache.at < 15_000) return workerCache.state;
  const url = process.env.MIDAS_WORKER_URL ?? config?.worker?.url;
  const token = process.env.MIDAS_WORKER_TOKEN ?? config?.worker?.token;
  const state = await fetchWorkerState(url, token);
  workerCache = { at: Date.now(), state };
  return state;
}

async function fetchRailwayCached(config: MidasConfig | null): Promise<RailwayDeployStatus | null> {
  if (railwayCache && Date.now() - railwayCache.at < 60_000) return railwayCache.deploy;
  const deploy = await fetchRailwayDeploy(process.env.RAILWAY_API_TOKEN, config?.railway?.serviceId);
  railwayCache = { at: Date.now(), deploy };
  return deploy;
}

/** The CreatorOS API's list/log shapes are parsed defensively — a field
 * rename upstream degrades to "no data", never to a crash. */
function asArray(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === 'object') {
    for (const key of ['automations', 'logs', 'data', 'items', 'results']) {
      const value = (body as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as Record<string, unknown>[];
    }
  }
  return [];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

async function fetchCloudState(session: Session): Promise<NonNullable<typeof cloudCache>> {
  if (cloudCache && Date.now() - cloudCache.at < 30_000) return cloudCache;
  const funnels: LiveFunnel[] = [];
  const statsById = new Map<string, FlowStats>();
  const runs: FlowRun[] = [];
  // The key is account-wide; the workspace owns exactly ONE profile. No
  // configured profile → no cloud fetch at all — an unscoped list would
  // surface automations from the user's other projects (seen in the wild).
  const profileId = session.config?.profileId;
  if (session.client && profileId) {
    try {
      const raw = scopeToProfile(
        asArray(await session.client.listCommentAutomations(profileId)),
        profileId,
      );
      for (const item of raw.slice(0, 5)) {
        const id = str(item._id) ?? str(item.id);
        if (!id) continue;
        const funnel: LiveFunnel = {
          id,
          name: str(item.name) ?? 'Comments → DM funnel',
          platform: str(item.platform),
          keywords: Array.isArray(item.keywords) ? (item.keywords as string[]) : [],
          isActive: item.isActive !== false,
        };
        funnels.push(funnel);
        // The funnel's own execution log — real cloud-side runs.
        try {
          const logs = asArray(await session.client.commentAutomationLogs(id, { limit: 30 }));
          const stats: FlowStats = { lastTs: null, lastOutcome: null, sent: 0, skipped: 0, failed: 0 };
          for (const log of logs) {
            const outcome = str(log.status) ?? 'sent';
            const ts = str(log.createdAt) ?? str(log.timestamp) ?? str(log.sentAt);
            if (!stats.lastTs && ts) {
              stats.lastTs = ts;
              stats.lastOutcome = outcome;
            }
            if (outcome === 'sent') stats.sent++;
            else if (outcome === 'skipped') stats.skipped++;
            else if (outcome === 'failed') stats.failed++;
            if (ts) {
              runs.push({
                ts,
                flow: funnel.name,
                origin: 'cloud',
                action: 'funnel DM',
                outcome,
                platform: funnel.platform,
                target: str(log.commentId) ?? str(log.username),
                error: str(log.error) ?? str(log.reason),
              });
            }
          }
          statsById.set(id, stats);
        } catch {
          // logs can be gated — the flow still renders from the list state
        }
      }
    } catch {
      // no cloud automations reachable — local flows still render
    }
  }
  cloudCache = { at: Date.now(), funnels, statsById, runs };
  return cloudCache;
}

async function automationsPayload(session: Session): Promise<unknown> {
  const config = session.config;
  const { entries } = await allActivity(session);

  if (!cronListCache || Date.now() - cronListCache.at > 30_000) {
    const result = await verifyAutomations(session.workspaceRoot, config?.automationTarget ?? 'local');
    cronListCache = { at: Date.now(), output: result.stdout.trim() || result.stderr.trim(), ok: result.code === 0 };
  }
  const cloud = await fetchCloudState(session);
  const workerAutomations = await loadWorkerAutomations(session.workspaceRoot);
  const worker = await fetchWorkerCached(config);
  const deploy = await fetchRailwayCached(config);

  const flows = [
    ...funnelFlows(config, cloud.funnels, cloud.statsById),
    ...engagementFlows(config, entries),
    ...cronFlows(cronListCache.ok ? cronListCache.output : '', config, entries),
    ...workerCronFlows(workerAutomations, worker.runs),
  ];

  // Local runs come from the agent's activity log (workflows, not chat-only
  // reads); cloud runs come from the funnels' own execution logs.
  const localRuns: FlowRun[] = entries.slice(0, 60).map((e) => ({
    ts: e.ts,
    flow: e.workflow,
    origin: (config?.automationTarget === 'railway' ? 'railway' : 'local') as FlowRun['origin'],
    action: e.action,
    outcome: e.outcome,
    platform: e.platform,
    target: e.target,
    error: e.error,
  }));

  return {
    connected: session.client !== null,
    // Cloud flows are hidden (not fetched) until onboarding links a profile.
    cloudScoped: Boolean(config?.profileId),
    flows,
    runs: mergeRuns(localRuns, [...cloud.runs, ...workerFlowRuns(worker.runs)]),
    crons: { ok: cronListCache.ok, output: cronListCache.output },
    catalog: workflowCatalog(cronListCache.ok ? cronListCache.output : ''),
    worker: {
      configured: worker.configured || workerAutomations.length > 0,
      reachable: worker.reachable,
      running: worker.health?.running ?? null,
      automations: worker.health?.automations ?? [],
      deploy: deploy ? { ...deploy, broken: deployLooksBroken(deploy.status) } : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* /api/understanding — everything the agent knows, in one payload     */
/* ------------------------------------------------------------------ */

/**
 * The transparency panel's data: persona, objective, KPIs, engagement
 * rules, what the account sells, and the literal system prompt — all
 * read from the same files the agent reads.
 */
async function understandingPayload(session: Session): Promise<unknown> {
  const paths = midasPaths(session.workspaceRoot);
  const config = session.config;
  const summary = summarizeActivity((await allActivity(session)).entries);

  let brand: ReturnType<typeof parseBrandMd> | null = null;
  let brandMeta: { path: string; mtime: string } | null = null;
  try {
    const [content, s] = await Promise.all([readFile(paths.brandMd, 'utf8'), stat(paths.brandMd)]);
    brand = parseBrandMd(content);
    brandMeta = { path: relative(session.workspaceRoot, paths.brandMd), mtime: s.mtime.toISOString() };
  } catch {
    // no brand file yet — the panel shows how to create one
  }

  const engagement = config?.engagementAgent ?? null;
  const objective = describeObjective(engagement?.objective);

  const source = async (label: string, path: string, editRoute: string) => {
    try {
      const s = await stat(path);
      return { label, path: relative(session.workspaceRoot, path), mtime: s.mtime.toISOString(), editRoute };
    } catch {
      return { label, path: relative(session.workspaceRoot, path), mtime: null, editRoute };
    }
  };

  return {
    configured: config !== null,
    identity: engagement
      ? {
          persona: engagement.persona,
          objective: engagement.objective,
          objectiveLabel: objective?.label ?? null,
          drives: objective?.drives ?? null,
          objectiveDetail: engagement.objectiveDetail ?? null,
          tone: config?.autoReplies?.comments?.tone ?? config?.autoReplies?.messages?.tone ?? null,
        }
      : null,
    brand,
    brandMeta,
    engagement: {
      comments: config?.autoReplies?.comments ?? null,
      messages: config?.autoReplies?.messages ?? null,
      funnel: config?.funnel?.enabled
        ? {
            keywords: config.funnel.keywords,
            dmMessage: config.funnel.dmMessage,
            link: config.funnel.link ?? null,
          }
        : null,
      escalate: config?.autoReplies?.comments?.escalate ?? config?.autoReplies?.messages?.escalate ?? [],
    },
    kpis: deriveKpis(config, summary),
    mission: MISSION_PILLARS,
    mode: config?.mode ?? 'creator',
    systemPrompt: buildSystemPrompt(config),
    sources: await Promise.all([
      source('brand pack (voice, offers, audience)', paths.brandMd, '/brand'),
      source('agent config (persona, objective, automations)', paths.configJson, '/automations'),
      source('profile map (account IDs)', paths.profilesMd, '/brand'),
    ]),
  };
}

/* ------------------------------------------------------------------ */
/* Brand + training files — render + edit-in-place                     */
/* ------------------------------------------------------------------ */

/** Only files the agent actually reads are editable; ids are workspace-relative. */
function isEditablePath(workspaceRoot: string, id: string): string | null {
  if (isAbsolute(id) || id.includes('..')) return null;
  const full = resolve(workspaceRoot, id);
  const rel = relative(workspaceRoot, full);
  const allowed =
    rel === join('midas', 'BRAND.md') ||
    rel.startsWith(join('midas', 'skills') + '/') ||
    rel.startsWith(join('templates', 'skills') + '/');
  return allowed && rel.endsWith('.md') ? full : null;
}

async function brandPayload(session: Session): Promise<unknown> {
  const paths = midasPaths(session.workspaceRoot);
  try {
    const [content, s] = await Promise.all([readFile(paths.brandMd, 'utf8'), stat(paths.brandMd)]);
    return {
      exists: true,
      id: relative(session.workspaceRoot, paths.brandMd),
      path: relative(session.workspaceRoot, paths.brandMd),
      mtime: s.mtime.toISOString(),
      content,
    };
  } catch {
    return { exists: false, path: relative(session.workspaceRoot, paths.brandMd) };
  }
}

/**
 * Training files = the skill playbooks the agent executes. Installed ones
 * (midas/skills/) take precedence; on a fresh clone the repo templates
 * (templates/skills/) are listed so there is always something to read.
 */
async function workflowFilesPayload(session: Session): Promise<unknown> {
  const paths = midasPaths(session.workspaceRoot);
  const roots = existsSync(paths.skillsDir)
    ? [{ dir: paths.skillsDir, source: 'installed' }]
    : [{ dir: join(REPO_ROOT, 'templates', 'skills'), source: 'template' }];
  const summary = summarizeActivity((await allActivity(session)).entries);

  const files: unknown[] = [];
  for (const root of roots) {
    let names: string[] = [];
    try {
      names = await readdir(root.dir);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      const path = join(root.dir, name, 'SKILL.md');
      try {
        const [content, s] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
        const heading = content.split('\n').find((line) => line.startsWith('#'));
        const usage = summary.perWorkflow.find((w) => w.workflow === name) ?? null;
        files.push({
          id: relative(session.workspaceRoot, path),
          name,
          source: root.source,
          purpose: heading ? heading.replace(/^#+\s*/, '') : name,
          mtime: s.mtime.toISOString(),
          content,
          lastUsed: usage?.lastTs ?? null,
          stats: usage,
        });
      } catch {
        // a skill dir without SKILL.md — skip
      }
    }
  }
  return { files, source: roots[0]?.source };
}

async function saveFile(session: Session, id: string, content: string): Promise<{ ok: boolean; error?: string }> {
  const full = isEditablePath(session.workspaceRoot, id);
  if (!full) return { ok: false, error: 'That file is not editable from the dashboard.' };
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* /api/chat — the agent itself, streaming NDJSON                      */
/* ------------------------------------------------------------------ */

async function handleChat(session: Session, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let message = '';
  let sessionId: string | undefined;
  try {
    const body = JSON.parse((await readBody(req)) || '{}') as { message?: string; sessionId?: string };
    message = (body.message ?? '').trim();
    sessionId = body.sessionId || undefined;
  } catch {
    json(res, 400, { error: 'invalid JSON body' });
    return;
  }
  if (!message) {
    json(res, 400, { error: 'message required' });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
  const send = (event: Record<string, unknown>) => res.write(`${sanitize(JSON.stringify(event))}\n`);

  if (!session.client) {
    send({ type: 'error', text: 'Connect your CreatorOS account first — run `npm start creatoros midas` in a terminal.' });
    send({ type: 'done' });
    res.end();
    return;
  }
  if (!session.brain) {
    send({ type: 'error', text: 'The AI brain is not connected on this machine. Run `midas` once in a terminal to plug it in, then restart the dashboard.' });
    send({ type: 'done' });
    res.end();
    return;
  }

  const brainEnv: Record<string, string> =
    session.brain.provider === 'custom'
      ? {
          ...(process.env as Record<string, string>),
          ANTHROPIC_BASE_URL: session.brain.baseUrl,
          ANTHROPIC_API_KEY: session.brain.apiKey,
          ANTHROPIC_MODEL: session.brain.model,
        }
      : (process.env as Record<string, string>);

  try {
    const turn = query({
      prompt: message,
      options: {
        systemPrompt: buildSystemPrompt(session.config),
        mcpServers: { creatoros: buildToolServer(session.client, session.workspaceRoot, session.config) },
        permissionMode: 'bypassPermissions',
        allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch', 'TodoWrite'],
        cwd: session.workspaceRoot,
        env: brainEnv,
        ...(session.brain.provider === 'custom' ? { model: session.brain.model } : {}),
        ...(sessionId ? { resume: sessionId } : {}),
      },
    });
    req.on('close', () => {
      void turn.interrupt().catch(() => {});
    });
    for await (const msg of turn) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        send({ type: 'init', sessionId: msg.session_id });
      } else if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) send({ type: 'text', text: block.text });
          else if (block.type === 'tool_use')
            send({
              type: 'tool',
              name: block.name.replace(/^mcp__creatoros__/, ''),
              args: JSON.stringify(block.input ?? {}).slice(0, 200),
            });
        }
      } else if (msg.type === 'user') {
        const content = (msg as { message?: { content?: unknown } }).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === 'object' && (block as { type?: string }).type === 'tool_result') {
              const b = block as { content?: unknown; is_error?: boolean };
              let text = '';
              if (typeof b.content === 'string') text = b.content;
              else if (Array.isArray(b.content))
                text = b.content
                  .map((part: { type?: string; text?: string }) => (part.type === 'text' ? (part.text ?? '') : ''))
                  .join(' ');
              const flat = text.replace(/\s+/g, ' ').trim();
              send({
                type: 'tool_result',
                text: flat.length > 160 ? `${flat.slice(0, 157)}…` : flat || 'done',
                isError: Boolean(b.is_error),
              });
            }
          }
        }
      } else if (msg.type === 'result' && msg.subtype !== 'success') {
        send({ type: 'error', text: `turn ended: ${msg.subtype}` });
      }
    }
    send({ type: 'done' });
  } catch (error) {
    send({ type: 'error', text: (error as Error).message });
    send({ type: 'done' });
  }
  res.end();
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

export interface DashboardHandle {
  url: string;
  close: () => Promise<void>;
}

export async function startDashboard(
  workspaceRoot: string = REPO_ROOT,
  port: number = Number(process.env.MIDAS_DASHBOARD_PORT) || DEFAULT_PORT,
): Promise<DashboardHandle> {
  const session = await loadSession(workspaceRoot);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;

    const handle = async (): Promise<void> => {
      // Pick up config changes (worker.url after provisioning, etc.)
      // without a restart.
      if (url.pathname.startsWith('/api/')) await refreshSession(session);
      // ---- JSON API ----
      if (route === 'GET /api/health') return json(res, 200, await healthPayload(session));
      if (route === 'GET /api/activity') {
        const filter = {
          workflow: url.searchParams.get('workflow') ?? undefined,
          platform: url.searchParams.get('platform') ?? undefined,
          outcome: url.searchParams.get('outcome') ?? undefined,
          limit: Number(url.searchParams.get('limit')) || 200,
        };
        // kind=engagement: audience-facing actions only — the overview's
        // live feed; setup actions (create cron etc.) stay on the Logs page.
        const engagementOnly = url.searchParams.get('kind') === 'engagement';
        const { entries: all, source } = await allActivity(session);
        const scoped = engagementOnly ? all.filter((e) => !isSetupAction(e.action)) : all;
        return json(res, 200, {
          entries: filterActivity(scoped, filter),
          summary: summarizeActivity(all),
          source,
        });
      }
      if (route === 'GET /api/automations') return json(res, 200, await automationsPayload(session));
      if (route === 'GET /api/understanding') return json(res, 200, await understandingPayload(session));
      if (route === 'GET /api/brand') return json(res, 200, await brandPayload(session));
      if (route === 'GET /api/workflows') return json(res, 200, await workflowFilesPayload(session));
      if (route === 'PUT /api/brand' || route === 'PUT /api/workflows') {
        const body = JSON.parse((await readBody(req)) || '{}') as { id?: string; content?: string };
        const paths = midasPaths(session.workspaceRoot);
        const id = route === 'PUT /api/brand' ? relative(session.workspaceRoot, paths.brandMd) : (body.id ?? '');
        if (typeof body.content !== 'string') return json(res, 400, { error: 'content required' });
        const result = await saveFile(session, id, body.content);
        return json(res, result.ok ? 200 : 400, result);
      }
      if (route === 'POST /api/chat') return handleChat(session, req, res);

      // ---- static UI ----
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = resolve(PUBLIC_DIR, `.${pathname}`);
      if (file.startsWith(PUBLIC_DIR) && existsSync(file)) {
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(await readFile(file));
        return;
      }
      // Unknown page routes fall back to the SPA shell.
      if (!url.pathname.startsWith('/api/')) {
        res.writeHead(200, { 'Content-Type': MIME['.html']! });
        res.end(await readFile(join(PUBLIC_DIR, 'index.html')));
        return;
      }
      json(res, 404, { error: 'not found' });
    };

    handle().catch((error) => {
      if (!res.headersSent) json(res, 500, { error: sanitize((error as Error).message) });
      else res.end();
    });
  });

  const boundUrl = await new Promise<string>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolvePromise(`http://localhost:${port}`));
  });

  return { url: boundUrl, close: () => new Promise<void>((r) => server.close(() => r())) };
}

// `npm run dashboard` executes this file directly.
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('dashboard/server.ts');
if (invokedDirectly) {
  startDashboard()
    .then(({ url }) => {
      console.log('\n  ┌──────────────────────────────────────────────┐');
      console.log(`  │  Midas Dashboard →  ${url.padEnd(23)} │`);
      console.log('  └──────────────────────────────────────────────┘');
      console.log('  Reads local files + your CreatorOS account. Ctrl-C stops it;');
      console.log('  automations keep running on their schedules either way.\n');
      openBrowser(url);
    })
    .catch((error) => {
      console.error(`Dashboard failed to start: ${(error as Error).message}`);
      process.exitCode = 1;
    });
}
