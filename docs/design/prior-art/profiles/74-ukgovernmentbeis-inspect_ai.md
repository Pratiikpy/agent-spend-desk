# Profile: UKGovernmentBEIS/inspect_ai (tasks, solvers, scorers, logs, pluggable judges)

Reader: Claude Sonnet, 2026-10-20. Licence read first: MIT (gh api, 2026-10-20). Stars 3,050; pushed_at 2026-10-20T12:54:54Z (used as last-commit date). Paths relative to the repository root. Not cloned; nothing was executed. Most of the package was not read: the scorer, metric, reducer, cache and rescoring code and the docs on them were.

## 1. What it is
The UK AI Security Institute's Python framework for model evaluations: a Task is a dataset, a solver chain and a scorer; runs write a log file that can be re-read and re-scored later. livenerf (profile 75) is built on it.

## 2. Architecture map
`src/inspect_ai/_eval/task/task.py` defines Task (`epochs`, `fail_on_error`, `message_limit`, `token_limit`, `time_limit`, `working_limit`, `cost_limit`, `early_stopping`, `model_roles`; `:100-117`). Solvers in `src/inspect_ai/solver/`. Scorers and metrics in `src/inspect_ai/scorer/`. `_eval/score.py` re-scores existing logs. Model caching in `src/inspect_ai/model/_cache.py`.

## 3. Features and how each behaves
- A scorer is an async callable `(state, target) -> Score | None` (`scorer/_scorer.py:34-62`); registering is a decorator, so any function can be a judge, a test runner or a regex.
- Epochs repeat each sample and a reducer collapses them: mode, majority, mean, median, max, `pass_at`, collect (`scorer/_reducer/reducer.py:12,41,85,107,164,247,304`).
- Limits per sample, including dollars (`cost_limit`, `task.py:116`); a failing sample fraction can abort the run (`fail_on_error`, `:108`).

## 4. How people use it
`inspect eval task.py --model ...`; logs viewed in a browser viewer. Repositories such as livenerf build a scheduled series on top. Usage claims beyond that: NOT VERIFIED.

## 5. Mechanism for the Desk
Everything the Desk needs for scoring honesty is here as a pattern.

Pluggable scorers, cheapest first. `cascade` runs scorers in the order given and stops at the first that settles the sample, so a judge model runs only when cheap checks (exact match, tests, schema) did not settle it. It states its own risk: it assumes the earlier stage never gives a false positive (`scorer/_cascade.py:12-42`). It records `decided_by` on the score (`:34-37`).

Judge panel and bias controls. `model_graded_fact` and `model_graded_qa` take a list of grader models; each grades independently and the reducer defaults to `"majority"`: a grade must win more than half the panel or the sample stays unscored (`scorer/_model.py:81-100`). The grader is a named model role, separate from the model under test (`:85-93`). Trap: when no model is bound to the role, the evaluated model grades itself (`:91-93`). Agreement is measurable: `krippendorff_alpha` over per-judge ratings kept by the `collect` reducer (`scorer/_metrics/krippendorff.py:21-40`; `docs/multiple-scorers.qmd:204`). A verdict outside the offered set leaves the sample unscored instead of guessing (`_model.py:72-80`). Position and verbosity bias controls: none found in what was read (NOT VERIFIED beyond that).

Statistics. `stderr` can be clustered by a metadata key, citing Miller, "Adding Error Bars to Evals" (arXiv:2411.00640, Appendix A), with a G/(G-1) correction and a guard that returns 0 for one cluster (`scorer/_metrics/std.py:86-118`); `bootstrap_stderr` resamples 1,000 times (`:17-54`). There is no drift or regression test; comparing two logs is left to the user, which is what livenerf adds.

Replay and re-scoring. `score(log, scorers, action="append" | "overwrite")` re-scores a stored log without calling the model again (`_eval/score.py:78-90`). The model cache key is model name, base URL, message history, epoch and generation config (`docs/caching.qmd:14-22`), default life one week, per-epoch by default (`model/_cache.py:101,108`). So replaying the same task inputs on a cheaper model is a different cache key by construction, and a changed judge can re-score yesterday's outputs for the cost of the judge only.

## 6. Agent patterns
Solvers are composable steps (`_basic_agent.py`, `_critique.py`, `_use_tools.py`, `_fork.py`); sandboxes isolate tool use. Useful as a model of "agent under test", not as our runtime.

## 7. Model and data layer
Providers are plugins under `model/_providers/` (a `mockllm.py` exists; contents not read). `model_roles` map a role to one model or a list (`task.py:100`).

## 8. Hackathon-care checks
Logs are structured and self-describing (samples, scores, usage, events); livenerf reads token usage and metadata from them directly (`livenerf/analysis/__init__.py:49-88`). Offline mode needs a mock provider (NOT VERIFIED).

## 9. Traps seen
Self-grading fallback (section 5); cascade trusts cheap stages; the default `value_to_float` returns 0 with a warning for list or dict values (`std.py:25-31`), so a structured judge score can silently count as zero; `bootstrap_stderr` uses unseeded `np.random` (`std.py:48`), so the number moves between calls.

## 10. Reuse
MIT: copy with credit. We rebuild the ideas in TypeScript; the algorithms are small.

## 11. Verdict: ADAPT the scorer protocol, cascade, judge panel with majority-or-unscored, clustered error bars and re-score-without-rerun
Copy: (1) cheap-stage-first cascade that records which stage decided; (2) a judge panel that abstains when no majority, with Krippendorff agreement reported; (3) re-scoring stored outputs so a judge change never costs a model run.
Avoid: (1) a judge that defaults to the model under test; (2) silent zero for non-scalar scores; (3) unseeded resampling in a number we publish.
