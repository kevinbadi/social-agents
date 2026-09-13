export const AGENT_POST_STATUSES = [
  "queued",
  "working",
  "scheduled",
  "published",
  "failed",
] as const;
export type AgentPostStatus = (typeof AGENT_POST_STATUSES)[number];

export const KEV_BUILDS_APPS_PROFILE_ID = "6a5433887b02644ff445cbb6";
export const KEV_AI_PROFILE_ID = "6a3c2e608a72819a4bb53f95";

/** Friendlier names for the Zernio profiles on the Kev Builds Apps tab. */
export const AGENT_POST_TARGET_NAMES: Record<string, string> = {
  [KEV_BUILDS_APPS_PROFILE_ID]: "Kev Builds Apps",
  [KEV_AI_PROFILE_ID]: "Kev AI",
};

export function agentPostTargetName(profileId: string, fallback = "Socials"): string {
  return AGENT_POST_TARGET_NAMES[profileId] || fallback;
}

export type AgentPostTarget = {
  profileId: string;
  name: string;
  handles: string[];
  platforms: string[];
  nextSlot: string | null;
};

export type AgentPost = {
  id: string;
  status: AgentPostStatus;
  step: string | null;
  error: string | null;
  profileId: string;
  videoUrl: string;
  resourceUrl: string;
  dmNote: string | null;
  transcript: string | null;
  keyword: string | null;
  caption: string | null;
  youtubeTitle: string | null;
  youtubeDescription: string | null;
  twitterCaption: string | null;
  linkedinCaption: string | null;
  threadsCaption: string | null;
  dmText: string | null;
  commentReply: string | null;
  thumbnailUrl: string | null;
  scheduledFor: string | null;
  zernioPostId: string | null;
  followupZernioPostId: string | null;
  commentDmStatus: string | null;
  createdAt: string;
  updatedAt: string;
};
