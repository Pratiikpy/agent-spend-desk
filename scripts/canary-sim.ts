// The canary simulation study (spec 16.5): how often the regression statistic cries wolf, how big a change it can
// call and how soon, with every number reproducible from a seed.
//   npx tsx scripts/canary-sim.ts [--seed 20261022] [--histories 300] [--out docs/verification/canary-simulation.md]
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { DEFAULT_CONFIG, earliestCallDay } from "../src/desk/canary/verdict.ts";
import { DEFAULT_SIM, coverageStudy, eProcessEstimatedBaselineNull, eProcessKnownBaselineNull, eProcessPower, falseAlarmStudy, oneTaskStudy, platformStudy, powerStudy, singleWindowStudy, steadyStudy } from "../src/desk/canary/simulate.ts";

const { values } = parseArgs({ options: { seed: { type: "string", default: "20261022" }, histories: { type: "string", default: "300" }, out: { type: "string" } } });
const seed = Number(values.seed);
const N = Number(values.histories);
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const pts = (x: number): string => `${(x * 100).toFixed(1)} points`;
const started = Date.now();

const lines: string[] = [];
const say = (s = ""): void => void lines.push(s);

say("# Canary simulation study");
say();
say(`Reproduce: \`npx tsx scripts/canary-sim.ts --seed ${seed} --histories ${N}\`. Every figure below is computed by that command; nothing is typed in. The generator is \`src/desk/canary/simulate.ts\`; the statistic under test is \`src/desk/canary/verdict.ts\`, the same code that reads real canary rows.`);
say();
say("What is simulated: a team of tasks in clusters, scored pass or fail several times a day, with the day-to-day noise of the scores, a block-level shock shared by all tasks of a cluster for each 7-day block, a small rate of attempts that produce no score, and a control arm of tasks the change should not touch. A regression is injected from day 15 by lowering the pass probability of a share of the tasks. The statistic compares each window with a frozen 14-day baseline and calls `regressed` only when every condition holds in two consecutive 7-day windows.");
say();
say(`Parameters: ${DEFAULT_SIM.tasks} tasks in ${DEFAULT_SIM.clusters} clusters, ${DEFAULT_SIM.repeats} repeats a day, ${DEFAULT_SIM.days} days, cluster shock sd ${DEFAULT_SIM.shockSd} (logit), error rate ${pct(DEFAULT_SIM.errorRate)}, control arm of ${DEFAULT_SIM.control?.tasks ?? 0} tasks. Verdict settings: ${pct(DEFAULT_CONFIG.level)} intervals, smallest callable change ${pts(DEFAULT_CONFIG.minDelta)}, baseline ${DEFAULT_CONFIG.baselineDays} days, windows of ${DEFAULT_CONFIG.windowDays} days. The earliest day a call is possible after a pin is day ${earliestCallDay()}.`);
say();

// 1. coverage
say("## 1. Does the 99% interval cover the truth?");
say();
say("One 7-day window against the baseline, true change known, 1,000 replications per row. A well-behaved 99% interval covers about 99%; the exact 95% interval for the measured coverage is shown.");
say();
say("| Clusters | Method | True change | Coverage | Exact 95% interval for coverage | Mean half-width |");
say("|---|---|---|---|---|---|");
for (const clusters of [4, 6, 12]) {
  for (const size of [0, 0.1]) {
    for (const method of ["t", "bootstrap_t"] as const) {
      const r = coverageStudy({ clusters, method, replications: 1000, seed, size });
      say(`| ${clusters} | ${method} | ${size === 0 ? "none" : `-${pts(size)}`} | ${pct(r.coverage)} | ${pct(r.coverageCi.low)} to ${pct(r.coverageCi.high)} | ${pts(r.meanHalfWidth)} |`);
    }
  }
}
say();

// 2. false alarms
const fa = falseAlarmStudy({ histories: N, seed });
say("## 2. How often does it cry wolf?");
say();
say(`${fa.histories} histories of ${fa.days} days with no injected change, evaluated every day from day ${earliestCallDay()}.`);
say();
say(`| Histories ever called regressed | Upper 95% bound | Ever called improved | Ever downgraded to harness or platform | Share of daily evaluations steady |`);
say("|---|---|---|---|---|");
say(`| ${fa.regressed} of ${fa.histories} | ${pct(fa.regressedUpper95)} | ${fa.improved} | ${fa.harnessOrPlatform} | ${pct(fa.steadyShare)} |`);
say();

// 3. power
say("## 3. How big a change can it call, and how soon?");
say();
say(`Regression injected from day 15, ${N} histories per row. "Called" means the first \`regressed\` verdict, with the control arm in place.`);
say();
say("| Share of tasks hit | Drop on those tasks | Mean change over all tasks | Called on day 28 | Called by day 42 | Called by day 90 | Median days after onset | Mean one-window MDE | Mean two-window MDE |");
say("|---|---|---|---|---|---|---|---|---|");
for (const row of powerStudy({ sizes: [0.05, 0.08, 0.11, 0.15, 0.2], fractions: [0.5, 1], histories: N, seed })) {
  say(`| ${pct(row.fraction)} | ${pts(row.size)} | ${pts(row.trueDelta)} | ${pct(row.calledDay28)} | ${pct(row.calledByDay42)} | ${pct(row.calledByDay90)} | ${row.medianDaysFromOnset ?? "never"} | ${pts(row.meanMde)} | ${pts(row.meanMdeVerdict)} |`);
}
say();
say("The one-window MDE is the change a single window could detect with 80% power from the standard error actually observed; the two-window figure is the change that makes a call on two consecutive windows 80% likely.");
say();

