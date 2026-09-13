# Midas

**Midas is an open-source agentic harness for [CreatorOS](https://creatoros.app) — it runs your entire social presence.** You subscribe in the CreatorOS iOS app, connect your socials, grab your API key, and Midas takes it from there: an onboarding interview that captures your brand, then an agent that posts, replies, reports, and automates on your behalf.

Midas's mission is simple: **hold your hand through setup, then make you autonomous.** Every client's setup is different, but everyone wants the same four things:

1. **Post content at scale with AI** — shortform, longform, carousels, threads, multiposting, scheduling
2. **Run it all on automations** — cron jobs on your Mac or an always-on cloud service
3. **Auto-reply to comments and messages** — on-brand, with sensitive stuff escalated to you
4. **Monitor analytics** — growth, best posts, competitor movement, one recommendation a week

The end state Midas drives toward: all four pillars on cron jobs — content posting itself, analytics checked and reported, comments and messages answered — fully autonomous, with you only reviewing what Midas surfaces.

## Quick start

```sh
# 1. Fork & clone. (No npm install needed — first start installs for you.)

# 2. All the form needs is your CreatorOS API key
#    (CreatorOS iOS app → Settings → API Key, sk_...).
#    No AI setup, no model keys — two questions and you're in.

# 3. Go.
npm start creatoros midas
```

**First run** is a two-question form: creator or agency, then your CreatorOS API key (masked, validated live). It maps your connected accounts into `midas/PROFILES.md`, writes the workspace (`CLAUDE.md` at the root plus `midas/`), and tells you to go talk to your marketing agent. The agent takes it from there in chat: it interviews you about your brand (`brand-interview` skill → `midas/BRAND.md`), asks where automations should live (local or a Railway worker it builds for you), and offers the automation menu. Any agent opened in this folder reads `CLAUDE.md` and picks up the same brief; `midas/SETUP_PROMPT.md` holds it as a paste-able prompt. Because setup lives in files, not in one chat, you can spin up as many parallel agent sessions as you like.

For the agent chat itself you bring a brain: logged-in Claude Code (runs on your Claude plan, recommended), `ANTHROPIC_API_KEY`, or any model behind an Anthropic-compatible API (Moonshot/Kimi, DeepSeek, GLM…) — the built-in `midas` chat asks on first launch.

**Every later run** drops you into the Midas REPL:

```
you ▸ post this clip everywhere: content-library/day1.mp4
you ▸ how did last week do?
you ▸ set up the funnel on my launch post — keyword "GUIDE"
you ▸ schedule the week from content-library/
```

Everything Midas learns lives in `midas/` (gitignored): `BRAND.md` (voice, links, audience — every caption flows from it), `PROFILES.md` (account IDs), `midas.json` (config), `skills/` (playbooks), `knowledge/` (competitor research, tutorials index).

## Dashboard

```bash
npm run dashboard    # → http://localhost:4180  (override: MIDAS_DASHBOARD_PORT)
midas dashboard        # same thing, from anywhere (after `npm link`)
```

A local web dashboard for monitoring what your agent is *actually doing* — and verifying it's working. Zero external services: it reads this repo's files, the agent's structured activity log (`logs/activity.jsonl`, one JSON line per action the agent takes), and the CreatorOS API with your already-configured credentials. Missing credentials never crash it — you get a friendly connect state instead.

**Pages:** Overview (health strip, reply/DM/post counters, a GitHub-style year heatmap of agent activity, live feed) · Agent (full transparency into the agent's understanding: persona, objective, KPIs, what the account sells, comment/DM rules, and the literal system prompt it runs on) · Automations (every agentic workflow drawn n8n-style as trigger → action → outcome node chains — cloud funnels straight from the CreatorOS API with their real execution logs, local/Railway crons and auto-replies from the agent's log — each with an operating/armed/failing health badge and a live merged executions feed) · Brand (`midas/BRAND.md` rendered, edit-in-place) · Training (every workflow playbook with last-used-by-the-agent info, edit-in-place) · Logs (full filterable feed with raw JSON + real error payloads) · Chat (the same Midas as the terminal, streaming in the browser). Dark and light themes, persisted.

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

Midas talks to CreatorOS through a typed client with an **endpoint allowlist enforced in code** — not prompt discipline. Anything outside this table returns "that endpoint isn't part of CreatorOS."

| Capability | What Midas can do |
|---|---|
| **Posting** | Shortform video (TikTok/Reels/Shorts in one call), longform YouTube (title/description/tags), carousels, text posts, native multi-part threads (X/Threads/Bluesky), multiposting across account IDs, scheduling (ISO 8601 + timezone — CreatorOS servers publish), drafts, retry, pre-publish validation, post-publish verification |
| **Media** | Upload once (up to 5 GB), reuse the URL across every platform |
| **Analytics** | Follower growth, per-post performance, daily metrics, best-time-to-post |
| **Comments** | List, triage, reply, like — Facebook, Instagram, Twitter/X, Bluesky, Threads, Reddit, YouTube, LinkedIn. *(TikTok comments aren't supported by CreatorOS — enforced in code.)* |
| **Messages** | DM replies — Twitter/X, Instagram, Facebook, Reddit, Bluesky, Telegram, WhatsApp |
| **Funnels** | Comments-to-DM funnels (keyword → automatic DM with tracked link) on Instagram & Facebook, with click stats |
| **Webhooks** | Subscriptions for real-time comment/message/post events, HMAC-verified |
| **Accounts & profiles** | List, health checks, read/update — never create/delete |

**Hard blocks:** profile creation/deletion, phone-number purchasing, and API-key management are refused in the client itself with *"Manage your plan in the CreatorOS app."* — even though the API would accept some of them. They bill or break things that belong to your subscription.

## Automations — the whole point

During onboarding you pick a pathway (stored as `automationTarget` in `midas/midas.json`):

- **Local (macOS)** — crons run as launchd agent services on your machine. Free, private, but the machine must be awake at scheduled times.
- **VPS (Railway)** — always-on cloud. The service needs `CREATOROS_API_KEY` and `ANTHROPIC_API_KEY` set, and — this matters — **set a spend limit in the Anthropic Console (console.anthropic.com → Billing → Limits) *before* deploying.** The service runs an agent unattended; an uncapped key is an uncapped bill. Midas will repeat this warning every time a deploy comes up. That's on purpose.

Starter crons (onboarding sets up **zero** automations by design — your agent offers these in chat, one per pillar, and configures only what you approve):

| Cron | Schedule | What happens |
|---|---|---|
| `daily-shortform` | daily 10:00 | next clip from `content-library/` → captioned from the brand pack → TikTok + Reels + Shorts |
| `weekly-calendar` | Sun 17:00 | plan and schedule the coming week (servers publish; laptop can sleep) |
| `engagement-sweep` | 9:00/15:00/21:00 | triage comments & DMs, reply on-brand, escalate the sensitive ones |
| `weekly-analytics` | Mon 8:00 | growth, best posts, competitor movement, one recommendation |

Note: plain scheduled *posts* need no cron at all — scheduled publishing happens on CreatorOS servers.

### Agent Posts

The `agent-posts` skill is the drop-a-video pipeline, and it runs entirely through the agent's CreatorOS tools — no database, no hosted service. Hand Midas a finished vertical video and it transcribes it locally (whisper), pulls the spoken "comment X" keyword, writes on-brand captions for every platform from `BRAND.md`, builds a 9:16 cover (a real frame by default, a generated scene if you opt into fal with your own identity photos), uploads once, and schedules one post to every connected social. Cadence is your CreatorOS queue: the agent posts in queue mode and never computes slots itself, so posting frequency is whatever you set in the app, and your post history page is the schedule. With your sign-off it arms the comment-to-DM funnel on Instagram and Facebook. `node midas/skills/agent-posts/scripts/check-setup.mjs` verifies the key, the connected socials, ffmpeg, and whisper.

## Teaching Midas new patterns

`midas/knowledge/TUTORIALS.md` is an index of KevBuildsApps YouTube tutorials. Before building an automation pattern Midas hasn't built before, it checks the index, fetches the tutorial, and follows the taught pattern. **Adding a tutorial is a one-line edit:**

```md
- [Title](https://youtube.com/watch?v=...) — what it teaches
```

## Development

```sh
npm test          # vitest: routing, allowlist, hard blocks, platform matrix,
                  # interview resume, funnel generation, pathway selection
npm run typecheck
```

Layout: `src/` (harness, client, agent, tools), `templates/` (skill playbooks installed into `midas/skills/` at onboarding), `tests/`.

Security notes: your API key is never written into any repo file (it lives in `~/.midas/credentials.json`, mode 0600, or the `CREATOROS_API_KEY` env var) and appears in logs only as `sk_...last4`.

MIT. PRs welcome.
