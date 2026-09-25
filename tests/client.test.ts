import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CreatorOSApiError,
  CreatorOSClient,
  DEFAULT_BASE_URL,
  guessContentType,
  isLegacyKey,
  isValidKeyShape,
  parseErrorBody,
  resolveBaseUrl,
} from '../src/client/client.js';
import { maskKey } from '../src/util/mask.js';
import { sanitize } from '../src/util/sanitize.js';

const KEY = 'cos_live_' + 'Ab3_-'.repeat(6) + 'xy';
const TEST_KEY = 'cos_test_' + 'q'.repeat(32);
const LEGACY_KEY = 'sk_' + 'ab'.repeat(32);
// Built at runtime so the upstream vendor name never appears in source.
const VENDOR = ['Zer', 'nio'].join('');

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

function envelope(code: string, message: string, status: number) {
  return { error: { code, message, status } };
}

describe('key validation', () => {
  it('accepts cos_live_ and cos_test_ + 32 base64url characters', () => {
    expect(KEY).toHaveLength(9 + 32);
    expect(isValidKeyShape(KEY)).toBe(true);
    expect(isValidKeyShape(TEST_KEY)).toBe(true);
  });

  it('rejects wrong shapes, including pre-CreatorOS sk_ keys', () => {
    expect(isValidKeyShape(LEGACY_KEY)).toBe(false);
    expect(isValidKeyShape('cos_live_short')).toBe(false);
    expect(isValidKeyShape('cos_prod_' + 'a'.repeat(32))).toBe(false);
    expect(isValidKeyShape('cos_live_' + 'a'.repeat(31) + '!')).toBe(false);
    expect(isValidKeyShape('')).toBe(false);
  });

  it('recognizes legacy sk_ keys so callers can explain the switch', () => {
    expect(isLegacyKey(LEGACY_KEY)).toBe(true);
    expect(isLegacyKey(KEY)).toBe(false);
  });

  it('validateKey calls GET /v1/me: false on 401, true on 200', async () => {
    const bad = new CreatorOSClient({ apiKey: KEY, fetchImpl: fakeFetch(401, envelope('unauthorized', 'Missing or invalid API key.', 401)) });
    expect(await bad.validateKey()).toBe(false);
    const impl = fakeFetch(200, { user: { id: 'u1' }, workspace: { id: 'ws1', name: 'Brand', ready: true } });
    const good = new CreatorOSClient({ apiKey: KEY, fetchImpl: impl });
    expect(await good.validateKey()).toBe(true);
    const [url, init] = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_BASE_URL}/v1/me`);
    expect(init.method).toBe('GET');
  });

  it('validateKey rethrows non-auth failures', async () => {
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: fakeFetch(503, envelope('service_unavailable', 'Try again.', 503)) });
    await expect(client.validateKey()).rejects.toThrow('Try again.');
  });
});

describe('base URL', () => {
  it('defaults to the CreatorOS API with no /api prefix', () => {
    expect(resolveBaseUrl({})).toBe('https://creatoros-production-5658.up.railway.app');
  });

  it('CREATOROS_API_URL overrides it (trailing slash trimmed)', () => {
    expect(resolveBaseUrl({ CREATOROS_API_URL: 'https://api.creatoros.ca/' })).toBe('https://api.creatoros.ca');
  });

  it('the client reads the override at construction', async () => {
    const previous = process.env.CREATOROS_API_URL;
    process.env.CREATOROS_API_URL = 'https://api.creatoros.ca';
    try {
      const impl = fakeFetch(200, { accounts: [] });
      await new CreatorOSClient({ apiKey: KEY, fetchImpl: impl }).listAccounts();
      const [url] = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [string];
      expect(url).toBe('https://api.creatoros.ca/v1/accounts');
    } finally {
      if (previous === undefined) delete process.env.CREATOROS_API_URL;
      else process.env.CREATOROS_API_URL = previous;
    }
  });
});

describe('error envelope', () => {
  it('parses { error: { code, message, status } } into a typed error', async () => {
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: fakeFetch(404, envelope('not_found', 'Post not found.', 404)) });
    const error = await client.getPost('post_missing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CreatorOSApiError);
    expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'Post not found.' });
  });

  it('never renders an object error as [object Object]', () => {
    expect(parseErrorBody(envelope('plan_required', 'Upgrade to post.', 402), 402, 'fallback')).toEqual({
      code: 'plan_required',
      message: 'Upgrade to post.',
    });
  });

  it('tolerates a bare string error and an empty body', () => {
    expect(parseErrorBody({ error: 'rate_limited' }, 429, 'fallback')).toEqual({ code: 'rate_limited', message: 'rate limited' });
    expect(parseErrorBody(undefined, 500, 'CreatorOS request failed (500)')).toEqual({
      code: 'http_error',
      message: 'CreatorOS request failed (500)',
    });
    expect(parseErrorBody(undefined, 401, 'x').message).toContain('cos_live_');
  });

  it('sanitizes vendor names out of API error text', async () => {
    const client = new CreatorOSClient({
      apiKey: KEY,
      fetchImpl: fakeFetch(502, envelope('upstream_error', `${VENDOR} rejected this post; see https://docs.${VENDOR.toLowerCase()}.com/posts`, 502)),
    });
    const error = await client.createPost({ content: 'x', platforms: ['twitter'] }).catch((e) => e);
    expect(String(error.message)).not.toMatch(new RegExp(VENDOR, 'i'));
    expect(error.message).toContain('CreatorOS');
    expect(error.code).toBe('upstream_error');
  });
});

