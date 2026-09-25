/**
 * The workflow catalog the dashboard renders: every automation Social Agents can
 * run today (the four starter pillars), plus the content-marketing
 * workflows on the roadmap for this repo. "Live" is decided against the
 * actual automations list, never assumed.
 */
import { STARTER_CRONS } from '../automations/crons.js';

export type WorkflowPillar = 'content' | 'calendar' | 'engagement' | 'analytics' | 'growth';
export type WorkflowStatus = 'live' | 'available' | 'coming-soon';

export interface WorkflowEntry {
  id: string;
  name: string;
  pillar: WorkflowPillar;
  description: string;
  status: WorkflowStatus;
  /** Human-readable cadence for entries that run on a schedule. */
  cadence?: string;
}

/** 5-field cron → a sentence a creator actually reads. */
export function describeSchedule(schedule: string): string {
  const KNOWN: Record<string, string> = {
    '0 10 * * *': 'daily at 10:00',
    '0 17 * * 0': 'Sundays at 17:00',
    '0 9,15,21 * * *': '3× daily (09/15/21h)',
    '0 8 * * 1': 'Mondays at 08:00',
  };
  return KNOWN[schedule] ?? `cron ${schedule}`;
}

/**
 * Future content-marketing workflows — the roadmap this repo grows into.
 * Shown on the dashboard as coming-soon so users see where Social Agents is headed.
 */
export const FUTURE_WORKFLOWS: WorkflowEntry[] = [
  {
    id: 'trend-scanner',
    name: 'Trend Scanner',
    pillar: 'content',
    description:
      'Scans what is trending in your niche each morning and drops ready-to-shoot content angles into your calendar.',
    status: 'coming-soon',
  },
  {
    id: 'clip-repurposer',
    name: 'Clip Repurposer',
    pillar: 'content',
    description:
      'Turns one long-form video into a week of shortform — cuts, captions, and per-platform framing from the brand pack.',
    status: 'coming-soon',
  },
  {
    id: 'carousel-factory',
    name: 'Carousel Factory',
    pillar: 'content',
    description: 'Converts your best-performing captions and ideas into Instagram carousel scripts on a schedule.',
    status: 'coming-soon',
  },
  {
    id: 'blog-to-thread',
    name: 'Blog → Thread',
    pillar: 'content',
    description: 'Repurposes blog posts and newsletters into X/Threads threads in your voice.',
    status: 'coming-soon',
  },
  {
    id: 'evergreen-recycler',
    name: 'Evergreen Recycler',
    pillar: 'calendar',
    description: 'Finds your evergreen winners and reschedules fresh variants when the calendar has gaps.',
    status: 'coming-soon',
  },
  {
    id: 'best-time-optimizer',
    name: 'Best-Time Optimizer',
    pillar: 'calendar',
    description: 'Continuously re-times the posting schedule against when your audience is actually online.',
    status: 'coming-soon',
  },
  {
    id: 'dm-nurture',
    name: 'DM Nurture Sequences',
    pillar: 'engagement',
    description:
      'Multi-step DM follow-ups after a funnel opt-in — value first, offer later, always with your sign-off on copy.',
    status: 'coming-soon',
  },
  {
    id: 'competitor-watch',
    name: 'Competitor Watch',
    pillar: 'analytics',
    description: 'Weekly digest of competitor content mix, cadence, and hooks — with the gaps you can own.',
    status: 'coming-soon',
  },
  {
    id: 'hook-lab',
    name: 'Hook Lab',
    pillar: 'growth',
    description: 'A/B tests hooks and captions across posts, keeps score, and folds winners back into the brand pack.',
    status: 'coming-soon',
  },
  {
    id: 'monthly-audit',
    name: 'Monthly Content Audit',
    pillar: 'growth',
    description: 'A once-a-month deep read: what compounded, what flopped, and the one strategic move for next month.',
    status: 'coming-soon',
  },
];

/**
 * The full catalog: starter-pillar workflows marked live when their cron
 * shows up in the automations list, everything else available; the
 * roadmap appended as coming-soon.
 */
export function workflowCatalog(automationsListOutput: string): WorkflowEntry[] {
  const listed = automationsListOutput.toLowerCase();
  const pillars: WorkflowEntry[] = STARTER_CRONS.map((cron) => ({
    id: cron.name,
    name: cron.name,
    pillar: cron.pillar,
    description: cron.description,
    status: listed.includes(cron.name.toLowerCase()) ? 'live' : 'available',
    cadence: describeSchedule(cron.schedule),
  }));
  return [...pillars, ...FUTURE_WORKFLOWS];
}
