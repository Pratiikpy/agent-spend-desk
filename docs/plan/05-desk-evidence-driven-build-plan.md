# desk.: the evidence-driven build plan

Written 2026-10-24. This is a plan, not a record: nothing in sections 3 to 5 is built. It joins four inputs: the current product (`docs/product-description.md`), the two gap sweeps (`docs/design/desk/06-prior-art-gap-list.md`), the sponsor findings of 2026-10-24 (Nightshift installed and routing, Zetaris and Meterless features unused), and an outside blueprint Prateek pasted the same day (kept verbatim in `docs/plan/external-blueprint-gpt-2026-10-24.md`). Where the blueprint and our evidence disagree, section 2 says which wins and why.

The plan follows the standing rules: the best product, with no limit on build effort; nothing claimed without a measurement behind it; every phase opens with a conviction check that can say stop; every adopted idea is rebuilt from a written behaviour spec with tests first, after its licence is read.

---

## 1. The aim, and the one question every phase serves

desk. should become the place where a team that pays for AI coding agents can ask: **which change to how our agents run would give us more verified engineering work for the money, and can you prove it without taking your own word for it?**

The chain is: observe what the agents did → understand it with evidence → decide a change → test the change on real coding tasks → enforce it → measure afterwards whether it helped → learn only from what was measured.

Today the product is strong on the first three links and thin on the rest. The honest gaps, in order of how much they would cost us:

1. **No real user.** Impact is 30 of 100 points and every figure comes from a constructed sample. NOT VERIFIED that anyone wants this.
2. **The canary tests generic puzzles, not the user's agent on the user's work.** It cannot say the product improved a coding agent.
3. **A policy replayed on past logs shows where it would have fired, not what it would have cost in lost work.** That needs experiments, not logs.
4. **Memory barely changes decisions.** Recall is lexical; learning moved 2 of 60 questions with an interval touching zero.
5. **Enforcement has holes.** A tool with no hook, or a removed hook, is not stopped.
6. **Dollars and limits are estimates.** How a plan's limit maps to tokens is NOT VERIFIED.
7. **Claims can drift from evidence.** There is no machine-checked link between a sentence in the README and the run that supports it.
8. **The sponsor roles are narrower than they look** (section 6).

## 2. Where the outside blueprint is right, and where it must be corrected

I read the blueprint critically. It was written without access to the repository, says so, and repeats several figures from our own documents.

**Adopted** (it matches our evidence and our own sweeps): the closed loop of observe, decide, test, enforce, measure; the evidence ladder (observed, estimated, experimentally supported); a real-task evaluation harness as the headline evidence; memory with real retrieval and ablations; a decision laboratory with "do nothing" as a candidate; enforcement through a trusted boundary with measured coverage; a sponsor ablation suite; real users; a claim registry; one demo built around a bad idea caught before it ships.

**Corrected or tightened:**

- **Counterfactuals only exist where we assign.** Doubly robust evaluation and safe-improvement methods need the probability that each action was chosen, and overlap between what was tried and what is proposed. Our historical logs have neither: nobody randomised which model an engineer picked. So these methods apply to **Lab runs, where we randomise assignment and log the propensity**, not to real-user logs. Real-user data keeps the labels *observed* and *estimated*. This is a design rule, not a caveat.
- **The Track 3 first prize.** The blueprint says $2,000 and calls $1,500 an error. The public Official Rules say $1,500 and the FAQ says $2,000; we recorded this as discrepancy C2 and decided the Rules win (`docs/intel/08`). It does not change the build. Confirm on HackOS when convenient.
- **SWE-bench.** The blueprint's claim is true: OpenAI's post of 23 February 2026 says SWE-bench Verified is contaminated and recommends SWE-bench Pro, after an audit in which 59.4% of the 138 hardest tasks had material test or description problems (search result, 2026-10-24). The same search reports a May 2026 audit saying Pro's own graders mis-graded about a third of trials; I did not read that audit (NOT VERIFIED). So neither is a safe headline. **The headline benchmark is our own frozen tasks with our own graders**, with an external public benchmark as a cross-check only.
- **"129 features" is not the standard.** Agreed, and the first phase reconciles the list against the code.
- **Sponsors by evidence, not by diagram.** Agreed; section 6.
- **Cost is real.** The blueprint ignores that running agents costs model calls. On the free NVIDIA API through Nightshift, calls are slow (0.4 to 56 s measured), sometimes fail, and Nightshift's response cache replayed some of our tool-call requests as empty replies (found and worked around today). Phase 3 therefore opens with a measurement of what an agent run costs here, before any design depends on it.

