# Novelty search for the Track 3 claim (2026-10-24)

The claim in `docs/plan/05-desk-evidence-driven-build-plan.md` section 8d is that desk. is one closed system in which a change to how coding agents run is (1) a policy candidate, (2) proved by code to only narrow the policy in force, (3) tested on frozen tasks with randomised assignment, (4) promoted only on strong evidence, (5) enforced at a measured boundary and signed, (6) scored afterwards against the system's own prediction, and (7) fed back into memory only after a held-out improvement. This note records what a dated search found against that claim.

## How the search was done, and its limits

Web searches on 2026-10-24, in English, one standard-mode query per topic: runtime experimentation on model and prompt configurations; self-improving coding agents; coding-agent spend control; offline and counterfactual evaluation of agent changes; cost-aware agent routing; policy-set comparison. Results were read at the level of the search summaries and the pages they cite, not as full papers. It is not a systematic review. Arxiv identifiers of the form 26xx are as listed by the search results; none of those papers was opened in full here.

## What exists, part by part

| Part of the claim | Closest prior art found | What it does | What it does not do (as far as the sources say) |
|---|---|---|---|
| (3) Experiments on agent configurations | LaunchDarkly AI Configs and AgentControl ([guide](https://launchdarkly.com/docs/guides/cheatsheets/optimize-ai-cost), [experiments](https://launchdarkly.com/docs/fed-docs/guides/cheatsheets/continuous-experiments)) | Variations of model, prompt and temperature; traffic splits and statistical analysis; cost, latency and quality as metrics; guarded rollouts that watch metrics and roll back ([blog](https://launchdarkly.com/blog/catch-and-revert-ai-failures-in-production/)) | Documented for application traffic, not for the local logs of coding agents. No restrict-only proof, no signed dossier a third party can verify offline, no scoring of its own earlier predictions. Product not tried here: vendor documentation only |
| (3) and (6) Counterfactual evaluation from logs | ARC-DR, "Counterfactual Evaluation of Agents in Non-Resettable Environments" ([NeurIPS 2026 listing](https://neurips.cc/virtual/2026/168256)) | Scores candidate agent configurations from historical logs: re-runs the candidate up to the first irreversible action, then estimates the rest with doubly robust per-decision estimates; rank correlation 0.83 over 24 variants on one stateful benchmark, as the authors report | A research method, not a governing loop. Author claims only; no independent replication found. Read in full before Phase 5 builds an estimator |
| (4) and (7) Promotion gated on held-out evidence | Darwin Gödel Machine ([paper](https://arxiv.org/pdf/2505.22954)), DarwinX ([arXiv 2608.07545](https://arxiv.org/pdf/2608.07545)), HarnessEvolve ([NeurIPS 2026](https://neurips.cc/virtual/2026/169879)), Gated Semantic Quality-Diversity ([2607.13683](https://www.alphaxiv.org/abs/2607.13683.md)), TRIAGE ([2608.10178](https://www.emergentmind.com/papers/2608.10178)) | Self-modifying or self-evolving agents and harnesses, with benchmark validation, non-regression gates and sealed or held-out tests | They optimise task success of the agent. None found that governs spend or permission policy, produces an enforceable signed policy, or scores its own forecasts. Results are the authors' |
| (2) Proof that a change only narrows | Cedar policy analysis ([AWS](https://aws.amazon.com/blogs/opensource/introducing-cedar-analysis-open-source-tools-for-verifying-authorization-policies/), [paper](https://arxiv.org/pdf/2407.01688)) | Symbolic policy-set comparison by SMT: whether one set permits only what another permits, with a counterexample request when not; verified in Lean | General authorisation, not agent spend or tool policy, and not a step in an experiment loop. The argument order of its inclusion check was not confirmed here |
| (5) Enforcement of cost limits | Gateways and proxies (LiteLLM, Portkey and similar), AgentBudget, loopguard (earlier sweeps) | Enforce budgets and rate limits at a boundary | No candidate testing. Interactive coding agents have usage quotas and, per the blogs found, no per-run dollar cap |
| (5) to (6) Governance and audit | Microsoft agent governance toolkit, Langfuse, OpenTelemetry (earlier sweeps) | Govern and observe | No experiments |
| Cost against quality for coding agents | Vendor and trade blogs on model routing | Advice and anecdotes | No controlled production experiment on coding agents was found |

## What can and cannot be claimed

- **Cannot claim:** that any single part is new. Each has prior art above. Cannot claim that nothing combines them: the search was shallow, English-only and snippet-level.
- **Can claim, as a hypothesis the evidence so far does not contradict:** that no system found in this search closes the loop from local coding-agent telemetry, through a restrict-only candidate policy and an experiment on frozen tasks, to conservative promotion, signed enforcement, and a published score of its own earlier predictions. The honest wording in the README, deck and video is "we did not find one", with this note linked, never "first" or "only".
- **Where the nearest competitor is:** runtime experimentation products with guarded rollouts (LaunchDarkly) for the experiment-and-rollback half, and self-evolving harness research for the held-out-gate half. A judge who knows either will ask how desk. differs; the answer is the table above, and it should be in the video's comparison slide.

## Follow-ups

1. Read the ARC-DR paper in full and decide, under the inspiration rules in the project instructions, which of its estimators to rebuild for Phase 5 and what to credit. Check its code licence first.
2. Read the Cedar inclusion check's documentation and decide whether our policy language should expose the same decision as a cross-check on our own proof.
3. Try LaunchDarkly's free tier on one AI Config experiment, to describe its behaviour from use and not from its documentation.
4. Repeat this search before submission, with at least three queries per row, and date the update.
