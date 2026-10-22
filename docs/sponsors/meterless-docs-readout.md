# Meterless docs readout: what they value, what we have not used, what is worth adding

Date: 2026-10-13. Status: analysis, not decisions. Nothing here changes `docs/design/00-architecture-master-spec.md` until Prateek accepts an idea. Every idea carries a verdict (ADD, MAYBE, REJECT) and a test that would prove it. Whatever is untested is marked **NOT VERIFIED**.

The question asked: is there more we could do with Meterless that genuinely improves our product (a counterparty-release decision system) and that Meterless would like, grounded in what their documents say? One rule is applied strictly: an idea that only pleases the sponsor and does not improve our product is REJECT. Where an artifact is a by-product of work we already need, it can be ADD; where it would be built only to be seen, it is REJECT.

## 0. Scope, method and evidence labels

**Path key.** `MT/` means `research/sponsor-reference/Meterless/` (local clone, commit `0aa7417`, tag `v1.0.6`, Apache-2.0). Our own files are cited with their repo paths.

**Evidence labels.** `[R]` a file in `MT/`. `[W]` a page on the public site meterless.ai, fetched 2026-10-13 through a reader proxy (not part of the repo; the site can change). `[G]` GitHub metadata read with `gh` (issues, releases, tags, discussions, product-repo release notes). `[inferred]` my deduction from reading, to be confirmed by a failing test of our own before it is repeated anywhere public.

**Read line by line:** root `README.md`, `ROADMAP.md`, `CHANGELOG.md`, `AGENTS.md`, `llms.txt`, `CONTRIBUTING.md`, `SECURITY.md`; `docs/architecture/*`, `docs/agent-ready/*`, `docs/community/*`, `docs/engines/*`, `docs/products/README.md`; `templates/README.md`, the agentathon starter README and `src/*`, `notebook.ts`; `examples/README.md` and the memory-compounding README and code; `scripts/README.md` and two of the three scripts; for each engine: `README.md`, `AGENTS.md`, `content/*`, every file in `docs/*` (all of H-MEM, Scout and Markovian; World Model all but `aggregate-shapes.md` and `entity-context-relationship-model.md`), `conformance/README.md`, `evals/*` (Scout in full including runner), the cross-engine examples and the scenario examples named in section 2, the reference READMEs, and the reference sources that decide a claim (H-MEM ledger, retrieval, sleep and store; World Model index, idempotency check and browser bundle script; Markovian markers). Product docs: Gaia README, features, privacy, FAQ (first half), mentions; Relay README, features, privacy, FAQ; Swarms README, features, privacy, FAQ (first half).

**Skimmed or only searched, not read line by line:** H-MEM numbered examples 01 to 07, `chat-memory`, `sleep-consolidation`, workshops 01 to 04, `HOW_TO_USE_H-MEM.md` outside sections 10 to 12; World Model workshops 01 and 03, examples `narrative-world`, `news-intelligence`, `stream-clustered-facts`, `swarm-planning-with-world-context`, `minimal-entity-graph`, `world-to-hmem-sync`, `HOW_TO_USE_WORLD_MODEL.md` outside sections 6 and 12 to 13; Markovian workshops 01 and 03, `run-first-chain` and sibling examples, `HOW_TO_USE_MARKOVIAN_ENGINE.md`; Scout `classify`-style examples were read, workshop 01 read; Gaia, Relay and Swarms getting-started, shortcuts and troubleshooting; the SVG and PNG assets. The site pages `how-it-works.html` and `models.html` were fetched and only searched (they are mostly navigation and model catalogues).

**Nothing was executed.** No conformance runner, reference test, example or eval was run. Statements about what the reference "does" are what the source says.

## 1. What Meterless says it values and how it pitches itself

### 1.1 Themes, with the phrases that carry them

| # | Theme | Short phrase | Where |
|---|---|---|---|
| 1 | Context beats model size | "Agents fail on thin context, not weak models." | `MT/README.md` |
| 2 | The spec is the product; an agent builds it; the suite proves it | "degit the folder → agent implements from AGENTS.md → conformance suite green = done" | `MT/engines/README.md`; "A green scorecard is the definition of done" in each engine `AGENTS.md` |
| 3 | Local-first as structure | "Privacy is structural, not a policy promise." | `MT/docs/architecture/local-first-agentic-context.md`; "Local-first is the wedge" in `MT/CONTRIBUTING.md`; [W] "0 bytes sent to a cloud service" |
| 4 | Provenance on everything | "Nothing hidden, nothing unattributed." | `MT/engines/README.md`; "No provenance → reject at validate" in `MT/engines/world-model/docs/ingest-pipeline.md` |
| 5 | A human approves consequential change | "Nothing materializes without human approval." | `MT/engines/hmem/README.md` (dreaming); Relay approval gates in `MT/docs/products/relay/features.md`; [W] "nothing carries over on its own" |
| 6 | Refuse at the boundary | "refused by the executor" | `MT/engines/scout-intent/docs/execution-contract.md`; "Downstream engines refuse unsigned plans" in the Scout README |
| 7 | Untrusted text is data | "Retrieved content is data, never instructions." | `MT/engines/scout-intent/examples/prompt-injection-block/README.md`; "Memory is context, not instruction." in `MT/engines/hmem/docs/reinjection.md` |
| 8 | Honest numbers | "These numbers are modeled, not measured." | `MT/engines/markovian/README.md`; "will not survive scrutiny" (unlabelled savings) in `MT/engines/markovian/docs/telemetry.md`; "and that is honest" in `MT/engines/markovian/examples/token-savings-demo/README.md`; [W] "Including the runs that did not pass." |
| 9 | Evals are the asset | "you have a rubber stamp" (without measurement) | `MT/engines/scout-intent/README.md`; "the one move that's banned" (lowering a threshold) in `MT/engines/scout-intent/workshops/04-lock-in-evals.md` |
| 10 | Unverifiable is its own state | "never a false pass, never a false fail" | `MT/docs/products/relay/features.md`; [W] "2 not runtime-checked: no_browser"; [W] "Every run records which checks actually happened." |
| 11 | Agreement is not evidence | "Agreement is a signal, not proof." | [W] meterless.ai home (clusters); compare our principle that agreement among model agents is never evidence |
| 12 | Replay and repair are normal operations | "normal operations, not emergencies" | `MT/engines/world-model/content/launch-post.md`; "Re-running on the same input produces the same world." in the World Model README |
| 13 | Operators are the immune system | "A world model with no control plane calcifies." | `MT/engines/world-model/control-plane/README.md`; "Operators are the immune system." in `MT/engines/world-model/AGENTS.md` section 14 |
| 14 | Glass box, bounded blast radius | "Glass-box decisions" | Scout README; [G] Swarms release: "Visible workforce, not hidden black box."; World Model: "a single bad write must never corrupt the store" |
| 15 | Honest comparison, including weaknesses | "Be honest where Meterless is weaker." | [W] engines.html prompt library; "Use the right tool." in `MT/engines/world-model/content/comparison.md`; money stays in Postgres in `MT/engines/world-model/docs/trade-offs.md` |
| 16 | Implementers' feedback is the contribution they want | "the most valuable contribution there is: what was ambiguous, what was missing, what broke" | `MT/CONTRIBUTING.md`; [G] release v1.0.6: "results from your own runs → Discussions" |
| 17 | Agent-ready repo | "Find your task type. Go to that folder. Load nothing else." | `MT/AGENTS.md`; `MT/llms.txt`; [W] "any assistant that can read a link can read the whole stack" |
| 18 | House style | "short declarative sentences. No em dashes. No exclamation points." | `MT/AGENTS.md` rule 6 (enforced for root files by `MT/scripts/check-conventions.mjs`) |

