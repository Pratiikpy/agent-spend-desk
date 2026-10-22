# Profile: topoteretes/cognee

Reader: agy (Gemini, plan mode, file-reading tools only), 2026-10-16, about 7 minutes. Local clone. Citations are the reader's; the entity-consolidation file lives at `cognee/memify_pipelines/consolidate_entities.py`.

Spot-check (reviewer, against the code): consolidation defaults similarity threshold 0.85 and `top_k` 10 (`consolidate_entities.py:26-30`, confirmed); deterministic node ids via `uuid5` from identity fields (`DataPoint.py:4,41`, confirmed); a feedback `alpha` parameter in the weight update (`apply_feedback_weights.py:23`, confirmed); the retriever stubs with `# TODO` at `cypher_search_retriever.py:88,113` (confirmed); `CORS_ALLOWED_ORIGINS` defaulting to `*` in `docker-compose.yml:39` (confirmed); licence Apache 2.0 (confirmed). The weight-update formula and the nine-stage `improve` list were taken from the reader and not recomputed. Result: PASS.

## 1. What it is
Cognee is an open-source AI memory platform that converts unstructured text, code, and conversations into a hybrid knowledge graph and vector index for persistent agent memory ([README.md:8-9, 42-43], [pyproject.toml:5]).
Licence: Apache-2.0 ([LICENSE:1-202], [pyproject.toml:12]).
Last commit: NOT VERIFIED.

## 2. Architecture map
- Modules: Core memory APIs ([`cognee/__init__.py`]), task execution pipelines ([`cognee/modules/pipelines/operations/pipeline.py`]), multi-database engines ([`cognee/infrastructure/databases/`]), background improve loop ([`cognee/modules/improve/registry.py`]), memify task registry ([`cognee/memify_pipelines/memify_task_registry.py:23-52`]), and retrieval query router ([`cognee/api/v1/recall/recall.py:647-669`]).
- Data flow: Ingestion -> document chunking and triplet extraction (`cognify`) -> [`add_data_points`] writes graph edges and indexes vector fields -> `improve` / `memify` consolidate duplicate entities and adjust feedback weights -> [`recall`] queries across session cache, graph, and vector stores.
- Entry points: Python SDK (`remember`, `recall`, `improve`, `add`, `cognify`, `search`, `memify`) ([`cognee/__init__.py:40-90`]), CLI `cognee-cli` ([`cognee/cli/`]), and FastAPI server ([`cognee/api/client.py`]).

## 3. Features and how each behaves
- `remember()`: Stores text, files, or typed entries (`QAEntry`, `TraceEntry`). With `session_id`, writes immediately to session cache and triggers background `improve()` ([`cognee-improve-sessions/SKILL.md:22-26, 109-112`]). Without session, runs foreground `add` -> `cognify` -> `improve()`. Non-fatal on improve failures.
- `recall()`: Scopes searches across `session`, `graph`, `tools`, and `code`. Auto-routes quoted queries to `CHUNKS_LEXICAL`, rules to `CODING_RULES`, and defaults to `HYBRID_COMPLETION` ([`cognee/api/v1/recall/recall.py:653-668`]). If routed lexical or rules queries return empty, it retries once as `HYBRID_COMPLETION` ([`cognee/api/v1/recall/recall.py:821-846`]).
- `improve()`: Executes 9 ordered stages (`feedback_weights`, `persist_session_qa`, `persist_agent_traces`, `extract_agent_context`, `distill_sessions`, `update_user_preferences`, `build_truth_subspace`, `triplet_enrichment`, `global_context_index`) ([`cognee-improve-sessions/SKILL.md:57-68`]). Only stage 2 (`persist_session_qa`) is fatal; stage errors leave earlier writes intact. Concurrent calls skip via per-dataset lock (`lock_held`) ([`cognee-improve-sessions/SKILL.md:143-149`]).
- `memify()`: Runs extraction and enrichment tasks on existing graph subgraphs without re-ingesting raw text ([`cognee/memify_pipelines/memify_task_registry.py:23-52`]).

