# Pre-existing components declaration

For the submission form and the README. It lists everything that existed before the window opened (22 Oct 2026 00:00 UTC), and everything that is third-party. It was checked against the repository on 2026-10-23.

## Repository

The git history starts on 2026-10-22 at 15:06 UTC (the first commit is `e994d41`, "Add the Desk ledger..."), after the window opened. Nothing was committed or pushed earlier. Work that was written before the window was kept out of git until then and is listed here.

## Written before the window

| Item | Where | What it is | Written |
|---|---|---|---|
| Design documents | `docs/design/`, `docs/plan/`, `docs/DECISIONS.md`, `docs/00-INDEX.md` | The architecture, module blueprints, research profiles of open-source repositories, and the decision log. The Desk's own specification (`docs/design/desk/`) was written 2026-10-20 to 2026-10-22 | 2026-10-13 to 2026-10-22 |
| Sponsor notes and templates | `docs/sponsors/`, `docs/submission/*.template.md`, `docs/templates/` | Notes on Zetaris, Meterless, NVIDIA and Cursor and the submission templates | 2026-10-13 to 2026-10-16 |
| Guard scripts and assistant configuration | `scripts/secret_scan.py`, `scripts/repo_size_check.py`, `.cursor/` | Secret scan, repository size check, rules for the editor | 2026-10-13 to 2026-10-16 |

No application code survives from before the window. A small runtime starter (canonical JSON, errors, a schema helper, 505 lines, written 2026-10-13) was replaced on 2026-10-23 by code written inside the window with the same behaviour and its own tests (`tests/runtime/`); the old files are not in the tree. There were no data sets and no trained models.

## Written in the window (2026-10-22 onward)

Everything else: `src/runtime/` (rewritten 2026-10-23), `src/desk/` (ledger, log reader, price book, autopsy, landing, policy language and replay, agents, Ask, engine adapters, Zetaris silo port, gate, dossiers and the offline verifier, canary, card, UI, propose, prove, demo), `src/sponsors/zetaris/`, `tests/`, `infra/silos/`, `policies/`, `scripts/` other than the two guard scripts, the sample generator, the recorded replies in `data/sample/`, `input_examples/`, `output_examples/`, the README, the deck and the video script. Prose and code were written with AI assistants and are logged in `docs/sponsors/ai-use-provenance-log.md`.

## Third-party

| Item | Where | Licence |
|---|---|---|
| Meterless reference engines (World Model, H-MEM, Markovian) and their conformance suites | `src/engines/`, `vendor/meterless/` (`NOTICE.md`) | Apache-2.0 |
| LiteLLM price file, a dated snapshot of first-party Anthropic prices | `data/prices/` | MIT |
| Outfit and JetBrains Mono fonts | `assets/fonts/` | SIL Open Font License 1.1 (licence texts beside the files) |
| npm packages: `yaml`, `@resvg/resvg-js`, and for development `tsx`, `typescript`, `vitest`, `@types/node` | `package.json` | Each under its own licence, installed by `npm install` |
| Models and services: NVIDIA Nemotron through NVIDIA's API, Zetaris (run locally in Docker) | not in the repository | Used under each provider's terms |

## Open

The organisers' written answer on whether preparation before the window is eligible was not received. What remains from before the window is documentation (design documents, sponsor notes, templates) and two guard scripts; no application code does. Nothing in `src/` depends on the design documents.
