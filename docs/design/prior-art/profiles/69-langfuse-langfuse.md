# Profile: langfuse/langfuse

Reader: Claude Sonnet, 2026-10-20. Remote read through `gh api` and raw file fetches, no clone. Licence read first: `LICENSE:1-6` says copyright ClickHouse, Inc., everything outside `ee/`, `web/src/ee/`, `worker/src/ee/` is MIT Expat, the `ee/` folders sit under a separate licence (`ee/LICENSE`). GitHub reports "NOASSERTION", 36,085 stars, last commit read 2026-10-20T13:21Z (checked 2026-10-20). Rule for the Desk: MIT parts may be reused with credit; anything in `ee/` (cloud usage metering, usage thresholds, ingestion masking, spend alerts UI) is mechanism-only.

## 1. What it is
An open-source LLM observability platform: traces, observations, scores, prompts, datasets, evaluators and monitors, on Postgres plus ClickHouse plus Redis queues. Line numbers below are from the fetched files, all at HEAD on 2026-10-20.

## 2. Architecture map
Web app and worker share `packages/shared`. Ingestion has two doors: the native batch API (`packages/shared/src/server/ingestion/processEventBatch.ts`) and OTLP (`packages/shared/src/server/otel/OtelIngestionProcessor.ts`, 4,223 lines). The worker `worker/src/services/IngestionService/index.ts` (2,231 lines) merges events into ClickHouse rows. Tables: `observations` (`packages/shared/clickhouse/migrations/canonical/0002_observations.up.sql:1-46`) and `scores` (`0003_scores.up.sql:1-33`), both ReplacingMergeTree keyed on `event_ts` with an `is_deleted` flag (0002:35, 0003:22), so a late event overwrites an earlier row by id.

## 3. Features and how each behaves
Observation types, nested by `parent_observation_id` (0002:6). Cost lives on the observation: `provided_usage_details`, `usage_details`, `provided_cost_details`, `cost_details` (maps of bucket name to number) and `total_cost` Decimal64(12) (0002:19-23). Monitors (alerts) evaluate a metric over a window, `packages/shared/src/features/monitors/types.ts:260-272`, with warning and alert thresholds, no-data mode and renotify. The metric catalogue includes `totalCost` and `totalTokens` (`features/query/dataModel.ts:132-143`) over views traces, observations and numeric, categorical, boolean scores (`features/query/types.ts:124-132`).

## 4. How people use it
SDKs and OTel exporters send spans; the UI shows trace trees, cost per trace and model, score dashboards. Usage evidence beyond the repository: NOT VERIFIED.


## 5. Mechanism for the Desk
Cost ladder, in order (`IngestionService/index.ts:1781-1859`):
1. If any cost value is provided, nothing is computed. The provided map is kept, and `total` is the provided total, or input plus output only when those are the only keys (1798-1820).
2. Otherwise each usage bucket is multiplied by the matched model's price for that bucket name (`price.mul(units)`, 1824-1836); a 1h or 5m cache-write bucket falls back to an aggregate price (1827-1831). Total is the sum unless a `total` price exists (1840-1853).
3. A bucket with no price adds nothing. NOT VERIFIED whether the UI flags this.

Tokenising is guarded (1563-1582): no estimate when usage or cost was provided, when the call errored, or for gateway generations. The comment states the reason: tokenising a failed call "fabricates usage and cost". Copy this stance.

Model match (`packages/shared/src/server/ingestion/modelMatch.ts:272-300`): a Postgres regex `model ~ match_pattern`, project rows before global rows (`ORDER BY project_id ASC`, Postgres sorts NULL last), then newest `start_date`. Tiered pricing (`pricing-tiers/matcher.ts:101-115`): tiers sorted by priority, all conditions AND-ed, conditions on summed usage keys by regex or on model parameters and metadata, first match wins, default tier last. A bad regex fails the condition, not the ingest (70-72).

OTLP mapping (`OtelIngestionProcessor.ts`): model from `langfuse.observation.model.name`, `gen_ai.response.model`, `ai.model.id`, `gen_ai.request.model`, `llm.response.model`, `llm.model_name` in that order (3004-3015). Usage keys are normalised into disjoint buckets: input is reduced by cache read and cache creation, output by reasoning and audio (3325-3416, 3235-3249). Cost is read from `langfuse.observation.cost_details`, then `gen_ai.usage.cost`, then `llm.cost.total` (3441-3463). Spans named `invoke_agent` or `agent_step` skip model, usage and cost to avoid double counting (2979-3002).

Scores (`packages/shared/src/domain/scores.ts`): source API, EVAL or ANNOTATION (4-9); data types NUMERIC, CATEGORICAL, BOOLEAN, CORRECTION, TEXT (46-61); attached to trace, observation, session or dataset run (109-122); annotation scores require a config id (30-40).

Monitor lifecycle: severity OK, WARNING, ALERT, NO_DATA, UNKNOWN, PAUSED; null value maps by no-data mode (`computeSeverity.ts:19-34`); first evaluation from UNKNOWN fires only if unhealthy (`applyStateMachine.ts:74-80`); PAUSED is never overwritten by the worker (20-35).

What it does not do: cost is never tied to a result. A score sits beside a trace, but no query turns "dollars on traces that were later accepted" into a bill line. No caps that stop a run, no owner-task canary, no replay on another route priced against what passed. Whether a cost-change monitor shows a baseline comparison: NOT VERIFIED.

## 6. Agent patterns
Not an agent system. LLM-as-judge evaluators run against traces; details NOT VERIFIED.


## 7. Model and data layer
Prices are rows in Postgres (`modelMatch.ts:278-291`), seeded by migrations and audited by `.github/workflows/model-price-audit.yml`. Cost is computed in the ingest path (`IngestionService/index.ts:1516-1533`) and stored on the row. NOT VERIFIED whether a price correction reprices old rows.


## 8. Hackathon-care checks
Heavy self-host stack (Postgres, ClickHouse, Redis, S3), not a model for a one-command judge run. Monitor tests exist (`applyStateMachine.test.ts`, `computeSeverity.test.ts`); pricing-tier tests NOT VERIFIED.


## 9. Traps seen
Provided cost silently wins over computed cost, so a wrong client number is trusted. Bucket-keyed cost leaves a new provider bucket unpriced until someone adds it.


## 10. Reuse
MIT outside `ee/`. Copy with credit: the OTLP attribute fallback order, bucket disjointing, the pricing-tier condition language. Rebuild from the idea: anything in `ee/`.

## 11. Verdict: ADAPT
Copy: (1) provided-versus-computed cost kept side by side, with a recorded source per number; (2) disjoint usage buckets after subtracting cache and reasoning; (3) the monitor state machine with a no-data mode and a paused state nobody overwrites.
Avoid: (1) letting provided cost silently override with no flag; (2) pricing once at ingest with no reprice path; (3) fall-through to a total-only price that hides which bucket was unpriced.
