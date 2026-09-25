/**
 * The Social Agents chat — every run after onboarding lands here. Styled after
 * the Claude Code chat surface: ❯ input, ⏺ output bullets, live tool
 * activity lines, a spinner with elapsed time, and esc to interrupt.
 * Two engines behind the same surface: the Claude Agent SDK, or any
 * OpenAI-compatible API driving the same tool registry.
 */
import { createInterface } from 'node:readline/promises';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CreatorOSClient } from '../client/client.js';
import { saveConfig, type SocialAgentsConfig } from '../config/socialAgentsConfig.js';
import type { BrainConfig } from '../util/brain.js';
import { describeBrain, ensureBrainReady, toSettings } from '../config/brainSetup.js';
import { socialAgentsPaths } from '../paths.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { buildToolServer } from './tools.js';
import { sanitize } from '../util/sanitize.js';
import { mdToAnsi } from '../ui/markdown.js';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[38;2;0;229;255m';
const AMBER = '\x1b[38;2;255;176;0m';
const SILVER = '\x1b[38;2;203;213;225m';
// The thinking icon is the CreatorOS mark — a play-button. Terminals
// can't render the PNG the dashboard uses, so the glyph pulses instead:
// outline → filled → outline, in the brand cyan.
const FRAMES = ['▹', '▸', '▶', '▸'];

const BANNER = `
  ██╗  ██╗ █████╗ ██╗██████╗  ██████╗ ███████╗
  ██║ ██╔╝██╔══██╗██║██╔══██╗██╔═══██╗██╔════╝
  █████╔╝ ███████║██║██████╔╝██║   ██║███████╗
  ██╔═██╗ ██╔══██║██║██╔══██╗██║   ██║╚════██║
  ██║  ██╗██║  ██║██║██║  ██║╚██████╔╝███████║
  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
`;

/**
 * Keep the chat floating a few rows off the terminal floor — content glued
 * to the very bottom edge reads badly. Reserves blank rows below the
 * cursor (scrolls if needed), then puts the cursor back.
 */
const BOTTOM_PAD = 3;
function padBottom(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\n'.repeat(BOTTOM_PAD) + `\x1b[${BOTTOM_PAD}A`);
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');
const visibleLength = (text: string): number => stripAnsi(text).length;

/** ANSI-aware word wrap — codes travel with their words, width counts glyphs. */
function wrapLine(line: string, width: number): string[] {
  if (visibleLength(line) <= width) return [line];
  const words = line.split(' ');
  const wrapped: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && visibleLength(current) + 1 + visibleLength(word) > width) {
      wrapped.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) wrapped.push(current);
  return wrapped;
}

function chatWidth(): number {
  return Math.min((process.stdout.columns || 80) - 4, 96);
}

class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private startedAt = Date.now();
  private frame = 0;
  private label = '';
  private readonly enabled = Boolean(process.stdout.isTTY);

  start(label: string): void {
    this.label = label;
    if (!this.enabled || this.timer) return;
    padBottom();
    this.startedAt = Date.now();
    process.stdout.write('\x1b[?25l');
    this.timer = setInterval(() => this.render(), 110);
    this.render();
  }

  setLabel(label: string): void {
    this.label = label;
    if (this.enabled && this.timer) this.render();
  }

  private render(): void {
    const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
    const frame = FRAMES[this.frame++ % FRAMES.length];
    process.stdout.write(
      `\r\x1b[2K${CYAN}${frame}${RESET} ${this.label} ${DIM}(${seconds}s · esc to interrupt)${RESET}`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      process.stdout.write('\r\x1b[2K\x1b[?25h');
    }
  }
}

/** What the turn loop needs from a spinner — Spinner and HatchSpinner both fit. */
interface TurnSpinner {
  start(label: string): void;
  setLabel(label: string): void;
  stop(): void;
}

/**
 * The very first prompt after onboarding cold-starts the whole agent
 * environment — a long, silent wait. So the wait becomes the moment:
 * an egg. The Social Agents star incubates inside a shell that cracks open in
 * stages as the environment spins up, and the first sign of life from
 * the agent plays the birth line. Every later turn gets the plain
 * spinner; hatching only happens once.
 */
