# Module 13: Case Lifecycle, Action Broker and Monitoring

## v5.1 alignment (2026-10-15, spec section 0 wins where this blueprint disagrees)

- Add the watcher (re-open cases when a source changes, invalidate pending approvals), approvals from Slack, Teams, email and chat bound to the request digest, and the hero pack's release and bank-change actions (spec section 14b, D-020).
- Approval bound to the exact request is table stakes (Hermes, Mastra, n8n were reported to have it); implemented, not headlined (D-021).


## Integration revision (2026-10-13)

Source: `99-integration-register.md`. Nothing here is built or measured.

**Applied (INT id: what changed, where).**
- INT-002: `ApprovalRecord` carries `decisionCode` (structured human decision, a `rule` reason `human.approval.<code>`) and `note` (free text, `human_reported`, never an explanation); section 5.4.
- INT-008: RBAC role to `SiloRole` table, and the four vocabularies kept apart; section 15.4.
- INT-015: `target.reversible` and `overlay.releaseBlock` published to M5 (sections 8.4, 13.4, 3.4); exposure reservation API with compare-and-set on `ledgerSeq`, in-flight authorisations counted (section 13.4); amount ceiling re-read in step R (section 7.4).
- INT-016: `ReleaseCapability` struct dropped; the release object is the M12 `ExecutionContract` (`act/po.release`) with the M8 `ReleaseBinding`; one verification order; `NonceStore` port with two implementations; 120 s TTL; restore epoch in `aud`; signer-policy text kept (sections 1, 6, 7.4, 18.4).
- INT-017: single signer and key registry with the six roles; `KeyPort` sits behind it; capability policy is the conjunction of M9, M8 and G-FRESH; sections 6.4, 17.3, 17.4.
- INT-018: `appendBefore` for `action.intent` instead of `appendAsync`; recovery publishes the intent leaf before any resend; sections 7.4, 7.5.
- INT-024: `last_write_*`, `change_request_id`, `request_origin`, `editor_sub` columns, default-deny; sections 4.4, 4.6, 14.4, 7.4 step R.
- INT-025: kill-switch sentence and a named send boundary; sections 10.1, 10.4, 10.5.
- INT-029: one approval service owned here, M5 item semantics, M8 primitives, shared item types; sections 5.3, 5.4.
- INT-030: approval waiting is a case state; wording fixed in sections 1 and 3.4.
- INT-031: three named clocks; expiry moves the case to `HELD` (`expired_unapproved`), new T12b and T22 `re_request`; sections 3.4, 5.4.
- INT-032: `release` at AL2 is a one-approver item, `release_with_approval` multi-approver (T07); reversibility from the manifest.
- INT-033: `ParamDecl` registry with declared direction, unclassifiable means loosening; section 15.4.
- INT-040 and INT-043: M9's erasure protocol and receipt, method set `delete+salt-destroy | crypto_erase | tombstone`, one blob store with M9 as the only deleter, named consequences; section 16.
- INT-041: `submitCase` attachments by hash; section 4.4.
- INT-042: broker target calls are `ToolPort` effects, cassetted by effect slot with request-hash verification; section 7.4.
- INT-048: per-tenant ledger tree and key registry, `tenant` field on `StepCtx`, `Slot`, `LeafV1`, ports; sections 15.3, 15.4, 17.4.
- INT-049: M9 `LeafV1` and registry normative, M13 leaf names and `case:<id>` stream; section 3.4, Spec feedback 11.
- INT-056: `AuthorizePort`, `KeyPort`, tenant field, `NonceStore` as M13 storage over `FsPort`; sections 15.4, 17.3, 7.4.
- Build order V5, V9: state machine and reservation API at step 11b, approval queue at step 14, signer ledger role at 8a (sections 3.7, 5.7, 6.7, 13.7).

**Named but deliberately not applied.**
- INT-065 (spec wording for 14a, outcome-label trust, monitoring as repository depth): spec-text edits only; the blueprint body already states the rule, so only Spec feedback 4, 13, 14 are marked.
- INT-016 item "M12 `ConsumedWal` which M13 implements": superseded by the `NonceStore` port; a SQL implementation of the port is named, not built (section 26).
- INT-054 (trace schema fields): does not name M13; M13 trace events stay in M7's format and inherit the fields.

**New contradictions found.**
- INT-016 item 5 says the assertion challenge equals H(body without approvals); M13's challenge also includes `sessionNonce` for replay resistance. Resolved here by recomputation (the request carries `bindingDigest`, section 5.4). M8 C5 and C16 must accept this or drop the nonce.
- INT-017's role set has no role for the broker receipt key or the approval countersign key. M13 removed both (receipts bound by ledger leaf and WAL chain). M9 to confirm, or add a `receipt` role.
- INT-018 names the write-ahead leaf `release.intent`; INT-049 renames it `action.intent`. M13 uses `action.intent`; the register should use one name.
- The signer must check WebAuthn assertions (M8) but nothing in M8 or M9 says where it gets credential public keys. M13 proposes inclusion-checked enrolment leaves; M9's registry has no such leaf type.
- The shared `ReleaseBinding` has no reversal `direction` field; M13 expresses origin-only reversal by setting `payee` and `accountCommit` to the original origin. M8's minting policy for `payment.reverse` (one approver) must agree. M9's `approval.granted` is described as one leaf; M13 emits one per accepted `ApprovalRecord`.

Status: design blueprint. Nothing here is built or measured; every behavioural statement is a hypothesis with a named test, and anything not seen is marked **NOT VERIFIED**. Refines spec v3.1 section 14a, with sections 5 (execution safety residuals), 10 (autonomy and approval), 18 (governance), 21c gaps 2, 3 and 6, and 22. Conventions: `00-conventions-and-shared-types.md`. Section references like `(15 §1)` point into `docs/design/prior-art/`.

## 1. Scope and contract

**Purpose.** M5 decides; M13 owns everything that happens to a decision over time. It wraps M5's output in a durable, replayable **case lifecycle**, is the **only component allowed to cause an effect** (the action broker), records what happened and what it later turned out to mean (receipts, outcome labels), keeps watching the vendor portfolio after release (continuous monitoring), and carries the operational controls an enterprise needs (tenancy, access, retention, keys, recovery, upgrades, incidents).

**Inputs.** Case submissions, with attachment references whose bytes are delivered to the content store by hash (M10: MCP `submit_case`, A2A tasks, console, ERP events, monitoring alerts); `Decision` records and `ApprovalRequirement` obligations from M5 (typed, with the policy bundle hash); fact-set hashes from M3; list and registry updates from M1; vendor-master and payment events from enterprise connectors; approver identity assertions from the identity provider.

**Outputs.** Case state transitions (trace events with `why`, ledger leaves); approval items for M10; signed release contracts (an M12 `ExecutionContract` with capability `act/po.release` and an M8 `ReleaseBinding`, minted by the M9 signer outside M13, verified and consumed inside it); the exposure reservation API and the `target.reversible` and `overlay.releaseBlock` inputs for M5; action receipts; reversal records; `OutcomeLabel`s and `LoggedDecision` rows for M5/M6/M11; monitoring alerts that open or refresh cases; portfolio views; operational metrics.

**Depends on.** M7 ports (clock, ids, rng, effects, budgets, trace, `ledger` with `append | published | appendBefore`, the tenant field on every port), M8 (trust lattice, `ReleaseBinding` contents and minting policy, authentication primitives, restrict-only gate), M9 (ledger, the one signer process and key registry, erasure protocol, bundle export), M1 (connectors as channels, document intake 11j), M3/M5a (re-run of the deterministic stages on a delta), M12 (`ExecutionContract` container and its verify and consume rules). **Depended on by** M10 (console, MCP, A2A), M6 (outcome labels, precedent), M11 (simulated payment system, lifecycle property tests, generators), M9 (`action.*` leaf types, V8 invariants).

**Boundary rules this blueprint fixes (the spec leaves them open).**
- A **case** is a durable entity that outlives many M7 **runs** (initial decision, re-run after invalidation, appeal). Approval waiting is a case state, not an M7 interrupt inside a run: a decision run ends at `decision.final`, the case aggregate holds the wait with its own clocks, and a fresh run starts after `world_changed`. The M7 human-step interrupt is kept for in-run human questions only (INT-030; `Spec feedback` 1).
- There is **one release mechanism**: the M12 `ExecutionContract` with `scope.capabilities = ["act/po.release"]` and `scope.release: ReleaseBinding` (INT-016). Split of ownership: M12 owns the container and its verify and consume rules; M8 owns the `ReleaseBinding` contents and the minting policy (the gate constructs `Approved`); M9 owns the signer process; M13 owns the broker, the `NonceStore` port, execution-time re-validation and the approval service. M13 defines no release-capability type of its own.
- Everything the broker does is idempotent by key, write-ahead logged, and re-validated at the moment of effect.

## 2. Component list

1. Case state machine and event-sourced case aggregate
2. Intake, assignment and service levels
3. Approval queue, approver authentication and identity binding
4. Release contract: `ReleaseBinding` use, signer policy contribution, verifier
5. Action broker core: intent log, single-use nonce (`NonceStore`, two implementations), idempotency, recovery, re-validation, independent confirmation
6. Target adapters and the simulated payment system with fault injection
7. Receipts, reversal and compensation
8. Kill switch and in-flight stop
9. Outcome feedback
10. Appeals and reopening
11. Continuous monitoring: triggers, impact analysis, cadence, portfolio views
12. Enterprise connectors
13. Tenancy, isolation, role-based access and policy ownership
14. Retention, legal hold and data deletion
15. Key management and rotation
16. Backup and recovery
17. Observability and cost tracking
18. Upgrades and migrations
19. Incident response
20. Capacity and cost model
21. Lifecycle property tests and the formal model of the broker protocol

Components 13 to 19 are designed now with acceptance criteria and built after the core (spec section 14a); none is claimed until built and tested.

## Reference ledger (verified this session; metadata from `gh api` on 2026-10-13 unless stated)

| Reference | Stars / licence / last push | What was read |
|---|---|---|
| flowable/flowable-engine | 9585 / Apache-2.0 / 2026-10-13 | **Code**: `PlanItemInstanceState.java` (CMMN plan-item states) |
| camunda/camunda | 4318 / GitHub reports no SPDX (source-available; licence **NOT VERIFIED**) / 2026-10-13 | **Docs**: Camunda 8 timer events page |
| conductor-oss/conductor | 32292 / Apache-2.0 / 2026-10-12 | metadata only, not studied |
| statelyai/xstate | 30294 / MIT / 2026-10-13 | **Docs**: pure transition functions page |
| tigerbeetle/tigerbeetle | 17189 / Apache-2.0 / 2026-10-13 | **Docs**: `coding/two-phase-transfers.md`, `coding/reliable-transaction-submission.md`, `reference/requests/create_transfers.md` result codes |
| Shopify/toxiproxy | 12412 / MIT / 2026-10-08 | **README**: toxic list |
| dubzzz/fast-check | 5199 / MIT / 2026-10-13 | **Docs**: model-based testing page |
| tlaplus/tlaplus | 3116 / MIT / 2026-10-13 | metadata only |
| benbjohnson/litestream | 14485 / Apache-2.0 / 2026-10-09 | metadata only |
| openbao/openbao | 8419 / MPL-2.0 / 2026-10-13 | metadata only |
| eclipse-biscuit/biscuit | 1165 / Apache-2.0 / 2025-10-21 (no push for a year) | **README** lines on attenuation and offline verification |
| formancehq/ledger | 1433 / MIT / 2026-10-13 | metadata only |
| temporalio/temporal, sdk-typescript, wiremock, hoverfly | see `13 §4.4` | Temporal **docs** on retry policy and at-least-once Activities, fetched this session |
| Interagency Guidance on Third-Party Relationships (Federal Register, 9 June 2023) | n/a | **Text**: section C lifecycle, "4. Ongoing Monitoring" in full (fetched from govinfo) |
| Stripe API, "Idempotent requests" | n/a | **Docs** page |
| RFC 9470 (OAuth step-up), RFC 9396 (Rich Authorization Requests), W3C WebAuthn Level 3 | n/a | abstracts and quoted definitions |
| OMG CMMN 1.1 (December 2016) | n/a | landing page only |
| NIST SP 800-57 Part 1 Rev. 5 (May 2020), SP 800-61 Rev. 3 (April 2025) | n/a | abstracts |
| PostgreSQL docs, row security | n/a | **Docs** page |
| Companies House Streaming API; GLEIF concatenated files; OFAC Sanctions List Service | n/a | overview pages |
| ERPNext / Frappe REST API; Odoo external API | n/a | **Docs** pages |
| microservices.io Saga pattern | n/a | **Docs** page |
| arXiv 1811.06109, 2604.15740, 2608.08577 | n/a | abstracts (2605.29272: search-listing sentences only) |

Not verified and not relied on: the IETF `Idempotency-Key` header draft (fetched: draft-07, 2025-10-15, **expired**, requirements text not retrievable), PSD2 RTS Article 5 "dynamic linking" (EUR-Lex fetch returned no text), Modern Treasury payment-order documentation (404), SCIM RFC 7644, ISO 20022, Nacha return rules. Where these would have informed a choice, the design states its own rule instead.

---

## 3. Component 1: Case state machine and event-sourced case aggregate

### 3.1 Best references
- **CMMN 1.1** (OMG, December 2016): a case meta-model with plan items, sentries and milestones; landing page read only. Not a lifecycle for approvals; relevant as the standard vocabulary for case-state models.
- **Flowable CMMN** (above): the one open-source engine read in code.
- **Camunda 8 / BPMN timers** (docs): interrupting versus non-interrupting timer boundary events.
- **XState** (docs): pure transition functions.
- **Temporal** (`13 §4.4`): history replay with a non-determinism error; sagas via workflow code.
- Procurement process and third-party lifecycle: `15 §1` (Planning, Due Diligence and Selection, Contract Negotiation, Ongoing Monitoring, Termination).

### 3.2 What they actually do
- Flowable `PlanItemInstanceState` (code): spec states `available, enabled, disabled, active, completed, failed, suspended, terminated`; `TERMINAL_STATES = {completed, terminated, failed}`. It then adds **non-spec intermediate states** (`async-active`, `async-active-leave`, `wait_repetition`, `unavailable`); the file's own comments say these exist because an instance must be persisted while an asynchronous step is pending. Lesson: asynchronous effects need explicit in-flight states, not a hidden "active".
- Camunda docs: an interrupting timer boundary event "terminates" the activity when it fires; a non-interrupting one can fire repeatedly without stopping the activity. Maps exactly onto SLA warning (non-interrupting) versus approval expiry (interrupting).
- XState docs: `transition(machine, state, event)` returns `[nextState, actions]` and "won't execute" actions; state serialises to JSON and resumes. That is the shape we need (pure fold, effects returned as data). The docs say nothing about mandatory reasons or table hashing.
- The interagency guidance describes the lifecycle as "continuous", not linear; ongoing monitoring feeds back into earlier stages.

