/**
 * Types for the CreatorOS API (/v1), written against https://www.creatoros.ca/docs.
 * IDs are opaque prefixed strings (acc_, post_, cmt_, conv_, msg_, auto_,
 * med_, evt_): pass them back exactly as received, never parse or build them.
 */
import type { Platform } from './platformMatrix.js';

/** GET /v1/me */
export interface Me {
  user: { id: string; handle?: string; email?: string };
  workspace: { id: string; name?: string; ready?: boolean } | null;
  plan?: { active?: boolean; entitlements?: string[] };
  auth?: string;
  [key: string]: unknown;
}

/** POST /v1/media response. */
export interface UploadedMedia {
  /** med_ id: pass it in `media` or `cover` on create_post. */
  id: string;
  url: string;
  type?: string;
  content_type?: string;
  size?: number;
}

/** Advanced-form target: one entry per account. */
export interface PostTarget {
  platform: Platform | string;
  account_id: string;
  /** Per-network settings (YouTube title/visibility, IG collaborators, X threadItems...). */
  options?: Record<string, unknown>;
  /** Per-target caption override. */
  content?: string;
}

export interface CreatePostBody {
  content?: string;
  /** Simple form: network names. Advanced form: PostTarget objects. */
  platforms: Array<string | PostTarget>;
  /** med_ ids or public URLs. One video or up to 10 images. */
  media?: Array<string | { url: string; thumbnail?: string }>;
  post_type?: 'text' | 'image' | 'carousel' | 'short_video' | 'long_video' | 'story';
  title?: string;
  /** ISO 8601, must be in the future. Local time plus `timezone`, or UTC ending in Z. Omit to publish now. */
  schedule_at?: string;
  /** IANA zone, defaults to UTC on the server. */
  timezone?: string;
  draft?: boolean;
  hashtags?: string[];
  /** Video cover: med_ id or public JPG/PNG URL. */
  cover?: string;
  /** Instagram and TikTok: use this frame as the cover. Ignored when `cover` is set. */
  cover_timestamp_ms?: number;
  /** TikTok settings for every TikTok target (privacy_level, consent flags...). */
  tiktok?: Record<string, unknown>;
  /** Advanced form: drop into the next open queue slot. */
  queuedFromProfile?: boolean;
  tags?: string[];
  [key: string]: unknown;
}

export interface UpdatePostBody {
  content?: string;
  scheduledFor?: string;
  timezone?: string;
}

export type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed' | 'partial' | 'cancelled';

export interface Post {
  id: string;
  status: PostStatus;
  content?: string;
  scheduledFor?: string;
  timezone?: string;
  platforms?: Array<{
    platform: Platform;
    accountId: { id: string; platform?: string; username?: string } | string;
    status: string;
    platformPostId?: string;
    platformPostUrl?: string;
    publishedAt?: string;
  }>;
  mediaItems?: Array<{ type: string; url: string }>;
  createdAt?: string;
  [key: string]: unknown;
}

export interface SocialAccount {
  id: string;
  platform: Platform;
  username?: string;
  displayName?: string;
  isActive: boolean;
  [key: string]: unknown;
}

export interface CommentAutomationBody {
  name: string;
  accountId: string;
  /** DM text sent to the commenter. */
  dmMessage: string;
  /** Scope to one post; omit for account-wide. */
  platformPostId?: string;
  /** Empty = any comment triggers. */
  keywords?: string[];
  matchMode?: 'exact' | 'contains' | 'word';
  /** Optional public reply to the triggering comment. */
  commentReply?: string;
}

export interface CreateWebhookBody {
  /** HTTPS endpoint. */
  url: string;
  /** Empty = every event. */
  events?: string[];
  description?: string;
}

/** Every CreatorOS failure: `{ error: { code, message, status } }`. */
export interface ApiErrorBody {
  error: { code: string; message: string; status?: number };
}
