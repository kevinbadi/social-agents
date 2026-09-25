---
name: agent-posts
description: Agent Posts. Hand Social Agents a finished vertical video and it transcribes it, pulls the "comment X" keyword, writes on-brand captions for every platform, builds a 9:16 cover, schedules the post to every connected social through CreatorOS, verifies it, and (with sign-off) arms the comment-to-DM funnel. Use when a user drops a video to post, asks to schedule agent posts, fix a cover or title, or publish now.
---

# Agent Posts

Everything goes through your CreatorOS tools. There is no database, no desk
app, and no hosted pipeline: CreatorOS holds the schedule (the user's post
history page shows it), the workspace holds the brand, and two local scripts
do the mechanical work (transcript, cover). You are the writer.

## Before anything

1. `node social-agents/skills/agent-posts/scripts/check-setup.mjs` — key, connected socials, ffmpeg, whisper. Fix the ✗ items before continuing. On the first run, if it reports no key, tell the user to get a `cos_live_` key at https://www.creatoros.ca/ (Settings, API keys) or run `npx @creatoros/cli init`, then re-run.
2. Read `social-agents/BRAND.md` (no brand pack yet -> run the brand-interview skill first), `social-agents/PROFILES.md` (which networks are connected; take the `acc_` ids from a fresh `list_accounts`, the saved ones can be re-issued), `social-agents/social-agents.json` (timezone).
3. Know the schedule-posts skill's timing schema cold. One mode per post: queue (`queuedFromProfile: true`), exact (`schedule_at` + `timezone`), or `draft: true`. None of them = publishes immediately.

## The pipeline, one video

`S=social-agents/skills/agent-posts/scripts/vertical-video-thumbnail/scripts`

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
5. **Cover.** `node $S/generate.mjs --video <mp4> --out <dir>/cover.png --transcript <dir>/narration.json --keyword X --line1 "…" --line2 "…"`. Default is a real frame from the video with the hook burned into the bottom plate. Generated scenes need `FAL_KEY`, `FAL_ALLOW=video-thumbnail`, and two or more photos of the creator in `social-agents/assets/identity/` (optional `identity.txt` describing them). Look at the cover before posting: hook spelling, keyword, nothing cut off in the 3:4 grid window.
6. **Upload.** `upload_media` the video, then the cover. Keep both `med_` ids.
7. **TikTok constraints.** `tiktok_creator_info` for each TikTok account. Privacy level and interaction settings go in the top-level `tiktok` object; CreatorOS sets the consent flags.
8. **Post.** One `create_post` across every shortform-capable account in PROFILES.md (TikTok, Instagram, YouTube, X, Threads, Facebook, LinkedIn as connected), advanced form so each network gets its own caption: `targets: [{ platform, account_id, content: <that network's caption>, options }]` (YouTube `options: { title }`), `media: [<video med_ id>]`, `cover: <cover med_ id>`, root `content` = the IG caption. Timing, in order of preference: `queuedFromProfile: true` (cadence lives in the user's CreatorOS queue: the posting frequency is theirs to set in the app, never compute slots yourself), an exact `schedule_at` + `timezone` when the user names a time, no timing at all only when they say "post it now".
9. **Verify.** `get_post`: status must be `scheduled` or `published`, never `draft`; every network present under `platforms`, no errors. Report the per-network result and the scheduled time.
10. **Funnel (Instagram, Facebook).** After confirmation in step 4, `create_funnel` per IG/FB account: `accountId`, `keywords: [X]`, the DM text, the comment reply, `link` from BRAND.md, and `platformPostId` once `get_post` shows the network's post id (published posts); before publish, scope account-wide and note it. Verify with `list_funnels`.
11. **Ledger.** Append a line to `content-library/POSTED.md`: date, file, post id, keyword, platforms.

The YouTube leg answers "comment X" comments with a public reply pointing at the description, through the respond-to-comments skill; there is no DM on YouTube.

## Fixes after scheduling

- Retitle / redescribe YouTube: `update_youtube_metadata`.
- Caption or time change on a scheduled post: `update_post` (`content`, `scheduledFor` + `timezone`).
- New cover or new media: `update_post` can't change them. Regenerate with `--line1/--line2` (or `--scene-grid <existing scene png>` to re-burn text only), `upload_media`, then `delete_post` and `create_post` again with the new `cover` (confirm with the human: it is a delete).
- Keyword fix touches three places: the captions (`update_post`), the funnel (`update_funnel`), and your report.
- Publish now: delete the scheduled post and `create_post` again with no `schedule_at`; verify with `get_post`.

## Judgment rules

- Never invent an offer or a link; no link in BRAND.md means no CTA to it.
- Never a cover with a chin-rest, pointing-at-camera grin, or prayer-hands pose (the pose bank in generate.mjs is the only source of poses).
- Eyeball every cover's hook lines and keyword spelling before it goes out.
- One upload, one create_post, every network. Per-network captions ride on each target's `content`, not separate calls.
- The platform is CreatorOS. Never repeat internal vendor names to the user.
- Report like an operator: post id, platforms, scheduled time, funnel state, what still needs the human.

## Layout

```
agent-posts/
  SKILL.md                                   this playbook
  scripts/check-setup.mjs                    key -> live verify -> socials -> ffmpeg / whisper / fal
  scripts/lib/creatoros-key.js               resolves the key from Social Agents credentials or env, never a repo file
  scripts/lib/fal-gate.cjs                    fal spend is opt-in (FAL_ALLOW)
  scripts/vertical-video-thumbnail/          generate.mjs (transcript + cover), caption.mjs (draft helpers), assets/style-ref.png
```

Optional env: `WHISPER_MODEL` (default base.en), `FAL_KEY` + `FAL_ALLOW=video-thumbnail`, `AGENT_POSTS_IDENTITY_DIR`.
