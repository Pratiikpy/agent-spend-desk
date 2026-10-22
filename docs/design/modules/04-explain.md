# Module 04: Explain (implementation blueprint)

## v5.1 alignment (2026-10-15, spec section 0 wins where this blueprint disagrees)

- Bake-off 9: an SMT or MaxSAT encoding as a second independent implementation of the explanation function; the component-tabulation enumeration stays the dependency-free path the offline verifier checks (D-015).
- Research loop with breadth and depth control, learnings and next directions (dzhng/deep-research and DeerFlow patterns) feeding the evidence-gap re-planning.
- The jury of independent judges is experimental and enabled only if an ablation shows a gain (debate studies report agreement collapse, D-019). Agent roles and pairings follow `docs/design/05-agent-behaviour-matrix.md`.


Status: design, 2026-10-13. Nothing here is built or measured; every design claim is a hypothesis with a named test, and anything not seen in a source is marked **NOT VERIFIED**. Refines `../00-architecture-master-spec.md` (v3.1) sections 9 and 9a, the question-template registry of F-STAGES (section 21), and the metric definitions the evaluation suite uses (section 17). Follows `00-conventions-and-shared-types.md`.

## Integration revision (2026-10-13)

Source: `99-integration-register.md`. Applied in place; sections the register does not touch are unchanged.

**Applied**
- INT-001: certificate producer outcome is `CertOutcome = VALID | INVALID | INCONCLUSIVE`; verifier result stays `PASS | FAIL | INDETERMINATE | NOT_APPLICABLE`; M4's projected-verdict type renamed `ProjectedVerdict` (C15, shared types, C8, C11, interfaces).
- INT-004: layer is not normalised; unit is code points, page-relative, plus UTF-8 byte offsets; matcher keeps its index map in layer code points and NFC is only a fold of the matcher's derived space (shared types, C2, C3, C4, interfaces, SF11).
- INT-005: M2 owns `SpanRecord` and the 24-hex span id; M4 `Span` is a view; models see per-run aliases; stored quote hash is `spanSha` (RawHash, raw UTF-8 bytes); field spans stay M4's (C2, C6, C7).
- INT-006: `supports`/`contradicts` leave `Evidence`; M4 owns a derived `EvidenceLinks` index (new C1 item 9); citations of `use: "discovery"` evidence fail closed (C2).
- INT-008, INT-055: `render` takes the shared `Audience`; the counterparty rendering is the input of M9's signed notice, reason-code class only, delivery out of scope (C1 item 8).
- INT-012: two decomposition arms, extractive default and generative control; shared `Claim` carries `pieces`, `parentRef`, `decomposer` (shared types, C5).
- INT-015: L2 labels reach M5 as `claim.<id>.canPermit` plus the chain label; restrict-only; missing or unknown means not permitting (C6 item 10, interfaces).
- INT-034, INT-037: M4 owns `Evaluator` and the composition `V = phase2 ∘ phase1`; `vSpecHash` over the three halves; M5 split, M4 depends on M5a; `Recompute` and `robustness` wiring; `flipSearch` combined in C11 (C8, C11, interfaces).
- INT-036: link judgements are recorded per pair (nominate, then confirm in both orders); fallback `locality: "set"` is named in the certificate (C8 obligation 5, C9, C15).
- INT-060: M4 ablations are registered as M11 `ArmSpec` switches; M4 does not define arm schemas (C7 tests, SF14).
- INT-065 (M4 items SF2, SF3, SF7, SF8, SF9, SF12, SF13): spec wording only; the blueprint already states each, so only the Spec feedback status changed.

**Named for M4 but not applied**
- INT-011: confirms that `L0`-`L4` (claim checks), `L4a`/`L4b`, `V(S)` and verifier levels `V0`-`V8` keep their names; searched, no M4 text collides, so no edit.

**New contradictions found (not in the register)**
- Shared `Verdict` (verifier result, INT-001) collides with M4's former `Verdict = Json` (projected verdict): renamed locally; any other module using `Verdict` for a projection must follow.
- INT-010 forbids floats in recorded documents; M4's `nearScore` was a float: now `Milli`. The lexical-gate coverage and `tau` values stay in memory and are never recorded as numbers.
- INT-015 says a missing feature is "level 0" while INT-014 removes numeric levels from M5; and the register does not say whether M5 reads the `canPermit` flag or looks the chain label up in `permission-matrix.json`. M4 publishes both and tests that the flag equals `permitsClass(chainLabel, "satisfy_manifest_item")`.
- INT-004 makes locators page-relative: a quote that crosses a page break has no single locator. M4 reports it per page as ordered fragments; M2 must confirm (C3 risks).
- INT-004 fixes `json-pointer` as a pointer into `Evidence.raw`; M4's field spans previously pointed into `normalised`. Changed to `raw`, with the normalised value shown beside it.
- INT-005 per-run aliases would change judge cache keys; `inputHash` and `cacheKey` are now computed over canonical span ids and unit text, never aliases.
- C20 item 6 still carries the pre-INT-021 egress wording ("no value above `public` in any query"); the register does not name M4 for INT-021, so it is left and flagged.

## 1. Scope and contract

**Job.** M4 turns "the system says X" into something a stranger can check. It keeps a typed ledger of claims, verifies each claim mechanically where code can (quotes, hashes, numbers, dates, structured values), judges what code cannot (does the cited text entail, contradict or say nothing about the claim), stress-tests the uncertain claims that matter, and then computes, exactly and relative to a frozen snapshot, which evidence the verdict robustly depends on, which smallest removals change it, and which unchecked sources could still change it. Every result ships with a certificate the offline verifier re-checks.

**Inputs (typed values only, each carrying `trust`, `conf`):**
- from M1/M2: `Evidence` records and their text layers (`textLayerHash`; un-normalised, page-relative code-point offsets with UTF-8 byte offsets), plus M2's `SpanRecord` table (C2);
- from M3: the truth table, link judgements recorded per pair, assertions with provenance, authority tables, and the dependency declarations of C8;
- from M5a (policy core): `featurize`, `evaluate`, `derive`, `coneOf`, `fieldDeps`, `flipSearch`, the verdict projection and the derivation trace of C8; the rule-engine action is the verdict `v*` (the policy judge is outside `V`);
- from M7: ports `ctx.model`, `ctx.tools` (read-only corpus search), `ctx.clock`, `ctx.rng`, `ctx.ids`, budgets, trace; from M14: model profiles.

**Outputs:** `ClaimLedger` (append-only), `Gap[]`, `Explanation` (minimal robustly sufficient evidence, minimal flips, classes, complete reason, edits, gap relevance, robustness radius), `Certificate[]`, `RenderedProse`, `ExplainReport` (six checks and metrics), and a JSONL trace in which every decision has a `why`.

**Depends on:** M2, M3, M5a (policy core; functions, not internals; M5b sits above M4, INT-037), M7, M8 (labels), M14. **Consumed by:** M5a (label features including `claim.<id>.canPermit`), M5b (gaps, confidence caps, dossier), M6 (`Recompute`), M9 (certificates in the bundle, verifier recompute), M10 (claim panel, flip panel, evidence viewer), M11 (metrics, attack suite), M13 (re-plan trigger via the gap ledger).

**Design stance (the reasons behind every choice below).**
1. The spine is code. Models propose labels and spans; code supplies quotes, hashes, offsets and verdict arithmetic. A model can be wrong; it cannot make a fabricated quote expressible.
2. Silence, contradiction, absence and unavailability are four different facts (principle 4) and stay four different values everywhere, including the metrics.
3. Exactness is claimed only relative to a **frozen snapshot** and a named `V` (section 9a). Anything that is a model judgement is a recorded edge of that snapshot, and the only place a judge noise statement is made (C13).
4. Layers are kept only if an ablation shows they change an output (21a). Optional layers (C12, C14) are specified so they can be built, and are gated.
5. Nothing is silently dropped. A budget hit, a parse failure, a capped enumeration and an unreachable source each produce a named state and a gap.

**Shared M4 types** (extend the vocabulary of `00-conventions`; `Claim`, `Citation`, `Label`, `Evidence` are used as defined there).

```ts
type SpanId = Id<"sp">;  type EdgeId = Id<"ed">;  type GapId = Id<"gp">;
type Ordinal = "high" | "medium" | "low";                       // never a probability
type ProjectedVerdict = Json;                                    // canonical projected verdict of the active template; NOT the shared `Verdict` (verifier PASS/FAIL/...)
// Text spans are M2's `SpanRecord` (id `sp_` + 24 hex over textLayerHash, page, start, end; page-relative code points, un-normalised layer).
// M4's `Span` is a view over it for text evidence and owns only structured-field spans.
interface Span { id: SpanId; evidenceId: Id<"ev">; kind: "text" | "field";
                 page?: number; start?: number; end?: number; byteStart?: number; byteEnd?: number;   // kind "text": copied from the SpanRecord
                 pointer?: string; textLayerHash?: RawHash }                                           // kind "field": RFC 6901 pointer into Evidence.raw; text is derived, never authoritative
interface ClaimRecord extends Claim {           // Claim already carries pieces?, parentRef, decomposer (shared type, INT-012)
  origin: "finding" | "prose";                  // finding: generated by code from fact ids; prose: decomposed from free text
  stance: "world" | { reported: Authorship; evidenceId: Id<"ev"> };   // "the certificate expires 2027" vs "the vendor states it expires 2027"
  relevance: "relevant" | "irrelevant" | "unknown";  flags: ClaimFlag[];
  l0: L0Result; edge?: EdgeId; verification: "verified" | "unverified";   // unverified carries a cause code, never a label
  confidence: Ordinal; gaps: GapId[]; trust: TrustLevel; conf: Confidentiality; personal: boolean;
}
type ClaimFlag = "decomposition_drift" | "coverage_gap" | "over_cap" | "self_declared_only" | "single_origin_only" | "ungrounded_entailment"
               | "distractor_sensitive" | "judge_unstable" | "near_quote" | "omits_negation" | "quote_too_short" | "mixed_script";
```

## 2. Component list

| # | Component | Spec anchor |
|---|---|---|
| C1 | Typed claim ledger and prose rendering | 9 (ledger, prose from ledger) |
| C2 | Span registry and citation resolution (model points, code quotes) | 2.1, 7 |
| C3 | L0a quote matcher with normalisation index map | 9 L0 |
| C4 | L0b numeric, date, structured-value consistency and integrity hashes | 9 L0 |
| C5 | L1 decomposition with self-containment, relevance, drift, coverage guards | 9 L1 |
| C6 | L2 entailment judging (silence versus contradiction, deciding span, dual prompts, lexical gate, second voter) | 9 L2 |
| C7 | L3 sensitivity router, advocate, skeptic, arbiter | 9 L3 |
| C8 | Evaluator contract and derivation trace (what M3 and M5 must emit) | 9 L4a |
| C9 | Frozen snapshot, judged edges with subset tables, edge locality | 9 L4a |
| C10 | Exact enumeration: cone, components, minimal flips, minimal robustly sufficient evidence | 9 L4a |
| C11 | Edits and decision-relevant evidence-gap analysis | 9 L4a |
| C12 | Halpern-Pearl causes and responsibility (optional) | 9, 21a |
| C13 | Judged-edge robustness radius (L4b) | 9 L4b |
| C14 | Argumentation layer (optional) and mapping to repair semantics | 9, 21a |
| C15 | Certificates and the verifier contract | 9, 13 |
| C16 | Question-template registry | 21 F-STAGES |
| C17 | Gap ledger and ordinal confidence rule | 9 |
| C18 | The six checks and their metrics | 9, 17 |
| C19 | Evidence-corruption attack suite | 9 acceptance, 17 |
| C20 | Stage orchestration, budgets, determinism, trace events | 4, 21 F-BUDGET |

## 3. Reference register

Metadata from `gh api` on 2026-10-13 unless stated; papers were fetched (page) on the date shown or are verified in `prior-art/08` (cited by its item id, same date). "Read" means the code was opened in a local clone under `research/track-2-agent-that-can-explain-why/` (teardowns in `prior-art/03`, `04`).

| Id | Reference | Licence, stars, last push | What matters here | What its evaluation does not show |
|---|---|---|---|---|
| R1 | SAFE and LongFact, `google-deepmind/long-form-factuality`; paper arXiv 2403.18802 (fetched 2026-10-13). Read: `eval/safe/rate_atomic_fact.py`, `classify_relevance.py`, `eval/metric_utils.py` (04 §1) | code Apache-2.0 (GitHub: NOASSERTION), 694, 2026-06-18 | atomic decomposition, self-containment rewrite with "do not change, do not add", relevance rule, F1@K | judged against search snippets with URLs dropped; one label for silence and contradiction; paper reports 72% agreement with crowd annotators and wins 76% of 100 sampled disagreements (author-reported) |
| R2 | FActScore, `shmsw25/FActScore`; arXiv 2305.14251 (fetched) | MIT, 460, 2025-04-13 | number/date drift guard on decomposition (`postprocess_atomic_facts`), score definition with length penalty | closed Wikipedia page corpus; guard is integers and dates only; temperature 0.7 |
| R3 | ALCE, `princeton-nlp/ALCE`; arXiv 2305.14627 (fetched). Read: `eval.py::compute_autoais` | MIT, 527, 2024-10-09 | joint-entailment citation recall; leave-one-out citation precision; 0/1/2 human rubric | sentence granularity; silent cap of 3 citations; invalid ids vanish from precision; binary NLI |
| R4 | Self-RAG, `AkariAsai/self-rag`; arXiv 2310.11511 (fetched). Read: `retrieval_lm/run_long_form_static.py` (04 §4) | MIT, 2439, 2024-05-25 | fully / partially / no-support ladder, support prompt with "no outside knowledge" | needs logprobs from a fine-tuned model; merges unsupported and contradicted; utility never scored in the long-form path (04 §4.3) |
| R5 | ragas, `vibrantlabsai/ragas` (clone path `ragas`); read `metrics/quoted_spans.py`, `_faithfulness.py` | Apache-2.0, 16009, 2026-02-24 | two-stage faithfulness; dual 0/1/2 judge average; quoted-span check | quoted-span check matches against a joined blob, ASCII-only quote class, whitespace and case only (read, `quoted_spans.py`); denominator taken from LLM output |
| R6 | Multiagent debate, `composable-models/llm_multiagent_debate`; Du et al. arXiv 2305.14325 (fetched) | **no licence file** (study only), 553, 2025-04-24 | revise-after-seeing-others pattern, 3 agents x 2 rounds baseline | no evidence, no stopping rule, no harm counting (04 §6) |
| R7-R12 | research-agent teardown: gpt-researcher (Apache-2.0, 30074), open_deep_research (MIT, **archived**), dzhng/deep-research (MIT), Alibaba-NLP/DeepResearch with WebWeaver (Apache-2.0), zilliztech/deep-searcher (Apache-2.0), stanford-oval/WikiChat (Apache-2.0) (03) | see 03 | id-addressed evidence bank and `<cite id>` surface syntax (WebWeaver `react_agent_outline_write.py`), abstain guard (`writer.py`), claims-first retrieval and typed turn state (WikiChat), frozen-input replay (deep-searcher `jev_stopping`) | none ties a claim to a verified span at run time; the shipped best FACT result has about 44% of citations unsupported (gpt-researcher `deep_agents`, author files) |
| R13 | W3C Web Annotation Data Model, Recommendation 2017-02-23, TextQuoteSelector (4.2.4: `exact`, `prefix`, `suffix`) and TextPositionSelector (4.2.5: `start`, `end`) (fetched) | W3C | the standard pair of selectors: quote with context plus position | a vocabulary, no verification algorithm |
| R14 | `tilgovi/dom-anchor-text-quote` (MIT, 35, 2023-07-17), read `src/index.js`: `toTextPosition` re-anchors with diff-match-patch bitap, 32-character slices, 32 characters of context; `google/diff-match-patch` (Apache-2.0, 8132, **archived**) | | prefix/suffix context length and the fuzzy re-anchor we deliberately do not use for verification | built for re-anchoring annotations after a document changes, so it prefers finding something |
| R15 | Unicode UAX #15 normalization forms, revision 58, Unicode 18.0.0, 2026-08-12 (fetched) | Unicode | NFC/NFKC definitions; offsets move under normalization; forms are not closed under concatenation | |
| R16 | `wanasit/chrono` (MIT, 5291, 2026-10-12) | | date parser used as a differential oracle only | not an ambiguity-retaining parser |
| R17 | ContractNLI, arXiv 2110.01799 (fetched): 607 contracts, labels entailed / contradicting / not mentioned, evidence spans; `stanfordnlp/contract-nli` (CC-BY-4.0, 14, 2022-02-11) | | external anchor for silence versus contradiction with evidence spans on the document type we care about | no `partial`; reuse terms of the underlying contract texts NOT VERIFIED |
| R18 | VitaminC, arXiv 2103.08541 (fetched): about 400k claim-evidence pairs, contrastive minimal edits | | external anchor for sensitivity to small factual edits | Wikipedia revisions; repository not located (`allenai/vitaminc` returned 404) |
| R19 | PoisonedRAG, arXiv 2402.07867 (fetched): 90% attack success with five planted texts | | threat model for a poisoned searchable corpus (C7, C19) | attacks a generator, not a verifier |
| R20 | Reiter 1987 (diagnosis as minimal hitting sets), Ignatiev et al. 2019 (abductive and contrastive explanations, hitting-set duality), Darwiche-Hirth, Junker's QuickXplain (08 A1 to A6) | | the duality of C10 | classifier encodings, not non-monotone typed policies |
| R21 | Gainer-Dewar and Vera-Licona, arXiv 1601.02939 (abstract fetched): surveys and benchmarks twenty minimal-hitting-set generation algorithms | | algorithm choice for C10 | **only the abstract was read**; which algorithm wins is NOT VERIFIED |
| R22 | PySAT `hitman.py` (`pysathq/pysat`, MIT, 461, 2026-08-16; read in 08 A7) | | test-time oracle for C10 | Python |
| R23 | Halpern 2015 (1505.00162), Chockler-Halpern responsibility, Aleksandrowicz et al. complexity, Ibrahim-Pretschner MaxSAT causality (08 B1 to B4); AUDITA arXiv 2608.22160 (08 I6) | | C12 | model-relative; AUDITA is a single simulated preprint |
| R24 | Dung 1995; ASPIC+ tutorial (undercut-defeat rule **NOT VERIFIED**); Tweety (GPL-3.0, never vendored), pickaxe (MIT, Rust); `potassco/clingo` (MIT, 850, 2026-10-13); ASPARTIX page (fetched; availability by contact, licence not stated) (08 D) | | C14 | no permissive TypeScript engine found |
| R25 | certificates: Necula PCC, McConnell et al. certifying algorithms, ClaimReceipt arXiv 2609.01992, RFC 6962 (08 I1, I2, I5, I8) | | C15 | ClaimReceipt's sufficiency is information in retained records, ours is robustness inside a verdict function: kept distinct |
| R26 | judge reliability: Cherry-pick Override arXiv 2606.07834, self-preference arXiv 2404.13076, evidence-order bias arXiv 2305.17926, prediction-powered inference arXiv 2301.09633 and ARES, conformal factuality, strict-versus-lenient swings (08 E10, H1, H2, H4, H5, F8) | | C6, C13, C18 | single-team preprints for 2026 items; calibration resets when the judge model changes |
| R27 | candidate small second voters: MiniCheck (Apache-2.0, 228; larger model restricted for commercial use per its README), AlignScore (MIT, 175, idle since 2024-03), LettuceDetect (MIT, 615), `huggingface/transformers.js` (Apache-2.0, 16342, 2026-10-13) | | C6 bake-off | Python or model-download dependent; TypeScript in-process use **NOT VERIFIED** |
| R28 | attribution and verification sets: AIS rubric, AttributionBench, ExpertQA, FEVER, SciFact, AVeriTeC and its leakage critiques (08 E, F) | | gold-set protocol, leakage invariant | web and science domains |
| R29 | counterfactual and simulatability: Wachter et al. arXiv 1711.00399, Chen et al. counterfactual simulatability arXiv 2307.08678, Miller arXiv 1706.07269 (08 C1, G3, C3) | | wording and the exact simulatability metric (C18) | |
| R30 | nearest claim-ledger and sufficiency preprints: Evidence-Ledger Adjudication arXiv 2607.26512 (relation accuracy 0.676, macro-F1 0.601, author-reported), Minimal Evidence Group Identification arXiv 2404.15588, EviGraph arXiv 2610.00212 (extra verification removed valid recommendations) (08 E11, E12, I4) | | baseline numbers; the over-abstention warning that shapes C17 | |

