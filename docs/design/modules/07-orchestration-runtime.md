# Module 07 Blueprint: Orchestration Runtime (M7)

## v5.1 alignment (2026-10-15, spec section 0 wins where this blueprint disagrees)

- Substrate bake-off criteria are unchanged; Mastra and LangGraph.js are the framework candidates, and the Mastra licence field (not asserted) must be read before any reuse.
- Lean kernel with plug-in growth (OpenClaw lesson); five compliance gates beyond the organizers' list: determinism, fault injection, claims, sponsor honesty, reproducibility (`docs/design/06-technical-constraints-compliance.md`, D-023).


## Integration revision (2026-10-13)

Pass 2 against `99-integration-register.md`. The blueprint now states the resolved design; the spec and conventions edits the register lists are still pending, so wording here runs ahead of them. Nothing was built; the only execution was a throwaway script that recomputed the digest vectors of component 2.

**Applied** (id: what changed, where):
- INT-001: component 16: envelope gains `outcome: CertOutcome` (`VALID | INVALID | INCONCLUSIVE`); `checks[].result` is the verifier `Verdict`; the two never share PASS.
- INT-002: components 14, 1: `Why.kind` gains `human_reported` (only as `decision.note`); human decisions are `rule` with `ruleId human.approval.<code>`; `decider` kept; linter TL02, TL13.
- INT-003: components 1, 2, 3, 5, 6, 14, 16: `sha256:` RawHash, `jcs:` DocHash (preimage tag, LF, JCS bytes), `com:` Commitment; all twelve own vectors recomputed; K-RAW, K-DOC, K-COM vectors added; cassette and trace digests are RawHash.
- INT-010: components 1, 2, 3, 4: floats only in memory; named scales `Ppm, Milli, Micros, Cb, MinorUnits`; PSP bans `type: number`; model `temperature` becomes `temperatureMilli` (it is inside the hashed request).
- INT-018: component 15: `LedgerPort` is `append | published | streamHead` (+ `deferred`, `appendBefore`); leaves published before the broker acts vs result leaves that may lag; WAL records `ledger.appended` and `ledger.published`; TL18, `LED-PUBLISH`.
- INT-020: component 4, 20: `NetPort` (`ctx.net`); chain `[schema, kill, egress, capability, budget, port, record, label, ledger, trace]` with budget and record as kernel-owned positions; `modelProfile` and `disclosureProfile` recorded in WAL, cassette, trace, manifest.
- INT-030: component 13: human steps are for in-run questions only; case approval waiting is M13 state.
- INT-040 (consequence): components 4, 5, 6: tombstoned bodies give `E_BLOB_ERASED` and `E_CASSETTE_MISS{reason:"erased"}`.
- INT-042: components 5, 6: `source.fetch` record shape (body-free `respHash`, `bodies`, `bodyPolicy: blob`), two layers, `E_CASSETTE_MISS` stays `fatal` with `RUN_LIVE`, replay uses the virtual clock, `ModelPort.canonicalRequest`.
- INT-043: component 4 (the register says component 21; the contract lives in component 4 and 21 points at it): one `StorePort`, RawHash addresses, partitions by confidentiality class, tombstones.
- INT-044: components 6, 19: class A (recorded inputs) versus class B (deterministic stages, any input); model-bearing sensitivity only live.
- INT-048: components 4, 5, 6, 11, 14, 15, 16: `TenantCtx` on every `CallCtl`, `Slot.tenant?` (omitted from the digest when default), tenant on `run.begin`, cassette header, trace, `LeafDraft`, store names; `E_TENANT_MISMATCH`; guarantee G10.
- INT-049: component 15: `LeafDraft` is a subset constructor of M9 `LeafV1`, actor kinds `system | role | human | service`, no `model`; leaf names come from M9's registry with M13's names; M7 SF7 accepted.
- INT-051: component 3: PSP, vectors and a reference interpreter (about 250 lines) are an M7 deliverable that M9 copies into the verifier core.
- INT-053 (consequence): G7, components 6, 14, 16: replay equality is per-stream leaf sequence and head leaf hash; `RunManifest.ledger` and normalisation drop global indices, tree size and root.
- INT-054: component 14, 9: one trace schema fixed at step 1 (`prevLineHash`, `why_kind`, `decider`, `phase`, `agent`, `verb` registry, `budget`, `tenant`, `semconv_version`); `StepDef.agent`; TL17.
- INT-056: component 4, interfaces table: the full port set of register section 2.2.
- INT-057: components 5, 9, 11, 17: WAL belongs to the effect layer and is built in step 3 with harness, broken drivers and the eight tests; pure-kernel `commit`; series-parallel restriction stated; XState is the fourth candidate; judge-run screen pre-registered.
- INT-058: component 7: reasoning cap in the reservation, conditional budget guarantee, repeatability only for cassettes.
- INT-059: components 17, 21: pre-registration counts as confirmatory only if publicly committed after 22 Oct 2026 00:00 UTC (or hash-anchored externally); bake-off 5 in step 3a, bake-off 7 when the key exists (section 5, V4).
- INT-064 (a), partly: component 1 states the `ctx.rng` rule and the M11 generator exception.

**Named by the register but not applied, or applied in part:**
- INT-017 (signer roles, `KeyPort` behaviour), INT-016 (release binding), INT-019 (compartment mechanism): M7 only declares `SignerPort`, `KeyPort`, `SandboxPort`; the policies and mechanisms are M8, M9, M13.
- INT-051 items 1 to 3 (verifier core split, rights-gated PDFs, browser two-result rule): M9 and M10 own them.
- INT-064 (b to d): not M7.
- INT-056 says `SecretIdsPort` is "recorded in `record`": applied as a `Commitment` only (see item 16 of the Spec feedback).

**New contradictions found:**
- INT-018 says `release.intent`, INT-049 renames it `action.intent` (register against itself); component 15 follows INT-049.
- INT-003 gives the `Commitment` preimage no delimiter between tag and value; safe only if no tag prefixes another, which component 1 now tests; needs a register or conventions decision.
- INT-056 (record the secret) conflicts with a cassette that is committed and bundled; resolved locally by storing a commitment, which makes secret-derived state differ between record and replay.
- INT-020 and INT-042 do not say whether a wire call inside a tool adapter is its own slot; component 4 treats it as part of the enclosing effect (M1 and M8 to confirm).
- INT-056 lists `structuredOutput: none | json_schema | grammar`; component 21 had `json_mode`; the register set is used and a JSON-mode-only provider counts as `none`.
- INT-043 names M7 component 21 for the `StorePort` contract, which lives in component 4.
- Component 1 and others used codes that were not in the error registry (`E_LEDGER_LOCKED`, `E_STALE_RECORDED_STEP`, `E_APPROVAL_CONFLICT`, `E_INTERRUPT_CLOSED`); they are registered now.

Status: design, 2026-10-13. Refines spec v3.1 sections 4, 19a (bake-offs 1, 5 and 7 as they touch the runtime), 20 and 21 (F-BUDGET, F-SAMPLE). Nothing here is built; every design statement is a hypothesis with a named test. What was run while writing: a 25-line throwaway draft of the canonicaliser was checked against the six published JCS test files (all six byte-identical, component 2); no third-party code was run or installed; registry and repository metadata were read through `gh api`, `curl` against the npm registry and page fetches.

Conventions of `00-conventions-and-shared-types.md` apply, in the form the integration register (`99-integration-register.md` section 3) gives them (shared types `Json`, `RawHash`, `DocHash`, `Commitment`, `Hash` as their union, `Id`, `Iso`, `TenantId`, `Why` with four kinds, `Proposal`, `Approved`, `ErrorClass`, `Mode`, `TrustLevel`, `Confidentiality`, the integer scales `Ppm`, `Milli`, `Micros`, `Cb`, `MinorUnits`). To keep 20 components readable, references are held once in the **Reference register** (R-numbers, section 2) and each component lists the R-numbers it uses plus what they do and do not show.

## 1. Scope and contract

**Job.** M7 is the layer below every other module. It gives every module the same five things: (1) a way to touch the world that is recorded, replayable, budgeted and gated (ports and the effect layer); (2) deterministic, hashable data (JCS, JSON Schema contracts, typed state); (3) an execution substrate that runs a static, hashable graph with checkpoint, resume, fan-out and human steps; (4) a trace in which every control decision carries a `Why`; (5) the instruments that prove those claims (trace linter, bake-off harness, seeded simulation, input-sensitivity design).

**Inputs.** A `GraphDef` (static data), a step registry (functions), JSON Schema documents, a budget profile, ports supplied by the composition root, a `RunInput` (case digest plus typed payload), a mode (`live`, `record`, `replay`), and a tenant (`tn_default` on the judge path; component 4).

**Outputs.** Final typed state and its hash; the JSONL trace; the effect log (WAL) and the exportable cassette; `RunManifest`; certificates (envelope only); ledger append requests (through `LedgerPort`).

**Spec sections refined.** 4 (all), 19a items 1, 5 (the file-backed append-only store belongs here), 7 (structured-output contract), 20 steps 1 to 7, 21 F-BUDGET, F-SAMPLE, F-RUN, 21b row M7.

**Depends on.** Nothing above it. It needs only Node built-ins, a pinned JSON Schema validator and a schema authoring library (component 3), and LangGraph.js only if bake-off 1 selects it (component 17). **Depended on by** every module (table at the end).

**Ownership split (answers RUN-01 of the adversarial review).** The guarantees are divided by owner and every substrate candidate must be shown to leave the effect layer's guarantees intact:

| Guarantee | Owner | What the substrate must not do |
|---|---|---|
| G1 A recorded effect is executed at most once per slot across crash and resume (idempotency, in-doubt handling) | effect layer (WAL, component 5 and 11) | hide re-execution from the effect layer or run steps outside `StepRunner` |
| G2 Budgets are reserved before each call and never overshot, retries included | effect layer (component 7) | start work (a retry, a re-run) that bypasses `reserve` |
| G3 Merge order is branch order, never completion order | kernel `Committer` invoked by the substrate (component 12) | merge in completion order, expose a race join |
| G4 Irreversible effects need `Approved<T>`; gates cannot be forged or bypassed | effect layer and graph compiler (component 10) | route around a gate node, deserialize an `Approved` |
| G5 Human steps interrupt at step boundaries and fail closed | substrate delivers, kernel decides (component 13) | re-execute a step that has already produced effects in order to deliver a resume value |
| G6 Every decision has a `Why`; state changes are commit events | trace layer (component 14) | emit control events of its own |
| G7 A recorded run replays to the same normalised trace and state hash, and per ledger stream the same leaf sequence and head leaf hash (never global ledger indices or the tree root) | cassette layer (component 6) | introduce clock, id, rng or ordering nondeterminism |
| G8 No telemetry or network egress by default | composition root (component 20) | start exporters, phone home |
| G9 State and checkpoints are our canonical JSON | kernel codec | persist class paths or library-versioned blobs |
| G10 Every call, record, key and file name carries a tenant; nothing is reachable without one | `StepCtx`, `perform` (components 4, 5) | read or write a store, ledger stream or cassette outside the run's tenant prefix |

## 2. Reference register

Each entry: link, stars, licence, last push (GitHub metadata read on 2026-10-13 unless stated), what it does, what its evaluation does not show. "Read" means the file named was read in code during this blueprint or the cited teardown.

**Local clones (read-only, `research/track-3-reasoning-architecture/unified-all-three-tracks/`; commits and verdicts in `prior-art/06`).**
- **R1 langgraph (Python)**, MIT, commit `afbe7e4`. Read in 06 §4: `pregel/_algo.py` `apply_writes` (tasks sorted by path before writes are applied), task ids as digests of namespace, step and name, `pregel/_loop.py` pending writes, `types.interrupt`, `RetryPolicy`, `durability` default `"async"`, `recursion_limit` default 10007. Shows no token budget, no effect cassette. Does not show behaviour under crash (06 §4.8).
- **R2 crewAI**, MIT. 06 §5: first-wins racing listeners (`Flow._execute_racing_listeners`), LLM-collapsed human-feedback routing (`_collapse_to_outcome`), checkpoint at method granularity, `max_method_calls` loop guard.
- **R3 autogen**, code MIT. 06 §6 and a direct read of `autogen_core/_intervention.py` (`InterventionHandler.on_send/on_publish/on_response`, `DropMessage`) and `conditions/_terminations.py` (`TokenUsageTermination` adds usage of messages that have already arrived, so the cap is checked after spend).
- **R4 openai-agents-python**, MIT. 06 §7 and a direct read: `run_state.py` `CURRENT_SCHEMA_VERSION = "1.20"` with a supported-versions table; approvals as serialisable state; input guardrails parallel to the model by default.
- **R5 TradingAgents**, Apache-2.0. 06 §2 and a direct read of `graph/trading_graph.py` `_run_signature` (checkpoint thread id includes a SHA-256 digest of the configuration, so a resume under changed settings starts fresh).
- **R6 FinRobot**, Apache-2.0 (trademark policy). 06 §3 and a direct read of `engine/pipelines/step.py`: `deterministic` (line 42), `critical` (58), `derived_keys` (65); `artifact/contract.py` persist-boundary clauses with value-withhold semantics.
- **R7 ClinicalAgents-Code**, no licence (studied, not copied). 06 §1 and a direct read of `mcts_state.py` `append_snapshot`, `resolve_backtrack_snapshot`, `recover_snapshot_state` (a restore that preserves monotonic counters); `filter_valid_actions` as a pure action mask. Never run (missing modules).