## 4. How people use it
- Install: `pip install "cognee[gliner]"` ([README.md:91]).
- First-run: Operates CPU-local embeddings (`fastembed`) and GLiNER extraction without an LLM key ([README.md:44-45, 96-97, 107-111]).
- Setups: Embedded SQLite + LanceDB + Ladybug (default), or Postgres + PGVector + Neo4j via environment variables ([docker-compose.yml:29-37]).
- Tests: Pytest unit and integration suites under `cognee/tests/` ([AGENTS.md:154-159]). External user feedback: NOT VERIFIED.

## 5. Mechanism for our module
- Ingestion deduplication (M3): [`DataPoint`] derives deterministic IDs via `uuid5(NAMESPACE_OID, f"{cls.__name__}:{joined_normalized_values}")` using `_normalize_identity_value` ([`DataPoint.py:189-220`]). Subclasses without `identity_fields` receive random UUID4s, breaking deduplication ([`DataPoint.py:58-64`]).
- Entity resolution (M3): [`detect_entity_duplicates`] normalizes entity embeddings, scans cosine similarity in blocks of 512 with `top_k=10` ([`consolidate_entities.py:79, 96-132`]), and clusters via union-find using threshold 0.85 and exact normalized name matching ([`consolidate_entities.py:41-57, 134-193`]).
- Merge logic (M3): [`_pick_canonical`] selects highest graph degree, breaking ties by oldest `created_at` ([`consolidate_entities.py:321-328`]). [`merge_entity_duplicates`] repoints edges via `add_edges` ([`consolidate_entities.py:277-300, 518`]), unions descriptions and `belongs_to_set` dataset tags via `add_nodes` ([`consolidate_entities.py:372-386, 526-534`]), and deletes duplicate nodes and vector entries ([`consolidate_entities.py:538-543`]).
- Memory feedback weighting (M6): Streaming weight update formula: $w_{new} = \text{clip}(w_{prev} + \alpha \cdot (\text{rating} - w_{prev}), 0.0, 1.0)$ rounded to 4 decimals, with ratings mapped from 1..5 to 0..1 via $(score - 1) / 4$ ([`apply_feedback_weights.py:69-85`]). Implicit feedback applies $\alpha_{implicit} = 0.5 \cdot \alpha$ ([`feedback_weights_constants.py:37`]), with a 3-attempt maximum ([`feedback_weights_constants.py:33`]).
- Graph pipelines: Chains `Task` callables, managing `data_per_batch` concurrency and consumer `batch_size` ([`cognee-custom-pipelines/SKILL.md:92-100`]).
- Limits & data lost: Deduplicated nodes are deleted; original duplicate IDs and per-node granular histories collapse into concatenated descriptions and a single log report ([`consolidate_entities.py:331-339, 486-504`]).

## 6. Agent patterns
- Roles: Distinct entries for turn Q&A (`QAEntry`), tool steps (`TraceEntry`), and evaluations (`FeedbackEntry`) ([`cognee/__init__.py:90`]).
- Critic loops: `AUTO_FEEDBACK` executes an LLM turn-evaluator to score implicit user feedback ([AGENTS.md:105-108]).
- Fallbacks: Router retries with `HYBRID_COMPLETION` if specialized retrievers return empty or fail ([`cognee/api/v1/recall/recall.py:821-846`]).
- Confidence branching: Absent; similarity grouping relies on fixed thresholds (0.85) without probabilistic confidence intervals ([`consolidate_entities.py:44`]).
- Shared state: Session cache partitioned by user and session ID, serialized via process locks ([`cognee-improve-sessions/SKILL.md:143-149`]).

## 7. Model and data layer
- Models: LiteLLM provider ([pyproject.toml:45]) supporting OpenAI, Anthropic, Gemini, Azure, Bedrock, and Ollama (`LLM_PROVIDER`) ([`cognee-integrations/SKILL.md:15-25`]). Embeddings configure independently via `EMBEDDING_PROVIDER` with local `fastembed` fallback ([`cognee-integrations/SKILL.md:26-29`], [pyproject.toml:78-85]).
- Data sources: Relational (`sqlite`, `postgres`), Vector (`lancedb`, `pgvector`, `neptune_analytics`, `turso`), Graph (`ladybug`, `neo4j`, `neptune`, `postgres`) ([`cognee-integrations/SKILL.md:31-45`]).

