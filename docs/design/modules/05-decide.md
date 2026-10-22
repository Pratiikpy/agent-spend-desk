# Module 05: Decide (policy, judgement, selective release, approval, autonomy)

## v5.1 alignment (2026-10-15, spec section 0 wins where this blueprint disagrees)

- The symbolic check of the permissive surface is now a required step before any rule is promoted (replay on a small case set can pass trivially) (D-019). The override-to-rule loop is build step 12a.
- Autonomy ladder named as in the organizers' workshop: AL0 Macro, AL1 Confirm, AL2 Loop with stops, AL3 Free-run, chosen by context delta; irreversible actions capped at AL2 (D-016).
- Online risk monitoring beside the anytime-valid promotion test, as a drift alarm that demotes the ladder (D-015).
- Second pack: coding and infrastructure release gate; Cedar-style analysis is a candidate for the symbolic check.


## Integration revision (2026-10-13)

Source: `99-integration-register.md`. Sections not touched by the register are unchanged. Nothing here is built or measured.

**Applied (INT id: what changed, where).**
- INT-014: the numeric `Level` is gone. Rules use `needs: {f, class: ActionClass}`; atoms `permits` and `status`; the interpreter decides by `permitsClass(label, class)` over the matrix whose hash is in the bundle (C1); C3 enumerates matrix rows; C4 encodes `st_f`/`row_f`; I7 redefined over `erase(c)`; C16 step 1 no longer maps trust to numbers. Tests `T-IR-09` to `T-IR-11`.
- INT-015: new `DecideInput` fields and feature-registry rows `doc.risk.*`, `doc.complete.*`, `manifest.*.status`, `claim.*.canPermit`, `overlay.releaseBlock`, `target.reversible`, exposure reservations (C2, `T-FE-10`); I7(b) covers them (C6).
- INT-007: five `CellStatus` values kept end to end; `silent` adds a gap and is never folded into `not_checked` (C1, C3, C16 step 1).
- INT-013: features read facts through `supports` only and take the trust meet (C2, C16).
- INT-024: features `actors.vendor_master_editor` and `release.amount_ceiling` (C2).
- INT-027: restrict-only ceiling semantics stated; `actionOrder` is bundle data with `T-IR-09` (C1, C8).
- INT-028: C9 now uses M6's `PrecedentRetrieval` and `validateJudgement`; one dismissal vocabulary; JV7 and JV8 delegate to M6; handles stay mandatory (C8, C9).
- INT-038 and INT-040: taint is `precedentTrust` below `VERIFIED`, tainted and unproven permissive precedents excluded, strict `knownShare < knownShareMin`; erased cases replay `INDETERMINATE` (C9, C15).
- INT-011: autonomy ladder `AL0` to `AL3` (C1, C10, C12, C15, C16); judge checks `JV1` to `JV11` (C8, C9).
- INT-029, INT-030, INT-031: C13 is item semantics only, the service is M13's; the run ends at `awaiting_approval`; expiry moves the case to `HELD` and three named clocks exist (C13, C16).
- INT-032: fast-lane wording for `release` at `AL2`; reversibility from `TargetManifest.reversal` (C10, C12).
- INT-033: gate scope covers rule bundles, parameters get declared directions (C7).
- INT-034: M4 owns `Evaluator` and V(S); M5a supplies `featurize`, `evaluate`, `reads`, `deriveTrace`, `evaluatorHash` (C15).
- INT-037: split into M5a (C1 to C6, C15 API) and M5b (C7 to C14, C15 record, C16); depends/depended-on rewritten; build order and bake-off 2 timing (section 2, C5, C16).
- INT-050: verifier-interpretable is a gating criterion of bake-off 2; V6a referenced (C5, C2).
- INT-021: judge digest is an egress sink with a manifest entry (C8, C16). INT-010: integer scales in hashed documents (C10 to C12, C15). INT-002: `human_reported` why kind (C15). INT-059: confirmatory-run wording (C10).

**Resolved only in the spec, no body change here:** INT-061 (SF8) and INT-065 (SF4, SF5, SF11, SF14, SF15); marked in Spec feedback.

**Name this module but deliberately not applied:** none beyond the above. Two follow-ups were left to their owners: M5's ledger leaf names (INT-049 does not name M5) and `decide.*` trace fields `phase`, `agent`, `verb`, `tenant` (INT-054, INT-048 do not name M5).

**New contradictions found.**
1. The shared `Verdict` (verifier PASS/FAIL, INT-001) collides with M5's rule-engine verdict; renamed `PolicyVerdict` here. M4, M9, M10 and M11 use the old name for M5's value and need the same rename.
2. `permitsClass` needs `authorship`, `producer` and `writeOrigin`, but the shared `Fact` and `LabelRecord` (register section 3) carry only `trust`, `conf`, `personal`; M3 facts cannot populate `ViewEntry.label` until they do.
3. M5 ledger leaves `policy.proposed|activated|emergency_tightened|lapsed` and `autonomy.promoted|demoted|frozen` are not in M9's registry (`policy.published|approved|superseded`).
4. INT-029 says `ApprovalItem` is shared, but section 3 declares only `ApprovalItemType`, `ApprovalState`, `ApprovalClocks`; `ApprovalItem`, `ApprovalSlot`, `Binds` and an `ApprovalService` port type are missing, and without them M5b and M13 form a package cycle (M13 consumes item semantics, M5b consumes the ledger and service).
5. INT-037 does not place `recomputeStage`; kept pure over supplied records in M5a so M6 never depends on M5b.

Status: implementation blueprint, written 2026-10-13 against spec v3.1 (`../00-architecture-master-spec.md`, section 10 with 9a, 11 and 14a) and the conventions in `00-conventions-and-shared-types.md`. Nothing here is built. Every design claim is a hypothesis with a named test. Numbers marked "computed here" were produced by small scripts run while writing this blueprint; they are arithmetic or seeded simulations of ours, not published results.

## 1. Scope and contract

**Job.** Turn a frozen, typed, trust-labelled case (M3 facts, M4 claim ledger, M6 precedents, M13 exposure ledger) plus a pinned, versioned policy into a controlled decision: an allowed action set computed by code, a judgement confined to it, a calibrated decision about whether a person must look, an autonomy level, and an approval item for anything a person must own. It also owns how policy changes (the rule-change gate), how autonomy is earned and lost, and the record from which M4 explains and M9 re-verifies the decision.

**Inputs (typed values only; the privileged compartment never reads raw untrusted text).**

```ts
interface DecideInput {
  caseId: Id<"case">; asOf: Iso;
  snapshot: FrozenSnapshot;        // M3: truth-table cells {status: CellStatus (five values), label (trust, authorship, producer), value, factIds}, link judgements, identity stability
  claims: ClaimLedgerView;         // M4: claim ids, labels, `canPermit` chain flags, gaps, minimal-flip digests (no free text)
  docSignals: DocSignalsView;      // M2: DocRisk, DocFinding severities, DocCompleteness per document type
  manifest: ManifestStatusView;    // M8 C6 `evaluateManifest`: one ItemState per manifest item, as labelled facts
  overlay: CaseOverlay;            // M13: { legalHold, frozen, releaseBlock }
  target: TargetView;              // M13: `TargetManifest.reversal` per action class
  policy: PolicyStack;             // pinned PolicyBundle hashes, regulation > company > team
  actors: ActorBinding[];          // requester, vendor-master editor (`editor_sub` of the last master write), proposer, as identity-provider subjects (C13)
  exposure: ExposureLedgerView;    // M13: releases and reservations (approved, unexecuted) with ledgerSeq (C2, C6/I6)
  precedent: PrecedentPort;        // M6 `retrieve(q, pin)`, pure function of a pinned snapshot (C9)
  autonomy: AutonomyStateView;     // per-cell level and statistics (C12)
  calibration: CalibrationBundleRef; // per-stratum selective-release thresholds (C10)
}
```

**Outputs.** `DecisionRecord` (C15, chained into the M9 ledger); `ApprovalItem`s handed to M13's approval service (C13); `RuleProposal`s received from M6 consolidation (as data; M6 does not import this module) or human authors and passed through the gate (C7); `DecisionEpisode` write-back proposals to M6; the `Derivation` that M4 consumes, mapped to M4's `DerivationTrace` (C15). The only constructors of `Approved<T>` in this module are the gates of C7, C8 and C12, and the eligibility check of C13 that M13's service calls before it records an approval.

