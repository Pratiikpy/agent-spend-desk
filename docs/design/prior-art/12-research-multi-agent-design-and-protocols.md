# Prior art 12: multi-agent design, role justification and agent protocols

Status: research input to `00-architecture-master-spec.md` sections 3, 5 and 11. Nothing here is built or measured. Every Plumbline claim below is a hypothesis with a named test; anything not fetched and read this session is marked **UNVERIFIED** or left out.

## 0. Method and limits

- Date of research: 2026-10-13. Every paper and spec was fetched from its primary page (arXiv abstract page, vendor page or the specification site) and read; numbers below are the ones those pages state. Papers were read at abstract or summary level, not reproduced; per-benchmark tables were not inspected.
- Every repository was checked with `gh api repos/OWNER/NAME`; stars, licence, last push and archived flag are quoted as returned on 2026-10-13. Nothing was cloned or installed.
- Vendor and lab numbers (Anthropic, Microsoft, Google) are self-reported on their own benchmarks and are treated as claims, not facts about Plumbline.
- Labels used: **Fact** (stated by the fetched page), **Inference** (our reading, with the reasoning), **Hypothesis** (needs the named ablation).
- Not covered: paper bodies and appendices, independent replication of any result, non-English literature, closed products, OWASP Agentic Applications 2026 (owned by the threat-model module), Zetaris internals (see `docs/sponsors/zetaris-integration-notes.md`, which records no verified tool names).

## 1. Verdict first

**The judge question: "why multiple agents here rather than one strong model with tools?"**

Defensible answer, in one paragraph. The literature does not support "more agents, better answers". Under equal billed reasoning tokens a single agent matches or beats multi-agent systems on multi-hop reasoning (Tran and Kiela 2026), debate adds nothing over voting in expectation (Choi et al. 2025), and a strong single prompt matches multi-agent discussion (Wang et al. 2024). Plumbline therefore does **not** claim that agents improve raw accuracy. It claims four narrower things, each tied to evidence and each ablated:

