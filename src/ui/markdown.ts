/**
 * Terminal rendering for Social Agents' replies. The system prompt tells the model
 * to write plain text, but models drift into Markdown — and raw asterisks
 * in a chat look broken. Convert the common constructs to ANSI styling;
 * never show literal ** or # to the user.
 */
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const ITALIC = '\x1b[3m';
const CYAN = '\x1b[38;2;0;229;255m';
const DIM = '\x1b[2m';

function inlineToAnsi(line: string): string {
  return (
    line
      // links FIRST — ANSI escapes contain '[', so this must run before
      // any styling is injected or the regex eats color codes
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `$1 ${DIM}($2)${RESET}`)
      // inline code next so its contents are left alone by bold/italic
      .replace(/`([^`]+)`/g, `${CYAN}$1${RESET}`)
      // bold: **text** or __text__
      .replace(/\*\*([^*]+)\*\*/g, `${BOLD}$1${RESET}`)
      .replace(/__([^_]+)__/g, `${BOLD}$1${RESET}`)
      // italic: *text* (single) — after bold so we don't eat its markers
      .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, `$1${ITALIC}$2${RESET}`)
  );
}

export function mdToAnsi(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      // headers → bold line
      const header = line.match(/^#{1,6}\s+(.*)$/);
      if (header) return `${BOLD}${inlineToAnsi(header[1] ?? '')}${RESET}`;
      // list bullets → •
      const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
      if (bullet) return `${bullet[1]}• ${inlineToAnsi(bullet[2] ?? '')}`;
      // horizontal rules → dim line
      if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) return `${DIM}${'─'.repeat(24)}${RESET}`;
      return inlineToAnsi(line);
    })
    .join('\n');
}
