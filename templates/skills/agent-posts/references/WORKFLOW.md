# Agent Posts workflow, complete export

Exported 2026-09-13 from the Creator OS dashboard repo (`creator-os/`). This bundle
contains every file the Agent Posts pipeline runs on, the cover-generation skill it
shells out to, the shared libs those depend on, the live database schema, the env
var list, and this walkthrough.

**Get your API key first.** Creator OS (https://www.creatoros.ca/) is the real
app that issues keys. Under the hood it creates a Zernio profile for each user and
issues them a profile-scoped Zernio API key; Zernio is the posting layer. This
export uses that key directly: `src/lib/zernio/client.ts` sends
`CREATOR_OS_API_KEY` as the Bearer, and `src/lib/agent-posts/targets.ts` treats
every profile the key can see as a posting target (`CREATOR_OS_PROFILE_ID` pins
one). Put the key in `.env.local`, then run `node scripts/check-setup.mjs`: it
verifies the key live, lists the connected socials, and tells the user to connect
accounts / enable the comment-to-DM funnel at creatoros.ca when nothing is
connected yet. See `SKILL.md` for the onboarding line the agent must say.

## What the workflow does

1. **Upload.** The user drops a finished vertical video on `/dashboard/agent-posts`
   (`AgentPostsDesk.tsx`, API `POST /api/agent-posts`). One `agent_posts` row is
   created per target social profile (`targets.ts`), status `queued`.
2. **Drain.** `run.ts` `drainAgentPosts()` runs every 10 seconds on the server
   (armed from `content/cron.ts` 8 s after boot, and on every GET of the page).
   Each queued row walks these steps:
   - `download` the master video from Insforge storage.
   - `generate` (`generate.ts` spawning the `vertical-video-thumbnail` skill):
     local Whisper transcript, keyword extraction (the spoken "comment the word X"),
     hook lines, and a 9:16 cover. Cover = fal scene from a 9-pose bank hashed per
     video (never chin-rest, never pointing grin, never prayer hands), fitted to the
     3:4 grid crop with pure ffmpeg, hook text burned on the bottom plate.
   - `caption` (`copy.ts`): platform captions (IG/TikTok/YouTube title +
     description/X/LinkedIn/Threads) plus the DM text and comment reply for the
     funnel, via the LLM gateway (`.claude/lib/llm.js`, DeepSeek through Ollama).
   - `slot` (`slots.ts`): next free slot on the 3pm / 6pm / 9pm / 12am ET grid,
     4 per day per account, 45-minute cross-profile stagger, whole-minute snapping.
   - `schedule`: Zernio `POST /posts` through `zernio/client.ts` with `mediaItems`
     carrying the IG cover (`thumbnail` + `instagramThumbnail`) and per-platform
     `customContent`. The Zernio post id lands on the row.
   - `comment_dm`: a `comment_dm_setups` row (keyword + DM message) is written and
     flushed by `comments/automations.ts` once the post is live, so "comment X"
     triggers the DM funnel.
   The second leg of an IG + TikTok pair reuses the sibling's cover and captions.
3. **Live.** The Zernio webhook (`api/zernio/webhook/route.ts`) flips status and
   arms the comment automation. `posts/status.ts` reads the rows back for the desk.

## Layout of this bundle

```
creator-os/
  src/lib/agent-posts/        pipeline: types, store, targets, generate, copy, slots, run
  src/app/api/agent-posts/    upload + list API route
  src/app/dashboard/agent-posts/page.tsx   the desk page
  src/components/AgentPostsDesk.tsx, ScheduledPostEditor.tsx, SocialAccounts.tsx, PageHeader.tsx
  src/lib/comments/           comment-to-DM automation + DM copy
  src/lib/posts/              status reader + scheduled-post editing
  src/lib/zernio/             the social posting client + types (all Zernio calls go here)
  src/lib/insforge/           Postgres pool + S3-style storage
  src/lib/channels/store.ts   active channel cookie + per-channel profile lookup
  src/lib/auth.ts             single-user password gate
  src/lib/content/cron.ts     boot timers (the agent-posts drain is armed at ~line 286)
  src/lib/twitter-caption.ts, src/lib/format.ts   helpers
  scripts/fix-agent-post-cover.mjs   swap a scheduled post's cover (Insforge + Zernio patch)
  scripts/fix-agent-post-title.mjs   retitle a scheduled post
  scripts/publish-agent-post-now.mjs "fire off the next cut sheet video" (20-min claim guard)
  .claude/skills/vertical-video-thumbnail/   SKILL.md, scripts/generate.mjs, scripts/caption.mjs, identity refs
  .claude/lib/fal-gate.js     fal allow-list guard (FAL_ALLOW must include video-thumbnail)
  .claude/lib/llm.js          LLM gateway (text + vision model routing)
  package.json, nixpacks.toml, railway.json
schema.sql        live dump: agent_posts, comment_dm_setups, publish_claims, channels, channel_profiles
ENV_VARS.txt      every process.env read by the files above
SKILL.md          installable skill wrapper + the onboarding line for new users
scripts/check-setup.mjs   first-run check: prints the creatoros.ca API key instruction
```

## Env vars

Copy `ENV_VARS.txt` into `.env.local`. The ones that matter:

| Var | Purpose |
|---|---|
| `CREATOR_OS_API_KEY` | your Creator OS key from https://www.creatoros.ca/ (a profile-scoped Zernio key: socials, posting, comment-to-DM funnel) |
| `CREATOR_OS_PROFILE_ID` | optional: pin one profile when the key sees several |
| `DATABASE_URL` | Postgres (Insforge). Strip `uselibpqcompat` for `pg`-based scripts |
| `INSFORGE_API_BASE_URL`, `INSFORGE_API_KEY` | media storage for masters and covers |
| `ZERNIO_API_KEY` | legacy master-key fallback for the original dashboard; not needed when `CREATOR_OS_API_KEY` is set |
| `ZERNIO_WEBHOOK_SECRET` | live-status webhook (register the webhook against the same key) |
| `OLLAMA_API_KEY`, `OLLAMA_TEXT_MODEL`, `OLLAMA_VISION_MODEL` | caption + keyword LLM gateway |
| `FAL_KEY`, `FAL_ALLOW=kevbuildsapps,video-thumbnail` | cover generation (gated) |
| `WHISPER_MODEL` | local transcript model (`base.en` default) |
| `APP_PASSWORD`, `APP_AUTH_SECRET` | dashboard login |

## Runtime requirements

Node 22+, ffmpeg on PATH (nixpacks keeps it in the Railway image), local Whisper,
Postgres. No Python is needed anywhere in this pipeline (the grid fit is pure ffmpeg).

## Operating notes that will bite you

- **Cover pose bank** lives in `generate.mjs` (`POSES`, 9 entries) and must match
  `THUMBNAIL_POSE_COUNT` in `src/lib/agent-posts/generate.ts`.
- **Every Zernio post update must echo `mediaItems`** or the IG cover is dropped.
- **CTA keyword spelling** must be fixed in three places: `agent_posts` text
  columns, the Zernio post (content + `customContent`), and `comment_dm_setups`.
- Whisper mishears brand words in CTAs. Eyeball the keyword and hook lines on every
  new post.
- Slot instants are snapped to whole minutes; the cross-profile stagger is 45 min.
- Avoid deploys at slot times; `publish_claims` guards double publishes.
