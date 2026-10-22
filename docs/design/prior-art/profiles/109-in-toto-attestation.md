# Profile: in-toto/attestation

Reader: agy (Gemini), 2026-10-20. Prepared for .

## 1. What it is
A specification, protobuf definitions, and SDK suite defining authenticated, tamper-evident metadata statements for software supply chain artifacts ([README.md:3-6], [spec/README.md:5-17]).
Licence: Apache 2.0 (read first at [LICENSE:1-13]). Last commit: 2026-10-20 (`cf31a684819efe142fd870330557a2be36d7f1c8`, pushed 2026-10-20T15:59:08Z).

## 2. Architecture map
- **Layers**: Four decoupled layers ([spec/README.md:9-17]):
  1. *Envelope*: Serialization and DSSE/COSE digital signatures ([spec/v1/envelope.md:3-5, 8-18]).
  2. *Statement*: Unambiguous binding between `_type`, artifact `subject` digests, and `predicateType` ([spec/v1/statement.md:10-22]).
  3. *Predicate*: Domain metadata payload (e.g., SLSA Provenance, VSA, SVR, Runtime Trace) ([spec/v1/predicate.md:3-23], [spec/predicates/README.md:10-33]).
  4. *Bundle*: Multiple attestations in JSON Lines (`.intoto.jsonl`), verified independently ([spec/v1/bundle.md:1-29]).
- **Entry points**: Core Protobuf schemas (`protos/in_toto_attestation/v1/statement.proto:15-24`) compiled into Go (`go/v1/statement.go:23`), Python, Java, and Rust (`rust/src/v1/statement.rs:28-42`).
- **Data flow**: Target artifact -> Digest calculation (`DigestSet`) -> Statement creation -> DSSE envelope packing -> Multi-key signing -> Standalone offline verification ([docs/validation.md:9-49]).

## 3. Features and how each behaves
- **Envelope & DSSE**: Outer envelope wraps `payloadType` (`application/vnd.in-toto+json` or `application/vnd.in-toto.<predicate>+json`), base64 `payload`, and `signatures` array with `keyid` hints ([spec/v1/envelope.md:31-59]). Verifiers check signatures without pre-parsing payload ([spec/v1/envelope.md:16]).
- **Statement & Subject Matching**: Requires `_type` = `https://in-toto.io/Statement/v1` ([go/v1/statement.go:13, 24-26]). Subjects are arrays of `ResourceDescriptor` requiring cryptographic digests ([go/v1/statement.go:28-43], [spec/v1/statement.md:34-40]). Verification matches target artifacts strictly by digest hash, ignoring names and MIME types ([spec/v1/statement.md:54-56], [docs/validation.md:37-42]).
- **Digest Validation**: `ResourceDescriptor.Validate()` enforces exact hex decoding and fixed byte lengths for standard algorithms (SHA256: 32B, SHA512: 64B, Git objects: 20B or 32B) ([go/v1/resource_descriptor.go:66-107, 142-155]); custom unsupported algorithms are permitted without throwing validation errors ([go/v1/resource_descriptor.go:141-142]).
- **Failure behaviour**: Explicit validation errors returned in Go (`ErrInvalidStatementType`, `ErrSubjectRequired`, `ErrDigestRequired`, `ErrPredicateTypeRequired`) ([go/v1/statement.go:16-21, 23-54]). In Rust, field checks implement the `MetadataValidator` trait ([rust/src/validator.rs:9-11]).

## 4. How people use it
- **Install & Generation**: Import Go bindings (`github.com/in-toto/attestation/go/v1`), Python (NOT VERIFIED on PyPI), or Rust (NOT VERIFIED on crates.io). Protos compiled via `make protos` ([Makefile:4-8]).
- **Usage example**: `examples/go/main.go:24-35, 52-108` builds an in-toto Statement protobuf from subject name/hash and predicate struct, outputs JSON via `protojson.Format`, and notes that production users must wrap output into a DSSE envelope.
- **Tests**: Validated across runtimes with `make go_test`, `make py_test`, `make cargo_test` ([Makefile:13-21], [docs/testing.md:13-56]). Tests cover JSON round-tripping and validation rejections ([go/v1/statement_test.go:42-110]).

