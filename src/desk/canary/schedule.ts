import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Ledger } from "../ledger/db.ts";
import { resolvePrice, type PriceSnapshot } from "../pricing/pricebook.ts";
import { harnessHash, TASKS } from "./tasks.ts";
import type { RunRow } from "./runner.ts";

/**
 * When the daily canary runs, and when it does not (DF-007). One run a day per UTC date, tried again at the next hourly
 * invocation until it succeeds. A run is not made, and the reason is written down, when the owner's plan window is nearly spent (the
 * canary must not take the last of someone's quota), when its own budget would be exceeded, when the endpoint failed, when a probe
 * shows a cache in front of the endpoint, or when the harness changed. Three days with no run raise "canary not running".
 */
export const PLAN_SKIP = { fiveHourPct: 60, weeklyPct: 75 } as const;
/** A reading older than this is not used: a window reading from yesterday says nothing about now. */
export const READING_FRESH_MS = 3 * 60 * 60 * 1000;
export const DEFAULT_DAILY_BUDGET_USD = 1;
export const DEFAULT_REPEATS = { primary: 5, control: 3 } as const;

export type SkipKind = "plan_limit" | "budget" | "endpoint" | "cache" | "no_model";

export interface Skip {
  date: string;
  at: string;
  kind: SkipKind;
  reason: string;
}

export const skipsPathFor = (runsPath: string): string => join(dirname(runsPath), "skips.jsonl");

export function readSkips(path: string): Skip[] {
  if (!existsSync(path)) return [];
  const out: Skip[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const s = JSON.parse(line) as Skip;
      if (typeof s.date === "string" && typeof s.reason === "string" && typeof s.kind === "string") out.push(s);
    } catch {
      /* a half-written line is ignored */
    }
  }
  return out;
}

/** Record a skip once per day and kind: an hourly check must not write twenty-four lines saying the same thing. */
export function appendSkip(path: string, skip: Skip): boolean {
  if (readSkips(path).some((s) => s.date === skip.date && s.kind === skip.kind)) return false;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(skip)}\n`);
  return true;
}

export interface PlanReadings {
  fiveHourPct: number | null;
  weeklyPct: number | null;
}

/** The fullest reading of each window among the tools that report one, within the last three hours. Null when there is none. */
export function planReadings(db: Ledger, nowMs: number): PlanReadings {
  const has = (db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name = 'limit_sample'").get() as { n: number }).n > 0;
  if (!has) return { fiveHourPct: null, weeklyPct: null };
  const since = new Date(nowMs - READING_FRESH_MS).toISOString();
  const fullest = (minutes: number): number | null => {
    const r = db.prepare("SELECT MAX(used_percent) p FROM limit_sample WHERE window_minutes = ? AND ts >= ? AND ts <= ?").get(minutes, since, new Date(nowMs + 60_000).toISOString()) as { p: number | null };
    return r.p;
  };
  return { fiveHourPct: fullest(300), weeklyPct: fullest(10_080) };
}

export interface Budget {
  /** Micro-dollars, or null for no cap. */
  capMicros: number | null;
  /** Null when the model has no price, so the cost cannot be stated. */
  estimateMicros: number | null;
}

/**
 * What a day's run would cost: the tokens a row took on the last run, times the rows planned, priced; before any run, an upper bound
 * (a prompt of its own length in and the whole allowed reply out). Null when the model has no price: said, not guessed.
 */
export function estimateRunCost(previous: readonly RunRow[], plannedRows: number, snapshot: PriceSnapshot, model: string): number | null {
  const price = resolvePrice(snapshot, model);
  if (price.kind !== "priced") return null;
  const withTokens = previous.filter((r) => r.tokensIn !== null && r.tokensOut !== null);
  let inPer: number;
  let outPer: number;
  if (withTokens.length > 0) {
    inPer = withTokens.reduce((s, r) => s + (r.tokensIn as number), 0) / withTokens.length;
    outPer = withTokens.reduce((s, r) => s + (r.tokensOut as number), 0) / withTokens.length;
  } else {
    inPer = TASKS.reduce((s, t) => s + t.prompt.length / 4 + 40, 0) / TASKS.length;
    outPer = 400;
  }
  const micros = (inPer * price.row.inputPerMTokMicros + outPer * price.row.outputPerMTokMicros) / 1_000_000;
  return Math.ceil(micros * plannedRows);
}

export type Decision =
  | { action: "done"; reason: string }
  | { action: "run"; reason: string; note?: string }
  | { action: "skip"; kind: SkipKind; reason: string }
  | { action: "new_baseline"; reason: string };

export interface DecideInput {
  today: string;
  rows: readonly RunRow[];
  plan: PlanReadings;
  budget: Budget;
}

export function decide(i: DecideInput): Decision {
  const todays = i.rows.filter((r) => r.date === i.today && r.arm === "primary");
  if (todays.length > 0) return { action: "done", reason: `Today (${i.today}) already has its run.` };
  const current = harnessHash();
  const changed = i.rows.some((r) => r.harness !== current);
  if (changed) return { action: "new_baseline", reason: "The tasks or their checkers changed since the stored runs, so scores before and after cannot be compared. The old runs are kept apart and a new baseline starts today." };
  const { fiveHourPct, weeklyPct } = i.plan;
  if (weeklyPct !== null && weeklyPct >= PLAN_SKIP.weeklyPct) return { action: "skip", kind: "plan_limit", reason: `Your plan's weekly window is ${Math.round(weeklyPct)}% used (the canary does not run at ${PLAN_SKIP.weeklyPct}% or more), so it left the rest for your work.` };
  if (fiveHourPct !== null && fiveHourPct >= PLAN_SKIP.fiveHourPct) return { action: "skip", kind: "plan_limit", reason: `Your plan's five-hour window is ${Math.round(fiveHourPct)}% used (the canary does not run at ${PLAN_SKIP.fiveHourPct}% or more), so it left the rest for your work.` };
  const { capMicros, estimateMicros } = i.budget;
  if (capMicros !== null && estimateMicros !== null && estimateMicros > capMicros) {
    return { action: "skip", kind: "budget", reason: `A day's run would cost about $${(estimateMicros / 1e6).toFixed(2)}, over the canary's own budget of $${(capMicros / 1e6).toFixed(2)} a day.` };
  }
  const notes: string[] = [];
  if (fiveHourPct === null && weeklyPct === null) notes.push("no recent plan reading, so the plan guard did not apply");
  if (capMicros !== null && estimateMicros === null) notes.push("the model has no price, so the budget guard could not apply");
  return { action: "run", reason: "No run is recorded for today and no guard applies.", ...(notes.length > 0 ? { note: notes.join("; ") } : {}) };
}

/** Keep the old runs under a new name and start again: a changed harness makes the series a different series. */
export function archiveBaseline(runsPath: string, today: string): string | null {
  if (!existsSync(runsPath)) return null;
  let target = join(dirname(runsPath), `runs.${today}.superseded.jsonl`);
  for (let n = 2; existsSync(target); n += 1) target = join(dirname(runsPath), `runs.${today}.superseded-${n}.jsonl`);
  renameSync(runsPath, target);
  return target;
}

/** The fraction of a run's rows with a score. Below half, the endpoint failed and the day is not recorded: a failure of the harness must not look like a regression. */
export const MIN_SCORED_SHARE = 0.5;
