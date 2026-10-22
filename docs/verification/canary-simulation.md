# Canary simulation study

Reproduce: `npx tsx scripts/canary-sim.ts --seed 20261022 --histories 300`. Every figure below is computed by that command; nothing is typed in. The generator is `src/desk/canary/simulate.ts`; the statistic under test is `src/desk/canary/verdict.ts`, the same code that reads real canary rows.

What is simulated: a team of tasks in clusters, scored pass or fail several times a day, with the day-to-day noise of the scores, a block-level shock shared by all tasks of a cluster for each 7-day block, a small rate of attempts that produce no score, and a control arm of tasks the change should not touch. A regression is injected from day 15 by lowering the pass probability of a share of the tasks. The statistic compares each window with a frozen 14-day baseline and calls `regressed` only when every condition holds in two consecutive 7-day windows.

Parameters: 24 tasks in 6 clusters, 5 repeats a day, 90 days, cluster shock sd 0.3 (logit), error rate 1.0%, control arm of 3 tasks. Verdict settings: 99.0% intervals, smallest callable change 3.0 points, baseline 14 days, windows of 7 days. The earliest day a call is possible after a pin is day 28.

## 1. Does the 99% interval cover the truth?

One 7-day window against the baseline, true change known, 1,000 replications per row. A well-behaved 99% interval covers about 99%; the exact 95% interval for the measured coverage is shown.

| Clusters | Method | True change | Coverage | Exact 95% interval for coverage | Mean half-width |
|---|---|---|---|---|---|
| 4 | t | none | 99.1% | 98.3% to 99.6% | 23.8 points |
| 4 | bootstrap_t | none | 97.2% | 96.0% to 98.1% | 66.4 points |
| 4 | t | -10.0 points | 98.9% | 98.0% to 99.4% | 24.0 points |
| 4 | bootstrap_t | -10.0 points | 97.9% | 96.8% to 98.7% | 92.2 points |
| 6 | t | none | 99.0% | 98.2% to 99.5% | 14.6 points |
| 6 | bootstrap_t | none | 98.3% | 97.3% to 99.0% | 32.3 points |
| 6 | t | -10.0 points | 98.6% | 97.7% to 99.2% | 14.7 points |
| 6 | bootstrap_t | -10.0 points | 98.5% | 97.5% to 99.2% | 28.3 points |
| 12 | t | none | 99.0% | 98.2% to 99.5% | 9.3 points |
| 12 | bootstrap_t | none | 98.5% | 97.5% to 99.2% | 10.2 points |
| 12 | t | -10.0 points | 98.8% | 97.9% to 99.4% | 9.3 points |
| 12 | bootstrap_t | -10.0 points | 98.4% | 97.4% to 99.1% | 10.2 points |

## 2. How often does it cry wolf?

300 histories of 90 days with no injected change, evaluated every day from day 28.

| Histories ever called regressed | Upper 95% bound | Ever called improved | Ever downgraded to harness or platform | Share of daily evaluations steady |
|---|---|---|---|---|
| 2 of 300 | 2.4% | 3 | 0 | 32.4% |

## 3. How big a change can it call, and how soon?

Regression injected from day 15, 300 histories per row. "Called" means the first `regressed` verdict, with the control arm in place.

| Share of tasks hit | Drop on those tasks | Mean change over all tasks | Called on day 28 | Called by day 42 | Called by day 90 | Median days after onset | Mean one-window MDE | Mean two-window MDE |
|---|---|---|---|---|---|---|---|---|
| 50.0% | 5.0 points | -2.5 points | 0.0% | 1.0% | 3.3% | 33 | 18.1 points | 19.6 points |
| 50.0% | 8.0 points | -4.0 points | 0.3% | 3.7% | 8.7% | 32 | 18.2 points | 19.7 points |
| 50.0% | 11.0 points | -5.5 points | 0.3% | 6.0% | 17.7% | 34 | 18.3 points | 19.8 points |
| 50.0% | 15.0 points | -7.5 points | 1.7% | 9.3% | 32.3% | 41 | 18.6 points | 20.2 points |
| 50.0% | 20.0 points | -10.0 points | 3.0% | 25.3% | 56.7% | 31 | 19.0 points | 20.6 points |
| 100.0% | 5.0 points | -5.0 points | 0.0% | 4.3% | 14.7% | 39 | 18.0 points | 19.5 points |
| 100.0% | 8.0 points | -8.0 points | 2.7% | 17.7% | 43.3% | 32 | 18.0 points | 19.5 points |
| 100.0% | 11.0 points | -11.0 points | 10.7% | 39.0% | 75.7% | 27 | 17.9 points | 19.4 points |
| 100.0% | 15.0 points | -15.0 points | 28.0% | 77.7% | 94.7% | 16 | 17.9 points | 19.4 points |
| 100.0% | 20.0 points | -20.0 points | 63.0% | 95.3% | 99.3% | 14 | 17.9 points | 19.4 points |

The one-window MDE is the change a single window could detect with 80% power from the standard error actually observed; the two-window figure is the change that makes a call on two consecutive windows 80% likely.

## 4. Does the published one-window MDE mean what it says?

Power of one window alone at several true sizes; at the stated MDE the interval should exclude zero about 80% of the time.

| True change | Windows whose interval excludes zero | Mean MDE (observed standard error) | Mean MDE (pre-registered formula) |
|---|---|---|---|
| 4.0 points | 3.0% | 17.3 points | 9.6 points |
| 6.0 points | 9.0% | 17.2 points | 9.6 points |
| 8.0 points | 15.7% | 17.2 points | 9.6 points |
| 10.0 points | 27.0% | 17.1 points | 9.6 points |
| 12.0 points | 37.7% | 17.1 points | 9.6 points |

## 5. A platform event that hits the control arm too

The same drop is injected on the control tasks. The verdict should say the platform or harness moved, not that the model regressed.

| Injected drop | Histories where the primary arm alone would fire | Labelled harness or platform | Still called regressed |
|---|---|---|---|
| 10.0 points | 193 of 300 | 19.7% | 80.3% |
| 15.0 points | 284 of 300 | 32.4% | 67.6% |
| 20.0 points | 298 of 300 | 48.0% | 52.0% |

## 6. One task collapsing

One task is driven to near zero from day 15 and nothing else changes (300 histories). The statistic must not call a regression on one task alone.

| Ever called regressed | Flagged as resting on one task by day 28 | by day 42 |
|---|---|---|
| 2 of 300 | 130 of 300 | 265 of 300 |

## 7. The anytime-valid monitor (schedules repeats, never gives a verdict)

| Setting | Histories | Flagged | Upper 95% bound |
|---|---|---|---|
| Known baseline, mean-zero differences, 90 days | 2000 | 0 | 0.2% |
| Baseline estimated from the first 14 days, no change | 300 | 0 (60 with a task flag) | 1.2% |

| Injected drop (all tasks) | Histories | Flagged | Median day flagged |
|---|---|---|---|
| 5.0 points | 300 | 28 | 71 |
| 10.0 points | 300 | 221 | 57 |
| 15.0 points | 300 | 296 | 44 |

## What this does not show

The generator is a model of canary data, not canary data. Its noise, its cluster shocks and its error rate are assumptions chosen to be realistic and stated above; if a team's real tasks are noisier, intervals widen and the MDE grows, and the statistic reports the observed figure, not these. Coverage near the nominal level here is evidence the interval is built correctly on data of this shape, not a guarantee on any other shape. A new regression cannot be called before the earliest call day.

Computed in 38 seconds.
