# Lab experiment 1: does a cost policy keep the work that matters? (DRAFT, not registered)

Status: a draft written while the feasibility spike was still running, so that the design is fixed before any experimental run. It becomes a registration when it is committed with the three numbers marked **FILL** completed from the pilot and before the first arm other than the baseline is run. Nothing in it has been run. If the spike's verdict is no-go, this experiment is not run and the draft stays as the record of what was planned.

## The question

For a team that pays for an agent on a frozen set of real coding tasks, does a spend policy applied at the gateway lower the cost of each verified success without lowering how often the task is solved, and does the system, shown the evidence, choose better than "do nothing"?

## Mechanism

Each run of an agent (OpenCode, with the model through Nightshift) talks to a gateway started for that run (`docs/verification/gateway-2026-10-24.md`), which talks to the Lab's accounting proxy. The gateway reserves and settles every call against the gate under a policy; the run is its own person, so a daily cap is a per-run cap, and the phase of a call (its place in the run) is the task type a routing rule can use. The proxy counts the tokens; cost is those tokens at prices the owner set for the two models (the endpoint is free, so the prices are virtual and stated in the record).

## Arms

| Arm | What it is | Why it is there |
|---|---|---|
| A, baseline | The agent straight to the proxy | What the work costs and how often it succeeds today |
| B, observed | The gateway in shadow mode (everything allowed, everything recorded) | An A/A control: whether the gateway alone changes results. If B differs from A, no later arm can be believed |
| C, static cap | A per-run cost cap at a fraction of the baseline's median cost (**FILL**: the fraction, from the pilot) | The broad policy a manager would write first |
| D, phase routing | The cheaper model for the first calls of a run, the stronger one afterwards | A routing change |
| E, desk's choice | The policy the desk proposes from the pilot's evidence: targeted caps and routing, with the exceptions it learned | The thing being tested |
| F, harm control | A cap at a tenth of the baseline's median cost | A policy known to hurt. If the analysis cannot see F's harm it cannot be trusted to see C's |

"Do nothing" is A.

## Tasks

The first thirty tasks that pass the validity audit and have a baseline pass rate between 20 and 80 percent in the pilot (the protocol in `00-spike-protocol.md`), frozen by content hash, in two sets: a development set where the desk may tune arm E, and a test set that is run once per arm and never used to choose between arms. **FILL**: the number of tasks and repeats, from `simulatePower` on the pilot's per-task pass rates, so that the paired test has at least 80 percent power at the smallest effect worth acting on. If the pilot cannot reach that power with the tasks available, the experiment is labelled exploratory and supports no claim.

## What is measured

- Primary: cost per verified success, per task: the virtual cost of the tokens of all the task's runs divided by the number that pass the hidden tests. A task whose runs all fail has no cost per success and is counted by the success measure instead.
- Primary, success: the share of a task's repeats that pass, per task.
- Also reported: wall time, calls, infrastructure failures (kept in the denominator and shown), and the tokens the run used after the policy refused a call.

## Analysis (fixed now)

- The unit is the task. Each task's repeats are averaged first; arms are compared by a paired test across tasks (`pairedTest`) and a bootstrap interval of the paired difference. Repeats of one task are never treated as independent.
- Assignment of runs to arms is randomised within each task with the probability each run had written down (`assignArms`).
- Smallest saving worth acting on: 10 percent of cost per verified success. Non-inferiority margin for success: 5 points absolute, one-sided at 0.05. Multiplicity across C, D and E by Holm's rule.
- A candidate is promoted only if its interval for the saving excludes zero on the test set, the lower bound of the success difference is above minus 5 points, and the control arms behave (below). Anything less keeps the established policy ("do nothing") and says which condition failed.

## Conditions under which the result is void

- Infrastructure failures above 15 percent of runs, or a difference in their share between arms of more than 5 points.
- Arm B differs from A on the primary measures by more than the simulated false-alarm rate allows.
- Arm F's harm is not detected.
- A task defect found in a failed run (the protocol's rule: fix, re-audit, repeat that task in every arm).
- A change to any prompt, task, hidden test, price or policy after the first non-baseline run.

## What would not be claimed even if it passes

That the policy holds for other models, other agents, other kinds of task, or other people; that virtual prices are what anyone would pay; that the result is "best" or "optimal". It would be a measured effect on this task set, with its interval and its limits.
