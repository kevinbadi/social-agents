# post-shortform

Publish a short vertical video (<90s, 9:16) + caption to TikTok / Instagram Reels / YouTube Shorts — upload once, one `create_post` across all shortform account IDs.

## Before anything

Read `midas/BRAND.md` and `midas/PROFILES.md`. Caption, hooks, and CTA flow from the brand pack. If pulling from `content-library/`, take the next unposted clip (keep a `content-library/POSTED.md` ledger; append after each successful post).

## Procedure

1. Validate before upload: the file exists on disk, it's a video format, vertical aspect expected for Reels/TikTok. `validate_media` on the uploaded URL catches per-platform size limits.
2. Upload once with `upload_media` — the returned URL is reusable across platforms.
3. Check the caption with `validate_post_length` against every target platform.
4. TikTok prerequisites: `tiktok_creator_info` for the account's privacy levels; the post needs `platformSpecificData` with a valid `privacyLevel`, `allowComment`/`allowDuet`/`allowStitch`, and `contentPreviewConfirmed: true` + `expressConsentGiven: true` — TikTok posts FAIL without the consent flags.
5. One `create_post` with a platform entry per shortform account (TikTok + Instagram + YouTube). Instagram auto-detects Reels from 9:16 ≤90s video; YouTube auto-detects Shorts (≤3 min + vertical, no flag exists). Give YouTube a `title`.
6. Scheduling: pass `scheduledFor` + the timezone from `midas/midas.json`. CreatorOS servers publish — nothing local needs to stay running.

## Judgment rules

- Caption tone follows the brand pack; hashtags per its policy — a few relevant ones, not a wall.
- If the video is landscape (16:9), warn the human before posting as Reel/TikTok — it will look wrong. Post only on their confirmation.
- Don't split into per-platform posts unless captions must differ; one call keeps IDs and retries simple.
- If one platform's validation fails, post to the passing platforms and report the failure — don't block everything.
- **Never post without the content existing.** No placeholder captions, no invented media URLs.
- TikTok public URLs resolve asynchronously — an empty TikTok URL right after publish is normal; it arrives minutes later.
- After posting new content, ask the human whether they want the comments-to-DM funnel on it ("want the funnel on this one?").

## Verification

`create_post` returns a post ID; confirm per-platform status via `get_post`. A failed platform → `retry_post` once, then report honestly.
