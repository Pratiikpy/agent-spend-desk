/**
 * Check how well past windows forecast a new one.
 * Usage: node scripts/backtest-analog.ts <ledger> <tool> <window minutes> <plan or "none">
 * Three checks, all on the ledger's own readings: (1) each window left out in turn and forecast from all the others, for
 * several settings (this lets a window be forecast from its own era, so it flatters); (2) a forecaster that stops learning:
 * the earlier half of the windows is the whole past and the later half is forecast from it; (3) the product's own use:
 * each window in time order forecast from the windows before it, so the forecaster keeps learning, for several settings
 * including the last hour's use among what "looks like this one" means. Brier score: the mean squared gap between the
 * forecast chance of ending at 95% or more and what happened (1 or 0); lower is better, and the base rate alone is the
 * score to beat.
 */
import { DatabaseSync } from "node:sqlite";

import { buildMoments, leaveOneWindowOut, rollingOrigin, type Backtest } from "../src/desk/limits/analog.ts";

const [ledger, tool, minutesArg, planArg] = process.argv.slice(2);
if (!ledger || !tool || !minutesArg || !planArg) {
  console.error('Usage: backtest-analog.ts <ledger> <tool> <window minutes> <plan or "none">');
  process.exit(2);
}
const db = new DatabaseSync(ledger, { readOnly: true }) as unknown as Parameters<typeof buildMoments>[0];
const planType = planArg === "none" ? null : planArg;
const moments = buildMoments(db, { tool, windowMinutes: Number(minutesArg), planType });
const windows = [...new Set(moments.map((m) => m.window))].sort((a, b) => a - b);
console.log(`${tool}, ${planType ?? "unknown plan"}, ${minutesArg}-minute windows: ${windows.length} windows, ${moments.length} readings`);

function show(label: string, b: Backtest): void {
  console.log(`\n${label}: ${b.queries} readings asked about`);
  console.log(`  Brier score ${b.brier.toFixed(3)} against ${b.baseBrier.toFixed(3)} for the base rate alone`);
  console.log(`  final percent inside the forecast's 10th to 90th percentile: ${Math.round(b.inside80 * 100)}% (aimed at 80%)`);
  for (const r of b.reliability) console.log(`  forecast chance ${r.band}: ${r.queries} readings, ${r.reached} ended at ${b.threshold}% or more (${r.queries === 0 ? "n/a" : `${Math.round((100 * r.reached) / r.queries)}%`})`);
}

console.log("\n== 1. each window left out in turn (the settings were tried on these same windows)");
for (const [label, useBurn, neighbours] of [["elapsed time and percent, 5 neighbours", false, 5], ["elapsed time and percent, 10 neighbours (the product's setting)", false, 10], ["elapsed time and percent, 20 neighbours", false, 20], ["elapsed time and percent, 30 neighbours", false, 30], ["adding the last hour's use, 10 neighbours", true, 10]] as const) {
  show(label, leaveOneWindowOut(moments, { useBurn, neighbours, minWindows: 30 }));
}

console.log("\n== 2. chosen on the earlier half, tested on the later half using only the earlier half");
const half = Math.floor(windows.length / 2);
const early = new Set(windows.slice(0, half));
const late = new Set(windows.slice(half));
const choices = [5, 10, 20, 30].map((neighbours) => ({ neighbours, trainBrier: leaveOneWindowOut(moments, { neighbours, minWindows: 20, pool: early, ask: early }).brier }));
for (const c of choices) console.log(`  ${c.neighbours} neighbours: Brier ${c.trainBrier.toFixed(3)} on the earlier half, leaving each window out`);
const chosen = choices.reduce((a, b) => (b.trainBrier < a.trainBrier ? b : a));
show(`tested on the ${late.size} later windows with ${chosen.neighbours} neighbours, consulting only the ${early.size} earlier ones`, leaveOneWindowOut(moments, { neighbours: chosen.neighbours, minWindows: 20, pool: early, ask: late }));
show(`the same with the last hour's use added`, leaveOneWindowOut(moments, { neighbours: chosen.neighbours, useBurn: true, minWindows: 20, pool: early, ask: late }));

console.log("\n== 3. each window in time order, forecast from the windows before it (the first 30 are only history)");
for (const [label, recent, neighbours, useBurn] of [["all earlier windows, 5 neighbours", null, 5, false], ["all earlier windows, 10 neighbours (the product's setting)", null, 10, false], ["all earlier windows, 20 neighbours", null, 20, false], ["the 40 most recent windows, 10 neighbours", 40, 10, false], ["all earlier windows, 10 neighbours, adding the last hour's use", null, 10, true]] as const) {
  show(label, rollingOrigin(moments, { recent, neighbours, useBurn, minWindows: Math.min(30, recent ?? 30), minPrior: 30 }));
}
