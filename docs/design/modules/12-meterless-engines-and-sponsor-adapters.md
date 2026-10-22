# Module 12: Sponsor Adapters and Evidence (Meterless Engines, Zetaris, NVIDIA)

## v5.1 alignment (2026-10-15, spec section 0 wins where this blueprint disagrees)

- Zetaris is the centre of the data path; the product must run on Nemotron; both Zetaris and Meterless must run locally (Setup Guide, D-018). Meterless as the Nemotron route (guide Option A) with NVIDIA's free API as fallback (Option B); Meterless prompt library for the Cursor build only (D-024).
- First sponsor milestone is build step 9a: Zetaris connection test, a Meterless runner run, and a Nemotron route test. Meterless route details are placeholders in the guide and remain unknown.


## Integration revision (2026-10-13)

Source: `99-integration-register.md` (pass 2). Applied in place; sections the register does not touch are unchanged. The file name is kept; the module row is renamed "Sponsor adapters and evidence" (INT-062 g).

**Applied.**
- INT-016: the release capability is one `ExecutionContract` (`act/po.release`, `scope.release: ReleaseBinding`). M12 owns the container, `verifyContract`, `consume` and the refusal vocabulary; M8 owns the binding contents and minting policy; M13 owns the broker, `NonceStore` and execution-time re-validation. Signed as DSSE over JCS (the `"plumbline/contract/v1\n"` bytes remain for HMAC conformance only); one verification order, atomic consume last; `aud` carries tenant, adapter and restore epoch; `ConsumedWal` becomes M13's `NonceStore` (C5.4, C5.5, Interfaces).
- INT-016 and M8 F3 (timing): the run contract (Scout `decide`, issued at intake, no `act/`) and the release contract (minted after the last approval, TTL from minting) are two instances of one type; `decide` never mints a release contract, which has no `parentId` (C5.4).
- INT-017: `ProcessSigner` is the client of the M9 signer under role `capability`; M12 runs no signer process (C5.4).
- INT-009: new C11a, `dataClassMap.json` (foreign class to spec class; unmapped is `internal-sensitive`; lock-file input to M8 C10).
- INT-010: floats only in memory; named scales `Ppm`, `Milli`, `MinorUnits` in every persisted, hashed, signed or recorded form (cross-cutting rule d, C2, C3, C5, Spec feedback 2).
- INT-019: C11 arms are named by the M8 `CompartmentBackend` (`os-netns`, `node-net-permission`, `node-flags-only`); "network denied" appears only next to the probed backend; the in-process guard is a second control and never the claim.
- INT-020: egress declarations use M8's `EgressEntry`; `profile` is renamed `modelProfile`; adapters call `ctx.net` (C11, C13, C14).
- INT-056 and INT-058: `SyncJournal` is an M7 port (signature per register section 2.2, tenant-prefixed stream ids); `ContractGuard` is the `capability` interceptor in M7's chain; the NVIDIA adapter provides `capabilities`, `reasoningCapTokens` and `canonicalRequest`, and cassettes are M7's (C14).
- INT-042: C14 cassettes are M7's slot-and-request-hash records; the adapter supplies `canonicalRequest` and the response fields (`E_CASSETTE_MISS` is `fatal`).
- INT-062: (a) the measured fork-versus-spec rule with from-spec as tie default is confirmed and cross-referenced (C6.4); (f) R-WM1 to R-WM4 and the H-MEM and Markovian hooks of M6 SF7 and SF9 enter bake-off 6 as S1 clauses (C6.4); (b), (c), (d), (e), (j) confirmed unchanged (C3.4, SF6 to SF8, SF11, C1.4); (g) Cursor is an evidence trail owned by the submission kit (C15); (h) the Zetaris audit-log cross-check is MAYBE (C13); (i) NVIDIA "OpenAI-compatible" stays NOT VERIFIED beyond base URL and path, and no OCR path runs through Nemotron (C14.5).
- INT-045: C13 states REST as the live path, JDBC as the record-time oracle, MCP as the fallback, cassettes as the judge path.
- M6, M3, M4 hooks (interface rows without a new INT id): H-MEM `peek` and pinned `retrieve`, explicit `entities`, `recencyAnchor`; Markovian `carryoverBuilder`; World Model pure-fold API (`fold`, `view` with explicit as-of, `foldFiltered`, `ResolverPlugin` returning `supports` and `defeats`) as M3's `FactStore` and M4's `Evaluator` need (C2.4, C3.4, C4.4).
- Consequences stated without separate edits: INT-003 (digest kinds on snapshot, ledger head, carryover), INT-018 (broker acts only after `capability.issued` is published), INT-048 (tenant prefix on journal streams and namespaces), INT-054 (engine event kinds are registered trace verbs).

**Named by the register, deliberately not applied.**
- INT-056 ports other than `ctx.net`, `SyncJournal`, `SignerPort` and the `ModelPort` additions (`KeyPort`, `AuthorizePort`, `SecretIdsPort`, `MemoryStorePort`, the kill-state interceptor itself): no M12 component uses them; the engines persist through `SyncJournal` and the M6 log is M6's.
- INT-048 beyond the prefixes and `ReleaseBinding.tenant`: per-tenant ledger trees and key hierarchies belong to M9 and M13.
- INT-017 `KeyPort` and the per-role policies of attestation, control and erasure: M9, M8 and M13.

**New contradictions found.**
1. Payload type: M8 fixes `application/vnd.plumbline.release-capability+json`; with one object the constant must name the contract. This blueprint uses `application/vnd.plumbline.execution-contract+json`; M8, M9 and M13 must adopt it.
2. INT-017's role set has no role for contracts without `act/` (run contracts); the `capability` role demands an `approval.granted` proof. Proposed: a `run` role in M9's set whose policy refuses any `act/` capability; until then an in-process `Ed25519Signer` under a registry family `run`, which `verifyContract` refuses for `act/`.
3. M7 (component 3) and M8 (C10) say M12 owns an MCP client; this blueprint has none and INT-045 leaves the MCP fallback in M1. Proposed: M1 owns it; M7 and M8 wording changes.
4. M3 states product views are order-independent over the event multiset; this blueprint's earlier text made closure and winners arrival-ordered. Resolved with two profiles (C3.4); M3 must confirm that closure of single-valued edges in its views is by valid time.
5. `NonceStore.consumeAndRecordIntent` (M13) is synchronous; this module's `appendIntent` was a Promise. M13's shape is adopted.

Status: design blueprint, 2026-10-13. Refines spec v3.1 sections 11, 12, 15, 18, 19 and 19a (bake-offs 6 and 7). Nothing here is built; every design claim is a hypothesis with a named test; unverified items are marked **NOT VERIFIED**.

**What was read, and what was run.** Evidence tags: **[R]** read in the code of the local clone `research/sponsor-reference/Meterless` (commit `0aa7417`); **[B]** taken from `docs/sponsors/meterless-engines-engineering-brief.md` or `meterless-docs-readout.md` without re-reading the source; **[C]** computed by a throwaway re-implementation of a documented formula (not by running Meterless code); **[F]** a web page fetched on 2026-10-13. Read in full by me: the four conformance entry points (H-MEM, World Model and Markovian runners, the Scout eval runner), `vectors.json`, `thresholds.yaml`, the Scout fixture registry and corpus files, `execution-contract.md`; H-MEM reference `memoryStore`, `memoryRetrieval`, `embeddings`, `trustLedger`, `sleepCycle`, `conflictDetection`, `dreaming`, `memoryMining`, `index`; World Model reference `store`, `resolve`, `ingest`, `stableIds`, and the write paths of `index`; Markovian reference `orchestrator`, `carryover`, `markers`, `configManager`, `promptBuilder`. Not re-read (brief-sourced): the `AGENTS.md` and `docs/` prose, World Model `types.ts`, Markovian `history`/`progress`/`types`, all examples and workshops. **Nothing from Meterless was executed**; the only computations are in section C3.2 and are labelled [C].

## 1. Scope and contract

**Job.** Make the four Meterless engines (H-MEM, World Model, Markovian, Scout Intent) real, owned, load-bearing components of Plumbline and prove it; and provide the edge adapters for the other sponsors (Zetaris sponsor edge, NVIDIA Nemotron `ModelPort`; Bright Data as a documented non-goal). The Cursor evidence trail is specified here but is evidence, not an adapter, and is owned by the submission kit (C15).

**Inputs.** Engine specs and the vendored conformance runners; ports from M7 (`ctx.clock`, `ctx.ids`, `ctx.model`, `ctx.tools`, `ctx.net`, `SyncJournal`, the signer client); typed values from M3, M6, M8, M13.

**Outputs.** (1) Four engine packages with the exact exports the runners load; (2) vendored unmodified runners with provenance; (3) extended clause suites, a differential oracle, inert-stub and mutant controls; (4) per-engine ablation profiles; (5) a generated engine-usage map; (6) local-first and egress tests and `dataClassMap.json`; (7) upstream drafts; (8) sponsor adapters and evidence; (9) the `ExecutionContract` container with its verify and consume rules, the only release capability (M8 supplies the binding contents and minting policy, M13 the broker and nonce store).

**Depends on:** M7 (ports, cassettes, canonicalisation, trace), M8 (labels, `Approved<T>`, `ReleaseBinding`, egress manifest, compartment backends), M9 (signer process, DSSE and JCS code, key registry), M1 (channels, Zetaris client), M13 (`NonceStore`). **Depended on by:** M3 (World Model store behind `FactStore`), M4 (pure folds for V(S)), M6 (H-MEM, Markovian), M9 (ledger head leaves), M10 (usage map, review panels), M11 (ablation and clause harness), M13 (contract verification and consume), M14 (model profiles).

**Repository layout (proposed).**
```
src/engines/{hmem,world-model,markovian,scout}/index.ts   conformance facade: exactly the exports the runners load
src/engines/<engine>/core/**                               implementation (no network or fs imports except the journal port)
src/sponsors/{zetaris,nvidia}/                             edge adapters
policy/dataClassMap.json                                   foreign data class to spec class (C11a)
third_party/meterless/**                                   vendored runners, unmodified, with LICENSE and PROVENANCE
tests/engines/<engine>/clauses/*.test.ts                   extended clause suites (one id per clause)
tests/engines/{oracle,inert,mutants,ablation}/**           controls
profiles/{baseline,full,ablate-world,ablate-hmem,ablate-markovian,ablate-scout}/
scripts/meterless-*.ts, scripts/engine-usage-map.ts, scripts/cursor-evidence-check.ts
```

## 2. Component list

| # | Component | Spec anchor |
|---|---|---|
| C1 | Vendored runners, provenance and the conformance harness | 12, 19 |
| C2 | H-MEM engine (with pinned retrieval and bitemporal-aware precedents) | 11, 12 |
| C3 | World Model engine (event-sourced, bitemporal, external-key ids) | 8, 11, 12 |
| C4 | Markovian engine (typed carryover, ratify, measured tokens) | 11, 12 |
| C5 | Scout Intent engine and the single capability mechanism | 5, 12, 14a, 19 |
| C6 | Engine strategy protocol (bake-off 6) | 19a-6 |
| C7 | Differential oracle against the official reference | 12 |
| C8 | Test integrity: inert stubs and mutants | 19 |
| C9 | Per-engine switch-off ablations | 12, 21a |
| C10 | Generated engine-usage map | 19 |
| C11 | Local-first proof and the egress manifest as executable tests | 5, 19 |
| C11a | Data-class map (`dataClassMap.json`) | 5, 19 |
| C12 | Upstream feedback and the community eval | 19 |
| C13 | Zetaris sponsor edge | 6, 19 |
| C14 | NVIDIA Nemotron `ModelPort` adapter (bake-off 7) | 15, 19, 19a-7 |
| C15 | Cursor evidence trail (evidence, not an adapter; owned by the submission kit) | 18, 19 |
| C16 | Bright Data (documented non-goal) | 19, F-BOUNTY |

Cross-cutting design rules for C2 to C5: (a) the **conformance facade is synchronous where the runner is synchronous**, and everything that needs I/O is a separate async method; (b) **engines import nothing that can reach a network**, enforced by an import-graph test (C11); (c) **engines never read `Date.now`/`Math.random`**; clocks and ids are constructor-injected, defaulting to counters in the facade so the runner is deterministic; (d) **floating point exists only in memory** (scoring, ranking); no hashed, signed, recorded or cassetted document contains a non-integer number (INT-010). Persisted forms use the shared named scales: confidences and ratios are `Ppm`, contract confidences and scores `Milli`, amounts `MinorUnits` (decimal string); journal and ledger lines, snapshots, signed contracts and trace events obey this, while the runner-facing record objects may expose floats through accessors; (e) engines emit `engine.call` trace events through an injected `trace` callback (C10) and know nothing of M7; the event kinds are registered in M7's trace verb registry (INT-054); (f) journal stream ids and World Model namespaces are prefixed `tn_<id>/` (INT-048; `tn_default` on the judge path).

---

## C1. Vendored runners, provenance and the conformance harness

