# post-longform

Publish a longform video to YouTube with title, description, and tags; also update metadata on published videos.

## Before anything

Read `social-agents/BRAND.md` — the description's pitch, links, and CTA come from it. Get the YouTube account id (`acc_...`) from a fresh `list_accounts`; ids saved in `social-agents/PROFILES.md` can be re-issued by CreatorOS.

## Procedure

1. `upload_media` with the video path — longform files are large; uploads can take a while, don't assume failure early.
2. `create_post`, advanced form: `targets: [{ platform: "youtube", account_id: <acc_ id>, options: { title, visibility, categoryId, playlistId, madeForKids, firstComment } }]`, `content` = description (≤5,000 chars), `title` (≤100 chars), `tags` (each ≤100 chars, ≤500 combined), `post_type: "long_video"`. `firstComment` is auto-posted and pinned.
3. Custom thumbnail: `upload_media` the image and pass `cover: <med_ id>` (JPEG/PNG ≤2MB). Not available for Shorts.
4. Scheduled longform uploads go up private and flip public at the scheduled time — that's normal.
5. Metadata updates on published videos: `update_youtube_metadata`.

## Judgment rules

- Title under ~70 characters so it doesn't truncate in search; front-load the hook.
- Description: first 2 lines carry the pitch (what shows before "more"); links and chapters after. CTA links come from the brand pack.
- Tags are low-impact on YouTube — a handful of accurate ones beats twenty speculative ones.
- **Never publish with a placeholder title like "Final_v3.mp4". If the title looks like a filename, stop and ask.**
- Description and tags strongly recommended — ask the human if missing rather than inventing SEO copy.
- `madeForKids` stays false unless the human says otherwise — setting it true permanently disables comments and notifications.

## Verification

`create_post` returns a post id; check `get_post` — status, title, and target account all correct. Failed publish → `retry_post` once, then report.
