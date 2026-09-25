/**
 * Social Agents' tool belt, engine-agnostic. One registry drives both brains: the
 * Claude Agent SDK (via MCP in tools.ts) and any OpenAI-compatible API
 * (via the function-calling loop in apiLoop.ts). The allowlist, hard
 * blocks, and platform matrix are enforced inside CreatorOSClient, so a
 * blocked call returns a plain refusal no matter which engine asked.
 */
import { z } from 'zod';
import type { CreatorOSClient } from '../client/client.js';
import type { CreatePostBody, PostTarget } from '../client/types.js';
import { normalizePlatform } from '../client/platformMatrix.js';
import {
  createAutomation,
  deleteAutomation,
  STARTER_CRONS,
  verifyAutomations,
  type StarterCron,
} from '../automations/crons.js';
import { buildFunnelAutomation } from '../automations/funnels.js';
import type { SocialAgentsConfig } from '../config/socialAgentsConfig.js';

export interface ToolOutcome {
  text: string;
  isError?: boolean;
}

export interface AgentTool {
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

const OPAQUE_IDS =
  'IDs are opaque prefixed strings (acc_, post_, cmt_, conv_, msg_, auto_, med_): pass them back exactly as received, never shorten or build them.';

const postTarget = z.object({
  platform: z.string().describe('instagram, tiktok, youtube, twitter, threads, facebook, or linkedin'),
  account_id: z.string().describe('acc_ id from social-agents/PROFILES.md or list_accounts'),
  options: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Per-network settings: YouTube title/visibility/madeForKids/playlistId, IG collaborators/shareToFeed/firstComment, X or Threads threadItems, LinkedIn documentTitle, FB contentType... (see https://www.creatoros.ca/docs/post-options)',
    ),
  content: z.string().optional().describe('Caption override for this target'),
});

/** Network names → one advanced-form target per network, from the connected accounts. */
export async function draftTargets(client: CreatorOSClient, networks: string[]): Promise<PostTarget[]> {
  const { accounts } = await client.listAccounts();
  return networks.map((network) => {
    const platform = normalizePlatform(network);
    const matches = accounts.filter((account) => account.platform === platform);
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `No connected ${platform} account. Connect it first (connect_account_link) or drop it from platforms.`
          : `Several ${platform} accounts are connected; pass targets with the account_id you mean.`,
      );
    }
    return { platform, account_id: matches[0]!.id };
  });
}