### 3.3 Decision
**Own, adapting the XState pure-transition shape and the Flowable lesson on explicit in-flight states.** A small table-driven machine (a few hundred lines) whose table is **data, hashed under JCS** (`lifecycleHash`), with a mandatory `why` on every transition and typed guard identifiers. Rejected: adopting XState or a BPMN/CMMN engine as the lifecycle (adds a dependency to a judge-run path, cannot enforce our `why` and hashing invariants without wrapping, and Camunda's licence is not verified). XState may be used **as a differential oracle only**: the same table is compiled to an XState config in tests and reachable-transition sets are compared (feasibility **NOT VERIFIED**).

### 3.4 Implementation design

**Aggregate.** A case is an append-only event log per case (JSONL, each event carries `prevHash`, `seq`, `at` from `ctx.clock`), `state = fold(step, events)`. Events are the audit-relevant subset mirrored to the M9 ledger on the per-tenant `case:<id>` stream (`case.opened`, `case.transitioned`, `approval.requested | granted | denied`, `capability.issued`, `action.*`; M9's `LeafV1` and registry are normative, INT-049; `Spec feedback` 13). Every ledger-relevant effect has a leaf, every leaf has a WAL or case-log origin.

**Phases (the lifecycle region).** `INTAKE, ASSIGNED, GATHERING, REVIEW, ESCALATED, APPROVAL_PENDING, APPROVED, EXECUTING, EXEC_UNKNOWN, CONFIRMING, HELD, CLOSED, APPEAL`. `EXECUTING` means an intent is durable and the target has not answered; `EXEC_UNKNOWN` means the target's state is not known (never collapsed into failure); `CONFIRMING` means the target accepted and independent confirmation or settlement is pending. `REOPENED` is not a state: it is a transition `CLOSED -> GATHERING` that increments `episode`.

**Orthogonal regions** (statechart style, evaluated independently): `sla` (clock per phase, section 4), `overlay: { legalHold: boolean, frozen: boolean, releaseBlock: boolean }`. Overlays do not change the phase; they add guards (`frozen` blocks every effect transition, `legalHold` blocks deletion, `releaseBlock` blocks mint and execute). This avoids a state explosion and mirrors CMMN's `suspended` as a flag rather than a branch. `releaseBlock` is published to M5 as the feature `overlay.releaseBlock` (restrict-only: it can only shrink the allowed action set, only a human with a role may lift it, and a missing or unreadable value is read as blocked, INT-015).

**G-FRESH** is one named guard with one definition, used twice: by the case manager before it asks the signer for a signature (T09) and by the broker at execution (step R, component 5). It holds when `factSetHash`, every `listVersions[l]`, `vendorMasterVersion`, supersession state and the exposure `ledgerSeq` seen at decision time equal the current values in the frozen guard environment `g`. The signer cannot read the ERP and is not given that power; the residual between the last re-read and the send is the one stated in M8 C19.

```ts
type Phase = "INTAKE"|"ASSIGNED"|"GATHERING"|"REVIEW"|"ESCALATED"|"APPROVAL_PENDING"|"APPROVED"
           |"EXECUTING"|"EXEC_UNKNOWN"|"CONFIRMING"|"HELD"|"CLOSED"|"APPEAL";
type Disposition = "released_confirmed"|"released_reversed"|"held"|"rejected"|"cancelled"
                 |"expired_unapproved"|"failed_not_sent"|"superseded"|"appeal_upheld"|"appeal_overturned";
interface CaseState {
  caseId: Id<"case">; tenant: TenantId; episode: number; phase: Phase; disposition?: Disposition;   // disposition is also set on HELD (expired_unapproved, held)
  machineVersion: string;                       // pins the table this case runs under
  factSetHash: Hash; policyBundleHash: Hash; listVersions: Record<string,string>; vendorMasterVersion: string;
  decision?: DecisionRef; approvalReq?: ApprovalRequirement; approvals: ApprovalRecordRef[];
  capId?: Id<"cap">; assignee?: PrincipalRef; overlay: { legalHold: boolean; frozen: boolean; releaseBlock: boolean };
  sla: SlaClockSet; lastSeq: number; stateHash: Hash;
}
interface Transition {
  id: string; from: Phase | Phase[]; event: CaseEvent["kind"]; guards: GuardId[]; to: Phase;
  effects: EffectIntent[];                      // declared, returned as data, executed by the runner
  ledger: boolean; reasonCode: string;
}
declare const TABLE: readonly Transition[];     // hashed: lifecycleHash = H("plumbline.lifecycle/v1" || JCS(TABLE))
pure function step(s: CaseState, e: CaseEvent, g: GuardEnv): Result<{ next: CaseState; effects: EffectIntent[]; trace: TraceEvent }, TransitionError>;
```
`step` is pure: guards read only `s`, `e` and `g` (a frozen environment of current list versions, vendor-master version, clock reading, authorization decisions, passed in by the runner, never fetched inside). The runner executes `effects` through ports. A transition with no matching table row, or with a failing guard, returns `TransitionError{ code, failedGuard }`, is itself traced with a `why`, and changes nothing.

**Transition table (normative; `L` marks ledger leaves).**

| Id | From | Event | Guards | To | Notes |
|---|---|---|---|---|---|
| T01 | (none) | `submitted` | schema, intake caps, dedupe | INTAKE | L `case.opened`; duplicate links to existing case instead |
| T02 | INTAKE | `assigned` | eligible assignee, no conflict of interest | ASSIGNED | L |
| T03 | ASSIGNED | `run_started` | budget available | GATHERING | starts an M7 decision run |
| T04 | GATHERING | `decision_ready` | decision hash valid | REVIEW | decision `hold`/`reject` skip to T10 |
| T05 | GATHERING | `gap_replan` | replan visits < 2 | GATHERING | F-REPLAN stays in phase |
| T06 | REVIEW | `escalate` | role may escalate | ESCALATED | also automatic on SLA breach policy |
| T07 | REVIEW, ESCALATED | `approval_requested` | decision allows release or release_with_approval; not frozen; not releaseBlock | APPROVAL_PENDING | creates an `action` approval item with the three clocks (section 5.4); `release` at AL2 yields a one-approver requirement, `release_with_approval` a multi-approver one (INT-032) |
| T08 | APPROVAL_PENDING | `approval_recorded` | approver authenticated, SoD, binding hash matches, requirement not yet met | APPROVAL_PENDING | accumulates; L `approval.granted` per accepted record (`approval.denied` for a denial) |
| T09 | APPROVAL_PENDING | `approvals_complete` | requirement met, all approvals inside window W, world unchanged (G-FRESH), exposure reservation accepted (compare-and-set, section 13) | APPROVED | the `approval.granted` leaves are published before the signer is asked; L `capability.issued`, published before the contract is handed to the broker (minted by the signer, section 6) |
| T10 | REVIEW, ESCALATED, GATHERING | `decided_no_release` | decision is hold or reject | HELD or CLOSED | hold keeps a review timer |
| T11 | APPROVAL_PENDING, APPROVED | `world_changed` | list update, vendor-master or fact-set change, exposure `ledgerSeq` move (`ledger_moved` at mint) | REVIEW | L `approval.invalidated`; capability, if any, revoked |
| T12 | APPROVAL_PENDING | `approval_denied` | n/a | CLOSED (`rejected`) | default deny |
| T12b | APPROVAL_PENDING | `request_expired` | n/a | HELD (`expired_unapproved`) | default deny: nothing executes; the pending item becomes `expired_denied`; HELD carries a review timer and can be re-requested through T22 then T07 (INT-031; M5's "hold with `approval_expired`" is this state) |
| T13 | APPROVED | `execute` | G-CAP (unexpired, unconsumed), G-FRESH, not frozen | EXECUTING | consume plus intent is one WAL write (section 7) |
| T14 | EXECUTING | `target_unknown` | n/a | EXEC_UNKNOWN | never mapped to failed |
| T15 | EXECUTING, EXEC_UNKNOWN | `target_accepted` | receipt fields match capability | CONFIRMING | L `action.executed` |
| T16 | EXEC_UNKNOWN | `target_not_found_final` | visibility lag elapsed, cap expired or non-idempotent adapter | REVIEW | needs fresh approval; L `action.not_sent` |
| T17 | CONFIRMING | `confirmed` | independent confirmation matches; ERP posting recorded or follow-up task opened | CLOSED (`released_confirmed`) | L `action.confirmed`; schedules outcome watch |
| T18 | CONFIRMING | `mismatch` | any field differs | CLOSED (`released_reversed` after reversal) or REVIEW | alarm, incident hook, freeze policy (section 9) |
| T19 | CLOSED, HELD | `appeal_filed` | appellant eligible, inside window | APPEAL | section 12 |
| T20 | APPEAL | `appeal_decided` | independent reviewer | CLOSED (`appeal_upheld`) or GATHERING (`episode+1`) | overturn never releases directly |
| T21 | CLOSED, HELD | `reopen` | new evidence or trigger | GATHERING (`episode+1`) | old capabilities void |
| T22 | HELD | `hold_review_due` or `re_request` | timer, or a requester with the role | REVIEW | holds are a queue, not a graveyard |
| T23 | any non-terminal | `cancelled` | requester or admin; not EXECUTING..CONFIRMING | CLOSED (`cancelled`) | in-flight cases can only be stopped by the kill switch |
| T24 | any | `frozen_set` / `legal_hold_set` | role | (same phase) | overlay change, L |

**Trace events.** Each transition emits `{type:"decision", decision:{kind:"route", decider:"code", rule:"lifecycle.T09", inputs:{...}, chosen, alternatives, why}}` in the M7 format (`06 §9.8`), with the guard values it saw. `why` is generated from rule id and inputs, so it is true by construction. Failed guards are traced too (a refused transition is evidence).

### 3.5 Tests and acceptance
- Table lint: every state reachable, every non-terminal state has an exit, every effect-bearing transition has `frozen`/`releaseBlock`/G-FRESH guards, no transition into `EXECUTING` except T13, `lifecycleHash` golden test.
- Differential: independent naive interpreter of the table (and optional XState compile of the same table) must agree on a random event stream.
- Replay: fold of the stored event log reproduces `stateHash`; deleting any event makes the fold diverge or the `prevHash` chain fail.
- Mutation: remove each guard in turn; the property suite (component 21) must fail every time.
- Would disprove the design: a reachable path from `INTAKE` to `EXECUTING` that skips `APPROVAL_PENDING` while the policy requires approval.

### 3.6 Risks and NOT VERIFIED
CMMN beyond the landing page was not read; the table is ours and has not been shown to the practitioners (`04` plan). Whether auto-escalation on SLA breach is wanted is a practitioner question. XState differential feasibility not checked.

### 3.7 Build notes
First: `TABLE`, `step`, the event log and the fold with the property harness, because every later component is a guard or an effect on this table. Unblocks components 2 to 10. Build order (register section 5, V9): this component and the exposure reservation API of component 11 land at step 11b, before M5b, so that M5b is built against a real ledger; the approval queue implementation lands at step 14 and M5b's tests use a fake of it until then.

---

## 4. Component 2: Intake, assignment and service levels

### 4.1 References
Camunda timers (section 3); interagency guidance on "sufficient staffing with the necessary expertise, authority, and accountability" for monitoring (`§4 Ongoing Monitoring`, read); `09 §9.5` (no approver linked to the vendor; roster changes are approval items) and `09 §11.5` (randomise reviewer assignment to create propensities); `15 §6.7` (collusion defeats four-eyes). No open-source assignment engine was studied; the claim "no mature open reference was found for conflict-aware assignment" is a limit of this search, not a finding.

### 4.2 What they do
Camunda: timers are ISO 8601 date, duration or cycle definitions attached to activities. 09 §11.5: reviewer assignment can be randomised among reviewers of differing strictness, to make outcomes evaluable. 15 §6.7: actors (requester, vendor-master editor, approver) must be separate identities and a pattern view over past approvals is needed.

### 4.3 Decision
**Own.** Assignment is a deterministic function plus an explicit logged randomisation; SLA clocks are ours (a pure function of events and a business calendar), using ISO 8601 durations as the configuration syntax.

### 4.4 Implementation design
**Intake.** `submitCase` takes `attachments: {name, mediaType, size, bodyHash: RawHash}[]` alongside the case fields; the bytes are delivered to the content store by hash and handed to M1 channel 11j (document intake), which assigns authorship, trust and rights; M13 owns the intake caps on attachment count, size and type, M2 owns content checks (INT-041). It validates against a JSON Schema, applies **intake caps** (per requester and per vendor rate limits; spec F-BUDGET), computes `caseKey = H(tenant, payeeKey, poRef, invoiceRef, amount, currency)` and links duplicates instead of opening twins, and labels every free-text field `UNTRUSTED`. Over-cap submissions are **batched into one review item, never silently dropped** (denial of service by forced escalation, SEC-12e).

**Assignment.**
```ts
interface AssignmentPolicy { queue: string; eligibleRoles: RbacRole[]; valueTiers: {upTo: number; role: RbacRole}[]; maxOpenPerPerson: number; randomise: boolean }
pure function eligible(c: CaseState, p: PrincipalRef, sod: SodFacts): { ok: boolean; why: Why }
// SodFacts: requester sub, vendor-master editor sub (the silo contract's `editor_sub` column, M1 §15; the same value M5 reads as `actors.vendor_master_editor`), prior approvals with this vendor, linked persons (shared bank account, address, ownership edge, 09 §9.5)
function assign(c, pool, policy, ctx): { assignee: PrincipalRef; propensity: number; why: Why }
```
Steps: (1) filter pool by role and value tier; (2) drop anyone failing `eligible`; (3) if none remain, escalate to the next tier and record `assignment.no_eligible_reviewer` as a liveness alarm (the workflow satisfiability deadlock of `09 §9.5`); (4) if `randomise`, draw using `ctx.rng` seeded from `caseId` among the least-loaded eligible set and **record the selection probability** as `LoggedDecision.mu` (reviewer-assignment randomisation, `09 §11.1`); otherwise pick least loaded, ties by id.

**Service levels.** `SlaClockSet = { phase: {budget: ISO8601Duration; elapsed: ms; pausedOn: PauseReason[]} }`. The clock counts **business time** from a calendar object (pure function `businessMillis(from, to, calendar)`), and **pauses** while the case waits on something the team does not control (counterparty callback, external registry `rate_limited`, a hold). Two timer kinds mirror BPMN: **non-interrupting warning** (at 75 percent: notify, raise priority) and **interrupting breach** (policy decides: escalate, or for approvals, deny). Timers are durable `due` records; a `tick(now)` effect evaluates them. `now` comes from the clock port, and in replay the ticks are recorded effects. Default budgets are parameters (assumptions to set with practitioners), not facts.

### 4.5 Tests and acceptance
Property: assignee never equals requester, vendor-master editor or a linked person (over generated org graphs); deterministic reassignment under replay; a pause never advances elapsed; breach fires exactly once; the no-eligible-reviewer case escalates and alarms; intake flood of N cases from one requester yields one batched item and a bounded queue. Metric: **time to decision** and **SLA breach rate**, reported with reviewer workload as one curve (spec section 17).

### 4.6 Risks
Whether a real ERP audit trail exposes the identity of the vendor-master editor is **NOT VERIFIED** for any specific ERP; the silo contract now carries `last_write_*`, `change_request_id`, `request_origin` and `editor_sub` columns and the M11 generator plants them (INT-024), so the demo has them by construction. Default-deny: a missing column makes the field `UNTRUSTED` and the editor unknown, and an unknown editor cannot satisfy a segregation-of-duties check (the approval is refused, not waved through). Business calendars and time zones are an unexamined localisation item (21c.7).

### 4.7 Build notes
After component 1. Provides the queue that component 3 fills.

---

## 5. Component 3: Approval queue, approver authentication and identity binding

### 5.1 References
RFC 9470 (OAuth 2.0 Step Up Authentication Challenge Protocol, September 2023, Standards Track): resource server signals insufficient authentication via `insufficient_user_authentication`; `max_age` ("allowable elapsed time in seconds since the last active authentication event") and `acr_values`. RFC 9396 (Rich Authorization Requests, May 2023): `authorization_details` carries fine-grained transaction data such as a payment amount and creditor. W3C WebAuthn Level 3 (Recommendation, dated 25 August 2026 in the fetched page): UV and UP flags, server-produced random challenge, signature counter to detect cloning. `09 §3.9` (signed task-bound tokens plus a policy oracle contained compromised-agent actions, 60 labelled tasks, small). Draft EQR (`13 §3.1`): receipts with freshness, nonce and action binding. PSD2 RTS "dynamic linking" is named in the literature as the "what you see is what you sign" requirement; **its text was not read, so it is not cited as a source**.

### 5.2 What they do
RFC 9470 lets a protected resource demand a fresher or stronger authentication event than the token carries. RFC 9396 binds an authorisation to structured transaction details rather than a coarse scope. WebAuthn proves possession of a hardware-bound key, with user verification, over a server challenge. None of them binds an approval to our case snapshot; that composition is ours.

### 5.3 Decision
**One approval service, owned here (INT-029).** M13 owns storage, WebAuthn verification, step-up, the expiry clocks and the queue API, because it is the case-bound, money-moving path. M5 owns the item semantics as policy data (item types, slots, eligibility and `distinctFrom` rules, assurance, what expiry means per type, the digest binding rule). M8 owns the primitives (`AuthenticatedPrincipal`, the identity registry, alias detection). Only the authenticated console API accepts approvals; M10 renders `ApprovalItem`.

**Adopt the standards for authentication, own the binding.** Authentication by OIDC against the customer's identity provider with step-up per RFC 9470 for approvals above a configured value; the **approval itself** is a WebAuthn assertion whose challenge is derived from the exact approval request, so a click cannot be replayed on, or redirected to, a different case or payload. Rejected: a bare "Approve" button on an authenticated session (a stolen session approves anything); shared approver accounts (breaks segregation of duties); the model producing or relaying approvals (never; approvals exist only in the authenticated UI, spec section 14).

### 5.4 Implementation design
```ts
// ApprovalItem (M5's generalised shape: type, slots, binds, state; caseId optional so non-case items fit) is the queue entry.
// Item types served here: action | memory_write | rule_proposal | ladder_promotion | judge_loosening | dispensation | roster_change | emergency_ratify.
// ApprovalRequest is the case-bound payload of an `action` item.
interface ApprovalRequest {                      // what the approver sees and what is hashed
  id: Id<"apr">; itemId: Id<"ai">; caseId; episode; tenant: TenantId;
  card: ApprovalCard;                            // typed fields rendered by M10: payee, account (masked per role), amount, currency, ERP-vs-claim diffs, reasons, gaps, flip summary
  factSetHash: Hash; policyBundleHash: Hash; listVersions: Record<string,string>; vendorMasterVersion: string;
  bindingDigest: DocHash;                        // digest of the ReleaseBinding this approval would authorise, without `approvals`/`approvalSetHash`
  requirement: { slot: string; role: RbacRole; distinctFrom: ("requester"|"vendorMasterEditor"|"proposer"|"priorApprover")[] }[];
  clocks: ApprovalClocks;                        // requestExpiresAt, approvalWindowSec (W), capabilityTtlSec; default deny at expiry
  nonce: string;                                 // 128-bit, server random
}
requestHash = H("plumbline.approval-request/v1" || JCS(ApprovalRequest))
challenge   = H("plumbline.approval-challenge/v1" || requestHash || sessionNonce)
interface ApprovalRecord {                       // M13's record, extended with M5's slot
  requestHash: Hash; slot: string; approver: { iss: string; sub: string; role: RbacRole; displayRef: string };
  authn: { method: "webauthn"; credentialId: string; uv: boolean; acr?: string; authTime: Iso; signCount: number };
  decision: "approve" | "deny"; decisionCode: string;          // code from a closed list; a structured decision is a `rule` reason `human.approval.<code>` (INT-002)
  note?: string;                                 // free text: stored UNTRUSTED, rendered as "Approver's note, not an explanation", never counted as explanation
  evidenceOpened: { evidenceId: Id<"ev">; at: Iso }[];
  assertion: Base64Url;                          // WebAuthn assertion over challenge
  at: Iso; recordHash: Hash;
}
```
The challenge commits to the exact release binding through `requestHash`, which covers `bindingDigest`. The register's wording for the capability check ("assertion challenge equals H(body without approvals)", INT-016 item 5) is satisfied by recomputation, not literal equality: the signer and the broker recompute `bindingDigest` from the binding body, find the `ApprovalRequest` by `requestHash` in the `approval.granted` leaf, and recompute the challenge from it. A literal equality would remove `sessionNonce` and with it replay resistance (flagged in the revision block).
Steps in `recordApproval(req, assertion)`:
1. Resolve the pending request by `requestHash`; reject if expired, superseded or its case left `APPROVAL_PENDING`.
2. Verify the WebAuthn assertion against the credential registered to `approver.sub` for this tenant (RP id, origin, challenge, UV flag required for money-moving classes, `signCount` strictly increasing or the credential is flagged).
3. Check the IdP session: `auth_time` within `max_age` for the value tier, otherwise return the RFC 9470 style challenge and require step-up.
4. Check **segregation of duties** with the identity-bound data: approver `sub` not in `{requester, vendorMasterEditor, proposer, linked persons}` and not a prior approver on this request; role satisfies the requirement; `distinctFrom` honoured across approvals. These are the invariants I4 and I5 of `09 §9.2` evaluated on real subjects.
5. **Friction at the gate**: `evidenceOpened` must be non-empty for the evidence classes the policy marks mandatory; log opening events (spec section 10).
6. Append the `ApprovalRecord` (ledger leaf `approval.granted`, or `approval.denied`); when the requirement is met and every approval's `at` falls inside window `W`, emit `approvals_complete`. Otherwise stay pending. A person's approval of a `memory_write` or an attestation produces `approvedBy` or `attestedBy` and never a label change (test `SEC-W1`, M8 F11).
7. **Expiry**: three named clocks, defaults are assumptions to set with practitioners: `requestExpiresAt` (how long a pending item may sit), `approvalWindowW` (`approvalWindowSec`: the span inside which all approvals of a multi-approver requirement must fall, otherwise earlier ones lapse and must be re-confirmed) and `capabilityTtl` (`capabilityTtlSec`, section 6). Expiry of a pending `action` item sets the item `expired_denied` and moves the case to `HELD` with disposition `expired_unapproved` (T12b), never to `CLOSED`. What expiry means for the other item types is M5 policy data; the only place expiry loosens is the `emergency_ratify` lapse, bounded to 72 hours and shown (M5).

**Re-approval by diff.** On `world_changed` (section 11), the case returns to `REVIEW`; the deterministic stages re-run on the delta; if a new request is warranted, it carries a **diff against the earlier request** and requires fresh assertions. There is no silent re-binding of an old approval to a new fact set.

**Identity binding and the distinct-person assumption.** The approval service stores the enrolment records `sub -> credentialId[]` populated by the tenant admin (each enrolment is a ledger leaf, so the signer can inclusion-check a credential's public key); the identity registry, `AuthenticatedPrincipal` and alias detection are M8 primitives (M8 C16) that this service feeds and calls. Alias and shared-credential detection: one credential id mapped to two subs, one device fingerprint approving for two subs within a short window, or `signCount` regression raise `gap.identity_assumption` and block approval by the affected subs until an admin clears it. The system states, in the approval record and the dossier, that distinctness of people is assumed from the IdP and is not established by Plumbline.

**Approver authentication in the demo.** The tests drive a software authenticator (an Ed25519 or ES256 key pair held by the harness) through the same verification code; a real browser WebAuthn ceremony is exercised in the console QA pass. Both go through one verifier; the demo does not weaken the check.

### 5.5 Tests and acceptance
Unit: assertion over a different `requestHash` fails; over a modified card field fails; expired request fails; replayed assertion fails (challenge includes `sessionNonce`); `uv:false` fails for money tiers; `signCount` regression flags. Property: no approval set accepted in which one subject satisfies two roles of the same request; liveness (a roster exists that can satisfy every requirement, else the queue alarms). Attack family to add to Plumbline-Inject (closes spec 21c.3 for the approval step, not for out-of-band attestation): socially engineered "approve my case quickly" pressure messages and a forged-approval-via-MCP attempt must fail with zero approvals recorded; the oracle is the approval store, not the model.
Metrics: approval latency distribution, share of approvals with evidence opened, rubber-stamp indicators (approvals under N seconds), denied/expired rates.

### 5.6 Risks
IdP behaviours (`auth_time`, `acr` support) differ per provider, **NOT VERIFIED** for any specific one. A WebAuthn relying-party implementation in Node is a dependency or owned code; choice deferred to a short bake-off (library audit versus owned verification of a restricted subset). Oversight efficacy (do approvers catch seeded errors) is a separate measured study (spec section 18; needs participants).

### 5.7 Build notes
Needs components 1 and 2; unblocks component 4 (the signer requires the `approval.granted` leaves and the WebAuthn assertions). Queue implementation at step 14; until then M5b is tested against a fake queue that implements M5's `ApprovalItem` interface.

---

## 6. Component 4: Release contract (binding use, signer policy, verifier)

### 6.1 References
`10 §D.4` (capability binds `caseId, payeeId, accountRef hash, amount ceiling, currency, policyVersion, factIdsHash, expiry, nonce`; idempotency key per `(caseId, nonce)`); Meterless Scout `execution-contract.md` (read from `research/sponsor-reference`): contract with `scope.capabilities`, `expiresAt`, `policyPackVersion`, `risk.approvals`, HMAC signature, default TTL 5 minutes, "refused by the executor", and its own statement that HMAC "is not a cryptographic-grade defense"; `docs/sponsors/meterless-docs-readout.md` A1 (asymmetric, single-use extension; the docs address expired replay, not replay of a valid contract inside the TTL, marked **[inferred gap]** there). Biscuit (README: attenuable, offline-verifiable tokens; no single-use semantics read). Macaroons are not cited (not fetched). `13 §3.1`: Obsigna's out-of-process daemon holding the key; DSSE and in-toto (`13 §3.3`). EQR draft: PASS/FAIL/INDETERMINATE, freshness, nonce, action binding, supersession.

### 6.2 What they do
Scout signs a short-lived contract and downstream engines verify scope, expiry and signature; nothing consumes the contract, so a valid contract can be presented twice (inference from the doc; the reference code was not run). Biscuit tokens can be attenuated and verified offline, but single use needs verifier-side state anyway. The Obsigna daemon keeps the signing key out of the application process.

### 6.3 Decision
**One object, three owners, no private type (INT-016).** The release capability is the M12 `ExecutionContract` with `scope.capabilities = ["act/po.release"]` and `scope.release: ReleaseBinding`; reversal uses the same container with `action: "payment.reverse"`. M13 has no `ReleaseCapability` struct. Container fields (`aud`, `nbf`, `exp`, `nonce`, `kid`, `sigAlg`) belong to M12; the binding contents and minting policy belong to M8; the M9 signer signs; M13 verifies, consumes and re-validates. The signed bytes are the DSSE PAE over the JCS body, with Ed25519 from `node:crypto`; M12's HMAC conformance encoding is refused by the broker (`alg_not_allowed`). Rejected: Biscuit or macaroons (extra dependency and a datalog/caveat model for a token that is single-use and case-bound anyway); HMAC with a shared secret (every verifier could mint).

### 6.4 Implementation design
**Contents (owned elsewhere, consumed here).** `ReleaseBinding` is the shared-types declaration (conventions): `caseId, tenant, episode, decisionId, payee {vendorId, legalEntityKey}, accountCommit: Commitment, amountMaxMinor: MinorUnits, currency, poRef, invoiceRef?, action, factSetHash, policyBundleHash, listVersions, vendorMasterVersion, approvals[{approvalId, approverSub, approverRole, at, assertionHash}], approvalSetHash, attestationIds[], restoreEpoch`. `capId` is `cap_` plus the hex of the contract's 128-bit `nonce`, so the id, the nonce and the single-use key are one value. `aud` is `broker:<tenant>:<adapter>:<restoreEpoch>`; a reversal binding sets `payee` and `accountCommit` to the original release's origin (so funds can only return there; the shared binding has no separate direction field) and `amountMaxMinor` at most the original (component 7). Payee identifiers come from the SOR, never from extraction; the account is a salted commitment to the SOR value. **TTL:** `act/` contracts live 120 seconds (M12); the approval window and the request lifetime are separate clocks (section 5.4). Whether legitimate executions miss 120 seconds is measured (the path is automatic after approval).

**Signer: one process, one registry, per-role policy (INT-017).** There is a single signer process and key registry, specified once in M9 component 4, with the role set `ledger | decision | capability | attestation | control | erasure`. M13 contributes the **capability policy**, which is the conjunction of three checks: (1) M9's inclusion proof of the `approval.granted` leaves in a checkpoint the signer has already signed, with a fresh nonce; (2) M8's check that each approval's WebAuthn assertion binds to the body (the credential public key comes from the enrolment leaf, section 5.4); (3) M13's `G-FRESH`, evaluated by the case manager before it asks for a signature and again by the broker at execution (the signer cannot read the ERP and is not given that power). For an L3 autonomy grant (a system principal approving a reversible low-value class) the signer additionally requires a grant record that was itself approved through the `ladder_promotion` queue. `KeyPort` (component 15) is the storage and rotation interface behind the signer, not a second signing path. Consequence stated plainly: a compromised **decision process** cannot mint (it holds no key and cannot forge approver assertions); a compromised **signer process** can mint, and a compromised **approver credential** can approve within that approver's authority. These are the residual paths for `SEC-09` and M8 C19.

**Verifier (inside the broker).** Holds public keys only plus the `NonceStore` (component 5). `verifyCapability` (M8's name) and `execute` (M13's name) are one function with one order (INT-016 item 5): (1) envelope, algorithm and pinned `kid` (unknown or revoked key, unknown fields, `alg_not_allowed` refused); (2) `aud` (tenant, adapter, restore epoch) and the `[nbf, exp]` window by the broker's monotonic clock, `action` match; (3) approvals: distinct subjects, segregation of duties, assertion challenge recomputed from the bound request; (4) kill and revocation state; (5) world re-validation: list versions, vendor-master version, fact-set version, supersession; (6) fresh field equality against the ERP through the `broker` silo role (step R, component 5); (7) **atomic consume and intent last**. The broker clock is `max(ctx.clock.now(), lastObserved)` so a rolled-back wall clock cannot revive an expired contract.

**Key rotation.** `key.rotated` is a ledger leaf signed by the outgoing key (M9 owns the registry leaves); contracts are valid only if their `kid` was `active` at issue time and has not been revoked since. The restore epoch is part of `aud` and of the `restore.epoch` ledger leaf (component 16).

### 6.5 Tests and acceptance
Forgery: an executor holding only the public key cannot produce an accepted contract; flip each field of the binding and of the container (every field, generated); wrong audience (tenant, adapter, restore epoch); expired; not yet valid; unknown key; revoked key; HMAC-mode contract (`alg_not_allowed`). Signer policy tests: signer refuses without a published `approval.granted` leaf, with a WebAuthn assertion that does not bind to the body, with approvals outside `W`, with a requester-approver overlap; the conjunction is tested by removing each of the three checks in turn. Verification order: a test per step that a failing earlier step is reported before a later one and that nothing is consumed on any refusal. Ablation (spec section 12): with the contract mechanism removed, an injected unsigned release is accepted on the undefended baseline (positive control). Differential: the M12 container verifier and the broker's verifier accept and refuse identically on a generated matrix.

### 6.6 Risks
Signing-daemon IPC and key protection on Windows are **NOT VERIFIED**; the Node permission model is not relied on. The Scout field mapping is unconfirmed until the conformance runners and our adapter run. The credential public keys the signer checks come from enrolment leaves (section 5.4); M8 and M9 have not yet stated how the signer resolves them (open, see the revision block).

### 6.7 Build notes
Needs the signer process with the ledger role (build step 8a) before any capability work; the capability, attestation and control roles follow it (register section 5, V5). M8's gate, M12's container and this verifier agree on `ReleaseBinding` before any of them is coded; end-to-end exercise of the container's verify and consume is at step 14 (M12 ships a file-backed test double until then).

---

## 7. Component 5: Action broker core

### 7.1 References
TigerBeetle docs (`reliable-transaction-submission.md`): the client generates the transfer `id` and **persists it locally before submission**, retries with the same `id`, and the server answers `created` or `exists`; `create_transfers.md` defines `exists_with_different_*` results (same id, different `amount`, `flags`, accounts, `ledger`, `code`, `timeout`, ...). Stripe docs: for API v1 the first request's status code and body are saved "after endpoint execution begins" and replayed for retries "including 500 errors"; parameters are compared and a mismatch errors; keys are prunable after at least 24 hours; validation failures and concurrent-conflict requests are not saved. Temporal docs: Activities are retried by default (exponential backoff, coefficient 2.0, initial 1 s, cap 100 s) and "should be idempotent". `13 §4.2`: write-ahead effect log records the ledger leaf index; `06 §9.10`: write-ahead effect log before commit. IETF `Idempotency-Key` draft: expired, not relied on. Microservices saga page (component 7).

### 7.2 What they do
TigerBeetle and Stripe both make the **caller** responsible for a stable key and make the **server** compare the new request with the first and return the original outcome or a typed mismatch. TigerBeetle persists the key before sending so a crash cannot lose it. Stripe warns that a request rejected before execution is not recorded and is safe to retry. Neither addresses a single-use authorisation token; that is the part we add.

### 7.3 Decision
**Own, adapting the TigerBeetle key discipline and Stripe's mismatch rule.** The idempotency key is derived, not chosen: `idemKey = H("plumbline.idem/v1" || tenant || caseId || episode || capId)` truncated to the target's key length. Consuming the nonce and recording the intent are **one write-ahead entry**. Rejected: a two-step "mark consumed, then log" (a crash between them loses the intent or double-consumes: `SEC-10`); relying on the target alone for idempotency (some targets have none).

### 7.4 Implementation design

**Write-ahead log (WAL).** Segment files of framed records `len | crc | JCS bytes`, with `prev` = hash of the previous record (hash chain), per tenant. Kinds: `intent`, `attempt`, `observed`, `receipt`, `not_sent`, `freeze`, `unfreeze`, `cap_revoked`, `restore_epoch`. The `intent` record contains the nonce, `capId`, `idemKey`, `requestHash`, the exact request to be sent, and the contract hash. Uniqueness: an in-memory index `nonce -> seq` rebuilt from the WAL at start. Append protocol: take the single-writer lock, check `nonce` absent, append the framed record, `fsync`, update the index, release the lock, **return**. Nothing is sent before the call returns. A torn tail record (crash mid-write) fails its length or crc check on recovery, is truncated, and was never acknowledged, hence never acted on. **`NonceStore` is one port, owned here, with two implementations** (INT-016 item 6): (a) the single-writer WAL above with `fsync` (default for a broker that owns its tenant's WAL lock), and (b) M8's exclusive-create file per capability, `nonces/<capId>`, which holds the intent record, is created with the no-replace flag, and is `fsync`ed together with its directory (safe for racing brokers; the file must be whole-or-absent when its name appears, which `FsPort.exclusiveCreate` guarantees by writing a temporary file and then linking it without replace). M8's `SEC-A6` (crash at each point around the send) and `SEC-A7` (concurrent consume) run against both. A SQL store (unique constraint on `nonce`, one transaction for consume-and-intent) would be a third implementation of the same port; it is named, not built (section 26). `fsync` and directory-entry durability on Windows are **NOT VERIFIED**; the property test below measures crash behaviour on the actual platform.

```ts
interface NonceStore { consumeAndRecordIntent(i: Intent): Result<Consumed, AlreadyConsumed | StoreError>; }
async function execute(c: SignedContract, ctx: BrokerCtx): Promise<Result<Receipt, ExecError>> {
  // the order of INT-016 item 5; verifyCapability (M8) and execute (M13) are this one function
  const v = verifyEnvelopeAudienceApprovals(c, ctx.keys, ctx.brokerClock.now());   // steps 1 to 3 (component 4)
  if (!v.ok) return refuse("cap.invalid", v.error);
  if (ctx.kill.engagedFor(c) || ctx.revocations.has(c.capId)) return refuse("frozen_or_revoked");   // step 4
  const fresh = await revalidate(c, ctx);                                           // steps 5 and 6: step R, fresh reads
  if (!fresh.ok) return refuse("toctou", fresh.mismatches);                         // case goes to REVIEW
  const intent = buildIntent(c, fresh.record);                                      // idemKey, requestHash, request
  const k = ctx.nonces.consumeAndRecordIntent(intent);                              // step 7: ATOMIC, last; no effect before this returns
  if (!k.ok) return k.error.kind === "already_consumed" ? resumeOrReturn(k.error.prior, ctx) : refuse("store_error");
  // the intent leaf is published BEFORE the effect (INT-018): appendBefore wraps the irreversible call;
  // sendAndConfirm re-reads the kill state immediately before `TargetPort.submit`: that read is the send boundary (component 8)
  return ctx.ledger.appendBefore(() => sendAndConfirm(intent, ctx), leaf("action.intent", intent));
}
```
Leaves that must be **published before the broker acts** are `approval.granted`, `capability.issued` and `action.intent` (M9 §5.4). Result leaves (`action.executed`, `action.confirmed`, `action.not_sent`, `action.reversed`) may lag and are backfilled from WAL sequence numbers; the V8 invariant "no `action.executed` without a prior `action.intent` and `capability.issued`" then holds by `walSeq` order, which the backfill preserves. If publication fails (signer unavailable, M9 `SIGNER_UNAVAILABLE`), the broker does not send; the consumed intent stays in the WAL and recovery resumes it.

**Step R, re-validation (time of check to time of use, `SEC-11`).** Fresh reads through connectors and the `broker` silo role (the only role with a raw account read), never caches, each with trust `SOR`; `cap` below is the `ReleaseBinding`:
1. `currentFactSetHash(caseId)` from M3's maintained value equals `cap.factSetHash`, and no fact in the set has been superseded.
2. `listVersion(l)` for every list screened equals `cap.listVersions[l]` (the registry's current published version, from component 11's feed; M1 exposes `ListVersion` and `SiloPort.version(view)` for this).
3. ERP vendor row: vendor active, no `releaseBlock`, `vendorMasterVersion` equals `cap.vendorMasterVersion`, and the **independent confirmation of release fields**: `payee`, account (compared by salted commitment to `cap.accountCommit`), `currency`, `amount <= cap.amountMaxMinor`, `cap.amountMaxMinor <= min(invoice amount, PO remaining)` read fresh (the vendor-authored invoice cannot raise the ceiling, M8 `SEC-A8`), PO and invoice open and **not already paid** (duplicate-payment check against payment history), and the bank-detail `last_write_*` / `change_request_id` of the account field not newer than the attested one (a newer write origin from `vendor_portal`, `vendor_email` or `unknown` is a mismatch).
4. Cumulative exposure: the release fits under cap together with all **reservations** (component 11, section on exposure) and posted releases; the reservation made at mint is still `reserved`.
5. Connector health: if any required connector is not `ok` the broker cannot confirm and must refuse (fail closed, no cache fallback). The refusal is `hold`, with `why`.

**Send and confirm.** `TargetPort.submit(idemKey, request)` returns `Accepted{targetRef} | Rejected{reason} | Unknown{cause}`. `Accepted` writes `observed`, then component 7's receipt logic confirms independently (a query by key, never the submit response alone). `Unknown` writes `attempt` and moves the case to `EXEC_UNKNOWN`.

**Recovery (`recover()` at start and on a timer), the crash-during-execution rule.** For every `intent` without a terminal record:
1. `target.query(idemKey)`.
2. Found and fields match: write `observed` and `receipt`.
3. Found and fields differ: `receipt.mismatch`, alarm, freeze policy (component 8), incident hook (component 19).
4. Not found: trust "not found" only after the adapter's declared `visibilityLagMs` has elapsed since the last attempt. Then, if and only if the capability is unexpired, the adapter declares `idempotency` of `native` or `emulated`, the broker is not frozen, and step R passes again, **resend with the same `idemKey` and `requestHash`** (covered by the already-consumed capability because the effect is identical). Otherwise write `not_sent` and return the case to `REVIEW` for a fresh approval.
5. Query unavailable: remain `EXEC_UNKNOWN`, back off with seeded jitter (M7 error class `transient`), raise an SLA-timer alarm to a human ("payment state unknown, reconcile with the bank"). **A failed query is never read as "not sent".**
6. Backfill any missing ledger leaves from WAL sequence numbers (idempotent by `walSeq`). The backfill and publication of a missing `action.intent` leaf happens **before** step 4's resend (the intent leaf must be published before any send, INT-018); result leaves may lag.

**Concurrency.** With the WAL implementation, one broker process per tenant owns the WAL lock; with the exclusive-create implementation several brokers may race and exactly one wins the file. Two `execute` calls for the same capability: the second sees `already_consumed` and takes the resume path, which returns the first outcome. Cross-case concurrency is serialised only at the nonce-store write (short critical section).

**Determinism.** Time from the broker clock, ids from `ctx.ids`, jitter from `ctx.rng`; target interactions are ordinary `ToolPort` effects (`effectClass: "irreversible"` for `submit`), and in replay they are cassetted by effect slot with request-hash verification (INT-042), the `(adapter, op, idemKey)` plus occurrence index being the request identity the hash covers (`13 §4.4`). The tenant is a field of the slot (INT-048).

### 7.5 Tests and acceptance
(Full list in component 21.) Crash injected after every WAL write, `fsync`, send, response and ledger append of a reference run: no duplicate effect in the target's ground truth, exactly one receipt, consistent final state hash. Atomicity: kill the process between every byte boundary of an `intent` record (torn-write fuzz) and assert recovery truncates or accepts the whole record. Concurrency: N parallel `execute` of one capability, one consume, run against both `NonceStore` implementations (and, for the exclusive-create one, against racing broker processes). Write-ahead order: kill the broker between the consume and the `action.intent` publication, and between the publication and `submit`; on resume the intent leaf is published before any resend and the target is queried before any send (M9 `T-PORT-04`); with the signer down `published` fails and nothing is sent (`T-PORT-05`). Mutation: delete each check of step R in turn, or swap the order of the verification steps; its dedicated test must fail. `exists_with_different_request`: the same `idemKey` with a changed amount is refused by the adapter (positive control for the mismatch path).

### 7.6 Risks and NOT VERIFIED
Exactly-once is a property of broker plus **target** behaviour. If a real target has no queryable idempotency, the guarantee degrades to "at most once with a possible unknown", which the design surfaces as `EXEC_UNKNOWN` instead of hiding. The Windows durability question above. Multi-node deployment beyond the exclusive-create implementation would need the SQL `NonceStore` (named, not built). Waiting for a published `action.intent` adds up to one group-commit interval of latency per release (M9 starting values: 250 ms or 64 leaves); releases are low-rate, so this is expected to be acceptable (**NOT VERIFIED**, measured with the broker).

### 7.7 Build notes
Order: `NonceStore` (WAL implementation, then the exclusive-create one), verifier, `execute` with the simulated target, `recover()`, then step R connectors. Unblocks components 6 to 8 and 21. The broker and the signer-backed capability path land at step 14 (register section 5).

---

## 8. Component 6: Target adapters and the simulated payment system with fault injection

### 8.1 References
TigerBeetle two-phase transfers (docs): `pending` reserves funds without posting; `post_pending_transfer`, `void_pending_transfer`, or timeout expiry resolve it; "A pending transfer can only be posted or voided once"; completing a transfer "does not involve modifying the pending transfer" (a new transfer is created). Toxiproxy README toxics: `latency`, `down`, `bandwidth`, `slow_close`, `timeout`, `reset_peer`, `slicer`, `limit_data`, `packet_loss`; it is a TCP proxy. `13 §5` (FoundationDB and TigerBeetle fault-injection simulation method, seed printed on failure) and `§4.4` (WireMock and Hoverfly fault and scenario behaviour, studied there). Formance ledger: metadata only.

### 8.2 What they do
TigerBeetle models reserve-then-resolve payments with typed one-shot resolution, which is exactly the semantics we want from a payment target that supports a cancel window. Toxiproxy injects network-level faults between client and server; it cannot make a server commit and then lose its response *unless* the proxy drops the response direction after the upstream has processed the request (a `timeout`/`reset_peer` toxic on the downstream direction). It does not know payments.

### 8.3 Decision
**Own the simulated payment system (`SimPay`); adopt Toxiproxy's fault vocabulary, not the tool.** SimPay exposes the same `TargetPort` as real adapters, runs in-process for deterministic property tests and as a local HTTP service for end-to-end and console demos (where a Toxiproxy-style proxy may be put in front in the evaluation tier). It is labelled simulated in every receipt and UI. Rejected: mocking the broker's collaborator with canned responses (cannot express commit-then-lost-response); wiring to a real bank sandbox for the core tests (an external dependency, no determinism).

### 8.4 Implementation design
```ts
interface TargetManifest {                       // declared by each adapter; read by policy and the broker
  adapterId: string; version: string;
  idempotency: "native" | "emulated" | "none"; queryByKey: boolean; visibilityLagMs: number;
  twoPhase: boolean;                             // reserve then post/void
  reversal: "void_before_cutoff" | "return_request" | "none"; cutoff?: string;
  echoFields: ("payee"|"account"|"amount"|"currency")[];   // what a status query returns
}
interface TargetPort {
  manifest(): TargetManifest;
  submit(idemKey: string, req: PaymentRequest): Promise<Result<Accepted, Rejected | Unknown>>;
  query(idemKey: string): Promise<Result<TargetStatus | NotFound, Unavailable>>;
  cancel(idemKey: string): Promise<Result<Cancelled, NotCancellable | Unavailable>>;
  reverse(ref: string, req: ReversalRequest): Promise<Result<Reversed, NotReversible | Unavailable>>;
}
```
**Reversibility comes from the manifest, not from a model**: `reversal: "none"` makes the action class irreversible, and the autonomy cap of L2 (spec section 10) applies by rule (`Spec feedback` 5). M13 **publishes the manifest to M5** as a typed, restrict-only input `target.reversible` (INT-015): `reversible = reversal !== "none"`, and for `void_before_cutoff` only while the broker clock is before `cutoff`; an unknown adapter, a missing manifest or an unreadable cutoff reads as not reversible, which can only lower autonomy. M5 owns the conformance test of the feature; M13 owns the publication and the test that the published value follows the manifest.

**SimPay model.** Accounts with double-entry balances; payment orders with states `created -> pending_release -> released_to_bank (cutoff) -> settled`, plus `cancelled`, `rejected`, `returned` (after settlement, with a reason), `reversed`. `submit` is idempotent by key and returns `exists_with_different_request` when the key repeats with different fields (TigerBeetle-style typed mismatch, re-implemented). A hidden **ground-truth effect ledger** counts real effects per key; tests read it, never the API.

**Fault plan.** Deterministic, seeded, addressed by `(op, occurrenceIndex, idemKey)` or by probability from `ctx.rng`:

| Fault | What it models | Why it matters |
|---|---|---|
| `commit_then_lose_response` | target applies the payment, the reply never arrives | the core duplicate-payment hazard; forces `EXEC_UNKNOWN` and recovery |
| `timeout_before_commit` | request lost or slow, nothing applied | recovery must resend, not assume sent |
| `reset_peer`, `slow_close`, `latency`, `down`, `packet_loss` | Toxiproxy vocabulary at transport level | transient error class and retry budget |
| `duplicate_delivery` | the same status webhook delivered twice | receipt idempotency |
| `out_of_order_events` | settled before accepted | state merge by monotonic rank, not arrival order |
| `partial_batch_success` | k of n orders in a batch accepted | per-item receipts, no batch-level assumption |
| `delayed_visibility` | status query returns `NotFound` for `visibilityLagMs` after commit | "not found" must not be trusted early |
| `silent_drop` | accepted but never executed | caught by settlement reconciliation, not by the response |
| `mutate_field` | target echoes a different account or amount | independent confirmation must catch it |
| `return_after_settle` | late return with reason | outcome labels (component 9) |
| `cancel_after_cutoff` | cancel refused | reversal path |
| `clock_skew` | target timestamps disagree | expiry logic uses the broker clock |

**Extended coverage.** SimPay is also the data source for outcome processes: its hidden generator decides, from the M11 ground truth for each synthetic vendor, whether a released payment is later returned or confirmed fraudulent and when. The decision model never sees this.

### 8.5 Tests and acceptance
SimPay self-tests (idempotent by key, typed mismatch, one-shot resolution, expiry, the double-entry invariant `sum(balances)` constant). Fault-matrix run: every fault crossed with every broker step; invariants from component 21. A "does the harness catch bugs" control: a deliberately broken broker (no consume, or consume after send) must fail the suite (inert-stub rule, spec section 19).

### 8.6 Risks
SimPay encodes our model of payment rails, not a real rail. Real-world return windows, cut-offs and message formats are **NOT VERIFIED** (no primary source was read); the simulator proves the broker's logic, not bank behaviour. Real execution stays disabled by default (spec section 5).

### 8.7 Build notes
Build SimPay before the broker's recovery path so each step of the broker has a test target from the first line.

---

## 9. Component 7: Receipts, reversal and compensation

### 9.1 References
microservices.io Saga page: a saga is "a sequence of local transactions"; on failure "compensating transactions" undo earlier ones; the stated drawback is "lack of isolation". TigerBeetle immutable transfers (void or post creates a new record). Noa SCITT draft and Obsigna (`13 §3.1`): hash-chained signed action receipts with explicit non-claims, including "not that the effect occurred". Draft EQR: supersession. `13 §4.2`: erased body leaves an `erased` receipt.

### 9.2 What they do
Sagas undo through new forward steps rather than rollback; the isolation gap means other actors can observe the intermediate state. The receipt drafts bind a signed record to an action but disclaim that the effect happened; our receipt is stronger only to the extent that **independent confirmation** exists.

### 9.3 Decision
**Adapt the saga idea; own the receipt schema.** Reversal is an explicit, separately authorised action with its own capability, receipts and WAL entries; nothing is "rolled back". A receipt states its confirmation basis so a reader knows what it proves.

### 9.4 Implementation design
```ts
interface ActionReceipt {
  receiptId: Id<"rc">; tenant: TenantId; caseId; episode; capId; intentSeq: number; idemKey: string;
  adapterId: string; adapterVersion: string; simulated: boolean;
  request: { digest: Hash }; targetRef: string; targetStatus: string;
  observed: { payee: string; accountCommit: Commitment; amount: MinorUnits; currency: string };   // from the target's query echo
  match: { payee: boolean; account: boolean; amount: boolean; currency: boolean };
  basis: "echo_only" | "independent_query" | "settlement_statement";                      // strongest available
  nonClaims: ["effect confirmed only to the stated basis", "target is as reported by the adapter"];
  walSeq: number; ledgerLeaf?: number; at: Iso; receiptHash: DocHash;   // bound by its ledger leaf and the WAL hash chain; no separate receipt key (section 17.4)
}
```
Rules: (1) a receipt is written for **every** effect, including refused-after-consume, failed, not-sent and unknown-resolved (property P5); (2) `basis` upgrades are new receipts that supersede, never edits; (3) a `match` with any false field is an alarm and a `mismatch` transition; (4) closure to `released_confirmed` requires `basis` at least `independent_query` and an ERP posting record or an opened follow-up task.

**Reversal.** `reverse` needs a contract whose `ReleaseBinding` has `action: "payment.reverse"`, `payee` and `accountCommit` equal to the original release's origin, and `amountMaxMinor` at most the original. Because reversal returns funds to their origin and is loss-limiting, it may be authorised with **one approver** (asymmetry: restricting and undoing is cheaper than releasing); partial reversal is allowed up to the remaining amount. Manifest `void_before_cutoff` uses `cancel`; `return_request` asks the target and may be refused; `none` yields `not_reversible` and an incident path. Outcomes: `reversed | reversal_pending | reversal_failed | not_reversible`, each a receipt. Because sagas lack isolation, the reversal step **re-reads current state** (the funds may already have been used by the vendor, the vendor may be on hold); it never assumes the state at release time.

### 9.5 Tests and acceptance
Every simulated effect has exactly one non-superseded receipt and a ledger leaf; `mutate_field` fault produces `match.account = false` and the mismatch path; reversal before cutoff succeeds, after cutoff is `reversal_pending` or `not_reversible` per manifest, double reversal is idempotent; a reversal capability cannot be used as a release (action mismatch) and cannot exceed the original amount.

### 9.6 Risks
Reversal windows on real rails are **NOT VERIFIED**. One-approver reversal could be abused for harassment (reversing legitimate payments): rate-limited per approver and visible in the audit view.

### 9.7 Build notes
After component 5. The receipt and reversal records are the main inputs to M9's V8 invariants.

---

## 10. Component 8: Kill switch and in-flight stop

### 10.1 References
`10` rows `SEC-R1/R2/R3` (demotion on incident; kill switch stops effects that have not crossed the send boundary; read-then-egress anomaly flag; wording per INT-025), OWASP ASI10 mapping in `10 §F4`, spec section 5 residual list. No open-source kill-switch design was studied; the design below is ours from the protocol of component 5.

### 10.2 What they do
The research rows state the requirement and the test id only.

### 10.3 Decision
**Own.** A signed, durable `freeze` record in the WAL, checked at every broker step, with asymmetric authority: **engaging is cheap (one authorised person or an automatic trip), disengaging needs two approvers.**

### 10.4 Implementation design
Scopes: `global`, `tenant`, `target`, `case`, `capability`. Triggers: a human with the `killswitch:engage` role; automatic trips: receipt mismatch, a duplicate effect in a target query, release volume or value above configured velocity, reconciliation drift, signer or WAL integrity failure, key compromise report (component 15), an incident declaration (component 19).

**The send boundary** is the kill-state read that immediately precedes `TargetPort.submit` (after the nonce is consumed and after the `action.intent` leaf is published). Check points: before nonce consume (step 4 of the verification order); at the send boundary (closing the window); inside the resume loop; and a `ReleaseBlock` overlay on the vendor from monitoring (component 11) that is evaluated at the same points. **What the switch stops, stated once (INT-025):** it stops effects that have not crossed the send boundary; after it the broker reconciles and may propose a reversal. **In-flight handling:** on `freeze`, the broker enumerates unresolved intents in scope and for each writes `freeze_observed`, then drives recovery in **query-only mode**: found settled or accepted, record and surface and, where the manifest allows, propose a reversal (a separately authorised action, component 7); still `pending` and `cancellable`, call `target.cancel(idemKey)`; not found, mark `not_sent` (no resend while frozen). The honest limit: an effect already at the bank is beyond any switch; the freeze guarantees "no *new* effect whose send boundary comes after the freeze record is durable", which is the tested statement. Disengage creates `unfreeze` only after two approvals and a reconciliation pass over everything that was in flight.

### 10.5 Tests and acceptance
Property: for every interleaving of {engage freeze, execute, recover} generated with fast-check, no `submit` has its send boundary after the durable freeze record (the test names the boundary: a freeze that becomes durable before the boundary read yields `not_sent`, one that becomes durable after it yields reconciliation and a proposed reversal, never a claim that the effect was stopped); in-flight intents each end in a recorded state; one-person engage works, one-person disengage is refused; auto-trip fires on the `mutate_field` and `duplicate_delivery` faults. Drill: engage during `commit_then_lose_response`.

### 10.6 Risks
Freeze availability becomes the attack surface (a denial-of-service lever): engagement is attributable and rate-visible; automatic trips have hysteresis. **NOT VERIFIED** whether partial-scope freezes behave under concurrent engages (tested in P11).

### 10.7 Build notes
Right after recovery in component 5; the property test reuses the crash harness.

---

## 11. Component 9: Outcome feedback

### 11.1 References
`09 §11.1, §11.6, §12` (logged decisions with propensity, `observedBecause`, matured windows, selective labels, survivorship); `11` (outcome-weighted precedent; labels never from the deciding model, spec 14a). Delayed-label literature, abstract level only: arXiv 1811.06109 (fraud labels "only return after a stochastic delay"); arXiv 2604.15740 (outcome labels "arrive days to months after the decision"; an evidence-sufficiency gate; evaluated on IEEE-CIS with injected drift, author-reported); arXiv 2608.08577 (fraud operations as an authorization problem with fresh audit evidence and review capacity; "selective and delayed" labels; chronological evaluation on three real datasets, author-reported; requires representative randomised audits); arXiv 2605.29272 (chargeback labels "systematically biased"; listing sentence only). None of these studies counterparty release; they support the structure, not any number.

### 11.2 What they do
They treat labels as late, selective and gated by authorisation, and argue automation should be authorised against fresh audited evidence. `09 §11` already supplies the off-policy machinery; what is missing is the **source and trust of the label**.

### 11.3 Decision
**Own the label provenance rules; adopt the literature's framing.** A label is a typed record whose constructor enforces provenance. It is never produced by the deciding model.

### 11.4 Implementation design
```ts
type OutcomeKind = "released_confirmed_clean" | "released_returned" | "released_reversed" | "fraud_confirmed"
                 | "held_cleared" | "held_confirmed_bad" | "rejected_overturned" | "audit_clean" | "audit_finding";
interface OutcomeLabel {
  labelId: Id<"ol">; caseId; episode; decisionId; kind: OutcomeKind;
  source: { kind: "target_return"|"erp_status"|"bank_statement"|"investigator"|"audit_sample"|"counterparty_confirmation"|"regulator_notice"; ref: string; evidenceId?: Id<"ev"> };
  labeller: { kind: "system"|"human"; principal: PrincipalRef };            // "model" is unrepresentable
  trust: TrustLevel; maturity: { observedAt: Iso; windowDays: number; status: "pending"|"matured"|"censored" };
  observedBecause: "released"|"audited"|"held_review"|"none";                // 09 §11.1
  lineageHash: Hash; supersedes?: Id<"ol">;
}
```
**Never from the deciding model, enforced three ways.** (1) `labeller.kind` has no `"model"`. (2) `outcomes.record()` computes the label's **lineage** (every run id and model call that fed any field of it) and rejects it if the lineage includes any run belonging to the same case's decision path, or any model output at all unless a human or system principal confirmed it. (3) A model may submit a `Proposal<OutcomeLabel>` (for example parsing a returned-payment notice from an email); it becomes a label only through confirmation by a deterministic parser over an `SOR` message, or by a human with attached `SOR` evidence.

**Trust.** `SOR`: a target return code or ERP status written by a system with no `UNTRUSTED` lineage. `VERIFIED`: an investigator's signed finding with an attached `SOR`/`VERIFIED` evidence record. `EXTRACTED`: a model-parsed notice awaiting confirmation: **not usable**. A human assertion without evidence is stored as an `UNTRUSTED` note, not a label, consistent with "human confirmation is not a level" (spec section 5; `Spec feedback` 4). Counterparty statements ("the vendor says it is fine") are `UNTRUSTED` and never labels. **One mapping to M6** (data, with a test): `labeller.kind = system` writes as M6 `writer.kind = m13` (connector identity), `labeller.kind = human` writes as `writer.kind = reviewer` with the authenticated subject, so M6's authorship rule (no decider may adjudicate its own decision) applies to the same identities M13 recorded.

**Where labels come from.** (a) target returns and reversals (component 7); (b) ERP status changes; (c) **audit samples**: a post-release review case type (`audit_sample`) opened for a randomly selected subset of released cases inside the permitted set, with the selection probability logged (`09 §11.5`), producing `VERIFIED` labels from an independent reviewer; (d) hold follow-ups (`held_cleared`, `held_confirmed_bad`) from the hold review (T22). Without (c) there are almost no labels for held and rejected cases, which is the selective-label problem; the system says "weakly informed" rather than inventing them.

**Maturity.** Each outcome kind has a window; labels are `pending` until it passes and `censored` if the case is closed unobserved. Only `matured`, `SOR`/`VERIFIED` labels feed (i) M6 precedent weights, (ii) the anytime-valid promotion statistics of `09 §11.4`, (iii) rule-proposal certificates. M13 emits `LoggedDecision` rows (`09 §11.1`) with `mu`, `randomized`, `observedBecause` and cluster id for M5/M11, so the evaluator can say `unevaluable` where support is missing.

### 11.5 Tests and acceptance
Provenance: a label whose lineage touches the decision run is rejected (mutation: drop the lineage check and the test fails); a model-only proposal never becomes a label; a human note without evidence never enters the statistics. Simulation: SimPay's hidden process generates labels with known delay and selectivity; the recovered rule value matches ground truth on the simulator (methodology validation only, spec section 10 scope note). Metrics: label coverage by action, median label delay, share `pending`/`censored`, share by trust level.

### 11.6 Risks
Real label sources (chargeback-like events for supplier payments) and delays are **NOT VERIFIED**; the demo's processes are authored by us. Reviewer-assignment randomisation and audit sampling carry business and ethics implications in a real deployment (`09 §11.5`).

### 11.7 Build notes
After receipts exist. Feeds M6 and M11; the audit-sample case type reuses the lifecycle table with a different disposition set.

---

## 12. Component 10: Appeals and reopening

### 12.1 References
`15 §5.2`: GDPR Art. 22(1) text, Art. 35(3)(a) (quoted, read), EU AI Act Art. 14(4) override and reverse (quoted), Art. 86 (partly read); counterparty explanations and tipping-off (`15` contribution C). Contest rights under Art. 22(3) were **not read**; treated as LAWYER. Flowable's `terminated`/`failed` terminal states (component 1) for terminal semantics.

### 12.2 What they do
The sources establish that humans must be able to disregard, override or reverse the output (Art. 14(4)) and that explanations to counterparties conflict with tipping-off. They give no case-management mechanics.

### 12.3 Decision
**Own.** An appeal is a new episode with an independent reviewer; the original decision is immutable. An overturned appeal returns the case to `GATHERING`, never directly to release: it still needs a fresh decision, approval and capability.

### 12.4 Implementation design
**Who can appeal:** the requester or budget owner against a `hold`/`reject` (T19). A vendor has no system access; a vendor's challenge arrives through the buyer, and any vendor-facing text is the counterparty-tier view (reason code only, M9). **Independence:** the appeal reviewer must differ from the original assignee, all approvers and the requester (segregation-of-duties data), and for appeals above a value tier must hold a higher role. **Procedure:** the pipeline is re-run twice in recorded effects: *as-of the original decision* (to confirm the original was reproducible) and *as-of now* (to see what new evidence changes); the diff is shown. Outcomes: `upheld` (closes), `overturned` or `modified` (new episode, new run, normal approval). **Reopen** (T21) is triggered by new evidence or monitoring (a closed released case gets a `post_release_review`, with reversal as an option). **Episode discipline:** `episode` increments; every capability, approval and idempotency key is bound to `(caseId, episode)`, so nothing from a previous episode can be reused. Appeals have a deadline and a per-requester rate limit (policy parameters).

### 12.5 Tests and acceptance
Appeal reviewer independence over generated org graphs; an overturned appeal cannot reach `EXECUTING` without passing T07 to T09; old-episode capability and approval are refused (`audience`/`episode` mismatch); the original decision's hash and dossier are unchanged after any number of appeals (immutability test). Metric: appeal overturn rate (a signal for false holds), time to resolution.

### 12.6 Risks
Legal status of automated holds on sole-trader vendors and the rights to contest are **LAWYER**. Practitioner input on appeal norms is missing (`04`).

### 12.7 Build notes
After component 1; before outcome labels so `held_cleared` and `rejected_overturned` can be produced.

---

## 13. Component 11: Continuous monitoring

### 13.1 References
Interagency guidance, "4. Ongoing Monitoring" (read in full): monitoring "may be conducted on a periodic or continuous basis, and more comprehensive or frequent monitoring is appropriate when a third-party relationship supports higher-risk activities"; the factor list includes changes in financial condition, insurance lapses, audit results, compliance, key personnel, subcontractors, incidents and external conditions; section C describes the lifecycle as "continuous"; the inventory plus "periodically conducting risk assessments" shows whether risks "have changed over time". It applies to banking organisations; a corporate buyer is not bound (`15 §1`). Feeds: Companies House Streaming API (overview read: "realtime data changes", resources company, officers, PSC, charges, filing history, insolvency, disqualified officers; replay by `timepoint`; maximum two concurrent connections per account; 429 requires a one-minute wait); GLEIF "publishes three separate 'Concatenated Files' daily" (Level 1, Level 2 relationship records, reporting exceptions; delta-file details **not read**); OFAC Sanctions List Service (page read: an archive of published delta files by year, e-mail notification sign-up, an archive of changes to the SDN list; update frequency **not stated** on the page read); SEC EDGAR limits from `15 §4` (10 requests per second, declared user agent). OneTrust claims "real-time third-party changes" with rule triggers (`15 §3.1`, vendor claim only). `09 §9.3` cumulative exposure; TigerBeetle pending transfers (reservation). `10 SEC-R3` anomaly flag. Delayed-evidence literature (component 9) for monitoring staleness is not used.

### 13.2 What they do
The guidance fixes cadence by risk tier and lists *what changes matter*; it does not specify mechanisms. The feeds are push or daily-poll sources of **changes**, not of screening results: the receiving system must map each change to the entities it affects. Nothing read describes reverse screening of a list delta against a vendor portfolio; that is a standard technique in practice but is not sourced here, so it is presented as our design.

### 13.3 Decision
**Own.** Monitoring is a set of triggers over the same engines (spec 21c.2), producing events that open or refresh cases in the same lifecycle. No separate "monitoring product".

### 13.4 Implementation design

**Portfolio model.**
```ts
interface MonitoredVendor { tenant; vendorKey: string; entityIds: Id<"en">[]; tier: "critical"|"high"|"standard"|"low";
  cadence: Duration; nextFullReviewAt: Iso; keys: { lei?: string; cik?: string; registryIds: string[]; accountHashes: Hash[]; nameTokens: string[] };
  releaseBlock: boolean; lastScreenedAt: Record<string, { listVersion: string; at: Iso }>; groupId?: Id<"grp"> }
```
`tier` is derived by deterministic rules from spend, criticality flags, jurisdiction and alert history. A change in tier rules is a policy change under component 13.

**Inverted indexes** maintained incrementally from M3's truth table: name token and trigram to vendors, LEI and parent LEI to vendors, registry id to vendors, bank-account hash to vendors (shared accounts), ownership edge to vendor groups (transitive via M3 clusters).

**Trigger classes and sources.**

| Class | Source and mechanism | Trust of the signal | Action |
|---|---|---|---|
| List update | OFAC SLS delta publication (poll by publish date, optionally the e-mail notification); other lists as licensed | authoritative, `VERIFIED` | **reverse screening** of delta entries against the name index; `world_changed` for pending approvals |
| Registry change | Companies House stream for UK vendors, GLEIF daily files for LEI and parents, SEC polling for filers, conditional fetch elsewhere | authoritative for the filed fact, `self_declared` tier noted | re-run reconcile for the affected entity only |
| Internal change | ERP connector events or modified-since polling: bank-detail change, address, status, new payee, terms, editor identity | `SOR` | "days since change" and "changed by requester" features; `releaseBlock` on suspicious patterns |
| Payment pattern | broker receipts and exposure views | `SOR` | velocity, split-invoice, dormant reactivation alerts |
| Document and calendar | M2 extracted expiry facts, contract end dates, review due dates | `EXTRACTED`/`SOR` | timers per tier cadence |
| Adverse media | secondary channel | secondary | **review only**, never clearance (restrict-only) |
| Matcher or policy version change | M3/M5 version bump | n/a | mandatory full rescreen of the affected scope |

**Impact analysis.** `MonitoringEvent -> affected vendors` through the inverted indexes; then: (1) set `world_changed` on any `APPROVAL_PENDING`/`APPROVED` case whose recorded versions or entities are touched (T11); (2) run the deterministic stages (M3, M5) on the delta for each affected vendor, **no model call unless a new document must be extracted**; (3) apply alert rules: `info` (logged), `review` (open or refresh a `monitor_alert` case through T01), `block_new_releases` (sets `releaseBlock`; automation may set it, only a human with a role may lift it, because it is restrict-only); (4) update views. The vendor-level `releaseBlock` is the source of the case overlay and is published to M5 as the feature `overlay.releaseBlock` (INT-015); M5 treats it as an input that can only reduce the allowed set, and a missing value reads as blocked.

**Reverse versus forward screening.** Forward: a vendor changes, screen it against current lists (every new vendor, every material change). Reverse: a list changes, screen the delta against the portfolio. Cost of reverse screening is `|delta| x candidates(blocking)`, not `|portfolio| x |list|`. Equivalence is a tested property: reverse-screening every delta since version v0 and forward full rescreen at version vN produce the same set of new hits (differential test, P19). A periodic full rescreen is still run as a safety net and on matcher change.

**Cadence by tier** (parameters, assumptions): continuous for lists and registry streams; periodic full review per tier (for example critical monthly, high quarterly, standard annually, low on event only), documented in the policy bundle and justified by the guidance sentence on risk-commensurate frequency.

**Cumulative exposure and concentration views.**
- *Exposure with reservations.* `E(group, window) = posted + reserved`, where **reserved** is the sum of `amountMaxMinor` over in-flight authorisations: minted contracts that are unexpired and unconfirmed, including consumed ones whose outcome is `EXEC_UNKNOWN` (a pessimistic reservation, as TigerBeetle reserves pending transfers before posting). This closes a hole in `09 §9.3`: two concurrent approvals each under the cap but jointly over it (`Spec feedback` 8). Vendor grouping uses M3 clusters; wrong merges make the view wrong, and the view says which group definition it used.
- *Reservation API (M13 owns the final shape; the field list is the shared one).* 
```ts
interface ExposureReservation { id: Id<"rsv">; caseId: Id<"case">; vendorGroup: string; amountMinor: MinorUnits; currency: string;
                                state: "reserved" | "executed" | "released" | "expired"; ledgerSeq: number; expiresAt: Iso }
interface ExposureLedgerView { releases: { caseId; vendorGroup; amountMinor; currency; at: Iso }[]; reservations: ExposureReservation[]; ledgerSeq: number }
view(tenant, group): ExposureLedgerView                                             // what M5 featurizes (I6)
reserve(caseId, group, amount, expectedLedgerSeq): Result<ExposureReservation, "ledger_moved" | "cap_exceeded">   // atomic compare-and-set
settle(rsvId, receiptHash) / release(rsvId, reason)                                   // state transitions, each a trace event
```
M5's decision reads `view` and records the `ledgerSeq` it saw; T09 calls `reserve` with that `ledgerSeq` as part of minting. `ledger_moved` is a `world_changed` event (T11): the case returns to `REVIEW` for a re-evaluation by M5 on the new view (G-FRESH includes the exposure `ledgerSeq`); `cap_exceeded` is a refusal to mint. States: `reserved` from mint; `executed` when the receipt reaches `basis` at least `independent_query` and the amount is posted into `releases`; `released` on revocation, supersession, a `not_sent` record or cancellation; `expired` when the contract lapses unconsumed. A consumed reservation stays `reserved` through `EXEC_UNKNOWN` until a receipt or a `not_sent` record resolves it. Approvals that are still pending do not reserve; the second concurrent approval is refused at mint, not at approval.
- *Concentration.* Share of spend per vendor, per group, per jurisdiction, per risk tier; Herfindahl-Hirschman index `HHI = sum_i s_i^2` over those shares (arithmetic definition, no source needed); alert thresholds are policy parameters. Also exposure to flagged groups (any vendor with an open alert).
- *Change alerts.* Bank-detail change, ownership change, status change (dissolved, in insolvency), new adverse list entry, with provenance of the change and who made it.

**Alert quality.** Dedupe by `(vendor, trigger class, fingerprint)`, suppression with expiry and an owner, rate limits per class, and a published precision measure against outcome labels (component 9). Untrusted signals can add work, never remove a hold.

### 13.5 Tests and acceptance
List-update drill: a delta adds a name that matches a pending-approval vendor, so the approval is invalidated within one tick, the case returns to `REVIEW`, and the old capability fails at the broker (P10). Differential P19 above. Registry stream drill: replay by timepoint after a disconnect yields no duplicate alerts (idempotent by event id). Bank-detail change within N days of a large pending payment raises `block_new_releases`. Exposure property P20: under all interleavings of mint, execute, expire, revoke, `ledger_moved` retries and `EXEC_UNKNOWN` resolution, the sum of posted plus reserved never exceeds the cap; two concurrent mints from one `ledgerSeq` yield exactly one reservation. `overlay.releaseBlock` and `target.reversible` are published with the restrict-only behaviour above (a missing value blocks or reads as not reversible). Monitoring lag metric: event publication to alert, measured in the simulator and the replayed real-list path. Alert precision and workload reported with the safety curve (spec section 17).

### 13.6 Risks
OFAC SLS update cadence and delta format, GLEIF delta files, and non-UK registry feeds are **NOT VERIFIED** beyond the pages named. EU/UN/UK list terms **NOT VERIFIED** (`15 §4`). Natural-person data in lists and registers (spec F-PERSONS) constrains what may be stored. Monitoring turns point-in-time reasoning into a stream: stale `releaseBlock` flags and alert fatigue are the main failure modes, hence the quality metrics.

### 13.7 Build notes
The exposure reservation API needs only component 1 and ships with the case state machine at step 11b, ahead of M5b (register section 5, V9), with a ledger of released amounts that the simulated payment system feeds; `settle` is wired to receipts when component 5 exists. The rest ships after components 1 and 5, in stages: list feed first (existing OFAC channel), internal ERP changes second, registry streams third.

---

## 14. Component 12: Enterprise connectors

### 14.1 References
`02` (channel contract, `prior-art/02-data-channels-agent-reach-and-connectors.md`); spec sections 6 and 19 (Zetaris as the governed read channel). Frappe/ERPNext REST (docs read): `/api/resource/:doctype` CRUD, `filters`, `limit_page_length`, token auth `token api_key:api_secret` that "logs all requests against a specific user, enforcing role-based access control"; the page does not cover webhooks. Odoo external API (docs read): XML-RPC, API keys since 14.0, and "Access to data via the external API is only available on Custom Odoo pricing plans" (an operational constraint). ERPNext is GPL-3.0 and Odoo's licence is mixed (`15 §3.2`): they serve as **schema and API references only**, never as copied code. RFC 7644 (SCIM) is not fetched and not cited.

### 14.2 What they do
Both ERPs expose record CRUD with per-user authorisation and filterable lists, which is enough for read-through and modified-since polling; neither description establishes change-event delivery.

### 14.3 Decision
**Own the connector contracts on top of M1's channel contract; no vendor SDKs in the core.** Every connector is either a *channel* (read, returns `Evidence` with a fetch state) or an *action target* (`TargetPort`), and passes the same contract-test groups as M1 channels. Simulated twins are generated by the M11 silo generator and served through `SiloPort`.

### 14.4 Implementation design

| Connector | Direction | Used for | Trust of data | Change feed | Auth | Failure behaviour |
|---|---|---|---|---|---|---|
| ERP vendor master | channel + `releaseBlock` write | payee, account, status, editor identity, change history | `SOR` (authenticated service identity); a field is `UNTRUSTED` when its `request_origin` is `vendor_portal`, `vendor_email` or `unknown`, or when the `last_write_*` / `editor_sub` columns are missing (default-deny, INT-024) | webhook, CDC or modified-since poll (per ERP, **NOT VERIFIED**) | per-ERP key or OAuth, least privilege read plus one write scope | `unavailable`/`stale` -> broker refuses |
| ERP payables (PO, invoice, payment history) | channel | three-way match, already-paid check, posting marker | `SOR` | same | same | same |
| Contract repository | channel | contract text and metadata into M2 | document hash; extracted facts `EXTRACTED` | poll by modified | repo token | `not_checked` |
| Identity provider | channel + auth | `sub`, roles, `auth_time`, group membership, joiner/leaver | `SOR` for identities | OIDC discovery, directory sync (protocol **NOT VERIFIED**) | OIDC | approvals blocked if the IdP is unreachable beyond step-up needs |
| Payment operations | action target | submit, query, cancel, reverse | `SOR` for confirmations | statements and status webhooks | per-bank | `EXEC_UNKNOWN` path |
| Ticketing / approval systems | action target | human-review items, notifications (a 'create task' action, no money) | n/a | n/a | token | queue and retry, never block the lifecycle |
| Zetaris SiloPort | channel | governed read of the silos | `SOR` (role-masked) | audit-log cross-check (conditional) | per Zetaris trial | doctor report, embedded fallback |

Health: every connector has a canary probe, a state (`ok | degraded | down | stale`), and a **circuit breaker**; `degraded`/`down` is a policy input and a guard (G-CONNECTOR) for execution and approval. The ERP write scope is limited to one field class (`releaseBlock` flags), recorded as an action with receipt, so M13 never has general write access to the system of record.

### 14.5 Tests and acceptance
The M1 eleven contract-test groups for channel connectors; for targets, the SimPay fault matrix; connector chaos drills (down, stale, slow, wrong schema, type drift); a test that a missing or `stale` ERP read blocks execution; least-privilege test (the broker's ERP token cannot write other fields: verified against the simulated ERP's permission model).

### 14.6 Risks
No real ERP is available in this project; real change-feed semantics, API quotas and licence-gated API access (the Odoo note) are **NOT VERIFIED**. Contract repositories and identity-provider specifics are generic until a customer system is chosen.

### 14.7 Build notes
The simulated ERP and payables twin first (needed by step R), then the IdP simulator (needed by component 3), then others.

---

## 15. Component 13: Tenancy, isolation, role-based access and policy ownership

### 15.1 References
PostgreSQL row security docs (read): policies restrict rows "on a per-user basis"; with no policy "a default-deny policy is used"; superusers, `BYPASSRLS` roles and table owners bypass unless `FORCE ROW LEVEL SECURITY`; referential-integrity checks "always bypass row security" and can form "covert channel" leaks; sub-SELECT policies can race. `09 §2.4, §2.5, §2.7` (Cerbos, Casbin, Zanzibar-style engines, studied); Cerbos 4621 stars Apache-2.0 and OpenFGA 5959 stars Apache-2.0 (metadata only here). `09 §9.4` rule-change gate. Spec 19a.2 policy-engine bake-off (Cedar, OPA, our IR). The `13 §3.1` chain-failure list includes "tenant split".

### 15.2 What they do
RLS is default-deny enforcement inside one database, with documented bypasses and covert channels. The authorisation engines separate decision from enforcement but are services or libraries whose fit is decided by the policy-engine bake-off.

### 15.3 Decision
**Own the tenant context and role matrix as data; reuse the policy-engine bake-off winner as the evaluator behind an `authorize()` port.** Isolation is layered: the unit of isolation is a **tenant namespace** (separate directory, ledger tree, WAL, evidence store, key hierarchy), not a column filter, on the judge-run path; a SQL deployment adds RLS as defence in depth with `FORCE ROW LEVEL SECURITY` and no shared unique indexes over tenant-visible data. Rejected: a single shared ledger tree across tenants (couples erasure, key rotation and disclosure; `Spec feedback` 2). Resolved at register level as **one tree per tenant** (INT-048): the M9 log identity is `<ns>/ledger/<deploymentId>/<tenantId>` and the signer's key registry is per tenant. The judge path runs exactly one tenant, `tn_default`, so nothing is lost.

### 15.4 Implementation design
- **Tenant context.** `TenantCtx` is a module-private branded value created only at the authenticated edge and required by every port (the M8 forged-object-rejection mechanism). `tenant: TenantId` is a required field of `StepCtx`, of the effect `Slot` (omitted from the slot digest when it equals the default, which keeps vectors stable), of `LeafV1`, `LedgerPort`, `StorePort` names and cassette headers (INT-048). Every storage key, cache key, cassette key, trace attribute and ledger stream name is prefixed `tn_<id>`. `authorize()` is the `AuthorizePort` (`ctx.authorize`): M13 owns the data, M7 declares the port.
- **Roles (data).** `RbacRole` is `requester, buyer, analyst, reviewer, approver_l1, approver_l2, approver_cro, policy_author, policy_approver, auditor_readonly, tenant_admin, security_admin, killswitch_operator, platform_operator` (platform operators have **no** tenant data access; break-glass is an approval item with a ledger leaf). **RBAC role to `SiloRole` (INT-008).** `SiloRole` is M1's data-access identity (`agent, buyer, reviewer, approver, broker`), a different axis from `RbacRole`, from `Audience`/`Disclosure` (M9 tiers) and from MCP scopes (capabilities of an external client, not roles). One data file maps each RBAC role to exactly one SiloRole, least privilege first, with a test that every role has a row and that no human role maps to `broker`:

| RbacRole | SiloRole | Reason |
|---|---|---|
| requester, buyer, analyst | `buyer` | masked bank fields only |
| reviewer | `reviewer` | full read for review |
| approver_l1, approver_l2, approver_cro | `approver` | full read for approval |
| policy_author, policy_approver, auditor_readonly, tenant_admin, security_admin, killswitch_operator, platform_operator | `agent` | no silo view is needed; `agent` is the masked, hashed minimum, and `authorize()` still denies platform operators any tenant data |
| automated components (decision runs, monitoring) | `agent` | default for automated components |
| the broker process principal (a service, not an RbacRole) | `broker` | the only raw account read, for independent confirmation |

A permission matrix `(role, action, resource-class) -> allow` plus **constraints** (SoD): no role combination on one person may include {requester or vendor-master editor} with {approver}; {policy_author} with {policy_approver} for the same change; {tenant_admin} with {approver} for the same tenant's money classes. `authorize(principal, action, resource, ctx)` returns `Result<Allow, Deny{why}>`; every deny and every sensitive allow is traced.
- **Policy ownership.** Every governed artefact has an owner role and a change class: rule bundles (M5), thresholds, autonomy grants, SLA budgets, approval TTLs, retention schedules, adapter manifests, tier rules, kill-switch automatic trips, alert rules. Changes use the M5 rule-change gate (`09 §9.4`), which classifies rule bundles by SMT; M13's configuration parameters are classified by a **declared direction** instead: a `ParamDecl {name, owner, tightenIs: "up" | "down"}` registry, data in the policy stack and hashed (INT-033). Longer approval TTL, longer capability TTL, higher auto-approve ceiling, shorter retention for evidence, fewer approvers and later monitoring cadence are loosening by their declarations; loosening needs two distinct approvers; a change to a parameter with no declaration is unclassifiable and therefore loosening. The governance roster and tiers are a second policy bundle evaluated by the same interpreter (M5), so invariants I4 and I5 cover them. Owners are listed in a manifest checked in CI.
- **Auditor access.** A read-only role, exported bundles (M9) and an `access.audit` ledger leaf for each session; auditors never get write or approval capability.

### 15.5 Tests and acceptance
Cross-tenant fuzz: random operations across 3 tenants, then assert no key, trace line, ledger stream, cassette, cache entry or model context contains another tenant's identifier or content (extends the Markovian contamination test of spec section 11). Role-matrix property: no generated principal with a forbidden combination can be created. Mapping tests: every `RbacRole` has exactly one `SiloRole` row; a parameter without a `ParamDecl` row is classified loosening; one-tenant (`tn_default`) and three-tenant runs produce identical per-tenant ledger sequences. A mutation that removes the tenant prefix from any one key class must fail. SQL mode: a policy-free table is invisible (default deny), and a bypass-role session is flagged by a test that connects as the owner. Acceptance criteria for "built after the core": cross-tenant fuzz clean over the full port surface, SoD constraint test, change-class tests for every parameter.

### 15.6 Risks
Covert channels through shared infrastructure (timing, size, error text) are not closed; stated in the threat model. Node-level isolation between tenants in one process is convention plus brand checks; a multi-tenant hosted deployment would need process separation (OS-level), **NOT VERIFIED** as feasible under the judge constraints.

### 15.7 Build notes
Design the tenant prefix into every store from the first line of code; retrofitting is where tenancy fails. Roles and `authorize()` can be minimal until the console has users.

---

## 16. Component 14: Retention, legal hold and data deletion

### 16.1 References
EU AI Act Art. 26(6): deployers keep automatically generated logs "at least six months, unless provided otherwise" (quoted in `15 §5.2`; text via secondary reading there); Art. 12 logging and the tension with hash-only traces (`15 §5.2`); GDPR Art. 22 and 35 (`15 §5.2`); spec 14a and `13 §4.2` (erasure receipt: erased body leaves a hash plus an `erased` receipt; salted commitments for low-entropy fields); review finding AUD-10 (retention, erasure, reconstruction); `13 §4.1` bundle disclosure policies (`full | redacted | hashes-only`). Nothing here is legal advice; every item is **LAWYER**.

### 16.2 What they do
The sources state obligations and the technical pattern (digests in the ledger, bodies in a deletable store) but no schedule, no scope resolution and no interaction with backups.

### 16.3 Decision
**Own the schedule and the hold; use M9's erasure protocol (INT-040).** A retention schedule as data; legal hold as an overlay; deletion as a governed workflow that runs M9 component 14's one protocol (request leaf, hold check, receipt, signer role `erasure`) and ends in its verifiable erasure receipt. The receipt's `method` is one of `delete+salt-destroy`, `crypto_erase`, `tombstone`. The judge-path implementation is salt destruction plus delete; **crypto-erasure** (destroy the per-object data key) is the stated upgrade and is the method wherever `KeyPort` DEKs exist, and it is the only method that covers backups. Episodes are immutable in id, digest and trust label; the body becomes a tombstone.

### 16.4 Implementation design
```ts
interface RetentionRule { dataClass: "evidence_body"|"trace"|"cassette"|"case_event"|"ledger_leaf"|"memory_episode"|"bundle"|"outcome_label"|"personal_field";
  minRetain: Duration; maxRetain?: Duration; basis: string; holdable: boolean; erasureMode: "delete+salt-destroy"|"crypto_erase"|"tombstone" }   // M9's receipt `method` set
interface LegalHold { holdId; tenant; scope: { caseIds?: Id<"case">[]; vendorKeys?: string[]; from?: Iso; to?: Iso }; reason: string; placedBy: PrincipalRef; at: Iso }
```
1. **Data map.** A registry of where each data class lives (blobs in the one content store behind M7's `StorePort`, addressed by `RawHash` and partitioned by confidentiality class; cassette entries; trace lines; memory episodes with `derivedFrom`; exported bundles; backups) so scope resolution is complete rather than best effort. Where DEKs exist, evidence and personal fields are stored under a DEK per object per partition (component 15). M13 does not delete bytes itself: M9's erasure service is the only deleter, and DEK destruction is requested through it.
2. **Erasure workflow** (`erasure_request` case type): resolve scope via the data map; check legal holds and `minRetain` (a hold or a minimum blocks and says why); run the M9 protocol with the rule's `erasureMode`; the **erasure receipt** (class, object hashes, rule id, method, time, requester, approver) is the M9 receipt and its ledger leaf, not a second format. Consequences are named states, never silent: replay of an erased body is `CassetteMiss{reason: erased}`; the verifier reports `INDETERMINATE` (`V5.ERASED`) for the covered members, never PASS; M6 reports `unevaluable` for validity and retraction over erased snapshots; M5 replay is `INDETERMINATE`; M6 episodes keep digests, trust label and an `erased` marker (`Spec feedback` 9).
3. **Traces** are hash-only by default; the retention rule says which event classes keep enough to reconstruct a situation (decision, approval, action, outcome) for the minimum period.
4. **Personal data.** Natural-person fields (beneficial owners, officers, sole-trader vendors) carry the `personal` flag; their evidence bodies are `holdable: true`, `crypto_erase` where DEKs exist and `delete+salt-destroy` otherwise, with salted commitments in the ledger. Whether a salted commitment remains personal data after the salt is destroyed is **LAWYER**.
5. **Hold effect.** `legalHold` overlay blocks the erasure and expiry jobs for the scoped objects, is itself a ledger leaf, and a release of a hold needs two approvers.

### 16.5 Tests and acceptance
Erased bodies leave verifiable receipts and the verifier reports INDETERMINATE, not PASS, for those members (spec 21b M9 line); a held object survives an expiry run; under `crypto_erase`, destroying a DEK makes the backup copy unreadable (restore drill, component 16), while under `delete+salt-destroy` backups are explicitly not covered and the receipt says so; scope completeness test: plant a marker string in every data class, erase by vendor, and assert no readable copy remains outside the receipt; retention rule loosening is a two-approver change. Acceptance for build: all of the above pass on the simulated tenant.

### 16.6 Risks
Legal periods, GDPR lawful basis, the tension between erasure and audit reconstruction, and what counts as personal data for legal entities are **LAWYER**. Crypto-erase relies on key destruction being real; key custody (component 15) is part of that claim. The `delete+salt-destroy` method leaves backup and filesystem remnants unaddressed.

### 16.7 Build notes
Needs component 13 first (tenant paths) and component 15 for the `crypto_erase` method (DEKs). The data map is easiest to keep complete if every store registers itself at construction.

---

## 17. Component 15: Key management and rotation

### 17.1 References
NIST SP 800-57 Part 1 Rev. 5 (May 2020, abstract read): general key-management guidance, key states, cryptoperiods, compromise procedures, organisational considerations; specific period values were **not** read and are not cited. `13 §3.1` Obsigna (out-of-process signing daemon; key-rotation receipts signed by the outgoing key) and `13 §4.2` (ledger key separate from the decision-signing key; `key.rotated` leaves). OpenBao 8419 stars MPL-2.0 and Vault-compatible transit engines (metadata only; API not read, so only named as an external-KMS option). Spec section 5 key-custody residual (`SEC-09`).

### 17.2 What they do
800-57 supplies the vocabulary (generation, active, deactivated, compromised, destroyed; cryptoperiod). Obsigna demonstrates the daemon pattern and rotation records.

### 17.3 Decision
**Adapt the vocabulary, own the key inventory for encryption and the capability signer policy; use `node:crypto` primitives only; no custom cryptography.** There is **one signer process and one key registry** (M9 component 4; INT-017). `KeyPort` is the storage and rotation interface behind that signer (`inventory()`, `rotate(role)`, `wrap(dekId, bytes)`, `unwrap(dekId)`), not a second signing path. Implementations: passphrase-wrapped files (demo and tests), OS keystore (optional), external KMS (named, untested).

### 17.4 Implementation design
Inventory: the signing keys of the single signer, one per role in `ledger | decision | capability | attestation | control | erasure`; per-tenant KEK; per-object DEKs (AES-256-GCM through `node:crypto`); connector secrets; session and IdP client secrets. Hierarchy: root secret (offline or externally held) wraps KEKs; KEKs wrap DEKs (envelope encryption); signing keys are separate from encryption keys and from each other, each in the **signer process** with a per-role policy contributed by its owner (the ledger key signs only checkpoints, the capability key only under the conjunction of section 6). The key registry and the KEKs are per tenant (INT-048); the judge path has the single tenant `tn_default`. **Two keys that earlier drafts listed are removed:** the broker receipt key and the approval-service countersign key have no role in the INT-017 set, so receipts are bound by their `action.executed` / `action.confirmed` leaf and the WAL hash chain (section 9.4) and approval records by the WebAuthn assertion and the `approval.granted` leaf; a per-receipt signature would need a `receipt` role added to M9's set (open, revision block). Each key has `{keyId, purpose, state, createdAt, activeFrom, cryptoperiod, supersedes}` and every state change is a signed ledger leaf. Rotation: new key `active`, old key `deactivated` (verify-only) for an overlap equal to the longest artefact lifetime of that key (capability TTL for the capability key; indefinite verify-only for ledger and decision keys so old bundles verify). Compromise: mark `compromised`, write the revocation, engage the kill switch for dependent scopes (a compromised capability key invalidates every unconsumed contract, and their reservations are released), re-issue pending approvals, rotate, and publish the compromise window so verifiers can treat leaves in it as suspect. Cryptoperiod values are configuration; defaults to be set against 800-57 after it is read in full.

### 17.5 Tests and acceptance
Rotation drill (sign with A, rotate to B, old bundle still verifies with pinned A, new objects use B); compromise drill (capability key marked compromised: broker refuses all outstanding contracts, signer refuses new ones, kill switch engaged, incident record created); the signer refuses to sign outside its per-role policy (negative tests per role); DEK destruction renders the object unreadable; key material never appears in traces, errors or cassettes (secret-scan tests).

### 17.6 Risks
Process-level separation on Windows and hardware-backed keys are **NOT VERIFIED**; the daemon is a stronger boundary than in-process but not a HSM. A compromised host owns everything it can reach; the design limits blast radius and says so.

### 17.7 Build notes
The signer process is M9's (build step 8a, ledger role first); the capability policy is added with component 4 and `KeyPort` and the DEK hierarchy are generalised here.

---

## 18. Component 16: Backup and recovery

### 18.1 References
Litestream (metadata: 14485 stars, Apache-2.0; SQLite WAL replication, not read), TigerBeetle's `docs/operating` directory (listed, not read), `13 §4.2` (consistency proofs, checkpoints, witnesses, tail-truncation caveat), NIST SP 800-61 Rev. 3 (incident recovery, component 19). No backup reference was read in depth.

### 18.2 What they do
Not established beyond the above; the decisive design point below comes from the broker protocol, not a reference.

### 18.3 Decision
**Own the recovery procedure; reuse generic copy tools.** The hazard that matters is not data loss but **exactly-once loss after restore**: a restored nonce store forgets consumed nonces and the broker could repeat a payment.

### 18.4 Implementation design
State to protect: WAL segments, ledger tiles and checkpoints, case event logs, evidence store (content addressed), configuration and policy bundles, key material (separately, component 15). RPO/RTO are configuration values per tenant (no numbers claimed). Procedure:
1. Backups are consistent snapshots plus continuous copy of append-only segments; every backup records the latest signed ledger checkpoint (size, root) and WAL head hash.
2. **Restore verification:** verifier V0 to V4 on the restored ledger (checkpoint, inclusion and consistency from the pinned pre-backup checkpoint where available); WAL hash chain intact; case folds reproduce `stateHash`.
3. **Restore epoch.** On restore the broker increments a signed `restore_epoch` record, which is also the `restore.epoch` ledger leaf and part of every contract's `aud` (`broker:<tenant>:<adapter>:<restoreEpoch>`) and of the `ReleaseBinding`, so every contract issued before the restore is invalid; exposure reservations from before the restore stay `reserved` until the reconciliation pass resolves each as `executed` or `released` (releasing early could understate exposure for a payment that went out after the backup point). The broker starts in `recovering` mode and refuses new executions until it has, for every capability issued after the backup point (found from the external anchor, witness or the tenant's own ledger replica), queried the target by `idemKey` and recorded the true state. Anything unaccounted for opens an incident.
4. Pending approvals are invalidated (world changed); their requests are re-issued by diff.
5. Crypto-erasure interplay: a restore that revives erased bodies is prevented because their DEKs are gone; erasure receipts replay as-is.

### 18.5 Tests and acceptance
Restore drill in the simulator: run a workload, back up at a random point, continue and execute payments, destroy the live store, restore, assert no duplicate effect in SimPay's ground truth after resuming the same workload; assert the broker refuses executions until reconciliation completes; assert pre-restore capabilities fail on the epoch. Ledger restore verifies with the standalone verifier.

### 18.6 Risks
If no external anchor exists, payments made after the backup point cannot be enumerated from our own records: reconciliation then relies on the target's statement for the period; the design requires an anchor or an independent per-tenant replica for production use and says so. **NOT VERIFIED** how often real targets provide complete statements by period.

### 18.7 Build notes
After the WAL and ledger exist; the drill is added to the nightly corpus.

---

## 19. Component 17: Observability and cost tracking

### 19.1 References
`13 §4.3` (OpenTelemetry GenAI conventions at a pinned version; trace as source of truth; OTLP JSON lines projection; "an audit trace cannot be sampled"); `06 §9.6` budgets and active-time accounting; spec F-BUDGET (per-phase budgets).

### 19.2 What they do
Defined there; M13 adds operational metrics and cost attribution.

### 19.3 Decision
**Own the metric set and the cost ledger; reuse the M7/M9 trace and the OTLP projection.** Audit-relevant events are never sampled; high-volume operational metrics may be.

### 19.4 Implementation design
Metrics (each with a definition in code): queue depth and age by queue; SLA warning and breach counts; approval latency, evidence-opened share, deny and expiry rates; capability issued, consumed, expired, refused (by reason); executions by outcome; unknown-state count and age; receipt mismatches; WAL append and `fsync` latency; kill-switch state; connector health and breaker trips; monitoring lag (event time to alert time); alert precision against labels; exposure and reservation totals; erasure and hold counts; restore epoch. Alerts are rules on these with owners. **Cost ledger:** per case and per tenant: model tokens and calls (from M7 `Budget.spent`), connector calls (against per-source rate budgets), storage bytes by class, human minutes (reviewer-time events), and currency through an adapter price table; reports show cost per case by outcome. Console panels (M10): operations board, connector health, cost, monitoring. Dashboards never read anything the trace did not carry.

### 19.5 Tests and acceptance
Metric definitions unit-tested on synthetic traces; every lifecycle transition and broker step increments exactly its metrics (trace-to-metric consistency test); alert rules fire in drills (stuck `EXEC_UNKNOWN`, stale connector, queue overflow); cost ledger totals equal the sum of per-run budgets on replay; zero console errors on the operations pages (spec section 14).

### 19.6 Risks
Cost in currency depends on a price table **NOT VERIFIED** for the sponsor endpoint (spec section 22). Human-minutes require an instrumentation choice (events, not keystroke tracking).

### 19.7 Build notes
Metrics are added with each component rather than at the end; the cost ledger needs the M7 budget API.

---

## 20. Component 18: Upgrades and migrations

### 20.1 References
`06 §9.10` (state with `schemaVersion` and a migration table; resume refuses when `graphHash` differs unless a migration is supplied); `13 §4.4` (replay corpus as a CI gate; Temporal replay raises a non-determinism error and is run against stored histories in CI); Temporal retry docs (above) for in-flight work semantics.

### 20.2 What they do
Pin the definition of a run to a hash and replay stored histories to catch incompatible code.

### 20.3 Decision
**Adapt.** Cases pin `machineVersion` and `policyBundleHash`; the WAL, case-event, receipt and capability formats carry `schemaVersion`; a replay corpus of stored case histories and WAL files gates every change.

### 20.4 Implementation design
- **In-flight cases** keep their `machineVersion` until a transition boundary; a new table version declares a mapping `oldPhase -> newPhase` for each case in a non-terminal phase, applied by an explicit migration event (`case.migrated`, a ledger leaf); a migration that cannot map a phase blocks the rollout.
- **Broker upgrade:** `drain` (new executions refused, `soft_freeze`), wait for every unresolved intent to resolve or reach `EXEC_UNKNOWN` with the new binary able to continue it, swap, `undrain`. WAL readers support the previous format for one release (golden WAL files from the previous version in the corpus).
- **Rollback:** forward-only data changes are forbidden unless old binaries can read them; otherwise the rollout requires a tested down-migration.
- **Policy bundle upgrades** are separate from code and use the rule-change gate.
- Differences in replay outputs need an `expected-diff` file reviewed like code.

### 20.5 Tests and acceptance
Replay corpus (golden histories) passes on the new code or carries an approved expected diff; upgrade drill under load (SimPay workload plus injected crash during `drain`) yields no duplicate effect and no lost intent; a downgrade drill reads the new WAL or refuses cleanly; migration property: for every non-terminal phase a migrated case continues through the same property suite.

### 20.6 Risks
Long-lived cases across breaking policy changes can be re-decided under new rules or kept under the old; the design pins the old (decision reproducibility) and re-decides only on a trigger. Which is preferred is a practitioner question.

### 20.7 Build notes
Add `schemaVersion` everywhere from the start; the corpus can be seeded from the first property-test runs.

---

## 21. Component 19: Incident response

### 21.1 References
NIST SP 800-61 Rev. 3 (April 2025, abstract read): incident response recommendations framed as a CSF 2.0 Community Profile; supersedes Rev. 2 (August 2012). `10` SEC-R1 (automatic demotion on incident); spec section 10 (autonomy demotion), section 18 (governance gaps list: "incident process" under NIST Govern). Regulatory notification duties are **LAWYER** and not designed here.

### 21.2 What they do
Rev. 3 integrates response into overall cybersecurity risk management rather than a standalone lifecycle; the project adopts its framing, not its control text.

### 21.3 Decision
**Adapt: playbooks as data tied to the broker's controls.** An `incident` is a case type in the same lifecycle with its own table and ledger leaves.

### 21.4 Implementation design
Incident classes with playbooks (ordered steps, owners, evidence preservation, kill-switch scope): **wrong or duplicate release**, **receipt mismatch**, **key compromise**, **connector compromise or wrong data**, **sanctions hit after release**, **data exposure or leak (egress manifest violation)**, **model or agent misbehaviour (injection success, restrict-only breach attempt)**, **monitoring failure (missed trigger)**, **restore or integrity failure**. Common actions: declare (ledger leaf `incident.declared`), contain (kill switch at the narrowest sufficient scope), preserve (automatic legal hold on involved cases and traces), assess (re-run affected decisions with exact cascading retraction, spec M6, to list the blast radius), recover (reversal attempts, component 7), communicate (templates, with the tipping-off rule applied), close with a review that must produce at least one **regression test or rule change** as an approval item. **Autonomy demotion** is automatic on any incident touching a decision path (spec section 10); re-promotion needs the anytime-valid statistics again.

### 21.5 Tests and acceptance
Tabletop drills implemented as scripted simulator scenarios (a `mutate_field` fault, a forged capability attempt, a compromised-key declaration, a missed list update); each must end with the expected containment, a legal hold on the scoped objects, a demotion event, and a blast-radius report that equals recomputation. Acceptance: every incident class has a playbook, a drill and a regression test.

### 21.6 Risks
Disclosure obligations, regulator contacts and customer notification are outside the technical design (**LAWYER**). The drills test our controls, not an organisation's response.

### 21.7 Build notes
Needs components 7, 8, 15 and 14.

---

## 22. Component 20: Capacity and cost model

### 22.1 References
SEC EDGAR 10 requests per second and declared user agent (`15 §4`); Companies House stream limit of two concurrent connections per account (read); GLEIF daily concatenated files (read); OFAC delta archive (read); `06 §9.6` budgets; spec 21c.6 (this gap). Queueing facts used are arithmetic identities (Little's law `L = lambda x W`, utilisation `rho = lambda / (c x mu)`), not citations. No production-scale reference system was studied; **every number below is a placeholder to be replaced by a measurement**.

### 22.2 Decision
**Own, as a parametric model with a harness that fills it from measurements.** The model predicts load and cost from a handful of parameters; the test is whether predictions match simulated runs within a stated tolerance.

### 22.3 Implementation design
Parameters: `V` vendors; tier mix `p_c, p_h, p_s, p_l`; cases per day `lambda_case`; list delta size `D` per update and updates per day `u`; registry event rate per vendor-day `r`; alert precision `q`; reviewer minutes per case `m`; approver count; per-case model tokens `T` and call count from M7 budgets.

Predictions:
- **Monitoring compute.** Reverse screening cost per update `C_rev = D x k_blocking x t_match`; forward rescreen `C_full = V x k_blocking' x t_match`; frequency of `C_full` is matcher-version bumps plus the periodic safety net. `t_match` and the blocking factors come from the M3 benchmark (**NOT VERIFIED**).
- **Registry load.** Polling budget for SEC: `V_sec / (10 rps)` seconds per full pass (arithmetic from the stated limit: 10,000 filers is about 1,000 seconds); Companies House uses one stream per account filtered through the inverted index, so cost does not grow with `V`; GLEIF and OFAC are file-sized, independent of `V`.
- **Human load.** Alerts per day `A = V x r x (1 - suppression)`, reviewer work `A x q x m_alert + lambda_case x m`, approver utilisation `rho`. Human capacity is the **binding constraint**, so the harness reports reviewer workload beside every safety figure (spec section 17), and the alert rules are tuned for precision against outcome labels.
- **Model cost.** Per-case tokens `T` times price table; the monitoring path adds model calls only when a new document must be extracted or an escalated case reruns the full pipeline. Cost per case by outcome is a report column.
- **Storage.** Bytes per case = evidence + trace + events + leaves + WAL; ledger leaves are small digests (`13 §4.2`); storage growth per tenant = `lambda_case x bytes_case x retention`. Retention rules (component 14) bound it.
- **Broker throughput.** The file WAL is bounded by `fsync` latency under a single-writer lock; releases are low-rate so this is expected to be adequate, but the exclusive-create `NonceStore` allows several brokers per tenant for higher rates. Tenants are partitioned by namespace, so throughput scales with tenant count.
- **Worked example (illustrative inputs, not measurements).** `V = 5,000`, a tier mix of 5/15/30/50 percent, 400 cases per day: the model outputs daily reverse-screening work, SEC pass time, expected alerts at an assumed precision and the reviewer-hours implied, and says which resource saturates first. The point of the example is the shape of the calculation.

### 22.4 Tests and acceptance
Scale test in the evaluation tier (not the judge path): generator creates `V` of 1,000, 10,000 and 100,000 vendors with event streams; measure monitoring lag, memory for the indexes, alert volume, time per reverse screening, WAL throughput; predictions within a stated tolerance of measurements or the model is revised and the miss is reported. A 1,000-vendor smoke test runs in CI. Report failures as well as passes, with the list of what was not covered.

### 22.5 Risks
Synthetic event rates may not resemble real ones; the model is only as good as its parameters; the largest unknown is real alert precision, which only practitioner data can supply.

### 22.6 Build notes
The harness comes after monitoring (component 11) and the generator (M11).

---

## 23. Component 21: Lifecycle property tests and the formal model of the broker protocol

### 23.1 References
fast-check model-based testing (docs read): commands implementing `check(model)`, `run(model, real)`, `toString()`; `fc.commands`; runners `modelRun`, `asyncModelRun`, `scheduledModelRun` (the last detects race conditions); failures report seed, path and `replayPath`. FoundationDB and TigerBeetle seeded simulation (`13 §5`). TLA+ (tlaplus/tlaplus, MIT, metadata only) and Obsigna's bounded Alloy model of the chain invariant (`13 §3.1`). `prior-art/06 §9.12` acceptance tests; spec 21b M13 line.

### 23.2 Decision
**Adopt fast-check for model-based and scheduled-concurrency tests; own the model, the properties and the simulator; add a small TLA+ model of the broker protocol checked with TLC in the evaluation tier.** The model is a deliberately simplified state machine of the lifecycle and broker (fast-check's own guidance: the model "should not be a carbon copy" of the system).

### 23.3 Properties (each has a test id; all run against SimPay with the fault matrix and with crash injection at every WAL and effect boundary)

| Id | Property | Oracle |
|---|---|---|
| P1 | no skipped state: every path to `EXECUTING` passes T07, T08, T09 (or an L3 grant record) | transition log |
| P2 | no execution without an approved, unexpired, unconsumed, audience-matching capability | SimPay ground truth versus capability log |
| P3 | single use under concurrency: N parallel `execute` of one capability yields one consume and at most one effect | `scheduledModelRun` plus ground truth |
| P4 | idempotent retry: any number of resubmissions of one capability yields at most one effect | ground truth |
| P5 | a receipt, a WAL record and a ledger leaf exist for every effect | cross-store join |
| P6 | crash at every boundary resumes without duplicate and without losing the intent | crash harness, final state hash |
| P7 | TOCTOU: mutate `factSetHash`, each list version, vendor-master version, account, amount, currency, vendor status, paid status between approval and execution; each is refused with the right reason | per-field mutation tests |
| P8 | expiry monotonic under clock skew and rollback | injected clock |
| P9 | SoD holds over every generated approval set | invariant check |
| P10 | after a list update no pending approval or capability remains valid | state scan |
| P11 | after a durable freeze record no new send occurs; in-flight intents each end recorded | interleaving generator |
| P12 | no outcome label has model lineage; no unconfirmed proposal is counted | label store scan |
| P13 | tenant isolation under random multi-tenant workloads | content scan |
| P14 | after a restore no pre-restore capability is accepted and no execution runs before reconciliation | restore drill |
| P15 | the pure `step` equals an independent interpreter of the table on random event streams | differential |
| P16 | every transition and refusal has a non-empty `why` | trace linter |
| P17 | no capability, approval or key from an earlier episode is usable in a later one | episode scan |
| P18 | appeal reviewer is independent of original assignee and approvers | org-graph property |
| P19 | reverse screening of list deltas equals forward full rescreen at the same version | differential |
| P20 | posted plus reserved exposure never exceeds the cap under any interleaving of mint, execute, expire, revoke | model check |
| P21 | `EXEC_UNKNOWN` is never resolved to "not sent" by a failed query or before visibility lag | fault matrix |
| P22 | erased objects leave receipts and no readable copy (in the harness's data classes) | scope scan |
| P23 | no `submit` before its `action.intent` leaf is published; verification steps run in the INT-016 order and nothing is consumed on a refusal; P3 and P6 hold for both `NonceStore` implementations | trace order check, mutation of the step order |
| P24 | an expired pending request ends in `HELD` with `expired_unapproved`, never `CLOSED` and never an execution; a pending approval does not reserve exposure and a mint is the only reserving step | transition log, reservation scan |

**Coverage discipline.** Properties are re-run per surface the case can enter by (MCP `submit_case`, A2A task, console, ERP event, monitoring alert) and per state (valid, expired, reused, tampered, wrong tenant, wrong episode, frozen). **Mutation tests**: delete each guard, each step of R, the freeze check, the consume, the lineage check; the suite must fail each time (inert-stub rule, spec section 19). Failures print `seed + commit` and a `replayPath`, and become permanent regression cases (`13 §5`).

### 23.4 The TLA+ model
Small-scope model of: capabilities, a WAL with atomic consume-and-intent, a target with commit-then-lose-response and visibility lag, crash and restart, freeze, and expiry. Invariants checked by TLC: `AtMostOneEffectPerCap`, `NoEffectAfterFreeze` (for sends after the durable record), `IntentBeforeEffect`, `NoResendWithoutValidity`. Results are stated with their scope (state bound, number of capabilities) and are statements about the model, not the implementation (spec evidence-ladder wording); the model's value is finding protocol-level errors before code exists. The TLC tool is Java, so it lives in the evaluation tier with committed expected outputs (spec 19a.8). Feasibility of checking at useful bounds is **NOT VERIFIED**.

### 23.5 Tests and acceptance (of the tests)
Positive controls: a broker with the consume moved after the send, one that treats query failure as not-sent, one with no TOCTOU check, one that lets a model-lineage label through; each is caught by the named property. The suite runs in CI at a small seed budget and nightly at a large one; counts of generated cases per property are reported with the list of properties not run.

### 23.6 Risks
The model and the implementation can share a misunderstanding; the independent interpreter (P15) and the TLA+ model reduce but do not remove that. Windows crash semantics may differ from POSIX; the crash harness runs on the actual judge platform.

### 23.7 Build notes
The harness and SimPay land first with component 1; each later component adds its properties on arrival.

---

## 24. Interfaces table

| Interface | Exposed by | Consumed by | Notes |
|---|---|---|---|
| `submitCase(req) -> CaseRef` | Case service | M10 (MCP `submit_case`, A2A, console), connectors, monitoring | creates a human review item, never executes; carries `attachments[{name, mediaType, size, bodyHash}]`, bytes by hash (INT-041) |
| `CaseState`, `TABLE`, `lifecycleHash`, `step()` | Component 1 | M10 (task state mapping), M9 (leaf types), M11 | pure, replayable |
| `ApprovalRequest`, `ApprovalRecord`, queue API; `ApprovalItem` (M5's shape) | Component 3 | M10 approval UI, M5 (item semantics as policy data), signer | one approval service owned here; only the authenticated UI creates approvals (INT-029) |
| `ExecutionContract` (M12) carrying `ReleaseBinding` (M8): verifier, capability signer policy | Components 4/5 | M8 (mint policy), M12 (container), M9 (signer), broker | one object, no M13 schema (INT-016) |
| `NonceStore` port (WAL and exclusive-create implementations) | Component 5 | broker, M8 tests `SEC-A6`/`SEC-A7`, M12 `ConsumedWal` | one port owned here (INT-016) |
| `Broker.execute`, `recover`, `freeze` | Component 5/8 | lifecycle runner, operations console | the only effect path |
| `TargetPort`, `TargetManifest`; published feature `target.reversible` | Component 6 | broker, M5 (reversibility feeds the autonomy cap), M11 | adapters and SimPay; restrict-only (INT-015) |
| `SimPay` and fault plans | Component 6 | M11 harness, demo, tests | labelled simulated everywhere |
| `ActionReceipt`, reversal records | Component 7 | M9 (V8 invariants, bundle), M6, console | superseding, never edited |
| `OutcomeLabel`, `LoggedDecision` | Component 9 | M6, M5 (promotion, rule evaluation), M11 | trust and lineage enforced at construction |
| `MonitoringEvent`, alert cases, portfolio views; published feature `overlay.releaseBlock` | Component 11 | M10, M5 (releaseBlock, exposure), M3/M4 (delta runs) | restrict-only (INT-015) |
| Exposure reservation API (`view`, `reserve` with `expectedLedgerSeq`, `settle`, `release`), `ExposureLedgerView` | Component 11 | M5 policy state (I6), T09 mint, broker step R | closes concurrent-approval hole; lands at step 11b |
| Connector contracts and health | Component 12 | M1 contract tests, broker guards | simulated twins from M11 |
| `TenantCtx`, `authorize()` (`AuthorizePort`), role matrix, RBAC-to-`SiloRole` table, `ParamDecl` registry | Component 13 | every module, M1 (`SiloRole`) | branded, enforced at ports |
| Retention rules, holds, erasure requests (receipts are M9's) | Component 14 | M9 (erasure service, the only deleter), M6, M2 stores | data map is mandatory |
| `KeyPort` (behind the single M9 signer); capability role policy | Components 15/4 | M9 (signer, registry), M8, broker | one signer, one registry, per-role policy (INT-017) |
| Metrics and cost ledger | Component 17 | M10, M11, operators | audit events unsampled |
| Playbooks and incident case type | Component 19 | M5 (demotion), operators | regression test required |
| Property suite P1 to P24, TLA+ model | Component 21 | M11 CI gate, 21b acceptance | evaluation-tier parts committed with outputs |

## 25. Spec feedback

1. **Resolved by INT-016 and INT-030.** One capability, three owners. Spec section 12 says there is one mechanism with one owner. Resolution: the M12 `ExecutionContract` (`act/po.release`) carrying the M8 `ReleaseBinding`, minted by the M9 signer; M12 owns the container and its verify and consume rules, M8 the binding contents and minting policy, M13 the broker, the `NonceStore`, re-validation and the approval service. Approval waiting is a case state, not a run interrupt; M7 interrupts stay for in-run questions.
2. **Resolved by INT-048.** Ledger per tenant, not per deployment: log identity `<ns>/ledger/<deploymentId>/<tenantId>`, per-tenant key registry; the judge path runs `tn_default`.
3. **Resolved by INT-031.** Three named clocks (`requestExpiresAt`, `approvalWindowW`, `capabilityTtl`); expiry of a pending item moves the case to `HELD` with `expired_unapproved`.
4. **Resolved by INT-065** (spec wording, section 14a). Rule kept here: evidence-backed human findings are `VERIFIED`; unsupported human assertions are `UNTRUSTED` notes; the `labeller` to M6 `writer` mapping is stated in component 9.
5. **Resolved by INT-015 and INT-032.** Reversibility comes from `TargetManifest.reversal`, published to M5 as `target.reversible`, not from a model.
6. **Resolved by INT-032.** For money-moving classes `release` at AL2 produces a one-approver item and `release_with_approval` a multi-approver item; "auto-coverage" means fast-lane coverage.
7. **Resolved by INT-016.** Restore epoch in `aud` and in the `restore.epoch` ledger leaf, with the reconciliation requirement (component 16).
8. **Resolved by INT-015.** Policy state includes reservations; M13 owns the compare-and-set reservation API (component 11) and M5 reads `ExposureLedgerView`.
9. **Resolved by INT-040.** Immutable id, digest and trust label; the body is a tombstone; erasure is M9's protocol (component 14).
10. **Resolved by INT-015.** `releaseBlock` is published to M5 as the restrict-only feature `overlay.releaseBlock`.
11. **Resolved by INT-049.** M9's `LeafV1` and registry are normative; M13's names (`action.intent`, `action.executed`, `action.confirmed`, `action.not_sent`, `action.reversed`, `approval.invalidated`, `freeze.engaged`, `restore.epoch`, `access.audit`, `erasure.receipt`, `incident.*`, `hold.*`, `case.migrated`, with `capability.issued`) replace `release.intent` and `release.result`. V8 "no `action.executed` without a prior `action.intent` and `capability.issued`" holds by `walSeq` order.
12. **Resolved by INT-024 for the silo contract and the generator** (`editor_sub` and `last_write_*` columns, default-deny when missing). **Open:** availability of the editor identity in a real ERP stays **NOT VERIFIED**.
13. **Resolved by INT-065** (spec wording). This blueprint gives the kill switch, approver authentication and key custody a component and a test id each.
14. **Resolved by INT-065** (spec wording). Monitoring is repository depth and not demo content (section 1a).

## 26. What this blueprint does not cover

- Any real payment rail, bank API, ERP or identity provider: connectors and the simulated payment system are our models, and real rail behaviour (cut-offs, returns, statements, key support) is **NOT VERIFIED**.
- Legal and regulatory questions (GDPR Art. 22 contest rights, retention periods, tipping-off, notification duties, AI Act scoping): all **LAWYER**.
- Out-of-band attestation design and the multi-channel defence against voice-cloned callbacks (spec 21c.3): only the approval step is treated here; the attestation step belongs with M8.
- Document forgery, console visual design, locale (spec 21c.1, 21c.4, 21c.7), commercial landscape (21c.5).
- Multi-node and high-availability deployment beyond the two `NonceStore` implementations (a SQL implementation of the port is named, not built); hardware security modules; confidential computing.
- Real WebAuthn browser ceremony details, IdP-specific behaviour, and library selection (deferred to a short bake-off).
- Measured results of any kind: no test has been run, no number in this document is a measurement, and the capacity model's inputs are placeholders.
- Surfaces and states not yet exercised by design: partial settlement of multi-line payments, multi-currency conversion, batch payment files, recurring payments, vendor-initiated disputes through channels other than the buyer, and cross-tenant shared vendor intelligence (explicitly excluded by the isolation design).

## Pass 3 resolutions (2026-10-13)

Source: `99b-integration-register-pass3.md` (INT-101 onward). These bindings override the body above wherever they differ; the body has not been rewritten. Each line is one binding change; the register item holds the reason and the other modules affected.

- **INT-102.** `NonceStore` files, tenant directories and WAL names are built with `pathOf` and path segments; no colon.
- **INT-103.** The broker recomputes `accountCommit` from the raw `broker`-role read with the tenant salt and tag `plumbline/account/v1`; the tenant salt sits in the per-tenant KEK hierarchy and is not destroyed by a case erasure.
- **INT-106.** Section 6.4 uses the payload type `application/vnd.plumbline.execution-contract+json`.
- **INT-110.** Transitions are cited `M13-T07` outside this file.
- **INT-125.** The signer role list in sections 6.4, 17.3 and 17.4 gains `run`: seven roles. No receipt key and no countersign key (confirmed).
- **INT-126.** Approver credential public keys are the `approver.enrolled` leaves (enrolment is a two-person `roster_change` after a flagged bootstrap); revocation (`approver.revoked`) invalidates pending approvals by that credential. Assertions are checked with M8's `verifyAssertion`.
- **INT-127.** The challenge `H(tag || requestHash || sessionNonce)` is normative (`sessionNonce` is the single-use WebAuthn ceremony nonce); the signer and broker check by recomputation from `bindingDigest`.
- **INT-128.** `payment.reverse` binds `reverses {actionId, receiptHash, originAccountCommit}`: the broker compares payee and account with the receipt's origin, not the vendor master, and refuses a new payee or a larger amount. One `approval.granted` leaf per accepted `ApprovalRecord`.
- **INT-129.** Import the `NonceStore` type from M12's contract module and implement it twice (single-writer WAL with fsync; exclusive-create file); this module depends on M12, never the reverse.
- **INT-130.** Depend on M5a's `ApprovalItem`, `ApprovalSlot`, `Binds` and `eligible`; implement M7's `ApprovalPort` (`submit`, `get`, `list`).
- **INT-131.** Add `ApprovalSession` keyed by (`bindingDigest`, principal): `provisional {action | need_info, reason?, at}`, `evidenceOpened {evidenceId, spanIds, openedAt, visibleMs}[]`, advisory `claimedUntil` (at most 60 s, per slot); `ApprovalRecord.sessionDigest` replaces `evidenceOpened`. Add `reissue(requestId, reason)`: pending only, at most `maxReissues` (2) within `maxRequestLifetimeSec`; new request with the same `bindingDigest`, fresh `nonce` and `requestExpiresAt`, `supersedes`; the old request is `superseded` and its records `invalidated`.
- **INT-132.** Add `AttestationTask` to the task queue (created by hold reason `attestation_needed`; no new case phase, no approval item); completion appends `attestation.recorded` and calls the signer under `attestation`. The recorder is neither requester nor vendor-master editor. M8 owns schema, two-channel rule and tests.
- **INT-133.** Emit `erasure.completed` (not `erasure.receipt`) and `action.intent` (not `release.intent`).
- **INT-152.** Register the `case.*` events as verbs in M7's `trace-verbs.json` (lint `TL19`).


> v5.2 (D-026): profile-pass additions for this module are in `98-profile-pass-additions.md` (adoption register ids; they win over this blueprint where they differ).
