# Integration Register: blueprints 01 to 14 against spec v3.1

Status: design integration pass, 2026-10-13. Nothing here is built or measured. This file is a register of conflicts between the fourteen module blueprints and the architecture spec (`../00-architecture-master-spec.md`, v3.1), the proposed resolution of each, and the exact edits that follow. It changes no other file; the edits it lists are for the module owners and for the spec.

## 0. Method, coverage and how to read this file

**Read in full:** the spec (all sections) and `00-conventions-and-shared-types.md`. **Read for each of the fourteen blueprints:** Scope and contract, the Interfaces table, Spec feedback, What this blueprint does not cover. **Read beyond that, to settle disagreements:** M1 §5 (components 5, 6, 10, 12); M2 DI-01, DI-08, DI-11, DI-13, DI-14, DI-15; M3 components 6 and 14; M4 C1, C2, C3, C5, C8; M5 C1 (interpreter), C8, C9, C13, C15; M6 C7; M7 components 4 to 7, 15; M8 C1, C2, C3, C5, C8, C9, C12, C18, C19; M9 components 2 to 4, 6, 14; M10 C6; M11 E4, E11, E14, E18; M12 C5; M13 components 1, 3, 4, 5, 13, 14; M14 C4, C6, C7, C9. Targeted searches were run across all fourteen files for ports, hashes, offsets, vocabularies and ownership claims.

**Not covered (NOT VERIFIED that this register is exhaustive):** the remaining components of every blueprint were not read line by line. A conflict that lives only inside an unread component, or that two modules both describe without naming the other, can be missing here. Recommended second pass, by pair: M3 against M4 C9 to C11 (subset tables and the evaluator), M5 C3 to C7 against M9 component 10 (recompute module), M13 components 11 and 12 against M1 (monitoring triggers and connectors), M10 C8 to C11 against M2 DI-14 and M9 component 15 (viewer and approval card), M6 C12 to C14 against M12 C2 to C4.

**Severity.** P0: blocks a clean design (two modules cannot both be built as written, or a stated guarantee is false as designed). P1: needs a decision before the owning module is built. P2: wording, vocabulary or a spec sentence.

**Resolution rule, in priority order** (the spec's principles, section 2): trust never rises; models propose and code disposes; failure is visible, never an empty success; nothing is claimed without a test. Where two positions are both sound, the one that makes a stranger's offline check simpler wins, then the one that leaves the fewer owned lines.

**Notation.** "SF n" means item n of that module's Spec feedback (M9 and M8 use F1 and up). "§C5" is a component heading in that blueprint; M1 to M3 use "component n" or "Component n". "Edits" lists what must change; "spec §n" is the master spec.

---

## 1. Conflict register

### Group A: shared vocabulary and types

**INT-001 [P2] Verdict vocabulary (certificates versus verifier).**
Modules: spec §9 and §13; M4 SF1; M7 SF5; M9 §8.4 ("Certificate vocabulary (XPL-07)").
Positions: spec §9 certificates "PASS, INVALID, INCONCLUSIVE"; spec §13 "Verdicts are tri-state"; M4 SF1 "uses the section 13 vocabulary and a mapping"; M9 §8.4 producer status "PASS | INVALID | INCONCLUSIVE", verifier "PASS | FAIL | INDETERMINATE | NOT_APPLICABLE".
Resolution: they are two different things and must not share the word PASS. The verifier verdict is `PASS | FAIL | INDETERMINATE | NOT_APPLICABLE`. A certificate producer's own outcome is renamed `VALID | INVALID | INCONCLUSIVE`. The M9 §8.4 mapping stands unchanged (a re-check that agrees with the producer's outcome is PASS even when the outcome is INVALID; disagreement is FAIL; budget exhaustion is INDETERMINATE).
Edits: spec §9 "Certificates" paragraph and §13 verdict sentence (add NOT_APPLICABLE); M4 C15 (`CertOutcome`); M9 §8.4; M7 component 16 envelope; conventions (new type `CertOutcome`, `Verdict`).

**INT-002 [P2] `Why.kind` has no representation for a human.**
Modules: M7 SF6; M13 §3 (`labeller: kind system|human`); M14 C20 (`decider: code|model|human`); M9 §5.4 (`why_kind` rule | computed | model_reported); M10 C10.
Positions: M7 maps human decisions to `rule` with `ruleId "human.<kind>"` and carries approver text "as an untrusted note"; M9 says only `rule` and `computed` reasons may be rendered as the explanation.
Resolution: a structured human decision (approve, deny, with a code from a closed list) is a `rule` reason with `ruleId "human.approval.<code>"` bound to the signed approval record. Free text from a person is a fourth kind, `human_reported`, stored, labelled untrusted, rendered under "Approver's note, not an explanation", never counted by `explanationCoverage`. The trace additionally carries `decider: code | model | human` (M14 C20).
Edits: conventions `Why`; spec §13 trace bullet; M7 component 14 linter (accept the kind); M9 §5.4 `why_kind` rules; M10 C10 badge set.

**INT-003 [P1] Digest kinds: one `Hash` type is used for three different things.**
Modules: conventions; M1 §8; M2 SF3; M9 F3; M7 component 1.
Positions: conventions "`Hash` hex digest of JCS-canonical bytes, domain-separated"; M1 "bodyHash = sha256(decoded bytes)" (plain); M2 "original document bytes, layer text and span text need a plain SHA-256 ... Add `RawHash`"; M9 "Two digest kinds exist (`rawDigest`, `docDigest`). Also `Evidence.bodyHash` of a non-public body must be a salted commitment".
Resolution: three self-describing textual forms, so a mix-up is a parse failure and not a silent mismatch: `RawHash` (`sha256:<hex>`, reproducible with `sha256sum`), `DocHash` (`jcs:<hex>`, SHA-256 over domain tag, a newline and JCS bytes), `Commitment` (`com:<hex>`, salted, for anything above `public` or low entropy). `Hash` stays as the union for generic fields. Nothing is built, so the textual change is free now and expensive later.
Edits: conventions §Shared types (declarations in section 3 of this file); M7 component 1 `digest` and `digestJson` emit the prefixes; M7 golden vectors; M1 `bodyHash: RawHash` and `parsedHash: DocHash`; M2 drops its private `RawHash`; M9 component 1 and F3; M9 verifier vectors.

**INT-004 [P0] Locator shape and offset unit disagree across four modules.**
Modules: conventions `Locator`; M2 DI-01 and SF1, SF8; M4 §C2 and SF11; M9 SF F5; M10/M2 DI-14 (browser).
Positions: M2 "page-relative code-point offsets over the VISIBLE layer", "No Unicode normalisation of the layer"; M4 "Unicode code points over NFC text (a UTF-16 offset diverges in a verifier written in another language); M2 owns the decision"; M9 "UTF-8 byte offsets into the text layer, plus a closed set of locator resolver kinds"; conventions `Locator {kind, ref, page?, start?, end?, field?, textLayerHash?}` has no unit and no document hash.
Why P0: the verifier core (spec §13 V5), the L0 quote check, the span table and the browser chip each slice the layer; if the unit differs, one of the four silently verifies a different string, which is the exact failure the locator-fidelity benchmark exists to catch.
Resolution: (1) The text layer is not normalised (M2 wins on NFC). M4's requirement is unnecessary because its matcher already keeps an index map from raw positions (M4 §C3); M4 must stop assuming an NFC layer. (2) The canonical locator unit is Unicode code points, page-relative (M2, M4, M10 already agree; the layer, spans, prefix and suffix are defined in code points). (3) A `textlayer` locator also carries `byteStart` and `byteEnd`, UTF-8 byte offsets into the same page text. The offline verifier slices bytes (no Unicode logic), checks the slice equals the quoted bytes, that both ends sit on code-point boundaries, and that the code-point count before `byteStart` equals `start`; any disagreement is FAIL `V5.LOCATOR_UNIT_MISMATCH`. M9's wish (a parser-free, language-neutral slice) is met without moving M2 off code points. (4) The locator names `unit: "codepoint"`, `docSha`, `layerId`, `revision`; the closed resolver kinds `bytes | json-pointer | csv-cell | textlayer` live in the shared type.
Edits: conventions `Locator` (section 3); M2 DI-01 (`DocLocator` gains `byteStart`, `byteEnd`; layer builder emits both; vectors with astral and combining characters); M4 §C2 item 1, SF11 and the "Risks" line (drop NFC requirement); M9 component 6 resolver kinds and V5 algorithm; M9 spec feedback F5 answered; spec §7 (state unit and "no normalisation"); spec §13 V5 wording.

**INT-005 [P1] Span record, span id derivation and what the model sees.**
Modules: M2 DI-08; M4 §C2; M14 C4.
Positions: M2 `SpanRecord`, id `sp_` + first 24 hex of sha256(textLayerHash, page, start, end), model sees per-prompt aliases `⟦nonce:S12⟧`, `spanSha` plain SHA-256; M4 `Span`, id `sp_` + first 16 hex of hash("span", textLayerHash, start, end) (no page), model sees `[sp_xxxx]` lines, `exactHash` over "plumbline.quote.v1" || NFC(exact); M14 C4 renders `[sp_17] text` (content ids).
Resolution: M2 owns `SpanRecord` and the id (24 hex, includes the page, so a span id is unique across pages). M4's `Span` becomes a view over `SpanRecord` for text evidence; structured-field spans (`kind: "field"`, JSON pointer into `Evidence.normalised`) stay M4's, with id `sp_` + hash("span", evidenceHash, jsonPointer). Models see the per-prompt aliases with the per-run nonce (M2), because aliases are shorter and cannot be forged by document text (`SEC-I12`); M4 and M14 prompts call `renderForModel`; the alias map is stored in the cassette. The stored quote hash is `spanSha` (RawHash of the exact UTF-8 bytes); the NFC variant is computed only inside M4's normalised matcher and never stored.
Edits: M4 §C2 items 1 and 2 and `ResolvedCitation.exactHash`; M14 C4 step 2 and C12 prompt slots; M2 DI-08 (no change except exporting the `Span` view); conventions `Citation`.

**INT-006 [P1] Evidence record and label types are under-specified or wrong.**
Modules: conventions `Evidence`; M1 SF6; M4 SF10; M9 F3; M8 F12.
Positions: conventions `Evidence` carries `supports?`, `contradicts?` (relations produced later by M4) and `licence: LicenceStatus` (undefined); M1 asks for `Evidence.use: "decision" | "discovery"`, an id rule that includes `retrievedAt`, and typed errors for erased bodies and replay misses; M4 "those relations ... must live in a derived index keyed by evidence id, not in the immutable record"; M8 F12 "no `join` for confidentiality; add `WriteOrigin` and `ScopedResult`".
Resolution: accept all four. `Evidence` is immutable; `supports`/`contradicts` move to a derived `EvidenceLinks` index owned by M4. `LicenceStatus` is defined as in M1 §1. `Evidence.use` is added (discovery evidence such as Jina can never be cited by a decision-bearing claim; `isDecisionAdmissible` is derived from it). Evidence id includes `retrievedAt` of the network exchange. `FetchState` gains no new member; erasure and replay miss are `FetchError` kinds (`erased`, `cassette_miss`), per M1. `join`, `WriteOrigin`, `ScopedResult` enter the shared types.
Edits: conventions (section 3); M1 §1 (types move to conventions); M4 §C1 (index); M8 C3 and C4 (types move to conventions).

**INT-007 [P1] `CellStatus` cannot say "checked, nothing says"; `Fact` and `Assertion` fields differ.**
Modules: M3 SF1, SF12 and component 14; M5 C16 step 1; M10 C2 criterion K2 ("4 cell" statuses); conventions; spec §8.
Positions: M3 `TruthCellStatus = CellStatus | "silent"` with a "documented projection" back to the shared type; M5 `featurize` maps `unresolved`, `not_checked`, `unavailable` to level 0 and does not mention `silent`; spec §8 `Assertion` lacks `trust`, `conf`, `derivedFrom`.
Resolution: extend the shared `CellStatus` to five values (`resolved | unresolved | silent | not_checked | unavailable`) and delete the projection: a projection that drops `silent` is a place where "absence" turns into "not checked" by accident, which violates principle 4. M5 maps `silent` to level 0 plus a gap (absence of a required positive fact is a hold). M10 gains a fifth cell state. `Fact`, `Gap`, `Cell`-level types and the Assertion fields move to the shared file.
Edits: conventions (section 3); M3 component 14 rule RC-14.6 replaced by "all five statuses are shared"; M5 C16 step 1 table and C2 feature table; M10 C3 status vocabulary (about 45 states becomes about 46); spec §8 `Assertion` line aligned to the shared type.

**INT-008 [P1] Role, scope and audience vocabularies are four unrelated lists.**
Modules: M1 SF5 and `SiloRole`; M13 §15.4 (14 RBAC roles); M10 C16 (MCP scopes `case:read case:submit vendor:reconcile`); M9 §8.4 (bundle tiers `reviewer | auditor-full | auditor-redacted | counterparty-notice`); M4 §C1 (`audience`: reviewer | auditor | counterparty); spec §13, §19.
Resolution: they are different axes and each gets one name. (a) `SiloRole` (5 values: `agent`, `buyer`, `reviewer`, `approver`, `broker`) is the data-access identity; a data table maps each M13 RBAC role to exactly one SiloRole (default `agent` for automated components). (b) `RbacRole` is M13's list. (c) `Audience = "reviewer" | "auditor" | "counterparty"`, and the bundle `disclosure` is `full | redacted | notice`; M9's four tiers are the product of the two. (d) MCP scopes are capabilities of an external client and are not roles. All four are data files with tests, none is inferred.
Edits: conventions (section 3); M1 §15 (accept the mapping table as input); M9 §8.4 manifest `tier` becomes `{audience, disclosure}`; M4 §C1 audience type reused; M13 §15.4 adds the mapping table; M10 C16 unchanged.

**INT-009 [P2] Data-class vocabularies.**
Modules: M14 SF8; M12 (promised mapping not delivered); spec §5, §19.
Positions: spec `public | case-visible | internal-sensitive` plus `personal`; Meterless documents use `public`, `internal`, `confidential`, `restricted` (M14 SF8: "M12 should hold the mapping table"); M12 §C11 and §C13 use only the spec vocabulary and give no table.
Resolution: M12 owns `dataClassMap.json` (foreign class to spec class); any foreign class not in the table maps to `internal-sensitive` (most restrictive). The map is a lock-file input (M8 C10).
Edits: M12 new component C11a; M8 C10 surface lock lists the file; M14 C15 clearance uses the spec vocabulary only.

**INT-010 [P2] Floats versus integer-only hashed documents.**
Modules: M12 SF2; M3 (centi-bits); M5 (bigint, ppm); M6 (integer micros); M7 component 2; spec §4.
Resolution: state once in spec §4: floating point is permitted only in memory (scoring, ranking, estimation) and never in a hashed, signed, recorded or cassetted document. Integer scales are named types so they are not confused: `Ppm`, `Milli`, `Micros`, `Cb`, and money as `MinorUnits` (decimal string).
Edits: spec §4 canonicalisation paragraph; conventions (section 3); M7 PSP schema lint rejects non-integer `number` in hashed schemas.

**INT-011 [P2] Names that collide, and the attack-family count.**
Modules: spec §7, §9, §10, §17; M2 SF2; M4; M5; M8 F10; M9; M11 SF2.
Collisions: `L1` to `L4` (spec §7 locator checks), `L0` to `L4` (spec §9 claim checks), `L0` to `L3` (spec §10 autonomy), M5 `Level 0|1|2` (trust, removed by INT-014), M8 defence rungs `L-off, L1 to L5`, M9 `V0` to `V8` (verifier), M4 `V(S)` (verdict function), M5 judge validator `V1` to `V11`.
Resolution: locator verification `LV1`-`LV4` (M2 already); claim verification `L0`-`L4` unchanged; autonomy ladder `AL0`-`AL3`; defence-ladder rungs `D0`-`D5`; M5 judge-validator checks `JV1`-`JV11`; verifier levels `V0`-`V8` and `V(S)` keep their names (different typefaces of the same letter are acceptable; the verifier levels are always written `V<n>` and the function always `V(S)`). Attack families: the id space is `SEC-I01` to `SEC-I20` with `I18` having nine sub-families (M8 F10); M11's "18" and the spec's "17" are corrected.
Edits: spec §7, §10, §17; M2; M5 C8 and C12; M8 C12 rungs; M11 E14, E18.

**INT-012 [P1] Claim decomposition: extractive pieces (M14) versus generative atoms with a rewrite pass (M4).**
Modules: M4 §C5, SF (shared `Claim` has `parentSpan`, M4 uses `parentRef`); M14 C7 and SF6; spec §9 L1.
Positions: M4 C5 "Decompose (model ...) output schema {atoms: [{text, kind, ...}]}" then "Self-contain ... rewrites each atom"; M14 C7 "Default extractive atoms: each atom is an ordered list of spans of the parent sentence plus entity handles, so the atom text cannot contain a word the sentence did not"; "Needs a `pieces` field the shared `Claim` type lacks".
Resolution: extractive is the default arm (the drift guard is structural, not a post-hoc check); generative SAFE-style decomposition is the control arm that M14 C18 already schedules. M4's guards (drift, coverage, atomicity, dedupe) apply to both arms. `Claim` gains optional `pieces` and `decomposer`; `text` is derived from `pieces` when present. Self-containment for the extractive arm is done by entity-handle substitution (M14 C7), so M4 C5 item 3 applies to the generative arm only. `parentSpan` is replaced by `parentRef: {doc, sentenceIdx}` (M4 §C1) in the shared type.
Edits: conventions `Claim` (section 3); M4 §C5 (two arms); M14 C7 unchanged; spec §9 L1 bullet (name both arms).

### Group B: trust, security, capability

