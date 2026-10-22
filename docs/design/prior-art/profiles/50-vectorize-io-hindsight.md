# Profile: vectorize-io/hindsight

Reader: agy (Gemini CLI, plan mode), 2026-10-16, 451 seconds, 756 words. Shallow clone (depth 1) (deleted after the profile pass). Paths relative to the repository root.

Spot-check (reviewer, against the files): MIT licence, copyright Vectorize AI (confirmed); the setting `HINDSIGHT_API_FAIL_ON_EXTRACTION_ERRORS` defaults to false, and when true a retain that lost any fact to an extraction error is marked failed with the error count, "so silently-dropped facts surface as a hard failure" (`hindsight-docs/docs/developer/configuration.mdx:1791`, confirmed); raw source text is stored by default and can be turned off per bank (`HINDSIGHT_API_STORE_DOCUMENT_TEXT`, line 1790, confirmed; the reader's "raw text is discarded" is wrong by default); observation reconciliation merges only when cosine similarity is at least 0.97, uses a focused check of the full text of both so differing numbers, negations or names stay apart, works only within the same tag scope, and is skipped on Oracle, all stated in `observations.mdx:54-58` (confirmed; documented, not silent); the fusion constant `_KNOWLEDGE_RRF_K = 60` at `engine/memory_engine.py:144` (confirmed). The 92.4% LoCoMo claim is the project's own README claim: NOT VERIFIED. Result: PASS with two reader errors fixed.

## 1. What it is
An agent memory system with three verbs: retain (extract facts), recall (retrieve) and reflect (reason over memory with an agent loop), plus background consolidation into observations and mental models. MIT; REST, MCP and command-line interfaces.

## 2. Architecture map
A FastAPI engine, a CLI, a control-plane UI and an evaluation package. Storage on PostgreSQL with pgvector (or Oracle 23ai), tables for banks, documents, chunks, entities, memory units, unit-entity links and memory links. A bank is the tenancy unit.

## 3. Features and how each behaves
Retain extracts world and experience facts, entities and time bounds with a model; extraction failures are dropped unless the fail-on-errors setting is on. Recall runs four searches in parallel (vector with a cosine cutoff, keyword, graph link expansion, time windows), fuses them with reciprocal rank fusion and reranks with a cross-encoder. Reflect runs a tool loop of up to ten steps over mental models and observations and returns an answer with citations, steered by directives and disposition traits. Consolidation clusters facts into observations and reconciles near-duplicates while keeping contradictions apart.

## 4. How people use it
`docker run -p 8888:8888 vectorize/hindsight:latest`, or `uv run hindsight-api` with an embedded Postgres for development. Tests by pytest and a system-test package. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M6 retain, recall, reflect)
The design to take is non-destructive consolidation: observations merge only above a high similarity and after a check of the full text; supporting evidence folds together; contradictions are kept. Recall fuses four signals with a fixed constant. Pre-computed mental models answer frequent questions quickly. State: banks, documents, chunks, entities, memory units and links; time and tag scopes decide what can merge.

## 6. Agent patterns
Reflect is an investigator with a bounded tool loop and an evidence-sufficiency step; model routing supports failover and round-robin; bank-scoped tenancy.

## 7. Model and data layer
Many model, embedding and reranker back ends; Postgres with migrations dispatched per dialect.

## 8. Hackathon-care checks
JSON logging and OpenTelemetry; local embedded database and stub providers for offline runs; a Docker one-liner; API keys in headers. Extraction prompts take untrusted text, so injection exposure applies.

## 9. Traps seen
Extraction failures dropped by default; a dedup step that is skipped on one database; a structured output mismatch in reflect returns null; benchmark claims without commit-pinned run logs in the repository.

## 10. Reuse
MIT: copy with credit. Candidate parts: four-way recall with reciprocal rank fusion, scope-limited reconciliation with a text check, the fail-on-errors switch (inverted for us: default on), the store-text-or-not switch per bank for data minimisation.

## 11. Verdict: ADAPT for M6
Copy: (1) four-signal recall fused by reciprocal rank (k = 60 as a starting value, calibrated on our cases); (2) reconciliation that merges only after a full-text check and never across scopes, with contradictions kept; (3) a per-scope switch for storing raw text, so a data-minimising scope keeps only derived facts and its hash.
Avoid: (1) extraction failures dropped by default: ours fail the retain and record the count; (2) a reconcile step that can be skipped on another back end without a doctor warning; (3) a null structured output as a quiet result.
Where we are already ahead: every learned change is a certified proposal; Hindsight merges on a similarity threshold plus a model check.
