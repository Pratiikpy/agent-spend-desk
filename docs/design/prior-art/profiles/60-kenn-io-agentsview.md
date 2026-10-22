# Profile: kenn-io/agentsview

Reader: Claude Sonnet, 2026-10-20. Licence read first: MIT, Copyright 2026 Kenn Software LLC (`LICENSE:1-3`). Stars 6,220; created 2026-02-19; last push 2026-10-20 13:10 UTC. Releases v0.40.0 (2026-08-03), v0.41.0 (08-17), v0.42.0 (09-01), v0.43.0 (09-14), v0.44.0 (09-21), v0.45.0 (10-09): roughly one minor release every two weeks. Go with embedded web UI, SQLite, optional Postgres, DuckDB and ClickHouse mirrors.

## 1. What it is
A local archive of sessions from 20+ coding agents in one SQLite database, with search, cost reports, an activity dashboard, per-session health scores, tool-failure signals and exports. The closest existing product to the Desk's data model.

## 2. Architecture map
`internal/parser/*` (one parser per agent, about 50 agents), `internal/sync` (file watcher, incremental parse), `internal/db` (schema, pricing, analytics), `internal/usagefacts` (unpriced normalisation), `internal/signals` (outcome, health, tool health), `internal/friction`, `internal/money` (decimal), `internal/pricing`, `internal/artifact` (export), `cmd/agentsview`.

## 3. Features and failure behaviour
`agentsview usage daily`, a one-line today spend, a usage dashboard with a cost-attribution treemap, an Activity view (cost attributed to time ranges and concurrent agent work). Sessions with no token metadata still appear but are left out of totals, and the report says how many were left out (`docs/token-usage.md`, Codex Cloud paragraph). Unpriced models stay unpriced unless custom pricing is added (`docs/token-usage.md`, Augure paragraph). Marked "Experimental" by the authors (`docs/token-usage.md:14-19`).

## 4. How people use it
Install, run; it watches log directories and ingests. Docs site under `docs/`. Tests alongside code. Issue evidence: NOT VERIFIED.