export class HatchSpinner implements TurnSpinner {
  private timer: NodeJS.Timeout | null = null;
  private startedAt = Date.now();
  private frame = 0;
  private born = false;
  private readonly enabled = Boolean(process.stdout.isTTY);
  /** After the birth, this behaves like the ordinary spinner. */
  private readonly plain = new Spinner();

  private static readonly STAGES = [
    { after: 0, shell: ['(', ')'], label: 'incubating your CreatorOS super-agent' },
    { after: 6, shell: ['{', '}'], label: 'the shell is cracking' },
    { after: 12, shell: ['⟩', '⟨'], label: 'almost there — your agent is hatching' },
  ] as const;

  start(label: string): void {
    if (this.born) {
      this.plain.start(label);
      return;
    }
    if (!this.enabled) {
      console.log('incubating your CreatorOS super-agent…');
      return;
    }
    if (this.timer) return;
    padBottom();
    this.startedAt = Date.now();
    process.stdout.write('\x1b[?25l');
    this.timer = setInterval(() => this.render(), 110);
    this.render();
  }

  setLabel(label: string): void {
    if (this.born) this.plain.setLabel(label);
    // pre-birth the staged labels tell the story — outside labels wait
  }

  private render(): void {
    const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
    const stage = [...HatchSpinner.STAGES].reverse().find((s) => seconds >= s.after)!;
    const star = FRAMES[this.frame++ % FRAMES.length];
    // The CreatorOS mark incubating inside the shell — cyan, like the logo.
    process.stdout.write(
      `\r\x1b[2K${DIM}${stage.shell[0]}${RESET} ${CYAN}${star}${RESET} ${DIM}${stage.shell[1]}${RESET} ${stage.label}… ${DIM}(${seconds}s)${RESET}`,
    );
  }

  /** First sign of life — whatever stops the spinner first delivers the birth. */
  stop(): void {
    if (this.born) {
      this.plain.stop();
      return;
    }
    this.born = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      process.stdout.write(
        `\r\x1b[2K${CYAN}✧ ▶ ✧${RESET}  ${BOLD}hatched${RESET} ${DIM}— your CreatorOS agent is born.${RESET}\n\n\x1b[?25h`,
      );
    }
  }
}

/** Listen for a bare ESC while a turn runs; returns a disarm function. */
function armEscInterrupt(onEsc: () => void): () => void {
  const stdin = process.stdin;
  if (!stdin.isTTY) return () => {};
  const wasRaw = stdin.isRaw ?? false;
  stdin.setRawMode(true);
  stdin.resume();
  const listener = (chunk: Buffer) => {
    if (chunk.length === 1 && chunk[0] === 0x1b) onEsc();
    if (chunk.length === 1 && chunk[0] === 0x03) {
      process.stdout.write('\n');
      process.exit(130);
    }
  };
  stdin.on('data', listener);
  return () => {
    stdin.off('data', listener);
    stdin.setRawMode(wasRaw);
    stdin.pause();
  };
}

/**
 * Type Social Agents' reply on, Claude-Code style. Markdown is converted to ANSI
 * styling (no raw asterisks), and long replies speed up so the animation
 * never drags.
 */
async function printAssistantText(text: string): Promise<void> {
  const rendered = mdToAnsi(sanitize(text.trim()));
  const lines = rendered.split('\n').flatMap((line) => wrapLine(line, chatWidth()));
  if (!process.stdout.isTTY) {
    console.log(`\n${CYAN}⏺${RESET} ${lines[0] ?? ''}`);
    for (const line of lines.slice(1)) console.log(`  ${line}`);
    return;
  }
  // Stream word-by-word at reading pace, like watching the model write.
  const plainLength = visibleLength(rendered);
  const wordDelay = plainLength > 1200 ? 16 : plainLength > 500 ? 26 : 38;
  process.stdout.write(`\n${CYAN}⏺${RESET} `);
  for (let index = 0; index < lines.length; index++) {
    if (index > 0) process.stdout.write('\n  ');
    const words = (lines[index] ?? '').split(' ');
    for (let w = 0; w < words.length; w++) {
      process.stdout.write((w > 0 ? ' ' : '') + words[w]);
      await sleep(wordDelay);
    }
  }
  process.stdout.write('\n');
}