### C1.1 Best references
- `Meterless/Meterless`: 249 stars, Apache-2.0, not archived, pushed 2026-07-24; `main` HEAD `0aa7417` (2026-07-22); release `v1.0.6` (2026-07-21); one open issue (#3, H-MEM `supersedes`); Discussions enabled (`gh api`, 2026-10-13). The local clone's `git describe` prints `v1.0.5` (nearest reachable tag), the release list says `v1.0.6`; the pin that matters is the commit.
- Evidence of what a conformance suite proves: the runners themselves (C1.2).

### C1.2 What they actually do
Each of the three runners loads one module by `import(pathToFileURL(path.resolve(IMPL)).href)` and exits 0 (all pass), 1 (any fail), 2 (cannot load) **[R]**. Required exports: H-MEM `HMEM`; World Model `WorldModel`, `entityIdFromName`, `normalizeName`, `decide`; Markovian `Markovian`, `modelTotals`, `runEfficiency` (the first check looks for them by `typeof`). The Scout runner is an eval gate, not a conformance runner: `pathToFileURL(implPath)` **without `path.resolve`**, so the path must be absolute; it needs `yaml` resolvable from the runner's location; and it writes `evals/reports/latest.md` next to itself on every run **[R]**. The H-MEM runner reads `vectors/vectors.json` relative to itself.

**Per-engine conformance surface (the contract our facade must satisfy).**

| Engine | Exports | Sync (called without `await`) | Async | Live-object identity |
|---|---|---|---|---|
| H-MEM | `HMEM` | constructor `{clock}`; `add`, `feedback`, `query`, `store.get/all`, `sleep.preview/execute`, `conflicts.scan/autoResolve`, `ledger.history`, `dreaming.dream/approve` **[R]** | none | `add()` returns the stored object; ro-001 assigns `.supersededBy` on it and expects ranking to honour it; a clone breaks it **[R]** |
| World Model | `WorldModel`, `entityIdFromName`, `normalizeName`, `decide` | pure functions; `stateShapeCanonical()`, `audit()`, `view("graph").neighborsOf` | `upsertEntity`, `relate`, `ingest` (awaited; a sync throw or a rejection both satisfy prov-001) | not required; `neighborsOf` returns objects with `.id` |
| Markovian | `Markovian`, `modelTotals`, `runEfficiency` | constructor validates and throws (cfg-001, ovl-001 inspect the constructor) | `run()` | not required |
| Scout | `Scout` | constructor `{intentRegistry: absolute path, policyPack: string[]}` | `decide()` | n/a |

Two traps hidden in the runners **[R]**: (1) World Model bitemp-001 uses dates in 2087/2088 and queries "now" with no `at`: "now" must mean **the open edge set**, never "valid at the injected clock" (clock 2026 would see both edges as future and fail); the product needs both (`at` omitted = open edges; `at: ctx.clock()` = valid now). (2) Markovian ref-001 runs with `reflect` defaulted on, so the generator is called a second time for reflection and that call throws; the engine must swallow it.

### C1.3 Decision
**Adopt** the runners unmodified as vendored test assets (no alternative: they are the sponsor's definition of done). **Own** the harness around them.

### C1.4 Implementation design
**Vendored set** (copied byte-for-byte; blob SHAs are git blob hashes of the files at `0aa7417`, computed by `git hash-object` on the local clone **[R]**):

| Path under `third_party/meterless/` | Blob SHA |
|---|---|
| `LICENSE` (identical to upstream root and `engines/hmem/LICENSE`) | `d1a6bb88af6e6b79738dd192fb491a99eb2a7fe3` |
| `hmem/conformance/runner.ts` | `dab4c66cac7d50542f73f5484980149072623c86` |
| `hmem/conformance/vectors/vectors.json` | `776b6b6e808e82d25b110db4029b3d24f5eb7dcb` |
| `world-model/conformance/runner.ts` | `d4e26f7901b8d5b51cc586b32d2d1aaf2a628ee3` |
| `markovian/conformance/runner.ts` | `0d0befbb30e7c86af5da480ecbfd89c68691116b` |
| `scout-intent/evals/runner/index.ts` | `779dec70f3d6fcac7b218343684ec64884074d7b` |
| `scout-intent/evals/config/thresholds.yaml` | `c7fb307c2681ac25809ec56b3ae0e06dd419e281` |
| `scout-intent/evals/fixtures/intents.json` | `d7c8cab620d37c3aa18aeb8accffc8ebace87c89` |
| `scout-intent/evals/regression-set/v1/injection/adversarial.jsonl` | `ca3dc0af2af9c36a4c7a624b9cd78e4d66cd0361` |
| `.../intents/deal.jsonl`, `email.jsonl`, `research-and-plan.jsonl` | `95f65526...`, `81e05f10...`, `55d132bf...` (full 40-hex values in `PROVENANCE.json`) |
| `.../multi-intent/composed.jsonl`, `.../edge-cases/clarification.jsonl` | `3e04f9f1...`, `4ed9b2a2...` |

(The corpus totals 32 lines: 4 clarification + 10 injection + 6 + 4 + 5 intent + 3 multi-intent **[R]**.) `PROVENANCE.json` records: upstream URL, commit, per-file blob SHA, retrieval date, "unmodified". `PROVENANCE.md` is the human form and states that the upstream tree has **no `NOTICE` file** **[R]**, so Apache section 4(d) imposes no NOTICE carry-over, that the harness files carry no copyright headers, and that Plumbline's own repository is Apache-2.0 (`package.json`), which is compatible.

**Byte integrity rules (a real hazard on a Windows development machine).**
1. `.gitattributes`: `third_party/meterless/** -text` so Git never rewrites line endings; otherwise the blob hash changes on checkout and the provenance claim is false.
2. `.gitignore` exception: the repository ignores `*.jsonl` (line 17 of `.gitignore`, with `!output_examples/traces/*.jsonl`), so add `!third_party/meterless/**/*.jsonl`; keep `research/` ignored.
3. `scripts/verify-vendored.ts`: recompute `sha1("blob " + byteLength + "\0" + bytes)` for each file and compare with `PROVENANCE.json`; fail on any mismatch, extra file or missing file. Optional online step (`--upstream`): `gh api` the tree at the pinned commit and at current `main`, report drift without failing (upstream drift is information).
4. The Scout runner mutates its own tree (`reports/latest.md`). `scripts/meterless-conformance.ts` therefore copies the vendored tree to a scratch directory, runs the copy, and never executes in place. `yaml` becomes a root devDependency (the runner imports it; Node resolves it by walking up from the runner's directory).

**Harness** `scripts/meterless-conformance.ts [--engine hmem|world-model|markovian|scout] [--target ours|reference|inert|mutant:<id>]`:
```ts
interface ConformanceRecord {
  engine: string; target: string; runnerBlobSha: string; implPath: string;   // repo-relative
  nodeVersion: string; tsxVersion: string; ourCommit: string;
  exitCode: 0 | 1 | 2; stdout: string; checks: { id: string; status: "PASS" | "FAIL"; detail?: string }[];
}
```
It sets `HMEM_IMPL`/`WORLD_MODEL_IMPL`/`MARKOVIAN_IMPL`/`SCOUT_IMPL` to absolute paths, runs `npx tsx <runner>` as a child process, parses the scorecard lines (`PASS|FAIL <id>`), and writes `output_examples/meterless/conformance-<engine>.txt` with the record header. A transcript of the **reference** is stored under a different filename prefix (`oracle-`) and the README never presents it as ours (brief section D "do not show").

Two checks the harness adds that the runners cannot make: (a) **expected check count** (13, 8, 8; the Scout run must report 32 loaded examples and **zero `Skipped` lines**, since the runner drops throwing prompts from denominators **[R]**), so a runner that silently loads fewer checks fails; (b) **loadability smoke** against a minimal stub before any engine exists, to confirm `npx tsx` resolves our `.ts` module graph the way the runner loads it (the brief lists this as NOT VERIFIED).

### C1.5 Tests and acceptance
`VEND-1` hash verification passes; `VEND-2` mutate one byte of a vendored file, `verify-vendored` fails; `VEND-3` CRLF-convert a vendored file, it fails (proves the `-text` rule matters); `CONF-1` each runner exits 0 against `ours`; `CONF-2` each exits non-zero against `inert` (C8); `CONF-3` check counts equal 13/8/8 and Scout skipped = 0; `CONF-4` the transcript header matches the current commit (stale transcripts fail CI).

### C1.6 Risks and NOT VERIFIED
No runner has been executed on this machine. `tsx` resolution of NodeNext `.ts` imports from a runner-loaded module is unconfirmed. Upstream may change after 2026-07-22 (re-check before submission). Whether vendoring the Scout corpus `.jsonl` (labelled a smoke set by its README) into our repository raises organizer-originality questions: it is declared pre-existing third-party material in `docs/submission/pre-existing-components.md`.

### C1.7 Build notes
First engine-related work item, before any engine code: vendor, verify, write the stub-load smoke. It unblocks C2 to C5 and C8.

---

## C2. H-MEM engine

### C2.1 Best references
- Meterless H-MEM spec and reference (Apache-2.0), the contract being implemented **[R]**.
- `mem0ai/mem0` (67,114 stars, Apache-2.0, pushed 2026-10-12) and `letta-ai/letta` (25,119 stars, Apache-2.0, pushed 2026-09-10): general agent-memory systems, reviewed in `prior-art/05` and `11`; metadata verified here, behaviour not re-read. They update memory by an LLM choosing add/update/delete in the write path; `prior-art/11` §10.2 rejects that for us.
- `getzep/graphiti` (31,710 stars, Apache-2.0): temporal knowledge graph, used by spec as a **behavioural baseline** for bitemporal tests, not a second store (spec 19a rejection list).
- Benchmarks `prior-art/11` §9: LongMemEval, MemoryAgentBench, HaluMem. Sanity checks only (spec 17); LoCoMo unfit.
- Bitemporal semantics: XTDB (3,081 stars, MPL-2.0; `prior-art/07` §3.1) and Fowler, "Bitemporal History" (2021-04-07, **[F]**: "actual" and "record" history, the two axes behind `sally.salaryAt(actualDate, recordDate)`).
- Evaluation limits: the benchmarks test conversational memory, not case-based precedent retrieval with rule-version awareness; no published result shows that precedent retrieval improves release decisions (that is C9's ablation, pre-registered).

### C2.2 What they actually do (reference, read in code)
- **Store.** `MemoryStoreService.add` is synchronous, throws on empty `source`, assigns `mem-N`, never dedupes content, runs enrichment (domain by keyword table, namespace, entities as plain strings capped at 10, `relatedTo` capped at 5 with **bidirectional backlinks written without a ledger entry or a persist of the other record**). The 64-dimension FNV-1a token hash is the embedder (`embeddings.ts`): signed hashing, L2-normalised; semantic similarity is token overlap.
- **Retrieval.** `score = clamp01(0.35 sem + 0.20 kw + 0.10 tag + 0.10 domain + 0.15 entity + 0.05 layer + 0.05 recency - 0.20 superseded) * confidence`; `query()` scores every record, filters on `chatId` only, then **calls `store.touch` and writes a `read` ledger entry for each hit** (`memoryRetrieval.ts` lines 83 to 86). `touch` raises `accessCount` and `lastAccessed`; recency is 0.05 of the score, so each read nudges that record up next time (a popularity loop **[inferred]**). `formatReinjection` emits a `[MEMORY CONTEXT]` block that includes `review`/`wrong`-tagged records (the docs say not to **[B]**).
- **Ledger.** `TrustLedgerService.log` builds `{memoryId, action, actor, timestamp, ...}`; no entry id, no hash, no range query; `history(id)` is a filter.
- **Sleep.** `preview()` is pure and returns `toConsolidate`, `toArchive`, `toSynthesize`; `execute()` stores a backup in an in-process `Map` (lost on restart), then **deletes** archived and synthesised sources (`sleepCycle.ts` lines 89 and 108). Guardrails: superseding records, derived records, hubs of 3 or more links; none for unresolved conflicts. `execute(plan)` does not re-validate `plan`.
- **Conflicts.** `scan()` is O(n squared), re-scans append duplicate conflict records; opposing pairs are five regexes; `autoResolve` uses `0.3 * lastAccessed / max(1, clock())`, which is approximately 1 for every record (the term cannot discriminate, **[R]**, arithmetic by inspection); decision confidence is `0.6 * conflict.confidence + 0.8 * margin`, gate 0.70. By hand arithmetic, cg-001 lands near 0.72 on the "resolved" branch, a margin of about 0.02 (**[C]-style hand estimate, NOT VERIFIED by execution**).
- **Supersession.** `discoverRelationships` sets `record.supersedes` when cosine > 0.85 and a correction phrase appears, and nothing ever sets `supersededBy` on the old record except `autoResolve`; conflict detection skips pairs related by `supersedes`. Upstream issue #3 reproduces this at `0aa7417` (`gh api repos/Meterless/Meterless/issues/3`, 2026-10-13).
- **Dreaming.** Cluster by `0.5 cos + 0.2 tag + 0.1 domain + 0.2 entity >= 0.35`; proposal text is string concatenation; `approve` creates a `long_term` record with `derivedFrom`, confidence 0.75.
- **Mining.** Model-free path is a regex sentence filter (20 to 300 chars, signal words, max 10); `mineDocument` with a `minerFn` sends up to 8,000 characters of document text to a model. For us that is a poisoning path (section C2.4 rule P1).
- **Runner** asserts 13 behaviours (brief, confirmed against `runner.ts` and `vectors.json`), not the arithmetic of the formula, defaults, enrichment, mining, hydration, synthesis thresholds, the 0.70 value (cg-001 accepts `resolved` or `queued`), 15 of the 17 ledger action types, restore, reinjection, scoping, privacy.

### C2.3 Decision
**Own** the engine, implemented from the spec text, constructed so the runner passes; the **reference stays the differential oracle** (C7) and the fork-versus-implement choice is decided by the measured protocol in C6, with my stated hypothesis that H-MEM goes from-spec (patch size, see C6.5). Alternatives rejected: mem0/Letta as the precedent store (LLM in the write path, no spec conformance target, no Meterless usage credit); Graphiti as a second store (two truth stores). Product-specific **extensions** are listed in C2.4 as additive; none removes a spec behaviour the runner or the spec fixes.

### C2.4 Implementation design

**Facade and construction.**
```ts
// src/engines/hmem/index.ts -- exports the runner-bound surface
export class HMEM {
  constructor(opts: { clock?: () => number; actor?: string; journal?: SyncJournal;
                      embedder?: SyncEmbedder; minerFn?: (p: string) => Promise<string>;
                      scope?: { includeUnscopedDefault?: boolean };       // spec default true; product false
                      weightProfile?: string; trace?: (e: EngineTraceEvent) => void });
  readonly store: StoreService; readonly ledger: LedgerService; readonly conflicts: ConflictService;
  readonly sleep: SleepService; readonly dreaming: DreamingService; readonly retrieval: RetrievalService; readonly mining: MiningService;
  add(i: AddInput): MemoryRecord;                         // sync; throws on empty source; no content dedupe; returns the LIVE object; explicit `entities` skip content extraction (M6)
  query(q: string, o?: QueryOpts): QueryResult;           // sync; reference-compatible (touches + ledgers reads)
  feedback(id: string, k: "helpful" | "not_helpful" | "wrong"): void;
  // product-only, additive
  snapshot(f: ScopeFilter, asOf: number): PrecedentSnapshot;
  retrieve(s: PrecedentSnapshot, q: RetrieveQuery): RetrievalResult;          // pure; the pinned form
  peek(q: RetrieveQuery & { asOf: number }): RetrievalResult;                 // pure, non-mutating read of the live store (M6's `peek`): no touch, no ledger entry, no digest
  recordRead(r: RetrievalResult, caseId: string): void;                       // ledger only, no state touch
  queryAsync(q: string, o?: QueryOpts & { embedder: AsyncEmbedder }): Promise<QueryResult>;
}
```
`SyncJournal` is an M7 port (INT-056, register section 2.2; M7 declares, `src/runtime/adapters/**` implements): `append(streamId, line: string): void` (synchronous, append-only, fsync-batched at flush points) and `readAll(streamId): Iterable<string>`; a local durable effect, outside cassettes. The default is an in-memory journal, so the runner path touches no file. Stream ids are `tn_<id>/hmem/<name>`.

**Identity and persistence.** `Map<id, MemoryRecord>` holds the live objects. Persistence is an append-only JSONL journal of ledger entries plus periodic snapshots; journal lines and snapshots are recorded documents, so confidence is stored as `Ppm` and converted at the accessor (INT-010). **Flush points** are the end of each public method and the start of `query`/`sleep.preview`. At a flush point each record's canonical hash is compared with its last persisted hash; a difference not produced by an engine method (the runner assigning `supersededBy` directly) is persisted and ledgered as `update` with `details.reason = "external_mutation"`. This honours "no mutation without a ledger entry" without freezing objects, and cannot disturb la-001 (its action list is exactly `["create","feedback"]` because that flow has no external mutation).

**Rules that implement the spec exactly (S) and the corrections to the reference (D).**
1. (S) Retrieval formula, layer weights 1.0/0.8/0.6, Jaccard of the top-8 query tokens, recency `exp(-ageDays/14)` on `lastAccessed`, threshold 0.35 on the final score, topN 5, confidence multiplies after clamping. One `scoreOne(record, features, asOf)` function serves both `query` and `retrieve`, so the two cannot diverge.
2. (S) Feedback deltas +0.05/-0.03/-0.20, clamp [0,1], `review` tag on `wrong`; `feedback` writes exactly one `feedback` ledger entry with previous and new state (la-001); `helpful` increments `accessCount`.
3. (D1) Setting `supersedes` at add time **also sets `supersededBy` on the replaced record**, ledgered as `update` (`reason: "supersedes_declared"`), and keeps the pair out of conflict detection. This is the fix for upstream issue #3 and keeps ro-001 satisfied.
4. (D2) Backlinks (`relatedTo`) are ledgered (`update`, `reason: "backlink"`) and journalled.
5. (D3) `conflicts.scan()` is idempotent: conflicts are keyed by the unordered pair and detection reason; re-scan appends nothing. `autoResolve` recency term uses age relative to a horizon (`1 - min(1, ageDays / 90)`), not `lastAccessed / clock`. Gate 0.70 on decision confidence; `queue()` returns unresolved. Manual `resolve(conflictId, "keep_a"|"keep_b"|"keep_both"|"merge")` exists; `delete_both` is not offered (tombstone via archive only).
6. (D4) Sleep: `preview()` pure and returns, per item, `{id, action, reason, guardrails[], expectedLedgerAction}`; `execute(preview)` **re-derives a fresh preview and refuses any action not in it** (execution never discovers new work, enforced, not conventional); "archive" is a tombstone (`archivedAt`, excluded from default retrieval, restorable) and synthesis marks sources `supersededBy` the synthesis record instead of deleting; backups are journalled so `restore` survives a restart. Guardrails add unresolved-conflict members and records above the confidence/access thresholds named in `docs/sleep-cycle.md` **[B]**. Product rule: `precedent` stores run with `sleep.mode = "report-only"` and `execute` throws `PolicyDisabled`; M6 uses `preview()` for reporting.
7. (D5) Reinjection excludes `review`/`wrong`-tagged records unless `strategy: "audit"`, and drops records whose `privacy` tags (`private`, `secret`, `pii`, `financial`, `work-confidential`) are not cleared by the caller's `redactionPolicy`.
8. (D6) Entities are stored typed `{name, type}` and accepted as strings on input (discrepancy 3 in the brief's register); an explicit `entities` list in `AddInput` is used as given and content extraction is skipped (M6 requirement; conformance-neutral because the runner never passes it).
9. (D7) Every ledger entry gets `id` (`led_<n>`), `seq`, and `prevDigest`; `ledger.head()` returns `{seq, digest: DocHash}` (SHA-256 chain over JCS of the entry, domain-separated). This does not make the H-MEM ledger the audit trail: M9's Merkle log is authoritative and anchors `hmem.head` as a leaf (spec 19; readout H2 rejects replacement). `range`, filter and export exist for the console.
10. (D8, product rule P1) Mining is implemented to the spec but **no product call site may exist**: precedents are written only by M6 from decisions (`source: "decision:<caseId>"`, `provenance.origin: "decision"`). An import-graph test fails if `src/` outside `src/engines/hmem` and tests references `mining`. The engine-usage map (C10) lists mining as "implemented, not used", never as an engine-usage claim.

**Pinned side-effect-free retrieval (spec section 11).**
```ts
interface PrecedentSnapshot {
  readonly digest: DocHash;                    // sha256 over JCS of the fields below, domain "plumbline/hmem-snapshot/v1"
  readonly asOf: number; readonly weightProfile: string; readonly embedderId: string;
  readonly records: readonly FrozenRecord[];   // deep-frozen copies; confidence and embedding fixed-point; sorted by id
}
interface RetrieveQuery { text: string; scope: ScopeFilter /* required, no default */; topN?: number; threshold?: number;
                          mode?: "support" | "counter"; rerank?: PureRerank; strategy?: "decision" | "audit";
                          recencyAnchor?: "lastAccessed" | "decidedAt" }   // `decidedAt` reads ext.precedent.decidedAt, so a read cannot move it (M6 SF3); named by the weight profile
interface RetrievalResult { snapshotDigest: DocHash; traceId: Id<"tr">; hits: Hit[];
  trace: { weightProfile: string; embedderId: string; suppressedSuperseded: number;
           excluded: { reviewTagged: number; archived: number; outOfScope: number; belowThreshold: number } } }
interface Hit { id: string; terms: Record<"semantic"|"keyword"|"tag"|"domain"|"entity"|"layer"|"recency"|"superseded", string>;
                raw: string; confidencePpm: number; score: string; factors: { code: string; factor: string }[] }
```
`retrieve` is a pure function of `(snapshot, query)`: it reads no clock, mutates nothing, and prints scores as 4-decimal strings. `peek` is the same `scoreOne` over a transient view of the live store at `asOf` (no snapshot digest, no ledger entry); a differential test asserts `peek` ranks equal `query` ranks on a cloned store (M6 T-IDX-03), and `peek` never reads `accessCount` or `lastAccessed` unless `recencyAnchor` says so. The decision bundle stores `snapshotDigest`, `traceId` and the hits; M9 re-runs `retrieve` against the snapshot to verify the ranking. `recordRead` appends one `read` ledger entry per hit with `details.pinned = true` **without** touching `accessCount` or `lastAccessed`, after the decision is final, so a read cannot feed the same decision. `rerank` is the hook through which M6 applies its fixed, published outcome and rule-version factors (no learning); each factor appears in `Hit.factors`, so a score decomposes. Counter-queries (`mode: "counter"`) are two calls by M6, not engine logic.

**Scope as a poisoning quarantine (readout C2).** `goalRunId = caseId` on every episode written during a case. `retrieve` requires an explicit `ScopeFilter { goalRunIds?: string[]; includeUnscoped: boolean; promotedOnly?: boolean }` (no default), the product always passes `includeUnscoped: false`; promotion to the global scope is a field change gated by M6's approval item. The runner-bound `query()` keeps the spec default (`includeUnscoped` true) because the runner never sets scope.

**Embedders.** `SyncEmbedder { id; dim; embed(text): number[] }`. Default `lexhash-v2`: word unigrams and bigrams plus character trigrams feature-hashed into 256 dimensions, deterministic, pure; honestly named lexical. Cosine between vectors of different `embedderId` is refused (semantic term 0, trace warning). Real semantics come from `AsyncEmbedder` through `ModelPort` with vectors stored in cassettes (spec F-EMBED), chosen by Recall@K and MRR on the precedent gold set (M11). The differential tests use a test-only `fnv64-compat` embedder (a documented 64-line algorithm re-written with an attribution header) so scores can be compared with the reference to 1e-9.

**Product fields (additive, namespaced `ext`).** `ext.precedent = { caseId, vendorKey, action, decidedAt, outcome?: { label, evidenceId, trust }, ruleVersion, ruleFingerprint, factSetHash, snapshotHash, tier }`, with `outcome.label` set only by M13 (never by the deciding model). `stale_rule_diff` is computed by M6 and stored as a tag, not an engine behaviour.

**Concurrency and determinism.** Single-threaded, no awaits inside mutating methods, ids from a monotone counter (`mem-N`, as the runner-compatible default) or `ctx.ids` when supplied. All time reads go through the injected `clock` (sg-001 advances it 40 days).

### C2.5 Tests and acceptance
Clause suite `tests/engines/hmem/clauses` (runner column: R = asserted by the runner, X = not asserted). Each clause is one vitest test titled by id and runs against `ours`, `reference`, `inert`, `mutant:*` (C6, C8).

| Id | Clause | R | Test |
|---|---|---|---|
| HM-REC-01/02 | empty source rejected synchronously; valid accepted (rv-001/002) | R | the runner; plus whitespace-only source rejected, error type stable |
| HM-REC-03 | `add` does not dedupe identical content (ro-002 relies on it) | X | two identical adds yield two records |
| HM-REC-04 | `add` returns the live object; later field assignment is visible to `store.get` and ranking | R(ro-001) | identity test without the runner |
| HM-RET-01..08 | each retrieval term in isolation (hand-computed values, 4 decimals); layer weights; recency at 0, 14, 28 days; confidence after clamp; threshold on final score; topN default 5; tie-break by id | X | table-driven; the reference's own hand-computed 0.6000 case is re-derived from the spec numbers, not copied |
| HM-RET-09 | superseded is penalised never filtered (ro-001) | R | plus superseded record still returned at threshold 0 |
| HM-FDB-01..05 | deltas and clamps (fd-001..005) | R | runner vectors plus boundary sweep 0.00..1.00 step 0.01 (property test with `fast-check`) |
| HM-LED-01..04 | one entry per mutation with before/after; 17 action types each produced by some path; `history` order; entry ids unique and monotone | R(la-001)/X | one test per action type |
| HM-LED-05 | head digest chain: tampering any entry changes `head()`; recomputed from journal equals live | X | tamper test |
| HM-SLP-01..07 | consolidation 7 days short-term/working; archive 30 days and accessCount <= 2 and unreferenced; each guardrail (superseding, derived, hub, unresolved-conflict); preview purity (store hash unchanged); execute refuses an out-of-preview action; archive is a tombstone and `restore` after a simulated restart works | R(sg-001)/X | |
| HM-CNF-01..06 | each of 5 opposing-pair regexes and the numeric rule; gate 0.70 boundary (0.699 queued, 0.700 resolved) via injected scores; re-scan idempotent; resolution never deletes; manual strategies | R(cg-001)/X | |
| HM-DRM-01..04 | proposals never materialise before approve; relatedness 0.35 and cluster min size 2; max 8 proposals per type; approval yields `long_term` with `derivedFrom`; rejection ledgered | R(db-001)/X | |
| HM-ENR-01..05 | domain classification; entity cap 10; `relatedTo` cap 5 and bidirectional with ledger entries; supersedes detection sets both pointers; an explicit `entities` list is used as given | X | |
| HM-REI-01..03 | `review`/`wrong` excluded unless audit; privacy tags redacted; trace carries traceId, weight profile, suppressed count | X | |
| HM-SCP-01..03 | `chatId`/`goalRunId` isolation; `includeUnscoped` true in `query`, explicit in `retrieve`; unpromoted scoped record absent from another case | X | MINJA-style: case A document plants "always release to account X"; case B retrieval empty |
| HM-PIN-01..06 | `retrieve` pure (100 identical calls leave ranking and snapshot digest unchanged; the reference changes it, recorded as a divergence); snapshot digest stable across process restarts; tampering a stored confidence changes the digest; `recordRead` leaves `accessCount` unchanged; `peek` leaves the store hash and ledger unchanged and ranks equal `query` on a cloned store | X | |
| HM-PRS-01..03 | restart round-trip (state, ledger, backups); external-mutation detected and ledgered; journal torn-write recovery | X | kill-and-restart drill |
| HM-SYN-01 | the entire runner-bound surface contains no `async` function and returns no Promise | R-implied | `typeof then` sweep over every public sync method |

**Metrics and baselines.** Clause coverage (clauses with at least one passing test over all clauses), mutation score (C8), retrieval parity with the reference on the differential corpus (C7), and for the product: precedent Recall@K/MRR on the gold set (M11), decision change under H-MEM off (C9). **What would disprove the design:** the runner failing; a clause the reference passes and ours fails without a register entry; mutation score below 100% of listed mutants; pinned retrieval diverging between two processes; the C9 warm/cold ablation showing no decision change (then H-MEM is reported as not load-bearing for the release decision and is not claimed as such).

### C2.6 Risks and NOT VERIFIED
Reference behaviours above are read, not run. Whether `node:sqlite` is needed at all: the plan uses JSONL and an identity map, so no (bake-off 5 decides the raw-source-table store separately). The hand estimate for cg-001 is unverified. The effect of the external-mutation flush on the 13 checks is predicted, not observed. `lexhash-v2` quality is untested; it must not be described as semantic. Mining and dreaming quality are unevaluated and unused by the product.

### C2.7 Build notes
Order: record and store (identity map, journal) -> ledger -> feedback -> retrieval (`scoreOne`) -> runner green on 13 -> sleep and conflicts -> dreaming -> clause suites -> pinned retrieval and scope -> async embedder. Unblocks M6's precedent store and C9's AB-HM.

---

## C3. World Model engine

### C3.1 Best references
- Meterless World Model spec and reference **[R]**; control-plane contract `docs/operator-control-plane.md` **[B]**.
- Bitemporal semantics: Fowler 2021 **[F]** ("terminology of valid time and transaction time comes from Snodgrass, and is also used in the SQL:2011 standard"); XTDB (`prior-art/07` §3.1) as the shape of the as-of API and an optional offline oracle for bitemporal vectors (JVM; SQL:2011 not read by us).
- Contradiction-handling anomalies: TOKI (arXiv 2606.06240, abstract only, `prior-art/07` §3.2): replay inconsistency, belief-drift skew, audit erasure become named acceptance tests. 2026 preprint, unreproduced.
- FollowTheMoney / nomenklatura pattern for identity as derived judgement edges (`prior-art/07` §1.3), consumed through M3.
- Evaluation limits: none of these evaluate event-sourced entity stores with authority tiers on procurement data; the Meterless runner is 8 checks.

### C3.2 What they actually do (reference, read in code)
- State is a fold over `events`; `applyAndRecord` appends, calls `fold`, persists the whole JSON file, notifies subscribers. Writes are serialised by a promise chain (`enqueue`).
- **`assertFact` mutates after the append**: it appends the fact event, then sets `supersededBy` on rival facts and `entity.attrs[predicate] = winner.value` directly on folded state (`index.ts`, `assertFact`). `fold` for `assertFact` only stores the fact. On reload, `EventStore`'s constructor replays events through `fold`, so the winning attribute and the `supersededBy` marks are not reconstructed. **Confirmed by reading; not demonstrated by execution.** The same applies to `aliases`: replay restores them (the `alias` event folds), but merge proposals, observations, stories and scores are side tables outside the event log.
- **`fold("relate")` closes every earlier open edge with the same `(from, type, context)` and a different target.** `ingest` writes one `mentions` edge per mentioned entity from the same article, so each new mention closes the previous one (`store.ts` fold; `index.ts` ingest). Confirmed by reading.
- **`ingest` bypasses resolution**: it calls `foldEntityUpsert` directly, and the near-duplicate pass lives in `upsertEntity` only.
- **`upsertEntity` attribute merge overwrites** (`existing.attrs = {...existing.attrs, ...e.attrs}`) and replaces `existing.source`, with no conflict policy applied.
- `foldUntil(at)` / `snapshot.entityAt` filters events by `e.at <= at` where `e.at` is the **source timestamp**, so it is neither valid time nor record time; `neighborsOf({at})` uses edge `validFrom`/`validTo`. Two different as-of notions with one name.
- The observation checksum covers `{externalId, title, text, at}` only (`ingest.ts` step 2): an edit to the mention list or type is skipped as unchanged.
- Identity: `entityIdFromName = "ent_" + sha256Hex(type + ":" + normalizeName(name)).slice(0,16)`; `externalId = type:system:id`. `nameSimilarity = 1 - levenshtein/maxLen` on normalised names; `decide(s, 0.85, 0.82)`; resolution runs only for name-keyed entities of the same type. Conflict policy is one global setting: `most-recent-wins | highest-confidence-wins | source-priority` (`manual` is a type member with no branch).
- **[C]** Golden id vectors, from the documented formula implemented independently in a throwaway script (node:crypto SHA-256): `("person","José  García")` and `("person","jose garcia")` both give `ent_5906acd871fa761d`; `("org","Acme Corp")` gives `ent_f441105cae478f27`; `("org","Acme Corporation")` gives `ent_537921142878fa2c`; `("person","x")` gives `ent_e23c79ed09528399`; `("org","x")` gives `ent_326febe6f70b64d6`. They become committed golden vectors (WM-ID-03) only after the differential run (C7) confirms the reference agrees.
- **[C] Name similarity is not a safe merge criterion.** Same script: "Acme Holdings Ltd" vs "Acme Holdings Inc" = 0.8235 (review band at the conformance default); "Series A Holdings" vs "Series B Holdings" = **0.9412**, above even a 0.92 auto-merge threshold; "Jerome Powel" vs "Jerome Powell" = 0.9231. A stricter threshold does not fix the Series A/B class (see Spec feedback 6).

### C3.3 Decision
**Own** the engine from the spec; reference is the oracle; fork-or-implement decided by C6 (hypothesis: from-spec, because three defects above are structural: replayability of resolution, edge cardinality in the fold, and the single resolution path). **Adapt** Fowler/XTDB's two-axis model for the as-of API. M3 owns **what** the resolution rule is; the engine owns **that resolution is a pure function of the fold**.

### C3.4 Implementation design

**Facade.** Exports `WorldModel`, `entityIdFromName`, `normalizeName`, `decide`, plus `canonicalJson`, `sha256Hex` (via `node:crypto`), `nameSimilarity`. `decide` keeps defaults 0.85/0.82. Constructor `new WorldModel({ storage: "memory" | "local", namespace, clock?: () => Date, journal?: SyncJournal, ...ext })`.

```ts
interface WorldModelExt {
  edgeCardinality?: Record<string, "one" | "many">;       // default "one" so bitemp-001 passes with undeclared plays-for
  resolverPlugin?: ResolverPlugin;                         // M3 supplies; recorded in the log as a `policy` event
  conflict?: { default: ConflictPolicy; byPredicate?: Record<string, ConflictPolicy> };  // per-attribute, in the fold
  reconciledPredicates?: ReadonlySet<string>;              // attrs for these may only be set through assertFact
  resolver?: { autoMergeAt?: number; reviewBand?: [number, number]; canAutoMerge?: (l: Entity, r: Entity, sim: number) => boolean };
  recordClock?: () => Date;                                // ctx.clock; recordedAt is stored but never in the state shape
}
interface ResolverPlugin { id: string; version: string;
  resolve(group: readonly Assertion[], ctx: { predicate: string; policy: ConflictPolicy }):
    { winner?: Id<"as">; status: CellStatus; rule: string; supports: Id<"as">[]; defeats: Id<"as">[] } } // pure; the shared Fact's `supports`/`defeats` (INT-013)
```
The engine computes no trust: a fused value's trust is M3's meet over `supports` only, and `defeats` feed status and conflict records. The reference's `confidence` field is stored as `Ppm` (`confidencePpm`); `conf` is always the shared confidentiality label.

**The fold law.** `state_n = fold(state_{n-1}, event_n)` is a pure reducer over immutable-by-convention state (copy-on-write at the touched keys). Nothing outside `fold` writes state. All derived values are recomputed inside `fold` from the event and current state: the winning fact per `(about, predicate)`, the `supersededBy` marks on losing facts, the entity attribute projection for reconciled predicates, alias closure, edge closure. The policy in force is itself folded state set by a `policy` event, so replay under the policy that was in effect at a given sequence is exact. Nothing derived is journalled: resolution is a view (M3).

- New event kinds (additive to the reference's eight): `policy`, `unalias`, `retract`, `observe`, `mergeProposed`, `mergeResolved`. Merge queue, observations and audit entries are derived from the log, so there are no side tables. Stories, velocity and scores are views computed on demand (pure), not stored; the product does not use them, and `ingest` returns them for spec parity.
- `stateShapeCanonical()` = JCS-style canonical JSON over entities, contexts, relationships, facts, aliases, merge queue; **excludes** `recordedAt`, step timings and any wall-clock value. Timings appear only on `IngestReport`.
- Property test: for random event sequences, `shape(fold(events)) == shape(live state)` and `== shape(reload from journal)`.

**Two profiles in one class** (as Markovian, C4). `conformance` (the facade the runner loads): arrival-order semantics where the reference has them, documented in WM-ORD-01. `product`: every view is a pure function of the event multiset, evaluated over events sorted by `(at, seq, hash)` (M3's permutation property), closure of single-valued edges is by valid time and not by arrival, and every read carries an explicit as-of.

**Pure-fold API (the shape M3's `FactStore` and M4's `Evaluator` consume; product profile).**
```ts
type AsOf = { validAt: Iso; knownAt: Iso } | { validAt: Iso; knownAtSeq: number };   // no default: an omitted axis is a type error (M6 R-WM3)
interface WorldFold {
  append(ev: WorldEvent): Result<{ seq: number; at: Iso; prevHash: DocHash; hash: DocHash }, "validation" | "fatal">;  // single writer, idempotent on content hash; `at` from ctx.clock
  fold(upTo?: { seq?: number; knownAt?: Iso }): WorldState;                  // pure, total; no clock, rng or I/O
  view<T>(name: "truth" | "entities" | "history" | "graph" | "assertions", q: AsOf & object): T;   // projections, never persisted as truth
  foldFiltered(pred: (e: WorldEvent) => boolean): ReadonlyWorld;             // see "Filtered folds"
  pin(): { seq: number; head: DocHash };                                     // the world pin in M4 snapshots and M6 carryover `asOf.worldSeq`
  stateShapeCanonical(): string; audit(): AuditEntry[];
}
```
The product vocabulary hosts M3's `StoreEvent` kinds: `assertion.observed` is `assertFact`, `judgement.recorded` and `judgement.retracted` are `alias` and `unalias`, `assertion.superseded`, `source.checked` and `rules.pinned` are carried as kinds of the same names; the reference's eight kinds stay for the conformance profile. `view("assertions", asOf)` returns the active assertions with `evidenceId`, `originId`, `trust`, in canonical order; M4's `phase1` removes evidence ids from that list and calls M3's pure `fuse`, so V(S) over many subsets never replays the engine; `foldFiltered` is the brute-force oracle for it and the path for events whose effect is not assertion-local. Evidence recorded after `knownAt` never enters any view (M4 obligation 6).
**Time axes (product).** Each fact and edge has valid time (`validFrom`, `validTo`), observation time (`source.at`), and record time as the **logical sequence** `recordedSeq` plus `recordedAt` from `recordClock` (stored, not hashed). Product queries take the pair `AsOf` (above): `view("facts").about(id, asOf)`, `view("graph").neighborsOf(id, { via?, ...asOf })`. Semantics:
- In the `conformance` profile, `at` omitted means the **open edge set** (reference behaviour, required by bitemp-001); the `product` profile has no such default and passes `validAt: recordClock()` where "valid now" is meant.
- `snapshot.entityAt(id, at: string)` keeps the reference meaning (events with `source.at <= at`) and is documented as `knownBySourceTime`; the new `entityAsOf(id, { validAt, knownAtSeq })` is the as-of replay API used by M3 and M10 ("who owned the vendor on the PO date, as we knew it on the approval date").
- Late-arriving data (a registry correction filed after the PO date about ownership before it) appears in `validAt = PO date` queries only when `knownAtSeq` is at or after its record sequence. Test WM-BT-02..05.

**Edge cardinality.** `edgeCardinality[type]` decides closure in the fold: `"one"` closes the prior open edge with the same `(from, type, context)` and a different target (reference behaviour; by arrival in `conformance`, by valid time in `product`); `"many"` never closes by target (closure only by explicit `validTo` or `retract`). Product declarations: `plays-for`-like single-valued types default to one; `owns`, `director-of`, `has-bank-account`, `subsidiary-of`, `mentions`, `same-as-source` are many.

**Facts and conflicts.** `assertFact` computes the fact id as the reference does (`fact_` + 16 hex of SHA-256 over `about|predicate|canonicalJson(value)|assertedAt|sourceKind|sourceUrl`), extended with optional product fields carried through verbatim: `evidenceId`, `bodyHash`, `trust`, `conf`, `authority`, `authorship`, `validFrom/validTo`, `mentionId`, `originId`, `extractor`, `parserVersion`, `derivedFrom` (the `Assertion` of the shared types). Losing facts are kept with `supersededBy` derived in the fold. **Equal-authority conflicting values produce `status: "unresolved"`**, not a winner: the engine's built-in policies `most-recent-wins` etc. exist for conformance and documented behaviour, while the product runs with M3's `resolverPlugin` (pure function of dates, authority tiers and per-attribute cardinality, spec section 8). `upsertEntity` attrs for reconciled predicates throw `ReconciledAttribute` (use `assertFact`); other attrs merge as the reference does but record the previous value in the audit.

**Identity.** Product entity ids are external-key literals: `org:gleif:<LEI>`, `org:sec:<CIK>`, `org:internal:<vendorId>`; name-keyed ids are only a fallback for unkeyed mentions. M3's link judgements project to `alias` events (`reason` carries the judgement id) and `unalias` events; `alias` resolution is a fold over the latest event per `aliasId`. Merge then unmerge then merge reproduces an identical shape (WM-MRG-04; the M3 requirement "un-merge then re-merge yields an identical truth table"). Name-similarity resolution inside the engine is a **proposal generator only** in the product profile (`canAutoMerge: () => false`), because the Series A/B class exceeds any threshold; M3's cascade (authoritative ids, gated fuzzy, `cannot-link` edges) decides.

**One resolution path.** `ingest` calls `upsertEntity`/`relate`/`assertFact` internally, so the review band applies to ingest (WM-ING-03). The observation checksum covers the whole normalised observation including `type` and `entities` (WM-IDEM-04). `ingest` appends zero events when nothing changed (WM-IDEM-03).

**Filtered folds for M4.** `foldFiltered(pred: (e: WorldEvent) => boolean): ReadonlyWorld` returns a read-only world built by replaying only the events that satisfy `pred` (for example excluding the events produced by evidence item `e`). It replays the whole sorted log because closure and winners depend on the surviving set; M4 states edge-locality and performance on top. `fork(excludeEventIds)` is a thin wrapper. Test: equals brute-force re-ingest of the surviving observations, and equals the `view("assertions")` filter followed by M3's `fuse` on every subset of a small ledger.

**Other additions.** `retractFact(id, reason, source)` as a `retract` event (the fold ignores a retracted fact in winner computation; nothing is deleted); `buildCaseContext({subjectId, asOf, limit})` returns **fact ids and hashes** plus an optional text rendering for Markovian chunk 1 (ids, not facts, cross chunks); `subscribeEvents` for the H-MEM sync (brief hand-off 5, one-directional: the world is authoritative). Roles viewer/editor/admin are enforced at the append layer by an injected `authorize(actor, kind)`; M10's panel consumes it.

**Persistence.** Journal of events (JSONL) through `SyncJournal`; `storage: "local"` file mode kept for parity with the reference. Replay on construction. Single-writer FIFO queue (promise chain) so un-awaited concurrent writes keep audit order; a test fires 1,000 un-awaited writes and checks `seq` monotone and the final shape equal to the serial run.

### C3.5 Tests and acceptance
| Id | Clause | R | Test |
|---|---|---|---|
| WM-ID-01..04 | NFKD, mark and zero-width stripping, lowercase, whitespace collapse (reference order); type in key; golden vectors from C3.2 | R(sid-001/002)/X | plus `normalizeName` idempotence (property) and a fuzz over Unicode categories |
| WM-BND-01..03 | `decide` 0.85/0.84/0.82/0.81; options override; boundary with float noise (0.8499999999) | R(band-001)/X | |
| WM-PRV-01 | no provenance, no write, all five write methods | R(prov-001)/X | |
| WM-IDEM-01..04 | same batch twice: `changed:false`, equal shape; edited title; zero events appended; edited mention list is a change | R/X | plus the reference's `--mutate` idea as a self-test |
| WM-BT-01..05 | superseding edge closes the old; `at` queries; open-edge semantics with far-future dates; late-arriving correction visible only at later `knownAtSeq`; `validTo` exclusive boundary | R(bitemp-001)/X | |
| WM-AUD-01..02 | every mutation audited with strictly increasing `seq`; audit derivable from the log | R/X | |
| WM-FACT-01..06 | winner per policy; per-predicate policies; equal authority gives `unresolved`; losers retained; **restart replay reproduces winners and `supersededBy`** (the reference defect); policy change event replays under historical policy | X | kill-and-reload |
| WM-EDGE-01..03 | many-valued types keep all open edges; `mentions` x3 from one article all stay open; one-valued closure unchanged | X | |
| WM-ING-01..04 | 10-step order observable via report; observation records survive restart; ingest goes through resolution (Powel/Powell reach the review band); step timings absent from the shape | X | |
| WM-MRG-01..05 | auto-merge, review queue, approve/reject, merge-unmerge-merge identical shape, **Series A / Series B similarity 0.9412 never auto-merges in the product profile and does at defaults (documents the hazard)** | X | |
| WM-ORD-01 | TOKI anomalies as tests: replay inconsistency (any permutation of the event multiset leaves every `product` view unchanged; documented arrival-order dependence in the `conformance` profile only), belief-drift skew (same origin repeated does not raise support), audit erasure (superseded value recoverable) | X | |
| WM-FILT-01 | `foldFiltered` equals brute-force | X | property test, ledgers to 14 items |
| WM-CTL-01 | role-by-action matrix enforced at append | X | |

**Metrics.** Clause coverage; replay equality rate (must be 1.0 over 10,000 random sequences); ingest idempotence; divergence count vs reference (all in the register); for the product, the as-of ownership answers on the gold set (M11). **Disproof:** any replay inequality; a many-valued edge closed by a different target; a name-similarity auto-merge of a Series A/B pair in the product profile.

### C3.6 Risks and NOT VERIFIED
The three structural defects are [R]-confirmed, not executed. XTDB as an oracle: JVM, not set up; optional. Copy-on-write fold performance on large logs untested (case-sized graphs only). `ResolverPlugin` interface must be agreed with M3. The `policy`/`unalias`/`retract` kinds are our extensions beyond the eight reference kinds; the runner does not care, but a reviewer comparing with the spec should see them documented in the extension register.

### C3.7 Build notes
Order: stable ids and `decide` (pure, quick) -> fold and journal -> `upsertEntity`/`relate` with cardinality -> runner green on 8 -> `assertFact` in the fold -> time axes -> ingest through the single path -> merge/alias/unalias -> filtered folds -> clause suites. Unblocks M3 and M4.

---

## C4. Markovian engine

### C4.1 Best references
- Meterless Markovian spec and reference **[R]**.
- "The Markovian Thinker" (Delethink): arXiv 2510.06557, Aghajohari et al. (`prior-art/11` §8; repo `McGill-NLP/the-markovian-thinker`, 351 stars, Apache-2.0): chunks of 8K with the last m tokens as state; RL-trained; its own stress test shows degradation when required state exceeds m.
- MEM1 (arXiv 2506.15841) and MemAgent (arXiv 2507.02259): bounded-state agents, RL-trained (`prior-art/11` §8, author-reported).
- All three need trained models or carry free text; the Meterless engine is prompt-level. **No published result shows that untrained prompt-level chunking preserves answers on investigation tasks**; this is what C9's AB-MK measures.

### C4.2 What they actually do (reference, read in code)
`orchestrate` loops while `chunks < maxChunks && !done`: build prompt (`buildPrompt`: memory context and attachments only at step 1, later steps carry `Goal (truncated)` of 200 chars plus `[CARRYOVER STATE]` plus an optional `[OVERLAP]` block of the last `overlapTokens*4` characters), call the generator, `parseMarkers(text)`, token count `ceil(chars/4)` (`estimateTokens`), then `CarryoverService.next` with cascade marker (accept iff >= 24 chars and within token budget), LLM compressor (last 2,000 characters), heuristic key phrases (first 5), tail truncation. Reflection runs after completion with `run.output.slice(0, 4000)`; failure is swallowed (`run.error` set). `tokenLabel` is always `"estimated"`; the generator's `metadata` is ignored. Run ids come from a module counter. `stopWhen` receives `{step, carryover}`.

**Security-relevant reading [R].** `parseMarkers` runs on the **raw model output**: `STATE_TAILS` match `[STATE_CHECKPOINT]\s*([\s\S]*)$`, `@@@STATE@@@`, `[STATE]`, `---STATE---` and capture everything to the end; `FINAL_MARKERS` match `[TASK_COMPLETE]` anywhere. If vendor-document text is echoed or paraphrased by the model into its output, an attacker-chosen `[TASK_COMPLETE]` ends the chain early and an attacker-chosen `[STATE_CHECKPOINT]` block becomes the next chunk's carryover (the cascade's level-1 accepts any string of 24+ characters within budget). That is a carryover-poisoning and early-termination channel. Exploitability against a real model is **NOT VERIFIED**; the structural weakness is read in code.

### C4.3 Decision
**Fork-candidate** in the C6 sense: Markovian is small (9 source files), the config, marker and prompt modules are plausibly sound, and my hypothesis is that bake-off 6 may choose FORK for `configManager.ts`, `promptBuilder.ts` and the legacy marker aliases, with the orchestrator, carryover, accounting and security layer **owned**. Either way the typed carryover, ratify, measured accounting, resume and nonce markers are ours. Alternatives rejected: Delethink-style trained state (needs RL training); free-text carryover for compliance work (lossy, poisonable).

### C4.4 Implementation design
**Facade.** Exports `Markovian`, `modelTotals`, `runEfficiency`, `ConfigValidationError`, `parseMarkers`, `cleanMarkers`, `CarryoverService`. `modelTotals(N)` returns exactly 246,000 / 34,000 / ratio 0.8618 at N = 20 with `F=400, G=200, S=300, O=1200, C=800` and integer arithmetic (`N*(F+G+S) + O*N*(N-1)/2`), generalised by an optional constants argument. `runEfficiency(chunks, cfg)` uses the prefix-sum formula against the run's **own snapshot**. Constructor validates synchronously and throws a typed `ConfigValidationError` for: any bound violation (`chunkSize` 1000..128000, `maxChunks` 1..32, `carryoverTokens` 128..32768, `overlapTokens` 0..4096), `carryoverTokens <= 0`, and `chunkSize < 400 + carryoverTokens + 1200`; never clamps. `overlapTokens > 0` is **implemented** (the `[OVERLAP]` block), not rejected, so ovl-001 passes the implement branch.

**Two profiles in one class.** `profile: "conformance"` (default; text carryover, bare markers, reference cascade) so the runner passes unchanged; `profile: "typed"` (product).

**Typed profile.**
```ts
interface TypedCarryover { v: 1; goalHash: DocHash; asOf: { worldSeq: number; ruleVersion: string };
  material: { id: string; kind: "finding" | "sanctions_hit" | "identity" | "decision" | "claim";
              status: "open" | "resolved"; cause?: string; evidenceId?: string }[];
  openQuestions: { id: string; about: string; why: string }[];
  freeNote: string }                                // hard cap (default 200 estimated tokens), advisory only
interface CarryoverPort { resolve(id: string, asOf: TypedCarryover["asOf"]): { ok: true; hash: DocHash } | { ok: false; reason: string } }
type CarryoverBuilder = (c: { chunk: number; prior: TypedCarryover | null; output: string; port: CarryoverPort }) =>
  { ok: true; carryover: TypedCarryover } | { ok: false; reason: "overflow"; ids: string[] };   // code-built from the host's ledger (M6)
```
1. **Markers carry a per-run nonce**: `[STATE_CHECKPOINT:<nonce>]` and `[TASK_COMPLETE:<nonce>]`, nonce from `ctx.rng`/`ctx.ids`, placed in the system prompt only. Markers without the nonce are inert text. This defeats the echo channel above without relying on detection. Legacy and XML aliases are accepted in `conformance` only.
2. The state block is JSON between marker and end; parsed with the schema; invalid -> level fall-through to the LLM compressor (typed JSON) -> otherwise **`carryover-overflow`** (run status `"carryover-overflow"`, partial output preserved). **The cascade has no tail-truncation level in this profile.**
3. **Validator** after every chunk: every `material`/`openQuestions` id resolves through `CarryoverPort` at `asOf` with an unchanged hash; size within budget; `goalHash` unchanged.
4. **Carryover-loss detector**: diff `carryoverIn` against `carryoverOut`; every `material` id of kind `sanctions_hit` or `identity` (pinned above all) and every `decision` must be retained or moved to `resolved` with `cause` and `evidenceId`; otherwise `carryover-loss` -> redo the chunk once under budget, then fail the run with class `validation` (human step). The compression instruction orders retention priority decisions > open questions > pinned hits > entities > progress.
5. **`ratify(run, port, required: string[]): RatifyResult`** is a pure function (not a model call): every id the decision needs is present in the final carryover or resolved with cause, and re-reads each from the World Model now. LLM reflection stays advisory and cannot gate.
6. **Measured accounting.** The `Generator` contract is `(prompt, attachments, system?, onStream?, signal?) => Promise<{ text: string; metadata?: { usage?: { input_tokens: number; output_tokens: number } } }>`. The product generator wraps `ModelPort` and returns provider usage. Each `ChunkInfo` gains `promptTokens`, `outputTokens`, `label: "measured" | "estimated"`, `cascadeLevel`, `carryoverTokens`. Run-level `tokenLabel = "measured"` iff every chunk is measured. **One accounting path**: live progress and the final record both call `runEfficiency` over the chunk records (the reference computes two different numbers, **[R]** `orchestrator.ts` uses `(step-1)*chunkSize` for live savings and `runEfficiency` for the record). The modelled curve (`projectionCurve`, `modelTotals`) is plotted beside measured values, never substituted for them. Recorded efficiency is `Ppm`; the runner-facing ratio stays a number.
7. **Resume.** `run({ resumeFrom: MarkovianRun })` continues after the last persisted chunk; the next prompt is a pure function of `(goal, carryover_k, overlap_k)`. Each chunk is journalled before the next begins. This is the carryover crash-restart equivalence test in M11's artifact list.
8. **Contract and phase boundaries.** The host verifies the Scout contract once (`reason/markovian.chain`) via `ContractGuard` and refreshes it with `replan` at phase boundaries; the engine itself imports no Scout code. Pause markers (`NEEDS_TOOL`, `NEEDS_CLARIFICATION`) are parsed in `conformance` and ignored in `typed` (readout H6 rejected them as an approval mechanism).
9. **Scope rule.** A Markovian run belongs to one `caseId` (carried in `goalHash` and every journal line). Constructing a run with an id from another case's carryover raises `ContaminationError`. Batches are fan-out of independent runs aggregated in code (spec section 11, readout H1).
10. Run ids come from `ctx.ids` (default counter `run-N` for the runner); `stopWhen` receives `{ step, carryover, output }` (reference plus the docs' shape).
11. **`carryoverBuilder` hook (M6 SF9).** When supplied, the model-written state block is neither requested nor parsed (the markers are stripped from the output) and the host builds the carryover from its findings ledger after each chunk; validator, loss detector and measured accounting still run on the built value, and a builder `overflow` ends the run as `carryover-overflow` listing the ids. Without a builder, item 2's model-written path applies.

### C4.5 Tests and acceptance
| Id | Clause | R | Test |
|---|---|---|---|
| MK-EFF-01..03 | `modelTotals(20)` exact integers; efficiency 0.8618; break-even `N > 1 + 2C/O` boundary values | R(eff-001)/X | sweep N = 1..32 against an independent formula |
| MK-SNP-01..02 | per-run snapshot; efficiency computed from it (standardCost 10,000, markovianCost 6,048) | R | |
| MK-CFG-01..05 | each bound inclusive/exclusive; framing rule; typed error not clamp | R(cfg-001)/X | |
| MK-OVL-01 | `[OVERLAP]` present from chunk 2 with exact character length `overlapTokens*4` | R(ovl-001)/X | |
| MK-LAB-01..03 | label estimated/measured; all-measured rule; mixed gives estimated | R(lab-001)/X | |
| MK-REF-01 | reflection failure never fails the run (and with `reflect:false` no second call) | R(ref-001)/X | |
| MK-MRK-01..06 | marker cleaning; completion; legacy aliases (conformance only); marker mid-text; bare marker inert in `typed`; wrong-nonce marker inert | R(mrk-001)/X | **injection test: document text containing `[TASK_COMPLETE]` and a forged `[STATE_CHECKPOINT]` echoed by a scripted generator does not end the run or change carryover** (the reference ends it: recorded divergence) |
| MK-CAS-01..04 | cascade order marker -> llm -> heuristic -> truncation in `conformance`; no truncation in `typed`; 24-character gate; budget boundary | X | |
| MK-MEM-01 | memory context and attachments only in chunk 1 | X | |
| MK-ABT-01..02 | abort before chunk and before compression; partial output kept | X | |
| MK-TYP-01..06 | schema; id resolution at `asOf`; stale hash rejected; overflow state; loss detected for each of 1,000 seeded runs in which a compressor drops a random material id (must be 1,000 of 1,000); redo then escalate | X | fault injection |
| MK-RAT-01..02 | ratify catches a dropped sanctions-hit id with no model call; passes a complete carryover | X | |
| MK-BLD-01..02 | with a `carryoverBuilder` the model's markers never reach the next prompt and a forged state block changes nothing; a builder `overflow` yields `carryover-overflow` with the ids | X | |
| MK-RES-01 | crash after chunk k, resume, final output hash equals the uninterrupted run (cassettes) | X | |
| MK-CON-01 | contamination: vendor B run after vendor A in one chain cannot cite A's ids | X | M6 test, engine side raises |

**Metrics.** Clause coverage; loss-detection rate 1,000/1,000 on injected drops; measured-token curve (C9); where chunking loses (break-even sweep), reported with worst of three runs for model-backed items. **Disproof:** a forged marker changing control flow in `typed`; measured savings absent at depths where the model predicts them (reported, not hidden); answers differing between Markovian and single-context beyond the pre-registered margin.

### C4.6 Risks and NOT VERIFIED
Ids-not-facts carryover has a capacity limit (Delethink's CrossWordBench result): state not expressible as ids has no home except `openQuestions` and the capped `freeNote`. Whether a real Nemotron model follows the typed-state protocol reliably is unmeasured (parse-failure rate is a bake-off 7 metric). The marker-injection exploit against a live model is unproven. Savings for short cases: none expected (break-even about 3 chunks), and no claim is made.

### C4.7 Build notes
Order: config and efficiency math (pure) -> markers and prompt builder -> orchestrator with injected generator -> runner green on 8 -> accounting -> typed profile and validator -> ratify -> resume -> clause suites. Unblocks M6's deep-chain mode and AB-MK.

---

## C5. Scout Intent engine and the single capability mechanism

### C5.1 Best references
- Meterless Scout spec, `docs/execution-contract.md` and eval harness **[R]**; no reference implementation exists.
- Capability and attenuation literature: Macaroons (Birgisson et al., NDSS 2014, **[F]**: caveats that "attenuate and contextually confine when, where, by who, and for what purpose a target service should authorize requests"); Biscuit (`eclipse-biscuit/biscuit`, 1,165 stars, Apache-2.0, pushed 2025-10-21; **metadata only, README not read, UNVERIFIED**); UCAN (`ucan-wg/spec`, 293 stars, licence NOASSERTION, **metadata only**).
- CaMeL (arXiv 2503.18813; `prior-art/10` A1): capability-on-value defence; "removes the model from the trusted path".
- Signature standard: RFC 8032 EdDSA (**[F]**, January 2017): deterministic signatures, PureEdDSA collision resilience, published test vectors. `PACE` (arXiv 2610.01349, `prior-art/11`): provenance-aware capability enforcement before each tool call (2026 preprint, abstract only).
- What their evaluation does not show: none of the capability systems evaluate single-use release tokens for payments; Scout's own harness is a 32-example smoke set whose README says targets are "not measured results".

### C5.2 What they actually do (the Scout spec and harness, read)
The contract is an HMAC-SHA256 over `canonical_json(contract_without_signature)`, TTL 5 minutes, immutable after signing; the doc says plainly it is "not a cryptographic-grade defense" and that the signer interface is pluggable **[R]**. The harness reads `out.executionContract.intent.primary.id`, `out.candidates[].intent`, `out.risk.level === "block"` as the only detection signal, `out.toolPlan[].capability` as a **subset** test, `out.clarification` truthiness, optional `out.overrides`; it never scores `expected.intents`, `expected.clarification` or `expected.risk` (except as a slice label); precision is 1 when nothing is flagged; throwing prompts are skipped and leave the denominators **[R]**. Fixture registry: 13 intents with role lists, risk classes and capability lists (for example `deal.update` high, `email.send` high). The committed `latest.md` shows an implementation that blocks and clarifies nothing clearing three of seven gates **[B]**. The signature canonical encoding, replay inside the TTL, key custody and child-scope rules are unspecified.

### C5.3 Decision
**Own** Scout from the prose (greenfield). **Adapt** the contract with the documented signer extension point: Ed25519 for every product contract, HMAC retained only for conformance and differential tests. **Own** a stricter grader. **Adopt** CaMeL's principle (capability on the value, model out of the trusted path) as the reason the contract, not detection, is the defence. Alternatives rejected: Macaroons/Biscuit as the token format (they would add a second token format next to Meterless's contract, violating the single-mechanism rule; their attenuation idea is reproduced by the child-scope subset rule); Scout's Stage-2 embedding classifier (readout H3).

### C5.4 Implementation design

**Facade** (`src/engines/scout/index.ts`): exports `Scout`, `verifyContract`, `consume`, `IntentRegistry`, `HmacSigner`, `Ed25519Signer`, `ProcessSigner`, `ContractGuard`, `ContractIssuer`. The `NonceStore` type is M13's; M12's tests use the doubles `MemoryNonceStore` and `FileWal` under `tests/engines/scout/` (the engine imports no `fs`).
```ts
new Scout({ intentRegistry: string /* absolute path */, policyPack: string | string[], clock?, ids?, signer?, trace? })
decide(i: { prompt: string; user: { id: string; role: string }; surface: string; snippets?: string[] }): Promise<Decision>
```
`Decision` carries exactly what the harness reads (`executionContract?`, `candidates: {intent, score}[]` sorted, `risk: {level: "low"|"medium"|"high"|"block"; flags; reason?}`, `toolPlan: {capability, tool, input, reason}[]`, `clarification?: {question, options[<=4]}`, `overrides?: []`). **`decide` never throws**: a blocked request returns `risk.level = "block"`, a `reason` and no contract; internal errors return a `block` decision with `reason: "internal_error"` and a trace line (so the harness never skips). Unknown policy pack names throw at construction. Policy packs: `default`, `adversarial-tight` (the harness composes both), and `plumbline-release` (ours).

**Pipeline.** (1) Normalise (NFKC, strip bidi controls and zero-width characters, decode the literal `\uXXXX` escape text seen in the corpus's unicode example, record a `unicode` flag). (2) Stage-1 deterministic trigger scan over the closed registry. (3) Score `0.40 lexical + 0.35 semantic + 0.20 contextual + 0.05 recency - riskPenalty`, where "semantic" is the same deterministic `lexhash` similarity as H-MEM (named lexical, no embeddings), contextual from role/surface/prior intent, recency from the session; bands High >= 0.80, Medium 0.55 to 0.79, Low 0.40 to 0.54 (clarify with top-3), Reject < 0.40 falls back to `GENERAL`; clarify also when top-1 and top-2 are within 0.05 in Medium, a required parameter is unbound, or a high-risk intent scores below 0.95. (4) Five guard layers (injection patterns including role drift and out-of-band tool references; policy gate with RBAC; scope; PII/sensitivity redact-or-block recorded on `risk.redactions` without values; rate limit); any `block` blocks, any `warn` lifts risk one band; the **second pass over `snippets`** is mandatory when snippets are supplied (an extension; the harness never supplies them). (5) Capability graph resolution `read/ write/ reason/ act/` with the risk filter applied **before** ranking; an unresolvable capability is a typed `unresolved` entry (`no_adapter|unavailable|blocked_by_policy`) mapping to M1's fetch states. (6) Contract issue.

**Plumbline registry and capability grammar** (`registry/plumbline-intents.json`, registry version stamped on contracts): `case.reconcile`, `case.explain`, `case.decide`, `po.release` (high), `vendor.update-bank` (high, never issued in the demo), `memory.approve-dream`, `policy.override`. Capabilities: `read/source.{gleif,sec,ofac,courtlistener,wikidata}`, `read/zetaris.query`, `read/memory.recall`, `read/world.query`, `write/world.assertFact`, `write/memory.append`, `reason/markovian.chain`, `reason/model.{hosted,local}`, `act/po.release`, `act/vendor.update-bank`, `act/task.create`. Value of Scout here is the boundary (guard, scope, signed release), not classification of about a dozen intents (brief section C). Typed submissions with ERP ids skip classification: `ContractIssuer.issueForPlan(plan)` compiles `scope.capabilities` from M7's `Step` declarations (reads and writes), so there is one source of scope, not two.

**Contract (signed bytes).**
```ts
interface ExecutionContract {
  contractId: string /* ULID */; parentId?: string; traceId: string;
  intent: { primary: { id: string }; parameters: Json; references: Json; confidenceMilli: Milli; alternates: { intent: string; scoreMilli: Milli }[] };
  risk: { level: "low" | "medium" | "high"; flags: string[]; redactions: Json[]; approvals: ApprovalRecord[] };   // no "block": decision-level only; for `act/po.release` only the `{approvalId, assertionHash}` projection (see below)
  toolPlan: { capability: string; tool: string; input: Json; reason: string }[]; modelProfile: string;
  scope: { user: { id: string; role: string }; surface: string; capabilities: string[]; deadline?: Iso; budget?: { tokensMax?: number; costMaxMilliUsd?: number };
           release?: ReleaseBinding };                  // shared type, contents and minting policy owned by M8 (INT-016)
  aud: string; issuedAt: Iso; notBefore: Iso; expiresAt: Iso; registryVersion: number; policyPackVersion: string;
  nonce: string /* 128-bit */; sigAlg: "ed25519" | "hmac-sha256"; kid: string; signedBy: "scout"; signature: string;
}
```
`ReleaseBinding` is the shared type (conventions section 3): `caseId, tenant, episode, decisionId, payee, accountCommit, amountMaxMinor, currency, poRef, action, factSetHash, policyBundleHash, listVersions, vendorMasterVersion, approvals[], approvalSetHash, attestationIds[], restoreEpoch`. For `act/po.release`, `aud` is `broker:<tenant>:<adapter>:<restoreEpoch>` and its epoch must equal `binding.restoreEpoch`; `risk.approvals` carries only the `{approvalId, assertionHash}` projection of `scope.release.approvals` (the binding is authoritative; a mismatch is `case_binding_mismatch`).

**Signed bytes.** For `sigAlg: "ed25519"` the body is the JCS of the contract without `signature`, wrapped in a DSSE envelope (payload type `application/vnd.plumbline.execution-contract+json`; PAE, JCS and Ed25519 code come from M7 and M9, not reimplemented); the `signature` field of the Scout shape is the envelope signature, carried beside the body and never inside the signed bytes. `"plumbline/contract/v1\n" + JCS(contract without signature)` is the **HMAC conformance encoding only**, and the broker refuses `hmac-sha256` (`alg_not_allowed`). The signed object contains **no floats** (`Milli`, `MinorUnits`); the unsigned in-memory `Decision.candidates[].score` may be a float, and the recorded `scout.decision` event carries `Milli`. `policyPackVersion` for release contracts equals `scope.release.policyBundleHash` (the hash of the SMT-checked bundle, readout A1). TTL per family from the pack: `read/` and `reason/` 300 s, `act/` 120 s (ours; the spec default is 300 s and approvals "expire quickly", spec 14a), counted from minting; the approval window and the request lifetime are separate clocks (`ApprovalClocks`, INT-031). Scout Meterless-compat fields keep their names; our additions (`aud`, `notBefore`, `nonce`, `sigAlg`, `kid`, `release`) are listed in the extension register.

**Signers and key custody.** `HmacSigner` (conformance, differential). `Ed25519Signer` over `node:crypto` (in-process; conformance, differential and run contracts only; availability and exact call shape to be confirmed by the RFC 8032 vector test CV-1, **NOT VERIFIED until run**). `ProcessSigner` is the M7 `SignerPort` client of the **M9 signer process** (INT-017): it sends `{role: "capability", claims: <JCS body>, leafProofs}` with one inclusion proof per `approval.granted` leaf, and M12 starts no signer process and holds no private key. The signer's capability policy is the conjunction of M9's inclusion-proof check, M8's check that each approval's WebAuthn assertion binds to `H(body without approvals)`, and M13's `G-FRESH` guard (evaluated by the case manager before it asks for a signature and again by the broker; the signer cannot read the ERP, residual in M8 C19). Verifiers hold only the pinned public-key registry from M9 `{kid, publicKey, validFrom, validTo, role}`; rotation is a signed leaf. `verifyContract` refuses `hmac-sha256` in `plumbline` mode and refuses any `act/` capability whose `kid` is not registered under role `capability`, so a downgrade or a run key cannot forge a release.

**Verification and consumption (one order, `consume` last).**
```ts
type Refusal = "malformed" | "unknown_kid" | "alg_not_allowed" | "bad_signature" | "expired" | "not_yet_valid" | "scope_mismatch"
  | "audience_mismatch" | "approval_missing" | "approval_invalid" | "case_binding_mismatch" | "kill_engaged" | "revoked"
  | "world_changed" | "field_differs" | "already_consumed" | "store_error" | "parent_scope_widened" | "ttl_extended";
interface VerifyEnv { now: Iso; audience: string; capability: string; keys: KeyRegistry; mode: "plumbline" | "compat"; secret?: string;
  binding?: Partial<ReleaseBinding>;
  approvals?: ApprovalChecker;   // M8: distinct subjects, segregation, assertion challenge equals H(body without approvals)
  kill?: KillView;               // M8 C14: kill and revocation state
  world?: Revalidator;           // M8 C19 / M13 step R: list, vendor-master and fact-set versions, supersession
  fresh?: FreshFieldReader }     // M13: ERP fields read through the `broker` silo role
declare function verifyContract(c: SignedContract, e: VerifyEnv): Promise<Result<Verified, Refusal>>;   // stages 1 to 6, first failure wins
declare function consume(v: Verified, store: NonceStore, idempotencyKey: string): Result<Consumed, "already_consumed" | "store_error">;   // stage 7
```
`SignedContract` is the DSSE envelope with its verified body (in HMAC mode, the Scout object). The stages, in this order only (INT-016): (1) envelope and pinned key (payload type, `sigAlg` pinned by policy and never read from the envelope, `kid`, PAE over the received bytes, body read from the verified bytes); (2) audience (tenant, adapter, restore epoch) and the time window with the family TTL bound; (3) approvals (`ApprovalChecker`); (4) kill and revocation state; (5) world re-validation; (6) fresh field equality; (7) `consume`, the atomic consume-and-intent, **last**, so a transient failure in 4 to 6 never burns the capability. The readers of stages 3 to 6 come from `VerifyEnv` and are called only after the earlier stages pass. This is the one function M8 names `verifyCapability` and M13's `execute` calls first; M8 supplies the stage 3 to 6 predicates and M13 the readers. `compat` mode runs stages 1 and 2 and the scope check only.

`Verified` is a module-private class with a runtime registry (the forgery-rejection rule of spec section 5), so an executor cannot be handed an unverified value. The compat call `verifyContract(contract, { secret })` returns `{ ok, reason }` for Meterless-style callers. `NonceStore` (M13) is `consumeAndRecordIntent(i): Result<Consumed, AlreadyConsumed | StoreError>`, synchronous and **one atomic entry** for nonce and intent; M13 supplies two implementations (single-writer WAL with fsync, which M13 calls `ConsumedWal`, and exclusive-create file), and M8's `SEC-A6` and `SEC-A7` run against both. A resume after a crash queries the target by idempotency key before acting (SEC-10 closure). M12 ships only the test doubles `MemoryNonceStore` and `FileWal`.

**Replan.** `replan({ parent, reason })` issues a child of a **run** contract with `parentId`, the same `traceId`, a fresh `contractId`/`nonce`, and `scope.capabilities` a **subset** of the parent's unless an approval record is attached; TTL is never extended (`ttl_extended`). Used by M7's F-REPLAN and by Markovian phase boundaries (readout A3). A release contract is never made by `replan`.

**The one capability mechanism (resolved by INT-016).** Spec 12 states one mechanism with one owner. Three texts named a capability: spec section 5 ("signed, expiring, case-bound capability"), spec section 14a (M13 "per-case signed capability", single-use) and prior-art 10 D.4. They are one object:
1. **The release capability is an `ExecutionContract` with `act/po.release` in `scope.capabilities` and `scope.release: ReleaseBinding`.** There is no `ReleaseCapability` type with its own signing path; the name is `act/po.release` everywhere.
2. **Owners.** M12: the container, `verifyContract`, `consume` and the refusal vocabulary (it must satisfy the vendored Scout harness and the single-mechanism ablation). M8: `ReleaseBinding` contents, the minting policy, the stage 3 to 6 predicates and the gate that constructs `Approved<T>`. M13: the broker, `NonceStore`, execution-time re-validation. M9: the signer process and key registry.
3. **Two instances, two times.** The **run contract** is made at intake by `Scout.decide` (or `issueForPlan`) for `read/`, `reason/` and local `write/` capabilities, TTL 300 s, and never contains `act/` (SC-CAP-03). The **release contract** is minted by `ContractIssuer.issue(approved, approvals)` only after the last approval is recorded: `gate.apply()` -> `Approved<ReleaseProposal>` -> `issue` -> `ProcessSigner`. `issue` accepts **only** an `Approved<ReleaseProposal>` (runtime-registry check). Because it is minted after approval, an hours-long wait in the case state (M13) cannot expire it; its 120 s runs from minting, it has no `parentId` (a parent TTL would otherwise make it `ttl_extended`), and it is tied to the case by `scope.release.caseId` and `traceId`. This is M8 F3: Scout is container and registry, the signer mints. The broker acts only after the `capability.issued` leaf is published (`appendBefore`, INT-018).
4. **Verification path:** the broker calls `verifyContract` and then `consume` as above; M8 runs no second token check, and the broker's field and TOCTOU checks are stages 5 and 6 against the **signed** binding.
5. **Port enforcement:** `ContractGuard.require(capability)` is the `capability` interceptor in M7's chain `[schema, kill, egress, capability, budget, port, ...]`, wrapped around every M1 channel fetch, Zetaris call, World Model write and `ctx.model` call against the run contract; refusals emit `contract.refused`.
6. **The "no Scout" ablation removes exactly this mechanism:** `ContractIssuer` returns an unsigned stub and stages 1 to 3 of `verifyContract`, `consume` and `ContractGuard` become allow-all. M8's gate, the label lattice and the broker's own re-reads (stages 4 to 6 run as the broker's independent checks against the ERP, not as contract checks) stay on. The scenarios that must change are the ones only the contract defends: forged or unsigned release, replay of a consumed contract, release for a different case, expired contract, an out-of-scope port call by a compromised discovery role (AB-SC-1..4, C9). A scenario that tampers a release **field** is not a Scout scenario (the fresh ERP comparison catches it in both profiles) and is excluded from the ablation so the attribution stays clean.

**Our stricter grader** (`eval/scout/grader.ts`, separate from the vendored runner): scores every example in all files (multi-intent set equality, clarification expected-versus-actual confusion matrix, `expected.risk` equality, exact tool-plan equality plus extra-capability rate); reports a metric as `null` (undefined) rather than 1.0 when its denominator is zero; **fails on any skipped prompt**; flags examples whose prompt is within Jaccard 0.9 of a registry `examples` string as `contaminated`; slices with Wilson intervals; extends the corpus with held-out prompts and, for Plumbline, document-borne injection snippets; reports the clarification rate against the 0.15 target and 0.25 ceiling separately for the near-duplicate-vendor slice (which exceeds it by design). Targets from `thresholds.yaml` are never quoted as measured results.

### C5.5 Tests and acceptance
| Id | Clause | Test |
|---|---|---|
| SC-RUN-01 | the vendored gate passes on `ours` with zero skipped and 32 examples | harness |
| SC-RUN-02 | the vendored gate **exits non-zero on the `inert` stub overall**, but the per-metric output is recorded: the readout reports that an inert implementation individually clears injection precision, clarification rate and override frequency, which is a finding about the runner; our grader must fail the inert stub on every scored metric | positive control (C8) |
| SC-IN-01..06 | normalisation; each guard layer; band edges 0.80/0.55/0.40; 0.05 top-two margin; high-risk below 0.95 clarifies; `GENERAL` fallback | table-driven |
| SC-PK-01 | unknown pack throws at construction; array and string forms accepted | |
| SC-CAP-01..03 | risk filter before ranking cannot be undone by utility; unresolved capability typed; `act/` absent from run contracts | |
| SC-SIG-01 | RFC 8032 vectors pass the Ed25519 signer; HMAC differential parity on a generated accept/refuse matrix | CV-1 |
| SC-VER-01..19 | one test per `Refusal`; flipping each signed field is refused; wrong audience or restore epoch; expired; `hmac` refused in `plumbline` mode; an `act/` contract under a non-`capability` `kid` refused; a payload type or `alg` taken from the envelope is ignored; verifier holding only a public key cannot produce an accepted contract | forgery suite |
| SC-ORD-01 | a contract failing several stages reports the earliest stage, and `NonceStore` is untouched on every refusal of stages 1 to 6 (mutant `consume-before-field-checks` is killed) | order |
| SC-TIM-01 | property over generated prompts: `decide` never yields `act/` in any contract; `issue` rejects anything but `Approved<ReleaseProposal>`; a release contract has no `parentId`, a 120 s window from minting, and verifies after a simulated hours-long approval wait | timing |
| SC-CON-01..03 | second `consume` refused; crash between acceptance and the store write (kill drill) cannot double-spend; concurrent consume of one nonce yields one winner; run against the test doubles here and, from build step 14, against both M13 implementations | |
| SC-REP-01 | property over generated chains: child scope never widens without approval; TTL extension refused; trace shows the chain | |
| SC-PORT-01 | adversary model port attempts every `(capability, port)` pair exhaustively: all refused with `contract.refused`; mutation: deleting the check at each port in turn fails the suite | readout A2 |
| SC-GRD-01 | grader self-test: inert fails, always-block fails, label-leaking (reads `expected`) is detected by a held-out split | |

**Disproof.** A forged, replayed or out-of-scope contract accepted; the inert stub clearing our grader; a port without a guard test.

### C5.6 Risks and NOT VERIFIED
Scout is built from prose; spec shapes conflict (`policyPack` string vs array, tool-plan shape, `primary` string vs object; brief appendix 1 items 11 to 15); we follow the runner. `node:crypto` Ed25519 signing is expected to work on Node 22 but is **NOT VERIFIED** until CV-1. The M9 signer on Windows (stdio child process, key file permissions) is untested. The split above is the register's resolution (INT-016) but two items stay open until M8, M9 and M13 adopt them: the DSSE payload type constant, and a signer role for contracts without `act/` (see the integration block). The end-to-end release path needs M13's broker and is exercised only at build step 14. Intake classification has little value for typed submissions; the claim is the boundary.

### C5.7 Build notes
Order: canonical bytes and `HmacSigner` -> verify/consume skeleton -> registry and scoring -> guard layers -> harness green (32, zero skipped) -> `ContractGuard` at ports -> replan -> grader; `Ed25519Signer` and `ProcessSigner` follow M9's step 8a (DSSE, signer process with the ledger role; register section 5, V5), and the `capability` role once M13's claims format exists. The step 10 gate states that verify/consume run against test doubles and that the release path is exercised end to end only at step 14 (register V8). Unblocks M13's broker and C9's AB-SC.

---

## C6. Engine strategy protocol (bake-off 6)

### C6.1 Best references
Spec 19a-6; `prior-art` bake-off practice in sections 19a items 1 to 5. The measured decision rule below is ours; no external method is borrowed (UNVERIFIED that a standard exists).

### C6.2 What they actually do
Not applicable (a protocol). Inputs: the extended clause suites (C2 to C5), the official reference, and a time-boxed patch spike.

### C6.3 Decision
**Own.** The spec says "if the reference passes most of them, fork"; "most" is undefined. This protocol replaces it with a pre-registered rule. Default on a tie is **implement-from-spec** (D-006, "everything our own").

### C6.4 Implementation design
This is the rule INT-062(a) adopts for spec 19a-6 in place of "most"; the thresholds below (`N_struct = 0`, `P_spec >= 0.85`, `L_patch / L_ref <= 0.5`) are the defined values and from-spec is the tie default.

**Before running anything**, commit `tests/engines/clause-classes.json`: every clause tagged `severity: S1|S2`, `origin: spec|extension`, and `fixClass: local|structural` (structural = repairing it requires changing the persisted or folded state model, the identity model, or a public sync/async signature). M6's engine requirements enter as S1 `extension` clauses (INT-062 f; M6 SF7, SF9): World Model R-WM1 (winner and `supersededBy` are a pure function of the fold), R-WM2 (resolution by plugin, `unresolved` a stored status), R-WM3 (explicit as-of on every read), R-WM4 (declared multi-valued relations); H-MEM pure `peek`, explicit `entities`, `supersededBy` set on `supersedes`, read isolation; Markovian `carryoverBuilder` with overflow signalling and measured tokens. R-WM1 to R-WM4 are tagged `structural`, so they count in `N_struct` even though they are not `origin: spec`. Record its hash in the decision record. Then, per engine, run the clause suite with `ENGINE_TARGET=reference` (`METERLESS_REFERENCE_DIR` points at the clone; if unset the bake-off reports `NOT RUN`, never a pass) and compute:
- `P_spec` = fraction of `origin: spec` clauses the reference passes;
- `N_struct` = failing clauses with `fixClass: structural` and `severity: S1`;
- `L_patch / L_ref` = non-test lines changed or added on a branch of the reference (`git diff --stat` over `src`) to pass **all** clauses including extensions, over the reference's non-test lines.

**Rule per engine:** FORK iff `N_struct = 0` and `P_spec >= 0.85` and `L_patch / L_ref <= 0.5`. Otherwise IMPLEMENT-FROM-SPEC. A per-file hybrid is allowed only when a file passes its own clause group in isolation. A FORK keeps the Apache header and a per-file "Portions adapted from Meterless, Apache-2.0, <file>; changes: ..." notice (brief section E) and is listed as third-party-derived in the sponsor explanation. Whatever the result, the vendored runner, the extended suites and the ablation stand. Decision record `D-0xx` per engine in `docs/DECISIONS.md`; results in `eval/reports/bakeoff-6.md` including the losing branch.

### C6.5 Predictions (hypotheses to be falsified, not outcomes)
World Model: `N_struct >= 3` (fold-replayable resolution, edge cardinality, single resolution path), from-spec. H-MEM: no single fatal defect but persistence, identity-map flush, scope, tombstone sleep, ledger ids, typed entities and the pinned API probably push `L_patch / L_ref` above 0.5, from-spec. Markovian: `N_struct = 0` plausible; fork possible for the config, marker-alias and prompt modules, with the orchestrator and carryover owned. Scout: no reference; always from-spec.

### C6.6 Tests and acceptance
`BO6-1` the classification file hash equals the one in the decision record; `BO6-2` the report lists every clause with the reference's result; `BO6-3` the chosen branch passes the runner and 100% of clauses (or lists registered divergences); `BO6-4` a reviewer re-runs the rule from the report and gets the same decision. **Disproof of the protocol:** the decision flips when re-run with a different clause ordering or a different patch author.

### C6.7 Risks and NOT VERIFIED
`L_patch` depends on who writes the patch (mitigation: count the minimal patch that passes, reviewed). Running the reference executes third-party code; it runs inside a compartment of C11 whose backend is recorded in the report. A fork may be judged as less original (brief risk 9); this is not scored by the rule, and the from-spec default exists for that reason.

### C6.8 Build notes
Runs after the clause suites exist for the engine and before the engine is built at full scale (spec build-order step 10, after step 3a).

---

## C7. Differential oracle against the official reference

### C7.1 Best references
Spec 12 and `prior-art/13` §(Go tlog oracle) use the same idea ("official reference as oracle"). Model-based testing with `dubzzz/fast-check` (5,199 stars, MIT, pushed 2026-10-13; metadata verified; command-based model testing not re-read here, **UNVERIFIED** in detail). XTDB as an optional bitemporal oracle (`prior-art/07` §3.1).

### C7.2 What they actually do
Not applicable; the oracle is the Meterless reference itself.

### C7.3 Decision
**Own** the harness; **adopt** `fast-check` as a test dependency. Compare only where the spec determines behaviour.

### C7.4 Implementation design
```ts
interface EngineAdapter<E> { load(target: Target): Promise<E>; apply(e: E, op: Op): Observation; shape(e: E): Json }   // normalises both implementations
```
1. Generate operation sequences (`add`, `feedback`, `query`, `sleep.preview`, `conflicts.scan`, `dream`; `upsertEntity`, `relate`, `ingest`; `modelTotals`, `run` with scripted generators) with seeded `fast-check` models; seeds print on failure with the commit.
2. Normalise observations: scores to 1e-9, ids by creation order, timestamps from the injected clock, ordering by the spec's tie-break.
3. Use the `fnv64-compat` embedder for retrieval parity.
4. **Divergence register** `tests/engines/oracle/divergences.json`: each entry `{id, engine, clause, kind: "reference-defect"|"deliberate-extension", evidence, test}`. A divergence not in the register fails; a register entry that no longer diverges also fails (stale). Seeded entries: `HM-PIN-01` (reads mutate), `HM-REL-LEDGER` (backlinks unledgered), `HM-SUP-01` (supersedes), `WM-FACT-05` (replay), `WM-EDGE-02`, `WM-ING-03`, `WM-IDEM-04`, `MK-MRK-FORGED`, `MK-LAB-ESTIMATED`.
5. **Recorded oracle transcripts**: for judges and CI without the clone, `tests/engines/oracle/transcripts/<engine>-<seed>.json` stores the reference's observations keyed by operation-sequence hash plus the reference commit; replay compares ours to the stored transcript. A transcript is regenerated only when `METERLESS_REFERENCE_DIR` is set.

### C7.5 Tests and acceptance
`ORA-1` zero unexplained divergences on N seeded sequences per engine (N chosen so the run completes in minutes; reported); `ORA-2` the register is exact in both directions; `ORA-3` transcripts equal the live reference when the clone is present; `ORA-4` a mutant (C8) that changes parity is caught by the oracle at least once per mutant class. The metric is divergence count by kind; the reference is not treated as ground truth where the spec disagrees with it.

### C7.6 Risks and NOT VERIFIED
Sequence coverage is bounded by the generator; two implementations written by one author can share a misreading (the register records reasons, but cannot catch a shared misreading of an ambiguous spec). Stored transcripts freeze the reference at `0aa7417`; they say so in their header.

### C7.7 Build notes
After each engine's runner is green; feeds C6.

---

## C8. Test integrity: inert stubs and prove-each-test-can-fail

### C8.1 Best references
Meterless's own prompt "Prove each test can fail" (meterless.ai engines page, **[B]** from the readout, not re-fetched) and `reference/scripts/idempotency-check.ts --mutate` **[B]**; `stryker-mutator/stryker-js` (3,203 stars, Apache-2.0, pushed 2026-10-10; whether a Vitest runner plugin works with our TypeScript 7 and Vitest 5 setup is **NOT VERIFIED**). The Scout inert result is the cautionary tale (`evals/reports/latest.md` **[B]**).

### C8.2 Decision
**Own** hand-written, reviewable mutants first (deterministic, each paired with the test that must kill it); StrykerJS only as an exploratory second pass whose survivors become new hand-written mutants.

### C8.3 Implementation design
**Inert stubs** `tests/engines/inert/{hmem,world-model,markovian,scout}.ts`: export the required names and satisfy `typeof` checks, return neutral values, record nothing. Required outcomes: each vendored runner exits non-zero; every extended-suite test tagged `class: behaviour` fails; the Scout vendored gate is run too and its result recorded as a finding (the readout says an inert Scout clears three of seven metrics); our grader must fail it. A **gate-level always-allow stub** is also kept for M8's gates (shared harness with M11).

**Mutants** via a single `MutantHost`: engines are built from small injected strategy objects (scoring, ledger, fold, cascade, verifier), so a mutant replaces one strategy. Listed mutants (each names its killer):
- H-MEM: `skip-feedback-ledger` (HM-LED), `no-clamp` (HM-FDB boundary sweep), `confidence-before-sum` (HM-RET), `drop-superseded-penalty` (ro-001), `read-touches-in-retrieve` (HM-PIN-01), `clone-on-add` (ro-001, HM-REC-04), `dedupe-on-add` (ro-002), `supersedes-no-pointer` (HM-ENR-05), `gate-0.5` (HM-CNF-boundary), `sleep-execute-deletes` (HM-SLP), `reinject-review` (HM-REI), `scope-filter-off` (HM-SCP), `archive-derived` (sg-001), `preview-mutates` (sg-001), `external-mutation-unflushed` (HM-PRS).
- World Model: `skip-audit` (audit-001), `swap-ge-gt-at-0.85` (band-001), `type-not-in-key` (sid-002), `no-nfkd` (sid-001), `resolution-outside-fold` (WM-FACT-05 restart), `many-edges-closed` (WM-EDGE), `ingest-bypass-resolution` (WM-ING-03), `changed-always-false` (idem-002), `timings-in-shape` (idem-001), `wallclock-timestamps` (WM-IDEM), `checksum-omits-entities` (WM-IDEM-04), `non-fifo-writes` (WM-ORD concurrency), `sha-truncate-15` (golden vectors).
- Markovian: `drop-carryover`, `marker-leak` (mrk-001), `overlap-ignored` (ovl-001), `clamp-not-throw` (cfg-001), `reflection-propagates` (ref-001), `label-always-measured` (lab-001), `nonce-check-removed` (MK-MRK forged), `truncation-in-typed` (MK-CAS), `loss-detector-off` (MK-TYP), `memory-every-chunk` (MK-MEM), `two-accounting-paths` (MK-EFF consistency).
- Scout: `skip-signature`, `ignore-ttl`, `scope-unchecked`, `consume-skipped`, `hmac-accepted-in-plumbline-mode`, `bidi-not-stripped`, `unknown-pack-no-throw`, `guard-after-ranking`, `child-scope-widened`, `throw-in-decide` (grader skip counter), `consume-before-field-checks` (SC-ORD-01), `alg-read-from-envelope` (SC-VER), `act-in-run-contract` (SC-TIM-01).

### C8.4 Tests and acceptance
`MUT-1` every listed mutant fails at least its named killer (mutation score over the listed set must be 100%; a surviving mutant is a missing test and is fixed before the engine is claimed); `MUT-2` every inert stub fails the runner and all behaviour clauses; `MUT-3` the CI job fails if an inert stub passes any scored gate of ours; `MUT-4` the published table (mutant, killer, result) is generated, not hand-written. Metric: mutation score on listed mutants; the exploratory Stryker score is reported separately and never as the headline.

### C8.5 Risks and NOT VERIFIED
A mutant list is only as good as its author's imagination; equivalent mutants are excluded with a stated reason. Strategy injection adds indirection to hot paths (performance is not a concern at case scale).

### C8.6 Build notes
Mutants are written alongside each clause; the inert stubs exist from C1 (the first CONF-2 check).

---

## C9. Per-engine switch-off ablations

### C9.1 Best references
Spec 12 and 21a (no ablation, no claim); readout C3 (honest warm/cold) and brief section D.7: Meterless's `examples/memory-compounding-research/index.ts` hard-codes `SETTLED_BY_MEMORY = new Set([2, 3, 7, 8])` in its mock generator, so the saving is built in **[R]**; ours must not be.

### C9.2 Decision
**Own.** Each ablation is a profile that replaces the engine port with a null object and a pre-registered scenario with named output paths. Output paths belong to M3, M5, M9, M13; names below are binding proposals to confirm with those modules.

### C9.3 Implementation design
Profiles `profiles/ablate-<engine>`: `NoWorld` (flat last-write-wins attribute map with no valid time, no history, no `unresolved`), `NoMemory` (empty retrieval), `NoChain` (single-context execution of the same task), `NoScout` (permissive issuer and verifier, C5.4 item 6). Null objects are importable only under `ABLATION=1`; an import-graph test proves the `full` profile cannot reach them. Each run emits `AblationDelta { engine, scenario, path, withValue, withoutValue }` records and the test asserts the named paths differ.

**Scenarios (all pre-registered; "expected" columns are filled from measurement, never edited afterwards):**

| Id | Scenario | Output that must change when the engine is off |
|---|---|---|
| AB-WM-1 | Ownership changed after the PO date; current owner is on a list, owner on the PO date is not | `truthTable.cells[owner@poDate].value` and `.status`; `decision.why[].codes` contains `OWNERSHIP_AS_OF_PO_DATE` only with the engine; flat store answers with the current owner |
| AB-WM-2 | Two sources disagree on bank account at equal authority | cell status `unresolved` and an escalation with the engine; silent winner without it |
| AB-WM-3 | Process restart mid-case | state shape equal to uninterrupted with the engine; reference-style resolution would lose winners (control arm = the reference run through the oracle adapter) |
| AB-WM-4 | Wrong link then un-merge | truth-table hash returns to its pre-link value only with `unalias` |
| AB-HM-1 | Case with allowed set of size >= 2 where the rule brain's precedent tie-break depends on precedent | `decision.action` or `judge.input.precedentIds` differ; `precedent.trace.hits[]` empty |
| AB-HM-2 | Same, with a superseded precedent seeded | naive-recency memory (second ablation arm) includes the stale precedent and the decision is wrong; H-MEM suppresses it (`trace.suppressedSuperseded >= 1`) |
| AB-HM-3 | Pre-registered warm/cold on gold decisions with a real model (readout C3) | decision accuracy and measured tokens, worst of three runs; negative control with a stale precedent included must show harm; a null result is published and H-MEM is then not claimed as load-bearing |
| AB-MK-1 | Ownership chain of depth D in {4, 8, 12, 16, 24} | `markovian.run.chunks[].promptTokens` summed (measured) versus single-context total; single-context exceeds the context budget at large D (`BudgetError`, `completeness: partial`); at small D no saving, reported |
| AB-MK-2 | Injected dropped sanctions-hit id | with the detector: `carryover-loss`; without: the hit is absent from the dossier |
| AB-SC-1..4 | forged/unsigned release; replay of a consumed contract; release bound to a different case; out-of-scope fetch by a compromised discovery role | broker result `refused{reason}` and `contract.refused` trace with the engine; executed (simulated) release or fetch without it |

### C9.4 Tests and acceptance
`ABL-1` every scenario's delta paths differ; `ABL-2` null objects unreachable from `full`; `ABL-3` the positive control for AB-SC runs the attack against the `NoScout` profile and **succeeds** (the attacks must work on the undefended baseline); `ABL-4` an engine with no passing ablation is removed from the README claims (spec 21a). Report: per scenario, with and without values, n runs, worst of three for model-backed items, and the list of scenarios not run.

### C9.5 Risks and NOT VERIFIED
AB-HM and AB-MK need model credentials for the real-model arms (rule-brain arms run without). If rules decide nearly all cases, H-MEM may not move any decision (a legitimate null). AB-WM-1 assumes M3 exposes as-of cells. The expected policy action in each scenario depends on M5's rules and is fixed in the M11 gold set.

### C9.6 Build notes
After each engine and its consumer module exist; AB-SC first (cheapest, needs only C5 and M13's broker stub).

---

## C10. Generated engine-usage map

### C10.1 Best references
Meterless starter guidance "every command routes through a named engine service" with the spec section (`docs/community/hackathon-guide.md` **[B]**); World Model `AGENTS.md` sections 8.3 and 13 "the wired-vs-helper trap: audit what is actually injected at runtime, not what could be" **[B]**. Meterless's own guide gives 25 of 100 judging points to engine usage and says the starter README maps each command to its engine service **[B]**.

### C10.2 Decision
**Own** a generator. The map is documentation produced from the code and the traces, not product code (spec 19).

### C10.3 Implementation design
1. `src/engines/**/surface.json` per engine: every exported API with its spec section and `class: conformance|extension|unused-by-product`.
2. Engines emit `engine.call` events through `trace`: `{kind, engine, api, path: "decision"|"setup"|"evidence"|"maintenance", reqId, caseId?, inputHash, outputHash, why}`; named events `hmem.retrieve`, `hmem.feedback`, `world.assertFact`, `world.merge`, `markovian.chunk` (step, cascade level, carryover tokens, prompt tokens with label), `scout.decision`, `contract.issued|verified|refused`.
3. M10 command and UI-action manifest declares `engineServices[]` per action.
4. `scripts/engine-usage-map.ts` reads the recorded scenario traces and the manifests and writes `docs/submission/engine-usage-map.md` with columns: action or command, engine service, spec section, code path, trace event, test id, call count in the decision path. It also lists "implemented, not used" APIs separately.
5. CI fails if (a) the committed map differs from regenerated output, (b) any claimed API has zero decision-path calls in the scenario set, (c) an API with calls is missing from `surface.json`.

### C10.4 Tests and acceptance
`MAP-1` regenerate equals committed; `MAP-2` remove an engine call from a decision path, the check fails; `MAP-3` the map equals the call sites exercised by the ablation runs (C9); `MAP-4` mining and dreaming appear only under "implemented, not used".

### C10.5 Risks and NOT VERIFIED
The manifest format depends on M10. A trace-derived map proves calls happened in recorded scenarios, not that they were necessary (that is C9).

### C10.6 Build notes
Trace events are added as each engine is built; the generator comes with the first scenario recording.

---

## C11. Local-first proof and the egress manifest as executable tests

### C11.1 Best references
- Ink & Switch, "Local-first software" (Kleppmann, Wiggins, van Hardenberg, McGranaghan, April 2019, **[F]**): seven ideals including "The network is optional" and "Security and privacy by default".
- Node.js permission model, v22 documentation (**[F]**, 2026-10-13): `--permission` is stable from v22.13.0 and restricts file system (`--allow-fs-read`, `--allow-fs-write`), child processes (`--allow-child-process`), worker threads (`--allow-worker`), native addons and WASI; the fetched v22 page lists **no network permission**. This resolves a spec NOT VERIFIED (section 5): the Node 22 permission model cannot deny network. Network denial comes from an OS or container backend, or from Node 25 or later (`--allow-net`, Stability 1.1 per M8 C8, not verified here); the documentation itself gives no security guarantee against malicious code.
- Meterless privacy pages and model-routing docs (data classes, redaction before reinjection) **[B]**, readout B1.

### C11.2 Decision
**Own** the tests. The mechanism and the claim belong to M8 C8 (INT-019): its doctor probes `CompartmentBackend` in the order `os-netns`, `node-net-permission`, `node-flags-only`, and the claim follows the probe. The in-process guard (M1's SAMPLE_MODE throwers, arm 2) is a second, weaker control for our own code paths and never counts as the compartment claim.

### C11.3 Implementation design
**What is claimed (precisely).** The four engines and the context operations (retrieve, assertFact, ingest, a chunk run with a scripted generator, Scout decide and verify) run with no network available, with engine state on disk. The words "network denied" appear only next to the probed backend name (`os-netns`, `node-net-permission`); under `node-flags-only` the report says the claim is not made. Not claimed: that hosted Nemotron extraction is local (a local `modelProfile` exists for confidential documents and the manifest says which profile ran).
1. **Static:** an import-graph test fails if anything under `src/engines/**` imports `node:net|http|https|http2|tls|dns|dgram|child_process|worker_threads` or references `fetch`/`XMLHttpRequest`/`WebSocket`; allowed file I/O only through `SyncJournal`.
2. **Runtime, in-process guard (second control, not the claim):** the test bootstrap replaces `globalThis.fetch` and the listed modules' connect functions with throwers (`EgressViolation`) and runs the context-operation suite under `SAMPLE_MODE`; a positive control proves the throwers fire (a deliberate `fetch` in a canary test fails the run).
3. **Runtime, permission flags (backend `node-flags-only`; `node-net-permission` on Node 25 or later with no `--allow-net`):** run the same suite on **compiled JavaScript** under `node --permission --allow-fs-read=<repo> --allow-fs-write=<scratch>` with no `--allow-child-process` and no `--allow-worker`. Filesystem, child-process and worker denial are claimed under `node-flags-only`; network denial only under `node-net-permission`, with a positive control. Whether `tsx` can run under these flags is **NOT VERIFIED** (its loader may need a worker or child process), which is why this arm uses compiled output.
4. **Runtime, OS level (backend `os-netns`):** in CI and the clean-room verifier, run the suite in a network-less sandbox (Linux `unshare -n`, or a container with networking disabled); a positive control opens a TCP connection and must fail. On the Windows development machine only arms 1 to 3 run and the report names `node-flags-only`.
5. **Egress manifest** (declared by adapters, enforced by M8's funnel): each adapter contributes M8's `EgressEntry` records (`id, sink, channelId, hosts, methods, paramSchema, maxConf, maxPersonal, modelProfile, disclosureProfile, disclosures[], purpose`; INT-020) to the one generated `egress-manifest.json`, and sends only through `ctx.net`; `profile` in the earlier draft is `modelProfile` (`sponsor | evaluation | local`) and the run header records `modelProfile` and `disclosureProfile`. Tests: `EG-1` hosts observed in a live-record run are a subset of the manifest (entries never exercised are marked "unexercised", not failed); `EG-2` seed canary values in `internal-sensitive` fields and assert zero occurrences in any recorded outbound request except at declared `disclosures[]`, where only the minimised form may appear, with a negative control (redaction off, the canary appears); `EG-3` a `modelProfile` not cleared for a data class refuses the call (`policy` error), fallbacks must satisfy the same class (Meterless model-routing rule; classes translated by C11a); `EG-4` the engine state directory contains the expected files after a run (the local-first evidence a judge can open); `EG-5` M8's socket tap (`SEC-O6`) sees no connection that did not go through `ctx.net`.

### C11.4 Tests and acceptance
As numbered above plus `LF-1` offline run of the 6 recorded scenarios produces identical outputs to the online-cassette run. Metric: egress attempts during the offline run = 0 with the positive control firing, reported per backend.

### C11.5 Risks and NOT VERIFIED
In-process throwers can be bypassed by code that captures references early; hence the OS-level arm. The Windows host cannot run arm 4. `--permission` compatibility with the test toolchain is unconfirmed. The manifest says nothing about volume or timing side channels (spec section 5).

### C11.6 Build notes
Arm 1 and 2 from the first engine commit; arms 3 and 4 when the clean-room verifier exists.

---

## C11a. Data-class map (`dataClassMap.json`)

Meterless documents and routing text label data `public | internal | confidential | restricted` (readout B1); the spec and the shared `Confidentiality` type use `public | case-visible | internal-sensitive` plus the `personal` flag. A profile "cleared for internal" in a Meterless document must never be read as cleared for a more sensitive spec class. M14 SF8 asked this module to hold the table; INT-009 adopts it. **Decision: own**, one data file, nothing inferred in code.

**Design.** `policy/dataClassMap.json`, entries of the shared `DataClassMapEntry {foreign, to, personal?}`:
```json
{ "v": 1, "map": [ { "foreign": "public",       "to": "public" },
                   { "foreign": "internal",     "to": "case-visible" },
                   { "foreign": "confidential", "to": "internal-sensitive" },
                   { "foreign": "restricted",   "to": "internal-sensitive", "personal": true } ],
  "unmapped": "internal-sensitive" }
```
`mapForeignClass(c): { to: Confidentiality; personal: boolean; mapped: boolean }` is pure. Matching is exact after NFKC, trim and lowercase; any other value, including empty, null and look-alike strings, maps to `internal-sensitive` with `mapped: false` and a `dataclass.unmapped` trace line, so an unknown label can only restrict. `internal` maps to `case-visible` because the readout clears the hosted profile for `internal` only after structural redaction, the same condition the spec sets for `case-visible` (C14 item 6); `restricted` carries `personal: true` because full account numbers and tax ids can identify a sole trader (conservative; the legal status is a LAWYER item). The file's hash is an input to M8 C10's surface lock; changing the map is a lock diff. Consumers: model-profile clearance (C14), Zetaris column tags (C13), `risk.redactions` in Scout, and any Meterless document read into the repository. M14 C15 and everything downstream use the spec vocabulary only.

**Tests.** `DCM-1` each entry maps as written. `DCM-2` unmapped, empty, null, upper-case, padded and look-alike (Cyrillic) inputs: case and padding fold to the mapped class, the rest map to `internal-sensitive` with `mapped: false`. `DCM-3` monotonicity: for every foreign class and every `modelProfile`, the spec class's clearance is no wider than the foreign class's clearance stated in the readout (table-driven). `DCM-4` the file hash equals the lock entry; a mutated map fails the lock. `DCM-5` mutant `unmapped-defaults-public` is killed by DCM-2.

**Risks and NOT VERIFIED.** The mapping of `internal` is a judgement from the readout, not from Meterless's own definition (the data-class pages were not re-read). `restricted` to `personal: true` is an assumption pending legal review.

---

## C12. Upstream feedback and the community eval

### C12.1 Best references
The Meterless repository's `CONTRIBUTING.md` ("what was ambiguous, what was missing, what broke" is the contribution they want, **[B]**); the H-MEM community-eval template (`engines/hmem/evals/tests/README.md` **[R]**: markdown files under `evals/community/<name>-<type>-<description>.md` with sections Contributor, Project type, What this eval tests, ...); `engines/hmem/CONTRIBUTING.md` asks for markdown only in that folder **[B]**; issue #3 (open) and Discussions (enabled) **[R/gh]**.

### C12.2 Decision
**Own** the drafts; **do not post** before Prateek decides and the organizer-rule question is answered (posting or contributing upstream before the build window is **NOT VERIFIED** as compatible with the originality rules; readout E4). Issues are filed only with a failing test of ours and a reproduction command that runs clean from a fresh clone.

### C12.3 Implementation design
Drafts in `docs/sponsors/upstream-feedback/` (gitignored until approved): (1) a **comment on #3** with our failing test and the one-line fix (do not open a duplicate); (2) World Model: merge-threshold discrepancy between `AGENTS.md` 7.1 (proposal at >= 0.85, never auto-destructive), `docs/ingest-pipeline.md` (auto at >= 0.92) and the runner (auto at >= 0.85), with the Series A/B similarity 0.9412 example; (3) World Model fact resolution not reproduced on replay, edge closure of many-valued types, ingest bypassing resolution (each as a failing test, only after we hold it); (4) H-MEM reads mutate ranking; (5) Scout runner coverage: `expected.intents`, `expected.clarification` and `expected.risk` unscored, subset "precision", precision 1.0 on empty, skipped prompts leave denominators, a proposal to pass `snippets`; (6) Markovian marker parsing on raw model output (**security-relevant: follow `SECURITY.md` of the repository, report privately first**). Community eval: `plumbline-hmem-stale-vs-current-precedents.md` in their template, exported from HM-SCP and AB-HM-2 as a by-product. Per-class injection JSONL for Scout in their corpus format.

### C12.4 Tests and acceptance
`UP-1` each draft's reproduction command passes the "fails on reference, passes on ours" check in CI; `UP-2` no draft contains a credential or personal path (secret scan); `UP-3` a posting checklist records Prateek's decision and the date. No metric beyond that.

### C12.5 Risks and NOT VERIFIED
Rules compatibility (above); the maintainers' response is outside our control; a public security report is held until their policy is followed.

### C12.6 Build notes
Last, after C7 holds the failing tests.

---

## C13. Zetaris sponsor edge

Scope: module 01 owns `SiloPort`, the REST/JDBC clients and the MCP fallback; M12 owns the **sponsor-proof and profile wiring** around it. Paths, as in INT-045 and M1: the **live path is REST**; JDBC is a record-time oracle for type decoding and the differential test; MCP is the fallback behind the roadmap gate; the judge path is cassettes. All of it stays NOT VERIFIED until a trial account exists.

**C13.1 References.** `docs/sponsors/zetaris-docs-readout.md` (verified facts, 2026-10-13): the hackathon repository documents JDBC and REST only; MCP appears nowhere in it and "MCP Toolkit" is listed Enterprise-only; two REST surfaces differ (`POST /sql-editor/sqls/run`, `POST /api/v1.0/query/sql/start` with `queryToken` paging, `pageLimit` 1 to 100), both return values as strings; most registration, USL, DQ and grant commands are administrator-only; the audit-log read path is not documented; trial terms conflict (30-day evaluation versus a free tier). All **vendor text, none observed live**.

**C13.2 Decision.** **Adapt**: M01's adapter is the only code that talks to Zetaris; M12 adds (a) the sponsor-proof test, (b) profile selection, (c) capability and egress declarations.

**C13.3 Design.**
1. `ZetarisEdge` in `profiles/full`: `mode: "live" | "cassette" | "embedded"`. `embedded` serves the same schema from the synthetic silos (the baseline profile, always available).
2. **Capability:** every Zetaris call is guarded by `read/zetaris.query` (C5); the contract's `aud` for these calls is the channel id.
3. **Egress entry:** one M8 `EgressEntry` (INT-020) with `hosts` from configuration (`NOT VERIFIED` until the trial) and `maxConf` of `internal-sensitive` only for masked views the buyer role may see, otherwise `case-visible`; any Zetaris column label is translated by C11a; requests go through `ctx.net` only.
4. **Sponsor proof (minimum viable, needs only read access):** `ZP-1` one documented REST query (the live path) over whatever data the event instance exposes; `ZP-2` the returned rows (strings parsed by our schema; silent type drift rejected) enter an `Evidence` record with `channel = "zetaris"`; `ZP-3` those rows appear in a decision's `factIds`; `ZP-4` the query text and result hash are in a hash-pinned cassette and the cassette replays offline; `ZP-5` a fault drill (timeout, 429/502, stale result, string-typed decimals such as `0E-18`) gives typed failures, not empty success; `ZP-6` with credentials absent the run fails with a clear logged error and falls back to `embedded`, labelled in the trace.
5. **What counts as real use:** `ZP-1..3` pass **live at least once**, with the trace line carrying the query hash, row count and server-reported latency; cassette replay alone is not "used Zetaris" for the claim. Conditional items (role-scoped masked views, federated reads, native-agent baseline arm) are claimed only if the trial grants the rights, each with its own test in M01. The audit-log cross-check is **MAYBE** until a documented read path exists (INT-062 h); it is not claimed or promised.
6. **Ablation F-ZROLE:** embedded loader versus Zetaris path differs in the evidence record and in at least one case where masking changes what M4 may cite.

**C13.4 Risks and NOT VERIFIED.** Everything about the live instance. Needs Prateek: a trial account (one line, exact step). Cost: none in M12 beyond tests.

---

## C14. NVIDIA Nemotron `ModelPort` adapter (bake-off 7)

### C14.1 Best references
- NVIDIA hosted API documentation (**[F]**, partial): base `https://integrate.api.nvidia.com`, `POST /v1/chat/completions`, described as mirroring the OpenAI chat-completions pattern. The authentication header, structured-output parameters (`guided_json`, `response_format`, `nvext`), rate limits and quotas were **not** in what the fetch returned; NIM structured-generation documentation could not be retrieved (empty page). So: **base URL and path verified; everything else NOT VERIFIED.**
- Constrained-decoding backends a NIM-class server may use: `dottxt-ai/outlines` (15,922 stars, Apache-2.0), `mlc-ai/xgrammar` (1,957, Apache-2.0), `guidance-ai/llguidance` (888, MIT) (metadata only; which, if any, the hosted endpoint uses is NOT VERIFIED). Their evaluations concern decoding speed and validity, not extraction accuracy loss on our schemas.
- Provider failure taxonomy from Meterless Swarms release notes (`rate_limit`, `quota`, `transient`, `fatal`; readout G1, **[B]**).

### C14.2 Decision
**Own** the adapter behind M7's `ModelPort`; **adopt** the OpenAI-compatible wire shape (no SDK dependency: a thin client over `ctx.net`, the `NetPort` that M8's egress funnel implements, so every call passes the egress check and is recorded and replayable; the adapter never calls `fetch` itself).

### C14.3 Implementation design
```ts
interface NvidiaPortConfig { baseUrl: string /* default https://integrate.api.nvidia.com */; apiKeyEnv: string /* name chosen by us */;
  modelProfile: "sponsor" | "evaluation"; models: ModelInventoryEntry[]; quota: QuotaPolicy; structured: "auto" | "constrained" | "prompt" }   // `local` is a separate adapter of the same port
interface ModelInventoryEntry { id: string; family: string; sizeTier: "small" | "medium" | "large"; verifiedAt: Iso; capabilities: { json?: "constrained" | "prompt" | "unknown"; tools?: boolean; embeddings?: boolean }; contextTokens?: number }
```
1. **Model inventory verification (before H5 or any family claim).** `doctor` calls the models listing endpoint if one exists (**NOT VERIFIED that it does**); otherwise probes each configured id with a one-token request; records the real response `model` field, family and latency; writes `docs/sponsors/nvidia-integration-notes.md` rows only from these probes. A model id used in a trace must equal an id verified in the inventory.
2. **Model profiles (enforced in code, not by convention).** `modelProfile = sponsor`: allowlist of Nemotron ids only; `ModelPort.call` rejects any other id with error class `policy`; heterogeneity is size tiers only and the trace labels `family: "nemotron", heterogeneity: "same-family"`; the rule brain never runs under it. `evaluation`: multi-family (verified inventory plus other OpenAI-compatible endpoints) for every measured claim. `trace` always records `modelProfile`, `model`, `family`, `rulebrain: false`. The adapter implements M7's `ModelPort` additions (register section 2.2): `capabilities: { structuredOutput: "none" | "json_schema" | "grammar"; reasoningCapTokens: number }` filled from the inventory probe, and `canonicalRequest(req)`; the budget reservation includes `reasoningCapTokens`, and the estimator must upper-bound input usage for the budget guarantee to hold (INT-058).
3. **Structured output ladder.** (a) schema-constrained decoding if the inventory probe confirmed a mechanism (exact parameter names to be filled from the verified docs); (b) prompt-only JSON; (c) tool-calling JSON if supported. Our schema validation runs in every case; the validator **rejects, never repairs**; one retry is a new budgeted call (at most 2). Parse failures count as `validation` errors.
4. **Quota and failure.** A token bucket per model from configured `rpm`/`tpm` and from `Retry-After` when present (**NOT VERIFIED** header); error classes `rate_limit` (full-jitter retry, each attempt charged to the M7 budget), `quota` (fail fast), `transient`, `fatal`, mapped to M7's `ErrorClass`. Budget is reserved before each call.
5. **Cassettes are M7's** (effect slot with request-hash verification, INT-042); the adapter supplies `canonicalRequest(req)` = `{modelProfile, model, params (temperature, top_p, max_tokens, seed), messages, schemaHash, toolsHash}`, whose `DocHash` is the request hash, and the recorded response carries the provider `usage`, response id, latency and `recordedAt`; the Authorization header is never stored (secret scan on every cassette). A miss is `E_CASSETTE_MISS` (class `fatal`, with the `RUN_LIVE` hint), never a silent live call. `usage` feeds Markovian's `measured` label.
6. **Data classes.** The hosted `modelProfile` is cleared for `public` and, after structural redaction (stable placeholders, resolved after the answer), `case-visible`; `internal-sensitive` and confidential contract text go to the **local OpenAI-compatible profile**, and the egress manifest names the profile that ran. Foreign class labels are translated by C11a before any clearance check, and the `model_prompt` `EgressEntry` of this adapter caps `maxConf` at `case-visible` with `personal: false` (M8 C3).
7. **Bake-off 7 protocol (structured output).** N extraction calls per schema on gold documents per arm (constrained / prompt-only); metrics: parse-failure rate with Wilson interval, field-level accuracy against gold with document-clustered bootstrap, tokens and latency; decision: adopt constrained decoding if parse failures drop and accuracy is not worse than a pre-registered TOST margin; otherwise prompt-only. Reported whichever way.
8. **Sponsor proof.** `NV-1` a trace carrying a verified Nemotron model id, provider `usage`, response id and latency from a **live** run (`npm run proof:nvidia` makes one call and writes `output_examples/sponsor/nvidia-proof.json` with the model id, usage, response-id hash and a timestamp); `NV-2` the sponsor-profile end-to-end run uses Nemotron only; `NV-3` the cassette recorded from it replays offline. For the in-kind prize "Best use of NVIDIA Nemotron" the extra demonstrable item is NV-2 plus the published bake-off 7 result.

### C14.4 Tests and acceptance
`NVA-1` profile enforcement (other family rejected under `sponsor`); `NVA-2` fault drills at the HTTP layer (429, 402/quota-shaped, 500, 400, truncated JSON) give the expected class, retry count and budget charge; `NVA-3` the `canonicalRequest` hash changes with any param; `NVA-4` no credential string in any committed cassette or trace; `NVA-5` replay of a different input is an `E_CASSETTE_MISS`; `NVA-6` inventory probe refuses an unverified id. Metrics: parse-failure rate, retries per call, cost per case.

### C14.5 Risks and NOT VERIFIED
Authentication format, models endpoint, rate limits, constrained decoding, available families, embeddings endpoint, whether a Nemotron reasoning mode needs handling in outputs (and the value of `reasoningCapTokens`), and the effect of long contexts: all **NOT VERIFIED** until an API key exists. "OpenAI-compatible" is supported only for the base URL and the chat-completions path. No OCR path is claimed through Nemotron: Tesseract.js is not a Nemotron path and the judge OCR default is classical (M2). Needs Prateek: an NVIDIA API key. The adapter is fully buildable against a recorded HTTP fixture and a local OpenAI-compatible server before then.

### C14.6 Build notes
Order: wire shape and cassettes against a local server -> profiles -> quota/failure -> inventory doctor -> structured ladder -> bake-off 7 when a key exists.

---

## C15. Cursor evidence trail

### C15.1 Best references
Cursor documentation (**[F]**, `cursor.com/docs/context/rules`, 2026-10-13): project rules live in `.cursor/rules`, must use the `.mdc` extension ("a plain `.md` file ... is ignored"), frontmatter fields `description`, `globs`, `alwaysApply`, four application modes, and `AGENTS.md` is supported natively in the root and subdirectories. Official Rules require Cursor as the development environment (spec 19); the repository has `.cursor/rules/{00-project-standards,10-agent-design,20-submission-and-hygiene}.mdc` and `docs/sponsors/cursor-usage-log.md` (empty rows). Funders (NLnet) require AI-use disclosure (spec 18).

### C15.2 Decision
**Own** a log schema and a checker. Cursor is an evidence trail, not an adapter: the module row is renamed "Sponsor adapters and evidence" and the trail is owned by the submission kit (INT-062 g, Spec feedback 9). This section is the design source for the log schema and the checker; M12 ships no runtime code for Cursor, and nothing in `src/` depends on it.

### C15.3 Implementation design
**What counts as real use.** A session counts only if: it happened in the Cursor IDE (screenshot showing the Cursor window, the agent/Composer/Tab/rules panel, and the diff); it produced a change to files the row names; those files exist and changed in repository history on or after the session date; and the row says which Cursor feature did what. "Cursor installed" or a single screenshot is not use. Claude Code and other assistants are also used and are disclosed in `docs/sponsors/ai-use-provenance-log.md`; the explanation never implies Cursor did work it did not.

1. **Log schema** (`docs/sponsors/cursor-usage-log.md` stays human-readable; a sibling `cursor-usage-log.json` is the machine form): `{ dateUtc, who, feature: "agent"|"tab"|"composer"|"rules"|"mcp"|"other", summary, files[], result, screenshot, cursorVersion, assistantsAlsoUsed[] }`.
2. **`scripts/cursor-evidence-check.ts`:** validates every row (screenshot exists under `docs/submission/evidence/cursor/` with the pattern `YYYY-MM-DD-hhmm-topic.png`; files exist; each named file has a commit touching it on or after `dateUtc`, from `git log`; no secrets via `scripts/secret_scan.py --stdin`; images listed in a reviewed-images file, per F-IMAGES); computes counts per feature; fails on a row older than the repository's first commit or after the last.
3. **Rules mirror check:** hash the normalised rule bodies of `AGENTS.md`/`CLAUDE.md` and `.cursor/rules/*.mdc`; the check fails when the mirrored sections drift, and verifies each `.mdc` has frontmatter (a rule without it is silently ignored by Cursor, per the documentation).
4. **Sponsor-explanation generator:** `docs/submission/sponsor-technology-explanation` Cursor paragraph is produced from the JSON log and may only state features with at least one validated row and two concrete examples (a refactor, a debugging session, a generated test), as the template requires.
5. The check is evidence-consistency, not proof of authorship: it cannot show Cursor produced a given line. The README says "consistent with" and links the log.

### C15.4 Tests and acceptance
`CUR-1` checker passes the real log; `CUR-2` fails a row with a missing screenshot, a file with no later commit, a row dated before the first commit, a secret in the summary; `CUR-3` rules-mirror drift detected on a seeded change; `CUR-4` an `.mdc` without frontmatter flagged. Acceptance for the sponsor claim: at least the number of sessions and features the explanation template requires, each validated.

### C15.5 Risks and NOT VERIFIED
Cursor version and any "Space XAI" access are blank in the log today. Whether Grok Build is an acceptable alternative is NOT VERIFIED; Cursor stays required. Sessions before the commit gate (22 Oct) leave screenshots but no commits, so the git-history check applies only after the window; earlier sessions are validated by screenshots and dated log rows and are declared pre-existing (spec F-PREEX). **Needs Prateek:** actually working in Cursor and taking the screenshots; no code can substitute.

---

## C16. Bright Data (documented non-goal)

**Decision.** Not built. The Official Rules never mention Bright Data; only the academy FAQ describes an optional bounty (`docs/sponsors/bright-data-integration-notes.md`: bring an existing project, meaningfully integrate Bright Data, record the pre-window state, target a small site set, cache a sample). Spec F-BOUNTY: dropped unless HackOS confirms a bounty and Prateek wants it.

**What exists instead.** The M1 channel contract already admits one more backend on the web channel, so nothing is reserved in code and no stub is written (a stub would be a claim). The README technology table lists Bright Data as "not used" with the reason.

**Trigger and plan if reopened.** (1) Read the HackOS Bright Data folder first; its API is not guessed. (2) A backend on the web channel producing secondary-authority `Evidence` that changes at least one seeded decision, with a cached sample and an on/off ablation. (3) Scraping hygiene from the notes (public data only, no personal data, source URL, date, licence in `data/README.md`).

**Test now:** `BD-1` documentation lint fails if any file under `src/` or the README claims Bright Data usage while no backend exists.

---

## Interfaces table

| Interface | Provided by | Consumed by | Notes |
|---|---|---|---|
| `HMEM` facade, `peek`, `snapshot/retrieve/recordRead` | M12 C2 | M6 (precedent store, rerank factors, counter-queries), M9 (ledger head leaf), M5 (via M6) | `peek` and `retrieve` pure; M6 supplies `PureRerank`; explicit `entities`, `recencyAnchor` |
| `WorldModel` facade, pure-fold API (`fold`, `view` with explicit `AsOf`, `pin`), `foldFiltered`, `entityAsOf`, `buildCaseContext` | M12 C3 | M3 (`FactStore`, alias projection, `ResolverPlugin`), M4 (`phase1` reads `view("assertions")`, brute-force `foldFiltered`), M10 (review panel), M6 (retraction) | M3 owns resolution rules; `product` and `conformance` profiles |
| `Markovian` typed profile, `ratify`, `CarryoverPort`, `carryoverBuilder` | M12 C4 | M6/M7 (deep chains), M5 (ratify before dossier) | one case per run |
| `ExecutionContract` container, `ContractIssuer`, `verifyContract` (stages 1 to 6), `consume` (stage 7), `ContractGuard` | M12 C5 | M8 (issue from `Approved`; supplies binding contents and stage 3 to 6 predicates), M13 (broker: verify, consume, re-validate), M7 (`capability` interceptor), M1 (channel guards) | the only release capability (INT-016) |
| `SyncJournal` port | M7 (INT-056) | engines C2 to C4 | local durable effect, not cassetted; tenant-prefixed streams |
| `ProcessSigner` (client of the M9 signer, role `capability`) | M12 C5 | M13, M8 | the signer process, role policies and key registry are M9's (INT-017) |
| `dataClassMap.json`, `mapForeignClass` | M12 C11a | M8 (surface lock C10), M14, M12 C13/C14 | unmapped is `internal-sensitive` (INT-009) |
| `ModelPort` adapters, inventory, profiles | M12 C14 | M7, M14 (roster, routing), M11 (evaluation profile) | |
| Conformance harness, clause matrices, mutants, ablation profiles | M12 C1, C6 to C9 | M11, CI, clean-room verifier | |
| `engine.call` trace events, `surface.json`, usage map | M12 C10 | M7 trace linter, M10 manifest, submission kit | |
| Egress declarations (`EgressEntry`, M8 schema) | M12 C11, C13, C14 | M8 egress manifest and funnel (`ctx.net`), M7 recorder | `modelProfile`, `disclosureProfile` (INT-020) |
| Zetaris sponsor proof tests | M12 C13 | M1 (client), M11 | |
| Cursor evidence log schema and checker | submission kit (design source M12 C15) | submission kit | evidence, not an adapter |
| Inputs required from others | M7: ports (`ctx.net`, `SyncJournal`, `SignerPort`, `ModelPort` additions), JCS; M8: `Approved<T>` registry, labels, `ReleaseBinding`, `EgressEntry`, compartment backends; M3: `ResolverPlugin`; M13: `NonceStore` (WAL and exclusive-create implementations), broker, readers for stages 5 and 6; M9: signer process, DSSE; M10: command manifest | | |

## Spec feedback

1. **Resolved by INT-062(a).** **Section 12 vs 19a-6 vs D-006.** "Built from the specs, or forked ... where bake-off 6 shows the reference holds up": "most" is undefined. C6 supplies a measured rule with from-spec as the tie default; DECISIONS needs one record per engine.
2. **Resolved by INT-010.** **Section 4 (JCS, no floating-point numbers) vs engines.** H-MEM confidences, World Model fact confidence, Scout contract confidence and scores are floats. Anything hashed, signed, recorded or cassetted needs the named integer scales (`Ppm`, `Milli`, `MinorUnits`); floats are allowed only in memory. The spec states this once (section 4) and the shared types name the scales; cross-cutting rule (d) applies it here.
3. **Resolved by INT-056.** **Section 4 (ports) vs synchronous engines.** The runner-bound H-MEM surface is synchronous and holds live objects; a persistence port must be synchronous. `SyncJournal` is an M7 port (local durable, not cassetted, in-memory default).
4. **Resolved by INT-019.** **Section 5 (Node permission model "if the pinned Node version provides it").** The fetched v22 documentation: filesystem, child-process, worker, addon, WASI restrictions exist and are stable from v22.13.0; **no network permission**. Network denial comes from an OS or container backend or from Node 25 or later; the mechanism and the claim are M8 C8's, and the backend that ran is recorded (C11).
5. **Resolved by INT-016.** **Capability naming (SPN-03).** Sections 5, 14a and 19 name three capability objects. They are one `ExecutionContract` with `ReleaseBinding` (C5.4); sections 5 and 14a reference it by name, and M8 runs no second token check. The Scout ablation is defined to remove exactly that mechanism and is limited to forgery, replay, wrong-case, expiry and out-of-scope port scenarios.
6. **Resolved by INT-062(b).** **Section 12 "stricter auto-merge threshold".** A threshold alone is insufficient: "Series A Holdings" vs "Series B Holdings" scores 0.9412 by the reference formula (computed, [C]) and would auto-merge even at 0.92 (the brief suggests "0.92 or higher"). Payment-affecting merges must require an authoritative-id match and respect `cannot-link`; engine auto-merge is disabled in the product profile and name similarity only proposes.
7. **Resolved by INT-062(c).** **Section 11 "Markovian" and the runner.** The runner is satisfied by text carryover with bare markers; the product's ids-not-facts carryover with nonce markers is a second profile in one class. The spec should say the typed profile is an extension and that the conformance claim covers the `conformance` profile.
8. **Resolved by INT-062(d).** **Section 19 "H-MEM ledger head anchored into M9".** Compatible; this blueprint adds a hash chain over H-MEM ledger entries purely so the head is a meaningful leaf. M9 remains the tamper-evidence authority.
9. **Resolved by INT-062(g).** **Module table row M12 ("Cursor evidence").** Not an adapter. The row is renamed "Sponsor adapters and evidence" and Cursor moves to an evidence trail owned by the submission kit.
10. **Resolved by INT-019.** **Section 19 "Local-first proof: network denied under SAMPLE_MODE".** Needs the four arms in C11 to be an actual proof, each tied to the probed backend; "network denied" cannot rest on the Node 22 permission model or on the in-process guard.
11. **Resolved by INT-062(e).** **Section 12 "World Model remains the only store of reconciled facts" vs M3 resolution.** The engine's built-in conflict policies are conformance behaviour; M3's `ResolverPlugin` is the product policy, recorded as a `policy` event. Section 8 and this module should state that boundary.
12. **Resolved by INT-062(i)** (wording only; the facts stay NOT VERIFIED). **Section 15, model profiles.** Bake-off 7 asks whether constrained decoding exists; the NVIDIA docs fetched here confirm only the base URL and chat-completions path. The "OpenAI-compatible" statement is now partly supported (path), still NOT VERIFIED for authentication, parameters and quotas.
13. **Resolved by INT-062(j).** **Section 20 step 10 (engines against runners).** Add a prerequisite: vendoring with byte-integrity rules (`-text` attribute, `.gitignore` exception for `*.jsonl`), otherwise the provenance claim can silently break on a Windows checkout.
14. **Open (new, from this pass).** The DSSE payload type for the one contract object: M8 fixed `application/vnd.plumbline.release-capability+json`; this blueprint uses `application/vnd.plumbline.execution-contract+json`. M8, M9 and M13 must adopt one constant.
15. **Open (new, from this pass).** The signer role set of INT-017 has no role for contracts without `act/`; the `capability` role demands an `approval.granted` proof. A `run` role (refusing any `act/` capability) in M9's set, or an agreed interim, is needed.
16. **Open (new, from this pass).** M7 and M8 assign an MCP client to M12; M12 has none and INT-045 keeps the MCP fallback in M1.

## What this blueprint does not cover

- The rule that M6 uses to weight outcomes and rule versions, counter-precedent policy, consolidation certificates (M6); the truth-table semantics, `cannot-link` logic and the resolution rule itself (M3); the V(S) computation and flip algorithms (M4); the Merkle log, anchoring, the verifier and the signer process with its role policies (M9); the broker, `NonceStore`, approval expiry and TOCTOU re-validation logic (M13), beyond the contract interface they use; the label lattice, the gate, `ReleaseBinding` contents and the egress funnel and manifest schema (M8), beyond the declarations adapters supply; the MCP client (M1); ports, cassettes and budgets (M7).
- Zetaris client internals, REST surface choice, USL and masking commands, federated reads, the audit-log cross-check (M01).
- The model roster, role routing and the evaluation-profile model choices (M14); gold sets, statistics and pre-registration (M11).
- The console panels that expose engine state (M10) beyond the acceptance contracts named here.
- Gaia, Relay, Swarms and Nightshift (rejected, spec 19); Scout's embedding classifier; Markovian pause/resume as an approval mechanism; H-MEM sleep execution or synthesis on precedents; H-MEM mining of vendor documents (implemented to the spec, forbidden in the product path).
- Anything run: no Meterless code, runner, example or eval has been executed; the reference defects are read, not demonstrated; the two computed items (id vectors and name similarities) are throwaway reimplementations of documented formulas.
- Real-model results of any kind (no credentials), the live Zetaris instance, and the HackOS Meterless, Zetaris and NVIDIA folders (unread).

## Pass 3 resolutions (2026-10-13)

Source: `99b-integration-register-pass3.md` (INT-101 onward). These bindings override the body above wherever they differ; the body has not been rewritten. Each line is one binding change; the register item holds the reason and the other modules affected.

- **INT-102.** `SyncJournal` stream ids split on `:` into path segments; no colon in a file name.
- **INT-106.** C5.4: the DSSE payload type constant `application/vnd.plumbline.execution-contract+json` is exported from this module's contract file.
- **INT-115.** The World Model facade persists `Assertion.authorship/producer/tier`, `Fact.supportLabels` and `cell.anchor`.
- **INT-125.** `ProcessSigner` signs run contracts under the signer role `run` (no `act/` capability); release contracts use `capability`.
- **INT-128.** The container carries `ReleaseBinding.reverses`; `verifyContract` refuses a `payment.reverse` without it and a release with it.
- **INT-129.** This module declares the type `NonceStore` (synchronous `consumeAndRecordIntent`) in its contract file; `consume(verified, store, key)` takes it as a parameter; M13 implements it twice. `ConsumedWal` and `FileWal` remain only as test doubles. This module never imports M13.
- **INT-133.** `hmem.head` is a payload field (`attrs.engine = "hmem"`) of the `memory.head` leaf.
- **INT-141.** State the two profiles: product views are order-independent (valid time, then rank vector); arrival order is the `conformance` profile only.
- **INT-142.** Bake-off 6 requirement R-HM5 on the H-MEM facade: threshold before `rerank`; `scoreMicros: Micros` (round half even of the float score times 10^6); reads never mutate ranking; `snapshot()` plus pure `retrieve`, no `peek`.
- **INT-143.** R-MK1: in the product profile the carryover block is built by host code from typed state; the model's text is discarded and proposed ids are validated by `CarryoverPort`.
- **INT-144.** Product profile: `includeUnscoped: false` and no scope-promotion call site (static test `no-scope-promotion`).
- **INT-153.** This module has no MCP client; it reaches Zetaris MCP only through M1's `SiloPort`.
- **INT-158.** Move AB-WM-2 to M3's `ResolverPlugin` ablation; the World Model engine's own ablation is the as-of ownership answer. Replace "worst of three runs" in AB-HM-3 by run-mean inference.


> v5.2 (D-026): profile-pass additions for this module are in `98-profile-pass-additions.md` (adoption register ids; they win over this blueprint where they differ).
