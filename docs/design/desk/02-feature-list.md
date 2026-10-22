# Desk feature list (v1.0)

Status: design, 2026-10-20. Nothing here is built, run or measured. Every feature is a requirement with a named test; a feature whose test has not passed is not claimed anywhere (README, deck, video). Contract: `00-architecture-master-spec.md` v1.0 (cited `§n`). Sources: `01-adoption-register.md` (cited `R:<id>`), the idea database (`research/idea-hunt/idea-hunt.db`: idea 278 and its 52 feature rows, cited `idea-feature <id>`; claims cited `claim <id>`; red-team rows cited `RT-<id>`), and the Plumbline PRD v3.0 (`../07-product-requirements-and-feature-list.md`) for what the Desk reuses unchanged. Decision basis: D-036 (the Desk is the product direction; Track 3 stays primary). Where this file and the spec disagree, the spec wins and the disagreement is listed in section 15, "Spec issues".

Id note. Desk feature ids are `DF-001` to `DF-129`. The Plumbline PRD v3.0 also uses `DF-001` to `DF-010` for its "doors" tier. The two series are different; inside `docs/design/desk/` an `F-D` id always means this file. The collision is listed in section 15.

## 0. How to read a feature

Each feature carries the same fields:

- **Sees and does**: what the user sees and the action they take.
- **In / Out**: inputs and outputs.
- **Default**: the value or behaviour with no configuration.
- **On failure**: what happens when an input or dependency is bad or absent.
- **Module, tables**: the spec module (`DK1` to `DK12`, core `M1` to `M14`) and the spec section 4 tables it reads or writes.
- **Source**: the register row or profile it copies or adapts, or `new` with the gap it fills (`R:L-n` is the register's gap list).
- **Answers**: the red-team weakness it answers, if any.
- **Test**: the test that proves it, by the spec's test strategy name. Legend:
  - `D:<name>` dependency drill, §16.1 (for example `D:drill-gate-down`).
  - `J:<case>` junk-input fixture, §16.2.
  - `C:<suite>` conformance suite, §16.3.
  - `G:<fixture>` golden fixture, §16.4.
  - `S:<experiment>` canary simulation experiment, §16.5.
  - `RC:<experiment>` replay calibration, §16.6.
  - `M:mutate` the `desk demo --mutate` / `--compare` proof, §16.7.
  - `CR` clean-room verification, §16.8.
  - `P:<property>` ledger property tests, §19 step 2.
  - `X:restrict-diff`, `X:restrict-mutation` the restrict-check tests, §10.4.
  - `I:integrity-job` the five-minute invariant job, §4.5.
  - `E:enforce-<tool>` the per-adapter enforcement test, §10.5 and §10.6.
  - `A:role-ablation`, `A:engine-ablation`, `B:behaviour-matrix` §12.1, §13.2, §12.5.
  - `R:<id> gate` the register row's gate, used only where the spec names no test; each such use is listed in section 15.
  - `NEW:<name>` a test defined in spec 16.10.
- **Tracks**: `TK1` Solving Fragmented Intelligence, `TK2` The Agent That Can Explain Why, `TK3` Reasoning Architecture (the submission track, D-028/D-036). One primary track is judged; the others are depth.

Status of every row: designed, not built.

## 1. The product in one paragraph, and the one wow moment

The Desk is for the person who pays for a team's AI agents and must answer one question each month: **which caps, route rules and seat changes do I apply next month, and on what evidence?** (§1.3). Everything on screen feeds that decision. Three kinds of evidence (the bill tied to landed work, the canary on the owner's own tasks, the replay of last month on a cheaper route) produce one output (an approved policy diff with a signed dossier).

**The one wow moment** is the last beat of the demo, where the three kinds of evidence collapse into one sentence a stranger can check: *"Under the new rules, the held-out month would have paused 4 sessions and not spent $611, and blocked 0 of 212 landed tasks"* (design target), followed by the restrict-only result, the approval, and `desk-verify` printing `PASS` in a fresh terminal (spec 1.4, "The spine answered, out of sample"). It is the thesis of the product made visible: cost joined to outcome ("$611 not spent" is only meaningful next to "0 landed tasks blocked"), and the verified-decision core making the change safe. Scenes 1 to 3 exist to earn that sentence. The figures quoted here are the spec's illustrative targets; the real figures are whatever the run computes (section 15, issue S-12).

Why one product and not a bundle (answers RT-141, RT-180): there is one ledger (§4), one user, one decision, one output. Features that do not feed the decision (seat return, bill auditor, public index) are tier 6, reachable but outside the demo (§17, RT-141).

## 2. The daily-use loop in detail (why the owner opens it every day)

The red team's sharpest point on daily use is that the commonest daily result of a canary is "nothing happened" (claim 980) and seat-plan users have no dollar meter (claim 3396). The loop below is designed around that: the daily open is short and is justified by the **overnight** events (paused sessions, idle agents, a canary watch flag, quota runway), not by a dollar total; the weekly and monthly opens carry the dollar story.

