import "server-only";
import { spawn } from "child_process";
import path from "path";
import { CONTENT_JOBS, hourTagET, jobHoursET, type ContentJob } from "./registry";
import { dbConfigured, query } from "@/lib/insforge/db";

// In-process schedulers for the content jobs declared in ./registry — one
// independent DST-aware timer per job×ET-hour, overlap-guarded, re-armed on
// every boot. Children are plain node scripts that exit non-zero on failure
// (exit 2 = QA blocked publish); results are verified out-of-band via the
// `content_posts` table, which the Overview automations timeline reads.
//
// Adding a cron = one entry in registry.ts + `<PREFIX>_CRON_ENABLED=1` on the
// Railway web service (hours via `<PREFIX>_CRON_HOURS_ET`, default in the
// registry). The dashboard timeline updates automatically — same registry.
//
// RUNTIME FILES: anything a job reads must live under .claude/assets/ or
// .claude/skills/ — .claude/brand-content is gitignored and does NOT deploy
// (that gap silently killed the Jul 2–4 Danny runs with ENOENT).

let started = false;
const running = new Set<string>();

function runJob(job: ContentJob, hour: number, slot: number) {
  const key = `${job.name}:${hour}`;
  if (running.has(key)) return; // never overlap the same job+hour
  running.add(key);
  const script = path.join(process.cwd(), ...job.script.split("/"));
  console.log(`[${job.name}:${hourTagET(hour)}] running (slot ${slot})`);
  const child = spawn(process.execPath, [script, ...job.args(slot)], { env: process.env, stdio: "inherit" });
  child.on("close", (code) => {
    running.delete(key);
    console.log(`[${job.name}:${hourTagET(hour)}] finished (exit ${code})${code === 2 ? " — QA blocked publish, review qa.json" : ""}`);
  });
  child.on("error", (e) => {
    running.delete(key);
    console.error(`[${job.name}:${hourTagET(hour)}] failed to start:`, e.message);
  });
}

/** Milliseconds until the next HH:MM in America/New_York (DST-aware).
 *  `hour` may be fractional (0.5 = 00:30). */
function msUntilHourET(hour: number): number {
  const now = Date.now();
  const targetH = Math.floor(hour);
  const targetM = Math.round((hour - targetH) * 60);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // Walk forward minute-by-minute (≤ 24h); immune to DST edge cases.
  for (let m = 1; m <= 24 * 60; m++) {
    const t = new Date(now + m * 60_000);
    const [h, min] = fmt.format(t).split(":").map(Number);
    if (h === targetH && min === targetM) return t.getTime() - now;
  }
  return 24 * 3600_000;
}

// ── Watchdog: self-heal overdue slots ────────────────────────────────────────
// Deploys restart this process, killing in-flight jobs and skipping slots that
// pass during boot (that's how 2026-07-06 evening lost megan-daily 18h). Every
// 30 min the watchdog looks for enabled job×slots whose ET hour passed ≥30 min
// ago today WITHOUT a verification row since the slot time, and re-runs them.
// One attempt per job×slot×day — a job dead on upstream billing shouldn't
// retry-loop; it stays red until the account is topped up.
const caughtUp = new Set<string>();

function etParts(at = new Date()): { date: string; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour, 10) % 24,
    minute: parseInt(parts.minute, 10),
  };
}

