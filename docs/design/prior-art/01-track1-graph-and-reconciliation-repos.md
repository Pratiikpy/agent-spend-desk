# Prior art 01: graph, memory and reconciliation repositories (Track 1)

Teardown of eight open-source systems, read for one question: what does each one do when sources disagree, repeat themselves or leave gaps, and can its answer be traced back to evidence mechanically? Our product (T1) reconciles contradictory records across several sources, (T2) explains every conclusion with mechanically verifiable evidence, and (T3) decides using rules plus memory.

## Method and limits

- Date of reading: 2026-10-13. Repos are read-only clones under `research/track-1-fragmented-intelligence/<repo>/`. Commit ids come from `git log -1` in each clone.
- **Static reading only.** Nothing was installed, imported or executed. Every behavioural statement is inferred from source text and shipped result files. Where I recomputed something myself (a Jaccard score, an AST count of a constant) the text says so; that is my arithmetic, not their code running.
- Paths are relative to the root of the named clone. `path:line` is given where I read the line; otherwise the function or class name is given.
- "Mechanically verifiable" means a deterministic check: a quoted span matched against stored source text, an id that resolves in a stored table, a hash that recomputes. A second LLM reading the answer is not mechanical.
- Licences allow study. Our rule is to re-implement ideas in our own code and never copy files; the licence is recorded so the rule can be applied.
- README claims are only counted as facts when I also read the code. Where a claim has no backing in the files I read, it is called out.

| Repo | Upstream | Commit | Licence |
|---|---|---|---|
| `storm` | stanford-oval/storm | fb951af (2025-09-30) | MIT |
| `graphrag` | microsoft/graphrag | 5faaaf4 (2026-10-08) | MIT |
| `LightRAG` | HKUDS/LightRAG (README links) | 4d0afc1 (2026-10-12) | MIT |
| `nano-graphrag` | gusye1234/nano-graphrag | acb35c0 (2026-01-27) | MIT |
| `HippoRAG` | OSU-NLP-Group/HippoRAG | d5c8329 (2026-10-06) | MIT |
| `graphiti` | getzep/graphiti | 2f0fb35 (2026-10-13) | Apache-2.0 |
| `cognee` | topoteretes/cognee | 0ec7a9f (2026-10-08) | Apache-2.0 |
| `ReConcile` | author site dinobby.github.io (repo owner not confirmed in the files) | 902ae91 (2023-09-26) | MIT |

Upstream is taken from README links and licence headers I read, not from a git remote; treat the column as a label. `LightRAG` is HKUDS/LightRAG per its README links.

---

## 1. STORM (and Co-STORM)

### 1. What it is and the problem it solves
STORM researches a topic through simulated multi-perspective question-and-answer over web search, then writes a Wikipedia-style article with inline citations (`README.md`; `knowledge_storm/storm_wiki/engine.py:STORMWikiRunner`). Co-STORM adds a human-in-the-loop round table and a mind-map knowledge base (`knowledge_storm/collaborative_storm/engine.py:CoStormRunner`, `knowledge_storm/dataclass.py:KnowledgeBase`). The problem is long-form synthesis with citations. It is not a reconciliation system.

### 2. Architecture
- Four swappable stages behind abstract classes: knowledge curation, outline, article, polish (`knowledge_storm/interface.py:KnowledgeCurationModule`, `OutlineGenerationModule`, `ArticleGenerationModule`, `ArticlePolishingModule`).
- Core record is `Information(url, description, snippets, title, meta, citation_uuid)` (`knowledge_storm/interface.py:41`). The collected corpus is `StormInformationTable.url_to_info`, a dict keyed by URL string (`knowledge_storm/storm_wiki/modules/storm_dataclass.py:66`, `construct_url_to_info`).
- Section writing retrieves snippets with a local `SentenceTransformer("paraphrase-MiniLM-L6-v2")` and cosine similarity (`storm_dataclass.py:109`, `prepare_table_for_retrieval`, `retrieve_information`).
- Co-STORM keeps a tree of `KnowledgeNode`s whose `content` is a set of information ids, plus `info_uuid_to_info_dict` and `info_hash_to_uuid_dict` (`knowledge_storm/dataclass.py:KnowledgeNode`, `:359`).
- Storage is in memory with JSON and pickle dumps (`knowledge_storm/utils.py:FileIOHelper`). An optional Qdrant store backs `VectorRM` (`utils.py:QdrantVectorStoreManager`). There is no graph database.

### 3. Conflicting, duplicated and incomplete information
- **Conflicts: no handling at all.** A grep for `contradict|conflict|disagree|inconsisten|credib|reliab|trust` across `knowledge_storm/**/*.py` returns only the dead filter below.
- **Duplicates: URL string equality only.** Snippets of the same URL are merged with `extend`, then `list(set(...))` (`storm_dataclass.py:66` and `:174`, `_merge_new_info_to_references`). The set round trip makes snippet order depend on the string hash seed.
- `Information.__hash__` is defined twice; the second definition (`interface.py:87`) wins and hashes `url`, sorted snippets and the `question`/`query` meta. The same snippet retrieved under two queries therefore hashes differently in `KnowledgeBase.insert_information` (`dataclass.py:insert_information`, uses `info_hash_to_uuid_dict`).
- **Source reliability: a promised filter that is not wired.** `TopicExpert`'s docstring lists "3. Filter out unreliable sources" (`knowledge_storm/storm_wiki/modules/knowledge_curation.py:185`) and the body carries the comment "Simplify this part by directly using the top 1 snippet"; no filter step exists. Retrievers accept an `is_valid_source` callable that defaults to `lambda x: True` (`knowledge_storm/rm.py:30`). The only supplied filter, `is_valid_wikipedia_source` (`storm_wiki/modules/retriever.py:225`), is referenced nowhere else in the repo (grep). Parsing the three blocklist constants with `ast` (my static count): 206 entries, of which 17 contain a `.`; the rest are Wikipedia page-style names such as `112_Ukraine`. The check is a substring test on the URL host, so most entries could never match even if it were wired.
- **Incomplete information:** the expert returns canned strings ("Sorry, I cannot find information for this question") and the conversation continues (`knowledge_curation.py:TopicExpert.forward`). Duplicate removal in the article is one optional LLM call, off by default (`storm_wiki/modules/article_polish.py:30`, `remove_duplicate: bool = False`).

### 4. Agent and LLM roles, loop, bounds, failure handling
- `ConvSimulator` alternates `WikiWriter` (persona-conditioned asker) and `TopicExpert` (question to queries, retrieve, answer). It stops on the literal reply "Thank you so much for your help!", an empty utterance, or `max_conv_turn` (default 3) (`knowledge_curation.py:47-67`; `storm_wiki/engine.py:134`). Personas come from `StormPersonaGenerator`, capped by `max_perspective=3` (`engine.py:140`).
- Co-STORM adds a moderator and rotating experts under `DiscourseManager.get_next_turn_policy`, bounded by `total_conv_turn=20` (`collaborative_storm/engine.py:461`, `:206`).
- LLM calls use `backoff` decorators in `knowledge_storm/lm.py`. Answer-generation failure is caught and replaced by a canned string; there is no pipeline-level retry.
- The runner argument `disable_perspective` is never read: `grep -rn "args.disable_perspective"` finds nothing, and `engine.py:224` hard-codes `disable_perspective=False`.

### 5. Evidence, citation and provenance
- Inline `[n]` markers index `Information` entries; a citation resolves to a URL with merged snippets, not to a snippet or character span (`storm_dataclass.py:update_section`, `reorder_reference_index`, `dump_reference_to_file`).
- The only check is an index bound, and it is off by one: when a section cites an index above the list length, `update_section` loops `range(len(current_section_info_list), max_ref_num + 1)` (`storm_dataclass.py:275`) and `ArticleTextProcessing.clean_up_citation` does the same with `range(len(turn.search_results), max_ref_num + 1)` (`utils.py:446`). Because markers are 1-based, `[len]` is a valid citation and gets removed. I read this; I did not run it.
- Nothing checks that a cited sentence is supported by the cited text.

