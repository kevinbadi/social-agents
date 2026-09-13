import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { resolveResourceUrls } from "@/lib/comments/dm-copy";
import { createAgentPost, listAgentPosts } from "@/lib/agent-posts/store";
import {
  isAllowedAgentPostProfile,
  listAgentPostTargets,
} from "@/lib/agent-posts/targets";
import { kickAgentPostDrain } from "@/lib/agent-posts/run";
import { withNextSlots } from "@/lib/agent-posts/slots";

export const runtime = "nodejs";
export const maxDuration = 300;

async function requireSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token);
}

export async function GET() {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  kickAgentPostDrain();
  const [jobs, targets] = await Promise.all([
    listAgentPosts(40),
    listAgentPostTargets().then(withNextSlots),
  ]);
  return NextResponse.json({ jobs, targets });
}

export async function POST(req: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    videoUrl?: string;
    resourceUrl?: string;
    dmNote?: string;
    title?: string;
    caption?: string;
    profileId?: string;
    profileIds?: string[];
  };
  try {
    body = (await req.json()) as {
      videoUrl?: string;
      resourceUrl?: string;
      dmNote?: string;
      title?: string;
      caption?: string;
      profileId?: string;
      profileIds?: string[];
    };
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const videoUrl = String(body.videoUrl ?? "").trim();
  const resourceRaw = String(body.resourceUrl ?? "").trim();
  const title = String(body.title ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .trim()
    .slice(0, 100);
  const caption = String(body.caption ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .trim()
    .slice(0, 2200);
  if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
    return NextResponse.json(
      { error: "Add a video file or a direct video URL." },
      { status: 400 },
    );
  }
  const urls = resourceRaw ? resolveResourceUrls(resourceRaw) : [];
  if (resourceRaw && urls.length === 0) {
    return NextResponse.json(
      {
        error:
          "That DM resource link is not a URL, /go/slug, or slug. Leave it blank if this post has no comment-to-DM.",
      },
      { status: 400 },
    );
  }

  const targets = await listAgentPostTargets();
  const profileIds = [
    ...new Set(
      [
        ...(Array.isArray(body.profileIds) ? body.profileIds : []),
        body.profileId,
      ]
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    ),
  ];
  if (
    profileIds.length === 0 ||
    profileIds.some((id) => !isAllowedAgentPostProfile(id, targets))
  ) {
    return NextResponse.json(
      { error: "Pick which socials to post to." },
      { status: 400 },
    );
  }

  try {
    const jobs = [];
    for (const profileId of profileIds) {
      jobs.push(
        await createAgentPost({
          profileId,
          videoUrl,
          resourceUrl: urls.join("\n"),
          dmNote: String(body.dmNote ?? "").trim().slice(0, 800) || null,
          youtubeTitle: title || null,
          caption: caption || null,
        }),
      );
    }
    kickAgentPostDrain();
    return NextResponse.json({ job: jobs[0], jobs });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not queue the post." },
      { status: 500 },
    );
  }
}