function printToolLine(name: string, args?: unknown): void {
  const pretty = name.replace(/^mcp__creatoros__/, '');
  let preview = '';
  if (args && typeof args === 'object' && Object.keys(args as object).length > 0) {
    preview = JSON.stringify(args);
    if (preview.length > 72) preview = `${preview.slice(0, 69)}…)`;
    preview = `(${preview.slice(1, -1)})`;
  } else {
    preview = '()';
  }
  console.log(`${SILVER}⏺${RESET} ${DIM}${pretty}${preview}${RESET}`);
}

/** Compact ⎿ summary under a tool call, Claude-Code style. */
function printToolResult(block: { content?: unknown; is_error?: boolean }): void {
  let text = '';
  if (typeof block.content === 'string') {
    text = block.content;
  } else if (Array.isArray(block.content)) {
    text = block.content
      .map((part: { type?: string; text?: string }) => (part.type === 'text' ? (part.text ?? '') : ''))
      .join(' ');
  }
  const flat = sanitize(text).replace(/\s+/g, ' ').trim();
  const summary = flat.length > 76 ? `${flat.slice(0, 73)}…` : flat || 'done';
  const color = block.is_error ? '\x1b[38;2;248;113;113m' : DIM;
  console.log(`  ${DIM}⎿${RESET} ${color}${summary}${RESET}`);
}

function printHelp(): void {
  console.log(
    `\n${DIM}  /new    start a fresh conversation (Social Agents forgets this session, keeps social-agents/ files)\n` +
      `  /setup  print your setup prompt (social-agents/SETUP_PROMPT.md)\n` +
      `  /help   this\n` +
      `  exit    leave (scheduled posts publish from CreatorOS servers either way)\n` +
      `  esc     interrupt Social Agents mid-turn\n` +
      `  social-agents     in another terminal: a second, independent session on this same workspace${RESET}\n`,
  );
}

/**
 * Double-rule input, the Claude Code look — a full-width line above AND
 * below the prompt:
 *   ────────────────────────────
 *   ❯ type here
 *   ────────────────────────────
 * Rendered by hand in raw mode. readline redraws with clear-screen-down
 * on every keystroke, which eats the bottom rule (and, on the terminal's
 * last row, painted rules over the prompt itself — ghost ❯ rows, stacked
 * rules). Owning the three rows outright is the only stable way.
 */
