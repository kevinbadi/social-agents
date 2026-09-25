/**
 * CreatorOSClient — the only way Social Agents talk to CreatorOS servers.
 * Every request funnels through `request()`, which enforces the endpoint
 * allowlist and the hard blocks before anything touches the network.
 * Reference: https://www.creatoros.ca/docs
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import {
  BlockedEndpointError,
  checkEndpoint,
  type HttpMethod,
} from './endpoints.js';
import {
  assertCommentDeleteSupported,
  assertCommentHideSupported,
  assertCommentLikeSupported,
  assertCommentReplySupported,
  assertFunnelSupported,
  assertMessageReplySupported,
  assertPrivateReplySupported,
} from './platformMatrix.js';
import { sanitize } from '../util/sanitize.js';
import { maskKey } from '../util/mask.js';
import { annotateOwnComments, annotateOwnMessages, SelfReplyBlockedError } from './selfGuard.js';
import type {
  CommentAutomationBody,
  CreatePostBody,
  CreateWebhookBody,
  Me,
  Post,
  SocialAccount,
  UpdatePostBody,
  UploadedMedia,
} from './types.js';

export const DEFAULT_BASE_URL = 'https://creatoros-production-5658.up.railway.app';

/** CREATOROS_API_URL wins so the API can move hosts without a release. */
export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CREATOROS_API_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export const KEY_SHAPE = /^cos_(live|test)_[A-Za-z0-9_-]{32}$/;
/** Keys issued before CreatorOS had its own API. No longer accepted here. */
const LEGACY_KEY_SHAPE = /^sk_[0-9a-fA-F]{64}$/;

export const GET_KEY_HELP =
  'Get a CreatorOS API key (cos_live_...) at https://www.creatoros.ca/ under Settings, API keys, or run `npx @creatoros/cli init`.';

export function isValidKeyShape(key: string): boolean {
  return KEY_SHAPE.test(key);
}

export function isLegacyKey(key: string): boolean {
  return key.startsWith('sk_') || LEGACY_KEY_SHAPE.test(key);
}

export class LegacyApiKeyError extends Error {
  constructor() {
    super(`The saved API key (sk_...) is from before CreatorOS had its own API and no longer works. ${GET_KEY_HELP}`);
    this.name = 'LegacyApiKeyError';
  }
}

/** A CreatorOS error: `{ error: { code, message, status } }`, parsed defensively. */
export class CreatorOSApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, body: unknown, fallback: string) {
    const { code, message } = parseErrorBody(body, status, fallback);
    super(sanitize(message));
    this.name = 'CreatorOSApiError';
    this.status = status;
    this.code = code;
  }
}

export function parseErrorBody(body: unknown, status: number, fallback: string): { code: string; message: string } {
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  if (error && typeof error === 'object') {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return {
      code: typeof code === 'string' ? code : 'error',
      message: typeof message === 'string' && message ? message : fallback,
    };
  }
  if (typeof error === 'string') {
    const message = (body as { message?: unknown }).message;
    return { code: error, message: typeof message === 'string' ? message : error.replace(/_/g, ' ') };
  }
  if (status === 401) return { code: 'unauthorized', message: `CreatorOS rejected the API key. ${GET_KEY_HELP}` };
  return { code: 'http_error', message: fallback };
}

type Query = Record<string, string | number | boolean | undefined>;

/** IDs are opaque: encode them into paths, never reshape them. */
const enc = encodeURIComponent;