## 5. Mechanism for the Desk (M9 Ledger/Verifier, M5 Dossier, M8 Intake)
- **Data model to copy**:
  - The strict 3-tier layering: Envelope (crypto) -> Statement (identity & subject hash) -> Predicate (payload) ([spec/README.md:9-17]).
  - `ResourceDescriptor` and `DigestSet` ([spec/v1/resource_descriptor.md:8-22], [spec/v1/digest_set.md:8-14]) for pinning run inputs and generated outputs.
  - Simple Verification Result (SVR) predicate (`verifier.id`, `verifier.policies`, `timeCreated`, `properties`) ([spec/predicates/svr.md:50-66]) to represent policy approval gates.
- **Offline verification rule**: Implement the 4-step algorithm from [docs/validation.md:9-49]: (1) decode DSSE envelope, (2) verify signature against recognised attester public key without canonicalization dependencies, (3) decode Statement and confirm `_type` equals `https://in-toto.io/Statement/v1`, (4) assert `hash(artifact) == s.digest` in `statement.subject` before passing verified predicate to the policy gate.
- **What in-toto gets wrong / loses**:
  - *No bundle tamper protection*: Bundles are unauthenticated JSON Lines; adversaries can drop, reorder, or replay individual attestations undetected ([spec/v1/bundle.md:9-14, 29]).
  - *No signing runtime*: DSSE signing and key management are left entirely out-of-tree ([examples/go/main.go:50-52]).
  - *Type confusion risk*: Media types on envelopes can diverge from inner `predicateType` ([spec/v1/envelope.md:51-57]).
- **What the Desk will do better**: Hash-chain or Merkle-seal multi-attestation dossiers so deletion attacks fail; integrate native ed25519 DSSE signing/verification into the core binary; bind agent execution costs, model parameters, and approval receipts into compliant SVR predicates.

## 6. Agent patterns
- No internal agent loops or critic routines; acts as a passive schema layer.
- Designed for downstream automated policy gates (e.g. Binary Authorization, in-toto-verify) ([spec/README.md:6-7], [docs/background.md:65-73]).
- Supports multi-functionary governance: multiple cryptographic signatures can endorse a single envelope ([spec/v1/envelope.md:12, 31-35, 71-75]).

## 7. Model and data layer
- No AI models. Data layer is Protobuf 3 (`statement.proto`, `resource_descriptor.proto`) and standard JSON serialization.
- Predicates use `google.protobuf.Struct` to encapsulate dynamic arbitrary payloads ([protos/in_toto_attestation/v1/statement.proto:23], [rust/src/v1/statement.rs:38]).

## 8. Hackathon-care checks
- **Trace/Log**: Standardized `.intoto.jsonl` bundle structure ([spec/v1/bundle.md:32-34]).
- **Sample/Offline**: Fully offline; unit test suites execute hermetically without external network calls ([docs/testing.md:13-56]).
- **Docker/Run**: No container needed; builds via standard `Makefile` targets ([Makefile:1-22]).
- **Security**: Cryptographic length checks reject malformed or truncated hashes ([go/v1/resource_descriptor.go:142-155]); DSSE envelope design eliminates signature canonicalization exploits ([spec/v1/envelope.md:14]).

## 9. Traps seen
- Signing implementation is deferred to external libraries; repo provides protos and validation schemas only ([examples/go/main.go:50-52], [protos/in_toto_attestation/v1/statement.proto:14]).
- Rust SDK is explicitly early-stage and unstable ([docs/testing.md:55-56]).
- Envelope `payloadType` sniffing can create security vulnerabilities if verifiers rely on MIME headers instead of payload `predicateType` ([spec/v1/envelope.md:51-57]).

## 10. Reuse
- Apache 2.0 ([LICENSE:1-13]). Permissive; schema definitions and validation structures may be directly adopted with attribution.

## 11. Verdict: ADOPT DSSE Envelope + Statement / Predicate structure for Plumbline M9 and M5 dossiers
- **Adopt**: The 3-layer architecture and ResourceDescriptor model as the export standard for Plumbline offline-verifiable dossiers.
- **Copy**:
  1. Statement structure (`_type: https://in-toto.io/Statement/v1`, subject digest set, `predicateType`) ([spec/v1/statement.md:10-22]).
  2. Four-stage offline verification model (Envelope -> Statement -> Subject Match -> Gate) ([docs/validation.md:9-49]).
  3. Simple Verification Result (SVR) predicate schema for gating records ([spec/predicates/svr.md:50-66]).
- **Avoid**:
  1. Plain JSONL bundles without a parent signature sealing the collection against deletion attacks ([spec/v1/bundle.md:9-14]).
  2. Forcing verifiers to rely on out-of-tree DSSE signer implementations.
  3. Trusting envelope media-type hints without cryptographic payload validation ([spec/v1/envelope.md:51-57]).
