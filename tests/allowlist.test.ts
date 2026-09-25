import { describe, expect, it } from 'vitest';
import {
  checkEndpoint,
  NOT_CREATOROS_MESSAGE,
  PLAN_MESSAGE,
} from '../src/client/endpoints.js';

describe('endpoint allowlist (CreatorOS /v1 route map)', () => {
  it('allows the workspace check and accounts', () => {
    expect(checkEndpoint('GET', '/v1/me').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/accounts?platform=instagram').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/accounts/health').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/accounts/followers').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/accounts/acc_1/health').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/accounts/acc_1/posts').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/accounts/acc_1/tiktok/creator-info?mediaType=video').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/connect/instagram').allowed).toBe(true);
  });

  it('allows the posting and media surface', () => {
    expect(checkEndpoint('POST', '/v1/posts').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/posts/post_abc').allowed).toBe(true);
    expect(checkEndpoint('PATCH', '/v1/posts/post_abc').allowed).toBe(true);
    expect(checkEndpoint('DELETE', '/v1/posts/post_abc').allowed).toBe(true);
    for (const action of ['retry', 'unpublish', 'update-metadata', 'edit']) {
      expect(checkEndpoint('POST', `/v1/posts/post_abc/${action}`).allowed).toBe(true);
    }
    expect(checkEndpoint('POST', '/v1/media').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/tools/validate/post-length').allowed).toBe(true);
  });

  it('allows analytics, queue reads, inbox, automations, and webhooks', () => {
    for (const path of ['posts', 'daily', 'best-time', 'post-timeline', 'content-decay', 'posting-frequency', 'delta']) {
      expect(checkEndpoint('GET', `/v1/analytics/${path}`).allowed).toBe(true);
    }
    expect(checkEndpoint('GET', '/v1/analytics/inbox/volume?fromDate=2026-09-01').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/analytics/instagram/account-insights').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/queue/next-slot').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/inbox/comments/post_1/reply').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/inbox/comments/post_1/cmt_1/hide').allowed).toBe(true);
    expect(checkEndpoint('DELETE', '/v1/inbox/comments/post_1/cmt_1/hide?accountId=acc_1').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/inbox/comments/post_1/cmt_1/private-reply').allowed).toBe(true);
    expect(checkEndpoint('DELETE', '/v1/inbox/comments/post_1/cmt_1?accountId=acc_1').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/inbox/conversations/conv_1/messages').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/inbox/conversations/conv_1/read').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/automations').allowed).toBe(true);
    expect(checkEndpoint('PATCH', '/v1/automations/auto_1').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/automations/auto_1/logs').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/webhooks').allowed).toBe(true);
    expect(checkEndpoint('DELETE', '/v1/webhooks/9b2c3d4e').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/webhooks/9b2c3d4e/test').allowed).toBe(true);
  });

  it('refuses routes that are not on CreatorOS, including the old ones', () => {
    for (const [method, path] of [
      ['GET', '/v1/profiles'],
      ['GET', '/v1/users'],
      ['POST', '/v1/media/presign'],
      ['POST', '/v1/posts/bulk-upload'],
      ['GET', '/v1/analytics'],
      ['GET', '/v1/analytics/daily-metrics'],
      ['GET', '/v1/accounts/follower-stats'],
      ['POST', '/v1/inbox/comments/post_1'],
      ['GET', '/v1/comment-automations'],
      ['GET', '/v1/webhooks/settings'],
      ['POST', '/v1/queue/slots'],
      ['POST', '/v1/ads/create'],
    ] as const) {
      const decision = checkEndpoint(method, path);
      expect(decision.allowed, `${method} ${path}`).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toBe('not-allowed');
        expect(decision.message).toBe(NOT_CREATOROS_MESSAGE);
      }
    }
  });
});

describe('hard blocks', () => {
  it.each([
    ['GET', '/v1/api-keys'],
    ['POST', '/v1/api-keys'],
    ['DELETE', '/v1/api-keys/key_1'],
    ['POST', '/v1/keys'],
    ['DELETE', '/v1/accounts/acc_1'],
  ] as const)('%s %s → plan message', (method, path) => {
    const decision = checkEndpoint(method, path);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('hard-block');
      expect(decision.message).toBe(PLAN_MESSAGE);
      expect(decision.message).toContain('CreatorOS app');
    }
  });

  it('hard blocks win even with query strings and trailing slashes', () => {
    expect(checkEndpoint('POST', '/v1/api-keys/').allowed).toBe(false);
    expect(checkEndpoint('DELETE', '/v1/accounts/acc_1?force=true').allowed).toBe(false);
  });
});
