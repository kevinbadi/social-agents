import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { uploadBytesToInsforge } from "@/lib/insforge/storage";
import { createPost, getPost, listAccounts, retryPost } from "@/lib/zernio/client";
import {
  flushPendingCommentDmSetups,
  queueCommentToDm,
  retargetCommentDmPost,
} from "@/lib/comments/automations";
import { buildDmMessage, resolveResourceUrls } from "@/lib/comments/dm-copy";
import { isPostPublishComplete } from "@/lib/posts/status";
import type { ZernioPost, ZernioPostPlatform } from "@/lib/zernio/types";
import {
  captionForThreads,
  captionForTwitter,
  captionWithoutCommentCta,
  draftPlatformCopy,
} from "./copy";
import { runThumbnailSkill } from "./generate";
import { pollYoutubeKeywordComments, withResourceLinks } from "./youtube";
import { nextOpenSlot } from "./slots";
import {
  claimNextAgentPost,
  findReusableGeneration,
  findWorkingSibling,
  listAgentPostsInPublishWindow,
  listScheduledAgentZernioIds,
  markAgentPostsPublished,
  patchAgentPost,
  type AgentPost,
} from "./store";

const VIDEO_PLATFORMS = new Set([
  "instagram",
  "tiktok",
  "youtube",
  "twitter",
  "x",
  "threads",
  "linkedin",
  "facebook",
]);

let draining = false;

