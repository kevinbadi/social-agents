---
name: vertical-video-thumbnail
description: Build a 9:16 Reel/Shorts cover plus a comment-CTA caption from an edited talking-head video. Keyword is pulled from the spoken "comment the word X" line. Use when Kevin asks for a vertical video thumbnail, Reel cover, Shorts thumbnail, IG caption, comment-to-DM caption, or both from a finished video.
---

# Vertical video thumbnail + caption

9:16 (1080x1920) kevbuildsapps cover plus an Instagram/TikTok caption. Input is **the edited video**. Transcript, CTA keyword, hook, logos, and caption are derived. `--keyword` is optional override if the spoken CTA is missing.

```bash
node --env-file=.env.local \
  .claude/skills/vertical-video-thumbnail/scripts/generate.mjs \
  --video "/path/to/edited.mp4"
```

That is the full run. Optional overrides: `--line1`, `--line2`, `--logos`, `--transcript`, `--out`, `--caption-only`.

Writes next to `--out` (default: `<video>-thumbnail.png`):

- `*-thumbnail.png` (or `cover.png`)
- `*-caption.txt` (or `caption.txt` beside `cover.png`) — full IG/TikTok caption
- `*-caption-threads.txt` — same caption auto-fitted to Threads' 500-character cap
- `*.json` sidecar

## Caption format (always)

First line is the comment CTA. Then a blank line. Then the spoken video, cleaned, in short paragraphs. Hashtags on the last line of the body. No em/en dashes.

```
Comment "CLAUDE" to get these 3 plugins to level up your vibe coding.

Don't start vibe coding with Claude Code unless you have installed these 3 plugins.

First is Agent Skills. It's a pack of 24 skills that let you vibe code like a senior engineer. Built by the former AI engineering team at Google. It has dedicated skills for planning, coding, testing, and publishing. It activates the right one at different stages of coding, all on its own.

Second is Git Nexus. It turns your entire codebase into a visual graph. So you actually understand how a new repo works instead of getting lost in the files. It helps me learn a hundred times faster on new projects.

And finally, OmniRoute. It gives your Claude Code almost unlimited usage by connecting to over 300 free AI providers. You can source any other AI model inside your Claude Code harness without losing your memory and context. Unlocking up to 2 billion extra tokens every single month. #claudecode #vibecoding #aicoding #agentskills #gitnexus #omniroute
```

The spoken "comment the word X, I'll DM you" outro is stripped. The first line already is the CTA.

Threads rejects anything over 500 characters. The skill always writes a Threads-safe cut (`caption-threads.txt`) and the composer/agent publisher apply the same fit automatically when Threads is selected, so a long IG caption cannot fail the Threads publish.

## Cover

Kevin centered, dark tech background, floating product logos, two-line ALL CAPS hook (white kicker + red-box payoff). No fake view counts.

### Assets

- `assets/kevbuildsapps-clean-a.png` + `kevbuildsapps-clean-b.png` — live identity lock. Always fal images 1 and 2.
- `assets/kevbuildsapps-base-stubble.png` — archived. Do not pass unless Kevin asks.
- `assets/style-ref.png` — layout/pose only. Always the last fal image.
- Font: Arial Black, else `.claude/assets/fonts/Manrope-ExtraBold.ttf`.

### Grid crop

Instagram Reels and TikTok profile grids are **3:4, center-cropped** out of 9:16 (1080x1440 window at y=240..1680). They do **not** take the top 75%.

That 3:4 window is the photo: Kevin + logos + circuit, fully lit, no type. The hook lives only in the bottom 240px that the grid crops away. Never put a black plate in the center or the cell shows cut-off headlines.

Compose step: take the top 1440px of the fal scene (the image portion) and pin it to y=240. Headroom above is a blurred continuation (hidden under IG chrome on open). In ffmpeg `drawbox`, `h` is box height, so always `y=ih-240`. `drawtext` uses `y=H-186` / `y=H-88`.

### Scene

1. Transcribe with fal whisper if no `--transcript`.
2. Draft hook + logos + caption (`scripts/caption.mjs`, Anthropic with heuristic fallback).
3. fal scene with **no on-screen text**: `nano-banana-pro/edit`, fallback `nano-banana-2/edit`. Refs = [clean-a, clean-b, style-ref with bottom 240px painted black]. If fal is gated off, locked (`TOP_UP` / 403), or every model fails, burn the hook onto a real video frame instead — do not fail the Agent Post.
4. Pillow lifts the top ~18%. The top 1440px of the scene is pinned into the 3:4 grid slot. ffmpeg paints the bottom 240px black and burns type.

## Prompt rules

- Same person as images 1 and 2 (backwards cap, tank, clean-shaven cheeks, neat mustache, light chin stubble). Glow-up, not a different face. Ignore room/mic from the identity photos.
- Center 3:4 fully lit photo. Bottom 240px only is the black plate.
- Logos match the video. Not covering the face, not in the bottom quarter.
- No letters, captions, watermarks, UI chrome, editor gizmos, or view-count badges in generated pixels.
- Ban em/en dashes and `---` from overlay copy and captions.

## Env

`FAL_KEY` (cover; transcribe fallback). Transcribe prefers local `whisper` (`WHISPER_MODEL`, default `base.en`), then fal. Caption polish: `ANTHROPIC_API_KEY` then `OLLAMA_API_KEY`. Heuristic fallback if both miss. ffmpeg, python3 + Pillow.

## Learnings
- Pose variety (Kevin 2026-09-08: "not everytime the thumb on the chin pose"):
  scenePrompt rotates through a 10-pose bank (POSES in generate.mjs), picked by
  hash of the video filename so retries + sibling legs match but every video
  differs. `--pose "..."` overrides. The style-ref still drives framing and
  background only — the prompt explicitly says to ignore the reference pose.
- Fal lock fallback (Kevin 2026-09-10): if fal returns 403 / TOP_UP / locked,
  or every edit model fails, generate.mjs burns the hook onto a real video
  frame and still writes the cover. Agent Posts must not die on the cover step.
