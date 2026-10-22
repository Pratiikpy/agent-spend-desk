# Profile-pass additions to the module blueprints (v5.2, D-026)

Status: design. Date: 2026-10-16. Licence tags on each item are in the register (mechanism-only, idea-only, or reader-only evidence); an item without a tag is MIT or Apache and may be copied with credit, except Mastra `ee/` code, which is never copied. Source: the adoption register `docs/design/prior-art/profiles/99-synthesis-best-of-by-module.md` (ids), the 56 profiles beside it, and spec sections 0.4 and 21a-5. A blueprint ends with its own "Pass 3 resolutions" and this file is read after them; where this file and a blueprint disagree on a point listed here, this file wins, and the blueprint owner records Spec feedback in the usual way. Nothing here is built. Each item has a gate; an item whose gate fails is not claimed.

How to use. For each module: add the items below as new components or as extra acceptance lines in the blueprint's own numbering. The ids are stable; the register has the source profiles and the full gate text.

## All modules: rules P-1 to P-8

P-1 no silent failure (every failure or fallback is a recorded gap, never a default, placeholder, random answer or canned reply); P-2 fail closed including the gate itself; P-3 no outbound call that is not a declared source; P-4 fail at configuration time; P-5 measure, never quote a vendor number; P-6 write down every accepted inconsistent state and how it heals; P-7 the record comes first; P-8 licence hygiene register. Every module's fault-injection drills must show a gap record and no default; every module's start-up validator covers its own configuration.

## M1 Source Fabric

- M1-1 connector contract with runner-owned checkpoints, a distinct resume-invalid error and stable batch order (RAGFlow).
- M1-2 provider divergences, provenance and stale flags; circuit breaker (FinRobot).
- M1-3 live-web policy watchdog on the navigation path (browser-use); M1-8 engine fallback list with a retry budget per failure category and pre-flight gates, mechanism only (Firecrawl).
- M1-4 hash-based incremental refresh; M1-5 failed fetch is a gap, never empty content.
- M1-6 secrets refuse to serialise; a credential broker; M1-9 credential references and save-time validation of every handler reference.
- M1-7 capture that never blocks and spools when a worker is away (claude-mem).
New acceptance lines: resume test with a killed run; dead-URL gap test; planted divergence; saved-config secret scan; stale-handler doctor test.

## M2 Document Intelligence

- M2-1 deterministic structure pass and recorded structure source (PageIndex); M2-2 outline-first reading.
- M2-3 chunk strategy registry with deterministic ids, splitter cascade with a metadata budget, wider context window beside each chunk (RAGFlow, llama_index, deep-searcher); M2-4 evidence text beside every embedding.
- M2-5 NLP-only extraction path and a mock model for offline runs (GraphRAG); M2-6 unreadable or empty content is a gap.
New acceptance lines: gold outlines; flat-document labelling; same input same chunk ids; metadata never overflows the budget; offline run completes with gap records.

## M3 Reconcile

- M3-1 deterministic ids and tiered candidates; M3-2 capped re-ask loop; M3-3 never force a generated item onto the nearest candidate (the zero-cutoff match in HippoRAG); M3-4 recovery records before mutation and rebuild from cached extractions on retraction (LightRAG); M3-5 index manifest that refuses a mismatched state; M3-6 divergence as data; M3-7 typed, directed edges.
New acceptance lines: invented-fact drop test; swap-the-embedder refusal; retract-a-source exact recompute; missing-anchor refusal; ownership-chain direction test.

## M4 Explain

- M4-1 citation recall and precision with drop-one-citation, with a human-agreement check of the metric (ALCE); M4-2 capped iterative evidence search, self-contained rewrite, relevance filter (SAFE); M4-3 draft-claim branch, snippet filter, citation renumbering (WikiChat); M4-4 stakeholder perspectives with an ablation (STORM); M4-5 narrative-numeric grounding check (FinRobot); M4-6 refuse to write without evidence, source curation (GPT Researcher); M4-7 standalone sub-task instructions, caps, failed unit is a gap (open_deep_research); M4-8 restartable compression that keeps evidence handles (Alibaba DeepResearch); M4-9 breadth-halving budget (dzhng); M4-10 reflection that outputs only the missing questions (deep-searcher); M4-11 evidence-gap rollback (idea from ClinicalAgents); M4-12 optional bounded search that records pruned branches (Tree of Thoughts); M4-13 model disagreement as a routing signal; M4-14 critic and proposer must be different models, checked at start-up.
New acceptance lines: planted wrong figure rejected; empty-evidence refusal; perspective ablation; rebuild-from-summary trace test; same-model start-up failure.

