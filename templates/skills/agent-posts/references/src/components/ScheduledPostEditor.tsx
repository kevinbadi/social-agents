"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { AgentPost } from "@/lib/agent-posts/types";
import { etDatetimeLocalToIso, isoToEtDatetimeLocal } from "@/lib/et-datetime";

const TITLE_MAX = 100;
const KEYWORD_MAX = 40;

export type ScheduledPostDraft = {
  zernioPostId?: string | null;
  agentPostId?: string | null;
  title: string;
  caption: string;
  scheduledFor: string | null;
  keyword?: string | null;
  dmText?: string | null;
  commentReply?: string | null;
  resourceUrl?: string | null;
  thumbnailUrl?: string | null;
};

type Saved = {
  title: string;
  caption: string;
  scheduledFor: string | null;
  keyword: string | null;
  dmText: string | null;
  commentReply: string | null;
  resourceUrl: string | null;
  thumbnailUrl: string | null;
  job: AgentPost | null;
};

const inputClass =
  "mt-1 w-full rounded-md border border-black/[.12] bg-white px-3 text-sm outline-none ring-neutral-900/10 transition focus:border-neutral-400 focus:ring-2 dark:border-white/[.19] dark:bg-[var(--surface-2)]";

export function ScheduledPostEditor({
  post,
  showDm = false,
  compact = false,
  onSaved,
}: {
  post: ScheduledPostDraft;
  showDm?: boolean;
  compact?: boolean;
  onSaved?: (saved: Saved) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState(post);
  const [title, setTitle] = useState(post.title);
  const [caption, setCaption] = useState(post.caption);
  const [when, setWhen] = useState(isoToEtDatetimeLocal(post.scheduledFor));
  const [keyword, setKeyword] = useState(post.keyword ?? "");
  const [dmText, setDmText] = useState(post.dmText ?? "");
  const [commentReply, setCommentReply] = useState(post.commentReply ?? "");
  const [resourceUrl, setResourceUrl] = useState(post.resourceUrl ?? "");
  const [thumbnailUrl, setThumbnailUrl] = useState(post.thumbnailUrl ?? "");
  const [coverBusy, setCoverBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dmFields =
    showDm || Boolean(snap.keyword || snap.resourceUrl || snap.dmText);

  useEffect(() => {
    setSnap(post);
    setTitle(post.title);
    setCaption(post.caption);
    setWhen(isoToEtDatetimeLocal(post.scheduledFor));
    setKeyword(post.keyword ?? "");
    setDmText(post.dmText ?? "");
    setCommentReply(post.commentReply ?? "");
    setResourceUrl(post.resourceUrl ?? "");
    setThumbnailUrl(post.thumbnailUrl ?? "");
  }, [
    post.zernioPostId,
    post.agentPostId,
    post.title,
    post.caption,
    post.scheduledFor,
    post.thumbnailUrl,
    post.keyword,
    post.dmText,
    post.commentReply,
    post.resourceUrl,
  ]);

  const dirty = useMemo(() => {
    return (
      title.trim() !== (snap.title || "").trim() ||
      caption.trim() !== (snap.caption || "").trim() ||
      when !== isoToEtDatetimeLocal(snap.scheduledFor) ||
      keyword.trim() !== (snap.keyword || "").trim() ||
      dmText.trim() !== (snap.dmText || "").trim() ||
      commentReply.trim() !== (snap.commentReply || "").trim() ||
      resourceUrl.trim() !== (snap.resourceUrl || "").trim() ||
      thumbnailUrl.trim() !== (snap.thumbnailUrl || "").trim()
    );
  }, [title, caption, when, keyword, dmText, commentReply, resourceUrl, thumbnailUrl, snap]);

  function syncFrom(next: ScheduledPostDraft) {
    setSnap(next);
    setTitle(next.title);
    setCaption(next.caption);
    setWhen(isoToEtDatetimeLocal(next.scheduledFor));
    setKeyword(next.keyword ?? "");
    setDmText(next.dmText ?? "");
    setCommentReply(next.commentReply ?? "");
    setResourceUrl(next.resourceUrl ?? "");
    setThumbnailUrl(next.thumbnailUrl ?? "");
  }

  async function onSave() {
    setError(null);
    if (!caption.trim()) {
      setError("Caption cannot be empty.");
      return;
    }
    if (!when) {
      setError("Set when this post should go live.");
      return;
    }
    const scheduledFor = etDatetimeLocalToIso(when);
    if (when && !scheduledFor) {
      setError("That go-live time is not valid.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, string | null | undefined> = {
        zernioPostId: post.zernioPostId || undefined,
        agentPostId: post.agentPostId || undefined,
      };
      if (title.trim() !== (snap.title || "").trim()) payload.title = title.trim();
      if (caption.trim() !== (snap.caption || "").trim()) payload.caption = caption.trim();
      if (when !== isoToEtDatetimeLocal(snap.scheduledFor)) payload.scheduledFor = scheduledFor;
      if (dmFields) {
        if (keyword.trim() !== (snap.keyword || "").trim()) payload.keyword = keyword.trim();
        if (dmText.trim() !== (snap.dmText || "").trim()) payload.dmText = dmText.trim();
        if (commentReply.trim() !== (snap.commentReply || "").trim()) {
          payload.commentReply = commentReply.trim();
        }
        if (resourceUrl.trim() !== (snap.resourceUrl || "").trim()) {
          payload.resourceUrl = resourceUrl.trim();
        }
      }
      if (thumbnailUrl.trim() !== (snap.thumbnailUrl || "").trim()) {
        payload.thumbnailUrl = thumbnailUrl.trim();
      }
      const res = await fetch("/api/scheduled-posts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as Saved & { error?: string };
      if (!res.ok) throw new Error(data.error || "Save failed");
      syncFrom({
        ...post,
        title: data.title,
        caption: data.caption,
        scheduledFor: data.scheduledFor,
        keyword: data.keyword,
        dmText: data.dmText,
        commentReply: data.commentReply,
        resourceUrl: data.resourceUrl,
        thumbnailUrl: data.thumbnailUrl,
      });
      setSavedAt(Date.now());
      onSaved?.(data);
      if (!onSaved) router.refresh();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={compact ? "mt-2" : "mt-3"}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-black/[.10] bg-black/[.03] px-2.5 py-1 text-[11px] font-medium text-neutral-700 transition hover:border-black/[.22] hover:bg-black/[.06] dark:border-white/[.16] dark:bg-white/[.06] dark:text-neutral-200 dark:hover:border-white/[.28]"
      >
        {open ? "Close edit" : "Edit scheduled post"}
      </button>
      {savedAt && !open ? (
        <span className="ml-2 text-[11px] text-emerald-700 dark:text-emerald-400">
          Saved
        </span>
      ) : null}

      {open ? (
        <div
          className={`mt-3 space-y-3 rounded-xl border border-black/[.08] bg-black/[.02] p-3 dark:border-white/[.12] dark:bg-white/[.03] ${
            compact ? "" : "sm:p-4"
          }`}
        >
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-400">
            Edit before it goes live
          </p>
          <label className="block text-sm font-medium">
            Title
            <input
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
              className={`${inputClass} h-10`}
              placeholder="YouTube and other title fields"
            />
            <span className="mt-1 block text-right text-[11px] text-neutral-400">
              {title.length}/{TITLE_MAX}
            </span>
          </label>
          <div>
            <p className="text-sm font-medium">Cover</p>
            <p className="mt-0.5 text-xs text-neutral-500">
              JPG or PNG. Instagram grid + YouTube Shorts thumbnail.
            </p>
            <input
              id={`cover-${post.zernioPostId || post.agentPostId || "post"}`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setError(null);
                setCoverBusy(true);
                try {
                  const fd = new FormData();
                  fd.append("file", file, file.name);
                  const res = await fetch("/api/upload", { method: "POST", body: fd });
                  const data = (await res.json()) as { url?: string; error?: string };
                  if (!res.ok || !data.url) throw new Error(data.error || "Cover upload failed");
                  setThumbnailUrl(data.url);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Cover upload failed");
                } finally {
                  setCoverBusy(false);
                }
              }}
            />
            <div className="mt-2 flex items-start gap-3">
              {thumbnailUrl ? (
                <div
                  className="relative w-20 overflow-hidden rounded-lg border border-black/[.08] bg-neutral-100 dark:border-white/[.14] dark:bg-[var(--surface-2)]"
                  style={{ aspectRatio: "9 / 16" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnailUrl}
                    alt="Reel cover"
                    className="h-full w-full object-cover"
                  />
                  {coverBusy ? (
                    <div className="absolute inset-0 grid place-items-center bg-black/40 text-[10px] font-medium text-white">
                      Uploading…
                    </div>
                  ) : null}
                </div>
              ) : (
                <div
                  className="flex w-20 items-center justify-center rounded-lg border border-dashed border-black/[.18] bg-black/[.015] text-center text-[10px] text-neutral-400 dark:border-white/[.18]"
                  style={{ aspectRatio: "9 / 16" }}
                >
                  {coverBusy ? "Uploading…" : "No cover"}
                </div>
              )}
              <label
                htmlFor={`cover-${post.zernioPostId || post.agentPostId || "post"}`}
                className="mt-1 cursor-pointer text-xs font-medium text-teal-800 underline-offset-2 hover:underline dark:text-teal-300"
              >
                {thumbnailUrl ? "Replace cover" : "Add cover"}
              </label>
            </div>
          </div>
          <label className="block text-sm font-medium">
            Caption
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, 2200))}
              rows={compact ? 5 : 8}
              className={`${inputClass} resize-y py-2`}
            />
          </label>
          <label className="block text-sm font-medium">
            Goes live
            <span className="ml-2 font-normal text-neutral-500">ET</span>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={`${inputClass} h-10`}
            />
            <span className="mt-1 block text-xs text-neutral-500">
              Agent Posts usually use 12:00am, 3:00, 6:00, or 9:00pm ET.
            </span>
          </label>

          {dmFields ? (
            <div className="space-y-3 rounded-lg border border-black/[.06] bg-white/70 p-3 dark:border-white/[.10] dark:bg-white/[.04]">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-400">
                Comment to DM
              </p>
              <label className="block text-sm font-medium">
                Keyword
                <input
                  value={keyword}
                  maxLength={KEYWORD_MAX}
                  onChange={(e) => setKeyword(e.target.value.slice(0, KEYWORD_MAX))}
                  className={`${inputClass} h-10`}
                />
              </label>
              <label className="block text-sm font-medium">
                DM resource link
                <input
                  value={resourceUrl}
                  onChange={(e) => setResourceUrl(e.target.value)}
                  placeholder="https://… or /go/slug"
                  className={`${inputClass} h-10`}
                />
              </label>
              <label className="block text-sm font-medium">
                DM message
                <textarea
                  value={dmText}
                  onChange={(e) => setDmText(e.target.value)}
                  rows={3}
                  className={`${inputClass} resize-y py-2`}
                />
              </label>
              <label className="block text-sm font-medium">
                Public reply
                <input
                  value={commentReply}
                  onChange={(e) => setCommentReply(e.target.value)}
                  className={`${inputClass} h-10`}
                />
              </label>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                syncFrom(post);
                setError(null);
                setOpen(false);
              }}
              className="h-9 rounded-md px-3 text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || coverBusy || !dirty}
              onClick={onSave}
              className="inline-flex h-9 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {saving ? "Saving…" : "Save edits"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