### 6. Evaluation and benchmarks shipped
No `tests/` directory and no evaluation code in the clone. The README points to the FreshWiki and WildSeek datasets on Hugging Face and to other git branches for paper replication; the Co-STORM branch is described as "placeholder for now" (`README.md`, "Replicate STORM & Co-STORM paper result"). Paper results are therefore NOT VERIFIED here.

### 7. Licence and last commit
MIT, "Copyright (c) 2024 Stanford Open Virtual Assistant Lab" (`LICENSE`). Last commit `fb951af7744dab086e34962e9bc6fe878e145f83`, 2025-09-30.

### 8. ADOPT and BEAT
- **ADOPT**
  - Stage interfaces with typed hand-offs so each stage can be tested alone (`interface.py`).
  - Co-STORM's pattern of one growing structure that every turn writes into and every later turn reads (`KnowledgeBase`), as a model for the "memory" the decision layer reads.
  - Writing the per-sentence citation list out as a file (`dump_reference_to_file`), as a shape for our evidence export.
- **BEAT**
  - Make source weighting real: STORM has the hook and ships it switched off.
  - Cite at span level, not URL level, and verify the span exists in the stored fetch.
  - Replace the index-bound check with a closed-set check (every cited id exists in the evidence bank for this answer, no off-by-one).
  - Make dedup canonical (normalised URL plus content hash) and deterministic (sorted, not `set`).

### 9. NOT VERIFIED
Anything about answer quality. The Co-STORM moderator and expert prompts beyond the turn policy. Whether `lm.py` retry counts are bounded (I saw the decorators, not their parameters). The frontend.

---

## 2. GraphRAG (Microsoft)

### 1. What it is and the problem it solves
A pipeline that extracts an entity-relationship graph from text with an LLM, clusters it with Leiden, writes community summaries, and answers questions by local search (entity neighbourhood) or global search (map-reduce over community reports) (`docs/index/default_dataflow.md`, `packages/graphrag/graphrag/index/workflows/`). The problem is "whole-corpus" questions plain vector RAG cannot answer. Reconciliation is incidental.

### 2. Architecture
- Monorepo of packages: `graphrag`, `graphrag-llm`, `graphrag-storage`, `graphrag-vectors`, `graphrag-cache`, `graphrag-chunking`, `graphrag-input`, `graphrag-common` (`packages/`).
- Workflow chain registered in `packages/graphrag/graphrag/index/workflows/factory.py`: load documents, chunk to text units, `extract_graph`, `finalize_graph`, `create_communities`, `create_community_reports`, embeddings. A second path, `--method fast`, swaps LLM extraction for NLTK/spaCy noun-phrase co-occurrence (`docs/index/methods.md`, `index/workflows/extract_graph_nlp.py`).
- Tables (pandas, parquet): entities `(title, type, description, text_unit_ids, frequency, degree)`, relationships `(source, target, description, weight, text_unit_ids)`, optional covariates (claims), communities, community reports (`data_model/schemas.py:ENTITIES_FINAL_COLUMNS`, `data_model/covariate.py:Covariate`).
- Leiden clustering takes a seed, default `0xDEADBEEF` (`config/defaults.py:73`; `index/operations/cluster_graph.py`).

### 3. Conflicting, duplicated and incomplete information
- **Entity identity is the exact upper-cased title plus upper-cased type.** `GraphExtractor._process_result` applies `clean_str(name.upper())` (`index/operations/extract_graph/graph_extractor.py`). `_merge_entities` groups by `["title","type"]` and `_merge_relationships` by `["source","target"]`, summing `weight` (`extract_graph.py:104,118,126`). No fuzzy or semantic resolution exists in the indexing path I read.
- **Conflicts are delegated to one prompt sentence.** The summariser prompt says "If the provided descriptions are contradictory, please resolve the contradictions and provide a single, coherent summary" (`packages/graphrag/graphrag/prompts/index/summarize_descriptions.py:10`). Descriptions are de-duplicated and sorted, then summarised in token-bounded batches (`index/operations/summarize_descriptions/description_summary_extractor.py:87,101`). The losing claim is discarded without a record. The merged text carries no per-claim provenance, only the union of `text_unit_ids`.
- **A raw snapshot exists but is opt-in:** `raw_entities` and `raw_relationships` are copied before summarisation (`index/workflows/extract_graph.py:140`) and written only when `config.snapshots.raw_graph` is set (same file, `run_workflow`).
- **Claims are the closest thing to conflict modelling and are off by default.** The claim prompt asks for status `TRUE|FALSE|SUSPECTED`, a start/end date, and "**all** quotes from the original text" (`prompts/index/extract_claims.py:20-24`). Claim extraction is `enabled: bool = False` (`config/defaults.py:132`). Nothing in the code I read compares claims with each other.
- **Same title, different type loses data (by reading, not executed).** `_merge_entities` keeps `(title,type)` rows apart, `get_summarized_entities_relationships` joins summaries back on `title` only (`extract_graph.py:184`), and `finalize_entities` keeps the first row per title and drops the rest (`index/operations/finalize_entities.py:39-44`). The dropped variant's description and `text_unit_ids` disappear.
- **Incremental update uses `"first"` for type and degree, `"mean"` for weight.** `_group_and_resolve_entities` aggregates `type: "first"`, `degree: "first"` with a TODO (`index/update/entities.py:55,60`); `_update_and_merge_relationships` uses `weight: "mean"` (`index/update/relationships.py:61`), while the full run uses `sum` (`extract_graph.py:126`). A graph built in one pass and the same data built incrementally can disagree.
- **Incomplete:** relationships whose endpoints have no entity row are dropped with a warning (`extract_graph/utils.py:filter_orphan_relationships`).

### 4. Agent and LLM roles, loop, bounds, failure handling
- Roles are separate completion calls: extractor with a gleaning loop (`max_gleanings=1`, `config/defaults.py:137,150`; `graph_extractor.py:_process_document`), description summariser, claim extractor, community reporter. Query side has local, global (map-reduce) and DRIFT search (`query/structured_search/`).
- Failure handling is split. A per-chunk extraction exception is logged and swallowed, returning empty frames (`graph_extractor.py:68-76`). The run as a whole raises if no entities or no relationships came out of the corpus (`index/workflows/extract_graph.py:128,134`). LLM retry is configurable exponential backoff (`packages/graphrag-llm/graphrag_llm/config/retry_config.py`). Calls go through a cache keyed by `cache_key_creator` (`graphrag/cache/cache_key_creator.py`).

### 5. Evidence, citation and provenance
- Every entity, relationship and claim keeps `text_unit_ids`, and text units keep `document_id` (`data_model/covariate.py:30`, `data_model/text_unit.py`). That is a real, joinable chain from graph element to chunk to document.
- Answer citations are produced by the LLM in the format `[Data: Reports (1, 2); Entities (5, 7)]`, taught only through prompt examples (`prompts/query/local_search_system_prompt.py:20-26`). Searching the package Python outside `prompts/` finds no code that checks those ids against the context that was supplied. Citations are therefore not mechanically verified.

### 6. Evaluation and benchmarks shipped
`tests/unit`, `tests/integration`, `tests/verbs`, and `tests/smoke` with three fixtures (`tests/fixtures/{text,min-csv,azure}`). The smoke config asserts artifact names, row-count ranges and per-workflow runtime ceilings (`tests/fixtures/min-csv/config.json`). These are pipeline regression checks, not answer-quality or conflict-quality benchmarks. The repo ships no win-rate or accuracy results; the paper's claims are NOT VERIFIED here.

### 7. Licence and last commit
MIT, "Copyright (c) Microsoft Corporation" (`LICENSE`). Last commit `5faaaf4f5685fa2056fa8c3bf9342cb089f2942f`, 2026-10-08.

### 8. ADOPT and BEAT
- **ADOPT**
  - The `raw_*` snapshot idea: keep pre-merge extractions beside the merged table so any merge can be audited. We should make it mandatory, not opt-in.
  - `filter_orphan_relationships`: reject edges whose endpoints do not resolve, and count what was rejected.
  - Claim schema fields (status, start/end date, source quotes) as the shape of our atomic assertion record.
  - A cache keyed on the full request for deterministic replay (`cache_key_creator`).
  - Seeded clustering plus a no-LLM `fast` path for offline smoke runs.
