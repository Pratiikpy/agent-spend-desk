# Module 03: Reconcile (implementation blueprint)

## v5.1 alignment (2026-10-15, spec section 0 wins where this blueprint disagrees)

- Add bounded, deterministic multi-hop related-party traversal (shared director, bank account, address) with explainable paths; personalised ranking only to order candidates for review (D-015).
- Bake-off 3 now includes exact correlation clustering with hard cannot-link constraints on small components (D-015).
- The hero pack reads the vendor through the Zetaris semantic layer when available; Graphiti-style validity windows remain the model for facts over time.


## Integration revision (2026-10-13)

Source: `99-integration-register.md`. Changes are made in place; sections the register does not touch are unchanged. Spec feedback items carry a disposition.

**Applied.**
- INT-007: `TruthCellStatus` and its projection deleted; the shared five-valued `CellStatus` is used; `Fact` is the shared type (§1 types, component 14 status rules, `Cell.status`, RC-14.6, Interfaces table).
- INT-013: fused-value trust is the meet over `supports`; defeated, ineligible and suspect inputs are recorded in `defeats` and hashed into the fact id; new tests RC-8.6, RC-8.7 (component 8 item 5, components 10, 14, 16).
- INT-034: M4 owns `Evaluator` and `V = phase2 ∘ phase1`; M3 supplies the reconcile half as `keys/deps/phase1Cell` plus trace nodes (§1, component 9 item 4, component 13 signature, component 16, Interfaces table). `robustness` takes `verdictOf` (M4) and `reads` (M5) as injected values.
- INT-035: the matcher takes `direction: screening | corroboration`; a failed or abstaining match leaves the pair `possible`; a model never clears a hit or alone satisfies required positive evidence (component 6 decision and item 3).
- INT-036: link judgements are per pair: the select call only nominates, a pairwise confirmation in both orders records the edge; `inputs` are exactly the pair's assertions; fallback `locality: "set"` (component 6 item 3, `LinkEdge`, §1, RC-6.7).
- INT-037: M3 depends on no module above it; `verdictOf` and `reads` are injected function values, M6 and M4 use `fuse` as a pure library (§1 Depends on, component 13).
- INT-010: integer scales are the named types `Cb` and `Milli`; floats stay in Stage A memory only (§1, component 5).
- INT-022: `ExtractionDiag` has the five shared agreement states (component 1, component 7 step 1).
- INT-062 (e), (b): the product conflict policy is M3's `ResolverPlugin`; the engine's built-in policy and auto-merge are conformance-profile only (component 2 item 5).
- INT-039, INT-065: wording only in the spec; Spec feedback dispositions updated; component 10 item 3 states the split acceptance line.
- Interface matrix rows without an INT id: M1 to M3 (`origins.json` and `requiredChannels` read as pack data); M8 to every module (stored `trust`/`conf` are `LabelRecord` fields, re-minted by `fromStored` at privileged boundaries; INT-013, INT-014 boundary).

**Named by the register, deliberately not applied.**
- INT-014: not an M3 edit (no numeric level exists here). Only the consumer-side need is met: `Cell.supportLabels` (trust, authorship, tier of each supporting group) so M5 can look up the permission matrix.
- INT-015: M5 gains the new feature inputs; none is produced by M3.
- INT-044: class-B replay of reconcile from recorded links already follows from Stage A/B; no change.
- INT-050: the verifier-interpretable size criterion is stated for the policy IR only; not extended to Stage B here (see contradiction 4).
- D6 (OpenSanctions licence stance) is Prateek's decision; the blueprint already treats the data as local and non-redistributable.

**New contradictions found.**
1. M4 C8 keys are `cell:<entityId>/<attribute>`, but entity ids are membership-derived (component 1 item 4) and change with the present set, so the key set is not fixed. Resolved here by anchored keys `cell:<anchorMention>/<attribute>` (the cell of the entity containing that mention); M4 C8 must accept.
2. INT-014 needs authorship and tier of the winning group per field; the shared `Fact` carries neither. `Cell.supportLabels` added; conventions and M5 C1 must accept it.
3. INT-036 raises the model-call arithmetic from 2 to 4 calls per nominated pair; the per-case ceiling of 12 now covers 3 pairs (was 6). Ceiling is a `LinkConfig` constant; M14 C6 must use the same count.
4. INT-050 gates the policy IR on a roughly 500-line verifier-side interpreter, but the verifier also re-implements `fuse` (rank vectors, `cluster`, repair, set packing, bracketing) and no size budget exists for it.
5. Collision with INT-011: RC-5.4 said "L0 recomputes"; L0 is the claim check. Reworded to "the recompute check".
6. INT-022 names four agreement states; the shared `ExtractionDiag` also has `single`. Treated here as: `single` is no evidence of disagreement.

