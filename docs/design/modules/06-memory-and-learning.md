# Module 06: Memory and Learning (blueprint)

## v5.1 alignment (2026-10-15, spec section 0 wins where this blueprint disagrees)

- Three-layer progressive-disclosure memory interface (search, timeline, full detail) for agents and MCP (claude-mem pattern, D-016).
- Candidate generation for precedents by a bounded walk over entities and episodes, gated by an ablation (D-016).
- Certified playbooks as proposals with the same replay certificate; never silent overwrite (Hermes-style skills, D-016).
- The rule learner (override to proposal to replay to symbolic check to confirmation) is build step 12a; the counter-precedent rule is a named additional pattern in the behaviour matrix.


## Integration revision (2026-10-13)

Source: `99-integration-register.md` (pass 2). Applied in place; sections the register does not touch are unchanged. Spec text edits the register lists (spec 9a rows, spec 11 bullets) belong to the spec owner; this file states the resolved design and carries the four guarantee rows it contributes (section 4a).

**Applied:**
- INT-040, INT-043, INT-003: the episode chain covers a header and a `BodyRef` only; the snapshot body is a salted `Commitment`-addressed blob in M7's `StorePort`; erasure is M9's protocol (`method` set), and an erased episode is `unevaluable` and counter-only. C1 (types, step 4), C5, C6 step 3, C13.
- INT-018, INT-049, INT-062 (d): one `memory.head` leaf on stream `memory`, durable `append`, backfilled in log order, never waited on by an effect; single writer at both levels; the engine ledger head is anchored by the same leaf. C1 step 2.
- INT-056: `MemoryStorePort` is a mode of M7 `StorePort` (not a new effect type) and engine ledger writes go through `SyncJournal`. C1 build notes, Interfaces. SF13 resolved.
- INT-062 (b, c, e, f): engine hooks M12 must expose are listed as bake-off 6 requirements R-HM1 to R-HM4, R-WM1 to R-WM4, R-MK1; the typed Markovian profile is an extension; M3's `ResolverPlugin` is the product conflict policy. C3 step 1, C14, Interfaces.
- INT-028: M6's `PrecedentRetrieval` and `validateJudgement` are the boundary; one dismissal vocabulary with `fact_differs` carrying a feature key; handles stay in M5; the contract file and `counterSearch` are added. C5, C7, Interfaces.
- INT-021: precedent views cross cases only through the whitelist projection, with a canary test over every leaf path of the episode and snapshot. C5 step 4, C9 step 7, `MEM-P12`.
- INT-034, INT-039: recomputation is M4's `Evaluator` composition `V = phase2 ∘ phase1` with `vSpecHash` recorded in the episode and report; the exactness sentence states its two cases. C13 steps 4 and 8, Interfaces.
- INT-037: M6 calls M5a, M4 and M3 as pure libraries, is called by M5b, and takes the rule-change classification as an injected `GateClassifier`. Depends line, C4, C12.
- INT-038: recency is kept only if the ladder measures a gain (C6 step 4); the other five adopted points were already the design (C9 steps 2 to 4, C6 step 8, C8, C12 rule L1). SF1, 2, 3, 8, 11, 12 resolved.
- INT-029: memory writes and rule proposals use the shared `ApprovalItemType` (`memory_write`, `rule_proposal`); an approval sets `approvedBy` and never changes a label (test `SEC-W1`). C10 step 8, C12 step 9.
- INT-065: labels from M13's `labeller: system | human` map to writer kinds; an evidence-backed human finding is `VERIFIED`, an unsupported one is an `UNTRUSTED` note M6 never reads (C2 step 3); retrieval runs once per decision even when the judge is skipped (C7 step 8).
- Register section 4: the precedent-retrieval, retraction-exactness, retention-and-erasure and outcome-label rows are carried in section 4a.
- Consequential (shared types, section 3 of the register): `AutonomyLevel` is `AL0` to `AL3`; `Micros` and the digest kinds; `OutcomeVerdict` replaces the local `Verdict` (the shared `Verdict` is a verifier result); INT-013 (a fact's trust is the meet over its `supports`; `defeats` never lower it) reworded in C3 step 4 and C9 step 1; INT-048 tenant prefix on log names (C1 step 1).

**Named by the register, deliberately not (fully) applied:**
- INT-028 "tainted = `precedentTrust` below `VERIFIED`": applied to the dismissal predicate only. The standing levels keep their meaning (`tainted` = `UNTRUSTED`, `unproven` = `EXTRACTED`), because occupancy caps and the exclusion codes need the two apart.
- INT-056 `readAtPin(pin: SnapshotPin)`: kept; `SnapshotPin` is one log's position and `MemoryPin` is the composite of them.
- INT-040 `crypto_erase` and per-object keys: M13's upgrade; M6 states only the receipt `method` set and the named consequences.
- INT-061 (e): does not name M6; C12's loosening certificates stay conditional on proven support (rule L1), so no text change.

**New contradictions found (not in the register):**
1. Leaf name for the memory head: M6 `mem.head`, M9 registry `memory.head` (class R, subject = H-MEM ledger head), M12 `hmem.head`, M7 component 15 `memory.written`. M6 adopts `memory.head`; M12 and M7 must follow, and M9 must accept M6's own log heads as payload fields.
2. M12 exposes H-MEM purity as `snapshot` plus pure `retrieve` with a `rerank` hook and `recordRead`, not `peek`; hit scores print as 4-decimal strings (M6 needs integer micros), and `threshold` is not stated to apply before `rerank` (M6 gates on the base score, then multiplies factors). The register's M6-to-M12 "MATCH" was checked against interface rows only.
3. M12's typed Markovian profile still has the model write the state block, with `CarryoverPort` only validating; there is no host-built `carryoverBuilder` (C14, SF9, R-MK1).
4. M12's scope quarantine (`includeUnscoped: false`, promotion to global scope "gated by M6's approval item") has no counterpart here: M6 retrieves across cases by pack and decision type under hard filters and has no per-episode promotion approval. Needs a decision with M12.
5. M9 F16 says erased-case precedents are "counter-only"; INT-040 says `unevaluable`. Reconciled here (an erased episode is `unevaluable{erased}` and may appear only as restrictive-direction counter-evidence); M5 and M9 must read it the same way.
6. `validateJudgement` here covers membership, counter, dismissal and relied-validity conditions, which overlaps M5's JV5 and JV9; the register assigns M5 only JV7 and JV8 plus handles and ceiling. M5 must not duplicate them under other codes.
7. INT-037 puts the rule-change gate (M5 C7) in M5b, but the SMT classification M6 needs at proposal admission uses M5 C3 and C6 (M5a). M5 should export `classify(base, candidate)` from M5a; M6 takes it as an injected `GateClassifier` meanwhile.
8. M3 now keys cells by anchor mention (M3 contradiction 1); `SemanticMemoryPort.subject: Id<"en">` and `UsedIds.factIds` assume stable entity ids. Not changed here.

Status: design. Nothing here is built; every design claim is a hypothesis with a named test. Refines spec v3.1 section 11 (with sections 5, 10, 12, 14a, 17, 21b). Conventions, template and shared types: `00-conventions-and-shared-types.md`. The Meterless engines themselves (H-MEM, World Model, Markovian) are blueprint 12; this module is the product-level memory design that sits on top of them and says what the engines must expose.

## 1. Scope and contract

**Job.** Remember decisions so that later decisions can use them without becoming unsafe: a case store that cannot be rewritten, precedents whose standing is recomputed under the current rules, a semantic-fact interface that never loses what was believed when, policy versions as procedural memory, a write path that closes the poisoning doors, proposal-only learning with machine-checkable certificates, exact retraction when something turns out to be bad, and bounded-state reasoning that cannot drop a finding.

**Principles specific to this module** (each answers a defect in `prior-art/05` or `11`):

- **P-M1 Memory may argue for caution on weak standing, and for permission only on proven standing.** A precedent has standing `proven` only if its trust is at least `VERIFIED`, its validity under the current rules is `valid`, and (for a permissive claim) its outcome is verified and matured. Anything else may appear only as restrictive-direction counter-evidence. This is restrict-only (spec section 5) applied to memory.
- **P-M2 Logs are truth; indexes are projections.** The episode log, outcome log, label log, retraction log, policy registry and assertion log are append-only and hash-chained. H-MEM's store, the dependency graph, validity caches and the sleep-time cache are rebuildable projections. A projection can be deleted and rebuilt byte-for-byte.
- **P-M3 Reads never mutate ranking.** Retrieval is a pure function of a pinned snapshot. Usage statistics are written to a separate retrieval log that nothing reads back into ranking.
- **P-M4 Models write nothing directly.** Every memory write is a typed value that passed the gateway; a model can only produce a `Proposal<T>` that a deterministic validator may turn into a write. Free text from a counterparty or a model never enters a retrieval query, an index token or a label.
- **P-M5 Outcome labels have an authorship rule, not a hope.** A label is invalid if any actor that took part in the decision could have produced it (checked structurally, section C2).
- **P-M6 Exactness is stated by order.** Retraction is exact for the deterministic stages of the affected decision (first order). Decisions downstream of an affected decision are exact only when the affected predecessor's counterfactual action is determined by its deterministic stage; otherwise they are flagged `second_order` and never silently called unaffected.

**Inputs.** From M5: the frozen decision record, the case query (typed features, allowed set, ceiling, fired rules, policy version), the judge's citations. From M3: assertions, link decisions, resolution results. From M13: outcome events, adjudications, reversal receipts. From M8: trust table, `combine`, quarantine, typed-value registry. From M4: the pure recompute `V(S)`. From M11: generators, labelled sets.

**Outputs.** To M5b: `PrecedentRetrieval` (support, counters, explanation, pin, `weaklyInformed`, autonomy support), the policy-version registry, the counter-addressed validator, all typed in `memory/contract.ts` (C7). To M3/M4: as-of fact views. To M9: hash-chain heads, retrieval views, certificates and retraction reports for anchoring and bundling. To M10: precedent, ledger, conflict, proposal and retraction views. To M13: re-judge queue and incident triggers.

**Depends on / depended on.** Below: M7 (ports, trace, budgets), M8 (trust lattice), M12 (engines). Pure libraries it calls (INT-037): M5a (`featurize`, `evaluate`, `revalidate`), M4 (`Evaluator`, `Recompute`), M3 (`fuse`, `reconcile`); build position is after those three and before M5b (register section 5, step 12). M6 never imports M5b: the rule-change classification is an injected `GateClassifier` (C12) and a gate record is data written through the gateway (C4). Peer: M13. Dependents: M5b, M9, M10, M11, M13.

**Record kinds** (the whole of M6's persistent state): `episode`, `outcome`, `label`, `retraction`, `assertion` (stored by the World Model, written only through C3), `policy_version`, `proposal`, `certificate`, `feedback` (reviewer verdicts), `finding` and `carryover` (case-scoped), `reflection` (case-scoped, never read across cases). Derived and non-authoritative: precedent index, validity view, dependency graph, dossier cache.

**Source layout (proposed).** `src/memory/{contract,log,episodes,outcomes,labels,policy-registry,precedent/{view,validity,score,retrieve,explain,occupancy},survivorship,trust,gateway,poison,consolidation/{miner,certificate,queue},depgraph,carryover,cache}`, `eval/memory/{precedent-bench,poison-suite,harm-curve,retraction-equality,carryover,sanity}`.

**Configuration (`MemoryConfig`, JCS-hashed, its hash is part of every pin).** All starting values are hypotheses to be fixed on a development split and frozen before the test split.

| Key | Start | Meaning |
|---|---|---|
| `gate` | 0.35 | minimum base score before factors (H-MEM default; re-tuned on the precedent gold set) |
| `kSupport`, `kCounter` | 5, 2 | sizes of the shown sets |
| `capPerCounterparty` | 1 | support slots one counterparty cluster may occupy |
| `capUnprovenInSupport` | 0 | unproven precedents in the support set |
| `capTaintedInCounter` | 1 | tainted precedents among counters |
| `knownShareMin` | 0.5 | below this share of observed outcomes the retrieval is `weaklyInformed` |
| `outcomeWindowDays` | pack parameter | maturity window after which an absence of harm counts |
| `holdoutEmbargoDays` | = `outcomeWindowDays` | exclusion gap between mining data and holdout |
| `maxProposalsPerCycle` | 8 | candidate cap (also the multiplicity count) |

## 1a. Reference register

Verified 2026-10-13. Repositories: `gh api repos/OWNER/NAME` (stars / licence / last push / archived false for all). Papers: arXiv API or Crossref record fetched on the same day, or the file named in the last column (which fetched it, and `prior-art/16` confirms the id). Results are author-reported unless stated; none was reproduced by us.

| ID | Reference | Facts | Read how |
|---|---|---|---|
| R1 | [mem0ai/mem0](https://github.com/mem0ai/mem0) | 67113 / Apache-2.0 / 2026-10-12 | code: `mem0/utils/scoring.py::score_and_rank` (semantic gate before fusion, lines 105-118), `memory/main.py` write path (via `prior-art/05` §2) |
| R2 | [getzep/graphiti](https://github.com/getzep/graphiti) | 31710 / Apache-2.0 / 2026-10-13 | code: `graphiti_core/utils/maintenance/edge_operations.py::_apply_temporal_invalidation`, `resolve_edge_contradictions` |
| R3 | [topoteretes/cognee](https://github.com/topoteretes/cognee) | 32180 / Apache-2.0 / 2026-10-13 | `prior-art/01` §7 (declared functional relations, advisory contradiction edges) |
| R4 | [langchain-ai/langmem](https://github.com/langchain-ai/langmem) | 1700 / MIT / 2026-10-02 | `prior-art/05` §3 |
| R5 | [WujiangXu/A-mem](https://github.com/WujiangXu/A-mem) | 989 / MIT / 2026-03-05 | `prior-art/05` §4 (five defects, read not run) |
| R6 | [joonspk-research/generative_agents](https://github.com/joonspk-research/generative_agents) | 22219 / Apache-2.0 / 2024-08-05 | code: `persona/cognitive_modules/retrieve.py::extract_recency`; `reflect.py` via `prior-art/05` §5 |
| R7 | [noahshinn/reflexion](https://github.com/noahshinn/reflexion) | 3306 / MIT / 2025-01-14 | `prior-art/05` §8 |
| R8 | [OSU-NLP-Group/HippoRAG](https://github.com/OSU-NLP-Group/HippoRAG) | 4059 / MIT / 2026-10-06 | code: `src/hipporag/HippoRAG.py::delete`, `_remove_fact_sources_from_graph` |
| R9 | [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG) | 40116 / MIT / 2026-10-12 | `lightrag/lightrag.py::adelete_by_doc_id` (docstring and signature), `operate.py::rebuild_knowledge_from_chunks` (name only) |
| R10 | [Meterless/Meterless](https://github.com/Meterless/Meterless) (local clone) | 249 / Apache-2.0 / 2026-07-24 | code: `engines/hmem/reference/src/{memoryRetrieval,dreaming,sleepCycle,conflictDetection,trustLedger,memoryStore}.ts`, `engines/world-model/reference/src/{index,store}.ts`, `engines/markovian/reference/src/carryover.ts`; brief A.1 to A.3 |
| R11 | [dsh3n77/MINJA](https://github.com/dsh3n77/MINJA), arXiv [2503.03704](https://arxiv.org/abs/2503.03704) | 38 / MIT / 2026-08-11 | `prior-art/11` §6.1 (abstract level) |
| R12 | [AI-secure/AgentPoison](https://github.com/AI-secure/AgentPoison), arXiv [2407.12784](https://arxiv.org/abs/2407.12784) | 245 / MIT / 2026-10-13 | `prior-art/11` §6.1 (abstract level) |
| R13 | [ace-agent/ace](https://github.com/ace-agent/ace), arXiv [2510.04618](https://arxiv.org/abs/2510.04618) | 1361 / Apache-2.0 / 2026-08-24 | `prior-art/11` §2.7 (whether this repo is the official release: unconfirmed) |
| R14 | [google-research/reasoning-bank](https://github.com/google-research/reasoning-bank), arXiv [2509.25140](https://arxiv.org/abs/2509.25140) | 613 / Apache-2.0 / 2026-08-05 | `prior-art/11` §4.1 |
| R15 | [Memento-Teams/Memento](https://github.com/Memento-Teams/Memento), arXiv [2508.16153](https://arxiv.org/abs/2508.16153) | 2595 / MIT / 2025-10-05 | `prior-art/11` §4.2, `09` §6.1 |
| R16 | [TimelyDataflow/differential-dataflow](https://github.com/TimelyDataflow/differential-dataflow) | 3019 / MIT / 2026-10-13 | idea only; not read |
| R17 | [letta-ai/sleep-time-compute](https://github.com/letta-ai/sleep-time-compute), arXiv [2504.13171](https://arxiv.org/abs/2504.13171) | 141 / MIT / 2025-04-30 | `prior-art/11` §2.1 |
| R18 | [MemTensor/HaluMem](https://github.com/MemTensor/HaluMem), [HUST-AI-HYZ/MemoryAgentBench](https://github.com/HUST-AI-HYZ/MemoryAgentBench), [xiaowu0162/LongMemEval](https://github.com/xiaowu0162/LongMemEval) | 175 NOASSERTION / 467 MIT / 1148 MIT | `prior-art/11` §9 |
| R19 | [st-tech/zr-obp](https://github.com/st-tech/zr-obp) | 713 / Apache-2.0 / 2024-06-03 | `prior-art/09` §5.1 |
| R20 | arXiv [2605.12978](https://arxiv.org/abs/2605.12978) Useful Memories Become Faulty When Continuously Updated by LLMs (2026-05-13, preprint, no code found) | | arXiv API 2026-10-13; abstract level |
| R21 | arXiv [2607.29167](https://arxiv.org/abs/2607.29167) Memory Provenance Laundering (2026-07-31, preprint) | | arXiv API; abstract level |
| R22 | arXiv [2610.05732](https://arxiv.org/abs/2610.05732) PACMI (2026-10-05, preprint); [2608.10502](https://arxiv.org/abs/2608.10502) Dependency-Guided Rollback Repair (2026-08-11, preprint) | | arXiv API; abstract level |
| R23 | arXiv [2608.21230](https://arxiv.org/abs/2608.21230) Utility Under Attack (2026-08-21, preprint) | | arXiv API; abstract level |
| R24 | arXiv [2610.02070](https://arxiv.org/abs/2610.02070) Causal Memory Policy (2026-10-01, preprint) | | arXiv API; abstract level |
| R25 | arXiv [2610.04083](https://arxiv.org/abs/2610.04083) Self-Propagating Misalignment (2026-10-02, preprint) | | arXiv API; abstract level |
| R26 | arXiv [1707.01495](https://arxiv.org/abs/1707.01495) Hindsight Experience Replay (2017-07-05); arXiv [2603.21357](https://arxiv.org/abs/2603.21357) AgentHER (preprint) | | arXiv API / `prior-art/11` §4.4 |
| R27 | Doyle, "A truth maintenance system", Artificial Intelligence, 1979; de Kleer, "An assumption-based TMS", Artificial Intelligence, 1986 | | Crossref records fetched 2026-10-13 (title, author, year only; the content notes below come from general knowledge and are UNVERIFIED against the papers) |
| R28 | Fowler, [Bitemporal History](https://martinfowler.com/articles/bitemporal-history.html) | | page fetched 2026-10-13: actual history versus record history, append-only correction |
| R29 | Aamodt and Plaza, "Case-Based Reasoning: Foundational Issues, Methodological Variations, and System Approaches", AI Communications, 1994; Rissland and Ashley, "HYPO: A Precedent-Based Legal Reasoner", 1987; Ashley and Rissland, "A case-based approach to modeling legal expertise", IEEE Expert, 1988 | | Crossref records fetched 2026-10-13 (metadata only; what HYPO does with counterexamples is described from general knowledge: UNVERIFIED) |
| R30 | `prior-art/11` items not individually re-fetched here and used at abstract level: 2606.25161 TrustMem, 2609.33013 ConsolidationBench, 2605.25869 MemIR, 2606.22030 Nous, 2609.22818 price of safety, 2606.30566 provenance detector, 2601.05504, 2609.08279 What Eviction Destroys, 2604.20006 Memora, 2609.22231 EvalMem, 2609.38021 LongMemEval audit, 2510.06557 Delethink, 2507.05257, 2511.03506, 2410.10813, 2402.17753 | | `prior-art/11` (fetched 2026-10-13), ids confirmed by `prior-art/16` |

## 2. Component list

C1 Memory log and case store · C2 Outcomes, hindsight labels and the authorship rule · C3 Semantic memory port to the World Model · C4 Procedural memory: policy-version registry · C5 Precedent record and recomputed validity · C6 Precedent index and scoring (H-MEM binding, pin) · C7 Counter-precedents, explanation and judge obligations · C8 Survivorship correction and the weakly-informed state · C9 Trust algebra applied to memory · C10 The write path and contradiction handling · C11 Poisoning defences and the adversarial suite · C12 Consolidation: proposals, certificates and the harm-curve experiment · C13 Decision-dependency graph and exact cascading retraction · C14 Markovian carryover, ratify and contamination · C15 Sleep-time precompute cache · C16 Memory benchmarks (sanity checks) and the precedent benchmark.

---

## C1. Memory log and case store

**3 References.** R10 `trustLedger.ts` (append-only JSONL, no ids, no hash chain: read); R2 `EpisodicNode` keeps raw episodes beside derived edges (`prior-art/01` §6); R28 append-only record history over actual history; R4 `Episode{observation, thoughts, action, result}` schema (`prior-art/05` §3); R20 raw episodes outperform consolidated memory in one preprint.

**4 What they do.** H-MEM's ledger appends one JSON line per mutation and `history(id)` filters in memory (`trustLedger.ts::log`, `history`); entries carry no id, no hash and no case key, and `relatedTo` back-links are written without an entry (brief A.1 gap 4). Graphiti keeps the raw episode and derives edges from it, but mutates edges in place (`invalid_at`, `expired_at`) using the wall clock (`utc_now()` inside `_apply_temporal_invalidation`). LangMem overwrites with `aput` and keeps no history (`prior-art/05` §3). Fowler's two-axis model is the clean statement of what we need.

**5 Decision.** **Own** the log (a small hash-chained append-only store; Graphiti and H-MEM do not meet P-M2). **Adapt** R4's episode shape and R2's raw-episode-first ingestion. Rejected: using H-MEM's ledger as the case store (no chain, keyed by memory id; spec section 19 already says it cannot replace M9).

**6 Design.**

```ts
type EpisodeId = Id<"ep">;                       // ep_ + first 32 hex of the DocHash digest of (domain "plumbline/mem/episode/v1", JCS(payload))
interface Envelope<K extends string, P> {
  kind: K; seq: number;                          // gapless per log
  prevHash: DocHash; hash: DocHash;              // hash = DocHash("plumbline/mem/<kind>/v1", JCS({seq, prevHash, recordedAt, provenance, trust, conf, personal, payload}))
  recordedAt: Iso;                               // ctx.clock only
  provenance: ProvenanceStamp; trust: TrustLevel; conf: Confidentiality; personal: boolean;
  payload: P;
}
interface ProvenanceStamp {
  writer: { kind: "runtime" | "m3" | "m13" | "reviewer" | "consolidator" | "m5gate"; id: string };
  runId: string; traceSeq: number; inputHashes: Hash[]; originIds: Id<"og">[]; authority: AuthorityTier;
}
interface BodyRef { ref: Commitment | RawHash; partition: Confidentiality; erasable: boolean }   // bytes live in M7 StorePort (INT-043); the chain covers this reference only
interface CaseSnapshot {                         // the recompute input; frozen at decision time; stored as a blob; no floats (amounts as integer minor-unit strings, ratios as basis points)
  asOf: Iso; worldModelSeq: number;
  assertions: { id: Id<"as">; attribute: string; norm: Json; validFrom?: Iso; validTo?: Iso; originId: Id<"og">; trust: TrustLevel; conf: Confidentiality; evidenceId: Id<"ev"> }[];
  linkDecisions: { id: string; kind: "link" | "possible" | "non_link"; members: Id<"mn">[] }[];   // recorded, not re-derived from fuzzy scores
  policyInputs: Record<string, Json>;            // post-feature-function values, for audit and quick diff
  featureFnVersions: Record<string, string>;
  ledgerSnapshotHash: Hash;                      // M4 frozen ledger snapshot
}
interface EpisodePayload {
  caseId: Id<"case">; counterpartyScope: Id<"cp">;          // opaque handle; never a name
  pack: string; decisionType: string; schemaMajor: number;
  decidedAt: Iso; snapshot: BodyRef;                         // CaseSnapshot, opened with StorePort.getBlob; personal data lives only there
  features: FeatureVector;                                   // closed vocabulary, built by code (C6)
  policyVersion: Id<"pv">; vSpecHash: Hash;                  // vSpecHash: M4 Evaluator composition (INT-034), printed with every recomputation
  allowed: Action[]; ceiling: Action; firedRules: string[];
  action: Action; autonomy: AutonomyLevel; judgeSkipped: boolean;
  deciders: { kind: "rule_engine" | "model" | "critic" | "human"; id: string }[];   // everyone who took part (used by C2)
  uses: UsedIds;                                             // C13
  memoryPin: MemoryPin; retrieved: { episodeId: EpisodeId; role: "support" | "counter"; scoreMicros: Micros; viewHash: Hash }[];
  judgeInputHash: Hash; decisionHash: Hash;                  // M5 record
}
```

1. **Append.** Single writer per log through one promise queue; `episode` is written once, at decision close, by the runtime through the gateway (C10). The id is content-derived, so a re-executed step after a crash re-appends the same id and the append is an idempotent no-op (write-ahead rule from M7: the effect key is the episode id). Logs and blobs are opened through M7 `StorePort` under tenant-prefixed names (`tn_<id>/memory/<kind>`, INT-048); the judge path runs one tenant, `tn_default`, and retrieval never crosses tenants.
2. **Chain and anchor (INT-018, INT-049, INT-062 d).** `prevHash` links records. After each write batch (at least at every decision close) the gateway calls `LedgerPort.append` for one leaf of type `memory.head` on stream `memory`: durable on return, idempotency key = the log head hash, so a re-run after a crash is a no-op; its subject is the digest of the H-MEM ledger head and its payload lists M6's own log heads (episode, outcome, label, retraction, policy, feedback). It is a result leaf: nothing waits for `published`, and no effect uses `appendBefore` on it (the write-ahead set is M13's). The ledger has one writer per stream: a second writer is refused with `E_LEDGER_LOCKED`, never merged; the append is requested outside fan-out regions. On open, M6 compares its head sequence with `streamHead("memory")` and re-appends missing head leaves in log order. H-MEM's own ledger (M12 gives each entry `id`, `seq`, `prevDigest` and a `head()`; its writes go through M7 `SyncJournal`) is chained only so that head means something; M9's log stays authoritative (spec section 19).
3. **Immutability invariant.** No API updates or deletes a record. Corrections are new records (`retraction`, `label`, `outcome`). An enforcement test greps the store module for write modes other than append and runs a fuzzer that tries every public method with hostile arguments.
4. **Erasure and retention (closes AUD-10 for M6; INT-040, INT-043).** An episode is immutable in id, digest and trust label; only the snapshot body is erasable, and it is a blob in the shared store behind M7 `StorePort`, addressed by `Commitment` (salt held beside the blob) in the partition named by `BodyRef.partition`. Erasure is M9's one protocol (request leaf, legal-hold check, signed receipt through signer role `erasure`); the receipt `method` is `delete+salt-destroy` on the judge path, `crypto_erase` when M13's per-object keys exist, `tombstone` for a body already unreadable. M6 never deletes. After erasure `getBlob` fails with `erased`, the episode stays in the log and the index (its features are personal-data-free by construction: closed vocabulary, bands), `recomputable` is false, and the consequences are named states: `validityOf` returns `unevaluable{why: "erased"}`; the precedent may appear only as restrictive-direction counter-evidence (M9 `source_erased`) and never as support; C13 reports `unevaluable`; replay of a decision that retrieved it gets `CassetteMiss{reason: erased}`, the offline verifier `V5.ERASED` (INDETERMINATE), and M5 replay INDETERMINATE.
5. **Hindsight is a different record kind.** Nothing in `EpisodePayload` is ever revised; outcomes and labels (C2) reference `episodeId`.
6. **Determinism.** Time from `ctx.clock`, ids from content hashes, no floats in hashed documents; scores are integers (C6).
7. **Failure.** Append failure is class `fatal` for the decision (no decision closes without its episode); a torn tail is detected by hash chain and truncated only to the last verified record under an explicit `repair` command that writes a trace record; a mid-log hash mismatch is a halt with `INTEGRITY` and a bundle-visible alarm.

**7 Tests.** `T-LOG-01` property: for random sequences, `prevHash` chain verifies and any single-byte flip is detected (tamper corpus shared with M9). `T-LOG-02` idempotent append under crash injection at every step of the append (seeded fault injection, M7). `T-LOG-03` immutability: static check plus hostile-call fuzzer. `T-LOG-04` erasure: erased body leaves a receipt of each `method`, header and chain verify, `getBlob` fails with `erased`, the precedent appears only as a restrictive-direction counter, C13 reports `unevaluable`. `T-LOG-05` projection rebuild: delete index and graph, rebuild, hashes equal. Metric: zero chain breaks over 10^5 simulated appends with injected crashes.

**8 Risks / NOT VERIFIED.** Throughput of the hash chain is unmeasured (the snapshot is out of line by design, so only the header is chained); opening a `Commitment` costs one blob read per recomputation. Whether `node:sqlite` or flat JSONL segments suit the judge path is bake-off 5. Snapshot size versus the recompute need (C13) is a real tension: erasure shrinks recomputability.

**9 Build notes.** First in module order; blocks C2, C5, C6, C13. Needs M7's `StorePort` memory mode and `SyncJournal` (Interfaces) and the M9 `memory.head` leaf type.

---

## C2. Outcomes, hindsight labels and the authorship rule

**3 References.** R14 ReasoningBank: failures belong in memory, but labels are self-judged by the agent (`prior-art/11` §4.1). R26 Hindsight Experience Replay and AgentHER: relabel a failed trajectory with the goal it did achieve. R7 Reflexion: loops lean on an external success signal (`prior-art/05` §8). `prior-art/09` §5.5 selective labels (Lakkaraju et al., outcomes seen only for accepted cases).

**4 What they do.** ReasoningBank's abstract states that its success and failure labels come from the agent's own judgement, which is the trust hole we close. HER and AgentHER keep the original trajectory and add a relabelled goal (abstract level; AgentHER also reports cross-model verification of labels, preprint). Reflexion's strongest settings have an oracle (`won`, the gold answer): `prior-art/05` §8 read this in the code.

**5 Decision.** **Own** the label model; **adapt** the HER separation (original decision untouched, relabel beside it). Rejected: self-judged outcome labels; one scalar outcome in [-1, 1] (loses direction and censoring).

**6 Design.**

```ts
type OutcomeKind = "observed_ok" | "harm_after_release" | "unnecessary_block" | "adjudicated_correct_set";
type ObservedBecause = "released_and_monitored" | "audit_sampled" | "adjudicated" | "external_event";
interface OutcomePayload {
  episodeId: EpisodeId; kind: OutcomeKind; observedAt: Iso;
  observedBecause: ObservedBecause; evidence: Id<"ev">[];       // each must resolve to an allowlisted channel with trust >= VERIFIED
  source: "system_event" | "human_adjudication" | "external_register";
  adjudicator?: { subject: string; role: string };               // identity-provider subject, never a model id
  maturity: { windowDays: number; maturedAt: Iso };
  correctSet?: Action[];                                         // only for adjudicated_correct_set
  harmMinorUnits?: string;
}
type OutcomeVerdict =                                            // the deterministic reading of an outcome; never a free label (not the shared verifier `Verdict`)
  | { k: "action_ok"; action: Action }
  | { k: "too_permissive"; action: Action }                      // action and anything more permissive is counter-evidence
  | { k: "too_restrictive"; action: Action }                     // action and anything more restrictive is counter-evidence
  | { k: "correct_set"; actions: Action[] };
type OutcomeState = "pending" | "censored" | "observed";         // pending: not yet matured; censored: structurally unobservable
```

1. **Mapping (fixed, published, hashed).** `observed_ok` on action a becomes `action_ok(a)`; `harm_after_release` becomes `too_permissive(a)`; `unnecessary_block` becomes `too_restrictive(a)`; `adjudicated_correct_set(S)` becomes `correct_set(S)`. Direction is carried by the order `release > release_with_approval > escalate > hold > reject`. A harm label never says which stricter action was right, so it counters a and everything more permissive and is neutral toward the rest.
2. **State.** `pending` until `maturedAt`. `censored` for restrictive actions with no adjudication path: holds and rejects produce outcomes only through adjudication, so `censored` is the normal state of a restrictive precedent and is not penalised against permissive ones (C8).
3. **Authorship rule (structural, P-M5).** The gateway rejects a label or outcome unless all hold: (a) `source` is `system_event` produced by an M13 connector with a connector identity (M13 `labeller: system`, writer kind `m13`), `external_register` from an M1 channel whose authority tier covers the attribute, or `human_adjudication` with an authenticated subject (M13 `labeller: human`, writer kind `reviewer`); (b) no id in `episode.deciders` equals the writer or adjudicator subject (the approver of a decision cannot adjudicate it; `self_adjudicated` is recorded and excluded from certificates); (c) every evidence id resolves to evidence with trust at least `VERIFIED` and `authorship != counterparty` (a counterparty-authored remittance advice is not outcome evidence); (d) the writer kind is not `model`. A model may only submit `Proposal<HindsightDraft>`; it becomes a label only through an adjudication event by a human subject citing evidence. An evidence-backed human finding is stored with trust `VERIFIED` (a human step never raises a label above it); a human assertion without admissible evidence fails (c) with `TRUST_FLOOR`, stays with M13 as an `UNTRUSTED` note, and nothing in ranking, standing or certificates reads it (INT-065).
4. **Hindsight label separation.** `label` records are separate from `outcome` records and from the episode: `{ episodeId, verdict: OutcomeVerdict, basis: OutcomeId[], derivation: "rule" | "human" }`. `derivation: "rule"` is the deterministic mapping in step 1 and needs no human; `human` carries an adjudicator.
5. **Matured windows.** Harm outcomes are accepted at any time; `observed_ok` only after maturity. A later harm after `observed_ok` is a new outcome event; the latest verdict by `observedAt` is effective and all remain visible (precedent history never shows a clean past that was revised silently).
6. **Interfaces.** M13 calls `memory.recordOutcome(OutcomeInput)`; M10 shows a label queue; label retraction is a `retraction` (C13).

**7 Tests.** `T-OUT-01` adversary-controlled model port tries to write an outcome, a label, an adjudication and a `Proposal<HindsightDraft>` promoted without a human: all rejected, zero labels with a model writer. `T-OUT-02` counterparty-authored "payment confirmed" document as evidence: rejected (authorship). `T-OUT-03` approver adjudicates own decision: flagged `self_adjudicated`, excluded from certificates. `T-OUT-04` direction table property test: for every action and kind, polarity over the five actions matches the published table. `T-OUT-05` censoring: holds never leave `censored` without adjudication. Metric: label-authorship violations admitted = 0, reported as 3/n upper bound over n attempts.

**8 Risks / NOT VERIFIED.** Real outcome evidence channels (chargebacks, reversals, later sanctions designations) are simulated in the demo; the authorship rule is tested against our simulator only. Outcome delay can exceed any review horizon. Adjudicator bias (hindsight bias) is not measured.

**9 Build notes.** After C1; unblocks C5, C8, C12. M13 owns collection, M6 owns validation and storage.

---

## C3. Semantic memory port to the World Model

**3 References.** R2 Graphiti bitemporal edges (`valid_at`, `invalid_at`, `expired_at`, `created_at`) and `_apply_temporal_invalidation`; R3 cognee supersession only for declared single-valued relations; R10 World Model `assertFact` and fold (read: `index.ts` lines 198-249, `store.ts` fold lines 126-130); R28 bitemporal history; engine brief A.2 and `prior-art/01` §6 to §7 for the comparison; Engram, graph-native bitemporal store and ChronoMem preprints (`prior-art/11` §3.6) on in-query temporal filtering.

**4 What they do.** Graphiti compares dates to expire edges; it stamps `expired_at` with the wall clock and mutates the edge in place; when `valid_at` is missing nothing is invalidated, so two current facts can coexist (`resolve_edge_contradictions` returns early on `None` dates). Cognee supersedes by greatest `(updated_at, position)` only where the caller declared the relation functional. The World Model reference appends the fact event, then mutates `supersededBy` on rivals and `entity.attrs[predicate]` outside the event: the fold for `assertFact` stores only the fact (`store.ts` lines 126-130), so after replay the winning attribute and the rival marks are not reconstructed (read, not executed; confirms brief A.2 item 4). Its conflict policy is one global setting (`most-recent-wins`, `highest-confidence-wins`, `source-priority`, `manual`).

**5 Decision.** **Own** the port; the engine is blueprint 12's. M6 states four requirements the engine must meet and tests them through the port. Rejected: mirroring facts into H-MEM (brief B hand-off 5), because spec section 19a keeps the World Model as the only store of reconciled facts and a mirror is a second truth store with its own drift; global conflict policy (M3's resolution is per attribute by authority tier, date and declared cardinality).

**6 Design.**

```ts
interface SemanticMemoryPort {
  assertAssertion(a: Assertion): Result<AssertReceipt, WriteRejection>;      // event only; no derived state is written
  factsAsOf(q: { subject: Id<"en">; attribute?: string; validAt: Iso; knownAt: Iso }): ResolvedCell[]; // filters inside the query
  history(subject: Id<"en">, attribute: string): AssertionEvent[];           // every assertion ever, with recordedAt
  retract(assertionId: Id<"as">, reason: RetractReason): RetractionReceipt;  // appends a retraction event (C13)
  cardinality(attribute: string): "single" | "multi";                        // from the pack
}
interface ResolvedCell { status: CellStatus; winner?: Id<"as">; defeats: Id<"as">[]; rule: string; conflicts: Id<"as">[] }   // `defeats` as in the shared Fact (INT-013)
```

1. **Requirements on the engine.** (R-WM1) Assertions are events; the winning value and `supersededBy` marks are a pure function of the fold (a view), so restart replay gives the same view. (R-WM2) Conflict resolution is the M3 pure function (dates, tier, declared cardinality) supplied through `ResolverPlugin`, with `unresolved` as a stored status; the engine's four global policies and its auto-merge are conformance-profile behaviour only (INT-062). (R-WM3) Every read takes `validAt` and `knownAt` explicitly; there is no implicit "now" (callers pass `ctx.clock`). (R-WM4) Multi-valued relations (owners, directors, bank accounts) are declared and are not closed by the single-target supersession rule (brief A.2 item 5).
2. **No hidden time.** `recordedAt` comes from `ctx.clock` or the recorded event; the wall-clock `expired_at` pattern of R2 is not used.
3. **Filter inside the query.** `knownAt <= pin` and `validAt` are applied to candidates before ranking or resolution, never after top-k (post-filter dilution, `prior-art/11` §3.6).
4. **Lower trust cannot supersede higher trust in the decision view.** Eligibility to supersede is M3's rank vector, which includes trust. An incoming assertion that does not outrank the current winner (for example a later-dated `self_declared` registry field against a `SOR` ERP value) never replaces it and never changes the winner's trust: defeated inputs affect only status, conflict records and gaps (INT-013). A conflict item is always queued, and the cell is `unresolved` only when M3's ranking leaves it undecided. This is a supersession-abuse defence without an availability hole (attack `MEM-P07`).
5. **Contradiction check at write time.** Key `(subject, attribute)` with overlapping validity and different normalised values. If cardinality is `single`: call M3 `resolve`; the outcome is a supersession record or an `unresolved` cell plus a conflict item with both sides. If `multi`: no conflict. The check is structured; an LLM may only propose candidate pairs that the structured check then validates against the exact list it was shown (the Graphiti and cognee pattern, `prior-art/01` rec. 2).
6. **Retraction.** `retract` never deletes; the view without the assertion is recomputed. R8 and R9 delete derived structures when a source document is removed (R8 subtracts `fact_source_counts`; R9 rebuilds affected entities from remaining chunks), and neither tells you which downstream conclusions depended on what was removed. C13 does.

**7 Tests.** `T-SEM-01` restart replay: assert facts, serialise events, rebuild, compare canonical views (fails on the unmodified reference by design). `T-SEM-02` as-of replay: a fixed event log queried at 50 random `(validAt, knownAt)` pairs equals a bitemporal SQL oracle (shared with M3 acceptance, contribution C7 of the grant case). `T-SEM-03` post-filter dilution: planted superseded facts that would crowd the top-k are absent from results. `T-SEM-04` supersession abuse: `MEM-P07`. `T-SEM-05` multi-valued edges survive. `T-SEM-06` un-merge then re-merge yields an identical view.

**8 Risks / NOT VERIFIED.** R-WM1 to R-WM4 are unmet by the reference; whether to fork it and fix or re-implement is bake-off 6. Graphiti's behaviour was read, not run; Graphiti is a behavioural baseline for bitemporal tests, not a dependency.

**9 Build notes.** Parallel with C1; the port stub with an in-memory event list lets M3 and C10 proceed before the engine exists.

---

## C4. Procedural memory: the policy-version registry

**3 References.** R4 LangMem's procedural memory is a rewritten prompt string with no gate (`prior-art/05` §3); R13 ACE: brevity bias and context collapse, delta updates against a named base; `prior-art/09` §9.4 Progent-style rule-change gate (M5); R14/R17 do not address policies. MADR section names for decision records (`prior-art/09` §7).

**4 What they do.** LangMem's `prompts/optimization.py` produces a new prompt and "nothing gates its deployment" (`prior-art/05` §3). ACE applies incremental deltas to a structured playbook, which supports never rewriting wholesale, but its playbook is natural language curated by a model.

**5 Decision.** **Own.** Procedural memory is policy-as-code with ids, versions and tests. M5 owns what a policy means and the rule-change gate; M6 owns the registry that makes versions durable, as-of queryable and pinnable. Prompts are hash-pinned artefacts in M7, not procedural memory.

**6 Design.**

```ts
type PolicyVersionId = Id<"pv">;                // pv_ + hash of the IR bundle
interface PolicyVersionPayload {
  parent: PolicyVersionId | null; irHash: Hash; schemaVersion: string;
  featureFnVersions: Record<string, string>; testsHash: Hash; proofBundleHash: Hash | null;
  adr: Id<"adr">; proposalId: Id<"rp"> | null; certificateHash: Hash | null;
  gateClassification: "tightening" | "loosening" | "mixed" | "initial";     // from the M5b gate record (SMT classification)
  approvals: { subject: string; role: string; at: Iso }[];
}
type RegistryEvent =                             // append-only
  | { k: "publish"; version: PolicyVersionPayload }
  | { k: "activate"; version: PolicyVersionId; effectiveFrom: Iso }
  | { k: "rollback"; to: PolicyVersionId; effectiveFrom: Iso; reason: string };   // new activation, nothing deleted
```

1. `activeAt(t)` returns the version whose activation event is the latest not after `t`. A decision's episode pins `policyVersion`; nothing may evaluate "the current policy" without receiving a version id from the caller.
2. **Publication requires** an M5b gate record, which is data written through the gateway by writer `m5gate` (M6 never calls M5b code): classification, invariants re-proved or enumerated, approvals (`ApprovalItem` of type `rule_proposal`, held by M13) meeting the tier for that classification. Loosening with tainted support is not publishable (C12 rule L1).
3. **Feature functions are part of the version.** The registry stores `featureFnVersions`; two versions with the same IR and different feature functions are different versions. This is what C5 needs to say a precedent is `unevaluable`.
4. **Rollback is an event.** It changes the active pointer; decisions made under the rolled-back version are found by C13 through `uses.policyVersion`.
5. **Caches are keyed by version id**, so they never need invalidation.

**7 Tests.** `T-POL-01` as-of: random activation/rollback sequences, `activeAt` against a reference. `T-POL-02` publish without gate record is rejected. `T-POL-03` registry replay equality. `T-POL-04` a mutated IR byte changes the version id.

**8 Risks.** The IR is provisional pending bake-off 2; the registry is IR-agnostic (it stores a hash and a blob reference) to survive that.

**9 Build notes.** Small; do right after C1 so C5 can be built against a real registry.

---

## C5. The precedent record and recomputed validity

**3 References.** R29 CBR 4R cycle (Retrieve, Reuse, Revise, Retain) and HYPO-style distinguishing; R15 Memento case bank with a learned selector (`prior-art/09` §6.1); R14; `prior-art/11` §10.3A (the design this component implements); `prior-art/05` §10.3 (rule-version guard).

**4 What they do.** Memento keeps a case bank and learns a selection policy from reward; validity under policy changes is not part of it (`prior-art/11` §10.3A: none of the precedent stores found conditions validity on the policy version). CBR vocabulary supplies indexed features and per-feature similarity. HYPO distinguished cases and cited counterexamples (R29: metadata verified only; our use of "distinguish" is our own design).

**5 Decision.** **Own.** A precedent is a projection of an episode, never a separate truth. Validity is recomputed by re-running the current deterministic rule engine on the stored snapshot (the center of research contribution C9).

**6 Design.**

```ts
interface PrecedentView {                          // the ONLY shape that leaves M6 toward a judge, a UI or a bundle; whitelisted fields (step 4)
  episodeId: EpisodeId; decidedAt: Iso; pack: string; features: FeatureVector;          // bands and enums only
  action: Action; autonomy: AutonomyLevel; policyVersion: PolicyVersionId; firedRules: string[];
  verdict: OutcomeVerdict | null; outcomeState: OutcomeState; trust: TrustLevel; conf: Confidentiality;
  validity: Validity; clusterHandle: Id<"cp">;     // opaque keyed handle; no name, no account, no registry id
  viewHash: Hash;
}
type Validity =
  | { state: "valid" }
  | { state: "stale_rule_diff"; diff: RuleDiff }
  | { state: "retracted"; retractionId: Id<"rt"> }
  | { state: "unevaluable"; why: "missing_input" | "feature_fn_unavailable" | "erased" | "ir_unavailable"; missing: string[] };
interface RuleDiff { allowedOld: Action[]; allowedNew: Action[]; firedOld: string[]; firedNew: string[]; actionStillAllowed: boolean; cls: DiffClass }
type DiffClass = "same" | "fired_changed_same_allowed" | "tightened_action_allowed" | "loosened" | "action_now_forbidden" | "disjoint";
```

1. **`validityOf(ep, P)`** (pure, memoised by `(episodeId, P)` as a derived view, never stored as truth): (i) retracted at or before the pin: `retracted`; (ii) erased or snapshot missing an input the version's feature functions need: `unevaluable` with the missing attribute names; (iii) run M5a `revalidate(P, snapshot)` (= `evaluate(P, featurize(snapshot))`, opened from the blob) to get `allowedNew`, `firedNew`; (iv) classify against the recorded `allowed` and `firedRules`; `same` means both sets equal. `stale_rule_diff` carries the diff for the UI ("this precedent was decided when rule R-12 did not exist").
2. **Standing** (C9) uses validity: only `valid` can be proven; `stale_rule_diff` with `tightened_action_allowed` or `loosened` can support at a reduced factor (C6 table); `action_now_forbidden` and `disjoint` cannot support, and are shown to reviewers as superseded by a rule change.
3. **Same-vendor and same-cluster precedents** are tagged by `clusterHandle` so the occupancy cap (C6) and calibration leakage rules can exclude or limit them.
4. **Confidentiality projection (INT-021).** Precedent data crosses cases only through `toPrecedentView(ep, viewer)`, a whitelist function: its output fields are exactly those of `PrecedentView` (closed enums, bands, rule and policy ids, hashes, and `clusterHandle`, an HMAC under a deployment key held by M6, never an unkeyed hash of a name). The judge input receives `sameCluster` relative to the query instead of the handle. A view sent to a hosted model is an egress sink capped by the model profile (M5 §C8 egress entry). Adding a field means adding it to the whitelist file with its `conf` class, which a reviewer must sign.
5. **Canary test (`T-PRE-04`).** A generated test walks every leaf path of `EpisodePayload` and `CaseSnapshot`, plants canary values (legal names, account numbers, registry ids, remark text, a personal field) in case A, retrieves in case B for each viewer role, and asserts no canary and no unkeyed hash of one appears in any sink: judge input, M10 view, bundle views, trace lines, retrieval log, cache. A negative control (a projection that copies one extra field) must fail the suite.

**7 Tests.** `T-PRE-01` planted rule changes: for each diff class a generated policy pair produces the expected class (differential against hand-written expectations). `T-PRE-02` validity equals brute-force re-evaluation for every episode and version pair in a generated history. `T-PRE-03` unevaluable never silently becomes valid. `T-PRE-04` view whitelist and canary leakage (step 5), plus `T-PRE-05` an erased episode is `unevaluable`, counter-only, and never support. Metric: stale-precedent-driven error rate (defined in C16).

**8 Risks.** Re-evaluation cost grows with episodes times versions (memoisation bounds it; measure at 10^4 episodes). If a new rule needs an attribute no old snapshot holds, most old precedents become `unevaluable` and the store is effectively reset for that rule family; that is correct but must be visible in the UI.

**9 Build notes.** After C1, C4, and M5a's pure `revalidate`. Unblocks C6.

---

## C6. Precedent index and scoring (the H-MEM binding and the pin)

**3 References.** R10 H-MEM scoring formula and `query` (read: `memoryRetrieval.ts` lines 22-98); R1 gate-then-fuse and `explain` (`scoring.py`); R6 three-factor score and the recency ordering (`retrieve.py::extract_recency`, read); R24 propensity-logged retrieval; `prior-art/11` §10.3A, `05` §10.3; R23 additive provenance weights ineffective, bounded occupancy recommended.

**4 What they do.** H-MEM: `raw = 0.35 semantic + 0.20 keyword + 0.10 tag + 0.10 domain + 0.15 entity + 0.05 layer + 0.05 recency - 0.20 superseded`, `score = clamp01(raw) * confidence`; keyword Jaccard uses only the first 8 query tokens (`tokenize(query).slice(0,8)`); recency is `exp(-ageDays/14)` on `lastAccessed`; `query` calls `store.touch` and logs a `read` entry for every hit, so each read changes `lastAccessed`, `accessCount` and the ledger (read in `query()` lines 83-86). The embedder is a lexical hash (brief A.1 gap 1). mem0 drops candidates below the semantic threshold before fusing keyword and entity signals (`score_and_rank`, line 111), so a keyword hit cannot rescue an irrelevant record. Generative Agents' `extract_recency` assigns `decay ** i` by list position (the order of the nodes passed in), min-max normalisation then changes meaning with the candidate set (`prior-art/05` §5).

**5 Decision.** **Adapt**: the base score is the H-MEM spec formula (spec section 11), computed by our H-MEM clone's new pure method `peek`; we add (a) hard filters before scoring, (b) mem0-style gate before factors, (c) fixed published factors, (d) a pin. Alternative rejected: a learned selector (R15) in the decision path. A structured-feature similarity is kept as an ablation arm and wins only if the precedent gold set says so (F-EMBED rule).

**6 Design.**

```ts
interface MemoryPin {                              // recorded in every trace and episode
  episodeSeq: number; outcomeSeq: number; labelSeq: number; retractionSeq: number; feedbackSeq: number;
  policyVersion: PolicyVersionId; configHash: Hash; factorsHash: Hash; embedderId: string; indexHash: Hash;
}
declare pure function retrieve(q: CaseQuery, view: MemoryView, cfg: MemoryConfig): PrecedentRetrieval;
```

1. **Feature vector and query text (closed vocabulary).** `FeatureVector` is `Record<string, string | integer>` with every key and enum value from the pack's `PrecedentSchema` (jurisdiction code, vendor-type enum, amount band, flags such as `bank_change_within_30d`, fired rule ids, decision type). The card text is rendered by code as tokens in a fixed priority order (most discriminating first, because H-MEM's keyword term sees only the first 8 query tokens). No counterparty-authored string (legal name, remark, document text) can reach the card: the renderer takes `FeatureVector` only. This is the structural defence against AgentPoison-style trigger tokens (C11).
2. **Writing to H-MEM.** One H-MEM record per episode: `content` = card text, `tags` = feature tokens, `domain` = pack, `type` factual, `layer` long_term, `source` = `decision:<caseId>`, `confidence` from the trust table (SOR 0.95, VERIFIED 0.90, EXTRACTED 0.60, UNTRUSTED 0.30; starting values), `entities` explicit (our clone's conformance-neutral extension to `AddInput`, since the reference extracts capitalised words from content). Records are never superseded in H-MEM for cases; validity is C5's.
3. **Hard filters (inside the index, before scoring).** `pack` and `decisionType` equal, `schemaMajor` compatible, `recordedAt <= pin`, retraction seq `<= pin` excluded. An erased episode stays in the index as `unevaluable{erased}` (C5): it can only appear as a restrictive-direction counter, and is listed in `excluded` with code `erased` otherwise.
4. **Base score.** `peek(card, {gate: 0, filters})` returns the H-MEM score without touching state; it is bound to M12's `snapshot(scope, pin)` plus pure `retrieve` with the threshold applied to the pre-`rerank` score, and M6's factors enter through `rerank: PureRerank` (R-HM1). `recency` uses the immutable `decidedAt`, not `lastAccessed`. The recency term is kept only if the ladder (spec section 10) measures a gain from it: the 14-day constant is meaningless for cases decided months apart, so the ladder tests a per-case-type half-life as well as the reference constant, and if neither beats "plus outcome" without recency the term's weight is set to 0 in the weight profile (INT-038). Gate: keep candidates with `base >= cfg.gate` (the gate sees the base score, never the factors).
5. **Factors (fixed table `memory/factors.v1.json`, JCS-hashed, hash in the pin).**

```json
{ "outcome": { "adjudicated_correct": 1.00, "verified_ok_matured": 0.90, "no_outcome_pending": 0.60,
               "no_outcome_censored": 0.60, "harm_or_too_restrictive_as_counter": 1.00 },
  "version": { "same": 1.00, "fired_changed_same_allowed": 0.80, "tightened_action_allowed": 0.60,
               "loosened": 0.70, "action_now_forbidden": 0.00, "disjoint": 0.00 },
  "unevaluable_as_support": 0.00 }
```
   `no_outcome_pending` equals `no_outcome_censored` on purpose: a restrictive precedent that can never be observed is not scored below a permissive one that can (survivorship, C8). The bias probe in C16 tests whether even this table favours permissive actions.
6. **Fixed-point arithmetic.** `micros(x) = round_half_even(x * 1e6)`; `scoreMicros = base * fOut * fVer / 1e12` on integers below 2^53; `Math.exp` is replaced by a fixed-iteration series using only `+ * /` so the trace hash is platform independent. Ties: score descending, then `episodeId` ascending.
7. **Pinned read.** `openView(pin)` reconstructs the index state from the logs (episodes up to `episodeSeq`, feedback up to `feedbackSeq`). `retrieve` calls only pure functions. `index.indexHash` is the digest of the M12 `PrecedentSnapshot` at the pin (JCS over the frozen records sorted by id, so over the `(episodeId, confidence)` pairs among other fields); a mismatch on open is `PIN_MISMATCH` (fatal for that retrieval). `MemoryPin` is the composite of per-log `SnapshotPin`s (M7 `readAtPin`) plus the policy, config, factors and index hashes.
8. **Reads write nothing that ranking reads.** The trace gets a `mem.retrieve` event; a separate `RetrievalLog` records `(runId, precedentIds, scoreMicros)`; `accessCount` and `lastAccessed` are not read by `peek`. Reviewer feedback (`helpful`, `not_helpful`, `wrong`) is the only path that changes `confidence`, through H-MEM `feedback()` and the feedback log, only from an authenticated reviewer action in the approval card, never from usage (a frequently retrieved wrong precedent must not strengthen itself, `prior-art/05` §10.3). Outcomes do NOT go through `feedback()`: they act through the outcome factor only, which avoids counting an outcome twice (once in `confidence`, once in the factor); this differs from the adapter sentence in `prior-art/11` §10.3A (Spec feedback 1).
9. **Concurrency.** Writers append; readers hold a pin and never see later records. Within one decision, every retrieval (including the re-plan loop and reflexion retries) uses the same pin.
10. **Conformance coexistence.** The sync `query()` remains for the Meterless runner and mutates as the reference does; the product never calls it. A differential test asserts `peek` ranks equal `query` ranks on the same store.

**7 Tests.** `T-IDX-01` pin purity: 1000 random retrievals, interleave appends, re-run each at its recorded pin, byte-identical `PrecedentRetrieval`. `T-IDX-02` read isolation: run a retrieval storm, hash the ranking inputs before and after, equal. `T-IDX-03` differential `peek` versus `query`. `T-IDX-04` gate-before-factor: a record with base below the gate and outcome factor 1.0 never appears. `T-IDX-05` determinism across two Node builds (fixed series versus `Math.exp`). `T-IDX-06` retrieval at a pin is invariant to later episodes, outcomes and retractions. `T-IDX-07` query-text injection: metamorphic, any change to a non-vocabulary input leaves the card text unchanged. Metrics: Recall@K and MRR on the precedent gold set for H-MEM base versus structured similarity versus BM25; Kendall tau of rankings under factor perturbation (±0.2 grid).

**8 Risks / NOT VERIFIED.** Whether a hash-embedder plus tokens retrieves structured cases well (likely close to token overlap; unmeasured). Factor values are placeholders (NOT VERIFIED) and a sensitivity report is mandatory. `Math.exp` bit-identity across platforms is a belief, hence the series. The `entities` extension and `peek` are changes to the engine that blueprint 12 must provide (R-HM1 to R-HM4, Interfaces); M12 currently prints scores as 4-decimal strings, which is too coarse for integer micros (new contradiction 2).

**9 Build notes.** After C1, C5. Needs blueprint 12's H-MEM clone with R-HM1 to R-HM4. Unblocks C7, C8.

---

## C7. Counter-precedents, explanation and judge obligations

**3 References.** R14 failures belong in memory; R29 HYPO-style counterexample and distinguishing (UNVERIFIED description); `prior-art/09` §12 fix 2; `prior-art/05` §10.3 two lists; R1 `explain=True` score details.

**4 What they do.** mem0 returns a score breakdown (`score_details`) but no opposing evidence. Generative Agents and the cookbook retrieve agreeing memories only. `prior-art/05` §10.9 notes that none of the repos guards against confirmation bias in retrieval.

**5 Decision.** **Own.** Counter-evidence is retrieved by construction, not by a second similarity query that might return more of the same.

**6 Design.**

These types and C5's `PrecedentView` and `Validity` are exported from one contract file, `memory/contract.ts`, which M5b imports; M5's own precedent types are replaced by them (INT-028).

```ts
interface CaseQuery {                            // built by M5b from its view digest; features come from M6's closed-vocabulary builder (C6 step 1)
  features: FeatureVector; pack: string; decisionType: string; schemaMajor: number; allowed: Action[]; asOf: Iso;
  purpose: "judge" | "autonomy" | "calibration_score";   // calibration_score drops same-cluster hits (leakage)
  counterparty: Id<"cp">;
}
interface PrecedentRetrieval {
  pin: MemoryPin; queryHash: Hash; allowed: Action[];
  lead: Action;                                  // argmax over allowed of summed positive polarity mass; ties go to the less permissive action
  support: ScoredPrecedent[]; counters: ScoredPrecedent[];
  counterSearch: { performed: true; candidates: number };   // qualifying counters before the kCounter cap; 0 means "none exist", never "not searched"
  perAction: Record<Action, { supporters: number; counters: number; neutral: number }>;
  informedness: Informedness;                    // C8
  autonomy: AutonomySupport;                     // C9
  excluded: { episodeId: EpisodeId; code: ExclusionCode }[];   // hard filter, cap, standing, tainted_permissive, unproven_permissive, erased
  obligations: { mustAddress: EpisodeId[] };     // every returned counter
  hash: Hash;
}
interface ScoredPrecedent { view: PrecedentView; polarity: Record<Action, -1 | 0 | 1>; baseMicros: Micros; outcomeFactorMicros: Micros; versionFactorMicros: Micros; scoreMicros: Micros; terms: Record<string, Micros>; featureDiff: string[] }
type DismissalBasis = { code: "rule_changed" | "outcome_unverified" | "tainted" } | { code: "fact_differs"; featureKey: string };
interface MemoryJudgement {                      // the memory part of M5's JudgeOutput, after M5 maps its handles to ids in code
  cites: EpisodeId[];
  dispositions: { precedent: EpisodeId; disposition: "relied" | "dismissed"; basis?: DismissalBasis }[];
}
type JudgementRejection = { code: "UNKNOWN_PRECEDENT" | "COUNTER_IGNORED" | "DISMISSAL_UNCONFIRMED" | "RELIED_NOT_VALID"; id: EpisodeId };
declare pure function validateJudgement(j: MemoryJudgement, r: PrecedentRetrieval): Result<void, JudgementRejection>;
```

1. **Polarity** of precedent p toward action a ∈ allowed: from `verdict` (C2) if present: `action_ok(x)` is +1 for a = x, 0 otherwise; `too_permissive(x)` is -1 for a at least as permissive as x, 0 otherwise; `too_restrictive(x)` is -1 for a at least as restrictive as x, 0 otherwise; `correct_set(S)` is +1 for a in S and -1 otherwise. With no verdict: +1 for a = p.action at the pending/censored factor and 0 elsewhere.
2. **Lead.** `lead = argmax_a sum_p max(0, polarity(p,a)) * scoreMicros(p,a)`, evaluated over gated, standing-eligible precedents; ties go to the less permissive action (fail safe).
3. **Support set.** Top `kSupport` with polarity(lead) = +1 and proven standing, then occupancy caps (`capPerCounterparty`, `capUnprovenInSupport`).
4. **Counter set.** Over all gated precedents (no over-fetch cap: the gate bounds the scan), those with polarity(lead) = -1, top `kCounter`; unproven precedents qualify only when restrictive-direction relative to `lead` (P-M1); at most `capTaintedInCounter` tainted ones; if any qualifying counter exists at least one is returned. A precedent whose action is `lead` with a harm label (a reversed outcome) is a counter by definition.
5. **Explanation.** Every shown precedent carries `terms` (the nine H-MEM terms, the confidence multiplier, the two factors, the cap decisions) in integer micros, and `excluded` lists why others were not shown. The retrieval record is hashed and stored in the episode (`retrieved[].viewHash`) and in the bundle (M9) with the views, so a stranger can recompute scores of the shown set offline; completeness of the candidate set is not provable offline without the store (Spec feedback 5).
6. **Judge obligations** (`validateJudgement`, owned by M6, called by M5b as its checks JV7 and JV8): the judgement must, for every id in `obligations.mustAddress`, either rely on it (as consideration) or dismiss it with a basis from one closed vocabulary whose applicability the validator checks mechanically: `rule_changed` requires `validity.state != valid`; `fact_differs` requires `featureKey` in `scored.featureDiff` (the keys where the query's features and the precedent's differ); `outcome_unverified` requires `outcomeState != observed`; `tainted` requires `precedentTrust` below `VERIFIED` (a weaker predicate than the standing level `tainted` of C9, which is `UNTRUSTED` only; INT-028). It also rejects an id that is not in this retrieval (`UNKNOWN_PRECEDENT`) and a relied precedent whose validity is not `valid` (`RELIED_NOT_VALID`). A dismissal whose claim the code cannot confirm is rejected, never repaired. An unaddressed counter makes the judgement invalid (M5 handles retry or escalation).
7. **What the judge sees.** Only `PrecedentView`s and score terms as delimited data; counter-precedents are labelled; free text from precedents does not exist. The model refers to precedents by M5's short handles only; M5 maps them to `EpisodeId` in code before calling the validator, so a fabricated id is inexpressible at that layer and M6 never sees a handle.
8. **Judge skipped (INT-065).** When M5b skips the judge (a single allowed action at or below the ceiling), retrieval still runs once for the autonomy gate and the episode record: `judgeSkipped` is true, `retrieved` and the autonomy support are recorded, and `obligations` are recorded but vacuous because no judgement exists to address them.

**7 Tests.** `T-CNT-01` a counter is returned whenever one exists in the gated set, and `counterSearch.candidates` equals the oracle's count (property test over generated stores; brute-force oracle). `T-CNT-02` the validator rejects: ignoring a counter, a dismissal with an unverifiable claim (each of the four bases), citing an id not in the retrieval, relying on a non-`valid` precedent; a mutated validator that skips any one check must fail the suite. `T-CNT-03` determinism of lead tie-break. `T-CNT-04` ladder arms differ on planted cases (rule-changed, reversed-outcome). `T-CNT-05` explanation completeness: recomputing each term from the stored view equals the stored term.

**8 Risks.** Dismissal vocabulary may be too narrow and cause needless escalations (measure the escalation rate it adds; report with the safety-cost curve). `lead` can flip with small factor changes (sensitivity report). Counter-queries add cost (one scan, no second ANN).

**9 Build notes.** After C6; the validator is needed by M5 before the judge integration.

---

## C8. Survivorship correction and the weakly-informed state

**3 References.** `prior-art/09` §12 and §11.5 (propensities, governed audit sampling); R24 Causal Memory Policy (reserve randomised slots with known propensities; its conclusion that identified utility alone is not enough for retention); Lakkaraju et al., selective labels (`prior-art/09` §5.5); Kallus and Zhou confounding-robust policy improvement (`09` §5.5); R19 Open Bandit Pipeline estimators (Python; re-implement and differential-test).

**4 What they do.** CMP reserves a fixed number of context slots for memories sampled with known propensities and weights by inverse propensity to estimate memory utility; reported AUC rose from 0.54 to 0.66 (abstract; preprint). Selective-labels work shows outcomes are seen only for accepted cases; contraction needs several reviewers with different strictness and random assignment (reported by the fetched summary). OBP provides IPS and doubly robust estimators.

**5 Decision.** **Adapt**. Two things are separated: a descriptive state (`informedness`) that is always computed and always shown, and an estimator that runs only when propensities exist and otherwise returns `unevaluable`. Live exploration in the release path is rejected; shadow retrieval is logged only.

**6 Design.**

```ts
interface Informedness {
  supporters: number; withObservedOutcome: number; knownShare: number;           // integer micros
  unknown: { pending: number; censored: number };
  weaklyInformed: boolean;                                                         // knownShare < cfg.knownShareMin or supporters == 0
  perAction: Record<Action, OutcomeSummary>;
}
type OutcomeSummary =
  | { kind: "estimate"; n: number; nObserved: number; harmRateMicros: number; wilsonUpperMicros: number; method: "observed_only" | "ips_clipped"; ess?: number }
  | { kind: "unevaluable"; reason: "no_observations" | "no_propensity" | "ess_below_floor" };
```

1. **Structural fact stated plainly.** Holds and rejects produce no outcome unless adjudicated; governed audit sampling randomises only inside the proved-safe action set, so it can never reveal what a rejected vendor would have done. Hence `censored` is permanent for restrictive precedents and `weaklyInformed` is the expected state for restrictive-action support. This is acceptable because autonomy concerns permissive actions, where outcomes are observed.
2. **What survivorship still biases.** The lead computation (C7) and the factor table (C6): a permissive precedent can be promoted to `verified_ok_matured` while a restrictive one cannot. The factor table narrows this gap (0.90 versus 0.60) and the bias probe in C16 measures it.
3. **Estimator.** Per action, among gated precedents with matured outcomes: observed-only harm rate with a Wilson upper bound (n small, so the bound is wide and printed). Where a precedent carries a logged observation propensity `pi > 0` (from governed audit sampling), the clipped IPS estimate and ESS are added; with deterministic loggers (`pi` in {0,1}) the summary is `unevaluable: no_propensity`. These are advisory statistics; they are not terms in the score and they cannot raise autonomy beyond the rule in C9.
4. **Shadow retrieval (optional layer, gated per spec section 21a).** On a seeded fraction of decisions, a second retrieval with one randomised slot is computed and logged with its propensity; its output never reaches the judge. Randomness from `ctx.rng` with the seed in the trace. It exists to produce data for the methodology study and is labelled so (DEC-06: simulator-authored propensities validate methodology, not real value).
5. **The displayed message.** "Weakly informed: 1 of 5 supporting precedents has an observed outcome; 4 are held or rejected cases whose outcomes cannot be observed." M10 renders it; M5's selective-release gate reads the boolean.

**7 Tests.** `T-SRV-01` planted censoring: a generator where holds are never observed; `weaklyInformed` is true and autonomy cannot rise on that support. `T-SRV-02` estimator: with known propensities IPS recovers the planted harm rate within its interval over 1000 simulator runs; with a deterministic logger it declares `unevaluable` (mirrors `prior-art/09` §11.7). `T-SRV-03` Wilson bound against exact binomial tables. `T-SRV-04` shadow retrieval never changes a live decision (differential run with it on and off).

**8 Risks.** Everything is simulator-authored (DEC-06). Clipping bias and ESS floors need tuning. The `knownShareMin` threshold is a convention, not derived.

**9 Build notes.** After C6; the estimator waits for M5's audit-sampling design.

---

## C9. The trust-level algebra applied to memory

**3 References.** Spec section 5 (lattice, `combine`, verification events); R21 Memory Provenance Laundering (consolidation rewrites external observations into apparent user history; a non-amplification firewall blocked unauthorised high-risk actions in the authors' tests); R23 additive provenance weighting had no measurable effect and bounded occupancy was recommended; `prior-art/11` §6.2 on MemIR typed atoms (arXiv 2605.25869) and Nous (2606.22030) belief caps.

**4 What they do.** The laundering paper shows summarisation can erase origin and lift apparent authority; the fix is to carry origin and block actions by matching risk to provenance authority (abstract level). The utility paper reports that content screening missed every poisoned item in its setting and additive trust weights did not help (author-reported, preprint).

**5 Decision.** **Adapt** with the spec's lattice. No additive trust penalties; trust enters through eligibility (standing) and bounded occupancy.

**6 Design.**

```ts
interface Standing { level: "proven" | "unproven" | "tainted"; why: string[] }
interface AutonomySupport { allowsAbove: AutonomyLevel; reasons: string[] }       // max autonomy level the memory evidence supports
declare pure function precedentTrust(ep: EpisodePayload, outcome: OutcomePayload | null): TrustLevel;
declare pure function standing(p: PrecedentView, polarityDirection: "restrictive" | "permissive" | "neutral"): Standing;
declare pure function autonomySupport(r: PrecedentRetrieval, requested: AutonomyLevel): AutonomySupport;
```

1. **Precedent trust.** `precedentTrust = combine(caseTrust, outcomeTrust)`, where `caseTrust` is the `combine` over the trust of the facts in `uses.factIds` that were policy-relevant (M5 supplies the dependency set; a mutation test drops a parent and must fail; a fact's trust is already the meet over its `supports`, and `defeats` never lower it, INT-013) and `outcomeTrust` is the trust of the outcome evidence when an outcome exists. Without an outcome the term is absent and `precedentOutcome = none` blocks autonomy anyway.
2. **Tainted** is `UNTRUSTED`. **Unproven** is `EXTRACTED`, or `valid` false, or an unverified outcome behind a permissive claim. **Proven** requires trust at least `VERIFIED`, validity `valid`, and for permissive support a verified matured outcome.
3. **Counter-only, refined (Spec feedback 2).** "Tainted precedents are counter-only" is not enough under restrict-only: a poisoned record that says a release was fine is a counter to a hold-leaning lead, and showing it pushes the judge toward permission. The rule is: tainted and unproven precedents are shown only when restrictive-direction relative to the lead; permissive-direction ones are dropped from the judge input and appear in `excluded` with code `tainted_permissive` or `unproven_permissive`, visible to reviewers.
4. **Autonomy above AL1 (spec section 11).** `autonomySupport` returns at most `AL1` unless: at least one proven supporter with trust at least `VERIFIED`, `validity = valid`, matured verified outcome; `weaklyInformed = false`; no unaddressed counter with a harm verdict at the same action; the policy's own cell cap (M5) is separate. The minimum of one is the spec's; whether three independent clusters should be required is an ablation arm.
5. **Derived memory objects.** Every `SummaryView` or `RuleProposal` takes `combine` over its `derivedFrom`; the type system makes `derivedFrom` mandatory and a test drops one (non-amplification, R21).
6. **Bounded occupancy** replaces additive trust penalties: caps by counterparty cluster, by unproven class and by tainted class (C6 config).
7. **Confidentiality (INT-021).** A `PrecedentView` is the C5 whitelist projection; its `conf` is the shared `join` of the fields shown; no field above `public` that belongs to another counterparty reaches a judge, UI or bundle in a case where the viewer has no access (the base `case-visible` label is scoped to the case). Precedent views cross cases only through that projection, with the canary test `T-PRE-04`. Full episode access is a separate permission in M10/M13.

**7 Tests.** `T-TRU-01` taint-tracking: every derived memory object's trust is at most each parent's (property test with a mutation that drops a parent). `T-TRU-02` permissive-direction tainted precedents never reach judge input (adversarial: plant a tainted release precedent near a hold-leaning case). `T-TRU-03` autonomy: each missing condition independently blocks `AL2`. `T-TRU-04` confidentiality canaries. `T-TRU-05` property tests of `combine` are kept but not offered as evidence of safety (spec section 5).

**8 Risks.** Whether the policy-relevant dependency set is complete is an M5 property (a missed parent would let trust be overstated); the taint-tracking run over the hero cases is the check. Treating `EXTRACTED` as unproven may starve precedents in the demo corpus (measure the share).

**9 Build notes.** Needs the M8 trust table and M5 dependency sets; implement `precedentTrust` before C6 ships to M5.

---

## C10. The write path and contradiction handling

**3 References.** `prior-art/05` §10.7 (write path); R1 `_add_to_vector_store` (exact-hash dedupe, advisory contradiction) and `history` table with `actor_id`; R4 `actions_permitted`; R2/R3 for contradiction; HaluMem scores the write path (R18).

**4 What they do.** mem0 deduplicates by MD5 of exact text against ten neighbours and persists only `text` and `attributed_to`; its prompt asks for contradiction links that the OSS code never consumes (`prior-art/05` §2). LangMem restricts verbs with `actions_permitted` and lets an LLM apply deletes directly.

**5 Decision.** **Own** one gateway for every record kind. It is the only door; nothing writes the logs directly.

**6 Design.**

```ts
type WriteKind = "episode" | "outcome" | "label" | "retraction" | "assertion" | "policy_version" | "proposal" | "certificate" | "feedback" | "finding" | "carryover" | "reflection";
interface WriteRequest<K extends WriteKind> { kind: K; payload: Json; writer: Writer; derivedFrom: Id<string>[]; idempotencyKey: string }
declare function write<K extends WriteKind>(ctx: Ctx, req: WriteRequest<K>): Result<WriteReceipt, WriteRejection>;
type WriteRejection = { code: "WRITER_NOT_PERMITTED" | "SCHEMA" | "REF_MISSING" | "AUTHORSHIP" | "TRUST_FLOOR" | "CONFLICT_QUEUED" | "APPROVAL_REQUIRED" | "RATE_LIMIT" | "INTEGRITY"; detail: Json };
```

1. **Writer matrix (data, test input).** `episode`: runtime after decision close only. `outcome`: M13 connectors. `label`: reviewer subject or the deterministic mapping. `assertion`: M3. `policy_version`: M5 gate after approvals. `proposal`, `certificate`: consolidator. `feedback`: authenticated reviewer. `finding`, `carryover`: runtime within a case. `reflection`: runtime, case-scoped. No `model` writer exists; a model output is wrapped as `Proposal<T>` and a deterministic validator is the writer.
2. **Steps.** (1) check the writer against the matrix; (2) stamp provenance (writer, run, trace seq, input hashes, origin ids); (3) assign trust by the M8 table for (source, attribute, producer) and `combine` over `derivedFrom`; (4) validate the payload against the JSON Schema for the kind (strict, unknown fields rejected); (5) resolve references: every referenced id exists at the current head, authorship rule for outcomes and labels (C2); (6) dedupe: content-derived ids make writes idempotent; near-duplicate episodes (equal case fingerprint = hash of `features` plus `policyVersion`) are kept and linked `dupeOf`, counted once by occupancy and removed before any holdout split (leakage); (7) kind-specific contradiction check (assertions: C3 step 5; labels: a second label with a different verdict for the same outcome opens a conflict item, never overwrites); (8) approval: the matrix maps `(kind, trust, origin)` to none or an `ApprovalItem` of the shared types `memory_write` or `rule_proposal` (item service and clocks are M13's, item semantics M5's); the default on timeout is deny (`expired_denied`); an approval is recorded as `approvedBy` on the write and never changes its `trust` or any label (test `SEC-W1`); (9) atomic append plus index update plus anchor queue; (10) trace `mem.write` with `why`.
3. **Fail closed.** A model or store failure produces a rejection and an explicit failed state, never a placeholder record (`prior-art/05` §10.8 rule 8).
4. **Rate limits and dedupe on conflict items** so a flood of contradictory assertions cannot become an approval denial of service (`MEM-P08`).
5. **What is deliberately not done.** No LLM content filter on the write path (content screening is a signal at most; R23 reports it missed every poisoned item in its setting). No LLM-chosen update or delete.

**7 Tests.** `T-GW-01` writer matrix: exhaustive (kind x writer) table test. `T-GW-02` rejection codes per step with a minimal violating payload. `T-GW-03` idempotency under crash. `T-GW-04` conflict items bounded under flood. `T-GW-05` inert-stub control: a gateway that allows everything must fail the suite (spec section 19, inert controls).

**8 Risks.** The matrix is only as good as writer identity binding in M7/M8 (a forged writer identity defeats it; forged-object rejection tests are M8's). Approval volume is a usability risk.

**9 Build notes.** Build with C1; every other component's writes go through it.

---

## C11. Poisoning defences and the adversarial suite

**3 References.** R11 MINJA and R12 AgentPoison (attacks, abstract level plus repository READMEs through `prior-art/11`); R25 agent-authored memory self-propagation (58 percent of runs wrote misaligned goals when objectives were explicit; a memory auditor halved but did not remove it; abstract, preprint); R23; R21; Sunil et al. (2601.05504, attack success drops when the store already holds legitimate memories); `prior-art/11` §6.2 write-time defences cost little and read-time reranking cost accuracy (2609.22818); promptfoo and AgentDojo for run format (spec section 17).

**4 What they do.** MINJA injects records through ordinary queries using bridging steps; reported injection success above 95 percent and attack success about 70 percent under idealised conditions. AgentPoison poisons a memory or RAG store with triggered demonstrations (above 80 percent attack success at under 0.1 percent poison rate, assuming write access). The reality check paper finds lower success against stores holding legitimate memories. All numbers are author-reported on author-built attacks; there is no standard adaptive-attack benchmark for precedent stores (`prior-art/11` §6.2).

**5 Decision.** **Own the suite**; adapt the two attacks to documents and agent-authored memory. Defences are structural (C1, C2, C3, C6, C9, C10); detectors are telemetry that force escalation, never gates.

**6 Design.** Attack families, all executed through the real gateway and retrieval path with the adversary controlling the model port where relevant:

| Id | Attack (source) | Entry point | Structural defence | Oracle |
|---|---|---|---|---|
| MEM-P01 | bridging cases that seed episodes near a victim region (MINJA adapted: ordinary case intake, sleeper payments to earn `observed_ok`) | intake | occupancy cap per counterparty cluster; outcome evidence channels; proven standing | victim decision equals the benign twin without attacker episodes; retrieved attacker share <= cap |
| MEM-P02 | trigger tokens in names, remarks, document text (AgentPoison adapted) | extractor output, registry fields | retrieval card built from closed vocabulary only (C6 step 1) | metamorphic: retrieval hash identical with and without the trigger |
| MEM-P03 | forged outcome evidence (counterparty-authored remittance advice) | outcome write | authorship rule (C2) | `labels_from_untrusted == 0` |
| MEM-P04 | label or fact written by the deciding or a hostile model | model port | no model writer (C10) | writes with model writer == 0 |
| MEM-P05 | consolidation laundering: tainted episodes feed the miner (R21) | consolidation | proposal trust is `combine` of support; loosening needs proven support (C12 L1) | loosening proposals from tainted support == 0 |
| MEM-P06 | agent-authored reflection carrying instructions (R25) | reflection | reflections are case-scoped and unreadable across cases | next case's judge input hash unchanged |
| MEM-P07 | later-dated self-declared assertion supersedes an SOR value | assertion | C3 step 4 | decision-view facts unchanged; conflict item exists |
| MEM-P08 | conflict-queue flood | assertion | rate limit, dedupe (C10) | queue length <= cap; legitimate item still reviewable |
| MEM-P09 | invented ids or instructions in carryover | Markovian chunk | carryover validator (C14) | chunk rejected; zero invalid ids admitted |
| MEM-P10 | cache entry forged on disk | cache | key and dependency fingerprint check (C15) | forged entry ignored |
| MEM-P11 | poison hidden in a derived summary to survive retraction | consolidation | `derivedFrom` edges in the dependency graph (C13) | retraction closure includes the summary |
| MEM-P12 | cross-counterparty leakage through a precedent view | retrieval | whitelist projection and canary test (C5 steps 4 and 5) | canary values of case A absent from every case B sink (judge input, views, trace, bundle) |
| MEM-P13 | sleeper vendor builds a genuine record, then defrauds | n/a | not a memory defect: required positive evidence and attestation (spec section 5) | reported as a residual, not claimed closed |

1. **Positive controls.** Each family must succeed against an undefended baseline: an ADD-only store (R1-style) with cosine retrieval and a proxy judge. A family that does not succeed against the baseline is a broken attack and is reported as such.
2. **Statistics.** Per family: attack success rate with exact binomial upper bound (3/n when zero), n >= 100 seeds per family where the family is cheap, held-out seeds; report which attacks were adaptive (a search over the attacker's free parameters, bounded budget) and which were fixed scripts.
3. **Judge.** The deterministic proxy judge isolates memory effects; a real-model arm runs when credentials exist and is reported separately.
4. **Wiring.** The suite is a Plumbline-Inject extension (M11) with oracles read from state and trace, not from judge text.

**7 Tests.** The table is the test list (`T-POI-P01..P13`), plus `T-POI-00` positive controls and `T-POI-99` the inert-defence control (gateway that always accepts must fail the suite).

**8 Risks / NOT VERIFIED.** Adaptive attackers beyond our parameter searches; the sleeper residual; whether `R25` replicates on our agents. Defence numbers are for our simulator only.

**9 Build notes.** Needs C1 to C10 and C14, C15; build attack harnesses while those are built.

---

## C12. Consolidation: proposals, certificates and the harm-curve experiment

**3 References.** R20 consolidation can fall below no memory (preprint; ARC-AGI stream, one lab); R13 ACE delta updates; R17 sleep-time compute; `prior-art/11` §2.3 Auto-Dreamer (learned, destructive), §2.4 TrustMem verifier (coverage, preservation, faithfulness), §2.5 ConsolidationBench (quality scores did not predict transfer); R10 H-MEM `dreaming.ts` and `sleepCycle.ts` (read); CORELS idea (GPL-3.0, `prior-art/09` §6.3: idea only); `prior-art/09` §11 (holdout leakage, multiplicity, unevaluable).

**4 What they do.** H-MEM `dream()` clusters by a relatedness blend (0.5 cosine, 0.2 tag Jaccard, 0.1 domain, 0.2 entity Jaccard) and proposes text by concatenation ("Across N related memories: a + b"); `approve` materialises a long-term record with `derivedFrom`. `sleep.execute` synthesises by concatenating contents and then deletes the source records (`sleepCycle.ts` lines 94-110), which contradicts immutable episodes, and archiving calls `store.delete`. Auto-Dreamer is RL-trained and replaces memory. TrustMem checks transitions with a model-based verifier. R20's abstract and `prior-art/11` §2.2 report the harm effect and recommend raw episodes as primary evidence.

**5 Decision.** **Own.** H-MEM sleep and dream are not run on precedents (spec section 19 rejected list); they remain conformance surface and may run on non-precedent notes. Consolidation here is a miner that can only emit `RuleProposal`s, a certificate computed by deterministic code, and a human approval.

**6 Design.**

```ts
interface RuleProposal {
  id: Id<"rp">; base: PolicyVersionId; patch: RulePatch;                 // IR delta against the base, parsed by the IR grammar
  support: EpisodeId[]; counterExamples: EpisodeId[];
  miner: { kind: "dnf_search" | "llm_draft"; id: string; promptHash?: Hash };
  trust: TrustLevel;                                                     // combine over support and drafter
  certificate: Certificate | null; status: "candidate" | "rejected" | "queued" | "approved" | "activated";
}
interface Certificate {
  baseRuleVersion: PolicyVersionId; patchHash: Hash;
  split: { kind: "temporal_holdout"; cutoff: Iso; embargoDays: number; clusterDisjoint: true; dedupedByFingerprint: true; nTrain: number; nHold: number };
  replay: { fired: number; improved: number; worsened: number; neutral: number;
            precisionMicros: number; recallMicros: number; wilsonLowerMicros: number; wilsonLevelMicros: number;      // level adjusted for the candidate count
            perRuleVersion: Record<string, { n: number; precisionMicros: number; recallMicros: number }>;
            labelBasis: "hindsight_labels"; imitation: { agreeMicros: number; humanDisagreements: Id<"ep">[]; justified: Record<string, string> } };
  mutationTests: { atom: string; field: string; expectedFlip: boolean; flipped: boolean; n: number }[];
  gate: { classification: "tightening" | "loosening" | "mixed"; invariantsReproved: boolean };    // from the injected GateClassifier (M5's pure classification; M6 imports the type only, INT-037)
  nonAmplification: { inputsMinTrust: TrustLevel; proposalTrust: TrustLevel };
  noMutation: { sourceRootBefore: Hash; sourceRootAfter: Hash };         // Merkle root over every referenced episode hash
  power: { minLabelledHoldout: number; actual: number };
}
```

1. **Miner A: deterministic DNF search (primary).** Enumerates conjunctions of at most three atoms from the IR's closed predicate library over the training split; each candidate is scored for exact precision and recall against hindsight labels (not against human decisions); candidates are ranked, capped at `maxProposalsPerCycle`, and the cap is the multiplicity count m. This gives the CORELS idea without its code, works without a model, and makes the harm-curve comparison reproducible. **Miner B: LLM drafter (arm).** A model receives cluster statistics and exemplar views and returns a `RulePatch` that must parse under the IR grammar; its output is a `Proposal<RulePatch>` and is certified exactly like Miner A's. Neither miner can emit anything except a `RuleProposal`.
2. **Split.** Mining uses episodes with `decidedAt < cutoff - embargo`; the holdout is episodes at or after `cutoff` whose outcomes matured before certification; split by counterparty cluster so no cluster straddles; near-duplicates (same fingerprint) removed before the split. Selection among candidates uses training data only; the holdout is evaluated once per proposal (a fixed-sample bound is then valid; repeated looks would need confidence sequences, which belong to M5's ladder promotion).
3. **Replay metrics, kept apart.** Against hindsight labels: for each labelled holdout case compare the baseline action and the action with the patch: `improved` (baseline excluded by the label, patched not), `worsened` (the reverse), `neutral`. Precision is `improved / (improved + worsened)`; recall is `improved / baseline-excluded cases`; the Wilson lower bound is taken at level `1 - delta/m`. Agreement with human decisions is reported as `imitation` and is never the pass criterion (imitation is not outcome, `prior-art/09` §11.2).
4. **Admission (rejects, never repairs).** Codes: `CERT_NO_HOLDOUT`, `CERT_POWER` (too few labelled holdout cases), `CERT_WILSON_BELOW` (below the published floor), `CERT_WORSENED` (any `worsened` beyond the published tolerance), `CERT_T0_CONTRADICTION` (a holdout case where the patch contradicts a human decision with no machine-checkable justification), `CERT_MUTATION_MISMATCH`, `CERT_TRUST_AMPLIFIED`, `CERT_SOURCE_HASH_CHANGED`, `CERT_LEAKAGE`, `CERT_GATE_MISSING`, and **`CERT_LOOSENING_UNPROVEN`**.
5. **Rule L1 (new, Spec feedback 8).** A proposal whose support includes any non-proven (tainted, unproven or unlabelled) episode may be admitted only if the injected `GateClassifier` classifies it `tightening` (M5's `unknown` or timeout classifies as `loosening`, which then needs all support proven). Loosening requires all support proven. This is restrict-only applied to learning and is the structural answer to consolidation laundering (R21).
6. **Mutation tests.** For each atom of the patch, take sampled holdout cases and alter exactly one field through the IR's field inverse (move a threshold value across the boundary, flip a flag): the rule must fire or stop firing as the rule text predicts; mutations of fields outside the patch must not change firing (metamorphic, no model involved).
7. **Triggers (consolidation is a budget decision, `prior-art/11` §2.5).** The default is retain. A cycle runs when an override cluster reaches a published size, when harm labels cluster under one permitted action, or when conflict density crosses a threshold; at most one cycle per trigger window.
8. **Reflexion and reviewer rejections** feed the miner only as structured events (rejection reason codes), never as reflection text (C11 `MEM-P06`).
9. **Activation.** Approval (an `ApprovalItem` of type `rule_proposal`, M13's service) lets the M5b gate write a `policy_version` through the gateway (C4); consolidation never activates anything.

**The consolidation-harm curve experiment (contribution C8 of the grant case; pre-registered in `eval/prereg/` before any run).**

- Stream: the generator emits T cycles of cases with planted regularities, a planted rule change, label noise and near-duplicates; accuracy is measured on a fixed held-out slice after each cycle t = 0..T.
- Arms: A0 no memory; A1 episodic retention only (precedent retrieval, no consolidation); A2 unconstrained LLM consolidation rewriting a summary store each cycle (needs a real model; **NOT VERIFIED availability**); A2s a simulated lossy consolidator with parameterised omission and spurious-rule rates (labelled simulation, not LLM evidence); A3 Plumbline proposal-only with certificates and a simulated approver that accepts every certified proposal; A4 proposal-only without certificates (shows what the certificate buys); A5 as A3 with a noisy approver.
- Metrics: decision accuracy, harmful-release rate and false-hold rate per cycle, three seeds per arm, paired by seed, cluster-bootstrap intervals; hypotheses H1 A2 falls below A0 in the late cycles (replication attempt of R20, may fail and is reported either way); H2 the A3 slope is within a pre-registered margin of non-negative (TOST-style equivalence, margin fixed beforehand); H3 A4 is worse than A3 on harmful-release rate.
- Limits stated up front: the approver is simulated; the stream is synthetic; one domain.

**7 Tests.** `T-CON-01` the proposal-only invariant: static check that the consolidation module's exported write types are `RuleProposal` and `SummaryView` only, plus a runtime guard. `T-CON-02` certificate checks, each rejection code with a minimal violating proposal. `T-CON-03` mutation tests flip exactly as predicted, including a planted wrong rule text. `T-CON-04` holdout leakage: planted near-duplicates across the split make `CERT_LEAKAGE` fire. `T-CON-05` sources unchanged: Merkle root equal before and after a cycle. `T-CON-06` rule L1 under `MEM-P05`. `T-CON-07` miner A determinism. `T-CON-08` the harm-curve harness itself with a known-bad consolidator that must show the decline.

**8 Risks / NOT VERIFIED.** Labelled holdout may be too small for any certificate to pass (then nothing is learned, which the report says; `CERT_POWER` is the honest outcome). The model-drafter might propose only easily certified rules. Everything runs on a simulator; R20 is a single preprint. Wilson at the adjusted level on tiny n is wide; the report prints it.

**9 Build notes.** After C2, C4, C5; the `GateClassifier` from M5 is injected for classification. Harness before miner B.

---

## C13. The decision-dependency graph and exact cascading retraction

**3 References.** R22 PACMI and dependency-guided rollback (heuristic or LLM-estimated blast radius, reported 68 to 85 percent recovery on small benchmarks); R27 truth maintenance systems (justification-based and assumption-based: retract a premise and propagate; descriptions UNVERIFIED beyond title); R8 `HippoRAG.delete` and R9 `adelete_by_doc_id` (source-count subtraction and rebuild); R16 differential dataflow (incremental recomputation; idea only); Green et al. provenance semirings (`prior-art/07` §4.1) as the model for exact retraction in M3.

**4 What they do.** R8 removes a document's chunks, triples and entities after subtracting the document from `fact_source_counts` on each edge, deleting edges whose remaining counts are empty (`_remove_fact_sources_from_graph`, read); R9 rebuilds partially affected entities from remaining chunks (docstring). Both physically delete derived structures, keep no history and say nothing about which decisions used the removed facts. PACMI invalidates dependents in a typed provenance graph with four validity states and reports fewer final-answer errors on a 100-case benchmark (abstract). TMS literature maintains justifications so that retracting a premise withdraws its consequences.

**5 Decision.** **Own**, reusing M4's pure recompute `V(S)`. The advantage over R22 is determinism: the policy stage and the retrieval stage are pure functions of recorded inputs, so affected decisions are recomputed, not estimated. Rejected: physical deletion (R8, R9 pattern); LLM judgement of impact.

**6 Design.**

```ts
interface UsedIds { factIds: Id<"fa">[]; assertionIds: Id<"as">[]; evidenceIds: Id<"ev">[]; originIds: Id<"og">[];
                    precedentIds: EpisodeId[]; policyVersion: PolicyVersionId; featureFnVersions: Record<string, string>; configHash: Hash }
type RetractTarget =
  | { k: "assertion"; id: Id<"as"> } | { k: "evidence"; id: Id<"ev"> } | { k: "origin"; id: Id<"og"> }
  | { k: "precedent"; id: EpisodeId } | { k: "policy_version"; id: PolicyVersionId } | { k: "feature_fn"; name: string; version: string }
  | { k: "outcome"; id: Id<"oc"> } | { k: "label"; id: Id<"lb"> } | { k: "source_channel"; id: string; from: Iso; to: Iso };
type Impact = "allowed_set_changed" | "autonomy_changed" | "judge_input_changed" | "second_order" | "unaffected" | "unevaluable" | "executed_incident";
interface RetractionReport { retraction: Id<"rt">; target: RetractTarget; reason: RetractReason; closureSize: number; vSpecHash: Hash;
                             decisions: { episodeId: EpisodeId; impact: Impact; before?: DetSummary; after?: DetSummary; executed: boolean }[];
                             completeness: "complete" | "partial"; hash: Hash }
```

1. **Graph.** Nodes are ids; edges are `uses` from each episode (and from `SummaryView`, `RuleProposal`, `finding` records through `derivedFrom`). The graph is a pure fold over the logs and is rebuilt on demand. Edges point backwards in time (a decision's pin precedes it), so the graph is a DAG by construction; an acyclicity check runs on every build.
2. **Retraction is an event.** `retraction` is appended (writer: reviewer, M13 or a monitor; approval for high-impact targets). Effects on projections: an assertion is excluded from the fact view; a retracted precedent becomes `Validity.retracted` and is filtered by hard filter; a retracted label or outcome reverts its verdict in the view; nothing is deleted.
3. **Closure.** `closure(target)` = all episodes whose `uses` contains the node, plus, for a retracted precedent, all episodes whose *shown* `retrieved` set contains it (a precedent outside the shown set cannot affect that decision: removing an item that is not in the top-K and not a counter leaves the top-K unchanged, a property T-RET-03 tests, not assumes), plus transitive closure through derived objects.
4. **Exact deterministic recomputation per affected decision (first order).** (a, b) facts and policy are M4's `Evaluator` composition `V = phase2 ∘ phase1` (INT-034) run through `Recompute(snapshot, removed)`: `phase1` is M3 `reconcile` from the recorded assertions minus the retracted and the recorded link decisions, then label aggregation and M5a `featurize`; `phase2` is M5a `evaluate(policyVersion, ·)` giving `allowed`, `ceiling`, `fired`. The episode's `vSpecHash` must equal the current one or the report says so. The retraction is exact in two named cases: for monotone support, retracting a provenance term equals recomputation, and for a defeated single-valued cell, M3's cell-local re-fuse equals recomputation; evidence-mass counts merge by set union, not addition (INT-039); (c) memory: `retrieve(q, view(pin) minus retracted)` to the new shown set; (d) autonomy: `autonomySupport` on the new retrieval; (e) compare with the recorded `DetSummary`. Impact classes: `allowed_set_changed` or `autonomy_changed` (exact), `judge_input_changed` (the shown precedent set or facts differ but allowed set and autonomy do not: re-judge queue, not exact), `unaffected` (closure did not contain it, or recomputation equal), `unevaluable` (erased body, unavailable feature function), `executed_incident` (an effect receipt exists in M13: an incident workflow, not an automatic fix).
5. **Second order (P-M6).** A decision d whose shown precedents include an affected episode e is `second_order` unless e's counterfactual allowed set is a singleton (e's action is then determined without the judge), in which case e's counterfactual action propagates and d is recomputed exactly. Otherwise d is reported `second_order` with the list of affected predecessors, never `unaffected`.
6. **Output.** The report is canonical JSON, hashed, anchored in M9, and rendered by M10 as an auditor's "if this memory had not existed" view. A re-judge queue item per `judge_input_changed` and `second_order` decision goes to M13. Rule rollback, bad-source discovery and poison removal use the same call with different targets.
7. **Budgets.** Recomputation cost is bounded per report; exceeding it returns `completeness: partial` with the remaining ids listed, never a silent truncation.
8. **Reuse.** The same `Recompute(snapshot, removed)` is M4's counterfactual machinery (the `Evaluator` of step 4); retraction is "removal of a set R from the frozen snapshot" for every decision in the closure. The snapshot body is opened from the blob store; if it was erased the decision is `unevaluable`, never `unaffected`.

**7 Tests.** `T-RET-01` affected-set equality (the headline): over a generated history of 10^3 to 10^4 decisions with planted poison, the first-order set from the graph equals the set obtained by re-running the full deterministic pipeline for every decision with the item removed (ground truth by brute force; reported as set equality, not F1). `T-RET-02` second-order over-approximation rate against ground truth in the simulation with the deterministic proxy judge (which can compute true counterfactual chains). `T-RET-03` removal of a non-shown precedent never changes retrieval (property). `T-RET-04` rule-rollback: closure equals decisions with `uses.policyVersion = v`. `T-RET-05` laundered summary included (`MEM-P11`). `T-RET-06` erased episode is `unevaluable`, not `unaffected`. `T-RET-07` DAG check and a rebuild-equals-incremental test. Metric: report time and exactness versus history size.

**8 Risks / NOT VERIFIED.** Exactness covers the policy and bounded-state stages, not the model judgement (spec section 11); this blueprint adds the second-order rule, which the spec does not state. Snapshot retention conflicts with erasure. Whether M3 `reconcile` from recorded link decisions is bit-reproducible is M3's property (differential test in both modules). Graph size at scale is unmeasured.

**9 Build notes.** After C1, C5, C6, C9 and the pure entry points of M3, M4 and M5a (INT-037). Build the brute-force oracle first.

---

## C14. Markovian carryover, ratify and contamination

**3 References.** R10 Markovian `carryover.ts` (read: cascade marker, LLM, heuristic, tail truncation; marker accepted when 24+ characters and within budget; state labelled COMPLETED/REMAINING/DECISIONS/CONTEXT) and brief A.3; Delethink 2510.06557 (carry the last m tokens of text; degrades when required state exceeds m: `prior-art/11` §8); MEM1 (2506.15841) and MemAgent (2507.02259) carry latent or overwritten free-text state, trained with RL; `prior-art/11` §8 ids-not-facts design.

**4 What they do.** The reference carries whatever text the model wrote as a state marker, or an LLM compression, or heuristic key phrases, or the truncated tail (`carryover.ts` lines 29-69); a hallucinated "fact" in that text is carried forward with no source, and over-budget markers fall through to lower levels rather than raising an overflow (brief A.3 item 6). Delethink and the others evaluate trained models on maths and QA.

**5 Decision.** **Own** the carryover content and its validator; the engine (blueprint 12) supplies chunking, budgets and token accounting. The engine's cascade stays for conformance; the product replaces the content with a code-built block.

**6 Design.**

```ts
interface Carryover {
  goalHash: Hash; caseId: Id<"case">; asOf: { worldModelSeq: number; policyVersion: PolicyVersionId; memoryPin: MemoryPin };
  facts: { id: Id<"fa">; hash: Hash; trust: TrustLevel }[];                  // ids plus content hash; never values
  findings: { id: Id<"fd">; about: Id<"fa">[]; holdRelevant: boolean; chunk: number }[];
  openQuestions: { id: string; about: Id<"fa">[]; code: string }[];
  freeNote: string;                                                          // hard cap (200 tokens), advisory, never read by code paths that decide
  state: "ok" | "carryover-overflow";
}
```

1. **Authoritative ledger.** Findings are typed outputs of each chunk written (through the gateway) to the case's findings ledger in the World Model `check` context. The carryover is a code-built cache of that ledger for the model's convenience; the model-written marker text is not used (the product prompt forbids markers and the host strips them; the host supplies the block through the `carryoverBuilder` hook with overflow signalling that blueprint 12 must expose as R-MK1, see Interfaces; the typed Markovian profile is an extension and M12's conformance claim covers `profile: "conformance"` only, INT-062).
2. **Per-chunk validation.** After each chunk: parse the model's structured output against the schema; every cited fact id must resolve in the World Model at `asOf` and its content hash must equal the carried hash; `freeNote` is length capped; no free text outside `freeNote` and `openQuestions.code` is accepted. A failed validation retries the chunk once with the error injected (error class `validation`); a second failure is `fail closed: hold` with the chain as evidence.
3. **Overflow.** If the ids that must be carried exceed the token budget, hold-relevant ids are kept first, `state = "carryover-overflow"`, the count of omitted non-hold ids is carried, and the omitted ids remain in the ledger. Overflow never truncates silently; it is a trace event and a metric.
4. **Ratify (deterministic, before any decision leaves the chain).** For the final chunk the host builds the decision input from the ledger, not from the carryover, then checks: (a) every `holdRelevant` finding id is in the final carryover or the state is `carryover-overflow` with those ids listed in the ledger; (b) each id the policy needs (M5 dependency set) re-reads from the World Model at `asOf` and the hash equals; (c) no id in the final output is absent from the ledger. Any failure is `hold`. This makes a dropped sanctions hit a code failure, not a second model's opinion.
5. **Scope.** Chunking is used only inside one deep case (an ownership chain). A batch is a fan-out of independent per-case runs with a code-level aggregate over typed results (cumulative exposure). All ids are namespaced by `caseId`; World Model reads inside a chain are scoped to the case's counterparty cluster; the engine's cross-run history stores statistics only.
6. **Contamination test (design below).** Vendor B run after vendor A in one process and one chain of engine history must not cite A's facts, and B's judge input, carryover, findings and memory context contain no A-scoped id.
7. **Crash-restart equivalence.** The carryover after chunk k plus the ledger fully determines chunk k+1's input; a run killed after chunk k and resumed yields the same final decision and canonical state hash as an uninterrupted run (with recorded cassettes).
8. **Tokens.** Savings are claimed only from provider-reported prompt tokens (`measured` label); the break-even `N > 1 + 2C/O` means short cases gain nothing, and the report includes where chunking loses (brief D item 6).

**7 Tests.** `T-CAR-01` validator rejects invented ids, wrong hashes, over-long free text, instruction-bearing notes (`MEM-P09`). `T-CAR-02` ratify catches a planted dropped hold-relevant finding (inert-stub control: a ratify that always passes must fail). `T-CAR-03` contamination: canary sentinel facts in A, shared attributes, B run second; also A and B in swapped order; assert no A id in any B artefact. `T-CAR-04` crash-restart equivalence at every chunk boundary. `T-CAR-05` overflow fires and is not truncation. `T-CAR-06` ablation for the engine claim: without Markovian, a deep chain (depth 3 to 12) exceeds the context budget or costs more measured tokens, three runs, worst reported.

**8 Risks / NOT VERIFIED.** The engine hook does not exist in the reference (the cascade accepts any model-written marker of 24+ characters), and M12's typed profile still has the model write the state block, validated through `CarryoverPort` (new contradiction 3); how far the reference can be driven without modification is bake-off 6. State not expressible as ids (hypotheses, partial arithmetic) has no home; `openQuestions` and `freeNote` are the valve and the CrossWordBench-style failure (Delethink) may reappear on some chains. Token savings for realistic cases are unmeasured.

**9 Build notes.** After C3 and the engine; contamination and crash tests are written before the host code.

---

## C15. Sleep-time precompute cache

**3 References.** R17 sleep-time compute (gain tracks query predictability; synthetic stateful maths benchmarks, author-reported); Letta dreaming agents edit memory in place (rejected, `prior-art/11` §2.1).

**4 What they do.** The paper reports about 5x less test-time compute at equal accuracy on Stateful GSM-Symbolic and AIME and 2.5x lower amortised cost; the mechanism is precomputing over a persistent context. No evidence exists for decision systems.

**5 Decision.** **Adapt** as a keyed cache of derived, re-verified artefacts, never of decisions. Roadmap status per spec section 21a until a measured benefit and a replay-equality test exist.

**6 Design.**

```ts
interface DossierKey { counterpartyId: string; worldModelSeq: number; policyVersion: PolicyVersionId; memoryPin: MemoryPin; configHash: Hash }
interface DossierCacheEntry { key: DossierKey; keyHash: Hash; candidatePrecedents: EpisodeId[]; ruleDryRun: { fired: string[]; allowed: Action[] };
                              unresolvedCells: string[]; depFingerprint: Hash; trust: TrustLevel; createdAt: Iso; ttl: number }
```

1. **Hit** requires an exact `keyHash` match; otherwise recompute. **Use** recomputes the cheap deterministic parts anyway and compares `depFingerprint` (hash of the ids and sequence numbers the entry depends on) with the live state; any mismatch discards the entry.
2. The cache never contains an action, an autonomy level or a judgement. It stores candidate ids and pure outputs; trust is `combine` over what produced it.
3. Entries are content-addressed files; a forged or stale file fails the hash check (`MEM-P10`). Garbage collection is by TTL; nothing authoritative is deleted.
4. **Differential invariant.** A decision produced with a warm cache equals the decision produced with a cold cache, byte for byte.

**7 Tests.** `T-CCH-01` cold/warm differential on 1000 generated cases. `T-CCH-02` any change to a dependency invalidates. `T-CCH-03` forged entry. `T-CCH-04` measured latency and token benefit is reported with the cache off, and if there is no benefit the feature stays on the roadmap.

**8 Risks.** Benefit may be nil for per-run latency in the demo; that is a permissible result.

**9 Build notes.** Last; depends on C6 and C13's dependency fingerprints.

---

## C16. Memory benchmarks (sanity checks) and the precedent benchmark

**3 References.** R18 HaluMem, MemoryAgentBench, LongMemEval; LoCoMo (2402.17753) unfit (`prior-art/11` §9.1: a third-party audit reports 6.4 percent of the answer key wrong, not reproduced by us); EvalMem defect codes (2609.22231); What Eviction Destroys restore counterfactual (2609.08279); Memora forgetting-aware metric (2604.20006); `prior-art/05` §6 technique 28 evaluation checklist.

**4 What they do.** They test conversational memory with LLM readers and LLM judges. M6 is case-based precedent retrieval with rule-version awareness, so (GRT-06) they are sanity checks of the H-MEM clone only. LongMemEval-S fits in a context window for most models (a critique reported in `prior-art/11` §9.2); judge variance is substantial (2609.38021).

**5 Decision.** Public benchmarks: sanity checks only, run in the evaluation tier, never in the judge path, never headline numbers. The headline instruments are ours: the precedent benchmark, the poisoning suite (C11), the harm curve (C12), the retraction equality test (C13), the carryover tests (C14) and the pinned-retrieval replay (C6).

**6 Design.**

1. **Sanity checks (what they can and cannot show).** (a) LongMemEval knowledge-update, temporal and abstention slices, retrieval stage only: Recall@K of our H-MEM clone's `peek` over session-level records against the reference H-MEM and a BM25 floor; the expected result is "about BM25" because the base embedder is lexical; a large shortfall indicates a porting defect. (b) MemoryAgentBench selective-forgetting and test-time-learning slices after checking each sub-dataset's key; used to verify supersession is honoured in ranking. (c) HaluMem operation-level update scoring against the write path's supersession behaviour (licence NOASSERTION: download at evaluation time, never commit). Every number carries a no-memory and a full-context baseline, three runs with the worst shown, the frozen holdout, and the sentence "this tests conversational memory, not precedent".
2. **The precedent benchmark (ours).** Generator-produced histories with planted rule changes, reversed outcomes, censored restrictive actions, near-duplicates and counter-precedents; the generator is specified and reviewed independently of the system (spec section 16, GRT-01). Arms are the spec's ablation ladder as `MemoryConfig` profiles: rules only; plus precedent (similarity only); plus recency; plus outcome; plus version awareness; plus counter-precedent; plus bounded occupancy; plus standing rules; each with and without the M5 critic.
3. **Proxy judge.** A deterministic judge that picks, within the allowed set, the action with the largest summed precedent mass, with a documented tie-break. It isolates retrieval quality from model noise and makes counterfactual chains computable (C13 second-order ground truth). A real-model arm is reported separately.
4. **Metrics (definitions).** Decision accuracy on cases where the rule changed after the precedent; **stale-precedent-driven error rate** = share of decisions whose chosen action is wrong, whose shown set contains a `stale_rule_diff` or `retracted` precedent that supports the chosen action, and where removing that precedent changes the proxy judge's action; counter-precedent recall; escalations added by obligations; harmful-release and false-hold rates beside accuracy (safety with its cost); Recall@K, MRR and temporal accuracy for the embedder choice; Kendall tau under factor perturbation. Intervals: cluster bootstrap by counterparty; paired comparisons by McNemar; zero events reported as 3/n. Sample size: the planning anchors in spec section 17 (about 246 positives for recall near 0.8 within ±0.05; about 385 in the worst case); the number of rule-changed cases actually generated is stated beside every interval.
5. **Bias probe.** A generator branch where releases to a risky cluster look fine until a late harm wave and holds are never observed: the "plus outcome" arm must not recommend more harmful releases than the "plus precedent" arm; if it does, the factor table is flattened and the result is reported.
6. **Restore counterfactual** for any archive action: restore, re-run affected decisions, count flips; archive of precedents is not enabled, so this applies to non-precedent notes only.
7. **Pre-registration.** Arms, hypotheses, metrics, margins and the dev/test split are committed before the first test-split run (the Jev practice, `prior-art/11` §3.7).

**7 Tests.** The benchmark is the test; `T-BEN-01` harness self-test with a known-optimal and a known-bad retriever (the metric must rank them correctly); `T-BEN-02` generator independence review recorded; `T-BEN-03` inert control (a retriever returning nothing) fails the suite.

**8 Risks / NOT VERIFIED.** The generator defines truth, so circularity risk (GRT-01) applies; external anchors for precedent do not exist (no public precedent-with-rule-change benchmark found, `prior-art/11` §10.3). Public benchmark availability, sizes and licences are not re-verified here; HaluMem's licence is NOASSERTION.

**9 Build notes.** Generator first (M11), then ladder profiles, then sanity adapters.

---

## 3. Module acceptance gate (the labelled gate OPS-02 asked for)

M6 passes when all of the following hold on the published seeds, reported with intervals and the list of what was not covered:

| Gate | Test ids | Pass condition |
|---|---|---|
| Log integrity and idempotence | T-LOG-01..05 | zero chain breaks; crash re-append is a no-op; projections rebuild byte-equal |
| Outcome authorship | T-OUT-01..05 | zero admitted labels with a model, counterparty or self-adjudicating writer |
| Semantic port | T-SEM-01..06 | restart replay and as-of queries equal the oracle |
| Pinned retrieval | T-IDX-01..07, T-CNT-01..05 | replay-identical at a pin; reads do not change ranking; counter returned whenever one exists |
| Standing and trust | T-TRU-01..05 | no permissive-direction tainted precedent reaches a judge; taint tracking passes |
| Survivorship | T-SRV-01..04 | weakly-informed state set under planted censoring; estimator unevaluable without propensity |
| Poisoning through the real write path | T-POI-P01..P13, P00, P99 | each family succeeds on the undefended baseline and is reported on the defended system with exact bounds |
| Consolidation | T-CON-01..08 | proposal-only invariant; every rejection code fires; harm curve published (either outcome) |
| Retraction | T-RET-01..07 | first-order affected-set equality with brute force; second-order flags reported with the over-approximation rate |
| Carryover | T-CAR-01..06 | contamination, ratify, crash-restart equivalence pass; inert controls fail |
| Cache | T-CCH-01..04 | cold equals warm, or the feature stays on the roadmap |
| Benchmarks | T-BEN-01..03 | ladder, bias probe and sanity checks published with baselines |

## 4. Interfaces

| Interface | Direction | Contract | Consumers / providers |
|---|---|---|---|
| `retrieve(q: CaseQuery, pin) -> PrecedentRetrieval` | M6 exposes | pure, pinned, counters with `counterSearch`, explanation, obligations, autonomy support; types in `memory/contract.ts` | M5b (decision), M10 (views), M9 (bundle) |
| `validateJudgement(judgement: MemoryJudgement, retrieval) -> Result<void, JudgementRejection>` | M6 exposes | counters addressed; dismissals mechanically checked; ids already mapped from handles by M5 (INT-028) | M5b (checks JV7, JV8) |
| `appendEpisode(decisionRecord)` | M5b calls via gateway | immutable, idempotent, anchored | M5b, M9 |
| `recordOutcome`, `recordAdjudication` | M13 calls via gateway | authorship rule, maturity, censoring | M13, M10 |
| `SemanticMemoryPort` | M6 exposes | as-of reads, assertions as events, retraction | M3 (writes), M4 (reads), engine of blueprint 12 |
| `PolicyRegistry` (`publish`, `activate`, `rollback`, `activeAt`) | M6 exposes | append-only DAG of versions; publication needs an M5b gate record (data) | M5b gate, M10, M13 |
| `proposeRule` / `admit(proposal, classify: GateClassifier)` | consolidator to queue | certificate or rejection code; classifier injected | M5 (classification), M13 approvals (`rule_proposal`), M10 |
| `retract(target) -> RetractionReport` | M6 exposes | exact first order, second-order flagged, `vSpecHash` printed | M13 (incident, re-judge), M9, M10 |
| `Evaluator` / `Recompute(snapshot, removed)` | M6 requires | M4's composition `V = phase2 ∘ phase1` over the frozen snapshot (INT-034) | M4 (M3, M5a halves) |
| `revalidate(P, snapshot)` / `evaluate(policyVersion, ·)` | M6 requires | M5a pure rule evaluation incl. feature functions | M5a |
| `reconcile(assertions, links)` | M6 requires | M3 pure resolution from recorded link decisions | M3 |
| `combine`, `join`, trust table, typed-value registry, `ApprovalItemType` | M6 requires | spec section 5; shared types | M8, M13 |
| `StorePort` memory mode (`MemoryStorePort`) | M6 requests of M7 | a mode of `StorePort`, not a new effect type (INT-056): `openLog(name, {replay: "scratch" \| "strict"})`, `readAtPin(pin: SnapshotPin): AsyncIterable<Uint8Array>`, `anchor(stream): DocHash`; in replay, writes go to a scratch store and reads at a pin are pure; snapshot bodies use the shared blob store with tombstones (INT-043) | M7 |
| `SyncJournal` | M6 requests of M7 | engine ledger writes (`append(streamId, line)`, `readAll`), local durable, not cassetted | M7, M12 |
| `LedgerPort` (`append`, `published`, `streamHead`) | M6 calls | leaf `memory.head` on stream `memory`, result class, single writer per stream (C1 step 2) | M7, M9 |
| Engine hooks M12 must expose (bake-off 6 requirements, INT-062; ids proposed here) | M6 requires | H-MEM: R-HM1 pure ranking (`snapshot` + `retrieve`, bound as `peek`: threshold on the pre-`rerank` score, scores and terms as integer micros, `rerank: PureRerank` for M6's factors, `recordRead` ledger-only); R-HM2 explicit `entities` in `AddInput`; R-HM3 `supersededBy` set when `supersedes` is declared; R-HM4 read isolation (`accessCount` and `lastAccessed` never feed `retrieve`). World Model: R-WM1 to R-WM4 (C3). Markovian: R-MK1 a host `carryoverBuilder` hook with overflow signalling and measured tokens | blueprint 12 |
| Bundle content | M6 gives M9 | pin, retrieved `PrecedentView`s with hashes, memory chain heads, certificates, retraction reports | M9 verifier |
| Trace events | M6 emits | `mem.retrieve`, `mem.write` (carries `why_kind`), `mem.episode.append`, `mem.outcome`, `mem.label`, `mem.retract`, `mem.proposal`, `mem.certificate`, `mem.carryover.validate`, `mem.ratify`, `mem.cache.hit` | M7 (verb registry, INT-054), M9, M10 |

### 4a. Guarantee rows contributed to spec 9a (register section 4)

| Dimension | What is established | What is not established |
|---|---|---|
| Precedent retrieval | the shown-set scores, caps and standing recompute offline from the bundle's retrieved views, the pin and the memory configuration; reads do not change ranking; precedent views cross cases only through the whitelist projection, checked by canary | that no better candidate was omitted (needs the store snapshot or a commitment to the gated candidate set); that outcomes in the store are true; any real-world precedent value (the evaluation uses a simulator) |
| Retraction exactness | for the deterministic stages, retraction recomputes exactly which decisions change their allowed set, which only change judgement input, and which are unaffected (first order); monotone support: provenance retraction equals recomputation; defeated single-valued cell: cell-local re-fuse equals recomputation | second-order effects when the predecessor's counterfactual action depends on the judge (flagged `second_order`); erased snapshots (`unevaluable`); the model judgement stage |
| Retention and erasure | an erased body leaves a signed receipt and no recoverable form in this case's ledger, bundle or logs; the verifier reports INDETERMINATE (never PASS) for members it covered; the episode keeps id, digest and trust label and appears only as a restrictive-direction counter | backups or filesystem remnants (crypto-erasure is the upgrade); whether salted commitments remain personal data (LAWYER); replay of a case whose bodies were erased |
| Outcome labels | no admitted label was produced by an actor that took part in the decision (structural check); an evidence-backed human finding is `VERIFIED`, an unsupported human assertion is an `UNTRUSTED` note | that the label is true |

## 5. Spec feedback

1. **Outcome counted twice.** `prior-art/11` §10.3A multiplies the H-MEM score by an outcome factor and also feeds outcomes into H-MEM `feedback()`, which moves `confidence`, a multiplier of the same score. Spec section 11 inherits "H-MEM spec score times factors". This blueprint routes outcomes only through the factor and reserves `feedback()` for authenticated reviewer verdicts. The spec should say so. **Resolved by INT-038 (spec text edit pending).**
2. **"Tainted precedents are counter-only" is not restrict-only.** A tainted precedent can counter a hold-leaning lead by arguing for permission. Refine to: tainted and unproven precedents are shown only when restrictive-direction; permissive-direction ones are excluded and listed (C9 step 3). **Resolved by INT-038 (C9 step 3; spec text edit pending).**
3. **Recency on precedents.** The spec ladder includes "plus recency" using H-MEM's term (14-day constant on `lastAccessed`), while `prior-art/11` §10.2 rejects time decay on precedents. For cases decided months apart the reference term is near zero, and `lastAccessed` is mutated by reads. Resolve by measurement; production uses `decidedAt` and the ladder result. **Resolved by INT-038 (C6 step 4: kept only if the ladder measures a gain).**
4. **Retraction exactness needs an order statement.** Section 11's "exactness holds for the policy and bounded-state stages" is true only for the first order. A decision that used an affected decision as a precedent is exact only when the predecessor's counterfactual action is determined without the judge. Add the second-order rule (P-M6). **Resolved by INT-039 (order statement and the two exactness cases, C13 step 4; spec text edit pending).**
5. **Section 9a lacks a memory row.** A bundle can carry the retrieved views and the pin, so scores of the shown set recompute offline; it cannot prove that no better candidate was omitted unless the relying party supplies the store snapshot or a commitment to the gated candidate set. Add a row: "Precedent retrieval: shown-set scores and caps recompute; completeness of the candidate set is not established offline". **Resolved by register section 4 (precedent-retrieval row, carried in 4a); not an INT id.**
6. **Confidentiality of precedents is unspecified.** Precedent views cross cases. Specify the whitelist projection and the canary test as part of section 5's confidentiality lattice. **Resolved by INT-021 (C5 steps 4 and 5, C9 step 7).**
7. **World Model `assertFact` mutates outside the fold; global conflict policy.** Spec section 8 requires resolution as a pure function and `unresolved` as a status; the reference does neither (read). Engine requirements R-WM1 to R-WM4 are needed in section 12 and bake-off 6. **Resolved by INT-062 (R-WM1 to R-WM4 into bake-off 6; `ResolverPlugin` is the product policy). Open dependency: M12 must meet them.**
8. **Learning must be restrict-only too.** Section 11 requires non-amplification of trust tier; it does not say a proposal with unproven support may not loosen. Add rule L1 (C12 step 5). **Resolved by INT-038 (rule L1, C12 step 5).**
9. **Markovian carryover content is model-written in the reference.** Section 11's validator and ratify steps are insufficient if the model writes the carryover; the host must build it from the ledger and the engine must expose a builder hook and overflow signalling. **Resolved by INT-062 (R-MK1). Open dependency: M12's typed profile has no host-built carryover yet (new contradiction 3).**
10. **Erasure versus recomputation.** Section 14a lists data deletion as built later; erased snapshots make retraction recomputation and validity `unevaluable`. Name the consequence and the `unevaluable` state in section 11 and in M9's erasure receipt design. **Resolved by INT-040 (C1 step 4; `unevaluable` and counter-only named).**
11. **Autonomy rule needs a defined precedent trust.** "Autonomy above AL1 needs a SOR or VERIFIED precedent" does not say what the trust of a precedent is. C9 defines `precedentTrust` as the meet of the policy-relevant fact trust and the outcome-evidence trust. **Resolved by INT-038 (C9 step 1).**
12. **Survivorship is structural for restrictive actions.** Section 11's "weakly informed" implies a data shortage that governed audit sampling can fix; for holds and rejects it cannot. State that `censored` is permanent absent adjudication (C8). **Resolved by INT-038 (C8 step 1).**
13. **New M7 effect type.** Memory logs need a port with replay semantics (`MemoryStorePort`); section 4's port list does not include it. **Resolved by INT-056 (a mode of `StorePort`, not a new effect type).**

## 6. What this blueprint does not cover

- The Meterless engine implementations, conformance runners and bake-off 6 (blueprint 12); M6 states what it needs from them.
- The policy IR, the SMT classification and the rule-change gate (M5); the pure reconciliation and link decisions (M3); the pure recompute `V(S)` (M4); trust-table contents and typed-value enforcement (M8); outcome collection connectors and incident workflows (M13); bundle formats and the verifier (M9); the console views (M10); generators and the statistics protocol (M11).
- Learned retrieval selectors, RL-trained consolidators, parametric or latent memory, embedding-model choice beyond the Recall@K measurement, and a vector-database choice (judge path is file-backed).
- Multi-tenant isolation beyond the tenant prefix on log names (INT-048), access control for full-episode viewing, retention schedules and legal holds beyond the erasure mechanism in C1, backup and disaster recovery, capacity beyond the 10^4 episode planning scale.
- Real outcome data: every outcome, propensity and adjudication in the evaluation is simulator-authored, so results validate methodology and not the value of any real rule (DEC-06).
- Anything dependent on credentials not yet held (real-model arms of the harm curve, the poisoning suite and the judge-obligation tests): NOT VERIFIED until a model endpoint exists.
- Public benchmark scores as claims: they are sanity checks of the H-MEM clone only.
- Novelty: no systematic prior-art search has been done for the combination of recomputed rule-version validity, mandatory counter-precedents and exact retraction (the limited searches of `prior-art/11` §10.3 are all there is); wording must stay "to our knowledge" until the novelty protocol is run.

## Pass 3 resolutions (2026-10-13)

Source: `99b-integration-register-pass3.md` (INT-101 onward). These bindings override the body above wherever they differ; the body has not been rewritten. Each line is one binding change; the register item holds the reason and the other modules affected.

- **INT-103.** Snapshot bodies and evidence commitments are `Commitment` with `case` salt scope (destroyed by M9's erasure); the account tenant salt is never used here.
- **INT-111.** The precedent outcome type is `OutcomeVerdict` (already local); the shared `Verdict` is the verifier's result.
- **INT-133.** The memory head leaf is `memory.head` on stream `memory`; `attrs.engine` names `hmem` or the M6 log, and the subject is a record of all heads. M12's `hmem.head` and M7's `memory.written` are retired.
- **INT-137.** `SemanticMemoryPort.subject` is a `CellKey`; `UsedIds.factIds` and the decision-dependency graph key cells by anchor mention, not by entity id.
- **INT-142.** M6 reads the H-MEM facade as `snapshot()` plus pure `retrieve(query, {threshold, rerank, snapshot})` with `scoreMicros: Micros`; the threshold applies to the base score before `rerank`; reads never mutate ranking (requirement R-HM5 in bake-off 6).
- **INT-143.** In the product profile the Markovian carryover block is built by host code from typed state (fact ids only); model-proposed ids are validated and model-written state text is discarded (R-MK1).
- **INT-144.** Cross-case use of memory is only the whitelist projection by pack and decision type; `includeUnscoped: false` and no scope-promotion call site (static test `no-scope-promotion`).
- **INT-145.** An erased episode is `unevaluable{erased}`: excluded from `support`, shown in `counters` only as a header when restrictive-direction, dismissible only with `outcome_unverified` (its predicate holds when the outcome is unobserved or the episode is `unevaluable{erased}`).
- **INT-146.** `validateJudgement` reports its codes as `JV7.*`, `JV8.*`, `JV9.*` and owns membership, counter obligation, dismissal predicates and relied-validity; M5 re-implements none of them.
- **INT-147.** The rule-change classifier is injected as `GateClassifier` (implemented by M5a `classify`); M6 never imports M5b.
- **INT-152.** Register the `memory.*` events as verbs in M7's `trace-verbs.json` (lint `TL19`).


> v5.2 (D-026): profile-pass additions for this module are in `98-profile-pass-additions.md` (adoption register ids; they win over this blueprint where they differ).
