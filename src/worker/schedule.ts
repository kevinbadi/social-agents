/**
 * Strict 5-field cron parsing and next-run calculation for the worker's
 * in-process scheduler. Supports numbers, ranges (1-5), lists (9,15,21),
 * steps (*\/15, 1-9/2), and *. No month/day names — same rule the rest of
 * Social Agents already enforces ("no MON/JAN names").
 *
 * All times UTC-naive against the provided Date: the worker converts the
 * user's timezone at a higher level by running the container in TZ=<zone>
 * (Railway respects the TZ env var), which keeps this module pure math.
 */

export interface CronSpec {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  /** '*' day fields are unrestricted — matters for the dom/dow OR rule. */
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseField(field: string, min: number, max: number, label: string): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad cron ${label}: "${part}"`);
    let lo: number;
    let hi: number;
    if (rangePart === '*' || rangePart === '') {
      lo = min;
      hi = max;
    } else if (rangePart!.includes('-')) {
      const [a, b] = rangePart!.split('-').map(Number);
      lo = a!;
      hi = b!;
    } else {
      lo = Number(rangePart);
      hi = stepPart === undefined ? lo : max;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`Bad cron ${label}: "${part}" (allowed ${min}-${max})`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

export function parseCron(expression: string): CronSpec {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron needs exactly 5 fields, got ${fields.length}: "${expression}"`);
  }
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  // Cron's 0 and 7 both mean Sunday — normalize to 0.
  const daysOfWeek = new Set([...parseField(dow, 0, 7, 'day-of-week')].map((d) => (d === 7 ? 0 : d)));
  return {
    minutes: parseField(minute, 0, 59, 'minute'),
    hours: parseField(hour, 0, 23, 'hour'),
    daysOfMonth: parseField(dom, 1, 31, 'day-of-month'),
    months: parseField(month, 1, 12, 'month'),
    daysOfWeek,
    domRestricted: dom !== '*',
    dowRestricted: dow !== '*',
  };
}

function dayMatches(spec: CronSpec, date: Date): boolean {
  const domOk = spec.daysOfMonth.has(date.getDate());
  const dowOk = spec.daysOfWeek.has(date.getDay());
  // Standard cron rule: when BOTH day fields are restricted, either matching fires.
  if (spec.domRestricted && spec.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

/** The next fire time strictly after `from`. Throws if none within 5 years (impossible spec). */
export function nextRun(expression: string | CronSpec, from: Date): Date {
  const spec = typeof expression === 'string' ? parseCron(expression) : expression;
  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = from.getTime() + 5 * 366 * 24 * 3_600_000;
  while (candidate.getTime() <= limit) {
    if (!spec.months.has(candidate.getMonth() + 1)) {
      candidate.setDate(1);
      candidate.setMonth(candidate.getMonth() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(spec, candidate)) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }
    if (!spec.hours.has(candidate.getHours())) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!spec.minutes.has(candidate.getMinutes())) {
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
      continue;
    }
    return candidate;
  }
  throw new Error(`Cron never fires: "${typeof expression === 'string' ? expression : 'spec'}"`);
}