function readUserInput(): Promise<string | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    return rl
      .question('❯ ')
      .catch(() => null)
      .finally(() => rl.close()) as Promise<string | null>;
  }

  return new Promise((resolve) => {
    const out = process.stdout;
    const stdin = process.stdin;
    padBottom();
    const rule = () => `${DIM}${'─'.repeat(out.columns || 80)}${RESET}`;
    const prompt = `${BOLD}${CYAN}❯${RESET} `;
    const PROMPT_COLS = 2;

    // Lay out the three rows, then park the cursor on the input row.
    out.write(`\n${rule()}\n\x1b[2K\n${rule()}\x1b[1A\r`);

    let buffer = '';
    let pos = 0;

    const redraw = () => {
      const width = (out.columns || 80) - PROMPT_COLS - 1;
      const start = pos > width ? pos - width : 0;
      const visible = buffer.slice(start, start + width);
      out.write(`\r\x1b[2K${prompt}${visible}\r\x1b[${PROMPT_COLS + (pos - start)}C`);
    };
    redraw();

    const wasRaw = stdin.isRaw ?? false;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const finish = (result: string | null) => {
      stdin.off('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      // The input widget never joins the feed: wipe all three rows (top
      // rule, input, bottom rule), then echo the sent message as a plain
      // feed line — Claude Code style. The bar redraws fresh at the
      // bottom on the next readUserInput.
      out.write('\x1b[1A\r\x1b[J');
      const sent = result?.trim();
      if (sent) {
        const lines = wrapLine(sent, chatWidth());
        out.write(`${BOLD}${CYAN}❯${RESET} ${DIM}${lines[0] ?? ''}${RESET}\n`);
        for (const line of lines.slice(1)) out.write(`  ${DIM}${line}${RESET}\n`);
      }
      resolve(result);
    };

    const onData = (chunk: string) => {
      let i = 0;
      while (i < chunk.length) {
        const ch = chunk[i]!;
        if (ch === '\x1b') {
          if (chunk.startsWith('\x1b[D', i)) { pos = Math.max(0, pos - 1); i += 3; continue; }
          if (chunk.startsWith('\x1b[C', i)) { pos = Math.min(buffer.length, pos + 1); i += 3; continue; }
          if (chunk.startsWith('\x1b[3~', i)) { buffer = buffer.slice(0, pos) + buffer.slice(pos + 1); i += 4; continue; }
          if (chunk.startsWith('\x1b[H', i)) { pos = 0; i += 3; continue; }
          if (chunk.startsWith('\x1b[F', i)) { pos = buffer.length; i += 3; continue; }
          i += 1; // bare esc / unknown sequence intro — ignore
          continue;
        }
        if (ch === '\r' || ch === '\n') {
          // Mid-paste newlines become spaces; a final newline submits.
          if (chunk.slice(i + 1).trim().length > 0) {
            if (buffer.length > 0 && buffer[pos - 1] !== ' ') {
              buffer = `${buffer.slice(0, pos)} ${buffer.slice(pos)}`;
              pos++;
            }
            i++;
            continue;
          }
          finish(buffer);
          return;
        }
        if (ch === '\x03') { out.write('\n'); process.exit(130); }
        if (ch === '\x04' && buffer.length === 0) { finish(null); return; } // ctrl-d on empty line
        if (ch === '\x7f' || ch === '\b') {
          if (pos > 0) { buffer = buffer.slice(0, pos - 1) + buffer.slice(pos); pos--; }
          i++;
          continue;
        }
        if (ch === '\x01') { pos = 0; i++; continue; } // ctrl-a
        if (ch === '\x05') { pos = buffer.length; i++; continue; } // ctrl-e
        if (ch === '\x15') { buffer = buffer.slice(pos); pos = 0; i++; continue; } // ctrl-u
        if (ch === '\x17') { // ctrl-w: delete word back
          const head = buffer.slice(0, pos).replace(/\S+\s*$/, '');
          buffer = head + buffer.slice(pos);
          pos = head.length;
          i++;
          continue;
        }
        if (ch >= ' ' || ch === '\t') { buffer = buffer.slice(0, pos) + ch + buffer.slice(pos); pos++; }
        i++;
      }
      redraw();
    };
    stdin.on('data', onData);
  });
}

/** ANSI-aware boxed welcome card. */
function printWelcomeCard(lines: string[]): void {
  const width = Math.max(...lines.map(visibleLength)) + 2;
  console.log(`  ${DIM}╭${'─'.repeat(width)}╮${RESET}`);
  for (const line of lines) {
    const pad = ' '.repeat(width - visibleLength(line) - 1);
    console.log(`  ${DIM}│${RESET} ${line}${pad}${DIM}│${RESET}`);
  }
  console.log(`  ${DIM}╰${'─'.repeat(width)}╯${RESET}`);
}

