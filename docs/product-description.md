# desk.: the whole product, in plain words and in technical detail

Written 2026-10-24 from the repository, the organisers' documents (kept locally under `docs/event/` and `docs/intel/`, not published) and the sponsors' own material. Where a statement is not verified it says NOT VERIFIED. Nothing here is a claim of "best" or "production-ready": those need evidence this file does not have.

Contents: 1 In one minute · 2 A day with it · 3 How it works · 4 Everything it does · 5 What the hackathon asks · 6 Each track, line by line · 7 Where the product stands (7.6 Planned, not built) · 8 Every source used to build it · 9 Paths.

---

## 1. In one minute (no technical background needed)

**Who it is for.** An engineering lead, or a developer who pays their own bill, using AI coding agents such as Claude Code. They pay on seats and on tokens. The bill is a number, and the limit is a message that says "you have used your allowance". Nothing says what the money bought.

**What it does.** desk. is a program that runs on your own computer, reads the logs your agents already write, and answers the questions the bill does not:

- Where did my limit go? (It splits the heaviest window into causes: loops, repeated reading, idle polling, sub-agent fan-out.)
- What did the money buy? (Spend tied to what landed in git: kept, merged, committed, reverted, or unlinked. Unlinked is "unknowable", not "waste".)
- Did the agent get worse? (A daily test of 52 small tasks, with a second, unchanged arm to tell a real change from a bad day.)
- What should next month's caps be? (It drafts a spend policy, tries to break it, then replays it on a month it was not drafted from.)
- Can I trust the answer? (Every conclusion can be signed. A stranger can check it offline, and changing one byte names the row that broke.)
- Can it stop a runaway? (A gate that Claude Code asks before each tool call. If the gate is down or confused, it says no.)

**Why trust it.** It treats every number as a claim. A figure is computed by code, never by the model. Each figure carries the rows it came from, says what it could not know, and says whether it is billed, reported, estimated or unpriced. Where the product fell short of its own label (a "90%" range that held 73% of the time), it says so on screen.

**What it is not.** It is not a billing system: every dollar is a list-price estimate from logged tokens unless an invoice says otherwise. It governs a tool with no hook only if that tool is pointed at the gateway door. It has not been tried by a real team yet.

---

## 2. A day with it

1. **Morning.** `desk` shows the brief: yesterday's spend, whether the canary moved, any policy waiting for approval.
2. **A limit appears at 2 pm.** `desk card` prints the autopsy: the heaviest five-hour window, split by cause, the fixes worth making ranked with intervals, and a block "what I could not know". The same card is a screen in the local web page.
3. **A question.** `desk ask "Why did spend change before 15 October?"` returns sentences that each cite a typed step. An Auditor rejects any figure no step supports. `desk verify-answer` re-runs the steps later and says which sentences still hold.
4. **End of month.** `desk propose` drafts caps from the month just ended, checks they only narrow the current policy, lets an Attacker look for requests that step around them, and replays them on the month they were not drafted from. The headline is the landed work the policy would have blocked (5 of 333 on the sample), not the savings.
5. **Approval.** The owner echoes the request id and the action digest. The result is a signed dossier. `npm run desk-verify` checks it with the network off.
6. **During work.** `desk gate serve` runs the gate. Claude Code's hook asks it before each tool use; it reserves the worst-case cost first, then settles.

---

## 3. How it works (technical)

### 3.1 The picture

```
agent logs (Claude Code JSONL) ─► ledger (SQLite) ─► price book ─► autopsy · landing · bill
git repos ──────────────────────────────────────────► landing states (kept · merged · committed · reverted · unlinked)
Zetaris ─ invoices (CSV in an S3-style bucket) · CI (Postgres) · roster (REST) ─► billed class · CI facts · seats
                                                         │
        ┌────────────────────────────────────────────────┴───────────────────────────────┐
        ▼                                                ▼                               ▼
  Ask: Risk Router → Planner ⇄ plan critic     Propose: Drafter ⇄ restrict-only check    Canary: 52 tasks × 2 arms
       → typed program → read-only                      ⇄ Attacker → hardener                  × daily, control arm,
       specialists → Auditor ⇄ Explainer                → replay on a held-out month           regression statistic
        │                                                │                               │
        └───────────── Meterless engines (H-MEM · World Model · Markovian) ◄─────────────┘
                                                         │
   gate (reserve → hook/MCP/HTTP → settle; fail closed) ◄─ approval echo ─► signed dossier ─► desk-verify (offline)
```

The model is Nemotron (`nvidia/nemotron-3.5-super-vl-120b-a12b`) behind one OpenAI-compatible port. Today it is reached through Meterless Nightshift on the author's machine, with NVIDIA's API as Nightshift's provider; setting three variables sends calls straight to NVIDIA instead. Offline runs replay recorded replies.

### 3.2 The pieces