**Package split (INT-037).** The module ships as two packages so the dependency graph is acyclic. **M5a, policy core:** C1 to C6 and the pure API of C15 (`featurize`, `evaluate`, `derive`, `coneOf`, `fieldDeps`, `flipSearch`, `revalidate`, `recomputeStage`, and the `DecisionRecord`/`Derivation` types); depends only on M7, M8 (`permitsClass`, the permission matrix) and the shared types, so M4, M6, M9 and M3 (through M4's injected `verdictOf`) can import it. **M5b, decision pipeline:** C7 to C14, the record assembly, policy registry and time travel of C15, and C16; depends on M3, M4, M6, M5a, M9, M13 and M14, and reaches M13 only through the shared `ExposureLedgerView` and approval-service port types, never by import.

**Depends on.** M5a: M7, M8, shared types. M5b: additionally M3 (frozen facts), M4 (claims, gaps, minimal-flip digests), M6 (`retrieve`, `validateJudgement`, `appendEpisode`), M9 (ledger append, proof bundle storage), M13 (exposure ledger and reservations, approval service, outcome labels, broker re-validation), M14 (the judge model profile). **Depended on by.** M5a: M4 (owns the `Evaluator` composition and calls `evaluate`, `coneOf`, `flipSearch`), M6 (`revalidate`, `recomputeStage`), M9 (the verifier recompute module interprets the IR and feature programs), M3 (`verdictOf` injection for `robustness`). M5b: M10 (flip panel, time travel, rule diff), M11 (simulators and benchmarks), M13 (item semantics and eligibility for approvals that feed capability issuance).

**Pipeline (spec section 10, refined here).** normalise case (`featurize`) -> rule engine (`evaluate`) -> precedent retrieval -> judgement confined to the allowed set -> hard critic and soft critic -> bounded reflexion -> selective-release gate -> autonomy gate -> decision record. Each arrow is a typed value; every failure is a `Result` that ends in `hold` with a reason code, never in a default (C16). A run ends at `decision.final`; where a person must act the case moves to `awaiting_approval` and waiting is a case state owned by M13, not an in-run interrupt (INT-030).

## 2. Component list

| # | Package | Component | Spec anchor |
|---|---|---|---|
| C1 | M5a | Policy IR and TypeScript interpreter (expressiveness, precedence, stacks, permission-matrix lookup) | 10 "Policy IR" |
| C2 | M5a | Feature programs: derived-feature functions, feature registry and conformance tests | 10, DEC-01, DEC-03 |
| C3 | M5a | Exhaustive cell-enumeration verifier against the shipped interpreter | 10, 9a "Decision correctness" |
| C4 | M5a | Z3 encoding and differential testing | 10 |
| C5 | M5a | Cedar and OPA comparison protocol (bake-off 2) | 19a item 2, DEC-05 |
| C6 | M5a | Invariants I1 to I9: statement, enumeration, proof | 10 |
| C7 | M5b | Rule-change gate (tightening versus loosening, tiers, liveness, ADR, certificate) | 10 |
| C8 | M5b | Judgement contract (ceiling, human approval for loosening, handle-citation validator JV1 to JV11) | 10, SEC-07 |
| C9 | M5b | Precedent contract with M6 (M6's types; counter-precedent requirement) | 10, 11 |
| C10 | M5b | Selective release with a validated error bound | 10, 9a, DEC-02 |
| C11 | M5b | Counterfactual evaluation of proposed rules and governed audit sampling | 10, DEC-06 |
| C12 | M5b | Autonomy ladder (AL0 to AL3) with anytime-valid promotion and automatic demotion | 10 |
| C13 | M5b | Approval item semantics: fail-closed rules, eligibility, segregation of duties (service owned by M13) | 10, 14a, DEC-04 |
| C14 | M5b | Bounded reflexion and the two critics | 10, 21 |
| C15 | M5a API, M5b rest | Decision record, derivation trace for M4, policy versioning and time travel | 10, 14 |
| C16 | M5b | Stage orchestration, budgets and failure semantics | 4, 21 F-BUDGET |

**Build order (corrected by the register's section 5, violations 4 and 9).** Bake-off 2 (C5) runs as soon as the 30-rule corpus is written, after the C1 types exist. At spec step 12 the order is M2 DI-01 and DI-08, **M5a**, M3, M4, M6, **M5b**; M9's V6 to V8 recompute lands with M5a. M13's case state machine and the exposure reservation API exist at step 11b so M5b runs against a real ledger; M5b's tests use an in-memory fake approval service until M13's service exists at step 14, and run the same conformance suite (T-APQ) against both.

## 3. Reference register (shared by all components)

Verification dates are 2026-10-13. "gh" means `gh api repos/OWNER/NAME` was run for this blueprint; "09 §x" means the metadata was verified in `prior-art/09` on the same date and not repeated. No third-party code was run or installed.

| Tag | What | Metadata and what we saw | What its evaluation does not show |
|---|---|---|---|
| Cedar | [`cedar-policy/cedar`](https://github.com/cedar-policy/cedar) (gh: 1780 stars, Apache-2.0, pushed 2026-10-09); [`cedar-policy/cedar-spec`](https://github.com/cedar-policy/cedar-spec) (gh: 213, Apache-2.0, pushed 2026-10-13); papers arXiv [2403.04651](https://arxiv.org/abs/2403.04651), [2407.01688](https://arxiv.org/abs/2407.01688) (09 §2.1) | Read: `cedar-lean/Cedar/Spec/Authorizer.lean` `isAuthorized`: `allow` iff no satisfied forbid and some satisfied permit; a policy counts as satisfied only when its evaluation is `.ok true`; a policy whose evaluation errors is neither satisfied nor a forbid and is only listed in `erroringPolicies`. `cedar-policy-core/src/extensions` lists `datetime.rs`, `decimal.rs`, `ipaddr.rs`; `cedar-lean/Cedar/Spec/Ext/Datetime.lean` defines datetimes as milliseconds with date, UTC and offset string forms; `cedar-lean/Cedar/SymCC/ExtFun.lean` contains datetime, decimal and ipaddr terms. | Cedar has no cumulative state, obligations, trust levels or reason codes; whether SymCC supports every construct we would emit is NOT VERIFIED; the cvc5 and Lean toolchain on Windows is NOT VERIFIED. |
| OPA | [`open-policy-agent/opa`](https://github.com/open-policy-agent/opa) (gh: 12359, Apache-2.0, pushed 2026-10-13); `npm-opa-wasm` (09 §2.3); [`microsoft/regorus`](https://github.com/microsoft/regorus) (gh: 357 stars, licence NOASSERTION, pushed 2026-10-12; code not read, licence UNVERIFIED) | No first-party SMT analysis found (09 §2.3). | Not examined beyond 09. |
| Z3 and cvc5 | [`Z3Prover/z3`](https://github.com/Z3Prover/z3) (gh: 12777, NOASSERTION; `LICENSE.txt` is MIT per 09 §2.2); npm `z3-solver` 5.2.0 MIT (09); [`cvc5/cvc5`](https://github.com/cvc5/cvc5) (gh: 1370, NOASSERTION, modified BSD per 09); Alethe (arXiv [2107.02354](https://arxiv.org/abs/2107.02354)) and Carcara checker (09 §2.2) | `z3-solver` runs as WASM with SharedArrayBuffer and needs `killThreads` for Node to exit (09 §2.2). cvc5 has no first-party JS build (09). | WASM speed on our rule sizes, Alethe coverage of our theory fragment, proof-object checking: NOT VERIFIED. |
| Progent | arXiv [2504.11703](https://arxiv.org/abs/2504.11703) (v3 2026-05-14); [`sunblaze-ucb/progent`](https://github.com/sunblaze-ucb/progent) (gh: 53, MIT, pushed 2026-09-24) | Abstract (09 §3.5): an SMT solver decides whether an LLM-proposed policy update only narrows privileges (applied) or widens them (needs approval). Repository code not read. | Governs tool calls, not numeric decisions; evaluation is attack success versus utility. |
| Runtime governance | AgentSpec arXiv [2503.18666](https://arxiv.org/abs/2503.18666); Policies on Paths [2603.16586](https://arxiv.org/abs/2603.16586); AgenticRei [2606.19464](https://arxiv.org/abs/2606.19464) (obligations, dispensations, meta-policy precedence); AgentBound [2606.30970](https://arxiv.org/abs/2606.30970) (signed governance receipts) (09 §3) | Abstract level only. | No quantitative comparison with Cedar or Rego for business decisions. |
| Defaults and combining | Catala [`CatalaLang/catala`](https://github.com/CatalaLang/catala) (gh: 2417, Apache-2.0, pushed 2026-10-12; README states default logic is a first-class feature; paper arXiv [2103.03198](https://arxiv.org/abs/2103.03198), only the abstract fetched, default-calculus details NOT read); XACML 3.0 combining algorithms (OASIS spec page fetched: deny-overrides, permit-overrides, first-applicable, only-one-applicable, deny-unless-permit, permit-unless-deny); decision-table hit policies (Camunda DMN docs fetched: UNIQUE, ANY, FIRST, RULE ORDER, COLLECT) | Vocabulary for precedence. | The OMG DMN specification itself was too large to fetch; Camunda's page is a vendor description. |
| LTT and selective risk | Learn-then-Test arXiv [2110.01052](https://arxiv.org/abs/2110.01052) and [`aangelopoulos/ltt`](https://github.com/aangelopoulos/ltt) (gh: 74, MIT, last push 2024-11-17); Conformal Risk Control [2208.02814](https://arxiv.org/abs/2208.02814); Geifman and El-Yaniv, Selective Classification for Deep Neural Networks, arXiv [1705.08500](https://arxiv.org/abs/1705.08500) (abstract fetched: user-specified risk level with high probability by rejecting uncertain instances; the SGR algorithm's guarantee is not in the abstract); Gurram, Valid Per-Field Selective Risk Control for Document Extraction, arXiv [2608.14639](https://arxiv.org/abs/2608.14639) (single-author preprint, 2026-07-28, abstract fetched: three failure modes are document clustering with design effect 1.84 to 2.45, score-refit leakage and tie-mass pathology; Learn-then-Test with exact binomial tails gives accepted-set risk certificates); KnowNo [2307.01928](https://arxiv.org/abs/2307.01928); Gibbs et al. [2305.12616](https://arxiv.org/abs/2305.12616); Barber et al. [2202.13415](https://arxiv.org/abs/2202.13415); Conformal Decision Theory [2310.05921](https://arxiv.org/abs/2310.05921) (09 §4) | We reuse the failure-mode list as a test list. | Author-reported on their data; none is an agentic payment decision. |
| OPE | Dudik et al. [1503.02834](https://arxiv.org/abs/1503.02834); Thomas et al. AAAI 2015; Karampatziakis et al. [2102.09540](https://arxiv.org/abs/2102.09540); Waudby-Smith et al. "Anytime-valid off-policy inference for contextual bandits" [2210.10768](https://arxiv.org/abs/2210.10768) (abstract fetched: unknown propensities and adaptive logging); Kallus and Zhou [1805.08593](https://arxiv.org/abs/1805.08593); Lakkaraju et al. (selective labels); [`st-tech/zr-obp`](https://github.com/st-tech/zr-obp) (gh: 713, Apache-2.0, last push 2024-06-03) (09 §5) | Estimators are a few lines; we write them and differential-test against OBP vectors computed once offline. | Positivity fails under deterministic logging (09 §11.6). |
| Anytime-valid | Howard et al., Time-uniform, nonparametric, nonasymptotic confidence sequences, arXiv [1810.08240](https://arxiv.org/abs/1810.08240) (Annals of Statistics 2021, fetched); Waudby-Smith and Ramdas, Estimating means of bounded random variables by betting, arXiv [2010.09686](https://arxiv.org/abs/2010.09686) (fetched); [`gostevehoward/confseq`](https://github.com/gostevehoward/confseq) (gh: 86, MIT, pushed 2026-01-07; code not read) | Ville-inequality confidence sequences. | Widths are larger than fixed-sample intervals; we measured the cost for Bernoulli streams (C12). |
| Separation of duties | Workflow satisfiability: Crampton and Gutin arXiv [1301.3402](https://arxiv.org/abs/1301.3402); Karapetyan et al. [1412.7834](https://arxiv.org/abs/1412.7834) (titles and summaries fetched through the arXiv API, papers not read); [`makerchecker/MakerChecker`](https://github.com/makerchecker/MakerChecker) (AGPL-3.0, idea only, 09 §3.10) | Naming for I5. | Policy-level only; whether two roles are two people is outside any of them. |
| Local clones read | `research/track-3-reasoning-architecture/reflexion/alfworld_runs/{main.py, generate_reflections.py (update_memory), alfworld_trial.py}`; `.../tree-of-thought-llm/src/tot/methods/bfs.py (solve)`; plus the readings recorded in `prior-art/05` for mem0 (`scoring.py`, `main.py`), Generative Agents (`reflect.py`, `retrieve.py`), LangMem | Reflexion: `update_memory` runs only for environments neither successful nor skipped, appends a reflection to an unbounded list, and the next trial reads `memory[-3:]`; trials are bounded by `--num_trials` (`main.py`). ToT: `solve` loops `task.steps` levels of generate, evaluate (`vote` or `value`) and select (`sample` or `greedy`) with `infos` logging every candidate and value. | Both rely on an oracle success signal (`won`, gold answer) that our decision stage does not have. |
| Policy drafting by models | AutoCedar [2607.03656](https://arxiv.org/abs/2607.03656); Autoformalization of Agent Instructions [2606.26649](https://arxiv.org/abs/2606.26649); ARc [2511.09008](https://arxiv.org/abs/2511.09008) (09 §3.11) | Verification is against a specification someone wrote. | None shows the specification is right. |
| Precedent | CBR-RAG [2404.04302](https://arxiv.org/abs/2404.04302); Memento [2508.16153](https://arxiv.org/abs/2508.16153); `prior-art/11` §10.3 contribution A (the precedent record and the counter query) | Vocabulary: Retrieve, Reuse, Revise, Retain. | Legal QA and research-agent benchmarks; no rule-version validity. |
| ADR | MADR template sections (09 §7; GitHub licence reported NOASSERTION) | Section names only. | n/a |

The named rejections from `prior-art/09` §14 stand and are not repeated.

---

# C1. Policy IR and TypeScript interpreter

**3. Best references.** Cedar (forbid overrides, default deny, determining policies, datetime and decimal extensions) for the evaluation semantics and the idea of verification-guided development; XACML combining algorithms and DMN hit policies for the precedence vocabulary; AgenticRei for obligations, dispensations and meta-policy precedence; AgentSpec for the `trigger / predicate / enforce` decomposition (09 §3.1); Catala for default logic as a first-class precedence mechanism.

**4. What they actually do.** Cedar's `isAuthorized` (read in `Authorizer.lean`) is a three-line function over sets of satisfied policies; its safety comes from that smallness plus a Lean model and differential testing ([2407.01688](https://arxiv.org/abs/2407.01688), abstract level). XACML deny-overrides returns Deny if any rule denies regardless of the others (spec text fetched). DMN single-hit policies differ in whether overlap is an error (UNIQUE), allowed only if outputs agree (ANY) or resolved by order (FIRST) (Camunda page). Catala's README says defaults and exceptions are first-class; the mechanism was not read.

**5. Decision. Own, provisional pending bake-off 2 (C5).** The IR is ours because five properties are required together and no candidate is known to supply them: (a) obligations with identity constraints and waivers, (b) permission-gated reads (`needs: ActionClass`, decided by M8's permission matrix) so that "untrusted content can only add holds" is a property of the evaluator, (c) a cumulative-state declaration with an inductive invariant, (d) reason codes and fact ids on every firing, (e) a data form small enough for a second implementation in the offline verifier's recompute module (spec section 13); under INT-050 (e) is a gating criterion in bake-off 2, not a tie-breaker (C5). Alternative rejected: Cedar WASM as the engine, because its authorizer cannot express (a) to (d) without moving logic into host code, and an erroring policy silently drops out (`erroringPolicies`), which for a forbid is the unsafe direction. Cedar remains a CI cross-check on the stateless fragment (C4).

**6. Implementation design.**

*Value domain.* Integers are mathematical integers (`bigint` in the interpreter, decimal strings in hashed JSON; no floats anywhere, matching the JCS profile). Money is minor units, dates are UTC day numbers (`int`, days since 1970-01-01), ratios are expressed as integers in parts per million or by the `ratio` atom. Enumerations are closed string sets. Strings are never compared in the IR: names and addresses become identifiers or enum classes upstream (M3 link judgements), so fuzzy similarity is not in the verified surface.

```ts
// No numeric trust level exists in M5 (INT-014): collapsing SOR and VERIFIED, or EXTRACTED and UNTRUSTED, would hide the permission matrix.
interface FieldLabel { trust: TrustLevel; authorship: Authorship; producer: Producer; writeOrigin?: WriteOrigin }   // exactly the coordinates M8's `permitsClass` reads; M5 adds none
interface ViewEntry { status: CellStatus; value?: Json /* only when resolved */; label?: FieldLabel; factIds: Id<"fa">[] }   // status keeps all five values; `silent` is never folded into `not_checked`
type FieldKind =
  | { k: "int"; lo: bigint; hi: bigint; unit: "minor" | "day" | "ppm" | "count" }
  | { k: "bool" } | { k: "enum"; values: readonly string[] }
  | { k: "set"; universe: readonly string[] };            // finite sets only, encoded as one bool per member
interface FieldDecl { name: string; kind: FieldKind; feature: FeatureId; correctable: boolean /* for the flip panel */ }
type Term = { t: "f"; name: string } | { t: "c"; v: bigint } | { t: "param"; name: string }
          | { t: "lin"; terms: readonly [bigint, Term][]; k: bigint };       // literal coefficients only: linear integer arithmetic
type Expr =
  | { t: "cmp"; op: "<" | "<=" | "==" | ">=" | ">"; l: Term; r: Term }
  | { t: "in"; l: Term; values: readonly (string | bigint)[] }              // enum or integer membership; pinned parameter sets expand here
  | { t: "has"; set: string; elem: string }
  | { t: "ratio"; num: Term; den: Term; op: "<" | "<=" | ">=" | ">"; p: bigint; q: bigint } // den > 0 and num*q op p*den, linear
  | { t: "within"; date: Term; asOf: Term; days: Term }                    // date <= asOf and asOf - date <= days
  | { t: "status"; f: string; in: readonly CellStatus[] }                   // reads status only; distinguishes resolved, unresolved, silent, not_checked, unavailable
  | { t: "permits"; f: string; class: ActionClass }                        // status is `resolved` and the matrix permits `class` for the field's label
  | { t: "and" | "or"; args: readonly Expr[] } | { t: "not"; arg: Expr };
type Action = "release" | "release_with_approval" | "escalate" | "hold" | "reject";   // permissiveness order, most to least; the order itself is `PolicyBundle.actionOrder` (data)
type Effect =
  | { k: "forbid"; actions: readonly ("release" | "release_with_approval" | "escalate")[] }  // hold and reject can never be forbidden
  | { k: "permit"; action: "release" | "release_with_approval" }
  | { k: "recommend"; action: Action }
  | { k: "require"; obligation: string }
  | { k: "cap_autonomy"; actions: readonly Action[]; level: AutonomyLevel }   // AL0 to AL3
  | { k: "explorable"; action: Action };                                   // C11, only inside the allowed set
interface Rule { id: string; layer: "veto" | "permit" | "recommend" | "obligation" | "autonomy" | "explore";
  when: Expr; needs?: readonly { f: string; class: ActionClass }[];   // required on permit, and on recommend or explorable toward release actions: every entry must satisfy `permits`
  effect: Effect; priority?: number;                 // recommend only
  reason: { code: string; template: string; slots: readonly string[] };     // text is data, slots are field names
  source: "regulation" | "company" | "team"; }
type Obligation =
  | { id: string; kind: "approval"; role: string; distinctFrom: readonly ("requester"|"vendor_editor"|"proposer"|"rule_author")[]; appliesTo: readonly Action[]; waivable: boolean }
  | { id: string; kind: "attestation"; channel: string; appliesTo: readonly Action[]; waivable: false }
  | { id: string; kind: "post"; action: string; withinHours: number; appliesTo: readonly Action[]; waivable: boolean }
  | { id: string; kind: "open_evidence"; items: number; appliesTo: readonly Action[]; waivable: false };
interface StateDecl { id: string; feature: FeatureId; transition: "adds_amount_on_release_actions"; bound: { param: string } }  // C6/I6
interface PolicyBundle { schema: FieldDecl[]; params: Record<string, bigint | readonly string[]>; rules: Rule[]; obligations: Obligation[]; states: StateDecl[];
  featureSpecHash: Hash; matrixHash: DocHash /* M8 permission-matrix.json; the verifier loads the same file from the proof bundle */;
  actionOrder: readonly Action[] /* total order, most to least permissive */; version: string; parent?: Hash; pack: string }
```

*Evaluation (the normative semantics; one page, with golden vectors, is the specification the verifier's second implementation is built from).* `evaluate(bundle, view) -> PolicyVerdict` is `pure`; `view: Record<string, ViewEntry>`. (The type is `PolicyVerdict` because the shared `Verdict` is the offline verifier's PASS/FAIL result, INT-001.)

1. Atom reading. Comparison, membership, ratio and window atoms read a field's value only when its `status` is `resolved`; over any other status they are false, and the author states absence explicitly with `status` atoms. A permit rule's condition, and that of a recommend or explorable rule whose action is a release action, reads only fields named in its `needs`, and the rule fires only if, for every `needs` entry, `permitsClass(label, class)` holds: the interpreter looks the field's label up in the pinned matrix (M8's pure function over `permission-matrix.json`, hash in the bundle). The `permits` booleans that `featurize` materialises in the view are a display cache; the interpreter recomputes them and `T-IR-10` asserts equality. All other conditions (veto, other recommend, obligation, autonomy, other explore) read any resolved field whatever its label and may use `permits` and `status` atoms. This is the evaluator form of "untrusted input can add holds and checks, never permission". A counterparty-authored, self-declared `VERIFIED` registry field therefore satisfies a `satisfy_manifest_item` need only where the matrix row allows it (INT-014).
2. `F` = union of the `actions` of firing veto rules. `P` = set of actions of firing permit rules.
3. `A = ({escalate, hold, reject} ∪ P) \ F`. Because `hold` and `reject` cannot appear in a forbid (a static check), `A` always contains them; release is default-deny, so the absence of a required document-derived fact (any status other than `resolved`, including `silent`) is a hold, not a no-op (spec section 5).
4. `r0` = action of the firing recommend rule of highest `priority` (equal-priority conflicts are excluded by a static check and by I3), `escalate` if none fires; `r` = the most permissive member of `A` that is not more permissive than `r0`, in `actionOrder`. `r` is the rule engine's recommendation and the ceiling of C8.
5. `required[a]` for each `a ∈ A` = obligations attached by firing `require` rules whose `appliesTo` contains `a`, minus waivable obligations for which a valid dispensation field is `resolved` and permits `satisfy_manifest_item` (a dispensation is data: a signed, scoped, expiring approval produced by M13's approval service; the interpreter only reads the boolean).
6. `maxAutonomy[a]` = minimum of `AL3`, the pack's static cap for `a` (release actions are capped at `AL2` by a regulation-source rule) and every firing `cap_autonomy`.
7. `fired` = ids of every rule whose condition held, in rule order; `why[]` = one `Why{kind:"rule"}` per fired rule with slots filled from the view.

*Precedence, stated once.* (i) Layers are ordered and fixed: veto, then permit, then recommend; obligations and autonomy caps accumulate monotonically. (ii) Inside a layer rules commute (set semantics), except recommend, which is resolved by explicit integer priority. (iii) Exceptions are expressed in conditions, never as overrides of a veto: Catala-style exception chains over vetoes would break I2, so we take only the idea of priority for recommend rules. (iv) A `PolicyStack` (regulation, company, team) is evaluated per layer and combined by meet: `A = ∩ A_i`, `required = ∪`, `maxAutonomy = min`, `r = most permissive element of A not above min_i r_i`. A lower layer cannot loosen a higher one by construction; I9 tests it.

*Static checks (`check(bundle)`, run at load and in the gate).* Types and field existence; enum membership; every param defined; unique rule ids; no `hold`/`reject` in forbids; every permit, and every recommend or explorable rule toward a release action, reads only fields in its own `needs` (the lint that makes I7 provable); every `needs` class is refused by the matrix for `UNTRUSTED` (so `add_restriction` and `show_to_human` are rejected as needs) and is permitted for the field's declared label ceiling, else the rule could never fire (`NEEDS_UNSATISFIABLE`, which also keeps document-derived restrict-only features out of permits); `actionOrder` equals the fixed total order `release ≻ release_with_approval ≻ escalate ≻ hold ≻ reject`; `matrixHash` equals the locked matrix; every `require` names a declared obligation; dispensations only reference `waivable: true` obligations; recommend priorities unique per overlapping region (checked by C3/C4, not syntactically); every rule has a reason code and template; term size and rule count bounded; no recursion by construction (the AST has no calls). A bundle that fails any check is not loadable.

*Serialisation.* The AST is canonical JSON under the Plumbline JCS profile, domain-separated hash `sha256("plumbline.policy.v1" || jcs(bundle))`, schema as JSON Schema with golden-hash tests (D-011). The authoring surface is a typed TypeScript builder that emits the AST, plus a deterministic pretty-printer for review diffs and ADRs; the parser accepts only AST JSON, so a model-drafted rule can only arrive as validated data, never as code (AutoCedar pattern, 09 §3.11).

*Interpreter.* Tree-walking, no I/O, no clock (the `asOf` is a view field), no randomness, `bigint` throughout; estimated size 400 to 600 lines, which is what makes a second implementation and exhaustive enumeration practical. Memoises atoms per evaluation. Emits the `Derivation` (C15) when asked, at the cost of an allocation per node; the production path evaluates without it and the record stores the derivation hash computed by re-running with tracing (deterministic, so the two agree; tested).

*Expressiveness table (each row is a pack test).*

| Need | Construct | Decidable fragment |
|---|---|---|
| Date windows ("bank details changed within 30 days of release") | day-number fields, `lin`, `within` | linear integer arithmetic |
| Ratios ("sanctioned ownership share above 25 percent", "invoice over 80 percent of PO") | `ratio` atom by cross-multiplication with literal p, q | linear integer arithmetic |
| Set membership (jurisdiction lists, role sets) | `in` over pinned param sets (hash-pinned, expanded at load); `has` on set fields | finite |
| Cumulative exposure | `StateDecl` + feature program `rolling_sum` (C2) + I6 | one-step induction in linear integer arithmetic |
| Obligations | `require` + `Obligation` | n/a (data) |
| Dispensations | `waivable` + dispensation field | n/a |
| Precedence | layers, priorities, stack meet | n/a |
| Permission-gated reads | `needs: ActionClass`, `permits`, `status`, matrix rows | finite (matrix rows times statuses) |
| Identity constraints | principal-valued fields (enum of actor slots) and `distinctFrom` | equality logic, small-model property |

*Concurrency and determinism.* Evaluation is a pure function of `(bundle, view)`; the same pair always yields the same verdict and derivation hash. Cases are independent; the only shared mutable thing is the exposure ledger, handled by compare-and-set reservation (C6/I6).

**7. Tests and acceptance.** `T-IR-01` golden vectors (hand-written, 60 or more, one per semantic clause, shared with the verifier's second implementation). `T-IR-02` property: determinism and order independence (shuffling rule order inside a layer leaves the verdict unchanged except recommend priority ties, which are rejected). `T-IR-03` property: `hold` and `reject` always in `A`; `r ∈ A`. `T-IR-04` stack meet. `T-IR-05` static-check negatives (each lint has a bundle that must be refused). `T-IR-06` canonical-hash stability across Node versions and key orders. `T-IR-07` pack expressiveness: the 30-rule corpus of C5 loads and every rule passes its truth-table unit test. `T-IR-08` inert controls: an interpreter that always returns `release` must fail T-IR-01 and C3/C6 suites. `T-IR-09` `actionOrder` is a total order, equals the shared type's order, and is the order the verifier's second implementation uses. `T-IR-10` the view's `permits` cache equals `permitsClass` recomputed from labels, and an interpreter that trusts the cache fails a forged-cache vector. `T-IR-11` the P0 regression: a counterparty-authored `VERIFIED` field never satisfies a `satisfy_manifest_item` need unless the matrix row says so, in the interpreter, in C3's enumeration and in the verifier's second implementation. Metric: interpreter lines (non-test), evaluation latency p50/p99 on 10^6 cases, derivation overhead. Disproved if a rule from the pack's real policy documents cannot be expressed without host code.

**8. Risks and NOT VERIFIED.** The `status` semantics for non-resolved fields are our choice and make authors responsible for stating absence rules; the lint plus I7 is the guard, and whether authors can work with it is a usability hypothesis. The stack meet assumes jurisdictions only restrict; a jurisdiction that legally requires a more permissive action than a company rule is not expressible and is a pack question for the LAWYER item. Bake-off 2 may replace the IR (DEC-05): until then all text says "the encoded rules".

**9. Build notes.** M5a. Types, checker, interpreter, golden vectors first (unblocks C3, C4, C7). Pretty-printer next (needed by ADRs). Stack meet last. Unblocks M4's `evaluate` use (phase 2 of V(S)) and the verifier's recompute module. Needs M8's `permitsClass` and `permission-matrix.json` first; until M8 ships them the tests use a copy of the matrix pinned by hash.

---

# C2. Feature programs: derived-feature functions and conformance tests

**3. Best references.** DEC-01 and DEC-03 in the adversarial review (the requirement); Cedar's separation of a verified core from extension types (`decimal`, `datetime`, `ipaddr` as typed functions with their own specification, read in the Lean tree); Runtime Governance ([2603.16586](https://arxiv.org/abs/2603.16586)) for policies as functions of partial path and organisational state, which is what exposure windows are; `prior-art/15` §6 gold-set requirements 4 and 7 (split-invoice windows, collusion) for the cases the features must support.

**4. What they actually do.** Cedar keeps arithmetic on typed values and pushes domain logic (IP ranges, decimals) into named extension functions, each specified separately in Lean and in `ExtFun.lean` for SymCC; the evaluator itself does not know calendar logic. Runtime Governance defines the state a policy may read but does not specify how aggregates are computed.

**5. Decision. Own, and widen the verified surface by making features data.** The spec allowed two choices: put derived features inside the verified surface with conformance tests, or treat them as `SOR` inputs. The first leaves arbitrary TypeScript beside the proofs; the second makes the proofs about an input table. We do a third thing: a **`FeatureProgram`** is a small declarative expression over typed fact rows, interpreted by the runtime and, independently, by the verifier's recompute module, so the recorded `view` can be recomputed from the recorded facts offline. Anything that cannot be written as a feature program (a vendor-master change-history walk with bespoke rules, a model score) must be declared `trusted_input` with a named owner; it appears in the dossier's "outside the verified surface" list. Rejected: arbitrary host-language feature functions, because no second implementation could be derived from them.

**6. Implementation design.**

```ts
type RowSet = "ledger.releases" | "ledger.reservations" | "vendor.master.changes" | "approvals.history" | "snapshot.cells";
type FExpr =
  | { f: "cell"; attribute: string }                        // value, five-valued status and label from the frozen M3 cell (C16 step 1)
  | { f: "const"; v: bigint } | { f: "asOf" }
  | { f: "daysBetween"; later: FExpr; earlier: FExpr }
  | { f: "add" | "sub" | "min" | "max"; args: FExpr[] } | { f: "mulLit"; k: bigint; arg: FExpr }
  | { f: "sumWhere"; rows: RowSet; value: string; where: FPred; window?: { endsAt: FExpr; days: FExpr } } // window (endsAt - days, endsAt] in UTC days
  | { f: "countWhere" | "existsWhere"; rows: RowSet; where: FPred; window?: { endsAt: FExpr; days: FExpr } }
  | { f: "bucket"; arg: FExpr; thresholds: bigint[]; labels: string[] }       // banding for enumeration
  | { f: "samePrincipal"; a: FExpr; b: FExpr } | { f: "setOverlap"; a: FExpr; b: FExpr } | { f: "memberOfPinned"; arg: FExpr; set: string };
interface FeatureSpec { id: FeatureId; version: string; program: FExpr | { trusted_input: { owner: string; reason: string } };
  out: FieldKind; label: "meet_of_inputs" | "policy_constant"; ceiling: FieldLabel /* declared upper bound, used by the `NEEDS_UNSATISFIABLE` lint */;
  missingRestricts: boolean /* I7(b): a missing or unknown value can only hold */; onOutOfRange: "hold"; factSelectors: string[] }
```

*Semantics fixed in the spec of each operator (the source of most real bugs):* the window is the half-open day interval `(endsAt - days, endsAt]`; day numbers are UTC; no business-day or timezone arithmetic exists in the language (a pack that needs it supplies it as dated rows); sums are over distinct row ids; a row whose `value` is negative is an input error, not a credit; an empty set sums to zero and the *status* of that zero is derived from the row source's completeness assertion (an unqueried ledger is `not_checked`, so exposure is `not_checked`, so release is not permitted: the hold-on-missing rule applies to aggregates too). Output label: `trust` is the meet (`combine`, spec section 5) over the facts read, taken from each fact's `supports` only (a defeated assertion is not read, INT-013), `authorship` is `counterparty` if any input is, producer is `derive`, never above `PRODUCER_CEILING.derive`; a feature cannot raise trust or acquire a permission its inputs lack, and pack parameters carry `policy_constant`. Output range is checked on every evaluation; out of range yields status `unavailable` and the code `FEATURE_RANGE`, so a buggy feature fails closed.

*Pack feature catalogue (procurement), each with unit, boundary convention and oracle:*

| Feature | Definition | Oracle |
|---|---|---|
| `bank.days_since_change` | `daysBetween(asOf, latest master change date where field = bank)` | naive loop |
| `bank.changed_by_requester` | `samePrincipal(latest change actor, requester)` | table test |
| `exposure.rolling` | `sumWhere(releases ∪ reservations, amount, group = vendorGroup, window(asOf, W))` | naive O(n^2) and a SQL window query run in test tooling only |
| `exposure.reserved` | reservations not yet executed or released | ledger replay |
| `invoice.split_signal` | `countWhere(releases, amount in [lo, hi], group, window)` | table test |
| `owner.sanctioned_share_ppm` | sum of ownership ppm over linked owners whose sanctions status is hit (M3 provides the ownership edges; aggregation across owners is a pack parameter) | recompute from edges |
| `list.age_days` | `daysBetween(asOf, sanctions list publish date)` | table test |
| `doc.cert_days_left` | `daysBetween(cert expiry, asOf)`, absent when the field is missing | table test |
| `identity.stability` | enum from M3 `stable / identity_dependent` | passthrough |
| `actors.alias_suspected` | `samePrincipal` over IdP subject, session and device bindings (C13) | table test |
| `vendor.group` | M3 cluster id extended by shared bank account (a link judgement, never a fuzzy score) | recompute |
| `actors.vendor_master_editor` | IdP subject from the `editor_sub` column of the last vendor-master write (INT-024; absent column gives status `not_checked`, field `UNTRUSTED`) | table test |
| `release.amount_ceiling` | `min(invoice amount, PO remaining)`, both `SOR`; the pack's release rules veto an amount above it (INT-024; the payable amount is vendor-authored upstream) | table test |

*Feature registry additions (INT-015).* Six inputs that other modules produce become typed registry features. Each is declared with a `ceiling`, so its permission limits are static, and with the property that a missing or unknown value can only hold; each has a conformance test (`T-FE-10`: absent, unknown and adversarial values never enlarge `A ∩ R`, shrink `required`, or raise `aut`).

| Feature | Source and type | How it may act |
|---|---|---|
| `doc.risk.<code>` | M2 `DocRisk` and `DocFinding`, severity through the severity map M2 and M5 share (enum `info`, `warn`, `high`) | feeds `escalate`, never `reject`; ceiling `EXTRACTED`, so by the matrix it can never be a `needs`; "no findings" is never clearance |
| `doc.complete.<docType>` | M2 `DocCompleteness` (enum `complete`, `partial`, `unknown`) | incomplete or unknown adds an escalate or check; ceiling `EXTRACTED` |
| `manifest.<item>.status` | M8 C6 `evaluateManifest`, one `ItemState` per item (`satisfied`, `missing`, `stale`, `conflict`, `untrusted_only`, `incomplete_schema`, `extractor_disagreement`, `not_checked`, `unavailable`) | release actions need `satisfied` through `satisfy_manifest_item`; any other state is a hold with its own reason code |
| `claim.<id>.canPermit` | M4 `ClaimLedgerView` chain flag (bool); an `UNTRUSTED` label chain cannot permit | missing is false |
| `overlay.releaseBlock` | M13 case overlay (bool), plus `frozen` and `legalHold` | true vetoes release actions; missing is treated as true |
| `target.reversible` | M13 `TargetManifest.reversal` (`void_before_cutoff`, `return_request`, `none`) for the action class | `none` or missing caps the action class at `AL2` by rule; release actions are capped at `AL2` by the pack's regulation rule regardless, so this feature can only restrict; reversibility comes from the manifest, never from a model |
| `exposure.rows` (already named) | M13 ledger view: releases and approved-unexecuted reservations with `ledgerSeq` | feeds `exposure.rolling` and `exposure.reserved` |

*Conformance tests per feature (`T-FE-*`).* Golden boundary vectors (window edges at `days - 1, days, days + 1`; leap days; month ends); metamorphic relations (shifting every date and `asOf` by k leaves day differences unchanged; permuting rows leaves sums unchanged; adding a zero-amount row leaves the sum unchanged; enlarging the window never decreases a sum; removing a fact never raises an output trust or adds a permitted class); differential against the second implementation in the verifier recompute module and against the SQL oracle; range-contract tests; a mutation suite (off-by-one at each boundary, inclusive versus exclusive, wrong group key, timezone shift) that must be caught; a taint-tracking test that no feature output has a trust above the meet of its inputs or permits a class that an input does not. Metric: mutation score, disagreement count between implementations (must be zero), feature lines.

**7. Tests and acceptance.** Above, plus `T-FE-09` the feature layer is regenerated from recorded facts in the bundle and equals the recorded `view` hash (this is verifier level V6a, added to the spec by INT-050). Disproved if the second implementation cannot be kept in agreement without sharing code.

**8. Risks and NOT VERIFIED.** Calendar semantics beyond UTC days are excluded, so a pack with local business-day windows must precompute them as rows; whether that loses fidelity for real AP rules is open. `owner.sanctioned_share_ppm` depends on M3 ownership edges and on a regime-specific aggregation rule that is NOT VERIFIED (`prior-art/15` §6 item 8). The SQL oracle needs `node:sqlite` in test tooling, whose stability on the pinned Node is NOT VERIFIED (bake-off 5).

**9. Build notes.** Operators and reference interpreter, then the catalogue, then the second implementation with the verifier, then the mutation suite. Unblocks C3 (feature outputs define the enumeration domain) and C6/I6.

---

# C3. Exhaustive cell-enumeration verifier against the shipped interpreter

**3. Best references.** `prior-art/09` §9.2 Check C (the idea, DERIVED there); Cedar's verification-guided development ([2407.01688](https://arxiv.org/abs/2407.01688): executable model plus differential testing, 25 bugs reported by the authors); boundary-value analysis and decision-table completeness checking as the testing tradition (not fetched; named for orientation, UNVERIFIED).

**4. What they actually do.** The Cedar team proves properties of a Lean model and ties the Rust code to it by random differential testing; the guarantee that the shipped code satisfies the property is statistical. Check C in `prior-art/09` instead runs the shipped function on a finite set of representative inputs chosen so that every distinct behaviour is visited; no solver is in the trusted base.

**5. Decision. Own (the primary evidence for invariants, per DEC-01).** The enumerator calls the real `evaluate` of C1 as its only oracle. It is evaluator-agnostic: if bake-off 2 adopted another engine, the enumerator would still run against that engine's `evaluate`, given an AST exported for critical-point extraction.

**6. Implementation design.**

*Domain model.* Each field contributes a set of abstract states `S(f)`: the four non-resolved statuses (`unresolved`, `silent`, `not_checked`, `unavailable`; statuses that no `status` atom of the bundle distinguishes are merged into one state) together with `{resolved} × Rows(f) × V(f)`. `Rows(f)` is the set of distinct label rows of the permission matrix restricted to the classes that the bundle names for `f` in `needs` or `permits` atoms (labels with the same permit vector over those classes are one row; this is the "enumeration domain over matrix rows" of INT-014). `V(f)`: an enum contributes its values; an int contributes `Reps(f) = {lo, hi} ∪ {c-1, c, c+1}` over every constant `c` that the field is compared with after parameter substitution; a bool `{0,1}`; a set field one bool per member.

*Completeness claim and its fragment.* For rules whose atoms are single-field comparisons with constants, membership, boolean tests, `status` and `permits` tests, the truth vector of all atoms is constant on each interval between consecutive critical constants, so one representative per interval (and the boundary points) visits every behaviour. This is exact and needs no solver. For atoms over two fields (`f op g`, `f + g op c`, `f - g op c`, unit coefficients, the UTVPI class, which covers `amount <= headroom`, `exposure + amount <= cap`, `later - earlier <= n`), the enumerator adds a **closure step**: for each such atom and each representative of one field, it adds the field value that makes the atom exactly true and the neighbours ±1. We state completeness for the single-field fragment and for UTVPI atoms as a claim **to be tested against Z3 (T-EN-03), not assumed**; ratio atoms with literal p, q are single-field cross-products of two fields and are handled as `f op g` scaled; any atom outside the fragment is listed in the certificate and the result is labelled `scope: partial` with those atoms named.

*Cone slicing.* A property names the verdict components it constrains (for I1: `release*` membership and obligations). The cone is the set of rules whose effects can change those components plus the features they read. Fields outside the cone are fixed at one representative, which is sound because the property's truth cannot depend on them. The certificate lists the cone.

*Search.* Tier E1: depth-first assignment of fields in a fixed order with **three-valued partial evaluation**: after each assignment, evaluate the property's verdict components with unassigned fields unknown; if the component is already determined (a veto fires definitively, a needed field's row does not permit its class, or its status is not `resolved`, so the permit cannot fire), the whole subtree is counted as covered and skipped. Leaves are checked with the production two-valued `evaluate`. Tier E2 (if E1 exceeds its budget on the hero bundle): hash-consed memoisation of the residual verdict function after each prefix, which is a multi-valued decision diagram of the verdict over the abstract domain; its builder is small but is a second piece of trusted code, so E2 results are cross-checked against E1 on every smaller bundle. Both tiers run in `worker_threads`, deterministic order, with a step budget; hitting it yields `completeness: partial`, never silence.

*Soundness of pruning.* Pruned subtrees rest on the three-valued evaluator. Two guards: (1) an audit sampler evaluates a seeded random 1 percent of pruned cells with the production `evaluate` and requires agreement with the pruning claim; (2) a mutation test breaks the three-valued evaluator and the audit must catch it.

*Cell count, honestly.* An earlier estimate (10 cone fields with 9 abstract states each, about 3.5e9) was made for the three-level domain and is superseded: the per-field state count is now the merged non-resolved statuses plus matrix rows times values, so it depends on the pack's matrix and is to be measured, not assumed. If it is of that order, a plain loop is too slow, which is why pruning is part of the design. We expect the three-valued pruning to cut the work by several orders of magnitude on the `needs`-gated permit rules because any needed field that is not `resolved` and permitted kills the permit immediately. **This expectation is NOT VERIFIED**; the first deliverable of the module is the measured node count on the 30-rule corpus.

*Output.* `EnumerationCertificate{ bundleHash, propertyId, coneFields, repsHash, cellsVirtual, cellsVisited, cellsPruned, auditSample{n, disagreements}, counterexamples[], scope: "complete" | "partial", unsupportedAtoms[], tool: version, interpreterHash }`. A counterexample is a concrete case that the production `evaluate` already violates; there is no "spurious counterexample" class. The verifier recompute module can re-run E1 from the certificate's reps with zero dependencies.

**7. Tests and acceptance.** `T-EN-01` planted violations: for each of the 30+ mutants of C7's mutation suite the enumerator must find a counterexample or the mutant must be proved equivalent by C4. `T-EN-02` inert stub: an enumerator that checks nothing must fail the planted-violation test. `T-EN-03` completeness cross-check: 5,000 random bundles in the fragment and random properties; whenever Z3 finds a counterexample the enumerator must find one (otherwise the closure is incomplete); disagreements are reported as enumerator defects. `T-EN-04` pruning audit and its mutation. `T-EN-05` determinism: same certificate bytes on repeated runs. `T-EN-06` cross-tier equality E1 versus E2. Metrics: visited cells, wall time, completeness rate on the corpus, number of properties that fall back to Z3 only. Disproved if the hero bundle cannot be covered within budget for I1 to I4 and I7, in which case the primary evidence for those invariants is Z3 and the claim is downgraded in 9a wording.

**8. Risks and NOT VERIFIED.** UTVPI completeness of the closure; the pruning ratio; worker-thread determinism for the certificate bytes; that exhaustive evidence on a bundle plus a feature-contract check really covers the shipped system (it covers `evaluate` given a view in range, nothing upstream).

**9. Build notes.** E1 on single-field bundles first; then closure; then cone slicing; then the audit; E2 only if needed. Unblocks C6 and the C7 gate, which uses the enumerator as the offline-checkable classification witness.

# C4. Z3 encoding and differential testing

**3. Best references.** Cedar SymCC (`cedar-policy-symcc`, a verified-in-Lean compiler from policies to SMT, with `check_implies`, equivalence, disjointness, never-errors and counterexample variants, 09 §2.1) as the model for the query set; Z3 and cvc5 as solvers; Alethe and Carcara for independent proof checking (coverage NOT VERIFIED, 09 §2.2); Progent (an SMT solver classifies a change as narrowing or widening); `prior-art/09` §9.1 (encoder trust by differential testing with a mutation test on the encoder).

**4. What they actually do.** SymCC compiles a Cedar policy set and schema to SMT terms and decides queries; its README states the compiler and verifiers are modelled and verified in Lean, and the VGD paper ties the Rust implementation to the Lean model by differential random testing (abstracts and README, 09). Progent uses the solver only for the narrowing-or-widening decision. Neither shows that an SMT answer about an encoding is a statement about the shipped TypeScript.

**5. Decision. Own the encoder; use Z3 as the primary solver and cvc5 and Cedar SymCC as independent second opinions; treat every answer as secondary to C3 unless C3 is `partial`.** Z3 because it runs in-process as WASM (09 §2.2); cvc5 native in CI on the same SMT-LIB text for solver diversity; SymCC for the stateless Cedar-expressible fragment. The solver tier is a test-time dependency; the judge-run core and the verifier core stay dependency-free.

**6. Implementation design.**

*Encoding.* Quantifier-free linear integer arithmetic with Booleans. Per field `f`: `v_f` (Int, bounded by the declared domain; Bool fields as Bool; enums as Int in `[0, n)`; set fields as one Bool per member), `st_f` (Int in `[0, 4]`, the five `CellStatus` values) and `row_f` (Int in `[0, nrows)`, the matrix rows of C3). Parameters are substituted as constants, and the permission matrix is substituted as constant tables. Division and modulo do not exist in the IR, so nothing else is needed.

```
perm_{f,k}            := nested ite over row_f against the matrix constants for class k
atom(cmp op l r)      := (and (= st_f RESOLVED) (op T(l) T(r)))    ; for each field f in l, r, whatever its row
atom(status f S)      := (or (= st_f s) for s in S)
atom(permits f k)     := (and (= st_f RESOLVED) perm_{f,k})
atom(ratio ..)        := (and (> T(den) 0) (op (* T(num) q) (* p T(den))))
fired_i               := cond_i                                    ; permit: (and needs_ok cond), needs_ok = atom(permits f k) per needs entry
F_a                   := (or fired_i for veto rules forbidding a)
allow_a               := (and (or D_a P_a) (not F_a))              ; D_a is true for escalate, hold, reject
r0                    := nested ite over recommend rules by descending priority, default escalate
r                     := nested ite from most permissive action: first a with allow_a and rank(a) <= rank(r0)
req_{a,o}             := (and (or fired_i for require rules attaching o to a) (not (and waivable_o disp_o_ok)))   ; disp_o_ok = atom(permits disp_o satisfy_manifest_item)
aut_a                 := nested ite computing the minimum of caps
```

*Query shape (I1 as the example).* `(assert (and allow_rwa (> amount CAP) (not req_rwa_cro)))`, expected `unsat`. `unsat` is recorded as "no violating case in the encoded domain"; `sat` yields a model.

*Counterexample handling.* A `sat` model is concretised to a `view`, replayed through the TypeScript `evaluate`, and the replay must reproduce the predicted violation. If it does not, the build fails with `ENCODER_FAULT` and the model is attached. A `sat` that replays is a real counterexample for the gate and the UI.

*Differential testing of the encoder (the trust argument).*
- D1, term level. The encoder first builds an in-house SMT term AST. A 150-line term evaluator runs that AST on every cell visited by C3 and compares every verdict component with `evaluate`. This exercises the translation exhaustively without involving Z3 and leaves Z3 as the only additional trusted component.
- D2, solver semantics. 20,000 random cases and every cell of the small bundles are pinned into Z3 by asserting all field variables; the model's verdict variables must equal `evaluate`.
- D3, rule-set fuzzing. A generator of random well-formed bundles (bounded size) feeds D1 and D2.
- D4, encoder mutation. At least 25 mutants of the encoder (flip a comparator, drop a `needs` condition, swap priority order, forget the waiver clause, wrong ratio scale, enum off-by-one, wrong matrix row or class, `silent` folded into `not_checked`) must each be killed by D1 or D2; equivalent mutants are listed with their reason.
- D5, replay of every counterexample (above).
- D6, solver diversity. The same SMT-LIB text goes to cvc5 (native, CI only); verdicts must agree; disagreement fails the build.
- D7, Cedar SymCC cross-check on the stateless fragment (I1, I2, I3 membership parts, I7 for the release actions). The compiler maps view fields to context attributes (Long, Bool, strings for enums, Long for status and for the matrix row), permits and vetoes to `permit` and `forbid`, and obligations to distinct actions or context flags. Properties are asked through `check_implies` or disjointness; verdicts must agree with Z3. This needs Docker or WSL for cvc5 and Lean; availability on the development machine is NOT VERIFIED.
- Proof objects. For the headline invariants, optionally ask cvc5 for an Alethe proof and check it with Carcara; if it works it is the only independently checkable `unsat`; if not, `unsat` remains "solver said so".

*Proof bundle (`proofs/<bundleHash>/`).* `manifest.json` (solver names and versions, query ids, results, scope strings, interpreter hash, bundle hash), one `.smt2` per query, `enumeration/*.cert.json` from C3, `cvc5/*.result.json`, `cedar/*.result.json`. The verifier recompute module re-runs the enumeration certificates; a Z3 level is checked only when a solver is present, otherwise that level is INDETERMINATE, never PASS.

*Operational.* z3-solver needs `SharedArrayBuffer` and an explicit thread shutdown (09 §2.2); the proof run is a separate Node process with a hard wall clock per query (60 s, then `unknown`, which counts as not proved). Incremental `push/pop` per property.

**7. Tests and acceptance.** D1 to D7 above with: zero disagreements on 10^6 D1 cells and 20,000 D2 cases; mutation score 100 percent on non-equivalent encoder mutants; counterexample replay rate 100 percent; solver agreement on every query. `T-SMT-08` inert solver: a stub that always answers `unsat` must make the planted-violation suite fail. Metrics: queries per second, memory, install size of `z3-solver`, time to prove I1 to I9 on the 30-rule bundle. Disproved if D1 or D2 finds a disagreement that survives review (then the encoder is wrong, and every earlier `unsat` is void), or if proving I1 to I9 on the corpus exceeds the CI budget.

**8. Risks and NOT VERIFIED.** WASM speed and memory on our bundle size; cvc5 and Lean toolchain availability on Windows; Alethe coverage; SymCC coverage of every Cedar construct we would emit; that `unsat` from Z3 is correct (solver bugs exist; D6 and C3 are the mitigations, not a proof).

**9. Build notes.** Term AST and evaluator (D1) before any solver call; then Z3 queries; then replay; then cvc5; SymCC last. Unblocks C6 and the C7 certificate.

---

# C5. Cedar and OPA comparison protocol (bake-off 2)

**3. Best references.** Cedar (above, plus the Cedar paper's claim of favourable comparison with Rego, authors' own, 09 §2.1); OPA and `opa-wasm`; Regorus (code unread, licence UNVERIFIED) as a possible embeddable Rego interpreter; the spec's own decision rule (19a item 2): adopt Cedar or OPA if they cover the required properties, keep the IR only for what they cannot express and say which.

**4. What they actually do.** Cedar's authorizer is read (above). OPA evaluates Rego, with WASM output, `opa test`, and partial evaluation; I did not read OPA's evaluator, and 09 §2.3 found no first-party SMT analysis. So everything the protocol asserts about OPA's behaviour is a probe to be run, not a claim.

**5. Decision. Own the protocol; the outcome is open and not pre-announced (RUN-03).** Candidates: PPIR, Cedar (WASM for evaluation, SymCC through cvc5 for analysis), OPA/Rego (`opa-wasm` for evaluation). CEL is excluded because no analysis tool was found in 09.

**6. Implementation design (the protocol).**

*Corpus `policy-corpus-30` (neutral English plus a truth table per rule; reviewed by a person who writes none of the encodings).* A thresholds and caps: R01 amount over cap needs CRO; R02 tiered approvals by amount band; R03 per-currency cap table; R04 lower cap for new vendors; R05 invoice over PO by more than a ratio. B date windows: R06 bank change within 30 days vetoes release unless attested; R07 bank change within 90 days and large amount needs callback; R08 expired certificate holds; R09 stale sanctions list holds. C state: R10 rolling 30-day exposure per vendor group over cap needs CRO; R11 split-invoice count signal; R12 daily releases per approver. D sets: R13 high-risk jurisdiction escalates; R14 restricted industry vetoes release; R15 approver role in allowed set. E trust: R16 release needs an account fact whose label the permission matrix allows to `assign_release_field` (a counterparty-authored `VERIFIED` field does not qualify); R17 EXTRACTED-only certificate holds; R18 UNTRUSTED registry remark escalates; R19 a sanctions screen that is `silent` or not checked holds. F identity: R20 approver differs from requester; R21 approver differs from vendor editor; R22 two approvers from distinct reporting lines above a limit; R23 alias suspected escalates. G obligations: R24 post-release notice within 24 hours; R25 dispensation waives callback for small amounts; R26 non-waivable CRO obligation. H precedence: R27 recommend release when clean; R28 recommend escalate when identity depends on a link judgement; R29 regulation-layer sanctions veto beats a company permit; R30 team-layer attempt to loosen a company rule has no effect.

*Procedure.*
1. Freeze the corpus, the case schema, the 10^5-case differential set (stratified: boundary cells from C3, random, adversarial low-trust) and the property list I1 to I9.
2. Each candidate gets one encoder written by someone who has not seen the other encodings; faithful, faithful-with-trick (logic moved to host code or precomputed into context attributes), or not expressible, judged by the corpus reviewer per rule.
3. Run every candidate on the differential set through a thin adapter that returns `{allowed, recommended, required, fired}`; classify each disagreement as semantic difference (documented), adapter bug, or candidate defect.
4. Failure-semantics probes, run on each candidate: integer overflow, missing attribute, type mismatch, division by zero or equivalent, an erroring forbid (Cedar's `erroringPolicies` behaviour is read above; the other candidates are probed), undefined results. Record each as fail-closed, fail-open or error.
5. Provability attempt per property and candidate, recorded as `machine-checked by tool X in T seconds`, `checked via translation to PPIR`, or `not checkable`. Analysis by translation is permitted: a candidate whose policy can be exported as AST JSON is analysed by translating to PPIR and enumerating against the candidate's own evaluator (C3 is evaluator-agnostic). Whether Cedar's WASM exposes policy-to-JSON is NOT VERIFIED.
6. Measure: evaluation latency p50/p99 and throughput over 10^6 evaluations in the pinned Node, cold start, resident memory, installed size, owned non-test lines, TypeScript type safety of the adapter, and whether reason ids and a derivation are obtainable.
7. Verifier portability (a gating criterion, INT-050): a candidate that cannot be interpreted by a dependency-free evaluator in two languages (about 500 lines each, differential vectors) cannot be the normative format of a bundle. Estimate and, for the winner, build both second-implementation sketches; record their sizes.
8. Write the decision record in `docs/DECISIONS.md` and publish the matrix in `eval/reports/`.

*Pre-registered decision rule.* Adopt Cedar or OPA as the *normative bundle format* only if (a) at least 28 of 30 rules are faithful without tricks, (b) I1, I2, I3, I4, I7, I9 are machine-checkable by the candidate's tooling or by translation, (c) every failure-semantics probe is fail-closed or can be made so by a documented adapter rule, and (d) the verifier's recompute module can interpret it with dependency-free evaluators in two languages of about 500 lines each, with differential vectors. Criterion (d) is gating, not a tie-breaker: a candidate that wins on expressiveness but fails (d) is adopted as an authoring front-end or a CI cross-check (as Cedar SymCC already is in C4) and PPIR stays the bundle format, with the cost stated. Otherwise keep PPIR and publish the list of properties each candidate blocked. A hybrid (PPIR as the analysis IR, Cedar as the exported cross-check) is acceptable if it wins.

*Hypotheses, to be falsified, not assumed.* H-C5a: Cedar will mark R10 to R12 and R24 to R26 as tricks because it has no cumulative state, obligations or waivers. H-C5b: OPA will encode all 30 but offer no machine check for I1 to I9. H-C5c: PPIR's owned lines for interpreter, checker and encoder are below 2,000. Each is cheap to disprove.

**7. Tests and acceptance.** The matrix itself; `T-BO2-01` the corpus review has two independent reviewers with a recorded agreement; `T-BO2-02` the differential set produces zero unexplained disagreements; `T-BO2-03` the decision record names the rule it applied.

**8. Risks and NOT VERIFIED.** Cedar's integer width and overflow behaviour (the Lean datetime and decimal files were seen; the `Long` type was not read); Regorus licence and code; Windows availability of the cvc5 and Lean tooling; fairness (the encoder authors differ in skill, so the corpus reviewer's trick judgements carry the result, and a disagreement between reviewers is reported, not resolved silently).

**9. Build notes.** Corpus and reviewer first (runnable once the C1 types exist, before the rest of M5a), then the PPIR encoding (it must exist anyway), then the two others. The result gates how much of C4 is built beyond the term level.

---

# C6. Invariants I1 to I9: statement, enumeration, proof

**3. Best references.** `prior-art/09` §9.2 (I1 to I6 as listed there); Cedar's property families (never-errors, subsumption, disjointness); Runtime Governance and AgenticRei for state and obligations; workflow satisfiability (Crampton and Gutin) for I5; the spec's restrict-only gate (section 5) and guarantee table (9a).

**4. What they actually do.** The cited work states properties of policy sets and checks them with solvers; the spec's I1 to I6 appear in `prior-art/09` as a table of queries. The adversarial review's DEC-01 observes that a proof of an encoding is not a proof of the shipped interpreter, which is why C3 is primary.

**5. Decision. Own.** I1 to I6 are taken from `prior-art/09` §9.2 and the spec's examples; **I7 to I9 are added by this blueprint** (listed in Spec feedback) because the spec's security and exploration claims need a policy-level statement to be testable.

**6. Implementation design.** Notation: `c` a case view, `V(c) = (A, r, req, aut, fired)`, `R = {release, release_with_approval}`, `erase(c)` = `c` with every field whose label permits no class that any `needs` entry of the bundle names (by `permitsClass`) set to status `not_checked`, `⊑` the pointwise "no more permissive" order on verdicts.

| Id | Statement | Primary evidence | Secondary evidence | What it does not cover | Mutants it must kill |
|---|---|---|---|---|---|
| I1 | For `a ∈ R`: `a ∈ A(c)` and `amount(c) > cap` imply a non-waivable approval by `CRO` is in `req[a](c)` | C3 over the cone `{amount, rules touching R and the CRO obligation}` | Z3 query, cvc5, SymCC | whether `amount` is the true amount (a `SOR` release field), currency conversion truth | remove the obligation, raise the cap, make it waivable, change `>` to `>=` |
| I2 | No pipeline stage emits an action outside `A(c)`; a fired veto removes its actions from `A` and nothing downstream adds them back (judge, selective gate, autonomy gate, dispensations, exploration, stack) | by construction of `evaluate` plus the final constructor `Approved<FinalAction>` that checks `a ∈ A`; property tests with an adversarial judge port and a stack of random bundles | Z3 on the interpreter; AST test that no other module constructs `FinalAction` | model judgement quality; the veto condition being right | add a permit that re-adds a vetoed action, let dispensation drop a veto |
| I3 | `hold, reject ∈ A`; `r ∈ A`; `fired ≠ ∅` (a baseline rule `R_BASE` guarantees it); no two firing recommend rules of equal top priority recommend different actions | C3 | Z3 | the reason text being good | duplicate priority, a veto naming `hold` |
| I4 | Every approval obligation reachable in any `req[a]` excludes the requester; when a bank-detail change by the requester or vendor editor falls in the window it also excludes the vendor-master editor; the governance bundle (C7) excludes the proposer and the rule author from approving their own change | C3 over obligation sets | Z3 | whether the identity behind a role is a distinct person (C13 records the gap) | remove a `distinctFrom` entry |
| I5 | Liveness: for every case class and the configured roster with its conflict-of-interest relation, there is an assignment of distinct eligible members to the required approval slots, and (resilience) after removing any one member; failing cells are reported `deadlock` or `fragile` | exact bipartite matching per slot set (polynomial; no solver needed) | Z3 for the general distinctness constraints | people being available at that time | shrink the roster to one CRO, add an unsatisfiable `distinctFrom` pair |
| I6 | Cumulative cap: for `a ∈ R`, `a ∈ A(c)` and `exposure(c) + amount(c) > cap` imply a non-waivable CRO approval is in `req[a](c)`; with a ghost ceiling `C` of CRO-approved exposure, the one-step induction is `E <= max(cap, C)` implies `E' <= max(cap, C')` for `E' = E + x` on execution and `E' <= E` on window expiry | C3 over `(exposure, amount)` with the UTVPI closure | Z3 (one-step induction); small-scope interleaving enumeration of the reservation protocol with M13 (2 or 3 concurrent cases, every interleaving of read, reserve, execute, expire) | entity-resolution errors in `vendor.group`; windows other than the declared one; serialisability of reservations in a real database | window shorter in the rule than in the feature, aggregation by wrong group |
| I7 | Restrict-only: `A(c) ∩ R ⊆ A(erase(c)) ∩ R`; `req(c) ⊇ req(erase(c))` on common actions; `aut(c) ≤ aut(erase(c))`; `r(c) ⪯ r(erase(c))`. Consequently an attacker who controls only fields whose labels the matrix does not allow to carry permission cannot obtain more permission than the permitted fields alone give. Part (b), over the INT-015 inputs: for every registry field declared `missingRestricts` (`doc.risk.*`, `doc.complete.*`, `manifest.*.status`, `claim.*.canPermit`, `overlay.releaseBlock`, `target.reversible`), setting it to `not_checked` or `unavailable` never enlarges `A ∩ R`, shrinks `req`, or raises `aut` | C3 over `(status, matrix row, value)` states | Z3 with `c` and `erase(c)` both symbolic | suppression of a document-derived restriction when the hold-relevant fact is itself permitted after double extraction (SEC-I18, measured separately); authored deception of a permitted channel; compromised systems of record | a permit without `needs`, a recommend toward `R` without `needs`, a cap rule whose absence loosens, a permit that reads `doc.risk.*`, a release rule that fires when `overlay.releaseBlock` is missing, a `needs` class that the matrix allows for `UNTRUSTED` |
| I8 | Exploration containment (C11): the support of the exploration draw is a subset of `A(c)`, every arm has a firing `explorable` rule whose `needs` entries all hold, no arm when a non-explorable fact holds, `μ(a|c) > 0` for each arm and sums to 1; per-period exposure of explored actions is within the declared budget | C3 for support and `needs`; statistical test of the sampler against `μ` | Z3 | the economics or ethics of randomising payments (a deployment decision) | arm outside `A`, `μ` not normalised |
| I9 | Stack meet: for every layer `i`, `V(stack)(c) ⊑ V(layer_i)(c)` | C3 on combined bundles | property tests over random pairs | jurisdictions that legally require more permissive behaviour | a lower layer that removes a higher veto |

*Why I7 holds only with three lints.* A recommend rule toward `R` must carry `needs` (otherwise a low-trust field could raise `r0` from `escalate` to `release`), `explorable` toward `R` likewise, and every `needs` class must be one the matrix refuses for `UNTRUSTED`. All three are static checks in C1 and are exactly the mutants I7 must kill.

*Stating and printing scope.* Every certificate prints a scope string that the UI, README and dossier quote verbatim: for example `I7: checked exhaustively on <n> abstract cells over <k> fields against interpreter <hash>, rules <hash>; assumes feature outputs lie in their declared range; does not cover the truth of the facts, the quality of judgement, or authored deception`. The documentation lint (spec 9a) rejects "proved", "guaranteed" or "by construction" without a citation of a certificate.

*Evidence order.* C3 certificate (primary), then Z3 and cvc5 (secondary), then SymCC where the property is in the stateless fragment. Disagreement is a defect in the weakest component and fails the build; agreement among three independent routes is reported as such, never as a proof of correctness of the rules.

**7. Tests and acceptance.** `T-INV-01` for every invariant, a planted-violation bundle that every route must flag. `T-INV-02` inert-stub controls. `T-INV-03` the 40-mutant suite of C7 against I1 to I9 with a per-invariant kill matrix. `T-INV-04` I5 on randomly generated rosters against a brute-force assignment search. `T-INV-05` interleaving enumeration of the reservation protocol finds the violation when the compare-and-set is removed. Metric: kill rate per invariant; proof wall time. Disproved if any invariant needs a field outside the enumerable fragment for the real pack and cannot fall back to Z3 in budget.

**8. Risks and NOT VERIFIED.** The closure completeness (C3); whether `fired ≠ ∅` via `R_BASE` makes reason codes noise (a usability question); that I7's `erase` models the real attacker, who can also change values of fields whose labels carry no permission, which I7 covers by quantifying over all values and statuses of those fields (A(c) is bounded by the permitted-fields-only verdict whatever those values are); and that the matrix itself is right, which is M8's table review (SEC-L6, SEC-L7), not a property of this module.

**9. Build notes.** I3, I1, I2 first (cheapest), I7 next (the security headline), I9 with the stack (M5a); I5 and I6 with M13 (I6 against the exposure ledger of step 11b), I8 with C11 (M5b). Unblocks C7 (the gate re-proves these on every proposal).

---

# C7. Rule-change gate

**3. Best references.** Progent (solver-decided narrowing versus widening, auto-apply for narrowing, approval for widening); Cedar `analyze compare` and `check_implies` outputs (equivalent, more permissive, less permissive, incomparable per request type, `cedar-lean-cli`, 09 §2.1); AutoCedar's reviewed "intent atoms" before code and the autoformalization paper's hard-critic and soft-critic split (09 §3.11); MADR section names for the ADR; `prior-art/09` §15.2 (proof-carrying rule changes).

**4. What they actually do.** Progent applies a narrowing update automatically and routes a widening one to approval, with an SMT query between (abstract level; repository unread). Cedar's compare tool returns the four-way classification. AutoCedar converges a model-drafted policy to a human-reviewed specification. None combines classification, invariant re-proof, statistical evaluation and tiered approval.

**5. Decision. Own the join (a research contribution candidate, `prior-art/09` §15.2), reusing Progent's idea.** Alternative rejected: auto-applying any change that tests green, since OPE needs untestable assumptions (09 §14).

*Scope (INT-033).* This gate classifies rule bundles, by C3 and Z3. Configuration changes owned by other modules (TTLs, retention, ceilings, cadences, approver counts, M13 §15.4) pass through the same approval tiers but are classified by a declared direction per parameter: a hashed registry `ParamDecl {name, owner, tightenIs: "up" | "down"}` held in the policy stack as data. A change that cannot be classified is loosening and needs two approvers. The governance roster and tiers are a second policy bundle evaluated by the same interpreter (Spec feedback 10), so I4 and I5 cover them.

**6. Implementation design.**

```ts
type ChangeClass = "equivalent" | "tightening" | "loosening" | "incomparable";
interface RuleProposal { id: Id<"rp">; base: Hash; candidate: PolicyBundle; origin: "human" | "m6_consolidation" | "judge_loosening_cluster";
  intent: IntentAtom[];            // reviewed statements in plain language before code is considered
  by: ActorRef; createdAt: Iso }
interface ChangeCertificate {
  baseHash: Hash; candidateHash: Hash;
  classByComponent: { allowed: ChangeClass; obligations: ChangeClass; autonomy: ChangeClass; recommended: ChangeClass };
  class: ChangeClass;                           // the meet of the components; any loosening component makes it loosening; mixed is incomparable
  witnesses: { component: string; view: View; before: PolicyVerdict; after: PolicyVerdict }[];   // replayed through evaluate, never SMT-only
  invariants: Record<InvId, "proved_enum" | "proved_smt" | "violated" | "unknown">; cert: EnumerationCertificate[];
  replay: { decisions: number; changed: number; toMorePermissive: number; toLessPermissive: number; sample: Id<"dr">[] };   // C15 time travel
  counterfactual: OpeVerdict | { kind: "not_applicable"; why: string };                        // C11
  governance: PolicyVerdict;                                                                   // the governance bundle's verdict on this change
  liveness: { slotsSatisfiable: boolean; fragile: string[] };
  adr: MadrRecord }
```

*Classification algorithm.*
1. Run `check(candidate)`; failure ends the proposal (`REJECTED_STATIC`).
2. Syntactic fast path: a change that only adds veto, require or cap rules, only strengthens conditions of existing vetoes and obligations, or only removes permit and recommend rules is *tightening by syntax*; this is sound and is still confirmed in step 3, the fast path only avoids a solver call for the common case.
3. For each verdict component compute the region where candidate and base differ using C3 (cone-sliced over the union of both bundles' fields) and Z3: `loosening_witness` exists iff some view has `A_new ⊄ A_old`, or `req_new ⊉ req_old`, or `aut_new > aut_old` for some action, or `r_new ≻ r_old`. Both routes must agree. A witness is replayed through both `evaluate`s before it is reported.
4. `equivalent` iff no difference region is nonempty (both routes). Otherwise `tightening` iff only the restrictive direction occurs, `loosening` iff only the permissive direction occurs, `incomparable` iff both. **`unknown`, timeout, `partial` enumeration or an unsupported atom is classified `loosening`** (conservative), and the certificate says why.
5. Re-prove I1 to I9 on the candidate; `violated` blocks submission, `unknown` blocks tiers below the CRO tier.
6. Compute the replay diff against the decision log (C15) and the counterfactual evaluation (C11) when the class is `loosening` or `incomparable`; a `tightening` proposal reports the avoided-harm and added-hold counts from matured outcomes.
7. Evaluate the governance bundle on the change case (below) to obtain the required approvals.

*Tiers (data in the governance bundle, evaluated by the same interpreter, so I4 and I5 apply to governance too).* The change case view has fields `class`, `touches_regulation_rule`, `touches_cap_or_I1_params`, `touches_exploration`, `origin`, `invariants_unknown`, `proposer`, `rule_author`, `unevaluable_share`. The default tiers are placeholders for the domain reviewer to set: T0 equivalent, one approver; T1 tightening, one policy-owner approver distinct from proposer and rule author; T2 loosening, two approvers from different reporting lines; T3 loosening or incomparable that touches a regulation-source rule, a cap parameter, the exploration config or the governance bundle itself, two approvers plus the CRO, a cooling-off period and a mandatory shadow period at `AL0` (C12). Regulation-source rules change only on a separate path that requires the compliance-owner role (legal sign-off is a LAWYER item).

*Liveness.* Before accepting any proposal that edits the governance bundle or the roster, I5 is run on the resulting governance bundle and roster for every tier; a change that makes any tier unsatisfiable, or `fragile` below a configured resilience, is refused (`WOULD_DEADLOCK`). Roster changes are queue items and go through the same gate.

*Emergency tightening.* A single named role may add a veto or a cap with immediate effect; the change must be tightening by step 3 (a loosening component refuses it), expires after 72 hours unless ratified through the normal path, and is logged as `emergency_tighten`. There is no emergency loosening path.

*Apply.* `gate.apply(proposal, approvals): Result<Approved<PolicyBundle>, GateError>` is the only constructor. It re-verifies the certificate by recomputation (not by trusting the stored one), checks every approval (an M13 `ApprovalRecord`, C13) is bound to `(candidateHash, certificateHash)`, checks approver identity binding and the governance verdict, checks `base` equals the active hash (otherwise the proposal must be rebased), and performs a compare-and-set on the active-bundle pointer. Activation is effective from a stated instant and never retroactive; pending approval items are re-evaluated under the new bundle: if the new verdict is more restrictive M13 invalidates the item (`world_changed`) and a fresh decision run starts, and if it is more permissive the item keeps its old verdict (a loosening never silently relaxes a pending case).

*ADR.* A MADR-shaped record generated from the certificate: Context and Problem Statement from the intent atoms; Considered Options (the candidate and the rejected alternatives the proposer lists); Decision Outcome and Consequences from the classification, replay diff and tier; Confirmation lists the invariant certificates and tests to be re-run. Free text from a model is allowed only in the intent atoms, shown as `model_reported`.

*Mutation suite of bad rule changes (at least 40, generated and hand-written).* Remove an obligation; raise a cap; make an obligation waivable; drop a `needs` entry; add a permit without `needs`; add a recommend toward `R` without `needs`; change a comparator at a boundary; widen a set; shorten a window (split-invoice evasion); swap priorities; introduce an equal-priority tie; remove a `distinctFrom`; point a dispensation at a non-waivable obligation; add a team-layer rule that tries to override a regulation veto; shrink the roster to deadlock; add an explorable arm outside `A`; change the group key of an exposure feature; plus benign mutants (rename, reorder, add a stricter veto) that must be classified `equivalent` or `tightening`. Each mutant is labelled with the expected class by construction.

**7. Tests and acceptance.** `T-GATE-01` loosening mutants: zero classified `tightening` or `equivalent` (a critical defect otherwise; three independent routes: C3, Z3, random differential). `T-GATE-02` tightening mutants classified `tightening`; the share classified `loosening` only because of `unknown` is reported as an availability cost. `T-GATE-03` every witness replays. `T-GATE-04` `gate.apply` rejects forged, stale, retargeted or unbound approvals (forged-object tests like the M8 compartment tests). `T-GATE-05` roster-change deadlock refused. `T-GATE-06` emergency tightening cannot loosen and expires. `T-GATE-07` pending-approval re-evaluation on activation. `T-GATE-08` certificate verifies offline with the verifier recompute module. Metrics: kill rate over the suite, false-loosening rate, time to certificate. Disproved if a loosening mutant is accepted as tightening by any route.

**8. Risks and NOT VERIFIED.** Region-difference computation can be expensive on large bundles (cone slicing and the conservative `unknown` rule bound the damage); tiers are placeholders needing a domain reviewer; that a classification by verdict components captures all loosening (a change in the `featureSpec` rather than the bundle can loosen without touching a rule, so feature programs are versioned inside the bundle hash and a feature change is a rule change).

**9. Build notes.** Static check and syntactic fast path, then classification by C3, then Z3 agreement, then the governance bundle and tiers, then replay and ADR, last the apply and activation protocol with M13/M9. Unblocks M6 consolidation (it needs a place to send proposals) and the policy time travel in C15.

---

# C8. Judgement contract

**3. Best references.** `prior-art/05` §10.2 step 4 (allowed set before the model, validator rejects and never repairs); mem0's UUID-to-small-integer mapping against invented ids (read in `mem0/mem0/memory/main.py` per `prior-art/05` §2); SEC-07 (the recommendation is a ceiling); ToT (`bfs.solve` read: propose, evaluate, select with logged candidates) and why it is not used here; KnowNo (ask when the calibrated set is not a singleton) for the abstain path in C10.

**4. What they actually do.** mem0 shows the model small integer handles and maps them back to ids in code, so a fabricated id cannot be expressed (`prior-art/05` §2). ToT's `solve` logs every candidate and value and ends with a deterministic verifier in its tasks (`Game24.test_output`, `prior-art/05` §9).

**5. Decision. Own the contract; adopt the handle mapping; reject search.** With at most five actions and `|A|` usually at most three, exhaustive consideration dominates a sampled search, so ToT's machinery buys nothing here. The judge is *conditional* (spec section 15): it is called only when at least two actions are available at or below the ceiling, and the ablation ladder includes the arm "judge off" so its value is measured, not assumed.

**6. Implementation design.**

*Skip rule.* Let `L = {a ∈ A : a ⪯ r}`. If `|L| = 1`, no model call: record `judge_skipped: single_allowed_action`. Precedent retrieval still runs (the autonomy gate needs it, C12), so `skipped` costs one M6 call and no model tokens.

*Ceiling semantics (INT-027, the restrict-only reading).* With recommended action `r` and allowed set `A`: a selection `s ⪯ r` is accepted autonomously (it confirms or restricts); `s ≻ r` with `s ∈ A` is a `judge_loosening` approval item and nothing executes on the model's say-so; `s ∉ A` is rejected. There is no "floor" notion. The order `release ≻ release_with_approval ≻ escalate ≻ hold ≻ reject` is `PolicyBundle.actionOrder` (C1), so "which is looser between escalate and hold" is answered by data, not by the judge or by M14. M14 uses this contract and M5's `JudgeInput`/`JudgeOutput`.

*Input (typed values only, delimited data; no counterparty-authored text).* The digest is an egress sink capped by the model profile (INT-021): the judge call has its own entry in the egress manifest (M8 schema) with the data class it may carry, values are banded or replaced by identifiers under hosted profiles, and whether banding costs accuracy is an ablation arm.

```ts
interface JudgeInput {
  caseDigest: { fields: { handle: string; name: string; value: Json; trust: TrustLevel; status: CellStatus }[] };   // from the view; handles F1..Fn
  allowed: { handle: string; action: Action }[];           // A, with r marked as the ceiling
  firedRules: { handle: string; ruleId: string; reasonText: string }[];   // static templates filled from slots
  claims: { handle: string; claimId: Id<"cl">; label: Label; kind: Claim["kind"] }[];  // labels and ids, no claim text
  gaps: { handle: string; code: string }[];
  precedents: { handle: string; view: PrecedentView; role: "support" | "counter"; mustAddress: boolean }[];   // from M6's PrecedentRetrieval (C9); handle maps back to the EpisodeId in code
  informedness: { knownShare: Ppm; weaklyInformed: boolean };
  reflexion?: ReflectionStep[];                             // typed failure codes only (C14)
}
interface JudgeOutput {
  selection: string;                                        // an allowed-action handle
  cites: { rules: string[]; precedents: string[]; fields: string[] };      // handles
  dispositions: { precedent: string; disposition: "relied" | "dismissed"; basis: DismissBasis }[];
  note?: string;                                            // at most 280 characters; stored as model_reported, never shown as an explanation
}
type DismissBasis = { code: "rule_changed" | "outcome_unverified" | "tainted" } | { code: "fact_differs"; featureKey: string };   // M6's single vocabulary (INT-028)
```

*Validator (`validateJudge`, `pure`, fixed order, first failure wins, never repairs; checks JV1 to JV11, renamed from V1 to V11 so they do not collide with the verifier levels V0 to V8 and with V(S), INT-011).* JV1 schema and size. JV2 `selection` is the handle of a member of `A` (J-NOT-ALLOWED otherwise). JV3 compare `selection` with `r` in `actionOrder`: if `selection ⪯ r` accept as an *autonomous restriction or confirmation*; if `selection ≻ r` the model is proposing a loosening: the validator returns `Loosening` and the pipeline creates a `judge_loosening` approval item (below); the case proceeds with `r` until a human decides. JV4 every cited rule handle maps to a rule that fired in this verdict (existence alone is not enough). JV5 every cited precedent handle maps to a precedent in the retrieval. JV6 every cited field handle maps to the digest. JV7 every id in M6's `obligations.mustAddress` has a disposition (J-COUNTER-IGNORED). JV8 each dismissal is machine-checked. JV7 and JV8 are M6's `validateJudgement(judgement, retrieval)`, called after M5 has mapped handles back to episode ids; M5 adds only the handle mapping and JV1 to JV6 and JV9 to JV11. The M6 checks: `rule_changed` requires the precedent's validity state to differ from valid; `fact_differs` requires the `featureKey` to be in the precedent's `featureDiff`; `outcome_unverified` requires an unobserved outcome; `tainted` requires `precedentTrust` below `VERIFIED` (INT-028; M6 SF11 defines it as the meet of the policy-relevant fact trust and the outcome-evidence trust). The case-based-reasoning "distinguish" move behind `fact_differs` has provenance in the HYPO and CATO literature that was not fetched here and is UNVERIFIED. JV9 a `relied` precedent must be valid and standing as supporting (M6 excludes tainted and unproven permissive-direction precedents from every set, so none can be relied on). JV10 a selection other than `r` must cite at least one rule or precedent (deviation needs a basis). JV11 the output size limits. A failure returns `JudgeReject{code, handle?}`, feeds C14, and is traced.

*Loosening item.* `ApprovalItem{type:"judge_loosening", action: selection, ceiling: r, evidence, expiresAt}` is executed only by a human decision bound to the exact verdict hash; nothing executes on the model's say-so. Approved loosenings are logged with the case view so that M6 consolidation can see clusters of "model proposes more permissive than rules, humans agree" as candidate `RuleProposal`s (origin `judge_loosening_cluster`).

*Model call.* Through `ctx.model` with the judge profile (M14), temperature 0, budget reserved before the call, cassette key includes prompt version and the handle map. The prompt places all data in delimited blocks flagged by trust level; no field of the case digest whose trust is below `VERIFIED` is rendered without its flag.

*Gate.* `judgeGate.apply(JudgeOutput, verdict): Result<Approved<JudgedAction>, JudgeReject | Loosening>` is the only constructor of the judged action; its type carries the verdict hash so a stale output cannot be applied.

**7. Tests and acceptance.** `T-JDG-01` adversarial model port: a port that returns uniformly random strings, random handles, unknown handles and every action; across 10^6 draws zero validator acceptances of any output with `selection ∉ A`, any `selection ≻ r` without a loosening item, any citation not in the verdict or retrieval set, or any missing counter disposition. `T-JDG-02` each of JV1 to JV11 has a negative case. `T-JDG-03` validator mutation (disable one check at a time; the suite must fail). `T-JDG-04` skip rule property (never calls the model when `|L| = 1`; trace line present). `T-JDG-05` handle mapping: a model that emits a real id instead of a handle is rejected. `T-JDG-06` loosening never changes the executed action before approval. `T-JDG-07` ablation arm: judge off versus on on the labelled decision set, with the rate at which the judge selects below `r`, the rate at which it proposes loosening, and decision accuracy with intervals. Disproved if the judge's selections below `r` do not improve a primary metric (it then becomes code, per the spec's role test).

**8. Risks and NOT VERIFIED.** The judge sees only typed data, so its added value over rules plus precedent is a hypothesis (H-JDG: it matters mainly for weighing precedents and gap combinations); model availability and cassettes depend on the NVIDIA key (NOT VERIFIED); my reading of the spec's two-sentence contract is stated in Spec feedback.

**9. Build notes.** Validator and handle mapping on the scripted test model first (works with no credentials), then the rule brain's judge implementation, then real models. Unblocks C14.

# C9. Precedent contract with M6 and the counter-precedent requirement

**3. Best references.** `prior-art/11` §10.3 contribution A (the precedent record, recomputed validity, fixed published factors, the counter query); `prior-art/09` §12 (survivorship fixes: store `observedBecause` and the propensity, treat unknown outcome as its own state, always return counter-precedents); CBR-RAG (Retrieve, Reuse, Revise, Retain) and Memento (a case bank with a learned selector, which we do not adopt); mem0's gate-then-fuse scoring and Generative Agents' retrieval as read in `prior-art/05` §2 and §5.

**4. What they actually do.** mem0 gates on the semantic score before fusing keyword and entity signals and offers an `explain` breakdown; neither it nor Generative Agents has an outcome or a rule-version term, and Generative Agents min-max normalises scores over the candidate set, which makes them incomparable across queries (`prior-art/05` §10.8 item 4). Memento learns a case-selection policy from reward, which has the survivorship problem of `prior-art/09` §12.

**5. Decision. M6 owns retrieval, storage and the boundary types; M5 owns the contract it requires and refuses a retrieval that breaks it.** Own. M5 never reweights M6's scores. The boundary types are M6's `PrecedentRetrieval` and `validateJudgement`, published by M6 C5 and C7 as the contract file (INT-028); M5 declares no parallel `PrecedentSet`, `PrecedentHit` or dismissal vocabulary.

**6. Implementation design.**

```ts
// M5 sends (the query shape is M6's; shown for the fields M5 sets)
interface PrecedentQuery { view: ViewDigest; viewHash: Hash; policyHash: Hash; asOf: Iso; k: number; pin: SnapshotPin;
  purpose: "judge" | "autonomy" | "calibration_score" }           // calibration_score excludes same-vendor and same-cluster hits
// M5 reads, from M6's PrecedentRetrieval (fields as published in M6 C7, C8, C9):
//   allowed, lead, support[], counters[] (each ScoredPrecedent with view, validity state and diff, featureDiff, scoreMicros, terms),
//   informedness { knownShare, weaklyInformed, unknown { pending, censored }, perAction },
//   autonomy: AutonomySupport { allowsAbove: AutonomyLevel, reasons },
//   excluded[] { episodeId, code }, obligations { mustAddress: EpisodeId[] }, hash
```

*Contract clauses (the M6 conformance suite tests exactly these).*
- P1 Purity. Retrieval is a pure function of `(query, pin)`; reading changes no ranking state (the H-MEM reference mutates on read; ours must not, spec section 11). The retrieval `hash` is recomputable.
- P2 Validity is recomputed by M5a. M6 calls `revalidate(hit, activeBundle)`, which runs `evaluate(activeBundle, featurize(hit.snapshot))` and compares the allowed set and fired rules with the recorded ones; M6 never reimplements rules. Validity states are M6's (`valid`, `stale_rule_diff` with a diff, `action_now_forbidden`, `disjoint`; erased snapshots are `unevaluable`, INT-040).
- P3 Counter-precedent requirement. After the supporting query, M6 builds the counter set over all gated precedents; if any qualifying counter exists, at least one is returned and every returned counter is in `obligations.mustAddress`. An empty counter set is told to the judge as "none exists", never as "not searched", and a retrieval that omits the obligations field is rejected by M5.
- P4 Taint and standing (INT-038). A precedent is tainted when `precedentTrust` is below `VERIFIED`; `precedentTrust` is the meet of the policy-relevant fact trust and the outcome-evidence trust. Tainted and unproven permissive-direction precedents are excluded from every set and listed under `excluded`; restrictive-direction ones may appear as counters. A tainted precedent never counts towards autonomy.
- P5 Weakly informed is `knownShare < knownShareMin` (a strict inequality; M6's pre-registered starting value 0.5). It cannot raise autonomy and is shown in the UI. `censored` is permanent for restrictive actions absent adjudication, so sampling does not repair it.
- P6 Outcome labels come only from the outcome verifier or a human via M13, with tier T0 or T1; never the deciding model.
- P7 Weighting is M6's fixed published factors (outcomes enter ranking only through the published factor, and `feedback()` is reserved for authenticated reviewer verdicts); M5 consumes scores for display and ordinal use only.
- P8 Pin and ids are recorded in the decision record, and the decision-dependency edges (case to precedent ids, rule versions, facts) are written for M6's cascading retraction.
- P9 Write-back: M5 emits a `DecisionEpisode` proposal through `appendEpisode(decisionRecord)` (view digest, verdict hash, final action, autonomy level, approver, judge call id, and the exploration propensity when audit sampling applied); episodes are immutable in id, digest and trust label, outcomes arrive later as separate events.

*Where M5 uses precedents.* (1) The judge input and the JV5 to JV9 checks of C8. (2) The autonomy gate: a level above `AL1` requires `retrieval.autonomy.allowsAbove` at least the requested level (M6 C9: a proven valid supporter with trust at least `VERIFIED` and a matured verified outcome, not weakly informed, no unaddressed harmful counter); M5 also checks `weaklyInformed == false` itself. (3) A selective-release score term: the count of valid counter hits with outcome `reversed` or `incident` contributes risk points (C10). (4) The kNN mix used as the conformal nonconformity score in C10, computed by M5 from the returned precedents' actions and outcomes.

**7. Tests and acceptance.** `T-PRE-01` the P1 to P9 conformance suite, run against M6 and against a small reference fake: purity (two retrievals at one pin are byte-identical; a retrieval does not change the next), a planted counter-precedent is returned, tainted and unproven permissive-direction precedents are excluded and listed, a rule change makes a precedent `stale_rule_diff`, same-cluster exclusion for `calibration_score`. `T-PRE-02` the ablation ladder of the spec (rules only; plus precedent; plus recency, conditional on M6's precedent ladder measuring a gain; plus outcome; plus rule-version awareness; plus counter-precedent; with and without critic) on a labelled decision set with planted rule changes; metrics: decision accuracy on cases where the rule changed after the precedent, and the stale-precedent-driven error rate, with cluster-bootstrap intervals. `T-PRE-03` survivorship: in the simulator, treating unknown outcomes as zero biases precedent support towards release; with `unknown` flagged and propensity weighting where available the bias disappears; without propensities the output says "weakly informed". `T-PRE-04` poisoning through the real write path cannot raise autonomy. `T-PRE-05` a judge output that ignores a returned counter-precedent is rejected. Disproved if the ladder shows no step improving the rule-change-after-precedent metric beyond rules alone.

**8. Risks and NOT VERIFIED.** The clauses are reconciled with M6's published types (INT-028) but not yet run against an implementation. The weighting table, the threshold 0.5 and the usefulness of counter-precedents when the case base is small are hypotheses.

**9. Build notes.** M5b. The reference fake and conformance suite first (they define the boundary and unblock M6), then the judge-side checks, then autonomy use. Unblocks C8 and C12.

---

# C10. Selective release with a validated error bound

**3. Best references.** Learn-then-Test ([2110.01052](https://arxiv.org/abs/2110.01052); fixed-sequence testing over an ordered family of thresholds with exact binomial tails) and [`aangelopoulos/ltt`](https://github.com/aangelopoulos/ltt); Conformal Risk Control ([2208.02814](https://arxiv.org/abs/2208.02814)) for the unconditional variant; Geifman and El-Yaniv ([1705.08500](https://arxiv.org/abs/1705.08500)) for the selective-risk formulation (risk among accepted instances, high probability, by rejecting); Gurram ([2608.14639](https://arxiv.org/abs/2608.14639), preprint) for the three failure modes a validity test must exercise; KnowNo ([2307.01928](https://arxiv.org/abs/2307.01928)) for abstaining when the calibrated set is not a singleton; Gibbs et al. ([2305.12616](https://arxiv.org/abs/2305.12616)), Barber et al. ([2202.13415](https://arxiv.org/abs/2202.13415)) and the cost-sensitive Mondrian result ([2607.27143](https://arxiv.org/abs/2607.27143)) for strata and drift; Conformal Decision Theory ([2310.05921](https://arxiv.org/abs/2310.05921)) for the online dial.

**4. What they actually do.** LTT tests a nested family of thresholds in a fixed order and returns the last one rejected, which controls the family-wise error; the abstract-level results and `prior-art/09` §4.1 are what we rely on, and we did not read the repository's code. The Geifman and El-Yaniv abstract states a user-specified risk with high probability at some coverage; the exact SGR bound is not in the abstract. Gurram's abstract names document clustering (design effect 1.84 to 2.45), refitting a score on the calibration data, and tie mass in a degenerate score as ways accepted-set risk control fails.

**5. Decision. Adapt LTT with a fixed integer score, cluster-thinned calibration, and a separate conformal split; own the validation protocol.** The stated bound comes only from the LTT step; the conformal set is part of the *region definition* (so it cannot silently change the bound) and its job is the reviewer-facing abstain reason. Alternative rejected: Wilson at checkpoints (invalid under repeated looks, measured in C12) and learned rejectors (consistency is asymptotic, 09 §4.7).

**6. Implementation design.**

*What is guaranteed, and the composition trap.* Two different statements exist. G1 (joint): `P(auto and harmful) <= beta` over all rule-allowed cases; extra abstention can only lower it, so layers that only restrict compose. G2 (selective): `P(harmful | auto) <= alpha` for **exactly the calibrated region**; adding any further abstention rule that depends on the case can change the conditional risk in either direction, so G2 does not compose. Therefore every case-dependent condition that is part of auto-eligibility (score threshold, conformal singleton, stratum) is inside the calibrated region; conditions that do not depend on the case's risk (the autonomy cell level, time of day) act after and only G1 is claimed through them. The caution dial moves *within the certified prefix* of the tested sequence, where every step was rejected simultaneously by the fixed-sequence procedure, so G2 holds at each dial position.

*Definitions.* `P = {release, release_with_approval}`. The guarded decision is a judged action `a* ∈ P` (restrictive actions are never guarded; their cost is the false-hold rate, reported separately). Because release actions are capped at `AL2` by rule, "auto" means the **fast lane**: no payment executes without a person (INT-032). `release` at `AL2` produces a one-approver item and `release_with_approval` a multi-approver item; the system presents `a*` for a single confirm with the evidence card, and "auto-coverage" means fast-lane coverage. "Abstain" means the recommendation is changed to `escalate` with the reviewer set and a full-review requirement. Harm `y = 1` iff the adjudicated correct action is more restrictive than `a*`. Under this reading the bound holds assuming the human confirms (rubber-stamp assumption); human catches only lower realised harm. The statement is conditional on the calibrated region (G2), and the joint rate (G1) can only fall when more cases abstain. Reversibility of the target comes from `TargetManifest.reversal` (`target.reversible`, C2), never from a model.

```ts
interface Stratum { ruleFamily: string; amountBand: string; policyMajor: string; lane: "normal" | "attacker" }
interface ScoreSpec { id: string; hash: Hash; terms: { feature: string; table: readonly [bigint, bigint][] }[]; max: bigint }   // fixed integer risk points, never fitted on calibration data
interface LttStep { lambda: number /* integer */; n: number; k: number; pMicros: Micros /* p rounded up; the test is recomputed exactly from n, k, alpha */; rejected: boolean }
interface CalibrationBundle { stratum: Stratum; scoreSpec: Hash; q: { alphaC: Ppm; value: bigint; nQ: number }; lambdaHat: number /* -1 = always abstain */;
  sequence: LttStep[]; alpha: Ppm; delta: Ppm; nCal: number; kObserved: number; clusters: number;
  labelSource: "generator" | "panel" | "outcome"; generatorHash?: Hash; splitSeed: string; assumption: "exchangeable-within-stratum"; createdAt: Iso }
type SelectiveDecision =
  | { mode: "auto"; action: Action; bound: Bound }
  | { mode: "abstain"; why: "score_above_lambda" | "stratum_uncalibrated" | "stratum_too_small" | "set_not_singleton" | "shift_alarm" | "caution_dial"; reviewerSet: Action[]; bound?: Bound };
```

*Calibration (offline, deterministic given seeds).*
1. Pre-register the score spec, `alpha`, `delta`, strata, split sizes and the validation protocol before running anything (a run is confirmatory only if the pre-registration was publicly committed after the commit window opened, or hash-anchored externally, before the run starts; earlier runs are exploratory, INT-059). The tail probabilities and the estimators compute in floating point in memory; hashed and recorded documents carry only the integer scales (`Ppm`, `Micros`) with outward rounding (INT-010).
2. Split by vendor cluster into three disjoint parts: `Dq` (conformal), `Dc` (LTT), `Dt` (validation only). A cluster never straddles parts.
3. Score. Integer risk points from a fixed table over features available at decision time (a feature has `availableAt <= decision time`, checked): unresolved conflicts, evidence gaps by kind, fragile evidence (M4 minimal-flip size), `identity_dependent`, document risk signals, vendor age, recent bank change, amount relative to the vendor's history band, counter-precedent points (C9), `weaklyInformed`. A learned model may be used only if fitted on a fourth split `Dtrain`, then frozen and hashed; a new spec means a new calibration.
4. Conformal threshold `q` on `Dq` per stratum: nonconformity `s_a(x) = 1 - p(a|x)` with `p` the distance-weighted action mix of valid supporting precedents; `q` is the `ceil((n+1)(1-alphaC))/n` empirical quantile of true-action scores; `C(x) = {a ∈ A : s_a(x) <= q}`. If `n < 1/alphaC - 1`, the stratum is `stratum_too_small` and abstains.
5. Region family `R(lambda) = {x : a*(x) ∈ P, score(x) <= lambda, C(x) = {a*(x)}}`, nested in `lambda` for fixed `q`.
6. Fixed-sequence test on `Dc`, thinned to one case per vendor cluster (random by seed): for `lambda = 0, 1, ..., max` ascending, `n_lambda = |R(lambda)|`, `k_lambda` = harmful count, `p_lambda = BinomCDF(k_lambda; n_lambda, alpha)`; reject "selective risk > alpha" iff `p_lambda <= delta_s`; stop at the first non-rejection; `lambdaHat` is the last rejected (`-1` if none). `delta_s = delta / number of strata` for a family-wise statement; per-stratum figures are also published at `delta`.
7. Persist the bundle (hash-pinned) and the step table; the dossier quotes it.

*Validity argument (DERIVED here; the tag belongs on the conditional claim, not the arithmetic).* If clusters are iid, then conditional on which thinned cases fall in `R(lambda)`, their labels are iid Bernoulli with the selective risk `r_lambda`, so `k_lambda | n_lambda` is Binomial and `p_lambda` is a valid p-value for `r_lambda > alpha` conditional on `n_lambda`, hence unconditionally. Score and `q` are independent of `Dc` by the split, and the order of `lambda` is fixed in advance, which is all fixed-sequence testing needs. This is why the three failure modes in Gurram's abstract map to three tests: clustering (thinning plus an ICC sweep), score-refit leakage (the split and the frozen hash), tie mass (we test over the attained integer values, no grid to collapse).

*Minimum accepted cases (computed here; exact binomial, one stratum).* Zero harmful events: `alpha` 0.10: 22 (delta 0.10) or 29 (0.05); `alpha` 0.05: 45 or 59; `alpha` 0.02: 114 or 149; `alpha` 0.01: 230 or 299. One harmful event: 38 or 46; 77 or 93; 194 or 236; 388 or 473. Two: 52 or 61; 105 or 124; 265 or 313; 531 or 628. The count is cases inside the region, one per cluster. The headline is published as an alpha ladder with a money reading: harmful fast-lane releases per 1,000 are at most `1000 * alpha` with confidence `1 - delta`, times the mean ticket of the stratum; a 5 percent harmful rate is a weak figure for payments and is shown as the *first* rung, not the claim.

*Runtime (`decideSelective`, `pure` apart from reading the calibration bundle).* Compute the stratum; load the bundle valid for `(policyMajor, scoreSpec)`, else abstain `stratum_uncalibrated`; compute the points; apply the dial position `lambda' <= lambdaHat`; compute `C(x)`; auto iff `score <= lambda'` and `C(x) = {a*}`; otherwise abstain with the first failing reason and the reviewer set (hold and reject are always selectable by the reviewer, unlike Straitouri et al.'s restricted-agency result which is from image classification, 09 §4.7). A new policy major opens an empty stratum, so it starts in abstain mode.

*Caution dial and shift alarm.* After an adjudicated harmful auto-release in the stratum, move `lambda'` down the certified prefix by two steps; relax one step after a pre-registered number of clean auto decisions; never above `lambdaHat`. The shift alarm is the anytime-valid Bernoulli confidence sequence of C12 on the stratum's realised harmful rate among shadow-labelled auto decisions; when its lower bound exceeds `alpha`, force abstain until recalibration.

*Attacker-shift stratum.* Calibrated separately on cases produced by the attack generator (Plumbline-Inject families including the SEC-I18 steering family, M11). Its guarantee text says "for this generator's attack distribution", and a cross-lane test shows that the normal-lane bound is violated on the attacker lane (the expected result), which is the evidence that the normal-lane bound must not be quoted under attack. No guarantee is claimed against an adaptive attacker.

*Validation protocol (replaces 1,000 re-splits of one dataset, DEC-02).* For `d = 1..1000`: draw an **independent** calibration dataset from the generator with seed `d` (fresh vendor clusters), split by cluster, calibrate, obtain `lambdaHat_d`, then compute the true selective risk of `R(lambdaHat_d)` on a fresh test sample of 200,000 cases (or exactly, from the generator's known conditional label probabilities). A *violation* is true risk above `alpha`. Report the violation fraction with a one-sided Clopper-Pearson interval, the auto-coverage and abstain-rate distributions per stratum, and the same numbers per planted conflict type. Reading: with 1,000 draws the 99 percent one-sided lower bound on the violation fraction is 0.0791 for 100 violations, 0.1063 for 130, 0.1432 for 170 and 0.1713 for 200 (computed here), so a method violating at twice the stated delta is detected and one violating at 1.3 times is borderline; **FAIL if that lower bound exceeds `delta`; PASS-WEAK if only the upper bound does**. Negative and positive controls: shuffled labels must collapse auto-coverage; the invalid methods "empirical rate under alpha at each lambda, choose the largest" and "Wilson at every lambda without ordering" must violate beyond `delta` (positive controls: the harness can fail); an injected mid-stream shift must trip the alarm within a stated number of cases; an ICC sweep shows the violation fraction rising when thinning is switched off and the design-effect fallback restoring it.

**7. Tests and acceptance.** `T-SEL-01` the validation protocol above. `T-SEL-02` golden vectors of the binomial tail, quantile and fixed-sequence logic against MAPIE, crepes and `ltt` outputs computed once offline (those Python projects are not run here). `T-SEL-03` composition: a unit test that adds an extra abstention rule outside the calibrated region and shows G2 can move while G1 cannot increase (the reason for the region definition). `T-SEL-04` the dial never exceeds `lambdaHat`. `T-SEL-05` a bundle for another policy major or score hash is refused. `T-SEL-06` money-reading output matches the formula. `T-SEL-07` stratum counts: strata below the table minimum abstain. Metrics: violation fraction with interval, auto-coverage, abstain rate by reason, realised harmful rate, false-hold cost. Disproved if the violation fraction FAILs, in which case the bound is withdrawn from all text.

**8. Risks and NOT VERIFIED.** The conditional (selective-risk) validity derivation above; exchangeability inside a stratum; that the generator's labels are the right notion of harm; real-world label cost; the conformal split's usefulness when precedents are sparse (ablate it; if it never changes a decision it is removed from the region); reviewer disagreement as label noise is not modelled unless the generator plants it. The bound holds for the synthetic generator only (spec 9a) and is never stated for the real world.

**9. Build notes.** Binomial and quantile primitives with golden vectors; generator hooks with M11; fixed-sequence calibration; validation harness with controls; runtime gate; dial and alarm last. Unblocks C12 and the decision record's bound field.

---

# C11. Counterfactual evaluation of proposed rules and governed audit sampling

**3. Best references.** Dudik et al. (doubly robust, [1503.02834](https://arxiv.org/abs/1503.02834)); Thomas et al. (high-confidence off-policy evaluation, AAAI 2015); Karampatziakis et al. (off-policy confidence sequences, [2102.09540](https://arxiv.org/abs/2102.09540)); Waudby-Smith et al. (anytime-valid off-policy inference for contextual bandits, [2210.10768](https://arxiv.org/abs/2210.10768)); Kallus and Zhou (confounding-robust, [1805.08593](https://arxiv.org/abs/1805.08593)); Lakkaraju et al. (selective labels); OBP (`zr-obp`, Apache-2.0, last push 2024-06-03) as a vector source; `prior-art/09` §11 (the design and the pitfall list).

**4. What they actually do.** DR combines a reward model and importance weights and is accurate if either is good, but needs the logging propensity; the confidence-sequence papers give bounds valid at all sample sizes (abstract level). Under a deterministic logger the propensity of any unchosen action is zero and there is nothing to weight (`prior-art/09` §11.6).

**5. Decision. Own the pipeline; write the estimators; add two findings of ours.** (F1) *Asymmetry*: a **tightening** proposal (release becomes hold or escalate) is evaluable from logs without propensities, because the counterfactual outcome of the restrictive action is known by construction (no payment, harm zero, a configured hold cost) and the avoided outcome is observed for the releases that happened; a **loosening** proposal asks for the outcome of an action the logger never took, which no log contains, so it is `unevaluable` unless exploration created propensities. The tightening result depends on the stated assumption about hold cost and on matured outcomes. This is DERIVED here and tested in the simulator. (F2) *Exploration lives inside the policy language*: the `explore` layer of C1, with I8, so safe randomisation is a checked property of the same bundle, not an operations switch.

**6. Implementation design.**

```ts
interface LoggedDecision { caseId: Id<"case">; cluster: string; ts: Iso; viewHash: Hash; ruleVersion: string; action: Action;
  muPpm: Ppm | null;                                   // probability of `action` given the view; null = deterministic or unknown
  randomized: "none" | "audit_sample" | "reviewer_assignment"; rngStream?: string;
  outcome: { observed: boolean; harm: 0 | 1 | null; lossMicros: Micros | null; matured: boolean; observedBecause: "released" | "audited" | "none"; tier?: "T0" | "T1" };
  reviewer?: string }
type OpeVerdict =
  | { kind: "evidence_of_improvement" | "inconclusive" | "evidence_of_harm"; estimate: Micros; lower: Micros; upper: Micros; essMilli: Milli;   // stored values rounded outward (lower down, upper up); computed in floating point in memory (INT-010)
      method: "tightening_logged_outcomes" | "dr_clipped" | "ips_clipped"; interval: "betting_cs"; clipBiasBound: Micros;
      overlap: { evaluable: number; unevaluable: number; examples: Id<"case">[] }; clusters: number; sensitivity: { gammaMilli: Milli; lowerAtGamma: Micros }[] }
  | { kind: "unevaluable"; reason: "no_support" | "ess_below_floor" | "no_outcomes" | "few_clusters"; unevaluableShare: number };
```

*Procedure (the order is the safety property).*
1. Classify the change (C7). Everything below is evidence in the certificate, never an activation trigger.
2. Keep only matured outcomes (a per-outcome-type maturity window, since harm can surface months later) and split by time and by vendor cluster into a mining part and an evaluation part; proposals mined from closed cases are evaluated only on cases not used to mine them.
3. Disagreement set `D = {i : candidate(view_i) != action_i}`. For each member, check support. Report evaluable and unevaluable counts separately and list examples; no number is produced for the unevaluable part; the verdict is `unevaluable` if its share exceeds the pre-registered limit, if fewer than 30 clusters remain, or if the effective sample size is below a floor.
4. Tightening branch (F1): per disagreement case the change in loss is `loss_hold_config - loss_observed(release)` with `loss_observed` from the matured outcome, aggregated per vendor cluster; the hold cost and the "hold has zero harm" assumption are printed with the verdict.
5. Loosening branch: `V_hat = mean_i [ q_hat(x_i, pi'(x_i)) + 1[a_i = pi'(x_i)] (r_i - q_hat(x_i, a_i)) / mu_i ]` with a cross-fitted reward model, weights clipped at `W_max`; ESS `(sum w)^2 / sum w^2` is the number of matched cases, not the log size (with `mu = 0.1` and 200 logs only about 20 match). The clipping bias is bounded and reported.
6. Interval. Per-cluster terms are bounded after clipping, so a betting confidence sequence (Waudby-Smith and Ramdas, [2010.09686](https://arxiv.org/abs/2010.09686)) applies at any sample size and under peeking. Bootstrap intervals are not used for importance-weighted estimates (heavy tails). The validity of the sequence holds for any predictable betting fraction; the choice only affects width.
7. Sensitivity to unobserved confounding in human overrides (a Gamma-style uncertainty set after Kallus and Zhou): if the lower bound crosses zero at a modest Gamma the verdict is `inconclusive`.
8. Multiplicity. Candidates mined from one run are tested in a pre-registered fixed order or with Holm; winners are re-evaluated on a later time slice.
9. Metrics beside harm: cost of holds, throughput, escalations per vendor. A hold-everything rule has zero harm and large cost and must never read as improvement.
10. Output a `RuleProposal` certificate part; imitation statistics ("agreement with human decisions") may be shown but are labelled imitation and never as rule value.

*Governed audit sampling (exploration).* The `explore` layer of the bundle declares `explorable(a)` rules, each reading only fields whose `needs` entries hold under the permission matrix (lint), and an `ExplorationConfig{ epsilon_a <= epsilon_max, perPeriodExposureCap, perVendorCap, arms, stratum }`. At decision time, for a case whose verdict has a firing `explorable` rule for some `a ∈ A`, the arms are `A ∩ explorable`; `mu(a|c)` is computed deterministically from the config; the draw uses `ctx.rng` with a recorded stream id; `mu` and the stream id are written to the trace **before** the draw and to the episode. The preferred dimension is review depth (two-eyes versus four-eyes), which does not move money; randomising release versus hold is allowed only below an exploration amount cap and outside any non-explorable fact. Enabling or widening exploration is a T3 change (C7). I8 states the containment; a statistical test checks the sampler against `mu`. In the demo exploration is off by default and shown only in the simulator (DEC-06): randomising payment actions in a real deployment is a business and ethics decision.

*Simulator (ours, in M11).* A case generator with a known better rule, known propensities, optional hidden confounder, delayed and censored outcomes, and a hold-cost parameter, so the truth of every verdict is known by construction. Everything C11 reports validates **methodology**, not the value of any real rule (DEC-06).

**7. Tests and acceptance.** `T-OPE-01` known-answer: with a better rule and known propensity, the procedure declares improvement with the stated error rate over 1,000 repetitions, and declares `unevaluable` when the logger is made deterministic. `T-OPE-02` asymmetry: the tightening branch recovers the simulator's true gain within its interval, and the loosening branch returns `unevaluable` without exploration and a valid estimate with it. `T-OPE-03` estimator golden vectors against OBP outputs computed once offline. `T-OPE-04` adversarial proposals: copy-the-old-rule (`equivalent`), hold-everything (flagged by cost), a rule using a feature unavailable at decision time (rejected by `availableAt`), a rule mined and evaluated on the same cases (rejected by the split), a candidate selected as best of many without multiplicity control (shown inflated). `T-OPE-05` peeking: the confidence sequence's error under continuous monitoring is at most the stated level (simulation). `T-OPE-06` clustering: intervals widen correctly when cases per vendor are correlated. `T-OPE-07` I8 sampler test. Metrics: coverage of the interval in simulation, share unevaluable, ESS, clipping bias bound. Disproved if the interval under-covers in simulation or if a tightening estimate disagrees with the known gain beyond its interval.

**8. Risks and NOT VERIFIED.** The assumptions of Narita et al. for deterministic loggers ([2212.01925](https://arxiv.org/abs/2212.01925)) are unread; the unit of analysis (cluster) shrinks sample sizes sharply; hold cost is an assumption; `confseq` code was not read, so the betting sequence is implemented from the paper's construction and tested by simulation rather than by comparison.

**9. Build notes.** Simulator and estimators with golden vectors; tightening branch (cheapest, most useful); confidence sequences; loosening branch with exploration; ADR hook. Unblocks C7's certificate.

---

# C12. Autonomy ladder with anytime-valid promotion and automatic demotion

**3. Best references.** `prior-art/05` §10.5 (levels, cells, default deny); Howard et al. ([1810.08240](https://arxiv.org/abs/1810.08240)) and Waudby-Smith and Ramdas ([2010.09686](https://arxiv.org/abs/2010.09686)) for confidence sequences; Karampatziakis et al. ([2102.09540](https://arxiv.org/abs/2102.09540)) for gated deployment; ProbGuard ([2508.00500](https://arxiv.org/abs/2508.00500)) as an advisory early-warning idea only; Conformal Decision Theory ([2310.05921](https://arxiv.org/abs/2310.05921)) for the dial (C10).

**4. What they actually do.** The confidence-sequence papers give bounds valid uniformly over time, so a person may look after every case. `prior-art/05` §10.5 promoted on a Wilson interval, which is a fixed-sample interval. We measured the difference (below).

**5. Decision. Own the ladder; replace the Wilson check by a beta-mixture confidence sequence on cluster-level Bernoulli streams.** Rejected: a learned early-warning model as a gate (cannot be proved, 09 §3.2).

**6. Implementation design.**

*Levels.* `AL0` observe (compute and record, show nothing), `AL1` propose (recommendation shown), `AL2` act with confirm (the prepared action executes on a human approval), `AL3` act (renamed from L0 to L3, INT-011). A cell is `(ruleFamily, actionType, riskTier, policyMajor)`. For any decision: `level = min(ruleCap[a], cellLevel[cell], gateCap)` in the order `AL0 < AL1 < AL2 < AL3`. `ruleCap` comes from the verdict (`aut[a]`; release actions are capped at `AL2`). `gateCap = AL1` if the selective gate abstained, the precedent support condition of C9 fails, `weaklyInformed`, a shift alarm is on, the cell is frozen after an incident, or the kill switch is set. `AL3` is reachable only for restrictive, reversible actions (auto-hold, auto-escalate; reversibility is declared by the target manifest, `target.reversible`); for those the guarded error is the false-hold rate.

*Confidence sequence (the statistic).* For a stream of independent Bernoulli observations `x_1..x_t` (one per vendor cluster, "cluster had at least one harmful would-be decision") the beta-binomial mixture martingale `M_t(m) = [B(a + k, b + t - k) / B(a, b)] / [m^k (1 - m)^(t - k)]`, with `a = b = 1/2` and `k = sum x_i`, is nonnegative with mean 1 at the true `m`, so by Ville's inequality `P(exists t : M_t(m) >= 1/alpha) <= alpha`. The set `{m : M_t(m) < 1/alpha}` is a confidence sequence valid at every `t` and under optional stopping. The upper limit `U_t` is found by bisection on `m > k/t`. (The construction is elementary and is checked by simulation, not by citation; the general bounded-mean case with betting is in 2010.09686.) For bounded non-Bernoulli terms (clipped importance-weighted terms in C11) use the betting sequence with any predictable fraction `lambda_t in [0, 1/m)`.

*Measured here (our simulation, seeded, 4,000 sequences, horizon 3,000 looks, alpha 0.05).* The mixture sequence was ever wrong in 1.7 percent (m = 0.01), 2.4 percent (m = 0.05) and 3.6 percent (m = 0.2) of sequences, within the nominal 5 percent. A 95 percent Wilson interval checked at every step from t = 20 was ever wrong in 38.3, 47.7 and 49.6 percent. This is why the Wilson check is not used. Cost: with zero harmful events the sequence needs 53, 116, 320 and 680 clusters to show an upper bound at or below 0.10, 0.05, 0.02 and 0.01 at alpha 0.05 (77, 165, 442 and 924 at alpha 0.005), against 29, 59, 149 and 299 for the fixed-sample bound at 0.05; roughly twice as many. Tuning of the mixture prior is allowed only by pre-registered simulation.

*Promotion.* Data come from shadow operation at the current level: pairs `(would-be action, adjudicated correct action)` with labels from the outcome verifier or panel (T0 or T1), never from the deciding model and never from agreement with humans alone (imitation). A promotion item for `AL(n) -> AL(n+1)` is created automatically when all hold: the number of distinct vendor clusters is at least `n_min`; `U_t(harm) <= epsilon_L` at `alpha_cell`; for restrictive-action cells `U_t(false_hold) <= epsilon_cost`; there is no unresolved incident in the cell; `policyMajor` is unchanged since the window opened; the precedent condition of C9 (M6's `autonomySupport`) holds for a target of `AL2` or above. Starting values (to be pre-registered with a domain reviewer): `epsilon` 0.10, 0.05, 0.01 for `AL0` to `AL1`, `AL1` to `AL2`, `AL2` to `AL3`. `alpha_cell = 0.05 / (number of cells * number of levels)` fixed in advance (union bound, simple and conservative). The item type is `ladder_promotion` (C13), carries the serialised sequence state `(k, t, alphaPpm, U_tPpm)`, and needs two distinct approvers for any promotion to `AL2` or above.

*Demotion (automatic, cannot be blocked by a queue item).* To `AL1` immediately on: an adjudicated harmful decision at that level; a validator-failure rate whose confidence-sequence lower bound exceeds its limit; a rule change whose footprint touches the cell (computed from C1's static cone); the kill switch; a shift alarm. To `AL0` on a second demotion within a cooldown. After a demotion the window is reset and `n_min` doubles for the next promotion (ratchet).

*Persistence.* `autonomy.promoted | demoted | frozen` events in the M9 ledger with the sequence state, so the level at any time is recomputable from the ledger. These names are not in M9's leaf registry (INT-049) and must be added there; see the integration block.

**7. Tests and acceptance.** `T-LAD-01` coverage simulation of the sequence, plus the Wilson contrast. `T-LAD-02` no promotion below `n_min` clusters. `T-LAD-03` a planted harmful decision demotes within the same decision flow. `T-LAD-04` a rule change touching the cell demotes; one outside it does not. `T-LAD-05` state-machine property tests: no skipped level, no promotion without an approved item, demotion not blockable, ratchet. `T-LAD-06` peeking simulation: a user inspecting after every case promotes wrongly at most `alpha_cell`. `T-LAD-07` inert stub (a ladder that promotes after 1 case fails). `T-LAD-08` the confidence limit against published `confseq` or paper vectors, offline (availability NOT VERIFIED). Metrics: false-promotion rate in simulation, time to promotion, share of cells never promoted. Methodology validation only (DEC-06).

**8. Risks and NOT VERIFIED.** The epsilons and cooldowns are placeholders; promotion statistics rest on outcome labels our simulator authors; cluster thinning discards information; the union-bound spend is conservative and may keep every release cell at `AL1` in small data, which is an honest outcome to report.

**9. Build notes.** Sequence primitive with simulation first, then the state machine, then wiring to C9/C10/C13, last the ledger events. Unblocks the autonomy gate in C16.

# C13. Approval item semantics: fail-closed rules, identity binding, segregation of duties

*Ownership (INT-029).* There is one approval service. M13 owns storage, WebAuthn verification, step-up, the expiry clocks and the API (it is the case-bound, money-moving path). M8 owns the primitives (`AuthenticatedPrincipal`, the identity registry, alias detection). This component owns the **item semantics as policy data**: item types, slots and eligibility (`distinctFrom` rules, assurance), what expiry means per type, and the digest binding rule. Q1 to Q8 below are the semantics the service must enforce; they are tested here against an in-memory fake and again against M13's service as a conformance suite.

**3. Best references.** `prior-art/05` §10.5 (item types, default deny on timeout, idempotency key, evidence, expiry); `prior-art/09` §9.5 (segregation as verified constraints, liveness, workflow satisfiability naming) and the workflow-satisfiability papers of Crampton and Gutin ([1301.3402](https://arxiv.org/abs/1301.3402)) and Karapetyan et al. ([1412.7834](https://arxiv.org/abs/1412.7834)), seen at summary level only; MakerChecker (AGPL, idea only: the proposer of an irreversible action cannot approve it); `prior-art/15` §2 and §6 item 7 (ACFE: collusion defeats four-eyes, so a pattern view is needed); AgentBound ([2606.30970](https://arxiv.org/abs/2606.30970)) for a signed receipt binding an approval to what was approved.

**4. What they actually do.** The workflow-satisfiability literature asks whether a set of constraints (distinct users per step, separation rules) can be satisfied by the available people at all; a control that cannot be satisfied is bypassed in practice (09 §9.5). MakerChecker enforces the proposer-cannot-approve rule at a gateway. None binds approvals to a replayable digest or treats expiry as a first-class deny.

**5. Decision. Own the item semantics; M13 owns the service.** The service is an append-only event log folded to state, so it replays; approval is a record bound to a digest, not a flag.

**6. Implementation design.**

```ts
// ApprovalItemType and ApprovalState are the shared types; ApprovalItem is M5's generalised shape (`caseId` optional so non-case items fit).
// ApprovalRequest (M13) is the case-bound payload of an `action` item; ApprovalRecord is M13's (requestHash, WebAuthn assertion) extended with `slot` and `evidenceOpened`.
interface Binds { factSetHash: Hash; policyHash: Hash; verdictHash: Hash; actionDigest: Hash; ledgerSeq?: number; listVersion?: string; vendorMasterVersion?: string }
interface ApprovalItem { id: Id<"ap">; type: ApprovalItemType; caseId?: Id<"case">; payload: Json; binds: Binds; slots: ApprovalSlot[];
  state: ApprovalState; clocks: ApprovalClocks;     // requestExpiresAt, approvalWindowSec, capabilityTtlSec
  createdAt: Iso; escalation: { afterFraction: number; chain: string[] }; idempotencyKey: string; mustOpen: Id<"ev">[] }
interface ActorBinding { subject: string; issuer: string; roles: string[]; reportingLine: string; authMethod: string; authTime: Iso; sessionId: Hash; deviceId?: Hash; assurance: "standard" | "high" }   // projection of M8's AuthenticatedPrincipal
interface ApprovalRecord { requestHash: Hash; itemId: Id<"ap">; slot: string; approver: ActorBinding; decision: "approve" | "reject"; reasonCode: string; reasonText?: string;
  evidenceOpened: { ev: Id<"ev">; at: Iso }[]; authn: "webauthn"; assertion: string; at: Iso }   // challenge derived from the request digest; M13 verifies
```

*Fail-closed rules (each is a test row).*
- Q1 Expiry denies. A pending item whose `requestExpiresAt` passes (read from `ctx.clock`) becomes `expired_denied` by an appended event. Three clocks exist and are named: `requestExpiresAt` (pending-request lifetime), `approvalWindowSec` (the window W within which several approvals must arrive) and `capabilityTtlSec` (M12/M13's, outside this module). Effects: `action` moves the case to the phase `HELD` with disposition `expired_unapproved` and a review timer, not to `CLOSED`; a held case can be re-requested; `memory_write` not written; `rule_proposal` closed unactivated; `ladder_promotion` no change; `judge_loosening` the case keeps `r`; `dispensation` not granted; `roster_change` unchanged; `emergency_ratify` the emergency tightening lapses (that one tightens only, so lapse is the one place where "deny" loosens, and it is bounded to 72 hours by C7 and shown).
- Q2 Anything not exactly valid is not an approval: unknown type, digest mismatch, unbound approver, duplicate approver, expired item, missing evidence-opened events, world changed since creation, assurance below the required level.
- Q3 Invalidation. A list update, vendor-master change, fact-set change, policy activation that makes the verdict more restrictive (C7), or an exposure `ledgerSeq` mismatch moves pending items to `invalidated`; M13 emits `world_changed` and a fresh decision run starts (waiting is a case state, not an in-run interrupt). The broker re-validates the same fields at execution (spec 14a); this module defines which changes invalidate which items, M13's service holds the pending items, and the broker owns the capability and the instant of execution.
- Q4 Eligibility is computed, not asserted: `eligible(approver, item)` evaluates the item's slots (role present, `distinctFrom` against the case's requester, vendor-master editor, proposer and rule author **by identity-provider subject**, distinct from the other approvers on the item and, where required, in a different reporting line, assurance level).
- Q5 Friction at the gate only. M13's service refuses an approval whose record lacks an `evidenceOpened` event for each id in `mustOpen` (the evidence of claims in the minimal robustly sufficient set, any `contested` claim, and the ERP-versus-claim diff). The UI shows it, the server enforces it, and events are logged. No dwell-time rule.
- Q6 Liveness at creation. I5 is evaluated with the current roster and availability when the item is created; if no eligible approver exists the system raises `NO_ELIGIBLE_APPROVER` at once instead of letting the item expire silently; at `afterFraction` of the lifetime the item escalates along the declared chain; escalations are rate-limited per vendor and per requester so that escalation cannot be used as a denial-of-service lever (M8).
- Q7 Only the authenticated console API accepts approvals. The function takes an `AuthenticatedPrincipal` constructible only by the session verifier (module-private class with a runtime registry, per M8); MCP and A2A expose no approval capability (spec 14). The approval is a WebAuthn assertion whose challenge is derived from the request digest, verified by M13; assurance levels and the identity provider are NOT VERIFIED until an IdP exists, and the demo uses a labelled simulated identity provider with distinct test subjects.
- Q8 Memory-write approvals and attestations do not change trust: a person approving a write from an `UNTRUSTED` source stores it with `approvedBy` (`attestedBy` for an attestation) and never a label change; the trust level stays below `SOR` (spec section 5, "human confirmation is not a level"), and M6 must preserve it. One test, `SEC-W1`, covers both.

*Alias and collusion signals.* Recorded as gaps and as the policy field `actors.alias_suspected`, never as a guarantee: the same `sessionId` or `deviceId` across two approver subjects, the same hashed network address and user agent inside a window, or a subject pair whose co-approval frequency is far above the base rate. Shared credentials that leave no trace are undetectable; the dossier states "distinct identities are assumed; aliasing was checked by signals S1 to S3 and is not excluded" (DEC-04).

*Pattern view.* A read-only view over past approvals: approver-requester pairs, approver pairs, approver and vendor-editor pairs, and rubber-stamp indicators (approval time distribution, evidence-opened rates). Feeds routing (avoid pairs) and the oversight-efficacy study of spec section 18; it is not a control.

*Storage.* M13's service writes the `approval.*` leaves in the M9 ledger (`approval.requested`, `approval.granted`, `approval.denied`, `approval.invalidated`); state is a fold; an idempotency key makes creation idempotent across crashes.

**7. Tests and acceptance.** The suite below is the conformance suite for the approval service: it runs against the in-memory fake in M5b's tests and against M13's service. `T-APQ-01` fail-closed matrix: every row of Q2 yields no approval. `T-APQ-02` expiry effect per item type. `T-APQ-03` an approval replayed onto another item, or onto the same item after a rebind, is rejected. `T-APQ-04` segregation: the requester, the vendor-master editor, the proposer, the rule author and an aliased second approver are each refused; a distinct pair is accepted. `T-APQ-05` the service rejects an approval lacking evidence-opened events. `T-APQ-06` invalidation on each world change in Q3. `T-APQ-07` no-eligible-approver alert at creation. `T-APQ-08` escalation rate limit. `T-APQ-09` forged `AuthenticatedPrincipal` objects rejected (AST test and forged-object test). `T-APQ-10` crash and replay: the folded state equals the pre-crash state. `T-APQ-11` memory-write approval leaves trust unchanged (property). `T-APQ-12` I5 on random rosters against brute force. Metrics: rejected-approval classes, time to approval, share expiring, escalations per vendor. Disproved if any Q2 row yields an approval.

**8. Risks and NOT VERIFIED.** Identity provider and assurance levels (none exists yet); the split with M13 is a design agreement not yet exercised by an implementation; the expiry-denies rule trades safety for availability, so queue health (time to approval, share expiring) is a first-class metric and the escalation chain is the mitigation, not a bypass; collusion cannot be detected from inside the system.

**9. Build notes.** M5b. Item types, slots and eligibility as data first, with the in-memory fake service (unblocks C7's apply, C8's loosening items, C12 promotions); then the conformance suite, which M13 runs against its service at step 14 (event log and fold, digest binding, friction, liveness and alarms, identity binding when the simulated IdP exists are M13's build).

---

# C14. Bounded reflexion and the two critics

**3. Best references.** Reflexion (read: `alfworld_runs/main.py`, `generate_reflections.update_memory`, `alfworld_trial.py`; `prior-art/05` §8); LangMem's bounded `max_reflection_steps` and "update only on evidence of failure" (`prior-art/05` §3); Generative Agents' fail-safe placeholders as the anti-pattern (`prior-art/05` §5); the autoformalization paper's hard-critic and soft-critic split (09 §3.11).

**4. What they actually do.** Reflexion's ALFWorld loop runs a fixed number of trials (`--num_trials`), reflects only for environments that are neither successful nor skipped, appends each reflection to a list that is never truncated, and reads only the last three on the next attempt; its stop condition is an environment oracle. We have no oracle at decision time, so the failure signal must be deterministic validators or a human. Generative Agents stores a placeholder belief when parsing fails, which is the failure we forbid.

**5. Decision. Adapt Reflexion's bounds; replace its oracle by deterministic checks and human rejection; keep the LLM critic advisory.** Alternative rejected: self-assessment as a trigger.

**6. Implementation design.**

*Hard critic (`hardCritic(draft, verdict, inputs)`, `pure`).* H1 final action is in `A` and not above `r` unless a loosening item exists; H2 every `Why` rule id is in `fired`; H3 every number or date in the rendered rationale equals the corresponding view value (rendering is from typed fields, so this is a mechanical comparison); H4 every cited claim, precedent and fact exists; H5 no cited claim is `fabricated_quote` or `invalid_citation`; H6 counter-precedent dispositions are complete; H7 the obligations in the draft equal `required[a]`; H8 the gap list caps the stated confidence; H9 the derivation hash recomputes.

*Soft critic.* A different model (a different family in the evaluation profile) scores the draft against a three-criterion rubric of 0 to 3 (reasons consistent with the typed signals; the counter-precedent dismissal is plausible; gaps acknowledged). It may add findings and may route the case to `escalate` (restrict-only); it never approves, never blocks a restriction and is never the sole trigger of a retry.

*Loop (`decideWithReflexion`).*
1. `attempt = 1`. Call the judge (C8) with the typed reflections so far.
2. If the validator rejects (T1) or the hard critic fails (T2): append a `ReflectionStep{attempt, trigger: code, ruleIds, validatorError}` and go to 1 with `attempt + 1`, up to **two retries** (three judge calls).
3. A human rejection of a recommendation (T3) re-enters at 1 with the rejected action excluded and the reviewer's reason code (and optional comment, delimited and flagged untrusted) in the reflections; this also counts against the two retries.
4. If the soft rubric is below the pass mark, allow **one** revision with the critic's typed findings; if it still fails, annotate `critic_dissent` and route to `escalate`.
5. On exhaustion (any cap, token budget or wall clock): the result is the least permissive of `{escalate, hold}` that is in `A`, with the full trail. Never a default release, never a repaired output.

*Invariants.* The ceiling of each retry is not more permissive than the previous attempt's (T-RFX-04); reflections are separate typed input and cannot alter `A`, rules or facts (the verdict hash is identical before and after, tested); reflections are case-scoped with a TTL and become episodic material for M6 dreaming, never rule input; at most the last three reflections are rendered.

**7. Tests and acceptance.** `T-RFX-01` triggers: only T1 to T3 start a retry; a soft-critic-only failure never does. `T-RFX-02` caps: an adversarial judge that always fails yields exactly three judge calls and then `escalate`; budgets are not exceeded. `T-RFX-03` verdict hash unchanged by reflexion. `T-RFX-04` monotone ceilings. `T-RFX-05` hard-critic mutation (disable each H check, the suite must fail). `T-RFX-06` ablation: reflexion on versus off and critic on versus off on the labelled decision set; metric is the fix rate of rejected outputs per extra call; if retries never fix a rejection, the retry count is set to zero and the loop becomes validate-and-escalate. Disproved if reflexion changes any rule outcome.

**8. Risks and NOT VERIFIED.** With a judge confined to typed data the retry fix rate may be low; whether the soft critic adds anything beyond the hard critic is an ablation question (spec H-roles); model-family heterogeneity is unavailable in the sponsor profile.

**9. Build notes.** Hard critic first (pure, no model), then the loop on the scripted model, then the soft critic. Unblocks C16.

---

# C15. Decision record, derivation trace for M4, policy versioning and time travel

**3. Best references.** AgentBound ([2606.30970](https://arxiv.org/abs/2606.30970)) for a receipt that lists authorities and what was decided; `prior-art/13` (provenance and replay design, M9's side); Generative Agents' `filling` evidence pointers (`prior-art/05` §5) and mem0's history table with actor attribution (`prior-art/05` §2) for the shape of an auditable record; the spec's M4 requirement that the evaluator emit a derivation trace (section 9, L4a); MADR for policy ADRs.

**4. What they actually do.** Generative Agents links each thought to the nodes that produced it but records nothing about which memories influenced an action; mem0 records each mutation with an actor. Neither records the rule or precedent basis of a decision.

**5. Decision. Own.**

**6. Implementation design.**

```ts
interface DecisionRecord {
  id: Id<"dr">; caseId: Id<"case">; seq: number; recordedAt: Iso; prev: Hash;       // chained by M9
  inputs: { factSetHash: Hash; viewHash: Hash; policyHashes: Hash[]; featureSpecHash: Hash; schemaHash: Hash; asOf: Iso;
            precedentPin: SnapshotPin; retrievalHash: Hash; actorsHash: Hash; exposureLedgerSeq: number; calibrationHash?: Hash; autonomyStateHash: Hash };
  engine: { verdict: PolicyVerdict; derivationHash: Hash; profile: "full" | "rule_brain" };
  precedent: { supporting: Id<"pr">[]; counter: Id<"pr">[]; excluded: Id<"pr">[]; knownShare: Ppm; weaklyInformed: boolean; dispositions: Disposition[] };
  judgement: { skipped?: "single_allowed_action"; callIds: Id<"call">[]; model?: string; promptVersion?: string; selection?: Action; validator: ValidatorResult; reflexion: ReflectionStep[]; criticDissent?: boolean; loosening?: Id<"ap"> };
  selective: SelectiveDecision | { mode: "not_applicable" };
  exploration?: { arms: Action[]; muPpm: Record<Action, Ppm>; chosen: Action; rngStream: string };
  autonomy: { cell: string; cellLevel: AutonomyLevel; ruleCap: AutonomyLevel; gateCap: AutonomyLevel; used: AutonomyLevel; caps: string[] };
  final: { action: Action; obligations: ObligationInstance[]; approvalItems: Id<"ap">[]; why: Why[]; gaps: Gap[]; status: "recommended" | "awaiting_approval" | "held" | "escalated" | "rejected" | "failed_closed" };
  limitations: string[] }                                                           // the scope strings of every certificate relied on
interface Derivation { nodes: DNode[]; root: number }
type DNode =
  | { id: number; k: "feature"; field: string; value: Json; status: CellStatus; label?: FieldLabel; factIds: Id<"fa">[]; spec: FeatureId }
  | { id: number; k: "atom"; op: string; operands: number[]; result: boolean }
  | { id: number; k: "rule"; ruleId: string; cond: number; fired: boolean }
  | { id: number; k: "combine"; step: "veto" | "permit" | "allowed" | "recommend" | "obligations" | "autonomy"; inputs: number[]; result: Json };
```
Derivation node ids are assigned in a deterministic traversal order, so `derivationHash` is reproducible; the production path stores only the hash, and a tracing re-run produces the DAG on demand (a test asserts the two agree). This numeric DAG is M5's internal form; M4 receives it as a `DerivationTrace` through the mapping below.

*What M4 consumes (the M5a `decide/api.ts` surface, all `pure`; INT-034).* M4 owns the `Evaluator` interface and the composition `V = phase2 ∘ phase1`, where `phase1 = M3.fuse ∘ label aggregation (M4 C9) ∘ feature extraction` and `phase2 = evaluate`. M5a supplies two halves of that and the adapters; M3's Stage A (links) is excluded from V, so fuzzy scores never appear in it.
- `featurize(bundle, snapshot): View` is the feature half of `phase1`; `evaluate(bundle, view): PolicyVerdict` is `phase2`. `V(S)` is therefore `evaluate(bundle, featurize(bundle, snapshot restricted to S))` with link judgements frozen as recorded, assembled by M4, not here.
- `reads(bundle, projection): Set<FieldName>` is the declared read set that M4's `Evaluator.reads` requires, control dependence included (every field of every atom of every rule in the projection's cone, plus the fields those rules' `needs` and `permits` atoms name). It is built from `fieldDeps(bundle): Map<FieldName, FactSelector[]>` and `coneOf(bundle, component): Set<FieldName>`, which also drive static-cone pruning of evidence in the exact minimal-evidence and minimal-flip search.
- `flipSearch(bundle, view, target, options): FlipSet[]`: the field-level, post-reconcile search; minimal sets of field edits (values drawn from the representative classes of C3, so classes of values are exhaustive for the single-field fragment) that make `target` true, each edit labelled `correctable` or `immutable` from `FieldDecl`. Exact for the IR; M4 combines it with its evidence-level search.
- `derive(bundle, view): Derivation` for certificates and for the evidence viewer's "why this rule fired", and `deriveTrace(bundle, view): DerivationTrace`, the deterministic mapping into M4's format: one node per feature, atom, rule and combine step with `id = nd_<hash(fn, fnVersion, reads, value)>`, `fn` the feature id or a fixed IR step name, `fnVersion` the feature or bundle version, `kind: derived`, and one `exo` node per cell read. `evaluatorHash` (interpreter, `featureSpecHash`, `matrixHash`, bundle) is M5's input to M4's `vSpecHash`, which is printed in every certificate.
- `revalidate(hit, bundle)` for M6 (C9) and `recomputeStage(records, changed): StageDiff` for M6 retraction: pure over the decision records and frozen fact sets that M6 supplies, so M6 needs M5a only; it reports decisions whose `A`, `r` or obligations change (exact), which only change judgement input (re-judge queue) and which are unaffected.

*Policy versioning (M5b).* `PolicyBundle` is content-addressed (C1). A `PolicyRegistry` is an append-only event log: `policy.proposed | approved | activated(effectiveFrom) | superseded | emergency_tightened | lapsed`. `activeAt(pack, asOf)` returns the hash in force at an instant. A decision records the hashes it used; feature specs are part of the bundle hash.

*Time travel.* `replay(decisionId, { policyHash?, asOf?, featureSpecHash? })` re-runs `featurize` and `evaluate` on the stored frozen fact set, changing only what is asked for, and returns `ReplayDiff{before, after, changedComponents, witnesses}`; the model-dependent stages are not replayed (they return `judgement: "not_replayed"` unless a cassette matches). `impact(proposal)` evaluates the candidate on every logged view (microseconds each, so a million decisions take seconds) and returns the count and sample of decisions that would change, split into more and less permissive; the certificate of C7 embeds this. Two time axes are kept apart: the policy's effective time and the facts' as-of time, both explicit in the query.

*Trace events.* `decide.view`, `decide.verdict`, `decide.precedent`, `decide.judge.skip|call|reject|accept|loosening`, `decide.critic.hard|soft`, `decide.reflect`, `decide.selective`, `decide.explore`, `decide.autonomy`, `decide.final`, `decide.fail_closed`, each carrying `why_kind` (`rule`, `computed`, `model_reported` or `human_reported`, INT-002) and structured reason codes; a `model_reported` or `human_reported` note is stored but never rendered as an explanation (spec 13), and a structured human decision is a `rule` reason with `ruleId "human.approval.<code>"` bound to the approval record.

**7. Tests and acceptance.** `T-REC-01` replay equality: a stored record replays to the same verdict and derivation hash with no model call. `T-REC-02` derivation hash equals the hash of the tracing re-run. `T-REC-03` M4 contract: `coneOf` is a superset of the fields whose change alters the target (checked by exhaustive single-field perturbation on the corpus); `flipSearch` results flip and are minimal by brute force on bundles up to 8 fields. `T-REC-04` time travel: replay under the original hash reproduces the original verdict; replay under a candidate matches `impact` counts. `T-REC-05` retraction: removing a fact changes exactly the predicted decisions (brute-force recomputation). `T-REC-06` the record carries scope strings for every certificate it relied on. Metrics: record size, replay latency, impact latency at 10^6 decisions. Disproved if any stored record fails to replay.

**8. Risks and NOT VERIFIED.** Retained frozen fact sets grow with the log (M9 retention and erasure interplay, INT-040: an erased body leaves a signed receipt and a tombstone, replay returns `INDETERMINATE` for that case, the verifier reports `V5.ERASED`, and M6 marks validity and retraction `unevaluable`; episodes stay immutable in id, digest and trust label); feature-spec changes across versions mean old decisions replay under old feature specs; cross-version replay under a new feature spec may need facts that were not recorded.

**9. Build notes.** M5a: the `DecisionRecord`/`Derivation` types and the API surface first (M4, M6 and M9 need them). M5b: record assembly, then registry and time travel after the gate exists. The policy-registry events (`policy.proposed | approved | activated | superseded | emergency_tightened | lapsed`) only partly match M9's leaf registry (`policy.published | approved | superseded`); see the integration block.

---

# C16. Stage orchestration, budgets and failure semantics

**3. Best references.** Spec sections 4, 21 (F-BUDGET, F-STAGES, F-SAMPLE); `prior-art/05` §10.2 (the pipeline), §10.9 (silent failure that writes junk); FoundationDB-style fault injection at the ports (spec section 4).

**4. What they actually do.** Generative Agents stores fail-safe values (importance 4, "I am hungry", "this is blank") when a call fails; mem0 raises `LLMError` and `VectorStoreError` instead (`prior-art/05` §10.9 item 3). We follow mem0.

**5. Decision. Own.** One rule governs every non-success path: the result is a restrictive action with a reason code, or no decision at all; never a permissive default.

**6. Implementation design.**

| Step | Work | On failure |
|---|---|---|
| 0 intake | validate `DecideInput`; load policy stack (`check`), calibration bundle, autonomy snapshot | `failed_closed`: `hold` with `INPUT_INVALID` / `POLICY_UNLOADABLE` |
| 1 featurize | run feature programs; copy each cell's `status` (all five `CellStatus` values are kept: `resolved`, `unresolved`, `silent`, `not_checked`, `unavailable`) and its full label (trust, authorship, producer, write origin); no numeric level is computed (INT-014); materialise the `permits` display cache by `permitsClass`; a `silent` cell adds the gap `SILENT:<attribute>` (absence of a required positive fact is a hold); read facts through `supports` only (INT-013); check ranges | status `unavailable` with `FEATURE_RANGE`; permit rules that need the field cannot fire |
| 2 evaluate | stack meet; `PolicyVerdict`; derivation hash | `hold` with `EVAL_FAULT` and an incident |
| 3 precedent | call M6 `retrieve(q, pin)`; check P1 to P9 | restrict: treat as `weaklyInformed` with no supporting precedent (autonomy at most `AL1`); a P3 violation is a contract fault (`hold`, incident) |
| 4 judge | skip rule; model call; validator; loosening item | reflexion (C14) |
| 5 critics and reflexion | C14 | exhaustion gives `escalate` or `hold` |
| 6 exploration | draw among gate-filtered arms if configured (C11) | no draw; the deterministic action stands |
| 7 selective | C10 for permissive actions | abstain, final becomes `escalate` |
| 8 autonomy | C12 | `AL1` |
| 9 obligations | create approval items from `required[final]` (C13) and hand them to M13's approval service; the run ends here with status `awaiting_approval` (INT-030) | `hold` |
| 10 record | assemble, hash, append to the ledger, emit the episode proposal | if the ledger is unavailable no decision is issued (the process refuses) |

The pipeline ends at `decision.final`. Waiting for a person is a case state in M13's aggregate with its own clocks; a world change or an approval starts a fresh run, so no approval wait is nested inside this pipeline. Exploration (step 6) is drawn over the arms that already pass steps 7 and 8, so the logged `mu` is the probability of the executed action.

*Error classes (spec section 4).* `transient` (model timeout) retries inside the reserved budget, then falls to the reflexion exhaustion result; `validation` rejects and reflects; `budget` produces `escalate` with `budget_exhausted` from the finalize reserve; `policy` produces `hold`; `fatal` produces `hold`, an incident event, and a non-zero exit at the process boundary.

*Budgets (F-BUDGET).* The decide stage has its own slice: features and rules are bounded by wall clock (target well under a second), precedent retrieval by a call timeout, the judge by at most one call plus two retries plus one revision (four calls in all), each reserved before the call and charged for retries. In `SAMPLE_MODE` the deterministic steps run on any input and the model steps replay from cassettes, so a different input is a `CassetteMiss` with the instruction to run live, never a canned answer (spec section 15). The rule brain implements the judge and critic interfaces with real algorithms for credential-free runs and is labelled in every trace.

*Concurrency and state.* Per case the pipeline is sequential. Independent cases run in parallel. Shared state: the exposure ledger (compare-and-set reservation owned by M13, C6/I6), the autonomy cell state and the calibration bundle (read-only snapshot recorded in the decision; updates are ledger events applied in ledger order).

*Security.* The decide stage is a privileged compartment: it reads typed labelled values only, performs no network I/O and holds no tool. Model calls pass only the judge and critic digests. The `ViewDigest` sent to a hosted model carries identifiers, bands and booleans, never bank account numbers, and exact amounts only under the local profile (`modelProfile`, INT-020). A model prompt is an egress sink capped by that profile (INT-021): the judge call has an entry in `egress-manifest.json` (M8's `EgressEntry` schema, populated with the Zetaris and model config) naming its data class, and whether banding costs accuracy is an ablation arm.

*Entry point.* `plumbline decide` consumes the typed outputs of reconcile and explain from a bundle and writes its own record and trace (F-STAGES); the output hash must equal the in-pipeline hash.

**7. Tests and acceptance.** `T-PIPE-01` fault injection at every port (model, precedent, clock, rng, ledger, feature programs, calibration load, autonomy snapshot): in every run the final action is in `{escalate, hold, reject}` or no decision is issued; it never releases. `T-PIPE-02` the 30-rule bundle through the full pipeline on the scripted model and the rule brain. `T-PIPE-03` stage-alone equality (F-STAGES). `T-PIPE-04` budget soundness (no phase exceeds its slice; finalize reserve respected). `T-PIPE-05` SAMPLE_MODE: six scenarios with different outputs and a mutation that changes the output in replay. `T-PIPE-06` adversary-controlled model port across the whole stage (the M8 test) with the oracle "final action is never more permissive than `r` without an approval item". `T-PIPE-07` determinism: the deterministic stages produce the same record hash across runs. Metrics: per-phase time (worst of three, reported separately from medians), calls per decision, failure-path counts. Disproved if any fault-injection run releases.

**8. Risks and NOT VERIFIED.** Cassette availability depends on credentials; the per-phase budgets are placeholders until measured; the interplay of exploration and the selective gate (propensity of the executed action) is subtle and carries its own test in C11.

**9. Build notes.** Order inside the module, M5a first (C1, C2 with the verifier's second implementation, C3, C6 I1 to I3 and I7, C4, C5 bake-off before C4 grows, the C15 API), then M5b (C16 skeleton on the scripted model, C8, C14, C15 record, C13 semantics and fake, C7, C9, C10, C11, C12). The pipeline can run end to end after C1, C8, C14, C15, C16 with selective release stubbed as "abstain always" (a safe default that lets the rest be tested). M5b needs M3, M4 and M6 at step 12 and M13's ledger at step 11b.

---

# Interfaces table

| Interface | Direction | Peer | Contract |
|---|---|---|---|
| `featurize`, `evaluate`, `derive`, `deriveTrace`, `reads`, `coneOf`, `fieldDeps`, `flipSearch`, `revalidate`, `recomputeStage` (M5a) | exposes | M4 (owns the `Evaluator` and V(S)), M6, M9 verifier recompute, M10 flip panel | pure, deterministic, typed; derivation hash reproducible; `DerivationTrace` mapping (C1, C15) |
| `permitsClass`, `permission-matrix.json` | consumes | M8 | pure function and data hashed into the policy bundle; the verifier loads the same data (C1) |
| `PolicyBundle`, `FeatureSpec`, proof bundle, enumeration certificates | exposes | M9 | content-addressed, JCS-hashed; certificates carry scope strings (C3, C4, C6) |
| `DecisionRecord`, `Derivation`, trace events `decide.*` | exposes | M9, M10, M11 | chained by M9; `why_kind` on every decision (C15) |
| `Proposal<T>` to `Approved<T>` gates: `judgeGate`, `gate.apply` (rules), `autonomyGate`; `eligible` check called by the approval service | exposes | M7, M13 | only these construct `Approved<...>` (C7, C8, C12, C13) |
| `ApprovalItem` shape, item types, slots, eligibility, per-type expiry meaning, digest binding rule (policy data) | exposes | M13 (owns the service, storage, WebAuthn, clocks, API), M10 (card renders `ApprovalItem`) | fail-closed; digest-bound; conformance suite T-APQ (C13) |
| `retrieve(q, pin)`, `PrecedentRetrieval`, `validateJudgement`, `appendEpisode`; exposes `revalidate`, `recomputeStage` | consumes and exposes | M6 | M6's types; clauses P1 to P9 (C9) |
| `FrozenSnapshot`, link judgements, identity stability | consumes | M3 | typed cells with five-valued status and full label (C16 step 1) |
| `ClaimLedgerView` (incl. `canPermit`), minimal-flip digests | consumes | M4 | ids, labels, gaps only (C8) |
| `DocRisk`, `DocFinding`, `DocCompleteness` | consumes | M2 | feature registry rows (C2) |
| `evaluateManifest` statuses | consumes | M8 C6 | feature rows `manifest.<item>.status` (C2) |
| Exposure ledger view and atomic reservation; case overlay (`releaseBlock`); `TargetManifest.reversal`; outcome labels; broker re-validation | consumes | M13 | `ledgerSeq` compare-and-set; T0/T1 outcome labels (C6/I6, C11) |
| Ports `ctx.model/clock/rng/ids`, budgets, trace, `Result` | consumes | M7 | no direct effects (C16) |
| Trust lattice, permission matrix, compartment, egress manifest | consumes | M8 | `permitsClass(label, class)`; no numeric level (C1, C16) |
| Judge and critic model profiles; rule brain | consumes | M14, M12 | typed inputs and outputs (C8, C14) |
| Generators, simulators, benchmarks, pre-registration | consumes | M11 | seeded, independent draws (C10, C11) |
| Console views: queue, time travel, rule diff, flip panel, bound banner | exposes data | M10 | typed fields only |

# Spec feedback

1. **Judgement contract wording (section 10).** "May only select an action at or below the rule engine's recommended action ... any selection above the least permissive allowed action becomes a human approval item" reads two ways: if the second clause applied to every selection above the minimum of `A`, a plain confirmation of `release` would need approval and the autonomy ladder would be moot. This blueprint reads it as: selection at or below `r` is accepted (restrict-only); a selection above `r` but inside `A` is never executed and becomes a `judge_loosening` approval item; anything outside `A` is rejected. Please confirm or restate. **Resolved by INT-027** (the register adopts this reading; the spec section 10 bullet is rewritten, `floor` disappears from M14).
2. **`release` capped at `AL2` versus "auto-release" (sections 10 and 9a).** If irreversible actions are capped at `AL2`, no payment is executed without a confirm, so the selective-release bound can only describe a *fast lane* (single confirm) versus *full review*, and it holds under the rubber-stamp assumption. The spec should say so; "auto-coverage" then means fast-lane coverage. **Resolved by INT-032.**
3. **Selective risk does not compose with extra abstention.** "Auto-released: at most 5 percent harmful" is a conditional statement (G2) valid for exactly the calibrated region; further case-dependent abstention can change it either way, while the joint rate (G1) can only fall. The spec's banner text must name the region; the caution dial must move inside the certified prefix. **Resolved by INT-032** (and the guarantee-table row "Selective-release bound").
4. **Invariants I1 to I6 are only exemplified in the spec;** their definitions come from `prior-art/09` §9.2. This blueprint adds I7 (restrict-only monotonicity: fields whose labels carry no permission can only remove permission), I8 (exploration containment) and I9 (stack meet), and the lints they need (recommend and explorable toward release actions require `needs`, and every `needs` class is one the matrix refuses for `UNTRUSTED`). The spec should list nine, or say why not. **Resolved by INT-065** (spec wording).
5. **"Exhaustive cell enumeration, no solver in the loop" needs a stated fragment.** It is exact for single-field atoms and, by a closure step we still have to test, for unit-coefficient two-field atoms (cumulative exposure is one); outside it the result is `scope: partial`. Section 9a's row should say "within the enumerable fragment". **Resolved by INT-065** and the guarantee-table row "Decision correctness".
6. **Verifier recompute scope (section 13 V6 to V8).** Recomputing the verdict from a recorded view leaves feature functions outside the check. This blueprint makes features declarative `FeatureProgram` data that the recompute module also interprets; propose a level V6a "view recomputed from recorded facts". **Resolved by INT-050** (V6a added; "verifier-interpretable" becomes a gating criterion of bake-off 2).
7. **Cumulative exposure under concurrency.** I6 assumes serialisable reservation; section 14a does not say that the exposure ledger needs an atomic compare-and-set reservation including approved-but-unexecuted amounts. Add it to M13's contract. **Resolved by INT-015** (M13 owns the reservation call; M5 consumes `ExposureLedgerView` with reservations and `ledgerSeq`).
8. **Counterfactual evaluation asymmetry.** Tightening is evaluable from logs under a stated hold-cost assumption; loosening is `unevaluable` without exploration. The spec's "explicit unevaluable verdict" should say which direction, and the demo claim "evaluate any rule" should be narrowed accordingly. **Resolved by INT-061** (spec wording; C11 unchanged).
9. **Expiry denies versus liveness.** "Default on timeout is deny" without an escalation chain and an early no-eligible-approver alarm turns a safety rule into a denial-of-service lever; section 10 should add the chain, the alarm and the rate limit (C13 Q6), and name the one case where expiry loosens (lapse of an emergency tightening, bounded to 72 hours). **Resolved by INT-031** (three named clocks; expiry moves the case to `HELD`).
10. **Governance is a policy.** The rule-change tiers, roster and approval requirements are expressed as a second PPIR bundle evaluated by the same interpreter, so I4 and I5 apply to governance; the spec describes tiers as procedure only. **Resolved by INT-033.**
11. **Precedent is still needed when the judge is skipped,** because the autonomy gate depends on it (section 10 says only that the model is not called). Cost: one M6 call per decision. **Resolved by INT-065** (spec wording).
12. **Judge input and egress.** The judge digest contains case values; hosted-model use needs banding or the local profile (section 19 covers extraction, not judgement). Specify in the egress manifest. **Resolved by INT-021** (model prompts are an egress sink capped by the model profile).
13. **The spec says the model-selected action "must cite real ids";** we use short handles mapped back in code (mem0 pattern), so a fabricated id is inexpressible, and JV4 requires the cited rule to have *fired*, which is stronger than existing. **Resolved by INT-028** (handles are mandatory in model prompts; dismissals and counter checks are M6's).
14. **`unknown` and timeout in the gate are classified as loosening** (conservative); the availability cost is reported, which section 10 does not yet mention. **Resolved by INT-065** (spec wording).
15. **Stack layers.** Jurisdictions that legally require more permissive behaviour than a company rule are not expressible by meet-composition; flagged as a LAWYER and pack question. Spec wording **resolved by INT-065**; the legal question itself is **Open** (D8).

# What this blueprint does not cover

- How M3 produces cells, trust and link judgements; how M4 computes minimal evidence and flips and composes V(S) beyond the pure halves M5a supplies; M6's internal retrieval, scoring and consolidation; the approval service (storage, WebAuthn, clocks, API: M13) and the broker's capability signing and execution; the permission matrix itself (M8); the ledger and bundle format; the console's visual design. Each is another module; only the contracts are stated here.
- The business content of the policy: the real caps, windows, tiers and epsilons are placeholders for a domain reviewer (spec section 1a lists none on the team).
- Legal questions: GDPR Article 22, AI Act scoping, tipping-off rules for sanctions outcomes, and whether a jurisdiction can force a more permissive action. All LAWYER items.
- Real-world error rates: every bound, estimator and promotion statistic is validated on a simulator and an outcome process we author (DEC-06). No real harmful-release rate is claimed.
- Adaptive adversaries: the attacker stratum bound is for a fixed attack generator; the suppression residual of SEC-I18 is measured elsewhere (M8, M11).
- Anything about model quality (the judge, the critic, extraction), identity-provider details, calendar and business-day semantics beyond UTC days, multi-currency conversion truth, and scale beyond one pack.
- Not run or read: OPA's evaluator, Regorus, `ltt`, `confseq`, `progent` and the Catala default calculus (abstract or README level only); Cedar's `Long` semantics; Windows availability of the cvc5 and Lean tooling; Alethe and Carcara coverage; the OMG DMN specification. Each appears as NOT VERIFIED where it matters.
- What this document verified: repository metadata by `gh api` on 2026-10-13; Cedar's `Authorizer.lean`, `Datetime.lean`, `ExtFun.lean` and the `cedar-policy-core` extension listing; the Reflexion and Tree-of-Thought code paths named in the register; arXiv abstract pages for [1705.08500](https://arxiv.org/abs/1705.08500), [2010.09686](https://arxiv.org/abs/2010.09686), [2103.03198](https://arxiv.org/abs/2103.03198), [1810.08240](https://arxiv.org/abs/1810.08240), [2210.10768](https://arxiv.org/abs/2210.10768) and [2608.14639](https://arxiv.org/abs/2608.14639); the XACML combining-algorithm list and Camunda's hit-policy page; three small scripts of ours (binomial minimum sample sizes, Clopper-Pearson lower bounds for the validation protocol, and the Bernoulli confidence-sequence versus repeated-Wilson simulation). No third-party code was run or installed.


## Pass 3 resolutions (2026-10-13)

Source: `99b-integration-register-pass3.md` (INT-101 onward). These bindings override the body above wherever they differ; the body has not been rewritten. Each line is one binding change; the register item holds the reason and the other modules affected.

- **INT-111.** Read `PolicyVerdict` for the rule-engine output everywhere (done in the body for M5; M4, M9, M10, M11 follow).
- **INT-115.** `featurize` decides every class on a fact through M8's `permitsFact(fact, class, matrix)` over `Fact.supportLabels`; no label is read from the fact's meet trust alone. C16 step 1 uses the same call.
- **INT-116.** Add feature rows `support.<f>.allowOrigins.<class>` (integer, M8 `allowOrigins`) and the pack parameter `corroborationMin` (`ParamDecl`, `tightenIs: "up"`, default 1). `permits(f, class)` is true iff `permitsFact` is `allow`, or `corroborate` with `allowOrigins >= corroborationMin`. Add a `T-FE` row and extend invariant I7(b).
- **INT-117.** Add `claim.<id>.canPermit` as `permitsClass(chainLabel, "satisfy_manifest_item") === "allow"` from M4's published `chainLabel`; a missing chain label is not permitting.
- **INT-121.** Replace "level 0" wording by "absent and restrict-only": a missing, unknown, not-checked or unavailable input makes every `permits` atom false and every hold atom true.
- **INT-122.** JV2 stays; additionally the validator tests `s ∈ A` for every selection and the IR asserts `A` is downward closed in the permissiveness order (`T-IR`). If the judge fails at the end of the ladder the selection is `r`, the record carries `judgeFailed` with a code, and C10 treats `judgeFailed` as outside the certified region (full-review lane).
- **INT-130.** `ApprovalItem`, `ApprovalSlot`, `Binds` and the pure `eligible(item, principal, existing)` are M5a data and code. C16 reaches the approval service only through M7's `ApprovalPort` (`submit`, `get`, `list`); M13 implements it. The pipeline still ends at `awaiting_approval`.
- **INT-131.** C13 declares the parameters `maxReissues` (default 2) and `maxRequestLifetimeSec` with `ParamDecl`; an extension is a re-issue (M13).
- **INT-133.** Ledger names for the policy lifecycle are `policy.proposed`, `policy.approved`, `policy.activated`, `policy.superseded`, `policy.emergency_tightened`, `policy.lapsed` (plus `policy.published` for bundle publication) and `autonomy.promoted`, `autonomy.demoted`, `autonomy.frozen`; M9's registry now lists them.
- **INT-135.** Policy lifecycle leaves are written into the tree of each adopting tenant; the shared bundle is identified by `policyBundleHash` and a signed `policy-catalogue.json` outside the ledger.
- **INT-136.** The decision record keeps the human `decisionCode` of an approval so M9's `V6h` can check the bound approval leaf.
- **INT-137.** `reads(projection)` and `fieldDeps` use `CellKey` values.
- **INT-138.** The policy interpreter is the first 500 lines of the verifier-side recompute budget (about 1,200 per language in total, with M3's reconcile check).
- **INT-145.** An erased episode appears only as a restrictive-direction header in `counters`; the judge may dismiss it only with `outcome_unverified` (M6's predicate holds for an erased episode).
- **INT-146.** JV5 only resolves a precedent handle to an id. JV7, JV8 and JV9 are the three outputs of M6's `validateJudgement` (counter obligation; dismissals; relied precedent valid and standing). M5 adds no logic of its own for them.
- **INT-147.** Export `classify(base, candidate): Classification` and the type `GateClassifier` from M5a (solver injected); the tiers and the gate stay in C7. `recomputeStage` stays pure over supplied records in M5a.
- **INT-152.** Register the `decide.*` events as verbs in M7's `trace-verbs.json` with their phase and agent lane (lint `TL19`).
- **INT-157.** C10's validation over 1,000 draws uses the exact conditional route: M11 E5 writes `private/harm_prob.json` (integer `Ppm` of `P(harm | features)` per case type), committed by hash before runs.
- **INT-112.** `JudgeInput` and `JudgeOutput` stay M5's policy-judge types; the L2 entailment port is M4's `EntailInput` and `EntailOutput`, so the names no longer collide.


> v5.2 (D-026): profile-pass additions for this module are in `98-profile-pass-additions.md` (adoption register ids; they win over this blueprint where they differ).
