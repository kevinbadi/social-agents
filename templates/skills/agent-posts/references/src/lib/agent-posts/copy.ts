import "server-only";
import { fitTwitterCaption, fitThreadsCaption, stripHashtags } from "@/lib/twitter-caption";

export type PlatformCopy = {
  caption: string;
  youtubeTitle: string;
  youtubeDescription: string;
  twitterCaption: string;
  linkedinCaption: string;
  threadsCaption: string;
  dmText: string;
  commentReply: string;
};

function sanitize(s: string): string {
  return String(s || "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+-{2,}\s+/g, " - ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** CTA on its own line, then short body paragraphs with a blank line between each. */
function spaceCaption(caption: string): string {
  const text = sanitize(caption);
  const breakAt = text.search(/\n/);
  if (breakAt < 0) return text;
  const first = text.slice(0, breakAt).trim();
  const rest = text.slice(breakAt).trim();
  if (!rest) return first;
  const parts = rest.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const body =
    parts.length >= 2
      ? parts.join("\n\n")
      : (() => {
          const sents = splitSentences(parts[0] || rest);
          if (sents.length <= 2) return sents.join(" ");
          const paras: string[] = [];
          for (let i = 0; i < sents.length; i += 2) {
            paras.push(sents.slice(i, i + 2).join(" "));
          }
          return paras.join("\n\n");
        })();
  return `${first}\n\n${body}`;
}

function extractJson(raw: string): Record<string, string> {
  let s = String(raw || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no JSON in model reply");
  return JSON.parse(s.slice(start, end + 1)) as Record<string, string>;
}

function firstLine(caption: string): string {
  return caption.split(/\n/)[0]?.trim() || caption;
}

export function isCommentCtaLine(line: string): boolean {
  const t = line.trim();
  return (
    /^comment\s+["“'][^"”']+["”']/i.test(t) ||
    /^comment\s+[A-Z0-9]{2,}\s+to\s+/i.test(t)
  );
}

/** Body of the IG caption with the comment-to-DM hook stripped. */
export function captionWithoutCommentCta(caption: string): string {
  const text = sanitize(caption);
  const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const part of parts) {
    const lines = part.split("\n");
    if (isCommentCtaLine(lines[0] || "")) {
      const rest = lines.slice(1).join("\n").trim();
      if (rest) kept.push(rest);
      continue;
    }
    if (/^comment\s+"[^"]+"\s+if you want/i.test(part)) continue;
    kept.push(part);
  }
  return kept.join("\n\n").trim();
}

function storyOrFallback(text: string, fallback: string): string {
  const stripped = captionWithoutCommentCta(text);
  if (!stripped || isCommentCtaLine(firstLine(stripped))) return fallback;
  return stripped;
}

function stripTrailingCtas(text: string): string {
  const paras = sanitize(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  while (paras.length > 1) {
    const last = paras[paras.length - 1];
    if (
      /^(get the |grab the |comment |drop a comment|link in bio|i'?ll dm|i will dm|check (your )?dms)/i.test(
        last,
      )
    ) {
      paras.pop();
      continue;
    }
    break;
  }
  return paras.join("\n\n").trim();
}

/** Informational Twitter/Threads body: no comment CTA, no hashtags, no closer CTA. */
export function prepareStoryCaption(text: string, fallback = ""): string {
  const fromText = stripTrailingCtas(
    stripHashtags(captionWithoutCommentCta(text) || text),
  );
  if (fromText && !isCommentCtaLine(firstLine(fromText))) return fromText;
  return stripTrailingCtas(
    stripHashtags(captionWithoutCommentCta(fallback) || fallback),
  );
}

export function captionForTwitter(text: string, fallback = ""): string {
  return fitTwitterCaption(prepareStoryCaption(text, fallback));
}

export function captionForThreads(text: string, fallback = ""): string {
  return fitThreadsCaption(prepareStoryCaption(text, fallback));
}

function fallbackCopy(input: {
  keyword: string;
  caption: string;
  resourceUrl: string;
}): PlatformCopy {
  const keyword = input.keyword.toUpperCase();
  const caption = spaceCaption(input.caption);
  const hook = firstLine(caption);
  const story = captionWithoutCommentCta(caption) || caption;
  const youtubeTitle = sanitize(hook.replace(/^Comment\s+"[^"]+"\s+to\s+get\s+/i, ""))
    .slice(0, 96) || story.split("\n")[0]?.slice(0, 96) || keyword;
  const dmText = sanitize(
    `you commented "${keyword}". here's the resource from the video:`,
  );
  return {
    caption,
    youtubeTitle: youtubeTitle.slice(0, 100),
    youtubeDescription: story,
    twitterCaption: captionForTwitter(story),
    linkedinCaption: story,
    threadsCaption: captionForThreads(story),
    dmText,
    commentReply: "Sent it - check your DMs.",
  };
}

async function anthropicCopy(input: {
  keyword: string;
  caption: string;
  transcript: string;
  userProvided?: boolean;
}): Promise<Partial<PlatformCopy> | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(18000),
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1400,
      temperature: 0.3,
      system: [
        "You write social copy for kevbuildsapps talking-head videos.",
        "No em dashes, no en dashes, no emoji.",
        "instagramCaption is already written. Do not rewrite it. Use it as youtubeDescription.",
        "If the caption was written by Kevin, treat it as the source of truth. Do not invent a different topic from the transcript.",
        "youtubeTitle: punchy, under 90 characters, no quotes around the keyword unless natural. No comment CTA.",
        "twitterCaption: one tweet packed with the actual information from the video. Hook, then facts. X has no comment-to-DM and hashtags do nothing. Never say comment a word, mention DMs, or include hashtags.",
        "linkedinCaption: one field (LinkedIn has no title). First-person, professional-casual. No comment CTA.",
        "threadsCaption: under 480 characters. Same as twitter: the interesting beats from the video, no comment CTA, no DMs, no hashtags.",
        "dmText: lowercase casual, under 220 chars, no URL and no follow ask (the system appends the link and a follow P.S.).",
        "commentReply: public IG/FB reply when someone comments the keyword. Under 80 chars.",
        'Return ONLY JSON: {"youtubeTitle":"","twitterCaption":"","linkedinCaption":"","threadsCaption":"","dmText":"","commentReply":""}',
      ].join(" "),
      messages: [
        {
          role: "user",
          content: `${input.userProvided ? "KEVIN WROTE THIS CAPTION. Stay on this topic.\n\n" : ""}KEYWORD: ${input.keyword}\n\nINSTAGRAM CAPTION:\n${input.caption}\n\nTRANSCRIPT:\n${input.transcript.slice(0, 4000)}`,
        },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { content?: { text?: string }[] };
  const raw = data.content?.map((c) => c.text || "").join("\n") || "";
  return extractJson(raw);
}

async function ollamaCopy(input: {
  keyword: string;
  caption: string;
  transcript: string;
  userProvided?: boolean;
}): Promise<Partial<PlatformCopy> | null> {
  const key = process.env.OLLAMA_API_KEY || process.env.OLLAMA_KEY;
  if (!key) return null;
  const base = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
  const model = process.env.OLLAMA_TEXT_MODEL || "deepseek-v4-flash:0731";
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
          content: [
            "Write kevbuildsapps platform copy. Output ONLY JSON.",
            "No em dashes. No emoji. No URL and no follow ask in dmText.",
            "twitterCaption and threadsCaption: informational only. No comment CTA, no DMs, no hashtags.",
            "twitterCaption, linkedinCaption, and threadsCaption must not say to comment a word.",
            '{"youtubeTitle":"","twitterCaption":"","linkedinCaption":"","threadsCaption":"","dmText":"","commentReply":""}',
          ].join(" "),
        },
        {
          role: "user",
          content: `${input.userProvided ? "KEVIN WROTE THIS CAPTION. Stay on this topic.\n\n" : ""}KEYWORD: ${input.keyword}\n\nCAPTION:\n${input.caption}\n\nTRANSCRIPT:\n${input.transcript.slice(0, 3000)}`,
        },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ollama ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { message?: { content?: string } };
  return extractJson(data.message?.content || text);
}

export async function draftPlatformCopy(input: {
  keyword: string;
  caption: string;
  transcript: string;
  resourceUrl: string;
  userProvided?: boolean;
}): Promise<PlatformCopy> {
  const base = fallbackCopy(input);
  for (const fn of [ollamaCopy, anthropicCopy]) {
    try {
      const packed = await fn(input);
      if (!packed) continue;
      const youtubeTitle = sanitize(packed.youtubeTitle || base.youtubeTitle).slice(0, 100);
      if (!youtubeTitle) continue;
      const story = captionWithoutCommentCta(base.caption) || base.caption;
      return {
        caption: base.caption,
        youtubeTitle: isCommentCtaLine(youtubeTitle)
          ? base.youtubeTitle
          : youtubeTitle,
        youtubeDescription: story,
        twitterCaption: captionForTwitter(
          packed.twitterCaption || "",
          story,
        ),
        linkedinCaption: storyOrFallback(
          packed.linkedinCaption || "",
          story,
        ),
        threadsCaption: captionForThreads(
          packed.threadsCaption || "",
          story,
        ),
        dmText: sanitize(packed.dmText || base.dmText).slice(0, 400),
        commentReply: sanitize(packed.commentReply || base.commentReply).slice(0, 220),
      };
    } catch (e) {
      console.warn(
        `[agent-posts] copy ${fn.name} failed:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return base;
}
