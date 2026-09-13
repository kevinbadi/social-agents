-- Live schema dump (Insforge Postgres), 2026-09-13

CREATE TABLE IF NOT EXISTS agent_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'queued'::text,
  step text,
  error text,
  profile_id text NOT NULL,
  video_url text NOT NULL,
  resource_url text NOT NULL,
  transcript text,
  keyword text,
  caption text,
  youtube_title text,
  youtube_description text,
  twitter_caption text,
  linkedin_caption text,
  threads_caption text,
  dm_text text,
  comment_reply text,
  thumbnail_url text,
  scheduled_for timestamp with time zone,
  zernio_post_id text,
  comment_dm_status text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  dm_note text,
  followup_zernio_post_id text
);
CREATE UNIQUE INDEX agent_posts_pkey ON public.agent_posts USING btree (id);
CREATE INDEX agent_posts_status_created ON public.agent_posts USING btree (status, created_at);
CREATE INDEX agent_posts_profile_slot ON public.agent_posts USING btree (profile_id, scheduled_for) WHERE ((scheduled_for IS NOT NULL) AND (status <> 'failed'::text));

CREATE TABLE IF NOT EXISTS comment_dm_setups (
  id bigint NOT NULL DEFAULT nextval('comment_dm_setups_id_seq'::regclass),
  zernio_post_id text NOT NULL,
  profile_id text NOT NULL,
  account_id text NOT NULL,
  platform text NOT NULL,
  platform_post_id text,
  keyword text NOT NULL,
  dm_message text NOT NULL DEFAULT ''::text,
  resource_url text NOT NULL,
  zernio_automation_id text,
  status text NOT NULL DEFAULT 'pending'::text,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  wired_at timestamp with time zone,
  comment_reply text NOT NULL DEFAULT 'Awesome, check DMs!'::text,
  scheduled_for timestamp with time zone
);
CREATE UNIQUE INDEX comment_dm_setups_pkey ON public.comment_dm_setups USING btree (id);
CREATE UNIQUE INDEX comment_dm_setups_post_account ON public.comment_dm_setups USING btree (zernio_post_id, account_id);
CREATE INDEX comment_dm_setups_pending_due ON public.comment_dm_setups USING btree (scheduled_for, created_at) WHERE (status = 'pending'::text);

CREATE TABLE IF NOT EXISTS publish_claims (
  claim text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX publish_claims_pkey ON public.publish_claims USING btree (claim);

CREATE TABLE IF NOT EXISTS channels (
  id text NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  pattern text NOT NULL,
  description text,
  type text NOT NULL,
  webhook_urls ARRAY,
  color text,
  subtitle text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  position integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  revenuecat_project_id text,
  revenuecat_api_key text,
  posthog_project_id text,
  posthog_host text
);
CREATE UNIQUE INDEX channels_pkey ON public.channels USING btree (id);
CREATE UNIQUE INDEX channels_pkey ON realtime.channels USING btree (id);
CREATE UNIQUE INDEX channels_pattern_key ON realtime.channels USING btree (pattern);
CREATE INDEX idx_realtime_channels_pattern ON realtime.channels USING btree (pattern);
CREATE INDEX idx_realtime_channels_enabled ON realtime.channels USING btree (enabled);

CREATE TABLE IF NOT EXISTS channel_profiles (
  channel_id text NOT NULL,
  zernio_profile_id text NOT NULL,
  api_key text,
  api_key_name text,
  api_key_preview text
);
CREATE UNIQUE INDEX channel_profiles_pkey ON public.channel_profiles USING btree (channel_id, zernio_profile_id);

