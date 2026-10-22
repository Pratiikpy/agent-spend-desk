# Profile: mem0ai/mem0

Reader: Haiku (low effort), 2026-10-16. Local clone, commit d26ba5e, package version 3.3.1. Paths below are relative to `mem0-ts/src/oss/src/memory/index.ts` unless stated.

Spot-check (reviewer, against the code): licence is Apache 2.0 (confirmed); version 3.3.1 (confirmed); MD5 hash dedup of memory text at lines 1020-1024 (confirmed); the temporal `referenceDate` parameter makes `search` throw a feature error at lines 1336-1343 (confirmed; the error text is a feature-gate message, so this is better read as a platform-only feature than as a broken stub); entity-link errors swallowed with `console.debug` and `console.warn` at lines 562-568 (confirmed); the README benchmark table states scores reflect the managed platform (confirmed near line 54). Not rechecked: the default model names and the hybrid scoring function. Result: PASS with one wording caveat.

## 1. What it is
A memory layer for AI agents: extract facts from conversation, store them in a pluggable vector store, retrieve them. Apache 2.0.

## 2. Architecture map
Client SDK, then an LLM for extraction, an embedder, a vector store, and a history store for audit. An entity store (a second vector collection) links memories to entities. Scoping by user, session (`run_id`) and agent. Entry points: SDK `Memory` class, CLI, self-hosted server (Docker), cloud platform.

## 3. Features and how each behaves
`add(messages)`: one LLM call extracts facts (with the existing nearest memories and the last 10 messages as context), embeds them, drops exact duplicates by hash, inserts, links entities. `search(query)`: hybrid retrieval (semantic, BM25 keyword, entity match) fused by `scoreAndRank`, optional reranker. Failure behaviour: empty extraction returns an empty list; embedding failure skips the entity; entity-store failure is logged and the add still succeeds.

## 4. How people use it
`npm install mem0ai` or `docker compose up`; the README quickstart is a chat loop of search, answer, add. Tests cover create, read, update, delete, search operators, entity filters and expiration. Issues and user feedback: NOT VERIFIED (not in the clone).

## 5. Mechanism for our module (M6 memory; M5 precedent)
Extraction is a single additive pass against a JSON schema; nothing is merged or deleted, so memory grows without bound. Only ADD and DELETE are tracked in history, with no update chain. Retrieval fuses three signals. Entity extraction uses heuristics with a fallback tokenizer. Temporal queries are gated to the managed platform. No confidence score is kept on a stored fact.

## 6. Agent patterns
None explicit: no roles, no critic loop, no confidence branching. Fallbacks are mechanical: batch embedding falls back to one-by-one, batch insert falls back to one-by-one. Shared state is the entity store and per-session history.

## 7. Model and data layer
Factories for LLMs (OpenAI, Anthropic, Groq, Mistral, Ollama, Bedrock, vLLM, LiteLLM), embedders and more than ten vector stores behind one abstraction. A memory payload holds text, hash, timestamps, scope ids and metadata.

## 8. Hackathon-care checks
Trace and log: history in a database and telemetry events, no structured JSONL trace. No sample mode. Docker compose present. Benchmarks are published, but the README says they reflect the managed platform and the open-source version gives directionally similar results; no harness in the clone to reproduce them. Security: provider keys in config; extraction prompt does nothing against injected text.

## 9. Traps seen
Entity-link errors swallowed; additive-only growth; benchmark numbers that do not describe the open-source build; no uncertainty on extracted facts.

## 10. Reuse
Apache 2.0: may be copied with notice and credit. Candidate parts: the factory and store abstraction, the phased batch pipeline, hybrid scoring, entity extraction heuristics.

## 11. Verdict: ADAPT for M6; not a fit for M5
Copy: (1) the phased add pipeline (context, embed, hash-dedup, batch entity link); (2) hybrid three-signal retrieval; (3) the entity-extraction heuristics and the store abstraction.
Avoid: (1) additive-only memory with no consolidation or obsolescence; (2) storing LLM-extracted facts with no confidence or provenance check, which our certified rules and quote checks already address; (3) publishing numbers that describe a different build than the open-source one.
Where we are already ahead: certified, replay-checked rules, deterministic quote checks and an offline verifier. mem0 has none of these.
