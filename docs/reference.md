# Stack, run time and live mode

Reference material moved out of the README so that it stays short.

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
| Editor | Claude Code; Cursor became optional on 22 October 2026 and was not used (see the sponsor table) | |

No GPU, no training, no package installed at run time, no download at run time. Model replies and Zetaris answers are recorded, so the sample needs no key and no network.

## How long a run takes

| | Bound | Measured |
|---|---|---|
| The card on the sample | Wall clock, model calls and tool calls are budgets enforced in code | About 20 seconds, offline |
| The whole demo | The same | Under a minute, offline |
| One live `desk ask` | At most one plan, one revision, and two explainer revisions | Two model calls on the questions in the benchmark; the NVIDIA free API took from about 8 to 80 seconds per run on 2026-10-23 |

The organizers' target is 5 to 10 minutes for a full agent run; every path here is inside it, and none runs without a bound. The offline paths replay recorded model and Zetaris replies; the live path is the one with variable latency.

## Live mode (optional)

Copy `.env.example` to `.env` and fill in what you have; nothing is required for the sample. `desk propose --record`, `desk ask --record` and `desk bench run --record` call Nemotron and record the replies; `desk silos --record` records Zetaris answers; `desk canary run` runs the day's pack on the model in `.env`. Zetaris runs locally in Docker (install steps and every verified fact: `docs/sponsors/zetaris-local-setup.md`); `infra/silos/` starts the three synthetic silos and loads them from the sample. The gate, the hook and the signing key are described in `docs/verification/gate-enforcement.md`.

### Which Nemotron model

NVIDIA changes what its free endpoint serves, and the answer for a given key can differ from day to day. On 2026-10-26, through Meterless Nightshift with an NVIDIA key, `nvidia/nemotron-3.5-lightning-30b-a3b` and `nvidia/nemotron-3-ultra-550b-a55b` answered every call of a live run (receipts in `docs/verification/nightshift-receipts/`). Other teams reported in the event chat on 23 to 25 October that `nvidia/nemotron-3.5-super-vl-120b-a12b` returns empty replies and HTTP 500 under load (Nightshift holds it out by default), that `nvidia/nemotron-3-super-120b-a12b` and `nvidia/llama-3.1-nemotron-ultra-253b-v1` return 404, and that `nvidia/llama-3.3-nemotron-super-49b-v1.5` is retired (410); those reports are not re-checked here. The benchmark's recorded replies were made with the 120B super-vl model before that, replay offline, and are labelled with it. For a live run, set `NEMOTRON_MODEL` to a model your key can reach: the two named first are the ones that answered here. These models reason before they answer, so a small `max_tokens` can return an empty reply; desk. sends 1,024 by default and retries an empty reply.