export interface CreatorOSClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class CreatorOSClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  /** Ids of comments this account authored, learned from fetches — reply targets that would be self-replies. */
  private readonly ownCommentIds = new Set<string>();
  /** Per conversation: is the latest message the account's own? Learned from fetches and sends. */
  private readonly conversationLatestOwn = new Map<string, boolean>();

  constructor(options: CreatorOSClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? resolveBaseUrl()).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get maskedKey(): string {
    return maskKey(this.apiKey);
  }

  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    opts: {
      query?: Query;
      body?: unknown;
      /** Raw request body (media upload); sent as-is with the given headers. */
      raw?: ReadableStream | Uint8Array | string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const decision = checkEndpoint(method, path);
    if (!decision.allowed) throw new BlockedEndpointError(decision);

    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'User-Agent': 'social-agents',
      ...opts.headers,
    };
    let body: RequestInit['body'] = opts.raw as RequestInit['body'];
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    const init: RequestInit & { duplex?: 'half' } = { method, headers, body };
    // Streamed bodies (media) need half-duplex in Node's fetch.
    if (opts.raw instanceof ReadableStream) init.duplex = 'half';
    const response = await this.fetchImpl(url.toString(), init);
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }

    if (!response.ok) {
      throw new CreatorOSApiError(response.status, parsed, `CreatorOS request failed (${response.status})`);
    }
    return parsed as T;
  }

  // ---- Workspace ----

  /** The key's user and workspace. A key is pinned to exactly one workspace. */
  async getMe(): Promise<Me> {
    return this.request('GET', '/v1/me');
  }

  /** Live authenticated check. Shape-check the key with isValidKeyShape first. */
  async validateKey(): Promise<boolean> {
    try {
      await this.getMe();
      return true;
    } catch (error) {
      if (error instanceof CreatorOSApiError && (error.status === 401 || error.status === 403)) {
        return false;
      }
      throw error;
    }
  }

  // ---- Accounts ----

  async listAccounts(query: Query = {}): Promise<{ accounts: SocialAccount[] }> {
    return this.request('GET', '/v1/accounts', { query });
  }

  async accountsHealth(query: Query = {}): Promise<unknown> {
    return this.request('GET', '/v1/accounts/health', { query });
  }

  async accountHealth(accountId: string): Promise<unknown> {
    return this.request('GET', `/v1/accounts/${enc(accountId)}/health`);
  }

  async followerStats(query: Query = {}): Promise<unknown> {
    return this.request('GET', '/v1/accounts/followers', { query });
  }

  async tiktokCreatorInfo(accountId: string, mediaType: 'video' | 'photo' = 'video'): Promise<unknown> {
    return this.request('GET', `/v1/accounts/${enc(accountId)}/tiktok/creator-info`, {
      query: { mediaType },
    });
  }

  /** A link the human opens to connect a social account to the workspace. */
  async connectLink(platform: string): Promise<{ platform: string; auth_url: string }> {
    return this.request('GET', `/v1/connect/${enc(platform)}`);
  }

  // ---- Posts ----

  async createPost(body: CreatePostBody): Promise<Post> {
    return this.request('POST', '/v1/posts', { body });
  }

  async getPost(postId: string): Promise<Post> {
    return this.request('GET', `/v1/posts/${enc(postId)}`);
  }

  async listPosts(query: Query = {}): Promise<{ posts: Post[]; pagination?: unknown }> {
    return this.request('GET', '/v1/posts', { query });
  }

  /** Edit a draft or scheduled post: caption and/or time. */
  async updatePost(postId: string, body: UpdatePostBody): Promise<Post> {
    return this.request('PATCH', `/v1/posts/${enc(postId)}`, { body });
  }

  async deletePost(postId: string): Promise<unknown> {
    return this.request('DELETE', `/v1/posts/${enc(postId)}`);
  }

  async retryPost(postId: string): Promise<unknown> {
    return this.request('POST', `/v1/posts/${enc(postId)}/retry`, { body: {} });
  }

  /** Take a published post down from one network (not Instagram or TikTok). */
  async unpublishPost(postId: string, platform: string): Promise<unknown> {
    return this.request('POST', `/v1/posts/${enc(postId)}/unpublish`, { body: { platform } });
  }

  /** Edit the text of an already-published post (X, Facebook, LinkedIn, YouTube). */
  async editPublishedPost(postId: string, body: { platform: string; content: string; accountId?: string }): Promise<unknown> {
    return this.request('POST', `/v1/posts/${enc(postId)}/edit`, { body });
  }

  async updateYouTubeMetadata(postId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `/v1/posts/${enc(postId)}/update-metadata`, { body });
  }

  // ---- Media ----

  /**
   * Stream a local file to POST /v1/media. Returns `{ id: "med_...", url }`:
   * pass the id in `media` (or `cover`) on createPost.
   */
  async uploadMediaFromFile(filePath: string): Promise<UploadedMedia> {
    const contentType = guessContentType(filePath);
    const { size } = await stat(filePath);
    return this.request('POST', '/v1/media', {
      raw: Readable.toWeb(createReadStream(filePath)) as ReadableStream,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'X-Filename': basename(filePath),
      },
    });
  }

  // ---- Validation ----

  async validatePost(body: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', '/v1/tools/validate/post', { body });
  }

  async validatePostLength(text: string): Promise<unknown> {
    return this.request('POST', '/v1/tools/validate/post-length', { body: { text } });
  }

  async validateMedia(url: string): Promise<unknown> {
    return this.request('POST', '/v1/tools/validate/media', { body: { url } });
  }

  // ---- Analytics ----

  async postAnalytics(query: Query = {}): Promise<unknown> {
    return this.request('GET', '/v1/analytics/posts', { query });
  }

  async bestTimeToPost(query: Query = {}): Promise<unknown> {
    return this.request('GET', '/v1/analytics/best-time', { query });
  }

  async dailyMetrics(query: Query = {}): Promise<unknown> {
    return this.request('GET', '/v1/analytics/daily', { query });
  }

  async postTimeline(query: Query = {}): Promise<unknown> {
    return this.request('GET', '/v1/analytics/post-timeline', { query });
  }

  // ---- Inbox: comments ----

  async listComments(query: Query = {}): Promise<unknown> {
    const data = await this.request('GET', '/v1/inbox/comments', { query });
    for (const id of annotateOwnComments(data)) this.ownCommentIds.add(id);
    return data;
  }

  async getPostComments(postId: string, query: Query): Promise<unknown> {
    const data = await this.request('GET', `/v1/inbox/comments/${enc(postId)}`, { query });
    for (const id of annotateOwnComments(data)) this.ownCommentIds.add(id);
    return data;
  }

  /** The self-reply loop breaker: a comment this account wrote is never a valid reply target. */
  private assertNotOwnComment(commentId: string | undefined, action: string): void {
    if (commentId && this.ownCommentIds.has(commentId)) {
      throw new SelfReplyBlockedError(
        `Blocked: comment ${commentId} was posted by this account. ${action} your own comment creates an infinite self-reply loop — treat it as "already handled" and move on.`,
      );
    }
  }

  /**
   * Reply to a post or a specific comment. `platform` is required so the
   * platform matrix is enforced here, in code — a TikTok request returns
   * "not supported on this platform", never a raw API error.
   */
  async replyToComment(args: {
    platform: string;
    postId: string;
    accountId: string;
    message: string;
    commentId?: string;
  }): Promise<unknown> {
    assertCommentReplySupported(args.platform);
    this.assertNotOwnComment(args.commentId, 'Replying to');
    return this.request('POST', `/v1/inbox/comments/${enc(args.postId)}/reply`, {
      body: { accountId: args.accountId, message: args.message, ...(args.commentId ? { commentId: args.commentId } : {}) },
    });
  }

  /** Like a comment. */
  async likeComment(args: {
    platform: string;
    postId: string;
    commentId: string;
    accountId: string;
  }): Promise<unknown> {
    assertCommentLikeSupported(args.platform);
    return this.request('POST', `/v1/inbox/comments/${enc(args.postId)}/${enc(args.commentId)}/like`, {
      body: { accountId: args.accountId },
    });
  }

  /** Delete a comment. */
  async deleteComment(args: {
    platform: string;
    postId: string;
    commentId: string;
    accountId: string;
  }): Promise<unknown> {
    assertCommentDeleteSupported(args.platform);
    return this.request('DELETE', `/v1/inbox/comments/${enc(args.postId)}/${enc(args.commentId)}`, {
      query: { accountId: args.accountId },
    });
  }

  /**
   * Hide a comment (visible only to the commenter and page admin).
   * Facebook, Instagram, Threads, and Twitter/X; on X the reply must belong
   * to a conversation the account started.
   */
  async hideComment(args: {
    platform: string;
    postId: string;
    commentId: string;
    accountId: string;
  }): Promise<unknown> {
    assertCommentHideSupported(args.platform);
    return this.request('POST', `/v1/inbox/comments/${enc(args.postId)}/${enc(args.commentId)}/hide`, {
      body: { accountId: args.accountId },
    });
  }

  /** Comment → DM private reply. Instagram and Facebook only, 7-day window. */
  async privateReplyToComment(args: {
    platform: string;
    postId: string;
    commentId: string;
    accountId: string;
    message: string;
  }): Promise<unknown> {
    assertPrivateReplySupported(args.platform);
    this.assertNotOwnComment(args.commentId, 'Privately replying to');
    return this.request('POST', `/v1/inbox/comments/${enc(args.postId)}/${enc(args.commentId)}/private-reply`, {
      body: { accountId: args.accountId, message: args.message },
    });
  }

  // ---- Inbox: conversations / DMs ----

  async listConversations(query: Query = {}): Promise<unknown> {
    return this.request('GET', '/v1/inbox/conversations', { query });
  }

  async getConversationMessages(conversationId: string, query: Query): Promise<unknown> {
    const data = await this.request('GET', `/v1/inbox/conversations/${enc(conversationId)}/messages`, { query });
    const latestIsOwn = annotateOwnMessages(data);
    if (latestIsOwn !== null) this.conversationLatestOwn.set(conversationId, latestIsOwn);
    return data;
  }

  /**
   * Send a DM in an existing conversation. Platform matrix enforced. The
   * auto-response loop breaker: when the latest message in the conversation
   * is the account's own, sending would mean answering yourself — blocked
   * unless allowFollowUp marks it an intentional human-approved follow-up.
   */
  async sendMessage(args: {
    platform: string;
    conversationId: string;
    accountId: string;
    message: string;
    allowFollowUp?: boolean;
  }): Promise<unknown> {
    assertMessageReplySupported(args.platform);
    if (!args.allowFollowUp && this.conversationLatestOwn.get(args.conversationId) === true) {
      throw new SelfReplyBlockedError(
        `Blocked: the latest message in conversation ${args.conversationId} is this account's own — sending now would answer yourself and loop. Wait for the other person to reply. For an intentional follow-up the human explicitly asked for, pass allowFollowUp: true.`,
      );
    }
    const result = await this.request('POST', `/v1/inbox/conversations/${enc(args.conversationId)}/messages`, {
      body: { accountId: args.accountId, message: args.message },
    });
    this.conversationLatestOwn.set(args.conversationId, true);
    return result;
  }

  // ---- Comment-to-DM funnels (/v1/automations) ----

  /** Create a funnel. `platform` of the target account must be IG/FB. */
  async createCommentAutomation(platform: string, body: CommentAutomationBody): Promise<unknown> {
    assertFunnelSupported(platform);
    return this.request('POST', '/v1/automations', { body });
  }

  async listCommentAutomations(): Promise<unknown> {
    return this.request('GET', '/v1/automations');
  }

  async getCommentAutomation(automationId: string): Promise<unknown> {
    return this.request('GET', `/v1/automations/${enc(automationId)}`);
  }

  async updateCommentAutomation(
    automationId: string,
    body: Partial<Pick<CommentAutomationBody, 'dmMessage' | 'keywords' | 'commentReply'>>,
  ): Promise<unknown> {
    return this.request('PATCH', `/v1/automations/${enc(automationId)}`, { body });
  }

  async deleteCommentAutomation(automationId: string): Promise<unknown> {
    return this.request('DELETE', `/v1/automations/${enc(automationId)}`);
  }

  async commentAutomationLogs(automationId: string, query: Query = {}): Promise<unknown> {
    return this.request('GET', `/v1/automations/${enc(automationId)}/logs`, { query });
  }

  // ---- Webhooks ----

  async listWebhooks(): Promise<unknown> {
    return this.request('GET', '/v1/webhooks');
  }

  /** The response carries the signing `secret` (whsec_...) once, and never again. */
  async createWebhook(body: CreateWebhookBody): Promise<unknown> {
    return this.request('POST', '/v1/webhooks', { body });
  }

  async deleteWebhook(webhookId: string): Promise<unknown> {
    return this.request('DELETE', `/v1/webhooks/${enc(webhookId)}`);
  }

  async testWebhook(webhookId: string): Promise<unknown> {
    return this.request('POST', `/v1/webhooks/${enc(webhookId)}/test`);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

export function guessContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (['.heic', '.heif', '.avif'].includes(ext)) {
    throw new Error(`${ext} images aren't accepted by the social networks. Convert to JPG first (e.g. \`sips -s format jpeg in${ext} --out out.jpg\`).`);
  }
  const type = CONTENT_TYPES[ext];
  if (!type) {
    throw new Error(
      `Unsupported media type "${ext}". Supported: ${Object.keys(CONTENT_TYPES).join(', ')}`,
    );
  }
  return type;
}
