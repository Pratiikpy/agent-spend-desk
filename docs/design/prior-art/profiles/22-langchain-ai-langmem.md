# Profile: langchain-ai/langmem

Reader: Haiku (low effort), 2026-10-16, about 77 seconds, 88k tokens, 26 tool calls. Local clone. Paths relative to `src/langmem/` unless stated.

Spot-check (reviewer, against the code): MIT licence, copyright LangChain (confirmed); `trustcall>=0.0.39` is a declared dependency in `pyproject.toml:12` (confirmed); the memory manager defaults `enable_inserts=True`, `enable_updates=True`, `enable_deletes=False` and `max_steps` of 1 at `knowledge/extraction.py:224-226,243-245` (confirmed); a `Done` tool is offered to the model to end refinement at `extraction.py:209,270,280` (confirmed); the instruction "Consolidate and compress redundant memories ..." at `extraction.py:196` (confirmed). Correction by the reviewer: the reader called trustcall "closed source"; it is an ordinary package dependency and its licence was not checked here, so that remark is dropped and the licence is NOT VERIFIED. Result: PASS with that fix.

## 1. What it is
A library for agent memory: extraction of facts from conversations, consolidation (insert, update, delete), a background executor, and prompt optimisation. MIT.

## 2. Architecture map
A storage-free core (`create_memory_manager`, `create_prompt_optimizer`), a stateful layer on the LangGraph store (`create_memory_store_manager`, memory tools), a reflection executor for deferred runs, and short-term message summarisation.

## 3. Features and how each behaves
Three memory kinds in the docs: semantic (facts or one profile document), episodic (past interactions as examples), procedural (rules in the prompt). The manager receives messages plus existing memories and returns insert, update or delete actions; each memory has an id. Extraction is done by tool calls against typed schemas.

## 4. How people use it
`pip install langmem`; define a schema, create a manager, call it with messages and existing memories; or attach manage and search tools to an agent (hot path), or run extraction after the turn in the background. Tests and issues: NOT VERIFIED.

## 5. Mechanism for our module (M6 consolidation and learning)
Update versus insert is decided by whether an existing document id is present in the model's tool call; deletion is an explicit remove action. Consolidation is only a prompt instruction ("compress redundant memories, strengthen by reliability and recency"), with no algorithm behind it. Refinement can run several steps until the model says done, but the default is one. Lost: the manager's deletions are left to the caller, and there is no record of why a memory changed.

## 6. Agent patterns
Hot-path tools chosen by the agent, or background extraction with a delay and debounce. No critic, no confidence.

## 7. Model and data layer
Any chat model through LangChain; typed schemas; the LangGraph store for persistence and semantic search.

## 8. Hackathon-care checks
LangSmith tracing hooks exist; defaults NOT VERIFIED. No sample mode or Docker found. No eval suite found. Keys come from the environment.

## 9. Traps seen
Consolidation correctness rests on the model; deletes are off by default and returned as markers the caller must act on; one instruction string for several schemas; a single step by default means one pass at consolidation.

## 10. Reuse
MIT: copy with credit. Candidate parts: the manager loop with insert, update and delete flags, the remove marker, the deferred reflection executor with debounce.

## 11. Verdict: ADAPT for M6
Copy: (1) separate switches for insert, update and delete, with delete off by default; (2) a debounced background executor that runs consolidation after the turn; (3) the three-way split of semantic, episodic and procedural memory as a design vocabulary.
Avoid: (1) consolidation by prompt alone with nothing checked afterwards: ours is a proposed rule with replay and confirmation; (2) deletions with no recorded reason: supersede with a validity window and keep the history; (3) one instruction for all memory types.
Where we are already ahead: certified, replay-checked rule changes; LangMem trusts the model's merge.
