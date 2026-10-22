# Profile: openlit/openlit

Reader: agy (Gemini), 2026-10-20. Remote reads via GitHub API and raw content, no clone. Paths relative to repo root; line numbers match raw files. Licence read first: Apache-2.0 (`LICENSE:1-188`). Stars 2,865; pushed_at 2026-10-20T12:01:25Z (default branch `main`).

## 1. What it is
Open-source OpenTelemetry-native LLM and AI agent observability, evaluation, and GPU monitoring platform (`README.md:19-21`). SDKs in Python and TypeScript auto-instrument frameworks, calculate token costs per trace, and stream OTel signals into ClickHouse with a Next.js console. Apache 2.0 (`LICENSE:1-188`).

## 2. Architecture map
- **SDKs**: Python (`sdk/python/src/openlit/__init__.py:185`) and TypeScript (`sdk/typescript/src/index.ts`) monkey-patch LLM providers (OpenAI, Anthropic, Bedrock, Ollama) and agent frameworks (CrewAI, LangChain, AutoGen).
- **Collector**: `src/otlp-receiver` ingests OTLP gRPC/HTTP (`docker-compose.yml:50-51`) and persists spans and metrics into ClickHouse (`src/otlp-receiver/internal/chschema/schema.go:62-70`, `assets/clickhouse-init.sh:13-50`).
- **GPU Collector**: Standalone Go binary (`opentelemetry-gpu-collector/cmd/collector/main.go`) gathers NVML, sysfs, and eBPF CUDA kernel events, emitting standard `hw.gpu.*` OTel metrics (`opentelemetry-gpu-collector/README.md:19-36`).
- **Console**: Next.js app (`src/client`) querying ClickHouse tables (`otel_traces`, `otel_metrics_gauge`) for cost rollups, GPU dashboards, and widget boards (`src/client/src/lib/platform/cost/summary.ts:23-32`).

## 3. Features and how each behaves
- **Pricing catalog**: `assets/pricing.json:1-10` holds list prices for 177+ chat models with `promptPrice`, `completionPrice`, `cacheReadPrice`, and `cacheCreationPrice` per 1K tokens. Default fetch hits `raw.githubusercontent.com/openlit/openlit/main/assets/pricing.json` with a 20s timeout (`sdk/python/src/openlit/__helpers.py:541-546`), returning `{}` on failure (`__helpers.py:553`).
- **Cost per trace**: Calculated at call end via `get_chat_model_cost` (`__helpers.py:399-467`), writing `gen_ai.usage.cost` on the span (`sdk/python/src/openlit/instrumentation/openai/utils.py:945`, `semcov/__init__.py:67`) and publishing `genai_cost` metrics (`__helpers.py:1114-1115`). Unknown models return 0 (`__helpers.py:439`).
- **Cache accounting**: Differentiates cache-exclusive providers (Anthropic, Bedrock) from cache-inclusive providers (OpenAI, Google, LangChain) via `promptTokensIncludeCache` (`src/client/src/lib/platform/pricing/chat-cost.ts:20-81`).
- **GPU telemetry**: Samples utilization, temperature, power, fan speed, memory, and eBPF CUDA kernel grid/block allocations (`opentelemetry-gpu-collector/README.md:25-36`).
- **Dashboards**: Prebuilt views for Costs (`dashboard/costs`), GPU telemetry (`dashboard/gpu`), LLM requests, and user-defined custom ClickHouse SQL widget boards (`src/client/src/lib/platform/manage-dashboard/widget-sql-bridge.ts`).

## 4. How people use it
Run `docker compose up -d` for ClickHouse and OpenLIT (`docker-compose.yml:1-63`). In Python: `pip install openlit`, then `import openlit; openlit.init()` before importing LLM SDKs (`README.md:100-115`, `sdk/python/src/openlit/__init__.py:185`). In CLI/Go: `cli/internal/coding/hook` attaches to Claude Code, Cursor, and OpenCode sessions. Tests verify cache pricing logic (`sdk/python/tests/test_cache_pricing.py:1-50`). Issue activity beyond git: NOT VERIFIED.

