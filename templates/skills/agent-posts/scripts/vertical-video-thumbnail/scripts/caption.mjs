/**
 * kevbuildsapps caption: CTA first line, cleaned spoken body, hashtags.
 * Shape is locked to the 3-plugins example in SKILL.md.
 */
export const EXAMPLE_CAPTION = `Comment "CLAUDE" to get these 3 plugins to level up your vibe coding.

Don't start vibe coding with Claude Code unless you have installed these 3 plugins.

First is Agent Skills. It's a pack of 24 skills that let you vibe code like a senior engineer. Built by the former AI engineering team at Google. It has dedicated skills for planning, coding, testing, and publishing. It activates the right one at different stages of coding, all on its own.

Second is Git Nexus. It turns your entire codebase into a visual graph. So you actually understand how a new repo works instead of getting lost in the files. It helps me learn a hundred times faster on new projects.

And finally, OmniRoute. It gives your Claude Code almost unlimited usage by connecting to over 300 free AI providers. You can source any other AI model inside your Claude Code harness without losing your memory and context. Unlocking up to 2 billion extra tokens every single month. #claudecode #vibecoding #aicoding #agentskills #gitnexus #omniroute`;

const WHISPER_FIXES = [
  [/\bCloud Code\b/gi, "Claude Code"],
  [/\bClod Code\b/gi, "Claude Code"],
  [/\bSkill Spector\b/gi, "SkillSpector"],
  [/\bSkillspectre\b/gi, "SkillSpector"],
  [/\bSkill Spectre\b/gi, "SkillSpector"],
  [/\bSkillSpectre\b/gi, "SkillSpector"],
  [/\bNetanyahu\b/g, "anyone"],
  [/\bLevels IO\b/gi, "levelsio"],
  [/\bLevels\.io\b/gi, "levelsio"],
  [/\bGiffy\b/gi, "Giphy"],
  [/\bFFMPEG\b/g, "FFmpeg"],
  [/\bFfmpeg\b/g, "FFmpeg"],
];

