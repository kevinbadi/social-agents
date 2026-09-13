/**
 * Midas's tool belt, engine-agnostic. One registry drives both brains: the
 * Claude Agent SDK (via MCP in tools.ts) and any OpenAI-compatible API
 * (via the function-calling loop in apiLoop.ts). The allowlist, hard
 * blocks, and platform matrix are enforced inside CreatorOSClient, so a
 * blocked call returns a plain refusal no matter which engine asked.
 */
import { z } from 'zod';
import type { CreatorOSClient } from '../client/client.js';
import type { CreatePostBody } from '../client/types.js';
import {
  createAutomation,
  deleteAutomation,
  STARTER_CRONS,
  verifyAutomations,
  type StarterCron,
} from '../automations/crons.js';
import { buildFunnelAutomation } from '../automations/funnels.js';
import type { MidasConfig } from '../config/midasConfig.js';

export interface ToolOutcome {
  text: string;
  isError?: boolean;
}

export interface MidasTool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<ToolOutcome>;
}

function outcome(data: unknown): ToolOutcome {
  return { text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) };
}

function run(fn: () => Promise<unknown>): Promise<ToolOutcome> {
  return fn().then(outcome, (error) => ({ text: `Error: ${(error as Error).message}`, isError: true }));
}

const platformTarget = z.object({
  platform: z.string().describe('Platform, e.g. tiktok, instagram, youtube, twitter, threads'),
  accountId: z.string().describe('Account ID from midas/PROFILES.md'),
  customContent: z.string().optional(),
  scheduledFor: z.string().optional().describe('Per-platform override, absolute ISO 8601'),
  platformSpecificData: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Per-platform options: threadItems (X/Threads), YouTube title/visibility, TikTok privacyLevel + consent flags, IG contentType, FB carouselCards, Reddit subreddit/title…',
    ),
});

const mediaItem = z.object({
  type: z.enum(['image', 'video', 'gif', 'document']),
  url: z.string().describe('Public HTTPS URL — use upload_media for local files'),
  thumbnail: z.string().optional(),
  title: z.string().optional(),
});

