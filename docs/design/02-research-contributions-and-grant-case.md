# Research Contributions and Grant Case

Status: plan. Every contribution below is a **hypothesis with a falsifiable test**; none is a result. Novelty statements rest on limited literature searches (the web-search budget ran out during several research passes, 2026 items are unreviewed preprints, papers were read at abstract depth). The strongest wording permitted until a systematic search is done is "to our knowledge, the combination ...", never "unprecedented". Formal explanation, counterfactual analysis, data provenance and adversarial agent evaluation each have existing literature; the claim is the specific combination, its operational guarantees, and a reproducible evaluation.

Source research: `docs/design/prior-art/07` to `16`. Architecture: `docs/design/00-architecture-master-spec.md`. Event and funder requirements live in `docs/design/03-compliance-profiles.md`, not here.

## The case in one paragraph

Agents are being given authority over money and counterparties, and the field measures them with LLM judges, citation presence and demo transcripts. This programme asks how much of a consequential agent decision can be **checked by a stranger, without trusting the system that made it**, and where that checking stops. Evidence is hash-pinned and quotes are checked against stored text; conflicts are data; the policy is code with proved invariants; the explanation is an exactly computed minimal-evidence and minimal-flip set with certificates; memory changes only through replay-validated, human-approved proposals; the whole decision exports as a bundle with a standalone offline verifier. Each result ships as an openly released artifact with a benchmark and its negative results, so the value does not depend on the product succeeding commercially.

## Three research pillars

All 17 proposals stay in the roadmap; the three pillars give the programme one scientific story. Each pillar has a question, a success criterion, and an anchor contribution that is demonstrated deeply before the others are claimed.

### Pillar 1: Verifiable evidence-to-decision explanations

Question: which parts of a consequential decision explanation can be mechanically verified by an independent party, and which errors remain outside that guarantee?
Success: two independent verifiers pass shared vectors; the tamper corpus yields zero false accepts (reported with an exact upper bound, not "zero"); exact explanations match brute force and an SMT encoding on every test ledger; simulatability of our explanations beats LLM-rationale baselines against exact ground truth.
Contributions: **C1** exact, certified explanations of policy verdicts; **C2** the Decision Bundle specification, dual-implementation verifier and tamper corpus; **C7** proof-carrying reconciliation (the verifier recomputes retraction, independent support and repair-semantics status); **C12a** locator-fidelity benchmark for document parsers; **C14** audience-tiered, proof-preserving explanations.

### Pillar 2: Reconciliation under conflicting, stale and incomplete evidence

Question: when do deterministic authority and temporal rules outperform probabilistic matching, truth-discovery or LLM fusion on counterparty records, and where do they fail?
Success: a published benchmark that separates evidence-silent, evidence-contradicts, different-entity, stale-update, extraction-error and equal-authority cases with claim-level attribution, on which every method is scored with intervals, including the regimes where our method loses.
Contributions: **C5** the reconciliation and attribution benchmark and generator; **C6** decision-level linkage uncertainty with identity-flip certificates; (C7 spans Pillars 1 and 2).

### Pillar 3: Safe decision governance under adversarial input

Question: which architectural controls protect a payment decision independently of the model's ability to recognise an attack, and what do they cost in over-caution?
Success: the primary metrics are the extractor steer rate (injection-induced suppression of a hold-relevant fact, with an upper bound) and the false-escalation rate, reported with abstention rate, reviewer workload and time to decision on the same curve. Zero unauthorised releases under a model-controlling attacker follows from the gate's design and is a correctness check of the gate, not a research result; proofs of the policy invariants reproduce in CI; the role-necessity protocol publishes which roles earned their place.
Contributions: **C3** Plumbline-Inject and model-independent security certification of decision gates; **C4** verified-safe exploration and proof-carrying rule changes; **C8** consolidation-harm curve (proposal-only consolidation); **C9** outcome-weighted, rule-version-aware precedent memory with counter-precedents; **C10** exact blast-radius retraction; **C11** role-necessity protocol and decision-sensitivity-weighted verification budget; **C12b** decision-impact evaluation of document-borne injection with a visibility sanitiser; **C13** verified-evidence UI study and measured oversight efficacy; **C15** contract-localised failure attribution; **C16** deterministic simulation and replay with an impact-analysis protocol; **C17** selective-decision benchmark with a validated error bound.

## Anchor contribution cards

Each card states what would disprove it. Sample-size assumptions are explicit.