function which(bin: string): string | null {
  try {
    const out = execFileSync("which", [bin], { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Download failed (${res.status}).`);
      const type = (res.headers.get("content-type") || "").toLowerCase();
      if (type.includes("text/html")) {
        throw new Error(
          "That video URL is a web page, not a media file. Upload the mp4 instead.",
        );
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 10_000) throw new Error("Downloaded file is too small to be a video.");
      if (buf.length > 220 * 1024 * 1024) {
        throw new Error("Video is over 200MB. Compress it and try again.");
      }
      fs.writeFileSync(dest, buf);
      return;
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = /fetch failed|network|ECONN|ETIMEDOUT|timeout|socket/i.test(msg);
      if (!retryable || i === 2) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error("Download failed.");
}

function tryYtDlp(url: string, dest: string): boolean {
  const bin = which("yt-dlp") || which("yt-dlp_macos");
  if (!bin) return false;
  try {
    execFileSync(
      bin,
      ["-f", "mp4/bestaudio[ext=m4a]/best", "-o", dest, "--no-playlist", url],
      { stdio: "pipe", timeout: 180_000 },
    );
    return fs.existsSync(dest) && fs.statSync(dest).size > 10_000;
  } catch {
    return false;
  }
}

async function materializeVideo(videoUrl: string, dest: string): Promise<void> {
  try {
    await downloadToFile(videoUrl, dest);
    return;
  } catch (e) {
    if (tryYtDlp(videoUrl, dest)) return;
    throw e;
  }
}

async function processJob(job: AgentPost): Promise<void> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-post-${job.id.slice(0, 8)}-`));
  const videoPath = path.join(workDir, "video.mp4");
  try {
    const waiting = await findWorkingSibling(job.videoUrl, job.id);
    if (waiting && !(await findReusableGeneration(job.videoUrl, job.id))) {
      await patchAgentPost(job.id, {
        status: "queued",
        step: "queued",
        error: null,
      });
      return;
    }

    const sibling = await findReusableGeneration(job.videoUrl, job.id);
    const hasDm = resolveResourceUrls(job.resourceUrl).length > 0;
    const userTitle = String(job.youtubeTitle || "").trim().slice(0, 100);
    const userCaption = String(job.caption || "").trim();
    let keyword = "";
    let caption = userCaption;
    let transcript = "";
    let thumbUrl = "";
    let youtubeTitle = userTitle;
    let youtubeDescription = "";
    let twitterCaption = "";
    let linkedinCaption = "";
    let threadsCaption = "";
    let dmText = "";
    let commentReply = "";

    if (
      sibling?.thumbnailUrl &&
      sibling.caption &&
      (userTitle || sibling.youtubeTitle) &&
      (sibling.keyword || !hasDm) &&
      (!hasDm || sibling.dmText)
    ) {
      keyword = sibling.keyword ?? "";
      caption = userCaption || sibling.caption;
      transcript = sibling.transcript || "";
      thumbUrl = sibling.thumbnailUrl;
      youtubeTitle = userTitle || sibling.youtubeTitle || "";
      youtubeDescription = sibling.youtubeDescription || sibling.caption;
      twitterCaption = sibling.twitterCaption || "";
      linkedinCaption = sibling.linkedinCaption || "";
      threadsCaption = sibling.threadsCaption || "";
      dmText = hasDm
        ? buildDmMessage(keyword, job.dmNote || sibling.dmText, job.resourceUrl)
        : "";
      commentReply = hasDm ? sibling.commentReply || "" : "";
      if (userCaption && userCaption !== sibling.caption) {
        const copy = await draftPlatformCopy({
          keyword,
          caption,
          transcript,
          resourceUrl: job.resourceUrl,
          userProvided: true,
        });
        youtubeDescription = copy.youtubeDescription;
        twitterCaption = copy.twitterCaption;
        linkedinCaption = copy.linkedinCaption;
        threadsCaption = copy.threadsCaption;
        commentReply = hasDm ? copy.commentReply : "";
        if (hasDm) {
          dmText = buildDmMessage(keyword, job.dmNote || copy.dmText, job.resourceUrl);
        }
      }
      await patchAgentPost(job.id, {
        step: "slot",
        keyword,
        caption,
        transcript: transcript || null,
        thumbnailUrl: thumbUrl,
        youtubeTitle,
        youtubeDescription,
        twitterCaption,
        linkedinCaption,
        threadsCaption,
        dmText,
        commentReply,
      });
    } else {
      await patchAgentPost(job.id, { step: "download" });
      await materializeVideo(job.videoUrl, videoPath);

      await patchAgentPost(job.id, { step: "thumbnail" });
      const coverPath = path.join(workDir, "cover.png");
      const generated = await runThumbnailSkill(videoPath, coverPath, {
        noCta: !hasDm,
      });
      if (!generated.coverPath || !fs.existsSync(generated.coverPath)) {
        throw new Error(
          "vertical-video-thumbnail did not write a cover PNG.",
        );
      }

      const thumbBytes = fs.readFileSync(generated.coverPath);
      const thumb = await uploadBytesToInsforge(
        thumbBytes,
        `agent-cover-${job.id}.png`,
        "image/png",
      );
      thumbUrl = thumb.url;
      keyword = generated.keyword;
      caption = userCaption || generated.caption;
      transcript = generated.transcript;

      await patchAgentPost(job.id, {
        step: "copy",
        keyword,
        caption,
        transcript: transcript || null,
        thumbnailUrl: thumbUrl,
      });

      const copy = await draftPlatformCopy({
        keyword,
        caption,
        transcript,
        resourceUrl: job.resourceUrl,
        userProvided: Boolean(userCaption),
      });
      dmText = hasDm
        ? buildDmMessage(keyword, job.dmNote || copy.dmText, job.resourceUrl)
        : "";
      youtubeTitle = userTitle || copy.youtubeTitle;
      youtubeDescription = copy.youtubeDescription;
      twitterCaption = copy.twitterCaption;
      linkedinCaption = copy.linkedinCaption;
      threadsCaption = copy.threadsCaption;
      commentReply = hasDm ? copy.commentReply : "";

      await patchAgentPost(job.id, {
        step: "slot",
        youtubeTitle,
        youtubeDescription,
        twitterCaption,
        linkedinCaption,
        threadsCaption,
        dmText,
        commentReply,
      });
    }

    const story = captionWithoutCommentCta(caption) || caption;
    if (!hasDm) {
      caption = story;
      dmText = "";
      commentReply = "";
    }
    twitterCaption = captionForTwitter(twitterCaption, story);
    linkedinCaption = captionWithoutCommentCta(linkedinCaption) || story;
    threadsCaption = captionForThreads(threadsCaption, story);
    youtubeDescription = story;
    await patchAgentPost(job.id, {
      caption,
      twitterCaption,
      linkedinCaption,
      threadsCaption,
      youtubeDescription,
      dmText,
      commentReply,
    });

    const accounts = (await listAccounts(job.profileId)).filter((a) => {
      const plat = a.platform.toLowerCase();
      return VIDEO_PLATFORMS.has(plat) && a.isActive !== false;
    });
    if (accounts.length === 0) {
      throw new Error("No connected video accounts on that socials set.");
    }

    const slot = await nextOpenSlot(job.profileId);
    const scheduledFor = slot.toISOString();
    await patchAgentPost(job.id, { scheduledFor, step: "publish" });

    const content = caption;
    // YouTube has no DM channel but descriptions carry links: embed the funnel
    // resource so "comment KEYWORD" can be answered with "see the description".
    if (accounts.some((a) => a.platform.toLowerCase() === "youtube")) {
      const linked = withResourceLinks(youtubeDescription || story, job.resourceUrl, keyword);
      if (linked !== youtubeDescription) {
        youtubeDescription = linked;
        await patchAgentPost(job.id, { youtubeDescription });
      }
    }
    const platforms = accounts.map((a) => {
      const platform = a.platform;
      const plat = platform.toLowerCase();
      const entry: {
        platform: string;
        accountId: string;
        profileId: string;
        platformSpecificData?: Record<string, unknown>;
        customContent?: string;
      } = { platform, accountId: a._id, profileId: job.profileId };

      if (plat === "youtube") {
        entry.platformSpecificData = {
          title: youtubeTitle,
          description: youtubeDescription,
          visibility: "public",
          shorts: true,
          madeForKids: false,
          thumbnailUrl: thumbUrl,
        };
      }
      if (plat === "instagram") {
        entry.platformSpecificData = {
          instagramThumbnail: thumbUrl,
          thumbnailUrl: thumbUrl,
        };
      }
      if (plat === "twitter" || plat === "x") {
        entry.customContent = twitterCaption || captionForTwitter(story);
      }
      if (plat === "linkedin") {
        entry.customContent = linkedinCaption || content;
      }
      if (plat === "threads") {
        entry.customContent = threadsCaption || captionForThreads(story);
      }
      if (plat === "tiktok") {
        entry.customContent = story;
      }
      return entry;
    });

    const result = await createPost({
      content,
      platforms,
      mediaItems: [
        {
          type: "video",
          url: job.videoUrl,
          instagramThumbnail: thumbUrl,
          thumbnail: thumbUrl,
        },
      ],
      title: youtubeTitle,
      scheduledFor,
    });

    if (!result.ok || !result.post) {
      throw new Error(result.ok ? "Zernio returned no post." : result.error);
    }

    const dm = hasDm
      ? await queueCommentToDm({
          post: result.post,
          platforms,
          keyword,
          dmMessage: dmText,
          resourceUrl: job.resourceUrl,
          commentReply,
          scheduledFor,
        })
      : null;

    await patchAgentPost(job.id, {
      status: "scheduled",
      step: "done",
      error: null,
      zernioPostId: result.post._id,
      commentDmStatus: dm?.status ?? "skipped",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error(`[agent-posts] job ${job.id} failed:`, message);
    const retryable = /fetch failed|network|ECONN|ETIMEDOUT|timeout|socket/i.test(
      message,
    );
    const siblingReady = retryable
      ? Boolean(await findReusableGeneration(job.videoUrl, job.id))
      : false;
    await patchAgentPost(job.id, {
      status: siblingReady ? "queued" : "failed",
      step: siblingReady ? "queued" : "failed",
      error: message.slice(0, 800),
    });
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function platformAccountId(pl: ZernioPostPlatform): string | null {
  if (!pl.accountId) return null;
  return typeof pl.accountId === "string" ? pl.accountId : pl.accountId._id ?? null;
}

function uniquifyCaption(text: string): string {
  return String(text || "").replace(/\u200b+$/g, "") + "\u200b";
}

function stalledPlatforms(post: ZernioPost): ZernioPostPlatform[] {
  return (post.platforms ?? []).filter((pl) => {
    const status = (pl.status ?? "").toLowerCase();
    const attempts = Number(
      (pl as { publishAttempts?: number }).publishAttempts ?? 0,
    );
    // Never companion YouTube — it often finishes late on the original post.
    // Companion YT while the original is still publishing is how we double-posted.
    if (pl.platform.toLowerCase() === "youtube") return false;
    return (status === "pending" || status === "queued") && attempts === 0;
  });
}

function instagramPlatformPostId(post: ZernioPost): string | null {
  const ig = (post.platforms ?? []).find(
    (pl) => pl.platform.toLowerCase() === "instagram" && pl.platformPostId,
  );
  return ig?.platformPostId ?? null;
}

async function publishRemainingPlatforms(
  post: ZernioPost,
  uniquify: boolean,
): Promise<{ post?: ZernioPost; ok: true } | { ok: false; error: string }> {
  const pending = stalledPlatforms(post);
  if (!pending.length) return { ok: false, error: "No stalled platforms." };
  const platforms = pending
    .map((pl) => {
      const accountId = platformAccountId(pl);
      if (!accountId) return null;
      const customContent = pl.customContent
        ? uniquify
          ? uniquifyCaption(pl.customContent)
          : pl.customContent
        : undefined;
      return {
        platform: pl.platform,
        accountId,
        profileId: pl.profileId,
        ...(customContent ? { customContent } : {}),
        ...(pl.platformSpecificData && Object.keys(pl.platformSpecificData).length
          ? { platformSpecificData: pl.platformSpecificData }
          : {}),
      };
    })
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (!platforms.length) return { ok: false, error: "Stalled platforms have no account ids." };
  const content = uniquify ? uniquifyCaption(post.content) : post.content;
  return createPost(
    {
      content,
      ...(post.title ? { title: post.title } : {}),
      platforms,
      mediaItems: (post.mediaItems ?? []).map((m) => ({
        type: m.type,
        url: m.url,
        ...(m.thumbnail ? { thumbnail: m.thumbnail } : {}),
      })),
      publishNow: true,
    },
    { timeoutMs: 240_000 },
  );
}

async function nudgeStalledAgentPosts(): Promise<void> {
  const jobs = await listAgentPostsInPublishWindow();
  if (!jobs.length) return;

  for (const job of jobs) {
    if (!job.zernioPostId) continue;
    const original = await getPost(job.zernioPostId).catch(() => null);
    const followup = job.followupZernioPostId
      ? await getPost(job.followupZernioPostId).catch(() => null)
      : null;

    if (
      (original && isPostPublishComplete(original)) ||
      (followup && isPostPublishComplete(followup))
    ) {
      if (job.status !== "published") {
        await markAgentPostsPublished(
          [job.zernioPostId, job.followupZernioPostId].filter(
            (id): id is string => Boolean(id),
          ),
        );
      }
      continue;
    }

    if (followup) {
      const st = (followup.status ?? "").toLowerCase();
      if (st === "failed" || st === "partial") {
        const retried = await retryPost(followup._id);
        if (!retried.ok) {
          console.warn(
            `[agent-posts] followup retry ${followup._id}:`,
            retried.error,
          );
        }
      }
      continue;
    }

    if (!original || stalledPlatforms(original).length === 0) continue;

    // Zernio's worker claimed the post and is still grinding through the
    // platforms (a slow queue took 13 min on 2026-09-11). Spinning up a
    // companion while it is actively publishing = every platform twice.
    // Only companion once the claim has gone stale.
    const claimedAt = Date.parse(
      String((original as { publishingClaimedAt?: string }).publishingClaimedAt ?? ""),
    );
    const enqueuedAt = Date.parse(
      String((original as { lastEnqueuedAt?: string }).lastEnqueuedAt ?? ""),
    );
    const lastActivity = Math.max(
      Number.isFinite(claimedAt) ? claimedAt : 0,
      Number.isFinite(enqueuedAt) ? enqueuedAt : 0,
    );
    const originalStatus = (original.status ?? "").toLowerCase();
    // A post Zernio has already claimed ("publishing") is never companioned
    // on a timer alone: wait until its claim is 45 min stale. A still
    // "scheduled" post with no worker activity gets the shorter 20 min grace.
    const graceMs = (originalStatus === "publishing" ? 45 : 20) * 60_000;
    if (originalStatus === "publishing" && !lastActivity) {
      console.log(
        `[agent-posts] ${job.id} (${original._id}) is publishing with no claim timestamp; retry only, no companion`,
      );
      await retryPost(original._id).catch(() => null);
      continue;
    }
    if (lastActivity && Date.now() - lastActivity < graceMs) {
      console.log(
        `[agent-posts] ${job.id} (${original._id}) still being worked by Zernio (${Math.round((Date.now() - lastActivity) / 60_000)}m ago); no companion yet`,
      );
      continue;
    }

    const retried = await retryPost(original._id);
    if (retried.ok && retried.post && stalledPlatforms(retried.post).length === 0) {
      continue;
    }

    let companion = await publishRemainingPlatforms(original, false);
    if (!companion.ok && /already scheduled|last 24 hours|409/i.test(companion.error)) {
      companion = await publishRemainingPlatforms(original, true);
    }
    if (!companion.ok || !companion.post) {
      console.warn(
        `[agent-posts] nudge ${job.id} (${original._id}):`,
        companion.ok ? "no companion post" : companion.error,
      );
      continue;
    }

    await patchAgentPost(job.id, { followupZernioPostId: companion.post._id });
    await retargetCommentDmPost(
      original._id,
      companion.post._id,
      instagramPlatformPostId(companion.post),
    );
    await flushPendingCommentDmSetups({ postId: companion.post._id }).catch((e) =>
      console.error(
        "[agent-posts] comment-dm after nudge:",
        e instanceof Error ? e.message : e,
      ),
    );
    console.log(
      `[agent-posts] nudged ${job.id} → companion ${companion.post._id}`,
    );
  }
}

export async function syncLiveAgentPosts(): Promise<void> {
  const ids = await listScheduledAgentZernioIds();
  if (!ids.length) return;
  const live: string[] = [];
  await Promise.all(
    ids.map(async (id) => {
      const post = await getPost(id).catch(() => null);
      if (post && isPostPublishComplete(post)) live.push(id);
    }),
  );
  if (live.length) await markAgentPostsPublished(live);
}

export async function drainAgentPosts(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const job = await claimNextAgentPost();
      if (!job) break;
      await processJob(job);
    }
    await syncLiveAgentPosts();
    await nudgeStalledAgentPosts();
    await pollYoutubeKeywordComments().catch((e) =>
      console.error("[agent-posts] youtube poll:", e instanceof Error ? e.message : e),
    );
  } catch (e) {
    console.error(
      "[agent-posts] drain failed:",
      e instanceof Error ? e.message : e,
    );
  } finally {
    draining = false;
  }
}

/** Kick the drain without blocking the HTTP response. */
export function kickAgentPostDrain(): void {
  setTimeout(() => {
    drainAgentPosts().catch((e) =>
      console.error("[agent-posts] kick:", e instanceof Error ? e.message : e),
    );
  }, 50);
}