export async function runRepl(
  client: CreatorOSClient,
  config: SocialAgentsConfig | null,
  workspaceRoot: string,
  options: { justOnboarded?: boolean } = {},
): Promise<void> {
  // Brain readiness — if the Claude connection fails, the first question
  // is which AI model to use instead.
  let brain: BrainConfig;
  try {
    brain = await ensureBrainReady(config?.brain);
  } catch {
    return; // ctrl-c during the chooser
  }

  // A brain reconfigured at startup is remembered — next run skips the question.
  if (config) {
    const settings = toSettings(brain);
    if (JSON.stringify(settings) !== JSON.stringify(config.brain ?? { provider: 'claude' })) {
      config.brain = settings;
      await saveConfig(socialAgentsPaths(workspaceRoot).configJson, config);
    }
  }

  console.log(BANNER);
  printWelcomeCard([
    `${AMBER}✻${RESET} ${SILVER}Social Agents — the CreatorOS agent${RESET}`,
    '',
    `${DIM}key${RESET}      ${client.maskedKey}`,
    `${DIM}pathway${RESET}  ${config?.automationTarget ?? 'local'} · ${config?.timezone ?? 'UTC'}`,
    `${DIM}brain${RESET}    ${describeBrain(brain)}`,
    '',
    `${DIM}/help for commands · esc interrupts a turn${RESET}`,
  ]);

  const systemPrompt = buildSystemPrompt(config);
  const server = buildToolServer(client, workspaceRoot, config);

  // A custom brain rides the same engine, pointed at its API.
  const brainEnv: Record<string, string> =
    brain.provider === 'custom'
      ? {
          ...(process.env as Record<string, string>),
          ANTHROPIC_BASE_URL: brain.baseUrl,
          ANTHROPIC_API_KEY: brain.apiKey,
          ANTHROPIC_MODEL: brain.model,
        }
      : (process.env as Record<string, string>);

  let sessionId: string | undefined;
  // The first turn right after onboarding hatches instead of spinning.
  let awaitingBirth = Boolean(options.justOnboarded);

  while (true) {
    const userInput = await readUserInput();
    if (userInput === null) break;
    const trimmed = userInput.trim();
    if (!trimmed) continue;
    if (['exit', 'quit', 'q', '/exit', '/quit'].includes(trimmed.toLowerCase())) break;
    if (trimmed === '/help') {
      printHelp();
      continue;
    }
    if (trimmed === '/new') {
      sessionId = undefined;
      console.log(`${DIM}  fresh conversation — social-agents/ files still loaded${RESET}`);
      continue;
    }
    if (trimmed === '/setup') {
      try {
        const { readFile } = await import('node:fs/promises');
        console.log(await readFile(`${workspaceRoot}/social-agents/SETUP_PROMPT.md`, 'utf8'));
      } catch {
        console.log(`${DIM}  no setup prompt found — finish onboarding first${RESET}`);
      }
      continue;
    }

    const spinner: TurnSpinner = awaitingBirth && !sessionId ? new HatchSpinner() : new Spinner();
    awaitingBirth = false;
    try {
      const turn = query({
        prompt: trimmed,
        options: {
          systemPrompt,
          mcpServers: { creatoros: server },
          permissionMode: 'bypassPermissions',
          allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch', 'TodoWrite'],
          cwd: workspaceRoot,
          env: brainEnv,
          ...(brain.provider === 'custom' ? { model: brain.model } : {}),
          ...(sessionId ? { resume: sessionId } : {}),
        },
      });
      const disarm = armEscInterrupt(() => {
        void turn.interrupt().catch(() => {});
      });
      spinner.start(
        spinner instanceof HatchSpinner
          ? ''
          : sessionId
            ? 'social agents are thinking…'
            : 'waking the engine — first reply takes ~15s…',
      );
      try {
        for await (const message of turn) {
          if (message.type === 'system' && message.subtype === 'init') {
            sessionId = message.session_id;
            spinner.setLabel('social agents are thinking…');
          } else if (message.type === 'assistant') {
            for (const block of message.message.content) {
              if (block.type === 'text' && block.text.trim()) {
                spinner.stop();
                await printAssistantText(block.text);
              } else if (block.type === 'tool_use') {
                spinner.stop();
                printToolLine(block.name, block.input);
              }
            }
            spinner.start('social agents are cooking…');
          } else if (message.type === 'user') {
            const content = (message as { message?: { content?: unknown } }).message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block && typeof block === 'object' && (block as { type?: string }).type === 'tool_result') {
                  spinner.stop();
                  printToolResult(block as { content?: unknown; is_error?: boolean });
                }
              }
              spinner.start('social agents are cooking…');
            }
          } else if (message.type === 'result') {
            spinner.stop();
            if (message.subtype !== 'success') {
              const detail = 'result' in message && message.result ? ` — ${sanitize(String(message.result))}` : '';
              console.error(`\n(social agents hit a wall: ${message.subtype}${detail})\n`);
            }
          }
        }
      } finally {
        spinner.stop();
        disarm();
      }
    } catch (error) {
      spinner.stop();
      console.error(`\n(social agents error: ${sanitize((error as Error).message)})\n`);
    }
    console.log('');
  }
  console.log(`\n${DIM}Social Agents out. Your scheduled posts publish from CreatorOS servers either way.${RESET}`);
}
