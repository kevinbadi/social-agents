# respond-to-messages

Fetch DM conversations across accounts, read what's new, draft on-brand replies, send them, report. Not for comments (that's `respond-to-comments`).

**The #1 rule on automation runs: never answer yourself.** On a cron, the reply you sent last run is the newest message next run. Messages this account sent come back marked `[YOUR OWN MESSAGE …]`; a conversation whose latest message is your own needs NO reply — the ball is in their court. The tool layer blocks sending into such a conversation in code; don't fight the refusal, and don't use `allowFollowUp` to get around it — that flag is only for a follow-up the human explicitly asked for.

## Before anything

Read `social-agents/BRAND.md` (voice), `social-agents/PROFILES.md` (account IDs), and `social-agents/social-agents.json` (`autoReplies.messages` platforms, escalation topics, and `engagementAgent`). Never contradict them.

`engagementAgent` programs you: **chat in its `persona`** and **steer toward its `objective`** (`objectiveDetail` holds the destination link or freebie). Earn the link with a useful reply first — never open with it.

## Procedure

1. `list_accounts` — note IDs and platforms.
2. `list_conversations` for the enabled platforms.
3. For each conversation, `get_conversation_messages` and decide:
   - **Latest message is yours** (`[YOUR OWN MESSAGE …]`) — HANDLED. Skip; no reply, no nudge, no "just checking in."
   - **Latest message is theirs** — read the whole thread for context, then triage: REPLY, SKIP (spam/bots), or ESCALATE (sensitive — see rules).
4. Draft in the persona: short, human, specific to what they said. One conversation = one reply per run — never stack messages.
5. `send_message` (platform, conversationId, accountId, message). Never pass `allowFollowUp` during automation runs.
6. Report: conversations checked, replies sent (quoted), skipped-as-handled count, and every ESCALATE item in full.

## Judgment rules

- **Escalate, never answer:** refunds, billing, order problems; complaints; legal/medical/financial; press or partnerships; anything involving a minor or safety; harassment — plus the extra topics in `social-agents/social-agents.json`. Reply nothing; bring the thread to the human verbatim.
- **The DM inbox is personal space.** More reserved than comments: no unprompted pitches, no link-dropping before they ask or the thread naturally earns it.
- **Don't double-text.** If they haven't answered your last message, silence is the move. Re-engagement campaigns are the human's call, run deliberately — not a cron side effect.
- **Funnel overlap:** if a funnel already DM'd this person (check `funnel_logs` when unsure), don't send a near-duplicate pitch; add value or stay quiet.
- **Platform matrix is enforced in code:** DMs work on X, Instagram, and Facebook. Relay refusals plainly.
- **When unsure, escalate.** A missed DM costs little; a bad DM to a customer is a churn event.

## Verification

Every `send_message` returns the sent message — on failure retry once, then report it as failed; never silently drop. The final report to the human is part of success — no report, not done.
