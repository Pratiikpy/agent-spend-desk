# Profile: ClinicalAgents-Code (KDD 26 reference code)

Reader: Haiku (low effort), 2026-10-16, about 82 seconds, 105k tokens, 23 tool calls. Local clone. Paths relative to the repository root. (The owner of the repository is NOT VERIFIED.)

Spot-check (reviewer, against the files): no LICENSE file anywhere (confirmed by search, so reuse rights are NOT VERIFIED and the code is reference only); `app_config` is imported by `main.py`, `mcts_config.py` and `med_orchestrator.py` but the file is not in the repository (confirmed, so the search parameters cannot be reproduced from this clone); the backtrack rule at `med_orchestrator.py:670-680` returns true only when there is missing evidence, a recheck budget and enough action budget left, and the action just run is the doctor or the diagnosis task (confirmed, the comment cites "Eq. (8)"); a check that the rollout model differs from the professional-agent model, raising an error otherwise, at `med_orchestrator.py:330-352` (confirmed). The snapshot module details, the five-task metrics and the recheck heuristics were not rechecked. Result: PASS on the parts checked.

## 1. What it is
Reference code for a clinical decision paper: five task agents (referral, doctor examination planning, imaging report, diagnosis, treatment) coordinated by an orchestrator that uses Monte Carlo tree search, with a dual memory (case state and experience).

## 2. Architecture map
`med_orchestrator.py` (the loop), `mcts_search.py`, `mcts_state.py` (snapshots and action history), `mcts_prompts.py`, `state_memory.py` (case state as JSON), `agents/` (task agents), `prompts/`, `main.py` (benchmark harness with a thread pool).

## 3. Features and how each behaves
Control actions besides the task agents: retrieve experience, backtrack, terminate. Evidence is tracked as pending and completed exams. Hypotheses are lists of disease, evidence and confidence. The search scores candidate actions with a planning model and runs rollouts with a different simulation model. Parse failures in agents often return empty values.

## 4. How people use it
Build the orchestrator with memory paths, search configs and a recheck limit, then call `run` per case; the harness runs many cases and scores five tasks. No tests found. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M5 evidence-gated decision, rollback)
After a hypothesis or diagnosis step, a language-model detector compares what has been examined with what the leading hypotheses require and lists gaps. If gaps exist and budgets remain, the orchestrator chooses an earlier snapshot, restores that case state and re-runs the action as a recheck. Snapshots hold the full state plus metadata (reason, step, stage). Budgets: a recheck limit and a cap on search steps and rollout calls. Lost: the missing-evidence list comes from a model, not from a rule we can inspect.

## 6. Agent patterns
Independent specialists, an orchestrator-level critic (missing-evidence detector), a backtrack loop selected by the search, shared case state, confidence gating on the top hypothesis for a recheck.

## 7. Model and data layer
Two distinct model configs by design (planning versus simulation); prompts in files; experience memory loaded from external guideline paths (the memory class itself was not found).

## 8. Hackathon-care checks
Action history and snapshots form a trace; per-case model call counts are summarised. No sample mode, no Docker, and the missing config file blocks any run from this clone.

## 9. Traps seen
Parse failures return empty values without a log line in at least the diagnosis agent; case-state defaults are spread across modules; a required config file is absent; no licence.

## 10. Reuse
No licence: do not copy code. Ideas (evidence-gap-triggered rollback, snapshot recovery, separate simulation model) may be implemented independently.

## 11. Verdict: REFERENCE ONLY for M5; implement the ideas ourselves
Copy (as ideas): (1) a gap check after a hypothesis step that can send the case back to an earlier snapshot, within a stated budget; (2) full-state snapshots with a reason, so a rollback is explainable; (3) an enforced rule that the model doing simulation or attack differs from the model that proposed.
Avoid: (1) empty values on a parse failure: record an invalid step; (2) a gap detector that is only a prompt: ours pairs it with a rule list for required evidence per action; (3) shipping code that cannot run because a config file is missing.
Where we are already ahead: the required evidence per action is a policy rule, and a rollback leaves a certificate trail.
