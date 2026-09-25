# post-threads

Publish multi-part text threads to X and Threads: split long-form ideas into a hook-first sequence. Single text posts to these platforms also fit here.

## Platform mechanics (native threads — no sequential posting)

CreatorOS supports threads natively on Twitter/X and Threads: use the advanced form and put the parts in `options.threadItems` (array of `{content, mediaItems?}`) on that network's target in `create_post`. The first item is the root; each subsequent item replies to the previous. **When `threadItems` is set, top-level `content` is NOT published — the whole thread lives in the items.** One post ID covers the full chain, cross-platform in one call.

Limits: X 280 chars/part (free tier), Threads 500.

## Procedure

1. Draft: hook in part 1 (it decides whether anyone reads on), one idea per part, a closer with the call-to-action from the brand pack. Number parts only if the brand does. Show the full thread text for approval before posting unless the human pre-approved autonomy.
2. Validate lengths per platform with `validate_post_length`; split any over-limit part at a sentence boundary.
3. One `create_post` with `targets`, one per account (`{ platform, account_id, options: { threadItems } }`). Same thread on X and Threads? Two targets, one call.
4. Schedule with `schedule_at` + timezone if asked; servers publish. Without `schedule_at` or `draft: true` it goes live immediately.

## Judgment rules

- Threads live or die on the hook. If part 1 is weak, tighten it before posting, or flag it.
- 4–8 parts is the sweet spot; past ~10, suggest longform instead.
- Never pad to reach a part count, never split mid-sentence.
- **If a thread post fails, do not re-post fragments manually — a half-posted thread is worse than none.** Check `get_post` for per-platform status, `retry_post` once, then report which platforms carried it and ask.

## Verification

`create_post` returns the post id; `get_post` confirms per-platform published state. Report: platform(s), part count, post URL(s).
