# Profile: thedotmack/claude-mem

Reader: Haiku (low effort), 2026-10-16, about 83 seconds, 90k tokens, 31 tool calls. Shallow clone (depth 1), version 13.40.0 (deleted after the profile pass). Paths relative to the repository root.

Spot-check (reviewer, against the code): Apache 2.0 and version 13.40.0 (confirmed); an exact-replay duplicate check on `sourceFingerprint` per project, returning "already saved" at `src/services/memory/save-memory.ts:25-37` (confirmed); a prompt that is entirely private is skipped with reason `private` at `src/services/worker/validation/PrivacyCheckValidator.ts:38-50` (confirmed); a vector-sync failure is logged and the observation is stored anyway, and a merged repeat keeps its original text and vector, at `save-memory.ts:44-55` (confirmed); continuation state for progressive search is held server-side with an expiry and an 8 MB cap at `src/shared/progressive-search.ts:51,73-75` (confirmed). Additions by the reviewer: the save path also calls a cloud-sync notify and a bot index notify (`save-memory.ts:46-48`), so stored memories can leave the machine when those are configured; the installer fetches runtimes (Bun, uv) globally per the reader, not rechecked. The one-hour cursor lifetime and the hook timeouts were not rechecked. Result: PASS.

## 1. What it is
A memory layer for coding agents: hooks capture tool use, a worker compresses events into observations with a model, SQLite plus a vector index store them, and context is injected into later sessions. The spec already adapts its progressive-disclosure interface (section 11). Apache 2.0.

## 2. Architecture map
Hook layer (session start, prompt submit, post tool use, summary, session end), a spool on disk so hooks never block, a worker daemon with an HTTP API, a store of observations in SQLite with a Chroma vector index, a progressive search service, a memory ingest tool for existing Markdown memories, an MCP `save_memory` tool.

## 3. Features and how each behaves
Capture records tool name, input and response, skipping recursive memory tools and excluded projects. Progressive search runs in three steps (search, timeline, fetch) with a server-held cursor. Ingest parses Markdown memories with a dry-run mode that touches no database. Explicit saves are deduplicated by fingerprint without any model cost. A hook that times out exits successfully so the editor is never blocked; if the worker is down, events wait in the spool.

## 4. How people use it
`npx claude-mem install`, then it works through hooks; search by command, MCP or the viewer. Tests cover ingest parsing. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M6 memory, M1 capture, M8 privacy)
Memory items have kind (observation, summary, prompt, manual), title, text, narrative, facts, concepts, files touched and metadata. Capture is fire and forget; compression happens later in a worker. Retrieval is progressive so prompts stay small. Privacy: tag stripping and secret redaction before logs; an all-private prompt is never stored. Lost: the compressed observation is a model's account, not the raw event (the raw tool output is spooled; its retention was not checked).

## 6. Agent patterns
A capture hook, a compressor agent in a worker, a search service. No critic and no confidence signal. Degradation is deliberate: hook time-outs, spool when the worker is down, lexical search if vectors are unavailable.

## 7. Model and data layer
Claude Agent SDK by default, also Gemini, OpenRouter and OpenAI-compatible providers; SQLite and Chroma; fallback lexical ranking.

## 8. Hackathon-care checks
Spool entries are JSON; a dry-run mode for ingest; Docker docs; API keys stored as hashes; secrets redacted from logs. Model cost is incurred for every captured tool use (the reader's note). Cloud sync and a bot index hook exist in the save path.

## 9. Traps seen
Dedupe by exact fingerprint only; vector-sync failure logged and ignored; a documented race between prompt privacy filtering and worker start-up (the check logs a warning and still allows ingestion, per the reader); fixed limits on injected context size and file size; per-use model cost.

## 10. Reuse
Apache 2.0: copy with credit, state changes. Candidate parts: spool-then-drain capture, three-step progressive search with a bounded server-side cursor, privacy validation before ingestion, fingerprint dedupe, ingest dry-run.

## 11. Verdict: ADOPT the progressive-disclosure and spool patterns for M6 and M1 (already in spec section 11); ADAPT privacy for M8
Copy: (1) capture that never blocks the host and spools when the worker is away; (2) search, timeline, fetch with a cursor that expires and has a byte cap; (3) a privacy gate that drops private content before it is stored, with the race closed (decide before the worker starts, not after).
Avoid: (1) a model call for every captured event: ours compresses only on a trigger; (2) ignoring a failed index write: record a gap; (3) any default path that sends stored memories to a cloud sync.
Where we are already ahead: precedents are replay-certified and carry trust labels; claude-mem stores a model's summary of what happened.
