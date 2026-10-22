# Profile: Maciek-roboblog/Claude-Code-Usage-Monitor

Reader: Claude Sonnet, 2026-10-20. Licence read first: MIT (`gh api` reports MIT). Stars 8,749; last push 2026-07-05 04:52 UTC; latest release v4.0.0 on 2026-06-27 (previous v3.1.0 on 2025-07-23, a year earlier). Python, `src/claude_monitor/`. Slowest cadence of the four.

## 1. What it is
A live terminal dashboard for Claude Code showing the current 5-hour block, a token burn rate, and a prediction of when the plan limit is hit. The simplest forecaster here, and the one that most openly labels its plan numbers as estimates.

## 2. Architecture map
`core/{models,calculations,plans,p90_calculator,pricing}.py`, `data/{reader,analyzer,aggregator,warehouse}.py`, `monitoring/{orchestrator,session_monitor}.py`, `output/official.py`, `ui/*`. Flow: read JSONL, dedupe, build session blocks, burn rate and projection, render.

## 3. Features and failure behaviour
Plans pro, max5, max20, team, custom. Team is flagged `unverified` with guidance to prefer the official source (`core/plans.py:70-80`). Unknown (non-Anthropic) models are priced at 0, not at a fabricated Claude rate (`core/pricing.py:58-65`). Limit detection reads Claude Code's own "limit reached" messages and tool results, including an Opus-limit variant and parsed reset times (`data/analyzer.py:104-116, 286-296, 408-411`).

## 4. How people use it
`pip` or `uv tool install`, run `claude-monitor`. Tests: about 20 files under `src/tests/`. Issue evidence: NOT VERIFIED.

## 5. Mechanism for the Desk
Plan table (`core/plans.py:51-87`): Pro 19,000 tokens, $18, 250 messages; Max5 88,000, $35, 1,000; Max20 220,000, $140, 2,000. These are hard-coded community estimates (`confidence = "local_estimate"`, `:39`), not discovered. A reader should treat them as unverified.
Custom plan limit by P90 (`core/p90_calculator.py:17-49`): look at finished, non-gap blocks; keep those whose tokens reached 95% of any common limit (19k, 88k, 220k, 880k; threshold `plans.py:102-103`); if none, use all finished blocks; limit = 90th percentile (`statistics.quantiles(n=10)[8]`) floored at 19,000; cached one hour (`:65`). Idea worth keeping: infer a personal ceiling from the sessions where the user actually hit a wall.
Session blocks (`data/analyzer.py:25-32, 134, 149, 225`): 5-hour duration, new block when an entry is at least a duration after the last, gap blocks.
Burn rate and projection (`core/calculations.py:34-91`): needs an active block of at least 1 minute and non-zero tokens; tokens per minute = total (input, output, cache write, cache read) over block minutes; cost per hour likewise; projected total = current plus rate times remaining. Also an hourly rate: each block's tokens prorated by overlap with the last hour (`:167-187`).
Official overlay (`output/official.py:1-60`): reads Claude Code's statusline JSON `rate_limits.{five_hour, seven_day}` with `used_percentage` and `resets_at`, labels it `confidence="official"`, expires it after 600 s (`:42`), and defends against a known upstream bug where `used_percentage` carries the epoch (`:50-60`).
Warehouse (`data/warehouse.py:184-216, 260-274`): a JSON document, not SQL; record per request with day, project, model, ids, four token counts, cost; key is a SHA-256 of source kind, account, timestamp, project, model, message id and request id; limit events stored with their own key and reset time (`:239-288`); 365-day retention.
Loses: counts cache-read tokens in the token limit (inflates against a message-based plan); linear projection; plan numbers drift and are unverifiable; no cost-to-outcome; project is the folder.

## 6. Agent patterns
None.

## 7. Model and data layer
Fallback price table with legacy overrides for old Opus and Haiku (`core/pricing.py:31-113`), cache creation at 1.25 x input and cache read at 0.1 x input stated in a comment (`:30`). No live catalog. A `fable` family row exists (`:50-55`).

## 8. Hackathon-care checks
Pure local; no network. Honest labelling (`confidence`, `unverified`) is the good part. Not a trace-producing system.

## 9. Traps seen
Hard-coded plan numbers presented in a UI; rate from a single block; hourly proration assumes uniform burn.

## 10. Reuse
MIT: the P90 limit inference, official-overlay freshness and sanity checks, limit-event store may be reused with credit.

## 11. Verdict: ADAPT (ideas only)
Copy: (1) the `official` versus `local_estimate` confidence flag on every limit; (2) P90-of-limit-hit-sessions to infer an unknown cap, with the hit threshold at 95%; (3) store limit-hit events with their reset time as ground truth for calibrating forecasts.
Avoid: (1) hard-coded plan quotas as fact; (2) counting cache reads against a message-based limit; (3) a forecast with no interval.
