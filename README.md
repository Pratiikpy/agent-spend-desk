# desk.

**Every dollar your agents spend, tied to work that landed.**

desk. is a local desk for the person who pays for AI coding agents. It explains why a limit was hit, checks every day whether the agent got worse, tests a spend policy on a month it never saw, and signs what it concludes so that a stranger can verify it offline. No account, no upload: it reads your agent logs on your machine.

Built for the Open Agent Hackathon 2026, Track 3 (Reasoning Architecture), with Zetaris, Meterless and NVIDIA Nemotron.

> We are building an agent that helps **an engineering lead who pays for coding agents** decide **next month's caps and routes** by **tying every dollar to the work that landed and testing a policy on a month it never saw**, using **the agents' own session logs, git history, and three Zetaris-joined sources (invoices, CI, a seat roster)**, producing **a limit autopsy, a daily regression verdict, and a signed, replay-tested spend policy a stranger can verify offline**.

| | | |
|---|---|---|
| ![The morning brief](docs/submission/deck/img/brief.png) | ![The canary calling a regression](docs/submission/deck/img/canary-top.png) | ![An answer checked by code](docs/submission/deck/img/ask.png) |
| The brief | The canary: a regression called, control arm flat | Ask: every figure comes from a typed step |

## Try it

Needs Node 22.19 or later. Nothing else for the sample.

```
git clone <this repository> && cd <folder>
npm install
npm run desk -- --sample      # the limit autopsy card, on a constructed sample, offline (about 20 seconds)
npm run desk -- demo          # the whole demo in eight beats, offline (under a minute)
npm run desk -- ui --sample   # twelve screens on a local, read-only server
npm run desk -- prove         # every check, each PASS, FAIL or NOT RUN
npm test                      # the unit and integration tests
```

**On your own logs:** `npm run desk` reads `~/.claude/projects` read-only and prints your own limit autopsy in under three minutes: where your last heavy window went, which fix is worth making, and what the Desk could not know. Add `--repo <path>` to tie sessions to commits. Nothing is written outside `data/desk/`.

Verified from a fresh clone of the final commit: Windows 11 on Node 24.20, with the card (same figures hash), `desk prove` (26 PASS, 0 FAIL, 0 NOT RUN) and 468 tests. An earlier commit was also cloned and run on Windows with Node 22.19 and on Ubuntu 22.04 (WSL) with Node 22.23; those were not repeated at the final commit, so they are NOT VERIFIED there. macOS is NOT VERIFIED. On PowerShell, `$env:SAMPLE_MODE="true"` does the same as `--sample`.

## The problem

An engineering lead pays for a team's coding agents, on seats and on tokens. The bill is a number and the limit is a message; nothing says what the money bought. The decision is next month's caps and routes, and today it is made without evidence. desk. ties each dollar to the work that landed (a commit, a merge, a revert), shows which cause ate the limit, and tests a policy before it is applied.

The pain is public. These are quotes from the sources we read on 2026-10-20 (each URL was fetched then and not re-opened since; the full table is `docs/design/desk/04-evidence-table.md`):