### 1.2 Their scoring language, their tracks, and where Plumbline sits

- Meterless's own judging weights: usefulness 30, **Meterless engine usage 25**, local-first and privacy 15, demo 15, creativity 10, documentation 5 (`MT/docs/community/hackathon-guide.md`). The same guide says the starter README "maps every command to the engine service behind it, which is what the 25% engine-usage rubric line looks for." Whether Meterless judges apply this rubric to the GenAI Works event is **NOT VERIFIED**; the GenAI Works rubric (Sponsor Tech 10 of 100) governs our submission.
- Their track list includes "Enterprise Workflow Agents. Customer success, sales, recruiting, operations, finance." and "Offline/Local AI Agents" (same guide). Plumbline is a finance-operations agent; the local-first half of that sentence is where we are thinnest (section 3, idea B1).
- The World Model docs already name our domain: "Compliance and risk | Entities, transactions, alerts | Lists, periods | Sanctioned by, related to" (`MT/engines/world-model/README.md`), and "Compliance & risk: entities, sanctions lists, transactions, alerts" (`MT/engines/world-model/AGENTS.md`). The same docs say money belongs in a transactional database (`docs/trade-offs.md`): Plumbline must hold derived case facts, never balances.

### 1.3 What a Meterless judge will already recognise in our spec

Refuse at the boundary (signed release capability), untrusted text as data (restrict-only gate), honest numbers and NOT VERIFIED, four distinct "absent" fetch states (their "unverifiable"), idempotent re-run with an expected empty diff, human approval for consequential change, proposal-only memory consolidation, an append-only ledger with a standalone verifier, per-engine ablations.

### 1.4 Where we are thin against what they emphasise

Local-first and privacy beyond "network denied in SAMPLE_MODE" (they weight it 15 and show an egress-style privacy page for each product); an operator control plane (they specify one as acceptance criteria); visible "prove the test can fail" discipline per engine (their own prompt library asks for it); contribution back (empty community-eval folder, one open issue); an agent-ready repo.

### 1.5 The pitch has moved since the repo docs

The repo says: "The local-first context stack for agentic AI" with four engines and three apps (`MT/README.md`). The current site leads with **Nightshift**, an overnight local-compute product for a Mac or an NVIDIA DGX Spark, with "Receipts", "Checks performed: VALIDATE, RUN, JUDGE, OUTCOME", an "Outcome Contract" that settles a job as accepted, refused or undecided ("5 accepted · 7 refused · 92 undecided"), "Judge coverage 60%", "Verifier abstentions 4", a local OpenAI-compatible base URL, and "NVIDIA Inception Program member" [W]. It says the suite installer ships "the five engine primitives (H-MEM, Markovian, Scout, Swarm, World Model)" [W] whereas `MT/ROADMAP.md` says swarm-orchestration is a target and the repo `main` has no such folder (checked 2026-10-13: `main` HEAD is still `0aa7417`, tags `v1.0.0`, `v1.0.5`, `v1.0.6`). It also describes H-MEM as "working, episodic, and semantic tiers as grep-able files on disk" [W] where the repo spec says short_term, working, long_term. Treat the repo as the contract (it is what the conformance runners test) and the site as the current marketing. The site's vocabulary is still useful: "checks actually happened", "undecided", "abstained", "answer key", "proofs re-checked the numbers" are the same honest-state ideas as our `INDETERMINATE` and gap ledger.

## 2. Inventory: capabilities, extension points and compositions our spec does not yet use

"In spec?" refers to `docs/design/00-architecture-master-spec.md` plus `docs/sponsors/meterless-engines-engineering-brief.md`. "Idea" points to section 3.

