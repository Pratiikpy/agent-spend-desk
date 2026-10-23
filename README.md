# desk.

**Every dollar your agents spend, tied to work that landed.**

desk. is a local desk for the person who pays for AI coding agents. It explains why a limit was hit, checks every day whether the agent got worse, tests a spend policy on a month it never saw, and signs what it concludes so that a stranger can verify it offline. No account, no upload: it reads your agent logs on your machine.

Built for the Open Agent Hackathon 2026, Track 3 (Reasoning Architecture), with Zetaris, Meterless and NVIDIA Nemotron.

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
npm run desk -- ui --sample   # eleven screens on a local, read-only server
npm run desk -- prove         # every check, each PASS, FAIL or NOT RUN
npm test                      # the unit and integration tests
```

**On your own logs:** `npm run desk` reads `~/.claude/projects` read-only and prints your own limit autopsy in under three minutes: where your last heavy window went, which fix is worth making, and what the Desk could not know. Add `--repo <path>` to tie sessions to commits. Nothing is written outside `data/desk/`.

Verified from a fresh clone: Windows 11 on Node 22.19 and 24.20, and Ubuntu 22.04 (WSL) on Node 22.23, each with the card, the demo and the 407 tests. macOS is NOT VERIFIED. On PowerShell, `$env:SAMPLE_MODE="true"` does the same as `--sample`.

## The problem

An engineering lead pays for a team's coding agents, on seats and on tokens. The bill is a number and the limit is a message; nothing says what the money bought. The decision is next month's caps and routes, and today it is made without evidence. desk. ties each dollar to the work that landed (a commit, a merge, a revert), shows which cause ate the limit, and tests a policy before it is applied.

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

## The evidence

- **A regression, called.** The canary runs a 52-task pack once a day on two arms for 30 assigned days. The primary arm's model is switched on day 15, on purpose. The statistic calls it: **-40.0 points, 99% interval -56.2 to -23.8, control arm flat**. A first recording on 16 tasks measured a 35 point drop and correctly refused to call it (four clusters cannot support a call), so the pack was grown and re-recorded. Both are in the repository: `docs/verification/canary-first-run/`.
- **A head-to-head, published as it came out.** Same Nemotron model, 60 questions computed from the ledger, three arms: one call with a summary, a tool-using agent, and the Desk. Exact answers: **12, 47 and 51 of 60**; on the 20 held-out questions, run once at the end, **4, 15 and 16**. That is far better than one call and level with a tool agent, not better: four questions in sixty is noise. The Desk's first run was 20 of 40 against the agent's 31; what changed it, and its nine remaining misses (one a hidden instruction it followed), are in `docs/verification/benchmark/`. `desk prove` replays all 180 recorded runs from the recorded replies.
- **Held-out replay.** A policy drafted from September meets October, a month it never saw. The headline is the landed work it would have blocked (5 of 333 sessions), not the savings.
- **A verifier a stranger can run.** A signed dossier carries the rows its figures come from; `desk-verify` recomputes them on plain Node with the network off. Change one byte and it names the row.
- **A fuzzed checker.** The restrict-only check (does an edit only narrow a policy?) agrees with an independent oracle on 3,000 random policy pairs, and a checker that always says "narrows" is caught.
- **`desk prove`:** 17 PASS, 0 FAIL, 4 NOT RUN on a fresh clone. NOT RUN names what the spec asks for and is not built; it is never counted as a pass.

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

- Not built: route replay of recorded tasks on a cheaper model, repeated-run reliability (pass^k), calibration, team mode and seat return. `desk prove` lists them as NOT RUN.
- The benchmark is one run of each question and arm on one model and one constructed ledger; the desk's tools were built around the lookup and numeric templates.
- The gate stops Claude Code with the hook installed (`docs/verification/gate-enforcement.md`); a tool with no hook, or a hook removed, is not stopped.
- How a plan's limit maps to tokens is NOT VERIFIED, so every dollar is an estimate. The canary's false-alarm rate and power are measured on simulated data (`docs/verification/canary-simulation.md`); its smallest detectable change on the recorded design is about 21 points.
- Zetaris features beyond SQL (semantic layer, data steward) are NOT VERIFIED. macOS is NOT VERIFIED. Nemotron latency through the free API is variable and some calls fail; the code retries, falls back and says so.
- A visual review of every screen in light and dark, desktop and mobile is recorded in `docs/verification/ui-sweep.md`, with what was fixed and what was left.

## Provenance

The runtime starter `src/runtime/`, the design documents under `docs/` and the guard scripts were written before 22 October 2026; everything else was written on or after it, and the git history starts after the window opened (`docs/submission/pre-existing-components.md`). Code and prose were written with AI assistants (`docs/sponsors/ai-use-provenance-log.md`). Meterless's reference engines and suites are used under Apache-2.0 (`vendor/meterless/NOTICE.md`); LiteLLM's MIT price file is a dated snapshot (`data/prices/`); fonts are Outfit and JetBrains Mono under the SIL OFL.

## More

`docs/design/desk/` the architecture, register, feature list and requirements · `docs/verification/` what was run against the real thing · `docs/sponsors/` verified facts per sponsor · `docs/submission/` the deck (`desk-deck.pdf`), the demo video script, and the sponsor explanation · `scripts/demo-video/` the recorder that made the captioned demo video from real runs.

Licence: Apache-2.0. No secret is ever written to the repository; `python scripts/secret_scan.py` runs before every commit.
