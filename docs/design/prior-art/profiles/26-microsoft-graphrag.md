# Profile: microsoft/graphrag

Reader: agy (Gemini CLI, plan mode), 2026-10-16, 339 seconds, 823 words. Local clone. Paths relative to `packages/graphrag/graphrag/` unless stated.

Spot-check (reviewer, against the code): MIT licence, Microsoft copyright (confirmed); entity merge groups only by exact `title` and `type` at `index/operations/extract_graph/extract_graph.py:104-115`, with no alias or fuzzy step (confirmed; the upper-casing the reader mentioned was not located in that function); the gleaning loop adds a "continue" prompt and a yes-or-no loop prompt, stopping unless the answer is exactly "Y", at `graph_extractor.py:101-121` (confirmed); zero extracted entities or zero relationships raises `ValueError` at `index/workflows/extract_graph.py:125-138` (confirmed); global search with no scoring key points returns a canned "no data" answer and logs a warning that names the `allow_general_knowledge` option at `query/structured_search/global_search/search.py:340-347` (confirmed). Correction by the reviewer: the reader called the community-report error handling silent; the extractor logs the exception and calls an error callback, then returns empty output (`community_reports_extractor.py:86-96`), so it is logged but yields an empty report that downstream code must tolerate. Result: PASS with that fix.

## 1. What it is
Microsoft's graph-based retrieval pipeline: extract entities and relationships with a model, cluster the graph into communities, write community reports, answer questions at global or local level. MIT; the README says it is in maintenance mode.

## 2. Architecture map
A uv workspace with packages for the main pipeline, chunking, input, storage, cache, vectors and LLM access. Indexing: documents, chunks, entity and relationship extraction, description summaries, hierarchical Leiden clustering, community reports, embeddings, Parquet tables. A standard indexing path (model extraction) and a fast path (NLP libraries, no model for extraction).

## 3. Features and how each behaves
Four query modes: global (map-reduce over community reports), local (entity embeddings, one-hop neighbours, text units, report context), DRIFT (a global primer that spawns local follow-ups, tracked as a tree) and basic (chunk vector search). Defaults: 1,200-token chunks with 100 overlap. Empty extraction aborts the index run.

## 4. How people use it
`graphrag init`, edit `settings.yaml`, `graphrag index`, `graphrag query --method global`. Notebooks, and unit, integration, smoke and verb tests are present. The README warns that indexing is costly and prompts need tuning. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M3 extraction and resolution, M6 reports and retrieval)
Extraction uses delimited tuples with a capped re-ask loop. Resolution is exact-match grouping: "MSFT" and "Microsoft" stay separate; same-entity descriptions are condensed by a model call. Community reports are structured (summary, findings, rating with explanation). Local context is budgeted by share: about 25% reports, 25% graph neighbourhood, 50% text units (defaults; the exact figures at `mixed_context.py:100-218` were not rechecked). Lost: validity in time, extraction confidence, and the link from a finding back to a quote.

## 6. Agent patterns
Prompt roles (extractor, summariser, reporter, map analyst, reducer), the gleaning loop as a self-critique, DRIFT's query-state tree. No separate verifier.

## 7. Model and data layer
LiteLLM-based completion with a mock provider; vector stores LanceDB, Azure AI Search, Cosmos; storage File, Memory, Blob, Cosmos; cache SQLite, JSON, memory or none.

## 8. Hackathon-care checks
Logs to an indexing log and a query log; a mock model and the NLP-only fast path run without an LLM, which is a good offline route. No Dockerfile. Golden-data regression tests exist; published accuracy: NOT VERIFIED. Secrets are redacted in CLI logs. Document text goes into prompts without sanitising.

## 9. Traps seen
Exact-match entity resolution; empty community reports after an error; the `allow_general_knowledge` switch lets answers go beyond the data; a canned no-data answer; one unfinished docstring TODO; high cost of the standard path.

## 10. Reuse
MIT: copy with credit. Candidate parts: gleaning loop, token-budget shares for context assembly, the community report schema, the fast NLP extraction path, the mock model.

## 11. Verdict: ADAPT for M3 and M6; the fast path is a model for our offline mode
Copy: (1) a context budget split by share across summaries, neighbourhood and raw text; (2) a structured report schema with a rating and its explanation; (3) an NLP-only extraction path and a mock model so the whole pipeline runs offline.
Avoid: (1) exact-match entity resolution as the only resolver; (2) an empty output after an error with nothing that marks the gap; (3) a switch that permits answers outside the sources in a decision path.
Where we are already ahead: explainable pairwise entity evidence with cannot-link constraints and quote-verified provenance; GraphRAG resolves names only by exact string.
