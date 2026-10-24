import type { Ledger } from "../ledger/db.ts";
import { buildMoments, chanceAtLeast, finalQuantile, forecast, type Moment } from "./analog.ts";

/**
 * Whether a plan window will last until it resets. The percent used and the reset time are the tool's own (Codex
 * writes them in its logs, Claude Code's status line carries them). The outlook is what happened in the past windows of
 * the same plan and length that stood at the same stage with a similar percent (`forecast`), so it answers "how often
 * did a window like this one run out" and not "what pace will you keep". It replaced a projection that assumed the
 * last hour's pace would continue: against 110 real windows that held the final percent in its range 2 times in 26;
 * the version here is checked the same way (docs/verification/runway-2026-10-24.md). With fewer than 30 past windows it
 * shows the percent and the reset and says why it forecasts nothing.
 */
export interface LimitReading {
  ts: string;
  pct: number;
  /** Seconds since the epoch. */
  resetsAt: number;
  windowMinutes: number;
}

export interface RunwayInput {
  latest: LimitReading | null;
  moments: readonly Moment[];
  now: Date;
  /** How far the percent rose over the readings of the last hour, when there are enough of them to say. */
  rise?: { points: number; minutes: number } | null;
  /** A reading older than this is shown but not forecast from. */
  staleMinutes?: number;
}

/** Windows ending at or above this percent count as having run out. */
export const FULL_AT = 95;
export const MIN_PAST_WINDOWS = 30;
const NEIGHBOURS = 10;

export interface Outlook {
  /** The past windows consulted, and how many of them ended at the full mark or above. */
  windows: number;
  reached: number;
  chance: number;
  /** Where those windows ended: the middle 80% and the median. */
  low: number;
  median: number;
  high: number;
}

export interface Runway {
  state: "no_data" | "window_over" | "stale" | "ok";
  usedPct: number | null;
  resetsAt: Date | null;
  minutesToReset: number | null;
  ageMinutes: number | null;
  rise: { points: number; minutes: number } | null;
  outlook: Outlook | null;
  verdict: "likely_to_run_out" | "likely_to_last" | "toss_up" | "already_full" | null;
  reasons: string[];
}

const MINUTE = 60_000;

export function projectRunway(input: RunwayInput): Runway {
  const stale = input.staleMinutes ?? 20;
  const empty = (state: Runway["state"], extra: Partial<Runway> = {}): Runway => ({ state, usedPct: null, resetsAt: null, minutesToReset: null, ageMinutes: null, rise: input.rise ?? null, outlook: null, verdict: null, reasons: [], ...extra });
  const r = input.latest;
  if (r === null) return empty("no_data", { reasons: ["no limit reading for this tool in the ledger"] });
  const resetsAt = new Date(r.resetsAt * 1000);
  const ageMinutes = Math.max(0, Math.floor((input.now.getTime() - Date.parse(r.ts)) / MINUTE));
  const minutesToReset = Math.round((resetsAt.getTime() - input.now.getTime()) / MINUTE);
  const common = { usedPct: r.pct, resetsAt, minutesToReset, ageMinutes };
  if (resetsAt.getTime() <= input.now.getTime()) return empty("window_over", { ...common, minutesToReset: 0, reasons: ["the window this reading belongs to has reset; the next reading will start a new one"] });
  if (ageMinutes > stale) return empty("stale", { ...common, reasons: [`the last reading is ${ageMinutes} minutes old; the percent may have moved since`] });
  if (r.pct >= FULL_AT) return empty("ok", { ...common, verdict: "already_full" });

  const windowMs = r.windowMinutes * MINUTE;
  const elapsed = Math.min(1, Math.max(0, 1 - (resetsAt.getTime() - input.now.getTime()) / windowMs));
  const f = forecast(input.moments, { elapsed, pct: r.pct }, { neighbours: NEIGHBOURS, minWindows: MIN_PAST_WINDOWS });
  if (f.abstained) {
    const seen = f.windows;
    return empty("ok", { ...common, reasons: [`only ${seen} past window${seen === 1 ? "" : "s"} of this plan and length to compare with; at least ${MIN_PAST_WINDOWS} are needed`] });
  }
  const chance = chanceAtLeast(f, FULL_AT) as number;
  const reached = f.finals.filter((x) => x >= FULL_AT).length;
  const outlook: Outlook = { windows: f.windows, reached, chance, low: finalQuantile(f, 0.1) as number, median: finalQuantile(f, 0.5) as number, high: finalQuantile(f, 0.9) as number };
  const verdict: Runway["verdict"] = chance >= 0.6 ? "likely_to_run_out" : chance <= 0.2 ? "likely_to_last" : "toss_up";
  return { state: "ok", ...common, rise: input.rise ?? null, outlook, verdict, reasons: [] };
}

