/**
 * The capability surface. Midas may only touch CreatorOS endpoints listed
 * here — the allowlist is enforced in the executor (every request funnels
 * through checkEndpoint), not by prompt discipline. Profile-scoped keys are
 * known to permit some operations server-side that must never be exposed;
 * those are the hard blocks below and they win over everything.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export const PLAN_MESSAGE = 'Manage your plan in the CreatorOS app.';
export const NOT_CREATOROS_MESSAGE = "That endpoint isn't part of CreatorOS.";

interface EndpointRule {
  method: HttpMethod | '*';
  pattern: RegExp;
}

/**
 * Operations that exist in the API and can work with user keys, but create
 * billable resources on the CreatorOS master account or destroy the user's
 * subscription linkage. Never implemented, never allowlisted; requests get
 * the plan message. Checked BEFORE the allowlist.
 */
const HARD_BLOCKS: EndpointRule[] = [
  // Profile creation — bills the master account
  { method: 'POST', pattern: /^\/v1\/profiles\/?$/ },
  // Profile deletion — disconnects the user's accounts and subscription
  { method: 'DELETE', pattern: /^\/v1\/profiles\/[^/]+\/?$/ },
  // Phone number purchasing (incl. deprecated whatsapp alias) and the
  // surrounding provisioning tree — all plan/billing territory
  { method: '*', pattern: /^\/v1\/phone-numbers(\/|$)/ },
  { method: '*', pattern: /^\/v1\/whatsapp\/phone-numbers(\/|$)/ },
  // API key management — the API 403s this for scoped keys; blocked anyway
  { method: '*', pattern: /^\/v1\/api-keys(\/|$)/ },
];

