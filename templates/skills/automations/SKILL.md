# automations

Set up hands-off systems. Two kinds, and picking the right one matters:

1. **CreatorOS cloud automations** (run on CreatorOS servers): comment-to-DM funnels. Deterministic if-this-then-that — keyword comment → DM with link/offer. Tools: `create_funnel`, `list_funnels`, `update_funnel`, `delete_funnel`, `funnel_logs`. The full playbook (per-post vs account-wide scoping, swapping funnels, daily log checks) is the `comment-dm-funnel` skill — use it for anything beyond a quick create.
2. **Scheduled agent runs** (cron): a full agent executes a Social Agents skill on a schedule — judgment work like triaging comments, picking the day's clip, writing the weekly report. Tools: `create_cron_automation`, `list_cron_automations`. The pathway comes from `social-agents/social-agents.json` (`automationTarget`): `local` = launchd on this machine (must be awake at the scheduled time), `railway` = always-on cloud.

Plain scheduled *posts* need neither — `create_post` with `scheduledFor` publishes from CreatorOS servers.

## Before anything

Read `social-agents/social-agents.json` for the pathway and timezone; `social-agents/BRAND.md` for funnel links and copy. Before building a pattern you haven't built before, check `social-agents/knowledge/TUTORIALS.md` and follow the taught pattern.

## Procedure — comment-to-DM funnel

1. Capture: trigger keyword(s), the DM message + link (pull the link from the brand pack's product links), scope (one post vs account-wide), and which IG/FB account.
2. **Confirm the exact keyword(s) and DM copy with the human before creating — the DM goes out automatically to strangers.**
3. `create_funnel`. Funnels are Instagram/Facebook only (enforced in code). One active per-post funnel per post; account-wide funnels stack.
4. Verify with `list_funnels`; after the first trigger, check `funnel_logs`.
5. Re-offer the funnel every time new content is uploaded.

## Procedure — scheduled agent run

1. Understand the client's pipeline first ("library of 100 videos" vs "generate for me") and make sure scheduled runs have zero judgment gaps: `content-library/` stocked, caption rules in BRAND.md, the skill's prerequisites met.
2. Confirm schedule and timezone with the human — "9am" means *their* timezone; the cron runs in the machine/service timezone.
3. `create_cron_automation` with a strict 5-field cron (no MON/JAN names). Starter set: daily-shortform (content), weekly-calendar (calendar), engagement-sweep (engagement), weekly-analytics (analytics).
4. Verify with `list_cron_automations`; on macOS `launchctl list | grep com.creatoros` confirms it's loaded. Tell the user in plain language what will happen and when.

## Judgment rules

- Prefer cloud funnels for trigger→action; save agent runs for judgment work. Servers beat laptops for reliability — on `local`, remind the human the machine must be awake.
- Railway pathway: the service needs CREATOROS_API_KEY and an AI credential set as variables (provisioning handles this). Never lecture the user about spend limits or API billing — they know how their credentials work.
- Local agent runs execute unattended in this workspace — the human should understand that. Say so when creating one.
- Never create an automation that posts unreviewed generated content unless the human explicitly opted into that.

## Verification

`list_cron_automations` / `list_funnels` after creating; check logs after the first run/trigger. Confirm to the user: what runs, when, on which pathway, and what they'll see from it.
