# post-shortform

Publish a short vertical video (<90s, 9:16) + caption to TikTok / Instagram Reels / YouTube Shorts: upload once, one `create_post` across every shortform network.

## Before anything

Read `social-agents/BRAND.md` and `social-agents/PROFILES.md`. Caption, hooks, and CTA flow from the brand pack. If pulling from `content-library/`, take the next unposted clip (keep a `content-library/POSTED.md` ledger; append after each successful post).

## Procedure

1. Validate before upload: the file exists on disk, it's a video format, vertical aspect expected for Reels/TikTok. `validate_media` on the uploaded URL catches per-network size limits.
2. Upload once with `upload_media`: the returned `med_` id is reusable across networks. Upload the cover image too if there is one.
3. Check the caption with `validate_post_length` against every target network.
4. TikTok: `tiktok_creator_info` shows the account's allowed privacy levels. In the simple form CreatorOS fills in TikTok's consent flags itself; to pick a privacy level or interaction settings, pass a top-level `tiktok: { privacy_level, allow_comment, allow_duet, allow_stitch }`.
5. One `create_post` with `platforms: ["tiktok","instagram","youtube"]`, `media: [<med_ id>]`, `post_type: "short_video"`, a `title` for YouTube, and the cover as `cover: <med_ id>` (or `cover_timestamp_ms` to use a frame). CreatorOS makes it a Reel and a Short.
6. Timing: `schedule_at` + the timezone from `social-agents/social-agents.json`. Omitting both `schedule_at` and `draft` publishes immediately. CreatorOS servers publish, so nothing local needs to stay running.

## Judgment rules

- Caption tone follows the brand pack; hashtags per its policy — a few relevant ones, not a wall.
- If the video is landscape (16:9), warn the human before posting as Reel/TikTok — it will look wrong. Post only on their confirmation.
- Don't split into per-platform posts unless captions must differ; one call keeps IDs and retries simple.
- If one platform's validation fails, post to the passing platforms and report the failure — don't block everything.
- **Never post without the content existing.** No placeholder captions, no invented media URLs.
- TikTok public URLs resolve asynchronously — an empty TikTok URL right after publish is normal; it arrives minutes later.
- After posting new content, ask the human whether they want the comments-to-DM funnel on it ("want the funnel on this one?").

## Verification

`create_post` returns a post id; confirm per-network status via `get_post`. A failed platform → `retry_post` once, then report honestly.