| Id | Capability or extension point | Evidence | In spec? | Idea |
|---|---|---|---|---|
| K1 | Capability graph with families (`read/`, `write/`, `reason/`, `act/`); typed `unresolved` capability instead of a silent gap; risk filter applied before ranking | `MT/engines/scout-intent/docs/capability-graph.md`; `examples/tool-plan-generation/README.md` ("a blocked capability cannot be reintroduced later by a high utility score") | No | A2 |
| K2 | Pluggable contract signer ("swap the signer for a real signing service") | `docs/execution-contract.md`; `AGENTS.md` section 8.2 | No | A1 |
| K3 | `replan({ parent, reason })`: child contract, same `traceId`, TTL never extended | `docs/execution-contract.md`; `MT/engines/markovian/docs/compose-with-swarm.md` | Open question in the brief only | A3 |
| K4 | `contextPlan` on the signed contract (sources, maxTokens, relations, redactionPolicy); "Scout sizes the recall; H-MEM serves it", `topN: 0` for a trivial prompt | `examples/query-hmem-before-action`; `MT/engines/hmem/examples/scout-grounded-recall/README.md` | Brief hand-off 2, as our extension | covered |
| K5 | Model profiles with `dataClasses`; "confidential forces local, full stop"; fallbacks must satisfy the same data class; cost ceiling on `scope.budget` | `docs/model-routing.md`; `examples/model-profile-routing/README.md` | No | B1 |
| K6 | PII/sensitivity guard layer: redact or block; redactions recorded on the contract without the secret | `docs/risk-and-policy.md`; `examples/risk-check/README.md` | No | B1 |
| K7 | Two-pass guard: raw input, then retrieved snippets; "the pipeline order is not configurable" | `examples/prompt-injection-block/README.md` | Partly (M8 quarantine is stronger) | cite |
| K8 | Policy packs (`default`, `enterprise`, `regulated`, `adversarial-tight`), `policyPackVersion` stamped on the contract; "Scout's policy stage can defer to OPA" | `docs/risk-and-policy.md`; `content/comparison.md` | No | A1 (stamp) |
| K9 | Clarification triggers, bands, structured clarification with up to 4 options; clarification-rate ceiling | `docs/scoring.md`; `AGENTS.md` section 4.6 | No | A4 |
| K10 | Multi-intent plans with `executionMode` and a chain of contracts linked by `parentId` | `examples/detect-multi-intent/README.md` | No | H1 (why not for batches) |
| K11 | Eval discipline: target plus hard floor, per-slice floors, append-only versioned corpus, `evals:add`, "no threshold lowering", near-miss watch list | `evals/config/thresholds.yaml`; `docs/eval-harness.md`; `CONTRIBUTING.md` | Partly | E1 |
| K12 | Scout contribution surface: injection examples into `evals/regression-set/v1/injection/`; "domain-specific bundles (CRM, fintech, regulated industries)"; roadmap items "per-class injection files", "Eval marketplace" | `MT/engines/scout-intent/CONTRIBUTING.md`, `ROADMAP.md` | No | E4 |
| K13 | World Model operator control plane: inspect, merge/unmerge as alias events, edit as superseding event with operator provenance, rebuild a view, repair by replaying one source; roles viewer/editor/admin "enforced at the event-append layer" | `MT/engines/world-model/docs/operator-control-plane.md`; `control-plane/README.md` | Partly (retraction cascade, console) | F1 |
| K14 | Custom projections (`registerView`) and the health test "wipe the view, re-derive it" | `docs/read-surface.md` | Implied | F1 |
| K15 | Read at an event offset (`atEvent`), read-your-writes (`waitForConsistency`) | `docs/concurrency-and-queues.md` (docs only; absent from the reference) | No | C1 |
| K16 | Provenance with `runId`; "what did run X write?"; `replay({ source, transform })` after an extractor bug | `workshops/02-idempotent-ingest.md` | In spirit (case-scoped retraction) | F1 |
| K17 | Single-file live control plane that embeds the real implementation so it works from `file://` | `control-plane/README.md`; `reference/scripts/build-browser-bundle.ts` ("browsers block external module imports on the null origin") | No | F2 |
| K18 | Idempotency check with a `--mutate` proof that the check can fail | `reference/scripts/idempotency-check.ts` | Yes (idempotent and mutated re-run) | E2 |
| K19 | H-MEM record fields `provenance.origin: "decision"` and `refs.decisionId`; typed entities `{name,type}` | `MT/engines/hmem/docs/memory-record.md` | Brief uses `source: "decision:<caseId>"` | C1 |
| K20 | Scoped recall (`chatId`, `missionId`, `goalRunId`, `includeUnscoped`); "Unscoped writes are a defect" | `docs/retrieval-ranking.md`; `docs/memory-record.md` | Scoping per case only | C2 |
| K21 | Reinjection trace: `traceId`, "ranker version or weight profile", "suppressed superseded memory count"; persist a weight-profile label such as `weights@2026-07`; privacy tags `private, secret, pii, health, financial, work-confidential` | `docs/reinjection.md`; `docs/retrieval-ranking.md`; `docs/privacy-and-local-first.md` | Partly | C1, B1 |
| K22 | Ledger query surface (`history`, `range`, `stats`, export), `ledger_rotated`, delete-before-remove | `docs/trust-ledger.md`; `demos/trust-ledger/README.md` | We use our own Merkle ledger | C1, B2 |
| K23 | Dreaming review checklist: lineage strength, over-generalisation, privacy, conflict; rejections are logged | `examples/dreaming-review/README.md` | Certificate covers most | cite |
| K24 | Document re-ingest as reconciliation by `source:doc:` tag (skip near-identical, supersede changed, flag vanished facts) | `examples/document-memory/README.md` | M2/M3 cover the same ground | cite |
| K25 | Sleep: preview with guardrail status, backup and restore drill; archive and synthesis delete sources | `docs/sleep-cycle.md`; `reference/src/sleepCycle.ts` lines 89 and 108 | Needs a restriction | H5 |
| K26 | Community evals folder with a markdown template (`should_retrieve`, `should_suppress`); "No community evals have been submitted yet. Yours can be first." | `MT/engines/hmem/evals/tests/README.md` | No | E4 |
| K27 | Custom compression cascade (`extract`, `rank`, `compress`, `format` all replaceable), retention priority, `carryover-overflow`, "markers can pin entities explicitly", cascade level as a drift alarm | `MT/engines/markovian/docs/compression-cascade.md`, `marker-protocol.md`, `telemetry.md` | Partly (ids not facts) | D1 |
| K28 | Reflection modes: conclude, ratify, refine, branch-and-converge; "reflection failure must never fail the run" | `docs/reflection.md`; `examples/reflection-pass/README.md` | Soft LLM critic only | D1 |
| K29 | Pause and resume: `[NEEDS_TOOL]`, `[NEEDS_CLARIFICATION]`, `approvalGates: { everyN }`, `paused` status | `docs/marker-protocol.md`, `docs/streaming-ui.md`, `workshops/04-reflect-and-resume.md` | Our M7 human steps | H6 |
| K30 | Delegation gate (`estimatedTokens > 4000`), `markovianFallbackReason` | `docs/compose-with-swarm.md` | "Only where a case is long" | cite |
| K31 | Run history: per-chunk carryover in and out, `diff` into added, removed, retained; field-level redaction; retention tiers | `docs/run-history.md` | Partly (trace) | D1 |
| K32 | Relay: three-valued verification; shadow mode by default; Deterministic Execution Ratio; distillation "always human-gated by a review diff"; append-only revisions; per-step failure policies | `MT/docs/products/relay/features.md` | States yes; DER and shadow no | D2, H4 |
| K33 | Swarms: provider failure classes (rate_limit, quota, transient, fatal) with full-jitter retry; DAG integrity checks | [G] release notes of `Meterless/swarms`; `MT/docs/products/swarms/features.md` ("reported honestly instead of retried into a wall") | Partly | G1 |
| K34 | Gaia: memory browser (forget, correct, export), import-run id rollback, "Deletion is real" | `MT/docs/products/gaia/privacy.md`, `features.md` | No | B2 |
| K35 | Repo checks: case-sensitive link checker, convention checker (root `AGENTS.md` under 100 lines, no empty folders, kebab-case), example runner | `MT/scripts/README.md` | Partly | F3 |
| K36 | "Where the engine is used (judges look here)" table; the "wired-vs-helper trap" and the instruction to document which helpers are live | starter README; `MT/engines/world-model/AGENTS.md` sections 8.3 and 13 | Evidence table as documentation | E3 |
| K37 | Their prompt library (40 prompts, 12 of them "Harden"): "Prove each test can fail", "Sign every tool call", "Audit memory for privacy ... add a test that fails if memory ever leaves the machine", "Resume after a crash", "Survive concurrent writers", "Gate every change in CI" | [W] meterless.ai/engines.html | Unknown to the spec | E2, B1 |
| K38 | Roadmap engines: swarm-orchestration (target August 2026) and runtime (Q4 2026); stack diagram shows a "Runtime Quality Layer" with no spec | `MT/ROADMAP.md`; `docs/architecture/stack-overview.md` | Watch item | none |

## 3. Candidate ideas

Format per idea: what it is; the passage that motivates it; what it improves; cost and risk; how Meterless would perceive it; verdict with reason; how we would prove it. Ideas are grouped; ids are stable.

Summary of verdicts: ADD A1, A2, A3, B1, C1, C2, C3, D1, E1, E2, E3, E4 (by-product only), F1, F3. MAYBE A4, B2, D2, F2, G1. REJECT H1 to H10.

### A. The release contract (Scout)

#### A1. Asymmetric, single-use release contracts. ADD

**What.** Implement Scout's signer interface twice: the spec default HMAC-SHA256 (conformant, used for the eval harness) and Ed25519 through `node:crypto` for the capabilities that move money (`act/po.release`, `act/vendor.update-bank`). The decision service holds the private key in a separate process (spec M9 already separates the signing key); the release executor holds only the public key and a consumed-contract ledger. The contract carries `registryVersion` and `policyPackVersion`, where `policyPackVersion` is the hash of our SMT-checked policy bundle. The executor refuses: bad signature, expired, scope mismatch, missing approval record, case-hash mismatch against the internal record, **already consumed**.

**Motivation.** `MT/engines/scout-intent/docs/execution-contract.md`: "This is not a cryptographic-grade defense — it's an integrity check ... If you need stronger guarantees ... swap the signer ... The interface is pluggable." `AGENTS.md` section 8.2 says the same. The docs list "Replay of expired contracts" as caught; they do not address replay of a valid, unexpired contract inside the 5-minute TTL **[inferred gap]**. [W] prompt "Sign every tool call ... A call without a valid contract is refused. Show me one accepted call and one refused call."

**Improves.** Safety: with a shared HMAC secret every verifier can also mint a contract, so a compromised executor or host can forge a release; an asymmetric signer removes that class. Correctness: single use stops a replayed release inside the TTL, which for a payment is a double payment. Explainability: the signed `policyPackVersion` names the rule bundle that authorised the release.

**Cost and risk.** Small: Ed25519 is in `node:crypto`, no dependency. Key rotation is a signed ledger leaf (spec M9). Risk: the Meterless spec text says HMAC; we keep `verifyContract(contract, { secret })` working and add a second signer, so conformance of the public API is unchanged. The contract's canonical JSON encoding is not pinned by Meterless; we use our JCS profile and say so.

