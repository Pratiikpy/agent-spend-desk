# Best-in-world check of the kernel parts (2026-10-17)

Seven researchers (Sonnet), one per kernel part, were asked for the strongest products, repositories not among the 56 profiled, and papers, then what to copy, beat and watch. Each ran with a capped search tool, so they relied on the GitHub API, RFC and arXiv abstract pages and direct fetches. Stars, push dates and licences were read from the GitHub API on 2026-10-17. The researchers' links were not re-fetched by the reviewer, mechanisms were mostly taken from READMEs and titles (no source was read unless stated), and every vendor accuracy number is a vendor claim. NOT VERIFIED means exactly that. Licence rule as everywhere: MIT and Apache copy with credit; AGPL, BSL, SSPL, unlicensed or unknown licence are ideas only. Part ids follow the module list (M1 to M14).

## 1. Reconcile and document intelligence (M1 to M3)

- **Copy:** Splink (MIT) per-field match-weight breakdown; google/langextract (Apache-2.0) values mapped to source spans; Docling (MIT) typed document with provenance; Trino (Apache-2.0) connector contract; DocETL (MIT) pipeline operators; Magneto, arXiv 2412.08194, retrieve-then-rerank for schema remapping.
- **Ideas only:** Zingg (AGPL), MinerU (licence not detected).
- **Papers:** 2310.11244 (LLM entity matching, prompt-sensitive), 2405.16884 ("select" beats binary matching), 1502.03519 (Knowledge-Based Trust: separate extraction error from source error), 2408.09869 (Docling).
- **Beat:** products found return one merged answer; we keep every claim (value, source span, extractor, confidence, time, trust), show the conflict and the named rule that decided it, give three outcomes (match, non-match, ask a person), and are deterministic on rerun (Splink #2882 and Zingg #601 are non-deterministic).
- **Risks:** LLM matching is prompt-sensitive; span grounding on scans and faxes is unproven (LangExtract on OCR text NOT VERIFIED); no public benchmark for faxed clinical notes, so we build one; Zetaris capabilities beyond the REST smoke tests NOT VERIFIED.

## 2. Claim verification and explanation (M4)

- **Copy:** Google Check Grounding idea (claim spans in bytes, grounding flag; closed API, concept only); MiniCheck (Apache-2.0), IBM Granite Guardian (Apache-2.0) and LettuceDetect (MIT) as judge candidates; AIS and RAGTruth definitions; Anterior's decision ledger and escalate-by-default as a concept.
- **Avoid:** alibi (BSL, non-commercial grant), AlignScore and DiCE (stale), HHEM-2.3 (commercial only), Lynx repository (no licence).
- **Papers:** 2112.12870 (attribution), 2404.10774 (MiniCheck), 2401.00396 (RAGTruth), 1711.00399 (Wachter, counterfactual explanations), 2004.03685 (faithful interpretability), 1706.04599 (calibration).
- **Facts that shape the design:** Vectara HHEM-2.1-Open reports 31.86% recall on RAGTruth-Summ; the best public checker on LLM-AggreFact is Bespoke-MiniCheck-7B at 77.4% balanced accuracy (leaderboard date not shown). So a judge score alone cannot release anything.
- **Beat:** mechanical exact-span quote check before any model judge; tamper tests (number, date, negation, unit); published false-accept rate; calibrated abstention; minimal-flip sets by exact search over the policy criteria (design inference).

## 3. Memory, learning from overrides, and the jury (M5, M6)

- **Copy:** Cedar symbolic compiler `cedar-policy-symcc` (Apache-2.0) for the "never widens permissions" check, with Z3 (licence NOT VERIFIED) as backup; haizelabs/verdict (MIT) ensemble structure; Memento (MIT) case memory, arXiv 2508.16153; imodels (MIT) for rule proposals from overrides; Chronos as an optional forecasting tool (verified: amazon-science/chronos-forecasting, Apache-2.0, 6.1k stars; non-deterministic predictions are a known complaint, issue 18). "Kronos" is a different thing, not verified.
- **Papers:** 2404.15269 (PRELUDE, learning from edits), 2507.17131 (ARIA), 2403.04651 (Cedar), 2404.18796 (PoLL, diverse small judges beat one large judge on judging), 2506.07962 (correlated errors: both-wrong models agree about 60% of the time), 2508.17536 (majority voting explains most of debate's gain), 2509.23055 (sycophancy in debate), 2502.08788 (debate often fails to beat single-model baselines; heterogeneity helps).
- **Rule for the jury:** off by default; on only where a held-out set shows lift over the best single model, with error-overlap and voting-only baselines reported. No published jury lift exists for prior-authorization-style decisions: NOT VERIFIED, so we measure.
- **Beat:** Anterior and Pega claim feedback loops but publish no tested, confirmed rule step (NOT VERIFIED); we show replay of each candidate rule, the solver result, precedent and counter-precedent, and who confirmed.
- **Risks:** mapping a release decision into Cedar needs design; LLM-proposed rules overfit a few overrides; replay is only as good as the case history.

## 4. Policy engine, approvals and agent security (M5, M8, M13)

- **Copy (Apache or MIT):** Cedar and cedar-spec (Lean model, `cedar-lean-cli` analysis), cedar-for-agents schema generation from MCP tools, CaMeL capability tags (research code, Apache-2.0), FIDES labels (MIT, low maintenance), microsoft/agent-governance-toolkit (MIT) templates, OPA and Cerbos as reference engines.
- **Ideas only:** NeMo Guardrails and PurpleLlama (licence not detected). HumanLayer's repository is described as mostly deprecated: do not depend on it.
- **Papers:** 2503.18813 (CaMeL), 2505.23643 (FIDES), 2506.08837 (design patterns for securing agents), 2407.01688 (Cedar), 2505.03574 (LlamaFirewall), 2504.11168 (guardrails can be bypassed, so detectors are signals only).
- **Fact:** NeMo Guardrails has an open threat-model issue (2026-09-26) that tool messages skip input rails.
- **Beat:** provably restrict-only rule updates, a symbolic permissive-surface report, minimal-flip explanations and approval bound to the exact request hash, single-use and expiring (OpenClaw, profile 56, is the nearest precedent). None found together; not verified against full vendor docs.

## 5. Runtime and evaluation (M7, M11)

- **Verified data only** (mechanisms from memory, NOT VERIFIED): Temporal (MIT, 23.8k stars), DBOS Transact TS (MIT), Trigger.dev (Apache-2.0) are usable; Restate (BSL 1.1) and Inngest (SSPL) are rebuild only; Inspect AI, promptfoo, tau2-bench, garak, deepteam are MIT or Apache and usable as patterns or tools.
- **Papers:** 2411.00640 (error bars for evals), 2406.12045 (tau-bench), 2506.07982 (tau2-bench), 2306.05685 (MT-Bench judge), 2410.02736 and 2305.17926 (judge bias), 2301.09633 (prediction-powered inference), 1706.04599 (calibration). No verified paper found on synthetic data for evaluation.
- **Decision to settle:** adopt a durable engine (DBOS or Temporal) or build our own; a first evaluation should precede building one.
- **Beat:** idempotency key written before each side effect with reconciliation on resume, intervals on every rate, a test set frozen by hash before scoring, worst-of-three reporting, judge order-swap and bias checks. None of these were verified in competitors; that is a gap in what was checked.

## 6. Signed records, transparency and the desk (M9, M10)

- **Standards:** SCITT RFC 9943 and COSE Receipts RFC 9942 (both June 2026), Certificate Transparency RFC 9162, RFC 8785 JSON canonicalization, COSE RFC 9052, JWS RFC 7515, Sigstore (cosign, Rekor), in-toto and SLSA, Google AP2 mandates.
- **Copy (Apache or MIT):** Tessera and the witness and checkpoint formats, sigstore-js verification flow, `erdtman/canonicalize`, `panva/jose`, scitt-ccf-ledger as a reference. Reference only: humanlayer (licence not detected), cyberphone/json-canonicalization (licence not detected). Do not depend on `javascript-opentimestamps` (no push since 2023, open vulnerabilities).
- **Papers:** Crosby and Wallach 2009 (tamper-evident logging), DOI 10.1145/3319535.3345652 (transparency via authenticated dictionaries), Parasuraman and Manzey 2010 (automation bias), 2102.09692 (cognitive forcing functions reduce overreliance), 2109.05067 (human-oversight policies often fail).
- **Beat:** Sigstore and SCITT sign artifacts, not decisions; none found binds inputs, policy version, verdict and a human override in one verifiable record. We ship one small verifier, witnessed checkpoints and a published tamper corpus (flip an input hash, swap the policy version, drop an entry, fork the log, replay a receipt).
- **Desk design rule:** show the evidence and rule first and ask the approver for an independent judgment before the verdict; track approval time and agreement to detect rubber-stamping.
- **Not checked:** ServiceNow, Pega, Linear and Slack approval flows (NOT VERIFIED); W3C VC and C2PA specs.
- **Risks:** SCITT is new and tooling thin; witness networks are tiny so we may run our own; signing proves provenance, not correctness; health data must be hashed and salted.

## 7. Domain packs and rules (payer demo)

- **Seeds:** Synthea (Apache-2.0, FHIR, CSV, CPCDS) for synthetic patients; CMS DE-SynPUF synthetic Medicare claims; CMS NCCI edit files (free; no maintained open edit engine found, so build one); CUAD, 510 labelled contracts, CC-BY-4.0, for contract renewal; access and deletion requests are generated synthetically (open dataset not found). MIMIC-IV demo has 100 patients and no free-text notes; the full set is credentialed.
- **Specs and repos:** Da Vinci CRD v2.2.1, PAS and DTR (HL7 repositories, Apache-2.0 for DTR and the CRD/dtr mirrors), inferno davinci-pas-test-kit, CQL tooling (Apache-2.0), HAPI FHIR (Apache-2.0), Blaze. EDIReader is GPL-3.0: rebuild only. Open prior-authorization LLM repos are tiny; no serious open rival.
- **Products and rivals:** Anterior (decision ledger, per-criterion reasoning, escalates unless clearly met), Cohere Health, Machinify, Icertis, OneTrust. Their accuracy numbers are vendor claims.
- **Regulation (CMS fact sheet, fetched 2026-10-17):** CMS-0057-F: decisions in 72 hours (expedited) or 7 calendar days (standard), a specific reason for any denial, Prior Authorization API due 2027-01-01. NAIC AI model bulletin adopted 2023-12-04 (state adoption NOT VERIFIED). EU AI Act high-risk dates NOT VERIFIED. HIPAA: fully synthetic data is not PHI. California SB 1120 and other state AI-in-utilization-review laws: NOT VERIFIED, lawyer needed, as for CPT description copyright.
- **Pack rules that rivals skip:** the denial reason maps to the exact criterion id and policy version with the note excerpt; the system never denies (it approves or routes to a clinician); appeal replay against the policy version in force at the time; deadline clocks; criteria are versioned rules, never an unreviewed LLM reading of a policy.

## 8. What the pass changes in the design (for the architect)

1. Verifier: mechanical quote check first, entailment judge second, abstention third; publish false-accept rates (M4).
2. Rule learner: Cedar symcc or Z3 for the restrict-only proof; candidate rules replayed; Memento-style case memory for precedent (M5, M6).
3. Jury: switched on only by measured lift; report error overlap (M5, M11).
4. Record: COSE or JWS over RFC 8785 canonical JSON with a COSE receipt and witnessed checkpoints; tamper corpus shipped (M9).
5. Open decision: adopt DBOS or Temporal versus building the durable runtime (M7).
6. Packs: Synthea, DE-SynPUF, NCCI files and CUAD as seeds; criteria as versioned rules (M11, packs).
7. Still to check: ServiceNow, Pega, Linear and Slack approval flows; Zetaris limits; Perplexity, Cohere, FICO and Pega product pages (blocked or unreadable); a deeper read of the runtime and evaluation repositories, whose mechanisms were not verified.