**C1. Exact, certified explanations.**
Hypothesis: robustly sufficient evidence and minimal flips are hitting-set duals computable exactly by re-running a pure policy function over a frozen ledger, and the results ship certificates that a separate verifier re-checks (08 §1).
Primary metric: exactness against brute force on random ledgers to 14 items and against an SMT encoding; secondary: disagreement rate between leave-one-out classes and exact classes; certificate tamper detection; simulatability precision against exact ground truth versus LLM rationales.
Data: seeded ledger generator with planted minimal sets (ground truth by construction); gold cases with human-written explanations for a simulatability study.
Baselines: leave-one-out, Shapley-style attribution, LLM-written rationales.
Ablations: with and without attribute decomposition, static-cone pruning, partial-completeness budgets.
Statistics: exact agreement counts with exact binomial bounds; cluster bootstrap over cases for any rate.
Disconfirmed if: exact results disagree with brute force on any test ledger, runtime is infeasible at realistic ledger sizes, or the verifier accepts a tampered certificate.
Guarantee boundary: exact relative to the frozen snapshot, recorded labels and policy function; not real-world causation. The "decision-relevant gap" statement says an unchecked source's possible values could change the verdict; it is not an expected value of information, which would need probabilities and costs we do not model.

**C2. Decision Bundle, dual verifier, tamper corpus.**
Hypothesis: a bundle layout plus a standalone verifier can re-check quotes, hashes, rule outcome, counterfactuals and ledger invariants offline, and mutation testing quantifies what it catches (13 §4).
Primary metric: false-accept and false-reject rate on a generated corpus of N valid bundles and M labelled mutations (byte flip in each member, truncated ledger, swapped evidence, changed rule, reordered claims, replaced checkpoint, broken canonical form, duplicate keys, zip-slip paths, cassette edited without manifest update).
Baselines: signature-only verification; hash-only verification.
Statistics: exact (Clopper-Pearson) upper bound on false-accept rate; with zero observed false accepts in n trials the 95% upper bound is about 3/n, so the corpus size is chosen to make that bound meaningful.
Disconfirmed if: any mutation passes, or two independent implementations disagree on a shared vector.
Boundary: the verifier proves consistency of the bundle with its own contents and declared assumptions; it does not prove the decision is right.

**C5. Reconciliation and attribution benchmark.**
Hypothesis: authority tiers plus temporal rules beat majority vote, truth discovery and LLM fusion on single-case sparse-source reconciliation, and the advantage shrinks as source count and copy rate rise (07 §11.2).
Primary metric: conflict precision and recall by type; entity false-merge rate; contradiction-detection recall with false-contradiction rates.
Data: seeded generator with an explicit origin DAG, per-source reliability ground truth, realistic prevalence (0.1, 1, 10 percent), perturbations modelled on a regulator's published sanctions test. Two annotators label natural conflicts (target kappa at least 0.8).
Sample size: estimating a recall near 0.8 within ±0.05 at 95% confidence needs about 246 positives; the worst case (recall near 0.5) about 385.
Baselines: Splink, nomenklatura, Watchman, a prompted LLM, a long-context prompt, majority vote, TruthFinder-style truth discovery.
Disconfirmed if: a baseline matches our method at a pre-registered margin on the primary metric.

**C3. Plumbline-Inject and model-independent gate certification.**
Hypothesis: a structural gate (trust lattice, role-typed release fields, restrict-only gate, capability refusal) holds against injection regardless of model robustness, and the only residual risk is authored deception, defeated by independent-source corroboration at a measurable availability cost (10 §F3).
Primary metric: attack success rate on state-based oracles (release occurred, field differed, egress left the allowlist), reported per attack family and tier of attacker, with positive controls (attacks succeed on an undefended baseline).
Method: adversary-controlled model port; exhaustive small-scope enumeration of the policy table; mutation testing of the gate; held-out seeds; benign twins to measure false holds.
Statistics: cluster bootstrap over base documents; exact bounds; 3/n for zero-success results.
Disconfirmed if: any attack changes a release field or causes a release in the structural arms, or the gate fails its own mutation tests.
Boundary: injection and authored deception are separate axes; a defence that holds one says nothing about the other.

## Roadmap contributions (tests in brief)

- **C4** simulator with ground truth; replay agreement versus propensity-based estimate; mutation suite of bad rule changes the gate must catch (09 §15).
- **C6** planted identity-dependent cases flagged, stable cases never flagged, cost within budget (07 §11.1).
- **C7** the verifier's recomputation of retraction, independent support and repair status agrees with clingo and a bitemporal SQL oracle (07 §11.3).
- **C8** consolidation-harm curve: unconstrained LLM consolidation versus proposal-only pipeline (11 §10.3B).
- **C9** ablation ladder with planted rule changes; stale-precedent-driven error rate (11 §10.3A).
- **C10** poisoning through the real write path; affected-set equality versus a full re-run (11 §10.3C).
- **C11** same accuracy and attack detection as a uniform-effort arm at a stated fraction of billed tokens; role-necessity arms with equivalence tests (12 §9, §13.3).
- **C12a** silent-wrong locator rate with by-construction ground truth; **C12b** injection decision-flip rate with the sanitiser on and off (14 §11.3).
- **C13** planted-error detection, time to decision and reliance calibration across three interface conditions; seeded-defect oversight catch rate (needs participants and ethics review) (14 §11.3, 15 §7B).
- **C14** no-leak test per audience tier; legal acceptability is LAWYER (15 §7C).
- **C15** attribution accuracy of typed validators versus an LLM attributor on injected faults (12 §13.3.2).
- **C16** replay corpus under proposed policy changes; identical state hash across N replays; comparison with LangGraph and Temporal implementations of the same case (13 §8.3).
- **C17** per-stratum auto-coverage, abstain rate and realised harmful-release rate with a 1,000-split validity check, including where the bound is vacuous (09 §15.3).