**Verified for this blueprint.**
- **R8 [langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs)**, 3,352 stars, MIT, 2026-10-12. Read in `libs/langgraph-core/src`: `pregel/loop.ts` (`DEFAULT_LOOP_LIMIT = 25`; recursion stop `step + limit + 1`; `putWrites` called as each task finishes; durability `"sync"` awaits all persistence before the next superstep), `pregel/types.ts` (`durability` documented default `"async"`: checkpoint saved while the next step runs; `"exit"`: only at exit), `pregel/algo.ts` (tasks sorted by `writesSortKey(taskPathStr(path))` before `applyWrites`), `interrupt.ts` (resume values matched by an in-node interrupt counter, `GraphInterrupt` thrown when absent; a resume value is validated only when `responseSchema` is a Zod schema), `libs/checkpoint/src/base.ts` (`BaseCheckpointSaver`: `getTuple`, `list`, `put`, `putWrites`, `deleteThread`). `libs/checkpoint-validation` exists (by name a validation library for savers; directory listing only, not read). npm metadata read: `@langchain/langgraph` 1.5.0 (MIT, peer dependencies `@langchain/core ^1.1.48` and `zod`), `@langchain/core` 1.2.17 (about 7.6 MB unpacked, dependencies `zod, p-queue, mustache, langsmith, js-tiktoken, @cfworker/json-schema, @standard-schema/spec`), `@langchain/langgraph-checkpoint-sqlite` (native `better-sqlite3`). Does not show: behaviour under process kill, whether LangSmith export is on by default (NOT VERIFIED), anything about our effect layer.
- **R9 [temporalio/sdk-typescript](https://github.com/temporalio/sdk-typescript)**, 936 stars, MIT, 2026-10-13; Temporal server 23,660 stars (13 §4.4). npm `@temporalio/worker` 1.24.0 depends on `webpack`, `@swc/core`, `@grpc/grpc-js`, `@temporalio/core-bridge` (registry metadata). Docs fetched: the `@temporalio/testing` package "downloads the test server"; replay of an event history raises `DeterminismViolationError` on non-determinism. Shows the strongest published model of replay-by-history-comparison; does not show a no-server, no-download mode.
- **R10 [statelyai/xstate](https://github.com/statelyai/xstate)**, 30,294 stars, MIT, 2026-10-13; `xstate` 5.33.2, zero dependencies, about 2.3 MB unpacked (registry). State machines and actors, persisted snapshots (README; the snapshot API was not read).
- **R11 vercel/workflow** (2,455 stars, Apache-2.0), **R12 dbos-inc/dbos-transact-ts** (1,394, MIT; README: "built on top of Postgres"), **R13 restatedev/sdk-typescript** (125, MIT; the README compatibility table pairs it with a Restate Server). Durable-execution systems screened out on judge-run weight (section 17). `inngest/inngest-js` is GPL-3.0 and is excluded. Vercel's README says local development "uses the bundled backend with no configuration" but whether it runs outside its framework integrations is NOT VERIFIED.
- **R14 [cyberphone/json-canonicalization](https://github.com/cyberphone/json-canonicalization)**, 153 stars, Apache-2.0 (the `LICENSE` file; GitHub reports NOASSERTION), 2026-10-11. `testdata/{input,output,outhex}` with six files (`arrays, french, structures, unicode, values, weird`) and a 100-million-line ES6 number file (`hex-ieee,expected`, generator `numgen.js`). Co-author of RFC 8785 (13 §4.5).
- **R15 [erdtman/canonicalize](https://github.com/erdtman/canonicalize)**, 65 stars, Apache-2.0, 2026-09-18. Read `lib/canonicalize.js`: rejects lone surrogates (`isWellFormed`), NaN and Infinity; but unwraps `toJSON`, boxes, and silently drops `undefined`, functions and symbols as `JSON.stringify` does. A usable differential oracle, not a safe boundary.
- **R16 RFC 8785 JCS** (fetched): lowercase `\uhhhh` for U+0000 to U+001F; property names sorted as UTF-16 code units; numbers per ECMAScript `Number.toString`; I-JSON (no duplicate names, lone surrogates terminate); `8000000000000000` (negative zero) serialises as `0`.
- **R17 [ajv-validator/ajv](https://github.com/ajv-validator/ajv)**, 14,861 stars, MIT, 2026-09-06; 8.20.0, four dependencies (`fast-uri, fast-deep-equal, require-from-string, json-schema-traverse`). Docs fetched: strict mode (`strictSchema` fails on unknown keywords, `strictTypes`, `strictRequired`, `strictTuples`, `strictNumbers`); security page ("never use `allErrors: true` in production", ReDoS from patterns and from `ajv-formats`, code generation needs `'unsafe-eval'` under a browser CSP).
- **R18 [sinclairzx81/typebox](https://github.com/sinclairzx81/typebox)**, 6,991 stars, MIT (the `license` file; GitHub reports NOASSERTION), 2026-10-12; package `typebox` 1.3.37, zero dependencies. README read: `Type.Object(...)` builds in-memory JSON Schema objects and `Type.Static` infers the TypeScript type. The package name changed from `@sinclair/typebox` (0.x); API of 1.x not exercised here.
- **R19 [ThomasAribart/json-schema-to-ts](https://github.com/ThomasAribart/json-schema-to-ts)**, 1,784 stars, MIT, 2026-05-09. Types from `as const` schemas, "zero impact on the compiled code"; the README notes importing JSON `as const` is not available.
- **R20 [json-schema-org/JSON-Schema-Test-Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite)**, 755 stars, MIT, 2026-10-11; directories `draft2020-12`, `draft7`, others. The standard conformance corpus for validators.
- **R21 MCP specification 2025-11-25, "JSON Schema Usage"** (fetched): schemas without `$schema` default to 2020-12 and implementations must support 2020-12.
- **R22 [dubzzz/fast-check](https://github.com/dubzzz/fast-check)**, 5,199 stars, MIT, 2026-10-13. Source read: `Parameters.ts` has `seed`, `path` (replay a failing counterexample), `numRuns`; `check/model/ModelRunner.ts` and `command/Command.ts` (model-based testing of command sequences).
- **R23 [stryker-mutator/stryker-js](https://github.com/stryker-mutator/stryker-js)**, 3,203 stars, Apache-2.0, 2026-10-10. Mutation testing for TypeScript (README only).
- **R24 [etcd-io/etcd](https://github.com/etcd-io/etcd)**, 52,360 stars, Apache-2.0, 2026-10-13. Read `server/storage/wal/decoder.go` (length-framed records, CRC chained from the previous record, `io.ErrUnexpectedEOF` on a short or torn record) and `repair.go` (on `ErrUnexpectedEOF` in the last file: copy it to `<name>.broken`, truncate to the last valid offset, fsync). The model for torn-tail repair.
- **R25 [libuv/libuv](https://github.com/libuv/libuv)**, 27,249 stars, MIT, 2026-10-13. Read `src/win/fs.c`: `fs__fsync` calls `FlushFileBuffers` (line 2356), `fs__rename` calls `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)` (line 2341). Node's `fs` sits on libuv; atomicity of that rename on NTFS is not claimed by libuv and is NOT VERIFIED.
- **R26 Pillai et al., "All File Systems Are Not Created Equal", OSDI 2014** (page fetched): applications' update protocols depend on subtle file-system behaviour; 60 crash vulnerabilities in eleven widely deployed systems found with the ALICE tool. Motivates a simulated disk with explicit crash semantics.
- **R27 Blackman and Vigna, "Scrambled Linear Pseudorandom Number Generators", arXiv 1805.01407** (page fetched, submitted 2018-05-03): the xoshiro and xoroshiro family. Source for the seeded generator.
- **R28 Chen, Kuo, Liu, Poon, Towey, Tse, Zhou, "Metamorphic Testing: A Review of Challenges and Opportunities", ACM Computing Surveys 51(1), 2018** (title, venue and authors verified through Crossref; the abstract page returned 403 and was not read).
- **R29 IETF `draft-ietf-httpapi-idempotency-key-header-07`**, expired Internet-Draft, not an RFC (page fetched). Cited only as a name for the idempotency-key pattern; we do not implement HTTP semantics.
- **R30 gRPC deadlines guide** (fetched): deadlines are converted to timeouts by subtracting elapsed time; some implementations propagate a deadline from an incoming call to outgoing calls; on expiry the call fails with `DEADLINE_EXCEEDED` and the server cancels.

**Verified in earlier research (cited by file; their metadata and fetches are recorded there, not repeated).**
- **R31** FoundationDB simulation, TigerBeetle VOPR, Antithesis, Jepsen, rr (`13 §5`).
- **R32** Temporal replay and non-determinism semantics (`13 §4.4`): replay re-executes workflow code and compares emitted commands with recorded history; a divergence is a non-determinism error; stored histories are replayed in CI.
- **R33** HTTP and LLM cassette tools: VCR.py, Polly.JS, WireMock (occurrence index through `repeatsAsScenarios`), Hoverfly (diff mode), cagent session recording, the paper "Deterministic Replay for AI Agent Systems" arXiv 2607.16200 (`13 §4.4`).
- **R34** OpenTelemetry GenAI semantic conventions (Development status), the OTLP file exporter (JSON lines), opentelemetry-js `IdGenerator`, viewers (`13 §4.3`).
- **R35** DSSE, in-toto, SLSA predicate, RFC 9162, C2SP (`13 §2, §3`; owned by M9).
- **R36** Magentic-One ledgers, Google ADK, OpenAI handoff semantics (`12 §5`); MAST and the role-necessity design (`12 §2, §9`).

## 3. Component list

| # | Component | Spec | Build gate |
|---|---|---|---|
| 1 | Kernel vocabulary: results, error taxonomy, ids, three digest kinds, seeded rng | 4 | taxonomy, id and digest-kind golden tests |
| 2 | JCS canonicalisation, restricted profile, strict parser, vectors | 4 | published vectors plus second implementation |
| 3 | JSON Schema contracts: profile, authoring, pinned strict validation, golden hashes | 4, 19a-7 | schema-hash and validator-behaviour vectors |
| 4 | Ports (the full set), tenancy and the interceptor chain | 4 | forbidden-global lint and port contract tests |
| 5 | Effect layer: records, slots, keys, occurrence indexes, dedup, in-doubt | 4 | G1 tests |
| 6 | Cassettes and the two replay classes | 4, 15, 21 | T1 replay equality |
| 7 | Budgets: hierarchy, pre-call reservation, retries, wall clock, phases, finalize reserve | 4, 21 F-BUDGET | T3 budget soundness |
| 8 | Typed state, reducers, commits, state hash | 4 | commit property tests |
| 9 | Step contract, structured graph, compile-time validation | 4 | graph validation tests |
| 10 | Gates, `Proposal` to `Approved`, output contract | 4, 5 | T5 gate integrity |
| 11 | Write-ahead log, checkpoint, resume | 4 | T2 crash safety |
| 12 | Fan-out and fan-in with deterministic merge | 4 | T4 order independence |
| 13 | Human steps as step-boundary interrupts | 4 | approval drills |
| 14 | Trace: the one JSONL schema (fixed at step 1), `why_kind`, linter, normalisation, OpenTelemetry projection | 4 | T7 trace completeness |
| 15 | Single-writer ledger port: `append`, `published`, `streamHead` | 13 (M9) | idempotent append and crash tests |
| 16 | Certificate scaffolding and `RunManifest` | 9, 13 | envelope tests |
| 17 | Execution substrate interface, thin runtime and the bake-off protocol | 19a-1, 20 | decision record |
| 18 | Seeded simulation harness with fault injection | 4 | sim invariants in CI |
| 19 | Input-sensitivity test design and deterministic-stage replay | 15, 21 F-SAMPLE | mutation table |
| 20 | Run profiles, composition root and doctor checks | 21 F-RUN | clean-room |
| 21 | Bake-offs 5 (embedded store) and 7 (structured output), runtime side | 19a-5, 19a-7 | decision records |

Directory layout (all paths relative to the repository root): `src/kernel/` (components 1, 2, 3, 8, 16, and the reference PSP interpreter `psp.ts`), `src/runtime/` (4 to 7, 9 to 15; `src/runtime/adapters/**` is the only place the determinism lint permits `node:net`, `node:fs`, `node:child_process`), `src/substrate/thin/` and `src/substrate/langgraph/` (17), `src/sim/` (18), `src/runtime/testing/` (scripted model, crash injector, shufflers, linters), `schemas/` (generated JSON Schema documents plus `manifest.json`), `vectors/` (shared test vectors consumed by M9's verifier implementations), `eval/bakeoff-1/` (17).

## 4. Components 1 to 7: the kernel contracts layer

### Component 1. Kernel vocabulary: results, error taxonomy, ids, digests, seeded rng

**3. References.** R3 (typed message boundary), R4 (typed exception taxonomy: `MaxTurnsExceeded`, `ModelBehaviorError`, `ModelTimeoutError`, tripwires), R6 (error classification by substring of exception text, the defect to beat; `_RECOVERABLE_SUBSTRINGS`, `_FATAL_SUBSTRINGS` in `Pipeline._run_step`), R27 (xoshiro family).

**4. What they do.** R6 classifies a failure by searching the message for "429", "timeout", "insufficient balance" (06 §3.2); it works until a provider rewords an error. R4 raises distinct exception types, which is robust but is control flow by exception. R1 and R8 carry `retry_on` predicates supplied by the author. None makes the class part of the value that crosses a module boundary. R27 defines small, fast, statistically strong generators with a 128-bit state suitable for 32-bit integer arithmetic.

**5. Decision.** Own. Errors are values with a closed code registry, so a class can never be inferred from text. Digests are domain-separated per 13 §4.5 item 5. The generator is xoshiro128\*\* (adapt: re-implement from R27, 32-bit `Math.imul` arithmetic, no BigInt). Rejected: a string-pattern classifier (R6), an exception hierarchy as the only carrier (R4).

**6. Design.**

```ts
type Result<T, E extends PlumblineError = PlumblineError> =
  | { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

interface PlumblineError {
  readonly class: ErrorClass;            // transient | validation | budget | policy | fatal
  readonly code: ErrorCode;              // closed registry, schemas/error-codes.schema.json
  readonly message: string;              // never contains instance data > 80 chars, never a secret
  readonly retryAfterMs?: number;        // only meaningful for transient
  readonly details: Json;                // bounded, schema'd per code
  readonly why: Why;                     // kind 'rule' or 'computed', never 'model_reported' or 'human_reported'
}
```

Registry (class, retry rule). Each code has exactly one class; a new code is a registry change with a golden-hash update.

| Class | Codes | Rule |
|---|---|---|
| transient | `E_MODEL_RATE_LIMITED`, `E_MODEL_TIMEOUT`, `E_MODEL_UPSTREAM`, `E_TOOL_TIMEOUT`, `E_TOOL_UNAVAILABLE`, `E_STORE_BUSY`, `E_NET_UNAVAILABLE`, `E_LEDGER_UNAVAILABLE` | retry within budget, seeded jitter, honour `retryAfterMs`, each attempt is a new effect slot |
| validation | `E_OUTPUT_JSON`, `E_OUTPUT_SCHEMA`, `E_INPUT_SCHEMA`, `E_FINDING_BLOCKED` | re-prompt with the finding at most N (step `retry.validation`), then `onFail` chain; never retried when the step is `deterministic` (R6 idea) |
| budget | `E_BUDGET_EXCEEDED{dim}`, `E_DEADLINE`, `E_BUDGET_OVERSHOOT`, `E_RESERVE_EXHAUSTED` | never retried; the supervisor routes to `finalize` (component 7); `E_RESERVE_EXHAUSTED` is terminal |
| policy | `E_UNAPPROVED_EFFECT`, `E_EGRESS_DENIED`, `E_CAPABILITY_MISSING`, `E_TOOL_SURFACE_CHANGED`, `E_UNDECLARED_WRITE`, `E_TRUST_VIOLATION`, `E_KILL_ENGAGED`, `E_NOT_AUTHORISED`, `E_TENANT_MISMATCH`, `E_STALE_RECORDED_STEP`, `E_APPROVAL_CONFLICT`, `E_INTERRUPT_CLOSED`, `E_BLOB_ERASED` | never retried, never degraded silently; the step fails and the run escalates |
| fatal | `E_CASSETTE_MISS{reason}`, `E_NONDETERMINISM`, `E_GRAPH_DRIFT`, `E_WAL_CORRUPT`, `E_WAL_WRITE`, `E_RUN_LOCKED`, `E_LEDGER_LOCKED`, `E_STORE_MISS`, `E_IN_DOUBT_EFFECT`, `E_INVARIANT`, `E_UNCLASSIFIED` | abort the run even when the step is non-critical; the run ends `failed` or `halted_in_doubt` with the trace flushed |

Rules: (1) adapters map provider errors to a `PortError` of this registry; an exception thrown by step or adapter code that is not a `PlumblineError` becomes `E_UNCLASSIFIED` (fatal, fail closed, `cause` stored only as a digest); (2) throwing is reserved for process boundaries and for `SimulatedCrash` in the harness; everything else returns `Result`; (3) a degraded step output must carry `degraded: { step, reason: ErrorCode }[]` in its type, so a UI cannot hide it (06 §9.11).

Digests and ids. Three self-describing digest kinds (INT-003), so that mixing them is a parse failure and never a silent mismatch:

```ts
declare function rawHash(bytes: Uint8Array): RawHash;                        // "sha256:<hex>" = plain SHA-256 of the exact bytes; reproducible with `sha256sum`
declare function digestJson(domain: DomainTag, v: Json): Result<DocHash>;    // "jcs:<hex>" = SHA-256 over domain tag, one LF byte, then JCS bytes (component 2)
declare function commit(domain: DomainTag, value: Uint8Array, salt: Uint8Array): Commitment;   // "com:<hex>" = SHA-256(salt || domain tag || value); salt is 32 CSPRNG bytes
type DomainTag = `plumbline.${string}.v${number}`;                           // closed registry in src/kernel/domains.ts; no tag is a prefix of another
// registry: state, graph, schema, schema.semantic, effect.slot, effect.key, req, resp, run, idem, rng, id,
//           trace, cassette.core, wal.chain, cert.<kind>, manifest, interrupt, gate.verdict
declare const ids: { next<K extends string>(scope: Scope, kind: K): Id<K> };  // see below
// Id<K> = `${K}_${hex20(digestJson("plumbline.id.v1", {seed, branch, step, instance, kind, n}))}`   (hex of the DocHash body)
// n counts calls per (branch, step, instance, kind); replay and branch order cannot change it.
```

Seeded rng: state from `digestJson("plumbline.rng.v1", {seed, branch, step, instance})`, first 16 bytes of the hex body, four 32-bit words, xoshiro128\*\* step. `rng.fork(label)` derives a child stream by the same rule, so branch draws never depend on scheduling. The run `seed` is generated by the composition root with `crypto.randomBytes` in live mode **only**, written into the `run.begin` WAL record, and thereafter read from there; tests pass a fixed seed. Because every draw is a pure function of `(seed, path, n)`, draws are **not** recorded as effects (this departs from 06 §9.7, which recorded them: smaller cassettes, replay by construction). `ctx.rng` is a kernel service, not a port; the one documented exception to "all randomness behind `ctx.rng`" is M11's data generator, whose control is byte-equal regeneration from its seed (INT-064). Material that must be unpredictable and cannot be derived from the seed (MCP session handles) comes from `ids.secret` (component 4), never from `rng`.

*Integers only in documents (INT-010).* Floating point may exist in memory (scoring, ranking, estimation) and never in a hashed, signed, recorded or cassetted document. The integer scales are named types, so they cannot be confused: `Ppm` (parts per million), `Milli` (thousandths), `Micros` (millionths of a unit, for example `costMicroUsd`), `Cb` (centi-bits), and money as `MinorUnits` (decimal string of integer minor units). Component 2 enforces this at the canonicaliser and component 3 at the schema linter.

**7. Tests.** `K1-REG`: registry golden hash; every code has exactly one class; every thrown-site in `src/` uses a registered code (AST scan). `K1-MAP`: provider error fixtures (HTTP 429/500/503/timeout/400 invalid/401/context-length) map to the expected class; an unknown exception maps to `E_UNCLASSIFIED`. `K1-ID`: ids identical across 1,000 shuffled branch completions. `K1-RNG`: first 8 outputs for three fixed seeds match the reference C implementation published with R27 (fetched at build time; NOT VERIFIED here) and statistical smoke tests are not relied on. `K1-DOM`: two domains over the same bytes never collide in the test corpus; domain strings outside the registry fail the build; no registered tag is a prefix of another (the commitment preimage has no delimiter between tag and value). `K1-KIND`: the three prefixes parse back to their kind, a `sha256:` value is refused where a `jcs:` is required and the reverse, and vectors K-RAW and K-COM (component 2) match. `K1-FLOAT`: no exported schema or type in `src/` uses a floating-point field outside the memory-only list (component 3 lint).

**8. Risks / NOT VERIFIED.** Whether the registry is complete is only discoverable by failure drills (T6). Provider error shapes for the NVIDIA endpoint are unknown (M14/M12 map them).

**9. Build notes.** First, with component 2. Unblocks every other component.

### Component 2. JCS canonicalisation (restricted profile), strict parser and test vectors

**3. References.** R16 (the RFC), R14 (author's reference, vectors, 100M-number file), R15 (independent JS implementation, differential oracle), 13 §4.5 (the profile decision).

**4. What they do.** R14's `testdata` pairs six inputs with exact expected bytes (`weird.json` exercises key sorting across U+20AC, U+000D, U+000A, U+0031, U+0080, U+D83D U+DE02, U+00F6, U+FB33 and `</script>`; `values.json` exercises number forms and escapes). R15 serialises strings with `JSON.stringify` after an `isWellFormed` check and serialises primitives with `JSON.stringify`; its container walk unwraps `toJSON`, unboxes `Number/String/Boolean` objects and drops `undefined`, functions and symbols (read in `lib/canonicalize.js`). That is the right behaviour for a general library and the wrong one for a hash boundary: a value that vanishes silently produces a digest that two parties disagree on.

**5. Decision.** Adapt (13 §4.5 stands): implement RFC 8785 ourselves in about 80 lines, wrapped in a stricter **Plumbline profile**, gated on R14's vectors and on a differential test against R15 over profile-conforming documents. **Draft check performed:** a 25-line draft (key sort by default `Array.prototype.sort`, `JSON.stringify` for strings and integers, rejection rules below) produced byte-identical output on all six R14 files in JCS mode, and the profile mode rejected `values.json` (it contains non-integers) and accepted the other five. Rejected: keeping a private canonical JSON (13 §6.8), RDFC and CBOR for hashing (13 §4.5), accepting R15 as the production boundary.

**6. Design.**

```ts
declare function canonicalize(v: unknown, profile?: "plumbline" | "jcs"): Result<string>;   // "jcs" only in tests/differential
declare function canonicalBytes(v: unknown): Result<Uint8Array>;                          // UTF-8, no BOM, no trailing newline
declare function parseStrict(src: Uint8Array | string, limits?: Limits): Result<Json>;    // I-JSON parser, same profile
declare function digestJson(domain: DomainTag, v: unknown): Result<DocHash>;
interface Limits { maxDepth: 64; maxBytes: 16_777_216; maxMembers: 65_536; maxNodes: 2_000_000 }
```

Profile rules (each has a vector, below):
1. **Numbers**: only safe integers; `-0`, non-integers, NaN, Infinity, integers beyond 2^53 - 1 are errors. This is the floats-only-in-memory rule (INT-010) at the byte level: money is `MinorUnits` (a decimal string), rates and scores are integers of a named scale (`Ppm`, `Milli`, `Micros`, `Cb`), and any other decimal is a **string** whose shape is enforced by a schema pattern (component 3). A source token such as `1.0`, `1e2` or `-0` is rejected by `parseStrict`, so parse then canonicalise is the identity on accepted text.
2. **Strings**: must be well formed (no lone surrogate, raw or `\ud800`-escaped); escaping is exactly `JSON.stringify` (well-formed since ES2019), which matches RFC 8785 section 3.2.2.2 (lowercase `\u00xx` for controls, `\"`, `\\`, `\b\t\n\f\r`, nothing else; U+007F and U+2028 raw). A test pins this against the engine version in `doctor`.
3. **Keys**: sorted by UTF-16 code units; duplicate keys rejected at parse time; `__proto__` and `constructor` are legal keys but parsed objects are created with a null prototype (prototype-pollution defence), and member insertion uses `Object.defineProperty`.
4. **Values**: only `null`, boolean, string, integer, arrays (dense, no extra properties) and plain objects (prototype `Object.prototype` or `null`, own enumerable string keys only, data properties only: a getter is rejected because two reads could differ). `undefined`, functions, symbols, bigint, `Date`, `Map`, class instances, `toJSON` are errors (the opposite of R15).
5. **Absent is not null**: the canonicaliser never drops or adds members; whether `null` is allowed is the schema's decision.
6. **No Unicode normalisation**; NFC is a declared ingestion step in M1/M2 whose output is stored beside the raw value.
7. **Limits** as above, enforced iteratively (explicit stack) so depth cannot overflow the call stack.
8. Digest preimage and form (INT-003): `DocHash = "jcs:" + hex(SHA-256(domainTag || 0x0A || canonicalBytes))`; `RawHash = "sha256:" + hex(SHA-256(bytes))`; `Commitment = "com:" + hex(SHA-256(salt || domainTag || value))`; hex is 64 lowercase characters. The LF separator replaces the `0x00` of the first draft; every vector below was recomputed under it.

**7. Tests and vectors.**
- `JCS-V1` the six R14 files (`arrays, french, structures, unicode, values, weird`) byte-identical in `jcs` mode; `values` rejected in `plumbline` mode with `E_NUMBER_PROFILE`. `JCS-V2` the RFC 8785 appendix examples transcribed from the RFC text at build time (not transcribed here). `JCS-V3` the 100-million-line ES6 number file (R14), evaluation tier only, `jcs` mode, integers subset also checked in `plumbline` mode. `JCS-D1` property-based differential (R22) against R15 on random profile-conforming documents (1e5 runs, fixed seed in CI, replayable with `seed`/`path`); R14's Python reference as a third implementation in the evaluation tier. `JCS-X` cross-implementation: the frozen files in `vectors/jcs/` are the shared vectors for both M9 verifier implementations.
- Own vectors (`DocHash` under the domain `plumbline.test.v1`, preimage `plumbline.test.v1 || 0x0A || bytes`; the first draft used `0x00` and its twelve digests were reproduced exactly before the separator changed; the table below was then **recomputed by a throwaway script in integration pass 2 and is to be re-derived by the real implementation and by the second one**):

| Id | Input | Canonical text | `jcs:` digest (first 16 hex) |
|---|---|---|---|
| P01 | `{}` | `{}` | 7aa72b8fdf8903e3 |
| P02 | `{"b":1,"a":2}` | `{"a":2,"b":1}` | f5ea38de1d979ba4 |
| P03 | `{"z":[3,{"y":null,"x":true}],"a":"s"}` | `{"a":"s","z":[3,{"x":true,"y":null}]}` | 12197569d13e1f43 |
| P04 | keys U+20AC, U+D83D U+DE02, U+FB33 with values 1, 2, 3 | sorted in that order (code-unit order) | 706a4a10ba21cbb4 |
| P05 | `{"k":"\u001f\n\u007f"}` | `{"k":"\u001f\n<raw 0x7f>"}` (hex `7b226b223a225c75303031665c6e7f227d`) | a3a4346d4f3fce07 |
| P06 | `{"k":"a\"b\\c/"}` | `{"k":"a\"b\\c/"}` (hex `7b226b223a22615c22625c5c632f227d`) | e6b4b771c27c50cd |
| P07 | `{"n":9007199254740991}` | same | 023df8b442e2c888 |
| P08 | `{"n":-17}` | same | 267d4e20cc762db0 |
| P09 | `{"n":0}` | same | 6c11094b6e625f3b |
| P10 | `{"amount":"1250.00","currency":"EUR"}` | same | 0105de328fd9e513 |
| P11 | `{"a":null}` | same | 5b030aeb8202dbf2 |
| P12 | `{"h":"sha256:" + 64×"ab"}` | same | ad7584171b7e70cb |

Digest-kind vectors (full 64-hex bodies): **K-RAW1** `rawHash("abc")` = `sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` and **K-RAW2** `rawHash("")` = `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (both published SHA-256 values; the implementation must also agree with `sha256sum`); **K-DOC1** `digestJson("plumbline.test.v1", {})` = `jcs:7aa72b8fdf8903e31671d49aca0d124dce3593e2f4ffe843ad8683339078ec9f` (P01 in full); **K-COM1** `commit("plumbline.test.v1", "IBAN-123", salt = 00 01 02 … 0f)` = `com:65f4de55d031429644673d88faa20220c6c51d90acefa729dd1ea5b5a277295d` (test salt of 16 bytes; production salts are 32). Negatives: a `jcs:` value where `sha256:` is required, an uppercase or 63-character hex body, and an unknown prefix each yield a typed parse error.

Negative vectors, each expecting a typed error and no output: N01 `1.5`, N02 `-0`, N03 `2^53`, N04 NaN, N05 Infinity, N06 lone surrogate in a value, N07 lone surrogate in a key, N08 `undefined` member, N09 function member, N10 `Date`, N11 `Map`, N12 bigint (all N01 to N12 were rejected by the draft; the draft's first transport of P06 lost a backslash through the shell, which is why vectors are stored as files, not typed into commands). Parser negatives: duplicate key (`{"a":1,"a":2}`), `{"a":1.0}`, `{"a":1e2}`, BOM, trailing comma, leading zero `01`, depth 65, a 17 MiB document, `"\ud800"`.
- `JCS-IDEM` `canonicalize(parseStrict(canonicalBytes(x))) == canonicalBytes(x)` for 1e5 random documents. `JCS-ORDER` key insertion order never changes the digest.

**8. Risks / NOT VERIFIED.** The draft was run on six public vectors only; number edge cases under the full R14 file are not yet exercised (the profile makes them unreachable except in `jcs` mode). `JSON.stringify` escaping is pinned to Node 22's V8; a future engine change is detected by `JCS-V1` at `doctor`. A hand-written parser is a place for bugs: it is differentially tested against `JSON.parse` on every accepted document (equal values) and against a corpus of invalid inputs.

**9. Build notes.** Second, right after component 1. The vectors directory is frozen early because M9's verifier cores are built against it (spec step 8).

### Component 3. JSON Schema contracts: profile, authoring, pinned strict validation, golden hashes

**3. References.** R17 (Ajv), R18 (TypeBox), R19 (json-schema-to-ts), R20 (test suite), R21 (MCP schema usage), R3 and R4 (typed message and output classes), R6 (validators per step), R16.

**4. What they do.** R17 implements draft 2020-12 and 2019-09 by generating code per schema; strict mode turns silently ignored keywords into compile errors (`strictSchema`), forbids union types except with `null` (`strictTypes`), requires `type` beside `properties` and tuples with size bounds; the security page warns that `allErrors: true` and some `ajv-formats` regexes enable slow-validation attacks and that code generation needs `unsafe-eval` under a browser CSP. R18 builds JSON Schema objects in memory and infers the TypeScript type from the builder call (`Type.Static`), so the schema object is itself the document; it does not set `additionalProperties: false` by default (README example). R19 derives the type from a literal `as const` schema at the type level only. R21 fixes 2020-12 as the MCP default dialect, so a schema in our dialect can be served as an MCP `outputSchema` unchanged. R20 is the community conformance corpus.

**5. Decision.** Adopt Ajv 8 as the pinned validator and TypeBox as the authoring layer; own the **Plumbline Schema Profile (PSP)**, a linted subset of 2020-12, and the golden-hash discipline. This reverses the earlier custom `Schema<T>` (D-011, 06 §9.2) for the reason D-011 gives (standard, exportable, checkable from any language). Rejected: Zod as the authoring layer (not evaluated here; it would also enter the tree as a peer dependency of LangGraph.js, which does not make it ours to author in), json-schema-to-ts as primary (kept as the fallback if spike `S1` shows TypeBox 1.x cannot express a shared type; its `as const` literal route avoids a builder but depends on type-level parsing of large literals, hypothesis NOT VERIFIED).

**6. Design.**

*PSP rules (enforced by `schema-lint`, which runs on every emitted document):*
1. `$schema` is the 2020-12 URI; `$id` is `https://plumbline.invalid/schema/<name>/v<N>` (reserved TLD, never dereferenced); `$ref` only to `#/$defs/...` or to a registered `$id`; no remote loading (`loadSchema` unset).
2. Allowed keywords: `$schema, $id, $defs, $ref, type, properties, required, additionalProperties, items, minItems, maxItems, uniqueItems, enum, const, minLength, maxLength, pattern, minimum, maximum, oneOf, title, description, examples, $comment` (plus `propertyNames` and `maxProperties` for the map form of rule 3 only). Everything else (`format`, `default`, `allOf`, `not`, `if/then/else`, `dependentSchemas`, `patternProperties`, `prefixItems`, `$dynamicRef`, `multipleOf`, `unevaluated*`) is a lint error. Unknown keywords are also errors in Ajv itself (`strictSchema`).
3. Every object has `additionalProperties: false` (maps are `{type:"object", propertyNames:{pattern}, additionalProperties:<schema>, maxProperties:N}` and require the explicit `propertyNames` keyword added to the allowed set for that form only).
4. Bounds are mandatory: every string has `maxLength`, every array `maxItems`, every integer `minimum` and `maximum`. This bounds validation cost and model output size (context control) by construction. `type: "number"` is a lint error in every schema that describes a hashed, signed, recorded or cassetted document, which is every schema that leaves memory (INT-010): scores, rates, sampling parameters and costs are `integer` with a named scale (`S.Ppm`, `S.Milli`, `S.Micros`, `S.Cb`), money is `S.Minor` (a `MinorUnits` string). Floating point stays inside functions.
5. `pattern` values come from a closed catalogue (`P_RAWHASH`, `P_DOCHASH`, `P_COMMITMENT`, `P_HASH` for the union of the three, `P_ISO_UTC`, `P_DECIMAL`, `P_MINOR`, `P_ID(prefix)`, `P_TENANT`, `P_SLUG`, `P_DIGEST_DOMAIN`), each reviewed for linear-time behaviour; this removes the ReDoS class that R17's security page describes instead of detecting it. `format` is banned because format validation differs between libraries and versions.
6. `oneOf` only as a discriminated union: every branch is an object with a distinct `const` discriminator member.
7. Model-facing schemas (`PSP-M`) additionally require every property to be listed in `required` (optionality is a nullable member), which is the strictest common shape of structured-output decoders (which of them the NVIDIA endpoint offers is bake-off 7, NOT VERIFIED).

*Authoring layer (`src/kernel/schema.ts`):* a thin wrapper `S` over TypeBox with strict builders: `S.Obj` (adds `additionalProperties:false`), `S.Str({maxLength})` (requires the bound), `S.Int({min,max})`, `S.Ppm()`, `S.Milli()`, `S.Micros()`, `S.Cb()`, `S.Minor()`, `S.RawHash()`, `S.DocHash()`, `S.Commitment()`, `S.Hash()` (the union, only where the field is genuinely generic), `S.IdOf("ev")`, `S.Tenant()`, `S.Iso()`, `S.Decimal(maxLen)`, `S.Union(disc, branches)`. Types come from `Static`. `npm run schemas:emit` converts each exported schema through `JSON.parse(JSON.stringify(x))` (drops TypeBox's symbol metadata), runs `schema-lint`, writes `schemas/<name>.schema.json` as canonical JCS bytes and updates `schemas/manifest.json`:

```jsonc
{ "v": 1, "validator": { "lib": "ajv", "version": "<exact>", "options": { /* below */ } },
  "schemas": [ { "name": "Evidence", "$id": "…/Evidence/v1", "schemaHash": "jcs:…", "semanticHash": "jcs:…", "psp": "1" } ] }
```
`schemaHash = digestJson("plumbline.schema.v1", doc)` (a `DocHash`); `semanticHash` is the same over the document with annotations (`title, description, examples, $comment`) removed, under `plumbline.schema.semantic.v1`. Rule: a changed `semanticHash` requires a new `$id` version; a changed `schemaHash` alone (documentation) only needs the manifest update. The spec's old objection (a library upgrade could change hashes) cannot arise because hashes are over our documents; what a library upgrade can change is validity decisions, which the validator vectors below pin.

*Validator contract (`src/kernel/validate.ts`):* Ajv 2020-12 entry point (module path to be confirmed from its docs at build; NOT VERIFIED here) with `strict: true, strictTypes: true, strictTuples: true, strictRequired: true, strictNumbers: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false, $data: false, validateFormats: false, unicodeRegExp: true` (the `strict*` names come from the fetched strict-mode page; the others are to be confirmed against Ajv's options page at build, NOT VERIFIED here). Compiled once at start-up into a `SchemaRegistry` keyed by `$id`. Instances are `parseStrict`ed (component 2) before validation, so duplicate keys and non-profile numbers never reach the validator. `validate(id, x): Result<void, ValidationFailure>` where `ValidationFailure = { schemaId, instancePath, keyword, params }` truncated to bounded size and never echoing instance text longer than 80 characters (errors flow into traces and prompts). Re-prompt feedback for the `validation` class is built from these fields, not from Ajv's message strings. A second pass with `allErrors: true` is allowed only on instances at most 64 KiB, to give the model all failures at once, under a 50 ms wall budget (R17: no `allErrors` in production for unbounded input; ours is bounded by rule 4 and by the cap).

*Validator behaviour vectors:* `vectors/schema/*.json` hold `{ schema, instance, valid, keyword }` cases: a pinned subset of R20's `draft2020-12` files restricted to PSP keywords (licence MIT, attribution file kept) plus our own cases for every PSP rule. `doctor` runs a 200-case subset at start; CI runs all. `validatorProfileHash = digestJson("plumbline.manifest.v1", manifest.validator)` goes into `RunManifest`.

*Offline verifier (INT-051).* M9's core must stay dependency-free, so it cannot link Ajv, and bundle members must still be validated against schemas. PSP is therefore a **deliverable of this module**: a restricted dialect (the 20 keywords above) with a reference interpreter of about 250 lines, `src/kernel/psp.ts`, that M9 copies into the verifier core and re-implements in the second language. This module owes M9 the schema files, the vectors, the interpreter, and the differential test "PSP interpreter agrees with Ajv on every vector and on 1e5 generated instances per schema". A verifier that does not run the interpreter cannot call a member schema-valid.

*Export.* The same files are MCP `outputSchema`/`inputSchema` documents (R21) and the JSON Schema for A2A and CLI help; M10 consumes `schemas/`.

**7. Tests.** `SCH-LINT` each PSP rule has a failing fixture; `SCH-HASH` golden hashes for every schema (`schemas:check` fails on drift, on a missing manifest entry, on a version-less semantic change); `SCH-TYPE` for each shared type of `00-conventions` a type-level equality test (`expect-type` style) between `Static<S>` and the hand-written interface, so the conventions file and the schemas cannot diverge; `SCH-VEC` validator behaviour vectors; `SCH-DIFF` PSP interpreter vs Ajv; `SCH-FUZZ` property tests (R22): instances generated from a schema validate, one-keyword mutations of those instances fail where the mutation violates a constraint; `SCH-BOUND` a 10 MiB string and a 1e6-element array are rejected before validation work (cap) and within a time bound.

**8. Risks / NOT VERIFIED.** TypeBox 1.x was read from its README only; its emitted documents have not been run through Ajv strict mode (spike S1 does exactly that on all shared types and on discriminated unions before any other code depends on it). Ajv code generation uses `new Function`, which Node allows; it is a non-issue for the CLI and would matter only if the console validated with Ajv in a CSP page (it does not; M10 uses the PSP interpreter). The closed pattern catalogue may be too narrow for free-text identifiers; adding to it is a reviewed change. Supply chain: Ajv adds four transitive packages and TypeBox none (registry metadata); the lockfile pins exact versions and hashes (M8 reviews).

**9. Build notes.** Third. Spike S1 first: express the shared types, emit, lint, validate, and compare against `json-schema-to-ts` on the same set, before any other code depends on the choice. Unblocks 5, 8, 9, 10, 14, 16.

### Component 4. Ports and the interceptor chain

**3. References.** R3 (`InterventionHandler.on_send/on_publish/on_response` with `DropMessage`: a genuine in-code gate at the runtime boundary), R4 (scripted test model in `testing/model.py`; approvals as state), R1/R8 (checkpointer as a port), R30 (deadline propagation), R31 (FoundationDB and TigerBeetle stub every source of nondeterminism: clock, network, disk).

**4. What they do.** R3's intervention handlers see every message crossing the runtime and may rewrite or drop it; that is the shape we need for egress checks and capability checks (M8) and ledger leaves (M9) without those modules editing the runtime. R31's simulators work because the program under test calls only injected interfaces; 13 §5 shows the same method applied here.

**5. Decision.** Adapt. Ports are TypeScript interfaces; every effect goes through one function (`perform`, component 5) that runs an interceptor chain around the port call. The spec names five ports (model, tools, clock, rng, ids); the full set requested by all fourteen modules (INT-056, register section 2.2) is the `Ports` block below: the four ports this blueprint already added (`scheduler`, `store`, `ledger`, `human`) plus `net`, `fs`, `sandbox`, `journal`, `ids.secret`, `signer`, `keys`, `authorize`, a kill-state interceptor, a memory mode of `store`, and a tenant on every call. `rng` is a kernel service derived from the seed (component 1), not an external port. The determinism lint (rule 4) is the control that forces every effect through these: nothing outside `src/runtime/adapters/**` may import a network, file or process module. All adapters live there; `NetPort`'s implementation is M8's `ports/egress.ts` and the `SandboxPort` backend is selected by M8, but both are declared here and registered in the composition root.

**6. Design.**

```ts
interface Ports {
  model: ModelPort; tools: ToolPort; clock: ClockPort; ids: IdsPort; scheduler: SchedulerPort;
  store: StorePort; ledger: LedgerPort; human: HumanPort;
  net: NetPort; fs: FsPort; sandbox: SandboxPort; journal: SyncJournal;
  signer: SignerPort; keys: KeyPort; authorize: AuthorizePort;
}
type TenantCtx = Brand<TenantId, "TenantCtx">;       // minted only by M8's forged-object mechanism; `tn_default` on the judge path
interface CallCtl { signal: AbortSignal; deadlineMs: number; tenant: TenantCtx }   // deadline per R30: remaining time, not an instant; every port method takes it
interface ModelPort {
  readonly id: string; readonly modelProfile: "sponsor" | "evaluation" | "local";   // INT-020: renamed axis; scripted and baseline adapters are `local`
  readonly capabilities: { structuredOutput: "none" | "json_schema" | "grammar"; reasoningCapTokens: number };
  complete(req: ModelRequest, ctl: CallCtl): Promise<Result<ModelResponse, PortError>>;
  countTokens?(req: ModelRequest): number;                 // optional exact count, else estimator (component 7)
  canonicalRequest(req: ModelRequest): Json;               // the model-side `normalise`: volatile fields removed, key for the effect hash (INT-042)
}
interface ModelRequest {
  model: string; promptId: string; promptDigest: DocHash; messages: Message[];
  responseSchema?: { id: string; hash: DocHash }; toolSurface?: DocHash;
  params: { temperatureMilli: Milli; topPMilli?: Milli; maxOutputTokens: number; seed?: number; stop?: string[] };   // integers: the request is hashed (INT-010); the adapter converts at the wire
  conf: Confidentiality; trust: TrustLevel;                 // joins computed by the caller (M8 rules)
}
interface ModelResponse { content: string; finish: "stop"|"length"|"tool_calls"|"refusal"; usage: { inputTokens: number; outputTokens: number }; servedModel: string; providerId?: string }
interface ToolPort {
  surface(): ReadonlyArray<ToolSpec>; surfaceHash(): DocHash;
  invoke(name: string, args: Json, ctl: CallCtl & { idemKey?: DocHash }): Promise<Result<Json, PortError>>;
  status?(idemKey: DocHash): Promise<Result<"unknown" | "pending" | { done: Json }, PortError>>;   // in-doubt probe
}
interface ToolSpec { name: string; version: string; effectClass: "read" | "write" | "irreversible";
  argsSchema: string; resultSchema: string; idempotency: "natural" | "key" | "none"; timeoutMs: number;
  maxConf: Confidentiality; ledger?: LeafType; requires?: "Approved" }
interface ClockPort { nowIso(): Iso; monotonicMs(): number }
interface SchedulerPort { sleep(ms: number, signal: AbortSignal): Promise<void> }
interface IdsPort { secret(bytes: number): string }        // base64url from the OS CSPRNG, for MCP handles; never derivable from the seed
interface HumanPort { notify(i: Interrupt): Promise<void> }          // outbound only; answers arrive via runtime.respond (component 13)

// --- storage (INT-043): one blob store, addressed by RawHash, partitioned by confidentiality class
interface StorePort {
  openLog(t: TenantCtx, name: string): Promise<LogHandle>;           // names are prefixed `tn_<id>/` by the adapter; a caller cannot spell another tenant's path
  putBlob(t: TenantCtx, part: Confidentiality, b: Uint8Array): Promise<RawHash>;   // the address is computed here, never supplied
  getBlob(t: TenantCtx, h: RawHash): Promise<Result<Uint8Array, PortError>>;       // not found: E_STORE_MISS; erased: `E_BLOB_ERASED` carrying the tombstone's erasure-receipt hash
  lock(t: TenantCtx, name: string): Promise<Result<LockHandle>>;
  memory: MemoryStorePort;                                           // mode for M6 (below)
}
interface LogHandle { append(frame: Uint8Array, o: { sync: boolean }): Promise<void>; read(): AsyncIterable<Uint8Array>; truncate(offset: number): Promise<void>; size(): Promise<number>; close(): Promise<void> }
interface MemoryStorePort {                                          // INT-056, M6 SF13
  openLog(t: TenantCtx, name: string, o: { replay: "scratch" | "strict" }): Promise<LogHandle>;   // in replay, writes go to a scratch store
  readAtPin(t: TenantCtx, pin: SnapshotPin): AsyncIterable<Uint8Array>;   // pure
  anchor(t: TenantCtx, stream: string): Promise<DocHash>;
}
interface FsPort {                                                   // the only user of node:fs; implementation sits under StorePort
  writeAtomic(p: string, b: Uint8Array, o: { fsync: true; dirSync: boolean }): Promise<Result<void>>;   // non-authoritative files only (M1 index, bundle outputs); see rule 6
  readFile(p: string): Promise<Result<Uint8Array>>; lstat(p: string): Promise<Result<FileStat>>;
  exclusiveCreate(p: string, b: Uint8Array): Promise<Result<void, "exists">>;   // M13's nonce store is built on this
  rename(a: string, b: string): Promise<Result<void>>; listDir(p: string): Promise<Result<string[]>>;
}   // symlink refusal and containment checks live here

// --- world-facing ports whose implementations are other modules'
interface NetPort {                                                  // `ctx.net`; implemented by M8 `ports/egress.ts`, the only caller of `fetch` and `node:net`
  send(req: { method: string; url: string; headers: Record<string, string>; body?: Uint8Array }, labels: LabelSet, ctl: CallCtl):
    Promise<Result<{ status: number; headers: Record<string, string>; body: Uint8Array; hops: Hop[] }, PortError>>;
}   // `LabelSet` is M8's, `Hop` is M1's transport type; the SAMPLE_MODE guard throws here
interface SandboxPort {                                              // M2 DocWorker, M8 compartment
  spawn(o: { entry: string; backend: CompartmentBackend; limits: Limits; env: {}; stdin: Uint8Array }): Promise<Result<SandboxHandle>>;
}   // handle: request(frame): Result<Uint8Array, SandboxError>; kill(reason); usage(): {wallMs; rssMb; outBytes}. Effect record: (docSha, pipelineVersion) -> analysisHash
interface SyncJournal { append(streamId: string, line: string): void; readAll(streamId: string): Iterable<string> }   // M12 SF3; local durable, not cassetted, in-memory by default
interface SignerPort { sign(req: SignRequest): Promise<Result<SignResponse, SignError>>; publicKeys(): KeyRegistry }   // client of M9's signer process; no private bytes cross the pipe; roles per INT-017
interface KeyPort { inventory(): Promise<KeyInventory>; rotate(role: KeyRole): Promise<Result<void>>; wrap(dekId: string, b: Uint8Array): Promise<Result<Uint8Array>>; unwrap(dekId: string): Promise<Result<Uint8Array>> }   // M13 owns it; behind the signer, also per-object DEKs
interface AuthorizePort { authorize(principal: Principal, action: string, resource: string, t: TenantCtx): Result<Allow, Deny> }   // M13 data, declared here; every deny and every sensitive allow is traced
```

*What is an effect and what is not.* **Recorded effects** (slot, request hash, WAL and cassette record): `model`, `tools` (including `source.fetch` and every M13 target interaction), `human.response`, `sandbox` analyses, and `net` calls made directly by a step. **Local, deterministic services** (a read is not recorded unless it is the clock): `ids.next`, `rng`, `authorize` (a pure function of its data file, whose hash is part of the profile hash), `signer`, `keys`, `fs`, `journal`, `store`. A `net.send` issued from inside a tool or model adapter is part of the enclosing effect: the enclosing record owns the slot and the reservation, and the exchange itself is recorded by its owner (M1's transport cassette, component 6). A wire call still passes `kill`, `egress` and `capability` with the labels of the enclosing call, so an adapter cannot skip them. `ids.secret` is recorded in `record` mode **as a `Commitment` only**, and `replay` returns a fixed test value; a secret never enters state, trace, WAL or cassette in clear (`Secret<T>`, component 5).

Rules: (1) **Tool surface is hash-pinned**: `ToolPort.surfaceHash()` is recorded in `run.begin`; a changed surface mid-run or on resume fails closed with `E_TOOL_SURFACE_CHANGED` (spec section 5; M12's MCP client uses it). (2) **A tool declares its effect class**; `irreversible` requires `Approved<T>` in its argument type and at run time (component 10). (3) **Deadline is a remaining duration**, converted at call time as gRPC does (R30), so a replayed run under a virtual clock behaves identically. (4) **Determinism lint** (backing `ctx` discipline of 06 §9.4): `no-restricted-globals` and `no-restricted-imports` for `fetch`, `Date`, `performance`, `Math.random`, `crypto.randomUUID`, `setTimeout`, `setInterval`, `node:http(s)`, `node:net`, `node:fs`, `node:child_process` everywhere except `src/runtime/adapters/**`; plus an AST test (TypeScript compiler API) that fails on the same identifiers so a lint-disable comment cannot hide one; plus, in `replay` and `sim` modes, throwing stubs installed on those globals (catches accidents, not malice; JavaScript cannot sandbox a step and the blueprint does not claim it can). (5) **Tenancy on every call** (INT-048): `StepCtx.tenant` is fixed at `run.begin`; every `CallCtl`, store name, ledger stream, cassette header and trace line carries it; the adapter prefixes every storage key, cache key, cassette key and stream name with `tn_<id>`, and a call whose `tenant` differs from the run's fails with `E_TENANT_MISMATCH`. The judge path runs exactly one tenant, `tn_default`, so nothing is lost; the field exists from the first line of code because retrofitting it would change slot keys and cassette formats. (6) **Atomic file writes are for non-authoritative files only**: the WAL, snapshots and cassettes use `StorePort` append and `exclusiveCreate`, never rename-over (component 11); `FsPort.writeAtomic` serves M1's cache index and M9's bundle outputs, and on Windows its durability is NOT VERIFIED. (7) **Interceptors** (INT-020, INT-056):

```ts
interface Interceptor { id: string;
  before?(c: EffectCall): Promise<{ allow: true; annotate?: Partial<EffectMeta> } | { allow: false; error: PlumblineError }>;
  after?(c: EffectCall, o: EffectOutcome): Promise<void> }
// chain order, fixed: [schema, kill(M8), egress(M8), capability(M8), budget, <port>, record, label(M8), ledger(M9), trace]
```
`kill` denies any call whose `effectClass` is not `read` while `kill.engaged` (M8 C14); it sits before `budget`, so a killed run spends nothing. `egress` decides *whether this may leave* (label against the manifest; M8), `NetPort` is the *how* (M1's allowlists, pinning, redirects, caps; one `ctx.net`, INT-020). `budget` and `record` are kernel-owned positions: `perform` runs the `before` hooks of the first four, then reserves (component 7), writes `effect.begin`, calls the port, settles, writes `effect.end` (`record`), and then runs the `after` hooks of `label`, `ledger` and `trace`. A refusal from `before` consumes its occurrence index (so replay aligns), costs no budget and is recorded with outcome `refused`. Interceptors from other modules may veto or annotate; they may not edit the request (an edited request would break key stability); a rewrite is expressed as a different call.

**7. Tests.** `PORT-LINT` the forbidden-identifier AST test with seeded violations; `PORT-CONTRACT` a shared contract suite run against the scripted, sim and live adapters (response shape, error mapping, abort, deadline); `PORT-SURFACE` a changed tool list mid-run fails closed; `PORT-REFUSE` a refused call aligns on replay; `PORT-ORDER` interceptor order is fixed and a mis-ordered registration fails at start-up; `PORT-KILL` with `kill.engaged` a `write` and an `irreversible` call are refused before reservation and a `read` is not; `PORT-TENANT` a store name, ledger stream or cassette key built for another tenant is unreachable and the call returns `E_TENANT_MISMATCH`; `PORT-NET` a direct `fetch` or `node:net` import outside adapters fails the lint, and `net.send` in `judge-replay` throws the stub error; `PORT-SECRET` `ids.secret` leaves only a `com:` value in WAL, cassette and trace; `PORT-STORE` a `getBlob` of a tombstoned address returns `E_BLOB_ERASED` and never an empty body, and the same address under two confidentiality partitions is two objects.

**8. Risks / NOT VERIFIED.** The five-port wording of the spec may be intentional minimalism; the added ports are required for the sim (store, scheduler), for M9 and M13 (ledger, human, signer, keys, authorize) and for M1, M2, M8 and M12 (net, fs, sandbox, journal). Streaming responses are not in the contract (cap enforcement by abort needs them; section 7 explains the fallback). The treatment of wire calls inside a tool effect (above) is this blueprint's reading of INT-020 and INT-042 and needs M1's and M8's confirmation. `NetPort`, `SandboxPort`, `SignerPort` and `KeyPort` are declared here but only exercised against sim adapters until M1, M8 and M9 deliver their implementations.

**9. Build notes.** Step 1 declares every port of this table, the tenant field and the interceptor chain (register section 5, V3); components 5 to 7 follow in steps 2 and 3; the net and sandbox adapters arrive with M1 and M8 (step 9), the signer client with M9 (step 8a), and the kill-state gate is exercised at step 7.

### Component 5. Effect layer: records, slots, keys, occurrence indexes, dedup, in-doubt

**3. References.** R32 (Temporal compares emitted commands with recorded history; `runReplayHistory` raises `DeterminismViolationError`), R33 (WireMock `repeatsAsScenarios` as the occurrence-index idea; VCR.py `none` mode; cagent normalises tool-call ids before matching), R1/R8 (pending writes: a crash mid-superstep does not repay finished tasks), R9, R29 (idempotency key as a pattern name), R24 (write-ahead log).

**4. What they do.** R8 `loop.ts` saves each task's writes as the task finishes (`putWrites`), so a failed superstep's completed siblings are not recomputed; but a task that crashed mid-way re-runs from its first line, and any external effect before the crash happens again unless the author made it idempotent (06 §4.7, 06 §9.11). Temporal makes the same step safe by recording each activity result in history and comparing commands on replay. HTTP cassette tools key on request shape (13 §4.4 critique): they cannot represent "the clock returned T" and have no ordering identity for repeated identical requests.

**5. Decision.** Own, assembled from those ideas: effect identity is a **slot** `(tenant, branch, step, instance, n, port, op)`; the request digest is compared against the recorded one; the same record serves crash dedup (WAL) and replay (cassette). The WAL and this layer belong to the effect layer, not to the substrate, and exist before bake-off 1 (INT-057 a). Rejected: transport-level keys; content-only keys (two identical model calls with different recorded answers, such as a retry, would collide).

**6. Design.**

```ts
interface Slot { tenant?: TenantId; branch: string; step: StepId; instance: number; n: number; port: PortName; op: string }
//  tenant: set on every call; omitted from the slot digest when it equals `tn_default`, so the judge-path vectors stay stable (INT-048)
//  branch: "" for the main path, "f3.2" for branch 2 of fan-out step f3, nested with "/" ("f3.2/f5.0")
//  instance: activation count of `step` in this branch (loops), a monotonic field restored on resume
//  n: per (branch, step, instance) counter over ALL effects including retries and refused calls
interface EffectRecord {
  v: 1; slot: DocHash; key: DocHash;                 // slot = digestJson("plumbline.effect.slot.v1", Slot); key = digestJson("plumbline.effect.key.v1", {slot, reqHash})
  s: Slot; reqHash: DocHash; req?: Json;             // req inline only when its conf is public/case-visible and bodyPolicy allows
  outcome: "ok" | "error" | "refused" | "in_doubt";
  resp?: Json; respHash?: DocHash; blob?: RawHash;   // body inline, or in the content store (RawHash address), or hash-only (bodyPolicy)
  bodies?: (RawHash | Commitment)[];                 // bodyHash of every body the response refers to (source.fetch; see below); a Commitment when conf is above public (INT-003)
  err?: { class: ErrorClass; code: ErrorCode; retryAfterMs?: number };
  usage?: { inputTokens: number; outputTokens: number }; reserved?: ReservationRecord;
  ms: number; at: Iso;                               // recorded latency and clock reading (virtual time in replay)
  conf: Confidentiality; trust: TrustLevel; bodyPolicy: "inline" | "blob" | "hash-only";
  idem?: DocHash; leaf?: { stream: string; seq: number; index: number };   // `index` is global to the ledger: kept in the WAL, removed by normalisation and by the core digest
}
```
*The `source.fetch` record (INT-042).* Two layers, one contract. **Layer 1 (this record):** `{slot, reqHash, respHash, outcome, bodies}` where `respHash` is the `DocHash` of the canonical `FetchOutcome` *without bodies*, `bodies` lists every `bodyHash`, and `bodyPolicy` is `blob` (bodies in the content store), not `hash-only`; `requestKey` (M1's transport key) is an input to `reqHash`. **Layer 2 (M1):** the transport cassette (`requestKey`, hop list, headers, body hash) records the network exchange; in replay M1 re-runs hashing, parsing, trust assignment and evidence building from layer 2 and the result must equal layer 1's `respHash`, so equality is checked twice. Lookup is by slot with request-hash verification; `canonicalRequest` for a model call is `ModelPort.canonicalRequest` and an M13 target interaction is an ordinary `ToolPort` effect.

`perform` (the only path to a port; pseudocode):

```ts
async function perform<T>(ctx: StepCtx, call: EffectCall): Promise<Result<T>> {
  if (call.tenant !== ctx.tenant) return fail(tenantMismatch(call.tenant));        // 0. G10: nothing crosses a tenant
  const s = ctx.nextSlot(call.port, call.op);                         // 1. n++ deterministically
  const reqHash = digestJson("plumbline.req.v1", normalise(call.req)); //    normalise: strip volatile fields declared per op (ModelPort.canonicalRequest for models)
  const rec = ctx.effects.lookup(s);                                   // 2. WAL index (resume) or cassette (replay)
  if (rec) {                                                           // 3. dedup / replay path
    if (rec.reqHash !== reqHash) return fail(nonDeterminism("request_drift", s, rec.reqHash, reqHash));
    ctx.budget.chargeRecorded(rec);                                    //    spend exactly what was recorded
    ctx.trace.effect(rec, "recorded");
    return rec.outcome === "in_doubt" ? resolveInDoubt(ctx, call, rec) : fromRecord<T>(rec);
  }
  if (ctx.mode === "replay") return fail(cassetteMiss(s, reqHash));    // 4. strict miss, never a live call
  for (const i of ctx.chain.beforeBudget) { const v = await i.before?.(call); if (v && !v.allow) return refuse(ctx, s, call, v.error); }   // 5a. schema, kill, egress, capability (component 4)
  const res = ctx.budget.reserve(call.cost(ctx));                      // 5b. pre-call reservation (component 7), may refuse
  if (!res.ok) return fail(res.error);
  await ctx.wal.append({ t: "effect.begin", slot: s, reqHash, res: res.value.record, idem: call.idemKey }, { sync: true });  // 6. write-ahead, before the call
  const out = await callPort(ctx, call, res.value);                    // 7. abort and deadline from budget, port error mapping
  const rec2 = toRecord(s, reqHash, out, res.value);
  ctx.budget.settle(res.value, rec2.usage);                            // 8. release unused, charge actual (overshoot is an error event)
  await ctx.wal.append({ t: "effect.end", rec: rec2 }, { sync: true });// 9. durable before the step may commit
  for (const i of ctx.chain.afterRecord) await i.after?.(call, rec2);  // 10. label (M8), ledger (M9; component 15), trace
  return fromRecord<T>(rec2);
}
```

*Local effects.* Clock reads are local and idempotent (ids and rng draws are pure functions of the seed and are not effects at all, component 1): they skip reservation and `effect.begin` and write only an `effect.end` record (batched with the next synced record); a lost clock record is simply read again in live mode and cannot be lost in replay.

*In-doubt effects.* A WAL with `effect.begin` and no `effect.end` after a crash is **in doubt**. Resolution by effect class: `read` and model calls with `idempotency: natural`: redo the call (a model call whose answer was lost is paid for again; the **reservation stays charged** as spent, so budget is conservative, and the trace marks `redo_after_crash`); `write` with `idempotency: key`: call `tools.status(idemKey)`; `done` becomes the response, `unknown` means redo with the same key, `pending` means wait then probe; `irreversible`, or `write` without a `status` probe: **no automatic redo**; the run halts `halted_in_doubt` with `E_IN_DOUBT_EFFECT`, a trace decision (`why: rule 'effect.in_doubt', codes ['IRREVERSIBLE_NO_PROBE']`) and an interrupt for a human (M13's broker owns the write-ahead intent and probe for real releases; this is the kernel hook it plugs into).

*Idempotency key.* `idem = digestJson("plumbline.idem.v1", { runId, slot })`: stable across crash and resume of the same run, different for a new run of the same case (R29 names the pattern; no HTTP semantics are implemented).

*Response validation* happens in the step after `perform` returns, against the response schema; a validation failure is a new decision and a new slot (the re-prompt), never an edit of the recorded response. Raw responses are recorded before validation, so replay reproduces the failure and the retry.

*Body policy.* `inline` for public or case-visible data; `blob` writes the body to the one content-addressed store behind `StorePort` (RawHash address, partition by confidentiality class; the erasure service of M9 is its only deleter, INT-043); `hash-only` for rights-gated or `internal-sensitive` bodies (such records cannot replay: a replay that needs one stops with `E_CASSETTE_MISS{reason:"hash_only"}`, and M9 reports the bundle verdict INDETERMINATE, never PASS). A `blob` body that was later erased is a tombstone: replay stops with `E_CASSETTE_MISS{reason:"erased"}` and M9 reports `V5.ERASED` INDETERMINATE (INT-040), a named state and never an empty body.

*Secrets.* The trace and WAL sinks apply a structured allowlist per op (not regex scrubbing): only declared fields of a request or response are retained; credentials never enter an `EffectCall` (adapters hold them). A `Secret<T>` wrapper whose `toJSON` and `toString` throw makes accidental serialisation a failure.

**7. Tests.** `G1-DEDUP` a step that makes three effects, crash after each of `begin`, `end`, `commit`; the provider-side counter equals 3 after resume, never 4. `G1-DRIFT` a step whose request differs on resume by one field fails with `request_drift` naming the field path; `G1-INDOUBT` per class (read, write with probe, write without probe, irreversible) the table above; `G1-REFUSE` refused calls keep slot alignment; `G1-HASHONLY` a hash-only record stops replay with the right reason, and a tombstoned `blob` body stops it with `erased`; `G1-FETCH` a `source.fetch` record carries `respHash` over the body-free `FetchOutcome` plus `bodies`, and a layer-2 re-parse that disagrees with it fails; `G1-TENANT` an effect built for another tenant is refused before any slot is consumed; `G1-SECRET` serialising a `Secret` throws and no credential string appears in WAL, cassette or trace (scanned with `scripts/secret_scan.py --stdin`); `G1-N` property: for random step programs, `n` is a pure function of program order and never repeats within `(branch, step, instance)`.

**8. Risks / NOT VERIFIED.** Redo of a lost model call costs money; the policy (charge the reservation) is conservative and measurable. Normalisation of a request (which fields are volatile) is per op and easy to get wrong in one direction (too much volatile hides drift) or the other (spurious drift); the header of each cassette lists the declared volatile fields (13 §4.4) and a test fails if a volatile field is not declared by its op. Cross-process resume of in-flight HTTP effects assumes a `status` probe exists for write tools; none of the sponsor tools is known to offer one (NOT VERIFIED), in which case writes are treated as irreversible.

**9. Build notes.** Spec step 2 and 3. G1 tests gate the bake-off. The WAL (component 11), the harness, the broken drivers and the eight acceptance tests of component 17 are built with this layer in step 3, before bake-off 1 (register section 5, V1).

### Component 6. Cassettes and the two replay classes

**3. References.** R33 (VCR.py record modes, Polly.JS expiry and match configuration, WireMock occurrence index, Hoverfly `diff`, cagent YAML cassette with id normalisation, arXiv 2607.16200), R32 (Temporal replay corpus gate), R3 (response cache keyed by SHA-256 of the request, no graph binding).

**4. What they do.** 13 §4.4 summarises each tool: they intercept at HTTP transport, offer record-if-missing or passthrough modes (which hide a changed request), and none signs the cassette. R3's `ChatCompletionCache` memoises model calls by request hash with no miss-is-error mode and no relation to a graph or a trace (06 §6.3).

**5. Decision.** Own, following the file format proposed in 13 §4.4 with the slot refinement of component 5: JSONL, one effect per line, header first; modes `record` and `replay` only; `replay` is strict; there is no hybrid, no record-if-missing, no passthrough. Debug aid: `replay` accepts `divergence: "report"` (Hoverfly's idea): continue past a divergence, mark the trace `divergent: true`, and exclude such traces from every equality claim. The WAL is the primary store; a cassette is `exportCassette(wal)`, a pure function, so both share one record type.

**6. Design.**

```
{"cassette":"plumbline.cassette/v1","tenant":"tn_default","graphHash":"jcs:…","schemaManifestHash":"jcs:…","runtimeVersion":"…","codeDigest":"jcs:…",
 "seed":"…","modelProfile":"sponsor","disclosureProfile":"public_lookup","volatile":{"model":["providerId"],"tool":["requestId"]},"stripped":["authorization","x-api-key"]}
{"slot":"jcs:…","s":{…Slot…},"reqHash":"jcs:…","outcome":"ok","resp":{…},"respHash":"jcs:…","usage":{…},"ms":812,"at":"…","conf":"public","trust":"UNTRUSTED","bodyPolicy":"inline"}
```
Order: records sorted by `(branch, step, instance, n)` using the numeric-segment comparator of component 14 for the branch path (so `f3.2` precedes `f3.10`) and numeric order on the rest, so the file is a pure function of the run's content. `cassetteDigest = rawHash(bytes of the file)` (a `RawHash`, reproducible with `sha256sum`; the file's header carries the domain-bearing fields); `coreDigest = digestJson("plumbline.cassette.core.v1", [(slot, reqHash, outcome, respHash, err.code)…])` covers only those fields (never `leaf.index`) and is what two runs of the same program on different hardware should share (latencies differ). Both go into `RunManifest` and, for M9, into a ledger leaf and the bundle predicate (M9's bundle manifest carries the cassette's Merkle roots for both layers, INT-042); they prove that the decision follows from these recorded effects and nothing about the effects being real (13 §4.4).

*Replay semantics.* Start refuses on `graphHash`, `schemaManifestHash`, `runtimeVersion` or `tenant` mismatch (`E_GRAPH_DRIFT`; `--allow-code-drift` permits a `codeDigest` mismatch only, recorded in the trace). Each `perform` looks up its slot (component 5 step 2); end of run with unconsumed records is `E_NONDETERMINISM{reason:"unused_recorded", firstUnused}`. A miss is `E_CASSETTE_MISS{reason}` with reason `slot_missing`, `hash_only` or `erased`, class `fatal` (M1's `cassette_miss` wording as class `policy` is withdrawn), always with the hint code `RUN_LIVE`. Time in replay is virtual: `ClockPort` returns the recorded `at` and advances by recorded `ms`, so budget and deadline decisions reproduce, and M1's version selection in replay (latest entry with `recordedAt <= ctx.clock.now()`) reads that same virtual clock. *Replay equality* (G7) is: the same normalised trace, the same final `stateHash`, the same `coreDigest`, and per ledger stream the same leaf sequence and head leaf hash; global ledger indices and the tree root depend on how cases interleave and are never compared (INT-053).

*Replay class A, full replay (recorded input only).* Everything incl. model effects comes from the cassette. The six recorded scenarios of F-SAMPLE are class A on their recorded inputs. Any input difference surfaces as `request_drift` or `slot_missing` at the first divergent step, and the error carries `{firstDivergentStep, slot, recordedReqHash, actualReqHash, nearestRecorded}` plus the hint code `RUN_LIVE` so M10 can print the exact live command for a new vendor (F-SAMPLE).

*Replay class B, deterministic-stage replay (any input, pure closure only).* Defined in component 19. It re-executes steps flagged `deterministic: true` (kind `pure`, `gate`, `join`) from a recorded checkpoint with a state patch; recorded outputs of effectful steps are read from the commits of the original run; no effect port is reachable. It is the carrier of the input-sensitivity tests, on any input; model-bearing stages are shown input-sensitive only live (INT-044).

*Replay corpus gate (R32 idea).* Every committed bundle under `eval/` is replayed against current code in CI; a code or policy change that alters a final state hash must ship an "expected diff" file naming the bundles and the changed hashes.

**7. Tests.** `T1` (component 17) is the acceptance gate. Unit: `CAS-ORDER` the exported file is byte-identical when the same run is exported from WALs written under two different branch completion orders; `CAS-STRICT` deleting, duplicating, reordering and editing one record each produce the specific error; `CAS-DRIFT` header mismatches (including `tenant`) refuse to start; `CAS-DIGEST-KIND` `cassetteDigest` equals `sha256sum` of the file and `coreDigest` does not change when `leaf.index` values change; `CAS-FETCH` a replayed `source.fetch` rebuilds `respHash` from layer 2 and a one-byte body change fails; `CAS-DIGEST` core digest equal across two machines' runs in the sim with different latencies; `CAS-VIRTUAL` a replay run with a real clock one hour ahead gives the same budget decisions; `CAS-SECRET` stripped headers absent.

**8. Risks / NOT VERIFIED.** Virtual time hides real slowness: replay will not catch a latency regression (the live profile does). A cassette is not signed by M7; signing is M9's bundle job (13 §4.1), which is why the digest is exported, not a signature.

**9. Build notes.** Spec step 3.

### Component 7. Budgets: hierarchy, pre-call reservation, retries, wall clock, phases and finalize reserve

**3. References.** R3 (`TokenUsageTermination`: cap checked on messages that have already arrived, so a turn can overshoot), R1/R8 (`recursion_limit` is the only global cap; Python default 10007, JS `DEFAULT_LOOP_LIMIT = 25`; retries not charged; no token budget), R5 (`max_tool_rounds` and a code-enforced wrap-up turn without tools; constructor check `2 * max_tool_rounds + 2 < max_recur_limit`), R7 (`MCTSSearch.search` refuses to run when the cap cannot fund a fair search; restore preserves spent budget), R4 (`max_turns` default 10, `MaxTurnsExceeded`), R30 (deadline as remaining time), 12 §6 (cascade escalation signals), `docs/intel/02 §6` (organizer runtime table).

**4. What they do.** Across the seven clones no hard token or cost budget exists (06 §0 finding 2); R3's is soft; R1 retries are free; R7 is the only one that fails loudly when a budget cannot be honoured. R8's defaults differ between languages (25 versus 10007), a reminder that a "finite default" is a property of a version.

**5. Decision.** Own. Pre-call reservation with settlement, hierarchical, retries as ordinary calls, wall clock as a deadline, per-phase slices with a non-borrowable finalize reserve.

**6. Design.**

```ts
interface BudgetSpec { turns: number; modelCalls: number; toolCalls: number; inputTokens: number; outputTokens: number; wallClockMs: number; costMicroUsd?: number }
interface BudgetNode { id: string; parent?: BudgetNode; limit: BudgetSpec; spent: BudgetSpec; reserved: BudgetSpec; reserveFloor: BudgetSpec /* finalize reserve held back from non-final children */ }
interface Reservation { id: string; node: string; amounts: Partial<BudgetSpec>; wallDeadlineMs: number }
declare function reserve(node: BudgetNode, req: Partial<BudgetSpec>, phase: PhaseId): Result<Reservation>;   // synchronous: no await between check and add
declare function settle(r: Reservation, actual: Partial<BudgetSpec>): void;                                  // charges actual, releases the rest
```

*Algorithm (`reserve`).* 1. For each dimension `d` in the request and each ancestor `a` from the node up to the root: require `a.spent[d] + a.reserved[d] + req[d] <= a.limit[d] - (phase is final ? 0 : a.reserveFloor[d])`. 2. If any check fails return `E_BUDGET_EXCEEDED{dim, node, needed, available}` and change nothing. 3. Otherwise add `req` to `reserved` at every ancestor (all-or-nothing; the function is synchronous, so two concurrent branches cannot interleave between check and add). 4. Compute `wallDeadlineMs = min over ancestors(deadline) - finalizeReserveMs(if not final)` and the call timeout `min(spec.timeoutMs, wallDeadlineMs - now)`; a non-positive timeout refuses with `E_DEADLINE`.

*What is reserved per effect.* Model call: `modelCalls: 1`, `inputTokens: estimateIn(req)`, `outputTokens: req.params.maxOutputTokens + port.capabilities.reasoningCapTokens` (the reservation caps reasoning tokens explicitly; an adapter whose provider counts reasoning inside `max_tokens` declares `reasoningCapTokens: 0`, which is NOT VERIFIED for the NVIDIA endpoint, INT-058). Tool call: `toolCalls: 1`. Step activation: `turns: 1` (reserved when the supervisor activates a step; loops therefore consume turns). Retry: a retry is a new call and a new reservation; the backoff sleep is checked against the deadline before it starts (`now + backoff + timeout <= deadline`), otherwise the retry is refused with `E_DEADLINE` and the `onFail` chain continues. `settle` charges the provider-reported usage; unused amounts return to every ancestor.

*Estimator and the soundness statement.* `estimateIn` is a **sound upper bound** under one assumption: the tokenizer is byte-level (a token covers at least one byte), so tokens do not exceed UTF-8 bytes of the serialised messages plus a per-model template overhead. The bound is conservative by a large factor for English text, so two modes exist: `sound` (bytes plus overhead; default in `sim` and sponsor proof) and `calibrated` (bytes times a ratio set to the 99.9th percentile of tokens per byte observed in recorded usage, times 1.25). In either mode every settled call checks `actual <= reserved`; a violation raises `E_BUDGET_OVERSHOOT`, charges the actual amount, and marks `RunManifest.budgetUnsound = true`; CI fails if any recorded call violates the estimator (test `T3-EST`). The guarantee is therefore stated as: *total provider-reported usage never exceeds the budget, provided the estimator upper-bounds actual input usage and the provider enforces `max_tokens`* (a conditional guarantee with its own row in the spec's guarantee table; it covers neither spend on a provider that does not enforce `max_tokens`, nor cost in currency, nor wall-clock behaviour under a real network). Repeatability of sampling is a property of cassettes only, never of a live provider. Whether the NVIDIA endpoint enforces `max_tokens` strictly and whether reasoning tokens count against it are NOT VERIFIED (M14); fallback: a streaming call is aborted client-side when streamed output reaches the reserved cap.

*Wall clock.* A deadline, not a consumable: overlapping branches share it. `activeMs` excludes time paused at a human step (the run is exited then; resume extends the deadline by the recorded pause). All deadlines are propagated as remaining durations (R30).

*Hierarchy and slices.* `split(parent, weights, minEach)` carves child nodes by largest-remainder apportionment on each integer dimension (ties by index), so a fan-out branch cannot starve its siblings and slices are a pure function of the weights. At a join, each branch's unspent amounts return to the parent in branch order.

*Phases and the finalize reserve (F-BUDGET).* The root holds a `reserveFloor` that no non-final phase may touch. Defaults for the live profile (starting values taken from the organizer table in `docs/intel/02 §6`, **to be tuned from measured traces, not conclusions**): total 600 s; startup 30 s, data load 90 s, planning 45 s, retrieval and analysis 210 s, critique 120 s, final output 60 s, logging 30 s (sum 585 s, 15 s unallocated slack); finalize reserve = final output + logging = 90 s, never borrowable. A phase may exceed its slice by borrowing unspent amounts of earlier phases and the slack, never the reserve. The seven phases are `PhaseId`s declared in the graph; steps name their phase. Token, call and turn limits per phase are measured later (no organizer figure exists). The replay profile has no token spend; it keeps turn and wall caps whose values are set after measurement.

*Supervisor: forced finalization.* Before each activation and after each effect the supervisor evaluates `shouldFinalize(root)`: any non-reserve dimension exhausted, or `deadline - now <= finalizeReserveMs`. If true it routes to the declared `finalize` step with a decision (`kind: stop`, `why: { kind: "computed", ruleId: "budget.force_finalize", codes: ["BUDGET_<dim>"], text, factIds: [] }`). The graph compiler requires the `finalize` step to be reachable by an implicit budget edge from every step and to read only keys that are `degradable` (have a declared safe default or may be absent), so it can always run on partial state. What `finalize` outputs (a hold or escalation with a `budget_exhausted` gap) is M5/M13's rule; M7 guarantees only that it runs and that its inputs are well-typed. If the reserve itself is exhausted: `E_RESERVE_EXHAUSTED` (fatal), trace flushed, no release possible.

*Resume.* Spent amounts are rebuilt from the WAL (settled usage plus the reserved amount of every in-doubt effect); budgets and monotonic fields are never reset (contrast R7's re-initialising `run`, and R7's snapshot restore which preserves counters).

**7. Tests.** `T3` (component 17) is the acceptance gate. Unit and property: `BUD-ADV` an adversarial model returns the maximum output every time and fails with a transient error half the time: for each dimension in turn set to a tight limit, provider-side counters never exceed it and the run ends in `finalize`; `BUD-RACE` 64 concurrent branches reserving against one parent never oversubscribe (invariant checked after every event in the sim); `BUD-SPLIT` apportionment sums to the parent and is order independent; `BUD-RETRY` retries and fallbacks appear in the trace and in `spent`; `BUD-PAUSE` a 24 h pause does not burn wall clock; `BUD-EST` estimator never below actual over all recorded usage; `BUD-FLOOR` no non-final phase can spend into the reserve under random schedules; `BUD-RESUME` spent after a crash is at least spent before it.

**8. Risks / NOT VERIFIED.** Sound mode may starve useful calls (4x overestimate for English): measured, then `calibrated` is used with its overshoot detector; no figure is known yet. Provider `max_tokens` enforcement and token accounting for reasoning models: NOT VERIFIED. The phase slices are the organizer's targets, not measurements.

**9. Build notes.** Spec step 2. Gate: `T3`.

## 5. Components 8 to 14: state, graph, gates, durability, concurrency, humans, trace

### Component 8. Typed state, reducers, commits and the state hash

**3. References.** R1/R8 (channels: `LastValue`, `BinaryOperatorAggregate`, `Topic`, `NamedBarrierValue`; reducer purity and commutativity left to the author, 06 §4.2), R5 (`TypedDict` state, parallel workers return only their own key; debate state as concatenated strings, the defect), R6 (`results` and `structured_results`, `derived_keys` rolled back with a rejected output), R7 (flat dict state with no validation; immutable snapshots with stable ids; monotonic fields survive a restore), R4 (`RunState` with an explicit schema version and supported-versions table).

**4. What they do.** R1/R8 apply all writes of a superstep through per-key reducers after sorting by task path (`algo.ts` `applyWrites`, read): order-independent only if the author's reducer is commutative. R6 writes a step's output and its derived keys, then validates, and rolls back the derived keys on rejection (BUG-058/059 comments in `step.py`). R7's `StateMemory` rewrites a JSON file on every `get`, `update` and `set` and back-fills missing keys instead of validating (06 §1.2). R4 versions its snapshot format and has reached "1.20", evidence that formats owned by a library keep changing (06 §9.14).

**5. Decision.** Own. State is plain canonical JSON; every key has a JSON Schema, a **named** reducer from a closed set, an owner step set and a confidentiality label; commits are atomic over a whole patch (so derived keys never exist without their primary and no rollback is needed); the commit function is a pure kernel function that every substrate calls, because it carries guarantees G3, G4 and G6. Rejected: author-supplied reducer closures (not hashable, not checkpointable), per-key rewrite-on-read persistence (R7).

**6. Design.**

```ts
interface KeySpec<V extends Json> {
  schema: string;                       // $id in the registry; validated after every commit
  reducer: ReducerId;
  monotonic?: true;                     // survives rewind: counters, visit counts, spent budgets, trace seq
  degradable?: { default: V };          // may be absent when finalize runs
  conf: Confidentiality;                // join rule applies to patches (M8)
  requires?: "Approved";                // value must arrive as Approved<T> and is stored as ApprovedEnvelope
  maxBytes: number;                     // larger values are BlobRef { blob: RawHash, size } (content store)
}
type ReducerId = "last" | "append" | "appendByBranch" | "mergeDisjoint" | "setUnionSorted" | "max" | "sumInt" | `custom:${string}@${number}`;
```
Reducer semantics: `last` replaces; `append` concatenates (**not commutative**, so allowed only in sequential writes); `appendByBranch` concatenates branch contributions in branch-index order (the fan-in reducer); `mergeDisjoint` merges objects and errors `E_INVARIANT` on a key collision (commutative); `setUnionSorted` sorts by canonical bytes (commutative, idempotent); `max` and `sumInt` over integers. `custom` reducers are pure functions registered by id and version; their source digest enters `graphHash`.

*Commit (pure kernel function, `src/kernel/commit.ts`).* 1. Validate the step output against its output schema (component 3). 2. Reject any patch key not in `step.writes` with `E_UNDECLARED_WRITE` (policy). 3. For keys with `requires: "Approved"`, reject values that are not registered `Approved` (component 10). 4. For each key: `new = reducer(old, patchValue)`; validate `new` against the key schema; reject values over `maxBytes` that are not `BlobRef`. 5. Update the per-key digest `kd(k) = digestJson("plumbline.state.key.v1", {k, v})` and the state hash `stateHash = digestJson("plumbline.state.v1", {k: kd(k) for all keys})`; only changed keys are re-hashed, so cost is proportional to the patch. 6. Return `{state', stateHash', patchDigest}`; the caller writes the `commit` WAL record (component 11) and the trace event. All validation happens before any visible change, so a rejected patch has no effect and needs no rollback. Values are deep-frozen once at commit; a projection for a step (`view(state, step.reads)`) is a new object whose members are the frozen committed values, so no copying is needed and a step cannot mutate state.

*Rewind and fork.* `rewind(toSeq)` rebuilds state by replaying commits to `toSeq` and then re-applies the latest values of `monotonic` keys (R7's discipline with the budget hole closed); a rewind counter is itself monotonic and capped. `fork(seq, patch)` starts a new run with `parent = {run, seq}`; its WAL begins with a copy of the parent's commits up to `seq`.

*Versioning.* `state.schemaVersion` in `run.begin`; resume with a different `graphHash` is refused unless a registered migration `{from, to, id}` (pure, hashed) is supplied, recorded in the trace as a decision (R5's run-signature idea, R4's table).

**7. Tests.** `COM-UNDECL` an undeclared write fails and leaves state unchanged; `COM-ATOMIC` a patch whose derived key fails its schema is rejected as a whole; `COM-HASH` the incremental `stateHash` equals a full recomputation after 1e5 random patch sequences and is independent of key insertion order; `COM-FREEZE` mutating a projection throws; `COM-RED` each reducer's algebra (commutative where claimed, `append` flagged non-commutative and refused in fan-in) as property tests; `COM-MONO` rewind preserves monotonic keys and a rewind cannot refund a budget; `COM-BLOB` a value over `maxBytes` is refused unless a `BlobRef`; `COM-READS` in test mode a Proxy over the projection reports declared-but-unread keys, which are failures (reads sets stay tight, which M4's static-cone pruning relies on).

**8. Risks / NOT VERIFIED.** Incremental hashing cost and deep-freeze cost on realistic states are unmeasured. The closed reducer set may be too small for M3's truth table; adding a reducer is a reviewed change with its algebra test.

**9. Build notes.** Spec step 1 (after components 1 to 3). Unblocks 9, 11, 12.

### Component 9. Step contract, structured graph and compile-time validation

**3. References.** R6 (`critical`, `deterministic`, `derived_keys`, `validator`, `executor`), R5 (`DEBATE_PATH_MAP`: every router target listed, issue #1088; `wrap_up` turn without tools), R3 (`graph_validate`, `has_cycles_with_exit`), R1/R8 (conditional edges with path map, `Send`, `Command`), R2 (serialisable `FlowDefinition`, `max_method_calls`), R7 (`filter_valid_actions`: a pure state-derived action mask), 12 §5.1 (Magentic-One progress ledger as typed planner state, a stall rule).

**4. What they do.** R5 fixed a production crash by listing every possible target of a router (06 §2.2). R3 refuses at construction a cycle with no exit. R6 distinguishes steps whose failure aborts (`critical`) from those that degrade, and pure steps that should not be re-prompted. R2 can serialise its flow definition. Nobody combines these checks with a dominance analysis over gates and irreversible effects.

**5. Decision.** Own. The graph is **structured** (series-parallel with bounded loops), expressed as hashable data; a pack that needs more extends the compiler and its dominance analysis, and the restriction is stated in the spec (INT-057 d). Typed state and `commit` are a pure kernel function that every substrate calls (INT-057 b; component 8). Rejected: arbitrary DAGs and dynamic topology (a hashable graph is required for checkpoint identity and cassette binding, 06 §9.13), model-chosen routing (principle 1 of 06 §9.1), random-access `goto`.

**6. Design.**

```ts
interface StepDef {
  id: StepId; version: string; kind: "llm" | "tool" | "pure" | "human" | "gate" | "join"; phase: PhaseId;
  agent: AgentId;                                                   // the lane named in every trace line of this step (INT-054); registry in the graph, golden-hashed
  reads: string[]; writes: string[]; derives?: string[];            // derives ⊆ writes, committed atomically with them
  input: string; output: string;                                    // schema ids
  timeoutMs: number;                                                // required, finite
  critical: boolean; deterministic: boolean;                        // deterministic: no ports in ctx, no validation re-prompt
  retry: { transient: { max: number; backoff: "exp"; baseMs: number; capMs: number }; validation: { max: number } };
  onFail: "abort" | "degrade" | { fallback: StepId };
  effects: { model?: boolean; tools?: string[] };                   // declared ports; the ctx exposes only these
  ledger?: LeafType[];                                              // leaf types this step may append (component 15); undeclared => E_UNDECLARED_WRITE
}
type Edge =
  | { kind: "seq"; from: StepId; to: StepId }
  | { kind: "cond"; from: StepId; router: RouterId; targets: StepId[] }          // router returns Route<targets[number]>
  | { kind: "fanout"; from: StepId; branches: BranchSpec; join: StepId; policy: JoinPolicy; concurrency: number; maxBranches: number }
  | { kind: "loop"; from: StepId; to: StepId; maxVisits: number }              // back edge; `to` must dominate `from`
interface GraphDef { v: 1; entry: StepId; finalize: StepId; phases: PhaseDef[]; steps: StepDef[]; edges: Edge[]; keys: Record<string, KeySpec<Json>>; routers: RouterRef[]; budgets: BudgetProfile }
type Route<T extends StepId> = { next: T; why: Why };                  // a router must return a Why; type-level union of targets
```
`graphHash = digestJson("plumbline.graph.v1", GraphDef)` after normalising the order of arrays that are sets. Steps carry `version` strings; the build step `graph:seal` also computes `codeDigest` (SHA-256 over the bytes of the step modules and registered reducers/routers) so code drift is detected separately from topology drift (component 6).

*Compile-time validation (`compileGraph`, all failures are build errors with the offending ids):*
1. Single entry; every step reachable; `finalize` reachable from every step by the implicit budget edge (component 7). 2. **Structure**: fan-out regions properly nested with exactly one join; no jumps into or out of a region; every `loop` back edge targets a step that dominates its source and carries `maxVisits`. 3. **Routers are total**: each `cond` lists `targets`; the TypeScript type of a router is the union of its targets, and at run time a result outside `targets` is `E_INVARIANT` (R5's #1088 class). 4. **Write-set disjointness** across the branches of a fan-out, or a fan-in reducer that is order independent. 5. **Definite assignment**: every key read has a producer on all paths to the reader, or is `degradable`. 6. Every `human` step has `expiresAfterMs` and a deny route (component 13). 7. **Gate dominance**: for every step that can call a tool with `effectClass: "irreversible"` (or `requires: "Approved"`), every path from `entry` to it passes through a `gate` step whose approved type matches the tool's argument type (dominator computation, iterative dataflow over the structured graph); a gate has a veto route that leads to a step that cannot itself reach the irreversible step without passing the gate again. 8. `deterministic` steps declare no ports (their `ctx` type has none). 9. Every `timeoutMs` finite; every phase named; every schema id registered; every reducer registered. 10. Node count and region depth caps (verifier-DoS and review limits). 11. `finalize` reads only `degradable` keys.

*Step runner (kernel-owned, substrate-independent).* The substrate decides which step is next and persists; **the kernel runs the step**:

```ts
async function runStep(k: Kernel, act: { step: StepDef; branch: string; instance: number; view: Readonly<State> }): Promise<StepOutcome> {
  const t = k.budget.reserve({ turns: 1 }, act.step.phase); if (!t.ok) return budgetStop(t.error);
  const ctx = k.makeCtx(act);                                       // ports limited to act.step.effects; AbortSignal from the budget deadline
  for (let attempt = 1; ; attempt++) {
    const r = await withTimeout(act.step.run(ctx, input(act.view), { attempt, feedback }), act.step.timeoutMs);
    // errors are classified (component 1); transient effect retries happened inside ctx (each attempt a slot)
    if (r.ok) {
      const findings = validateOutput(act.step, r.value, act.view);       // schema + step.validate; 'blocked' severity => E_FINDING_BLOCKED
      if (!blocked(findings)) return { patch: r.value.patch, route: r.value.route, findings, degraded: r.value.degraded };
      error = validationError(findings);
    } else error = r.error;
    if (error.class === "validation" && !act.step.deterministic && attempt <= act.step.retry.validation.max) { feedback = findingsToFeedback(error); continue; }
    return failure(act.step, error);                                      // onFail: abort | degrade | fallback, critical => abort; fatal always aborts
  }
}
```
`degrade` yields an output of the step's declared degraded form plus a `degraded` entry; there is never a fabricated default (the default is a visible step). Every transition emits a trace decision with a `Why`.

**7. Tests.** `GRF-*` one failing fixture per compile rule 1 to 11 (unreachable step, unbounded loop, unmapped router target, overlapping branch writes, undefined read, human step without expiry, irreversible tool reachable around a gate, gate with no veto route, port in a deterministic step, infinite timeout, finalize reading a non-degradable key); `GRF-HASH` reordering a set-like array leaves `graphHash` unchanged, changing any step version changes it; `GRF-ROUTER` a router returning an undeclared target is `E_INVARIANT` at run time and a compile error when typed; `GRF-DOM` dominance checked against a brute-force path enumeration on random structured graphs (property test).

**8. Risks / NOT VERIFIED.** Structured control flow may be too restrictive for a future pack (a pack that needs an unstructured join would extend the compiler; none is known). The dominance analysis assumes the graph shown to the compiler is the executed graph: the substrate adapter must not add edges (checked by comparing the adapter's compiled topology back to `GraphDef`, test `GRF-ADAPT`).

**9. Build notes.** Spec step 4. Unblocks 10, 12, 13, 17.

### Component 10. Gates: `Proposal` to `Approved`, verdicts and the output contract

**3. References.** R6 (`artifact/contract.py` `enforce_artifact_contract`: pure clauses C1 to C7, a hard violation **withholds the value and keeps the verdict**, never raises), R4 (tripwire guardrails; input guardrails run in parallel with the model by default, a gate that must block cannot be parallel), R3 (message interceptors with `DropMessage`), R5 (no veto in code: the "risk manager" is a prompt, 06 §2.5), R2 (callable guardrails returning `(ok, result_or_error)`), 12 §5.3 (OpenAI guardrails cover only the first and last agent; gates must sit on every edge).

**4. What they do.** Only R6 gates final output in code, and only R7 masks actions in code; nobody enforces both (06 §0 finding 1). R4's guardrail may fire after the model call it was meant to prevent. R5's absence of a veto is the negative example the spec was written against.

**5. Decision.** Adapt R6's withhold semantics and 06 §9.11's `Proposal`/`Approved` design; own the registry-backed unforgeability and the dominance rule of component 9. Rejected: brand-only (type-level) enforcement, because TypeScript brands are erased and forgeable with `as` (spec section 5 says the same for labels).

**6. Design.**

```ts
interface Gate<S, T> { id: GateId; version: string; veto: StepId; apply(state: Readonly<S>, p: Proposal<T>, kit: GateKit): Verdict<T> }   // synchronous and pure
type Verdict<T> =
  | { kind: "allow"; why: Why } | { kind: "constrain"; patch: Partial<T>; why: Why }
  | { kind: "withhold"; fields: (keyof T)[]; why: Why } | { kind: "veto"; route: StepId; why: Why };
// Approved<T> is constructed only inside gates.ts. Its class has an #private field; instances are frozen and held in a module-private WeakMap
//   sealed: WeakMap<object, { gate; verdictSeq; valueDigest; runId }>.
declare function isApproved<T>(x: unknown): x is Approved<T>;     // sealed.has(x) && digestJson(x.value) === recorded valueDigest
```
*Apply.* `GateRunner.apply` calls `gate.apply` inside try/catch; a throw resolves to a `veto` to `gate.veto` with `Why{kind:"rule", ruleId: gate.id+".error", codes:["GATE_THREW"]}` (`onGateError: "closed"`). It increments the run-global `verdictSeq`, appends a `gate.verdict` WAL record **synced** (`{gate, version, verdictSeq, kind, proposalDigest, valueDigest, why}`), then constructs `Approved<T>` and registers it. Structured clone, JSON round-trip, spread or hand-built `{kind:"approved",...}` objects are not in the WeakMap and are rejected. Models may supply **facts** to a gate through state; thresholds, comparisons and the veto itself are code.

*Where `Approved` is demanded.* (a) `ToolSpec.requires: "Approved"` and every `irreversible` tool: `perform` rejects any argument that is not `isApproved` with `E_UNAPPROVED_EFFECT` before reservation; the request hash is computed over `.value`. (b) State keys with `requires: "Approved"` (component 8) store an `ApprovedEnvelope { value, gate, verdictSeq }`, so M9's verifier invariant V8 ("no release leaf without an approval leaf bound to the same case digest") has a field to check. (c) The compile rule 7 of component 9 (dominance).

*Resume.* A crash loses the in-memory registry. A step needing an `Approved` after resume obtains it with `approvedFromState(key)`, which re-creates the object only if a `gate.verdict` WAL record exists with equal `(gate, verdictSeq, valueDigest)` and `kind` in `{allow, constrain, withhold}`; there is no other constructor.

*Output contract (persist boundary).* `runContract(artifact, clauses)` evaluates pure clauses `(artifact) => Finding[]` with severities `info | review | blocked_field`; a hard violation withholds the named slots (and every slot the value could hide in, R6's `_scrub_headline_slots` idea), keeps the verdict, appends a `[CONTRACT/<id>]` warning and records a `withhold` decision; the function never throws (a clause that throws counts as a violation of that clause). Clauses are the packs' (M5/M13); M7 owns the machinery. A degraded run's artifact type requires `degraded[]`.

*Counterfactual gate test.* Because gates are pure and `gate.verdict` records the proposal digest, a recorded risky proposal can be re-evaluated by deterministic-stage replay (component 19) under a changed gate version with zero model spend; the report ends at the first effectful step reached.

**7. Tests.** `T5` (component 17) is the gate: (a) type-level: `// @ts-expect-error` for `Proposal` where `Approved` is required, for an irreversible `invoke` without `Approved`; (b) runtime forgery: literal object, `structuredClone(approved)`, `JSON.parse(JSON.stringify(approved))`, `Object.assign({}, approved)`, an `Approved` from another run or with a mutated value (digest mismatch), a stale `verdictSeq` all fail with `E_UNAPPROVED_EFFECT` and no effect begins; (c) counterfactual replay vetoes a recorded risky proposal with all-cassette hits; (d) a throwing gate resolves closed; (e) the inert controls required by spec section 19: a gate that always allows and a `isApproved` that always returns true must each make `T5` fail; (f) crash after `gate.verdict` and before the effect: the effect proceeds on resume only through `approvedFromState`. `GATE-CONTRACT` a contract clause that throws still withholds and does not raise.

**8. Risks / NOT VERIFIED.** The WeakMap registry is process-local and in the same address space as all code: a hostile module could call the constructor if it could import it; module privacy plus the AST test of M8 (no import of `gates.ts` internals outside the gate runner) is the control, and spec section 5 already names this as convention, not isolation.

**9. Build notes.** Spec step 6. Unblocks 13, M8's restrict-only gate, M13's broker.

### Component 11. Write-ahead log, checkpoint and resume

**3. References.** R24 (etcd WAL: chained CRC, torn tail repair), R25 (libuv Windows `fsync` and `rename`), R26 (crash-consistency pitfalls), R8 (`putWrites`, `durability` modes, `BaseCheckpointSaver`), R1 (pending writes, task ids), R2 (checkpoint on configured events, fork), R4 (`RunState.to_json` with schema version), R5 (checkpoint thread id includes a config digest), R7 (snapshot restore preserving monotonic counters), R32 (Temporal's event history as the single source), 13 §4.2 (the ledger's write-ahead leaf index).

**4. What they do.** R24 frames each WAL record with a length and a CRC chained from the previous record; on `ErrUnexpectedEOF` in the **last** file, `Repair` copies the file to `<name>.broken`, truncates it to the last valid offset and fsyncs (`repair.go`, read). R8 offers three durabilities and defaults to `"async"`: the next superstep starts while the previous checkpoint is still being written, so a crash can lose it (types.ts docs, read); `"sync"` waits for all persistence of a superstep before preparing the next (loop.ts, read). R25 shows Node's `fs.fsync` on Windows is `FlushFileBuffers` and `fs.rename` is `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING`; libuv does not promise that rename is atomic. R26 shows that application-level update protocols are routinely wrong about what a file system guarantees.

**5. Decision.** Own, adapting R24. One append-only WAL per run holds effects, commits, gate verdicts, interrupts, ledger intents and run lifecycle; it is the **single source of truth** for resume. Snapshots are caches. Durability is synchronous by default. No rename-over of live files (R25, R26): snapshots are write-once numbered files and the WAL only appends. Rejected: `durability: "async"` as a default, database checkpoint backends (single machine, no setup; the store is a port, 06 §9.13).

**6. Design.**

*Frame.* One record per line: `<canonical JSON>\t<chain>\n` where `chain = hex32(sha256("plumbline.wal.chain.v1" 0x00 prevChain || jsonBytes))` and the genesis chain is `hex32(sha256(runId))`; the chain is an internal framing value, not one of the three digest kinds. A tab cannot occur raw inside canonical JSON. A `batch` record `{t:"batch", r:[...]}` makes several records one atomic frame (M13's nonce-consumption plus intent).

*Record types.* `run.begin{runId, tenant, graphHash, schemaManifestHash, runtimeVersion, codeDigest, seed, mode, profile, modelProfile, disclosureProfile, toolSurfaceHash, budgetProfileHash}`; `step.begin{step, branch, instance}`; `effect.begin{slot, reqHash, reservation, idem?}`; `effect.end{record}`; `commit{seq, step, branch, instance, patchDigest, patch|blob, stateHash, spent}`; `gate.verdict{…}`; `interrupt.open|answer|expire|invalid{…}`; `branch.done{branch, patchDigest, patch|blob}`; `ledger.pending{key, leafSpec}`, `ledger.appended{key, receipt}` (durable) and `ledger.published{key, checkpoint}` (covered by a signed checkpoint; component 15); `checkpoint{seq, stateHash}` (pointer to an optional `snap-<seq>.json`); `run.end{status, finalStateHash}`; `run.takeover{epoch}`.

*Sync policy.* Synced (`FileHandle.sync`) before proceeding: `run.begin`, `effect.begin` for every port except clock (**before** the port call, so reservations survive a crash), `effect.end`, `commit`, `gate.verdict`, all `interrupt.*`, `ledger.*`, `run.end`. Trace files are flushed per event but not synced; the trace is a view and is reconciled on resume (`resume` event declares `lostTail`).

*Open and repair (every open).* Read frames; verify the chain. A malformed or short **last** frame is a torn write: copy the file to `wal.jsonl.torn-<k>`, truncate to the last valid offset, sync, continue (R24). Any invalid frame that is **not** last is `E_WAL_CORRUPT` (fatal). Write failures (`ENOSPC`, `EIO`) are `E_WAL_WRITE` (fatal): no effect may start after a failed WAL append (invariant `W1` checked in the sim).

*Resume algorithm.* 1. Take the run lock (`store.lock(tenant, …)`, one process per run; a second opener gets `E_RUN_LOCKED`; takeover of a dead owner's lock writes `run.takeover{epoch+1}`; liveness detection on Windows is NOT VERIFIED). 2. Open and repair the WAL; refuse if `graphHash`, `schemaManifestHash`, `runtimeVersion` or `toolSurfaceHash` differ from `run.begin` (unless a registered migration is supplied). 3. Load the newest valid snapshot not newer than the last commit, then apply later `commit` patches; assert the resulting `stateHash` equals the WAL's. A mismatch is `E_WAL_CORRUPT`. 4. Rebuild budgets: settled usage of every `effect.end`, plus the reserved amount of every in-doubt `effect.begin`, plus `turns` from `step.begin` count; **never reset**. 5. Rebuild the effect index (slot to record), interrupt table, `verdictSeq`, visit counts (`instance` per step per branch), ledger pending set (appended but unpublished included). 6. Determine the frontier: the successor (by graph) of the last committed step per branch; a `step.begin` without `commit` means that step runs again (at-least-once for pure compute; effects are deduplicated by slot, component 5). 7. Resolve in-doubt effects (component 5), pending ledger appends (component 15) and expired interrupts (component 13) before continuing. 8. Continue live. Resume is therefore "replay of the run's own recorded prefix, then live", using the same lookup code as cassette replay, which is why replay and resume cannot drift apart.

*Fork and rewind* as in component 8. *Retention:* WAL files are kept with the run; erasure is M9's receipt design. *Disk:* `doctor` checks free space against a configured floor (the development drive has repeatedly filled, OPS-01) and a WAL write failure is fail closed.

**7. Tests.** `T2` (component 17) is the gate (every WAL prefix and every torn variant). Unit: `WAL-TORN` truncate the last frame at every byte offset: repaired, run resumes; `WAL-CHAIN` flip one byte in a middle frame: `E_WAL_CORRUPT`; `WAL-BATCH` a batch is all or nothing under torn writes; `WAL-SNAP` a snapshot with a wrong hash is ignored and the WAL path is used; `WAL-ENOSPC` simulated full disk: run ends `failed`, no later effect begins; `WAL-LOCK` two openers; `WAL-FSYNC` in the sim disk, an append that was not synced may be lost or torn on crash and a synced one may not (the sim encodes exactly this, R26); `WAL-WIN` the same suite on the Windows development machine with real files (fsync semantics beyond libuv's source are NOT VERIFIED).

**8. Risks / NOT VERIFIED.** NTFS durability and rename atomicity are not claimed; directory fsync does not exist on Windows from Node (NOT VERIFIED), so a newly created file may be missing after a power loss; the WAL being the truth and snapshots a cache is the mitigation. Process-kill tests (SIGKILL / `taskkill`) cover process death, not power loss; the sim covers a model of power loss, not a real one. Throughput of a sync per effect is unmeasured (model latency dominates by orders of magnitude, hypothesis).

**9. Build notes.** The spec numbers this step 5, but the write-ahead effect log belongs to the effect layer (INT-057 a) and bake-off 1 judges candidates with that layer on top, so the WAL (without fork/rewind) is built in step 3 with the effect layer, the cassette and the harness; checkpoint, fork and rewind follow in step 5. Unblocks 12, 13, 15, 17.

### Component 12. Fan-out and fan-in with deterministic merge

**3. References.** R5 (parallel analysts: each compiled subgraph owns a private history and returns only its own key; the list-form edge is the join), R1/R8 (`applyWrites` sorted by task path; `Send` for dynamic fan-out; `NamedBarrierValue`), R2 (`_execute_racing_listeners`: first finisher wins, others cancelled, latency decides the branch), R3 (`GraphFlow` activation groups; merge order for parallel branches NOT VERIFIED in 06), R6 (`deps.run_semaphore`), 12 §3 (decomposable tasks are the regime where parallelism pays).

**4. What they do.** R1/R8 make merged state independent of completion order by sorting writes by task path, provided reducers commute. R2 deliberately makes the winner a function of latency. R5 avoids conflicts by giving each worker a disjoint key.

**5. Decision.** Adapt R1/R8's rule and make it structural: branch results merge in **branch-index order** through the kernel `Committer`; there is no race join; disjoint write sets are a compile error otherwise (component 9 rule 4).

**6. Design.**

```ts
interface BranchSpec { from: "list"; listKey: string; keyOf: "index" | { field: string } } | { from: "static"; steps: StepId[][] }
type JoinPolicy = "all" | "allSettled" | { quorum: number };
```
*Execution.* A fan-out step computes the branch list in a pure step (stored in state, capped by `maxBranches`); branch `i` has path `<fanId>.<i>` and runs its sub-structure with: an immutable snapshot of its read set, a private scratch patch, a child `BudgetNode` from `split(parent, weights)`, a child `AbortController`, an rng stream `fork(branchPath)`, and its own `instance` counters. Concurrency is bounded by a FIFO semaphore (`concurrency`); real parallelism only changes timing, never results. When a branch finishes it appends `branch.done{branch, patchDigest, patch}` to the WAL (synced): the branch patch is the unit of durability.

*Join.* After every branch has settled or timed out: `all` applies each branch's `onFail` (a `critical` failure aborts siblings through the shared controller) and then merges; `allSettled` passes `Settled<O> = {ok:true,value} | {ok:false,error}` for every branch, in index order, to the join step as data; `{quorum: k}` selects the **first k successes by branch index** after all have settled or hit their wall slice (the set is deterministic because the slice is a deterministic budget and replay uses virtual time); a deadline-based "take what finished" policy would be an explicit recorded effect and is not offered. The merge applies branch patches in ascending branch index through the reducers (`appendByBranch`, `mergeDisjoint`, `setUnionSorted`); unspent branch budgets return to the parent in index order.

*Trace and ledger.* Branch events carry `(branch, lseq)`; the file stores arrival order and `normalise` sorts by `(branch, lseq)` (component 14). Ledger appends requested inside branches are `deferred` and flushed at the join in branch order (component 15).

*Resume.* Branches with `branch.done` are skipped; others restart from the branch's last committed step; slots are branch-scoped so effects dedup.

**7. Tests.** `T4` (component 17) is the gate (1,000 randomised completion orders; branch counts 0, 1, 7 and the cap; `allSettled` with failures; `quorum` with ties). Unit: `FAN-BUDGET` a branch exhausting its slice does not reduce a sibling's; `FAN-ABORT` a critical failure aborts siblings and the trace shows `aborted_by` ids; `FAN-WRITE` runtime check for dynamic lists (compile-time check applies to static fan-out only) rejects overlapping branch writes; `FAN-NOJOIN` there is no API to join on first completion (API absence test); `FAN-RESUME` crash with two of five branches done.

**8. Risks / NOT VERIFIED.** Real parallelism over a single hosted model endpoint is limited by rate limits (adapter-level limiter, not this component). Large branch counts with per-branch budget slices can produce slices too small to run; `minEach` makes that an explicit compile-time or start-time error.

**9. Build notes.** Spec step 7.

### Component 13. Human steps as step-boundary interrupts that fail closed

**3. References.** R1/R8 `interrupt` (`interrupt.ts`, read: resume values matched by an in-node counter, so the node runs again from its start; `GraphInterrupt` when no value; a resume value is validated only if `responseSchema` is a Zod schema), R2 `@human_feedback` (`_collapse_to_outcome`: an LLM turns free text into a route; `Flow.from_pending` persists pending feedback), R4 (tool approvals as serialisable interruptions on `RunState`), 12 §5.1 (Magentic-UI action guards and co-planning as precedent), R3 (`HandoffTermination`).

**4. What they do.** R1/R8 deliver a resume value by running the node again, so any effect before the `interrupt()` call repeats unless the author made it idempotent; R2 routes on a model's reading of a human's words; R4 stops at a step boundary and lets the caller approve or reject on the persisted state, which is the property we want.

**5. Decision.** Adapt R4's shape. A `human` step cannot perform effects; the interrupt is its entire output; the response is a typed, schema-validated value recorded as an effect; routing on a response is by a code router over typed fields; expiry resolves to deny.

*Scope (INT-030).* Human steps here are for **in-run questions only**: an `input_required` from a source, an A2A `INPUT_REQUIRED`, a reviewer prompt that the run cannot proceed without, within a run that lasts minutes. Approval waiting for a case action (hours, three clocks, multiple approvers, WebAuthn) is a state of the M13 case aggregate, not an M7 interrupt: a decision run ends at `decision.final`, the case waits in `APPROVAL_PENDING`, and a fresh run starts after `world_changed`. The two are not nested, and no M7 interrupt carries a money-moving approval. The `approval` kind below remains for in-run confirmations of that narrower kind; the human-approval sentence of the spec (§4) and the three approval clocks belong to M13 and M5.

**6. Design.**

```ts
interface Interrupt { id: Id<"int">; step: StepId; kind: "approval" | "input" | "review"; reason: Why; payloadRef: DocHash /* typed card, rendered by M10 from fields */;
  responseSchema: string; expiresAt: Iso; onExpiry: "deny" | "escalate"; approvers: ApproverSpec; conf: Confidentiality }
// id = ids.next(...) derived from (runId, slot): stable across resume.
```
*Lifecycle.* `open` (WAL `interrupt.open`, synced; `HumanPort.notify` is best effort and is re-sent on resume) then exactly one of `answer`, `expire`, `cancel`. The run writes status `awaiting_human` and **exits cleanly**; nothing is held open (06 §9.11). `runtime.respond(runId, interruptId, response, by)`:
1. interrupt exists and is open, else `E_INTERRUPT_CLOSED`; 2. not past `expiresAt` by the clock port, else it is processed as an expiry (the late response is recorded as `interrupt.invalid{reason:"late"}` and not applied); 3. `approvals.check(interrupt, by)`: the responder is authenticated and authorised for this interrupt (identity-provider subject, role, segregation-of-duties; implemented by M13 and M8, M7 only calls the interface and records the result); 4. `parseStrict` then schema validation against `responseSchema`: invalid means **nothing is committed**, the interrupt stays open, `interrupt.invalid` is recorded (R1/R8's property, now for every schema); 5. idempotence: the same responder and same response digest again returns the earlier result; a different response after the first is `E_APPROVAL_CONFLICT` (first answer wins because it is already in the WAL); 6. write `interrupt.answer` (synced) as effect slot `human.response`, so replay supplies it, then continue.

*Expiry.* `runtime.tick(now)` (called by the CLI, the console server and every resume) expires due interrupts: `onExpiry: "deny"` records a synthetic answer `{decision: "deny", by: system/expiry}` through the same path; approvals may only declare `deny` (the spec's default on timeout), reviews may declare `escalate`. A response whose responder fails step 3 never counts. *Fail-closed list:* unknown or closed interrupt, expired, unauthorised, invalid, conflicting: none of these approves anything.

*Step boundary guarantee.* The kernel runs the `human` step only to obtain its `Interrupt`; the continuation step reads the answer from state key `answers[interruptId]` through a code router. No step with effects ever re-executes in order to deliver an answer, so the R1/R8 hazard cannot occur. A substrate that needs the node body re-run to deliver a value (R8) is adapted by making the human node's body contain nothing but the interrupt call (component 17 notes).

**7. Tests.** Approval drills: approve, deny, expire (virtual clock), invalid response (stays open, retried), duplicate response (idempotent), conflicting response (conflict), late response, unauthorised responder, response after process restart, response to a closed interrupt, response whose schema allows extra fields (rejected by PSP), crash between `interrupt.answer` and the continuation commit (resume applies once). `HUM-NOFX` a `human` step's ctx exposes no ports (type test and runtime test). `HUM-ROUTE` no model participates in routing a response (AST test: routers of human continuations take typed fields only).

**8. Risks / NOT VERIFIED.** Responder authentication is an M8/M13 concern; the boundary is a typed `ApproverAuth` interface and a recorded check result, nothing here proves identity. Long-lived interrupts across a `graphHash` change need a migration or the run is refused (by design).

**9. Build notes.** Spec step 7.

### Component 14. Trace: JSONL schema, `why_kind`, linter, normalisation and OpenTelemetry projection

**3. References.** R3 (OpenTelemetry GenAI naming; vendor-neutral by default), R2 and R4 (default external export, the lock-in to avoid), R6 (`audit/transcript.py`: append-only JSONL, mode 0600, credential scrubbing, event kinds), R1 (stream modes), R34 (OTel GenAI conventions at Development status, OTLP file exporter as JSON lines, `IdGenerator`, privacy: content attributes opt-in; viewers Phoenix, OpenInference with `DECISION` and `GUARDRAIL` span kinds, Langfuse masking), R32 (replay corpus), 06 §9.8 (the earlier schema), AUD-09 (the review finding on `why`).

**4. What they do.** No clone requires a per-decision rationale (06 §0 finding 4). R6's transcript scrubs credentials before writing. R3 emits spans through whatever tracer provider the application supplies. The OTel conventions mark prompt and tool-argument content as opt-in and possibly sensitive, and are still evolving.

**5. Decision.** Own the JSONL trace as the source of truth (spec section 4: "a JSONL trace in which every decision carries `why`"); project it to OTLP JSON lines with our own code (no SDK in the core); default **hash-only**; no exporter on by default (G8). The trace is a view of the WAL and the ledger; an audit trace cannot be sampled (13 §4.3 critique).

**6. Design.**

```jsonc
{ "v": 2, "run": "run_…", "tenant": "tn_default", "seq": 17, "prevLineHash": "sha256:…", "branch": "", "lseq": 17, "at": "2026-10-13T09:00:00Z",
  "mode": "live|record|replay", "profile": "sponsor|evaluation|baseline|scripted|judge-replay", "modelProfile": "sponsor|evaluation|local",
  "disclosureProfile": "public_lookup|identifier_only|offline", "rule_brain": false, "semconv_version": "…",
  "type": "run.start|step.start|step.end|effect|decision|gate|commit|budget|interrupt|resume|fanout|branch|join|checkpoint|error|run.end",
  "phase": 5, "agent": "critic", "verb": "critique",
  "step": "critic", "instance": 1, "attempt": 1,
  "decision": { "kind": "route|retry|fallback|veto|constrain|withhold|stop|degrade|select|approve|deny|skip|replan|interrupt|resume",
                "decider": "code|model|human", "rule": "gate.size_cap", "inputs": { "confidencePpm": 620000, "floorPpm": 700000 },
                "chosen": "revise", "alternatives": ["finalize"],
                "why": { "kind": "rule|computed|model_reported", "ruleId": "…", "codes": ["CONF_BELOW_FLOOR"], "text": "…", "factIds": [] },
                "note": { "kind": "human_reported", "codes": [], "text": "…", "factIds": [] } },
  "effect": { "slot": "jcs:…", "port": "model", "op": "complete", "reqHash": "jcs:…", "respHash": "jcs:…",
              "servedFrom": "live|cassette|wal", "model": "…", "usage": { "in": 0, "out": 0 }, "ms": 812, "outcome": "ok", "leaf": null },
  "state": { "hashBefore": "jcs:…", "hashAfter": "jcs:…", "patchKeys": ["plan"] },
  "budget": { "reserved": {}, "settled": {}, "remaining": {} },
  "error": { "class": "transient", "code": "E_MODEL_TIMEOUT" } }
```
Content (prompts, responses, tool arguments) never appears; digests point into the content store. Numbers are integers of a named scale or decimal strings (the trace is JCS-canonicalisable, so it can be hashed and bundled). `v: 2` supersedes 06 §9.8's schema. **This is the one trace schema (INT-054), fixed at step 1 with every field below decided now**, because adding a field at step 14 would break every golden trace, the bundle and the console: M9 needs `prevLineHash`, `why_kind`, `tenant`; M10 needs `phase`, `agent`, closed `verb` and a budget snapshot; M14 needs `decider` and its event types. Field rules:
- `prevLineHash`: `RawHash` of the previous line's canonical bytes (no trailing newline); the first line chains from the `RawHash` of the UTF-8 `run` id. It is a tamper-evidence chain over the file as stored, so it depends on arrival order and is removed by normalisation; the chain is verified on the raw file and `traceDigest` on the normalised lines.
- `tenant` equals the run's tenant on every line (`tn_default` on the judge path); `phase` is the 1-based index of the step's phase in `GraphDef.phases` (1 to 7 in the default profile, the organizer's seven); `agent` is `StepDef.agent`; `verb` is a member of the closed registry `schemas/trace-verbs.json` (golden-hashed), whose initial members are taken from M10 F10 and M14 C20's event table, not invented here; `budget` is the integer snapshot after the event.
- `modelProfile` and `disclosureProfile` are the two renamed profile axes (INT-020); `semconv_version` is set when the OpenTelemetry projection is generated and recorded for the golden file; the projection is best effort and the JSONL is the source of truth.
- "Normalised trace" is defined below and is what the spec means by "same normalised trace".

*`Why` rules (`why_kind`, INT-002).* `Why.kind` has four values: `rule`, `computed`, `model_reported`, `human_reported`. `decider: code` requires `why.kind ∈ {rule, computed}`; a `rule` line has a `ruleId` in the rule registry and a `computed` line a registered function id (the registry holds both, namespaced `rule.` and `fn.`); `codes` non-empty; `text` produced from the rule's message template filled from `inputs` (true by construction). `decider: model` requires `why.kind = model_reported`, text bounded to 600 characters, flagged as a claim, and the `kind` restricted to `select`, `skip` or advice; a model can never be the decider of `route, retry, fallback, veto, stop, degrade, replan, interrupt` (principle 1 of 06 §9.1). `decider: human`: a structured decision (approve, deny, with a code from a closed list) is a `rule` reason with `ruleId = "human.approval.<code>"` and `inputs.approvalRecord` bound to the signed approval record; an in-run answer to an `input` or `review` interrupt uses `human.<interruptKind>.<code>` the same way. Free text from a person is a `Why` of kind `human_reported`, stored only under `decision.note`, labelled untrusted by its kind, rendered by M10 as "Approver's note, not an explanation", and never counted by `explanationCoverage`. A `model_reported` or `human_reported` text is never shown as an explanation (AUD-09).

*Helpers are the only emitters.* `ctx.emit.decision(...)` cannot be called without a `Why`; the kernel emits `step.*`, `effect`, `commit`, `budget`, `checkpoint` itself. The sink writes JSONL, appends per event, assigns `seq` at arrival and keeps `lseq` per branch, computes `prevLineHash`, applies the structured allowlist and credential scrub, and offers an async-iterator `subscribe()` for the console's live view (M10). Permissions 0600 where the platform supports it (Windows ACL behaviour NOT VERIFIED).

*Normalisation (defines "same normalised trace").* Remove `mode`, `effect.servedFrom`, `effect.ms`, `at` when comparing a replay with a record of a different wall time (in the same virtual clock they are equal and need not be removed); sort events by `(branch path with numeric segments, lseq)`; drop global `seq`, `prevLineHash` and any ledger `leaf.index` (global to the ledger, INT-053), keeping `leaf.stream` and `leaf.seq`; keep everything else including every digest. `traceDigest = rawHash(bytes of the normalised canonical lines joined by LF)` (a `RawHash`, reproducible with `sha256sum`) goes into `RunManifest`.

*Trace linter (`trace-lint`, run by `T7`, by the sim after every run, and by CI over `output_examples/traces/`).*

| Id | Rule |
|---|---|
| TL01 | every `decision`, `gate`, `error` and `interrupt` event has a `why` (decisions) or `error` object; `text` non-empty, bounded |
| TL02 | `why.kind` matches the decider matrix above; a `rule` line has a `ruleId` in the rule registry and a `computed` line a registered function id; `codes` non-empty for code deciders; `human_reported` appears only as `decision.note` |
| TL03 | no control decision (`route, retry, fallback, veto, stop, degrade, replan, interrupt`) has `decider: model` |
| TL04 | `seq` strictly increasing and gapless except across a `resume` event that declares `lostTail`; `lseq` gapless per branch |
| TL05 | `step.start`/`step.end` paired per `(branch, step, instance)`; nothing after `run.end` |
| TL06 | every change of `state.hash` between consecutive events of a branch has a `commit` event between them |
| TL07 | every `effect` event has a WAL `effect.end` with the same `slot` and `respHash` (cross-check against the WAL) |
| TL08 | every `retry` decision has a following `effect` with `attempt` incremented; budget `settled` never exceeds `reserved` unless an `E_BUDGET_OVERSHOOT` error follows |
| TL09 | every `route` target is in the router's declared targets; every `fallback` names a declared fallback |
| TL10 | `commit.hashBefore` equals the previous `commit.hashAfter` on the same branch |
| TL11 | no event field contains a string longer than 256 characters outside `why.text` and `note.text`, and none looks like a credential (patterns from `scripts/secret_scan.py` run in `--stdin` mode) |
| TL12 | `rule_brain: true` events never occur in a run whose profile is `sponsor` (spec section 15) |
| TL13 | a `model_reported` or `human_reported` text is not copied into any field named `explanation` or `reason_code` |
| TL14 | `replay` mode runs have no `servedFrom: live` effect |
| TL15 | with a ledger attached, every ledger-relevant effect has `leaf` set after `ledger.appended` (see spec feedback on 13 §5) |
| TL16 | every irreversible effect is preceded in the same branch by a `gate` event with a matching `verdictSeq` |
| TL17 | `prevLineHash` of every line equals the `RawHash` of the previous line (genesis: the run id); `tenant` is present and constant; `phase` is within `GraphDef.phases`; `agent` and `verb` are registered |
| TL18 | for an effect guarded by `appendBefore` (component 15) the WAL has `ledger.published` for the guarding leaf before `effect.begin` for that slot (cross-check against the WAL, as TL07) |

*OpenTelemetry projection (`src/runtime/otlp.ts`).* Pinned `semconv_version` (conventions at Development status, 13 §4.3); written by our code as OTLP JSON lines (the file exporter spec; exact OTLP/JSON field names are taken from that spec at build, NOT VERIFIED here). Ids: `traceId` = first 16 bytes and `spanId` = first 8 bytes of the hex body of `digestJson("plumbline.id.v1", {seed, path})`. Mapping: run = `invoke_workflow` with `gen_ai.workflow.name = plumbline.release_decision`; each LLM-kind step = `invoke_agent`; planner steps = `plan`; a model effect = child `chat` span with `gen_ai.provider.name`, `gen_ai.request.model`, usage, `gen_ai.response.id`; a tool effect = `execute_tool` with `gen_ai.tool.name = source.<channel>`; precedent lookup = `search_memory`; memory write = `create_memory`; evidence lookup = `retrieval`; decisions, gates and commits = span events (`plumbline.decision` etc.); attributes `plumbline.why`, `plumbline.effect_key`, `plumbline.state_hash_before/after`, `plumbline.rule_ids`, `plumbline.fetch_state`, `plumbline.ledger_leaf`, `plumbline.cassette_occurrence`, `plumbline.rule_brain`, `plumbline.semconv_version`. Content attributes are never set (hash-only; `plumbline.input_digest`/`output_digest` instead). Optional viewers (Phoenix, Langfuse) are never dependencies; mirroring OpenInference's `DECISION` and `GUARDRAIL` kinds as an attribute is allowed.

**7. Tests.** `T7` (component 17): the linter passes over every trace produced by `T1` to `T6` and by the sim; **inert-control mutation**: delete the `why` from a random decision in 1,000 traces, flip a decider to `model` on a `route`, drop a `commit`, swap two `seq` values, drop an `effect.end` from the WAL copy: the linter must flag each mutation, and a linter stub that always passes must make the suite fail. `TRC-NORM` normalisation is idempotent and equal across two branch orders and across two ledger interleavings (no global index survives); `TRC-CHAIN` flipping one byte of a middle line breaks the `prevLineHash` chain at that line (TL17), and a linter stub that skips TL17 fails the suite; `TRC-OTLP` golden OTLP file for a fixed run (fails loudly when a semantic-convention rename lands, 13 §4.3); `TRC-PRIV` no content string reaches the trace in the egress test of M8; `TRC-CRASH` a crash-and-resume trace lints clean and declares `lostTail`.

**8. Risks / NOT VERIFIED.** The convention is in Development and moved once. The `Why` templates for code rules are only as informative as their authors; true-by-construction means the sentence is derived from the inputs, not that it is useful. Whether `/trace-review` accepts this schema is NOT VERIFIED (06 §9.8 raised the same).

**9. Build notes.** Spec step 1 fixes the complete schema (type, registries, `prevLineHash`, `tenant`, `phase`, `agent`, `verb`, `budget`) and the linter; the projection is built at step 15, and adding a field after step 1 is a schema break with a version bump. Unblocks every module's evidence of behaviour (M10 live view, M11 metrics, M9 bundle).

## 6. Components 15 to 21: ledger port, certificates, substrate and bake-off, simulation, sensitivity, profiles, bake-offs 5 and 7

### Component 15. Single-writer ledger-append port (used by M9)

**3. References.** 13 §4.2 (RFC 9162 Merkle tree on C2SP tiles, signed checkpoints, gapless per-stream `seq`, synchronous publication, "the runtime's write-ahead effect log records the leaf index so a crash replays to the same index", the pitfalls table), R32 (Temporal's history as the single record), R24 (WAL discipline), R29 (the idempotency-key pattern name).

**4. What they do.** 13 §4.2 specifies the ledger side (M9 owns it). It leaves the runtime side open: what a crash between "effect happened" and "leaf appended" does, whether parallel branches can append, and what "no effect without a leaf" covers.

**5. Decision.** Own the port, its contract and the crash protocol; M9 owns the tree, the checkpoint cadence and the signer. The runtime never writes the tree and never assigns `seq`. Rejected: letting the runtime append to the tree directly (two writers, and `seq` assigned in completion order), and appending only at the end of a run (a crash would lose the intent entries that M13 needs before an irreversible effect).

**6. Design.**

```ts
interface LedgerPort {                                               // INT-018: M9's two-call API
  append(req: { draft: LeafDraft; key: DocHash; mode: "now" | "deferred" }, ctl: CallCtl): Promise<Result<Appended, PortError>>;   // durable: the leaf is in the log and survives a crash
  published(a: Appended, ctl: CallCtl): Promise<Result<Published, PortError>>;      // resolves only when a published signed checkpoint covers the leaf
  streamHead(t: TenantCtx, stream: string): Promise<Result<{ seq: number; leafHash: Hash }, PortError>>;
}
// A subset constructor of M9's LeafV1 (INT-049): the runtime supplies what it knows; the ledger assigns `seq` and `prev`.
interface LeafDraft { v: 1; tenant: TenantId; stream: LedgerStream; type: LeafType; subjectDigest: DocHash; payloadDigest: DocHash; at: Iso;
                      actor: { kind: "system" | "role" | "human" | "service"; id: string; keyId?: string } }
interface Appended  { stream: string; seq: number; leafIndex: number; leafHash: Hash; duplicate: boolean }
interface Published { appended: Appended; checkpoint: { size: number; root: Hash; note: string } }
```
`LedgerStream` is any M9 stream (`deploy`, `policy`, `memory`, `case:<id>`, `hold:<id>`, `erasure`) inside the tenant's own log (`<ns>/ledger/<deploymentId>/<tenantId>`, INT-048). `model` is not an actor kind: models write nothing, they propose. How M9's `LeafV1` encodes subject and payload (inline or as digests) is M9's; the draft maps field by field. `LeafType` strings come from the leaf registry of M9 §5.4, with M13's names (INT-049), exported as `schemas/leaf-types.json`; this module keeps no list of its own.

Contract (the ledger implementation must satisfy, tested by `LED-CONTRACT` against M9's implementation and the sim ledger): (1) **idempotent by `key`**: `key = digestJson("plumbline.idem.v1", {runId, slot|stepOrdinal, draftDigest})`; the same key returns the same `Appended` with `duplicate: true`; the same key with a different draft is `E_INVARIANT`. (2) **Single writer**: the ledger holds an exclusive writer lock with a fencing epoch; a second writer gets `E_LEDGER_LOCKED`; in the judge path the implementation is in-process and serialises appends through a mutex. (3) **Durability is cheap and per leaf; publication is per batch and mandatory only where an unpublished leaf would let an effect precede its record.** `append` resolves when the leaf is durable; `published` resolves when a signed checkpoint covers it (13 §4.2); `mode: "deferred"` returns a ticket resolved at flush. (4) Gapless `seq` per stream is the ledger's. (5) Unavailability is `transient` (`E_LEDGER_UNAVAILABLE`); if retries are exhausted the guarded effect **does not start** (fail closed).

*Protocol with the effect layer* (the write-ahead rule of 13 §4.2): for a ledger-relevant effect, `effect.end` and `ledger.pending{key, draft}` are written as one `batch` frame (synced); then `append`; then `ledger.appended{key, receipt}`; the effect record's `leaf` is set from the receipt; `published` is awaited at the cadence below and recorded as `ledger.published{key, checkpoint}`. Resume re-issues every `ledger.pending` without `ledger.appended`, and every appended leaf without `ledger.published`, with the same key, in `walSeq` order (idempotent), so a crash at any point yields exactly one leaf at one index and the order of result leaves is preserved. **Two classes of leaf**: (a) leaves that must be **published before the broker acts**: `approval.granted`, `capability.issued` and `action.intent` (M9 §5.4; INT-049 renames the register's earlier `release.intent`), written with the helper `ctx.ledger.appendBefore(call, draft)`, whose order is `gate.verdict`, `ledger.pending`, `append`, `ledger.appended`, `published`, `ledger.published`, `effect.begin`; M13's broker uses it, and M13's `appendAsync` for the intent is withdrawn (INT-018). (b) **Result leaves** (`action.executed`, `action.confirmed`, and every other leaf) may lag with WAL backfill; the invariant V8 "no `action.executed` without prior `action.intent` and `capability.issued`" then holds by order of `walSeq`, which backfill preserves. A run with a ledger attached is `completed` only after its `run.manifest` leaf is published; otherwise it ends `failed` with `E_LEDGER_UNAVAILABLE` and resume re-issues the publication. Trace rules TL15, TL16 and TL18 flag any other order.

*Parallel branches.* Appends requested inside a fan-out branch are `deferred`: buffered in the branch and flushed at the join in branch-index order, so leaf order is independent of completion order. A step that declares an `appendBefore` may not lie inside a fan-out region (compile rule). Steps declare the leaf types they may append (`StepDef.ledger: LeafType[]`); an undeclared type is `E_UNDECLARED_WRITE`.

*What gets a leaf (INT-049, M7 SF7).* Every ledger-relevant effect has a leaf, every leaf has a WAL origin, and every effect is covered by the final `run.manifest` leaf through the cassette digest: only effects and commits that M9's registry names as ledger events (for example `evidence.fetched`, `fact.asserted`, `claim.verified`, `decision.proposed`, `approval.*`, `capability.issued`, `action.*`, `decision.final`, `memory.written`, `policy.published`, `key.rotated`) get their own leaf, plus a `run.manifest` leaf whose payload digest is the `RunManifest` digest (which commits to the cassette digest, so **every** effect is covered by one leaf even when it has none of its own).

**7. Tests.** `LED-IDEM` repeated append returns the same index; `LED-CRASH` crash after each of `pending`, `append`, `appended`, `published` yields one leaf at one index and a preserved result order; `LED-ORDER` leaf order identical across 1,000 branch completion orders; `LED-FAILCLOSED` ledger down: the guarded irreversible effect never begins and the run halts; `LED-PUBLISH` with a publisher that lags, an `appendBefore`-guarded effect never begins before `ledger.published` and a result leaf may lag without breaking `walSeq` order; `LED-LOCK` two writers; `LED-TENANT` a draft for another tenant's stream is refused; `LED-COVERAGE` property over sim runs: I1 every ledger-relevant effect has a leaf, I2 every leaf maps to a WAL record, I3 the `run.manifest` leaf matches the run.

**8. Risks / NOT VERIFIED.** `published` waits serialise on checkpoint publication, which is why only `approval.granted`, `capability.issued` and `action.intent` wait for it; throughput at "thousands of cases" is out of scope (spec 21c-6). The fencing-epoch semantics belong to M9 and are not designed here.

**9. Build notes.** After component 11; consumed by M9 in spec step 8.

### Component 16. Certificate scaffolding and `RunManifest`

**3. References.** Spec sections 9 and 13; 13 §3.3, §3.4, §4.1 (DSSE, in-toto, SLSA-shaped predicate; verdicts PASS, FAIL, INDETERMINATE, NOT_APPLICABLE); XPL-07 (two vocabularies); R6 (finding ledger with severities).

**4. What they do.** 13 §4.1 defines the bundle predicate (`internalParameters` carries policy version, runtime commit, models, budgets; `resolvedDependencies` carries evidence and cassette digests) and the verifier's tri-state result with reason codes. The spec's M4 certificates used PASS, INVALID, INCONCLUSIVE, which collided with the verifier's PASS; the producer words are now VALID, INVALID, INCONCLUSIVE (INT-001).

**5. Decision.** Own the generic envelope and the manifest so every module emits certificates and run facts in one shape. Two vocabularies, never sharing the word PASS (INT-001): the **verifier's verdict** is `Verdict = PASS | FAIL | INDETERMINATE | NOT_APPLICABLE` and appears in `checks[].result`; a **certificate producer's own outcome** is `CertOutcome = VALID | INVALID | INCONCLUSIVE` and appears in `outcome`. The mapping is M9 §8.4's, unchanged: a re-check that agrees with the producer's outcome is PASS even when that outcome is INVALID, a disagreement is FAIL, budget exhaustion is INDETERMINATE. Rejected: a separate envelope per module (the verifier would need one parser per kind) and adopting a Verifiable Credentials or PROV container as the authority (13 §6 item 6: projections only).

**6. Design.**

```ts
interface CertificateEnvelope<K extends string, P extends Json> {
  v: 1; kind: K; id: Id<"ce">; subject: { kind: string; digest: Hash };   // generic: the subject may be a RawHash (a file) or a DocHash (a document)
  frame: { snapshotDigest: DocHash; policyVersion: string; asOf: Iso; checker: { id: string; version: string } };
  outcome: CertOutcome;                                              // the producer's own result: VALID | INVALID | INCONCLUSIVE
  payload: P; payloadDigest: DocHash;
  checks: { id: string; result: Verdict; reason: string }[];         // verifier vocabulary: PASS | FAIL | INDETERMINATE | NOT_APPLICABLE
  assumptions: string[]; nonClaims: string[];
  producedBy: { component: string; version: string; runId: Id<"run"> };
}
// digest (a DocHash) = digestJson(`plumbline.cert.${kind}.v1`, envelope without digest); sealCertificate(kind, body) is the only constructor.
declare function checkEnvelope(e: unknown, kinds: CertKindRegistry): Result<{ digest: DocHash }>;   // pure, dependency-free, copied into the verifier core by M9
```
`CertKindRegistry` maps a kind to its payload schema id and its required `assumptions`/`nonClaims` keys (a flip certificate must list "relative to the frozen snapshot" and "not real-world causation"). Payloads and checkers belong to M4, M5, M6 and M9; M7 owns the envelope, digest and registry only.

```ts
interface RunManifest {
  v: 1; runId: Id<"run">; tenant: TenantId; caseDigest: DocHash; graphHash: DocHash; codeDigest: DocHash; runtimeVersion: string;
  schemaManifestHash: DocHash; validatorProfileHash: DocHash; toolSurfaceHash: DocHash; policyVersion?: string;
  models: { id: string; params: DocHash }[]; promptDigests: DocHash[]; budgetProfileHash: DocHash; budgetUnsound: boolean;
  seed: string; mode: Mode; profile: "sponsor" | "evaluation" | "baseline" | "scripted" | "judge-replay";
  modelProfile: "sponsor" | "evaluation" | "local"; disclosureProfile: "public_lookup" | "identifier_only" | "offline";   // INT-020: the two axes of the word "profile", both recorded
  cassetteDigest?: RawHash; cassetteCoreDigest?: DocHash; traceDigest: RawHash; finalStateHash: DocHash; effectCount: number;
  status: "completed" | "failed" | "halted_in_doubt" | "awaiting_human" | "cancelled"; degraded: { step: string; reason: string }[];
  ledger?: { streams: { stream: string; headSeq: number; headLeafHash: Hash }[] };   // heads taken before the run.manifest leaf is appended; per stream, no global index, tree size or root (INT-053)
}
```
`manifestDigest = digestJson("plumbline.manifest.v1", manifest)`; it is the payload of the `run.manifest` leaf (component 15) and fills the `internalParameters` of the bundle predicate (M9). The ledger's global leaf indices, tree size and root are properties of the log, not of the run, and are read from the receipts when a bundle is built; keeping them out of the manifest is what lets `manifestDigest` be equal across two interleavings (G7).

**7. Tests.** `CERT-ENV` tampering with `payload`, `subject`, `assumptions` or a missing required non-claim yields FAIL; `CERT-VOCAB` the outcome-to-verdict mapping table is total, a certificate with an unknown `outcome` or `result` string is rejected, and `PASS` in `outcome` or `VALID` in `checks` is rejected (the two vocabularies never overlap); `MAN-GOLDEN` a fixed run's manifest digest is stable across machines (core digest) and changes when any listed input changes (one mutation test per field).

**8. Risks / NOT VERIFIED.** The verdict vocabulary change touches M4's (`CertOutcome`) and M9's text (INT-001). Certificate sizes (a Merkle-committed table of up to 2^20 verdicts, 08 §1.8 per XPL-07) are M4's to cap.

**9. Build notes.** After components 1 to 3 and 14.

### Component 17. Execution substrate interface, the thin runtime and the bake-off protocol

**3. References.** R1, R2, R3, R4, R8, R9, R10 to R13 (candidates and screens), R32 (replay by history comparison), R24 and R25 (durability facts), R22 (property tests), 06 §9.12 (the eight acceptance tests) and §9.13 (what we do better, and where frameworks stay better), D-009, D-011, RUN-01 and RUN-03.

**4. What they do.** Section 2 and the components above record the behaviours that matter: R8 re-executes an interrupted node from its start when a resume value arrives and defaults to `"async"` durability; R1/R8 persist per-task writes so finished siblings are not recomputed; R9 compares commands against history; R10 is an in-process actor/state-machine library with persisted snapshots (snapshot API not read); R11 to R13 need a framework integration, Postgres or a server (screened out); R2 races listeners. None has an effect cassette, a pre-call budget or a `Why` requirement.

**5. Decision.** The runtime is two layers (spec section 4): the kernel contracts (components 1 to 16) are ours whatever the substrate; the substrate is whichever candidate passes the eight tests with the least owned code. **No outcome is assumed**; a hybrid is acceptable if it wins. This blueprint specifies the interface, the thin candidate, the adapter plan for LangGraph.js, the harness and the decision rule, so the bake-off is mechanical.

**6. Design.**

*17.1 What a substrate must provide (obligations S1 to S9, each tested).*

| Id | Obligation | Guarantee protected | Test |
|---|---|---|---|
| S1 | Run the compiled `GraphDef` using the kernel `runStep` for every step; never run step code any other way | G1, G2, G6 | T1, T2 |
| S2 | Merge branch results only through the kernel `commit`/`merge` in branch-index order | G3 | T4 |
| S3 | Persist control state (frontier, visit counts) so a killed process resumes; domain state comes from the WAL, not the substrate | G1, G9 | T2 |
| S4 | At-least-once step execution is allowed after a crash; the substrate must not suppress the kernel's slot dedup or run effects outside `perform` | G1 | T2 |
| S5 | Deliver human answers without re-running a step that has effects | G5 | T6 |
| S6 | Enforce no route that the compiled graph lacks; no model-chosen routing | G4, 06 §9.1 | T5, `GRF-ADAPT` |
| S7 | Propagate cancellation (`AbortSignal`) to running steps | G2 | T3, T6 |
| S8 | No network egress or telemetry unless the composition root configures it | G8 | `SUB-EGRESS` |
| S9 | Bounded: finite loop limit set explicitly, no hidden default that differs by version | G2 | `SUB-LIMIT` |

*17.2 Driver interface the harness uses (identical for every candidate).*

```ts
interface SubstrateDriver {
  readonly id: "thin" | "langgraphjs" | string; readonly version: string;
  prepare(k: Kernel, g: GraphDef, impl: StepRegistry): Promise<void>;                       // compile + adapter wiring
  start(run: RunSpec): Promise<RunOutcome>;                                                  // until completed | awaiting_human | failed | halted_in_doubt | crashed
  resume(runId: Id<"run">): Promise<RunOutcome>;
  respond(runId: Id<"run">, i: Id<"int">, response: Json, by: Actor): Promise<RunOutcome>;
  tick(now: Iso): Promise<void>;                                                             // expiry
  inspect(runId: Id<"run">): Promise<{ state: Json; stateHash: DocHash; frontier: string[]; open: Interrupt[]; budget: BudgetSpec }>;
  topology(): GraphDef;                                                                      // read back from the adapter, compared to the input (GRF-ADAPT)
}
```

*17.3 The thin runtime (candidate T).* One supervisor, structured control flow only:

```ts
async function supervise(k: Kernel, rs: RunState): Promise<RunOutcome> {
  while (true) {
    if (k.budget.shouldFinalize()) rs.next = finalizeRoute(k, rs);                                  // forced route with a Why (component 7)
    const act = rs.next; if (act === DONE) return complete(k, rs);
    const step = k.graph.step(act.step);
    if (step.kind === "human") { const i = openInterrupt(k, rs, step); return awaiting(k, rs, i); }   // exits; resumed by respond()
    const out = step.kind === "fanout" ? await runFanout(k, rs, step) : await runStep(k, { step, ...act });   // component 9 / 12
    if (!out.ok) { rs.next = onFail(k, step, out.error); continue; }                                     // abort | degrade | fallback, each a traced decision
    await k.commit(rs, step, out.value);                                                                 // component 8 + WAL commit (synced)
    rs.next = k.graph.successor(step, out.value.route, rs);                                              // static edges; cond uses the router's Route
  }
}
```
Control state is rebuilt from the WAL (component 11), so the thin candidate owns no second store. Expected owned code: supervisor, fan-out executor, interrupt delivery, resume driver (no size claim is made before it is counted).

*17.4 LangGraph.js candidate (L), adapter plan.* Read in R8: `Durability = "exit" | "async" | "sync"`; `BaseCheckpointSaver` abstract methods `getTuple, list, put, putWrites, deleteThread`; `interrupt()` resume matching by in-node counter; `DEFAULT_LOOP_LIMIT = 25`; per-task `putWrites`; tasks sorted before `applyWrites`. Adapter:
1. **Pointer state.** The LangGraph state is one `LastValue` channel holding `{ seq, stateHash }`; domain state lives in the kernel (WAL). Every node wrapper loads the view from the kernel by that pointer, calls the kernel `runStep`, calls the kernel `commit`, returns the new pointer. This keeps G9 (we own state encoding) and avoids two sources of domain truth.
2. **Saver.** `WalCheckpointSaver extends BaseCheckpointSaver` stores LangGraph's own checkpoint and pending-write blobs as opaque `lg.checkpoint`/`lg.writes` WAL records (control metadata only: channel versions, versions seen); `getTuple` and `list` read them back. Its conformance is checked with the monorepo's `checkpoint-validation` library (R8, not read, NOT VERIFIED that it applies).
3. **Durability** is forced to `"sync"`; `recursionLimit` is set explicitly from the graph (S9); the kernel's `maxVisits` is the authority.
4. **Fan-out** with `Send`: each branch node returns its patch into an aggregate channel tagged with the branch index; a join node calls the kernel `merge` with patches sorted by branch index, never trusting LangGraph's ordering (S2).
5. **Human steps**: the node body is only `interrupt(payload)` with no code before it; delivery uses a `Command` resume; expiry is applied by the driver's `tick` (LangGraph has no timers) as a synthetic deny; the response is validated by the kernel (R8 validates only Zod schemas).
6. **Effects** inside nodes go through `perform`; a node re-executed after a crash dedups by slot (S4).
7. **Egress**: `@langchain/core` depends on `langsmith`; with no tracer configured and the relevant environment switches off, a network stub must show zero calls (`SUB-EGRESS`); whether tracing is on by default is NOT VERIFIED (06 §4.3).
Known divergence risks to be tested, not assumed away: D1 crash between LangGraph's checkpoint write and the kernel's WAL commit (and the reverse); D2 LangGraph task ids derive from namespace, step and name, so renaming a step orphans pending writes; D3 a library upgrade changes opaque blobs (in-flight runs cannot resume across an upgrade; documented); D4 peer dependencies (`@langchain/core` about 7.6 MB unpacked plus `zod`, `langsmith`, `js-tiktoken`, `p-queue`, `mustache`) change judge-run weight; D5 Node engine floor (`@langchain/core` requires Node 20 or newer per registry metadata, compatible with the Node 22 plan).

*17.5 Screening of candidates (before any code is written).* The judge-run screen is pre-registered (INT-057 e); on the evidence read, Temporal fails it and XState passes. Pre-screen criteria PS1 to PS5 (pre-registered): PS1 runs inside the single `npm run demo` Node process; PS2 no download of a binary or service at install or run beyond `npm ci`; PS3 no database or server process; PS4 permissive licence; PS5 install weight below a threshold fixed in the pre-registration file before measuring.

| Candidate | Evidence | Pre-screen |
|---|---|---|
| T thin runtime | ours | passes by construction |
| L LangGraph.js (R8) | MIT; in-process; peers as above | passes PS1 to PS4; PS5 measured |
| P Temporal TypeScript (R9) | docs: `@temporalio/testing` "downloads the test server"; `@temporalio/worker` depends on `webpack`, `@swc/core`, `@temporalio/core-bridge`; a real deployment needs a server | **fails PS2 and PS3 on the evidence read**; stays out unless a documented in-process or vendored-binary mode is verified (spec: "Temporal only if a judge can run it with one command") |
| X XState (R10) | MIT, zero dependencies, 2.3 MB; actors and persisted snapshots (snapshot semantics not read) | passes PS1 to PS4; added as the **fourth candidate** (INT-057 e); like every candidate it must host obligations S1 to S9 and pass T1 to T7, and it wins only by lower owned lines |
| Workflow DevKit (R11), DBOS (R12), Restate (R13) | framework integration / Postgres / server per their READMEs | fail PS3 (R11 NOT VERIFIED outside its integrations) |

*17.6 The reference case `RC` (identical for every candidate; defined as `GraphDef` plus step registry in `eval/bakeoff-1/rc/`).* Steps: `intake` (pure) → `plan` (pure; lists sources A, B, C) → `fan` (allSettled, 3 branches, each `fetch` (tool, read, paid) then `extract` (llm, scripted model)) → `join` (pure, `appendByBranch`) → `allowed` (pure) → `judge` (llm, skipped when one action is allowed) → `critic` (pure, loops back to `judge` at most twice) → `gate` (gate, veto route `hold`) → `approval` (human, expires, deny route `hold`) → `release` (tool, irreversible, requires `Approved`, idempotency key, `status` probe switchable) → `finalize`. The **simulated world** (`PaySim`) lives outside the runtime's memory and counts ground truth: fetch calls per source, releases executed per idempotency key, model calls and tokens served, with a switchable `status` probe, switchable response loss after execution, and rate-limit injection. The model is the scripted model (responses are a table keyed by request digest, with adversarial, malformed, empty and transient-error modes), so tests measure the runtime, not model quality.

*17.7 The eight acceptance tests as executable scenarios (each runs through `SubstrateDriver`; sim tier uses `src/sim` ports, process tier uses real files and a child process).*

- **T1 Replay equality.** Record 20 runs (5 seeds × input classes: clean, conflicted, one-source-failed, gate-veto, human-denied); replay each in a fresh process. Assert: normalised traces equal; final `stateHash` equal; re-exported `cassetteDigest` equal; `PaySim` counters unchanged; network and clock stubs untouched. Negative: delete one record (`CassetteMiss` naming the slot), duplicate (`unused_recorded` or duplicate-slot error), change one input field (`request_drift` at the first divergent step with a field path), change the graph (`E_GRAPH_DRIFT`), permute lines (still equal, same re-export digest), edit a response body (`replay --expect-digest` fails; replay alone trusts the file).
- **T2 Crash safety.** For the reference run's WAL of N records, crash after record i for every i, and with record i torn at 3 byte offsets (first byte, middle, last byte minus one), plus crash after each port returns and before `effect.end`; resume; repeat with two and three crashes on 500 random schedules. Assert: the run completes (or halts `halted_in_doubt` exactly where an irreversible effect had no probe); `PaySim`: each source fetched once, except a read effect inside its in-doubt window may be redone once; `release` executed at most once per idempotency key, exactly once on completion when the probe exists; final `stateHash` equals the uncrashed reference; spent budgets after resume are at least those before the crash and never above the limit; no duplicate `commit` seq; trace lints clean. Process tier: SIGKILL (Windows `taskkill /F`) at 50 sampled points on real files.
- **T3 Budget soundness.** Adversarial scripted model (always the maximum output, 50% transient errors), limits set to a third of what an unconstrained run needs, one dimension at a time (turns, model calls, tool calls, input tokens, output tokens, wall clock on the virtual clock) and all together, with 8-way fan-out contention. Assert: provider-side counters in `PaySim` never exceed the limit in any dimension; retries appear in `spent` and the trace; the run ends in `finalize` with `degraded` or a typed `budget` error, never hangs or exceeds the deadline by more than one abort latency; a model that under-reports usage is flagged `budgetUnsound`; `T3-EST` estimator bound holds over all recorded usage.
- **T4 Order independence.** 1,000 seeds of random branch completion delays (permutations incl. ties) for branch counts 0, 1, 3, 7 and the cap, with and without a failing branch, and a `quorum(2)` join. Assert identical merged `stateHash`, identical normalised trace, identical ledger leaf order (sim ledger). Thin candidate uses the virtual scheduler; LangGraph.js uses real timers with random delays of 0 to 15 ms.
- **T5 Gate integrity.** The five checks of component 10 (type-level, forgery set, counterfactual replay with zero model spend, throwing gate, inert controls), plus the dominance compile failure fixtures and `approvedFromState` after a crash.
- **T6 Failure drills.** The matrix of dependency × failure with expected typed outcome (model: transient forever, 401, malformed JSON, empty, schema-valid-but-blocked, over-length, refusal; tools: timeout, unavailable, changed surface, wrong shape; store: ENOSPC at WAL append k, EIO on read; ledger: down, busy, crash after append; clock: backwards jump; human: never answers, invalid, late, conflicting, unauthorised; critic forced to reject three times; input: empty, junk, oversize, duplicate keys, depth 65). Assert: error class and code as tabulated, visible `degraded`, no silent default, no effect after a fatal error, bounded retries, a `Why` on every decision.
- **T7 Trace completeness.** Component 14: linter over all traces of T1 to T6 and the sim, plus the inert-control mutation suite.
- **T8 Comparison.** `npm run bakeoff:report` aggregates: pass/fail of T1 to T7 per candidate with the failing scenario ids; the capability matrix of `prior-art/06` §8 re-filled for the built code and for each candidate with a test id as evidence in every cell; a "where each framework is still better" section (06 §9.13) re-written from what the harness found; owned lines; escapes; dependency footprint; cold start.

*17.8 Metrics.* **Owned lines**: non-blank, non-comment physical lines after the repository's pinned formatter, counted by `tools/owned-lines.mjs`, over `src/substrate/<candidate>/**`, candidate-specific configuration and any `patches/**` (patch lines counted twice and each patch is also an escape); kernel and shared code are excluded (identical for all candidates), generated code and tests are excluded; the script and its exclusion list are committed before the first count. **Escape**: a guarantee that holds only because of (a) adapter code that re-implements a substrate duty (soft escape, counted and described), (b) a patch or fork of a dependency (soft), (c) a default that violates a guarantee and relies on configuration discipline, such as `durability: "async"` (soft), or (d) a failed scenario (**hard escape**: disqualifying). **Footprint**: transitive packages and unpacked bytes measured from the resolved lockfile (not registry metadata), plus cold-start time of `npm run demo` in replay profile. Time per test and flake rate over 20 repeats are reported.

*17.9 Decision rule, pre-registered in `eval/bakeoff-1/prereg.md` before any candidate runs.* The file is written and hashed locally first; it counts as **confirmatory** only if it is publicly committed after 22 October 2026 00:00 UTC (or hash-anchored externally) before the run starts, and the report header says which (INT-059). Any run before that is exploratory by definition, because a local hash chain with a self-reported clock is not independent evidence of ordering; hash anchoring before the window is an open question for the organizers and is not assumed. 1. A candidate with any hard escape is disqualified. 2. Among qualifiers, lowest owned lines wins; if two are within a tolerance fixed in the pre-registration file, fewer soft escapes wins, then smaller footprint, then lower cold start. 3. A hybrid (for example L with the pointer-state adapter) is a candidate like any other. 4. If no candidate qualifies, the thin runtime is repaired and rerun; the failing scenarios are published. 5. The result is a decision record in `docs/DECISIONS.md` and the full report in `eval/reports/`, published whichever way it falls (spec section 19a). The design is **disproved** if the thin runtime cannot pass T1 to T7 after documented fixes, or if a candidate passes with fewer owned lines and no hard escape (in which case that candidate is adopted and this blueprint's thin supervisor is reduced to the adapter).

*17.10 Harness self-tests (prove each test can fail).* Broken drivers kept in `eval/bakeoff-1/broken/`: B1 re-executes effects without slot dedup (must fail T2), B2 merges in completion order (T4), B3 loses the last checkpoint on kill, modelling `async` durability (T2), B4 approves on expiry (T6), B5 skips `reserve` (T3), B6 routes around a gate (T5), B7 emits control events without `Why` (T7), B8 writes to the network (SUB-EGRESS). The suite is accepted only if each broken driver fails exactly its test.

**7. Tests.** As above; additionally `SUB-LIMIT`, `SUB-EGRESS`, `GRF-ADAPT` (adapter topology read back equals `GraphDef`).

**8. Risks / NOT VERIFIED.** Nothing about LangGraph.js behaviour under process kill has been observed (only read). The pointer-state adapter may fight LangGraph's assumption that channel values are the state (for example in its own `getState`); whether it is cheaper than the thin supervisor is the question the bake-off answers. XState's snapshot semantics are unread. Judge-run weight thresholds are unset. The tolerance in rule 2 is a choice made before the run, not derived.

**9. Build notes.** Order: kernel contracts (components 1 to 16 except the substrate) first; thin supervisor second (it is also the sim's engine); harness and `RC`; broken drivers; the eight acceptance tests; LangGraph.js adapter; run the protocol; record the decision. The harness, the broken drivers and the eight acceptance tests are deliverables of spec step 3 together with the WAL and the cassette (INT-057 f, register section 5 V1), so that bake-off 1 (step 3a, which runs bake-offs 1, 5 and 8 only) judges candidates with our effect layer on top; step 4 follows.

### Component 18. Seeded simulation harness with fault injection (`plumbline-sim`)

**3. References.** R31 (FoundationDB simulation: whole cluster in one deterministic process, simulated network, disk and time; TigerBeetle VOPR: a seed plus the git commit replays any failure, assertions stay on), 13 §5 (the proposal this component refines, including the Antithesis and Jepsen notes), R26 (disk crash semantics), R22 (`seed` and `path` replay, model-based command sequences), R24.

**4. What they do.** Both simulators run the **same code** as production against injected clock, network and disk, drive it with a seeded fault generator, check invariants after each run and print `seed + commit`. 13 §5 notes the method suits the runtime because every effect already passes a recorded port.

**5. Decision.** Adapt (rejected: Antithesis, a commercial deterministic hypervisor that a judge cannot run, 13 §5; Jepsen-style external fault injection against a live process, which cannot be seeded). The sim is a set of port implementations plus a driver; it runs the real kernel and the thin supervisor, and the LangGraph.js adapter where it supports the ports (real timers there limit determinism, so T4 for L uses real delays).

**6. Design.**

*World (`src/sim/world.ts`).* `SimClock`/`SimScheduler` (virtual time, priority queue, seeded tie-break); `SimStore` (per file: a durable byte string plus a volatile suffix; `append` extends the volatile suffix, `sync` makes it durable, `crash()` keeps a seeded prefix of the volatile suffix, including a cut inside a frame, and nothing beyond; ENOSPC after a byte quota; read errors; file creation without directory sync may vanish, modelling R25/R26 limits); `SimModel` (scripted tables from the seed, fault modes: transient, malformed, empty, over-length, duplicate delivery, slow, under- and over-reported usage); `SimTools`/`PaySim` (ground-truth counters outside the run's memory, idempotency table, switchable probe, timeouts, response loss); `SimHuman` (answer plans: delay, invalid, duplicate, conflicting, late, never); `SimLedger` (idempotent counter log with busy, down, crash-after-append, lagging publication of checkpoints, per-tenant streams); `SimNet`, `SimSandbox`, `SimSigner` and `SimFs` (scripted exchanges, a worker that dies or exceeds its limits, a signer that refuses or is slow, the `SimStore` crash model behind `FsPort`), so every port of component 4 has a seeded fault adapter from step 1.

*Fault plan.* `FaultPlan = [{ at: Trigger, fault: Fault }]`, JSON, hashed (`planHash`). Triggers: the k-th WAL record, the k-th port call of a kind, a virtual time, a step entry. Crash is a fault: `SimulatedCrash` unwinds the runtime, all in-memory objects are dropped, the `SimStore` crash model is applied, a fresh runtime is built on the surviving durable bytes and `resume` is called; at most `maxCrashes` per run.

*Run loop.*

```ts
for (const seed of seeds) {
  const w = new SimWorld(seed); const plan = genPlan(seed, profile);
  const result = await runToCompletion(w, program, plan, { maxCrashes: 3 });     // crash/resume loop
  const violations = checkInvariants(w, result);                                  // I1..I18
  if (violations.length) { report({ seed, commit: gitCommit(), planHash: hash(plan), violations }); shrink(plan, w); }
}
```
*Invariants* (checked after every run; also shipped inside the verifier's replay mode per 13 §5): I1 budgets never exceeded in provider counters; I2 each slot executed at most once outside its in-doubt window; I3 provider-side effect count ≤ `effect.begin` count; I4 an irreversible effect is preceded by a matching `gate.verdict`; I5 replaying the WAL's commits reproduces the final state hash; I6 crash-and-resume final hash equals the uncrashed hash (deterministic scripted model); I7 branch completion order does not change state, trace or leaf order; I8 trace lint clean; I9 record then replay equal; I10 no `Approved` without a verdict record; I11 humans fail closed (expiry never approves); I12 no commit after a fatal error; I13 no effect begins after `E_WAL_WRITE`; I14 the WAL is repairable at every crash point; I15 ledger coverage (component 15); I16 monotonic keys never decrease; I17 no record, key, store name or stream outside the run's tenant prefix; I18 an `appendBefore`-guarded effect begins only after its leaf is published.

*Shrinking.* On failure, delta-debug the fault plan (remove faults and shorten the schedule while the same invariant still fails), print the minimal plan and write it to `eval/sim-corpus/<planHash>.json` as a permanent regression case; also `fast-check` (R22) drives *command sequences* (start, crash, resume, respond, tick, cancel) with its own `seed`/`path` replay.

*Profiles.* `light` (per pull request: a fixed seed list, a time cap) and `heavy` (nightly: large seed range). Seed counts are unmeasured and set from observed runtime.

*Two tiers.* The sim tier models disk faults; the **process tier** (T2) uses real files and real process kill. Neither is a power-loss test.

**7. Tests.** `SIM-SELF`: the broken drivers of 17.10 must each trigger their invariant (the sim detects a defect we plant); `SIM-DET` the same seed gives the same trace byte-for-byte across two processes; `SIM-CORPUS` every committed corpus case passes; `SIM-DISK` unit tests of the disk model itself (synced data survives, unsynced is a prefix of what was written).

**8. Risks / NOT VERIFIED.** A sim finds bugs inside its fault model only; the disk model is a design from R26, not a measurement of NTFS. JavaScript promise scheduling is deterministic given deterministic inputs, but any accidental use of a real timer or `Date` breaks determinism: the forbidden-global lint and the replay stubs (component 4) guard this.

**9. Build notes.** Built alongside components 5, 7 and 11, because each needs its invariants; the broken drivers come with the bake-off.

### Component 19. Input-sensitivity test design and deterministic-stage replay

**3. References.** R28 (metamorphic testing: relations between outputs of related inputs where no oracle exists), R22 (property-based generation and replay), R23 (mutation testing of code, used here to test the tests), 13 §4.4 (replay corpus gate), spec 15 (two replay classes), 21 F-SAMPLE, AUD-08 (the review finding), `CLAUDE.md` rule 3 (no hardcoded outputs).

**4. What they do.** Metamorphic testing replaces an unavailable oracle with relations such as "adding an irrelevant field leaves the output unchanged" and "removing a required fact never makes the decision more permissive". The title, authors and venue of R28 were verified; its content was not read, so the specific relation catalogue below is ours.

**5. Decision.** Own the design: a stage-closure rule so that replay on a changed input is only attempted where it is meaningful; a mutation catalogue with predicted output diffs written independently of the implementation; sensitivity metrics. This resolves the conflict between F-SAMPLE ("plants mutations and asserts the output diff in replay") and spec section 15 ("replay on a different input is a `CassetteMiss`") as INT-044 states it: the six recorded scenarios are full replay (class A) on recorded inputs; input sensitivity is tested on **deterministic stages** (class B: reconcile from recorded links, the rule engine, the verifier) on any input, and on model-bearing stages only live (one novel input in the demo, plus recorded runs per mutated input); a `CassetteMiss` prints the exact command that runs a new vendor live.

**6. Design.**

*Deterministic-stage replay (class B).*

```ts
declare function pureClosure(g: GraphDef, patchKeys: string[]): { steps: StepId[]; stopsAt: StepId[] };   // pure, deterministic steps reachable from readers of patchKeys
declare function replayStages(rec: RunRecord, a: { fromSeq: number; patch: StatePatch; gates?: GateOverrides }): Result<StageReplay>;
```
`replayStages` loads the recorded state at `fromSeq`, applies `patch` (schema-validated), and re-runs only steps whose `deterministic` flag is true (kinds `pure`, `gate`, `join`), whose ctx has no ports. If any key in `patch` is read (directly or through a re-executed step's writes) by a step that is **not** deterministic, the call returns `E_STALE_RECORDED_STEP` listing those steps: their recorded outputs would be stale and the honest answer is "this mutation needs a live or re-recorded run". Execution stops at the first non-deterministic step on each path and reports `stopsAt`. Outputs: the new state at the stop, its hash, the trace of re-executed steps, and a field-level diff against the original state.

*Mutation catalogue (operators run on recorded case snapshots).* Each operator has a **predicted diff** authored from the policy documents by someone other than the implementer (M11's independently reviewed generator, spec section 16) and stored as data: (1) change a system-of-record attribute (vendor bank account) → expected: `bank_changed_recently` input flips, a hold rule fires; (2) age a list version → stale-list rule; (3) add a contradicting assertion → conflict opens, truth-table cell `unresolved`; (4) remove a required release-enabling fact → hold (absence is a hold); (5) raise the amount across a cap → approval tier changes; (6) swap the payee id → different record, different fired rules; (7) remove an evidence item → M4's sufficiency/flip set changes as the necessity table predicts; (8) duplicate a vendor record → duplicate-vendor rule; (9) requester equals approver → segregation rule. Operators reaching model-bearing stages (extraction, decomposition, entailment) are not run in replay; their sensitivity is shown by the six recorded scenarios (F-SAMPLE) and by one live novel input.

*Metamorphic relations (benign: output must be unchanged).* MR-KEY key order and whitespace of the input; MR-ID order-preserving renaming of internal ids; MR-SET reordering of set-like lists; MR-IRR changing a field declared decision-irrelevant; MR-RESER re-serialising the case. *Monotone relations (restrict-only):* MR-MON1 adding an adverse fact never makes the action more permissive in the order `release > release_with_approval > escalate > hold > reject`; MR-MON2 removing a required fact never makes it more permissive; MR-MON3 raising the amount never lowers the approval tier.

*Metrics (reported by M11 with intervals).* **Mutant agreement rate** = mutations whose observed diff equals the predicted diff / all mutations (Wilson interval); **dead-input rate** = declared decision-relevant input fields for which no applicable operator changes any output field (target 0; a nonzero value means a defect or a wrong declaration); **spurious-sensitivity rate** = benign perturbations that change any output digest (target 0); **canned-output check** = pairwise distance of normalised outputs across the six scenarios is nonzero on decision-relevant fields; **cone soundness** = for each mutated key, the set of steps whose output changed is a subset of the static cone (M4's pruning depends on it) with the Proxy read audit of `COM-READS`.

*Full replay on mutated input* is asserted to fail: `SENS-MISS` mutates an input in a recorded run and expects `request_drift` or `slot_missing` naming the first divergent step and the hint `RUN_LIVE`.

*Testing the tests.* Mutation testing (R23) over the gate, budget and merge code: every surviving mutant is either an equivalent mutant (reviewed) or a missing test; the target score is reported, not assumed.

**7. Tests.** `SENS-RT` the machinery on `RC`: operators and relations with predicted diffs; `SENS-STALE` a patch reaching a model step returns `E_STALE_RECORDED_STEP` with the right list; `SENS-CLOSURE` `pureClosure` equals brute-force reachability on random graphs; `SENS-INERT` an engine that ignores the patch must fail `SENS-RT` (inert control).

**8. Risks / NOT VERIFIED.** The predicted-diff tables are only as independent as their authors; the domain reviewer of spec section 1a is needed. The closure rule means **no claim about input sensitivity of model-bearing stages can be made from replay**; that limit must appear in the README and the report.

**9. Build notes.** After components 9 and 11; consumed by M3, M4, M5 (their deterministic stages) and M11.

### Component 20. Run profiles, composition root and doctor checks

**3. References.** Spec 15 (sponsor and evaluation profiles), 21 F-RUN, F-SAMPLE, F-DOWNLOAD, 02 (Agent Reach-style doctor with exit codes and credential redaction, spec section 6), R3 and R4 and R2 (default-on exporters as the failure to avoid, 06 §9.14), R17 (security page: compile schemas at start).

**4. What they do.** crewAI exports telemetry unless three environment variables are set; openai-agents uploads traces to its vendor unless disabled, and caches that flag (06 §5.3, §7.3); AutoGen's tracer is a no-op unless supplied. Agent Reach's doctor probes each backend for real and redacts credentials.

**5. Decision.** Own. One composition root constructs adapters; profiles are data; the kernel's `doctor` verifies the facts this module's guarantees depend on. Rejected: configuration through scattered environment reads (a hidden exporter flag, as in R2 and R4, would be undetectable) and a framework-style default-on tracer.

**6. Design.**

*Profiles* (PSP-schema'd, hashed into `RunManifest`): `judge-replay` (SAMPLE_MODE: `mode: replay`, model and tool ports replaced by the cassette, network stubs installed, deterministic-stage replay allowed on new inputs, the UI and trace label the mode; a miss prints the live command), `live` (record optional), `sponsor` (model adapter must be the NVIDIA one; the rule brain is refused; the trace labels "same family"), `evaluation` (multi-family; the only profile used for measured claims), `baseline` (rule brain, no sponsor engines). A profile fixes: model adapter ids, budget profile, tool allowlist, egress classes, whether the ledger is attached, the trace sinks (file only by default; no exporter), the tenant (`tn_default`), and the two renamed axes that the word "profile" used to blur (INT-020): `modelProfile` (`sponsor | evaluation | local`) and `disclosureProfile` (`public_lookup | identifier_only | offline`). Both are recorded in `run.begin`, the cassette header, every trace line and `RunManifest`.

*Composition root (`src/runtime/compose.ts`).* The only module that constructs live adapters or reads environment variables; it refuses to start if an exporter, tracer or telemetry switch is enabled without a profile line that names it; it passes the substrate driver, every port of component 4 (live adapters under `src/runtime/adapters/**`, sim adapters in `sim`), the interceptors (M8, M9, including the kill-state gate) and the budget profile to `createKernel`. In `judge-replay` the `net`, `sandbox` and `signer` ports are replaced by throwing stubs unless the profile names them.

*Doctor (kernel checks; exit codes 0 ok, 10 warning, 20 failure; output is JSON plus text with credentials redacted by the structured allowlist).* D1 Node version at least the pinned floor (prints the fix command); D2 JCS vector subset and the `JSON.stringify` escape check (`JCS-V1`); D3 schema manifest hashes and the 200-case validator vector subset; D4 WAL self-test in the run directory: write, sync, reopen, tear the last frame, repair, verify chain; D5 free disk space above a configured floor; D6 `monotonicMs` non-decreasing over 1,000 reads; D7 tool surface hash equals the pinned one; D8 network stubs effective in `judge-replay` (a `fetch` to a reserved address must throw the stub error); D9 lockfile integrity; D10 no tracer or exporter configured; D11 time zone and locale independence (a canonicalisation vector run under two `TZ` settings); D12 the digest-kind vectors K-RAW1, K-DOC1, K-COM1 and the `sha256sum` agreement of `rawHash`; D13 the tenant prefix is applied by every store adapter (a probe write lands under `tn_<id>/`). M1's doctor adds channel probes and M8's the compartment probes; M10 renders all of them.

**7. Tests.** `PROF-*` each profile starts and refuses the forbidden combinations (sponsor with the rule brain, replay with a live port, evaluation with a single family); `DOC-*` each check fails when its fault is injected (full disk simulated, torn WAL, tampered schema, changed tool list); `COMP-NOENV` the kernel reads no environment variable outside the composition root (AST test).

**8. Risks / NOT VERIFIED.** Whether the judge's machine has Node 22 and a writable run directory is NOT VERIFIED (clean-room verifier covers it). Time zone behaviour is expected to be irrelevant (all times are UTC strings from the clock port) and is checked, not assumed.

**9. Build notes.** Spec step 1 for the root skeleton; step 14 for the profile polish.

### Component 21. Bake-offs 5 and 7, runtime side

Spec 19a assigns bake-off 5 (embedded store) and 7 (structured output) to the foundations set; both touch M7's ports. M7 does not decide them (M1, M12 and M14 own the data and the model adapters) but it fixes the boundary and the protocol so the result cannot leak into the kernel. Timing (register section 5, V4): bake-off 5 runs in step 3a with bake-offs 1 and 8; bake-off 7 needs an NVIDIA key and the M11 gold items, so it runs when the key exists. The pre-registrations of both follow the confirmatory-versus-exploratory rule of 17.9 (INT-059).

**Bake-off 5, embedded store.** *References:* Node 22 documentation fetched: `node:sqlite` is "Stability: 1.1 - Active development", no flag needed from v22.13.0, classes `DatabaseSync`, `StatementSync`, `Session` (the page does not state WAL support; it exposes what the bundled SQLite offers). DuckDB (`duckdb/duckdb`, 42,158 stars, MIT, 2026-10-13; Node client `duckdb/duckdb-node-neo`, 199 stars, MIT): npm `@duckdb/node-api` 1.5.6-r.1 is 0.65 MB and depends on `@duckdb/node-bindings`, which lists per-platform optional packages; registry metadata gives `@duckdb/node-bindings-win32-x64` about 38 MB and `linux-x64` about 71 MB unpacked; `@duckdb/duckdb-wasm` is about 149 MB unpacked. *Boundary:* the WAL, cassette, content store and trace never use an SQL engine; they use `StorePort` (component 4: one blob store addressed by `RawHash`, partitioned by confidentiality class, with tombstones, INT-043) over plain files (components 5 and 11), whatever this bake-off decides. SQL is for raw source tables of the synthetic silos and evaluation tooling (M1, M11), reached through a `TablePort` that M1 defines; a lint forbids importing an SQL engine from `src/kernel` or `src/runtime`. *Protocol (`eval/bakeoff-5/`):* candidates: file-backed append-only tables with an in-memory index; `node:sqlite`; DuckDB native; DuckDB WASM. Metrics: judge-run weight from the resolved lockfile; cold start; determinism (`STORE-DET`: the same query returns identical bytes in three runs and on two platforms, ordering made explicit); crash behaviour in the sim (`STORE-CRASH`: kill mid-write leaves no torn table, run under `SimStore` for the file candidate and under process kill for the others); Windows behaviour on the development machine (`STORE-WIN`); SQL parity with the Zetaris query path (NOT VERIFIED, M1); bitemporal as-of query ergonomics (`STORE-ASOF`: five canned as-of questions). Rule, pre-registered: judge-run weight and determinism are hard gates; ergonomics breaks ties. No outcome is assumed.

**Bake-off 7, structured output.** *References:* R21 (schemas default to 2020-12 in MCP), R17 (strict validation), spec 19a-7. The NVIDIA NIM structured-generation page could not be retrieved at write time, so whether the Nemotron endpoint offers schema-constrained decoding stays **NOT VERIFIED** (as the spec says). *Boundary:* `ModelRequest.responseSchema = {id, hash}` is passed to the adapter; the adapter declares `capabilities.structuredOutput: "none" | "json_schema" | "grammar"` (the register's closed set, INT-056; a provider with a bare JSON mode and no schema counts as `none` plus prompt-only JSON); validation by our schemas applies regardless (component 3); the capability and decoder parameters enter the request's `params` and therefore the effect key, so a cassette recorded with constrained decoding cannot silently replay for an unconstrained request. Model-facing schemas use the `PSP-M` form (all members required). *Protocol (`eval/bakeoff-7/`):* for each adapter and each of the ten most important output schemas (fact extraction, claim list, entailment label, link decision, policy judgement, and others named by M3 to M5), run the gold items from M11 with and without constrained decoding and report: `parseFailureRate`, `schemaFailureRate`, `validationRetryRate` (each retry is spent budget), tokens per accepted output, and the quality difference on the gold set with cluster-bootstrap intervals (M11). Decision: constrained decoding is used where it lowers retries without a quality loss whose interval excludes the pre-registered margin; otherwise prompt-only JSON plus validation. **Tests:** `SO-CAP` the capability is recorded in the manifest; `SO-KEY` a change of decoder changes the request hash; `SO-FALLBACK` an adapter without schema support still passes the contract suite through validation and re-prompt. The sampling parameters in `params` are integers (`temperatureMilli`), so the hash is stable.

**Risks / NOT VERIFIED.** Everything about NVIDIA endpoint capabilities (structured output, model inventory, quota, `max_tokens` behaviour) awaits an API key (needs from Prateek, spec section 22). DuckDB platform binary sizes are registry metadata, not measured installs.

## 7. Interfaces table

| Exposes (module path) | Consumed by | Contract |
|---|---|---|
| `Result`, `ErrorCode` registry, `digest`, `digestJson`, domain tags, ids, rng (`src/kernel`) | every module | closed registries, golden-hashed |
| `canonicalize`, `parseStrict`, `vectors/jcs/` | M9 (two verifier implementations built against the same vectors; M9's core does not import this code), M1 to M6 for hashing | JCS plus Plumbline profile (component 2) |
| `schemas/*.schema.json`, `schemas/manifest.json`, `S` builders, `validate()`, `vectors/schema/` | all modules (their own schemas), M9 (PSP interpreter must agree), M10 (MCP/A2A export), M14 (response schemas) | PSP rules, pinned strict validator |
| Ports and adapters: `ModelPort` (with `capabilities`, `canonicalRequest`), `ToolPort`, `StorePort` (+ `MemoryStorePort`), `ClockPort`, `SchedulerPort`, `HumanPort`, `LedgerPort` (`append`, `published`, `streamHead`, `appendBefore`), `IdsPort.secret`, `SyncJournal` | M1 (channels as tools), M2 (extractor as a tool), M6 (memory store mode), M10 (secret ids), M12 (Nemotron and OpenAI-compatible adapters, Zetaris `SiloPort`, Meterless engines as tools, `SyncJournal`), M14 (model profiles), M13 (broker as irreversible tool, approvals) | components 4, 5, 15 |
| Declared here, implemented elsewhere: `NetPort` (M8 `ports/egress.ts`), `FsPort` (M7 adapters), `SandboxPort` (M8 backend selection; M2 DocWorker client), `SignerPort` (client of M9's signer), `KeyPort` and `AuthorizePort` (M13) | M1, M2, M8, M9, M12, M13 | component 4; register section 2.2 |
| Tenant (`TenantCtx` on every `CallCtl`, `Slot.tenant`, tenant-prefixed names) | every module | components 4, 5, 6, 15 |
| Interceptor chain `[schema, kill, egress, capability, budget, port, record, label, ledger, trace]` | M8 (kill, egress, capability, labelling, restrict-only), M9 (ledger leaves) | components 4, 5 |
| `ctx` (`model`, `tools`, `clock`, `rng`, `ids`, `ledger`, `net`, `fs`, `sandbox`, `authorize`, `tenant`, `emit`, `budget`; a step sees only the ports its `effects` declares) and `Step`/`GraphDef`/`compileGraph` | M3, M4, M5, M6, M13, M14 (roles are steps) | components 8, 9 |
| `Gate`, `Proposal`, `Approved`, `isApproved`, `approvedFromState`, `runContract` | M5 (selective release, autonomy gate), M8 (restrict-only gate), M13 (broker accepts `Approved` only), M6 (memory write approval) | component 10 |
| Budget API (`reserve`, `settle`, `split`, phases, `remaining()` view) | M14 (cost-aware routing), M10 (live view), M11 (budget report) | component 7 |
| WAL, cassette export, `RunManifest`, `traceDigest` | M9 (bundle: `replay/cassette.jsonl`, `trace/*.jsonl`, predicate), M11 (replay corpus), M10 (CLI replay/resume) | components 6, 11, 16 |
| The one trace schema (`prevLineHash`, `tenant`, `phase`, `agent`, `verb`, `decider`, `why_kind`, `budget`), `subscribe()`, `trace-lint`, OTLP projection | M10 (`UiTraceEvent` is this type), M11 (metrics, golden traces), M9 (hash chain, `why_kind` lint), M14 (event types registered as verbs) | component 14 |
| `CertificateEnvelope` (`outcome: CertOutcome`, `checks[].result: Verdict`), `sealCertificate`, `checkEnvelope` | M4, M5, M6 (payloads), M9 (verifier copies the envelope check) | component 16 |
| PSP spec, vectors and the reference interpreter `src/kernel/psp.ts` | M9 (copied into the verifier core and re-implemented), M10 (browser) | component 3 |
| Human interface: `respond`, `tick`, `Interrupt` (in-run questions only) | M10 (in-run prompts), M13 (approver auth; case approvals are M13's state, not interrupts) | component 13 |
| `SubstrateDriver`, `RC`, `PaySim`, broken drivers, `bakeoff:report` | M11 (reports), spec section 19a decision record | component 17 |
| `plumbline-sim` worlds, invariants, corpus | M11 (CI), every module (their fault scenarios plug into `SimWorld`) | component 18 |
| `replayStages`, `pureClosure`, mutation catalogue format | M3, M4, M5 (deterministic stages), M11 (sensitivity metrics) | component 19 |
| Profiles, `createKernel`, kernel `doctor` | M10 (CLI `run`, `replay`, `doctor`), M12 (sponsor profile), M1 (channel doctor) | component 20 |
| `StorePort` boundary, `TablePort` rule, model `capabilities.structuredOutput`, bake-off 5 and 7 protocols | M1 (raw tables), M11 (reports), M12 and M14 (adapters, schemas) | component 21 |

## 8. Spec feedback

Status after integration pass 2: each item is marked with the register item that resolves it (the spec edit itself is pending in the register) or **Open**. Items 15 to 18 were found in this pass.

1. **Ports list is incomplete.** Spec section 4 names "model, tools, clock, rng and ids". The sim, the WAL, the ledger and humans need `scheduler`, `store`, `ledger` and `human` as ports, and `rng` is better as a kernel service derived from the seed (not recorded). Propose editing section 4. **Resolved by INT-056**: the full port set is component 4; the spec section 4 edit is pending.
2. **Who owns the write-ahead effect log.** Section 4 lists "checkpoint and resume with a write-ahead effect log" under the substrate and "effect keys and idempotency" under the effect layer. The log must be ours (otherwise a substrate swap changes idempotency); this blueprint assigns the WAL to the effect layer and only control state to the substrate. Propose moving the phrase to the effect-layer list; the WAL must exist before bake-off 1 (spec step 3), not at step 5. **Resolved by INT-057** (a): the WAL belongs to the effect layer and is built in step 3 (register section 5, V1).
3. **Typed state and commits** are listed under the substrate; this blueprint makes `commit` a pure kernel function every substrate calls (G3, G4, G6 depend on it). Propose moving it to the kernel list. **Resolved by INT-057** (b): `commit` is a pure kernel function every substrate calls.
4. **Cassette keying wording.** Section 4 says cassettes are "keyed by effect hash"; 13 §4.4 and this blueprint key by slot `(branch, step, instance, n, port, op)` and compare the request hash, because identical requests with different answers (retries) would collide under a content-only key. Propose "keyed by effect slot with request-hash verification". **Resolved by INT-042**: the spec wording becomes "keyed by effect slot with request-hash verification"; the two layers of `source.fetch` are in components 5 and 6.
5. **Verdict vocabulary conflict is still open** (XPL-07): section 9 uses PASS/INVALID/INCONCLUSIVE; section 13 uses PASS/FAIL/INDETERMINATE (and NOT_APPLICABLE). Propose one vocabulary (section 13's) with the mapping used in component 16. **Resolved by INT-001**: two vocabularies, `Verdict` for the verifier and `CertOutcome` (`VALID | INVALID | INCONCLUSIVE`) for the producer (component 16).
6. **`Why.kind` has no human value** (`rule | computed | model_reported`). Human approvals and denials need a representation; this blueprint maps them to `rule` with `ruleId "human.<kind>"` and carries the approver's text as an untrusted note. Propose adding `human_reported` if M13 wants approver rationale to be first-class. **Resolved by INT-002**: `human_reported` is a fourth `Why.kind` for free text; structured human decisions are `rule` with `ruleId "human.approval.<code>"` (component 14).
7. **"No effect without a leaf" (13 §5) is ambiguous.** Not every effect is a ledger event. Propose: every ledger-relevant effect has a leaf, every leaf has a WAL origin, and every effect is covered by the `run.manifest` leaf through the cassette digest. **Resolved by INT-049**: accepted as written (component 15, "What gets a leaf").
8. **Offline verifier core is "zero dependency" (section 13) but must validate bundle members against schemas (section 4).** Spec is silent. Propose a named restricted dialect (PSP) with a tiny interpreter in the verifier core, differential-tested against the pinned validator on shared vectors. **Resolved by INT-051**: PSP, its vectors and a reference interpreter are a deliverable of component 3.
9. **Replay classes versus F-SAMPLE.** Section 21 F-SAMPLE asks for an input-sensitivity test in replay; section 15 says replay on another input is a miss. Component 19 reconciles them with the pure-closure rule, which has a consequence the spec should state: input sensitivity of model-bearing stages cannot be shown in replay. **Resolved by INT-044**: the consequence is stated in components 6 and 19 and goes into spec section 21 F-SAMPLE.
10. **Bake-off 1 candidates.** Section 19a names three. On the evidence read, Temporal fails the judge-run screen (testing package downloads a server; worker pulls webpack and swc), so the screen should be pre-registered; XState passes the screen and is not named. Also, bake-off 1 needs the WAL, the harness and the broken drivers, which the spec's step 3 (cassette) does not yet include. **Resolved by INT-057** (e, f) and register section 5 (V1): the screen is pre-registered, XState is the fourth candidate, and the WAL, harness and broken drivers are step 3 deliverables.
11. **Budget guarantee is conditional.** Section 4 says budgets are "reserved before each call"; soundness depends on an estimator upper bound and on the provider enforcing `max_tokens`, neither verified for the NVIDIA endpoint. The guarantee-boundaries table (section 9a) has no budget row; propose one stating the condition. **Resolved by INT-058** and the guarantee-table row "Budget soundness": the condition and the reasoning-token cap are in component 7.
12. **Section 4 says traces align with OpenTelemetry GenAI conventions "at a pinned version"** while 13 §4.3 records they are at Development status and moved once; the golden-trace test and `semconv_version` field are the control, and the spec should say the projection is best effort. **Resolved by INT-054**: the projection is best effort with `semconv_version` recorded; the JSONL trace is the source of truth.
13. **Normalised trace is undefined** in section 4 ("same normalised trace"). Component 14 defines it; the spec should reference the definition. **Resolved by INT-054**: component 14 defines the normalised trace; the spec references it.
14. **Structured control flow.** The graph model (series-parallel with bounded loops) is a restriction not stated in the spec; section 4's "graph scheduling with bounded cycles" does not exclude richer graphs. Propose stating it, with the extension rule that a pack needing more extends the compiler and its dominance analysis. **Resolved by INT-057** (d): the series-parallel restriction and its extension rule go into the spec.
15. **`Commitment` preimage has no delimiter** (INT-003: `SHA-256(salt || domain tag || value)`). With a closed tag registry this is safe only if no tag is a prefix of another; component 1 adds that as a registry test, but the register should either add a delimiter or state the rule. **Open**, owner: conventions file.
16. **`ids.secret` is "recorded in `record`" (INT-056)**, which would put an MCP handle into a cassette that is committed and bundled. Component 4 records a `Commitment` only and returns a fixed test value in replay; any state key derived from the secret differs between record and replay and must be excluded from the state hash. **Open**, owner: M10 and the register.
17. **Wire calls inside a tool effect.** INT-020 and INT-042 make `ctx.net` the one network port and M1's transport cassette the layer-2 record, but do not say whether a `net.send` inside a tool adapter is a slot of its own. Component 4 treats it as part of the enclosing effect (the enclosing record owns the slot and the reservation; the wire call still passes `kill`, `egress`, `capability`). **Open**, owners: M1 and M8.
18. **Register versus register.** INT-018 names the pre-act leaf `release.intent`; INT-049 renames it `action.intent`. Component 15 uses `action.intent`. **Open**: the register text of INT-018 should be corrected.

## 9. What this blueprint does not cover

- **No code was built or measured.** Every performance, size and soundness statement is a hypothesis with a named test. The only execution during writing and integration was the 25-line canonicaliser draft on six public vectors, a throwaway script that recomputed the twelve own vectors and the digest-kind vectors under the `jcs:` preimage (the script's reproduction of the twelve first-draft digests matched, then the new values were taken from it), and metadata and page reads; the digests in the vector tables must be re-derived by the real implementation and the second one.
- **LangGraph.js, XState and Temporal behaviour under crash, resume and kill** was read in source or metadata, not observed. LangSmith default export, `checkpoint-validation` applicability, XState snapshot semantics, TypeBox 1.x with Ajv strict mode, the Ajv 2020-12 module path, OTLP/JSON field names, NTFS rename and flush behaviour, `max_tokens` enforcement and reasoning-token accounting on the NVIDIA endpoint, tokenizer properties of Nemotron models, and the xoshiro reference vectors are all **NOT VERIFIED**.
- **Surfaces and states not exercised by this design's tests:** power loss on real disks; multi-process concurrent runs sharing one ledger (single process per case is assumed); more than one tenant (the judge path runs `tn_default`; tenant isolation is tested only against the sim adapters, `PORT-TENANT`, `LED-TENANT`, I17); the real `NetPort`, `SandboxPort`, `SignerPort` and `KeyPort` implementations (declared here, exercised against sim adapters); hosted-endpoint streaming; distributed or remote execution; database checkpoint backends; arbitrary (unstructured) graphs; an adversarial step that bypasses the ports (JavaScript cannot sandbox a step; the control is lint, AST tests and replay stubs, not isolation); key custody and signing (M8, M9); identity of approvers (M8, M13); policy semantics of `finalize` (M5, M13).
- **Not designed here:** the content of trace `Why` templates for product rules (each module), the Merkle ledger and verifier (M9), the leaf registry (M9 §5.4 owns it; this module exports it as `schemas/leaf-types.json`), the trace-verb registry's members (taken from M10 and M14), the console (M10), the agent roles and prompts (M14), the second domain pack's runtime needs (spec 14a), scale and capacity (spec 21c-6), localisation.
- **Open decisions that need an owner:** the pre-registered thresholds of the bake-off (install weight, tie tolerance) and the decision record in `docs/DECISIONS.md` after the run; the decisions on spec feedback items 15 to 18 above. (XState is the fourth candidate and `Why.kind` has a fourth, human, value; both settled by the register.)

## Pass 3 resolutions (2026-10-13)

Source: `99b-integration-register-pass3.md` (INT-101 onward). These bindings override the body above wherever they differ; the body has not been rewritten. Each line is one binding change; the register item holds the reason and the other modules affected.

- **INT-101.** `digest*` never constructs `TreeHash`; the parser rejects a `tlog:` value in a `RawHash`, `DocHash` or `Commitment` field and the reverse. `Hash` is the union of four.
- **INT-102.** Add `pathOf(h)` (`<kind>/<hex>`) and the stream/audience path-segment rule; store, WAL, cassette and blob names use it; lint `PATH-COLON` and a Windows CI run.
- **INT-103.** Implement the single `Commitment` layout `com:` + hex SHA-256(tag || 0x0A || u32be(len(ctx)) || ctx || salt[32] || value); add `schemas/domain-tags.json` (tag, `valueEncoding`, `ctx` rule, `saltScope`) golden-hashed; keep existing tag spellings; update the K-COM vectors; add tags `plumbline/account/v1`, `plumbline/span/v1`, `plumbline/field-span/v1`, `plumbline.approval-challenge/v1`.
- **INT-109.** The trace line field `profile` is renamed `runKind` (same value set); `modelProfile` and `disclosureProfile` stay. Run start asserts `disclosureProfile: offline` implies `modelProfile: local` or `mode: replay`.
- **INT-110.** Runtime acceptance tests are cited `M7-T1` to `M7-T8` outside this file.
- **INT-124.** Component 19: document analysis is class A replay; the miss message prints the live command.
- **INT-130.** Component 4 port list gains `ApprovalPort` (`ctx.approvals`): `submit`, `get`, `list`; M13 implements it.
- **INT-133.** Component 15 "what gets a leaf": `fact.asserted` and `claim.verified` are not leaves (stage outputs are `stage.committed`); `memory.written` is `memory.head`; `release.intent` stays retired in favour of `action.intent`.
- **INT-134.** Register `E_LEDGER_FENCED` (a stale writer epoch); `E_LEDGER_LOCKED` still means the lock is held.
- **INT-140.** The model-call reservation for link judgements is `LinkConfig.maxModelCallsPerCase` times the per-call cap.
- **INT-148.** `ModelPort.canonicalRequest` de-aliases per-run span aliases to canonical ids and drops the nonce, so a model effect's `reqHash` is alias-independent.
- **INT-149.** `NetPort.send` is one exchange, redirects off, returns `remote: {address, port}` instead of `hops`; `CallCtl` gains optional `net: NetPolicy { allowedHosts, denyRanges, resolveOnce, pinned? }`.
- **INT-150.** The unit recorded and keyed is the effect; wire calls inside it pass the interceptor chain but are not slots, and replay serves the effect without any wire call.
- **INT-151.** `ids.secret` is not an effect and is never recorded: fresh CSPRNG in `live` and `record`, seed-and-ordinal derived in `replay`; state holds the issue ordinal and the state hash covers the ordinal. INT-056's "recorded in `record`" is withdrawn.
- **INT-152.** Every emitted event type needs a verb in `schemas/trace-verbs.json` with its phase and agent lane; new lint `TL19` fails on an unregistered verb. Other modules add their verbs when their build step runs.
- **INT-153.** Component 3: the MCP client is M1's, not M12's.


> v5.2 (D-026): profile-pass additions for this module are in `98-profile-pass-additions.md` (adoption register ids; they win over this blueprint where they differ).
