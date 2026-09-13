import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { dbConfigured, query } from "@/lib/insforge/db";
import { ttlGet, ttlSet, ttlDel } from "@/lib/cache/ttl";
import type { Channel, ChannelType } from "./types";

export const ACTIVE_CHANNEL_COOKIE = "mos_channel";

type ChannelRow = {
  id: string;
  name: string;
  type: ChannelType;
  color: string | null;
  subtitle: string | null;
  revenuecat_project_id: string | null;
  revenuecat_api_key: string | null;
  posthog_project_id: string | null;
  posthog_host: string | null;
  profile_ids: string[] | null;
};

// Shown only when the DB isn't configured yet (keeps the UI alive locally).
const PLACEHOLDER_CHANNELS: Channel[] = [
  {
    id: "personal",
    name: "Kev Builds Apps",
    type: "personal",
    color: "#D9F76A",
    subtitle: "@kevbuildsapps · personal brand",
    zernioProfileIds: ["6a5433887b02644ff445cbb6"],
  },
  {
    id: "app-1",
    name: "Creator OS",
    type: "app",
    color: "#7AC0FF",
    subtitle: "Multiple accounts",
    zernioProfileIds: [],
  },
  {
    id: "app-hoopsai",
    name: "Hoops AI",
    type: "app",
    color: "#FF5A1F",
    subtitle: "AI basketball coach",
    zernioProfileIds: [],
  },
];

const CHANNELS_CACHE_KEY = "channels:list";

export const listChannels = cache(async function listChannels(): Promise<Channel[]> {
  const cached = ttlGet<Channel[]>(CHANNELS_CACHE_KEY);
  if (cached) return cached;
  if (!dbConfigured) return PLACEHOLDER_CHANNELS;

  const rows = await query<ChannelRow>(
    `select c.id, c.name, c.type, c.color, c.subtitle, c.revenuecat_project_id,
            c.revenuecat_api_key, c.posthog_project_id, c.posthog_host,
            coalesce(
              array_agg(cp.zernio_profile_id) filter (where cp.zernio_profile_id is not null),
              '{}'
            ) as profile_ids
       from channels c
       left join channel_profiles cp on cp.channel_id = c.id
      group by c.id
      order by c.position, c.created_at`,
  );

  const channels = rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    color: r.color ?? undefined,
    subtitle: r.subtitle ?? undefined,
    revenuecatProjectId: r.revenuecat_project_id ?? undefined,
    revenuecatApiKey: r.revenuecat_api_key ?? undefined,
    posthogProjectId: r.posthog_project_id ?? undefined,
    posthogHost: r.posthog_host ?? undefined,
    zernioProfileIds: r.profile_ids ?? [],
  }));
  ttlSet(CHANNELS_CACHE_KEY, channels, 30_000);
  return channels;
});

export function invalidateChannelsCache(): void {
  ttlDel(CHANNELS_CACHE_KEY);
}

export const getActiveChannel = cache(async function getActiveChannel(): Promise<Channel | null> {
  const channels = await listChannels();
  if (channels.length === 0) return null;
  const store = await cookies();
  const id = store.get(ACTIVE_CHANNEL_COOKIE)?.value;
  return channels.find((c) => c.id === id) ?? channels[0];
});
