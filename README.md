# desk.

**Run `npm run desk` on your own agent logs.** In under three minutes, entirely on your machine, you get your own limit autopsy: where your last heavy window went, which fix is worth making, and what the Desk could not know. No key, no account, no upload.

No logs to hand? `npm run desk -- --sample` shows the same card on a constructed sample, offline.

desk. is an agent spend and worth desk. It is for the person who pays for AI coding agents and has to answer three questions: where did the money go, did it buy work that landed, and what should next month's caps and routes be, on what evidence. Built for the Open Agent Hackathon 2026, Track 3 (Reasoning Architecture).

## What it does

| You ask | The Desk answers with | Command |
|---|---|---|
| Where did my limit go? | The heaviest window, split by cause, with ranked fixes | `desk card` |
| What did the money buy? | Spend by landing state (kept, merged, committed, reverted, unlinked) | `desk landing`, the `Bill` screen |
| What do my invoices, CI and roster say? | One Zetaris statement over three sources; billed against estimated | `desk silos` |
| Did the agent get worse? | A canary verdict with its interval, its control arm and what it cannot say | `desk canary` |
| What should the caps be? | A drafted policy, checked, attacked, then replayed on a month it never saw | `desk propose --dossier` |
| Can I trust that? | A signed dossier a stranger verifies offline; one changed byte names the row | `desk approve`, `npm run desk-verify` |
| Why did it change? | An answer from typed, read-only steps the Auditor checks; engines switchable | `desk ask` |
| Can it stop a runaway? | A local gate Claude Code calls before each tool use; fails closed | `desk gate serve` |

Everything runs on screens too: `npm run desk -- ui` opens eleven screens (brief, bill, autopsy, sessions, outcomes, policy, canary, ask, org data, dossiers, doctor) on a local, read-only server.

## Run it

