# Profile: agiresearch/A-mem (agentic memory)

Reader: Haiku (low effort), 2026-10-16, about 74 seconds, 76k tokens. Local clone, last commit ceffb86. Paths relative to `agentic_memory/` unless stated.

Spot-check (reviewer, against the code): MIT licence (confirmed); `evo_threshold` default 100 (line 97) and the consolidation trigger `evo_cnt % evo_threshold` (line 262) (confirmed); `find_related_memories(note.content, k=5)` at line 605 (confirmed); `evolution_history` is declared and copied but never appended to anywhere in the package (confirmed by search). Not rechecked: the exact prompt text and the index-out-of-bounds claim. Result: PASS.

## 1. What it is
A memory system that organises notes in a Zettelkasten style: each note carries keywords, context, tags and links, and an LLM decides whether new notes should strengthen links or update neighbours. MIT.

## 2. Architecture map
`MemoryNote` (content, keywords, context, tags, links, timestamps, retrieval count, evolution history); `AgenticMemorySystem` (orchestrator, an in-memory dict plus a Chroma collection); `ChromaRetriever` (sentence-transformer embeddings, metadata serialised as JSON strings); `LLMController` (OpenAI or Ollama, JSON-schema responses). Entry points: `add_note`, `search_agentic`, `read`, `update`, `delete`.

## 3. Features and how each behaves
`add_note` builds a note, runs `process_memory`, stores it, and every `evo_threshold` notes calls `consolidate_memories` (resets and re-embeds the whole collection). `process_memory` finds five nearest neighbours, asks the LLM whether to evolve and with which actions (`strengthen` adds links and replaces tags; `update_neighbor` rewrites neighbour tags and context in place). `search_agentic` returns top-k plus their linked neighbours. `analyze_content` asks the LLM for keywords, context and tags with a safe fallback. LLM errors are caught and the note is stored unchanged.

## 4. How people use it
Clone, create a venv, `pip install .`, set an OpenAI key (or run Ollama), then `add_note` and `search_agentic` as in the sovereign-memory example. Tests cover CRUD, metadata persistence and links. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M6 memory evolution and linking)
State: links, tags, context per note; embeddings in Chroma. The evolution decision is one LLM call over five neighbours returning a binary `should_evolve` plus actions. Neighbour tags and context are overwritten in place, and the history field that should record this is never written, so the reason for an evolution is lost. Links are unbounded. Neighbours are referenced by list index, which breaks if memories are deleted or reordered.

## 6. Agent patterns
One implicit evolution agent (the LLM controller as a critic with a structured output). No confidence score; the decision is binary. Fallback: no neighbours or an LLM error means no evolution.

## 7. Model and data layer
OpenAI or Ollama through one controller (litellm also listed); `all-MiniLM-L6-v2` embeddings; Chroma store. No external data sources.

## 8. Hackathon-care checks
No structured trace, no sample mode, no Dockerfile. Tests check persistence and links, not retrieval quality. Keys from environment variables; no input sanitisation before embedding.

## 9. Traps seen
`evolution_history` declared but never written; unused private search helpers; LLM failure silently skips evolution; the README claims results on six foundation models with no experiment or paper link in the repository.

## 10. Reuse
MIT: copy with credit. Candidate parts: the note structure, the evolution decision schema.

## 11. Verdict: ADAPT for M6
Copy: (1) the note structure with links and tags as precedent state; (2) the structured evolution-decision schema; (3) neighbour-aware linking at insert time.
Avoid: (1) overwriting neighbours in place with no history; (2) index-based neighbour references, use stable ids; (3) a binary LLM evolve decision with no confidence or replay check.
Where we are already ahead: every rule or memory change in our design carries a certificate, a replay and a reason; A-mem keeps none.
