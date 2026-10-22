# Desk product requirements (PRD v1.0)

Status: design, 2026-10-20. Nothing here is built, run or measured. This is the product contract for the Agent Spend and Worth Desk on the Plumbline core: what, for whom, how we will know, and how each requirement is tested. Mechanism lives in `00-architecture-master-spec.md` v1.0 (cited `§n`; it wins on mechanism). Features live in `02-feature-list.md` (cited `F-Dnn`). Copy sources live in `01-adoption-register.md` (`R:<id>`). Evidence lives in the idea database `research/idea-hunt/idea-hunt.db` (cited `claim <id>`, red-team rows `RT-<id>`). Decision basis: D-036. Where the Official Rules of the event disagree with anything here, they win. Anything unproven is marked **NOT VERIFIED**.

## 1. Problem and evidence

### 1.1 The problem

People who pay for AI agents cannot say what the money bought. Three failures recur:

1. **Spend is not tied to outcome.** Bills and usage views count tokens, seats and credits; they do not say which dollars produced work that landed and which were burned on loops, idle agents and abandoned attempts.
2. **Quality changes silently.** Owners suspect their agent got worse after an update and have no way to test it on their own work.
3. **Controls arrive after the money is gone.** Caps that read billing data lag the spend by hours; agents cannot checkpoint when a limit hits.

### 1.2 Demand evidence (from the database; numbers are as the claims record them)

The report records pain across 35 independent hosts (`report.md` line 36). The database links 82 demand claims to idea 278. The strongest, by kind:

| Pain | Evidence |
|---|---|
| Usage limits hit unexpectedly | claims 52 and 655 (an open Claude Code issue with 1,499 comments), 53 and 654 (879 comments, 545 reactions) |
| Runaway and abusive spend, caps that read billing too late | claim 702 (an overnight loop burned about $6,000; the dashboard lagged by days), 2872 and 2873 (600,000 Gemini calls in an hour, $7,500 charged plus $6,500 pending; billing data appeared about 10 hours later), 2875 ($82,314 after a key compromise against about $180 normal monthly spend), 2870 (about $19,000 on an old Maps key) |
| Idle and heartbeat spend | claims 2274 (one OpenClaw heartbeat burns 170,000 to 210,000 tokens), 2275 (about 30 yuan overnight while idle), 2276 (over 1,000 yuan within hours), 2277 (weekly API bill up over 3,000 yuan) |
| Credits consumed by failed attempts, refunds refused | claims 1074, 1076 (Manus), 1077 (Replit agent looping on its own errors), 1088 (charges cannot be reversed) |
| No shared crew budget | claims 1412, 1413, 3172 to 3175 (CrewAI forum; replies converge on estimate, reserve, execute, reconcile, and name no product) |
| Silent regression, no way to check | claim 62 (most-reacted agent issue found: 3,286 reactions; users mined months of logs to show a regression), 63 (no way to pin or check), 953 (354-comment HN thread on a third-party daily degradation tracker), 136 (760 points), 969 (LiveNerf 1,536 stars in four weeks) |
| Context re-reads dominate | claims 749 (a Qiita audit of 424 conversations: about 60% of the bill was re-reading history), 748 (14,900 tokens on a bare greeting) |
| Hard limits stop work without a save point | claims 1165, 1166, 1167 (a hard limit stops an agent immediately, no checkpoint, no visibility), 1168 and 1169 (a silent downgrade mid-session cost hours) |
| Token volume is the wrong metric | claims 1964 to 1967, 1970 (Amazon shut an AI leaderboard that rewarded volume over value) |
| Seats bought and unused | claims 1290 to 1294 (Copilot buyers told to plan for 30 to 55% weekly active use; idle seats billed at list price; the vendor dashboard does not show which licences to pull back) |
| Forecasts must be wide | claims 514 and 3107 (identical tasks differ up to 30x in tokens), 515 and 3108 (models underestimate their own token use) |
| Budget overruns are a catalogued class | claim 3176 (63 production budget-overrun incidents across 21 frameworks), 3177 (reservation correctness already benchmarked) |

### 1.3 Counter-evidence (also from the database, kept beside the demand)