// 4. single window power check
say("## 4. Does the published one-window MDE mean what it says?");
say();
say("Power of one window alone at several true sizes; at the stated MDE the interval should exclude zero about 80% of the time.");
say();
say("| True change | Windows whose interval excludes zero | Mean MDE (observed standard error) | Mean MDE (pre-registered formula) |");
say("|---|---|---|---|");
for (const row of singleWindowStudy({ sizes: [0.04, 0.06, 0.08, 0.1, 0.12], histories: N, seed })) {
  say(`| ${pts(row.size)} | ${pct(row.excludesZero)} | ${pts(row.meanMde)} | ${pts(row.meanMdeFormula)} |`);
}
say();

// 5. platform event
say("## 5. A platform event that hits the control arm too");
say();
say("The same drop is injected on the control tasks. The verdict should say the platform or harness moved, not that the model regressed.");
say();
say("| Injected drop | Histories where the primary arm alone would fire | Labelled harness or platform | Still called regressed |");
say("|---|---|---|---|");
for (const row of platformStudy({ sizes: [0.1, 0.15, 0.2], histories: N, seed })) {
  say(`| ${pts(row.size)} | ${row.primaryFired} of ${row.histories} | ${Number.isNaN(row.labelledPlatform) ? "n/a" : pct(row.labelledPlatform)} | ${Number.isNaN(row.stillRegressed) ? "n/a" : pct(row.stillRegressed)} |`);
}
say();

// 6. one task
const one = oneTaskStudy({ histories: N, seed });
say("## 6. One task collapsing");
say();
say(`One task is driven to near zero from day 15 and nothing else changes (${one.histories} histories). The statistic must not call a regression on one task alone.`);
say();
say("| Ever called regressed | Flagged as resting on one task by day 28 | by day 42 |");
say("|---|---|---|");
say(`| ${one.regressedEver} of ${one.histories} | ${one.oneTaskAtDay28} of ${one.histories} | ${one.oneTaskByDay42} of ${one.histories} |`);
say();

// 7. e-process
say("## 7. The anytime-valid monitor (schedules repeats, never gives a verdict)");
say();
const e1 = eProcessKnownBaselineNull({ histories: 2000, days: 90, seed });
const e2 = eProcessEstimatedBaselineNull({ histories: N, seed });
say("| Setting | Histories | Flagged | Upper 95% bound |");
say("|---|---|---|---|");
say(`| Known baseline, mean-zero differences, ${e1.days} days | ${e1.histories} | ${e1.flagged} | ${pct(e1.upper95)} |`);
say(`| Baseline estimated from the first 14 days, no change | ${e2.histories} | ${e2.flagged} (${e2.taskFlagHistories} with a task flag) | ${pct(e2.upper95)} |`);
say();
say("| Injected drop (all tasks) | Histories | Flagged | Median day flagged |");
say("|---|---|---|---|");
for (const row of eProcessPower({ sizes: [0.05, 0.1, 0.15], histories: N, seed })) say(`| ${pts(row.size)} | ${row.histories} | ${row.flagged} | ${row.medianDay ?? "never"} |`);
say();

say("## 8. What does `steady` cost?");
say();
say("`steady` is said when the interval lies inside the detectable change, that is, when no change at least that large is compatible with the data. It is not a claim that nothing changed. Every daily verdict from day 28 to day 90 is counted, with no change and with a real one, so the share of days that say `steady` while a change is real can be read off.");
say();
say("| Share of tasks hit | Drop on those tasks | Steady | Inconclusive | Called regressed | Harness or platform |");
say("|---|---|---|---|---|---|");
for (const r of steadyStudy({ cases: [{ size: 0, fraction: 1 }, { size: 0.05, fraction: 1 }, { size: 0.08, fraction: 1 }, { size: 0.11, fraction: 1 }, { size: 0.15, fraction: 1 }, { size: 0.11, fraction: 0.5 }], histories: N, seed })) {
  say(`| ${r.size === 0 ? "none" : pct(r.fraction)} | ${r.size === 0 ? "none" : pts(r.size)} | ${pct(r.steady)} | ${pct(r.inconclusive)} | ${pct(r.regressed)} | ${pct(r.harnessOrPlatform)} |`);
}
say();
say("The detectable change has a floor: the noise a pass-or-fail score cannot be without, computed from each task's baseline rate with one pass and one failure added. A window in which every score was a pass has no observed spread, and without the floor it would claim to detect a change of nothing and could never be called `steady`; with it, such a window is `steady` with a detectable change of a few points, which the card states.");
say();

say("## What this does not show");
say();
say("The generator is a model of canary data, not canary data. Its noise, its cluster shocks and its error rate are assumptions chosen to be realistic and stated above; if a team's real tasks are noisier, intervals widen and the MDE grows, and the statistic reports the observed figure, not these. Coverage near the nominal level here is evidence the interval is built correctly on data of this shape, not a guarantee on any other shape. A new regression cannot be called before the earliest call day.");
say();
say(`Computed in ${((Date.now() - started) / 1000).toFixed(0)} seconds.`);

const text = lines.join("\n") + "\n";
if (values.out) writeFileSync(values.out, text);
else process.stdout.write(text);
