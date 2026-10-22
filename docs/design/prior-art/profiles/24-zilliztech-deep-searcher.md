# Profile: zilliztech/deep-searcher

Reader: Haiku (low effort), 2026-10-16, about 108 seconds, 100k tokens, 23 tool calls. Local clone. Paths relative to `deepsearcher/` unless stated.

Spot-check (reviewer, against the code): Apache 2.0 (confirmed); `max_iter` 3 at `agent/deep_search.py:84` and `config.yaml:173` (confirmed); chunk size 1500 and overlap 100 at `config.yaml:176-177` (confirmed); per-chunk rerank prompt that answers only YES or NO, accepted when "YES" is in the reply and "NO" is not, at `deep_search.py:33,159` (confirmed); a `# TODO` for internet search at `deep_search.py:231` (confirmed); the fixed reply "No relevant information found for query" at line 290 (confirmed). Correction by the reviewer: the reader said the model-output parser has no error handling; `llm.literal_eval` in `llm/base.py:68-83` strips think tags and code fences and raises a documented `ValueError` if it cannot parse, so the failure is loud, not silent, but the caller does not catch it. The "copyright 2019 Zilliz" remark was not rechecked. Result: PASS with that correction.

## 1. What it is
An open-source deep-research system over private data held in a vector database (Milvus by default), with loaders, a reflective multi-round search agent and a router. Apache 2.0.

## 2. Architecture map
Loaders for files (PDF, text, Unstructured, Docling) and web crawlers (Firecrawl, Crawl4AI, Jina); a recursive splitter; embedding, LLM and vector-database interfaces behind a configuration factory; agents `DeepSearch`, `NaiveRAG`, `ChainOfRAG` and a router that picks one per query. CLI, Python API and a FastAPI server.

## 3. Features and how each behaves
Loading walks a folder by extension and keeps a reference per document. Chunking is 1,500 characters with 100 overlap and stores a wider surrounding window in metadata. The deep search loop: split the question into up to four sub-questions, search each, ask the model YES or NO for every retrieved chunk, ask it to reflect for missing information, repeat up to three rounds, deduplicate by text. Zero chunks returns a fixed "no information" message.

## 4. How people use it
`pip install deepsearcher` or `uv sync`, edit `config.yaml`, then `deepsearcher load <path>` and `deepsearcher query "..."`, or call it from Python, or run the web server. The README notes that small models fail to produce parseable output. An evaluation folder exists but was not read.

## 5. Mechanism for our modules (M1 connectors, M2 chunking, M4 reflective search)
State kept: all sub-queries, all accepted results (deduplicated), a token count. Reranking is repeated for each chunk in each round; only the YES or NO is kept, not the reason. Lost: why a chunk was accepted, and the console log of the run is not written to a file.

## 6. Agent patterns
Specialist agents under a router; an inline per-chunk relevance critic; a reflection step that produces gap queries and ends the loop early when it returns none. No confidence score.

## 7. Model and data layer
Interfaces for embeddings, language models, loaders, crawlers and vector databases, assembled by a factory from the config file; Milvus Lite as the local default, with batch insert of 256.

## 8. Hackathon-care checks
Console logs with colour tags only, no structured trace; no sample mode; a local Milvus Lite file makes a one-command local run plausible, NOT VERIFIED here. No sanitisation of file paths or query text seen.

## 9. Traps seen
One model call per chunk per round; the parser's `ValueError` is not caught by the loop; a TODO for internet search; the "YES present and NO absent" test is fragile; README claims accuracy without published results in the checked files.

## 10. Reuse
Apache 2.0: copy with credit and notice. Candidate parts: the factory and interface layout, the sentence-window metadata, the async per-sub-query search, the gap-query reflection prompt.

## 11. Verdict: ADAPT for M1, M2 and M4
Copy: (1) a factory that swaps embeddings, models, loaders and stores from one configuration; (2) storing a wider context window beside each chunk; (3) reflection that outputs only the missing questions and stops when there are none.
Avoid: (1) one rerank call per chunk: batch it, and record the reason; (2) an uncaught parse error ending the run: record a failed step as a gap; (3) a console-only run log.
Where we are already ahead: evidence carries a verbatim quote and a source hash; here a chunk's relevance is a YES.
