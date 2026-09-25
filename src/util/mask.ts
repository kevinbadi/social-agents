/**
 * API keys must never appear in full in any log line or file. CreatorOS
 * keys render as `cos_live_...last4` (or `cos_test_...`); anything else,
 * including pre-CreatorOS `sk_` keys, keeps only its prefix and last 4.
 */
export function maskKey(key: string): string {
  if (!key) return 'cos_...';
  const last4 = key.length > 12 ? key.slice(-4) : '';
  const prefix = /^cos_(live|test)_/.exec(key)?.[0] ?? (key.startsWith('sk_') ? 'sk_' : 'cos_');
  return `${prefix}...${last4}`;
}
