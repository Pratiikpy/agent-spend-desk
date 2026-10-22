# Profile: getzep/graphiti

Reader: agy (Gemini, plan mode, file-reading tools only), 2026-10-16, about 8 minutes. Local clone. Paths are relative to the repository root or to `graphiti_core/`.

Spot-check (reviewer, against the code): the swallowed timestamp-extraction error at `edge_operations.py:830-832` (confirmed); the node-dedup candidate limit 15 and cosine minimum 0.6 at `node_operations.py:67-68` (confirmed); the bi-temporal fields `expired_at`, `valid_at`, `invalid_at`, `reference_time` at `edges.py:271-287` (confirmed); the `break` that keeps only the first duplicate at `edge_operations.py:1006-1008` (confirmed). Not rechecked: the saga summary caps and the transport details. Result: PASS; every checked line number was exact.

## 1. What it is
Graphiti is a Python framework for building and querying temporal context graphs for AI agents, tracking evolving facts with validity windows and episode provenance ([README.md:37-45]).
Licence: Apache 2.0 ([LICENSE:1-202], [pyproject.toml:11]). Last commit: NOT VERIFIED (shell commands prohibited).

## 2. Architecture map
- **Entry points**: `Graphiti` class ([graphiti_core/graphiti.py:207]), FastAPI service ([server/graph_service/main.py:1-40]), MCP server ([mcp_server/src/server.py:1-30]).
- **Modules**: Models ([graphiti_core/nodes.py:93], [edges.py:49]); Extraction & dedup ([utils/maintenance/node_operations.py:73], [edge_operations.py:134]); Retrieval ([search/search.py:98]); Drivers ([driver/driver.py:43]).
- **Data flow**: Ingest episode -> LLM extracts nodes -> Resolution via identity/cosine/LLM -> LLM extracts edges -> `uuid_map` rewiring -> Edge contradiction resolution -> Invalidation timestamping -> Cypher save ([graphiti_core/graphiti.py:1430-1530]).

## 3. Features and how each behaves
- `add_episode`: Takes `name`, `episode_body`, `reference_time`, `source=EpisodeType.message`, optional `entity_types`, `saga` ([graphiti_core/graphiti.py:1350-1397]). Returns `AddEpisodeResults` ([graphiti_core/graphiti.py:184-191]). Fails by recording trace exception and re-raising ([graphiti_core/graphiti.py:1581-1584]).
- `search`: Takes query, `group_ids`, config, filters; returns `SearchResults` ([graphiti_core/search/search.py:98-115]). Defaults to hybrid search (RRF/cross-encoder) ([graphiti_core/graphiti.py:75]). Reranker errors fall back or raise `SearchRerankerError` ([graphiti_core/search/search.py:28]).
- `summarize_saga`: Summarizes new episodes up to 20-episode cap and 128 KiB prompt budget ([graphiti_core/graphiti.py:136-137, 588-638]). Skips silently if no new episodes exist ([graphiti_core/graphiti.py:685]).

## 4. How people use it
- **Installation**: `pip install graphiti-core` or `uv add graphiti-core` with database extras (`[falkordb]`, `[neptune]`) ([README.md:181-228]).
- **Run path**: Requires Neo4j/FalkorDB (`docker compose up`) and `OPENAI_API_KEY` ([README.md:269-309]). Call `build_indices_and_constraints()`, then `add_episode()` ([graphiti_core/graphiti.py:803-835, 1350]).
- **Tests**: `make test` executes non-integration tests ([AGENTS.md:18-20]). External issue tracker and user feedback: NOT VERIFIED.

## 5. Mechanism for our module (M3 & M6)
- **M3 (Reconciliation & Entity Resolution)**:
  - Candidates fetched via identity attributes, exact names, and semantic cosine search (`score >= 0.6`, limit 15) ([utils/maintenance/node_operations.py:67-68, 456-484]).
  - Resolves deterministically on identity or exact normalized name first ([node_operations.py:840-870]), escalating remainder to LLM `dedupe_nodes.nodes` ([node_operations.py:650-814]).
  - State: `EntityNode` (`name`, `labels`, `attributes`, `name_embedding`, summary <= 3 sentences) ([nodes.py:253-263, 499-505]); pointers in `uuid_map` ([node_operations.py:836]).
  - Limits/Loss: Entities differing in alias under 0.6 similarity without identity properties are missed. Discarded node names are dropped on canonical merge ([node_operations.py:421-432]).