**Meterless's view.** Positive: it uses a documented extension point and makes the contract load-bearing. No downside I can find.

**Verdict.** ADD. The release path is the highest-consequence action in the product and the improvement is cheap.

**Proof.** (1) Forgery tests: an executor holding only the public key cannot produce an accepted contract; flip each field; expired; wrong audience. (2) Replay test: the same valid contract twice, second refused as consumed; crash between acceptance and the ledger write, with a write-ahead rule. (3) Differential: HMAC and Ed25519 signers accept and refuse identically on a generated matrix. (4) Ablation: a baseline profile with no contract accepts an unsigned release (positive control).

#### A2. Capability-scoped contracts enforced at every port. ADD

**What.** Write the product's capabilities in Scout's family grammar: `read/source.gleif`, `read/source.ofac`, `read/zetaris.query`, `read/memory.recall`, `write/world.assertFact`, `reason/markovian.chain`, `act/po.release`, `act/vendor.update-bank`. Every run starts under a contract whose scope contains no `act/` capability; only the release contract carries one. Every port (M1 channel fetch, the Zetaris MCP client, the World Model write path, the release executor) verifies that the contract id and capability are in scope before the effect and emits `contract.refused` otherwise. An adapter that is down yields a typed `unresolved` capability (`no_adapter`, `unavailable`, `blocked_by_policy`) that maps to our fetch states `unavailable` and `blocked_by_policy`, never a silent skip. The risk filter runs before routing, so a high-risk verdict removes capabilities before any ranking. Our `Step` declarations (reads, writes) compile into the scope so there is one source, not two.

**Motivation.** `docs/capability-graph.md`: "Risk policies can scope by family — 'this user can only do `read/` operations, no `act/`'" and "Scout never makes up a tool. If nothing resolves, it returns a typed error". `examples/tool-plan-generation/README.md`: risk filtering "happens before ranking". `docs/execution-contract.md`: "refused at the boundary — not stopped by a wrapper, refused by the executor." `examples/scout-to-swarm/README.md`: "The contract is the swarm's scope ceiling."

**Improves.** Safety: an injected instruction that makes the quarantined discovery agent fetch an unlisted host, or reach the release port, is refused by capability, with no dependence on detecting the injection. Explainability: every effect in the trace names its authorising contract. Correctness: "source unavailable" cannot be rendered as "clear".

**Cost and risk.** Moderate. Ports already exist (spec M7). Risk: a second mechanism next to `Step` declarations; the compile-from-declarations step removes it.

**Meterless's view.** Strongly positive: it is the property they call "the single most important property in the Scout design".

**Verdict.** ADD. It turns spec principle 7 (untrusted text is data) into a structural refusal.

**Proof.** An adversary-controlled model port attempts every out-of-scope (capability, port) pair, exhaustively: all refused with `contract.refused`. Mutation test: delete the check at each port in turn; the suite must fail each time. Trace linter: every effect event carries a contract id. Positive control: with the check removed, an injected fetch succeeds.

#### A3. Replan lineage for the evidence-gap loop. ADD

**What.** `F-REPLAN` (`planner.replan`) issues a child contract with `parentId`, the same `traceId`, and the existing `why` string as the reason. The child scope may not exceed the parent scope unless an approval record is attached. TTL is never extended. Markovian phase boundaries refresh the contract the same way.

**Motivation.** `docs/execution-contract.md` "Re-planning" and "Don't extend TTL"; `compose-with-swarm.md`: "A run that needs more time than the contract allows calls `scout.replan({ parent })`". This closes the brief's open question "TTL versus run length".

**Improves.** Auditability of the re-plan loop; no scope creep through "also check this other source" text. 

**Cost and risk.** Small. The rule "child scope is a subset of parent scope" is ours; the docs do not state it. Flag it as an extension.

**Meterless's view.** Positive: replan is used as documented.

**Verdict.** ADD (small).

**Proof.** Property test over generated contract chains: scope never widens without an approval record; a TTL-extension attempt is refused; trace shows the chain; exhaustion at `maxVisits: 2` leaves the gap in the ledger.

#### A4. Clarify instead of guess at free-text intake. MAYBE

**What.** Where intake takes free text (A2A chat, an MCP `submit_case` with prose), run Scout's Interpret stage: bind the vendor mention to World Model entity ids; if two candidates are within 0.05, or a required parameter (payee, invoice id, amount) is unbound, or a high-risk intent scores under 0.95, return a structured clarification with up to 4 options naming the candidates and what distinguishes them; below 0.40 fall back to the safe `GENERAL` intent with no tools.

**Motivation.** `docs/scoring.md` and `AGENTS.md` section 4.6 (clarification triggers); "never guess a high-risk intent".

**Improves.** The product premise is paying the wrong counterparty; the first binding of "Acme" to an entity is the earliest place to get it wrong.

**Cost and risk.** Small if free text exists. Their own gates cap the clarification rate (target 0.15, hard 0.25); on a near-duplicate-vendor corpus we will exceed it by design, so report it separately.

**Meterless's view.** Mildly positive. The brief already notes that the value of Scout is the boundary, not classification.

**Verdict.** MAYBE. No benefit if intake is a typed submission with ERP ids (the current design).

**Proof.** Near-duplicate vendor-name corpus (Ltd/Inc/Holdings, diacritics, transliteration): silent mis-bind rate must be 0; correct entity present in the options; compare with forced top-1 binding.

### B. Privacy and local-first

#### B1. Data classes, redaction record and an executable egress manifest. ADD

**What.** Declare a data class on every field and source: `public` (registry data), `internal`, `confidential` (contracts, bank details), `restricted` (full account numbers, tax ids). Model profiles declare the classes they are cleared for. The hosted Nemotron profile is cleared for `public`, and for `internal` only after structural redaction: restricted fields become stable placeholders (`bank_account#1`) that code resolves after the model answers; the model never needs the digits because comparison happens in the rule engine. Redactions are recorded on the case contract (what was masked, never the value). A generated egress manifest lists every host contacted, per call: data classes sent, bytes, redactions applied. A SAMPLE_MODE run with every network primitive replaced by a throwing stub proves zero egress.

**Motivation.** `docs/model-routing.md`: "the profile must be cleared for the data class", "Fallbacks must satisfy the same data-class constraint". `examples/model-profile-routing/README.md`: "`confidential` forces local, full stop. No cost or capability score can override a data-class downgrade". `examples/risk-check/README.md`: "the model never sees the digits", recorded on `risk.redactions[]`. `MT/engines/hmem/docs/privacy-and-local-first.md`: tags include `financial` and `work-confidential`; "Redaction before reinjection". The Gaia and Relay privacy pages are organised as what stays on the machine, what goes out only if you opt in, what is never sent, and what is collected (`MT/docs/products/gaia/privacy.md`, `MT/docs/products/relay/privacy.md`). [W] prompt "Audit memory for privacy ... add a test that fails if memory ever leaves the machine."

**Improves.** Privacy and safety, and usefulness to an enterprise buyer whose first question is what leaves the network. Determinism: placeholders are a bijection, so decisions should be unchanged.

**Cost and risk.** Moderate. There is a real tension: extracting facts from an internal contract with a hosted model sends that contract's text. The policy must pick per class (rule brain or a local profile for `confidential` documents; hosted for `public`). Our demo data is synthetic, so the controls are demonstrated by a differential test with seeded canary values, not by real secrets; that limit must be stated. Placeholders can still appear in model output; harmless.

**Meterless's view.** Very positive: local-first and privacy is 15 of their 100, and "data class wins above cost" is their rule.

**Verdict.** ADD, with the hosted-extraction tension written into the README.

