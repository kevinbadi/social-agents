/**
 * fal-gate — fal.ai spend is opt-in, per context.
 *
 * Every fal.run call site calls assertFal(context) first. Only contexts listed
 * in FAL_ALLOW (comma-separated, or "*") may proceed; the default allow-list is
 * empty, so with no FAL_ALLOW the cover generator never spends and falls back
 * to a real video frame. Enable the cover scene on purpose:
 *   FAL_KEY=... FAL_ALLOW=video-thumbnail
 *
 * CommonJS. From an .mjs file:
 *   import { createRequire } from "node:module";
 *   const { assertFal } = createRequire(import.meta.url)("../../lib/fal-gate.cjs");
 */
const DEFAULT_ALLOW = [];

function allowed() {
  const raw = process.env.FAL_ALLOW;
  if (raw == null || raw.trim() === "") return DEFAULT_ALLOW;
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function falAllowed(context) {
  const list = allowed();
  return list.includes("*") || list.includes(String(context).toLowerCase());
}

function assertFal(context) {
  if (falAllowed(context)) return true;
  throw new Error(
    `fal.ai is off for "${context}" (FAL_ALLOW=${allowed().join(",") || "<empty>"}). ` +
      `Set FAL_ALLOW=${context} to enable it.`,
  );
}

module.exports = { assertFal, falAllowed, DEFAULT_ALLOW };
