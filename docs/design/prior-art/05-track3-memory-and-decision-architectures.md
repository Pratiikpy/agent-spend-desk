# Prior-art teardown 05: memory and decision architectures (Track 3, Reasoning Architecture)

Date of review: 2026-10-13. Scope: the nine clones under `research/track-3-reasoning-architecture/`.
All paths below are relative to that folder unless they start with `docs/`.

## How this was done, and what it does not cover

- Method: static reading of source, prompts, tests and docs. **No third-party code was run, installed or modified.**
  Every behavioural claim marked "read" comes from reading code, not from executing it.
  Claims marked **NOT VERIFIED** need execution or a source that is not in the clone.
- Read in depth: `mem0/mem0/memory/main.py` (sync path), `mem0/mem0/utils/scoring.py`, `mem0/mem0/configs/prompts.py`,
  `mem0/mem0/memory/storage.py`; `langmem/src/langmem/{knowledge,reflection.py,prompts}`; all of `A-mem/agentic_memory/`;
  `generative_agents/reverie/backend_server/persona/{cognitive_modules/{retrieve,reflect,perceive}.py,memory_structures/{associative_memory,scratch}.py}` and the `persona.py` decision cycle;
  `reflexion/{alfworld_runs,hotpotqa_runs/agents.py,programming_runs/reflexion.py}`; `tree-of-thought-llm/{run.py,src/tot}`;
  the `Agent_Memory_Techniques` READMEs for techniques 09, 11, 14, 16, 18, 19, 26, 28, 30 plus `docs/architecture.md` and `docs/roadmap.md`.
- **Not read or not covered:** mem0 `server/`, `mem0-ts/`, `cli/`, `integrations/`, vector-store and reranker adapters, and the async twin of every mem0 method (assumed to mirror the sync path, not diffed);
  `generative_agents/.../plan.py` beyond the decision functions, `converse.py`, the front-end; `reflexion/webshop_runs`; the ToT text and crossword prompts;
  all notebook code in `Agent_Memory_Techniques` except two cells; every paper PDF (none are in the clones, so paper numbers are not verified here).
- **Letta: the clone contains no source code.** See section 1. Nothing about Letta internals below is verified from code.

---

## 0. Summary table

| Repo | Licence (file in clone) | Commit | One-line verdict |
|---|---|---|---|
| `letta` | Apache-2.0 (`letta/LICENSE`) | `5bcdd177d70fa2b31a754cfcd801e77b2e1ab16a` (2026-09-10) | Landing page only. Source retired; repo instructions forbid using it for comparison or copying. Concept-level reference only. |
| `mem0` | Apache-2.0 (`mem0/LICENSE`) | `d26ba5e4518cef7fff3c66d4f715b21adf9feabe` (2026-10-12) | Best-engineered write/read path in the set. ADD-only, hybrid retrieval. Contradiction handling is delegated to the LLM and, in this OSS code, partly dropped. |
| `langmem` | MIT (`langmem/LICENSE`) | `48e3c11f5bb527282c7d5339c6a87a0b35abccfc` (2026-10-02) | Cleanest taxonomy (semantic / episodic / procedural) and a bounded LLM consolidation loop. LLM can delete memories with no audit trail; docs promise ranking features the code does not have. |
| `A-mem` | MIT (`A-mem/LICENSE`) | `ceffb860f0712bbae97b184d440df62bc910ca8d` (2025-12-12) | Zettelkasten-style linking idea is good. The implementation in this clone has defects that stop the headline features working. |
| `generative_agents` | Apache-2.0 (`generative_agents/LICENSE`) | `fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4` (2023-08-11) | The canonical retrieval score and importance-triggered reflection with evidence pointers. Several code-level problems (recency, junk fallbacks, no forgetting). |
| `Agent_Memory_Techniques` | Apache-2.0 (`Agent_Memory_Techniques/LICENSE`) | `4767c0341ccd8b714147334c5f17c26ff99d8e41` (2026-09-21) | Teaching cookbook, not a library. Useful as a taxonomy and a list of failure modes; its own roadmap lists memory security as unbuilt. |
| `awesome-language-agents` | **No LICENSE file in the clone.** README badge says MIT. Treat as NOT VERIFIED. | `fad302ff4c2d7bab66d4d60e019be853fa80aaa3` (2025-01-16) | The CoALA framework summary. Use as the vocabulary for our architecture. |
| `reflexion` | MIT (`reflexion/LICENSE`) | `218cf0ef1df84b05ce379dd4a8e47f17766733a0` (2025-01-13) | Simple, bounded verbal-feedback loop. Every variant leans on a reliable success signal. |
| `tree-of-thought-llm` | MIT (`tree-of-thought-llm/LICENSE`) | `8050e67d0e3a0fddc424d7fa5801538722a4c4cc` (2025-01-16) | Propose / evaluate / select search with hard depth and breadth bounds. Value function is ad hoc. |

---

## 1. Letta (formerly MemGPT)

**1. What it is.** The clone (`letta/README.md`) is a landing page. Current source lives in a different repository (`letta-ai/letta-code`), and the retired V1 server is on an `archive` branch that is **not present** in this clone (`git branch -a` shows only `main`). `letta/AGENTS.md` states the archived code must not be used "for benchmarks, evaluations, experiments", "comparisons with other agent or memory systems", or "copying an old implementation into another project", and says not to infer current Letta behaviour from this repository. We follow that. We did not fetch the archive branch.

**2. Memory architecture.** NOT VERIFIED from code. Concept-level facts only, from two secondary sources in the clones:
`letta/CITATION.cff` cites the MemGPT paper (arXiv:2310.08560), and `Agent_Memory_Techniques/all_techniques/26_letta_memgpt_patterns/README.md` (a third-party cookbook, which builds a from-scratch imitation, not Letta) describes three tiers: core memory (always in the prompt, persona and human blocks, edited by the agent through `core_memory_replace` / `core_memory_append`), recall memory (full conversation history, searchable), archival memory (vector store). The agent loop uses an inner monologue, tool calls, and a `request_heartbeat` flag to chain steps, plus a "memory pressure" signal when context fills. Write triggers, dedupe, conflict handling and ranking in current Letta: NOT VERIFIED.

**3. Memory and decisions.** Not verifiable here. The cookbook claims inner monologue "exposes every memory decision" (README 26, "When to Use"), which is an explainability claim about the agent's own narration, not a record of precedent or rule use.

**4. Reflection.** None identified in the clone.

**5. Safety.** The only primary-source safety content is process policy: `letta/SECURITY.md`, `letta/AI_POLICY.md` (AI disclosure, human-in-the-loop for contributions). Nothing about memory poisoning. The cookbook's own limitation list: "LLMs sometimes forget to update core memory, make incorrect replacements, or over-archive" and the fixed core budget means a bad edit can evict an important fact (README 26, FAQ).

**6. Evaluation.** None in the clone.

**7. Licence and commit.** Apache-2.0; `5bcdd177d70fa2b31a754cfcd801e77b2e1ab16a`. The licence of the current `letta-code` project is NOT VERIFIED.

