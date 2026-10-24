/**
 * The projection the runway used first, kept so that its failure can be reproduced: assume the last hour's pace continues
 * to the reset, turn tokens into percent with the rate fitted on the other windows, and give the range the past windows'
 * own rates allow. For every past window of one plan and length, stand at a point inside it, use only what was known then
 * (the newest reading within 20 minutes, the last hour's tokens), project the percent at the reset, and compare with the
 * percent the window really ended at.
 * Usage: node scripts/backtest-pace-projection.ts <ledger> <tool> <window minutes> <plan or "none">
 * The points inside one window are not independent of each other, so the counts check the method; they are not a confidence interval.
 */
import { DatabaseSync } from "node:sqlite";

import { fitLimit, modelsOfTool, observeWindows, type WindowObservation } from "../src/desk/limits/fit.ts";

const [ledger, tool, minutesArg, planArg] = process.argv.slice(2);
if (!ledger || !tool || !minutesArg || !planArg) {
  console.error('Usage: backtest-pace-projection.ts <ledger> <tool> <window minutes> <plan or "none">');
  process.exit(2);
}
const windowMinutes = Number(minutesArg);
const planType = planArg === "none" ? null : planArg;
const db = new DatabaseSync(ledger, { readOnly: true });
const obs = observeWindows(db as unknown as Parameters<typeof observeWindows>[0], { tool, windowMinutes, planType });
const wanted = modelsOfTool(tool);

interface Sample {
  ts: string;
  pct: number;
}
const samplesOf = (w: WindowObservation): Sample[] =>
  db
    .prepare(`SELECT ts, used_percent AS pct FROM limit_sample WHERE tool = ? AND window_minutes = ? AND resets_at = ? AND ${planType === null ? "plan_type IS NULL" : "plan_type = ?"} ORDER BY ts`)
    .all(...(planType === null ? [tool, windowMinutes, w.resetsAt] : [tool, windowMinutes, w.resetsAt, planType])) as unknown as Sample[];

const burnAt = (t: number): number => {
  const rows = db
    .prepare("SELECT m.model AS model, m.input_tokens AS i, m.cache_read_tokens AS c, m.output_tokens AS o FROM model_call m JOIN session s ON s.session_id = m.session_id WHERE s.tool = ? AND m.ts > ? AND m.ts <= ?")
    .all(tool, new Date(t - 3_600_000).toISOString(), new Date(t).toISOString()) as unknown as { model: string; i: number; c: number; o: number }[];
  return rows.filter((r) => wanted(r.model)).reduce((s, r) => s + r.i + r.c + r.o, 0);
};

/** Percent now plus the hours left times the pace, at the slowest, middle and fastest past rates. */
function paceRange(pct: number, hoursLeft: number, burnPerHour: number, fit: ReturnType<typeof fitLimit>): { low: number; mid: number; high: number } | null {
  if (fit.abstained || fit.tokensPerPercent === null || fit.spread === null) return null;
  const at = (rate: number): number => pct + (hoursLeft * burnPerHour) / rate;
  return { low: at(fit.spread.p90), mid: at(fit.tokensPerPercent), high: at(fit.spread.p10) };
}

let checkpoints = 0;
let inside = 0;
let below = 0;
let above = 0;
let absMid = 0;
for (const w of obs) {
  const fit = fitLimit(obs.filter((x) => x !== w));
  if (fit.abstained) continue;
  const samples = samplesOf(w);
  const finalPct = (samples[samples.length - 1] as Sample).pct;
  const start = Date.parse(w.firstTs);
  const end = Date.parse(w.lastTs);
  // Compare only windows observed to their end: the projection is for the reset.
  if (w.resetsAt * 1000 - end > 30 * 60_000) continue;
  for (const frac of [0.25, 0.5, 0.75]) {
    const t = start + (end - start) * frac;
    const last = samples.filter((s) => Date.parse(s.ts) <= t).pop();
    if (!last || t - Date.parse(last.ts) > 20 * 60_000) continue;
    const burn = burnAt(t);
    if (burn <= 0) continue;
    const range = paceRange(last.pct, (w.resetsAt * 1000 - t) / 3_600_000, burn, fit);
    if (range === null) continue;
    checkpoints += 1;
    absMid += Math.abs(range.mid - finalPct);
    if (finalPct < range.low) below += 1;
    else if (finalPct > range.high) above += 1;
    else inside += 1;
  }
}
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${Math.round((100 * a) / b)}%`);
console.log(`${tool}, ${planType ?? "unknown plan"}, ${windowMinutes}-minute windows: ${obs.length} windows, ${checkpoints} checkpoints that could be projected`);
console.log(`final percent inside the projected range: ${inside} of ${checkpoints} (${pct(inside, checkpoints)}; the range was meant to hold the middle 80%); below it ${below}; above it ${above}`);
console.log(`mean distance from the middle projection to the final percent: ${checkpoints === 0 ? "n/a" : (absMid / checkpoints).toFixed(1)} points`);
