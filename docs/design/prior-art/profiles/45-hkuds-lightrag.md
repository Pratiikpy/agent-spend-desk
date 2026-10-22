# Profile: HKUDS/LightRAG

Reader: agy (Gemini CLI, plan mode), 2026-10-16, 411 seconds, 965 words. Local clone. Paths relative to the repository root.

Spot-check (reviewer, against the code): MIT licence (confirmed); default query mode `mix` and rerank on by default (from an environment variable defaulting to true) at `lightrag/base.py:93,166` (confirmed); an empty query returns a fixed `fail_response` string with `llm_generated=False` at `lightrag/operate.py:4735-4737` (confirmed); an entity type read back from storage that is empty becomes `"UNKNOWN"` at `operate.py:2464-2467` (confirmed); `RecoveryAnchorMissingError` and `IndexFlushError` exist in `lightrag/exceptions.py` (confirmed); the project's `AGENTS.md:56-66` states the rule for consistency without transactions (confirmed). Correction by the reviewer: the reader gave defaults `top_k=32` and `chunk_top_k=32`; the constants are `DEFAULT_TOP_K = 40` and `DEFAULT_CHUNK_TOP_K = 20` (`constants.py:57-58`). The dual-level retrieval line ranges and the cache-backed rebuild were not rechecked. Result: PASS with one wrong default fixed.

## 1. What it is
A graph-augmented retrieval framework with dual-level retrieval (specific entities and broad relationship themes), incremental updates, document deletion with rebuild, many storage backends and a web UI and server. MIT; paper on arXiv 2410.05779.

## 2. Architecture map
An orchestrator, an ingestion pipeline, extraction and query logic, storage interfaces (key-value, vector, graph, document status) with backends including NetworkX, Neo4j, PostgreSQL, MongoDB, Redis, Milvus, Qdrant, OpenSearch and NanoVectorDB, four model roles with their own concurrency and time-outs (extract, keyword, query, vision), and a REST server.

## 3. Features and how each behaves
Insert splits text, extracts entities and relationships (with a re-ask loop and an optional validator hook before merge), merges into the graph and vector stores under per-entity locks and updates summaries when descriptions change. Query extracts low-level and high-level keywords, retrieves entity, relationship and chunk candidates, trims to token budgets, optionally reranks and answers. Delete by document id checks recovery anchors, subtracts the document's chunks from entities and relations, deletes objects with no remaining source and rebuilds the others from cached extractions without calling the extraction model again.

## 4. How people use it
`uv tool install "lightrag-hku[api]"`, copy `env.example` to `.env`, run `lightrag-server`, or use the SDK. Docker Compose and an offline extra exist. Pytest suite. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M6 memory and retrieval, M3 incremental merge and removal)
Before any graph change, candidate entities and relations are written to recovery tables, so a deletion can later prove what it must undo. Source ids per entity are capped (first in, first out, or keep). Rebuilding from cached extraction results recomputes descriptions after a document is removed. Lost: if no extraction cache exists, the rebuild falls back to structural repair and loses semantic updates; there is no transaction across the stores.

## 6. Agent patterns
Decoupled model roles, a re-ask loop for missed entities, a validator hook, a rerank threshold that filters low-scoring chunks, keyed locks and a busy flag for multi-worker safety.

## 7. Model and data layer
Injected async functions for the model, embeddings and reranker; bindings for OpenAI, Anthropic, Ollama, Gemini, Bedrock; interfaces resolved by a storage factory.

## 8. Hackathon-care checks
Standard logging, a pipeline status logger, optional Langfuse tracing; offline extra and marker; Docker Compose; RAGAS in the dependencies. The server binds all interfaces by default with an optional API key or token. Document text is placed directly into prompts.

## 9. Traps seen
Fixed failure string in place of a typed error; type coercion to UNKNOWN; heuristic patching of delimiter errors; no cross-store transaction (documented, with a rule); deprecated fields kept.

## 10. Reuse
MIT: copy with credit. Candidate parts: write-ahead recovery anchors, cache-backed rebuild after deletion, per-entity keyed locks, the written rule for inconsistency without transactions, the validator hook before merge.

## 11. Verdict: ADAPT for M6 and M3
Copy: (1) recovery records written before a mutation so removal (erasure, retraction) can be proved and, if anchors are missing, refused; (2) rebuild of derived state from cached extractions after a source is retracted, with no new model call; (3) the written rule: every accepted inconsistent intermediate state is documented with its reason and how it heals, and "silent failure" is never one of them.
Avoid: (1) a fixed string as the failure answer: a typed error and a gap record; (2) coercing unknown types to a default; (3) multi-store changes without an atomic commit for decision records: ours are in one append-only ledger.
Where we are already ahead: retraction recomputes exactly which decisions change, with first-order and second-order flags.
