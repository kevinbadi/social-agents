/**
 * Headless skill runner — the worker's engine room. Same stack as the
 * chat REPL (Agent SDK + the shared tool registry + the system prompt),
 * minus the terminal: one prompt in, tool calls happen, a one-paragraph
 * report comes back as the run summary.
 *
 * Supervision (patterns cribbed from OpenClaw's cron service): a watchdog
 * timeout interrupts runaway runs, and failures are classified so the
 * scheduler retries transient ones (rate limits, network blips, 5xx)
 * exactly once instead of blindly retrying real bugs.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CreatorOSClient } from '../client/client.js';
import type { MidasConfig } from '../config/midasConfig.js';
import { hydrateBrain } from '../config/brainSetup.js';
import { buildSystemPrompt } from '../agent/systemPrompt.js';
import { buildToolServer } from '../agent/tools.js';
import { sanitize } from '../util/sanitize.js';

export interface RunOutcome {
  ok: boolean;
  summary: string;
  error?: string;
  /** Rate limits, network blips, 5xx, timeouts — worth one retry. */
  retryable?: boolean;
}

const TRANSIENT_PATTERNS = [
  /rate.?limit/i,
  /\b429\b/,
  // 5xx only in a status-ish context — "pid 511" is not a server error.
  /(status|failed|error|code)\D{0,10}\b5\d{2}\b/i,
  /timed?.?out/i,
  /econnreset|econnrefused|enotfound|eai_again|etimedout|epipe/i,
  /network|socket hang up/i,
  /overloaded/i,
];

export function isTransientError(message: string): boolean {
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message));
}

export const DEFAULT_RUN_TIMEOUT_MS = 20 * 60_000;

export interface HeadlessRunOptions {
  client: CreatorOSClient;
  config: MidasConfig | null;
  workspaceRoot: string;
  skill: string;
  /** Names the run in the activity log (MIDAS_WORKFLOW). */
  workflow: string;
  /** Per-automation model override — cheap models for engagement runs. */
  model?: string;
  timeoutMs?: number;
}

export async function runSkillHeadless(opts: HeadlessRunOptions): Promise<RunOutcome> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const brain = await hydrateBrain(opts.config?.brain);
  if (!brain) {
    return { ok: false, summary: '', error: 'AI brain is not configured for headless runs (missing base URL, model, or key).' };
  }

  const systemPrompt = buildSystemPrompt(opts.config);
  const server = buildToolServer(opts.client, opts.workspaceRoot, opts.config);
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    MIDAS_WORKFLOW: opts.workflow,
    ...(brain.provider === 'custom'
      ? { ANTHROPIC_BASE_URL: brain.baseUrl, ANTHROPIC_API_KEY: brain.apiKey, ANTHROPIC_MODEL: brain.model }
      : {}),
  };
  // The MCP tool server runs in THIS process — the activity log reads the
  // workflow name from process.env at call time. Runs are serial, so this
  // is race-free; restored in finally.
  const previousWorkflow = process.env.MIDAS_WORKFLOW;
  process.env.MIDAS_WORKFLOW = opts.workflow;

  const prompt =
    `Execute the "${opts.skill}" automation run now. Read midas/skills/${opts.skill}/SKILL.md and follow ` +
    `it end to end, including its verification section. This is an unattended scheduled run — no human is ` +
    `watching, so never wait for confirmation: skip anything that needs sign-off and list it in the report ` +
    `instead. End with a one-paragraph report of what you did, what you verified, and anything that needs the human.`;

  let finalText = '';
  let resultError: string | null = null;
  let timedOut = false;
  // "process exited with code 1" alone turns a 30-second diagnosis into
  // archaeology — keep the child's stderr and attach it to the failure.
  let stderrTail = '';

  try {
    const turn = query({
      prompt,
      options: {
        systemPrompt,
        mcpServers: { creatoros: server },
        permissionMode: 'bypassPermissions',
        allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch', 'TodoWrite'],
        cwd: opts.workspaceRoot,
        env,
        stderr: (data: string) => {
          stderrTail = (stderrTail + data).slice(-2000);
        },
        ...(opts.model ? { model: opts.model } : brain.provider === 'custom' ? { model: brain.model } : {}),
      },
    });
    const watchdog = setTimeout(() => {
      timedOut = true;
      void turn.interrupt().catch(() => {});
    }, timeoutMs);
    try {
      for await (const message of turn) {
        if (message.type === 'assistant') {
          for (const block of message.message.content) {
            if (block.type === 'text' && block.text.trim()) finalText = block.text.trim();
          }
        } else if (message.type === 'result' && message.subtype !== 'success') {
          resultError = 'result' in message && message.result ? String(message.result) : message.subtype;
        }
      }
    } finally {
      clearTimeout(watchdog);
    }
  } catch (error) {
    resultError = (error as Error).message;
  } finally {
    if (previousWorkflow === undefined) delete process.env.MIDAS_WORKFLOW;
    else process.env.MIDAS_WORKFLOW = previousWorkflow;
  }

  if (timedOut) {
    return { ok: false, summary: finalText, error: `Run exceeded ${Math.round(timeoutMs / 60000)} minutes and was interrupted.`, retryable: false };
  }
  if (resultError) {
    const stderrNote = stderrTail.trim() ? ` — stderr: ${stderrTail.trim().slice(-500)}` : '';
    const clean = sanitize(resultError + stderrNote);
    return { ok: false, summary: finalText, error: clean, retryable: isTransientError(clean) };
  }
  return { ok: true, summary: finalText || 'Run completed (no report text).' };
}
