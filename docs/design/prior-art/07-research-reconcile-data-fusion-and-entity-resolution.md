# Prior art 07: Reconcile, entity resolution and data fusion (Track 1)

Status: research, 2026-10-13. Input to section 8 of `docs/design/00-architecture-master-spec.md`. Nothing here is built or measured; every Plumbline benefit below is a hypothesis with a named test. Already torn down in `prior-art/01` to `06` and not repeated: STORM, GraphRAG, LightRAG, nano-graphrag, HippoRAG, Graphiti, Cognee, ReConcile.

## Method and limits

- Repository numbers come from `gh api repos/OWNER/NAME` on 2026-10-13 (stars, SPDX licence, last push, archived). Source was read through `gh api` contents only; nothing was cloned or installed.
- Every paper cited was opened on its arXiv abstract page or publisher page with WebFetch. Where WebFetch could not decode a PDF (author-hosted VLDB, PODS, SIGMOD and AI-journal PDFs), the PDF was downloaded to a scratch location and its text read; those are marked "(PDF text)". Abstract-only reads are marked "(abstract only)": I did not read the evaluation sections of those papers, so my comments on their evaluations are limited to what the abstract states.
- The arXiv search API rate-limited me and the web-search budget ran out, so discovery was partial. The absence of a prior work in this file is not evidence that none exists.
- No result was replicated. Numbers quoted are the authors' claims.
- Not covered: privacy-preserving record linkage, graph-embedding entity alignment, commercial ER (Senzing, Quantexa and similar), probabilistic databases beyond provenance semirings, and the full OpenSanctions pipeline beyond the files named.

## 0. Findings in ten lines

1. The strongest fit to our principles is not an ER library. It is the OpenSanctions data model (statement-level storage, separate canonical-id mapping, judgement edges with cannot-link blocking, a transitivity audit), read directly from `nomenklatura` source.
2. Fellegi-Sunter already has three outcomes (link, possible link, non-link with a clerical-review band). Our "possible-same never merges" rule is a standard idea; our contribution is carrying the band through to the decision.
3. Truth discovery is weakest exactly where we operate: few sources, few attributes per entity, correlated sources. The best empirical study (Li et al., VLDB 2013) found no consistently best method and found fusion can be harmed by wrong trust or copy estimates.
4. Source dependence is the real hazard. Copy removal moved dominant-value precision from 0.908 to 0.923 (Stock) and 0.864 to 0.927 (Flight) in that study, while the automatic copy-aware method (AccuCopy) did worse than simpler ones on one domain.
5. Provenance semirings give one annotation structure whose different evaluations yield retraction, independent-source counts, best authority tier and necessity. This unifies four things our spec lists separately.
6. Repair semantics from inconsistency-tolerant querying (AR, IAR, brave) is the formal home of our `unresolved` state, and minimal-flip explanations are minimal hitting sets over conflicts.
7. LLM entity matching is competitive but its self-explanations are unfaithful (2026 study), so model reasons must never count as evidence.
8. 2026 agent-memory papers (TOKI, Engram, LatticeMind) reach our bitemporal and conflict-as-data design independently, but evaluate on conversational-memory benchmarks, not record reconciliation.
9. Two popular-sounding items fail on inspection: Dempster's rule under high conflict, and "AGM-compliant" badges on agent-memory repos (author-run scenario sets).
10. No source I read separates "evidence silent" from "evidence contradicts" for entity reconciliation with claim-level attribution; this supports the benchmark differentiator in spec section 16 (not proven absent; see section 11).

## 1. Record linkage and entity resolution systems

### 1.1 Splink (and fastLink)