## M5 Decide

- M5-1 blocking checks on every agent and handoff; M5-2 three outcomes (allow, reject with reason, raise); M5-3 pause and resume with a one-time key; M5-4 rule annotations in every decision, observe mode with an alarm, signed canonical receipts (Vectimus); M5-5 bounded release-versus-hold debate behind an ablation (TradingAgents); M5-6 capped retry that feeds the failure reason back (crewAI); M5-7 linked action and observation events, rule-derived risk labels, a confirmation id set (OpenHands); M5-8 approvals pin the exact object reviewed (Hermes); M5-9 coding-pack gate precedent (Vectimus).
New acceptance lines: no tool runs before the verdict; crash-and-resume pays once; double click approves once; changed object after staging is refused; gate dependency removed means refusal.

## M6 Memory and Learning

- M6-1 Meterless H-MEM contract calibrated on our cases, no mock-embedding numbers; M6-2 multi-signal retrieval; M6-3 outcome memory; M6-4 separate insert, update and delete switches with delete off; M6-5 reflections that point to evidence; M6-6 stable ids and written history; M6-7 personalised-PageRank candidate source behind an ablation; M6-8 validated, rejecting memory constraints; M6-9 frozen snapshot per decision; M6-10 progressive disclosure with an expiring bounded cursor; M6-11 technique coverage and LoCoMo-style evaluation; M6-12 privacy gate before the worker starts; M6-13 four-signal recall by reciprocal rank; M6-14 non-destructive scoped reconciliation; M6-15 per-scope raw-text switch and fail-on-extraction-error by default; M6-16 bounded reflective investigation with citations.
New acceptance lines: near-duplicate with a changed number stays separate; delete requires a logged enablement; private prompt race test; per-signal ablation; erasure test.

## M7 Orchestration Runtime

- M7-1 typed wiring, run limits, snapshots; M7-2 fixed-order middleware with a start-up validator; M7-3 reversible compression with evidence that never expires; M7-4 hard stop on spend and rounds; M7-5 scripted model and typed event schemas; M7-6 acceptance checks on delegated work with the stated caveat; M7-7 at-most-once scheduling; M7-8 snapshot shape and processors from the TypeScript comparison (Mastra); M7-9 per-output failure strategies, a decision output is never defaulted; M7-10 graph validator.
New acceptance lines: mis-wired graph fails at build; misordered chain fails start-up; scheduler crash test; decision output default is impossible.

## M8 Security Layer

- M8-1 deserialisation allow list and trusted-namespace loading; M8-2 sensitive-data placeholders that also cover logs; M8-3 fail-closed confinement launcher; M8-4 injection-pattern scan on memory writes as a signal only.
New acceptance lines: unlisted class refused; log search finds no secret; no-sandbox run refused.

## M9 Audit and Bundle

- M9-1 canonical signed receipts next to the DSSE envelope; a schema version on every audit record; P-7 (a failed ledger write refuses the release).
New acceptance lines: unversioned record rejected; ledger write failure refuses release.

## M10 Interfaces and Experience (UI and UX are Prateek's)

- M10-1 stable agent ids; M10-2 addressed messages and document status as case state; M10-3 App Server with control and stream channels and scoped tokens; M10-4 doctor lists every platform-dependent behaviour; M10-5 console information architecture (status and last message on every source and panel, independent layers with a roster, side rails, first-run missions, a bundled sample pack).
Hand-off note: the information architecture and the non-negotiable behaviours (every state is shown, expired and empty states are named, approvals bind the request digest, nothing leaves the machine by default) are the contract; visual design is not specified here.

## M11 Evaluation

- M11-1 four trap cases from FinRobot; M11-2 seeded benchmark that regenerates every published table, with best-case labelling; M11-3 conformance vectors for each memory rule; plus the citation recall and precision metric (M4-1) and a documentation lint on numbers (P-5).

## M12 Sponsor adapters

