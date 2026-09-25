/**
 * Comment-to-DM funnels: someone comments a keyword → they automatically
 * get a DM with a link/offer. Configured through the CreatorOS comment
 * automation endpoints. Instagram and Facebook only.
 *
 * The DM goes out automatically to strangers — Social Agents always confirms the
 * exact keyword(s) and DM copy with the human before creating one.
 */
import type { CommentAutomationBody } from '../client/types.js';
import { assertFunnelSupported } from '../client/platformMatrix.js';

export interface FunnelSpec {
  /** Platform of the target account (must be instagram or facebook). */
  platform: string;
  /** acc_ id of the account the funnel watches. */
  accountId: string;
  name: string;
  keywords: string[];
  matchMode?: 'exact' | 'contains' | 'word';
  dmMessage: string;
  /** Product/offer link from the brand pack, appended to the DM text. */
  link?: string;
  /** Optional public reply to the triggering comment. */
  commentReply?: string;
  /** The network's own post id, to scope to one post; omit for account-wide. */
  platformPostId?: string;
}

/**
 * Build the create body for a comment automation from a funnel spec.
 * Validates platform support up front so a bad funnel never reaches the
 * network.
 */
export function buildFunnelAutomation(spec: FunnelSpec): CommentAutomationBody {
  assertFunnelSupported(spec.platform);

  if (!spec.dmMessage.trim()) {
    throw new Error('A funnel needs a DM message — that is the whole point of the funnel.');
  }
  if (spec.keywords.some((keyword) => !keyword.trim())) {
    throw new Error('Funnel keywords must be non-empty.');
  }

  const dm = spec.dmMessage.trim();
  const body: CommentAutomationBody = {
    accountId: spec.accountId,
    name: spec.name,
    dmMessage: spec.link && !dm.includes(spec.link) ? `${dm}\n\n${spec.link}` : dm,
    keywords: spec.keywords.map((keyword) => keyword.trim()),
    matchMode: spec.matchMode ?? 'contains',
  };
  if (spec.commentReply) body.commentReply = spec.commentReply;
  if (spec.platformPostId) body.platformPostId = spec.platformPostId;
  return body;
}

/** One human-readable line the user confirms before the funnel goes live. */
export function describeFunnel(spec: FunnelSpec): string {
  const scope = spec.platformPostId ? `post ${spec.platformPostId}` : 'any post';
  const keywords = spec.keywords.length > 0 ? spec.keywords.map((k) => `"${k}"`).join(', ') : 'ANY comment';
  const link = spec.link ? ` with link ${spec.link}` : '';
  return `When someone comments ${keywords} on ${scope} (${spec.platform}), they get this DM${link}:\n  "${spec.dmMessage}"`;
}