- **BEAT**
  - Never resolve a contradiction by prompt and discard the loser. Keep both assertions, with their sources, and record the rule that chose the winner.
  - Make entity identity type-aware but not type-fragile (the title/type split loses rows).
  - Make incremental and full builds produce identical aggregates.
  - Verify answer citations against the supplied context mechanically.

### 9. NOT VERIFIED
Query-side code (local, global, DRIFT) beyond prompts and config. The `finalize_entities` row-loss path was derived from reading three functions, not executed. The default `entity_types` list. Community-report quality. Whether `snapshots.raw_graph` defaults on or off (I did not open that default).

---

## 3. LightRAG

### 1. What it is and the problem it solves
A GraphRAG-style indexer and server with dual-level (entity and relation) retrieval, many pluggable storage backends, incremental insert and document deletion with graph rebuild (`README.md`; `lightrag/lightrag.py`; `lightrag/operate.py`). It aims at cheaper incremental updates than GraphRAG.

### 2. Architecture
- Pipeline: chunk, extract entities and relations per chunk, merge by name into the graph, embed entities/relations/chunks into vector stores (`lightrag/operate.py:extract_entities`, `merge_nodes_and_edges`, `_merge_nodes_then_upsert`, `_merge_edges_then_upsert`).
- Four storage kinds behind abstract classes (KV, vector, graph, doc-status) with networkx, Neo4j, Memgraph, Postgres, Mongo, Redis, Milvus, Qdrant, Faiss, OpenSearch and file backends (`lightrag/kg/*_impl.py`, `lightrag/kg/factory.py`).
- Node record: `entity_id, entity_type, description, source_id, file_path, created_at, truncate`. Edge adds `keywords` and `weight` (`operate.py:2429-2780`). `source_id` is a separator-joined chunk id list; a separate chunk-tracking KV keeps the full list (`entity_chunks_storage`).
- Roles are routed per function (`global_config["role_llm_funcs"]["extract"]`, `operate.py:extract_entities`).

### 3. Conflicting, duplicated and incomplete information
- **Identity is the normalised name string.** `normalize_entity_name` cleans HTML, full-width characters and quotes but does not case-fold (`lightrag/utils.py:5833`, `normalize_extracted_info`). Consistency is requested from the model: "Ensure **consistent naming** ... capitalize the first letter of each significant word (title case)" (`lightrag/prompt.py:63,71,72`). `Apple Inc` and `apple inc.` are different nodes unless the model happens to agree with itself.
- **Type conflict: majority vote.** `Counter` over the new and stored types, `sorted(..., reverse=True)[0]`; ties resolve to first-seen (`operate.py:2577`).
- **Description conflict: keep all fragments, summarise only when large.** Exact-duplicate fragments are dropped after sanitising (`operate.py:2384`, `_combine_descriptions_dedup`). Fragments are ordered by `(timestamp, -len(description))`, where `timestamp` is extraction time, not event time (`operate.py:2598`). If fewer than `force_llm_summary_on_merge=8` fragments and under the token budget, they are joined with a separator and no LLM is called, so contradictory sentences sit side by side unresolved (`operate.py:372`, `_handle_entity_relation_summary`; `constants.py:30`). Above the budget the LLM summarises in a map-reduce loop.
- **The summary prompt has the best written conflict policy of the eight:** first decide whether the conflict is two distinct things sharing a name (then summarise separately), otherwise "reconcile them or present both viewpoints with noted uncertainty" (`prompt.py`, `summarize_entity_descriptions`, "Conflict Handling"). It is still a prompt: nothing records that a conflict existed or which side was kept.
- **Corroboration count that survives re-ingest.** Edge weight sums only sources not already stored, so re-feeding a chunk does not inflate it (`operate.py:2956`, "6.2 Finalize weight ..."), then is floored by the evidence count (`operate.py:3000`). Corroboration is counted per chunk, so two chunks of one document count as two independent confirmations.
- **Incomplete:** an entity with no description gets the placeholder `Entity <name>` (`operate.py:2608-2612`). Self-loop relations and empty descriptions are rejected (`operate.py:774`, `_handle_single_relationship_extraction`).
- **Manual merge** exists with per-field strategies `concatenate, keep_first, keep_last, join_unique, join_unique_comma, max` (`lightrag/utils_graph.py:3579`, `_merge_attributes`; `:2703`, `_merge_entities_impl`).

### 4. Agent and LLM roles, loop, bounds, failure handling
- Extract with a gleaning loop (`DEFAULT_MAX_GLEANING = 1`, `constants.py:17`), summarise, extract query keywords (high-level and low-level), answer; optional rerank.
- Bounds are explicit and plentiful: source ids per entity capped at 200 with `KEEP` or `FIFO` overflow (`constants.py:71,78`), file paths capped, `DEFAULT_LLM_TIMEOUT = 240`, `DEFAULT_MAX_ASYNC = 4`. Cooperative cancellation is checked at stage boundaries (`operate.py:3942` onward). vector-store upserts retry three times (`operate.py:_merge_nodes_then_upsert`, `safe_vdb_operation_with_exception(max_retries=3)`).
- A `kg_extraction_validator` hook can reject a chunk's extraction (`operate.py:3983,4388`).
- Truncation is tallied and persisted: `TokenLimitTruncationTally` is stamped into `doc_status.metadata` so "the condition outlives the bounded status ring" (`lightrag/utils.py:5267`; docstring at `operate.py:3942`).

### 5. Evidence, citation and provenance
- Each entity and edge carries chunk ids and file paths; chunk text is stored. Removal of a document rebuilds affected entities from cached extraction results rather than re-calling the LLM (`operate.py:1102`, `rebuild_knowledge_from_chunks`).
- Answer citations are file-level: `generate_reference_list_from_chunks` numbers distinct `file_path`s by frequency (`lightrag/utils.py:7735`), and the prompt asks the LLM to emit a `### References` section (`prompt.py`, `rag_response`). The LLM chooses which reference ids to print; no code validates the final text against the supplied list (I did not find one).
- Evidence lists are capped by design, so for a heavily corroborated entity the stored provenance is a truncated subset.

### 6. Evaluation and benchmarks shipped
`lightrag/evaluation/` holds a RAGAS evaluator (`eval_rag_quality.py`) and an offline lexical retrieval check that calls no model (`offline_retrieval_check.py`). The README says the sample dataset has "3 test questions" and claims "~89-100% RAGAS score per question" (`lightrag/evaluation/README_EVALUASTION_RAGAS.md:22,37`). `sample_dataset.json` actually contains 6 `test_cases` (read with `json`). The questions are about LightRAG itself, scored by an LLM judge. That is a smoke test, not a benchmark. `tests/` has many unit tests (extraction stability, truncation order, chunk tracking, cache orphans).

### 7. Licence and last commit
MIT, "Copyright (c) 2025 LightRAG Team" (`LICENSE`). Last commit `4d0afc1bc36e6a34d4a5895b68efe9413748627a`, 2026-10-12.

### 8. ADOPT and BEAT
- **ADOPT**
  - Idempotent corroboration: count a source once however many times it is replayed (`operate.py:2956`).
  - A chunk-tracking table separate from the truncated display field, so the full evidence list survives caps.
  - Persisting "this was truncated" next to the result (`TokenLimitTruncationTally`).
  - Rebuild-from-cached-extractions on source retraction, so removing a source is cheap and exact.
  - A validator hook on each extraction.
  - The "distinct entities sharing a name vs one entity with discrepancies" distinction in the conflict policy, as a rule in our resolver rather than a prompt.
- **BEAT**
  - Count corroboration per independent source, not per chunk.
  - Use event time, not extraction time, for ordering.
  - Do not invent a fallback description.
  - Resolve identity with a deterministic cascade, not by asking the model to be consistent.
  - Emit machine-checkable citations (chunk id and span), and verify them.

### 9. NOT VERIFIED
Query-time ranking and token budgeting (`kg_query`, `_build_query_context`). Whether the RAGAS numbers reproduce. Storage backends other than networkx and nano-vectordb. The API server and web UI. I read the first half of `_merge_edges_then_upsert` selectively (weight and keywords), not every branch.

---

