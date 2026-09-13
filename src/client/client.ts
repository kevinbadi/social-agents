/**
 * CreatorOSClient — the only way Midas talks to CreatorOS servers.
 * Every request funnels through `request()`, which enforces the endpoint
 * allowlist and the hard blocks before anything touches the network.
 *
 * (The base URL below is an internal wire constant. It must never surface
 * in logs, generated files, or agent output — see util/sanitize.ts.)
 */
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
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
  normalizePlatform,
} from './platformMatrix.js';
import { sanitize } from '../util/sanitize.js';
import { maskKey } from '../util/mask.js';
import { annotateOwnComments, annotateOwnMessages, SelfReplyBlockedError } from './selfGuard.js';
import type {
  ApiErrorBody,
  CommentAutomationBody,
  CreatePostBody,
  MediaItem,
  Post,
  PresignResponse,
  Profile,
  SocialAccount,
  WebhookConfig,
} from './types.js';

const BASE_URL = 'https://zernio.com/api';

export const KEY_SHAPE = /^sk_[0-9a-fA-F]{64}$/;

export function isValidKeyShape(key: string): boolean {
  return KEY_SHAPE.test(key);
}

export class CreatorOSApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly type?: string;
  constructor(status: number, body: ApiErrorBody | undefined, fallback: string) {
    super(sanitize(body?.error ?? fallback));
    this.name = 'CreatorOSApiError';
    this.status = status;
    this.code = body?.code;
    this.type = body?.type;
  }
}

