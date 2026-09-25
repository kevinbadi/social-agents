# brand-interview

The brand pack is the one file every caption, description, and CTA flows from. Onboarding does not collect it — you do, in chat, where you can follow up. Run this the moment `social-agents/BRAND.md` is missing, before anything else.

## How to run it

One question at a time. Wait for the answer, reflect it back in a line, then move on. Never batch the questions into a form, never fill in guesses. If an answer is thin, ask one follow-up, then move on. Eight questions, about five minutes:

1. **About** — "What is this brand actually about? What are you marketing?"
2. **Offers** — "What do you sell, and where does each thing live?" One offer per line: link + what it is. No link yet is fine; note it as such. Every CTA you ever write points at one of these.
3. **Voice, three adjectives** — "Your voice in three adjectives."
4. **Voice, one never** — "One thing my copy should never sound like." (corporate, thirsty, salesy…)
5. **Emoji policy** — none / sparingly (max one per caption) / free, part of the voice.
6. **Hashtag policy** — none / a few relevant ones (2-4) / aggressive.
7. **Audience** — "Target audience in one sentence."
8. **Competitors** — up to five handles or URLs to watch. Empty is fine.

Agency mode: this is the CLIENT's brand, not the agency's. Ask in those terms.

## Write the file

Write `social-agents/BRAND.md` in exactly this shape, then read it back and ask for sign-off. Edit on request; the latest file always wins.

```md
# Brand Pack

Social Agents reads this before writing anything. Every caption, description, and
CTA flows from here. Edit freely — Social Agents always uses the latest version.

## What this brand is about

<about>

## What we sell — products, services & CTA destinations

- <what it is> — <link>
- <what it is> _(no link yet)_

## Voice

- Sounds like: <adj>, <adj>, <adj>
- Never: <never>
- Emoji policy: <policy>
- Hashtag policy: <policy>

## Target audience

<audience>

## Competitors to watch

- <handle or URL>

Research findings live in `knowledge/COMPETITORS.md` — ask Social Agents to refresh them any time.
```

## After sign-off

- If competitors were named, research them (content mix, cadence, hooks, gaps) and write `social-agents/knowledge/COMPETITORS.md`.
- Then the infrastructure question: where should automations live — local (this machine, awake at scheduled times) or a Railway worker you provision (`provision-railway` skill, from a Railway API token)? Save `automationTarget` and `timezone` to `social-agents/social-agents.json`. Local is a fine answer; never lecture on cost.
- Then the automation menu, one item at a time, only what they approve (`automations` skill).

## Judgment rules

- No captions, no posts, no funnels before BRAND.md exists and is signed off.
- Never invent an offer or a link. No link means no CTA to it.
- Keep it a conversation: short questions, plain text, no forms.
