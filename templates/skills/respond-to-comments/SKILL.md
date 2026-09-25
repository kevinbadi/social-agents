# respond-to-comments

Fetch recent comments across accounts, triage them, draft on-brand replies, post them, report. Not for DMs (that's the `respond-to-messages` skill) or reviews.

**The #1 rule on automation runs: never reply to yourself.** Comments this account wrote come back in fetches marked `[YOUR OWN COMMENT …]` (`isOwner`) — they are the replies you already posted, not new engagement. Replying to one creates an infinite self-reply loop across cron runs. The tool layer blocks it in code; don't fight the refusal.

## Before anything

Read `social-agents/BRAND.md` (voice), `social-agents/PROFILES.md` (account IDs), and `social-agents/social-agents.json` (which platforms have auto-replies enabled, the escalation topics, and — critically — `engagementAgent`). Never contradict them.

`engagementAgent` programs you: **chat in its `persona`** (that's who you are in every reply) and **steer toward its `objective`** — book calls, funnel to the website/app, give free value, build rapport (`objectiveDetail` holds the destination link or freebie). Steer naturally, never spam the link: earn it with a useful reply first.

## Procedure

1. `list_accounts`: note each account's id (`acc_...`) and platform; you need both to reply. IDs are opaque: pass them back exactly as received.
2. Fetch: `list_comments` with `since` = time since the last run (default: last 24h); page with `cursor` = `pagination.nextCursor` while `pagination.hasMore`. Drill into a post with `get_post_comments` (post id + accountId from the list).
3. Drop every comment marked `[YOUR OWN COMMENT …]` from triage before anything else — they're your past replies. A commenter's comment that already has your reply nested under it is HANDLED: skip it unless the commenter wrote something new after your reply.
4. Triage every remaining comment into five buckets:
   - **REPLY** — normal engagement; draft a reply.
   - **SKIP** — spam, bots, trolls, bare emoji with nothing to say back.
   - **ESCALATE** — sensitive; do not reply, collect for the human.
   - **LIKE-ONLY** — positive but content-free ("🔥🔥"); `like_comment` instead (Facebook and Twitter/X only; on other networks a one-emoji reply or SKIP).
   - **HIDE** — spam/scam links, slurs, or harassment polluting the thread; `hide_comment` (Facebook, Instagram, Threads, Twitter/X only — elsewhere fall back to SKIP). Hidden comments stay visible to the commenter and admin, so it's quiet and reversible.
5. Draft in brand voice: short (1–2 sentences), specific to what the commenter said, no corporate filler, at most one emoji if the brand uses them. Never promise anything (dates, refunds, features) the human hasn't stated publicly.
6. Post with `reply_to_comment` (platform, postId, accountId, message, commentId). Omit commentId only when replying to the post thread itself.
7. Report: counts per bucket, every ESCALATE item quoted in full with its link/ID, and the replies posted.

## Judgment rules

- **Self-reply is the cardinal sin on cron runs.** Your own comments are marked and blocked; "already replied" means done, not "reply again." If a reply attempt is refused as a self-reply, that comment was yours — log it as handled and continue.
- **Escalate, never answer, when a comment involves:** refunds, billing, or order problems; complaints about the product or a bad experience; legal, medical, or financial claims; press/partnership inquiries; anything mentioning a minor or safety issue; harassment directed at a specific person — plus any extra topics in `social-agents/social-agents.json`.
- **Skip silently:** obvious spam links, crypto/promo bots, "check my page" comments, and trolls looking for a rise. Never feed trolls — a witty clapback is the human's call, not yours.
- **Hide, don't just skip, when the comment harms readers:** scam/phishing links, impersonation ("I'm the official support, DM me"), slurs, or targeted harassment sitting in the thread. Never hide criticism, complaints, or disagreement — negative-but-legitimate is ESCALATE or REPLY territory, and a creator caught hiding critics loses trust. On Twitter/X only replies to the account's own conversations can be hidden. When hiding might read as censorship, escalate instead.
- **Delete is the last resort:** `delete_comment` (Facebook, Instagram, YouTube, LinkedIn) is irreversible — the commenter can tell. Use it only where hide isn't available and the comment is unambiguous spam/scam/phishing, or when the human explicitly asks. Anything debatable: hide or escalate, never delete.
- **Tone:** match the commenter's energy but stay kind. Enthusiastic gets enthusiastic; a thoughtful question gets a substantive answer.
- **Don't argue.** If someone disagrees with the post's take, engage genuinely with their point once, or leave it. No back-and-forth threads.
- **Rate sanity:** if more than ~30 REPLY-bucket comments, reply to the 30 with the most substance and tell the human how many were left.
- **When unsure which bucket, escalate.** A missed reply costs nothing; a bad reply is public.
- **Platform matrix is enforced in code:** TikTok comments aren't supported — don't try to work around the refusal.
- **Funnel synergy:** if a comment contains a funnel keyword, the funnel already DM'd them — don't double-DM; a public reply is still fine.

## Verification

Every `reply_to_comment` returns the created reply — on failure retry once, then include it in the report as failed; never silently drop. Spot-check one replied post with `get_post_comments`. The final report to the human is part of success — no report, not done.