## 4. nano-graphrag

### 1. What it is and the problem it solves
A compact re-implementation of GraphRAG (about 4.5k lines of Python in `nano_graphrag/`, my `wc`) meant to be readable and hackable (`readme.md`). Same problem as GraphRAG, smaller surface.

### 2. Architecture
- `GraphRAG` dataclass wires chunking, extraction, graph storage (networkx or Neo4j), vector storage (nano-vectordb, hnswlib, others) and a JSON KV store (`nano_graphrag/graphrag.py`, `_storage/`).
- Flow: `ainsert` filters docs and chunks by content hash, drops all community reports, extracts entities, clusters with Leiden (seed `0xDEADBEEF`), regenerates community reports, then commits docs and chunks (`graphrag.py:319,345`; `:86`).
- Optional DSPy-based extractor with a critique-and-refine loop (`nano_graphrag/entity_extraction/module.py`: `CombinedExtraction`, `CritiqueCombinedExtraction`, `RefineCombinedExtraction`).

### 3. Conflicting, duplicated and incomplete information
- **Identity is `clean_str(name.upper())`** (`nano_graphrag/_op.py:_handle_single_entity_extraction`). No fuzzy matching, no type in the key.
- **Descriptions: set-union, sorted, joined; LLM only above `entity_summary_to_max_tokens=500`.** Below the threshold, contradictory descriptions are concatenated and left (`_op.py:111-135`, `:182-228`; `graphrag.py:81`).
- **Above the threshold the input is truncated, not batched:** the joined description is cut with `tokens[:llm_max_tokens]` before summarising (`_op.py:127`), then split on the separator, so text past the cut is silently lost and a description can be cut mid-sentence.
- **Edges are undirected by construction:** `maybe_edges[tuple(sorted(k))]` (`_op.py:389`). "A acquired B" and "B acquired A" collapse into one edge with merged descriptions. Weights are summed, so re-ingesting changes them.
- **Source ids are stored via `set(...)`** then joined, so the order differs between runs (`_op.py:212,258`).
- **Edge endpoints with no entity record are created as `"UNKNOWN"` nodes** carrying the edge's merged description and source ids (`_op.py:267`). That invents entity attributes from edge text.
- **Order of commits risks double counting (by reading):** the graph is updated and persisted in `extract_entities` and `_insert_done` (run in a `finally`), while `full_docs` and `text_chunks` are upserted afterwards (`graphrag.py:319-345`). A failure between them leaves graph weights recorded for chunks the store has not recorded, so a retry re-adds the weight.

### 4. Agent and LLM roles, loop, bounds, failure handling
- Single extractor with gleaning (`entity_extract_max_gleaning=1`, loop stops when the model answers anything but "yes") (`_op.py:extract_entities`; `graphrag.py:80`), a cheap model for summaries and a best model for extraction and reports. Global query is map-reduce over community reports with JSON-parsed "points" (`_op.py:970`).
- Retry: tenacity, five attempts, exponential backoff, only for `RateLimitError` and `APIConnectionError` (`_llm.py:45-48`). No per-chunk error isolation: one failing chunk raises through `asyncio.gather`.

### 5. Evidence, citation and provenance
Entities and edges carry `source_id` (chunk keys); chunks keep their text. Answers do not return citations; local search builds a CSV-like context of entities, relations, reports and text units (`_op.py:844`, `_build_local_query_context`). Provenance exists in storage but is not exposed to the answer.

### 6. Evaluation and benchmarks shipped
`docs/benchmark-en.md` compares index time and prints side-by-side local and global answers for one book (A Christmas Carol) against GraphRAG at a named commit. It reports index time (">5 min" vs "<4 min") and shows prose; no scoring (`docs/benchmark-en.md`). `docs/benchmark-dspy-entity-extraction.md` counts entities from one chunk with and without DSPy (22 vs 37 entities) with no ground truth. A multi-hop RAG notebook exists under `examples/benchmarks/`. Unit tests cover storage, splitting and extraction metrics (`tests/`).

### 7. Licence and last commit
MIT, "Copyright (c) 2024 Gustavo Ye" (`LICENSE`). Last commit `acb35c065614eb5a2f5f1be9a56b235f5a2e0a7a`, 2026-01-27.

### 8. ADOPT and BEAT
- **ADOPT**
  - Small enough to read in an afternoon: the shape of a minimal `ainsert` is a good skeleton for our reconciliation loop.
  - Content-hash document and chunk keys with filter-before-insert for idempotent ingest (`graphrag.py:ainsert`).
  - The critique-then-refine extraction pair with an `entity_recall_metric` (`entity_extraction/module.py`, `metric.py`) as a pattern for extraction QA with a gold set.
- **BEAT**
  - Keep edge direction.
  - Batch long description lists instead of truncating.
  - Never synthesise an "UNKNOWN" entity from edge text.
  - Commit graph and document ledger atomically.
  - Sort every id list so builds are byte-stable.

### 9. NOT VERIFIED
The DSPy module's behaviour (read headers only). Neo4j storage. Any quality claim in the benchmark docs. The double-counting path was derived from reading ordering, not run.

---

## 5. HippoRAG (v2)

### 1. What it is and the problem it solves
A "memory framework" that builds an open-information-extraction graph (phrases and passages), links similar phrases with synonymy edges, and answers by Personalized PageRank seeded from query-matched facts (`README.md`; `src/hipporag/HippoRAG.py`). It targets multi-hop retrieval and continual indexing. It is a retriever, not a reconciler.

### 2. Architecture
- OpenIE in two LLM stages, NER then triple extraction conditioned on the entities (`src/hipporag/prompts/templates/ner.py`, `triple_extraction.py`; `information_extraction/openie_openai.py`).
- Three embedding stores: chunks, entities, facts (`embedding_store.py`), ids are md5 hashes of the content with a namespace prefix (`utils/misc_utils.py:153`, `compute_mdhash_id`; entities and facts are normalised first). The graph (python-igraph) has passage nodes and phrase nodes; edges are fact edges, passage-to-phrase edges and synonymy edges (`HippoRAG.py:1179,1230,1278`).
- Entity normalisation is `casefold`, non-alphanumeric to space, collapse whitespace (`src/hipporag/utils/misc_utils.py:91`, `text_processing`), so `U.S.A.` and `u s a` are the same node and `USA` is not.
- Retrieval: query to fact scores, an LLM "recognition memory" filter reranks facts (`rerank.py:DSPyFilter`), seed phrase weights go into PPR with damping 0.5, passage weight 0.05, 200 results by default (`HippoRAG.py:2177`, `utils/config_utils.py`).

### 3. Conflicting, duplicated and incomplete information
- **No conflict model.** Facts are `(subject, predicate, object)` strings with no polarity, date or confidence. Two sources that disagree simply add two edges.
- **Duplicates: content-hash identity.** Identical chunks collapse; replaced metadata is warned about (`HippoRAG.py:499`, `index`). Identical normalised triples share one fact id (`proc_triples_to_docs` in `delete`).
- **Entity resolution is soft.** `add_synonymy_edges` runs a KNN over entity embeddings and adds an undirected weighted edge when cosine similarity is at least 0.8, top-k 2047, skipping phrases with two or fewer alphanumeric characters (`HippoRAG.py:1278-1352`; defaults `utils/config_utils.py:161,173`). Nothing merges; synonyms only help the walk. The edge weight is the similarity score, not a decision, so "antonym" or "different person, same name" pairs get linked the same way.
- **Retraction is first class and exact.** Each fact edge stores `fact_source_counts` per chunk id; deleting a document subtracts its contribution, recomputes the edge weight as `max(sum(counts), synonym_score)`, and removes edges and nodes that lose all support (`HippoRAG.py:595-710`, `_remove_fact_sources_from_graph`; tests in `tests/test_hipporag_state_consistency.py:109-154`).
- **Incomplete:** if the fact reranker finds nothing or raises, retrieval silently falls back to dense passage retrieval (`HippoRAG.py:763`, logged at info level; `rerank.py:114` just `print`s the exception).

