# Profile: headroomlabs-ai/headroom

Reader: Haiku (low effort), 2026-10-16, about 136 seconds, 99k tokens, 29 tool calls. Shallow clone (depth 1), deleted after the profile pass. Paths relative to `headroom/` unless stated.

Spot-check (reviewer, against the files): Apache 2.0 (confirmed); the compression store writes and recognises markers of the form `<<ccr:HASH,...>>` at `cache/compression_store.py:363-419` (confirmed); the public `compress(messages, model=...)` entry exists in `compress.py` (confirmed). The savings figures (30 to 57%, 90% best case), the default of protecting the last four messages, the telemetry default, the cache lifetime and the sampling split (55/30/15) were not rechecked. The reader contradicted itself on telemetry (anonymous reporting that can be turned off); the default is NOT VERIFIED. Result: PASS on structure; numbers are the project's own.

## 1. What it is
A compression layer for everything sent to a model: tool outputs, logs, retrieved chunks, files and history. It can be used as a library, as an HTTP proxy or by wrapping an agent. Apache 2.0.

## 2. Architecture map
A content router sends JSON to a Rust-backed array compressor, code to an AST-aware compressor, prose to a trained text model; a cache aligner keeps the stable prefix of a prompt byte-identical so the provider's prompt cache still works; a compress, cache, retrieve mechanism stores what was dropped and injects a retrieval tool.

## 3. Features and how each behaves
Messages in, messages out, with token counts and optional per-message diagnostics. Defaults per the README: user messages skipped for coding agents, the latest few messages protected, a minimum size before compression. Malformed JSON, failed parses and compression that grows the text fall back to the original. Missing optional dependencies produce a log warning and a pass-through.

## 4. How people use it
Install with a tool installer or pip or npm; call `compress`, or run the proxy and point an application at it, or wrap an agent with one command. A seeded benchmark script regenerates the published table.

## 5. Mechanism for our module (M7 context economy, reversible compression)
Dropped rows are replaced by a marker holding a hash and a row count, and the original is stored locally under that hash; the model can call a retrieval tool with the hash, or the marker can be resolved in place for callers that never see tool calls. Selection of kept rows mixes importance-scored rows with the start and end of the array, and always keeps errors, anomalies, unique identifiers and change points. Lost: the dropped rows are recoverable only while the cache entry lives; the cache lifetime was not documented in what the reader saw.

## 6. Agent patterns
None of its own; it is a layer. A shared context can be passed across agents by the caller.

## 7. Model and data layer
A published text-compression model, BM25 relevance, an optional vector backend, model-specific token counting, a local SQLite or in-memory store.

## 8. Hackathon-care checks
Reproducible seeded benchmark offline; Docker image available; local processing. The project's own limitations page warns that its quoted savings are single measurements and that best cases (repetitive logs and arrays) are not typical, and that tail protection hides most savings in short conversations.

## 9. Traps seen
Headline savings are best-case; reversibility is only as long as the cache lifetime; code compression often passes through by design; a silent fallback if an optional library is missing.

## 10. Reuse
Apache 2.0: copy with credit and notice. Candidate parts: the reversible marker and hash store design, always-keep rules for errors and anomalies, the cache aligner idea, the honest limitations page and the seeded benchmark.

## 11. Verdict: ADAPT the reversible-marker idea for M7; do not take the numbers
Copy: (1) reversible compression: a marker with a content hash, the original stored under that hash, a retrieval tool; (2) never drop errors, anomalies and unique identifiers; (3) a limitations page that states which of the vendor's numbers are best cases.
Avoid: (1) a recovery window that can expire: for evidence, the original stays in the immutable store forever; (2) silent pass-through when a dependency is missing: fail at start-up; (3) any default outbound reporting.
Where we are already ahead: evidence is addressed by hash in an append-only store, so a compressed view can always be expanded and re-verified.