**Not adopted:** adding agents or screens for their own sake; any claim that needs an experiment we have not run; Scout Intent's signed contract replacing our own DSSE dossier (the sponsor readout already concluded our own is stronger for money-moving actions).

## 2b. Revision 2, after an outside review (2026-10-24)

A second outside review scored the plan 8.8 of 10, said go on Phases 0, 1 and the Phase 3 spike, and asked for five changes. I checked each and adopted all five; they are now part of the plan.

1. **Statistical power is designed, not hoped for.** Section 8b fixes, before any Lab experiment, the effect worth detecting, the power, the non-inferiority margin, the sample size (from a pilot, by simulation) and a development set kept apart from a final test set.
2. **Security and privacy come before real data.** Phase 2 now opens with item 0, a foundation that must be finished and tested before any real user's logs are read: redaction before storage, credential handling, least-privilege readers, data minimisation, retention and deletion, a threat model, and tenant isolation designed before a team server exists.
3. **The user workflow is built beside the engine.** Section 8c runs a UX workstream in every phase, so each capability arrives with the screen and the words a user needs, and is tried by a person who did not build it.
4. **The Track 3 contribution is stated.** Section 8d says exactly what is new, what is prior art, and how we will check that claim against it.
5. **Acceptance tests are measured rates, not certainties.** "A planted no-change is never detected" becomes a false-alarm rate with an upper confidence bound and a power at a stated effect size; calibration is a coverage with an interval. This is how the canary simulation already reports (0 of 100 no-change histories called regressed, upper 95% bound 3.6%).

The review also scored real-world impact validation lowest (6.5). That is the one thing the build cannot do alone; Phase 9 now begins with a trial kit (section 4, Phase 9) so a trial costs the user one afternoon.

## 3. Decisions only Prateek can make

Each has my recommendation first.

| # | Decision | Recommendation |
|---|---|---|
| D1 | Which agent does the Lab run? | An open coding agent driven by Nemotron through Nightshift (free, repeatable, uses the sponsors). Candidates: OpenCode (its documentation lists OpenAI-compatible custom providers: verified by search), mini-swe-agent (works through LiteLLM; its licence was not found: NOT VERIFIED), Aider, Codex CLI, OpenHands. A two-day spike picks one. Claude Code stays the *real-user* path (its logs are what desk. reads). |
| D2 | Real users | Recruit at least one engineering lead or developer who will install desk. on real logs and grant permission to measure outcomes. Only you can do this; the plan builds the install path and the measurement so the trial is one afternoon. |
| D3 | Paid model calls | None at first. If a stronger comparator is needed for a claim, ask first with the cost estimate. |
| D4 | Cursor | The rules require Cursor as the IDE and the log is empty. From the first build phase, do the work in Cursor sessions and log each one honestly in `docs/sponsors/cursor-usage-log.md`; nothing is claimed otherwise. |
| D5 | What is public | The plan, the gap list and the product description describe unbuilt work. Decide whether they ship in the public repository; until you say, they stay uncommitted. |

## 4. The phases (a dependency order, with no dates)

Every phase has the same shape: a **conviction check** (what must be true before building; if false, stop and say so), the **work**, **acceptance tests written first**, the **evidence it produces**, and what **only Prateek** can do. The status of each is *planned, not built* unless a line says otherwise.

### Phase 0. Close the open loop (in progress)

- **Done today:** Nightshift installed and routing the model, with receipts shown in answers and traces; the Desk v3 (median and session-count steps, one-model spend as one total, share planning on the fallback path, higher period named first, asked-for figure first, empty replies retried); a fourth question set and Addendum 6 committed before it is run; a Nightshift cache defect found and worked around (a private cache scope and a first-token limit sent with every gateway call).
- **Left:** finish recording the Desk arm of sets A and B on v3; record the learning run again; run set D (all three arms, four trials) against the pre-registered predictions; write `RESULTS-v3.md` with the predictions that failed beside the ones that held; get `desk prove` to 26 PASS (plus checks for set D and the Nightshift receipt); update the README's evidence lines; commit without trailers; push when you say so.
- **Acceptance:** `desk prove` all PASS on a fresh clone on Windows and Ubuntu; every figure in README, deck and video regenerated from a run or marked as history; the v2 and v2.1 rows kept in `docs/verification/benchmark/pre-v3/`.
- **Only Prateek:** log Cursor sessions; upload the video; HackOS submission; Node 22.19 and macOS runs; the Day 3 check-in answers (tick H-MEM, World Model, Markovian; do not tick Nightshift Runtime or AI Hotspot unless true by then).

