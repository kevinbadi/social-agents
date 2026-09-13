import "server-only";
import { once, ttlDelPrefix, ttlGetFreshOrStale, ttlSet } from "@/lib/cache/ttl";
import type {
  ZernioAccount,
  ZernioAnalytics,
  ZernioPost,
  ZernioProfile,
} from "./types";

const BASE = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1";
const GET_STALE_MS = 5 * 60 * 1000;

class ZernioError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ZernioError";
  }
}

type ZfetchInit = RequestInit & {
  revalidate?: number;
  attempts?: number;
  timeoutMs?: number;
};

async function zfetch<T>(path: string, init: ZfetchInit = {}): Promise<T> {
  // CREATOR_OS_API_KEY is the profile-scoped Zernio key issued by the Creator OS
  // app (https://www.creatoros.ca/). Zernio is the underlying layer, so the key
  // is used as the Bearer directly. ZERNIO_API_KEY (master) is the fallback.
  const key = process.env.CREATOR_OS_API_KEY || process.env.ZERNIO_API_KEY;
  if (!key) throw new ZernioError(500, "CREATOR_OS_API_KEY is not set (get it at https://www.creatoros.ca/)");

  const method = (init.method ?? "GET").toUpperCase();
  const ttlSec =
    init.revalidate === 0 || method !== "GET" ? 0 : (init.revalidate ?? 30);
  const cacheKey = ttlSec > 0 ? `zernio:${method}:${path}` : "";

  if (cacheKey) {
    const hit = ttlGetFreshOrStale<T>(cacheKey, GET_STALE_MS);
    if (hit?.fresh) return hit.value;
    if (hit && !hit.fresh) {
      void once(cacheKey, () => zfetchNetwork<T>(path, init, key)).then(
        (fresh) => ttlSet(cacheKey, fresh, ttlSec * 1000),
        () => undefined,
      );
      return hit.value;
    }
    const data = await once(cacheKey, () => zfetchNetwork<T>(path, init, key));
    ttlSet(cacheKey, data, ttlSec * 1000);
    return data;
  }

  return zfetchNetwork<T>(path, init, key);
}

async function zfetchNetwork<T>(
  path: string,
  init: ZfetchInit,
  key: string,
): Promise<T> {
  const { revalidate, attempts = 2, timeoutMs = 4000, ...rest } = init;

  // Zernio rate-limits hard: the dashboard fans out ~33 /analytics page reads
  // per render (6 profiles x up to 9 pages) and 18-22 of them came back 429
  // EVERY load (measured 2026-07-31). Those failures used to be swallowed, so
  // the Views headline summed a random surviving subset and showed a different
  // number on every refresh. Retry 429/5xx with backoff instead.
  const MAX_ATTEMPTS = Math.max(1, attempts);
  let lastErr: ZernioError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = rest.signal
      ? AbortSignal.any([rest.signal, timeout])
      : timeout;
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        ...rest,
        signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(rest.headers ?? {}),
        },
        next: revalidate !== undefined ? { revalidate } : { revalidate: 30 },
      });
    } catch (e) {
      // Timeouts / resets are not 429s — retrying them is how Overview sat
      // for a minute. Fail this call and let the page use snapshots.
      throw new ZernioError(
        504,
        e instanceof Error ? e.message : "Zernio fetch failed",
      );
    }

    if (res.ok) return (await res.json()) as T;

    const body = await res.text().catch(() => "");
    lastErr = new ZernioError(
      res.status,
      `Zernio ${res.status}: ${body.slice(0, 200) || res.statusText}`,
    );
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt === MAX_ATTEMPTS) throw lastErr;

    // Honour Retry-After when the server sends one, else exponential backoff
    // with jitter so the retries do not re-collide with each other.
    // Cap at 1.5s — unbounded Retry-After was stalling the Overview for a minute+.
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Math.min(
      1500,
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250),
    );
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw lastErr ?? new ZernioError(500, "Zernio request failed");
}

/** Run `jobs` with at most `limit` in flight — the fan-out that was triggering
 *  the 429 storm. Preserves input order. */
