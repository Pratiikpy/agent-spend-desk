# Prior art 13: tamper-evident provenance, audit bundles, observability and deterministic replay

Status: research input to `docs/design/00-architecture-master-spec.md` (sections 5, 6, 16). Nothing here is built or measured. Every design sketch is a proposal with a named test; anything not fetched or run is marked **NOT VERIFIED** or **UNVERIFIED**.

## 0. Method and legend

- Repositories: metadata taken with `gh api repos/OWNER/NAME` on 2026-10-13. Format: `stars | licence (SPDX, "NOASSERTION" = GitHub could not detect one) | last push | archived`.
- Specs, RFCs and papers: each page was fetched on 2026-10-13 and the URL is given. Summaries are of what the fetched page said, not memory. Where a fetch returned only a summary of a long document, the limit is noted.
- Nothing was cloned or installed. Source was read through `gh api` and fetched pages only. The EU AI Act logging articles are out of scope (another analyst).
- Critique rule: an item is not "good" because it is popular. The 2026 agent-receipt projects have very low adoption; that is stated beside each.

## 1. Findings in brief

1. **No accepted standard for an "AI decision audit bundle" exists.** As of 2026-10-13 there is a cluster of 2026 individual drafts and papers, all about **action receipts** (a signed record that an agent did X under policy Y). The ones read share much of one skeleton: signed records, hash chains, optional COSE_Sign1 or SCITT registration, offline verification; two of them (noa draft, Obsigna) use RFC 8785 canonical JSON with Ed25519 and SHA-256 (section 3.1). None of the ones read re-checks the *content* of a decision: the quotes against evidence bodies, the rule outcome against the policy, the counterfactual. One draft says outright that "policy evaluation is not reproducible offline" (section 3.1). That gap is Plumbline's opening.
2. **The mature layer is the transparency log, not the receipt.** RFC 9162 trees, the C2SP checkpoint, tile and witness specs, Go's checksum database, Tessera and Rekor v2 are real, operated systems (section 2). A hash chain alone cannot detect tail truncation or a forked history; the receipt projects say so themselves.
3. **Our own spec already points the right way** (principle 6, ports, cassettes, state hashes). What it lacks is a signed envelope, a log with checkpoints, and a verifier that re-executes the deterministic parts. This file proposes all three.
4. **Use RFC 8785 JCS with a restricted profile instead of our own canonical JSON** (section 4.5). The spec's "own validator, not Zod" reasoning (hashes must not change when a library updates) still holds: implement JCS ourselves, pin it to the published test data.
5. **OpenTelemetry GenAI conventions are usable as a naming layer but are in `Development` status and have moved repository** (section 4.3). Align names, keep our own `plumbline.*` attributes, record the convention version in every trace.
6. **HTTP cassette libraries key on the wrong thing for us** (section 4.4). Keep the spec's port-level effect-hash cassette; borrow specific mode and matching ideas.

## 2. Transparency logs and Merkle structures

### 2.1 RFC 9162 (Certificate Transparency v2.0) and RFC 6962
- What: the Merkle-tree log with signed tree heads, inclusion proofs and consistency proofs. RFC 9162 "obsoletes RFC 6962", status Experimental, approved 2021.
- Source: https://www.rfc-editor.org/rfc/rfc9162 (fetched).
- Idea: domain-separated hashing: leaf = SHA-256(0x00 || entry), node = SHA-256(0x01 || left || right); the RFC states this is required for second-preimage resistance.
- Use: this is the tree for the Plumbline ledger (section 4.2). About 300 lines of TypeScript for hash, inclusion proof, consistency proof and verification; no dependency. Test with vectors from the C2SP / transparency-dev ecosystem (availability of language-neutral vectors **NOT VERIFIED**) plus a differential test against an independent implementation run in CI only.
- Limits: a log proves append-only behaviour only to a party that holds an earlier checkpoint. Without gossip or witnesses a malicious log can show different histories to different readers (see 2.2, witnesses).

### 2.2 C2SP checkpoint, tlog-tiles, tlog-witness (Community Cryptography Specification Project)
- What: three small specs. Checkpoint: signed note with three mandatory lines (origin, tree size in decimal, base64 root) plus optional extension lines. Tiles: hashes grouped into static, cacheable tiles of 256 hashes (height 8), zero-padded path segments, partial tiles for the right edge, entry bundles for level 0. Witness: `add-checkpoint` request carrying a consistency proof; the witness verifies it and returns a cosignature, or `409 Conflict` if its stored size differs.
- Repo: C2SP/C2SP, 673 stars | no licence detected | 2026-10-12 | not archived. URLs (fetched): https://github.com/C2SP/C2SP/blob/main/tlog-checkpoint.md, https://github.com/C2SP/C2SP/blob/main/tlog-tiles.md, https://github.com/C2SP/C2SP/blob/main/tlog-witness.md.
- Ideas worth copying exactly: (a) "a log or cosigner MUST NOT sign any checkpoint which is inconsistent with any checkpoint it previously signed" (checkpoint spec); (b) the witness keeps only its latest verified checkpoint and persists atomically, which is what prevents split views; (c) extension lines are "neither auditable by log monitors, nor signed in all signature algorithms", so never put meaning there; (d) tiles are immutable static files, so the ledger can be a directory, which fits the "no server, one command" rule.
- Limits: the spec defines formats and protocols, not who runs witnesses. Whether a usable public witness network exists for a third party to join is **NOT VERIFIED**.

### 2.3 Transparent Logs for Skeptical Clients (Russ Cox, 2019) and the Go checksum database
- What: the design behind Go's module checksum database; clients cache the latest log size and hash, verify every proof before accepting records, and detect prefix violations. Tiling "reduces hash storage by about 50%" and is cache-friendly.
- Source: https://research.swtch.com/tlog (fetched; dated 2019-03-01).
- Idea for us: the **skeptical client** is the verifier model. The dossier verifier is a client that holds a pinned earlier checkpoint and refuses anything that does not extend it.
- Limits: assumes someone else operates the log; our log is self-operated, so independence comes only from witnesses and external timestamps.

### 2.4 Crosby and Wallach, "Efficient Data Structures for Tamper-Evident Logging" (history tree)
- What: tree-based tamper-evident log with logarithmic proofs; the abstract reports a 3 KB proof where a classic hash chain would need an 800 MB trace to show membership in a log of 80 million events; also covers selective deletion with proofs that nothing inappropriate was deleted.
- Source: https://www.usenix.org/legacy/event/sec09/tech/full_papers/crosby.pdf (fetched; first page read; venue USENIX Security 2009 inferred from the URL path, **NOT VERIFIED** from the page text).
- Key quote of the threat model: an untrusted logger must be prevented from making "inconsistent claims about the past"; detecting tampering inside one snapshot is not enough.
- Use: the formal justification for choosing a Merkle history tree over a plain hash chain for the ledger, and the vocabulary (membership, incremental proof) for the verifier's checks.

### 2.5 Schneier and Kelsey, "Secure Audit Logs to Support Computer Forensics" (1999)
- What: forward-secure authenticated logging on untrusted machines; entries made before compromise cannot be read or undetectably modified afterwards.
- Source: https://www.schneier.com/academic/archives/1999/05/secure_audit_logs_to.html (surfaced by search; page not fetched, citation data from the search result only).
- Use: the key-evolution idea (a signing key that is ratcheted forward and old keys destroyed) is the standard answer to "attacker steals the key and rewrites the past". For Plumbline the cheaper equivalent is external timestamps on checkpoints (section 2.9); the ratchet is optional hardening.

