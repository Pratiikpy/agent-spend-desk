# Canary simulation study

Reproduce: `npx tsx scripts/canary-sim.ts --seed 20261022 --histories 300`. Every figure below is computed by that command; nothing is typed in. The generator is `src/desk/canary/simulate.ts`; the statistic under test is `src/desk/canary/verdict.ts`, the same code that reads real canary rows.

What is simulated: a team of tasks in clusters, scored pass or fail several times a day, with the day-to-day noise of the scores, a block-level shock shared by all tasks of a cluster for each 7-day block, a small rate of attempts that produce no score, and a control arm of tasks the change should not touch. A regression is injected from day 15 by lowering the pass probability of a share of the tasks. The statistic compares each window with a frozen 14-day baseline and calls `regressed` only when every condition holds in two consecutive 7-day windows.

Parameters: 52 tasks in 13 clusters, 1 repeats a day, 90 days, cluster shock sd 0.3 (logit), error rate 1.0%, control arm of 26 tasks. Verdict settings: 99.0% intervals, smallest callable change 3.0 points, baseline 14 days, windows of 7 days. The earliest day a call is possible after a pin is day 28.

## 1. Does the 99% interval cover the truth?

One 7-day window against the baseline, true change known, 1,000 replications per row. A well-behaved 99% interval covers about 99%; the exact 95% interval for the measured coverage is shown.

| Clusters | Method | True change | Coverage | Exact 95% interval for coverage | Mean half-width |
|---|---|---|---|---|---|
| 4 | t | none | 99.1% | 98.3% to 99.6% | 26.8 points |
| 4 | bootstrap_t | none | 97.4% | 96.2% to 98.3% | 104.5 points |
| 4 | t | -10.0 points | 99.4% | 98.7% to 99.8% | 26.9 points |
| 4 | bootstrap_t | -10.0 points | 97.9% | 96.8% to 98.7% | 128.6 points |
| 6 | t | none | 99.0% | 98.2% to 99.5% | 17.1 points |
| 6 | bootstrap_t | none | 99.1% | 98.3% to 99.6% | 48.1 points |
| 6 | t | -10.0 points | 99.0% | 98.2% to 99.5% | 17.2 points |
| 6 | bootstrap_t | -10.0 points | 98.4% | 97.4% to 99.1% | 33.4 points |
| 12 | t | none | 98.8% | 97.9% to 99.4% | 11.4 points |
| 12 | bootstrap_t | none | 99.0% | 98.2% to 99.5% | 12.6 points |
| 12 | t | -10.0 points | 98.2% | 97.2% to 98.9% | 11.5 points |
| 12 | bootstrap_t | -10.0 points | 98.0% | 96.9% to 98.8% | 12.7 points |

## 2. How often does it cry wolf?

300 histories of 90 days with no injected change, evaluated every day from day 28.

| Histories ever called regressed | Upper 95% bound | Ever called improved | Ever downgraded to harness or platform | Share of daily evaluations steady |
|---|---|---|---|---|
| 2 of 300 | 2.4% | 0 | 1 | 42.7% |

## 3. How big a change can it call, and how soon?

Regression injected from day 15, 300 histories per row. "Called" means the first `regressed` verdict, with the control arm in place.

| Share of tasks hit | Drop on those tasks | Mean change over all tasks | Called on day 28 | Called by day 42 | Called by day 90 | Median days after onset | Mean one-window MDE | Mean two-window MDE |
|---|---|---|---|---|---|---|---|---|
| 50.0% | 5.0 points | -2.5 points | 0.3% | 1.0% | 2.0% | 57 | 14.7 points | 16.2 points |
| 50.0% | 8.0 points | -4.0 points | 0.3% | 2.3% | 5.7% | 33 | 15.0 points | 16.5 points |
| 50.0% | 11.0 points | -5.5 points | 0.7% | 5.7% | 13.7% | 33 | 15.5 points | 17.1 points |
| 50.0% | 15.0 points | -7.5 points | 3.3% | 11.0% | 31.3% | 35 | 16.2 points | 17.9 points |
| 50.0% | 20.0 points | -10.0 points | 7.7% | 27.7% | 52.3% | 27 | 17.4 points | 19.2 points |
| 100.0% | 5.0 points | -5.0 points | 1.0% | 7.3% | 17.0% | 31 | 14.4 points | 16.0 points |
| 100.0% | 8.0 points | -8.0 points | 7.7% | 29.0% | 58.7% | 29 | 14.5 points | 16.0 points |
| 100.0% | 11.0 points | -11.0 points | 30.3% | 65.3% | 89.7% | 17 | 14.6 points | 16.1 points |
| 100.0% | 15.0 points | -15.0 points | 62.0% | 95.3% | 99.7% | 14 | 14.5 points | 16.0 points |
| 100.0% | 20.0 points | -20.0 points | 89.3% | 99.7% | 100.0% | 14 | 14.3 points | 15.8 points |