/** The permitted capability surface, generated against the live API docs. */
const ALLOWLIST: EndpointRule[] = [
  // ---- Posting (all content types, multiposting, scheduling) ----
  { method: 'GET', pattern: /^\/v1\/posts\/?$/ },
  { method: 'POST', pattern: /^\/v1\/posts\/?$/ },
  { method: 'GET', pattern: /^\/v1\/posts\/[^/]+\/?$/ },
  { method: 'PUT', pattern: /^\/v1\/posts\/[^/]+\/?$/ },
  { method: 'DELETE', pattern: /^\/v1\/posts\/[^/]+\/?$/ },
  { method: 'POST', pattern: /^\/v1\/posts\/[^/]+\/retry\/?$/ },
  { method: 'POST', pattern: /^\/v1\/posts\/bulk-upload\/?$/ },
  { method: 'POST', pattern: /^\/v1\/posts\/[^/]+\/update-metadata\/?$/ },

  // ---- Media ----
  { method: 'POST', pattern: /^\/v1\/media\/presign\/?$/ },
  { method: 'POST', pattern: /^\/v1\/media\/upload-direct\/?$/ },

  // ---- Pre-publish validation ----
  { method: 'POST', pattern: /^\/v1\/tools\/validate\/(post|post-length|media)\/?$/ },

  // ---- Accounts (read/update only — no delete, no connect) ----
  { method: 'GET', pattern: /^\/v1\/accounts\/?$/ },
  { method: 'GET', pattern: /^\/v1\/accounts\/health\/?$/ },
  { method: 'GET', pattern: /^\/v1\/accounts\/follower-stats\/?$/ },
  { method: 'GET', pattern: /^\/v1\/accounts\/[^/]+\/health\/?$/ },
  { method: 'GET', pattern: /^\/v1\/accounts\/[^/]+\/tiktok\/creator-info\/?$/ },
  { method: 'PUT', pattern: /^\/v1\/accounts\/[^/]+\/?$/ },

  // ---- Profiles (read/update only; create/delete are hard-blocked) ----
  { method: 'GET', pattern: /^\/v1\/profiles\/?$/ },
  { method: 'GET', pattern: /^\/v1\/profiles\/[^/]+\/?$/ },
  { method: 'PUT', pattern: /^\/v1\/profiles\/[^/]+\/?$/ },

  // ---- Analytics ----
  { method: 'GET', pattern: /^\/v1\/analytics\/?$/ },
  { method: 'GET', pattern: /^\/v1\/analytics\/(best-time|daily-metrics|post-timeline|content-decay|posting-frequency)\/?$/ },

  // ---- Inbox: comments ----
  { method: 'GET', pattern: /^\/v1\/inbox\/comments\/?$/ },
  { method: 'GET', pattern: /^\/v1\/inbox\/comments\/[^/]+\/?$/ },
  { method: 'POST', pattern: /^\/v1\/inbox\/comments\/[^/]+\/?$/ },
  { method: 'DELETE', pattern: /^\/v1\/inbox\/comments\/[^/]+\/?$/ },
  { method: 'POST', pattern: /^\/v1\/inbox\/comments\/[^/]+\/[^/]+\/like\/?$/ },
  { method: 'POST', pattern: /^\/v1\/inbox\/comments\/[^/]+\/[^/]+\/hide\/?$/ },
  { method: 'POST', pattern: /^\/v1\/inbox\/comments\/[^/]+\/[^/]+\/private-reply\/?$/ },

  // ---- Inbox: conversations / DMs ----
  { method: 'GET', pattern: /^\/v1\/inbox\/conversations\/?$/ },
  { method: 'GET', pattern: /^\/v1\/inbox\/conversations\/[^/]+\/messages\/?$/ },
  { method: 'POST', pattern: /^\/v1\/inbox\/conversations\/[^/]+\/messages\/?$/ },

  // ---- Comment-to-DM funnels (comment automations) ----
  { method: 'GET', pattern: /^\/v1\/comment-automations\/?$/ },
  { method: 'POST', pattern: /^\/v1\/comment-automations\/?$/ },
  { method: 'GET', pattern: /^\/v1\/comment-automations\/[^/]+\/?$/ },
  { method: 'PATCH', pattern: /^\/v1\/comment-automations\/[^/]+\/?$/ },
  { method: 'DELETE', pattern: /^\/v1\/comment-automations\/[^/]+\/?$/ },
  { method: 'GET', pattern: /^\/v1\/comment-automations\/[^/]+\/logs\/?$/ },

  // ---- Webhook subscription management ----
  { method: 'GET', pattern: /^\/v1\/webhooks\/settings\/?$/ },
  { method: 'POST', pattern: /^\/v1\/webhooks\/settings\/?$/ },
  { method: 'PUT', pattern: /^\/v1\/webhooks\/settings\/?$/ },
  { method: 'DELETE', pattern: /^\/v1\/webhooks\/settings\/?$/ },
  { method: 'POST', pattern: /^\/v1\/webhooks\/test\/?$/ },
  { method: 'GET', pattern: /^\/v1\/webhooks\/logs\/?$/ },

  // ---- Auth check (key validation) ----
  { method: 'GET', pattern: /^\/v1\/users\/?$/ },
];

export type EndpointDecision =
  | { allowed: true }
  | { allowed: false; reason: 'hard-block' | 'not-allowed'; message: string };

function matches(rule: EndpointRule, method: HttpMethod, path: string): boolean {
  return (rule.method === '*' || rule.method === method) && rule.pattern.test(path);
}

/** Strip query string / fragment and normalize before matching. */
export function normalizePath(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? '';
  return bare.startsWith('/') ? bare : `/${bare}`;
}

export function checkEndpoint(method: HttpMethod, path: string): EndpointDecision {
  const normalized = normalizePath(path);
  if (HARD_BLOCKS.some((rule) => matches(rule, method, normalized))) {
    return { allowed: false, reason: 'hard-block', message: PLAN_MESSAGE };
  }
  if (ALLOWLIST.some((rule) => matches(rule, method, normalized))) {
    return { allowed: true };
  }
  return { allowed: false, reason: 'not-allowed', message: NOT_CREATOROS_MESSAGE };
}

export class BlockedEndpointError extends Error {
  readonly reason: 'hard-block' | 'not-allowed';
  constructor(decision: Exclude<EndpointDecision, { allowed: true }>) {
    super(decision.message);
    this.name = 'BlockedEndpointError';
    this.reason = decision.reason;
  }
}