export function buildToolRegistry(
  client: CreatorOSClient,
  workspaceRoot: string,
  config: MidasConfig | null,
): MidasTool[] {
  const t = (
    name: string,
    description: string,
    shape: z.ZodRawShape,
    handler: (args: Record<string, unknown>) => Promise<ToolOutcome>,
  ): MidasTool => ({ name, description, shape, handler });

  return [
    // ---- Accounts & profiles ----
    t('list_accounts', 'List connected social accounts (platform, handle, id, followers).', {}, () =>
      run(() => client.listAccounts()),
    ),
    t(
      'account_health',
      'Health of all connected accounts, or one account when accountId is given.',
      { accountId: z.string().optional() },
      (a) => run(() => (a.accountId ? client.accountHealth(a.accountId as string) : client.accountsHealth())),
    ),
    t('list_profiles', 'List CreatorOS profiles (read-only).', {}, () => run(() => client.listProfiles())),
    t(
      'tiktok_creator_info',
      'TikTok posting constraints for an account: privacy levels, limits, commercial content options. Required before TikTok posts.',
      { accountId: z.string(), mediaType: z.enum(['video', 'photo']).optional() },
      (a) => run(() => client.tiktokCreatorInfo(a.accountId as string, (a.mediaType as 'video' | 'photo') ?? 'video')),
    ),

    // ---- Media ----
    t(
      'upload_media',
      'Upload a local media file to CreatorOS storage. Returns a MediaItem ({type, url}) to pass to create_post. Upload once, reuse across platforms.',
      { filePath: z.string().describe('Absolute or workspace-relative path') },
      (a) => run(() => client.uploadMediaFromFile(a.filePath as string)),
    ),

    // ---- Posting ----
    t(
      'create_post',
      'Create a post across one or many accounts (multiposting = several platform entries in one call). Supports shortform/longform video, carousels, text posts, native threads (threadItems). Scheduling schema, exactly one mode per call: (1) scheduledFor + timezone = exact time, CreatorOS servers publish; (2) queuedFromProfile (+ optional queueId) = auto-assigned to the profile\'s next queue slot; (3) publishNow = immediate. NONE of the three → the post saves as a DRAFT automatically. Per-platform scheduledFor entries override the root time. Verify with get_post afterwards.',
      {
        content: z.string().optional().describe('Caption / body text'),
        title: z.string().optional().describe('YouTube title (≤100 chars)'),
        platforms: z.array(platformTarget).min(1),
        mediaItems: z.array(mediaItem).optional(),
        scheduledFor: z.string().optional().describe('ISO 8601; naive = wall-clock in timezone'),
        timezone: z.string().optional().describe('IANA name; defaults to the configured timezone'),
        publishNow: z.boolean().optional(),
        isDraft: z.boolean().optional(),
        queuedFromProfile: z.string().optional().describe('Profile id — queue mode: server assigns the next available slot; never compute the slot yourself'),
        queueId: z.string().optional().describe('Specific queue under queuedFromProfile'),
        tags: z.array(z.string()).optional().describe('YouTube tags'),
        hashtags: z.array(z.string()).optional(),
      },
      (args) =>
        run(() =>
          client.createPost({
            ...args,
            timezone: (args.timezone as string) ?? config?.timezone ?? 'UTC',
          } as CreatePostBody),
        ),
    ),
    t('get_post', 'Fetch a post by ID — per-platform status, URLs, errors. Use to verify every publish.', { postId: z.string() }, (a) =>
      run(() => client.getPost(a.postId as string)),
    ),
    t(
      'list_posts',
      'List posts with filters.',
      {
        status: z.enum(['draft', 'scheduled', 'published', 'failed']).optional(),
        platform: z.string().optional(),
        limit: z.number().optional(),
        page: z.number().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      },
      (query) => run(() => client.listPosts(query as Record<string, string | number | undefined>)),
    ),
    t('retry_post', 'Retry the failed platforms of a failed/partial post.', { postId: z.string() }, (a) =>
      run(() => client.retryPost(a.postId as string)),
    ),
    t(
      'delete_post',
      'Delete a draft or scheduled post. DESTRUCTIVE — confirm with the human first.',
      { postId: z.string() },
      (a) => run(() => client.deletePost(a.postId as string)),
    ),
    t(
      'update_post',
      'Update a draft or scheduled post: content, per-platform customContent, mediaItems, scheduledFor/timezone, or publishNow. ALWAYS pass the full mediaItems again (including the cover thumbnail) — the update replaces them, and a missing thumbnail drops the Instagram cover. Verify with get_post afterwards.',
      {
        postId: z.string(),
        content: z.string().optional(),
        title: z.string().optional(),
        platforms: z.array(platformTarget).optional(),
        mediaItems: z.array(mediaItem).optional(),
        scheduledFor: z.string().optional(),
        timezone: z.string().optional(),
        publishNow: z.boolean().optional(),
        hashtags: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
      },
      ({ postId, ...body }) => run(() => client.updatePost(postId as string, body as Partial<CreatePostBody>)),
    ),
    t(
      'update_youtube_metadata',
      'Update title/description/tags/visibility of a published YouTube video.',
      {
        postId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        privacyStatus: z.enum(['public', 'private', 'unlisted']).optional(),
      },
      ({ postId, ...body }) => run(() => client.updateYouTubeMetadata(postId as string, body)),
    ),

    // ---- Validation ----
    t(
      'validate_post',
      'Dry-run full pre-publish validation (lengths, media rules, platform requirements) without creating anything.',
      { body: z.record(z.string(), z.unknown()).describe('Same shape as create_post') },
      (a) => run(() => client.validatePost(a.body as CreatePostBody)),
    ),
    t('validate_post_length', 'Weighted character counts vs every platform limit.', { text: z.string() }, (a) =>
      run(() => client.validatePostLength(a.text as string)),
    ),
    t('validate_media', 'Check a media URL against per-platform size/format limits.', { url: z.string() }, (a) =>
      run(() => client.validateMedia(a.url as string)),
    ),

    // ---- Analytics ----
    t(
      'get_analytics',
      'Post analytics. With postId: one post (per-platform breakdown). Without: paginated overview.',
      {
        postId: z.string().optional(),
        platform: z.string().optional(),
        accountId: z.string().optional(),
        fromDate: z.string().optional().describe('YYYY-MM-DD'),
        toDate: z.string().optional(),
        sortBy: z.string().optional(),
        limit: z.number().optional(),
      },
      (query) => run(() => client.getAnalytics(query as Record<string, string | number | undefined>)),
    ),
    t(
      'follower_stats',
      'Follower growth per account over a date range.',
      {
        accountIds: z.string().optional().describe('Comma-separated'),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        granularity: z.enum(['daily', 'weekly', 'monthly']).optional(),
      },
      (query) => run(() => client.followerStats(query as Record<string, string | undefined>)),
    ),
    t(
      'best_time_to_post',
      'Best-performing day/hour slots (hours are UTC; day 0=Monday).',
      { platform: z.string().optional(), accountId: z.string().optional() },
      (query) => run(() => client.bestTimeToPost(query as Record<string, string | undefined>)),
    ),
    t(
      'daily_metrics',
      'Daily aggregated metrics + per-platform breakdown.',
      { fromDate: z.string().optional(), toDate: z.string().optional(), platform: z.string().optional() },
      (query) => run(() => client.dailyMetrics(query as Record<string, string | undefined>)),
    ),

    // ---- Comments ----
    t(
      'list_comments',
      'Posts with recent comment activity across accounts.',
      {
        since: z.string().optional().describe('ISO 8601'),
        platform: z.string().optional(),
        accountId: z.string().optional(),
        limit: z.number().optional(),
        cursor: z.string().optional(),
      },
      (query) => run(() => client.listComments(query as Record<string, string | number | undefined>)),
    ),
    t(
      'get_post_comments',
      'Comments on one post.',
      { postId: z.string(), accountId: z.string(), limit: z.number().optional(), cursor: z.string().optional() },
      ({ postId, ...query }) => run(() => client.getPostComments(postId as string, query as Record<string, string | number | undefined>)),
    ),
    t(
      'reply_to_comment',
      'Reply to a comment (or the post itself when commentId omitted). Platform matrix enforced — TikTok is not supported. Comments marked as YOUR OWN are never reply targets — replying to them is blocked in code.',
      {
        platform: z.string(),
        postId: z.string(),
        accountId: z.string(),
        message: z.string(),
        commentId: z.string().optional(),
      },
      (args) => run(() => client.replyToComment(args as { platform: string; postId: string; accountId: string; message: string; commentId?: string })),
    ),
    t(
      'like_comment',
      'Like/upvote a comment (positive but content-free comments get a like, not a reply). Facebook, Twitter/X, Bluesky, Reddit only; Bluesky also needs the comment cid from get_post_comments.',
      {
        platform: z.string(),
        postId: z.string(),
        commentId: z.string(),
        accountId: z.string(),
        cid: z.string().optional().describe('Bluesky only — the comment content identifier, required there'),
      },
      (args) => run(() => client.likeComment(args as { platform: string; postId: string; commentId: string; accountId: string; cid?: string })),
    ),
    t(
      'delete_comment',
      'Delete a comment from a post (Facebook, Instagram, Bluesky, Reddit, YouTube, LinkedIn). DESTRUCTIVE and irreversible — prefer hide_comment where available; delete only obvious spam/scams, or on explicit human instruction.',
      { platform: z.string(), postId: z.string(), commentId: z.string(), accountId: z.string() },
      (args) => run(() => client.deleteComment(args as { platform: string; postId: string; commentId: string; accountId: string })),
    ),
    t(
      'hide_comment',
      'Hide a comment so only the commenter and page admin see it (Facebook, Instagram, Threads, Twitter/X). Use for spam/abuse worth suppressing but not worth engaging; on X only replies to the account’s own conversations can be hidden.',
      { platform: z.string(), postId: z.string(), commentId: z.string(), accountId: z.string() },
      (args) => run(() => client.hideComment(args as { platform: string; postId: string; commentId: string; accountId: string })),
    ),
    t(
      'private_reply_to_comment',
      'Send a DM to a commenter (Instagram/Facebook only, one per comment, 7-day window). Confirm copy with the human first.',
      {
        platform: z.string(),
        postId: z.string(),
        commentId: z.string(),
        accountId: z.string(),
        message: z.string(),
      },
      (args) => run(() => client.privateReplyToComment(args as { platform: string; postId: string; commentId: string; accountId: string; message: string })),
    ),

    // ---- Messages / DMs ----
    t(
      'list_conversations',
      'List DM conversations across accounts.',
      {
        platform: z.string().optional(),
        accountId: z.string().optional(),
        limit: z.number().optional(),
        cursor: z.string().optional(),
      },
      (query) => run(() => client.listConversations(query as Record<string, string | number | undefined>)),
    ),
    t(
      'get_conversation_messages',
      'Messages in one conversation. Messages this account sent are marked YOUR OWN MESSAGE — a conversation whose latest message is your own needs no reply.',
      { conversationId: z.string(), accountId: z.string(), limit: z.number().optional() },
      ({ conversationId, ...query }) =>
        run(() => client.getConversationMessages(conversationId as string, query as Record<string, string | number | undefined>)),
    ),
    t(
      'send_message',
      'Reply in an existing DM conversation. Platform matrix enforced. Escalate refunds/complaints/legal to the human instead. Blocked in code when the latest message is your own (that would be answering yourself) — allowFollowUp only for a follow-up the human explicitly requested.',
      {
        platform: z.string(),
        conversationId: z.string(),
        accountId: z.string(),
        message: z.string(),
        allowFollowUp: z.boolean().optional().describe('Only when the human explicitly asked for a follow-up to your own last message'),
      },
      (args) => run(() => client.sendMessage(args as { platform: string; conversationId: string; accountId: string; message: string; allowFollowUp?: boolean })),
    ),

    // ---- Comment-to-DM funnels ----
    t(
      'create_funnel',
      'Create a comments-to-DM funnel (keyword comment → automatic DM with link). Instagram/Facebook only. ALWAYS confirm the exact keyword(s) and DM copy with the human before calling this.',
      {
        platform: z.string(),
        profileId: z.string(),
        accountId: z.string(),
        name: z.string(),
        keywords: z.array(z.string()),
        dmMessage: z.string(),
        link: z.string().optional().describe('Product link from BRAND.md — attached as tracked button'),
        commentReply: z.string().optional(),
        platformPostId: z.string().optional().describe('Scope to one post; omit for account-wide'),
        postId: z.string().optional(),
        trigger: z.enum(['comment', 'story_reply']).optional(),
      },
      (spec) =>
        run(() =>
          client.createCommentAutomation(
            spec.platform as string,
            buildFunnelAutomation(spec as unknown as Parameters<typeof buildFunnelAutomation>[0]),
          ),
        ),
    ),
    t('list_funnels', 'List comment-to-DM funnels with stats (triggers, DMs sent, clicks).', {}, () =>
      run(() => client.listCommentAutomations()),
    ),
    t(
      'update_funnel',
      'Update or pause a funnel (isActive=false pauses). Confirm copy changes with the human.',
      {
        automationId: z.string(),
        keywords: z.array(z.string()).optional(),
        dmMessage: z.string().optional(),
        isActive: z.boolean().optional(),
      },
      ({ automationId, ...body }) => run(() => client.updateCommentAutomation(automationId as string, body)),
    ),
    t(
      'delete_funnel',
      'Delete a funnel permanently (logs included). DESTRUCTIVE — confirm with the human first.',
      { automationId: z.string() },
      (a) => run(() => client.deleteCommentAutomation(a.automationId as string)),
    ),
    t(
      'funnel_logs',
      'Trigger logs for a funnel: who commented, what they said, whether the DM sent. Paginated; filter by status to find failures.',
      {
        automationId: z.string(),
        status: z.enum(['sent', 'failed', 'skipped']).optional(),
        limit: z.number().optional().describe('Default 50'),
        skip: z.number().optional(),
      },
      ({ automationId, ...query }) =>
        run(() => client.commentAutomationLogs(automationId as string, query as Record<string, string | number | undefined>)),
    ),

    // ---- Webhooks ----
    t('list_webhooks', 'List webhook subscriptions.', {}, () => run(() => client.listWebhooks())),
    t(
      'create_webhook',
      'Subscribe a URL to CreatorOS events (comment.received, message.received, post.published…). Max 10.',
      {
        name: z.string(),
        url: z.string(),
        events: z.array(z.string()),
        secret: z.string().optional().describe('HMAC secret for signature verification'),
      },
      (body) => run(() => client.createWebhook(body as { name: string; url: string; events: string[]; secret?: string })),
    ),
    t('delete_webhook', 'Remove a webhook subscription. Confirm with the human first.', { webhookId: z.string() }, (a) =>
      run(() => client.deleteWebhook(a.webhookId as string)),
    ),
    t('test_webhook', 'Send a test event to a webhook.', { webhookId: z.string() }, (a) =>
      run(() => client.testWebhook(a.webhookId as string)),
    ),

    // ---- Scheduled agent automations (crons) ----
    t(
      'create_cron_automation',
      `Create a scheduled agent run (cron) on the configured pathway (${config?.automationTarget ?? 'local'}). Starter crons: ${STARTER_CRONS.map((c) => c.name).join(', ')}.`,
      {
        name: z.string().describe('lowercase-with-hyphens'),
        schedule: z.string().describe('Strict 5-field cron, e.g. "0 9 * * *"'),
        skill: z.string().describe('A skill in midas/skills/, e.g. respond-to-comments'),
        model: z.string().optional().describe('Model override for this automation — use a small/cheap model for engagement runs'),
      },
      ({ name, schedule, skill, model }) =>
        run(async () => {
          const cron: StarterCron & { model?: string } = {
            name: name as string,
            schedule: schedule as string,
            skill: skill as string,
            pillar: 'content',
            description: '',
            model: model as string | undefined,
          };
          const result = await createAutomation(workspaceRoot, cron, config?.automationTarget ?? 'local');
          if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'automation create failed');
          return result.stdout.trim() || `Automation ${name} created.`;
        }),
    ),
    t('list_cron_automations', 'List scheduled agent automations and verify they are loaded.', {}, () =>
      run(async () => {
        const result = await verifyAutomations(workspaceRoot, config?.automationTarget ?? 'local');
        return result.stdout.trim() || result.stderr.trim() || '(none)';
      }),
    ),
    t(
      'delete_cron_automation',
      'Remove a scheduled agent automation (Railway pathway). Confirm with the human first.',
      { name: z.string() },
      ({ name }) =>
        run(async () => {
          const result = await deleteAutomation(workspaceRoot, name as string, config?.automationTarget ?? 'local');
          if (result.code !== 0) throw new Error(result.stderr.trim() || 'automation delete failed');
          return result.stdout.trim();
        }),
    ),
  ];
}
