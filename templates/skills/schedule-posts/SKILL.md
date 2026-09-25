# schedule-posts

Batch-schedule a content calendar (CSV, spreadsheet, markdown table, or a folder of assets) across future dates and accounts. CreatorOS servers publish at the scheduled times — nothing runs locally afterward, and say so in the report.

## Before anything

Read `social-agents/BRAND.md`, `social-agents/PROFILES.md`, `social-agents/social-agents.json` (timezone). If drawing from `content-library/`, respect its ledger (`POSTED.md`).

## The scheduling schema (create_post — know it cold)

Exactly ONE timing mode per post:

1. **Exact time**: `schedule_at` (ISO 8601, in the future) + `timezone` (IANA). A local wall-clock time is read in `timezone`; a time ending in `Z` is UTC. No timezone = UTC on the server, so ALWAYS pass it.
2. **Queue**: `queuedFromProfile: true` with NO `schedule_at` (advanced form: `targets` with `account_id`s). The server drops the post into the next open slot of the user's CreatorOS queue. **Never compute a slot yourself and paste it into `schedule_at`**: that bypasses the queue and can double-book it. Queue mode is right for "just keep my queue full"; exact time is right for calendars.
3. **Draft**: `draft: true` saves it for review without publishing.

**None of the three set → the post PUBLISHES IMMEDIATELY.** That is the right call only when the human said "post it now". A "scheduled" batch that loses its `schedule_at` goes live at once, so check every row has its time before the first `create_post`.

## Procedure

1. Parse the calendar. Expected columns (flexible naming): `date, time, platforms, caption, media_path, title, tags`. Folder of assets with no calendar → propose a schedule (dates × time slots) and get the human's OK first.
2. Validate every row before touching the API: media file exists on disk; caption non-empty and within limits (`validate_post_length`); date is in the future. Report all invalid rows and **stop if more than half fail** — the calendar format is probably misread.
3. Upload media per row with `upload_media`; capture the `med_` id per row.
4. Schedule each row with `create_post` (`schedule_at` + the batch timezone, or `queuedFromProfile: true` when the human said "add to my queue" instead of giving times). Same asset and caption across networks = one call with `platforms: ["instagram","tiktok",...]`; a different caption per network = advanced-form `targets`, each with its own `content`. Record the returned post id (`post_...`) per row.
5. Tell the human it's done and they can close the laptop — servers handle publishing.

## Judgment rules

- **Never invent content.** Empty caption cell → ask, don't improvise. Missing asset → skip the row and report it.
- **Don't double-book.** Check `list_posts` (status=scheduled) for the window; if a slot collides, shift yours by 30–60 min and note it.
- **Respect stated times exactly.** If the human said 6pm, schedule 6pm — don't "optimize" to a best-time slot unless they asked. If they ask for optimal times: `best_time_to_post` (slots are UTC, day 0 = Monday — convert).
- **Timezone discipline:** one timezone for the whole batch, stated in the final report. No timezone anywhere → ask, don't guess. Naive timestamps default to UTC on the server — always pass the timezone field.
- **Past dates in the calendar are always a mistake** — surface them, never silently bump to tomorrow.

## Verification

Every `create_post` returns a post id; after the batch, `list_posts` and spot-check 2 or 3 with `get_post`. **Confirm status is `scheduled`** and every network is listed under `platforms`. Time (`scheduledFor`) and accounts must match the calendar. Final report: table of row → post ID → time → accounts, plus skipped rows and why.
