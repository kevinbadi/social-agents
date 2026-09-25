# comment-dm-funnel

Create, swap, and monitor comment-to-DM funnels: someone comments a keyword → they automatically get a DM with a link/offer. Instagram and Facebook only (enforced in code). The DM goes out to strangers with no human in the loop, so copy and keywords are always confirmed before going live.

## Before anything

Read `social-agents/BRAND.md` (product links, offer copy, voice), `social-agents/PROFILES.md` (profile + account IDs), and `social-agents/social-agents.json` (`funnel` block: standing keywords, match mode, scope). Never contradict them.

## Procedure — create a funnel

1. Capture the spec: trigger keyword(s), the DM message, the link (pull from the brand pack's product links — it becomes a tracked URL button), scope, and which IG/FB account.
2. Pick the scope deliberately:
   - **Per-post** — pass `platformPostId` + `postId`. One active funnel per post; right for a launch post or a "comment WORD for the guide" CTA.
   - **Account-wide** — omit both. These stack, so multiple can coexist with independent keyword sets; right for evergreen offers. Empty `keywords` matches EVERY comment — never do that without explicit human sign-off.
3. **Confirm the exact keyword(s) and DM copy with the human before creating.** Read the DM back verbatim.
4. `create_funnel`. Limits enforced in code: DM max 640 chars when a link button is attached; keywords non-empty; match mode defaults to `contains`.
5. Verify with `list_funnels` — the new funnel should appear with zeroed stats.

## Procedure — swap a funnel

To replace a funnel (new offer, new keyword, new post): for copy/keyword/pause changes on the same scope, prefer `update_funnel` (set `isActive: false` to pause). A true swap is delete-then-create:

1. `list_funnels` to find the old automation's ID and note its stats for the report.
2. **Confirm with the human** — `delete_funnel` is permanent and takes all its trigger logs with it. If the history matters, pull `funnel_logs` first and save the summary to the report.
3. `delete_funnel`, then create the replacement per the procedure above, then `list_funnels` to confirm exactly the intended funnels remain.

## Procedure — daily log check

Run on demand or as a cron (`create_cron_automation` with skill `comment-dm-funnel`; a daily 9am run works well):

1. `list_funnels` — capture per-funnel stats (`totalTriggered`, `totalSent`, `totalFailed`).
2. For each active funnel, `funnel_logs` with `status: "failed"` — failures are the signal. Then a plain pass for volume/who's commenting (paginated: `limit` defaults to 50, page with `skip`).
3. Report to the human: triggers and DMs sent per funnel since the last check, every failure with its `error` verbatim, and any anomaly (a funnel that stopped triggering, a spike, repeated failures to the same commenter).
4. Repeated failures on one funnel → flag it prominently and suggest a fix; don't silently retry, and don't delete or pause anything without the human.

## Judgment rules

- **Nothing goes live or dies without sign-off.** Creating sends DMs to strangers; deleting destroys logs. Both get explicit confirmation, every time.
- One keyword beats five. Short, memorable, unlikely to appear by accident ("GUIDE", not "info").
- If auto-replies are also on (`respond-to-comments`), a keyword comment gets the funnel DM automatically — don't double-DM; a public reply is still fine.
- Re-offer a per-post funnel whenever new content with a comment-CTA goes up.
- The funnel lives on CreatorOS servers — no cron is needed for it to run; crons are only for the log check.

## Verification

`list_funnels` after every create/update/delete — confirm the surviving set is exactly what the human approved. After the first real trigger, check `funnel_logs` once to confirm DMs are actually sending. The daily-check report is part of success — no report, not done.
