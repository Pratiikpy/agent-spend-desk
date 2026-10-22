# Profile: run-llama/llama_index

Reader: agy (Gemini CLI, plan mode), 2026-10-16, 376 seconds, 742 words. Local clone. Paths relative to `llama-index-core/llama_index/core/` unless stated.

Spot-check (reviewer, against the code): MIT licence, copyright Jerry Liu (confirmed); the directory reader prints "Failed to load file ... Skipping..." and returns an empty list unless `raise_on_error` is set, at `readers/file/base.py:618-626` (confirmed; the default is not to raise); constants `DEFAULT_SIMILARITY_TOP_K = 2` and a sentence-splitter overlap of 200 at `constants.py` and `node_parser/text/sentence.py:22-24` (confirmed); the simple vector store keeps embeddings only, `stores_text = False`, at `vector_stores/simple.py:77` (confirmed); refresh compares a stored document hash and inserts or updates only changed documents at `indices/base.py:440-452` (confirmed). The splitter fallback order and metadata-aware budgeting at `sentence.py:106-206` were not rechecked. Result: PASS.

## 1. What it is
A data framework for connecting private data to language models: readers, node parsers, indices, retrievers, query engines, agent workflows, evaluators. MIT.

## 2. Architecture map
Readers load `Document`s; node parsers split them into nodes; an index embeds and registers nodes; a retriever returns scored nodes; a query engine synthesises an answer; event-driven agent workflows use steps and explicit handoffs. Settings hold the default model and embedder. Hundreds of integration packages live outside the core.

## 3. Features and how each behaves
Directory reader (UTF-8, errors ignored, non-recursive, skips unreadable files); sentence splitter (1,024-token chunks, 200 overlap by the splitter's own constant, paragraph separator of three newlines, errors if overlap exceeds chunk size or metadata alone exceeds the budget); vector retriever (top 2 by default); compact response mode; evaluators for faithfulness, correctness, MRR and hit rate.

## 4. How people use it
`pip install llama-index`, read a folder, build a vector index, ask a query engine. Examples under docs, tests with pytest. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M1 readers, M2 chunking, M6 retrieval)
Splitting falls back through paragraph, sentence tokenizer, a punctuation regex, spaces, then characters, and merges pieces under a budget that subtracts the metadata length. Retrieval is cosine similarity with a heap. Refresh keeps a content hash per document so only changed documents are re-indexed. Lost: the vector store does not keep text, relations between documents vanish after chunking.

## 6. Agent patterns
Step-based workflows with handoff checks against an allowed list; no critic, confidence branching or verification in the core workflows (NOT VERIFIED beyond that).

## 7. Model and data layer
Global settings for model and embedder; defaults reach for OpenAI and need a key unless a testing flag swaps in mock models; readers backed by fsspec.

## 8. Hackathon-care checks
Callback events and instrumentation give a trace of query and chunking steps; mock embedder and model for tests; bundled tokenizer data so no download at run time. Retrieved chunks go into prompts with no injection filter.

## 9. Traps seen
Unreadable files skipped with only a printed line; empty nodes discarded with a warning; text not stored beside embeddings; an answer synthesised even when the context lacks evidence; top 2 with no similarity floor.

## 10. Reuse
MIT: copy with credit. Candidate parts: the splitter cascade, metadata-aware chunk budget, hash-based incremental refresh, reader interface, mock models.

## 11. Verdict: ADAPT for M1, M2 and M6
Copy: (1) a splitter cascade with a budget that reserves room for metadata; (2) incremental refresh by content hash, which maps to our source-hash and re-verify rule; (3) a simple reader interface returning documents with source metadata.
Avoid: (1) skipping unreadable files quietly: every skipped file is a recorded gap with its reason; (2) discarding empty content with a printed warning; (3) embeddings without the evidence text and its hash next to them.
Where we are already ahead: spans carry offsets and a stored text-layer hash, so a citation can be re-opened; LlamaIndex keeps scored chunks only.
