#!/usr/bin/env node
/**
 * Vertical 9:16 Reel/Shorts cover: fal scene (identity + style refs) then
 * ffmpeg burns the two-line hook. Run from the Social Agents workspace root.
 */
import fs from "node:fs";
import { createRequire as __cr } from "node:module";
const { assertFal } = __cr(import.meta.url)("../../lib/fal-gate.cjs");
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { draftPack, logosFromTranscript } from "./caption.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, "..");
const CLAUDE = path.resolve(SKILL, "../..");
// Identity references belong to the user, not the skill: two or more clean
// photos of the creator in social-agents/assets/identity/*.png (override the folder
// with AGENT_POSTS_IDENTITY_DIR). An optional identity.txt beside them
// describes the person in one or two sentences for the scene prompt. With no
// references the cover is built from a real video frame instead of a fal scene.
const IDENTITY_DIR = path.resolve(process.env.AGENT_POSTS_IDENTITY_DIR || "social-agents/assets/identity");
const IDENTITY = fs.existsSync(IDENTITY_DIR)
  ? fs.readdirSync(IDENTITY_DIR).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().map((f) => path.join(IDENTITY_DIR, f))
  : [];
const IDENTITY_TEXT = (() => {
  const f = path.join(IDENTITY_DIR, "identity.txt");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").replace(/\s+/g, " ").trim() : "";
})();
const STYLE = path.join(SKILL, "assets/style-ref.png");
const FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial Black.ttf",
  path.join(CLAUDE, "assets/fonts/Manrope-ExtraBold.ttf"),
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
];
const FONT = FONT_CANDIDATES.find((p) => fs.existsSync(p));
let FAL_OK = true;
try {
  assertFal("video-thumbnail");
} catch (e) {
  FAL_OK = false;
  console.warn(`[fal-gate] ${e.message} -> using real-frame cover fallback`);
}
if (FAL_OK && IDENTITY.length < 2) {
  FAL_OK = false;
  console.warn(`[identity] fewer than 2 reference photos in ${IDENTITY_DIR} -> using real-frame cover fallback`);
}
const FAL_KEY = process.env.FAL_KEY;
const W = 1080;
const H = 1920;
// IG Reels + TikTok profile grids are 3:4, center-cropped out of 9:16.
// That window is y=240..1680. Hook text lives only in the cropped bottom 240px.
const GRID_H = 1440;
const GRID_TOP = Math.round((H - GRID_H) / 2);
const PLATE_H = H - GRID_TOP - GRID_H;