## 5. Mechanism for the Desk
- **Cache-aware billing formula**: Resolves provider disparity in prompt token reporting (`src/client/src/lib/platform/pricing/chat-cost.ts:20-81`, `sdk/python/src/openlit/__helpers.py:416-461`). When inclusive (OpenAI/LangChain), cached tokens are subtracted from billable input tokens before multiplying by `promptPrice`; when exclusive (Anthropic), cached tokens are billed separately and not subtracted (`__helpers.py:447-466`).
- **Span-level cost indexing**: Costs write to span attribute `gen_ai.usage.cost` (`semcov/__init__.py:67`). ClickHouse indexes map values with a Bloom filter (`assets/clickhouse-init.sh:41-42`), enabling aggregate queries (`SELECT sum(toFloat64OrZero(SpanAttributes['gen_ai.usage.cost']))`, `src/client/src/lib/platform/llm/cost.ts:35-45`).
- **SPAN_PRICING background cron**: Runs periodic backfills (`openlit_cron_log`) to calculate or recalculate USD cost on historical unpriced spans (`src/client/src/lib/platform/pricing/cron-analytics.ts:35-55`, `config.ts:13-19`).
- **Weaknesses**: Unmatched models silently resolve to $0 without warning (`__helpers.py:439`), skewing spend reporting; runtime fetches raw GitHub without local caching or pinning (`__helpers.py:541-546`); lacks proactive rate limits or circuit breakers.

## 6. Agent patterns
Framework instrumentors set `ContextVar` (`_current_agent_name`, `_current_agent_version`) so nested LLM spans inherit `gen_ai.agent.name` (`sdk/python/src/openlit/__helpers.py:46-59,1050-1061`). `compute_agent_version_hash` fingerprints prompts and tools (`__helpers.py:1300-1360`). The core acts as a passive telemetry harness, not an autonomous agent.

## 7. Model and data layer
Implements OTel GenAI semantic conventions (`gen_ai.*`) with OpenLIT vendor extensions (`sdk/python/src/openlit/semcov/__init__.py:1-75`). ClickHouse uses `MergeTree` partitioned daily by `toDate(Timestamp)` and ordered by `(ServiceName, SpanName, toDateTime(Timestamp))` (`assets/clickhouse-init.sh:45-47`).

## 8. Hackathon-care checks
Offline support in Go CLI via embedded pricing (`cli/internal/coding/pricing/pricing.go:4-9`) and Python via local `pricing_json` (`sdk/python/src/openlit/__helpers.py:528-530`). Single-command startup via `docker compose up -d` (`docker-compose.yml:1-63`). API keys and credentials handled via environment variables (`docker-compose.yml:40-44`).

## 9. Traps seen
- Missing model prices fall back to 0 without warning (`__helpers.py:439`), silently treating unknown models as free.
- Python SDK fetches list prices unauthenticated from GitHub at runtime (`__helpers.py:542`), failing in air-gapped environments unless `pricing_json` is manually specified.
- Passive-only telemetry: traces runaway loops but lacks spend caps or execution halts.

## 10. Reuse
Apache-2.0 allows copying pricing tables (`assets/pricing.json`), cache provider classification sets (`src/client/src/lib/platform/pricing/chat-cost.ts:21-51`), ClickHouse OTel schema DDL (`assets/clickhouse-init.sh:13-50`), and span attribute schemas with notice.

## 11. Verdict: ADOPT cache accounting and ClickHouse trace schema; ADAPT for proactive spend caps
- **Copy**:
  1. Provider cache-inclusion classification and subtraction arithmetic (`chat-cost.ts:56-81`, `__helpers.py:416-461`).
  2. ClickHouse `otel_traces` DDL with Bloom filters on `SpanAttributes` maps (`assets/clickhouse-init.sh:38-49`).
  3. `ContextVar` agent propagation (`openlit_agent_name`, `__helpers.py:46-59`) linking outer agent flows to downstream LLM costs.
- **Avoid**:
  1. Silent $0 default for unrecognized models (`__helpers.py:439`).
  2. Runtime dependency on raw GitHub URLs for pricing metadata (`__helpers.py:542-546`).
  3. Passive post-hoc spend tracking without real-time kill switches or spending caps.