**Proof.** (1) Canary test: seed unique canaries in restricted fields; zero occurrences in any recorded outbound request. (2) Differential: decisions identical with masking on and off across the gold set. (3) Negative control: with masking off the canary does appear (the test can fail). (4) SAMPLE_MODE zero-egress run. (5) The manifest equals the set of hosts contacted in a live run.

#### B2. Erasure by tombstone with delete-before-remove. MAYBE (LAWYER)

**What.** For sole-trader vendors, erase evidence and memory content on request while keeping a ledger entry (written first) and the content hash. Bundles that depended on erased evidence verify as `INDETERMINATE`, the same verdict the spec already uses for rights-gated bodies.

**Motivation.** `MT/engines/hmem/docs/trust-ledger.md`: "Deletes create ledger entries before the memory is removed or tombstoned"; Gaia privacy: "Deletion is real"; World Model tombstones.

**Improves.** Governance fit. Cost: moderate, and it cuts across "episodes are immutable". Legal acceptability is unknown.

**Meterless's view.** Neutral to positive.

**Verdict.** MAYBE. Design it because it is a small extension of the rights gate; do not claim compliance (spec section 18).

**Proof.** After erasure the verifier returns `INDETERMINATE`, never `PASS`; the ledger chain still verifies; retrieval excludes the record; only the hash remains.

### C. Memory and learning (H-MEM)

#### C1. Pinned, replayable precedent retrieval anchored to the ledger. ADD

**What.** Make decision-time retrieval a pure function `retrieve(snapshotDigest, query)`. The snapshot is the set of records used with their `confidence`, `lastAccessed`, `supersededBy`, the weight-profile label and the clock; the decision bundle stores the digest and the retrieval trace (scores, suppressed-superseded count). The single `read` ledger entry is written after, and does not feed the same decision. The H-MEM ledger head hash is added to the case ledger as a leaf, so a verifier can check that precedent P had confidence c at decision time from its `previousState` and `newState` entries. Decision-time reads do not bump `lastAccessed` or `accessCount`.

**Motivation.** In the reference, `query()` calls `store.touch` for every hit (`accessCount += 1`, `lastAccessed = now`) and writes a `read` ledger entry per hit (`MT/engines/hmem/reference/src/memoryRetrieval.ts` lines 84 and 85; `memoryStore.ts` lines 128 to 132) **[R, read in code]**. Recency is 0.05 of the score, so retrieved precedents are boosted for next time: a popularity feedback loop **[inferred]**. Docs: "persist a weight-profile label (e.g. `weights@2026-07`)" (`retrieval-ranking.md`); trace carries `traceId`, "ranker version or weight profile", "suppressed superseded memory count" (`reinjection.md`); "Did the agent ever use the stale March 4 value after the correction?" is a ledger query (`demos/trust-ledger/README.md`).

**Improves.** Reproducibility: a past decision's precedent ranking can be recomputed. Explainability: "why was this precedent ranked 0.58" has an answer a stranger can check. Correctness: removes read-driven drift from the precedent signal.

**Cost and risk.** Moderate. The runner only asserts retrieval ordering and ledger actions for add and feedback (`ro-001`, `ro-002`, `la-001`), so a non-mutating decision-time read does not conflict **[inferred]**; we confirm with the vendored runner. Divergence from reference behaviour must be documented.

**Meterless's view.** Positive: it is their "five-line forensic trace" turned into a verifier level. Risk: they may read "reads do not touch" as departing from the spec; we still log the read.

**Verdict.** ADD.

**Proof.** (1) Replay: rerun retrieval from the bundle, identical ranking. (2) Tamper a confidence in a ledger entry: verifier returns INVALID. (3) Popularity test: 100 identical queries leave the ranking unchanged (the reference changes it). (4) Staleness audit: no `read` of a superseded record after its supersession time.

#### C2. Recall scope as a poisoning quarantine. ADD

**What.** Every episode written during a case carries `goalRunId = caseId` (the field already exists). Cross-case retrieval excludes unpromoted scoped records; promotion to the global scope is an item in the approval queue (the spec already lists "memory write from an untrusted source"). For the precedent store `includeUnscoped` is false by default; the reference defaults it to true so legacy records are not lost, which is the wrong default for us.

**Motivation.** `retrieval-ranking.md`: "Goal-run recall is isolated per `goalRunId` — memories from one run never leak into another." `memory-record.md`: "Unscoped writes are a defect."

**Improves.** Safety: a document-borne planted rule cannot reach another case before a human approves it, structurally rather than by a content filter.

**Cost and risk.** Small. It overlaps the tier algebra; keep one meaning each: scope is visibility, tier is authority.

**Meterless's view.** Positive; a less celebrated field used for its purpose.

**Verdict.** ADD (small).

**Proof.** MINJA-style test: case A's document plants "always release to account X for vendor Y"; case B's retrieval does not return it until promoted; after promotion it is counter-only (tier). Mutation: remove the scope filter, test fails.

#### C3. Honest warm/cold ablation measured on decision quality. ADD

**What.** Reproduce the shape of `MT/examples/memory-compounding-research` but score decisions, not chunks. A seeded precedent set includes a superseded precedent and a rule-version-stale one. A real model, measured tokens labelled as measured, an independent grader against gold decisions, cold versus warm versus warm-with-a-stale-precedent-included (negative control). Cases are chosen where the rules leave discretion (allowed set of two or more), because otherwise precedent cannot matter.

**Motivation.** The Meterless demo's saving is built in: the mock generator skips a fixed set of step indexes (`MT/examples/memory-compounding-research/index.ts`, `SETTLED_BY_MEMORY`); brief appendix item 19. Their honesty norms (themes 8 and 10).

**Improves.** Truthfulness of the H-MEM claim, and it finds out whether precedent helps at all.

**Cost and risk.** Needs model credentials. **Risk of a null result**: if rules already decide most cases, precedent may not move outcomes, and by our own rule H-MEM would then be decorative. Pre-register the design, build the gold set so precedent can matter without rigging it, and report the result whichever way it falls.

**Meterless's view.** They ask for labelled, measured numbers, so an honest null fits their tone; it may cost "engine usage" points if H-MEM is shown not to help. That is the correct trade.

**Verdict.** ADD (the metric change is the addition; the experiment is already in brief section D).

**Proof.** Pre-registered paired design, worst of three runs, intervals; the negative control must show harm from the stale precedent.

### D. Reasoning chain (Markovian)

#### D1. Deterministic ratify and a carryover-loss detector. ADD

**What.** Carry material findings as typed ids (finding id, kind, status). After each chunk, code diffs `carryoverIn` against `carryoverOut`: every id marked material must be retained, or moved to `resolved` with a cause; otherwise raise `carryover-loss` and redo the chunk or escalate. In the compliance profile the compression cascade has no tail-truncation level: overflow stops with `carryover-overflow`, with retention priority decisions, open questions, identity and sanctions hits (pinned above all), entities, progress. Final ratify is a pure function over run history: every decision id in the dossier resolves to a World Model fact id re-read now, and every material id is accounted for. The LLM reflection pass stays advisory.

**Motivation.** `docs/reflection.md` (ratify: "RATIFIED ... or FLAGGED"); `marker-protocol.md` (`carryover-overflow`, "priority order preserved: decisions > open questions > entities > progress"); `compression-cascade.md` (failure mode "Lost entities", "markers can pin entities explicitly", "Custom cascades are pluggable ... `extract`, `rank`, `compress`, `format`"); `run-history.md` ("Removed items mean compression dropped something — sometimes correctly, sometimes not"); `examples/architecture-planning/README.md` ("A DECISION, once in carryover, must be carried forward verbatim", ratify "cross-checks"). The reference cascade ends in word-level tail truncation (`AGENTS.md` section 4.3).

