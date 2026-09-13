---
name: vertical-video-thumbnail
description: Build a 9:16 Reel/Shorts cover from an edited talking-head video, and pull its transcript. Used by the agent-posts skill; the agent writes the hook lines and captions, this script burns them.
---

# Vertical video thumbnail

9:16 (1080x1920) cover from **the edited video**. Run from the workspace root.

```bash
S=midas/skills/agent-posts/scripts/vertical-video-thumbnail/scripts
node $S/generate.mjs --video in.mp4 --out out/cover.png --caption-only          # transcript + draft only
node $S/generate.mjs --video in.mp4 --out out/cover.png \
  --transcript out/narration.json --keyword X --line1 "KICKER" --line2 "PAYOFF"  # the cover
node $S/generate.mjs --video in.mp4 --out out/cover.png --scene-grid out/cover-scene-grid.png \
  --line1 "NEW" --line2 "HOOK"                                                   # re-burn text only
```

Writes beside `--out`: `cover.png`, `narration.json` (transcript), `caption.txt` and `caption-threads.txt` (heuristic drafts, the agent rewrites them from BRAND.md), and a `.json` sidecar. `--no-cta` for videos without a spoken keyword.

## Cover

Two modes, chosen automatically:

- **Real frame (default).** A frame from the video, fitted, with the two hook lines burned onto the bottom plate. Needs only ffmpeg and a bold font.
- **Generated scene.** Needs `FAL_KEY`, `FAL_ALLOW=video-thumbnail`, and two or more photos of the creator in `midas/assets/identity/` (`AGENT_POSTS_IDENTITY_DIR` overrides). An optional `identity.txt` there describes the person for the prompt. `assets/style-ref.png` drives layout only. A locked or failing fal account falls back to the real frame; the cover step never fails the post.

### Grid crop

Instagram Reels and TikTok profile grids are **3:4, center-cropped** out of 9:16 (a 1080x1440 window at y=240..1680). That window is the photo: face, logos, background, no type. The hook lives only in the bottom 240px the grid crops away. In ffmpeg `drawbox` `h` is box height, so `y=ih-240`; `drawtext` uses `y=H-186` / `y=H-88`.

### Poses (generated scenes)

The pose bank in `generate.mjs` rotates by a hash of the video filename so retries match but every video differs; `--pose "..."` overrides. Never a chin-rest or thinker pose, never the pointing-at-camera grin, never prayer hands. No on-screen text, watermarks, view counts, or UI chrome in generated pixels. No em or en dashes in overlay copy.

## Transcript

Local `whisper` first (`WHISPER_MODEL`, default `base.en`), fal whisper as fallback when `FAL_KEY` is set. Font: Arial Black, else DejaVu/Liberation Sans Bold.
