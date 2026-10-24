# What each source has that desk. does not use

Written 2026-10-24. Two read-only sweeps (one per half of the source list) compared 49 repositories and four papers against the code in `src/desk`, then a third pass covered the sponsors. The question was only: what would make desk. a better, bigger or more trusted product for someone who pays for AI coding agents. Nothing here is built, and none of it was run or priced.

How far to trust it. The sweeps read READMEs, documentation, release notes, issues and selected source files through `gh api` and plain-text page reads; nothing was cloned for execution and no vendor API was called. Each "not taken" row was checked against `src/desk` by search before it was written. Items tagged NOT VERIFIED were inferred. Licence class: "reuse with credit" for MIT, Apache and BSD; "mechanism only" for GPL, AGPL, LGPL, Elastic, source-available, unclear and papers. Effort letters are estimates: S, M, L.

What the code does and does not have, as found by the sweeps (the baseline for every row): one reader, for Claude Code logs; `cost_event.class` is `estimated` or `unpriced` only (no `reported`); no outward-facing code (no GitHub or PR code, statusline, rate-limit capture, OTLP, watcher, notifications, scheduler); policy windows are day and month only; the autopsy picks its window by list-price cost, not by a limit being hit; the gate CLI has no installer and the MCP tools are gate-only; the canary sends a generic 52-task pack to the configured model, not through the owner's agent; there is no pre-run estimate command.

---

## 1. The sponsors

### Meterless (beyond routing the model through Nightshift)