### Phase 1. Know exactly what we have

- **Conviction check:** none needed; it is an audit.
- **Work:** (a) reconcile the 129 specified features against the code, one row each: built, partial, absent, with the command or test that shows it; (b) a **claim registry**: every quantitative or capability sentence in README, deck, video script and product description gets an id, the run or file that supports it, and its evidence level (observed, estimated, experimentally supported, history); (c) a **decision-record schema**: task context, evidence ids, memory versions, alternatives, rejection reasons, predicted trade-offs and uncertainty, tests, approver, enforcement action, observed result; (d) a `desk prove` check that fails when a registered claim has no supporting file or a changed hash; (e) a dated novelty search for the claim in section 8d, written up with what it found.
- **Acceptance (written first):** a planted unsupported sentence fails the check; a changed result file fails the check; the feature table has no row without evidence.
- **Produces:** `docs/design/desk/07-feature-status.md`, `claims.yaml`, the schema, the check.

### Phase 2. Trustworthy source data (the observability system)

- **Conviction check:** which source gives ground truth for a plan limit? Read Claude Code's statusline `rate_limits` documentation (read by the sweep, not exercised) and capture real samples on this machine before designing the mapping. If the data cannot be captured, the plan limit stays an estimate and the product says so.
- **Work, in order:**
  0. **Security and privacy foundation (finished and tested before any real user's logs are read).** A written threat model (what an attacker, a curious colleague and a compromised dependency can reach). Redaction of secrets and credential-shaped strings before anything is stored or exported, layered (entropy, patterns, provider prefixes, credentialed URLs, connection strings). Data minimisation: counts and hashes by default, content only on an explicit opt-in. Least privilege: every reader opens logs read-only and the ledger refuses writes from the read-only server. Credentials only from the environment or the operating system's store, never in a ledger, trace, dossier or error message, with a test that plants a secret and proves it appears nowhere. Retention and deletion that remove data from the ledger, caches, exports and traces. Nothing leaves the machine except what the user sees in the model-call log (aggregates and claim text, never raw prompts or code). The signing key stays outside any git tree and its use is logged. Log text is data, never instructions (planted injection in a log must not change a plan). Tenant isolation is designed here, as a written model and a test plan, so the team server of Phase 8 is built on it and not retrofitted.
  1. **Limit truth.** Parse limit-hit events with their reset times; capture statusline `rate_limits` with a freshness expiry and the epoch-in-percent guard; fit a per-owner limit-to-token mapping with an interval; the autopsy picks its window by an observed limit when one exists.
  2. **A `reported` cost class** beside `estimated` and `unpriced`, with a schema migration, a reconciliation view (reported against estimated against billed) and tests that no reported figure is ever overwritten by a modelled one.
  3. **Pricing:** fast, flex and long-context tiers; a second price source (Portkey's MIT price repository) with a disagreement report; model retirement dates; the two-cost-bases idea (allocation against usage) for flat-rate seats.
  4. **Repository truth:** worktree-aware discovery; GitHub PR and CI facts; guards against deleted tests and unbacked "tests pass" claims; line survival.
  5. **Retention:** scheduled ingest and a warehouse that survives Claude Code's 30-day cleanup (the canary needs 28 days and propose needs two months).
  6. **More agents,** each with fixture logs taken from the real tool and a reconciliation against that tool's own totals: Codex, Gemini CLI, OpenCode, Cline, Copilot; then an OTLP receiver for Claude Code's native telemetry.
  7. **Teams:** a person and machine dimension, export and import bundles first, then a sync server; Anthropic and Cursor admin-API connectors (code path and tests now; running them needs an admin key only Prateek holds).
  8. **Zetaris, deeper and only after each gate passes:** a masking-by-role test of the read-only claim, an audit-log cross-check of our trace, catalog tags as a drift detector, the semantic layer if its API can be exercised. Each is NOT VERIFIED until run on the local install.
- **Acceptance:** per agent, the ledger's totals match the tool's own report within a stated tolerance on a fixture; a planted duplicate, sidechain copy and truncated line are handled; the limit fit reports its interval and abstains when samples are too few.

### Phase 3. The Lab (the keystone; everything after it depends on it)

- **Conviction check (a spike, before any design):** pick the Lab agent (D1) and run it on 10 small tasks, five times each, on Nemotron through Nightshift. Record: baseline pass rate and its variance, wall time and model calls per run, failure causes (infrastructure, model, task), whether isolation works on this Windows machine and in WSL, and the cost in calls. **Proceed only if** a useful share of tasks (about a quarter or more) have a baseline pass rate between roughly 20% and 80% (otherwise an intervention cannot show an effect) and runs reproduce within a stated tolerance. If not, change the agent, the model mix or the tasks; if still not, say that real-agent evaluation is not feasible on this hardware and what that costs the claims.
- **Work:**
  1. **Task corpus:** real repository tasks with fail-to-pass and pass-to-pass tests, mined from merged PRs of repositories whose licences allow it, frozen at their base commit, with independent graders (tests and repository state, never a model's opinion of its own message). Private held-out tasks written or mutated so they cannot be memorised. Task validity audit (the lesson of the SWE-bench audits): every task's tests must pass on the gold patch, fail without it, and not enforce details the description never asks for.
  2. **Isolation and reproducibility:** one container or worktree per run, pinned versions, controlled seeds, a logged environment hash, infrastructure failures kept in the denominator and classed.
  3. **Randomised assignment with logged propensities,** repeated trials, and complete accounting from the agent's own logs and Nightshift's receipts.
  4. **Arms:** A baseline; B desk. observing only (does instrumentation change results); C static caps; D smart routing; E full desk.; F ablations removing one component at a time. "Do nothing" is a candidate everywhere.
  5. **The real-agent canary:** a daily run of a frozen subset through the same harness replaces the generic puzzles as the headline regression test; the 52-task pack stays as a diagnostic. Add the output-token and effort channel, stored replies with re-scoring, an invalid-format outcome, per-owner seeded variants, and a positive control.
  6. **Statistics:** keep the clustered paired design; add anytime-valid confidence sequences and an e-detector for onset; audit the aggregate for the group-standard-error pooling error the harness literature reports.
- **Acceptance (rates, not certainties):** the harness reproduces its own baseline on a second day within its declared tolerance; over at least 100 simulated no-change histories the false-alarm rate has a Clopper-Pearson upper 95% bound at or below the declared level; at the declared effect size the power is at least 80% on the pilot-based simulation; the graders reject a patch that deletes the tests; the gold patch passes every task.
- **Produces:** a pre-registered Lab protocol per experiment, committed before it runs, in the style of `PREREGISTRATION.md`.

### Phase 4. Memory that changes decisions

- **Conviction check:** can a memory-on run beat a memory-off run on held-out decision tasks at all? Build the evaluation first (decision tasks whose best answer depends on a stored fact: an earlier exception, a changed definition, a past outcome). If memory-off already matches memory-on, find out why before building more.
- **Work:** real embeddings (compare Nightshift's local embedder against NVIDIA's embedding model through the same API, by retrieval accuracy on our own set, not by assumption); a memory taxonomy (semantic, episodic, procedural, temporal, causal hypothesis, outcome) mapped onto H-MEM tags and World Model events; H-MEM mining, feedback, and sleep used in **preview** mode only (the earlier readout rejected sleep's source-deleting synthesis on purpose); World Model ingest, relationships, the merge queue with human approval, audit and timeline; Markovian for long investigations; tests for contradiction, supersession, staleness and deletion; whether the retrieved memory moved the final decision the right way.
- **Acceptance:** memory-on beats memory-off on held-out decision tasks with an interval that excludes zero, or the plan records that it does not and the claim stays out. Retrieval, supersession and deletion each have a failing-first test.

### Phase 5. The decision laboratory

- **Conviction check:** the Lab (Phase 3) must be producing stable results. Without it, nothing here is evidence.
- **Work:** a candidate generator (routing of easy tasks to a cheaper model, loop limits, per-task budgets, retry behaviour, selective escalation, context or retrieval changes, "do nothing"); the Attacker extended from policy bypass to task-level failure search; historical coverage analysis (when each candidate would have fired, labelled *observed*); Lab execution of candidates on frozen tasks with randomised assignment; **doubly robust policy evaluation and a conservative promotion rule in the spirit of safe policy improvement, applied to Lab logs where propensities are known**; conformalised intervals for cost and duration, tested for coverage; the evidence-ladder label on every output; a rule that a candidate whose evidence is weak keeps the established policy.
- **Acceptance (rates, not certainties):** estimator error against a held-out intervention is measured and published; interval coverage on simulated and Lab data is reported with its own interval and meets the declared target or the intervals are marked unreliable; across a set of planted harmful policies (each saves money by blocking valuable work) the rejection rate and its lower bound are reported; the system abstains whenever the overlap check fails.

### Phase 6. Enforcement we can measure

- **Conviction check:** which paths can spend money? Enumerate every door (hook, MCP, HTTP, proxy, direct API use) and measure what share of Lab-run spend each controls. The product reports *coverage* as a number and labels everything outside it.
- **Work:** a local gateway that agents are pointed at by environment variable, so the boundary does not rely on a hook (OpenAI-compatible and Anthropic-compatible routes); managed-settings distribution for Claude Code; a reversible installer that chains existing hooks; a watcher for tools with no hook (process suspend where the OS allows); per-session, per-task and delegated sub-agent budgets; cost-velocity and context-fill dimensions; a finalization reserve so a run can write its summary; staged rollout (shadow, canary, promote or roll back, with a control group); an emergency stop; equivalence and no-op lint for policy edits.
- **Acceptance:** a bypass suite (hook removed, direct API call, a second process, a replayed approval, a forged digest, a crashed checker, a clock jump) with every case blocked or reported as outside the boundary; fail-closed drills; coverage measured on Lab runs.

### Phase 7. The measured learning loop

- **Work:** collect outcomes after deployment (reverts, failing CI, incident links, retries, human repair effort proxies); score earlier predictions and track calibration (the regret ledger already does this for proposals); update strategies only from prospective results; roll back a learning update that makes held-out performance worse; extend the lessons loop beyond wording-based retrieval.
- **Acceptance:** a learning update that is harmful on held-out tasks is rejected automatically; a prospective prediction is scored after the fact and the score is published, good or bad.

### Phase 8. The product people use

- **Work:** three modes on one core: Personal, Teams (several agents, developers, projects, seats, PR outcomes, approvals), Control (budgets, routing, rollout, audit); roles and approvals; notifications, webhooks, CI exit codes and a PR check; a statusline gauge and a query MCP server for the coding agent itself; privacy by design (redaction before any cloud-model call, retention and deletion, least-privilege connectors, credential handling); every number clickable to its rows; a mobile summary of each table; an onboarding path to first value in under three minutes on the user's own logs.
- **Acceptance:** a first-run test on a clean machine; a role test (a non-owner cannot approve); a deletion test (deleted data is gone from the ledger, caches and exports).

### Phase 9. Independent validation

- **Trial kit (built early, so the trial costs one afternoon):** a one-page install and run guide for a stranger, a privacy note saying exactly what is read and what never leaves the machine, a consent text, a measurement protocol (what is recorded about the person's use, what they were asked, what decision they made), an export that contains only anonymised metrics the user can read before sending, and a short interview script.

- **Only Prateek, with help from the plan:** at least one real trial with a real engineering lead; practitioner interviews (`docs/design/04-practitioner-validation-plan.md` already has the protocol); willingness to pay tested; a second person reproduces the core results from a clean clone; a security review of the gate and the dossier; a licence audit of every adopted idea against `NOTICE` and the adoption register.

### Phase 10. Competition evidence

- **Work:** freeze a release; regenerate every figure from runs; record the flagship demo (below) from real measured runs; update the deck, video and README; verify as a judge from a clean clone; HackOS submission (Prateek).

## 5. The flagship demonstration

One difficult, real decision, not a tour. A team's agent spend is high. desk. proposes a cheaper policy. The critic finds, from a real task re-execution in the Lab, that the broad policy cuts off a hard debugging task before it finishes. desk. remembers the exception, revises to targeted limits and a routing change, and the revised policy passes independent checks with its measured trade-off shown: savings, completed tasks, quality, uncertainty, and what did not pass. The owner approves, the signed policy goes into the gate, and a controlled intervention is shown. One byte of the signed bundle is changed and the offline verifier refuses it. Every number in it must come from a recorded run; the demo cannot be written before the runs exist.

## 6. Sponsors by evidence

An ablation suite switches each sponsor component off in turn and shows exactly what degrades. If switching one off changes nothing, the integration is too shallow and is either deepened or described plainly.

- **Meterless:** Nightshift as the model route (done), then its local embedder for memory, overnight jobs for the Lab and the real-agent canary, and its cross-check on replies; the three engines used beyond their current slice (Phase 4); Scout Intent evaluated, not assumed.
- **Zetaris:** the three silos now; Phase 2 item 8 for the deeper features, each behind a gate.
- **NVIDIA:** the model mix by role measured (the 120B model against the lightning 30B model for planning, critique and explanation); embeddings and reranking through the same API if they win on our retrieval set. Arithmetic, policy enforcement and verification stay in code.
- **Cursor:** the work itself, logged.

## 7. Adoption program

The 49-repository sweep becomes a register with a status per item: *adopt* (rebuild from a behaviour spec, tests first, licence read), *defer*, or *reject with a reason*. Priority sources for this plan: promptfoo and Inspect (the Lab), the Microsoft governance toolkit, Cedar and coder/boundary (enforcement), LiteLLM, AgentBudget and loopguard (budgets), ccusage, CodexBar, Usage-Monitor, agentsview, Entire and DevLake (source truth), OpenCost (two cost bases), Langfuse and OpenTelemetry (export), Sigstore and in-toto (trust). The rules: MIT, Apache and BSD may be adapted with credit in `NOTICE`; copyleft and source-available sources give ideas only; each adopted mechanism gets a written behaviour spec, tests from that spec, a list of its known weaknesses and how ours fixes them, and a provenance line.

## 8. What stays true throughout

- Every claim carries an evidence level and a registry id (Phase 1).
- Every experiment is pre-registered before it runs; a prediction that fails is reported beside the ones that held; a fix made after reading a result ends that result's status as held-out.
- Tests are written to fail first; a change that touches the Planner's prompt or tool schema invalidates recorded replies and is re-recorded, with the old rows kept as history.
- Nothing is committed with author trailers; secrets never enter the repository; the secret scanner and size check run before every commit.
- Anything outside a measured boundary is labelled outside it.

## 8b. Statistical design (fixed before any Lab experiment)

- **Two task sets.** A development set (about half the frozen tasks) is where candidates are tuned. A final test set is touched once per candidate version, recorded in the pre-registration, and never used to choose between candidates. Private tasks written after the candidates exist guard against memorisation.
- **The quantities, chosen up front and written in the pre-registration:** the smallest cost saving worth acting on (default: 10% of spend per verified successful task), the non-inferiority margin for task success (default: 5 points absolute, to be revised only before the run), the significance level (0.05 two-sided, with multiplicity control across candidates by a stated rule), and the power (at least 80% at the smallest effect worth acting on).
- **Sample size comes from a pilot.** The Phase 3 spike estimates the baseline pass rate per task, the between-task variance and the within-task repeat variance; the number of tasks and repeats is then chosen by simulation (the canary simulator already does this for the daily design). If the achievable power at the smallest effect worth acting on is below 80%, the experiment is labelled exploratory and cannot support a claim.
- **Repeats and clustering.** The unit of analysis is the task; repeats of one task are not independent samples. Intervals use clustered errors; sequential monitoring uses anytime-valid methods.
- **Reporting.** Every result carries its interval, its power at the declared effect, its sample size, its infrastructure-failure count and its evidence level.

## 8c. UX workstream (in every phase)

Phase 0 to 8 each ends with the user-facing part of what it built: a screen or a command, its words, its empty and failure states, tried by a person who did not build it. The core workflow is defined first and kept stable: see what happened, understand why, see a proposed change and its evidence, approve or reject, watch it enforced, read what it did. Each phase adds to that workflow rather than adding a separate tool. A decision-record view (task context, evidence, alternatives, rejected options and why, predicted and observed outcome) is the centre of it. Usability is checked with observed use, not opinion: time to first value on a clean machine, whether a stranger can find and explain a decision, and the errors they hit.

## 8d. What is new in the Track 3 contribution

**The claim, stated so it can be checked against prior art.** desk. is one closed system in which (1) a proposed change to how agents run is a *policy candidate*, (2) a proof by code shows the edit only narrows the policy in force, (3) the candidate is tested on frozen real coding tasks with randomised assignment so its effect on cost and on success can be estimated, (4) promotion is conservative: weak evidence keeps the established policy, (5) the approved policy is enforced at a measured boundary and signed, (6) the outcome is measured afterwards, the system's earlier prediction is scored, and (7) memory and learning change future decisions only after a held-out improvement. Each part has prior art. What we claim is new is the closed loop with experiment-backed, conservative promotion and a published self-score.

**Prior art we compare against, and what each lacks for this claim (from our sweeps):** promptfoo and Inspect (evaluate, do not decide or enforce); LiteLLM, AgentBudget and loopguard (enforce budgets, do not test candidates); RouteLLM (a routing method, not a loop); the Microsoft governance toolkit and Cedar (govern and verify policies, no experiments); Langfuse and OpenTelemetry (observe). **NOT VERIFIED that nothing combines these.** The first dated search is written up in `docs/design/desk/08-novelty-search-2026-10-24.md`: it added LaunchDarkly AI Configs experiments with guarded rollouts, ARC-DR counterfactual evaluation, the self-evolving harness papers (Darwin Goedel Machine and later) and Cedar policy-set comparison to the prior art. The claim stays a hypothesis, worded as "we did not find one", and the search is repeated before submission.

## 9. Risks and what would make us stop

| Risk | Early sign | Response |
|---|---|---|
| The Lab's baseline is degenerate (agent solves almost nothing or everything) | Phase 3 spike | Change agent, model mix or tasks; if none works, report that real-agent evaluation is infeasible here and narrow the claims |
| The free API cannot carry agent runs (rate limits, long latency, empty replies) | Calls per run and failure rate in the spike | Local lanes through Nightshift; fewer, longer-lived runs; ask before any paid call |
| Memory does not help | Phase 4 acceptance | Keep the result, drop the claim |
| Counterfactual estimates are unreliable | Phase 5 coverage tests | Label as estimated; never promote on them |
| Enforcement coverage is low | Phase 6 measurement | Report the number; extend the boundary or label the gap |
| No real user | Phase 9 | The product claims stay "constructed sample" |
| Claims outrun evidence | Phase 1 check fails | The claim goes |
| Solo, no domain expert | Interviews | Treat Impact claims as hypotheses until tested |

## 10. Traceability: where each recommendation lands

| Recommendation (source) | Phase |
|---|---|
| Real limit truth; `reported` class; pricing tiers (sweep A) | 2 |
| Other agents, admin APIs, OTLP, per-person data (sweep A) | 2 |
| Landing truth, test-tampering guards (sweeps A, B) | 2 |
| Canary and replay on the owner's real work; effort channel; canary hygiene (sweep B, blueprint) | 3 |
| Memory with real retrieval and ablations (blueprint, sponsor findings) | 4 |
| Decision laboratory; do-nothing; causal estimates only where assigned (blueprint, corrected) | 5 |
| Installer, watcher, gateway, staged rollout, policy levers (sweeps A, B, blueprint) | 6 |
| Outcome measurement and learning (blueprint) | 7 |
| Push surfaces, teams, privacy, UX (sweeps, blueprint) | 8 |
| Timestamp anchor and Sigstore bundle; owner labels (sweep B) | 2 and 8 |
| Autopsy depth: context composition, cascade and stop point, new waste classes (sweeps A, B) | 2 |
| Claim registry; decision record (blueprint) | 1 |
| Sponsor ablations (blueprint, sponsor findings) | Section 6 and every phase |
| Real users, external reproduction, security review (blueprint) | 9 |

## 11. Status of the go (2026-10-24)

Prateek said go on the whole plan and asked to be told when build and polish are done. Work proceeds in this order, each step tested before the next: Phase 0 to completion; Phase 1; the security and privacy foundation (Phase 2 item 0) before any real data is read; the Phase 3 spike, whose numbers decide how much of Phases 3 to 7 can claim; then the rest of Phase 2 and Phases 3 to 8 in dependency order; the trial kit of Phase 9; Phase 10. A phase that fails its conviction check stops and is reported with the numbers, not worked around. The only steps that need Prateek are the ones marked "only Prateek": real users, Cursor sessions, the upload and the HackOS submission.
