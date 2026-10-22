# Prior art 09: Decide module research (policy engines, formal analysis, calibrated abstention, counterfactual rule evaluation, precedent)

Status: research input to `docs/design/00-architecture-master-spec.md` sections 10 and 16. Nothing here is built. Every design sketch is a proposal with a named test; anything not shown by a cited source or a command I ran is marked NOT VERIFIED.

## 0. Method, and what this file does not cover

- Repository numbers come from `gh api repos/OWNER/NAME` run on 2026-10-13. npm facts come from `registry.npmjs.org` metadata (no package was installed or cloned). Source files were read through `gh api` contents only.
- Every paper below was opened at its arXiv abstract page (or publisher page) with WebFetch on 2026-10-13; the URL given is the page fetched. Search-engine summaries were used only to find candidates; numbers that appeared only in a search summary are not used. Abstract pages show claims, not results: where I say "reports", I mean the abstract reports it; I did not reproduce any experiment.
- One paper was renamed after submission: arXiv 2508.00500 is listed by the search engine as "Pro2Guard" and by its current abstract page as "ProbGuard". I use the current title.
- Not covered: Zanzibar's original paper (not fetched, so not cited), classic XACML analysis, legal-CBR classics (HYPO/CATO), Bayesian rule lists, semantic-entropy work, and any systematic novelty search. "Novel" in section 15 means "I did not find it in the sources above", not "novel to the literature".
- Items derived by me (not from a source) are tagged DERIVED so a reviewer can attack them separately.

## 1. Where the current spec is weak (so the research below has a target)

1. Section 10 has a deterministic rule engine but no way to show a rule set is safe: no proof that "release above the cap needs CRO approval" holds for every case, only tests.
2. Section 10.5 promotes autonomy on a Wilson lower bound. A Wilson interval is a fixed-sample interval; checking it repeatedly as shadow cases accumulate is peeking and the stated confidence is no longer true. (See D3.)
3. Section 10.6 and differentiator 3 replay a proposed rule over past cases and report precision and recall "against human decisions". That measures imitation of humans, not outcome value, and it silently ignores cases where the logged action differs and no outcome exists. (See section 11.)
4. Section 10.3 outcome weighting: only released cases ever get an outcome; held and rejected cases stay `unknown`. Precedent ranking therefore learns from a selected sample (survivorship bias) and can reinforce itself. (See section 12.)
5. Confidence is an ordinal tag with no abstention guarantee. Section 16.6 promises a calibration report but no bound. (See section 10.)
6. A per-case cap can be defeated by splitting one purchase into several; the invariant must be stated over cumulative exposure. (See section 9.3.)

## 2. Policy engines and authorization languages

### 2.1 Cedar (AWS) and its formal analysis: the strongest fit

- What it is: an authorization policy language (permit/forbid, default deny, forbid overrides) with a Rust evaluator, a Lean model of the semantics, and a symbolic compiler (SymCC) that turns policy questions into SMT.
- Repos (gh, 2026-10-13): `cedar-policy/cedar` 1780 stars, Apache-2.0, pushed 2026-10-09. `cedar-policy/cedar-spec` (Lean model, differential testing, `cedar-lean-cli`) 213 stars, Apache-2.0, pushed 2026-10-12. `cedar-policy/cedar-for-agents` 54 stars, Apache-2.0, pushed 2026-10-07. npm `@cedar-policy/cedar-wasm` 4.13.0, Apache-2.0, last modified 2026-09-15.
- Papers: "Cedar: A New Language for Expressive, Fast, Safe, and Analyzable Authorization", https://arxiv.org/abs/2403.04651 (submitted 2024-03-07). Abstract: formalized in Lean, implemented in Rust, compared favourably with OpenFGA and Rego on readability and performance. "How We Built Cedar: A Verification-Guided Approach", https://arxiv.org/abs/2407.01688 (2024-07-01): executable model, mechanical proofs, differential random testing of production code against the model; reports 25 bugs found (4 in the validator during proofs, 21 elsewhere by testing). "SymCert: Verifying SMT-based policy analyses" (FMCAD 2026), https://www.amazon.science/publications/symcert-verifying-smt-based-policy-analyses: Lean framework with a verified symbolic compiler, hierarchy enforcer and counterexample extractor; reports verifying five AWS analyses in one day. The page lists one author (Torlak); co-authors may be omitted by the page.
- What SymCC can check (from `cedar-policy-symcc/README.md`): policy never errors, policy set always allows, always denies, subsumption (`check_implies`), equivalence, disjointness, each with a `*_with_counterexample` variant that returns a synthesised request and entity store. The README states the compiler and verifiers are "formally modeled and verified in Lean". The crate source has a decimal extension-type file (`src/symcc/extension_types/decimal.rs`), so numeric extension types are at least present; whether every construct we would use is supported is NOT VERIFIED.
- The question asked: could Cedar's WASM prove "no rule set can release above the cap without CRO approval"? Findings, each from a file I read:
  - `cedar-wasm/Cargo.toml` depends on `cedar-policy`, `cedar-policy-core` (features `wasm`, `partial-eval`) and `cedar-policy-formatter`. A grep of that file for `symcc` found nothing. So the npm WASM package gives evaluation and schema validation in-process, not SMT analysis.
  - SymCC is a separate crate that needs a cvc5 1.3.1 executable (README: `CVC5=<path>`). `cedar-lean-cli` needs Lean, cvc5, Rust, protoc (or Docker). `cedar-for-agents/js/cedar-analysis-mcp-server` wraps this in a Docker image. None of this runs in a judge's one-command Node process; it can run in CI and produce committed proof artefacts.
  - The property is expressible: `forbid` a release when `context.amount > resource.cap` unless the approvals set contains the CRO role, then check that the policy set is disjoint from a "bad region" permit (amount above cap, no CRO). `analyze compare` and `check_implies` give tightening/loosening classification for rule changes (`cedar-lean-cli` README, "Analyze Compare": equivalent, more permissive, less permissive or incomparable per request type).
- Fit to Plumbline Decide: two uses, not one. (a) As an independent cross-check: compile the stateless fragment of our own rule IR (section 9.1) to Cedar text plus schema in CI and require SymCC's verdict to agree with our own Z3 verdict. (b) As the argument that "the verifier of the verifier" is itself verified: Cedar's own team documents the method we copy (executable model plus differential testing).
- Limits and risks: Cedar returns allow/deny plus determining policies only, so approvals, autonomy caps, reason codes and obligations must be encoded as separate actions or context fields. Cedar has no cumulative state, so the split-purchase invariant is outside it. Lean verification covers the Lean model; the Rust crate is tied to it by differential testing (per the VGD paper), so the claim is "verified model plus tested implementation", never "verified Rust". Windows support for the cvc5 toolchain is NOT VERIFIED. cedar-wasm is not adopted as our engine: we need obligations and path state in the IR.

### 2.2 Z3 and cvc5, proof certificates, Alethe and Carcara

