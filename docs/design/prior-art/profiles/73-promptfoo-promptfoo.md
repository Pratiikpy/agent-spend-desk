# Profile: promptfoo/promptfoo (eval runner, assertions, CI use, red-team, result store)

Reader: Claude Sonnet, 2026-10-20. Licence read first: MIT (gh api, 2026-10-20). Stars 26,184; pushed_at 2026-10-20T03:54:47Z (used as last-commit date). Paths relative to the repository root; line numbers from the raw files on `main`. Not cloned (disk), so nothing was executed.

## 1. What it is
A TypeScript CLI and library that runs a matrix of prompts, providers and test cases, grades each output with assertions (deterministic and model-graded), stores results in SQLite and exits non-zero when the pass rate falls under a bar. A red-team generator sits on top (`src/redteam/index.ts:42,56` loads plugins and strategies).

## 2. Architecture map
`src/evaluator.ts` (6,302 lines) drives test x prompt x provider cells and a `repeat` loop (`:478`, `:484-486`). Each cell calls a provider, then `src/assertions/index.ts` runs the assertions and combines scores by `weight` and `threshold` (`:674-678`, `:781`, `:876`). Model grading lives in `src/matchers/llmGrading.ts`. HTTP and model responses go through a disk cache (`src/cache.ts`). Results land in SQLite tables (`src/database/tables.ts`).

## 3. Features and how each behaves
- Assertions: about 50 files in `src/assertions/` (contains, regex, json, javascript, python, cost, latency, llm-rubric, g-eval, factuality, select-best, trajectory, tool-call F1). `threshold` on a test fails it when the combined score is lower (`site/docs/configuration/reference.md:69`).
- Cost as a gate: `cost` needs a `threshold`, passes when `cost <= threshold` (`src/assertions/cost.ts:3-27`). With `weight: 0` and a `metric` it records cost as a number that cannot fail the test (`cost.ts:5-9`; `assertions/index.ts:674-678`).
- Exit codes: 100 on any failure or pass rate under `PROMPTFOO_PASS_RATE_THRESHOLD` (default 100), 1 on error (`site/docs/usage/command-line.md:172`, `:1109`).
- Failure behaviour: a grader that errors is marked `graderError` and is not flipped by inverse assertions (`src/matchers/llmGrading.ts:444-452`); a malformed grader reply throws and the row becomes an error, not a pass (`:256-265`).

## 4. How people use it
`npx promptfoo eval` with a YAML config. The CI page shows a nightly cron (`site/docs/integrations/ci-cd.md:194-195`), `--fail-on-error` and a jq pass-rate gate (`:111-121`), and a scheduled red-team scan (`:337-345`). Usage numbers and issues: NOT VERIFIED.

## 5. Mechanism for the Desk
Data model to copy. Per run: `evalsTable` holds `config`, `prompts`, `results`, `runtimeOptions` (`tables.ts:58-70`). Per cell: `evalResultsTable` holds `testCase`, `provider`, `latencyMs`, `response`, `error`, `failureReason`, `success`, `gradingResult`, `namedScores` (`tables.ts:79-113`). That is the right grain for a canary history: one row per task, per route, per day.

Daily canary use and its trap. The cache is on by default (`cache.ts:56`) with a 14 day life (`:61-62`), so a repeated daily run of the same prompt returns yesterday's answer and measures nothing. A canary must run with `--no-cache` (`command-line.md:126`) or a per-day cache namespace (`cache.ts:208-209`). `repeat` adds a per-repeat cache suffix (`:971`) so repeats are independent only when the cache is on and keyed per repeat. promptfoo has no drift statistics: it compares one run to a fixed threshold, not to a baseline distribution (searched `src/evaluator.ts` and the CI page for baseline, paired or significance logic: none found; a full-repo search was not run).

Judge controls available: pick the grader (`--grader`, `model-graded/index.md:233-236`), pin `temperature: 0` in the grader config (`llm-rubric.md:146-170`), replace the rubric prompt, set a score `threshold`. The default grading prompt is a short two-example pass/fail JSON prompt (`src/prompts/grading.ts:11-30`). No control for self-preference, position or verbosity bias was found: `select-best` lists outputs by index in the order given (`grading.ts:146-157`), and a search of the llm-rubric and select-best docs for bias, order and shuffle found nothing.

Cheaper-route replay: run the same tests against two providers in one config and compare per-cell `success` and `cost`. There is no paired statistic and no non-inferiority test; the comparison is a table. We would add the pairing and the interval.

## 6. Agent patterns
Trajectory and tool-call assertions (`trajectory.ts`, `toolCallF1.ts`, `agentRubric.ts`) grade agent traces; `DEFAULT_AGENT_GRADING_PROMPT` tells the grader to treat the output and retrieved material as untrusted (`grading.ts:32-55`). Worth copying for our judge prompt.

## 7. Model and data layer
Providers are pluggable by id string; the grader is just another provider. Dollar cost comes from the provider response, so it is an estimate whenever a provider omits it (`cost.ts:13-15` throws when absent).

## 8. Hackathon-care checks
Offline: runs with local or mock providers (NOT VERIFIED). Trace: rows in SQLite, not JSONL. Secrets: `cache.ts:26` imports a sanitiser (`isSecretField`, `looksLikeSecret`) for cached requests; scope of its use elsewhere NOT VERIFIED. Heavy: a large Node dependency tree; do not embed, borrow the ideas.

## 9. Traps seen
Cache hides drift (section 5). A pass rate of 100 percent is the default bar, so one flaky model-graded row fails CI. Cost assertions fail hard on providers without cost. LLM-graded rows differ run to run unless the grader is pinned.

## 10. Reuse
MIT: ideas and small code may be reused with credit and notice. Rebuild in TypeScript on our own runtime anyway.

## 11. Verdict: ADAPT (cell schema, exit-code gate, cost as a zero-weight metric); do not adopt the runner
Copy: (1) the per-cell result row with `gradingResult`, `namedScores`, `latencyMs`, `failureReason`; (2) cost recorded as a metric that cannot fail the cell, plus a separate cost gate; (3) grader error as a distinct state, never a pass or a fail.
Avoid: (1) caching a canary; (2) a fixed 100 percent pass bar with model-graded rows; (3) one-judge grading with no agreement check.