async function slotVerified(job: ContentJob, etDate: string, hour: number): Promise<boolean> {
  if (job.verify === "snapshots" || job.verify === "followers") {
    // Per SLOT, not per day: both jobs upsert one row per (day, key), so the
    // 9 AM capture used to mask a failed 9 PM one and the watchdog never
    // re-ran it (2026-09-10: Zernio 503 at 21:00 → Thursday's follower
    // growth read 0). A slot counts only when the day's rows were touched at
    // or after its start time.
    const table = job.verify === "snapshots" ? "analytics_snapshots" : "follower_snapshots";
    const rows = await query<{ n: number }>(
      `select 1 as n from ${table}
        where snapshot_date = $1::date
          and (captured_at at time zone 'America/New_York') >= ($1::date + make_interval(mins => $2))
        limit 1`,
      [etDate, Math.round(hour * 60)],
    );
    return rows.length > 0;
  }
  if (job.verify === "rc_subs") {
    // Sweep freshness — synced_at is stamped on every upsert.
    const rows = await query<{ n: number }>(
      `select 1 as n from revenuecat_subscriptions
        where (synced_at at time zone 'America/New_York')::date = $1::date limit 1`,
      [etDate],
    ).catch(() => []);
    return rows.length > 0;
  }
  if (job.verify === "ai_news") {
    const rows = await query<{ n: number }>(
      `select 1 as n from ai_news_briefs where brief_date = $1::date limit 1`,
      [etDate],
    ).catch(() => []);
    return rows.length > 0;
  }
  if (job.verify === "web_analytics") {
    // Freshness by captured_at — the site may legitimately have 0 pageview
    // rows for a day (snippet not live / no traffic), so a run counts as
    // verified when it touched the table today, not when rows exist for today.
    const rows = await query<{ n: number }>(
      `select 1 as n from web_analytics_snapshots
        where (captured_at at time zone 'America/New_York')::date = $1::date limit 1`,
      [etDate],
    ).catch(() => []);
    return rows.length > 0;
  }
  const match = job.verifyMatch ?? "%";
  // mins, not hours: slot times can be fractional (0:30 slots) and
  // make_interval(hours =>) only takes integers.
  const rows = await query<{ n: number }>(
    `select 1 as n from content_posts
      where persona = $1
        and carousel_id ilike $4
        and (posted_at at time zone 'America/New_York') >= ($2::date + make_interval(mins => $3))
      limit 1`,
    [job.persona, etDate, Math.round(hour * 60), match],
  );
  return rows.length > 0;
}

async function watchdog() {
  if (!dbConfigured) return;
  const { date, hour, minute } = etParts();
  for (const job of CONTENT_JOBS) {
    if (process.env[`${job.envPrefix}_CRON_ENABLED`] !== "1") continue;
    const hours = jobHoursET(job);
    for (let slot = 0; slot < hours.length; slot++) {
      const h = hours[slot];
      const passedMin = (hour - h) * 60 + minute;
      if (passedMin < 30) continue; // not due, or still within its normal window
      const key = `${job.name}:${date}:${h}`;
      if (caughtUp.has(key)) continue;
      try {
        if (await slotVerified(job, date, h)) { caughtUp.add(key); continue; }
        caughtUp.add(key);
        console.log(`[watchdog] ${job.name}:${hourTagET(h)} missed today — running catch-up`);
        runJob(job, h, slot);
      } catch (e) {
        console.error(`[watchdog] ${job.name}:${h}h check failed:`, (e as Error).message);
      }
    }
  }
}


// ── Manager: diagnose WHY, not just retry ────────────────────────────────────
// The watchdog retries missed slots; the manager explains them. Every tick it
// probes the upstreams (billing locks are detectable for free), audits each
// enabled job's slots for today, classifies failures, and writes ONE report
// row that the Overview surfaces — so "is everything firing, and if not why"
// is always one glance away.

type UpstreamStatus = { ok: boolean; detail: string };