export function buildToolRegistry(
  client: CreatorOSClient,
  workspaceRoot: string,
  config: SocialAgentsConfig | null,
): AgentTool[] {
  const t = (
    name: string,
    description: string,
    shape: z.ZodRawShape,
    handler: (args: Record<string, unknown>) => Promise<ToolOutcome>,
  ): AgentTool => ({ name, description, shape, handler });

  return [
    // ---- Workspace & accounts ----
    t('get_workspace', 'The CreatorOS workspace this API key is pinned to (one key = one workspace = one set of connected socials).', {}, () =>
      run(() => client.getMe()),
    ),
    t('list_accounts', `List connected social accounts (id, platform, username). ${OPAQUE_IDS}`, {}, () =>
      run(() => client.listAccounts()),
    ),
    t(
      'account_health',
      'Health of all connected accounts, or one account when accountId is given: token validity, canPost, needsReconnect. An account that needs a reconnect gets a fresh link from connect_account_link.',
      { accountId: z.string().optional() },
      (a) => run(() => (a.accountId ? client.accountHealth(a.accountId as string) : client.accountsHealth())),
    ),
    t(
      'connect_account_link',
      'Get a link the human opens to connect (or reconnect) a social account to the workspace. Hand them the auth_url; you cannot complete the login yourself.',
      { platform: z.enum(['instagram', 'tiktok', 'youtube', 'twitter', 'threads', 'facebook', 'linkedin']) },
      (a) => run(() => client.connectLink(a.platform as string)),
    ),
    t(
      'tiktok_creator_info',
      'TikTok posting constraints for an account: privacy levels, limits, interaction settings. Check before TikTok posts.',
      { accountId: z.string(), mediaType: z.enum(['video', 'photo']).optional() },
      (a) => run(() => client.tiktokCreatorInfo(a.accountId as string, (a.mediaType as 'video' | 'photo') ?? 'video')),
    ),

    // ---- Media ----
    t(
      'upload_media',
      'Upload a local image or video to CreatorOS. Returns { id: "med_...", url }: pass the id in create_post media (or cover). Upload once, reuse across networks. HEIC/HEIF/AVIF are rejected: convert to JPG first.',
      { filePath: z.string().describe('Absolute or workspace-relative path') },
      (a) => run(() => client.uploadMediaFromFile(a.filePath as string)),
    ),

    // ---- Posting ----
    t(
      'create_post',
      'Create one post across many networks. Simple form (preferred): platforms = network names; CreatorOS picks the connected account per network and applies each network\'s rules (Reels, Shorts, TikTok consent, YouTube titles). Advanced form: targets = [{platform, account_id, options}] for per-account settings. Timing: schedule_at (+ timezone) schedules; draft: true saves a draft; NEITHER = PUBLISHES IMMEDIATELY, so only omit both when the human asked to post now. Queue: queuedFromProfile: true (advanced form) drops it into the next open queue slot; never compute slots yourself. Video cover: cover = a med_ JPG/PNG, or cover_timestamp_ms for a frame (Instagram/TikTok). Verify with get_post afterwards.',
      {
        content: z.string().optional().describe('Caption / body text'),
        platforms: z.array(z.string()).optional().describe('Simple form: e.g. ["instagram","tiktok","youtube"]'),
        targets: z.array(postTarget).optional().describe('Advanced form, instead of platforms'),
        media: z.array(z.string()).optional().describe('med_ ids from upload_media (or public URLs). One video or up to 10 images'),
        post_type: z.enum(['text', 'image', 'carousel', 'short_video', 'long_video', 'story']).optional().describe('Inferred from media when omitted'),
        title: z.string().optional().describe('YouTube title (≤100 chars)'),
        schedule_at: z.string().optional().describe('ISO 8601 in the future: local wall-clock time plus timezone, or UTC ending in Z'),
        timezone: z.string().optional().describe('IANA name; defaults to the configured timezone'),
        draft: z.boolean().optional(),
        hashtags: z.array(z.string()).optional(),
        cover: z.string().optional().describe('Video cover: med_ id of an uploaded JPG/PNG (≤2 MB, 1080x1920 for vertical). Applies on Instagram, TikTok, Facebook, LinkedIn, YouTube long videos'),
        cover_timestamp_ms: z.number().int().optional().describe('Instagram/TikTok: use the frame at this ms as the cover. Ignored when cover is set'),
        tiktok: z.record(z.string(), z.unknown()).optional().describe('TikTok settings for every TikTok target: privacy_level, allow_comment, allow_duet, allow_stitch...'),
        queuedFromProfile: z.boolean().optional().describe('Advanced form: true = next open queue slot'),
        tags: z.array(z.string()).optional().describe('YouTube tags (advanced form)'),
      },
      ({ platforms, targets, ...rest }) =>
        run(async () => {
          if (!platforms === !targets) throw new Error('Pass exactly one of platforms (simple form) or targets (advanced form).');
          let resolved = (platforms as string[] | undefined) ?? (targets as PostTarget[]);
          // A simple-form DRAFT is saved with no targets (seen live), so
          // publishing it later would go nowhere. Pin drafts to accounts here.
          if (rest.draft === true && platforms) resolved = await draftTargets(client, platforms as string[]);
          const body: CreatePostBody = {
            ...(rest as Omit<CreatePostBody, 'platforms'>),
            platforms: resolved,
            timezone: (rest.timezone as string) ?? config?.timezone ?? 'UTC',
          };
          return client.createPost(body);
        }),
    ),
    t('get_post', `Fetch a post by id: per-network status, URLs, errors. Use to verify every publish. ${OPAQUE_IDS}`, { postId: z.string() }, (a) =>
      run(() => client.getPost(a.postId as string)),
    ),
    t(
      'list_posts',
      'List posts with filters (page-based: pagination.pages).',
      {
        status: z.enum(['draft', 'scheduled', 'published', 'failed', 'cancelled']).optional(),
        platform: z.string().optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().optional(),
        page: z.number().optional(),
      },
      (query) => run(() => client.listPosts(query as Record<string, string | number | undefined>)),
    ),
    t('retry_post', 'Retry the failed networks of a failed/partial post.', { postId: z.string() }, (a) =>
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
      'Edit a draft or scheduled post: caption (content) and/or time (scheduledFor + timezone). Media and cover cannot be changed here: delete the post and create it again. Verify with get_post afterwards.',
      {
        postId: z.string(),
        content: z.string().optional(),
        scheduledFor: z.string().optional().describe('ISO 8601'),
        timezone: z.string().optional(),
      },
      ({ postId, ...body }) => run(() => client.updatePost(postId as string, body)),
    ),
    t(
      'unpublish_post',
      'Take a published post down from ONE network (facebook, twitter, threads, linkedin, youtube; not Instagram or TikTok). DESTRUCTIVE — confirm with the human first.',
      { postId: z.string(), platform: z.enum(['facebook', 'twitter', 'threads', 'linkedin', 'youtube']) },
      (a) => run(() => client.unpublishPost(a.postId as string, a.platform as string)),
    ),
    t(
      'edit_published_post',
      'Edit the text of an already-published post on twitter, facebook, linkedin, or youtube. Confirm the new text with the human first.',
      {
        postId: z.string(),
        platform: z.enum(['twitter', 'facebook', 'linkedin', 'youtube']),
        content: z.string(),
        accountId: z.string().optional(),
      },
      ({ postId, ...body }) =>
        run(() => client.editPublishedPost(postId as string, body as { platform: string; content: string; accountId?: string })),
    ),
    t(
      'update_youtube_metadata',
      'Update title/description/tags of a published YouTube video.',
      {
        postId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
      ({ postId, ...body }) => run(() => client.updateYouTubeMetadata(postId as string, body)),
    ),

    // ---- Validation ----
    t(
      'validate_post',
      'Dry-run pre-publish validation (lengths, media rules, network requirements) without creating anything.',
      {
        platforms: z.array(z.record(z.string(), z.unknown())).describe('[{platform, accountId}]'),
        content: z.string().optional(),
        mediaItems: z.array(z.object({ type: z.string(), url: z.string() })).optional(),
      },
      (body) => run(() => client.validatePost(body)),
    ),
    t('validate_post_length', 'Character counts vs every network limit.', { text: z.string() }, (a) =>
      run(() => client.validatePostLength(a.text as string)),
    ),
    t('validate_media', 'Check a media URL is reachable and a supported type.', { url: z.string() }, (a) =>
      run(() => client.validateMedia(a.url as string)),
    ),

    // ---- Analytics ----
    t(
      'post_analytics',
      'Per-post performance (impressions, reach, views, likes, comments, shares, saves, engagementRate) per network. fromDate defaults to 90 days ago.',
      {
        platform: z.string().optional(),
        accountId: z.string().optional(),
        fromDate: z.string().optional().describe('YYYY-MM-DD'),
        toDate: z.string().optional(),
        sortBy: z.string().optional(),
        order: z.enum(['asc', 'desc']).optional(),
        limit: z.number().optional(),
        page: z.number().optional(),
      },
      (query) => run(() => client.postAnalytics(query as Record<string, string | number | undefined>)),
    ),
    t(
      'post_timeline',
      'Day-by-day metrics for one post (post_ id).',
      { postId: z.string(), fromDate: z.string().optional(), toDate: z.string().optional() },
      (query) => run(() => client.postTimeline(query as Record<string, string | undefined>)),
    ),
    t(
      'follower_stats',
      'Follower counts and growth per account over a date range (defaults to the last 30 days).',
      {
        accountIds: z.string().optional().describe('Comma-separated acc_ ids'),
        fromDate: z.string().optional().describe('YYYY-MM-DD'),
        toDate: z.string().optional(),
        granularity: z.enum(['daily', 'weekly', 'monthly']).optional(),
      },
      (query) => run(() => client.followerStats(query as Record<string, string | undefined>)),
    ),
    t(
      'best_time_to_post',
      'Best-performing day/hour slots (hours are UTC; day_of_week 0=Monday).',
      { platform: z.string().optional(), accountId: z.string().optional() },
      (query) => run(() => client.bestTimeToPost(query as Record<string, string | undefined>)),
    ),
    t(
      'daily_metrics',
      'Daily aggregated metrics + per-network breakdown.',
      { fromDate: z.string().optional(), toDate: z.string().optional(), platform: z.string().optional() },
      (query) => run(() => client.dailyMetrics(query as Record<string, string | undefined>)),
    ),

    // ---- Comments ----
    t(
      'list_comments',
      'Posts with recent comment activity across accounts. Cursor-paged: pass pagination.nextCursor as cursor while pagination.hasMore.',
      {
        since: z.string().optional().describe('ISO 8601'),
        platform: z.string().optional(),
        accountId: z.string().optional(),
        minComments: z.number().optional(),
        limit: z.number().optional(),
        cursor: z.string().optional(),
      },
      (query) => run(() => client.listComments(query as Record<string, string | number | undefined>)),
    ),
    t(
      'get_post_comments',
      `Comments on one post. ${OPAQUE_IDS}`,
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
      'Like a comment (positive but content-free comments get a like, not a reply). Facebook and Twitter/X only.',
      {
        platform: z.string(),
        postId: z.string(),
        commentId: z.string(),
        accountId: z.string(),
      },
      (args) => run(() => client.likeComment(args as { platform: string; postId: string; commentId: string; accountId: string })),
    ),
    t(
      'delete_comment',
      'Delete a comment from a post (Facebook, Instagram, YouTube, LinkedIn). DESTRUCTIVE and irreversible — prefer hide_comment where available; delete only obvious spam/scams, or on explicit human instruction.',
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
      'List DM conversations across accounts, newest first. Cursor-paged like list_comments.',
      {
        platform: z.string().optional(),
        accountId: z.string().optional(),
        status: z.enum(['active', 'archived']).optional(),
        limit: z.number().optional(),
        cursor: z.string().optional(),
      },
      (query) => run(() => client.listConversations(query as Record<string, string | number | undefined>)),
    ),
    t(
      'get_conversation_messages',
      'Messages in one conversation. Messages this account sent are marked YOUR OWN MESSAGE — a conversation whose latest message is your own needs no reply.',
      {
        conversationId: z.string(),
        accountId: z.string(),
        limit: z.number().optional().describe('Up to 100'),
        cursor: z.string().optional(),
        sortOrder: z.enum(['asc', 'desc']).optional(),
      },
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
      'Create a comments-to-DM funnel (keyword comment → automatic DM). Runs on CreatorOS servers. Instagram/Facebook only. ALWAYS confirm the exact keyword(s) and DM copy with the human before calling this.',
      {
        platform: z.string(),
        accountId: z.string().describe('acc_ id of the Instagram/Facebook account'),
        name: z.string(),
        keywords: z.array(z.string()).describe('Empty = any comment triggers'),
        matchMode: z.enum(['contains', 'word', 'exact']).optional(),
        dmMessage: z.string(),
        link: z.string().optional().describe('Product link from BRAND.md, appended to the DM text'),
        commentReply: z.string().optional().describe('Optional public reply to the triggering comment'),
        platformPostId: z.string().optional().describe("The network's own post id to scope to one post; omit for account-wide"),
      },
      (spec) =>
        run(() =>
          client.createCommentAutomation(
            spec.platform as string,
            buildFunnelAutomation(spec as unknown as Parameters<typeof buildFunnelAutomation>[0]),
          ),
        ),
    ),
    t('list_funnels', 'List comment-to-DM funnels.', {}, () => run(() => client.listCommentAutomations())),
    t(
      'update_funnel',
      'Change a funnel\'s keywords, DM copy, or public comment reply. Confirm copy changes with the human.',
      {
        automationId: z.string(),
        keywords: z.array(z.string()).optional(),
        dmMessage: z.string().optional(),
        commentReply: z.string().optional(),
      },
      ({ automationId, ...body }) =>
        run(() => client.updateCommentAutomation(automationId as string, body as Parameters<CreatorOSClient['updateCommentAutomation']>[1])),
    ),
    t(
      'delete_funnel',
      'Delete a funnel permanently. DESTRUCTIVE — confirm with the human first. (This is also how a funnel is stopped.)',
      { automationId: z.string() },
      (a) => run(() => client.deleteCommentAutomation(a.automationId as string)),
    ),
    t(
      'funnel_logs',
      'Recent runs of a funnel: who commented, what they said, whether the DM went out.',
      { automationId: z.string() },
      (a) => run(() => client.commentAutomationLogs(a.automationId as string)),
    ),

    // ---- Webhooks ----
    t('list_webhooks', 'List webhook endpoints and the events available to subscribe to.', {}, () => run(() => client.listWebhooks())),
    t(
      'create_webhook',
      'Register an HTTPS endpoint for CreatorOS events (comment.received, message.received, post.published, post.failed...). The response includes the signing secret (whsec_...) ONCE: tell the human to store it now, it is never shown again.',
      {
        url: z.string().describe('HTTPS URL'),
        events: z.array(z.string()).optional().describe('Empty = every event'),
        description: z.string().optional(),
      },
      (body) => run(() => client.createWebhook(body as { url: string; events?: string[]; description?: string })),
    ),
    t('delete_webhook', 'Remove a webhook endpoint. Confirm with the human first.', { webhookId: z.string() }, (a) =>
      run(() => client.deleteWebhook(a.webhookId as string)),
    ),
    t('test_webhook', 'Send a webhook.test event to an endpoint.', { webhookId: z.string() }, (a) =>
      run(() => client.testWebhook(a.webhookId as string)),
    ),

    // ---- Scheduled agent automations (crons) ----
    t(
      'create_cron_automation',
      `Create a scheduled agent run (cron) on the configured pathway (${config?.automationTarget ?? 'local'}). Starter crons: ${STARTER_CRONS.map((c) => c.name).join(', ')}.`,
      {
        name: z.string().describe('lowercase-with-hyphens'),
        schedule: z.string().describe('Strict 5-field cron, e.g. "0 9 * * *"'),
        skill: z.string().describe('A skill in social-agents/skills/, e.g. respond-to-comments'),
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