### 4. Agent and LLM roles, loop, bounds, failure handling
- LLM roles: NER, triple extraction, fact reranker, answer generation, optional IRCoT loop bounded by `max_qa_steps` (default 1) (`utils/config_utils.py`; `HippoRAG.py:retrieve_ircot`).
- Failure posture is strict at the storage layer: `StateConsistencyError` on count mismatches, incompatible indexes, deletes without persisted OpenIE provenance (`HippoRAG.py:index`, `delete`). It is lenient at the retrieval layer (fallbacks above).
- **Index manifest.** `_validate_or_create_index_manifest` records schema version, text normalisation id (`unicode_alnum_casefold_v1`), embedding identity, extraction LLM class, OpenIE provenance, synonymy parameters, and refuses to mix incompatible state (`HippoRAG.py:317-345`, `:347-420`). Offline OpenIE with vLLM or transformers is supported (`information_extraction/openie_vllm_offline.py`, `openie_transformers_offline.py`).

### 5. Evidence, citation and provenance
- Retrieval results return `graph_seeds` (the reranked facts that seeded PPR) and `doc_metadata` (`HippoRAG.py:retrieve`, `QuerySolution`), so a retrieved passage can be explained by the fact edges that put it there.
- Chunk-level only. There is no span-level evidence and no claim-to-quote link. The final answer is generated from the top passages with no citation requirement.

### 6. Evaluation and benchmarks shipped
`src/hipporag/evaluation/retrieval_eval.py` computes Recall@k; `qa_eval.py` computes EM/F1. Paper datasets (HotpotQA, MuSiQue, 2Wiki and a sample) ship in `reproduce/dataset/`, plus pre-computed OpenIE outputs for a MuSiQue sample in `outputs/musique/`. `tests/` has 93 test functions across seven files (my grep count of `def test`). The README links paper figures but I found no results table in text; numbers are NOT VERIFIED here.

### 7. Licence and last commit
MIT, "Copyright (c) 2025 OSU Natural Language Processing" (`LICENSE`). Last commit `d5c8329422e0a0b834a15874545cb6a74b4f9b26`, 2026-10-06.

### 8. ADOPT and BEAT
- **ADOPT**
  - Per-source contribution counts on every derived edge, with exact subtraction on retraction (`fact_source_counts`).
  - The index manifest and a hard error on mixed or stale state; this is the cleanest reproducibility mechanism in the set.
  - Returning the seed facts that justified each retrieved item.
  - Two-stage extraction (entities first, triples conditioned on them) to reduce dangling endpoints.
  - Treat "possibly the same" as a link that never merges, as a fallback tier below deterministic identity.
- **BEAT**
  - Add polarity, dates and source authority to the fact record; HippoRAG has none.
  - Make the "possibly same" link carry the evidence that suggested it and require a deterministic check before any merge.
  - Fail loudly (typed status) when the reranker degrades; do not fall back silently.

### 9. NOT VERIFIED
Any accuracy claim from the papers. The IRCoT loop internals. The vector-store back ends other than the default. Offline-mode latency or quality. I did not read `StandardRAG.py`.

---

## 6. Graphiti (Zep)

### 1. What it is and the problem it solves
A framework for temporal knowledge graphs for agents: raw "episodes" are ingested; entities, facts (edges) and summaries are extracted; facts carry validity intervals and are invalidated, not deleted, when later facts contradict them (`README.md`; `graphiti_core/graphiti.py:add_episode`). It is the closest of the eight to our problem.

### 2. Architecture
- Nodes: `EpisodicNode` (raw `content`, `source`, `source_description`, `valid_at` = document time), `EntityNode`, community and saga nodes (`graphiti_core/nodes.py:318`).
- Edge `EntityEdge` is bitemporal: `valid_at`, `invalid_at` (event time), `expired_at`, `created_at` (system time), plus `fact`, `fact_embedding`, `episodes` (ids of episodes that assert it), `reference_time`, typed `attributes` (`graphiti_core/edges.py:263-290`).
- Ingestion order: extract nodes (and edges, optionally combined), resolve nodes, extract edges, resolve edges, extract attributes and summaries, save (`graphiti_core/graphiti.py:1332`; `utils/maintenance/*`).
- Backends: Neo4j required in the base dependencies, Kuzu, FalkorDB, Neptune via extras (`pyproject.toml`). Retrieval is hybrid: BM25, cosine, graph traversal, with RRF/MMR/cross-encoder rerankers (`graphiti_core/search/search_config_recipes.py`).

### 3. Conflicting, duplicated and incomplete information
- **Entities: a deterministic cascade, LLM last.**
  1. Configured identity properties, exact match (`utils/maintenance/dedup_helpers.py:259`, `_resolve_with_identity_properties`).
  2. Normalised exact name; one hit resolves, several hits escalate to the LLM (`dedup_helpers.py:321`, `_resolve_with_similarity`).
  3. Fuzzy MinHash/LSH over 3-gram shingles with Jaccard threshold 0.9, only for names that pass a Shannon-entropy and length gate (`dedup_helpers.py:31-34,80-86`).
  4. Everything left goes to an LLM dedupe prompt; malformed or out-of-range answers are logged and treated as "no duplicate" (`utils/maintenance/node_operations.py:649,804`).
- **Weakness in the cascade (my arithmetic, not their code run):** recomputing the 3-gram Jaccard formula on de-spaced lowercase names gives 0.92 for "Acme Holdings Limited Series A" vs "...Series B" and 0.895 for "Fund Alpha Partners Fund 1" vs "...Fund 2". The first exceeds the 0.9 merge threshold. Whether LSH banding would retrieve the pair was not tested. A single exact-name candidate also merges with no type or attribute guard unless `identity_properties` are configured.
- **Facts: duplicates and contradictions are separate judgements by one LLM call.** `_dedupe_extracted_edge` first takes a fast path for the same endpoints plus the same normalised fact text, otherwise sends "existing facts" (same endpoint pair) and "invalidation candidates" (a broader hybrid search, default limit 10) to the prompt, which returns `duplicate_facts` and `contradicted_facts` index lists (`edge_operations.py:864-1085`; `search/search_config.py:29`). The prompt is conservative: "NEVER mark facts as contradicted unless the new fact explicitly makes the old fact false", with explicit exclusions for status updates versus ownership (`prompts/dedupe_edges.py:49-90`). Indices outside the supplied range are logged and dropped (`edge_operations.py:1020`).
- **Resolution of a contradiction is mechanical, from dates.** `_apply_temporal_invalidation` and `resolve_edge_contradictions` compare `valid_at` / `invalid_at`: if an older contradicted edge started before the new one, set its `invalid_at` to the new edge's `valid_at` and its `expired_at` to now; if a candidate starts later, expire the new edge instead; non-overlapping intervals are skipped (`edge_operations.py:715-783`). Nothing is deleted, and late-arriving older facts are handled because either side can be the one invalidated.
- **Gap: unknown dates mean no resolution.** Every branch of `resolve_edge_contradictions` requires non-null `valid_at` on both edges. If the LLM flagged a contradiction but a date is missing, neither edge is invalidated and both stay current. No "unresolved conflict" state is recorded (by reading, `edge_operations.py:748-783`).
- **Temporal extraction is guarded:** future-tense statements ("will", "plans to") get `valid_at` = reference time, and deadline words ("by Friday") never become `invalid_at` (`utils/maintenance/temporal_edge_utils.py:39`, `normalize_future_temporal_bounds`, regex-based). Failures to extract timestamps are logged and skipped (`edge_operations.py:786`).
- **No source authority.** Winner is decided by event date only. Which episode is more reliable is not modelled; the only per-edge source link is the `episodes` list.

### 4. Agent and LLM roles, loop, bounds, failure handling
- LLM roles: node extraction, edge extraction (or combined), node dedupe, edge resolve (duplicate and contradiction), timestamps, attributes, summaries; small-model routing for the narrow ones (`model_size=ModelSize.small`).
- No reflexion loop in the current code (grep for `reflexion` is empty). Concurrency is bounded by `semaphore_gather`. Client retry: tenacity, four attempts, random exponential wait, only for server or retryable errors (`llm_client/client.py:121`).
- LLM index answers are always validated against the lists that were sent (edges and nodes), which is the right trust boundary.