Status: design, 2026-10-13. Nothing here is built or measured. Every design claim is a hypothesis with a named test; whatever is unseen is marked **NOT VERIFIED**. Conventions, shared types and pseudocode style: `00-conventions-and-shared-types.md`. Contract refined: `../00-architecture-master-spec.md` v3.1 section 8 (with 5 for trust, 6 for authority, 9 and 9a for the verdict function V, 13 for the verifier's recompute module). Evidence base: `../prior-art/01`, `07` (deepest), `08` section 1, `15` sections 4 and 6, the local clones named below, and references verified for this document on 2026-10-13 (GitHub metadata through `gh api`, source read through `gh api` contents or the local clones, papers by page fetch).

## 1. Scope and contract

**Job.** Turn typed, provenance-carrying assertions from M1 (channels, internal silos through the Zetaris port) and M2 (document extractions) into (a) a set of recorded **link judgements** between mentions, (b) a bitemporal **fact store** contract (the World Model), and (c) a **truth table**: one cell per (entity, attribute), each with a value or an honest non-value, a status, a provenance expression, an evidence-mass triple, conflicts, fetch-state coverage and gaps. It also owns the sanctions and watch-list matcher, identity-hypothesis robustness, the request-more hook and the idempotent re-run diff.

**Inputs.** `Assertion[]` (shared type), `Evidence` metadata (authority, authorship, trust, fetch state per channel), the declared origin DAG from M1, the pack's `ReconcileRules` bundle (attribute specs, authority tables, link configuration, versioned and hashed), an as-of pair `(validAt, knownAt)`.
**Outputs.** `LinkEdge[]` (recorded in the M9 ledger), `TruthTable`, `Fact` values with `Id<"fa">` for M4 and M5 (`Why.factIds`), `Gap[]`, `ReplanRequest[]`, `TruthTableDiff`, `IdentityRobustness`, and the reconcile half of V(S): the adapter `keys/deps/phase1Cell/trace` that M4's `Evaluator` composes (component 9 item 4). M3 does not own V(S): M4 owns the `Evaluator` interface and `V = phase2 ∘ phase1`, where `phase1 = M3.fuse ∘ label aggregation (M4 C9) ∘ feature extraction (M5.featurize)` and `phase2 = M5.evaluate` (INT-034).
**Depends on.** M7 ports (clock, ids, model, cassettes, budgets), M8 trust labels (`combine`), M1 channel metadata (authority per attribute, origin DAG, fetch states), M2 extraction diagnostics. No dependency on M4, M5 or M6 at package level: `robustness` receives `verdictOf` (M4's `phase2 ∘ phase1` with M5a's `evaluate`) and `reads` (M5a) as injected function values (INT-037). **Depended on by.** M4 (V, frozen ledger), M5a/M5b (cells as typed inputs), M6 (facts for decision-dependency; `fuse` used as a pure library), M9 (bundle members, verifier recompute), M10 (truth-table view), M11 (benchmarks), M13 (re-screening triggers).

**The one structural decision that makes the rest tractable: two stages with a hard boundary.**
- **Stage A, link (impure, may use floats internally, models and cassettes).** Candidate generation, scoring, the cascade, the model matcher. Its only output is `LinkEdge[]`: integer-valued weight ledgers, a verdict, the exact assertion ids read for that one pair (`inputs`, the per-pair edge-locality set required by spec section 9; INT-036). Recorded in the ledger. Never re-run inside V.
- **Stage B, fuse (pure, integer and ordinal only, no model, no floats, no clock).** `fuse(assertions, edges, rules, lineage, coverage, asOf) -> TruthTable`. This is the "reconcile" inside V(S) of spec section 9: V(S) drops edges whose `inputs` are not all in S and takes the rest as recorded. The verifier's recompute module (spec section 13, V6 to V8) implements exactly this function and nothing from Stage A, so a second-language implementation cannot diverge at a fuzzy threshold; fuzzy scores never appear in V. Everything in components 1, 2, 7 to 11, 14, 16 is Stage B; components 3 to 6 and 12 are Stage A; component 13 and 15 orchestrate both.

```ts
// Module-level types (extend the shared vocabulary; nothing here weakens a shared type)
type EntityType = "org" | "person" | "account" | "address" | "listing";     // listing = an entry on a watch list
interface Mention { id: Id<"mn">; kind: EntityType; originId: Id<"og">; recordKey: string; trust: TrustLevel; conf: Confidentiality }
type LinkVerdict = "same" | "different" | "possible";                        // 'different' is a cannot-link; absence of an edge is "not compared"
interface LedgerLine { comparison: string; level: string; weightCb: Cb; qualifier: boolean; group?: string; inputs: Id<"as">[] }   // Cb: integer centi-bits (shared scale type)
interface LinkEdge {
  id: Id<"le">; a: Id<"mn">; b: Id<"mn">; verdict: LinkVerdict;
  tier: "identifier" | "exact" | "fuzzy" | "model" | "human" | "unique_id_conflict";
  ledger: LedgerLine[]; scoreCb: Cb; primaryCb: Cb; hardDiscriminators: string[];
  inputs: Id<"as">[];                       // exactly the assertions of mentions a and b that the scorer read (per-pair edge locality); never other candidates' assertions unless locality is "set"
  locality: "pair" | "set";                 // "set": conservative fallback, inputs = union over every shown candidate (component 6 item 3)
  policyVersion: string; recordedAt: Iso; supersedes?: Id<"le">;
  model?: { modelId: string; promptHash: Hash; nominated: Id<"mn">[]; choice: Id<"mn"> | "none" | "abstain"; nominateOrderings: 2;
            confirm?: { orderings: 2; agree: boolean; promptHash: Hash }; direction: "screening" | "corroboration"; note?: string };  // note is a label, never evidence; `nominated` is audit only, not in `inputs`
}
interface AsOf { validAt: Iso; knownAt: Iso }                                // valid time and system time; both always explicit
// CellStatus is the shared five-valued type: resolved | unresolved | silent | not_checked | unavailable ("silent": every required channel was checked and nothing says). No local extension, no projection (INT-007).
// Fact is the shared type (conventions): { id, cell, value, trust, conf, personal, supports: Id<"as">[], defeats: Id<"as">[], prov }. trust/conf/personal are stored LabelRecord fields; privileged consumers re-mint them with M8 `fromStored`.
```

**Determinism contract (applies to all Stage B code).** No `Math.log/exp/pow` or other transcendental functions (engine-dependent results); only integer arithmetic and `+ - * /` on doubles where unavoidable, with rounding to integers before anything is hashed; no iteration over unsorted `Map`/`Set`; every list canonically sorted by a documented key; all hashed documents under the JCS profile of spec section 4 (no floats); ids are `sha256` of domain-separated canonical bytes (`plumbline/reconcile/<kind>/v1`).

## 2. Component list

1. Mention-level assertions, observation grouping and the derived entity view
2. Bitemporal fact store and as-of queries (the World Model contract)
3. Normalisation: names, identifiers, legal forms, transliteration, homoglyphs
4. Blocking and candidate generation
5. Link scoring: weight ledger, discriminators, time-decayed levels, three regions
6. Resolution cascade, model matching in the possible band, cannot-link, clustering and transitivity audit
7. Conflict taxonomy and classification, with extraction-versus-source ordering
8. Fusion rules: eligibility, authority, authorship, cardinality, freshness, recency, bracketing
9. Repair semantics: the normative definition of `unresolved`, and the clingo differential oracle
10. Provenance expressions on every derived cell
11. Declared lineage, independence counting, the evidence-mass triple and ordinal tags
12. Sanctions and watch-list matcher and its perturbation test
13. Identity-hypothesis robustness
14. The truth table: fetch states, coverage and gaps
15. Request-more and re-plan hooks
16. Incremental recomputation and the idempotent re-run diff

---

## Component 1. Mention-level assertions, observation grouping and the derived entity view

**3. Best references.**
- FollowTheMoney `Statement` (opensanctions/followthemoney, MIT, 103 stars, pushed 2026-10-05): per-statement storage with raw and normalised value, dataset, `first_seen`, `last_seen`, `origin` and a separate `canonical_id` (read by `07` section 1.3 in `followthemoney/statement/statement.py`).
- nomenklatura (opensanctions/nomenklatura, MIT, 270 stars, pushed 2026-10-12): `nomenklatura/resolver/resolver.py`, `judgement.py`.
- Graphiti (Apache-2.0, local clone `research/track-1-fragmented-intelligence/graphiti`): `EntityEdge` carries `episodes` and event/system times (`graphiti_core/edges.py`), but entity identity is decided at write time and merged nodes lose the mention.
- Cognee (Apache-2.0, local clone): `generate_node_id.py` derives an entity id from the lower-cased name only, so type is not part of identity and two mentions merge irrevocably.

**4. What they actually do.** nomenklatura stores statements, never rewrites them on merge, and keeps judgements as edges in a separate table; `Resolver._decide` with `POSITIVE` canonicalises by creating a fresh canonical id and re-pointing both members (`resolver.py`, read 2026-10-13). Cognee and Graphiti resolve at ingestion, so un-merging is lossy (`prior-art/01` sections 6 and 7).
**Read in code, new finding:** `Resolver._decide` contains no check of existing blocking edges. The guard (`get_judgement`: "any blocking edge spanning the two clusters decides the pair") is applied only by callers such as `xref.py` through `check_candidate` before suggesting. A human or auto `decide(POSITIVE)` on a blocked pair therefore merges the clusters and leaves the negative edge shadowed (`get_judgement` returns POSITIVE first when `other in entity_connected`). This closes the open question in `prior-art/07` section 12 (it said NOT VERIFIED). Our invariant is enforced inside the clustering function, not by convention (component 6).

**5. Decision. Adapt** the statement/judgement split; **own** the observation grouping and the content-derived entity id. Rejected: write-time resolution (Graphiti, Cognee) because it cannot satisfy "un-merge then re-merge yields an identical truth table".

**6. Implementation design.**
1. **Mention.** A mention is one source record's view of one thing: key `(originId, recordKey)` (for example `gleif:<LEI record>`, `erp:vendor/V-1043`, `doc:<documentHash>#party/2`). `mentionId = mn_ + H("mention", originId, recordKey)`. It is stable across re-fetches, so a re-run produces the same mention ids.
2. **Assertion** (shared type, with `trust`, `conf`, `personal`, `derivedFrom`, `diag`). One observation of one attribute of one mention. `id = as_ + H("assertion", mentionId, attribute, canon(norm), validFrom, validTo, evidenceId)`. `norm` is produced by the attribute's normaliser (component 3); `raw` is kept beside it.
3. **Observation grouping (derived, Stage B).** Assertions with equal `contentKey = H(mentionId, attribute, canon(norm), validFrom, validTo)` form one `ObsGroup`. A live re-fetch that returns identical content creates a new `Evidence` and new assertions, but they fall into the same group as additional observations: first-seen and last-seen move, nothing else. Fusion works on groups, so repeated corroboration by the same origin cannot raise support (TOKI's "belief-drift skew" anomaly, `prior-art/07` section 3.2, is impossible by construction).
```ts
interface ObsGroup { key: Hash; mentionId: Id<"mn">; attribute: string; norm: Json; validFrom?: Iso; validTo?: Iso;
  originId: Id<"og">; tier: AuthorityTier; authorship: Authorship; trust: TrustLevel; conf: Confidentiality;
  obs: { assertionId: Id<"as">; evidenceId: Id<"ev">; observedAt: Iso; recordedAt: Iso; supersededAt?: Iso;
         extractor: string; parserVersion: string; diag?: ExtractionDiag }[];                 // sorted by (observedAt, assertionId)
  firstSeen: Iso; lastSeen: Iso }
// ExtractionDiag is the shared type (INT-022): doubleExtracted "agree" | "disagree" | "model_only" | "parser_only" | "single"; quoteCheck "exact" | "normalised" | "absent" | "not_run"; ocr?: boolean
```
4. **Derived entity view.** `entities(edges, mentions) -> Entity[]` is the clustering of component 6. `entityId = en_ + H("entity", sorted member mentionIds)`; `keys[]` lists authoritative identifiers found in the cluster (`lei:...`, `cik:...`, `erp:...`) for stable display and for M6 retrieval keys. Un-merge then re-merge returns the same member set and therefore the same id and table. Entity ids change when membership changes; downstream references are content-addressed facts, never entity ids held across runs.
5. **Authorship and trust ride the group.** `authorship`, `tier`, `trust`, `conf` are copied from `Evidence`; `combine` is used only to derive new labels (spec section 5). Registry free-text attributes (remarks, other names) arrive `UNTRUSTED` regardless of channel authority.
6. **Relationship assertions.** Ownership and control (`owns`, `director_of`, `has_account`) are assertions whose `norm` is `{ref: <identifier | mentionId>}`. The target is resolved through clustering; the cell holds an entity reference and a per-hop provenance. Depth is bounded by the pack (default 6) and a `ownership_depth_cap` gap is raised when hit. Aggregation thresholds live in M5 policy, never here.
7. **Concurrency and failure.** Ingestion is single-writer per case (a FIFO queue, as in the Meterless reference); assertion writes are idempotent on `id`; a malformed assertion (missing `evidenceId`, unnormalisable value, unknown attribute) is rejected with a `validation` error and recorded as an `extraction_reject` gap, never coerced.

**7. Tests and acceptance.** RC-1.1 shuffled assertion order gives an identical `TruthTable.hash` (property test, 1000 seeds). RC-1.2 re-ingest of identical bodies gives an empty diff; a re-fetch with identical content and a new `retrievedAt` gives an empty truth-table diff. RC-1.3 un-merge then re-merge gives an identical table. RC-1.4 repeated observation by one origin 50 times leaves `support` unchanged. RC-1.5 a mutation test that drops a parent from a derived assertion's `derivedFrom` fails the taint test (M8). Metric: none beyond equality; these are exact.
**8. Risks.** Content-derived ids make every normaliser change a re-keying event, so normaliser versions are part of `parserVersion` and are bumped deliberately; a golden-hash test pins them. Entity id churn on membership change is accepted. Grouping assumes `canon(norm)` is a faithful equivalence per attribute (component 8 defines `eqv`); a wrong `eqv` hides a conflict. NOT VERIFIED: sizes of real ledgers.
**9. Build notes.** First in order after kernel contracts: everything else reads these types. Unblocks 2, 8, 10, 16.

---

## Component 2. Bitemporal fact store and as-of queries (the World Model contract)

**3. Best references.**
- Meterless World Model reference (Apache-2.0, local clone `research/sponsor-reference/Meterless/engines/world-model`, six source files, eight conformance checks); contract summary in `docs/sponsors/meterless-engines-engineering-brief.md` section A.2.
- Graphiti bitemporal edges (`graphiti_core/edges.py`, `utils/maintenance/edge_operations.py:resolve_edge_contradictions`, local clone).
- XTDB (xtdb/xtdb, MPL-2.0, 3081 stars, pushed 2026-10-12; README: SQL:2011 bitemporal semantics) as a query-shape model and optional oracle; SirixDB and minigraf (README claims only, `prior-art/07` section 3.1).
- TOKI, arXiv 2606.06240, and the other 2026 memory preprints (abstract only, `prior-art/07` section 3.2): named write-time anomalies, used here as tests.
- BODS 0.4 statement lifecycle (`new | updated | closed`, `prior-art/07` section 3.3).

**4. What they actually do.** The World Model reference is an event log folded into state; `assertFact` appends a fact event and then **mutates folded state directly** (`index.ts` lines 228 to 243: `supersededBy` on rival facts and `entity.attrs[predicate] = winner.value`), while the fold function for `assertFact` only stores the fact (`store.ts` lines 126 to 130). I read both: after a restart that replays events, the winning attribute and the `supersededBy` marks are not reconstructed. The engineering brief's inference is therefore confirmed in code. Its conflict policy is one global option (`most-recent-wins | highest-confidence-wins | source-priority | manual`) and the winner loop is greedy and order-sensitive (`rival.assertedAt > winner.assertedAt`). Its `relate` fold closes an earlier open edge with the same `(from, type, context)` and a different target, which makes every edge type single-valued (`store.ts` lines 113 to 122). Graphiti resolves contradictions as a function of dates but does nothing when either `valid_at` is missing, and **equal** `valid_at` values also fall through every branch (`resolve_edge_contradictions`, read): two current contradicting edges survive silently.

**5. Decision.** **Own** the contract and implement the engine to the Meterless conformance runner (8 checks, passed through an entity-level facade); **adapt** the event-sourcing and `foldUntil` idea; reject greedy in-place resolution and global conflict policy. Resolution is **never stored**: it is a view, a pure function of the fold (component 8). Engine strategy (fork versus from-spec) is bake-off 6 in the spec and not decided here.

**6. Implementation design.**
```ts
type StoreEvent =
  | { kind: "assertion.observed"; assertion: Assertion }
  | { kind: "assertion.superseded"; assertionId: Id<"as">; byAssertionId: Id<"as">; reason: "record_updated" | "correction" | "extractor_rerun" }   // system time only
  | { kind: "judgement.recorded"; edge: LinkEdge }
  | { kind: "judgement.retracted"; edgeId: Id<"le">; reason: string }
  | { kind: "source.checked"; channel: string; query: Hash; state: FetchState; at: Iso; listVersion?: string; coverage?: Json }
  | { kind: "rules.pinned"; rulesHash: Hash };
interface StoreEventEnvelope { seq: number; at: Iso /* recordedAt, from ctx.clock */; ev: StoreEvent; prevHash: Hash; hash: Hash }
interface FactStore {
  append(ev: StoreEvent): Result<StoreEventEnvelope, "validation" | "fatal">;      // single writer, idempotent on content hash
  fold(upTo?: { seq?: number; knownAt?: Iso }): StoreState;                       // pure; deterministic
  view<T>(name: "truth" | "entities" | "history" | "graph", q: AsOf & object): T;  // projections; never persisted as truth
  stateShapeCanonical(): string;                                                  // JCS of the fold, for idempotency checks
  audit(): AuditEntry[];                                                          // seq strictly increasing
}
```
1. **Two time axes, always explicit.** Valid time (`validFrom`, `validTo`, `observedAt` on the assertion) and system time (`recordedAt` = envelope `at`, `supersededAt`). Every query takes `AsOf { validAt, knownAt }`; an omitted `knownAt` is a defect, not a default. `recordedAt` comes from `ctx.clock`, which is cassette-recorded, so replay is deterministic. (The Meterless reference derives record time from `source.at` "never the wall clock"; that rule is met in spirit by routing the clock through the M7 port, and the conformance runner does not test it. See Spec feedback 6.)
2. **Active set at (validAt, knownAt).** An assertion group is *active* iff some observation has `recordedAt <= knownAt` and (`supersededAt` is unset or `> knownAt`), and its **effective interval** contains `validAt`. Effective interval rules, by the attribute's `temporalKind` (component 8):
   - `event` (incorporation date, designation date): validity is unbounded; a re-fetch with a different value is a **correction**: system-time supersession only (`assertion.superseded` with reason `correction`), validity untouched.
   - `state` (status, address, account, name): an observation holds from `validFrom ?? observedAt`. A later observation of the same `(mention, attribute)` with a different value closes the earlier one at `later.validFrom ?? later.observedAt` (valid-time supersession, derived in the view, not stored) and also marks the older record system-superseded when the same source record is re-read. Between two observations by one origin that **disagree**, a `validAt` strictly between them with no explicit `validFrom` on the later one is `bracketed_change`: the cell is `unresolved` with that reason (honest "it changed sometime between"), not silently the old value. Between two observations that **agree**, the value is bridged and flagged `inferred: true`.
   - `period` (appointments, ownership stakes): explicit `[validFrom, validTo)` required; a missing bound is `open` and flagged.
3. **Operators that are impossible by construction (TOKI anomalies as tests).** Replay inconsistency: the same event multiset in any order gives the same `stateShapeCanonical` and table, because `fold` sorts by `(at, seq, hash)` and ties are broken by hash, and the view is a function of the multiset of assertions and edges, not of arrival order. Belief-drift skew: component 1 step 3. Audit erasure: a superseded assertion stays in the log; `knownAt` earlier than the supersession returns it.
4. **Belief-base postulates as property tests** (`prior-art/07` section 6.2, used as tests, no AGM-compliance claim): success (a superseding assertion is active after), inclusion (no unrelated cell changes), vacuity (re-asserting an existing group changes nothing), consistency (a consistent input never produces a cardinality violation), minimal change (only the superseded group's effective interval moves).
5. **Entity-level facade for conformance.** `upsertEntity` (rejects when `source` is missing), `relate` (edge types are single-valued unless declared many-valued, so bitemp-001 passes with undeclared `plays-for`), `ingest` (idempotent, returns `changed`), `neighborsOf(id, {via, at})`, `normalizeName`, `entityIdFromName(type, name)` (type is part of the key, sid-002), `decide(similarity)` (band defaults 0.85/0.82 per the runner, `conformance` profile only; in the product profile the engine's auto-merge is disabled and name similarity only proposes, because the reference formula scores "Series A Holdings" against "Series B Holdings" at 0.9412 (M12 SF6); the product never auto-merges on name alone, component 6). The engine's built-in conflict policy is likewise conformance behaviour; the product policy is M3's `ResolverPlugin` (components 6 to 9) (INT-062). These names exist for the vendored conformance runner and the Meterless-facing demonstration; the reconcile path uses the assertion API above, and `ingest` routes through the same cascade (closing reference gap 6 of the brief: ingest bypassing resolution).
6. **Payee identity keys** are external identifiers (`org:gleif:<LEI>`, `org:internal:<vendorId>`), never name-keyed ids (spec section 19).
7. **Failure.** `append` is atomic (write-ahead, then fsync, then ack); a torn tail is detected by the hash chain and truncated on open with a trace line; a conflicting duplicate `seq` is `fatal`.

**7. Tests and acceptance.** RC-2.1 Meterless runner 8/8 through the facade. RC-2.2 restart test: fold, persist, reload, fold gives an identical table (the test the reference would fail). RC-2.3 differential bitemporal test: random event streams, `view("graph")` and `view("truth")` equal a naive rectangle-list reference model on 10 000 random as-of queries; optional second oracle with XTDB in the evaluation tier (NOT VERIFIED that it runs on the development machine). RC-2.4 the three TOKI anomaly tests and the five postulates. RC-2.5 Graphiti's equal-date case: two sources with equal `validFrom` and different values give `unresolved`, never two current values. RC-2.6 `foldUntil(knownAt)` equals a store that never received later events.
**8. Risks.** Single time axis in the conformance `foldUntil` (`e.at <= at`) versus our two axes: the facade maps `at` to `knownAt` only. Bracketing makes some historical ownership questions `unresolved` that a naive system would answer; that is intended but will raise the unresolved rate (measured, RC-14.x). NOT VERIFIED: that the reference runner's `audit-001` sequence semantics hold under the hash-chained envelope; that `node:sqlite` or DuckDB versus a file-backed append-only store (bake-off 5) meets query latency.
**9. Build notes.** Event log, fold and view first; facade and runner second; bracketing and bridging third. Unblocks 8, 16.

---

## Component 3. Normalisation: names, identifiers, legal forms, transliteration, homoglyphs

**3. Best references.**
- rigour (opensanctions/rigour, MIT, 69 stars, pushed 2026-10-08): `rigour/names/` (`org_types.py`, `symbol.py`, `tag.py`, `compare.py`), `rigour/text/translit.py`, `resources/names/org_types.yml` (126 KB), `symbols.yml` (90 KB), `stopwords.yml`, `compare.yml`.
- nomenklatura `matching/logic_v2/names/` (`match.py`, `analysis.py`, `util.py`), MIT.
- ISO 20275 Entity Legal Forms code list, GLEIF: version 1.6, February 2026, over 3,600 forms in 200+ jurisdictions, four-character codes (fetched 2026-10-13). The page states no licence of its own and points to the GLEIF LEI data terms: reuse of the list's text in our repository is **NOT VERIFIED**.
- Unicode UTS #39 Unicode Security Mechanisms, version 18.0.0 (2026-08-27, fetched): `skeleton(X) = skeleton(Y)` confusability and resolved-script-set mixed-script detection.
- anyascii (anyascii/anyascii, ISC, 423 stars, pushed 2026-06-06): table-driven Unicode-to-ASCII, JavaScript implementation listed.
- Watchman (moov-io/watchman, Apache-2.0, 512 stars, pushed 2026-10-13) `docs/cross-script-matching.md`: author-reported cross-script recall 0.50 for Jaro-Winkler and 0.91 with embeddings for different-writing-system pairs on OpenSanctions Pairs.

**4. What they actually do.** rigour's `org_types.yml` is a hand-curated alias database built from an OCCRP spreadsheet, ISO 20275 and Wikipedia; each entry has `display`, optional `generic` and a `compare` form, applied by an Aho-Corasick matcher with a word-boundary check (`org_types.py`, docstrings read). The `generic` field collapses forms (the first entry maps PLC to the generic `JSC`), which is right for blocking and wrong for discrimination. `symbols.yml` maps spellings and translations of descriptors to one symbol (`co` covers company, corporation, `компания`, `شركة`) and deliberately lists a Cyrillic-homoglyph "company". `logic_v2` aligns name parts by symbol first, then runs a distance on the remainder, weights extras and stopwords, and penalises `numbers_mismatch`, whose regex is `\d{1,}` (`names/util.py`, read): digit-only. "Series A" versus "Series B" is not caught by it. rigour's own transliteration admits six scripts (Latin, Cyrillic, Greek, Armenian, Georgian, Hangul) and refers broader scripts to a lossy package (`translit.py` docstring).

**5. Decision. Adapt** rigour's data model (typed name parts, org-type table, symbol table) as an **owned, versioned TypeScript lexicon** seeded from rigour's MIT data with the notice preserved, and cross-checked against ISO 20275 codes where licence permits; **own** the discriminator-class tagging, the homoglyph skeleton feature and integer-valued comparison views. **Adopt** anyascii as the tail transliterator after a size and licence check (ISC); rigorous tables for Cyrillic and Greek are owned (several romanisations per name). Rejected: Python or Rust-backed rigour at run time (judge needs only Node); the `generic` org-type form as a discriminator.

**6. Implementation design.**
```ts
type PartTag = "CORE" | "LEGAL" | "STOP" | "NUMERIC" | "ORD_LETTER" | "ROMAN" | "YEAR" | "GEO" | "INITIAL" | "HONORIFIC";
interface NamePart { text: string; cmp: string; tag: PartTag; script: ScriptId; i: number }
interface NormName {
  raw: string; display: string; cmp: string;                      // cmp: NFKC, case-folded, diacritics folded, punctuation unified
  parts: NamePart[]; legal?: { surface: string; cmp: string; elf?: string; jurisdiction?: string };
  variants: string[];                                             // transliteration variants, deduplicated, sorted
  skeleton: string;                                               // UTS #39 skeleton of the NFKC form
  flags: { mixedScript: boolean; hiddenChars: boolean; confusableWithOther?: boolean };
  discriminators: Discriminator[];                                // closed-class tokens that distinguish siblings
  normVersion: string }
type Discriminator = { kind: "digit" | "ordLetter" | "roman" | "year" | "legalForm" | "jurisdiction" | "geo"; value: string; anchor?: string }
```
1. **Pipeline (`pure`).** (a) reject invalid UTF-16 and cap length (512 code points); (b) strip default-ignorables (U+00AD, U+200B to U+200D, U+2060, U+FEFF) and bidi controls, setting `flags.hiddenChars` if any were present (a risk signal M5 may read; it adds restriction only); (c) NFKC, then full case folding with explicit special cases (ß, final sigma, dotted and dotless i) tested against the Unicode CaseFolding data fetched at build time (**NOT VERIFIED** which release is bundled with the Node version); (d) fold diacritics in the *comparison view only* (NFD, drop Mn), keep `display`; (e) unify apostrophes, hyphens, ampersand and "and", collapse whitespace; abbreviation dots removed without joining ("S.A." to "sa", "S. A." to "sa"); (f) split into parts and tag.
2. **Tagging.** `LEGAL` by longest-match against the org-type lexicon with a jurisdiction hint (from the same record's country attribute, else none); the matched entry's `compare` form is stored, `elf` set only when the lexicon links the entry to an ISO 20275 code for that jurisdiction. `STOP` from per-language stopword lists. `NUMERIC` digits and spelled numbers one to twenty in English, German, French, Spanish. `ORD_LETTER` a single Latin or Cyrillic letter, or a one-to-three letter token, that follows a designator word (`series, class, fund, tranche, phase, unit, vol, part, group, no, number, tier`) or stands alone as the final token; `ROMAN` a valid Roman numeral token at the end or after a designator; `YEAR` 1800 to 2100. This closed-class tagging is the Series A/B fix: the digit-only mismatch of `logic_v2` is extended to every class in `Discriminator.kind`.
3. **Transliteration.** For Cyrillic, Greek, Armenian, Georgian: owned rule tables emitting up to 4 variants (for example ISO 9 strict, BGN/PCGN-style, common "ш to sh/sch", "й to y/j/i"). Hangul: rule table. Other scripts: anyascii output as one variant, tagged `lossy`. Arabic and Hebrew names additionally use the symbols lexicon for given-name families (Mohamed, Muhammad, Mohammed share one symbol). Variants are capped at 12 per name; the cap is reported, never silent. Cross-script recall is the known weak point (Watchman's author-run figure of 0.50 for Jaro-Winkler on different writing systems); the optional embedding arm lives in component 12 and is an experiment.
4. **Homoglyphs.** `skeleton` uses the UTS #39 prototype mapping (the data file is fetched at build time and hash-pinned). Two names with equal skeletons and different `cmp` produce `confusableWithOther` on both and a ledger line `homoglyph_skeleton_equal` (positive for linkage, because lookalike vendor impersonation is the threat; it never promotes a pair to `same` alone, and it emits a risk signal M5 reads). Mixed-script tokens set `mixedScript`.
5. **Identifiers.** One normaliser per scheme, returning `{scheme, norm, validity: "valid" | "invalid_format" | "checksum_fail" | "unknown_scheme"}`: LEI (20 characters, uppercase, check digits per ISO 17442; validated against sample LEIs fetched from GLEIF at build time), IBAN (ISO 13616 mod 97), BIC, CIK (digits, zero-padded to ten), DUNS (nine digits), national registration numbers (jurisdiction-specific strip and format table), VAT numbers (country prefix), internal vendor id (opaque, case preserved). Standards are cited by name; the checksum rules are **NOT VERIFIED** against the standard texts and are tested against fetched real values. Leading zeros are never stripped unless the scheme table says so. An identifier with `checksum_fail` is kept as an assertion flagged `extraction_suspect` (component 7) and cannot trigger the identifier tier.
6. **Addresses and other attributes.** Address: country-aware token normalisation plus a fingerprint (sorted core tokens, house number, postcode) for blocking and exact comparison; no geocoding (not covered). Dates: ISO 8601 with a stated granularity; ambiguous formats (01/02/03) are not guessed: the extractor must supply a locale or the assertion is rejected. Money: integer minor units with currency code. Country: ISO 3166 alpha-2 from a pinned table.
7. **Configuration.** `lexiconVersion`, `normVersion` and the stopword/symbol tables are in the rules bundle; the bundle hash is in every `LinkEdge.policyVersion`.

**7. Tests and acceptance.** RC-3.1 `normalizeName("José  García") == normalizeName("Jose Garcia")` (World Model sid-001) and org-type cases (sid-002). RC-3.2 property: idempotence (`norm(norm(x)) == norm(x)`) on a fuzzed corpus including combining marks, ZWJ, RTL marks. RC-3.3 discriminator unit table: Series A/B, Fund 1/2, Holdings I/II, "Class A Shares" versus "Class B Shares", "Acme Ltd" versus "Acme LLC" in one jurisdiction, 2019 versus 2020 vehicles, each yields a `Discriminator` mismatch. RC-3.4 homoglyph cases from the rigour symbols file (the documented Cyrillic "company") and UTS #39 vectors. RC-3.5 transliteration: a curated list of 300 name pairs across Cyrillic, Greek, Arabic, Han (a native-reader reviewed set; NOT VERIFIED that reviewers are available). Metric: variant recall (share of curated true variants produced) with Wilson interval; target set by the baseline comparison against rigour/anyascii alone, not asserted.
**8. Risks.** Lexicon licence for ISO 20275-derived rows (NOT VERIFIED); Unicode version drift changes case folding for exotic characters; spelled-number tables cover four languages only; honorific and patronymic handling for persons is minimal (persons are a secondary entity type here); anyascii quality on Han and Arabic is lossy by design.
**9. Build notes.** Normalisers and the discriminator tagger before any scoring; lexicon seeding script with provenance record. Unblocks 4, 5, 12.

---

## Component 4. Blocking and candidate generation

**3. Best references.**
- Papadakis, Skoutas, Thanos, Palpanas, "A Survey of Blocking and Filtering Techniques for Entity Resolution", arXiv 1905.06167 (fetched 2026-10-13; abstract level: blocking, filtering and hybrid families).
- nomenklatura `blocker/index.py` and `blocker/tokenizer.py` (MIT, read): token inverted index in DuckDB with per-field boosts (`np` name parts 5.0, name 15.0, identifier 10.0, phone and email 10.0, address 1.0, word 0.5), `max_candidates=75`, `max_bucket_size=60`, `min_score_ratio=0.1`; `tokenize_entity` skips `STOP` and `LEGAL` parts and parts shorter than 3 or longer than 30 characters.
- Splink blocking guide (`docs/topic_guides/blocking/blocking_rules.md`, MIT, 2476 stars): blocking rules are equi-join conditions; "a longer list of strict blocking rules is better than a short list of loose ones".
- SymSpell (wolfgarbe/SymSpell, MIT, 3477 stars, pushed 2026-07-04): symmetric-delete candidate generation, deletes only.
- yente (opensanctions/yente, MIT): two phases, index candidate retrieval then `algorithm.compare` scoring (`yente/scoring.py`, read at top level).
- Zingg (AGPL-3.0) and dedupe: learned blocking, not adopted (`prior-art/07` section 1.2).

**4. What they actually do.** nomenklatura ranks candidates by weighted token overlap and truncates by bucket size and by a score-ratio floor; truncated buckets are silent in the code I read (log lines only). Splink unions the pairs of several strict rules. SymSpell turns insert, replace and transpose edits into deletes on the dictionary side, which is the property needed to retrieve a one-letter misspelling by a hash lookup.

**5. Decision. Adapt** the weighted token index and Splink's union of strict rules; **adopt the SymSpell idea** (re-implement; MIT) for list-scope fuzzy retrieval; **own** truncation accounting (every cap writes a `blocking_truncated` gap with the bucket key and size). Rejected: learned blocking (needs labels, Python/Spark), embedding blocking in the judge path (no runtime installs).

**6. Implementation design.** Two scopes share one key generator.
```ts
interface BlockKey { field: "id" | "np" | "phon" | "skel" | "addr" | "acct" | "dom" | "sym"; token: string }
function keys(m: MentionView): BlockKey[]   // pure; identifiers: "id:<scheme>:<norm>"; np: CORE parts of length 3..30, plus transliteration variants;
                                            // phon: Double-Metaphone-style key of the first and the longest CORE part of the primary variant; skel: UTS39 skeleton;
                                            // addr: fingerprint; acct: normalised IBAN/account; dom: registrable domain of the website attribute; sym: org-symbol ids except legal forms
```
1. **Case scope (hundreds to thousands of mentions).** Build postings `key -> mention[]`. A bucket larger than `maxBucket` (default 60) is not enumerated: it is **replaced by sampling nothing** and a `blocking_truncated` gap is written, except for identifier keys, which are never truncated. For each mention the candidate list is ordered by `sum(boost[field] * idf(token))` with `idf` computed from the scope's own postings in integer arithmetic (floor of `1000 * ln-free ratio` using a precomputed integer table of `ceil(log2)` steps), capped at `maxCandidates` (default 75), with the floor `minScoreRatio = 0.1`. Every dropped candidate above the floor raises `blocking_truncated`.
2. **List scope (OFAC, GLEIF, EU/UN/UK lists, vendor-master portfolio).** A build-time artifact (F-DOWNLOAD in the spec): postings for tokens, character trigrams of tokens of length 4 or more, and SymSpell single-deletion neighbourhoods (max edit 1 for tokens of length 4 to 6, 2 for longer) of every CORE part; entries are normalised with the same pipeline as queries (component 3), including variants. The artifact is hashed, versioned with the list's publish date, and size-capped; build and query use the same code. Query: union of exact-token postings, deletion-neighbourhood hits and trigram hits with at least `minShared` shared trigrams; rank by weighted overlap; keep the top `K` (default 200) and all candidates sharing a rare token (document frequency under 20).
3. **Cross-script.** Each name's `variants` are indexed under the same entry, so a Latin query reaches a Cyrillic list entry through its transliterations. Recall is measured, not assumed (RC-4.2).
4. **Pair completeness is the contract.** Blocking is correct iff every pair the scorer would call `same` or `possible` at the product thresholds is generated. The planted gold supplies the denominator.
5. **Concurrency and failure.** Index builds are pure functions of (entries, versions); a missing or hash-mismatched artifact is `fatal` for the sanctions matcher (no silent skip) and surfaces as fetch state `unavailable` on the screening cell.
6. **Determinism.** Postings sorted by id; ties in ranking broken by id; no randomness.

**7. Tests and acceptance.** RC-4.1 pair completeness (blocking recall) and reduction ratio on the planted case-scope gold, per perturbation family, with Wilson intervals; the target is pair completeness at least 0.99 for every family at default caps, or the report states the family that fails. RC-4.2 list-scope pair completeness for one-letter deletions, replacements, transpositions and cross-script variants against a 200 000-entry synthetic list plus the hash-pinned public sample; compare with a brute-force scorer over the same list. RC-4.3 truncation accounting: a bucket forced over the cap always yields a gap and a rerun without the cap shows what was lost. RC-4.4 index build twice gives identical bytes. Baselines: nomenklatura `Index` configuration (evaluation tier), Splink with strict rule unions.
**8. Risks.** Deletion-neighbourhood indexes grow with token count (memory budget NOT VERIFIED for a 30 MB list); trigram floors trade recall for speed; double-metaphone is English-biased (use only as one key among several); idf in integers is coarse.
**9. Build notes.** Case scope first (needed by every test), list scope when component 12 starts.

---

## Component 5. Link scoring: weight ledger, discriminators, time-decayed levels, three regions

**3. Best references.**
- Fellegi-Sunter three-region decision as confirmed in Binette and Steorts, "(Almost) All of Entity Resolution", arXiv 2008.04443 (PDF text read in `prior-art/07` section 1.4): link, possible link, non-link; comparison independence "usually not satisfied".
- Splink (MIT): additive match weights as log Bayes factors, term-frequency adjustments, the independence caveat on its theory page (`docs/topic_guides/theory/fellegi_sunter.html`, quoted in `07`).
- nomenklatura `logic_v2/model.py` (read): identifier features near 0.95, a separate qualifier class that only raises or lowers (country mismatch -0.2, birth-year disjoint -0.15, address match +0.2), "mismatching numbers" penalty 0.3.
- Li, Dong, Maurino, Srivastava, "Linking Temporal Records", VLDB 2011 (PDF text, `07` section 1.5): disagreement and agreement decay.
- Graphiti `dedup_helpers.py` (local clone): 3-gram MinHash/LSH with Jaccard threshold 0.9 and a Shannon-entropy name gate (`_NAME_ENTROPY_THRESHOLD = 1.5`, `_MIN_NAME_LENGTH = 6`); `prior-art/01` computed Jaccard 0.92 for "Series A" versus "Series B" names.
- OpenSanctions Pairs (Smith, Sesodia, Lindenberg, Schroeder de Witt, arXiv 2603.11051, fetched; 755 540 labelled pairs, 293 source datasets, 45 jurisdictions; rule baseline F1 91.3%, GPT-4o 99.0%, "rules over-match, LLMs struggle with cross-script transliteration"; dataset card CC-BY-NC-4.0, the arXiv page's icon says CC BY 4.0, a discrepancy to log).

**4. What they actually do.** Splink and Fellegi-Sunter sum per-comparison log-odds under an independence assumption; nomenklatura combines a heuristic with identifier weights and qualifier-only features; Graphiti's fuzzy tier merges at Jaccard 0.9 with an entropy gate but with no discriminator guard (my arithmetic, `prior-art/01`). No reference separates *primary* from *qualifier* evidence by an explicit eligibility rule for crossing the link threshold, and none treats a letter-only or Roman-numeral difference as a hard discriminator.

**5. Decision. Adapt** the additive ledger and the qualifier class; **own** (a) integer centi-bit weights so the ledger is hashable and replayable, (b) the hard-discriminator guard, (c) grouped caps for correlated comparisons, (d) a primary-evidence gate for `same`, (e) piecewise-constant decay levels. Rejected: learned weights in the path (weights are a versioned constants table, calibrated offline); probabilistic soft logic and subjective-logic fusion (`07` sections 5.1 and 5.4); LSH-Jaccard as a merge criterion.

**6. Implementation design.**
1. **Comparisons** (`pure` given two `MentionView`s; all outputs `LedgerLine`). Per entity type a pack-supplied comparison table, for example for `org`:
   - `identifier.<scheme>`: levels `equal`, `absent`, `different`; `equal` of a unique scheme: `+9000 cb`; `different` of a unique scheme: hard cannot-link (component 6).
   - `name`: levels from the token-aligned distance (below) as integer permille bins: `exact_cmp`, `exact_with_variants`, `>=950`, `>=900`, `>=850`, `>=800`, `<800`, with weights from the constants table; plus `skeleton_equal_raw_differs`.
   - `legal_form`: `same_elf`, `same_cmp`, `compatible` (different surface, same `generic`), `different_same_jurisdiction` (hard discriminator), `unknown`.
   - qualifiers: `country`, `address_fingerprint`, `domain`, `date_of_incorporation`, `phone`, `industry_code` (each `qualifier: true`).
   - `discriminator.<kind>`: `equal`, `absent_one_side`, `mismatch` (hard).
   - `decay.<attr>`: levels by time gap (item 4).
2. **Name distance (Stage A, floats allowed internally, output rounded to integer permille, type `Milli`, before it enters a ledger; no float is hashed, recorded or cassetted, INT-010).** Token-aligned: match symbols first (org symbols, given-name families), then align the remaining CORE parts by an optimal assignment (Hungarian for up to 8 parts, otherwise greedy by descending similarity, flagged), per-part similarity = max over variants of a Jaro-Winkler/Damerau-Levenshtein blend, unmatched parts penalised by a weight depending on tag and frequency (`extra_query`, `extra_result`, stopword factor 0.7, as in `logic_v2`, re-derived not copied). Order-insensitive for persons ("Family, Given" aligned), order-sensitive for organisations. Short-name rule: a core of fewer than 2 informative parts or with entropy below the pack threshold can never reach `same` on name alone (the informativeness gate, component 6).
3. **Hard discriminators (the Series A/B guard).** `hardDiscriminators` is non-empty when, after alignment, the unmatched or substituted CORE tokens of both names are *all* of a closed class in `Discriminator.kind` and differ (letter-for-letter, numeral-for-numeral, Roman-for-Roman, year-for-year), or when legal forms differ within one jurisdiction with both resolved to distinct ELF codes, or when jurisdiction suffixes differ. A non-empty set forbids the `fuzzy` tier from producing `same`. A hard mismatch together with a name score of at least `siblingCb` produces a `different` edge with `tier: "fuzzy"` and `hardDiscriminators` recorded (sibling entities are exactly where a re-offered pair wastes review and a wrong merge is worst). Identifier-tier `same` is unaffected, and conflicts with a hard discriminator are surfaced as `identity_conflict` (component 6).
4. **Time-decayed levels.** For attributes with history (`address`, `director`, `name`, `status`), the comparison takes `dtDays = |observedAt_a - observedAt_b|` and the attribute's `DecayCurve` (piecewise-constant integer table):
```ts
interface DecayCurve { attr: string; entityType: EntityType; bins: { maxDays: number; agreeCb: number; disagreeCb: number }[]; stable: boolean; version: string }
```
   A disagreement on a `stable` attribute (jurisdiction of incorporation, incorporation date, LEI) is strongly negative at any `dtDays`; a disagreement on a volatile attribute (registered address) after a long gap is nearly neutral; agreement on a volatile attribute after a long gap is more informative than the same agreement on the same day. **The table is initialised from domain priors, not fitted** (no real history data has been seen; fitting on our synthetic generator would only test the code, `07` section 1.5). It is versioned, cited in the ledger line, and evaluated by ablation against a no-decay baseline on planted update-versus-different-entity cases, with the circularity caveat of spec section 16.
5. **Grouping and caps.** Comparisons carry a `group`. Within a group the positive weights sum to at most `groupCapCb` (default: the largest single weight plus 30% of the rest), negatives are not capped. Groups: `{name, legal_form, skeleton}`, `{address, country}`, `{domain, email}`.
6. **Three regions.** `primaryCb` = sum over non-qualifier lines after caps; `scoreCb` = `prior + primary + qualifiers`. `same` iff `primaryCb >= primaryMinCb && scoreCb >= linkCb && hardDiscriminators is empty`; `different` iff a hard cannot-link applies or `scoreCb <= nonlinkCb`; otherwise `possible`. Qualifiers can never make `primaryCb` sufficient. `prior` is the scope's log-odds of a random candidate pair being a match, set per scope (case scope, list scope, portfolio scope).
7. **Constants.** `linkCb, nonlinkCb, primaryMinCb, siblingCb, prior, weights, caps, decay` are a versioned table `LinkConfig`, initialised conservatively, calibrated on the gold set to hit zero false merges on planted near-duplicates first and then maximise recall at a fixed review budget (the bake-off 3 decision rule). **Splink's EM and nomenklatura's regression are offline baselines**, not sources of the production constants.
8. **Output.** One `LinkEdge` per scored pair that is `same`, `different` or `possible`; pairs below `nonlinkCb` and not blocked-in produce no edge but increment a per-scope tally recorded in the table coverage.

**7. Tests and acceptance.** RC-5.1 planted near-duplicates (Series A/B, Fund 1/2, Holdings I/II, class letters, year vehicles, same name different jurisdiction, parent/subsidiary, distinct branches): false-merge rate zero at the product thresholds on at least 300 planted pairs (with zero events the 95% upper bound is about 1.0% by the rule of three, 3/300; the report states the interval and does not claim "zero" for the population). RC-5.2 false-split: legitimate renames, trading-name versus legal-name, typos, legal-form variants, transliteration; recall at the review budget with intervals, split by facet (entity type, country, source pair, script). RC-5.3 baselines on the same pairs: Splink (EM-fitted), nomenklatura `logic_v2` and `RegressionV1`, yente, dedupe, a prompted LLM, plus (local, non-redistributable) the OpenSanctions Pairs organisation subset as an external anchor. RC-5.4 ledger recomputation: the recompute check recomputes every edge's `scoreCb` from the stored lines (exact). RC-5.5 integer determinism: scores equal across Node versions on a fixed corpus. RC-5.6 ablations: discriminator guard off, decay off, grouping caps off, each shows an output change on a named planted case. What disproves the design: any planted sibling pair merged, or the guard raising false splits above the baseline with an interval excluding zero.
**8. Risks.** Initial constants are hypotheses; independence is violated even after grouping; the planted set encodes our own idea of siblings (circularity; mitigated by the OpenSanctions Pairs anchor and published ER benchmarks, availability NOT VERIFIED); OpenSanctions Pairs is non-commercial and stays local; Jaro-Winkler needs `Math.sqrt`-free implementation (it does not use it) and rounding discipline; the Hungarian cap of 8 parts may degrade very long names.
**9. Build notes.** Comparisons and ledger types, then the guard, then thresholds on the gold set. Unblocks 6, 12, 13.

---

## Component 6. Resolution cascade, model matching in the possible band, cannot-link, clustering and transitivity audit

**3. Best references.**
- Graphiti cascade (`dedup_helpers.py`: `_resolve_with_identity_properties`, `_resolve_with_similarity`, then LLM in `node_operations.py`; failures treated as "no duplicate"), local clone.
- nomenklatura `resolver.py` (`get_judgement`, `_decide`, `explode`, `prune`) and `judgement.py` (`POSITIVE + NEGATIVE = NEGATIVE`, otherwise `UNSURE`), read; `matching/conflicting_match` pattern in `07` section 1.3.
- HippoRAG (local clone `HippoRAG.py`): synonym edges at cosine 0.8 never merge ("possible-same never merges").
- ComEM, "Match, Compare, or Select?", arXiv 2405.16884 (abstract level): the Select strategy; Peeters, Steiner, Bizer arXiv 2310.11244; Teofili et al. arXiv 2606.01210 (LLM self-explanations "often unstable, weakly faithful"); Fu et al. arXiv 2506.02509. Abstract level only (`07` section 1.6).
- Binette and Steorts on clustering to enforce transitivity (arXiv 2008.04443).

**4. What they actually do.** Graphiti tries identity properties, normalised exact name (a single hit resolves, several escalate), entropy-gated MinHash/LSH at 0.9, then an LLM whose malformed answers are logged and treated as no duplicate (`node_operations.py:649,804` per `prior-art/01`); a single exact-name candidate merges with no type or attribute guard unless identity properties are configured. nomenklatura makes judgements durable edges with blocking semantics, but `_decide` does not enforce them (component 1). ComEM reports that choosing among candidates ("select") captures global consistency better than pairwise match.

**5. Decision. Adapt** both cascades; **own** the invariants: (a) cannot-link is enforced inside `cluster()`, (b) exact normalised names alone never merge when the name is uninformative, (c) the model may only nominate among shown candidates; the recorded edge comes from a per-pair confirmation, and it promotes to `same` only with an independent qualifier, (d) a failed or abstaining match leaves the pair `possible` (never `different`, so it can neither merge nor clear), and a model judgement never clears a screening candidate and never alone satisfies a required positive-evidence entry (INT-035). Rejected: LLM dedupe prompt as a general tier (Graphiti), write-time merge (Cognee), human `decide(POSITIVE)` without the blocker check.

**6. Implementation design.**
1. **Cascade for a candidate pair (Stage A).**
   - **T0 identifier.** Same scheme, both `valid`, equal `norm`, scheme declared `unique-per-entity`: `same`, `tier: "identifier"`, weight 9000 cb. Same scheme, both valid, different, scheme declared unique: `different`, `tier: "unique_id_conflict"`, unless a declared successor relation links the two identifiers (then `possible` with a ledger line). Invalid identifiers never fire T0.
   - **T1 exact.** Equal `cmp` core and equal legal form compare and equal jurisdiction (or both absent): `same` only if the name is *informative* (at least two CORE parts, or one CORE part whose scope idf marks it rare) **and** no hard discriminator **and** at least one qualifier agrees. Otherwise `possible` (a short generic name such as "Global Trading Ltd" never auto-merges on name alone).
   - **T2 gated fuzzy.** Component 5's ledger decides; the guard applies.
   - **T3 model, possible band only.** See item 3.
   - **Human** judgements (M10 reviewer UI, M13) arrive as `tier: "human"`; they are recorded edges like any other. A human `same` that violates a `different` edge is refused by `cluster()` and surfaced; the reviewer must first retract the blocking edge, creating a visible event.
2. **Clustering (`pure`, Stage B, part of `fuse`).**
```ts
function cluster(mentions: Mention[], edges: LinkEdge[], drop: ReadonlySet<Id<"le">> = new Set()): { entities: Cluster[]; audit: IdentityConflict[] } {
  const live = edges.filter(e => !drop.has(e.id) && !superseded(e, edges));
  const blockers = pairSet(live.filter(e => e.verdict === "different"));      // cannot-link, by mention pair
  const uf = new UnionFind(sortedIds(mentions));                              // members tracked per root
  const order = live.filter(e => e.verdict === "same").sort(byTierRankThenScoreDescThenId);  // identifier < human < exact < fuzzy < model
  for (const e of order) {
    const [ra, rb] = [uf.find(e.a), uf.find(e.b)];
    if (ra === rb) continue;
    const bad = firstBlockerBetween(uf.members(ra), uf.members(rb), blockers);   // cross-product check, sets are small
    if (bad) { audit.push({ kind: "refused_merge", edge: e.id, blockedBy: bad }); continue; }
    uf.union(ra, rb);
  }
  // transitivity audit: any 'same' edge (including refused) whose endpoints ended in different clusters, or any cluster containing a 'different' pair, is an IdentityConflict
  return { entities: uf.clusters(), audit: audit.concat(auditTransitivity(uf, live)) };
}
```
   Order independence: the processing order is a function of the edge *set* (tier rank, score, id), not of arrival order, so the same set gives the same clusters (RC-6.1). Which edge is refused when a violation is unavoidable is therefore deterministic and reported. A mention that two clusters both claim (`a~c` and `b~c` with `a != b`) is a **bridge mention**: the weaker edge is refused and becomes a reversible edge for component 13.
3. **Model matcher (Stage A, role "entity matcher", LLM-bearing, possible band only), two stages and a direction.** Every candidate set carries `direction: "screening" | "corroboration"` (list-scope screens of component 12 are `screening`; registry or ERP identity support is `corroboration`); the direction is recorded on `LinkEdge.model` and applied by M14's `applyMatcher(direction, verdict)`.
   - **Stage 1, nominate.** Input: a subject mention and a candidate list of at most `K = 5` mentions (ordered by score, then by id), each rendered from typed normalised attributes as *delimited data*; no free text from the vendor beyond names and addresses, which are `UNTRUSTED` and treated as data. Output schema (JSON Schema): `{ "choice": "<one of the shown mention ids>" | "none" | "abstain" }`, nothing else; the validator rejects any id not shown, rejects extra fields, and never repairs. Temperature 0; the call runs twice with the candidate order reversed and agreement is required (disagreement is `abstain`, a position-bias control that is our design, not a cited result). The nomination records nothing in the truth path: the select call read all shown candidates, so an edge built from it would break edge locality (INT-036).
   - **Stage 2, confirm per pair.** For a nominated `(subject, chosen)` only, a pairwise call shows just those two mentions' typed attributes, in both orders, with output `same | not_same | abstain`; agreement across orders is required. The recorded edge's `inputs` are exactly the assertions of those two mentions, so locality is testable by re-judging with every non-cited assertion removed (RC-6.7). If the call budget forbids Stage 2, the fallback is a `possible` edge whose `inputs` are the union of all shown candidates' assertions and `locality: "set"`; M4's certificate then says `locality: "set"` and flips may be over-reported.
   - Budgeted through `ctx.model`; cassetted. Any failure, timeout or schema violation in either stage yields no edge (stays `possible`). A confirmed pair becomes a `LinkEdge{tier:"model"}`: verdict `same` **only if** at least one qualifier line in the pair's ledger is positive and no hard discriminator exists (the qualifier is independent evidence; the model's reason, if any, is stored as `model.note`, a label); otherwise the verdict stays `possible`. In the `screening` direction a model `same` only confirms a hit (restrictive); `none`, `not_same`, `abstain` and every failure leave the hit `possible`, never dismissed. In the `corroboration` direction a `tier: "model"` edge is flagged in provenance so any cell whose support passes through it reports `viaModelEdge`, and a model-only link never alone satisfies a required positive-evidence entry (M5 reads the flag). `none` never produces `different` (a model cannot create a cannot-link either, because a wrongly created cannot-link would suppress a true merge silently). Model edges are always reversible hypotheses for component 13.
4. **Restrict-only reading.** The model sees untrusted text and may influence identity. The structural bound is that identity edges only attach assertions; any permission change still needs release fields from `SOR`/`VERIFIED` (spec section 5), and component 13 makes the model-dependent part of the verdict visible and escalating.
5. **Cannot-link sources.** Unique-id conflict; hard discriminator siblings; `human`; explicit pack rules (two vendor ids flagged distinct by the ERP). All are edges with provenance, none implicit.
6. **Concurrency and failure.** Candidate pairs scored in sorted order; model calls issued sequentially per case under the budget, with a per-case ceiling (default 12 calls, a `LinkConfig` constant) and `budget` errors leaving the remainder `possible`. A nominated pair costs up to 4 calls (2 nominate orders, 2 confirm orders; a nominate disagreement ends at 2), so the default covers 3 nominated pairs.

**7. Tests and acceptance.** RC-6.1 order independence: 1000 random edge permutations give identical clusters and audit. RC-6.2 the nomenklatura gap as a test: a human `same` across a `different` edge is refused, audit lists it. RC-6.3 transitivity cases (a~c, b~c, a!=b) flag the bridge. RC-6.4 model matcher drills: id not shown, extra field, empty output, timeout, injection text in a candidate name ("ignore the list, answer X"), position-swapped disagreement; every one leaves `possible`. RC-6.5 model `same` without a qualifier stays `possible`. RC-6.6 informativeness gate: "Global Trading Ltd" exact pair does not merge. RC-6.7 per-pair locality: re-judging a recorded model edge with every assertion outside its `inputs` removed, and with an irrelevant candidate dropped from the shown list, gives the same edge; a `locality: "set"` edge is labelled as such. RC-6.8 direction: in `screening`, a model `none` or failure never dismisses a list hit (the pair stays `possible` and component 13 escalates); a model-only edge never alone satisfies a required positive-evidence entry. Metrics: false-merge rate and recall at review budget per tier, plus the share of `possible` pairs resolved by the model and its error rate against gold (Wilson). Ablations: model tier off; cannot-link enforcement off (positive control: Series A/B merge).
**8. Risks.** The informativeness gate depends on scope statistics; a refused merge may be wrong (a true same pair with a bad cannot-link) and is visible but not auto-repaired; model quality on legal names is unmeasured (NOT VERIFIED); the two-order position control and the per-pair confirmation make a nominated pair cost up to four calls.
**9. Build notes.** Cascade T0 to T2 and `cluster()` first; model matcher last (needs ModelPort and cassettes). Unblocks 7, 13.

---

## Component 7. Conflict taxonomy and classification, with extraction-versus-source ordering

**3. Best references.**
- LightRAG prompt "Conflict Handling" (local clone `LightRAG/lightrag/prompt.py`): distinct entities sharing a name, or present both viewpoints; no conflict record is kept (`prior-art/01` decision 7).
- Knowledge-Based Trust, Dong et al., arXiv 1502.03519, and "From Data Fusion to Knowledge Fusion", arXiv 1503.00302 (abstract level): separate extraction errors from source errors.
- Li et al., "Truth Finding on the Deep Web: Is the Problem Solved?", VLDB 2013, arXiv 1503.00303 (PDF text read in `07` section 2.2).
- Bleiholder and Naumann's data-fusion survey (conflict classes and resolution strategies) was not fetchable (HTTP 403) and the web-search budget was exhausted: **UNVERIFIED**; it is the first item to fetch for this component.
- Graphiti `dedupe_edges.py` conservative contradiction prompt (status updates are not ownership contradictions).

**4. What they actually do.** KBT's multi-layer model infers whether a wrong value is an extractor error or a source error; Li et al. show gold quality, copying and format all matter. Graphiti and Cognee detect contradictions with an LLM and record none as a first-class object (Cognee's `contradicts` edge points at entities with fact strings, not at the two evidence ids).

**5. Decision. Own** the taxonomy as code with a fixed detection order and a `Conflict` record that joins to assertion ids; reuse the KBT idea (extraction layer first) with deterministic evidence (double extraction and the L0 quote check), not a probabilistic model.

**6. Implementation design.**
```ts
type ConflictType = "extraction_error" | "identity_conflict" | "same_name_different_entity" | "update_over_time" | "source_disagreement" | "cardinality_violation";
interface Conflict { id: Id<"cf">; type: ConflictType; subtype?: "tier_resolved" | "equal_authority" | "stale_authority" | "no_eligible_value" | "bracketed_change" | "bridge_mention" | "refused_merge";
  cell?: CellKey; members: Id<"as">[]; edges?: Id<"le">[]; ruleId: string; outcome: "resolved" | "unresolved" | "suspect"; prov: ProvRef }
```
Classification, in this order, per candidate disagreement (a pair or group of active groups in one cell that are not `eqv`-equal):
1. **Extraction check.** If any member has `diag.doubleExtracted == "disagree"`, or `diag.quoteCheck == "absent"`, or its identifier normaliser returned `checksum_fail`, or two members share an `evidenceId` and a `locator` but differ in `extractor`, the disagreement is `extraction_error`. The suspect member is the one failing the check; with a pure extractor disagreement and no tie-break, both members are `suspect`. A member with `doubleExtracted` of `model_only` or `parser_only` (one extractor produced the value, the other did not) is suspect only when it conflicts with another active group; on its own it is unaffected, and `single` is likewise no evidence of disagreement (INT-022). Suspect groups are excluded from the undefeated set (component 9) and listed, so they cannot create or hide an `unresolved` by source authority; a hold-relevant attribute whose only support is suspect is `unresolved` with subtype `no_eligible_value` (required positive evidence, spec section 5). A parse error is therefore never reported as a source conflict.
2. **Identity check.** If the members belong to mentions joined by a `possible` edge, a refused merge, or a bridge mention, the type is `identity_conflict` (carrying the edge ids), and the member assertions are *not* compared in one cell at all (they live in different clusters); the conflict is raised on both entities' cells as `identity_ambiguous`. `same_name_different_entity` is the resolved form: a `different` edge exists and the names match.
3. **Temporal check.** If the active intervals do not intersect at `validAt` but are ordered, or the members are successive observations from one origin and one mention, the type is `update_over_time` (the earlier closes at the later's start).
4. **Otherwise `source_disagreement`**, subtyped by what component 8 does with it: `tier_resolved`, `equal_authority`, `stale_authority`, `no_eligible_value`, `bracketed_change`.
5. **Cardinality.** More distinct value classes active than the attribute allows, with no dominance, is `cardinality_violation` (an unresolved over-full cell).
Every conflict carries its `ruleId` (for example `fuse.rank.tier`, `fuse.freshness.guard`) so Why records are `kind: "rule"` and never model-reported.

**7. Tests and acceptance.** RC-7.1 per-type precision and recall on the planted gold with labels separating evidence-silent, evidence-contradicts, different-entity, stale-update and extraction-error (spec section 16); intervals by cluster bootstrap over cases. RC-7.2 ordering test: a planted OCR error that also differs from a registry value is classed `extraction_error` in at least the share of cases a second extractor or the quote check can resolve (target set by the baseline of classing everything `source_disagreement`). RC-7.3 Graphiti's missing-date case: a conflict with unknown dates is `unresolved`, not two current facts. RC-7.4 conflict ids are stable under shuffling. Disproved if: extraction errors leak into `source_disagreement` at a rate no lower than the do-nothing baseline.
**8. Risks.** The double-extraction diagnostics come from M2 and are not yet specified; the identity check depends on component 6 keeping all `possible` edges; only organisation-centric conflict classes are designed (persons and addresses need their own `eqv`).
**9. Build notes.** After 6 and 8. Unblocks 9 (the oracle's conflict relation) and the M4 gap ledger.

---

## Component 8. Fusion rules: eligibility, authority, authorship, cardinality, freshness, recency, bracketing

**3. Best references.**
- Cognee `temporal_conflict_resolver.py` (local clone, read): declared `functional_relationships`, winner by `(updated_at, position)` where `updated_at` is ingestion time and is refreshed on re-assertion (`_recency_key` docstring: "refreshed each time the fact is re-asserted").
- Graphiti `resolve_edge_contradictions` (read): event-date comparison with strict `<`.
- Meterless World Model `assertFact` (read): `most-recent-wins | highest-confidence-wins | source-priority | manual`, one global setting, greedy loop.
- BODS 0.4 `source.type` vocabulary: `selfDeclaration | officialRegister | thirdParty | primaryResearch | verified` (`prior-art/07` section 3.3; schema licence NOASSERTION, concepts only).
- Li et al. 2013 (authority tiers over learned weights); Dong, Berti-Equille, Srivastava, VLDB 2009 (source dependence).
- `prior-art/15` section 4: authoritative source per attribute, with registries mostly self-declared.

**4. What they actually do.** Cognee's recency key is ingestion time, so re-reading an old document makes its claim the newest. Graphiti's winner is the later event date; Meterless offers four global policies. None weighs authority and authorship per attribute, none treats missing or equal dates as unresolved, none declares cardinality beyond a flat list.

**5. Decision. Own** a per-attribute `AttributeSpec` and a fixed precedence of rules evaluated as a rank vector, adapting Cognee's *declared cardinality*, Graphiti's *event-time recency* and BODS's *source-type vocabulary*. Learned reliability weights stay offline (`07` section 10).

**6. Implementation design.**
```ts
interface AttributeSpec {
  name: string; valueType: "string" | "id" | "date" | "enum" | "money" | "bool" | "ref"; eqv: EqvId;     // equivalence on norm values, e.g. nameEq, addrFingerprintEq, exactEq, moneyEq
  temporalKind: "event" | "state" | "period"; granularity: "day" | "month" | "year";
  cardinality: { max: number | "many"; exclusive?: ExclusionGroup };                    // 1 for legal_name at a point in time; "many" for aliases
  tierRank: Record<AuthorityTier, number>;                                              // per attribute; a self_declared source never outranks a register on a legal fact
  authorshipRank: Record<Authorship, number>;                                           // authority > third_party > counterparty
  assignableTrust: TrustLevel[];                                                        // trust levels eligible to be the resolved value; release fields: ["SOR","VERIFIED"]
  freshnessTtlDays: Partial<Record<AuthorityTier, number>>;                             // beyond this a tier is stale for this attribute
  recencyDecides: boolean; releaseField: boolean; requiredChannels: string[];           // channels whose fetch state the cell coverage reports
}
```
1. **Rank vector** for an active group `x` at `asOf`: `R(x) = (eligible(x), tierRank(x), authorshipRank(x), recencyKey(x))` where `eligible = trust(x) in assignableTrust`, and `recencyKey` is the day (or month or year, per `granularity`) of `max(validFrom ?? observedAt of its last observation)` if `recencyDecides` and the date is known, else a constant. Lexicographic comparison. A date unknown on either side makes `recencyKey` equal (tie), never an assumption.
2. **Dominance.** `dominates(y, x)` iff `R(y) > R(x)` lexicographically **and not** the freshness guard: if `y` is stale (`asOf - lastSeen(y) > freshnessTtlDays[tier(y)]`) and `x` is fresher and `x` is not of a strictly lower `eligible` class, then `y` does not dominate `x` (a stale register entry does not silence a newer contradicting claim; the cell becomes `unresolved` with subtype `stale_authority`, and component 15 asks for a re-fetch of the stale authority). Ineligible groups are always dominated by an eligible conflicting group. `dominates` is irreflexive and acyclic (it is a subset of a lexicographic order), though the guard can make it non-transitive; component 9 defines results by one-step defeat for exactly that reason.
3. **`fuseCell(spec, groups, asOf) -> CellResult`** (`pure`):
   1. `A` = active groups at `asOf` (component 2), excluding groups marked `extraction_suspect` (listed as suspects).
   2. Partition `A` into `eqv` value classes. At a single instant all active intervals contain `validAt`, so any two classes conflict (cardinality 1) and the conflict graph is complete multipartite on the classes.
   3. `U` = undefeated groups (component 9). Repairs, certain and possible sets: component 9.
   4. Status: `resolved` iff one repair value set (certain equals possible); `unresolved` iff more than one; `no_eligible_value` subtype when `A` is non-empty but contains no eligible group and the attribute is a `releaseField`. Empty `A`: component 14.
   5. Value, `losers` (defeated groups with the rule id that defeated them), `suspects`, mass triple (component 11), provenance (component 10), tags.
4. **Release fields.** `account`, `amount`, `payee_id` have `assignableTrust: ["SOR","VERIFIED"]`: a registry or vendor-submitted value is never the resolved value (spec section 5), but it stays in `A` as a conflicting `loser_ineligible` and produces a `Conflict`, so M5's restrict-only rule can hold on it.
5. **Trust of a fused value (INT-013).** A fused value's trust is the meet (`combine`) over its **supporting** inputs: the winning groups, whose content determines the value (`Fact.supports`). A fused value is never trusted above any input that supports it. Defeated, ineligible and suspect groups are not supporting inputs (otherwise any attacker-supplied conflicting assertion would downgrade every `SOR` value: an availability attack) but are **recorded**, not forgotten: every group `fuseCell` considered appears in `supports` or in `Fact.defeats`, which affects only the cell status, the conflict record and gaps, all restrict-only. `defeats` is hashed into the fact id and into M8's `derivedFrom` (M8 `derive` takes an explicit `defeated` list), so a mutant that drops a defeated parent is caught by a completeness check (RC-8.7). The stored `trust` is plain data; privileged consumers re-assert it with M8 `fromStored`. `Cell.supportLabels` (trust, authorship, tier of each supporting group, sorted) gives M5 what its permission-matrix lookup needs (INT-014); no numeric level is derived in this module.
6. **Multi-valued attributes** (`cardinality.max = k > 1` or `"many"`): classes are not mutually exclusive; with `"many"` there are no conflicts and the cell value is the union of eligible classes with per-value mass; with finite `k`, more than `k` undefeated classes yields `cardinality_violation` and the repairs are the maximal `k`-subsets (component 9).
7. **Time series.** `history(cell)` evaluates `fuseCell` at every breakpoint (interval boundaries and observation dates) and merges equal consecutive results into rectangles, for the as-of slider and ownership questions.
8. **Illustrative pack table (domain-reviewer item, not a decision)** : `legal_name` (state, card 1; register 4, GLEIF 4, ERP 3, vendor document 1), `legal_status` (state; register above GLEIF; TTL 90 days for the register), `lei` (event; GLEIF top; unique), `registered_address` (state; register top; TTL 365; recencyDecides within equal tier), `bank_account` (state; release field; SOR and attested only), `sanctions_status` (state; official list top; TTL tied to list version and policy, component 12), `beneficial_owner` (period; register top, `selfDeclared` below; many), `incorporation_date` (event; register top; stable).

**7. Tests and acceptance.** RC-8.1 a table-driven suite of 80 cells: tier wins, equal tier ties to `unresolved`, authorship breaks equal tiers, recency decides only where declared and dates known, stale authority guard, ineligible loser, missing dates, equal dates. RC-8.2 property: `fuseCell` is invariant to input order and to duplicating a group (repeated observation). RC-8.3 monotonicity checks stated honestly: adding an assertion can change `resolved` to `unresolved` and back, so the property tested is order independence, not monotone growth. RC-8.4 conflicting rules ablation: recency-only baseline (Graphiti-like), tier-only baseline, majority vote, truth discovery (offline report J of `07`), and an LLM fusion arm (`07` section 2.5) on the same gold, with the circularity caveat and the external-anchor plan of spec section 16 (the report states where tiers lose). RC-8.5 release-field attack: a vendor-submitted account assertion with a newer date never becomes the value and always adds a conflict. RC-8.6 availability attack: an attacker-supplied conflicting assertion at `UNTRUSTED` against a `SOR` value leaves the cell `resolved` at `SOR` only when authority rank decides it; in every case it adds a conflict record (and, where policy requires, a hold) and never changes the winning value's trust. RC-8.7 completeness: every conflicting group `fuseCell` considered appears in `supports` or `defeats`; the mutant that drops a defeated parent from `defeats` fails.
**8. Risks.** The tier table is a domain judgement and is the circular part of the evaluation; recency at day granularity can tie legitimately distinct same-day updates (it ties to `unresolved`, which is the safe side); freshness TTLs are guessed. NOT VERIFIED: which real registers expose `validFrom` histories.
**9. Build notes.** After 1, 2. Unblocks 9, 10, 11, 14.

---

## Component 9. Repair semantics: the normative definition of `unresolved`, and the clingo differential oracle

**3. Best references.**
- Bienvenu and Bourgaux, "Inconsistency-Tolerant Querying of Description Logic Knowledge Bases", Reasoning Web 2016 (PDF read in `prior-art/07` section 6.1): repair as a maximal consistent subset; AR, IAR and brave semantics.
- Reiter 1987 diagnosis and Ignatiev et al. 2019 hitting-set duality (`prior-art/08` section 1.3) for the link to M4's minimal flips.
- clingo (potassco/clingo, MIT, 850 stars, pushed 2026-10-13); clingo-wasm (domoritz/clingo-wasm, Apache-2.0, 47 stars, pushed 2026-09-10; README: Clingo 5.8.1 compiled to WebAssembly, usable from Node as `clingo.run(program, models)`); Gebser et al., "Multi-shot ASP Solving with clingo", arXiv 1705.09811 (abstract level).
- PySAT (pysathq/pysat, MIT, 461 stars, pushed 2026-08-16), `examples/hitman.py`: the minimum-hitting-set reference for M4's cross-check.
- de Kleer's ATMS (nogoods as conflict sets), design precedent only.
- The prioritised and preferred-repair families of the consistent-query-answering literature were **not fetched**; the semantics below are defined from scratch and any equivalence to a published family is **NOT VERIFIED**.

**4. What they actually do.** Description-logic CQA defines repairs of a knowledge base violating constraints and answers queries under AR (true in every repair), IAR (true in the intersection of repairs) and brave (true in some repair). clingo computes answer sets of logic programs and supports optimisation and enumeration; clingo-wasm makes it callable from Node tests without a native install (not run here).

**5. Decision. Adapt** the repair vocabulary; **own** the priority-aware definition below as the single normative meaning of `unresolved` (spec section 8; adversarial review XPL-04). The Dung layer of spec section 9 becomes a derived view if it ships at all. **Adopt** clingo as a test-time oracle only (evaluation tier, bake-off 8).

**6. Implementation design.**
**Definition (normative).** Fix a cell `(entity, attribute)` and `asOf = (validAt, knownAt)`. Let `A` be the active groups (component 2) minus suspects. Let `conflict(x, y)` hold iff `x` and `y` are in different `eqv` classes and their effective intervals intersect (at one `validAt`, always for cardinality 1). Let `dominates` be component 8's relation.
- `x` is **defeated** iff some `y in A` with `conflict(x, y)` and `dominates(y, x)`. `U = A minus defeated`. (One-step defeat: a defeated defeater still defeats; if `dominates` is transitive this equals the set of maximal elements, which RC-9.2 checks.)
- A **repair** is a maximal subset `R` of `U` with no `conflict` inside `R` and, for cardinality `k`, at most `k` classes. Equal-ranked conflicting groups are therefore in different repairs.
- The cell **value set under repair `R`** is the set of `eqv` classes in `R`. `certain = intersection over repairs`, `possible = union over repairs`.
- **Status.** `resolved` iff `certain == possible` and non-empty. `unresolved` iff `possible != certain` (more than one repair value set). `excluded` values are those in `A` but in no repair. A non-empty `A` with empty `U` cannot occur (acyclic dominance leaves maximal elements). Empty `A` is a coverage question, not a repair question (component 14).
- **Soft conflicts** (equal authority, stale versus current, bracketed change) are encoded as hard conflicts derived from the attribute spec, as `07` section 6.1 recommended: cardinality one plus overlap plus no dominance. This is the only place where "soft" disagreement becomes a repair set.
**Algorithms.**
1. *Fast path (cardinality 1, one instant).* Conflict graph is complete multipartite on classes, so repairs are exactly one per class present in `U`; status is `resolved` iff `U` has one class. `O(n log n)`. This covers every cell at a single `validAt`, so the worst-case exponential enumeration that `07` feared does not arise there.
2. *General path (`k > 1`, exclusion groups such as `status in {ACTIVE, DISSOLVED}` plus `LIQUIDATION`, interval queries).* Backtracking enumeration of maximal conflict-free subsets of `U` with a node cap (default 20 000) and a repair cap (default 256). On cap, the cell is `unresolved` conservatively, `completeness: "partial"`, and a `repair_cap_exceeded` gap is written. Never silent truncation.
3. *Conflict hypergraph for M4.* The module exposes, per cell, `H = { groups: A, conflicts, dominance edges, repairsSummary }` and `statusUnder(removedAssertionIds) -> CellResult`, a pure, cell-local re-evaluation. M4's minimal flips are minimum hitting sets over these, found by its implicit-hitting-set loop; this module supplies the evaluator and the static cone (a group can influence a cell only if it is in `A`; removing a group that is neither a member of `U`'s competing classes nor a defeater of one cannot change the status).
4. *Evaluator adapter (INT-034; M4 C8 is the normative interface).* M3 supplies the reconcile half of `V = phase2 ∘ phase1` as per-cell functions that M4's `Evaluator` composes with label aggregation (M4 C9) and `featurize` (M5):
   - `keys(): Key[]`, fixed from the full snapshot: `cell:<anchorMention>/<attribute>` for each cell the policy may read (the cell of whichever entity contains that mention; entity ids are membership-derived and cannot name a key across subsets, component 1 item 4) and `edge:<EdgeId>` for each recorded link.
   - `deps(key): Set<Id<"ev">>`, a sound over-approximation: for a cell, the evidence of every group in `A`, suspects and defeated groups included, plus the evidence of `inputs` of every edge in the cone of the anchor's cluster (`cellHypergraph`); for an edge, the evidence of its `inputs`.
   - `phase1Cell(key, present, edits)`: drop edges whose `inputs` are not all in `present`, re-cluster, `fuseCell`; a pure function of its arguments, total for every `present` including the empty set (an empty `A` gives the coverage-determined status of component 14, never an error). `edits` are `remove` (via `present`), `correct(assertionId, v')` and `supply(HypotheticalAssertion)`, applied to assertions before grouping.
   - `trace`: one `DerivationNode` per cell resolution (`owner: "M3"`, `fn: "fuse.cell"`, reads = winning and defeated assertion ids, `value` = status, certain set, rule id) and per edge dropped, with `nd_` ids computed from fn, version, reads and the JCS value (M4 C8 obligation 7).
   - `rulesHash` and the Stage B version enter `vSpecHash`; Stage A never does.
**clingo differential oracle (evaluation tier).** Encode the same cell as facts and a fixed program, run in clingo-wasm or a pinned clingo container, compare repair sets and statuses with the TypeScript result on every gold cell and on random cells.
```
% facts, generated per cell:  grp(G).  cls(G,C).  rank(G,R).  eligible(G).  overlap(G1,G2).   dom(Y,X) from the TS rank vectors (the dominance relation is data)
conflict(X,Y) :- grp(X), grp(Y), X < Y, cls(X,C1), cls(Y,C2), C1 != C2, overlap(X,Y).
conflict(Y,X) :- conflict(X,Y).
defeated(X)   :- conflict(X,Y), dom(Y,X).
u(X)          :- grp(X), not defeated(X).
{ in(X) : u(X) }.
:- in(X), in(Y), conflict(X,Y).                          % conflict-free
:- u(X), not in(X), not blocked(X).                      % maximality
blocked(X)    :- u(X), in(Y), conflict(X,Y).
val(C)        :- in(X), cls(X,C).
#show val/1.
```
This program is a contract sketch; its syntax and the maximality encoding are **NOT VERIFIED by execution** (not run in this design session). Expected check: the set of `val` sets over all answer sets equals the TypeScript repair value sets. `dom/2` is derived by the TypeScript rank vectors, so the oracle checks the repair logic, not the rank table (stated plainly: shared `dom` means shared rank bugs).

**7. Tests and acceptance.** RC-9.1 TS versus clingo agreement on all gold cells and 100 000 random cells (any difference is either fixed or explained and listed). RC-9.2 when `dominates` is transitive, `U` equals the maximal elements (property test). RC-9.3 the fast path equals the general path on random cardinality-1 cells. RC-9.4 caps: a constructed cell with 30 mutually non-dominated classes returns `completeness: partial`, status `unresolved`, a gap. RC-9.5 the equal-authority case is `unresolved` (the Graphiti gap) and the ineligible-loser case is `resolved` with a conflict. RC-9.6 status invariance under group duplication and input order. RC-9.7 adapter obligations (M4 C8 obligations 1 to 3 and 7): `phase1Cell` total on random `present` including the empty set; `deps` sound (removing evidence outside `deps(key)` never changes the key's state); trace node ids stable under shuffling. What disproves the design: a case where a reasonable reviewer reads a `resolved` cell as unresolved or the reverse at a rate above the baseline (reviewer study, spec section 18, needs participants).
**8. Risks.** The definition is ours and its relation to published prioritised repairs is unchecked; one-step defeat may over-exclude when dominance is non-transitive (the guard); clingo on the Windows development machine is untested (clingo-wasm avoids a native install; speed NOT VERIFIED); the oracle shares `dom`.
**9. Build notes.** Fast path first (it is the product path), general path and oracle in the evaluation tier. Unblocks M4 flips.

---

## Component 10. Provenance expressions on every derived cell

**3. Best references.**
- Green, Karvounarakis, Tannen, "Provenance Semirings", PODS 2007 (PDF text, `prior-art/07` section 4.1); ProvSQL (PierreSenellart/provsql, MIT, 75 stars, pushed 2026-10-13: semiring provenance for PostgreSQL, README claim).
- de Kleer ATMS labels; W3C PROV-O (export vocabulary only; it cannot express conflict or confidence, `07` section 4.2).
- HippoRAG `fact_source_counts` and `_remove_fact_sources_from_graph` (local clone, read at `HippoRAG.py:684-698`): per-edge, per-source counts, exact subtraction on retraction; LightRAG `rebuild_knowledge_from_chunks`; Cognee edge-evidence table.

**4. What they actually do.** HippoRAG stores per-edge counts keyed by source chunk and, on deletion, removes the chunk's contribution and recomputes the weight and edge kind, deleting the edge when no source remains. That is retraction for a monotone support count. The semiring framework annotates tuples with polynomials; difference-like operators are needed for non-monotone queries, which I did not read (`07` section 4.1 limits).

**5. Decision. Adapt.** One stored expression per cell supports four evaluations, with the honest limit that defeat is non-monotone, so cell status retraction is a *cell-local re-fuse*, and the semiring evaluations apply to support, independence, tier and necessity.

**6. Implementation design.**
```ts
type Prov =
  | { k: "ev"; id: Id<"ev"> }                                           // leaf: an evidence item
  | { k: "as"; id: Id<"as">; of: ProvRef }                              // an assertion: AND of its evidence and its derivedFrom
  | { k: "and"; of: ProvRef[] }                                         // joint support
  | { k: "or"; of: ProvRef[] }                                          // alternative support
  | { k: "conn"; a: Id<"mn">; b: Id<"mn">; edges: Id<"le">[] };         // 'a and b are in one cluster' = connectivity over these edges' provenance
type ProvRef = Hash;                                                    // hash-consed: shared subexpressions stored once, canonical order
```
1. **Per cell and value:** `support(v) = or over groups g with value v of and(as(g), conn(mention(g), anchor mention of the cluster, edges of the cluster path set))`. The `conn` node is evaluated by union-find over the listed edges under a removal set (exact, no path enumeration), which is how identity enters provenance without exponential blowup. If the only connecting path for a value's support runs through a `tier: "model"` edge, the cell reports `viaModelEdge: true` (component 6 item 3).
2. **Evaluations (each a total function over the DAG):**
   - `survives(S)`: Boolean semiring; does `support(v)` hold with evidence set `S` removed.
   - `independentSupport`: component 11's set-packing over origin roots.
   - `bestTier`: (max, min) over tiers (`or` takes the best alternative, `and` the weakest joint input).
   - `necessity(e)`: `survives({e})` false means `e` is critical to this value's support.
   - `trust`: `and` takes `combine` (meet), `or` takes the best alternative; used to derive `Fact.trust` over the **supporting** (winning) groups only (component 8 item 5). The groups that were defeated, ineligible or suspect are emitted beside it as `Fact.defeats`; they are not inside the `trust` evaluation.
3. **Where provenance is exact and where it is not.** `survives` over support is exact for monotone attributes (aliases, set-valued cells). For single-valued cells, removing evidence can let a previously defeated group win; so the cell record also stores **all active groups with their provenance** and `retract(S)` is `fuseCell` re-run on that cell with `S` removed (component 9 `statusUnder`). The acceptance statement in spec section 8 ("provenance-based retraction equals recomputation on every cell") is split in two (INT-039): for monotone support, provenance-expression retraction equals recomputation; for a defeated single-valued cell, a cell-local re-fuse equals recomputation. Both halves are tested separately. Retraction is first order (one fact, evidence item or rule version at a time); counts merge by set union (component 11).
4. **Export.** PROV-O (Turtle/JSON-LD) export: evidence is an Entity, a fetch or extraction an Activity, a channel or parser an Agent, `originId` derivation `wasDerivedFrom`, supersession `wasInvalidatedBy`; conflicts and `unresolved` use a small `plb:` vocabulary. Export only, never internal storage.
5. **Size.** Hash-consing; per-cell expressions capped at 10 000 nodes with a `prov_truncated` flag that forces `completeness: partial` on any M4 result using the cell.

**7. Tests and acceptance.** RC-10.1 for 10 000 random stores, `survives(S)` equals the support recomputed from scratch for monotone cells. RC-10.2 cell-local `retract(S)` equals global `fuse` with `S` removed for every cell of every gold case. RC-10.3 `necessity` equals leave-one-out recomputation. RC-10.4 `bestTier` and `trust` property tests (never above an input). RC-10.5 serialisation canonical and hash-stable. RC-10.6 provenance export round-trips through a PROV-O validator (tool NOT VERIFIED). Metric: expression size distribution on the gold cases.
**8. Risks.** The `conn` node assumes connectivity-as-OR is the right semantics for cluster membership; a different cluster algorithm would change it. Hash-consing complexity. NOT VERIFIED: ProvSQL's treatment of difference (not read).
**9. Build notes.** After 8. Unblocks M4's static cone and M9 bundle members.

---

## Component 11. Declared lineage, independence counting, the evidence-mass triple and ordinal tags

**3. Best references.**
- Li et al., VLDB 2013 (copy removal moved dominant-value precision from 0.908 to 0.923 on Stock and 0.864 to 0.927 on Flight; the automatic copy-aware AccuCopy did worse than simpler methods on Stock; with declared copiers it performed best; read in `07` section 2.2).
- Dong, Berti-Equille, Srivastava, "Integrating Conflicting Data: The Role of Source Dependence", VLDB 2009 (PDF text, `07` section 2.3).
- Covariance intersection as a principle only (secondary source, `07` section 5.3).
- Subjective logic's support/opposition/uncertainty split (Van der Heijden, Kopp, Kargl, arXiv 1805.01388, abstract level); Dempster-Shafer rejected (Dezert and Smarandache, arXiv math/0404371, abstract level).
- BODS source types (concepts only).

**4. What they actually do.** The 2013 study found copying detection helpful when accurate and harmful otherwise, with declared lineage the strong variant; the 2009 paper infers dependence from shared false values and says sharing common data alone does not imply copying. The subjective-logic abstract warns not all fusion operators are associative.

**5. Decision. Own** declared-lineage-first independence with a one-way rule: inference may only *lower* an independence count, never raise it. **Adapt** the support/oppose/silent split as an integer triple without belief operators.

**6. Implementation design.**
```ts
interface OriginDag { nodes: Map<Id<"og">, { derivedFrom: Id<"og">[]; declaredBy: "channel" | "document" | "human" | "default" }> }
interface EvidenceMass { support: number; oppose: number; silent: number; unchecked: number }   // counts over independent origins
type OrdinalTag = "corroborated" | "single_source" | "contested" | "claimed_others_silent" | "refuted" | "absent_checked" | "not_assessed";
```
1. **Roots.** `roots(o)` = origins with no declared parent reachable from `o` via `derivedFrom`. An assertion's lineage is `roots(originId)`. An aggregator that merges two registries has two roots and counts as supporting through **both** roots as one alternative (we cannot know which it copied).
2. **Independent support of a value `v`.** The size of a maximum family of groups asserting `v` whose root sets are pairwise disjoint (set packing; exact by branch-and-bound for up to 30 groups, else the greedy lower bound is reported with `completeness: partial`). A lower bound is conservative: it can only understate independence.
3. **Defaults for unknown origins (principle 8 of the spec, review item REC-02).** A source with no declared origin gets `origin = domain:<registrable domain>` (a pinned public-suffix snapshot; its licence is NOT VERIFIED) and the default is reported in the table (`origin_default_used`). Documents or pages on different domains whose normalised text or value fingerprints are identical collapse to one origin `mirror:<fingerprint>`: automatic inference may **only** merge (lower the count). It never splits an origin and never changes a verdict upward. A `possible_dependence` gap is filed for near-duplicates below the collapse threshold.
4. **Mass.** For each value `v` of a cell: `support(v)` = independent support above; `oppose(v)` = independent support of the conflicting classes counted the same way (excluding suspects); `silent(v)` = number of **independent origins** among the attribute's `requiredChannels` whose fetch state is `ok`, `not_found` or `partial` and that asserted nothing for this cell; `unchecked` = required channels in `not_checked`, `unavailable`, `rate_limited`, `blocked_by_policy`, `stale` (reported, not part of the triple). Counts are over *sets* of origin roots and are recomputed from sets; they are order independent because a set union is, not because integer addition is (merging two stores with a shared root double counts if added; Spec feedback 5).
5. **Ordinal tags (rules, no weights).** `corroborated`: `support >= 2 && oppose == 0`. `single_source`: `support == 1 && oppose == 0 && silent == 0`. `claimed_others_silent`: `support >= 1 && oppose == 0 && silent >= 1` with `support < 2`. `contested`: `support >= 1 && oppose >= 1`. `refuted`: `support == 0 && oppose >= 1` for a value that is only asserted by suspects or ineligible groups. `absent_checked`: `support == 0 && oppose == 0 && silent >= 1`. `not_assessed`: all required channels unchecked. The tag order feeds M4's confidence cap; no probability is produced.
6. **Reliability audit (offline, never in the path).** A report of per-source per-attribute accuracy against planted truth, from TruthFinder-, LTM- or CRH-style estimators, to support or challenge the tier table (`07` item J).

**7. Tests and acceptance.** RC-11.1 planted copy chains (a registry mirrored by two aggregators, three levels deep) never raise `support` above 1. RC-11.2 a sweep of copy rate: a majority-vote baseline degrades while the origin-aware count does not. RC-11.3 set-packing exactness against brute force up to 14 groups. RC-11.4 mirror collapse never increases a count (property test). RC-11.5 default origin reporting. RC-11.6 shuffled and duplicated stores give identical triples. Disproved if a planted chain raises `support`.
**8. Risks.** Declared lineage must exist: M1 channel metadata has to carry it (cross-module dependency); the public-suffix snapshot; set packing is NP-hard in general (cap); mirror collapse could undercount genuine independent confirmations that happen to be textually identical (conservative by design, reported).
**9. Build notes.** After 8; M1 must expose origin metadata first. Unblocks 14 and M4 confidence caps.

---

## Component 12. Sanctions and watch-list matcher and its perturbation test

**3. Best references.**
- Moov Watchman (moov-io/watchman, Apache-2.0, 512 stars, pushed 2026-10-13): `docs/methodology/`, `docs/cross-script-matching.md`, `docs/opensanctions-pairs.md`, `docs/algorithm-comparison.md` (read). Author-reported on 472 477 OpenSanctions Pairs people, companies and vessels at `minMatch=0.80`: Jaro-Winkler precision 0.986 recall 0.689 (cross-script recall 0.50); with embeddings for different writing systems precision 0.946 recall 0.815 (cross-script 0.91); embeddings on every pair precision 0.784 recall 0.933. Algorithm changes (Soundex, double-metaphone, Beider-Morse, Editex, N-SIM) did not close the transliteration gap in its comparison. Jaro-Winkler with a first-letter phonetic filter and length penalties is its default.
- yente (opensanctions/yente, MIT): retrieval then `algorithm.compare`; nomenklatura `logic_v2` (read, above).
- OpenSanctions Pairs (arXiv 2603.11051; dataset CC-BY-NC-4.0, local evaluation only).
- Finansinspektionen 2024 test (spec section 1, `prior-art/15` sections 2 and 6): 19 banks, 5 000 UN and EU list names; mean recall 63.9% on altered names versus 86.3% as spelled; medians 73.4% and 99.3%; per-bank altered-name recall 5.0% to 96.1%; no bank reached 100%. The report's perturbations (removed or replaced letters, altered dates of birth) are quoted in `15` section 6 item 1.
- OFAC export and list terms: reuse NOT VERIFIED (spec section 6); EU/UN/UK terms NOT VERIFIED.

**4. What they actually do.** Watchman scores a query against indexed list entries with Jaro-Winkler over name token pairs plus identifier, date and address scoring, and an optional embedding path gated to different-script pairs; its own measurements show recall depends strongly on the threshold and on script. nomenklatura's `logic_v2` aligns symbols then fuzzy-matches the remainder and penalises digit mismatches only. The FI test shows the practical problem: even correctly configured banks lose recall on altered names.

**5. Decision. Own the matcher as a thin layer over components 3 to 5**, reusing the same normaliser, blocking and ledger (one matching stack, not two), and use Watchman, yente/nomenklatura and plain edit distance as **baselines** in the evaluation tier. The embedding arm is an **experiment** (needs a model with an embedding endpoint or an in-process model that satisfies size, licence and no-runtime-download; NOT VERIFIED for the sponsor profile). Rejected: calling Watchman or yente in the product path (extra services, Go/Python/Elasticsearch); treating a non-match as clear.

**6. Implementation design.**
1. **A screening is a set of ordinary link edges.** List entries are `listing` mentions from the official-list channel (authority `authoritative`, trust `VERIFIED`, origin `ofac:sdn:<publishDate>`). Screening the subject (and every owner, director and signatory resolved in the case) runs list-scope blocking (component 4) and the ledger (component 5) with a list-specific `LinkConfig`: lower `linkCb`, a `reviewCb` below it, and per-attribute extras for date of birth, country and identifiers. Edges at or above `reviewCb` are recorded as `possible` (or `same` at `linkCb` with an identifier) between the subject mention and the `listing` mention. Edges below `reviewCb` are not recorded; the best below-review score and count are stored in the screening coverage. Because hits are ordinary edges, **component 13 treats them uniformly**: any `possible` list link whose reversal changes the verdict forces escalation, independent of policy wording.
2. **Cell semantics.** `sanctions_status.<list>` is a cell whose value is one of `potential_match(entries)`, `confirmed_identifier_match`, or `no_match_found`, never `clear`. The cell always carries `{ listId, listVersion, publishDate, retrievedAt, ageDays, method: "plumbline.link@<version>", thresholds, bestBelowReview, coverage: string[] }`. `no_match_found` is `resolved` only when the list channel's fetch state is `ok`; `stale` beyond the list's TTL, `partial`, `unavailable` or `not_checked` change the status (component 14). A single-list screen is labelled as covering that list only (spec section 6; `15` section 4).
3. **Alert budget.** The operating point is expressed as an alert budget on a reference stream (for example 1% of screened names alert), as in the FI protocol (recall at a fixed alert budget), and `reviewCb` is set to meet it on the gold stream; both the threshold and the budget are published.
4. **Natural persons.** The matcher handles persons (owners, directors, signatories) through the same pipeline; per F-PERSONS, committed cassettes and fixtures contain organisations only, so person-level evaluation runs locally on non-redistributable data and the report says so.
5. **Embedding arm (experimental).** For a non-Latin query or entry, a vector similarity may add a ledger line `embed_cross_script` (integer-quantised, with the model id and vector hash in the cassette). It can raise a pair to `possible` only. Switched off by default; kept only if the perturbation test shows recall gain at equal alert budget with an interval excluding zero.
6. **Release-time re-screening.** M13 re-validates `listVersion` at execution (spec section 14a); this component exposes `screen(subject, listVersion)` as a pure function of the recorded artifact so M13 can recompute. A list update invalidates pending approvals through M13, not here.
7. **Failure.** Missing or hash-mismatched index artifact: `unavailable` cell, no cache fallback; index build errors fail the build.
**Finansinspektionen-style perturbation test (generator spec for M11).** Source: organisation entries from the hash-pinned public sample (and, locally, the full OFAC and EU/UN lists where terms allow). Perturbation families, each applied to the correctly spelled name and tested separately: delete one letter; replace one letter (keyboard-adjacent and arbitrary); transpose two letters; insert a letter; remove a token; add a descriptive token; reorder tokens; change legal-form suffix (present, absent, abbreviated, spelled out); diacritic stripped or added; transliteration variants (BGN/PCGN, ISO 9, informal); mixed-script homoglyph substitution; punctuation and whitespace; altered date of birth for persons and altered incorporation date for organisations (with and without the date available on the screened side). Negatives: random names of the same country; common-name collisions (same surname, different birth year; companies sharing a trade word); sibling entities. Report recall at the fixed alert budget, split natural versus legal persons and by family, against Watchman (JW), yente/nomenklatura `logic_v2`, plain Levenshtein and the full-recall-by-brute-force upper bound. The comparison is on the same names and the same budget. We do not target 100%; the claim is "not worse than the best baseline at equal budget, with intervals, and here is where we lose".

**7. Tests and acceptance.** RC-12.1 the perturbation suite as above, with at least 246 positives per family cell for a recall near 0.8 to within plus or minus 0.05 (385 if near 0.5, spec section 17), cluster bootstrap by list entry. RC-12.2 `no_match_found` is never rendered `clear` (lint on the cell schema). RC-12.3 `stale` list version downgrades the cell. RC-12.4 index tamper or version mismatch gives `unavailable`. RC-12.5 an adversarial set: lookalike vendor names built by homoglyph and one-letter edits of list entries must alert or `possible`, and benign near-neighbours must not flood (alert rate reported). RC-12.6 OpenSanctions Pairs organisation subset (local) F1 versus its published baselines, labelled as anchor, not as result of record. RC-12.7 ablations: discriminator guard on lists (siblings), decay irrelevant, embedding arm.
**8. Risks.** List licences (OFAC, EU, UN, UK) unverified; the FI perturbations are modelled on the regulator's description, not its data; Watchman's published numbers are author-run; the pair-level dataset does not test retrieval (blocking recall must be measured separately, as Watchman's own page notes); OpenSanctions data is non-commercial and cannot ship; person-level evaluation is not publishable here.
**9. Build notes.** After 3 to 5 and the list artifact build; first public-facing evaluation artifact of Reconcile. Unblocks the sanctions hero case.

---

## Component 13. Identity-hypothesis robustness

**3. Best references.**
- Binette and Steorts, arXiv 2008.04443: two-stage Bayesian ER that propagates linkage uncertainty downstream ("linkage averaging", credited there to Sadinle 2018, not fetched); d-Blink, arXiv 1909.06039 (abstract level).
- Reiter 1987 and Ignatiev et al. 2019 via `prior-art/08` for the minimal-set formulation.
- `prior-art/07` section 11.1 and 8H (the design origin; novelty NOT VERIFIED beyond partial search).

**4. What they actually do.** The statistical literature averages a downstream estimate over posterior linkage samples; none of the sources I read applies the idea to a deterministic, rule-based decision with exact minimal sets (absence from my reading is not evidence of novelty).

**5. Decision. Own** (research contribution C6 of the spec), in a bounded, deterministic form with an explicit partial state and an ablation. Cost and availability are measured, because the failure mode is escalating everything (adversarial review REC-01).

**6. Implementation design.**
```ts
type Hypothesis = { flip: Id<"le">[] };                                                        // reversible edges whose verdict is reversed from the baseline
interface IdentityRobustness {
  state: "stable" | "identity_dependent"; completeness: "exact" | "partial";
  baselineVerdict: Action; reversible: number; coneSize: number; hypothesesEvaluated: number; admissible: number;
  minimalReversals: { edges: Id<"le">[]; verdict: Action }[];                                  // subset-minimal sets whose reversal changes the verdict
  cap: { maxEdges: number; maxHypotheses: number }; forcedEscalation: boolean }
function robustness(base: FuseInput, verdictOf: (t: TruthTable) => Action, reads: ReadonlySet<Key>, cfg: RobustnessConfig): IdentityRobustness
```
`verdictOf` is M4's composition `phase2 ∘ phase1` over M5a's `evaluate` (the V of spec section 9, owned by M4 C8), and `reads` is M5a's declared read set for the projection, control dependence included. The algorithm is M3's; both are injected function and data values, so M3 imports nothing from M4 or M5 (INT-034, INT-037).
1. **Reversible set `Rv`.** `possible` edges (baseline: not merged; reversal: merged as `same`) and model-promoted `same` edges (baseline: merged; reversal: unmerged). Deterministic `same` edges from T0 to T2 are not reversible; they are covered by the cannot-link audit.
2. **Static cone.** Keep an edge only if reversing it can change a cell the policy reads: compute, for each reversible edge, the clusters of its endpoints and the attributes with assertions in either; intersect with the injected `reads` (declared by M5a; cell keys are the anchored keys of component 9 item 4). Edges outside the cone are dropped from enumeration and counted in `coneSize`.
3. **Admissibility.** A hypothesis is a subset `F` of the cone to reverse. It is admissible iff applying it and re-running `cluster()` creates no refused merge against a `different` edge (cannot-link) and no violation of declared unique identifiers. Admissible hypotheses are deduplicated by the resulting **partition hash** (distinct flips can yield one partition), and each partition is evaluated once.
4. **Enumeration.** Breadth by `|F|` (0, 1, 2, ...), up to `maxEdges` (default 10) cone edges and `maxHypotheses` (default 4096) evaluations. For each admissible partition: `fuse` (with the memoised cell cache of component 16, so only affected cells recompute) then `verdictOf`. Collect partitions whose verdict differs from the baseline; subset-minimal `F` among them are the `minimalReversals` (skip supersets of a found set; V is not monotone so minimality is subset-minimal, not smallest, matching the RS/MF treatment in spec section 9).
5. **Result.** `stable` iff every evaluated admissible partition gives the baseline verdict and `completeness == exact` (the cone fit under the caps). If a cap is hit, the result is `identity_dependent` with `completeness: "partial"` (conservative), and `forcedEscalation = true`. `identity_dependent` forces escalation in M5 as a rule; M3 only reports.
6. **Pricing the feature.** The module reports per run: `reversible`, `coneSize`, `hypothesesEvaluated`, wall time and oracle calls; M11 aggregates the **forced-escalation rate** on the gold stream and on a legitimate-vendor stream and compares it with the false-merge harm avoided; the ablation arm turns the feature off and shows the cases where a planted wrong `possible` link flips release to hold.
7. **Interaction with sanctions.** Each `possible` vendor-to-list edge is reversible; a common name with many low-score hits would blow the cone, so `reviewCb` and the per-name hit cap (default 10, remainder recorded as a gap) are part of the cost design; the hits that exceed the cap make the state `partial`.
8. **Concurrency.** Hypotheses are independent and may be evaluated in parallel; the result is collected in canonical order so output is deterministic.

**7. Tests and acceptance.** RC-13.1 planted cases where one `possible` link flips release to hold: all flagged (recall 1 over the planted set, interval reported). RC-13.2 planted stable cases never flagged (false-flag rate with interval). RC-13.3 exactness against brute-force enumeration of all subsets for up to 12 reversible edges. RC-13.4 cap behaviour: a case with 14 cone edges returns `partial` and `identity_dependent`. RC-13.5 forced-escalation rate on a legitimate-vendor stream at 0.1, 1 and 10 percent fraud prevalence, against the benefit. RC-13.6 ablation off. What would disprove it: forced escalation that exceeds a stated reviewer budget with no offsetting benefit, which is a published negative result.
**8. Risks.** Real vendors with several near-name candidates may escalate too often (the very risk REC-01 named); the cone depends on M5 declaring reads honestly; the baseline treats `possible` as non-merge, which is a policy choice that must match M5; NOT VERIFIED whether enumeration time is acceptable on real ledgers.
**9. Build notes.** After 6, 14 and 16 (needs incremental cell cache and the verdict port). Unblocks the identity-dependent hero case.

---

## Component 14. The truth table: fetch states, coverage and gaps

**3. Best references.** `prior-art/02` (fetch states and the channel contract), spec sections 6 and 9; Open Ownership BODS 0.4 `recordStatus` (`new | updated | closed`); W3C PROV-O for export. No external table format is adopted.

**4. What they actually do.** The source-channel layer reports typed fetch states (`ok`, `partial`, `not_found`, `not_checked`, `not_applicable`, `unavailable`, `blocked_by_policy`, `rate_limited`, `stale`). Principle 4 of the spec says silent, contradicting, unavailable and not-checked are four different facts. The shared `CellStatus` therefore has five values (`resolved | unresolved | silent | not_checked | unavailable`, INT-007); a projection that dropped `silent` would turn "absence" into "not checked" by accident, so none exists.

**5. Decision. Own.** A truth cell separates *what is concluded* (`status`) from *what was checked* (`coverage`).

**6. Implementation design.**
```ts
interface CellKey { entity: Id<"en">; attribute: string }
interface ChannelCoverage { channel: string; state: FetchState; checkedAt?: Iso; listVersion?: string; asOfAge?: number }
interface Cell {
  key: CellKey; status: CellStatus; reason?: string;                                            // shared five-valued type; reason: 'bracketed_change', 'no_eligible_value', 'stale_authority', 'equal_authority', ...
  value?: Json; certain: Json[]; possible: Json[]; losers: Loser[]; suspects: Id<"as">[];
  mass: Record<string, EvidenceMass>; tags: Record<string, OrdinalTag>; coverage: ChannelCoverage[];
  fact?: Id<"fa">; trust: TrustLevel; conf: Confidentiality; personal: boolean;
  supportLabels: { trust: TrustLevel; authorship: Authorship; tier: AuthorityTier }[];           // of the supporting groups; sorted, deduplicated (INT-014 lookup input for M5)
  viaModelEdge: boolean;                                                                        // support connects only through a tier "model" link (component 6 item 3)
  prov: ProvRef; completeness: "exact" | "partial" }
interface Gap { id: Id<"gp">; kind: FetchState | "repair_cap_exceeded" | "blocking_truncated" | "ownership_depth_cap" | "origin_default_used" | "possible_dependence" | "prov_truncated" | "extraction_reject"; cell?: CellKey; channel?: string; impact: "caps_confidence" | "forces_hold_if_required" | "informational"; requestable: boolean }
interface TruthTable { caseId: Id<"cs">; asOf: AsOf; rulesHash: Hash; entities: Entity[]; cells: Cell[]; conflicts: Conflict[]; links: LinkSummary; gaps: Gap[]; completeness: "exact" | "partial"; hash: Hash }
```
**Status rules for a cell (total function of active groups and required-channel states):**
1. Non-empty `A` (after suspects): component 9 gives `resolved` or `unresolved`. Coverage is attached; if any required authoritative channel is not `ok`, a `coverage_incomplete` gap caps confidence even when the cell is `resolved`.
2. Empty `A`, and some required channel is `not_checked` or `blocked_by_policy`: `not_checked`.
3. Empty `A`, and some required channel is `unavailable`, `rate_limited`, `stale` or `partial` (none `not_checked`): `unavailable`, with the real state in `coverage`.
4. Empty `A`, and every required channel is `ok`, `not_found` or `not_applicable`: `silent` (all checked, nothing says). Sanctions: the same, rendered `no_match_found` with the screening metadata (component 12). `not_applicable` alone for every channel means the attribute does not apply to the entity.
5. An attribute with no declared required channel and no assertions is `not_checked` (never `silent`): absence of a plan is not a negative finding.
The table's `hash` is `H("truth", rulesHash, asOf, sorted cell hashes, sorted conflict hashes, sorted gaps)`; it contains no floats, no wall-clock values and no model output. `Fact` ids are `fa_ + H(cellKey, canon(value), supporting group keys, defeated group keys)`, so a new conflicting input changes the fact's identity and diff while never its trust (component 8 item 5). A `silent` cell has no `Fact`; consumers that need positive evidence read `silent` as absent evidence (M5 maps it to a hold plus a gap).
**Views for others.** M4: the reconcile half of `V` (`keys/deps/phase1Cell/trace`, `statusUnder`, `cellHypergraph`; component 9 item 4), facts, gaps. M5: typed cells (never raw text). M10: the table as JSON plus the per-cell provenance and as-of slider data. M9: the table and the inputs of `fuse` as bundle members (so the verifier recomputes). M6: facts and cell keys for the decision-dependency graph.

**7. Tests and acceptance.** RC-14.1 the five status rules, each with a minimal fixture. RC-14.2 a lint on the cell schema forbids an empty value rendered as success. RC-14.3 table hash stability across runs and platforms. RC-14.4 the four-honest-states test: for one attribute, vary the fetch state of one required channel and assert the status moves exactly as the rules say. RC-14.5 gap round trip: every gap of a requestable kind produces a `ReplanRequest` (component 15). RC-14.6 all five statuses are shared: no module-local status type or projection exists (lint), and a `silent` cell serialises, hashes and renders as `silent` end to end.
**8. Risks.** `silent` must be handled by every consumer of the shared five-valued type (M5 `featurize`, M10 cell states); rule 5 may under-report absences when a pack forgets `requiredChannels`; the table can become large for ownership chains (paged views).
**9. Build notes.** With 8 to 11. Unblocks 15 and M4.

---

## Component 15. Request-more and re-plan hooks

**3. Best references.** Spec F-REPLAN and F-DISCOVER (section 21); Cognee's silent failure of the contradiction pass as the anti-pattern (`prior-art/01` decision, "Surface a failed contradiction pass as a failed check"); the organizers' revision loop (spec section 1a). No external system adopted.

**4. What they actually do.** The spec's `request_more` edge fires when a conflict is unresolved and a higher-authority source has not been queried; the planner amends the plan for that sub-question only, under `maxVisits: 2`.

**5. Decision. Own.** M3 does not call the planner; it returns typed, idempotent requests, and recomputes on the delta.

**6. Implementation design.**
```ts
type ReplanReason =
  | "unresolved_higher_authority_unqueried"   // cell unresolved; a channel with a higher tier for this attribute is not_checked/unavailable/stale
  | "stale_authority_refetch"                 // freshness guard fired
  | "required_evidence_missing"               // release-enabling fact absent (spec section 5): a hold unless requested
  | "link_informative_attribute_missing"      // a possible pair lacks an attribute the ledger could use to separate them
  | "coverage_gap_in_policy_cone";            // a required channel not ok on a cell the policy reads
interface ReplanRequest { id: Id<"rq">; reason: ReplanReason; subject: CellKey | { a: Id<"mn">; b: Id<"mn"> }; channel: string; query: Json /* closed grammar from the channel contract */; why: Why; budgetSlice: number; visit: number }
function requestMore(table: TruthTable, edges: LinkEdge[], authority: AuthorityTable, policyReads: ReadonlySet<string>, visit: number): ReplanRequest[]   // pure
```
1. **Triggers (all derived from the table, none from a model).** For each `unresolved` cell with subtype `equal_authority` or `stale_authority`: find channels in `authority[attribute]` with a tier at least the best tier of the conflicting groups, whose coverage state is not `ok`; emit one request per channel. For each `possible` edge: find ledger comparisons at level `absent_one_side` or `unknown` whose attribute is obtainable from a channel not yet queried for either mention (for example an LEI lookup by name to separate two candidate registrants) and emit a `link_informative_attribute_missing` request. For each required release-enabling fact absent: `required_evidence_missing`.
2. **Idempotence and bounds.** `id = rq_ + H(reason, subject, channel, query)`; a request already issued in an earlier visit and answered `not_found` is not re-issued (the answered state is in coverage); `visit` increments per re-plan and is capped by the planner's `maxVisits`; per-visit budget slices come from M7. Requests are sorted by (expected impact class, id); impact class = `forces_hold_if_required` before `caps_confidence`.
3. **Recompute on the delta.** New assertions enter through component 1; component 16 recomputes only affected cells and the diff is recorded in the trace as a `coverage.replan` event with `why` (rule id, cell, channel).
4. **Failure.** If the requested channel returns a non-`ok` state, the state is recorded and the gap stays; exhaustion leaves the gap in the ledger and the confidence cap in place (spec F-REPLAN).

**7. Tests and acceptance.** RC-15.1 first pass lacks evidence, requests are produced, after the delta the table changes and the cap holds. RC-15.2 exhaustion keeps the gap. RC-15.3 idempotence: calling `requestMore` twice on the same table gives identical requests; a `not_found` answer suppresses re-issue. RC-15.4 no request for a channel the policy forbids or the channel contract cannot handle (`canHandle` false). RC-15.5 a request is never generated from vendor text. Metric: share of planted unresolved cases resolved by one re-plan visit.
**8. Risks.** Expected impact class is crude (no value-of-information claim); depends on M1 exposing `canHandle` and the closed query grammar; the planner may ignore requests (its trace shows it).
**9. Build notes.** After 14. Unblocks the F-REPLAN demonstration.

---

## Component 16. Incremental recomputation and the idempotent re-run diff

**3. Best references.**
- salsa (salsa-rs/salsa, Apache-2.0, 2991 stars, pushed 2026-10-13): "a generic framework for on-demand, incrementalized computation" (README read): inputs and memoised pure functions, recomputation only where inputs changed.
- differential-dataflow (TimelyDataflow/differential-dataflow, MIT, 3019 stars): incremental computation over changing collections (README claim; not read in depth).
- Mokhov, Mitchell, Peyton Jones, "Build systems a la carte: theory and practice", J. Functional Programming 30, 2020 (title, authors and venue fetched; the abstract fetched does not mention early cutoff or constructive traces, so those terms are used here as general knowledge of the build-systems literature and are **not** attributed to this page).
- Meterless World Model `scripts/idempotency-check.ts` with `--mutate` (the "diff: empty" proof and its failing twin, described in the engineering brief).
- HippoRAG index manifest and `StateConsistencyError` (local clone, `HippoRAG.py:317-420`): hard error on stale or mixed state.
- Shapiro et al., "A comprehensive study of Convergent and Commutative Replicated Data Types", INRIA RR-7506 (abstract level): the store as a grow-only set.

**4. What they actually do.** salsa memoises query results and re-verifies dependencies on input change; the World Model script ingests twice and compares a canonical state string, then mutates one title to show the check can fail; HippoRAG refuses to run on a mismatched manifest.

**5. Decision. Adapt** the memoised-query idea, **own** the keys and the diff. Not adopting salsa (Rust) or differential-dataflow (Rust): the cell-level key structure below is simpler and portable to the verifier.

**6. Implementation design.**
1. **Memo keys (content-addressed).** `cellKey = H("fuse.cell", rulesHash, attrSpecHash, asOf, sorted active group keys with their last-seen dates, sorted cluster membership hash, relevant coverage states)`. The memo maps `cellKey -> CellResult`. A change to any input changes the key; there is no invalidation logic to get wrong. Cluster recomputation memoises on the sorted edge set hash per connected component of the edge graph, so a new edge recomputes only its component.
2. **Delta application.** `applyDelta(prev: TruthTable, newAssertions, newEdges, newCoverage) -> TruthTable`: determine affected components and cells by key difference, recompute those only, reuse the rest. The result must equal a full `fuse` over the union (RC-16.1); the full path is always available and is the oracle. M4's `incremental` hint on `phase1` (previous `Intermediate` plus the changed evidence) is served by `applyDelta`; a differential test shows equality with the non-incremental result (M4 C8 obligation 10).
3. **Idempotent re-run diff.**
```ts
interface TruthTableDiff { added: CellKey[]; removed: CellKey[]; changed: { key: CellKey; before: CellSummary; after: CellSummary; causes: ("assertion_added" | "assertion_removed" | "edge_changed" | "coverage_changed" | "rules_changed")[] }[]; linksChanged: Id<"le">[]; gapsChanged: Id<"gp">[]; empty: boolean }
```
   `CellSummary` = (status, certain, possible, supporting and defeated group keys, mass, tags, coverage states): it ignores `lastSeen` and observation counts, so a re-observation with identical content is an empty diff. A mutated re-run (one value in one source edited) produces exactly the cells whose active groups changed, with causes. The diff is canonical (sorted) and hashable and is what M10's "re-run" button displays (the World Model "diff: empty" idea).
4. **Staleness.** The memo is keyed by the rules hash and normaliser versions, so a rules change shows up as `rules_changed` in the diff for every affected cell; mixed-version state is a hard error (HippoRAG pattern).
5. **Concurrency.** Single writer; cell recomputation is parallel-safe (pure) and merged in key order.
6. **Order independence and union (CRDT-style).** The store is a grow-only set of immutable content-addressed items plus supersession records, so `fuse(A union B) == fuse(B union A)` and `fuse(shuffle(S)) == fuse(S)`. This guarantees convergence of the store; it does not make the verdict monotone (new evidence can flip a cell), which the tests state.

**7. Tests and acceptance.** RC-16.1 `applyDelta` equals full `fuse` on 10 000 random delta sequences. RC-16.2 idempotent re-run: ingest the same case twice (replay and live-with-identical-content) gives an empty diff; a one-value mutation gives the expected diff (predicted from the fixture). RC-16.3 shuffle and union properties. RC-16.4 rules-change diff lists every cell whose result changed, none that did not. RC-16.5 cache poisoning: a corrupted memo entry is detected by recomputing on a sampled 1% and the run fails closed. RC-16.6 cost: cells recomputed per delta against total cells, reported. Metric: recompute fraction on single-assertion deltas.
**8. Risks.** Cell keys include many inputs and could over-invalidate; memo growth (bounded LRU, full recompute fallback); the equality of incremental and full paths is a strong claim with only random testing behind it.
**9. Build notes.** Full `fuse` first, memo second, `applyDelta` last. Unblocks 13 and 15.

---

## Interfaces table

| Interface | Direction | Contract | Consumer |
|---|---|---|---|
| `link(ctx, mentions, scope, config) -> Result<LinkEdge[]>` | M3 exposes (Stage A, effectful) | edges with integer ledgers, per-pair `inputs`, model metadata and `direction` (`config` carries it per candidate set); recorded in the ledger | M7 (runs it), M9 (stores) |
| `fuse(input) -> TruthTable` | M3 exposes (Stage B, pure) | deterministic, integer and ordinal only; the reconcile inside V | M4, M5, M9 verifier recompute module, M13 |
| `statusUnder(cell, removed) -> CellResult`; `cellHypergraph(cell)` | M3 exposes | cell-local re-fuse and conflict structure | M4 (flips, sufficiency, static cone) |
| `keys()`, `deps(key)`, `phase1Cell(key, present, edits)`, `trace` | M3 exposes (adapter for M4 C8 `Evaluator`) | anchored cell keys, sound evidence dependencies, per-cell pure reconcile, content-id `DerivationNode`s with `owner: "M3"`; M4 owns the interface and `V = phase2 ∘ phase1` | M4 (composes), M9 recompute module |
| `reconcileFromEdges(assertions, edges, rules, asOf)` | M3 exposes | the exact function the verifier re-implements; no Stage A code | M9 |
| `Fact`, `Cell`, `Gap`, `Conflict`, `TruthTable` | M3 exposes | typed, hashed values; `Fact` is the shared type (`supports`, `defeats`, `trust`, `conf`, `personal`); `Cell.status` is the shared five-valued `CellStatus`, no projection | M4, M5, M6, M10 |
| `robustness(base, verdictOf, reads, cfg)` | M3 exposes; consumes `verdictOf` (M4, over M5a) and `reads` (M5a) as injected values | no package dependency upward | M5 (forces escalation), M10 |
| `requestMore(table, edges, authority, reads, visit)` | M3 exposes | pure, idempotent `ReplanRequest[]` | M7 planner |
| `screen(subject, listVersion)` | M3 exposes | pure function of the recorded list artifact | M13 (release-time re-validation), M4 |
| `diff(prev, next) -> TruthTableDiff` | M3 exposes | canonical, hashable | M10, M11, M7 |
| `FactStore` (events, `fold`, views, `stateShapeCanonical`) | M3 specifies; M12 implements the Meterless-conformant engine | contract of component 2 | M12, M6 |
| Channel metadata: authority per attribute, `requiredChannels`, `canHandle`, origin DAG (`origins.json` per pack), fetch states | M3 consumes | typed; origin lineage declared; read as pack data under one name, `requiredChannels` | M1 |
| `ExtractionDiag`, double extraction output, locators | M3 consumes | per-assertion diagnostics; shared `ExtractionDiag` with five agreement states (INT-022) | M2 |
| `combine`, labels | M3 consumes | trust lattice, confidentiality join | M8 |
| `ctx.clock`, `ctx.ids`, `ctx.model`, cassettes, budgets | M3 consumes | effects only through ports | M7 |
| Benchmark generators and gold labels (conflict types, planted near-duplicates, perturbation test, origin DAG) | M3 consumes; M11 produces | generator reviewed independently of this module | M11 |

## Spec feedback

1. **`CellStatus` cannot express "checked, nothing says."** Resolved by INT-007: the shared type is extended to five values (`resolved | unresolved | silent | not_checked | unavailable`); this blueprint's local extension and projection are deleted. The shared types now define `Fact` and the missing `Assertion` fields.
2. **Section 8's "resolution is a pure function of dates, authority tiers and per-attribute cardinality" is incomplete.** Resolved by INT-065 (spec wording): section 8 names the rank vector of component 8, which adds trust eligibility for release fields (spec section 5), authorship and a freshness guard; without the guard a stale register silences a newer contradicting claim.
3. **Trust of a fused value.** Resolved by INT-013: trust is the meet over the supporting (winning) groups; defeated, ineligible and suspect groups are recorded in `defeats` (hashed into the fact id and M8's `derivedFrom`) and affect only status, conflicts and gaps. Applied literally, the spec's "every input" rule would let an attacker-supplied conflicting assertion downgrade a `SOR` value (an availability attack). M8 C2 items 1, 9, 10 change accordingly.
4. **"Provenance-based retraction equals recomputation on every cell" (section 8 acceptance) holds only for monotone support.** Resolved by INT-039: the spec acceptance line is split in two (component 10 item 3 states both halves). Defeat is non-monotone (07 section 4.1 said so); exact retraction of a single-valued cell is a cell-local re-fuse.
5. **Evidence-mass counts are not additive** (07 section 5.1 says integer counts add). Resolved by INT-039: counts merge by set union. Counts over independent origin roots are computed from sets, and merging two stores that share a root would double count if added.
6. **World Model contract.** Partly resolved by INT-062 (the product conflict policy is M3's `ResolverPlugin`, the engine's built-in policy and auto-merge are conformance-only, component 2 item 5; R-WM requirements go into bake-off 6); (d) and the spec section 12 wording stay **Open**. (a) The Meterless reference's `assertFact` resolves by mutating state after appending the event and the fold does not reconstruct it (read in `index.ts` and `store.ts`): confirmed, so resolution must be a view, as designed here. (b) The reference derives record time from `source.at`, the spec's replay requires `ctx.clock`; two axes are explicit here. (c) Every edge type is single-valued in the reference fold; cardinality per type is required. (d) Spec section 12's "World Model remains the only store of reconciled facts" needs the event kinds of component 2 to hold link judgements, which the reference lacks.
7. **Ownership of identity-hypothesis robustness.** Resolved by INT-034 and INT-037. Spec section 8 lists it in M3 but it needs M5's policy function and `reads`. The algorithm stays in M3; `verdictOf` (M4's `phase2 ∘ phase1`) and `reads` (M5a) are injected, so there is no package cycle.
8. **V's boundary.** Resolved by INT-034. Section 9 says V is "reconcile, label aggregation, policy" and section 13 says the verifier re-runs reconcile only from recorded link decisions. M4 owns `V` and the `Evaluator` interface; this blueprint's Stage A versus Stage B split is the boundary, with integer ledgers; fuzzy scores never appear in V.
9. **Unknown origins.** Resolved by INT-065 (spec wording): REC-02's default is adopted with one added rule: inference may only lower independence counts.
10. **nomenklatura invariant.** Resolved by INT-065 (correction to `prior-art/07` section 12). `resolver.py` `_decide` shows a positive decision can bypass a negative edge (the guard is in the callers); our `cluster()` enforces the invariant.
11. **Dataset licence discrepancy.** Resolved by INT-065 for the wording (log the discrepancy in `docs/intel/06`); the licensing stance is Prateek's decision D6, **Open** until confirmed. The OpenSanctions Pairs arXiv page shows a CC BY 4.0 icon while the dataset card says CC-BY-NC-4.0; treat as non-commercial and local only.
12. **Conventions `Assertion` type** lacked a locator (carried by `Evidence`), and the spec's section 8 `Assertion` lacks `trust`, `conf` and `derivedFrom`. Resolved by INT-007: the shared `Assertion` carries those fields and spec section 8 is aligned to it.

## What this blueprint does not cover

- **Document extraction and double extraction** (M2) and the claim ledger, L0 to L3 checks, minimal flips, certificates and the exact search (M4); only the evaluators and hypergraphs M4 needs are specified.
- **Policy rules, ownership aggregation thresholds, autonomy, approvals** (M5); **precedent retrieval and consolidation** (M6); **trust lattice internals and quarantine** (M8); **bundle format, ledger and verifier** (M9); **console views** (M10); **gold-set generator and statistics** (M11); **Meterless engine implementation strategy** (M12, bake-off 6); **action broker and re-screening triggers** (M13); **agent prompts and model selection** (M14).
- **Address geocoding and parsing, phone and email matching beyond exact normalised forms, CJK word segmentation, persons-specific naming conventions** (patronymics, honorific cultures).
- **Portfolio-scale operation** (thousands of vendors, continuous streams, cost model): the portfolio scope exists in blocking but its capacity and cost are not designed (spec section 21c items 2 and 6).
- **Learned components in the path** (calibrated probabilities, EM-fitted weights, embedding models) are offline or experimental only; the constants tables are hypotheses until calibrated.
- **Not read or not run:** no third-party code was executed; the clingo program is a contract sketch; Bleiholder and Naumann's data-fusion survey and the prioritised-repair literature were not fetched; ISO 20275, ISO 17442, ISO 13616 and the Unicode case-folding data were not read; ProvSQL's treatment of difference, differential-dataflow internals and XTDB behaviour beyond README are unread; every external number quoted (Watchman, OpenSanctions Pairs, Finansinspektionen) is author-reported and was not reproduced.
- **Evidence of benefit:** none exists yet for identity-hypothesis robustness, time-decay levels, the discriminator guard's effect on recall, or the two-pass model position control. Each is a hypothesis with its test named above.

## Pass 3 resolutions (2026-10-13)

Source: `99b-integration-register-pass3.md` (INT-101 onward). These bindings override the body above wherever they differ; the body has not been rewritten. Each line is one binding change; the register item holds the reason and the other modules affected.

- **INT-115.** `Assertion` gains flat `authorship`, `producer` and `tier`, copied at creation. `Fact` gains `supportLabels: SupportLabel[]` (sorted by group, each `{group, label: PermLabel, origins}`); it replaces the local `Cell.supportLabels`. `Fact.trust` stays the meet over `supports`; `defeats` never enter `supportLabels`.
- **INT-116.** `supportLabels[].origins` are the independence units (same-origin duplicates once) from which M5's `allowOrigins` feature is counted; counterparty duplicates never raise it.
- **INT-120.** `ExtractionDiag` has five agreement states; `single` is no evidence of disagreement and, on a hold-relevant field, a gap.
- **INT-137.** Cells are keyed `cell:<anchor>/<attribute>` where `anchor` is the least mention id of the entity in the base snapshot; `Fact.cell` carries `anchor` and keeps `entity` as a derived view id. Define the status of a cell whose anchor mention has no assertion left under S (restrict-only: absent). Add tests that the key set is identical for every S.
- **INT-138.** Stage B must be closed-form over recorded data, or ship a witness (hitting set with the sets it misses, packing, bracket pair) that the verifier checks in polynomial time; the verifier-side reconcile check is budgeted at about 700 non-test lines per language (NOT VERIFIED). A feature with no witness format is INDETERMINATE (`V6.NO_WITNESS`).
- **INT-140.** `LinkConfig` holds `callsPerNominatedPair = 4` and `maxModelCallsPerCase = 12` (three confirmed pairs); the `locality: "set"` fallback costs 2 per pair. M14 C6 reads these values.
- **INT-141.** Closure of single-valued edges and winners in product views is by valid time, then the rank vector; arrival order enters no product view (test `RC-8.8`). Arrival order is the World Model engine's `conformance` profile only.
- **INT-158.** Add an acceptance ablation row for `ResolverPlugin`: equal-authority disagreement becomes `unresolved` (the claim M12 AB-WM-2 made for the engine).
- **INT-119.** Counterparty-name text is read from the layer by span id (extraction kind `span_ref`); M3 never takes a name string from a model field.


> v5.2 (D-026): profile-pass additions for this module are in `98-profile-pass-additions.md` (adoption register ids; they win over this blueprint where they differ).