type Query = Record<string, string | number | boolean | undefined>;

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
    this.baseUrl = (options.baseUrl ?? BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get maskedKey(): string {
    return maskKey(this.apiKey);
  }

  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    opts: { query?: Query; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const decision = checkEndpoint(method, path);
    if (!decision.allowed) throw new BlockedEndpointError(decision);

    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      ...opts.headers,
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    const response = await this.fetchImpl(url.toString(), { method, headers, body });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }

    if (!response.ok && response.status !== 202) {
      throw new CreatorOSApiError(
        response.status,
        parsed as ApiErrorBody | undefined,
        `CreatorOS request failed (${response.status})`,
      );
    }
    return parsed as T;
  }

  // ---- Auth ----

  /** Live authenticated check. Shape-check the key with isValidKeyShape first. */
  async validateKey(): Promise<boolean> {
    try {
      await this.request('GET', '/v1/users');
      return true;
    } catch (error) {
      if (error instanceof CreatorOSApiError && (error.status === 401 || error.status === 403)) {
        return false;
      }
      throw error;
    }
  }

  // ---- Accounts ----

  async listAccounts(query: Query = {}): Promise<{ accounts: SocialAccount[]; hasAnalyticsAccess?: boolean }> {
    return this.request('GET', '/v1/accounts', { query });
  }

  async accountsHealth(query: Query = {}): Promise<unknown> {
    return this.request('GET', '/v1/accounts/health', { query });
  }

  async accountHealth(accountId: string): Promise<unknown> {
    return this.request('GET', `/v1/accounts/${accountId}/health`);
  }

  async followerStats(query: Query = {}): Promise<unknown> {
    return this.request('GET', '/v1/accounts/follower-stats', { query });
  }

  async tiktokCreatorInfo(accountId: string, mediaType: 'video' | 'photo' = 'video'): Promise<unknown> {
    return this.request('GET', `/v1/accounts/${accountId}/tiktok/creator-info`, {
      query: { mediaType },
    });
  }

  // ---- Profiles (read/update only) ----

  async listProfiles(): Promise<{ profiles: Profile[] }> {
    return this.request('GET', '/v1/profiles');
  }

  async getProfile(profileId: string): Promise<{ profile: Profile }> {
    return this.request('GET', `/v1/profiles/${profileId}`);
  }

  async updateProfile(
    profileId: string,
    body: { name?: string; description?: string; color?: string },
  ): Promise<unknown> {
    return this.request('PUT', `/v1/profiles/${profileId}`, { body });
  }

  // ---- Posts ----

  async createPost(body: CreatePostBody, requestId?: string): Promise<{ post: Post; message?: string }> {
    return this.request('POST', '/v1/posts', {
      body,
      headers: requestId ? { 'x-request-id': requestId } : undefined,
    });
  }

  async getPost(postId: string): Promise<{ post: Post }> {
    return this.request('GET', `/v1/posts/${postId}`);
  }

  async listPosts(query: Query = {}): Promise<{ posts: Post[]; pagination?: unknown }> {
    return this.request('GET', '/v1/posts', { query });
  }

  async updatePost(postId: string, body: Partial<CreatePostBody>): Promise<unknown> {
    return this.request('PUT', `/v1/posts/${postId}`, { body });
  }

  async deletePost(postId: string): Promise<unknown> {
    return this.request('DELETE', `/v1/posts/${postId}`);
  }

  async retryPost(postId: string): Promise<unknown> {
    return this.request('POST', `/v1/posts/${postId}/retry`);
  }

  async updateYouTubeMetadata(postId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `/v1/posts/${postId}/update-metadata`, {
      body: { platform: 'youtube', ...body },
    });
  }

  // ---- Media ----

  async presignMedia(filename: string, contentType: string, size?: number): Promise<PresignResponse> {
    return this.request('POST', '/v1/media/presign', { body: { filename, contentType, size } });
  }

  /** Upload a local file: presign → PUT bytes → return a MediaItem for posts. */
  async uploadMediaFromFile(filePath: string): Promise<MediaItem> {
    const bytes = await readFile(filePath);
    const filename = basename(filePath);
    const contentType = guessContentType(filePath);
    const presigned = await this.presignMedia(filename, contentType, bytes.byteLength);
    const put = await this.fetchImpl(presigned.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: new Uint8Array(bytes),
    });
    if (!put.ok) {
      throw new Error(`Media upload failed (${put.status}) for ${filename}`);
    }
    return {
      type: contentType.startsWith('video/') ? 'video' : contentType === 'application/pdf' ? 'document' : 'image',
      url: presigned.publicUrl,
      filename,
      size: bytes.byteLength,
      mimeType: contentType,
    };
  }

  // ---- Validation ----

  async validatePost(body: CreatePostBody): Promise<unknown> {
    return this.request('POST', '/v1/tools/validate/post', { body });
  }

  async validatePostLength(text: string): Promise<unknown> {
    return this.request('POST', '/v1/tools/validate/post-length', { body: { text } });
  }

  async validateMedia(url: string): Promise<unknown> {
    return this.request('POST', '/v1/tools/validate/media', { body: { url } });
  }

  // ---- Analytics ----

  async getAnalytics(query: Query = {}): Promise<unknown> {
    return this.request('GET', '/v1/analytics', { query });
  }

  async bestTimeToPost(query: Query = {}): Promise<unknown> {
    return this.request('GET', '/v1/analytics/best-time', { query });
  }

  async dailyMetrics(query: Query = {}): Promise<unknown> {
    return this.request('GET', '/v1/analytics/daily-metrics', { query });
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
    const data = await this.request('GET', `/v1/inbox/comments/${postId}`, { query });
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
    return this.request('POST', `/v1/inbox/comments/${args.postId}`, {
      body: { accountId: args.accountId, message: args.message, commentId: args.commentId },
    });
  }

  /**
   * Like/upvote a comment. Facebook, Twitter/X, Bluesky, Reddit; Bluesky
   * additionally needs the comment's cid (content identifier).
   */
  async likeComment(args: {
    platform: string;
    postId: string;
    commentId: string;
    accountId: string;
    cid?: string;
  }): Promise<unknown> {
    assertCommentLikeSupported(args.platform);
    if (normalizePlatform(args.platform) === 'bluesky' && !args.cid) {
      throw new Error('Bluesky likes need the comment cid — it comes back with the comment in get_post_comments.');
    }
    return this.request('POST', `/v1/inbox/comments/${args.postId}/${args.commentId}/like`, {
      body: { accountId: args.accountId, ...(args.cid ? { cid: args.cid } : {}) },
    });
  }

  /** Delete a comment. Facebook, Instagram, Bluesky, Reddit, YouTube, LinkedIn. */
  async deleteComment(args: {
    platform: string;
    postId: string;
    commentId: string;
    accountId: string;
  }): Promise<unknown> {
    assertCommentDeleteSupported(args.platform);
    return this.request('DELETE', `/v1/inbox/comments/${args.postId}`, {
      query: { accountId: args.accountId, commentId: args.commentId },
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
    return this.request('POST', `/v1/inbox/comments/${args.postId}/${args.commentId}/hide`, {
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
    buttons?: unknown[];
  }): Promise<unknown> {
    assertPrivateReplySupported(args.platform);
    this.assertNotOwnComment(args.commentId, 'Privately replying to');
    return this.request('POST', `/v1/inbox/comments/${args.postId}/${args.commentId}/private-reply`, {
      body: { accountId: args.accountId, message: args.message, buttons: args.buttons },
    });
  }

  // ---- Inbox: conversations / DMs ----

  async listConversations(query: Query = {}): Promise<unknown> {
    return this.request('GET', '/v1/inbox/conversations', { query });
  }

  async getConversationMessages(conversationId: string, query: Query): Promise<unknown> {
    const data = await this.request('GET', `/v1/inbox/conversations/${conversationId}/messages`, { query });
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
    const result = await this.request('POST', `/v1/inbox/conversations/${args.conversationId}/messages`, {
      body: { accountId: args.accountId, message: args.message },
    });
    this.conversationLatestOwn.set(args.conversationId, true);
    return result;
  }

  // ---- Comment-to-DM funnels ----

  /** Create a funnel. `platform` of the target account must be IG/FB. */
  async createCommentAutomation(platform: string, body: CommentAutomationBody): Promise<unknown> {
    assertFunnelSupported(platform);
    return this.request('POST', '/v1/comment-automations', { body });
  }

  async listCommentAutomations(profileId?: string): Promise<unknown> {
    return this.request('GET', '/v1/comment-automations', { query: { profileId } });
  }

  async getCommentAutomation(automationId: string): Promise<unknown> {
    return this.request('GET', `/v1/comment-automations/${automationId}`);
  }

  async updateCommentAutomation(automationId: string, body: Partial<CommentAutomationBody> & { isActive?: boolean }): Promise<unknown> {
    return this.request('PATCH', `/v1/comment-automations/${automationId}`, { body });
  }

  async deleteCommentAutomation(automationId: string): Promise<unknown> {
    return this.request('DELETE', `/v1/comment-automations/${automationId}`);
  }

  async commentAutomationLogs(automationId: string, query: Query = {}): Promise<unknown> {
    return this.request('GET', `/v1/comment-automations/${automationId}/logs`, { query });
  }

  // ---- Webhooks ----

  async listWebhooks(): Promise<{ webhooks: WebhookConfig[] }> {
    return this.request('GET', '/v1/webhooks/settings');
  }

  async createWebhook(body: WebhookConfig): Promise<unknown> {
    return this.request('POST', '/v1/webhooks/settings', { body });
  }

  async updateWebhook(body: WebhookConfig & { _id: string }): Promise<unknown> {
    return this.request('PUT', '/v1/webhooks/settings', { body });
  }

  async deleteWebhook(webhookId: string): Promise<unknown> {
    // Delete takes the id as a query param, per the live docs.
    return this.request('DELETE', '/v1/webhooks/settings', { query: { id: webhookId } });
  }

  async testWebhook(webhookId: string): Promise<unknown> {
    return this.request('POST', '/v1/webhooks/test', { body: { webhookId } });
  }

  async webhookLogs(query: Query = {}): Promise<unknown> {
    return this.request('GET', '/v1/webhooks/logs', { query });
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
  '.avi': 'video/avi',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
  '.mpeg': 'video/mpeg',
  '.pdf': 'application/pdf',
};

export function guessContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const type = CONTENT_TYPES[ext];
  if (!type) {
    throw new Error(
      `Unsupported media type "${ext}". Supported: ${Object.keys(CONTENT_TYPES).join(', ')}`,
    );
  }
  return type;
}