### 5. Evidence, citation and provenance
- Every edge lists the episode ids that asserted it (`episodes`), and each `EpisodicNode` stores the raw content and a `source_description`. That is document-level provenance with the original text retained. When an LLM-judged duplicate appends an episode, it does not check for repeats (`edge_operations.py:1011`; the verbatim fast path at `:940` does).
- There is no quote or span on the edge, and no check that `fact` is entailed by the episode. Evidence is retrievable but not mechanically verifiable beyond "this episode produced this edge".
- Point-in-time queries are possible because `valid_at`, `invalid_at`, `created_at`, `expired_at` are all filterable (`search/search_filters.py:62-65`). I did not find a single "as of" convenience call; NOT VERIFIED.

### 6. Evaluation and benchmarks shipped
`tests/evals/` has an end-to-end graph-building evaluation over a LongMemEval oracle file, using an LLM judge (`prompts/eval.py`) to decide whether a candidate extraction is worse than a baseline (`tests/evals/eval_e2e_graph_building.py`, `data/longmemeval_data/`). Unit and mock tests exist for drivers, prompts and sagas. The README's performance statements are from the paper and are NOT VERIFIED here. There is no benchmark of contradiction or invalidation correctness in what I read.

### 7. Licence and last commit
Apache-2.0 (`LICENSE`; contributor licence agreement in `Zep-CLA.md`). Last commit `2f0fb35b749f1ff17377892e099882176e453393`, 2026-10-13.

### 8. ADOPT and BEAT
- **ADOPT**
  - The bitemporal edge shape: event-time validity interval plus system-time expiry, never delete, supersede.
  - Contradiction resolution as a pure function of dates, separate from the model that proposes the contradiction.
  - Out-of-order ingestion handled symmetrically (the new fact can be the one expired).
  - The identity cascade and the rule that model output is validated against the exact candidate list it was shown.
  - Future-tense and deadline guards on temporal bounds.
  - A conservative contradiction prompt that excludes status updates from ownership facts.
- **BEAT**
  - Record an explicit `unresolved` conflict when dates are missing or equal; do not leave two "current" facts silently.
  - Add source authority and corroboration as inputs to the winner rule, with the rule written down and replayable.
  - Store quote and offset on every fact and verify entailment by span match.
  - Fuzzy merge guarded by type and by attribute disagreement (series letters, numerals, jurisdictions).
  - Contradiction candidates by key (same subject and relation) rather than top-10 semantic search, so a conflict outside the top 10 is not missed.

### 9. NOT VERIFIED
Search/rerank quality. Whether the LSH banding retrieves the near-miss pairs above. Behaviour of the combined-extraction path. Community and saga nodes. Neo4j-specific query details. The paper's accuracy and latency claims.

---

## 7. Cognee

### 1. What it is and the problem it solves
A memory platform: `add` registers data, `cognify` turns it into a knowledge graph plus vectors plus summaries, and several retrievers answer from them. It has a large surface (permissions, sessions, feedback, eval harness) beyond the graph (`README.md`; `cognee/api/v1/cognify/cognify.py:get_default_tasks`).

### 2. Architecture
- Default task chain: classify documents, chunk, LLM graph extraction and summary, `add_data_points`; opt-in tail tasks for provenance, contradiction detection and temporal supersession (`cognee/api/v1/cognify/cognify.py:575-650`).
- Entity id is a deterministic `uuid5` of the lower-cased name with spaces to underscores and apostrophes removed (`cognee/infrastructure/engine/utils/generate_node_id.py:1-5`); `Entity` declares `identity_fields: ["name"]` (`cognee/modules/engine/models/Entity.py:21`). Type is not part of identity, so a company and a fruit both named "Apple" share one node.
- Default stores: Ladybug embedded graph (a Kuzu successor), LanceDB vectors, SQLite relational (`infrastructure/databases/graph/config.py:47`, `vector/config.py:32`). Core install pins 55 direct dependencies (`pyproject.toml`, my count) and about 214k lines of Python in `cognee/` (my `wc`).
- Node writes are `MERGE ... ON MATCH SET n.name, n.type, n.properties = new`: last write wins for all properties (`infrastructure/databases/graph/ladybug/adapter.py:1230`). Edge identity is `(source, target, relationship_name)` with last-write-wins properties (`ladybug/adapter.py:1051`).

### 3. Conflicting, duplicated and incomplete information
- **Duplicates:** name-derived ids merge repeated mentions across documents and runs. Optionally, ontology matching snaps names to ontology classes with `difflib` at cutoff 0.8 (`cognee/modules/ontology/matching_strategies.py:21-24`).
- **Opt-in LLM contradiction detection** (`contradiction_detection: bool = False`, `cognee/modules/cognify/config.py:24`). It gathers facts one hop from entities touched by this run, renders them as `[F#] subject relation object` with no source, date or provenance, asks the LLM for contradicting pairs with a confidence, drops those under a threshold, and writes a `contradicts` edge between the two subjects (or objects) carrying both fact strings, a reason and a confidence (`cognee/tasks/graph/detect_contradictions.py:75-235`). Properties of this design:
  - non-destructive; the input is returned unchanged;
  - capped at `contradiction_max_facts`, later facts are silently left out (logged at info, `:115`);
  - ids the model invents are ignored (`:196`);
  - the whole task swallows its own exceptions (`:237`), so a failed check looks the same as no contradictions;
  - the `contradicts` edge points at entities and holds fact text, not the two fact-edge ids, so it is not a join key back to the evidence.
- **Opt-in temporal supersession for declared single-valued relations only.** The caller names `functional_relationships` (for example `ceo_of`); for each source holding more than one distinct target, the edge with the greatest `(updated_at, position)` wins and older ones get `superseded=True`, `superseded_by`, `supersession_reason`; nothing is deleted (`cognee/modules/graph/utils/temporal_conflict_resolver.py:29-90`; `tasks/graph/resolve_temporal_contradictions.py:55-113`; wired at `cognify.py:642`). The module states why: relations carry no cardinality metadata, "so which ones hold a single target cannot be inferred — only declared".
- **The recency key is ingestion time, not event time.** `updated_at` is stamped on every edge and "refreshed each time the fact is re-asserted" (`temporal_conflict_resolver.py:32-36`). Re-ingesting an old document would make its claim the newest. Ties go to the later position.
- **Incomplete:** a node the LLM types "Timestamp" that does not parse stays an ordinary entity (`modules/graph/utils/expand_with_nodes_and_edges.py:_get_or_create_timestamp`).
- Note on naming: `modules/truth_subspace` (header of `build.py`, `align.py`) builds centroid coordinates from session "learnings" to rerank chunks. From the files I read it is a relevance feedback reranker, not a factuality check.

### 4. Agent and LLM roles, loop, bounds, failure handling
- LLM roles: graph extraction with structured output, summarisation, optional contradiction judge, plus many retrieval and session modules. Pipelines run in batches (`chunks_per_batch`, default 2000).
- Failure handling at run level is serious: failed or abandoned cognify runs roll back the partial graph and vector writes (`cognee/modules/cognify/rollback.py:127`, `recovery.py`). Advisory tasks (contradiction, supersession, provenance) are designed never to fail the run and swallow errors.

### 5. Evidence, citation and provenance
- **Edge evidence, on by default:** `edge_evidence_enabled: bool = True` (`modules/provenance/edge_evidence/config.py:16`) writes a many-to-many table linking each graph edge id to the chunk, data item, dataset and pipeline run that produced it, with `evidence_kind` and `confidence` columns (`edge_evidence/models.py:17`). Coverage is "deliberately narrow": only edges produced from document chunks during cognify; contradiction edges and enrichment record nothing (`edge_evidence/capture.py:54`).
- **Hash-chained ledger, opt-in:** `provenance_tracking: bool = False` (`modules/cognify/config.py:29`). Entries are W3C PROV-flavoured with `source_document`, `source_location`, `source_quote`, `valid_from`, `valid_until`, `supersedes`, invalidation tombstone, `credibility`, `checksum` and `previous_checksum`. The checksum is SHA-256 over canonical JSON of every field with a unit-separator join; the chain links each entry to its predecessor (`modules/provenance/models/ProvenanceEntry.py`, `integrity.py:36-125`, `compute_checksum`, `verify_checksum`).
- **The audit-grade fields are mostly unpopulated.** `record_provenance` sets `start_index=chunk_index` (`tasks/provenance/record_provenance.py:219`) but no code outside tests, migrations and the model plumbs a value into `source_quote` or `credibility`: `source_quote` appears only in the entry model, hashed-field list and manager pass-through; `credibility` only in the model, migration and pass-through (grep). The chain proves the ledger was not edited; it does not prove a fact is in a quote.