1. **Independent verification.** A checker that shares the producer's context or model family is a weak checker (Huang et al. 2023 on self-correction; Panickssery et al. 2024 on self-preference; Kambhampati et al. 2024 on LLM-Modulo). The strongest checker in the system is deterministic code (L0, rule engine, schema); LLM critics are advisory and from a different model family.
2. **Trust-boundary isolation.** The component that reads vendor-controlled text must hold no tool authority and emit only typed data (CaMeL, Debenedetti et al. 2025; Beurer-Kellner et al. 2025). A monolith with tools and untrusted documents in one context cannot offer this. This is a security argument and holds even if accuracy is equal.
3. **Parallel, decomposable work in separate contexts.** Source retrieval and per-claim checks are independent subtasks; this is the regime where multi-agent gains are largest (+80.8% on decomposable financial reasoning, Kim et al. 2025) and where a single agent's context utilisation degrades (the stated exception in Tran and Kiela 2026).
4. **Capability and cost heterogeneity.** Small models for extraction and matching, larger or panelled models only for arbitration (FrugalGPT, AutoMix, PoLL, NVIDIA's SLM position paper).

Where none of the four holds, the role is deterministic code or is merged (section 8). The proof is the **Role-Necessity Ablation** (section 9): each role is removed or replaced, with token-matched single-model baselines, and a role stays only if it earns its place on a pre-registered metric or security property. If the ablation says a role does not earn it, we say so in the README.

**Roles, short form** (full reasoning in section 8):

| Role | Verdict |
|---|---|
| planner | hybrid: deterministic required-checks plan, LLM may only propose additions through a gate |
| source agents | split: channels are code; document extractor is a small-model function; web discovery is a quarantined LLM agent; silo access is a typed MCP client |
| reconciler | deterministic code; LLM only as matcher inside the entity-resolution cascade |
| decomposer | typed LLM function (small model) with code drift guard; not an agent |
| weaver | merge into L0 code plus L2 entailment; no separate agent |
| advocate, skeptic | keep, as symmetric tool-using evidence searchers, on routed claims only; ablated against token-matched voting |
| arbiter | deterministic rule over verified evidence first; model-family-diverse panel only for the residue |
| policy judge | skipped entirely when the rule engine leaves one allowed action; otherwise LLM within the allowed set |
| critic | hard critic = validators (code); soft critic = advisory LLM from another family |
| reporter | deterministic renderer from the ledger; optional LLM paraphrase behind a sentence-to-claim-id verifier |

This keeps at least nine of the ten collaboration behaviours the organizers list (delegation, specialised roles, tool use, critique, revision, shared state, branching on confidence, recovery, escalation, traceability) but puts the "agentic" weight where the evidence says it earns something.

## 2. Why multi-agent LLM systems fail

### 2.1 MAST: "Why Do Multi-Agent LLM Systems Fail?"

- What: first empirical taxonomy of multi-agent failures; 1,600+ annotated traces over 7 frameworks, 14 failure modes in 3 categories; inter-annotator kappa 0.88 on the 150-trace development set.
- Meta: arXiv 2503.13657 (Cemri et al., Berkeley; submitted 2025-03-17, v3 2025-10-26) https://arxiv.org/abs/2503.13657. Repo `multi-agent-systems-failure-taxonomy/MAST`: 424 stars, licence null, pushed 2025-07-23, not archived.
- Fact (category shares, from the paper HTML): specification issues 41.77% (step repetition 17.14%, disobey task spec 10.98%, unaware of termination 9.82%); inter-agent misalignment 36.94% (reasoning-action mismatch 13.98%, failure to ask for clarification 11.65%, task derailment 7.15%); task verification 21.30% (premature termination 7.82%, no or incomplete verification 6.82%, incorrect verification 6.66%).
- Fact: two intervention case studies on ChatDev (baseline 33.33% correctness): better role specifications +9.4%, a multi-level verification architecture +15.6%. The paper's own framing is that gains on popular benchmarks are often minimal.
- Plumbline use: the taxonomy is a design checklist and an evaluation lens. Map each mode to a mechanism that removes it: FM-1.5 and FM-3.1 (termination) to hard turn and budget caps plus an explicit stop-reason field in every step; FM-1.3 (repetition) to the hashed-state loop detector in the runtime; FM-2.2 (no clarification) to an intake validator that refuses an under-specified case instead of guessing; FM-2.6 (reasoning-action mismatch) to typed action proposals checked against the closed action registry; FM-3.2 and 3.3 (verification) to L0 plus independent verifiers. Run the MAST annotator (if it runs on custom traces, **UNVERIFIED**) over our JSONL traces and over a framework-built control to publish a failure-mode profile.
- Limits: failures are measured on coding, maths and general-agent tasks, not on a decision workflow; the interventions are single case studies; the taxonomy does not say a deterministic design would score better, only where frameworks break.

### 2.2 Who&When: automated failure attribution

- What: dataset of failure logs from 127 multi-agent systems annotated with the responsible agent and step; tests whether an LLM can say who failed and when.
- Meta: arXiv 2505.00212 (Zhang et al.; submitted 2025-04-30) https://arxiv.org/abs/2505.00212. Repo `mingyin1/Agents_Failure_Attribution`: 36 stars, MIT, pushed 2026-01-06.
- Fact: best attribution accuracy is 53.5% at agent level and 14.2% at step level; o1 and R1-class models fall short of usable.
- Plumbline use: LLM-based blame assignment is unreliable, so blame must be mechanical. Each inter-agent message is a typed contract with a validator; a violation names the step, the field and the producing role. This becomes contribution 2 in section 13.
- Limits: the dataset is from existing frameworks; our step-level attribution advantage holds only for contract violations, not for semantically wrong but well-formed output.

### 2.3 Multi-agent systems execute arbitrary malicious code

- What: shows that adversarial content in files or web pages can hijack the control flow of orchestrated agent systems.
- Meta: arXiv 2503.12188 (Triedman, Jha, Shmatikov; submitted 2025-03-15, revised 2025-09-12) https://arxiv.org/abs/2503.12188.
- Fact: malicious code execution succeeded in 58 to 90% of trials with GPT-4o depending on the orchestrator, up to 100% in some configurations, even where individual agents refuse harmful actions.
- Plumbline use: splitting into agents is not a security boundary by itself. Messages between roles must be typed data, never instructions; the planner never reads raw vendor text; a role's tool scope is fixed by the signed contract, not by anything an upstream agent says.
- Limits: attacks target specific frameworks' orchestration; the numbers do not transfer to a typed-contract design, which is exactly what our red-team range must test.

## 3. When multiple agents beat one, and when they do not

### 3.1 Towards a Science of Scaling Agent Systems

- What: 260 configurations across five architectures (single, independent, centralized, decentralized, hybrid) and six benchmarks; fits a predictive model of when coordination helps.
- Meta: arXiv 2512.08296 (Kim et al.; submitted 2025-12-09, revised 2026-04-08) https://arxiv.org/abs/2512.08296.
- Fact: multi-agent ranges from +80.8% on decomposable financial reasoning to -70.0% on sequential planning; cross-validated R2 = 0.373; picks the best architecture in 87% of held-out configurations; diminishing returns once the single agent is strong; tool-heavy tasks pay an overhead; architectures without centralised verification propagate errors more.
- Plumbline use: classify each stage by structure. Reconcile (per-source retrieval) and Explain (per-claim checks) are decomposable, so fan-out is justified there. Decide is sequential and shared-state, so it stays a single deterministic-plus-one-judge path. Use their five architecture labels as the arms of our own comparison so the result is comparable.
- Limits: R2 of 0.373 is a modest predictor; the benchmarks are not procurement; "centralised verification helps" matches our design but is their finding on their tasks.

### 3.2 Single-agent baselines under equal compute (2026)

- Tran and Kiela, "Single-Agent LLMs Outperform Multi-Agent Systems on Multi-Hop Reasoning Under Equal Thinking Token Budgets": arXiv 2604.02460 (submitted 2026-04-02, revised 2026-04-11) https://arxiv.org/abs/2604.02460.
  - Fact: three model families (Qwen3, DeepSeek-R1-Distill-Llama, Gemini 2.5); single agents consistently match or beat multi-agent architectures at equal reasoning tokens; multi-agent becomes competitive when a single agent's context use degrades or more compute is spent; API-based budget control has artifacts that inflate multi-agent gains.
  - Plumbline use: our ablation must meter **billed** tokens from the trace, not requested budgets, for every arm. This is the strictest baseline the judge can cite, so we beat it or concede it.
- Xu et al., "Rethinking the Value of Multi-Agent Workflow: A Strong Single Agent Baseline" (OneFlow): arXiv 2601.12307 (2026-01-18) https://arxiv.org/abs/2601.12307.
  - Fact: on seven benchmarks a single agent reaches the performance of homogeneous workflows with a KV-cache efficiency advantage; heterogeneous (different-model) workflows are explicitly outside the claim.
  - Plumbline use: the only multi-agent structures worth defending are heterogeneous ones (different model families or sizes, different tool scopes). Homogeneous role-play on one model is the weakest case and gets the hardest ablation.
- Limits for both: reasoning benchmarks, not tool-using workflows with untrusted inputs; neither covers security or independent verification, which are our other two arguments.

### 3.3 Anthropic: multi-agent research system and "Building effective agents"

- What: engineering write-ups of an orchestrator-worker research system and of five workflow patterns (prompt chaining, routing, parallelisation, orchestrator-workers, evaluator-optimizer).
- Meta: https://www.anthropic.com/engineering/multi-agent-research-system and https://www.anthropic.com/engineering/building-effective-agents (vendor blog posts, no version metadata).
- Fact: lead agent plus parallel subagents beat single-agent Claude Opus 4 by 90.2% on Anthropic's internal research eval; agents use about 4x and multi-agent about 15x the tokens of chat; token usage alone explained 80% of the variance on browsing tasks, with model choice and tool-call count explaining most of the rest; poor fit for shared-context, tightly interdependent tasks and most coding; evaluation started with about 20 queries, LLM-as-judge on a rubric plus human review; errors compound in stateful runs and full tracing was needed. The patterns post says optimising a single LLM call with retrieval is usually enough and agents add cost and compounding error.
- Plumbline use: (a) the 80% token-variance finding is the best evidence that much of the multi-agent gain is compute, which is why our ablation is token-matched; (b) orchestrator-worker with parallel source agents maps onto Reconcile; (c) evaluator-optimizer is our critic/reflexion loop, valid only "where clear evaluation criteria exist", which our rule engine and L0 provide; (d) scaling rules in the planner prompt map to our difficulty router (section 6).
- Limits: internal benchmark, not reproducible; lead and workers are different Claude models, so heterogeneity is confounded with architecture; no variance reported on the page we read.

### 3.4 Cognition: "Don't Build Multi-Agents"

- Meta: https://cognition.com/blog/dont-build-multi-agents (published 2025-06-12; the old `cognition.ai` URL redirects).
- Fact: two principles, share full traces not just messages, and actions carry implicit decisions so conflicting decisions give bad results; recommends a single-threaded linear agent, with a history-compressing model for very long tasks.
- Plumbline use: argues for keeping the Decide stage single-threaded and for passing fact ids and the full typed state rather than prose summaries (already in the Markovian carryover design). Parallel workers return typed evidence only and never take dependent decisions.
- Limits: an opinion piece from a coding-agent vendor, no measurement. Its coding setting is the one Anthropic also calls a poor fit for multi-agent, so the two agree more than they seem to.

### 3.5 Debate, ensembles and the heterogeneity question

| Item | Fact | Use and limit |
|---|---|---|
| Du et al., multiagent debate, arXiv 2305.14325 (2023-05-23) https://arxiv.org/abs/2305.14325 | debate over rounds improves reasoning and factuality on tested tasks | the origin of the claim; later work below shows it does not survive strong baselines |
| Smit et al., "Should we be going MAD?", arXiv 2311.17371 (2023-11-29, rev. 2024-07-18) https://arxiv.org/abs/2311.17371 | MAD does not reliably beat self-consistency and ensembling; sensitive to hyperparameters | evidence for a vote baseline in every debate ablation |
| Wang et al., "Are multi-agent discussions the key?", arXiv 2402.18272 (2024-02-28) https://arxiv.org/abs/2402.18272 | a single agent with a strong prompt nearly matches the best discussion method; discussion only wins without demonstrations | prompt quality is a confound; our single-model arm gets the same few-shot examples |
| Zhang et al., "Stop Overvaluing Multi-Agent Debate", arXiv 2502.08788 (2025-02-12, rev. 2025-06-21) https://arxiv.org/abs/2502.08788 | 5 MAD methods x 9 benchmarks x 4 models often fail to beat CoT and self-consistency; model heterogeneity is the consistent improvement | supports heterogeneous advocate, skeptic and arbiter; the benchmarks are reasoning, not evidence-grounded verification |
| Choi, Zhu, Li, "Debate or Vote", arXiv 2508.17536 (2025-08-24, NeurIPS 2025 Spotlight) https://arxiv.org/abs/2508.17536; repo `deeplearning-wisc/debate-or-vote` 93 stars, licence null, pushed 2025-10-15 | majority voting accounts for most of MAD's gains; debate modelled as a martingale so it does not raise expected correctness; interventions that bias belief updates toward correction help | the key negative result; our debate arm must beat plain k-vote at equal tokens, and any debate we keep must use a correction-biased protocol |
| Li et al., "More Agents Is All You Need", arXiv 2402.05120 (2024-02-03, rev. 2024-10-11, TMLR) https://arxiv.org/abs/2402.05120 | sampling-and-voting scales with agent count; gain larger on harder tasks | a vote of k independent samples is the cheap baseline and a cheap component |
| Wang et al., self-consistency, arXiv 2203.11171 (2022-03-21, ICLR 2023) https://arxiv.org/abs/2203.11171 | +17.9% GSM8K, +6.4% StrategyQA over greedy CoT | the baseline everything is compared with |
| Wang et al., Mixture-of-Agents, arXiv 2406.04692 (2024-06-07) https://arxiv.org/abs/2406.04692; repo `togethercomputer/MoA` 2,983 stars, Apache-2.0, pushed 2025-01-07 | layered aggregation, 65.1% AlpacaEval 2.0 vs 57.5% for GPT-4 Omni | open-ended generation; not a verification setting |
| Li et al., "Rethinking Mixture-of-Agents" (Self-MoA), arXiv 2502.00674 (2025-02-02) https://arxiv.org/abs/2502.00674 | aggregating many samples of one top model beats mixing different models (+6.6% AlpacaEval 2.0 over MoA); mixing different LLMs often lowers average quality | **contradicts** the heterogeneity-always-helps reading of Zhang et al.; this is why heterogeneity is an ablation arm, not an assumption |
| Chen et al., ReConcile, arXiv 2309.13007 (2023-09-22, rev. 2024-06-21) https://arxiv.org/abs/2309.13007 | round-table of diverse LLMs with confidence-weighted voting, up to +11.4% over baselines, beats GPT-4 on three datasets | the source of our spec's round-table; shows gains from diversity plus confidence weighting, but on reasoning questions with a ground-truth answer |
| Khan et al., "Debating with More Persuasive LLMs", arXiv 2402.06782 (2024-02-09, rev. 2024-07-25) https://arxiv.org/abs/2402.06782 | with weaker judges and stronger debaters, debate reached 76% (model judges) and 88% (human judges) vs 48% and 60% naive baselines | the one result favouring adversarial pairs; depends on the judge being weaker than the debaters and on optimising persuasiveness; whether quotes were mechanically verified in their setup is **UNVERIFIED** |

Inference for Plumbline. Our disagreements are mostly *between records*, not between model beliefs about a question with a hidden answer. A model debate cannot resolve whether the ERP or the registry holds the true bank account; only authority rules, dates and independent corroboration can. So (a) reconciliation uses the deterministic resolution function; (b) advocate and skeptic are not debaters trying to persuade a judge, they are two searchers with opposite objectives whose outputs are only admitted as quotes that L0 verifies; (c) any model "debate" is replaced by or compared with independent k-sample voting at matched tokens, as Choi et al. require.

## 4. Verifiers, critics and judges

| Item | Fact | Use and limit |
|---|---|---|
| Kambhampati et al., "LLMs Can't Plan, But Can Help Planning in LLM-Modulo Frameworks", arXiv 2402.01817 (2024-02-02) https://arxiv.org/abs/2402.01817 | LLMs cannot reliably self-verify; external model-based verifiers in a tight loop are the remedy | the theoretical basis for code-first critics; Plumbline's rule engine and L0 are the "model-based verifiers" |
| Huang et al., "LLMs Cannot Self-Correct Reasoning Yet", arXiv 2310.01798 (2023-10-03, rev. 2024-03-14) https://arxiv.org/abs/2310.01798 | without external feedback, self-correction often degrades accuracy | reflexion must be triggered by a deterministic failure or human rejection (already in spec section 10) |
| Panickssery et al., "LLM Evaluators Recognize and Favor Their Own Generations", arXiv 2404.13076 (2024-04-15) https://arxiv.org/abs/2404.13076 | self-recognition correlates linearly with self-preference | critic and arbiter must be a different model family from the producer; log both ids in the trace |
| Verga et al., "Replacing Judges with Juries" (PoLL), arXiv 2404.18796 (2024-04-29) https://arxiv.org/abs/2404.18796 | a panel of several smaller diverse judges outperforms a single large judge, shows less bias, is over 7x cheaper | design for the arbiter panel; evaluated on LLM-output judging, not entailment against source text |
| Lifshitz, McIlraith, Du, "Multi-Agent Verification", arXiv 2502.20379 (2025-02-27) https://arxiv.org/abs/2502.20379 | many aspect verifiers combined with best-of-n scale better than self-consistency and reward models; weak verifiers can help strong generators | maps to per-aspect checks (quote fidelity, entailment, numeric/date consistency, scope); aspects must be deterministic where possible |
| Saad-Falcon et al., "Shrinking the Generation-Verification Gap with Weak Verifiers" (Weaver), arXiv 2506.18203 (2025-06-22, rev. 2026-08-06) https://arxiv.org/abs/2506.18203 | weak-supervision weighting of several imperfect verifiers lifts average accuracy to 87.7% with Llama 3.3 70B plus smaller verifiers; distilled to a 400M cross-encoder | idea: learn verifier weights from our gold set instead of equal votes; their tasks are not ours |
| Zhang et al., Generative Verifiers (GenRM), arXiv 2408.15240 (2024-08-27, ICLR 2025) https://arxiv.org/abs/2408.15240 | verification as next-token prediction beats discriminative verifiers and LLM-as-judge on maths | needs trained models; a later option, not a build dependency |
| Brown et al., "Large Language Monkeys", arXiv 2407.21787 (2024-07-31) https://arxiv.org/abs/2407.21787 | coverage grows log-linearly with samples over four orders of magnitude; majority vote and reward models plateau without an automatic verifier | the strongest argument for deterministic verifiers: more samples help only if a checker can pick the right one. L0 is that checker |
| Venkataramani et al., MAS-ProVe, arXiv 2602.03053 (2026-02-03, rev. 2026-08-31) https://arxiv.org/abs/2602.03053 | process-level verification (LLM judges, reward models, PRMs) does not consistently improve multi-agent performance and has high variance; LLM judges beat algorithmic rewards; trained judges beat general ones | warns against an LLM that scores agent trajectories as a gate; verify artefacts (claims and evidence), not conversations |
| Zhong et al., "Hardening Agent Benchmarks with Adversarial Hacker-Fixer Loops", arXiv 2606.08960 (2026-06-08) https://arxiv.org/abs/2606.08960 | 323 tasks (16%) across five agent benchmarks had exploitable verifiers; a hacker-fixer-solver loop took KernelBench attack success from 62% to 0% on held-out exploits; a weaker model's fixes defended against a stronger attacker (61% to 0%) | apply the loop to our own verifiers (L0, rule engine, schema): a hacker agent tries to get a bad claim or release past them, a fixer patches, a solver confirms good cases still pass |

Inference. The verification evidence has a consistent shape: independence beats intelligence. A panel of different small models, or a stronger model from a different family, or best of all a program, checks better than the producer checking itself. MAS-ProVe is the caution that LLM verification of *processes* is noisy, so Plumbline verifies *artefacts* against stored source text.

## 5. Orchestration designs and frameworks (patterns only; D-007 stands)

### 5.1 Magentic-One and Magentic-UI

- What: Microsoft's generalist multi-agent system (Orchestrator plus WebSurfer, FileSurfer, Coder/Terminal) and its human-in-the-loop successor.
- Meta: Magentic-One arXiv 2411.04468 (submitted 2024-11-07) https://arxiv.org/abs/2411.04468; Magentic-UI arXiv 2507.22358 (2025-07-30) https://arxiv.org/abs/2507.22358; repo `microsoft/magentic-ui` 10,095 stars, MIT, pushed 2026-09-23 (its description now reads "MagenticLite is an experimental agent..."); Magentic-One lives in `microsoft/autogen` (61,392 stars, licence field CC-BY-4.0 as reported by the API, pushed 2026-04-15, README states **maintenance mode** with `microsoft/agent-framework`, 14,112 stars, MIT, pushed 2026-10-13, as the successor).
- Fact: the Orchestrator keeps a Task Ledger (facts and educated guesses) and a Progress Ledger, and re-plans when progress stalls over several steps; results on GAIA, AssistantBench and WebArena; the docs warn to run in containers, restrict the internet, keep human oversight and note susceptibility to prompt injection from web pages. Magentic-UI: co-planning, co-tasking, multi-tasking, action guards, long-term memory, MCP extensibility.
- Plumbline use: the two ledgers are a good typed-state schema for the planner (known facts, open questions, plan, per-step progress, stall counter, replan count) and give the runtime a deterministic stall rule, which addresses MAST FM-1.3 and FM-1.5. Action guards are the precedent for our approval gates; co-planning is the precedent for a human editing the proposed check list on a deep case.
- Limits: benchmark-level evidence only on web tasks; the ledgers are free text in the original, ours must be typed; Magentic-One's own docs show the injection exposure we are designing against.

### 5.2 Google ADK

- Meta: `google/adk-python` 21,795 stars, Apache-2.0, pushed 2026-10-13, not archived. Docs: https://adk.dev/workflows/.
- Fact (docs page): graph-based workflows with decision branching, dynamic code-driven workflows, coordinator-plus-sub-agent collaboration, and template workflows (sequential, loop, parallel) that are fixed execution structures.
- Plumbline use: the useful idea is that orchestration structures can be non-LLM objects (sequential, parallel, loop agents) composed with LLM agents. Our runtime graph already does this; ADK is evidence the pattern is mainstream, not something to import. ADK state-sharing specifics (such as an output key) were not confirmed on the pages read: **UNVERIFIED**.
- Limits: Python; framework state is not content-addressed or replayable in the sense of spec section 5.

### 5.3 OpenAI Agents SDK

- Meta: `openai/openai-agents-python` 30,010 stars, MIT, pushed 2026-10-13. Docs: https://openai.github.io/openai-agents-python/handoffs/.
- Fact: a handoff is exposed to the model as a tool (`transfer_to_<agent>`); `input_type` types the model-generated handoff arguments and the SDK says to use it for small metadata only; `on_handoff` runs a callback; `input_filter` rewrites what history the next agent sees; **input guardrails apply only to the first agent and output guardrails only to the final agent, and tool input guardrails do not cover handoffs**.
- Plumbline use: (a) handoff as a typed tool call with a schema is the right shape for the planner-to-source delegation; (b) `input_filter` is the Context-Packer pairing: a pure function from state to the next role's view, hashed in the trace; (c) the guardrail gap is a documented example of why our gates sit on **every edge** (`Proposal<T>` to `Approved<T>`), not only at the ends.
- Limits: handoff transfers control to an LLM agent; in Plumbline the router is code that reads typed state, so a model never chooses the next role in the decision path.

### 5.4 MetaGPT and role-based assembly lines

- Meta: arXiv 2308.00352 (Hong et al.; 2023-08-01, rev. 2024-11-01) https://arxiv.org/abs/2308.00352; repo `FoundationAgents/MetaGPT` 70,835 stars, MIT, pushed 2026-01-21.
- Fact: encodes standard operating procedures into prompt sequences; agents produce structured intermediate artefacts to reduce cascading errors from naive chaining.
- Plumbline use: the durable idea is *structured intermediate artefacts with verification between roles*, which is our claim ledger and truth table. The persona framing is not what carries the benefit (see next item).
- Limits: software-engineering tasks; no ablation separating SOP artefacts from role personas in the page we read.

### 5.5 Role specialisation: what the evidence supports

- Zheng et al., "When 'A Helpful Assistant' Is Not Really Helpful", arXiv 2311.10054 (2023-11-16, EMNLP 2024) https://arxiv.org/abs/2311.10054. Fact: 162 personas x 4 model families x 2,410 factual questions; persona text in the system prompt does not improve performance over no persona.
- MAST (2.1): enhanced role specifications gave +9.4% on one ChatDev case, but the structural verification change gave +15.6%.
- Inference: specialisation pays when it changes **tools, context, model or schema**, not the persona sentence. Every Plumbline role is therefore defined by (tool scope, input view, output schema, model tier), and the persona line is never counted as the reason for the role. Hypothesis tested in ablation arm "persona-only": same model, same tools, same view, only the role text differs.

## 6. Cost-aware routing, cascades and test-time compute

| Item | Fact | Use and limit |
|---|---|---|
| Chen, Zaharia, Zou, FrugalGPT, arXiv 2305.05176 (2023-05-09) https://arxiv.org/abs/2305.05176; repo `stanford-futuredata/FrugalGPT` 290 stars, Apache-2.0, pushed 2025-02-10 | cascade of models with a learned stop; matches GPT-4 with up to 98% lower cost, or +4% accuracy at equal cost | our cascade: small model, then a code validator accepts or escalates. Their scorer is learned; ours is a validator (schema pass, quote found, two samples agree). Reported on 2023-era models and tasks |
| Aggarwal et al., AutoMix, arXiv 2310.12963 (2023-10-19, rev. 2025-01-19) https://arxiv.org/abs/2310.12963 | few-shot self-verification plus a POMDP router; over 50% cost reduction at comparable performance | self-verification is the weak link per section 4; use agreement across samples plus validators as the confidence signal instead |
| Ong et al., RouteLLM, arXiv 2406.18665 (2024-06-26, rev. 2025-02-23) https://arxiv.org/abs/2406.18665; repo `lm-sys/RouteLLM` 5,596 stars, Apache-2.0, pushed 2024-08-10 | routers trained on human preference data cut cost by over 2x in some cases and transfer when the model pair changes | trained on chat preferences, unlike extraction or entailment; repo has not been updated since 2024-08. Not adopted as is; a learned router is a later option trained on our own traces |
| Yue et al., MasRouter, arXiv 2502.11133 (2025-02-16) https://arxiv.org/abs/2502.11133 | cascaded controller picks collaboration mode, role allocation and LLM per query: +1.8 to 8.2% on MBPP, up to 52.07% cost cut on HumanEval | relevant to choosing "single or panel" per claim; benchmarks are code generation |
| Zhang, Feng, You, Router-R1, arXiv 2506.09033 (2025-06-10, v3 2025-10-24) https://arxiv.org/abs/2506.09033 | RL-trained multi-round router with a cost reward, beats baselines on seven benchmarks | needs RL training data; shows the cost term belongs in the objective |
| Belcak et al. (NVIDIA), "Small Language Models are the Future of Agentic AI", arXiv 2506.02153 (2025-06-02, latest revision 2026-09-22) https://arxiv.org/abs/2506.02153 | argues SLMs suffice for repetitive, narrow agent subtasks and recommends heterogeneous systems; the page we read describes the evidence as architectural analysis and economics, not controlled experiments | directly relevant to the NVIDIA sponsor profile and to "small for extraction, large for arbitration"; an argument, not a measurement, so we measure it on our gold set |
| Snell et al., "Scaling LLM Test-Time Compute Optimally", arXiv 2408.03314 (2024-08-06) https://arxiv.org/abs/2408.03314 | allocating test-time compute by prompt difficulty beats uniform best-of-N by more than 4x in efficiency, and can beat a 14x larger model when the base model has modest success | the principle behind difficulty-adaptive effort; needs a difficulty signal, which we derive from the rule engine (section 13, contribution 1) |
| Kapoor et al., "AI Agents That Matter", arXiv 2407.01502 (2024-07-01) https://arxiv.org/abs/2407.01502 | agent benchmarks ignore cost, lack holdouts, and simple baselines often match complex agents at lower cost | evaluation rules: report cost with accuracy (a Pareto frontier), keep a holdout, include simple baselines |

Plumbline cascade design (hypothesis, ablated):

1. Tier 0 code: deterministic parsers, exact and normalised match, lexical gate, rule engine. No model call.
2. Tier 1 small model: field extraction from documents, claim decomposition, candidate entity matching. Output must pass the schema and L0; failure escalates once, never loops.
3. Tier 2 mid model, two to three independent samples: used when Tier 1 fails validation or the samples disagree.
4. Tier 3 panel of different-family models: only for claims the sensitivity router (section 13.1) marks verdict-relevant and still contested after Tiers 0 to 2.
5. Human: anything unresolved after Tier 3 or whose autonomy cap requires it.
Escalation signals are validators and sample agreement, never a model's self-reported confidence. Each tier's model id is in the trace; the model-family-independence rule applies between producer and checker. The Nemotron sponsor profile fixes the NVIDIA endpoint for the proof run; which Nemotron variants and sizes that endpoint exposes is **UNVERIFIED** (`docs/sponsors/nvidia-integration-notes.md` is empty), so family diversity inside the sponsor profile may be limited to size diversity, which weakens the self-preference defence and must be reported as a limitation if so.

## 7. Agentic workflow search (offline tool only)

| Item | Fact | Use and limit |
|---|---|---|
| AFlow, arXiv 2410.10762 (2024-10-14, rev. 2025-04-15) https://arxiv.org/abs/2410.10762; repo `FoundationAgents/AFlow` 612 stars, MIT, pushed 2025-12-25 | MCTS over code-represented workflows; +5.7% average over prior methods on six datasets; smaller models beat GPT-4o on some tasks at 4.55% of its cost | a workflow is code, so searched workflows are auditable and hashable. Search uses benchmark scores, so overfit risk (see Kapoor et al.) |
| ADAS, Hu, Lu, Clune, arXiv 2408.08435 (2024-08-15, rev. 2025-03-02) https://arxiv.org/abs/2408.08435; repo `ShengranHu/ADAS` 1,646 stars, Apache-2.0, pushed 2025-01-28 | a meta agent programs new agents from an archive; claimed to beat hand-designed agents and to transfer across domains and models | meta-agent code generation is an execution risk; use only in a sandbox on synthetic data |
| MaAS, Zhang et al., arXiv 2502.04180 (2025-02-06, rev. 2025-06-09) https://arxiv.org/abs/2502.04180; repo `bingreeky/MaAS` 287 stars, licence null, pushed 2025-11-13 | samples a query-dependent architecture from a learned supernet; uses 6 to 45% of the inference cost of other multi-agent systems with +0.54 to 11.82% accuracy | the query-dependent idea matches our difficulty router, but sampled topologies are not replayable unless the sample is recorded |
| MASS, Zhou et al., arXiv 2502.02533 (2025-02-04, rev. 2026-01-31) https://arxiv.org/abs/2502.02533 | three-stage optimisation of block prompts, topology and global prompts; prompts and topologies both matter | confirms prompts are a confound in any topology comparison; our ablation fixes prompt quality per role |
| HierFlow, arXiv 2607.21609 (2026-05-20) https://arxiv.org/abs/2607.21609; GRAFT, arXiv 2608.02353 (2026-08-03) https://arxiv.org/abs/2608.02353 | topology plus execution search with MCTS; inference-time replacement of weak regions of a workflow (+3.85 points over MaAS) | recent but only abstract-level read here; same limits as above. Not evidence for our case |

Inference: workflow search is a development-time instrument for proposing variants of the **non-safety** parts (extraction prompts, number of samples per tier). It must not run in production because Plumbline's graph is static and hashable (spec section 5) and a searched topology breaks replay and audit. Every searched variant is accepted only on a held-out split of our gold set, with cost reported, per Kapoor et al.

## 8. Role-by-role decision

Decision rule applied to each role: keep it as an LLM agent only if it (a) changes the tool scope, input view, model tier or trust boundary, **and** (b) a check exists that an equal-token single call cannot supply. Otherwise it is code or merged. "Gate" means the ablation arm in section 9 that must pass before the claim is made.

- **Planner.** Required checks for a release decision (identity, sanctions, ownership, bank account, litigation, internal history) are fixed by policy and case type, so a deterministic plan template should generate them. An LLM planner may *propose additional* checks (for example a second registry for a foreign vendor) as `Proposal<Check>`, validated against the closed action registry, with a Magentic-style typed ledger and a stall rule. Evidence: Anthropic and Magentic-One both rely on an orchestrator, but both operate on open-ended tasks; ours is not open-ended. Gate: static plan versus planner-augmented plan, measured on recall of planted-conflict sources reached and on cost.
- **Source agents.** Split into four, two of them not agents. (1) Channel fetchers: code with a canary probe (spec section 6). (2) Document extractor: small-model function, schema-bound output, locator fields, L0 re-check of every span. (3) Web-discovery agent: LLM allowed to formulate queries, quarantined, outputs candidate URLs and snippets as untrusted evidence only, never facts. (4) Silo client: typed MCP client (section 10). Parallel fan-out across them is the decomposable regime of Kim et al. Gate: monolith with the same tools and the same documents in one context, measured on extraction accuracy, injection attack success and tokens.
- **Reconciler.** Deterministic function per spec section 8. LLM use confined to the matching step of the entity-resolution cascade (model-proposed merges validated against the exact candidate list) and to semantic normalisation of free-text fields. No "reconciler agent" persona. Gate: false-merge rate and conflict precision/recall with and without the LLM matcher.
- **Round-table of source advocates (reconcile).** Demote from default to an experimental arm. Disagreement between systems is not resolved by model discussion (section 3.5). Default for `unresolved` conflicts: stay `unresolved` and escalate. Gate: round-table versus plain deterministic rule versus independent-vote matcher on the planted-conflict set; keep only if it beats both at matched tokens.
- **Claim decomposer.** A typed function using a small model, with the existing drift and coverage guards in code. Not an agent: no tools, no loop, no autonomy. Gate: decomposition drift rate and coverage against gold atomic claims.
- **Evidence weaver.** Merge into L0 (quote location, hashes, numeric and date checks, all code) plus the L2 entailment judge. The "weaver" name survives as a code module, not a role with a prompt. Its deterministic parts are where most claims are settled. Gate: share of claims settled by L0 alone, reported.
- **Advocate and skeptic.** Keep, narrowly: symmetric tool-using searchers over the stored corpus, one looking for support, one for contradiction, outputs admitted only as quotes L0 verifies; run only on claims routed by the sensitivity router. This is not persuasion-style debate. Gate (the central one): advocate+skeptic versus (i) one model with both instructions and equal tokens, (ii) k-sample voting at equal tokens, (iii) homogeneous versus heterogeneous families, (iv) no adversarial pair (L2 only). Metrics: contradiction-detection recall, false-contradiction rate, unsupported-claim rate, cost. If (i) or (ii) is equal within the pre-registered margin, we merge and report that.
- **Arbiter.** Two layers. Layer 1 is a deterministic rule over verified evidence (admitted quotes, authority tier, dates) that settles most cases. Layer 2, only for the residue, is a PoLL-style panel of different-family models returning one of `entailed | partial | neutral | contradicted | contested`, with the "contested" outcome never forced to a vote. Gate: panel versus single large judge versus deterministic-only, on agreement with gold and on bias (self-preference tested by having the producer family judge itself).
- **Policy judge.** If the rule engine's allowed set has one member, no model call is made and the trace says `judge_skipped: single_allowed_action`. Otherwise an LLM chooses within the allowed set citing real rule and precedent ids (validator rejects, never repairs). Gate: fraction of cases needing the judge, decision accuracy with rules only, with precedent, with judge.
- **Critic.** Two parts. Hard critic: code validators (citation ids exist, allowed-set membership, rule ids real, schema, numeric consistency). Soft critic: an LLM rubric scorer from a different family, advisory, never the sole trigger of reflexion (spec section 10 already restricts triggers). Gate: reflexion with LLM critic versus validators only; per Huang et al. we expect no gain from the soft critic alone and report it either way.
- **Reporter.** Deterministic renderer from the typed ledger (every sentence has a claim id). Optional LLM paraphrase passes a verifier that every output sentence maps to claim ids and introduces no new entity, number or date. The sponsor and demo runs report which mode was used. Gate: unsupported-sentence rate of the paraphrase mode; if non-zero beyond the margin, disable it.

Net count: LLM-bearing roles are the document extractor, web-discovery agent, matcher, decomposer, advocate, skeptic, arbiter panel, policy judge (conditional) and soft critic. The planner, reconciler, weaver, hard critic, reporter and the rule engine are code. This is a *smaller agent surface than the master spec lists*, by design, and the README says so.

## 9. The Role-Necessity Ablation (measurable answer to the judge question)

**Hypotheses, written before any run (pre-registration file committed first):**
- H1: replacing the planner, reconciler, weaver, reporter and hard critic with code loses nothing on any primary metric (equivalence test).
- H2: advocate+skeptic beats a token-matched single call and a token-matched k-vote on contradiction recall, at false-contradiction rate no higher than the controls.
- H3: the quarantine split reduces injection attack success against a monolith with identical tools, by a margin that does not depend on model quality.
- H4: the tiered cascade holds accuracy within the margin at no more than half the billed tokens of an all-large-model arm.
- H5: heterogeneous families in the checker beat homogeneous on bias (self-preference) and match or beat on accuracy. Self-MoA predicts this may fail; we report whichever is found.

**Arms** (all on the same gold set, same documents, same tools, same wall-clock cap; architecture labels follow Kim et al.):
- A0 rules only (already required by spec section 12).
- A1 single strong model with the same tools and all documents in one context (the judge's baseline).
- A2 single model, equal billed tokens spent as k independent samples with vote.
- A3 single model, equal billed tokens spent on one long reasoning pass.
- A4 centralised orchestrator with homogeneous workers.
- A5 Plumbline as designed (heterogeneous, typed, gated).
- A6 Plumbline with one role removed or replaced, once per role (leave-one-role-out) and with the persona-only variant.
- A7 Plumbline with the round-table on versus off.

**Fairness controls:** equal prompt effort per arm (same few-shot examples; Wang et al. 2024); tokens counted from billed usage in the trace, not requested budgets (Tran and Kiela's budget-control artefacts); the same model weights in A1 and A5's strongest tier; three runs per item and the worst reported for LLM-judged metrics (user standard); sample size and cluster bootstrap by case, per spec section 12.

**Metrics:** conflict precision and recall by type; entity false-merge rate; citation recall and precision; unsupported-claim rate; contradiction-detection recall and false-contradiction rate; decision accuracy; evidence-corruption attacks detected (span swap, number flip, deleted source, injected contradicting source); injection attack success on the red-team range; billed tokens, dollars and latency; plus a Pareto plot of accuracy against cost (Kapoor et al.).

**Decision rule:** a role is justified if (i) it improves a primary metric with a confidence interval excluding zero at a pre-registered cost multiple, or (ii) it removes an attack path the monolith has (H3), or (iii) it is the only arm that reaches the required fail-closed behaviour. Replacement by code is accepted when a TOST equivalence test passes on all primary metrics. Roles that fail are merged and the README names them. Results are published whichever way they fall.

**What this does not prove:** results hold for our synthetic silos and the chosen models; a different model generation can change them (so the harness stays in the repo); LLM-judged entailment labels carry judge noise, reported as a floor beside each number (spec section 9).

## 10. Protocols: Plumbline as MCP client, MCP server and A2A server

### 10.1 Model Context Protocol

- What: JSON-RPC 2.0 protocol between hosts, clients and servers for tools, resources, prompts and client-side elicitation.
- Meta: specification https://modelcontextprotocol.io/specification/latest (the fetched page identifies the current revision as 2026-07-28); repo `modelcontextprotocol/modelcontextprotocol` 9,446 stars, licence field NOASSERTION, pushed 2026-10-12; `modelcontextprotocol/typescript-sdk` 13,566 stars, GitHub licence "Other" (a LICENSE file exists; read it before depending), pushed 2026-10-13; `modelcontextprotocol/python-sdk` 24,561 stars, MIT, pushed 2026-10-13; `modelcontextprotocol/inspector` 11,063 stars, NOASSERTION, pushed 2026-10-13.
- Fact (revision 2026-07-28 pages): stateless, self-contained requests with per-request capability negotiation and no protocol sessions; servers needing state mint explicit handles and the spec says possession of a handle is not authentication; tools may declare `outputSchema` (servers MUST conform, clients SHOULD validate); tool annotations must be treated as untrusted unless from a trusted server; there SHOULD be a human able to deny tool calls; servers MUST validate inputs and sanitise outputs, clients SHOULD validate results before giving them to the model, log usage and set timeouts; `tools/list` may change over time and carries a cache TTL; a multi-round-trip `input_required` result replaces server-initiated requests; Roots is deprecated; optional extensions include Tasks (asynchronous long-running operations). Whether sampling still exists in this revision was not established from the pages read: **UNVERIFIED**.
- Fact (security best practices page): confused deputy via static client ID plus dynamic registration, token passthrough forbidden, SSRF on OAuth discovery (block private ranges, validate every redirect hop, consider egress proxy), state-handle hijacking, local server compromise, authorisation URL scheme validation, mix-up attacks, scope minimisation.

**Plumbline as MCP client for Zetaris (the `SiloPort` adapter).** Zetaris' own page says its MCP server is read-only, runs queries under the authenticated user's identity, applies row and column security and writes an audit log; tool names, URL and token format are **NOT VERIFIED** (`zetaris-integration-notes.md`). Design, all of it testable without the account except the last item:
1. Pin the tool surface: on first connect store a hash of each tool's name, description and schemas; on every connect compare, and fail closed with a typed `tool_surface_changed` error if it differs or if `listChanged` fires mid-run. This is the defence against tool poisoning and rug pulls.
2. Allowlist by tool name inside the Scout closed action registry; a tool not in the registry is not callable even if the server lists it. Names from different servers are prefixed to avoid collisions, as the spec advises.
3. Treat tool descriptions, annotations and results as untrusted text. Results enter the evidence store as `Evidence` with channel id, request hash, body hash and `servedFrom`, never into a prompt as instructions; where a result must be shown to a model it goes inside delimiters (spec principle 7).
4. Validate `structuredContent` against `outputSchema` when present and, regardless, parse into our own `Schema<T>`; a mismatch is `unavailable` or `partial`, never repaired.
5. Read-only by construction on our side too: only tools tagged read in our registry are exposed to any agent; the client never forwards our users' tokens (no passthrough), uses audience-bound credentials, and requests minimal scopes.
6. Cassette the JSON-RPC exchange (request hash to response) so `SAMPLE_MODE` replays a real recorded Zetaris run; a replay miss is an error. Include the tool-surface hash in the cassette key.
7. `input_required`, elicitation, and any tool-initiated request to the model are not auto-answered: they become a human approval step that fails closed on expiry.
8. SSRF rules from the best-practices page apply to any OAuth discovery the client performs; reuse the transport policy already specified for source channels.
9. Whether Zetaris speaks revision 2026-07-28 or an earlier revision, and whether the SDK negotiates both, is **UNVERIFIED**; the adapter isolates the SDK behind `SiloPort` so either works.

Supporting evidence: **MCPTox** (arXiv 2508.14925; Wang et al.; 2025-08-19, rev. 2026-09-29; https://arxiv.org/abs/2508.14925): 45 live MCP servers, 353 tools, 1,348 malicious test cases, 20 agents; o1-mini reached 72.8% attack success and more capable models were often more susceptible because they follow instructions better. The paper is why items 1 to 3 are not optional.

**Plumbline as MCP server (so others can call it).** A thin adapter over the same core function that the CLI and HTTP API call; no second implementation.
- Tools (coarse, typed, each with `inputSchema` and `outputSchema` exported from our own `Schema<T>`; the export step is needed because the validator is ours): `reconcile_vendor` (returns the truth table with fact ids), `explain_claim` (returns ledger entry and verified spans), `verify_bundle` (re-runs the offline verifier on a dossier hash), `submit_case` (creates a case and a **human review item**; it never executes a release), `get_decision` (status, reason codes, autonomy level, approval state).
- No tool can approve, promote autonomy, edit a rule, or write memory. Those exist only in the authenticated approval queue UI. This is the structural answer to "an upstream agent talked our MCP server into approving".
- Long-running work returns an opaque handle bound server-side to the authenticated principal (the spec's stateful-tool guidance), polled by `get_decision`; the MCP Tasks extension is an option once its SDK support is confirmed (**UNVERIFIED**).
- Auth: OAuth resource-server behaviour, tokens audience-bound to Plumbline, scopes split (`case:read`, `case:submit`, never an approve scope), per-client rate limits, output sanitisation, since vendor-derived text appears in outputs; mark such fields `untrusted: true` in the schema so a consuming agent can quarantine them (a convention of ours, not part of MCP).
- Test: run `modelcontextprotocol/inspector` and the SDK client against it; add protocol-conformance cases (unknown tool, malformed args, expired handle, wrong audience token, replayed handle from another principal).

### 10.2 Agent2Agent (A2A)

- What: open protocol for opaque agents to discover and delegate to each other; Agent Cards, Tasks with a lifecycle, Messages made of Parts, Artifacts.
- Meta: https://a2a-protocol.org/latest/specification/ (latest shown: 1.0.0); repo `a2aproject/A2A` 26,134 stars, Apache-2.0, pushed 2026-10-13; SDKs `a2aproject/a2a-js` 639 stars, Apache-2.0, pushed 2026-10-09 and `a2aproject/a2a-python` 2,198 stars, Apache-2.0, pushed 2026-10-12.
- Fact: three bindings (JSON-RPC 2.0, gRPC, HTTP+JSON); task states submitted, working, completed, failed, canceled, input-required, rejected, auth-required; streaming and webhook push; auth schemes API key, HTTP, OAuth 2.0, OpenID Connect, mutual TLS; extended Agent Cards behind authentication. Relationship to MCP (https://a2a-protocol.org/latest/topics/a2a-and-mcp/): MCP connects an agent to its tools, A2A connects agents to each other.
- Security reading: Habler et al., arXiv 2504.16902 (2025-04-23) https://arxiv.org/abs/2504.16902 applies the MAESTRO threat framework to A2A and flags Agent Card management, task integrity and authentication; Agent Card spoofing as a named threat is **UNVERIFIED from the abstract page** (seen only in search snippets).
- Plumbline use as **server**: one Agent Card with three skills (reconcile a vendor, explain a claim, verify a dossier); state mapping `working` while stages run, `input-required` while an approval is pending, `rejected` when policy rejects the release, `failed` with a typed reason, `completed` with Artifacts (decision record as a data Part, dossier bundle as a file Part). Authenticated extended card for tenant-specific detail. The same core, a different adapter.
- As **client**: only to treat an external agent (for example a sanctions-screening agent) as a source channel. Its replies are untrusted evidence with `synthetic` or `third_party` labels; the card is pinned by hash and allowlisted; no delegation of the decision.
- Not used for internal roles: A2A hides state ("opaque"), which is the opposite of what the trace, replay and typed-state principles need, and it adds latency and a failure surface per hop. Internal calls stay in-process typed messages.
- Limits: the protocol standardises transport and lifecycle, not semantics or safety of what the remote agent does.

### 10.3 ACP, AGNTCY and the protocol landscape

- ACP (IBM/BeeAI): `i-am-bee/acp` 1,019 stars, Apache-2.0, **archived**, last push 2025-08-25; its README states ACP is now part of A2A under the Linux Foundation. `agntcy/acp-spec` ("Agent Connect Protocol") 169 stars, **archived**, last push 2025-05-23. Do not build on either.
- AGNTCY: Linux Foundation project announced 2025-07-29 (https://www.linuxfoundation.org/press/linux-foundation-welcomes-the-agntcy-project-to-standardize-open-multi-agent-system-infrastructure-and-break-down-ai-agent-silos); components are discovery via the Open Agent Schema Framework, cryptographically verifiable identity, SLIM messaging, observability. Repos: `agntcy/dir` 196 stars, `agntcy/oasf` 339, `agntcy/slim` 228, `agntcy/identity` 107, all Apache-2.0, pushed 2026-10-07 to 2026-10-13. Use: at most publish an OASF record for discoverability later; the identity work is relevant to signed contracts but we already specify our own (Scout). Not on the critical path.
- Survey: Ehtesham et al., arXiv 2505.02279 (2025-05-04, rev. 2025-05-23) https://arxiv.org/abs/2505.02279 compares MCP, ACP, A2A and ANP on interaction modes, discovery, communication and security and suggests adopting MCP first, then others. The survey is descriptive, written before ACP merged into A2A.

### 10.4 Injection-resistant agent design (applies to both protocols)

- **CaMeL**, Debenedetti et al., arXiv 2503.18813 (2025-03-24, rev. 2025-06-24) https://arxiv.org/abs/2503.18813; repo `google-research/camel-prompt-injection` 405 stars, Apache-2.0, pushed 2025-06-20. Fact: extracts control and data flow from the trusted query, keeps untrusted data out of program control, capability-based enforcement of tool access; 77% task success on AgentDojo with provable security against 84% undefended, a stated security-utility tradeoff.
- **Design Patterns for Securing LLM Agents against Prompt Injections**, Beurer-Kellner et al., arXiv 2506.08837 (2025-06-10, rev. 2025-06-27) https://arxiv.org/abs/2506.08837. Fact: a set of principled patterns with utility-security tradeoffs and case studies; the individual pattern names were not read from the page, so none are named here.
- Plumbline use: the privileged part (planner, rule engine, policy judge) never sees raw untrusted text, only typed extractor output with ids; the quarantined part (document extractor, web discovery) has no tool authority beyond reading its assigned input and returns schema-bound data. This is a specific structure, and the monolith arm in section 9 is the control that shows its value. The measured utility cost (CaMeL's 77 versus 84) is the number to expect to defend, and we measure ours.

## 11. Typed messages and structured outputs

- Spec principle: models propose, code disposes; agents exchange typed state, not prose. Schema is our own `Schema<T>`, validators reject and never repair.
- Tam et al., "Let Me Speak Freely?", arXiv 2408.02442 (2024-08-05, final 2024-10-14) https://arxiv.org/abs/2408.02442. Fact: format restrictions such as JSON reduce reasoning performance, more so when stricter. Inference: do not force a model to reason inside a schema. Hypothesis to test: a two-pass step (free reasoning field or free scratch pass first, then schema-bound extraction) preserves accuracy versus single-pass constrained output. Counter-studies exist in the community; none were fetched here: **UNVERIFIED** whether the degradation persists on current models.
- Geng et al., JSONSchemaBench, arXiv 2501.10868 (2025-01-18, rev. 2025-02-27) https://arxiv.org/abs/2501.10868. Fact: six constrained-decoding frameworks (Guidance, Outlines, Llamacpp, XGrammar, OpenAI, Gemini) compared on 10,000 real-world JSON schemas for efficiency, coverage and quality. Use: keep schemas small and flat so the endpoint's constrained decoding covers them; always re-validate. Whether the NVIDIA hosted endpoint supports schema-constrained decoding is **UNVERIFIED**; the design must not depend on it.
- MetaGPT and MAST (sections 2.1, 5.4): structured intermediate artefacts plus verification between roles is the common thread of what worked.
- Contract rules for Plumbline: (1) every inter-role message has `producer_role`, `model_id`, `prompt_version`, `input_state_hash`, `output_schema_id` and evidence ids for every assertion; (2) no field carries instructions; free text fields are typed `untrusted_text` and cannot be read by privileged roles; (3) a `stop_reason` enum on every step (completed, budget, validator_failed, escalated, contested); (4) every assertion that is checkable has a verifier id; (5) failures are typed (`schema_invalid`, `quote_absent`, `rule_id_unknown`, `allowed_set_violation`) so attribution is mechanical.

## 12. Items worth knowing but not adopted as designs

- `microsoft/agent-framework` (14,112 stars, MIT) is AutoGen's stated successor; D-007 keeps our own runtime. The bake-off in spec section 5 may use it as an extra comparison arm if wanted.
- `vllm-project/semantic-router` (6,137 stars, Apache-2.0, pushed 2026-10-13; description "An open, programmable decision layer for models and compute"): relevant to routing, but its internals were not read: **UNVERIFIED**.
- `langchain-ai/langgraph` (43,197 stars, MIT) and `crewAIInc/crewAI` (59,645 stars, MIT) were torn down earlier (`prior-art/06`); no new claim here.

## 13. Results of this research

### 13.1 Ranked top 10 ideas

1. **Role-Necessity Ablation with billed-token-matched single-model baselines and equivalence testing** (sections 3.2, 9). It is the direct, falsifiable answer to the judge question and uses the strongest 2026 critique as the control.
2. **Independence-first verification stack**: L0 code, then rules, then a different-family panel for the residue; LLM critics advisory only (LLM-Modulo, Huang, Panickssery, PoLL, MAV, Large Language Monkeys).
3. **Quarantined/privileged split with typed-only inter-role messages** (CaMeL, design patterns, Triedman et al., MCPTox). A security property a monolith cannot have, measured on the red-team range.
4. **Decision-sensitivity-weighted compute allocation** (contribution 1 below; Snell et al.).
5. **Deterministic-first reconciliation with an LLM matcher only inside the cascade; round-table demoted to an ablation arm** (Choi et al., Zhang et al., Smit et al.).
6. **Cascade by validators and sample agreement, not by self-reported confidence** (FrugalGPT, AutoMix, SLM position paper), with model ids and tiers traced.
7. **Hardened MCP client for Zetaris**: tool-surface pinning, closed allowlist, untrusted-by-default results, cassettes, fail-closed on `input_required` (MCP spec, MCPTox).
8. **One core, two thin protocol adapters**: MCP server with no approving tools, A2A server with an explicit task-state mapping; internal roles stay in-process (MCP and A2A specs).
9. **Typed ledgers and mechanical stall/termination rules from Magentic-One, with MAST failure modes as a design checklist and trace-annotation lens**, plus Magentic-UI action guards as the approval-gate precedent.
10. **Contract-localised failure attribution** with a fault-injection test against LLM attribution (Who&When 14.2% step-level).

### 13.2 Ideas we should NOT adopt

- **Free-form multi-round LLM debate as the default arbiter.** Debate adds no expected correctness beyond voting (Choi et al.) and often fails to beat CoT and self-consistency (Zhang et al., Smit et al.). Allowed only as an ablation arm and, if kept, in the correction-biased form.
- **Persona text as the justification for a role.** Personas did not help across 162 personas (Zheng et al.). Roles are defined by tools, views, schemas and model tiers.
- **Mixture-of-Agents style layered aggregation.** Aggregator layers can introduce unsupported content and mixing models can lower average quality (Self-MoA); our output must be traceable to spans.
- **LLM scoring of agent trajectories as a gate.** Inconsistent and high variance (MAS-ProVe). Verify artefacts instead.
- **LLM failure attribution for debugging or blame** (Who&When: 53.5% agent-level, 14.2% step-level).
- **A2A, ACP or AGNTCY between internal roles.** Opaque by design, slower, and unneeded; ACP and the older AGNTCY ACP spec are archived.
- **Learned routers trained on chat preference data** (RouteLLM, last updated 2024-08) as the production router. Their transfer to extraction and entailment is unshown. A router trained on our own traces is a later experiment.
- **Searched or sampled topologies in production** (AFlow, ADAS, MaAS and successors): they break the static hashable graph, replay and audit. Offline use only, with a holdout.
- **Runtime-discovered MCP tools or servers.** Tool descriptions are an attack surface (MCPTox); the surface is pinned.
- **Model self-reported confidence as an escalation or routing signal.** Weak self-verification evidence (Huang, Panickssery). Use validators and agreement.
- **Blanket single-thread dogma (Cognition) or blanket multi-agent enthusiasm (Anthropic's 90.2%).** Both are unmeasured outside their domain; our stage-by-stage split follows Kim et al.
- **Counting an agent toward the "agentic" score that does no work.** The hackathon rules require interaction quality over agent count; padding roles that fail the ablation is a defect, not a feature.

### 13.3 Three novel research contributions

1. **Decision-sensitivity-weighted verification budget.** Because the policy engine is deterministic code, for every claim in the ledger we can recompute the verdict with the claim set true, false and contested, and classify it as verdict-inert or verdict-relevant exactly (not estimated). Spend the expensive tiers (advocate, skeptic, panel) only on verdict-relevant claims; verdict-inert claims get L0 and the cheap tier. Test: same decision accuracy and same corruption-attack detection as a uniform-effort arm at a stated fraction of billed tokens, with a curve across budgets. We found no work in this reading that allocates verification compute from exact verdict sensitivity under a deterministic policy (not exhaustive: **NOT VERIFIED** as a novelty claim). It combines Snell et al. (difficulty-adaptive compute) with the spec's L4 counterfactual machinery.
2. **Contract-localised failure attribution benchmark.** Inject known faults (a wrong extraction, a fabricated quote, an out-of-set action, a poisoned precedent, a swapped number) into specific roles and steps of Plumbline traces and measure attribution accuracy of (a) typed-contract validators and (b) an LLM attributor in the style of Who&When, against ground truth. Also report the MAST failure-mode profile of Plumbline traces versus a framework-built control. Publish the fault catalogue and harness. The hypothesis is mechanical attribution near-perfect for contract violations and the LLM far lower, quantifying what typed contracts buy; both numbers are open until run.
3. **A role-level necessity protocol for multi-agent decision systems.** Prior work compares architectures (Kim et al.) or debate versus baselines (Zhang et al., Choi et al.). The proposal is a reusable leave-one-role-out protocol with billed-token matching, deterministic-replacement arms, equivalence testing, a security arm and a published negative-results table, run on a seeded gold set that separates "evidence silent" from "evidence contradicts" (spec section 16, item 5). A grant reviewer can reuse it on any pipeline. Novelty is a protocol claim, not a result, and is **NOT VERIFIED** beyond this literature sample.

### 13.4 What could not be verified

- Zetaris MCP tool names, URL, auth, protocol revision, and whether it supports the Tasks extension (no source available; only vendor marketing text recorded in `zetaris-integration-notes.md`).
- Which Nemotron variants, families and structured-output modes the NVIDIA hosted endpoint exposes (notes file empty); consequences for family diversity are therefore conditional.
- Whether the MAST LLM annotator runs on custom traces; whether MCP revision 2026-07-28 still includes sampling; ADK's state-sharing details; the individual names of the patterns in Beurer-Kellner et al.; whether Khan et al. used mechanically verified quotes; whether the Tam et al. degradation persists on current models.
- Papers read at abstract or summary level only: all of them. No result in this file was reproduced. Anthropic's 90.2% and token-variance figures, Microsoft's benchmark results and NVIDIA's SLM argument are self-reported.
- Seen only in search snippets and therefore not used as evidence: ProgRouter, xRouter, the LLMRouter infrastructure paper, "Fantastic Adaptive Taxonomies and How to Use Them", the Agent Card spoofing threat, an IBM/Berkeley MAST study on ITBench, and any A2A conformance test kit.
- OWASP Top 10 for Agentic Applications 2026 was not read here; the spec's mapping stays **NOT VERIFIED** until the threat-model module reads it.
- Any claim that Plumbline's design is better than the alternatives: all of section 9 is a plan, not a result.
