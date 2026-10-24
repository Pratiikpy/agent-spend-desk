# Feature status: what the code has, against the 129 specified features

Generated from `feature-status.json` by `npm run desk -- status` and checked by `tests/desk/feature-status.test.ts`. The specification is `02-feature-list.md`, which was written as design; this page says how much of it exists.

**42 built, 56 partial, 31 absent** of 129.

How to read a status. *Built*: the core of the feature as specified exists and a test, a `desk prove` check or a verification record exercises it. *Partial*: a real part exists and the missing part is named. *Absent*: no code was found. A status is a judgement made by reading and searching, which is why every row cites the files it rests on. A built feature can still be shallow; the "missing" column says so where known.

| Feature | Status | Evidence | Missing |
|---|---|---|---|
| DF-001 First run and source discovery | partial | `src/desk/ingest/discover.ts`, `src/desk/ingest/codex.ts`, `tests/desk/discover.test.ts` | adapter capability declarations; two adapters (Claude Code, Codex) |
| DF-002 Morning brief | partial | `src/desk/ui/client/screens/brief.js`, `tests/desk/ui/server.test.ts` | quota runway, overnight pauses and denials, a single recommended action by rule, every figure clickable to its rows |
| DF-003 Live gauge (terminal and status line) | absent | none | no gauge or status-line command |
| DF-004 Month bill | partial | `src/desk/ui/client/screens/bill.js`, `src/desk/cost/cost.ts`, `src/desk/reconcile/reconcile.ts`, `tests/desk/cost.test.ts`, `tests/desk/reconcile.test.ts` | the cost Claude Code recorded for itself is stored in a separate table and reconciled by `desk reconcile`, but the Bill screen does not show it beside the estimate; generic invoice import; allocation of idle and shared spend |
| DF-005 Session view and the waste-block explanation | partial | `src/desk/autopsy/engine.ts`, `src/desk/ui/client/screens/sessions.js`, `tests/desk/autopsy.test.ts` | a stop point and rule for each waste block, the first-break cascade |
| DF-006 Outcomes screen and the owner-question queue | partial | `src/desk/ui/client/screens/outcomes.js`, `src/desk/outcomes/link.ts`, `tests/desk/outcomes.test.ts` | the owner-question queue |
| DF-007 Daily canary run and canary card | partial | `src/desk/canary/command.ts`, `src/desk/ui/client/screens/canary.js`, `tests/desk/canary/canary.test.ts` | a scheduled daily run; the pack is a fixed generic one |
| DF-008 Quota runway across plans | partial | `src/desk/limits/fit.ts`, `src/desk/ledger/ingest-codex.ts`, `src/desk/statusline/statusline.ts`, `tests/desk/limits.test.ts`, `tests/desk/statusline.test.ts` | plan percent used and reset time are read from Codex logs and from a Claude Code status line command, and fitted to tokens with an interval (desk limits); there is no screen, no runway at the current burn, and no Claude reading has been captured yet (the user has to turn the status line on) |
| DF-009 Pre-run estimate | partial | `src/desk/gate/estimate.ts`, `tests/desk/gate/gate.test.ts` | P10/P50/P90 by task type, a mid-session warning, a `desk estimate` command |
| DF-010 Alerts on the owner's schedule | absent | none | no alerts or notifications |
| DF-011 Weekly review | absent | none | no weekly review |
| DF-012 Month close and the next-month decision | partial | `src/desk/propose/run.ts`, `src/desk/dossier/command.ts`, `tests/desk/propose.test.ts` | a month-close screen and its brief |
| DF-013 Ask the Desk | built | `src/desk/ask/ask.ts`, `tests/desk/ask.test.ts`, `tests/desk/ask-ops.test.ts` | - |
| DF-014 Scene 0: the question | partial | `src/desk/demo.ts` | the demo is eight beats, not the scene set specified |
| DF-015 Scene 1: the bill opens on the biggest waste block | partial | `src/desk/demo.ts` | the demo is eight beats, not the scene set specified |
| DF-016 Scene 2: the agent regressed on Wednesday 14 October | partial | `src/desk/demo.ts`, `src/desk/canary/command.ts` | uses the recorded canary, not the specified scene |
| DF-017 Scene 3: replay last month on a cheaper route | partial | `src/desk/route/replay.ts` | replay on a cheaper route covers canary tasks only |
| DF-018 Scene 4: the argument, the diff and the wow sentence | partial | `src/desk/demo.ts` | the argument, diff and wow sentence scene as specified |
| DF-019 Judge-proof demo mode | partial | `src/desk/prove/run.ts`, `src/desk/demo.ts` | judge-proof mode is sample mode plus `desk prove`, not a separate mode |
| DF-020 Claude Code log adapter | built | `src/desk/ingest/claude-code.ts`, `tests/desk/ingest.test.ts` | - |
| DF-021 Codex log adapter | partial | `src/desk/ingest/codex.ts`, `src/desk/ledger/ingest-codex.ts`, `tests/desk/codex-parse.test.ts`, `tests/desk/codex-ingest.test.ts`, `docs/verification/codex-reader-and-limit-fit-2026-10-24.md` | calls come from growth of the cumulative total (merged requests are marked, a forked session's replayed history is left out); a negative counter is clamped to zero and not flagged; OpenAI models have no price rows, so calls are unpriced |
| DF-022 OpenTelemetry GenAI ingest and the `desk.*` namespace | absent | none | no OpenTelemetry ingest and no desk.* namespace |
| DF-023 Gateway spend-log adapter | absent | none | no gateway spend-log adapter |
| DF-024 Invoice and usage-export import | partial | `src/desk/silo/facts.ts`, `src/sponsors/zetaris/silo-port.ts`, `tests/desk/silo.test.ts` | invoices arrive only through the Zetaris silo; there is no generic import |
| DF-025 Price book | built | `src/desk/pricing/pricebook.ts`, `tests/desk/cost.test.ts` | a second price source, retirement dates |
| DF-026 Per-call cost formula and surcharges | partial | `src/desk/cost/cost.ts`, `src/desk/pricing/pricebook.ts`, `tests/desk/cost.test.ts`, `tests/desk/price-tiers.test.ts` | Claude Haiku 5.5 is priced by prompt length (over 100,000 tokens) from Anthropic's page; fast-mode, batch and US-only (1.1x) surcharges are not applied, and the logs do not say which applied |
| DF-027 Provenance classes, reconciliation and allocation | partial | `src/desk/silo/facts.ts`, `src/desk/cost/cost.ts` | a reported class, idle and shared allocation |
| DF-028 Unpriced handling | built | `src/desk/cost/cost.ts`, `tests/desk/cost.test.ts` | - |
| DF-029 Repricing as superseding events | partial | `src/desk/ledger/db.ts`, `src/desk/ledger/ingest.ts` | repricing replaces a cost event by re-ingest; it is not recorded as a superseding event |
| DF-030 Task identity | partial | `src/desk/outcomes/link.ts` | a task identity beyond the session |
| DF-031 Attribution with confidence | built | `src/desk/outcomes/attribute.ts`, `src/desk/calibrate/attribution.ts`, `tests/desk/calibration.test.ts`, `tests/desk/outcomes.test.ts` | - |
| DF-032 Landing lattice | built | `src/desk/outcomes/attribute.ts`, `src/desk/outcomes/breakdown.ts`, `tests/desk/outcomes.test.ts` | - |
| DF-033 Waste classes | partial | `src/desk/autopsy/engine.ts`, `tests/desk/autopsy.test.ts` | classes beyond the ones the sample plants (truncation re-reads, reflection loops, edit-failure loops) |
| DF-034 Threshold calibration on the owner's history | absent | none | no calibration of thresholds on the owner's history |
| DF-035 Forecasts with a scorecard | partial | `src/desk/replay/wind-tunnel.ts`, `src/desk/calibrate/windtunnel.ts`, `tests/desk/calibration.test.ts` | a forecast of the owner's month with a running scorecard; the tunnel's range is a screen whose coverage was measured at 73% |
| DF-036 Canary task capture | absent | none | canary tasks are not captured from the owner's work |
| DF-037 Hermetic canary runner, cache bypass and control arm | built | `src/desk/canary/runner.ts`, `src/desk/canary/tasks.ts`, `tests/desk/canary/canary.test.ts` | - |
| DF-038 Scoring cascade and judge-panel controls | partial | `src/desk/canary/tasks.ts` | code scoring only; no judge panel or agreement check |
| DF-039 Regression statistic, MDE, watch flag and attribution | built | `src/desk/canary/verdict.ts`, `src/desk/canary/stats.ts`, `tests/desk/canary/stats.test.ts` | - |
| DF-040 Trajectory capture and replayability accounting | absent | none | no trajectory capture of tool-using runs |
| DF-041 Side-effect-safe replay | absent | none | no side-effect-safe replay of tool calls |
| DF-042 Cheaper-route swap with reproduction gate and paired interval | partial | `src/desk/route/replay.ts`, `src/desk/route/command.ts` | canary tasks only, not real tool-using tasks |
| DF-043 Language surcharge and the locale route experiment | absent | none | no language surcharge or locale route experiment |
| DF-044 Spend policy language | built | `src/desk/policy/parse.ts`, `src/desk/policy/evaluate.ts`, `tests/desk/policy.test.ts` | - |
| DF-045 Caps, windows and override resolution | partial | `src/desk/policy/types.ts`, `src/desk/gate/gate.ts` | windows are day and month only; no per-session, per-model or velocity limits |
| DF-046 Reservation ledger and integrity job | built | `src/desk/gate/gate.ts`, `src/desk/gate/ledger.ts`, `tests/desk/gate/gate.test.ts` | - |
| DF-047 Restrict-only check with a counterexample | built | `src/desk/policy/restrict.ts`, `src/desk/prove/fuzz.ts`, `tests/desk/policy.test.ts` | - |
| DF-048 Policy replay before a change | built | `src/desk/replay/policy-replay.ts`, `tests/desk/replay.test.ts` | - |
| DF-049 Approval echo card and approval-habit metrics | partial | `src/desk/dossier/approval.ts`, `tests/desk/dossier/happy.test.ts` | approval-habit metrics |
| DF-050 Shadow mode and the emergency gate switch | built | `src/desk/gate/gate.ts`, `src/desk/gate/cli.ts`, `tests/desk/gate/gate.test.ts` | - |
| DF-051 Pause with checkpoint | partial | `src/desk/gate/gate.ts` | pause is a refusal; no checkpoint is written for a resume |
| DF-052 Enforcement-surface ladder and notify-only labels | partial | `src/desk/gate/gate.ts`, `docs/verification/gate-enforcement.md` | a ladder of enforcement surfaces with notify-only labels |
| DF-053 Local reserve endpoint (HTTP) | built | `src/desk/gate/http.ts`, `tests/desk/gate/gate.test.ts` | - |
| DF-054 MCP tools | built | `src/desk/gate/mcp.ts`, `tests/desk/gate/mcp.test.ts` | - |
| DF-055 Gateway door | absent | none | no gateway door |
| DF-056 Hook adapters per agent tool | partial | `src/desk/gate/hook.ts`, `docs/verification/gate-enforcement.md` | Claude Code only |
| DF-057 Zetaris data path and the on-camera query | built | `src/sponsors/zetaris/silo-port.ts`, `src/sponsors/zetaris/queries.ts`, `tests/sponsors/zetaris/silo-port.test.ts` | - |
| DF-058 Model endpoint (Nemotron through NVIDIA's free API) | built | `src/desk/agents/model.ts`, `tests/desk/agents.test.ts` | - |
| DF-059 Team mode with permissioned views | absent | none | no team mode |
| DF-060 CI gate | absent | none | no CI gate and no exit-code contract for a pipeline |
| DF-061 Seat return and renewal sheet | built | `src/desk/seats/seats.ts`, `src/desk/seats/command.ts`, `src/desk/prove/run.ts` | the renewal sheet export is not verified |
| DF-062 Bill auditor and dispute pack | absent | none | no bill auditor or dispute pack |
| DF-063 Adapter SDK and open ledger format | absent | none | no adapter SDK or published ledger format |
| DF-064 Opt-in public regression index | absent | none | no public regression index |
| DF-065 Shareable rule packs and canary templates | absent | none | no shareable rule packs or canary templates |
| DF-066 Claim ledger with exact quote, number and comparative checks | built | `src/desk/agents/claims.ts`, `src/desk/agents/audit.ts`, `tests/desk/agents.test.ts` | - |
| DF-067 Auditor critic loop | built | `src/desk/agents/explain.ts`, `tests/desk/agents.test.ts` | - |
| DF-068 The one fact that would flip each verdict | absent | none | the one fact that would flip each verdict is not computed |
| DF-069 Signed dossiers | built | `src/desk/dossier/sign.ts`, `src/desk/dossier/build.ts`, `tests/desk/dossier/happy.test.ts` | - |
| DF-070 Offline verifier | built | `src/desk/verify/verify.ts`, `tests/desk/dossier/happy.test.ts` | - |
| DF-071 Hash-chained append-only ledger | partial | `src/desk/gate/ledger.ts`, `src/desk/dossier/log.ts` | the gate ledger and the dossier log are hash-chained; the usage ledger is not |
| DF-072 Untrusted log text isolation | partial | `src/desk/engines/label.ts`, `src/desk/ask/risk.ts` | labels are sanitised and instructions flagged; there is no systematic test that planted instructions in log text cannot change a plan |
| DF-073 Redaction at read | partial | `src/desk/card/redact.ts`, `src/desk/security/secrets.ts`, `tests/desk/card.test.ts`, `tests/desk/security.test.ts` | credential shapes are masked in stored log text (folder, branch, tool version, edited path) and in every outgoing model message, and the author e-mail is stored as a pseudonym; a planted-secret test across the card, the trace and the dossier is not written, and the entropy rule is applied on the card only |
| DF-074 Local-first egress manifest | partial | `src/desk/security/egress.ts`, `src/desk/agents/model.ts`, `tests/desk/security.test.ts` | every model request is logged as host, size, hash and count of masked secrets, and `desk egress` prints the summary; the Sources screen does not show it, an undeclared destination is not refused, and no network-monitor test runs |
| DF-075 JSONL decision trace with the why | built | `src/desk/agents/trace.ts`, `tests/desk/agents.test.ts` | - |
| DF-076 SAMPLE_MODE cassettes and rule-brain fallback | built | `src/desk/agents/model.ts`, `src/desk/prove/run.ts` | - |
| DF-077 Bounded runs; the Desk pays through its own ledger | partial | `src/desk/agents/budget.ts`, `tests/desk/agents.test.ts` | budgets are enforced in code; the Desk's own model calls are not paid through its own ledger |
| DF-078 A provenance chip on every figure, and unknown is never zero | partial | `src/desk/ui/client/lib/prov.js` | provenance chips in the UI; not on every figure in every output |
| DF-079 Unlinked spend shown as unknowable | built | `src/desk/outcomes/breakdown.ts`, `tests/desk/outcomes.test.ts` | - |
| DF-080 Wording lint | partial | `src/desk/canary/command.ts`, `src/desk/prove/run.ts` | a wording check on canary text; no general lint over outputs |
| DF-081 Published canary simulation | built | `src/desk/canary/simulate.ts`, `docs/verification/canary-simulation.md` | - |
| DF-082 Published replay calibration | built | `src/desk/calibrate/windtunnel.ts`, `docs/verification/calibration` | - |
| DF-083 Sources and doctor: what the Desk cannot know | built | `src/desk/ui/client/screens/sources.js`, `tests/desk/ui/server.test.ts` | - |
| DF-084 Failure drills and every error state | partial | `docs/verification/ui-sweep.md`, `src/desk/prove/run.ts` | drills exist for Zetaris and the gate; not every error state |
| DF-085 Published role-necessity and engine ablations | partial | `src/desk/prove/run.ts`, `src/desk/engines/registry.ts` | engine ablations only; no role-necessity ablation of the Auditor, critic and others |
| DF-086 Clean-room verification from the README | partial | `README.md` | the clean-room runs are recorded in the README; their logs are not committed |
| DF-087 Themes, accessibility and charts with tables | partial | `src/desk/ui/client/styles.css`, `docs/verification/ui-sweep.md` | light and dark and phone width were checked; keyboard, screen reader and measured contrast were not |
| DF-088 Supervision attention-load governor and review-overhead meter | absent | none | no supervision-load governor |
| DF-089 Prompt-cache invalidation root-cause analyzer | partial | `src/desk/autopsy/engine.ts` | cache-miss causes are inferred from logs; the prefix-diff root cause is not built |
| DF-090 Tool-call idempotency key guard | partial | `src/desk/gate/gate.ts` | the reserve is idempotent; there is no tool-call exactly-once guard |
| DF-091 Quota-aware plan router | absent | none | no quota-aware plan router |
| DF-092 Tool-output silent-truncation waste detector | absent | none | no silent-truncation detector |
| DF-093 Earned-autonomy promotion and demotion matrix per workflow | absent | none | no earned-autonomy matrix |
| DF-094 Multi-agent delegation handoff cost tree | partial | `src/desk/autopsy/engine.ts` | the sub-agent share is shown; there is no handoff cost tree |
| DF-095 Share-weighted idle and shared-overhead allocation engine | absent | none | no share-weighted idle allocation |
| DF-096 Phase-based context-bloat accounting across compactions | partial | `src/desk/autopsy/engine.ts` | compaction-aware miss classification; not phase-based bloat accounting |
| DF-097 Replay workspace snapshot including untracked scratch files | absent | none | no workspace snapshot for replay |
| DF-098 Verbosity-bias penalty and bidirectional swap scoring in replay | absent | none | no verbosity-bias penalty or swap scoring |
| DF-099 E-process anytime-valid canary monitor | built | `src/desk/canary/eprocess.ts`, `tests/desk/canary/stats.test.ts` | - |
| DF-100 Ungrounded-reflection-loop waste detector | absent | none | no ungrounded-reflection detector |
| DF-101 Structured tool-output alignment and continuous scoring in canary and replay | absent | none | no structured tool-output alignment |
| DF-102 Standard in-toto statement and Sigstore-bundle packaging of dossiers | partial | `src/desk/verify/dsse.ts`, `src/desk/verify/format.ts` | in-toto Statement v1 in DSSE exists; no Sigstore bundle or timestamp anchor |
| DF-103 Policy Attacker | built | `src/desk/agents/attacker.ts`, `tests/desk/propose.test.ts` | - |
| DF-104 Reliability over repeated runs | built | `src/desk/bench/run.ts`, `tests/desk/bench/bench.test.ts` | - |
| DF-105 Precedent memory and outcome tracking | partial | `src/desk/lessons/precedent.ts`, `src/desk/regret/regret.ts`, `tests/desk/lessons.test.ts` | retrieval is lexical; realised 7, 14 and 30 day outcomes are not tracked |
| DF-106 Multi-surface confidence calibration and ECE tuning | partial | `src/desk/calibrate/windtunnel.ts`, `src/desk/calibrate/attribution.ts`, `tests/desk/calibration.test.ts` | ECE for the tunnel and link confidence; judges and auditors are not calibrated |
| DF-107 Value-of-information question governor | absent | none | no value-of-information question governor |
| DF-108 Causal explanation faithfulness and minimal-flip validation | absent | none | no leave-one-out faithfulness or minimal-flip check |
| DF-109 Published reasoning scorecard and ablation ledger | partial | `docs/verification/benchmark/RESULTS-v2.md`, `src/desk/prove/run.ts` | the pieces exist; there is no unified scorecard |
| DF-110 Deterministic reasoning replay from signed dossiers | partial | `src/desk/ask/ask.ts` | verify-answer re-runs an answer's steps; the whole decision pipeline is not replayed from a dossier |
| DF-111 Limit autopsy | built | `src/desk/autopsy/engine.ts`, `tests/desk/autopsy.test.ts` | - |
| DF-112 Your-own-logs result card | built | `src/desk/card/build.ts`, `tests/desk/card.test.ts` | - |
| DF-113 Cause-ranked fix list | built | `src/desk/card/fixes.ts`, `tests/desk/card.test.ts` | - |
| DF-114 Opening and closing scenes | partial | `src/desk/demo.ts` | opening and closing scenes as specified |
| DF-115 Zetaris three-silo federated query, with the on/off diff | built | `src/sponsors/zetaris/silo-port.ts`, `src/desk/prove/run.ts`, `tests/desk/silo.test.ts` | - |
| DF-116 Meterless H-MEM as the owner's memory | partial | `src/desk/engines/memory.ts`, `tests/desk/ask.test.ts` | add, query and supersession only; a hash embedder; no mining, feedback or sleep |
| DF-117 Meterless World Model as the change history | partial | `src/desk/engines/world.ts` | upsert, assert, views and as-of queries; no ingest pipeline, merge queue or audit |
| DF-118 Meterless Markovian on a long ledger | partial | `src/desk/engines/carry.ts` | the engine's run only; no progress, history or projection |
| DF-119 Meterless Scout Intent as the router and guard | absent | none | Scout Intent is not vendored; the Risk Router is our own code |
| DF-120 Nemotron tool-calling Planner and Drafter | built | `src/desk/agents/model.ts`, `src/desk/agents/drafter.ts`, `src/desk/ask/ask.ts`, `tests/desk/agents.test.ts`, `tests/desk/drafter.test.ts`, `tests/desk/ask.test.ts` | - |
| DF-121 Cursor build log and evidence | absent | `docs/sponsors/cursor-usage-log.md` | the log is empty; no Cursor session is recorded |
| DF-122 Sponsor scorecard | partial | `docs/submission/sponsor-technology-explanation.md` | no scorecard artefact; the explanation and prove checks stand in |
| DF-123 Policy wind tunnel | built | `src/desk/replay/wind-tunnel.ts`, `tests/desk/replay.test.ts` | its range holds 73% of the time, not 90% |
| DF-124 Answers as programs | built | `src/desk/ask/program.ts`, `src/desk/ask/specialists.ts`, `tests/desk/ask.test.ts` | - |
| DF-125 Head-to-head reasoning benchmark | built | `src/desk/bench/run.ts`, `docs/verification/benchmark/PREREGISTRATION.md` | - |
| DF-126 Break-it challenge and differential fuzzing | partial | `src/desk/prove/fuzz.ts` | differential fuzzing is built; the public break-it challenge is not |
| DF-127 Learning from mistakes, measured | built | `src/desk/lessons/learn.ts`, `tests/desk/lessons.test.ts` | its measured effect is small and its interval touches zero |
| DF-128 `desk prove` | built | `src/desk/prove/run.ts` | - |
| DF-129 Decision regret ledger | built | `src/desk/regret/regret.ts`, `tests/desk/regret.test.ts` | - |
