# desk.

**Every dollar your agents spend, tied to work that landed.**

[![Track 3: Reasoning Architecture](https://img.shields.io/badge/Open_Agent_Hackathon_2026-Track_3_Reasoning_Architecture-0a0a0a?style=flat-square)](#one-product-three-tracks)
[![Checked](https://img.shields.io/badge/checked-2%2C675_tests_%C2%B7_61%2F61_prove_checks-059669?style=flat-square)](docs/verification/clean-room/)
[![Runs offline](https://img.shields.io/badge/runs-offline%2C_no_key-0a0a0a?style=flat-square)](#try-it)
[![Node 22.19+](https://img.shields.io/badge/node-22.19%2B-0a0a0a?style=flat-square)](#try-it)
[![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-0a0a0a?style=flat-square)](LICENSE)

[**Watch the demo (3:57)**](https://youtu.be/3LaYZ0VCgXI) · [Slide deck](docs/submission/desk-deck.pdf) · [Open the screens in a browser](https://desk-demo.vercel.app/) · [Try it](#try-it) · [For judges](#for-judges-what-was-asked-and-where-it-is) · [Evidence](docs/evidence.md) · [Sponsor technology](docs/submission/sponsor-technology-explanation.md)

desk. is a local desk for the person who pays for AI coding agents. It explains why a limit was hit, checks every day whether the agent got worse, tests a spend policy on a month it never saw, and signs what it concludes so that a stranger can verify it offline. No account, no upload: it reads your agent logs on your machine.

Built for the Open Agent Hackathon 2026, Track 3 (Reasoning Architecture), with Zetaris, Meterless and NVIDIA Nemotron.

> We are building an agent that helps **an engineering lead who pays for coding agents** decide **next month's caps and routes** by **tying every dollar to the work that landed and testing a policy on a month it never saw**, using **the agents' own session logs, git history, and three Zetaris-joined sources (invoices, CI, a seat roster)**, producing **a limit autopsy, a daily regression verdict, and a signed, replay-tested spend policy a stranger can verify offline**.

| | | |
|---|---|---|
| ![The morning brief](docs/submission/deck/img/brief.png) | ![The canary calling a regression](docs/submission/deck/img/canary-top.png) | ![An answer checked by code](docs/submission/deck/img/ask.png) |
| The brief | The canary: a regression called, control arm flat | Ask: every figure comes from a typed step |

Skim path: [The idea](#the-idea), [Try it](#try-it), [Check it yourself](#check-it-yourself), [One product, three tracks](#one-product-three-tracks), [The evidence](#the-evidence), [What is not built](#what-is-not-built-and-what-is-not-verified).

## The idea

Most tools that watch AI spend report usage, an estimated cost and some activity (a vendor's own analytics list sessions, commits and pull requests). desk. goes one step further and treats every number as a claim: it must carry the rows it came from, say what it could not know, and survive a test on data it never saw. The same discipline runs through the whole product. A figure is computed by code, never by the model. A policy is replayed on a month it was not drafted from, and the headline is the landed work it would have blocked. A regression is called only against a control arm. A conclusion is signed so that a stranger can verify it offline. Where it fell short of its own label (a "90%" range that held 73% of the time), it says so on screen.

Usage trackers such as ccusage and CodexBar read agent logs and show cost, and vendors report usage and development activity in their own consoles and APIs (Anthropic's Claude Code Analytics API lists commits and pull requests by Claude Code with an estimated cost; OpenAI and Cursor publish admin analytics for their own tools). As far as we read them on 2026-10-20 and 2026-10-26 (`docs/design/desk/05-track-coverage-and-sources.md`, `docs/validation/impact-and-market-validation.md`), none ties each dollar across vendors to independently checked outcomes, replays a policy on a month it did not see, calls a regression against a control arm, or signs the result. desk. takes their log-reading and pace ideas and adds those.

## Try it

**Nothing to install:** the 14 screens, read-only, on the constructed sample, are at https://desk-demo.vercel.app/ (answers recorded from the real server by `npm run desk -- ui --sample --export docs/demo`, and served as static files; a choice that was not recorded says so).

Needs Node 22.19 or later (run on 22.23 and 24.20; 22.19 itself is NOT VERIFIED). Nothing else for the sample.

```
git clone https://github.com/Pratiikpy/agent-spend-desk.git && cd agent-spend-desk
npm install
npm run desk -- --sample      # the limit autopsy card, on a constructed sample, offline (about 20 seconds)
npm run desk -- demo          # the whole demo in scenes, offline (under a minute); add --compare to see every figure move on a changed sample
npm run desk -- ui --sample   # fourteen screens on a local, read-only server
npm run desk -- prove         # every check, each PASS, FAIL or NOT RUN
npm run desk -- help          # every command, grouped by what you are trying to do
npm test                      # the unit and integration tests
```

**On your own logs:** `npm run desk` reads `~/.claude/projects` read-only and prints your own limit autopsy in under three minutes: where your last heavy window went, which fix is worth making, and what the Desk could not know. Add `--repo <path>` to tie sessions to commits. Nothing is written outside `data/desk/`.

Verified from fresh clones at commit `df0fb94` (every commit after it changes documents, the video project and these logs only, starting with this line): typecheck clean, 2,675 tests (2,674 passed and one skipped on Windows, 2,673 passed and two skipped on Ubuntu, the skips being tests that need tools or a platform the machine lacks) and `desk prove` at 61 PASS, 0 FAIL, 0 NOT RUN, on Windows 11 with Node 24.20 and Ubuntu 22.04 (WSL) with Node 22.23 (`docs/verification/clean-room/`, made by `scripts/clean-room.sh`). Node 22.19 and macOS are NOT VERIFIED. On PowerShell, `$env:SAMPLE_MODE="true"` does the same as `--sample`.

## Check it yourself

Six things that take a few minutes each and need no key, so that no figure has to be taken on trust:

1. **Move the figures.** `npm run desk -- demo --compare` runs the demonstration on a changed sample and shows every figure move; nothing in it is typed in.
2. **Switch an engine off.** `npm run desk -- ask "What changed before 2026-10-15?" --sample`, then the same with `--ablate world_model`: the answer becomes "unknowable", which is the evidence that the engine does something.
3. **Verify a conclusion as a stranger.** `npm run desk -- propose --sample --dossier` drafts and replays a policy and prints an approval line; run that line, and the output ends with the exact `desk-verify` command for the signed dossier it wrote. It recomputes the figures on plain Node with the network off. Change one byte in a row file in that folder and run it again: it names the row.
4. **See what it can stop.** `npm run desk -- enforcement` lists each agent tool as enforced, advisory or notify only, with the version and the date of the test behind each; `npm run desk -- prove` runs every check and says PASS, FAIL or NOT RUN.
5. **Check which model answered.** `npm run desk -- receipts docs/verification/nightshift-receipts` verifies the Ed25519 signature on each of eleven live Nemotron calls (Planner, Explainer, Drafter, Attacker, on two Nemotron models) and prints which model answered which role; add `--pin e92caae86b5f702e` to require the key that signed them.
6. **Try to step around a policy.** `npm run desk -- attack policies/stop-loops.yaml` runs the attacker corpus against a policy file and says how many generated policy pairs the restrict check was held to (2,000 here, and that is the number tried, not a proof).

## How it works

Five steps, each of which leaves something a reader can open. The model writes language; code does every sum, every check and every signature.

1. **Read.** desk. reads your agent logs read-only (Claude Code by default; Codex, OpenCode and Claude Code's status line too) into a local SQLite ledger. Every dollar is classed `billed`, `reported`, `estimated` or `unpriced`, and says which. Invoices (files in a bucket), CI facts (Postgres) and a seat roster (REST) are joined into the same ledger by one Zetaris statement, and where the sources disagree it shows the conflict.
2. **Explain.** The autopsy splits a heavy window by cause (sub-agents, cache misses, loops, idle work, work that was needed) and ranks the fixes with intervals. Landing ties sessions to the commits and merges they produced. **Ask** answers a question by writing a typed program that read-only specialists run; an Auditor rejects any sentence whose figure no claim supports, and the Explainer revises at most twice or drops it.
3. **Watch.** A canary runs a fixed 52-task pack every day on two arms, one of them a control, and calls a regression only against the control, with an interval and what it cannot say. A model switched on purpose on day 15 is found at -40.0 points; the control stays flat.
4. **Decide.** A Drafter (Nemotron) proposes a spend policy from one month; code checks that it only narrows the policy in force; an Attacker (Nemotron) looks for requests that step around it; then it is replayed on a month it was not drafted from. The headline is the landed work it would have blocked, not the savings. The owner approves by echoing the request's digest.
5. **Prove and enforce.** Every conclusion is a signed dossier carrying the rows its figures come from, and `desk-verify` recomputes it on plain Node with the network off. A gate asks permission before an agent's tool call: through the hooks of Claude Code and Codex CLI (both run live), and through a gateway door for tools that can use another base URL. It fails closed, and `desk enforcement` says per tool what it can really stop.

**Where each sponsor sits.** Zetaris is the data layer (step 1). Meterless's three engines (World Model, H-MEM, Markovian) are memory and history for Ask (step 2); there is no Meterless API, so they run in our own process and pass their own conformance suites. NVIDIA Nemotron serves every language role (Planner, Explainer, Drafter, Attacker, canary and the three benchmark arms). Meterless Nightshift is the route to Nemotron, and every reply it serves carries an Ed25519-signed receipt that desk. checks (`desk receipts`; eleven live calls are in `docs/verification/nightshift-receipts/`). Cursor became optional on 22 October and was not used: desk. was written with Claude Code (`docs/sponsors/ai-use-provenance-log.md`). The table under [Sponsor technology](#sponsor-technology) says what changes when each is switched off.

**Stack.** TypeScript on Node 22 (run with `tsx`), SQLite, two runtime dependencies (`yaml` and `@resvg/resvg-js`, which draws chart images), no build step and no database server. Everything runs on the bundled sample offline, with recorded model replies; the three Zetaris silos and a live model are optional (`docs/reference.md`).

Terms used above and below (canary, wind tunnel, dossier, restrict-only check, the three Meterless engines) are defined under [How it is built](#how-it-is-built).

## For judges: what was asked, and where it is

| The organizers asked for | Where it is |
|---|---|
| A demo video of 1 to 4 minutes, main workflow end to end, naming Zetaris and Meterless and where each sits | [3:57 captioned video](https://youtu.be/3LaYZ0VCgXI) (every figure read from a real run or a result file; script in `docs/submission/demo-video-script.md`) |
| A slide deck: problem and users, solution, agent workflow and architecture, stack, sponsor use, product visuals, future | [`docs/submission/desk-deck.pdf`](docs/submission/desk-deck.pdf) (26 slides; source `docs/submission/deck/deck.html`) |
| A GitHub repository with a README someone outside the team can run | This file. [Try it](#try-it) runs with no key and no setup beyond `npm install`; fresh-clone runs on Windows and Ubuntu are in `docs/verification/clean-room/` |
| Setup, usage and dependencies | [Try it](#try-it); stack above; `docs/reference.md` (stack and dependencies, run time, live mode) |
| Sponsor technology explanation: how Zetaris, Meterless and NVIDIA are used (and that Cursor was not), and what was unique | [Sponsor technology](#sponsor-technology) and `docs/submission/sponsor-technology-explanation.md`; each claim has a call site, a trace line and a switch-off test |
| One primary track | Track 3, Reasoning Architecture. The same product does the work of Tracks 1 and 2 ([One product, three tracks](#one-product-three-tracks)) |
| A defined user, decision, data slice and output | The blockquote at the top: an engineering lead, next month's caps and routes, agent logs plus three Zetaris-joined sources, a signed and replay-tested policy |
| A real agent system, not a pipeline: roles, tools, critique, revision, branching, fallback, a trace | `docs/the-agents.md` (the roster, all nine collaboration behaviours each tied to a file or trace event, human approval and escalation); a JSONL trace file with the reason for each decision is written by `desk ask` and `desk propose` (and by the gate when `DESK_GATE_TRACE` is set) |
| A bounded, predictable run (organizer target 5 to 10 minutes) | Budgets for wall clock, model calls, tool calls and turns are enforced in code; the demonstration takes under a minute offline; `docs/reference.md#how-long-a-run-takes` |
| A description of each sponsor's use in `metadata.json` | [`metadata.json`](metadata.json): what each sponsor does, where it lives, the evidence and what changes when it is off (the organizers published no format, so it follows what the sponsor folders ask for; `tests/desk/metadata.test.ts` checks that every file it names exists) |
| Nemotron: which agent runs on which model, with a receipt log (the organizers' advice for the Nemotron award) | The sponsor table below, and [`docs/verification/nightshift-receipts/`](docs/verification/nightshift-receipts/README.md): Nightshift's signed receipts for live calls of each role, checked by `desk receipts` and by `desk prove` |
| Sample inputs, sample outputs, a trace, a data README | `input_examples/`, `output_examples/` (with `traces/`), `data/README.md`; [The sample](#the-sample) is generated from a seed |
| No secret needed, nothing hardcoded, and a fallback when an API is down | `.env.example` is empty on purpose; outputs come from the run, recorded replies replay offline, and a request with no recording is an error, never a guess |
| Answers to the organizers' red flags | `docs/evidence.md#against-the-organizers-red-flags` |
| Pre-existing components declared; honest provenance | [Provenance](#provenance) and `docs/submission/pre-existing-components.md` |
| Colab links, only if Colab-hosted agents were used | None were used |

Where each scoring criterion is shown:

| Criterion (points) | What to open |
|---|---|
| Impact (30): a clearly defined user with a real problem | [The problem](#the-problem) with five public quotes and their sources; `docs/design/desk/04-evidence-table.md` |
| Technical (20): reliable execution, real agent work, critique and recovery | `npm run desk -- prove` (61 checks); the benchmark with its losing first run published; a policy draft that was caught blocking landed work and revised (`output_examples/traces/`) |
| Innovation (15) | A restrict-only policy check held to an oracle; a signed dossier a stranger verifies offline; a gate that says per tool what it really stops; the Desk's own judgement recorded and scored |
| Demo (15) | The video above and `npm run desk -- demo` (under a minute, offline) |
| Product and UX (10) | The 14-screen UI (`npm run desk -- ui --sample`), reviewed in light and dark, desktop and phone (`docs/verification/ui-sweep.md`) |
| Sponsor technology (10) | [Sponsor technology](#sponsor-technology); what changes when each is off |

## At a glance

| | |
|---|---|
| **Code** | About 66,600 lines of TypeScript in 436 files, 2,700 lines of browser JavaScript in 20 files, and 36,100 lines of tests in 206 files. Runtime dependencies: two |
| **Checked** | 2,675 tests and `desk prove` with 61 checks, all PASS, on fresh clones of Windows 11 (Node 24.20) and Ubuntu 22.04 (Node 22.23) |
| **The product** | 80 commands (`desk help` lists them), a 14-screen local UI, nine agent roles, a gate that stops tool calls through the hooks of Claude Code and Codex CLI (run live), with adapters for Cursor and Gemini CLI, and a gateway door for tools that can point at an endpoint (chat, messages and responses routes), signed dossiers with an offline verifier |
| **Specified** | 129 numbered features and a requirements document under `docs/design/desk/`; 200-odd pages of design, sponsor and verification notes |
| **Measured** | Pre-registered 60-question benchmarks in three rounds, whose 2,748 recorded model replies `desk prove` replays, a 52-task canary over 30 days with a control arm, a wind tunnel, a regret ledger, a learning loop, and what each of them got wrong |
| **Sponsors** | Zetaris joins three silos with one statement; three Meterless engines run in our process (conformance 8/8, 13/13, 8/8); Nemotron serves every language role |

## One product, three tracks

![The architecture: sources, data, reasoning, decisions, and where each track and each sponsor sits](docs/submission/deck/img/architecture.png)

One primary track is judged, and we submit under **Track 3**. The same product also does the work of the other two. The diagram shows the parts; the table says which parts each track relies on.

| Track | Where it lives in desk. | Try it |
|---|---|---|
| 1. Solving fragmented intelligence | Agent logs, plus invoices (files), CI (Postgres) and a seat roster (REST) joined by one Zetaris statement into one ledger. The three silos are synthetic, derived from the constructed sample; the single statement that joins them and the conflicts it finds are real code. It shows where the sources disagree: invoices land 1.2% under the list-price estimate, and 60 of 644 landed sessions merged although the checks were red. | `desk silos`, `desk landing` |
| 2. The agent that can explain why | Ask turns a question into a typed program that read-only specialists run, and an Auditor rejects any figure no claim supports. Every conclusion is a signed dossier that a stranger verifies offline; one changed byte names the row. | `desk ask`, `npm run desk-verify` |
| 3. Reasoning architecture (primary) | Plan, critique, revise, replay: a Planner and its critic, specialists, an Auditor and Explainer, a Drafter, a restrict-only check and an Attacker, a canary with a control arm, Meterless engines as memory, Nemotron in every language role, and a pre-registered head-to-head against a tool agent. | `desk propose`, `desk bench report` |

## The problem

An engineering lead pays for a team's coding agents, on seats and on tokens. The bill is a number and the limit is a message; vendor dashboards show usage and some activity, but nothing ties each dollar to work that was checked and landed. The decision is next month's caps and routes, and today it is made without evidence. desk. ties each dollar to the work that landed (a commit, a merge, a revert), shows which cause ate the limit, and tests a policy before it is applied.

The pain is public. These are quotes from the sources we read on 2026-10-20 (each URL was fetched then and not re-opened since; the full table is `docs/design/desk/04-evidence-table.md`):

- "Did not use Claude Code for three days. Never hit usage limits in the last three months. Now hitting usage limits after 2 hours of continous usage." ([claude-code #16157](https://github.com/anthropics/claude-code/issues/16157))
- "my ChatGPT Plus Codex budget drains in 2–3 prompts on `gpt-5.5`, where the same model/plan/app previously gave 20+ prompts." ([codex #28879](https://github.com/openai/codex/issues/28879))
- "The dashboard has a multi-day reporting lag, so I had no idea anything was wrong until the limit email landed." (a user who [burned $6,000 of usage](https://www.reddit.com/r/ClaudeAI/comments/1t11mmy/i_accidentally_burned_6000_of_claude_usage/))
- "My session silently routed to a different model path." ([r/cursor](https://www.reddit.com/r/cursor/comments/1t2gjtl/cursor_silently_switched_models_while_i_was_deep/))
- "Every assigned seat bills at list whether or not the user opens Copilot." ([Redress Compliance](https://redresscompliance.com/microsoft-copilot-adoption-2026))

The first three are why the autopsy exists, the fourth is why the canary runs every day, the fifth is why seats are tied to landed work.

## What it does

| You ask | desk. answers with | Command |
|---|---|---|
| Where did my limit go? | The heaviest window split by cause, with ranked fixes and a block of what it could not know | `desk card` |
| What did the money buy? | Spend by landing state: kept, merged, committed, reverted, unlinked (unlinked is unknowable, not waste) | `desk landing` |
| What do my invoices, CI and roster say? | One Zetaris statement over three sources: billed against estimated, spend per landed pull request | `desk silos` |
| Did the agent get worse? | A daily canary: verdict, interval, control arm, and what it cannot say | `desk canary` |
| What should the caps be? | A drafted policy that is checked, attacked, then replayed on a month it never saw | `desk propose --dossier` |
| Can I trust that? | A signed dossier a stranger verifies offline; one changed byte names the row | `desk approve`, `npm run desk-verify` |
| Why did it change? | An answer from typed, read-only steps that an Auditor checks; engines can be switched off | `desk ask` |
| Is the reasoning architecture better than calling the model? | A pre-registered 60-question head-to-head, with its first losing run and its misses | `desk bench report` |
| Where did the waste hide? | Extra rules over the tool calls: the same error from new inputs, cut-short results repeated, file churn, bare calls, orphaned agents, and context rebuilt after a compaction that landed nothing; each says how sure it is | `desk waste` |
| Which agent started which? | Delegated agents alone and with everything they started, the sessions that went too deep, and the idle and unowned spend shared among the projects that landed work, to the micro-dollar | `desk delegation`, `desk overhead` |
| Would this change make the agent worse or dearer? | A pipeline gate that compares the canary on a change with the baseline: exit 0 pass, 1 fail, 3 inconclusive (never a pass), with the evidence pack | `desk ci` |
| What can it actually stop? | Tool by tool: enforced (a test refused a call), advisory, or notify only; a live test per tool version | `desk enforcement` |
| Can it stop a runaway? | A local gate that Claude Code calls before each tool use, and a gateway door for any tool that can use another base URL; both fail closed | `desk gate serve`, `desk gate gateway` |
| Will this plan window last until it resets? | A forecast from how past windows of the same plan ended, and what a percent of the limit costs in tokens; it declines when there is too little history | `desk runway`, `desk limits` |
| What did one pull request cost? | The agent sessions behind a branch's commits, as text for the pull-request description | `desk pr` |
| Does it read my other agents? | Codex and OpenCode logs, and Claude Code's status line for plan limits, into the same ledger | `desk ingest --agent codex`, `opencode`, `statusline` |
| Is the estimate right? | Claude Code's own recorded cost against the estimate, process by process, and the price book against a second source | `desk reconcile`, `desk prices compare` |
| Would a cheaper model have done the same work? | The recorded tasks replayed on two routes, with a screen for which kinds of task held up on both halves | `desk route` |
| Which seats earn their price? | Seats a team holds beyond the people who landed work, from the Zetaris roster | `desk seats` |
| Does its stated confidence mean what it says? | Link confidence against planted truth, the wind tunnel's range and probability against what happened | `desk calibrate` |
| Was the Desk's own judgement right? | What it expected of each option when it proposed, scored on the month that followed, with regret | `desk regret` |
| Does it learn from its mistakes? | Wrong answers become lessons; held-out error is measured per round and a worse round is reverted | `desk lessons learn` |
| Could a cheaper model do my own tasks? | Tasks captured from your history with the tests that decide them, run on two models in a sandbox, graded by tests the model never saw; a comparison is withheld unless the baseline reproduces its recorded passes | `desk capture`, `desk swap` |
| Which of my sessions could be replayed? | Each session's tool calls and results as a trajectory, classed full, tools only or insufficient, from your logs or captured at the gateway | `desk trajectories`, `desk gate gateway --capture` |
| Can I take in someone else's rules? | A pack that widens a policy or changes a route is refused; the rest is replayed on your month and starts in shadow | `desk pack` |
| Can anyone step around my policy? | The attacker corpus, a request of your own, and how many generated policy pairs the restrict check was held to | `desk attack` |
| Can I save a workspace before an agent touches it? | A git snapshot that never touches your index, restored byte for byte | `desk snapshot` |
| What does a prompt in another language cost? | The surcharge in tokens over English, and a team view with roles and signed reports | `desk language`, `desk team` |
| Does each confidence mean what it says? | Ten-bin calibration and an abstain threshold for links, forecasts, a judge panel and the Auditor; a default is used, and said so, under 50 pairs | `desk calibrate surfaces` |
| Can a stranger check the month's dossier with standard tools? | A Sigstore bundle of it, verified offline (cosign agrees) | `desk bundle` |

## The evidence

- **A regression, called.** The canary calls the planted model switch on day 15: **-40.0 points, 99% interval -56.2 to -23.8, control arm flat**. A first run on 16 tasks refused to call it, and both runs are in the repository.
- **A mix of Nemotron models, preregistered.** On 60 new questions (set F) the Desk was run on three Nemotron models through Nightshift. Exact answers: Lightning 30B (3B active) 54, Super-vl 120B 60, Ultra 550B 59; the plain tool agent on the same models 26, 47 and 51. A mix with the Planner on Ultra and the Explainer on Lightning answered 60; the reverse mix 50, against 54 for Lightning alone. Of seven written predictions five held and two did not (the reverse mix, and the order of speeds); 1,044 signed receipts verify and name the model each role used. One run per arm, so the 4-question gap is not established (`docs/verification/mix/RESULTS-mix.md`).
- **Which roles earn their place, pre-registered.** Each role of the Desk was taken out in turn on 60 questions and compared with the full Desk on the same questions by the exact McNemar test. Without the **Planner**, 30 questions are lost and none gained (p < 0.001). Without the plan critic, the revision loop, the Auditor or the Explainer, no question differs, and the report says *not shown necessary*, which is an absence of evidence and not a finding that the role does nothing. With the Explainer's first figure corrupted on purpose, the Auditor leaves 26 more answers clean than the arm without it. Six of the eight written predictions held, one half held and one held for calls only (`docs/verification/ablation/RESULTS-ablation.md`).
- **A head-to-head, pre-registered.** Same Nemotron model, 60 questions nobody had read (set D, preregistered before any run): the Desk v3 **55 exact against a tool agent's 45 and one call's 12**, and 85% against 70% and 18% when each question is asked three more times. All seven written predictions held. The five misses are the five shapes the Desk has no step for. On sets A and B, which the Desk was built against, v3 answers 60 of 60 each, reported as post hoc; the earlier rounds, including a first run that lost, are in the repository. Ten in sixty is a margin this size of set cannot make certain (`docs/verification/benchmark/RESULTS-v3.md`).
- **Held-out replay.** A policy drafted from September meets October: it would have blocked **5 of 333** landed sessions. That, not the savings, is the headline.
- **A verifier a stranger can run.** `desk-verify` recomputes a signed dossier's figures on plain Node with the network off; one changed byte names the row. A signature proves the record was not altered after signing and that its figures follow from its rows; it does not prove that the agent logs were truthful.
- **Its own confidence, measured and published.** The wind tunnel's "90%" range held the real month in **73%** of 64 constructed samples (72% with no change planted), and, on the Desk before v3, learning from mistakes moved 2 of 60 questions with an interval that touches zero, so no improvement is claimed; on v3 the same experiment finds no mistake on 120 training questions, so there is nothing to learn from.
- **Against the tool's own cost.** On one machine, 420 Claude Code processes with a recorded cost: 248 (59%) agree with the estimate to within 2%, the median difference is 0.0%, and without sub-agents the estimate is 8% below the tool's figure. Three sub-agent-heavy processes hold 97% of the dollar difference, so the total is $15,206 estimated against $9,353 recorded. Nothing was compared with an invoice (`docs/verification/reconciliation-2026-10-24.md`).
- **A price book with a second source.** 89 of 90 prices agree with Portkey's open price file. The one that does not, Sonnet 5.5 cache reads ($0.10 against $0.20 per million tokens), is worth $1,742 on this machine's 17.4 billion cache-read tokens; which is in force is NOT VERIFIED, and the Bill shows both.
- **A plan limit in tokens, and a forecast that was replaced.** On one machine's Codex logs a Plus plan's 5-hour window is 258K tokens per percent (95% interval 244K to 275K, 76 windows), and the fit declines where fewer than 8 windows moved the percent by 10 points. The first forecast of whether a window would last held its 80% range in 2 of 26 cases and was replaced; the replacement, which looks at past windows of the same plan at the same stage, scored a Brier of 0.186 against 0.327 for the base rate when run forward in time over 237 readings, and was no better than the base rate when it stopped learning (0.414 against 0.433). One person, one plan (`docs/verification/codex-reader-and-limit-fit-2026-10-24.md`, `docs/verification/runway-2026-10-24.md`).
- **A gate for tools with no hook.** Behind the gateway door, on a real OpenAI-compatible endpoint, an allowed call was settled to the micro-dollar and an over-cap call was refused in 13 ms without the endpoint being called; with the gate down the door answers 503. The Anthropic route is tested against a fake endpoint only (`docs/verification/gateway-2026-10-24.md`).
- **What it can stop, tested.** `desk enforcement test --live` ran the real Claude Code (2.1.308) and the real Codex CLI (0.154.0), each three times: with no gate (blocked, so it fails closed), behind a policy that refuses (blocked) and behind one that permits (it ran). Both read enforced at those versions. Running Codex showed that a hook exiting 2, which its documentation says blocks, did not; a deny on stdout did, and the adapter answers that way. Cursor and Gemini CLI have adapters that pass their contract tests but were not run live (not installed, no sign-in): advisory. OpenCode, Cline read advisory and Copilot notify only (`docs/verification/hook-adapters-2026-10-25.md`, `docs/verification/enforcement-2026-10-25.md`).
- **A swap that declined to answer.** The larger of two Nemotron models passed 57% of its own scored runs on ten Lab tasks, under the 90% a comparison needs, so the verdict was withheld and the run says it cannot tell (`docs/verification/swap-2026-10-25.md`).
- **A gate that calls a fall only when the data support it.** On packs of known truth (400 pairs, 52 tasks) it called a fall in 1 of 400 when nothing changed and in 96% of cases for a 20-point fall; for a 3-point change it usually says inconclusive, because one pack cannot rule that size out (`docs/verification/ci-gate-2026-10-25.md`).
- **`desk prove`:** 61 PASS, 0 FAIL, 0 NOT RUN. NOT RUN names a check the spec asks for that is not built or not recorded; it is never counted as a pass.

Every figure, its file, and the failures: [docs/evidence.md](docs/evidence.md) and `docs/verification/`.

## How it is built

```
agent logs ──► ledger (SQLite) ──► autopsy, landing, price book ─┐
Zetaris ──► invoices · CI · roster ───────────────────────────────┤
                                                                   ▼
                          Ask: Risk Router → Planner → typed steps → Auditor ⇄ Explainer
                          Propose: Drafter ⇄ restrict check · Attacker · replay on a held-out month
                          Canary: task pack, control arm, regression statistic
                                                                   │
                       gate (reserve · hook · MCP) ◄── approval echo ──► signed dossier ──► desk-verify
```

- **A real agent system, not a pipeline.** The Planner proposes a typed program (steps such as spend, share, per-day, top sessions, landing, changes before). Code validates and runs it read-only; code, not the model, does every sum and percentage. The Auditor rejects any sentence whose figure no claim supports; the Explainer revises at most twice or the sentence is dropped. The Drafter's policy rules must pass a restrict-only check and a replay, the Attacker looks for requests that step around them, and the hardener closes what it can. A Planner can also decline a question the ledger cannot hold.
- **Verification is code.** Budgets (wall clock, model calls, tool calls, turns) are enforced in code. Every language role has a rule-based fallback and the trace says when it was used. `desk ask` and `desk propose` each write a JSONL trace file with the reason for each decision (`ask-<answer id>.trace.jsonl`, `proposal-<id>.trace.jsonl`), and the gate does when `DESK_GATE_TRACE` is set.
- **Honest classes.** Every dollar is `billed`, `reported`, `estimated` or `unpriced`. Dollar figures are list-price estimates from logged tokens and say so. A cause is a part of the cost, not a verdict.
- **Reproducible.** Offline runs replay recorded model and Zetaris replies; a request with no recording is an error, never a guess.

**Terms.** *Canary*: a fixed 52-task pack run daily on two arms, one of them a control, to call a regression. *Wind tunnel*: a replay of a policy over simulated 30-day months resampled from your history, giving a range for its effect. *Restrict-only check*: code that proves an edited policy only narrows the one in force. *Dossier*: a signed bundle of a conclusion with the rows its figures come from. *H-MEM, World Model, Markovian*: the three Meterless engines (owner definitions and past decisions; what changed when; bounds a long range).

Code map: `src/desk/` (ledger, ingest, autopsy, outcomes, policy, replay, agents, ask, engines, silo, canary, bench, gate, dossier, verify, card, ui, propose, prove), `src/sponsors/zetaris/` (the Zetaris port), `src/engines/` (Meterless engines), `vendor/meterless/` (their conformance suites, unchanged), `infra/silos/` (three synthetic silos), `policies/`, `tests/`.

## Sponsor technology

Each claim has a call site, a trace line and a test that switches the component off. Full text: `docs/submission/sponsor-technology-explanation.md`.

| | Where | What changes when it is off |
|---|---|---|
| **Zetaris** | `src/sponsors/zetaris/`: one statement joins an S3-style invoice file, a Postgres CI database and a REST roster | The bill falls from billed (invoice amounts, 100% of the ledger) to estimated only; landing loses CI facts (584 landed sessions on green checks, 60 on red); the spend-per-landed-PR table disappears. A real container kill was run |
| **Meterless** | `src/engines/` (World Model, H-MEM, Markovian), conformance 8/8, 13/13, 8/8 from Meterless's own runners; Nightshift as the route to Nemotron (`src/desk/agents/model.ts`), with each reply's signed receipt checked (`src/desk/agents/receipt-signature.ts`, `desk receipts`) | `desk ask --ablate world_model` turns "what changed before 15 October" into "unknowable"; an owner's definition in H-MEM changes what counts as landed; Markovian bounds a long range |
| **NVIDIA Nemotron** | `src/desk/agents/model.ts`, through Nightshift or NVIDIA's own OpenAI-compatible API, tool calling verified; roles: Drafter, Attacker, Planner, Explainer, the canary, all three benchmark arms; which model answered which role, with signed receipts, is in `docs/verification/nightshift-receipts/` | Recorded replies replay the same answers offline; without them the rule brain answers and the trace says so |
| **Cursor** | Not used. It became optional on 22 October 2026; the editor rules in `.cursor/rules/` are the only trace | `docs/sponsors/cursor-usage-log.md` and `docs/sponsors/ai-use-provenance-log.md` say how the product was written |

## The sample

`--sample` generates a constructed scenario from a seed (about 590 MB under `data/desk/`): 14 engineers, 987 sessions over two months as real-format Claude Code logs and real git repositories, with waste planted at known places (loops, idle polling, cache misses, sub-agent fan-out) and a tool-version and model-mix change on 14 October 2026. It is not a real team. `truth.json` records what was planted and the checks compare what desk. finds with it. Every source in the repository is described in `data/README.md`; `input_examples/` and `output_examples/` hold a cleaned session and a cleaned decision trace.

## Where it goes

From a desk to a gate for every agent. The ledger reads three tools and the gate meters Claude Code through its hook and other tools through the gateway door; the next steps are breadth and a measured effect, and none of them is done:

- **More tools.** A tool whose usage is not in a readable local file cannot be read (Copilot CLI's store holds no token counts, checked), and the Anthropic route of the gateway door has not met the real API.
- **A measured trial of a policy on real tasks.** The Lab (graded tasks with hidden tests, an accounting proxy, a written protocol, and statistics for deciding whether an experiment is worth running) is built. Its feasibility spike has not finished, so no effect of any policy has been measured (`docs/lab/00-spike-protocol.md`).
- **A better range.** A one-month range that holds as often as it says.
- **Open formats.** The ledger and the dossier as a published standard that other desks can write.

## What is not built, and what is not verified

- Every numbered feature in `docs/design/desk/07-feature-status.md` is built except DF-121, a log of real Cursor use, which stays empty rather than be made up (Cursor use is no longer asked for). Each feature's limits are in `docs/verification/`. Things that are built but have not met the real thing: the Responses route of the gateway (a fake upstream; NVIDIA serves no such route), the Cursor and Gemini CLI hooks, a judge panel (it needs your own labels), the opt-in index (no receiving end exists), and a swap whose baseline reproduces its recorded passes.
- The benchmark is one model, one constructed ledger and one question author, who also built the Desk's tools. Set B is no longer held out for the Desk after the fix described above. The model is not deterministic: a replay shows what was recorded, not what it would say again. The Desk is still wrong on about a tenth of questions, mostly multi-step shares and sums.
- The wind tunnel's range and probability are less reliable than their labels (see the Evidence screen). Learning from mistakes retrieves earlier plans by wording, so it cannot help a question of a new shape.
- The gate stops Claude Code with the hook installed (`docs/verification/gate-enforcement.md`) and any tool that is pointed at the gateway door (`docs/verification/gateway-2026-10-24.md`). A tool that does neither, a hook removed, or a clock set forward is not stopped; the bypass table says which each one is.
- How a plan's limit maps to tokens is NOT VERIFIED, so every dollar is an estimate. The canary's false-alarm rate and power are measured on simulated data (`docs/verification/canary-simulation.md`); its smallest detectable change on the recorded design is about 21 points.
- Claude Code's status line (plan limits) has not been run against a real session; the reader is tested on constructed input. OpenCode is read for version 1.17.13 only. Which Sonnet 5.5 cache-read price is in force is NOT VERIFIED. Zetaris features beyond SQL (semantic layer, data steward) are NOT VERIFIED. macOS is NOT VERIFIED. Nemotron latency through the free API is variable and some calls fail; the code retries, falls back and says so.
- A visual review of every screen in light and dark, desktop and mobile is recorded in `docs/verification/ui-sweep.md`, with what was fixed and what was left.

## Provenance

The design documents under `docs/`, the sponsor notes and the two guard scripts were written before 22 October 2026. No application code was: a small runtime helper from 13 October was replaced on 23 October by code written in the window, with its own tests. Everything else was written on or after 22 October, and the git history starts after the window opened (`docs/submission/pre-existing-components.md`). Code and prose were written with AI assistants (`docs/sponsors/ai-use-provenance-log.md`). Meterless's reference engines and suites are used under Apache-2.0 (`vendor/meterless/NOTICE.md`); LiteLLM's MIT price file is a dated snapshot (`data/prices/`); fonts are Outfit and JetBrains Mono under the SIL OFL.

## More

[docs/submission/everything-asked-and-how-it-was-done.md](docs/submission/everything-asked-and-how-it-was-done.md) every ask of the hackathon, what was done about it, and how it works behind the scenes · [docs/the-agents.md](docs/the-agents.md) the agents and the Track 3 mapping · [docs/evidence.md](docs/evidence.md) the evidence in full, one real trace, and the organizers' red flags · [docs/reference.md](docs/reference.md) stack, run time and live mode · `docs/design/desk/` the architecture, register, feature list and requirements · `docs/verification/` what was run against the real thing · `docs/sponsors/` verified facts per sponsor · `docs/submission/` the deck (`desk-deck.pdf`), the demo video script, and the sponsor explanation · `scripts/demo-video-motion/` the Remotion project that renders the captioned motion video, with every figure read from a real run or a result file.

Licence: Apache-2.0. No secret is ever written to the repository; `python scripts/secret_scan.py` runs before every commit.
