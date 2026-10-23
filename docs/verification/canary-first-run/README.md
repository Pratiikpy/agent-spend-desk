# Canary, first recording: 16 tasks, 4 clusters

This is the first real recording of the canary, kept as evidence because it did not give the answer we wanted, and what we changed because of it.

## What was run

One real model call per task, per day, per arm, for 30 assigned dates (2026-09-30 to 2026-10-29), against NVIDIA's API:

- primary arm: `nvidia/nemotron-3.5-super-vl-120b-a12b` on days 1 to 14, then `nvidia/nemotron-3.5-lightning-30b-a3b` from day 15 (a switch made on purpose, so the series contains a regression to find);
- control arm: `nvidia/nemotron-3.5-lightning-30b-a3b` throughout, on every second task;
- the pack: 16 tasks in 4 clusters (money, logic, records, code), scored by code that reads text.

Rows: `runs-16-tasks.jsonl` in this folder. Each row records the served model id the endpoint reported, a score of 0 or 1 (or no score for an error), and a hash of the harness.

## What the statistic said

```
Canary, day 30 (2026-10-29): No call
  the interval is too wide to call
  change against the baseline: -35.3 points (99% interval -88.2 points to +17.6 points) on 16 tasks
  smallest change one window can detect (80% power): 60.5 points
  control arm: not read, the rule stopped before it was needed
  pass rate   baseline (days 1-14) 93%   latest window 58%
```

The pass rate fell from 93% to 58% and the canary refused to call it. The refusal was correct: the statistic treats a cluster of related tasks as one unit, so 16 tasks in 4 clusters is four data points, and a 99% interval on four points is about 53 points wide on either side of the estimate. Any drop smaller than about 60 points was uncallable with this pack.

## What we found out, and what we changed

1. The published simulation (`docs/verification/canary-simulation.md`) had been run for a different design from the one we recorded: 24 tasks, 6 clusters, 5 repeats a day, against a recorded pack of 16 tasks, 4 clusters and one repeat a day. Its smallest detectable change did not describe the pack. The simulation's defaults now match the pack that is run.
2. The pack was too small. It is now 52 tasks in 13 clusters of 4 (money, logic, records, code, units, calendar, text, tables, probability, sql, formats, algorithms, reading). Each new task's right answer was computed independently, and its checker accepts the right answer and rejects the slips a weaker model makes (`tests/desk/canary/canary.test.ts`).
3. The statistic, its thresholds, the two-window rule and the control-arm rule were NOT changed. The expanded pack is a design change made because of the first result, so the second recording is reported as a second recording and this first one stays in the repository.
4. One display line was wrong: the card said "control arm: none in this data" when a control arm existed but the rule had stopped before reading it. It now says so.

## The second recording

The 52-task pack, the same 30 assigned dates, the same switch on day 15 (`nvidia/nemotron-3.5-super-vl-120b-a12b` to `nvidia/nemotron-3.5-lightning-30b-a3b`), the same statistic. The control arm is the unchanged strong model on every second task. The rows are `data/sample/canary/runs.jsonl`.

```
Canary, day 30 (2026-10-29): Regressed
  change against the baseline: -40.0 points (99% interval -56.2 points to -23.8 points) on 52 tasks
  smallest change one window can detect (80% power): 20.7 points; for a two-window call: 22.9 points
  control arm: flat (-2.2 points, 95% interval -6.7 to +2.3, 26 tasks)
  harness: unchanged; error rate 2%
  pass rate   baseline 92%   latest window 52%   (control 88% to 86%)
```

The call is consistent with, and not proof of, the served-model switch. The recording was not done in one pass: the control arm was re-recorded on the strong model after the first attempt used the weaker model, and the endpoint's rate limits cost several restarts; rows with no score are errors (2% of attempts) and are not counted as zeros.