- "Did not use Claude Code for three days. Never hit usage limits in the last three months. Now hitting usage limits after 2 hours of continous usage." ([claude-code #16157](https://github.com/anthropics/claude-code/issues/16157))
- "my ChatGPT Plus Codex budget drains in 2–3 prompts on `gpt-5.5`, where the same model/plan/app previously gave 20+ prompts." ([codex #28879](https://github.com/openai/codex/issues/28879))
- "The dashboard has a multi-day reporting lag, so I had no idea anything was wrong until the limit email landed." (a user who [burned $6,000 of usage](https://www.reddit.com/r/ClaudeAI/comments/1t11mmy/i_accidentally_burned_6000_of_claude_usage/))
- "My session silently routed to a different model path." ([r/cursor](https://www.reddit.com/r/cursor/comments/1t2gjtl/cursor_silently_switched_models_while_i_was_deep/))
- "Every assigned seat bills at list whether or not the user opens Copilot." ([Redress Compliance](https://redresscompliance.com/microsoft-copilot-adoption-2026))

The first three are why the autopsy exists, the fourth is why the canary runs every day, the fifth is why seats are tied to landed work.

## How it answers Track 3

The track asks for "a novel ability to turn data, knowledge, memory, and reasoning into reliable decisions and actions." Here each of the five has a place and a test:

| | In desk. | Where |
|---|---|---|
| Data | Agent logs into a SQLite ledger; invoices, CI and roster through one Zetaris statement | `src/desk/ledger/`, `src/sponsors/zetaris/` |
| Knowledge | A price book, a policy language with a restrict-only check, owner definitions of "landed" | `src/desk/policy/`, `src/desk/pricing/` |
| Memory | Meterless H-MEM holds the owner's definitions and past decisions; the World Model holds what changed when | `src/engines/` |
| Reasoning | A typed program the Planner writes and code runs; an Auditor that rejects unsupported figures; a Drafter, an Attacker and a held-out replay for policy | `src/desk/ask/`, `src/desk/agents/` |
| Decisions and actions | A signed dossier, an approval echo, and a gate Claude Code calls before each tool use | `src/desk/dossier/`, `src/desk/gate/` |

## The agents

| Agent | Role | Reads | Writes | Works with |
|---|---|---|---|---|
| Risk Router | A code classifier: is this a read of the ledger, or an action or policy change phrased as a question; flags text that tries to redirect the Planner | The question | A route (`read`, `spend_action`, `policy_change`) and flags | Planner |
| Planner | Turns the question into a typed program; may call `cannot_answer` | The question, the program schema | A program (spend, share, per-day, top sessions, landing, changes before, ...) | Plan critic, specialists |
| Plan critic | Checks the program against what the question needs (a share needs a numerator and a denominator) and sends the Planner back | The question, the program | A one-line objection or a pass | Planner |
| Specialists | Run each step read-only; code does every sum and percentage | Ledger, Zetaris facts, Meterless engines | Claims with their rows | Auditor |
| Auditor | Rejects any sentence whose figure no claim supports | The draft answer, the claims | Accept, or the sentences to fix | Explainer |
| Explainer | Writes the answer from claims; never sees the question, only what the program is about | Claims, a topic | The answer | Auditor |
| Drafter | Drafts a spend policy from the training month | Waste findings | A policy | Restrict check, Attacker |
| Attacker | Looks for requests that step around the policy | The policy | Counter-examples | Hardener |
| Canary | Runs a 52-task pack daily on two arms | The task pack | A verdict, an interval, the control arm | Gate, dossier |

The organizers' collaboration checklist asks for three of nine; desk. has all nine, each with a place to look:

| Item | Where |
|---|---|
| Planner delegates subtasks | The Planner's program steps are run by separate specialists (`src/desk/ask/specialists.ts`) |
| Specialist uses data or tools | Ledger queries, the Zetaris statement, Meterless engines |
| Evaluator critiques the output | The Auditor on every answer; the plan critic on every plan |
| Agent revises after critique | The Explainer revises at most twice; the Planner revises once after the plan critic; the Drafter after a failed check (`revision.applied` in the trace) |
| Risk agent flags unsupported claims | The Risk Router flags an action phrased as a question before anything runs; the Auditor flags unsupported figures after |
| Structured messages to shared memory | A claim ledger per run; H-MEM across runs |
| Branches on confidence | A plan the critic rejects goes back; a range with too few clusters is not called; a question the ledger cannot hold is declined |
| Fallback if data or an API fails | Every language role has a rule-based fallback; Zetaris and Nemotron fall back to recordings, then to the rule brain, and the trace says which |
| Final answer has traceable evidence | Each figure carries its claim and its rows; the trace says why each decision was made |

A human stays in the loop where it matters: the gate turns an `ask` into an allow only on the owner's approval, echoed back with its request id and action digest, it never overrides a deny, and it fails closed.

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
| Can it stop a runaway? | A local gate that Claude Code calls before each tool use; it fails closed | `desk gate serve` |
| Would a cheaper model have done the same work? | The recorded tasks replayed on two routes, with a screen for which kinds of task held up on both halves | `desk route` |
| Which seats earn their price? | Seats a team holds beyond the people who landed work, from the Zetaris roster | `desk seats` |
| Does its stated confidence mean what it says? | Link confidence against planted truth, the wind tunnel's range and probability against what happened | `desk calibrate` |
| Was the Desk's own judgement right? | What it expected of each option when it proposed, scored on the month that followed, with regret | `desk regret` |
| Does it learn from its mistakes? | Wrong answers become lessons; held-out error is measured per round and a worse round is reverted | `desk lessons learn` |

## The evidence

- **A regression, called.** The canary runs a 52-task pack once a day on two arms for 30 assigned days. The primary arm's model is switched on day 15, on purpose. The statistic calls it: **-40.0 points, 99% interval -56.2 to -23.8, control arm flat**. A first recording on 16 tasks measured a 35 point drop and correctly refused to call it (four clusters cannot support a call), so the pack was grown and re-recorded. Both are in the repository: `docs/verification/canary-first-run/`.
- **A head-to-head, published as it came out.** Same Nemotron model, three arms: one call with a summary, a tool-using agent, and the Desk. On the first 60 questions the Desk was 51 exact against the agent's 47 and one call's 12. On a second set of 60 it had never seen, preregistered before it ran: **49 against 41 and 12**, and 77% against 63% when each question is asked three more times at temperature 0.7 (pass^3). Eight questions in sixty is at the edge of what that sample can show, and the Desk was level with the agent on the 7 questions from templates its tools were not built around (2 each). A defect found by reading that set (a refused plan was handed to the rule planner without telling the Planner why) was then fixed; after the fix the Desk is at 54 of 60 and 85% pass^3, reported as post hoc, beside the first figures and never in place of them. Its first run on the first set was 20 of 40 against the agent's 31. Everything is in `docs/verification/benchmark/` (`RESULTS-v2.md` has the written predictions, several of which failed or held only barely), and `desk prove` replays all 900 recorded runs from the recordings.
- **Held-out replay.** A policy drafted from September meets October, a month it never saw. The headline is the landed work it would have blocked (5 of 333 sessions), not the savings.
- **A verifier a stranger can run.** A signed dossier carries the rows its figures come from; `desk-verify` recomputes them on plain Node with the network off. Change one byte and it names the row.
- **A fuzzed checker.** The restrict-only check (does an edit only narrow a policy?) agrees with an independent oracle on 3,000 random policy pairs, and a checker that always says "narrows" is caught.
- **Its own confidence, measured.** Link confidence is checked against planted truth with Wilson intervals (high 99.2%, medium 98.6%, ordered as named). The wind tunnel's "90%" one-month range held the realized month in **73%** of 48 constructed samples with a regime change planted and **77%** with none (interval 63% to 87%), and its chance of blocking landed work had an expected calibration error of 0.29. Both are stated beside the range on screen: read it as a screen, not a promise.
- **It keeps a record of its own judgement.** When a policy is proposed, the expected range for each option is written down; after the month that followed, each option is replayed and scored, with regret. On the sample, the proposed policy's month fell inside its range and blocked the same 5 landed sessions the held-out replay named.
- **It learns from its mistakes, and says how much.** Nine wrong answers on 120 training questions gave six verified plans; the six lessons moved two held-out questions from wrong to right and none the other way (54 to 56 of 60, 95% interval -8.3 to 0.0 points), so no improvement is claimed. Nothing changed on the 7 new-template questions. A first run of this experiment measured the model's run-to-run noise rather than the lessons; both runs and the correction are in `docs/verification/learning/` and the preregistration.
- **`desk prove`:** 26 PASS, 0 FAIL, 0 NOT RUN on a fresh clone. NOT RUN names a check the spec asks for that is not built or not recorded; it is never counted as a pass.

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
- **Verification is code.** Budgets (wall clock, model calls, tool calls, turns) are enforced in code. Every language role has a rule-based fallback and the trace says when it was used. Every run writes a JSONL trace with the reason for each decision.
- **Honest classes.** Every dollar is `billed`, `reported`, `estimated` or `unpriced`. Dollar figures are list-price estimates from logged tokens and say so. A cause is a part of the cost, not a verdict.
- **Reproducible.** Offline runs replay recorded model and Zetaris replies; a request with no recording is an error, never a guess.

Code map: `src/desk/` (ledger, ingest, autopsy, outcomes, policy, replay, agents, ask, engines, silo, canary, bench, gate, dossier, verify, card, ui, propose, prove), `src/sponsors/zetaris/` (the Zetaris port), `src/engines/` (Meterless engines), `vendor/meterless/` (their conformance suites, unchanged), `infra/silos/` (three synthetic silos), `policies/`, `tests/`.

## Stack and dependencies

| Layer | What | Why |
|---|---|---|
| Language and runtime | TypeScript on Node 22.19 or later; `node:sqlite` for the ledger | One runtime, no database server, nothing to install beyond `npm install` |
| Runtime dependencies | `yaml` (policy files), `@resvg/resvg-js` (renders the SVG charts to PNG) | These are the only two packages the product needs at run time |
| Development | `tsx`, `typescript`, `vitest`, `@types/node` | Tests and the type check |
| Model | NVIDIA Nemotron through an OpenAI-compatible API (`src/desk/agents/model.ts`) | The Power rule; tool calling verified |
| Organisational data | Zetaris, a local instance in Docker, three synthetic silos | One statement over an S3-style file, Postgres and REST |
| Memory and reasoning engines | Meterless World Model, H-MEM, Markovian, with their own conformance suites in `vendor/meterless/` | Run from our code; conformance 8/8, 13/13, 8/8 |
| Signing | Ed25519 from `node:crypto`; the verifier is a single file on plain Node | A stranger can check a dossier with the network off |
| Editor | Cursor is the required IDE; see the sponsor table for what the log does and does not show | |

No GPU, no training, no package installed at run time, no download at run time. Model replies and Zetaris answers are recorded, so the sample needs no key and no network.

## How long a run takes

| | Bound | Measured |
|---|---|---|
| The card on the sample | Wall clock, model calls and tool calls are budgets enforced in code | About 20 seconds, offline |
| The whole demo | The same | Under a minute, offline |
| One live `desk ask` | At most one plan, one revision, and two explainer revisions | Two model calls on the questions in the benchmark; the NVIDIA free API took from about 8 to 80 seconds per run on 2026-10-23 |

The organizers' target is 5 to 10 minutes for a full agent run; every path here is inside it, and none runs without a bound.

## Against the organizers' red flags

| Red flag in the Approach Guide | Here |
|---|---|
| A private API key you do not have | None needed for the sample; live mode is optional |
| A dataset you cannot access quickly | The sample is generated from a seed on your machine |
| Raw data of many GB with no sample strategy | The 590 MB sample is generated, not shipped; what is shipped is described in `data/README.md` |
| GPU training | None |
| Agents run once in a fixed sequence | Plans that fail a check are revised; the path depends on the question and on what the critic finds (see the trace below) |
| Zetaris or Meterless with no real role | Each has a call site and a switch-off test that changes the output |
| Cannot explain the value | The problem sentence at the top |
| Output mostly generic text | Every figure is computed by code from the ledger and carries its rows |
| Cannot run without internet; fails if an API is down | The sample runs offline; every language role has a rule-based fallback |
| Demo needs manual steps not in the README | `npm run desk -- demo` is the whole demo |
| No sample inputs and outputs | `input_examples/`, `output_examples/`, `data/sample/` |
| Cannot show how the agent reached its output | A JSONL trace per run; a cleaned sample is below |

## One real trace

From `output_examples/traces/propose-sample.jsonl`, the Drafter proposing a policy. The first draft is checked on the training month, the check finds it would pause 81 of 311 sessions whose work landed, the Drafter revises, and the second draft passes:

```
{"seq":3,"event":"desk.policy.check","role":"policy_drafter","detail":{"attempt":1,"narrows":true,"landedBlocked":81,"landedTotal":311,"pausedSessions":138}}
{"seq":4,"event":"revision.applied","role":"policy_drafter","detail":{"attempt":1,"because":"on the training window it would pause 81 of 311 sessions whose work landed; raise the threshold so they are not paused"}}
{"seq":6,"event":"desk.policy.check","role":"policy_drafter","detail":{"attempt":2,"narrows":true,"landedBlocked":0,"landedTotal":311,"pausedSessions":0}}
```

## Sponsor technology

Each claim has a call site, a trace line and a test that switches the component off. Full text: `docs/submission/sponsor-technology-explanation.md`.

| | Where | What changes when it is off |
|---|---|---|
| **Zetaris** | `src/sponsors/zetaris/`: one statement joins an S3-style invoice file, a Postgres CI database and a REST roster | The bill falls from billed (invoice amounts, 100% of the ledger) to estimated only; landing loses CI facts (584 landed sessions on green checks, 60 on red); the spend-per-landed-PR table disappears. A real container kill was run |
| **Meterless** | `src/engines/` (World Model, H-MEM, Markovian), conformance 8/8, 13/13, 8/8 from Meterless's own runners | `desk ask --ablate world_model` turns "what changed before 15 October" into "unknowable"; an owner's definition in H-MEM changes what counts as landed; Markovian bounds a long range |
| **NVIDIA Nemotron** | `src/desk/agents/model.ts`, NVIDIA's OpenAI-compatible API, tool calling verified; roles: Drafter, Attacker, Planner, Explainer, the canary, all three benchmark arms | Recorded replies replay the same answers offline; without them the rule brain answers and the trace says so |
| **Cursor** | The required IDE; editor rules in `.cursor/rules/` | `docs/sponsors/cursor-usage-log.md` records what was done in it, and claims nothing beyond that |

## Live mode (optional)

Copy `.env.example` to `.env` and fill in what you have; nothing is required for the sample. `desk propose --record`, `desk ask --record` and `desk bench run --record` call Nemotron and record the replies; `desk silos --record` records Zetaris answers; `desk canary run` runs the day's pack on the model in `.env`. Zetaris runs locally in Docker (install steps and every verified fact: `docs/sponsors/zetaris-local-setup.md`); `infra/silos/` starts the three synthetic silos and loads them from the sample. The gate, the hook and the signing key are described in `docs/verification/gate-enforcement.md`.

## The sample

`--sample` generates a constructed scenario from a seed (about 590 MB under `data/desk/`): 14 engineers, 987 sessions over two months as real-format Claude Code logs and real git repositories, with waste planted at known places (loops, idle polling, cache misses, sub-agent fan-out) and a tool-version and model-mix change on 14 October 2026. It is not a real team. `truth.json` records what was planted and the checks compare what desk. finds with it. Every source in the repository is described in `data/README.md`; `input_examples/` and `output_examples/` hold a cleaned session and a cleaned decision trace.

## What is not built, and what is not verified

- Not built: team mode (roles, per-team caps, more than one approver) and a CI check on policy changes; they are listed under "next" in the deck. Seat return, route replay, calibration, repeated-run reliability, the regret ledger and learning from mistakes are built, and their limits are in `docs/verification/`.
- The benchmark is one model, one constructed ledger and one question author, who also built the Desk's tools. Set B is no longer held out for the Desk after the fix described above. The model is not deterministic: a replay shows what was recorded, not what it would say again. The Desk is still wrong on about a tenth of questions, mostly multi-step shares and sums.
- The wind tunnel's range and probability are less reliable than their labels (see the Evidence screen). Learning from mistakes retrieves earlier plans by wording, so it cannot help a question of a new shape.
- The gate stops Claude Code with the hook installed (`docs/verification/gate-enforcement.md`); a tool with no hook, or a hook removed, is not stopped.
- How a plan's limit maps to tokens is NOT VERIFIED, so every dollar is an estimate. The canary's false-alarm rate and power are measured on simulated data (`docs/verification/canary-simulation.md`); its smallest detectable change on the recorded design is about 21 points.
- Zetaris features beyond SQL (semantic layer, data steward) are NOT VERIFIED. macOS is NOT VERIFIED. Nemotron latency through the free API is variable and some calls fail; the code retries, falls back and says so.
- A visual review of every screen in light and dark, desktop and mobile is recorded in `docs/verification/ui-sweep.md`, with what was fixed and what was left.

## Provenance

The design documents under `docs/`, the sponsor notes and the two guard scripts were written before 22 October 2026. No application code was: a small runtime helper from 13 October was replaced on 23 October by code written in the window, with its own tests. Everything else was written on or after 22 October, and the git history starts after the window opened (`docs/submission/pre-existing-components.md`). Code and prose were written with AI assistants (`docs/sponsors/ai-use-provenance-log.md`). Meterless's reference engines and suites are used under Apache-2.0 (`vendor/meterless/NOTICE.md`); LiteLLM's MIT price file is a dated snapshot (`data/prices/`); fonts are Outfit and JetBrains Mono under the SIL OFL.

## More

`docs/design/desk/` the architecture, register, feature list and requirements · `docs/verification/` what was run against the real thing · `docs/sponsors/` verified facts per sponsor · `docs/submission/` the deck (`desk-deck.pdf`), the demo video script, and the sponsor explanation · `scripts/demo-video/` the recorder that made the captioned demo video from real runs.

Licence: Apache-2.0. No secret is ever written to the repository; `python scripts/secret_scan.py` runs before every commit.
