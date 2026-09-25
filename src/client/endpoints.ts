/**
 * The capability surface. Social Agents may only touch CreatorOS endpoints listed
 * here — the allowlist is enforced in the executor (every request funnels
 * through checkEndpoint), not by prompt discipline. The hard blocks below
 * win over everything. Route reference: https://www.creatoros.ca/docs
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export const PLAN_MESSAGE = 'Manage your plan and API keys in the CreatorOS app.';
export const NOT_CREATOROS_MESSAGE = "That endpoint isn't part of CreatorOS.";

interface EndpointRule {
  method: HttpMethod | '*';
  pattern: RegExp;
}

/**
 * Never reachable from the agent, whatever the API would allow. Checked
 * BEFORE the allowlist; requests get the plan message.
 */
const HARD_BLOCKS: EndpointRule[] = [
  // API key management: keys can't mint keys, and the agent never tries
  { method: '*', pattern: /^\/v1\/(api-keys|keys)(\/|$)/ },
  // Disconnecting a social account is the human's call, in the app
  { method: 'DELETE', pattern: /^\/v1\/accounts\/[^/]+\/?$/ },
];

const ID = '[^/]+';
const rule = (method: HttpMethod, path: string): EndpointRule => ({
  method,
  pattern: new RegExp(`^${path.replace(/:id/g, ID)}/?$`),
});

/** The permitted capability surface. */
const ALLOWLIST: EndpointRule[] = [
  // ---- Workspace (key validation) ----
  rule('GET', '/v1/me'),

  // ---- Accounts ----
  rule('GET', '/v1/accounts'),
  rule('GET', '/v1/accounts/health'),
  rule('GET', '/v1/accounts/followers'),
  rule('GET', '/v1/accounts/:id/health'),
  rule('GET', '/v1/accounts/:id/posts'),
  rule('GET', '/v1/accounts/:id/tiktok/creator-info'),
  rule('GET', '/v1/connect/:id'),

  // ---- Posting (all content types, multiposting, scheduling) ----
  rule('GET', '/v1/posts'),
  rule('POST', '/v1/posts'),
  rule('GET', '/v1/posts/:id'),
  rule('PATCH', '/v1/posts/:id'),
  rule('PUT', '/v1/posts/:id'),
  rule('DELETE', '/v1/posts/:id'),
  { method: 'POST', pattern: new RegExp(`^/v1/posts/${ID}/(retry|unpublish|update-metadata|edit)/?$`) },

  // ---- Media ----
  rule('POST', '/v1/media'),

  // ---- Pre-publish validation ----
  { method: 'POST', pattern: /^\/v1\/tools\/validate\/(post|post-length|media)\/?$/ },

  // ---- Analytics (read-only) ----
  { method: 'GET', pattern: /^\/v1\/analytics\/(posts|daily|best-time|post-timeline|content-decay|posting-frequency|delta)\/?$/ },
  { method: 'GET', pattern: /^\/v1\/analytics\/(inbox|instagram|tiktok|youtube|linkedin|facebook)\/[a-z-]+(\/[^/]+)?\/?$/ },

  // ---- Posting queue (read-only; queue edits happen in the app) ----
  rule('GET', '/v1/queue/slots'),
  rule('GET', '/v1/queue/next-slot'),
  rule('GET', '/v1/queue/preview'),

  // ---- Inbox: comments ----
  rule('GET', '/v1/inbox/comments'),
  rule('GET', '/v1/inbox/comments/:id'),
  rule('POST', '/v1/inbox/comments/:id/reply'),
  rule('DELETE', '/v1/inbox/comments/:id/:id'),
  { method: 'POST', pattern: new RegExp(`^/v1/inbox/comments/${ID}/${ID}/(hide|like|pin|private-reply|moderation)/?$`) },
  { method: 'DELETE', pattern: new RegExp(`^/v1/inbox/comments/${ID}/${ID}/(hide|like|pin)/?$`) },

  // ---- Inbox: conversations / DMs ----
  rule('GET', '/v1/inbox/conversations'),
  rule('GET', '/v1/inbox/conversations/:id'),
  rule('PUT', '/v1/inbox/conversations/:id'),
  rule('GET', '/v1/inbox/conversations/:id/messages'),
  rule('POST', '/v1/inbox/conversations/:id/messages'),
  rule('POST', '/v1/inbox/conversations/:id/read'),

  // ---- Comment-to-DM funnels ----
  rule('GET', '/v1/automations'),
  rule('POST', '/v1/automations'),
  rule('GET', '/v1/automations/:id'),
  rule('PATCH', '/v1/automations/:id'),
  rule('DELETE', '/v1/automations/:id'),
  rule('GET', '/v1/automations/:id/logs'),

  // ---- Webhook endpoints ----
  rule('GET', '/v1/webhooks'),
  rule('POST', '/v1/webhooks'),
  rule('DELETE', '/v1/webhooks/:id'),
  rule('POST', '/v1/webhooks/:id/test'),
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