- What: Python probabilistic linkage on a Fellegi-Sunter model, backends DuckDB, Spark, PostgreSQL. README claims a million records in about a minute on a laptop (not verified by me).
- Metadata: moj-analytical-services/splink, 2476 stars, MIT, pushed 2026-10-12, not archived. https://github.com/moj-analytical-services/splink . fastLink (R): 293 stars, no licence field, pushed 2026-02-28.
- Idea: match weights are additive log Bayes factors per comparison, unsupervised estimation of parameters, term-frequency adjustment, interactive diagnostics. The theory page states the independence assumption outright: Bayes factors multiply across columns "as independent" (https://moj-analytical-services.github.io/splink/topic_guides/theory/fellegi_sunter.html ). The README warns it is not designed for one free-text column and does best with several columns that are not highly correlated.
- Plumbline use: a per-comparison weight ledger is an explanation for free. Every link verdict stores `[{comparison, level, weight}]`, and the sum is the score. This is deterministic and replayable, and L0 can recompute it. Correlated comparisons (name and trading-name, address and postcode) must be grouped and capped, or the score double counts.
- Limits: independence assumption is acknowledged and often false; single-name vendor matching is exactly the case it advises against, so identifier-first cascade (spec section 8) is right and Splink-style scoring only applies to the residual band. Python and unsupervised EM do not fit the zero-dependency TS core. Use as an offline baseline in `eval/` (run it on the synthetic gold set and compare false-merge rate), not as a dependency.

### 1.2 Zingg, dedupe, Magellan, recordlinkage

- What: ML-based dedupe toolkits. Zingg: Spark, active-learning labeller. dedupe: active learning plus learned blocking. Magellan (py_entitymatching): a "how-to guide" EM management system. recordlinkage: modular toolkit.
- Metadata: zinggAI/zingg 1255 stars, AGPL-3.0, pushed 2026-09-13. dedupeio/dedupe 4517 stars, MIT, pushed 2025-07-29. anhaidgroup/py_entitymatching 195 stars, BSD-3-Clause, pushed 2024-05-29. J535D165/recordlinkage 1063 stars, BSD-3-Clause, pushed 2024-02-21. Magellan paper (VLDB 2016, PDF text): https://pages.cs.wisc.edu/~anhai/papers/magellan-vldb16.pdf
- Idea worth keeping: Magellan's argument that the EM pipeline needs sampling, labelling, debugging and accuracy-estimation steps, not only a matcher. That matches our `eval/` requirement to estimate false-merge rate with confidence intervals.
- Limits: all need human labels or Spark; Zingg's AGPL is a licensing burden for a repo judges will read; none ships a discriminator guard of the "Series A versus Series B" kind (I did not test them for it: NOT VERIFIED either way). Magellan and Ditto repos are stale (2024). Not adopted.

### 1.3 OpenSanctions stack: nomenklatura, FollowTheMoney, yente, rigour (adopt as patterns)

- What: the data model and resolver behind a production sanctions and PEP database; the closest open system to Plumbline's domain (counterparty identity from many conflicting lists).
- Metadata: opensanctions/nomenklatura 270 stars MIT pushed 2026-10-12; opensanctions/followthemoney 103 MIT 2026-10-05; opensanctions/yente 181 MIT 2026-10-12; opensanctions/rigour 69 MIT 2026-10-08; opensanctions/opensanctions 845 MIT 2026-10-13. https://github.com/opensanctions/nomenklatura
- Ideas, each read in source:
  - Storage is per-statement. `followthemoney/statement/statement.py` defines `Statement(entity_id, prop, schema, value, dataset, lang, original_value, first_seen, last_seen, origin, external, canonical_id)`. The raw value is kept beside the normalised one, observation times are per statement, and `canonical_id` is a separate field, so resolution never rewrites assertions.
  - `nomenklatura/judgement.py`: `Judgement = positive | negative | unsure | no_judgement`, with a combination rule where positive plus negative resolves to negative and anything else to unsure.
  - `resolver/resolver.py`: positive judgements canonicalise (both ids point to a new canonical id); `get_judgement` checks every pair across two clusters and "any blocking (negative/unsure) edge spanning the two clusters decides the pair"; edges carry judgement, user, created_at and score; `explode` and `prune` exist for undoing merges.
  - `conflicting_match.py`: flags a candidate that scores as a match against two entities where the resolver holds a NEGATIVE judgement between those two. This is a transitivity audit.
  - `matching/logic_v2/model.py`: a heuristic matcher with identifier features (LEI, OGRN, INN, BIC, ISIN, UEI, NPI) at weights about 0.95, and a separate class of qualifier features that can only raise or lower a score (country mismatch -0.2, birth-year disjoint -0.15, address match +0.2), plus a configurable "mismatching numbers in names" penalty (0.3 default). Cultural name reference data lives in `rigour`.
- Plumbline design:
  ```ts
  type LinkVerdict = 'same' | 'different' | 'possible' | 'unscored';
  interface LinkEdge { a: MentionId; b: MentionId; verdict: LinkVerdict;
    ledger: Array<{ comparison: string; level: string; weight: number; qualifier: boolean }>;
    decidedBy: 'identifier' | 'rule' | 'model' | 'human'; policyVersion: string; evidenceIds: EvidenceId[]; }
  ```
  Clustering is a pure function of `LinkEdge[]`: `same` edges union, any `different` or `possible` edge crossing two clusters blocks their merge (cannot-link), and a transitivity audit emits a new conflict type `identity_conflict` whenever the union would join two mentions that carry a `different` edge. Assertions keep `mention_id`; `entity_id` is derived. This gives cheap, replayable un-merge and answers the Graphiti false-merge defect structurally.
- Limits: sanctions matching is name-centric and person-heavy; company-attribute coverage is thinner. I read the resolver functions named, not the whole merge flow, so I cannot say whether a positive decision can bypass an existing blocking edge (NOT VERIFIED). The repos are Python and use a SQL store, so this is a pattern to re-implement in TS, not a dependency.

### 1.4 Bayesian ER, review and evaluation literature

- Binette and Steorts, "(Almost) All of Entity Resolution", arXiv 2008.04443 (PDF text read). https://arxiv.org/abs/2008.04443 . A review of deterministic, probabilistic (Fellegi-Sunter), clustering and Bayesian ER. Confirmed in the text: Fellegi-Sunter decides link, possible link or non-link with a clerical-review band; independence of comparisons is "usually not satisfied in practice"; clustering is used to enforce transitivity; canonicalisation (merging, fusion) is the final stage; two-stage Bayesian approaches propagate linkage uncertainty to downstream analysis ("linkage averaging", credited to Sadinle 2018).
- d-Blink, arXiv 1909.06039 (abstract only). https://arxiv.org/abs/1909.06039 . Distributed end-to-end Bayesian ER that handles blocking, matching and merging jointly with uncertainty quantification. Repo cleanzr/dblink: 59 stars, licence NOASSERTION, pushed 2021-06-10 (stale, Spark). Not adoptable; the concept is.
- Binette et al., "Estimating the Performance of Entity Resolution Algorithms: Lessons Learned Through PatentsView.org", arXiv 2210.01230 (abstract only). https://arxiv.org/abs/2210.01230 . Sampling-bias-aware performance estimators. Repo OlivierBinette/ER-Evaluation: 38 stars, AGPL-3.0, pushed 2023-12-03 (reference only).
- S2AND, arXiv 2103.07534 (abstract only). https://arxiv.org/abs/2103.07534 . Benchmark harmonising eight author-disambiguation datasets with evaluation split by facets (publication year, paper count) to expose unfairness. Repo allenai/S2AND 116 stars, licence NOASSERTION, pushed 2026-10-06.
- Plumbline use: (a) link verdicts are a 3-region decision whose middle band is a first-class state; (b) carry link uncertainty into the decision (section 8, idea H); (c) report ER metrics at cluster level with sampling-aware intervals and by facet (entity type, country, source pair), as S2AND does; (d) planted-conflict gold sets cannot estimate real-world error; say so in `eval/`.
- Limits: all of these assume a single record type with many comparable attributes; vendor reconciliation spans heterogeneous sources. None addresses explanation.

### 1.5 Temporal record linkage (Li, Dong, Maurino, Srivastava, VLDB 2011)

- What and URL: "Linking Temporal Records" (PDF text). https://ifi.uzh.ch/dbtg/Staff/peili/paper506-li-final.pdf . Applies time decay to model that attribute values legitimately change (disagreement decay) and that unrelated entities coincidentally share values over time (agreement decay), and uses clustering that respects time order rather than pairwise decisions. Abstract claims significant gains over traditional linkage on temporal datasets (I did not read the numbers).
- Plumbline use: this is the quantitative form of our conflict taxonomy split "update over time" versus "same-name-different-entity". Learn, per attribute and entity type, `P(change | dt)` and `P(coincident share | dt)` and use them as comparison levels:
  ```ts
  interface DecayCurve { attr: string; entityType: string; pChange: (dtDays: number) => number; pCoincide: (dtDays: number) => number; fitOn: DatasetId; }
  ```
  A registered-address or director mismatch after 3 years is weak evidence of "different", a mismatch of a stable attribute (jurisdiction, incorporation date) after any time is strong evidence. Curves are fitted offline on the synthetic and public sets, versioned, and cited in the ledger line.
- Limits: needs timestamped history per source; whether GLEIF or registries expose enough history to fit curves is NOT VERIFIED. Curves fitted on synthetic data would only test the code, not the world.

### 1.6 LLM and PLM entity matching (2020 to 2026)

| Item | URL | Verified claim (abstract only) |
|---|---|---|
| Ditto, arXiv 2004.00584 | https://arxiv.org/abs/2004.00584 | Fine-tuned Transformer pair classifier with domain-knowledge injection, summarisation, augmentation; up to 29% F1 over prior best; 96.5% F1 on a 789K x 412K company-record task |
| Peeters, Steiner, Bizer, arXiv 2310.11244 | https://arxiv.org/abs/2310.11244 | Zero/few-shot LLMs match PLMs fine-tuned on thousands of pairs; more robust to unseen entities; GPT-4 produced structured explanations |
| Wang et al., "Match, Compare, or Select?", arXiv 2405.16884 (COLING 2025) | https://arxiv.org/abs/2405.16884 | The "selecting" strategy captures global consistency among records; ComEM composes strategies; 8 datasets, 10 models |
| AnyMatch, arXiv 2409.04073 | https://arxiv.org/abs/2409.04073 | Small fine-tuned model within 4.4% of MatchGPT at "four orders of magnitude" fewer parameters |
| Fu et al., arXiv 2506.02509 | https://arxiv.org/abs/2506.02509 | LLM clustering of records directly (set-wise) rather than pairwise; up to 5x fewer API calls; nine datasets |
| Li et al., arXiv 2401.03426 | https://arxiv.org/abs/2401.03426 | Spend LLM queries only on the most uncertain pairs, with error handling |
| Kamsteeg et al., arXiv 2509.19557 | https://arxiv.org/abs/2509.19557 | Calibration study: the model measured is RoBERTa (despite "LLM" in the title); temperature scaling cut ECE by up to 23.83% |
| Teofili et al., arXiv 2606.01210 (2026) | https://arxiv.org/abs/2606.01210 | LLM self-explanations for ER are "often unstable, weakly faithful, and poorly aligned with counterfactual evidence"; 3 models, 10 datasets |
| Steiner and Bizer, arXiv 2606.28823 (2026) | https://arxiv.org/abs/2606.28823 | LLM-labelled data trains cheap matchers that match benchmark-trained ones in most cases; weaker on unseen products |
| Zhang et al., arXiv 2607.24688 (2026) | https://arxiv.org/abs/2607.24688 | 1,215 fine-tuning runs: cross-encoders beat bi-encoders; larger models lean on shortcut learning; generative matchers help mainly under distribution shift |
| DistillER, arXiv 2602.05452 (2026) | https://arxiv.org/abs/2602.05452 | Distilling LLM labels into small students works; SFT on noisy teacher labels did best |

Repos: megagonlabs/ditto 320 stars Apache-2.0 pushed 2024-04-17; wbsg-uni-mannheim/MatchGPT 68 stars, no licence, pushed 2024-10-18; tshu-w/ComEM 20 stars, no licence, pushed 2026-05-27.

- Plumbline use: the model matcher is confined to the `possible` band, receives a fixed candidate list (Select strategy: choose from the shown ids or abstain, the validator rejects ids not shown), temperature 0, and every call goes through a cassette. Its output is a `LinkEdge` with `decidedBy: 'model'`, which by policy can propose `same` only when an independent qualifier agrees; otherwise it stays `possible`. Its free-text reason is stored as a label, never as evidence (2606.01210). Where we want to know whether a model decision is brittle, perturb the input fields (the ledger's counterfactual) rather than ask the model why.
- Limits: all benchmarks are product, citation or bibliographic matching, not company-legal-entity matching with transliteration, subsidiaries and trading names; none tests adversarial near-duplicates such as "Series A / Series B" (no abstract mentions it). Calibration result concerns a fine-tuned PLM and does not transfer to prompted LLMs (NOT VERIFIED). Cost claims depend on vendor pricing at the time.

## 2. Truth discovery and data fusion

### 2.1 Survey and base algorithms

- Survey: Li et al., "A Survey on Truth Discovery", arXiv 1505.02463 (abstract only). https://arxiv.org/abs/1505.02463 . Taxonomy of methods that jointly estimate source reliability and truth.
- TruthFinder (Yin, Han, Yu, KDD 2007; abstract). https://research.ibm.com/publications/truth-discovery-with-multiple-conflicting-information-providers-on-the-web . Mutual reinforcement: sources are trustworthy if they give true facts, facts are likely true if given by trustworthy sources.
- LTM (Zhao, Rubinstein, Gemmell, Han), arXiv 1203.0058 (abstract only). https://arxiv.org/abs/1203.0058 . Unsupervised graphical model with separate false-positive and false-negative source quality, supports multi-valued attributes, sampling inference.
- CRH (Li et al., SIGMOD 2014; PDF text of abstract and introduction). https://cse.buffalo.edu/~jing/doc/sigmod14_crh.pdf . Optimisation framework treating truths and source weights as unknowns, with type-specific loss functions for heterogeneous attributes (categorical, numeric).
- Repo: joesingo/truthdiscovery, 7 stars, GPL-3.0, pushed 2023-03-29. Toy scale; GPL; not adopted. LD-FusionTool (feynmanix): 5 stars, Apache-2.0, archived. Not examined beyond metadata.
- Plumbline use: none of these decide a truth in the product path. Our resolution is a pure function of dates, per-attribute authority tiers and cardinality (spec section 8). Use truth discovery offline as a calibration instrument: given the planted ground truth, compute each source's per-attribute accuracy and use the table to justify (or challenge) tier assignments, documented in `eval/reports/`.
- Limits (reasoned, not measured): these methods estimate reliability from agreement across many objects. A single vendor case has a handful of sources and attributes, so reliability is weakly identified from one case; and the estimators assume independent sources.

### 2.2 The key critical evidence: Li et al., "Truth Finding on the Deep Web: Is the Problem Solved?" (VLDB 2013)

- URL: https://arxiv.org/abs/1503.00303 (abstract) and the paper PDF text read from arXiv.
- Findings quoted from the PDF text: stock and flight domains; naive dominant-value voting precision 0.908 (Stock) and 0.864 (Flight); advanced methods find correct values for "96% data items on average" but show "a lot of instability" and "we did not find one method that is consistently better than others"; trust, copying and formatting help, but "it is essential that accurate information on source trustworthiness and copying between sources is used; otherwise, fusion accuracy can even be harmed". Removing copying sources raised dominant-value precision from .908 to .923 (Stock) and .864 to .927 (Flight). AccuCopy "does not perform well" on Stock because the copy detector ignored value similarity and read near-true values as shared falsehoods.
- Two more findings from the same text: on Stock the best single source reached recall .93, equal to the best fusion result, and for most methods recall peaked at the 5th source added then declined; and when sampled trustworthiness was supplied and the known copiers were ignored, AccuCopy performed best. Known (declared) lineage works, inferred lineage was the weak point.
- What the evaluation does not show: gold standards were built by voting among authority sources; only two domains (stock, flight) of numeric and time attributes; many sources per domain (one copying group alone had 11 sources) and thousands of data items, far from our sparse regime; no entity-identity ambiguity.
- Plumbline use: this is the evidence behind three spec choices: authority tiers instead of learned weights; copy handling by declared lineage (below); and never presenting majority as proof.

### 2.3 Source dependence and copying (Dong, Berti-Equille, Srivastava, VLDB 2009)

- URL: "Integrating Conflicting Data: The Role of Source Dependence", https://lunadong.com/publication/dependence_vldb.pdf (PDF text). Bayesian analysis decides whether sources are dependent; the key signal is sharing of rare false values, and accuracy gives the direction of copying; iterates detection and truth discovery. Companion: "Truth Discovery and Copying Detection in a Dynamic World" (VLDB 2009, HMM over time) was seen only in a search listing: NOT VERIFIED beyond title.
- Limits per the paper: needs a snapshot with enough shared values; detection depends on knowing which values are false; the paper states sharing common data does not itself imply copying; the problem is static snapshot data.
- Plumbline design (declared-lineage-first):
  ```ts
  interface SourceOrigin { originId: string;           // lineage root, e.g. "gleif:LEI-record"
    derivedFrom: string[];                              // declared: mirrors, aggregators, imports
    declaredBy: 'channel-metadata' | 'document-metadata' | 'human'; }
  // independent support count = number of distinct originId roots after following derivedFrom
  ```
  Same-origin duplicates count once (spec principle). For undeclared similarity, an inferred-dependence detector may only *down-weight to advisory*, never raise a count and never change a verdict; it files a `possible_dependence` gap. Under unknown dependence the conservative default is "count as one" (the covariance-intersection principle, section 5.3).

### 2.4 Knowledge-Based Trust, Knowledge Fusion, Knowledge Vault

- KBT: Dong et al., arXiv 1502.03519 (abstract only). https://arxiv.org/abs/1502.03519 . Multi-layer model separating extraction errors from source errors; 2.8 billion facts from 119 million pages; validated by manual evaluation (the abstract says so; sample size not read).
- From Data Fusion to Knowledge Fusion: Dong et al., arXiv 1503.00302 (abstract only). https://arxiv.org/abs/1503.00302 . Adapts fusion to extracted triples from 12 extractors; 1.6 billion triples; shows extractor noise (linkage, schema alignment) is a new error layer.
- Knowledge Vault: KDD 2014, https://research.google/pubs/pub45634/ (abstract). Supervised fusion of extractors and priors producing calibrated fact probabilities.
- Plumbline use: the layered idea is the valuable one. A wrong value can be a source error or our extraction error; our spec's fourth conflict type "extraction error" needs its own evidence: store `extractor`, `parserVersion`, `locator`, and rank an extraction-error hypothesis above a source-error hypothesis when a second extractor (or L0 quote check) disagrees with the first on the same span.
- Limits: web scale, probabilistic outputs; our spec forbids probabilities that are not calibrated. Not adopted as models.

### 2.5 LLM data fusion (2026)

- Kucuk, Paton, Chen, Wu, "Single and Multi Truth Data Fusion using Large Language Models", arXiv 2606.28062 (abstract only). https://arxiv.org/abs/2606.28062 . LLM prompting (zero/one-shot, domain-dependent or independent) beat unsupervised DART and LTM on three benchmarks.
- Limits: the comparison is against unsupervised methods; the abstract names no source-dependence or temporal handling; LLM output is not an auditable function of the evidence. Plumbline use: at most a proposer for multi-valued attributes (for example alias sets), with its answer re-checked by L0 against stored text. Not in the resolution path.

## 3. Bitemporal data and conflict-aware memory (databases and 2026 agent memory)

### 3.1 Bitemporal stores

- XTDB: xtdb/xtdb, 3081 stars, MPL-2.0, pushed 2026-10-12. README: "Bitemporal" with system time and valid time, SQL:2011 bitemporal semantics over the Postgres wire protocol (JVM). https://github.com/xtdb/xtdb . SirixDB: 1220 stars, BSD-3-Clause, 2026-10-13 (embeddable, bitemporal, append-only). minigraf: 196 stars, Apache-2.0, 2026-10-13, Rust embedded graph with Datalog and bitemporal queries (README claims; early-stage by its own roadmap note).
- Plumbline use: the semantics (valid-time versus system-time, "as of X, known at Y") are the spec; none of these store engines fits a zero-dependency TS core and `node:sqlite`. Use XTDB's SQL:2011 query shape as the model for our as-of API and as an offline oracle for the bitemporal test vectors (differential test: same inserts, same as-of queries, same answers). I did not read the SQL:2011 standard: NOT VERIFIED beyond XTDB's description.

### 3.2 TOKI, Engram, RoMem, LatticeMind, M-TRACE, CoVer (2026 preprints, abstracts only)

- TOKI, Wang, arXiv 2606.06240. https://arxiv.org/abs/2606.06240 . Formalises four contradiction heuristics (last-writer-wins, evidence-weighted merge, await-confirmation, per-rule policy) as bitemporal operators over a dual-row schema with isolation preconditions and provenance annotations; defines three write-time anomalies (replay inconsistency, belief-drift skew, audit erasure); compares eight systems.
- Engram, Wang, arXiv 2606.09900. https://arxiv.org/abs/2606.09900 . Open-source bitemporal memory engine; lossless episode writes, asynchronous fact extraction, contradiction resolution; LongMemEval_S 83.6% vs 73.2% full-context at about 8x fewer tokens.
- RoMem, Li et al., arXiv 2604.11544 (EMNLP 2026 main). https://arxiv.org/abs/2604.11544 . Obsolete facts "rotate out of phase" in complex vector space via a learned volatility gate.
- LatticeMind, Zhou et al., arXiv 2608.08236. https://arxiv.org/abs/2608.08236 . Conflict-aware multi-agent memory: explicit item statuses, cheap symbolic conflict detection, LLM reconciliation only for unresolved semantic disagreements; 0.97 vs 0.61 accuracy against the best aggregation baseline on a "blind ConflictBank evaluation"; mixed results on planning.
- M-TRACE, Huang et al., Findings of ACL 2026. https://aclanthology.org/2026.findings-acl.1204/ . State Timeline plus step-wise conflict checking against "time-anchor drift"; new benchmark TimeConfQA. Repo h-yii/M-TRACE: 0 stars, no licence, pushed 2026-01-06.
- CoVer, Zhang et al., arXiv 2609.00508. https://arxiv.org/abs/2609.00508 . Conflict-aware claim verification on social-media Community Notes data; 86.0% accuracy on its conflict task.
- Plumbline use: TOKI's three anomalies become named acceptance tests for our World Model supersession: replay inconsistency (same events in another order give a different table), belief-drift skew (repeated corroboration by the same origin raises confidence), audit erasure (a superseded value cannot be recovered). LatticeMind's pattern is already ours (symbolic first, model last); cite it as independent support for the ordering, not as proof.
- Limits: every one is a 2026 preprint or very recent paper, mostly single-lab, evaluated on conversational memory (LoCoMo, LongMemEval) or Q&A, not on entity records with authority tiers; I did not verify their repo links or reproduce a number. RoMem's decay by a learned gate cannot give the auditable "which rule chose" our spec requires. TOKI keeps a model in the write path, which we forbid for resolution.

### 3.3 BODS 0.4 (Beneficial Ownership Data Standard)

- openownership/data-standard, 82 stars, licence NOASSERTION, pushed 2026-09-02. https://github.com/openownership/data-standard . Read `schema/statement.json`: each statement carries `statementId` (persistent, 32 to 64 characters), `statementDate` (when the source declared it), `declarationSubject`, `recordId`, `recordStatus` in `new | updated | closed`, `source` with types `selfDeclaration | officialRegister | thirdParty | primaryResearch | verified`, plus `annotations` and `publicationDetails`.
- Plumbline use: (a) adopt the five source types as the seed vocabulary for the authority-tier table (a self-declaration never outranks an official register on a legal fact); (b) mirror the append-only statement lifecycle in the ownership slice; (c) offer a BODS-shaped export of the ownership graph. Licence is NOASSERTION: use the field names and concepts, do not vendor the schema until the licence is read (NOT VERIFIED).

## 4. Provenance

### 4.1 Provenance semirings (Green, Karvounarakis, Tannen, PODS 2007) and ProvSQL

- Paper (PDF text): https://www.cs.ucdavis.edu/~green/papers/pods07.pdf . Incomplete databases, probabilistic databases, bag semantics and why-provenance are special cases of annotating tuples with elements of a commutative semiring; the most general annotation is a polynomial; extended to datalog.
- ProvSQL: PierreSenellart/provsql, 75 stars, MIT, pushed 2026-10-13. README: "(m-)semiring provenance and uncertainty management" for PostgreSQL, with probabilities, Shapley values and semiring evaluations. https://github.com/PierreSenellart/provsql
- Plumbline design: every truth-table cell carries a provenance expression over evidence ids:
  ```ts
  type Prov = { kind: 'ev'; id: EvidenceId } | { kind: 'and'; of: Prov[] }   // joint support (a rule used several facts)
            | { kind: 'or';  of: Prov[] }                                     // alternative support (any one suffices)
  // One structure, four readings, each a total function:
  //   retract(S)        : Boolean semiring -> does the cell survive removing evidence set S?
  //   independentSupport: count semiring over originId roots (same origin counts once)
  //   bestTier          : (max, min) semiring over authority tiers
  //   necessity(e)      : retract({e}) -> critical / redundant (feeds L4 leave-one-out)
  ```
  This gives the spec's "exact retraction", "per-fact support counts" and the L4 necessity table from one stored object, and prunes the candidate sets for the minimal-flip search (differentiator 2).
- Limits: the semiring framework covers positive relational queries. Supersession, precedence and `unresolved` are non-monotone (new evidence can flip a cell), which is what m-semirings with a difference-like operator address in ProvSQL; I did not read that theory. Honest consequence: use provenance to prune and to explain, but recompute the verdict by running the resolution function on each hypothetical evidence subset, as the spec already states for counterfactuals.

### 4.2 W3C PROV-O

- W3C Recommendation, 2013-04-30. https://www.w3.org/TR/prov-o/ . Core classes Entity, Activity, Agent; properties include `wasGeneratedBy`, `wasDerivedFrom`, `wasAttributedTo`, `used`, `wasRevisionOf`, `wasInvalidatedBy`, `generatedAtTime`, `invalidatedAtTime`. It has no construct for conflicting assertions or confidence (checked).
- Plumbline use: the offline-verifiable dossier (differentiator 1) exports lineage as PROV-O so third-party tools can read it: evidence is an Entity, a fetch or extraction is an Activity, a channel or parser is an Agent, `originId` derivation is `wasDerivedFrom`, supersession is `wasInvalidatedBy`. Conflict, resolution rule and `unresolved` are defined in a small Plumbline vocabulary (`plb:contradicts`, `plb:resolvedBy`, `plb:unresolved`). Internal storage stays native; PROV-O is an export, not the data model.

## 5. Uncertainty calculi from adjacent fields

### 5.1 Subjective logic (adopt narrowly)

- What: opinions with belief, disbelief and uncertainty mass, plus fusion operators. Van der Heijden, Kopp, Kargl, "Multi-Source Fusion Operations in Subjective Logic", arXiv 1805.01388 (abstract only). https://arxiv.org/abs/1805.01388 . Notes that not all fusion operators are associative, formalises weighted and consensus-and-compromise fusion via mappings to Dirichlet distributions, and corrects earlier results for averaging and cumulative fusion. Repo uulm-mrm/eslimpp: 8 stars, Apache-2.0, pushed 2026-08-26 (C++ and Python).
- Plumbline use: the useful part is structural: a three-way split of evidence into support, opposition and silence (uncertainty), which is our principle 4 (absence is not falsity) in algebraic form. Define per cell an evidence-mass triple of integer counts over independent origins:
  ```ts
  interface EvidenceMass { support: number; oppose: number; silent: number }   // origins, not documents
  // ordinal tag by rule, e.g. oppose>0 && support>0 -> 'contested'; support>=2 && oppose==0 -> 'corroborated'
  ```
  Integer counts add, so merge is commutative and associative by construction, which the order-independence gate needs. No probabilities (spec section 9: confidence is an ordinal tag).
- Limits: the abstract warns about non-associative operators; do not import the fusion operators without a proof of order independence for the one chosen (NOT VERIFIED which operators satisfy it). Opinions need base rates we cannot justify.

### 5.2 Dempster-Shafer (do not adopt)

- Dezert and Smarandache, arXiv math/0404371 (abstract only). https://arxiv.org/abs/math/0404371 . Describes classes of fusion problems where Dempster's rule yields incoherent outcomes. The standard Zadeh example (two sources both give 0.01 to one hypothesis and 0.99 to different others; the rule then assigns certainty to the 0.01 one) was seen only in a search summary: NOT VERIFIED from a fetched page. Note the authors propose their own alternative (DSmT), which is itself contested; I cite the paper only for the incoherence claim. Repo reineking/pyds: 144 stars, BSD-3-Clause, archived, pushed 2021-05-16.

### 5.3 Covariance intersection (sensor fusion) as a justification, not a component

- Source: https://en.wikipedia.org/wiki/Covariance_intersection (secondary; the original is Uhlmann's 1995 dissertation per that page, not opened). Fusion of two estimates with unknown cross-correlation as a convex combination in information space, with a consistency (conservativeness) guarantee for any correlation.
- Plumbline use: the principle only. When dependence between two sources is unknown, assume the worst case permitted by the data (count as one origin) rather than independence. This is the formal analogy for our "same-origin counts once" rule and for the copy-handling in 2.3. No code.

### 5.4 Probabilistic soft logic (offline idea only)

- Bach, Broecheler, Huang, Getoor, arXiv 1505.04406 (JMLR 2017, abstract only). https://arxiv.org/abs/1505.04406 . Hinge-loss MRFs and a first-order-logic syntax for scalable convex MAP inference. Repo linqs/psl: 315 stars, Apache-2.0, pushed 2024-06-10 (JVM).
- Not adopted at runtime: weights need training data, outputs are soft values that violate "ordinal tag, not probability", and the JVM breaks the zero-dependency rule. Possible offline use: express collective rules (owner-of transitivity, same-address implies related) as soft constraints in the eval harness to test whether collective ER beats our cascade on the gold set.

## 6. Belief revision, truth maintenance, argumentation and repair semantics

### 6.1 Inconsistency-tolerant querying (repair semantics): adopt as the formal core of `unresolved`

- Bienvenu and Bourgaux, "Inconsistency-Tolerant Querying of Description Logic Knowledge Bases", Reasoning Web 2016 (PDF text of abstract). https://www.di.ens.fr/~bourgaux/papers/BieBou-RW16.pdf . A repair is a maximal consistent subset of the data; AR semantics returns answers true in every repair, IAR the intersection of repairs, brave every answer true in some repair (definitions confirmed from the search summary of the same survey; the PDF opening confirms the topic).
- Plumbline design: for each `(subject, attribute)` build the conflict set (the minimal sets of assertions that cannot all hold, given cardinality and the precedence rules), then compute repairs. Map statuses to our labels:
  ```ts
  type Status = 'resolved'      // same value in every repair (AR / IAR)  -> certain
              | 'unresolved'    // different values across repairs, no rule separates them (brave but not certain)
              | 'excluded';     // value present in no repair
  ```
  Per-attribute conflict sets are small (a vendor has tens to hundreds of assertions), so enumeration can be done exactly in TS with a hard cap and a visible `capExceeded` gap. Minimal-flip (differentiator 2) is then a minimum hitting set over conflict sets: the smallest evidence removal that changes the status of the decision-relevant cell. This turns a heuristic into a defined problem.
- Oracle: clingo (potassco/clingo, 850 stars, MIT, pushed 2026-10-13; Gebser et al., "Multi-shot ASP Solving with clingo", arXiv 1705.09811, abstract only, https://arxiv.org/abs/1705.09811 ). Encode the same conflicts as an ASP program and compare repair sets and minimal flips against the TS implementation on every gold case, as a differential test (the same approach spec section 13 uses for Meterless). Clingo is a test-time tool only.
- Limits: repair semantics is defined for logical inconsistency, whereas many of our conflicts are soft (equal-authority disagreement, stale versus current). Encode soft conflicts as constraints derived from policy (cardinality one + equal tier + overlapping validity), and say so. Exponential in the worst case, hence the cap.

### 6.2 AGM belief revision (property tests only)

- Stanford Encyclopedia of Philosophy entry. https://plato.stanford.edu/entries/logic-belief-revision/ . Basic revision postulates (closure, success, inclusion, vacuity, consistency, extensionality, plus superexpansion and subexpansion); Levi identity (K*p = (K minus not-p) plus p); documented limits: the recovery postulate fails for belief bases, iterated revision is problematic, success is contestable.
- Agent-memory claims: Kumiho (Park, arXiv 2603.17244, abstract: formal correspondence, "satisfaction of the basic AGM postulates"; https://arxiv.org/abs/2603.17244 ) and RichSchefren/atlas (85 stars, Apache-2.0, pushed 2026-10-01) whose README shows "AGM 49/49" and describes itself as alpha and verified by "49 scenarios" on a live Neo4j. These are author-run scenario sets or formal arguments about a particular design, not independent verification, and they work on the base (not the closure), so classic AGM results do not apply as claimed.
- Survey: Almeida and Casals, "From Doyle to AGM", arXiv 2608.14567 (abstract only). https://arxiv.org/abs/2608.14567 . A 2026 narrative review linking pre-AGM computational belief change to AGM; no LLM-memory content in the abstract.
- Plumbline use: do not claim AGM compliance. Use belief-base postulates as property tests on World Model supersession: success (the new fact is present after supersede), inclusion (no unrelated fact appears), vacuity (re-asserting an existing fact changes nothing), consistency (a consistent input never yields a cardinality violation), minimal change (only the superseded version's `supersededAt` moves). These are cheap `fast-check`-style tests and fall out of the bitemporal model.

### 6.3 Truth maintenance (de Kleer's ATMS)

- de Kleer, "An Assumption-based TMS", Artificial Intelligence 28 (1986), 127 to 162 (PDF text of abstract). https://www.dekleer.org/Publications/An%20Assumption-Based%20TMS.pdf . A TMS that manipulates assumption sets as well as justifications, so inconsistent information coexists and contexts switch without backtracking.
- Plumbline use: the conceptual ancestor of "a cell's label is the set of minimal evidence sets that support it". The provenance expression in 4.1 plays the role of the ATMS label; nogoods correspond to the conflict sets of 6.1. Read as a design precedent only; I did not study the algorithms.

### 6.4 Argumentation

- No argumentation framework (ASPIC+, Dung) was fetched and verified in this session, so none is recommended or rejected on evidence. The spec's advocate/skeptic/arbiter is an argumentation-flavoured protocol; formalising it is listed as an open item in section 11.

## 7. Merge disciplines (CRDTs)

- Shapiro, Preguica, Baquero, Zawirski, "A comprehensive study of Convergent and Commutative Replicated Data Types", INRIA RR-7506, 2011 (PDF text of abstract). Hosted copy used; HAL id inria-00555588. The abstract: simple formal conditions sufficient for eventual consistency, for state-based and operation-based replication. Repo automerge/automerge: 6657 stars, MIT, pushed 2026-10-13 (README read only for the first lines; its conflict-handling rules are NOT VERIFIED by me).
- Plumbline use: treat the evidence store as a grow-only set of immutable, content-addressed items, so merging two stores (two investigators, a replay, a fan-out join) is set union, which is commutative, associative and idempotent. Supersession is data (`validTo`, `supersededAt`), never deletion, so there are no tombstone anomalies. The verdict is a function of the set, hence order of arrival cannot matter, and the property test is `resolve(shuffle(S)) == resolve(S)` plus `resolve(A union B) == resolve(B union A)`.
- Limits, stated plainly: this guarantees convergence of the store, not monotonicity of the verdict (new evidence may legitimately flip a cell). Automerge itself is not suitable as a dependency: it is a general JSON CRDT that picks a winner on concurrent writes, which hides conflicts that our principle 3 requires us to keep (my reading of the design intent; I did not test its API).

## 8. Proposed Reconcile design additions (synthesis)

Each is a hypothesis with a gate; none is claimed.

A. Mention-level statements, derived entities. Adopt the FtM `Statement` shape (section 1.3): `Assertion { id, mentionId, attribute, rawValue, normValue, source, originId, observedAt, validFrom?, validTo?, recordedAt, supersededAt?, extractor, parserVersion, locator, evidenceId }`. Entity ids are a derived view from `LinkEdge[]`. Gate: un-merge then re-merge yields an identical truth table; idempotent re-run gives an empty diff (spec 8).

B. Three-region link decision with a weight ledger and qualifier features (1.1, 1.3, 1.4). Gate: false-merge rate on planted near-duplicates (including Series A/B, number-bearing names) is zero at the product threshold, with the interval reported; compare against Splink, dedupe, nomenklatura logic-v2 and a prompted LLM on the same pairs.

C. Declared-lineage origin DAG for independent-source counting (2.2, 2.3, 5.3). Gate: planted copy chains (a registry mirrored by two aggregators) never raise a count above 1; a sweep of the copy rate shows how fast a majority-vote baseline degrades while the origin-aware count does not.

D. Time-decayed comparison levels (1.5). Gate: classification of "update over time" versus "different entity" on planted cases improves over a no-decay baseline.

E. Provenance expressions on every derived cell (4.1) and the evidence-mass triple (5.1). Gate: retraction by recomputation equals retraction by provenance on every cell; leave-one-out table matches the necessity labels.

F. Repair-semantics status and minimal hitting-set flips (6.1) with a clingo differential oracle. Gate: TS and clingo agree on repair sets and on minimum flips for the whole gold set, or the differences are explained cases.

G. Bitemporal write operators and anomaly suite (3.2) plus belief-base property tests (6.2) and CRDT-style store properties (7). Gate: the three TOKI anomalies are impossible by construction and tested; property tests pass for random event orders.

H. Identity-hypothesis robustness (links uncertainty to decision; Binette-Steorts linkage averaging, deterministic form). For every `possible` edge, enumerate admissible clusterings under cannot-link constraints (cap k, deterministic order), run Reconcile and the rule engine under each, and report: `stable` (same verdict in all), or `identity_dependent` with the minimal set of link judgements whose reversal changes the verdict. `identity_dependent` forces escalation. Gate: planted cases where one possible link flips release to hold are all flagged; stable cases are never flagged; cost within budget.

I. Extraction-versus-source error hypothesis ordering (2.4). Gate: planted parse errors are classed as `extraction_error`, not `source_disagreement`, in at least the share of cases a second extractor or L0 quote check can resolve.

J. Source-reliability audit report, not weights (2.1). Gate: a table in `eval/reports/` of per-source, per-attribute accuracy against ground truth, with the tier assignments it supports or contradicts.

## 9. Ranked list: the 10 ideas most worth adopting or extending

1. Provenance expressions on every derived cell with several evaluations (4.1). Evidence: Green et al. show uniform treatment of why-provenance, bag counts and probabilistic annotations; it replaces three separate mechanisms in the spec (exact retraction, independent support, necessity) with one stored object, and feeds minimal-flip pruning.
2. Mention-level statements with a separate canonical mapping, judgement edges, cannot-link blocking and a transitivity audit (1.3). Evidence: read directly in `nomenklatura` and FtM source, in production use in the sanctions domain; structurally prevents the Graphiti false-merge class.
3. Declared-lineage independence with a conservative default (2.2, 2.3, 5.3). Evidence: Li et al. 2013 measured copy removal gains of 1.5 and 6.3 points while automatic copy-aware fusion sometimes lost; hence declare, do not infer.
4. Repair semantics for `unresolved` and minimum hitting sets for minimal-flip, checked against clingo (6.1). Evidence: AR/IAR/brave are the established semantics for querying inconsistent data; gives differentiator 2 a precise definition and an independent oracle.
5. Three-region link decision with an additive weight ledger and qualifier-only features (1.1, 1.3, 1.4). Evidence: Fellegi-Sunter's link/possible/non-link rule (confirmed in Binette-Steorts text), Splink's additive weights, logic-v2's qualifier class; each line in the ledger is checkable by L0.
6. Time-decayed disagreement and agreement curves (1.5). Evidence: Li et al. 2011 model exactly our update-versus-different-entity ambiguity; gains reported in the abstract only.
7. Linkage-uncertainty propagation into the decision, as identity-hypothesis robustness (1.4, 8H). Evidence: Binette-Steorts describe linkage averaging for downstream analyses; no source I read applies it to a rule-based decision with explanations (not proven absent).
8. Bitemporal write-time operators with TOKI's anomaly tests, plus belief-base postulates and CRDT-style store properties as property tests (3.2, 6.2, 7). Evidence: independent 2026 convergence on the same design; the tests are cheap and falsifiable; the claims of the preprints themselves are not relied on.
9. Model matching confined to the possible band with a Select-from-list contract, abstention, and no reliance on model explanations (1.6). Evidence: ComEM (Select strategy), Peeters et al. (robustness, explanations), and the 2026 finding that self-explanations are weakly faithful.
10. Evidence-mass triple (support, oppose, silent) over independent origins with rule-derived ordinal tags, using the BODS source-type vocabulary as the tier seed (3.3, 5.1). Evidence: it is the algebraic form of principle 4, integer addition is order independent, and BODS gives an existing standardised vocabulary for source types.

## 10. Ideas that sound good but we should NOT adopt

- Dempster's rule of combination for source fusion (5.2): incoherent under high conflict per the cited analysis, and conflict between sources is our central case.
- Learned or iterative source-reliability weights in the resolution path (TruthFinder, CRH, LTM; 2.1): under-identified on one vendor case, assume independence, and Li et al. 2013 found no consistently best method and possible harm from wrong trust. Keep them offline.
- Automatic copy detection that changes a verdict (2.3): the best-known detector misfired in a measured domain. Advisory only.
- "AGM-compliant" as a claim or a dependency (6.2): author-run scenario sets and design-specific arguments; recovery fails for bases. Use the postulates as tests.
- Embedding-geometry decay of old facts (RoMem, 3.2): not auditable, deletes by attenuation, contradicts "supersede, never delete" and "which rule chose".
- A model in the write path of resolution (TOKI keeps one; LLM data fusion, 2.5): violates principle 2 and replay.
- LLM self-explanations as evidence of a match (1.6): measured weakly faithful.
- Zingg, dedupe, Ditto and AnyMatch as runtime dependencies (1.2, 1.6): label or GPU or Spark requirements, AGPL for Zingg, stale repos, Python, and no tested guard for near-duplicate discriminators. Use only as eval baselines.
- Probabilistic soft logic and subjective-logic fusion operators at runtime (5.1, 5.4): soft outputs and unjustified base rates conflict with ordinal-tag confidence; operator associativity is not guaranteed.
- Automerge or any last-writer-wins CRDT as the store (7): hides conflicts.
- Full Bayesian joint models (d-Blink class, 1.4) in the product: stale Spark code, heavy; use the idea (carry uncertainty) with discrete hypotheses.
- PROV-O as the internal data model (4.2): it cannot express conflict or confidence; export only.
- Knowledge Vault style calibrated fact probabilities (2.4): spec forbids uncalibrated probabilities, and we have no web-scale training signal.

## 11. Three research contributions a grant reviewer would value

1. Decision-level linkage uncertainty with identity-flip certificates. Contribution: a deterministic procedure that takes the `possible` band of an ER cascade, enumerates the admissible identity hypotheses under cannot-link constraints, evaluates a rule-based release decision under each, and returns either a verdict-invariance certificate or the minimal set of link judgements whose reversal changes the decision. It joins three literatures that, in what I read, are separate: linkage averaging (statistics), explanation by minimal change (our differentiator 2), and policy engines. Evaluation: planted identity-dependent cases, with cost and false-flag rate reported. Novelty is NOT VERIFIED beyond my partial search.
2. An open benchmark and generator for entity reconciliation with typed conflicts and planted dependence. Contribution: seeded cases labelled separately for evidence-silent, evidence-contradicts, different-entity, stale-update and extraction-error, with claim-level attribution, with an explicit origin DAG (mirrors, aggregators) and per-source reliability ground truth. This allows a study the Li et al. 2013 evaluation cannot answer: how deterministic authority tiers, majority vote, truth discovery and LLM fusion compare as the number of sources falls to the sparse regime of a single case and the copy rate rises. Report with cluster-bootstrap intervals. Publishing the negative results (where learned reliability fails) is itself valuable.
3. Proof-carrying reconciliation: verdicts that carry a provenance expression and conflict hypergraph and are re-checked by an independent verifier. Contribution: a standalone offline verifier that recomputes retraction, independent support, repair-semantics status and minimal flips from the bundle alone (no server code, no network), differentially tested against a logic-programming oracle (clingo) and a bitemporal SQL oracle. It makes "mechanically verified evidence" extend from quote fidelity (L0) to the reconciliation step, which the sources I read do not do.

## 12. What I could not verify

- Dempster-Shafer's Zadeh example: seen only in a search summary; the cited paper's abstract states incoherence in general.
- The companion paper "Truth Discovery and Copying Detection in a Dynamic World" and the original Fellegi-Sunter 1969 paper: seen only in listings or through the Binette-Steorts review.
- The PROV Constraints, SQL:2011 text and the XTDB engine behaviour beyond its README; XTDB's, SirixDB's and minigraf's claims are README claims.
- Every numeric result in sections 1.6, 2, 3.2: authors' claims, not replicated. I read evaluation sections only for Li et al. 2013 (partially), Dong et al. 2009 (introduction) and the Binette-Steorts review; all other papers were abstract-only.
- Whether GLEIF, SEC or registry histories are rich enough to fit the temporal-decay curves in 1.5.
- Whether `nomenklatura` can merge across an existing negative edge via some path other than `get_judgement`; I read only the functions named in 1.3.
- Licences: BODS schema, S2AND and dblink report NOASSERTION; M-TRACE, MatchGPT, ComEM and fastLink report none. Reuse of any of them is NOT VERIFIED.
- The TOKI, Engram, LatticeMind and RoMem repository links were not checked; LatticeMind's "ConflictBank" benchmark was not examined.
- Argumentation frameworks (ASPIC+, Dung) and PSL's usefulness for collective ER: no evidence gathered.
- The search for prior art on "decision-level linkage uncertainty" and on a silent-versus-contradicts ER benchmark was limited (arXiv API rate-limited, web-search budget exhausted). Absence in this file is not proof of novelty.
- No code from any repository was run, so no behavioural claim about Splink, nomenklatura, clingo or others is tested; they are source and README readings.
