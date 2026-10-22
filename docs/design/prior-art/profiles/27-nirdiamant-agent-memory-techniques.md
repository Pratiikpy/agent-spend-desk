# Profile: NirDiamant/Agent_Memory_Techniques

Reader: Haiku (low effort), 2026-10-16, about 103 seconds, 102k tokens, 24 tool calls. Local clone, last commit 4767c03 (2026-09-21). Paths relative to the repository root.

Spot-check (reviewer, against the files): Apache 2.0 (confirmed); 30 numbered technique folders, each with a README and one notebook (confirmed by listing, names below); tests are `conftest.py`, `test_helpers.py`, `test_imports.py` only (confirmed, so no test of the techniques themselves); no Dockerfile or compose file (confirmed); ROADMAP.md says notebook outputs are not committed (confirmed, line 23). Caveats: the reader said it did not open the READMEs of techniques 16, 17 and 23, so what it wrote about them comes from the main README and is NOT VERIFIED; the claim that every notebook runs top to bottom is the repository's own statement and was not run here. Result: PASS on structure, thin on mechanism.

## 1. What it is
A teaching catalogue of 30 agent memory techniques as notebooks, with a decision tree to pick one. Apache 2.0. Not a library.

## 2. Architecture map
Six families: short-term (buffer, window, summary, token buffer), long-term (vector, entity, knowledge graph, episodic, semantic, procedural), cognitive (working memory, hierarchical layers, consolidation, compaction, self-reflection, routing, temporal, forgetting and decay), retrieval and multi-agent (retrieval patterns, cross-session, shared memory, memory as tools), frameworks (Graphiti, Mem0, Letta, Zep), production (evaluation, LoCoMo benchmark, production patterns). A shared `utils/helpers.py` loads keys, builds clients, counts tokens and computes cosine similarity.

## 3. Features and how each behaves
Each notebook shows a technique with its inputs, outputs, defaults and failure modes in prose. Details per technique: only the ones summarised by the reader (buffer, Mem0 patterns, production tiers) were seen; the rest are NOT VERIFIED.

## 4. How people use it
Clone, create a virtual environment, install requirements, copy `.env.example` to `.env`, open a notebook locally or through its Colab badge. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M6 memory)
Useful as a vocabulary and a checklist, not as code to lift: short-term compaction, consolidation, temporal decay, forgetting, routing between stores, and production tiers (hot cache, warm vector store, cold archive with time-to-live and deletion workflows). Details of each mechanism: NOT VERIFIED beyond the main README.

## 6. Agent patterns
Self-reflection, routing, memory as tools and shared memory are listed as techniques; their implementations were not read.

## 7. Model and data layer
Anthropic, OpenAI or local sentence-transformer embeddings; each notebook picks its own store (Chroma, FAISS, pgvector, Neo4j, Redis named in docs). No common abstraction.

## 8. Hackathon-care checks
No structured trace, no Docker, no end-to-end test across techniques. Notebook outputs are not committed, which the roadmap admits.

## 9. Traps seen
Reference notebooks with no committed outputs read as claims without evidence; mixed backends; framework techniques depend on outside services and keys. The reader's claim of silent fallback on missing keys is unverified.

## 10. Reuse
Apache 2.0: copy with credit and notice. Candidates: the technique list as a coverage checklist, the evaluation and benchmark notebooks (28 and 29) as a starting point for our own memory tests, the production-tier ideas.

## 11. Verdict: REFERENCE for M6 coverage; mine notebooks 14, 15, 18, 19, 28, 29 and 30 before the M6 blueprint is final
Copy: (1) the list of techniques as a checklist, so no memory function is missing from our blueprint; (2) a memory evaluation set and LoCoMo-style tests for M11; (3) tiers with time-to-live and deletion on request.
Avoid: (1) per-technique backends with no shared interface; (2) notebooks shipped without outputs; (3) treating framework wrappers as our memory.
Follow-up: read notebooks 14 (consolidation), 18 (temporal), 19 (forgetting) and 29 (benchmarks) directly, they were not read.