export interface RunwayOptions {
  tool: string;
  /** The window length and plan of the limit: each is its own, so a reading of one is never used for another. */
  windowMinutes: number;
  planType: string | null;
  now: Date;
  staleMinutes?: number;
}

export function runwayFromLedger(db: Ledger, opts: RunwayOptions): Runway {
  const plan = opts.planType === null ? "plan_type IS NULL" : "plan_type = ?";
  const base = [opts.tool, opts.windowMinutes, ...(opts.planType === null ? [] : [opts.planType])];
  const row = db
    .prepare(`SELECT ts, used_percent AS pct, resets_at AS resetsAt, window_minutes AS windowMinutes FROM limit_sample WHERE tool = ? AND window_minutes = ? AND ${plan} AND ts <= ? ORDER BY ts DESC, session_id LIMIT 1`)
    .get(...base, opts.now.toISOString()) as LimitReading | undefined;
  // The window now running is not a past window: only windows that have reset, and only what was known by now.
  const moments = buildMoments(db, { tool: opts.tool, windowMinutes: opts.windowMinutes, planType: opts.planType, completedBefore: opts.now.getTime() });
  let rise: { points: number; minutes: number } | null = null;
  if (row) {
    const since = new Date(Date.parse(row.ts) - 60 * MINUTE).toISOString();
    const earliest = db
      .prepare(`SELECT ts, used_percent AS pct FROM limit_sample WHERE tool = ? AND window_minutes = ? AND ${plan} AND resets_at = ? AND ts >= ? ORDER BY ts LIMIT 1`)
      .get(...base, row.resetsAt, since) as { ts: string; pct: number } | undefined;
    const minutes = earliest ? (Date.parse(row.ts) - Date.parse(earliest.ts)) / MINUTE : 0;
    if (earliest && minutes >= 5) rise = { points: row.pct - earliest.pct, minutes: Math.round(minutes) };
  }
  return projectRunway({ latest: row ?? null, moments, now: opts.now, rise, ...(opts.staleMinutes === undefined ? {} : { staleMinutes: opts.staleMinutes }) });
}

const clock = (d: Date): string => d.toISOString().slice(11, 16);
const hm = (minutes: number): string => (minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 > 0 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`);

/** Where the window stands: percent, reset and the age of the reading. */
export function runwayHead(r: Runway): string {
  if (r.usedPct === null || r.resetsAt === null) return "no reading yet";
  if (r.state === "window_over") return `the last reading (${Math.round(r.usedPct)}%) is from a window that has reset`;
  return `${Math.round(r.usedPct)}% used, resets in ${hm(r.minutesToReset ?? 0)} (${clock(r.resetsAt)} UTC), last reading ${r.ageMinutes} min ago`;
}

/** What it means: the outlook and its basis, or why there is none. */
export function runwayDetail(r: Runway): string {
  if (r.state === "no_data") return r.reasons.join(" ");
  if (r.state === "window_over") return "The next reading will start a new window.";
  if (r.state === "stale") return "The percent may have moved since, so there is no forecast.";
  if (r.verdict === "already_full") return "It is already at the limit.";
  if (r.outlook === null || r.verdict === null) return `No forecast: ${r.reasons.join(" ")}.`;
  const o = r.outlook;
  const said = r.verdict === "likely_to_run_out" ? "It will probably run out before the reset." : r.verdict === "likely_to_last" ? "It will probably last until the reset." : "That is a toss-up.";
  const rise = r.rise !== null && r.rise.points > 0 ? ` In the last ${r.rise.minutes} minutes it rose ${Math.round(r.rise.points)} points.` : "";
  return `${o.reached} of ${o.windows} similar past windows ended at ${FULL_AT}% or more; they ended between ${Math.round(o.low)}% and ${Math.round(o.high)}% (middle 80%), median ${Math.round(o.median)}%. ${said}${rise} Based on this plan's own past windows, not on a model of your pace.`;
}

export function renderRunway(r: Runway, label: string): string {
  if (r.state === "no_data") return `${label}: no reading yet. ${runwayDetail(r)}`.trim();
  return `${label}: ${runwayHead(r)}. ${runwayDetail(r)}`;
}