### 6. Evaluation and benchmarks shipped
`cognee/eval_framework/` is a one-command harness (corpus building, answer generation, evaluation, dashboard) with DeepEval and direct-LLM engines (`eval_framework/README.md`). `eval_framework/beam/REPORT.md` is an unusually candid report on the BEAM memory benchmark: 0.79 on a 100K run over a single held-out conversation, 0.67 at 10M with retrieval settings tuned on the scored questions, "we therefore treat the result as exploratory" (`REPORT.md:11`). Its per-ability table has two questions per ability: contradiction resolution 0.875, temporal reasoning 0.500 (`REPORT.md:250,254`). Those are the repo's own numbers; I did not rerun them and two questions per ability is not a sample.

### 7. Licence and last commit
Apache-2.0 (`LICENSE`; `NOTICE.md` names Topoteretes UG). Last commit `0ec7a9fa61c9ff04bf7e02e0d57af363a993a5e1`, 2026-10-08.

### 8. ADOPT and BEAT
- **ADOPT**
  - **Declare cardinality per relation** and let a deterministic function decide which values conflict. This is the right rule-plus-memory interface for T3.
  - Hash-chained, canonical-JSON ledger entries so tampering is detectable (`integrity.py`).
  - Edge-to-chunk evidence as a separate append-only table, never consulted by graph deletion.
  - Rollback of partial writes on a failed run.
  - Tombstone fields (`invalidated`, `invalidated_by`, `supersedes`).
- **BEAT**
  - Event time instead of ingestion time for supersession.
  - Make the `contradicts` record reference the two edge ids (a join key), not strings.
  - Surface a failed contradiction pass as a failed check, never as "none found".
  - Populate and verify `source_quote` and offsets (the ledger has the field and nothing fills it).
  - Include type in entity identity or require disambiguation.
  - Turn on by default what an auditor needs; here the ledger and the contradiction pass are off.

### 9. NOT VERIFIED
Retrievers and what a search result returns by way of evidence. The session, memify and improve modules. Ontology resolver beyond the matching strategy. Multi-tenant permission behaviour. Whether LLM extraction rejects hallucinated edges. Which description wins on a re-mention beyond the `ON MATCH SET` overwrite I read. The BEAT scores beyond the report's own text.

---

## 8. ReConcile

### 1. What it is and the problem it solves
A research prototype for a round-table among three different LLMs (Claude, ChatGPT, Bard/PaLM). Each answers with reasoning and a confidence; disagreeing agents see the others' reasoning and answer again for a fixed number of rounds; the final answer is a confidence-weighted vote (`README.md`; `run.py`; arXiv 2309.13007 per the README). It targets reasoning accuracy on four QA sets, not data reconciliation, but it is the only consensus protocol in the set.

### 2. Architecture
About 1.0k lines. `run.py` generates round 0 answers, evaluates, then for rounds 1..`--round` (default 2) calls each model's debate function. `utils.py` builds prompts, parses JSON, computes votes. `generation.py` wraps three model clients. `claude.py` is a client that drives claude.ai with browser cookies (`claude.py:1-40`, headers copied from a web session). Datasets and "convincing samples" are JSON files per dataset (`dataset/`, `convincing/`).

### 3. Conflicting, duplicated and incomplete information
- **Consensus rule (`utils.py:parse_output`, `trans_confidence`):** confidence is bucketed: at most 0.6 to 0.1; (0.6, 0.8) to 0.3; [0.8, 0.9) to 0.5; [0.9, 1) to 0.8; exactly 1 to 1. Answers are scored by the sum of bucketed confidences (plus `1e-5` on first sight as a tiebreak) and the highest wins (`weighted_max`); a plain majority (`majority_ans`) is also computed. A tie goes to whichever agent was inserted first (Claude, then GPT, then Bard).
- **Debate only on disagreement.** `debate_prompt` is built only when the three answers are not unanimous; it states "There are k agents think the answer is X" and appends each agent's reasoning grouped by answer (`utils.py:parse_output`, the `Counter(...).most_common(2)` block). Unanimous items skip the next round (`generation.py:claude_debate`, `gpt_debate`, `bard_debate` check `len(s['debate_prompt'+r])`).
- **Convincing samples:** each model is shown in-context examples where another model's explanation corrected a wrong answer (`convincing/*.json`, used by `utils.py:prepare_context`). The files also hold `prediction_pre`, `prediction_post` and `utility`, which the code I read never reads.
- **Defects, all by reading:**
  - Failed or unparsable generations are replaced by random answers: `invalid_result` and `clean_output` call `np.random.choice([...])` with confidence 0.0 (`utils.py:106-123,194-230`), and 0.0 still maps to a 0.1 vote weight. The seed set is `random.seed(1234)`, which does not seed numpy, so runs are not reproducible.
  - `trans_confidence` returns `None` for any value above 1 (for example 95 given as a percentage without `%`), which makes `None + 1e-5` raise in `parse_output`.
  - In `ClaudeModel.claude_debate`, when a sample raises `ValueError` the `except` branch assigns the fallback, then the code after it assigns `result`, which still holds the previous sample's answer (`generation.py:90-113`).
  - Rate-limit handling is an interactive `input()` prompt (`run.py:58-60`).

### 4. Agent and LLM roles, loop, bounds, failure handling
Three heterogeneous agents, same prompt template, fixed rounds (`--round`, default 2), `backoff` with 3 to 5 tries per call (`generation.py`). The loop is bounded by construction. Failure handling is random imputation, which is the opposite of what a reconciliation product needs.

### 5. Evidence, citation and provenance
None. Reasoning text is carried between agents and discarded at the end. No sources, no citations.

### 6. Evaluation and benchmarks shipped
Accuracy per model, majority and weighted vote after each round on StrategyQA, GSM8K, ECQA and AQuA via `evaluate_all` (`utils.py:247`). No result files are shipped (no pickle outputs in the clone) and the README states no numbers. The paper's gains are NOT VERIFIED here.

### 7. Licence and last commit
MIT, "Copyright (c) 2023 Justin Chih-Yao Chen" (`LICENSE`). Last commit `902ae913cbb39cfbe0cbd73d0638989bde2d3cad`, 2023-09-26. The Claude client scrapes a claude.ai web session with cookies and the Bard path calls `palm.chat` from the PaLM-era SDK (`claude.py`, `generation.py`); I did not test whether either still works, so the code as shipped cannot be assumed to run.

### 8. ADOPT and BEAT
- **ADOPT**
  - Confidence discretisation into a small fixed table (a monotone, inspectable mapping), rather than raw model confidences.
  - Debate (re-query) only where agents disagree; unanimous items cost nothing.
  - Groups of reasoning shown by answer, with counts.
  - Bounded rounds.
  - For us, the "agents" would be independent evidence sources or independent extractors, not LLMs voting on truth.
- **BEAT**
  - Abstain when generation fails; never impute a random answer.
  - Break ties by an explicit, recorded rule (source authority, then recency), not insertion order.
  - Calibrate the confidence buckets against outcomes instead of using hand-set cut points.
  - Attach evidence to every vote.

### 9. NOT VERIFIED
All paper results. Whether any model client still works. Behaviour with the `intervene` flag, which injects the gold explanation (`utils.py:prepare_context`); it looks like an oracle ablation but I did not trace its use.

---

# Synthesis for our product

## Comparison