**Improves.** Safety and correctness: it removes the failure the brief names as risk 7 (a dropped sanctions hit). It also makes the Markovian claim honest, because the loss is measured, not hoped away.

**Cost and risk.** Moderate. It matters only in long cases. Budget pressure in deep chains is real; that is what the overflow state is for. By the brief's reading of the runner, the eight checks (`eff`, `snap`, `ovl`, `lab`, `ref`, `mrk`, `cfg`) do not constrain cascade order or internals, so a stricter cascade should stay conformant; I did not read the runner myself, so confirm by running it.

**Meterless's view.** Very positive: they state the problem ("Decisions are not summarizable") and we make the cure mechanical instead of another model call.

**Verdict.** ADD.

**Proof.** Fault injection: a compressor that drops a random material id in 1,000 seeded runs is caught every time by construction; compare with the LLM ratify detection rate (measured, worst of three). Crash-restart equivalence. Ablation: with the detector off, a planted dropped hit reaches the dossier.

#### D2. Deterministic Execution Ratio per dossier. MAYBE

**What.** Report on each dossier the share of decision-relevant steps (rule, verify, gate, recompute events) that ran with zero model calls, and list the model-judged steps. The standalone verifier recomputes it from the trace. A CI invariant: the ratio may not fall between policy versions without a recorded reason.

**Motivation.** `MT/docs/products/relay/features.md`: "Each Skill tracks a Deterministic Execution Ratio (DER) — the share of steps that ran with zero model calls".

**Improves.** Routes reviewer scrutiny to model-judged steps and guards against logic drifting into models.

**Cost and risk.** Tiny. Goodhart risk: it is not a quality measure and must never be quoted as one.

**Meterless's view.** Recognisable (their term); a gesture if used as a headline.

**Verdict.** MAYBE. Ship as a descriptive field only.

**Proof.** Recompute equality by the verifier; ratio of 1.0 when the allowed set has one member (`judge_skipped`).

### E. Evidence and eval culture

#### E1. Inert-implementation controls and gate discipline. ADD

**What.** Run every gate (reconcile, claim attribution, injection, selective release, Scout compatibility) against three stubs: inert (never flags, never holds), always-hold, and label-leaking. Each must fail, or the metric must be reported as undefined instead of 1.0 when a denominator is zero. Thresholds live in one file with a target, a hard floor and per-slice floors; gold sets are append-only and versioned; lowering a threshold needs its own commit with a historical comparison; a near-miss list is printed.

**Motivation.** Scout's own committed report shows an implementation that flags and clarifies nothing scoring injection precision 1.000, clarification 0.000, override 0.000, which clears three of seven gates (`MT/engines/scout-intent/evals/reports/latest.md`); the runner computes precision as 1 when nothing is flagged (`evals/runner/index.ts`, `toMetrics`). `docs/eval-harness.md`: "You don't get to lower a threshold to make a regression 'pass.'" `CONTRIBUTING.md` lists "Threshold lowering" under what they will not merge. `telemetry-and-learning.md`: "Tightening thresholds based on aggregate metrics" is an anti-pattern; "aggregates lie".

**Improves.** The correctness of our own measurements; brief risk 2 (passing the runner by coincidence).

**Cost and risk.** Small. No downside.

**Meterless's view.** Strongly positive, and a fix for a weakness in their harness (also material for E4).

**Verdict.** ADD.

**Proof.** A table of stubs by gates, all failing; CI fails the build if an inert stub passes any gate.

#### E2. "Prove each test can fail" per engine. ADD

**What.** A scripted table of deliberate breaks per engine: skip a memory write, drop a carryover, reorder world events, weaken an injection rule, skip the `supersededBy` ledger entry, tamper a contract field. Run the vendored runners and our extended suites against each; every break must be caught; misses are listed and fixed. Publish the table.

**Motivation.** [W] engines.html prompt "Prove each test can fail": "skip a memory write, drop a chunk carryover, reorder an event, weaken an injection rule ... Report any break the tests missed, and add a test that catches it." World Model `reference/scripts/idempotency-check.ts` `--mutate`.

**Improves.** The strength of the suites that prove the sponsor engines; extends our mutation practice (spec sections 5 and 13) to the engine layer.

**Cost and risk.** Small to moderate.

**Meterless's view.** Very positive: it is their prompt.

**Verdict.** ADD.

**Proof.** Mutation score per engine; every uncaught break becomes a new test.

#### E3. Trace-derived wired-versus-helper map. ADD

**What.** A script reads the JSONL traces of the recorded scenarios and lists, per engine API, how many times it ran in the decision path. CI fails if the evidence table claims an engine function with zero calls. The evidence table the spec calls "documentation, not product code" becomes a generated artifact.

**Motivation.** `MT/engines/world-model/AGENTS.md` section 8.3 ("The wired-vs-helper trap ... Audit what is actually injected at runtime, not what could be") and section 13 item 12; `MT/templates/README.md` ("use at least one engine for real (no faked engine behavior)"); the guide's "every command routes through a named engine service".

**Improves.** Claim integrity and dead-code detection. It does not change product behaviour; it is ADD because our own rule requires that a claimed sponsor integration be real and this makes it checkable.

**Cost and risk.** Small.

**Meterless's view.** Positive; their own recommendation.

**Verdict.** ADD.

**Proof.** The map equals the set of call sites exercised by the ablation runs; removing an engine call from the path makes the CI check fail.

#### E4. Contribute upstream, as a by-product only. ADD (by-product), otherwise REJECT

**What.** Export, at no extra build cost: (a) an H-MEM community eval in their markdown template from our stale-precedent suites; (b) per-class injection JSONL files plus a proposal to let the Scout runner pass `snippets`, because document-borne injection cannot be expressed today (the runner passes only `prompt`, `user`, `surface`); (c) engine-spec-feedback issues for the discrepancy register with failing tests; (d) a results post in Discussions.

**Motivation.** `MT/engines/hmem/evals/tests/README.md`: "No community evals have been submitted yet. Yours can be first."; `MT/CONTRIBUTING.md` on implementation feedback; Scout `ROADMAP.md` v0.2 "per-class injection files" and "Eval marketplace"; [G] open issue 3 (`supersedes` never yields `supersededBy`), the only open issue; [G] release v1.0.6 says results from your own runs go to Discussions.

**Improves.** Not the product directly. It is useful only because writing the eval forces our precedent tests into a portable, reviewable form.

**Cost and risk.** The H-MEM folder accepts markdown only (`MT/engines/hmem/CONTRIBUTING.md`: "What not to contribute: Source code files"), so (a) is cheap; (b) touches harness code. Whether public posting before our window opens, or upstream contributions at all, is compatible with the hackathon rules is **NOT VERIFIED** and is Prateek's decision.

**Meterless's view.** Positive and visible.

**Verdict.** ADD as a by-product of tests we already run; REJECT if it would cost build time that is not also a test of ours.

**Proof.** The exported eval, run against the vendored reference, passes or fails as predicted; every issue reproduction command runs clean from a fresh clone.

### F. Operators and judge experience

#### F1. The World Model operator control-plane contract as the acceptance spec for our entity and source review panel. ADD

**What.** Adopt their five capabilities and three roles as the acceptance criteria for our review panel: Inspect (entities, contexts, edges with validity windows, facts with provenance); Merge and unmerge as reversible alias events with a side-by-side diff; Edit as a superseding event with operator provenance; Rebuild a derived view from the event log; Repair by replaying one source after an extractor fix, the bad events kept and superseded. Roles viewer, editor, admin map to our buyer, reviewer, approver and are enforced where events are appended, not in the UI. The audit browser filters by entity, source, operator, kind and time.

