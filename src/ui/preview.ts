/**
 * End-of-setup treat: an animated preview of what the comment-to-DM funnel
 * and conversation will actually look like, driven by the persona and
 * objective the user just configured. Pure script builder + a type-on
 * renderer; non-TTY terminals get the plain transcript.
 */

import type { EngagementObjective } from '../config/socialAgentsConfig.js';

export interface PreviewInput {
  keyword: string;
  dmMessage: string;
  link?: string;
  persona: string;
  objective: EngagementObjective;
  objectiveDetail?: string;
  handle?: string;
}

export interface PreviewLine {
  who: 'commenter' | 'social-agents' | 'system';
  text: string;
}

/** The objective decides how the conversation closes. */
function closerFor(input: PreviewInput): string {
  const destination = input.objectiveDetail || input.link || 'the link above';
  switch (input.objective) {
    case 'book-calls':
      return `Best next step is a quick call — grab a slot that works for you: ${destination}`;
    case 'funnel':
      return `Everything you need is right here 👉 ${destination}`;
    case 'free-value':
      return `All good — the free stuff is yours either way: ${destination}. No strings.`;
    case 'rapport':
      return `Love that you're here. What are you working on right now? I actually read these.`;
    case 'other':
      return input.objectiveDetail || `Here's where to go next: ${destination}`;
  }
}

export function buildPreviewScript(input: PreviewInput): PreviewLine[] {
  const handle = input.handle ?? '@new_follower';
  const lines: PreviewLine[] = [
    { who: 'system', text: `${handle} commented on your latest post:` },
    { who: 'commenter', text: `"${input.keyword}"` },
    { who: 'system', text: `keyword matched → funnel fired, DM sent automatically` },
    { who: 'social-agents', text: input.dmMessage + (input.link ? `  [ ${input.link} ]` : '') },
    { who: 'commenter', text: 'yo thanks! quick question — is this good for beginners?' },
    { who: 'social-agents', text: closerFor(input) },
    { who: 'system', text: 'sensitive topics (refunds, complaints, legal) always escalate to you instead' },
  ];
  return lines;
}

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[38;2;0;229;255m';
const SILVER = '\x1b[38;2;203;213;225m';
const AMBER = '\x1b[38;2;255;176;0m';

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function isFancy(): boolean {
  return Boolean(
    process.stdout.isTTY && !process.env.NO_COLOR && !process.env.CI && !process.env.SOCIAL_AGENTS_NO_BANNER,
  );
}

/** Type-on chat rendering of the preview script. */
export async function showEngagementPreview(input: PreviewInput): Promise<void> {
  const script = buildPreviewScript(input);
  const stdout = process.stdout;

  if (!isFancy()) {
    console.log('\npreview — how your funnel + replies will play out:');
    for (const line of script) {
      const prefix = line.who === 'social-agents' ? 'Social Agents (DM):' : line.who === 'commenter' ? (input.handle ?? '@new_follower') + ':' : '·';
      console.log(`  ${prefix} ${line.text}`);
    }
    console.log('');
    return;
  }

  stdout.write(`\n${DIM}preview — how your funnel + replies will play out${RESET}\n\n`);
  stdout.write('\x1b[?25l');
  try {
    for (const line of script) {
      if (line.who === 'system') {
        await sleep(350);
        stdout.write(`  ${DIM}· ${line.text}${RESET}\n`);
        await sleep(450);
        continue;
      }
      const isAgent = line.who === 'social-agents';
      const label = isAgent ? `${AMBER}Social Agents${RESET}${DIM} (DM)${RESET} ` : `${SILVER}${input.handle ?? '@new_follower'}${RESET} `;
      // typing indicator, then the message types on
      stdout.write(`  ${label}${DIM}…${RESET}`);
      await sleep(isAgent ? 650 : 450);
      stdout.write(`\r\x1b[2K  ${label}`);
      const color = isAgent ? CYAN : SILVER;
      for (const ch of line.text) {
        stdout.write(color + ch + RESET);
        await sleep(ch === ' ' ? 4 : 9);
      }
      stdout.write('\n');
      await sleep(400);
    }
    stdout.write('\n');
  } finally {
    stdout.write('\x1b[?25h');
  }
}
