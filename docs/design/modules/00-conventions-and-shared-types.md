# Module Blueprints: Conventions and Shared Types

Every module under `docs/design/modules/` is an **implementation blueprint**: for each component it names the best known research and repositories that do that thing, says precisely what they do, states what we adopt, adapt or own, and then specifies how the component is implemented in this project. The architecture spec (`../00-architecture-master-spec.md`, v4.1) is the contract these blueprints refine. A blueprint never silently changes the spec; it records "Spec feedback" at its end when it finds a contradiction or gap. Conflicts between blueprints were settled in `99-integration-register.md` (65 items) and, for the contradictions found while applying it, in `99b-integration-register-pass3.md` (58 items, INT-101 onward); the shared types below are the resolution of both (register section 3 and pass 3), and each type names the module that owns it. Each blueprint's appended "Pass 3 resolutions" section is binding over its body until the owner folds the change in.

We own every component. "Owning" means we understand the best prior work well enough to say why each design choice was made, and we implement it ourselves, reusing a mature dependency only where a bake-off or an explicit argument says that is better. Nothing here is built; every design claim is a hypothesis with a test.

## Document template (every module blueprint)

1. **Scope and contract.** What the module is for, its inputs and outputs, the spec sections it refines, the modules it depends on and the ones that depend on it.
2. **Component list.** A numbered list; each component gets sections 3 to 9.
3. **Best references.** Verified repositories, papers, standards and specifications for this component, each with a link, what it does, and what its evaluation does not show. Prefer what is already verified in `docs/design/prior-art/` (cite the file and section), the local clones under `research/` (read the code), and add new references only when verified (GitHub metadata through `gh api`, paper pages fetched).
4. **What they actually do.** The specific algorithm, data structure or protocol, cited to a file, function or section. Distinguish what is read in code from what is claimed in a README or abstract.
5. **Decision.** Adopt (use as a dependency), adapt (re-implement the idea with changes), or own (original design), with the reason and the alternative rejected.
6. **Implementation design.** Types, algorithms in numbered steps, data formats, configuration, interfaces to other modules, concurrency and failure behaviour, determinism, security notes. Use TypeScript-flavoured pseudocode. Enough that an engineer can build it without guessing.
7. **Tests and acceptance.** Unit, property, differential and failure-drill tests by name; metrics with definitions; baselines; what would disprove the design.
8. **Risks and NOT VERIFIED.** Everything inferred but not seen; feasibility unknowns; licence questions.
9. **Build notes.** Order of work inside the component and what it unblocks.

Then, once per module: **Interfaces table** (what it exposes, who consumes it), **Spec feedback** (contradictions or gaps found in the spec), and **What this blueprint does not cover**.

## Rules for references

- Never cite from memory. A repository is cited only after `gh api repos/OWNER/NAME` has returned its stars, licence, last push and archived flag; a paper only after its page was fetched. Unverified items are labelled UNVERIFIED or omitted.
- Read code, not READMEs, for any claim about behaviour. Say which file and function.
- Licences: record the licence of every reference; code is never copied from a repository without a licence file or from a copyleft one; we re-implement the idea.
- Distinguish author-reported results from results we reproduced (none yet).
- No absolute or personal filesystem paths in any file.

## Pseudocode style

TypeScript-flavoured, strict types, no `any`. Pure functions are marked `pure`. Effects go through ports: `ctx.model`, `ctx.tools`, `ctx.clock`, `ctx.ids` (and `ctx.ids.secret`), `ctx.net`, `ctx.fs`, `ctx.sandbox`, `ctx.journal`, `ctx.store`, `ctx.ledger`, `ctx.scheduler`, `ctx.human`, `ctx.approvals`, `ctx.signer`, `ctx.keys`, `ctx.authorize`. The full port list, owners and signatures are in `99-integration-register.md` section 2.2 (with the pass 3 changes to `NetPort`, INT-149, and the new `ApprovalPort`, INT-130); a module that needs a new effect type proposes it to M7 there. `ctx.rng` is a kernel service derived from the seed, not a recorded port. `ctx.ids.secret` is generated and never recorded (INT-151). There are exactly two documented exceptions, both in M11, each with its own seeded random number generator: the data generator (byte-equal regeneration is its control) and the statistics code (bootstrap, permutation and equivalence tests; byte-equal recomputation of every report from the stored run store and seed is its control) (INT-010, INT-064, INT-108). Errors are values (`Result<T, E>`) except at process boundaries. Do not write real library calls you have not verified; write the contract.