- **M6 (Memory & Validity Windows)**:
  - Facts represented as `EntityEdge` with bi-temporal fields: `valid_at`, `invalid_at`, `created_at`, `expired_at`, and `episodes` lineage ([edges.py:263-290]).
  - LLM `dedupe_edges.resolve_edge` outputs `duplicate_facts` and `contradicted_facts` ([edge_operations.py:981-1036]).
  - If `resolved_edge.valid_at > edge.valid_at`, candidate `edge.invalid_at = resolved_edge.valid_at` and `edge.expired_at = utc_now()` ([edge_operations.py:756-783]). If candidate starts later, resolved edge invalidates ([edge_operations.py:731-744]).
  - Limits/Loss: Contradiction detection relies entirely on LLM index output; missing `valid_at` dates bypass temporal rules.

## 6. Agent patterns
- **Roles**: Dedicated prompts for node/edge extraction, deduplication, timestamping, and saga summarization ([graphiti_core/prompts/lib.py:28-35]).
- **Critic / Fallbacks**: Deterministic matching precedes LLM resolution ([node_operations.py:840-872]). Invalid LLM candidate IDs log warnings and treat nodes as new without crashing ([node_operations.py:778-809]).
- **Shared state**: Partitioned by `group_id` with request-scoped driver resolution ([graphiti_core/graphiti.py:1428]).

## 7. Model and data layer
- **Models**: Pluggable `LLMClient` (OpenAI, Anthropic, Gemini, Groq) ([graphiti_core/llm_client/client.py:25]), `EmbedderClient` (OpenAI, VoyageAI, SentenceTransformers) ([embedder/client.py:22]), and `CrossEncoderClient` (BGE, OpenAI) ([cross_encoder/client.py:22]).
- **Data backends**: Pluggable `GraphDriver` ([driver/driver.py:43]) supporting Neo4j, FalkorDB, and Neptune.

## 8. Hackathon-care checks
- **Tracing/Logging**: OpenTelemetry spans (`add_episode`, search phases) ([graphiti_core/tracer.py:25]); PostHog telemetry active unless `GRAPHITI_TELEMETRY_ENABLED=false` ([graphiti_core/graphiti.py:84], [AGENTS.md:46]).
- **Sample/Offline**: Tests use mock embedders and deterministic vectors ([tests/helpers_test.py:132-150]). Requires running database for non-mock tests ([AGENTS.md:48-56]).
- **Docker**: Neo4j/FalkorDB via `docker compose up` ([README.md:290-309]).
- **Evals**: Paper cited ([arXiv:2501.13956](https://arxiv.org/abs/2501.13956), [README.md:19]); benchmark test scripts present in repo: NOT VERIFIED.
- **Security**: Raw text passed directly into prompts without sanitization ([node_operations.py:124]). Labels sanitized against Cypher injection ([nodes.py:102-106]).

## 9. Traps seen
- Silent timestamp failure: `except Exception: logger.warning(...)` in `_extract_edge_timestamps` swallows errors, leaving timestamps null ([edge_operations.py:830-832]).
- FalkorDB driver drops connections under concurrent queries in `asyncio.gather` ([AGENTS.md:68-70]).
- Duplicate fact loop takes only the first duplicate (`break`), discarding subsequent indices ([edge_operations.py:1006-1008]).
- Pre-existing mock embedder bug breaking `tests/test_add_triplet.py` ([AGENTS.md:50-52]).
- Deprecated unmaintained Kuzu driver retained ([pyproject.toml:31-32]).

## 10. Reuse
- **Licence class**: Apache-2.0 ([LICENSE:1-202]). Permissive commercial reuse.
- **What may be copied with credit**: Bi-temporal edge model schema ([edges.py:263-290]), DNF date filter constructors ([search/search_filters.py:27-74]), RRF hybrid search ([search/search_utils.py:65]), and continuous-indexing candidate prompts. Must retain copyright/notice ([LICENSE:100-117]).

## 11. Verdict
- **Verdict**: Adapt for Plumbline M3 and M6.
- **Three things to copy**:
  1. Bi-temporal fact model (`created_at`/`expired_at` assertion vs `valid_at`/`invalid_at` event time) ([edges.py:271-287]).
  2. Multi-tier candidate retrieval combining identity properties, exact names, and semantic similarity ([node_operations.py:456-484]).
  3. Continuous offset indexing in prompt contexts for simultaneous duplicate and contradiction detection ([edge_operations.py:955-980]).
- **Three things to avoid**:
  1. Silent failure swallowing in timestamp extraction leaving validity windows null ([edge_operations.py:830-832]).
  2. Dropping alias history when deduplicating nodes ([node_operations.py:421-432]).
  3. Direct injection of untrusted episode text into prompt contexts without injection guards ([node_operations.py:124]).