### 2.6 Tessera and Trillian
- Tessera: Go library for tile-based logs implementing the tlog-tiles API. 250 stars | Apache-2.0 | 2026-10-12 | not archived. Fetched page (https://github.com/transparency-dev/tessera): production ready since v0.2.0; drivers for GCP, AWS and POSIX; best-effort antispam; witness integration; synchronous publication (block until the entry is in a published checkpoint).
- Trillian v1: google/trillian, 3759 stars | Apache-2.0 | 2026-10-02 | not archived. Per the Tessera page it is in maintenance mode and new users "should strongly consider" Tessera.
- Idea: **synchronous publication** (the call returns only when the entry is covered by a published checkpoint) is the contract the ledger port should expose; this mirrors the spec's write-ahead effect log.
- Limits: Go, not TypeScript. Use only as a CI-time oracle (differential testing of our tree and checkpoint code), consistent with the existing "official reference as oracle" approach for Meterless. The POSIX driver shows the on-disk layout we should match.
- Companion repos: transparency-dev/merkle 42 stars | Apache-2.0 | 2026-10-12; transparency-dev/witness 40 stars | Apache-2.0 | 2026-10-12.

### 2.7 Sigstore Rekor and Rekor v2 (rekor-tiles), Sigstore bundle
- Rekor v1: sigstore/rekor, 1218 stars | Apache-2.0 | 2026-10-13. Rekor v2: sigstore/rekor-tiles, 49 stars | Apache-2.0 | 2026-10-12; built on Tessera, backends GCS/AWS/POSIX/CloudSQL (README fetched). Its public-good instance has a 99.5% availability SLO and its URL changes about every six months when the log is sharded.
- Sigstore bundle: format 0.3.2, media type `application/vnd.dev.sigstore.bundle.v0.3+json`; one file holding the verification material (certificate or key id, transparency-log entries with proofs, RFC 3161 timestamps) and the content (message signature or DSSE envelope). Source: https://docs.sigstore.dev/about/bundle/ (fetched). Repos: sigstore/sigstore-go 95 stars | Apache-2.0 | 2026-10-13; sigstore/sigstore-js 184 stars | Apache-2.0 | 2026-10-12; sigstore/protobuf-specs 36 stars | Apache-2.0 | 2026-10-12.
- Idea: **the bundle is "everything required to verify", in one file, offline.** That is the packaging contract we want, with Plumbline-specific members.
- Limits: the public instance is a public-good service for signing software artifacts. Putting case metadata there would disclose it, and the shard rotation breaks hardcoded URLs. Whether it would accept or tolerate non-software entries is **NOT VERIFIED**; do not use it for decisions (section 6).

### 2.8 Sunlight, Merkle mountain ranges, and the Checkpointed Local Log
- Sunlight: FiloSottile/sunlight, 315 stars | ISC | 2026-10-01; "CT log implementation ... designed for scalability, ease of operation, and reduced cost" (GitHub description only; design details not read).
- MMR specs: draft-bryce-cose-merkle-mountain-range-proofs and draft-bryce-cose-receipts-mmr-profile-02 (June 2026), found by search (https://datatracker.ietf.org/doc/html/draft-bryce-cose-receipts-mmr-profile-02; listing seen, content not read in full).
- **draft-mih-scitt-checkpointed-local-log-01** (S. Mih, 2026-09-26, individual draft; fetched: https://www.ietf.org/archive/id/draft-mih-scitt-checkpointed-local-log-01.html): a producer-operated append-only log on an MMR, entries are opaque digests, a checkpoint is a signed CBOR statement with log size, peak-list commitment, reference to the previous checkpoint, issue time and optional declared cadence; checkpoints are registered with a SCITT service; witnesses retain checkpoint history so a forged inconsistent checkpoint fails; checkpoints leak only size and cadence.
- Idea: this is almost exactly the "local ledger without a server" problem. Two ideas to take: **declared cadence** (a checkpoint that promises "next one within T" turns silent truncation into a missed promise) and **entries are digests, content stays local**.
- MMR versus RFC 9162 tree: an MMR never restructures old entries, so proofs for old entries extend instead of being regenerated; the RFC 9162 tree has far more tooling (C2SP, Tessera, Rekor v2, Go sumdb). Choose RFC 9162 plus tiles; keep the leaf format and checkpoint fields independent of the tree so a switch is possible.

### 2.9 Timestamps and anchoring: RFC 3161, OpenTimestamps
- RFC 3161 Time-Stamp Protocol (2001, Proposed Standard): a TSA signs a hash with a time; https://www.rfc-editor.org/rfc/rfc3161 (fetched).
- OpenTimestamps: calendar servers aggregate hashes into Merkle trees and commit to Bitcoin; proofs verify offline; hours of latency; proves only prior existence. https://opentimestamps.org/ (fetched). opentimestamps-server 270 stars | NOASSERTION | 2026-08-15; python-opentimestamps 118 stars | NOASSERTION | 2025-03-18 (the client's last push is over a year old; maintenance risk).
- Idea: checkpoint anchoring in layers: the C2SP witness cosignature (split-view), an RFC 3161 token (a third party vouches for the time, defeats backdating after key theft), an OpenTimestamps proof (no trusted party). The shipped sample bundle should carry at least one of the last two so the verifier demo shows a real external fact.
- Limits: a timestamp proves the checkpoint hash existed by time T, not that its content is honest. TSA trust roots must be pinned in the verifier; **which free TSAs are acceptable and stable is NOT VERIFIED**.

## 3. Attestations, receipts, provenance vocabularies

### 3.1 The 2026 agent-receipt cluster (closest prior art)
Read this table as the competitive field for the "AI decision audit bundle" claim.

- **draft-noa-scitt-ai-agent-receipt-01**, "A SCITT Profile for AI-Agent Action Receipts" (T. Toraman, NordenSoft; August 2026; expires 2027-02-16; Standards Track label, individual-submission naming; WG adoption **NOT VERIFIED**). https://www.ietf.org/archive/id/draft-noa-scitt-ai-agent-receipt-01.html (fetched). Receipt = JCS-canonical JSON, `prevHash` chain, Ed25519 over a domain-separated preimage `"NOA-Receipt-v0.1-sig:" || SHA256(payload with chain.hash and sig.value removed)`, optional COSE_Sign1 envelope, optional SCITT registration. Six chain-failure conditions (broken link, duplicate sequence, gap, scope mismatch, tenant split, key discontinuity). Explicit non-claims: not that the agent was correct, inputs true, approval preceded the action, or the effect occurred. States that tail truncation needs authenticated checkpoints, equivocation is undetectable without a Transparency Service, and policy evaluation "is not reproducible offline".
- **draft-emirdag-scitt-ai-agent-execution-01** (P. Emirdag, D. Feichtinger, Veridic Inc.; 2026-10-12; individual submission). https://datatracker.ietf.org/doc/draft-emirdag-scitt-ai-agent-execution/ (fetched). AgentInteractionRecord as COSE_Sign1 signed statement; hash-chained; includes tool invocations, outcome hashes and **redaction receipts** for privacy-sensitive fields; operator is SCITT Issuer, an independent Evidence Custodian is the Transparency Service; four-step verification (payload integrity, chain, signature, sequence completeness).
- **draft-watts-agent-evidence-boundary-00**, "Evidence-Bounded Authorization for Agentic Systems: Evidence Qualification Receipts" (D. Watts; September 2026). https://datatracker.ietf.org/doc/html/draft-watts-agent-evidence-boundary-00 (fetched). A receipt binds a proposition to an evidence profile and evidence digests with outcome **PASS, FAIL or INDETERMINATE**, plus freshness, nonce, action binding and supersession; "A PASS EQR is only an authorization input: it is never itself permission to execute." This is the closest match to Plumbline principles 3 and 4 (conflict is data; absence is not falsity) and to the gate model.
- **Offline-Verifiable Accountability for Cross-Organization Agent Messaging: A Preserved Evidence-Bundle Approach** (A. Alshammari, H. Bahsi; arXiv 2608.28542, 2026-08-28). https://arxiv.org/abs/2608.28542 (fetched, abstract-level). A preserved bundle (sender authentication, authenticated log commitment, witness-backed checkpoint, append-only continuity, delegation evidence, receiver-signed receipt) plus an offline verifier that checks it against a **policy profile and trusted keys** and rejects claims not supported by preserved evidence. Reported: 300 workflows, 1,200 bundles, zero false acceptances of corrupted or policy-insufficient bundles. Closest prior art to our verifier concept; its domain is messaging between organisations, not decision evidence.
- **Notarized Agents / Sello** (J. Figuera; arXiv 2606.04193, 2026-06-02). https://arxiv.org/abs/2606.04193 (fetched). Inverts trust: the service **receiver** signs the receipt, encrypts it to the agent owner (HPKE) and publishes to a witness-cosigned Merkle log, because "the entity producing the activity log is the same entity whose activity is being logged". Honest limits listed by the author: suppression, service collusion, adoption.
- **Proof of Execution** (J. Rhodes, G. Kang; arXiv 2607.05397, 2026-04-26). https://arxiv.org/abs/2607.05397 (fetched). Execution = contract + Execution Causal Event Stream + replay context; separates planning, enforcement, effect and recordkeeping into authority layers; reports 2.7 ms overhead on a minimal flow, an eight-event trace of about 1.1 KB, and rejection of injected gateway-bypass and trace-mutation attacks (TypeScript prototype).
- **Agent Receipts / Obsigna** (agent-receipts/obsigna, URL via the repository listing): 20 stars | Apache-2.0 | 2026-10-12 | not archived. Spec v0.5.0 (fetched through `gh api`): W3C VC 2.0 structure, `Ed25519Signature2020` proof over RFC 8785 canonical form, SHA-256 `previous_receipt_hash`, optional RFC 3161 token, `parameters_hash` (RFC 8785) so parameters are hashed not stored, `response_hash` computed after redaction (ordering redact, hash, populate, sign), key-rotation receipts signed with the outgoing key, null-versus-absent field rules to keep three SDKs byte-identical, a chain-terminal marker. The repository also ships three independent SDKs (Go, TypeScript, Python) that verify each other's vectors, a MUST-reject vector corpus, a web verifier, an out-of-process signing daemon that holds the key, and a bounded **Alloy** model of the chain invariant. Its own spec section 7.3.1 states that plain chain verification does **not** detect tail truncation. README itself notes the three SDKs share one author. Adoption is small; the engineering practices (cross-language vectors, MUST-reject corpus, formal model, daemon-held key) are what to copy.
- **Others, metadata only** (not studied in depth): AIvoraLabs/agenttrail 6 stars | MIT | 2026-06-12; JaredKlopstein/provenant 1 star | MIT | 2026-09-16. docker/cagent (see 4.4). Low adoption, mentioned only to show the field is crowded and young.
- **Assessment.** The field converges on receipts of *actions* with signature, chain and optional transparency registration. Gaps relative to Plumbline: no one reads re-verifies evidence text; no one recomputes the rule outcome; no one includes counterfactual sensitivity; "silent versus contradicts" exists only in the EQR draft's tri-state and not tied to bodies. The claim "no existing standard covers this" is a negative finding: it rests on the searches run here (two web searches plus targeted fetches), not an exhaustive survey. Re-run the search before any public claim.

### 3.2 SCITT: RFC 9943 and RFC 9942
- RFC 9943 "An Architecture for Trustworthy and Transparent Digital Supply Chains", June 2026, Proposed Standard (Birkholz, Delignat-Lavaud, Fournet, Deshpande, Lasker). https://www.rfc-editor.org/rfc/rfc9943 (fetched). Concepts: Signed Statement (COSE_Sign1), Transparency Service with registration policy, Receipt.
- RFC 9942 "COSE Receipts", June 2026 (Steele, Birkholz, Delignat-Lavaud, Fournet). https://www.rfc-editor.org/rfc/rfc9942.html (fetched). Gives CBOR encodings for Merkle **inclusion** (tree size, leaf index, path) and **consistency** proofs referencing RFC 9162.
- Reference implementation: microsoft/scitt-ccf-ledger 48 stars | MIT | 2026-10-09 (needs the Confidential Consortium Framework).
- Idea: use SCITT **formats** as an export profile (COSE_Sign1 over our statement; inclusion proof as a COSE Receipt) so a SCITT-aware verifier can check our ledger. Do not run a SCITT Transparency Service.

### 3.3 DSSE and in-toto Statement
- DSSE: envelope with `payload`, `payloadType`, `signatures[]`; signature is over PAE `"DSSEv1" SP LEN(type) SP type SP LEN(body) SP body`; verifier must pass the exact payload bytes onward without re-parsing the envelope. secure-systems-lab/dsse 113 stars | Apache-2.0 | 2026-10-09. https://github.com/secure-systems-lab/dsse/blob/master/protocol.md (fetched).
- in-toto Statement v1: `_type`, `subject[]` with digests, `predicateType` URI, optional `predicate`. https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md (fetched). in-toto/attestation 384 stars | NOASSERTION | 2026-10-12; in-toto/in-toto 1051 stars | NOASSERTION | 2026-08-27.
- Idea: **DSSE plus in-toto Statement is the signed envelope** of the dossier. The subject is the bundle manifest digest; the predicate is the decision summary and pointers. Length-prefixed PAE removes a class of parser-ambiguity bugs; ready-made verifiers (sigstore-go, sigstore-js) already parse DSSE, which raises the credibility of the sample bundle. A new `predicateType` must be minted under a namespace we control (name **NOT DECIDED**).
- Limit: in-toto subjects are artifacts, and "subject digest" semantics need care when the subject is a manifest file.

### 3.4 SLSA Provenance v1
- predicateType `https://slsa.dev/provenance/v1`; `buildDefinition` (buildType, `externalParameters`, `internalParameters`, `resolvedDependencies` with digests) and `runDetails` (builder, metadata, byproducts); external parameters must be complete and verifiable at Build L3. https://slsa.dev/spec/v1.1/provenance (fetched). slsa-framework/slsa 1945 stars | NOASSERTION | 2026-10-13.
- Idea: **"SLSA for decisions"**: map a Plumbline run onto the same shape. `externalParameters` = case intake (PO, vendor refs, as-of date, requested action); `internalParameters` = policy version, model ids and parameters, budgets, seeds; `resolvedDependencies` = evidence bodies by digest, cassette digest, code commit, schema versions; `byproducts` = trace; `builder` = runtime build id. Replayability is the analogue of build reproducibility.
- Limit: SLSA's guarantees come from an isolated, trusted build platform; our runtime is not one. The mapping borrows the structure, not the assurance levels; do not claim a "level".

### 3.5 W3C Verifiable Credentials Data Model 2.0
- W3C Recommendation 2025-05-15. https://www.w3.org/TR/vc-data-model-2.0/ (fetched). Has an `evidence` property, `credentialStatus` (revocation or suspension), issuer/holder/verifier roles, securing by Data Integrity or JOSE/COSE.
- Idea: an **optional projection** of the decision record as a VC (issuer = Plumbline instance, subject = the case, `evidence` = list of claim-ledger digests, `credentialStatus` = decision retraction) for audience tooling. The signed DSSE statement stays the authority.
- Limits: JSON-LD contexts must be embedded locally or verification needs the network; securing mechanisms differ per cryptosuite; the status of the `Ed25519Signature2020` cryptosuite used by Obsigna in VC 2.0 is **NOT VERIFIED**.

### 3.6 C2PA
- C2PA Technical Specification 2.2 (May 2025): manifest store, claim with `created_assertions` and `gathered_assertions`, assertions with hard binding (hash) and soft binding (fingerprint), COSE_Sign1 claim signature with X.509 trust list, ingredients for derivation, RFC 3161 timestamps (v2 time-stamps countersign the signature). https://spec.c2pa.org/specifications/specifications/2.2/specs/C2PA_Specification.html (fetched). SDK contentauth/c2pa-rs 432 stars | NOASSERTION | 2026-10-13.
- Idea to borrow: **created versus gathered assertions** = facts we derived versus facts ingested from a source; and ingredient-style derivation links. Also timestamp countersigning of the signature rather than the payload.
- Not to adopt: binary JUMBF container and X.509 trust list are built for media assets; no leverage for a JSON dossier.

### 3.7 W3C PROV-O and PROV-JSON
- PROV-O: W3C Recommendation 2013-04-30; Entity, Activity, Agent; `wasGeneratedBy`, `used`, `wasDerivedFrom`, `wasAttributedTo`, `wasAssociatedWith`, `actedOnBehalfOf`; `Bundle` for provenance of provenance; `Plan`. https://www.w3.org/TR/prov-o/ (fetched).
- PROV-JSON: **W3C Member Submission** (2013-04-24), not a Recommendation. https://www.w3.org/Submission/prov-json/ (fetched). trungdong/prov (Python) 142 stars | MIT | 2026-10-13.
- Idea: a derived view `views/prov.json` that is mechanically generated from the ledger and claim ledger: evidence = Entity; each pipeline step = Activity; agent roles, human approvers and the software version = Agent; policy version = Plan; the whole dossier = Bundle. This gives legibility to provenance tooling for almost no cost.
- Limit: PROV has no notion of "evidence silent"; absence cannot be expressed, so the view loses the thing we care most about. It is a projection, never the authority; the projection round-trip test: every entity id in the view resolves to a ledger leaf.

### 3.8 RO-Crate 1.2 and Workflow Run Crate
- RO-Crate 1.2, Recommendation, published 2025-06-04: `ro-crate-metadata.json` (JSON-LD), root dataset, data and contextual entities, `conformsTo` profiles, packaged as directory or archive. https://www.researchobject.org/ro-crate/specification/1.2/index.html (fetched; the landing page did not state integrity or signing rules, **NOT VERIFIED** whether the full spec does). ResearchObject/ro-crate 164 stars | Apache-2.0 | 2026-10-12.
- Workflow Run Crate profiles (Process Run, Workflow Run, Provenance Run): `CreateAction` with instrument, object, result, agent, startTime, related to PROV. https://www.researchobject.org/workflow-run-crate/ (fetched).
- Idea: publish a **"Plumbline Decision Crate" profile**: a derived `ro-crate-metadata.json` at the bundle root so research tooling and archives can ingest a dossier, with each member listed with its sha256. Agent runs map to `CreateAction`.
- Limits: JSON-LD again (embed the context); unsigned; so its digest sits in the signed manifest and the manifest wins on any disagreement.

### 3.9 Sigstore model-transparency
- sigstore/model-transparency: 247 stars | Apache-2.0 | 2026-10-12. Signs ML models: a manifest of file hashes inside a DSSE envelope with an in-toto statement; hashing, signing and verification are separate API stages. https://github.com/sigstore/model-transparency (fetched).
- Idea: the same pattern fits our **model and prompt pinning**: a signed manifest of prompt-template hashes, schema hashes and policy-source hashes per release, referenced from every dossier.

## 4. Design sketches for Plumbline

### 4.1 The offline-verifiable dossier bundle (spec section 16, item 1)
A directory, shipped as a deterministic tar (sorted entries, zero mtime, no symlinks, no absolute paths, reader rejects `..` and duplicate names). The manifest is the authority; every other file is covered by it.

```
dossier-<caseId>/
  bundle.json                    manifest (JCS): schema id, member list {path, sha256, size, role}, scope, nonClaims
  bundle.dsse.json               DSSE envelope over an in-toto Statement; subject = sha256(bundle.json)
  decision/record.json           decision, reason codes, rule ids, autonomy level, approval state
  decision/truth-table.json      reconciled facts, rule that chose, evidence ids, unresolved conflicts
  decision/claims.json           typed claim ledger with L0..L4 results and gap ledger
  decision/counterfactuals.json  leave-one-out and minimal-flip results with the recompute inputs
  policy/policy.json             rules (data) and rule source digest; policy version; precedent ids used
  evidence/index.json            evidence records (spec section 6) with locators, hashes, rights status
  evidence/blobs/sha256/ab/<hex> evidence bodies where rights allow
  evidence/stubs/<hex>.json      hash-and-locator stubs where rights or privacy forbid the body
  trace/run.otlp.jsonl           OTLP/JSON lines (section 4.3)
  trace/run.trace.jsonl          Plumbline trace with `why`
  replay/cassette.jsonl          recorded effects (section 4.4); replay/state-hashes.json
  ledger/entries.jsonl           this case's leaf records; ledger/inclusion.json; ledger/consistency.json
  ledger/checkpoint.note         C2SP signed note; ledger/cosigs/*.note; ledger/anchors/{rfc3161.tsr,ots}
  views/prov.json  views/ro-crate-metadata.json  views/vc.json     derived projections, not authoritative
  trust/pins.json                key ids the bundle *suggests*; the verifier prints "self-supplied trust" unless pins come from the relying party
  verify/verify.mjs  verify/vectors/  verify/README.txt            standalone verifier, zero dependencies, `node:crypto` only
```

Predicate (SLSA-shaped, section 3.4), illustrative:
```json
{"_type":"https://in-toto.io/Statement/v1",
 "subject":[{"name":"bundle.json","digest":{"sha256":"<hex>"}}],
 "predicateType":"<to be minted>",
 "predicate":{"schema":"plumbline.decision/v0","caseId":"...","decisionId":"...",
  "decision":{"action":"hold","autonomy":"L1","approval":"pending"},
  "externalParameters":{"caseDigest":"sha256:...","asOf":"2026-10-13","requestedAction":"release"},
  "internalParameters":{"policyVersion":"...","runtimeCommit":"...","models":[{"id":"...","params":"sha256:..."}],"budgets":"sha256:..."},
  "resolvedDependencies":[{"role":"evidence","digest":{"sha256":"..."}},{"role":"cassette","digest":{"sha256":"..."}}],
  "ledger":{"origin":"...","size":0,"rootHash":"...","leafIndexes":[0]},
  "nonClaims":["sources are as retrieved by this system, not attested by the source",
               "model outputs are recorded, not proven correct","approval timing is as logged"]}}
```

**Verifier levels.** Each check returns `PASS`, `FAIL`, `INDETERMINATE` (evidence absent or rights-gated), or `NOT_APPLICABLE`, with a reason code; bundle verdict is the worst; exit code 0 only if no FAIL and no unexpected INDETERMINATE under the chosen profile. Naming borrowed from the EQR draft (3.1); the tri-state mirrors principle 4.

| Level | Check | Needs | Result when not satisfiable |
|---|---|---|---|
| V0 | member list matches files exactly; every digest and size matches; no extra or missing member; safe paths | bundle only | FAIL |
| V1 | JCS form of every JSON member is byte-identical to what is stored; no duplicate keys; no floats | bundle only | FAIL |
| V2 | DSSE PAE, Ed25519 signature, key id against pins | pins | INDETERMINATE if no pins given |
| V3 | ledger leaves for this case recompute; inclusion proofs verify to the checkpoint root; checkpoint note signature | bundle only | FAIL |
| V4 | consistency proof from a pinned earlier checkpoint; witness cosignatures; external anchors | relying party's earlier checkpoint, witness and TSA keys | INDETERMINATE (reported as "completeness not shown") |
| V5 | every cited quote re-located in its evidence body at the cited locator (L0 re-run, exact/normalised/ordered-ellipsis rules); numeric and date checks | evidence blobs | INDETERMINATE for stubs; FAIL for a mismatch |
| V6 | rule engine re-run on the truth table and policy gives the recorded allowed set, fired rule ids and maximum autonomy | policy member | FAIL on mismatch |
| V7 | counterfactual and minimal-flip results recomputed from V6 | same | FAIL on mismatch |
| V8 | ledger-history invariants (for example no `release` leaf without a prior `approval` leaf of an authorised role bound to the same case digest; superseded policy flagged) | ledger | FAIL |
| V9 | optional full replay: cassette plus pinned code reproduces the final state hash and normalised trace | code at pinned commit | INDETERMINATE |

V5 to V8 are the Plumbline-specific layer none of the section 3.1 projects offers (judgement as of the searches run). They need only deterministic code, so the verifier stays dependency free: V6 means the rule engine must be a small pure module with no I/O that the verifier embeds (an existing design constraint of principle 2). A second verifier in another language, run against the same vectors, follows the Obsigna cross-SDK practice and protects against single-implementation bugs.

### 4.2 The ledger chain with checkpoints and anchoring
- **Structure.** One append-only RFC 9162 Merkle tree per deployment, stored as C2SP tiles on disk. A leaf is the bytes of a small JCS record, never content: `{v, stream:"case:<id>", seq, type, subjectDigest, payloadDigest, at, actor:{kind,id,keyId}}`. `seq` is gapless per stream, so a missing case event is detectable inside a stream even without a later checkpoint. Event types cover: `case.opened`, `evidence.fetched`, `fact.asserted`, `conflict.opened`, `claim.verified`, `decision.proposed`, `approval.requested`, `approval.granted|denied`, `decision.final`, `policy.published`, `key.rotated`, `memory.written`.
- **Why a tree, not just a chain.** Logarithmic inclusion proofs (2.4) let a dossier carry only its own leaves; consistency proofs let a later checkpoint be shown to extend an earlier one; witnesses work on tree checkpoints. A per-stream `prevStreamDigest` can still be added inside leaves for stream-local ordering at no cost.
- **Checkpoints.** C2SP signed note: origin line, tree size, root, signed with a ledger key that is separate from the decision-signing key. Publish a checkpoint after every `decision.final`, every N leaves, and at least every T minutes, with the declared cadence (2.8) stored in the leaf `policy.published`; a missing checkpoint becomes a verifiable broken promise.
- **Witnessing.** Implement the C2SP `add-checkpoint` exchange against a second key in a separate process (`witness-lite`), so the protocol and the failure drills are real. Label honestly: a co-located witness gives no independence; independence needs a different operator.
- **Anchoring.** Each published checkpoint is hashed and (a) sent to an RFC 3161 TSA, (b) submitted to OpenTimestamps (hours of latency, so the first bundle carries a "pending" proof that upgrades later), (c) optionally committed as one line to the public repository after the commit gate opens. The sample bundle carries (a) and (b).
- **Synchronous publication** (2.6): `ledger.append()` resolves only when the leaf is covered by a published checkpoint; the runtime's write-ahead effect log records the leaf index so a crash replays to the same index.
- **Pitfalls and mitigations.**

| Pitfall | What breaks | Mitigation here | Residual |
|---|---|---|---|
| Tail truncation of a chain | dropping the last N records still verifies (stated by Obsigna 7.3.1 and the noa draft) | tree checkpoints, relying-party pinned checkpoint (V4), declared cadence, terminal marker on a case stream | a verifier with no earlier checkpoint cannot know |
| Whole-log rollback or fork | the log operator shows two histories | witness cosignatures, "never sign an inconsistent checkpoint", external TSA | independence requires a second operator |
| Signing-key theft then backdating | an attacker rewrites history with the real key | RFC 3161 and OpenTimestamps anchors, rotation leaves signed by the old key, daemon-held key | pre-theft anchors only protect the past |
| Logging is only as complete as the producer | an unlogged effect leaves no leaf | every effect passes a recorded port (principle 6); a trace linter fails a run whose state hash references an effect without a leaf | code that bypasses the ports is invisible |
| Evidence is "as retrieved by us" | the registry did not sign the page | store request key, redirect chain, body hash, TLS metadata; say so in `nonClaims`; Sello-style receiver signatures (3.1) are impossible for third-party public APIs | cannot prove what GLEIF served |
| Prompts and PII in logs | leakage and right-to-erasure conflict | leaves hold digests; bodies in a deletable content store; erased body leaves a hash plus an `erased` receipt (Veridic redaction receipts, 3.1) | digests of low-entropy text can be guessed; use salted commitments for such fields |
| Non-canonical bytes, algorithm confusion | two encodings, one meaning | JCS profile, pinned algorithm per version, reject unknown members | none beyond bugs |
| Valid receipt replayed on another case | splice | bind every signature to `caseDigest` and `stream`, domain-separated preimage | none |
| Verifier trusts keys supplied inside the bundle | self-attestation passes | `pins.json` is advisory only; the report states "self-supplied trust" | the relying party must bring pins |
| The verifier itself is tampered | false PASS | ship the verifier's digest in the README and sample; second implementation; reproducible build | trust bootstrap is out of band |

### 4.3 Trace schema alignment with OpenTelemetry
Sources: the GenAI conventions now live in open-telemetry/semantic-conventions-genai (437 stars | Apache-2.0 | 2026-10-13). The old docs page redirects there. Agent-span page read through `gh api`: status **Development**; operation names include `invoke_agent`, `invoke_workflow`, `plan`, `execute_tool`, `retrieval`, `chat`, `create_memory`, `search_memory`; spans `invoke_workflow {gen_ai.workflow.name}`, `execute_tool {gen_ai.tool.name}`; content attributes (`gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, `gen_ai.tool.call.arguments`, `gen_ai.retrieval.query.text`, `gen_ai.memory.records`) are **Opt-In** and marked as possibly sensitive; an optional upload hook may send content to external storage independent of the opt-in flags, called regardless of the sampling decision. Spec repo: open-telemetry/opentelemetry-specification 4345 stars | Apache-2.0 | 2026-10-13. The OTLP file exporter spec (Development) defines JSON Lines of OTLP JSON, one message per line, `.jsonl`: https://opentelemetry.io/docs/specs/otel/protocol/file-exporter/ (fetched). opentelemetry-js 3491 stars | Apache-2.0 | 2026-10-13 has an `IdGenerator` interface in `packages/sdk-trace/src`.

Design:
- The Plumbline trace stays the source of truth (spec section 5: every decision has `why`). The OTLP/JSON-lines file is a **projection** written by our own code with no SDK in the core; an optional adapter can feed the real SDK.
- Mapping: run = `invoke_workflow` (`gen_ai.workflow.name = plumbline.release_decision`); each agent role step = `invoke_agent`; planner = `plan`; model call = `chat` with `gen_ai.provider.name`, `gen_ai.request.model`, token usage, `gen_ai.response.id`; source fetch and engine call = `execute_tool` with `gen_ai.tool.name = source.<channel>`; precedent lookup = `search_memory`; memory write = `create_memory`; evidence lookup = `retrieval`.
- Our attributes, namespaced `plumbline.*`: `why` (required, a non-empty string checked by the trace linter), `effect_key`, `effect_digest`, `state_hash_before|after`, `rule_ids`, `fetch_state` (the nine fetch states), `ledger_leaf`, `cassette_occurrence`, `rule_brain` (true when no model ran, so it is never mixed into LLM-grade metrics), `semconv_version`.
- **Privacy default is hash-only**: message and tool-argument content attributes are not set; instead `plumbline.input_digest` and `plumbline.output_digest` point into the content store, which is the same blobs the bundle may include. This is the OTel opt-in and upload-hook model with the content under our retention rules. The bundle's include/exclude choice is an explicit disclosure policy (`full`, `redacted`, `hashes-only`) written into `bundle.json`.
- Determinism: trace and span ids are derived from `H(runSeed || path)`, injected through the SDK `IdGenerator` or written directly, so a replay yields identical ids and a trace hash comparison is meaningful. Timestamps come from the clock port.
- Version risk: the convention is in Development and has moved once; pin it, record `semconv_version` in each trace and add a golden-trace test that fails loudly when a rename lands.
- Viewers (optional, never core): Arize Phoenix 11819 stars | NOASSERTION | 2026-10-13; OpenInference 1261 stars | Apache-2.0 | 2026-10-13 (span kinds LLM, EMBEDDING, CHAIN, RETRIEVER, RERANKER, TOOL, AGENT, GUARDRAIL, EVALUATOR, PROMPT, DECISION; https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md, fetched); Langfuse 35761 stars | NOASSERTION | 2026-10-13 with client-side masking before export (https://langfuse.com/docs/observability/features/masking, fetched); traceloop/openllmetry 7488 stars | Apache-2.0 | 2026-10-13; pydantic/logfire 4511 stars | MIT | 2026-10-13. OpenInference's `DECISION` and `GUARDRAIL`/`EVALUATOR` kinds are worth mirroring as our own span-kind attribute. Licence terms of Phoenix and Langfuse need reading before anyone ships them; **NOT VERIFIED**.
- Critique: all of these assume tracing is for debugging and tolerate sampling and loss. An audit trace cannot be sampled; "completeness" is a ledger property (4.2), and the trace is a view of it.

### 4.4 The cassette format and replay
What the HTTP tools do, and what to take (all verified by fetch unless noted):
- VCR.py (kevin1024/vcrpy 3021 stars | MIT | 2026-09-15; vcr/vcr 6079 stars | NOASSERTION | 2026-06-23): record modes `once`, `new_episodes`, `none`, `all`; header filters. https://vcrpy.readthedocs.io/en/latest/usage.html. Take: `none` as the only replay mode; reject `new_episodes`, which silently grows a cassette and hides a changed request.
- Polly.JS (Netflix/pollyjs 10246 stars | Apache-2.0 | 2025-05-31, so no push for over a year): modes `replay`, `record`, `passthrough`; `recordIfMissing`; `matchRequestsBy` on headers, body, order, URL; `expiresIn`; persisters. https://netflix.github.io/pollyjs/#/configuration. Take: explicit match configuration and expiry; reject `recordIfMissing` and `passthrough` (a miss must be an error, per spec section 6).
- WireMock (wiremock/wiremock 7396 stars | Apache-2.0 | 2026-10-12): record and snapshot to JSON stub mappings; `repeatsAsScenarios` turns identical requests with different responses into a sequence. https://wiremock.org/docs/record-playback/. Take: the **occurrence index** for repeated identical effects.
- Hoverfly (SpectoLabs/hoverfly 2524 stars | Apache-2.0 | 2026-10-12): capture, simulate, spy, synthesize, modify, diff modes. https://docs.hoverfly.io/en/latest/pages/keyconcepts/modes/modes.html. Take: a `diff` replay mode that reports divergence instead of stopping.
- nock (13127 stars | MIT | 2026-10-12) and msw (18280 stars | MIT | 2026-10-10): interception libraries for Node; metadata only, not studied.
- LLM-aware tools: **cagent session recording** (docker/cagent, 4465 stars | Apache-2.0 | 2026-10-13): YAML cassette `version: 2` with interactions, normalises random tool-call ids before matching, strips `Authorization` and `X-Api-Key`. https://www.docker.com/blog/deterministic-ai-testing-with-session-recording-in-cagent/ (fetched). **agrepl** and arXiv 2607.16200, "Deterministic Replay for AI Agent Systems" (R. Mudasiru, 2026-04-30; https://arxiv.org/abs/2607.16200, fetched): transport-layer man-in-the-middle proxy, request-key function K(s), a proved determinism invariant, noise-aware header diff (signal versus noise), 250 replays across five workloads with fidelity 1.0 and median per-step latency down 98.3%. Repo Taiwrash/agrepl 30 stars | no licence file detected by GitHub although the README badge says MIT | 2026-09-07; the README links the paper. Treat the fidelity figure as the author's, unreplicated here. Others found by search, not studied: cendor-cassette, harnix, cassette-sdk, coding-agent-vcr, sixty-north/langchain-replay (1 star | NOASSERTION | 2026-04-17).
- Critique of the lot: they intercept at the **transport**, so the key is "HTTP request shape". Our cassettes key on the **effect** (port, operation, normalised arguments, schema version), which survives a change of HTTP client, retry layer or provider SDK and lets the same cassette cover model, tool, clock, rng and id ports. Transport cassettes cannot represent "the clock returned T" or "rng returned bytes". They also have no integrity story: nobody signs the cassette, so "replay equality" proves nothing about the original run.

Proposed cassette (JSONL, one effect per line, first line a header):
```json
{"cassette":"plumbline.cassette/v1","hash":"sha256","keyDomain":"plumbline.effect/v1",
 "volatile":{"model":["response.id","created"],"http":["date","set-cookie"]},"recordedWith":{"commit":"...","semconv":"..."}}
{"k":"sha256:<JCS({port,op,args,schema})>","n":0,"branch":"fanout.2","req":"sha256:...","resp":"sha256:...",
 "body":{"inline":{...}}, "meta":{"model":"...","params":"sha256:...","servedFrom":"live","latencyMs":812,"at":"2026-10-13T09:00:00Z"}}
```
Rules:
- Lookup key is `(k, branch, n)`: effect hash, the fan-out branch id, and the occurrence index (WireMock idea). A key not found, an unused recorded entry, or an out-of-order effect inside a branch raises `NonDeterminismError` naming the first divergent step. Temporal does the same at the workflow level: replay re-executes code and compares emitted commands against the recorded event history, failing with a non-determinism error (https://docs.temporal.io/workflow-definition#deterministic-constraints, fetched); `Worker.runReplayHistories()` replays stored histories in CI and raises `DeterminismViolationError` (https://docs.temporal.io/develop/typescript/testing-suite#replay, fetched; temporalio/temporal 23660 stars | MIT | 2026-10-13; sdk-typescript 936 stars | MIT | 2026-10-13).
- Volatile fields (ids, timestamps, cookies) are declared once in the header and excluded from `k` but kept in `meta`; this is cagent's id normalisation made explicit and auditable.
- Secrets: removal by structured allowlist, as in spec section 6, never by regex; the stripped fields are listed in the header.
- Modes: `record`, `replay` (strict), `diff` (continue after divergence and report). No `new_episodes`, no `recordIfMissing`, no passthrough.
- The cassette digest goes into the manifest, the predicate and a ledger leaf. What it proves: the decision follows from these recorded effects. What it does not prove: that the effects were real. Say so in `nonClaims`.
- **Replay corpus gate** (Temporal idea): every bundle committed under `eval/` is replayed against the current code in CI; a code or policy change that alters a final state hash must come with an explicit "expected diff" file. This also implements policy time travel (spec section 16.3): replay a stored dossier under a different policy version or as-of date and diff the outcome.

### 4.5 Canonicalisation choice: RFC 8785 JCS, restricted
- RFC 8785 (Informational, 2020; Rundgren, Jordan, Erdtman): https://www.rfc-editor.org/rfc/rfc8785 (fetched). Property names sorted by UTF-16 code units; numbers serialised per ECMAScript; strings escaped minimally with lowercase `\uhhhh` for control characters; no whitespace; no Unicode normalisation; input restricted to I-JSON (no duplicate keys, no lone surrogates, no NaN or Infinity, nothing beyond IEEE 754 precision).
- Reference and vectors: cyberphone/json-canonicalization 153 stars | NOASSERTION | 2026-10-11, with `testdata` (`input`, `output`, `outhex`, `numgen` generators) and implementations in several languages; erdtman/canonicalize 65 stars | Apache-2.0 | 2026-09-18 (npm).
- **Decision proposal: adopt JCS, do not keep our own canonical JSON.** Reasons: third-party verifiers and published vectors exist; the noa draft and Obsigna (3.1) both use it, so interop costs nothing; Obsigna's spec says its canonicalisation step is aligned with RFC 8785 use in W3C VC Data Integrity; our own scheme would earn no trust and offer no benefit. Our spec's concern (a library update must not change hashes) is met by implementing it in about 40 lines in the core and gating on the published vectors, plus a differential test against `canonicalize` and a second-language implementation in the verifier tests.
- **Plumbline profile on top (call it a profile, never a fork):**
  1. No JSON numbers except safe integers; money, scores and rates are decimal strings; anything beyond 2^53 is a string. This removes the ECMAScript number-formatting dependency for non-JS verifiers.
  2. Reject duplicate keys and lone surrogates at parse time (I-JSON); reject depth or size beyond fixed limits (verifier DoS).
  3. Text normalisation is a separate, declared ingestion step (NFC) whose output is stored beside the raw value, since JCS does no normalisation (spec section 6 already keeps raw and normalised values).
  4. Optional members: absent means absent, never `null`, except fields the schema lists as required-nullable (Obsigna 7.1.1 shows this pitfall: three SDKs drifted until the rule was written down).
  5. Domain separation for every signed or chained digest: `H("plumbline.<type>.v1" 0x00 || JCS(x))`; DSSE already length-prefixes via PAE; ledger leaves use the RFC 9162 prefix.
  6. Digest strings always carry the algorithm: `sha256:<lowercase hex>`.
- Alternatives considered: deterministic CBOR (RFC 8949 section 4.2, Internet Standard: preferred serialisation, definite lengths, bytewise-sorted map keys; https://www.rfc-editor.org/rfc/rfc8949, fetched) is sturdier for numbers and binary but loses human readability of the bundle, and COSE users get it for free only at the export edge. RDFC-1.0 (W3C Recommendation 2024-05-21; https://www.w3.org/TR/rdf-canon/, fetched) canonicalises RDF datasets with blank nodes; its own text warns adversarial graphs can cause worst-case cost. Use neither for hashing; if a JSON-LD view is emitted, hash its JCS bytes.

### 4.6 Content addressing and packaging
- git objects (https://git-scm.com/book/en/v2/Git-Internals-Git-Objects, fetched): `"<type> <size>\0" + content`, hashed, stored by hash prefix. SHA-1 is the classic hash; the page also covers the type and tree model. Take the **header-as-domain-separation** idea and the two-hex-character fan-out directory (`blobs/sha256/ab/...`); never take SHA-1.
- IPLD CARv1: header plus varint-length-prefixed CID and block sequence, no index (https://ipld.io/specs/transport/car/carv1/, fetched). ipld/js-car 52 stars | NOASSERTION | 2026-07-30; ipfs/go-car archived; multiformats/cid repository archived (spec moved to specs.ipfs.tech/cid). Not adopted: CIDs, multihash and DAG-CBOR add a toolchain that no judge has, and the manifest already gives integrity; reconsider only if bundles must be transported over IPFS.

## 5. Deterministic simulation and fault injection

- **FoundationDB simulation** (apple/foundationdb 16776 stars | Apache-2.0 | 2026-10-13): the whole cluster in one single-threaded deterministic process on the Flow runtime; simulated network, disk and time; seeded randomness reproduces any failure; "swizzle-clogging" fault pattern; the team claims about one trillion CPU-hours of simulation. https://apple.github.io/foundationdb/testing.html (fetched).
- **TigerBeetle VOPR** (tigerbeetle/tigerbeetle 17189 stars | Apache-2.0 | 2026-10-13): all non-determinism (clock, network, disk) stubbed; a seed plus the git commit replays any failure; assertions stay on in production ("better to stop operating than to continue in an incorrect state"). Read in docs/internals/vopr.md of the repository via `gh api`.
- **Antithesis** (https://antithesis.com/docs/introduction/how_antithesis_works/, fetched): a deterministic hypervisor that branches timelines, injects faults, and replays any bug; user defines assertions as properties. A commercial service; licence and pricing **NOT VERIFIED**; not usable by a judge running one command.
- **Jepsen** (jepsen-io/jepsen 7524 stars | licence none detected | 2026-09-28): fault-injection framework and the Elle checker for histories; https://jepsen.io/ (fetched). Idea: check recorded **histories** against a model, which is what V8 does for ledger histories.
- **rr** (rr-debugger/rr 10702 stars | NOASSERTION | 2026-10-13; arXiv 1705.05937, https://arxiv.org/abs/1705.05937, fetched): record and replay of native executions in user space; requires recent Intel CPUs and Linux. Not applicable to a TypeScript service on a Windows development machine; named because it defines "replay" at the instruction level, which we explicitly do not claim.
- **Plumbline harness proposal (`plumbline-sim`).** A seeded fault injector at the ports: model timeout, malformed JSON, duplicate response, slow tool, source `rate_limited` or `stale`, process crash after an effect and before its leaf, torn tile write, clock jump, concurrent fan-out interleavings. Invariants checked after each run: budget soundness; no effect without a leaf; no leaf without a recorded effect; ledger consistency with the previous checkpoint; replay equality; the gate cannot be bypassed; order independence. A failure prints `seed + commit`, as in FoundationDB and TigerBeetle. This realises the eight acceptance tests of `prior-art/06` section 9.12 as property tests, and the same invariants run inside the shipped verifier so a judge sees them. Replay claims stay narrow, as spec section 5 already states.

## 6. Ideas we should NOT adopt (with reasons)

1. **A plain hash chain as the ledger**: no tail-truncation or fork detection (admitted by Obsigna 7.3.1 and the noa draft); linear proofs (Crosby and Wallach).
2. **Public Rekor for decisions**: public-good service for software signing, discloses metadata, URL rotates about every six months, acceptance of non-software entries **NOT VERIFIED**.
3. **Running a SCITT Transparency Service** (scitt-ccf-ledger needs CCF; 48 stars): heavy, breaks "one command"; adopt only the formats.
4. **Trillian v1**: maintenance mode per the Tessera page.
5. **Blockchain-as-database or per-entry on-chain anchoring**: cost and public disclosure for no gain over RFC 3161 plus batched OpenTimestamps.
6. **VC 2.0, PROV-O or RO-Crate as the authority**: JSON-LD context loading threatens offline verification; PROV cannot express absence; RO-Crate landing page states no integrity rule. Projections only.
7. **RDFC-1.0 for hashing**: adversarial-graph cost; wrong tool for JSON.
8. **Our own canonical JSON** (section 4.5).
9. **C2PA container, IPFS CAR and CIDs, rr, Antithesis**: wrong domain or not runnable by a judge.
10. **Transport-layer cassettes as the replay core, and any `record if missing` behaviour**: wrong key, silent drift, no integrity.
11. **Full prompt and tool-argument logging by default**: OTel marks those attributes opt-in and sensitive; a hash-only default with a disclosed, per-bundle policy is safer.
12. **Making Phoenix, Langfuse or a collector a runtime dependency**: servers, uncertain licence fields, contradicts "no runtime installs".
13. **An LLM in the verifier**: the whole claim is that V0 to V8 are mechanical; a model verdict would void it.
14. **Counting agent consensus or a signed receipt as proof that the content is right**: the noa draft's own non-claims say a receipt does not show correctness; the same applies to us.
15. **Claiming a SLSA level, a regulatory status, or "tamper-proof"**: we claim tamper-evidence under named assumptions only.

## 7. Ranked top 10 ideas

1. **Dossier bundle with a zero-dependency verifier that re-executes the deterministic layers (V5 quote re-check, V6 rule recompute, V7 counterfactual recompute, V8 ledger invariants).** The one thing none of the compared projects offers; it turns the explanation claims into something a stranger can run.
2. **Merkle history-tree ledger on C2SP tiles with signed checkpoints, per-stream gapless sequence numbers, declared checkpoint cadence and witness cosigning.** Answers truncation and rollback with specified, interoperable formats.
3. **JCS (RFC 8785) with the restricted Plumbline profile and domain-separated digests**, gated on published vectors and a second implementation.
4. **DSSE plus in-toto Statement with a SLSA-shaped decision predicate** (external parameters, internal parameters, resolved dependencies, byproducts) so existing signing and verification tooling can parse the envelope.
5. **Tri-state verdicts and rights-gated stubs**: PASS, FAIL, INDETERMINATE with reason codes; a hash-only body is INDETERMINATE, never PASS (EQR draft vocabulary, spec principle 4 and section 6 rights gate).
6. **Effect-keyed, occurrence-indexed, integrity-covered cassettes with strict replay and a replay-corpus CI gate** (Temporal idea), which also delivers policy time travel.
7. **Seeded simulation harness at the ports** (FoundationDB and TigerBeetle method) printing `seed + commit` on failure; production assertions stay on.
8. **OTel GenAI-aligned OTLP/JSONL projection with hash-only content by default and deterministic ids**, pinned to a recorded convention version.
9. **Layered anchors**: RFC 3161 token plus OpenTimestamps proof on checkpoints, and key rotation as signed ledger leaves, with the signing key held by a separate process.
10. **A public tamper corpus**: a generated set of mutated bundles with the expected failing check, used to mutation-test the verifier and publishable as a benchmark (see section 8).

## 8. Three research contributions a grant reviewer would value

1. **An open Decision Bundle specification and a standalone, dual-implementation verifier whose checks go past signatures to semantic re-verification.** Contribution: a specified bundle layout, a verdict taxonomy (PASS, FAIL, INDETERMINATE, NOT_APPLICABLE with reason codes), a SLSA-shaped decision predicate, and verifier levels V0 to V9 with a "what this does not prove" section. Why novel (as judged from the 2026 documents read in 3.1): the current drafts stop at "this was recorded and signed" and one says policy replay is out of scope. Evidence required before the claim: two independent verifiers pass the same vectors; a sample bundle on a real public entity verifies offline in a clean directory.
2. **A tamper-evidence benchmark for AI decision bundles.** A seeded generator producing N valid bundles and M mutations, each labelled with the check that must fail (flip a byte in each member, drop the last ledger entries, swap an evidence blob, change a rule, reorder claims, replace a checkpoint, break canonical form, duplicate keys, zip-slip paths, oversize inputs, cassette edited without manifest update). Report false-accept and false-reject rates with confidence intervals and mutation-test the verifier itself. The Alshammari and Bahsi paper reports 1,200 bundles and zero false acceptances but (as summarised) not a released corpus; a public corpus makes other implementations measurable. State the limit: a benchmark of what we thought to mutate.
3. **Deterministic simulation and replay for agent decision runtimes, with an impact-analysis protocol.** A published method and harness (seeded port-level faults, invariants, `seed + commit` reproduction, replay corpus gate) plus an experiment: replay a corpus of stored dossiers under proposed policy changes and report which decisions would change, with the determinism evidence (identical state hash across N replays, and exactly which fields are volatile). Compare against a Temporal-based and a LangGraph-based run of the same reference case (spec decision D-009) for owned code and failure behaviour. Limit stated up front: replay equality is conditional on recorded effects; it does not show a live model would answer the same.

Optional fourth, if the first three land: the **"evidence silent versus contradicts" attribution benchmark** already listed as spec section 16 item 5, whose bundles feed contribution 2.

## 9. What could not be verified

- Whether any draft in 3.1 has IETF working-group adoption; the "no existing standard" conclusion is limited to the searches run (two broad web searches and the fetched documents). Re-search before any public statement.
- draft-thaha-scitt-agent-execution-evidence: surfaced in a search summary, but the datatracker query returned no document; excluded.
- The full texts of RFC 9162 beyond the points quoted, the MMR drafts, draft-bryce-cose-receipts-mmr-profile-02, Sunlight's design, and the evidence-bundle and Sello papers beyond their abstracts were not read in full.
- Crosby and Wallach venue/year text (inferred from the URL path); Schneier and Kelsey page not fetched (search result only).
- Existence and operability of a public C2SP witness network; free RFC 3161 TSAs and their stability; whether language-neutral RFC 9162 and tile test vectors exist and what they cover; whether sigstore-js can verify arbitrary tile-log proofs.
- Rekor v2 acceptance of custom entry types or policy for non-software use.
- OTel GenAI conventions beyond the Development status noted; no release version of semantic-conventions-genai was recorded; the OTel JS `IdGenerator` was confirmed to exist but its use for fully deterministic ids was not tested.
- Licences marked NOASSERTION (Phoenix, Langfuse, in-toto, SLSA, C2PA SDK, OpenTimestamps, C2SP, cyberphone) were not read; agrepl has no detected licence file.
- Agrepl's fidelity and latency figures, PoE's overhead figures, and the evidence-bundle paper's zero-false-acceptance result are the authors' claims; none was reproduced.
- Whether the `Ed25519Signature2020` suite is current in VC 2.0 practice; whether RO-Crate 1.2 states hash or signature rules in its full text.
- Jepsen's Elle checker applicability to ledger histories; Antithesis licence, price and availability.
- Everything in section 4 and 5 is a design proposal with no code run; none of it is claimed as built or measured.
