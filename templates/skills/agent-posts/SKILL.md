---
name: agent-posts
description: CreatorOS Agent Posts. Drop a finished vertical video and the agent transcribes it, pulls the "comment X" keyword, writes platform captions, generates a branded 9:16 cover, books the next free 3pm/6pm/9pm/12am ET slot, schedules it to every connected social through CreatorOS, and arms the comment-to-DM funnel. Use when a user uploads a video to post, asks to schedule agent posts, fix a cover or title, or fire the next post now.
---

# Agent Posts

## FIRST RUN: make sure the CreatorOS API key is in place

Agent Posts runs on the same CreatorOS API key Midas onboarding collects. It is
saved in `~/.midas/credentials.json` (or given as `CREATOROS_API_KEY`), and the
scripts here pick it up automatically through `scripts/lib/creatoros-key.js`.
Never write the key into a repo file.

Run the check first, from the workspace root:

```bash
node midas/skills/agent-posts/scripts/check-setup.mjs
```

It exits non-zero until a key is found, then verifies the key live against
CreatorOS and lists the connected socials. If it reports that no key is present,
say this to the user before doing anything else:

> To run Agent Posts you need your CreatorOS API key. Get it at
> **https://www.creatoros.ca/** (Settings -> API key), or in the CreatorOS iOS
> app under Settings -> API Key. That key is what connects your social accounts
> to the agent and sets up the comment-to-DM funnel, so without it nothing can be
> scheduled and "comment the word X" replies will not fire. Run
> `npm start creatoros midas` and paste it into onboarding (or export it as
> `CREATOROS_API_KEY`), then rerun the check.

Do not try to schedule, generate covers, or arm DM funnels before the check
passes. When the key works but nothing is connected, walk the user through
connecting socials at creatoros.ca (each connected profile becomes an Agent
Posts target) and enabling the comment-to-DM funnel on the same page. The
pipeline reads the connected profiles through `references/src/lib/agent-posts/targets.ts`.

The rest of the pipeline needs its own infrastructure: a Postgres database
(`DATABASE_URL`), Insforge media storage, the Ollama LLM gateway, fal for covers,
and local Whisper. `references/ENV_VARS.txt` lists every variable; the check
names the missing ones. Those go in a `.env.local` next to the desk app, never
in this repo.

## Pipeline (see references/WORKFLOW.md for the full walkthrough)

1. Upload on `/dashboard/agent-posts` -> one `agent_posts` row per profile.
2. Drain every 10 s: download -> generate (transcript, keyword, hook lines, cover)
   -> caption -> slot -> schedule via the CreatorOS posting client -> comment-DM setup.
3. Webhook flips the row live and arms the funnel.

## Commands

Run from the workspace root; `S=midas/skills/agent-posts/scripts`.

```bash
node $S/check-setup.mjs                                        # onboarding check
node --env-file=.env.local $S/publish-agent-post-now.mjs       # fire the next queued post now
node --env-file=.env.local $S/fix-agent-post-title.mjs <id> "<title>" --wait
node --env-file=.env.local $S/fix-agent-post-cover.mjs <id...> <cover.png>
# regenerate a cover locally (fal gated by FAL_ALLOW=kevbuildsapps,video-thumbnail)
node $S/vertical-video-thumbnail/scripts/generate.mjs --video <mp4> --out <png> --pose-index N --keyword X
```

`--env-file=.env.local` is only for the pipeline's own variables (database,
storage, LLM, fal). The CreatorOS key does not need to be in that file.

## YouTube leg (no DMs on YouTube)

YouTube cannot receive the DM, so the pipeline embeds the resource link in the
video description at schedule time (`youtube.ts` `withResourceLinks`) and
answers any "comment KEYWORD" comment on the YouTube leg with a public reply:
"the link is in this video's description". Fed by the CreatorOS comment webhook
and a 5-minute inbox poll over the last 14 days of agent posts. Replies are
logged in `comment_events` (platform youtube) and never sent twice.

## Rules

- The platform is CreatorOS. Never repeat internal vendor names from the
  reference source or error messages to the user.
- Never a chin-rest, pointing-at-camera grin, or prayer-hands cover pose. The bank
  in `generate.mjs` is the only source of poses; keep `THUMBNAIL_POSE_COUNT` in sync.
- Every post update to the posting API must echo `mediaItems` (IG cover rides there).
- CTA keyword fixes touch three layers: `agent_posts`, the scheduled post, `comment_dm_setups`.
- Dates are ET. Slots: 15/18/21/0 ET, 4 per day per account, 45-minute stagger.
- Eyeball every cover's hook lines and keyword spelling before it goes out.
- Whenever a new video lands, confirm the funnel keyword and DM copy with the
  human before it is armed (Midas ground rule: the DM goes to strangers).

## Layout

```
agent-posts/
  SKILL.md                         this file (onboarding + rules + commands)
  scripts/check-setup.mjs          first-run check: CreatorOS key -> live verify -> connected socials
  scripts/lib/creatoros-key.js     resolves the key from Midas credentials / env, never from a repo file
  scripts/publish-agent-post-now.mjs, fix-agent-post-title.mjs, fix-agent-post-cover.mjs
  scripts/vertical-video-thumbnail/   cover generator (generate.mjs, caption.mjs, identity refs)
  scripts/lib/fal-gate.js, llm.js  fal allow-list guard + LLM gateway
  references/WORKFLOW.md           end-to-end walkthrough of the pipeline
  references/src/                  the pipeline source (lib/agent-posts, API route, desk UI, posting client, comment-DM)
  references/schema.sql, ENV_VARS.txt, package.json, nixpacks.toml, railway.json
```

This skill is installed into `midas/skills/agent-posts/` at onboarding, like
every other Midas playbook. The pipeline source under `references/src` is
dropped into a Next.js app at the same paths when standing the desk up.