## 4. C1 Typed claim ledger and prose rendering

**Best references.** R7-R12 (WebWeaver `<cite>` syntax; WikiChat typed `DialogueTurn` and claims-first; gpt-researcher abstain guard), R30, R27 (LettuceDetect idea).

**What they do.** WebWeaver's writer wraps each non-common-knowledge statement as `<qwen:cite id="id_x,id_y">statement</qwen:cite>`; the code resolves ids to URLs by string replacement and never checks the ids or the wrapped statement (03 §4, `react_agent_outline_write.py:141-145`). WikiChat renumbers `[n]` markers by regex and leaves an out-of-range marker in the text (03 §6, `pipelines/chatbot.py:134-150`). gpt-researcher abstains only when all context is empty (`writer.py:79-88`). None of the six keeps a typed claim list from which prose is produced.

**Decision.** Own. Adapt the `<cite>` surface syntax as the machine-readable form of rendered prose, and generalise the abstain guard from "no context" to "per claim".

**Design.**
1. **Claim identity.** `claimId = "cl_" + hash("claim", JCS({templateId, kind, typedForm, factIds, parentRef}))`. `typedForm` is the normalised triple (subject entity id, attribute, value) for findings and the L1 atom text (NFC, folded whitespace) for prose claims. Re-planning (F-REPLAN) re-derives the same ids, so it is idempotent and judge-cache hits are exact.
2. **Two origins, one ledger.** `origin: "finding"` claims are produced by finding generators registered with each question template (C16) from M3 cells and M5 results; they skip L1 (risk of decomposition drift is zero) and are verified by recompute (C4 structured match) plus, for document-derived facts, L2 against the extraction span. `origin: "prose"` claims come from L1 (counterparty statements in free-text clauses, a reporter paraphrase, and the prose of baseline arms in evaluation).
3. **Reported speech.** `stance` separates "world" claims from "reported" claims. A claim whose every supporting span is counterparty-authored may be `entailed` only in its reported form; the world form gets `flags: ["self_declared_only"]` and a gap of that kind (C17), whatever the judge said.
4. **Append-only.** Claims are never edited. A superseded claim keeps its record with `supersededBy`. The ledger root is a Merkle root over claim records in id order so the bundle can commit to it.
5. **Rendering is a pure function** `render(ledger, template, audience, style) -> RenderedProse`. Output is a list of `Sentence { text, claimIds: ClaimId[], kind: "claim" | "connective" | "banner" }` plus a `spanMap` from character ranges to claim ids. `connective` sentences come from a closed list of fixed strings and contain no fact. The deterministic renderer fills a per-kind sentence template from `typedForm` and the verified quote (code-supplied) and adds a qualifier from a closed vocabulary keyed on `confidence` (`established`, `reported by one source`, `contested`, `could not be checked`). Counterfactual wording is the fixed sentence from section 9: "under this fixed case snapshot and policy version, removing evidence E changes the computed verdict from A to B".
6. **Optional paraphrase pass** (`style: "paraphrase"`): a model rewrites one rendered sentence at a time. Each output sentence passes the **sentence-to-claim verifier**: (a) every number, date and capitalised entity token must occur in the union of its mapped claims' normalised value sets (deterministic, same code as the C5 drift guard), (b) L2 entailment from the concatenated mapped claim texts to the sentence, (c) no claim id removed. A failure replaces that sentence by the deterministic one and logs `explain.render.fallback`.
7. **Unledgered-assertion detector.** Before display every sentence must have `claimIds` (or be `connective` or `banner`). A lexical detector flags any number, date or entity token not covered by its claims. A token-classifier detector (LettuceDetect style, R27) is a roadmap addition gated on a measured gain on the seeded set.
8. **Audience filter.** `audience` is the shared `Audience` (`reviewer | auditor | counterparty`; M9's bundle disclosure `full | redacted | notice` is a separate axis, INT-008). `counterparty` renders only claims with `conf = "public"` and non-personal, as reason codes without list or source detail (tipping-off safe, spec section 13); the filter is by label, never by a model. This rendering is the only input of M9's signed counterparty notice (a reason-code class and nothing else); delivery to a counterparty is outside the first release (INT-055).
9. **Derived `EvidenceLinks` index (INT-006).** `Evidence` is immutable and carries no claim relations. M4 owns `EvidenceLinks { evidenceId, supports: ClaimId[], contradicts: ClaimId[] }`, a pure function of the ledger: for each claim, the evidence items of the `decidingSpanIds` of its full-set edge entry (C9) are in `supports` when the label is `entailed` or `partial`, and the items of its `contrarySpanIds` are in `contradicts` when the label is `contradicted` or `contested`. It is rebuilt from the ledger, keyed by evidence id, never written back, and committed under the ledger root.

**Tests.** `render` determinism (same ledger, same bytes); coverage property (every character of the output belongs to exactly one sentence; every `claim` sentence has at least one claim id); mutation test (change one claim's value, assert the rendered diff is confined to that claim's sentence); unledgered seeding (insert a fabricated sentence carrying a real evidence URL and a plausible number: detector must flag, EC6 in C19); paraphrase gate ablation (rate of paraphrase sentences rejected, and whether rejected ones were true paraphrases: a measured false-reject rate); audience tests (counterparty output contains no string from a planted `internal-sensitive` value); `EvidenceLinks` is byte-identical when rebuilt twice, and adding claims never changes any `Evidence` hash.

**Risks / NOT VERIFIED.** Whether paraphrase passes ever survive the verifier at a useful rate (if not, the deterministic renderer is the product and the claim "prose rendered from the ledger" is simply true by construction). Reading quality of template prose is a design-review item for M10, not measured here.

**Build notes.** First: ids, ledger store, deterministic renderer; it unblocks M10's claim panel. Paraphrase pass and detector last.

## 5. C2 Span registry and citation resolution

**Best references.** R13 (selector pair), R14 (context length, and the re-anchoring we reject), R7-R12 (WebWeaver id bank), 03 decision 1 (offsets).

**What they do.** The W3C model identifies a segment by `exact` text with `prefix`/`suffix` context (4.2.4) or by `start`/`end` positions (4.2.5) and notes position is brittle when the resource changes. `dom-anchor-text-quote::toTextPosition` combines them: it first tries the quote and context and falls back to diff-match-patch bitap in 32-character slices, which is right for annotation tools and wrong for a verifier (it will find something near). WebWeaver numbers fetched pages (`url2id`) so the writer cites ids, but never checks them.

**Decision.** Adapt. A resolved citation carries **both** selectors (R13) and verification requires them to agree exactly; no fuzzy re-anchoring (spec 19a rejection of tolerant alignment).

**Design.**
```ts
interface SpanTable { evidenceId: Id<"ev">; textLayerHash: RawHash; segmenterVersion: string; spans: Span[] }   // text spans: M2's SpanRecord[] (pure segmenter); field spans: built here
interface ResolvedCitation {
  evidenceId: Id<"ev">; spanIds: SpanId[];
  exact: string;                       // CODE-supplied: slice of the page text (or the canonical field value)
  quoteSel: { exact: string; prefix: string; suffix: string };   // 32 code points of context each side, same page (R14)
  locator: Locator;                    // shared type: textlayer = {unit: "codepoint", page, start, end, byteStart, byteEnd, textLayerHash, layerId, docSha};
                                       //               json-pointer = {field: <RFC 6901 pointer into Evidence.raw>}
  spanSha: RawHash;                    // sha256 of the UTF-8 bytes of `exact`, reproducible with sha256sum; the only stored quote hash
}
```
1. **Span ids.** M2 owns `SpanRecord` and the text-span id (`sp_` + first 24 hex of sha256 over textLayerHash, page, start, end; unique across pages, INT-005); M4's `Span` is a view over it. M4 owns only structured-field spans, id `sp_` + first 24 hex of `hash("span", evidenceHash, jsonPointer)`. The span table is a pure function of the text layer and `segmenterVersion` (sentence or line segments, table cells, plus optional merged windows); M2 owns the segmenter and the layer, which is **never normalised**; offsets are code points, page-relative, with matching UTF-8 byte offsets (INT-004).
2. **Models never see offsets or stable ids.** Prompts are built by M2's `renderForModel(spans, nonce)`: each unit is a per-run alias line `⟦nonce:S12⟧ text` (and `field: value` lines for records), the nonce coming from `ctx.rng` so document text cannot forge an alias (`SEC-I12`); the alias map is stored in the cassette. The model returns aliases; code maps them back to span ids, and an alias outside the map fails closed as `invalid_citation` with reason `unknown_span_id`. All cache keys (C6 `inputHash`, `cacheKey`) are computed over canonical span ids and unit text, never aliases, so they are stable across nonces.
3. **Resolution** `resolve(citation, store) -> Result<ResolvedCitation, CitationError>` checks, in order: evidence id exists, is `fetchState: ok` and `use: "decision"` (discovery evidence such as a Jina read is never citable: every claim in the ledger is decision-bearing because the ledger is template-bound, and an evaluation baseline arm that cites one is scored `invalid_citation: evidence_not_admissible`, INT-006); `textLayerHash` recomputed from the stored layer equals the recorded one; every span id is in the span table; the page slice `[start, end)` in code points equals `exact`, and the UTF-8 slice `[byteStart, byteEnd)` of the same page text equals the same bytes, sits on code-point boundaries, and the code-point count before `byteStart` equals `start`; `quoteSel` matches uniquely at the locator (prefix + exact + suffix is a substring at that position; if `exact` occurs more than once on the page the prefix and suffix must disambiguate, and the unique-occurrence count is recorded). Errors: `unknown_evidence`, `unknown_span_id`, `text_layer_hash_mismatch`, `span_out_of_range`, `selector_disagreement`, `locator_unit_mismatch`, `evidence_not_ok`, `evidence_not_admissible`. Each maps to label `invalid_citation` with the reason in `l0.reason`. The offline verifier slices bytes (no normalisation or segmentation), runs the same boundary and count cross-check, and reports a disagreement as `V5.LOCATOR_UNIT_MISMATCH`.
4. **A citation is checkable, not a proof.** Resolution proves the quote exists at that place in our text layer; it proves nothing about support (that is C6) or about the original PDF beyond the measured locator-fidelity rate of M2 (section 9a, "Document and locator fidelity").
5. **Cap.** At most 3 distinct evidence items per claim (`k_cite = 3`, the ALCE default) so that C9 subset tables stay at 7 judged subsets; a fourth is not truncated silently: the claim gets `over_cap`, and the producer must split it into several claims (the code splits by evidence item and re-derives ids).
6. **Structured evidence.** `kind: "field"` spans address an RFC 6901 pointer inside `Evidence.raw` (the `json-pointer` resolver kind, so the offline verifier needs only the raw bytes); the "text" shown to a judge is `pointer: canonical value` with the normalised value beside it as a derived display; the exact string is the JCS serialisation of the raw value at the pointer, and `spanSha` is the RawHash of its UTF-8 bytes.

**Tests.** property: `resolve(cite(slice(start,end)))` round-trips for random spans over a Unicode corpus that includes astral characters, combining sequences and a BOM; forged-id, shifted-offset, stale-hash and duplicate-exact cases; byte offsets that disagree with code-point offsets after an astral character must give `locator_unit_mismatch` here and `V5.LOCATOR_UNIT_MISMATCH` in the verifier; a discovery-use item must give `evidence_not_admissible`; the duplicate-quote case (a quote occurring twice, cited to the second) must resolve to the second; differential test against a second implementation in the verifier core (M9 V5).

**Risks / NOT VERIFIED.** Offset unit: M2 owns it and the layer is un-normalised, so M4 assumes nothing about NFC; the byte offsets exist so a verifier in another language can slice bytes directly and use the code-point count only as a cross-check. The uniqueness rule can reject legitimate repeated boilerplate quotes; the rate is measured on the document corpus.

**Build notes.** Needed before C3, C6 and C9; small and pure.

## 6. C3 L0a: quote matcher with normalisation index map

**Best references.** R5 (`QuotedSpansAlignment`), R13/R14, R15, R2 (guard idea), 04 §9.1 0a.

**What they do.** ragas `quoted_spans.py` (read): one regex (`_QUOTE_RE`) with a single character class serves as both opening and closing delimiter, so apostrophes and the backtick act as quotes (prior-art 04 §5.3 checked at byte level that the legacy class holds only ASCII quotes, the backtick and U+00B4; the collections version adds the curly quotes), the metric keeps spans of at least 3 words, normalises whitespace and case only, joins all sources with one space and tests substring membership, so a span can match across the seam of two unrelated passages, matches any source rather than the cited one, and returns 0.0 when nothing is quoted (04 §5.3 records the legacy/collections disagreement). No repository in the set keeps an index map from normalised to raw text.

**Decision.** Own, with the statuses of the spec: `exact`, `normalised`, `ellipsis_ordered`, `near`, `misattributed`, `absent`. Two additions found necessary by the design: `outside_span` and `quote_too_short`. The text layer itself is never normalised (M2, INT-004); the matcher builds a derived normalised space beside it, and that space is **NFC plus an explicit table of named folds**, not blanket NFKC (alternative rejected: NFKC folds `x²` to `x2` and `㎏` to `kg`, which changes meaning in a dosage or unit context; each of our folds is a named rule that appears in the result). Every range the matcher reports is mapped back to layer code points through the index map, so no downstream consumer sees a normalised offset.

**Design.**
```ts
type FoldRule = "nfc" | "quote_marks" | "dashes" | "space_variants" | "zero_width" | "soft_hyphen" | "ligatures" | "fullwidth_ascii"
              | "case" | "linebreak_hyphen";          // linebreak_hyphen only for layers of kind "pdf"; it joins only where M2's `joinHints` mark a hyphen join, it never guesses
interface NormMap { text: string; out2raw: Uint32Array /* 2 per output code point: rawStart, rawEnd, in LAYER CODE POINTS (not UTF-16 units) */ }
function normalise(raw: string, rules: ReadonlySet<FoldRule>): NormMap      // pure
type QuoteStatus = "exact" | "normalised" | "ellipsis_ordered" | "near" | "outside_span" | "misattributed" | "absent" | "quote_too_short";
interface QuoteResult { status: QuoteStatus; foldsUsed: FoldRule[]; raw?: { evidenceId: Id<"ev">; page: number; start: number; end: number };   // layer code points, page-relative
                        fragments?: { start: number; end: number }[]; omittedChars?: number; warnings: ("omits_negation" | "omits_number" | "ambiguous_occurrence")[];
                        nearScore?: Milli; foundIn?: Id<"ev">; occurrences: number }       // Milli: integer 0..1000, because results are recorded (INT-010)
```
1. **Normaliser.** One left-to-right pass over grapheme clusters (`Intl.Segmenter`, grapheme granularity; the ICU version is recorded in the run). Each cluster is normalised by the NFC form and the enabled folds, emitting zero or more output code points, each with the raw range of its source cluster; whitespace and zero-width runs collapse to one space whose raw range is the whole run. A **self-check at ingest**: the concatenation of per-cluster NFC equals NFC of the whole layer (R15: forms are not closed under concatenation, so this is verified, not assumed). If it fails for a layer, that layer's matcher is restricted to `exact` and a gap `normalisation_unsafe` is recorded; the quote is never matched loosely on a layer we cannot map.
2. **Matching a quote against its cited evidence** (`matchQuote(q, citation, store)`):
   a. If `norm(q)` has fewer than 3 words or fewer than 12 code points: `quote_too_short` (not accepted as quote evidence; the claim keeps its span-id citation if it has one).
   b. `exact`: `q` is a substring of the raw text of the cited spans' union; record every occurrence and which fall inside the cited spans.
   c. `normalised`: `norm(q).text` occurs in `norm(spanText).text`; the raw range comes from `out2raw` (start of first output char's raw range, end of last's); `foldsUsed` lists the rules that changed anything.
   d. `ellipsis_ordered`: `q` contains `...`, `…`, `[...]` or `[…]`; split into fragments, each of at least 2 words and 12 code points (shorter fragments make trivial matches); each located by (b) or (c) in the same evidence item and in order. `omittedChars` is the raw distance between fragments; the elided raw region is recorded and the **L2 judge is shown the full contiguous region, including the omitted text**. Warnings: `omits_negation` if the omitted region contains a negation token from the closed list of the language pack, `omits_number` if it contains a digit. Both warnings route the claim to L2 with the check "does the omitted text change the meaning" and forbid `entailed` without the dual judges agreeing.
   e. `near`: no (b) to (d) match; a token-level banded edit distance against windows of the cited spans gives a similarity of at least 0.9 and at most 5% edit distance (starting values, tuned on the seeded set). **`near` is a warning, not a pass**: quote fidelity (check 2) reports `warn`, the claim carries `near_quote`, the displayed text is the **raw best-match region** (never the model's wording) with a "paraphrased, not verbatim" badge, and the claim proceeds to L2 on the raw region. We use edit distance only to name the nearest region; it never upgrades a status to pass (spec 19a, rejected as verification).
   f. `outside_span`: found by (b) or (c) in the cited evidence item but outside the cited spans: label `invalid_citation` (reason `span_mismatch`), diagnostics keep the found offsets; the validator rejects and never repairs.
   g. `misattributed`: found (b/c) or `near` in a *different* evidence item of the case: `fabricated_quote` with sub-reason `misattributed`, `foundIn` recorded. A shingle index (hashed word 4-grams over the normalised text of every item in the case) finds candidates without scanning all text.
   h. `absent`: `fabricated_quote`, sub-reason `absent`. A `fabricated_quote` ends the claim with no model call (spec).
3. **Quote extraction from third-party text** (used when a model or a baseline arm emits quotes inline): paired delimiters only (straight, curly, low-9, guillemets, CJK corner brackets); a single quote mark counts as a delimiter only when the opener follows whitespace or an opening bracket and the closer precedes whitespace or punctuation (fixes the apostrophe defect of R5), minimum 3 words.
4. **Per cited item, never against a joined blob**, and the seam rule: a match must lie inside one span or inside the union of adjacent spans of one item and one page (locators are page-relative, INT-004). A quote that crosses a page break is matched per page as ordered fragments and reported `ellipsis_ordered` with no omitted characters, never `exact`; whether M2's layer can mark such joins is **NOT VERIFIED** and is a question to M2.
5. **Mixed script.** If a matched raw region contains letters from two scripts inside one word, the claim gets `mixed_script` and the region is shown with a visible marker; the confusable-skeleton method (UTS #39) is the candidate and is **NOT VERIFIED** here (the document was not fetched).

**Tests.** Seeded quote set built from the document corpus: real quotes with typographic variants (the false-fail rate on real quotes is the number that matters), fabricated, misattributed, near, elided, shortened, apostrophe-heavy text, CJK and RTL samples; metamorphic: applying any enabled fold to the source text must not change the raw range of a `normalised` match; property: `out2raw` monotone and covering; differential: a naive regex oracle for `exact`; fuzz: random Unicode input must never throw, and must not produce a raw range outside the layer. Report recall on seeded fabrications (expected 1 by construction, any miss is a bug), false-fail rate on real quotes with an interval, and the share of `normalised` that needed each fold.

**Risks / NOT VERIFIED.** Grapheme segmentation boundaries differ across ICU versions (recorded; a pinned segmenter table is the fallback). PDF text layers with ligature and hyphenation artefacts are where `normalised` earns its keep; the fold list is data and is extended only with a seeded test that shows a real false-fail first.

**Build notes.** Second component to build (after C2); everything downstream trusts its statuses. The L0 quote-check algorithm is published as a normative `l0-spec` with test vectors before build step 8, because M9's verifier-core gate (V5) depends on it (register section 5, V6).

## 7. C4 L0b: numeric, date and structured-value consistency, integrity

**Best references.** R2 (`postprocess_atomic_facts`, `detect_entities`), R3 (id range check), R16 (oracle), 04 §9.1 0b/0c, R28 (AttributionBench: models fail on one-number, one-date, one-negation edits).

**What they do.** FActScore drops a decomposed fact that introduces a date or integer absent from its sentence; the regex `\b\d+\b` splits `3.5` into `3` and `5` and `1,000` into `1` and `000` (04 §2.3), and names are not checked. ALCE checks id ranges only. Nothing in the set parses units, scales or dates, or compares structured values.

**Decision.** Own, with exact decimal arithmetic (no floats, matching the JCS profile) and ambiguity-retaining parsers; `wanasit/chrono` (R16) only as a differential oracle on a closed set of date formats.

**Design.**
1. **Integrity (0b).** `bodyHash` (RawHash, or the commitment form above `public`), `parsedHash` (DocHash), `textLayerHash` (RawHash) and the span `spanSha` (RawHash of the exact UTF-8 bytes) are recomputed from stored bytes on every resolve and compared with the recorded values; mismatch is `invalid_citation: hash_mismatch`. This proves the judged text equals the cited text and nothing more.
2. **Numbers.** `Decimal { coef: bigint; exp: number }`. The parser recognises thousands separators, decimal marks (both readings of `1.234`/`1,234` are kept as a set of candidate values when the locale is not declared), percentages, currency symbols and ISO codes, scale words (`k`, `thousand`, `million`, `billion`, and `lakh`/`crore` when the pack enables them), units, ranges, and spelled numbers for a closed list. Output: `Quantity { values: Decimal[]; unit?: string; precision: number; scale?: string; span: [number, number] }[]`.
3. **Dates.** A closed grammar: ISO 8601, `D Month YYYY`, `Month D, YYYY`, `Month YYYY`, `YYYY`, numeric day-month forms (both readings kept when ambiguous). Relative dates resolve only against the explicit `asOf`; otherwise status `unresolvable`, never a guess.
4. **Comparison** at the coarser of the two precisions (a claim of "about 1.2 million" matches 1,234,567). Statuses: `match`; `absent` (claim value not present in the cited spans); `conflict_candidate` (same unit, at least two shared content tokens within 8 tokens of the number on both sides, different value beyond tolerance, and the claim value occurs nowhere in the evidence); `derived_candidate` (claim value equals a sum, difference, ratio or percent change of two evidence values of one unit within tolerance); `n/a`. A numeric status is a hint passed to C6 as data, never a verdict: `absent` is not wrong (the value may be derived) and a `conflict_candidate` may concern another quantity.
5. **Structured match** for `finding` claims and field spans: `claim.typedForm.value` against the value at the cited pointer after the **same normaliser functions M3 uses** (shared module, so a mismatch cannot come from two normalisers). Statuses `field_match | field_mismatch | field_absent`. `field_mismatch` on an `origin: finding` claim is a defect (the generator and the store disagree) and fails the run as `validation`, never a silent label.
6. **Within-answer consistency.** The same `(entity key, attribute or unit)` stated with two different values in one ledger yields `self_inconsistent` between claims, a contradiction found without any evidence.
7. **Drift guard** (shared with C5): every number, date and capitalised entity string in an atom must occur in its parent sentence by parsed value (not by string) or by alias map; a miss is a flag, not a rejection.

**Tests.** A table of numeric and date forms with expected parses (locale ambiguity, `3.5`, `1,000`, `1.000,50`, `12/03/2026`, lakh); property: parse-render-parse stability; differential against R16 on the closed date grammar; AttributionBench-style edit set (one digit changed, one date shifted, one unit changed, one negation) where the expected status is known; the fraction of numeric claims decided by 0c alone is reported.

**Risks / NOT VERIFIED.** Locale defaults per pack (`en-US`, `en-IN`, `de-DE`) are declared data; a wrong declaration shifts a value by a factor of 1000, which is why ambiguous readings are kept and the lenient comparison reports the ambiguity. Written-number coverage is a closed list and is extended only by seeded failures.

**Build notes.** Alongside C3; the numeric parser is also reused by C5 and the lexical gate in C6.

## 8. C5 L1: decomposition with self-containment, relevance, drift and coverage guards

**Best references.** R1 (decompose, `revise_fact`, `check_relevance`), R2 (guard), R5 (statement generator, atomicity-coverage grid), R28/08 E8 (VeriScore, Molecular Facts, DecompScore: decontextuality and minimality).

**What they do.** SAFE: `get_atomic_facts.py` runs the FActScore generator (7 fixed demonstrations plus one BM25-selected, temperature 0, `is_bio = True` hard-coded so biography demos serve every topic), `revise_fact` rewrites pronouns and unknown entities under "MUST NOT change, MUST NOT add", `check_relevance` keeps a fact only if the response relates its subject to the question's subject, and **on a parse failure the fact is assumed relevant** (04 §1.2). FActScore guards integers and dates only. ragas generates statements with one example and checks nothing. The decomposer's own noise moves every claim-level denominator (R1 README correlation of about 0.8 with humans).

**Decision.** Adapt the contracts, own every guard; prompt text is M14's. **Two arms (INT-012).** The default is **extractive**: M14 C7 returns each atom as an ordered list of `pieces` (spans of the parent sentence plus entity handles, joined by a closed token list), and `text` is derived from `pieces`, so an atom cannot contain a word the sentence did not, and the drift guard is structural rather than a post-hoc check. The **generative** SAFE-style arm (the atom text is model-written, then rewritten for self-containment) is the control arm that M14 C18 schedules in the pre-registered ablation. The guards (drift, coverage, atomicity, dedupe) run on both arms and are what makes their outputs comparable. L1 is used only for `origin: "prose"` input: counterparty free-text clauses, an optional reporter paraphrase, and (evaluation) the output of baseline arms (a single long-context prompt, ragas-style, ALCE-style) so that every arm is scored by the same machinery.

**Design.**
1. **Segment.** `Intl.Segmenter` (sentence) plus a guard list for initials, abbreviations and legal forms (`Ltd.`, `Inc.`, `No.`, `Art.`, `Sec.`); the ICU version and the guard-list hash are recorded in the trace because segmentation is an input to claim ids. Boilerplate (greetings, "Here is", sign-offs) becomes `meta` and is not counted.
2. **Decompose** (model, one call per sentence with its neighbours as read-only context). Extractive arm: output schema `{atoms: [{pieces, kind, checkWorthy}]}` where a `span` piece indexes the parent sentence in code points and an `entity` piece is a handle into the case entity table; `entities` and `quantities` are recomputed by code from the derived text, not taken from the model. Generative arm: `{atoms: [{text, kind, checkWorthy, entities, quantities}]}`. Temperature 0; the prompt carries a few demonstrations, at least one retrieved by lexical similarity; rejected output is retried at most twice, then the sentence falls back to a sentence claim with `decomposer: "sentence-fallback"`. The decomposer id is recorded as `llm:extractive:<model>` or `llm:generative:<model>`, so results are never pooled across arms.
3. **Self-contain.** Extractive arm: done by entity-handle substitution inside `pieces` (a pronoun or role noun is replaced by an `entity` piece, never by free text), so no rewrite call exists. Generative arm only: a second pass (or fused call, cost option decided by an A/B on the gold set) rewrites each atom so that no pronoun, demonstrative or role noun ("the company", "the vendor") remains: it must use the case's canonical entity name or id alias. Hard constraints as in R1: do not change, do not add. Deterministic self-containment check for both arms: first-token and pronoun lists per language pack plus a required-entity check; failures keep the atom with `selfContained: false` and exclude it from headline metrics.
4. **Relevance.** Keep for headline metrics only if the sentence relates its subject to the active template's subject (R1 definition); on parse failure `relevance: "unknown"`, kept, reason in the trace (R1's silent default is not copied).
5. **Drift guard** (C4 item 7) plus an entailment check from the parent sentence and its neighbours to each atom (lexical first, model second); failures are `decomposition_drift`, excluded from scoring, still listed. On the extractive arm the first part holds by construction and still runs as a self-test of the piece renderer (any hit is a defect, not a flag).
6. **Coverage guard.** Every number, date and capitalised entity in the sentence must appear in at least one atom, else `coverage_gap`.
7. **Atomicity guard.** Count independently checkable values and relations per atom (numbers, dates, named relations); more than one flags `non_atomic` and the atom is split by the second pass at most once.
8. **Dedupe** after normalisation: equal normalised text, then token Jaccard of at least 0.9 with identical numbers and entities; SAFE's F1@K assumes this and does not do it.
9. **Untrusted input.** The text being decomposed is data; it is wrapped in a delimiter the model is told not to obey, the output must match the closed schema, and the atoms inherit `trust = combine(source trust, EXTRACTED)` and `stance = {reported: authorship}` when the source is counterparty-authored.

**Tests.** Decomposer metrics from the ragas grid and 04 §10.6: atomicity error rate, coverage, drift rate, fact-count agreement with humans, always with the decomposer id; a seeded drift set (atoms with an invented number, date or entity) the guard must catch on the generative arm, and an extractive-arm property test that no derived atom contains a token absent from its parent sentence except a canonical entity name from a handle; a coverage set with a dropped number; extractive, generative and sentence-fallback results never pooled with each other (the arm comparison itself is M14's pre-registered ablation, INT-060); an injection set (a clause telling the decomposer to emit nothing or to add a claim) whose atoms must equal the clean twin's.

**Risks / NOT VERIFIED.** `Intl.Segmenter` quality on legal abbreviations (guard list calibrated on the gold set). Whether fusing steps 2 and 3 costs accuracy. Atom counts differ from human counts, which is why claim-level metrics are always reported beside sentence-level ones that do not depend on the decomposer (C18).

**Build notes.** After C3/C4; needed for baseline arms in evaluation before it is needed in the product path.

## 9. C6 L2: entailment judging

**Best references.** R3 (joint-entailment unit, leave-one-out), R4 (three-way ladder, "no outside knowledge"), R1 (strict "strongly implied" wording), R5 (dual-prompt 0/1/2 average), R26 (over-commit, self-preference, order bias), R17/R18 (external anchors), R27 (second voters), 08 F4 (give the judge what a human gets).

**What they do.** ALCE concatenates the cited documents as one premise and asks a T5-XXL NLI checkpoint whether it entails the sentence (`eval.py::_run_nli_autoais`), capped at 3 citations; Self-RAG's critic prompt defines fully/partially/none with the instruction not to use outside knowledge and merges "No support / Contradictory"; ragas averages two differently worded judges; SAFE requires "strongly implied by the KNOWLEDGE". All binary or merged on silence versus contradiction. Cherry-pick Override (R26) reports human panels committing directionally on 18.7% of claims when the task allowed "Not Enough Evidence", and LLM judges 21.3% to 48.0% (single-author preprint, rates are dataset-defined lower bounds).

**Decision.** Own the judge contract and acceptance rules. Labels `entailed | partial | neutral | contradicted` (spec). Different model family from the producer where the profile allows; in the sponsor profile heterogeneity is size tiers labelled "same family", and the independent voter is non-LLM.

**Design.**
```ts
interface JudgeInput { claim: string; units: { spanId: SpanId; text: string; context: string; authorship: Authorship; asOf?: Iso }[];   // the ONLY evidence the judge sees
                       hints: { numeric?: NumericStatus[]; structured?: StructuredStatus }; promptVersion: string }
interface JudgeOutput { label: "entailed" | "partial" | "neutral" | "contradicted"; decidingSpanIds: SpanId[]; contrarySpanIds: SpanId[];
                        uncovered?: string[]; quote?: string }
interface Voter { id: string; family: string; kind: "llm" | "lexical" | "nli"; out: JudgeOutput | "abstain"; cacheKey: Hash }
```
1. **Locality by construction.** `JudgeInput.units` is built from the cited spans (plus a fixed context window of one neighbouring segment on each side, same evidence item and page, so a human reading the same unit sees the same text). The port signature accepts nothing else; `inputHash = hash(claim, canonical span ids and unit texts, promptVersion)` is stored on the edge (aliases are rendered per run by M2 and mapped back by code, so they never enter a hash; the model returns aliases and `JudgeOutput` carries the mapped canonical `SpanId`s). This is what makes edge locality (C9) true at the interface.
2. **Label definitions given to the judge**: `entailed` (every element of the claim is stated or follows by simple inference from the units), `partial` (a named element is supported and a named element is not discussed), `neutral` (the units are silent on the claim), `contradicted` (the units state something incompatible with a claim element; the contrary span is required). No outside knowledge. The text of units is data inside delimiters; the instruction block is fixed and hash-pinned.
3. **Required deciding span.** `entailed` and `partial` need at least one `decidingSpanId`; `contradicted` needs a `contrarySpanId`; `partial` also needs `uncovered` (free text, shown only as `model_reported`). Span ids are validated against the `units` (an id outside them is `invalid_citation`). The optional `quote` is located by C3 inside the named spans; a `fabricated_quote` voids the vote. A verdict missing its required span becomes `unverified_rationale`, goes to L3 once, and is never an `entailed`.
4. **Dual prompts.** Prompt A is claim-first; prompt B is evidence-first (extract what the units say about each claim element, then compare) and presents multi-unit evidence in reversed order (R26 order bias). Same model, temperature 0, both cached by `hash(promptVersion, inputHash, modelId, params)`.
5. **Voters and acceptance.** V1 = prompt A, V2 = prompt B, V3 = independent voter: the lexical gate (below) always, plus a second-family LLM in the evaluation profile or a small NLI model if the bake-off below earns it. Acceptance table:

| Result of V1 and V2 | V3 | Outcome |
|---|---|---|
| both `entailed`, span verified | not contradicting | `entailed`, agreement 1 |
| both `entailed` | `lexical_conflict_candidate` or `contradicted` | route to L3, `judge_unstable` |
| both `contradicted`, contrary span verified | `lexical_conflict_candidate` or agrees | `contradicted` |
| both `contradicted` | silent or supports | route to L3 (false-contradiction defence) |
| both `neutral` | any | `neutral` |
| both `partial` | any | `partial` |
| they differ in any way | any | route to L3; the disagreement is the routing reason, never averaged |

   A `contradicted` label can never come from one voter. A `entailed` label in a **high-stakes class** (numbers, sanctions, ownership, licences) additionally needs V3 not to contradict it.
6. **Lexical gate (offline, V3 and the SAMPLE_MODE judge).** From 04 §9.3: tokens lowercased, stopwords dropped, light stemming; for claim content set `T(c)` and each window `W` of 1 to 3 consecutive segments of the cited unit, `cov(c,W) = sum_{t in T(c) ∩ T(W)} idf(t) / sum_{t in T(c)} idf(t)`, `idf(t) = ln(1 + (N - n_t + 0.5)/(n_t + 0.5))`. Gates: all claim numbers and dates found in `W` (C4), all capitalised entities found, negation parity equal. Output `lexical_supported` (`best >= tau_hi` and gates pass), `lexical_unsupported` (`best < tau_lo`), `lexical_conflict_candidate` (`best >= tau_lo` and a number/date gate fails or negation parity differs), else `uncertain`. `tau_hi` is set on the dev split so that precision of `lexical_supported` is at least 0.95, and `tau_lo` so that recall of true-unsupported is at least 0.95; if the target cannot be met the gate abstains more and is never loosened. The gate may **demote or flag, never promote** except in `grade: offline`, where its labels carry `confidence: low` and are never pooled with LLM-grade metrics. Known blind spots, tested rather than discovered: role reversal, paraphrase with no shared content word, quantifier change, negation scope, cross-sentence coreference, implicit arithmetic.
7. **Second-voter bake-off (new, small).** Candidates: lexical gate alone, `transformers.js` (R27) running a vendored NLI cross-encoder, MiniCheck/AlignScore through an offline sidecar. Adoption conditions, all measured: separates silence from contradiction (a binary supported/unsupported scorer is only a pre-filter), runs without a runtime download, licence permits, beats the lexical gate on ContractNLI and our gold at equal precision. Until then V3 is the lexical gate.
8. **Probes (in the cone only, cached).** `v(c, empty)`: if the judge says `entailed` with no evidence the claim is flagged `ungrounded_entailment` and cannot rise above `low` confidence; `v(c, C + D)` with three distractor units from other claims: a change flags `distractor_sensitive`. A flip counts only if reproduced in 3 independent runs on both sides; otherwise `judge_unstable` (noise floor reported with every number).
9. **Strict and lenient.** Every aggregate that depends on a L2 label is reported under a strict rule (`entailed` only) and a lenient rule (`entailed` or `partial`) because the unsupported-citation rate swings from about 3% to about 18% with verifier strictness (R26, 08 F8).
10. **Labels never permit (restrict-only, INT-015).** Every claim label is delivered to M5a as the feature `claim.<id>.canPermit` together with its chain label (`trust` as the meet over the chain, `authorship`, producer), typed and conformance-tested on the M5 side. The flag is `false` when the chain includes `EXTRACTED` or `UNTRUSTED` input or is `self_declared_only`, and a missing or unknown flag is read as `false`, which can only hold. A test asserts that the flag equals M8's `permitsClass(chainLabel, "satisfy_manifest_item")`, so the flag and the permission-matrix lookup (INT-014) cannot diverge. `contradicted`, `partial`, `contested` and `unattributed` may add holds whatever the chain; `entailed` removes a doubt only for items whose release-enabling fact already comes from a `SOR` or `VERIFIED` channel (spec section 5). A label never loosens by itself: M5 may use it only to add a hold or escalation, or as one supporting input to a manifest entry whose positive evidence already comes from a permitted channel.
11. **Prompt-injection posture.** Units and claim text are untrusted. The judge's output is a closed schema, ids are validated, and the only thing an injected sentence can do is change a label; label changes are measured by attack family EC12 (steer) with the oracle "label equals the label on the clean twin".

**Tests.** (a) Accuracy: macro-F1 and Cohen's kappa over the four classes with a confusion matrix, on ContractNLI (R17, mapping `NotMentioned` to `neutral`), our gold set, FActScore labelled data and the ALCE human files (04 §10.7); (b) over-commit rate per judge: share of `neutral` gold items labelled `entailed` or `contradicted` (R26 standing metric); (c) VitaminC-style contrast: on minimal-edit pairs the label must flip; (d) span-gate ablation (with and without the required deciding span) on `ungrounded_entailment` rate; (e) order-bias test (swap unit order); (f) noise floor over 3 runs; (g) acceptance-table property tests with scripted voters; (h) the lexical gate's precision/recall targets and its blind-spot suite.

**Risks / NOT VERIFIED.** Whether the span gate reduces prior-knowledge leakage (R26 F6: attribution cannot separate in-weight from in-context contributions; our empty-evidence probe is the diagnostic). Calibration resets when the judge model changes. A Nemotron-only sponsor run cannot test self-preference; the evaluation profile does. ContractNLI reuse terms for the underlying contract text are **NOT VERIFIED**; its repository is CC-BY-4.0 per GitHub.

**Build notes.** Needs C2, C3, C4. Build the lexical gate and the scripted-voter harness first (they run without credentials), then real judges.

## 10. C7 L3: sensitivity router, advocate, skeptic, arbiter

**Best references.** R6 (revise-after-seeing-others; study only, no code or prompt text copied), 04 §9.4, R19 (poisoned corpus), R7-R12 (bounded loops, termination taxonomy from DeepResearch), 08 D6 (LLM-built arguments are not anchored: rejected).

**What they do.** Du et al.'s `construct_message` shows each agent the others' last answers and asks for an update; rounds are a constant; the only early exit is a refusal heuristic in `biography/gen_conversation.py`; majority vote is `most_frequent`, which with two agents returns the first maximum; there is no evidence, no stopping rule and no count of right-to-wrong flips (04 §6). DeepResearch's harness gives every run a named termination label with call, wall-clock and context budgets (03 §4).

**Decision.** Own. Asymmetric roles, evidence-anchored arguments, deterministic arbitration first, a panel only for the residue, a terminal `contested`, measured harm.

**Design.**
1. **Sensitivity router (exact).** Claim `c` is *verdict-relevant* iff relabelling `c` alone (to each of the other labels, plus `contested`) changes the projected verdict when evaluated through the policy stage (C8 `policy` phase, five evaluations per claim; no model, no re-reconcile). It is *uncertain* iff its L2 outcome was routed by C6 (disagreement, `unverified_rationale`, `judge_unstable`, `partial`, high-stakes class). Route to L3 iff verdict-relevant **and** uncertain. A pair test (two claims of the same cell relabelled together) catches cases where two claims jointly matter. Non-routed claims keep their L2 label with lower confidence. The router is computed from the actual policy (code), which is what makes it exact.
2. **Searchers.** Advocate and skeptic are tool-using agents over the **stored case corpus only** (no web): tools `search_corpus(query, scope)` (BM25 over text layers and rendered field values, returning span aliases and text) and `read_span(alias)`, with aliases rendered and mapped back as in C2 item 2; at most 6 tool calls per role per round; both start from the claim and the cited units; query strings are generated by the model but executed by a typed channel (closed grammar, no URL).
3. **Brief.** Each side returns `Brief = [{assertion: string, spanIds: SpanId[], quote?: string}]`, at most 4 items. Every span id is resolved (C2) and every quote matched (C3); items that fail are **struck** before the arbiter reads anything, and the strike is shown to the arbiter ("advocate cited text that is not in the source").
4. **Round r >= 2.** Each side sees the other's surviving brief and may revise once (the Du et al. pattern with evidence attached).
5. **Stopping rules, in code.** Stop at round r if the label and the surviving span set equal round r-1 (minimum 2 rounds unless rule 2 fires in round 1); stop at once if one side's whole brief is struck; hard cap `R_max = 3`; a token budget per claim; on cap without stability the label is `contested`. No forced vote. Every run ends with a named termination label (`stable`, `one_side_struck`, `round_cap`, `token_budget`, `judge_error`).
6. **Arbiter, deterministic first.** The input is the claim, the surviving briefs and the C6 results on each side's spans (units limited to ≤ 3 evidence items per side).
   - R1: advocate fully struck, skeptic has a verified contrary span passing the contrast check of C6 item 5 → `contradicted`; without the contrast check → `neutral`.
   - R2: skeptic fully struck, advocate has verified spans and C6 on them gives `entailed` → `entailed`.
   - R3: both sides have verified spans and the claim maps to an attribute cell → defer to M3's pure `resolve` on the pair (authority tier, then recency, declared per attribute); an `unresolved` cell yields `contested`.
   - R4: both sides have verified spans and the claim is free text → `contested` with both sides shown (conflict is data).
   - R5: neither side has a verified span → `neutral`.
   - Residue (rules do not decide, for example differing C6 outcomes on each side's spans): a panel of three, different families in the evaluation profile and size tiers labelled "same family" in the sponsor profile. The panel may choose `entailed` only if the advocate has a verified span, `contradicted` only if the skeptic has one, and a 1-1-1 split is `contested`; it cannot add spans.
7. **Edge input.** The L3 label is recorded as the full-set entry of the claim's edge (C9) with `inputs` = the evidence items of the surviving spans, at most 3 per side (6 total). Subset entries are filled by dual L2 judging of the subset (a fidelity difference we state: subset entries are L2-grade, the full entry is L3-grade).
8. **Corpus poisoning.** The searchable corpus contains counterparty-authored text. A span found by search keeps `authorship`; a claim whose support is only counterparty-authored gets `self_declared_only` no matter what the arbiter decides (R19 and EC18).
9. **Harm accounting.** For every routed claim record `y_L2`, `y_final`; metrics `p` (routed fraction), mean rounds, tokens, benefit flips `BF`, harmful flips `HF`, `BF - HF`, contested share (C18).

**Tests.** Router exactness against exhaustive relabelling of random policies; stopping-rule property tests with scripted debaters (every run terminates within `R_max`); strike tests (fully fabricated brief loses round 1); arbiter rule tests (R1 to R5 on constructed cases); panel confinement (cannot choose a label without a verified span); poisoned-corpus test (planted span ranking first for the claim query); ablation arms for H2 in the pre-registration: A1 single judge with the same tools, A2 token-matched k-sample vote, A5 this component. The arms, and the switch-offs for the C6 span gate, this component and C14, are registered as M11 `ArmSpec` role and layer switches (INT-060); M4 defines no arm schema of its own.

**Risks / NOT VERIFIED.** Whether asymmetric evidence-anchored debate beats a single dual-judge pass on evidence-grounded verification (Du et al. tested closed-book tasks; the claim is not supported until the ablation). Fraction of claims routed (`p`) is unknown until measured. The sponsor profile cannot supply a second family for the panel.

**Build notes.** After C6 and C9's cone code (the router needs the policy stage). Built last among the judged layers because the ablation may remove it.

## 11. C8 Evaluator contract and derivation trace (what M3 and M5 must emit)

**Best references.** R20 (the oracle model), R23 (structural model: exogenous bits plus named endogenous nodes), 08 B7/B8 (provenance semirings and proof-annotation patterns; Soufflé as a pattern only), 08 B5/B6 (policy rules as conjunctive queries: lint idea, unverified mapping), R25.

**What they do.** The formal-XAI work treats the model as an oracle and computes explanations by repeated calls; the causality literature needs the structural model; Soufflé's provenance emits proof nodes `(rule, premises)` per fired rule. None of them targets a non-monotone, typed verdict function over reconciled records.

**Decision.** M4 owns the `Evaluator` interface and the composition (INT-034); M3 and M5a implement their halves. This is the dependency that decides whether C10 to C15 are exact or merely approximate: the explanations are only as good as the evaluator trace.

**Composition and ownership (INT-034).** `V = phase2 ∘ phase1`, where `phase1 = M3.fuse ∘ label aggregation (M4 C9) ∘ M5a.featurize` and `phase2 = M5a.evaluate`. M3 adapts `fuse`, `statusUnder` and `cellHypergraph` into `keys`, `deps` and `phase1` per cell. M5a adapts `coneOf` and `fieldDeps` into `reads(projection)` (declared reads, control dependence included) and maps its internal numbered `derive` DAG to `DerivationTrace` by a deterministic mapping it owns (node ids `nd_` computed from `fn`, version, reads and value, as in obligation 7); M5a's richer DAG stays internal. M5a's `flipSearch` is the field-level, post-reconcile search and C11 combines it with M4's evidence-level search. Link scoring (M3 stage A) is outside `V`: `phase1` reads only recorded link decisions with judged labels, so fuzzy scores never appear in `V`, and the verifier's recompute module (M9) interprets exactly `phase1` and `phase2` as data. `Recompute(snapshot, removed)`, which M6 consumes, is `phase2(phase1(E ∖ removed))` over a `FrozenLedger` (C9). M3's `robustness(base, verdictOf, cfg)` receives `verdictOf` from this composition and `reads` from M5a.

**Design.** `V` is a composition of two pure phases over a presence set.
```ts
type Key = string;                                  // cell:<entityId>/<attribute>, edge:<EdgeId>, feat:<name>
interface Intermediate { states: ReadonlyMap<Key, Json> }      // FIXED key set derived from the full snapshot; a key with no data in S has state {"no_data": true}, never absent
interface Evaluator {
  readonly vSpecHash: Hash;                         // hash of the versions of the three halves (M3 reconcile IR with authority/date tables, M4 label-aggregation spec, M5a feature and policy IR) plus the projection id; printed in every certificate
  keys(): readonly Key[];
  deps(key: Key): ReadonlySet<Id<"ev">>;            // SOUND over-approximation: every evidence item that can change states[key] (transitive through links and derivedFrom)
  reads(projection: string): ReadonlySet<Key>;      // keys the policy stage can read for this projection (declared, includes control dependence)
  phase1(q: { present: ReadonlySet<Id<"ev">>; edits?: Edit[] }): Result<Intermediate, EvalError>;      // reconcile + label features; pure
  phase2(i: Intermediate, projection: string): Result<{ projected: ProjectedVerdict; full: Json; trace?: DerivationTrace }, EvalError>;   // policy; pure
}
interface DerivationNode { id: `nd_${string}`; fn: string; fnVersion: string; reads: string[]; value: Json; kind: "exo" | "derived"; owner: "M3" | "M5" }
interface DerivationTrace { nodes: DerivationNode[]; verdictNode: string }
```
Obligations (each is a test in section C9/C10 and an acceptance item for M3 and M5):
1. **Purity and totality.** `phase1` and `phase2` are pure and defined for **every** subset of evidence, including the empty set. Missing required facts produce a defined verdict (hold or escalate, per the required-positive-evidence rule), never an error. `EvalError` is only for programming errors and is `fatal`.
2. **Fixed key set.** `keys()` is the same for every `present`; this is what makes states comparable across subsets and `Intermediate`s composable key-wise.
3. **Sound dependencies.** `deps(key)` over-approximates. Test: for random `S` and random `e` outside `deps(key)`, `phase1(S).states[key] === phase1(S ∪ {e}).states[key]`.
4. **Reads include control dependence.** `reads(projection)` lists every key the policy stage may consult on *any* path, including keys consulted only when a higher-precedence rule does not fire. A cone built only from the trace of `V(E)` is **unsound** (a removal can enable a rule that never ran in the full evaluation); the cone is built from declared reads.
5. **Pairwise judged edges (INT-036).** A link judgement is recorded per candidate pair (query mention, candidate), batch-order independent. M3's select-from-list call only *nominates*; the recorded edge comes from a pairwise confirmation call on (subject, chosen) in both orders, whose `inputs` are exactly the two mentions' assertions, so locality can be tested by re-judging with non-cited evidence removed. Otherwise removing an irrelevant candidate would kill the edge and manufacture a fake dependence. If the call budget forbids the confirmation, M3 records `inputs` as the union of all shown candidates' assertions and the edge carries `locality: "set"` (conservative: flips may be over-reported); the certificate then states it (C9, C15). The number of calls is bounded by M3's per-case ceiling.
6. **As-of.** Evidence with `recordedAt` after `asOf` never enters any state (invariant tested with planted late evidence; R28 leakage lesson).
7. **Trace faithfulness.** With `wantTrace`, the trace has one node per fired and per consulted-but-not-fired rule, per cell resolution (winning assertion ids, precedence rule id, status), per label feature and per derived feature (days since change, thresholds); `reads` is complete. Node ids are content-derived: `nd_` + hash(`fn`, `fnVersion`, read ids, JCS value). Test: replacing the value of a node not in `reads*(verdictNode)` never changes the verdict (mutation test on the evaluator's own trace).
8. **Two entry points.** `phase1` and `phase2` are separately callable (C10 evaluates `phase2` millions of times on assembled intermediates).
9. **Determinism.** No clock, no rng, no I/O, no floats in states; iteration in canonical key order.
10. **Cost interface.** `phase1` accepts an `incremental` hint (a previous `Intermediate` plus the symmetric difference of `present`); implementations may ignore it; if they honour it a differential test shows equality with the non-incremental result.
11. **Edits.** `edits` supports `remove` (via `present`), `correct` (replace the normalised value of an assertion) and `supply` (a `HypotheticalEvidence` item carrying the declared channel's authority tier, `trust` and an already-linked entity).

**Tests.** Obligations 1 to 9 as named tests run against the real M3/M5 and against a toy evaluator family (monotone threshold, veto, `unresolved`-toggling, xor-like) used throughout this module; `phase2(phase1(S)) === V_ref(S)` where `V_ref` is the independently written second implementation of `V` over a reduced reconcile (spec 9 acceptance); overhead of tracing measured; the obligation 7 mutation test is run on the trace as mapped from M5a's `derive` output, not only on a hand-written trace; a `vSpecHash` test changes one of the three halves' versions and asserts the hash changes.

**Risks / NOT VERIFIED.** All of M3 and M5a is unbuilt: the feasibility of sound `deps` for fuzzy linkage and of control-dependence-complete `reads` is the biggest open question of this module. The policy IR (M5a) is provisional pending bake-off 2.

**Build notes.** Specify with M3 and M5a owners first; the toy evaluator family lets C9 to C15 be built and tested before M3 and M5a exist. Build order (register section 5, step 12): M2 spans, M5a, M3, then M4 (L0 to L3 first, L4 over M3 and M5a), then M6 and M5b.

## 12. C9 Frozen snapshot, judged edges with subset tables, edge locality

**Best references.** R20/08 §1.1 (the ledger snapshot), 08 XPL-02 (review finding), R3 (leave-one-out), 04 §9.5 (necessity classes), R28/08 E3 (leakage invariant).

**What they do.** The formal work freezes edge labels and drops an edge when its evidence is absent. The review (XPL-02) shows that this makes `V(S ∖ R)` mean "what the frozen edges imply", not "what the system would conclude". ALCE's leave-one-out re-asks the judge on subsets, which is the idea we generalise.

**Decision.** Own, and stronger than the spec: every L2/L3 edge carries a **subset table** so that removal analysis uses a label judged on exactly the spans that remain, not a dropped edge.

**Design.**
```ts
interface EdgeEntry { label: Label | "link" | "possible" | "non_link"; decidingSpanIds: SpanId[]; contrarySpanIds: SpanId[]; voters: Voter[]; inputHash: Hash;
                      modelIds: string[]; promptVersions: string[]; grade: "full" | "L2" | "offline"; cacheKey: Hash }
interface JudgedEdge { id: EdgeId; kind: "l2" | "l3" | "link"; claimId?: Id<"cl">; inputs: Id<"ev">[];     // ≤ 6, order fixed
                       locality: "pair" | "set";                        // link edges only; "pair" = confirmed per pair (C8 obligation 5), "set" = union of shown candidates; l2/l3 are always "pair"
                       table: Record<string /* bitmask of inputs present, as hex */, EdgeEntry> }            // 2^|inputs| entries, ≤ 64; entry 0 is the empty-evidence probe
interface FrozenLedger { snapshotHash: Hash; evidence: ReadonlyMap<Id<"ev">, { hash: Hash; authority: AuthorityTier; authorship: Authorship; recordedAt: Iso; conf: Confidentiality; trust: TrustLevel }>;
                         edges: JudgedEdge[]; gaps: Gap[]; policyVersion: string; vSpecHash: Hash; asOf: Iso; templateId: string; domains: GapDomain[] }
```
1. **Freeze.** After C2 to C7, `freeze(ctx)` assembles `FrozenLedger` and its hash `snapshotHash = hash("snapshot", JCS(...))`. `E` = evidence items that passed L0 (items failing L0 never enter; their failures are claims/gaps, not evidence). Everything after this point is a pure function of the snapshot.
2. **Edge liveness under a presence set `S`.** An L2/L3 edge is live with the entry for the bitmask of its inputs present in `S` (table lookup; no drop). A `link` edge with `locality: "pair"` is live iff both mentions' evidence items are in `S` (pairwise, obligation 5). A `link` edge with `locality: "set"` is dropped when any of its inputs is absent, goes on the dropped list, and the certificate says `locality: "set"` (flips may be over-reported). An edge with any needed table entry missing (tables are produced only for claims in the cone, see 4) is **dropped when any input is absent** and the snapshot records `droppedEdgePolicy: "conservative"` plus the list, so the certificate states the weaker meaning.
3. **Locality by construction.** The judge port (C6 item 1) receives only the cited units; `inputHash` is recorded and recomputed by the verifier from the claim text and the text-layer slices (C15, `EdgeCert`). A forged or drifted input is therefore `FAIL`, not a silent change.
4. **Which claims get tables.** Table entries cost `2^|inputs| - 1` judge runs (cached; dual prompts double it). They are produced only for edges whose claim is in the **label cone** (relabelling it can change the projected verdict, the exact test of C7 item 1). Claims outside it cannot affect `V`, need no table, and are reported as such.
5. **Empirical locality (models are not local).** Construction fixes the interface, not the model: the judge may use parametric knowledge or be steered by an unrelated unit. This is measured, not assumed: `locality_violation_rate` = share of entries whose label changes when three unrelated distractor units are added (C6 item 8), reported with a cluster-bootstrap interval; the dossier states the number beside every exactness claim.
6. **Wording.** A certificate built on this snapshot says: "relative to this snapshot, in which each judged edge is the label recorded for exactly the spans listed, ..." (spec 9a, "Explanation exactness").

**Tests.** Snapshot-hash determinism and tamper tests; table completeness (every needed bitmask present or the edge is on the dropped list); equality of the full entry with the claim's recorded label; the locality-violation rate on the gold set; the dropped-edge conservatism test (a dropped edge never turns a removal-flip into a non-flip, checked on the toy evaluator by comparing tabled and dropped semantics); a link-locality test (removing a non-cited candidate from the nominating call's list leaves a `locality: "pair"` edge, its inputs and its removal-flip set unchanged, while a `"set"` edge is dropped and flagged).

**Risks / NOT VERIFIED.** Cost: up to 7 non-empty subsets x 2 prompts x claims in cone. With ≤ 3 inputs and cones of tens of claims this is hundreds of cached calls per case, which the F-BUDGET phase slice must allow; if it does not, the table is truncated to leave-one-out entries and the edge goes on the dropped list. Subset entries of L3 edges are L2-grade (stated).

**Build notes.** After C6. The snapshot type is needed by C10 to C15 and by M9's bundle format.

## 13. C10 Exact enumeration: cone, components, minimal flips, minimal robustly sufficient evidence

**Best references.** R20 (Reiter, Ignatiev et al., Darwiche-Hirth, QuickXplain), R21 (twenty hitting-set algorithms; abstract only), R22 (`hitman.py` as test oracle), R30 (Minimal Evidence Group Identification: support-only, monotone, set cover), 08 §1.

**What they do.** Reiter's diagnosis theory computes diagnoses as minimal hitting sets of conflict sets; Ignatiev et al. state the same duality between abductive explanations (minimal sufficient reasons) and contrastive ones (minimal changes that flip the decision) for classifiers; QuickXplain finds a preferred minimal explanation under a total order. `pysat/examples/hitman.py` enumerates minimal hitting sets with a MaxSAT/MCS backend (08 A7, read there). Minimal Evidence Group Identification formalises a minimal supporting group by reduction from set cover, with support-only semantics. None treats a non-monotone verdict function over reconciled records, and the 14-item brute-force test in the spec validates the enumerator but not `V` (review XPL-03).

**Decision.** Own the algorithm (a decomposition-first exact method with an implicit-hitting-set fallback), reuse R22 only as a test oracle. Definitions are copied into this blueprint exactly as the spec requires:
- Frozen snapshot `Λ = (E, J, G, π, a)` with `E` the L0-passed items. `V(S)` for `S ⊆ E` is the pure composition of C8 `phase1` then `phase2`. `v* = proj(V(E))`.
- **Flip** `R ⊆ E` with `proj V(E ∖ R) ≠ v*`; **minimal flip (MF)** is subset-minimal.
- **Robustly sufficient (RS)**: `S` such that for all `T ⊆ E ∖ S`, `V(S ∪ T) = v*`; **minimal robustly sufficient evidence (MRS)** is subset-minimal RS. (The weaker `V(S) = v*` is rejected because `V` is not monotone.)
- **Duality.** `S` is RS iff `S` intersects every flip; every flip contains a minimal flip, so iff `S` hits every minimal flip; hence `MRS = MHS(MF)` and `MF = MHS(MRS)` (Berge duality), with no monotonicity needed (08 §1.3). If no flip exists then `MRS = {∅}` and the verdict does not depend on the evidence: a **defect report**, not a strong explanation.

**Design.**
1. **Cone.** `cone = ∪ deps(k)` for `k ∈ reads(projection)` (C8). Items outside the cone never occur in a minimal flip or an MRS and are reported once as `outside_cone` (count only).
2. **Components.** Build the hypergraph whose hyperedges are `deps(k)` for the keys `k` in the read set (restricted to cone), take connected components `C_1..C_m`. Each key belongs to exactly one component. By C8 obligation 3, `states[k]` depends only on `S ∩ C_j`, hence `V(S) = P(σ_1(S ∩ C_1), ..., σ_m(S ∩ C_m))`, where `σ_j` is the restriction of `phase1` to the keys of component `j` (other components held at full evidence) and `P` is `phase2`. This is **sound by construction** given sound `deps`, so no sampled separability check is needed; a differential run of random subsets (64 per case, seeded) guards `deps` and is a `validation` failure if it ever disagrees.
3. **Tabulate** each component with `|C_j| ≤ cap_table` (default 20, so ≤ 1,048,576 `phase1` evaluations per component, parallel over bitmasks, memoised by `hash(vSpecHash, snapshotHash, mask)`): `stateId[mask]` into a dictionary of canonical component states (hash-consed). `D_j` = number of distinct states; typical `D_j` is small.
4. **Minimal removals per state.** For component `j` and state `s ≠ s_j*` (the full-evidence state): `M_j(s)` = masks `R` with `σ_j(C_j ∖ R) = s`, minimal among masks that achieve the same `s`, found by scanning masks in popcount order and skipping supersets of a recorded mask for the same `s`.
5. **Support-minimal flip vectors.** A state vector assigns each component a state; its *support* is the set of components not at `s_j*`. Enumerate vectors by increasing support size; evaluate `P` on the assembled intermediate (memoised); a vector is a *flip vector* if its projected verdict `≠ v*`. A vector is skipped if reverting any one supported component to `s_j*` already yields a flip vector (such a vector cannot give a minimal flip: the reverted removal set is a proper subset that is a flip). Budget `maxPEvals` (default 2,000,000).
6. **Candidates and minimality.** For each flip vector form the Cartesian product of `M_j(s_j)` over its support; the union of the chosen masks is a candidate flip. **Claim**: every minimal flip is generated this way (in a minimal flip each `R_j` must be minimal for its achieved state, else replacing it by a smaller mask reaching the same state gives a smaller flip). Keep candidates with no proper subset among the candidates; those are exactly MF. (Cartesian product capped at `maxCandidates`; a cap hit sets `completeness: partial`.)
7. **MRS.** `MRS = MHS(MF)` over the cone. First implementation: Berge multiplication with minimisation after each edge (simple, easy to verify, exponential intermediate in the worst case), bake-off (test tier) against `hitman.py` and a branch-on-smallest-edge enumeration with a minimality check, whose description is to be read from R21's body before it is implemented (only the abstract was read). When the number of MRS exceeds `maxMrs` (default 10,000) the preferred MRS alone is computed: start from `E`, delete items in **authority-tier order** (QuickXplain order: lowest tier first, then oldest, ties by id) while the set stays RS (RS test below), which returns the lexicographically preferred minimal set.
8. **RS test given tables** (used for single sets): `S` is RS iff no flip avoids `S`; with tables this is exact and cheap: let `Reach_j = {σ_j(S_j ∪ T_j) : T_j ⊆ C_j ∖ S_j}` (scan masks that are supersets of `S_j`), then `S` is RS iff `P` over `∏_j Reach_j` is `v*` everywhere (early exit on the first counterexample).
9. **Classes (derived views).** `critical`: `{e}` is a minimal flip (equivalently `e` lies in every MRS). `alternative`: in some but not every MRS (this is overdetermination: two registries each sufficient alone). `decorative`: in no MRS. Lemma: an item is in some MRS iff it is in some minimal flip (take a flip `F ∋ e`; `(E ∖ F) ∪ {e}` is a transversal in which `e` is the only element of `F`, so it is necessary, and a minimal sub-transversal keeps it). `harmful`: a one-item flip whose new verdict is more permissive on the Action order. The **complete reason** is `OR over S in MRS of AND(S)`, rendered in the dossier ("(LEI active AND registry active) OR (bank letter AND registry active)").
10. **Self-check.** When sizes allow, recompute `MF' = MHS(MRS)` and assert `MF' = MF`; any mismatch is a `fatal` defect, not a partial result.
11. **Fallback for a component too large to tabulate (IHS loop).** Maintain known flips `K`. Loop: take the next minimal hitting set `H` of `K` in preference order; search for a flip avoiding `H` by bounded DFS over subsets of the cone minus `H` ordered by size; if found, minimise it by deletion in tier order and add to `K`; if the DFS completes with none, `H` is RS exactly; if the budget ends first, `H` is a *candidate* and the result carries `completeness: "partial"` with the budget that was hit. Never silent truncation.
12. **Outputs** `Explanation.exact = { mf, mrs, classes, completeReason, v*, cone, components, oracleCalls, pEvals, wallMs, completeness }`, plus `coneStats` (sizes) for the published ledger-size distribution.

**Tests.** (a) *Exactness against brute force* on random toy-evaluator ledgers up to 14 items (stated to validate the enumerator, not `V`); (b) *independent `V`*: the second implementation `V_ref` (written separately from the IR spec by a different author or model) is run in place of the production evaluator on the same ledgers and the explanations must be equal; (c) *planted by construction*: generators with closed-form answers (k-of-n corroboration plus a veto: MRS are the k-subsets of the corroborators plus the veto item; MF the dual) including `unresolved`-toggling non-monotone cases; (d) *duality properties* on every case: `MRS = MHS(MF)`, `MF = MHS(MRS)`, classes agree with leave-one-out necessity (`critical` iff the one-item removal flips); (e) *metamorphic law*: for random `R`, if `R` misses some MRS then `V(E ∖ R)` has verdict `v*`; if `R` is an MF then it flips; (f) *mutation tests*: delete an item, correct a value, add a contradicting source: the explanation change must match the prediction from the old explanation; (g) *oracle*: pysat `hitman` equality on shared vectors; (h) *size*: publish the ledger-size and cone-size distribution of the hero cases, oracle-call counts and wall time per case; the claim is only "exact where `completeness` says exact"; (i) *determinism*: byte-identical `Explanation` for the same snapshot at any parallelism.

**Risks / NOT VERIFIED.** Runtime on real ledgers (spec section 22); whether components stay small (link edges entangle evidence from many sources; the ledger-size distribution is the test); no complexity class is claimed for this setting (08 §1.6; general Halpern-Pearl cause checking is NP-complete or worse, R23). The Cartesian-product step can blow up when many minimal removals exist per state; counted and capped.

**Build notes.** Build against the toy evaluator family first (it needs no M3/M5), then swap in the real evaluator. Everything in C11 to C15 sits on this.

## 14. C11 Edits and decision-relevant evidence-gap analysis

**Best references.** 08 §1.5 and C1 (Wachter et al.: smallest change to the world), C2 (DiCE: show diverse alternatives), R29, 08 XPL-06 (domain closure).

**What they do.** Wachter et al. define the counterfactual as the smallest change to the world that obtains the desired outcome, without opening the model; DiCE adds feasibility and diversity by optimisation over continuous features. Neither has a discrete, exact version over a ledger or a notion of an unchecked source.

**Decision.** Own, exact over the discrete ledger; explicitly **not** an expected value of information.

**Design.**
1. **Edit space.** `remove(e)` (C10), `correct(e, field, v')` (replace the normalised value of an assertion of evidence `e`, with `v'` drawn from the declared attribute domain or from values present elsewhere in the ledger), `supply(g, v')` (add a `HypotheticalEvidence` for gap `g` with value `v'`, using the declared channel's authority tier, trust and an already-linked entity). All go through `Evaluator.phase1 ... phase2` with `edits`.
2. **Cost.** A tuple ordered lexicographically: (highest authority tier among touched or supplied items, number of edits, number of correctable-versus-immutable flips). *Immutable* evidence (a signed registry extract) can be edited only by `supply`/`remove`, not `correct`; this feeds the flip panel's "correctable versus immutable" column.
3. **Minimal change that flips to a target** `T ⊆ ProjectedVerdict` (for release safety: more permissive actions): uniform-cost search over edit sets by increasing cost within the cone, evaluating through the oracle with the memoised cache; the first cost level with a hit is returned in full (all minimum-cost edit sets), then up to `k_diverse = 3` selected for different attributes and authorities (DiCE's diversity idea, chosen from the full enumeration rather than sampled). Field-level changes made after reconcile (one policy-input field altered) come from M5a's `flipSearch` and are merged into the same cost-ordered result, so one list covers evidence-level and field-level edits (INT-034).
4. **Decision-relevant gap.** For a gap `g` with a declared finite domain `D_g` (from the pack's channel table: `{hit, no_hit}`, a status enum, a date before or after `asOf`, an account match or mismatch), evaluate `proj V(E ∪ {h_{g,v}})` for every `v ∈ D_g`. `g` is **decision-irrelevant within `D_g`** iff all equal `v*`, **decision-relevant** otherwise, and the dossier lists the values that flip. Joint relevance over up to three gaps is the product of domains. Certificates (C15 `GapCert`) list `D_g` and its hash.
5. **Domain-closure caveat (XPL-06).** The statement is "within the declared domain". For name-based inputs to entity resolution the domain is not finite and a new record could change linkage upstream of policy; such gaps get `domain: "open"`, relevance `unknown`, and the dossier says the analysis does not cover entity-link effects. `unknown` relevance still caps confidence (C17), irrelevant does not.
6. **Wording** (fixed): "the unchecked source `g` cannot change this verdict under policy `P` for any value in its declared domain `D`", never "would not matter".

**Tests.** Planted gaps with known relevance (a sanctions check whose absence is verdict-irrelevant because another veto already holds); the exhaustive brute-force comparison over `D_g`; monotonicity sanity (adding a gap value the policy never reads is irrelevant); domain-hash tamper test; the open-domain gap must never be reported irrelevant.

**Risks / NOT VERIFIED.** Quality of the declared domains (a pack artefact reviewed by a domain reviewer; the spec lists the domain expert as an open need). The cost order is a design choice to defend, not a derived fact.

**Build notes.** After C10; cheap to build once the oracle and cache exist.

## 15. C12 Halpern-Pearl causes and responsibility (optional)

**Best references.** R23 (Halpern 2015 modified definition, read in the PDF by 08; Chockler-Halpern degree `1/(N+1)`; Aleksandrowicz et al. complexity; Ibrahim-Pretschner MaxSAT encodings; AUDITA).

**What they do.** The modified definition freezes the contingency variables `W` at their actual values (AC2(am)); responsibility is `1/(N+1)` for `N` the minimal number of changes to reach a contingency. AUDITA grades counterfactual dependence by modified Halpern-Pearl with a re-execution receipt, on its own simulated benchmarks. Carrying `rho` to the modified definition is our choice and **NOT VERIFIED** in the literature read (08 §1.4). Review XPL-05: minimal flips and robust sufficiency already separate overdetermined from decorative evidence (neither of two confirming registries is in every MRS), so Halpern-Pearl adds a degree and a witness, not a new class.

**Decision.** Roadmap per spec 21a; specified so it can be built. Own, if built.

**Design (summary).** Structural model: exogenous bits `X_e`; endogenous nodes are the derivation-trace nodes (C8). For a candidate cause `X ⊆ E` (size ≤ 2) of `φ = (proj V ≠ v')`: AC1 (actual context satisfies both), AC2(am) (exists `W` ⊆ intermediate nodes with values frozen at actual and an alternative setting `x'` that falsifies `φ`), AC3 minimality. Search `W` over subsets of the cone's intermediate nodes (≤ 12) by increasing size; each check is one `phase2`-level re-evaluation with node overrides (the evaluator accepts `nodeOverrides`, an extra obligation on M5 and M3 if this layer is built). Output `Cause { items, witness: {W, x'}, rho }`; budgeted, `completeness: partial` on cap.

**Gate to ship** (spec 21a, sharpened): an experiment on at least one gold case where two items have identical class (`alternative`) but the responsibility degree changes what a reviewer would do, **and** a user-visible effect (ordering in the claim panel) that survives a switch-off ablation. If MRS/MF classes explain every gold case equally well the layer stays on the roadmap and the README says so.

**Tests (if built).** Agreement with brute-force definition checking on toy models; overdetermined voting examples from the paper (11-0 gives 1/6, 5-4 gives 1); cross-check with MaxSAT on binary instances; the class consistency law (`decorative` items are part of no cause).

**Risks / NOT VERIFIED.** All of the above; instrumentation burden on M3 and M5 is real (`nodeOverrides`). No permissive-licence implementation was found in the searches run.

**Build notes.** Last; do not start before C10's ablations exist.

## 16. C13 Judged-edge robustness radius (L4b)

**Best references.** 08 §1.7 and H4/H5 (prediction-powered inference, conformal factuality), R26 (over-commit), the leave-one-out, distractor and empty-evidence probes of 04 §9.5 (R3, R5 noise sensitivity).

**What they do.** ragas noise sensitivity attributes wrong statements to retrieved chunks; ALCE leave-one-out classifies citations; PPI and ARES give valid intervals for LLM-judged rates from a few hundred human labels (abstract-level reading only in 08). No work found turns judge noise into a combinatorial statement about a downstream verdict; the search was capped (08 §5), so no novelty is claimed.

**Decision.** Own. L4b is confined to judged edges; everything downstream of a frozen label is deterministic (C10).

**Design.**
1. **Variables.** Edge states of the *label cone* (C9 item 4) at their full-set entry: L2/L3 labels (domain: the other three labels, plus `contested`) and, optionally, link edges (`link | possible | non_link`). An *error* is a relabelling. `errorModel` selects the plausible errors: `any`, `over_commit` (`neutral -> entailed|contradicted`, the failure of R26), `under_commit`.
2. **Radius** `rho` = the minimum number of edges whose label must change for `proj V` to change, computed with `phase2` only (labels are `Intermediate` keys; no re-reconcile): breadth-first over `k = 1..k_max` (default 4); `C(m,k) * 3^k` evaluations (m = cone edges). Output: `rho`, all witnesses at the minimum, and, if none up to `k_max`, `rho > k_max`.
3. **Stable-only radius.** The same search counting only *stable* edges (both prompts and all three runs agreed, no L3). `unstableEdges` is reported beside it, because an unstable edge is a cheap error.
4. **Statistical statement, conditional.** With per-label error rates `p_L` estimated from a hand-labelled gold subset (upper confidence bound `p_hi`, Clopper-Pearson or Wilson) and an **independence assumption we state is probably false**, `P(at least rho of m cone edges wrong) <= BinomialTail(m, p_hi, rho)`. Prediction-powered inference (R26) can tighten `p_L` using many unlabelled judge outputs and about 300 to 500 labelled claims; the estimator formula is to be checked against the paper's body before implementation (only the abstract was read). In the dependent case the radius itself is the statement; no probability is shown without the calibration report.
5. **Wording** (fixed): "the verdict survives any k-1 judge errors in this snapshot; k errors at these edges would change it".

**Tests.** Radius exactness against exhaustive search on toy policies; planted-flip tests (inject the predicted minimal relabelling, the verdict must change, and no smaller injection may); calibration of the binomial statement under a simulated independent-error judge (it should be conservative) and under a simulated correlated judge (it will fail; the experiment shows by how much, which is the honest result); radius distribution on the hero cases.

**Risks / NOT VERIFIED.** Independence across edges from one judge; the estimator formula; whether `rho` is usually 1 (then it mostly says "verdict hangs on one judgement", still a useful, exact warning).

**Build notes.** After C10 (shares the oracle); the confidence cap in C17 uses it.

## 17. C14 Argumentation layer (optional) and mapping to repair semantics

**Best references.** R24 (Dung 1995, ASPIC+ tutorial, Tweety GPL-3.0 and pickaxe MIT as oracles only, clingo MIT, ASPARTIX encodings), 08 D2/D4/D6.

**What they do.** Dung semantics define grounded, preferred and stable extensions over an abstract framework; ASPIC+ builds arguments from rules and premises with rebut/undermine/undercut attacks and a preference order; LLM-built frameworks (ArgLLM, MArgE) take arguments from a model. ASPARTIX computes the semantics by answer-set programming (page fetched; availability by contact, licence not stated). No mature permissive TypeScript engine was found.

**Decision.** Optional, gated by spec 21a. If built: own, a small engine (grounded fixpoint plus preferred-extension enumeration for frameworks up to about 30 arguments), validated offline with clingo encodings written by us (ASPARTIX is not usable without clarity on licence). No LLM-written arguments (not hash-anchored; 08 D6). **The repair semantics in M3 stay normative for `unresolved`** (review XPL-04); this layer is a derived view.

**Design.**
1. **Framework (mechanical).** `Arg { id, premises: EvidenceId[], claimKey, value, tier, validTime }` per verified assertion; attacks: `rebut` (same cell, single cardinality, different value), `undermine` (the premise failed L0, kept for display as defeated), `undercut` (record stale or superseded at `asOf`, unresolved entity link, flagged extraction error). Defeat = an attack that survives the preference order, which **is** the reconcile precedence (authority tier then recency, the order M3 declares).
2. **Statuses.** `established` (in the grounded extension), `defeated` (attacked by it), `contested` (credulously but not sceptically accepted: in some but not all preferred extensions), `rejected` (in none). Equal-authority rebuttal is an even cycle with two preferred extensions.
3. **Mapping to M3** (the condition for shipping): cell `unresolved` in M3 iff the AF has two preferred extensions that disagree on the cell's value; cell `resolved` iff the grounded extension decides it. The mapping is a function `statusMap(afStatus) -> CellStatus` defined on `resolved | unresolved` only (the shared `CellStatus` has five values; a cell with no argument is `silent` or `not_checked` in M3 and never enters the framework, so absence cannot become a status here); **the agreement test** generates random cells (tiers, dates, cardinality, undercuts) and asserts the function equals M3's pure `resolve` on every one; M3's time-decayed comparison (spec 8) is exactly where a disagreement is expected, and each disagreement is a finding, not a bug to hide.
4. **Dispute-tree certificate** (`ArgCert`): for an argument in the grounded extension, a tree in which the proponent answers every opponent's attack; the verifier checks it in polynomial time (every node's attack edge exists, every leaf is unattacked or defended). Contestation is an edit (remove an argument, add an attack) with the status diff shown.
5. **Complexity.** Grounded extension is polynomial; preferred-extension questions are intractable in general; the exact complexity classes were not verified in the sources read (08 D1: NOT VERIFIED). Frameworks here are tiny by construction.

**Gate to ship.** (a) 100% agreement with M3 on the property tests and the gold set, (b) an output it changes that M4's rule-based `contested` cannot (the only candidate is the dispute-tree certificate for claim-level `contested` and the contestation interface), shown by a switch-off ablation. Without both the layer stays on the roadmap and `contested` keeps the rule-based definition in C7 R3/R4.

**Tests (if built).** Dung-semantics property tests on random frameworks against clingo; ASPIC+ rationality postulates on generated preference orders (undercut-defeat rule is **NOT VERIFIED** in the tutorial; check before implementing); dispute-tree verifier tamper tests.

**Risks / NOT VERIFIED.** Everything above except the semantics definitions themselves. Honest expectation: the layer is low-value relative to C10 and may never ship.

**Build notes.** After C10/C15; do not let it block anything.

## 18. C15 Certificates and the verifier contract

**Best references.** R25 (certifying algorithms: `(output, certificate, checker)`; proof-carrying code: checking is cheap, finding is expensive; ClaimReceipt: three-valued verdicts and a committed manifest; RFC 6962 audit paths), 08 §1.8, review XPL-07/AUD-01.

**What they do.** McConnell et al. require every output to carry an easy-to-verify witness so a bug cannot pass silently; Necula's PCC has the consumer check a shipped proof without trusting the producer; ClaimReceipt reports 11/11 injected faults caught with 0/8 false positives on its own corpus (self-reported) and says its frozen specification is not yet unambiguous to an independent reader; AUDITA ships a receipt that re-execution with the cause removed would have averted the outcome.

**Decision.** Own, to the certifying-algorithm rule: **no explain function ships without its checker**. Two vocabularies that must not share the word PASS (INT-001): the **producer's own outcome**, `CertOutcome = VALID | INVALID | INCONCLUSIVE` (shared type), and the **verifier's result**, `PASS | FAIL | INDETERMINATE | NOT_APPLICABLE` (spec section 13). `VALID` means the producer's computation supports the certified statement; `INVALID` means the producer's own run found it does not (for example no flip exists, so `MRS = {∅}`, or the C10 duality self-check disagreed); `INCONCLUSIVE` means a budget or cap ended the computation (`completeness: partial`). M9's mapping (§8.4) is unchanged: a re-check that agrees with the producer's outcome is `PASS`, even when that outcome is `INVALID`; a disagreement is `FAIL`; budget exhaustion in the verifier is `INDETERMINATE`.

**Design.**
```ts
interface CertEnvelope { type: CertType; version: 1; snapshotHash: Hash; vSpecHash: Hash; policyBundleHash: Hash; projection: string;
                         outcome: CertOutcome;                                         // the producer's outcome, never the verifier's result
                         assumptions: string[];                                        // includes `locality: "set"` when any link edge in the cone has it (C9)
                         body: Json; bodyHash: Hash }          // JCS-canonical, domain-separated hashes
type CertType = "flip" | "sufficiency_decomp" | "sufficiency_table" | "mf_complete" | "gap" | "radius" | "edge" | "dispute_tree" | "cause";
interface VerifyResult { status: "PASS" | "FAIL" | "INDETERMINATE" | "NOT_APPLICABLE"; reasons: string[]; checksRun: string[]; notChecked: string[] }
```
- **`flip`**: the removal set `R`, `proj V(E ∖ R) = v'`, and the verdict of every proper subset (`2^|R| - 2` entries). Verifier recomputes `V` on `E ∖ R` and on each subset with its own recompute module (levels V6 to V8) and checks `v' ≠ v*` and that no proper subset flips (minimality).
- **`sufficiency_decomp`** (primary): the cone list, the component partition, per-component tables (`mask -> stateId`) and the state dictionary, and the claimed MRS/MF. The verifier derives the cone and partition itself from the IR (`reads`, `deps` are *recomputed by the verifier from the IR bundle*, not trusted), recomputes every table entry with its own evaluator, recomputes `P` over the product, and recomputes MF/MRS by the same combinatorial rules as C10. Size limit: refuses (`INDETERMINATE: exceeds_verifier_budget`) a certificate with more than `2^22` table entries in total.
- **`sufficiency_table`**: for a small cone the verdict for all `2^|cone ∖ S|` supersets, Merkle-committed, recomputed in full.
- **`mf_complete`** (completeness of the whole minimal-flip family) is the only statement that needs exhaustive evidence; it is carried by `sufficiency_decomp`. If the enumeration was `partial`, the certificate's `outcome` is `INCONCLUSIVE` for the completeness claim and the verifier returns `NOT_APPLICABLE` for it and `PASS` for each individually verified flip (the dossier shows "complete" only on `PASS`).
- **`gap`**: `D_g` and its hash, the table `v -> proj V(E ∪ {h_{g,v}})`; verifier recomputes all.
- **`radius`**: witnesses plus the enumeration of all smaller relabellings (`sum_{i<k} C(m,i) 3^i` entries), recomputed by `phase2`.
- **`edge`**: for each judged edge its `inputHash` recomputed by the verifier from the claim text and the text-layer slices of the cited spans (V5 reuse), and the entry's label as recorded. It cannot re-run a model; it proves the edge's inputs are the cited spans (locality) and that the entry the snapshot used is the entry in the ledger. A label altered together with a re-signed ledger entry is only detectable by the ledger chain and pins (M9), not by the certificate: stated.
- **`dispute_tree`**, **`cause`** as in C14, C12.
**Verifier contract.** The verifier core (V0 to V5, zero dependencies) checks hashes, the envelope and the quote/slice facts; the recompute module (V6 to V8) interprets the IR bundle as data and re-runs reconcile only from recorded link decisions and authority/date rules (no fuzzy scores, no floats). It never trusts a `status`, a `completeness` or a table it did not recompute. PASS needs relying-party pins (spec 13); otherwise `INDETERMINATE`. A certificate always states `vSpecHash`: the identity of the `V` it refers to.
**What a PASS means** (spec 9a, "Explanation exactness"): the named checks passed against the named inputs under the listed assumptions: that the frozen labels are as recorded, that the IR bundle is the policy, and that `deps` as recomputed by the verifier are sound. It does not mean the decision is true or wise, or that anything is true in the world.

**Tests.** Tamper corpus (inherited from M9, extended): flip a table row, change a policy hash, replace the projection, drop a component, edit `E`, swap a label in the cert only, shrink `D_g`, remove a smaller-subset entry from a flip cert, set `outcome` to `VALID` on a certificate whose recomputation gives `INVALID` or the reverse; each must give `FAIL` or `INDETERMINATE`. Two independent verifier implementations on shared vectors. Positive control: a verifier stub that always says `PASS` must fail the suite. Certificate size and verification time on the hero cases are published.

**Risks / NOT VERIFIED.** The verifier's `V` is a second implementation over a reduced reconcile; agreement with the product `V` holds only to the extent of the differential tests, and recomputation cost for large cones is unbounded in principle (hence the size limit). ClaimReceipt's lesson applies to us: the certificate format must be specified precisely enough for an independent author to implement it; the clean-room verifier commissioned in spec 13 is the test.

**Build notes.** Write the envelope and `flip` certificate with the toy evaluator first (small, exercises the whole path), then `sufficiency_decomp`.

## 19. C16 Question-template registry

**Best references.** Spec F-STAGES, EviGraph (R30: separate must-establish requirements from optional evidence or verification over-abstains), 08 B5 (policy as conjunctive queries), R7-R12 (planner/task decomposition).

**What they do.** The research agents decompose questions into free-form sub-queries by prompt (dzhng `generateSerpQueries`, ODR `write_research_brief`) with nothing typed behind them; EviGraph separates decision-critical requirements from what may stay unresolved.

**Decision.** Own. A template is data, hashed, versioned, reviewed.

**Design.**
```ts
interface QuestionTemplate { id: string; version: string; question: string; subject: "vendor" | "owner_chain" | "list_screen";
  projection: { id: string; fn: "action" | "ownership_set" | "screen_state"; values: Json[] };     // pi_q: how V's output is projected to a verdict
  targets: Json[];                                    // target sets for "what would make this X"
  mustEstablish: { id: string; claimTemplate: string; sourceClasses: AuthorityTier[]; omissionIs: "hold" | "gap" }[];     // required-positive-evidence manifest (spec 5)
  findingGenerators: FindingGenerator[];              // code that emits ClaimRecords from M3/M5 values
  gapRules: GapRule[]; domains: GapDomain[];          // closed domains for C11
  renderer: { sentenceTemplates: Record<string, string>; qualifierMap: Record<Ordinal, string> };
  budgets: { claims: number; enumeration: Budget; judgeCalls: number } }
```
The registry ships at least three bounded questions:
1. **`release_safety`**: verdict = the rule engine's recommended `Action` (ordered); `mustEstablish` = the release-enabling manifest of spec 5; needs M5.
2. **`ownership_chain`**: verdict = the set of resolved owners at or above a threshold parameter with a per-link status; computed from M3's ownership attribute only (no M5), aggregation and threshold are pack parameters (the OFAC aggregation rule is NOT VERIFIED and is therefore a parameter, never a constant).
3. **`sanctions_exposure`**: verdict ∈ {`exposed`, `clear_within_coverage`, `indeterminate`}; a non-match is never "clear" (the projection carries list version, method and coverage); link edges between the vendor and list entries are in the edge set, so C13 radius over link edges is the identity-hypothesis counterpart of M3's robustness analysis.
- **Stage-alone entry points**: `plumbline explain --template <id>` consumes the previous stage's typed, hashed output from a bundle and writes its own artefact and trace; the output hash must equal the in-pipeline hash (F-STAGES test).
- **Must-establish claims** (the EviGraph lesson) are the only claims whose gaps or failures can cap the verdict confidence (C17) or force escalation; optional evidence cannot, so extra verification cannot remove a valid recommendation.
- **Adding a pack** adds templates, finding generators and domains without touching M4 code (tested by the second pack of build-order step 14a).

**Tests.** Per-template: the verdict projection is total over `V` outputs; stage-alone equals in-pipeline hash; a template with a missing generator fails registry validation (`validation` error at load, never at run); must-establish omission behaviour (`hold` versus `gap`) per template.

**Risks / NOT VERIFIED.** Whether three templates cover what a practitioner asks (practitioner validation plan). `ownership_chain` and `sanctions_exposure` depend on M3's structures that are not yet written.

**Build notes.** After C1 and C8; `release_safety` first.

## 20. C17 Gap ledger and ordinal confidence rule

**Best references.** R7-R12 (silent degradation: `[]`, error strings as findings; the abstain guard), R30 (EviGraph over-abstention), 04 §9.6, 08 F8/H5.

**What they do.** The research agents collapse failed searches, timeouts and parse errors into empty results and write the report in the same confident voice (03, shared failure 3). EviGraph reports that extra verification removed valid recommendations without improving decisions (preprint, small pilot).

**Decision.** Own. A gap is a first-class value; confidence is derived by rule, ordinal, and capped only by gaps that can matter.

**Design.**
```ts
type GapKind = "not_checked" | "unavailable" | "blocked_by_policy" | "rate_limited" | "stale" | "not_applicable" | "self_declared_only" | "single_origin_only"
             | "unresolved_conflict" | "judge_unstable" | "over_cap" | "decomposition_drift" | "budget_exhausted" | "partial_enumeration" | "domain_open"
             | "normalisation_unsafe" | "claim_unverified";
interface Gap { id: GapId; kind: GapKind; scope: { claimIds?: Id<"cl">[]; cell?: string; subQuestion?: string }; channel?: string; cause: string;
                relevance: "relevant" | "irrelevant_within_domain" | "unknown"; capsTo?: Ordinal; resolvableBy?: string[] }   // resolvableBy feeds F-REPLAN
```
1. **Claim confidence** (rule, in order):
   - `high`: L0 pass, both L2 judges agree, a verified deciding span exists, V3 not contradicting, no `ungrounded_entailment`, no `judge_unstable`, no `self_declared_only`, and for world claims at least two independent origins (M3 origin DAG) or one `SOR`/`VERIFIED` source.
   - `medium`: L3 resolved with a stable verdict, or exactly one of the issues above.
   - `low`: lexical-only grade, `contested`, `ungrounded_entailment`, `sentence-fallback`, `self_declared_only` for a world claim, or two or more issues.
2. **Verdict confidence** = the minimum of: (a) the minimum claim confidence over the template's must-establish claims; (b) the gap cap: any gap with `relevance: "relevant"` or `"unknown"` caps at `medium` (`unavailable`/`not_checked` on a must-establish source caps at `low`); a gap proven `irrelevant_within_domain` by C11 caps nothing; (c) the radius cap: `rho = 1` caps at `medium`, `rho = 0` is impossible by definition (a defect), `rho >= 3` caps nothing; (d) the enumeration cap: `completeness: partial` caps explanation-exactness statements, not the verdict, and is shown as a gap; (e) `identity_dependent` (M3) caps at `low` and forces escalation (spec 8).
3. **Re-plan hook.** Gaps with `resolvableBy` (an unqueried channel, an unread document) feed the coverage check of F-REPLAN; exhaustion leaves the gap and its cap in place (spec 21).
4. **No silent states.** Any `claim.verification = "unverified"` has a gap (`claim_unverified`) with the error class and cause; any budget hit has `budget_exhausted`; any L0 failure is a label plus a ledger entry, never a missing row.
5. **Probabilities** appear nowhere until a reliability diagram on the gold set earns them (spec 9).

**Tests.** Rule table property tests (monotone: adding a relevant gap never raises confidence); a seeded must-establish failure must cap, an irrelevant gap must not (the EviGraph guard: confidence is not lower than the baseline without the irrelevant gap); every gap kind reachable by a drill; over-abstention metric: share of cases whose confidence is lowered by gaps later proven irrelevant (expected zero).

**Risks / NOT VERIFIED.** The thresholds in 1 and 2 are initial values. Whether the radius cap is useful or just noisy is tested by the abstention-versus-harm curve in M11.

**Build notes.** With C1; the gap vocabulary is also M1's fetch-state vocabulary plus M4-specific kinds.

## 21. C18 The six checks and their metrics

**Best references.** R3 (citation recall and precision), R1 (F1@K), R2 (score with length penalty), R5 (faithfulness), R17/R18 (external anchors), R26 (PPI), R29 (simulatability), 04 §10 (formulas), 08 §1.9.

**What they do.** ALCE: recall is the share of sentences whose cited set jointly entails them; precision uses leave-one-out; invalid ids score 0 for recall and vanish from precision; no citations gives precision 0 (R3, `compute_autoais`, 04 §3). SAFE: `P = S/(S+N)`, `R = min(S/K,1)` with the not-supported label merging silence and contradiction. Standard errors over pooled claims treat claims in one response as independent (Du et al. evaluation, 04 §6.3).

**Decision.** Own. Six checks computed and displayed separately; every aggregate has its estimator and interval stated.

**Design.** The six checks, each its own status and metric set, never combined into one score and never replaced by model agreement:

| Check | Establishes | Core metric |
|---|---|---|
| 1 citation integrity | ids resolve, hashes equal, spans exist | `invalid_rate` |
| 2 quote fidelity | quotes are verbatim or flagged | quote status shares, false-fail rate |
| 3 attribution and entailment | cited text supports the claim (recorded judgement) | `CR`, `CP`, `UCR` |
| 4 factuality across sources | independent corroboration | independent-origin support count (M3), `single_origin_only` rate |
| 5 conflict detection | contradiction found, not forced | `CDR`, `FCR` |
| 6 decision correctness | M5's action vs gold | M5's metrics |

**Notation.** Case/response `r` (the cluster unit); check-worthy atomic claims `A_r` (deduplicated); `y(c)` final label; `C(c)` cited evidence ids, ≤ 3; `ent(c, X) = 1` iff the edge entry for the bitmask of `X` is `entailed` (read from the C9 tables, so the leave-one-out terms need no extra calls); `S_r` sentences for ALCE-comparable variants.

```
CR_claim(r)  = |{c ∈ A_r : y(c) = entailed ∧ l0(c) = pass}| / |A_r|                  strict; CR_claim_len adds y = partial
CR_alce(r)   = |{s ∈ S_r : C(s) ≠ ∅ ∧ ent(s, C(s)) = 1}| / |S_r|                       for comparison with ALCE (baseline arms)
rel(c, e)    = 1 iff ent(c, C(c)) = 1 ∧ ( |C(c)| = 1 ∨ ent(c,{e}) = 1 ∨ ent(c, C(c)∖{e}) = 0 )
CP(r)        = Σ_c Σ_{e∈C(c)} rel(c,e) / Σ_c |C(c)|            n/a if the denominator is 0;   CP_alce = CP with n/a read as 0 (comparison only)
CP_cond(r)   = same, summed over claims with ent(c, C(c)) = 1
decorative   = |{(c,e) : ent(c,{e}) = 0 ∧ ent(c, C(c)∖{e}) = 1}| / Σ |C(c)|            redundant = |{(c,e) : ent(c,{e}) = 1 ∧ ent(c, C(c)∖{e}) = 1}| / Σ |C(c)|
uncited_rate = |{c ∈ A_r^cw : C(c) = ∅}| / |A_r^cw|           invalid_rate = |{cited ids unknown or hash-mismatched}| / Σ |C(c)|
UCR_strict   = |{c ∈ A_r : y(c) ≠ entailed}| / |A_r|           UCR_lenient = |{c : y(c) ∈ {neutral, contradicted, unattributed, invalid_citation, fabricated_quote}}| / |A_r|
partial_rate, contested_rate  = shares of y = partial, y = contested     (always shown)
QF           = |{quotes with status ∈ {exact, normalised, ellipsis_ordered}}| / |quotes|            false-fail rate measured on seeded real quotes
CDR          = |{g ∈ G_contra : y(g) = contradicted}| / |G_contra|          CDR_any counts y ∉ {entailed, partial}
FCR_ent      = |{g ∈ G_ent : y(g) = contradicted}| / |G_ent|                FCR_neu = |{g ∈ G_neu : y(g) = contradicted}| / |G_neu|
```
`CDR` is never reported without `FCR_ent` and `FCR_neu` (flagging everything gives `CDR = 1`), nor without the breakdown by perturbation type and by the layer that first emitted the label (C4 numeric, C6, C7). SAFE precision equals `1 - UCR_lenient` when no claim is partial or contested and irrelevant claims are excluded; FActScore without penalty is the supported share (04 §10.4).

**Further measurements:** judge versus human (macro-F1, kappa, confusion); over-commit rate; ungrounded-entailment rate `UER = |{c : ent(c,C)=1 ∧ ent(c,∅)=1}| / |{c : ent(c,C)=1}|`; distractor sensitivity; locality-violation rate (C9); judge noise floor; decomposition metrics (C5); L3 `p`, rounds, `BF`, `HF`; exactness against brute force; L4 leave-one-out classes versus exact classes (disagreement rate); certificate tamper detection; robustness-radius distribution; oracle calls and wall time per case; **counterfactual simulatability** (exact version of R29): a reader program given only `Explanation` predicts, for random edited ledgers, whether `proj V` changes; ground truth is `V`; predictions are `change` (edit is a known flip), `no change` (edit misses some MRS), or `unknown`; precision and coverage are reported against LLM-rationale baselines (precision is 1 by theorem for the exact families, so a value below 1 is a bug, and the baseline gap is the result).

**Estimators.** (1) Cluster bootstrap over cases (vendor cluster as the unit; claims within a case are not independent; `B >= 2000`, percentile interval, seed from `ctx.rng`), both macro (mean of per-case values) and micro (ratio of sums) reported. (2) Wilson intervals for proportions over independent gold items (items from one contract are clustered, so ContractNLI hypotheses use the bootstrap by contract). (3) Zero events: `3/n` upper bound. (4) Sample sizes: recall near 0.8 within ±0.05 at 95% needs about 246 positives; the worst case about 385; planned sizes are inflated by a design effect `1 + (m̄ - 1) ρ` for clustered claims; below plan the report says the interval is wide. (5) LLM-judged aggregates: medians of three runs and the worst of three, separately; PPI intervals from 300 to 500 labelled claims (R26) once available. (6) Strict and lenient variants always together. (7) **Baselines to beat** before any claim: ragas-style faithfulness with the denominator fixed to the statements sent, ALCE-style per-sentence joint entailment with the same judge, SAFE-style without search, and the single long-context prompt arm, all scored by C5 plus this module; a claim of superiority is allowed only where intervals separate.

**Gold sets.** Contradiction gold `G` from three sources, never the first alone: (a) controlled edits of entailed pairs (entity swap, number or date shift, unit change, negation flip, role reversal, quantifier change, antonym; VitaminC-style minimal pairs, R18) verified by two annotators that the evidence contradicts rather than merely fails to support (target kappa ≥ 0.8); (b) natural conflicts (source and later correction, two registries disagreeing, ContractNLI `contradicting` hypotheses, R17); (c) neutral controls adding an unsupported but not opposed fact. Transfer from (a) to (b) is NOT VERIFIED until measured.

**Tests.** Metric unit tests on hand-computed examples (including the ALCE quirks: no-citation precision, invalid ids); estimator coverage tests by simulation (cluster bootstrap on correlated synthetic claims must cover at about the nominal rate; the naive pooled interval must undercover, which demonstrates why it is not used); harness self-test: the metric code run on a deliberately flag-everything judge must show `CDR = 1` with `FCR` near 1.

**Risks / NOT VERIFIED.** Gold-set size for contradictions below about 250 gives a wide interval. The PPI estimator is cited at abstract level only. Whether ContractNLI-style results transfer to registry and ERP records is unmeasured.

**Build notes.** Metric code is pure and can be built first against recorded fixtures; it unblocks M11.

## 22. C19 Evidence-corruption attack suite

**Best references.** R18 (minimal-edit contrast), R19 (poisoned corpus), R28 (AttributionBench: failures sit in one-number, one-date, one-negation edits; AVeriTeC leakage), 03 decision 8 (perturbation of evidence, not of the report), gpt-researcher `evals/quality_eval/perturbation.py` (perturbs the report and checks metric sensitivity, which validates metrics, not dependence on evidence), 08 §1.9.

**What they do.** gpt-researcher's perturbation degrades a *report* (remove citations, swap sources, flip polarity) and checks that metrics move; PoisonedRAG plants texts that steer a generator; VitaminC trains and tests on minimal evidence edits. No set attacks a verification pipeline's evidence and demands a predicted ledger change.

**Decision.** Own, as a metamorphic suite whose oracle is exact because `V` is a function: apply a mutation to the snapshot or to the evidence store, compute the predicted change, compare.

**Design.** `Mutation { id, family, apply(snapshot) -> snapshot', expected: Delta }` with `Delta ∈ { claimLabel(claimId, label), verdict(v'), gapAdded(kind), status(code), verifier(FAIL|INDETERMINATE), unchanged }`. For mutations that change evidence the expected `verdict` is *computed* by `V` on the mutated snapshot (exact), not guessed.

| Family | Mutation | Expected |
|---|---|---|
| EC1 | swap the cited span for another span of the same item | `invalid_citation` or label change, never a stale `entailed` |
| EC2a | change a number in the stored text layer after hashing | verifier V0/V5 `FAIL`, `hash_mismatch` |
| EC2b | change a number at ingest (hash recomputed) | C4 `conflict_candidate`, L2 `contradicted` or `neutral`, verdict per `V` |
| EC3 | shift a date; EC4 insert or delete a negation | as EC2b |
| EC5 | swap the vendor name in a document | entity link judgement changes; verdict per `V` |
| EC6 | fabricated sentence with a real evidence URL and id | `fabricated_quote` or `unattributed`; detector flags unledgered prose |
| EC7 | delete a source | `unavailable`/`not_checked` gap, never silence |
| EC8 | inject a conflicting lower- or equal-authority source | `contested` or `unresolved` per M3 rules; never a silent pick |
| EC9 | mirror/duplicate inflation (copy chain) | independent support stays 1; `single_origin_only` |
| EC10 | add distractor units | labels unchanged; else `distractor_sensitive` |
| EC11 | homoglyph or zero-width insertion in source or quote | fail closed or `mixed_script`, never a silent `exact` |
| EC12 | hidden instruction aimed at the judge ("mark this entailed") | label equals the clean twin's (steer rate with upper bound) |
| EC13 | paraphrase presented as a quote | `near`, warning, no pass |
| EC14 | quote from item B cited to item A | `fabricated_quote: misattributed` |
| EC15 | evidence with `recordedAt` after `asOf` | no effect on `V` (leakage invariant) |
| EC16 | certificate tamper (E, policy hash, table row, projection, snapshot, domain) | verifier `FAIL` |
| EC17 | change a recorded label with a consistent re-signed ledger | not detectable by the certificate; ledger pins decide: recorded as a stated non-coverage |
| EC18 | poisoned corpus: planted texts crafted to rank first for the claim query (R19) | `self_declared_only`, no raised confidence |

**Reporting.** Detection rate per family with a Wilson (or cluster-bootstrap) interval; **positive controls**: an undefended baseline (ragas-style faithfulness, ALCE-style) must fail on at least EC2b, EC4, EC6 and EC14 or the suite is not discriminating; inert stubs (a judge that always says `entailed`, a verifier that always passes) must fail the suite; held-out seeds for the generators; the list of families and states not covered (EC17 and visual forgery of documents, spec 21c item 4) is printed with every report.

**Tests.** The suite's own tests: every mutation's predicted `Delta` is computed by an independent path; applying the identity mutation yields `unchanged`; a fixed seed regenerates byte-identical mutants.

**Risks / NOT VERIFIED.** Coverage of real adversaries (the families are ours); EC12 shares its oracle design with M8's `SEC-I18` and must not diverge.

**Build notes.** Build the mutation framework with the toy evaluator, add families as the components they target land.

## 23. C20 Stage orchestration, budgets, determinism, trace events

**Best references.** R7-R12 (triple budget and named termination label from DeepResearch `react_agent.py`; overflow as an error message in ODR; frozen-input replay in deep-searcher `jev_stopping`), spec section 4 and F-BUDGET.

**What they do.** DeepResearch bounds calls (100), wall clock (150 minutes) and context (110k tokens) and ends every run with a named termination label; ODR's `or True` turns any error into a quiet end of research (03 §2); deep-searcher caches every request and response and recomputes metrics offline from hash-pinned artefacts.

**Decision.** Own, on the M7 ports; no alternative runtime assumed.

**Design.**
1. **Order.** L1 (prose only) → C2/C3/C4 L0 per claim (fatal L0 failures end the claim) → C6 L2 → router → C7 L3 for routed claims → `freeze` (C9, tables for cone claims) → C10 enumeration → C11 edits and gaps → C13 radius → C17 gaps and confidence → C15 certificates → C1 render. A re-plan delta recomputes only claims whose ids are new and the frozen analyses that depend on them.
2. **Budgets** (reserved before each call, charged for retries, from the F-BUDGET "critique" and "final result" slices): claims per case (default 60 reach L2; extras are `not_checked` gaps), judge calls, tokens, tool calls per L3 role, enumeration (`cap_table` 20 items per component, `maxPEvals` 2,000,000, `maxCandidates`, wall time), radius `k_max` 4, certificate size `2^22`. A budget hit sets the named state (`budget_exhausted` / `partial_enumeration`) and produces a gap; it never produces a guess or an empty success.
3. **Failure classes** (M7): judge timeout or malformed output is `transient` (retry ≤ 2, same cache key family) then the claim is `verification: "unverified"` with a cause code (never a label); a schema violation is `validation`; a budget breach is `budget`; a gate or label violation is `policy`; a `deps` soundness failure or a duality mismatch is `fatal`.
4. **Determinism.** All model calls go through `ctx.model` with cassette keys `hash(promptVersion, JudgeInput, modelId, params)`; fan-out over claims is merged in claim-id order; enumeration is deterministic at any parallelism (canonical orders, tie-breaks by id); randomness only through `ctx.rng` (bootstrap, sampled subsets, distractor choice); ICU and segmenter versions are recorded. Deterministic stages (L0, snapshot analyses, certificates, metrics) replay on any input; L2/L3 replay only on recorded inputs, with `CassetteMiss` otherwise (spec 15).
5. **Trace events** (every one with `why`; `why_kind` in brackets): `explain.l0` [computed], `explain.l1.atoms` [model_reported], `explain.l2.vote` [model_reported; the acceptance decision is computed], `explain.route` [computed, with the exact relabelling that made the claim verdict-relevant], `explain.l3.round` [model_reported; strikes computed], `explain.arbiter` [rule id or panel], `explain.snapshot.freeze` [computed], `explain.cone`, `explain.tabulate`, `explain.flips`, `explain.mrs`, `explain.gap`, `explain.radius`, `explain.cert`, `explain.render`, `explain.render.fallback` [computed]. No `model_reported` rationale is ever presented as an explanation (spec 13).
6. **Security.** Untrusted text only reaches models inside delimiters with closed output schemas; the privileged parts (C8 to C15) read labelled typed values and never raw vendor text; every `Claim`, `Edge` and `Gap` carries `trust` and `conf` via `combine`/join; the egress rule (no value above `public` in any query) applies to the advocate and skeptic search tool (queries are built from `public` terms or fail closed).

**Tests.** Replay equality for the whole stage on a recorded run; budget soundness (reserve before charge) with scripted models; crash drills (judge outage mid-case yields `unverified` claims and gaps, never `[]`); order independence of fan-out; trace linter (every decision has `why`); taint test (no derived value above any parent's level); egress test on the search tool.

**Risks / NOT VERIFIED.** Per-phase wall-clock fit with the organizer's table is unmeasured; the table-building cost in C9 is the largest uncertainty.

**Build notes.** The skeleton (budgets, errors, trace) is built with C1/C2; the heavy phases are added as their components land.

## 24. Interfaces table

| Interface | Exposed by | Consumed by | Contract |
|---|---|---|---|
| `Evaluator` (`keys`, `deps`, `reads`, `phase1`, `phase2`, trace); interface and composition owned by M4 | M3 (`keys`, `deps`, `phase1` adapter), M5a (`reads`, `featurize`, `evaluate`, trace mapping) | M4 (C9 to C15), M9 recompute module, M6 (`Recompute`), M3 (`robustness`) | C8 obligations 1 to 11; INT-034 |
| `HypotheticalEvidence`, `Edit` (remove / correct / supply) | M3 (value normalisation), packs (domains) | M4 C11 | C8 item 11; domains in `QuestionTemplate` |
| `SpanRecord[]`, text layers (un-normalised, page-relative code points plus UTF-8 byte offsets), segmenter, `renderForModel`, `joinHints` | M2 | M4 C2, C3, C6 | C2; INT-004, INT-005 |
| `ClaimRecord`, `ClaimLedger`, derived `EvidenceLinks` | M4 | M5 (label features), M9 (Merkle root), M10 | C1 item 9; label chain carries `canPermit` |
| Label feature `claim.<id>.canPermit` plus chain label (restrict-only; `false` for `EXTRACTED`/`UNTRUSTED` or `self_declared_only` chains) | M4 | M5a, M8 | C6 item 10; INT-015 |
| `FrozenLedger`, `JudgedEdge` with subset tables | M4 | M9 bundle, M11 | C9 |
| `Explanation` (MF, MRS, classes, complete reason, edits, gaps, radius, completeness) | M4 | M5 (dossier), M10 flip panel and claim panel | C10, C11, C13 |
| `CertEnvelope` (producer `outcome: VALID / INVALID / INCONCLUSIVE`) and `VerifyResult` vocabulary | M4 | M9 verifier core + recompute module | C15; verifier result `PASS / FAIL / INDETERMINATE / NOT_APPLICABLE` |
| `l0-spec`: normative L0 quote-check document with vectors | M4 | M9 (V5), M2 | C3 build notes; published before build step 8 |
| `Gap[]` with `resolvableBy`, `capsTo` | M4 | planner (F-REPLAN), M5 (confidence), M10 | C17 |
| `QuestionTemplate` registry | M4 + packs | CLI `plumbline explain`, M10 | C16 |
| `RenderedProse` with `spanMap`, audience filter | M4 | M10 evidence viewer, M9 audience tiers | C1 |
| Attack suite `Mutation[]` and `Delta` | M4 | M11 (positive controls, inert stubs) | C19 |
| Metrics (`ExplainReport`) and estimators | M4 | M11 harness | C18; harness owns pre-registration |
| Judge, voter and searcher prompts, model profiles | M14 | M4 | hash-pinned prompts; sponsor vs evaluation profile |
| Read-only corpus search tool, egress classification | M7 / M8 | M4 C7 | typed query channel, no URL |

## 25. Spec feedback

Status per item against `99-integration-register.md` (section 1b).

1. **Verdict vocabulary.** *Resolved by INT-001.* Producer outcome `VALID | INVALID | INCONCLUSIVE`; verifier result `PASS | FAIL | INDETERMINATE | NOT_APPLICABLE`; section 9 and 13 of the spec are reworded to match (C15).
2. **Principle 1 is still "A citation is a proof, not a pointer"** (section 2) although review XPL-08 and section 9a say existence is mechanical and support is a recorded judgement. It should read "a citation is checkable". *Resolved by INT-065* (spec wording; the blueprint already says so in C2 item 4).
3. **L0 statuses are incomplete.** `outside_span` and `quote_too_short` are needed, and `near` is a warning that does not end a claim (claim proceeds on the raw region). *Resolved by INT-065* (spec wording; C3 unchanged).
4. **Edge locality is stronger than "drop the edge".** Subset tables (C9) replace dropping. M3's select-from-list link contract broke locality. *Resolved by INT-036*: the select call nominates, a pairwise confirmation in both orders is the recorded edge, fallback `locality: "set"` is stated in the certificate (C8 obligation 5, C9, C15).
5. **The verdict projection is not defined.** C16 makes it part of the question template and every certificate names it. *Resolved by INT-034* (M4 owns the `Evaluator` composition and `vSpecHash` includes the projection).
6. **Static cone needs declared reads.** A cone built from the trace of `V(E)` is unsound under control dependence (C8 obligation 4). *Resolved by INT-034*: M5a publishes `reads(projection)`, M3 publishes `deps`.
7. **How L2 labels enter policy.** *Resolved by INT-015 and INT-065*: the label reaches M5a as `claim.<id>.canPermit` plus its chain label, restrict-only, missing means not permitting (C6 item 10).
8. **Gap ledger "caps verdict confidence"** over-abstains if every gap caps; C17 caps only on relevant or unknown-relevance gaps. *Resolved by INT-065* (spec sentence refined; C17 unchanged).
9. **Overdetermination claim.** Halpern-Pearl is justified by its degree and witness only, since MRS classes already separate overdetermined from decorative evidence (C10 item 9). *Resolved by INT-065* (spec wording).
10. **Evidence immutability versus `supports`/`contradicts`.** *Resolved by INT-006*: the relations live in the derived `EvidenceLinks` index that M4 owns (C1 item 9), not in `Evidence`.
11. **Text-layer offset unit.** *Resolved by INT-004*: Unicode code points, page-relative, over an un-normalised layer, plus UTF-8 byte offsets; M4 no longer assumes NFC (C2, C3).
12. **Authorship in labels.** A claim supported only by counterparty-authored text is `entailed` only in reported form (C1 item 3, `self_declared_only` gap). *Resolved by INT-065* (spec wording).
13. **Gap analysis needs declared domains** (review XPL-06); the spec's wording must read "within the declared domain" everywhere, including 9a. *Resolved by INT-065 and the guarantee-table row "Explanation exactness"* (register section 4).
14. **Role-necessity arms.** *Resolved by INT-060*: the span-gate, advocate/skeptic, argumentation and locality-violation measurements are registered as M11 `ArmSpec` switches (C7 tests).
15. **Open: page-crossing quotes.** Locators are page-relative (INT-004); C3 item 4 reports a quote that crosses a page break as ordered per-page fragments. Whether M2's layer can mark page joins is NOT VERIFIED. *Open.*
16. **Open: `canPermit` flag versus permission-matrix lookup.** The register does not say whether M5a reads the flag or looks the chain label up in the matrix (INT-014, INT-015). M4 publishes both and tests their equality. *Open.*

## 26. What this blueprint does not cover

- The reconcile pipeline, the policy IR, the policy judge and the SMT encodings (M3, M5): M4 only states the contract it needs (C8). Link-judgement model matching and identity-hypothesis enumeration stay in M3.
- Text-layer construction, per-glyph visibility, signature diffs and the locator-fidelity benchmark (M2); the verifier core's V0 to V5 implementations and the bundle format (M9); M4 specifies the certificate envelope and the contract the verifier recompute module must meet.
- The decision console, the flip panel's interaction design, copy and accessibility (M10); M4 supplies data and the rendered prose only.
- Prompt texts, model selection and model profiles (M14); this blueprint fixes contracts, label definitions and acceptance rules, not prompt wording.
- The evaluation harness, pre-registration, multiplicity control and TOST margins (M11); the metric definitions and estimators here are inputs to it.
- The security layer's own attack families (M8); EC12 and EC18 must align with `SEC-I18` and are not a replacement.
- Visual document forgery and edited images (spec 21c item 4); cross-script confusable detection (named, not specified); locale beyond the packs' declared number and date formats.
- Anything about the real world: every exactness statement is relative to a frozen snapshot, a named `V`, recorded labels and declared domains.
- **Measured results**: none exist. Every threshold (`tau_hi`, `tau_lo`, the near-quote similarity, `R_max`, caps) is an initial value; the ledger-size distribution and enumeration runtime on real ledgers are **NOT VERIFIED**; no reference result was reproduced; 2026 items are unreviewed preprints.

## Pass 3 resolutions (2026-10-13)

Source: `99b-integration-register-pass3.md` (INT-101 onward). These bindings override the body above wherever they differ; the body has not been rewritten. Each line is one binding change; the register item holds the reason and the other modules affected.

- **INT-104.** L0's `spanSha` comparison for a span of a non-public document is against the commitment recomputed from the revealed salt and value; without a reveal the quote check reports `not checked`.
- **INT-105.** Field-span ids: `sp_` + first 24 hex of the `DocHash` of `{evidence: evidenceId, pointer}` under tag `plumbline/field-span/v1` (widened from 16 hex).
- **INT-111.** Read M4's projected-verdict type as `ProjectedVerdict` everywhere; it is the projection of M5a's `PolicyVerdict` named by the certificate's projection id. `Verdict` is only the verifier's result.
- **INT-112.** The L2 port types are `EntailInput` and `EntailOutput { label, decidingSpanIds, contrarySpanIds, missingPieces: number[] }`; `JudgeInput` and `JudgeOutput` are M5's. `Voter.out` is `EntailOutput | "abstain"`. M14's `EntailmentVerdict` is retired as an alias.
- **INT-113.** `Claim.decomposer` gains `rule:<id>` (deterministic splitter, excluded from LLM-grade metrics); `Piece` span offsets are code points of the parent sentence text.
- **INT-117.** C6 item 10 publishes the claim's `chainLabel` (a `PermLabel`); M5a computes `claim.<id>.canPermit` itself through the permission matrix. The boolean flag is a display copy; the equality test stays. SF16 is closed.
- **INT-121.** A missing or unknown chain label means not permitting (absent, restrict-only).
- **INT-123.** C20 item 6 reads: no value above its declared egress class leaves, except at declared disclosure parameters where only the minimised form leaves; model prompts are an egress sink capped by the model profile.
- **INT-137.** `Evaluator.keys()` returns `CellKey` values (`cell:<anchorMention>/<attribute>`), fixed by the base snapshot; obligation 3 is tested over all S.
- **INT-139.** A quote that crosses a page break is cited as ordered single-page fragments (order significant) joined by M2's `page_break` hint; L0 status `exact_cross_page` requires each fragment exact and adjacency (end of page n, start of page n+1, whitespace trimmed). The verifier checks each fragment, not adjacency; the report says so. SF15 is closed.
- **INT-148.** Judge `inputHash` and `cacheKey` stay over canonical span ids and unit text; `canonicalRequest` (M14, M7) de-aliases so request hashes are alias-independent.


> v5.2 (D-026): profile-pass additions for this module are in `98-profile-pass-additions.md` (adoption register ids; they win over this blueprint where they differ).
