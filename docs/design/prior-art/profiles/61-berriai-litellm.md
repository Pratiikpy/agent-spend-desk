# Profile: BerriAI/litellm (gateway with the most complete spend and budget machinery)

Reader: Claude Sonnet, 2026-10-20. Licence read first: `LICENSE:1-4` says MIT except everything under `enterprise/` (separate commercial licence, `enterprise/LICENSE.md`); GitHub reports NOASSERTION. Stars 61,647; last commit read dd20bb0, 2026-10-20 13:01 UTC (gh api). Files read at HEAD on that date, no clone; line numbers are for that HEAD. Tests were not read.

## 1. What it is
A Python SDK plus a FastAPI proxy that fronts 100+ providers behind an OpenAI-compatible API, with virtual keys, teams, budgets and a Postgres spend ledger. For us it is the reference for "where the money is counted".

## 2. Architecture map
Request path: auth (`litellm/proxy/auth/auth_checks.py` `common_checks`, :1076) then budget reservation (`litellm/proxy/spend_tracking/budget_reservation.py` `reserve_budget_for_request`, :231), provider call, cost calculation (`litellm/cost_calculator.py`), then batched DB writes (`litellm/proxy/db/db_spend_update_writer.py` `update_database`, :501). Price book: `model_prices_and_context_window.json` (76,615 lines), with a bundled backup copy.

## 3. Features and how each behaves
Budgets exist at key, team, user, team-member, org, project, end-user, tag and model-access-group level (`schema.prisma` budget columns on those tables; shared `LiteLLM_BudgetTable`, :13-40, with `max_budget`, `soft_budget`, `budget_duration`, `budget_reset_at`, `model_max_budget`, `temp_budget_increase`). Soft budget only alerts (`auth_checks.py:1101` docstring item 3.0.3, "alert only"; `_team_soft_budget_check`, :1416). Hard budget raises `BudgetExceededError`. A per-session dollar cap with 429 exists for agents (`hooks/max_budget_per_session_limiter.py:1-14`).

## 4. How people use it
Run the proxy on Postgres, mint a key with `max_budget`. Usage evidence outside the repo: NOT VERIFIED.

## 5. Mechanism for the Desk
Where money is counted, in three layers.
- Ledger: one row per request in `LiteLLM_SpendLogs` (`schema.prisma:720-763`: `spend`, `prompt_tokens`, `completion_tokens`, `model`, `custom_llm_provider`, `team_id`, `end_user`, `request_tags`, `session_id`, `status`, `cache_hit`, `litellm_call_id`). Daily rollups per user, team, org, end user, agent, tag and global (`:865-1105`), each carrying `cache_read_input_tokens`, `cache_creation_input_tokens` and four savings columns: `compression_savings_spend`, `prompt_caching_savings_spend`, `gateway_injected_caching_savings_spend`, `autorouter_savings_spend` (`:880-884`). Success and failure counts are kept per day (`successful_requests`, `failed_requests`, `:886-887`).
- Counters: running totals on each owner row plus Redis counters (`proxy_server.py:3161` `get_current_spend`; fallback chain Redis, memory, DB reseed, caller value, :3179-3183). Stale-low counters are repaired from the DB floor (:3204-3230).
- Cost: `completion_cost` = list price times the provider-reported usage object (docstring `cost_calculator.py:1517-1526`). A provider-stated cost header overrides the computation unless custom pricing is set (:2251-2253); a response-cache hit costs 0 (:2242-2243); provider discounts and margins are config (:1269-1305). It raises if the model is not in the map (:1525). Cost is a list-price estimate from reported tokens, not an invoice. NOT VERIFIED that any reconciliation against provider invoices exists.

Enforcement point: before AND after. Before: `common_checks` runs all scopes concurrently and raises the first error (`auth_checks.py:1406-1464`); the user check is `spend >= max_budget` on already-posted spend (:1392), so a request can overshoot by its own cost. Newer atomic path: `reserve_budget_for_request` estimates the worst case, input tokens counted plus `max_tokens` (default 16,384, clamped to the model ceiling, `budget_reservation.py:1625-1647`) times the higher of output and reasoning rate (:1457-1462), times `n` (:1662-1668), and reserves it on every counter at once. If only part of the budget remains the reservation is resized down and the call is admitted (:193-207) unless strict mode is on. After the call the reservation is reconciled to actual cost (:333-355); a cancelled request settles at its input-token cost, not zero (:1314-1320). Reservations skip models with no cost (:282-286) and, by default, skip any counter that cannot be loaded (:914-921); only `fail_closed_budget_enforcement` returns 503 (:90-103). Models priced zero skip budget checks (`auth_checks.py:1351`, `is_model_cost_zero` :535); `block_requests_for_models_without_pricing` blocks unpriced models (:809-816).

Price freshness: the JSON is edited by pull request. A weekly cron opens a PR from a script (`.github/workflows/auto_update_price_and_context_window.yml:5`), but the script shown scrapes only Friendli (`.github/scripts/auto_update_price_and_context_window_file.py:27`); the rest is hand-maintained. 2,917 of 4,225 entries carry a `source` URL (my count of `mp.json`; e.g. `claude-sonnet-4-5`, JSON :15608-15641). Runtime fetches the live file and falls back to the bundled copy if it is empty, not a dict, under 50 models or under half the backup's count (`get_model_cost_map.py:127-177`, `constants.py:181-186`); `LITELLM_LOCAL_MODEL_COST_MAP=True` pins the bundle (`get_model_cost_map.py:4-8`). A CI guard checks JSON validity and that the backup matches (`ci_cd/cost_map_guard.py:1-9`).

Estimated versus billed: tokens are provider-reported (billed units), prices are list prices, reservations and savings are estimates. Savings columns use a baseline replay that labels each estimate `observed_identical` or `modeled` and refuses to estimate under concurrency or unsupported cache plans (`spend_tracking/baseline_accounting.py:26-38, 176-231`).

## 6. Agent patterns
Not an agent system; the per-session cap guards agent loops.

## 7. Model and data layer
OpenAI-compatible seam, router with fallbacks, Postgres via Prisma, optional Redis; spend writes are queued and flushed in batches (`db_spend_update_writer.py:1-6`).

## 8. Hackathon-care checks
Full budget path needs Postgres plus Redis; not a one-command demo. Keys are stored hashed (`schema.prisma:723`).

## 9. Traps seen
Fail-open defaults (counter unavailable, unpriced model, zero-cost model). Whole-request overshoot on the read-time path. Spend is attributed to who made the call, never to whether the work landed: no outcome field exists in `SpendLogs`. Price accuracy depends on volunteers.

## 10. Reuse
MIT outside `enterprise/`: the price JSON and code may be reused with credit. Our stack is TypeScript, so rebuild the mechanism; reuse the price data only with attribution and re-verify `source` per entry. Anything in `enterprise/`: mechanism only.

## 11. Verdict: ADAPT
Copy: (1) reserve-worst-case then reconcile-to-actual, with cancelled calls settling at input cost; (2) per-entry `source` URL and shrink-guarded fallback to a bundled price book; (3) provenance label (`observed` versus `modeled`) on every savings number.
Avoid: (1) silent fail-open on missing price or counter; (2) counting spend without an outcome column; (3) treating list price times reported tokens as the bill without saying so.
