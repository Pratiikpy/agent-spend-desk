# Sponsor technology explanation: desk.

Every sentence here can be checked in the repository, in a trace line, or by running `npm run desk -- prove` and `npm run desk -- demo`. Where a fact is not verified, it says so.

## Zetaris

- **What we used it for:** the organisational sources of an agent bill. Three synthetic silos of three kinds sit behind one local Zetaris instance: provider invoices as CSV files in an S3-compatible bucket, CI and pull requests in a Postgres database, and a team roster behind a REST endpoint. One statement joins them: spend per landed pull request by team, with seats. The same sources give the bill its `billed` class (invoice amounts against the ledger's list-price estimate) and give landing its CI fact (merged on green checks, or merged although checks were red).
- **Where in the code:** `src/sponsors/zetaris/silo-port.ts` (the port: live, recorded, or labelled fallback), `src/sponsors/zetaris/queries.ts` (the four statements), `src/desk/silo/` (parsing, reconciliation, seeding), `infra/silos/` (the three silos).
- **What changed in the output because of it:** with Zetaris, `desk silos` shows billed $6,123.23 covering the whole ledger (the invoice 1.2% below the list-price estimate), a three-team table of spend per landed pull request ($8.57 to $10.05), and CI facts for 644 landed sessions: 584 merged on green, 60 on red. Without it, nothing is billed, every dollar is an estimate, landing stops at what git shows, and the table is gone. `desk prove` checks this difference (`zetaris-role-changes-the-output`).
- **Fallback when unavailable:** the port returns a labelled fallback, never an exception and never partial rows. A real drill on 2026-10-22 stopped the Zetaris API container: `desk silos` answered in 3 seconds with all four silos `fallback` and the output above changed. In sample mode the four answers are replayed byte for byte from recordings of a live run.
- **Evidence:** trace line `desk.ingest {port:"silo", op:"zetaris.sql", servedFrom:"live"|"cassette"|"fallback", reqHash, respHash, rows}` on every statement; `docs/sponsors/zetaris-local-setup.md` records what was verified live, including the option names that register an S3-style file source (found in Zetaris's own metastore, then confirmed by registering a second table) and a join that overstated billed spend three-fold until each silo was aggregated first.
- **Not verified:** the Unified Semantic Layer, the AI data steward, JDBC from a SQL client.

## Meterless

- **What we used it for:** three of Meterless's open engines, run in our process (there is no Meterless API or key; the organisers confirmed this on 2026-10-17). The World Model holds the history of what shaped a bill: model ids, tool versions, plan settings, with the day each first appeared. H-MEM holds the owner's own definitions and corrections. Markovian bounds the reading of a long range of days.
- **Where in the code:** `src/engines/` (the engines), `src/desk/engines/` (the adapters), `src/desk/ask/` (the questions that use them), `vendor/meterless/` (Meterless's conformance suites, unchanged).
- **What it made possible:** "what changed before 15 October?" is answered from the World Model's event history: the tool version `vsample-2` first appeared on 14 October, and the model mix moved that week. A definition of "landed" stored in H-MEM changes the share of spend called landed (63% merged or kept; 67% once the owner says committed counts). Each engine's conformance count is read from a recorded run of Meterless's own runners: H-MEM 13/13, World Model 8/8, Markovian 8/8.
- **Fallback when unavailable:** the engines are code in this repository, so there is nothing to be unavailable; each can be switched off with `desk ask --ablate world_model|hmem|markovian`, and an answer then says so.
- **Evidence:** the trace line `desk.engine {engine, impl, conformance, ablated}` on every answer; `npm run desk -- prove` runs the question with each engine on and off and checks that the answer changes (`meterless-engines-change-answers`). While writing the test for H-MEM we found that the pattern that reads an owner's definition never matched, so the engine had no effect; it was fixed.
- **Not used:** Scout Intent (no conformance runner is published). The Risk Router that keeps an action phrased as a question from being answered as a read is our own code, and the README says so.

## Cursor

See `docs/sponsors/cursor-usage-log.md`. At the time of writing no Cursor session has been logged, and this explanation claims none.

## NVIDIA

- **Where NVIDIA technology contributes:** Nemotron, through NVIDIA's OpenAI-compatible API, is the model behind every language role: the policy Drafter and Attacker, the Ask planner (which calls a `plan_answer` tool whose argument is a typed program), the Explainer, and the canary's runs. The code is identical for any OpenAI-compatible endpoint; only a URL, a key and a model id change.
- **Where in the code:** `src/desk/agents/model.ts` (`ModelPort`: live, recorded, none).
- **Evidence:** the served model id comes back on every reply and is on the trace (`private/nvidia/nemotron-3.5-super-120b-a12b`); tool calling with a JSON-schema argument was exercised live on 2026-10-22; the recorded replies in `data/sample/cassettes/` came from live calls. The canary's real runs use three Nemotron models (120B, 30B, 550B) and read the served model id from the reply to see a switch.
- **Limits measured:** latency from 0.4 s to 56 s for the same small request, HTTP 500 on about one call in four under rapid use and HTTP 429 on some models under concurrency. The code retries, caps retries, times out, falls back to a rule brain, and says so on the trace.

## What is unique about our use

Three things a typical entry would not do, each with proof. The sponsor components change outputs a reviewer can see when they are switched off, and the repository checks that they do. The language roles are checked by code: a policy a model drafts is replayed on a month it was not drafted from, and the report leads with the 5 of 333 landed sessions it would have blocked rather than the savings. A result is not a claim: a dossier carries the rows its figures come from and a verifier that runs on plain Node recomputes them; change one byte and it names the row.

## Pre-existing components

`src/runtime/` (canonical JSON, errors and schema helpers, written 2026-10-13), the design documents under `docs/`, and the guard scripts. Meterless's reference engines and conformance suites (Apache-2.0, `vendor/meterless/NOTICE.md`) and a dated snapshot of LiteLLM's MIT price file (`data/prices/`) are third-party. Everything else was written on or after 22 October 2026.