- M12-1 Meterless engines are specifications, reference code and conformance suites, not a hosted runtime; no runtime claim until answered; the reference embedder is a hash and never in a quality number; the 17-action ledger vocabulary, supersede-never-delete and sleep preview with backup are adopted; Zetaris and NVIDIA statuses per spec section 22.

## M13 Case Lifecycle and Action Broker

- M13-1 approvals as in-run commands from chat; M13-2 approval node with pause reason, deadline, invalid-after-deadline and a visible expired state with an owner; M5-8 object pinning at staging; M7-7 scheduler semantics for monitoring.

## M14 Agents and Models

- M14-1 roles differ by tool scope, trust boundary and model, each with an ablation; M4-14 distinct models for proposer and critic; model assignment per stage (cheap for simulation, strongest for cited explanation, from STORM); stable ids and allowed-subagent lists.

---

# Best-in-world additions (v5.3, D-027 to D-030, 2026-10-17)

Status: design. Source: `../prior-art/2026-10-17-best-in-world-check-kernel-parts.md` (seven researchers with capped search; mechanisms mostly from READMEs and titles, so each item is a hypothesis with a gate until the code or paper is read). Licence rule as above: MIT and Apache copy with credit; AGPL, BSL, SSPL, unlicensed and unknown-licence items are ideas only. Ids `W...` are stable and win over the blueprint text where they differ.

## M1 and M2 Sources and documents

- W1-1 connector contract borrowed from Trino (Apache-2.0): a typed connector with capability flags; gate: contract tests per connector.
- W1-2 schema-drift handling: a small model retrieves candidate column matches and a larger one reranks (Magneto, arXiv 2412.08194); the remap is proposed, approved by a person and stored as a versioned mapping; gate: a planted drift is detected and never silently remapped.
- W2-1 span-grounded extraction: every extracted value keeps its source span and a layout locator (LangExtract, Apache-2.0; Docling, MIT); gate: locator fidelity on the gold set; whether it works on OCR text of scans and faxes is NOT VERIFIED and is tested.

## M3 Reconcile