async function probeUpstreams(): Promise<Record<string, UpstreamStatus>> {
  const out: Record<string, UpstreamStatus> = {};
  // Ollama (DeepSeek/Qwen) — a 1-token call; an auth/quota lock answers without cost.
  try {
    const base = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
    const r = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OLLAMA_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OLLAMA_TEXT_MODEL || "deepseek-v4-flash:preview",
        stream: false,
        think: false,
        options: { num_predict: 1 },
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const text = await r.text();
    out.ollama = /quota|rate limit|insufficient|unauthorized/i.test(text) && !r.ok
      ? { ok: false, detail: `model access blocked — QA gates and captions degrade (ollama.com → Settings/Keys): ${text.slice(0, 120)}` }
      : { ok: r.ok, detail: r.ok ? "ok" : `HTTP ${r.status}` };
  } catch (e) {
    out.ollama = { ok: false, detail: (e as Error).message };
  }
  // fal — HARD STOP (Kevin 2026-09-05): no fal.ai calls outside kevbuildsapps
  // marketing pages. Not probed; pipelines run on banks / stock backgrounds.
  out.fal = { ok: true, detail: "disabled by policy (FAL_ALLOW=kevbuildsapps)" };
  // Zernio — auth + reachability.
  try {
    const r = await fetch("https://zernio.com/api/v1/profiles", {
      headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY ?? ""}` },
    });
    out.zernio = { ok: r.ok, detail: r.ok ? "ok" : `HTTP ${r.status}` };
  } catch (e) {
    out.zernio = { ok: false, detail: (e as Error).message };
  }
  return out;
}

const MANAGER_SCHEMA = `create table if not exists manager_reports (
  id bigserial primary key,
  healthy boolean not null,
  report jsonb not null,
  created_at timestamptz not null default now()
)`;

async function managerTick() {
  if (!dbConfigured) return;
  try {
    await query(MANAGER_SCHEMA);
    const upstreams = await probeUpstreams();
    const { date, hour, minute } = etParts();
    const jobs: { job: string; slot: string; status: string }[] = [];
    for (const job of CONTENT_JOBS) {
      if (process.env[`${job.envPrefix}_CRON_ENABLED`] !== "1") continue;
      for (const h of jobHoursET(job)) {
        const passedMin = (hour - h) * 60 + minute;
        if (passedMin < 20) {
          jobs.push({ job: job.name, slot: `${hourTagET(h)} ET`, status: passedMin < 0 ? "scheduled" : "running window" });
          continue;
        }
        const verified = await slotVerified(job, date, h).catch(() => false);
        let status = verified ? "fired ✓" : "MISSED";
        if (!verified && !upstreams.ollama.ok) status = "blocked: Ollama model access (QA gate)";
        else if (!verified && !upstreams.fal.ok && job.name.includes("megan")) status = "check: fal locked (bank fallback should cover)";
        jobs.push({ job: job.name, slot: `${hourTagET(h)} ET`, status });
      }
    }
    const blockers = Object.entries(upstreams)
      .filter(([, v]) => !v.ok)
      .map(([k, v]) => `${k}: ${v.detail}`);
    const missed = jobs.filter((j) => j.status !== "fired ✓" && j.status !== "scheduled" && j.status !== "running window");
    const healthy = blockers.length === 0 && missed.length === 0;
    await query(`insert into manager_reports (healthy, report) values ($1, $2)`, [
      healthy,
      JSON.stringify({ date, upstreams, jobs, blockers }),
    ]);
    console.log(
      `[manager] ${healthy ? "✓ all systems firing" : `⚠ ${missed.length} slot(s) not verified; blockers: ${blockers.join(" | ") || "none"}`}`,
    );
  } catch (e) {
    console.error("[manager] tick failed:", (e as Error).message);
  }
}

export function startContentCrons() {
  if (started) return;
  started = true;

  // Comments-to-DM: attach pending automations once Zernio has a
  // platformPostId (async publish + scheduled posts). Cheap SELECT; only
  // due/unscheduled rows are polled so a bulk schedule queue cannot starve
  // posts that just went live.
  setTimeout(() => {
    import("../comments/automations")
      .then(({ flushPendingCommentDmSetups }) => {
        const tick = () =>
          flushPendingCommentDmSetups().catch((e) =>
            console.error("[comment-dm] flush:", (e as Error).message),
          );
        tick();
        setInterval(tick, 30_000);
      })
      .catch(() => {});
  }, 5_000);

  setTimeout(() => {
    import("../agent-posts/run")
      .then(({ drainAgentPosts }) => {
        const tick = () =>
          drainAgentPosts().catch((e) =>
            console.error("[agent-posts] drain:", (e as Error).message),
          );
        tick();
        setInterval(tick, 10_000);
      })
      .catch(() => {});
  }, 8_000);

  // First watchdog pass 5 min after boot (catches slots lost to the restart
  // itself), then every 30 min.
  setTimeout(() => {
    watchdog().catch(() => {});
    setInterval(() => watchdog().catch(() => {}), 30 * 60_000);
  }, 5 * 60_000);
  // Manager report 10 min after boot (after the watchdog's first pass), then
  // every 3 hours — the Overview surfaces the latest row.
  setTimeout(() => {
    managerTick().catch(() => {});
    setInterval(() => managerTick().catch(() => {}), 3 * 3600_000);
  }, 10 * 60_000);
  for (const job of CONTENT_JOBS) {
    // Explicit arm required for actually RUNNING jobs (the registry's
    // jobEnabled() is laxer because the dashboard previews the schedule).
    if (process.env[`${job.envPrefix}_CRON_ENABLED`] !== "1") {
      console.log(`[${job.name}] disabled (${job.envPrefix}_CRON_ENABLED != 1)`);
      continue;
    }
    jobHoursET(job).forEach((hour, slot) => {
      const schedule = () => {
        const ms = msUntilHourET(hour);
        console.log(`[${job.name}:${hourTagET(hour)}] next run in ${(ms / 3600000).toFixed(1)}h (${hourTagET(hour)} ET daily, slot ${slot})`);
        setTimeout(() => {
          runJob(job, hour, slot);
          schedule();
        }, ms);
      };
      schedule();
    });
  }
}

/** Back-compat export — instrumentation.ts previously imported this name. */
export const startDannyCron = startContentCrons;
