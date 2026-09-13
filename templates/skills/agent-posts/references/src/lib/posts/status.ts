import type { ZernioPost } from "@/lib/zernio/types";

const LIVE = new Set(["published", "posted", "completed", "success"]);

export function isPostLive(p: ZernioPost): boolean {
  const st = (p.status ?? "").toLowerCase();
  if (LIVE.has(st) || p.publishedAt) return true;
  return (p.platforms ?? []).some((pl) => {
    const ps = (pl.status ?? "").toLowerCase();
    return (
      LIVE.has(ps) ||
      Boolean(pl.publishedAt) ||
      Boolean(pl.platformPostId) ||
      Boolean(pl.platformPostUrl)
    );
  });
}

const TERMINAL = new Set(["published", "posted", "completed", "success", "failed", "cancelled"]);

/** True only when every platform target has finished (success or fail). */
export function isPostPublishComplete(p: ZernioPost): boolean {
  const st = (p.status ?? "").toLowerCase();
  if (st === "published" || st === "failed" || st === "cancelled") return true;
  const plats = p.platforms ?? [];
  if (!plats.length) return false;
  return plats.every((pl) => TERMINAL.has((pl.status ?? "").toLowerCase()));
}

export function isPostScheduled(p: ZernioPost): boolean {
  if (isPostLive(p)) return false;
  const st = (p.status ?? "").toLowerCase();
  if (st === "failed" || st === "cancelled" || st === "deleted") return false;
  const when = p.scheduledFor ? new Date(p.scheduledFor).getTime() : NaN;
  if (Number.isFinite(when) && when < Date.now() - 2 * 60 * 1000) return false;
  return st === "scheduled" || Boolean(p.scheduledFor);
}

export function postWhen(p: ZernioPost): string | null {
  const platformPublished = (p.platforms ?? [])
    .map((pl) => pl.publishedAt)
    .filter(Boolean)
    .sort()
    .pop();
  if (isPostLive(p)) {
    return p.publishedAt || platformPublished || p.scheduledFor || p.createdAt;
  }
  return p.scheduledFor || p.createdAt;
}

/** Cover art: generated thumbnail, then a still, then the video file. */
export function postCoverUrl(p: ZernioPost, overlay?: string | null): {
  url: string | null;
  video: boolean;
} {
  if (overlay) return { url: overlay, video: false };
  for (const pl of p.platforms ?? []) {
    const psd = pl.platformSpecificData ?? {};
    for (const key of ["thumbnailUrl", "instagramThumbnail"] as const) {
      const u = psd[key];
      if (typeof u === "string" && /^https?:\/\//i.test(u)) {
        return { url: u, video: false };
      }
    }
  }
  const items = p.mediaItems ?? [];
  for (const m of items) {
    if (m.thumbnail && /^https?:\/\//i.test(m.thumbnail)) {
      return { url: m.thumbnail, video: false };
    }
  }
  const img = items.find((m) => m.type === "image" && m.url);
  if (img) return { url: img.url, video: false };
  const vid = items.find((m) => m.type === "video" && m.url);
  if (vid) return { url: vid.url, video: true };
  return { url: null, video: false };
}

export type PostFeedOverlay = {
  thumbnailUrl: string | null;
  keyword: string | null;
  dmText: string | null;
  commentReply: string | null;
  commentDmStatus: string | null;
  resourceUrl: string | null;
  agentPostId: string | null;
};
