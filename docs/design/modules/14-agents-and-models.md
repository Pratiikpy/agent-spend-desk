# Module 14: Agents and Models

## v5.1 alignment (2026-10-15, spec section 0 wins where this blueprint disagrees)

- Roles, pairings and the additional strong patterns are specified in `docs/design/05-agent-behaviour-matrix.md` (23 roles: 10 LLM, 12 code, 1 offline red-team; every organizer behaviour mapped to a trace event and a test).
- Nemotron is the primary model profile (Super default, Nano for helper steps, Ultra for deepest planning); the deterministic rule brain remains the credential-free fallback (D-018).


## Integration revision (2026-10-13)

Pass 2 against `99-integration-register.md`. Edits are in place; sections the register does not touch are unchanged. Nothing here is built or measured.

**Applied** (what changed, where):
- INT-027: judge ceiling is the restrict-only rule (`s ⪯ r` autonomous, `s ≻ r` a `judge_loosening` item, `s ∉ A` rejected); floor and `needsApproval` removed; fail-closed value is `r` (C9, C19, C10, C16, C18, interfaces).
- INT-028: C9 uses M5's `JudgeInput`/`JudgeOutput` handles, M5's `validateJudge` and M6's `PrecedentRetrieval`, `validateJudgement` and one dismissal vocabulary; local judge types deleted; skip rule is `|L| = 1` with precedent retrieval still run (C9).
- INT-012: extractive arm is the default, generative the control, M4 guards apply to both; `Decomposition` uses `parentRef`, atoms become `Claim`s with `pieces` and `decomposer` (C7, Spec feedback 6).
- INT-019, INT-022: the extractor's model-call broker is M8 K2; `ExtractionSchema` is the shared type (M8 kinds, M2 parsers, M14 prompt and agreement states); the network claim names the probed backend (C4, C13).
- INT-005: models see per-prompt aliases from M2 `renderForModel`, keyed by the C12 block nonce, alias map in the cassette, mapped to `sp_` ids by code (C4, C8, C12).
- INT-023: web discovery is conditional; the deterministic table ships, the LLM variant emits `Proposal<DiscoveryQuery>` and is on only if the ablation shows a gain (roster, C5, C18).
- INT-009: M12 owns `dataClassMap.json`, unmapped classes become `internal-sensitive`; this module uses the spec vocabulary only (C15).
- INT-020: model HTTP goes through `ctx.net`; each profile has an M8 egress entry with `modelProfile` and `maxConf` (= `clearedFor`); `disclosureProfile` is M1's separate axis (C13, C15).
- INT-002: Why kinds include `human_reported`; `decider` is `code | model | human`; a structured human decision is a `rule` reason `human.approval.<code>` (C10, C20).
- INT-035, INT-036: C6 is nominate then confirm per pair with edge `inputs` equal to the pair's assertions, `locality: "set"` as the budget fallback, direction passed by M3.
- INT-042, INT-054, INT-056: `canonicalRequest` is M7's `normalise`, cassettes keyed by effect slot with request-hash check; M7 owns the one trace schema and verb registry, C20 events are verbs; `ModelPort` declaration and `capabilities` are M7's (C13, C20). Only the ModelPort items of INT-056 apply here.
- INT-058: reasoning cap in the reservation, no-overshoot stated as conditional (C15).
- INT-059, INT-060: M11 owns `PreReg` and `ArmSpec`; this module supplies `RoleArmContent`, metrics and H1 to H5 text; a run is confirmatory only after a public post-window commit of its pre-registration (C18).
- INT-062 (i): the multi-family NVIDIA catalog and the OpenAI-compatible claim beyond base URL and path are flagged NOT VERIFIED; the evaluation profile plans for a second provider key (C13, C15).
- INT-065 (Spec feedback 3, 7, 9, 10, 12): spec wording only; the blueprint already stated these, so only the roster note and the disposition marks changed.
- Register section 5, V10: `ModelPort` types, scripted adapter and rule-brain interfaces move to build-order step 11c, before step 12 (C1, C13, C16).
- By consequence, not named for this module: INT-011 (autonomy values renamed `AL0` to `AL2`); INT-021 (prompts are an egress sink capped by the profile).

**Named for this module and not applied:** none skipped. Partly applied: INT-056 (only its ModelPort rows) and INT-062 (only item i), because the rest is other modules' ports and sponsor wording.

**New contradictions found:**
- Shared `Claim.decomposer` (`none | llm:… | sentence-fallback`) has no value for the rule-brain clause splitter of C16; it needs a `rule:<id>` member (conventions, M4). The shared `Piece` offsets do not state their unit; C7 uses code points of the sentence.
- M4's L2 judge port (`JudgeInput {claim, units}`, `JudgeOutput` with `contrarySpanIds`, `Voter`) and C8's `EntailmentVerdict` (`missingPieces`, no `contrarySpanIds`) are two shapes for one role, and the names `JudgeInput`/`JudgeOutput` collide with M5's policy-judge types.
- Model-cascade tiers `T0` to `T3` collide with M8's Plumbline-Inject tiers `T0` to `T3` (INT-026); the INT-011 names table lists neither.
- `ProfileSet` name `local-confidential` (spec section 15) versus M8 `EgressEntry.modelProfile` value `local`; `offline` has no egress entry. INT-020 maps neither.
- M5 §C8 does not say what happens when the judge fails at the end of the ladder; C9 sets `r` unchanged (the judge-off arm). M5 to confirm.

Status: implementation blueprint against spec v3.1, written 2026-10-13. Nothing here is built or measured; every design claim is a hypothesis with a named test, and anything not seen is marked **NOT VERIFIED**. Reference metadata (stars, licence, last push) was read with `gh api` on 2026-10-13; code behaviour is cited to files read in the local clones under `research/`, and paper results are cited to the verified entries of `docs/design/prior-art/`.

## 1. Scope and contract

**What this module is for.** It owns the agent layer: the roster and each role's typed contract, the planner and the re-plan loop, every LLM-bearing role, the critics and reflexion, the reporter, the prompt system, the model layer (ports, adapters, structured output, profiles, routing, accounting), the deterministic rule brain, the collaboration behaviours with the tests that show each can change an outcome, the role-necessity ablation protocol for these roles, failure drills and the agent trace conventions.

**What it does not own.** Reconciliation (M3), claim verification pipeline and the exact causal layer (M4), the policy engine and gates (M5), the runtime, effect layer, budgets, cassettes, the `ModelPort` declaration and the single trace schema (M7), the trust lattice, compartment enforcement, the model-call broker (K2) and the extraction contract's kinds and validator (M8), the shared `PreReg` and `ArmSpec` schemas and the ablation runner (M11), document text layers and span aliases (M2), source channels (M1), the trace linter and bundle (M9), the sponsor adapters' evidence (M12), the evaluation harness and statistics (M11). This module consumes their ports and produces typed values for them.

**Spec sections refined.** 15 and 1a (roster, visible five), 21 (F-REPLAN, F-DISCOVER, F-STAGES, F-BUDGET, reflexion limits), 19 (Nemotron profile), 5 (compartments, restrict-only), 10 (judge ceiling, reflexion), 9 (L1 to L3 roles), 15 (models and profiles, role-necessity ablation). Decisions D-005 to D-013 apply: no build limit, TypeScript, schemas as JSON Schema, a substrate chosen by bake-off, two model profiles, every component owned.

**Inputs.** Typed, labelled values from M3, M4, M5, M6 and the case (`Labelled<T>` carrying `trust` and `conf`); text-layer spans from M2; the closed action registry (M8/M12); channel metadata and probe status (M1); profiles and credentials from configuration.

**Outputs.** Typed role outputs (`RoleResult<O>` with trust, validators passed, stop reason, usage), plan objects, proposals awaiting gates, judge selections, reflexion trails, rendered dossier text, model inventory reports, and the agent trace events of section C20.

**Depends on.** M7 (ports, effect keys, budgets, cassettes, trace, `Proposal`/`Approved`), M8 (labels, compartments, closed grammar executor), M2, M1, M4, M5, M6. **Depended on by.** M7 graph nodes (each role is a step), M3 (matcher), M4 (decomposer, judges), M5 (judge, critics, reflexion), M9 (trace, bundle metadata), M10 (run view), M11 (ablation harness), M12 (Nemotron evidence).

**Organizer definition used as the acceptance bar** (`docs/event/04-approach-guide-solutioning.md` section 9): the strong pattern needs back-and-forth, validation of outputs, retries, shared state, branching on confidence or risk, and "role specialisation with real interdependence"; at least three of nine checklist items. This module targets all nine and tests each (C17).

## 2. Component list

| # | Component | One line |
|---|---|---|
| C1 | Roster, role contracts, role runner | Typed contract per role, one execution path for every role, visible-five mapping |
| C2 | Planner | Deterministic plan templates, source routing, `Proposal<Check>` and the plan gate |
| C3 | Coverage check, re-plan loop, stall rule | Code-owned evidence-gap loop with `maxVisits` and a state-derived stall counter |
| C4 | Document extractor | Quarantined span-labelling extractor with double extraction |
| C5 | Web-discovery role (conditional) | Deterministic query table by default; an LLM may only propose `Proposal<DiscoveryQuery>`, enabled only if the ablation shows a gain |
| C6 | Entity matcher | Nominate from a list with order swap, confirm per pair, and a direction-aware application rule |
| C7 | Claim decomposer | Extractive atoms (spans plus entity handles), generative arm as control |
| C8 | Verification roles | L2 judge, advocate, skeptic, arbiter panel, sensitivity-driven compute allocation |
| C9 | Policy judge | Selection at or below the recommended action; a loosening is an approval item, never an effect |
| C10 | Critics and reflexion | Hard critic (validators), soft critic (rubric), code-written reflections |
| C11 | Reporter and paraphrase verifier | Deterministic renderer, optional paraphrase behind a mechanical verifier |
| C12 | Prompt system | Hash-pinned artefacts, slot-only templates, injection-safe construction, few-shot, prompt tests |
| C13 | ModelPort and adapters | OpenAI-compatible adapter with dialects, NVIDIA hosted configuration, scripted, schema-fuzz, local stub server |
| C14 | Structured output and sampling | Constrained decoding when probed, validate-reject-never-repair, reasoning handling, sampling policy |
| C15 | Profiles, routing, cascades, accounting | Profile sets, data-class clearance, tier ladder, retries, breaker, token ledger |
| C16 | Rule brain | Real deterministic algorithms behind every role interface |
| C17 | Collaboration behaviours | Ten behaviours, trace event and outcome-changing test each |
| C18 | Role-necessity ablation | Operational protocol, arms, per-role metrics, pre-registration schema |
| C19 | Failure drills and attribution | Fault catalogue per role, expected fail-closed value, mechanical blame |
| C20 | Agent trace conventions | Event types, fields, content policy, OpenTelemetry mapping |

Source layout (names only; nothing exists yet): `src/agents/roles/`, `src/agents/brain/`, `src/agents/prompts/` (named `<group>.<role>.<variant>.md` as in `docs/design/agent-pairings.md`), `src/agents/fewshot/`, `src/models/` (`port`, `openai-compat`, `scripted`, `schema-fuzz`, `profiles`, `router`, `accounting`), `tests/agents/`, `eval/prereg/`.

---

## C1. Roster, role contracts and the role runner

**Best references.**
- Role-necessity and role-by-role verdicts: `prior-art/12` sections 1, 8, 9 (MAST Cemri et al. 2025, Kim et al. 2025, Tran and Kiela 2026, Choi et al. 2025, Zheng et al. 2023 on personas; all abstract-level reads there).
- Step contracts with `critical`, `deterministic`, `derived_keys`: FinRobot V2 `finrobot_desktop/finrobot/engine/pipelines/step.py` and `runner.py` (Apache-2.0; read in `prior-art/06` section 3, `runner.py` lines 47-80 and 443-880 re-checked in the clone).
- Typed state and handoff input filters: `research/track-3-reasoning-architecture/unified-all-three-tracks/openai-agents-python/src/agents/handoffs/__init__.py` (`HandoffInputData`, `input_filter`, line 158) (MIT).
- Collaboration checklist and strong versus weak patterns: `docs/event/04-approach-guide-solutioning.md` section 9.

**What they actually do.** FinRobot's `PipelineStep` makes validation, retry class and degrade behaviour properties of the step, not of the prompt; a validation failure on a `deterministic` step skips the re-prompt loop because the output cannot change (`runner.py` lines 797-810). The OpenAI Agents SDK lets a pure function rewrite what the next agent sees (`input_filter`), but its input guardrails run in parallel with the model by default (`guardrail.py` line 100) and cover only the first agent. MAST's finding (prior-art 12 section 2.1) is that specification and verification failures dominate, so contracts and validators are the intervention that matters; persona text does not (Zheng et al., section 5.5).

**Decision.** Own. A role is defined by (view, tools, output schema, model tier, compartment), never by a persona sentence. One `RoleRunner` executes every role so that validation, labelling, budgets and tracing cannot differ between roles.

**Implementation design.**

```ts
type VisibleAgent = "Planner" | "EvidenceRetriever" | "DomainReasoner" | "SafetyRiskEvaluator" | "Recommendation";
type Compartment = "P" | "Q-proc" | "Q-ro";   // privileged; quarantined child process; quarantined, read-only corpus tools
type Tier = "T0" | "T1" | "T2" | "T3";         // code; small; mid with samples; different-family panel (human is outside the ladder)
type StopReason = "completed" | "budget" | "validator_failed" | "escalated" | "contested" | "failed_closed" | "skipped";

interface RoleSpec<I extends Json, O extends Json> {
  id: RoleId; visible: VisibleAgent; kind: "code" | "llm";
  compartment: Compartment;
  input: SchemaRef<I>; output: SchemaRef<O>;          // JSON Schema documents, JCS-hashed (D-011)
  view: (s: Readonly<RunState>) => View<I>;           // pure context packer; viewHash goes in the trace
  textAccess: "none" | "typed_only" | "untrusted_text";   // P roles are "typed_only" or "none"; enforced by the label registry
  tools: readonly ToolGrant[];                         // closed list; empty unless stated
  outputTrust: (inputs: readonly Labelled<unknown>[]) => TrustLevel;   // pure; model output never above EXTRACTED
  tiers: readonly TierStep[];                          // ordered cascade, cheapest first
  sampling: SamplingPolicy; budget: RoleBudget;
  prompt?: PromptRef; validators: readonly Validator<I, O>[];          // schema first, then semantic
  failClosed: (f: RoleFailure) => O;                   // pure, restrictive value (section C19)
  brain: (i: I, ctx: BrainCtx) => Result<O, RoleFailure>;               // pure rule-brain implementation (C16)
  autonomy: "AL0" | "AL1" | "AL2";                     // autonomy ladder (INT-011); per docs/design/agent-pairings.md
}
interface RoleResult<O> { value: Labelled<O>; stop: StopReason; usage: Usage; attempts: AttemptTrace[]; brain: "llm" | "rule"; grade: "llm" | "rule-brain" | "sentence-fallback" }
interface RoleFailure { role: RoleId; step: string; field?: string; code: "schema_invalid" | "quote_absent" | "span_unknown" | "rule_id_unknown" | "allowed_set_violation" | "counter_unaddressed" | "timeout" | "refusal" | "truncated" | "budget" | "profile_not_cleared" | "model_unavailable" }
```

Roster ("+" marks the two roles the spec section 15 list omitted and INT-065 adds to it, see Spec feedback 7; the web-discovery role is conditional, INT-023):

| Role | Kind | Visible agent | Compartment | Reads | Tools | Tier ladder | Output (schema id) |
|---|---|---|---|---|---|---|---|
| Plan template engine | code | Planner | P | typed case | none | T0 | `Plan` |
| Plan augmenter+ | llm | Planner | P | typed case summary | none | T2 | `ProposedChecks` (becomes `Proposal<Check>[]`) |
| Source router | code | Planner | P | channel metadata, authority table | none | T0 | `RoutingDecision` |
| Coverage checker | code | Planner | P | gap ledger | none | T0 | `ReplanRequest[]` |
| Document extractor | llm | EvidenceRetriever | Q-proc | text-layer spans of one document | none | T1, T2 | `Extraction` |
| Web-discovery (conditional; the deterministic table is the default) | llm | EvidenceRetriever | P (typed refs only) | typed case refs | none | T1 | `DiscoveryPlan` of `Proposal<DiscoveryQuery>` |
| Entity matcher | llm | EvidenceRetriever | Q-ro | nominate: mention and candidates as data; confirm: one pair | none | T1, T2 | `MatcherVerdict`, `PairConfirmation` |
| Claim decomposer | llm | SafetyRiskEvaluator | Q-ro | one text segment plus entity table | none | T1 | `Decomposition` |
| Entailment (L2) judge+ | llm | SafetyRiskEvaluator | Q-ro | claim, cited spans | none | T1, T2, T3 | `EntailmentVerdict` |
| Advocate | llm | SafetyRiskEvaluator | Q-ro | claim, corpus | `corpus.search`, `corpus.read` | T2 | `Brief` |
| Skeptic | llm | SafetyRiskEvaluator | Q-ro | claim, corpus | same tools | T2 | `Brief` |
| Arbiter layer 1 | code | SafetyRiskEvaluator | P | verified briefs, tiers | none | T0 | `ArbiterOutcome` |
| Arbiter panel (residue) | llm | SafetyRiskEvaluator | Q-ro | claim, verified spans | none | T3 | `PanelVerdict` |
| Policy judge | llm | DomainReasoner | P | typed values only, as handles | none | T2, T3 | M5 `JudgeOutput` |
| Hard critic | code | SafetyRiskEvaluator | P | any output | none | T0 | `Findings` |
| Soft critic | llm | SafetyRiskEvaluator | Q-ro | rendered dossier, decision record | none | T2 (different family) | `Rubric` |
| Reporter renderer | code | Recommendation | P | ledger | none | T0 | `Dossier` |
| Paraphrase | llm | Recommendation | Q-ro | one rendered sentence plus its claim records | none | T1 | `Paraphrase` |
| Paraphrase verifier | code | Recommendation | P | paraphrase, source sentence | none | T0 | `ParaphraseVerdict` |
| Reconciler, evidence weaver (L0), rule engine, sensitivity router | code | DomainReasoner / SafetyRiskEvaluator | P | owned by M3, M4, M5 | none | T0 | owned elsewhere |