**8. ADOPT / BEAT.**
- ADOPT (concept): a small always-in-context block for the facts that must never be missed. For us this is the active policy summary and the current task state, edited only by the system, not by the model.
- ADOPT (concept): heartbeat-style chaining, but with a hard step cap enforced in code.
- BEAT: self-editing core memory is the opposite of what a decision agent should do. Letta's pattern lets the model rewrite what it believes. We do not.

**9. NOT VERIFIED.** Everything about current Letta internals, its eviction policy, its conflict handling, its safety model, and whether the cookbook's description matches the product.

---

## 2. mem0

**1. What it is.** A memory layer SDK and self-hostable server for assistants (`mem0/README.md`). The OSS class is `Memory` in `mem0/mem0/memory/main.py` (3,912 lines, sync and async twins). The README advertises a "New Memory Algorithm (April 2026)": single-pass ADD-only extraction, entity linking, multi-signal retrieval. It says the headline benchmark scores "reflect Mem0's managed platform, which includes proprietary optimizations not available in the open-source SDK".

**2. Memory architecture.**
- Tiers: one vector collection of facts per scope (`user_id` / `agent_id` / `run_id`); a separate entity collection (`entity_store`) linking entity text to memory ids; a SQLite `history` table (`id, memory_id, old_memory, new_memory, event, created_at, updated_at, is_deleted, actor_id, role`) and a `messages` table for the last-k conversation window (`mem0/mem0/memory/storage.py`). A separate `memory_type = procedural` path (`Memory._create_procedural_memory`, `PROCEDURAL_MEMORY_SYSTEM_PROMPT`) stores an LLM summary of an agent trajectory that must record action outputs "verbatim". That is a trajectory log, not a reusable rule.
- Write path (`Memory._add_to_vector_store`, line ~881): Phase 0 loads the last 10 messages; Phase 1 retrieves the top 10 existing memories (vector search) and maps their UUIDs to small integers "anti-hallucination"; Phase 2 is one LLM call with `ADDITIVE_EXTRACTION_PROMPT` returning JSON; Phase 3 batch-embeds; Phase 4/5 dedupes by **MD5 of exact text** against those 10 neighbours and within the batch; Phase 6 batch-inserts and writes `ADD` rows to `history`; Phase 7 extracts entities and links them (semantic match >= 0.95 or exact text match merges into an existing entity); Phase 8 saves messages. LLM failure raises `LLMError` instead of returning an empty list (comment in code explains the earlier silent-failure bug). If every insert fails it raises `VectorStoreError`.
- Dedupe: exact-hash only. Near-duplicates and paraphrases are left to the prompt ("skip if semantically equivalent") which is advisory.
- Conflict / contradiction: the prompt tells the model to extract only from new messages, use existing memories "ONLY for deduplication and linking", and put the id of a related memory, explicitly including "Contradiction: New information that conflicts with an existing memory", in `linked_memory_ids` (`mem0/mem0/configs/prompts.py`, section "Memory Linking", ~line 690). **In the OSS write path read here, `linked_memory_ids` from the LLM output is never consumed.** The only persisted LLM fields are `text` and `attributed_to` (`main.py` ~1038). All other `linked_memory_ids` hits in `main.py` belong to the entity store. The managed client mentions a "superseded (the v3 `linked_memory_ids` chain)" (`mem0/mem0/client/main.py:530`), so the platform appears to use it and the OSS library does not. Net effect in OSS: both the old and the new fact stay, with no supersession flag. The legacy ADD/UPDATE/DELETE/NONE prompt (`DEFAULT_UPDATE_MEMORY_PROMPT`, `get_update_memory_messages`) still exists but is not called from library code (grep outside `prompts.py`, tests and evaluation returned nothing).
- Read path (`Memory._search_vector_store`, line ~1642; `mem0/mem0/utils/scoring.py`): over-fetch `max(4*limit, 60)` semantic candidates; BM25 keyword scores (sigmoid-normalised with query-length-adaptive parameters) if the store supports them; entity boost (entity similarity >= 0.5, weight 0.5, damped by number of linked memories); the **semantic score gates first** (below threshold, default 0.1, is dropped even if BM25 would rescue it); combined = (semantic + bm25 + entity) / max_possible, capped at 1. `explain=True` returns `score_details`. There is no recency or outcome term. Expired memories (`expiration_date`, YYYY-MM-DD) are filtered unless `show_expired`.
- Forgetting / consolidation: only manual `update`, `delete`, `delete_all`, per-memory `expiration_date`. `decay`, `timestamp` and `reference_date` parameters raise "not supported by the OSS Memory SDK" (`mem0/mem0/memory/notices.py`, lines 100-134). The README's "temporal reasoning" belongs to the platform. No consolidation job.

**3. Memory and decisions.** Mem0 returns memories as text; it has no concept of a decision, precedent or rule. Explainability is limited to `score_details` and the `history` table (what changed, when, by whom via `actor_id`).

**4. Reflection.** None. Single LLM extraction pass, no retry loop other than caller-level fallback.

**5. Safety.** Good: input validation of entity ids and search params (`_validate_*`, `_reject_top_level_entity_params`), `actor_id` and `role` attribution, immutable identity keys on update (`_strip_identity_keys`), self-hosted server auth on by default (README note), history rows for every mutation. Weak: the README says "Agent-generated facts are first-class ... stored with equal weight", and the prompt extracts assistant statements (only vague characterisations are excluded). That is a poisoning surface: a hallucinated or injected assistant claim becomes a durable fact. No quarantine, no trust tier, no human approval boundary. A grep for "poison", "prompt injection", "untrusted" in `mem0/mem0` and `mem0/docs` found nothing.

**6. Evaluation.** Unit tests (`mem0/tests/`, including `tests/memory/*`). `mem0/evaluation/` is empty in this clone; the README points to an external benchmark repo (`memory-benchmarks`) for LoCoMo / LongMemEval / BEAM. The quoted scores (92.5 / 94.4 / 64.1) are NOT VERIFIED here and explicitly apply to the managed platform.

**7. Licence and commit.** Apache-2.0; `d26ba5e4518cef7fff3c66d4f715b21adf9feabe`.

**8. ADOPT / BEAT.**
- ADOPT: append-only writes plus a `history` audit table with actor attribution; UUID-to-small-integer mapping so the LLM cannot invent ids; gate-then-fuse retrieval (threshold on the semantic score before adding keyword and entity signals); LLM failure raised, never swallowed; explain mode returning the score breakdown.
- BEAT: make supersession a real stored relation that retrieval consumes (valid_from / valid_to / `superseded_by`); add recency, outcome and trust to the ranker; dedupe semantically, not by MD5; never store assistant-generated claims as facts without provenance and a trust tier.

**9. NOT VERIFIED.** Async path parity; whether the platform's `linked_memory_ids` chain works as described; any benchmark number; behaviour of BM25 with the lemmatiser optional extra; retrieval quality of the hybrid scorer.

---

## 3. LangMem

**1. What it is.** A LangChain library of memory primitives on top of LangGraph's `BaseStore`: extraction (`create_memory_manager`), store-backed manager (`create_memory_store_manager`), agent tools (`create_manage_memory_tool`, `create_search_memory_tool`), background execution (`ReflectionExecutor`), prompt optimisers, and summarisation (`langmem/src/langmem/`).

