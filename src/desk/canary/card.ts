import { existsSync } from "node:fs";

import { REASONS, WORDS } from "./command.ts";
import { readRows, buildSeries } from "./store.ts";
import { DEFAULT_CONFIG, earliestCallDay, evaluateAt, makeContext, type Verdict } from "./verdict.ts";

/**
 * The canary as a card on the brief (DF-002, DF-007). It says the verdict as of the latest run, whether it changed since the
 * run before, when a call becomes possible if it is not yet, and that the canary is not running when no run is recent.
 */
export interface CanaryCard {
  state: "none" | "ok";
  /** Why there is no card, when there is none. */
  reason?: string;
  verdict?: Verdict["verdict"];
  words?: string;
  because?: string;
  /** The day number (1 is the first run after the baseline was pinned) and its calendar date. */
  day?: number;
  date?: string;
  /** The verdict on the day before, and whether this one differs. Null when there is no earlier verdict to compare with. */
  previous?: { verdict: Verdict["verdict"]; words: string } | null;
  changed?: boolean;
  /** When a call first becomes possible, as a date, while the canary is too young to call. */
  eligibleFrom?: string | null;
  /** The date of the latest run, and how many days before `asOf` it was. */
  lastRun?: string;
  daysSinceRun?: number;
  /** True when no run is dated within three days of `asOf`: the canary has stopped. */
  notRunning?: boolean;
}

const DAY = 86_400_000;
/** Three missed days raise "canary not running" (DF-007). */
export const NOT_RUNNING_AFTER_DAYS = 3;

const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * The card as of a moment: the verdict on the latest run dated on or before `uptoDate` (default: all runs), so that the brief for a
 * past day shows what the canary said then, not what it says now.
 */
export function canaryCard(runsPath: string, asOfMs: number, sample: boolean, uptoDate?: string): CanaryCard {
  if (!existsSync(runsPath)) return { state: "none", reason: "No canary has run yet, so there is no verdict to show." };
  const all = readRows(runsPath).rows;
  const rows = uptoDate === undefined ? all : all.filter((r) => r.date <= uptoDate);
  if (all.length > 0 && rows.length === 0) return { state: "none", reason: `The first canary run is dated after ${uptoDate}, so there is no verdict for that day.` };
  const series = buildSeries(rows);
  if (!series) return { state: "none", reason: "The canary file holds no usable run." };
  const ctx = makeContext(series);
  const dates = new Map(rows.map((r) => [r.day, r.date]));
  const day = series.days;
  const v = evaluateAt(ctx, day);
  const before = day > 1 ? evaluateAt(ctx, day - 1) : null;
  const date = dates.get(day);
  const first = dates.get(1);
  const lastRun = date ?? "";
  const asOf = new Date(asOfMs).toISOString().slice(0, 10);
  // A sample is a constructed scenario dated in the future, so it is never "not running".
  const since = !sample && lastRun !== "" ? Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${lastRun}T00:00:00Z`)) / DAY) : 0;
  const tooEarly = v.reason === "too_early";
  return {
    state: "ok",
    verdict: v.verdict,
    words: WORDS[v.verdict],
    because: REASONS[v.reason] ?? v.reason,
    day,
    ...(date ? { date } : {}),
    previous: before === null ? null : { verdict: before.verdict, words: WORDS[before.verdict] },
    changed: before !== null && before.verdict !== v.verdict,
    eligibleFrom: tooEarly && first ? addDays(first, earliestCallDay(DEFAULT_CONFIG) - 1) : null,
    lastRun,
    daysSinceRun: since,
    notRunning: since >= NOT_RUNNING_AFTER_DAYS,
  };
}
