/**
 * The storage port. State that must survive the local↔Railway split — the
 * run journal and the content pipeline — goes through this interface.
 * Agent, worker, and dashboard code against the port, never against files:
 * today's adapter is JSONL on disk (jsonlStore.ts); when the always-on
 * worker needs shared durable state, a Postgres adapter replaces it
 * without touching callers.
 *
 * Deliberately NOT behind this port: brand pack, skills, config — those
 * are human-edited files and stay files forever.
 */

export type RunStatus = 'running' | 'ok' | 'failed' | 'skipped';

/** One scheduled-automation run, start to finish. */
export interface RunRecord {
  /** Unique per run — `${automation}-${startedAt}` works fine. */
  id: string;
  /** Automation name, e.g. engagement-sweep. */
  automation: string;
  /** The skill the run executes, e.g. respond-to-comments. */
  skill: string;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  /** One-line human summary of what the run did. */
  summary?: string;
  error?: string;
  source: 'worker' | 'local';
}

export type ContentStatus = 'draft' | 'approved' | 'scheduled' | 'published' | 'failed';

/** One piece of content moving through the pipeline (the future content hub). */
export interface ContentItem {
  id: string;
  title: string;
  status: ContentStatus;
  caption?: string;
  /** Path or URL of the media asset. */
  mediaPath?: string;
  platforms?: string[];
  /** CreatorOS post id once published/scheduled. */
  postId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunQuery {
  automation?: string;
  status?: RunStatus;
  limit?: number;
}

export interface ContentQuery {
  status?: ContentStatus;
  limit?: number;
}

export interface SocialAgentsStore {
  /** Upsert by id — record 'running' at start, overwrite with the outcome at finish. */
  recordRun(run: RunRecord): Promise<void>;
  /** Newest first. */
  listRuns(query?: RunQuery): Promise<RunRecord[]>;
  /** Upsert by id. */
  saveContentItem(item: ContentItem): Promise<void>;
  /** Newest updatedAt first. */
  listContentItems(query?: ContentQuery): Promise<ContentItem[]>;
}