- W3-1 per-field match-weight breakdown for every pairwise decision (Splink, MIT); gate: the weights recompute the decision.
- W3-2 three outcomes for a pair: match, non-match or ask a person; ambiguous pairs go to a review queue and the labels feed back (dedupe, MIT); gate: ambiguity never auto-merges.
- W3-3 a rerun on the same input gives the same result (Splink #2882 and Zingg #601 show non-determinism in the field); gate: determinism test.
- W3-4 every value is kept as a claim (value, source span, extractor, confidence, time, trust at that time) and never overwritten; the conflict rule that decided is named and an undecided conflict stays visible to the decision rules; gate: no tie-break picks silently.
- W3-5 separate extraction error from source error so a bad read does not lower a source's trust (Knowledge-Based Trust, arXiv 1502.03519).
- W3-6 matching by "select the best from candidates" combined with binary and compare strategies for cost (arXiv 2405.16884); the matcher is tested on our own data because LLM matching is prompt-sensitive (arXiv 2310.11244).

## M4 Explain

- W4-1 the mechanical exact-span quote check runs before any model judge; a fake quote can never pass.
- W4-2 claims are atomic, not sentences; a partly true sentence is split (Google Check Grounding treats a sentence as one claim, which loses citations).
- W4-3 tamper tests change a number, date, negation or unit and the claim must fail.
- W4-4 a published false-accept rate per pack and a calibrated abstention that escalates to a person; judge candidates are MiniCheck, Granite Guardian and LettuceDetect, each tested before use.
- W4-5 the minimal flip set is found by exact search over the policy criteria (design inference; DiCE-style sampling is not used); gate: agreement with brute force.

## M5 and M8 Decide and security

- W5-1 restrict-only proof of a rule update by symbolic analysis (Cedar's symbolic compiler `cedar-policy-symcc`, Apache-2.0; Z3 as a backup, licence NOT VERIFIED) in addition to replay; the report names what would newly be allowed; gate: a widening rule is rejected with a counterexample.
- W5-2 the jury is off by default and enabled per pack only when a held-out set shows lift over the best single model; report error overlap, a voting-only baseline and self-preference bias.
- W5-3 untrusted text carries capability tags and information-flow labels (CaMeL, FIDES) and can only add holds; detectors such as LlamaFirewall are signals only (arXiv 2504.11168 shows they can be bypassed); gate: adversary-controlled model suite.
- W5-4 schema generation for tool calls from MCP tool descriptions (cedar-for-agents) as an input to policy checks.

## M6 Memory and learning

- W6-1 case-based memory with precedent and counter-precedent shown with a similarity score (Memento, MIT, arXiv 2508.16153).
- W6-2 candidate rules are proposed from overrides by interpretable rule models (imodels, MIT); every candidate is replayed first.
- W6-3 rules are versioned and retired when they stop matching; the confirmer and the time are recorded.

## M7 Runtime

- W7-1 an idempotency key is written before every side effect and the state is reconciled with the downstream system on resume, not from the log alone.
- W7-2 a pluggable durable-execution port whose contract is our crash-and-resume suite (D-031); the default is our own thin layer on SQLite with an effect log and idempotency keys; DBOS Transact for TypeScript (MIT) and Temporal (MIT) are optional adapters that must pass the same suite; Restate (BSL) and Inngest (SSPL) are rebuild-only.
- W1-3 every source goes through Zetaris whenever it is running (D-032); three source types for the synthetic silos (Postgres, S3-style files, a REST service) under the semantic layer; AI data steward tested for PII tagging; fallback mode reads the same fixtures through an embedded engine and the trace marks it.

## M9 Audit bundle and verifier

- W9-1 canonical JSON (RFC 8785) with COSE (RFC 9052) or JWS (RFC 7515) signatures and a COSE receipt (RFC 9942) with an inclusion proof; libraries `jose` (MIT), `canonicalize` (Apache-2.0).
- W9-2 log checkpoints cosigned by witnesses in the style of Certificate Transparency (RFC 9162), Tessera and the witness format (Apache-2.0); a self-run witness is not independent and is labelled so.
- W9-3 a shipped tamper corpus: flip an input hash, swap the policy version, drop an entry, fork the log, replay an old receipt; each must fail the verifier.
- W9-4 each override is a signed, logged record.

## M10 Interfaces and the Decision Desk

- W10-1 evidence and the rule are shown first and the approver records an independent judgment before the verdict appears (arXiv 2102.09692).
- W10-2 approval time and agreement with the system are tracked to detect rubber-stamping (arXiv 2109.05067; Parasuraman and Manzey 2010).
- W10-3 one inbox of cases from several packs with a pack label, a deadline clock and a status on every case.

## M11 Evaluation and data generation

- W11-1 intervals on every rate (Wilson or bootstrap clustered by case; prediction-powered inference when gold labels are few, arXiv 2301.09633; arXiv 2411.00640).
- W11-2 the test set, metrics and thresholds are frozen by hash before scoring; scoring refuses if they changed.
- W11-3 worst-of-three runs and pass^k (arXiv 2406.12045) reported.
- W11-4 judge order-swap and bias checks (arXiv 2306.05685, 2305.17926, 2410.02736); red-team cases carry gold labels (garak, deepteam, promptfoo as patterns).

## M12 Sponsors

- W12-1 Nemotron is reached through NVIDIA's free API (setup guide Option B) because the Meterless side confirmed on 2026-10-17 that there is no Meterless API or key; the code stays route-agnostic (MODEL_BASE_URL, MODEL_API_KEY, NEMOTRON_MODEL). The Meterless engines are implemented in our own code to the sponsor's specifications and conformance suites and shown running (setup guide eligibility sentence).

## Packs (payer Decision Desk)

- W-P1 criteria are versioned rules with criterion ids and policy versions, never an unreviewed LLM reading of a policy.
- W-P2 the system never denies: it approves or routes to a clinician; every hold names the exact criterion and the supporting or failing note excerpt (CMS-0057-F requires a specific reason for any denial).
- W-P3 appeal replay re-runs a case against the policy version in force at the time.
- W-P4 deadline clocks (72 hours expedited, 7 calendar days standard) and the metrics CMS requires to be published.
- W-P5 seeds: Synthea (Apache-2.0), CMS DE-SynPUF, CMS NCCI edit files (build the edit engine ourselves, no maintained open one was found), CUAD (CC-BY-4.0) for contract renewal; access and deletion requests are generated synthetically.
- Licence notes: CPT descriptions are AMA copyright (a lawyer decides what may be shipped); EDIReader is GPL-3.0 (rebuild only); California SB 1120 and state AI-in-utilization-review laws are NOT VERIFIED.

## Additions from the vertical and open-source agent study (v2.0, 2026-10-18)

Source: `prior-art/2026-10-18-vertical-and-research-agents-study.md`. Patterns only; no code copied.

- **W-V1 Plan preview and approve** (Harvey): typed plan shown before the run; the approved plan hash is part of the record. Gate: no run without an approved plan.
- **W-V2 Precedent meter** (Consensus Meter): support, oppose and mixed counts per criterion with stored excerpts, for every case type.
- **W-V3 Stability report** (Elicit repeat-run study): published agreement on values, quote spans and criterion ids across reruns, with intervals.
- **W-V4 Loud failure** (`open_deep_research` swallows all errors with `or True`): typed failure events, a lint against catch-all handlers, injected-error tests.
- **W-V5 Visible plan-refine trace** (Perplexity Deep Research): before, after and reason on every re-plan.

## Additions from the rival teardown and the divergent-ideas run (v2.1, 2026-10-18)

Sources: `prior-art/2026-10-18-rival-teardown-trust-and-action-gating.md`, `prior-art/2026-10-18-adhd-divergent-ideas.md`. Patterns only; no code copied.

- **W-T1 Replay fidelity harness** (Policy Twin): stored inputs and pinned model-step outputs; the baseline must reproduce the recorded decision before any counterfactual is run.
- **W-T2 Flip classifier and minimal cause**: approve to route, route to approve, no change; the smallest set of verified claims whose change reverses the outcome.
- **W-T3 Widening proof**: the symbolic restrict-only check on a proposed change, with the exact widening region as the counterexample.
- **W-T4 Honest verifier panel** (PEAC, whatdidmyagentdo, rubric-attest limits).
- **W-T5 Release-time recheck** (ActionRail grounding).
- **W-T6 Verifier hygiene** (PEAC: strict I-JSON, small-order key denylist, replay guard; rubric-attest: bundled sample).
- **W-T7 Gate adapters** (Keypost: parameter constraints, time windows, sensitive-data scans, one-URL integration).

## Additions from the study of the fastest-rising repositories (v3.0, 2026-10-19)

Source: `prior-art/2026-10-19-top-repos-pattern-study.md`. Patterns only; no code copied; AGPL and no-licence repositories are ideas only.

- **W-U1 Prove-it skill package and distribution routes** (F-D01, F-D02): canonical SKILL.md, references kept inside the folder, commands, Cursor rule, plugin and `npx skills` routes, uninstall, signed provenance.
- **W-U2 Local MCP server and optional stop hook** (F-D03, F-D04): read-only tools, enforce and warn modes, fail closed.
- **W-U3 Doctor and source capability table** (F-D05, F-K30): real probes, primary and fallback backend per source, check-only default.
- **W-U4 X-ray view and computed evidence grade** (F-S20, F-K29): card template, what-if control, grade from structured fields, link liveness shown apart.
- **W-U5 Evidence Graph** (F-S21): per-edge quote, hash and locator; EXTRACTED, INFERRED, AMBIGUOUS, CONFLICTED; query, path, explain; incremental update; diff impact; exports.
- **W-U6 Live evidence board** (F-S22): per-assertion freshness, source health, deltas, as-of mode.
- **W-U7 Typed screener** (F-S23): typed primitives, per-bucket calibration, three abstention states, frozen question sets, pinned checkpoint with parity test, narrow-only authority.
- **W-U8 Quote check v2** (F-K28): original-span matching that keeps signs, negations and numbers; gapped quotes; five verdicts; dependency invalidation; ledger of refuted facts; named hole tests.
- **W-U9 Admissibility rules and breakers** (F-K31).
- **W-U10 Locked evaluator and signed experiment ledger** (F-K32).
- **W-U11 Reversible context store** (F-K33).
- **W-U12 Public benchmark and conformance vectors** (F-D08).
- **W-U13 Everyday-person door, appeal packet and single-file HTML brief** (F-D06, F-D07).
- **W-U14 Compliance map and real public policy pack** (F-D09, F-D10).
- **W-U15 Neutral clearing house and reasoning-architecture compiler** (F-P14, F-P15).