- Vendors already ship parts: claims 3769, 3770 (Anthropic spend alerts, per-user cost, a cost-per-commit tab), 3398, 3399 (admin spend limits, a CLI hard budget), 3391 to 3394 (Claude Code attributes plan usage to skills and sub-agents, flags long context and cache misses), 3465 to 3468 (quota percentages to statusline scripts, `PostModelSwitch` and `StopFailure` hooks, native wait-out of limits).
- Adjacent tools: claim 3771 (Langfuse puts cost and score-drop alerts in one product), 3772 (Torii seat and token spend), 3773 (LiteLLM hard budgets).
- Category weakness: claims 3774, 3758 to 3760 (Helicone acquired and reported in maintenance mode; sources disagree), 3470 (a Claude usage-limit forecaster launch drew 7 HN points), 3472 (the usage-meter field is crowded and active).
- Daily value is thin by default: claim 980 (a rigorous tracker needs two windows; the typical daily result is "nothing happened"), 3396 (seat plans are not metered in dollars), 3395 (a vendor's dollar figure is itself an estimate), 3397 (vendor-stated enterprise average about $13 per developer per active day, small next to pay).

What the evidence supports: the pain is real, repeated and multi-vendor. What it does not support: that anyone will pay a third party to fix it (section 3), or that the Desk's mechanisms beat the incumbents on real users (NOT VERIFIED until people use it). The idea did not clear the research's own bar: raw 69.4, final 53.4 after eight open weaknesses (`report.md` line 7).

## 2. Users and jobs to be done

**Primary user (the demo user).** An engineering lead who pays for a team's coding agents (about 5 to 50 engineers; a mix of seat plans and API tokens through one or two providers, possibly a gateway), accountable to finance (§1.2).

| Job | When | Today | With the Desk |
|---|---|---|---|
| Say what the money bought | month end, when finance asks | token counts and a vendor's cost-per-commit estimate | a bill split by landing state, waste class and an honest unlinked share (DF-004) |
| Stop runaway spend before it happens | any time | billing alerts hours late | reserve-before-call caps that fail closed, with a checkpointed stop (DF-046, DF-051, DF-055) |
| Know whether the agent got worse | after an update, or on a hunch | anecdotes, public benchmarks of someone else's tasks | a pre-registered statistic on the owner's own tasks with a control arm (DF-039) |
| Decide next month's caps, routes and seats | monthly | gut feel | a policy diff with restrict check, policy replay and a signed dossier (DF-012, DF-018) |
| Choose a cheaper route without wrecking quality | when costs rise | try it and hope | replay of last month on the route with a measured saving and a quality interval (DF-017) |
| Answer "why did Thursday cost three times Wednesday" | ad hoc | spreadsheets | Ask the Desk with checked claims (DF-013) |

**Secondary users served by the same ledger, not in the demo** (§1.2): the operations owner of a fleet of support or back-office agents billed per call or per outcome (DF-062 for per-outcome billing), and the heavy individual user on several plans (DF-008). The demo does not switch personas.

**Non-users**: people who want developer-productivity rankings (the Desk never ranks people, §2.2); single-vendor Claude-only teams that only want caps (the vendor console is enough and free; §17 RT-139 and the README say so).

## 3. The buyer and the user (the "who pays" weakness, answered honestly)

RT-142 says: individual heavy users have ccusage free, teams get vendor consoles free, and no named buyer was found willing to pay for a third-party desk. **This cannot be fixed by design.** What exists and what does not:

| Question | What the evidence shows | Status |
|---|---|---|
| Is there a person who owns the bill? | Yes: the engineering lead or operations owner accountable to finance; seat renewers (claims 1290 to 1294); people paying overruns (claims 702, 2875) | supported by demand claims, not by interviews |
| Do they feel the pain enough to act? | Large, repeated, multi-vendor threads (section 1.2) | supported |
| Will they pay a third party? | No evidence. Larridin sells "agent effectiveness" to enterprises with no listed customers or pricing (competitor row 925); a funded cost-observability product went to maintenance mode (claim 3774); the usage-meter category is crowded with free tools (claim 3472); a forecaster launch drew 7 points (claim 3470) | **NOT VERIFIED** |
| Is the user the buyer? | For individuals and small teams, yes, and they pay nothing (open source, local-first). For larger teams, the buyer is the lead or finance; the user is the lead | inference |

How the product lives with it (§17 RT-142): the single-user, local, open-source Desk is free, like ccusage. Team features (DF-059 team mode, DF-060 CI gate, DF-061 renewal sheet, DF-062 dispute pack) are the grant and paid path; they are part of the full build, ordered after the demo path in spec 19, and the seat features DF-061 and DF-062 are built because the one decision names seats. The hackathon submission claims no market and no willingness to pay. What would change the status: named teams running the Desk on their own logs for a month and reporting a decision it changed (section 5, measure U-3).

## 4. Goals and non-goals

### 4.1 Goals

- **DG-1 One decision, well evidenced.** The owner can make next month's caps, route and seat decision from evidence that a stranger can verify offline.
- **DG-2 Honest numbers.** Every figure carries its provenance class; unknown is never zero; intervals wherever there is uncertainty.
- **DG-3 Regression evidence on the owner's own work.** Pre-registered, with its detection limit shown.
- **DG-4 Spend controls that hold.** Reserve before the call, settle bounded, fail closed, say where enforcement is impossible.
- **DG-5 A real agent system** that meets the organizers' definition with traced behaviours that change outcomes.
- **DG-6 Runnable by a stranger** from the README in SAMPLE_MODE with no key and no network, and on their own logs.

### 4.2 Non-goals (from §2.2, restated as product commitments)

Not an invoice (reconciles when an invoice is imported); not a gateway product (the gateway door exists only to enforce reservations); not a universal pause (notify-only tools are labelled); not a developer-productivity measure (no ranking of people); not a model leaderboard; no quota pooling or account routing across plans; no invented seat dollar per task (seat plans show "value extracted at list price, not money spent"); no narrow forecasts; no claim that multi-agent is better.

## 5. Measurable success criteria

Each criterion names its measurement and the test or study that produces it. **No target below has been met; none has been run.** Product criteria are set now; user criteria can be measured only once people use it and are reported as NOT VERIFIED until then.

### 5.1 Product criteria (measurable on the build)

| Id | Criterion | Bar | Measured by |
|---|---|---|---|
| Q-1 | Time from fresh clone to first bill on the sample month | under 3 minutes on the reference machine (stated with its spec) | timed `CR` run, three runs, worst reported |
| Q-2 | Analysis time, 30 days of a heavy user's logs | under 2 minutes (§14.2; NOT VERIFIED) | timed run on a consented real log set |
| Q-3 | Rendered dollar figures without a provenance class | 0 | `NEW:no-unlabelled-figure` DOM scan on every screen |
| Q-4 | Dedupe exactness | total equals hand count on the A-1 fixture; excluded count printed | A-1 gate (§16.2) |
| Q-5 | Canary false-alarm rate | reported with its exact 95% upper bound; with 500 null histories only zero alarms certifies at most 1% (bound about 0.6%); any alarm is published with its bound, or 2,000 histories are run | `S:false-alarm` |
| Q-6 | Published MDE accuracy | within 1 point of the simulated 80% power point | `S:power-curve` |
| Q-7 | Platform confound | `harness_or_platform` in at least 95% of confounded runs | `S:platform-confound` |
| Q-8 | Replay interval coverage | 95% intervals cover zero in at least 93% of 200 self-replays | `RC:self-replay` |
| Q-9 | Replay side effects | zero outbound effects | `RC:side-effect-safety` |
| Q-10 | Restrict-check correctness | agrees with Cedar symcc on the translated subset; mutation set behaves as designed | `X:restrict-diff`, `X:restrict-mutation` |
| Q-11 | Reservation invariant | I-R5 never broken except by a recorded overage over random interleavings | `P:random-interleavings`, `I:integrity-job` |
| Q-12 | Fail-closed latency | gate blocks within 250 ms of endpoint loss | `D:drill-gate-down` |
| Q-13 | Dossier integrity | every tamper case FAILs; untampered PASS with pins, INDETERMINATE without | `C:tamper-corpus-desk`, `CR` |
| Q-14 | Outputs vary with inputs | every documented perturbation changes every affected number, including the canary verdict | `M:mutate` |
| Q-15 | Agent behaviours | each claimed behaviour has a trace event and a recorded case where it changed the outcome | `B:behaviour-matrix`, `A:role-ablation` |
| Q-16 | Sponsor roles | each Meterless engine's ablation changes an output, or the engine is not claimed | `A:engine-ablation` |
| Q-17 | Accessibility | axe-core zero serious or critical; every screen read in light, dark, desktop, mobile | M10 gate, `NEW:visual-matrix` |

### 5.2 User criteria (NOT VERIFIED until people use it)

| Id | Criterion | How it would be measured |
|---|---|---|
| U-1 | Owners open the brief on most working days | local, owner-visible open counts (never sent anywhere) in a consented study |
| U-2 | Attribution confirmations change landed shares | share of owner answers that change a task's attribution |
| U-3 | The Desk changes a real decision | named teams report one cap, route or seat decision taken on Desk evidence in a month |
| U-4 | Approval habit | approval time and share approved without opening evidence (§10.3), reported, with no claim that the card improves accuracy |

## 6. Requirements by tier, traced to features

Each requirement is "shall"; the full feature-to-requirement-to-test matrix is section 14.

### 6.1 Daily loop

- **RQ-DL-01** The Desk shall reach a first bill from a fresh clone with no account, key or network, either on the sample month or on the owner's local logs, reading read-only. (DF-001, DF-019)
- **RQ-DL-02** The morning brief shall show yesterday's spend with class mix, landed / waste / unlinked, overnight gate actions, idle agents, canary state, quota runway, and at most one recommended action, each figure reproducible from its rows. (DF-002)
- **RQ-DL-03** The gauge shall run from the log stream without changing the agent and drop official reads older than 600 s. (DF-003)
- **RQ-DL-04** The month bill shall split dollars by landing state and waste class, show unlinked as unknowable, print the class mix, and open every block to its sessions. (DF-004, DF-005, DF-014, DF-015)
- **RQ-DL-05** Low-confidence attributions shall become owner questions; answers shall persist as explicit attributions and never raise a landing state beyond external facts. (DF-006)
- **RQ-DL-06** The canary shall run daily under budget and harness guards and show one of its defined states on the brief. (DF-007)
- **RQ-DL-07** Quota shall be shown per plan with official and estimated sources side by side, never merged. (DF-008)
- **RQ-DL-08** A pre-run estimate shall be an interval with n, or "no estimate" below 10 similar tasks; the tail shall be kept. (DF-009)
- **RQ-DL-09** Alerts shall be deduplicated, rate-limited to one per suite per day, and linked to evidence. (DF-010)
- **RQ-DL-10** The weekly review and month close shall end in one decision artifact: an approved or rejected policy diff with a dossier. (DF-011, DF-012)
- **RQ-DL-11** Ask the Desk shall answer only with claims that pass the Auditor, within its run budget, and route spend actions to the gate. (DF-013)

### 6.2 Wow scenes

- **RQ-WS-01** One command shall reproduce the four scenes offline; every number shall be computed at run time; documented perturbations shall change every affected number. (DF-016 to DF-019)
- **RQ-WS-02** Scene 4 shall show the policy replay's sessions paused, dollars not spent and landed tasks blocked, the restrict result per rule, the approval echo, and an offline verifier PASS. (DF-018)

### 6.3 Engines

- **RQ-EN-01** Adapters shall declare capabilities, dedupe exactly, count every exclusion, and never invent a field. (DF-020 to DF-024)
- **RQ-EN-02** Pricing shall be integer micros from dated, sourced rows; unpriced shall be null and counted; repricing shall supersede, never mutate. (DF-025 to DF-029, DF-043)
- **RQ-EN-03** Landing shall come from git, CI and PR facts with attribution confidence; reverts and closed-unmerged work shall have their own states. (DF-030 to DF-032)
- **RQ-EN-04** Waste rules shall be explicit, parameterised, calibrated against the owner's landing labels, and never use duration alone. (DF-033, DF-034)
- **RQ-EN-05** Forecasts shall carry intervals and a coverage scorecard that widens intervals when they miss. (DF-035)
- **RQ-EN-06** The canary shall capture from the owner's history, run hermetically with cache bypass and a control arm, score by cascade with judge controls, and call a regression only under the pre-registered rule with the MDE shown. (DF-036 to DF-039)
- **RQ-EN-07** Replay shall account for replayability, never execute mutating tools, withhold comparisons when baseline reproduction fails, and report a measured saving with a paired quality interval. (DF-040 to DF-043)

### 6.4 Gate and policy

- **RQ-GP-01** The spend policy shall be default-deny, forbid-overrides-permit, with closed atom types, every applicable cap binding. (DF-044, DF-045)
- **RQ-GP-02** Paid calls on enforced scopes shall be reserved at worst case before the call; settle shall be bounded with a typed overage; invariants shall be checked on schedule. (DF-046)
- **RQ-GP-03** Every policy edit shall get a restrict-only result over all cells, with a concrete counterexample for any widening. (DF-047)
- **RQ-GP-04** Every policy edit shall be replayed over recorded history with baseline reproduction before approval, headlining landed tasks blocked. (DF-048)
- **RQ-GP-05** Approvals shall count only when they echo the request id and action digest; deny, malformed and timeout deny. (DF-049)
- **RQ-GP-06** Enforcement shall fail closed; shadow mode and a time-boxed, signed bypass shall be the only relief. (DF-050, DF-053)
- **RQ-GP-07** Stops shall checkpoint; each tool shall be labelled enforced, advisory or notify-only by test, not by assumption. (DF-051, DF-052, DF-056)

### 6.5 Doors and integrations

- **RQ-DO-01** HTTP, MCP and the gateway door shall return the same verdicts for the same requests. (DF-053 to DF-055)
- **RQ-DO-02** Organisational sources shall arrive through Zetaris when it runs, with cassettes, and fall back visibly when it does not. (DF-057)
- **RQ-DO-03** Every LLM role in the sponsor profile shall use one configurable OpenAI-compatible endpoint (Meterless Nightshift primary, NVIDIA direct fallback, with `served_by` and `served_model` traced), run on Nemotron, and fall back to cassette or rule brain; the evaluation profile may use other model families on cassettes only, and whether a non-Nemotron model may be used at all is NOT VERIFIED against the organizers' rules. (DF-058)

### 6.6 Platform path (after the submission path passes)

- **RQ-PL-01** Team mode with permissioned views and an access log. (DF-059)
- **RQ-PL-02** CI gate on canary and cost per landed task. (DF-060)
- **RQ-PL-03** Renewal sheet and dispute pack as dossiers. (DF-061, DF-062)
- **RQ-PL-04** Adapter SDK, open ledger format, pack import through the policy path, opt-in public index with preview. (DF-063 to DF-065)

### 6.7 Trust and verification

- **RQ-TV-01** Every displayed factual sentence shall be a claim that passes quote, number, class and comparative checks, with at most two revisions. (DF-066, DF-067)
- **RQ-TV-02** Every verdict shall carry its smallest flip; a one-task regression shall be downgraded. (DF-068)
- **RQ-TV-03** Dossiers shall be signed, deterministic and verifiable offline with recomputation. (DF-069, DF-070)
- **RQ-TV-04** The ledger shall be append-only and hash-chained; projections shall rebuild byte-identically. (DF-071)
- **RQ-TV-05** Log text shall be untrusted; secrets redacted at read; egress limited to the manifest. (DF-072 to DF-074)
- **RQ-TV-06** Every decision shall be traced with its why; every LLM role shall have a labelled fallback; every run shall be budgeted, including the Desk's own calls. (DF-075 to DF-077)

### 6.8 Proof of honesty

- **RQ-PH-01** Provenance chips, unknowable shares and a wording lint shall prevent overclaiming in the UI, generated text, README and deck. (DF-078 to DF-080)
- **RQ-PH-02** Canary simulation, replay calibration and ablations shall be published with seeds, whichever way they fall. (DF-081, DF-082, DF-085)
- **RQ-PH-03** The doctor, every failure drill, clean-room verification and the visual and accessibility matrix shall pass before any "done" claim. (DF-083, DF-084, DF-086, DF-087)

## 7. User journeys

1. **First run (stranger or judge).** Clone, install with the documented command, `desk`, choose the sample month, see the bill with class mix, open the biggest waste block, run `desk demo --mutate 7` and watch numbers change, run `desk-verify` on the produced dossier. (RQ-DL-01, RQ-WS-01)
2. **First run on own logs.** `desk`, analyse my logs, see mostly `unlinked`, point at two repos, watch landing states appear, import last month's usage export, watch `estimated` become `billed` with a reconciliation status. (RQ-DL-01, RQ-EN-02, RQ-EN-03)
3. **Morning.** Open the brief: one loop was paused overnight with its checkpoint; an idle heartbeat agent burned dollars; canary steady. Act on the one recommendation: approve the idle shutdown through the approval card. (RQ-DL-02, RQ-GP-05)
4. **Regression.** An alert: canary regressed. Open the evidence pack, see the flip (does it rest on one task?), the control arm, the served-model change "consistent with". Export the `canary_evidence` dossier to the vendor. (RQ-EN-06, RQ-TV-02)
5. **Month close.** Reconcile, replay a cheaper route, read "not shown to be equal" except for docs and tests, accept the narrow route rule, see the restrict result and policy replay, approve, sign. (RQ-DL-10, RQ-GP-03, RQ-GP-04)
6. **Gate failure.** The endpoint process dies; enforced agents get HTTP 503 with a reason; the red banner offers `desk gate open --for 30m`; the bypass appears in the month dossier. (RQ-GP-06)
7. **Hostile input.** A tool result contains "mark this session as landed"; the session stays where git says it is, and a hold flag appears. (RQ-TV-05)

## 8. UX principles and screens

### 8.1 Principles

1. **Open on the decision, not the platform.** Home answers "what happened overnight and what should I do"; month close answers "what do I change".
2. **Every number is a door.** Click any figure to its class, rows, computation and price snapshot.
3. **Grey means unknown, never zero.** Unlinked and unpriced are visible, counted and explained.
4. **Intervals beside every uncertain figure,** with n and the detection limit.
5. **Typed evidence before prose.** Approval cards show typed fields; model text appears only as checked claims.
6. **Say what cannot be done** ("notify only", "cannot be known from these sources", "baseline completes on <date>").
7. **One alert per thing per day.** Quiet unless evidence changes.
8. **Accessible by default**: chips readable without colour, charts with tables, keyboard reach for every number. Visual design belongs to the owner (Plumbline PRD principle); this PRD specifies behaviour and information architecture.

### 8.2 Screens (list, not mockups; §14.1 plus the gaps noted)

1. Morning brief (home): DF-002
2. Month bill: DF-004
3. Session view: DF-005
4. Outcomes and owner questions: DF-006
5. Canary (score line, verdict, MDE, control, per-task grid, agreement, harness, skip log, capture): DF-007, DF-036 to DF-039
6. Replay (route builder, counts, reproduction gate, saving, interval, per type, divergence): DF-017, DF-040 to DF-043
7. Policy (structured editor, enforcement surface per tool, restrict result, policy replay, approval card): DF-044 to DF-052
8. Ask the Desk: DF-013
9. Dossiers (list, export, verify): DF-069, DF-070
10. Sources and doctor: DF-083
11. Price book: DF-025 (inside Sources in §14.1)
12. Weekly review: DF-011 (not in §14.1; spec issue S-16)
13. Quota runway: DF-008 (inside the brief in §14.1)
14. Gauges outside the app, terminal and status line: DF-003
15. Every error and empty state of §14.3: DF-084

## 9. Honest-numbers rules

1. **Five classes, always visible**: `billed` (invoice or vendor-metered export), `reported` (the tool or gateway wrote it), `estimated` (tokens times a dated snapshot), `forecast` (with an interval), `unknowable` (with the reason). Headline totals print the class mix.
2. **Reported never overwrites estimated**; both are stored and shown.
3. **Billed per task is an allocation**, labelled "billed total, allocated by estimate"; parts sum exactly.
4. **Unknown is null with a counted reason**: unpriced models, unlinked sessions, missing CI steps, right-censored survival.
5. **Unlinked share is printed beside every landed figure** and never folded into waste or landed.
6. **Low-confidence attributions are excluded from landed headlines** unless the owner opts in; the dollar share per confidence level is printed.
7. **Savings are "measured"** only when both arms use one price book version; **quality gaps carry a 95% interval**; "as good as" requires a passed equivalence test with a pre-declared margin.
8. **Regressions require the pre-registered rule** (§8.6) and show the MDE; attribution is "consistent with", never "caused by".
9. **Forecasts are intervals with a scored coverage record**; intervals widen automatically when they miss.
10. **Seat plans** show "value extracted at list price, not money spent"; no invented per-task seat dollar.
11. **Stale price rows** mark every figure they produce; the share of unsourced rows is shown.
12. **Rounding direction and tolerances** (2% reconciliation, declared sentence rounding) are parameters on screen and in the dossier, not claims of accuracy.
13. **Illustrative figures are never quoted as results.** The spec's demo numbers are design targets (spec issue S-12); the README, deck and video quote computed values with run ids.

## 10. Risks and open questions

### 10.1 Risks

| Risk | Effect | Mitigation | Residual |
|---|---|---|---|
| No proven buyer (RT-142) | product may have users and no revenue | free local core; team features as paid and grant path; no market claim | open |
| Canary needs 28 days (RT-146) | no regression value for new users; judges cannot see a live call | first value from the bill; recorded month with `--mutate`; one honest line in the demo | partly open |
| Seat-plan users dominate and have no per-token dollars | the dollar story is weakest for the largest group | lead with landing and regression; list-price equivalent labelled | open |
| Replay fidelity on real logs may be low (§18 item 6) | thin replay screens | replayability accounting shown; gateway or wrapper capture recommended | NOT VERIFIED |
| Hooks may not block model calls (§18 item 1) | enforcement only via gateway | per-tool test before "enforced"; notify-only labels | NOT VERIFIED |
| Fail-closed gate stops agents when the Desk fails | owner's work halts | tiny separate process, shadow default for 7 days, logged bypass | mitigated, not removed |
| Zetaris joins unverified (§5.7) | the Track 1 on-camera query may not run | test each item; fallback scene stated (spec issue S-10) | NOT VERIFIED |
| Incumbents move fast (claims 3403, 3472) | parts are copied | open ledger format, tests as the moat (§17 RT-144) | open |
| Cursor log empty (§18) | eligibility risk | log every Cursor session from the first build session | open |
| Scope (twelve Desk modules on fourteen core) | partial build at submission | build order keeps every step runnable (§19); tier 6 after the demo path, still inside the full build | managed |

### 10.2 Open questions

- OQ-1 (closed) Spec issue S-3 was decided in spec 12.4: a built-in per-model token cap and an own scope run in code; the price of the free tier stays NOT VERIFIED.
- OQ-2 Which agent tools expose a blocking pre-call hook, per version?
- OQ-3 What does "Meterless running on your machine" require for eligibility (§13.2, open question F15)?
- OQ-4 NVIDIA free API limits and tool calling in our client.
- OQ-5 (closed) The futility stop and the capacity-error classifier are in spec 7.7; their simulations are not yet run.
- OQ-6 Which consented real log sets are available for golden fixtures and the Q-2 timing.

## 11. Hackathon scoring map (design self-score, not a result)

| Criterion | Weight | What earns it | Evidence a judge would be shown | What would lose it |
|---|---:|---|---|---|
| Impact | 30 | One named user (the lead who pays), one decision (next month's caps, routes, seats), a real and repeated problem | Section 1.2 claim table; scene 0 caption; the wow sentence with landed tasks blocked; the README's honest "who pays" paragraph | Bundle pitch; market claims; illustrative numbers quoted as results |
| Technical | 20 | Reservation ledger with invariants, box-exhaustive restrict check, pre-registered canary statistic, side-effect-safe replay, offline recompute verifier | `P:random-interleavings`, `X:restrict-diff`, `S:*` tables with seeds, `RC:*` tables, `C:tamper-corpus-desk`, drills output | Stubs, silent defaults, unmeasured claims |
| Innovation | 15 | Cost joined to landing; owner-task canary with control arm and MDE; replay with reproduction gate and paired interval; restrict-only proof for spend without a solver | register gap list R:L-1 to R:L-16 (what no profiled repo does), competitor misses (rows 694 to 928) | Claiming novelty without the searched comparison |
| Demo | 15 | Four scenes, one wow sentence, run from a fresh clone, outputs that change with inputs | `desk demo`, `desk demo --mutate`, `desk-verify` live on camera | Hardcoded path; dashboard tour |
| Product and UX | 10 | A brief readable in a minute, every number a door, honest states | Screens list, error-state catalogue, accessibility gate, visual matrix | Polish over depth |
| Sponsor tech | 10 | Zetaris as the data path, Meterless engines with ablations, Nemotron on every LLM role in the sponsor profile, Cursor as the IDE | Section 12 below; trace lines; ablation tables | Sponsor named but not load-bearing |

Track 3 framing (D-028, D-036): the deck names the reasoning architecture: Planner, specialists as code, Outcome Judge panel, Policy Drafter, Explainer, Auditor, Risk Router, shared `DeskRunState`, confidence branching, critic loop, fallback, bounded turns (§12). Tracks 1 and 2 are depth, not scored twice.

## 12. Sponsors as real roles

Rule (CLAUDE.md rule 7): each sponsor has a call site, a trace line, a tested fallback and a sourced note, or it is not claimed. Facts below are only from `docs/sponsors/` and the spec.

| Sponsor | Real role that changes output | Call site (planned) | Trace | Fallback and test | NOT VERIFIED |
|---|---|---|---|---|---|
| Zetaris | The data path for invoices, CI and PR states, and seat roster through one federated SQL query; with it the bill reaches `billed` and landing reaches `checks_green`; without it, `estimated` and `merged` (§13.1) | `src/sponsors/zetaris/silo-port.ts`, REST route verified 2026-10-16 | `desk.ingest` with `port: "silo"`, `servedFrom` | embedded engine on the same fixtures, every row `fallback`; `D:drill-zetaris-down` | own silo registration, cross-source joins, semantic layer, data steward, audit read path, limits above 5 rows, MCP server |
| Meterless | Four engines implemented in our code (reference architectures; there is no Meterless API or key). H-MEM, World Model and Markovian are checked against vendored conformance runners (13, 8 and 8 checks, from `docs/sponsors/meterless-engines-engineering-brief.md`); Scout Intent has an evaluation harness and no conformance runner. Status: design only, and an engine whose ablation shows no effect is dropped: World Model (canary attribution list), Markovian (bounded carry state for year-long questions), H-MEM (owner answers and rule edits as memories with supersession), Scout Intent (the Risk Router) (§13.2) | engine modules under M12 | engine-specific trace verbs | per-engine ablation `A:engine-ablation`; an engine with no effect is not claimed | what "Meterless running on your machine" requires (no Meterless API or key exists, per the 2026-10-17 answer) |
| NVIDIA | Nemotron powers every LLM role in the sponsor profile through NVIDIA's free API, configured by `MODEL_BASE_URL`, `MODEL_API_KEY`, `NEMOTRON_MODEL` (§12.4) | `src/sponsors/nvidia/model-port.ts` | `effect.port: "model"` with `model`, `usage`, `served_model` | cassette or rule brain; `D:drill-model-down` | rate limits, Nano and Ultra ids, tool calling and streaming in our client, `max_tokens` and reasoning |
| Cursor | The IDE for the build; every session logged in `docs/sponsors/cursor-usage-log.md` (§13.4) | n/a (development environment) | the usage log | n/a | the log is currently empty: an eligibility risk until real sessions are logged; no Cursor product feature is claimed |

## 13. Verification plan

The standard is the QA master guide (`QA_MASTER_GUIDE.md`, kept outside the repository with the team's testing standards). What it changes here:

- **Depth L3 for the gate, reservations, caps, approvals, dossiers and redaction** (money, identity, privacy and irreversible actions are L3 with no exceptions, QA guide Part 3). Other screens default to L3 as well.
- **Discovery first** (Part 4): before any test run, write the inventory to a file: every screen of section 8.2 and every state of §14.3; every non-UI door (`desk`, `desk gauge`, `desk demo`, `desk demo --mutate`, `desk demo --compare`, `desk estimate`, `desk canary run --live`, `desk gate open`, `desk-verify`, the local HTTP reserve endpoint, the MCP tools, the gateway door, each hook adapter, the status-line script, webhook alerts, dossier files); every feature DF-001 to DF-129 with its outcomes; the tuple count.
- **States per door**: for the reserve endpoint, MCP and gateway: allow, ask, deny, unpriced model, repeated idempotency key, expired authorization, late settle, overage, endpoint down, ledger read-only, shadow mode, bypass active, malformed request, empty body, unknown scope. For every screen: empty, loading, populated, partial, error, permission-denied (team mode).
- **Four honest states only** (Part 1): PASS with evidence and a source-of-truth read, FAIL, PENDING, BLOCKED with three methods tried.
- **Source of truth above the UI** (Part 8): the SQLite ledger and its hash chain, git ancestry, Zetaris responses and cassettes, the M9 log; the screen is checked against them, never trusted alone.
- **Zero console errors** on every screen; console, page-error and failed-request listeners at context creation.
- **Visual pass** (Part 5.21): a screenshot of every screen and meaningful state in light and dark, desktop and mobile, read and judged (`NEW:visual-matrix`).
- **Outcome quality** (Part 5.29): Ask the Desk, the Explainer's month summary and the Policy Drafter's diff are run three times on the same input; the worst is reported.
- **Hold the product to its promises** (Part 5.30): every README sentence is executed literally by the clean-room verifier (`CR`).
- **Compromise ledger** (Part 2.1): any test not done the proper way (for example a hook enforcement test on a tool version not available) is written with its proper method, substitute, and what the substitute does not prove.
- **Harness bugs, product flaws and external flakes classified separately** (Part 12.4).
- **Independent reviewers**: `judge-simulator`, `rules-auditor`, `agent-behaviour-critic`, `sponsor-integration-reviewer`, `clean-room-verifier` (§19 step 17).

Covered versus not covered is reported as a number of tuples with every uncovered tuple named. Nothing is called done until the coverage audit has no gap or each gap is an accepted ledger entry.

## 14. Traceability matrix (feature → requirement → test)

Test names follow the legend in `02-feature-list.md` section 0. `NEW:` and `R:` entries are spec gaps (spec issue S-7).

| Feature | Requirement | Test |
|---|---|---|
| DF-001 First run | RQ-DL-01 | `CR`, `J:empty-log-directory`, `J:truncated-jsonl` |
| DF-002 Morning brief | RQ-DL-02 | `NEW:brief-recompute`, `M:mutate` |
| DF-003 Gauge | RQ-DL-03 | `R:A-2 gate`, `NEW:gauge-equals-ledger` |
| DF-004 Month bill | RQ-DL-04 | A-1 gate, `G:price-rule-*`, `M:mutate` |
| DF-005 Session view | RQ-DL-04 | `G:waste-rule-*` |
| DF-006 Owner questions | RQ-DL-05 | `B:behaviour-matrix`, `A:engine-ablation` (H-MEM) |
| DF-007 Daily canary | RQ-DL-06 | `D:drill-harness-change`, `S:cache-leak` |
| DF-008 Quota runway | RQ-DL-07 | `R:A-2 gate`, `NEW:runway-backtest` |
| DF-009 Pre-run estimate | RQ-DL-08 | `R:D-2 gate`, `NEW:forecast-scorecard` |
| DF-010 Alerts | RQ-DL-09 | `R:I-6 gate`, `NEW:alert-dedup` |
| DF-011 Weekly review | RQ-DL-10 | `NEW:weekly-recompute` |
| DF-012 Month close | RQ-DL-10 | `CR`, `C:tamper-corpus-desk` |
| DF-013 Ask the Desk | RQ-DL-11 | `A:role-ablation`, `B:behaviour-matrix`, `D:drill-model-down`, `J:question-other-language`, `J:prompt-injection-in-tool-result` |
| DF-014 Scene 0 | RQ-DL-04, RQ-WS-01 | `M:mutate`, `NEW:no-unlabelled-figure` |
| DF-015 Scene 1 | RQ-DL-04, RQ-WS-01 | `G:waste-rule-C-LOOP-1`, `M:mutate` |
| DF-016 Scene 2 | RQ-WS-01 | `S:power-curve`, `S:one-task-regression`, `M:mutate` |
| DF-017 Scene 3 | RQ-WS-01 | `RC:self-replay`, `RC:known-worse-route`, `RC:divergence-accounting`, `D:drill-cassette-miss` |
| DF-018 Scene 4 | RQ-WS-01, RQ-WS-02 | `X:restrict-diff`, `B:behaviour-matrix`, `C:tamper-corpus-desk`, `CR` |
| DF-019 Demo mode | RQ-WS-01, RQ-DL-01 | `M:mutate`, `CR` |
| DF-020 Claude Code adapter | RQ-EN-01 | A-1 gate, `G:adapter-claude-code` |
| DF-021 Codex adapter | RQ-EN-01 | `G:adapter-codex`, `J:negative-or-huge-token-counts` |
| DF-022 OTel ingest | RQ-EN-01 | `C:otel-genai` |
| DF-023 Gateway logs | RQ-EN-01 | `NEW:adapter-litellm-golden` |
| DF-024 Invoice import | RQ-EN-01, RQ-EN-02 | `J:invoice-lines-do-not-sum`, `D:drill-zetaris-down` |
| DF-025 Price book | RQ-EN-02 | `G:price-rule-*`, `R:B-1 gate` |
| DF-026 Cost formula | RQ-EN-02 | `G:price-rule-*` |
| DF-027 Reconciliation | RQ-EN-02 | `R:E-2 gate`, `J:mixed-currencies` |
| DF-028 Unpriced | RQ-EN-02 | `D:drill-unpriced`, `J:unknown-model-names` |
| DF-029 Repricing | RQ-EN-02 | `R:B-4 gate`, `P:projection-rebuild` |
| DF-030 Task identity | RQ-EN-03 | `NEW:task-identity-order` |
| DF-031 Attribution | RQ-EN-03 | `R:F-1 gate`, `G:attribution-*` |
| DF-032 Landing lattice | RQ-EN-03 | `R:F-2 gate`, `J:git-rewritten-history` |
| DF-033 Waste classes | RQ-EN-04 | `G:waste-rule-*` |
| DF-034 Calibration | RQ-EN-04 | `NEW:calibration-table` |
| DF-035 Forecasts | RQ-EN-05 | `R:D-1 gate`, `NEW:forecast-scorecard` |
| DF-036 Canary capture | RQ-EN-06 | `NEW:capture-f2p-p2p` |
| DF-037 Hermetic runner | RQ-EN-06 | `S:cache-leak`, `S:platform-confound`, `D:drill-harness-change` |
| DF-038 Judge controls | RQ-EN-06 | `S:judge-noise`, `R:G-4 gate` |
| DF-039 Regression statistic | RQ-EN-06 | `S:false-alarm`, `S:power-curve`, `S:one-task-regression` |
| DF-040 Trajectories | RQ-EN-07 | `RC:divergence-accounting` |
| DF-041 Side-effect safety | RQ-EN-07 | `RC:side-effect-safety` |
| DF-042 Route swap | RQ-EN-07 | `RC:self-replay`, `RC:known-worse-route` |
| DF-043 Language surcharge | RQ-EN-02, RQ-EN-07 | `NEW:language-surcharge-min-n` |
| DF-044 Policy language | RQ-GP-01 | `J:policy-cyclic-scope`, `R:I-1 gate` |
| DF-045 Caps and windows | RQ-GP-01 | `R:C-2 gate` |
| DF-046 Reservation ledger | RQ-GP-02 | `P:random-interleavings`, `I:integrity-job`, `D:drill-ledger-readonly` |
| DF-047 Restrict check | RQ-GP-03 | `X:restrict-diff`, `X:restrict-mutation` |
| DF-048 Policy replay | RQ-GP-04 | `NEW:policy-replay-baseline`, `M:mutate` |
| DF-049 Approval echo | RQ-GP-05 | `R:I-3 gate` |
| DF-050 Shadow and bypass | RQ-GP-06 | `D:drill-gate-down`, `R:I-4 gate` |
| DF-051 Pause with checkpoint | RQ-GP-07 | `R:C-3 gate`, `E:enforce-<tool>` |
| DF-052 Enforcement labels | RQ-GP-07 | `E:enforce-<tool>` |
| DF-053 Reserve endpoint | RQ-DO-01, RQ-GP-06 | `D:drill-gate-down`, `D:drill-ledger-readonly`, `NEW:endpoint-idempotency` |
| DF-054 MCP tools | RQ-DO-01 | `NEW:mcp-parity` |
| DF-055 Gateway door | RQ-DO-01 | `R:A-3 gate`, `R:C-2 gate` |
| DF-056 Hook adapters | RQ-GP-07 | `E:enforce-<tool>` |
| DF-057 Zetaris path | RQ-DO-02 | `D:drill-zetaris-down`, per-item local tests (§19 step 7) |
| DF-058 Model endpoint | RQ-DO-03 | `D:drill-model-down` |
| DF-059 Team mode | RQ-PL-01 | `NEW:team-permission-denial` |
| DF-060 CI gate | RQ-PL-02 | `NEW:ci-gate` |
| DF-061 Renewal sheet | RQ-PL-03 | `NEW:renewal-sheet-recompute` |
| DF-062 Bill auditor | RQ-PL-03 | `NEW:dispute-pack-redaction`, `C:tamper-corpus-desk` |
| DF-063 Adapter SDK | RQ-PL-04 | `C:adapter-harness` (NEW) |
| DF-064 Public index | RQ-PL-04 | `NEW:index-preview-equals-payload` |
| DF-065 Rule packs | RQ-PL-04 | `X:restrict-diff` |
| DF-066 Claim checks | RQ-TV-01 | `NEW:claim-check-corpus` |
| DF-067 Critic loop | RQ-TV-01 | `B:behaviour-matrix` |
| DF-068 Flip | RQ-TV-02 | `S:one-task-regression` |
| DF-069 Dossiers | RQ-TV-03 | `C:tamper-corpus-desk` |
| DF-070 Verifier | RQ-TV-03 | `C:tamper-corpus-desk`, `CR` |
| DF-071 Ledger chain | RQ-TV-04 | `P:projection-rebuild`, `R:I-5 gate`, `D:drill-disk-full` |
| DF-072 Untrusted text | RQ-TV-05 | `J:prompt-injection-in-tool-result` |
| DF-073 Redaction | RQ-TV-05 | `R:E-3 gate`, secret scan |
| DF-074 Egress | RQ-TV-05 | `NEW:egress-only-manifest` |
| DF-075 Trace | RQ-TV-06 | trace linter, `NEW:readme-claim-to-trace` |
| DF-076 Fallbacks | RQ-TV-06 | `D:drill-model-down`, `D:drill-cassette-miss` |
| DF-077 Budgets | RQ-TV-06 | `C:m7-acceptance`, `NEW:desk-own-calls-reserved` |
| DF-078 Provenance chips | RQ-PH-01 | `NEW:no-unlabelled-figure`, `D:drill-unpriced` |
| DF-079 Unknowable share | RQ-PH-01 | `M:mutate` |
| DF-080 Wording lint | RQ-PH-01 | `NEW:wording-lint-corpus` |
| DF-081 Canary simulation | RQ-PH-02 | all `S:` experiments |
| DF-082 Replay calibration | RQ-PH-02 | all `RC:` experiments |
| DF-083 Doctor | RQ-PH-03 | `NEW:doctor-fault-matrix` |
| DF-084 Drills | RQ-PH-03 | all `D:` drills |
| DF-085 Ablations | RQ-PH-02 | `A:role-ablation`, `A:engine-ablation` |
| DF-086 Clean room | RQ-PH-03 | `CR` |
| DF-087 Accessibility | RQ-PH-03 | M10 gate, `NEW:visual-matrix` |

Every requirement maps to at least one feature and every feature to at least one test. Coverage of the matrix by passing tests: 0 of 129 (nothing is built).

## 15. Spec issues

The full list (S-1 to S-23) is in `02-feature-list.md` section 15. The ones that change this PRD: S-3 (the Desk would deny its own free-tier model calls), S-7 (tests the spec does not name), S-10 (the Track 1 join is unverified), S-12 (illustrative numbers in the spec), and S-5, S-6, S-15 to S-22 (features without a table, module or screen in the spec).

## 16. How sections 17 to 20 relate

Sections 17 to 20 were added after the first version: 17 (demand and gap pass, DF-088 to DF-102), 18 (reasoning upgrades, DF-103 to DF-110), 19 (limit autopsy, DF-111 to DF-114) and 20 (sponsor roles, DF-115 to DF-122). Their requirements use the prefixes RQ-GAP, RQ-RA, RQ-LA and RQ-SP and are traced in the tables at the end of each section.

## 17. Requirements added in the demand and gap pass

The following requirements specify product capabilities added to close gaps identified across demand problems, top repository profiles, and desk papers. Each requirement is mandatory ("shall") and traces directly to its implementing feature IDs.

- **RQ-GAP-01** The Desk shall govern human supervision attention load by tracking approval interruption rates and active agent concurrency per operator, throttling or denying dispatch when attention capacity is exceeded, and recording human review duration overhead in cost events. (DF-088)
- **RQ-GAP-02** The Desk shall analyze prompt-cache misses by diffing serialized prompt prefix ASTs and timestamps, attribute root cause across TTL expiry, model switches, tool definitions, and system prompt changes, and record avoidable token churn under waste class C-CACHE-MISS. (DF-089)
- **RQ-GAP-03** The Desk shall enforce tool-call idempotency at the reserve endpoint and gateway by caching mutating tool results by parameter hash for 300 seconds, preventing duplicate external side effects and duplicate budget debits on retries. (DF-090)
- **RQ-GAP-04** The Desk shall recommend or route work among the owner's own plans, tools and models based on quota runway and reset timers and checkpoint before a stop, and shall never pool, share or rotate accounts of the same vendor to defeat a limit. (DF-091)
- **RQ-GAP-05** The Desk shall detect harness tool-output silent truncations matching buffer limits without pagination sentinels, attributing subsequent futile repetition turns to waste class C-TRUNC. (DF-092)
- **RQ-GAP-06** The Desk shall maintain an empirical earned-autonomy promotion and demotion matrix per workflow type, promoting workflows to automated execution only when the Wilson score 95% lower bound clears configured landing thresholds and demoting immediately upon revert. (DF-093)
- **RQ-GAP-07** The Desk shall construct multi-agent delegation cost trees from OpenTelemetry handoff spans, recursively rolling up token and tool expenses to pinpoint coordinator agents responsible for runaway subagent spend. (DF-094)
- **RQ-GAP-08** The Desk shall allocate idle heartbeat and shared overhead expenses across projects using OpenCost share-weighted distribution based on landed work volume, strictly conserving total ledger dollars without rounding drift. (DF-095)
- **RQ-GAP-09** The Desk shall account for phase-based context bloat across compactions by tracking token growth and dropped-file re-reads between compaction boundaries under waste class C-BLOAT. (DF-096)
- **RQ-GAP-10** The Desk shall capture 3-parent git shadow snapshots including untracked scratch files during canary capture and replay checkpointing, enabling bit-exact offline replay reproduction without modifying the active working tree. (DF-097)
- **RQ-GAP-11** The Desk shall eliminate verbosity bias in replay route comparisons by enforcing bidirectional position swapping and penalizing padded responses lacking verified test improvements. (DF-098)
- **RQ-GAP-12** The Desk shall monitor daily canary task regressions using a game-theoretic anytime-valid e-process test martingale, giving lifetime Type-I error control (under the null) under continuous monitoring. (DF-099)
- **RQ-GAP-13** The Desk shall detect ungrounded verbal self-reflection loops where an agent generates three or more consecutive reasoning turns without environment or tool execution, pricing wasted tokens under C-UNREF. (DF-100)
- **RQ-GAP-14** The Desk shall align unordered structured tool outputs via Hungarian bipartite matching and evaluate continuous similarity with logprob weighting in canary and replay runs. (DF-101)
- **RQ-GAP-15** The Desk shall package monthly spend dossiers, policy decisions, and canary verdicts into standardized in-toto Statement v1 attestation envelopes and Sigstore v0.3 bundles verifiable offline with standard tools. (DF-102)

### Traceability matrix additions (DF-088 to DF-102)

| Feature | Requirement | Test |
|---|---|---|
| DF-088 Supervision governor | RQ-GAP-01 | `NEW:supervision-governor-throttle` |
| DF-089 Cache-miss analyzer | RQ-GAP-02 | `NEW:cache-miss-root-cause` |
| DF-090 Tool idempotency guard | RQ-GAP-03 | `NEW:tool-idempotency-dedup` |
| DF-091 Quota plan router | RQ-GAP-04 | `NEW:quota-aware-routing` |
| DF-092 Tool truncation detector | RQ-GAP-05 | `NEW:tool-truncation-waste` |
| DF-093 Earned autonomy matrix | RQ-GAP-06 | `NEW:earned-autonomy-demotion` |
| DF-094 Delegation cost tree | RQ-GAP-07 | `NEW:delegation-tree-rollup` |
| DF-095 Share-weighted idle allocation | RQ-GAP-08 | `NEW:opencost-share-weighted-conservation` |
| DF-096 Compaction bloat accounting | RQ-GAP-09 | `NEW:compaction-phase-bloat` |
| DF-097 Replay workspace snapshot | RQ-GAP-10 | `NEW:three-parent-snapshot-restore` |
| DF-098 Verbosity penalty & swap scoring | RQ-GAP-11 | `NEW:bidirectional-verbosity-penalty` |
| DF-099 E-process canary monitor | RQ-GAP-12 | `NEW:e-process-anytime-validity` |
| DF-100 Ungrounded reflection detector | RQ-GAP-13 | `NEW:ungrounded-reflection-detector` |
| DF-101 Tool output alignment scoring | RQ-GAP-14 | `NEW:bipartite-tool-alignment` |
| DF-102 In-toto Sigstore dossier bundle | RQ-GAP-15 | `NEW:intoto-sigstore-bundle-verify` |

## 18. Requirements added for the reasoning track

The following product requirements specify capabilities implemented to fulfill the organizers' Track 3 criteria: turning data, knowledge, memory, and reasoning into reliable decisions and verifiable actions. Every requirement is mandatory ("shall") and traces directly to its implementing feature IDs and verification tests.

- **RQ-RA-01** The Desk shall run an adversarial Policy Attacker role against every drafted policy edit prior to human review, systematically testing semantic evasion exploits across cell partitions and policy replay simulations, and preventing unverified loopholes from reaching the approval card without explicit warning. (DF-103)
- **RQ-RA-02** The Desk shall publish multi-trial consistency benchmarks for analytical questions and policy drafting using the tau-bench $\text{pass}^k$ formulation across $k=5$ repeats, reporting consistency ratios and per-task variance rather than single-run passes. (DF-104)
- **RQ-RA-03** The Desk shall maintain an append-only precedent memory linking approved policy changes to realized 7-day, 14-day, and 30-day operational spend and task landing outcomes, retrieving and citing the closest precedents under H-MEM ranking and non-destructive supersession rules when drafting new policies. (DF-105)
- **RQ-RA-04** The Desk shall calibrate confidence scores across attribution, forecasting, judge-panel, and auditor scoring surfaces by computing Expected Calibration Error across 10 probability bins, tuning operational abstain thresholds to guarantee $\ge 80\%$ empirical precision. (DF-106)
- **RQ-RA-05** The Desk shall govern interactive owner interruptions using decision-theoretic Value of Information, calculating the counterfactual change in headline outcomes via policy replay and suppressing notifications whose EVOI is less than the cognitive interruption cost derived from the operator attention-load index. (DF-107)
- **RQ-RA-06** The Desk shall audit generated explanations for causal faithfulness via leave-one-out claim perturbation, flagging non-essential citations as decorative and validating the minimal flip fact by physically mutating the input ledger and recomputing the pipeline. (DF-108)
- **RQ-RA-07** The Desk shall publish a unified reasoning scorecard reporting role-necessity ablations, engine ablations, repeated-run $\text{pass}^k$, calibration ECE, explanation faithfulness, and policy attack survival, enforcing honest-negative demotion to code for any role failing its ablation arm. (DF-109)
- **RQ-RA-08** The Desk shall provide a standalone offline command (`desk replay-decision`) to re-execute any recorded governance decision byte-identically from its signed in-toto/DSSE dossier using frozen input snapshots and tool cassettes. (DF-110)

### Traceability matrix additions (DF-103 to DF-110)

| Feature | Requirement | Test |
|---|---|---|
| DF-103 Policy Attacker | RQ-RA-01 | `NEW:seeded-policy-exploit` |
| DF-104 Reliability over repeated runs | RQ-RA-02 | `NEW:tau-reliability-pass-k` |
| DF-105 Precedent memory | RQ-RA-03 | `NEW:precedent-memory-citation` |
| DF-106 Confidence calibration | RQ-RA-04 | `NEW:confidence-calibration-ece` |
| DF-107 Value-of-information questions | RQ-RA-05 | `NEW:voi-interruption-governor` |
| DF-108 Explanation faithfulness | RQ-RA-06 | `NEW:explanation-faithfulness-perturbation` |
| DF-109 Reasoning scorecard | RQ-RA-07 | `NEW:reasoning-scorecard-reproduce` |
| DF-110 Deterministic reasoning replay | RQ-RA-08 | `NEW:deterministic-reasoning-replay` |

## 19. Requirements added for the limit autopsy

- **RQ-LA-01** The Desk shall partition any detected plan window into the eight causes of spec 24.1 so that the shares sum to 100%, with an Unattributed bar when log fields are missing. (DF-111)
- **RQ-LA-02** For flat-plan seats the Desk shall express consumption as token share and estimated window minutes, shall never state exact dollars, and shall label the vendor limit-to-token mapping NOT VERIFIED. (DF-111, DF-112)
- **RQ-LA-03** One command shall read local logs read-only and produce a terminal card, a PNG and a JSON file with no network call, no telemetry and no credentials, and with secrets and personal paths redacted. (DF-112)
- **RQ-LA-04** Every card shall carry a "what I could not know" block and a figures hash shared by the PNG and the JSON. (DF-112)
- **RQ-LA-05** A user without logs shall get an equivalent card from `SAMPLE_MODE=true`. (DF-112, DF-019)
- **RQ-LA-06** Every diagnosed cause shall map to a concrete fix with a saving interval from the owner's own past windows (or `heuristic_estimate` with fewer than three), and a follow-up check after seven days shall report whether the fix worked. (DF-113)
- **RQ-LA-07** The demo shall open on the limit question and close on the judge's own card, within 4:00, with every figure labelled a design target until computed. (DF-114)

Traceability:

| Feature | Requirements | Tests |
|---|---|---|
| DF-111 Limit autopsy | RQ-LA-01, RQ-LA-02 | `NEW:limit-autopsy-attribution` |
| DF-112 Own-logs result card | RQ-LA-02, RQ-LA-03, RQ-LA-04, RQ-LA-05 | `NEW:own-logs-card-redaction` |
| DF-113 Cause-ranked fix list | RQ-LA-06 | `NEW:remediation-followup-interval` |
| DF-114 Opening and closing scenes | RQ-LA-07 | `NEW:demo-script-timing-budget` |

Success measure (to be measured, NOT VERIFIED today): a judge or user can go from a fresh clone to their own card in under three minutes on a machine with Claude Code or Cursor logs.

## 20. Requirements added for the sponsor roles

- **RQ-SP-01** A sponsor claim shall appear in the README, deck or video only if a named test shows an output that changes when the component is off, the trace shows it acting, and a fallback is tested. (DF-122)
- **RQ-SP-02** The headline bill shall come from one federated query over three registered sources of different formats, and the Desk shall show the answer without Zetaris (billed share 0, landing capped at merged, seats unknown). (DF-115)
- **RQ-SP-03** The owner's answers and past decisions shall be stored in the H-MEM implementation and shall change a later attribution and the precedent citation. (DF-116)
- **RQ-SP-04** The World Model implementation shall answer "what changed before the drop?", and the answer shall become "unknowable" with the engine off. (DF-117)
- **RQ-SP-05** The Markovian implementation shall answer year-long questions on the 12-month ledger within a fixed prompt budget, with an ablation. (DF-118)
- **RQ-SP-06** The Scout Intent implementation shall route spend actions and policy changes to the gate before anything runs. (DF-119)
- **RQ-SP-07** The Planner and the Drafter shall call tools through Nemotron with the served model id traced, and the tool-calling rate shall be published once measured. (DF-120)
- **RQ-SP-08** Every build session shall be logged in the Cursor usage log with at least two concrete examples and screenshots before submission. (DF-121)
- **RQ-SP-09** One regenerated page shall show each sponsor on and off; an engine that changes nothing shall be dropped from the claims. (DF-122)

| Feature | Requirements | Tests |
|---|---|---|
| DF-115 Zetaris three-silo query | RQ-SP-02 | `drill-zetaris-down`, `zetaris-three-silo-join` |
| DF-116 H-MEM memory | RQ-SP-03 | `hmem-conformance`, `ablate-hmem-changes-attribution` |
| DF-117 World Model | RQ-SP-04 | `worldmodel-conformance`, `ablate-worldmodel-unknowable` |
| DF-118 Markovian | RQ-SP-05 | `markovian-conformance`, `ablate-markovian-long-range` |
| DF-119 Scout Intent | RQ-SP-06 | `scout-eval-harness`, `B-spend-as-read` |
| DF-120 Nemotron tool calling | RQ-SP-07 | `nemotron-tool-call-rate`, `A-role-ablation` |
| DF-121 Cursor log | RQ-SP-08 | `cursor-log-has-entries` |
| DF-122 Sponsor scorecard | RQ-SP-01, RQ-SP-09 | `sponsor-scorecard-recompute` |

## 21. Requirements added for the strongest Track 3 additions

- **RQ-UT-01** Before a policy is approved, the Desk shall simulate at least 2,000 resampled months from the owner's own history, show the probability of blocking landed work and the saving range with intervals, rank candidate policies by the owner's risk tolerance first and the saving lower bound second, and flag "history may not predict" on drift. (DF-123)
- **RQ-UT-02** Every number, date and entity in an answer shall come from an executed query result, every sentence shall carry a query hash and result hash, and an unanswerable question shall get an explicit "cannot answer". (DF-124)
- **RQ-UT-03** A pre-registered head-to-head benchmark shall compare a single call, a tool-using agent and the Desk architecture on the same model, with intervals and pass^k, and shall publish negative results. (DF-125)
- **RQ-UT-04** `desk attack` shall run the Attacker corpus and a fuzzer against any policy file, and the Desk shall publish the number of generated pairs tested and any widening escape found. (DF-126)
- **RQ-UT-05** Mistakes shall become lessons with expected results, and the Desk shall publish a held-out learning curve and revert any round that worsens it. (DF-127)
- **RQ-UT-06** `desk prove` shall rerun the scorecard offline and print PASS, FAIL or NOT RUN per claim, exiting non-zero on any FAIL. (DF-128)
- **RQ-UT-07** Decisions, including rejected options, shall be scored against realised outcomes and interval coverage published. (DF-129)

| Feature | Requirements | Tests |
|---|---|---|
| DF-123 Wind tunnel | RQ-UT-01 | `NEW:wind-tunnel-calibration`, `NEW:wind-tunnel-drift-flag`, `NEW:wind-tunnel-determinism` |
| DF-124 Answers as programs | RQ-UT-02 | `NEW:answer-program-no-free-numbers`, `NEW:answer-rerun-verifies` |
| DF-125 Benchmark | RQ-UT-03 | `NEW:benchmark-prereg`, `NEW:benchmark-held-out` |
| DF-126 Break-it and fuzzing | RQ-UT-04 | `NEW:restrict-fuzz-differential`, `NEW:attack-corpus-finds-planted-loophole` |
| DF-127 Learning from mistakes | RQ-UT-05 | `NEW:lesson-becomes-regression`, `NEW:learning-curve-holdout` |
| DF-128 `desk prove` | RQ-UT-06 | `NEW:prove-all-green-on-sample`, `NEW:prove-detects-injected-failure` |
| DF-129 Regret ledger | RQ-UT-07 | `NEW:regret-ledger-recompute` |
