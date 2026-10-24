# The daily canary: schedule, guards and a harness name that holds (2026-10-25)

`desk canary run --if-due` is the hourly job; `desk canary schedule` prints the command for Task Scheduler, launchd or cron (it installs nothing); `desk canary run --preview` says what would happen and changes nothing.

## When it runs and when it does not

One run per UTC day, tried again at the next hourly call until it is recorded. In order:

1. **Done.** Today's primary arm already has rows: nothing to do.
2. **Harness changed.** If any stored row was measured with different tasks, prompts or checkers, the old runs are renamed `runs.<date>.superseded.jsonl` and a new baseline starts today as day 1. Scores before and after a change cannot be compared, so they are never mixed into one series.
3. **The plan guard.** The canary does not run when the owner's plan shows the weekly window 75% used or the five-hour window 60% used (the fullest reading among the tools that report one, no more than three hours old), so it never takes the last of someone's quota. With no recent reading the guard cannot apply, and the run says so.
4. **The budget guard.** A run is not made when its estimated cost, from the tokens of the last run priced at the model's own rates (an upper bound before any run), would exceed `CANARY_DAILY_BUDGET_USD` (default $1; `none` turns it off). A model with no price cannot be estimated and the run says so.
5. **A probe for a cache.** Before each arm, the endpoint is asked to repeat a code invented a moment ago; an answer without the code means something is replaying answers, and the arm is not run.
6. **The endpoint.** If fewer than half of a run's attempts produced a score, nothing is written (a failure of the harness must not look like a regression of the model), the reason is recorded, and the next hourly call tries again.

Every skip is recorded once per day and reason in `skips.jsonl`, and the canary card on the morning brief shows the latest one since the last run. Three days with no run show "not running". A manual `canary run` ignores the plan and budget guards (the owner chose) but not 1, 2, 5 or 6.

The primary arm runs five repeats of each of the 52 tasks (260 rows a day); the control arm, when a second model is named in `CANARY_CONTROL_MODEL`, runs three tasks from three clusters three times each (9 rows). `CANARY_REPEATS` changes the first.

## The harness name

The harness used to be named by hashing each checker's source text. That text differs between the compilers that run the Desk and its tests, so the sample's baseline, recorded under one compiler, read as "the platform or the harness moved" under another, and any update of the compiler would have called every stored baseline a changed harness. Found while testing the morning brief. The name is now made from what each checker declares (its kind, a version raised whenever that kind's logic changes, and its arguments), and a test scores a fixed table of answers with every kind, so changing a checker without raising its version fails the build. The hash is pinned in a test. Rows recorded under the first name are read as the second, by a fixed mapping checked against the tasks of the day it was introduced.

## What was run

- `tests/desk/canary/schedule.test.ts` (19) and `harness.test.ts` (8), with the earlier canary tests: the decision order and the edges of each guard (74.9% runs, 75% skips; 59.9 and 60), plan readings from fresh and stale samples across two tools, the budget estimate for a priced and an unpriced model, skips written once a day per reason, and the whole command against a scripted model: 260 and 9 rows, no second run in a day, day 2 the next day, a preview that writes nothing, a plan skip recorded once across two hourly calls and overridden by hand, a failing endpoint recording nothing and a good one recording the next call, a stale probe stopping an arm (and only the control arm when only the control is stale), a changed harness archiving the old runs, no model, no control arm; the card's skip reason as of a day and the three-day rule; the printed schedule for the three systems.
- With the pinned harness name the sample canary now reads "regressed" under every compiler, and the brief test no longer needs a workaround.

## Not covered

- The hourly job has not been installed and left running: the printed command is correct for the three schedulers by its form, and has not been run by a real scheduler. NOT VERIFIED across a real day.
- The canary runs the model named in `MODEL_*` (on this machine the Nemotron route), not the owner's own agent with its tools and its version. A change of the agent's tool version is therefore not something this canary can see; the harness guard covers the Desk's own tasks only.
- The tasks are a fixed generic pack of 52. Tasks captured from the owner's own work are DF-036.
- The probe shows that one answer was fresh; it cannot prove that no cache exists.
- The plan guard reads the readings the Desk already has (Codex logs and a Claude Code status line, when turned on); on this machine no Claude reading exists.
