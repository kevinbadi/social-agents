import { PlatformBadge } from "./PlatformBadge";
import { formatNumber } from "@/lib/format";
import type { ZernioAccount } from "@/lib/zernio/types";

// Manual avatar overrides (public/avatars/*) — Zernio syncs whatever picture
// the platform currently has, which for the AI personas is stale/low-res.
// Keyed by Zernio account id so only the intended accounts are affected.
const AVATAR_OVERRIDES: Record<string, string> = {
  // Megan — IG / TikTok / Twitter
  "6a3c36a19d9472faaed7d5e2": "/avatars/megan.jpg",
  "6a3c37d09d9472faaed7e25c": "/avatars/megan.jpg",
  "6a3c37629d9472faaed7dde3": "/avatars/megan.jpg",
  // Danny — IG / TikTok / Twitter
  "6a3c3b3e9d9472faaed806fa": "/avatars/danny.jpg",
  "6a3c3b889d9472faaed809c0": "/avatars/danny.jpg",
  "6a3c3b639d9472faaed8084f": "/avatars/danny.jpg",
  // Kev Threads — rebranded m77.shop → kev.creatoros on-platform 2026-07-12;
  // Zernio still serves the stale m77.shop avatar until its next profile
  // sync. Remove once Zernio catches up (username label fixes itself then).
  "6a53f3fd3ecd8aa344ce1843": "/avatars/kev.jpg",
};

// Same story for usernames: Zernio's identity cache lags platform renames
// and exposes no refresh endpoint (probed 2026-07-13) — override until its
// slow sync or an account reconnect catches up.
const USERNAME_OVERRIDES: Record<string, string> = {
  "6a53f3fd3ecd8aa344ce1843": "kev.creatoros", // Zernio cache: m77.shop
};

/** Normalize an account into the few fields the UI needs, regardless of where
 *  the platform stashed them (top-level vs. metadata.profileData). */
export function normalizeAccount(a: ZernioAccount) {
  const pd = a.metadata?.profileData;
  return {
    id: a._id,
    platform: a.platform,
    username: USERNAME_OVERRIDES[a._id] ?? pd?.username ?? a.username,
    displayName: USERNAME_OVERRIDES[a._id] ?? pd?.displayName ?? a.displayName,
    // Top-level profilePicture FIRST: Zernio re-hosts platform avatars there
    // (media.zernio.com — stable), while profileData keeps the platform's
    // signed CDN URL, which expires (TikTok's were 403ing, 2026-07-12).
    pic: AVATAR_OVERRIDES[a._id] ?? a.profilePicture ?? pd?.profilePicture,
    url: pd?.profileUrl ?? a.profileUrl,
    followers: a.followersCount ?? pd?.followersCount ?? 0,
  };
}

export function SocialAccounts({ accounts }: { accounts: ZernioAccount[] }) {
  if (accounts.length === 0) {
    return (
      <div className="mt-3 rounded-2xl border border-dashed border-black/[.12] p-6 text-sm text-neutral-600 dark:border-white/[.19] dark:text-[#b6bac2]">
        No social accounts connected yet. Connect accounts to this profile in
        Zernio to see them here.
      </div>
    );
  }

  const sorted = accounts
    .map(normalizeAccount)
    .sort((a, b) => b.followers - a.followers);

  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {sorted.map((a) => {
        const label = a.displayName || a.username || "Account";
        const card = (
          <>
            {a.pic ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={a.pic}
                alt=""
                referrerPolicy="no-referrer"
                className="size-10 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="size-10 shrink-0 rounded-full bg-neutral-200 dark:bg-[var(--surface-3)]" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-semibold leading-tight">
                  {label}
                </p>
                <span className="shrink-0">
                  <PlatformBadge platform={a.platform} />
                </span>
              </div>
              <p className="mt-1 text-sm">
                <span className="font-bold tabular-nums">
                  {formatNumber(a.followers)}
                </span>{" "}
                <span className="text-xs text-neutral-400">followers</span>
              </p>
            </div>
          </>
        );
        const cls =
          "flex items-center gap-3 rounded-xl border border-black/[.08] bg-white p-3 transition hover:border-black/[.18] dark:border-white/[.14] dark:bg-[var(--surface-1)] dark:hover:border-white/[.22]";
        return a.url ? (
          <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className={cls}>
            {card}
          </a>
        ) : (
          <div key={a.id} className={cls}>
            {card}
          </div>
        );
      })}
    </div>
  );
}