| Repo | Conflict handling | Temporal reasoning | Provenance | Determinism and offline run | Weight and footprint |
|---|---|---|---|---|---|
| `storm` | None. Merge by URL string; dead reliability filter | None | Citation to URL with merged snippets; off-by-one bound check | LLM and web search required; local MiniLM only for section retrieval; `set()` ordering | 10.4k lines, 12 direct deps, no tests |
| `graphrag` | LLM prose merge of descriptions, loser discarded; claims with status (off by default) not compared | Claim start/end dates only (opt-in); none on entities or edges | `text_unit_ids` on every element; optional raw snapshot; `[Data:]` citations unverified | Seeded Leiden, request-keyed cache, `fast` indexing without LLM extraction; reports still need an LLM | 37.7k lines in 8 packages, 25 direct deps in core |
| `LightRAG` | Name-keyed merge; majority type; fragments kept or LLM-summarised with an explicit conflict prompt; no conflict record | Ordering by extraction time only | Chunk id lists (capped at 200), file-level references; truncation tally persisted | Response cache, rebuild-from-cache, offline lexical retrieval check; LLM needed to index | 166k lines, 19 direct deps, many backends |
| `nano-graphrag` | Set-union, concatenate; LLM above 500 tokens with truncation; undirected edges | None | Chunk ids per element, not exposed in answers | Seeded Leiden, LLM cache; unsorted id sets | 4.5k lines, 12 deps |
| `HippoRAG` | None; soft synonym edges at cosine 0.8 never merge | None | Per-edge `fact_source_counts`, exact retraction, seed facts returned; index manifest | Content-hash ids, manifest refuses stale state, offline OpenIE supported | 9.5k lines, heavy ML pins (torch 2.5.1) |
| `graphiti` | LLM proposes duplicates and contradictions; resolution is a pure function of dates; deterministic entity cascade | Full bitemporal edges, as-of filters, future-tense guards | `episodes` per edge, raw episodes stored; no span | LLM, embedder and graph database all required; no offline mode seen | 39.9k lines, 7 direct deps plus a graph database |
| `cognee` | Opt-in LLM contradiction edges; opt-in supersession for declared single-valued relations by ingestion time; last-write-wins merge | Ingestion time only | Edge-to-chunk evidence (on); hash-chained PROV ledger (off); `source_quote` unfilled | Embedded defaults (Ladybug, LanceDB, SQLite) but LLM required; deterministic ids | 214k lines, 55 direct deps |
| `ReConcile` | Confidence-weighted vote among 3 LLMs, debate only on disagreement; random imputation on failure | None | None | Unseeded random fallbacks; depends on scraped web clients | 1.0k lines |

Cross-cutting findings:
- **No repo weighs source authority.** The three that decide a winner use recency (graphiti by event date, cognee by ingestion time, LightRAG's ordering by extraction time) or LLM prose (graphrag, LightRAG). Cognee has a `credibility` column nothing fills; STORM has a reliability filter nothing calls.
- **No repo records an unresolved conflict as a first-class state.** Graphiti leaves two current facts when dates are missing; cognee's `contradicts` edge is advisory and its failure is silent.
- **No repo verifies citations mechanically.** All stop at chunk, file or URL granularity, and the answer-time citations in GraphRAG, LightRAG and STORM are LLM-written and unchecked.
- **Rules are absent.** Cognee's declared `functional_relationships` is the only place a schema rule decides a conflict. T3 has no prior art in this set beyond that.

## The eight strongest design decisions to take, ranked

1. **Bitemporal fact records; supersede, never delete; the winner is a pure function of recorded dates and rules.** Keep event time (`valid_at`, `invalid_at`) apart from system time (`created_at`, `expired_at`). Evidence: `graphiti_core/edges.py:263-290`, `utils/maintenance/edge_operations.py:715-783`; counter-example to avoid: cognee ranks by ingestion `updated_at` (`modules/graph/utils/temporal_conflict_resolver.py:29-37`). Our addition: a third state, `unresolved`, whenever dates are missing, equal or overlapping, which neither repo has.

2. **Declare per-relation cardinality and let a deterministic check define what a conflict is; the LLM may only propose candidates, validated against the exact list it was shown.** Evidence: cognee `functional_relationships` (`tasks/graph/resolve_temporal_contradictions.py`, `cognify.py:642`); graphiti validates every returned index against the sent ranges (`edge_operations.py:1020`, `node_operations.py:804`); conservative contradiction prompt (`prompts/dedupe_edges.py:49-90`). This is the interface between T1 and T3.

3. **Entity resolution as a tiered cascade, deterministic first, model last, and failure means "do not merge".** Identity attributes, then normalised exact, then fuzzy with an entropy gate, then LLM for the residue; add a "possibly same" link that never merges. Evidence: graphiti `utils/maintenance/dedup_helpers.py:259,321` and `node_operations.py:649,804`; HippoRAG `HippoRAG.py:1278` for the non-merging link. Guard the fuzzy tier with type and with disagreeing discriminators (my recomputation above shows a 0.92 score for "Series A" vs "Series B").

4. **Every derived assertion carries per-source support counts, counted idempotently and independently by source, and retraction subtracts exactly.** Evidence: HippoRAG `fact_source_counts` and `_remove_fact_sources_from_graph` (`HippoRAG.py:684`); LightRAG idempotent weight (`operate.py:2956`) and `rebuild_knowledge_from_chunks` (`:1102`); cognee `ProvenanceEdgeEvidence` (`edge_evidence/models.py:17`). Fix on the way: LightRAG counts chunks, we count independent sources.

5. **Tamper-evident evidence ledger with quote and offset, verified at explanation time.** Adopt cognee's canonical-JSON SHA-256 chain (`modules/provenance/integrity.py:36-125`), then do what no repo does: fill `source_quote` and offsets for every fact and re-check by substring or offset match against the stored source text whenever an explanation is rendered. Cognee's quote field is never populated; GraphRAG/LightRAG/STORM citations are unchecked LLM text.

6. **Reproducibility identity for the whole store, with a hard error on stale or mixed state.** Evidence: HippoRAG `_validate_or_create_index_manifest` and `StateConsistencyError` (`HippoRAG.py:317-420`); content-hash document and chunk keys (nano-graphrag `graphrag.py:ainsert`); request-keyed LLM cache for replay (graphrag `cache/cache_key_creator.py`); seeded clustering. Sort every id list (nano-graphrag's `set()` joins make output order vary).

7. **Keep both sides of a disagreement as data, with the rule that chose between them, and keep the raw pre-merge extractions.** GraphRAG's one-line "resolve the contradictions" prompt and nano-graphrag's truncating summary lose information; LightRAG's conflict policy text ("distinct entities sharing a name, or present both viewpoints") is the right taxonomy but it is not recorded. Evidence: `graphrag/index/workflows/extract_graph.py:140` (raw snapshot), `prompts/index/summarize_descriptions.py:10`, `LightRAG/lightrag/prompt.py` ("Conflict Handling"), `graphiti` non-destructive invalidation. We should write the taxonomy as code: same-name-different-entity, update over time, disagreement between sources, extraction error.

8. **Consensus with bounded, targeted debate and an explicit abstain.** Use a fixed, inspectable confidence-to-weight table and re-query only where sources disagree; never impute on failure. Evidence: ReConcile `utils.py:trans_confidence`, `parse_output` and the `debate_prompt` gate; its random imputation (`invalid_result`, `clean_output`) is the thing to avoid. Where weights tie, apply a recorded tie-break (authority, then recency), not insertion order.

Runner-up ideas worth keeping in the backlog: persist truncation and degradation tallies next to results (LightRAG `TokenLimitTruncationTally`); roll back partial writes on a failed run (cognee `rollback.py`); a validator hook per extraction (LightRAG `kg_extraction_validator`); future-tense and deadline guards on temporal bounds (graphiti `temporal_edge_utils.py:39`).

## What this teardown did not cover

- No code was executed; every behavioural claim is from reading. The few numbers I produced myself (Jaccard scores, the AST count of STORM's blocklists, line and dependency counts) are arithmetic on file contents, not runs of their code.
- Query and answer generation paths were read only where they touch evidence (GraphRAG, LightRAG, nano-graphrag, Cognee retrievers are largely unread).
- Paper claims and README performance statements for all eight are NOT VERIFIED.
- Also not read: STORM/LightRAG front ends, Graphiti MCP and server packages, Cognee's cloud and frontend code, vector-store and graph-database adapters other than the defaults named.
- Two sibling clones in the same folder (`haystack`, `llama_index`) are outside this assignment.