## Shared types (the vocabulary every blueprint uses)

Each declaration names its owner. A module that needs a different shape does not fork the type; it records Spec feedback or a register item. Comments cite the register item that forced the form.

```ts
// ---------- scalars and digests (owner M7, kernel contracts; INT-003, INT-010)
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Iso = string;                                   // RFC 3339 UTC, produced by ctx.clock only
type Id<T extends string> = `${T}_${string}`;        // content-derived or ledger-assigned, prefix names the kind; the suffix uses only [0-9A-Za-z_-], never a colon (INT-102)
type RawHash    = `sha256:${string}`;                // plain SHA-256 of exact bytes; reproducible with sha256sum
type DocHash    = `jcs:${string}`;                   // SHA-256 over domain tag, newline, JCS bytes; the tag is in the tag registry (schemas/domain-tags.json, owner M7)
type Commitment = `com:${string}`;                   // com: + hex SHA-256( tag || 0x0A || u32be(len(ctx)) || ctx || salt[32] || value ); required for any hash over content above `public`, any `personal` content, and low-entropy values (INT-103, INT-104)
//   Tag: ASCII without LF or NUL, so it is self-delimiting; ctx: UTF-8 member path or id, length-prefixed (may be empty); salt: fixed 32 bytes; value: bytes per the tag's valueEncoding (`jcs`, `utf8` or `bytes`).
//   saltScope per tag: `case` (HMAC of a per-case secret with docId and path; destroyed by erasure) or `tenant` (only the account commitment, tag `plumbline/account/v1`, `utf8`, ctx empty,
//   value normaliseAccount(x) by M1; one function shared by M1's `salted_hash` mask, ReleaseBinding.accountCommit and the broker's recomputation; never destroyed by a case erasure).
type TreeHash   = `tlog:${string}`;                  // RFC 9162 leaf hash SHA-256(0x00 || entry), node hash SHA-256(0x01 || l || r), roots and proof elements, and the two cassette-layer roots; built only by M9's tree code (INT-101)
type Hash = RawHash | DocHash | Commitment | TreeHash;   // generic field; the prefix says which, so a mix-up is a parse failure
declare function pathOf(h: Hash): string;            // pure; `<kind>/<hex>` (sha256/..., jcs/..., com/..., tlog/...); no colon ever reaches a file name. Stream names and audiences split on ':' into path segments (`case:<id>` is `case/<id>`) (INT-102)
type Ppm = number; type Milli = number; type Micros = number; type Cb = number;   // integer scales; floats exist only in memory, never in a hashed, signed, recorded or cassetted document
type MinorUnits = string;                            // money: decimal string of integer minor units
type TenantId = Id<"tn">;                            // required on StepCtx, Slot, LeafV1, LedgerPort, StorePort names and cassette headers; judge path runs `tn_default` (M7, INT-048)
type RestoreEpoch = number;                          // monotonic; part of the contract audience and of the `restore.epoch` ledger leaf (owner M13, INT-016)

// ---------- trust and confidentiality (owner M8; spec section 5; INT-006, INT-013, INT-014)
type TrustLevel = "SOR" | "VERIFIED" | "EXTRACTED" | "UNTRUSTED";                // SOR most trusted
declare function combine(a: TrustLevel, b: TrustLevel): TrustLevel;              // pure; the meet (the less trusted). A fused value takes the meet over its SUPPORTING inputs only
type Confidentiality = "public" | "case-visible" | "internal-sensitive";          // plus a `personal: boolean` flag
declare function join(a: Confidentiality, b: Confidentiality): Confidentiality;  // pure; public < case-visible < internal-sensitive
type Authorship = "counterparty" | "third_party" | "authority";                   // assigned per (source, attribute) by M1; the lattice is M8's
type AuthorityTier = "authoritative" | "regulated_register" | "self_declared" | "secondary" | "synthetic";   // owner M1 (authority table)
type Producer = "record_read" | "tool_fetch" | "parser_deterministic" | "model_extractor"
              | "attestation_event" | "account_verification_event" | "derive" | "policy_constant";   // owner M8 (C1); each has a trust ceiling
interface PermLabel { trust: TrustLevel; authorship: Authorship; producer: Producer; tier: AuthorityTier }   // the key of permission-matrix.json (INT-014, INT-115)
interface LabelRecord extends PermLabel { conf: Confidentiality; personal: boolean; writeOrigin?: WriteOrigin }   // serialisable record of a label; runtime enforcement is M8's Labelled<T>, re-minted by fromStored
interface SupportLabel { group: string; label: PermLabel; origins: Id<"og">[] }   // one per supporting group of a fused fact, sorted by `group`; `origins` are M3's independence units (INT-115)
declare function permitsFact(f: Fact, cls: ActionClass, matrix: PermissionMatrix): "allow" | "deny" | "corroborate";   // pure, M8: any supporting label that denies, denies; else any `corroborate` makes it `corroborate`; else allow (INT-115)
declare function allowOrigins(f: Fact, cls: ActionClass, matrix: PermissionMatrix): number;   // pure, M8: distinct origins among supporting labels that allow the class; a `corroborate` result permits only when this is >= the pack's corroborationMin (INT-116)
type WriteOrigin = "attested" | "internal_initiated" | "system_migration" | "vendor_portal" | "vendor_email" | "unknown";   // from last_write_* columns; missing column => UNTRUSTED (INT-024)
type ActionClass = "assign_release_field" | "satisfy_manifest_item" | "count_independent_support" | "win_conflict_resolution"
                 | "add_restriction" | "write_precedent_as_supporting" | "show_to_human" | "into_privileged_prompt";   // closed list; permission-matrix.json decides each class from (trust, authorship, producer); M5 looks atoms up there and has no numeric level
type DataClassMapEntry = { foreign: string; to: Confidentiality; personal?: boolean };  // owner M12 (dataClassMap.json); an unmapped foreign class maps to internal-sensitive (INT-009)

// ---------- evidence (owner M1; locator unit decided by M2; INT-004, INT-006)
type FetchState = "ok" | "partial" | "not_found" | "not_checked" | "not_applicable"
                | "unavailable" | "blocked_by_policy" | "rate_limited" | "stale";   // erasure and replay miss are FetchError kinds (`erased`, `cassette_miss`), not states
interface LicenceStatus {
  spdx: string; termsUrl: string; termsHash: RawHash | null; verifiedOn: Iso | null; verifiedBy: string | null;
  attributionRequired: boolean; redistributable: "yes" | "no" | "unknown"; scope: "body" | "derived" | "metadata_only";
}
type ResolverKind = "bytes" | "json-pointer" | "csv-cell" | "textlayer";             // closed set; the offline verifier slices without parser code (M9 component 6)
interface Locator {                                                                  // owner M2 (units); resolver kinds consumed by M9
  kind: "url" | "record" | "doc"; ref: string; field?: string;                       // `field` is an RFC 6901 pointer into `raw`
  docSha?: RawHash | Commitment; revision?: number; layerId?: Id<"ly">; textLayerHash?: RawHash | Commitment;   // a Commitment whenever conf is above `public` or the content is `personal` (INT-104); `spanSha` of M2's SpanRecord follows the same rule
  unit?: "codepoint";                                                                // fixed; offsets below count Unicode code points; the layer is never normalised
  page?: number;                                                                     // 1-based
  start?: number; end?: number;                                                      // 0-based, end exclusive, page-relative, over the VISIBLE layer
  byteStart?: number; byteEnd?: number;                                              // UTF-8 byte offsets into the same page text; the verifier cross-checks both (V5.LOCATOR_UNIT_MISMATCH)
}
interface Evidence {                                                                 // immutable
  id: Id<"ev">;                                                                      // content-derived, includes retrievedAt of the network exchange
  channel: string; retrievedAt: Iso; effectiveAt?: Iso;
  locator: Locator; resolver: ResolverKind;
  bodyHash: RawHash | Commitment;                                                    // Commitment when conf is above public
  parsedHash: DocHash; parserVersion: string;
  authority: AuthorityTier; authorship: Authorship; licence: LicenceStatus; synthetic: boolean;
  use: "decision" | "discovery";                                                     // discovery evidence can never be cited by a decision-bearing claim
  trust: TrustLevel; conf: Confidentiality; personal: boolean;
  raw: Json; normalised: Json;
}
interface EvidenceLinks { evidenceId: Id<"ev">; supports: Id<"cl">[]; contradicts: Id<"cl">[] }   // derived index owned by M4; not part of Evidence

// ---------- facts and reconciliation (owner M3; spec section 8; INT-007, INT-013)
interface ExtractionDiag {                                                           // shape M2; the agreement states are M14's
  doubleExtracted: "agree" | "disagree" | "model_only" | "parser_only" | "single";
  quoteCheck: "exact" | "normalised" | "absent" | "not_run"; ocr?: boolean;
}
interface Assertion {
  id: Id<"as">; mentionId: Id<"mn">; attribute: string; raw: Json; norm: Json;
  source: string; originId: Id<"og">; observedAt: Iso; validFrom?: Iso; validTo?: Iso;
  recordedAt: Iso; supersededAt?: Iso; extractor: string; parserVersion: string; evidenceId: Id<"ev">;
  trust: TrustLevel; conf: Confidentiality; personal: boolean; derivedFrom: Id<"as">[]; diag?: ExtractionDiag;
  authorship: Authorship; producer: Producer; tier: AuthorityTier;                         // copied at creation from Evidence and the extractor, so pure `fuse` and the verifier never look evidence up (INT-115)
}
type CellStatus = "resolved" | "unresolved" | "silent" | "not_checked" | "unavailable";   // silent: every required channel checked, nothing says. No projection drops `silent`; M5 treats it as an absent, restrict-only input plus a gap (a hold when a positive fact is required)
type ProvRef = unknown;                                                                    // body owned by M3 component 10
type CellKey = `cell:${Id<"mn">}/${string}`;                                              // anchor mention + attribute; stable under evidence removal (INT-137)
interface Fact {                                                                           // Cell, Gap and TruthTable bodies are owned by M3 (components 10 and 14)
  id: Id<"fa">; cell: { anchor: Id<"mn">; entity: Id<"en">; attribute: string }; value: Json;   // anchor = least mention id of the entity in the base snapshot; `entity` is a derived view id and may change
  trust: TrustLevel; conf: Confidentiality; personal: boolean;
  supports: Id<"as">[]; defeats: Id<"as">[];                                               // trust = meet over `supports` only; `defeats` affect status, conflicts and gaps (restrict-only) and are hashed into the id (INT-013)
  supportLabels: SupportLabel[];                                                           // what permitsFact decides over (INT-115)
  prov: ProvRef;
}

// ---------- claims, explanation and verdicts (owner M4; spec section 9; INT-001, INT-005, INT-012)
type Label = "entailed" | "partial" | "neutral" | "contradicted" | "contested" | "unattributed" | "invalid_citation" | "fabricated_quote";
type Piece = { k: "span"; start: number; end: number } | { k: "entity"; handle: Id<"en"> } | { k: "join"; token: " and " | ", " | " " };   // span offsets: Unicode code points of the parent sentence text, 0-based, end exclusive (INT-113)
interface Claim {
  id: Id<"cl">; text: string;                                       // derived from `pieces` when present
  pieces?: Piece[]; parentRef: { doc: Id<"doc">; sentenceIdx: number };
  decomposer: "none" | `llm:${string}` | `rule:${string}` | "sentence-fallback";   // extractive atoms are the default arm; generative SAFE-style atoms are the control arm; `rule:` is a deterministic splitter (rule brain), never mixed into LLM-grade metrics
  kind: "factual" | "numeric" | "quote" | "opinion" | "meta"; citations: Citation[]; label?: Label;
}
interface Citation { evidenceId: Id<"ev">; spanIds: Id<"sp">[] }    // span ids owned by M2 (`SpanRecord`, 24 hex incl. page); the model sees per-run aliases; code supplies the quote
type Verdict = "PASS" | "FAIL" | "INDETERMINATE" | "NOT_APPLICABLE";   // the offline verifier's result (owner M9); never the word a certificate producer uses
type CertOutcome = "VALID" | "INVALID" | "INCONCLUSIVE";               // a certificate producer's own outcome (owner M4); a re-check that agrees is PASS even when the outcome is INVALID
// Other "verdict" values keep their own names (INT-111): PolicyVerdict (owner M5a: allowed set, recommended action, fired rules), ProjectedVerdict = Json (owner M4: the projection
// of a PolicyVerdict named by a certificate's projection id; V(S) returns it) and OutcomeVerdict (owner M6: the outcome class of a precedent). Never `Verdict`.
// Entailment port (owner M4, INT-112): EntailInput / EntailOutput { label, decidingSpanIds, contrarySpanIds, missingPieces: number[] }. JudgeInput / JudgeOutput are M5's policy-judge types only.
// Evaluator (V = phase2 ∘ phase1, owner M4; phase1 = M3 fuse ∘ M4 label aggregation ∘ M5a featurize; phase2 = M5a evaluate)
// and DerivationTrace: referenced here, bodies in M4 C8. ExtractionSchema / FieldSpec: normative type in M8 C9, referenced here, body not repeated (INT-022).

// ---------- decisions, approvals, autonomy (owner M5 for semantics; M13 for the service; INT-002, INT-027, INT-029, INT-031, INT-033)
type Action = "release" | "release_with_approval" | "escalate" | "hold" | "reject";   // most to least permissive; the total order is data in the policy IR (asserted by a test, used by the verifier)
interface Why { kind: "rule" | "computed" | "model_reported" | "human_reported"; ruleId?: string; codes: string[]; text: string; factIds: Id<"fa">[] }
//   a structured human decision is kind "rule" with ruleId "human.approval.<code>" bound to the signed approval record;
//   human_reported = free text from a person: stored, untrusted, rendered under "Approver's note, not an explanation", never counted by explanationCoverage.
//   The trace additionally carries decider: "code" | "model" | "human" (M7 trace schema, M14 C20).
type AutonomyLevel = "AL0" | "AL1" | "AL2" | "AL3";                                    // observe, propose, act with confirm, act; irreversible classes capped at AL2
type ApprovalItemType = "action" | "memory_write" | "rule_proposal" | "ladder_promotion" | "judge_loosening" | "dispensation" | "roster_change" | "emergency_ratify";
type ApprovalState = "pending" | "approved" | "rejected" | "expired_denied" | "superseded" | "invalidated";
interface ApprovalClocks { requestExpiresAt: Iso; approvalWindowSec: number; capabilityTtlSec: number }   // three named clocks; expiry of a pending action item moves the case to HELD (`expired_unapproved`)
interface ParamDecl { name: string; owner: string; tightenIs: "up" | "down" }          // direction registry for configuration changes (owner M13 parameters, M5 gate); unclassifiable change = loosening, two approvers (INT-033)
//   ApprovalItem, ApprovalSlot and Binds are data types of M5a (policy data, with the pure `eligible(item, principal, existing)`); bodies in M5 C13, not repeated here (INT-130).
//   The approval service is reached only through the port below, declared by M7 and implemented by M13, so M5b and M13 never import each other.
interface ApprovalPort {                                                                   // `ctx.approvals`; owner M7 (declaration), M13 (implementation)
  submit(item: ApprovalItem, ctl: CallCtl): Promise<Result<ApprovalRef, PortError>>;       // M5b creates the item and the pipeline ends at `awaiting_approval`
  get(ref: ApprovalRef, ctl: CallCtl): Promise<Result<ApprovalStatus, PortError>>;
  list(filter: ApprovalFilter, ctl: CallCtl): Promise<Result<ApprovalRef[], PortError>>;
}
interface Proposal<T> { readonly kind: "proposal"; value: T; by: string }              // owner M7 (gate types)
interface Approved<T> { readonly kind: "approved"; value: T; gate: string; verdictSeq: number }   // only gate.apply() constructs it; in-process proof, not a cross-process one

// ---------- roles, audiences, scopes (INT-008): four axes, none inferred, each a data file with tests
type SiloRole = "agent" | "buyer" | "reviewer" | "approver" | "broker";                // data-access identity (owner M1); a table maps each RbacRole to exactly one SiloRole
type RbacRole = "requester" | "buyer" | "analyst" | "reviewer" | "approver_l1" | "approver_l2" | "approver_cro" | "policy_author"
              | "policy_approver" | "auditor_readonly" | "tenant_admin" | "security_admin" | "killswitch_operator" | "platform_operator";   // owner M13
type Audience = "reviewer" | "auditor" | "counterparty";                                // owner M4 (C1)
type SignerRole = "ledger" | "decision" | "capability" | "attestation" | "control" | "erasure" | "run";   // owner M9 (component 4); `run` signs only contracts without any `act/` capability and can never sign one (INT-125). No receipt or countersign role
type ModelProfile = "sponsor" | "evaluation" | "local";                                 // run header axis 1 (owner M14 values, M8 egress entries); `local` serves confidential documents (INT-109)
type DisclosureProfile = "public_lookup" | "identifier_only" | "offline";                // run header axis 2 (owner M1); `offline` requires modelProfile `local` or mode `replay`
type Disclosure = "full" | "redacted" | "notice";                                       // owner M9; bundle tier = (Audience, Disclosure); MCP scopes are capabilities of an external client, not roles (M10)

// ---------- release: one object, one signed encoding (INT-016)
// The container is M12's ExecutionContract with scope.capabilities = ["act/po.release"] and scope.release: ReleaseBinding.
// M12 owns the container and verify/consume rules, M8 owns the binding contents and minting policy, M13 owns the broker, the nonce store and execution-time re-validation.
// Signed bytes: DSSE PAE over the JCS body. HMAC exists only in the conformance mode and the broker refuses it (alg_not_allowed).
// Verification order, one function with two names (verifyCapability = execute): envelope and pinned key; audience and time window; approvals
// (distinct subjects, segregation, assertion challenge derived from a request that covers bindingDigest = H(body without approvals) plus the single-use sessionNonce, INT-127);
// kill and revocation state; world re-validation
// (list, vendor-master and fact-set versions, supersession); fresh field equality against the ERP via the `broker` silo role; atomic consume and intent LAST.
interface ReleaseBinding {                                                                // owner M8
  caseId: Id<"case">; tenant: TenantId; episode: number; decisionId: Id<"dr">;
  payee: { vendorId: string; legalEntityKey: string };
  accountCommit: Commitment; amountMaxMinor: MinorUnits; currency: string; poRef: string; invoiceRef?: string;
  action: "payment.release" | "payment.reverse";
  reverses?: { actionId: Id<"ac">; receiptHash: DocHash; originAccountCommit: Commitment };   // required iff action is payment.reverse (INT-128): payee and account must equal the receipt's origin, amountMaxMinor <= receipt amount, never a new payee
  factSetHash: DocHash; policyBundleHash: DocHash; listVersions: Record<string, string>; vendorMasterVersion: string;
  approvals: { approvalId: Id<"ap">; approverSub: string; approverRole: RbacRole; at: Iso; assertionHash: DocHash }[];
  approvalSetHash: DocHash; attestationIds: Id<"att">[]; restoreEpoch: RestoreEpoch;
}
interface ExecutionContract {                                                             // owner M12 (container); body of `release` is M8's ReleaseBinding
  aud: `broker:${TenantId}:${string}:${RestoreEpoch}` | `run:${TenantId}:${string}`;     // broker:<tenant>:<adapter>:<restoreEpoch> for act/ contracts; run:<tenant>:<caseId> for run contracts (role `run`, INT-125)
  nbf: Iso; exp: Iso;                                                                      // act/ contracts live 120 s; the approval window and request lifetime are separate clocks
  nonce: string;                                                                           // 128-bit; consumed once through NonceStore.consumeAndRecordIntent (declared by M12, implemented by M13 twice, INT-129)
  kid: string; sigAlg: string;                                                             // closed list of asymmetric algorithms
  scope: { capabilities: string[]; release?: ReleaseBinding };                             // capabilities names use `act/` (for example "act/po.release")
}
const EXECUTION_CONTRACT_PAYLOAD_TYPE = "application/vnd.plumbline.execution-contract+json";   // DSSE payloadType (INT-106); exported by M12's contract module, imported by M8, M9, M13
interface NonceStore {                                                                     // type declared by M12 (contract module), implemented by M13 (single-writer WAL; exclusive-create file); synchronous and atomic
  consumeAndRecordIntent(nonce: string, intent: { idemKey: DocHash; aud: string; at: Iso }): Result<{ walSeq: number }, "already_consumed" | "io_error">;
}

// ---------- exposure reservations (field list proposed here; M13 component 11 owns the final shape)
interface ExposureReservation { id: Id<"rsv">; caseId: Id<"case">; vendorGroup: string; amountMinor: MinorUnits; currency: string;
                                state: "reserved" | "executed" | "released" | "expired"; ledgerSeq: number; expiresAt: Iso }
interface ExposureLedgerView { releases: { caseId: Id<"case">; vendorGroup: string; amountMinor: MinorUnits; currency: string; at: Iso }[];
                               reservations: ExposureReservation[]; ledgerSeq: number }
// TargetManifest.reversal (M13 SF5) says whether a target action is reversible; reversibility never comes from a model.

// ---------- verification and security results (owner M8, §C13; INT-006)
interface ScopedResult {                                            // every security result carries its scope
  id: string; claim: string; method: "static" | "enumerated" | "fuzzed" | "mutation" | "adversary_port" | "attack_corpus" | "probe";
  scope: { subject: string; domainSize?: string; fieldsCovered: string[]; rolesCovered: string[]; seeds: string[]; backend?: string;
           enumerated?: "full" | "per_rule_cone" | "t_wise"; t?: number };                // the last two are M8 C13's (INT-115)
  completeness: "complete" | "partial"; result: "PASS" | "FAIL" | "PENDING" | "BLOCKED"; evidence: Hash[]; commit: string; notCovered: string[];
}

// ---------- runtime (owner M7)
type ErrorClass = "transient" | "validation" | "budget" | "policy" | "fatal";   // E_CASSETTE_MISS is fatal (INT-042)
type Mode = "live" | "record" | "replay";
```

