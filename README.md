# Social Agents

**Social Agents are open-source marketing agents that run your entire social presence on [CreatorOS](https://www.creatoros.ca/).** CreatorOS is the service underneath: it holds your connected socials and does the actual posting, replying, and analytics. Social Agents are the agents that drive it. You sign up at [creatoros.ca](https://www.creatoros.ca/), connect your socials, copy your API key, and Social Agents take it from there: a two-question setup, then a team of agents that interviews you about your brand and posts, replies, reports, and automates on your behalf.

Social Agents' mission is simple: **hold your hand through setup, then make you autonomous.** Every client's setup is different, but everyone wants the same four things:

1. **Post content at scale with AI** — shortform, longform, carousels, threads, multiposting, scheduling
2. **Run it all on automations** — cron jobs on your Mac or an always-on cloud service
3. **Auto-reply to comments and messages** — on-brand, with sensitive stuff escalated to you
4. **Monitor analytics** — growth, best posts, competitor movement, one recommendation a week

The end state Social Agents drive toward: all four pillars on cron jobs — content posting itself, analytics checked and reported, comments and messages answered — fully autonomous, with you only reviewing what Social Agents surface.

## Quick start

```sh
# 1. Fork & clone. (No npm install needed — first start installs for you.)

# 2. All setup needs is your CreatorOS API key(s):
#    sign up at https://www.creatoros.ca/, connect your socials,
#    then Settings, API keys (cos_live_...). One key per set of socials.
#    Or run `npx @creatoros/cli init`: Social Agents picks that key up too.
#    No AI setup, no model keys.

# 3. Go.
npm start creatoros social-agents
```

**First run** asks: *Do you have a CreatorOS API key?* (yes/no), then *how many*, then each key (masked, validated live). **Each CreatorOS API key is one workspace: one set of connected socials, one brand.** Every key gets its own folder, `workspaces/<name>/` (named after its CreatorOS workspace), with its own profile map, config, skills, brand pack, logs, content library, and `CLAUDE.md` / `AGENTS.md` brief. Then the form tells you to go talk to your marketing agents. In each workspace they take it from there in chat: they interview you about the brand (`brand-interview` skill → `social-agents/BRAND.md`), ask where automations should live (local or a Railway worker they build for you), and offer the automation menu. Any AI agent opened in a workspace folder (Claude Code, Codex, Cursor...) reads its `CLAUDE.md` or `AGENTS.md`; the repo-root ones list the workspaces. Because setup lives in files, not in one chat, you can spin up as many parallel agent sessions as you like.

```
workspaces/
  creator-os-socials/          ← one CreatorOS API key
    social-agents/             BRAND.md · PROFILES.md · social-agents.json · skills/ · knowledge/
    content-library/  logs/  CLAUDE.md  AGENTS.md
  acme-fitness/                ← another key, fully separate
```

Keys never touch the repo: they're saved per workspace in `~/.social-agents/credentials.json`, and every session checks with CreatorOS that its key belongs to its workspace before doing anything, so one brand can never post as another. Add a key any time with `npm start creatoros add`.

For the agent chat itself you bring a brain: logged-in Claude Code (runs on your Claude plan, recommended), `ANTHROPIC_API_KEY`, or any model behind an Anthropic-compatible API (Moonshot/Kimi, DeepSeek, GLM…) — the built-in `social-agents` chat asks on first launch.

**Every later run** drops you into the Social Agents REPL for a workspace (asked when you have several; `npm start creatoros social-agents <workspace>` opens one directly):

```
you ▸ post this clip everywhere: content-library/day1.mp4
you ▸ how did last week do?
you ▸ set up the funnel on my launch post — keyword "GUIDE"
you ▸ schedule the week from content-library/
```

Everything Social Agents learn lives in each workspace's `social-agents/` (all of `workspaces/` is gitignored): `BRAND.md` (voice, links, audience — every caption flows from it), `PROFILES.md` (account IDs), `social-agents.json` (config), `skills/` (playbooks), `knowledge/` (competitor research, tutorials index).

## Dashboard

```bash
npm run dashboard    # → http://localhost:4180  (override: SOCIAL_AGENTS_DASHBOARD_PORT)
social-agents dashboard   # same thing, from anywhere (after `npm link`)
```

A local web dashboard for monitoring what your agents are *actually doing* — and verifying it's working — one workspace at a time: the sidebar switches between your workspaces, and every page shows only the selected one (API: `GET /api/workspaces`, then `?workspace=<slug>` on every call). Zero external services: it reads the workspace's files, its structured activity log (`logs/activity.jsonl`, one JSON line per action the agents take), and the CreatorOS API with your already-configured credentials. Missing credentials never crash it — you get a friendly connect state instead.

**Pages:** Overview (health strip, reply/DM/post counters, a GitHub-style year heatmap of agent activity, live feed) · Agent (full transparency into the agent's understanding: persona, objective, KPIs, what the account sells, comment/DM rules, and the literal system prompt it runs on) · Automations (every agentic workflow drawn n8n-style as trigger → action → outcome node chains — cloud funnels straight from the CreatorOS API with their real execution logs, local/Railway crons and auto-replies from the agent's log — each with an operating/armed/failing health badge and a live merged executions feed) · Brand (`social-agents/BRAND.md` rendered, edit-in-place) · Training (every workflow playbook with last-used-by-the-agent info, edit-in-place) · Logs (full filterable feed with raw JSON + real error payloads) · Chat (the same Social Agents as the terminal, streaming in the browser). Dark and light themes, persisted.

### The API under it

Every panel is fed by plain local JSON endpoints — build your own UI against them:

| Endpoint | What it returns |
|---|---|
| `GET /api/health` | credentials valid?, config files loaded, brain status, last action, staleness warning |
| `GET /api/activity` | log entries + counters + heatmap buckets (`?workflow=&platform=&outcome=&limit=`) |
| `GET /api/automations` | flows (n8n-style node chains, cloud + local, health per flow) + merged live executions |
| `GET /api/understanding` | the agent's mind: persona, objective + KPIs, offers, engagement rules, system prompt |
| `GET /api/brand` · `PUT /api/brand` | the brand file (`{path, mtime, content}`) / save edits to disk |
| `GET /api/workflows` · `PUT /api/workflows` | training files + per-file agent usage / save (`{id, content}`) |
| `POST /api/chat` | talk to the agent; streams NDJSON events (`init`/`text`/`tool`/`tool_result`/`done`) |

### How to add your own panel

A panel is one file in `dashboard/public/panels/` — no build step, just an ES module:

```js
// dashboard/public/panels/streak.js
export default {
  id: 'streak',
  title: 'Posting Streak',
  icon: '⚡',
  route: '/streak',
  fetchData: ({ api }) => api('/api/activity?limit=1'),
  render(root, data, { h, card }) {
    let streak = 0;
    const days = data.summary.heatmap;           // 365 × {date, count}
    for (let i = days.length - 1; i >= 0 && days[i].count > 0; i--) streak++;
    root.append(
      card('Current streak',
        h('div', { class: 'stat-value num' }, `${streak} days`),
        h('div', { class: 'stat-sub' }, 'consecutive days with agent activity'),
      ),
    );
  },
};
```

Then register it in `dashboard/public/panels/registry.js`:

```js
import streak from './streak.js';
export const panels = [overview, automations, brand, training, logs, chat, streak];
```

That's the whole integration — the shell gives you the sidebar entry, routing, the loading gate, and stale-while-revalidate caching for free. Style with the tokens in `dashboard/public/theme.css` (`.card-solid`, `.badge`, `.stat-value`…) and it will match both themes.

## Capability surface

Social Agents talk only to the [CreatorOS API](https://www.creatoros.ca/docs) (`/v1`, authenticated with your `cos_live_` key), through a typed client with an **endpoint allowlist enforced in code**, not prompt discipline. Anything outside this table returns "that endpoint isn't part of CreatorOS." A key is pinned to one CreatorOS workspace (one set of connected socials); IDs come back prefixed (`acc_`, `post_`, `med_`...) and are passed through untouched.

| Capability | What Social Agents can do |
|---|---|
| **Posting** | Shortform video (TikTok/Reels/Shorts in one call), longform YouTube (title/description/tags), carousels, text posts, native multi-part threads (X/Threads), one post across every network, video covers, scheduling (ISO 8601 + timezone: CreatorOS servers publish), your CreatorOS queue, drafts, edits, retry, unpublish, pre-publish validation, post-publish verification |
| **Media** | Upload once to CreatorOS, reuse the `med_` id across every network |
| **Analytics** | Follower growth, per-post performance, daily metrics, post timelines, best-time-to-post |
| **Comments** | List, triage, reply, like, hide. Facebook, Instagram, Twitter/X, Threads, YouTube, LinkedIn. *(TikTok comments aren't supported by CreatorOS; enforced in code.)* |
| **Messages** | DM replies: Twitter/X, Instagram, Facebook |
| **Funnels** | Comments-to-DM funnels (keyword → automatic DM with your link) on Instagram & Facebook, running on CreatorOS servers |
| **Webhooks** | Endpoints for real-time comment/message/post events, signed with `X-CreatorOS-Signature` |
| **Accounts** | List, health checks, a link to connect a new social |

**Hard blocks:** API-key management and disconnecting a social account are refused in the client itself with *"Manage your plan and API keys in the CreatorOS app."*

## Automations — the whole point

During onboarding you pick a pathway (stored as `automationTarget` in `social-agents/social-agents.json`):

- **Local (macOS)** — crons run as launchd agent services on your machine. Free, private, but the machine must be awake at scheduled times.
- **VPS (Railway)** — always-on cloud. The service needs `CREATOROS_API_KEY` (your `cos_live_` key; `CREATOROS_API_URL` only if CreatorOS tells you the API moved) and `ANTHROPIC_API_KEY` set, and — this matters — **set a spend limit in the Anthropic Console (console.anthropic.com → Billing → Limits) *before* deploying.** The service runs an agent unattended; an uncapped key is an uncapped bill. Social Agents will repeat this warning every time a deploy comes up. That's on purpose.

Starter crons (onboarding sets up **zero** automations by design — your agent offers these in chat, one per pillar, and configures only what you approve):

| Cron | Schedule | What happens |
|---|---|---|
| `daily-shortform` | daily 10:00 | next clip from `content-library/` → captioned from the brand pack → TikTok + Reels + Shorts |
| `weekly-calendar` | Sun 17:00 | plan and schedule the coming week (servers publish; laptop can sleep) |
| `engagement-sweep` | 9:00/15:00/21:00 | triage comments & DMs, reply on-brand, escalate the sensitive ones |
| `weekly-analytics` | Mon 8:00 | growth, best posts, competitor movement, one recommendation |

Note: plain scheduled *posts* need no cron at all — scheduled publishing happens on CreatorOS servers.

### Agent Posts

The `agent-posts` skill is the drop-a-video pipeline, and it runs entirely through the agent's CreatorOS tools — no database, no hosted service. Hand Social Agents a finished vertical video and it transcribes it locally (whisper), pulls the spoken "comment X" keyword, writes on-brand captions for every platform from `BRAND.md`, builds a 9:16 cover (a real frame by default, a generated scene if you opt into fal with your own identity photos), uploads once, and schedules one post to every connected social. Cadence is your CreatorOS queue: the agent posts in queue mode and never computes slots itself, so posting frequency is whatever you set in the app, and your post history page is the schedule. With your sign-off it arms the comment-to-DM funnel on Instagram and Facebook. `node social-agents/skills/agent-posts/scripts/check-setup.mjs` verifies the key, the connected socials, ffmpeg, and whisper.

## Teaching Social Agents new patterns

`social-agents/knowledge/TUTORIALS.md` is an index of KevBuildsApps YouTube tutorials. Before building an automation pattern Social Agents hasn't built before, it checks the index, fetches the tutorial, and follows the taught pattern. **Adding a tutorial is a one-line edit:**

```md
- [Title](https://youtube.com/watch?v=...) — what it teaches
```

## Development

```sh
npm test          # vitest: routing, allowlist, hard blocks, platform matrix,
                  # interview resume, funnel generation, pathway selection
npm run typecheck
```

Layout: `src/` (harness, client, agent, tools), `templates/` (skill playbooks installed into `social-agents/skills/` at onboarding), `tests/`.

Security notes: your API key is never written into any repo file. It is read from the `CREATOROS_API_KEY` env var, then `~/.social-agents/credentials.json` (mode 0600), then `~/.creatoros/config.json` (written by `npx @creatoros/cli init`), and appears in logs only as `cos_live_...last4`. Keys from before CreatorOS had its own API (`sk_...`) no longer work: get a new one at creatoros.ca under Settings, API keys.

MIT. PRs welcome.