async function pooled<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out = new Array<T>(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      for (let i = next++; i < jobs.length; i = next++) out[i] = await jobs[i]();
    }),
  );
  return out;
}

export async function listProfiles(): Promise<ZernioProfile[]> {
  const data = await zfetch<{ profiles: ZernioProfile[] }>("/profiles");
  return data.profiles ?? [];
}

export async function getProfile(id: string): Promise<ZernioProfile | null> {
  try {
    const data = await zfetch<{ profile?: ZernioProfile } | ZernioProfile>(
      `/profiles/${id}`,
    );
    if (data && typeof data === "object" && "profile" in data) {
      return data.profile ?? null;
    }
    return data as ZernioProfile;
  } catch (e) {
    if (e instanceof ZernioError && e.status === 404) return null;
    throw e;
  }
}

export async function listAccounts(profileId?: string): Promise<ZernioAccount[]> {
  const qs = profileId ? `?profileId=${encodeURIComponent(profileId)}` : "";
  const data = await zfetch<{ accounts: ZernioAccount[] }>(`/accounts${qs}`);
  return data.accounts ?? [];
}

export async function listPosts(params?: {
  limit?: number;
  status?: string;
  profileId?: string;
  /** Bypass the fetch cache — used where the data must be live (overview). */
  fresh?: boolean;
  timeoutMs?: number;
}): Promise<ZernioPost[]> {
  const sp = new URLSearchParams();
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.status) sp.set("status", params.status);
  if (params?.profileId) sp.set("profileId", params.profileId);
  const qs = sp.toString();
  const data = await zfetch<{ posts: ZernioPost[] }>(
    `/posts${qs ? `?${qs}` : ""}`,
    {
      ...(params?.fresh ? { revalidate: 0 } : {}),
      ...(params?.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
    },
  );
  return data.posts ?? [];
}

/**
 * Posts published directly on the platform (outside Zernio) that Zernio has
 * synced for a profile's accounts. Same ZernioPost shape, `origin: "external"`,
 * with platforms[].accountId populated as an object. Pair with
 * syncExternalPosts() for on-demand freshness. Always fetched live.
 */
export async function listExternalPosts(
  profileId: string,
  limit = 100,
): Promise<ZernioPost[]> {
  const sp = new URLSearchParams({
    source: "external",
    profileId,
    limit: String(limit),
  });
  const data = await zfetch<{ posts: ZernioPost[] }>(`/posts?${sp.toString()}`, {
    revalidate: 60,
  });
  return data.posts ?? [];
}

/**
 * Ask Zernio to pull an account's latest external posts right now (instead of
 * its ~90-minute background sync). Debounced ~15s per account server-side, and
 * time-boxed here so a slow platform can't hold up page render.
 */
export async function syncExternalPosts(accountId: string): Promise<void> {
  await zfetch(`/posts/sync-external`, {
    method: "POST",
    body: JSON.stringify({ accountId }),
    revalidate: 0,
    attempts: 1,
    signal: AbortSignal.timeout(2500),
  });
}

