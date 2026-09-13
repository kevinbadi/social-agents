/**
 * fal-gate — HARD STOP on fal.ai spend (Kevin 2026-09-05).
 *
 * "Stop using fal.ai to make images of Danny and Megan. Hard stop on those
 * along with any other fal.ai API calls/automations that are not related to
 * kevbuildsapps marketing pages."
 *
 * Every fal.run / queue.fal.run call site in this repo calls assertFal(context)
 * first. Only contexts listed in FAL_ALLOW (comma-separated) may proceed; the
 * default allow-list is just `kevbuildsapps` (src/lib/agent-posts/generate.ts,
 * the kevbuildsapps marketing-page cover). Everything else throws, and the
 * pipelines fall back to their banks / stock backgrounds.
 *
 * To re-enable a context on purpose: FAL_ALLOW=kevbuildsapps,carousel-gen
 *
 * CommonJS. From an .mjs file:
 *   import { createRequire } from "node:module";
 *   const { assertFal } = createRequire(import.meta.url)("../../../lib/fal-gate.js");
 */
const DEFAULT_ALLOW = ["kevbuildsapps"];

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
    `fal.ai HARD STOP (Kevin 2026-09-05): context "${context}" is not in FAL_ALLOW ` +
      `(allowed: ${allowed().join(",")}). Use banked/stock assets. ` +
      `Only kevbuildsapps marketing-page generation may call fal.ai.`,
  );
}

module.exports = { assertFal, falAllowed, DEFAULT_ALLOW };