## 8. Hackathon-care checks
- Trace and log format: Structlog with rotating file handlers (`COGNEE_LOG_MAX_BYTES=50MB`, 5 backups) ([`logging_utils.py:138-140, 206`]). OpenTelemetry spans instrument query execution ([`recall.py:27-28, 670-672`]).
- Offline mode: Operates offline via `gliner` and `fastembed` without external network dependencies ([README.md:44-45, 96-97]).
- Docker run: `docker-compose.yml` provides multi-profile one-command setup (`docker compose up`) ([docker-compose.yml:1-60]).
- Evals: Research paper on arXiv:2505.24478 ([README.md:65]); automated test benchmarks: NOT VERIFIED.
- Security: Insecure defaults include `CORS_ALLOWED_ORIGINS=*` ([docker-compose.yml:38-39]), hardcoded default password ([docker-compose.yml:48]), and unrestricted raw Cypher query execution enabled by default ([`retrieval/README.md:28`], [`cypher_search_retriever.py:64`]).
- Demo path: Script `quickstart.py` ([README.md:100-124]) and CLI UI `cognee-cli -ui` ([AGENTS.md:55]).

## 9. Traps seen
- Stubs returning `None`: [`CypherSearchRetriever.get_context_from_objects`] and [`get_completion_from_context`] contain `# TODO` and return `None` ([`cypher_search_retriever.py:88-90, 113-114`]).
- Silent indexing failure: Subclasses using `Annotated[str, Embeddable()]` update class defaults but leave instance `index_fields` empty, silently bypassing vector indexing ([`DataPoint.py:247-250`], [`cognee-custom-graph-models/SKILL.md:70-79`]).
- Silent duplication: Models omitting explicit `identity_fields` silently generate random UUID4s, creating duplicate nodes on every ingestion ([`DataPoint.py:58-64`]).
- Silent exception absorption: [`_build_canonical_entity`] catches broad `Exception`, returning `None` and silently dropping property and scoping tag merges ([`consolidate_entities.py:426-434`]).

## 10. Reuse
- Licence: Apache-2.0 ([LICENSE:1-202]). Permissive commercial use with attribution and change notices ([LICENSE:66-71, 93-105]).
- Safe to copy:
  1. Deterministic class-namespaced entity ID hashing ([`DataPoint.id_for`]).
  2. Memory-bounded block-wise cosine similarity clustering ([`_iter_topk_similar_pairs`]).
  3. Streaming feedback weight formula ([`stream_update_weight`]).

## 11. Verdict
- Verdict: Adapt. Adopt deterministic UUID5 entity resolution and edge repointing; adapt streaming feedback weights for Plumbline's policy precedent memory; reject non-atomic multi-database writes.
- Three things to copy:
  1. Class-namespaced UUID5 identity derivation (`uuid5(NAMESPACE_OID, f"{cls}:{values}")`) ([`DataPoint.py:203-220`]).
  2. Chunked matrix multiplication for similarity detection to prevent $O(N^2)$ memory spikes ([`consolidate_entities.py:96-132`]).
  3. Directed edge repointing and dataset tag unioning during entity consolidation ([`consolidate_entities.py:277-300, 372-386`]).
- Three things to avoid:
  1. Stubbed retriever methods returning `None` ([`cypher_search_retriever.py:88-90, 113-114`]).
  2. Insecure defaults (`*` CORS, default passwords, unrestricted Cypher execution) ([docker-compose.yml:38-48], [`retrieval/README.md:28`]).
  3. Uncoordinated multi-database writes without two-phase commit across graph, vector, and relational stores ([`add_data_points.py:168-190`], [`consolidate_entities.py:518-543`]).