- **Nightshift overnight jobs, receipts and judges.** A job kind (`best_of_n`, `batch`) races attempts, clusters and judges them and records which checks actually ran (VALIDATE, RUN, JUDGE, OUTCOME). The daily canary and the Drafter's candidate policies belong there. The `ns` command can submit and follow jobs with a privacy floor, a budget level and a judge mode.
- **Its local embedders** (a bge-small and a nomic-embed model are in its model list, and `meterless/embed` is an alias). Our H-MEM adapter still uses the engine's stub hash embedder, so recall is lexical.
- **The cross-check on every reply.** Each response carries destructive-action, PII and schema-validity checks.
- **Local Nemotron lanes** (`nemotron-3.5-lightning-30b-a3b` and a 3-nano appear as local models) for roles that do not need the 120B model, and for offline work. Whether this machine's 8 GB card and 25 GB of RAM can run them usefully is NOT VERIFIED.
- **H-MEM:** mining of seven event types, feedback, sleep and dreaming consolidation (the earlier readout rejected sleep's source-deleting synthesis on purpose), the trust ledger's query surface, conflict handling beyond supersession.
- **World Model:** the six-stage ingest pipeline, relationships and contexts, the merge queue with human approval and unmerge, the audit view, event subscription, snapshot and timeline views, traversal.
- **Markovian:** progress and history, the projection curve and run-efficiency figures.
- **Scout Intent** (not vendored; no conformance runner): intent classes, a capability grammar (`read/`, `write/`, `reason/`, `act/`), policy packs, a signed execution contract with replan. Our Risk Router is our own code.
- **Relay, Swarms, Gaia** (their apps): shadow mode by default, a Deterministic Execution Ratio, three-valued verification, provider failure classes with full-jitter retry, a memory browser with real deletion.

A finding from today: with the default scope, Nightshift answered a repeat of one of our planner requests from its response cache with an empty message and no tool call (`from_cache: true`, 4 ms). A per-request `meterless-scope` header avoids it; desk. now sends one. That is a defect worth reporting to Meterless.

### Zetaris (beyond REST SQL, three silos and one join)

- The **MCP server** and **natural-language-to-SQL** (marketing claims; the endpoint and tool names were not found in any public document: NOT VERIFIED).
- The **Unified Semantic Layer** (typed model with keys, checks and data-quality rules, materialised to Parquet, Delta or Iceberg) and the **AI Data Steward**. NOT VERIFIED beyond syntax.
- **Row and column policies** (grant, deny, hide, mask, encrypt), roles, grants and views: a real security test for the read-only claim (administrator-only, local install only).
- The **audit log** (a cross-check of our trace against what Zetaris says was queried; the retrieval path was not found), **lineage**, **catalog tags and metadata change history**, **Iceberg time travel**, caching and materialisation, the PDF datasource and PII classification (invoices as PDFs), more connectors (Snowflake, Databricks, BigQuery, Salesforce, Kafka and others), AgentFlow (enterprise tier).

---

## 2. Spend, meter and observability (24 sources)

**ccusage** (reuse with credit; MIT by file, GitHub reports NOASSERTION). Taken: message and request id de-duplication, sidechain handling, the 5m/1h cache split, the incremental file cursor.
- Readers for 18 other agents (codex, gemini, opencode, copilot, amp, droid, goose, grok, kimi, qwen and others): a lead who pays for several agents sees one today. `rust/adapters/*`; L, S–M per agent.
- Fast-mode, flex and long-context pricing: the costliest sessions are under-estimated and `ledger-vs-ccusage.md` admits tiers are not applied. `cost.rs:114-212`; S.
- A `statusline` command and `--cost-source both` (Claude Code's own cost beside the computed one): a live gauge and a free cross-check. `docs/guide/statusline.md`; S–M.

**CodexBar** (MIT). Taken: honest dollar classes.
- Organisation Admin-API spend connectors (Anthropic cost and usage reports, OpenAI costs): vendor-reported dollars for API-key teams, which the ledger cannot store today. `docs/claude.md:82-98`; M.
- Pace and run-out forecast with a stage label, weighted history and a run-out probability. Ask refuses forecasts today. `UsagePace.swift:43-124`; M.
- Vendor status-page polling, to put a vendor incident beside a canary regression. S.

**Claude-Code-Usage-Monitor** (MIT). Taken: the 5-hour window as the unit, 5m/1h split, non-Anthropic models left unpriced.
- Limit-hit events as ground truth (parse "limit reached", set a personal ceiling from the 90th percentile of limit-hit blocks). The headline question is "where did my limit go", and the autopsy picks its window by cost. `data/analyzer.py:254-366`; S–M.
- Capture of the official statusline `rate_limits` (600 s freshness, a guard for the epoch-in-percent bug) and a versioned `--once --output json` snapshot: vendor truth beside the local estimate. `output/official.py:1-60`; M.
- A warehouse that survives Claude Code's 30-day log cleanup. Propose and replay need two months and the canary needs 28 days, but nothing schedules ingest or warns. S.

**agentsview** (MIT). Taken: counts first with repricing, a de-duplication key, counted exclusions.
- One-shot CI capture (`capture run -- claude -p`): exact spend per CI job or PR. `docs/one-shot-capture.md`; M.
- Git and PR totals that count clones and worktrees once, GitHub opened and merged PRs, a "Not counted" list. `docs/usage.md`; M.
- Canonical hour and day exports with a content digest and schema version. S–M.
- Multi-machine sync with a machine dimension (the `session` table has no person or machine column). L.

**litellm** (MIT outside `enterprise/`). Taken: the price snapshot; the default `max_tokens` in the gate's estimate.
- More budget scopes: per-session dollar cap, per-model and per-tag budgets, time-boxed temporary increases. `schema.prisma:13-40`; S–M.
- A LiteLLM proxy as a team data source (one virtual key per developer) through a SpendLogs adapter: team spend including people who never install desk. M.

**Portkey gateway** (MIT). Portkey Models as a second price source with batch and additional-unit pricing, to flag disagreement with the LiteLLM snapshot. S–M. Nothing else: budgets are hosted-only.

**Helicone** (Apache-2.0). Taken: the unpriced reserve exception, a random escrow id.
- Alerts, scheduled reports and webhooks: desk never contacts the owner. M.
- HQL, a SQL console over the data, so a sceptical owner can check any number. S.

**tokencost.** Nothing further (dormant since 2025-09-05; its daily price update failed on every run since 2025-09-01, which confirms the price-freshness trap).

**agentbudget** (Apache-2.0). `finalization_reserve` and `would_exceed(est)` (a hard stop that leaves room to write a summary; grep of `src/` finds none); nested budgets and webhooks. S; M.

**figuard-core** (Apache text; GitHub reports NOASSERTION). Taken: reserve, settle, void with idempotency, `gate integrity`, shadow mode.
- Delegation tokens (capped, expiring sub-budgets carved from a pool): sub-agent fan-out is an autopsy cause the Desk can only advise on. M. NOT VERIFIED that the PreToolUse payload identifies the sub-agent.
- A documented exit ramp: a trust feature for a tool that blocks tool calls. S.

**loopguard** (MIT). Taken: loop detection and a pause-with-checkpoint action. A PreToolUse hook is stronger than its log tailing.
- A log-tail daemon with auto-discovery, desktop notifications, SIGSTOP pause and resume, an installed service: the README here admits a tool with no hook is not stopped. M–L.
- Cost-velocity ($/minute) and context-fill detectors as policy dimensions; numeric dimensions today are cumulative spend and recoverable dollars. S–M.

**tokencast** (MIT). Taken: an empirical 10–90 interval from the owner's own windows.
- A pre-run estimate with P10/P50/P90 by task type, a coverage scorecard and a mid-session warning at 80% of the pessimistic band. It would feed the gate's "ask" thresholds. M.

**Langfuse** (MIT outside `ee/`). Taken: leaf-call-only costing.
- Ingest on the Claude Code Stop hook (incremental, locked, fail-open): near-real-time ingest without polling. S.
- An experiments compare view and scheduled blob export with score provenance. S–M. NOT VERIFIED (page bodies were behind a cookie wall).

**Opik** (Apache-2.0). Taken: the model-name ladder.
- Model retirement dates in the catalogue (warn that the top-spend model retires; keep route proposals off retired models). S. Release note only.
- An MCP server that lets the coding agent query its own data (`desk_autopsy`, `desk_ask`, `desk_estimate`); our MCP tools are gate-only. S–M.

**Phoenix** (mechanism only; ELv2). Nothing further.

**OpenTelemetry GenAI conventions** (Apache-2.0). Taken: nothing in `src/` (zero OTel).
- An OTLP receiver for Claude Code's native telemetry (cost and token usage by skill, plugin and agent, API requests, tool decisions, compaction): vendor-computed cost and a team path through managed settings. M–L.
- Adopt `gen_ai.usage.cost.source = provider|local` and export the ledger as OTLP. S–M. NOT VERIFIED: all three upstream issues are open.

**Entire CLI** (MIT). Taken: agent-trailer attribution.
- Read `Entire-Checkpoint:` trailers and `refs/entire/checkpoints/*` for an exact session-to-commit link and team-shared evidence with no server. M.
- Sign with the owner's existing git GPG or SSH key. S–M.
- A one-command, reversible hook installer that chains existing hooks. The gate is hand-wired today. S.

**Apache DevLake** (Apache-2.0). Taken: the landing chain concept from local git.
- Vendor admin-API plugins: the Claude Code analytics API gives per user per day sessions, commits, PRs, lines and accept or reject counts; Cursor team usage events carry charged cents; Copilot seats and credits. M each.
- Deploy and incident facts (DORA change-failure rate) to judge agent-authored changes beyond the merge. L.

**codelens-ai** (MIT). Taken: trailer attribution; kept, reverted, unlinked as value leak.
- AI code share and line survival from git, with branch awareness. M.
- An hour-by-weekday cost and productivity heatmap. S.

**openllmetry** (Apache-2.0). Nothing beyond the OTLP receiver above.

**claude-devtools** (MIT). Taken: compaction-aware miss classification.
- Per-turn context composition by source (CLAUDE.md levels, skills, @-files, tool I/O, thinking): "your 18k-token CLAUDE.md was re-read N times, $X". Today `history_rereads` is one block with a generic fix. M.
- Worktree-aware project discovery (`findRepoRoot` returns the worktree path). S–M. NOT VERIFIED for deleted worktrees.
- SSH remote sessions. M.

**OpenCost** (Apache-2.0). Taken: nothing in `src/`.
- Two cost bases on every number: `allocation` (reconciles to the bill, with idle and shared shares) and `usage` (consumption only). On flat-rate seats the real cost is the seat fee, so spreading seat fee and idle spend over landed work gives cost per landed PR on the actual bill. M.

**claude-code-cache-fix** (MIT per LICENSE; GitHub NOASSERTION). Taken: cache-miss cause by log inference.
- Fit the owner's own quota model (cache_read at 0×, 0.1×, 1×; peak against off-peak; effective 5-hour quota with a coefficient of variation). Needs statusline samples. M.
- A tier advisor (upgrade on one projected spike, downgrade after quiet weeks). S–M.
- Session breaker levers (exact tokens, rate in tokens/minute, dry run) and a per-session share of account burn. M.
- Passive regression watch from real logs (cache-read ratio and TTL tier per tool-version cohort): a zero-cost complement to the canary. S–M, partly inferred.

**vibe-kanban** (Apache-2.0; its README says it is sunsetting). Its task, workspace, session, pull-request and merge records as an explicit task identity, and "new task attempts" (the same task retried with a different agent) as a natural cost-per-landed comparison. M. NOT VERIFIED: database location and format. Short shelf life.

---

## 3. Evaluation, replay, governance and proof (25 sources and 4 papers)

**promptfoo** (MIT). Taken: per task, arm and day result rows with score or null, error reason, latency and tokens, plus a per-call cache-bypass nonce. The red-team idea became the Attacker.
- Real agent evaluation: run the Claude Agent SDK, Codex SDK or OpenCode on a throwaway copy of a working directory and assert on files, tests and trace spans, with a plain-LLM baseline. The canary needs only a model URL and key and sends 52 text puzzles, so it cannot say whether the user's agent got worse at the user's work. `site/docs/guides/evaluate-coding-agents.md`; L.
- Agent-configuration A/B: two versions of a SKILL.md, CLAUDE.md, MCP set or model on identical tasks, with cost and trace evidence. M.
- A PR action: before and after on changed files. The README lists a CI check on policy changes as not built. S.

**Inspect AI** (MIT). Taken: clustered standard error with the G/(G-1) correction; seeded resampling; unbiased pass^k.
- Re-score stored outputs and a third outcome (right, wrong, invalid format). Desk stores a 16-hex hash of each canary reply and scores any reply the parser misses as 0, so a format change looks like a regression. `src/inspect_ai/_eval/score.py:78-90`; S.
- Scanners (Inspect Scout, MIT): owner-defined detectors over transcripts. M.
- Early stopping and provider batch APIs, since replays and canaries cost real money. M.

**livenerf** (MIT). Taken: paired per-task delta, clustered error, a 99% interval in two consecutive windows, the minimum detectable effect beside every verdict, a harness hash, a control arm.
- A `claude -p` provider: a hermetic call with scrubbed environment, no CLAUDE.md, a pinned CLI version and a context-size guard, so the canary runs on the owner's own plan and agent at no marginal cost. `livenerf/providers/claudecode.py`; M.
- Meter calibration (1 weekly-meter point ≈ 224,527 output tokens, measured over 657 chunks) joined to ledger tokens: this resolves the README's central NOT VERIFIED. `docs/DESIGN.md:7-9`; M.
- An output-token channel and a positive control (effort low gave −62% output tokens while accuracy moved −8.3 ± 4.5, not significant): desk's verdict is score-only with a minimum detectable change near 21 points, so silent effort cuts are invisible. S.
- Seeded item generators, a canary GUID and an item audit (8 wrong keys and 30 ambiguous items found in theirs): desk's 52 tasks are a static public list and can be memorised. M.

**dedrift** (mechanism only; AGPL). Taken: significance plus a materiality gate; "consistent with, not caused by" wording; a published false-alarm and power simulation.
- Dual baselines (a rolling window plus a frozen golden one); desk's baseline is frozen days 1 to 14 only. S.
- A tri-state exit code (ok, drift, evidence missing or partial) and a family-coverage line, so cron and CI can tell "the canary did not run" from green. S.
- A configuration fingerprint of the owner's setup (model, prompt hash, tool schema, agent version) shown next to onset. S/M.

**container-use** (Apache-2.0). Taken: ideas only. One-command agent configuration for Claude Code, Cursor, Codex, Copilot, Goose and Amazon Q (writes Claude `settings.local.json`, runs `claude mcp add`). S/M.

**LangGraph** (MIT). Nothing further. Checkpoints still carry no cost or model fields.

**agent-bisect** (MIT). Taken: a hash-chained row log; abstain as unknowable.
- First-break plus cascade pricing ("stopping at step N saves $X") with HIGH or LOW confidence. Specified (DF-005) but not in `src/`. M.
- Codex and foreign transcript ingest, and the compaction marker. DF-021 is specified; `src/` reads Claude logs only. M.

**Reenact** (MIT). Taken: record and replay of model and Zetaris replies; a missing recording is an error.
- A PR gate (sticky comment plus check-run that fails only on drift from a committed baseline). S.
- `suggest` plus `--on-divergence live` with a `--max-live` cap: draft checks from a recording and pay only for scenarios whose request changed. M.

**Kitaru** (Apache-2.0). Taken: nothing in `src/`; there is no unchanged-replay gate in `route/replay.ts`.
- Importers and `kitaru setup` (Langfuse, LangSmith, Braintrust, Logfire, Phoenix, MLflow). M.
- Owner labels pinned to trace locations, used to calibrate evaluators before they may gate; desk's link and landing confidence is calibrated only on planted truth. M.
- A regression suite from production: a frozen cohort of real sessions, including incident-linked ones, run in CI. S/M.

**Microsoft agent-governance-toolkit** (MIT). Taken: action-digest approval echo, fail-closed, deny-overrides, hash-chained audit.
- A Claude Code plugin (SessionStart, UserPromptSubmit, PreToolUse hooks, `.mcp.json`, slash commands) and Codex CLI and OpenCode adapters; desk's hook is PreToolUse only and Claude-only. M.
- Staged rollout (shadow, canary, promote or roll back with analysis criteria), SLOs, error budgets and alert de-duplication. The code is labelled "Community Edition — basic implementation": mechanism only. M.
- Shadow-AI discovery: find agents on machines that nothing governs, giving an "ungated spend share". NOT VERIFIED beyond the README. M.

**NeMo Guardrails.** Nothing further. The verdict plus `failed` bit is taken. Licence: Apache headers, GitHub reports NOASSERTION.

**Cedar** (Apache-2.0). Taken: forbid over permit, default deny, the restrict-only grid with a counterexample, differential fuzz.
- Equivalence, always-deny and overlap queries as a lint ("this edit is a no-op", "rule X never fires"). `verifier.rs:214-237`; S/M.

**coder/boundary** (MIT for boundary). Taken: pre-call reservation, caps with warn and ask levels, fail-closed.
- Enforcement the agent cannot skip: a network jail with a transparent TLS proxy, default deny, session correlation (Linux only). The README here admits a tool without the hook, or a removed hook, is not stopped; a `desk run -- claude` wrapper would close it. L. A cheaper team path: Claude Code managed settings override user settings, so a lead can ship the hook and the OTel environment that way.

**coding-agent-flight-recorder** (MIT). Taken: loop and idle ideas, null means unknown, estimated against reported dollars.
- Verification from evidence: the last outcome per normalised check command; an "unbacked claim" detector ("41/41 pass" with no passing check); an unrecognised format is inconclusive. `kept` here means merged at least 7 days and not reverted and says nothing about tests. `src/analyze/verify.ts`; S/M.
- A stop point plus risk detectors (secret, CI and migration paths touched; blocked attempts counted). M.
- An OpenCode adapter and guardrails generated from findings. M.

**SWE-bench** (MIT). Taken: the idea of code-checked pass or fail.
- Mine tasks from the owner's merged PRs (issue, gold patch, test changes giving fail-to-pass and pass-to-pass), run in a worktree at the base commit with the owner's test command. This is the missing real-task route replay. Recorded-tool-result replay will not transfer, because Bash and Edit results depend on repository state (inference, NOT VERIFIED). L.
- Guards: the patch must not modify tests; `xfail(run=False)` graded resolved; exit status cross-checked against log text; an empty run is invalid; infrastructure failures stay in the denominator. S.

**DeepEval** (Apache-2.0). Taken: the identical failing tool-call loop (3 in 12 calls).
- Two more deterministic loop signals: reasoning stagnation (bigram Jaccard) and call-graph cycles (A-B-A-B). Alternating or varied-argument loops pass desk's rule. S.
- Judged task-completion and step-efficiency for sessions with no git landing. It needs judge controls and owner-label agreement and conflicts with the code-computes-numbers rule. M, NOT VERIFIED value.

**autoevals.** Nothing further. The score-or-null contract is already how `RunRow` works.

**Cline** (Apache-2.0). Taken: the four-bucket cost formula with reasoning not double-billed.
- A Cline session adapter (per-session cost with sub-agent roll-up). On-disk layout NOT VERIFIED. M.
- User-voted waste classes the autopsy cannot see: edit or diff-apply failure loops (#4384), empty or unparsable response retries (#7262), silent tool-output truncation forcing chunked re-reads (#13263). DF-092 is designed, not built. M.

**in-toto attestation** (Apache-2.0). Taken: Statement v1, DSSE, a custom predicate `urn:desk:dossier:v1`.
- Standard predicates: `test-result` for CI evidence and VSA for "policy verified", so a CI-signed test attestation can back "landed on green" and other tools can read dossiers. S/M.

**Sigstore cosign** (Apache-2.0). Taken: nothing; desk has its own Ed25519 DSSE.
- A timestamp anchor (an RFC 3161 token or Rekor inclusion proof in a Sigstore bundle): `issued_at` is self-declared, so a signer can backdate a month-close. Offline verification works against a pinned trusted root. S/M.
- Interop and key rotation: emit a bundle `cosign verify-blob-attestation` accepts; desk has no rotation or revocation. S.

**lm-evaluation-harness** (MIT). Taken: seed pinning and the harness hash.
- A decontamination check, and the group-standard-error fix (a pooling bug made error bars up to about 3× too narrow in v0.4.13): audit desk's aggregate in `stats.ts` for the same error. S.

**A-Mem, Reflexion, FActScore.** Nothing further: the precedent memory and the measured lessons loop already go beyond them.

**ALCE** (MIT). Leave-one-out citation precision and a "fact that flips the verdict": tells the lead which rows carry the conclusion. S/M.

### Papers (mechanism only)

- **tau-bench (2406.12045).** pass^k is in. Not used: grading end state against a unique goal state (for an agentic canary, repository and test state); running strong agents over the tasks to audit bad keys; classifying misses by wrong argument, wrong decision and partial resolution; a bootstrap interval on pass^k.
- **RouteLLM (2406.18665).** Not used: a router that predicts the probability a strong model wins and sets a threshold for a target strong-call share; the whole cost–quality curve against a random mix; a similarity-weighted router labelled with the owner's landed-cheaply outcomes.
- **MT-Bench / LLM-as-judge (2306.05685).** Applies only if a judged class is added: swap positions and treat inconsistent verdicts as ties; a few-shot judge; reference-guided judging; keep the judge different from the model under test; test verbosity and self-enhancement bias; report agreement with humans.
- **Safe Anytime-Valid Inference (2210.01948).** `canary/eprocess.ts` is a one-sided betting supermartingale against a baseline estimated on 14 days. Not used: a two-sample e-process (removes the baseline approximation), confidence sequences for bounded means (always-valid intervals on the daily delta), e-detectors (onset estimates), e-BH across arms.

---

## 4. The twelve highest-value additions, merged and de-duplicated

1. **Real limit truth.** Limit-hit events and Claude Code's statusline `rate_limits`, then a fitted per-owner limit-to-token mapping. Resolves the central NOT VERIFIED.
2. **Canary and route replay on the owner's real work.** Tasks mined from merged PRs, run through the owner's own agent and tests in a worktree.
3. **An output-token and effort channel** in the canary.
4. **Other agents and teams.** Codex, Gemini, Copilot, OpenCode and Cline readers; Anthropic and Cursor admin APIs; an OTLP receiver; per-person data.
5. **Enforcement reach.** A one-command installer or plugin, managed-settings rollout, a watcher for tools with no hook.
6. **Push, not pull.** Alerts, webhooks, CI exit codes, a PR check on policy edits, scheduled ingest and retention.
7. **Landing truth.** PR and CI facts, worktrees, guards against deleted tests and unbacked "tests pass" claims.
8. **Pricing.** Fast, flex and long-context tiers, a second price source, retirement dates.
9. **Policy levers.** Per-session cap, cost velocity, finalization reserve, sub-agent budgets, staged rollout with a control group, a no-op lint.
10. **Trust.** A timestamp anchor and Sigstore bundle; owner labels to calibrate confidence.
11. **Autopsy depth.** Context composition, first-break cascade with a stop point, new waste classes.
12. **Canary hygiene.** Store replies and re-score, private seeded variants, anytime-valid confidence sequences.

## 5. Patterns several sources share and desk. lacks

1. Measure the real agent on real repository tasks with state-based checks (promptfoo, Inspect, livenerf, SWE-bench, tau-bench, Kitaru).
2. One install, every agent (agent-bisect, flight-recorder, Cline, the governance toolkit, container-use, Claude Code's own OTel).
3. Vendor-reported numbers beside estimates, with freshness (CodexBar, Usage-Monitor, cache-fix, DevLake, OTel `cost.source`).
4. Results that leave the dashboard (CI actions, alerts, exit codes, statusline, notifications).
5. Team aggregation without a server (vendor admin APIs, git refs, database sync, gateway logs).

## 6. Not covered

Several shallow clones on Windows came back partial (CodexBar and figuard docs were restored with long paths), so a search that returned nothing there could be a checkout gap. Read in depth: ccusage, CodexBar, Usage-Monitor, loopguard, agentbudget, figuard, tokencast, codelens, claude-devtools, Entire, cache-fix. Read by API or web page only: agentsview, DevLake, OpenCost, Opik, Phoenix, Portkey, openllmetry, litellm. Not read in depth: the Cedar solver source, Reenact and Kitaru core, Inspect Scout internals, DeepEval beyond two metrics, promptfoo trajectory assertions, autoevals, LangGraph docs. The `ee/` and `enterprise/` trees were not read. Third-party claims (for example "Opus 4.7 burns about 2.4× the 5-hour quota") are the repositories' own, not verified. Nothing was executed and no vendor API was called. The sweeps did not read desk's tests or run desk.
