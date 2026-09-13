/**
 * First-run intro: the CreatorOS 3D wordmark animation, then the MIDAS
 * wordmark, then an animated checkmark rundown of everything Midas can do.
 * Ported from the CreatorOS CLI banner so the look matches the app exactly.
 *
 * Block glyphs (█) carry an animated truecolor gradient; the box-drawing
 * edge characters render dim as the extruded 3D face. Non-TTY / NO_COLOR /
 * CI terminals get a plain-text fallback.
 */

import { detectBrain, type BrainStatus } from '../util/brain.js';

type Rgb = [number, number, number];

const FONT: Record<string, string[]> = {
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
  O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
  M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
  D: ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  ' ': ['   ', '   ', '   ', '   ', '   ', '   '],
};
const ROWS = 6;

// CreatorOS app palette: electric cyan → silver chrome → steel cyan
const CREATOROS_STOPS: Rgb[] = [
  [0, 229, 255],
  [225, 232, 240],
  [56, 189, 248],
];
// Midas palette: amber → warm white → gold (midas: the opportune moment)
const MIDAS_STOPS: Rgb[] = [
  [255, 176, 0],
  [255, 244, 214],
  [255, 122, 26],
];

const fg = ([r, g, b]: Rgb) => `\x1b[38;2;${r};${g};${b}m`;
const DIM_EDGE = '\x1b[38;2;71;85;105m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const CYAN = fg([0, 229, 255]);
const SILVER = fg([203, 213, 225]);
const EDGE_CHARS = new Set(['╔', '╗', '╚', '╝', '║', '═']);

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function isFancy(): boolean {
  return Boolean(
    process.stdout.isTTY && !process.env.NO_COLOR && !process.env.CI && !process.env.MIDAS_NO_BANNER,
  );
}

function renderRows(text: string): string[] {
  const rows = Array.from({ length: ROWS }, () => '');
  for (const ch of text) {
    const glyph = FONT[ch];
    if (!glyph) throw new Error(`banner font has no glyph for "${ch}"`);
    for (let r = 0; r < ROWS; r++) rows[r] = (rows[r] ?? '') + (glyph[r] ?? '');
  }
  return rows;
}

