# Profile: comet-ml/opik

Reader: Claude Sonnet, 2026-10-20. Remote read through `gh api` and raw fetches, no clone. Licence read first: Apache 2.0 (`LICENSE:1-3` shows "Copyright (c) Comet ML, Inc" and the Apache text; GitHub SPDX Apache-2.0). 22,771 stars, last commit read 2026-10-20T13:23Z (checked 2026-10-20). Apache: may reuse with credit. Paths are under `apps/opik-backend/src/main/java/com/comet/opik/` unless stated.

## 1. What it is
LLM observability and evaluation from Comet: traces and spans, feedback scores, datasets and experiments, online scoring rules, a Java (Dropwizard) backend on ClickHouse plus MySQL plus Redis streams, and SDKs.

## 2. Architecture map
Ingest via REST or OTLP (`api/resources/v1/priv/OpenTelemetryResource.java`, `domain/OpenTelemetryMapper.java`, 570 lines). Cost is computed in-process from a static price table loaded at class load (`domain/cost/CostService.java:35-62`), file `model_prices_and_context_window.json` (line 42) plus Opik overrides (line 43), synced daily from LiteLLM per the comment at line 330. Online scoring is event driven: trace-created events reach `OnlineScoringSampler`, which applies rules and enqueues work on Redis streams per evaluator type (`api/resources/v1/events/OnlineScoringSampler.java:56-61`).

## 3. Features and how each behaves
Spans carry `type` (unknown, general, tool, llm) and `usage Map(String, Int32)` (`liquibase/db-app-analytics/migrations/000001_init_script.sql:14,21`, under `apps/opik-backend/src/main/resources/`). Later migrations add `total_estimated_cost` Decimal128(12) (`000013_update_total_estimated_cost_precision.sql:4-5`), model, environment, duration and time to first token. Feedback scores are a separate table (`000001:44-58`): entity span or trace, `name`, `category_name`, `value Decimal32(4)`, `reason`, `source` enum sdk or ui. Later migrations add authored scores and thread scope (names only; contents NOT VERIFIED).

## 4. How people use it
Install the SDK, wrap calls, read traces and scores; define a rule (LLM judge or Python metric, trace or thread level) with a sampling rate and filters. Usage evidence beyond the repository: NOT VERIFIED.


## 5. Mechanism for the Desk
Pricing is the best-engineered part of the four repos.

Lookup (`CostService.java:114-170`): resolve provider, then walk a provider lookup order; per provider try exact key, then lowercase with dots to hyphens (261-263), then strip a date suffix whether `-2025-12-17` or `-20251217` (52, 279-281), then strip a Bedrock `:N` pin (293-295); finally retry under the provider named in an `openai/gpt-4o` style prefix (152-165). The comments cite the issue numbers that forced each rule (#4114, #5018, #5621, #5130), and one comment (47-51) records the failure that taught it: unmatched names "silently fell through to a zero cost".

Pricing by provider format (`SpanCostCalculator.java`): the usage record is read in the provider's own shape, then each bucket gets its own rate. Anthropic: input, cache read, 5m write, 1h write, output, with cache prices falling back to the input price when absent (34-47). OpenAI: audio and reasoning are subsets of prompt and completion, split out only when the model has a distinct rate, text clamped at zero (74-103). Gemini caps cached tokens at prompt tokens (65). Unreadable shapes are priced on prompt and completion totals (105-111). Tier basis comes from prompt size (35, 51, 62, 75).

Fallback and failure (`CostService.java:67-87, 297-307`): if the estimate is zero, read `metadata.cost.total_cost` when `currency` equals "USD" (otherwise zero); any exception returns zero and logs. A counter `opik.cost.usage.warnings` records usage that was priced although it disagreed with its provider's format (37-40, 80-81).

Budget cap (`api/resources/v1/events/BudgetGuard.java`): per evaluation, the judge's own spend is added after each call; `shouldWrapUp()` turns true at the limit (114-117). The class says it is "a soft wrap-up trigger, not a hard ceiling" (18-21), fails open to unlimited if the model cannot be resolved (73-80), and an unpriced model makes the cap ineffective, with one warning per guard (98-107). It guards Opik's own scorer, never the owner's agent.

Sampler: every decision is counted as sampled, skipped_disabled, skipped_filter or skipped_sampling (`OnlineScoringSampler.java:71-75, 103-107`). The Desk should copy that funnel for its own canary: a run that was skipped must be visible.

OTLP (`OpenTelemetryMapper.java`): deprecated `gen_ai.system` stays authoritative over `gen_ai.provider.name` so attribute order cannot decide (208-221); `invoke_agent` spans are forced to type general, not llm (298-300); `total_tokens` is added when only prompt and completion exist (320-328). The int32 `usage` map: a single span above about 2.1 billion tokens would overflow; unlikely, NOT VERIFIED whether later migrations widened it.

What it does not do: no outcome field on the bill, no per-owner task set run on a schedule against the owner's real agent, no route-swap replay priced against a pass rate. Cost is estimation (the column is named `total_estimated_cost`), and there is no reconciliation against a provider invoice. Scores are 4-decimal numbers with a free text reason; there is no link from score to dollars.

## 6. Agent patterns
The judge scorer runs a tool-call loop under `BudgetGuard` (`BudgetGuard.java:13-36`). Single judge, no critic or revise step.


## 7. Model and data layer
LiteLLM-derived JSON price table, immutable in memory after class load. Per-workspace price override: NOT VERIFIED.


## 8. Hackathon-care checks
Heavy stack (ClickHouse, MySQL, Redis, Java). `BudgetGuardTest.java` exists. Metrics use OpenTelemetry counters.


## 9. Traps seen
Zero cost on an unmatched name; a dead budget on an unmatched model; metadata cost accepted only in USD, other currencies drop to zero without a flag; `Decimal32(4)` scores.


## 10. Reuse
Apache 2.0. May copy with credit: the name normalisation steps, per-provider bucket formulas, the sampling funnel counter.

## 11. Verdict: ADAPT (best source for pricing rules)
Copy: (1) the name-normalisation ladder with a regression test per issue; (2) per-provider usage formulas with subset handling (audio, reasoning, cache); (3) the counted sampling decisions.
Avoid: (1) returning zero for an unpriced span instead of marking it unpriced; (2) a budget that fails open without surfacing; (3) accepting a cost only in USD metadata with no currency conversion note.