const MODELS = [
  { id: "fal-ai/nano-banana-pro/edit", label: "nano-banana-pro" },
  { id: "fal-ai/nano-banana-2/edit", label: "nano-banana-2" },
];

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function extractKeyword(transcript) {
  const t = String(transcript || "");
  const stop = new Set([
    "the", "word", "to", "and", "it", "me", "for", "a", "this", "that",
    "your", "you", "on", "in", "if", "below", "down", "here", "now",
    "please", "subscribe", "like", "follow",
  ]);
  const patterns = [
    /comment the word\s+["']?([A-Za-z][A-Za-z0-9]+)["']?/gi,
    /comment\s+["']([A-Za-z][A-Za-z0-9]+)["']/gi,
    /(?:just\s+)?comment[\s,.\-]+["']?([A-Za-z][A-Za-z0-9]+)["']?/gi,
  ];
  const found = [];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      const raw = m[1];
      const kw = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (kw.length >= 2 && !stop.has(raw.toLowerCase())) found.push(kw);
    }
  }
  if (found.length) return found[found.length - 1];
  const low = t.toLowerCase();
  if (/hyper[\s-]?edit/.test(low) || /open[-\s]?sourced video editor/.test(low)) {
    return "HYPER";
  }
  if (/phone farms?/.test(low) || /farm ios/.test(low)) return "FARM";
  if (/skillspector|skill spectre/.test(low)) return "SECURITY";
  if (/infinite slop/.test(low)) return "SLOP";
  return "";
}

function sanitize(s) {
  return String(s || "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+-{2,}\s+/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

function toDataUri(file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const mime =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".webp"
        ? "image/webp"
        : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function loadTranscript(p) {
  if (!p || !fs.existsSync(p)) return "";
  const raw = fs.readFileSync(p, "utf8");
  if (p.endsWith(".json")) {
    const j = JSON.parse(raw);
    if (typeof j.text === "string") return j.text;
    if (Array.isArray(j.segments)) return j.segments.map((s) => s.text).join(" ");
    if (Array.isArray(j) && Array.isArray(j[0])) return j.map((w) => w[0]).join(" ");
  }
  return raw;
}

function draftHook(transcript) {
  const t = transcript.toLowerCase();
  if (t.includes("scrape graph") || t.includes("scrapegraph") || /\bscrape\b/.test(t)) {
    return { line1: "FREE OPEN SOURCE AI", line2: "SCRAPES ANYTHING" };
  }
  if (/skillspector|skill spectre|security scanner|nvidia/.test(t)) {
    return { line1: "NVIDIA FREE TOOL", line2: "SCANS ANY SKILL" };
  }
  if (/infinite slop/.test(t)) {
    return { line1: "INFINITE AI SLOP", line2: "LIVE 24/7" };
  }
  if (/\batlas\b/.test(t)) {
    return { line1: "ATLAS WORLD MODEL", line2: "ANY CAMERA ANGLE" };
  }
  if (/plugin/.test(t) && /claude|cloud code/.test(t)) {
    return { line1: "3 CLAUDE PLUGINS", line2: "LEVEL UP FAST" };
  }
  if (/hyperedit|hyper.edit|open.sourced video editor/.test(t)) {
    return { line1: "FREE OPEN SOURCE", line2: "AI VIDEO EDITOR" };
  }
  if (/phone farm|farm ios|iphones/.test(t) && /macbook|mac/.test(t)) {
    return { line1: "FREE IPHONE FARM", line2: "RUNS FROM A MAC" };
  }
  if (/\bapple\b/.test(t) && /app store|revenue|developer/.test(t)) {
    return { line1: "APPLE TAKES HALF", line2: "OF APP REVENUE" };
  }
  const words = transcript.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
  const head = words.slice(0, 12).join(" ").toUpperCase();
  const parts = head.split(" ");
  const mid = Math.max(3, Math.ceil(parts.length / 2));
  return {
    line1: parts.slice(0, mid).join(" ").slice(0, 22),
    line2: parts.slice(mid).join(" ").slice(0, 18) || "WATCH THIS",
  };
}

function which(bin) {
  try {
    const p = execFileSync("which", [bin], { encoding: "utf8" }).trim();
    return p || null;
  } catch {
    return null;
  }
}

function transcribeLocal(video) {
  const bin = which("whisper");
  if (!bin) return null;
  const outDir = path.join(os.tmpdir(), `vthumb-whisper-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });
  const model = process.env.WHISPER_MODEL || "base.en";
  console.log(`transcribing locally (${model})...`);
  try {
    execFileSync(
      bin,
      [
        video,
        "--model",
        model,
        "--language",
        "en",
        "--output_format",
        "json",
        "--output_dir",
        outDir,
        "--fp16",
        "False",
        "--verbose",
        "False",
      ],
      { stdio: "pipe", timeout: 10 * 60_000 },
    );
    const jsonPath = path.join(outDir, `${path.parse(video).name}.json`);
    const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    return String(
      j.text || (j.segments || []).map((s) => s.text).join(" "),
    ).trim();
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

async function transcribeFal(video) {
  if (!FAL_KEY) throw new Error("FAL_KEY is not set (needed to transcribe --video)");
  const mp3 = path.join(os.tmpdir(), `vthumb-${Date.now()}.mp3`);
  execFileSync(
    "ffmpeg",
    ["-y", "-i", video, "-vn", "-ac", "1", "-b:a", "64k", mp3],
    { stdio: "pipe" },
  );
  try {
    const audio_url = `data:audio/mpeg;base64,${fs.readFileSync(mp3).toString("base64")}`;
    const res = await fetch("https://fal.run/fal-ai/whisper", {
      method: "POST",
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ audio_url, task: "transcribe", language: "en" }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`whisper ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    return String(data.text || "").trim();
  } finally {
    fs.unlinkSync(mp3);
  }
}

async function transcribeVideo(video) {
  try {
    const local = transcribeLocal(video);
    if (local) return local;
  } catch (e) {
    if (!FAL_OK) throw new Error(`local whisper failed (${e.message}) and fal.ai is gated off`);
    console.warn(`local whisper failed (${e.message}), trying fal`);
  }
  console.log("transcribing via fal...");
  return transcribeFal(video);
}

// Face x hand bank. Agent Posts used to hash the temp name "video.mp4" and
// fal copied the style-ref thinker (thumb on chin) every time. Cycle these
// instead. Never include a chin-rest / thinker pose.
// Kevin 2026-09-11: NEVER the open-mouth grin + finger-pointing-at-camera face
// ("point-camera" / "double-point" removed: "change this cover and never use
// that face again"). No pointing at the lens, no gaping grin.
// Kevin 2026-09-13: NEVER the prayer / namaste pose (both palms pressed together
// at the chest, closed-mouth smile). "rub-hands" removed: fal kept rendering it
// as pressed palms. Bank is 9.
const POSES = [
  {
    id: "cross-smirk",
    face: "confident closed-mouth smirk, eyes locked on camera, head tilted slightly right",
    hands: "both arms folded tight across his chest, hands tucked under opposite biceps, no hand near the face",
  },
  {
    id: "mind-blown",
    face: "eyebrows way up, mouth open in a wow, head tipped slightly back",
    hands: "both palms open beside his head at ear height, fingers spread, not covering the face and not on the chin",
  },
  {
    id: "temple-tap",
    face: "sly half-smile, one eyebrow up, head tilted left",
    hands: "right index finger tapping his temple, left hand out of frame at his hip, no chin rest",
  },
  {
    id: "point-logo",
    face: "looking up and left toward a floating logo, impressed grin, chin slightly up",
    hands: "left hand pointing up at a logo above his shoulder, right arm down, hands away from the face",
  },
  {
    id: "present",
    face: "warm closed smile, eyes on camera, head straight",
    hands: "right hand presenting open-palm to the side like revealing a product, left hand at his waist, no face touch",
  },
  {
    id: "flex-cross",
    face: "cocky grin, jaw set, chin up",
    hands: "arms flexed and crossed over his chest, fists closed on opposite biceps, no hand on the face",
  },
  {
    id: "count-three",
    face: "serious intense stare, mouth closed, head slightly forward",
    hands: "right hand holding up three fingers toward camera, left hand down, no chin or cheek touch",
  },
  {
    id: "shrug",
    face: "smug 'it's that easy' face, one eyebrow raised, slight left tilt",
    hands: "both palms up at shoulder height in a shrug, fingers open, clear of the face",
  },
  {
    id: "chop-explain",
    face: "talking mid-sentence, mouth slightly open, focused eyes, chin level",
    hands: "right hand in a karate-chop explain gesture at chest height, left hand open lower, neither on the face",
  },
];

function hashSeed(seedStr) {
  let h = 0;
  for (const c of String(seedStr)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function pickPose({ seed, index }) {
  const n = POSES.length;
  const i =
    Number.isInteger(index) && index >= 0
      ? index % n
      : hashSeed(seed || "cover") % n;
  return { ...POSES[i], index: i };
}

function formatPose(pose) {
  return `${pose.face}. Hands: ${pose.hands}`;
}

function scenePrompt({ line1, line2, logos, pose }) {
  const logoList = logos
    ? `${logos}. ICON MARKS ONLY — no letters, no wordmarks, no misspelled names on the icons.`
    : "orange circuit nodes and abstract 3D tech orbs, no product wordmarks";
  return [
    "Vertical 9:16 photorealistic social-media video thumbnail, 1080x1920.",
    "The person is the SAME PERSON as images 1 and 2 (identity lock): keep the",
    "face, skin tone, hair, facial hair, and clothing style exactly.",
    IDENTITY_TEXT || "Flattering thumbnail glow-up of THAT same person, not a different one:",
    "sharper, clearer skin, brighter catchlights in the eyes. Studio beauty lighting.",
    "Ignore the room, microphone, and furniture from the identity photos.",
    "Copy the LAYOUT of the LAST image only for framing, logos-around-head, and",
    "background: medium close-up, black office chair behind, dark tech background",
    "with orange/gold circuit glow.",
    "The last image is a DIFFERENT person. Do NOT copy their face, ethnicity, or pose.",
    "BANNED unless the pose below explicitly asks: thumb on chin, fist on chin,",
    "hand on cheek, thinker / chin-rest pose. Those are the style-ref, not him.",
    "ALSO BANNED always: prayer hands / namaste (both palms pressed together),",
    "hands clasped or rubbing together at the chest, pointing at the camera.",
    `FACE in THIS image: ${pose.face}.`,
    `HANDS in THIS image: ${pose.hands}.`,
    "Instagram Reels and TikTok grids are a CENTER 3:4 crop of this 9:16 (they cut",
    "~12 percent off the top AND the bottom). That center 3:4 is the clickable photo",
    "and must be 100 percent image: bright face, bright hat, torso, floating logos,",
    "orange circuit traces. NO black bar, NO empty plate, NO text in that center.",
    "Leave a little headroom above the hat so the cap is not sheared. Logos sit",
    "around the head, inside the center 3:4, not covering his face.",
    "The ONLY empty black plate is the bottom ~12 percent (for later text).",
    "NO top vignette, NO dark band across the logos, NO crushed blacks.",
    `Floating 3D logos: ${logoList}.`,
    "BANNED logos unless named above: Remotion, Premiere, CapCut, Final Cut,",
    "DaVinci, After Effects, Git Nexus, OmniRoute, Agent Skills plugin pack.",
    "Natural hands, exactly five fingers each, no extra limbs, no UI widgets,",
    "no selection handles, no dotted lines, no editor gizmos.",
    "CRITICAL: no on-screen text, no letters, no captions, no watermarks, no UI chrome,",
    "no view counts, no pins, no Google wordmark, no red headline box.",
    `This cover is for a video about: ${line1} / ${line2}.`,
  ].join(" ");
}

async function falEdit(modelId, prompt, imageUrls) {
  const res = await fetch(`https://fal.run/${modelId}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_urls: imageUrls,
      num_images: 1,
      resolution: "2K",
      aspect_ratio: "9:16",
      output_format: "png",
      safety_tolerance: "5",
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${modelId} ${res.status}: ${text.slice(0, 400)}`);
  const data = JSON.parse(text);
  const url = data.images?.[0]?.url;
  if (!url) throw new Error(`${modelId} returned no image`);
  return url;
}

async function download(url, dest) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function liftTop(src, dest) {
  // fal copies the style-ref's top vignette. Lift the upper scene (geq on
  // packed rgb crushes luma). The 3:4 grid is the center; keep it bright.
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(src)}).convert("RGB")
w, h = im.size
pix = im.load()
fade = int(h * 0.18)
for y in range(fade):
    t = 1.0 - (y / fade)
    boost = int(90 * t * t)
    for x in range(w):
        r, g, b = pix[x, y]
        pix[x, y] = (min(255, r + boost), min(255, g + boost), min(255, int(b + boost * 0.75)))
im.save(${JSON.stringify(dest)})
`;
  try {
    execFileSync("python3", ["-c", py], { stdio: "pipe" });
  } catch {
    execFileSync(
      "ffmpeg",
      ["-y", "-i", src, "-vf", "eq=gamma=1.12:brightness=0.04", dest],
      { stdio: "pipe" },
    );
  }
}

function extractFrame(video, dest, seconds) {
  execFileSync(
    "ffmpeg",
    ["-y", "-ss", String(seconds), "-i", video, "-frames:v", "1", "-q:v", "2", dest],
    { stdio: "pipe" },
  );
}

function fitSceneToGrid(src, dest) {
  // Place the generated photo in the 3:4 grid slot (center of 9:16). Top of
  // the scene is top-aligned into that slot so Kevin + logos fill the cell
  // and the hook plate stays below the crop. Headroom above the grid is a
  // blurred continuation. Pure ffmpeg — prod has no Python/PIL (2026-09-05).
  const fc =
    `[0:v]scale=${W}:${H},split=2[a][b];` +
    `[a]crop=${W}:${GRID_H}:0:0[grid];` +
    `[b]crop=${W}:80:0:0,scale=${W}:${GRID_TOP},gblur=sigma=16[head];` +
    `color=black:s=${W}x${H}:d=1[bg];` +
    `[bg][head]overlay=0:0:format=auto[t1];` +
    `[t1][grid]overlay=0:${GRID_TOP}:format=auto`;
  execFileSync(
    "ffmpeg",
    ["-y", "-i", src, "-filter_complex", fc, "-frames:v", "1", dest],
    { stdio: "pipe", timeout: 120_000 },
  );
}

function burnText(src, dest, line1, line2) {
  const l1 = sanitize(line1).toUpperCase();
  const l2 = sanitize(line2).toUpperCase();
  // Pillow keeps spaces. ffmpeg drawtext textfile still collapses them
  // on some builds when the filter graph is comma-joined.
  const py = `
from PIL import Image, ImageDraw, ImageFont
im = Image.open(${JSON.stringify(src)}).convert("RGB").resize((${W}, ${H}))
draw = ImageDraw.Draw(im)
draw.rectangle((0, ${H - PLATE_H}, ${W}, ${H}), fill=(0, 0, 0))
font1 = ImageFont.truetype(${JSON.stringify(FONT)}, 48)
font2 = ImageFont.truetype(${JSON.stringify(FONT)}, 56)

def centered_words(text, font, y, fill, box=None, pad=16, gap=22):
    words = text.split()
    widths = []
    height = 0
    for word in words:
        bbox = draw.textbbox((0, 0), word, font=font)
        widths.append(bbox[2] - bbox[0])
        height = max(height, bbox[3] - bbox[1])
    total = sum(widths) + gap * max(0, len(words) - 1)
    x = (${W} - total) // 2
    if box:
        draw.rectangle((x - pad, y - 8, x + total + pad, y + height + 14), fill=box)
    cx = x
    for word, ww in zip(words, widths):
        draw.text((cx, y), word, font=font, fill=fill)
        cx += ww + gap

centered_words(${JSON.stringify(l1)}, font1, ${H} - 186, (255, 255, 255))
centered_words(${JSON.stringify(l2)}, font2, ${H} - 88, (255, 255, 255), box=(239, 16, 32), pad=18)
im.save(${JSON.stringify(dest)})
`;
  try {
    execFileSync("python3", ["-c", py], { stdio: "pipe" });
    return;
  } catch {
    /* prod Railway has no Pillow — fall through to ffmpeg */
  }
  const tmp = [];
  const tf = (s) => {
    const f = path.join(os.tmpdir(), `vthumb-${Date.now()}-${tmp.length}.txt`);
    fs.writeFileSync(f, s.replace(/ /g, "\u00a0"));
    tmp.push(f);
    return f.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  };
  const font = String(FONT).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/ /g, "\\ ");
  const vf = [
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`,
    `drawbox=x=0:y=ih-${PLATE_H}:w=iw:h=${PLATE_H}:color=black@1.0:t=fill`,
    `drawtext=fontfile=${font}:textfile=${tf(l1)}:fontsize=48:fontcolor=white:expansion=none:box=1:boxcolor=black@1.0:boxborderw=14:x=(w-text_w)/2:y=H-186`,
    `drawtext=fontfile=${font}:textfile=${tf(l2)}:fontsize=56:fontcolor=white:expansion=none:box=1:boxcolor=0xef1020:boxborderw=16:x=(w-text_w)/2:y=H-88`,
  ].join(",");
  execFileSync(
    "ffmpeg",
    ["-y", "-i", src, "-update", "1", "-frames:v", "1", "-vf", vf, dest],
    { stdio: "inherit" },
  );
  for (const f of tmp) fs.unlinkSync(f);
}

function resolveRefs(video) {
  const identity = IDENTITY.filter((p) => fs.existsSync(p));
  const style = fs.existsSync(STYLE) ? STYLE : null;
  if (identity.length >= 2 && style) {
    return { identity, style, tmp: [] };
  }
  const frameA = path.join(os.tmpdir(), `vthumb-frame-a-${Date.now()}.png`);
  const frameB = path.join(os.tmpdir(), `vthumb-frame-b-${Date.now()}.png`);
  extractFrame(video, frameA, 1.2);
  try {
    extractFrame(video, frameB, 3.4);
  } catch {
    fs.copyFileSync(frameA, frameB);
  }
  return {
    identity: identity.length ? identity : [frameA, frameB],
    style: style || frameB,
    tmp: [frameA, frameB],
  };
}

function writeSidecar(out, payload) {
  const sidecar = out.replace(/\.png$/i, ".json");
  fs.writeFileSync(sidecar, JSON.stringify(payload, null, 2));
  return sidecar;
}

function falLocked(err) {
  const msg = String(err?.message || err || "");
  return (
    /\b403\b/.test(msg) ||
    /TOP_UP|User is locked|payment required|insufficient credits/i.test(msg)
  );
}

function composeFromVideoFrame(video, out, line1, line2) {
  console.log("scene: real video frame (fal unavailable)");
  const raw = out.replace(/\.png$/i, "-scene.png");
  execFileSync(
    "ffmpeg",
    [
      "-y", "-i", video,
      "-vf",
      `thumbnail=120,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},eq=gamma=1.06:brightness=0.02,drawbox=x=0:y=ih-${PLATE_H}:w=iw:h=${PLATE_H}:color=black:t=fill`,
      "-frames:v", "1", raw,
    ],
    { stdio: "pipe", timeout: 120_000 },
  );
  const fitted = out.replace(/\.png$/i, "-scene-grid.png");
  fitSceneToGrid(raw, fitted);
  burnText(fitted, out, line1, line2);
  return { raw, fitted, model: "video-frame" };
}

async function main() {
  const video = arg("--video");
  if (!video || !fs.existsSync(video)) {
    throw new Error("pass --video /path/to/edited.mp4");
  }
  let keyword = sanitize(arg("--keyword", "")).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const noCta = process.argv.includes("--no-cta");
  const captionOnly = process.argv.includes("--caption-only");
  const transcriptPath = arg("--transcript");
  const out = arg("--out") ||
    path.join(path.dirname(video), `${path.parse(video).name}-thumbnail.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // --scene-grid <fitted scene png>: re-burn the hook lines on an existing
  // scene (no transcription, no fal). Used to fix a bad auto-drafted hook.
  const sceneGrid = arg("--scene-grid", "");
  if (sceneGrid) {
    const l1 = sanitize(arg("--line1", "")).toUpperCase();
    const l2 = sanitize(arg("--line2", "")).toUpperCase();
    if (!l1 || !l2 || !fs.existsSync(sceneGrid)) {
      throw new Error("--scene-grid needs an existing png plus --line1 and --line2");
    }
    burnText(sceneGrid, out, l1, l2);
    const sc = out.replace(/\.png$/i, ".json");
    try {
      const j = JSON.parse(fs.readFileSync(sc, "utf8"));
      fs.writeFileSync(sc, JSON.stringify({ ...j, line1: l1, line2: l2, rehooked_at: new Date().toISOString() }, null, 2));
    } catch { /* no sidecar yet */ }
    console.log(`✓ ${out}  (rehook: ${l1} / ${l2})`);
    return;
  }

  let transcript = loadTranscript(transcriptPath);
  if (!transcript) {
    transcript = await transcribeVideo(video);
    const narr = out.replace(/thumbnail\.png$/i, "narration.json")
      .replace(/cover\.png$/i, "narration.json");
    const narrPath = narr === out ? out.replace(/\.png$/i, "-narration.json") : narr;
    fs.writeFileSync(narrPath, JSON.stringify({ text: transcript }, null, 2));
  }

  if (!noCta && !keyword) keyword = extractKeyword(transcript);
  if (noCta) keyword = "";
  if (!noCta && !keyword) {
    console.error(`transcript tail: ${transcript.slice(-280)}`);
    throw new Error(
      'no CTA keyword in the transcript (need "comment X" or "comment the word X")',
    );
  }
  const packed = await draftPack({
    transcript,
    keyword,
    noCta,
  });
  const drafted = draftHook(transcript);
  const line1 = sanitize(arg("--line1", packed.line1 || drafted.line1)).toUpperCase();
  const line2 = sanitize(arg("--line2", packed.line2 || drafted.line2)).toUpperCase();
  const forcedLogos = arg("--logos", "");
  const logos = forcedLogos
    ? forcedLogos
    : logosFromTranscript(packed.logos || "", transcript);
  const captionPath = out.replace(/\.png$/i, "") + "-caption.txt";
  // If out is cover.png, write caption.txt beside it.
  const captionFile = path.basename(out) === "cover.png"
    ? path.join(path.dirname(out), "caption.txt")
    : captionPath;
  fs.writeFileSync(captionFile, packed.caption + "\n");
  const threadsCaption = packed.threadsCaption || packed.caption;
  const threadsFile = path.basename(out) === "cover.png"
    ? path.join(path.dirname(out), "caption-threads.txt")
    : out.replace(/\.png$/i, "") + "-caption-threads.txt";
  fs.writeFileSync(threadsFile, threadsCaption + "\n");
  console.log(`hook: ${line1} / ${line2}`);
  console.log(`kw:   ${keyword}`);
  console.log(`caption (${packed.source}): ${captionFile}`);
  console.log(`threads (${[...threadsCaption].length} chars): ${threadsFile}`);
  writeSidecar(out, {
    video,
    keyword,
    transcript,
    line1,
    line2,
    logos,
    caption: packed.caption,
    caption_file: captionFile,
    threads_caption: threadsCaption,
    threads_caption_file: threadsFile,
    caption_source: packed.source,
    created_at: new Date().toISOString(),
  });
  if (captionOnly) {
    console.log("---");
    console.log(packed.caption);
    console.log("✓ caption only");
    return;
  }

  if (!FONT || !fs.existsSync(FONT)) throw new Error(`missing font: ${FONT || "none found"}`);

  if (!FAL_OK || !FAL_KEY) {
    const frame = composeFromVideoFrame(video, out, line1, line2);
    writeSidecar(out, {
      video, keyword, transcript, model: frame.model, line1, line2, logos,
      pose_id: null, pose_index: null, pose: null,
      caption: packed.caption, caption_file: captionFile,
      threads_caption: threadsCaption, threads_caption_file: threadsFile,
      caption_source: packed.source, scene: frame.raw, scene_grid: frame.fitted,
      cover: out, created_at: new Date().toISOString(),
    });
    console.log(`✓ ${out}  (video-frame fallback)`);
    console.log(`✓ ${captionFile}`);
    return;
  }

  const refsPack = resolveRefs(video);
  const poseOverride = sanitize(arg("--pose", ""));
  const poseIndexRaw = arg("--pose-index", "");
  const poseIndex = poseIndexRaw === "" || poseIndexRaw == null
    ? null
    : Number.parseInt(String(poseIndexRaw), 10);
  const poseSeed =
    sanitize(arg("--pose-seed", "")) ||
    [path.basename(video), path.basename(out), line1, line2].join("|");
  const picked = pickPose({
    seed: poseSeed,
    index: Number.isFinite(poseIndex) && poseIndex >= 0 ? poseIndex : null,
  });
  const pose = poseOverride
    ? { id: "custom", face: poseOverride, hands: poseOverride, index: picked.index }
    : picked;
  console.log(`pose: ${pose.id} [#${pose.index}] ${formatPose(pose)}`);
  const prompt = scenePrompt({ line1, line2, logos, pose });
  const styleLit = path.join(os.tmpdir(), `vthumb-style-${Date.now()}.png`);
  // Style-ref has a baked top vignette. Do not copy it. Paint only the
  // cropped bottom plate black so fal keeps the center 3:4 as the photo.
  // Brighten + black plate. Blur the center figure so fal cannot copy the
  // style-ref thinker (hand on chin) and only keeps layout / background.
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      refsPack.style,
      "-filter_complex",
      `[0:v]eq=gamma=1.18:brightness=0.06,drawbox=x=0:y=ih-${PLATE_H}:w=iw:h=${PLATE_H}:color=black:t=fill,split=2[bg][fg];` +
        `[fg]crop=iw*0.40:ih*0.48:iw*0.30:ih*0.14,gblur=sigma=22[blur];` +
        `[bg][blur]overlay=(W-w)/2:H*0.14`,
      "-frames:v",
      "1",
      styleLit,
    ],
    { stdio: "pipe" },
  );
  const refs = [...refsPack.identity.map(toDataUri), toDataUri(styleLit)];
  fs.unlinkSync(styleLit);

  console.log(`out:  ${out}`);

  let url;
  let used = null;
  let lastErr;
  for (const m of MODELS) {
    try {
      console.log(`fal ${m.label}...`);
      url = await falEdit(m.id, prompt, refs);
      used = m.label;
      break;
    } catch (e) {
      lastErr = e;
      console.warn(`  ${m.label} failed: ${e.message}`);
      if (falLocked(e)) break;
    }
  }
  if (!url) {
    console.warn(
      `[fal] all models failed (${lastErr?.message || "unknown"}). Falling back to a video-frame cover.`,
    );
    const frame = composeFromVideoFrame(video, out, line1, line2);
    writeSidecar(out, {
      video, keyword, transcript, model: frame.model, line1, line2, logos,
      pose_id: pose.id, pose_index: pose.index, pose: formatPose(pose),
      caption: packed.caption, caption_file: captionFile,
      threads_caption: threadsCaption, threads_caption_file: threadsFile,
      caption_source: packed.source, scene: frame.raw, scene_grid: frame.fitted,
      cover: out, created_at: new Date().toISOString(),
    });
    console.log(`✓ ${out}  (video-frame fallback)`);
    console.log(`✓ ${captionFile}`);
    console.log(`✓ ${threadsFile}`);
    for (const f of refsPack.tmp) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
    return;
  }

  const raw = out.replace(/\.png$/i, "-scene.png");
  await download(url, raw);
  const lit = out.replace(/\.png$/i, "-scene-lit.png");
  const fitted = out.replace(/\.png$/i, "-scene-grid.png");
  liftTop(raw, lit);
  fitSceneToGrid(lit, fitted);
  burnText(fitted, out, line1, line2);

  writeSidecar(out, {
    video,
    keyword,
    transcript,
    model: used,
    line1,
    line2,
    logos,
    pose_id: pose.id,
    pose_index: pose.index,
    pose: formatPose(pose),
    caption: packed.caption,
    caption_file: captionFile,
    threads_caption: threadsCaption,
    threads_caption_file: threadsFile,
    caption_source: packed.source,
    scene: raw,
    scene_grid: fitted,
    cover: out,
    created_at: new Date().toISOString(),
  });
  for (const f of refsPack.tmp) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  console.log(`✓ ${out}  (${used})`);
  console.log(`✓ ${captionFile}`);
  console.log(`✓ ${threadsFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
