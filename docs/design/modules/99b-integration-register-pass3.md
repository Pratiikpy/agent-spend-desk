# Integration Register, pass 3: reconciliation of the contradictions found while patching blueprints 01 to 14

Status: design integration pass, 2026-10-13. Nothing here is built or measured. This file settles the contradictions that the fourteen patch agents reported in the "Integration revision (2026-10-13)" block of each blueprint (and in a few new Open Spec-feedback items), after the first register (`99-integration-register.md`, INT-001 to INT-065) had been applied. Ids continue from INT-101. The spec moves from v4.0 to **v4.1**; the shared types in `00-conventions-and-shared-types.md` are rewritten where a type or name changes; each affected blueprint gets an appended section "Pass 3 resolutions (2026-10-13)" and its body is left as written.

**Precedence.** Where a blueprint body and its "Pass 3 resolutions" section disagree, the appended section wins until the owner folds the change into the body. Where this file and `99-integration-register.md` disagree, this file wins (it corrects INT-016 item 5 and INT-018, INT-049 and INT-056 text; see INT-127, INT-133, INT-130).

## 0. Method, coverage, severity

**Read in full:** every "Integration revision" block of the fourteen blueprints, the Open Spec-feedback items they name (M3 item 6, M4 items 15 and 16, M7 items 15 to 18, M12 items 14 to 16, M8 F13, M13 item 12, M10 item F7), the register (all sections), the conventions file, and spec v4.0 sections 1b, 4 to 17, 19a, 20, 21a to 22. **Read to settle a point, beyond the revision blocks:** M7 component 14 (trace schema) and the profile fields; M8 C1 (producer, `PermLabel`, `permitsClass`) and C13 (`ScopedResult`); M9 component 3 (leaf registry), component 13 (commitment preimage) and component 15 (viewer contract); M13 sections 5.4, 6.4 and 17; M5 C8 (JV checks); M1 mask and `SourceMeta.rate`; M14 `ProfileSet` and tiers; M2 DI-14 (chip states). A targeted search (leaf names, profile names, tier names, signer roles, judge type names) was run across all fourteen files.

**Not covered:** see section 7. In particular the second-pass pairs of register section 0 (M3 against M4 C9 to C11; M5 C3 to C7 against M9 component 10; M13 components 11 and 12 against M1; M10 C8 to C11 against M2 DI-14 and M9 component 15; M6 C12 to C14 against M12 C2 to C4) were still not read line by line.

**Severity** as in the first register. P0: blocks a clean design. P1: needs a decision before the owning module is built. P2: wording, vocabulary or a local rule.

**Resolution rule** (spec section 2, same order as the first register): trust never rises; models propose and code disposes; failure is visible, never an empty success; nothing is claimed without a test; then the choice that makes a stranger's offline check simpler; then the choice that leaves fewer owned lines.

**Notation.** "M3 new-2" means item 2 of the "New contradictions found" list in M3's revision block; "M4 SF15" means Spec feedback item 15 of that blueprint.

## 1. Counts

58 new items (1 P0, 18 P1, 39 P2). They come from 85 statements reported in the fourteen revision blocks (many were reported by two or three modules) plus 4 points found while checking (the third `profile` word in the trace, tag spellings, hash typing of locator and span fields, colons in stream names). Of the 85 reported statements, 9 were already fully resolved by a later patch and 2 were half resolved (section 6, CF-1 to CF-11, no INT id for the closed part). Open after this pass: 5 entries keep an Open sub-point (section 5).

- P0: INT-115.
- P1: INT-101, 102, 103, 104, 116, 117, 125, 126, 127, 128, 129, 130, 131, 137, 138, 142, 149, 154.
- P2: the other 39.

## 2. Resolved items

### Group A: digests, encodings and shared names

**INT-101 [P1] Merkle tree hashes fit none of the three digest kinds.**
Modules: M9, M1, M7. Source: M9 new-1; M1 `entriesRoot`; INT-042 (two cassette Merkle roots).
Positions: M9: RFC 9162 leaf hash is SHA-256(0x00 || entry) and node hash SHA-256(0x01 || left || right); calling these `sha256:` would claim `sha256sum` reproducibility they do not have. M9 proposes a fourth prefix `tlog:`.
Resolution: adopt it. `TreeHash = "tlog:" + hex`, used only for RFC 9162 leaf hashes, node hashes, roots and proof elements, and for the two cassette-layer roots (`effectRoot`, `transportRoot`) and M1's `entriesRoot`. `Hash` becomes the union of four. C2SP checkpoints keep their own wire encoding; JSON mirrors (reports, `bundle.json`) use `tlog:`. Only M9's tree code constructs `TreeHash`; M7 `digest*` never does (so a `tlog:` value in a `RawHash` field is a parse failure).
Edits: conventions (declaration, `Hash` union); spec section 4 canonicalisation and section 1b canonical names; M9 components 2, 6, 9 (fields typed `TreeHash`, vectors); M1 `entriesRoot`, cassette manifest; M7 component 1 (parser rejects cross-kind use).

