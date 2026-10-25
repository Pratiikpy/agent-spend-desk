# Meterless engine specifications and conformance suites

The engines in `src/engines/` (H-MEM, World Model, Markovian) start as the minimal reference implementations published by Meterless, and the conformance runners and test vectors in `vendor/meterless/*/conformance/` are Meterless's, unchanged. Both are used under the Apache License 2.0 (see `LICENSE` in this folder and in each engine folder).

- Source: the Meterless open-source repository (https://github.com/Meterless/Meterless), commit `0aa7417ba5c826396d91e891328be78c45e6fbf6` (2026-07-22), folders `engines/<engine>/reference/src` and `engines/<engine>/conformance`.
- Changes so far: none to the vendored files. Desk-specific behaviour is added in `src/desk/` through adapters, not by editing these files; any later edit to a vendored file is listed here with a reason.
- There is no Meterless API or key involved; the engines run in this process (organizers' answer, 2026-10-17, recorded in `docs/sponsors/meterless-integration-notes.md`).
- Scout Intent is not vendored here: Meterless publishes a specification and an evaluation harness for it, and no reference implementation or conformance runner. See the next section.

## Scout Intent: specification and evaluation harness

- Source: the same repository and commit, folder `engines/scout-intent` (Apache-2.0, licence copied to `evals/scout/LICENSE`).
- Vendored unchanged into `evals/scout/`: `runner/index.ts`, `config/thresholds.yaml`, `fixtures/intents.json` and `regression-set/v1/`. They are byte-identical to the source; `tests/scout/harness.test.ts` runs the runner's gate on the regression set.
- Written by the Desk: everything else under `evals/scout/` (`runner/corpus.ts`, `runner/add.ts`, `config/thresholds-added.yaml`, `regression-set/v2/`, `desk/`). The question sets are marked in `docs/verification/scout-intent-2026-10-25.md` as written by the people who built the router.
- The router itself, `src/scout-intent/` and `src/desk/scout/`, is the Desk's own code, written from the specification's behaviour (five stages, bands, guard layers, signed execution contract, capability graph, model routing, re-planning). No Meterless code was copied into it. Where the specification leaves a choice open, or where this implementation departs from it, the departure is listed in the verification note.

