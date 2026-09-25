# analytics-report

The weekly performance report: growth, best posts, competitor movement, one recommendation. Also handles ad-hoc questions ("how did last week do?").

## Before anything

Read `social-agents/BRAND.md` (what success means for this brand), `social-agents/PROFILES.md`, and `social-agents/knowledge/COMPETITORS.md` (last known competitor state).

## Procedure

1. **Growth:** `follower_stats` for the period (default: last 7 days vs prior 7). Call out per-platform winners and losers.
2. **Content:** `get_analytics` sorted by engagement for the period; identify the top 3 and bottom 3 posts. `daily_metrics` for the shape of the week. Look for the pattern behind the winners (hook style, format, topic) — that's the insight, not the raw numbers.
3. **Timing:** `best_time_to_post` — slots are UTC and day 0 = Monday; convert to the user's timezone from `social-agents/social-agents.json` before reporting.
4. **Competitors:** skim `social-agents/knowledge/COMPETITORS.md`; if stale (>2 weeks) or the human asks, refresh with web research on the handles in `social-agents/BRAND.md` — content mix, cadence, hooks that work, gaps to exploit — and rewrite the file.
5. **One recommendation.** Exactly one concrete, doable-this-week move backed by the data ("your 3 top posts were all X — make 2 more of X, scheduled Tue/Thu at 6pm").

## Judgment rules

- Honest reads only. Flat is flat, down is down — the human can't fix what gets sugarcoated.
- Absolute numbers AND deltas; a bare "12,431 views" means nothing without last week's.
- Analytics can lag (some platforms 2–3 days) and follower counts refresh daily — note data staleness rather than presenting stale as current.
- Analytics endpoints are add-on gated; if a 402/403 mentions access, say the analytics add-on isn't active on the plan — manage that in the CreatorOS app.
- No metric dumps. The report is: growth, what worked, what didn't, competitor note, one recommendation. A screen of numbers is not a report.

## Report shape

Platform-by-platform one-liners (followers, delta, best post) → what worked / what didn't (2–3 sentences) → competitor movement (1–2 sentences) → **the one recommendation**.
