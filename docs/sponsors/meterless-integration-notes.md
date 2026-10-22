# Meterless: Integration Notes

**Status: REQUIRED in every submission. Facts about the product: NOT VERIFIED.** Fill the table from the HackOS Meterless folder, Build Day / Power Day recordings once published, or Help Meterless answers, citing the source of each fact. Facts read from the public sponsor repository or from third-party reviews are allowed only when labelled with that source (see the dated section at the end); on any conflict the HackOS or sponsor statement wins.

Organizer framing: "Meterless engines: build faster" (Build Day) and "Meterless: local and cloud provider" (Power Day). The Day 4 slides are "Powered by GenAI.Works and Meterless", so expect it to be central. Context: `docs/intel/03-sponsor-by-sponsor-expectations.md`.

## Verified facts

| Fact | Value | Source (file, timestamp or message link) | Date verified |
|---|---|---|---|
| What Meterless is | "The local-first context stack for agentic AI": memory, world modelling, reasoning compression, coordination, execution, runtime quality, all local-first. Apps: Gaia (personal agent workspace), Relay (execution layer), Swarms (divergent generation). Apache-2.0 for everything in the repo; app binaries proprietary and Windows-only per a third-party review. | `research/sponsor-reference/Meterless/README.md`, `llms.txt`; github.com/Meterless/Meterless (249 stars on 2026-10-13, commit 0aa7417 dated 2026-07-22) | 2026-10-13 |
| What "engines" are and how we call them | Four engines: **H-MEM** (hierarchical memory, trust ledger, conflict resolution, dreaming/sleep), **World Model** (event-sourced entity/relationship state), **Markovian** (bounded-carryover reasoning, flat context cost), **Scout Intent** (intent, risk guard, routing, signed execution contracts; spec + eval harness only). They are AGENTS.md-driven implementation specs with TypeScript reference implementations and conformance suites (`conformance/runner.ts`, env var such as `HMEM_IMPL=<your build>`), not an SDK to call over the network. | `README.md`, `AGENTS.md`, `engines/hmem/AGENTS.md`, `engines/hmem/reference/package.json` | 2026-10-13 |
| Local vs cloud: what runs where | Local-first by design; references run on Node with tsx/vitest, no API keys, mock LLM. Whether a hosted Meterless provider exists ("local and cloud provider", Power Day) is NOT VERIFIED. | repo README; organizer framing in `docs/intel/03` | 2026-10-13 |
| How we get access | Public repo; `npx degit meterless/meterless/templates/agentathon-starter my-agent` is the hackathon starter. | `README.md`, `docs/community/` | 2026-10-13 |
| Auth model and credential name(s) | None for the engine references. Hosted/API access: NOT VERIFIED. | | |
| Rate limits, quotas, cost | Engines free (Apache-2.0); apps free during Early Access per a third-party review (NOT VERIFIED first-hand). | wavect.io review | 2026-10-13 |
| Relationship to model serving or NVIDIA | Not stated in the repo; model-agnostic with a mock LLM in examples. | `templates/agentathon-starter/src/llm.ts` (to be read) | 2026-10-13 |
| Meterless's own hackathon rubric | Usefulness 30, **Meterless engine usage 25**, local-first/privacy 15, demo quality 15, creativity 10, documentation 5. This is Meterless's own guide; the GenAI Works rubric (Sponsor Tech 10/100) still governs our submission. | `docs/community/` hackathon guide | 2026-10-13 |
| Failure modes observed | none yet (nothing has been run) | | |

## Our role for Meterless in the build

- Which part of the system runs on it:
- What is faster, cheaper or newly possible because of it:
- Fallback when unreachable (tested under `SAMPLE_MODE`):
- What is unique about our use (goes in the sponsor explanation):

## Day-one connection test

- [ ] the vendored Meterless conformance runners plus `tests/meterless-engines.test.ts`
- [ ] Passes live
- [ ] Fails gracefully without credentials
- [ ] Fallback exercised

## Evidence for the demo and submission

- [ ] Trace or screenshot of Meterless executing inside an agent run
- [ ] Demo segment timestamped for "how Meterless is integrated"


## Repository read, 2026-10-16 (profile 33 in `docs/design/prior-art/profiles/`)

Source: the local clone of the sponsor reference repository, spot-checked by the reviewer. The repository contains four engines (`engines/hmem`, `markovian`, `scout-intent`, `world-model`), each with a specification (`AGENTS.md`), a zero-dependency TypeScript reference, examples and a conformance runner (`HMEM_IMPL`, `MARKOVIAN_IMPL`, `WORLD_MODEL_IMPL`); Scout Intent has an evaluation harness instead. The H-MEM retrieval formula is `0.35 semantic + 0.20 keyword + 0.10 tag + 0.10 domain + 0.15 entity + 0.05 layer + 0.05 recency - 0.20 superseded`, threshold 0.35, top 5 (`engines/hmem/AGENTS.md:152-161`); conflicts auto-resolve only at 0.70 confidence or more and the losing record is marked superseded, never deleted (line 329). The H-MEM reference uses a deterministic hash as the embedder and mock generators and makes no network call (checked for H-MEM only; the other three references were not checked for this). The starter template under `templates/agentathon-starter/` defaults to retrieval-only with zero network access and has an optional model mode that uses the Anthropic SDK when a key is set. The README states that the products Gaia, Relay and Swarms are proprietary and ship from separate repositories. NOT VERIFIED: whether Meterless offers a hosted runtime or API for hackathon participants (asked in the Help Meterless channel; the starter guide lists a key and an adapter, the strong-example environment file says "your-meterless-or-provider-key").
