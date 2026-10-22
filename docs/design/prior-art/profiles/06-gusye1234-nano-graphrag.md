# Profile: gusye1234/nano-graphrag

Reader: Haiku (low effort), 2026-10-16, about 115 seconds, 82k tokens. Local clone, commit acb35c0 (2026-01-27), version 0.0.8.2. Paths relative to `nano_graphrag/` unless stated.

Spot-check (reviewer, against the code): MIT licence (confirmed); defaults chunk size 1,200 tokens, overlap 100, one gleaning pass, Leiden clustering at `graphrag.py:75-84` (confirmed); the gleaning loop that asks "continue?" and stops unless the answer is "yes" at `_op.py:320-333` (confirmed); no `benchmark` folder in the clone although the README mentions one (confirmed). Corrections by the reviewer: the reader repeated the README's "about 1,100 lines" but the package is 2,928 lines including storage backends; and its verdict labels were inconsistent (it called retrieval "already-better" than our design and also told us to copy it), so section 11 is restated. Result: PASS on facts, FAIL on verdict wording (fixed).

## 1. What it is
A small GraphRAG implementation: chunk, extract entities and relations, build a graph, cluster communities, write community reports, answer local, global or naive queries. MIT.

## 2. Architecture map
Chunking (`_splitter.py`, `_op.py`), entity extraction (`entity_extraction/`, `_op.py:extract_entities`), retrieval (`_op.py` local, global and naive queries), pluggable storage (`_storage/`: NetworkX graph, JSON key-value, NanoVectorDB, HNSWLIB, Neo4j, Milvus), model layer (`_llm.py`: OpenAI, Azure, Bedrock). Entry point: the `GraphRAG` dataclass with `insert()` and `query()`.

## 3. Features and how each behaves
Insert: token-window chunking, typed entity and relation extraction with a gleaning loop, graph upsert with description merging, clustering, community reports. Query modes: local (entities, then relations, communities and chunks), global (communities mapped to scored points, then reduced), naive (chunks only). No entities or communities returns a fixed failure answer. LLM responses are cached by default.

## 4. How people use it
`pip install nano-graphrag`; `GraphRAG(working_dir=...)`, `insert(text)`, `query(question, QueryParam(mode="local"))`; async variants; swappable embeddings, LLMs and stores in the README. A test with a mocked model and embeddings exists. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M2 chunking, M3 entity extraction, M6 retrieval)
Extraction asks the model for entity and relation tuples (relation weight 0 to 1, order 1 to 3), then repeats up to the gleaning limit to catch misses; an entity already in the graph gets its descriptions merged and its source chunks tracked. Lost: co-reference across chunks (each mention stays separate), text order, and any check of a description against its source. Retrieval assembles CSV tables of entities, relations, community reports and chunks within token budgets. Global mode groups communities by token budget, not by meaning.

## 6. Agent patterns
None: a linear pipeline with concurrency only inside extraction and global-query batches. No roles, critics or confidence branching.

## 7. Model and data layer
Callables for the best and the cheap model, the embedding function, the vector store and the graph store, all replaceable. Concurrency is limited with a semaphore.

## 8. Hackathon-care checks
Logging through the standard logger and a progress bar; no structured trace. No sample mode; the model and embeddings are required. No Docker. The benchmark mentioned in the README is not in the clone. Input text goes into prompts without sanitisation. LLM responses are cached in plain JSON.

## 9. Traps seen
Malformed model output is skipped silently by regex parsing; an empty extraction logs a warning but the insert continues; descriptions and relation weights come from the model with no grounding; the README promises a benchmark that is not present.

## 10. Reuse
MIT: copy with credit. Candidate parts: token-window chunking, the gleaning loop with merge-on-upsert, the layered context assembly, the storage interfaces. Prompts and clustering were not read and are not assessed.

## 11. Verdict: ADAPT for M3 and M6; chunking is a baseline only
Copy: (1) the gleaning loop with merge-on-upsert as a candidate-generation step; (2) layered context assembly with explicit token budgets; (3) pluggable storage interfaces.
Avoid: (1) regex parsing that skips malformed output silently: record each skipped record as a finding; (2) descriptions and weights with no source quote or provenance; (3) no trace before each model call and retrieval step.
Where we are already ahead: reconciliation with explainable pairwise evidence, cannot-link constraints and quote-verified provenance; nano-graphrag resolves nothing across chunks.