**Motivation.** `MT/engines/world-model/docs/operator-control-plane.md`: "CLIs are fine for ingestion and replay. They are bad for judgment." "A viewer trying to commit an edit gets rejected at the boundary, not in the UI." `control-plane/README.md`: "A world model with no control plane calcifies." Their shipped control plane is a mock plus a `live.html` wired to the reference; ours would be a real tool.

**Improves.** Usefulness: a reviewer must be able to undo a wrong vendor link. Safety: permissions at the append layer. It is also the user interface for the retraction cascade and bad-source discovery in spec section 11.

**Cost and risk.** Moderate, inside a console we are building anyway. Do not create a second model of identity: alias events are a projection of our judgement edges (spec section 8), one source of truth.

**Meterless's view.** Strongly positive: the acceptance criteria are theirs.

**Verdict.** ADD.

**Proof.** Merge then unmerge returns an identical truth-table hash. A role-by-action matrix tested at the append layer. Repair replay: bad events retained, replacements supersede, views equal a fresh recomputation. Visual QA per `QA_MASTER_GUIDE.md`.

#### F2. A single-file offline bundle of the real implementation. MAYBE

**What.** A build-time bundle (`esbuild`, a development dependency only) that produces one HTML file embedding the real implementation, a recorded case and the offline verifier, openable by double-click.

**Motivation.** `MT/engines/world-model/reference/scripts/build-browser-bundle.ts`: "browsers block external module imports on the null origin, so the bundle is embedded, not referenced"; the control-plane README says the page runs the actual reference "in your browser from a double-click".

**Improves.** Judge reproducibility with no server and no Node, and a literal local-first demonstration.

**Cost and risk.** Moderate: browser stubs for `node:fs` and `node:path`, a generated artifact to keep fresh (CI: regenerate and diff), a second delivery path to test in three browsers. Pointless if our console already works from `file://`. I did not test the module-over-`file://` claim; it rests on their comment.

**Meterless's view.** Positive.

**Verdict.** MAYBE. Do it only if the console uses ES modules.

**Proof.** Open from `file://` in Chrome, Firefox, Edge; the bundled verifier passes on the bundled dossier; a freshness check fails if the bundle is stale.

#### F3. Agent-ready repo conventions with case-sensitive checks. ADD

**What.** A root `AGENTS.md` that routes by task (under 100 lines), a short `AGENTS.md` per module stating its contract and its acceptance gate command, an `llms.txt`, the `.cursor/rules` pointer already present. Scripts in CI and in the clean-room run: a case-sensitive relative-link checker, a convention checker (no empty folders, naming, root file budget), an example runner.

**Motivation.** `MT/AGENTS.md` ("Find your task type. Go to that folder. Load nothing else."); `MT/scripts/README.md` (links verified "case-sensitively (Windows and macOS hide casing bugs that break on GitHub)"); `MT/docs/agent-ready/using-with-cursor.md` ("Cursor reads AGENTS.md natively"); [W] "any assistant that can read a link can read the whole stack".

**Improves.** A real defect class for a Windows developer whose judges clone on Linux (link casing), navigability for judges' agents, and Cursor evidence.

**Cost and risk.** Small.

**Meterless's view.** Positive.

**Verdict.** ADD (cheap), because the casing check prevents an actual failure.

**Proof.** The checker fails on a seeded casing error; a clean clone on Linux (or WSL) passes it.

### G. Reliability

#### G1. Provider failure taxonomy. MAYBE

**What.** Classify `ModelPort` errors as `rate_limit` (retry with full jitter, charged to the budget), `quota` (fail fast), `transient`, `fatal`.

**Motivation.** [G] release notes of `Meterless/swarms`: failures "classified ... retried with exponential backoff and full jitter ... Quota/fatal errors fail fast"; `MT/docs/products/swarms/features.md`: rate-limit or quota failures "are reported honestly instead of retried into a wall."

**Improves.** Reliability against hosted-endpoint limits and budget soundness. It is not an engine feature and Meterless would hardly notice.

**Cost and risk.** Tiny.

**Verdict.** MAYBE (small). 

**Proof.** Fault injection at the port (429, quota, 500, 400) gives the expected class, retry count and budget charge.

### H. Rejected, with the reason and what would reopen each

| Id | Idea | Verdict and reason | Reopen if |
|---|---|---|---|
| H1 | **Markovian across batch vendor reviews.** Our spec section 11 currently lists "batch reviews" among Markovian uses. | REJECT. Carryover that crosses independent counterparties lets facts about vendor A reach vendor B's context (identity bleed) and breaks bounded blast radius and the M3 cannot-link rule. Their docs: Markovian is for "going deep along one path"; parallel independent work is Swarm tasks ("The work needs multiple specialists in parallel → use Swarm with multiple tasks", `compose-with-swarm.md`); "If your work fits in one model call, you don't need Markovian" (`content/comparison.md`); break-even `N > 1 + 2C/O` assumes one sequential task. A batch is a fan-out of independent per-case runs (spec M7) plus a code-level batch aggregate over typed results (for example cumulative exposure). Proof of the hazard: a contamination test that runs vendor B after A in one chain and shows B's dossier citing A's facts. | Never for independent cases. Markovian stays inside one deep case (ownership chain). |
| H2 | **H-MEM trust ledger as the decision audit trail** (replacing M9). | REJECT. The reference ledger is an array plus a JSONL file with no hash chain and no entry id (the docs show `"id":"led_123"`; `reference/src/trustLedger.ts` `log()` creates none) **[R, read]**; it is keyed by `memoryId`, not by case; "append-only" is a convention, not a proof; it records memory mutations, not rule evaluation or evidence verification. Keep it as a memory-mutation ledger and anchor its head into M9 (idea C1). | Never as a replacement. |
| H3 | **Scout Stage-2 local embedding classifier** (50 to 200 MB). | REJECT. Breaks "no runtime installs"; with 7 to 13 intents Stage 1 (deterministic trigger scan) suffices; the spec calls Stage 2 "an upgrade, never a dependency". | Free-text intake grows past a few dozen intents. |
| H4 | **Relay-style shadow mode for rule proposals.** | REJECT as redundant. Our rule outputs are deterministic, so replay under a proposed rule is exact (spec: policy time travel); shadow mode adds nothing for rule outputs and cannot create propensities for human outcomes. | We add a model-based guard whose verdicts are telemetry only. |
| H5 | **H-MEM sleep `execute` or synthesis on precedents.** | REJECT. The reference deletes sources on archive and synthesis (`sleepCycle.ts` lines 89 and 108, `store.delete`), which contradicts immutable episodes. Use `sleep.preview()` for reporting only; "archived" becomes a tombstone in a view. Also respect their rule: "Do not add dreaming before users can inspect trace and approve proposals" (`content/one-pager.md`). | Never on the precedent store. |
| H6 | **Markovian pause markers and `approvalGates` as our approval mechanism.** | REJECT. Our M7 human steps already fail closed at step boundaries. The reference parses `[NEEDS_TOOL]` and `[NEEDS_CLARIFICATION]` but has no `resume` or `approvalGates` (`reference/src/markers.ts`), so we would build them only to show depth, with no decision they change. | A long case needs mid-chain adjudication that the M7 step boundary cannot give. |
| H7 | **Variant generation or a fuzzer for the attack corpus** (Swarms-style fan-out; Scout roadmap "Adversarial fuzzer"). | REJECT. Our guarantee is structural (restrict-only gate, capability refusal) and independent of detector recall; more variants only measure telemetry detectors. | We publish detector recall numbers. |
| H8 | **"Memory saved N chunks and M tokens" as a headline.** | REJECT. The chunk count measures their mock generator, not decision quality; report measured, labelled tokens, decision quality (C3), and where chunking loses (break-even). | Never as a headline. |
| H9 | **Gaia, Relay, Swarms or Nightshift as dependencies.** | REJECT, reaffirming spec section 19. The docs show no programmatic interface (`ROADMAP.md`: "`packages/` (CLI, SDK, MCP server) appears only when working code exists"); Relay is Windows-native desktop automation we do not need; [W] Nightshift local editions are unreleased ("The download link isn't live yet"; Mac preorder delivery Q4 2026), so a judge could not run them. Any local OpenAI-compatible endpoint already works through our `ModelPort`, without naming Nightshift. | An app exposes a documented API and a measured gain. |
| H10 | **World Model name-keyed ids and `ingest()` clustering for payee identity.** | REJECT as stated. A name-keyed id (`ent_` plus a hash of type and normalised name) changes when a legal name changes; clustering and velocity are built for news streams; `ingest()` appears to bypass the resolution pass **[inferred, brief A.2 item 6]**. Use external keys (LEI, CIK, vendor id) as the brief already says. | Never for payment-affecting identity. |