The one-window MDE is the change a single window could detect with 80% power from the standard error actually observed; the two-window figure is the change that makes a call on two consecutive windows 80% likely.

## 4. Does the published one-window MDE mean what it says?

Power of one window alone at several true sizes; at the stated MDE the interval should exclude zero about 80% of the time.

| True change | Windows whose interval excludes zero | Mean MDE (observed standard error) | Mean MDE (pre-registered formula) |
|---|---|---|---|
| 4.0 points | 4.7% | 14.5 points | 11.3 points |
| 6.0 points | 13.3% | 14.5 points | 11.3 points |
| 8.0 points | 25.0% | 14.5 points | 11.3 points |
| 10.0 points | 40.0% | 14.5 points | 11.3 points |
| 12.0 points | 57.3% | 14.5 points | 11.3 points |

## 5. A platform event that hits the control arm too

The same drop is injected on the control tasks. The verdict should say the platform or harness moved, not that the model regressed.

| Injected drop | Histories where the primary arm alone would fire | Labelled harness or platform | Still called regressed |
|---|---|---|---|
| 10.0 points | 246 of 300 | 76.8% | 23.2% |
| 15.0 points | 299 of 300 | 99.0% | 1.0% |
| 20.0 points | 300 of 300 | 100.0% | 0.0% |

## 6. One task collapsing

One task is driven to near zero from day 15 and nothing else changes (300 histories). The statistic must not call a regression on one task alone.

| Ever called regressed | Flagged as resting on one task by day 28 | by day 42 |
|---|---|---|
| 3 of 300 | 0 of 300 | 0 of 300 |

## 7. The anytime-valid monitor (schedules repeats, never gives a verdict)

| Setting | Histories | Flagged | Upper 95% bound |
|---|---|---|---|
| Known baseline, mean-zero differences, 90 days | 2000 | 0 | 0.2% |
| Baseline estimated from the first 14 days, no change | 300 | 0 (268 with a task flag) | 1.2% |

| Injected drop (all tasks) | Histories | Flagged | Median day flagged |
|---|---|---|---|
| 5.0 points | 300 | 17 | 69 |
| 10.0 points | 300 | 224 | 61 |
| 15.0 points | 300 | 299 | 44 |

## 8. What does `steady` cost?

`steady` is said when the interval lies inside the detectable change, that is, when no change at least that large is compatible with the data. It is not a claim that nothing changed. Every daily verdict from day 28 to day 90 is counted, with no change and with a real one, so the share of days that say `steady` while a change is real can be read off.

| Share of tasks hit | Drop on those tasks | Steady | Inconclusive | Called regressed | Harness or platform |
|---|---|---|---|---|---|
| none | none | 42.7% | 57.2% | 0.0% | 0.0% |
| 100.0% | 5.0 points | 14.6% | 84.0% | 1.3% | 0.1% |
| 100.0% | 8.0 points | 2.8% | 88.4% | 8.2% | 0.5% |
| 100.0% | 11.0 points | 0.2% | 68.5% | 29.6% | 1.7% |
| 100.0% | 15.0 points | 0.0% | 27.1% | 69.1% | 3.8% |
| 50.0% | 11.0 points | 12.0% | 86.8% | 1.1% | 0.1% |

The detectable change has a floor: the noise a pass-or-fail score cannot be without, computed from each task's baseline rate with one pass and one failure added. A window in which every score was a pass has no observed spread, and without the floor it would claim to detect a change of nothing and could never be called `steady`; with it, such a window is `steady` with a detectable change of a few points, which the card states.

## What this does not show

The generator is a model of canary data, not canary data. Its noise, its cluster shocks and its error rate are assumptions chosen to be realistic and stated above; if a team's real tasks are noisier, intervals widen and the MDE grows, and the statistic reports the observed figure, not these. Coverage near the nominal level here is evidence the interval is built correctly on data of this shape, not a guarantee on any other shape. A new regression cannot be called before the earliest call day.

Computed in 81 seconds.
