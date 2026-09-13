import "server-only";
import { normalizeAccount } from "@/components/SocialAccounts";
import { listChannels } from "@/lib/channels/store";
import { listAccounts, listProfiles } from "@/lib/zernio/client";
import { AGENT_POSTS_PROFILE_ID } from "./store";
import {
  AGENT_POST_TARGET_NAMES,
  agentPostTargetName,
  type AgentPostTarget,
} from "./types";

export const AGENT_POSTS_CHANNEL_ID = "personal";

function unique(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

async function targetProfileIds(profiles: { _id: string }[]): Promise<string[]> {
  // Creator OS mode: the key issued at https://www.creatoros.ca/ is scoped to
  // the user's own Zernio profile(s), so every profile the key can see is a
  // target. CREATOR_OS_PROFILE_ID pins one explicitly.
  if (process.env.CREATOR_OS_API_KEY) {
    const pinned = (process.env.CREATOR_OS_PROFILE_ID ?? "").trim();
    if (pinned) return [pinned];
    return unique(profiles.map((p) => p._id));
  }
  // Legacy dashboard mode: hard-coded profile + the personal channel's profiles.
  const channels = await listChannels().catch(() => []);
  const channel =
    channels.find((c) => c.id === AGENT_POSTS_CHANNEL_ID) ??
    channels.find((c) => c.type === "personal");
  return unique([AGENT_POSTS_PROFILE_ID, ...(channel?.zernioProfileIds ?? [])]);
}

export async function listAgentPostTargets(): Promise<AgentPostTarget[]> {
  const profiles = await listProfiles().catch(() => []);
  const ids = await targetProfileIds(profiles);
  if (!ids.length) return [];

  const accountLists = await Promise.all(
    ids.map((id) => listAccounts(id).catch(() => [])),
  );
  const nameById = new Map(profiles.map((p) => [p._id, p.name]));

  return ids.map((profileId, i) => {
    const accounts = (accountLists[i] ?? [])
      .filter((a) => a.isActive !== false)
      .map(normalizeAccount);
    const handles = unique(
      accounts
        .map((a) => a.username)
        .filter((u): u is string => Boolean(u))
        .map((u) => `@${u.replace(/^@/, "")}`),
    ).slice(0, 3);
    const platforms = unique(accounts.map((a) => a.platform.toLowerCase()));
    return {
      profileId,
      name: agentPostTargetName(
        profileId,
        AGENT_POST_TARGET_NAMES[profileId] || nameById.get(profileId) || "Socials",
      ),
      handles,
      platforms,
      nextSlot: null,
    };
  });
}

export function isAllowedAgentPostProfile(
  profileId: string,
  targets: AgentPostTarget[],
): boolean {
  return targets.some((t) => t.profileId === profileId);
}