Per-role budget and output trust (budget values are initial hypotheses taken from the F-BUDGET phases, **not measured**; `T14.C1.budget-fits` checks that the sum of worst-case role budgets along the longest path fits the run budget with the finalize reserve and the organizer's 5 to 10 minute target):

| Role | Calls and wall clock (cap) | Output trust (inputs `UNTRUSTED` / otherwise) | Autonomy |
|---|---|---|---|
| Plan augmenter | 1 call, 512 out, 20 s | `EXTRACTED` / `EXTRACTED` (and gated) | AL1 (proposal only) |
| Document extractor | per document at most 12 chunks, 24 calls, 60 s | `UNTRUSTED` / `EXTRACTED` | AL0 |
| Web discovery (conditional) | 1 call, 256 out, 15 s | `EXTRACTED` (typed refs only) | AL1 |
| Entity matcher | per task at most 8 calls (6 nominate, 2 confirm), 128 out, 20 s | `UNTRUSTED` / `EXTRACTED` | AL0 |
| Claim decomposer | 1 call per sentence, at most 40 sentences per run, 20 s each | `UNTRUSTED` / `EXTRACTED` | AL0 |
| L2 judge | at most 5 calls per claim (2 at T1, 3 at T2), 384 out | `UNTRUSTED` / `EXTRACTED` | AL0 |
| Advocate, skeptic | at most 3 tool steps plus 1 submit each, 30 s | `UNTRUSTED` / `EXTRACTED` | AL2 (bounded loop) |
| Arbiter panel | 3 calls, 1,536 out, 45 s | `UNTRUSTED` / `EXTRACTED` | AL0 |
| Policy judge | at most 2 calls, plus at most 2 reflexion retries and 1 advisory revision | `EXTRACTED` | AL1 |
| Soft critic | 1 call (3 in evaluation), 384 out | `EXTRACTED` (advisory) | AL0 |
| Paraphrase | 1 call per sentence, at most 60 sentences | `UNTRUSTED` / `EXTRACTED` | AL0 |

Mapping to the organizer pairings of `docs/design/agent-pairings.md`: Planner plus Doer is the plan template and augmenter with the M7 runner as doer (stops on rubric failure through the gate and the coverage check); Proposer plus Critic is the policy judge with the soft critic (exactly one fix, one revision; pass mark 7 of 9); Context-Packer plus Actor is `view()` for every role (compact typed payloads, hashed); Evidence-Weaver plus Synthesizer is L0 plus the reporter renderer (every sentence maps to claim ids; unmet limits become gaps). Each pairing has its prompt files, a typed contract, a trace line per hand-off and a test that forces the critic path (C10).

Compartment rules, stated once. (a) P roles never receive a field typed `UntrustedText`; the label registry rejects it at `view()` time and a test builds a view containing one and expects `view_contains_untrusted_text`. (b) Q roles receive untrusted text only as data blocks (C12). (c) No role has network, filesystem or state-changing authority; tools are `corpus.search(query)` and `corpus.read(spanId)` over the frozen per-case span index only, executed by code. (d) A model output is `Labelled` with `outputTrust` = `combine` over every input label, capped at `EXTRACTED`; a value derived from any `UNTRUSTED` input is `UNTRUSTED`. (e) The runner is the only code that calls a `ModelPort` for a role.

**Role runner algorithm** (`runRole(spec, input, ctx)`; all effects through `ctx`):
1. `view = spec.view(state)`; `viewHash = hash(JCS(view))`. Resolve the data class of the view as the join of its labels (C15).
2. If `spec.kind = "code"` or the active brain is `rule`, call `spec.brain`, validate, label, trace with `brain: "rule"`, return.
3. Build the tier plan: `tiers = router.plan(role, dataClass, profileSet, attempt)`; each tier has a profile, sampling, `samples` count and fallbacks that satisfy the same data class.
4. For each tier step: reserve budget (`ctx.budget.reserve(estIn + maxOut + reasoningCap)`); render the prompt (C12); call `ctx.model.complete(request)` for each sample (distinct `sampleIndex` in the effect key); settle the reservation from provider usage.
5. Extract the answer (C14): strip only the documented reasoning wrapper, parse strictly, validate against the output schema, then run `spec.validators` in order. Any failure is a typed `RoleFailure` with attribution; nothing is edited or repaired.
6. Tier acceptance is decided by validators and sample agreement, never by model-reported confidence (prior-art 12 section 6). Accepted: label, trace, return. Rejected: if attempts remain at this tier, one re-ask (same prompt plus the typed failure code, not the model's own output); else escalate to the next tier; at the end of the ladder return `spec.failClosed(failure)` with `stop: "failed_closed"`.
7. Every step writes trace events (C20). Any exception other than a typed failure is a bug and crashes the run (fatal), not a degraded success.

**Tests and acceptance.**
- `T14.C1.schema-golden`: every role schema's JCS hash equals the committed golden hash (a schema edit is a deliberate act).
- `T14.C1.view-purity`: `view()` is deterministic and hash-stable across 100 shuffled state key orders.
- `T14.C1.p-role-rejects-untrusted-text`: forged and honest `UntrustedText` fields in a P view are rejected (with M8's forged-object tests).
- `T14.C1.no-persona-claim`: lint that no registry entry lists a persona as the reason for a role; each entry must name at least one of tools, view, tier, compartment as its differentiator.
- `T14.C1.failclosed-total`: for every LLM role, every `RoleFailure.code` has a `failClosed` value and it validates against the output schema.
- Metric: valid-first-pass rate per (role, profile) = responses passing schema and semantic validators on the first attempt divided by calls; reported with the Wilson interval.
- Disproof: if any P-compartment role can be built whose view includes untrusted text without a test failing, the contract is vacuous and the design is wrong.

**Risks and NOT VERIFIED.** The set of validators per role is a design; their sufficiency is empirical (C19). Whether JavaScript module privacy plus runtime registry suffices for `Labelled` unforgeability is M8's test, not shown here.

**Build notes.** First: `RoleSpec`, `runRole`, the scripted port and the rule-brain hook, so every later role plugs in. Unblocks all other components. Build-order position (register section 5, V10): the `ModelPort` types and scripted adapter (C13) and the rule-brain role interfaces (C16) are built at step 11c, before step 12, because the M4 L1/L2 acceptance and the M2 extractor acceptance need them; prompts, real models and the doctor stay at step 13.

---

## C2. Planner: templates, source routing, `Proposal<Check>`, plan gate

**Best references.**
- Magentic-One orchestrator (Task Ledger and Progress Ledger, re-plan on stall): `research/track-3-reasoning-architecture/unified-all-three-tracks/autogen/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py` (MIT code; `prior-art/12` section 5.1; paper arXiv 2411.04468 read at abstract level there).
- open_deep_research supervisor with tools `ConductResearch` and `ResearchComplete` (`research/track-2-agent-that-can-explain-why/open_deep_research/src/open_deep_research/deep_researcher.py` lines 178-330, MIT).
- gpt-researcher `choose_agent` and `generate_sub_queries` (`gpt_researcher/actions/agent_creator.py`, `query_processing.py`, Apache-2.0).
- Organizer pairing 1, Planner plus Doer, at most 5 steps (`docs/design/agent-pairings.md`).
- Anthropic multi-agent research system (scaling rules inside the lead prompt; `prior-art/12` section 3.3, vendor blog, self-reported).

**What they actually do.** Magentic-One keeps a task ledger (facts, guesses, plan) and a progress ledger; every step the orchestrator model answers booleans `is_request_satisfied`, `is_progress_being_made`, `is_in_loop` plus a free-text `instruction_or_question`, and the stall counter rises on "no progress" or "in loop", falls by one otherwise (floor 0), and at `max_stalls` the orchestrator re-enters its outer loop, rewrites facts and plan, and continues (`_magentic_one_orchestrator.py` lines 340-405). The progress judgements are model assertions, the re-plan count is bounded only by `max_turns`, and the broadcast instruction is free text. open_deep_research's supervisor delegates by calling `ConductResearch(research_topic: str)`; the topic is a free string passed to a sub-researcher with no registry, and overflow is answered with an error message rather than dropped (lines 262-330). gpt-researcher's `choose_agent` parses model JSON with `json_repair`, falls back to a default agent on failure (`agent_creator.py` lines 57-90) and `generate_sub_queries` falls back across three model settings (lines 117-160): both convert a failure into a confident-looking default. None validates a model-proposed step against a closed set of capabilities.

**Decision.** Own. Adopt the two-ledger typed state and the stall counter shape; replace every model-asserted signal with a state-derived one; delegation targets are registry actions; the model may only add checks, and only through a gate.

**Implementation design.**

```ts
interface Check { id: Id<"ck">; subQuestion: Id<"sq">; action: ActionId; params: Record<string, ParamRef | EnumValue>; origin: "template" | "replan" | "proposal"; why: Why }
interface PlanStep { id: Id<"st">; check: Check; dependsOn: Id<"st">[]; budgetWeight: number; onFail: "gap" | "abort"; required: boolean }
interface Plan { id: Id<"pl">; template: { caseType: string; version: string; hash: Hash }; steps: PlanStep[]; subQuestions: SubQuestion[]; amendments: Id<"am">[] }
```

1. **Template selection** is a pure decision table (`select(case): {template, why}`), data under `packs/procurement/plans/`, JCS-hashed, keyed by case type and typed flags (foreign vendor, amount band, new bank details within N days, onboarding or release). Each template lists sub-questions (identity, sanctions, ownership, bank account, document validity, litigation, internal history, duplicate or shell) and, per sub-question, the registry action and parameter references (`$case.vendorRef`, `$entity.lei`). Parameters are references, never literals from a model.
2. **Source routing** (F-DISCOVER): `routeSources(sq, attrs)` is pure over M1's channel metadata and the pack's per-attribute authority table. It returns `candidates` (channel, authority tier for that attribute, `canHandle`, last probe status, estimated cost), `chosen`, `rejected` with codes (`lower_authority_than_chosen`, `probe_failing`, `not_applicable_jurisdiction`, `rights_gated`, `over_budget`) and a built `why`. Trace rule id `plan.source_routing`.
3. **Plan augmenter** (the only LLM call in the planner). View: a typed summary (entity type, ISO jurisdiction codes, amount band, flags, the plan's `(subQuestion, action)` pairs, current gap codes) plus the registry's own action descriptions, which are our pinned text, never a remote tool description. Output: at most 3 `{action, paramRefs, subQuestion, reasonCode}`; `reasonCode` is an enum (`JURISDICTION_NOT_COVERED`, `PARENT_ENTITY_UNSCREENED`, `NAME_VARIANT_UNSEARCHED`, `DOCUMENT_TYPE_UNVERIFIED`, `ADVERSE_SIGNAL_UNFOLLOWED`, ...). No free text exits. It reads no untrusted text, so it is P-compartment.
4. **Plan gate** (`planGate.apply(Proposal<Check>) -> Result<Approved<Check>, GateReject>`, constructed only here): reject unless (a) `action` is in the registry and `readOnly`; (b) params validate against the action's schema and every value is a `ParamRef` or enum member; (c) the check's canonical hash is not already in the plan; (d) the sub-question exists; (e) the channel serving it is not lower authority than an already chosen channel for the same attribute; (f) estimated cost fits the remaining slice; (g) per-sub-question and per-run proposal caps hold. A proposal can add a check; it cannot remove, reorder or relax a template check or change a parameter of one (restrict-only extended to planning: more checking is restrictive). Each accept and reject is a `decision` event with `why_kind: "computed"`.
5. **Instantiate** assigns content-derived ids so the same case yields the same plan hash; the plan is part of shared state and hashed per commit.

**Tests and acceptance.**
- `T14.C2.template-determinism`: same case, same plan hash; any flag flip changes exactly the documented steps (snapshot per template).
- `T14.C2.gate-rejects`: one test per rejection code with a hostile proposal (unknown action, literal URL in a param, write-class action, duplicate, lower-authority channel, over budget, sixth proposal).
- `T14.C2.proposal-cannot-weaken`: a property test: for any proposal sequence, the template steps and their params are bytewise unchanged in the final plan.
- `T14.C2.registry-pin`: changing a registry action description changes the augmenter prompt hash and fails the prompt lock until re-pinned.
- Metrics: proposal acceptance rate; proposal outcome-change rate (C17); sources-reached recall on planted-conflict cases with and without the augmenter (C18).
- Disproof: if across all seeded cases and three live runs no accepted proposal ever changes an action or a gap, "dynamic delegation" is withdrawn from the claims and the README says the planner is a template (spec section 15 already allows this).

**Risks and NOT VERIFIED.** Whether a Nemotron-class model proposes useful checks from a typed summary at all is unmeasured. The registry itself is M8/M12's artefact; this blueprint assumes it exposes `{id, readOnly, paramSchema, channel, costClass, description}`.

**Build notes.** Templates and router first (pure, testable on the rule brain), then the gate, then the augmenter. Unblocks C3.

---

## C3. Coverage check, re-plan loop and stall rule

**Best references.** Magentic-One outer loop (same file as C2); open_deep_research iteration cap `max_researcher_iterations` (`deep_researcher.py` lines 247-262); gpt-researcher deep mode early termination (`deep_research.py` line 511, per `prior-art/03` section 1); MAST modes FM-1.3 step repetition and FM-1.5 and FM-3.1 termination (`prior-art/12` section 2.1); LangGraph-style per-cycle visit bounds (`prior-art/06` sections 4 and 9.5).

**What they actually do.** The re-plan trigger in Magentic-One is the model's own "no progress" answer. open_deep_research bounds the loop by iteration count and ends quietly on tool errors. gpt-researcher bounds by breadth and depth. None computes progress from state, none records why research stopped as a gap in the output (the gap-ledger point of `prior-art/03` failure mode 3).

**Decision.** Own. Progress and loops are computed from hashed state, not asserted; exhaustion becomes a gap that caps confidence (F-REPLAN).

**Implementation design.**

```ts
interface ProgressSnapshot { evidenceIds: Hash; openSubQuestions: Hash; gapLedger: Hash; claimLabels: Hash }
interface StallState { stalls: number; seenEffects: Set<Hash> }   // Hash = effect key of (action, canonical params)
function updateStall(prev: ProgressSnapshot, next: ProgressSnapshot, issued: readonly Hash[], st: StallState): StallState   // pure
// +1 if next equals prev on evidenceIds and openSubQuestions, or if any issued effect key was already seen (loop);
// otherwise max(0, stalls - 1). maxStalls = 2 (initial value).
function coverageCheck(plan: Plan, ledger: GapLedger, ch: ChannelIndex, visits: Map<Id<"sq">, number>): ReplanRequest[]   // pure
```

1. After M3 and M4 recompute, `coverageCheck` reads the gap ledger. For each required or gap-bearing sub-question that is `unanswered` or `conflicted_unresolved`: candidates are eligible channels not yet queried for it plus extracted-but-unexamined documents. No candidates: write terminal gap `no_source_available`. `visits[sq] >= 2`: write gap `replan_exhausted`. Else emit `ReplanRequest{sq, trigger: "unanswered" | "conflict_unresolved" | "proposal_followup", candidates, why}`.
2. `planner.replan` amends only that sub-question: new `Check`s with `origin: "replan"` drawn from `candidates` in authority order (code, not model). The augmenter may add proposals again only if the visit budget allows and the gate passes.
3. The retriever fetches under a budget slice carved by `split(parent, weights)` from a `replanReserve` of the retrieval phase (initial 25 percent, tuned from traces). M3 and M4 recompute on the delta only; assertions are idempotent.
4. Stall: the stall rule runs inside a fetch round (several actions issued for one sub-question); `maxVisits` runs across rounds. At `stalls >= maxStalls` the sub-question is closed with gap `stalled` and a `decision` event `rule: coverage.stall`.
5. Every outcome writes `coverage.replan` with `inputs` (sub-question, visit count, candidate ids) and a code-built `why` such as "sub-question S3 unanswered; channel courtlistener unqueried; visit 1 of 2".
6. The `request_more` edge from M3 reuses the same function with `trigger: "conflict_unresolved"` when a higher-authority source is unqueried.

**Tests and acceptance.**
- `T14.C3.replan-changes-ledger`: first pass lacks evidence, the re-plan fetches it, the ledger hash changes, the gap closes (F-REPLAN test).
- `T14.C3.exhaustion-caps`: three consecutive empty rounds end at `replan_exhausted`, confidence cap holds, the run still finishes.
- `T14.C3.loop-detected`: a scripted augmenter that re-proposes the same check is rejected by the gate (duplicate) and counted as a stall.
- `T14.C3.stall-state-derived`: the stall counter depends only on snapshots (property test over random snapshot sequences against a reference implementation).
- `T14.C3.no-model-boolean`: grep test that no stall or progress decision reads a model field.
- Metric: re-plan yield = closed gaps divided by re-plan rounds; wasted-round rate = rounds ending in stall.
- Disproof: a sub-question closed as `stalled` while an eligible unqueried channel exists means the candidate function is wrong.

**Risks.** Initial `maxStalls` and the reserve fraction are untuned. The gap-ledger shape is M4's; this blueprint needs `answer(sq)` and `gap(sq)` queries from it.

**Build notes.** After C2 and the M3/M4 interfaces exist as stubs; test first on the rule brain with recorded fixtures.

---

## C4. Document extractor (quarantined)

**Best references.**
- Quarantined extractor design: `prior-art/10` section D.3 and A4 (CaMeL Debenedetti et al. 2025; Beurer-Kellner et al. 2025; Triedman et al. 2025, all abstract-level).
- Spotlighting (Hines et al., arXiv 2403.14720, `prior-art/10` A8): delimiting or datamarking reduces attack success on GPT-family models in the authors' tests; no guarantee.
- FActScore and SAFE decomposition prompts as the "return a fixed structure" contract (`prior-art/04` sections 1 and 2).
- Locator and text-layer contract: spec section 7 (M2). Deterministic parser first, model second: `prior-art/10` D.3 item 5.

**What they actually do.** The security literature keeps the component that reads attacker text free of tools and constrains its output to typed data; CaMeL reports 77 percent task success with provable security against 84 percent undefended on AgentDojo, a stated utility cost (`prior-art/12` section 10.4). Spotlighting changes only the probability of obeying injected text. No cloned repository does span-id extraction with a code-supplied quote; they ask the model to copy text (STORM's `AnswerQuestion` and FinRobot extraction prompts return generated strings, `research/track-1-fragmented-intelligence/storm/knowledge_storm/storm_wiki/modules/knowledge_curation.py` lines 167-180).

**Decision.** Own, built on the spec principle "the model points, the system quotes". The extractor is a span labeller, not a text generator.

**Implementation design.**

```ts
// ExtractionSchema is the one shared type (INT-022): M8 C9 owns the closed kinds and the validator (`enum` with anchors, `bool`, `int`, `date`, `decimal`,
// `id`, `span_ref`; no free-string kind), M2 owns `parser: ParserId`, the normalisers and `groundValue`, this module owns the prompt and the agreement states.
// Per-field flags are `required`, `holdRelevant` (one name for M2's `critical`) and `anchors`.
interface FieldCandidate { spanIds: Id<"sp">[]; parserValue: Json | null; modelValue: Json | null; agreement: "agree" | "model_only" | "parser_only" | "disagree" }
interface Extraction { docHash: Hash; textLayerHash: Hash; schema: Hash; fields: { fieldId: string; status: "found"|"absent"|"ambiguous"; candidates: FieldCandidate[] }[];
                       coverage: { chunksTotal: number; chunksOk: number; pagesSeen: number }; suspicion: { code: string; spanIds: Id<"sp">[] }[] }
```

Compartment and wiring. The M2 parser and this role's prompt construction run in the restricted child process (Q-proc). The child has no network, so it cannot call a hosted model. The **model-call broker is M8 K2** (one design, not two): the parent accepts exactly one message type from the child, `ExtractorRequest` (fixed schema, size cap, role id fixed to this role), forwards it to `ModelPort` and returns the response; the parent never interprets the document text beyond hashing and size accounting. Whether the child really has no network is the probed compartment backend's claim (M8 C8: `os-netns`, `node-net-permission` or `node-flags-only`), recorded in the run header; this module never states "network denied" without the backend name (INT-019). Spec feedback 2.

Algorithm for one document:
1. The child receives the text layer as a span list of M2 `SpanRecord`s (id `sp_` plus 24 hex, page included). A deterministic scanner (regexes and checksums: ISO 17442 LEI mod 97, IBAN mod 97, date and amount grammars per locale, table cells from M2 coordinates) proposes candidates per field and records `suspicion` codes for instruction-like strings (imperative verbs addressed to "the assistant", role markers, tool names, "ignore", base64 runs). These suspicion codes are telemetry that force escalation, never a gate (spec section 5).
2. Chunk by page with a span overlap; each chunk becomes one data block (C12) of at most `maxSpansPerChunk` spans, rendered by M2's `renderForModel(spans, nonce)` as per-prompt aliases (`⟦nonce:S12⟧ text`), where `nonce` is the block's per-run nonce from `ctx.rng` (INT-005). Aliases are shorter than content ids and cannot be forged by document text (`SEC-I12`); the alias map is stored in the cassette (M8 C9) so replay renders the identical prompt. The prompt gives the closed `ExtractionSchema` field list with definitions; per-run random delimiter and line datamarks are applied.
3. The model returns, per field, `{fieldId, spanAliases[], modelValue?, none?: true}`. Code maps each alias back to its `sp_` id; an alias not issued in this prompt is `span_unknown`. `modelValue` must match the field kind; `enum` values must be members. No free text field exists in the output schema.
4. Code takes the value from the span text with the field's parser (`parserValue`, M2 registry; `groundValue` gives exact, normalised or ungrounded), and the parent runs M8's per-kind justification check on values derived by code from the spans. `agreement` is computed: `agree` (same normalised value), `parser_only` (model found nothing where the scanner found a candidate), `model_only`, `disagree`. For hold-relevant fields every non-`agree` state is emitted as a conflict item for M3, never a vote.
5. Across chunks, multiple candidates for one field with different values give `ambiguous` with all candidates; never last-wins.
6. A required field with no candidate in any chunk is `absent` with `coverage` attached; the policy (M5) treats absent required document facts as a hold. A chunk that failed validation after the cascade counts in `chunksTotal - chunksOk`; if any chunk failed, `absent` is reported as `absent_incomplete_coverage`, which is a different state.
7. Tier ladder: T1 single sample; on validator failure or on `disagree`, T2 with two samples; still failing: `unextracted` for that field.

Trust: every extracted value is `UNTRUSTED` when the document is counterparty-authored, `EXTRACTED` only for documents from a `SOR` or `VERIFIED` source; the `suspicion` list is `UNTRUSTED`-derived metadata with enum codes.

**Tests and acceptance.**
- `T14.C4.span-only-output`: schema has no string field that is free text; fuzz test (`schema-fuzz` port) returning every valid output for a small schema never yields a value absent from the span text.
- `T14.C4.double-extraction-conflict`: planted documents where model and parser disagree produce conflict items, never a silent choice.
- `T14.C4.chunk-merge`: a certificate with the expiry on page 3 and a different "revised expiry" on page 5 yields `ambiguous`.
- `T14.C4.alias-forgery`: an alias from another prompt, a content id `sp_...` and a forged alias are all rejected as `span_unknown`.
- `T14.C4.no-network-in-child`: the child fails any socket open, run with M8's compartment probes; the assertion names the backend that ran, and under `node-flags-only` the report says the network claim is not made (Node 22 has no network permission flag).
- `T14.C4.suppression` (feeds `SEC-I18`): benign twin versus injected document, decision equality oracle; reports extractor steer rate with an upper bound (M8/M11 own the oracle).
- Metrics: field precision and recall against gold labels; silent-wrong-field rate (value differs from gold with `agree` state); steer rate; unextracted rate.
- Baselines: parser-only (rule brain), single-context monolith (A1).
- Disproof: the model adds no recall over the scanner on the gold set at the pre-registered margin (then the role is replaced by code and the README says so), or a planted instruction changes a decision.

**Risks and NOT VERIFIED.** Instruction-following of the hosted models on a span-labelling prompt is untested. Scanned documents depend on M2's OCR path. The broker is M8 K2. Network denial for the child is **NOT VERIFIED** on the Node 22 baseline (no network flag); the claim follows the probed backend.

**Build notes.** Scanner and merge logic first (pure), then the broker and prompt, then the cascade. Unblocks M2 acceptance and `SEC-I18`.

---

## C5. Web-discovery role (conditional)

**Best references.** STORM `QuestionToQuery` and `TopicExpert` (query strings produced as free lines, split on newlines, capped by `max_search_queries`; `knowledge_curation.py` lines 154-245, MIT); SAFE `maybe_get_next_search` (one new query that adds information not in the current knowledge; `prior-art/04` section 1.2); `prior-art/10` D.5 (typed queries only; the model never supplies a URL); spec section 5 (closed grammar executed by a typed channel, or drop the role).

**What they actually do.** STORM's expert turns a question into search strings with the model, runs them, and answers from the first snippet; a failure becomes the apology string "Sorry, I cannot answer this question", which is an honest abstention. SAFE loops five times without an early stop. Neither bounds the grammar of what is searched.

**Decision.** Own, and **conditional in the roster** (INT-023). Deterministic query construction (`discovery.table`: templates x aliases x pinned vocabulary, fixed order) is the shipped default. An LLM may only emit `Proposal<DiscoveryQuery>` values that M8's closed grammar validates, and the LLM variant is enabled only if the ablation (C18) shows a recall gain at matched cost; with a closed grammar the model can only choose among template ids and slot references and rank them, which a lookup table also does, so the expected outcome is that it stays off. If it stays off, the README names the role as dropped.

**Implementation design.**

```ts
interface DiscoveryQuery { channel: ChannelId; template: TemplateId; slots: Record<string, SlotRef | VocabTerm> }   // SlotRef -> $vendor.legalName | $vendor.alias[i]; VocabTerm in a pinned risk vocabulary
interface DiscoveryPlan { subQuestion: Id<"sq">; queries: Proposal<DiscoveryQuery>[]; maxQueries: number }   // LLM variant only; the table emits Approved<DiscoveryQuery> directly
```
1. The pack defines per channel the query templates and a pinned risk vocabulary (`fraud`, `sanction`, `insolvency`, `recall`, `litigation`, ...). The executor (typed channel in M1/M8) resolves `SlotRef`s to values from the case; the model never writes a literal.
2. The model (LLM variant only) sees only typed refs and sub-question ids (no snippets), so it is P-compartment. It returns up to `maxQueries` ordered `Proposal<DiscoveryQuery>`. M8's grammar gate validates each: template exists, slots are exactly the template's slots, refs resolve, vocabulary terms are pinned, no duplicates by canonical hash; only `Approved<DiscoveryQuery>` reaches the executor.
3. Results enter as secondary-authority `UNTRUSTED` evidence (M1) and pass the extractor like any document. Discovery cannot supply a URL, cannot read results, and has no second round (a second round would put untrusted text in its view).
4. Default and baseline `discovery.table`: expand templates over aliases and the vocabulary in fixed order, truncated to the budget. The LLM variant must beat it at equal queries to be switched on.

**Tests and acceptance.** `T14.C5.closed-grammar` (every valid output of the schema is executable and contains no literal outside refs and vocabulary); `T14.C5.no-url` (grep and schema test); `T14.C5.egress` (queries contain no value above `public` per the egress manifest; the vendor name is classified `internal-sensitive` per spec, so queries to third parties are blocked unless the pack marks that lookup disclosable); metrics: planted secondary-source facts reached per query spent, versus `discovery.table` at equal queries. Disproof: no gain with the interval excluding zero.

**Risks.** The egress rule may make most discovery impossible for confidential counterparties; that is a product finding, not a bug. Jina Reader is discovery only (spec section 6).

**Build notes.** Build and ship `discovery.table` first; the LLM variant is a swap behind the same interface, built only so the necessity test can run.

---

## C6. Entity matcher (select-from-list)

**Best references.**
- Three-region link decision and the weight ledger: spec section 8; `prior-art/07` (Fellegi-Sunter lineage, Splink, nomenklatura; read there).
- ReConcile (round-table, confidence-weighted voting): `research/track-1-fragmented-intelligence/ReConcile/utils.py` lines 145-180 and `generation.py` (MIT, dinobby/ReConcile 207 stars, last push 2023-10-03).
- Position bias and order-swapped pairwise judging: gpt-researcher `evals/context_filter/judge.py` (a win counts only if it wins in both orders; `prior-art/03` section 1.5).
- Meterless Scout clarification and binding gates (`docs/sponsors/meterless-docs-readout.md`, item on near-duplicate vendor binding): silent mis-bind must be 0.

**What they actually do.** ReConcile maps each model's self-reported confidence through a step function (`trans_confidence`: at most 0.6 gives 0.1, up to 0.8 gives 0.3, up to 0.9 gives 0.5, up to 1 gives 0.8, exactly 1 gives 1) and sums per answer for a weighted vote, with a fallback of 0.0 when parsing fails (`utils.py` lines 145-228). Self-reported confidence is the signal prior-art 12 section 13.2 rejects (Huang; Panickssery). The gpt-researcher judge's both-order rule is the position-bias control we adopt.

**Decision.** Adapt the both-order rule; own the contract and the direction-aware application rule. Reject confidence-weighted voting.

**Implementation design.**

```ts
type MatchDirection = "screening" | "corroboration";   // screening: a link ADDS a hold (sanctions, PEP, adverse); corroboration: a link ADDS permission (registry record is our vendor)
interface MatcherInput { task: Id<"mt">; direction: MatchDirection; mention: FeatureView; candidates: FeatureView[] /* 2..5 */; ledger: WeightLine[] }
interface MatcherVerdict { choice: `c${number}` | "none" | "abstain"; reasonCodes: MatchReason[]; agreement: "both_orders" | "disagree" | "single" }   // nominate only; records nothing
interface PairConfirmation { subject: Id<"mn">; candidate: Id<"mn">; link: "link" | "no_link" | "abstain"; reasonCodes: MatchReason[]; agreement: "both_orders" | "disagree" | "single" }   // the recorded edge
```
1. Blocking and scoring are M3's. The matcher is called only for the `possible` band, with at most 5 candidates and the additive weight ledger lines as typed features (`SAME_ADDRESS_TOKEN_SET`, `LEGAL_FORM_DIFFERS`, ...). Names, addresses and descriptions arrive as data blocks (Q-ro); nothing else.
2. **Nominate** (two calls, tier T1): candidates in two seeded permutations with relabelled ids `c1..ck`. `choice` must name the same underlying candidate in both, or both `none`; otherwise `abstain`. `reasonCodes` are an enum (`TRANSLITERATION_VARIANT`, `DIFFERENT_JURISDICTION`, `DIFFERENT_LEGAL_FORM`, `SAME_OFFICER`, ...) and are `model_reported`, never evidence. Disagreement escalates to T2 with two further samples per order; still disagreeing: `abstain`. The select call only nominates: the model also read the other candidates, so its output is not an edge (INT-036).
   **Confirm** (two calls, in both orders): for a nominated candidate only, a pairwise call on (subject, nominee) with nothing else in view. The recorded edge is the confirmation, and its `inputs` are exactly those two mentions' assertions, so edge locality is testable by re-judging with non-cited evidence removed (spec section 9). Confirmation must agree in both orders and with the nomination, else `abstain`. Cost: one extra pair of calls per nominated pair, inside M3's per-case ceiling of 12 calls. If the budget forbids confirmation, the edge's `inputs` is the union of every shown candidate's assertions and the certificate says `locality: "set"`.
3. **Application rule** (`applyMatcher(direction, confirmation) -> LinkEffect`, pure, owned here, called by M3, which passes the direction for every candidate set; INT-035):
   - `screening`: a confirmed `link` adds the link (hold-relevant); `no_link`, `abstain`, `none` and an unconfirmed nomination leave the candidate `possible` (escalation). A model judgement **never clears** a screening candidate; clearing needs a deterministic discriminator (different date of birth, different LEI, different jurisdiction on an authoritative record) or a human. The verdict is stored as `model_nonlink_advice` for the reviewer.
   - `corroboration`: a confirmed `link` is recorded as a model-judged link with trust at most `EXTRACTED` that cannot satisfy a required positive-evidence manifest entry on its own (it needs a deterministic corroborating identifier); `none`, `abstain`, `no_link` and an unconfirmed nomination add no link (restrictive).
4. Output trust is `combine` of the inputs, hence `UNTRUSTED` for registry-authored names.

**Tests and acceptance.**
- `T14.C6.screening-none-does-not-clear`: a planted true sanctions match on which the scripted model answers `none` still escalates (this is the test the spec wording "failure means do not merge" would fail).
- `T14.C6.corroboration-link-not-sufficient`: a model-judged registry link without a deterministic id leaves the release manifest unsatisfied.
- `T14.C6.order-swap`: a position-biased scripted model (always picks `c1`) yields `abstain` on every non-trivial item.
- `T14.C6.edge-locality`: removing a candidate the confirmation did not name leaves the edge, its `inputs` and its hash unchanged; a nominee the confirmation rejects leaves a screening candidate `possible` (never cleared).
- `T14.C6.series-ab`: "Series A" versus "Series B" planted pairs, false-merge rate 0 at the product threshold with the Wilson/3-over-n bound reported (spec section 8 acceptance).
- Metrics: false-merge rate; recall at a fixed review budget; abstain rate; position-bias rate = fraction of items whose single-order answers differ; against M3's cascade without the model, Splink and nomenklatura (bake-off 3).
- Disproof: the model adds no recall at zero false merges over the cascade alone (then the role is code).

**Risks.** Candidate sets with injected name strings can steer among at most 5 plus two outcomes; the application rule bounds the damage to extra holds (screening) or no extra permission (corroboration). Reason-code vocabulary needs a domain reviewer.

**Build notes.** After M3's candidate generator exists; develop on the scripted port first. Unblocks bake-off 3 comparison.

---

## C7. Claim decomposer

**Best references.** SAFE `revise_fact`, `check_relevance` and FActScore `AtomicFactGenerator` with `fix_sentence_splitter` and BM25-retrieved demonstrations (`prior-art/04` sections 1.2, 1.6, 2.2; read in `research/track-2-agent-that-can-explain-why/long-form-factuality` and `FActScore`, Apache-2.0 and MIT); ragas atomicity and coverage vocabulary; the drift guard of spec section 9 L1; WikiChat claim splitting (`prior-art/03` section 6).

**What they actually do.** SAFE decomposes with an LLM, then rewrites each fact to be self-contained under "must not change, must not add"; if parsing fails the original fact is kept, and relevance parse failures default to relevant (`prior-art/04` section 1.3). The constraints live in a prompt, so drift is detected afterwards, not prevented.

**Decision.** Own, two arms (INT-012). Default **extractive** atoms: each atom is an ordered list of spans of the parent sentence plus entity handles, so the atom text cannot contain a word the sentence did not; the drift guard is structural, not a post-hoc check. Control arm **generative** (SAFE-style), scheduled in C18. M4's guards (drift, coverage, atomicity, dedupe) apply to both arms. Self-containment is done by entity-handle substitution in the extractive arm, so M4 §C5 item 3 (the rewrite pass) applies to the generative arm only. Which arm wins is decided by C18; the sentence fallback remains for no-model runs. The shared `Claim` carries optional `pieces` and `decomposer`, `text` is derived from `pieces` when present, and the parent link is `parentRef: {doc, sentenceIdx}`.

**Implementation design.**

```ts
type Piece = { k: "span"; start: number; end: number } | { k: "entity"; handle: Id<"en"> } | { k: "join"; token: " and " | ", " | " " };
interface Atom { pieces: Piece[]; kind: Claim["kind"]; checkWorthy: boolean | "unknown" }
interface Decomposition { parentRef: { doc: Id<"doc">; sentenceIdx: number }; atoms: Atom[]; grade: "llm-extractive" | "llm-generative" | "sentence-fallback" }
// Span `start`/`end` are code-point offsets into the sentence (INT-004 unit). Each atom becomes a shared `Claim` with `pieces` and
// `decomposer: llm:<arm>/<served model id>` (arm = extractive | generative) or `sentence-fallback`; `grade` stays the metric label.
```
1. Deterministic segmentation (Intl.Segmenter plus an abbreviation and initials guard; effectiveness for our abbreviations is **NOT VERIFIED**). Each sentence is a data block with character offsets and an entity table `{handle, canonicalName}` from M3 (resolved coreference targets).
2. The model returns atoms as piece lists. Code validates: spans inside the sentence and non-overlapping in order; entity handles in the table; joins from the closed set. Text is rendered by code: spans concatenated, handles replaced by canonical names.
3. **Cue guard**: negation, modal, hedge and quantifier tokens (closed lists) inside the covered range `[min start, max end]` of an atom but not in its spans reject the atom (`cue_dropped`), because omission, not addition, is how extractive atoms can change meaning.
4. **Coverage**: every number, date and entity of the sentence appears in at least one atom; uncovered ones are recorded as `coverage_gap` and the sentence is kept as an additional sentence-level claim so metrics are not decomposer-dependent (spec 9 L1 and `prior-art/04` section 9.2 step 7).
5. Dedupe by normalised text, then lexical similarity above a threshold tuned on the gold set. Relevance unknown is kept and reported.
6. Compartment Q-ro; no tools. Input text may be counterparty-authored or model-written (a rationale being checked, an MCP `explain_claim` argument), so output trust follows input trust.

**Tests and acceptance.** `T14.C7.no-new-words` (property: for any valid output the rendered atom's tokens are a subsequence of the sentence tokens plus entity names); `T14.C7.cue-dropped` ("is not valid until 2027" must not yield an atom "is valid until 2027"); `T14.C7.coverage`; `T14.C7.fallback-labelled` (sentence fallback never enters LLM-grade metrics); metrics: drift rate, coverage against gold atomic claims, claims per sentence versus human counts (SAFE reports about 0.8 correlation, `prior-art/04` section 1.3), and downstream L2 label agreement. Disproof: extractive recall of gold atoms materially below generative with equal drift after the cue guard, then default flips and the README says why.

**Risks.** Implicit-subject and cross-sentence claims lose recall in the extractive arm; coordinated facts need span reuse. The shared `Claim` now has the `pieces` field (Spec feedback 6); the shared `decomposer` union has no value for the rule-brain clause splitter (see the revision block).

**Build notes.** Rule-brain clause splitter first, then the model arm, then the generative control.

---

## C8. Verification roles: L2 judge, advocate, skeptic, arbiter, compute allocation

**Best references.** `prior-art/04` sections 9.3 and 9.4 and 1 to 6 (SAFE, FActScore, ALCE, Self-RAG, ragas, `llm_multiagent_debate`); `prior-art/12` sections 3.5, 4 and 8: Choi et al. (debate is a martingale; voting accounts for most gains), PoLL (Verga et al.), Panickssery et al. (self-preference), Large Language Monkeys (more samples help only with a verifier), Khan et al. (debate helps with weaker judges); `llm_multiagent_debate/gsm/gen_gsm.py` `construct_message` (peers shown each other's full text; no licence file in the clone, **study only**; GitHub reports no licence either); Snell et al. (difficulty-adaptive compute); `prior-art/12` section 13.3 contribution 1.

**What they actually do.** The reference debate shows every agent the other agents' complete answers and asks for an updated answer; rounds are a constant, there is no stopping rule and no evidence (`prior-art/04` section 6.2 to 6.3). SAFE's search loop runs five steps with no early exit and discards result URLs. PoLL pools several smaller judges. Choi et al. show debate does not raise expected correctness beyond voting.

**Decision.** Own the roles and the aggregation; adapt "independent searchers plus verified quotes" from SAFE; reject free debate rounds as default (an ablation arm only). M4 owns the pipeline, labels and L0; this module owns the roles' contracts and the budget allocator.

**Implementation design.**

```ts
interface EntailmentVerdict { label: "entailed"|"partial"|"neutral"|"contradicted"; decidingSpanIds: Id<"sp">[]; missingPieces: number[] }
interface BriefEntry { piece: number | "whole"; stance: "supports"|"contradicts"|"missing_element"; spanId: Id<"sp"> }
type Brief = { side: "advocate"|"skeptic"; entries: BriefEntry[]; stepsUsed: number }
```
- **L2 judge**: two differently worded prompts (dual prompt), both orders of evidence, temperature 0, T1. Output carries the deciding spans, re-checked by L0 (M4); `entailed`/`partial` without a verifying span becomes `unverified_rationale`. Disagreement escalates to T2/T3 and then to the advocate/skeptic pair. Labels from the rule brain are `lexical` grade.
- **Advocate and skeptic**: identical prompt template except one `objective` slot; identical tools (`corpus.search(query)` BM25 over the frozen span index, `corpus.read(spanId)`), identical budget (at most 3 tool steps, early stop when every claim piece has a verified supporting or contradicting span, SAFE's "one new query that adds information not in KNOWLEDGE" instruction as the step prompt). The protocol is **our JSON action protocol**, validated by our schema (`{act:"search",query}` | `{act:"read",spanId}` | `{act:"submit",entries}`), not native function calling, so any `ModelPort` works and cassettes stay uniform. Queries are free text into a local index (no egress, no state change, length-capped, logged). A brief has no free text: stance enum, piece index and span reference. Span references in tool actions, briefs and verdicts are per-prompt aliases from `renderForModel` (INT-005), mapped to `sp_` ids by code; an unmapped alias is `span_unknown`. L0 strikes entries with unknown spans or spans outside the per-case corpus scope. The two searchers run independently and in parallel (**no cross-reading round by default**; a correction-biased second round is ablation arm A7b).
- **Arbiter layer 1 (code)**: given verified briefs and authority tiers, dates and origins, settle: verified contradicting span from an equal or higher authority tier than the cited support and no verified advocate counter gives `contradicted`; verified support, no verified skeptic entry, and judges agreeing gives `entailed`; opposing verified spans from independent origins of equal tier gives `contested`; otherwise residue.
- **Arbiter panel (residue)**: three profiles, different families in the evaluation profile (three size variants labelled "same family" in the sponsor profile), each returning an `EntailmentVerdict` over the verified spans only, with the deciding span. **Aggregation is asymmetric** (restrict-only): a permissive label (`entailed`) requires all three to agree and the deciding span to pass L0; a restrictive label (`contradicted`, `neutral`, `partial`) needs one member with an L0-verified deciding span to downgrade the claim at least to `contested`; any other split is `contested`. A split is never resolved by majority vote.
- **Compute allocation** (`allocate`): M4's exact sensitivity map assigns each claim `{relevant, minFlipSize}`. Inert claims get L0 plus the lexical gate plus at most T1 dual-prompt; relevant claims get the full ladder; when the verification budget cannot cover all relevant claims they are ordered by ascending `minFlipSize` (a claim whose removal alone flips the verdict first). Claims left unverified are reported `not_checked` with the budget reason, never silently dropped. The novelty claim of `prior-art/12` section 13.3 (1) is **NOT VERIFIED** beyond that reading.

**Tests and acceptance.**
- `T14.C8.symmetry`: swapping the objective slot and the tool order leaves token budgets and the prompt skeleton identical (hash of the template with the slot masked).
- `T14.C8.struck-spans`: a scripted skeptic citing a span from another case is struck and the arbiter sees `struck: 1`.
- `T14.C8.panel-asymmetry`: scripted panels give (3 permissive with an L0-verified deciding span) `entailed`; (2 permissive and 1 restrictive with a verified span) `contested`; (2 permissive and 1 restrictive whose span fails L0) `contested` with `unverified_dissent` recorded for the reviewer, because a permissive label needs unanimity and an unverified dissent must be visible rather than discarded; (3 restrictive, one verified) a restrictive label.
- `T14.C8.early-stop` and `T14.C8.step-cap`: bounds hold; `T14.C8.no-vote`: no code path tallies a majority.
- Metrics: contradiction-detection recall and false-contradiction rate (`prior-art/04` section 10.5), unsupported-claim rate, harmful-flip rate (verdicts turned from correct to wrong), judge over-commit rate, billed tokens per resolved relevant claim.
- Baselines and controls: C18 H2 arms (single call with both objectives, k-vote at equal tokens, L2 only, homogeneous versus heterogeneous).
- Disproof: matched-token controls equal or beat the pair within the pre-registered margin, then advocate and skeptic merge into one call and the README names it.

**Risks.** Single-family sponsor runs weaken the self-preference defence (spec RUN-02); results there are labelled. Only two Nemotron sizes appeared on the model cards read, so a three-member sponsor panel may have to repeat one model with different prompt variants, which is weaker independence and is labelled `same_family`, `same_model` in the trace. The BM25 index and its tokeniser are M4's; recall of the search tool bounds the roles' value.

**Build notes.** L2 judge and allocator first; briefs next; the panel last. Unblocks H2.

---

## C9. Policy judge

**Best references.** Spec section 10 and review SEC-07 (the rule engine's recommended action is a ceiling); `prior-art/05` section 10.2 (judgement confined to the allowed set, validator rejects instead of repairing); `prior-art/10` D.4 (model outputs restrict-only); TradingAgents `agents/managers/portfolio_manager.py` (one prompt over research plan, trader proposal, debate history, free interpolation of `{history}`; typed `PortfolioDecision` via `with_structured_output`, fallback to free text and heuristic `parse_rating`) and `agents/rating.py` (`REVIEW` sentinel instead of `Hold` for unparseable ratings), `research/track-3-reasoning-architecture/unified-all-three-tracks/TradingAgents/tradingagents`, Apache-2.0; FinRobot `judge_agent.md` ("must always place a definite directional bet", never abstain).

**What they actually do.** TradingAgents' final decision can come from a free-text retry whose rating is recovered by regex; its own comment says a rating read back from prose could be replaced by one the thesis quotes. There is no check that the final rating respects the trader's limits (`prior-art/06` section 2.5: the veto is prompt-level only). FinRobot's judge is forbidden to abstain, which is the opposite of what a release decision needs.

**Decision.** Own the role; the boundary types and the ceiling rule are M5's and M6's (INT-027, INT-028). With recommended action `r` and allowed set `A`, a selection `s ⪯ r` is accepted autonomously (it confirms or restricts), `s ≻ r` with `s ∈ A` is a `judge_loosening` approval item and nothing executes on the model's say-so, and `s ∉ A` is rejected. There is no floor. The judge is validated rather than parsed and never reads prose.

**Implementation design.**

No judge type is defined here. Input is M5's `JudgeInput` (short handles `F1..Fn` for fields, actions, fired rules, gaps; claim ids and labels without claim text; typed reflexion codes; M6's `PrecedentRetrieval` as delimited data), output is M5's `JudgeOutput {selection, cites, dispositions, note?}` over handles, so a fabricated id is inexpressible and handles are mandatory in model prompts. Counter-precedent dispositions use M6's one vocabulary: `rule_changed | fact_differs:<featureKey> | outcome_unverified | tainted`. The optional `note` is not requested.
1. **Skip**: let `L = {a ∈ A : a ⪯ r}`. If `|L| = 1`, return it with `judge_skipped: single_allowed_action` and no model call. Precedent retrieval still runs (one M6 call, no model tokens), because the autonomy gate needs it.
2. View: only typed values; entity handles, no names, no claim text, no `UntrustedText`; restricted fields as placeholders. The view's data class is the join of its labels, and the prompt is an egress sink capped by the model profile (C15), so the hosted profile is usually cleared.
3. Validators, in M5's order (`validateJudge`, JV1 to JV11, first failure wins, never repaired): schema and size; `selection` is the handle of a member of `A`; cited rule handles map to rules that fired; cited precedent handles map to retrieved precedents; every counter in `obligations.mustAddress` is cited or dismissed, with each dismissal mechanically checked by M6's `validateJudgement` (JV7, JV8); a selection other than `r` cites at least one rule or precedent. This module adds only the pack reason-code vocabulary check.
4. **Outcome** (the ceiling rule, with the permissiveness order `release ≻ release_with_approval ≻ escalate ≻ hold ≻ reject` read from the policy IR, where it is data and a tested total order; `escalate` against `hold` is answered by that order): `s ⪯ r` is accepted; `s ≻ r` returns `Loosening` and M5 creates the `judge_loosening` item, executed only by a human decision bound to the verdict hash, while the effective action stays `r`.
5. Tiers: T2 first; T3 (a different family where available) only when the first answer fails validators. Any failure at the end of the ladder returns `r` unchanged with `stop: "failed_closed"`, which is the judge-off arm and cannot loosen.
6. Output trust at most `EXTRACTED`. The reporter renders reasons from cited rules, reason codes and ledger facts, so `why_kind` is `computed` for the rule parts and `model_reported` only for the selection itself.

**Tests and acceptance.** `T14.C9.loosening-is-item` (scripted model selects `s ≻ r` with `s ∈ A`: a `judge_loosening` item is raised, the effective action stays `r`, a trace line is written; `s ∉ A` is rejected); `T14.C9.confirm-is-autonomous` (selecting `r` raises no item; the case M5 SF1 raises); `T14.C9.skip` (`|L| = 1`: no model call recorded, precedent retrieval recorded); `T14.C9.counter-precedent-required`; `T14.C9.order-is-data` (the order is read from the IR, including the `escalate` and `hold` pair); `T14.C9.no-prose` (view contains no string outside enums and handles, checked against the schema); `T14.C9.injection-twin` (a precedent record carrying hostile text cannot reach the view because precedent summaries are typed); `T14.C9.mutation` (gate-integrity mutants: remove the ceiling classification, the suite fails; M5/M8 inert-stub rule). Metrics: share of cases needing the judge; decision accuracy with rules only, plus precedent, plus judge (the M5 ladder); loosening-item rate caused by judge selections; loosening-attempt rate per model. Disproof: selections below `r` do not improve accuracy or reviewer workload over `r` (judge off) on the gold set; then the role is removed and the system reports `r` with precedent annotations.

**Risks.** Whether any model beats the judge-off arm on this task is unknown. If the judge rarely selects below `r`, it is a confirmation step and the ablation will say so.

**Build notes.** After M5's allowed-set interface and M6's `PrecedentRetrieval` and `validateJudgement` exist as fixtures.

---

## C10. Critics and reflexion

**Best references.** Reflexion (`research/track-3-reasoning-architecture/reflexion`, MIT; `prior-art/05` section 8: reflection is LLM-written, last three kept, loops gated by an oracle); organizer pairing 2, proposer plus critic with a 0 to 3 rubric on accuracy, appropriateness and actionability, pass at 7 of 9, exactly one fix, one revision (`docs/design/agent-pairings.md`); Huang et al. 2023 (self-correction without external feedback degrades), Panickssery et al. 2024, Kambhampati et al. 2024 LLM-Modulo (external verifiers in a tight loop), MAS-ProVe (judging trajectories is noisy) (`prior-art/12` section 4); FinRobot validators and rollback (`runner.py` lines 797-880).

**What they actually do.** Reflexion writes a natural-language plan after a failed trial and feeds the last three reflections to the next attempt; the stop signal is an environment oracle in two of three settings. Reflections are model text, so a wrong or poisoned reflection persists for its window. FinRobot re-prompts with the validator's error up to three times and rolls back derived keys on rejection.

**Decision.** Adapt Reflexion's bounded loop; own the trigger and the content. Reflections are **written by code from the failed check**, never by a model.

**Implementation design.**
- **Hard critic** is the ordered validator list of the role plus cross-role invariants: schema, ids exist, `allowed` membership, ceiling classification (a `s ≻ r` selection is routed to the loosening item, not accepted), rule ids real, counter-precedent handled, numeric and date consistency against the ledger, paraphrase map (C11). Output `Finding[]` with severity `info | review | blocked` and the same `RoleFailure` codes.
- **Reflexion state machine** (per case, per role invocation):
  1. Attempt 0 runs; the hard critic returns `blocked` findings → reflexion triggers (deterministic failure), or a human rejects a proposal at AL1/AL2 → trigger (`reason: human_rejection`, with an enum reason code only). A structured human decision is a `rule` reason with `ruleId "human.approval.<code>"` bound to the signed approval record; free text from the person is `human_reported`, never enters a view and never reaches a reflection (INT-002).
  2. `reflection = { failedCheck: validatorId, code, field, allowedValues? }` rendered by code; at most the last three reflections for the case are kept in the view (case-scoped, TTL), as typed data. The reflection may change how the judge uses the facts; it never changes rule results, the allowed set or facts.
  3. Attempt k+1 runs at the next tier when the previous failure was `schema_invalid` or `allowed_set_violation` (cascade), else the same tier; at most 2 retries (3 attempts); charged to the budget; then `escalate` with the full trail to the approval queue (spec section 10).
- **Soft critic**: a different family from the judge where available (labelled otherwise), T2, rubric `{accuracy, appropriateness, actionability}` each 0 to 3, `fixCode` from an enum (`CITE_COUNTER_PRECEDENT`, `STATE_GAP`, `RESTRICT_SELECTION`, `NAME_RULE_CONFLICT`, `NO_FIX`). It reads the deterministic dossier rendering (Q-ro, data blocks). Total below 7 of 9 triggers **one advisory revision** of the judge with `fixCode` in its view, then the hard critic re-validates the result. The soft critic is never the sole trigger of *reflexion*; the advisory revision is the separate organizer pairing and is subject to the same ceiling rule as any judge output: it can confirm or restrict, and a loosening is an approval item, never an effect (spec sections 10 and 21 are reconciled this way, Spec feedback 3). Rule-brain rubric: C16.
- Three-sample rubric scoring is used in evaluation (worst of three reported separately from medians).

**Tests and acceptance.** `T14.C10.reflection-is-code` (no model call produces reflection text; grep and trace check); `T14.C10.retry-cap` (third failure escalates with a complete trail); `T14.C10.reflection-cannot-change-allowed-set` (property over scripted sequences); `T14.C10.weak-draft-forces-fix` (organizer requirement: a deliberately weak judge output, missing counter-precedent handling and no gaps, triggers the hard critic path and, on a second fixture, the soft critic fix); `T14.C10.soft-critic-advisory` (a soft critic failing or absent never changes the outcome; scripted garbage rubric is ignored with a trace line); `T14.C10.human-rejection`. Metrics: retry success rate per failure code; escalation rate; soft-critic revision outcome-change rate; harm rate (revisions making a correct selection wrong), with the Huang-style expectation of no gain from the soft critic alone, reported either way. Disproof: soft-critic revision harm rate above its gain; then the soft critic is removed.

**Risks.** The `fixCode` vocabulary is small by design and may be too coarse to help. Rubric scores from a model are uncalibrated.

**Build notes.** Hard critic and reflexion first (pure code); soft critic after the judge exists.

---

## C11. Reporter and paraphrase verifier

**Best references.** gpt-researcher writer abstain guard (`gpt_researcher/skills/writer.py` lines 79-88, `prior-art/03` section 1.4); WikiChat citation renumbering and dropping uncited sentences (`prior-art/03` section 6); FinRobot "model cites ids, renderer fills values" prompts, enforced only at prompt level in the checkout read (`prior-art/06` section 3.5); FinRobot's persist-boundary contract with value-withhold semantics (`engine/artifact/contract.py`); spec principle 1 and section 9 (claims form a typed ledger and prose is rendered from it).

**What they actually do.** The research agents let the writer choose which URL to attach to which sentence, unchecked (`prior-art/03` failure mode 1). FinRobot's prompts say the model may not write numbers, but the enforcing layer was not found in code.

**Decision.** Own. The canonical dossier text is always the deterministic rendering; paraphrase is an optional reading view with per-sentence receipts and is disabled if its unsupported-sentence rate exceeds the margin.

**Implementation design.**
1. **Renderer** (code, pure): sentence templates keyed by (claim kind, label, rule id, gap code), parameterised only by typed ledger values; every sentence carries `claimIds` and `factIds`; numbers, dates and quotes come from the ledger and spans, never from a model. Section order and wording are versioned artefacts in the prompt store hash regime (C12). Counterparty-facing views reduce to reason codes (M9 tiers).
2. **Paraphrase** (optional, T1, Q-ro): per sentence, input is the rendered sentence plus its claim records as data; output `{sentence: string, claimIds: Id<"cl">[]}`. This is the one free-text output of the module, so it is verified before use.
3. **Verifier** (code), all must pass: (a) `claimIds` equal the source sentence's `claimIds` (no additions, none dropped); (b) the multiset of normalised numbers, dates, identifiers, entity handles and quoted strings equals the source's; (c) no certainty or hedge word class change: tokens from closed lists (`confirmed`, `verified`, `no evidence`, `may`, `unresolved`, ...) may not be introduced and the label-implied class must be preserved; (d) negation parity equal; (e) length within 0.5 to 1.5 of the source; (f) optional bidirectional entailment by an L2 judge of another family for hold-relevant sentences. Any failure falls back to the deterministic sentence for that sentence and writes `paraphrase.verdict` with the code.
4. The bundle stores the deterministic text as canonical and the paraphrase as a view with its verifier receipts; the dossier states which mode produced the text it shows (spec section 15).
5. Abstain-per-claim: a claim with no verified evidence renders as "not established" with its gap code, never as an omitted sentence.

**Tests and acceptance.** `T14.C11.every-sentence-has-claim-id`; `T14.C11.no-number-from-model` (planted digit-changing paraphrases rejected); `T14.C11.hedge-flip` ("partially supported" turned into "confirmed"); `T14.C11.negation`; `T14.C11.fallback-per-sentence`; `T14.C11.render-determinism`. Metrics: unsupported-sentence rate of paraphrase mode (target zero, bound reported), rejection rate, deterministic-text readability reviewed by the domain reviewer (open item). Baseline: deterministic text alone. Disproof: unsupported-sentence rate non-zero beyond the margin, then paraphrase is switched off (spec section 15 gate) and the README says it was built and removed.

**Risks.** Closed-list checks catch known failure classes only; paraphrase adds a surface for sentences that read well and drift. The value of paraphrase over good templates may be nil.

**Build notes.** Renderer first, with the dossier schema agreed with M9/M10; paraphrase last.

---

## C12. Prompt system

**Best references.** Spotlighting and per-run random delimiters (`prior-art/10` A8, `SEC-I12`); STORM's `dspy.Signature` classes (typed input and output fields, instruction in the docstring; `knowledge_curation.py` lines 128-180; DSPy `stanfordnlp/dspy`, MIT, 38,611 stars, last push 2026-10-13; its optimisers were not read and offline prompt search is excluded from production by `prior-art/12` section 7); FActScore `best_demos` BM25 demonstration retrieval (`prior-art/04` section 2.2); Wang et al. 2024 (a strong prompt with demonstrations matches multi-agent discussion; so every arm gets the same demonstrations, `prior-art/12` section 3.5); OpenAI Agents SDK `handoffs` `input_filter` (view as a function of state; `handoffs/__init__.py` line 158); TradingAgents prompts interpolate debate history into the instruction text with plain f-strings (`portfolio_manager.py`), the pattern to avoid.

**What they actually do.** STORM and TradingAgents build prompts by string interpolation of whatever the previous stage produced, so the instruction and the data share a channel. DSPy separates a typed signature from the optimiser that rewrites its prompt. None hash-pins prompts or tests prompt construction against hostile data.

**Decision.** Own: a slot-only template language, a block model that keeps instructions and data in separate positions, a hash lock, and tests. No Mustache or Jinja dependency; fewer features means fewer injection paths.

**Implementation design.**
1. **Artefact**: `src/agents/prompts/<group>.<role>.<variant>.md` has a JSON header (`id`, `role`, `variant`, `inputSchema`, `outputSchema`, `slots: {name, type: "trusted_enum"|"trusted_number"|"trusted_id"|"data_block", maxLen}`, `fewShotSet`, `compat: {tiers, dialects}`) and two bodies, `system` and `user`. `prompts.lock.json` maps `id@variant` to `promptHash = sha256(JCS({header, system, user, fewShotSetHash, outputSchemaHash}))`. At load the lock is verified and a mismatch fails closed (`prompt_hash_mismatch`); CI fails on drift. The trace records the hash (C20).
2. **Template language**: only `{{slot}}` tags. `trusted_*` slots are JSON-encoded scalars from enumerations, numbers or ids and may appear anywhere in the template. `data_block` slots may appear **only** inside the `DATA` section; the linter rejects a template placing one in an instruction position and rejects any logic, loops, partials or raw output. Lists are rendered by the block builder, not by template loops.
3. **Block model** (`buildMessages(prompt, slots, rng)`): system message = instructions (template text only, no data slot) + output contract (the JSON Schema) + a fixed statement of the data convention. User message = ordered sections: `TASK` (trusted slots), `DATA` blocks, `OUTPUT`. Each data block is wrapped as `<<DATA id=b3 nonce=N>>` ... `<<END nonce=N>>` where `N` is 128 random bits from `ctx.rng` seeded by `(runId, role, blockIndex)` (replay-stable; the same nonce keys the span aliases `⟦nonce:S12⟧` that M2's `renderForModel` writes into the block, and the alias map is stored in the cassette, INT-005), every data line is prefixed with a datamark character, and a data string containing the nonce or the marker prefix at line start is escaped. The fixed statement says the block is untrusted data and never instructions. This lowers the probability of obeying injected text and is **never** counted as the control; the controls are the output schemas, C1 compartments and the gates (spec section 5).
4. **Few-shot management**: example sets are separate artefacts `src/agents/fewshot/<role>.<set>.jsonl`, hash-pinned, each example `{input, output, provenance: "generator:<seed>" | "authored", split: "dev"}`. CI asserts no example's content hash occurs in the gold or held-out split and that the generator seed ranges differ. Selection is deterministic: a fixed set, or lexical (BM25, stable tie-break by example id) retrieval over the pinned set only. Every ablation arm gets the same demonstrations (Wang et al.). Real documents are not used as demonstrations unless their rights are cleared (spec section 6 rights gate).
5. **Data-class redaction** happens before rendering (C15): restricted values become stable placeholders and the redaction record is part of the view hash.
6. **Prompt tests** (see below) run on every change; a prompt change re-records the affected cassettes, which is expected and visible in the diff.

**Tests and acceptance.**
- `T14.C12.lint`: slot positions, no logic, every declared slot used, schema ids exist.
- `T14.C12.render-golden`: fixture rendering snapshots with hash.
- `T14.C12.forged-delimiter`: for every `data_block` slot, hostile strings (a forged closing tag with a wrong nonce and with the right nonce, "SYSTEM:" role markers, Unicode confusables of the delimiter, 1 MB strings, NUL bytes, bidi controls) render with the data strictly inside its block and the nonce occurring exactly twice per block in the message.
- `T14.C12.trusted-slot-types`: a trusted slot given a free string is rejected at build time.
- `T14.C12.lock-drift`: modifying one character fails the lock test.
- `T14.C12.fewshot-leak`: planted overlap with a gold item fails CI.
- `T14.C12.behaviour`: per-role gold items through the rule brain and recorded cassettes with assertion files (schema-valid rate, field accuracy); a reproducer-tier cross-check may use promptfoo (`promptfoo/promptfoo`, MIT, 25,964 stars, last push 2026-10-13) or Inspect AI (`UKGovernmentBEIS/inspect_ai`, MIT, 2,993 stars, last push 2026-10-13); neither tool's behaviour was read here and neither is on the judge path.
- Disproof: any hostile string that escapes its block in the forged-delimiter test.

**Risks.** Random nonces defeat blind forgery only; an adversary who sees past prompts (cassettes are committed) could learn the format but not the nonce of a new run, since the nonce derives from the run id. A fixed `runId` in committed cassettes means a replayed nonce is public; it is irrelevant on replay (no new model call).

**Build notes.** Builder, linter and lock before any role prompt is written; few-shot sets after the generator exists (build-order step 11).

---

## C13. ModelPort and adapters

**Best references.**
- OpenAI Agents SDK model layer and `testing/model.py` scripted model (`research/track-3-reasoning-architecture/unified-all-three-tracks/openai-agents-python/src/agents/`, MIT): a `Model` interface with retry settings (`retry.py`) and typed exceptions (`exceptions.py`: `ModelBehaviorError`, `ModelRefusalError`, `ModelTimeoutError`); a scripted model for deterministic tests.
- AutoGen's chat-completion cache keyed by SHA-256 of the serialised request (`autogen_ext/models/cache/_chat_completion_cache.py`; a crude cassette; `prior-art/06` section 6.3).
- NVIDIA hosted API reference page (fetched 2026-10-13, read through a page summary, **not exercised**): OpenAI-compatible `POST /v1/chat/completions` at `https://integrate.api.nvidia.com`, bearer authentication, and a catalog of more than 50 models across several providers (NVIDIA Nemotron, Meta, Mistral, DeepSeek, Qwen, Google, Microsoft). **NOT VERIFIED:** the multi-family catalog scope, the availability of any given id for our key, and the OpenAI-compatible claim beyond the base URL and path (INT-062 i); nothing below relies on them until the doctor has run. Its Downloadable NIM reference says the API is vLLM-backed and defers parameter details to vLLM's OpenAI-compatible server documentation.
- vLLM structured-output documentation (page dated 2026-05-19 in the fetch): `response_format` with `json_schema`, and `structured_outputs` in `extra_body` with `choice`, `regex`, `json`, `grammar`, `structural_tag`; backends xgrammar, guidance, outlines; for reasoning models the reasoning goes to a separate `reasoning` field (`vllm-project/vllm`, Apache-2.0, 93,723 stars, last push 2026-10-13).
- Model cards (fetched 2026-10-13 through page summaries): NVIDIA-Nemotron-Nano-9B-v2 (9B, NVIDIA Open Model License, 128K context, reasoning toggled by `/think` and `/no_think` in the system prompt, reasoning on recommended temperature 0.6 and top-p 0.95, off: greedy; available on the NVIDIA catalog from 2025-08-18) and Llama-3.3-Nemotron-Super-49B-v1.5 (49B, NVIDIA Open Model License plus Meta's Llama 3.3 licence, 131,072 tokens, reasoning on by default, `/no_think` in the system prompt to disable, same sampling advice; catalog release 2025-07-25).
- Meterless Scout `docs/model-routing.md` (Apache-2.0): profile fields `{id, provider, model, context, cost, latency, capabilities, dataClasses, fallbacks}`; no router implementation was found in this clone (no `src/` directory in `engines/scout-intent`), only the document and an example that calls a `@meterless/scout` package (`examples/model-profile-routing/index.ts`).
- Thinking Machines, "Defeating Nondeterminism in LLM Inference" (He, 2025-09-10): temperature-0 inference endpoints are nondeterministic mainly because kernels are not batch invariant and server load varies batch size.

**What they actually do.** The SDK and AutoGen both separate "the model call" from agent logic and give a fake model for tests; AutoGen's cache is keyed by request but not bound to a trace or a miss-is-error mode. The NVIDIA hosted endpoint is described as OpenAI-compatible; the parameter list for structured output on the hosted route is not in what was fetched. The Thinking Machines result means no live endpoint call is a deterministic function of its request, which is why the spec's replay is defined over cassettes.

**Decision.** Own the port and adapters. One OpenAI-compatible adapter with **dialects** covers NVIDIA hosted, a local server (vLLM or similar) and any other compatible endpoint; the NVIDIA adapter is a configuration of it plus probed capabilities, not a separate code path, so what the sponsor proof run exercises is the same code the evaluation profile uses. Provider SDKs are not adopted (fewer dependencies, uniform cassettes, request canonicalisation under our control).

**Implementation design.**

```ts
interface ModelDescriptor { id: ModelId; family: string; sizeClass: "small"|"mid"|"large"; name: string; context: number; price?: { inPerMTok: number; outPerMTok: number }; clearedFor: Confidentiality[]; personalOk: boolean; caps: { constrained: ConstrainedMode[]; reasoningToggle: ReasoningToggle; reasoningField?: string; reasoningCapTokens: number; seed: boolean; logprobs: boolean } }
// M7 declares `ModelPort` and its `capabilities` (`structuredOutput`, `reasoningCapTokens`) and `canonicalRequest` (register 2.2); this module owns the descriptors and the adapters.
interface ModelRequest { role: RoleId; profile: ProfileId; messages: Message[]; schema?: { id: SchemaId; json: Json }; sampling: Sampling; sampleIndex: number; timeoutMs: number; reservation: ReservationId }
interface ModelResponse { text: string; reasoning?: { hash: Hash; tokens?: number }; finish: "stop"|"length"|"filter"|"other"; usage: { in: number; out: number; reasoning?: number; estimated: boolean }; served: { model: string; fingerprint?: string }; rawHash: Hash }
interface ModelPort { describe(): ModelDescriptor; complete(r: ModelRequest): Promise<Result<ModelResponse, ModelError>> }
```
1. `canonicalRequest(r)` is pure and is M7's `normalise(call.req)` for `ModelPort` (INT-042): model id, messages, schema hash, sampling, sample index; credentials and transport headers are excluded. Cassettes are keyed by effect slot with request-hash verification, not by this hash alone.
2. **`OpenAICompatPort(dialect)`**: non-streaming; every HTTP call goes through `ctx.net` (M8 `ports/egress.ts`, the only module that calls `fetch`; INT-020). Each profile has one egress-manifest entry in M8's schema with `modelProfile` (`sponsor | evaluation | local`), `hosts` and `maxConf` equal to the highest class in the descriptor's `clearedFor`; prompts are an egress sink capped by that entry (INT-021), and redirects are off. `modelProfile` is a different axis from M1's `disclosureProfile` (`public_lookup | identifier_only | offline`). `AbortSignal` timeouts; response size cap; credentials from environment variables whose names are ours (for example `PLUMBLINE_MODEL_KEY_<PROFILE>`; NVIDIA's own variable name is not asserted) and never in a request object; redacted in traces and cassettes (headers and pre-signed query parameters). Dialect fields: `structuredMode: "json_schema" | "extra_body_structured_outputs" | "tool_call_schema" | "prompt_only"`, `reasoningToggle: "system:/no_think" | "param" | "none"`, `reasoningField: "reasoning" | "reasoning_content" | "inline_think_tag" | "none"`, `maxTokensParam`, `seedParam`. Which values hold for the NVIDIA hosted route is **NOT VERIFIED** and is decided by the inventory doctor, not by assumption.
3. **Error mapping** by HTTP status and typed codes, not message substrings (the FinRobot weakness): 408, 429 (with `Retry-After`), 5xx, network reset and timeout are `transient`; 400 with a schema or context-length message is `validation`/`fatal` per code table; 401 and 403 are `fatal` (credential); content filter or refusal is `policy`; unknown model id is `fatal` with a doctor hint.
4. **`ScriptedPort`**: responses keyed by `(role, promptHash, inputHash, sampleIndex)`; an unscripted request fails the test (no default); fault injectors for every fault of C19; records every request for assertions.
5. **`SchemaFuzzPort`**: returns any schema-valid output, exhaustively for small enums and sampled with a seeded generator otherwise; this is the adversary-controlled model port that M8's `SEC-P5` and the monotonicity tests use.
6. **`LocalStubServer`** (test-only HTTP server implementing the OpenAI-compatible wire format with scripted behaviours: truncation, slow response, 429 with `Retry-After`, malformed JSON, reasoning wrappers, extra fields). It exercises the real adapter over real HTTP without credentials, so the code path is complete before a key exists.
7. **Inventory doctor** (`plumbline doctor models`, uses a key if present): lists models if the route supports it; for each configured profile runs probes with their counts printed: constrained-decoding canary (20 requests, parse-valid rate), reasoning toggle canary, determinism canary (10 identical requests at temperature 0, count distinct outputs), context-limit canary, rate-limit headers, and writes `eval/reports/model-inventory.<date>.json`. Without a key it reports `BLOCKED: key needed` and the stub-server results. The profile capabilities in use are the probed ones.
8. The rule brain is not a `ModelPort` (C16): it implements role interfaces directly and never appears in the model effect log.

**Tests and acceptance.** `T14.C13.canonical-stable` (request canonical form golden); `T14.C13.error-classes` (HTTP table against the stub server); `T14.C13.no-secret-in-trace` (canary key never appears in traces, cassettes, error messages; with a negative control that fails when redaction is off); `T14.C13.timeout-and-size-caps`; `T14.C13.stub-contract` (the adapter passes the same suite against the stub for each dialect); `T14.C13.scripted-strict`; `T14.C13.schema-fuzz-covers` (enumerated coverage for small schemas); `T14.C13.net-via-egress` (no network import or `fetch` in `src/models` outside the `ctx.net` call; a prompt above the entry's `maxConf` is refused before sending). Metrics: transient error rate, p95 latency, determinism canary distinct-output count per profile. Disproof: an adapter behaviour that differs between stub and live in the doctor results (then the stub is not a faithful model of the endpoint).

**Risks and NOT VERIFIED.** The NVIDIA hosted route: exact model ids, whether `/v1/models` lists, structured-output parameters, `seed` support, reasoning field name, quotas and credits, pricing, retention of prompts. Whether NVIDIA's Nemotron models are available for every tier. The model-card facts above come from fetched page summaries, not from the full cards.

**Build notes.** Port types, canonical request, scripted and stub first (build-order step 11c, before step 12; register V10); the OpenAI-compatible adapter against the stub; the doctor last (needs a key to be informative). Unblocks bake-off 7.

---

## C14. Structured output and sampling

**Best references.** Tam et al., "Let Me Speak Freely?" (arXiv 2408.02442: format restrictions reduce reasoning performance; whether this persists on current models is **UNVERIFIED**, `prior-art/12` section 11); JSONSchemaBench (arXiv 2501.10868: six constrained-decoding frameworks on 10,000 schemas; abstract-level); XGrammar (`mlc-ai/xgrammar`, Apache-2.0, 1,957 stars, last push 2026-10-13), llguidance (`guidance-ai/llguidance`, MIT, 888 stars, last push 2026-10-12), Outlines (`dottxt-ai/outlines`, Apache-2.0, 15,922 stars, last push 2026-09-21): metadata verified, internals not read; OpenAI Agents SDK `strict_schema.py` and `agent_output.py` (`ensure_strict_json_schema`: closes objects with `additionalProperties: false`, requires all properties, forbids `anyOf` at the root, bounds `$ref` expansion at 100,000 nodes and depth 100; `validate_json` raises `ModelBehaviorError`, MIT); TradingAgents `agents/structured.py` (`invoke_structured` returns `None` on any failure and the caller retries as free text, then recovers the rating by regex); gpt-researcher `json_repair` use (`agent_creator.py` line 60); vLLM structured-output page (above); model cards (above); Thinking Machines (above).

**What they actually do.** TradingAgents and gpt-researcher both convert a structured-output failure into a more permissive parse of free text (a retry, then `json_repair` or a regex). That is the "repair" behaviour the spec forbids: it turns a failed contract into a plausible value. The Agents SDK's strict schema transform is the closest to our need: it makes schemas machine-checkable and refuses open objects. The constrained-decoding frameworks restrict tokens at decode time; the vLLM page says reasoning models route reasoning to a separate field and that structured outputs may be disabled while reasoning is on for some models.

**Decision.** Own the strategy, built on existing decoders where the endpoint offers them. **Validation by our schemas applies regardless; constrained decoding only reduces rejections** (spec bake-off 7). No `json_repair`, no regex recovery, no free-text fallback.

**Implementation design.**
1. **Schema profile**: every role schema is a root object, closed (`additionalProperties: false`), flat where possible (depth at most 3), arrays with `maxItems`, enums for every categorical field, strings with `maxLength` and, where free text exists (paraphrase, search query), `pattern` or length caps; no `anyOf` at the root. A build-time converter in the style of `ensure_strict_json_schema` validates this profile (own implementation; the SDK's code is read for behaviour, not copied).
2. **Mode selection per profile** from probed capabilities, in order: `json_schema` response format; `extra_body` structured outputs (`json`, `choice` for pure enums such as the matcher choice and judge action); tool-call schema; prompt-only JSON with the schema in the system message and demonstrations. The chosen mode is a request field in the effect key and a trace attribute.
3. **Reasoning handling**: where the endpoint separates reasoning into a field, the adapter drops it from the answer path (hash and token count kept). Where the model inlines a documented wrapper (`<think>` ... `</think>`) the adapter removes **only a single leading wrapper block** and records `reasoning_stripped: true`; any other leading text is a `schema_invalid`. Reasoning text is never fed to another role or stored (it can quote untrusted instructions).
4. **Strict parse**: the whole completion must parse as one JSON value with no trailing text; duplicate keys, NaN, and numbers outside the hashed profile (no floats in hashed documents) are rejected.
5. **Two-pass option** (Tam et al.): for roles where reasoning helps (arbiter panel, policy judge) the arms are `single-pass constrained`, `reasoning on then constrained final`, and `free scratch pass then schema pass`; chosen by measurement on the gold set, default `reasoning on then constrained final` only if the endpoint supports constrained decoding with reasoning on (to be probed), else scratch pass. Pure pointing roles (extractor, matcher, decomposer, L2 judge, paraphrase, discovery) run reasoning off.
6. **Re-ask policy**: at most one re-ask per tier, carrying the typed failure code and the failing field path, never the model's invalid output; then escalate (C1 step 6).
7. **Sampling policy** (starting values, ablated, **not measured**):

| Role | Reasoning | Temperature | Samples per tier | Max output tokens (incl. reasoning cap) |
|---|---|---|---|---|
| Extractor, matcher, decomposer, discovery, paraphrase, L2 judge | off | 0 (greedy) | 1 at T1, 2 at T2 | 512 to 1,024 |
| Plan augmenter | off | 0 | 1 | 512 |
| Advocate, skeptic (per tool step) | off | 0 | 1 | 384 |
| Arbiter panel member | on, capped | 0.6 (model-card advice) | 1 per member | 1,536 |
| Policy judge | on, capped | 0.6 | 1 per tier | 1,536 |
| Soft critic | off | 0 | 3 in evaluation, 1 in product | 384 |

Temperature 0 does not make a live call repeatable (Thinking Machines), so repeatability comes only from cassettes; self-consistency samples carry `sampleIndex` in the effect key; `seed` is sent only where the dialect supports it and is never relied on.

**Tests and acceptance.** `T14.C14.strict-parse` (a table of near-JSON outputs: trailing prose, code fences, comments, single quotes, duplicate keys, truncated at the last brace; all rejected); `T14.C14.reasoning-wrapper` (single leading block stripped; two blocks or text before it rejected); `T14.C14.schema-profile-lint`; `T14.C14.no-repair-grep` (CI grep for repair libraries and regex recovery in `src/agents` and `src/models`); `T14.C14.reask-no-echo` (re-ask prompt never contains the invalid output). Experiments feeding bake-off 7: parse-failure rate and field accuracy for each mode on the gold set with Wilson intervals, per profile; quality loss of constrained versus prompt-only (Tam et al.) per role. Disproof: constrained decoding lowers field accuracy at an interval excluding zero for a role; then that role uses prompt-only JSON with validation.

**Risks and NOT VERIFIED.** Whether the hosted Nemotron route offers any constrained mode, whether it does with reasoning enabled, and the token accounting for reasoning (included in `completion_tokens` or separate). The sampling table is a starting policy.

**Build notes.** Strict parser and schema-profile lint first (pure, testable); modes after the doctor reports capabilities.

---

## C15. Profiles, routing, cascades, retries and accounting

**Best references.** Meterless Scout `docs/model-routing.md` and `model-profiles.json` (Apache-2.0, `research/sponsor-reference/Meterless/engines/scout-intent/`): routing order of compatibility, data class, context, cost, latency, quality; fallbacks must satisfy the same data class; local-first defaults; cost ceilings enforced before execution; the profile that ran is recorded; no implementation exists in the repository. FrugalGPT, AutoMix, RouteLLM, MasRouter, Router-R1, NVIDIA's small-language-model position paper, Snell et al., Kapoor et al. (`prior-art/12` section 6; abstract-level; RouteLLM's last push is 2024-08). Budget design: `prior-art/06` section 9.6 (pre-call reservation, retries charged, finalize reserve). Retry classes: FinRobot `runner.py` lines 47-204 (substring classification, to be replaced by typed classes), TradingAgents `post_screen.system_one` exponential backoff with jitter and `Retry-After` (`prior-art/06` section 2.2), OpenAI Agents SDK `retry.py`.

**What they actually do.** Scout documents a router that picks a profile per task by capability and data class and a fallback chain that cannot weaken the data class. FrugalGPT cascades with a learned stopping scorer; AutoMix uses few-shot self-verification, which prior-art 12 section 4 rejects as a confidence signal. TradingAgents and the Agents SDK delegate retries to SDK settings; AutoGen checks token caps after the message has arrived, so a turn can overshoot.

**Decision.** Adapt Scout's documented routing semantics into our own code; own the cascade (validators and sample agreement as the escalation signal); do not adopt a learned router (RouteLLM-style) now; a router trained on our traces is a later experiment.

**Implementation design.**

```ts
interface ModelProfile extends ModelDescriptor { adapter: "openai-compat"; dialect: DialectId; baseUrl: string; keyEnv: string; fallbacks: ProfileId[]; limits: { rpm?: number; concurrent: number } }
interface ProfileSet { name: "sponsor" | "evaluation" | "local-confidential" | "offline";   // the `modelProfile` in the run header; `local-confidential` is egress-manifest `local`, `offline` has no egress entry tiers: Record<Exclude<Tier,"T0">, ProfileId[]>; panel: ProfileId[]; independence: "family" | "size-only"; brain: "forbidden" | "allowed" | "only" }
```
1. **Profile sets** (spec section 15). `sponsor`: Nemotron only; tiers differ by size class (candidates from the model cards: Nano 9B for T1, Super 49B for T2 and T3, final ids chosen by the inventory doctor); `independence: "size-only"` so the trace labels every checker "same family"; `brain: "forbidden"`; no other adapter substitutes in the sponsor proof run. `evaluation`: multi-family, used for every measured claim. The hosted catalog appears to list several vendors' models, but that is a fetched page summary and the multi-family scope and the availability of any given id are **NOT VERIFIED**; the profile is therefore designed to need a second OpenAI-compatible key (a stated need, D2), and a multi-family catalog on one NVIDIA key is a bonus only the doctor can confirm. `local-confidential`: a local OpenAI-compatible server for classes the hosted profile is not cleared for. `offline`: `brain: "only"`.
2. **Routing is a pure function**: `route(role, dataClass, tier, attempt, budget, set) -> Result<ProfileChoice, RouteError>`. Steps in order: tier members of the set; capability match (constrained mode available, context fits the view and carryover); **data-class clearance** (the profile's `clearedFor` must contain the join of the view's confidentiality labels, and `personalOk` must be true for views with the personal flag; `clearedFor` is the `maxConf` of the profile's egress-manifest entry, so one table serves both, INT-021); family independence for checker roles (producer and checker not the same family when the set allows, otherwise labelled `same_family`); cost ceiling from the remaining reservation; latency target; quality for high-risk roles. Failure is `profile_not_cleared` or `over_budget`, a typed failure that fails closed, never a downgrade of the data class. Fallbacks must satisfy the same clearance and independence rules.
3. **Redaction before routing**: restricted fields (account numbers, tax ids) are replaced by stable placeholders (`bank_account#1`) because comparison happens in the rule engine (the Meterless `risk-check` pattern recorded in `docs/sponsors/meterless-docs-readout.md` item B1); the redaction record (what was masked, never the value) is added to the trace. The data-class vocabularies differ (spec: `public`, `case-visible`, `internal-sensitive`, plus a `personal` flag; Scout: `public`, `internal`, `confidential`, `restricted`): M12 owns `dataClassMap.json` (foreign class to spec class; any foreign class not in the table maps to `internal-sensitive`, the most restrictive), which is a lock-file input (M8 C10); this module uses the spec vocabulary only (Spec feedback 8, INT-009).
4. **Cascade** (per role `tiers`): T0 code; T1 small model with validators; T2 mid with two to three independent samples when T1 fails validation or samples disagree; T3 different-family panel only for verdict-relevant contested claims (C8); human last. Escalation signals are validators and sample agreement. Each accepted answer records the tier and profile.
5. **Retries**: transient errors retried at most 2 times with exponential backoff and jitter drawn from `ctx.rng`, honouring `Retry-After`; each retry reserves and charges budget and appears in the trace; after the cap, switch to a fallback profile with the same clearance; then fail closed. Validation failures follow C1 step 6 (one re-ask, then tier escalation). Budget, policy and fatal errors are not retried.
6. **Circuit breaker** per profile: after 5 consecutive transient failures within a window (initial values), the breaker opens for a cool-down measured by `ctx.clock`; routing skips open profiles (trace `breaker.open`); half-open probes with one request.
7. **Accounting**: `TokenLedger` events `{role, tier, profile, family, in, out, reasoning, estimated, sampleIndex, claimId?, subQuestion?}` from provider usage (billed), with `estimated: true` when the endpoint omits usage (the estimate is the larger of two tokenizer approximations, reserved conservatively). Aggregates per role, per tier, per claim, per phase (F-BUDGET) and per ablation arm; USD only when a price table is configured (NVIDIA pricing and credit terms are **NOT VERIFIED**; tokens are the primary unit). Reservation always includes the reasoning cap. The no-overshoot guarantee is conditional (INT-058): total provider-reported usage stays within the budget provided the estimator upper-bounds actual input usage and the provider enforces `max_tokens`; a violation is recorded and marks the run `budgetUnsound`.
8. **Concurrency**: fan-out of independent calls (per-document extraction, per-claim checks) merges in index order; per-profile concurrency and `rpm` limits are enforced by a token bucket driven by `ctx.clock`.

**Tests and acceptance.** `T14.C15.route-purity` (golden table of 40 routing situations); `T14.C15.clearance-never-downgrades` (property: no fallback chain ever lands on a profile whose clearance is a strict subset of the view's class); `T14.C15.sponsor-no-brain` (a sponsor-set run with a forced model failure never invokes the rule brain: it fails closed); `T14.C15.retry-charged` (retries reduce the budget and are traced); `T14.C15.breaker`; `T14.C15.reasoning-cap-reserved`; `T14.C15.independence-label` (same-family checkers are labelled in every trace); `T14.C15.canary-egress` (seeded canaries in restricted fields never occur in any recorded outbound request; negative control with masking off must show the canary). Metrics: escalation rate per tier, billed tokens per case versus an all-T2/T3 arm (H4: at most half), cost-quality Pareto, breaker opens, fallbacks used. Disproof: the cascade's accuracy is below the all-large arm outside the margin at under half the tokens only.

**Risks.** Single-family independence is weak; quotas are unknown, which also bounds the ablation (C18); ceilings and thresholds are initial values.

**Build notes.** Pure router and accounting first; breaker and limits after the OpenAI-compatible adapter. Unblocks H4.

---

## C16. Rule brain

**Best references.** The lexical gate and coverage rules of `prior-art/04` section 9.3 (idf coverage over 1 to 3 sentence windows, number, date, entity and negation parity gates); BM25 as used by FActScore `best_demos` and gpt-researcher's fallback filter (`prior-art/04`, `prior-art/03`); Fellegi-Sunter weights and the additive ledger (spec section 8, `prior-art/07`); ISO 7064 check-digit algorithms for IBAN and LEI (standards, algorithm only; text not fetched here); FinRobot's code-computed numbers with LLM narration (`prior-art/06` section 3.7); TradingAgents `rating.py` strict label parsing (`REVIEW` rather than `Hold`).

**What they actually do.** The research repositories have no model-free path (`prior-art/03` section 6: no recorded-response mode and no offline mode except local-doc runs). The deterministic pieces that do exist (lexical filters, BM25 demo retrieval, strict rating parser) are components inside LLM pipelines.

**Decision.** Own. The rule brain gives every LLM role a real deterministic implementation so the product runs without credentials, is the H1 control arm, and is the oracle for deterministic-stage replay on any input. It is **labelled in every trace** (`brain: "rule"`, `grade: "rule-brain"`), is never mixed into LLM-grade metrics, and never runs under the sponsor profile.

**Implementation design (algorithm per role).**

| Role | Rule-brain algorithm |
|---|---|
| Extractor | Scanner of C4 only: per-field label gazetteers with proximity rules (a label token within N spans before a typed value), checksum and grammar parsers, table cell reads from M2 coordinates; status `parser_only` always, so hold-relevant fields stay conflict-free but never get a second voice |
| Discovery | `discovery.table`: templates x aliases x pinned vocabulary in fixed order |
| Plan augmenter | none (returns no proposals); the template is the plan |
| Matcher | M3's weight ledger: choose the top candidate only if its total weight exceeds the upper threshold by a margin and no discriminator conflicts, `none` if below the lower threshold, else `abstain` (so it is the cascade itself and shows what the model adds); the confirm stage applies the same test to the (subject, nominee) pair alone |
| Decomposer | Segmenter, then clause splitting at `;`, coordinating conjunctions between clauses, `which`/`who` relative clauses, enumerations; pronoun to nearest preceding entity handle of matching type; extractive pieces; same cue guard as the model arm |
| L2 judge | Lexical gate of `prior-art/04` section 9.3 with calibrated `tau_hi`, `tau_lo` (abstains more rather than loosening); grade `lexical`, confidence `low` |
| Advocate | BM25 over the span index with the claim's content terms; supporting spans ranked by idf coverage per piece |
| Skeptic | Same index; (1) spans carrying the same attribute for the same entity with a different normalised value (from extractor and M3 assertions), (2) spans with negation cues co-occurring with the claim's terms, (3) missing-element detection when a piece's numbers/dates/entities are absent in every top span |
| Arbiter panel | none (residue stays `contested`) |
| Policy judge | Walk `L = {a ∈ A : a ⪯ r}` from `r` downward in the permissiveness order; take the first action whose precedent support margin (M6 score difference between supporting and counter precedents, outcome-weighted) exceeds a fixed delta and which handles every counter-precedent; if none qualifies, `r` stands unchanged (the judge-off arm). The brain never selects above `r`, so it never raises a loosening item |
| Soft critic | Deterministic rubric: accuracy = fraction of cited ids valid and relied-on claims `entailed`; appropriateness = action consistent with fired severities and gaps; actionability = reason codes, gaps and next steps present; thresholds as the 7 of 9 pass mark |
| Paraphrase | none (deterministic sentences) |

Because every brain is a pure function of its input, deterministic-stage replay runs on any input. The brain implementations share their algorithms with M3 and M4 where those modules own them, so there is no second copy.

**Tests and acceptance.** `T14.C16.interface-parity` (every role's brain passes the same schema and validator suite as the model path); `T14.C16.purity` (no ports touched; run twice, identical); `T14.C16.label-never-mixed` (metric aggregation refuses `rule-brain` rows in LLM-grade tables); `T14.C16.hold-direction` (brain failures and abstentions never loosen: same SchemaFuzz adversary suite). Metrics: the brain's scores are the A0/H1 baselines of C18. Disproof: a role whose brain equals the model arm within the margin is replaced by code (that outcome is a result, not a failure).

**Risks.** The brain's strength sets how hard the necessity tests are; a weak brain makes LLM roles look necessary. The brain therefore gets the same engineering care as the model path and its ablation is published.

**Build notes.** Build alongside each role so that every role is runnable from day one without a key. The role interfaces and the pure brains that M2 and M4 acceptance need are built at step 11c, before step 12 (register V10).

---

## C17. Collaboration behaviours and the tests that show each can change an outcome

**Best references.** Organizer collaboration checklist and strong pattern (`docs/event/04-approach-guide-solutioning.md` section 9); spec section 15 (each behaviour has a trace event and a test showing it can change the outcome; dynamic delegation claimed only with an LLM-proposed check that changes an outcome); MAST failure modes as a checklist (`prior-art/12` section 2.1); Kim et al. architecture labels.

**Decision.** Own. Each behaviour is defined by a state change, not by the presence of an agent name. "Can change the outcome" is tested by an A/B on a fixed case: behaviour on versus off, expected differing output hash and action.

| Behaviour | Roles | Trace event | Outcome-changing test (fixed fixture; cassette for live runs) | Claimed only if |
|---|---|---|---|---|
| Dynamic delegation | planner, augmenter | `plan.proposal.accept` | `T14.C17.delegation`: case with a foreign parent entity; template-only plan leaves `PARENT_ENTITY_UNSCREENED`; with the accepted `Proposal<Check>` the added check returns an adverse record and the action moves from `release_with_approval` to `escalate`. Paired with the C18 frequency measurement | a recorded live run (not the scripted one) shows an accepted proposal changing an action or closing a gap; otherwise the README says the planner is a template |
| Template-driven delegation | planner, coverage | `plan.template`, `coverage.replan` | `T14.C3.replan-changes-ledger` | always (deterministic, and says so) |
| Specialised roles | all | `agent.call` with role, tier, view hash | `T14.C18.leave-one-role-out` per role | each role survives its ablation or is merged |
| Real tool use | advocate, skeptic | `tool.call` (corpus search or read) | `T14.C8.contradiction-via-search`: the contradicting span is only reachable by a search the claim's cited evidence does not contain; label flips from `entailed` to `contested` | the span is found by the tool, verified by L0 |
| Critique and validation | hard critic, soft critic | `critic.findings`, `critic.rubric` | `T14.C10.weak-draft-forces-fix` | hard critic always; soft critic only if its revision gain exceeds harm (C10) |
| Revision | judge, reflexion | `revision.request`, `reflexion.retry` | `T14.C10.revision-changes-selection`: first selection omits a counter-precedent, revision cites it and moves the selection one step down | a recorded case |
| Shared structured state | all | `state.commit` with hashes (M7) | `T14.C17.state-handoff`: a role fed a corrupted upstream slot fails validation naming the slot | always |
| Branching on confidence and coverage | coverage checker, allocator, cascade | `coverage.replan`, `tier.escalate`, `allocate.route` | `T14.C8.inert-vs-relevant`: same claims, different verdict sensitivity, different tier path and cost | always (rule derived) |
| Retries and recovery | runner, router | `retry`, `fallback.profile`, `breaker.open` | `T14.C19.recovers`: a transient fault at T1 and a fallback profile yield the same final action as the fault-free run | always |
| Risk detection and escalation | extractor suspicion, matcher, panel, gate | `risk.flag`, `escalate` | `T14.C4.suspicion-escalates`: a document with instruction-like text and otherwise clean facts escalates and the clean twin does not | always |
| Traceable results | all | full trace plus `why_kind` | `T14.C20.trace-complete` (M9 linter) | always |

Organizer checklist coverage (nine items): planner delegates (C2/C3), specialist uses data or tools (C4/C8), evaluator critiques (C10), agent revises (C10), risk agent flags unsupported claims (C8/C4), shared memory (M7 state), branching on confidence (C15/C8), fallback (C15/C19), traceable evidence (C20). The agent-behaviour-critic subagent runs after each of C2, C8, C10 are first runnable, not only at the end (spec section 15).

**Tests and acceptance.** The table's tests; plus `T14.C17.no-decorative-role`: for every role registered with a prompt, there is a test in this table or in C18 that fails when the role is removed; a role without one is deleted. Disproof: any "claimed only if" condition unmet means the behaviour is not claimed.

---

## C18. Role-necessity ablation, operationalised

**Best references.** `prior-art/12` sections 3 to 9 and 13.3 (3): Kim et al. 2025 architecture labels, Tran and Kiela 2026 (billed-token matching), Choi et al. 2025, Zhang et al. 2025, Self-MoA (heterogeneity can lower quality), Wang et al. 2024 (equal prompt effort), Kapoor et al. (cost with accuracy, holdout, simple baselines), TOST equivalence testing (statistical method; the margin procedure below is ours, the implementation of tests is M11's).

**Decision.** Own the role-specific content; M11 owns the schemas and the runner (INT-060). This section turns spec section 15's protocol into configuration for the roles of this module. M11 owns `Prereg`, `ArmSpec`, the pre-registration ledger, the statistics code and the report; this module supplies the role registry, the per-role arm overrides expressed in M11's `ArmSpec.roles`, the per-role metrics and the text of hypotheses H1 to H5.

**Implementation design.**

```ts
type ArmId = "A0"|"A1"|"A2"|"A3"|"A4"|"A5"|`A6:${RoleId}`|`A7:${string}`|`A8:${string}`;
interface RoleArmOverride { role: RoleId; impl: "llm"|"rule"|"merged"|"removed"; profileSet?: string; prompt?: PromptRef }   // one entry of M11's ArmSpec.roles
interface RoleArmContent { arm: ArmId; roles: RoleArmOverride[] }      // this module's contribution to each M11 ArmSpec; the config hash and token policy are M11's
```
1. **Arms** map onto the graph by overrides of `RoleImpl` (the substrate-independent seam of C1); M4's ablations (span gate C6, advocate and skeptic C7, argumentation C14, locality-violation measurement) are registered by M11 as further arms. A0 rules only (every role `rule`, the planner template, no judge); A1 single strong model, same tools and all documents in one context, same demonstrations; A2 equal billed tokens as k independent samples with a vote; A3 equal billed tokens on one long reasoning pass; A4 centralised orchestrator with homogeneous workers (all roles one profile, the orchestrator routes); A5 Plumbline; A6 leave-one-role-out, once per role (`rule`, `merged` or `removed` as listed below); A7 round-table on or off; A8 persona-only (same view, tools, tier; only the role text differs) and the generative decomposer.
2. **Billed-token matching**: `A2`/`A3` budgets follow M11's `tokens.policy`, whose primary (`match_item` or `match_median`) is named in the pre-registration (M11 SF9); the target is the A5 ledger total from provider usage, not requested budgets, with this module's recommended tolerance of 5 percent; a run outside tolerance is re-run, not rescaled; the harness prints requested versus billed.
3. **Per-role operational definition**:

| Role | Primary metric (control) | Replacement arm | Gate for keeping |
|---|---|---|---|
| Extractor | field recall and silent-wrong-field rate; steer rate (parser only; monolith A1) | rule brain | recall gain with interval excluding 0 at the cost multiple, or removes an attack path (H3) |
| Web discovery | planted secondary-source facts reached per query (table generator) | `discovery.table` (the default) | gain at equal queries, else the LLM variant stays off |
| Plan augmenter | sources-reached recall and outcome changes (template only) | removed | gain, else delegation not claimed |
| Matcher | false-merge rate then recall at fixed review budget (cascade without model; Splink; nomenklatura) | rule brain | zero false merges and recall gain |
| Decomposer | drift rate, coverage, downstream label agreement (sentence fallback; generative arm) | sentence fallback / generative | not worse by TOST margin, else swap |
| L2 judge | agreement with gold, over-commit rate (lexical gate) | lexical | gain over lexical |
| Advocate and skeptic | contradiction recall and false-contradiction rate (H2 controls) | merged / L2 only | H2 |
| Arbiter panel | gold agreement, self-preference bias (single large judge, deterministic only) | removed (`contested`) | gain or bias reduction |
| Policy judge | decision accuracy, loosening-item rate, reviewer workload (judge off: `r` stands) | judge off | gain, else removed |
| Soft critic | outcome-change rate, harm rate (validators only) | removed | gain over harm |
| Paraphrase | unsupported-sentence rate | deterministic text | zero beyond margin |
| Code roles (H1) | no primary metric loses (the code roles cannot be removed; the equivalence test compares them to an LLM implementation) | an LLM implementation of planner/hard critic/reporter | TOST passes |

4. **Procedure**: (a) pilot split (separate from evaluation) estimates the noise floor of each metric by rerunning A5 and the rule brain; (b) margins `delta` are set before any confirmatory run as the larger of the domain reviewer's smallest effect of interest (open item, **no values set here**) and a multiple of the pilot noise floor (a margin below the noise floor can never pass TOST); (c) the PreReg JSON is written first and `analysisCodeHash` pins the code; (d) a run is **confirmatory** only if its pre-registration was publicly committed after 22 Oct 2026 00:00 UTC (or hash-anchored externally, an open question for the organizers, D5) before the run starts, and the report header says so; any run before that is exploratory by definition (INT-059), and the harness refuses to label a run confirmatory without a committed PreReg id; (e) three runs per item, worst-of-three reported separately from medians; (f) cluster bootstrap by vendor case with the design effect; (g) multiplicity correction named in advance; (h) results published whichever way they fall, including roles removed.
5. **Budget check before scheduling**: `calls = arms x cases x runs x families x callsPerCase` and `tokens = calls x meanBilledTokens` from a pilot; compared with the endpoint quota (**NOT VERIFIED**) and written into the PreReg; if quota is insufficient the arm list shrinks by pre-registered priority (A1, A2, A6 for advocate/skeptic and extractor first), and the omitted arms are listed as not run.

**Tests and acceptance.** `T14.C18.arm-config-hash` (an arm's overrides are the only difference between two M11 config hashes); `T14.C18.token-match` (A2 billed tokens within tolerance on the scripted port with synthetic usage); `T14.C18.no-prereg-no-confirmatory-label`; `T14.C18.margin-above-noise` (harness refuses a margin below the pilot noise floor); `T14.C18.positive-control` (a deliberately crippled A5 variant must be detected as worse; an inert replacement must be detected as equivalent). Disproof: positive control not detected means the harness cannot support any necessity claim.

**Risks.** Quota and cost; the domain reviewer's margins are an open dependency; with the sponsor profile the family-diversity hypotheses (H5) cannot be tested and are tested only in the evaluation profile.

---

## C19. Failure drills and mechanical attribution

**Best references.** Who&When (Zhang et al., arXiv 2505.00212: best step-level LLM attribution 14.2 percent, `prior-art/12` section 2.2); MAST; FinRobot degrade-with-marker and `critical` flag (`prior-art/06` section 3); TradingAgents `REVIEW` sentinel; `prior-art/12` section 13.3 (2) contract-localised attribution benchmark; spec principles 4 and 5 (absence is not falsity; failure is visible); `SEC-P5` adversary port.

**Decision.** Own. Each fault is a `ScriptedPort` injector or a `SchemaFuzzPort` mode, so a drill needs no live model.

**Implementation design.** Fault catalogue (ids `F01` to `F14`): timeout; 429 with `Retry-After`; 5xx; connection reset; truncated output (`finish=length`); malformed JSON; valid JSON failing the schema; schema-valid with an unknown id; schema-valid but out of the allowed set; refusal; empty content; reasoning leak (text before JSON); repeated-token loop up to the cap; model id removed (404) mid-run. Expected result per role (the `failClosed` value and its downstream effect):

| Role | Fail-closed value | Downstream effect |
|---|---|---|
| Extractor | field `unextracted`, chunk counted failed | required field absent with `absent_incomplete_coverage`: hold by policy |
| Web discovery | no queries; `not_checked` for the sub-question | gap, confidence cap |
| Plan augmenter | no proposals | template plan only |
| Matcher | `abstain` | screening candidate stays `possible` (escalate); no corroboration link |
| Decomposer | sentence fallback, grade labelled | claim-level metrics exclude it |
| L2 judge | unresolved; escalate tier | contested if the ladder ends |
| Advocate / skeptic | brief empty, `adversarial_check: not_run` | verdict-relevant claim gets a gap that caps confidence |
| Arbiter panel | `contested` | escalation |
| Policy judge | `r` unchanged with `failed_closed` | effective action is the rule engine's recommendation (the judge-off arm); no loosening is possible |
| Soft critic | no rubric | no revision; outcome unchanged |
| Paraphrase | deterministic sentence | none |

Mechanical attribution: every `RoleFailure` carries `{role, step, field, code}` and the trace links the failing validator id; the benchmark injects each fault `F01` to `F14` into each role and each step and scores the fraction of faults whose first `RoleFailure` names the injected role, step and field (expected near total for contract faults), against an LLM attributor in the Who&When style on the same traces. Semantically wrong but well-formed outputs are out of scope for mechanical blame and are reported separately as undetectable by contracts alone.

**Tests and acceptance.** `T14.C19.<role>.<fault>` for every cell (11 roles x 14 faults, skipped cells justified in the table); `T14.C19.never-loosens`: for every role and fault the final action is no more permissive than the action with that role replaced by the `SchemaFuzzPort` adversary maximised over valid outputs (restrict-only monotonicity, a statement at the stated scope of the policy table with M5/M8); `T14.C19.sponsor-no-substitute`; `T14.C19.attribution`. Metrics: attribution accuracy with intervals, failed-closed rate, share of faults that changed the final action (reported, not hidden). Disproof: any cell where a fault produces a more permissive action than the no-contribution baseline.

**Risks.** The enumerated faults omit adaptive behaviour (a model that fails only on adversarial inputs); `SchemaFuzzPort` covers any valid output but not stateful strategies.

---

## C20. Agent trace conventions

**Best references.** Trace schema with a required `why` per decision and `decider: code|model|human`: `prior-art/06` section 9.8; spec sections 4 and 13 (`why_kind` of `rule`, `computed`, `model_reported`, `human_reported`; hash-only content by default; deterministic ids; OpenTelemetry GenAI naming at a pinned version); TradingAgents allow-listed run settings in saved logs; FinRobot credential scrubbing at the trace sink; AutoGen OpenTelemetry GenAI naming as an optional exporter (`prior-art/06` section 6.3).

**Decision.** Own the event vocabulary; M7 owns the one trace schema (`prevLineHash`, `why_kind`, `decider`, `phase`, `agent`, `verb`, `budget` snapshot, `tenant`, `semconv_version`) and the closed verb registry, in which the events below are registered as verbs, with `agent` carrying the visible agent (INT-054); M9 owns the linter and exporter. Content is hash-only; prompts and responses live in cassettes under the secret scan, not in traces.

**Implementation design.** Events added to the M7 vocabulary (all carry `seq`, `branch`, `localSeq`, `ts` from `ctx.clock`, `mode`, `runId`, `step`):

| Event | Required fields |
|---|---|
| `agent.call` | `role`, `visible`, `brain`, `grade`, `tier`, `profile`, `family`, `independence` (`family` or `same_family`), `promptHash`, `fewShotHash`, `schemaId`, `viewHash`, `inputStateHash`, `dataClass`, `redactions` (counts), `structuredMode`, `sampling`, `sampleIndex`, `attempt`, `usage` (billed, `estimated`), `finish`, `reasoningStripped`, `outputHash`, `stop` |
| `agent.validate` | `validatorId`, `ok`, `code`, `field`, `role`, `attempt` (a failing event is the attribution record) |
| `decision` kinds | `tier.escalate`, `retry`, `fallback.profile`, `breaker.open`, `plan.template`, `plan.source_routing`, `plan.proposal.accept` / `.reject`, `coverage.replan`, `coverage.stall`, `allocate.route`, `matcher.agreement`, `matcher.confirm`, `extractor.double`, `panel.aggregate`, `judge.skipped`, `judge.ceiling` (selection class: confirm, restrict, loosen or outside `A`), `critic.findings`, `critic.rubric`, `revision.request`, `reflexion.retry`, `paraphrase.verdict`, `risk.flag`, each with `rule`, `inputs`, `chosen`, `alternatives`, `why`, `decider`, `why_kind` |
| `tool.call` | `role`, `tool` (`corpus.search`/`corpus.read`), `argsHash`, `resultIds`, `stepIndex`, `budgetRemaining` |
| `budget` | reservation, settle, `overshoot` (must be 0) |

Rules. (1) `why_kind: "computed"` for validator and gate outcomes (with `rule` id and `inputs`); `"model_reported"` only for a model's selection or rubric and never rendered as an explanation (spec section 13). `decider` is `code`, `model` or `human`; a structured human decision is a `rule` reason with `ruleId "human.approval.<code>"` bound to the signed approval record, and free text from a person is `human_reported`: stored, labelled untrusted, never counted by `explanationCoverage` (INT-002). (2) A model response appears as `outputHash`; reasoning appears only as a hash and token count. (3) The trace records the model id **served** as well as requested. (4) `independence: "same_family"` is written whenever a checker shares a family with its producer. (5) Secrets are scrubbed at the sink with a canary test. (6) A cleaned sample trace for `output_examples/traces/` is generated from a SAMPLE_MODE run, not authored. (7) The OpenTelemetry GenAI attribute mapping table (which of these fields map to `gen_ai.*` names) is decided in M9 against a pinned convention version; the convention's current names were **not read** for this blueprint.

**Tests and acceptance.** `T14.C20.trace-complete` (every `agent.call` has a matching `agent.validate` or `stop`); `T14.C20.why-required`; `T14.C20.no-content` (no prompt or response text in traces, with a negative control); `T14.C20.served-model-recorded`; `T14.C20.independence-label`; `T14.C20.replay-equal` (normalised trace equality under cassette replay, M7's test applied to agent events). Disproof: a role that can run without emitting `agent.call` makes the cost, tier and independence accounting untrustworthy.

---

## Consolidated acceptance checklist for the module

- All role schemas, prompts, few-shot sets, plan templates and registries are hash-pinned and the lock tests pass.
- Every LLM role has a rule-brain implementation, a scripted fault drill row, and an ablation row; every role without an ablation row is deleted.
- Sponsor-profile proof run: trace shows real Nemotron calls with served model ids, no rule-brain invocation, same-family labels, zero overshoot (a sponsor claim stands only when this test passes; **NOT VERIFIED** until a key exists).
- The `agent-behaviour-critic` review passed after C2, C8 and C10, and the C17 table has no "claimed only if" unmet.
- Evaluation-profile claims (H2 to H5) are reported with intervals, worst-of-three separately, the list of arms not run, and the quota assumptions.

## Interfaces table

| Interface | Provided by | Consumed by | Shape |
|---|---|---|---|
| `RoleRegistry`, `runRole` | M14 | M7 graph nodes, M3, M4, M5 | `RoleSpec`, `RoleResult<O>` with trust, usage, stop reason |
| `selectTemplate`, `instantiate`, `routeSources` | M14 | M7 (planning node), M1 (channel metadata in) | `Plan`, `RoutingDecision` |
| `planGate.apply` | M14 (co-owned with M7 gate types) | planner, trace | `Proposal<Check>` to `Approved<Check>` |
| `coverageCheck`, `updateStall` | M14 | M7 (loop edges) | `ReplanRequest[]`, `StallState` |
| `Extraction` (with agreement states) | M14 | M2 (acceptance), M3 (conflict items) | shared `ExtractionSchema` (M8 kinds, M2 parsers), spans by `sp_` id |
| `MatcherVerdict`, `PairConfirmation`, `applyMatcher` | M14 | M3 | nominate then confirm per pair; direction-aware `LinkEffect`; edge `inputs` are the pair's assertions |
| `Decomposition` (pieces) | M14 | M4 | atoms become shared `Claim`s with `pieces`, `decomposer`, `parentRef` |
| `EntailmentVerdict`, `Brief`, `PanelVerdict`, `allocate` | M14 | M4 | verdicts with deciding spans; routing plan from M4's sensitivity map |
| Policy judge role | M14 | M5 | M5 `JudgeInput`/`JudgeOutput` (handles); M5 `validateJudge`, M6 `validateJudgement`; `s ⪯ r` accepted, `s ≻ r` a `judge_loosening` item |
| `Finding[]`, `Rubric`, reflexion trail | M14 | M5, M10 | typed findings, escalation trail |
| `Dossier` (deterministic), `ParaphraseView` | M14 | M9, M10 | canonical text plus verifier receipts |
| `ModelPort` adapters, descriptors | M14 (port declaration, `capabilities`, `canonicalRequest` are M7's) | M7 effect layer (wraps with budget, cassette, trace) | request/response types of C13 |
| `ProfileSet`, `route`, `TokenLedger` | M14 | M7 (reservations), M11 (arms, cost), M12 (sponsor evidence) | pure router, billed-token events |
| `SchemaFuzzPort`, `ScriptedPort`, `LocalStubServer` | M14 | M8 (`SEC-P5`), M11, all module tests | test doubles |
| Model inventory report | M14 | M12, M11, README sponsor proof | JSON in `eval/reports/` |
| Role registry, `RoleArmContent`, per-role metrics, H1 to H5 text | M14 | M11 (owns `Prereg`, `ArmSpec`, runner, statistics) | role overrides for `ArmSpec.roles`; JSON committed before confirmatory runs |
| Agent trace events | M14 (verbs) | M7 sink and verb registry, M9 linter and bundle, M10 run view | table of C20 |
| Needs from M7 | | | ports and effect keys; budget `split`, reservation including reasoning cap; cassette keyed by effect slot with request-hash verification; `ModelPort` `capabilities` and `canonicalRequest`; trace schema and verb registry; `Proposal`/`Approved` constructors |
| Needs from M8 | | | `Labelled<T>` constructor and registry; compartment runner for Q-proc; K2 model-call broker; `ExtractionSchema` kinds and validator; `ports/egress.ts` and the egress manifest; closed-grammar executor; action registry |
| Needs from M1/M2/M3/M4/M5/M6 | | | channel metadata and probe status; M2 `renderForModel` aliases, `SpanRecord`, `groundValue`; span index and `corpus.search`; candidate generator and weight ledger; sensitivity map and gap ledger; allowed set, recommended action `r`, the permissiveness order, `JudgeInput`/`validateJudge`; M6 `PrecedentRetrieval` and `validateJudgement`; M12 `dataClassMap.json` |

## Spec feedback

1. **Matcher failure direction (spec section 8, "failure means do not merge").** For screening matches (sanctions, PEP, adverse media) "do not merge" is the permissive direction: a model `none` would dismiss a hit. Under restrict-only the model may only add holds on screening tasks and only withhold permission on corroboration tasks. Proposed wording: "A model link judgement never clears a screening candidate and never alone satisfies a required positive-evidence entry." (C6) **Resolved by INT-035** (spec section 8 sentence adopted; the nominate-then-confirm stage is INT-036).
2. **Compartment versus egress (section 5).** The extractor child process is denied network, yet extraction needs a model call. The spec needs the broker design (a narrow parent-side forwarder of one fixed request type) or a statement that the model call happens in the parent with the raw text in its view. (C4) **Resolved by INT-019 and INT-022**: the broker is M8 K2, the extraction contract is the shared `ExtractionSchema`, and the network claim follows the probed backend.
3. **Critic revision versus "never the sole trigger" (sections 10 and 15 versus 21).** Section 21 gives the critic rubric one revision; section 10 says the soft critic is never the sole trigger of reflexion. Reconcile as: one advisory revision from the rubric, separate from deterministic-failure reflexion, both confined to the judge's allowed range. (C10) **Resolved by INT-065** (spec section 15 wording).
4. **Hosted catalog scope (RUN-02, section 15).** The fetched NVIDIA API reference page lists models from several vendors, which narrows the "endpoint inventory unknown" risk: the evaluation profile may need no second provider. This is a page summary, not exercised; the spec should keep **NOT VERIFIED** until the doctor runs. **Resolved by INT-062 (i)**: the multi-family catalog and the OpenAI-compatible claim beyond base URL and path stay NOT VERIFIED, and this blueprint now plans for a second provider key instead of relying on the catalog.
5. **Judge ceiling semantics (section 10).** "Any selection above the least permissive allowed action becomes a human approval item" makes the judge's effective default the floor; between `escalate` and `hold` the permissiveness order needs M5 to say which is looser in practice, otherwise the judge's only useful choices are not defined. (C9) **Resolved by INT-027**: `s ⪯ r` is autonomous, `s ≻ r` is a loosening item, the floor notion is gone, and the order is data in the policy IR.
6. **Claim type lacks `pieces`.** The shared `Claim` has `text` and `parentSpan`; extractive decomposition needs an optional `pieces` list so `text` is derived, not stored independently. (C7) **Resolved by INT-012**: `Claim` gains `pieces`, `decomposer` and `parentRef`.
7. **Roster omissions (section 15).** The LLM-bearing list omits the L2 entailment judge (required by section 9) and the plan augmenter (implied by "an LLM may propose extra checks"). Add both, with their compartments. **Resolved by INT-065** (both roles added to the spec section 15 roster; the web-discovery role is made conditional by INT-023).
8. **Data-class vocabulary.** Spec: `public`, `case-visible`, `internal-sensitive` plus `personal`. The Meterless readout and Scout routing documents use `public`, `internal`, `confidential`, `restricted`. M12 should hold the mapping table; the profile clearance in this module uses the spec vocabulary. **Resolved by INT-009**: M12 owns `dataClassMap.json`, unmapped classes map to `internal-sensitive`.
9. **Panel aggregation (section 9).** The spec says the residue goes to a panel and `contested` is never forced to a vote; it does not say how a permissive label may be reached. Proposed: permissive labels need unanimity plus an L0-verified deciding span; any verified dissent downgrades to at least `contested`. (C8) **Resolved by INT-065** (spec section 15 wording).
10. **Temperature and determinism assumptions.** Section 4 speaks of temperature and replay; the reasoning-on model cards advise temperature 0.6, and live endpoints are not repeatable at temperature 0. The spec should say repeatability is a property of cassettes only (it already says so for replay; the model-profile text should say it for sampling). **Resolved by INT-065** (spec section 15 wording; guarantee-table replay row).
11. **Reservation must include reasoning tokens** (section 4 budgets): reasoning models spend output budget invisibly; the reservation rule must cap reasoning explicitly. **Resolved by INT-058**: the cap is in the reservation and the no-overshoot guarantee is stated as conditional (C15 item 7).
12. **Agent-pairings prompt file naming** (`<pairing>.<role>.md`) predates hash-pinned variants; this blueprint keeps the naming and adds a lock file. No spec change needed, only a note in `docs/design/agent-pairings.md`. **Resolved by INT-065** (spec section 15: prompt file naming gains a lock file).

## What this blueprint does not cover

- Reconciliation algorithms and thresholds (M3), L0 checks, the exact causal layer, certificates and the sensitivity computation itself (M4), the rule engine, policy IR and approval queue (M5), memory and precedent scoring (M6), the runtime substrate, cassettes and budgets (M7), label unforgeability, the compartment backends and the model-call broker (M8), PDF text-layer extraction and span aliases (M2), the verifier and bundle (M9), UI (M10), statistics code and gold sets (M11), sponsor evidence beyond the model inventory (M12), the case lifecycle (M13).
- Anything about the NVIDIA hosted route that needs a key: model ids, structured-output and reasoning parameters, quotas, pricing, latency, refusal behaviour. The adapter, the doctor and the stub server are specified so that these become measurements the day a key exists.
- Native tool calling and the MCP/A2A client or server roles (M10/M12); this module uses a typed action protocol for its two tool-using roles.
- Fine-tuning, distillation, learned routers and workflow search (excluded from production by `prior-art/12` sections 7 and 13.2); DSPy optimisers, Instructor, NeMo Guardrails and promptfoo/Inspect behaviour were not read.
- Cost in currency (no verified prices), multilingual prompts, and prompts for languages other than English.
- Surfaces and cases not exercised by any test here because nothing is built: every metric, threshold and starting value in this document is a hypothesis; no model was called.

## Pass 3 resolutions (2026-10-13)

Source: `99b-integration-register-pass3.md` (INT-101 onward). These bindings override the body above wherever they differ; the body has not been rewritten. Each line is one binding change; the register item holds the reason and the other modules affected.

- **INT-108.** `PreReg` margin and sample fields follow M11's `Ppm` schema; no floats.
- **INT-109.** `ProfileSet.name` is the shared `ModelProfile` (`sponsor | evaluation | local`); `local-confidential` is renamed `local`; `offline` is a `DisclosureProfile` and is removed from this type.
- **INT-110.** The cascade `Tier` type becomes `MT0` to `MT3`; read every `T0`..`T3` in the roster and routing tables as `MT0`..`MT3`.
- **INT-112.** C8 returns M4's `EntailOutput`; `EntailmentVerdict` is retired as an alias; `missingPieces` indexes `Claim.pieces`.
- **INT-113.** C7 sets `decomposer: "rule:<id>"` for the rule-brain splitter; `Piece` offsets are code points of the parent sentence.
- **INT-120.** C4: `single` is no evidence of agreement or disagreement and is a gap on `holdRelevant` fields.
- **INT-122.** C9: on judge failure at the end of the ladder the selection is `r` with `judgeFailed`; the validator also tests `s ∈ A`.
- **INT-140.** C6 reads `callsPerNominatedPair` and `maxModelCallsPerCase` from M3's `LinkConfig`.
- **INT-148.** C13 `canonicalRequest` replaces per-run span aliases by canonical span ids and drops the nonce before hashing.


> v5.2 (D-026): profile-pass additions for this module are in `98-profile-pass-additions.md` (adoption register ids; they win over this blueprint where they differ).
