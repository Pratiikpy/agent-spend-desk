# Prior art 08: Explain module research (claim verification, attribution, counterfactual and causal explanation, argumentation, certificates)

Written 2026-10-13 for the Explain module (`docs/design/00-architecture-master-spec.md` sections 9 and 16). It extends `04-track2-verification-and-factuality-methods.md` (SAFE, FActScore, ALCE, Self-RAG, ragas, debate: not repeated here).

**Method and limits.** Every paper below had its arXiv abstract page or publisher page fetched, except where an item says otherwise; the fetch failures are listed in section 6. Every repository was checked with `gh api repos/OWNER/NAME` on 2026-10-13 (stars, SPDX licence as detected by GitHub, last push, archived flag). Nothing was cloned or installed; a few README and source files were read through `gh api`. Search-engine summaries were used only to find candidates; claims in this file come from the fetched abstract or file, and anything else is tagged **(inference)** or **NOT VERIFIED**. The session's web-search budget ran out mid-run, so the prior-art search is not exhaustive: "I found no paper that does X" means no hit in the searches run, not that none exists. Titles, authors, dates and arXiv ids always come from the fetched page; some venue names (for example ACL, EMNLP, AAAI, ICLR acceptances) come from search listings rather than the fetched abstract page and should be re-checked before they are quoted. All 2026 items are preprints whose peer-review status I did not check.

## 0. Verdict first

1. The strongest idea for Plumbline is not in any LLM-citation paper. It is in formal XAI and diagnosis: **robust sufficiency** (an abductive explanation) and **minimal flips** (a contrastive explanation) are exact hitting-set duals (Reiter 1987; Ignatiev et al. 2019). The Plumbline claim ledger is small, typed and replayable, so both families can be computed **exactly** by re-running the pure policy function, and each result can ship a certificate that the offline verifier re-checks (section 1).
2. LLM-judged leave-one-out (spec L4) should be demoted to the **judged edges only** (the L2 entailment labels). Everything downstream of a frozen edge label is deterministic and does not need a judge.
3. Halpern-Pearl actual causation applied to the derivation DAG separates overdetermination (two independent registries confirming one fact) from decoration, which leave-one-out cannot (section 1.3).
4. "Contested" and "unresolved" can be given a formal meaning (Dung semantics over an argumentation framework built mechanically from evidence) instead of "the debate did not converge" (item D2).
5. 2026 preprints already occupy neighbouring ground (MEG, ClaimReceipt, AUDITA, Evidence-Ledger Adjudication, proof-carrying LLM certificates). None found does the combination in section 1; each is a single-team preprint, so build on the ideas, not the numbers.

## 1. Formal core: minimal sufficient evidence and minimal flips, computable exactly

### 1.1 Setting
A **ledger snapshot** `Lambda = (E, J, G, pi, a)`: `E` the finite set of evidence items that passed L0 (hash and locator verified); `J` the judged edges `(e, claim, label, span)` with `label in {entailed, partial, neutral, contradicted}` and L0-rechecked spans; `G` the gap list (`not_checked`, `unavailable`, ...); `pi` the policy version; `a` the as-of date. `V(S)` for `S subseteq E` is the **pure** composition reconcile, label aggregation, policy, evaluated with only the evidence in `S` (edges whose evidence is absent are dropped; items with `recordedAt` after `a` never count). Spec principle 6 (everything replays) is what makes `V` a function we can call 2^n times. `v* = V(E)`. Edge labels are frozen inputs here; their own noise is section 1.7.

### 1.2 Definitions
- **Robustly sufficient (RS)**: `S` such that for all `T subseteq E \ S`, `V(S u T) = v*`. Fixing `S` and letting every other recorded item be present or absent never changes the verdict. This is the abductive-explanation semantics of Ignatiev et al. with evidence-presence bits as features.
- **Minimal sufficient evidence (MSE)**: subset-minimal RS sets. Weighted variant: prefer sets built from the most authoritative tiers.
- **Removal flip**: `R subseteq E` with `V(E \ R) != v*`. **Minimal flip (MF)**: subset-minimal flips. A target variant asks for `V(E \ R)` in a named set (for example `release`).
- The weaker "support-only" notion `V(S) = v*` is not enough: `V` is not monotone (a new contradicting source can flip or leave `unresolved`), so `S` may support `v*` alone while an item elsewhere in the ledger overturns it.

### 1.3 Duality (self-contained argument)
(P1) RS sets are upward closed: if `S` is RS and `S subseteq S'`, then for any `T' subseteq E \ S'` put `T = (S' \ S) u T'`, which lies in `E \ S`; since `S' u T' = S u T`, `V(S' u T') = v*`.
(P2) `S` is RS iff `S` intersects every flip: a flip `R` with `R subseteq E \ S` is exactly `E \ R = S u T` for some `T`. Because every flip contains a minimal flip, `S` is RS iff it hits every **minimal** flip.
(P3) Hence `MSE = MHS(MF)` (minimal hitting sets) and, by Berge duality for clutters, `MF = MHS(MSE)`. No monotonicity of `V` is needed. If no flip exists, `MSE = {empty}`: the verdict is independent of the evidence, which must be reported as a defect (policy default), not as a strong explanation.
This is the diagnosis-theory result of Reiter (1987) and the explanation/adversarial-example duality of Ignatiev et al. (NeurIPS 2019), restated for a black-box oracle with a non-monotone verdict. The **complete reason** (Darwiche and Hirth) renders as a formula: `OR over S in MSE of AND(S)`, for example `(LEI active AND registry active) OR (bank letter AND registry active)`.

### 1.4 Actual causation (modified Halpern-Pearl) on the derivation DAG
Make the structural model explicit: exogenous bits `X_e` (present/absent); endogenous nodes = named intermediate values the evaluator already computes (per-attribute resolved state incl. `unresolved`, fired rule ids, claim labels, verdict). The evaluator must emit its trace as `{id, fn, reads, value}` nodes. Following Halpern 2015 (text read in the paper): `X = x` is part of a cause of `phi` if AC1 (`X = x` and `phi` both hold in the actual context) and AC2(am): there is a set `W` of variables and a setting `x'` of `X` such that, with `W` frozen at the values it has in the actual context, setting `X <- x'` makes `phi` false; AC3: `X` minimal. Responsibility (Chockler and Halpern): `1/(N+1)`, `N` the minimal number of changes needed to reach a contingency where `phi` counterfactually depends on the item (their voting example: 11-0 gives 1/6, 5-4 gives 1).
Effect on the L4 classes: leave-one-out calls a source "redundant" when a second registry confirms the same fact, and then assigns it no importance. Under modified HP the two sources are **jointly** a cause (each is part of it; the witness has `W` empty), and the Chockler-Halpern degree, with `N = 1` other removal needed, is `rho = 1/2`: "one of two independent confirmations". Freezing `W` matters when a path runs through an intermediate node (a resolved attribute), because it stops a contingency from smuggling in a different derivation. Chockler and Halpern defined responsibility over the original definition; carrying `rho` over to the modified definition is our choice and is **NOT VERIFIED** in the literature read here. "Decorative" = part of no cause. Cost: the definitions are model-relative, so the DAG per policy version is part of the published policy, and the evaluator must be instrumented.