| Piece | What it does | Code |
|---|---|---|
| Ingest and ledger | Reads Claude Code logs read-only; de-duplicates by message and request id; handles sidechains and cache buckets; stores counts first, prices later | `src/desk/ingest/`, `src/desk/ledger/` |
| Price book | A dated snapshot of first-party prices (from LiteLLM's MIT price file); every dollar is `billed`, `reported`, `estimated` or `unpriced`; an unpriced call is counted, never shown as zero | `src/desk/pricing/`, `src/desk/cost/`, `data/prices/` |
| Autopsy | Finds the heaviest five-hour window, splits it by cause, ranks fixes with intervals, writes a "what I could not know" block | `src/desk/autopsy/`, `src/desk/card/` |
| Landing | Links sessions to commits with a confidence level; places each dollar on the ladder kept / merged / committed / reverted / unlinked | `src/desk/outcomes/` |
| Zetaris port | One statement joins three silos of three kinds; falls back to recordings, then a labelled fallback, never an exception | `src/sponsors/zetaris/`, `src/desk/silo/`, `infra/silos/` |
| Policy language | Spend caps, outcome conditions and approval thresholds in one document; restrict-only check with a counterexample; replay on a held-out month; a "wind tunnel" of resampled months | `src/desk/policy/`, `src/desk/replay/` |
| Ask | Risk Router, Planner (writes a typed program), plan critic, read-only specialists, Auditor, Explainer; every sum and percentage done by code | `src/desk/ask/`, `src/desk/agents/` |
| Propose | Drafter, Attacker, hardener, held-out replay, rule-brain fallback | `src/desk/propose/`, `src/desk/agents/` |
| Canary | 52-task pack, two arms (one a control), paired per-task statistic with cluster-robust error, a 99% interval in two windows, a computed minimum detectable effect, an anytime-valid early-warning flag | `src/desk/canary/` |
| Gate | Reserve before the call, settle after; hook, MCP and HTTP doors; approval echo; hash-chained ledger; fails closed | `src/desk/gate/` |
| Dossier and verifier | Ed25519-signed in-toto Statement in a DSSE envelope; a Merkle-linked row log; a verifier on plain Node | `src/desk/dossier/`, `src/desk/verify/` |
| Benchmark | Pre-registered 60-question head-to-head of three arms on one model; pass^k over repeated runs | `src/desk/bench/` |
| Lessons, regret, calibration, seats, route | Learning from wrong answers; scoring the Desk's own past choices; confidence against planted truth; seats beyond people who landed work; the same recorded tasks replayed on two routes | `src/desk/lessons/`, `regret/`, `calibrate/`, `seats/`, `route/` |
| Proof | `desk prove` runs 26 named checks, each PASS, FAIL or NOT RUN | `src/desk/prove/` |
| UI | Fourteen screens on a local, read-only server | `src/desk/ui/` |

### 3.3 The agents

Nine roles, with the collaboration the organisers asked for (they asked for three of nine behaviours; all nine are present, each with a file or a trace event): Risk Router, Planner, plan critic, specialists, Auditor, Explainer, Drafter, Attacker, Canary. One agent's work is visibly sent back by another: the plan critic returns a Planner program that lacks a figure the question asks for; the Auditor returns an Explainer sentence with an unsupported figure; the restrict-only check returns a Drafter policy that would pause landed work. Full table: `docs/the-agents.md`.

### 3.4 The Meterless engines (memory, state, long-range reading)

Three of Meterless's open reference engines run in this process under Apache-2.0, with their own conformance suites passing (H-MEM 13/13, World Model 8/8, Markovian 8/8). H-MEM keeps the owner's definitions ("landed means merged or kept") and corrections, with supersession; the World Model keeps what changed when (model ids, tool versions, plan settings); Markovian bounds the reading of a long range. Each changes an answer when switched off (`desk ask --ablate world_model`), and `desk prove` checks that. Beyond that slice the engines are barely used (section 7.4).

### 3.5 Trust rules built into the code

- No number reaches an answer unless a claim carries it. Budgets (wall clock, model calls, tool calls, turns) are enforced in code.
- Every language role has a rule-based fallback, and the trace says when it ran.
- A request with no recording in replay mode is an error, never a guess.
- The gate fails closed: a broken checker is a block, distinguishable from a refusal.
- A signature proves the record was not altered after signing and that its figures follow from its rows. It does not prove the agent logs were truthful.

---

## 4. Everything it does

### 4.1 Commands (54, from `desk help`)

| Command | What it does |
|---|---|
| **Start here** | |
| `desk card` | Read your Claude Code logs and print the card: where the money went, and one change worth trying. This is what plain `desk` does. |
| `desk ui` | Start the screens (Brief, Bill, Autopsy, Sessions, Outcomes, Policy, Canary, Ask and more) and print the address to open in a browser. |
| `desk status` | How many of the specified features are built, counted from the code (`status write` writes the page). |
| **Read more sources** | |
| `desk ingest` | Read agent logs into the ledger: Claude Code by default, or --agent codex, opencode or statusline. |
| `desk retention` | Which agent logs are about to be deleted before they were read, and a daily ingest command (`retention schedule`). |
| `desk statusline` | The Claude Code status line that records your plan limits (`statusline install` prints the setting to add). |
| `desk task` | Label the work you start (`task <label>`, `task end`) so sessions group into tasks; `task list` shows how each task was identified. |
| `desk invoices` | Import an invoice or usage export (CSV, or PDF read twice) and reconcile billed against estimated against reported, month by month. |
| `desk questions` | Where the Desk is unsure which session a commit came from, it asks; your yes or no is applied the next time landing is computed. |
| `desk landing` | Tie sessions to the commits they produced in your repositories, and show what the spend bought. |
| `desk reconcile` | Compare the cost Claude Code recorded for itself with our estimate, process by process. |
| `desk silos` | Ask the invoice, CI and roster data through Zetaris (`silos seed` builds the sample data). |
| `desk sources` | Which agent tools the Desk finds on this machine, where it looked, and what each source can and cannot tell it. |
| `desk otel` | Read OpenTelemetry GenAI spans (OTLP/JSON) as calls, or write the Desk's own record as spans with the desk.* attributes. |
| `desk gateway` | Import a LiteLLM spend log (JSON, JSON Lines or CSV): tokens priced at list price, the gateway's own cost kept beside it. |
| **Costs and limits** | |
| `desk gauge` | What the last few hours cost, how fast, where it went and where your plan windows stand; --line for a status line, --watch to keep it fresh. |
| `desk estimate` | Before a large task: the cost range of similar past tasks and how many there were, or no estimate when fewer than ten are similar. |
| `desk approvals` | What is waiting for your approval, how fast and how carefully past ones were decided; `show <id>` opens the evidence, `deny <id>` says no. |
| `desk close` | Close a month: spend, invoices, canary, a replay and drafted change, and a signed month dossier a stranger can check offline. |
| `desk review` | The weekly review: what the week cost, what it bought, how the forecasts did, what drifted, and at most three changes worth making. |
| `desk bill` | The bill for a month or any dates: kinds of figure, what it bought, where it went; --export csv or json gives every line. |
| `desk overhead` | Share the idle and unowned spend of a period among the projects that landed work, to the micro-dollar. |
| `desk delegation` | Which agents started which: each delegated agent alone and with the agents it started, and the sessions that went too deep. |
| `desk waste` | Waste the extra rules find: the same error from new inputs, cut-short results repeated, file churn, bare calls, orphaned agents. |
| `desk autopsy` | Split a window of spend into causes: idle, loops, cache misses, and work that was needed. |
| `desk limits` | What a percent of your plan limit costs in tokens, per plan and window, with an interval, or why there is no estimate. |
| `desk plans` | Every plan window your tools report: the tool's own figure beside a local count, the outlook, and the limit hits and model changes. |
| `desk runway` | Will this plan window last until it resets? Judged from how past windows of the same plan ended. |
| `desk prices` | `prices compare` checks our price book against another; `reprice` prices the ledger again, keeping old costs; `history` shows them. |
| `desk pr` | What the agent work behind one change cost, as a description to paste into the pull request. |
| **Decide and enforce** | |
| `desk ci` | A pipeline gate: fail a change that worsens the canary suite or raises cost past a bound. Exit 0 pass, 1 fail, 2 error, 3 inconclusive. |
| `desk enforcement` | What the Desk can actually stop, tool by tool: enforced, advisory or notify only. `enforcement test [--live]` records the evidence. |
| `desk propose` | Draft a spend policy from your own history and check by proof that it only narrows what is in force. |
| `desk replay` | Replay a policy over past sessions: what it would have blocked, and what that would have saved. |
| `desk tunnel` | The same as replay, for several policies side by side. |
| `desk alerts` | Tell you once when something needs you: a cap nearly spent, a pause, idle spend, a canary regression, a month that will not reconcile. |
| `desk approve` | Approve a pending policy change; the approval is signed into the dossier. |
| `desk gate` | The spend gate: `gate serve`, `gate gateway` (a door for tools with no hook), `gate mcp`, `gate status`, `gate open` and `gate close`. |
| `desk seats` | For each person, whether a flat seat or tokens at list price is cheaper. |
| `desk route` | Test a cheaper model on recorded tasks and say whether it holds up. |
| `desk canary` | The daily regression check: did the agent get worse? `canary run` records today's tasks; `--if-due` is the hourly job, `schedule` prints it. |
| **Ask and remember** | |
| `desk ask` | Ask a question about your spend; the answer cites the rows it used and is checked before it is shown. |
| `desk remember` | Store a note for Ask to use later, such as an exception someone granted. |
| `desk verify-answer` | Check an answer's claims against the ledger. |
| `desk lessons` | Learn rules from past mistakes, and show whether they would have helped on held-out questions. |
| `desk regret` | Score earlier proposals against what happened afterwards. |
| `desk calibrate` | How well the confidence of a session-to-commit link and the simulator match answers we know. |
| **Privacy** | |
| `desk egress` | What was sent to a model: host, size and a count of masked secrets for every request, never the text. |
| `desk forget` | Delete sessions by --project, by --before a date, or --all, and say what was removed; without --yes it only shows what would go. |
| **Evidence** | |
| `desk prove` | Run every check against the code and print PASS, FAIL or NOT RUN with the reason. |
| `desk bench` | The recorded benchmark: Ask against plain baselines on questions with known answers. |
| `desk demo` | The scripted demonstration run, from recordings, with no network. |
| `desk sample` | `sample build` generates the 14-engineer sample that `--sample` reads; nothing of yours is read. |
| `desk lab` | Audit tasks, run an agent on them, and report the pass rates and whether the experiment is worth running (`lab audit`, `lab run`, `lab report`). |
| `npm run desk-verify` | The offline dossier verifier: plain Node, network off, one changed byte names the row |

### 4.2 Screens (13)

Brief · Week (the weekly review) · Autopsy · Bill (with shared overhead) · Outcomes · Sessions (with delegation and waste blocks) · Policy (with the wind tunnel and what the Desk can enforce) · Canary · Ask · Org data (Zetaris) · Team (roles, signed reports) · Doctor (what each source can and cannot say) · Dossiers · Evidence (what was measured, including what failed). The first twelve were photographed in light and dark at 1440 and 390 px and read, and the record is `docs/verification/ui-sweep.md`; the sections added since (delegation, shared overhead, enforcement, waste blocks) were read in light and dark and desktop and phone width as they were built, and a full automated and visual pass over all fourteen was recorded on 2026-10-26 in the same file.

### 4.3 The feature specification

129 numbered features (DF-001 to DF-129) in eight tiers are written in `docs/design/desk/02-feature-list.md`, with a requirements document (`03-product-requirements.md`) and an architecture contract (`00-architecture-master-spec.md`). `docs/design/desk/07-feature-status.md` is written by `desk status write`, which counts each row from `docs/design/desk/feature-status.json`; a row can be marked built only if it names a test, a `desk prove` check or a verification note, and a test enforces that. At this commit **128 are built, none partial and one absent** (DF-121, a log of real Cursor use, which only its user can write); each built row names its tests and a verification note, and the limits are in the notes, not in the count.

---

## 5. What the hackathon asks, and our answer

Open Agent Hackathon 2026 (GenAI Works): 144 hours, 22 to 27 October 2026, one primary track judged, sponsors Zetaris, Meterless, NVIDIA, Cursor (with Space XAI) and Bright Data. We submit under Track 3, Reasoning Architecture.

### 5.1 The scoring lines (100 points)

| Criterion | Pts | The judge's question | Our evidence |
|---|---:|---|---|
| Impact | 30 | A meaningful real problem for a clearly defined user, consistent with the challenge statement | The problem sentence; five public quotes; `docs/design/desk/04-evidence-table.md` (146 claims). **Gap: no real user has used it; willingness to pay NOT VERIFIED** |
| Technical | 20 | Implementation, reliability, architecture | 1,451 tests; `desk prove` with 35 named checks; budgets in code; fallbacks; a pre-registered benchmark whose losing first run is published |
| Innovation | 15 | Originality | Restrict-only policy check fuzzed against an oracle; an Explainer that never reads the question; a signed dossier a stranger verifies offline; the Desk's own judgement recorded and scored |
| Demo | 15 | Shows the solution, its functionality and value | 3:56 captioned motion video; `npm run desk -- demo`. **The video is uploaded: https://youtu.be/dsRGX73lZAQ** |
| Product and UX | 10 | Intuitive, accessible, easy for the intended user | Fourteen screens, light and dark, phone width |
| Sponsor tech | 10 | Effective use of sponsor technology | Section 5.4 |

Tie-break: Impact, then submission time.

### 5.2 What judges like and discount (organisers' words, paraphrased)

Reward: a clear problem and named user; agents that do real work; critique and recovery rather than a fixed pipeline; reliable execution; effective sponsor use; a usable output; a demo that explains. Discount: UI polish without depth; a single agent presented as many; hardcoded demo paths; broad concepts with weak implementation; unsupported claims of value. Also named as failures: linear pipelines with no critique or retry, prompt wrappers, no trace of how the output was reached, unsafe overclaiming, a submission a judge cannot run. Our guard for each is in `docs/submission/requirements-coverage.md`.

### 5.3 Rules and constraints, line by line

| Line | Status |
|---|---|
| Exactly one primary track | Track 3 (the submission itself is not created; that locks the team) |
| Zetaris and Meterless integrated in every submission | Yes, each with a call site, a trace line and a switch-off test |
| Cursor as the development environment | Optional since 22 October 2026 (moderators' statement in the event chat). **Not used:** `docs/sponsors/cursor-usage-log.md` is empty and nothing is claimed |
| NVIDIA wherever it contributes | Nemotron serves every language role and all three benchmark arms |
| Work committed before the window is not eligible | First commit is after 22 Oct 00:00 UTC; design documents and two guard scripts predate it and are declared |
| No secrets in the repository | Scanner on tree and history |
| No manual setup; sample inputs and outputs; runs from a clean clone | `npm run desk -- --sample`; `input_examples/`, `output_examples/`; clean-room runs on Windows (Node 24.20) and Ubuntu (Node 22.23). **Node 22.19 and macOS NOT VERIFIED** |
| Bounded, predictable runtime (organisers target 5 to 10 minutes) | Offline paths replay recordings; the live path has variable latency (0.4 s to 56 s measured for the same small call) |
| Save or print agent activity | JSONL trace per run |
| Declare pre-existing components | `docs/submission/pre-existing-components.md` |
| Demo video 1 to 4 minutes, naming Zetaris and Meterless and where each sits | 3:56, uploaded: https://youtu.be/dsRGX73lZAQ |
| Slide deck with problem, solution, architecture, stack, sponsor use, visuals, future | `docs/submission/desk-deck.pdf`, 25 slides |
| README with setup, usage, dependencies | `README.md` |
| Sponsor technology explanation | `docs/submission/sponsor-technology-explanation.md` |
| Product runs on Nemotron, reached through Meterless or NVIDIA's API | Through Nightshift on this machine (verified 2026-10-24), or NVIDIA directly |

### 5.4 Sponsors

- **Zetaris** (required). One statement joins an S3-style invoice CSV, a Postgres CI database and a REST roster, all synthetic. It gives the bill its `billed` class, landing its CI facts (584 landed sessions merged on green checks, 60 on red) and the spend-per-landed-PR table. With Zetaris off those disappear; a real container kill was run. **Not used: the MCP server, natural-language-to-SQL, the semantic layer and data steward, masking by role, the audit log, lineage, Iceberg time travel.**
- **Meterless** (required). Three engines in our process, conformance 8/8, 13/13, 8/8, each changing an answer when off. Since 2026-10-24 Nightshift (Windows edition 1.2.3) is installed and serves the model; replies carry its compute receipt, which the trace and the answer show. **Not used: overnight jobs, judges, its local embedder, H-MEM mining and sleep, World Model merge queue and audit, Scout Intent.**
- **NVIDIA.** Nemotron through the OpenAI-compatible API, tool calling verified. Latency varies and some calls fail; code retries, falls back and says so.
- **Cursor.** Optional since 22 October 2026. Not used; editor rules exist in `.cursor/rules/`. No session is logged.
- **Bright Data.** Bounty track only; not used.

---

## 6. Each track, line by line

For each track: the organisers' lines, then what the product does about each, the evidence, and the honest gap. Source tags: [W] welcome guide, [A] Approach Guide, [L] the lesson "How the Week Runs".

### 6.1 Track 1: Solving Fragmented Intelligence (we do this as a module)

| The organisers' line | What we do | Evidence | Gap |
|---|---|---|---|
| "Demonstrate a clever ability to discover and work across fragmented data sources." [W] | Four kinds of source: agent logs (files), invoices (CSV in a bucket), CI (Postgres), roster (REST), plus git. Registered in Zetaris and joined by one statement | `desk silos`; `docs/sponsors/zetaris-local-setup.md` | The silos are synthetic, built from the constructed sample; no public API source |
| "Leans on the Data layer: Zetaris across several sources." [L] | Zetaris is the join. Its role changes the output (billed class, CI facts, per-PR table) | `desk prove`: `zetaris-role-changes-the-output` | Zetaris features beyond SQL NOT VERIFIED |
| "Several small sources that do not agree with each other... three or four small sources rather than one large one. The value is in discovering and working across them, not in volume." [A] | Sources disagree on purpose: the invoice lands 1.2% below the list-price estimate; 60 of 644 landed sessions merged although checks were red | `docs/verification/`, README | Disagreements are planted in a sample, not found in a real team |
| "...querying three disconnected systems, reconciling conflicting records, and producing a single sourced summary with the systems each fact came from." [A] | Reconciliation shows billed against estimated with the gap; every figure names its source class | `src/desk/silo/` | Reconciliation is code, not an agent that negotiates |
| Example 1: Source Mapper, Reconciler, Conflict Critic, Reporter; "Conflict Critic flags contradictions... and requests clarification; Reconciler resolves or marks the conflict as unresolved" [A] | Doctor screen says what each source can and cannot answer; conflicts are labelled; unlinked spend is "unknowable"; the Reporter is the brief and the Ask answer | `src/desk/ui/client/screens/sources.js` | No agent asks the user to resolve a conflict; unresolved conflicts are only labelled |
| "Reconciliation and conflict handling"; "four or more sources" for larger teams [A] | Four to five sources | | |
| Prize: $1,600 / $1,200 / $900 | Not our primary track | | |

### 6.2 Track 2: The Agent That Can Explain Why (we do this as a module)

| The organisers' line | What we do | Evidence | Gap |
|---|---|---|---|
| "Build agents that investigate complex questions across multiple data sources, connect findings, and produce evidence-backed answers or recommendations." [W] | Ask: a question becomes a typed program over ledger, git, Zetaris facts and engines; findings are connected; sentences cite steps | `desk ask`; 60-question benchmark | Questions are about spend, not open research; no documents or web sources |
| "Leans on Data and Power: grounded retrieval and an evidence trail the model can show." [L] | The Evidence screen and `desk verify-answer`; every claim carries its rows and query hash | `docs/evidence.md` | Retrieval is structured queries, not text retrieval |
| "Bound the question, the time window, and the source count. Keep every conclusion traceable to the evidence behind it, and cache a sample so the demo works if an API fails." [A] | A bounded ledger and window; the sample is generated; recorded replies replay offline | `desk prove`: `sample-mode-needs-no-network` | |
| "...a cited recommendation that shows the evidence behind each conclusion." [A] | Signed dossier; the verdict names the fact that would flip it; wording "consistent with, not caused by" | `npm run desk-verify` | |
| Example 2: Planner, Retriever, Summarizer, Insight Critic, Report Writer; "Insight Critic checks whether each claim is actually supported" [A] | Planner, specialists, Auditor (the critic), Explainer (the writer) | `src/desk/agents/audit.ts` | |
| "A critic loop across several sources"; "an interface that shows the evidence behind each answer" [A] | Auditor loop (revise at most twice, then drop the sentence); Evidence screen | | Every-number-clickable (a specified feature) NOT VERIFIED as built |
| Prize: $1,600 / $1,200 / $900 | Not our primary track | | |

### 6.3 Track 3: Reasoning Architecture (our primary track)

| The organisers' line | What we do | Evidence | Gap |
|---|---|---|---|
| "Demonstrate a novel ability to turn data, knowledge, memory, and reasoning into reliable decisions and actions." [W] | Data: logs and silos. Knowledge: price book, policy language, owner definitions. Memory: H-MEM and World Model. Reasoning: typed programs, Auditor, Drafter/Attacker/replay. Decisions and actions: signed dossier, approval echo, gate | `docs/the-agents.md` | Memory is the thinnest of the five (7.4) |
| "Leans on Power and Build: the Nemotron model mix, memory, and the tool loop." [L] | Nemotron in every language role; tool calling with a JSON-schema argument; memory engines; the Planner's tool loop with critic and revision | `src/desk/agents/model.ts` | One Nemotron model for every role; no per-role model mix |
| "Operational records, rules or policies, and the state or memory of prior decisions. Define the decision and the action first, then the data, knowledge, and memory the agent needs to reach them reliably." [A] | Decision: next month's caps and routes. Action: a signed policy the gate enforces. Records: logs. Rules: the policy language. Memory: owner definitions, past decisions, regret ledger | `desk propose --dossier`, `desk regret` | |
| "...combining availability rules, priority policy, and memory of past decisions, and producing a prioritised booking list with the reasoning for each decision." [A] | The analogue: spend rules, a priority on landed work, memory of past decisions, and a policy with the reasoning for each rule | `output_examples/traces/propose-sample.jsonl` | |
| Example 3: Intake, Rules Checker, Memory Keeper, Priority Critic, Scheduler; "Priority Critic challenges decisions that look unfair, unsafe, or inconsistent with past decisions" [A] | Intake = Risk Router + Planner. Rules Checker = restrict-only check and policy evaluation. Memory Keeper = H-MEM plus lessons and regret. Priority Critic = Attacker, plan critic, Auditor, held-out replay. Scheduler = Drafter to dossier | One real trace: the first draft would pause 81 of 311 landed sessions, the check caught it, the Drafter revised, the second draft paused none | Learning from mistakes moved 2 of 60 held-out questions with an interval touching zero: no improvement is claimed |
| "A domain expert on the team" [A] | None: solo | | Practitioner validation plan exists (`docs/design/04-practitioner-validation-plan.md`) but no interview was done. NOT VERIFIED |
| "Combining data, knowledge, memory, and a usable interface" [A] | Fourteen screens | | |
| Prize: $1,500 / $1,200 / $900 | | | |

### 6.4 The Approach Guide's general lines

- **The problem sentence.** "We are building an agent that helps [user] solve [problem] by [capability] using [data], producing [output]." Ours is the blockquote in `README.md`.
- **One user, one decision, one data slice, one strong output, clear agent behaviour.** An engineering lead; next month's caps and routes; agent logs, git and three joined sources; a replay-tested signed policy; nine roles.
- **Collaboration patterns (at least three of nine; strong patterns include dynamic delegation, back-and-forth, validation, shared state, branching on confidence, retry and recovery, a trace).** All nine, each located in `docs/the-agents.md`.
- **Runtime discipline, sample strategy, no manual setup, a trace, sample inputs and outputs.** Section 5.3.
- **Red flags (section 18), each answered** in `docs/evidence.md`: no private key needed for the sample; no GPU; no fixed sequence; Zetaris and Meterless with real roles; works offline; a trace shows how the output was reached.

---

## 7. Where the product stands (2026-10-25)

### 7.1 Done and checked

- Everything in sections 3 and 4 runs. 1,451 tests pass (110 files; `npx vitest run`, 2026-10-25), and `desk prove` is 35 PASS, 0 FAIL, 0 NOT RUN on fresh clones of Windows 11 (Node 24.20) and Ubuntu 22.04 (Node 22.23); the commit those clones were made at is named in the README.
- Canary: calls the planted model switch on day 15 (-40.0 points, 99% interval -56.2 to -23.8, control flat); 0 of 100 no-change histories called regressed. Smallest detectable change on the recorded design is about 21 points.
- Held-out replay: a policy drafted from September meets October and would have blocked 5 of 333 landed sessions.
- Head-to-head (same Nemotron model, 60 questions nobody had read, preregistered with seven written predictions): one call 12, a tool-using agent 45, the Desk v3 55; pass^3 18%, 70%, 85%; all seven predictions held; the five misses are shapes the Desk has no step for. Sets A and B, which the Desk was built against, are 60 of 60 each on v3 and are post hoc. Ten in sixty is a margin this size of set cannot make certain (`docs/verification/benchmark/RESULTS-v3.md`).
- Dossier: untouched PASS, one byte changed FAIL naming the row. The signed month bill verifies on plain Node and fails on one changed byte.
- Gate: invariants hold after 400 random operations; six of six junk requests refused; caps by session, by the last ten minutes or hour, and per model or project; a stopped session writes a handoff and resumes only with a reason (and a signed extension while the cap still binds).
- What it can stop is tested per tool and kept as a result: Claude Code reads enforced (the real tool was run three times against the gate), the others advisory or notify only.
- CI gate: `desk ci` exits 0, 1, 2 or 3 and treats inconclusive as never a pass; on packs of known truth it called a fall in 1 of 400 when nothing changed and in 96% of cases for a 20-point fall (`docs/verification/ci-gate-2026-10-25.md`).

### 7.2 Changed today and in progress

- **Desk v3 and its results (built, measured).** Two new typed steps (median daily spend, count of sessions started), one-model spend counted as one total however grouped, the rule planner planning shares, medians and session counts, a comparison naming the higher period first, the asked-for figure first, empty model replies retried, the sampler stating `top_p`, and a private cache scope per gateway call. The recordings of sets A, B and D are committed and `desk prove` replays them, so a fresh clone reproduces the tables with no key.
- **Waste rules, compaction, delegation and shared overhead (built, one machine).** Extra rules over the tool calls (the same error from new inputs, cut-short results repeated, file churn, bare calls, orphaned agents), a cost for context rebuilt after a compaction that landed nothing, a tree of which agent started which, and the idle and unowned spend shared among the projects that landed work to the micro-dollar (`docs/verification/waste-rules-2026-10-25.md`, `compaction-2026-10-25.md`, `delegation-2026-10-25.md`, `overhead-2026-10-25.md`).
- **Cap windows, checkpoints and the enforcement ladder (built).** The policy language caps a session, the last ten minutes or hour, and one model or project; a session that hits a cap stops with a handoff; `desk enforcement` says per tool what is enforced, advisory or notify only, from recorded tests.
- **The CI gate and the monthly close (built).** `desk ci` gates a change on the canary; `desk close` writes a signed month dossier.
- **Feature status.** 73 of 129 specified features are built, 35 partial and 21 absent (`docs/design/desk/07-feature-status.md`). A dated search of prior art for the Track 3 claim is in `docs/design/desk/08-novelty-search-2026-10-24.md`: LaunchDarkly AI Configs experiments, ARC-DR, the self-evolving harness papers and Cedar policy comparison each cover a part; we did not find one system that closes the whole loop, and the search is shallow.
- **Nightshift installed and routing (verified live).** Windows edition 1.2.3, per-user, unsigned by the vendor's own label (hash matched the published one; Defender clean; Windows Firewall blocks inbound). Nightshift holds our exact model out by default after 31 of 94 hosted calls failed for them; the opt-in was set. A live Ask returned with receipt ids in the trace and under the answer. Calls go through it while three `MODEL_` lines are in `.env`.
- **A Nightshift defect found and worked around.** On 2026-10-24 Nightshift answered repeats of some planner requests from its response cache with an empty message and no tool call (`from_cache: true`, 4 ms), which spoiled the first v3 sampled trials. Every request to a gateway now carries its own `meterless-scope`, which avoids the cache (checked: same request, default scope cached and empty, private scope fresh and a proper tool call). Empty replies are also retried now. The first v3 recordings were discarded and the Desk arm of sets A and B is being recorded again from scratch. The defect is worth reporting to Meterless.
- **Security and privacy foundation (built and tested).** Credential-shaped strings are masked in stored log text (folder, branch, tool version, edited path) and in every message sent to a model; commit authors are stored as a hash, never an e-mail address; every model request is logged as host, size, hash and number of masked secrets (`desk egress`); `desk forget --project | --before | --all` removes sessions and everything under them and compacts the database file; the threat model is `docs/security/threat-model.md`. A planted credential is searched for in the card, the card files, the ledger file and every screen the interface serves, and the test fails when masking is switched off. Not covered: encryption at rest, install provenance, a live-model test with a hostile log name.
- **The tool's own recorded cost, reconciled (built, one machine).** Claude Code writes its own running cost into its logs; the ledger keeps it as a separate `reported` class, `desk reconcile` compares it with the estimate per process, and the Bill screen shows both with the sub-agent warning. On this machine 248 of 420 processes agree within 2% (median difference 0.0%); for the 7 processes that used sub-agents the tool's counter lags and the two figures differ by tens of percent to several times over. Our price table matches Anthropic's pricing page; Claude Code's own Sonnet 5.5 figure uses $0.20 per million for cache reads where the page says $0.10, and a second source, Portkey's open price database, also says $0.20 (89 of 90 prices agree between it and ours; this is the one that does not). Which is in force is NOT VERIFIED: on this machine's 17.4 billion Sonnet 5.5 cache-read tokens it is worth $1,741.87, and the Bill screen shows the estimate as a range for that reason (`desk prices compare`). No invoice was used, so no figure is claimed to be the bill. See `docs/verification/reconciliation-2026-10-24.md`.
- **A second tool, Codex, and the plan limit in tokens (built, one machine).** `desk ingest --agent codex` reads Codex session logs: calls from the growth of the cumulative total, a forked session's replayed parent history left out (782 replayed calls and 119 million tokens on this machine), merged requests marked. Codex also writes the percent of its plan's 5-hour and weekly windows used and when they reset; `desk limits` fits tokens to percent with an interval and abstains when there is too little data. Each plan and window length is its own limit (the first version pooled the free, team and plus plans and was corrected the same day). On this machine the plus plan's 5-hour limit is about 258K tokens per percent (95% interval 244K to 275K, 76 windows) and its weekly limit about 2.1M (1.7M to 2.4M, 15 windows); the other plans have too little data and the command says so. Predicting a held-out 5-hour window from the others has a median error of 5.0 points (12%). `desk runway` and the Brief screen say whether a window will last until its reset, from how past windows of the same plan and length ended when they stood at the same stage and percent (one reading per past window, the 10 closest; no forecast under 30 past windows). A first version that assumed the last hour's pace would continue held the final percent in its range in 2 of 26 cases and was dropped; this one, checked by forecasting each of 237 readings only from the windows before it, scored a Brier of 0.186 against 0.327 for the base rate, with its interval holding 81% (aimed at 80%), and failed when it stopped learning (see `docs/verification/runway-2026-10-24.md`). One person, one plan. Not a forecast for one window. Claude Code's own limit readings come from its status line: the command and the reader are built and tested against the documented fields (`desk statusline install` prints the setting to add), but nothing has been captured yet, so there is no Claude limit estimate. See `docs/verification/codex-reader-and-limit-fit-2026-10-24.md`.
- **Prompt-length pricing (built).** Claude Haiku 5.5 is priced by prompt length on Anthropic's page; the price book now supports it (`data/prices/anthropic-2026-10-24.json`). The sample and the recorded benchmark keep the dated 2026-10-22 snapshot.
- **Decision records and a claim registry engine (built).** A `desk.decision_record.v1` schema that refuses a record without alternatives (doing nothing among them), a chosen option, intervals, limits and an honest evidence level; every policy proposal now yields one with a conservative recommendation. The registry engine that fails a sentence with no supporting run exists; the registry itself is not written yet.
- **The Lab harness (built; its feasibility spike was stopped and has not been resumed, so no effect has been measured).** A task format with hidden tests and an audit (the gold change passes every test three times, the starting state fails, four cheating moves fail, `npm test` runs the task tests), a grader, an accounting proxy in front of the model endpoint (per-call cache scope, retries, no text stored), a runner, and ten handwritten spike tasks. A 50-run spike on OpenCode with Nemotron through Nightshift was started under a protocol written before the first run (`docs/lab/00-spike-protocol.md`) and stopped before it finished; it can be resumed, no result exists, and no claim rests on it.
- **Task identity (built).** `desk task <label>` (or `DESK_TASK` through a SessionStart hook, or `desk task run <label> -- <command>`) names the work you start; sessions are otherwise grouped by ticket key, pull request number or feature branch in the branch name, else the session is its own task. The Outcomes screen shows how tasks were identified. No prompt text is kept, so no session is grouped by what it was about.
- **Pricing rules and repricing (built).** One function prices a call and names the rules that applied: long prompts, fast mode (the log says `speed: "fast"`), and US-only inference (`inference_geo: "us"`, 1.1x), with the cache prices following the vendor's rule. Where the log is silent a note is kept and the standard price used. `desk prices reprice` prices the ledger again, keeps every old cost in a history and says what moved; the gateway reserves and settles what a request asked for. None of this machine's calls says fast or us, so those two surcharges are tested on constructed calls only (`docs/verification/pricing-rules-and-repricing-2026-10-24.md`).
- **Invoices and reconciliation (built).** `desk invoices import` reads a CSV (or a PDF twice, trusting only the lines both readings agree on), holds an invoice whose lines do not sum, never converts a currency, and `desk invoices reconcile` sets billed against estimated against the tool's own cost per month. The Bill screen shows the billed class and the comparison. No real invoice has been read (`docs/verification/invoices-and-reconciliation-2026-10-24.md`).
- **A third tool, OpenCode (built, one machine).** `desk ingest --agent opencode` reads OpenCode's database read-only (session, message and part tables only; the credential tables are never read; no text kept) into the ledger, which is now schema version 6. Checked against the Lab's accounting proxy on the 7 finished runs: calls, prompt tokens and completion tokens equal to the token once OpenCode's own session-title call is set aside. OpenCode does not store that call, and it was 16% to 60% of a run's completion tokens (`docs/verification/opencode-reader-2026-10-24.md`). Copilot CLI's local store holds no token counts, so it cannot be read.
- **Retention (built).** `desk retention` reads Claude Code's `cleanupPeriodDays` (30 by default), the age of every log and what the ledger has already read, and reports unread files about to pass the limit; `desk retention schedule` prints a daily ingest command and installs nothing. On this machine 1,634 files are past 30 days and still on disk, so deletion is not happening here, and the report says that instead of assuming it.
- **A second price source (built).** `desk prices compare` checks the price book against Portkey's open price file: 89 of 90 prices agree, and one does not (Sonnet 5.5 cache read, $0.10 against $0.20; NOT VERIFIED which is in force; worth $1,741.87 on this machine's tokens). The Bill screen shows the estimate as a range where a second source disagrees (`docs/verification/price-sources-2026-10-24.md`).
- **Enforcement beyond the hook (built, partial).** The gate keeps its own time at its last recorded event, so a clock set back cannot reopen a spent day, and a bypass suite runs four real processes against one database (never more than the cap reserved), replayed and misused approvals, and the clock cases; a clock set forward, a removed hook and an untouched tool are recorded as outside what it can see (`docs/verification/gate-enforcement.md`). The gateway door (`desk gate gateway`) lets a tool with no hook be governed: point its OpenAI-compatible base URL at it and every chat completion is reserved before it is sent and settled after, with the caller's key passed on and never stored, other writes refused as unmeterable, and a fail-closed 503 when the gate cannot decide. Run against Nightshift with an owner-set price and a small cap: calls settled to the micro-dollar, an over-cap call refused in 13 ms, never sent (`docs/verification/gateway-2026-10-24.md`). It meters the OpenAI chat route (run against a real endpoint) and the Anthropic messages route (tested against a fake upstream only; NOT VERIFIED against api.anthropic.com); the Responses API is not metered and is refused.
- **What a change cost (built).** `desk pr` reads new logs and the repository, takes the commits of a change, and counts each session tied to them in proportion to its commits in the change; it prints a description for the pull request. On this repository's last eight commits: one session, $29.21 counted of $200.80.

- **The replay chain (built; 2026-10-25).** Tasks captured from the owner's history with the tests that decide them (`desk capture`: a candidate must have a test that failed before the work and passes after it, run twice to set flaky ones aside); trajectories rebuilt from logs and captured at the gateway (`desk trajectories`, `desk gate gateway --capture`); a sandboxed replay that runs nothing it could not undo; a swap of two models on the tasks, graded by the original tests laid over the model's work, with the verdict withheld unless the baseline reproduces its recorded passes (`desk swap`); a judge panel that scores nothing until it agrees with the owner's own labels (`desk judge`). The live run on ten Lab tasks was withheld (the larger model reproduced 57%, under 90%).
- **Taking in and giving out (built).** Packs of rules or canary tasks from others, refused if they widen a policy or reroute, otherwise replayed and started in shadow (`desk pack`); an opt-in regression index with a preview of the exact bytes and a hash the owner accepts (`desk index`); `desk attack` for the attacker corpus and a request of one's own; workspace snapshots that never touch the real git index (`desk snapshot`); a Sigstore bundle of the month dossier that cosign verifies (`desk bundle`); tool-output alignment (`desk align`).
- **Language, team, calibration (built).** The token surcharge of a prompt in another script and a locale route experiment; team mode with roles, signed reports and an access log; ten-bin calibration with an abstain threshold for four surfaces (`desk calibrate surfaces`), which found the wind tunnel's chance of blocking landed work unreliable (error 0.28, no threshold reaches 80%).
- **Hooks for four tools (built; two run live).** Claude Code and Codex CLI were run for real with the hook (blocked with no gate, blocked by a refusing policy, let through by a permitting one). Running Codex found that a hook exiting 2 did not block although its documentation says it does; a deny on stdout did. Cursor and Gemini CLI have adapters that pass their contract tests and are advisory until run live (`desk gate hook --tool T --install`, `desk enforcement test --live`).
- **The demo as scenes (built).** Opening, scenes 0 to 4 and a closing, offline in about 35 seconds, and `desk demo --compare` showing every figure move on a changed sample.

### 7.3 Not built

One row: DF-121, the log of real Cursor use, which stays empty rather than be made up. What is built but has not met the real thing is listed in 7.4: the Responses route of the gateway (a fake upstream; NVIDIA serves no such route), the Cursor and Gemini CLI hooks (contract-tested; not installed or not signed in here), a judge panel (it needs the owner's own labels), the opt-in regression index (no receiving end), and a swap whose baseline reproduces its recorded passes (the live run was withheld).

### 7.4 NOT VERIFIED or thin

- How a plan's limit maps to tokens (every dollar is an estimate).
- Willingness to pay; any real user; any practitioner interview.
- Node 22.19 and macOS.
- Cursor use: no session logged.
- Zetaris beyond SQL; Meterless beyond three engines (section 5.4).
- Memory: H-MEM uses the engine's stub hash embedder, so recall is lexical; precedent retrieval in learning is by wording.
- The wind tunnel's "90%" range held 73% of 64 constructed months (72% with no change planted); its chance of blocking landed work has an error of 0.24; read it as a screen.
- The benchmark has one model, one constructed ledger and one question author, who also built the tools.
- The gate stops Claude Code and Codex CLI with the hook installed (both run live), and any tool pointed at the gateway door (verified on a real OpenAI-compatible endpoint over TLS; the Anthropic and Responses routes only on a fake one). The Cursor and Gemini CLI hooks have not been run live. A tool that does neither, a removed hook, or a clock set forward is not stopped.
- Claude Code's status line (plan limits) has not been run against a real session. Which Sonnet 5.5 cache-read price is in force ($0.10 or $0.20 per million tokens) is not known.
- The video is rendered but not uploaded; the HackOS submission is not created.

### 7.5 Planned, not built (see `docs/plan/05-desk-evidence-driven-build-plan.md`)

Everything in this list is a plan. None of it is built, and none of it may be described as a feature until it has a test and a recorded run. The plan is organised as ten phases in dependency order, each opening with a check that can say stop:

- **Phase 1, know what we have:** done: the 129-feature reconciliation, the decision-record schema and its wiring to proposals. Left: the claim registry itself and its check in `desk prove`, which wait for the Phase 0 numbers to be final.
- **Phase 2, trustworthy source data:** real limit-hit and statusline data and a fitted limit-to-token mapping; a `reported` cost class; fast and flex pricing and model retirement dates; CI facts and worktrees; readers for Gemini CLI, Cline and Cursor; an OTLP receiver; person and machine dimensions and admin-API connectors; deeper Zetaris use behind verification gates.
- **Phase 3, the Lab:** a harness that runs a real coding agent on frozen, independently graded repository tasks, with randomised assignment, repeated trials and complete cost accounting, replacing generic puzzles as the headline regression test. It opens with a feasibility spike that can stop it.
- **Phase 4, memory that changes decisions:** real embeddings, a six-kind memory taxonomy, contradiction, staleness and deletion tests, memory-on against memory-off on held-out decision tasks.
- **Phase 5, the decision laboratory:** competing candidate policies (including "do nothing") tested in the Lab, with counterfactual estimates applied only where assignment was randomised, calibrated intervals, and abstention when evidence is weak.
- **Phase 6, enforcement we can measure:** a reversible installer, a watcher for tools with no hook, scoped budgets, staged rollout with a control group, and a reported coverage number measured on Lab runs.
- **Phase 7, the measured learning loop:** outcomes after deployment, scored predictions, rollback of harmful learning.
- **Phase 8, the product people use:** teams, roles and approvals, notifications, a CI check on pull requests (the cost description exists as `desk pr`), privacy controls, a mobile summary of each table.
- **Phase 9, independent validation:** a real user trial, practitioner interviews, external reproduction, a security review, a licence audit.
- **Phase 10, competition evidence:** a frozen release and a demonstration built from real measured runs.

What the plan will not do: claim a causal effect from historical logs alone, treat a public benchmark as the headline when its own audits question it, or add features without a measurement behind them.

### 7.6 Only the owner can do

Log real Cursor sessions; upload the video and give the link; create the HackOS submission and choose Track 3; run Node 22.19 and macOS; answer the Day 3 check-ins (tick H-MEM, World Model and Markovian as integrated; do not tick Nightshift Runtime or AI Hotspot unless it is now true to say so).

---

## 8. Every source used to build it

### 8.1 The organisers and sponsors

- Organisers (local only): `docs/event/01` to `07` (welcome guide, FAQ, journey map, Approach Guide, Day 4 slides from another cycle, setup guide of 2026-10-15, the lesson "How the Week Runs" of 2026-10-17); readouts and rules in `docs/intel/01` to `12`; the Official Rules text read from the public event page.
- Zetaris: zetaris.com and its knowledge base, the `zetaris/getting-started` and `lightning-catalog` repositories, the local install (Docker, verified 2026-10-16/22); readout `docs/sponsors/zetaris-docs-readout.md`.
- Meterless: the open repository `Meterless/Meterless` commit `0aa7417` (Apache-2.0) for the three engines and their conformance suites; meterless.ai pages on Nightshift read 2026-10-24; the Nightshift Windows 1.2.3 installer and its own source files read on this machine; readout `docs/sponsors/meterless-docs-readout.md`.
- NVIDIA: build.nvidia.com hosted API (model `nvidia/nemotron-3.5-super-vl-120b-a12b`), measured 2026-10-22; NeMo Guardrails documentation.

### 8.2 Code actually taken

Two things only: Meterless's three reference engines and conformance suites (Apache-2.0, `vendor/meterless/NOTICE.md`, `src/engines/`) and a dated snapshot of LiteLLM's first-party price file (MIT, `data/prices/`).

### 8.3 Ideas rebuilt in our own code (no code copied)

About 50 sources, recorded with their licence class in `docs/design/desk/01-adoption-register.md` and profiled in `docs/design/prior-art/profiles/`. What each has that we do not use is in `docs/design/desk/06-prior-art-gap-list.md`.

- Spend and observability: ccusage, CodexBar, Claude-Code-Usage-Monitor, agentsview, LiteLLM, Portkey gateway, Helicone, tokencost, agentbudget, figuard-core, loopguard, tokencast, Langfuse, Opik, Phoenix, OpenTelemetry GenAI conventions, Entire CLI, Apache DevLake, codelens-ai, openllmetry, claude-devtools, OpenCost, claude-code-cache-fix, vibe-kanban.
- Evaluation, replay, governance and verification: promptfoo, Inspect AI, livenerf, dedrift, container-use, LangGraph, agent-bisect, Reenact, Kitaru, Microsoft agent-governance-toolkit, NeMo Guardrails, Cedar, coder/boundary, coding-agent-flight-recorder, SWE-bench, DeepEval, autoevals, Cline, in-toto attestation, Sigstore cosign, lm-evaluation-harness, A-Mem, Reflexion, ALCE, FActScore.
- Licence rule applied: MIT, Apache and BSD sources are adapted with credit; GPL, AGPL, ELv2, source-available and unclear sources (dedrift, Phoenix, coder/coder, figuard) are ideas only.

### 8.4 Papers and methods

tau-bench (arXiv 2406.12045, pass^k), Reflexion (2303.11366), RouteLLM (2406.18665), MT-Bench and LLM-as-judge (2306.05685), Safe Anytime-Valid Inference (2210.01948), ALCE (2305.14627), FActScore (2305.14251), cluster-robust error for evaluations (Miller, 2411.00640), the SWE-bench method, the Cedar policy-language idea (named from memory, NOT VERIFIED), Wilson 1927, Brier 1950, Jeffreys 1946, Efron 1979, Naeini 2015, Guo 2017.

### 8.5 Public evidence for the problem

146 recorded claims with the URL and fetch date in `docs/design/desk/04-evidence-table.md`: GitHub issues on Claude Code and Codex, Reddit and Hacker News threads, and market pages. They were fetched on 2026-10-20 and not re-opened since.

### 8.6 Tools, libraries and data

Runtime: Node ≥ 22 with `node:sqlite`; two dependencies, `yaml` and `@resvg/resvg-js`. Development: `tsx`, TypeScript, `vitest`. Video and deck: Remotion (React), headless Chrome for the PDF, Playwright for screenshots. Fonts: Outfit and JetBrains Mono (SIL OFL). Data: a constructed sample generated from a seed (14 engineers, 987 sessions over two months in real log format, real git repositories, planted waste); nothing real.

### 8.7 How it was written

With AI assistants (Claude Code). The dated record is `docs/sponsors/ai-use-provenance-log.md`. Cursor was the required IDE until 22 October 2026, when it became optional; it was not used and has no logged session.

---

## 9. Paths

| What | Path |
|---|---|
| This file | `docs/product-description.md` |
| What each source has that we do not use | `docs/design/desk/06-prior-art-gap-list.md` |
| README, the agents, the evidence, the reference | `README.md`, `docs/the-agents.md`, `docs/evidence.md`, `docs/reference.md` |
| Architecture, adoption register, 129 features, requirements, evidence table | `docs/design/desk/00` to `05` |
| The build plan and the outside blueprint it responds to | `docs/plan/05-desk-evidence-driven-build-plan.md`, `docs/plan/external-blueprint-gpt-2026-10-24.md` |
| Requirements against the organisers' lines | `docs/submission/requirements-coverage.md` |
| Sponsor explanation, pre-existing components, checklist, video script, deck | `docs/submission/` |
| What was run against the real thing | `docs/verification/` (benchmark and its pre-registration, canary, calibration, learning, gate, UI sweep) |
| Sponsor facts | `docs/sponsors/` |
| The organisers' originals and readouts (local only) | `docs/event/`, `docs/intel/` |
