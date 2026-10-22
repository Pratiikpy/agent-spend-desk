# Profile: OSU-NLP-Group/HippoRAG

Reader: agy (Gemini CLI, plan mode), 2026-10-16, 529 seconds, 970 words. Local clone, HippoRAG 2. Paths relative to `src/hipporag/` unless stated.

Spot-check (reviewer, against the code): MIT licence, copyright OSU Natural Language Processing (confirmed); personalised PageRank over an undirected projection with the stated damping, weights and reset vector and the `prpack` implementation at `HippoRAG.py:2204-2213` (confirmed); the reranker maps every model-generated fact to the closest candidate with `difflib.get_close_matches(..., n=1, cutoff=0.0)[0]` so any hallucinated fact is attached to some real candidate, prints exceptions and returns `{'confidence': None}`, at `rerank.py:112-126` (confirmed); a missing dataset-specific QA prompt falls back to the `musique` prompt with a logged warning at `HippoRAG.py:1153-1156` (confirmed; logged, so not silent); config fields `passage_node_weight`, `synonymy_edge_sim_threshold`, `retrieval_top_k`, `damping` exist in `utils/config_utils.py` (confirmed; the default values 0.05, 0.8, 200 and 0.5 were not rechecked). Result: PASS.

## 1. What it is
A graph-based retrieval method inspired by hippocampal memory: extract subject-relation-object triples from passages with a model, build a graph linking phrases to passages, and retrieve multi-hop context with Personalised PageRank. MIT; paper and code from OSU NLP.

## 2. Architecture map
An orchestrator class with index, retrieve, question-answering and delete; an OpenIE extractor; three embedding stores (chunks, entities, facts); a model-based reranker of facts; igraph for the graph; an MCP server; an index manifest that fingerprints the models and components used.

## 3. Features and how each behaves
Indexing takes chunks (bare strings are rejected with a type error), extracts entities and triples, embeds them, adds synonymy edges between similar phrases above a similarity threshold and builds the graph. Retrieval scores the query against stored facts, reranks them with a model, seeds the phrase nodes, adds dense passage scores with a small weight, runs PageRank, and returns passages; if no fact survives the rerank it falls back to dense retrieval. Delete removes chunks and any triple or entity no longer referenced. An IRCoT loop alternates retrieval and reasoning.

## 4. How people use it
`pip install hipporag`, build the object with model names, index documents, ask. Works with hosted models, a local vLLM server and an MCP server. Unit and integration tests exist. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M6 precedent search, M3 entity linking)
Seed weight for a phrase is the fact score divided by how many chunks contain the phrase, which down-weights generic entities; passage seeds are the dense score times a small constant; the sum is the reset vector for PageRank. State is three vector stores, a pickled graph, the OpenIE results, chunk metadata and a manifest. Edges keep source accounting so a deletion removes only what no remaining source supports. Lost: the predicate is not stored on edges and edges are treated as undirected, so time order, cause and negation vanish.

## 6. Agent patterns
No agent roles; separate extraction and answering models are allowed; one reasoning loop (IRCoT) with a step cap; a dense-retrieval fallback.

## 7. Model and data layer
Pluggable model and embedding classes; vector stores local Parquet, Qdrant, Chroma, Milvus; custom model objects need an explicit identity so the manifest can check compatibility.

## 8. Hackathon-care checks
Standard logging with secret redaction, a SQLite cache of model calls, a sample dataset and a one-command sample run; no Docker. The HTTP MCP server has no authentication. Extraction output from the model is parsed without sandboxing.

## 9. Traps seen
Extraction errors become empty lists with only a warning; the `cutoff=0.0` match; a silent borrowed prompt; the claim of "long-term memory" rests on an in-memory graph with no transactions or point-in-time recovery; no concurrency safety.

## 10. Reuse
MIT: copy with credit. Candidate parts: the seed-weight formula, the manifest that fingerprints models and components, source-aware edge accounting for incremental delete.

## 11. Verdict: ADAPT for M6 (candidate generation) and M3
Copy: (1) PageRank reset seeds from entity specificity plus a small dense term, as a deterministic candidate source for shared nominees, addresses or bank accounts (the spec already plans this and keeps it behind an ablation); (2) an index manifest that fingerprints embedding model and extraction version and refuses a mismatched state; (3) edge provenance counts so deleting a source removes only unsupported edges.
Avoid: (1) matching a generated item to the closest candidate with a zero cutoff: a fact the model invented must be dropped and recorded; (2) empty results from a failed extraction with no flag; (3) edges without a predicate or direction for ownership, payment or sanction relations.
Where we are already ahead: bitemporal, typed edges, quote-verified provenance and cannot-link constraints.