## 4. Ranking, warnings and unspecified items

### 4.1 Top five

Ranked by product improvement for a payment-release system, strength of grounding in their documents, cost, and risk to judge reproducibility.

1. **A2 Capability-scoped contracts enforced at every port.** Turns "untrusted text is data" into structural refusal at each effect, and it is the property they call the most important in Scout.
2. **A1 Asymmetric, single-use release contracts.** Removes forgery by any verifier and replay inside the TTL on the highest-consequence action, through their documented signer extension point.
3. **C1 Pinned, replayable precedent retrieval anchored to the ledger.** Fixes a real reproducibility defect (reads change the ranking) and gives the verifier a precedent level.
4. **D1 Deterministic ratify and carryover-loss detector.** Prevents the named failure (a dropped sanctions hit) mechanically instead of with another model call.
5. **B1 Data classes, redaction record and egress manifest.** The privacy story an enterprise buyer asks about first and the criterion Meterless weights at 15, with the hosted-extraction tension stated honestly.

Cheapest high-signal items to do regardless of rank: **E1** (inert controls), **E2** ("prove each test can fail"), **E3** (generated wired-versus-helper map), **F3** (casing and convention checks). Next after the five: **F1**, **C2**, **C3**, **A3**.

### 4.2 Spec lines this readout contradicts or extends

- Section 11 lists "batch reviews" as a Markovian use: change it (H1).
- Section 12 says the engines are "proven by the vendored unmodified conformance runners ... plus extended suites"; add E2 and E1 as the way the extended suites themselves are tested.
- Section 19 "Local-first proof" is one sentence; B1 makes it an executable manifest.
- Section 5 "signed, expiring, case-bound capability": add single use and an asymmetric signer (A1) and say that it is a Scout contract (A2).
- Section 11 should state that decision-time retrieval is a pure function of a pinned snapshot (C1).

### 4.3 Things their documents warn about that affect us

- Markovian: numbers are modeled, not measured; label measured versus estimated; no saving below a few chunks; "The engine starts winning around step 5 and starts being essential around step 20" (`content/launch-post.md`); a chunk is a bounded blast radius.
- Scout: targets are "not measured results"; the corpus is "a smoke set — 32 examples total — not a benchmark"; "Do not quote the target numbers as measured results until the corpus reaches that scale" (`docs/eval-harness.md`). Clarification is a cost with a hard ceiling.
- H-MEM: replay and session rewind are "deliberately out of scope", so as-of replay must live outside it; auto-resolve at confidence 0.70 and above only; "raise the threshold so we auto-resolve more" is "the wrong instinct" (`workshops/05-trust-and-conflict.md`); the reference is "not a production library".
- World Model: money belongs in a transactional database; "Idempotency requires deterministic enrichment. LLM calls inside the pipeline must be re-runnable or cached" (README trade-offs), which is exactly why our extractor calls go through cassettes; hash ids need name normalisation.
- Contract: HMAC is "not a cryptographic-grade defense"; contracts are "a handoff format, not a database"; never extend a TTL; immutable after signing.

### 4.4 Things their documents leave unspecified or inconsistent (each affects a decision of ours)

- Replay of a valid contract inside its TTL; signer key custody, rotation, audience; whether a child contract's scope may exceed its parent's; the canonical JSON profile used for signing. **[inferred gaps]**
- Scout API names that appear only in examples: `guard({ snippets })`, `planContext`, `process`, `classifyMulti`, `runFromContract`, `signingSecret`. The eval runner calls only `decide()` with `prompt`, `user`, `surface`; it never exercises the snippet pass, multi-intent, or `expected.risk`, and a prompt that throws is skipped from the denominators.
- World Model APIs that exist in docs and workshops but not in the reference or the runner: `merge`, `unmerge`, `replay`, `atEvent`, `waitForConsistency`, `buildPromptContext`, `contextAt`, `rebuild(view)`. Per-attribute conflict policy is documented, global in the reference.
- H-MEM: reads mutate state; no privacy filter in the reference (searched `reference/src` for redaction and privacy handling, none found); `review`-tagged memories are still injected (per the brief, not re-checked); sleep deletes; `supersedes` does not set `supersededBy` ([G] issue 3, open since 2026-10-02).
- A Meterless-hosted model gateway: `docs/model-routing.md` says "There's no Meterless-hosted model gateway", Gaia's FAQ mentions "a Meterless localhost router", and the site's Nightshift serves a local OpenAI-compatible URL [W]. The organisers' phrase "Meterless: local and cloud provider" most plausibly refers to that local-plus-cloud routing, but this is **NOT VERIFIED** (HackOS and Power Day material not read).
- Site versus repo drift (section 1.5): five engines versus four, tier names, a "Runtime Quality Layer" with no spec.

## 5. What could not be verified

- Nothing was run: no conformance runner, reference test, example or eval. Every behavioural statement about the references comes from reading source or docs; items tagged **[inferred]** need a failing test of ours before they are repeated.
- The HackOS Meterless folder, Build Day and Power Day material were not available; whether Meterless runs its own judging, and with the weights in its guide, is unknown.
- The `meterless.ai` pages are a moving target; I read home, benchmarks, engines, about and tools in full or in part, and only searched `how-it-works` and `models`. Their claims (DGX Spark measurements, "signed receipts", the Outcome Contract) were not checked and no Nightshift software was available.
- The product repos (`Meterless/gaia`, `relay`, `swarms`) contain `LICENSE`, `README.md`, `assets`, `docs` only; I read their release notes, not any source. Product claims are the vendor's own.
- Date discrepancy to capture with `/capture-intel` and record in `docs/intel/06-source-gaps-and-discrepancies.md`: the site's engines page [W] describes the Open Agent Hackathon as "Oct 15 to 20, 2026 ... 144 hours" with registration closing "Oct 13, 00:00 UTC", while this repository's rules use a window opening 22 October 2026 00:00 UTC (`docs/DECISIONS.md` D-001). The Official Rules on the event page win and have not been re-read here.
- Whether upstream contributions or public posts before the window are compatible with the originality and eligibility rules (E4).
- Whether Chrome and others block module scripts on `file://` as their bundle script claims (F2); not tested.
- The effect sizes of every idea (privacy overhead of masking, ablation outcome of precedent, detector recall) are unmeasured; each is a hypothesis with a named test.
