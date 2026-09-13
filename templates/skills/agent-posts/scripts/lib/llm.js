/**
 * llm — the single model gateway for every Creator OS automation.
 *
 * Kevin 2026-08-11: all automations moved off Anthropic onto DeepSeek, served
 * through the Ollama cloud API. This module keeps the ANTHROPIC MESSAGES SHAPE
 * on both ends (same request body, same `{ content: [{ type: "text", text }] }`
 * response) so the call sites stayed one-line changes and can be pointed back
 * at another provider from one place.
 *
 * Routing:
 *   text-only  → OLLAMA_TEXT_MODEL   (deepseek-v4-flash:0731)
 *   any images → OLLAMA_VISION_MODEL (qwen3.5:397b)
 *
 * DeepSeek v4 Flash has NO vision capability, so the image QA gates
 * (carousel-qa, reaction-ugc, qa-reaction-clips) auto-route to Qwen. Both run
 * on the same OLLAMA_API_KEY and endpoint, so there is one credential.
 *
 * Structured output: Ollama's `format` (JSON schema) is IGNORED by the DeepSeek
 * cloud model — it happily returns markdown with three caption options. So when
 * a caller passes output_config.format.schema we (a) still send `format` for
 * models that honor it, (b) hard-instruct JSON in the system prompt, and
 * (c) brace-match the first JSON value out of the reply. Verified 2026-08-11.
 */

const BASE = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
const TEXT_MODEL = process.env.OLLAMA_TEXT_MODEL || "deepseek-v4-flash:0731";
const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "qwen3.5:397b";
// Thinking burns output tokens against num_predict and we never read the trace.
const THINK = process.env.OLLAMA_THINK === "1";
const TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || "300000", 10);

function apiKey() {
  return process.env.OLLAMA_API_KEY || process.env.OLLAMA_KEY || "";
}

/** Anthropic content blocks → one Ollama message ({ content, images }). */
function flattenContent(content) {
  if (typeof content === "string") return { text: content, images: [] };
  const images = [];
  const parts = [];
  for (const block of content || []) {
    if (block.type === "image") {
      const data = block.source?.data || block.data;
      if (!data) continue;
      images.push(data);
      // Ollama drops image position, so anchor it in the text — the reaction QA
      // gate sends a reference face plus three frames and the order matters.
      parts.push(`[IMAGE ${images.length}]`);
    } else if (block.type === "text") {
      parts.push(block.text);
    }
  }
  return { text: parts.join("\n"), images };
}

const JSON_RULE =
  "You output ONLY a single raw JSON value matching the requested schema. " +
  "No markdown, no code fences, no commentary, no preamble, no alternatives, " +
  "no trailing explanation. Start your reply with { or [ and end it with } or ].";

/** Pull the first balanced JSON value out of a reply that may carry preamble. */
function extractJson(raw) {
  let s = String(raw || "").trim();
  // ```json … ``` fences
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/[{[]/);
  if (start === -1) return s;
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return s.slice(start);
}

/**
 * Anthropic-compatible createMessage, served by Ollama.
 * Accepts the same body the call sites already build; returns the same shape.
 */
async function createMessage(body, { retries = 2 } = {}) {
  const key = apiKey();
  if (!key) throw new Error("OLLAMA_API_KEY not set — add it to creator-os/.env.local and Railway");

  const messages = [];
  let hasImages = false;
  if (body.system) messages.push({ role: "system", content: body.system });
  for (const m of body.messages || []) {
    const { text, images } = flattenContent(m.content);
    const msg = { role: m.role, content: text };
    if (images.length) {
      msg.images = images;
      hasImages = true;
    }
    messages.push(msg);
  }

  const schema = body.output_config?.format?.schema || body.output_config?.format?.json_schema;
  if (schema) {
    const sys = messages.find((m) => m.role === "system");
    const rule = `${JSON_RULE}\n\nSCHEMA:\n${JSON.stringify(schema)}`;
    if (sys) sys.content = `${sys.content}\n\n${rule}`;
    else messages.unshift({ role: "system", content: rule });
  }

  // An explicit ollama-style model wins; legacy claude-* ids fall through to routing.
  const explicit = body.model && !/^claude/i.test(body.model) ? body.model : null;
  const model = explicit || (hasImages ? VISION_MODEL : TEXT_MODEL);

  const payload = {
    model,
    messages,
    stream: false,
    think: THINK,
    options: {
      num_predict: body.max_tokens || 4000,
      ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    },
  };
  if (schema) payload.format = schema;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        if (attempt < retries && (res.status === 429 || res.status >= 500)) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw new Error(`ollama ${res.status}: ${detail}`);
      }
      const json = await res.json();
      let text = json.message?.content ?? "";
      if (!text && json.message?.thinking) text = json.message.thinking;
      if (schema) text = extractJson(text);
      if (!text.trim()) throw new Error("ollama returned an empty reply");
      return {
        content: [{ type: "text", text }],
        model: json.model || model,
        stop_reason: json.done_reason,
        usage: { input_tokens: json.prompt_eval_count, output_tokens: json.eval_count },
      };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastErr;
}

/** Convenience: schema-checked JSON in one call. */
async function createJson(body, opts) {
  const res = await createMessage(body, opts);
  const text = res.content[0].text;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`model did not return valid JSON (${e.message}): ${text.slice(0, 200)}`);
  }
}

/** Liveness probe for the dashboard/cron health banner. */
async function ping() {
  const res = await createMessage(
    { max_tokens: 8, messages: [{ role: "user", content: "Reply with: ok" }] },
    { retries: 0 },
  );
  return Boolean(res.content[0].text);
}

module.exports = { createMessage, createJson, ping, extractJson, TEXT_MODEL, VISION_MODEL, BASE };
