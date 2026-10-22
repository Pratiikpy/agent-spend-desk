# Profile: SWE-bench/SWE-bench (was princeton-nlp/SWE-bench)

Reader: Claude Sonnet, 2026-10-20. Remote reads, no clone. Paths relative to the repository root. Licence read first: MIT. Stars 6,060; last commit (pushed_at) 2026-09-18 (`gh api repos/SWE-bench/SWE-bench`). The old owner path redirects here.

## 1. What it is
The reference evaluation harness for "did this patch fix the issue": it applies a model patch inside a Docker container at the base commit, runs the repository's tests, parses the log, and reports `resolved` or not.

## 2. Architecture map
`swebench/harness/run_evaluation.py` (container, apply, run, log), `log_parsers/` per language (python, go, java, javascript, rust, c, php, ruby), `grading.py` (status maps to report to verdict), `infra_failure.py` (advisory environment classifier), `reporting.py`.

## 3. Features and how each behaves
Patch application tries four commands in order: `git apply --verbose`, `--3way`, `--reject`, then `patch --fuzz=5` (`swebench/harness/run_evaluation.py:54-58`). Tests run with a timeout; on timeout the log gets "Timeout error: N seconds exceeded." (`run_evaluation.py:367-376`). Empty or `None` patches are dropped from evaluation (`run_evaluation.py:627-638`) and a `None` patch is reported as `patch_is_None` (`grading.py:359-361`).

## 4. How people use it
`python -m swebench.harness.run_evaluation` with a predictions file. Outside the repository: NOT VERIFIED.

## 5. Mechanism for the Desk
**The judge is a pair of fixed test lists, set before the run.** `FAIL_TO_PASS` must now pass (resolution); `PASS_TO_PASS` must still pass (no regression). Resolved means both at 100%: `f2p == 1 and p2p == 1` is FULL, partial needs `p2p == 1` (`grading.py:309-326`). Copy: the Desk's "landed" needs both a positive test (the thing asked for) and a negative test (nothing else broke), not a single green run.

**Skips are not passes.** A skipped fail-to-pass test counts as failed; a skipped pass-to-pass counts as maintained (`grading.py:93-109`). A test missing from the output counts as failed under pass-and-fail grading (`test_failed`, `key is None`, line 103).

**Distrust the log.** Log parsing happens only between start and end markers (`grading.py:143-148`). An empty status map with no sign the suite ran is invalid, not a pass: zero-count lines such as "Executed 0 of 0" are explicitly not evidence (`grading.py:25-46,155-160`). Because a patch can print its own "PASSED" lines, the log is cross-checked against the test command's recorded exit status, and a non-zero exit with no failure in the map invalidates the run (`grading.py:162-175`). This is the single most reusable idea for agent spend: a claim of success is text; the exit code is evidence.

**Three outcomes, not two.** `resolved`, `not resolved`, and `infra_failure`, the last an advisory tag from log signatures split into environment tier (cannot be caused by patching source: browser launch, display, out of memory, daemon, DNS) and ambiguous tier (missing module, no tests collected, timeout) (`swebench/harness/infra_failure.py:21-61`). It never removes an instance from the denominator (`infra_failure.py:9-14`). Copy: separate "the agent was wrong" from "the world broke", and say the denominator did not change.

**Known defect honestly recorded.** 676 expected test ids in Verified are truncated, handled by a prefix match with a TODO naming it as misplaced (`grading.py:61-82`). Copy the habit of writing the data defect next to the workaround.

**Limits for us.** It judges a patch against tests written by humans for known issues. It cannot say whether an owner's own task was worth doing, and says nothing about cost, retries or loops. Resolution is binary per instance; it has no notion of kept after N days.

## 6. Agent patterns
None in the harness; agents are the thing evaluated. Isolation is the pattern: fresh container per instance, patch applied by the harness not the agent.

## 7. Model and data layer
No model calls. Data is a dataset of instances with base commit, test patch and the two test lists. Parsers are registered by name (`grading.py:22,125`).

## 8. Hackathon-care checks
Needs Docker and large images, so not a one-command offline path. Deterministic given a fixed environment. Strong on reproducibility, weak for a judge with a laptop.

## 9. Traps seen
Parser quality is the ground truth: a wrong regex turns into a wrong verdict (the repository carries a growing list of special cases, `grading.py:31-46`). Benchmark tests may not match real tasks. Truncated ids show label noise in the gold data itself.

## 10. Reuse
MIT: grading ideas and the cross-check rule may be reused with credit; we rewrite in TypeScript.

## 11. Verdict: ADAPT (the judging contract, for the daily canary and the cheaper-route replay)
Copy: (1) fail-to-pass plus pass-to-pass as the pass definition; (2) exit status cross-checked against log text, empty output is invalid; (3) infra failure tagged separately and left in the denominator.
Avoid: (1) trusting one parser for every runner; (2) binary-only outcomes; (3) calling a benchmark score a statement about the owner's own work.
Direct use: the Desk's "what would have passed on a cheaper route" replay must use this contract, with the owner's own test command as the P2P set and a recorded F2P where one exists, and must label the result NOT VERIFIED where no test exists.