function gradientAt(stops: Rgb[], t: number): Rgb {
  const clamped = ((t % 1) + 1) % 1;
  // ping-pong so the sweep wraps smoothly instead of snapping
  const p = clamped < 0.5 ? clamped * 2 : (1 - clamped) * 2;
  const seg = p * (stops.length - 1);
  const i = Math.min(Math.floor(seg), stops.length - 2);
  const f = seg - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

function paintFrame(
  rows: string[],
  width: number,
  revealCols: number,
  hueOffset: number,
  stops: Rgb[],
): string {
  const out: string[] = [];
  for (const row of rows) {
    let line = '';
    const chars = [...row];
    for (let c = 0; c < chars.length; c++) {
      const ch = chars[c]!;
      if (c >= revealCols || ch === ' ') {
        line += ' ';
      } else if (EDGE_CHARS.has(ch)) {
        line += DIM_EDGE + ch;
      } else {
        const nearEdge = revealCols - c <= 4 && revealCols < width;
        const color: Rgb = nearEdge ? [255, 255, 255] : gradientAt(stops, c / width + hueOffset);
        line += fg(color) + ch;
      }
    }
    out.push(line + RESET);
  }
  return out.join('\n');
}

async function animateBlock(rows: string[], stops: Rgb[]): Promise<void> {
  const stdout = process.stdout;
  const width = [...(rows[0] ?? '')].length;
  const REVEAL_FRAMES = 18;
  const SHIMMER_FRAMES = 14;
  let first = true;
  for (let f = 0; f < REVEAL_FRAMES + SHIMMER_FRAMES; f++) {
    const progress = Math.min(1, f / (REVEAL_FRAMES - 1));
    const eased = 1 - (1 - progress) ** 3;
    const revealCols = Math.ceil(eased * width);
    const hueOffset = f * 0.045;
    if (!first) stdout.write(`\x1b[${ROWS}A`); // cursor back to frame top
    stdout.write(paintFrame(rows, width, revealCols, hueOffset, stops) + '\n');
    first = false;
    await sleep(f < REVEAL_FRAMES ? 32 : 45);
  }
}

/** Left-to-right reveal with a bright leading edge, then a shimmer sweep. */
export async function showWordmark(text: string, tagline: string, stops: Rgb[]): Promise<void> {
  const stdout = process.stdout;
  // columns can be 0/undefined on some ptys — assume a modern wide terminal then
  const columns = stdout.columns || 120;
  const fullRows = renderRows(text);
  const fullWidth = [...(fullRows[0] ?? '')].length;

  // Narrow terminal (e.g. default 80-col window vs the 78-col CREATOR OS
  // mark): animate the words stacked instead of dropping the show entirely.
  let blocks: string[][] = [fullRows];
  let width = fullWidth;
  if (isFancy() && columns < fullWidth + 2 && text.includes(' ')) {
    const wordRows = text.split(' ').map((word) => renderRows(word));
    width = Math.max(...wordRows.map((rows) => [...(rows[0] ?? '')].length));
    blocks = wordRows;
  }

  if (!isFancy() || columns < width + 2) {
    console.log(`${text} — ${tagline}`);
    return;
  }

  const centeredTagline = ' '.repeat(Math.max(0, Math.floor((width - tagline.length) / 2))) + tagline;
  stdout.write('\x1b[?25l\n'); // hide cursor
  try {
    for (const rows of blocks) {
      await animateBlock(rows, stops);
    }
    stdout.write(`\x1b[2m\x1b[3m${centeredTagline}${RESET}\n\n`);
  } finally {
    stdout.write('\x1b[?25h'); // restore cursor
  }
}

export interface ChecklistItem {
  name: string;
  detail: string;
}

export interface ChecklistSection {
  heading: string;
  items: ChecklistItem[];
}

/** Everything Midas can actually do and has access to — shown on first run. */
export const MIDAS_CAPABILITY_SECTIONS: ChecklistSection[] = [
  {
    heading: 'Posting — every type',
    items: [
      { name: 'Shortform video', detail: 'TikTok, Reels & Shorts simultaneously — one call' },
      { name: 'Longform video', detail: 'YouTube — title, description, tags' },
      { name: 'Carousels', detail: 'multi-media posts' },
      { name: 'Single post / blog-style text', detail: 'every text platform' },
      { name: 'Threads / tweets', detail: 'native multi-part threads on X & Threads' },
      { name: 'Multiposting', detail: 'one create, every account at once' },
      { name: 'Scheduling', detail: 'CreatorOS servers publish — your laptop can sleep' },
    ],
  },
  {
    heading: 'Analytics',
    items: [
      { name: 'Platform analytics', detail: 'follower growth, views, daily metrics' },
      { name: 'Post analytics', detail: 'per-post performance + best-time data' },
    ],
  },
  {
    heading: 'Messaging & comments — set up through webhooks',
    items: [
      { name: 'Message replies', detail: 'Twitter/X, Instagram, Facebook, Reddit' },
      { name: 'Comment replies', detail: 'every platform but TikTok — X, IG, FB, Threads, Reddit, YouTube, LinkedIn' },
      { name: 'Comment-to-DM workflows', detail: 'Facebook & Instagram — keyword comment → automatic DM with your link' },
    ],
  },
  {
    heading: 'Agent skills',
    items: [
      {
        name: 'Agent Posts',
        detail: 'drop a finished vertical video — transcript, keyword, captions, cover, queued to every social, DM funnel armed',
      },
      {
        name: 'Marketing skills, built in',
        detail: 'KevBuildsApps ships the best marketing skills + tutorials Midas reads directly',
      },
    ],
  },
];

/** Animated drop-down checklist: pending ring pops into a cyan check. */
export async function showChecklist(sections: ChecklistSection[], heading: string): Promise<void> {
  const stdout = process.stdout;
  if (!isFancy()) {
    console.log(heading);
    for (const section of sections) {
      console.log(`\n${section.heading}`);
      for (const item of section.items) console.log(`  ✔ ${item.name} — ${item.detail}`);
    }
    console.log('');
    return;
  }
  stdout.write(`${DIM}${heading}${RESET}\n`);
  stdout.write('\x1b[?25l');
  try {
    for (const section of sections) {
      stdout.write(`\n  ${SILVER}${section.heading}${RESET}\n`);
      await sleep(220);
      // one item at a time: a pending ring appears, pops into a cyan check,
      // then holds long enough to actually be read before the next drops in
      for (const item of section.items) {
        stdout.write(`   ${DIM}○ ${item.name}${RESET}`);
        await sleep(200);
        stdout.write(`\r\x1b[2K   ${CYAN}✔${RESET} ${SILVER}${item.name}${RESET}${DIM} — ${item.detail}${RESET}\n`);
        await sleep(330);
      }
    }
    stdout.write('\n');
  } finally {
    stdout.write('\x1b[?25h');
  }
}

// Claude's terracotta, flanked by Midas amber — the link bar sweeps across it.
const CLAUDE_STOPS: Rgb[] = [
  [255, 176, 0],
  [230, 150, 100],
  [217, 119, 87],
];
const CLAUDE_ORANGE = fg([217, 119, 87]);

/**
 * The brain hookup: an energy link draws from MIDAS to CLAUDE, then
 * resolves to the actually-detected auth status.
 */
export async function showBrainLink(status: BrainStatus): Promise<void> {
  const stdout = process.stdout;
  const label =
    status === 'plan'
      ? 'connected — thinking on your Claude plan, no API key needed'
      : status === 'api-key'
        ? 'connected — thinking via your API key'
        : status === 'custom'
          ? 'connected — thinking via your configured model API'
          : 'not detected — fine: the setup form needs no AI; your agent chat comes after';
  if (!isFancy()) {
    console.log(`Claude: ${label}`);
    return;
  }
  const SEGMENTS = 26;
  stdout.write('\x1b[?25l');
  try {
    for (let i = 0; i <= SEGMENTS; i++) {
      let bar = '';
      for (let s = 0; s < SEGMENTS; s++) {
        if (s < i) {
          const head = i - s <= 2 && i < SEGMENTS;
          bar += head ? `${fg([255, 255, 255])}━` : `${fg(gradientAt(CLAUDE_STOPS, s / SEGMENTS))}━`;
        } else {
          bar += `${DIM}─${RESET}`;
        }
      }
      stdout.write(`\r  ${SILVER}MIDAS${RESET} ${bar}${RESET} ${CLAUDE_ORANGE}CLAUDE${RESET}`);
      await sleep(26);
    }
    await sleep(180);
    stdout.write('\n');
    const mark = status === 'missing' ? `${DIM}○${RESET}` : `${CYAN}✔${RESET}`;
    stdout.write(`  ${mark} ${SILVER}Claude${RESET}${DIM} ${label}${RESET}\n\n`);
    await sleep(500);
  } finally {
    stdout.write('\x1b[?25h');
  }
}

/**
 * The full first-run sequence: CreatorOS animation → Midas animation →
 * Claude brain link → capability checkmarks. Runs once, right before the
 * onboarding interview.
 */
export async function showIntro(): Promise<void> {
  await showWordmark('CREATOR OS', 'the operating system for social media', CREATOROS_STOPS);
  await showWordmark('MIDAS', 'your CreatorOS agent · posts · replies · reports', MIDAS_STOPS);
  await showBrainLink(detectBrain());
  await showChecklist(MIDAS_CAPABILITY_SECTIONS, 'what Midas runs for you');
}
