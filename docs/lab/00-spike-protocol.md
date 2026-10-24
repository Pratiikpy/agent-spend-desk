# Lab spike protocol (fixed before the first measured run)

Written 2026-10-24, before any measured spike run. It answers one question from the build plan (Phase 3, conviction check): can a real coding agent on Nemotron, reached through Meterless Nightshift, be measured well enough on this machine for the Lab's experiments to mean anything?

## What is run

- **Agent:** OpenCode 1.17.13 (MIT), in an isolated configuration: only the lab's model provider, no global settings, no plugins, no web access, file tools limited to the workspace, a shell allow-list (`node`, `npm`, `ls`, `cat`, `grep`, `git status/diff/log/show` and a few more). It is not a security boundary; the real Lab runs agents in containers.
- **Model:** `nvidia/nemotron-3.5-super-vl-120b-a12b`, through Nightshift on 127.0.0.1:8088, which calls NVIDIA's API. Sampling is not seeded and cannot be: the seed in each record fixes run order only.
- **Tasks:** ten handwritten tasks in `lab/tasks/spike/` (eight features, one of them a prototype-pollution-safe merge, and two bug fixes), each with a prompt that states every behaviour the hidden tests check, visible tests in the repository, hidden tests added by the grader, and a gold change. All ten pass the task audit (`desk lab audit`): the gold change passes every test three times in a row, the starting state fails at least one, test names are unique, and four cheating moves fail (do nothing, delete the tests, replace the tests, exit early).
- **Runs:** each task five times, in a seeded random order with repeats interleaved. One run at a time (OpenCode takes about 1 GB of memory and the machine is near its memory limit). Time limit per run: 15 minutes.
- **Accounting:** every model call goes through the lab proxy, which records tokens, latency, retries, errors and the Nightshift receipt, and never the text. The proxy repeats rate-limit and server errors up to eight times with a growing wait, and gives each call a cache scope of its own (Nightshift's response cache answered repeated planner requests with an empty message on 2026-10-24).
- **Outcome classes:** pass, fail, timeout, infra. A run where the agent made no model call, or whose last model call failed after the proxy's retries, is infra. Infra runs stay in the denominator and are reported as their own class, with a second figure that leaves them out.

## What counts as a go

All of these, on the measured batch:

1. **Informative tasks:** at least 25% of tasks (3 of 10) have a pass rate from 20% to 80% inclusive. Below that, an intervention has no room to show an effect in either direction.
2. **Infrastructure:** infra runs are at most 15% of all runs. Above that, the measurement is mostly measuring the endpoint.
3. **Reproduction:** a second batch on another day, same tasks and settings, has an overall pass rate within 15 points of the first, and per-task pass rates with a Spearman correlation of at least 0.6 across the two days. These thresholds come from the binomial noise at five repeats per task (the standard error of an overall rate over 50 runs is about 7 points per day) and are a pilot choice, to be tightened once the real variance is known.
4. **Accounting:** every run that made model calls has at least one call whose reply carried a Nightshift receipt, so that "served by Nightshift" is shown by receipts and not claimed. A streamed reply carries the runtime's block with a `receipt_id` and a routing decision but not the `schema` field that a whole reply has; the proxy counts both, and the report says which it saw.
5. **Graders:** no failed run is traced, on reading its transcript and diff, to a defect in the task (a test that rejects a correct solution, or a requirement the prompt does not state). Every such defect found is fixed in the task, the task is re-audited, and its runs are repeated.

## What follows from each outcome

- **Go on all five:** the Lab is built on this agent and these tasks, the corpus grows to mined tasks, and the sample sizes for the real experiments are chosen by simulation from this batch's per-task rates and run-to-run variance.
- **Informative tasks below 25%:** the tasks are too easy or too hard for this model. Change the tasks (harder or easier), not the threshold, and run the spike again.
- **Infrastructure above 15%:** lower the load (fewer concurrent calls, a different time of day), or change the endpoint. Report the infra share with every result in the meantime.
- **No reproduction:** report the size of the day-to-day difference, find its source (endpoint variation, task defects, agent nondeterminism), and do not run intervention experiments until it is explained.
- **If real-agent evaluation proves infeasible here,** say so, with these numbers, and say what that costs the claims about desk. on real coding agents: they would rest on the canary pack and the ledger alone, which are weaker evidence.

## What this spike cannot show

- It does not show that desk. changes anything. No intervention is applied. This is the baseline.
- Ten handwritten tasks are not a benchmark. They tell us whether the measurement works, not how good any agent is.
- One agent, one model. Results do not transfer to other agents or models.
- The tasks are public in this repository, so a model trained on it later could memorise them. The held-out private tasks in the Lab plan exist for that reason.
- Runs are on the author's machine at the author's network conditions; quota behaviour at other times of day is not covered.

## Changes made while the spike was running (thresholds unchanged)

Recorded the day they were found, because a measurement that was changed after it started has to say so.

- **2026-10-24, before any valid result:** the first batch was set aside. Four of the ten tasks had no `package.json`, so the agent's `npm test` ran the repository's own test suite; the audit now fails a task without a test script. Workspaces were moved out of the repository, because an agent could read the hidden tests by walking up from a workspace inside it.
- **2026-10-24, after 5 valid runs:** one run (path-router, repeat 1) ended as a 15-minute timeout while the model endpoint had stopped answering a call. The proxy now gives each call a budget of six minutes, answers 504 when the endpoint stalls past it, records a call the agent abandoned after a minute or more as an error, and a run whose last call ended that way counts as an infrastructure failure and not as a failed attempt. The run was set aside (`data/lab/invalid/`) and is repeated. The proxy also repeats a model reply that ends with `empty_response`.
- No threshold, task, prompt or hidden test changed.
- **2026-10-24, after 11 valid runs:** reading a failed paginate-cursor run (protocol item 5) showed a task defect: the hidden test rejects a cursor whose JSON text is valid but not written exactly as `{"id":5}` (a space after the colon), and the prompt's list of invalid cursors did not say so. The prompt now states the requirement and gives that example; the task was re-audited (gold passes, base fails the 9 expected tests) and its earlier run was set aside to be repeated. No test changed, and no run of another task was affected.