**INT-013 [P1] Trust of a fused (non-monotone) value.**
Modules: spec §5; M3 SF3 and component 8; M8 §C2 item 1 and item 10; M5 C16.
Positions: spec §5 "a derived value takes `combine` over every input it depends on"; M3 "Fact.trust = combine over the winning groups only; defeated or ineligible groups do not taint it (otherwise any attacker-supplied conflicting assertion would downgrade every SOR value: an availability attack)"; M8 C2 item 10 "assert(level(child) <= level(parent) for all parents)" and `derive` requires every parent.
Resolution: M3's rule, with a visible record of what was excluded, so the "drop one parent" mutants (`SEC-L5`) still bite. A fused value's trust is the meet over its supporting inputs (the winning groups, whose content determines the value). Defeated, ineligible and suspect inputs are recorded as `defeats[]` and affect only the cell status, the conflict record and gaps, which are restrict-only. A fused value is never trusted above any input that supports it. `derive` gains an explicit second list (`defeated`) that is required (possibly empty) and hashed into `derivedFrom`; the dynamic invariant in C2 item 10 is restated over supporting parents. Because `fuse` is pure integer code that the offline verifier re-runs, trust is computed there as plain data (`trust` field) and re-asserted at the privileged boundary by `fromStored` (INT-014 shows the matching boundary rule).
Test to add: an attacker-supplied conflicting assertion at `UNTRUSTED` against a `SOR` value leaves the cell `resolved` at `SOR` only if authority rank decides it, and in every case adds a conflict record and, where policy requires, a hold; it never changes the winning value's trust.
Edits: spec §5 sentence on derivation; M3 component 8 stands; M8 C2 items 1, 9, 10 and `derive` signature; M8 `SEC-L5` gains the mutant "drop a defeated parent", killed by a completeness check that every conflicting assertion `fuse` considered appears in `defeats`; M3 component 8 and component 10 emit `supports` and `defeats` with the fact.

**INT-014 [P0] M5 collapses the trust lattice into three levels and loses the permission matrix.**
Modules: M5 §C1 (`type Level = 0 | 1 | 2`) and §C16 step 1; M8 §C1; spec §5.
Positions: M5 maps `SOR` and `VERIFIED` to 2 and `EXTRACTED` and `UNTRUSTED` to 1 ("levels 0 to 2 derived from `TrustLevel`"); M8 §C1 permission matrix: `satisfy_manifest_item` is allowed for `VERIFIED` only if `authorship != counterparty`, `assign_release_field` allows `VERIFIED` only for `accountRef` from an attestation event, `count_independent_support` differs for `EXTRACTED`.
Why P0: a counterparty-authored, self-declared registry field (`VERIFIED`, `authorship: counterparty`) reaches level 2 in M5 and can satisfy a permit condition that M8 forbids. The matrix is enforced in M8 by `use(x, purpose)`, but M5's interpreter is pure data (the verifier's recompute module re-runs it), so M8's runtime check is not on that path. The guarantee "no injection can add permission" has a hole exactly at the policy table.
Resolution: M5's features carry the full label (`trust`, `authorship`, `tier`) and each rule atom names an `ActionClass` from M8's closed list (`needs: ActionClass`); the interpreter decides the atom by looking the (trust, authorship, producer) triple up in `permission-matrix.json`, which is data hashed into the policy bundle and re-interpreted by the verifier. No numeric level exists in M5. `featurize` computes `permits(actionClass)` booleans per field from M8's pure function `permitsClass(label, class)`.
Edits: M5 §C1 (`Level` removed; `needs: ActionClass`), §C2, §C3 (enumeration domain over matrix rows), §C16 step 1; M8 C1 (export `permitsClass` as pure code plus data, versioned in the lock); M9 component 10 (verifier loads the same data); conventions (`ActionClass`).

**INT-015 [P1] M5 has no input for six things other modules assume it consumes.**
Modules: M2 SF9 and DI-05, DI-11; M4 SF7 (`canPermit`); M8 §C6 (`ManifestItem`, `evaluateManifest`); M13 SF5, SF8, SF10; M5 SF7.
Gaps (searched: none of these names appear in M5 or M3): (1) `DocRisk` and `DocFinding` severities (M2), (2) `DocCompleteness` (M2 DI-11), (3) the required-positive-evidence manifest status per item (M8 C6), (4) the claim-label `canPermit` chain flag (M4 C6 item 10), (5) the monitoring overlay `releaseBlock` (M13) and target reversibility (`TargetManifest.reversal`, M13 SF5), (6) approved-but-unexecuted exposure reservations as an atomic API (M5 already consumes the ledger view; M13 owns the reservation call).
Resolution: M5's feature registry (C2) adds `doc.risk.<code>`, `doc.complete.<docType>`, `manifest.<item>.status`, `claim.<id>.canPermit`, `overlay.releaseBlock`, `target.reversible`, and the exposure row set already named. Each is typed, restrict-only (a missing or unknown value is level 0, which can only hold), and has a conformance test. Document findings feed `escalate`, never `reject` (M2 SF9); "no findings" is never clearance.
Edits: M5 §C2 feature table, §C6 invariant I7 (restrict-only monotonicity over the new inputs); M2 DI-05 (severity map shared with M5); M8 C6 (status is a labelled fact M5 reads); M13 §8/§14 (publish `TargetManifest.reversal`); M4 §C6 item 10.