## Novelty search protocol (to run before any originality claim)

Databases: arXiv, ACL Anthology, ACM DL, IEEE Xplore, DBLP, Google Scholar, plus GitHub topic searches and the standards bodies (IETF, W3C, OWASP, NIST). Queries per contribution combine its core terms with synonyms (for example "robust sufficient reason", "abductive explanation", "minimal contrastive", "policy verdict", "audit bundle", "decision receipt", "entity resolution decision sensitivity", "counterparty document prompt injection benchmark"). Record each query, database, date, hit count and the screened-in prior work in `docs/design/prior-art/17-novelty-search-log.md`; inclusion needs a fetched abstract or paper page. Each contribution's claim is then rewritten as the delta over the closest prior work found. Contributions 3, 4 and 11 are the likeliest to have unseen priors.

## Reusable open modules (released separately from the product)

`source-channels` (typed evidence, cassettes, doctor; closes Agent Reach's gaps), `explain-core` (C1), `decision-bundle` spec and `verify` tool (C2), `policy-ir` with SMT encoder (C4), `plumbline-inject` (C3), `plumbline-bench` generator and scorers (C5, C17), `locator-bench` (C12), `tamper-corpus` (C2). Apache-2.0 or compatible; third-party code declared; vendored Meterless harness files stay unmodified with attribution.

## Evaluation protocol common to all claims

Pre-registration committed before each ablation; cluster bootstrap over cases; exact bounds for proportions; 3/n for zero-event results; worst of three runs for LLM-judged items; paired arms; positive controls; judge-free state oracles for security; surfaces and cases not covered listed in every report; any number we did not run ourselves is not quoted. Every contribution card states its disconfirming result before the run.

## Product validation (separate from research)

The research is only worth funding if the problem is real. The claim that release-time identity reconciliation has no single owner is a premise, not a finding. `docs/design/04-practitioner-validation-plan.md` defines the interviews that test it: what AP, procurement, third-party-risk and compliance teams do today, which systems they use, what failures cost, which existing tools cover part of this, and what evidence they would need to trust a system like ours. Grant text uses only what those interviews and the cited primary sources support.

## Funder mechanics (not legal advice)

- Open licences and open standards are expected (NLnet: "Software, hardware and content must be released under open licences"); the artifacts above are chosen to be separately releasable.
- **Generative-AI disclosure and prompt log.** NLnet's policy (version 1.1, 26 January 2026) requires disclosure of GenAI use and a prompt provenance log (model, dates and times, prompts, unedited output), and does not pay for purely AI-generated work. Plumbline is being built with AI coding assistants. A history cannot be reconstructed afterwards: **start the prompt log now** (a dated log under `docs/`, plus `docs/sponsors/cursor-usage-log.md` for Cursor sessions) and plan the funded work around human-directed design, evaluation and review. Other funders' requirements were not read (**UNVERIFIED**).
- An applied-AI reviewer will want (synthesis, not a verified funder list): reproducibility from a clean checkout, a written evaluation protocol, a safety or risk case, data governance and licence clarity for every dataset, open outputs, and honest limitations.
- Regulatory framing must not overclaim: no "AI Act compliant" (Annex III lists no vendor-release use; scoping questions are LAWYER), SR 11-7 is rescinded (SR 26-2), NIST and ISO are coverage mappings, not compliance.
- Impact statements use only the primary-source figures in `prior-art/15` §2, each with its caveat; there is no primary-source cost figure for releasing payment to the wrong counterparty and none is published.

## Funder fit and scope

Only NLnet's policy was read; its initial grants are in the range of EUR 5,000 to 50,000 (as summarised from its page), against 17 contributions and 13 modules. Thematic fit is not assessed. The funded request is scoped to the three anchor cards (C1/C2, C5, C3); everything else is own-funded roadmap. Other funders are unread (UNVERIFIED).

## Risks to the case

Breadth can read as a list of ideas; the defence is the three pillars with one deeply demonstrated anchor each (C1/C2, C5, C3) and the rest as roadmap. Several contributions need human participants (C13) or a lawyer (C14). Novelty may fail on a fuller search. Product need is unvalidated until the interviews are done. Everything depends on the build passing its gates; until then this is a plan.
