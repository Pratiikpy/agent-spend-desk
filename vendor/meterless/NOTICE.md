# Meterless engine specifications and conformance suites

The engines in `src/engines/` (H-MEM, World Model, Markovian) start as the minimal reference implementations published by Meterless, and the conformance runners and test vectors in `vendor/meterless/*/conformance/` are Meterless's, unchanged. Both are used under the Apache License 2.0 (see `LICENSE` in this folder and in each engine folder).

- Source: the Meterless open-source repository (https://github.com/Meterless/Meterless), commit `0aa7417ba5c826396d91e891328be78c45e6fbf6` (2026-07-22), folders `engines/<engine>/reference/src` and `engines/<engine>/conformance`.
- Changes so far: none to the vendored files. Desk-specific behaviour is added in `src/desk/` through adapters, not by editing these files; any later edit to a vendored file is listed here with a reason.
- There is no Meterless API or key involved; the engines run in this process (organizers' answer, 2026-10-17, recorded in `docs/sponsors/meterless-integration-notes.md`).
- Scout Intent is not vendored here: it has an evaluation harness and no conformance runner.
