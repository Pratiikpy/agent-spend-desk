# Profile: meterless/meterless (sponsor reference repository)

Reader: Haiku (low effort), 2026-10-16, about 148 seconds, 97k tokens, 26 tool calls. Local clone. Paths relative to the repository root. The reader's account of the git history is NOT VERIFIED (the clone's history was not examined).

Spot-check (reviewer, against the files): Apache 2.0 (confirmed); engines are `hmem`, `markovian`, `scout-intent`, `world-model` (confirmed by listing); H-MEM retrieval formula `0.35 semantic + 0.20 keyword + 0.10 tag + 0.10 domain + 0.15 entity + 0.05 layer + 0.05 recency - 0.20 superseded`, threshold 0.35 on the final score, top 5, at `engines/hmem/AGENTS.md:152-161` (confirmed); auto-resolve conflicts only at confidence 0.70 or more, losing record marked `supersededBy` and never deleted, at line 329 (confirmed); feedback deltas +0.05, -0.03, -0.20 at line 374 (confirmed); conformance runs take `HMEM_IMPL`, `MARKOVIAN_IMPL`, `WORLD_MODEL_IMPL` environment variables (confirmed); the README states that the products Gaia, Relay and Swarms are proprietary and ship from separate repositories (README lines 70 and 100, confirmed); no network call in the H-MEM reference source (search found none). The Scout evaluation set size, the 86% token-savings model and the World Model details were not rechecked. Result: PASS.

## 1. What it is
A local-first "context stack" for agents: four engine specifications with reference implementations and conformance suites, plus docs for three proprietary products built on them. Apache 2.0.

## 2. Architecture map
Stack in the README: Scout Intent (intent and policy guard, signed execution contract), H-MEM (tiered memory) and World Model (append-only fact log with derived views), Markovian (long tasks in bounded chunks with carryover) or Swarms, then a quality layer and surfaces. Each engine folder has an `AGENTS.md` spec, `reference/` code, `conformance/`, `examples/`. Imports only; there is no HTTP service and no daemon.

## 3. Features and how each behaves
H-MEM: short-term, working and long-term layers; mining of seven event types; hybrid ranking; dreaming (insight proposals), sleep (consolidate, archive, synthesise, with preview and backup), conflict detection, a trust ledger with 17 action types, every record requires a `source`. World Model: a six-stage ingest (extract, normalise, resolve, validate, append, project) over an append-only log, idempotent by construction. Markovian: chunk size, maximum chunks and carryover are bounded settings with a checkpoint and a completion marker. Scout Intent: five stages ending in a signed execution contract.

## 4. How people use it
`npx degit` an engine folder, read its `AGENTS.md`, implement from the spec (or use the reference), and pass the conformance runner with the `*_IMPL` variable. Scout has an evaluation harness instead. The references use deterministic mock embeddings and mock generators, which the code says openly. A hackathon starter template is included.

## 5. Mechanism for our module (M6 memory, M3 world model, M5 contract)
This is the part that matters most for the sponsor requirement. The engines are reference architectures that call an injected generator and embedder; they do not require a Meterless server. The conformance suites test arithmetic the spec fixes (formulas, deltas, thresholds), not retrieval quality. Whether Meterless offers a hosted runtime or API: NOT VERIFIED here and still waiting on the sponsor's answer.

## 6. Agent patterns
No multi-agent loop. Services are called in sequence: store, mining, retrieval, dreaming, sleep, ledger, conflicts. Human approval is built in for conflict review below 0.70, dream proposals and sleep previews.

## 7. Model and data layer
Generators and embedders are injected; the reference embedding is a deterministic hash that passes tests but has no semantic meaning. Provenance for every record: origin, learned-at time, label, optional references.

## 8. Hackathon-care checks
The reference runs offline in seconds, has test vectors and a runner with PASS and FAIL per item, and appends every change to a ledger. No Docker. Claims such as the 86% token saving are modelled by the authors, not measured in the reference (the reader's account, not rechecked).

## 9. Traps seen
A passing conformance suite does not show good retrieval; mock embeddings must be replaced before any quality claim; confidence range is documented, not enforced; a no-model mining fallback stores raw summaries only; sleep archiving is irreversible without the backup.

## 10. Reuse
Apache 2.0: copy with credit and notice. Product binaries and brand names are not covered. Candidate parts: the ranking formula, the 17-action ledger vocabulary, the supersede-never-delete rule, the conformance style of testing, the preview-before-commit pattern.

## 11. Verdict: ADOPT the engine specs as our M6 and world-model contracts, with real embeddings and our own tests
Copy: (1) the ranking formula, thresholds and feedback deltas as the starting point for M6, calibrated on our gold cases; (2) the append-only ledger with previous and new state, and supersede-not-delete; (3) conformance vectors for every memory rule we claim.
Avoid: (1) claiming a Meterless "runtime" integration without an answer from the sponsor; (2) mock embeddings in any quality number; (3) irreversible archiving without preview and backup.
Where we are already ahead: rule changes require replay and a confirmation step with a certificate; H-MEM auto-resolves above 0.70 with a heuristic.