Needs Node 22.19 or later (the ledger is Node's built-in SQLite). Tested on Node 24.20; Node 22 is NOT VERIFIED. Nothing else for the sample.

```
git clone <this repository> && cd <folder>
npm install
npm run desk -- --sample          # the limit autopsy card, offline
npm run desk -- demo              # the whole demo, offline, about two minutes
npm run desk -- prove             # the checks below, each PASS, FAIL or NOT RUN
npm run desk -- ui --sample       # the screens
npm test                          # the unit and integration tests
```

On Windows PowerShell the same commands work; use `$env:SAMPLE_MODE="true"` instead of `--sample` if you prefer the variable.

Your own logs: `npm run desk` reads `~/.claude/projects` read-only. Add `--repo <path>` to tie sessions to commits. Nothing is written outside `data/desk/`.

### Live sponsors (optional)

With keys in `.env` (names in `.env.example`) the same commands run live. `desk propose --record` and `desk ask --record` call Nemotron and record the replies; `desk silos --record` records the Zetaris answers. Zetaris runs locally in Docker (install steps and every verified fact: `docs/sponsors/zetaris-local-setup.md`); the three synthetic silos start with `infra/silos/start-ci-silo.sh`, `start-roster-silo.sh` and `start-invoices-silo.sh`, and `desk silos seed` plus `infra/silos/load-sample-silos.sh` load them from the sample. `desk canary run` runs the day's pack on the model in `.env`.

### What the first run does

`--sample` generates a constructed scenario from a seed (about 590 MB under `data/desk/`, about 20 seconds): 14 engineers, 987 sessions over two months, as real-format Claude Code logs and real git repositories, with waste planted at known places (loops, idle polling, cache misses, sub-agent fan-out) and a tool-version and model-mix change planted on 14 October 2026. It is not a real team. `truth.json` records what was planted, and the checks compare what the Desk finds with it.

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

- **A real agent system, not a pipeline.** The Planner proposes a typed program; code validates and runs it read-only; the Auditor rejects any sentence whose figure no claim supports; the Explainer revises (at most twice) or the sentence is dropped. The Drafter proposes policy rules that must pass a restrict-only check and a replay; the Attacker looks for requests that step around the draft; the hardener closes what it can. Every language role has a rule-based fallback and the trace says when it was used. Budgets (wall clock, model calls, tool calls, turns) are enforced in code.
- **Verification is code, not prose.** The restrict-only check decides over every cell of the policy grid whether an edit only narrows; it is fuzzed against an independent oracle. A policy is judged on a month it was not drafted from. A dossier's figures are recomputed from the rows inside it.
- **Honest classes.** Every dollar is `billed`, `reported`, `estimated` or `unpriced`. Unlinked spend is "unknowable", never "waste". A cause is a part of the cost, not a verdict.

Code map: `src/desk/` (ledger, ingest, autopsy, outcomes, policy, replay, agents, ask, engines, silo, canary, gate, dossier, verify, card, ui, propose, prove), `src/sponsors/zetaris/` (the Zetaris port), `src/engines/` (Meterless engines), `vendor/meterless/` (their conformance suites, unchanged), `infra/silos/` (the three synthetic silos), `policies/`, `tests/`.

## Sponsor technology

Each claim below has a call site, a trace line and a test that switches the component off. Full text: `docs/submission/sponsor-technology-explanation.md`.

| | Where | What changes when it is off |
|---|---|---|
| **Zetaris** | `src/sponsors/zetaris/silo-port.ts`; one statement joins an S3-style invoice file, a Postgres CI database and a REST roster | The bill goes from billed (invoice amounts, 100% of the ledger) to estimated only; landing loses CI facts (584 landed sessions on green checks, 60 on red); the spend-per-landed-PR table disappears. Recorded for offline runs; a real container kill was run on 2026-10-22 |
| **Meterless** | `src/engines/` (World Model, H-MEM, Markovian), adapted in `src/desk/engines/`; conformance 13/13, 8/8, 8/8 from Meterless's own runners | `desk ask --ablate world_model` turns "what changed before 15 October" into "unknowable"; an owner definition stored in H-MEM changes what counts as landed; Markovian bounds a range read |
| **NVIDIA Nemotron** | `src/desk/agents/model.ts`, through NVIDIA's OpenAI-compatible API (tool calling verified); roles: drafter, attacker, planner, explainer, canary | Recorded replies in `data/sample/cassettes/` replay the same answers offline; without them the rule brain answers and the trace says so |
| **Cursor** | The required IDE | See `docs/sponsors/cursor-usage-log.md` |

## What is not built, and what is not verified

- Not built: route replay of recorded tasks on a cheaper model (DK7), the reasoning benchmark against baselines, repeated-run reliability, calibration, team mode and seat return. `desk prove` lists them as NOT RUN, never as PASS.
- The enforcement of the gate is proven for Claude Code with the hook installed (`docs/verification/gate-enforcement.md`). A tool with no hook, or a hook removed from settings, is not stopped.
- Dollar figures are list-price estimates from logged tokens. How a plan's limit maps to tokens is NOT VERIFIED.
- The sample is constructed. The canary series is real model runs on assigned dates, with a model switch made on purpose; the statistic's false-alarm rate and power are measured on simulated data (`docs/verification/canary-simulation.md`) and its smallest detectable change under those assumptions is large.
- Zetaris features beyond SQL (semantic layer, data steward) are NOT VERIFIED. Zetaris and Meterless "running on your machine" as an eligibility condition is unconfirmed by the organisers.
- Nemotron latency through the free API is variable and some calls fail; the code retries, falls back, and says so.

## Pre-existing components

Declared for the submission form: the runtime starter `src/runtime/` (canonical JSON, errors, schema helpers, 2026-10-13), the design documents under `docs/`, and the guard scripts. Everything else was written on or after 22 October 2026. Meterless's reference engines and conformance suites are used under Apache-2.0 (`vendor/meterless/NOTICE.md`); LiteLLM's MIT price file is a dated snapshot (`data/prices/`).

## Layout

`docs/design/desk/` the architecture, register, feature list and PRD · `docs/verification/` what was run against the real thing · `docs/sponsors/` verified facts per sponsor · `docs/submission/` the video script, deck, and the sponsor explanation · `output_examples/` a cleaned run trace.

Licence: Apache-2.0. Security: no secret is ever written to the repository; `python scripts/secret_scan.py` runs before every commit.