## Level and ladder names

The same letters were used for different ladders. Each ladder now has one prefix (INT-011).

| Ladder | Names | Owner | Meaning |
|---|---|---|---|
| Locator verification | `LV1` to `LV4` | M2 | offline slice check, extractor replay, second extractor agrees, render plus OCR |
| Claim verification | `L0` to `L4` (`L4a`, `L4b`) | M4 | deterministic quote check, decomposition, entailment, advocate and skeptic, exact causal layer |
| Autonomy | `AL0` to `AL3` | M5 | observe, propose, act with confirm, act |
| Defence ladder (Plumbline-Inject) | `D0` to `D5` | M8 | rungs from no defence to manifest plus double extraction; M11 uses the same rungs |
| Judge validator checks | `JV1` to `JV11` | M5 | validator checks on the judge output (`JV5` only resolves handles; `JV7`, `JV8`, `JV9` are the three outputs of M6 `validateJudgement`, INT-146) |
| Plumbline-Inject tiers | `T0` to `T3` | M8 | attacker capability tiers (spec section 17) |
| Model-cascade tiers | `MT0` to `MT3` | M14 | code, small model, mid model with samples, different-family panel (renamed from `T0` to `T3`, INT-110) |
| Verifier levels | `V0` to `V8` (`V4a`, `V4b`, `V6a`) | M9 | always written `V<n>`; the verdict function is always written `V(S)` (owner M4) |