### 1.5 Larger edit space and gap relevance
Edits beyond removal: `correct(e, field, v')` (what if the source had said `v'`), `supply(gap, v')` (what if the unchecked source returned `v'`, `v'` ranging over its finite normalised domain). Cost is an ordered tuple (authority tier of what is touched, count). **Minimal change that flips the verdict** = minimum-cost edit set whose `V` is in the target (Wachter et al.'s "smallest change to the world", exact over a discrete ledger). **Decision-relevant gap**: `g` is relevant iff some `v'` in its domain changes the verdict; otherwise the dossier states "the unchecked source `g` cannot change this verdict under policy `pi`" with all `|domain|` evaluations as proof. This is an exact value-of-information statement with no model in it.

### 1.6 Algorithm, scale, honesty about complexity
```ts
interface Trace { verdict: Verdict; nodes: { id: string; fn: string; reads: string[]; value: unknown }[] }
type Derive = (L: Ledger, present: ReadonlySet<EvidenceId>) => Trace;            // pure, cached by hash(L, present)
type Edit = { k: 'remove'; e: EvidenceId } | { k: 'correct'; e: EvidenceId; field: string; to: unknown } | { k: 'supply'; gap: GapId; value: unknown };
interface Explanation { mse: EvidenceId[][]; flips: Edit[][]; causes: Cause[]; irrelevantGaps: GapId[]; completeness: 'exact' | 'partial'; oracleCalls: number; cert: CertRef }
```
1. **Static cone**: policy rules declare their reads; evidence outside the cone cannot matter (asserted by a randomised differential test against brute force).
2. **Attribute decomposition**: `V = P(rho_1(S n E_1), ..., rho_k(S n E_k))`; tabulate each attribute's `2^|E_i|` states once, then search the policy over reachable attribute-state vectors.
3. **Dualisation loop** (Reiter HS-tree / implicit hitting set): shrink any found RS set or flip to minimal by deletion (QuickXplain order = authority tier, item A6), take the next candidate hitting set of the flips found so far, test it, repeat until none remains. A small branch-and-bound hitting-set routine suffices at tens of items; pysat's `hitman.py` is the reference to cross-check against.
4. **Budgets**: a cap yields `completeness: 'partial'` with the families found so far; never a silent truncation.
Generic Halpern-Pearl cause checking is NP-complete in binary models and Sigma-2-P-complete in general models (Eiter-Lukasiewicz as quoted in Aleksandrowicz et al.). We claim no complexity class for this exact setting (**NOT VERIFIED**); the safeguard is that case ledgers are small by construction and the number of oracle calls and wall time are reported per case on the gold sets.

### 1.7 Judged edges: robustness radius
Re-run the same flip engine over edge-label variables (domain of 4 labels, edit = relabel). The **robustness radius** is the minimum number of judged-edge errors that flips the verdict. Report "the verdict survives any k judge errors" (exact), and separately bound it statistically only under a stated independence assumption using per-label error rates estimated with prediction-powered inference from a small gold set (items H4, H5). Independence across edges from one judge is probably false; the dependent case is the radius, not a probability.

### 1.8 Certificates (certifying-algorithm pattern)
Flip certificate: the edit set `R`, plus `V(E \ R') = v*` for every proper subset `R'` (minimality, `2^|R|` calls, `|R|` small). Sufficiency certificate: for `|E \ S| <= 20` a Merkle-committed table of all `2^|E \ S|` verdicts the verifier recomputes; beyond that the HS-tree trace. Argument certificates: an admissible set or the grounded fixpoint iteration. Trust base: the pinned policy function and canonicalisation; the certificate proves a property of this function on this ledger, not that the policy is right. Verifier status per claim: `PASS | INVALID | INCONCLUSIVE` (item I5).

### 1.9 Tests (acceptance for section 9 of the spec)
Exactness against brute force on random ledgers up to 14 items; differential run against an SMT encoding (`z3-solver` 5.2.0, MIT, npm; test-time only); gold ledgers with planted MSE/MF known by construction; mutation tests (delete, correct, add a contradiction) whose explanation change must match prediction; tamper tests where a modified evidence body, policy hash or table row must make the verifier return `INVALID`; simulatability (item G3) scored with exact ground truth.

### 1.10 Where this plugs into the spec (changes to section 9 and 16 of the master spec)
- **L4** splits in two: *L4a exact causal layer* (this section: MSE, flips, causes, irrelevant gaps, certificates) over the frozen ledger; *L4b judged-edge layer* (the existing leave-one-out, distractor and empty-evidence probes, plus the section 1.7 radius), the only place an LLM judge is re-run. The five classes of spec L4 become derived views: critical = member of every MSE (equivalently `{e}` is a one-item flip, which is leave-one-out necessity, so the two methods must agree here and the test checks it); redundant = part of an overdetermined cause (`rho < 1`); decorative = in no cause; harmful = a one-item flip whose new verdict is more favourable on the policy's action order.
- **L3** keeps advocate and skeptic as *proposers of edges and attacks*, which only enter the framework after L0; the arbiter is replaced by D2 semantics except where the two L2 judges disagree. `contested` and `unresolved` get formal definitions.
- **New code**: `src/explain/causal/` (evaluator trace, enumeration, causes), `src/explain/argue/` (framework, semantics, dispute trees), `src/explain/certify/` plus a standalone `verify` script that shares no code with the server except the pinned policy bundle. **Build order**: after Reconcile and the policy engine exist (spec section 15, step 12), because the explanations are only as good as the evaluator trace.
- **Metrics added to the eval suite** (all with cluster-bootstrap intervals): exactness against brute force; L4-versus-exact class disagreement; simulatability precision and coverage against LLM-rationale baselines; certificate tamper detection; judge over-commit rate; robustness radius distribution; oracle calls and wall time per case; unsupported rate under strict and lenient L2.
- **Hard rule carried from the spec**: counterfactual wording stays "under this fixed snapshot and policy version, removing E changes the computed verdict from A to B"; none of this is a claim about real-world causation.

## 2. Items

Format: Meta (verified metadata, URL) / Idea / Plumbline (design sketch) / Limits.

### A. Formal explanation theory

**A1. Abduction-based explanations (Ignatiev, Narodytska, Marques-Silva, AAAI 2019).** https://ojs.aaai.org/index.php/AAAI/article/view/3964 (page fetched).
Idea: constraint-agnostic computation of explanations with cardinality- or subset-minimality guarantees, against heuristic explainers that give none.
Plumbline: RS and MSE of section 1.2 are this semantics with presence bits as features; reuse the vocabulary (AXp) so reviewers recognise it.
Limits: models are classifiers encoded as constraints; no non-monotone, typed-state policy; evaluation on standard ML datasets per the abstract.

**A2. On Relating Explanations and Adversarial Examples (Ignatiev et al., NeurIPS 2019).** https://papers.nips.cc/paper/9717-on-relating-explanations-and-adversarial-examples (page fetched).
Idea: explanations and adversarial examples are related by a generalised hitting-set duality, from diagnosis and knowledge compilation; each can generate the other.
Plumbline: section 1.3 (P3): compute MF from MSE or the reverse; cross-check one family against the other in tests.
Limits: feature-space perturbations, not evidence deletion; our proof is a short self-contained restatement.

**A3. Darwiche and Hirth, On the Reasons Behind Decisions (arXiv 2002.09284, 2020); Darwiche and Ji, On the Computation of Necessary and Sufficient Explanations (arXiv 2203.10451, 2022).** https://arxiv.org/abs/2002.09284, https://arxiv.org/abs/2203.10451 (both fetched).
Idea: sufficient, necessary and complete reasons for Boolean classifiers; sufficient reasons are prime implicants, necessary reasons prime implicates, matching abductive and contrastive explanations; shortest ones; counterfactual statements evaluated through them.
Plumbline: render the **complete reason** (disjunction of all MSE) in the dossier and use it to answer "would the decision survive without X"; binarise the verdict per target (`V = v*`) to apply the Boolean results.
Limits: Boolean classifiers compiled to circuits; our compile step, if wanted, would be a decision diagram over presence bits (not needed at our size).

**A4. Marques-Silva, Logic-Based Explainability in Machine Learning (arXiv 2211.00541).** https://arxiv.org/abs/2211.00541 (fetched).
Idea: abstract states non-formal explanations "can be consistent with different predictions", which makes them useless in practice; surveys definitions, complexity, encodings.
Plumbline: the citation for why we do not rely on LLM-written rationales or sampling-based explainers for the typed spine.
Limits: survey of ML classifiers; says nothing about retrieval or citation.

**A5. Reiter, A Theory of Diagnosis from First Principles (Artificial Intelligence 32, 1987).** First page of the paper read (PDF); theory plus an algorithm for computing all diagnoses. (That diagnoses are minimal hitting sets of conflict sets is stated in secondary summaries; **not re-read in the paper body**.)
Plumbline: the dualisation loop in 1.6.3; our "conflicts" are minimal sufficient sets, "diagnoses" are minimal flips.
Limits: logic-based system models; exponential worst case.

**A6. QuickXplain (Junker, AAAI 2004).** https://mlanthology.org/aaai/2004/junker2004aaai-quickxplain (fetched; bibliographic listing).
Idea: preferred explanations and relaxations for over-constrained problems under a total order of constraints, any CP/SAT/DL solver, divide-and-conquer acceleration.
Plumbline: use authority tier (then recency) as the total order so the single explanation shown first is the lexicographically preferred minimal set (most authoritative sources). Complexity bounds not verified here.
Limits: requires a total order; ties must be broken deterministically for replay.

**A7. PySAT (`pysathq/pysat`).** 461 stars, MIT, pushed 2026-08-16, not archived. https://github.com/pysathq/pysat
Idea (from source read): `examples/hitman.py` enumerates cardinality- and subset-minimal hitting sets (MaxSAT or MCS based); `examples/musx.py` is deletion-based MUS extraction.
Plumbline: Python, so a **test-time oracle** against which the TypeScript enumerator is checked on shared vectors, not a runtime dependency.
Limits: solver machinery is overkill at tens of items.

**A8. Anchors (Ribeiro, Singh, Guestrin, AAAI 2018) and `marcotcr/anchor`.** https://ojs.aaai.org/index.php/AAAI/article/view/11491 (fetched); repo 820 stars, BSD-2-Clause, pushed 2022-07-19.
Idea: high-precision "sufficient" local rules with high-probability guarantees for black-box models, by sampling perturbations.
Plumbline: do not adopt for the ledger (exact is available); the probabilistic notion survives only for judged-edge perturbation tests (item F7).
Limits: the perturbation distribution defines the explanation; see A4.

### B. Causation, provenance, responsibility

**B1. A Modification of the Halpern-Pearl Definition of Causality (Halpern, arXiv 1505.00162, IJCAI 2015).** https://arxiv.org/abs/1505.00162 (fetched; definitions read in the PDF).
Idea: AC2(am) freezes `W` at actual values; simpler, handles known counterexamples, lower complexity than the original and updated definitions (abstract); the text shows overdetermination yields causes as conjunctions.
Plumbline: section 1.4. Output: `cause: EvidenceId[]` with witness `(W, w, x')`.
Limits: model-relative; acyclic finite models only in our use.

**B2. Responsibility and Blame: A Structural-Model Approach (Chockler and Halpern, arXiv cs/0312038, JAIR 2004).** https://arxiv.org/abs/cs/0312038 (fetched; formula read in the PDF).
Idea: degree of responsibility `1/(N+1)`; blame is expected responsibility over an epistemic state.
Plumbline: `rho` per evidence item; show "one of k independent confirmations". Blame has no counterpart for us; do not import it.
Limits: counts changes, not authority weights; two weak sources and two strong ones score equally unless authority enters the cost.

**B3. Computational Complexity of Structure-Based Causality (Aleksandrowicz, Chockler, Halpern, Ivrii, arXiv 1412.3076, AAAI 2015); Eiter and Lukasiewicz, Complexity Results for Structure-Based Causality (IJCAI 2001).** https://arxiv.org/abs/1412.3076 (fetched; abstract text read), https://www.cs.ox.ac.uk/publications/publication6727-abstract.html (fetched).
Idea: cause checking is NP-complete (binary) or Sigma-2-P-complete (general) under the original definition; the updated definition is D2P-complete; responsibility and blame characterised too.
Plumbline: the honest complexity statement in 1.6; tells us to keep the cone small.
Limits: worst case; says nothing about our instances.

**B4. From Checking to Inference: Actual Causality Computations as Optimization Problems (Ibrahim and Pretschner, arXiv 2006.03363, ATVA 2020).** https://arxiv.org/abs/2006.03363 (fetched).
Idea: ILP and MaxSAT encodings of causality checking and inference over binary acyclic models; checking on models above 8,000 variables in seconds (MaxSAT often faster than ILP), inference in minutes.
Plumbline: the scale-out and cross-check path: bit-blast the derivation DAG, ask MaxSAT for the minimum contingency (responsibility).
Limits: binary variables, authors' models, which differ from policy engines with dates and tiers.

**B5. Causality and Responsibility for Query Answers and non-Answers (Meliou, Gatterbauer, Moore, Suciu, arXiv 1009.2021, PVLDB 2011).** https://arxiv.org/abs/1009.2021 (fetched).
Idea: causes of conjunctive-query answers and non-answers; all causes computable by a relational query (PTIME); responsibility has a PTIME/NP-complete dichotomy.
Plumbline: if the gating part of policy is written as conjunctive queries over evidence relations, causes are a query, and "why not release" (non-answers) has a direct analogue.
Limits: conjunctive queries only; precedence, dates and arithmetic fall outside what the abstract covers.

**B6. Resilience and Responsibility for Self-Join-Free Conjunctive Queries (Freire, Gatterbauer, Immerman, Meliou, arXiv 1507.00674, VLDB 2016).** https://arxiv.org/abs/1507.00674 (fetched).
Idea: resilience = minimum tuples to delete to make a Boolean query false; complete dichotomy with functional dependencies; resilience tractable for a larger class than responsibility.
Plumbline: a minimum-cardinality removal flip **is** resilience when the gate is a Boolean query; the dichotomy gives a policy-authoring lint (rule shapes whose exact flip is polynomial versus hard). The mapping from our rules to their query class is an **inference**.
Limits: self-join-free queries.

**B7. Provenance Semirings (Green, Karvounarakis, Tannen, PODS 2007).** Paper PDF first page read; the PODS test-of-time page (https://databasetheory.org/PODS/acm-pods-alberto-o-mendelzon-test-of-time-award) also fetched.
Idea: annotate tuples with commutative-semiring elements; polynomials give the most general provenance; why-provenance, bag semantics and probabilistic databases are instances; extended to Datalog.
Plumbline: the how-provenance polynomial over evidence ids is the compact derivation record; evaluate it in the Boolean semiring (presence) or a max-min semiring over authority tiers to get the per-claim confidence tier by algebra rather than by ad hoc rules.
Limits: positive algebra (the paper text says "generalized positive algebra"); negation, absence and conflict need the dual machinery of section 1, which is why V is not a semiring evaluation.

**B8. Provenance for Large-scale Datalog (Zhao, Subotic, Scholz, arXiv 1907.05045) and `souffle-lang/souffle`.** https://arxiv.org/abs/1907.05045 (fetched); repo 1,184 stars, UPL-1.0, pushed 2026-10-02.
Idea: proof annotations carried through semi-naive evaluation to build minimal-height partial proof trees on demand; 1.27x average runtime overhead on Doop/DaCapo.
Plumbline: pattern only: every fired rule emits a proof node `(ruleId, premises)`, giving derivation trees for free. Soufflé itself synthesises C++, which breaks the no-install judge rule.
Limits: program-analysis workloads.

### C. Counterfactual and recourse explanations

**C1. Counterfactual Explanations without Opening the Black Box (Wachter, Mittelstadt, Russell, arXiv 1711.00399).** https://arxiv.org/abs/1711.00399 (fetched).
Idea: "the smallest change to the world that can be made to obtain a desirable outcome", offered without exposing the system, framed for GDPR contestation.
Plumbline: section 1.5 gives the exact discrete version; the UI answer to "what would make this release" is the minimum-cost target flip, expressed as obtainable evidence.
Limits: legal-ML position paper; the distance metric is our authority-ordered cost, which is a design choice to defend.

**C2. DiCE (Mothilal, Sharma, Tan, arXiv 1905.07697, FAT* 2020) and `interpretml/DiCE`.** https://arxiv.org/abs/1905.07697 (fetched); repo 1,528 stars, MIT, pushed 2025-07-13.
Idea: counterfactuals should be feasible and diverse; determinantal-point-process diversity.
Plumbline: show a few **diverse** minimal flips (different attributes, different authorities), selected from the full enumeration rather than sampled.
Limits: continuous features and gradient search; not needed.

**C3. Explanation in AI: Insights from the Social Sciences (Miller, arXiv 1706.07269).** https://arxiv.org/abs/1706.07269 (fetched).
Idea: people use cognitive biases and social expectations in explaining; XAI should draw on that literature.
Plumbline: supports the contrastive framing ("why release rather than hold") and short sets. The contrastive and selective claims are my recollection of the paper, **not in the fetched abstract**.
Limits: a review, not an evaluation of our interface.

### D. Argumentation

**D1. Dung, On the Acceptability of Arguments... (Artificial Intelligence 77(2), 321-357, 1995).** Paper PDF first page read.
Idea: a theory of argument acceptability whose abstract frameworks capture nonmonotonic reasoning, logic programming, n-person games and stable marriage.
Plumbline: the semantics layer in D2.
Limits: arguments are atoms; exponential in the worst case for some semantics (**complexity not verified here**).

**D2. ASPIC+ tutorial (Modgil and Prakken, Argument and Computation 5(1), 2014).** https://research-portal.uu.nl/en/publications/the-aspic-framework-for-structured-argumentation-a-tutorial/ (fetched).
Idea: structured arguments from strict and defeasible rules; attacks on premises, on defeasible inferences, or on their conclusions; explicit preferences resolve conflicts.
Plumbline (`src/explain/argue/`):
```ts
type Arg = { id: string; premises: EvidenceId[]; claim: ClaimKey; value: Normalised; tier: number; validTime: Interval };
type Attack = { from: string; to: string; kind: 'rebut' | 'undermine' | 'undercut'; reason: ReasonCode };
// rebut: single-cardinality attribute, different values. undermine: L0 fail / fabricated quote / hash mismatch.
// undercut: record stale or superseded at asOf, entity-resolution merge unresolved, extraction error flagged.
// defeat = attack that survives the preference order (authority tier, then recency): the reconcile precedence rules ARE the preference relation.
function status(af): Map<string, 'established' | 'defeated' | 'contested' | 'rejected'>;
```
`established` = in the grounded extension; `defeated` = attacked by it; `contested` = in some but not all preferred extensions (credulous, not sceptical); `rejected` = in none. An equal-authority conflict is an even attack cycle with two preferred extensions: exactly the spec's `unresolved`. The spec's L3 "no forced vote: contested" becomes a property of the evidence, not of the debate process; an LLM arbiter remains only for edges where the dual L2 judges disagree. A dispute tree (proponent defends against each attacker from the grounded set) is a **certificate** the offline verifier checks in polynomial time. Contestation is an edit in the section 1.5 edit space (remove an argument, add an attack).
Limits: whether undercuts always defeat regardless of preference is how ASPIC+ is usually stated, but I did not verify it in the tutorial (PDF fetch returned 403): **NOT VERIFIED**, check before implementing. The tutorial's rationality postulates need a reasonable preference order; per-attribute tier order is one.

**D3. Carneades (Gordon, Prakken, Walton, Artificial Intelligence 171, 2007) and `carneades/carneades`.** Paper: bibliographic listing from a search result; both fetches of the abstract failed (403, access denied): **UNVERIFIED abstract**. Repo: 36 stars, no licence detected, pushed 2019-10-17 (stale, Clojure).
Idea (from the search listing only): proof standards applied issue by issue, with the burden of proof allocated per premise.
Plumbline: adopt the concept, not the code: each policy requirement declares who bears the burden and an ordinal standard (S1 some live pro argument; S2 pro strictly outranks every live con; S3 no live con). These three names are mine, **not** Carneades' list.
Limits: do not rely on the paper's exact standard names.

**D4. Argumentative XAI: A Survey (Cyras, Rago, Albini, Baroni, Toni, arXiv 2105.11266, IJCAI 2021).** https://arxiv.org/abs/2105.11266 (fetched).
Idea: taxonomy of argumentation-based explanation: intrinsic versus post-hoc, deployment models, delivery forms, framework types.
Plumbline: ours is intrinsic (the framework is the reasoning, not a post-hoc gloss), the strongest quadrant for faithfulness; use as the vocabulary for the write-up.
Limits: 2021.

**D5. AA-CBR and successors.** Cyras, Satoh, Toni, Explanation for case-based reasoning via abstract argumentation (COMMA 2016), https://spiral.imperial.ac.uk/entities/publication/38888713-351d-4a07-96ea-6a59a69929bc (fetched); Preference-Based AA-CBR (Gould et al., arXiv 2408.00108) https://arxiv.org/abs/2408.00108 (fetched); Argumentative Reasoning with Language Models on Non-factorized Case Bases (arXiv 2512.12656, 2025-12) https://arxiv.org/abs/2512.12656 (fetched).
Idea: classify by arguing from past cases; "lean" explanations use only the relevant cases, proponent bearing the burden; preferences over argument constituents (validated on brain-tumour trial data); language models cope with few factors and degrade as factors grow.
Plumbline: precedent retrieval in Decide (`05`) can present supporting and counter-precedents as an argument exchange; keep the case-based reasoning symbolic, per the third paper.
Limits: boolean factor representations; medical data; belongs mostly to Decide.

**D6. LLM-built argumentation: Argumentative LLMs (Freedman et al., arXiv 2405.02079, AAAI 2025); MArgE (arXiv 2508.02584); ArgEval (Dejl, Williams, Toni, arXiv 2603.14643, 2026-03); Contestable AI needs Computational Argumentation (Leofante et al., arXiv 2405.10729, KR 2024).** https://arxiv.org/abs/2405.02079, https://arxiv.org/abs/2508.02584, https://arxiv.org/abs/2603.14643, https://arxiv.org/abs/2405.10729 (all fetched).
Idea: LLMs construct argument frameworks for claim verification so outputs can be faithfully explained and contested; MArgE meshes arguments from several LLMs into a tree; ArgEval builds general frameworks per decision option (glioblastoma treatment); the position paper argues contestability needs argumentation.
Plumbline: adopt the **contestation interface** (a person contests an argument or edge, the system recomputes and shows the diff). Do not adopt LLM-generated arguments as evidence: they come from the model, so they are not hash-anchored to a source (**inference** from the abstracts; I did not check whether they retrieve).
Limits: results are on claim-verification and clinical benchmarks; no corruption or tamper test appears in the abstracts.

**D7. Gradual semantics for ABA (Rapberger et al., arXiv 2507.10076).** https://arxiv.org/abs/2507.10076 (fetched). Numeric dialectical strength for assumptions. Not adopted (section 4).

**D8. Implementations.** `TweetyProjectTeam/TweetyProject`: 44 stars, GPL-3.0, pushed 2026-10-11 (description covers AI libraries in general; its argumentation modules were not verified here). `kisp/asgl`: 8 stars, no licence detected, Common Lisp solver, pushed 2026-07-28. `alexjackson1/pickaxe`: 1 star, MIT, Rust ASPIC+ engine, pushed 2026-03-29. No mature, permissively licensed TypeScript argumentation engine turned up in the searches run. Decision: write a small engine (grounded fixpoint plus preferred-extension enumeration for frameworks up to roughly 30 arguments), validated offline against these as oracles; GPL code is never vendored.

### E. Claim verification, NLI, hallucination detection

**E1. FEVER (Thorne et al., arXiv 1803.05355, NAACL 2018).** https://arxiv.org/abs/1803.05355 (fetched).
Idea: 185,445 claims labelled Supported, Refuted, NotEnoughInfo, with evidence sentences; a baseline gets 31.87% with the right evidence and 50.91% ignoring evidence.
Plumbline: label inventory; map NotEnoughInfo to our split (`silent` versus `not_checked` versus `unavailable`); the evidence-ignored baseline motivates L4's empty-evidence probe.
Limits: synthetic Wikipedia claims; sentence-level evidence.

**E2. SciFact (Wadden et al., arXiv 2004.14974, EMNLP 2020) and `allenai/scifact`.** https://arxiv.org/abs/2004.14974 (fetched); repo 277 stars, licence NOASSERTION, pushed 2023-10-15.
Idea: about 1,400 expert-written scientific claims with rationale-bearing abstracts.
Plumbline: small external sanity set for L2 labels; the rationale format maps to our span requirement.
Limits: tiny, scientific, abstract-level, unclear reuse licence.

**E3. AVeriTeC (Schlichtkrull, Guo, Vlachos, arXiv 2305.13117, NeurIPS 2023) and its 2026 critiques.** https://arxiv.org/abs/2305.13117 (fetched); repo `MichSchli/AVeriTeC` 78 stars, no licence detected, pushed 2024-11-27.
Idea: 4,568 real claims from 50 fact-checking organisations, question-answer evidence plus justification, kappa 0.619, built to avoid temporal leakage. 2026 follow-ups: No Hindsight for LLM Fact-Checkers (arXiv 2610.04888) measures post-claim evidence inflating performance by 6.3 points on AVeriTeC; How Robust Are Automated Fact-Checking Systems (arXiv 2608.25934) finds the best SciFact system (macro-F1 0.70) scores 0.31 on ClimateCheck and gold evidence adds 14 to 22 points. https://arxiv.org/abs/2610.04888, https://arxiv.org/abs/2608.25934 (fetched).
Plumbline: turn the leakage lesson into a mechanical invariant test: no evidence with `recordedAt` after the as-of date may influence `V`; plus a parametric-leakage probe on the L2 judge (empty-evidence run).
Limits: web fact-checks, not entity records; the 2026 papers are preprints.

**E4. Factcheck-Bench (Wang et al., arXiv 2311.09000) and Loki (arXiv 2410.01794; repo `Libr-AI/OpenFactVerification`).** https://arxiv.org/abs/2311.09000, https://arxiv.org/abs/2410.01794 (fetched); repo 1,160 stars, MIT, pushed 2024-10-03.
Idea: eight annotated sub-steps (claim, sentence, document granularity); best F1 0.63 for finding false claims; Loki's five stages (claim extraction, check-worthiness, query generation, retrieval, verification).
Plumbline: per-stage metrics instead of one end-to-end score, as in `04` section 10.
Limits: repo quiet since 2024-10; open-web, not records.

**E5. MiniCheck and LLM-AggreFact (Tang, Laban, Durrett, arXiv 2404.10774, EMNLP 2024) and `Liyan06/MiniCheck`.** https://arxiv.org/abs/2404.10774 (fetched); repo 228 stars, Apache-2.0, pushed 2025-08-27.
Idea: a 770M model trained on synthetic multi-sentence data reaches GPT-4-level accuracy at about 400x lower cost on a benchmark unifying recent grounding datasets.
Plumbline: candidate offline L2 gate behind the `Judge` interface. The README API returns a binary label and a probability, so **(inference)** it cannot separate silence from contradiction, the very distinction the spec needs; use it as a "supported or not" pre-filter and keep the 4-label judge for the rest. README states commercial use of the 7B model needs vendor contact.
Limits: PyTorch (sidecar or ONNX export unverified for TypeScript), document-grounded text, not entity records.

**E6. AlignScore (Zha et al., arXiv 2305.16739, ACL 2023) and `yuh-zha/AlignScore`.** https://arxiv.org/abs/2305.16739 (fetched); repo 175 stars, MIT, pushed 2024-03-11.
Idea: one alignment function trained on 4.7M examples from 7 tasks; 355M parameters; competitive with ChatGPT/GPT-4-based metrics on 22 datasets (19 unseen).
Plumbline: a second non-LLM voter against self-preference (item H2). Limits: continuous score, no span; the repo has been idle since 2024-03.

**E7. RAGTruth (arXiv 2401.00396; repo `ParticleMedia/RAGTruth`, 278 stars, MIT) and LettuceDetect (Kovacs and Recski, arXiv 2502.17125; repo `KRLabsOrg/LettuceDetect`, 615 stars, MIT, pushed 2026-10-09).** https://arxiv.org/abs/2401.00396, https://arxiv.org/abs/2502.17125 (fetched).
Idea: about 18,000 RAG responses with word-level hallucination labels; a ModernBERT token classifier (8k context) reaching F1 79.22% at example level, 30 to 60 examples per second on one GPU; the README says it returns exact character spans, with encoder and generative variants.
Plumbline: a span-level **unledgered-assertion detector** for the prose rendering: any rendered span unsupported by the ledger is flagged before display.
Limits: trained on question answering, summarisation and data-to-text; F1 79% means roughly one example in five is wrong.

**E8. Decomposition: VeriScore (arXiv 2406.19276; repo `Yixiao-Song/VeriScore`, 40 stars, Apache-2.0, pushed 2025-12-17); Molecular Facts (Gunjal and Durrett, arXiv 2406.20079); A Closer Look at Claim Decomposition (Wanner et al., arXiv 2403.11903).** https://arxiv.org/abs/2406.19276, https://arxiv.org/abs/2406.20079, https://arxiv.org/abs/2403.11903 (fetched).
Idea: extract only verifiable claims; two criteria for a good unit (decontextuality, minimality); FActScore-style metrics are sensitive to the decomposer, which DecompScore measures.
Plumbline: L1 tests per claim: "stands alone" and "adds nothing beyond"; always record the decomposer id. Ledger claims come from typed findings, so decomposition risk concentrates in the prose layer.
Limits: Wikipedia and general long-form text.

**E9. SelfCheckGPT (Manakul, Liusie, Gales, arXiv 2303.08896, EMNLP 2023) and `potsawee/selfcheckgpt`.** https://arxiv.org/abs/2303.08896 (fetched); repo 634 stars, MIT, pushed 2024-06-26.
Idea: sampled responses diverge on hallucinated facts and agree on known ones; no external database.
Plumbline: only to flag unstable **model-proposed extractions** (the same document extracted k times differs); never as evidence for a verdict, because consistency is not support.
Limits: measures model self-consistency, not support from a source.

**E10. Cherry-pick Override (Xu, arXiv 2606.07834, 2026-06).** https://arxiv.org/abs/2606.07834 (fetched).
Idea: when the task authorises "Conflicting" or "Not Enough Evidence", a human panel still committed directionally on 18.7% of claims while four LLM judges ranged 21.3% to 48.0%; typed vocabulary, panels, thresholds and self-decomposition reduced but did not remove it.
Plumbline: direct support for typed `neutral`/`partial`/abstain labels and for measuring each judge's **over-commit rate** as a standing metric; a rule-brain lexical gate as a non-LLM second voter.
Limits: single author; the paper states its human audit was incomplete and rates are dataset-defined lower bounds.

**E11. Evidence-Ledger Adjudication for Claim-Evidence Traceability (Chen, Yu, Wang, arXiv 2607.26512, 2026-07).** https://arxiv.org/abs/2607.26512 (fetched).
Idea: pair each claim with an evidence packet, assign a support relation, route unsupported, contradicted or mixed claims back to the author. On a 2,335-row benchmark from AVeriTeC, CLIMATE-FEVER and SciFact: relation accuracy 0.676, macro-F1 0.601, 1,270 of 1,435 problematic claims routed, 295 of 900 supported claims also routed.
Plumbline: the nearest published use of the word "ledger" and a numeric baseline for the L2 relation task; ours adds hash-verified spans, bitemporal filtering and the counterfactual and causal layers. About one in three supported claims flagged is a cost to avoid.
Limits: author-writing workflow, not decisions; stops at routing.

**E12. Minimal Evidence Group Identification (Li, Chen, Kapadia, Ouyang, Zhang, arXiv 2404.15588, ACL 2025 TrustNLP workshop).** https://arxiv.org/abs/2404.15588 (fetched).
Idea: formalises minimal evidence groups, shows the problem reduces from Set Cover through entailment inference, and reports absolute gains of 18.4 and 34.8 points on WiCE and SciFact over LLM prompting.
Plumbline: the closest formal prior for "minimal sufficient evidence" in claim verification, and an external check: build ledgers from WiCE and SciFact and compare our MSE with their groups.
Limits: support-only semantics from entailment; the abstract mentions neither contradiction nor policy; workshop paper.

**E13. 2026 sufficiency line: MiniVer-V (arXiv 2610.11233), The Missing Complement (arXiv 2609.20050), User-Centric Evidence Ranking (arXiv 2601.21387).** https://arxiv.org/abs/2610.11233, https://arxiv.org/abs/2609.20050, https://arxiv.org/abs/2601.21387 (fetched).
Idea: greedy sufficiency-driven search over 195 short videos reaches comparable accuracy with 16% of 5,510 evidence units; recovering the complete minimal sufficient set on coding-agent states reaches 73.0% at five items versus 61.4% for embedding reranking; ranking evidence so sufficiency arrives early reduced reading effort in a user study.
Plumbline: evidence the field is moving toward sufficiency as a first-class output; the "present sufficient evidence first" ordering is a UI rule for the claim panel.
Limits: learned or greedy, no exactness, other modalities; preprints.

### F. Attribution and citation quality

**F1. Measuring Attribution in NLG Models, AIS (Rashkin et al., arXiv 2112.12870; repo `google-research-datasets/AIS`).** https://arxiv.org/abs/2112.12870 (fetched); repo 31 stars, CC-BY-4.0, archived, pushed 2023-01-14.
Idea: "Attributable to Identified Sources", a two-stage human annotation protocol with guidelines.
Plumbline: L0 mechanises "identified" (hash, locator), L2 "attributable"; reuse the guidelines to write our gold-set annotation protocol.
Limits: human evaluation protocol, archived repo.

**F2. Evaluating Verifiability in Generative Search Engines (Liu, Zhang, Liang, arXiv 2304.09848, EMNLP 2023).** https://arxiv.org/abs/2304.09848 (fetched).
Idea: audit of four engines: 51.5% of sentences fully supported by citations, 74.5% of citations support their sentence.
Plumbline: the definitions (citation recall and precision) already in `04`; use the two numbers as the dated baseline our unsupported-claim rate is compared with.
Limits: 2023 products, human judgment.

**F3. ExpertQA (Malaviya et al., arXiv 2309.07852; repo `chaitanyamalaviya/ExpertQA`, 139 stars, MIT) and HAGRID (Kamalloo et al., arXiv 2307.16883; repo `project-miracl/hagrid`, 38 stars, Apache-2.0).** https://arxiv.org/abs/2309.07852, https://arxiv.org/abs/2307.16883 (fetched).
Idea: 484 experts across 32 fields judged 2,177 questions with attributed answers; HAGRID has GPT-3.5 attributed explanations over MIRACL judged by humans for informativeness and attributability.
Plumbline: sources of human-labelled attribution to **validate the L2 judge** (judge agreement with expert labels) before trusting it on our records.
Limits: general QA, English; not entity reconciliation.

**F4. AttributionBench (Li, Yue, Liao, Sun, arXiv 2402.15089, ACL 2024 Findings; repo `OSU-NLP-Group/AttributionBench`).** https://arxiv.org/abs/2402.15089 (fetched); repo 10 stars, no licence detected, pushed 2025-08-18.
Idea: unified attribution benchmark; fine-tuned GPT-3.5 reaches only about 80% macro-F1 on the binary task; failures come from insensitivity to fine-grained information and from the model seeing less than the annotators.
Plumbline: give the judge the same cited chunk plus locator and neighbours a human gets; build the attack suite on fine-grained edits (one number, one date, one negation), which is where the paper says models fail.
Limits: binary labels; mostly short evidence.

**F5. LongCite (Zhang et al., arXiv 2409.02897; repo `THUDM/LongCite`).** https://arxiv.org/abs/2409.02897 (fetched); repo 523 stars, Apache-2.0, pushed 2024-12-31.
Idea: LongBench-Cite benchmark, the CoF pipeline producing LongCite-45k, models giving sentence-level citations in one pass, reported above GPT-4o.
Plumbline: relevant to contracts and audit reports in the document lake (sentence-level locators); we still verify mechanically after the fact, so generation-time citation is optional.
Limits: a citation generator, not a verifier; its benchmark uses an LLM evaluator.

**F6. ContextCite (Cohen-Wang et al., arXiv 2409.00729; repo `MadryLab/context-cite`), AttriBoT (Liu, Kandpal, Raffel, arXiv 2411.15102, ICLR 2025), How Context Attribution Handles What the Model Already Knows (Trinh, Zhu, Szyller, arXiv 2607.23804, 2026-07).** https://arxiv.org/abs/2409.00729, https://arxiv.org/abs/2411.15102, https://arxiv.org/abs/2607.23804 (fetched); repo 342 stars, MIT, pushed 2024-10-08. AttriBoT's own repository was not located (`MadryLab/AttriBoT` returned 404).
Idea: attribute a generated statement to context pieces by ablation; AttriBoT approximates leave-one-out with more than 300x speedup and 30x cheaper than generating the response; the 2026 paper finds that when context overlaps training data, attribution scores cannot separate in-weight from in-context contributions (four methods tested).
Plumbline: the 2026 result is direct evidence for our `ungrounded_entailment` probe and against treating ablation attribution as proof of grounding. Use ablation only as a diagnostic on judge inputs; these methods need model internals or log-probabilities, so whether a hosted endpoint supports them is **NOT VERIFIED**.
Limits: open-weight models; statements not typed claims.

**F7. Correctness is not Faithfulness in RAG Attributions (Wallat et al., arXiv 2412.18004); Attributable Post-Rationalization in RAG Citations (arXiv 2609.23053, 2026-09); How Do LLMs Cite? (arXiv 2606.28358, 2026-06).** https://arxiv.org/abs/2412.18004, https://arxiv.org/abs/2609.23053, https://arxiv.org/abs/2606.28358 (fetched).
Idea: a citation can be correct and unfaithful (post-rationalised): up to 57% of citations unfaithful in the first paper; about one in seven on Wikipedia questions in the second, unchanged by reinforcement learning on verifiable rewards; a mechanistic study of one 8B model finds a distributed "attributional ensemble", with interventions repairing over 90% of missed citations.
Plumbline: our ledger links come from retrieval records, not model assertions, so faithfulness of those is by construction; apply the "remove the cited document, does the claim survive" test to every **model-written** claim (that is L4's ungrounded check).
Limits: small open models; the mechanistic result is one model.

**F8. Field audits: DeepTRACE (arXiv 2509.04499, ICLR 2026 per its listing); SourceCheckup (Wu et al., arXiv 2402.02008); Cited but Not Verified (arXiv 2605.06635, 2026-05); Evaluating and Guarding Citation Faithfulness in Agentic Scientific Synthesis (arXiv 2607.20527, 2026-07).** https://arxiv.org/abs/2509.04499, https://arxiv.org/abs/2402.02008, https://arxiv.org/abs/2605.06635, https://arxiv.org/abs/2607.20527 (fetched).
Idea: citation accuracy 40% to 80% across deep-research systems; 50% to 90% of LLM responses not fully supported by their cited sources, with the automated source-relevance check agreeing 88% with doctors; factual accuracy 39% to 77%, falling by about 42% as tool calls grow from 2 to 150; unsupported-citation rate swings from about 3% to about 18% with verifier strictness, and a split-conformal guard gives a distribution-free finite-sample bound (recall 0.94 on supported).
Plumbline: (1) report our unsupported rate under strict and lenient L2 so the result is not an artefact of strictness; (2) calibrate the L2 acceptance threshold with split-conformal on the gold set.
Limits: verifiers are LLMs (circular); conformal assumes exchangeable calibration and test data, which a changing judge model breaks.

**F9. FACTS Grounding (Jacovi et al., arXiv 2501.03200) and the survey Attribution, Citation, and Quotation (Schreieder, Schopf, Faerber, arXiv 2508.15396).** https://arxiv.org/abs/2501.03200, https://arxiv.org/abs/2508.15396 (fetched).
Idea: documents up to 32k tokens, an eligibility phase then a grounding phase, an aggregate of several judge models; the survey covers 134 papers and 300 metrics over seven dimensions.
Plumbline: adopt eligibility-then-grounding (an answer that ignores the request must not score as grounded) and multi-judge aggregation; use the survey as a metric checklist.
Limits: LLM judges; private test split.

### G. Faithful explanation (faithfulness versus plausibility)

**G1. Jacovi and Goldberg (arXiv 2004.03685, ACL 2020).** https://arxiv.org/abs/2004.03685 (fetched).
Idea: a binary notion of faithfulness is an unrealistic bar; use graded faithfulness, separate from plausibility.
Plumbline: state our faithfulness claim exactly: the shown explanation is a function of the executed derivation (faithful by construction); the only unfaithful-capable parts are the judged edges and the prose.
Limits: opinion paper.

**G2. Turpin et al. (arXiv 2305.04388, NeurIPS 2023) and Chen et al., Reasoning Models Don't Always Say What They Think (arXiv 2505.05410, 2025).** https://arxiv.org/abs/2305.04388, https://arxiv.org/abs/2505.05410 (fetched).
Idea: chain-of-thought can omit the real cause (accuracy drops up to 36% under biasing features without mention); reasoning models reveal a used hint in at least 1% of cases and often below 20%.
Plumbline: free-text rationales are never the explanation; show only span-verified quotes and program-derived structure.
Limits: multiple-choice style tasks; hint paradigms.

**G3. Counterfactual Simulatability (Chen et al., arXiv 2307.08678, ICML 2024).** https://arxiv.org/abs/2307.08678 (fetched).
Idea: an explanation is good if it lets a reader predict the model on counterfactual inputs; LLM explanations had low precision and precision did not correlate with plausibility.
Plumbline: an **exact** version: from the explanation alone (MSE, MF, causes) a reader (a program or a model) predicts `V` on random edited ledgers; ground truth is `V` itself, so precision and coverage are exact, and LLM-written rationales are the baseline. A good headline metric for the benchmark.
Limits: their setting needs human or model simulators; ours needs a fixed reader model and a stated baseline.

**G4. ERASER (DeYoung et al., arXiv 1911.03429, ACL 2020).** https://arxiv.org/abs/1911.03429 (fetched).
Idea: benchmark of datasets with human rationales and metrics for agreement with them and for faithfulness.
Plumbline: borrow "sufficiency" and "comprehensiveness" vocabulary: our RS sets are sufficient by definition; comprehensiveness is the complement of flips. Use the metrics approximately for judged-edge span rationales.
Limits: classifier-probability drops, human rationales as reference.

**G5. Explaining Answers with Entailment Trees (Dalvi et al., arXiv 2104.08661, EMNLP 2021) and `allenai/entailment_bank`.** https://arxiv.org/abs/2104.08661 (fetched); repo 46 stars, Apache-2.0, pushed 2022-11-05.
Idea: 1,840 multistep entailment trees; language models produce 35% perfect trees when given all relevant sentences.
Plumbline: for natural-language multi-hop inferences (ownership chains) use tree metrics (leaves, steps, intermediates); each leaf must be an L0-verified span.
Limits: science question answering; 2021 models.

**G6. VeriCoT (Feng et al., arXiv 2511.04662, ICLR 2026).** https://arxiv.org/abs/2511.04662 (fetched).
Idea: translate each reasoning step to first-order logic, ground premises in context or commonsense, solver-check validity, flag ungrounded premises; tested on ProofWriter, LegalBench, BioASQ.
Plumbline: for optional LLM reasoning in the narrative, require each premise to map to an L0 span or a declared commonsense item; ungrounded premises appear in the gap ledger.
Limits: depends on the model's formalisation, which can itself be wrong.

### H. Judge reliability and calibration

**H1. Large Language Models are not Fair Evaluators (Wang et al., arXiv 2305.17926).** https://arxiv.org/abs/2305.17926 (fetched). Position of candidates changes the ranking; calibration by multiple evidence, balanced position and human-in-the-loop. Plumbline: run both evidence orders; disagreement becomes `judge_unstable`, not a vote. Limits: pairwise preference setting.

**H2. LLM Evaluators Recognize and Favor Their Own Generations (Panickssery, Bowman, Feng, arXiv 2404.13076).** https://arxiv.org/abs/2404.13076 (fetched). Self-preference correlates linearly with self-recognition. Plumbline: log extractor and judge model ids; require a different family (or the rule brain, or AlignScore/MiniCheck) as second voter. Tension to resolve: the sponsor proof run pins Nemotron, so a Nemotron extractor and judge need the non-LLM second voter. Limits: preference, not verification.

**H3. Judging the Judges (Thakur et al., arXiv 2406.12624) and A Survey on LLM-as-a-Judge (Gu et al., arXiv 2411.15594).** https://arxiv.org/abs/2406.12624, https://arxiv.org/abs/2411.15594 (fetched). Thirteen judges, nine exam-takers: only the best align with humans, up to 5 points off, with leniency bias; the survey covers consistency and bias mitigation. Plumbline: pick the judge by agreement on our gold set, never by reputation; report leniency as a metric. Limits: exam-style tasks.

**H4. Prediction-Powered Inference (Angelopoulos et al., arXiv 2301.09633) and ARES (Saad-Falcon et al., arXiv 2311.09476, NAACL 2024).** https://arxiv.org/abs/2301.09633, https://arxiv.org/abs/2311.09476 (fetched). Combine many cheap model predictions with a small human-labelled set for provably valid confidence intervals; ARES applies it to RAG evaluation with a few hundred human annotations. Plumbline: replace "worst of three runs" for judge-scored metrics with PPI intervals from about 300 to 500 hand-labelled claims; the same estimates feed the section 1.7 error rates. Limits: assumes labelled and unlabelled samples are exchangeable; changing the judge model resets the calibration.

**H5. Conformal factuality (Mohri and Hashimoto, arXiv 2402.10978, ICML 2024) and coherent factuality (Rubin-Toles et al., arXiv 2505.17126).** https://arxiv.org/abs/2402.10978, https://arxiv.org/abs/2505.17126 (fetched). Back off to less specific claims for 80% to 90% correctness guarantees; coherent factuality calibrates over a **deducibility graph** so a claim is judged in the context of its premises, giving 90% factuality while keeping at least 80% of claims on MATH and FELM. Plumbline: the ledger is already a dependency graph; apply conformal back-off to model-derived claims by dropping to their verified premises; gaps cap confidence. Limits: marginal guarantees, a model-based entailment score, math-heavy evaluation; do not display probabilities until calibration earns them (spec section 9).

### I. Proof-carrying outputs, certificates, evidence law

**I1. Proof-Carrying Code (Necula, POPL 1997).** https://courses.grainger.illinois.edu/cs421/fa2010/papers/necula-pcc.pdf (fetched). The producer ships a proof that the code meets a safety policy; the consumer checks it quickly without trusting the producer. Plumbline: checking is cheap, finding is expensive: the dossier ships the explanation and certificate, the verifier only re-checks. Limits: our "proof" is re-execution or enumeration, not a logical derivation.

**I2. Certifying algorithms (McConnell, Mehlhorn, Naher, Schweitzer, Computer Science Review 5(2), 2011).** https://researchportalplus.anu.edu.au/en/publications/certifying-algorithms/ (fetched). Every output carries an easy-to-verify witness so bugs cannot silently pass. Plumbline: engineering rule for each explain operation: `(output, certificate, checker)` with the checker small enough to read; no explain function ships without its checker. Limits: survey of the idea.

**I3. Cedar (Cutler et al., arXiv 2403.04651, OOPSLA 2024; repo `cedar-policy/cedar`).** https://arxiv.org/abs/2403.04651 (fetched); repo 1,780 stars, Apache-2.0, pushed 2026-10-09.
Idea: a policy language designed to be analysable (sound and complete logical encoding), with its design modelled and proved in Lean and implemented in Rust.
Plumbline: supports **policy time travel** (spec 16.3) and impact analysis: restrict gating rules to an analysable fragment so "which past decisions would this rule change" is a solver query or an exhaustive replay; pattern only (a Rust dependency violates the judge-runs-it rule).
Limits: permit/deny authorisation, not multi-valued verdicts with precedence; analysability is bought by restricting the language, a real cost for our rules.

**I4. 2026 proof-carrying LLM preprints: Proof-Carrying Certificates for LLM Pipelines (Koomullil, arXiv 2605.16407); Proof-Carrying Agent Actions (Wang, arXiv 2606.04104); EviGraph (Zhou et al., arXiv 2610.00212).** https://arxiv.org/abs/2605.16407, https://arxiv.org/abs/2606.04104, https://arxiv.org/abs/2610.00212 (fetched).
Idea: certify only the deterministic structured part of an LLM pipeline in Lean 4 (22 certificate types, 17 of 46 declarations axiom-free, three trusted axioms, dropped claims audit-logged, 83 pages, single author); action certificates with approval and replay receipts (24 seeds expanded to 96 traces); a deterministic checker over a temporal knowledge graph that separates decision-critical requirements from what may stay unresolved, where extra verification **removed valid recommendations without improving decisions**.
Plumbline: the trust boundary (certify the deterministic spine, not the model) and "audit-log what could not be certified" match our gap ledger; the EviGraph finding is a warning: separate **must-establish** requirements (declared in policy) from optional evidence, or verification will over-abstain.
Limits: unreviewed single-team preprints, small pilots; a Lean pipeline is out of scope.

**I5. ClaimReceipt (Zhu and Chang, arXiv 2609.01992, 2026-09).** https://arxiv.org/abs/2609.01992 (fetched; first two pages read).
Idea: claim-relative sufficiency: evidence set `E` is sufficient for claim `c` iff executions with equal retained evidence have equal claim value; verdicts `PASS | INVALID | INCONCLUSIVE`; a committed experiment manifest makes omissions visible (coverage). Reported: 1,392 historical receipts, 5/5 manual verdicts reproduced, 11/11 injected faults caught with 0/8 false positives on benign variations, 0.021% inference-time overhead, 9.9 KB per transaction; the authors note their own frozen specification is not yet unambiguous to an independent reader.
Plumbline: adopt the three-valued verifier output and the **manifest-before-outcome** idea (the case manifest lists the sources to be consulted, so `not_checked` is visible, which our gap ledger already does). Their sufficiency (information in retained records) differs from ours (robustness inside a verdict function); cite both and keep them distinct.
Limits: agent-evaluation transactions, authors' own corpus, self-reported.

**I6. AUDITA (Du and Chen, arXiv 2608.22160, 2026-08).** https://arxiv.org/abs/2608.22160 (fetched; first two pages read).
Idea: signed, append-only, Merkle-committed inter-agent records; a **production gate** retires commands whose effects never arrived before any counterfactual; survivors graded by counterfactual dependence under modified Halpern-Pearl, giving a responsibility degree in [0,1] with a receipt that re-executing with the cause removed would have averted the outcome; result reported as duty, breach, causation, harm; claims of roughly threefold lower responsibility error than a judge baseline, on benchmarks of the authors' own and simulated multi-agent environments; guarantees hold under stated assumptions (re-executable stack, confined influence, keys not stolen).
Plumbline: the closest architecture to section 1.4 and 1.8; adopt the production-gate ordering (our L0 gate runs before any counterfactual), "every reported cause re-executed under intervention with a receipt" (our flip certificate), and the four-part report split.
Limits: single preprint, simulated; multi-agent logs, not reconciled records and policy.

**I7. Federal Rules of Evidence 902(13), 902(14), 1006 and 803(6).** https://www.law.cornell.edu/rules/fre/rule_902, https://www.law.cornell.edu/rules/fre/rule_1006, https://www.law.cornell.edu/rules/fre/rule_803 (all fetched, text read).
Idea: 902(14) makes data copied from an electronic device, storage medium or file self-authenticating if authenticated by "a process of digital identification", shown by a qualified person's certification; 1006 admits a summary of voluminous records only if the underlying originals or duplicates are made available for examination; 803(6) admits regularly kept business records made at or near the time, as a regular practice, unless the source or method of preparation shows a lack of trustworthiness.
Plumbline: three analogies, not legal claims. (a) Hash-anchored snapshots with capture process, operator, time and hash let an exhibit be certified (902(14)). (b) The truth table and ledger are summaries: they are only credible if the originals ship in the same bundle (1006), which the offline verifier enforces. (c) The ERP and document-lake records are business records, so `eventTime`, `recordedAt`, provenance and the `synthetic` flag are the trustworthiness metadata an opponent would probe (803(6)).
Limits: US federal rules; a person's certification remains required; no admissibility claim; legal reasoning literature (Wigmore charts, Walton schemes, Prakken and Sartor) was not reached (section 6).

**I8. Certificate Transparency, RFC 6962.** https://www.rfc-editor.org/rfc/rfc6962 (fetched). Defines Merkle audit paths (2.1.1) and consistency proofs (2.1.2), which show inclusion and append-only growth. Plumbline: an append-only ledger log with inclusion and consistency proofs inside the dossier, checkable by a short script. Limits: proves tamper evidence, not truth; trust in one log operator; the RFC is experimental-status.
Also `in-toto/attestation`: 384 stars, licence NOASSERTION, pushed 2026-10-12; **only repo metadata checked**, specification not read, so fit as an envelope format is **NOT VERIFIED**.

## 3. Top 10 ideas to adopt or extend (ranked, with the evidence)

1. **Exact RS/MSE and minimal-flip enumeration with the duality check** (section 1; Reiter 1987, A2, A3). Evidence: the duality argument is elementary and the oracle is the existing replay. Risk: instrumentation of the evaluator; worst-case cost.
2. **Modified-HP causes and responsibility on the derivation DAG** (B1, B2, I6). Evidence: AUDITA applies the same definition and reports gains over a judge baseline, but on simulated multi-agent logs.
3. **Certifying-algorithm packaging with a standalone checker and `PASS | INVALID | INCONCLUSIVE`** (I1, I2, I5, I8, I7). Evidence: ClaimReceipt reports fault detection with no false positives on its own corpus; the pattern is standard.
4. **Dung/ASPIC+ status as the formal definition of contested and unresolved, with dispute-tree certificates** (D1, D2, D4). Evidence: established theory; the construction from reconcile precedence is mine and untested.
5. **Judge-error robustness radius plus PPI/conformal calibration** (section 1.7, H4, H5, F8). Evidence: PPI and conformal results are published; their combination here is my proposal.
6. **Typed silence/contradiction labels with measured over-commit rate and a non-LLM second voter** (E10, E5, E6, F4). Evidence: E10 (preprint) and the repeated finding that binary scores conflate the two.
7. **Exact counterfactual simulatability as the explanation metric** (G3, G1, G2). Evidence: G3 shows low precision for LLM self-explanations; ours has exact ground truth.
8. **Decision-relevant gap analysis (exact value of information over finite domains)** (section 1.5, C1, I5). Evidence: none external; follows from the definitions.
9. **Calibrated, strictness-reported L2 acceptance and parametric-leakage probes** (F6, F8, E3). Evidence: unsupported-citation rate moves from about 3% to about 18% with strictness (F8); post-claim evidence inflates AVeriTeC by 6.3 points (E3).
10. **Analysable policy fragment, proof-node emission and resilience-based lint** (I3, B5, B6, B8, B7). Evidence: Cedar shows the analysis pays off; the lint idea depends on the unverified mapping in B6.

## 4. Ideas that sound good and should not be adopted

1. **Numeric gradual or quantitative-argumentation strengths as the primary display** (D7; also ArgLLM-style numeric strengths): spurious precision, conflicts with spec section 9 ("confidence is an ordinal tag").
2. **Ablation or Shapley-style attribution as the explanation** (ContextCite, AttriBoT, Anchors): approximate, needs model internals, and F6 (2026) shows it cannot separate parametric knowledge from context; keep as a diagnostic only.
3. **LLM-generated arguments or rationales as evidence** (D6, G2): not anchored to a hashed source; CoT can omit the real cause (G2).
4. **SelfCheckGPT or other self-consistency scores as a verdict signal** (E9): consistent error passes; measures the model, not support.
5. **A single binary "supported" score** (MiniCheck, AlignScore used alone): collapses silence and contradiction, which `04` section 8 and E10 both show is the failure that matters.
6. **Full Lean 4 certificate pipeline** (I4): heavy, single-author, and the spec's offline verifier needs a script, not a kernel.
7. **Blockchain-style chains, signature infrastructure and key management** (I5, I6): adopt only an append-only Merkle log (I8); keys and consensus add attack surface with no judge-visible gain.
8. **Vendoring GPL or stale argumentation code** (Tweety GPL-3.0, Carneades stale since 2019): write the small engine; use them as offline oracles.
9. **Showing conformal or PPI results as probabilities of correctness** before the calibration report (spec 16.6) exists.
10. **More verification layers as a reflex** (I4, EviGraph): extra checks removed valid outputs; every layer needs an ablation showing it helps.

## 5. Three research contributions a grant reviewer would value

1. **Exact, certified explanation of policy verdicts over typed, hash-verified evidence ledgers, with a benchmark whose explanation ground truth is exact.** Formal XAI computes abductive and contrastive explanations for classifiers; the LLM-citation literature judges attribution by humans or by LLM judges. Joining them for non-monotone policy verdicts, with certificates a stranger can re-check offline and a simulatability score with exact ground truth (G3), is a defined gap. Closest priors found: MEG (monotone, set cover, entailment-based), AUDITA (modified HP over multi-agent logs), ClaimReceipt (sufficiency of retained records). Falsifiable: measure how often the spec's leave-one-out L4 classes disagree with the exact classes, and how often tampered bundles pass the verifier (target zero).
2. **Robustness radius against judge error.** Turn the unavoidable noise of LLM entailment judges into a combinatorial statement about the verdict: the minimum number of judged-edge errors that changes it, with per-label error rates calibrated by PPI. I found no paper doing this in the searches run (search coverage was capped); do not claim novelty without a wider search. Falsifiable by injecting labelled errors and checking the predicted flips.
3. **Evidence-grounded argumentation for contested claims with contestation as an edit.** Build the framework mechanically from verified evidence (no LLM-written arguments), define contested and unresolved by Dung semantics, ship dispute-tree certificates, and evaluate contestation (add attack, remove evidence) against predicted status changes on a benchmark that separates silence, contradiction and equal-authority conflict. Contrast with ArgLLM-style systems whose arguments come from the model. This supports the spec's open benchmark (16.5).

## 6. What I could not verify

- **Fetch failures**: Carneades paper abstract (two sources returned 403 or access denied); the ASPIC+ tutorial PDF (403, so the rule that undercuts always defeat is unchecked); the MARCO MUS-enumeration paper (Constraints 2016; only a search listing, Springer redirect and PDF certificate failed), so it is not cited as an item; Nature page of semantic entropy (redirect), so semantic entropy is left out; Eiter-Lukasiewicz complexity numbers are verified only through their quotation in the Aleksandrowicz abstract.
- **Not reached because search budget ran out**: ICCMA solver landscape, the original quantitative bipolar argumentation papers, Prakken and Sartor on law and argumentation, Walton argumentation schemes, Wigmore and Anderson-Schum-Twining evidence analysis, Logic-LM (repository not found under the owner I tried), and the MT-Bench judge paper. Evidence-law coverage is therefore thin: only FRE 902.
- **Design claims with no evidence yet**: runtime of exact enumeration on our ledgers; that attribute decomposition keeps the policy state space small; that the mapping of rules to conjunctive queries (B6) holds; that judge errors can be treated as independent (probably not); that hosted Nemotron endpoints expose log-probabilities needed by ablation methods; that MiniCheck, AlignScore or LettuceDetect can run in a TypeScript process (ONNX export unchecked); that no published system already computes robust sufficiency and flips for policy verdicts (search was incomplete).
- **Status of 2026 preprints**: their peer-review status was not checked; their numbers are the authors' own and mostly single-team.
- **Repository metadata** (stars, licences, push dates) is as returned by the GitHub API on 2026-10-13; `NOASSERTION` means GitHub could not detect an SPDX licence, not that none exists. The `microsoft/DiCE` slug returned 3 stars and is not the canonical repository; `interpretml/DiCE` is the one cited.