export function sanitizeCaption(s) {
  return String(s || "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+-{2,}\s+/g, " - ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function spaceBody(rest) {
  const parts = String(rest || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts.join("\n\n");
  const sents = splitSentences(parts[0] || rest);
  if (sents.length <= 2) return sents.join(" ");
  const paras = [];
  for (let i = 0; i < sents.length; i += 2) {
    paras.push(sents.slice(i, i + 2).join(" "));
  }
  return paras.join("\n\n");
}

/** CTA on its own line, then short body paragraphs with a blank line between each. */
export function spaceCaption(caption) {
  const text = sanitizeCaption(caption);
  const breakAt = text.search(/\n/);
  if (breakAt < 0) return text;
  const first = text.slice(0, breakAt).trim();
  const rest = text.slice(breakAt).trim();
  if (!rest) return first;
  return `${first}\n\n${spaceBody(rest)}`;
}

/** Body + hashtags, no comment CTA. */
export function spaceStoryCaption(caption) {
  return spaceBody(sanitizeCaption(caption));
}

function stripLeadingCommentCta(caption) {
  return String(caption || "")
    .replace(/^Comment\s+"[^"]+"[^\n]*\n*/i, "")
    .replace(/^Comment\s+[A-Z0-9]{2,}[^\n]*\n*/i, "")
    .trim();
}

function fixWhisper(s) {
  let t = s;
  for (const [re, to] of WHISPER_FIXES) t = t.replace(re, to);
  return t;
}

function stripSpokenCta(s) {
  return s
    .replace(/\s*If you (?:want|wanna|guys want)[\s\S]*$/i, "")
    .replace(/\s*(?:and )?if you wanna get your hands[\s\S]*$/i, "")
    .replace(/\s*(?:and )?just comment[\s\S]*$/i, "")
    .replace(/\s*(?:just )?comment the word[\s\S]*$/i, "")
    .trim();
}

const THREADS_LIMIT = 500;

function charLen(text) {
  return [...text].length;
}

function truncateChars(text, limit) {
  const chars = [...text];
  if (chars.length <= limit) return text.trimEnd();
  const out = chars.slice(0, limit).join("");
  const clipped = out.replace(/\s+\S*$/, "").trimEnd();
  return clipped || out.trimEnd();
}

function stripHashtags(s) {
  return String(s || "")
    .replace(/(?:^|\s)#[\p{L}\p{N}_]+/gu, (m) => (/^\n/.test(m) ? "\n" : " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Threads rejects captions over 500 characters. Pack as much body as fits. No hashtag packing. */
export function fitThreadsCaption(text, limit = THREADS_LIMIT) {
  const trimmed = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!trimmed) return trimmed;
  if (charLen(trimmed) <= limit) return trimmed;

  const paras = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let acc = "";
  for (const para of paras) {
    const next = acc ? `${acc}\n\n${para}` : para;
    if (charLen(next) <= limit) {
      acc = next;
      continue;
    }
    acc = truncateChars(next, limit);
    break;
  }
  if (!acc) acc = truncateChars(paras[0] || trimmed, limit);
  return acc;
}

function guessOffer(transcript) {
  const t = transcript.toLowerCase();
  if (/\bthree\b/.test(t) && /plugin/.test(t)) return "these 3 plugins to level up your vibe coding";
  if (/skillspector|skill spectre|security scanner/.test(t)) return "the free NVIDIA skill scanner";
  if (/infinite slop/.test(t)) return "the skill to build an infinite slop machine";
  if (/hyperedit|hyper.edit|open.sourced video editor/.test(t)) {
    return "the open source video editor and the tutorial";
  }
  if (/phone farm|farm ios/.test(t)) return "the open source iOS phone farm and the setup tutorial";
  if (/\batlas\b/.test(t) && /world model/.test(t)) return "the link to apply to Atlas";
  if (/scrapegraph|scrapes anything/.test(t)) return "the free ScrapeGraph skill";
  const skill = t.match(/comment the word \w+.{0,80}(skill|link|plugin|tool|scanner)/i);
  if (/skill/.test(t) && /comment/.test(t)) return "the free skill from this video";
  if (skill) return "the free resource from this video";
  return "the free resource from this video";
}

function guessTags(transcript, keyword) {
  const t = transcript.toLowerCase();
  const tags = new Set();
  const add = (x) => {
    const h = String(x).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (h.length >= 3) tags.add(`#${h}`);
  };
  add(keyword);
  if (/claude/.test(t)) add("claudecode");
  if (/vibe/.test(t)) add("vibecoding");
  if (/\bai\b/.test(t)) add("aicoding");
  if (/agent skills/.test(t)) add("agentskills");
  if (/git nexus/.test(t)) add("gitnexus");
  if (/omniroute/.test(t)) add("omniroute");
  if (/nvidia|skillspector|skill spectre/.test(t)) add("nvidia");
  if (/infinite slop/.test(t)) add("aislop");
  if (/hyperedit|hyper.edit/.test(t)) add("hyperedit");
  if (/ffmpeg|ff mpeg/.test(t)) add("ffmpeg");
  if (/giphy|giffy/.test(t)) add("giphy");
  if (/phone farm|farm ios/.test(t)) add("phonefarm");
  if (/\batlas\b/.test(t)) add("atlas");
  if (/scrapegraph|scrape/.test(t)) add("scrapegraph");
  if (/github/.test(t)) add("github");
  if (/openai|chatgpt|codex/.test(t)) add("openai");
  for (const filler of ["aicoding", "vibecoding", "buildinpublic", "indiehacker"]) {
    if (tags.size >= 5) break;
    add(filler);
  }
  return [...tags].slice(0, 8).join(" ");
}

const LOGO_ALIASES = [
  [/ffmpeg|ff mpeg/, "FFmpeg"],
  [/giphy|giffy/, "Giphy"],
  [/hyper[\s-]?edit/, "HyperEdit"],
  [/\bwhisper\b/, "Whisper"],
  [/nvidia/, "NVIDIA"],
  [/github|git nexus|git repo/, "GitHub"],
  [/claude|cloud code/, "Claude"],
  [/openai|chatgpt|codex/, "OpenAI"],
  [/\bpython\b/, "Python"],
  [/linkedin/, "LinkedIn"],
  [/youtube/, "YouTube"],
  [/\batlas\b/, "Atlas"],
  [/\bgoogle\b/, "Google"],
  [/cursor/, "Cursor"],
  [/docker/, "Docker"],
];

const INVENTED_EDITOR_LOGOS = [
  "premiere", "capcut", "cap cut", "final cut", "davinci", "after effects",
  "photoshop", "canva", "vegas", "filmora", "imovie", "kdenlive",
  "remotion", "agent skills", "git nexus", "omniroute",
];

function guessLogos(transcript) {
  const t = transcript.toLowerCase();
  const logos = [];
  for (const [re, name] of LOGO_ALIASES) {
    if (re.test(t) && !logos.includes(name)) logos.push(name);
  }
  return logos.slice(0, 4).join(", ");
}

function spokenInTranscript(name, transcript) {
  const t = String(transcript || "").toLowerCase();
  const low = String(name || "").toLowerCase().trim();
  if (!low) return false;
  const compact = low.replace(/[\s-]+/g, "");
  return t.includes(low) || t.includes(compact);
}

/** Drop logos the speaker never named (CapCut / Premiere on an FFmpeg video). */
export function logosFromTranscript(rawLogos, transcript) {
  const t = String(transcript || "").toLowerCase();
  const guessed = guessLogos(t);
  const guessedList = guessed ? guessed.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const asked = String(rawLogos || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = [];
  for (const name of asked.length ? asked : guessedList) {
    const low = name.toLowerCase();
    const invented = INVENTED_EDITOR_LOGOS.some((ban) => low.includes(ban));
    if (invented && !spokenInTranscript(name, t)) continue;
    const aliasHit = LOGO_ALIASES.some(([re, canon]) => {
      const same =
        canon.toLowerCase() === low ||
        low.includes(canon.toLowerCase()) ||
        canon.toLowerCase().includes(low);
      return same && re.test(t);
    });
    if ((aliasHit || spokenInTranscript(name, t)) && !kept.includes(name)) {
      kept.push(name);
    }
  }
  if (!kept.length) return guessed;
  return kept.slice(0, 4).join(", ");
}

function guessHook(transcript) {
  const t = transcript.toLowerCase();
  if (/skillspector|skill spectre|security scanner/.test(t)) {
    return { line1: "NVIDIA FREE TOOL", line2: "SCANS ANY SKILL" };
  }
  if (/infinite slop/.test(t)) {
    return { line1: "INFINITE AI SLOP", line2: "LIVE 24/7" };
  }
  if (/\batlas\b/.test(t) && /world model|camera/.test(t)) {
    return { line1: "ATLAS WORLD MODEL", line2: "ANY CAMERA ANGLE" };
  }
  if (/scrapegraph|scrapes anything/.test(t)) {
    return { line1: "FREE OPEN SOURCE AI", line2: "SCRAPES ANYTHING" };
  }
  if (/plugin/.test(t) && /claude|cloud code/.test(t)) {
    return { line1: "3 CLAUDE PLUGINS", line2: "LEVEL UP FAST" };
  }
  if (/hyperedit|hyper.edit|open.sourced video editor/.test(t)) {
    return { line1: "FREE OPEN SOURCE", line2: "AI VIDEO EDITOR" };
  }
  if (/phone farm|farm ios/.test(t)) {
    return { line1: "FREE IPHONE FARM", line2: "RUNS FROM A MAC" };
  }
  if (/\bapple\b/.test(t) && /app store|revenue|developer/.test(t)) {
    return { line1: "APPLE TAKES HALF", line2: "OF APP REVENUE" };
  }
  const words = transcript.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
  const head = words.slice(0, 10).join(" ").toUpperCase().split(" ");
  const mid = Math.max(3, Math.ceil(head.length / 2));
  return {
    line1: head.slice(0, mid).join(" ").slice(0, 18),
    line2: (head.slice(mid).join(" ").slice(0, 18) || "WATCH THIS"),
  };
}

export function heuristicPack({ transcript, keyword, noCta = false }) {
  const kw = String(keyword || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const wantCta = !noCta && Boolean(kw);
  const cleaned = stripSpokenCta(fixWhisper(transcript.replace(/\s+/g, " ").trim()));
  let body = cleaned
    .replace(/\s+(First(?: up)? is )/g, "\n\nFirst is ")
    .replace(/\s+(Second is |Next up is )/g, "\n\nSecond is ")
    .replace(/\s+(And finally,? |Finally, )/g, "\n\nAnd finally, ");
  const offer = guessOffer(transcript);
  const tags = guessTags(transcript, kw);
  const hook = guessHook(transcript);
  const caption = wantCta
    ? spaceCaption(`Comment "${kw}" to get ${offer}.\n\n${body} ${tags}`)
    : spaceStoryCaption(`${body} ${tags}`);
  return {
    line1: hook.line1,
    line2: hook.line2,
    logos: logosFromTranscript("", transcript),
    caption,
    threadsCaption: fitThreadsCaption(stripHashtags(stripLeadingCommentCta(caption))),
    offer,
    source: "heuristic",
  };
}

function extractJson(raw) {
  let s = String(raw || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no JSON in model reply");
  return JSON.parse(s.slice(start, end + 1));
}

function captionSystem(wantCta) {
  const ctaRules = wantCta
    ? [
        "Caption format is mandatory:",
        '1. First line exactly like: Comment "KEYWORD" to get [short offer].',
        "2. Blank line.",
        "3. Body = the spoken video, cleaned into short paragraphs. First person. Spoken energy.",
      ]
    : [
        "This post has NO comment-to-DM. Do not mention commenting a word, DMs, or a keyword.",
        "Caption format is mandatory:",
        "1. Body = the spoken video, cleaned into short paragraphs. First person. Spoken energy.",
      ];
  return [
    "You write kevbuildsapps Instagram/TikTok captions and 9:16 thumbnail hooks.",
    ...ctaRules,
    "   Fix Whisper errors (Cloud Code -> Claude Code, Skill Spectre -> SkillSpector).",
    "   Strip the spoken comment-the-word / I'll send you the link in DMs outro.",
    "   No em dashes, no en dashes, no emoji.",
    wantCta
      ? "4. 5-8 lowercase hashtags at the end of the LAST body paragraph (same line)."
      : "2. 5-8 lowercase hashtags at the end of the LAST body paragraph (same line).",
    "Thumbnail: two ALL CAPS lines, each 18 characters or fewer. Punchy claim. No punctuation besides %.",
    "Logos: ONLY product names the speaker actually said (e.g. FFmpeg, Giphy, HyperEdit, Claude).",
    "Never invent Premiere, CapCut, Final Cut, DaVinci, After Effects, Photoshop, Canva, Remotion, GitHub, OpenAI, Agent Skills, Git Nexus, or OmniRoute unless that exact name is in the transcript.",
    "If they named fewer than 3 tools, return only those. Empty logos is better than a fake editor stack.",
    'Return ONLY JSON: {"line1":"","line2":"","logos":"A, B, C","caption":"","offer":""}',
  ].join(" ");
}

async function anthropicPack({ transcript, keyword, noCta = false }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const kw = String(keyword || "").toUpperCase();
  const wantCta = !noCta && Boolean(kw);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      temperature: 0.3,
      system: captionSystem(wantCta),
      messages: [
        {
          role: "user",
          content: wantCta
            ? `KEYWORD: ${kw}\n\nEXAMPLE (match this shape and energy, do not copy the products unless they are in the transcript):\n${EXAMPLE_CAPTION}\n\nTRANSCRIPT:\n${transcript}`
            : `No keyword. Write a caption with no comment CTA.\n\nTRANSCRIPT:\n${transcript}`,
        },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  const raw = data.content?.map((c) => c.text).join("\n") || "";
  const j = extractJson(raw);
  return {
    line1: sanitizeCaption(j.line1).toUpperCase().slice(0, 22),
    line2: sanitizeCaption(j.line2).toUpperCase().slice(0, 22),
    logos: sanitizeCaption(j.logos),
    caption: spaceCaption(j.caption),
    offer: sanitizeCaption(j.offer || ""),
    source: "anthropic",
  };
}

async function ollamaPack({ transcript, keyword, noCta = false }) {
  const key = process.env.OLLAMA_API_KEY || process.env.OLLAMA_KEY;
  if (!key) return null;
  const base = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
  const preferred = process.env.OLLAMA_TEXT_MODEL || "deepseek-v4-flash:0731";
  const models = [...new Set([preferred, "deepseek-v4-flash:0731", "glm-5.1"])];
  let lastErr;
  for (const model of models) {
    try {
      return await ollamaPackOnce({ transcript, keyword, noCta, key, base, model });
    } catch (e) {
      lastErr = e;
      if (!/410|404|retired/i.test(e.message)) throw e;
    }
  }
  throw lastErr;
}

async function ollamaPackOnce({ transcript, keyword, noCta = false, key, base, model }) {
  const kw = String(keyword || "").toUpperCase();
  const wantCta = !noCta && Boolean(kw);
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(40000),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      messages: [
        {
          role: "system",
          content: captionSystem(wantCta),
        },
        {
          role: "user",
          content: wantCta
            ? `KEYWORD: ${kw}\n\nEXAMPLE:\n${EXAMPLE_CAPTION}\n\nTRANSCRIPT:\n${transcript}`
            : `No keyword. Write a caption with no comment CTA.\n\nTRANSCRIPT:\n${transcript}`,
        },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ollama ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  const raw = data.message?.content || text;
  const j = typeof raw === "object" ? raw : extractJson(raw);
  return {
    line1: sanitizeCaption(j.line1).toUpperCase().slice(0, 22),
    line2: sanitizeCaption(j.line2).toUpperCase().slice(0, 22),
    logos: sanitizeCaption(j.logos),
    caption: spaceCaption(j.caption),
    offer: sanitizeCaption(j.offer || ""),
    source: `ollama:${model}`,
  };
}

export async function draftPack({ transcript, keyword, noCta = false }) {
  const wantCta = !noCta && Boolean(String(keyword || "").trim());
  const fallback = heuristicPack({ transcript, keyword, noCta: !wantCta });
  for (const fn of [ollamaPack, anthropicPack]) {
    try {
      const packed = await fn({ transcript, keyword, noCta: !wantCta });
      if (!packed?.caption) continue;
      if (wantCta && !packed.caption.startsWith("Comment ")) continue;
      if (!wantCta) packed.caption = spaceStoryCaption(stripLeadingCommentCta(packed.caption));
      if (/^COMMENT\b/.test(packed.line1 || "")) {
        packed.line1 = fallback.line1;
        packed.line2 = fallback.line2;
      }
      packed.logos = logosFromTranscript(packed.logos || fallback.logos, transcript);
      packed.threadsCaption = fitThreadsCaption(
        stripHashtags(stripLeadingCommentCta(packed.caption)),
      );
      return packed;
    } catch (e) {
      console.warn(`caption ${fn.name} failed (${e.message})`);
    }
  }
  return fallback;
}
