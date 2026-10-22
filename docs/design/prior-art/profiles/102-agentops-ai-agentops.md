# Profile: AgentOps-AI/agentops

Reader: agy (Gemini), 2026-10-20, for . Licence read first: MIT, Copyright (c) 2023 AgentOps-AI (`LICENSE:1-3`). Stars: 5,899; last push 2026-06-25T08:25:03Z (commit `f8e907b`, `gh api`). Read at HEAD without cloning.

## 1. What it is
A full-stack observability and monitoring platform for AI agents providing automatic telemetry capture, cost tracking, and execution waterfall visualizers. MIT licence (`LICENSE:1-3`).

## 2. Architecture map
Three-tier architecture:
1. Client SDK (`agentops/`): `Client` singleton (`client/client.py:38`), `TracingCore` OpenTelemetry manager (`sdk/core.py:151`), and dynamic import hooker (`instrumentation/__init__.py:137`).
2. Telemetry Ingest & Storage: OpenTelemetry Collector (`app/opentelemetry-collector/`) batching spans into ClickHouse table `otel_traces` (`app/api/agentops/api/models/traces.py:44`) plus Supabase/PostgreSQL for orgs, projects, and users (`app/api/agentops/api/db/supabase_client.py:1-30`).
3. Services & UI: FastAPI backend (`app/api/agentops/api/app.py:1-30`, NOT VERIFIED) and Next.js dashboard (`app/dashboard/app/(with-layout)/traces/_components/session-replay.tsx:33`).

## 3. Features and how each behaves
- Auto-instrumentation: Intercepts `builtins.__import__` to instrument LLM providers (OpenAI, Anthropic, Google GenAI) and frameworks (CrewAI, AutoGen/AG2, Agno, LangGraph, Smolagents) on import (`instrumentation/__init__.py:48-127, 137`).
- Root span management: `agentops.init()` starts an automatic root trace; context manager `TraceContext` exits with `StatusCode.OK` or `StatusCode.ERROR` on exception (`sdk/core.py:43-72`).
- Delivery defaults: Batch exporter queues 512 spans (`max_queue_size=512`), flushes every 1,000ms (`export_flush_interval=1000`), max wait 5,000ms (`sdk/core.py:83-85`).
- Failure behaviour: `fail_safe=True` suppresses telemetry exceptions so host agent execution never halts (`__init__.py:92, 163`).

## 4. How people use it
`pip install agentops` (`README.md:87`), invoke `agentops.init(api_key=...)` at start, and `agentops.end_session()` at termination (`README.md:100-106`). The client logs a dashboard URL to stdout: `Session Replay for {title} trace: {app_url}/sessions?trace_id={trace_id}` (`helpers/dashboard.py:53-54`). Unit tests mock `TracingCore` and `ApiClient` to bypass network pipelines (`tests/unit/test_session.py:9-48`).