export async function createPost(body: {
  content: string;
  platforms: {
    platform: string;
    accountId?: string;
    profileId?: string;
    platformSpecificData?: Record<string, unknown>;
    customContent?: string;
  }[];
  scheduledFor?: string;
  publishNow?: boolean;
  mediaItems?: {
    type: "image" | "video";
    url: string;
    instagramThumbnail?: string;
    thumbnail?: string;
  }[];
  title?: string;
}, opts?: { timeoutMs?: number }): Promise<{ post?: ZernioPost; ok: true } | { ok: false; error: string }> {
  try {
    const data = await zfetch<{ post: ZernioPost }>("/posts", {
      method: "POST",
      body: JSON.stringify(body),
      revalidate: 0,
      timeoutMs: opts?.timeoutMs ?? 45_000,
    });
    ttlDelPrefix("zernio:GET:/posts");
    return { ok: true, post: data.post };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export async function updatePost(
  id: string,
  body: {
    content?: string;
    title?: string;
    scheduledFor?: string;
    mediaItems?: {
      type: "image" | "video";
      url: string;
      instagramThumbnail?: string;
      thumbnail?: string;
    }[];
    platforms?: {
      platform: string;
      accountId?: string;
      profileId?: string;
      platformSpecificData?: Record<string, unknown>;
      customContent?: string;
    }[];
  },
): Promise<{ post?: ZernioPost; ok: true } | { ok: false; error: string }> {
  try {
    const data = await zfetch<{ post?: ZernioPost } | ZernioPost>(
      `/posts/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
        revalidate: 0,
        timeoutMs: 20_000,
      },
    );
    ttlDelPrefix("zernio:GET:/posts");
    const post =
      data && typeof data === "object" && "post" in data
        ? data.post
        : (data as ZernioPost);
    return { ok: true, post };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export async function unpublishPost(
  id: string,
  platform: string,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  try {
    await zfetch(`/posts/${encodeURIComponent(id)}/unpublish`, {
      method: "POST",
      body: JSON.stringify({ platform }),
      revalidate: 0,
      timeoutMs: 30_000,
    });
    ttlDelPrefix("zernio:GET:/posts");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
      status: e instanceof ZernioError ? e.status : undefined,
    };
  }
}

export async function retryPost(
  id: string,
): Promise<{ post?: ZernioPost; ok: true } | { ok: false; error: string; status?: number }> {
  try {
    const data = await zfetch<{ post?: ZernioPost; message?: string }>(
      `/posts/${encodeURIComponent(id)}/retry`,
      { method: "POST", revalidate: 0, timeoutMs: 120_000 },
    );
    ttlDelPrefix("zernio:GET:/posts");
    return { ok: true, post: data.post };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
      status: e instanceof ZernioError ? e.status : undefined,
    };
  }
}

export async function getPost(
  id: string,
  opts?: { timeoutMs?: number },
): Promise<ZernioPost | null> {
  try {
    const data = await zfetch<{ post?: ZernioPost } | ZernioPost>(
      `/posts/${encodeURIComponent(id)}`,
      { revalidate: 0, timeoutMs: opts?.timeoutMs ?? 4000 },
    );
    if (data && typeof data === "object" && "post" in data) {
      return data.post ?? null;
    }
    return data as ZernioPost;
  } catch (e) {
    if (e instanceof ZernioError && e.status === 404) return null;
    throw e;
  }
}

export type CommentAutomationButton = {
  type: "url" | "postback" | "phone";
  title: string;
  url?: string;
};

export type CreateCommentAutomationBody = {
  profileId: string;
  accountId: string;
  trigger?: "comment" | "story_reply";
  platformPostId?: string;
  postId?: string;
  name?: string;
  keywords?: string[];
  matchMode?: "exact" | "contains" | "word";
  dmMessage: string;
  buttons?: CommentAutomationButton[];
  commentReply?: string;
  linkTracking?: boolean;
  clickTag?: string;
  alsoMatchInDms?: boolean;
};

export type ZernioCommentAutomation = {
  id: string;
  name?: string;
  accountId?: string;
  platformPostId?: string;
  postId?: string;
  dmMessage?: string;
  keywords?: string[];
  isActive?: boolean;
};

export async function createCommentAutomation(
  body: CreateCommentAutomationBody,
): Promise<
  | { ok: true; id: string | null; already?: boolean }
  | { ok: false; error: string; status?: number }
> {
  try {
    const data = await zfetch<{
      success?: boolean;
      automation?: { id?: string };
    }>("/comment-automations", {
      method: "POST",
      body: JSON.stringify(body),
      revalidate: 0,
    });
    return { ok: true, id: data.automation?.id ?? null };
  } catch (e) {
    const status = e instanceof ZernioError ? e.status : undefined;
    // Duplicate per-post automation — already wired.
    if (status === 409) return { ok: true, id: null, already: true };
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
      status,
    };
  }
}

export async function listCommentAutomations(opts?: {
  profileId?: string;
  accountId?: string;
}): Promise<ZernioCommentAutomation[]> {
  const sp = new URLSearchParams();
  if (opts?.profileId) sp.set("profileId", opts.profileId);
  if (opts?.accountId) sp.set("accountId", opts.accountId);
  const qs = sp.size ? `?${sp.toString()}` : "";
  const data = await zfetch<{
    success?: boolean;
    automations?: ZernioCommentAutomation[];
  }>(`/comment-automations${qs}`, { revalidate: 0 });
  return data.automations ?? [];
}

export async function updateCommentAutomation(
  automationId: string,
  body: {
    dmMessage?: string;
    buttons?: CommentAutomationButton[] | [];
    commentReply?: string;
    linkTracking?: boolean;
    clickTag?: string;
  },
): Promise<
  | { ok: true; id: string }
  | { ok: false; error: string; status?: number }
> {
  try {
    const data = await zfetch<{
      success?: boolean;
      automation?: { id?: string };
    }>(`/comment-automations/${encodeURIComponent(automationId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      revalidate: 0,
    });
    return { ok: true, id: data.automation?.id ?? automationId };
  } catch (e) {
    const status = e instanceof ZernioError ? e.status : undefined;
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
      status,
    };
  }
}

async function getAnalyticsPage(
  profileId?: string,
  opts?: { fresh?: boolean; page?: number },
): Promise<ZernioAnalytics> {
  const sp = new URLSearchParams();
  if (profileId) sp.set("profileId", profileId);
  if (opts?.page && opts.page > 1) sp.set("page", String(opts.page));
  const qs = sp.size ? `?${sp.toString()}` : "";
  return zfetch<ZernioAnalytics>(`/analytics${qs}`, {
    revalidate: opts?.fresh ? 0 : 60,
  });
}

/** Full analytics with ALL post pages merged. Zernio caps /analytics at 50
 *  posts/page; reading only page 1 silently dropped every older post once a
 *  profile passed 50 (2026-07-12: the Views header was missing 153K views,
 *  including the 115K megan cafe thread). Passing an explicit `page` returns
 *  just that page (legacy behavior). */
export async function getAnalytics(
  profileId?: string,
  opts?: { fresh?: boolean; page?: number },
): Promise<ZernioAnalytics> {
  const first = await getAnalyticsPage(profileId, opts);
  if (opts?.page) return first;
  const pages = first.pagination?.pages ?? 1;
  if (pages <= 1) return first;
  // Sub-pages go through a small pool, not Promise.all over every page at once
  // — the unbounded fan-out is what tripped Zernio's rate limiter.
  const rest = await pooled(
    Array.from({ length: pages - 1 }, (_, i) => () =>
      getAnalyticsPage(profileId, { ...opts, page: i + 2 }).catch(() => null),
    ),
    3,
  );
  // A dropped page means `posts` is a subset — flag it so callers never sum a
  // partial set into a headline total (that was the drifting Views number).
  const incomplete = rest.some((r) => r === null);
  return {
    ...first,
    posts: [...first.posts, ...rest.filter(Boolean).flatMap((r) => r!.posts ?? [])],
    ...(incomplete ? { incomplete: true } : {}),
  };
}

/** Overview analytics: page 1 per profile. Full-catalog pagination belongs
 *  to the nightly snapshot job — walking every /analytics page on each
 *  Overview render is what made the dashboard sit for a minute. Flag
 *  `incomplete` when older pages exist so callers use snapshot totals. */
export async function getAnalyticsForProfiles(
  profileIds: string[],
): Promise<(ZernioAnalytics | null)[]> {
  if (!profileIds.length) return [];
  return pooled(
    profileIds.map(
      (pid) => () =>
        getAnalytics(pid, { page: 1 })
          .then((a) => {
            const pages = a.pagination?.pages ?? 1;
            return pages > 1 ? { ...a, incomplete: true } : a;
          })
          .catch(() => null as ZernioAnalytics | null),
    ),
    4,
  );
}

export { ZernioError };