**2. Memory architecture.**
- Tiers (docs `langmem/docs/docs/concepts/conceptual_guide.md`): semantic (collections or single-document profiles), episodic (example schema `Episode{observation, thoughts, action, result}`), procedural (prompt rules, improved by the optimisers). Storage is a LangGraph namespaced key-value store with optional embeddings; namespaces such as `("memories","{langgraph_user_id}")`.
- Write path: two modes. Hot path: the agent calls `manage_memory(action=create|update|delete, id, content)` (`knowledge/tools.py`; `actions_permitted` can restrict the set). Background: `MemoryManager.ainvoke` (`knowledge/extraction.py`, class at line 217) runs a tool-calling extractor over the conversation and the existing memories supplied by the caller. `_MEMORY_INSTRUCTIONS` asks the model to caveat uncertain information with confidence, "Remove incorrect or redundant memories while maintaining internal consistency", and "strengthen based on reliability and recency". Defaults: `enable_inserts=True, enable_updates=True, enable_deletes=False` for `MemoryManager`; `MemoryStoreManager` defaults `enable_deletes=True`.
- Dedupe and conflict handling: entirely LLM judgement over a retrieved window (`query_limit=5` by default, `_sort_results`), prompted with "Avoid duplicate extractions". No deterministic check.
- Consolidation: `MemoryStoreManager(phases=[...])` runs additional LLM passes ("Deduplicate, consolidate, and enrich these memories") over the same candidate set, and `max_steps` allows the manager loop to iterate with a `Done` tool; the loop default is `max_steps = 1` (bounded). `ReflectionExecutor` debounces: a new submit for the same `thread_id` cancels the pending one (`reflection.py`, `LocalReflectionExecutor.submit`), with `after_seconds` delay so extraction runs after the conversation settles.
- Read path: `store.search` (semantic if an index is configured). The concepts doc says recall "should combine similarity with importance ... and strength, a function of how recently/frequently it was used". **No such scoring exists in `src/`**: the only match for recency/strength/importance/decay in `src` is a prompt sentence. Doc and code disagree.
- Forgetting: delete by LLM or tool call; no TTL or decay.

**3. Memory and decisions.** Memory is injected as context; no precedent or rule semantics. The episodic schema (`observation, thoughts, action, result`) is the nearest thing to a decision record in the set, and it is a good one. Explainability is not designed in: `aput` overwrites in place and stores no history.

**4. Reflection / self-correction.** Prompt optimisation, the procedural-memory mechanism (`prompts/optimization.py`, `prompts/gradient.py`): "gradient" optimiser loops `for ix in range(max_reflection_steps)` (default 3, min 1) with `think` and `critique` tools, then a `recommend` tool; the recommendation is only applied when `warrants_adjustment` is true, and the prompt says "ONLY recommend updates if there is evidence of failures" and keep changes "minimally invasive". The input is `AnnotatedTrajectory(messages, feedback)`, so the signal is external feedback. Metaprompt and prompt-memory variants exist. Output is a new prompt; nothing gates its deployment.

**5. Safety.** Weak in code. `actions_permitted` limits tool verbs. The session text is wrapped in a random-UUID `<session_...>` tag (`_prepare_messages`), a mild injection delimiter. No provenance, no trust tiers, no approval step, deletes are applied directly (`MemoryStoreManager.ainvoke`: `final_deletes` then `store.adelete`). Prompt optimisation output is applied without review.

**6. Evaluation.** Tests cover summarisation (30 test functions in `tests/short_term/`) and docstring examples. **There are no tests for extraction, the store manager, deletion, or the optimisers** in this clone. No benchmark.

**7. Licence and commit.** MIT; `48e3c11f5bb527282c7d5339c6a87a0b35abccfc`.