## 5. Mechanism for the Desk
Data model (`internal/db/schema.sql`):
- `sessions` (`:2-104`): id, project, machine, agent, entrypoint, session_kind, started/ended, message counts, `total_output_tokens`, `peak_context_tokens`, `is_automated`, parent session and relationship (subagents, forks), plus the quality columns `tool_failure_signal_count, tool_retry_count, edit_churn_count, consecutive_failure_max, outcome, outcome_confidence, ended_with_role, compaction_count, mid_task_compaction_count, context_pressure_max, health_score, health_grade, runaway_tool_loop_count, duplicate_prompt_count` and `termination_status`, `pr_links`, `git_branch`, `cwd`.
- `messages` (`:126-161`): ordinal, role, model, `token_usage` JSON, Claude message and request ids, `is_sidechain`, `is_compact_boundary`.
- `usage_events` (`:272-301`): per request, tokens by kind, `cost_microdollars`, `cost_status`, `cost_source`, `dedup_key` with a unique index on session, source, key.
- `tool_calls` (`:348-`) with `observed_outcome, observed_repeat, sequence_ending`; `tool_result_events` (`:393-`) with status and a content digest; `session_plan_usage` (`:303-`) with weekly and five-hour percent and credits.
Unpriced facts first (`internal/usagefacts/fact.go:1-80`): a `Fact` carries counts and `ReportedCostMicrodollars` but no price; pricing happens later, so a price correction re-costs history without re-parsing. `MaxPlausibleTokens = 2,000,000` bounds one request (`:17`). 1-hour cache writes tracked as a subset (`:44-52`).
Cost: recorded cost wins when the agent logged one, else catalog estimate from LiteLLM with OpenRouter underneath, embedded snapshot for offline, `--offline` flag (`docs/token-usage.md:430-443`). Whole-request bands: input plus cache write plus cache read strictly above a threshold selects the band; exactly 272,000 stays on the base rate (`docs/token-usage.md:411-420`). Money is exact decimal and microdollars (`internal/money/*`, `internal/friction/usd.go:1-60`, 28 digits, 96-bit coefficient).
Cost attribution (`internal/db/usage_cost_allocation.go:10-65`, `docs/activity.md:171-175`): when a session has an authoritative total, it is split across (date, project, agent, machine, model, provider) in proportion to catalog estimates, so parts sum to the reported total; the docs state these per-model figures are "estimated attributions, not provider-reported". This is the answer to "how do they attribute cost": allocate by weight, keep the sum exact.
Pricing provenance (`docs/token-usage.md:941-969`): every export has a `pricing` block listing, per reported model, `priced_model`, `matched_pattern`, each per-million rate, bands, and counts of requests that used base versus banded rates. This is the nearest thing to a cost receipt; a signed per-dollar receipt: NOT FOUND (I searched the tree for receipt, HTML export and gist and found none; the "HTML export" and "cost receipt" named in the brief are NOT VERIFIED).
Outcome (`internal/signals/outcome.go:30-90`): pure function of the session shape. Automated gives unknown; terminal `API Error:` text gives errored (unknown if under 10 minutes old); two messages ending with the assistant gives completed; under 3 messages unknown; ended on the user gives abandoned (confidence high from 10 messages); failure streak of 3 or more gives errored; ended on the assistant gives completed, low confidence if the text says "i'm unable to" and similar. No test, build or user acceptance is consulted.
Health score (`internal/signals/score.go:32-60, 111-192`): start at 100; subtract capped penalties: errored 30, abandoned 15, tool failure signals 3 each to 30, retries 5 each to 25, edit churn 4 each to 20, 3 consecutive failures 10, compactions 5 each to 15, mid-task compactions 8 each to 18, context pressure above 0.9 gives 10, small prompt-quality penalties; grades A 90, B 75, C 60, D 40, F below. A score is withheld when outcome is unknown with low confidence and no other basis (`:84-90`).
Tool failure (`internal/signals/toolhealth.go:66-110`): provider status wins (errored, cancelled, error, denied); else a precomputed verdict; else content heuristics for Bash (command not found, permission denied, tracebacks, exit status above 0) and "FAILED" for edits and writes.
Loses: outcome is guessed from message roles, so "completed" is a claim about the chat, not about the work; no budgets, caps or stop actions; no canary or replay; no per-dollar link from cost to outcome (cost and health sit in different tables); allocation is by catalog weight, not by cause.

## 6. Agent patterns
None. Subagent sessions are linked by parent and relationship columns, so sub-agent cost rolls up.

## 7. Model and data layer
Parser per agent behind a provider interface; `capabilities.go` declares what each agent exposes (tokens, tool results, cost). Pricing catalog in `model_pricing` plus `model_pricing_bands`.

## 8. Hackathon-care checks
Runs offline; embedded pricing; migrations; but large (4,000+ files) and the schema is wide. A judge can install a single binary. Sample-data mode: NOT VERIFIED.

## 9. Traps seen
Experimental cost; "completed" heuristics presented as an outcome; mirror stores multiply schema surface.

## 10. Reuse
MIT: schema ideas, unpriced-fact split, allocation routine, band rule, health-score penalties and tool-failure heuristics may be reused with credit.

## 11. Verdict: ADOPT the data model, REPLACE the outcome
Copy: (1) unpriced `Fact` rows plus a late pricing step with a stored provenance block; (2) proportional allocation of an authoritative total with exact decimals; (3) separate tables for usage events, tool calls and tool results, with a dedup key unique index.
Avoid: (1) outcome inferred from who spoke last; (2) one aggregate health number with fixed penalties and no calibration; (3) tolerating hidden gaps: always print the count of sessions excluded from totals.
