// X counts every http(s) URL as 23 characters (t.co). Fit long IG/TikTok
// captions into a single tweet without Premium: keep as much of the
// informational body as fits. No hashtag packing.

const TCO = 23;
const LIMIT = 280;
const URL_RE = /https?:\/\/[^\s]+/gi;
const HASHTAG_RE = /(?:^|\s)#[\p{L}\p{N}_]+/gu;

function codePoints(text: string): string[] {
  return [...text];
}

export function twitterWeightedLength(text: string): number {
  let len = 0;
  let last = 0;
  const re = new RegExp(URL_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    len += codePoints(text.slice(last, m.index)).length;
    len += TCO;
    last = m.index + m[0].length;
  }
  len += codePoints(text.slice(last)).length;
  return len;
}

function truncateWeighted(text: string, limit: number): string {
  if (twitterWeightedLength(text) <= limit) return text.trimEnd();
  const chars = codePoints(text);
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const next = out + chars[i];
    if (twitterWeightedLength(next) > limit) break;
    out = next;
  }
  const clipped = out.replace(/\s+\S*$/, "").trimEnd();
  return clipped || out.trimEnd();
}

export function stripHashtags(text: string): string {
  return String(text || "")
    .replace(HASHTAG_RE, (m) => (/^\n/.test(m) ? "\n" : " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function packParagraphs(
  text: string,
  limit: number,
  measure: (s: string) => number,
  truncate: (s: string, n: number) => string,
): string {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return trimmed;
  if (measure(trimmed) <= limit) return trimmed;

  const paras = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let acc = "";
  for (const para of paras) {
    const next = acc ? `${acc}\n\n${para}` : para;
    if (measure(next) <= limit) {
      acc = next;
      continue;
    }
    acc = truncate(next, limit);
    break;
  }
  return acc || truncate(paras[0] || trimmed, limit);
}

/** Single-tweet caption for X. Full caption still goes to other platforms. */
export function fitTwitterCaption(text: string, limit = LIMIT): string {
  return packParagraphs(
    text,
    limit,
    twitterWeightedLength,
    truncateWeighted,
  );
}

const THREADS_LIMIT = 500;

function charLen(text: string): number {
  return [...text].length;
}

function truncateChars(text: string, limit: number): string {
  const chars = [...text];
  if (chars.length <= limit) return text.trimEnd();
  const out = chars.slice(0, limit).join("");
  const clipped = out.replace(/\s+\S*$/, "").trimEnd();
  return clipped || out.trimEnd();
}

export function threadsCaptionLength(text: string): number {
  return charLen(text.replace(/\r\n/g, "\n").trim());
}

/** Threads caps captions at 500 characters. Pack as much body as fits. */
export function fitThreadsCaption(text: string, limit = THREADS_LIMIT): string {
  return packParagraphs(text, limit, charLen, truncateChars);
}