**8. ADOPT / BEAT.**
- ADOPT: the semantic / episodic / procedural taxonomy and the `Episode` schema; `actions_permitted` as a capability restriction; debounced background processing; bounded `max_steps` and `max_reflection_steps` with a minimum and a maximum; "update only on evidence of failure" as the rule for proposing procedural changes.
- BEAT: procedural memory as versioned, tested, human-approved rules (LangMem's is a rewritten prompt string); consolidation output as a proposal, not a write; retrieval that actually uses recency, outcome and trust; history and rollback for every mutation.

**9. NOT VERIFIED.** Real-world quality of the extraction loop; behaviour of LangGraph store search ranking (not in this repo); `graph_rag.py` is entirely commented out in this clone (dead code, `graphs/` is a small prompt set).

---

## 4. A-MEM (Agentic Memory)

**1. What it is.** A Zettelkasten-inspired note memory: each note carries content, keywords, context, tags, links, timestamps, retrieval count and evolution history; an LLM links and "evolves" neighbours on insert (`A-mem/agentic_memory/memory_system.py`, `A-mem/README.md`). The README says paper results live in a separate repository.

**2. Memory architecture.**
- Tiers: one flat store: `AgenticMemorySystem.memories` (a Python dict) mirrored into an in-memory ChromaDB collection (`retrievers.py`: `chromadb.Client(Settings(allow_reset=True))`, not persistent).
- Write path `add_note` -> `process_memory`: fetch 5 nearest neighbours, ask the LLM (`_evolution_system_prompt`) whether to evolve, with actions `strengthen` (add links, replace the note's tags) and `update_neighbor` (rewrite context and tags of neighbours). Every `evo_threshold` (default 100) evolutions `consolidate_memories` runs; it only **rebuilds the vector index** from the dict, no merging.
- Dedupe: none. Conflict handling: none; the evolution prompt only touches tags, context and links, never content.
- Read path: `search` / `search_agentic` return Chroma nearest neighbours by distance, optionally plus linked notes. No recency, importance or count term.
- Forgetting: `delete` by id only.

**Defects found by reading (not executed; each is easy to confirm by running):**
1. `analyze_content` (the LLM keyword / context / tag generator the README advertises) is **defined but never called** (`grep` finds one hit, its definition). `add_note` therefore stores caller-supplied or default metadata (`context="General"`).
2. `update_neighbor` indexes `noteslist[memorytmp_idx]` where `memorytmp_idx` comes from `indices`, which `find_related_memories` fills with `range`-style result ranks (`indices.append(i)`), not positions of the neighbours in `self.memories`. It can rewrite unrelated notes.
3. `strengthen` appends `suggested_connections` to `note.links`. The neighbour text the LLM sees is labelled `memory index:{i}`, so links are rank indices, not note ids; the link expansion in `search_agentic` looks them up in a dict keyed by UUID and finds nothing.
4. `retrieval_count`, `last_accessed` and `evolution_history` are written to metadata but **never updated** anywhere.
5. `__init__` calls `client.reset()` on the Chroma collection, and the store is in-memory only, so nothing persists across processes.

**3. Memory and decisions.** None. Memory is context for an external agent.

**4. Reflection.** None beyond the evolve step. No retry loop; a JSON or key error returns `(False, note)` silently (`except` branches log and continue).

**5. Safety.** None. The LLM can overwrite tags and context of arbitrary neighbours with no record (evolution history is never written); no provenance, trust or approval.

**6. Evaluation.** `tests/test_memory_system.py` (10 tests) and `tests/test_retriever.py` (12). The system tests construct the system with the OpenAI backend in `setUp`, so they need a key. NOT VERIFIED whether they pass. Paper results are in another repo and not verified here.

**7. Licence and commit.** MIT; `ceffb860f0712bbae97b184d440df62bc910ca8d`.

**8. ADOPT / BEAT.**
- ADOPT: the idea that each memory carries explicit links and a usage counter, and that links should be typed (supports / contradicts / supersedes).
- BEAT: everything operational. Typed links created by deterministic checks plus LLM proposals; counters that actually update; persistence; an evolution log. Do not let an LLM rewrite neighbour metadata in place.

**9. NOT VERIFIED.** All five defects above by execution; the paper's reported gains; whether the examples run on a local Ollama backend.

---

## 5. Generative Agents (Stanford "Smallville")

**1. What it is.** The reference simulation of 25 LLM agents with a memory stream, retrieval, reflection and planning (`generative_agents/reverie/backend_server/`). It is research code written against old OpenAI endpoints (`text-davinci-003`, `ada-002`).

**2. Memory architecture.**
- Tiers: associative memory (`memory_structures/associative_memory.py`, class `AssociativeMemory`): `ConceptNode`s of type `event`, `thought` or `chat`, each with subject-predicate-object, description, embedding key, `poignancy` (importance 1-10), `created`, `expiration`, `last_accessed`, `depth` (thoughts are depth 1 + max depth of their evidence), and `filling` (evidence node ids for thoughts, chat lines for chats). Scratch memory (`scratch.py`): working state (current action, daily plan, chat buffer, hyper-parameters). Spatial memory (`spatial_memory.py`): a tree of the world.
- Write path (`cognitive_modules/perceive.py`): each step, the nearest `att_bandwidth` (3) events in the same arena are considered; an event is stored only if its (s,p,o) is not among the last `retention` (5) events; importance is scored once by an LLM (`run_gpt_prompt_event_poignancy`, prompt "On the scale of 1 to 10 ... rate"; **fail-safe returns 4**); embedding stored; `importance_trigger_curr -= poignancy`.
- Read path (`cognitive_modules/retrieve.py::new_retrieve`): score = `recency_w*recency*0.5 + relevance_w*relevance*3 + importance_w*importance*2` (the `gw = [0.5, 3, 2]` literal overrides the paper's equal weights; comment "test out different weights ... should likely be learned"), each component min-max normalised over all nodes; top `n_count` = 30 nodes per focal point; retrieved nodes get `last_accessed = curr_time`. Relevance is cosine similarity of embeddings; importance is the stored poignancy. A cheap keyword path (`retrieve_relevant_events/thoughts`) serves reactions.
  - Defect by reading: `extract_recency` sorts nodes ascending by `last_accessed` and assigns `recency_decay ** i` for i = 1..n in that order, so the **oldest** node gets the largest value and, after min-max, the newest gets 0. This looks inverted relative to the paper's intent. Not executed.
  - Also: each call prints the full score table (debug prints left in).
- Dedupe/conflict: none beyond the 5-event retention filter; nothing detects contradictory thoughts.
- Forgetting: `expiration` (30 days for thoughts) and `scratch.concept_forget = 100` are stored and saved, but a grep for `.expiration`, `concept_forget` and `retention` shows **no code that reads them** apart from the retention filter. Nothing is forgotten.

**3. Memory and decisions.** The decision loop `Persona.move` (`persona/persona.py`): `perceive -> retrieve -> plan -> reflect -> execute`. Retrieved events and thoughts are placed into prompts for `_should_react`, planning and conversation. Explainability: thoughts carry `filling`, a list of evidence node ids, so a belief can be traced to the observations that produced it, and `depth` records how many abstraction layers deep it is. This is the best provenance structure in the set. There is no record of which memories influenced a given action.

**4. Reflection (exact algorithm, bounds).** `cognitive_modules/reflect.py`:
- Trigger `reflection_trigger`: `importance_trigger_curr <= 0` and memory non-empty. The counter starts at `importance_trigger_max = 150` and each perceived event subtracts its poignancy, so reflection fires when the summed importance of new events since the last reflection reaches 150. `importance_ele_n` counts those events.
- `run_reflect`: (1) `generate_focal_points` asks the LLM for 3 salient questions from the last `importance_ele_n` nodes; (2) for each, `new_retrieve` (30 nodes); (3) `generate_insights_and_evidence` asks for 5 "insight (because of 1, 5, 3)" lines per focal point; (4) each insight becomes a `thought` node with poignancy scored by the LLM, `expiration = now + 30 days`, `filling` = evidence node ids; (5) `reset_reflection_counter`.
- Bounds: 3 focal points x 5 insights = at most 15 new thoughts per reflection; LLM calls retry up to 5 times (`safe_generate_response(repeat=5)`) then return a fail-safe.
- **Poisoning-by-failure:** the insight fail-safe is `["I am hungry"] * n` (a list); the caller does `ret.items()` inside a bare `try/except` and on any error returns `{"this is blank": "node_1"}`, which is then written as a thought with poignancy and an embedding. A failed or out-of-range evidence index therefore stores a junk belief. Read, not executed.
- A conversation-end reflection writes a planning thought and a memo about the chat (also 30-day expiry).

**5. Safety.** None. Reflections are written automatically with no verification of their evidence; there is no check that an insight is actually supported by the cited nodes.

**6. Evaluation.** None in the repo (the paper uses interviews and TrueSkill; not in the clone, NOT VERIFIED).

**7. Licence and commit.** Apache-2.0; `fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4`.

**8. ADOPT / BEAT.**
- ADOPT: the three-factor score (recency, relevance, importance) as the baseline; importance-triggered reflection (reflect when enough has happened, not on a timer); thoughts with evidence ids and abstraction depth; per-retrieval `last_accessed` for reinforcement.
- BEAT: use calibrated scores with fixed, documented weights (not min-max over the candidate set, which changes meaning as the set changes); verify that every cited evidence id exists and supports the claim before a reflection is stored; fail closed (no write) instead of writing a placeholder; actually apply expiry; score importance from outcomes, not a one-time LLM guess; record which memories each decision used.

**9. NOT VERIFIED.** The recency inversion by execution; paper claims; behaviour of `plan.py` re-planning logic beyond the functions read.

---

## 6. Agent_Memory_Techniques (Nir Diamant cookbook)

**1. What it is.** 30 numbered notebooks plus READMEs on memory patterns (`Agent_Memory_Techniques/AGENTS.md`): buffers (01-05), long-term stores (06-11), cognitive layers (12-19), retrieval and multi-agent (20-23), frameworks (24-27), evaluation and production (28-30). "A teaching repository, not a library." Treat as a secondary source: it describes frameworks it does not contain.

**2. Memory architecture (what it teaches).** `docs/architecture.md` gives five patterns (single store, dual store, tiered hot/warm/cold, hierarchical, cognitive). Techniques of interest:
- 09 episodic: episode boundaries, summaries, retrieval by a mix of similarity and recency.
- 11 procedural: extract a parameterised procedure from a **successful** run into a skill library; limitations list silent staleness and wrong-procedure retrieval.
- 14 consolidation: cluster by similarity (union-find in the notebook), LLM merge, LLM contradiction detection (`detect_contradictions` returns index pairs), resolution strategies "most recent / highest confidence / user-confirmed / LLM-adjudicated", recomputed importance. Its own limitations: lossy and irreversible, fragile thresholds, "'User prefers Python' and 'User switched to Rust' aren't always contradictions".
- 18 temporal: `created_at`, `event_time`, `last_accessed`; decay with half-life; "as of" retrieval that reconstructs what was known at a past time.
- 19 forgetting: exponential decay with reinforcement on access, soft vs hard delete; limitation: "Critical information ... can decay and get pruned if you don't exempt it" and old and corrected versions coexist.
- 28 evaluation: Recall@K, Precision@K, MRR, LLM-judge faithfulness, a temporal-accuracy check (newer facts must outrank superseded ones) and a contradiction scan; limitation: it measures retrieval, not end-to-end task success.
- 30 production: PII redaction before extraction, tiered stores, per-user budget and cost tracking, GDPR delete and audit log; regex PII misses context-dependent PII.

**3. Memory and decisions.** Not covered. No technique is about rules or precedent.

**4. Reflection.** Technique 16 describes the Reflexion pattern: outcome signal -> structured reflection -> reflection store retrieved before the next task. Its limitations: "Shallow or incorrect reflections get stored and can mislead", "no built-in way to detect contradictions", needs clear success criteria.

**5. Safety.** `docs/roadmap.md` lists "Memory security and adversarial resilience ... prompt injection attacks that attempt to poison stored memories" under **future topics**: the cookbook itself does not cover it. grep for human approval or provenance finds only audit-trail remarks in 22 and 23.

**6. Evaluation.** `tests/` hold import and smoke tests only. Notebook claims NOT VERIFIED (notebooks not executed).

**7. Licence and commit.** Apache-2.0; `4767c0341ccd8b714147334c5f17c26ff99d8e41`.

**8. ADOPT / BEAT.**
- ADOPT: the evaluation checklist (28) as the skeleton of our memory test plan, especially the temporal-accuracy and contradiction checks; the consolidation conflict-resolution strategy list (14), with "user-confirmed" as the top-priority source; the limitation lists as a pre-mortem; PII redaction at write time (30).
- BEAT: it never closes the loop from memory to a governed decision, never specifies approval boundaries, and treats security as future work.

**9. NOT VERIFIED.** Every notebook result; the accuracy of its descriptions of Mem0, Letta, Zep and Graphiti.

---

## 7. awesome-language-agents: the CoALA framework

**1. What it is.** A curated list plus the CoALA summary (`awesome-language-agents/README.md`, `action_space.png`, `decision_making.png`, `CoALA.bib`). The paper (arXiv:2309.02427) is not in the clone; this section uses only the README text and the two figures.

**CoALA structure as stated in the README and figures**
- Memory: one short-term **working memory** and optional long-term memories: **episodic** (experience), **semantic** (knowledge), **procedural** ("code/LLM": the agent's own code and its LLM weights or prompts).
- Action space, two halves. External: **grounding** (act on the environment). Internal: **reasoning** (update working memory using the LLM), **retrieval** (read long-term memory), **learning** (write long-term memory). `action_space.png` groups reasoning + retrieval as **planning** actions and learning as the remaining internal action.
- Decision cycle (`decision_making.png`): Observation -> **Planning** [Proposal -> Evaluation, with a loop back] -> **Selection** -> **Execution** -> back to planning. The README: planning applies reasoning and retrieval to "propose and evaluate actions, then select a learning/grounding action"; execution runs the selected learning or grounding action.

**Mapping CoALA to the other repos**

| CoALA element | mem0 | LangMem | A-mem | Generative Agents | Reflexion | ToT | Letta (concept, NOT VERIFIED) |
|---|---|---|---|---|---|---|---|
| Working memory | last-10 `messages` table, prompt context | thread summarisation (`short_term/summarization.py`) | none | `Scratch` (`scratch.py`) | `scratchpad` and `reflections_str` in the prompt | candidate list `ys` | core blocks + context window |
| Episodic | `history` + raw messages (weak) | `Episode` schema | notes (undifferentiated) | `event` and `chat` nodes | per-env list of reflections (`env['memory']`) | none | recall memory |
| Semantic | fact memories + entity links | `Memory` / profile schemas | notes + tags/links | `thought` nodes (depth >= 1) | none | none | archival memory |
| Procedural | procedural summary (a log) | prompt optimiser output | none | daily plan / identity revision (`revise_identity`) | none (plans are episodic text) | task prompts (static) | none stated |
| Retrieval | hybrid vector + BM25 + entity | `store.search` | Chroma kNN (+ broken links) | recency + relevance + importance | last 3 reflections | n/a | search tools |
| Learning (write) | ADD-only extraction | LLM insert/update/delete, reflection executor | add + neighbour evolution | importance-triggered reflection | reflect on failure | none | self-edit tools |
| Reasoning | none | optimiser reflection loop | evolve prompt | focal points, insights | self-reflection | thought proposals and value prompts | inner monologue |
| Grounding | none | tool use by host agent | none | `execute` to the maze | environment `step` / test executor | `test_output` | tool calls |
| Planning cycle | none | none | none | `plan.py` + `move` loop | outer retry loop | **proposal -> evaluation -> selection** per step (`bfs.solve`) | heartbeat loop |

**Reading of the mapping.** ToT is exactly CoALA's planning loop with an explicit selection step. Reflexion is CoALA's *learning* action wrapped around an outer retry loop. Generative Agents is the only repo that covers all four memory types and the full cycle, and it still has no safety layer. **None of the repos has a deterministic policy layer or an approval boundary; CoALA's README does not describe one either** (whether the paper discusses safety is NOT VERIFIED). That gap is where our design sits.

**Licence and commit.** No LICENSE file in the clone; README badge says MIT: NOT VERIFIED. `fad302ff4c2d7bab66d4d60e019be853fa80aaa3`. **ADOPT** the vocabulary (working / episodic / semantic / procedural; reasoning / retrieval / learning / grounding; propose -> evaluate -> select -> execute). **BEAT** by adding a rule-engine veto before selection and an approval gate before learning actions.

---

## 8. Reflexion

**1. What it is.** "Verbal reinforcement learning": after a failed attempt the agent writes a natural-language reflection and conditions the next attempt on it. Three experiment families: HotPotQA reasoning (`reflexion/hotpotqa_runs/`), ALFWorld decisions (`reflexion/alfworld_runs/`), programming (`reflexion/programming_runs/`); WebShop is also present (not read).

**2. Memory architecture.** Episodic only, and short-lived.
- ALFWorld: each environment (task instance) has `env_configs[i]['memory']`, a list of reflection strings (`alfworld_runs/main.py`). Write trigger: after a trial, for every environment that is neither successful nor skipped, `update_memory` (`generate_reflections.py`) asks the LLM for a "New plan" from the failed log plus the last 3 past plans; the result is appended. Read: only the **last 3** reflections are given to the next attempt (`alfworld_run`: `memory[-3:]`). Memory is **per task instance**, so nothing generalises to other tasks. No dedupe or conflict handling; no forgetting other than the 3-item window.
- HotPotQA: `ReflexionStrategy` enum NONE / LAST_ATTEMPT / REFLEXION / LAST_ATTEMPT_AND_REFLEXION (`hotpotqa_runs/agents.py`): reflections are accumulated and formatted into the prompt.
- Programming: reflections are kept in a local list for the item (`programming_runs/reflexion.py`).

**3. Memory and decisions.** Reflections are plans for the same task ("devise a concise, new plan ... with environment-specific actions"). Explainability: the reflection text and the logs under `*/root/` are inspectable; there is no rule or precedent layer.

**4. Reflection loop (exact algorithm and bounds).**
- ALFWorld: `for trial in range(num_trials)` (the shipped script uses 10 trials, 134 environments, `gpt-3.5-turbo`); inside a trial each unsolved env runs `alfworld_run` for at most 49 steps, the actor LLM call retries up to 6 times with rising temperature (`cur_try * 0.2`) when output is under 5 characters; success is the environment's `info['won']`, after which that env is frozen as successful and skipped; failures trigger reflection.
- HotPotQA: `ReactAgent.max_steps = 6`, halted also if the prompt exceeds 3,896 tokens (`is_halted`); trial loop in the notebooks; `is_correct()` is exact match against the gold answer `key`.
- Programming (`reflexion.py`): `pass_at_k` outer attempts; inside, at most `max_iters` (the sample script uses 2) generate -> run model-written internal tests -> reflect cycles; the real tests are used to score the result, not to drive the reflection.
- **Critical point:** the ALFWorld and HotPotQA loops are gated by an oracle (`won`, gold answer). Only the programming variant uses a self-generated signal (model-written unit tests), which is closer to a real deployment, and it is the weakest of the three signals.

**5. Safety.** Bounded by step, trial and iteration counts. Nothing stops a wrong reflection from entering the next prompt; the 3-item window limits how long a bad reflection survives. No human approval.

**6. Evaluation.** Logs of runs are committed (`alfworld_runs/root/{base_run_logs,reflexion_run_logs}`, `hotpotqa_runs/root`, `programming_runs/root`). The numbers in the paper were not recomputed here: NOT VERIFIED.

**7. Licence and commit.** MIT; `218cf0ef1df84b05ce379dd4a8e47f17766733a0`.

**8. ADOPT / BEAT.**
- ADOPT: hard bounds in code (trials, steps, iterations, last-N reflections), stop on success, reflect only on failure, keep the reflection tied to the failed trace.
- BEAT: we have no oracle at decision time. Our failure signal must come from deterministic validators (rule engine, schema, citation check) and humans, and a reflection must never be allowed to change a rule outcome.

**9. NOT VERIFIED.** Paper results; the WebShop path; whether `programming_runs` reflections help beyond sampling.

---

## 9. Tree of Thoughts

**1. What it is.** Deliberate search over partial solutions: propose several next "thoughts", have the LLM evaluate them, keep the best, repeat (`tree-of-thought-llm/src/tot/methods/bfs.py`, `run.py`). Tasks: Game of 24, creative writing ("text"), mini crosswords.

**2. Memory architecture.** None across problems. Within a problem the state is `ys`, the list of surviving partial outputs. A `value_cache` keyed by the value prompt avoids re-scoring identical states (`bfs.get_value`).

**3. Memory and decisions.** The "decision" is the selection step. Explainability: `solve` returns per-step `infos` with every candidate, its value and what was selected, and `run.py` logs them to JSON. That is a complete search trace, the best of its kind in the set.

**4. Search algorithm and bounds (`bfs.solve`).**
- For each of `task.steps` levels (Game of 24: 4): **generate** candidates per survivor, either `sample` (`n_generate_sample` completions) or `propose` (one call returns several proposals); **evaluate** with `value` (LLM labels each state sure/likely/impossible, mapped to 20 / 1 / 0.001 in `game24.value_outputs_unwrap`, marked `# TODO: ad hoc`) or `vote` (the LLM picks the best among candidates, `n_evaluate_sample` times); **select** `n_select_sample` (the breadth `b`) by `greedy` top-k or by `sample` with probability proportional to value.
- Bounds: depth = `task.steps`, breadth = `n_select_sample`, per-call n capped at 20 in `models.chatgpt`, API retries by `backoff`. No wall-clock or token cap; cost is only reported (`gpt_usage`).
- Weaknesses by reading: BFS does not backtrack; a pruned branch is gone. `method_select=sample` divides by `sum(values)` and fails if all values are 0. Duplicate candidates in `get_values` get value 0 (intended de-duplication, also hides real duplicates from the log). DFS with pruning exists only for crosswords, in a notebook (`scripts/crosswords/search_crosswords-dfs.ipynb`: `dfs(env, actions, infos, time_limit, prune, max_per_state)`, `max_per_state=3`, `time_limit=100`, prunes when a state is marked impossible).
- Final scoring is deterministic: `Game24.test_output` checks the number multiset and evaluates the expression with `sympy`. The LLM never grades its own final answer on that task.

**5. Safety.** Not applicable (no persistent memory). The discipline worth copying is the separation of a heuristic LLM evaluator (guides search) from a deterministic verifier (decides correctness).

**6. Evaluation.** Per-task `test_output`, logs under `tree-of-thought-llm/logs/`. Paper numbers NOT VERIFIED.

**7. Licence and commit.** MIT; `8050e67d0e3a0fddc424d7fa5801538722a4c4cc`.

**8. ADOPT / BEAT.**
- ADOPT: propose -> evaluate -> select with explicit breadth/depth caps; log every candidate, score and choice; deterministic final verification; value caching.
- BEAT: use ToT-style search only at the point where the agent proposes among rule-permitted actions, with a token and time budget, and with the rule engine as the pruner (a rule violation is an exact `impossible`, not a sampled one).

**9. NOT VERIFIED.** Search quality on our tasks; any claim that search beats a single pass for decisions (it was shown on puzzles with checkable answers).

---

## 10. Decision architecture synthesis

Goal: a decision agent whose actions are governed by **explicit, versioned rules**, informed by **precedent**, with an LLM used for judgement inside the rules, improved over time by **proposals that a human approves**. Nothing below is built yet; thresholds are starting values to be tuned and are NOT VERIFIED.

### 10.1 Memory model (CoALA types made concrete)

| Type | Contents | Store | Who may write | Lifetime |
|---|---|---|---|---|
| Working | current case, retrieved precedents, applicable rule ids, scratch reasoning, retry count | per-run structured state (JSON), never free-form | the runtime | the run |
| Episodic | **Case records**: input digest, rules fired, precedents used, options considered, decision, autonomy level, approver, outcome (initially `unknown`), outcome evidence | append-only table plus embeddings | runtime at decision time; outcome fields only by the outcome verifier or a human | permanent; superseded, never edited |
| Semantic | **Facts** as structured claims `(subject, attribute, value, source, trust_tier, valid_from, valid_to, superseded_by)` | versioned table plus embeddings | only trust tier >= `verified` sources or an approved proposal; LLM extractions enter as `proposed` | until superseded or expired |
| Procedural | **Policy-as-code**: rule ids, version, predicate code, action constraints, max autonomy level, tests | git-style versioned store, rules compiled and tested | only through the approval queue | versioned, rollback-able |

Reasons: LangMem's three types and its `Episode` schema (`langmem/.../conceptual_guide.md`), Generative Agents' evidence-linked `thought` nodes (`filling`, `depth`), mem0's append-only history table (`mem0/mem0/memory/storage.py`). Procedural memory is deliberately **not** an LLM-rewritten prompt (LangMem) and **not** a trajectory log (mem0): it is code with tests.

### 10.2 Policy-as-code separated from LLM judgement

Decision pipeline (CoALA's planning cycle with a deterministic veto):

1. **Observe and normalise** the case into a typed record (schema-validated; invalid input stops here, nothing is charged or stored as a fact).
2. **Rule engine (deterministic, no LLM).** Evaluate all applicable rules by id. Output: `{rule_id, verdict: forbid|require|permit|escalate, params, rule_version}` for every rule that fired, plus the **allowed action set** and the **maximum autonomy level** (the minimum across fired rules). This is final: no later step can enlarge the allowed set.
3. **Precedent retrieval** (10.3) returns support and counter-precedents.
4. **LLM judgement** receives the case, the allowed action set, fired rule ids with their text, and precedents as *data* (delimited, flagged untrusted where applicable). It may only (a) choose among allowed actions, (b) produce a rationale that cites rule ids and precedent ids, (c) return a confidence and the facts it relied on. If it returns an action outside the allowed set, or cites an id that does not exist, the output is rejected by a validator, not repaired.
5. **Selection and ToT-style search (optional).** When the allowed set is large, propose -> evaluate -> select with fixed breadth and depth; the rule engine prunes violating branches exactly.
6. **Autonomy gate** (10.5) decides execute / ask / only record.
7. **Decision record** written to episodic memory with: rule ids and versions fired, precedent ids and their scores, allowed set, chosen action, rationale, confidence, autonomy level used. This is the explanation.

### 10.3 Precedent retrieval: similarity + recency + outcome weighting

- Candidate set: ANN over case embeddings, filtered by case-type and jurisdiction metadata, over-fetch (mem0 over-fetches `max(4*limit, 60)`), **gate on absolute similarity first** (mem0 `score_and_rank`) so keyword or recency cannot rescue an irrelevant case. Do not min-max normalise over the candidate set (Generative Agents' approach makes scores meaningless across queries).
- Score for a gated candidate: `S = w_sim * sim + w_rec * 2^(-age / h_type) + w_out * o`, where `age` is time since the case, `h_type` is a half-life per case type (policies change at different speeds), and `o` in [-1, 1] is the outcome weight: verified good outcome +1, verified bad outcome -1 (kept as a cautionary precedent), `unknown` 0 and capped, overturned on appeal -1. Starting weights `w_sim = 0.6, w_rec = 0.2, w_out = 0.2`: NOT VERIFIED, to be tuned on a labelled case set.
- Return **two lists**: top-k supporting and top-k contradicting precedents (same facts, different decision). Showing only agreeing precedents is the confirmation-bias failure that none of the repos guards against.
- Rule-versioning guard: a precedent decided under a rule version that has since been superseded is flagged `stale_rule` and down-weighted or excluded, whichever the rule's metadata says.
- Explainability: return the per-term breakdown (mem0's `explain=True` / `score_details`) and store it in the decision record.
- Reinforcement: increment `retrieval_count` / `last_used` as A-mem intended and Generative Agents does, but use it only for diagnostics and the dreaming step, not as a trust signal (a frequently retrieved wrong precedent would otherwise strengthen itself).

### 10.4 Reflexion loop with bounded retries

- Trigger: a deterministic check fails (rule engine rejects the LLM action; schema or citation validator fails; a human rejects the proposal at L1/L2). Never a model's own opinion of its answer.
- Algorithm (Reflexion's structure, ALFWorld-style window): attempt 1 -> verify -> on failure write a short reflection tied to the **specific failed check** (which rule id, which validator error, which human comment) -> attempt 2 with the last <= 3 reflections for this case in working memory -> verify -> at most **2 retries** (3 attempts), then stop and **escalate to a human with the full trail**. Also cap total LLM calls and wall-clock per case, enforced in code (the organiser's bounded-run rule in `CLAUDE.md`).
- Reflection never changes the rule results, the allowed set, or the facts. It can only change how the judgement step uses them.
- Reflections are episodic and case-scoped with a TTL. They can become inputs to the dreaming step, never to rules directly.
- Different model call (and ideally different prompt and model) for the critic than the proposer, as in `docs/design/agent-pairings.md` (Proposer + Critic, exactly one fix, one revision).

### 10.5 Autonomy ladder and approval queue

- **L0 observe** (shadow): compute the full decision, record it, take no action, show nothing as a recommendation. Used to measure agreement with what humans actually did.
- **L1 propose**: show the recommendation, rule ids and precedents; a human acts.
- **L2 act with confirm**: the system prepares the action; execution requires a human approval.
- **L3 act**: executes without confirmation, still logged and reversible where possible.
- The level for a case is `min(rule max level, level granted to this (rule-family, action-type, risk-tier) cell, confidence gate)`. Irreversible or high-impact actions are capped at L2 by rule, so no model confidence can raise them.
- Promotion of a cell (L0 -> L1 -> L2 -> L3) is itself a queue item requiring a human, with evidence: N shadow cases, agreement rate with a lower confidence bound (a Wilson interval, not a point estimate), zero unresolved incidents. Demotion is automatic on an incident, a failed validator trend, or a rule change touching the cell.
- **Approval queue** item types: action approval, memory-write approval (facts that would enter semantic memory from untrusted sources), rule proposal (10.6), ladder promotion. Each item carries evidence ids, a diff, the deterministic test result, an expiry, and an idempotency key. **Default on timeout is deny / no-op**, never allow. Every decision (approve, reject, edit) is stored with the approver and the reason; rejections feed back as negative examples for the dreaming step.

### 10.6 Consolidation ("dreaming"): output is only PROPOSED rules

- Runs offline on a schedule or after N new closed cases; never in the decision path.
- Steps: (1) cluster closed cases by embedding and by rule-engine fingerprint; (2) compute per-cluster statistics (decision distribution, outcome distribution, human override rate); (3) detect candidates: repeated human overrides of the same recommendation, repeated bad outcomes under the same permitted action, near-duplicate or contradictory semantic facts, stale facts; (4) for each candidate, the LLM drafts a **proposal**: either a rule (predicate code, constraints, tests, counter-examples) or a fact merge/retirement, with the supporting and contradicting case ids; (5) **replay**: run the drafted rule over all past cases and a held-out split in the deterministic engine, report precision / recall against human decisions and the cases whose decision would change; (6) submit to the approval queue with the replay report. Proposals that fail replay or have fewer than a minimum number of independent supporting cases are discarded and logged.
- Bounds: at most N proposals per run, a per-cluster cooldown, proposals expire if unreviewed.
- The step may **never**: activate a rule, delete or edit a case record, or change an autonomy cell. Memory merges produce `superseded_by` links, not deletions (consolidation in technique 14 is "lossy and irreversible"; ours is neither).

### 10.7 Write path and poisoning defences

Every candidate memory passes: provenance stamp (source, actor, tool, time) -> trust tier (`human_confirmed` > `tool_verified` > `system_derived` > `llm_extracted` > `untrusted_external`) -> schema validation -> exact and semantic dedupe -> **structured contradiction check** against facts with the same `(subject, attribute)` and overlapping validity -> either append with supersession or open a conflict item in the queue. LLM-extracted or externally-sourced content is stored as data with its tier and is rendered into prompts inside delimiters and labelled; it can never become an instruction, a rule, or a fact used by the rule engine without promotion by a human or a verified tool.

### 10.8 The 8 most important design decisions, with repo evidence

1. **Rules are code with ids, kept out of the model and out of memory text.** Evidence: no repo has a deterministic policy layer (section 7 table); LangMem's procedural memory is a rewritten prompt string (`langmem/src/langmem/prompts/`), which makes behaviour untestable and unreviewable.
2. **Append-only, versioned memory with supersession that retrieval actually uses.** Evidence: mem0 moved to ADD-only (`mem0/README.md`) and keeps a `history` table, but its OSS path drops the LLM's `linked_memory_ids` so old and new facts coexist unlabelled; LangMem's `aput` overwrites and deletes with no history; A-mem's `evolution_history` is never written.
3. **Allowed-action set computed before the LLM, LLM confined to it.** Evidence: ToT keeps the heuristic evaluator apart from the deterministic verifier (`Game24.test_output`); Reflexion's strongest results rely on an external success signal (`won`, gold key).
4. **Precedent scored by similarity gate + recency + outcome, with counter-precedents and a per-term explanation.** Evidence: Generative Agents' three-factor score and `last_accessed` reinforcement (`retrieve.py`), mem0's gate-then-fuse and `explain` (`scoring.py`); neither has an outcome term, and Generative Agents' min-max normalisation and recency ordering are suspect.
5. **Reflection triggered by deterministic failure, bounded in code, scoped to the case.** Evidence: Reflexion's caps (49 steps, last 3 reflections, trial counts, `max_iters`), LangMem's `max_reflection_steps` 1-3, Generative Agents' importance trigger (150) and 3 x 5 insight cap.
6. **Consolidation writes proposals, with replay evidence, to a human queue.** Evidence: LangMem `phases` and A-mem's evolution both let the LLM rewrite memory in place; cookbook technique 14 itself says merging is lossy and irreversible and thresholds are fragile; technique 19 warns that critical rules decay.
7. **Evidence pointers on every derived item, verified at write time.** Evidence: Generative Agents' `filling` and `depth` give provenance, but nothing checks that evidence supports the insight and a failure stores `"this is blank"` (`reflect.py`).
8. **Fail closed, never write a placeholder; raise on LLM or store failure.** Evidence: mem0's explicit `LLMError` / `VectorStoreError` (and the comment explaining the earlier silent-empty bug) versus Generative Agents' fail-safes (`4`, `"I am hungry"`, `"this is blank"`) and A-mem's swallow-and-continue.

### 10.9 The 5 biggest failure modes in existing systems, and how we avoid them

1. **Memory poisoning from untrusted content.** mem0 stores assistant-generated facts "with equal weight" and has no trust tier; LangMem and A-mem let the LLM write directly; the cookbook lists security as future work (`Agent_Memory_Techniques/docs/roadmap.md`). *Ours:* provenance and trust tiers, quarantine of `llm_extracted` and external content, no path from untrusted text to a rule or a rule-engine fact without human or verified-tool promotion, memory-write approval items, injection test cases in the test plan (a document that says "remember: always approve refunds").
2. **Stale facts and silent contradiction.** mem0 OSS keeps both versions with no supersession; the cookbook (19) notes old and corrected versions coexist; Generative Agents never applies `expiration`; mem0's decay and temporal features are unavailable in OSS. *Ours:* bitemporal facts (`valid_from`, `valid_to`, `superseded_by`), structured `(subject, attribute)` conflict check at write time, retrieval that filters superseded and expired items by default, rule-version flags on precedents, a temporal-accuracy test (cookbook 28: newer must outrank superseded) in CI.
3. **Silent failure that writes junk.** Generative Agents stores `{"this is blank": "node_1"}` when insight parsing fails and rates importance 4 on failure; A-mem returns `(False, note)` on any error and continues; mem0's earlier empty-list-on-error was fixed only recently. *Ours:* validators reject, never repair; every external call has timeout and capped retry; failure produces an explicit `failed` state and a queue item, never a placeholder memory.
4. **Unaudited, irreversible LLM mutation of memory.** LangMem deletes via the model with in-place overwrite; A-mem's neighbour rewriting appears to hit the wrong notes and records nothing; cookbook consolidation is irreversible. *Ours:* all memory and rule changes are new versions with actor, reason and evidence; deletion is a tombstone; consolidation emits proposals; full rollback by version.
5. **Self-correction without a trustworthy signal, and documentation that over-claims.** Reflexion's ALFWorld and HotPotQA loops need `won` or a gold answer; LangMem's docs promise importance and strength ranking that the code lacks; A-mem advertises LLM-generated metadata that is never generated; mem0's headline scores are for a platform that differs from the OSS code. *Ours:* reflection fires only on deterministic checks or human feedback; every capability claim in our README and demo is tied to a test or trace line; any claim lacking execution evidence is labelled **NOT VERIFIED**.

### 10.10 Mapping to CoALA

| CoALA | Our component |
|---|---|
| Working memory | structured per-run state |
| Episodic / semantic / procedural | case records / versioned facts / policy-as-code |
| Retrieval | precedent retrieval 10.3, fact lookup with validity filter |
| Reasoning | LLM judgement confined to the allowed set; reflection 10.4 |
| Learning | gated write path 10.7; dreaming proposals 10.6; ladder promotions |
| Grounding | executing actions via the autonomy gate |
| Planning cycle | propose -> **rule veto** -> evaluate -> select -> **autonomy gate** -> execute |

### 10.11 What must be verified before any claim in this section is made in the README or demo

- Retrieval weights and half-lives: need a labelled case set and an ablation (similarity only vs + recency vs + outcome).
- Promotion thresholds and confidence bounds: need shadow-mode data.
- Replay-based rule proposals: need a measured false-proposal rate.
- Prompt-injection resistance of the write path: need adversarial test documents run against the real pipeline.
- Sponsor product fit (Zetaris, Meterless, NVIDIA): out of scope here and NOT VERIFIED; see `docs/sponsors/*-integration-notes.md`.
