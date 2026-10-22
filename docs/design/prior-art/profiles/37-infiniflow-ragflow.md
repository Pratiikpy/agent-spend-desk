# Profile: infiniflow/ragflow

Reader: Haiku (low effort), 2026-10-16, about 86 seconds, 102k tokens, 34 tool calls. Shallow clone (depth 1) of the default branch, version 1.0.0-rc2 (deleted after the profile pass). Paths relative to the repository root.

Spot-check (reviewer, against the files): Apache 2.0 (confirmed); version 1.0.0-rc2 in `pyproject.toml` (confirmed); the connector interface with `Validate`, `OpenSync` and `OpenPrune` at `internal/syncer/connector/interface.go:53-61` (confirmed); general chunker defaults of 512 tokens, newline delimiter and no child delimiters at `internal/ingestion/component/chunker/general.go:59-65` (confirmed); chunk ids computed from the document id and the chunk text at `chunker/register.go:116-119` (confirmed); the citation prompt requires `[ID:i]` per source, forbids ranges, puts citations before punctuation and allows at most four per sentence at `internal/rag/prompts/citation_prompt.md:4-9` (confirmed); `ErrSyncResumeInvalid` is described in the syncer README at lines 463-469 (confirmed). The Go code is a new layer next to the older Python application; the reader's counts (about 50 connectors) and the layout-model details were not rechecked. Result: PASS.

## 1. What it is
An open-source RAG engine built around deep document understanding, template-based chunking, grounded citations, ~50 data-source connectors and an agent canvas. Apache 2.0.

## 2. Architecture map
A syncer with connector sessions (sync and prune), format parsers (PDF through Docling or MinerU, Word, HTML, images with OCR, layout and table models), a chunker registry with strategies (general, table row, one-chunk, hierarchy, page, manual, Q&A), and an agent runtime that executes a component graph (begin, retrieval, model, citation, loop, parallel).

## 3. Features and how each behaves
Sync opens a fixed window, returns batches (with lazy fetch references and fingerprints so unchanged items are skipped), keeps a cursor checkpoint, and a prune pass removes documents that disappeared at the source. Transient errors (timeout, 429, connection reset) retry three times, others twice. Citations are inline ids and a post-processing component grounds them after streaming.

## 4. How people use it
Docker or the hosted cloud; configure a connector (for example by OAuth), set a refresh frequency, build a knowledge base, chat. REST tests with pytest and browser tests with Playwright. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M2 document intelligence, M1 connectors)
The best idea is the connector contract: the connector never writes to the database or creates document ids; the runner owns the checkpoints; a connector that cannot continue from a cursor says so with a specific resume-invalid error and the runner restarts the window instead of skipping. Batches must be in a stable order or a resume duplicates. Chunking is a registry of named strategies with deterministic ids. Lost: positions between chunks and media beyond the payload.

## 6. Agent patterns
A component graph, one pass of retrieve, answer and cite; no critic loop and no confidence branching seen.

## 7. Model and data layer
Pluggable language and embedding models per knowledge base; tokenizers local (layout models on ONNX, a tiktoken-compatible tokenizer for chunk sizes); connector registry by source name.

## 8. Hackathon-care checks
Docker image per release; benchmark suite folder exists (contents not read); a debug cap on chunks in the preview; credentials live in each connector's config map with no stronger isolation. Trace format: NOT VERIFIED.

## 9. Traps seen
Unstable batch ordering duplicates on resume; checkpoints kept inside a connector are unsafe (only the runner may hold them); a connector writing straight to the store breaks the boundary.

## 10. Reuse
Apache 2.0: copy with credit and notice. Candidate parts: the connector interface and sync, prune and checkpoint contract; the chunking strategy registry; the citation prompt rules; deterministic chunk ids.

## 11. Verdict: ADOPT the connector contract for M1; ADAPT the chunking registry and citation rules for M2 and M4
Copy: (1) sync and prune sessions with runner-owned checkpoints and a distinct resume-invalid error; (2) a registry of named chunking strategies with ids derived from document and content; (3) citation format rules: one id per source, no ranges, a cap per sentence.
Avoid: (1) connectors that write documents themselves; (2) unordered batches; (3) citations as ids only: ours also carry a verified quote and offsets.
Where we are already ahead: a connector result is a typed, hashed, replayable source record; the citation is checked against stored text without a model.