Attack families are the ids `SEC-I01` to `SEC-I20`; `SEC-I18` has nine sub-families. Verifier verdicts (`PASS | FAIL | INDETERMINATE | NOT_APPLICABLE`) and certificate outcomes (`VALID | INVALID | INCONCLUSIVE`) never share a word. Two "profile" axes are recorded in every run header: `modelProfile` (`sponsor | evaluation | local`) and `disclosureProfile` (`public_lookup | identifier_only | offline`); the trace line's former `profile` field is `runKind` (INT-109). Across modules a bare `T<n>` is never used: runtime acceptance tests are cited `M7-T1` to `M7-T8`, lifecycle transitions `M13-T07`, M2's metric ids `DI-M0` to `DI-M12` (INT-110).

## Module dependency rules

- Dependencies point one way and the graph is acyclic at package level (INT-037). M7 Runtime and M8 Security are below everything. **M5 is split:** M5a (policy core: policy IR, interpreter, feature programs, `evaluate`, `derive`, `coneOf`, `flipSearch`, `revalidate`) depends on nothing above M7 and M8; M5b (decision pipeline: judge, critics, selective release, autonomy, approval items) depends on M3, M4, M6 and M5a.
- M1 and M2 feed M3. M3 injects `verdictOf` (M4 over M5a) and `reads` (M5a) as function values, so it depends on no module above it. M4 owns the `Evaluator` interface and the composition of `V(S)`, and depends on M3 and M5a. M6 depends on M5a, on M4's `Recompute` and on M3's `reconcile` as pure libraries; M5b depends on M6's retrieval.
- M9 consumes the outputs of M3, M4, M5 and M13; M10 consumes all; M11 tests all; M12 adapters sit at the edges of M1, M6 and the model port; M13 wraps M5's output in a lifecycle and owns the approval service, the broker and the nonce store; M14 supplies the roles that run as M7 steps. M13 depends on M5a (approval item types and `eligible`) and on M12 (the `ExecutionContract` container and the `NonceStore` type); M5b reaches the approval service only through M7's `ApprovalPort`; M12 never imports M13 (INT-129, INT-130).
- No module reads another module's internals; they exchange the typed values above and the trace.
- Every effect (network, model, tool, clock, randomness, identifiers, file writes) goes through an M7 port; the determinism lint forbids the underlying globals outside `src/runtime/adapters/**`. A module that needs a new effect type proposes it to M7 (register section 2.2).
- Every value crossing a module boundary carries `trust` and `conf` labels; the receiving module may only use `combine` and `join` to derive new labels.

## Module index

01 Source Fabric and Zetaris silo port · 02 Document Intelligence · 03 Reconcile · 04 Explain · 05 Decide (M5a policy core, M5b decision pipeline) · 06 Memory and Learning · 07 Orchestration Runtime · 08 Security Layer · 09 Audit, Bundle and Verifier · 10 Interfaces and Experience Design · 11 Evaluation and Data Generation · 12 Sponsor adapters and evidence (Meterless engines, Zetaris, Nemotron; Cursor as an evidence trail owned by the submission kit) · 13 Case Lifecycle, Action Broker and Monitoring · 14 Agents and Models · 99 Integration register.
