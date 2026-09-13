/**
 * Comment-to-DM funnels: someone comments a keyword → they automatically
 * get a DM with a link/offer. Configured through the CreatorOS comment
 * automation endpoints. Instagram and Facebook only.
 *
 * The DM goes out automatically to strangers — Midas always confirms the
 * exact keyword(s) and DM copy with the human before creating one.
 */
import type { CommentAutomationBody, DmButton } from '../client/types.js';
import { assertFunnelSupported } from '../client/platformMatrix.js';

export interface FunnelSpec {
  /** Platform of the target account (must be instagram or facebook). */
  platform: string;
  profileId: string;
  accountId: string;
  name: string;
  keywords: string[];
  matchMode?: 'exact' | 'contains';
  dmMessage: string;
  /** Product/offer link from the brand pack — becomes a tracked URL button. */
  link?: string;
  linkTitle?: string;
  /** Optional public reply to the triggering comment. */
  commentReply?: string;
  /** Scope to one post; omit for account-wide. */
  platformPostId?: string;
  /** CreatorOS post id, required only alongside platformPostId. */
  postId?: string;
  postTitle?: string;
  trigger?: 'comment' | 'story_reply';
}

const DM_LIMIT_WITH_BUTTONS = 640;
const BUTTON_TITLE_LIMIT = 20;

/**
 * Build the create body for a comment automation from a funnel spec.
 * Validates platform support and API limits up front so a bad funnel never
 * reaches the network.
 */
export function buildFunnelAutomation(spec: FunnelSpec): CommentAutomationBody {
  assertFunnelSupported(spec.platform);

  if (!spec.dmMessage.trim()) {
    throw new Error('A funnel needs a DM message — that is the whole point of the funnel.');
  }
  if (spec.keywords.some((keyword) => !keyword.trim())) {
    throw new Error('Funnel keywords must be non-empty.');
  }
  if (spec.platformPostId && !spec.postId) {
    throw new Error('Scoping a funnel to one post needs both platformPostId and postId.');
  }

  const buttons: DmButton[] = [];
  if (spec.link) {
    const title = (spec.linkTitle ?? 'Get the link').slice(0, BUTTON_TITLE_LIMIT);
    buttons.push({ type: 'url', title, url: spec.link });
  }

  if (buttons.length > 0 && spec.dmMessage.length > DM_LIMIT_WITH_BUTTONS) {
    throw new Error(
      `DM message is ${spec.dmMessage.length} chars — the limit is ${DM_LIMIT_WITH_BUTTONS} when a link button is attached. Trim it down.`,
    );
  }

  const body: CommentAutomationBody = {
    profileId: spec.profileId,
    accountId: spec.accountId,
    name: spec.name,
    dmMessage: spec.dmMessage,
    trigger: spec.trigger ?? 'comment',
    keywords: spec.keywords.map((keyword) => keyword.trim()),
    matchMode: spec.matchMode ?? 'contains',
    linkTracking: true,
  };
  if (buttons.length > 0) body.buttons = buttons;
  if (spec.commentReply) body.commentReply = spec.commentReply;
  if (spec.platformPostId) {
    body.platformPostId = spec.platformPostId;
    body.postId = spec.postId;
    body.postTitle = spec.postTitle;
  }
  return body;
}

/** One human-readable line the user confirms before the funnel goes live. */
export function describeFunnel(spec: FunnelSpec): string {
  const scope = spec.platformPostId ? `post ${spec.platformPostId}` : 'any post';
  const keywords = spec.keywords.length > 0 ? spec.keywords.map((k) => `"${k}"`).join(', ') : 'ANY comment';
  const link = spec.link ? ` with link ${spec.link}` : '';
  return `When someone comments ${keywords} on ${scope} (${spec.platform}), they get this DM${link}:\n  "${spec.dmMessage}"`;
}