describe('hard blocks never touch the network', () => {
  it('key management is refused with the plan message and zero fetches', async () => {
    const spy = vi.fn();
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: spy as unknown as typeof fetch });
    await expect(client.request('POST', '/v1/api-keys', { body: {} })).rejects.toThrow('Manage your plan and API keys in the CreatorOS app.');
    await expect(client.request('DELETE', '/v1/accounts/acc_1')).rejects.toThrow('Manage your plan and API keys in the CreatorOS app.');
    expect(spy).not.toHaveBeenCalled();
  });

  it('routes that do not exist on CreatorOS are refused with the capability message', async () => {
    const spy = vi.fn();
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: spy as unknown as typeof fetch });
    for (const [method, path] of [
      ['GET', '/v1/profiles'],
      ['POST', '/v1/media/presign'],
      ['GET', '/v1/comment-automations'],
      ['GET', '/v1/webhooks/settings'],
      ['POST', '/v1/ads/create'],
    ] as const) {
      await expect(client.request(method, path)).rejects.toThrow("That endpoint isn't part of CreatorOS.");
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('requests', () => {
  it('sends bearer auth and the simple-form JSON body, including cover', async () => {
    const impl = vi.fn(async () => new Response(JSON.stringify({ id: 'post_1', status: 'scheduled' }), { status: 201 }));
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: impl as unknown as typeof fetch });
    const post = await client.createPost({
      content: 'hi',
      platforms: ['instagram', 'tiktok'],
      media: ['med_video1'],
      cover: 'med_cover1',
      schedule_at: '2026-10-01T09:00:00',
      timezone: 'America/Toronto',
    });
    expect(post.id).toBe('post_1');
    const [url, init] = impl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_BASE_URL}/v1/posts`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ platforms: ['instagram', 'tiktok'], media: ['med_video1'], cover: 'med_cover1' });
    expect(body).not.toHaveProperty('profileId');
  });

  it('passes opaque ids through untouched (URL-encoded, never reshaped)', async () => {
    const impl = fakeFetch(200, { id: 'post_a-B_c', status: 'draft' });
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: impl });
    await client.getPost('post_a-B_c');
    const [url] = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [string];
    expect(url).toBe(`${DEFAULT_BASE_URL}/v1/posts/post_a-B_c`);
  });

  it('edits drafts with PATCH { content, scheduledFor, timezone }', async () => {
    const impl = fakeFetch(200, { id: 'post_1', status: 'scheduled' });
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: impl });
    await client.updatePost('post_1', { scheduledFor: '2026-10-02T10:00:00', timezone: 'UTC' });
    const [url, init] = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, RequestInit];
    expect(url).toContain('/v1/posts/post_1');
    expect(init.method).toBe('PATCH');
  });

  it('uses the new automation and webhook routes', async () => {
    const impl = fakeFetch(200, { success: true });
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: impl });
    await client.listCommentAutomations();
    await client.commentAutomationLogs('auto_1');
    await client.deleteWebhook('9b2c3d4e-0000-4000-8000-000000000000');
    await client.testWebhook('9b2c3d4e-0000-4000-8000-000000000000');
    const calls = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>;
    expect(calls.map(([url, init]) => `${init.method} ${url.replace(DEFAULT_BASE_URL, '')}`)).toEqual([
      'GET /v1/automations',
      'GET /v1/automations/auto_1/logs',
      'DELETE /v1/webhooks/9b2c3d4e-0000-4000-8000-000000000000',
      'POST /v1/webhooks/9b2c3d4e-0000-4000-8000-000000000000/test',
    ]);
  });

  it('replies to comments at /reply and deletes by comment path', async () => {
    const impl = fakeFetch(200, { success: true });
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: impl });
    await client.replyToComment({ platform: 'instagram', postId: 'post_1', accountId: 'acc_1', message: 'thanks!', commentId: 'cmt_1' });
    await client.deleteComment({ platform: 'instagram', postId: 'post_1', commentId: 'cmt_1', accountId: 'acc_1' });
    const calls = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe(`${DEFAULT_BASE_URL}/v1/inbox/comments/post_1/reply`);
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({ accountId: 'acc_1', message: 'thanks!', commentId: 'cmt_1' });
    expect(calls[1]![0]).toBe(`${DEFAULT_BASE_URL}/v1/inbox/comments/post_1/cmt_1?accountId=acc_1`);
    expect(calls[1]![1].method).toBe('DELETE');
  });
});

describe('media upload', () => {
  it('streams raw bytes to POST /v1/media and returns { id, url }', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'social-agents-media-'));
    const file = join(dir, 'cover.jpg');
    await writeFile(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    let sent: Uint8Array | null = null;
    const impl = vi.fn(async (_url: string, init: RequestInit) => {
      sent = new Uint8Array(await new Response(init.body).arrayBuffer());
      return new Response(JSON.stringify({ id: 'med_abc', url: 'https://cdn.example/med_abc.jpg', type: 'image' }), { status: 201 });
    });
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: impl as unknown as typeof fetch });
    const media = await client.uploadMediaFromFile(file);
    expect(media).toMatchObject({ id: 'med_abc', url: 'https://cdn.example/med_abc.jpg' });
    const [url, init] = impl.mock.calls[0]! as unknown as [string, RequestInit & { duplex?: string }];
    expect(url).toBe(`${DEFAULT_BASE_URL}/v1/media`);
    expect(init.method).toBe('POST');
    expect(init.duplex).toBe('half');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('image/jpeg');
    expect(headers['Content-Length']).toBe('7');
    expect(headers['X-Filename']).toBe('cover.jpg');
    expect(Array.from(sent!)).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  });

  it('rejects HEIC/HEIF/AVIF before any network call, with the fix', () => {
    for (const ext of ['heic', 'HEIF', 'avif']) {
      expect(() => guessContentType(`photo.${ext}`)).toThrow(/Convert to JPG/);
    }
    expect(guessContentType('clip.MOV')).toBe('video/quicktime');
  });
});

describe('key masking', () => {
  it('masks cos_live_ and cos_test_ keys to prefix...last4', () => {
    expect(maskKey(KEY)).toBe(`cos_live_...${KEY.slice(-4)}`);
    expect(maskKey(KEY)).not.toContain(KEY.slice(9, 20));
    expect(maskKey(TEST_KEY)).toBe(`cos_test_...${TEST_KEY.slice(-4)}`);
    expect(maskKey('')).toBe('cos_...');
  });

  it('still masks legacy sk_ keys', () => {
    expect(maskKey(LEGACY_KEY)).toBe(`sk_...${LEGACY_KEY.slice(-4)}`);
  });

  it('client exposes only the masked key', () => {
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: fakeFetch(200, {}) });
    expect(client.maskedKey).toBe(`cos_live_...${KEY.slice(-4)}`);
  });
});

describe('sanitize', () => {
  it('replaces the vendor name case-insensitively', () => {
    expect(sanitize(`${VENDOR.toUpperCase()} says ${VENDOR.toLowerCase()}`)).toBe('CreatorOS says CreatorOS');
  });
  it('rewrites vendor docs links', () => {
    expect(sanitize(`see https://docs.${VENDOR.toLowerCase()}.com/webhooks for details`)).toBe('see the CreatorOS docs for details');
  });
  it('renders error objects as their message', () => {
    expect(sanitize({ code: 'not_found', message: 'Post not found.' })).toBe('Post not found.');
  });
});