**INT-102 [P1] A colon in a prefix is not a legal Windows file-name character.**
Modules: M1, M7, M9, M12, M13. Source: M1 new-4; also `case:<id>` and `hold:<id>` stream names and `broker:<tenant>:<adapter>:<epoch>` audiences.
Positions: M1 already uses the hex part in paths; M7 and M9 stores were not told. Judge machine may be Windows (D4).
Resolution: one pure function `pathOf(h: Hash): string` returns `<kind>/<hex>` with kind in `sha256 | jcs | com | tlog` (the prefix without its colon), so `sha256:ab12..` is `sha256/ab12..` (M9's `evidence/blobs/sha256/<hex>` is already this form). Stream names and audiences are split on `:` into path segments (`case:<id>` is `case/<id>`); the inverse is unique because no `Id` contains a colon. No code path may place `:` in a file or directory name other than a drive letter; a lint (`PATH-COLON`) and a Windows CI run enforce it. Zip member names always use `/`.
Edits: conventions (`pathOf`, the rule); M7 components 1, 4, 5, 21 (store, WAL, cassette, blob names); M9 components 2, 6, 14 (bundle members, stream directories, erasure targets); M12 (`SyncJournal` stream ids); M13 (`NonceStore` files, tenant directories).

**INT-103 [P1] `Commitment`: preimage order, delimiter, salt scope, one account function.**
Modules: M7, M9, M1, M8, M13, M6. Source: M1 new-5; M7 new-2; M9 new-2.
Positions: conventions comment: SHA-256(salt || tag || value). INT-003: no delimiter, safe only if no tag prefixes another (M7 adds a registry test). M9 component 13: `"plumbline.field.v1" 0x0A || len(path) || path || salt(32) || jcs(value)`, salt derived `HMAC(caseSecret, docId || path)`, destroyed at erasure. M1: `salted_hash` mask tag `plumbline/m1/mask/v1`, salt per deployment. INT-048: per tenant. `ReleaseBinding.accountCommit` must equal what the broker recomputes from a raw read (M13), so its salt must be stable across cases and cannot be the erasable per-case salt.
Resolution: (1) One layout, owner M7 `digest.ts`: `com:` + hex SHA-256( tag || 0x0A || u32be(len(ctx)) || ctx || salt[32 bytes] || value ). Tags are ASCII without LF or NUL, so the tag is self-delimiting; the salt is fixed length; `ctx` is length-prefixed; the value is the suffix. This is M9's layout with the length encoding fixed; the registry prefix test stays as defence in depth. (2) A tag registry `schemas/domain-tags.json` (owner M7, golden-hashed) lists every tag with `valueEncoding` (`jcs`, `utf8` or `bytes`), `ctx` rule, and `saltScope` (`object`, `case`, `tenant`). Existing spellings are kept as registered (`plumbline.field.v1`, `plumbline/contract/v1`, `plumbline.test.v1`, `plumbline.approval-challenge/v1`) because vectors already exist; the registry, not a grammar, is authoritative. (3) Two salt scopes by purpose. `case` scope (M9 field commitments, M6 snapshot bodies, evidence commitments): per-case secret, destroyed by erasure. `tenant` scope: only the account commitment, tag `plumbline/account/v1`, `valueEncoding: utf8`, `ctx` empty, value `normaliseAccount(x)` (M1 owns the normaliser), salt a 32-byte tenant secret held in the tenant key hierarchy (M13) and never destroyed by a case erasure. (4) M1's `salted_hash` mask, M8's `ReleaseBinding.accountCommit` and M13's broker recomputation are the same function with the same tag and the tenant salt. Computing it inside the silo view needs SHA-256 over a concatenation in the engine's SQL; that is **NOT VERIFIED** for Zetaris until a trial account exists, and the fallback is a masked view that omits the field for the `agent` role while the adapter commits on a `broker`-role read.
Edits: conventions (`Commitment` comment, tag registry pointer); M7 component 1 (layout, vectors K-COM updated, registry file); M9 component 13 (add `u32be` length, point to the shared layout), component 14 (erasure destroys `case` salts only); M1 component 12 and `salted_hash` (tag `plumbline/account/v1`, tenant salt); M8 C5 (`accountCommit` definition); M13 section 7.4 step R (recompute with tenant salt); M6 C1 (`Commitment` is `case` scope).

**INT-104 [P1] Hashes over non-public content must be commitments, including locator and span fields.**
Modules: M2, M1, M9, M10, M4. Source: M1 new-2.
Positions: INT-041 gives intake evidence `bodyHash: RawHash`, INT-003 and INT-006 require `Commitment` above `public`; `Locator.docSha`, `textLayerHash` and `SpanRecord.spanSha` are `RawHash`, so a plain digest of a non-public document, its layer or a short quote would sit in a bundle (and bundle blob file names).
Resolution: the rule is by confidentiality, not by rights class: any hash over content whose `conf` is above `public`, or which is `personal`, is a `Commitment` (ctx = the member path or span id). This covers `Evidence.bodyHash`, `Locator.docSha`, `Locator.textLayerHash`, `SpanRecord.spanSha`, raster hashes in `evidence/derived/`. Types become `RawHash | Commitment`. The store's internal key stays a `RawHash` in a private index that is never exported; a bundle names a non-public blob by its commitment (`pathOf` gives `com/<hex>`). A verifier checks a commitment given the revealed salt in the `full` tier and reports INDETERMINATE for that member otherwise. Public-source evidence keeps raw digests (evidence mode).
Edits: conventions (`Locator`, `SpanRecord` pointer); M2 DI-01, DI-08, DI-14 (types, commit on non-public); M1 component 11j and evidence builder; M9 components 6, 13, 15 (blob naming, `ViewerCheckInput` types); M10 C8 (chip input types); M4 C3 (L0 compares `spanSha` or its commitment through the revealed value).

**INT-105 [P2] Span id domain tags: text spans and field spans.**
Modules: M2, M4. Source: M2 new-3.
Resolution: text spans (M2): `sp_` + first 24 hex of the `DocHash` of `{layer: textLayerHash, page, start, end}` under tag `plumbline/span/v1`. Field spans (M4): `sp_` + first 24 hex of the `DocHash` of `{evidence: evidenceId, pointer}` under tag `plumbline/field-span/v1` (widened from 16 to 24 hex so one `Id<"sp">` shape exists). Both tags are in the registry (INT-103).
Edits: M2 DI-08; M4 C2; M7 tag registry.

**INT-106 [P2] DSSE payload type of the one contract object.**
Modules: M12, M8, M9, M13. Source: M12 new-1.
Resolution: `application/vnd.plumbline.execution-contract+json` (the object is the contract, not a release-only capability). The `plumbline/contract/v1\n` byte form stays only for the HMAC conformance mode, which the broker refuses. M8 C5 and M9 and M13 text that says `...release-capability+json` is replaced. The constant lives in M12's contract module and is imported, not retyped.
Edits: conventions (constant); M12 C5.4; M8 C5; M9 component 4 (`capability` role claims); M13 section 6.4.

**INT-107 [P2] A fractional rate in a hashed, drift-checked manifest.**
Modules: M1. Source: M1 new-6 (INT-010).
Resolution: `SourceMeta.rate` becomes `{ minIntervalMs: number; burst: number; documentedMinIntervalMs?: number }`, all integers. No fractional requests per second anywhere in a hashed document.
Edits: M1 `SourceMeta`, doctor drift check, rate limiter.

**INT-108 [P2] Floats in evaluation documents; the second `ctx.rng` exception.**
Modules: M11, M14. Source: M11 new-1.
Positions: `Prereg`, `Interval`, `MetricResult` carry alpha, margins, MDE and bounds as floats and are hashed (E11, E23); E10's bootstrap RNG is outside `ctx.rng`.
Resolution: INT-010 applies; no evaluation exemption. Proportions, alpha, margins, MDE and interval bounds are `Ppm` integers (alpha 5% is 50000), rounded outward so an interval only widens (lower bound floored, upper bound ceiled); durations and token ratios are `Milli`; counts are integers. Floats exist inside the statistics code only. The statistics code (bootstrap, permutation, TOST) carries its own seeded RNG, the second documented exception to `ctx.rng` after the generator; the control is byte-equal recomputation of every report from the stored run store and seed. M14's `PreReg` margins and sample fields follow M11's schema (INT-060).
Edits: conventions pseudocode-style paragraph (both exceptions); M11 E10, E11, E23 (types, rounding rule); M14 C18 (margin fields).

**INT-109 [P2] Three things called "profile".**
Modules: M14, M7, M8, M10, M11. Source: M14 new-4; M7 trace line field `profile`.
Positions: the conventions record two axes, `modelProfile` (`sponsor | evaluation | local`) and `disclosureProfile` (`public_lookup | identifier_only | offline`). M14 `ProfileSet.name` is `sponsor | evaluation | local-confidential | offline`, which mixes the two axes. M7's trace line also has `profile: sponsor | evaluation | baseline | scripted | judge-replay`, a run kind.
Resolution: M14's `ProfileSet.name` is the shared `ModelProfile` (`sponsor | evaluation | local`); `local-confidential` is renamed `local`; `offline` is removed from it (it is a `DisclosureProfile`). M7's trace field `profile` is renamed `runKind` (same value set). Egress: `local` has an `EgressEntry { sink: "model:local", hosts: loopback only, maxConf: "internal-sensitive", disclosures: [] }`; `disclosureProfile: offline` loads a manifest with no source-channel entries (sources serve cassettes or return `blocked_by_policy`) and keeps only loopback model entries. Constraint: `offline` requires `modelProfile: local` or `mode: replay`, asserted at run start.
Edits: conventions (types `ModelProfile`, `DisclosureProfile`); spec sections 5 and 15; M14 C13, C15; M7 component 14 trace example; M8 C3 (entry for `local`, offline filter); M10 run-header display names.

**INT-110 [P2] Tier and test names that collide.**
Modules: M14, M8, M2, M7, M13, M11. Source: M14 new-3; M2 metric ids.
Resolution: model-cascade tiers are `MT0` to `MT3` (M14 `Tier` type renamed); Plumbline-Inject tiers stay `T0` to `T3` (spec section 17). Bare `T<n>` is not used across modules: runtime acceptance tests are cited `M7-T1` to `M7-T8`, lifecycle transitions `M13-T07`. M2's metric ids `M0` to `M12` are cited `DI-M0` to `DI-M12` everywhere outside M2 and wherever "M" could be read as a module. The level-and-ladder table gains these rows.
Edits: conventions table; spec section 1b table; M14 (read `T0..T3` of the cascade as `MT0..MT3`); M2 (metric ids); M7, M13 (cross-module citation form).

**INT-111 [P2] The `Verdict` family.**
Modules: M4, M5, M6, M9, M10, M11. Source: M4 new-1; M5 new-1; M6 `OutcomeVerdict`.
Resolution: `Verdict` is the offline verifier's result only (M9). M5a's rule-engine output is `PolicyVerdict` (allowed set, recommended action, fired rules). M4's `ProjectedVerdict = Json` is the projection of a `PolicyVerdict` named by the certificate's projection id (so `V(S)` returns a `ProjectedVerdict`). M6's precedent outcome is `OutcomeVerdict`. Any text using `Verdict` for M5's value or M4's projection reads the new name.
Edits: conventions (declarations); M4 C15 and C8; M5 C1, C15, C16; M6 outcome records; M9 component 10; M10 C6; M11 E5, E14.

**INT-112 [P2] Two shapes for the L2 entailment judge, and a name collision with M5.**
Modules: M4, M14, M5. Source: M14 new-2.
Resolution: M4 owns the L2 port. Its types are renamed `EntailInput` and `EntailOutput`; `JudgeInput` and `JudgeOutput` are M5's policy-judge types only. `EntailOutput = { label, decidingSpanIds, contrarySpanIds, missingPieces: number[] }` (indices into `Claim.pieces`; empty unless `partial`). M14's `EntailmentVerdict` is retired as an alias of `EntailOutput`; M14 supplies prompts, agreement and the panel, not the type. `Voter.out` is `EntailOutput | "abstain"`.
Edits: conventions (pointer); M4 C6 and the L2 interface; M14 C8 (use `EntailOutput`).

**INT-113 [P2] `Claim.decomposer` has no value for the rule brain; `Piece` offsets have no unit.**
Modules: M4, M14. Source: M14 new-1.
Resolution: `decomposer: "none" | "llm:<id>" | "rule:<id>" | "sentence-fallback"`; `rule:` marks a deterministic splitter and is never mixed into LLM-grade metrics. `Piece` span offsets are Unicode code points of the parent sentence text (0-based, end exclusive), the same unit as locators.
Edits: conventions (`Claim`, `Piece`); M4 C5; M14 C7, C16.

**INT-114 [P2] `WriteOrigin` value sets differ.**
Modules: M1, M11, M8. Source: M11 new-3.
Resolution: the shared `WriteOrigin` (`attested | internal_initiated | system_migration | vendor_portal | vendor_email | unknown`) is normative. M1's values (`internal_user`, `system_import`, `vendor_email_request`) are mapped by a data table in the silo contract (`fromErpOrigin`), with an unmapped value becoming `unknown` (default-deny, INT-024). The generator emits shared values.
Edits: M1 component 12 (contract mapping table); M11 E2 (already uses shared); M8 C4 (reference only).

### Group B: labels, permission, judgement

**INT-115 [P0] The permission matrix needs authorship and producer on every path, and fused facts and assertions carry neither.**
Modules: M3, M5, M8, M9, M2, M12, M1. Source: M5 new-2; M8 new-1; M3 new-2.
Positions: `permitsClass(label, class)` is keyed by (trust, authorship, producer). The shared `LabelRecord` is `{trust, conf, personal}`, `Assertion` has the same three, and `Fact` carries only a meet trust. M5 therefore cannot call `permitsClass` for any fused value; the INT-014 hole (a counterparty-authored `VERIFIED` field satisfying a permit condition) reopens at the point where M3 hands facts to M5. M3 added `Cell.supportLabels` locally; M8 wants `PermLabel` in the shared file.
Resolution: shared types gain `Producer` (M8 C1's eight values), `PermLabel { trust, authorship, producer, tier }`, `LabelRecord extends PermLabel { conf, personal, writeOrigin? }`, and `SupportLabel { group, label: PermLabel, origins: Id<"og">[] }`. `Assertion` gains flat `authorship`, `producer`, `tier` (copied at creation from `Evidence` and the extractor, so the pure `fuse` and the verifier never look the evidence up). `Fact` gains `supportLabels: SupportLabel[]` (sorted by `group`) beside its meet `trust`; `defeats` stay out. Decision of a class for a fact is the pure `permitsFact(fact, class, matrix)` in M8 next to `permitsClass`: any supporting label that denies, denies; otherwise any `corroborate` makes the result `corroborate`; otherwise `allow`. A second pure function `allowOrigins` counts the corroborating origins (INT-116). `featurize` calls it; the verifier loads the same data. `RegistryRecord` drops its own `producer` field (now inherited). `ScopedResult.scope` gains `enumerated?: "full" | "per_rule_cone" | "t_wise"` and `t?: number` (M8 C13).
Edits: conventions (types above); M3 components 1, 10 (assertion fields, `Fact.supportLabels` replaces `Cell.supportLabels`); M5 C1, C2 (`featurize` uses `permitsFact`), C16 step 1; M8 C1 (`permitsFact`, tests `SEC-L10` extended to facts), C2, C13; M9 component 10 (loader and V6a); M2 DI-05 (extractor producer ids); M12 World Model facade persists the new fields; M1 evidence builder supplies `authorship`, `tier`.

**INT-116 [P1] Independent-origin count for `corroborate`.**
Modules: M5, M3, M8. Source: M8 new-3.
Positions: `permitsClass` returns `corroborate` for counterparty-authored `VERIFIED` fields; INT-014 says only "a requirement on the independent-origin count feature", which no module defines.
Resolution: `featurize` emits, per fact and class, the integer feature `support.<f>.allowOrigins.<class>` (M8's `allowOrigins`) = the number of distinct origin ids (M3's independence units, same-origin duplicates once) among supporting groups whose own label returns `allow` for the class. The atom `permits(f, class)` is true iff `permitsFact` returns `allow`, or returns `corroborate` and the feature is at least `corroborationMin`. `corroborationMin` is a pack parameter in the policy bundle (`ParamDecl`, `tightenIs: "up"`), default 1, so a counterparty-authored value counts only with one independent authoritative origin behind it. Counterparty duplicates never raise the count (authorship `counterparty` returns `corroborate`, not `allow`).
Edits: M5 C2 (feature row, `T-FE` test), C6 (invariant I7 covers the new input); M3 (supply `origins` per support group, already in INT-115); M8 C1 (the matrix and tests).

**INT-117 [P1] `claim.<id>.canPermit`: flag or matrix lookup.**
Modules: M4, M5. Source: M4 SF16 (Open).
Resolution: M5a derives the feature itself. M4 publishes the claim's label chain as a `PermLabel` (the meet over the chain per INT-115 rules, plus whether any link is `UNTRUSTED`); `claim.<id>.canPermit` is computed by M5a as `permitsClass(chainLabel, "satisfy_manifest_item") === "allow"`. The recompute module can then re-derive it from recorded labels (V6a). M4's boolean flag is a display copy; a test asserts equality. A missing chain label means not permitting.
Edits: M4 C6 item 10 (publish `chainLabel`), SF16 closed; M5 C2 (feature definition).

**INT-118 [P2] Labels on M2 outputs: inherit, never raise.**
Modules: M2, M1, M8. Source: M2 new-2.
Resolution: every M2 output (`SpanRecord`, field candidates, findings, completeness) is labelled by M8's `fromSource` from the document's `Evidence`: `conf` is the document's, `personal` is the document's, `authorship` and `tier` are the document's, `producer` is `parser_deterministic` or `model_extractor`, and `trust` is `UNTRUSTED` when the document's authorship is `counterparty` or `third_party`, otherwise the meet of the document trust and the producer ceiling. Findings are used only as `add_restriction`.
Edits: M2 section 1 and DI-05, DI-08; M8 C9 (cite); M1 11j (labels at intake are the inputs).

**INT-119 [P2] Extraction field kinds for names and free text.**
Modules: M2, M8, M3. Source: M2 new-4.
Resolution: confirmed as proposed. A counterparty name, a clause or any free text field is kind `span_ref` (the value is the span; code derives the string from the layer by span id); amounts are `decimal`; dates `date`; identifiers `id`; enumerations `enum` with anchors; there is no free-string kind. M3 reads name text from the layer through the span id.
Edits: M2 DI-08, DI-11; M8 C9 (kind table entries for names).

**INT-120 [P2] `ExtractionDiag` has five agreement states.**
Modules: M14, M3, M8, M2. Source: M3 new-6; M3 INT-022.
Resolution: five states, `agree | disagree | model_only | parser_only | single`. `single` means one extractor ran. It is evidence of neither agreement nor disagreement, and on a `holdRelevant` field it is itself a gap `single_extraction` (restrict-only: a release-enabling fact with `single` is not corroborated, M8's double-extraction rule). `disagree`, `model_only`, `parser_only` become conflict items for M3.
Edits: M14 C4 (state table); M3 component 7 step 1; M8 C9 (rule).

**INT-121 [P2] "Missing means level 0" survives where numeric levels were removed.**
Modules: M5, M2, M4. Source: M2 new-1.
Resolution: INT-015's wording "level 0" is replaced by "absent and restrict-only": a missing, unknown, not-checked or unavailable input evaluates every `permits` atom to false and every hold atom to true. No numeric level exists in M5.
Edits: M5 C2 (feature registry wording); M2 DI-05, DI-11 (state "can only hold"); M4 C6 item 10.

**INT-122 [P2] Judge validator: membership test and judge failure.**
Modules: M5, M14. Source: M8 new-6; M14 new-5.
Resolution: (a) The validator tests `s ∈ A` for every selection, including `s ⪯ r` (no shortcut). The policy IR additionally asserts that `A` is downward closed in the permissiveness order (test `T-IR`), so a restriction of an allowed recommendation is always allowed. (b) When the judge fails at the end of the ladder (no valid output after the allowed retries, or the call fails), the selection is `r`, the record carries `judgeFailed: true` with the code, and the selective-release gate treats `judgeFailed` as outside the certified region (abstain to the full-review lane). It never loosens and never silently looks like a judged decision.
Edits: M5 C8 (JV2 unchanged, add the failure branch), C10 (region condition `judgeOk`), C1 (`T-IR` downward-closure assertion); M14 C9 (cite).

**INT-123 [P2] Stale egress wording in M4.**
Modules: M4. Source: M4 new-6.
Resolution: M4 C20 item 6 reads: "no value above its declared egress class leaves, except at declared disclosure parameters where only the minimised form leaves; model prompts are an egress sink capped by the model profile" (spec section 5 and 9a).
Edits: M4 C20.

**INT-124 [P2] Document analysis is class A replay.**
Modules: M2, M7, M10. Source: M2 new-5.
Resolution: the sandboxed document call is a slot-keyed effect `(docSha, pipelineVersion) -> analysisHash` (INT-042), so a novel document in replay is `E_CASSETTE_MISS`. Document analysis is therefore class A (recorded inputs), not class B. Because it is local deterministic code that needs no key and no network, it runs in `live` mode on any new document with no credentials; the miss message prints the exact live command. Class B (any input in replay) stays: rule engine, reconcile from recorded links, verifier.
Edits: spec section 15 (replay classes sentence); M2 interfaces table ("replayable on any input" removed); M10 C6 (message); M7 component 19 (list).

### Group C: signer, approvals, release, ledger names

**INT-125 [P1] Signer roles for run contracts, broker receipts and approval countersign.**
Modules: M9, M12, M13, M8. Source: M12 new-2; M13 new-2.
Positions: INT-017's six roles have no role for a contract without `act/` (the Scout run contract issued at intake); the `capability` role demands an `approval.granted` proof. M12 proposed a `run` role or an in-process `Ed25519Signer`. M13 removed both a broker-receipt key and an approval-countersign key (receipts are bound by ledger leaf and WAL chain).
Resolution: add a seventh role `run` to M9's set: `ledger | decision | capability | attestation | control | erasure | run`. Policy: signs only a contract whose `scope.capabilities` contains no `act/` entry, whose `aud` is `run:<tenant>:<caseId>` and whose TTL does not exceed the run budget; a `run` key id on any `act/` contract fails verification. No in-process private key (it would defeat key isolation). No `receipt` role and no countersign role: broker receipts are `action.*` leaves signed through the ledger checkpoint; approvals are WebAuthn assertions by the approver, recorded in `approval.granted` leaves.
Edits: spec sections 5, 13; conventions (`SignerRole` type); M9 component 4 (role, policy, `SignRequest` union, vectors); M12 C5.4 (`ProcessSigner` uses `run`); M13 sections 6.4, 17.3 (role list); M8 C18.

**INT-126 [P1] Where WebAuthn credential public keys live, and who checks assertions.**
Modules: M9, M13, M8. Source: M13 new-4; M8 new-4.
Resolution: credential public keys live in the ledger as enrolment leaves. Registry additions (stream `deploy`, per-tenant tree): `approver.enrolled` (subject: commitment of the enrolment record, attrs: `credentialIdHash`, role; the record `{approverSub, credentialId, publicKey (COSE), alg, rpId, origin, enrolledBy[], at}` is held in the case-visible partition) and `approver.revoked`. Enrolment is a `roster_change` approval item needing two distinct approvers (`tenant_admin` and `security_admin`); the first enrolment at tenant creation is a `control`-role bootstrap leaf flagged `bootstrap: true`, which the `control` policy allows only while the tenant has no enrolled approver, and which is listed as a trust-root assumption in the verifier's "what this does not prove" text. The signer's capability policy resolves an approver's key by inclusion proof of the newest unrevoked `approver.enrolled` leaf in a checkpoint it already signed. One pure primitive `verifyAssertion(assertion, expectedChallenge, enrolment)` (about 150 lines on `node:crypto`, owner M8, no dependencies) is used by M13 when accepting an approval and by the signer when signing; the two cannot disagree.
Edits: M9 component 3 (leaf registry rows), component 4 (policy, imports the primitive); M13 section 5.4 (uses enrolment leaves; revocation invalidates pending approvals), section 15; M8 C16 (primitive); spec section 13 and 9a row "Approvals and segregation of duties".

**INT-127 [P1] The approval challenge includes a ceremony nonce; INT-016 item 5 is corrected.**
Modules: M13, M8, M9. Source: M13 new-1.
Positions: INT-016 item 5: challenge equals H(body without approvals). M13: challenge = H(tag || requestHash || sessionNonce), where `requestHash` covers `bindingDigest` (the digest of the binding without `approvals` and `approvalSetHash`), `requestExpiresAt` and the request nonce.
Resolution: M13's form stands; dropping the nonce would let an old assertion approve a re-issued identical request after expiry (a replay that defeats approval expiry). The invariant that matters is binding: the signer and the broker recompute `bindingDigest` from the contract body, require it to equal the request's `bindingDigest`, recompute `requestHash` and the challenge from the record's stored `sessionNonce` (the single-use WebAuthn ceremony nonce) and verify the assertion over that challenge. The tag is `plumbline.approval-challenge/v1` (INT-103 registry). INT-016 item 5 is read as "the challenge is derived from a request that covers H(body without approvals)".
Edits: M8 C5, C16 (accept); M13 section 5.4 (unchanged, named normative); M9 component 4 (signer check order).

**INT-128 [P1] A reversal needs its own binding; one `approval.granted` leaf per accepted record.**
Modules: M8, M13, M9, M12. Source: M13 new-5.
Positions: `ReleaseBinding.action` allows `payment.reverse` but has no field tying a reversal to the payment it reverses; M13 expresses origin-only reversal by setting `payee` and `accountCommit` to the original origin, which a reviewer cannot distinguish from a release to a new payee. M9 describes `approval.granted` as one leaf; M13 emits one per accepted `ApprovalRecord`.
Resolution: `ReleaseBinding` gains `reverses?: { actionId: Id<"ac">; receiptHash: DocHash; originAccountCommit: Commitment }`, required iff `action === "payment.reverse"` and forbidden otherwise. For a reversal the broker's field-equality stage compares payee and account to the referenced receipt's origin (not to the vendor master), requires `amountMaxMinor` at or below the receipt amount, and refuses any new payee. Minting policy (M8): one approver at `AL2`, never `release_with_approval`, reversal only where `TargetManifest.reversal` allows it. `approval.granted` is one leaf per accepted record; the capability policy requires one inclusion proof for every entry of `ReleaseBinding.approvals[]`, not one in total.
Edits: conventions (`ReleaseBinding`); M8 C5 (minting rule); M13 section 7.4 (reversal path), 6.4; M9 component 3 (registry text), component 4 (one proof per approval); M12 C5.4 (container carries the field).

**INT-129 [P1] `NonceStore` against `ConsumedWal`, and the M12 to M13 dependency direction.**
Modules: M12, M13, M8. Source: M8 new-5; M12 new-5 (shape already adopted).
Positions: INT-016 gives M12 the consume rules and M13 the store; M12's `consume` calls an M13 port while M13 imports M12's `verifyContract`: a package cycle.
Resolution: the interface is declared where it is consumed. M12's contract module exports the type `NonceStore { consumeAndRecordIntent(nonce, intent): Result<{ walSeq: number }, "already_consumed" | "io_error"> }` (synchronous, atomic); `consume(verified, store, idempotencyKey)` takes it as a parameter. M13 imports the type and supplies two implementations (single-writer WAL with fsync; exclusive-create file). `ConsumedWal` and `FileWal` are retired as names except as test doubles inside M12 tests. M8's `SEC-A6` and `SEC-A7` and M12's `SC-ORD-01` inject either implementation. The dependency is M13 depends on M12, never the reverse.
Edits: conventions (type, dependency rule); M12 C5.5 and facade; M13 section 7.4, 26; M8 C5 tests.

**INT-130 [P1] `ApprovalItem`, `ApprovalSlot`, `Binds`, the service port, and the M5b to M13 cycle.**
Modules: M5, M13, M7, M8, M10. Source: M5 new-4.
Positions: INT-029 says `ApprovalItem` is shared but the shared file declares only the enums; M5b creates items and reads their state, M13 implements the service and consumes item semantics from M5: without a placement M5b and M13 import each other.
Resolution: the data types `ApprovalItem`, `ApprovalSlot`, `Binds` and the pure eligibility function `eligible(item, principal, existing)` live in M5a (they are policy data and policy code, below M3, M4, M6). The service is reached through a port `ApprovalPort` declared by M7 (`ctx.approvals`): `submit(item): Result<ApprovalRef>`, `get(ref): Result<ApprovalStatus>`, `list(filter)`; M13 implements it. M5b depends on the port; M13 depends on M5a types and `eligible`; M10 routes call M13 directly. Graph: M13 to M5a to M7, M5b to M7 port.
Edits: conventions (types by pointer, `ApprovalPort` sketch, dependency rule); spec section 4 port list; M5 C13 (types placed in M5a), C16 (calls the port); M13 sections 5.3, 5.4; M7 component 4 (port row); M8 (principal types) and M10 C11 (unchanged routes) cite.

**INT-131 [P1] Approval re-issue, extension, claim lock and the provisional read.**
Modules: M13, M10, M5. Source: M10 new-3.
Positions: `requestExpiresAt` sits inside the hashed request, so "Extend review" can only be a re-issue, and M13 defines neither a re-issue nor a claim lock; `ApprovalRecord` has no place for the provisional read recorded before the recommendation is revealed, and `evidenceOpened` keeps only `{evidenceId, at}`.
Resolution: M13 adds an `ApprovalSession` keyed by (`bindingDigest`, principal), not part of any hashed request: `{ provisional?: { action: Action | "need_info"; reason?: string; at }, evidenceOpened: { evidenceId, spanIds: Id<"sp">[], openedAt, visibleMs: number }[], claimedUntil? }` (integer milliseconds). `ApprovalRecord` carries `sessionDigest: DocHash` in place of the thin `evidenceOpened`. Extension is `reissue(requestId, reason)`: allowed only while pending and at most `maxReissues` times (pack parameter, default 2) within `maxRequestLifetimeSec`; it creates a new `ApprovalRequest` with the same `bindingDigest`, a fresh `nonce` and `requestExpiresAt`, `supersedes: oldRequestId`; the old request becomes `superseded` and records on it become `invalidated` (a fresh assertion is required). The session persists across re-issue because it is keyed by `bindingDigest`. The claim lock is an advisory `claimedBy` with a TTL of at most 60 seconds, renewed by heartbeat, per slot, not hashed. Routes `provisional`, `evidence-opened`, `extend` write to the session or call `reissue`.
Edits: M13 section 5.4 (entities, transitions, tests); M10 C11 (routes proxy these), C13; M5 C13 (`maxReissues`, `maxRequestLifetimeSec` as parameters with `ParamDecl`).

**INT-132 [P2] Who hosts the attestation workflow.**
Modules: M8, M13, M9. Source: M8 new (host unnamed); M13 section 1052 ("belongs with M8").
Resolution: split. M8 owns the design and the checks: the `AttestationEvent` schema, the two-channel rule for high-value changes, callback-contact provenance, the `attestation` signer policy and the `SEC-W*` and `SEC-I19`/`SEC-I20` tests. M13 hosts execution: an `AttestationTask` in its task queue (assignment, SLA clock, authenticated principal, evidence capture), created by a hold reason `attestation_needed`, not a new case phase and not an approval item; its completion appends `attestation.recorded` and calls the signer under the `attestation` role. The person who records the callback is neither the requester nor the vendor-master editor of record.
Edits: M8 C4 (names M13 as host); M13 section 5 (task type, no state-machine change); M9 component 3 (leaf `attestation.recorded`).

**INT-133 [P2] One ledger leaf vocabulary.**
Modules: M9, M5, M6, M7, M12, M13. Source: M5 new-3; M6 new-1; M7 new-1, new-18; M9 new-3, new-4.
Resolution: M9's registry is normative and gains: stream `deploy`: `approver.enrolled`, `approver.revoked` (INT-126), `writer.epoch` (INT-134); stream `policy`: `policy.proposed`, `policy.activated`, `policy.emergency_tightened`, `policy.lapsed` (beside `policy.published | approved | superseded`), `autonomy.promoted`, `autonomy.demoted`, `autonomy.frozen`; stream `case:<id>`: `attestation.recorded`. Retired names and their replacements: `release.intent` is `action.intent` and `release.result` is `action.executed` plus `action.confirmed` (INT-018 text corrected); `erasure.receipt` is `erasure.completed` (M13 emits it); `mem.head`, `hmem.head` and `memory.written` are `memory.head` (stream `memory`, `attrs.engine` says `hmem` or the M6 log name; the subject is a record of all heads); `fact.asserted` and `claim.verified` are not leaves, stage outputs are `stage.committed`. Autonomy leaves let the level at any time be recomputed from the ledger (M5).
Edits: M9 component 3 registry table; M5 C12, C13 (names); M6 C1 (adopt `memory.head`, log heads as payload); M7 component 15 (leaf list in "what gets a leaf"); M12 (`hmem.head` is a payload field of `memory.head`); M13 (`erasure.completed`).

**INT-134 [P2] Ledger writer fencing.**
Modules: M9, M7. Source: M9 new-4.
Resolution: the single-writer lock records `{writerId, epoch}`; a takeover increments `epoch` and appends the leaf `writer.epoch { epoch, prevEpoch, reason }`; every `append` carries the epoch and a stale epoch is refused with `E_LEDGER_FENCED` (new code in M7's error registry; `E_LEDGER_LOCKED` still means lock held). Windows exclusive-create and rename semantics are NOT VERIFIED (D4).
Edits: M9 component 3 (lock record, rule, test `T-PORT-04`); M7 components 15 and the error registry.

**INT-135 [P2] Per-tenant trees and deployment-wide policy.**
Modules: M9, M5. Source: M9 new-5.
Resolution: policy lifecycle leaves are written into the tree of each adopting tenant (the judge path has one). There is no deployment-wide policy leaf. A bundle shared by tenants is identified by `policyBundleHash` (a `DocHash`) and listed in a signed `policy-catalogue.json` outside the ledger whose digest each tenant's `policy.published` payload cites.
Edits: M9 component 2 (statement); M5 C12 (write per adopting tenant).

**INT-136 [P2] Human decisions in the verifier's reason check.**
Modules: M9, M5, M10. Source: M9 new-6; M10 new-5.
Resolution: `human.approval.<code>` reasons cannot be recomputed by V6 and are not explanations. A new check `V6h` verifies instead that the bound `approval.granted` or `approval.denied` leaf exists in the ledger with the same `decisionCode` and an inclusion proof, and counts these in a separate figure `humanDecisionCoverage`. `explanationCoverage` excludes them (consistent with M10's "recorded human decision" badge and M5's treatment).
Edits: M9 component 10 (V6h), report fields; M5 C15 (record the code); M10 C6, C10 (badge text unchanged, coverage figures separate).

### Group D: reconcile, explain, memory

**INT-137 [P1] Cell keys must not depend on entity ids.**
Modules: M3, M4, M6, M5, M9. Source: M3 new-1; M6 new-8.
Positions: entity ids are membership-derived and change with the present evidence set, so `cell:<entityId>/<attribute>` is not a fixed key set for `Evaluator.keys()` (M4 C8 obligation 3) and `SemanticMemoryPort.subject: Id<"en">` is unstable.
Resolution: the key is `CellKey = "cell:" + anchor + "/" + attribute`, where `anchor` is the least `mn_` id (string order) among the mentions of the entity in the base snapshot E. Under `V(S)` the cell is that of whichever entity contains the anchor mention under S; M3 defines the status of a cell whose anchor mention has no assertion left (restrict-only: absent). `Fact.cell` carries `anchor` and keeps `entity` as a derived view id. M4, M5, M6 and the certificate refer to cells by `CellKey` only.
Edits: conventions (`CellKey`, `Fact.cell`); M3 components 1, 10, 14; M4 C8 (key set); M6 `SemanticMemoryPort.subject` becomes `CellKey`, `UsedIds.factIds` keyed by anchor; M5 C15 (`reads`, `fieldDeps` keys); M9 component 10 (certificate keys).

**INT-138 [P1] A size budget for the verifier-side reconcile check.**
Modules: M3, M9, M5. Source: M3 new-4.
Positions: INT-050 makes a roughly 500-line policy interpreter a gating criterion, but the verifier also re-implements reconcile (rank vectors, clustering, repair, set packing, bracketing) with no budget.
Resolution: the recompute module (V6 to V8) is budgeted at about 1,200 non-test lines per language: about 500 for the policy interpreter and about 700 for the reconcile check. The reconcile check recomputes only what is closed-form over recorded data: rank-vector resolution, clusters from recorded edges and cannot-links, cell status, `defeats` completeness, the trust meet. Searches (minimal repairs and hitting sets, set packing, bracketing, admissible-clustering enumeration) are not re-run: the producer ships a witness (a hitting set with the list of sets it misses for minimality, a packing, a bracket pair) and the verifier checks it in polynomial time; where no witness format exists the member is INDETERMINATE (`V6.NO_WITNESS`), never PASS. Any new reconcile feature must be closed-form or ship a witness format, as a gating criterion for M3 Stage B. The figure is a design target and NOT VERIFIED until two implementations exist.
Edits: M3 component 16 and interfaces (witness formats, criterion); M9 component 10 (budget, `V6.NO_WITNESS`); M5 C5 (cite).

**INT-139 [P2] Quotes that cross a page break.**
Modules: M4, M2, M9. Source: M4 new-4, SF15 (Open).
Resolution: locators are page-relative and a `SpanRecord` is single-page, so a cross-page quote is an ordered list of per-page fragments in `Citation.spanIds` (order significant). M2's layer emits a join hint of kind `page_break` per page boundary giving the trimmed first and last visible offsets; `linebreak_hyphen` hints apply across the break. L0 passes the quote as `exact_cross_page` only if each fragment matches exactly and fragment i ends at the last visible code point of its page and fragment i+1 starts at the first visible code point of the next page (whitespace trimmed). V5 checks each fragment independently; adjacency is checked by L0 only, and the report says so (a stated limit, not a gap).
Edits: M4 C3 (status, SF15 closed); M2 DI-01 (hint kind), DI-08; M9 component 9 (limit sentence).

**INT-140 [P2] Link-judgement call arithmetic.**
Modules: M3, M14, M7. Source: M3 new-3.
Resolution: constants live in M3's `LinkConfig`: `callsPerNominatedPair = 4` (select in both orders, confirm in both orders), `maxModelCallsPerCase = 12` (so three confirmed pairs), and the `locality: "set"` fallback costs 2 per pair (six pairs). M14 C6 reads both from `LinkConfig`; M7 reserves `maxModelCallsPerCase` times the per-call cap. Packs may override with an ADR.
Edits: M3 component 6; M14 C6, C15; M7 component 7 (reservation source).

**INT-141 [P2] Product views are order-independent; engines are arrival-ordered.**
Modules: M3, M12. Source: M12 new-4.
Resolution: confirmed. Closure of single-valued edges and winners in M3's views are computed by valid time, then the rank vector, never by arrival order; arrival order enters no product view. The World Model engine's arrival-ordered behaviour is the `conformance` profile only.
Edits: M3 component 8 (sentence and test `RC-8.8`); M12 C3.4.

**INT-142 [P1] H-MEM facade requirements the register's MATCH did not check.**
Modules: M6, M12. Source: M6 new-2.
Resolution: bake-off 6 gains requirement R-HM5 on the H-MEM facade used by the product profile: (1) `retrieve(query, { threshold, rerank, snapshot })` applies `threshold` to the base score before `rerank`; (2) results carry `scoreMicros: Micros` computed as round-half-even of the float score times 10^6 (floats stay in memory); the four-decimal string exists only in the conformance runner view; (3) reads never mutate ranking, `recordRead` is a separate call; (4) `peek` is not used, `snapshot()` plus pure `retrieve` is the contract. M6 gates on the base score then multiplies its published factors.
Edits: M12 C2.4 and C6.4 (R-HM5); M6 C5 (reads the contract), C14.

**INT-143 [P2] Host-built Markovian carryover.**
Modules: M12, M6. Source: M6 new-3.
Resolution: R-MK1 is made concrete: in the product profile the carryover block is built by host code from typed state (fact ids only); the model may propose additional ids, which `CarryoverPort` validates against the World Model; any state text the model writes is discarded. The `conformance` profile is unchanged.
Edits: M12 C4.4, C6.4; M6 C14.

**INT-144 [P2] Engine scope promotion has no counterpart in M6.**
Modules: M12, M6. Source: M6 new-4.
Resolution: the product profile sets `includeUnscoped: false` and has no call site for promotion to global scope (a static test `no-scope-promotion`); the capability stays in the engine for conformance. Cross-case use of memory is only M6's whitelist projection by pack and decision type. No new approval item type.
Edits: M12 C3.4, C6.4; M6 C5 (statement).

**INT-145 [P2] Erased episodes in retrieval.**
Modules: M6, M5, M9. Source: M6 new-5.
Resolution: an erased episode is `unevaluable{erased}`: excluded from `support`; shown in `counters` only as a header (action, outcome class, `decidedAt`) when its action is restrictive-direction; it can be dismissed only with `outcome_unverified`, not `fact_differs` or `rule_changed` (not evaluable); M6's predicate for `outcome_unverified` is extended to hold when the outcome is unobserved or the episode is `unevaluable{erased}`. M9's "counter-only" and INT-040's `unevaluable` are the same state.
Edits: M6 C1, C5; M5 C9 (cite); M9 F16 reading.

**INT-146 [P2] Judge validator checks overlap M6's `validateJudgement`.**
Modules: M5, M6. Source: M6 new-6.
Resolution: M6 owns membership of cited precedents in the retrieval, the counter obligation, dismissal predicates and relied-validity. M5's JV5 is only "the handle resolves to an id", and JV7, JV8 and JV9 are the three outputs of `validateJudgement` (counter obligation; dismissals; relied precedent valid and standing). M5 implements no logic of its own for them.
Edits: M5 C8 (JV5, JV9 text); M6 C7 (code names `JV7.*`, `JV8.*`, `JV9.*`).

**INT-147 [P2] Rule-change classification and `recomputeStage` placement.**
Modules: M5, M6. Source: M5 new-5; M6 new-7.
Resolution: M5a exports `classify(base, candidate): Classification` (the SMT-backed tightening or loosening classifier, solver injected) and the type `GateClassifier`; M6 takes `GateClassifier` as an injected value; the approval tiers and the gate stay in M5b C7. `recomputeStage` stays pure over supplied records in M5a, so M6 never depends on M5b.
Edits: M5 C3, C6, C15 (exports); M6 C4, C12 (injection).

**INT-148 [P2] Per-run span aliases and request hashes.**
Modules: M14, M7, M4. Source: M4 new-5.
Resolution: `ModelPort.canonicalRequest` de-aliases: it replaces every per-run alias token by the canonical span id and drops the nonce, so `reqHash` of a model effect is alias-independent; the alias map stays in the cassette detail. M4's `inputHash` and cache key are already over canonical ids and unit text.
Edits: M14 C13 (`canonicalRequest`); M7 component 5 (normalise rule); M4 C6.

### Group E: network, runtime, viewer, evaluation

**INT-149 [P1] `NetPort`: one exchange per call, connect-time address policy.**
Modules: M7, M8, M1. Source: M1 new-1.
Positions: register 2.2 returns `hops`, suggesting the port follows redirects, and `CallCtl` has no carrier for M1's connect-time address policy (resolve once, deny private and metadata ranges, pin the address).
Resolution: `send` performs exactly one HTTP exchange with redirects off (a 3xx is returned as a response); the result carries `remote: { address, port }` instead of `hops`. `CallCtl` gains an optional `net: NetPolicy { allowedHosts, denyRanges, resolveOnce: true, pinned?: { address, family } }`, constructed by M1 (how to fetch) and enforced by M8's `ports/egress.ts` at the socket connect, after DNS. M1 loops over hops itself (at most 5), calling `send` once per hop; M8 checks hosts and labels against the egress manifest on every hop. A hop is a wire call inside the enclosing effect (INT-150), not a slot of its own.
Edits: spec section 5 network funnel; M7 component 4 (`NetPort`, `CallCtl`); M8 C3; M1 components 2, 6, 10.

**INT-150 [P2] Wire calls inside a tool or fetch effect.**
Modules: M7, M1, M8. Source: M7 new-17.
Resolution: confirmed as M7 treats it. The unit that is recorded and keyed is the effect (tool call, model call, `source.fetch`). Wire calls made inside it pass the whole interceptor chain (`kill`, `egress`, `capability`) but are not slots; their record is the effect's own detail (for `source.fetch`, M1's layer-2 transport record). In replay the effect is served and no wire call happens.
Edits: M7 component 5 (sentence); M1 component 6; M8 C3 (cite).

**INT-151 [P2] `ids.secret` is never recorded.**
Modules: M7, M10. Source: M7 new-16 (Open), INT-056.
Resolution: `ids.secret` is not an effect and is not written to any cassette. In `live` and `record` it returns CSPRNG bytes. In `replay` it returns a value derived from the seed and an ordinal, so replay is deterministic. State that holds a secret-derived handle keeps the issue ordinal; the state hash covers the ordinal, not the handle text, so record and replay hash alike. INT-056's "recorded in `record`" is withdrawn.
Edits: M7 component 4 (`SecretIdsPort`), component 5; M10 C16 (handles keyed by ordinal in state).

**INT-152 [P2] Trace verbs for every module.**
Modules: M7, M5, M6, M13, M9, M10. Source: M5 (follow-up: `decide.*` fields); M10 new-5 (first half).
Resolution: M7's trace line already has top-level `phase`, `agent` and `verb` (so M10's first complaint is closed). What remains: every event a module emits must have a verb in `schemas/trace-verbs.json` with its phase and agent lane. A new lint `TL19` fails on an unregistered verb. M5's `decide.*`, M13's `case.*`, M9's `bundle.*` and `verify.*`, M6's `memory.*` register theirs when their build step runs.
Edits: M7 component 14 (`TL19`); M5, M13, M9, M6 (list their verbs in the build notes).

**INT-153 [P2] Who owns the MCP client.**
Modules: M12, M1, M7, M8. Source: M12 new-3.
Resolution: M1 owns the Zetaris MCP fallback client and the generic "untrusted MCP server" client harness (pinned surface, read-only, no token passthrough); M12 reaches it only through `SiloPort`. M7 component 3 and M8 C10 stop saying M12 owns an MCP client.
Edits: M7 component 3 (wording); M8 C10 (wording); M12 (statement); M1 components 13 to 15 (ownership line).

**INT-154 [P1] Per-file digests for the browser core.**
Modules: M9, M10. Source: M10 new-2.
Resolution: the browser core is emitted one file per module (M10 C4). M9's build produces `verifier/browser-modules.json` listing every emitted module as `{path, rawHash, sriSha384}`, covered by `bundle.json` as role `verifier-browser`, and its digest is published through the same out-of-band channels as `verify.mjs` (assumption A4). The page loads the modules through an import map with Subresource Integrity; any mismatch or missing entry makes every chip `unavailable` with the reason "browser core not pinned". Test `T-DIST-05`.
Edits: M9 component 15 and `T-DIST`; M10 C4, C8.

**INT-155 [P2] Viewer input and the green rule.**
Modules: M9, M10, M2. Source: M10 new-1 (remainder), new-4.
Resolution: M9 already returns a named state and the page already runs the core in a worker (M9 component 15 was patched); what is missing is the input. `ViewerCheckInput` gains `extractor: "agree" | "disagree" | "model_only" | "parser_only" | "single" | "not_run"` and `findings: { hiddenTextOnPage: boolean }`, and its hash fields are typed `RawHash | Commitment` (INT-104). `chipState` returns `{ state: ChipState; agreement: "both_pass" | "browser_only" | "report_only" | "disagree" | "none" }`. Green rule: for a bundle-backed view `verified exact` requires the browser's recomputation to pass and the recorded report to exist and agree; for a live case with no bundle the state may be `verified exact` only with `agreement: "browser_only"`, shown with the visible label "No bundle report", and it counts toward no claim of independent verification. M2 DI-14 draws pages from the shipped 144 dpi rasters (pdf.js is not required in the browser) and its "report PASS for green" is read as the bundle-backed case.
Edits: M9 component 15; M10 C8, C3; M2 DI-14.

**INT-156 [P2] An erased body has no chip state.**
Modules: M2, M9, M10. Source: M10 new-6.
Resolution: add an eleventh state `erased` (text "Source erased under a signed receipt; this passage cannot be checked"). It maps from `V5.ERASED` (INDETERMINATE). `unavailable` is not used for it.
Edits: spec section 14 ("eleven"); M2 DI-14 (state list); M9 component 15 mapping; M10 C3, C8.

**INT-157 [P2] Sample sizes: one number per claim.**
Modules: M11, M8, M5. Source: M11 new-4, new-5.
Resolution: the number for a headline Plumbline-Inject claim is M8's: at least 300 base documents per claim (the larger, more conservative figure); M11's quota planner takes the maximum of M8's floor and its own computed need and publishes the table once in E18. M5 C10's selective-release validation over 1,000 draws uses the exact conditional route: E5 writes `private/harm_prob.json`, an integer `Ppm` value of `P(harm | features)` per case type, committed by hash before runs and never visible to the system under test.
Edits: M11 E5, E14, E18; M8 C12 (cite); M5 C10 (route named).

**INT-158 [P2] Engine ablations credited to the wrong module, and "worst of three" inside a test.**
Modules: M12, M11, M3. Source: M11 new-2.
Resolution: AB-WM-2 (equal-authority disagreement becomes `unresolved`) is M3 `ResolverPlugin` behaviour and moves to M3's acceptance as an ablation of the plugin; the World Model engine's own ablation is the as-of ownership answer. AB-HM-3's "worst of three runs" is replaced by run-mean inference with `worst_run` reported descriptively, as E10 requires.
Edits: M12 C9; M3 acceptance (ablation row); M11 E18 (counts).

## 3. Shared-type changes applied to `00-conventions-and-shared-types.md`

Applied in this pass (declarations are in that file): `TreeHash` and `pathOf` (INT-101, 102); `Commitment` layout and tag registry pointer (INT-103); `Locator` and span hash types (INT-104); `Producer`, `PermLabel`, `LabelRecord`, `SupportLabel` (INT-115); `Assertion` fields, `Fact.cell` with `anchor` and `CellKey`, `Fact.supportLabels` (INT-115, 137); `Claim.decomposer` and `Piece` unit (INT-113); `PolicyVerdict`, `ProjectedVerdict`, `OutcomeVerdict` (INT-111); `ApprovalItem`, `ApprovalSlot`, `Binds` by pointer and `ApprovalPort` (INT-130); `SignerRole` (INT-125); `ReleaseBinding.reverses` (INT-128); `ExecutionContract` payload type and `NonceStore` (INT-106, 129); `ScopedResult.scope` (INT-115); `ModelProfile`, `DisclosureProfile` (INT-109); the ladder table rows (INT-110); the pseudocode-style paragraph (RNG exceptions, INT-108) and the dependency rules (INT-129, 130).

## 4. Spec edits applied to `00-architecture-master-spec.md` (v4.0 to v4.1)

Header and revision history; section 1b canonical names and ladder table; section 4 (ports, digest forms, path form, `ids.secret`); section 5 (permission by supporting labels and corroboration, account commitment, network funnel, signer roles); section 6 (commitment rule for locator and span hashes); section 7 (page-crossing quotes, output labels); section 8 (cell keys); section 9 (`canPermit`); section 9a (approvals row); section 10 (judge membership and failure, approval port and re-issue); section 13 (leaf registry, signer roles, enrolment, recompute budget and witnesses, `V6h`); section 14 (eleven chip states, browser module digests); section 14a (challenge, reversal, attestation host); section 15 (profiles, replay class); section 16 and 17 (RNG exceptions, sample plan); section 20 (digest kinds); sections 21c and 22 (status of the register and the pass 3 residuals).

## 5. Left Open, with the reason

1. **INT-103, SQL-side commitment.** Computing `plumbline/account/v1` inside the silo view needs SHA-256 over a concatenation in the engine's SQL. NOT VERIFIED until a Zetaris trial account exists (D2); the fallback is stated.
2. **INT-138, 1,200-line budget.** A target, not a measurement; verifiable only when two verifier implementations exist.
3. **INT-139, page-join adjacency.** Not provable by the offline verifier; L0 only. A stated limit.
4. **INT-116, `corroborationMin` default of 1.** A pack parameter chosen by design; its effect on false holds is to be measured on the gold set.
5. **ERP editor identity availability (M13 SF12), WCAG 2.2.1 essential exception (M10 F7), Windows `fsync` and exclusive-create (INT-134), SQL, Windows colon rule on a real Windows run.** Carried unchanged: each needs an external fact or a run.

## 6. Reported statements found already resolved by a later patch (no INT id)

Fully closed (9): 
- CF-1: M1 new-3 (`erased` fetch error versus `cassette_miss{reason: erased}`): M7 already adopted both (`E_BLOB_ERASED`, `E_CASSETTE_MISS{reason:"erased"}`).
- CF-2: M12 new-5 (`NonceStore.consumeAndRecordIntent` synchronous): M12 adopted M13's shape; INT-129 only fixes the dependency direction.
- CF-3: M7 new-5 (`structuredOutput` set): the register's set is in use; a JSON-mode-only provider counts as `none`.
- CF-4: M7 new-7 (error codes missing from the registry): registered by M7.
- CF-5: M4 new-5 (`json-pointer` into `raw`): M4 changed to `raw`; M9's resolver reads `raw`.
- CF-8: M3 new-5 (`L0 recomputes` wording): reworded inside M3 (RC-5.4).
- CF-9: M4 new-2 (`nearScore` was a float): now `Milli`; the lexical-gate values stay in memory.
- CF-10: M7 new-6 (INT-043 names M7 component 21 for the `StorePort` contract, which lives in component 4): the contract is in component 4 and component 21 points at it; the register's component number is a typo.
- CF-11: M2 "fixed inside this file" (DI-U02 and DI-U03 claimed page-local span stability although spans bind the whole-file `textLayerHash`): corrected in M2.

Half closed (2), remainder carried by an INT item:
- CF-6: M10 new-5. The first half (no top-level `phase`, `agent`, `verb`) is closed: M7 trace line v2 has them. The second half is INT-136 and INT-152.
- CF-7: M10 new-1. The first half (M9 returns colours and runs the verifier as a separate OS process) is closed: M9 component 15 now returns a named state and the page runs the core in a worker. The input and green-rule remainder is INT-155.

## 7. Residual risks and what this pass did not check

**Not read line by line.** The five second-pass pairs of the first register (section 0 there) remain unread: M3 against M4 C9 to C11; M5 C3 to C7 against M9 component 10; M13 components 11 and 12 against M1; M10 C8 to C11 against M2 DI-14 and M9 component 15; M6 C12 to C14 against M12 C2 to C4. This pass read the revision blocks, Open items, the register, the spec and the targeted passages named in section 0. **It is NOT VERIFIED that no contradiction remains**; spec section 21c item 5 stays.

**Bodies are not rewritten.** Each blueprint body still contains the old wording for every changed item; the appended "Pass 3 resolutions" section is the binding text. A reader who stops at the body will see stale names (`JudgeInput` for the L2 port, `local-confidential`, `release.intent`, three digest kinds). The owners must fold the changes into the bodies before building.

**Decisions with the most downstream cost if wrong.** INT-115 and INT-116 (fact labels and corroboration; they change M3, M5, M8 and the verifier loader together). INT-103 and INT-104 (commitment layout and the rule that non-public hashes are commitments; they change bundle layout, blob names and the tamper corpus rows). INT-126 (credential keys as ledger leaves; adds a bootstrap trust-root assumption). INT-137 (anchored cell keys; changes the certificate key set). INT-125 (a seventh signer role).

**Other documents not checked for the renamed items.** `01-demand-traceability-matrix.md`, `02-research-contributions-and-grant-case.md`, `03-compliance-profiles.md`, `04-practitioner-validation-plan.md`, `agent-pairings.md` and `../DECISIONS.md` were not searched for the changed names beyond a file-level search for a few stale tokens; this pass was told to edit no other file.

**Tests added by this pass exist only as names.** `PATH-COLON`, `T-IR` downward closure, `T-FE` corroboration row, `T-PORT-04`, `T-DIST-05`, `TL19`, `RC-8.8`, `no-scope-promotion` and the extended `SEC-L10` are specified, not written. Nothing here is built or measured.

**New interactions to watch.** INT-103 plus INT-104 make the same bundle member hash differently by tier (a commitment in `full`, nothing in `redacted`), so the viewer and verifier test matrices (M9 `T-TIER`, `T-VIEW`) need rows per tier. INT-131's session persistence across re-issue stores approver reading behaviour, which is personal data (LAWYER, D8). INT-149 makes M1's redirect loop the only place hop limits are enforced; M8 enforces hosts and addresses per hop but not the count.
