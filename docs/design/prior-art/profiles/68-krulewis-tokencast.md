# Profile: krulewis/tokencast

Reader: Claude Sonnet, 2026-10-20. Remote read (no clone). Paths relative to repo root. Licence read first: MIT (LICENSE). Last commit read: 2026-04-07 (API `pushed_at` 2026-04-26; repo created 2026-03-04). Stars 2. Spot-check: heuristics.py:127-131, estimation_engine.py:372-388, update_factors.py:23-24 and 176 re-read; matched. Tests were not run (NOT VERIFIED).

## 1. What it is
A Python package, MCP server and Claude Code plugin that estimates the dollar cost of a planned development task before it runs, then learns a correction factor from reported actuals (README.md:12, 200-209).

## 2. Architecture map
`estimate_cost` -> `compute_estimate` (estimation_engine.py:462) -> per-step token base (`:167-235`) -> band cost (`:242-317`) -> calibration factor (`:324-365`) -> sum. `report_session` writes estimate-vs-actual to `history.jsonl`; `update_factors.update_factors` rewrites `factors.json` (update_factors.py:123-321). `tokencast_status.py` reports band coverage. Hooks (plugin/hooks) run the learn step at session end.

## 3. Features and behaviour
Inputs: size (S/M/L), file count, complexity low/medium/high, optional steps, parallel groups, file-size measurement. Output: optimistic / expected / pessimistic per step and total (README.md:212-236). Telemetry to PostHog is on by default (README.md:141-160).

## 4. How people use it
`/plugin install` for Claude Code or `pip install tokencast` (README.md:20-56). Tests: 40 test files; counts: estimation engine 109 functions, per-step factors 64, telemetry 70, calibration convergence 29.

## 5. Mechanism for the Desk (what an honest forecast needs)
Formula, exactly: for each step, `input_base`, `output_base` come from hand-set activity constants (file_read 10,000 in / 200 out, etc.: heuristics.py:25-36) times counts in a fixed 8-step pipeline named Research Agent, Architect, Engineer, Staff Review, Test Writing, Implementation, QA (heuristics.py:54-116). Then x complexity (0.7/1.0/1.5, :120-124), context accumulation `input x (K+1)/2` (estimation_engine.py:272), a three-term cache cost with hit rate 0.6/0.5/0.3 (pricing.py:54-58; engine :306-311), x band multiplier 0.6/1.0/3.0 (heuristics.py:127-131). Review-loop cost is a geometric series with decay 0.6 (engine :415-422).
What is sound: it separates expected from a tail band; it measures coverage after the fact (`band_hit`, `pct_within_expected`, `pct_within_pessimistic`: tokencast_status.py:105-122, 348-386) and recommends widening or narrowing when more than 80% land optimistic or more than 30% exceed pessimistic (:26-28, 557-590); calibration is stratified with a fallback chain step -> signature -> size -> global -> none (engine :324-365); recency weighting uses a 30-day half-life only above 5 records (update_factors.py:26-28, 89-120).
What is wrong or thin for us:
- The bands are fixed multipliers, not quantiles. Calibration re-anchors optimistic and pessimistic as 0.6x and 3.0x of the calibrated expected (engine :372-388), so the spread never learns.
- The tail is deleted. Sessions with actual/expected above 3.0 or below 0.2 are excluded from calibration (update_factors.py:23-24, 176-190). Those are the loops and retries a bill owner cares about, and 3.0 equals the pessimistic multiplier, so the "pessimistic" band is by construction never tested against its own overshoot.
- Constants are the author's own workflow guesses; no source for 10,000 tokens per read. Prices cover three Anthropic models and were last updated 2026-03-04 with a 90-day stale warning (pricing.py:6-13, 17-36).
- Actual cost is typed in by the user (`report_session` schema, tools/report_session.py:12-25) or summed from Claude Code logs minus a baseline (plugin/scripts/sum-session-tokens.py:1-14). No outcome field: records hold expected, actual, size and steps only (update_factors.py:144-149). A failed run and a landed run teach the same factor.
- Convergence tests are synthetic: 30 sessions at a constant ratio 1.5 converge to 1.5 (tests/test_calibration_convergence.py:1-48). That proves a mean converges, not that a forecast is accurate on real tasks. I found no backtest on real history: NOT VERIFIED.
- The README's calibration description (README.md:243-246) matches the code: trimmed mean up to 10 samples, EWMA above (update_factors.py:227-230), outlier cut 3.0 and 0.2.
An honest forecast for the Desk therefore needs: the owner's own task history keyed by task type; empirical quantiles (not x3.0); the tail kept and modelled as its own loop/retry component; coverage reported per cohort with the sample size; a visible price-table date; and an outcome label so the denominator is "landed work", not "sessions".

## 6. Agent patterns
It models agent pipelines but runs none. `parallel_groups` discounts input 25% and cuts cache rate 15 points (heuristics.py:151-155).

## 7. Model and data layer
Pure functions plus flat files under `~/.tokencast/calibration/` (`history.jsonl`, `factors.json`, atomic writes: update_factors.py:324-330). No network except telemetry.

## 8. Hackathon-care checks
Offline, deterministic, no keys. Telemetry on by default is a privacy flag to turn off in any demo (README.md:143).

## 9. Traps seen
Pipeline names tie it to one team's process; band labels read as probabilities but are not; the status tool's fallback `band_hit` uses ratio cut points 0.6 and 3.0 which restates the multipliers (tokencast_status.py:116-122); estimates assume cache hit 50% with no evidence.

## 10. Reuse
MIT: copy with credit. Candidate parts: band-coverage report, calibration fallback chain, atomic factor file, the "bands too narrow/wide" rule.

## 11. Verdict: ADAPT (method only)
Copy: (1) estimate-then-measure loop with per-cohort coverage reported next to the number; (2) stratified fallback chain with minimum samples; (3) time-decay weights.
Avoid: (1) dropping outliers above the top band; (2) constant-multiplier bands called confidence; (3) forecasts with no outcome denominator.
