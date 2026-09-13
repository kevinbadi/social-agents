export const DEFAULT_COMMENT_REPLY = "Awesome, check DMs!";

/** Zernio caps dmMessage at 640 when the payload also carries buttons. */
export const DM_MESSAGE_MAX = 640;

export const FOLLOW_ASK =
  "P.S. By the way, if you're not following already, please give me a follow.";

function alreadyAsksFollow(text: string): boolean {
  return (
    /please give (me|us) a follow/i.test(text) ||
    /if you'?re not following already/i.test(text) ||
    /a follow would (also )?be appreciated/i.test(text)
  );
}

const GO_ORIGIN =
  "https://kevbuildsapps-marketing-os-production.up.railway.app";

/** Accept a full URL, a /go/<slug> path, or a bare go-slug. */
export function resolveResourceUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/go/")) return `${GO_ORIGIN}${s}`;
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(s)) {
    return `${GO_ORIGIN}/go/${s.toLowerCase()}`;
  }
  return null;
}

/** One URL per line, or comma / whitespace separated. */
export function resolveResourceUrls(raw: string): string[] {
  const parts = raw
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const url = resolveResourceUrl(part);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

export function publicReply(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().replace(/[\u2013\u2014]/g, "-");
  return (t || DEFAULT_COMMENT_REPLY).slice(0, 220);
}

/**
 * Instagram often drops generic URL buttons. Always put the links in the
 * message body so the DM is usable even when the tap card does not render.
 */
export function buildDmMessage(
  keyword: string,
  message: string | null | undefined,
  resourceUrls: string[] | string = [],
): string {
  const custom = (message ?? "").trim().replace(/[\u2013\u2014]/g, "-");
  const body = custom || `you commented "${keyword}". here you go:`;
  const urls = (Array.isArray(resourceUrls) ? resourceUrls : resolveResourceUrls(resourceUrls))
    .map((u) => u.trim())
    .filter(Boolean);
  const missing = urls.filter((u) => !body.includes(u));
  const urlBlock = missing.length ? `\n\n${missing.join("\n")}` : "";
  const followBlock = alreadyAsksFollow(body) ? "" : `\n\n${FOLLOW_ASK}`;
  const suffix = `${urlBlock}${followBlock}`;
  if (!suffix) return body.slice(0, DM_MESSAGE_MAX);
  const room = DM_MESSAGE_MAX - suffix.length;
  const trimmed = body.slice(0, Math.max(0, room)).trimEnd();
  return `${trimmed}${suffix}`.slice(0, DM_MESSAGE_MAX);
}
