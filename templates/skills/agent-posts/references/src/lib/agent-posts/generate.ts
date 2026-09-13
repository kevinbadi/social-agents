import "server-only";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/** Keep in sync with POSES.length in vertical-video-thumbnail/scripts/generate.mjs */
export const THUMBNAIL_POSE_COUNT = 9;

export type GenerateResult = {
  keyword: string;
  caption: string;
  transcript: string;
  line1: string;
  line2: string;
  coverPath: string | null;
  captionSource: string;
  poseId: string;
  poseIndex: number | null;
};

type Sidecar = {
  keyword?: string;
  caption?: string;
  transcript?: string;
  line1?: string;
  line2?: string;
  caption_source?: string;
  cover?: string;
  model?: string;
  pose_id?: string;
  pose_index?: number;
};

function readJson(file: string): Sidecar | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Sidecar;
  } catch {
    return null;
  }
}

function spawnNode(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const take = (d: Buffer) => {
      chunks.push(d);
      process.stderr.write(d);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `vertical-video-thumbnail timed out after ${Math.round(timeoutMs / 1000)}s`,
        ),
      );
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const tail = Buffer.concat(chunks)
        .toString("utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(-3)
        .join(" | ")
        .slice(0, 280);
      reject(
        new Error(
          tail
            ? `vertical-video-thumbnail exited ${code}: ${tail}`
            : `vertical-video-thumbnail exited ${code}`,
        ),
      );
    });
  });
}

function parseSidecar(coverPath: string): GenerateResult {
  const sidecarPath = coverPath.replace(/\.png$/i, ".json");
  const captionBeside = path.join(path.dirname(coverPath), "caption.txt");
  const captionAlt = coverPath.replace(/\.png$/i, "") + "-caption.txt";
  const sidecar = readJson(sidecarPath) ?? {};
  const caption =
    sidecar.caption ||
    (fs.existsSync(captionBeside) ? fs.readFileSync(captionBeside, "utf8") : "") ||
    (fs.existsSync(captionAlt) ? fs.readFileSync(captionAlt, "utf8") : "");
  const narrPath = path.join(path.dirname(coverPath), "narration.json");
  const narr = readJson(narrPath);
  const transcript =
    sidecar.transcript ||
    narr?.transcript ||
    (narr as { text?: string } | null)?.text ||
    "";
  const coverExists = fs.existsSync(coverPath);
  return {
    keyword: String(sidecar.keyword || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, ""),
    caption: caption.trim(),
    transcript: String(transcript || "").trim(),
    line1: String(sidecar.line1 || ""),
    line2: String(sidecar.line2 || ""),
    coverPath: coverExists ? coverPath : null,
    captionSource: String(sidecar.caption_source || sidecar.model || ""),
    poseId: String(sidecar.pose_id || ""),
    poseIndex:
      typeof sidecar.pose_index === "number" && Number.isFinite(sidecar.pose_index)
        ? sidecar.pose_index
        : null,
  };
}

/** Full skill run: transcribe, caption, fal scene, 3:4 grid compose, hook burn. */
export async function runThumbnailSkill(
  videoPath: string,
  coverPath: string,
  opts?: { noCta?: boolean },
): Promise<GenerateResult> {
  const script = path.join(
    process.cwd(),
    ".claude/skills/vertical-video-thumbnail/scripts/generate.mjs",
  );
  if (!fs.existsSync(script)) {
    throw new Error("vertical-video-thumbnail skill is missing generate.mjs");
  }
  const identityA = path.join(
    process.cwd(),
    ".claude/skills/vertical-video-thumbnail/assets/kevbuildsapps-clean-a.png",
  );
  if (!fs.existsSync(identityA)) {
    throw new Error(
      "Thumbnail identity refs are missing (kevbuildsapps-clean-a.png).",
    );
  }

  const args = [script, "--video", videoPath, "--out", coverPath];
  if (opts?.noCta) args.push("--no-cta");
  try {
    await spawnNode(args, 10 * 60_000);
  } catch (e) {
    console.warn(
      "[agent-posts] thumbnail generate failed, retrying once:",
      e instanceof Error ? e.message : e,
    );
    await spawnNode(args, 10 * 60_000);
  }

  const result = parseSidecar(coverPath);
  if (!opts?.noCta && !result.keyword) {
    throw new Error(
      'No CTA keyword in the transcript (need a spoken "comment X").',
    );
  }
  if (!result.caption) throw new Error("Caption skill returned an empty caption.");
  if (!result.coverPath) {
    throw new Error(
      "Cover PNG was not written. fal.ai scene + hook overlay did not finish.",
    );
  }
  return result;
}
