# Best-of synthesis by module: what we take from every profiled repository (adoption register)

Status: design input for spec v5.2 (D-026). Date: 2026-10-16. Built from profiles 01 to 56 in this folder (the roster `98-roster-and-reader-comparison.md` lists every repository, reader and status; later profiles are added to this register as they are read). Every profile was read by a model reader and its claims spot-checked by the reviewer against the code; where a profile says NOT VERIFIED, that stands here. Nothing below is built or measured: each row is an adoption decision with a named gate. A gate that does not pass means the item is not claimed.

How to read a row. **ID** is stable and is cited by the spec (section 21a-5), the PRD feature list and the module blueprints. **From** gives profile numbers. **Gate** is the test or measurement that must pass before the item counts as done. Items marked **(P)** are principles that apply to every module.

Licence rule applied throughout. MIT and Apache 2.0 sources: code may be copied with credit and notice, except: Mastra `ee/` directories (separate enterprise licence, never copied), SAFE (long-form-factuality; the clone's licence file covers only third-party MIT text and the README says Apache, so NOT VERIFIED: no code or prompt copied), LangMem's `trustcall` dependency (licence NOT VERIFIED), and bundled datasets or 3D models inside a repository (for example the non-commercial datasets in gods-eye-view), which are never copied. Rows tagged below say what is allowed. No-licence sources (profiles 18 and 32): ideas only, implemented independently. AGPL, source-available or modified licences (Firecrawl, n8n, Dify, PyMuPDF): mechanism only, no code. Profile 09 (the old `letta` repository) is a reject: its owners forbid copying it; the current implementation is profile 48.

## A. Principles that apply everywhere (P)

| ID | Adopt | From | Gate |
|---|---|---|---|
| P-1 | **No silent failure.** Every failed branch, parse, retrieval, summary, skipped file, probe or fallback becomes a recorded gap with its reason. Never a placeholder, default, random answer, canned reply, "supported" default, or empty content that looks like content. | 03, 06, 12, 13, 14, 17, 23, 24, 25, 26, 28, 31, 34, 35, 36, 44, 45, 49 | Fault injection kills each dependency in turn and corrupts each model reply; every run shows a gap record and no default value. A static sweep (silent-failure review) finds no swallowed exception on a decision path. |
| P-2 | **Fail closed, including the gate itself.** An error, a missing config or a failed import in a gate is a refusal. A gate is never off by default. | 38, 49 (negative example), 15 | Test: remove each gate dependency; the action is refused and the refusal is recorded. |
| P-3 | **No outbound call that is not a declared source.** No telemetry, trace export, cloud sync or index notification by default. Start-up refuses undeclared egress. | 34, 15, 43, 46 | Network-egress test on a clean run: only declared hosts appear. |
| P-4 | **Fail at configuration time, not run time.** Invalid allow lists, wrong middleware order, missing optional libraries, same model for proposer and critic, mismatched index manifests are start-up errors. | 41, 40, 43, 32, 44, 34 | Start-up validator with one test per rule. |
| P-5 | **Measure, never quote.** Vendor and paper numbers (mem0 platform scores, Markovian 86%, PageIndex 98.7%, Headroom best case, Self-RAG) are not ours. We publish our own measured numbers with their conditions, including best-case versus typical. | 01, 33, 42, 43, 10 | Documentation lint: no number without a run id and conditions. |
| P-6 | **Document every accepted inconsistent state** with its reason and how it heals; "silent failure" is never one of them. | 45 | Each store boundary has a written residue entry; reviewed in the integration pass. |
| P-7 | **The record comes first.** (OpenClaw's audit ledger is best effort and can lose records on a crash or a full queue; Vectimus continues after an audit write failure; Hermes returns success after a failed staging write.) An irreversible action is not final until its decision record is stored; an audit write failure stops the action. | 38 (negative), 49 (negative) | Test: fail the ledger write; the release is refused. |
| P-8 | **Licence hygiene register** as above, kept in `docs/sponsors/ai-use-provenance-log.md` with one line per borrowed mechanism. | all | Repository audit lists every vendored file with licence and credit. |

## B. M1 Source Fabric

| ID | Adopt | From | Gate |
|---|---|---|---|
| M1-1 | Connector contract: validate, open a sync window, open a prune snapshot; the runner owns checkpoints; a connector that cannot resume says `ResumeInvalid` and the window restarts; batches have a stable order. | 37 | Resume test with a killed run: no duplicates, no skips. |
| M1-2 | Provider interface returns data, time, warnings and structured divergences between sources; a circuit breaker skips cooling-down sources; a stale cached row is flagged and never re-cached as fresh. | 30 | Planted divergence is reported; stale row stays stale across a second read. |
| M1-3 | Live-web channel runs under a policy watchdog on the navigation event path: allow list, block list, IP block, blocked tab to a blank page. | 41 | Navigation to a blocked host is refused with a record. |
| M1-4 | Incremental refresh by content hash (insert new, update changed, skip same). | 35 | Re-run on unchanged sources makes zero writes. |
| M1-5 | A failed fetch is a gap record, never an empty document. | 34, 35, 30 | Fetch of a dead URL yields a gap, no zero-byte content. |
| M1-6 | Secrets refuse to serialise; a credential broker keeps secrets out of any sandbox and any model context. | 34, 40 | Saved configs contain no secret; sandbox environment dump contains none. |
| M1-7 | Capture that never blocks the host and spools when a worker is away, drained later. | 46 | Kill the worker mid-run; nothing is lost on restart. |
| M1-8 | Live-web fetch (mechanism only, AGPL source): an ordered list of fetch engines with a timeout each and a total retry budget split by failure category; pre-flight gates for robots rules, allow and block lists, private-address blocking and an optional threat check; extraction against a schema where a verified quote is still required. [mechanism only: AGPL source] [evidence: reader's account; reviewer checked licence, identity and file existence only] | 54 | Dead-engine test falls through in order; budget exhaustion is a gap; private address refused. |
| M1-9 | Credentials are references (id and name), never values, in connector and workflow definitions; every handler reference (error handler, approval callback) is validated at save time and re-checked on a schedule so a stale link is found before it fails. [idea only: source-available licence (n8n)] [evidence: reader's account; reviewer checked licence, identity and file existence only] | 53 | Delete a handler target: the doctor reports the stale reference before any run. |

## C. M2 Document Intelligence

| ID | Adopt | From | Gate |
|---|---|---|---|
| M2-1 | Deterministic structure pass: headings from style and numbering, node page ranges, end page inferred from the next heading and promoted to the subtree maximum; record the structure source (detected, bookmarks, hybrid, pages, unreadable). Feeds the spec's document tree and cross-references. [evidence: reader's account; reviewer checked licence, identity and file existence only] | 42 | Gold documents: tree matches annotated outlines; flat documents are handled and labelled. |
| M2-2 | Outline-first reading: show the tree, then fetch only chosen pages, with an error envelope that says what to do next. [evidence: reader's account; reviewer checked licence, identity and file existence only] | 42 | Token and egress measured against a full-dump baseline. |
| M2-3 | Registry of named chunking strategies with ids derived from document and content; splitter cascade (paragraph, sentence, punctuation, space, character) with a budget that reserves room for metadata; a wider context window stored beside each chunk. | 37, 35, 24 | Same input yields the same chunk ids; metadata never overflows the budget. |
| M2-4 | Evidence text is stored beside every embedding; an embedding without its text is invalid. | 35 | Schema check. |
| M2-5 | NLP-only extraction path and a mock model so the whole pipeline runs offline. | 26 | Offline run completes with a gap record where the model would have been used. |
| M2-6 | Unreadable or empty content is a recorded gap with a reason. | 35, 34 | Planted corrupt file appears in the gap list. |

## D. M3 Reconcile

| ID | Adopt | From | Gate |
|---|---|---|---|
| M3-1 | Deterministic entity ids derived from normalised keys; tiered duplicate-candidate generation (exact, normalised, fuzzy, embedding) as a candidate source only. | 08, 02 | Same input, same ids; candidate recall measured on the gold set. |
| M3-2 | Capped re-ask loop for missed entities and relations, with the cap and the stop reason recorded. | 26, 06, 45 | Recall gain measured against one pass. |
| M3-3 | A generated item is never forced onto the nearest candidate: a model-invented fact is dropped and recorded (no zero-cutoff matching). | 44 | Planted invented fact is dropped, not attached. |
| M3-4 | Incremental merge with per-source accounting, and rebuild of derived state from cached extractions when a source is retracted, with no new model call. Recovery records are written before any mutation; if they are missing, removal is refused. | 45, 44 | Retract a source: affected entities recompute exactly; missing anchor refuses. |
| M3-5 | An index manifest fingerprints the extractor, embedding model and normaliser; a mismatched state is refused. | 44 | Swap the embedder: old index is refused with a reason. |
| M3-6 | Source divergence is data in the truth table, with provenance and a staleness flag. | 30 | Planted two-source conflict appears as `unresolved`. |
| M3-7 | Edges keep predicate and direction (owner of, paid to, listed on); relations are never reduced to undirected co-occurrence. | 44 | Schema check; ownership-chain test. |

## E. M4 Explain

| ID | Adopt | From | Gate |
|---|---|---|---|
| M4-1 | Citation recall (cited evidence jointly entails the claim) and citation precision (drop one citation at a time) as evaluation metrics, with a human-agreement check of the metric itself. | 11 | Metric agrees with annotators on the gold set before it is used in a report. |
| M4-2 | Capped iterative evidence search where each next query depends on what is known; claim rewrite to be self-contained; relevance filter before spending queries. [idea only for SAFE prompts: its licence text in the clone is NOT VERIFIED; no prompt is copied] | 19, 12, 24 | Searches never exceed the cap; unknown relevance is kept and reported. |
| M4-3 | Claims are also extracted from our own draft and each is searched (draft branch beside the question branch); per-passage snippet filter; citation renumbering of only the citations used. | 25 | Planted unsupported sentence in the draft is caught. |
| M4-4 | Several stakeholder perspectives (compliance, treasury, fraud, vendor relations) ask questions of the evidence before the explanation is written; outline revised against what was found; model assignment per stage. | 36 | Perspective ablation: removing one changes at least one finding on the gold set, else it is dropped. |
| M4-5 | Audit check that every number, date and name in an explanation matches a stored record (narrative-numeric grounding), run before display. | 30 | Planted wrong figure in a draft is rejected. |
| M4-6 | Refuse to write an explanation when no evidence was gathered; say so. A source-curation pass before writing. | 28 | Empty-evidence case yields a refusal, not a draft. |
| M4-7 | Delegated sub-tasks carry fully standalone instructions; parallel units and iterations are capped; a failed unit is an evidence gap. | 23 | Failed unit visible in the trace as a gap. |
| M4-8 | Long-horizon runs compress at a token budget into a restartable state that keeps every evidence handle; the full trajectory stays on disk. | 31 | Rebuild the trace from the summary plus handles. |
| M4-9 | Research budget by breadth halving and depth decrement, recorded. | 03 | Budget never exceeded; stop reason in the trace. |
| M4-10 | Reflection outputs only the missing questions and stops when there are none. | 24 | Loop ends on empty; cap otherwise. |
| M4-11 | Evidence-gap rollback: after a hypothesis step, a gap check can return the case to an earlier snapshot within a budget (implemented from the idea; profile 32 has no licence). [idea only: no licence (ClinicalAgents-Code)] | 32 | Rollback test restores state exactly; budget enforced. |
| M4-12 | Optional bounded search over candidate explanations that keeps pruned branches as recorded alternatives with their reason (ablation-gated). | 16 | Ships only if an ablation shows a gain. |
| M4-13 | Disagreement between model families is a signal that routes to review; it never decides. [idea only: profile 18 has no licence] | 17, 18 | Disagreement raises review; never changes a verdict alone. |
| M4-14 | The model that attacks or critiques differs from the model that proposed, enforced at start-up. [idea only: profile 32 has no licence] | 32 | Same-model configuration fails start-up. |

## F. M5 Decide

| ID | Adopt | From | Gate |
|---|---|---|---|
| M5-1 | Checks on an irreversible action are blocking, run before any irreversible tool, and apply to every agent and every handoff, not only the first. | 15 | Parallel-check regression test: no tool runs before the verdict. |
| M5-2 | Three outcomes for a pre-action check: allow, reject with reason and content, raise; the refusal reason is recorded. | 15, 13 | Each outcome has a test and a trace event. |
| M5-3 | Pause and resume from a serialised run state; the irreversible call happens once, after approval, under a one-time key; a resumed step never repeats work before the pause. | 07, 15, 34 | Crash-and-resume test: one payment, not two. |
| M5-4 | Rule annotations (id, incident, controls, suggested alternative) travel inside every decision; an observe mode records what would have been blocked, with an alarm if it stays on; decisions carry signed canonical receipts. | 38 | Annotated decision recomputes; observe mode left on raises a doctor warning. |
| M5-5 | Bounded two-sided debate (release versus hold) before a human sees a case, with the turn limit visible; ends by a disagreement measure or the cap. | 29 | Ablation shows the debate changes at least one routing on the gold set, else it is a roadmap item. |
| M5-6 | Guardrail retry feeds the failure reason back, capped. | 14 | Retry count and reason in the trace. |
| M5-7 | Action and observation events linked by id; a user rejection is its own observation with a reason; risk labels derived by rule, not predicted by the proposing model; a confirmation id set prevents double approval. | 47 | Double-click approval is a no-op. |
| M5-8 | Pin the exact object a reviewer saw; refuse to apply an approval if it changed (also for rule and memory proposals). | 49 | Change the object after staging: approval is refused. |
| M5-10 | Approval binding extended to the coding pack and to any tool call that runs a file: bind argv, working directory, environment hash, executable identity (real path for protected binaries, content hash for writable ones) and one concrete file operand; re-check before launch; if the binding cannot be made honest, refuse to mint the approval instead of pretending; redemption is single-use. | 56 | A file changed between approval and launch is refused; ambiguous operand refuses minting. |
| M5-9 | Pre-action policy gate precedent for the coding pack (forbid-only rules, two-pass inspection of file and script content, host adapters). | 38 | Coding-pack red-team set. |

## G. M6 Memory and Learning

| ID | Adopt | From | Gate |
|---|---|---|---|
| M6-1 | Meterless H-MEM ranking formula, thresholds, feedback deltas, supersede-never-delete and the 17-action ledger as the starting contract, calibrated on our gold cases; reference mock embeddings never appear in a quality number. | 33, 01 | Conformance runners plus our extended suites; calibration report. |
| M6-2 | Retrieval from several signals (semantic, keyword, entity), with recency by real time, importance and a validity window. [idea only: the formula is not copied (spec section 19a rejects copying the Generative Agents retrieval formula); our weights are calibrated on our cases] | 01, 20, 33 | Ablation per signal. |
| M6-3 | Outcome memory: record the decision, wait for the real outcome (payment result, dispute, override), then write the lesson. | 29 | Outcome arrives later: lesson proposed, not applied without certificate. |
| M6-4 | Separate switches for insert, update and delete (delete off by default); consolidation runs debounced in the background. [LangMem is MIT; its `trustcall` dependency licence is NOT VERIFIED, so no code is taken from it] | 22 | Delete requires an explicit, logged enablement. |
| M6-5 | Reflections are nodes that point to their evidence ids. | 20 | Every reflection resolves to stored evidence. |
| M6-6 | Stable ids, never list positions; a written change history for every evolution. | 04 | Delete a record: no dangling index; history present. |
| M6-7 | Personalised-PageRank candidate source for shared nominees, addresses and accounts, behind an ablation (already in spec section 11). | 44 | Ships only if it finds relevant precedents that feature similarity misses. |
| M6-8 | Memory as versioned files or records with validated constraints (depth, size, required fields, protected paths); the validator rejects, never repairs. | 48 | Invalid proposal rejected with a list of errors. |
| M6-9 | Frozen memory snapshot for the length of one decision; changes appear in the next. | 49 | Retrieval is a pure function of the pin (already in spec). |
| M6-10 | Progressive disclosure (search, timeline, fetch) with a server-held cursor that expires and has a byte cap. | 46 | Token and egress measured against a full dump. |
| M6-11 | Memory technique coverage checklist (30 techniques) and LoCoMo-style evaluation; read notebooks 14, 18, 19 and 29 directly. | 27 | Coverage matrix filled; evaluation run. |
| M6-12 | Insert-time privacy gate decided before the worker starts (no race). | 46 | Race test: private prompt never stored. |
| M6-13 | Four-signal recall (vector, keyword, entity-graph expansion, time window) fused by reciprocal rank (k = 60 as a starting value) then reranked; calibrated on our cases. | 50 | Ablation per signal; calibration report. |
| M6-14 | Non-destructive reconciliation: merge only above a high similarity, only within the same scope, only after a full-text check; supporting evidence folds together and contradictions stay apart. | 50 | Planted near-duplicate with a changed number stays separate. |
| M6-15 | Per-scope switch for storing raw source text; a data-minimising scope keeps only derived facts and the source hash. Extraction errors fail the retain by default and record the count. | 50 | Erasure test; a retain with one failed extraction is marked failed. |
| M6-16 | Reflect-style bounded investigation over memory (tool loop with a step cap and a sufficiency check) with cited results, as the precedent explainer. | 50 | Cap enforced; every citation resolves. |

## H. M7 Orchestration Runtime

| ID | Adopt | From | Gate |
|---|---|---|---|
| M7-1 | Typed sockets between components, per-component run limits, and a snapshot at every pause point. | 34 | Mis-wired graph fails at build time. |
| M7-2 | Fixed-order middleware chain (isolation, summarise, memory, clarification last) with a start-up order validator. | 40 | Misordered chain fails start-up. |
| M7-3 | Reversible compression: marker with a content hash, original kept in the immutable store (no expiry for evidence), retrieval tool; never drop errors, anomalies or unique ids. [Apache 2.0; reader-only evidence, cache lifetime NOT VERIFIED] | 43 | Expand any compressed view and re-verify. |
| M7-4 | Hard stop on spend and rounds in the run loop, visible in the trace. | 39 | Budget test (already in spec). |
| M7-5 | Scripted or replay model for deterministic tests; typed event schemas for model calls, messages and dropped messages. | 13, 15, 35 | Whole suite runs offline. |
| M7-6 | Acceptance checks on delegated work, with the caveat stated in the report: they prove execution, not correctness. | 40 | Report text lint. |
| M7-7 | Scheduler: advance next-run time before dispatch, mark a pending slot, restore a missed slot exactly once, ledger blocks a second fire. | 49 | Crash test: at most once, never dropped silently. |
| M7-8 | Suspend snapshot shape (status, payload, started, suspended and resumed times) with a guard against overwriting a resumed step; ordered processors (memory, filters) in front of the model call; references to earlier delegated results so work is not repeated, wrapped as untrusted data. We re-read the TypeScript design as a direct comparison for our own runtime. [Apache 2.0 outside `ee/`; never copy `ee/` code (profile 51); reader-only evidence] | 51 | Snapshot round trip; no tool re-execution on resume. |
| M7-9 | Per-output failure strategies with fixed precedence and a retry budget; "use default" is allowed only for non-decision outputs and is always recorded. [idea only: modified Apache with tenancy and branding conditions (Dify)] [evidence: reader's account; reviewer checked licence, identity and file existence only] | 52 | A decision output can never be defaulted. |
| M7-10 | Graph validator that checks topology and handler references before any run. [idea only: Dify and n8n licences] [evidence: reader's account; reviewer checked licence, identity and file existence only] | 52, 53 | Invalid graph fails start-up. |

## I. M8 Security, M9 Audit, M10 to M14

| ID | Adopt | From | Gate |
|---|---|---|---|
| M8-1 | Deserialisation allow list; trusted-namespace component loading. | 34, 13 | Load of an unlisted class is refused. |
| M8-2 | Sensitive-data placeholders in prompts, replaced only at action time; masking also covers logs and screenshots. | 41 | Search of logs finds no secret. |
| M8-3 | Fail-closed confinement launcher for any unattended writer; refuses to run on a weaker policy. | 48 | Run without a sandbox backend: refused. |
| M8-4 | Pattern scan for injection and command-and-control text on memory writes, as a signal only. | 49 | Signal logged; never a gate. |
| M9-1 | Signed receipts over canonical JSON (RFC 8785) next to the DSSE envelope; schema version on every audit record. | 38 | Verifier round trip; unversioned record rejected. |
| M10-1 | Stable agent ids, never role strings; allowed-subagent lists per agent. | 14, 40 | Rename a role: routing unchanged. |
| M10-2 | Addressed messages and subscription sets; document status (draft, under review, approved) as case state. | 39 | A role sees only what it subscribed to. |
| M10-3 | App Server with a control channel and a stream channel and scoped tokens. | 48 | Token scope test. |
| M10-4 | Doctor output states every platform-dependent behaviour (for example a feature off on Windows). | 48 | Doctor lists each. |
| M10-5 | Console information architecture: every source and every panel always shows a status and a last message including "empty because X"; independent layers (sources, evidence, cases, agents) with a roster of the currently relevant items; side rails with fixed headers and outward popups; first-run missions that teach by doing one real task and end with a reset; a doctor command; a bundled sample pack for offline demonstration. [MIT for code only; bundled datasets in that repository are non-commercial or share-alike and are never copied; reader-only evidence] | 55 | Usability study (not yet run); status-line coverage check. |
| M13-2 | Approval node with a pause reason, a deadline, an "invalid after deadline" rule, delivery abstraction (email, web, chat) and a visible expired state with an owner; late submissions are refused. [idea only: Dify and n8n licences] [evidence: reader's account; reviewer checked licence, identity and file existence only] | 52, 53 | Expiry test; no hang. |
| M11-1 | Trap cases from FinRobot as tests: two prices in one artifact, stale data narrated as recent, stale row re-cached, context overflow retried to no purpose. | 30 | Four named tests. |
| M11-2 | Seeded benchmark that regenerates every published table; a limitations page that labels best cases. | 43 | One command reproduces the tables. |
| M11-3 | Conformance vectors for every memory rule we claim. | 33 | Vectors present. |
| M12-1 | Meterless engines are specs with reference code and conformance suites, not a hosted runtime; no "runtime integration" claim until the sponsor answers; the injected generator and embedder are ours. | 33 | Sponsor note updated when answered. |
| M13-1 | Chat approvals are in-run commands that bypass queue guards so a blocked agent can be approved. | 49 | Approval from chat during a blocked run. |
| M14-1 | Roles differ by tool scope, trust boundary and model; each has an ablation. | 39, 15 | Role-necessity ablation (already in spec). |

## J. What we are already ahead on (so we do not regress)

Deterministic quote check without a model (ALCE, FActScore, SAFE, WikiChat, ragas stop at model judgement); exact minimal-evidence and minimal-flip explanations; restrict-only trust lattice; certified rule changes with replay and a symbolic widening check (LangMem, Hermes, A-mem, Reflexion store what a model wrote); bitemporal facts with supersession (mem0 is additive only); first and second-order retraction; offline verifier and signed bundle (every other stream or log profiled stops at a UI, a file or a single signed receipt (Vectimus) with no offline verifier for a whole bundle); request-digest approvals with segregation of duties; cannot-link constraints with explainable pairwise evidence (graphrag and nano-graphrag resolve by exact string only).

## K. Rejected or deferred, with reasons

- Letta `main` (09): empty landing page, copying forbidden. Re-read as 48.
- Self-RAG weights (10): a model grading itself; we keep only the idea of separate support and relevance scores.
- Generator-side debate with identical agents (18): no licence, no roles; idea only.
- Per-chunk model reranking (24), per-event model compression (46): cost; replaced by triggered or batched forms.
- Vendor cloud features (48): secrets, remote machines; not in any default path.
- OpenHands engine (47): not read; only the client event model is assessed.
