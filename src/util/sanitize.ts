/**
 * The user only ever sees the platform name "CreatorOS". Error bodies and
 * doc links from any upstream the API sits on could name the vendor — every
 * string that could surface to the user or the agent passes through here
 * first. Defence in depth: CreatorOS itself should never send these.
 */
const VENDOR = new RegExp(['zer', 'nio', '|get', 'late'].join(''), 'gi');
const VENDOR_DOCS = new RegExp(`https?://(docs\\.)?(${VENDOR.source})\\.\\w+\\S*`, 'gi');

export function sanitize(text: unknown): string {
  const value = typeof text === 'string' ? text : safeStringify(text);
  return value.replace(VENDOR_DOCS, 'the CreatorOS docs').replace(VENDOR, 'CreatorOS');
}

/** Error objects (`{ code, message }`) render as their message, not "[object Object]". */
function safeStringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