- Z3: `Z3Prover/z3` 12776 stars, pushed 2026-10-13. GitHub reports licence NOASSERTION; `LICENSE.txt` begins "MIT License". npm `z3-solver` 5.2.0, MIT, last modified 2026-08-21. Its README says Z3 ships as WASM, high-level Z3Py-like API plus low-level API, needs `SharedArrayBuffer` (threads), and requires `killThreads` to let Node exit. Runs in-process in TypeScript.
- cvc5: `cvc5/cvc5` 1370 stars, pushed 2026-10-13, modified BSD (COPYING). Listing of `src/api` shows c, cpp, java, python and no JS directory; I found no first-party WASM package (an npm lookup of `cvc5-wasm` returned nothing usable). So cvc5 is native-only for us.
- Proof checking: Alethe is an SMT proof format emitted by veriT and cvc5 ("Alethe: Towards a Generic SMT Proof Format", https://arxiv.org/abs/2107.02354, 2021). Carcara (`ufmg-smite/carcara`, 47 stars, Apache-2.0, pushed 2026-10-13) is an independent Rust checker for Alethe. Whether cvc5's Alethe output covers the theory fragments we use (linear integer arithmetic, enums as datatypes) is NOT VERIFIED.
- Idea: a proof is only as good as its trusted base. Three independent routes to the same invariant verdict: (1) our Z3 encoding, (2) Cedar SymCC through cvc5 (Lean-verified compiler), (3) exhaustive cell enumeration (section 9.2, DERIVED, no solver in the trusted base). Optional: cvc5 Alethe proof checked by Carcara for the headline invariant.
- Limits: solver bugs exist; unsat answers from Z3 are not independently checkable without proof objects; WASM performance on our rule sizes is NOT VERIFIED (expected small).

### 2.3 Open Policy Agent and Rego

- `open-policy-agent/opa` 12357 stars, Apache-2.0, pushed 2026-10-13. `open-policy-agent/npm-opa-wasm` 159 stars, Apache-2.0, pushed 2026-07-10; npm `@open-policy-agent/opa-wasm` 1.10.0, last modified 2024-11-08.
- Idea: Rego compiled to WASM, evaluated in Node. Strong ecosystem, `opa test`, partial evaluation.
- Fit: weak. A code search for "smt" in the OPA repo returned 24 hits, all unrelated substrings (JWT tests, Go SDK files); I found no first-party SMT policy analyser. The Cedar paper (2403.04651) compares against Rego; the claim of an analysability advantage there is the authors' own and not independently checked by me. Rego is also a second language beside our IR. Not adopted.

### 2.4 Cerbos

- `cerbos/cerbos` 4621 stars, Apache-2.0, pushed 2026-10-13; description now says it governs "AI agents" among other things. npm `@cerbos/embedded` 0.15.4, Apache-2.0, modified 2026-07-14; its npm description reads "Client library for interacting with embedded Cerbos policy decision points generated by Cerbos Hub".
- Idea: YAML policies with CEL conditions, policy unit tests, derived roles.
- Fit: the embedded path depends on artefacts generated by a hosted service (per that description), which breaks the offline one-command run; the open server is a separate process. No SMT analysis found (not exhaustively searched). Borrow only the idea of policy test fixtures as first-class files. Not adopted.

### 2.5 Casbin

- `casbin/node-casbin` 2921 stars, Apache-2.0, pushed 2026-10-09; `casbin/casbin` (Go) 20449 stars; npm `casbin` 5.51.1, last modified 2026-06-25. npm dependencies include `@casbin/expression-eval`.
- Idea: PERM metamodel (request, policy, effect, matcher) for ACL, RBAC, ABAC.
- Fit: models "who may touch what", not numeric threshold logic with obligations. Matchers are evaluated as expressions by a library; I did not audit that library, so its sandboxing is NOT VERIFIED. No formal analysis found. Not adopted.

### 2.6 json-rules-engine and Drools

- `CacheControl/json-rules-engine` 3143 stars, ISC, pushed 2026-02-16; npm 7.3.1 last modified 2025-02-20. `apache/incubator-kie-drools` 6335 stars, Apache-2.0, pushed 2026-10-13.
- Idea: json-rules-engine expresses rules as JSON condition trees (all/any/not with operators), which is easy to translate to SMT; Drools is a Rete production-rule system on the JVM.
- Fit: json-rules-engine's facts can be async functions, so evaluation is not a pure function of the case; the engine has no analysis. Borrow only the JSON condition-tree shape as a serialisation of our IR. Drools needs a JVM and a different runtime. Neither adopted as engine.

### 2.7 Zanzibar-style relationship engines

- `openfga/openfga` 5959 stars, Apache-2.0, pushed 2026-10-07; `authzed/spicedb` 7144 stars, Apache-2.0, pushed 2026-10-13; npm `@openfga/sdk` 0.9.7.
- Idea: relationship tuples plus a userset-rewrite schema answer "is X related to Y" at scale.
- Fit: our relationship questions (is the approver in the vendor owner's reporting chain, does the approver share a bank account or address with the vendor) live in the World Model and are a few hops over a small graph. Both engines are servers; adding one would break the one-command rule for no gain. Encode relationship conflicts of interest as IR predicates over World Model facts. Not adopted.

### 2.8 clingo (answer-set programming)

- `potassco/clingo` 850 stars, MIT, pushed 2026-10-13; `domoritz/clingo-wasm` 47 stars, Apache-2.0, pushed 2026-09-10; npm `clingo-wasm` 0.6.0, modified 2026-08-06.
- Idea: declarative constraint programs with stable-model semantics; good for "find all minimal explanations" and workflow assignment.
- Fit: possible later for enumerating minimal sets of conflicting rules or approver assignments. Z3 already covers invariants and satisfiability, so a second solver stack is not justified now. Not adopted at this stage.

## 3. Runtime enforcement and governance for agents (2025 to 2026)

### 3.1 AgentSpec (ICSE 2026)

- What: a DSL of rules with triggers, predicates and enforcement mechanisms evaluated around agent actions. https://arxiv.org/abs/2503.18666 (submitted 2025-03-24, last revised 2025-07-31; ICSE'26 pages 2938-2950). Authors Wang, Poskitt, Sun.
- Reported: unsafe execution prevented in over 90% of code-agent cases, all hazardous embodied-agent actions eliminated, 100% compliance for autonomous vehicles, millisecond overhead. LLM-generated rules: 95.56% precision for embodied agents, 87.26% risky-code identification, but only 5 of 8 (62.5%) legal-compliance scenarios for autonomous vehicles.
- Code: `haoyuwang99/AgentSpec` 62 stars, no licence declared, pushed 2026-01-15. Whether this is the paper's official repository is NOT VERIFIED.
- Fit: validates our rule-then-LLM ordering and the trigger/predicate/enforce decomposition; our IR rule record should carry the same three parts (`when`, `predicate`, `enforce`). The weak 62.5% figure supports keeping LLM-drafted rules as proposals only.
- Limits: benchmarks are code, embodied and driving agents, not business decisions. Rule coverage by a hand-written or generated DSL is exactly what no abstract measures.

### 3.2 ProbGuard (formerly Pro2Guard), ASE 2026

- What: learns a probabilistic model of agent behaviour from traces and intervenes pre-emptively when the predicted chance of a violation passes a threshold. https://arxiv.org/abs/2508.00500 (2025-08-01, final version 2026-08-03; ASE'26). Authors Wang, Poskitt, Wei, Sun.
- Reported: advance warning of violations on driving and household-robot tasks; strictest setting cut unsafe behaviour by 93.60% at a "larger cost in completion". An earlier summary mentioned PAC guarantees; the current abstract does not, so that claim is NOT VERIFIED.
- Fit: path-dependent early warning (a vendor's cumulative releases drifting toward the cap) as an advisory signal that lowers autonomy, never as the gate. Not adopted as a gate: a learned model needs traces we do not have and cannot be proved.

### 3.3 ShieldAgent (ICML 2025)

- What: a guardrail agent that extracts rules from policy documents into probabilistic rule circuits, plans checks and verifies agent action trajectories. https://arxiv.org/abs/2503.22738 (2025-03-26, revised 2025-11-27). Authors Chen, Kang, Li. Introduces ShieldAgent-Bench (3,000 instances, per abstract).
- Fit and limits: it puts an LLM-extracted, probabilistic rule base in the enforcement path. Our principle 2 ("models propose, code disposes") forbids that. Useful idea: group rules by action type so only relevant rules are consulted; our IR indexes rules by `action`. Not adopted.

### 3.4 VeriGuard (Google)

- What: an offline stage clarifies intent, synthesises a behavioural policy and verifies it; an online stage checks every proposed action against the pre-verified policy. https://arxiv.org/abs/2510.05156 (2025-10-03). Authors Miculicich et al.
- Fit: the same "verify once, check cheap online" split we plan. Their policy language is code in another ecosystem; I do not adopt its verifier. Evidence is a framework paper; I did not check its benchmark.

### 3.5 Progent (UC Berkeley): the closest match to our rule-change gate

- What: tool-level privilege control with symbolic policies; an LLM may propose policy updates, and an SMT solver decides whether an update only narrows privileges (applied automatically) or expands them (needs approval), giving monotonic confinement. https://arxiv.org/abs/2504.11703 (submitted 2025-04-16, v3 revised 2026-05-14).
- Code: `sunblaze-ucb/progent` 53 stars, MIT, pushed 2026-09-24 (Python).
- Fit: this is the missing piece of spec section 10.6: classify every proposed rule change as tightening or loosening by solver, and route loosening to a stricter approval tier. See the design in section 9.4.
- Limits: it governs tool calls, not decisions with numeric thresholds; its evaluation is attack success rate versus utility on agent benchmarks.

### 3.6 Runtime Governance: Policies on Paths

- https://arxiv.org/abs/2603.16586 (2026-03-17), Kaptein, Khan, Podstavnychy. Formalises a policy as a deterministic function of agent identity, partial execution path, proposed next action and organisational state, returning a violation probability. Names risk calibration as an open problem.
- Fit: justifies stateful rules (cumulative exposure per vendor per window, count of recent exceptions per approver) as first-class in the IR, and states precisely the gap our conformal layer (section 10) fills: calibrating the violation probability.
- Limits: conceptual and a reference implementation; no calibration study.

### 3.7 AgenticRei: deontic policies

- https://arxiv.org/abs/2606.19464 (2026-06-17; ICWS 2026), Joshi, Finin, Joshi, Kagal. Policies in OWL evaluated by a logic engine outside the LLM; adds obligations with lifecycle, dispensations that waive them, and meta-policies for precedence. States that XACML, Rego and Cedar cover only permit/prohibit.
- Fit: we need obligations ("after release, notify within a window", "release above cap is obligated to have CRO approval"), dispensations (temporary waiver, itself an approval item) and explicit precedence between rules. Adopt the vocabulary in the IR; do not adopt OWL or a semantic-web stack.
- Limits: 10-page paper; no quantitative comparison seen in the abstract.

### 3.8 AgentBound: verifiable governance receipts

- https://arxiv.org/abs/2606.30970 (2026-06-29, revised 2026-07-01), Kaul, Lan, Gupta. Each action is judged by three independent authorities (delegated authorisation, owner-signed behavioural constitution, site action contracts) and yields a cryptographically verifiable governance receipt.
- Fit: supports differentiator 1 (offline-verifiable dossier). Add a signed `DecisionReceipt` listing rule ids and versions, invariant-proof ids, calibration bound, approvers, and hash of the case snapshot.
- Limits: abstract only; threat model and key management not assessed.

### 3.9 Structural authorization in multi-agent pipelines

- https://arxiv.org/abs/2609.17648 (2026-09-15; IEEE CARS 2026), Safin, Zisad, Shatabda, Hasan. Four-agent LangGraph pipeline attacked by shared-memory poisoning and prompt injection; signed task-bound tokens plus a policy oracle contained compromised-agent actions even when upstream LLM judgement failed.
- Fit: evidence for "structure beats votes" in section 17. Limits: three seeds and 60 labelled tasks per the abstract: small.

### 3.10 MakerChecker and the four-eyes control

- `makerchecker/MakerChecker` 53 stars, AGPL-3.0, pushed 2026-10-05: a gateway that enforces that the agent proposing an irreversible action cannot approve it. The licence makes it read-only inspiration for us. Blog posts on separation of duties for agents exist (vendor content, not assessed).
- Design in section 9.5: segregation of duties as verified IR constraints.

### 3.11 LLM-assisted policy authoring: AutoCedar, autoformalization, ARc, P2T, Logic-LM, SatLM

- AutoCedar: https://arxiv.org/abs/2607.03656 (2026-07-04), Vatsa, Shome, Zhou, Eiers. Natural-language requirements become reviewable "intent atoms"; after human review, a model drafts Cedar, a verifier checks it against the approved target, failures become repair signals. Reports convergence on all 221 CedarBench tasks (the authors' own benchmark) plus three case studies. Convergence to the checked target is not correctness of the target; the human intent review carries that.
- "Autoformalization of Agent Instructions into Policy-as-Code": https://arxiv.org/abs/2606.26649 (2026-06-25; ICML 2026 AIWILD workshop), Mondl, Maisel, Brock. Generator-critic loop (hard critic: syntax, schema, contradictions; soft critic: LLM judge) producing Cedar; reports more coverage of the source specification than hand-coded enforcement on MedAgentBench. Workshop paper; coverage is not correctness.
- ARc: "A Neurosymbolic Approach to Natural Language Formalization and Verification", https://arxiv.org/abs/2511.09008 (2025-11-12, revised 2026-07-13), An, Bayless, Buliani, Cassel, Cook and others. Redundant LLM formalisations are checked for semantic equivalence; reports over 99% soundness and near-zero false positives. Agreement among redundant translations raises confidence in the formalisation; it does not prove it matches intent. The evaluation data are the authors'.
- P2T: "Executable Governance for AI: Translating Policies into Rules Using LLMs", https://arxiv.org/abs/2512.04408 (2025-12-04; AAAI-26 workshop). Policy documents to normalised rules in a DSL (hazards, scope, conditions, exceptions); HIPAA-derived example. Initial framework paper.
- Logic-LM, https://arxiv.org/abs/2305.12295 (EMNLP 2023 Findings), and SatLM, https://arxiv.org/abs/2305.09656 (NeurIPS 2023): an LLM translates a problem into symbolic form and a solver answers; SatLM states the answer is correct with respect to the parsed specification. The guarantee is conditional on the translation.
- Fit: these are the pattern for Plumbline's dreaming proposals (section 10.6): the LLM may draft a rule from a policy document or from a cluster of human overrides; everything after drafting is deterministic (type-check, SMT diff, invariants, replay) and ends at a human. Adopt the "intent atoms reviewed before code" step from AutoCedar and the hard-critic/soft-critic split from the autoformalization paper.
- Limits: all of the above verify against a specification an LLM or human wrote; none shows the specification is right. Our acceptance test must therefore plant wrong-but-consistent rules and require the human-review artefact to expose them.

## 4. Conformal prediction, risk control and selective decisions

### 4.1 Conformal Risk Control and Learn then Test

- Conformal Risk Control: https://arxiv.org/abs/2208.02814 (2022-08-04, latest 2025-06-13; ICLR 2024), Angelopoulos, Bates, Fisch, Lei, Schuster. Controls the expected value of any monotone loss; tight up to O(1/n); extensions for distribution shift and multiple risks.
- Learn then Test: https://arxiv.org/abs/2110.01052 (2021-10-03, latest 2022-09-29), Angelopoulos, Bates, Candes, Jordan, Lei. Recasts calibration as multiple hypothesis testing and gives finite-sample, high-probability guarantees for risks, with no model refitting.
- Code (gh): `aangelopoulos/ltt` 74 stars, MIT, pushed 2024-11-17; `aangelopoulos/rcps` 89 stars, MIT, pushed 2024-02-01; `aangelopoulos/conformal-prediction` 1100 stars, MIT, pushed 2025-11-14; `scikit-learn-contrib/MAPIE` 1602 stars, BSD-3-Clause, pushed 2026-10-13 ("prediction intervals and controlling risks"); `henrikbostrom/crepes` 584 stars, BSD-3-Clause, pushed 2026-07-08.
- TypeScript: an npm search for "conformal prediction" returned only v0.1.0 packages from 2025 to 2026 (for example `@wlearn/uncertainty`, `statcore`); none is mature enough to depend on. Write our own (about 150 lines: quantile with the (n+1) correction, binomial tail, fixed-sequence test) and golden-test it against MAPIE and crepes outputs on shared vectors.
- Fit: the central tool for the "stated error-rate bound with abstain region" requirement; full design in section 10.
- Limits: guarantees are marginal over the calibration draw and need exchangeability between calibration and deployment cases; they say nothing about one vendor.

### 4.2 Conformal factuality, coherent factuality, C-RAG, conformal language modelling

- Language Models with Conformal Factuality Guarantees, https://arxiv.org/abs/2402.10978 (2024-02-15; ICML 2024), Mohri, Hashimoto: treat correctness of an output as set membership, then back off to a less specific output until the guarantee holds; reports 80 to 90% correctness guarantees while keeping most of the output on QA and MATH.
- Conformal Language Model Reasoning with Coherent Factuality, https://arxiv.org/abs/2505.17126 (2025-05-21), Rubin-Toles et al.: steps must be judged in logical context using deducibility graphs; reports 90% factuality under the stricter definition while keeping 80% or more of claims on MATH and FELM.
- C-RAG, https://arxiv.org/abs/2402.03181 (2024-02-05; ICML 2024), Kang, Gurel, Yu, Song, Li: certifies an upper confidence bound on generation risk of retrieval-augmented models, including under shifts; shows lower risk than the bare LLM when retrieval and model are non-trivial.
- Conformal Language Modeling, https://arxiv.org/abs/2306.10193 (2023-06-16; ICLR 2024), Quach et al.: calibrated stopping and rejection rules over sampled outputs; code `Varal7/conformal-language-modeling` 31 stars, no licence, last push 2023-12-21.
- Fit to Decide: the claim ledger (spec section 9) already has typed claims with verification layers. Use the back-off idea at the decision boundary: only claims whose verifier score passes a conformally calibrated threshold may become rule inputs ("promoted facts"); a rule whose required fact is not promoted produces a gap and escalation, not a guess. The coherent-factuality graph maps onto the claim DAG (a claim depending on an unverified claim is dropped with it).
- Limits: calibration needs claim-level correctness labels; the benchmarks are QA and math, not entity-record reconciliation; claims inside one document are correlated, so guarantees are stated per case, not per claim. C-RAG's bound is a statement about its retrieval-and-generation setup; I did not check how tight it is on small calibration sets.

### 4.3 KnowNo: ask for help when the conformal set is not a single choice

- Robots That Ask For Help, https://arxiv.org/abs/2307.01928 (2023-07-04; CoRL 2023 oral), Ren et al.: the LLM proposes options with confidences; conformal prediction yields a set; if it has more than one option the system asks a human. Statistical guarantee on task completion with fewer help requests than baselines, with no fine-tuning.
- Fit: the template for our abstain rule: auto only if the calibrated set over allowed actions is a singleton and inside the rule-allowed set.
- Limits: robotic planning with multiple-choice options; guarantee is on completion in their calibrated setting.

### 4.4 Conditional coverage and drift: why a marginal guarantee is not enough

- Conformal prediction with conditional guarantees, https://arxiv.org/abs/2305.12616 (2023-05-22, revised 2024-09-16; JRSSB 2025 per the search metadata, not checked), Gibbs, Cherian, Candes: exact conditional coverage is impossible in finite samples; they give exact coverage over any finite-dimensional class of covariate shifts (for example named subgroups).
- Conformal prediction beyond exchangeability, https://arxiv.org/abs/2202.13415 (2022-02-27, final 2023-03-17), Barber, Candes, Ramdas, Tibshirani: weighted quantiles to handle drift, with a coverage-gap bound.
- Cost-Sensitive Conformal Prediction and Human-in-the-Loop Abstention, https://arxiv.org/abs/2607.27143 (2026-07-29), Singh, Srikantha, Lakhanpal: 15 imbalanced tabular datasets; reports that marginal conformal coverage can fall to 0.5% on a minority class and that Mondrian (class-conditional) calibration improves minority coverage by 61.7 percentage points. Tabular benchmarks, not compliance; the effect size is for those data.
- Fit: the rare, costly class (reject, sanctions hit) is exactly where marginal coverage fails. Calibrate per stratum (rule family by amount band by policy version) and drop to abstain when a stratum has too few calibration cases.
- Limits: more strata means fewer points each; section 10.3 gives the minimum counts.

### 4.5 Conformal Decision Theory

- https://arxiv.org/abs/2310.05921 (2023-10-09, revised 2024-05-02), Lekeufack, Angelopoulos, Bajcsy, Jordan, Malik: calibrate the decision directly (a parameter of the decision rule) with provable low-risk guarantees, without prediction sets and without i.i.d. assumptions; examples include switching between a nominal and a safe backup policy at run time.
- Fit: the closest to our actual need, because our output is a decision, not a label set. Use for an online "caution dial": a scalar that widens the abstain region after observed harmful releases and relaxes slowly after quiet periods, with the paper's long-run risk guarantee as the stated property.
- Limits: the guarantee is a long-run average, delivered on the authors' tasks; it does not bound a particular week.

### 4.6 Calibration of LLM confidence, abstention surveys

- Just Ask for Calibration, https://arxiv.org/abs/2305.14975 (2023-05-24; EMNLP 2023), Tian et al.: for RLHF models, verbalised confidence was better calibrated than token probabilities on standard benchmarks (about 50% relative error reduction in their setting).
- Can LLMs Express Their Uncertainty?, https://arxiv.org/abs/2306.13063 (2023-06-22, revised 2024-03-17; ICLR 2024), Xiong et al.: five LLMs show systematic overconfidence; consistency-based aggregation helps; black-box confidence remains a weak ranker (the fetched summary reports AUROC values in 0.522 to 0.605; consult the paper for which methods).
- Know Your Limits: A Survey of Abstention in LLMs, https://arxiv.org/abs/2407.18418 (2024-07-25, latest 2025-02-12; TACL), Wen et al.: organises abstention by query, model and human values.
- Fit: conformal guarantees hold whatever the score, so a poor score only widens the abstain region. Treat LLM-verbalised confidence as one optional feature, ablated against rule-derived features (evidence coverage, unresolved conflicts, precedent agreement, necessity from L4). The rule brain gives a score with no model credentials.
- Limits: none of these gives a guarantee; they only motivate not trusting raw LLM probabilities.

### 4.7 Learning to defer, cascades, human-AI complementarity

- Consistent Estimators for Learning to Defer to an Expert, https://arxiv.org/abs/2006.01862 (2020; ICML 2020), Mozannar, Sontag: jointly learn a classifier and a rejector from expert decisions with a consistent surrogate loss. Code `clinicalml/human_ai_deferral` 23 stars, no licence, pushed 2024-01-08. Predates 2023 but is the base reference.
- Language Model Cascades: Token-Level Uncertainty and Beyond, https://arxiv.org/abs/2404.10136 (2024-04-15), Gupta et al.: learned post-hoc deferral rules from token-level uncertainty beat simple aggregation; length bias in sequence-level scores. Cost-quality trade-off, not safety.
- Designing Decision Support Systems Using Counterfactual Prediction Sets, https://arxiv.org/abs/2306.03928 (2023-06-06, latest 2024-07-16; ICML 2024), Straitouri, Gomez Rodriguez: show experts a conformal set and have them choose from it; online learning of the set's size; a human study with 2,751 participants found that limiting experts' agency to the set gave better accuracy than unrestricted choice.
- Fit: when we abstain, hand the reviewer the calibrated set and the reasons, not a bare "escalate". Do not copy the "restrict the reviewer to the set" result: it comes from image classification, and a compliance reviewer must always be able to choose hold or reject.
- Limits: a learned rejector needs expert-labelled data and is consistent only asymptotically; for a small case base the conformal route is preferable. Complementarity gains were measured on perception tasks.

## 5. Counterfactual and offline policy evaluation (rule proposals)

### 5.1 Doubly robust evaluation

- Doubly Robust Policy Evaluation and Optimization, https://arxiv.org/abs/1503.02834 (2015-03-10; Statistical Science 2014), Dudik, Erhan, Langford, Li: combines a reward model with importance weighting; accurate if either the reward model or the propensity model is good.
- Code: `st-tech/zr-obp` (Open Bandit Pipeline) 713 stars, Apache-2.0, last push 2024-06-03; paper https://arxiv.org/abs/2008.07146 (NeurIPS 2021 D&B). `py-why/EconML` 4812 stars, licence reported NOASSERTION, pushed 2026-10-12; `py-why/dowhy` 8353 stars, MIT, pushed 2026-10-13. All Python; no TypeScript implementation found. The estimators are a few lines; write them in TypeScript and differential-test against OBP.
- Limits: needs the logging propensity. With a deterministic rule engine as the logger, propensities are 0 or 1 and positivity fails (section 11).

### 5.2 High-confidence off-policy evaluation

- High-Confidence Off-Policy Evaluation, AAAI 2015, Thomas, Theocharous, Ghavamzadeh, https://ojs.aaai.org/index.php/AAAI/article/view/9541: a lower confidence bound on a new policy's return from importance-weighted returns, using a concentration inequality built for heavy-tailed weights.
- Fit: the right shape of statement for approving a rule: "with probability at least 1-delta the new rule's value is at least L", valid at small n but conservative.

### 5.3 Off-policy confidence sequences

- https://arxiv.org/abs/2102.09540 (2021-02-18; ICML 2021), Karampatziakis, Mineiro, Ramdas: bounds valid uniformly over time and at arbitrary stopping times; applied to "gated deployment" of an upgraded contextual-bandit system.
- Fit: exactly the shadow-mode promotion problem. It replaces the Wilson interval of spec section 10.5, which is not valid under repeated checking. See section 11.4.
- Limits: contextual-bandit setting with known propensities; bounds are wider than fixed-sample ones.

### 5.4 Deterministic logging policies

- Counterfactual Learning with General Data-generating Policies, https://arxiv.org/abs/2212.01925 (2022-12-04), Narita, Okumura, Shimizu, Yata: evaluation when the logging policy is deterministic or ML-based; reports convergence to the true value of the counterfactual policy and an application to coupon targeting. The assumptions that make it work are not in the abstract: read the paper before relying on it (NOT VERIFIED).

### 5.5 Unobserved confounding and selective labels

- Confounding-Robust Policy Improvement, https://arxiv.org/abs/1805.08593 (2018; NeurIPS 2018), Kallus, Zhou: minimise worst-case regret against a baseline over an uncertainty set of propensity weights controlled by a confounding bound; a safe fallback to the baseline when the data do not support improvement.
- The Selective Labels Problem, KDD 2017, Lakkaraju et al., https://pmc.ncbi.nlm.nih.gov/articles/PMC5958915: outcomes are seen only for cases the human decision-maker accepted. Their "contraction" method needs several decision-makers, random assignment of cases to them, and differing acceptance rates (as reported by the fetched summary).
- Fit: both describe our data. Contraction suggests a cheap evaluability design: randomly assign borderline cases among reviewers with different strictness and log it.
- Limits: sensitivity bounds are worst-case and can be uninformative; contraction needs real reviewer heterogeneity, which a demo with one reviewer does not have.

## 6. Precedent, case-based reasoning, rule learning

### 6.1 Memento

- https://arxiv.org/abs/2508.16153 (2025-08-22), Zhou et al.: an agent keeps a case bank of past trajectories and a neural case-selection policy updated from feedback, framed as a memory-augmented MDP, with no LLM fine-tuning. Reports top-1 on GAIA validation. Code `Agent-on-the-Fly/Memento` 2595 stars, MIT, pushed 2025-10-05.
- Fit: confirms the case-bank design; the learned retrieval policy suggests learning which precedents were useful. Our retrieval stays deterministic and explainable (spec 10.3); a learned selector would be proposal-only.
- Limits: research-agent benchmark, not decisions with irreversible effects; retrieval learned from reward has the survivorship problem in section 12.

### 6.2 CBR-RAG

- https://arxiv.org/abs/2404.04302 (2024-04-04; ICCBR 2024), Wiratunga et al.: structure retrieval with the CBR indexing vocabulary and similarity containers for legal QA; reports better answers than plain retrieval.
- Fit: gives the vocabulary for precedent records: indexed features, a similarity measure per feature, and the Retrieve, Reuse, Revise, Retain cycle. In Plumbline Revise is a human override and Retain is the gated memory write.
- Limits: legal QA; no outcome weighting.

### 6.3 CORELS (rule lists)

- `corels/corels` 178 stars, GPL-3.0, pushed 2026-08-15: certifiably optimal rule lists. Licence rules out linking it into a permissively licensed product. Idea only: proposal generation could search for small, optimal rule lists over override clusters instead of free-form LLM drafting. Paper not fetched, so not cited.

## 7. Decision records

- MADR (`adr/madr` 2552 stars, GitHub licence NOASSERTION, pushed 2026-08-28) template sections: Context and Problem Statement, Decision Drivers, Considered Options, Decision Outcome (Consequences, Confirmation), Pros and Cons of the Options, More Information. `npryce/adr-tools` 5730 stars (last push 2024-04-25) and `thomvaill/log4brains` 1602 stars, Apache-2.0 (last push 2024-12-17) are tooling around the same idea.
- Fit: every rule change is an ADR. Generate a machine-readable MADR record per `rule_proposal` item with sections filled from computed evidence (SMT classification, replay and OPE verdict, approvals); "Confirmation" becomes the list of invariant proofs and tests re-run. Adopt the section names only; do not depend on the tools.

## 8. Cross-cutting findings

- Everything that verifies LLM-written policy verifies it against a specification someone else wrote. The only defence is the reviewed intent artefact plus adversarial tests that plant wrong-but-consistent rules.
- No source I fetched combines a formal rule-change gate with statistical evaluation on logged outcomes. Progent and Cedar compare give the first; the OPE papers give the second; the join is open (section 15).
- No fetched source shows an LLM-agent decision system with a stated error bound and an abstain region validated by repeated-split simulation on its own data. Components exist (4.1 to 4.5); the validation protocol (section 10.5) is ours.

## 9. Design: policy IR with verified invariants (special attention i)

### 9.1 Types and semantics

```ts
type Field = { name: string; kind: 'int' | 'bool' | 'enum'; values?: string[]; lo?: number; hi?: number };
type Term = { t: 'field'; name: string } | { t: 'const'; v: number } | { t: 'add'; args: Term[] };
type Expr =
  | { t: 'cmp'; op: '<' | '<=' | '==' | '>=' | '>'; l: Term; r: Term }
  | { t: 'in'; field: string; values: string[] }
  | { t: 'and' | 'or'; args: Expr[] } | { t: 'not'; arg: Expr };
type Obligation =
  | { kind: 'approval'; role: string; distinctFrom: ('proposer' | 'requester' | 'rule_author')[] }
  | { kind: 'post'; action: string; withinHours: number };
type Rule = {
  id: string; version: number; action: string;
  when: Expr; effect: 'permit' | 'forbid'; requires?: Obligation[];
  maxAutonomy?: 'L0' | 'L1' | 'L2' | 'L3'; reason: string; // reason code is data
};
// concrete semantics: default deny; any firing forbid removes the action; requires accumulate from firing permits
type Verdict = { allowed: Set<string>; required: Obligation[]; fired: string[]; maxLevel: string };
```

- Two interpreters of one AST: `evaluate(rules, case) -> Verdict` (the runtime) and `encode(rules) -> SMT` (the verifier). Integers are minor currency units. The encoder is about 200 lines of straight-line translation.
- Encoder trust: DERIVED process copied from Cedar's published method (2407.01688): generate random cases; evaluate concretely; pin the same case in the solver and read the model; require 100% agreement over at least 10^5 cases per release, plus a mutation test that breaks one encoder clause and must be caught. Every `sat` answer is replayed through `evaluate` before being shown, so a false counterexample cannot be reported.

### 9.2 Properties, and three independent checks

| Id | Property | Query |
|---|---|---|
| I1 | release above cap needs CRO approval | assert release in allowed and amount > cap and CRO approval not in required; expect unsat |
| I2 | forbid cannot be overridden | for every action, a case matching any forbid is never allowed |
| I3 | no rule set yields an empty reason | every verdict has a non-empty `fired` list |
| I4 | proposer cannot be sole approver | any verdict requiring approval has an approver set that excludes the proposer |
| I5 | liveness | the approval requirement is satisfiable with the configured roster (sat) |
| I6 | cumulative cap (stateful, 9.3) | one-step inductive invariant |

- Check A: Z3 (`z3-solver` WASM, in-process, optional verification tier so the runtime core keeps zero dependencies).
- Check B: Cedar SymCC through cvc5 in CI for the stateless fragment (I1 to I4), compiled from the same IR. Disagreement fails the build.
- Check C (DERIVED, no solver): when all atoms are threshold comparisons on single fields or enum membership, the rule set partitions the case space into finitely many cells. For each numeric field take every threshold constant c and the points c-1, c, c+1 plus domain bounds; for each enum take every value; enumerate the product (cells grow multiplicatively; with 8 fields and four thresholds each this is about 5^8 = 390,625 numeric cells before enum factors, which is feasible). A 100-line verifier with no solver in its trusted base checks the property on every cell. Not applicable to sums across fields; those use A and B.
- Output: `proofs/<ruleset-hash>/` containing SMT-LIB text, solver name and version, query id, result, ruleset hash, IR hash; the offline dossier verifier re-runs Check C and, if `z3-solver` is present, Check A. Optional: cvc5 Alethe proof for I1 checked by Carcara (coverage NOT VERIFIED).

### 9.3 Cumulative exposure (the split-purchase hole)

- State: `E` = released amount to a vendor group within a rolling window. Rule: a release is permitted only if `E + amount <= cap` or the CRO approval obligation is attached. Invariant: after any transition, `E <= cap` or a CRO approval covers the excess.
- Proof shape: one-step induction. Assume the invariant for state s; encode the transition for an arbitrary case; show it for s'. Linear integer arithmetic, decidable. Bounded windows are an abstraction of the real ledger; the abstraction must be tested against ledger replays. Vendor grouping (several entities that the World Model merges or links) is an input; if entity resolution is wrong, the proof is about the wrong group.

### 9.4 Rule-change gate (from Progent and Cedar compare)

```ts
type ChangeClass = 'tightening' | 'loosening' | 'incomparable' | 'equivalent';
type RuleProposal = {
  id: string; base: string /* ruleset hash */; candidate: string;
  classByAction: Record<string, ChangeClass>;       // SMT: candidate implies base, or reverse
  invariants: Record<string, 'proved' | 'violated' | 'unknown'>;
  counterexample?: Case;                            // replayed through evaluate()
  evaluation: OpeVerdict;                           // section 11.3
  approvalsRequired: Obligation[];                  // derived from classByAction
};
```
- Algorithm: for each action, check `allowed_candidate subset of allowed_base` (tightening) and the converse (loosening); equivalent if both. Tightening needs one approver; any loosening needs two distinct approvers plus the CRO if I1 or any cap field is touched; any `violated` invariant blocks submission. A proposal that cannot be classified (`unknown`, timeout) is treated as loosening.
- Plugs in at: `decide/` dreaming output to approval queue (spec 10.5, 10.6). The proposer is never an approver (I4).

### 9.5 Segregation of duties and four-eyes

- Constraints in the IR: proposer is not approver; requester is not approver; approvers are distinct principals and distinct lines of reporting; rule author is not rule approver; no approver is linked to the vendor (shared bank account, address, or ownership edge in the World Model). Roster changes are themselves approval items.
- Verification: I4 (no verdict allows a single party to both propose and approve) and I5 (approval is satisfiable; otherwise the control deadlocks and operators bypass it). The access-control literature calls the latter the workflow satisfiability problem; I did not fetch a source, so no citation.
- Limits: all checks are about the policy; whether the identities behind the roles are really distinct people is outside the system.

### 9.6 What the proofs do not cover

- The encoder and the solver; the truth of the case facts (reconciliation errors make I1 vacuous); that every `release` code path takes an `Approved<T>` (checked by types and the trace linter, not SMT); clock and window handling; humans colluding; rules that are correct but wrong for the business. Report these beside every proof in the UI.

## 10. Design: selective release with a stated bound (special attention ii)

### 10.1 What can be guaranteed, in plain terms

- Layer order, fixed: rule engine allowed set, then calibrated selective gate, then autonomy gate. The statistical layer can only move a decision toward human review; it never adds an action the rules forbid. This keeps the composed statement simple: among cases the rules allow, the auto-released ones are wrong at most alpha of the time, with confidence 1 - delta.
- "Wrong" must be defined by a label source: human adjudication panel, later outcome, or (in the demo) planted ground truth in the synthetic silos. The demo bound therefore holds for the synthetic generator's distribution, not for the world. The README and UI must say so.

### 10.2 Algorithm A: threshold with a high-probability bound (Learn then Test, fixed-sequence)

1. Score `s(x)` in [0,1]: higher means riskier. Built from rule-derived features (unresolved conflicts, evidence gaps, necessity of fragile evidence from L4, precedent counter-weight); optionally an LLM-verbalised confidence as an ablated extra.
2. For threshold lambda, auto-release region `R(lambda) = {x : release allowed by rules and s(x) <= lambda}`; harmful event `H` = auto-released case whose adjudicated label is not release.
3. Test thresholds from most conservative to least. For each, compute the exact binomial (Clopper-Pearson) upper confidence bound on the harmful rate among calibration cases inside `R(lambda)`; the first lambda whose bound exceeds alpha stops the sequence; the previous lambda is chosen. Fixed-sequence testing controls the family-wise error across thresholds (the LTT framework, 2110.01052).
4. Selective-risk reading ("of the cases we auto-release, at most alpha are harmful") is the conditional variant. Conditioning on the auto-region membership, which depends only on features, keeps the labels in that subset independent; I believe the binomial bound is then valid for the selective risk. This is DERIVED, not quoted from the paper, and must be validated by simulation (10.5) before it is claimed. The unconditional variant (harmful auto-releases per case) is covered directly by conformal risk control (2208.02814).

Minimum calibration size with zero observed harmful releases (exact binomial, computed by me with `ceil(ln(delta)/ln(1-alpha))`):

| alpha | delta = 0.10 | delta = 0.05 |
|---|---|---|
| 0.10 | 22 | 29 |
| 0.05 | 45 | 59 |
| 0.02 | 114 | 149 |
| 0.01 | 230 | 299 |

- Each count is cases inside the auto-region, not total cases. One observed harmful case raises the requirement substantially. A synthetic gold set of a few hundred auto-eligible cases can certify 5% at 90% confidence; it cannot certify 1% unless nearly all auto-eligible cases are clean.

### 10.3 Algorithm B: conformal set over actions (the abstain-to-human region)

```ts
type Stratum = { ruleFamily: string; amountBand: string; policyVersion: string };
type CalPoint = { stratum: Stratum; score: number /* 1 - p(true action | x) */; caseCluster: string };
type SelectiveDecision =
  | { mode: 'auto'; action: string; set: [string]; bound: Bound }
  | { mode: 'abstain'; set: string[]; why: 'set_not_singleton' | 'stratum_too_small' | 'shift_alarm' | 'rule_forbids_singleton'; bound: Bound };
type Bound = { kind: 'LTT' | 'CRC' | 'split-conformal'; alpha: number; delta?: number; nCal: number; stratum: string; assumption: 'exchangeable-within-stratum' };
```
- Split conformal with the finite-sample correction: threshold is the `ceil((n+1)(1-alpha))/n` empirical quantile of calibration scores; set `C(x)` contains every allowed action whose score is within it. If `n < 1/alpha - 1` the quantile index exceeds n and the set must be all actions: a stratum is too small and the system abstains (`stratum_too_small`). For alpha = 0.1 that means at least 9 cases per stratum; useful sets need many more.
- Auto only if `|C(x)| = 1`, that action is in the rule-allowed set, and the autonomy cell permits it. Otherwise abstain and show the reviewer the set, the score terms and the nearest counter-precedents (Straitouri-style set, but with hold and reject always selectable).
- Cluster handling: calibration points from the same vendor are not independent. Split calibration and test by vendor cluster, never by case. A leaked vendor makes the guarantee optimistic.

### 10.4 Drift, strata and the alarm

- Strata (4.4): rule family by amount band by policy version. A policy change opens a new stratum with an empty calibration set, so it starts in abstain mode until calibrated. This is a strictly safer default than reusing old calibration across versions.
- Recency weighting (Barber et al., 2202.13415) is optional inside a stratum; its coverage gap bound depends on how fast the distribution moves and is not free.
- Conformal decision theory (2310.05921) supplies an online caution dial on top: after observed harmful auto-releases, shrink the auto-region; relax slowly. A harmful release also demotes the autonomy cell (spec 10.5).
- Shift alarm: rolling coverage of the set on shadow-labelled cases; if realised miscoverage over the last m cases exceeds a pre-registered limit, force abstain. The alarm test should be sequential (section 11.4), not a repeated fixed-sample test.

### 10.5 Validation protocol (the claim is tested, not asserted)

1. Generate the synthetic gold set with a seed; hold out vendor clusters.
2. Repeat 1,000 times: random split by cluster, calibrate, measure realised harmful rate on the held-out part, record whether it exceeded alpha.
3. Report: fraction of splits where the bound was violated (must be at most delta, with a Clopper-Pearson interval on that fraction), mean auto-coverage (fraction auto-decided), abstain rate by stratum, and the same numbers per planted conflict type. Worst-of-three for any LLM-scored feature (spec section 12).
4. Negative controls: shuffled labels must collapse auto-coverage to near zero; an injected shift mid-stream must trip the alarm within a stated number of cases.
5. Limits stated in the report: exchangeability is assumed within strata; synthetic labels; reviewer disagreement is label noise and is not modelled unless the generator plants it.

### 10.6 Where it plugs in, and what it replaces

- New module `decide/selective.ts` between "judgement confined to allowed set" and the autonomy gate; the bound goes into the decision record and the UI banner ("auto-released: at most 5% of such cases harmful at 90% confidence, calibrated on N cases in this stratum under policy vX; assumes exchangeability").
- Replaces: Wilson-at-checkpoint as the promotion statistic (11.4) and the "ordinal confidence tag" as the autonomy input (the tag remains for display).

## 11. Design: safe rule proposal by counterfactual evaluation (special attention iii)

### 11.1 Problem statement

A candidate rule defines a new policy pi' over cases. Question: would adopting it have improved outcomes, using only logged decisions? The log is generated by a mostly deterministic logger (the current rules plus human overrides), and outcomes exist only for some actions.

```ts
type LoggedDecision = {
  caseId: string; cluster: string; ts: string; x: Features; ruleVersion: string;
  action: string;
  mu: number | null;                       // logging probability of `action` given x; null = deterministic or unknown
  randomized: 'none' | 'audit_sample' | 'reviewer_assignment';
  outcome: { observed: boolean; harm: 0 | 1 | null; observedBecause: 'released' | 'audited' | 'none' };
  reviewer?: string;
};
type OpeVerdict =
  | { kind: 'evidence_of_improvement' | 'inconclusive' | 'evidence_of_harm';
      estimate: number; lowerBound: number; ess: number; method: 'DR-clipped' | 'IPS-clipped' | 'confidence-sequence';
      overlap: { evaluable: number; unevaluable: number; examples: string[] } }
  | { kind: 'unevaluable'; reason: 'no_support' | 'ess_below_floor' | 'no_outcomes'; unevaluableShare: number };
```

### 11.2 What the current "replay against human decisions" measures

| Metric | Answers | Fails when |
|---|---|---|
| Agreement with logged human decision (precision, recall) | would the rule have copied the humans | the humans were wrong, inconsistent or biased |
| Outcome value by direct replay | what the rule would have caused, assuming outcomes under unchosen actions equal those seen | rule changes actions where no outcome was ever observed |
| IPS or DR with known propensities | the value under the stated assumptions | positivity fails; weights explode; confounded overrides |

### 11.3 Procedure (the order is the safety property)

1. Classify the change by SMT (9.4). Loosening proposals face the stricter bar below.
2. Compute the disagreement set `D = {i : pi'(x_i) != action_i}`. For each, check support: `mu` known and positive for the action pi' would take. Report `evaluable` and `unevaluable` counts separately and list examples. No number is produced for the unevaluable part; if its share exceeds a pre-set limit the verdict is `unevaluable`. This is the single most important rule, because a deterministic logger never took the actions a new rule most wants to change.
3. On the evaluable part, for a deterministic target rule the importance estimator reduces to matching: `V_hat = (1/n) * sum_i [action_i == pi'(x_i)] * r_i / mu_i`, with weights clipped at a stated cap. The doubly robust form adds a cross-fitted reward model `q_hat`: `V_hat = (1/n) * sum_i [ q_hat(x_i, pi'(x_i)) + [action_i == pi'(x_i)] * (r_i - q_hat(x_i, action_i)) / mu_i ]` (Dudik et al., 1503.02834). Report effective sample size `(sum w)^2 / sum w^2`; it is the number of matched cases, not the log size. Example: with mu = 0.1 and 200 logged cases, only about 20 are matched and ESS is at most about 20.
4. Lower bound on improvement: empirical-Bernstein-style bound with clipped weights (Thomas et al., AAAI 2015) at small n; bootstrap intervals are not used, because importance-weighted estimates are heavy-tailed and the bootstrap is unreliable there (standard statistical caution; no source fetched).
5. Sensitivity: for cases decided by human override, bound the effect of unobserved confounding with a Kallus-Zhou-style uncertainty set (1805.08593); if the lower bound crosses zero at a modest confounding level, the verdict is `inconclusive`.
6. Multiplicity: dreaming proposes many candidates; picking the best on the same data inflates apparent gains (winner's curse). Treat each candidate's claim as a hypothesis and use fixed-sequence or Bonferroni control across candidates (the Learn then Test view, 2110.01052), or evaluate winners on a later time slice they were not mined from.
7. Leakage: proposals mined from closed cases must be evaluated on cases excluded from mining (time split, split by vendor cluster).
8. Output goes to the approval queue as a `rule_proposal` item with an ADR (section 7). Nothing is activated by a passing verdict.

### 11.4 Anytime-valid promotion (shadow mode)

- Shadow-mode evidence arrives continuously and humans will look at it often. Off-policy confidence sequences (2102.09540) give a lower bound on the new policy's advantage that is valid at every look. Promote a rule or an autonomy cell only when the sequence's lower bound clears the pre-registered margin. The same construction supports the shift alarm in 10.4. This replaces the Wilson check of spec 10.5.

### 11.5 Evaluability by design: governed audit sampling

- Because the log is deterministic where it matters, create propensities on purpose, inside the verified safe set: for a small fraction of cases in a borderline band, randomise between actions that the verified rule set already permits (for example 2-eyes versus 4-eyes review, or review versus auto when both are allowed), log the randomisation probability, and never randomise into a forbidden action. Because I1 to I5 are proved, exploration support is a subset of the permitted set by construction (see section 15).
- Also randomise reviewer assignment among reviewers of differing strictness; this is what the contraction method needs (5.5).
- Cost: a controlled amount of extra human review; ethics and operational acceptance are a deployment decision, off by default in the demo and shown in a synthetic simulation.

### 11.6 Small-sample pitfalls, listed so each gets a test

- Positivity failure: deterministic logger gives mu in {0,1}; nothing to weight.
- Weight explosion: a single case with mu = 0.01 contributes up to 100/n; clip, report bias, and show the unclipped sensitivity.
- ESS far below n; bootstrap invalid; Wald intervals invalid.
- Selective labels: no outcome for held or rejected cases; harmful-hold costs (lost business) are not recorded either.
- Unobserved confounding in human overrides (reviewers knew things not in the features).
- Outcome delay and censoring: a payment's harm may appear months later; evaluate only on matured windows.
- Clustering: cases per vendor are correlated; use cluster-level resampling or cluster-robust bounds; with few clusters, intervals are unreliable.
- Reward definition drift and Goodhart: a rule that games the metric (hold everything) has zero harm; always report cost of holds and throughput beside harm.
- Feedback loops: today's decisions create tomorrow's precedents (section 12).
- Multiple comparisons and temporal leakage (11.3 items 6 and 7).

### 11.7 Tests (acceptance)

- Known-answer simulation: build a simulator with a known better rule and a known propensity; the procedure must declare improvement with the stated error rate over 1,000 repetitions, and must declare `unevaluable` when the simulator's logger is made deterministic.
- Differential test of IPS and DR against OBP on shared vectors (OBP is Python; run once offline, commit expected values).
- Adversarial proposals: a rule that copies the old rule; a rule that holds everything; a rule that exploits a leaked feature; each must be rejected or flagged.

## 12. Design: precedent memory without survivorship bias

- Problem: spec 10.3 weights precedents by outcome `o` in [-1, 1], with `unknown` as zero. Released cases get outcomes; held and rejected ones do not. Retrieval then sees a sample in which "release" is over-represented among resolved precedents, and each new decision feeds the next retrieval.
- Fix 1: store `outcome.observedBecause` and the logging propensity with each precedent (11.1). Weight precedent outcomes by inverse probability of being observed when that probability is known (audit samples), and expose `unknown` as its own category in the explanation rather than as zero.
- Fix 2: always return counter-precedents (already in spec) and show the share of retrieved precedents with unknown outcome. If most are unknown, the support score carries a visible "weakly informed" flag and cannot raise autonomy.
- Fix 3: a kNN nonconformity score built from retrieved precedents (distance-weighted outcome mix) can feed Algorithm B; exclude same-vendor and same-cluster precedents from the calibration scoring to avoid leakage.
- CBR vocabulary (6.2): Retrieve (gate on similarity first), Reuse (only inside the rule-allowed set), Revise (human override recorded as a new precedent with `revised_from`), Retain (gated write with provenance, supersession not deletion).
- Limits: inverse weighting needs known observation probabilities; without audit sampling the correction is impossible and the system must only say "weakly informed".

## 13. Ranked top 10 ideas to adopt or extend

1. Typed policy IR with two interpreters (runtime and SMT), invariants I1 to I6 proved in Z3 and cross-checked by exhaustive cell enumeration, with encoder differential testing and a committed proof bundle (9.1, 9.2). It turns "rules are code" into "rules have proved properties", at zero runtime dependencies for the core.
2. Rule-change gate: SMT classification of every proposal as tightening or loosening, tiered approvals, segregation of duties and liveness checks (Progent 2504.11703, Cedar compare; 9.4, 9.5).
3. Selective release with a Learn then Test bound and a conformal abstain region, per-stratum, validated by 1,000-split simulation (10.2 to 10.5).
4. Counterfactual evaluation of proposed rules with an explicit `unevaluable` verdict, ESS, clipped DR, high-confidence lower bound, sensitivity and multiplicity control (11.3).
5. Anytime-valid promotion and shift alarms through off-policy confidence sequences, replacing the Wilson check (11.4).
6. Governed audit sampling inside the proved-safe action set to create logged propensities (11.5).
7. Survivorship-corrected, counter-precedent-first precedent memory with `unknown` as a first-class state (12).
8. Stateful policies and obligations in the IR: cumulative exposure with an inductive invariant, obligations, dispensations and explicit rule precedence (3.6, 3.7, 9.3).
9. Cedar SymCC cross-check in CI for the stateless fragment, giving a Lean-verified second opinion (2.1).
10. Conformal retention of claims at the Explain-Decide boundary, with the claim DAG as the coherence structure (4.2), plus signed decision receipts and MADR-style rule ADRs (3.8, 7).

## 14. Ideas that sound good but we should not adopt

- Running Cedar's WASM as the policy engine and calling it "formally verified": the WASM build has no analysis; the proof needs a native cvc5 process; Cedar cannot hold obligations or cumulative state. Use it only as a cross-check.
- OPA/Rego, Cerbos, Casbin, Drools, OpenFGA/SpiceDB as engines: no formal analysis found, an extra language or server, and (Cerbos embedded) a hosted-service dependency per its npm description. Reasons in 2.3 to 2.7.
- LLM-extracted or learned rule circuits in the enforcement path (ShieldAgent, learned DTMC gates in ProbGuard): violates "models propose, code disposes" and cannot be proved. Use as advisory signals only.
- Treating verbalised LLM confidence as a probability for autonomy: documented overconfidence (2306.13063) and no guarantee. Use as one ablated feature.
- A learned rejector (learning to defer) as the first abstention mechanism: needs expert labels and gives only asymptotic consistency; conformal bounds hold in finite samples.
- Restricting reviewers to the conformal set (Straitouri result): comes from perception tasks; in compliance it hides the safe option.
- Replay agreement with humans as accuracy or as rule value: imitation, not outcome (11.2).
- Wilson interval re-checked at every look: invalid under peeking.
- Auto-activating a rule because OPE passed: OPE needs untestable assumptions; a human gate stays.
- "Verified agent" claims: we verify rule sets and encoders; reconciliation, model judgement, identities and wiring are outside (9.6).
- CORELS or MakerChecker as dependencies: GPL-3.0 and AGPL-3.0.
- Immature npm conformal packages (all v0.1.0): write and golden-test our own.
- A full OWL/Rei deontic stack: take the vocabulary (obligation, dispensation, precedence), not the stack.
- Claiming the demo bound holds in the real world: it holds for the synthetic generator only.

## 15. Three research contributions a grant reviewer could value

1. Verified-safe exploration for evaluable governance. Use the proved invariants to restrict randomisation to the permitted action set, log propensities, and evaluate proposed rules with valid off-policy bounds. The contribution is the coupling: proofs make exploration safe, exploration makes statistical evaluation of rules possible, and a deterministic rule engine otherwise makes it impossible. Deliverable: the construction, a simulator with ground truth, and a measured comparison of "replay agreement" versus the propensity-based estimate showing when they disagree. Novelty status: I did not find this combination in the sources fetched; not a systematic search.
2. Proof-carrying rule changes. A rule-change certificate bundling the SMT tightening/loosening classification, re-proved invariants, the counterfactual verdict with its explicit unevaluable region, the segregation-of-duties approvals and the ADR, verifiable offline by a small script. Progent has the first element, Cedar has comparison tooling, the OPE literature the third; I found no source joining them. Deliverable: certificate format, verifier, and a mutation suite of bad rule changes it must catch.
3. A selective-decision benchmark with a validated error bound. On the open reconciliation benchmark (spec 16.5) with planted "evidence silent" versus "evidence contradicts" cases, publish the per-stratum auto-coverage, abstain rate and realised harmful-release rate with the 1,000-split validity check, plus the survivorship-corrected precedent ablation. The contribution is the validation protocol and the negative results (where the bound is vacuous or strata are too small), which no cited work reports for an agentic decision system.

## 16. What I could not verify

- Whether SymCC supports every Cedar construct we would emit (decimal type present in the source tree; full coverage unchecked); whether the cvc5 and Lean toolchain runs on Windows.
- Whether cvc5's Alethe proofs cover our theory fragment and Carcara accepts them.
- `z3-solver` WASM behaviour and speed on our rule sizes, and Z3 proof-object checking.
- The assumptions of Narita et al. (2212.01925) beyond its abstract; PAC claims for ProbGuard in its final version.
- Whether `haoyuwang99/AgentSpec` is the official AgentSpec repository; no official ShieldAgent or AutoCedar repository was located by search.
- SymCert's full author list (the page showed one name) and whether the JRSSB publication note for 2305.12616 is correct (from search metadata, not the arXiv page).
- Licences: MADR, EconML and Z3/cvc5 are reported as NOASSERTION by GitHub; Z3 and cvc5 were read from their licence files, MADR and EconML were not.
- The conditional (selective-risk) form of the Learn then Test bound in 10.2 step 4, the cell-enumeration verifier in 9.2, and all numbers in 10.2: arithmetic and reasoning by me, to be confirmed by the simulations specified above.
- Anything in the cited papers beyond their abstract pages: no PDF was read in full, no result reproduced.
- Not searched: Bayesian or ordinal calibration of rule-derived scores, legal analogical-reasoning systems, SoD literature, XACML-era analysis tools.