**INT-016 [P0] One release capability, three schemas, three owners, three signed encodings.**
Modules: M8 §C5; M12 §C5.4; M13 component 4 (§6) and SF1; M9 component 4; spec §5, §12, §14a.
Positions: M8 §C5 "M8 owns the capability types, minting rules and `verifyCapability`; M12 owns the Scout adapter ... M13 owns the broker process"; DSSE with payload type `application/vnd.plumbline.release-capability+json`; body fields `payeeId, accountCommit, amountCeilingMinor, approvals[], scout:{...}`; capabilities `["po.release"]`. M12 §C5.4 "The release capability is an `ExecutionContract` with `act/po.release` ... There is no `ReleaseCapability` type with its own signing path. Owner: M12 owns the format, the issuer, the signer interface, `verifyContract`, `consume`"; signed bytes "plumbline/contract/v1\n" + JCS; TTL for `act/` 120 s. M13 §6.4 `ReleaseCapability {tenant, episode, decisionId, stream, action, payee{vendorId, legalEntityKey}, account{refHash}, amountMax, approvalSetHash, audience "broker:<tenant>:<adapter>:<restoreEpoch>"}`, signature over "plumbline.cap/v1\0" || H(JCS(cap)) inside DSSE; proposes M8 owns schema and signer, M13 verification and WAL, M12 the Scout mapping. Nonce consumption: M8 an exclusive-create file per capability; M13 a single-writer WAL with an in-memory index; M12 `ConsumedWal` "M13 implements".
Why P0: spec §12 demands "one capability mechanism with one owner" and the three texts cannot all be implemented; the `Scout` ablation ("removes exactly that mechanism") is not defined until one mechanism exists.
Resolution:
1. **One object:** `ExecutionContract` (the Scout container, spec §12) with `scope.capabilities = ["act/po.release"]` and `scope.release: ReleaseBinding`. The name is `act/po.release` everywhere (M8's "po.release" is corrected).
2. **Owners:** the *container and verify/consume rules* belong to M12 (it must satisfy the vendored Scout harness and the single-mechanism ablation); the *binding contents and the minting policy* belong to M8 (it is the security-critical part and the gate constructs `Approved`); M13 owns the broker, the nonce store and execution-time re-validation. This is M12 §C5.4's split with M8 owning `ReleaseBinding`.
3. **`ReleaseBinding` is the union** of the three field sets: `caseId, tenant, episode, decisionId, payee {vendorId, legalEntityKey}, accountCommit (Commitment), amountMaxMinor, currency, poRef, invoiceRef?, action ("payment.release" | "payment.reverse"), factSetHash, policyBundleHash, listVersions, vendorMasterVersion, approvals[{approvalId, approverSub, approverRole, at, assertionHash}], approvalSetHash, attestationIds[]`, plus the container's `aud` = `broker:<tenant>:<adapter>:<restoreEpoch>`, `nbf`, `exp`, `nonce` (128-bit), `kid`, `sigAlg`.
4. **Signed bytes:** DSSE PAE over the JCS body (M8, M13 agree; it is the same envelope as the ledger, M9). M12's `"plumbline/contract/v1\n"+JCS` encoding is kept only for the HMAC conformance mode, which the broker refuses (`alg_not_allowed`).
5. **Verification pipeline, one order** (M8 `verifyCapability` and M13 `execute` are the same function with two names): envelope and pinned key, then audience and time window, then approvals (distinct subjects, segregation, assertion challenge equals H(body without approvals)), then kill and revocation state, then world re-validation (list, vendor-master and fact-set versions, supersession), then fresh field equality against the ERP via the `broker` silo role, then **atomic consume and intent last**.
6. **Nonce store:** one port, `NonceStore.consumeAndRecordIntent`, owned by M13, with two implementations (single-writer WAL with fsync; exclusive-create file). The M8 tests `SEC-A6` and `SEC-A7` run against both.
7. **TTL:** `act/` contracts 120 s (M12); the approval window and request lifetime are separate clocks (INT-031).
8. **Restore epoch** is part of `aud` (M13 SF7) and of the `restore.epoch` ledger leaf.
Edits: spec §5 "Role-typed release fields", §12 last sentence (name `ExecutionContract` and the three owners), §14a "Execution safety"; M8 §C5 (adopt union binding; drop its own body type), §C18; M12 §C5.4 (accept `ReleaseBinding` from M8); M13 §6.4 (drop its own struct; keep signer-policy text); conventions (`ReleaseBinding`, `ExecutionContract` reference); M9 component 4 role policy `capability` claims format.

**INT-017 [P1] Signer process: key roles, signing policy and who verifies approvals.**
Modules: M8 §C18; M9 component 4 (§6.4); M13 component 15 (§17) and component 4; M12 §C5.4 (`ProcessSigner`).
Positions: M8 keys `CK` (capability), `AK` (attestation), `KK` (kill state), `LK` (ledger); the signer validates WebAuthn approvals over `H(body without approvals)`. M9 `KeyRole = "ledger" | "decision" | "capability"` (the interface table adds `erasure`); capability role requires an inclusion proof of an `approval.granted` leaf in a checkpoint the signer already signed, and a fresh nonce. M13 "signing oracle with policy ... re-verifies the approval records ... and re-checks that factSetHash, list and vendor-master versions are current"; a `KeyPort` for key inventory and rotation.
Resolution: one signer process, one key registry, role set `ledger | decision | capability | attestation | control | erasure`, specified once in M9 component 4 (it already holds the process, rotation leaves and consistency guard) with per-role policies contributed by their owners: capability (M8 C5 plus M13), attestation and control (M8 C4, C14), erasure (M9 component 14). The capability policy is the **conjunction** of: M9's inclusion proof of `approval.granted`; M8's check that each approval's WebAuthn assertion binds to the body; and M13's `G-FRESH` guard, which is evaluated by the case manager before it asks for a signature and again by the broker at execution (the signer cannot read the ERP, and is not given that power; the residual is the one stated in M8 C19). `KeyPort` is the storage and rotation interface behind the signer, not a second signing path.
Edits: M9 component 4 (`KeyRole` set, `SignRequest` union gains attestation, control, erasure); M8 §C18 (defers process and registry to M9); M13 component 15 (KeyPort behind the signer; per-tenant key hierarchy is an extension, see INT-048); M12 §C5.4 `ProcessSigner` is the M9 signer client.

**INT-018 [P1] Write-ahead ordering: three different contracts for "the ledger leaf before the effect".**
Modules: M7 component 15; M9 §5.4 and F6; M13 §7.4.
Positions: M7 "`sync` resolves only when the leaf is covered by a published signed checkpoint" and helper `appendBefore(call, draft)` before an irreversible effect; M9 "durability is cheap and per leaf, publication is per batch and mandatory only where an unpublished leaf would let an effect precede its record": `append` (durable) and a separate `published`; M13 `await ctx.ledger.appendAsync(leaf("action.intent", intent)); // may lag; recover() backfills by WAL seq`.
Resolution: adopt M9's two-call API in M7 (`append` durable, `published` explicit, `streamHead`). Leaves that must be **published before the broker acts** are `approval.granted`, `capability.issued`, `release.intent` (M9 §5.4) and the broker uses M7's `appendBefore`. Result leaves (`action.executed`, `action.confirmed`) may lag with WAL backfill, but the invariant V8 "no `action.executed` without prior `action.intent` and `capability.issued`" is then guaranteed by order of `walSeq`, which the backfill preserves. M13's `appendAsync` for the intent is wrong and is replaced by `appendBefore`.
Edits: M7 component 15 `LedgerPort` (rewrite to `append | published | streamHead`; keep `deferred` for fan-out branches); M9 §5.4 unchanged; M13 §7.4 `execute` code; M13 SF11.

**INT-019 [P1] Network isolation and the Node permission model: consensus on the fact, no consensus on the mechanism.**
Modules: spec §3, §5; M1 SF2 and §9; M2 SF5 and DI-10; M8 F1 and §C8; M12 SF4, SF10, §C11; M14 SF2 and C4.
Positions (all agree on the fact): Node 22 permission model has no network flag; `--allow-net` first appears in Node 25 at Stability 1.1; the model "does not provide security guarantees in the presence of malicious code" (M8 §C8). M1: in-process SAMPLE_MODE guard (`net.Socket.prototype.connect`, `dns.*`, undici) plus `--permission` flags. M8: `CompartmentBackend` probed in order `os-netns`, `node-net-permission`, `node-flags-only`, claim follows the probe. M14: the extractor child has no network, so a parent-side broker forwards exactly one request type. M8 K2 already defines that proxy.
Resolution: M8 §C8 owns the mechanism and the claim; M1's in-process guard is a second, weaker control for our own code paths (it never counts as the compartment claim). M14's broker is M8 K2 (one design, not two). The wording "network denied" appears only next to the probed backend name. Windows judge machine without a container reports `node-flags-only` and the report says so.
Edits: spec §3 and §5 (replace "denied through the Node process permission model" with "defence in depth by process permission flags; network denial from an OS or container backend or Node >= 25; the backend that ran is recorded and the claim follows the probe"), §22 risk list; M1 §9 (guard is not the compartment claim); M2 DI-10 (cites M8 backend); M12 §C11 (four arms use the same backend names); M14 C4 (cites K2, deletes its own broker text); decision record amending D-007 (Node baseline versus Node >= 25, see section 6).

**INT-020 [P1] The network funnel: M1's raw network port, M8's egress funnel, M12's egress tests are three owners; two meanings of "profile".**
Modules: M1 SF11 and components 2, 10; M8 §C3 and F2; M12 §C11, §C13, §C14; M7 §4 (interceptor chain `[schema, egress(M8), capability(M8), budget, <port>, record, label(M8), ledger(M9), trace]`).
Positions: M1 asks M7 for `ctx.net` and `ctx.fs` and owns `egress-manifest.json` keyed per destination with `maxClass` and a disclosure profile `public_lookup | identifier_only | offline`; M8 "The only module that imports network libraries and calls `fetch` is `ports/egress.ts`" with `EgressEntry {sink, hosts, maxConf, disclosures[], profile: sponsor | evaluation | local}`; M12 adds model and Zetaris egress entries.
Resolution: one port, `ctx.net`, implemented in `ports/egress.ts` (M8), invoked by M1's transport pipeline and by the model adapters. M1 owns *how* to fetch (allowlist per channel, SSRF pinning, redirects, size caps, rate limits, retries); M8 owns *whether this may leave* (label check against the manifest) and the manifest schema. One `egress-manifest.json` schema (M8's `EgressEntry`), populated from M1 `SourceMeta`, the model profile and the Zetaris config. The two "profile" words are two axes and are renamed: `modelProfile: sponsor | evaluation | local` and `disclosureProfile: public_lookup | identifier_only | offline`; both are recorded in the run header. The redirect rule is single: redirects are off, each followed hop (OFAC) is re-checked against `hosts` (M8 C3 item 1 equals M1's rule).
Edits: M7 §4 port list (`NetPort`, section 2.2); M1 components 2 and 10 (call `ctx.net`; manifest schema is M8's); M8 §C3 `EgressEntry` gains `disclosureProfile`; M12 §C11/C13/C14 entries use the shared schema.

**INT-021 [P2] The egress claim as worded is false by design.**
Modules: spec §9a "Confidentiality and egress"; M8 F2 and §C3 item 2; M5 SF12; M6 SF6; M1 SF9.
Positions: spec §9a "no value above `public` appears in a query, URL, trace line or external call"; spec §5 declares counterparty names `internal-sensitive` yet every public lookup sends the name; M5 SF12 the judge digest carries case values to a hosted model; M6 SF6 precedent views cross cases.
Resolution: replace with: "no value above its declared egress class leaves, except at declared disclosure parameters, where only the minimised form leaves (LEI or CIK when one exists; name only when no identifier exists); model prompts are an egress sink capped by the model profile; precedent views cross cases only through a whitelist projection with a canary test". Add `identifier_only` and `offline` as selectable disclosure profiles.
Edits: spec §9a row (section 4 of this file); spec §5 confidentiality paragraph; M5 §C8 (judge view egress class entry); M6 §C5 (projection whitelist, canary test); M1 component 10.

**INT-022 [P1] Three definitions of the extraction contract.**
Modules: M2 DI-08, DI-11; M8 §C9; M14 C4.
Positions: M2 `FieldSpec {field, docTypes, labels, valueType, normaliser, required, critical}` and `groundValue(field, value, spans)` returning exact | normalised | ungrounded; M8 `FieldSpec` with closed kinds (`enum` with anchors, `bool`, `int`, `date`, `decimal`, `id`, `span_ref`; "there is no free-string kind") and a justification check per kind; M14 `ExtractionSchema {fields: {id, type: "date"|"amount"|"identifier"|"enum"|"bool"|"span", required, holdRelevant, parser, enumValues}}` with parser/model agreement states. Prompt rendering: M2 aliases, M14 content ids (INT-005).
Resolution: one `ExtractionSchema`, owned by M8 for the *kinds and the validator* (security-critical, closed), by M2 for the *parsers, normalisers and `groundValue`* (document knowledge), by M14 for the *prompt*. The union of fields: M8 kinds, plus `required`, `holdRelevant`, `critical` (M2 and M14 flags, one name `holdRelevant`), `parser: ParserId` (M2 registry), `anchors`. `Extraction`'s agreement states (`agree | model_only | parser_only | disagree`) are M14's and are what M3 consumes as conflict items. The model-call broker is M8 K2 (INT-019). Justification checks run in the parent (M8) on values derived by code from spans.
Edits: M8 §C9 `FieldSpec` stays the normative type; M2 DI-08 and DI-11 re-use it and add parser ids; M14 C4 `ExtractionSchema` replaced by the shared type; conventions (section 3 adds `ExtractionSchema` reference, not its body).

**INT-023 [P2] The web-discovery role.**
Modules: spec §3, §15; M8 F8 and §C8 item 4; M14 C5; M1 comp 18.
Positions: spec §15 lists it as LLM-bearing and quarantined; prior art 12 §8 lets it output candidate URLs; spec §5 says closed grammar, never a URL; M8 "Default decision: the LLM web-discovery role is dropped from the decision path"; M14 C5 "Closed-grammar query selection, gated by the ablation".
Resolution: deterministic query construction is the default; an LLM may only propose `Proposal<DiscoveryQuery>` validated by M8's grammar, and only if M14's ablation shows a gain. The role is conditional in the roster.
Edits: spec §15 roster and §3 diagram text; M14 C1 roster row; prior-art 12 §8 correction note.

**INT-024 [P1] System-of-record trust needs write-origin data that no generator plants and no connector supplies.**
Modules: M8 F4, F14, §C4; M1 SF8; M11 (searched: no `last_write` or `write_origin` plan); M13 SF12; spec §5, §16.
Positions: M8 "Level of a vendor-master field = f(last write event)": `vendor_portal | vendor_email | unknown` is `UNTRUSTED`; M1 SF8 "needs `last_write_origin` columns in the silo contract; spec §16 and M11's generator must plant them"; M13 SF12 "vendor-master editor identity is assumed ... availability in a real ERP is NOT VERIFIED". M8 F14: the payable amount is vendor-authored upstream; ceiling is `min(invoice, PO remaining)`.
Resolution: add `last_write_*`, `change_request_id`, `request_origin`, `editor_sub` columns to the silo contract (M1 §15), plant them in the generator (M11 E2, E3: each bank-detail-change scenario family sets origin and editor), and give M5 `actors.vendor_master_editor` from `editor_sub`. Default-deny stays: a missing column makes the field `UNTRUSTED`. The amount ceiling `min(invoice, PO remaining)` goes into the pack release rules (M5 pack parameters).
Edits: M1 §15 contract; M11 E2/E3 emitters and gold labels; spec §5 "Role-typed release fields" (amount ceiling), §16 (planted columns); M5 pack parameters.

**INT-025 [P2] Kill switch wording.**
Modules: M8 F7 and §C14; M13 component 8; spec §14a.
Position: spec "a kill switch stops in-flight effects"; M8 F7 "holds only before the send boundary; after it the broker reconciles and proposes a reversal".
Resolution: adopt M8's sentence. Spec §14a: "stops effects that have not crossed the send boundary; after it the broker reconciles and may propose a reversal".
Edits: spec §14a; M13 component 8 test names the boundary.

**INT-026 [P2] Plumbline-Inject: two owners, different rungs, different counts.**
Modules: M8 §C12; M11 E14; spec §17.
Positions: M8 "M11 owns the data-generation framework and statistics, M8 owns the families, tiers and oracles"; M11 E14 "Decision: own corpus, oracles and scorer" and ladder rungs `L-off, L1 to L4`; M8 `L-off, L1 to L5` (L5 adds manifest and double extraction).
Resolution: M8 owns families, carriers, payload goals, tiers T0 to T3 and oracle definitions; M11 owns generation infrastructure, held-out commitment, scorer, statistics and reports. Ladder rungs are M8's six (`D0` to `D5`, INT-011); M11 E14 uses them. The positive control `SEC-E2` and the benign-twin rule are shared.
Edits: M11 E14 (cite M8 rungs and family ids); M8 §C12 item 1 (family range `I01` to `I20`).

### Group C: decision, judgement, approval

**INT-027 [P1] Judge ceiling semantics.**
Modules: spec §10; M5 SF1 and §C8; M8 F5; M14 SF5 and C9.
Positions: spec "may only select an action at or below the rule engine's recommended action ... any selection above the least permissive allowed action becomes a human approval item"; M5 SF1 "if the second clause applied to every selection above the minimum of A, a plain confirmation of `release` would need approval"; M8 F5 "the judge can only auto-select the most restrictive allowed action"; M14 C9 `needsApproval = rank(action) > rank(floor)`.
Resolution: M5's reading, which is the restrict-only reading: with recommended action `r` and allowed set `A`, a selection `s ⪯ r` is accepted autonomously (it confirms or restricts), `s ≻ r` with `s ∈ A` is a `judge_loosening` approval item and nothing executes on the model's say-so, `s ∉ A` is rejected. The "floor" notion disappears from M14. The permissiveness order `release ≻ release_with_approval ≻ escalate ≻ hold ≻ reject` is the one in the shared type; it is data in the policy IR (a total order, asserted by a test, used by the verifier). M14's question "which is looser between escalate and hold" is answered by that order.
Edits: spec §10 judgement bullet rewritten as above; M14 C9 (`JudgeInput`, validators, `needsApproval` removed, floor removed); M5 §C8 stands; M8 F5 closed.

**INT-028 [P1] Judge interface and the precedent port: two type families for one boundary.**
Modules: M5 §C8, §C9; M6 §C7 and C5; M14 C9.
Positions: M5 judge input uses short handles mapped back in code ("a fabricated id is inexpressible"), dismissal basis `stale_rule_diff | outcome_unknown | tainted | fact_distinguishable`; M6 §C7 `obligations.mustAddress` with dismissals `rule_changed | fact_differs:<featureKey> | outcome_unverified | tainted`; M14 C9 uses real ids and `RULE_VERSION_DIFFERS | FACTS_DIFFER | TAINTED | OUTCOME_UNKNOWN`. Types: M5 `PrecedentSet {supporting, counter}`, `PrecedentHit.validity "valid" | "stale_rule_diff" | "retracted"`, "tainted" = trust below 2, `unknownShare >= 0.5` weakly informed; M6 `PrecedentRetrieval {support, counters, lead, perAction, informedness, autonomy, excluded, obligations}`, validity states `stale_rule_diff` with a diff, `action_now_forbidden`, `disjoint`, "tainted requires trust UNTRUSTED", `knownShareMin 0.5`. M6 exposes `validateJudgement`; M5 has its own V7/V8.
Resolution: M6's `PrecedentRetrieval` and `validateJudgement` are the boundary types (M6 owns retrieval and the counter obligation); M5 calls `validateJudgement` as checks JV7/JV8 and adds only the handle mapping and the ceiling checks. Handles (M5) are mandatory in model prompts; M14 uses M5's `JudgeInput`/`JudgeOutput`. One dismissal vocabulary, M6's four, with `fact_differs` carrying a feature key. "Tainted" = `precedentTrust` below `VERIFIED` per M6 SF11 (the meet of the policy-relevant fact trust and the outcome-evidence trust), so M5's "level below 2" disappears (INT-014). The weakly-informed rule is `knownShare < knownShareMin` (a strict inequality, one boundary).
Edits: M5 §C9 types replaced by M6's; M5 §C8 JV7/JV8 call M6; M14 C9 input/output replaced; M6 §C7 and C5 publish the exact types as the contract file.

**INT-029 [P1] The approval service has three designs.**
Modules: M5 §C13; M13 component 3 (§5); M8 §C16; M10 C11; M5 SF9.
Positions: M5 `ApprovalItem {type: action | memory_write | rule_proposal | ladder_promotion | judge_loosening | dispensation | roster_change | emergency_ratify, binds, slots, state pending|approved|rejected|expired_denied|superseded|invalidated}` and `ApprovalRecord {approver: ActorBinding, signature}`, "Only the authenticated console API accepts approvals"; M13 `ApprovalRequest {card, factSetHash, requirement, requestExpiresAt, nonce}` and `ApprovalRecord {requestHash, authn: webauthn, assertion}` with the challenge derived from the request; M8 §C16 approver authentication and identity binding; M10 "Approval API: M13 owns". Both M5 and M13 list the queue API as exposed to M10.
Resolution: one service. M13 owns storage, WebAuthn verification, step-up, expiry clocks and the API (it is the case-bound, money-moving path). M5 owns the **item semantics as policy data**: item types, slots and eligibility (`distinctFrom` rules, assurance), what expiry means per type, and the digest binding rule. M8 owns the primitives (`AuthenticatedPrincipal`, identity registry, alias detection). Types: `ApprovalItem` is M5's generalised shape (`caseId?` optional so non-case items fit), `ApprovalRequest` is the case-bound payload of an `action` item, `ApprovalRecord` is M13's (assertion, authn) extended with M5's `slot` and `evidenceOpened`. A person's approval of a memory write or an attestation produces `approvedBy`/`attestedBy` and never a label change (M8 F11, M5 Q8): one test, `SEC-W1`.
Edits: M5 §C13 (types point to the shared definition; queue implementation moves to M13); M13 §5.4 (accept item types and slots); M8 §C16 (primitives only); M10 C11 (card renders `ApprovalItem`); conventions (`ApprovalItemType`, `ApprovalState`).

**INT-030 [P1] Approval waiting: a case state or a runtime interrupt.**
Modules: spec §4 ("human steps as step-boundary interrupts that fail closed"), §14a; M7 component 13; M13 SF1; M10 C17.
Positions: M7 human steps exit the run and resume via `respond()`; M13 "approval waiting is a case state, not an M7 interrupt inside a run" (hours, not minutes; `APPROVAL_PENDING` is a phase; the run ends and a fresh run starts after `world_changed`).
Resolution: M13's position. A decision run ends at `decision.final`; approval waiting lives in the case aggregate (an event-sourced state machine with its own SLA clocks); M7 human steps remain for in-run questions only (for example an `input_required` from a source, or `INPUT_REQUIRED` over A2A). The two are not nested.
Edits: spec §4 human-steps sentence and §14a; M7 component 13 scope note; M5 §C16 (the pipeline ends at `awaiting_approval`); M10 C17 mapping (A2A `INPUT_REQUIRED` only for in-run questions or a `submit-case` skill, see INT-063).

**INT-031 [P2] Approval expiry: what it does, and how many clocks there are.**
Modules: M5 §C13 Q1, SF9; M13 SF3, T12; M8 C16, C17.
Positions: M5 "`expired_denied`; action: case state `hold` with `approval_expired`"; M13 T12 "APPROVAL_PENDING to CLOSED (`rejected` / `expired_unapproved`)"; spec "approvals expire quickly" and "default on timeout is deny"; M13 SF3 three durations: pending-request lifetime, the window `W` among multiple approvals, capability TTL.
Resolution: three named clocks (`requestExpiresAt`, `approvalWindowW`, `capabilityTtl`). Expiry of a pending action item moves the case to `HELD` with disposition `expired_unapproved` and a review timer (M13 T22: "holds are a queue, not a graveyard"), not to `CLOSED`; a held case can be re-requested. M5 Q1's `hold` wording and M13's phase `HELD` are the same state. The single place where expiry loosens (`emergency_ratify` lapse) is M5's, bounded to 72 hours and shown.
Edits: M13 T12 (target `HELD`); M5 Q1; spec §10 and §14a (three clocks); conventions (`ApprovalClocks`).

**INT-032 [P1] `release` at autonomy L2, `release_with_approval`, and what "selective release" certifies.**
Modules: M5 SF2, SF3; M13 SF6; spec §10, §9a.
Positions: M5 "if irreversible actions are capped at L2, no payment is executed without a confirm, so the selective-release bound can only describe a fast lane (single confirm) versus full review"; M13 "for money-moving classes, L2 already implies a human confirm even for `release`"; M5 SF3 "Selective risk does not compose with extra abstention".
Resolution: state it plainly. For money-moving actions `release` at `AL2` produces a one-approver item and `release_with_approval` produces a multi-approver item; "auto-coverage" means fast-lane coverage; the certified statement is conditional on the calibrated region (G2) and the joint rate (G1) can only fall if more cases are abstained. The caution dial moves inside the certified prefix. Reversibility comes from `TargetManifest.reversal` (M13 SF5), not from a model (INT-015).
Edits: spec §10 autonomy and selective-release bullets; spec §9a "Selective-release bound" row (section 4); M13 §4 (`release` at AL2 item); M10 C10 banner text names the region.

**INT-033 [P2] Governance and configuration changes through the rule-change gate.**
Modules: M13 §15.4 ("Changes use the M5 rule-change gate ... for configuration this classification is defined per parameter"); M5 C7, SF10.
Resolution: M5's gate classifies rule bundles by SMT; M13's parameters (TTLs, retention, ceilings, cadences, approver counts) are classified by a **declared direction** per parameter (a `ParamDecl {name, owner, tightenIs: "up" | "down"}` registry, data in the policy stack, hashed). An unclassifiable change is loosening and needs two approvers. Governance roster and tiers are a second policy bundle evaluated by the same interpreter (M5 SF10), so invariants I4/I5 cover them.
Edits: M5 C7 scope sentence; M13 §15.4; spec §10 rule-change bullet.

### Group D: reconcile, explain, memory

**INT-034 [P0] The verdict function V(S) cannot be assembled from the APIs the three modules expose.**
Modules: M3 interfaces table; M4 §C8, SF5, SF6; M5 §C15; M6 interfaces; M9 component 10; spec §9, §13.
Positions: M4 requires `Evaluator {vSpecHash, keys(), deps(key), reads(projection), phase1({present, edits}), phase2(Intermediate, projection), trace}` with eleven obligations (pure, total, fixed key set, sound `deps`, `reads` that include control dependence, per-pair judged edges, as-of, faithful trace). M3 exposes `fuse`, `statusUnder(cell, removed)`, `cellHypergraph`, `reconcileFromEdges`, `robustness(base, verdictOf, cfg)` (needs `verdictOf` and `policy.reads`). M5 exposes `featurize`, `evaluate`, `derive`, `coneOf(bundle, component)`, `fieldDeps`, `flipSearch`. Trace formats differ: M4 `DerivationTrace {nodes: {id: nd_<hash>, fn, fnVersion, reads, value, kind: exo|derived, owner}}`; M5 `Derivation {nodes: DNode[]}` with numeric ids and kinds `feature | atom | rule | combine`. M6 needs `Recompute(snapshot, removed)` from M4, `evaluate(policyVersion, snapshot)` from M5, `reconcile` from M3.
Why P0: exact minimal flips and sufficiency, the core novelty (spec §9), exist only relative to a well-formed `V`; no module owns the composition, and its three halves are specified against different signatures.
Resolution: M4 owns the `Evaluator` interface and the composition (`V = phase2 ∘ phase1`, where `phase1 = M3.fuse ∘ label aggregation (M4 C9) ∘ feature extraction (M5.featurize)` and `phase2 = M5.evaluate`). M3 adapts `fuse/statusUnder/cellHypergraph` into `keys/deps/phase1` per cell; M5 adapts `coneOf/fieldDeps` into `reads(projection)` (declared reads, control dependence included) and `derive` into M4's `DerivationTrace` by a deterministic mapping (content ids `nd_` computed from fn, version, reads, value); M5's richer DAG remains its internal form. `flipSearch` (M5) is the field-level, post-reconcile search and is combined with M4's evidence-level search (M5 §C15 already says "M4 combines it"). `vSpecHash` is the hash of the three halves' versions plus the projection, printed in every certificate. `robustness` is injected `verdictOf` from M4 and `reads` from M5 (M3 SF7 accepted). The verifier recompute module (M9 component 10) interprets exactly `phase1` and `phase2` as data, which is why Stage A (links) is excluded from V (M3 SF8, accepted: fuzzy scores never appear in V).
Edits: M4 §C8 stays normative; M3 interfaces gain `keys/deps/phase1` adapter; M5 §C15 adds `reads(projection)` and the `DerivationTrace` mapping; M5 §C1 `featurize` is the feature half of phase1; spec §9 L4a bullet (name the three halves and the single interface); conventions (`Evaluator`, `DerivationTrace` referenced, bodies in M4).

**INT-035 [P1] "Failure means do not merge" is the permissive direction for screening.**
Modules: spec §8; M14 SF1 and C6; M3 §6 item 3.
Positions: spec "Failure means do not merge"; M14 "For screening matches ... 'do not merge' is the permissive direction: a model `none` would dismiss a hit"; M3 model `none` never produces `different` and a failed call leaves the pair `possible`.
Resolution: M3 already behaves safely (a failed or `none` call leaves `possible`, and `possible` forces escalation via identity robustness), so only the sentence and the application rule change. Spec §8: "A failed or abstaining match leaves the pair `possible`; a model judgement never clears a screening candidate and never alone satisfies a required positive-evidence entry." M14's `applyMatcher(direction, verdict)` is adopted (direction is `screening` or `corroboration`); M3 §6 passes the direction for every candidate set.
Edits: spec §8 cascade bullet; M3 §6 item 3 (direction parameter); M14 C6 stands.

**INT-036 [P1] Select-from-list link judgements break edge locality.**
Modules: M4 SF4 and C8 obligation 5, C9; M3 §6 item 3 and `LinkEdge.inputs`; M14 C6; spec §9 (edge locality).
Positions: M4 "M3's 'select-from-list' link contract (section 8) breaks locality (removing an irrelevant candidate would drop the edge and fabricate a dependence); link judgements must be recorded per pair"; M3 `LinkEdge.model: {shown: Id<"mn">[], choice, orderings: 2}` and `inputs` "exactly the assertions the scorer read" (the model also read the other candidates).
Resolution: the select call only *nominates*. The recorded edge comes from a pairwise confirmation call on (subject, chosen) in both orders, whose `inputs` are exactly the two mentions' assertions; locality is then testable by re-judging with non-cited evidence removed (spec §9). The cost is one extra call per nominated pair, bounded by the per-case ceiling (12 calls, M3 §6). Fallback if budget forbids: record `inputs` as the union of all shown candidates' assertions (conservative; flips may be over-reported and the certificate says `locality: "set"`).
Edits: M3 §6 item 3 and `LinkEdge.model`; M14 C6 (two-stage: nominate, confirm); M4 SF4 closed; spec §8 cascade bullet.

**INT-037 [P1] Dependency cycle among M3, M4, M5, M6.**
Modules: conventions "Module dependency rules"; M3 SF7; M4; M5; M6 (requires `Recompute`, `evaluate`, `reconcile`).
Positions: conventions "M1 and M2 feed M3; M3 feeds M4; M3 and M4 feed M5; M6 serves M5". But M3 `robustness` needs M5's policy and M4's label aggregation; M4 needs M5's evaluator; M6 needs M5's `evaluate`, M4's `Recompute` and M3's `reconcile`, while M5 needs M6's retrieval.
Resolution: break the cycle by splitting M5 and depending on interfaces, not modules. **M5a (policy core):** policy IR, interpreter, feature programs, `evaluate`, `derive`, `coneOf`, `flipSearch`, `revalidate`; depends on nothing above M7/M8. **M5b (decision pipeline):** judge, critics, selective release, autonomy, approval items; depends on M3/M4/M6 and M5a. Then: M3 injects `verdictOf` (M4∘M5a); M4 depends on M5a; M6 depends on M5a, M4 `Recompute` and M3 `reconcile` as pure libraries; M5b depends on M6's retrieval. The dependency graph is acyclic at package level.
Edits: conventions "Module dependency rules" paragraph; M5 §2 (component list split into M5a: C1 to C6, C15 API; M5b: C7 to C14, C16); spec §10 header; build order (section 5).

**INT-038 [P1] Memory must be restrict-only too; recency, outcome double counting, taint definition.**
Modules: M6 SF1, SF2, SF3, SF8, SF11, SF12; spec §11; M5 §C9 P4.
Positions: spec "Tainted precedents are counter-only; autonomy above L1 needs a SOR or VERIFIED precedent"; M6 SF2 "a tainted precedent can counter a hold-leaning lead by arguing for permission ... tainted and unproven precedents are shown only when restrictive-direction; permissive-direction ones are excluded and listed"; M5 P4 "Tainted precedents ... appear only in `counter`".
Resolution: adopt M6 throughout: (1) permissive-direction precedents that are tainted or unproven are excluded from every set and listed under `excluded`; (2) outcomes enter ranking only through the published factor, `feedback()` is reserved for authenticated reviewer verdicts (SF1); (3) recency uses `decidedAt` and is kept only if the precedent ladder measures a gain (SF3); (4) `precedentTrust` is the meet of the policy-relevant fact trust and the outcome-evidence trust (SF11); (5) learning must not loosen from unproven support (L1 rule, SF8); (6) `censored` is permanent for restrictive actions absent adjudication, so "weakly informed" is not fixable by sampling (SF12).
Edits: spec §11 bullets (taint, learning, survivorship); M5 §C9 P4; spec §10 ablation ladder ("plus recency" becomes conditional).

**INT-039 [P2] Exactness statements: retraction order and provenance-retraction acceptance.**
Modules: M3 SF4, SF5; M6 SF4 (P-M6); spec §8 acceptance, §11.
Positions: spec §8 acceptance "provenance-based retraction equals recomputation on every cell"; M3 SF4 "holds only for monotone support; exact retraction of a single-valued cell is a cell-local re-fuse"; M3 SF5 evidence-mass counts are set unions, not additive; spec §11 "exactness holds for the policy and bounded-state stages"; M6 "exact for first order; second order flagged".
Resolution: split the acceptance line in two (monotone support: provenance-expression retraction equals recomputation; defeat: cell-local re-fuse equals recomputation); state the order in the retraction sentence; state that counts merge by set union.
Edits: spec §8 acceptance; spec §11 retraction bullet; spec §9a row "Memory" (section 4).

**INT-040 [P1] Erasure, immutability and recomputation.**
Modules: spec §11, §14a; M6 SF10, M6 C1; M9 F16 and component 14; M13 SF9 and component 14; M1 §8 (`erase`); M5 §C15 risk note.
Positions: spec "episodes are immutable" and "data deletion"; M9 "immutability must mean meaning and digest, not stored bytes; tombstones with `source_erased` and counter-only retrieval"; erasure method `delete+salt-destroy`, crypto-shredding "documented upgrade"; M13 "Own. ... deletion as a governed workflow that ends in a verifiable erasure receipt and crypto-erasure (destroy the per-object data key) so backups are covered"; M6 "erased snapshots make retraction recomputation and validity `unevaluable`".
Resolution: one erasure protocol (M9 component 14: request leaf, hold check, receipt, signer role `erasure`), with `method ∈ {delete+salt-destroy, crypto_erase, tombstone}` in the receipt. The judge-path implementation is salt destruction plus delete; crypto-erasure through per-object keys is M13's stated upgrade and is the method when `KeyPort` DEKs exist. Consequences are named states, not silent: replay `CassetteMiss{reason: erased}`, verifier V5 `INDETERMINATE V5.ERASED`, M6 `unevaluable` for validity and retraction, M5 replay `INDETERMINATE`. Episodes are immutable in id, digest and trust label; the body is a tombstone.
Edits: spec §11 first bullet and §14a "data deletion"; M6 C1 tombstone state and `unevaluable`; M9 component 14 `method` set; M13 component 14 (use the M9 receipt); M1 `erase` returns the M9 receipt hash; M5 §C15 replay note.

### Group E: sources, evidence, documents, replay

**INT-041 [P1] No module produces the bytes of the three hero documents.**
Modules: M1 §1 and component list; M2 §1; M10 C6 (intake: "documents (file picker ...)"); M13 component 2 and `submitCase`; spec §1a, §6, §7.
Positions: M2 "Input: bytes of one document (from M1, which records bodyHash)" and the Interfaces table "M1 (document channel)"; M1 lists connectors 11a to 11i (GLEIF, SEC, OFAC, Wikidata, CourtListener, RSS, direct web, Jina, simulated account verification) and silo rows; the "document lake index" is mentioned once. M10 intake accepts files; M13 `submitCase(req)` and intake caps mention no attachment (searched: none).
Why P1: the hero case is "a document set of an audit, a certificate and a contract"; the path from upload or document lake to `Evidence` with authorship, trust and rights is undefined, and that assignment is a security decision (M8 §C9: counterparty-authored is `UNTRUSTED`, repository-read is `EXTRACTED`).
Resolution: add M1 channel **11j document intake** with three sources and fixed labels: (a) case attachments from M10/M13 intake (authorship `counterparty` by default unless the submitter role declares otherwise in the pack, trust `UNTRUSTED`); (b) internal document lake via `SiloPort` (a `documents` view returning bytes and metadata; `EXTRACTED` ceiling, authorship from repository metadata); (c) web-fetched documents (direct fetch; `UNTRUSTED`, `third_party`). Each produces `Evidence` with `bodyHash: RawHash`, rights class, size and type caps, and hands the blob reference to M2. M13 `submitCase` takes `attachments: {name, mediaType, size, bodyHash}[]` with bytes delivered to the content store by hash; intake caps (count, size, type) are M13's, content checks are M2's.
Edits: M1 component list (11j) and §15 contract (`documents` view); M13 component 2 intake request type; M10 C6 (upload path calls the intake API); M2 §1 (input is a blob ref, not a channel).

**INT-042 [P1] Cassette layering and keys: five notions of a key.**
Modules: spec §4; M1 SF1 and §9; M7 components 5, 6 and SF4; M14 interfaces ("cassette keyed by `canonicalRequest`"); M13 §7.4 (`(adapter, op, idemKey)` plus occurrence index); M9 F12.
Positions: spec "cassettes keyed by effect hash"; M7 "keyed by slot `(branch, step, instance, n, port, op)` and compare the request hash"; M1 transport cassette keyed by `requestKey` below parsing, "M7's effect-level cassette for `source.fetch` stores only `{effectKey, resultHash}` so equality is checked twice; the bytes live here"; M7 hash-only records "cannot replay: a replay that needs one stops with `E_CASSETTE_MISS`"; M1 assumes `cassette_miss` is class `policy`, M7 lists `E_CASSETTE_MISS` as `fatal`.
Resolution: two layers with a defined contract. **Layer 1 (M7):** the effect record for `source.fetch` is `{slot, reqHash, respHash, outcome}` where `respHash` is the DocHash of the canonical `FetchOutcome` *without bodies*, plus the list of `bodyHash` values; `bodyPolicy` for these records is `blob` (bodies in the content store, INT-043), not `hash-only`. **Layer 2 (M1):** the transport cassette (`requestKey`, hop list, headers, body hash) is the recording of the network exchange; in replay M1 re-runs hashing, parsing, trust assignment and evidence building from layer 2 and the result must equal layer 1's `respHash` (equality checked twice, M1's design). Lookup is by slot with request-hash verification (M7), and `requestKey` is an input to `reqHash` for `source.fetch`. `canonicalRequest` (M14) is M7's `normalise(call.req)` for `ModelPort`; M13 target interactions are ordinary `ToolPort` effects. The error class is M7's (`fatal`) with the `RUN_LIVE` hint; M1's text changes. Version selection in replay (M1: latest entry with `recordedAt <= ctx.clock.now()`) uses the virtual clock M7 replays (recorded `at`).
Edits: spec §4 cassette sentence ("keyed by effect slot with request-hash verification"); M1 §9 and SF1; M7 components 5/6 (`source.fetch` record shape); M14 interfaces; M9 bundle `replay/cassette.manifest.json` carries both Merkle roots (F12).

**INT-043 [P1] Three content-addressed stores and two erasure paths.**
Modules: M1 §8 (`cache/blobs/sha256/..`, tombstones, `erase`); M7 `StorePort.putBlob/getBlob` and `bodyPolicy: blob`; M9 §4.4 ("the content store is a separate directory so confidentiality rules differ"); M13 component 14 (per-object DEKs); M8 (content-store rules).
Resolution: one blob store behind M7's `StorePort`, addressed by `RawHash`, partitioned by confidentiality class (`public`, `case-visible`, `internal-sensitive`; separate directories and, later, separate DEKs), with tombstones. M1's evidence blobs, M7's cassette and WAL blobs and M9's bundle bodies are all clients of it. The erasure service (M9 component 14) is the only deleter; M1's `erase` and M13's DEK destruction both call it. The M1 index and evidence JSON files are metadata, not blobs, and stay in M1's cache directory.
Edits: M7 component 21 (`StorePort` contract: partitions, tombstone read error `erased`); M1 §8 (use `StorePort`); M9 §4.4 and component 14 (reference `StorePort`); M13 component 14 (DEK per object per partition).

**INT-044 [P2] Replay classes and the input-sensitivity test.**
Modules: spec §15, F-SAMPLE (§21); M7 SF9 and component 19; M1 §9; M10 C6.
Positions: spec F-SAMPLE "an input-sensitivity test plants mutations and asserts the output diff in replay"; spec §15 "replay on a different input is a `CassetteMiss`"; M7 "input sensitivity of model-bearing stages cannot be shown in replay".
Resolution: state the consequence. Six recorded scenarios (F-SAMPLE) are full replay on recorded inputs. Input sensitivity is tested on **deterministic stages** (class B replay: reconcile from recorded links, rule engine, verifier) on any input, and on the model-bearing stages only live (one novel input in the demo, plus recorded runs per mutated input). A `CassetteMiss` prints the exact command to run a new vendor live.
Edits: spec §21 F-SAMPLE; M7 component 19 stands; M10 C6 message text.

**INT-045 [P2] REST, JDBC and MCP: which is primary.**
Modules: spec §6, §19 ("REST and JDBC are the primary paths"); M1 SF4 and components 13 to 15; M12 C13.
Positions: M1 "The vendor JAR is not on Maven and needs a JDK ... REST is the live path, JDBC a record-time transport and typing oracle, replay is the judge path."
Resolution: adopt M1's wording. Primary live path: REST. JDBC: record-time oracle for type decoding and the differential test. MCP: fallback (roadmap gate unchanged). Judge path: cassettes. Everything stays NOT VERIFIED until a trial account exists.
Edits: spec §6 MCP paragraph and §19 Zetaris bullet; M12 C13 states the same.

**INT-046 [P1] Who owns the silo schemas: M1's contract or M11's emitted schemas.**
Modules: M1 §15 (`SiloContract`, `contractHash`, drift detection); M11 E1 build notes ("the SUT's own silo loaders (M1) are built against its emitted schemas, not vice versa"), E2 ("Shape is defined by M1's connector schemas, so E2 reads schemas, not code"), Interfaces ("the SUT validates against generator-emitted schemas, not the reverse").
Resolution: the **contract** (tables, columns, types, `conf`, `personal`, `last_write_*`, views, masks, roles) is a product artefact owned by M1 and hashed (`contractHash`); the **generator** reads it (`contractHash` recorded in `gen-manifest.json`) and emits data that conforms, plus planted violations declared as labelled deviations. Independence is preserved because the generator never imports system code, only the contract file; the circularity audit (M11 E6) checks that no label derives from the contract's rules. Registry body shapes remain defined by M1 connector schemas (M11 E2 already reads those). The "not vice versa" sentence in M11 is withdrawn.
Edits: M11 E1 build notes and Interfaces row; M11 E2 (read `contractHash`); M1 §15 (publish the contract as a stable file path).

**INT-047 [P1] Two document-corpus generators.**
Modules: M2 DI-12, DI-13; M11 E4, E15 (S4); spec §7, §16, §17, build order step 11.
Positions: M2 DI-13 specifies PLD-1 (G1 born-digital via Chromium, own writer, Typst; G2 degraded; H-series 22 techniques; S-series signatures via pyHanko in the evaluation tier; truth in `truth.json`); M11 E4 specifies the glyph-truth corpus (pdfkit, typst, a rasteriser path; `GlyphTruth {page, box, codepoints, visible, layer}`; variants including signed documents).
Resolution: one generator, owned by M11 E4 (independence from system code, seeded RNG exception, independent review, regeneration check). M2 DI-13 is demoted to the **requirements document** for it: technique list, series, counts, truth schema (`truth.json` with integer milli-point boxes), cluster-based splits. The typesetter set is decided by the spike E4 already plans (pdfkit, Typst, Chromium, own writer) and recorded in `DECISIONS.md`. M2 DI-12 keeps the locator-fidelity metrics and the harness; M11 S4 reports them.
Edits: M2 DI-13 retitled "Corpus requirements"; M11 E4 adopts the series and truth schema; spec §16 and §20 step 11 text (one generator).

### Group F: audit, ledger, verifier

**INT-048 [P1] Ledger tree per deployment or per tenant; tenancy touches every port.**
Modules: M9 §4.4 ("One log per deployment"); M13 SF2 and component 13 ("the unit of isolation is a tenant namespace (separate directory, ledger tree, WAL, evidence store, key hierarchy)"; "`TenantCtx` ... required by every port"; "Every storage key, cache key, cassette key, trace attribute and ledger stream name is prefixed `tn_<id>`"); M7 (no tenant concept in `Slot`, `StepCtx`); spec §14a "designed now, built after the core".
Resolution: per-tenant trees (erasure, key rotation, disclosure and isolation are cleaner; M13's SCITT reference lists "tenant split" as a chain failure). The judge path runs exactly one tenant, `tn_default`, so nothing is lost. To avoid retrofitting (M13 §15.7 "Design the tenant prefix into every store from the first line of code"), `tenant` is a required field of `StepCtx`, of the effect `Slot` (not part of the hash when equal to the default, to keep vectors stable), of `LeafV1`, `LedgerPort`, `StorePort` names and cassette headers. `TenantCtx` is a branded value from M8's forged-object mechanism.
Edits: M9 §4.4 (log identity `<ns>/ledger/<deploymentId>/<tenantId>`), §6 (key registry per tenant); M7 components 4, 5, 15 (tenant field); M13 component 13; conventions (`TenantId`).

**INT-049 [P1] Ledger leaf vocabulary, stream scheme and actor kinds.**
Modules: M7 component 15 (`LeafDraft`); M9 §4.4/§5.4 (`LeafV1`, registry); M13 SF11; M7 SF7.
Positions: M7 `LeafDraft {stream: case:..., subjectDigest, payloadDigest, actor.kind: system | human | model}`; M9 `LeafV1 {type, stream: deploy | policy | memory | case:.. | hold:.. | erasure, seq, prev, subject, payload, attrs, idk, actor.kind: system | role | human | service}`; M9 registry names `release.intent`/`release.result`; M13 names `action.intent`, `action.executed`, `action.confirmed`, `action.not_sent`, `action.reversed`, `approval.invalidated`, `freeze.engaged`, `restore.epoch`, `access.audit`, `erasure.receipt`, `incident.*`, `hold.*`, `case.migrated`; M7 SF7 "Not every effect is a ledger event".
Resolution: M9's `LeafV1` and registry are normative; M7's `LeafDraft` is a subset constructor (`stream` any M9 stream, actor kinds the M9 four; `model` is not an actor kind because models write nothing, they propose). M13's names replace M9's `release.*` (`release.intent` to `action.intent`, `release.result` to `action.executed` plus `action.confirmed`) and are added to the registry with their write-ahead or result tags. M7 SF7 accepted: every ledger-relevant effect has a leaf, every leaf has a WAL origin, every effect is covered by the `run.manifest` leaf through the cassette digest.
Edits: M9 §5.4 registry table; M7 component 15 types; M13 SF11 closed; spec §13 "Ledger" bullet.

**INT-050 [P1] Policy IR as data versus the verifier's size, and the bake-off 2 decision rule.**
Modules: spec §13, §19a-2; M5 §C1 (interpreter 400 to 600 lines), §C5; M9 F9 and component 10; M5 SF6.
Positions: M9 F9 "V6 to V8 are possible only if the policy IR and the reconcile kernel are small data languages. Bake-off 2's decision rule should include 'interpretable by a verifier-side evaluator of about 500 lines in three languages'; if Cedar or OPA wins, ... a cost statement"; M5 C5 measures owned non-test lines, expressiveness, provability, speed; M5 SF6 proposes `FeatureProgram` data and a level `V6a` "view recomputed from recorded facts".
Resolution: add "verifier-interpretable" as a **gating criterion** in bake-off 2, not a tie-breaker: a candidate that cannot be interpreted by a dependency-free evaluator in two languages (about 500 lines each, differential vectors) cannot be the *normative policy format of a bundle*. If Cedar or OPA wins on expressiveness it is adopted as an authoring front-end or CI cross-check (as spec §10 already does for Cedar SymCC), with PPIR as the bundle format. V6a is added: feature values recomputed from recorded facts via declarative `FeatureProgram`s.
Edits: spec §19a item 2 decision rule; M5 §C5 criteria; M9 component 10 and spec §13 V6 to V8 list (V6a).

**INT-051 [P1] Verifier structure: zero-dependency core, browser, rights-gated PDFs.**
Modules: spec §13, §14; M9 F1, F13; M10 F1, F2; M7 SF8.
Positions: spec "standalone verifier core ... has zero dependencies" including V4 anchors; M9 "V4 needs DER/CMS parsing and Bitcoin header handling ... V4a stays in the core; V4b is a separate zero-dependency file"; M9 F13 "Rights-gated PDF evidence cannot reach V5 offline in evidence mode (text extraction is parser code the zero-dependency verifier does not carry)"; spec §14 "the browser re-hashing document, text layer and span ... and the standalone verifier agrees"; M10 F2 "the page can run only the verifier core module"; M7 SF8 core "must validate bundle members against schemas" so a restricted dialect (PSP).
Resolution: (1) core = V0 to V4a plus V5 for parser-free locators plus V6 to V8 by the recompute module; V4b (anchors) is a separate file. (2) Rights-gated PDFs can reach `V5` only through the layer (`textlayer` resolver); "can PASS offline" is restricted in the spec to sources with parser-free locators (raw byte range, JSON pointer, CSV cell, text-layer range). (3) The page runs the core in a worker and reports two results: the page's recomputation and the bundle's recorded verifier report; a disagreement is an alert, not a green chip. (4) PSP: a restricted schema dialect with a ~250-line interpreter in the core, differential-tested against the pinned validator.
Edits: spec §13 core/anchors split, "rights-gated sources can PASS offline" sentence, §14 evidence viewer sentence; M9 components 9, 15; M10 C8; M7 component 3 (PSP is a deliverable).

**INT-052 [P1] Evidence package layout, rasters and chip states.**
Modules: M2 DI-14 and SF10; M9 §8.4 and component 15 (`chipState` returns `green | amber | red`); M10 F2, F3, C3 (chip set of 8).
Positions: M2 members `evidence/<docId>/{source.pdf, layer.txt, layer.geo, manifest.json, spans.json, findings.json}` and ten states including `layer-only (source not shipped)`, `extractor disagree`; M9 layout `evidence/index.json`, `evidence/blobs/sha256/..`, `evidence/stubs/..` (no `spans.json`, no layer role); M9 `chipState(...)` colour result; M10 eight chip states, no `layer_only` or `extractor_disagree`; M10 F3 wants per-page PNG rasters at 144 dpi and quads as hashed derived artefacts carried in the bundle; M2 does not list raster export.
Resolution: M9's layout is normative (content-addressed blobs plus index). M2's members become **derived member roles** under `evidence/derived/<docId>/` (`layer.txt` is the blob with role `textlayer`; `spans.json`, `findings.json`, `manifest.json`, `layer.geo`, `pages/<n>.png`) with their own hashes in `bundle.json`; rasters and quads are display aids outside the verified chain (M10 F3) but hashed. `chipState` returns a named state (never a colour); M10 owns colour and icon. The state set is M2's ten, which M10 adopts, with `layer-only` as a first-class state (M2 SF10).
Edits: M9 §8.4 `MemberRole` and layout; M9 component 15 return type; M2 DI-14 adds raster export and uses derived roles; M10 C3 chip set and C8.

**INT-053 [P2] Verifier wording: re-sign, replay equality, log currency.**
Modules: M9 F2, F4, F15; spec §13, §4, §9a.
Positions: spec "re-signing a bundle with a fresh key (expected INDETERMINATE)"; M9 "That is right only without relying-party pins. With pins it is FAIL (`V2.SIGNER_NOT_PINNED`)"; spec §4 "same normalised trace and final state hash"; M9 "Replay equality cannot include global ledger indices or the tree root"; M9 "a bundle is a statement as of one checkpoint".
Resolution: carry both rows for re-sign; define replay equality over each stream's leaf sequence and head leaf hash (never global indices); add the log-completeness row to §9a.
Edits: spec §13 tamper-corpus sentence, §4 replay sentence, §9a (section 4); M9 corpus rows.

**INT-054 [P1] Trace schema: four modules add fields to the same record.**
Modules: M7 component 14 and SF12, SF13; M9 F14 and §5.4 (`prevLineHash`, `why_kind` lint); M10 F10 (`phase` 1 to 7, `agent` lane, closed `verb`, budget snapshot); M14 C20 (`decider`, event types).
Resolution: M7 owns one trace schema with all additions as required or optional fields decided now: `prevLineHash` (hash chain), `why_kind`, `decider`, `phase`, `agent`, `verb` (closed vocabulary registry), `budget` snapshot, `tenant`. The OpenTelemetry GenAI projection is best effort with a `semconv_version` field; "normalised trace" is defined in M7 component 14 and referenced from spec §4. The linter requires `ruleId` for `rule` lines and a registered function id for `computed` lines (M9 F14).
Edits: M7 component 14; spec §4 and §13 trace sentences; M9 §5.4; M10 `UiTraceEvent` references M7's type; M14 C20 events table registered as verbs.

**INT-055 [P2] Audience tiers: delivery and names.**
Modules: M10 F14; M9 F10; M4 §C1; spec §13.
Positions: spec "counterparty (reason code only ...)"; M9 "this is a signed notice, not a bundle"; M10 "nothing designs delivery to a counterparty. M10 provides only a reviewer-side preview with a leakage test".
Resolution: a counterparty receives a **signed notice** (M9) containing a reason-code class and nothing else; delivery is outside the product's first release and is a LAWYER item. The reviewer-side preview with a leakage test (planted `internal-sensitive` values never appear) is the M10 deliverable. Names follow INT-008.
Edits: spec §13 audience bullet; M9 component 13 table; M10 C12 preview.

### Group G: runtime, process, evaluation

**INT-056 [P1] Ports M7 must add (collected from all modules).**
Modules: M1 SF11; M2 interfaces; M6 SF13; M7 SF1; M8; M9; M10 F11; M12 SF3; M13; conventions "A module that needs a new effect type proposes it to M7".
Resolution: the full list, owners and signatures are in section 2.2. Summary: `NetPort`, `FsPort`, `SandboxPort`, `SyncJournal`, `SecretIdsPort`, `SignerPort` (client of M9's signer) and `KeyPort`, `AuthorizePort`, the kill-state interceptor, `MemoryStorePort` as a mode of `StorePort`, a tenant field on every port, and the four ports M7 already added (`scheduler`, `store`, `ledger`, `human`). M7's determinism lint (forbidden globals outside `src/runtime/adapters/**`) is the control that forces every effect through these.
Edits: spec §4 port list; M7 component 4 `Ports`; conventions "Pseudocode style" sentence ("`ctx.rng` is a kernel service derived from the seed, not a recorded port"); each requesting module's "Requests" row points here.

**INT-057 [P2] Spec §4 ownership statements.**
Modules: M7 SF2, SF3, SF4, SF10, SF14; spec §4, §19a-1, §20.
Items: (a) the write-ahead effect log belongs to the effect layer, not the substrate, and must exist before bake-off 1 (spec step 3, not 5); (b) typed state and `commit` are a pure kernel function every substrate calls; (c) cassette key wording (INT-042); (d) the graph model is series-parallel with bounded loops and a pack needing more extends the compiler; (e) bake-off 1 pre-registers a judge-run screen (Temporal fails it: its testing package downloads a server; XState passes and is added as a fourth candidate); (f) the harness and broken drivers are part of step 3.
Edits: spec §4 paragraph on ownership, §19a-1, §20 steps 3, 3a, 4, 5.

**INT-058 [P2] Budget guarantee is conditional; reasoning tokens.**
Modules: M7 SF11; M14 SF11, SF10; spec §4, §9a.
Resolution: state the condition: total provider-reported usage never exceeds the budget provided the estimator upper-bounds actual input usage and the provider enforces `max_tokens`; the reservation caps reasoning tokens explicitly; repeatability of sampling is a property of cassettes only. Add a §9a row (section 4).
Edits: spec §4 budget sentence, §15 profiles sentence; M14 C14/C15; M7 component 7.

**INT-059 [P1] Pre-registration versus the 22 October commit gate; "committed first".**
Modules: spec §15 ("pre-registered before any run (committed first)"), §20 step 13; M11 SF4 and E11; project CLAUDE.md commit window.
Positions: M11 "Before the window nothing is committed, and a local hash chain with a self-reported clock is not independent evidence of ordering, so any pre-window run is exploratory by definition."
Resolution: accept M11. A run is *confirmatory* only if its pre-registration was publicly committed after 22 Oct 00:00 UTC (or hash-anchored externally) before the run starts; the report header says so. Hashing a pre-registration to an external timestamp service reveals only a hash and is compatible with the gate, but it is ledger stage 2 (roadmap) and not assumed. Ask the organizers in writing (F-PROCESS) whether external hash anchoring before the window is acceptable (section 6, D5).
Edits: spec §15 sentence and §20 step 13 gate; M11 E11 stands; M14 C18.

**INT-060 [P1] `ArmSpec` and `PreReg` are defined twice.**
Modules: M11 E11, E18; M14 C18 and interfaces; M4 SF14.
Positions: M11 `Prereg {hypotheses, confirmatoryFamily, arms, models, data, analysis, decisionRules, disconfirmation, budget, deviations}` and `ArmSpec {roles, model, tools, gate, tokens, switches, layers}`; M14 `PreReg {hypotheses, arms, metrics, margins, sample, families, correction, analysisCodeHash, decisionRule}` and `ArmSpec {overrides, tokenMatch: {to, tolerance 0.05}}`. M14's interface table says `PreReg`, `ArmSpec` are "M14 provides, M11 consumes".
Resolution: M11 owns both schemas and the runner (it owns statistics and the ledger of pre-registrations). M14 supplies the **role-specific content**: the role registry, per-role arm overrides expressed in M11's `ArmSpec.roles`, per-role metrics, and the hypotheses H1 to H5 text. `tokenMatch` becomes M11's `tokens.policy` with the primary (`match_item` or `match_median`) named in the pre-registration (M11 SF9). M4's ablations (span gate C6, advocate/skeptic C7, argumentation C14, locality-violation measurement) are added to the registered arms (M4 SF14).
Edits: M14 C18 and interfaces; M11 E18 (accept role overrides); spec §15 hypotheses paragraph.

**INT-061 [P2] Statistics and evaluation wording.**
Modules: M11 SF1, SF5, SF6, SF8, SF10; M5 SF3, SF8; spec §10, §15, §17.
Items: (a) "worst of three runs" is descriptive; E10 defines `worst_run`, `pass^3` and run-mean inference, never used in a test; (b) the 1,000 independent generator draws apply to the rule-brain claim, with fewer draws for any model-scored claim; (c) 246 and 385 are for independent items and are multiplied by a design effect and need stratified generation at low prevalence; (d) the second human reviewer is a stated need; "generator reviewed independently" is accepted as `partial` until a human signs; (e) counterfactual evaluation of rules is evaluable for tightening from logs and `unevaluable` for loosening without exploration; the demo claim "evaluate any rule" is narrowed.
Edits: spec §10 selective-release and counterfactual bullets, §15 corrections paragraph, §17 first paragraph, §21b M11 row.

**INT-062 [P2] Engine and sponsor wording.**
Modules: M12 SF1, SF6, SF7, SF8, SF9, SF11, SF12, SF13; M1 SF10; M3 SF6; M6 SF7, SF9; M2 SF13; M14 SF4.
Items: (a) bake-off 6 rule "most" is replaced by M12 §C6's measured rule with from-spec as tie default; (b) engine auto-merge is disabled in the product profile and name similarity only proposes ("Series A Holdings" versus "Series B Holdings" scores 0.9412 by the reference formula, M12 SF6); (c) the typed Markovian profile is an extension and the conformance claim covers the `conformance` profile only; (d) the H-MEM ledger head is anchored into M9, a hash chain over H-MEM entries is added only so the head means something; (e) the World Model's built-in conflict policy is conformance behaviour and M3's `ResolverPlugin` is the product policy; (f) the engine requirements R-WM1 to R-WM4 and H-MEM requirements from M6 SF7 and SF9 are added to bake-off 6; (g) M12 module row renamed "Sponsor adapters and evidence" with Cursor as an evidence trail owned by the submission kit; (h) the Zetaris audit-log cross-check is worded MAYBE until a read path exists; (i) the "OpenAI-compatible" NVIDIA claim stays NOT VERIFIED beyond the base URL and path; Tesseract.js is not a Nemotron path and the judge OCR default is classical; (j) vendoring needs byte-integrity rules (`-text`, `.gitignore` exception for `*.jsonl`).
Edits: spec §12, §15 profiles paragraph, §19, §19a-6, module table row M12.

**INT-063 [P2] Interface-adapter items from M10.**
Modules: M10 F4, F5, F6, F7, F8, F9, F12, F13, F15, F16, F17.
Items: (a) a policy `reject` is a completed A2A task; A2A 1.0.0 states are `TASK_STATE_*`; (b) a fourth A2A skill `submit-case` for parity with the MCP tool or drop approvals from the state table; (c) the CLI list adds `serve`, `view`, `bundle`, `status`, `mcp`, `a2a` and the F-STAGES entry points; (d) policy time travel sits behind a `labs` flag until its roadmap gate passes; (e) approval expiry meets WCAG 2.2.1 and 3.3.8; the essential-exception argument is NOT VERIFIED and needs an accessibility review; the demo needs a labelled simulated identity provider with distinct subjects; (f) evidence-first approval is a design hypothesis with a pre-registered reversal rule; (g) a console view-layer bake-off is added to §19a; (h) mobile approval is supported and tested; (i) `jsdiff` is not needed; (j) conformance runners named: MCP conformance framework, A2A TCK and inspector; (k) the M10 acceptance gate G-M10 is adopted into §21b.
Edits: spec §14, §19a, §21a (time travel), §21b.

**INT-064 [P2] Evaluation housekeeping.**
Modules: M11 SF3, SF7, SF10, SF11, SF12.
Items: (a) the generator carries its own seeded RNG as an explicit exception to "all randomness behind `ctx.rng`", with byte-equal regeneration as the substitute control; (b) the natural-versus-legal-person result on real list names is run in the uncommitted tier and published as aggregates, so a judge cannot reproduce it, and the spec says so; (c) `eval/runs/` for raw stores and `eval/reports/` for rendered reports; (d) dataset availability for truth-discovery and entity-resolution anchors is partly verified (Li et al. datasets carry no stated terms).
Edits: conventions "Pseudocode style" (rng exception); spec §16 and repository map.

**INT-065 [P2] Batch of spec wording corrections (no design change).**
Each line is an edit to the spec text; the originating feedback item is in brackets.
- §2 principle 1 "A citation is a proof, not a pointer" to "a citation is checkable" [M4 SF2].
- §7: "sanitiser" becomes "visibility filter" (exclusion plus signal; the layer never rewrites) [M2 SF12]; the OCR sentence: on a scan page the visible layer is our OCR, the native invisible layer is compared and never used as evidence [M2 SF4]; Docling fixtures give structure hints re-anchored into our layer and never locators [M2 SF7]; name `@embedpdf/pdfium` as a bake-off 4 candidate and record that pdf.js `stopAtErrors` is set to true [M2 SF6]; acceptance "sanitiser flip rate" defined as decision-flip rate with visibility enforcement on versus off [M2 SF11]; document findings feed `escalate`, never `reject`, and no finding is never clearance [M2 SF9].
- §8: name the rank vector of M3 component 8 in "resolution is a pure function" (adds trust eligibility, authorship, freshness guard) [M3 SF2]; unknown origins: inference may only lower independence counts [M3 SF9]; the nomenklatura invariant correction in `prior-art/07` §12 [M3 SF10]; OpenSanctions Pairs licence discrepancy logged in `docs/intel/06` [M3 SF11].
- §9: L0 gains `outside_span` and `quote_too_short`, and `near` is a warning, not a pass [M4 SF3]; the gap ledger caps confidence only on relevant or unknown-relevance gaps, not on gaps proven irrelevant within the declared domain [M4 SF8, SF13]; Halpern-Pearl is justified by degree and witness only, since MRS classes already separate overdetermined evidence [M4 SF9]; labels from counterparty-only support are `entailed` only in reported form (`self_declared_only`) [M4 SF12]; the `UNTRUSTED` label chain cannot permit [M4 SF7].
- §10: invariants I1 to I9, not I1 to I6 [M5 SF4]; exhaustive enumeration "within the enumerable fragment" [M5 SF5]; `unknown` and timeout in the gate classify as loosening and the availability cost is reported [M5 SF14]; the judge is not skipped for precedent purposes (one M6 call per decision) [M5 SF11]; stack layers cannot express a law that forces a more permissive behaviour (LAWYER) [M5 SF15].
- §14a: outcome labels from an evidence-backed human finding are `VERIFIED`, unsupported human assertions are `UNTRUSTED` notes [M13 SF4]; kill switch, approver authentication and key custody get components with test ids, not only residual-list entries [M13 SF13]; monitoring is repository depth and not demo content [M13 SF14]; restore epoch rule [M13 SF7, in INT-016].
- §15: the critic rubric gets one advisory revision, separate from deterministic-failure reflexion (at most two retries) [M14 SF3]; the roster adds the L2 entailment judge and the plan augmenter [M14 SF7]; panel aggregation: permissive labels need unanimity plus an L0-verified deciding span, any verified dissent downgrades to at least `contested` [M14 SF9]; repeatability is a property of cassettes only [M14 SF10]; prompt file naming gains a lock file [M14 SF12].
- §6: OFAC remarks are `UNTRUSTED` and that is acceptable because sanctions evidence only restricts [M1 SF7]; the 29 MB figure refers to `SDN.XML` and the list version comes from the XML header plus a content hash [M1 SF3]; truth-discovery dataset availability [M11 SF12].

### 1b. Spec-feedback disposition index (every item of every module, mapped to the register)

An item mapped to "section 4" is a guarantee-table row; to "section 5" a build-order correction; to "D n" a decision for Prateek in section 6. Items are cited as in each blueprint (M8 and M9 use F1 and up).

- **M1** SF1 INT-042; SF2 INT-019; SF3 INT-065; SF4 INT-045; SF5 INT-008; SF6 INT-006 and INT-003; SF7 INT-065; SF8 INT-024; SF9 INT-021; SF10 INT-062; SF11 INT-056.
- **M2** SF1 INT-004; SF2 INT-011; SF3 INT-003; SF4 INT-065; SF5 INT-019; SF6 INT-065; SF7 INT-065; SF8 INT-004; SF9 INT-015 and INT-065; SF10 INT-052; SF11 INT-065; SF12 INT-065; SF13 INT-062.
- **M3** SF1 INT-007; SF2 INT-065; SF3 INT-013; SF4 INT-039; SF5 INT-039; SF6 INT-062; SF7 INT-034; SF8 INT-034; SF9 INT-065; SF10 INT-065; SF11 INT-065 and D6; SF12 INT-007.
- **M4** SF1 INT-001; SF2 INT-065; SF3 INT-065; SF4 INT-036; SF5 INT-034; SF6 INT-034; SF7 INT-015 and INT-065; SF8 INT-065; SF9 INT-065; SF10 INT-006; SF11 INT-004; SF12 INT-065; SF13 INT-065 and section 4; SF14 INT-060.
- **M5** SF1 INT-027; SF2 INT-032; SF3 INT-032 and section 4; SF4 INT-065; SF5 INT-065 and section 4; SF6 INT-050; SF7 INT-015; SF8 INT-061; SF9 INT-031; SF10 INT-033; SF11 INT-065; SF12 INT-021; SF13 INT-028; SF14 INT-065; SF15 INT-065 and D8.
- **M6** SF1 INT-038; SF2 INT-038; SF3 INT-038; SF4 INT-039; SF5 section 4; SF6 INT-021; SF7 INT-062; SF8 INT-038; SF9 INT-062; SF10 INT-040; SF11 INT-038; SF12 INT-038; SF13 INT-056.
- **M7** SF1 INT-056; SF2 INT-057; SF3 INT-057; SF4 INT-042; SF5 INT-001; SF6 INT-002; SF7 INT-049; SF8 INT-051; SF9 INT-044; SF10 INT-057 and section 5; SF11 INT-058 and section 4; SF12 INT-054; SF13 INT-054; SF14 INT-057.
- **M8** F1 INT-019; F2 INT-021; F3 INT-016; F4 INT-024; F5 INT-027; F6 INT-014; F7 INT-025; F8 INT-023; F9 INT-016; F10 INT-011; F11 INT-029; F12 INT-006; F13 INT-059; F14 INT-024; F15 section 4.
- **M9** F1 INT-051; F2 INT-053; F3 INT-003; F4 INT-053; F5 INT-004; F6 INT-018; F7 INT-017; F8 D1; F9 INT-050; F10 INT-055; F11 D1; F12 INT-042; F13 INT-051; F14 INT-054; F15 INT-053 and section 4; F16 INT-040; F17 section 5.
- **M10** F1 INT-051; F2 INT-051; F3 INT-052; F4 INT-063; F5 INT-063; F6 INT-063; F7 INT-063 and D9; F8 INT-063; F9 INT-063; F10 INT-054; F11 INT-056; F12 INT-063; F13 INT-063; F14 INT-055; F15 INT-063; F16 INT-063; F17 INT-063.
- **M11** SF1 INT-061; SF2 INT-011; SF3 INT-064; SF4 INT-059; SF5 INT-061; SF6 INT-061; SF7 INT-064; SF8 INT-061 and D3; SF9 INT-060; SF10 INT-061; SF11 INT-064; SF12 INT-064.
- **M12** SF1 INT-062; SF2 INT-010; SF3 INT-056; SF4 INT-019; SF5 INT-016; SF6 INT-062; SF7 INT-062; SF8 INT-062; SF9 INT-062; SF10 INT-019; SF11 INT-062; SF12 INT-062; SF13 INT-062.
- **M13** SF1 INT-016 and INT-030; SF2 INT-048; SF3 INT-031; SF4 INT-065; SF5 INT-015 and INT-032; SF6 INT-032; SF7 INT-016; SF8 INT-015; SF9 INT-040; SF10 INT-015; SF11 INT-049; SF12 INT-024; SF13 INT-065; SF14 INT-065.
- **M14** SF1 INT-035; SF2 INT-019 and INT-022; SF3 INT-065; SF4 INT-062; SF5 INT-027; SF6 INT-012; SF7 INT-065; SF8 INT-009; SF9 INT-065; SF10 INT-065; SF11 INT-058; SF12 INT-065.

---

## 2. Interface matrix

### 2.1 Module pairs that exchange data

Status: MATCH (as designed, so far as read), PARTIAL (works with a named fix), MISMATCH (two signatures for one boundary), MISSING (a consumer expects what no module offers). "Read" means the sections listed in section 0; MATCH is a statement about those sections only.

| Producer to consumer | Producer offers | Consumer expects | Status | Fix |
|---|---|---|---|---|
| M1 to M2 | `FetchOutcome` and blobs for web, silo rows | `analyseDocument(bytes)` with `bodyHash` and rights flag from "M1 (document channel)" | MISSING | add channel 11j; INT-041 |
| M1 to M3 | `Evidence`, authority rows with `rank`, `RoutingPlan` with `requiredOrigins`, origin DAG named only inside routing | `Assertion[]`, per-attribute `requiredChannels`, `canHandle`, origin DAG as data, fetch states | PARTIAL | M1 publishes `requiredChannels` and `origins.json` per pack; one name (`requiredChannels`); M3 reads them as data |
| M1 to M4 | `Evidence` with `fetchState`, blobs | L0 re-check against the stored layer, `fetchState: ok` | MATCH | L0 reads M2's layer, not M1's blob |
| M1 to M5 (via M3) | SOR rows with `last_write_*` | field trust from write origin | PARTIAL | columns planted and required; INT-024 |
| M1 to M7 | effect `source.fetch` keyed by `requestKey` | slot-keyed effect with request-hash check | MISMATCH | two layers; INT-042 |
| M1 to M9 | cassette manifest, egress manifest, rights registry, tombstones | bundle `replay/*`, `evidence/index.json` with disposition, commitments for non-public bodies | PARTIAL | INT-042, INT-043, INT-003 |
| M1 to M12 | `SiloPort`, Zetaris REST/JDBC/MCP clients | sponsor-proof wiring | MATCH | M12 §C13 states scope |
| M1 to M13 | `broker` silo role raw read, `ListVersion` | step R fresh reads of list version, vendor-master version, exposure | PARTIAL | M1 exposes `SiloPort.version(view)` and a `ListVersion` feed API; INT-024 |
| M2 to M3 | `FieldCandidate[]`, `DocCompleteness`, hyphen `joinHints` | `ExtractionDiag {doubleExtracted, quoteCheck, ocr}` per assertion; double-extraction output | PARTIAL | one `ExtractionDiag` with five agreement states; INT-022, section 3 |
| M2 to M4 | `SpanRecord[]`, `lv1`, layer, `joinHints` | `SpanTable`, `Span`, NFC code-point layer; matcher uses an index map | MISMATCH | INT-004, INT-005; M4 consumes `joinHints` in the `linebreak_hyphen` fold |
| M2 to M5 | `DocRisk`, `DocFinding`, `DocCompleteness`, `SignatureRecord[]` | nothing in M5's feature registry | MISSING | INT-015 |
| M2 to M8 | carrier findings; request for a per-run datamark nonce | `renderForModel` nonce from `ctx.rng`; K1 compartment table | MATCH | nonce recorded in the cassette (M8 §C9) |
| M2 to M9 | `evidence/<docId>/{source.pdf, layer.txt, spans.json, ...}` | content-addressed `evidence/blobs`, `evidence/index.json`, resolver kinds | MISMATCH | INT-052 |
| M2 to M10 | viewer contract, quads, findings | page rasters at 144 dpi as hashed derived artefacts | PARTIAL | M2 adds raster export; INT-052 |
| M2 to M14 | `renderForModel(spans, nonce)`, `resolveCitation`, `groundValue` | `[sp_17] text` lines with content ids; own `ExtractionSchema` | MISMATCH | INT-005, INT-022 |
| M3 to M4 | `fuse`, `statusUnder`, `cellHypergraph`, `reconcileFromEdges` | `Evaluator.keys/deps/phase1`, `edits` | MISMATCH | INT-034 |
| M3 to M5 | `TruthTable`, `Cell`, `Fact` with `silent` status | typed cells with `CellStatus` | PARTIAL | five-valued `CellStatus`; INT-007 |
| M3 to M6 | facts, cell keys, assertions as events | decision-dependency graph; `SemanticMemoryPort` | MATCH | M12 implements the FactStore M3 specifies |
| M3 to M9 | `ReconcileRules` bundle (data), recorded `LinkEdge` with judged labels | "reconcile kernel configuration as data; recorded link decisions with judged labels, not scores" | MATCH | integer ledgers, Stage B only (M3 §1) |
| M3 to M10 | `TruthTable`, per-cell provenance, as-of data | `TruthTableView` incl. identity robustness | MATCH | fifth cell state |
| M3 to M13 | `screen(subject, listVersion)`, `diff` | release-time re-screen, delta runs | MATCH | |
| M4 to M3 | `verdictOf` injection | `robustness(base, verdictOf, cfg)` | PARTIAL | INT-034 |
| M4 to M5 | `ClaimLedgerView` (ids, labels, gaps, flip digests) | label features; chain flag `canPermit` | PARTIAL | M5 adds `claim.<id>.canPermit`; INT-015 |
| M4 to M6 | `Recompute(snapshot, removed)` | M6 retraction and validity | MATCH | via the evaluator of INT-034 |
| M4 to M9 | `CertEnvelope`, certificates with `vRef`, claims ledger Merkle root | normative L0 quote-check document with vectors, producer-status mapping | PARTIAL | M4 §C3 publishes an `l0-spec` with vectors before build step 8; INT-001 |
| M4 to M10 | `ClaimLedgerView`, `FlipView`, `RenderedProse` with `spanMap` | claim panel, flip panel | MATCH | |
| M5 to M4 | `featurize`, `evaluate`, `derive`, `coneOf`, `fieldDeps`, `flipSearch`; numeric `Derivation` | `phase2`, `reads(projection)`, content-id `DerivationTrace` | MISMATCH | INT-034 |
| M5 to M6 | `PrecedentQuery`, `revalidate`, `recomputeStage`, `DecisionEpisode` proposal | `retrieve(q, pin)`, `validateJudgement`, `appendEpisode(decisionRecord)` | MISMATCH | INT-028 |
| M6 to M5 | `PrecedentRetrieval {support, counters, lead, ...}` | `PrecedentSet {supporting, counter}` | MISMATCH | INT-028 |
| M5 to M9 | `DecisionRecord`, `PolicyBundle`, enumeration certificates, proof bundle | `decision/record.json`, `policy/policy-ir.json`, recompute V6 to V8 | PARTIAL | V6a and bake-off 2 criterion; INT-050 |
| M5 to M13 | `ApprovalItem`, obligations, binds | `ApprovalRequest`, `requirement` | MISMATCH | INT-029 |
| M13 to M5 | exposure ledger and atomic reservation, outcome labels | `ExposureLedgerView` with `ledgerSeq` compare-and-set | MATCH | add `overlay.releaseBlock`, `target.reversible`; INT-015 |
| M13 to M6 | `OutcomeLabel` (`labeller: system or human`), adjudication, reversal receipts | `recordOutcome` with the authorship rule (`writer.kind` list) | PARTIAL | one mapping from `labeller` to `writer`; trust of an evidence-backed human label is `VERIFIED` (INT-065) |
| M6 to M9 | memory heads, retrieval views, certificates, tombstones | `memory.head` leaf, tombstone semantics | MATCH | INT-040 for erasure |
| M6 to M12 | engine needs: pure `peek`, `entities`, `supersededBy`, `PureRerank`, `carryoverBuilder`, R-WM1 to R-WM4 | H-MEM, World Model, Markovian facades | MATCH | verified against the interface rows only |
| M7 to every module | ports `model`, `tools`, `clock`, `ids`, `scheduler`, `store`, `ledger`, `human` | additionally `net`, `fs`, `sandbox`, `journal`, `ids.secret`, signer, authorize, kill gate, tenant | PARTIAL | section 2.2; INT-056 |
| M7 to M9 | trace JSONL, `RunManifest`, cassette digest, `LedgerPort` (sync = published) | `prevLineHash`, `why_kind` lint, `append` + `published` | MISMATCH | INT-018, INT-049, INT-054 |
| M7 to M10 | trace stream, `subscribe()` | `UiTraceEvent` with `phase`, `agent`, `verb`, budget | PARTIAL | INT-054 |
| M8 to every module | `Labelled<T>` registry, `use(x, purpose)`, permission matrix | plain typed values with `trust` and `conf` fields (M3 `Fact`, M2 findings) | MISMATCH at the pure-data boundary | stored records carry `LabelRecord`; privileged code re-mints with `fromStored`; INT-013, INT-014 |
| M8 to M12 | closed action registry, `Approved<T>`, HMAC mode excluded | `ContractIssuer.issue(approved, approvals)` | MISMATCH | INT-016 |
| M8 to M13 | `verifyCapability`, `revalidate`, `KillState`, nonce-store spec | `execute` pipeline, `NonceStore` | MISMATCH | INT-016, INT-018 |
| M9 to M13 | `LedgerPort`, signer role `capability`, leaf registry | `appendAsync`, `KeyPort`, `action.*` leaves | MISMATCH | INT-017, INT-018, INT-049 |
| M9 to M10 | `VerifyReport`, `chipState` (colour), viewer contract | named chip states, tier names | PARTIAL | INT-052, INT-008 |
| M10 to M13 | approval API calls, `submit_case`, upload | `submitCase`, `ApprovalRequest`, attachments | PARTIAL | INT-029, INT-041 |
| M11 to M1 | emitted JSON Schemas | `SiloContract` hash | MISMATCH | INT-046 |
| M11 to M2 | glyph-truth corpus | PLD-1 requirements | MISMATCH | INT-047 |
| M11 to M5 | `(calibration split, alpha, delta) -> threshold` procedure, draws | selective-release validation | MATCH | |
| M11 to M8 | generation infrastructure | Plumbline-Inject families and oracles | PARTIAL | INT-026 |
| M11 to M9 | statistics over tamper-corpus runs | mutation catalogue and corpus | MATCH | M9 owns mutations, M11 the statistics |
| M11 to M14 | `ArmSpec`, `Prereg` runner | role overrides, `PreReg` | MISMATCH | INT-060 |
| M12 to M3 | World Model engine behind `FactStore` | `ResolverPlugin` as product policy | MATCH | engine auto-merge disabled in the product profile |
| M12 to M7 | `ModelPort` adapters, `SyncJournal` request | `ModelPort`, no journal port | PARTIAL | INT-056 |
| M12 to M9 | `memory.head` anchor | registry leaf `memory.head` | MATCH | |
| M14 to M2, M3 | extractor, matcher | M2 aliases, M3 per-pair edges | MISMATCH | INT-005, INT-036 |
| M14 to M4 | decomposer, L2 judge, advocate, skeptic, arbiter | M4 L1 generative atoms; L2 contracts | PARTIAL | INT-012 |
| M14 to M5 | judge with `floor`, ids | judge with ceiling `r`, handles | MISMATCH | INT-027, INT-028 |
| M14 to M7, M8 | roles as steps; `canonicalRequest`; compartments | `Step` kinds; K1/K2 | MATCH | after INT-019 and INT-042 |

### 2.2 Ports M7 must provide (the full set requested by all modules)

Everything not marked "already in M7" is new. Owner means who designs the contract; the implementation of every port lives under `src/runtime/adapters/**`, the only place the determinism lint allows `node:net`, `node:fs`, `node:child_process`.

| Port | Requested by | Owner | Signature sketch | Notes |
|---|---|---|---|---|
| `NetPort` (`ctx.net`) | M1 SF11, M8 §C3, M12 | M8 implements in `ports/egress.ts`; M7 declares | `send(req: {method; url; headers; body?}, labels: LabelSet, ctl: CallCtl): Promise<Result<{status; headers; body: Uint8Array; hops: Hop[]}, PortError>>` | the only caller of `fetch` and `node:net`; interceptors `egress`, `capability`, `budget`; SAMPLE_MODE guard throws here (INT-020) |
| `FsPort` (`ctx.fs`) | M1, M9, M8 (nonces) | M7 | `writeAtomic(path, bytes, {fsync: true; dirSync: boolean})`, `readFile`, `lstat`, `exclusiveCreate(path, bytes): Result<void, "exists">`, `rename`, `listDir` | implementation under `StorePort`; symlink refusal and containment checks live here |
| `SandboxPort` (`ctx.sandbox`) | M2 DocWorker, M8 §C8 | M7 declares; M8 selects backend | `spawn({entry; backend: CompartmentBackend; limits: Limits; env: {}; stdin: Uint8Array}): Result<SandboxHandle>`; handle `{request(frame): Promise<Result<Uint8Array, SandboxError>>; kill(reason): Promise<void>; usage(): {wallMs; rssMb; outBytes}}` | effect record is `(docSha, pipelineVersion) -> analysisHash`; the model-call forwarder (K2) is the same channel restricted to one message type |
| `SyncJournal` | M12 SF3 | M7 | `append(streamId: string, line: string): void`; `readAll(streamId: string): Iterable<string>` | local durable, not cassetted; default in-memory so the conformance runners touch no file |
| `StorePort` mode for memory (`MemoryStorePort`) | M6 SF13 | M7 | `openLog(name, {replay: "scratch" or "strict"})`; `readAtPin(pin: SnapshotPin): AsyncIterable<Uint8Array>`; `anchor(stream): DocHash` | in replay, writes go to a scratch store; reads at a pin are pure |
| `SecretIdsPort` (`ctx.ids.secret`) | M10 F11 | M7 | `secret(bytes: number): string` (base64url, OS CSPRNG) | recorded in `record`, a fixed test value in `replay`; MCP handles |
| `SignerPort` | M8, M9, M12, M13 | M9 (process); M7 declares the client | `sign(req: SignRequest): Promise<Result<SignResponse, SignError>>`; `publicKeys(): KeyRegistry` | roles per INT-017; no private bytes cross the pipe |
| `KeyPort` | M13 comp 15 | M13 | `inventory()`, `rotate(role)`, `wrap(dekId, bytes)`, `unwrap(dekId)` | behind the signer; also per-object DEKs for crypto-erasure |
| `AuthorizePort` (`ctx.authorize`) | M13 comp 13 | M13 data, M7 declares | `authorize(principal, action, resource, tenant: TenantCtx): Result<Allow, Deny>` | every deny and sensitive allow is traced |
| Kill-state interceptor | M8 §C14 | M8 | `before(call)`: deny when `kill.engaged` and `call.effectClass !== "read"` | placed before `budget`: chain `[schema, kill, egress, capability, budget, port, record, label, ledger, trace]` |
| Tenant field | M13 comp 13 | M7 | `StepCtx.tenant: TenantId`; `Slot.tenant?` (omitted from the digest when default) | INT-048 |
| `ModelPort` additions | M14, M12 | M7 | `capabilities: {structuredOutput: "none", "json_schema" or "grammar"; reasoningCapTokens: number}`; `canonicalRequest(req): Json` | reservation includes the reasoning cap (INT-058) |
| `LedgerPort` rewrite | M9 F6 | M7 | `append(req): Result<Appended>`; `published(a): Result<Published>`; `streamHead(stream)`; helper `appendBefore(call, draft)` | INT-018 |
| Trace schema fields | M9, M10, M14 | M7 | `prevLineHash`, `why_kind`, `decider`, `phase`, `agent`, `verb`, `budget`, `tenant`, `semconv_version` | INT-054 |
| Already in M7, unchanged | | | `model`, `tools` (with `status(idemKey)`), `clock`, `ids`, `scheduler`, `store` (+ blobs), `human` | `rng` stays a kernel service derived from the seed |
| Not ports | | | `AdversaryModelPort` is a test adapter of `ModelPort`; `TargetPort` is a `ToolPort` with `effectClass: "irreversible"`; `NonceStore` is M13 storage over `FsPort.exclusiveCreate` | no new effect type |

---

## 3. Shared types change list (`00-conventions-and-shared-types.md`)

Replacement declarations. Everything not shown is unchanged. Comments name the register item that forces the change.

```ts
// ---------- scalars and digests (INT-003, INT-010)
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Iso = string;                                   // RFC 3339 UTC, produced by ctx.clock only
type Id<T extends string> = `${T}_${string}`;
type RawHash    = `sha256:${string}`;                // plain SHA-256 of exact bytes; reproducible with sha256sum
type DocHash    = `jcs:${string}`;                   // SHA-256 over domain tag, newline, JCS bytes; the tag is in the schema registry
type Commitment = `com:${string}`;                   // SHA-256(salt || domain tag || value); required for any value above `public` or of low entropy
type Hash = RawHash | DocHash | Commitment;          // generic field; the prefix says which
type Ppm = number; type Milli = number; type Micros = number; type Cb = number;   // integer scales; never floats in hashed documents
type MinorUnits = string;                            // decimal string of integer minor units
type TenantId = Id<"tn">;                            // INT-048
type RestoreEpoch = number;                          // monotonic; part of the capability audience; INT-016

// ---------- trust and confidentiality (INT-006, INT-013, INT-014)
type TrustLevel = "SOR" | "VERIFIED" | "EXTRACTED" | "UNTRUSTED";
declare function combine(a: TrustLevel, b: TrustLevel): TrustLevel;           // meet; pure
type Confidentiality = "public" | "case-visible" | "internal-sensitive";       // plus `personal`
declare function join(a: Confidentiality, b: Confidentiality): Confidentiality; // pure; public < case-visible < internal-sensitive
type Authorship = "counterparty" | "third_party" | "authority";
type AuthorityTier = "authoritative" | "regulated_register" | "self_declared" | "secondary" | "synthetic";
interface LabelRecord { trust: TrustLevel; conf: Confidentiality; personal: boolean }   // serialisable record of a label; runtime enforcement is M8's Labelled<T>
type WriteOrigin = "attested" | "internal_initiated" | "system_migration" | "vendor_portal" | "vendor_email" | "unknown";
type ActionClass = "assign_release_field" | "satisfy_manifest_item" | "count_independent_support" | "win_conflict_resolution"
                 | "add_restriction" | "write_precedent_as_supporting" | "show_to_human" | "into_privileged_prompt";
type DataClassMapEntry = { foreign: string; to: Confidentiality; personal?: boolean };  // M12 owns the file; unmapped foreign classes map to internal-sensitive (INT-009)

// ---------- evidence (INT-004, INT-006)
type FetchState = "ok" | "partial" | "not_found" | "not_checked" | "not_applicable"
                | "unavailable" | "blocked_by_policy" | "rate_limited" | "stale";
interface LicenceStatus {
  spdx: string; termsUrl: string; termsHash: RawHash | null; verifiedOn: Iso | null; verifiedBy: string | null;
  attributionRequired: boolean; redistributable: "yes" | "no" | "unknown"; scope: "body" | "derived" | "metadata_only";
}
type ResolverKind = "bytes" | "json-pointer" | "csv-cell" | "textlayer";
interface Locator {
  kind: "url" | "record" | "doc"; ref: string; field?: string;       // `field` is an RFC 6901 pointer into `raw`
  docSha?: RawHash; revision?: number; layerId?: Id<"ly">; textLayerHash?: RawHash;
  unit?: "codepoint";                                                 // fixed; offsets below count Unicode code points
  page?: number;                                                      // 1-based
  start?: number; end?: number;                                       // 0-based, end exclusive, page-relative, over the VISIBLE layer (never normalised)
  byteStart?: number; byteEnd?: number;                               // UTF-8 byte offsets into the same page text; the verifier cross-checks both
}
interface Evidence {                                                  // immutable
  id: Id<"ev">;                                                       // content-derived, includes retrievedAt of the network exchange
  channel: string; retrievedAt: Iso; effectiveAt?: Iso;
  locator: Locator; resolver: ResolverKind;
  bodyHash: RawHash | Commitment;                                     // Commitment when conf is above public
  parsedHash: DocHash; parserVersion: string;
  authority: AuthorityTier; authorship: Authorship; licence: LicenceStatus; synthetic: boolean;
  use: "decision" | "discovery";                                      // discovery evidence can never be cited
  trust: TrustLevel; conf: Confidentiality; personal: boolean;
  raw: Json; normalised: Json;
}
interface EvidenceLinks { evidenceId: Id<"ev">; supports: Id<"cl">[]; contradicts: Id<"cl">[] }   // derived index owned by M4; not part of Evidence

// ---------- facts and reconciliation (INT-007, INT-013)
interface ExtractionDiag {
  doubleExtracted: "agree" | "disagree" | "model_only" | "parser_only" | "single";
  quoteCheck: "exact" | "normalised" | "absent" | "not_run"; ocr?: boolean;
}
interface Assertion {
  id: Id<"as">; mentionId: Id<"mn">; attribute: string; raw: Json; norm: Json;
  source: string; originId: Id<"og">; observedAt: Iso; validFrom?: Iso; validTo?: Iso;
  recordedAt: Iso; supersededAt?: Iso; extractor: string; parserVersion: string; evidenceId: Id<"ev">;
  trust: TrustLevel; conf: Confidentiality; personal: boolean; derivedFrom: Id<"as">[]; diag?: ExtractionDiag;
}
type CellStatus = "resolved" | "unresolved" | "silent" | "not_checked" | "unavailable";   // silent: every required channel checked, nothing says
type ProvRef = unknown;                                                                    // body owned by M3 component 10
interface Fact {
  id: Id<"fa">; cell: { entity: Id<"en">; attribute: string }; value: Json;
  trust: TrustLevel; conf: Confidentiality; personal: boolean;
  supports: Id<"as">[]; defeats: Id<"as">[];                                               // trust = meet over `supports` only; `defeats` affect status and conflicts only (INT-013)
  prov: ProvRef;
}

// ---------- claims and explanation (INT-001, INT-012)
type Label = "entailed" | "partial" | "neutral" | "contradicted" | "contested" | "unattributed" | "invalid_citation" | "fabricated_quote";
type Piece = { k: "span"; start: number; end: number } | { k: "entity"; handle: Id<"en"> } | { k: "join"; token: " and " | ", " | " " };
interface Claim {
  id: Id<"cl">; text: string;                                       // derived from `pieces` when present
  pieces?: Piece[]; parentRef: { doc: Id<"doc">; sentenceIdx: number };
  decomposer: "none" | `llm:${string}` | "sentence-fallback";
  kind: "factual" | "numeric" | "quote" | "opinion" | "meta"; citations: Citation[]; label?: Label;
}
interface Citation { evidenceId: Id<"ev">; spanIds: Id<"sp">[] }  // the model supplies span aliases; code supplies the quote
type Verdict = "PASS" | "FAIL" | "INDETERMINATE" | "NOT_APPLICABLE";   // verifier results
type CertOutcome = "VALID" | "INVALID" | "INCONCLUSIVE";               // a certificate producer's own outcome

// ---------- decisions, approvals, autonomy (INT-002, INT-027, INT-029, INT-031)
type Action = "release" | "release_with_approval" | "escalate" | "hold" | "reject";   // most to least permissive; the order is data in the policy IR
interface Why { kind: "rule" | "computed" | "model_reported" | "human_reported"; ruleId?: string; codes: string[]; text: string; factIds: Id<"fa">[] }
type AutonomyLevel = "AL0" | "AL1" | "AL2" | "AL3";
type ApprovalItemType = "action" | "memory_write" | "rule_proposal" | "ladder_promotion" | "judge_loosening" | "dispensation" | "roster_change" | "emergency_ratify";
type ApprovalState = "pending" | "approved" | "rejected" | "expired_denied" | "superseded" | "invalidated";
interface ApprovalClocks { requestExpiresAt: Iso; approvalWindowSec: number; capabilityTtlSec: number }
interface Proposal<T> { readonly kind: "proposal"; value: T; by: string }
interface Approved<T> { readonly kind: "approved"; value: T; gate: string; verdictSeq: number }   // only gate.apply() constructs it; in-process proof, not a cross-process one

// ---------- roles, audiences, scopes (INT-008)
type SiloRole = "agent" | "buyer" | "reviewer" | "approver" | "broker";                 // data-access identity
type RbacRole = "requester" | "buyer" | "analyst" | "reviewer" | "approver_l1" | "approver_l2" | "approver_cro" | "policy_author"
              | "policy_approver" | "auditor_readonly" | "tenant_admin" | "security_admin" | "killswitch_operator" | "platform_operator";
type Audience = "reviewer" | "auditor" | "counterparty";
type Disclosure = "full" | "redacted" | "notice";                                        // bundle tier = (Audience, Disclosure)

// ---------- release capability (INT-016); the container is M12's ExecutionContract
interface ReleaseBinding {
  caseId: Id<"case">; tenant: TenantId; episode: number; decisionId: Id<"dr">;
  payee: { vendorId: string; legalEntityKey: string };
  accountCommit: Commitment; amountMaxMinor: MinorUnits; currency: string; poRef: string; invoiceRef?: string;
  action: "payment.release" | "payment.reverse";
  factSetHash: DocHash; policyBundleHash: DocHash; listVersions: Record<string, string>; vendorMasterVersion: string;
  approvals: { approvalId: Id<"ap">; approverSub: string; approverRole: RbacRole; at: Iso; assertionHash: DocHash }[];
  approvalSetHash: DocHash; attestationIds: Id<"att">[]; restoreEpoch: RestoreEpoch;
}   // container fields (aud, nbf, exp, nonce, kid, sigAlg) belong to ExecutionContract

// ---------- exposure reservations (INT-015; field list proposed here, M13 component 11 owns the final shape)
interface ExposureReservation { id: Id<"rsv">; caseId: Id<"case">; vendorGroup: string; amountMinor: MinorUnits; currency: string;
                                state: "reserved" | "executed" | "released" | "expired"; ledgerSeq: number; expiresAt: Iso }
interface ExposureLedgerView { releases: { caseId: Id<"case">; vendorGroup: string; amountMinor: MinorUnits; currency: string; at: Iso }[];
                               reservations: ExposureReservation[]; ledgerSeq: number }

// ---------- verification and security results (INT-006)
interface ScopedResult {                                            // from M8 §C13; every security result carries its scope
  id: string; claim: string; method: "static" | "enumerated" | "fuzzed" | "mutation" | "adversary_port" | "attack_corpus" | "probe";
  scope: { subject: string; domainSize?: string; fieldsCovered: string[]; rolesCovered: string[]; seeds: string[]; backend?: string };
  completeness: "complete" | "partial"; result: "PASS" | "FAIL" | "PENDING" | "BLOCKED"; evidence: Hash[]; commit: string; notCovered: string[];
}

// ---------- runtime (unchanged except rng wording)
type ErrorClass = "transient" | "validation" | "budget" | "policy" | "fatal";   // E_CASSETTE_MISS is fatal (INT-042)
type Mode = "live" | "record" | "replay";
```

Other conventions-file edits: (1) "Module dependency rules": replace "M6 serves M5" by the acyclic statement of INT-037 (M5a policy core below M3/M4/M6; M5b pipeline above them). (2) "Pseudocode style": `ctx.rng` is a kernel service derived from the seed; the M11 generator is the one documented exception with byte-equal regeneration as its control (INT-010, INT-064). (3) Module index row 12 renamed "Sponsor adapters and evidence". (4) Add a "Level and ladder names" table (INT-011). (5) The sentence "A module that needs a new effect type proposes it to M7" gains a pointer to section 2.2.

---

## 4. Guarantee-table additions (spec §9a)

Rows are written in the table's form (Dimension, established, not established). "Replace" marks a row that already exists and is being narrowed.

| Dimension | What is established | What is not established |
|---|---|---|
| Document-to-text-layer fidelity (replace "Document and locator fidelity"; M2 DI-15) | For a document analysed by the pinned pipeline: the cited span is at the cited offset of the stored visible text layer, whose hash is recorded (LV1, checked in code points and in UTF-8 bytes); the two extractors agree at the span's region or the disagreement is recorded (LV3); every admitted glyph was drawn and produced ink in both the operator and the pixel channel; hidden, faint and suspect glyphs were excluded and reported; signature presence, validity and content-since-signing are separate fields. Rates: the measured silent-wrong locator rate with its document-clustered upper bound, per-technique hidden-text recall and benign false-quarantine rate, on the PLD-1 test split | that the original PDF says it in any viewer other than the PDFium rendering used; documents of types, producers, scripts or layouts outside PLD-1; visual forgery (edited images, fabricated seals) and handwriting; shape or encoding remaps on pages where the OCR cross-check did not run; OCR text beyond its measured accuracy; whether a signer is who they claim; the truth of the content |
| Precedent retrieval (M6 SF5) | the shown-set scores, caps and standing recompute offline from the bundle's retrieved views, the pin and the memory configuration; reads do not change ranking | that no better candidate was omitted (completeness of the candidate set needs the store snapshot or a commitment to the gated candidate set); that outcomes in the store are true; any real-world precedent value (the evaluation uses a simulator) |
| Retraction exactness (M3 SF4, M6 P-M6) | for the deterministic stages of an affected decision, retraction of a fact, precedent or rule version recomputes exactly which decisions change their allowed set, which only change judgement input, and which are unaffected (first order); for monotone support, provenance-expression retraction equals recomputation; for a defeated single-valued cell, a cell-local re-fuse equals recomputation | second-order effects when the affected predecessor's counterfactual action depends on the judge (flagged `second_order`, never called unaffected); anything about erased snapshots (`unevaluable`); the model judgement stage |
| Log completeness and currency (M9 F15) | consistency from a checkpoint the relying party holds to the checkpoint stated in the bundle; no entry at or before that checkpoint was removed or altered; the cadence promise was kept as of the newest trusted time | anything after the bundle's checkpoint: later retraction, reopening, appeal or erasure are invisible to it; a silent log is reported as a missed promise (`V4.CADENCE_EXCEEDED`), not as absence of events |
| Budget soundness (M7 SF11) | total provider-reported usage never exceeds the budget, provided the estimator upper-bounds actual input usage and the provider enforces `max_tokens` (reasoning tokens are capped in the reservation); a violation is recorded and marks the run `budgetUnsound` | spend on a provider that does not enforce `max_tokens`; cost in currency; wall-clock behaviour under a real network |
| Authorisation and injection (replace; M8 F15) | no injection can add permission or change a release field, at the stated scope of the policy table and permission matrix; a release capability is single-use across a process crash and across concurrent brokers; a world change between approval and execution (bank account, payee, amount, list version, vendor-master version, fact supersession) refuses execution; the compartment backend that ran is recorded and the network-denial claim follows its probe | suppression of document-derived restrictions beyond required-positive-evidence and corroboration (measured as a steer rate); authored deception; compromised systems of record; a compromised signer host or approver authenticator; the one-round-trip window between the last re-read and the send; exactly-once effects on a target that offers no idempotency key |
| Process compartment (M8 F1, new) | the document worker ran under the recorded backend, and the net, fs, child-process and worker probes (with a positive control) passed for that backend | network denial under `node-flags-only`; resistance of the Node permission model to an exploited parser (the model is a "seat belt" by its own documentation) |
| Confidentiality and egress (replace; M8 F2) | no value above its declared egress class leaves in the tested paths, except at declared disclosure parameters, where only the minimised form leaves (an identifier when one exists, the name only otherwise); model prompts are an egress sink capped by the model profile; precedent views cross cases only through a whitelist projection | that a lookup did not reveal a relationship; volume and timing; information leaked through a hosted model's retention |
| Retention and erasure (M6 SF10, M9 component 14) | an erased body leaves a signed receipt and no recoverable form of it in the case's ledger, bundle or logs, and the verifier reports INDETERMINATE (never PASS) for the members it covered; erasure under a legal hold is detected after the fact (V8) | that backups or filesystem remnants are gone (crypto-erasure is the upgrade); whether salted commitments remain personal data (LAWYER); replay of a case whose bodies were erased |
| Explanation exactness (replace; M4 SF13) | minimal robustly sufficient evidence, minimal flips and causes are exact relative to the frozen snapshot, its recorded labels and link judgements (taken as recorded, with edge locality tested per pair), the reconciliation rules, the policy function and the declared domains of unchecked sources | real-world causation; correctness of recorded labels; a decision-relevant gap means an unchecked source's values within the declared domain could change the verdict, which is not an expected value of information |
| Identity robustness (M3, new) | for every `possible` link, the verdict is `stable` or `identity_dependent` across the admissible clusterings enumerated under the cannot-link constraints within the stated cap | clusterings beyond the cap (the result is `identity_dependent` with `completeness: partial`); links never generated by blocking |
| Selective-release bound (replace; M5 SF2, SF3) | on the synthetic generator, under non-adversarial shift, the fast-lane (single confirm) region certified at the stated alpha and delta has a harmful-release rate at or below the bound; the statement is conditional on the calibrated region; the joint rate can only fall when more cases abstain | any real-world rate; behaviour under an adaptive attacker; a full-review lane (no payment executes without a person at `AL2`) |
| Decision correctness (replace; M5 SF5) | the policy function, given the frozen validated facts and rule version, returns this action (recomputable); invariants I1 to I9 hold **within the enumerable fragment** (single-field atoms and the unit-coefficient two-field closure), with SMT proofs over the encoded rules as a second check | that the rules, the facts or the feature functions are right; anything outside the enumerable fragment (reported as `scope: partial`) |
| Counterfactual rule evaluation (M5 SF8) | tightening of a rule is evaluable from logged decisions under a stated hold-cost assumption; loosening is `unevaluable` without exploration | rule value on real outcomes; replay agreement with humans is imitation and is never offered as rule value |
| Outcome labels (M6 P-M5, M13) | no admitted label was produced by an actor that took part in the decision (structural check); an evidence-backed human finding is `VERIFIED`, an unsupported human assertion is an `UNTRUSTED` note | that the label is true |
| Approvals and segregation of duties (M5 DEC-04, M13) | each approval is bound to an exact request digest by a verified assertion; distinct approver subjects, none equal to the requester or vendor-master editor of record | that distinct subjects are distinct people (assumed from the identity provider; alias signals S1 to S3 were checked and do not exclude it); that the approver understood the card |
| Explanation coverage (M9 component 3, new) | the share of decision reasons that are `rule` or `computed` and recompute in V6 (`explanationCoverage`); a decision whose reasons are only `model_reported` yields `V6.NO_VERIFIABLE_REASON` | that a recomputed reason is the real cause in the world |
| Replay and determinism (replace; M9 F4) | for a fixed input, pinned code, policy and schema versions and recorded cassettes, replay yields the same normalised trace and, per stream, the same leaf sequence and head leaf hash; deterministic stages replay on any input | global ledger indices or the tree root (they depend on case interleaving); that a live model answers the same; model judgement on a new input; repeatability of sampling |

---

## 5. Dependency and build-order check (spec §20)

Method: for each of the 17 steps, list every inter-module dependency the blueprints state, and test whether the dependency's provider is built at an earlier or the same step. Result: the order does **not** satisfy all stated dependencies. Eleven violations, in order of step.

| # | Step | Violation (module, section) | Correction |
|---|---|---|---|
| V1 | 1 to 3 | M7 SF2, SF10: the write-ahead effect log is owned by the effect layer and bake-off 1 judges candidates "with our effect layer on top", but spec step 3 is the cassette; the WAL is at step 5 | WAL, harness, broken drivers and the eight acceptance tests move into step 3 |
| V2 | 1 | M7 trace schema must carry `phase`, `agent`, `verb`, `prevLineHash`, `tenant` (INT-054); M10 F10, M9 ask for them. Adding at step 14 is a schema break | step 1 fixes the full trace schema, the tenant field and the `Hash` prefixes (INT-003, INT-048) |
| V3 | 1 | Ports `NetPort`, `FsPort`, `SandboxPort`, `SyncJournal`, `SecretIdsPort`, `LedgerPort` rewrite (INT-056) are not in step 1's "ports" | step 1 lists all ports of section 2.2; adapters for net and sandbox follow with M1 and M8 |
| V4 | 3a | Bake-offs 3 (entity matching, needs the planted-pair gold set) and 4 (PDF parsing, needs the locator corpus) need the step 11 generator; bake-off 2 needs the 30-rule corpus; bake-off 7 needs a key | 3a runs bake-offs 1, 5, 8 only; 2 runs when its rule corpus is written (after M5a C1 types); 3 and 4 run after step 11; 6 runs in step 10; 7 when the key exists |
| V5 | 6 | M8 C5 `verifyCapability` and M12 contract signing need DSSE, Ed25519 and the signer (M9 components 1, 4, 7, built at step 8) | split step 8: **8a** (JCS, DSSE, signer process with the ledger role, ledger core, V0 to V4a verifier) before step 6's capability work; the capability, attestation and kill roles after 8a |
| V6 | 8 | the verifier-core gate "two implementations pass shared vectors" includes V5, which needs the L0 quote-check algorithm (M4 §C3, step 12) and the locator unit (M2, INT-004); V6 to V8 need M5a and M3 Stage B (step 12) | step 8 gate is scoped to V0 to V4a plus V5 for `bytes`, `json-pointer`, `csv-cell` locators; `textlayer` V5 follows M2 DI-01 and M4 §C3; V6 to V8 follow M3, M5a (M9 F17: normative spec and held-out corpus are prerequisites of the gate) |
| V7 | 9 | M1 needs `NetPort` and the egress funnel (M8 C3, step 6 labels) and the content store | satisfied once V3 is done; M1 doctor needs the compartment probes only for M2 |
| V8 | 10 | M12's Scout contract verify/consume needs M13's `ConsumedWal`, which is step 14 | M12 ships `FileWal` for tests; the capability is exercised end to end only at step 14 (state in the step 10 gate) |
| V9 | 12 | M5 needs M13's exposure ledger (I6 cumulative exposure, reservations) and the approval queue (C13) at step 12, but M13 is step 14; M3 `robustness` needs M5 and M4; M6 needs M4, M5 | split M5 (INT-037). Step 12 order: M2 DI-01, DI-08 (types, spans); M5a (IR, interpreter, features); M3; M4 (L0 to L3, then L4 over M3 and M5a); M6; M5b. M13's case state machine (component 1) and the exposure reservation API (part of component 11) move to step 11b so M5b has a real ledger. Approval queue at step 14 with a fake in M5b tests |
| V10 | 12 | M4 L1/L2 and M2 extractor acceptance need M14's rule brain and `ModelPort` adapters (step 13) | M14 C13 (port, scripted adapter) and C16 (rule-brain interfaces) move before step 12; prompts and real models stay at step 13 |
| V11 | 13 | pre-registration "committed" before any ablation run, but nothing is committed before 22 Oct | the pre-registration file is written before the first confirmatory run and publicly committed after the window; earlier runs are exploratory (INT-059) |

Smaller notes: step 14a (second pack) needs the pack-specific files isolated, which M3 (`ReconcileRules`), M5 (policy sheet) and M1 (silo contract) already specify as data; M8's compartment table and probes (M8 build notes: "first") must precede M2's `DocWorker` at step 12; M10's browser modules need the policy engine and verifier core as erasable-syntax TypeScript (M10 F1), a D-007 amendment.

**Corrected order** (changes in bold):
0. disk, baseline, organizer answers, prompt and Cursor logs.
1. Kernel contracts: JCS, `Hash` prefixes, schemas, trust lattice and `Labelled`, errors, **full trace schema, tenant field, all ports of section 2.2**.
2. Budgets and metered effects.
3. Cassettes **and WAL, harness, broken drivers, the eight acceptance tests**.
3a. Bake-offs **1, 5, 8**.
4. Substrate. 5. Checkpoint and resume.
**8a. DSSE, signer process (ledger role), ledger core, V0 to V4a verifier core and tamper corpus (parser-free locators).**
6. Gates, labels, restrict-only enforcement, **capability and attestation roles on the signer**, SEC-I18 harness.
7. Fan-out, human steps (in-run only), kill-state gate.
9. M1 channels, **document intake 11j**, content store, doctor. **M8 compartment probes.**
10. Engines against runners; bake-off 6.
11. Synthetic silos (M1 contract first), **one document-corpus generator**, gold sets. **11b: M13 case state machine core and exposure ledger.** Then bake-offs 2 (rule corpus), 3 and 4.
**11c: M14 `ModelPort`, scripted adapter and rule-brain interfaces.**
12. **M2 DI-01 and DI-08; M5a; M3; M4; M6; M5b** (in that order), each with its acceptance line. M9 V5 `textlayer` and V6 to V8 land here.
13. Agents and prompts; pre-registration written (confirmatory only after its public commit).
14. Interfaces; M13 broker, approvals, signer capability end to end; lifecycle tests.
14a. Second pack. 15. Evaluation and independent reviews. 16. Submission kit.

---

## 6. Decisions needed from Prateek

Only human decisions and external facts. Each has a recommendation; none blocks writing code except where stated.

- **D1. A namespace you control** for the decision predicate type URL, the ledger origin name, schema `$id` values and the signed A2A card (M9 F8, M7 component 3, M10 C17). Interim `.invalid` values work for development. Recommendation: choose one stable HTTPS path under a domain or account you hold (a repository-hosted path is enough) before the first public bundle; also name two channels for publishing the verifier digest that are independent of the repository that hosts the sample bundles (M9 F11).
- **D2. Accounts and keys:** a Zetaris trial account and an NVIDIA API key (spec §22; blocks every sponsor proof and all LLM-grade metrics). Recommendation: request both now; the cassette-and-fixture path means nothing else waits.
- **D3. A second human** to review the generator and annotate a gold batch, and a domain practitioner to sign the policy rules, the gold set and the limitations block (M11 SF8, spec §1a, `04`). Recommendation: recruit through the validation plan; until then the gold tier stays `silver` and reports say `partial`.
- **D4. The judge-run platform and network-denial backend.** Node 22 has no network permission flag (M1, M2, M8, M12 agree); the options are a container or OS backend, or Node 25 or later. Recommendation: keep Node 22 as the baseline, treat Docker as optional, record the backend in every run and make the claim follow the probe; amend D-007 to say so. Also state the judge machine OS (Windows durability of `fsync` and rename is NOT VERIFIED, M9 §4.6, M13 §7.6).
- **D5. Pre-registration timing.** Recommendation: accept that confirmatory runs follow the first public commit of their pre-registration; ask the organizers in writing (F-PROCESS) whether anchoring a hash externally before the window is acceptable, and add OpenTimestamps (hash only) if yes.
- **D6. Licensing stance:** PyMuPDF (AGPL) stays a test oracle only, as spec §7 says unless you decide otherwise; OpenSanctions data (CC BY-NC) is used only locally for evaluation baselines and never shipped (spec §6, M3 SF11). Recommendation: keep both.
- **D7. Hackathon facts only the organizers can supply:** whether pre-window preparation is allowed, whether Grok Build may replace Cursor, whether the Bright Data bounty exists (spec §21 F-PROCESS, §22). Recommendation: one email, answers recorded in `DECISIONS.md`.
- **D8. Legal review (all LAWYER items):** the counterparty-notice tier, GDPR Art. 22 and sole-trader vendors, the retention default and salted-commitment status after salt destruction, jurisdiction rules that force a more permissive behaviour (M5 SF15), tipping-off wording. Recommendation: defer; no compliance claim anywhere until reviewed; the register keeps them labelled.
- **D9. Human participants:** the oversight-efficacy study (spec §18), the usability study and the evidence-first approval hypothesis (M10 C22), an accessibility reviewer for approval timing (M10 F7), a human red team (M8 T3). Recommendation: schedule after the core is built; make no claim about humans until they have run.
- **D10. Organizer-independent timestamp authority and a witness operated by someone else** (M9 stage 2). Recommendation: leave on the roadmap; a co-located witness gives no independence, and nothing in the product depends on it.

---

## 7. Top 15 integration risks, ranked

1. **Locator unit and digest kinds disagree (INT-004, INT-003).** Four modules would slice the same layer under different rules; the verifier's V5 and the browser chip could each "verify" a different string. Fix before any code in M2, M4, M9.
2. **Three release-capability schemas (INT-016).** The central security mechanism and the sponsor ablation are undefined until one object, one signed encoding and one verification order exist.
3. **V(S) has no owner and three incompatible halves (INT-034).** The exact-explanation contribution, the verifier recompute module and M6 retraction all depend on it; a late discovery means redoing M3, M4 and M5 interfaces.
4. **M5 collapses `SOR` and `VERIFIED` into one level (INT-014).** A counterparty-authored registry field can satisfy a permit condition; the "no injection adds permission" claim has a hole at the policy table.
5. **Fused-value trust rule unresolved (INT-013).** Either an attacker can downgrade any `SOR` value (availability) or a fused value can outrank a supporting input (integrity); the property tests of M8 and M3 contradict each other until decided.
6. **Approval service split three ways, and approval waiting in two places (INT-029, INT-030, INT-031).** The broker, the case lifecycle, the console and the policy queue cannot be built against each other, and expiry means two different things.
7. **M7 lacks the ports other modules assume, plus tenancy on every call (INT-056, INT-048).** Net, fs, sandbox, journal, signer, authorize, kill gate and tenant touch every module's effects; retrofitting changes slot keys and cassette formats.
8. **Network-isolation claim cannot be made on the Node 22 baseline (INT-019).** If the sponsor-facing text says "network denied" it is false on a Windows machine without a container; the guarantee table must follow the probe.
9. **No document intake path (INT-041).** The hero flow starts with an audit, a certificate and a contract, and nothing assigns their authorship, trust or rights or delivers their bytes to M2.
10. **Judge ceiling semantics and judge interface (INT-027, INT-028).** As specified the judge can only pick the floor, or the three definitions of ids, handles and dismissals produce rejected outputs on every real model; the role-necessity ablation would then measure an artefact.
11. **Build order violations (section 5, V1 to V11).** Bake-offs 3 and 4 before their data, M5 before the exposure ledger and approval queue, the verifier gate before its inputs: the quality gates as written cannot be passed in sequence.
12. **Select-from-list link judgements break edge locality (INT-036).** The exactness claims for minimal flips are void for any verdict that depends on a model-nominated link until judgements are recorded per pair.
13. **Policy IR chosen without a verifier-size criterion (INT-050).** If Cedar or OPA wins bake-off 2 on expressiveness, "two independent implementations of the recompute module" becomes expensive or dependency-bearing, undermining the offline-verifier claim.
14. **Three blob stores and two erasure designs (INT-043, INT-040).** Erasure, retention and replay guarantees (INT-040, section 4) cannot be tested if bodies live in three places with three tombstone formats.
15. **M5 has no input for document risk, the positive-evidence manifest, `canPermit`, reversibility or `releaseBlock` (INT-015).** The suppression defence, the monitoring block and the autonomy cap exist in other modules and never reach the rule engine.

---

## 8. Counts

65 items: **4 P0, 38 P1, 23 P2**, counted from the headings of section 1.

- P0: INT-004 (locator unit), INT-014 (trust levels collapsed in M5), INT-016 (release capability), INT-034 (verdict function V(S)).
- P1: INT-003, 005, 006, 007, 008, 012, 013, 015, 017, 018, 019, 020, 022, 024, 027, 028, 029, 030, 032, 035, 036, 037, 038, 040, 041, 042, 043, 046, 047, 048, 049, 050, 051, 052, 054, 056, 059, 060.
- P2: INT-001, 002, 009, 010, 011, 021, 023, 025, 026, 031, 033, 039, 044, 045, 053, 055, 057, 058, 061, 062, 063, 064, 065.

Every one of the 192 Spec-feedback items (M1 11, M2 13, M3 12, M4 14, M5 15, M6 13, M7 14, M8 15, M9 17, M10 17, M11 12, M12 13, M13 14, M14 12) is mapped in section 1b to an INT item, a guarantee-table row, a build-order correction or a decision. NOT VERIFIED: that no contradiction exists inside the blueprint components listed as unread in section 0.
