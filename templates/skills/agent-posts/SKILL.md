---
name: agent-posts
description: Agent Posts. Hand Midas a finished vertical video and it transcribes it, pulls the "comment X" keyword, writes on-brand captions for every platform, builds a 9:16 cover, schedules the post to every connected social through CreatorOS, verifies it, and (with sign-off) arms the comment-to-DM funnel. Use when a user drops a video to post, asks to schedule agent posts, fix a cover or title, or publish now.
---

# Agent Posts

Everything goes through your CreatorOS tools. There is no database, no desk
app, and no hosted pipeline: CreatorOS holds the schedule (the user's post
history page shows it), the workspace holds the brand, and two local scripts
do the mechanical work (transcript, cover). You are the writer.

## Before anything

1. `node midas/skills/agent-posts/scripts/check-setup.mjs` — key, connected socials, ffmpeg, whisper. Fix the ✗ items before continuing. On the first run, if it reports no key, tell the user to get it at https://www.creatoros.ca/ (Settings -> API key) and re-run onboarding.
2. Read `midas/BRAND.md` (no brand pack yet -> run the brand-interview skill first), `midas/PROFILES.md` (account IDs), `midas/midas.json` (timezone, profileId).
3. Know the schedule-posts skill's scheduling schema cold. One mode per post: queue (`queuedFromProfile`), exact (`scheduledFor` + `timezone`), or `publishNow`. None = draft.

## The pipeline, one video

`S=midas/skills/agent-posts/scripts/vertical-video-thumbnail/scripts`

1. **Transcribe.** `node $S/generate.mjs --video <mp4> --out <dir>/cover.png --caption-only` writes `<dir>/narration.json` (the transcript) and a heuristic caption draft. If the video has no spoken CTA, add `--no-cta`. Treat the draft as raw material only.
2. **Keyword.** From the transcript, find the spoken "comment the word X". Whisper mishears brand words: read it back to the user and confirm the exact spelling. No spoken CTA -> ask whether they want one; if not, the post ships without a funnel.
3. **Write from the brand pack.** Per platform, in the brand voice, CTA link from BRAND.md offers only:
   - Instagram / TikTok / Facebook caption: first line is the comment CTA (`Comment "X" to get …`), blank line, the spoken content cleaned into short paragraphs, hashtags per the hashtag policy on the last line. Strip the spoken "comment X, I'll DM you" outro; the first line already is the CTA.
   - Threads: the same, fitted under 500 characters.
   - X: under 280, or a native thread via `threadItems` if the content earns it.
   - YouTube: title (<= 100 chars) + description. YouTube has no DMs, so the resource link goes IN the description and the CTA line becomes "link in the description".
   - LinkedIn: no hashtag spam, professional framing of the same content.
   - Two ALL-CAPS hook lines for the cover (kicker + payoff, ~4 words each). No em or en dashes anywhere in overlay or captions.
   - DM text for the funnel (<= 640 chars, one link) and a short public comment reply.
4. **Confirm with the human before anything is built:** keyword spelling, hook lines, DM copy, comment reply. This is a ground rule: the DM goes to strangers.
5. **Cover.** `node $S/generate.mjs --video <mp4> --out <dir>/cover.png --transcript <dir>/narration.json --keyword X --line1 "…" --line2 "…"`. Default is a real frame from the video with the hook burned into the bottom plate. Generated scenes need `FAL_KEY`, `FAL_ALLOW=video-thumbnail`, and two or more photos of the creator in `midas/assets/identity/` (optional `identity.txt` describing them). Look at the cover before posting: hook spelling, keyword, nothing cut off in the 3:4 grid window.
6. **Upload.** `upload_media` the video, then the cover. Keep both URLs.
7. **TikTok constraints.** `tiktok_creator_info` for each TikTok account: privacy level and consent flags go in that platform entry's `platformSpecificData`.
8. **Post.** One `create_post` across every shortform-capable account in PROFILES.md (TikTok, Instagram, YouTube, X, Threads, Facebook, LinkedIn as connected): `mediaItems: [{ type: "video", url, thumbnail: <cover url> }]`, root `content` = the IG caption, per-platform `customContent` for Threads/X/YouTube/LinkedIn, YouTube title in `platformSpecificData`. Scheduling, in order of preference: `queuedFromProfile: <profileId>` (cadence lives in the user's CreatorOS queue — the posting frequency is theirs to set in the app, never compute slots yourself), an exact `scheduledFor` + `timezone` when the user names a time, `publishNow` when they say now.
9. **Verify.** `get_post` — status must be `scheduled`, `queued`, or `published`, never `draft`; every platform present, no errors. Report the per-platform result and the scheduled time.
10. **Funnel (Instagram, Facebook).** After confirmation in step 4, `create_funnel` per IG/FB account: `keywords: [X]`, the DM text, the comment reply, `link` from BRAND.md, `postId` = the CreatorOS post id and `platformPostId` once `get_post` shows it (published posts); before publish, scope account-wide and note it. Verify with `list_funnels`.
11. **Ledger.** Append a line to `content-library/POSTED.md`: date, file, post id, keyword, platforms.

The YouTube leg answers "comment X" comments with a public reply pointing at the description, through the respond-to-comments skill; there is no DM on YouTube.

## Fixes after scheduling

- Retitle / redescribe YouTube: `update_youtube_metadata`.
- Any other change to a scheduled post: `update_post`. ALWAYS echo the full `mediaItems` (with the cover `thumbnail`) in the body or the Instagram cover is dropped.
- New cover: regenerate with `--line1/--line2` (or `--scene-grid <existing scene png>` to re-burn text only), `upload_media`, then `update_post` with the new thumbnail in `mediaItems`.
- Keyword fix touches three places: the captions (`update_post`), the funnel (`update_funnel`), and your report.
- Publish now: `update_post` with `publishNow: true`, or delete and recreate if the API refuses; verify with `get_post`.

## Judgment rules

- Never invent an offer or a link; no link in BRAND.md means no CTA to it.
- Never a cover with a chin-rest, pointing-at-camera grin, or prayer-hands pose (the pose bank in generate.mjs is the only source of poses).
- Eyeball every cover's hook lines and keyword spelling before it goes out.
- One upload, one create_post, every platform. Separate calls only when captions genuinely differ beyond `customContent`.
- The platform is CreatorOS. Never repeat internal vendor names to the user.
- Report like an operator: post id, platforms, scheduled time, funnel state, what still needs the human.

## Layout

```
agent-posts/
  SKILL.md                                   this playbook
  scripts/check-setup.mjs                    key -> live verify -> socials -> ffmpeg / whisper / fal
  scripts/lib/creatoros-key.js               resolves the key from Midas credentials or env, never a repo file
  scripts/lib/fal-gate.cjs                    fal spend is opt-in (FAL_ALLOW)
  scripts/vertical-video-thumbnail/          generate.mjs (transcript + cover), caption.mjs (draft helpers), assets/style-ref.png
```

Optional env: `WHISPER_MODEL` (default base.en), `FAL_KEY` + `FAL_ALLOW=video-thumbnail`, `AGENT_POSTS_IDENTITY_DIR`.
