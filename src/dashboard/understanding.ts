/**
 * The agent's understanding, composed for the dashboard's Agent panel:
 * who the agent is (persona), what it's driving toward (objective +
 * KPIs), how it handles comments and messages, and what the account is
 * actually selling. Everything here is read from the same files the
 * agent reads — full transparency, nothing invented.
 */
import type { SocialAgentsConfig, EngagementObjective } from '../config/socialAgentsConfig.js';
import type { ActivitySummary } from '../util/activityLog.js';

export interface BrandUnderstanding {
  about: string | null;
  offers: Array<{ description: string; link?: string }>;
  voice: { soundsLike: string[]; never: string | null; emojiPolicy: string | null; hashtagPolicy: string | null };
  audience: string | null;
  competitors: string[];
}

/**
 * Parse social-agents/BRAND.md (the renderBrandMd format) back into structure.
 * Tolerant of edits: sections are matched by heading prefix, and anything
 * unrecognized simply comes back null — the UI shows "not set" honestly.
 */
export function parseBrandMd(md: string): BrandUnderstanding {
  const sections = new Map<string, string[]>();
  let current = '';
  for (const line of md.split('\n')) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      current = (heading[1] ?? '').toLowerCase();
      sections.set(current, []);
      continue;
    }
    if (current) sections.get(current)!.push(line);
  }
  const section = (prefix: string): string[] => {
    for (const [key, lines] of sections) if (key.startsWith(prefix)) return lines;
    return [];
  };
  const text = (prefix: string): string | null => {
    const body = section(prefix)
      .filter((l) => !l.startsWith('#') && !l.trim().startsWith('_'))
      .join('\n')
      .trim();
    return body || null;
  };
  const bullets = (prefix: string): string[] =>
    section(prefix)
      .map((l) => l.match(/^\s*[-*]\s+(.*)$/)?.[1])
      .filter((v): v is string => Boolean(v));

  const offers = bullets('what we sell')
    .filter((b) => !b.startsWith('_'))
    .map((b) => {
      // renderBrandMd writes "description — link" (or "description _(no link yet)_")
      const parts = b.split(' — ');
      const last = parts[parts.length - 1] ?? '';
      if (parts.length > 1 && /^https?:\/\//.test(last)) {
        return { description: parts.slice(0, -1).join(' — '), link: last };
      }
      return { description: b.replace(/_\(no link yet\)_/, '').trim() };
    });

  const voiceField = (label: string): string | null => {
    const row = bullets('voice').find((b) => b.toLowerCase().startsWith(label));
    return row ? row.slice(row.indexOf(':') + 1).trim() : null;
  };

  const competitors = bullets('competitors').filter((b) => !b.startsWith('_'));

  return {
    about: text('what this brand is about'),
    offers,
    voice: {
      soundsLike: (voiceField('sounds like') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      never: voiceField('never'),
      emojiPolicy: voiceField('emoji'),
      hashtagPolicy: voiceField('hashtag'),
    },
    audience: text('target audience'),
    competitors,
  };
}

const OBJECTIVE_LABELS: Record<EngagementObjective, { label: string; drives: string }> = {
  'book-calls': { label: 'Book calls', drives: 'Every comment and DM conversation steers toward getting the booking link shared and a call on the calendar.' },
  funnel: { label: 'Funnel to website / app', drives: 'Every conversation steers people toward the configured link — comments trigger DMs, DMs carry the destination.' },
  'free-value': { label: 'Give free value', drives: 'Every conversation leads with the freebie — value first, so the audience comes back warm.' },
  rapport: { label: 'Build rapport & community', drives: 'Every reply is about relationship: fast, personal, on-voice responses that make followers feel seen.' },
  other: { label: 'Custom objective', drives: 'The agent steers conversations toward the custom objective described below.' },
};

export interface Kpi {
  label: string;
  value: string;
  sub: string;
  /** 'good' | 'idle' | 'bad' — the Creator OS status triple. */
  state: 'good' | 'idle' | 'bad';
}

/**
 * The KPIs the agent is judged on, with live numbers from the activity
 * log. Universal engagement KPIs plus a north-star framed by the
 * configured objective.
 */
export function deriveKpis(config: SocialAgentsConfig | null, summary: ActivitySummary): Kpi[] {
  const { week, today } = summary;
  const attempted = week.actions;
  const failRate = attempted ? Math.round((week.failed / attempted) * 100) : 0;
  const objective = config?.engagementAgent?.objective;

  const kpis: Kpi[] = [
    {
      label: 'Comments answered',
      value: String(week.replies),
      sub: `${today.replies} today · last 7 days`,
      state: week.replies > 0 ? 'good' : 'idle',
    },
    {
      label: 'DMs sent',
      value: String(week.dms),
      sub: `${today.dms} today · last 7 days`,
      state: week.dms > 0 ? 'good' : 'idle',
    },
    {
      label: 'Posts published',
      value: String(week.posts),
      sub: `${today.posts} today · last 7 days`,
      state: week.posts > 0 ? 'good' : 'idle',
    },
    {
      label: 'Failure rate',
      value: `${failRate}%`,
      sub: `${week.failed} failed of ${attempted} actions · last 7 days`,
      state: failRate === 0 ? 'good' : failRate < 10 ? 'idle' : 'bad',
    },
  ];

  if (objective === 'book-calls' || objective === 'funnel' || objective === 'free-value') {
    kpis.push({
      label: objective === 'book-calls' ? 'Link shares (calls)' : objective === 'funnel' ? 'Funnel sends' : 'Freebies delivered',
      value: String(week.dms),
      sub: 'DM conversations carrying the destination · last 7 days',
      state: week.dms > 0 ? 'good' : 'idle',
    });
  }
  return kpis;
}

export function describeObjective(objective: EngagementObjective | undefined): { label: string; drives: string } | null {
  return objective ? OBJECTIVE_LABELS[objective] : null;
}

/** The four pillars — the agent's standing mission, verbatim from its prompt. */
export const MISSION_PILLARS = [
  'Post content at scale with AI',
  'Run everything on automations',
  'Auto-reply to comments and messages',
  'Monitor analytics',
];
