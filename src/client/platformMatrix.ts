/**
 * Which platforms support which engagement features, per the live CreatorOS
 * API docs. Enforced in code: an unsupported request gets a friendly
 * "not supported on this platform" — never a raw API error.
 */
/** The networks a CreatorOS workspace can connect. */
export type Platform =
  | 'tiktok'
  | 'instagram'
  | 'facebook'
  | 'youtube'
  | 'linkedin'
  | 'twitter'
  | 'threads';

const ALIASES: Record<string, Platform> = {
  x: 'twitter',
  'twitter/x': 'twitter',
  ig: 'instagram',
  insta: 'instagram',
  fb: 'facebook',
  yt: 'youtube',
  'youtube shorts': 'youtube',
};

export function normalizePlatform(raw: string): Platform {
  const lower = raw.trim().toLowerCase();
  return (ALIASES[lower] ?? lower) as Platform;
}

/** Comment replies (reply to comments on posts). */
export const COMMENT_REPLY_PLATFORMS: readonly Platform[] = [
  'facebook',
  'instagram',
  'twitter',
  'threads',
  'youtube',
  'linkedin',
];

/** Message / DM replies inside existing conversations. */
export const MESSAGE_REPLY_PLATFORMS: readonly Platform[] = [
  'facebook',
  'instagram',
  'twitter',
];

/** Comment-to-DM funnels (comment automations). */
export const FUNNEL_PLATFORMS: readonly Platform[] = ['instagram', 'facebook'];

/** Private reply to a comment (comment → DM, one shot, 7-day window). */
export const PRIVATE_REPLY_PLATFORMS: readonly Platform[] = ['instagram', 'facebook'];

/**
 * Hiding comments (visible only to the commenter and page admin). On
 * Twitter/X the reply must belong to a conversation the account started.
 */
export const COMMENT_HIDE_PLATFORMS: readonly Platform[] = [
  'facebook',
  'instagram',
  'threads',
  'twitter',
];

/** Liking comments. */
export const COMMENT_LIKE_PLATFORMS: readonly Platform[] = ['facebook', 'twitter'];

/** Deleting comments on a post. */
export const COMMENT_DELETE_PLATFORMS: readonly Platform[] = [
  'facebook',
  'instagram',
  'youtube',
  'linkedin',
];

const LABELS: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  twitter: 'Twitter/X',
  threads: 'Threads',
};

export function platformLabel(platform: string): string {
  return LABELS[normalizePlatform(platform)] ?? platform;
}

export class PlatformNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformNotSupportedError';
  }
}

export function supportsCommentReplies(platform: string): boolean {
  return COMMENT_REPLY_PLATFORMS.includes(normalizePlatform(platform));
}

export function supportsMessageReplies(platform: string): boolean {
  return MESSAGE_REPLY_PLATFORMS.includes(normalizePlatform(platform));
}

export function supportsFunnels(platform: string): boolean {
  return FUNNEL_PLATFORMS.includes(normalizePlatform(platform));
}

export function assertCommentReplySupported(platform: string): void {
  if (!supportsCommentReplies(platform)) {
    throw new PlatformNotSupportedError(
      `Comment replies aren't supported on ${platformLabel(platform)} — not supported on this platform.`,
    );
  }
}

export function assertMessageReplySupported(platform: string): void {
  if (!supportsMessageReplies(platform)) {
    throw new PlatformNotSupportedError(
      `Message replies aren't supported on ${platformLabel(platform)} — not supported on this platform.`,
    );
  }
}

export function assertFunnelSupported(platform: string): void {
  if (!supportsFunnels(platform)) {
    throw new PlatformNotSupportedError(
      `Comment-to-DM funnels run on Instagram and Facebook only — not supported on ${platformLabel(platform)}.`,
    );
  }
}

export function supportsCommentHide(platform: string): boolean {
  return COMMENT_HIDE_PLATFORMS.includes(normalizePlatform(platform));
}

export function supportsCommentLike(platform: string): boolean {
  return COMMENT_LIKE_PLATFORMS.includes(normalizePlatform(platform));
}

export function supportsCommentDelete(platform: string): boolean {
  return COMMENT_DELETE_PLATFORMS.includes(normalizePlatform(platform));
}

export function assertCommentLikeSupported(platform: string): void {
  if (!supportsCommentLike(platform)) {
    throw new PlatformNotSupportedError(
      `Liking comments works on Facebook and Twitter/X only — not supported on ${platformLabel(platform)}.`,
    );
  }
}

export function assertCommentDeleteSupported(platform: string): void {
  if (!supportsCommentDelete(platform)) {
    throw new PlatformNotSupportedError(
      `Deleting comments works on Facebook, Instagram, YouTube, and LinkedIn only — not supported on ${platformLabel(platform)}.`,
    );
  }
}

export function assertCommentHideSupported(platform: string): void {
  if (!supportsCommentHide(platform)) {
    throw new PlatformNotSupportedError(
      `Hiding comments works on Facebook, Instagram, Threads, and Twitter/X only — not supported on ${platformLabel(platform)}.`,
    );
  }
}

export function assertPrivateReplySupported(platform: string): void {
  if (!PRIVATE_REPLY_PLATFORMS.includes(normalizePlatform(platform))) {
    throw new PlatformNotSupportedError(
      `Private replies to comments work on Instagram and Facebook only — not supported on ${platformLabel(platform)}.`,
    );
  }
}