| Rhythm | What the owner opens | Why it is worth opening | Features |
|---|---|---|---|
| Every morning, under a minute | Morning brief (home) | What happened overnight: anything paused or denied by the gate, idle or orphaned agents still burning, the canary card (steady, watch, regressed, not yet eligible, skipped), quota runway per plan, yesterday's spend with its class mix and landed / waste / unlinked split, and exactly one recommended action with its evidence | DF-002, DF-007, DF-008, DF-010 |
| During work, glanceable | Terminal gauge and status line | Spend so far, burn rate, plan window used, projected finish, the per-step split (fresh output, history re-reads, tool results, retries, sub-agents, reasoning); a pre-run estimate before a large task | DF-003, DF-009 |
| When an alert fires | The evidence pack behind it | A loop paused, a cap at 80% asking, a canary verdict changed, a canary not running for 3 days; one alert per suite per day at most | DF-010, DF-005, DF-016 |
| When a question comes up | Ask the Desk | "Why did Thursday cost three times Wednesday?" answered with claim chips and visible Auditor checks | DF-013 |
| Weekly, 10 minutes | Weekly review | Landed versus waste by workflow, forecast scorecard, rule calibration (rules that misfire on the owner's data), owner questions waiting (attribution confirmations), approval-habit metrics | DF-011, DF-034, DF-035, DF-006 |
| Monthly, the decision | Month close | The month bill with reconciliation once the invoice is in, the canary verdicts of the month, replay of a candidate route, the drafted policy diff, restrict check, policy replay, approval, signed dossier | DF-012, DF-004, DF-017, DF-018 |
| Before a renewal (platform tier) | Renewal sheet | Seats and plans against outcomes delivered | DF-061 |

Honest limit: whether owners actually open it daily is NOT VERIFIED (no users yet). Daily use is an inference from usage-monitor activity (report criterion `daily_use` scored 3 of 5). Success measure in the PRD (03, section 5) is defined so it can be measured once people use it.

## 3. The four-minute demo as one thread

The demo runs from a fresh clone, one command, offline, on the recorded **constructed, date-shifted sample** (spec 1.4, 16.7). The video opens on the universal developer question: **"I pay for Claude Code or Cursor, I work for two hours, 'limit reached' appears, and I do not know why — where did my limit go?"** Within five seconds, the local Limit Autopsy answers from logs, setting the single spine that runs to the final frame: **"Does the policy the Desk proposes for next month block work that landed?"** The bill, canary, replay, and fix list are evidence beats that feed it. The demo closes on the judge's own call-to-action: running `desk` on their own logs to get their result card in under 3 minutes. Hard budget 4:00, target 3:50. Timings are targets; the video script owns the final cut. Every figure on screen is a design target until the sample is generated and computed.

| Beat | Time | What is on screen | What it proves | Features |
|---|---|---|---|---|
| Frame: the limit autopsy | 0:00 to 0:15 | Universal hook: "I pay for Claude Code or Cursor, I work for two hours, 'limit reached' appears, and I do not know why". Limit Autopsy shows October's 5-hour window: 44% history re-reads, 21% cache misses, 14% tool output dumps, 9% loops, 7% reasoning, 5% idle. Caption: constructed, date-shifted scenario; built in Cursor; Nemotron; organisational data through Zetaris; Meterless-specified engines; vendor limit mapping NOT VERIFIED | the universal pain point, stack frame, and honesty baseline | DF-014, DF-078, DF-058, DF-111, DF-114 |
| Evidence 1: the bill, through Zetaris | 0:15 to 0:40 | Month headline with the six dollar states summing to 100% and the class mix; the on-camera Zetaris query "spend per landed PR by team" with trace line `servedFrom: live`; the biggest waste block opens | dollars joined to outcomes from git and CI; Zetaris changes the output (billed rows and landing depth) | DF-015, DF-004, DF-005, DF-032, DF-033, DF-057 |
| Evidence 2: the canary | 0:40 to 1:00 | Banner "Induced regression: while recording, we switched the served model behind the endpoint on Wednesday 14 October 2026"; verdict card with the 99% interval, two windows, control arm flat, MDE; "consistent with, not caused by" | regression is a pre-registered statistic on the owner's own tasks | DF-016, DF-039, DF-068 |
| Evidence 3: the replay, one line | 1:00 to 1:10 | cheaper route on the eligible tasks: measured saving; pass-rate difference with a 95% interval, "not shown to be equal"; docs and tests only: interval | a saving is measured, a quality gap carries an interval | DF-017, DF-042, DF-041 |
| The proposal & cause-ranked fixes | 1:10 to 1:40 | the Policy Drafter drafts diff addressing autopsy causes (compact earlier, freeze tool schemas for cache hits, stop idle heartbeat daemons, loop caps, route docs/tests); expected savings intervals shown; restrict check: "checked over all N cells: narrows only" for four rules, route rule flagged with counterexample | the gate reasons over a typed policy, not prose; fixes target verified causes | DF-044, DF-047, DF-018, DF-113 |
| The spine answered, out of sample | 1:40 to 2:15 | the policy drafted from September only is replayed on October (held out): "4 sessions paused, $611 not spent, 0 of 212 landed tasks blocked" (design target), with the in-sample line shown smaller beneath | cost joined to outcome, tested on data the policy never saw | DF-048, DF-018 |
| The Auditor rejects, the Explainer revises | 2:15 to 2:40 | the month summary draft; Auditor rejects "The cheaper route is as good" (`comparative_unsupported`); `critic.score` below the pass mark; `revision.applied`; the revised sentence quotes the interval; on-screen note says whether the draft was natural or a seeded fixture | a real critic loop that changes the output | DF-067, DF-066, DF-013 |
| A Meterless engine changes an answer | 2:40 to 3:00 | "What changed before the canary drop?" with the World Model engine on lists the served-model change; with the engine off (`--ablate world_model`) the answer is "unknowable: no entity history available" | the engine has an output-changing role (design only until its ablation runs) | DF-013, DF-085 |
| Approve | 3:00 to 3:20 | approval card echoes the action digest; the owner approves; the gauge shows the new ceiling; the dossier is signed | approval echo and live ceiling | DF-049, DF-003, DF-069 |
| Verify offline | 3:20 to 3:35 | fresh terminal, network off, `desk-verify` prints `PASS` and lists what PASS does and does not prove | a stranger can check it | DF-070 |
| Close: the judge's own card | 3:35 to 3:50 | "Run it on your own agent logs right now: `desk` (or `desk card`). In under 3 minutes, completely locally: your own limit autopsy card and cause-ranked fixes."; "SAMPLE_MODE=true desk produces the exact same card offline"; "A new regression cannot be called in four minutes: the statistic needs 28 days" | judges feel the product on their own data; honest limits | DF-001, DF-112, DF-114 |

Zetaris fallback beat (written now, used if the Zetaris gate Z-G1 has not passed by recording time): the Sources screen says the silo registration is not yet verified and the bill is shown from local sources only, with the class mix lacking a billed share and landing capped at `merged`.

Deliberately not shown: a live vendor pause on a tool with no hook, a dollar figure called an invoice, a "better model" claim without an interval, a regression presented as natural.

## 4. The first-run path (target: first value in under three minutes)

Target, to be measured: under three minutes from a fresh clone to a first bill on the sample month, and under two minutes of analysis for 30 days of a heavy user's own logs (§14.2; NOT VERIFIED, §18 item 10).

1. `desk` with no arguments. Read-only discovery of local agent logs in the documented paths (§5.2, §5.3), printed with counts per tool and the paths searched. Nothing is written outside `data/desk/`. (DF-001)
2. Two choices: **open the sample month** (`SAMPLE_MODE=true`, no key, no network) or **analyse my logs** (the last 30 days, locally). (DF-001, DF-019)
3. The month bill with the honest class mix and the unlinked share. For own logs, before any repo is pointed at, most dollars are `unlinked`, and the screen says why rather than guessing. (DF-004, DF-079)
4. Three optional steps, each with the value it unlocks stated on the button:
   - point at repositories: raises landing from `unlinked` to `committed`, `merged`, `kept_n_days` (DF-031, DF-032);
   - import an invoice or usage export: raises `estimated` to `billed` (DF-024, DF-027);
   - capture canary tasks: enables regression detection, with the date the baseline completes (day 28 after the pin, §8.6) (DF-036).
5. No account, no key, no telemetry. A model key is needed only for Ask the Desk outside SAMPLE_MODE and for live canary and replay runs; without it the rule brain answers and says so (DF-076).

## 5. Tier 1: the daily loop

### DF-001 First run and source discovery
- **Sees and does**: runs `desk`; sees each detected agent tool, file count, date range, adapter id and its capability declaration; chooses sample month or own logs.
- **In / Out**: default log paths and `CLAUDE_CONFIG_DIR` entries / a source list, `session` rows, a cursor per file.
- **Default**: read-only; last 30 days; tenant `tn_default`.
- **On failure**: no logs found lists every path searched; malformed lines skipped and counted, never fatal; a tool with no adapter is listed as "no adapter" (§5.3).
- **Module, tables**: DK1, DK12; `session`, capability set (§5.1).
- **Source**: R:A-1 (ccusage paths and incremental cursor, CodexBar file stamp), R:A-4 (offline sample).
- **Answers**: report criterion `first_value` (3 of 5).
- **Test**: `CR`; `J:empty-log-directory`; `J:truncated-jsonl`.
- **Tracks**: TK1.

### DF-002 Morning brief
- **Sees and does**: opens the home screen; reads yesterday's spend by project, tool and model with class mix; landed / waste / unlinked; canary card; quota runway per plan; anything paused or denied overnight; one recommended action with its evidence link.
- **In / Out**: ledger projections / one screen, every figure clickable to rows.
- **Default**: yesterday in the owner's local time zone; the action is the single highest "recoverable dollars" finding (§7.4 stop point) or a canary verdict change, whichever exists.
- **On failure**: no data for yesterday says so; a stale source shows its last-success time; no recommendation shown when none clears its evidence rule (never a filler action).
- **Module, tables**: DK12 over DK4; `v_spend_by`, `v_budget_state`, `canary_verdict`, `quota_snapshot`, `decision`.
- **Source**: idea-feature 2432; morning-brief shape is new (no profiled repo has one; R:J-1 for loopback-only serving).
- **Answers**: RT-180 (no daily job); claim 980 (most days nothing happens: the brief leads with overnight events).
- **Test**: `NEW:brief-recompute` (every figure on the brief reproduced by V6-D from the cited rows) and `M:mutate`.
- **Tracks**: TK2.

### DF-003 Live gauge (terminal and status line)
- **Sees and does**: runs `desk gauge` or adds the status-line script; sees spend so far, burn rate, window used, projected finish, and the per-step split.
- **In / Out**: the live log stream (no agent change) / a one-line gauge and a detailed view.
- **Default**: refresh on file change; per-step split uses buckets from §4.2.
- **On failure**: a source without a field shows `—` with the capability reason; an official window read older than 600 s is dropped (§5.2).
- **Module, tables**: DK12 (gauge surface), DK9, DK4; `model_call`, `quota_snapshot`.
- **Source**: idea-feature 2434; R:D-1 (CodexBar pace); P59 official overlay via R:A-2. Menu-bar widget: left out, not in §14.1.
- **Answers**: claim 1187 (no per-task token use shown by a vendor surface).
- **Test**: `R:A-2 gate` (epoch-in-percent payload rejected; stale overlay expires) and `NEW:gauge-equals-ledger`.
- **Tracks**: TK1.

### DF-004 Month bill
- **Sees and does**: opens Month bill; sees the stacked bar by landing state, the waste band by class, the grey unlinked share, cost per landed task, reconciliation status per vendor; drills into sessions.
- **In / Out**: cost events, outcome facts / the bill and an export.
- **Default**: calendar month; headline class order billed, reported, estimated, with the class mix printed ("$X: a% billed, b% reported, c% estimated, d% unpriced", §6.3).
- **On failure**: no invoices means no `billed` class and the screen says what import would change; unpriced calls are counted in a separate figure (never zero).
- **Module, tables**: DK3, DK5, DK12; `cost_estimate`, `billed_line`, `reconciliation`, `landing_state`, `v_spend_by`.
- **Source**: R:B-5 (provenance types), R:F-2 (landing chain), R:J-1 (every number clickable); gap R:L-1 (a dollar tied to a result).
- **Answers**: RT-139 (vendor consoles measure commits, not landing), RT-140.
- **Test**: `R:A-1 gate`/A-1 hand-count fixture (§16.2), `G:price-rule-*`, `M:mutate`.
- **Tracks**: TK1, TK2.

### DF-005 Session view and the waste-block explanation
- **Sees and does**: clicks a waste block; sees the session timeline, the stop point, the failure cascade, the matched rule with parameters, the redacted log lines, the price snapshot per call, and the landing facts that prove no later landing.
- **In / Out**: one session / the explanation, each sentence a claim.
- **Default**: opens at the stop point.
- **On failure**: a cascade through an opaque step is marked confidence low (§7.4 C-CASCADE); missing tool results shown as gaps.
- **Module, tables**: DK5, DK12, M4; `turn`, `model_call`, `tool_call`, `price_snapshot`, `outcome_fact`.
- **Source**: R:C-5 (agent-bisect cascade), R:C-4 (flight recorder stop point).
- **Answers**: none directly; it is the evidence behind scene 1.
- **Test**: `G:waste-rule-*` positive and negative sessions (§16.4, including three legitimate `git status` calls not tripping C-LOOP-1).
- **Tracks**: TK2.

### DF-006 Outcomes screen and the owner-question queue
- **Sees and does**: sees tasks with landing state, attribution method and confidence, the share of tasks per identity method; answers queued questions ("Is commit a1b2 from this session? yes / no / skip").
- **In / Out**: low-confidence attributions, no-majority panels, inconclusive verdicts / owner answers recorded as explicit attributions.
- **Default**: low-confidence attributions excluded from "landed" headlines unless the owner opts in (§7.3).
- **On failure**: skipped questions stay open; an answer never raises a landing state beyond what git, CI or the PR system supports (§15.1).
- **Module, tables**: DK5, DK10, Meterless H-MEM; `task`, `task_session` (method `explicit`), `outcome_fact`.
- **Source**: idea-feature 2423; R:F-1 (Codelens attribution); confidence branching from §12.3.
- **Answers**: RT-145 (outcome verdicts must come from outside the transcript).
- **Test**: `B:behaviour-matrix` (branching on confidence changes an outcome), `A:engine-ablation` for H-MEM (an earlier answer changes next month's attribution).
- **Tracks**: TK3, TK2.

### DF-007 Daily canary run and canary card
- **Sees and does**: sees the canary card on the brief (steady, watch, regressed, improved, inconclusive, harness_or_platform, not yet eligible with the date, skipped with reason); opens the Canary screen.
- **In / Out**: the frozen suite / one `canary_run` per UTC day with samples.
- **Default**: one run per UTC day, retried hourly; 5 repeats per task; control arm 3 tasks by 3 repeats; skip if the plan window is at or above 75% weekly or 60% five-hour, or the canary's own budget would be exceeded (§8.3).
- **On failure**: harness or tool-version change refuses the run and starts a new baseline; a cached response invalidates the run; three skipped days raise "canary not running".
- **Module, tables**: DK6; `canary_suite`, `canary_run`, `canary_sample`, `canary_verdict`.
- **Source**: R:G-2 (promptfoo row shape, livenerf schedule and guards), R:G-1.
- **Answers**: RT-140 (no owner-task canary in Langfuse), RT-144.
- **Test**: `D:drill-harness-change`, `S:cache-leak`.
- **Tracks**: TK3.

### DF-008 Quota runway across plans
- **Sees and does**: one view of every plan's windows (five-hour, seven-day, monthly credits) with used share, reset time, runway at current burn, and source (`official` or `local_estimate`); limit-hit and model-switch events listed.
- **In / Out**: statusline JSON fields when forwarded, local logs, plan rows / `quota_snapshot`, `limit_event`.
- **Default**: vendor-reported windows shown beside local estimates, never merged; undocumented vendor usage endpoints not called (NOT VERIFIED, §5.2).
- **On failure**: no official source means estimate only, labelled; fewer than 3 complete windows means "linear, no history" with no probability (§6.6).
- **Module, tables**: DK9, DK1; `quota_snapshot`, `limit_event`, `plan_row`.
- **Source**: R:A-2 (CodexBar, ccusage blocks, Claude-Code-Usage-Monitor overlay). Absorbs Quota Commons Console (idea 214) and the quota half of Soft Landing (idea 111).
- **Answers**: claims 52, 53, 654, 655 (usage-limit pain); counter-claims 3465 to 3468 (Claude Code exposes quota natively): the Desk's addition is cross-tool and the dollar join.
- **Test**: `R:A-2 gate` and `NEW:runway-backtest` (coverage of the stated range on recorded windows).
- **Tracks**: TK1.

### DF-009 Pre-run estimate
- **Sees and does**: before a task, asks `desk estimate --type <label> --repo <path>` or the MCP tool; sees the 10th, 50th and 90th percentile cost of similar past tasks, the sample size, and the chance of crossing the applicable cap.
- **In / Out**: task type, repo, history / an interval with n, or "no estimate".
- **Default**: fallback chain task type, repo, global, none; 30-day half-life weighting above 5 records; the tail kept (§6.6 item 3).
- **On failure**: fewer than 10 similar tasks gives "no estimate: fewer than 10 similar tasks"; never a point figure.
- **Module, tables**: DK9, DK11 (MCP exposure); forecast rows (see section 15, S-21: the spec defines no forecast table).
- **Source**: R:D-2 (tokencast chain, with its tail deletion rejected). Absorbs Fuel Gauge's forecast (idea 67).
- **Answers**: claims 514, 3107 (30x variance), 3406 (a forecast may be useful only when wide; flagged NOT VERIFIED in the evidence table): the interval and its coverage score are shown, not hidden.
- **Test**: `R:D-2 gate` (a planted loop session stays in calibration; coverage per cohort with n) and `NEW:forecast-scorecard`.
- **Tracks**: TK3.

### DF-010 Alerts on the owner's schedule
- **Sees and does**: receives terminal, desktop or webhook alerts for cap thresholds (warn, ask, 85%, 100%), loop pauses, idle agents, canary verdict changes, canary not running, reconciliation gaps; each links to its evidence.
- **In / Out**: verdicts, decisions, budget states / alert events.
- **Default**: severity states OK, WARNING, ALERT, NO_DATA, PAUSED; first evaluation fires only if unhealthy; identical verdicts suppressed until they change; at most one alert per suite per day; webhook off.
- **On failure**: a paused monitor is never overwritten; webhook delivery failure is logged and retried with a cap, and never blocks the gate.
- **Module, tables**: DK6, DK8, DK12; alert state (no table in §4: section 15, S-15).
- **Source**: R:I-6 (Langfuse monitor state machine), coder notifications (R:C-2).
- **Answers**: none.
- **Test**: `R:I-6 gate` (a skipped canary shows skipped with its reason) and `NEW:alert-dedup`.
- **Tracks**: TK2.

### DF-011 Weekly review
- **Sees and does**: once a week, one page: landed versus waste by workflow, cost per landed task trend, forecast scorecard, rule calibration table, open owner questions, drift and watch events, approval-habit metrics, and up to three suggested changes, each with its measured effect on replays.
- **In / Out**: projections of the week / the page and an export.
- **Default**: ISO week; suggestions only from rules with evidence (calibration, replay, recoverable waste).
- **On failure**: fewer than 7 days of data says so.
- **Module, tables**: DK12 over DK4, DK5, DK9; existing projections.
- **Source**: idea-feature 2444. New as a screen: §14.1 has no weekly screen (section 15, S-16).
- **Answers**: report criterion `daily_use` (owner checks may be weekly).
- **Test**: `NEW:weekly-recompute`.
- **Tracks**: TK2.

### DF-012 Month close and the next-month decision
- **Sees and does**: at month end, a guided close: reconcile invoices, review canary verdicts, run one replay, review the drafted policy diff, approve or reject, sign the month dossier.
- **In / Out**: the month's events / a `month_bill` dossier and, if approved, a `policy_change` dossier.
- **Default**: draft diff produced by the Policy Drafter (or its rule-brain template) from findings with recoverable dollars above a threshold.
- **On failure**: unreconciled vendors are listed as `unreconciled`, never hidden; the close can finish without approval (nothing changes).
- **Module, tables**: DK8, DK10, M9; `policy_version`, `decision`, `dossier`.
- **Source**: the one decision of §1.3; dossier from core M9.
- **Answers**: RT-141 (one decision, one output).
- **Test**: `CR` (the four scenes reproduce), `C:tamper-corpus-desk` (§16.3).
- **Tracks**: TK3, TK2.

### DF-013 Ask the Desk
- **Sees and does**: types a question; sees an answer whose every factual sentence carries claim chips, and a collapsible "how this answer was checked" with Auditor rejections and revisions.
- **In / Out**: a question / an answer, or a partial labelled answer at the budget limit.
- **Default**: 60 s and 8 model calls per question (§12.3); Risk Router sends spend actions and policy changes to the gate, never to execution.
- **On failure**: model down uses the rule brain with templates; an unsupported sentence after two revisions is dropped and the answer says so; a question in another language is handled or refused explicitly (§16.2).
- **Module, tables**: DK10 (Planner, specialists, Explainer, Auditor, Risk Router), Meterless Markovian and World Model; `DeskRunState`.
- **Source**: idea-feature 2443; core M14 roles.
- **Answers**: RT-145 (no free prose without a claim).
- **Test**: `A:role-ablation`, `B:behaviour-matrix`, `D:drill-model-down`, `J:question-other-language`, `J:prompt-injection-in-tool-result`.
- **Tracks**: TK3, TK2.

## 6. Tier 2: the wow scenes

### DF-014 Scene 0: the question
- **Sees and does**: the month headline with class chips and a caption naming the user and the decision; clicks a chip to open its rows.
- **In / Out**: the sample month / the headline.
- **Default**: the sample month in SAMPLE_MODE.
- **On failure**: a figure that cannot be computed shows `unknowable` with the reason.
- **Module, tables**: DK12, DK3; `cost_estimate`, `landing_state`.
- **Source**: §1.4.
- **Answers**: RT-145 (dollars are estimates: the class mix is printed first).
- **Test**: `M:mutate`; `NEW:no-unlabelled-figure` (DOM scan: every rendered dollar has a class chip).
- **Tracks**: TK2.

### DF-015 Scene 1: the bill opens on the biggest waste block
- **Sees and does**: clicks the largest waste block; lands in the session that looped, with the rule and its parameters.
- **In / Out**: the bill / one session view.
- **Default**: blocks ordered by dollars.
- **On failure**: as DF-004 and DF-005.
- **Module, tables**: DK5, DK12; `tool_call`, `cost_estimate`.
- **Source**: idea-features 2446, 1592; R:C-4.
- **Answers**: RT-139 (vendor cost-per-commit tab does not separate waste classes or read landing).
- **Test**: `G:waste-rule-C-LOOP-1`, `M:mutate`.
- **Tracks**: TK2, TK1.

### DF-016 Scene 2: the agent regressed on Wednesday 14 October
- **Sees and does**: sees the canary score line, the verdict banner (delta, 99% interval, two windows, harness unchanged, control flat, error rate), the MDE, cost per passing task, and the attribution line "consistent with, not caused by"; opens the evidence pack.
- **In / Out**: canary samples / `canary_verdict` and a `canary_evidence` dossier.
- **Default**: as §8.6.
- **On failure**: if the verdict rests on one task the flip check downgrades it to `inconclusive (rests on one task)`.
- **Module, tables**: DK6, M11, Meterless World Model (attribution list); `canary_sample`, `canary_verdict`.
- **Source**: idea-feature 2447; R:G-1, R:G-3 (attribution wording).
- **Answers**: RT-146 (verdict computed live from recorded samples; `--mutate` turns it `steady`; one line states the 28-day limit).
- **Test**: `S:power-curve`, `S:one-task-regression`, `M:mutate`.
- **Tracks**: TK3, TK2.

### DF-017 Scene 3: replay last month on a cheaper route
- **Sees and does**: picks a route; sees counts (eligible, replayable, reproduced, comparable), the measured saving, the pass-rate difference with a 95% interval and the equivalence result, non-comparable tasks with reasons, and per task-type rows with the narrow offer.
- **In / Out**: trajectories and a `route_spec` / a `replay_report` dossier.
- **Default**: 3 repeats per task; non-inferiority margin 5 points; SAMPLE_MODE serves route-arm model calls from the replay cassette.
- **On failure**: baseline reproduction under 90% withholds the comparison; a non-recorded input is `E_CASSETTE_MISS` with the live command.
- **Module, tables**: DK7, M11; `trajectory`, `replay_run`, `replay_item`.
- **Source**: idea-features 2448, 1595; R:H-1, R:H-2.
- **Answers**: RT-145 (passes are F2P/P2P test results, not quotes), RT-144 (the non-trivial leg).
- **Test**: `RC:self-replay`, `RC:known-worse-route`, `RC:divergence-accounting`, `D:drill-cassette-miss`.
- **Tracks**: TK3.

### DF-018 Scene 4: the argument, the diff and the wow sentence
- **Sees and does**: sees the Auditor reject one sentence and the Explainer revise it; sees the policy diff with restrict-only results per rule and the route rule's counterexample; sees the policy replay line (sessions paused, dollars not spent, landed tasks blocked); approves on a card that echoes the action digest; sees the gauge's new ceiling and the signed dossier; watches `desk-verify` print PASS.
- **In / Out**: findings / an approved `policy_version`, a `policy_change` dossier, verifier output.
- **Default**: new policies start in shadow mode for 7 days (§10.5); pause and shutdown actions are simulated unless real execution is configured (§3.4).
- **On failure**: a widening without approval cannot activate; a replay whose baseline does not reproduce is withheld.
- **Module, tables**: DK8, DK10, M13, M9; `policy_version`, `decision`, `dossier`.
- **Source**: idea-feature 2449; R:I-1 to R:I-5.
- **Answers**: RT-184 (the hard parts made visible), RT-185 ("nothing happens" shown with its dollars and the landed tasks it did not block).
- **Test**: `X:restrict-diff`, `B:behaviour-matrix` (critique changes the output), `C:tamper-corpus-desk`, `CR`.
- **Tracks**: TK3, TK2.

### DF-019 Judge-proof demo mode
- **Sees and does**: runs `SAMPLE_MODE=true desk demo`; all four scenes reproduce offline; runs `desk demo --mutate <seed>` and `desk demo --compare` to see every affected number change, including the canary verdict turning `steady`.
- **In / Out**: the sample inputs (logs, git bundles, CI results, invoices, canary samples, replay cassette) / every screen computed at run time.
- **Default**: no key, no network.
- **On failure**: a missing cassette is `E_CASSETTE_MISS`; with `SAMPLE_MODE=rules` the rule brain runs and is labelled.
- **Module, tables**: all; sample at `data/sample/desk-month/`.
- **Source**: idea-feature 2450, 2426; R:A-4.
- **Answers**: RT-146, RT-186 (judges can also run it on their own logs).
- **Test**: `M:mutate`, `CR`.
- **Tracks**: TK3.

## 7. Tier 3: the engines

### DF-020 Claude Code log adapter
- **Sees and does**: nothing directly; the source list shows it with its capability declaration and excluded-record counts.
- **In / Out**: JSONL under the documented paths / `session`, `turn`, `model_call`, `tool_call`.
- **Default**: dedupe by message id plus request id; fallbacks per §5.2; sidechain replays dropped; advisor sub-calls priced under their own model; multi-line messages reassembled.
- **On failure**: an entry with neither id is stored `undeduplicable` and `unpriced`, never zero; malformed lines counted.
- **Module, tables**: DK1; `model_call.dedup_key`, `implausible`.
- **Source**: R:A-1 (ccusage dedupe, copied, MIT).
- **Answers**: claim 3402 (multi-line log fragility).
- **Test**: A-1 gate (§16.2: total equals hand count, excluded count printed), `G:adapter-claude-code`.
- **Tracks**: TK1.

### DF-021 Codex log adapter
- **Sees and does**: as DF-020.
- **In / Out**: Codex session files / per-call deltas from cumulative totals.
- **Default**: `last_token_usage` when the total advanced, else subtraction; cached input clamped to input.
- **On failure**: negative deltas flagged `inconsistent_buckets`.
- **Module, tables**: DK1; `model_call`.
- **Source**: R:A-1 (ccusage Codex parser).
- **Answers**: none.
- **Test**: `G:adapter-codex`, `J:negative-or-huge-token-counts`.
- **Tracks**: TK1.

### DF-022 OpenTelemetry GenAI ingest and the `desk.*` namespace
- **Sees and does**: points the Desk at an OTLP file or endpoint export; spans appear as sessions.
- **In / Out**: spans / events; the Desk's own trace projection emits `desk.cost.*`, `desk.task.id`, `desk.outcome.state`, `desk.budget.reservation_id`, `desk.retry_of`.
- **Default**: pinned semantic-convention version; old and new attribute names accepted; cost only on leaf inference spans; sampled traces excluded with a count.
- **On failure**: an attribute missing is a gap, never a zero.
- **Module, tables**: DK1; `model_call`, `session`.
- **Source**: R:E-1, R:E-2 (OTel GenAI, Langfuse leaf rule). Gap R:L-15 (no standard cost attribute).
- **Answers**: RT-140 (ingests Langfuse-style spans rather than competing on tracing).
- **Test**: `C:otel-genai` (YAML cases plus spans from at least two SDKs).
- **Tracks**: TK1.

### DF-023 Gateway spend-log adapter
- **Sees and does**: imports a LiteLLM spend-log export or gateway CSV.
- **In / Out**: `LiteLLM_SpendLogs` fields or CSV / `model_call` with `reported` cost.
- **Default**: reported cost stored beside the estimate, never replacing it.
- **On failure**: unknown columns ignored and listed.
- **Module, tables**: DK1; `model_call.reported_cost_micros`, `cost_estimate`.
- **Source**: §5.6; R:B-5 (reported never overwrites).
- **Answers**: RT-141 (reads LiteLLM's export instead of rebuilding it).
- **Test**: `NEW:adapter-litellm-golden` (the spec's per-adapter golden rule, §16.4, needs a real sample file).
- **Tracks**: TK1.

### DF-024 Invoice and usage-export import
- **Sees and does**: drops an invoice PDF or CSV, or a usage export; sees extracted lines with locators, any sum mismatch, and the reconciliation result.
- **In / Out**: files (or a Zetaris bucket) / `billed_line`, `reconciliation`.
- **Default**: PDF through the M8 quarantined extractor with double extraction; L0 sum check.
- **On failure**: lines that do not sum leave the invoice `EXTRACTED` with a `sum_mismatch` hold; extraction disagreement is a conflict, not a guess.
- **Module, tables**: DK3, M2, M8, M12; `billed_line`, `reconciliation`.
- **Source**: §5.5; gap R:L-12 (no repo reconciles to invoices; stays NOT VERIFIED until a real invoice is read).
- **Answers**: RT-145 (dollars are estimates until an invoice exists).
- **Test**: `J:invoice-lines-do-not-sum`, `D:drill-zetaris-down`.
- **Tracks**: TK1.

### DF-025 Price book
- **Sees and does**: opens the price-book view; sees each row's source URL, quote, fetch date, stale chip; adds an owner override with one click from the unpriced list.
- **In / Out**: the bundled LiteLLM snapshot filtered to sourced rows plus verified rows / `price_row`, `plan_row`, `price_snapshot`.
- **Default**: offline; refresh off; rows older than 90 days carry a stale chip on every figure they produce.
- **On failure**: a refreshed file that is empty, not a map, under 50 models or under half the previous count is refused; cents-per-token sources converted at import with a test.
- **Module, tables**: DK2; `price_row`, `plan_row`, `price_snapshot`.
- **Source**: R:B-1, R:B-2 (Opik ladder copied), Phoenix ranking (mechanism only).
- **Answers**: claims 3400, 3401 (price books decay when a maintainer stops).
- **Test**: `G:price-rule-*` (one regression test per normalisation rule), `R:B-1 gate` (truncated refresh refused).
- **Tracks**: TK1.

### DF-026 Per-call cost formula and surcharges
- **Sees and does**: sees a per-call bucket breakdown and the rule ids that fired (long context, fast mode, tier).
- **In / Out**: token buckets and snapshot rates / `cost_estimate` in integer micros.
- **Default**: integer arithmetic with saturation, rounding up at the last step; long-context threshold strictly greater; missing cache rates leave that bucket `unpriced`.
- **On failure**: negative derived buckets flag `inconsistent_buckets` and price on totals with the flag; a missing tier attribute is recorded, not assumed.
- **Module, tables**: DK3; `cost_estimate.bucket_breakdown`, `rule_ids`.
- **Source**: R:B-3 (ccusage, agentsview, Helicone inheritance).
- **Answers**: none.
- **Test**: `G:price-rule-*` (hand-computed fixture per provider shape to the micro-dollar).
- **Tracks**: TK1.

### DF-027 Provenance classes, reconciliation and allocation
- **Sees and does**: sees `reported`, `estimated` and `billed` side by side; per vendor and period, the gap and status (`reconciled` within a 2% parameter, `partial`, `unreconciled`); billed dollars per task labelled "billed total, allocated by estimate".
- **In / Out**: cost events and billed lines / `reconciliation`, allocated figures.
- **Default**: tolerance 2% shown on screen, not a claim of accuracy.
- **On failure**: unmatched billed lines and calls are listed.
- **Module, tables**: DK3; `reconciliation`, `billed_line`.
- **Source**: R:B-5, R:E-2 (agentsview allocation, parts sum exactly).
- **Answers**: RT-145.
- **Test**: `R:E-2 gate` (parts sum exactly to the authoritative total) and `J:mixed-currencies`.
- **Tracks**: TK1, TK2.

### DF-028 Unpriced handling
- **Sees and does**: sees "N calls, M tokens on unpriced models" with a one-click add-row.
- **In / Out**: calls with no matching row / `cost_estimate` class `unpriced`.
- **Default**: never a fallback tier price, never zero; enforced scopes deny unpriced models unless the owner set a per-model token cap.
- **On failure**: n/a (this is the failure behaviour).
- **Module, tables**: DK3, DK8; `cost_estimate`.
- **Source**: R:B-6 (Helicone stop-list, coder NULL plus counter).
- **Answers**: register flaw K-1 (five sources leak unpriced as zero).
- **Test**: `D:drill-unpriced`, `J:unknown-model-names`.
- **Tracks**: TK1.

### DF-029 Repricing as superseding events
- **Sees and does**: fixes a price; sees "repriced on <date>, delta $X" and can open both versions.
- **In / Out**: an owner price row / new `cost_estimate` events superseding old ones.
- **Default**: history is never mutated; every priced call keeps its snapshot id.
- **On failure**: n/a.
- **Module, tables**: DK2, DK3, DK4; `cost_estimate.supersedes`, `price_snapshot`.
- **Source**: R:B-4 (coder snapshot on record, mechanism only; agentsview unpriced-first).
- **Answers**: none.
- **Test**: `R:B-4 gate` (re-price a month: totals change, old snapshot readable) and `P:projection-rebuild`.
- **Tracks**: TK1.

### DF-030 Task identity
- **Sees and does**: sees per task the identity method and the share of tasks per method; can set `DESK_TASK` in a wrapper.
- **In / Out**: labels, branches, PR titles, sessions / `task`.
- **Default**: order explicit label, ticket key, PR, branch, session, prompt thread.
- **On failure**: no method means the session's spend is `unlinked`.
- **Module, tables**: DK5; `task`.
- **Source**: §5.8; idea-feature 2423.
- **Answers**: none.
- **Test**: `NEW:task-identity-order` (fixtures per method, precedence asserted).
- **Tracks**: TK1.

### DF-031 Attribution with confidence
- **Sees and does**: sees each session-to-commit link with method (explicit, trailer, content overlap, time window) and confidence; dollar shares per confidence level.
- **In / Out**: sessions, file writes, commits / `task_session`.
- **Default**: 30-minute post-session window; content-overlap thresholds 50% and 20%; file-name-only overlap at most low; cost split by overlap share, not commit count.
- **On failure**: ties broken by the fixed order; trailers alone never raise confidence above what content supports.
- **Module, tables**: DK5; `task_session`.
- **Source**: R:F-1 (Codelens, buffer cut from 2 h to 30 min).
- **Answers**: register flaw K-17 (file-name linking as proof).
- **Test**: `R:F-1 gate` (planted human commit inside the window is not attributed) and `G:attribution-*`.
- **Tracks**: TK1.

### DF-032 Landing lattice
- **Sees and does**: sees each task's position: `unlinked < committed < merged < checks_green < kept_n_days`, side states `reverted`, `rewritten`, `closed_unmerged`; the evidence for each step.
- **In / Out**: git ancestry, CI results, PR states / `outcome_fact`, `landing_state`.
- **Default**: kept for 7 days with under 50% of added lines rewritten; squash and rebase twins matched by the five-way rule; CI under the SWE-bench contract (empty or "0 of 0" invalid, missing required check a fail).
- **On failure**: lines younger than N days are right-censored and the rate is null; a git repo with rewritten history is a named fixture.
- **Module, tables**: DK5, M12 (CI and PR through Zetaris); `outcome_fact`, `landing_state`.
- **Source**: R:F-2, R:F-3 (DevLake, Codelens, SWE-bench); revert detection new (Codelens has none).
- **Answers**: RT-139 (landing, not commits), register gap R:L-2.
- **Test**: `R:F-2 gate` (revert, closed-unmerged and amended commits each land in their own state), `J:git-rewritten-history`.
- **Tracks**: TK1, TK2.

### DF-033 Waste classes
- **Sees and does**: sees dollars by class with rule id and parameters: retry loop (C-LOOP-1), error echo (C-LOOP-2), failing command loop (C-LOOP-3), edit churn (C-CHURN), failure cascade (C-CASCADE), idle or heartbeat (C-IDLE), orphaned agent (C-ORPHAN), context bloat (C-BLOAT), failed then abandoned (C-ABANDON), abandoned PR (C-PR), reverted work (C-REVERT), language surcharge (C-LANG); "dollars after the stop point" as recoverable waste.
- **In / Out**: tool calls, sessions, outcomes / waste dollars per class.
- **Default**: the thresholds of §7.4; no rule uses wall time alone; a session with a later landed commit is never abandoned.
- **On failure**: low-confidence cascades labelled.
- **Module, tables**: DK5; `tool_call`, `outcome_fact`, `v_spend_by.waste_class`.
- **Source**: R:C-4, R:C-5 (LoopGuard, flight recorder, agent-bisect); idle and orphan new (R:L-5). Absorbs Idle Spend Monitor (idea 213), the detection half of Futility Stop (idea 257), Spend Meter's loop stop (idea 41).
- **Answers**: claims 702 ($6,000 overnight loop), 2274 to 2277 (OpenClaw heartbeat and idle bills), 748 and 749 (context bloat and history re-reads), 3175 (25 repeated searches).
- **Test**: `G:waste-rule-*` (positive and negative per rule).
- **Tracks**: TK1, TK2.

### DF-034 Threshold calibration on the owner's history
- **Sees and does**: sees per rule: flagged sessions, later-landed share, dollars; a rule whose later-landed share exceeds 20% over at least 20 flags shows "this rule misfires on your data" and offers a higher threshold through the policy path.
- **In / Out**: waste flags and landing states / the calibration table.
- **Default**: no threshold changes automatically.
- **On failure**: fewer than 20 flags shows "not enough data".
- **Module, tables**: DK5, DK8; projections.
- **Source**: §7.5; gap R:L-16 (fixed thresholds everywhere).
- **Answers**: none.
- **Test**: `NEW:calibration-table` (planted misfiring rule is flagged; the proposal routes through DF-047 and DF-048).
- **Tracks**: TK3.

### DF-035 Forecasts with a scorecard
- **Sees and does**: sees window runway (with run-out probability once 3 windows exist), month-end spend ("likely $a to $b (80%)"), and the forecast scorecard: coverage by cohort with n, and a note when intervals were widened.
- **In / Out**: daily spend series, windows / forecasts and their later scores.
- **Default**: seasonal-naive month-end with empirical error quantiles from the last 8 weeks; widen when an 80% interval covers under 70% over the last 20 forecasts.
- **On failure**: insufficient history shows the linear projection labelled "linear, no history", no probability.
- **Module, tables**: DK9; forecast storage not defined in §4 (section 15, S-21).
- **Source**: R:D-1 (CodexBar pace), R:D-2 (tokencast coverage metrics with empirical quantiles). Absorbs Spend Compass and Spend Ledger forecasting (ideas 19, 81).
- **Answers**: claim 3406 (flagged NOT VERIFIED in the evidence table, so it carries no weight).
- **Test**: `R:D-1 gate` (back-test coverage reported) and `NEW:forecast-scorecard`.
- **Tracks**: TK3.

### DF-036 Canary task capture
- **Sees and does**: on the capture screen, reviews candidate tasks from history (redacted prompt, parent snapshot, F2P and P2P tests computed by running the owner's test command), accepts or rejects each; sees family coverage and "weak oracle" labels.
- **In / Out**: tasks at `kept_n_days` / `canary_task`, a frozen `canary_suite` with its hash.
- **Default**: 12 to 40 tasks stratified by type and repo area, preferring intermediate pass rates; half held out.
- **On failure**: no F2P test makes the task eligible only with an owner rule; empty families are reported, never faked; a captured task carrying an injection is caught at review and runs only in the sandbox.
- **Module, tables**: DK6; `canary_task`, `canary_suite`.
- **Source**: R:G-2 (dedrift families, mechanism only), livenerf selection with its bias warning, SWE-bench contract (R:F-3). Absorbs Agent Canary (idea 58), Personal Drift Canary (idea 10), Quality Pulse (idea 23).
- **Answers**: RT-145 (the canary needs the owner's own tasks: capture is the product's first step for real users).
- **Test**: `NEW:capture-f2p-p2p` (F2P computed on parent and kept result; skipped F2P is fail).
- **Tracks**: TK3.

### DF-037 Hermetic canary runner, cache bypass and control arm
- **Sees and does**: sees per run the harness hash, agent version, served model ids, cache-bypass proof, and the control arm line.
- **In / Out**: suite / `canary_run`, `canary_sample`.
- **Default**: clean working copy from the bundle, scrubbed environment, no memory files, fixed permissions, network limited to the model endpoint where the backend allows; response caching disabled or per-day namespaced; any cached response invalidates the run.
- **On failure**: harness change refuses the run; infra failures stay in the denominator as `infra_failure`.
- **Module, tables**: DK6, M8 (backend probing decides the isolation claim printed); `canary_run.cache_bypass_proof`.
- **Source**: R:G-2 (promptfoo cache, livenerf hermetic provider and control arm).
- **Answers**: RT-144 (promptfoo cron on defaults replays a 14-day cache).
- **Test**: `S:cache-leak`, `S:platform-confound`, `D:drill-harness-change`.
- **Tracks**: TK3.

### DF-038 Scoring cascade and judge-panel controls
- **Sees and does**: sees `decided_by` per sample (deterministic, owner rule, panel), panel agreement (Krippendorff's alpha) and whether the judge channel is admitted.
- **In / Out**: test results and diffs / scores or "unscored".
- **Default**: three judges of at least two model families in the evaluation profile; order shuffled; route name hidden; no majority, no score; the model under test never grades itself; judge channel excluded under alpha 0.67 and admitted only after 0.85 agreement with 20 owner labels (above 0.92 flagged).
- **On failure**: grader error is `grader_failed`, never a pass.
- **Module, tables**: DK6, DK10 (Outcome Judge panel in the M8 quarantined compartment); `canary_sample.judge_panel_id`.
- **Source**: R:G-4 (Inspect cascade and panel, promptfoo grader error, Reenact calibration).
- **Answers**: RT-145.
- **Test**: `S:judge-noise`; `R:G-4 gate` (a same-model judge configuration fails start-up).
- **Tracks**: TK3.

### DF-039 Regression statistic, MDE, watch flag and attribution
- **Sees and does**: sees the verdict with delta, 99% interval, MDE ("can detect drops of about N points or larger"), two-window status, control delta, error rate, held-out confirmation; a `watch` dot when the anytime detector fires; the attribution list labelled "consistent with".
- **In / Out**: samples / `canary_verdict`.
- **Default**: 14-day frozen baseline after a pin; 7-day windows; clustered SE with G/(G-1); conditions (a) to (f) of §8.6; earliest call day 28; the watch flag only schedules extra repeats.
- **On failure**: any failed condition yields `steady` (within ±MDE) or `inconclusive`; a one-task flip downgrades to `inconclusive (rests on one task)`.
- **Module, tables**: DK6, M11, Meterless World Model; `canary_verdict`.
- **Source**: R:G-1 (livenerf pre-registered rule, copied), R:G-3 (dedrift anytime mode and wording, mechanism only).
- **Answers**: claims 62 and 63 (users mined months of logs to show a regression; no way to check), 953 and 136 (people depend on someone else's fixed benchmark), 979 to 981 (noise: the MDE is shown, not hidden).
- **Test**: `S:false-alarm` (at most 1% over 500 simulated null histories), `S:power-curve` (published MDE within one point of the simulated 80% power point), `S:one-task-regression`.
- **Tracks**: TK3.

### DF-040 Trajectory capture and replayability accounting
- **Sees and does**: sees how many of last month's tasks are replayable (`full`, `tools_only`, `insufficient`) and why the rest are not.
- **In / Out**: wrapper or gateway captures, local logs / `trajectory`.
- **Default**: redact before hash; log-reconstructed trajectories replay only in "re-run from the task prompt" mode.
- **On failure**: missing mutating-tool results make a trajectory `insufficient`, never replayed.
- **Module, tables**: DK7; `trajectory`.
- **Source**: R:H-1 (Reenact cassette and redaction).
- **Answers**: §18 item 6 risk (thin replay for most owners) is surfaced, not hidden.
- **Test**: `RC:divergence-accounting` (eligible = replayable + insufficient, and so on).
- **Tracks**: TK3.

### DF-041 Side-effect-safe replay
- **Sees and does**: sees per replay item how many tool results were served from the recording or stubbed, and the divergence step.
- **In / Out**: trajectories / replay items in a sandbox copy.
- **Default**: `unknown` treated as `mutating`; mutating tools never execute; shell commands mutating unless a fixed read-only allowlist with no redirection proves otherwise; a miss on a mutating tool diverges the item.
- **On failure**: a divergence is `not comparable`, never scored as a pass.
- **Module, tables**: DK7, M8; `replay_item.tool_served_from_recording`, `tool_stubbed`.
- **Source**: R:H-2 (Reenact classes, Kitaru tool key; Kitaru's passthrough default rejected).
- **Answers**: register flaw K-19 (replay re-fires side effects).
- **Test**: `RC:side-effect-safety` (a recorded `git push`, HTTP POST and deletion outside the sandbox; zero outbound effects observed).
- **Tracks**: TK3.

### DF-042 Cheaper-route swap with reproduction gate and paired interval
- **Sees and does**: builds a route (model map, prompt override, parameters, or workflow shape); sees the reproduction gate result, measured saving, paired pass-rate difference with a seeded cluster-bootstrap 95% interval, the equivalence verdict, per task-type rows, weak-oracle rows apart.
- **In / Out**: reproducible trajectories, `route_spec` / `replay_run`, report.
- **Default**: baseline reproduction must reach 90%; 10,000 seeded resamples; margin 5 points; `max_live_calls` and a DK4 dollar budget per run; "as good as" is a lint failure unless the equivalence test passed.
- **On failure**: the run stops cleanly at the cap and reports a partial cohort as partial.
- **Module, tables**: DK7, DK4 (route-arm calls reserved and settled), M11; `replay_run`, `replay_item`.
- **Source**: R:H-1 (Kitaru replay model, gate made automatic). Workflow-shape routes absorb One-or-Swarm Bench (idea 204), reported as experiments until they pass the same gates (§9.6).
- **Answers**: RT-145, RT-144; claims 2173, 2176, 2191 (multi-agent gains explained by compute: the bench tests it on the owner's tasks).
- **Test**: `RC:self-replay` (95% intervals cover zero in at least 93% of 200 replays), `RC:known-worse-route`.
- **Tracks**: TK3.

### DF-043 Language surcharge and the locale route experiment
- **Sees and does**: sees per language and task type the token surcharge against the English baseline, shown only with at least 20 tasks per cell; can run a replay route that translates the instruction, works in English and translates back, judged by the same gates.
- **In / Out**: usage with the reported tokenizer, detected language / surcharge figures (`estimated`), a replay report.
- **Default**: deterministic script and character-class language detection (`EXTRACTED`); never a guessed tokenizer.
- **On failure**: under 20 tasks shows "not enough data".
- **Module, tables**: DK3 (§6.4), DK7 (route experiment); `cost_estimate`, `replay_run.route_spec`.
- **Source**: §6.4; tokencast's silent tokenizer fallback rejected (R:B-3). Absorbs Locale Tax Meter (idea 154). The translate route is a `route_spec` prompt override; the spec does not name it (section 15, S-4).
- **Answers**: claim 1724 (token quotas multiply cost by language), claim 1720 (translate-work-translate-back pattern).
- **Test**: `NEW:language-surcharge-min-n` and, for the route, `RC:known-worse-route` style gates.
- **Tracks**: TK1, TK3.

## 8. Tier 4: the gate and policy

### DF-044 Spend policy language
- **Sees and does**: edits the policy in a structured editor (YAML on disk): scopes, permit and forbid rules, caps, route rules, approvals.
- **In / Out**: the policy document / a `policy_version` hashed as JCS.
- **Default**: default deny unless permitted; forbid overrides permit; deny-overrides is the only conflict strategy; every applicable cap must have room.
- **On failure**: a cyclic scope or an atom outside the closed types is rejected with the line.
- **Module, tables**: DK8 (pack on M5a); `policy_version`.
- **Source**: R:I-1 (Microsoft toolkit rule schema, Cedar semantics); gap R:L-10.
- **Answers**: RT-183 (adds what the toolkit lacks for spend: budget inside the policy).
- **Test**: `J:policy-cyclic-scope`, `R:I-1 gate` (a spend cap and an approval threshold evaluated from one file).
- **Tracks**: TK3.

### DF-045 Caps, windows and override resolution
- **Sees and does**: sees each cap's source, window, warn/ask/deny thresholds, and the tightest cap that binds a request.
- **In / Out**: policy and ledger / verdicts `allow`, `ask`, `deny`.
- **Default**: warn 50%, ask 80%, deny 100%; notify at 85% and 100%; short windows sliding, months calendar UTC; all matching caps apply.
- **On failure**: state survives restarts (windows stored as events).
- **Module, tables**: DK8, DK4; `budget`.
- **Source**: R:C-2 (coder override with source tag, mechanism only; LiteLLM soft alert).
- **Answers**: claims 1412, 1413, 3172 to 3174 (CrewAI shared crew budget), 1414 (hard caps should be default), 1418 (soft caps did not work). Absorbs Crew Budget Escrow (idea 128) and Agent Budget Ledger (idea 6).
- **Test**: `R:C-2 gate` (cross the cap with one large request: refused before the call).
- **Tracks**: TK3.

### DF-046 Reservation ledger and integrity job
- **Sees and does**: sees per budget spent, reserved, available, state; integrity status; overage events.
- **In / Out**: authorize, settle, void, expire / `reservation_event`.
- **Default**: worst-case reservation; settle capped at the reservation with a typed overage event that pauses the scope; expiry 300 s; late settle accepted with an overage check; integrity job every 5 minutes and at each checkpoint.
- **On failure**: an invariant violation writes `integrity_violation` and fails closed.
- **Module, tables**: DK4; `budget`, `reservation_event`, `v_budget_state`.
- **Source**: R:C-1 (figuard, LiteLLM; figuard's unbounded confirm and LiteLLM's fail-open removed). Absorbs Spend Wall (idea 238).
- **Answers**: register flaws K-3 to K-8; claim 3177 (reservation correctness is a benchmarked problem).
- **Test**: `P:random-interleavings` (authorize, settle, void, expire never break I-R5 except by recorded overage), `I:integrity-job`, `D:drill-ledger-readonly`.
- **Tracks**: TK3.

### DF-047 Restrict-only check with a counterexample
- **Sees and does**: for each edit sees "checked over all N cells of this policy: narrows only", or the concrete newly allowed request; route changes always listed as behaviour changes with an example request.
- **In / Out**: old and new policy / `restrict_check` (`narrowing`, `equal`, `widening`, `outside_fragment`) with counterexample.
- **Default**: in-process box enumeration; cell cap 10^6 with dimension merging; above it, `outside_fragment` routes to the core solver path, the only path that may say "proved".
- **On failure**: n/a; the checker never claims beyond the fragment.
- **Module, tables**: DK8 (change to M5a recorded in §3.4); `policy_version.restrict_check`.
- **Source**: R:I-2 (Cedar `verify_implies` with counterexample, rebuilt without a solver).
- **Answers**: RT-184, RT-144.
- **Test**: `X:restrict-diff` (differential against Cedar symcc on a translated subset, developer machine only), `X:restrict-mutation`.
- **Tracks**: TK3.

### DF-048 Policy replay before a change
- **Sees and does**: sees for a draft policy, over the last 30 days: calls that would have been denied or asked, dollars not spent, sessions paused, and **landed tasks blocked**; "loosening: impact unevaluable from history" where relevant.
- **In / Out**: recorded calls and reservations / a replay report bound to the `policy_version`.
- **Default**: the old policy must reproduce every recorded decision exactly or the replay is withheld.
- **On failure**: withheld, with the decisions that did not reproduce.
- **Module, tables**: DK8, DK7; `decision`, `reservation_event`, `policy_version.replay_report_id`.
- **Source**: §10.7; Plumbline Policy Twin rule (PRD F-S19), reused.
- **Answers**: RT-187 analogue (caps blocking landed work are measured), RT-185.
- **Test**: `NEW:policy-replay-baseline` (planted non-reproducing decision withholds the report) and `M:mutate`.
- **Tracks**: TK3.

### DF-049 Approval echo card and approval-habit metrics
- **Sees and does**: lists any unresolved policy evasions found by the Policy Attacker (DF-103) with their replay evidence; sees an approval card with typed fields only (diff, replay result, restrict result, dollars and tasks affected) and the action digest; approves or denies; monthly sees approval time and the share approved without opening evidence.
- **In / Out**: a `Proposal<PolicyDiff>` / an approval bound to `approval_request_id` and `action_digest`.
- **Default**: approvals count only when both are echoed; deny always honoured; malformed or timed-out denies.
- **On failure**: a changed digest is denied.
- **Module, tables**: DK8, M13; `policy_version.approval_ids`, `decision.approval_id`.
- **Source**: R:I-3 (Microsoft approval webhook, strict mode only).
- **Answers**: RT-188 (rubber-stamping measured, no claim that the card improves accuracy).
- **Test**: `R:I-3 gate` (echo with a changed digest denied; expired approval denied).
- **Tracks**: TK3.

### DF-050 Shadow mode and the emergency gate switch
- **Sees and does**: sees new policies running in shadow for 7 days with `shadow_would_deny` counts; can run `desk gate open --for 30m`, which writes a signed `gate.bypass` event shown in the month dossier.
- **In / Out**: policy mode / shadow events, bypass events.
- **Default**: shadow for 7 days; bypass only time-boxed and logged.
- **On failure**: fail-open never silent.
- **Module, tables**: DK8, DK11; `budget.mode`, `reservation_event` (`shadow_would_deny`); `gate.bypass` has no table (section 15, S-15).
- **Source**: R:I-4 (figuard SHADOW, with its equal-totals flaw fixed).
- **Answers**: §15.5 (denial of service through the fail-closed gate).
- **Test**: `D:drill-gate-down` (emergency switch works and is logged), `R:I-4 gate` (shadow never blocks and reports the would-be verdict).
- **Tracks**: TK3.

### DF-051 Pause with checkpoint
- **Sees and does**: when a loop-stop or cap fires, sees the agent finish its step, write a resumable handoff (summary, open items, branch) and stop; resuming beyond the cap requires an approved extension.
- **In / Out**: a `pause_with_checkpoint` decision / a handoff file and a paused scope.
- **Default**: through the hook or MCP; where only the gateway exists, the next paid call is denied with a checkpoint instruction; no SIGSTOP.
- **On failure**: a tool with no hook and no gateway gets a notification only, labelled.
- **Module, tables**: DK8, DK11, M13 (`pause.request`); `decision`.
- **Source**: R:C-3 (LoopGuard pause and resume, AgentBudget finalization reserve). Absorbs the checkpoint half of Soft Landing (idea 111) and the stop action of Futility Stop (idea 257).
- **Answers**: claims 1165 to 1169 (hard limit stops a run with no checkpoint), 702.
- **Test**: `R:C-3 gate` (hard stop leaves a written summary; resume without extension refused) and `E:enforce-<tool>`.
- **Tracks**: TK3.

### DF-052 Enforcement-surface ladder and notify-only labels
- **Sees and does**: on the Policy screen, sees each tool's surface: enforced (gateway or tested hook), advisory (MCP self-check), or notify only, with the reason.
- **In / Out**: adapter declarations and enforcement test results / labels.
- **Default**: "enforced" only after the per-adapter enforcement test passes.
- **On failure**: an untested hook shows "advisory, not tested".
- **Module, tables**: DK8, DK11; capability set.
- **Source**: §10.5, §10.6.
- **Answers**: claim 3405 (pause needs a per-tool hook; not tested; flagged NOT VERIFIED in the evidence table).
- **Test**: `E:enforce-<tool>` per tool and version.
- **Tracks**: TK3.

## 9. Tier 5: the doors and integrations

### DF-053 Local reserve endpoint (HTTP)
- **Sees and does**: an agent or wrapper calls `authorize`, `settle`, `void` on localhost before and after a paid step.
- **In / Out**: request body hash, idempotency key / verdict with reservation id.
- **Default**: tiny separate process; 250 ms timeout; fail closed for enforced scopes (HTTP 503 with a displayable reason).
- **On failure**: ledger write failure or unpriced model denies on enforced scopes.
- **Module, tables**: DK11, DK4; `reservation_event`, `decision`.
- **Source**: R:C-1; idea-feature 2436.
- **Answers**: register flaw K-4 (enforcement after the money is spent).
- **Test**: `D:drill-gate-down`, `D:drill-ledger-readonly`, `NEW:endpoint-idempotency` (repeat authorize returns the first decision; transient denial not cached).
- **Tracks**: TK3.

### DF-054 MCP tools
- **Sees and does**: any MCP-capable agent sees `budget_left`, `authorize`, `settle` (and read tools for forecast and canary status) as tools.
- **In / Out**: MCP calls / the same verdicts as DF-053.
- **Default**: labelled advisory (an agent's own counter fails under recursion, §10.5).
- **On failure**: as DF-053.
- **Module, tables**: DK11.
- **Source**: idea-features 2436, 2461.
- **Answers**: none.
- **Test**: `NEW:mcp-parity` (MCP verdicts equal HTTP verdicts on the same requests).
- **Tracks**: TK3.

### DF-055 Gateway door
- **Sees and does**: points an agent's base URL at the local OpenAI- and Anthropic-compatible pass-through; holds a Desk-issued virtual key while the provider key stays in the gateway.
- **In / Out**: provider requests / forwarded requests, reservations, settlements from the provider usage block.
- **Default**: authorize before forward; settle after; void on error; cancelled streams settle in a `finally` path; owner and task metadata required.
- **On failure**: fail closed; unknown model denied.
- **Module, tables**: DK11, DK4; `reservation_event`, `model_call`.
- **Source**: R:A-3 (coder pre-forward check, mechanism only; Portkey required metadata, its fail-open hooks rejected).
- **Answers**: claims 2870 to 2875 (key-abuse bills where billing lags by hours: only a pre-call check stops them).
- **Test**: `R:A-3 gate` (kill the checker mid-request: refused and recorded), `R:C-2 gate`.
- **Tracks**: TK3.

### DF-056 Hook adapters per agent tool
- **Sees and does**: installs a hook for a tool that exposes a blocking pre-call hook; the Policy screen shows "enforced" only after the test passes.
- **In / Out**: hook events / authorize calls, block decisions.
- **Default**: none enabled until tested; which hooks can block a model call is NOT VERIFIED per tool (§18 item 1).
- **On failure**: hook returns "block" when the endpoint does not answer.
- **Module, tables**: DK11, DK1 (`pauseHook`).
- **Source**: §10.5 surface 2; claims 3466, 3467 (PostModelSwitch, StopFailure hooks exist).
- **Answers**: claim 3405 (flagged NOT VERIFIED in the evidence table, so it carries no weight).
- **Test**: `E:enforce-<tool>`.
- **Tracks**: TK3.

### DF-057 Zetaris data path and the on-camera query
- **Sees and does**: with Zetaris running, sees billed figures, CI and PR facts and seat roster arrive through one federated SQL query ("spend per landed PR by team, this month"); without it, a fallback banner and the bill class dropping to `estimated`, landing stopping at `merged`.
- **In / Out**: the verified REST route `POST /api/v1.0/sql-editor/sqls/run` / rows, recorded as cassettes with request hashes.
- **Default**: SAMPLE_MODE reads the same fixtures through the embedded engine, every row traced `served_from: fallback`; 15 s timeout.
- **On failure**: container killed falls back with a banner.
- **Module, tables**: M12 `SiloPort`, DK5, DK3; `billed_line`, `outcome_fact`, `plan_row`.
- **Source**: D-032; `docs/sponsors/zetaris-local-setup.md` (route verified 2026-10-16). NOT VERIFIED: registering our own Postgres, bucket and REST silos; cross-source joins; semantic layer; data steward; audit read path; limits above 5.
- **Answers**: Track 1 fit (idea-feature 2428).
- **Test**: `D:drill-zetaris-down`; each NOT VERIFIED item tested on the local instance and recorded before it is claimed (§19 step 7).
- **Tracks**: TK1.

### DF-058 Model endpoint (Nemotron through NVIDIA's free API)
- **Sees and does**: sets `MODEL_BASE_URL`, `MODEL_API_KEY`, `NEMOTRON_MODEL` (aliases accepted); the Sources screen shows endpoint status.
- **In / Out**: role prompts / responses, traced with `model`, `usage`, `served_model`.
- **Default**: 60 s timeout; 2 retries on transient errors; Desk's own calls reserved and settled through DK4; NVIDIA's free API recorded `unpriced` with reason "free tier, no published price".
- **On failure**: cassette or rule brain, labelled.
- **Module, tables**: M12 `ModelPort`, DK10, DK4.
- **Source**: `docs/sponsors/nvidia-integration-notes.md` (verified once 2026-10-16). NOT VERIFIED: rate limits, tool calling and streaming in our client, Nano and Ultra ids, whether `max_tokens` bounds reasoning.
- **Answers**: none.
- **Test**: `D:drill-model-down` (key withdrawn).
- **Tracks**: TK3.

## 10. Tier 6: the platform and open-source path

Tier 6 features are built after the demo path, in the order of spec 19, and each passes its gate before it is claimed. The seat features (DF-061 and DF-062) are part of the main build, not an afterthought, because the one decision names seats; they are simply not in the four-minute demo.

### DF-059 Team mode with permissioned views
- **Sees and does**: a team ledger across people and machines; each person sees what the owner's role table allows; aggregate views by default; access log; no ranking of people.
- **In / Out**: several tenants' or machines' ledgers / role views.
- **Default**: per-person data off; aggregates on.
- **On failure**: a denied view shows the role required.
- **Module, tables**: DK12, M8; role table not defined in §4 (section 15, S-19).
- **Source**: idea-features 2460, 2454 (Worth Ledger, idea 198).
- **Answers**: RT-142 (team features are the paid and grant path).
- **Test**: `NEW:team-permission-denial` (every role that must be denied is denied).
- **Tracks**: TK1.

### DF-060 CI gate
- **Sees and does**: a CI step fails a pull request when a prompt or model change worsens the canary suite or raises cost per landed task past a set bound.
- **In / Out**: the changed config / pass or fail with the evidence pack.
- **Default**: uses the canary verdict rules; never declares a regression the statistic does not support.
- **On failure**: insufficient samples is `inconclusive`, not pass.
- **Module, tables**: not assigned by the spec (section 15, S-18).
- **Source**: idea-feature 2461.
- **Answers**: RT-142.
- **Test**: `NEW:ci-gate`.
- **Tracks**: TK3.

### DF-061 Seat return and renewal sheet
- **Sees and does**: before a renewal, a sheet ranking seats and plans by outcomes delivered, with seats never opened and teams without a use case.
- **In / Out**: roster (through Zetaris), activity, outcomes / a `renewal_sheet` dossier.
- **Default**: per-person data only for permitted roles.
- **On failure**: a seat with no activity source is "unknown", not idle.
- **Module, tables**: DK5, M12, M9; `plan_row`, `dossier` (kind `renewal_sheet`); no seat-usage projection in §4 (section 15, S-17).
- **Source**: idea-features 1597, 2453. Absorbs Seat Return Meter (idea 131).
- **Answers**: claims 1290 to 1294 (Copilot seats unopened; vendor dashboard does not show which licences to pull back).
- **Test**: `NEW:renewal-sheet-recompute`.
- **Tracks**: TK1.

### DF-062 Bill auditor and dispute pack
- **Sees and does**: for per-outcome or credit billing, samples billed resolutions, re-judges them against the owner's own definition, itemises credits spent on loops and failures, flags duplicates; exports a `dispute_pack` dossier (audience counterparty, redacted).
- **In / Out**: imported invoices and vendor exports / a dispute pack.
- **Default**: no prompts or code in the pack.
- **On failure**: without per-outcome lines, the auditor says it cannot run.
- **Module, tables**: DK3, DK5, M9; `billed_line`, `dossier` (kind `dispute_pack`); no billed-resolution table in §4 (section 15, S-17).
- **Source**: idea-features 1598, 2452, 2456. Absorbs Outcome Bill Auditor (idea 120) and the evidence-pack half of Capacity Witness (idea 229).
- **Answers**: claims 1074 to 1077, 1088 (credits consumed by failed attempts, refunds refused), 1091 to 1093 (per-resolution billing where the vendor's definition of success triggers the bill).
- **Test**: `NEW:dispute-pack-redaction` and `C:tamper-corpus-desk`.
- **Tracks**: TK2.

### DF-063 Adapter SDK and open ledger format
- **Sees and does**: a developer writes an adapter against the published `DeskAdapter` interface and golden-fixture harness; other tools read and write the versioned event schema.
- **In / Out**: interface, schema / community adapters.
- **Default**: an adapter exists only when built from a real sample file with golden fixtures (§5.3).
- **On failure**: an adapter failing its fixtures is not loaded.
- **Module, tables**: DK1, DK4.
- **Source**: idea-feature 2457.
- **Answers**: RT-144 (the moat is the open ledger format and execution).
- **Test**: `C:adapter-harness` (NEW as a named suite; section 15, S-20).
- **Tracks**: TK1.

### DF-064 Opt-in public regression index
- **Sees and does**: off by default; when turned on, a preview shows the exact payload (per-suite pass rate, steps, verdict, model id, tool version, no task text) before anything is sent.
- **In / Out**: canary aggregates / an export.
- **Default**: off.
- **On failure**: no egress without the preview being accepted.
- **Module, tables**: DK6, M8 egress manifest.
- **Source**: idea-feature 2455. Absorbs Agent Sentinel Network (idea 121).
- **Answers**: claims 136, 953, 969 (public appetite for regression proof).
- **Test**: `NEW:index-preview-equals-payload`.
- **Tracks**: TK1.

### DF-065 Shareable rule packs and canary templates
- **Sees and does**: imports a pack of loop signatures, budget policies, outcome rules per task type or canary templates; each import goes through the restrict check and policy replay like any edit.
- **In / Out**: a pack file / draft policy versions and templates.
- **Default**: imported packs start in shadow.
- **On failure**: a pack that widens without approval is rejected.
- **Module, tables**: DK8, DK6; no registry module in the spec (section 15, S-20).
- **Source**: idea-feature 2458.
- **Answers**: none.
- **Test**: `X:restrict-diff` on imported rules.
- **Tracks**: TK3.

## 11. Tier 7: the trust and verification layer

### DF-066 Claim ledger with exact quote, number and comparative checks
- **Sees and does**: every factual sentence carries claim chips; opening a chip shows the rows, the computation id, and the check result.
- **In / Out**: drafts / accepted claims or rejections (`no_support`, `number_mismatch`, `class_mismatch`, `comparative_unsupported`, `quote_absent`).
- **Default**: numbers must equal the cited computation after declared rounding; "regressed" needs a regressed verdict; "as good as" needs a passed equivalence test; calling an `estimated` figure "billed" fails.
- **On failure**: a `fabricated_quote` ends the claim with no model call.
- **Module, tables**: M4, DK10.
- **Source**: core M4 (Plumbline F-S05, F-K28 reused unchanged).
- **Answers**: RT-145.
- **Test**: `NEW:claim-check-corpus` (planted number, class and comparative errors each rejected); core M4 tests.
- **Tracks**: TK2.

### DF-067 Auditor critic loop
- **Sees and does**: sees rejections and revisions in "how this answer was checked".
- **In / Out**: draft plus claim ledger / accepted text.
- **Default**: at most 2 revisions; then the sentence is dropped with a note.
- **On failure**: Auditor code checks run without a model.
- **Module, tables**: DK10, M4; `DeskRunState.rejections`.
- **Source**: core M14 reflexion cap; idea-feature 2424.
- **Answers**: RT-184.
- **Test**: `B:behaviour-matrix` (evaluator critiques and agent revises change the output in recorded cases).
- **Tracks**: TK3, TK2.

### DF-068 The one fact that would flip each verdict
- **Sees and does**: each verdict card shows the smallest flip found ("removing canary task t-17 changes the verdict from regressed to inconclusive") with `completeness: partial` when the budget ran out.
- **In / Out**: frozen snapshot / flip certificate.
- **Default**: Desk flip candidates: remove one canary task, move one landing state one step, swap one price row to its alternative source, remove the control arm.
- **On failure**: a regression that flips on one task is downgraded automatically.
- **Module, tables**: M4 minimal flip, DK6, DK7, DK8.
- **Source**: core M4 (Plumbline F-S07).
- **Answers**: livenerf's one-symbol warning, RT-146.
- **Test**: `S:one-task-regression`.
- **Tracks**: TK2, TK3.

### DF-069 Signed dossiers
- **Sees and does**: on the Dossiers screen, lists dossiers (`month_bill`, `canary_evidence`, `replay_report`, `policy_change`, `dispute_pack`, `renewal_sheet`), exports them with an audience tier.
- **In / Out**: claims, rows, proofs, snapshots, policy, stats / a deterministic bundle with DSSE envelope and `VERIFY.md`.
- **Default**: signer key generated locally on first run; public key printed for pinning.
- **On failure**: a write failure stops the action (audit write failure rule).
- **Module, tables**: M9, DK12; `dossier`.
- **Source**: core M9; R:I-5.
- **Answers**: RT-184.
- **Test**: `C:tamper-corpus-desk` (swapped price snapshot, edited canary sample, reordered rows, changed claim number each FAIL).
- **Tracks**: TK2.

### DF-070 Offline verifier
- **Sees and does**: runs `desk-verify <bundle> --pins <pins.json>` on a machine with no network, or presses Verify in the app; sees PASS / FAIL / INDETERMINATE / NOT_APPLICABLE per level V0 to V8-D and the fixed text of what PASS does and does not mean.
- **In / Out**: a bundle and pins / a verdict report.
- **Default**: no pins gives INDETERMINATE.
- **On failure**: any recompute mismatch is FAIL with the field.
- **Module, tables**: M9 verifier core, Desk levels V6-D to V8-D.
- **Source**: core M9 (zero-dependency verifier).
- **Answers**: RT-184.
- **Test**: `C:tamper-corpus-desk`, `CR` (PASS with pins, INDETERMINATE without).
- **Tracks**: TK2, TK3.

### DF-071 Hash-chained append-only ledger
- **Sees and does**: nothing day to day; on a broken chain, a fatal screen with the row and the restore command.
- **In / Out**: events / streams with `prev_hash`, `row_hash`, gapless `seq`, mirrored to the M9 log at checkpoints.
- **Default**: corrections are superseding events; projections rebuild byte-identically.
- **On failure**: `E_LEDGER_CHAIN` is fatal.
- **Module, tables**: DK4, M9; every event table.
- **Source**: R:I-5 (agent-bisect rejecting reader), R:F-4 (DevLake deterministic ids and rebuild).
- **Answers**: register flaw K-7.
- **Test**: `P:projection-rebuild`, `R:I-5 gate` (flip one byte: verification fails), `D:drill-disk-full`.
- **Tracks**: TK3.

### DF-072 Untrusted log text isolation
- **Sees and does**: nothing unless an injection is found; then a hold or waste flag with the excerpt.
- **In / Out**: raw log text / typed values for privileged components.
- **Default**: only the Outcome Judge panel reads raw excerpts, in the quarantined compartment with no tools; untrusted text can add a flag or hold, never raise a landing state, relax a cap or approve.
- **On failure**: n/a.
- **Module, tables**: M8, DK10.
- **Source**: core M8 restrict-only rule (Plumbline F-K06).
- **Answers**: §15.1 threat.
- **Test**: `J:prompt-injection-in-tool-result`.
- **Tracks**: TK3.

### DF-073 Redaction at read
- **Sees and does**: nothing; the content store holds only redacted text and hashes.
- **In / Out**: raw lines / redacted lines.
- **Default**: sanitise, externalise images (hash only), redact (entropy above 4.5, provider prefixes, credentialed URIs, connection strings, JWTs, `.env` assignments, cloud keys); best-effort, stated as such.
- **On failure**: n/a.
- **Module, tables**: DK1, M8.
- **Source**: R:E-3 (Entire, Reenact).
- **Answers**: none.
- **Test**: `R:E-3 gate` (planted secret never reaches the store or an export); `scripts/secret_scan.py` over fixtures and outputs.
- **Tracks**: TK1.

### DF-074 Local-first egress manifest
- **Sees and does**: sees on the Sources screen the only outbound destinations: the model endpoint, Zetaris on localhost, and named exports the owner turned on.
- **In / Out**: the M8 manifest / blocked or allowed connections.
- **Default**: nothing leaves the machine except model calls with redacted, minimised views; a `local` model profile keeps everything local.
- **On failure**: an undeclared destination is refused.
- **Module, tables**: M8 (`ctx.net`).
- **Source**: core M8; principle 11 (§2.1).
- **Answers**: report risk on telemetry (register flaw K-28).
- **Test**: `NEW:egress-only-manifest` (network monitor during `CR` sees only declared hosts).
- **Tracks**: TK1.

### DF-075 JSONL decision trace with the why
- **Sees and does**: opens `logs/` or the trace viewer; a cleaned sample lives in `output_examples/traces/`.
- **In / Out**: every decision / one line with `why` (`rule`, `computed`, `model_reported`; the last never shown as an explanation).
- **Default**: core trace schema v2 with the Desk verbs of §12.6.
- **On failure**: a run that cannot write its trace fails.
- **Module, tables**: M7, DK10.
- **Source**: core M7 (Plumbline F-S11).
- **Answers**: organizer red flag "hide how the agent reached its output".
- **Test**: core trace linter; `NEW:readme-claim-to-trace` (every README claim maps to a trace or report line).
- **Tracks**: TK3.

### DF-076 SAMPLE_MODE cassettes and rule-brain fallback
- **Sees and does**: a SAMPLE_MODE banner; fallbacks labelled in every trace line and on screen.
- **In / Out**: cassettes recorded from real Nemotron runs on the sample month / identical outputs offline.
- **Default**: a different input is `E_CASSETTE_MISS` with the live command; `SAMPLE_MODE=rules` runs the rule brain.
- **On failure**: n/a (this is the fallback).
- **Module, tables**: M7, M14, DK10.
- **Source**: core M14 rule brain (Plumbline F-S12).
- **Answers**: organizer red flags "fail offline", "need a key a judge will not have".
- **Test**: `D:drill-model-down`, `D:drill-cassette-miss`.
- **Tracks**: TK3.

### DF-077 Bounded runs; the Desk pays through its own ledger
- **Sees and does**: sees the Desk's own model calls on its bill like any agent's.
- **In / Out**: `BudgetSpec` per run / reserved and settled calls.
- **Default**: Ask 60 s and 8 calls; month analysis 600 s; canary and replay with DK4 caps; `E_BUDGET_EXCEEDED` ends with a partial labelled answer.
- **On failure**: as stated.
- **Module, tables**: M7, DK4.
- **Source**: §3.4.
- **Answers**: organizer rule 5 (caps enforced in code).
- **Test**: core M7 TK1 to T8 (`C:m7-acceptance`), `NEW:desk-own-calls-reserved` (see section 15, S-3: the spec's unpriced-deny rule would deny the Desk's own free-tier calls).
- **Tracks**: TK3.

## 12. Tier 8: the proof of honesty

### DF-078 A provenance chip on every figure, and unknown is never zero
- **Sees and does**: every number shows `billed`, `reported`, `estimated`, `forecast` or `unknowable`; `estimated` figures carry "never a billing receipt"; stale rows carry a stale chip.
- **In / Out**: computed figures / labelled figures.
- **Default**: null with a counted reason wherever the sources cannot support a figure.
- **On failure**: n/a.
- **Module, tables**: DK3, DK12.
- **Source**: R:B-5, R:B-6.
- **Answers**: RT-145; claim 3395 (the vendor's own dollar is an estimate).
- **Test**: `NEW:no-unlabelled-figure`, `D:drill-unpriced`.
- **Tracks**: TK2.

### DF-079 Unlinked spend shown as unknowable
- **Sees and does**: a grey share labelled "cannot be known from these sources" with reasons (no repo, outside a repo, no commit in window, adapter lacks file edits); never folded into waste or landed.
- **In / Out**: attribution results / the unlinked share.
- **Default**: as stated.
- **On failure**: n/a.
- **Module, tables**: DK5; `landing_state`.
- **Source**: R:F-2 (link status with unknowable share).
- **Answers**: register flaw K-24.
- **Test**: `M:mutate` (removing a repo raises the unlinked share, not waste).
- **Tracks**: TK2.

### DF-080 Wording lint
- **Sees and does**: nothing; text that would overclaim is never shown.
- **In / Out**: all generated text and the README / pass or fail.
- **Default**: "proved" reserved for the core solver path; "as good as" only after equivalence; "regressed" only with a verdict; "billed" only for billed class; "caused by" never for attribution.
- **On failure**: build fails on README or deck text; generated sentences fail the Auditor.
- **Module, tables**: M4, DK10.
- **Source**: core wording lint (Plumbline spec 9a).
- **Answers**: CLAUDE.md rule 9.
- **Test**: `NEW:wording-lint-corpus`.
- **Tracks**: TK2.

### DF-081 Published canary simulation
- **Sees and does**: reads the published false-alarm rate, power curve, platform-confound, one-task, cache-leak and judge-noise results with seeds and assumptions, whichever way they fall.
- **In / Out**: the simulator / tables regenerated by one command.
- **Default**: 500 null histories; drops of 2, 3, 5, 8, 10, 15 points.
- **On failure**: a result that misses its bar is published as missed.
- **Module, tables**: DK6, M11.
- **Source**: §16.5; dedrift's published 3.2% single-window rate as comparison.
- **Answers**: RT-146, §18 item 5.
- **Test**: `S:false-alarm`, `S:power-curve`, `S:platform-confound`, `S:one-task-regression`, `S:cache-leak`, `S:judge-noise`.
- **Tracks**: TK3.

### DF-082 Published replay calibration
- **Sees and does**: reads self-replay coverage, the known-worse result, side-effect safety and divergence accounting.
- **In / Out**: replay harness / tables.
- **Default**: 200 self-replays.
- **On failure**: published as missed.
- **Module, tables**: DK7, M11.
- **Source**: §16.6.
- **Answers**: RT-145.
- **Test**: `RC:self-replay`, `RC:known-worse-route`, `RC:side-effect-safety`, `RC:divergence-accounting`.
- **Tracks**: TK3.

### DF-083 Sources and doctor: what the Desk cannot know
- **Sees and does**: on Sources and doctor, sees adapters found, each capability declaration ("no: tool results"), cursors, unpriced models, stale rows, Zetaris status, model endpoint status, SAMPLE_MODE banner.
- **In / Out**: declarations and status probes / the screen.
- **Default**: check-only; writes nothing.
- **On failure**: each dependency down shows its banner (§14.3).
- **Module, tables**: DK1, DK12.
- **Source**: §5.1; Plumbline DF-005 doctor pattern.
- **Answers**: none.
- **Test**: `NEW:doctor-fault-matrix` (each source killed in turn matches the expected banner).
- **Tracks**: TK1.

### DF-084 Failure drills and every error state
- **Sees and does**: each named error state of §14.3 with its banner and next action.
- **In / Out**: killed dependencies / honest states.
- **Default**: as §16.1.
- **On failure**: n/a.
- **Module, tables**: all.
- **Source**: §16.1, §14.3.
- **Answers**: organizer red flag "fail offline or when an API is down".
- **Test**: every `D:` drill.
- **Tracks**: TK3.

### DF-085 Published role-necessity and engine ablations
- **Sees and does**: reads which roles changed outcomes (arms A0 to A7) and which Meterless engines changed outputs; a role that fails becomes code and the README says so; an engine with no effect is not claimed.
- **In / Out**: ablation runs / tables.
- **Default**: run on Desk questions.
- **On failure**: published as is.
- **Module, tables**: DK10, M11, M12.
- **Source**: core spec section 15; §12.1, §13.2.
- **Answers**: organizer "quality of interaction beats number of agents".
- **Test**: `A:role-ablation`, `A:engine-ablation`.
- **Tracks**: TK3.

### DF-086 Clean-room verification from the README
- **Sees and does**: a stranger follows the README literally from a fresh clone.
- **In / Out**: the repository / a pass or a list of failures.
- **Default**: documented install only, no runtime installs; SAMPLE_MODE demo; verifier; mutate; drills; with keys, one live Nemotron call and one Zetaris query; repo size check and secret scan.
- **On failure**: any manual step not in the README is a failure.
- **Module, tables**: all.
- **Source**: §16.8.
- **Answers**: organizer red flag "manual steps not in the README".
- **Test**: `CR`.
- **Tracks**: TK3.

### DF-087 Themes, accessibility and charts with tables
- **Sees and does**: light and dark; class chips distinguishable without colour; every chart with a table beside it; every number keyboard-reachable with its provenance popover.
- **In / Out**: the UI / WCAG 2.2 AA.
- **Default**: system theme.
- **On failure**: n/a.
- **Module, tables**: DK12, M10.
- **Source**: §14.4; core M10 gate.
- **Answers**: none.
- **Test**: core M10 accessibility gate (axe-core zero serious or critical); `NEW:visual-matrix` (screenshot per screen × light/dark × desktop/mobile, read and judged, per the QA master guide).
- **Tracks**: TK2.

## 12a. Added features: the demand and gap pass (DF-088 to DF-102)

### DF-088 Supervision attention-load governor and review-overhead meter
- **Sees and does**: sees operator attention-load metrics, active concurrent agent sessions, and approval interruption rates per hour; throttles or denies launching new agent sessions when projected human review load exceeds the operator's attention budget; tracks operator review duration per approval and records human overhead cost into session spend.
- **In / Out**: active `session` count, pending `decision` approvals, attention budget / throttled dispatch, attention load index, `review_overhead` cost events.
- **Default**: max 4 concurrent active agents per operator; max 10 approval interruptions per operator-hour; review overhead cost priced at $120.00/hr ($33,333 micro-USD/s); warning alert at 80% load; blocks new agent starts at 100% load.
- **On failure**: fails closed; approval requests queue and 5th concurrent agent launch is denied (`attention_budget_exceeded`); manual bypass requires explicit operator confirmation recorded in `gate_bypass`.
- **Module, tables**: DK8, DK11; reads `policies`, `budget`, `session`, `decision`; writes `decision`, `cost_estimate`, `attention_snapshots`.
- **Source**: Idea 226 (`Supervision Load Governor`), Profile 83 (`microsoft-agent-governance-toolkit`), Profile 90 (`codelens-ai`).
- **Answers**: Problem 208 (claims 2555, 2556, 2557, 2559, 2560, 2561, 2562, 2563, 2564, 2565, 2582, 2583, 2584, 2595, 2596, 2598).
- **Test**: `NEW:supervision-governor-throttle` (blocks 5th concurrent agent when operator limit is 4; verifies review duration overhead added to session cost).
- **Tracks**: TK2, TK3.

### DF-089 Prompt-cache invalidation root-cause analyzer
- **Sees and does**: inspects consecutive model calls within sessions; on cache misses (`cache_read_input_tokens == 0` or drop $>90\%$ on turns with prompt $\ge 1,024$ tokens), diffs serialized prompt prefix ASTs and metadata to attribute the root cause (`ttl_expiry`, `model_switch`, `system_prompt_mutation`, `client_update`); quantifies avoidable token churn and attributes dollars under waste class `C-CACHE-MISS`.
- **In / Out**: `model_call` token breakdowns, prompt text ASTs, timestamps / cache miss root-cause diagnosis, diff summary, `cost_estimate` with `C-CACHE-MISS`.
- **Default**: cache activation threshold 1,024 tokens; TTL threshold 300 s (Claude Code) or 3,600 s (API) based on provider; avoidable waste priced as `(uncached_input_rate - cached_input_rate) * reprocessed_tokens`.
- **On failure**: redacted or unavailable prompt text falls back to timestamp and model ID heuristics; AST mutations labelled `unverifiable_redacted`.
- **Module, tables**: DK3, DK5; reads `model_call`, `turn`, `price_row`; writes `cost_estimate` (`waste_class = 'C-CACHE-MISS'`), `cache_invalidation_events`.
- **Source**: Profile 108 (`cnighswonger-claude-code-cache-fix`), Profile 57 (`ccusage`).
- **Answers**: Problem 140 (claims 1603, 1604, 1605, 1606, 1607, 1608).
- **Test**: `NEW:cache-miss-root-cause` (detects TTL expiry vs tool definition edit in prompt AST; verifies `C-CACHE-MISS` waste dollar attribution).
- **Tracks**: TK1, TK2.

### DF-090 Tool-call idempotency key guard
- **Sees and does**: intercepts tool execution requests at the reserve endpoint and gateway door; hashes call arguments into a durable idempotency key; checks against active and settled tool reservations; prevents duplicate execution of mutating side effects (payments, tickets, emails) and duplicate spend debits on network timeouts, retries, or checkpoint resumptions.
- **In / Out**: tool execution requests (`session_id`, `tool_name`, arguments) / cached tool results, deduplicated reservation events (`idempotent_replayed`).
- **Default**: mutating and unknown tools deduplicated over a 300 s window; read-only tools pass through unless explicitly flagged; exactly-once semantics enforced before outbound dispatch or ledger reservation.
- **On failure**: hash collision or locked ledger fails closed; duplicate execution blocked.
- **Module, tables**: DK4, DK11; reads `tool_call`, `reservation_event`; writes `reservation_event`, `tool_idempotency_keys`.
- **Source**: Profile 81 (`manas-33-reenact`), Profile 66 (`figuard-core`).
- **Answers**: Problem 134 (claims 1557, 1558, 1559, 1560, 1561, 1562, 1990).
- **Test**: `NEW:tool-idempotency-dedup` (20 consecutive retries of mutating tool call execute exactly once; zero duplicate charges or outbound requests).
- **Tracks**: TK1, TK3.

### DF-091 Quota-aware plan router
- **Sees and does**: monitors remaining runway across the owner's own plans, tools and API keys; recommends or routes the next task, by policy route rule, to another tool or model the owner legitimately holds when one is close to its rolling 5-hour or weekly limit; checkpoints before a stop. It never pools, shares or rotates accounts of the same vendor to defeat a limit (spec 2.2).
- **In / Out**: model call requests, policy route rules, `quota_snapshot` / chosen plan route, reserved budget debit, route dispatch log.
- **Default**: routes to plan with highest remaining runway; triggers failover when remaining runway $< 15$ minutes or remaining quota $< 5\%$; minimum buffer reserve 20,000 tokens.
- **On failure**: all of the owner's own plans exhausted queues requests until nearest reset window or cleanly refuses with `quota_runway_depleted`; never drops calls silently.
- **Module, tables**: DK8, DK11; reads `quota_snapshot`, `plan_row`, `policy_version`, `budget`; writes `reservation_event`, `route_dispatches`.
- **Source**: Profile 58 (`steipete-codexbar`), Profile 61 (`berriai-litellm`).
- **Answers**: Problem 187 (claims 2334, 2335, 2337, 2338, 2339, 2340, 2341, 2775, 2776, 2784, 2845).
- **Test**: `NEW:quota-aware-routing` (routes to the owner's second tool when the first hits 95% of its 5-hour window cap; verifies zero downtime or rate limit errors).
- **Tracks**: TK2, TK3.

### DF-092 Tool-output silent-truncation waste detector
- **Sees and does**: checks returned tool output byte lengths and line counts against declared harness buffer limits; detects unnotified truncations lacking pagination or sentinel markers; flags subsequent futile turns where the model repeats read commands or hallucinates truncated contents; attributes futile token spend to waste class `C-TRUNC`.
- **In / Out**: `tool_call` raw output bytes, harness configuration, subsequent turns / `truncation_events`, `cost_estimate` tagged `C-TRUNC`.
- **Default**: truncation flagged if tool output byte length matches harness limit ($\pm 4$ bytes) without pagination sentinel; subsequent turns until next productive diff or passing check billed as `C-TRUNC`.
- **On failure**: unknown harness limit flags `potential_truncation` without billing waste until confirmed by repeating command loop or error echo.
- **Module, tables**: DK5; reads `tool_call`, `turn`, `session`, `model_call`; writes `cost_estimate` (`waste_class = 'C-TRUNC'`), `tool_truncation_events`.
- **Source**: Profile 88 (`spiatrenka-coding-agent-flight-recorder`), P-153 research preprint.
- **Answers**: Problem 153 (claims 1735, 1736, 1737, 1738, 1739).
- **Test**: `NEW:tool-truncation-waste` (harness truncates 30KB file at 25KB; model repeats `cat`; asserts 2nd turn spend flagged `C-TRUNC`).
- **Tracks**: TK1, TK2.

### DF-093 Earned-autonomy promotion and demotion matrix per workflow
- **Sees and does**: tracks empirical landing rates, check pass rates, and revert frequencies per workflow category; promotes workflows from `require_human` to `auto_approve` when statistical lower bound clears landing threshold over minimum task volume; demotes immediately to supervised execution upon any revert or statistically significant quality degradation.
- **In / Out**: `outcome_fact`, `task`, `policies` / workflow autonomy tier (`blocked`, `supervised`, `guarded_auto`, `unassisted_auto`), policy diff proposal.
- **Default**: minimum cohort $N = 30$ tasks; promotion requires Wilson 95% lower bound $\ge 0.90$ landing rate without revert over 14 days; demotion triggered immediately by 1 revert within 7 days or lower bound $< 0.85$; promotion requires human approval echo (DF-049); demotion is automatic and instant.
- **On failure**: insufficient task history ($N < 30$) stays pinned to `supervised` default (default deny of unassisted execution).
- **Module, tables**: DK8, DK11; reads `outcome_fact`, `task`, `policy_version`; writes `policy_version`, `workflow_autonomy_state`.
- **Source**: Profile 83 (`microsoft-agent-governance-toolkit`), Idea 268 (`Combined: Earned Autonomy Desk`), Idea 265 (`F-1470`).
- **Answers**: demand claims: none linked in the database; motivated by Profile 83, Idea 268, and Idea 265.
- **Test**: `NEW:earned-autonomy-demotion` (planted revert immediately downgrades workflow from `guarded_auto` to `supervised`; auto-approve disabled).
- **Tracks**: TK2, TK3.

### DF-094 Multi-agent delegation handoff cost tree
- **Sees and does**: traces multi-agent execution hierarchies using OpenTelemetry delegation span conventions (`gen_ai.handoff.*`, `{from_agent} -> {to_agent}`); builds recursive delegation tree rolling up cumulative tokens, tool costs, latency, and waste from subagents to the root coordinator; attributes runaway child agent spend to delegating parents.
- **In / Out**: `session` parent-child links, OTel delegation spans / hierarchical delegation tree, coordinator rollup figures, delegation cost shares.
- **Default**: recursive cost rollup sums all descendant subagent spend to root coordinator; flags delegation loops and delegation depths exceeding 5 hops.
- **On failure**: orphaned spans without parent links attach to `unlinked_delegation` root without corrupting verified trees.
- **Module, tables**: DK1, DK3; reads `session`, `model_call`, `cost_estimate`; writes `v_spend_by`, `delegation_tree_nodes`.
- **Source**: Profile 100 (`traceloop-openllmetry`).
- **Answers**: demand claims: none linked in the database; motivated by Profile 100.
- **Test**: `NEW:delegation-tree-rollup` (coordinator spawning 3 subagents correctly aggregates total spend and identifies child runaway spend).
- **Tracks**: TK1, TK2.

### DF-095 Share-weighted idle and shared-overhead allocation engine
- **Sees and does**: allocates unallocated background agent spend, scheduled heartbeat tokens, shared daemon runtime, and gateway baseline costs across active projects and landed tasks using the OpenCost `ShareWeighted` 11-step mathematical allocation algorithm; preserves total spend conservation without leaking or inventing dollars.
- **In / Out**: unallocated `cost_estimate` (`C-IDLE`, `C-ORPHAN`, shared), landed task metrics / `overhead_allocations` in `v_spend_by`, fully burdened project spend.
- **Default**: overhead allocated proportionally to each project's share of total landed task value; projects with zero landed tasks receive zero overhead allocation; exact dollar conservation ($\sum \text{allocated} = \text{total unallocated}$).
- **On failure**: zero landed tasks across all projects leaves overhead in `unallocated_idle` bin, never arbitrarily divided or discarded.
- **Module, tables**: DK3, DK5; reads `cost_estimate`, `outcome_fact`, `task`; writes `overhead_allocations`, `v_spend_by`.
- **Source**: Profile 107 (`opencost-opencost`).
- **Answers**: Problem 181 (claims 2044, 2274, 2275, 2276, 2277, 2324).
- **Test**: `NEW:opencost-share-weighted-conservation` (proportional idle distribution sums exactly to total idle cost without rounding drift).
- **Tracks**: TK1, TK2.

### DF-096 Phase-based context-bloat accounting across compactions
- **Sees and does**: tracks token growth phases across sequential context-compaction events in long-running agent sessions; computes pre-compaction token accumulation versus retained tokens ($\sum \text{pre}_i - \text{post}_{i-1}$); identifies transient tool output tokens discarded at compaction without landing code; detects immediate post-compaction file re-reads; records wasted tokens under `C-BLOAT`.
- **In / Out**: `turn` records with `is_compact_boundary`, `model_call` token metrics / compaction phase metrics, re-read waste, `cost_estimate` tagged `C-BLOAT`.
- **Default**: compaction phase bounded by successive `is_compact_boundary = true` turns; transient tool output $> 50,000$ tokens yielding no diff lines flagged as churn; post-compaction re-reads within 3 turns flagged as dropped-context waste.
- **On failure**: sessions without compaction boundaries evaluated under standard single-turn bloat rules (§7.4).
- **Module, tables**: DK3, DK5; reads `turn`, `model_call`, `tool_call`; writes `cost_estimate` (`waste_class = 'C-BLOAT'`), `compaction_phases`.
- **Source**: Profile 105 (`matt1398-claude-devtools`).
- **Answers**: Problem 12 (claims 117, 118, 119, 120, 1133, 1134, 1754).
- **Test**: `NEW:compaction-phase-bloat` (measures cumulative pre-compaction token waste and immediate post-compaction file re-reads).
- **Tracks**: TK1, TK2.

### DF-097 Replay workspace snapshot including untracked scratch files
- **Sees and does**: captures 3-parent git shadow snapshots during canary task capture and replay checkpointing (HEAD commit, staged index, untracked scratch files); stores snapshot in git object store on detached ref without altering active working tree; restores untracked scratch files into replay sandbox, ensuring 100% bit-exact replay reproduction.
- **In / Out**: workspace filesystem, git repository state / 3-parent shadow commit hash, `canary_task` / `replay_item` snapshot reference.
- **Default**: captures untracked non-ignored files up to 25MB total; excludes `.git/` and credential paths per §15.2; writes shadow commit to `refs/desk/snapshots/*`.
- **On failure**: snapshot $>25\text{MB}$ or dirty lock flags `snapshot_partial` and records warning; replay diverges rather than faking environment.
- **Module, tables**: DK6, DK7; reads local git worktree; writes `canary_task.snapshot_ref`, `replay_item.snapshot_ref`, `workspace_snapshots`.
- **Source**: Profile 106 (`cline-cline`).
- **Answers**: demand claims: none linked in the database; motivated by Profile 106.
- **Test**: `NEW:three-parent-snapshot-restore` (captures untracked scratch file in shadow commit; restores bit-exact in isolated replay sandbox).
- **Tracks**: TK3.

### DF-098 Verbosity-bias penalty and bidirectional swap scoring in replay
- **Sees and does**: evaluates paired replay comparisons using bidirectional position swapping (A vs B, B vs A) across judge panels; eliminates position bias by requiring swap consistency; applies token length penalty to candidate responses that achieve judge preference through padded, verbose prose without improving unit test outcomes; computes calibrated length-normalized win rate.
- **In / Out**: paired replay completions from `replay_item`, judge scores / bidirectional preference score, verbosity penalty delta, calibrated win rate.
- **Default**: swap consistency required: conflicting verdicts ($A > B$ and $B > A$) marked inconsistent and scored as ties ($0.5$); verbosity penalty applied when candidate length $> 1.3\times$ baseline without test improvements.
- **On failure**: inconsistent verdicts scored as neutral ties ($0.5$), never counted as passes for verbose models.
- **Module, tables**: DK7, DK10; reads `replay_item`, `replay_run`; writes `replay_item`, `replay_run.length_normalized_win_rate`.
- **Source**: Desk Paper 03 (`03-routellm-learning-to-route-llms-with-preference-data.md`), Desk Paper 04 (`04-judging-llm-as-a-judge-with-mt-bench-and-chatbot-arena.md`).
- **Answers**: demand claims: none linked in the database; motivated by Desk Paper 03 and Desk Paper 04.
- **Test**: `NEW:bidirectional-verbosity-penalty` (artificially padded model answer is penalized; position-inconsistent judge evaluations discarded).
- **Tracks**: TK3.

### DF-099 E-process anytime-valid canary monitor
- **Sees and does**: upgrades the canary `watch` flag to a game-theoretic safe anytime-valid e-process; evaluates sequential daily task outcomes by accumulating non-negative test martingale capital ($M_t = \prod S_i$); controls family-wise Type-I error $\le \alpha$ under continuous daily monitoring and arbitrary stopping times without alpha-spending penalties; triggers regression alert when capital $M_t \ge 1/\alpha$.
- **In / Out**: daily task scores from `canary_sample`, null bound / cumulative test martingale wealth $M_t$, anytime-valid regression verdict.
- **Default**: significance level $\alpha = 0.05$ (alert threshold $M_t \ge 20$); betting payoff $S_i$ constructed via Universal Inference mixture; minimum 7 daily observations before alert can fire.
- **On failure**: invalid score or missing canary run sets $S_i = 1$ (wealth unchanged), preserving exact supermartingale property without false alarms.
- **Module, tables**: DK6; reads `canary_sample`, `canary_run`; writes `canary_verdict`, `canary_e_process_history`.
- **Source**: Desk Paper 07 (`07-game-theoretic-statistics-and-safe-anytime-valid-inference.md`).
- **Answers**: demand claims: none linked in the database; motivated by Desk Paper 07.
- **Test**: `NEW:e-process-anytime-validity` (null simulation of 1,000 days shows lifetime false alarm rate strictly $\le 0.05$; synthetic drop triggers alert).
- **Tracks**: TK3.

### DF-100 Ungrounded-reflection-loop waste detector
- **Sees and does**: inspects reasoning turns and internal thoughts in agent trajectories; detects consecutive self-reflection, planning, or self-critique turns occurring without intervening tool execution or environment feedback; flags cognitive stalling loops where the agent burns tokens fruitlessly; bills wasted tokens under waste class `C-UNREF`.
- **In / Out**: turn text, tool call sequence / reflection turn count, ungrounded loop flag, `cost_estimate` tagged `C-UNREF`.
- **Default**: $\ge 3$ consecutive assistant reasoning/reflection turns without tool invocation or test execution; prices all tokens in 3rd and subsequent turns as `C-UNREF`.
- **On failure**: turns containing valid tool calls or file reads never classified as `C-UNREF`.
- **Module, tables**: DK5; reads `turn`, `tool_call`, `model_call`; writes `cost_estimate` (`waste_class = 'C-UNREF'`), `reflection_loop_events`.
- **Source**: Desk Paper 10 (`10-reflexion-language-agents-with-verbal-reinforcement-learning.md`).
- **Answers**: demand claims: none linked in the database; motivated by Desk Paper 10.
- **Test**: `NEW:ungrounded-reflection-detector` (agent emitting 3 consecutive verbose self-reflections without tool call is flagged; turn 3+ billed `C-UNREF`).
- **Tracks**: TK1, TK2.

### DF-101 Structured tool-output alignment and continuous scoring in canary and replay
- **Sees and does**: aligns and scores structured JSON tool outputs and multi-step tool calls in canary and replay evaluations; resolves unordered collections and dictionary keys using Kuhn-Munkres (Hungarian algorithm) minimum-cost bipartite matching; scores continuous similarity $\in [0, 1]$ via normalized field-level edit distance and logprob-weighted token confidence, replacing fragile binary equality.
- **In / Out**: observed tool output JSON, reference tool output JSON, token logprobs / optimal bipartite alignment mapping, continuous alignment score $\in [0, 1]$.
- **Default**: Hungarian matching cost matrix based on field presence and value distance; field weights: key presence 0.3, value equivalence 0.7; passing threshold $\ge 0.85$; filters logprobs $< \ln(0.01)$.
- **On failure**: non-JSON text output falls back to token Levenshtein similarity with confidence marked `low`.
- **Module, tables**: DK6, DK7; reads `canary_sample`, `replay_item`; writes `canary_sample`, `replay_item`, `tool_alignment_details`.
- **Source**: Profile 103 (`confident-ai-deepeval`), Profile 104 (`braintrustdata-autoevals`).
- **Answers**: demand claims: none linked in the database; motivated by Profile 103 and Profile 104.
- **Test**: `NEW:bipartite-tool-alignment` (reordered JSON keys and array elements score 1.0; near-match values receive continuous score $> 0.85$).
- **Tracks**: TK3.

### DF-102 Standard in-toto statement and Sigstore-bundle packaging of dossiers
- **Sees and does**: packages Desk monthly spend dossiers, policy gate audit trails, and canary regression verdicts as standardized in-toto Statement v1 attestation predicates wrapped in DSSE (Dead Simple Signing Envelope) and Sigstore v0.3 bundles; enables external auditors and insurers to verify signed dossiers offline using standard tools (`cosign verify-blob-attestation`) without custom binaries.
- **In / Out**: `dossier` claims, ledger event Merkle roots, signing keys / in-toto Statement v1 JSON (`predicateType: urn:desk:attestation:spend-dossier:v1`), Sigstore bundle v0.3 file.
- **Default**: in-toto Statement v1 format; DSSE envelope with PAE encoding; Sigstore bundle includes ECDSA signature, verification certificate/key, and RFC 3161 timestamp; verified offline via `desk verify-bundle` or `cosign`.
- **On failure**: invalid signature, corrupted payload, or Merkle root mismatch fails verification closed (`exit code 1`, `ATTESTATION_VERIFICATION_FAILED`).
- **Module, tables**: DK8, DK11, M9; reads `dossier`, `policy_version`, `reservation_event`; writes `dossier.bundle_path`, `dossier_attestations`.
- **Source**: Profile 109 (`in-toto-attestation`), Profile 110 (`sigstore-cosign`).
- **Answers**: demand claims: none linked in the database; motivated by Profile 109 and Profile 110.
- **Test**: `NEW:intoto-sigstore-bundle-verify` (generates month dossier bundle; verified offline with `cosign verify-blob-attestation`; detects byte tampering).
- **Tracks**: TK1, TK3.

## 12b. Added features: reasoning-architecture upgrades (DF-103 to DF-110)

### DF-103 Policy Attacker
- **Sees and does**: runs an adversarial agent role against each drafted policy diff before presentation to the owner; enumerates elementary cells in the restrict-check grid, queries the model for semantic evasions (task splitting under single-call caps, model-name aliasing, unmetered tool routes, window-boundary bursts), tests candidates against the policy replay engine, and flags open evasions with replayed token and dollar evidence; the Policy Drafter must revise to close holes or the proposal escalates carrying the open evasions.
- **In / Out**: proposed `policy_version` diff, `restrict_check` elementary cells, recent session traces / `policy_evasion_report` (attack attempts, successful evasion traces, bypassed limits, leakage amount), revised policy proposal.
- **Default**: 2 adversarial attack rounds; max 10 exploit candidates per round; 60 s wall-clock timeout per round; attacks spend from the Desk's reserved Nemotron budget.
- **On failure**: model failure falls back to deterministic cell-boundary probing (set-boundary values and unmetered tool routes); if the attack engine crashes, the diff is flagged `attacker_unverified` and requires explicit owner acknowledgement before approval.
- **Module, tables**: DK10, DK8, DK7; reads `policy_version`, `model_call`, `tool_call`, `reservation_event`; writes `policy_attack_runs`, `policy_evasions`.
- **Source**: Profile 73 (`promptfoo/promptfoo`, `src/redteam/index.ts:42,56`), Profile 84 (`NVIDIA-NeMo/Guardrails`), Profile 85 (`Cedar`).
- **Answers**: RT-144 (policy loopholes bypass spend caps), RT-184 (automated governance verification).
- **Test**: `NEW:seeded-policy-exploit` (seeded policy with a known loophole must be discovered by Policy Attacker and reported with replayed evasion evidence).
- **Tracks**: TK3.

### DF-104 Reliability over repeated runs
- **Sees and does**: benchmarks Ask-the-Desk analytical questions and Policy Drafter tasks run $k$ times each on a frozen ledger benchmark; computes and publishes the tau-bench $\text{pass}^k$ consistency metric ($\mathbb{E}[(c/n)^k]$) across repeated runs rather than single-run passes; surfaces flakiness, variance, and consistency degradation under model non-determinism.
- **In / Out**: 20 Ask-the-Desk questions and 10 Policy Drafter task fixtures from the sample month, $k$ repeats (default $k=5$) / published reliability table ($\text{pass}^1, \text{pass}^3, \text{pass}^5$, consistency drop, token cost per task).
- **Default**: $k=5$ repeats; $N=30$ total tasks; temperature 0.2; ground truth derived from deterministic ledger SQL queries and restrict-check narrowing proofs.
- **On failure**: execution error or timeout on trial $i$ records $c_i=0$; missing ground truth fixture aborts the benchmark run with `BENCHMARK_FIXTURE_CORRUPTED`.
- **Module, tables**: DK10, M11; reads `claim`, `task`, `outcome_fact`, `policy_version`, `DeskRunState`; writes `benchmark_runs`, `benchmark_task_results`.
- Source: Desk Paper 05 (`tau-bench`, arXiv:2406.12045), Profile 74 (`Inspect`), Profile 112 (`EleutherAI/lm-evaluation-harness`).
- **Answers**: RT-146 (single-run cherry-picking hides agent unreliability), RT-186.
- **Test**: `NEW:tau-reliability-pass-k` (executes 5-run benchmark on golden questions; computes exact $\text{pass}^k$; asserts $\text{pass}^5 \le \text{pass}^1$).
- **Tracks**: TK3.

### DF-105 Precedent memory and outcome tracking
- **Sees and does**: records every approved policy change, its policy diff, replay forecast, and later realized outcomes (sessions paused, dollars saved, landed tasks blocked) as immutable precedent records; when drafting a new policy, queries precedent memory and cites the closest precedents directly in the proposal ("You set this cap on 3 September; since then it paused 14 sessions and blocked 0 landed tasks") using Meterless H-MEM supersession rules.
- **In / Out**: proposed policy diff context / retrieved precedent citations with realized operational outcomes; new precedent record written on approval.
- **Default**: retrieves top-3 precedents with similarity score $\ge 0.35$ using H-MEM hybrid ranking; earlier modified precedents marked `superseded_by` and never deleted.
- **On failure**: precedent store unavailable or empty returns "no historical precedent found" and drafts from first principles without blocking drafting.
- **Module, tables**: DK8, DK10, M6 (Meterless H-MEM); reads `policy_version`, `decision`, `reservation_event`, `outcome_fact`; writes `policy_precedents`, `precedent_outcomes`.
- **Source**: Profile 33 (`meterless/meterless`, `engines/hmem/AGENTS.md:152-161, 329`), Profile 04 (`agiresearch/a-mem`).
- **Answers**: RT-185 (policy changes repeated without learning from past impact).
- **Test**: `NEW:precedent-memory-citation` (asserts drafted policy diff cites matching precedent with realized outcomes; verifies superseded precedents receive negative weight).
- **Tracks**: TK3.

### DF-106 Multi-surface confidence calibration and ECE tuning
- **Sees and does**: computes Expected Calibration Error (ECE) and plots reliability diagrams across all four Desk judgment surfaces (attribution confidence, forecast intervals, judge-panel scores, Auditor factuality scores); tunes abstain and human-escalation thresholds empirically against the owner's historical labeled data; publishes calibration scorecards in the dossier.
- **In / Out**: historical predictions and ground-truth outcomes across attribution, forecasts, judge ratings, auditor checks / binned calibration curves, ECE metrics, calibrated abstain thresholds ($\tau_{\text{abstain}}$).
- **Default**: $M=10$ equal-width probability bins; minimum 50 samples per evaluation surface; abstain threshold tuned to target empirical precision $\ge 80\%$.
- **On failure**: insufficient historical samples ($N < 50$) falls back to conservative default thresholds (attribution 0.70, judge panel 0.85, auditor 0.80) labeled `uncalibrated_default`.
- **Module, tables**: DK5, DK6, DK10, M11; reads `outcome_fact`, `forecasts`, `canary_sample`, `claim`, `decision`; writes `calibration_curves`, `calibration_metrics`.
- **Source**: Profile 81 (`manas-33-reenact`, `evals/calibration.py:33-35`), Profile 68 (`krulewis-tokencast`), Desk Paper 04 (`Judging LLM-as-a-judge`, arXiv:2306.05685).
- **Answers**: RT-145 (uncalibrated confidence scores mislead operators).
- **Test**: `NEW:confidence-calibration-ece` (computes ECE across attribution, forecast, judge, and auditor bins; asserts abstain threshold trips when empirical accuracy $< 0.80$).
- **Tracks**: TK3.

### DF-107 Value-of-information question governor
- **Sees and does**: evaluates the Expected Value of Information (EVOI) before prompting the human owner with an attribution confirmation or policy decision; computes the counterfactual change in headline metrics via policy replay under YES versus NO; compares EVOI against the real-time cognitive interruption cost from the supervision attention-load governor; asks immediately only when $\text{EVOI} > C_{\text{interrupt}}$, otherwise queues for weekly review.
- **In / Out**: ambiguous attribution or policy approval prompt, current attention load $L_t$ / immediate interactive interruption, or queued asynchronous question with conservative default applied.
- **Default**: operator review cost $R_{\text{operator}} = \$120.00/\text{hr}$ ($33,333\ \mu\text{USD/s}$); context-switch penalty 180 s; conservative fallback applied on suppression (shadow mode for policy, exclude from billed for attribution).
- **On failure**: if attention load meter or replay engine is unavailable, fails safe by queueing questions without interrupting the operator.
- **Module, tables**: DK8, DK10, DK11; reads `attention_snapshots`, `policy_version`, `reservation_event`, `decision`; writes `owner_questions`, `decision` (`voi_expected_gain_micros`, `voi_interruption_cost_micros`, `suppressed_by_voi`).
- **Source**: Gap Analysis Item 1 / DF-088 (`Supervision attention-load governor`), Profile 83 (`microsoft-agent-governance-toolkit`), Howard (1966) Value of Information theory.
- **Answers**: RT-188 (reviewers rubber-stamp when interrupted with low-value questions).
- **Test**: `NEW:voi-interruption-governor` (asserts low-value $1.50 attribution question is suppressed during high attention load; high-value $500 policy decision interrupts).
- **Tracks**: TK3, TK2.

### DF-108 Causal explanation faithfulness and minimal-flip validation
- **Sees and does**: subjects every factual claim cited in Ask-the-Desk answers and month-close summaries to a leave-one-out perturbation test; flags citations whose removal does not alter the generated conclusion as decorative; validates the identified minimal flip fact by actually mutating the input ledger and recomputing the pipeline to prove causal necessity.
- **In / Out**: generated explanation with cited claims, underlying ledger snapshot / faithfulness score (essential vs decorative citation ratio), minimal-flip validation certificate.
- **Default**: leave-one-out perturbation across all cited claims; perturbation budget capped at 5 model re-evaluations per answer; decorative claims highlighted in the UI claim chip view.
- **On failure**: if re-prompt budget exhausts, claims are labeled `faithfulness_untested_budget_exceeded`; does not alter the factual claim ledger.
- **Module, tables**: DK10, M4; reads `claim`, `turn`, `DeskRunState`; writes `claim_faithfulness_tests`.
- **Source**: Desk Paper 08 (`ALCE`, arXiv:2305.14627), Desk Paper 09 (`FActScore`, arXiv:2305.14251), Profile 11 (`princeton-nlp/ALCE`), Profile 12 (`shmsw25/FActScore`).
- **Answers**: RT-145 (decorative citations and unfaithful explanations masquerading as reasoning).
- **Test**: `NEW:explanation-faithfulness-perturbation` (decorative citation injected into prompt is detected and flagged; minimal flip confirmed by input recomputation).
- **Tracks**: TK3, TK2.

### DF-109 Published reasoning scorecard and ablation ledger
- **Sees and does**: publishes a unified evaluation page reporting role-necessity ablations (arms A0 to A7), Meterless engine ablations, repeated-run $\text{pass}^k$ curves, calibration ECE, explanation faithfulness, and adversarial policy attack survival; publishes the exact seeds, cassette digests, and CLI commands to reproduce every number offline; enforces honest-negative rules where roles that fail ablation are converted to deterministic code.
- **In / Out**: recomputed ablation suites, benchmark runs, calibration tables / formatted Markdown/HTML scorecard, signed verification receipts.
- **Default**: published at `docs/evaluation/reasoning-scorecard.md` and accessible via `desk scorecard`; regenerated via `desk bench reasoning --seed 1234`.
- **On failure**: any unmeasured or non-reproducible metric is printed as NOT VERIFIED; failed role ablations mandate code demotion.
- **Module, tables**: DK10, M11, M12; reads `benchmark_runs`, `calibration_metrics`, `claim_faithfulness_tests`, `policy_attack_runs`, `ablation_results`; writes `reasoning_scorecards`.
- **Source**: Profile 112 (`EleutherAI/lm-evaluation-harness`), Profile 74 (`ukgovernmentbeis/inspect_ai`), Profile 75 (`ninjahawk/livenerf`).
- **Answers**: RT-146 (unsupported claims of agent superiority), organizer Track 3 criteria.
- **Test**: `NEW:reasoning-scorecard-reproduce` (executes published scorecard commands with pinned seeds; verifies table numbers regenerate byte-identically; ablated useless role becomes code).
- **Tracks**: TK3.

### DF-110 Deterministic reasoning replay from signed dossiers
- **Sees and does**: re-executes any recorded Desk governance decision (Risk Router -> Planner -> Drafter -> Explainer -> Auditor) byte-identically from the signed dossier; serves model calls from verified request cassettes and tool calls from recorded outputs; verifies that every intermediate state transition, token calculation, and final action digest matches the signed attestation bit-for-bit.
- **In / Out**: signed dossier path (`month_bill`, `policy_change`, `canary_evidence`) / verification terminal log: level V9-D byte-identical state reproduction pass/fail.
- **Default**: offline execution with network disconnected; zero non-determinism allowed (PRNG seeds and timestamps frozen to dossier manifest values); command `desk replay-decision <dossier_path>`.
- **On failure**: hash mismatch at any step halts replay with exact JSON diff of diverged state; dossier marked `replay_diverged` (exit code 1).
- **Module, tables**: DK10, DK8, M9; reads `dossier`, `policy_version`, `decision`, `DeskRunState`; writes `dossier_replays`.
- **Source**: Profile 81 (`manas-33-reenact`, `bench/determinism.py:50-64`), Profile 82 (`zenml-io/kitaru`), Profile 109 (`in-toto/attestation`).
- **Answers**: RT-184 (black-box agent decisions cannot be audited offline).
- **Test**: `NEW:deterministic-reasoning-replay` (runs `desk replay-decision` on closed month dossier; asserts byte-identical re-execution of all intermediate agent states and approval digest).
- **Tracks**: TK3.

## 12c. Added features: the limit autopsy and the own-log card (DF-111 to DF-114)

### DF-111 Limit autopsy
- **Sees and does**: answers the primary developer pain ("I pay for Claude Code or Cursor, I work for two hours, 'limit reached' appears, and I do not know why — where did my limit go?"); analyzes rolling plan windows (5-hour sliding window, 7-day cap, or monthly credit cycle) from local agent logs; partitions consumed limit into 7 mutually exclusive causal buckets: history re-reads (resent conversation history), prompt-cache misses (waste class `C-CACHE-MISS` from TTL expiry, model switches, and tool schema mutations), loops and retries (classes `C-LOOP-1`, `C-LOOP-2`, `C-LOOP-3`, and ungrounded reflection loops `C-UNREF`), sub-agent delegations (recursive child execution trees and orphaned sub-agents `C-ORPHAN`), tool output dumps (raw file dumps, verbose diffs, directory trees, and silent buffer truncations `C-TRUNC`), idle and heartbeat polling (background daemon polling and scheduled loops `C-IDLE`), and model reasoning tokens (chain-of-thought/thinking token surcharges); for subscription seats with no per-token dollar billing, expresses consumption as token share (%) and estimated window time consumed (minutes); explicitly marks vendor internal limit-to-token translation algorithms as NOT VERIFIED.
- **In / Out**: local session logs (`turn`, `model_call`, `tool_call`), `quota_snapshot`, `plan_row` / window autopsy breakdown (`limit_autopsy_breakdown`), cause shares (%), consumed window minutes, unverified vendor conversion disclaimer.
- **Default**: 5-hour rolling window for Claude Code, 7-day window for Cursor/Codex; token-share threshold $\ge 5\%$ for primary cause callouts; vendor limit-to-token mapping labelled `NOT VERIFIED`.
- **On failure**: logs lacking prompt-cache or token-breakdown attributes fall back to total input/output token volume with attribution marked `unverified_breakdown`; missing window reset timestamp defaults to 5-hour sliding window from first turn.
- **Module, tables**: DK1, DK3, DK5, DK9; reads `session`, `turn`, `model_call`, `tool_call`, `quota_snapshot`, `plan_row`; writes `limit_autopsy_events`, `limit_cause_attribution`.
- **Source**: Owner Decision Point 1; Profile 57 (`ccusage`), Profile 58 (`steipete-codexbar`), Profile 108 (`cnighswonger-claude-code-cache-fix`), Profile 88 (`spiatrenka-coding-agent-flight-recorder`), Profile 107 (`opencost-opencost`).
- **Answers**: Problem 3 (claims 52, 53, 54, 55, 56, 57, 60, 61, 1079, 1081), Problem 70 (claims 654, 655, 656, 657, 658, 659, 1153, 1154, 1187), Problem 107 (claims 1272, 1275, 1277, 2846), Problem 140 (claims 1603, 1604, 1605, 1606, 1607, 1608), Problem 181 (claims 2044, 2274, 2275, 2276, 2277, 2324), Problem 187 (claims 2334, 2335, 2337, 2338, 2340, 2784).
- **Test**: `NEW:limit-autopsy-attribution` (asserts window token consumption is partitioned across the 8 causes (including Unattributed) summing to 100%, and vendor mapping is labelled NOT VERIFIED).
- **Tracks**: TK1, TK2.

### DF-112 Your-own-logs result card
- **Sees and does**: generates a self-contained, tamper-evident result card from the operator's or judge's own local logs in under 3 minutes with one command (`desk card` or bare `desk`); operates 100% locally with zero network calls, zero telemetry, and zero credentials required; automatically redacts secrets and PII (API keys, authentication headers, file paths outside repository root, raw prompt literals) before display; displays the limit autopsy breakdown, effective token burn rate, waste percentage, top 3 waste drivers, and a mandatory "What I Could Not Know" disclosure block (explaining missing invoice dollars, unverified vendor quota mapping, and unlinked git landing states without configured repos); never claims exact dollars spent on flat subscription plans, never computes developer productivity metrics, and never guesses unrecorded vendor state; renders simultaneously as a colorized ANSI terminal card and a shareable PNG image (`card.png`) generated locally via embedded SVG rasterization; provides an identical `SAMPLE_MODE=true` card for judges running without personal agent logs.
- **In / Out**: local agent logs (`~/.claude/projects/`, Cursor logs, Codex sessions), redaction rules / ANSI terminal card, shareable `card.png`, JSON summary (`card.json`).
- **Default**: evaluates past 14 days of local logs; redacts all strings with Shannon entropy $\ge 4.5$ and regex patterns for credentials; image generated via embedded SVG/canvas renderer without browser dependencies.
- **On failure**: zero logs detected renders empty-state card with exact searched paths and offers one-click `SAMPLE_MODE` card; malformed log lines skipped and reported in the "What I Could Not Know" block.
- **Module, tables**: DK1, DK3, DK12, M8, M9; reads `model_call`, `session`, `cost_estimate`, `limit_cause_attribution`; writes `result_cards`, `redaction_events`.
- **Source**: Owner Decision Point 2; Profile 58 (`steipete-codexbar`), Profile 77 (`Entire`), Profile 90 (`codelens-ai`), Profile 57 (`ccusage`).
- **Answers**: Problem 3 (claims 54, 57, 61), Problem 70 (claims 657, 658, 659), report criteria `first_value` (5 of 5), RT-186 (judge verification on own logs).
- **Test**: `NEW:own-logs-card-redaction` (asserts zero network calls, zero unredacted PII/secrets, inclusion of "What I Could Not Know" block, and identical SAMPLE_MODE rendering).
- **Tracks**: TK1, TK3.

### DF-113 Cause-ranked fix list
- **Sees and does**: maps each diagnosed limit-drain cause from the autopsy directly to a concrete, code- or config-level remediation rule (e.g. compact context earlier when prompt exceeds 60% window instead of 85%, keep the tool list and schemas strictly frozen across turns to preserve prompt-cache hits, disable ungrounded heartbeat polling daemons, split multi-agent delegation trees, set sub-agent token ceilings); ranks fixes by expected window runway extension and token savings with empirical 80% confidence intervals ($[L, U]$); provides an automated 7-day follow-up check (`desk check-fixes`) that analyzes the owner's subsequent local logs to verify whether the fix was applied and measures realized token savings versus the projected interval.
- **In / Out**: `limit_cause_attribution`, historical session logs / cause-ranked fix recommendations (`remediation_proposal`), expected savings intervals, follow-up verification report (`remediation_outcome`).
- **Default**: ranks fixes by median expected savings; requires minimum 3 past window occurrences to estimate savings interval; 7-day follow-up window; classifies verification outcomes into `verified_saved`, `partially_saved`, `no_change`, or `regressed`.
- **On failure**: insufficient history ($N < 3$ windows) displays theoretical savings bounds labelled `heuristic_estimate`; missing subsequent logs marks 7-day check as `pending_later_logs`.
- **Module, tables**: DK8, DK9, DK10, DK11; reads `limit_cause_attribution`, `policies`, `model_call`, `cost_estimate`; writes `remediation_rules`, `remediation_followups`.
- **Source**: Owner Decision Point 1; Profile 108 (`cnighswonger-claude-code-cache-fix`), Profile 88 (`spiatrenka-coding-agent-flight-recorder`), Profile 67 (`LoopGuard`), Gap Analysis Item 2 (DF-089) and Item 9 (DF-096).
- **Answers**: Problem 3 (claims 52, 60), Problem 107 (claims 1275, 1277), Problem 140 (claims 1603, 1605, 1608), Problem 181 (claims 2044, 2275), Problem 187 (claims 2334, 2784).
- **Test**: `NEW:remediation-followup-interval` (asserts recommended fix produces valid saving interval and 7-day follow-up correctly classifies realized token reduction).
- **Tracks**: TK2, TK3.

### DF-114 Opening and closing scenes
- **Sees and does**: choreographs the opening and closing scenes of the 4-minute demo video and user journey; video opens (0:00–0:15) with the universal developer pain point: "I pay for Claude Code or Cursor, I work for two hours, 'limit reached' appears, and I do not know why — where did my limit go?", immediately answered by the local limit autopsy showing token shares and causal breakdown; video closes (3:35–3:50) with the judge's own call-to-action: "Run `desk` on your own logs right now — get your result card in 3 minutes"; establishes `desk` as the very first line of the README; preserves the end-to-end spine ("Does the proposed policy block landed work?"), the 4:00 budget, the Zetaris and Meterless beats, the induced regression, held-out month, and auditor revisions.
- **In / Out**: demo video script (`docs/submission/`), README hero block / 4-minute timestamped demo flow, README opening command (`desk`), closing card callout.
- **Default**: 4:00 max duration, 3:50 target cut; opens on limit autopsy question; closes on judge own-log card command; zero loss of prior architectural proofs or honesty invariants.
- **On failure**: demo runner verifies each beat reproduces offline in under 4 minutes; README command verified on clean machine.
- **Module, tables**: DK12, M10, all modules; sample data at `data/sample/desk-month/`.
- **Source**: Owner Decision Points 1 and 2; Spec Section 1.4, Feature List Section 3, DF-001, DF-019.
- **Answers**: report criteria `demo` (5 of 5), `first_value` (5 of 5), Problem 3, Problem 70.
- **Test**: `NEW:demo-script-timing-budget` (executes full demo sequence offline; asserts total execution time $\le 230$ s and verifies opening autopsy and closing card beats).
- **Tracks**: TK1, TK3.

## 12d. Added features: sponsor roles made load-bearing (DF-115 to DF-122)

### DF-115 Zetaris three-silo federated query, with the on/off diff
- **Sees and does**: the bill and the landing depth come from one federated SQL query over three registered sources of different formats: the invoice and usage exports (files in a bucket), the CI and pull-request database (a SQL database), and the team roster and seat assignments (a REST service). The Sources screen shows each source, its status and `servedFrom`. A toggle (`desk ask --no-zetaris`, or a killed container) shows the same question answered from local sources only.
- **In / Out**: the three registered sources / rows tagged `servedFrom: live | cassette | fallback`, billed share, landing depth, seat table.
- **Default**: live when the container answers within 15 s; `cassette` under SAMPLE_MODE (the response recorded from a real live run, dated); otherwise `fallback`.
- **On failure**: `fallback` reads local sources only; the billed share drops to 0, the bill is `estimated`, landing stops at `merged`, seats are unknown. The drill asserts exactly that difference.
- **Module, tables**: DK1, DK3, DK5, `SiloPort`; reads the three sources; writes `ingest_run`, `billed_resolution`, `seats`.
- **Source**: D-032; `docs/sponsors/zetaris-local-setup.md` (REST route verified 2026-10-16). NOT VERIFIED: registering our own sources, cross-source joins, semantic layer, the 5-row `limit` behaviour (spec 13.1 gate Z-G1).
- **Answers**: the sponsor-role weakness (a role that changes no output), RT-186.
- **Test**: `drill-zetaris-down` (asserts the billed share and landing ceiling change), `zetaris-three-silo-join` (the join returns every expected row, paged if the limit truncates).
- **Tracks**: TK1.

### DF-116 Meterless H-MEM as the owner's memory
- **Sees and does**: the owner's answers ("commits by bot-x are human"), outcome definitions, rule edits and past policy decisions are stored as memories with trust and supersession; a new attribution or a new proposal reads them; a conflict resolves only above the engine's confidence threshold and the loser is superseded, never deleted.
- **In / Out**: owner answers, decisions / memories, precedents cited in proposals (DF-105).
- **Default**: the H-MEM implementation passing the vendored conformance runner (13 checks); injected generator and embedder, the deterministic hash embedder only in tests.
- **On failure**: engine down means the owner's earlier answers are not applied and the answer says "no memory available"; ablation `--ablate hmem` shows the attribution and the precedent citation change.
- **Module, tables**: DK10, M12 engine; writes `owner_answers`, `policy_precedents`.
- **Source**: Meterless H-MEM spec (`docs/sponsors/meterless-integration-notes.md`, profile 33); implemented in our code, there is no Meterless API or key.
- **Answers**: sponsor role is real only if the ablation changes an output.
- **Test**: `hmem-conformance` (13/13), `ablate-hmem-changes-attribution`.
- **Tracks**: TK3.

### DF-117 Meterless World Model as the change history
- **Sees and does**: an append-only entity and relationship log of sessions, tasks, agents, models, plans and people. "What changed before the canary drop?" lists the served-model change, the tool version, the config diff and the owner edits in the window, and also what did not change.
- **In / Out**: config and model events / the attribution list used by the canary verdict (8.6).
- **Default**: engine on; passing the 8-check conformance runner.
- **On failure**: engine off gives "unknowable: no entity history available" and the canary verdict loses its "consistent with" line.
- **Module, tables**: DK6, DK10, M12 engine; `config_event`.
- **Source**: Meterless World Model spec; dedrift attribution wording (ideas only).
- **Answers**: sponsor-role weakness.
- **Test**: `worldmodel-conformance` (8/8), `ablate-worldmodel-unknowable`.
- **Tracks**: TK2, TK3.

### DF-118 Meterless Markovian on a long ledger
- **Sees and does**: month-long ledgers are folded into bounded carry state per period so a question over twelve months stays within a fixed prompt budget. The question set includes year-long questions ("which cause grew every month since January?") that a one-month sample would not need.
- **In / Out**: the 12-month generated ledger / bounded carry states and the answers.
- **Default**: engine on; passing the 8-check runner; the 12-month generator is seeded and committed.
- **On failure**: engine off gives truncation or a budget failure on the year-long questions, shown in the ablation.
- **Module, tables**: DK10, M12 engine; `carry_state`.
- **Source**: Meterless Markovian spec.
- **Answers**: sponsor-role weakness (this is the engine most at risk of showing no effect on a short sample).
- **Test**: `markovian-conformance` (8/8), `ablate-markovian-long-range`.
- **Tracks**: TK3.

### DF-119 Meterless Scout Intent as the router and guard
- **Sees and does**: every question or action is classified `read`, `spend_action`, `policy_change` or `unsafe` before anything runs; spend actions and policy changes go to the gate, unsafe requests are refused with a reason.
- **In / Out**: question or action text / route and reason.
- **Default**: Scout implemented from its spec and evaluated with its evaluation harness (it has no conformance runner).
- **On failure**: in production an unavailable or crashing router fails closed (the request is routed to deny, never to `read`). Routing everything as `read` is only the ablation harness state (`--ablate scout_intent`), where `B-spend-as-read` fails by design.
- **Module, tables**: DK10; `route_decision`.
- **Source**: Meterless Scout Intent spec.
- **Answers**: sponsor-role weakness; the Risk Router of spec 12.2.
- **Test**: `scout-eval-harness`, `B-spend-as-read`.
- **Tracks**: TK3.

### DF-120 Nemotron tool-calling Planner and Drafter
- **Sees and does**: the Planner and the Policy Drafter call tools (`ledger.query`, `restrictCheck`, `policy.replay`) through Nemotron's tool-calling and the trace shows the `served_model` id on every call. Rate-limit behaviour and a tool-calling success rate are measured and published.
- **In / Out**: question and findings / typed plans and policy diffs.
- **Default**: the configured Nemotron model through the provider order of spec 12.4 (Nightshift local URL primary when running, NVIDIA's API as fallback; `MODEL_BASE_URL`, `MODEL_API_KEY`, `NEMOTRON_MODEL`); `served_by` and `served_model` in the trace; cassette under SAMPLE_MODE.
- **On failure**: malformed or empty output means no retry and the rule brain, with `fallback.used` in the trace.
- **Module, tables**: DK10, `ModelPort`; `model_call`.
- **Source**: `docs/sponsors/nvidia-integration-notes.md` (verified once 2026-10-16). NOT VERIFIED: rate limits, tool calling in our client, the Nano and Ultra ids.
- **Answers**: sponsor role is real (the roles cannot be replaced by a template without the answers getting worse; measured in the role ablation).
- **Test**: `nemotron-tool-call-rate`, `A-role-ablation`.
- **Tracks**: TK3.

### DF-121 Cursor build log and evidence
- **Sees and does**: every build session is logged as it happens in `docs/sponsors/cursor-usage-log.md` (date, task, what Cursor did, what was kept or rejected); at least two concrete examples are kept with screenshots under `docs/submission/evidence/cursor/`; Cursor's included models are used and the model key is kept out of Cursor settings.
- **In / Out**: build sessions / the log and evidence folder.
- **Default**: an entry is written after the session it describes, never before.
- **On failure**: an empty log is an eligibility risk named in spec 18 and the sponsor explanation must not claim Cursor use that the log does not show.
- **Module, tables**: process, not code. Status: PENDING; the log is empty until real sessions are logged.
- **Source**: the organizers' setup guide and `docs/sponsors/cursor-usage-log.md`.
- **Answers**: sponsor-role weakness and the required-IDE rule.
- **Test**: `cursor-log-has-entries` (CI check that the log has dated entries and that the evidence folder has at least two screenshots before submission).
- **Tracks**: TK3.

### DF-122 Sponsor scorecard
- **Sees and does**: one published page, regenerated by one command, that shows for each sponsor what changes when it is switched off: Zetaris on and off (billed share, landing depth), each Meterless engine on and off (the attribution list, the precedent citation, the year-long answer, the routing), Nemotron against the rule brain (answer quality on the question set), and the Cursor log. An engine whose switch-off changes nothing is dropped from the claims and the page says so.
- **In / Out**: the ablation runs / the page with seeds and commands.
- **Default**: regenerated in CI; numbers computed, never typed.
- **On failure**: a failing ablation is published as a negative result.
- **Module, tables**: DK12, M12; `ablation_results`.
- **Source**: core spec section 15 (arms A0 to A7), spec 13.2.
- **Answers**: the biggest sponsor-score risk: a judge sees each sponsor's role as measured, not asserted.
- **Test**: `sponsor-scorecard-recompute`.
- **Tracks**: TK3.

## 12e. Added features: the strongest Track 3 additions (DF-123 to DF-129)

### DF-123 Policy wind tunnel
- **Sees and does**: before any rule is approved, the Desk resamples the owner's own tasks into thousands of simulated months and runs the proposed policy through each, then shows risk as numbers with intervals: the probability that a landed task is blocked, the dollars not spent, the sessions paused, with the 5th to 95th percentile range. With two or more candidate policies it ranks them: first by the owner's risk tolerance (default: at most 5% of simulated months block any landed task), then by the lower bound of the saving. It labels the result "history may not predict" when recent weeks differ from the resampled history.
- **In / Out**: task-level history (cost, landing state, task type, cluster), candidate policies / per-policy risk table, ranking, drift flag.
- **Default**: 2,000 simulated months, seeded; stationary block bootstrap by task cluster and week; at least 60 tasks of history, otherwise "too little history, no simulation".
- **On failure**: fewer than 60 tasks, or a failed drift check, gives a labelled "not enough evidence" and the one-month policy replay (10.7) only.
- **Module, tables**: DK8, DK9; reads `outcome`, `cost_event`, `session`, `policy_version`; writes `wind_tunnel_run` (26.1).
- **Source**: new. The resampling method is from the statistics literature (stationary bootstrap, named from memory: NOT VERIFIED); the interpreter is the policy replay of DF-048; the narrowing check is DF-047.
- **Answers**: the weakness that a policy tested on one held-out month is luck; the RT-141 bundle attack (it is the reason the policy decision is better than an opinion).
- **Test**: `NEW:wind-tunnel-calibration` (on generated histories with known true block rates the stated interval covers the truth in at least 90% of 200 cases), `NEW:wind-tunnel-drift-flag`, `NEW:wind-tunnel-determinism`.
- **Tracks**: TK3.

### DF-124 Answers as programs
- **Sees and does**: Ask the Desk no longer lets the model write numbers. The Explainer writes a small typed query program over the ledger; code executes it; the prose is rendered from the results, and every sentence carries its query hash and result hash. A stranger can rerun any sentence. If the question cannot be written as a program over the ledger, the answer is "I cannot answer that from the ledger".
- **In / Out**: question, ledger schema / `AnswerProgram` (typed steps), results, rendered sentences with hashes.
- **Default**: the model chooses programs and phrasing slots; every digit, date, entity and comparison in the output must come from a result slot.
- **On failure**: program invalid or unanswerable leads to the explicit "cannot answer" and the rule brain's template answer.
- **Module, tables**: DK10, DK12; reads the ledger tables; writes `answer_program`, `answer_sentence` (26.2).
- **Source**: new in this combination; the method of having a model write a program and a tool compute the result (program-aided reasoning, named from memory: NOT VERIFIED) plus the Desk's exact-quote claim checks (DF-066).
- **Answers**: unsupported-claim risk; makes the Auditor's number check structural.
- **Test**: `NEW:answer-program-no-free-numbers`, `NEW:answer-rerun-verifies`.
- **Tracks**: TK2, TK3.

### DF-125 Head-to-head reasoning benchmark
- **Sees and does**: the same questions are put to three arms on the same Nemotron model: a single call with the ledger summary in context, a tool-using agent with the same tools but no Auditor and no programs, and the Desk architecture. A published table shows exact correctness, unsupported-claim rate, correct abstention on unanswerable questions, injection resistance, cost per question, and pass^k over repeated runs, with intervals.
- **In / Out**: a pre-registered question set with computed ground truth / the results page.
- **Default**: 60 generated questions in six categories (lookup, multi-hop join, counterfactual, unanswerable, adversarial, numeric); k = 5; question templates, seeds and scoring committed before the first run; a held-out split.
- **On failure**: a negative result is published as a negative result.
- **Module, tables**: DK12; `benchmark_run`, `benchmark_item` (26.3).
- **Source**: tau-bench (pass^k, desk-papers 05); SWE-bench contract (desk-papers 01) for computed ground truth; role ablations of DF-085.
- **Answers**: the Track 3 claim itself: reasoning architecture beats "just call the model".
- **Test**: `NEW:benchmark-prereg`, `NEW:benchmark-held-out`.
- **Tracks**: TK3.

### DF-126 Break-it challenge and differential fuzzing
- **Sees and does**: `desk attack <policy file>` runs the Policy Attacker's corpus and a property-based fuzzer against any policy and prints each evasion with its replayed evidence. A published statement reports "no widening escape found in N generated policy pairs" with the seeds, checked by exhaustive evaluation and, on a translated subset, against the Cedar solver. Judges are invited to bring their own attacks.
- **In / Out**: a policy file / evasions found, N tested, seeds.
- **Default**: millions of generated pairs in the full run, fewer in `desk prove`; an exhaustive oracle on small grids.
- **On failure**: any widening escape found is a failed build and is published.
- **Module, tables**: DK8, DK12; `fuzz_run` (26.4).
- **Source**: Cedar `verify_implies` with counterexample (profile 85, desk-papers 06) as the differential oracle (mechanism only for comparison); property-based testing practice (named from memory: NOT VERIFIED).
- **Answers**: the restrict-check correctness claim and the Policy Attacker's value.
- **Test**: `NEW:restrict-fuzz-differential`, `NEW:attack-corpus-finds-planted-loophole`.
- **Tracks**: TK3.

### DF-127 Learning from mistakes, measured
- **Sees and does**: every Auditor rejection, owner correction (an answer that contradicts an attribution), owner-flagged false alarm and replay-versus-actual mismatch becomes a lesson: a failing test case with the expected result, stored in the regression suite and in H-MEM as a precedent. A published learning curve shows the error rate on a held-out set falling round by round; improvement is claimed only when its interval excludes zero. What changes is thresholds, rule templates and precedent retrieval; no model weights are trained.
- **In / Out**: mistakes / lessons, the regression suite, the curve.
- **Default**: rounds of 20 lessons; a fixed held-out set that no lesson is drawn from.
- **On failure**: a round that makes the held-out error worse is reverted and published.
- **Module, tables**: DK10, DK12; `lesson`, `lesson_round` (26.5).
- **Source**: Reflexion (desk-papers 10) for the idea of verbal reflection stored for later use; the Desk's difference is that each reflection is a test with an expected result and the gain is measured on held-out cases.
- **Answers**: Track 3's "memory and reasoning into reliable decisions".
- **Test**: `NEW:lesson-becomes-regression`, `NEW:learning-curve-holdout`.
- **Tracks**: TK3.

### DF-128 `desk prove`
- **Sees and does**: one command, offline, reruns the whole reasoning scorecard and prints PASS, FAIL or NOT RUN for each claim with its command and seed: conformance suites, role and engine ablations, the benchmark (cassettes), pass^k, calibration, faithfulness, the wind-tunnel calibration, the fuzz run (reduced), the restrict-check mutation tests and the dossier verification. An injected bug must turn the matching line to FAIL.
- **In / Out**: the repository / a table, `prove-report.json` and a page.
- **Default**: target at most 10 minutes on the shipped sample; the full fuzz run is a separate command.
- **On failure**: any FAIL exits non-zero; NOT RUN is never shown as PASS.
- **Module, tables**: DK12; `prove_run`.
- **Source**: new; the scorecard page of DF-109 and the clean-room verification of DF-086.
- **Answers**: "trust the video" with "run it yourself".
- **Test**: `NEW:prove-all-green-on-sample`, `NEW:prove-detects-injected-failure`.
- **Tracks**: TK3.

### DF-129 Decision regret ledger
- **Sees and does**: every approve, deny, hold and abstain is later scored against what actually happened, including the options the Desk rejected (scored by counterfactual replay of the rejected policy on the realised month). The ledger shows regret in dollars and landed tasks, and whether the wind tunnel's 90% intervals contained the real outcome (coverage against nominal).
- **In / Out**: decisions, later logs / regret per decision, interval coverage, trend.
- **Default**: scored at the end of the next full month; `pending` until then.
- **On failure**: insufficient later data stays `pending`, never a guessed outcome.
- **Module, tables**: DK9, DK10; `decision_regret` (26.6).
- **Source**: new; the shadow-decision idea of scoring rejected options appears in other agent projects we saw only as ideas (NOT VERIFIED where).
- **Answers**: whether the Desk's decisions are good over time, and feeds calibration (DF-106).
- **Test**: `NEW:regret-ledger-recompute`.
- **Tracks**: TK3.

## 13. Share and export artifacts

| Artifact | Made by | Who it is for | Leaves the machine only when | Feature |
|---|---|---|---|---|
| `month_bill` dossier | Month close | finance, the owner's manager | the owner exports it | DF-012, DF-069 |
| `canary_evidence` dossier | Canary verdict | the vendor, the team | exported | DF-016 |
| `replay_report` dossier | Replay | the team deciding a route | exported | DF-017 |
| `policy_change` dossier | Approval | auditors, the team | exported | DF-018 |
| `dispute_pack` (counterparty, redacted) | Bill auditor | a vendor's support or billing team | exported | DF-062 |
| `renewal_sheet` | Seat return | procurement | exported | DF-061 |
| Month bill CSV/JSON with pricing provenance block | Month bill | spreadsheets | exported | DF-004 |
| `desk-verify` output | Verifier | anyone holding a dossier | n/a (runs offline) | DF-070 |
| Cleaned trace sample | Trace | judges, reviewers | committed in `output_examples/traces/` | DF-075 |
| Public index payload | Opt-in index | the public | previewed and accepted | DF-064 |
| Webhook alert | Alerts | the owner's chat | webhook configured | DF-010 |

Every exported number keeps its class and its row references; re-importing an export yields the same totals (R:J-1 gate).

## 14. Absorbed ideas: where each went

Each of the 23 ideas idea 278 absorbs (database ids) is a feature, folded into one, or left out with a reason.

| Idea (id) | Outcome |
|---|---|
| Fuel Gauge (67) | Folded into DF-003 (gauge), DF-009 (pre-run estimate), DF-051 (pause) |
| Spend Meter (41) | Folded into DF-004, DF-033 |
| Spend Ledger (81) | Folded into DF-004, DF-035 |
| Spend Compass (19) | Folded into DF-004, DF-035, DF-045 |
| Agent Budget Ledger (6) | Folded into DF-045, DF-046; its "irreversible effects budget" left out because the Desk's policy fragment covers money, tokens and counts only (§10.1); effects stay on the core path |
| Spend Wall (238) | Folded into DF-046, DF-051 |
| Crew Budget Escrow (128) | Folded into DF-045 (a request counts against every scope, sub-agent scope kind) and DF-046 |
| Futility Stop (257) | Detection folded into DF-033, stop into DF-051; its sequential stopping boundary ("halt when the chance another try succeeds, per dollar, falls below a pre-set boundary", with success deflated by attempt count) is **left out because the spec has no module, table or test for it** (section 15 of this file, issue S-5) |
| Idle Spend Monitor (213) | DF-033 (C-IDLE, C-ORPHAN) and the shutdown action in DF-018 / DF-051 |
| Quota Commons Console (214) | DF-008; cross-account routing left out because §2.2 makes it a non-goal (may breach vendor terms) |
| Capacity Witness (229) | Evidence pack folded into DF-062; the capacity-error classifier (overload, throttle, account flag, outage) is **left out because the spec stores `limit_event` but defines no classifier or test** (issue S-6) |
| Soft Landing (111) | Quota half into DF-008, checkpoint into DF-051; handoff to another account left out (§2.2 non-goal); silent-downgrade warning folded into DF-039 attribution (served model change) |
| Locale Tax Meter (154) | DF-043 |
| True Cost Rig (149) | Left out because its user (voice-agent builders assembling a stack from published component prices) is not the Desk's user and no spec module covers stack assembly; its "all-in cost per outcome against headline price" idea is what DF-004 does for agent spend |
| One-or-Swarm Bench (204) | Folded into DF-042 (workflow-shape routes, reported as experiments) |
| Outcome Receipt (109) | Folded into DF-005 and DF-004 (per-task cost, outcome, loops); a per-task receipt file is not a spec dossier kind (issue S-22) |
| Outcome Bill Auditor (120) | DF-062 |
| Seat Return Meter (131) | DF-061 |
| Worth Ledger (198) | Folded into DF-004 (cost per landed task) and DF-059 (team views) |
| Agent Canary (58) | DF-007, DF-036 to DF-039 |
| Quality Pulse (23) | Folded into DF-007, DF-036 |
| Agent Sentinel Network (121) | DF-064 |
| Personal Drift Canary (10) | Folded into DF-036 to DF-039 |

Idea-278 feature rows not otherwise placed: 2459 (optimiser plug-ins) left out except route rules (DF-044), because no spec module exists and each plug-in would need its own replay proof; 2462 (forecast model commons) left out because the spec's egress rules (§15.3) name only the public index as an opt-in export; menu-bar gauge (part of 2434) left out, not in §14.1.

## 15. Spec issues: all resolved in spec v1.1 and section 21

The 23 issues found while tracing every feature to the first draft of the spec were resolved in the spec's second pass; this section records where. Open items that the spec cannot close alone are listed at the end.

| Issue | Resolution |
|---|---|
| S-1 stale decision text | spec header, 17 (RT-181), 18 cite D-036 |
| S-2 feature id collision | features are `DF-001` to `DF-129`; tracks `TK1` to `TK3`; goals `DG-1` to `DG-6` (spec 21) |
| S-3 the Desk would deny its own Nemotron calls | decided in spec 12.4: a built-in per-model token cap and a code-run own scope; tests `B-gate-own-calls`, `desk-own-calls-reserved` |
| S-4 translate-work-translate-back route | a `route_spec` prompt-override route type in spec 9.3; tested by `language-surcharge-min-n` and the locale experiment (DF-043) |
| S-5 futility stop | spec 7.7 (pre-registered rule and simulation) |
| S-6 capacity-error classifier | spec 7.7 (classes, evidence, golden corpus) |
| S-7 test-strategy gaps | spec 16.9 (behaviour tests) and 16.10 (every named test); `NEW:` tests are now defined there |
| S-8 forecast window weight | the weight is per plan window (`exp(-age/3 windows)`, spec 6.6); for weekly plan windows this equals weeks, and the register row is read the same way |
| S-9 judge independence in the sponsor profile | spec 12.2: sponsor profile is "same family", no independence claim; mixed families only in the published evaluation on cassettes |
| S-10 Zetaris join unverified | spec 13.1 gate Z-G1 and the written fallback beat |
| S-11 canary sample length | the recorded canary samples span at least 35 days (14-day baseline plus two 7-day windows); spec 16.7 and 8.6 |
| S-12 illustrative figures | every figure is a design target; the README, deck and video quote computed values only |
| S-13 incident figures without claim ids | cited through the public evidence table `04-evidence-table.md` |
| S-14 owner answer storage | `owner_answers` table, spec 4.12 |
| S-15 undefined tables | `forecasts`, `alerts`, `gate_bypass`, spec 4.12 |
| S-16 weekly review screen | screen 12, spec 14.1; table `reviews` |
| S-17 seat and billed-resolution data | `seats` and `billed_resolution`, spec 4.12 |
| S-18 CI gate owner | spec 10.8 (`desk ci`), test `ci-gate` |

Open, outside the spec: Zetaris registration and join on the local instance (Z-G1); what "Meterless running on your machine" requires; whether a non-Nemotron judge is allowed; real sample files for Codex, LiteLLM and two OpenTelemetry SDKs; the achieved MDE and replay fidelity; willingness to pay.