## 5. Mechanism for the Desk
- **Agent Session Replay:** A misnomer. AgentOps does NOT capture memory dumps, agent internal variables, environment states, filesystem diffs, or seeds for deterministic re-execution (`sdk/core.py:36-72`). It is solely a read-only Gantt waterfall chart (`app/dashboard/app/(with-layout)/traces/_components/session-replay.tsx:1-42`) displaying captured inputs, completions, and span attributes.
- **Time-Travel:** Conceived as Time Travel Debugging (`ttd` table in Supabase) saving LLM branch snapshots (`ttd_id`, `branch_name`, `session_id`, `prompt`, `completion`) to fork executions (`app/supabase/migrations/20240802043420_add_ttd_table.sql:1-15`; `components/time-travel/BranchModal.tsx:64-71`). However, it was abandoned: the dashboard route now returns `<div>Time Travel was removed, sowwy :c</div>` (`app/dashboard/app/(with-layout)/timetravel/page.tsx:38`).
- **Cost Tracking per Session:** Spans extract `gen_ai.usage.prompt_tokens` and `gen_ai.usage.completion_tokens` (`traces.py:113-114`). Costs are computed via the downstream `tokencost` library: `costs.calculate_cost_by_tokens(tokens, model, direction)` (`app/api/agentops/api/models/span_metrics.py:277`).
- **What it loses:**
  1. *Omission of cached and reasoning tokens:* `span_metrics.py:245, 255` contain explicit `# TODO we need to incorporate cached tokens` and `# TODO we need to incorporate reasoning tokens`; prompt cost strictly prices `prompt_tokens` and completion cost strictly `completion_tokens`.
  2. *Silent zero cost on failure:* Any price lookup error or unlisted model silently returns `Decimal(0)` (`span_metrics.py:278-279`).
  3. *No live budget limits:* Spend is aggregated post-hoc in ClickHouse (`traces.py:146-173`); there are zero SDK-level spend caps, throttles, or circuit breakers.
  4. *Session/Trace semantic breakage:* In v4, legacy `Session.record()` and `Session.create_agent()` were gutted into silent no-ops (`legacy/__init__.py:51-57`).
- **What the Desk does better:** True spend gating (pre-execution quota checks and hard caps), audited billed tokens (accounting for prompt cache write/read tiers and reasoning tokens), and verifiable signed dossiers rather than passive post-hoc Gantt charts.

## 6. Agent patterns
Passive observer pattern. No internal agents or critic loops; attaches to external agent frameworks via OpenTelemetry semantic conventions (`SpanKind.AGENT`, `SpanKind.WORKFLOW`, `SpanKind.TOOL`, `semconv/` NOT VERIFIED) linked by `parent_span_id` (`traces.py:50`).

## 7. Model and data layer
Hooks LLM SDKs directly via monkey patching (`instrumentation/providers/`). Telemetry routes to an OTLP HTTP receiver (`sdk/core.py:81`), stored in ClickHouse (`otel_traces` table, `traces.py:44`) partitioned for analytical rollups.

## 8. Hackathon-care checks
- Standard OTLP HTTP JSON payload format (`sdk/core.py:81-82`).
- Self-hostable via Docker Compose (`docker compose -f compose.yaml -f opentelemetry-collector/compose.yaml up -d`, `app/README.md:4-5`).
- Offline tests use mock fixtures (`tests/unit/test_session.py:9-48`).
- API keys set via env `AGENTOPS_API_KEY` (`__init__.py:101-102`).

## 9. Traps seen
- Abandoned time travel left in production UI: `Time Travel was removed, sowwy :c` (`app/dashboard/app/(with-layout)/timetravel/page.tsx:38`).
- Silent no-op on `Session.record()` dropping legacy events without error (`legacy/__init__.py:55-57`).
- Silent fallback to `Decimal(0)` on cost exceptions (`span_metrics.py:278-279`).
- Cached and reasoning tokens ignored in cost logic (`span_metrics.py:245, 255`).

## 10. Reuse
MIT licence (`LICENSE:1-3`). May reuse OpenTelemetry semantic convention attribute definitions (`agentops/semconv/`) and ClickHouse SQL schema (`app/clickhouse/migrations/0000_init.sql`, NOT VERIFIED) with credit.

## 11. Verdict: ADAPT telemetry schemas, REJECT replay and cost engines
- **Adopt/Adapt:** ClickHouse span schema layout (`traces.py:44-70`), OpenTelemetry attribute mappings, and import-hooking pattern (`instrumentation/__init__.py:137`).
- **Avoid:**
  1. Labelling read-only trace visualizers as "Session Replay" without capturing state.
  2. Abandoning half-built time travel with user-facing apologies (`app/dashboard/app/(with-layout)/timetravel/page.tsx:38`).
  3. Cost formulas that silently zero out on missing models and ignore cache/reasoning tokens (`span_metrics.py:245-279`).
