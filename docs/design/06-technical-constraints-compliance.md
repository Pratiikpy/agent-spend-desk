# Technical constraints compliance matrix

Status: design (nothing is built). Source: the Approach Guide step A (technical constraints), the Participant Setup Guide of 2026-10-15 (`docs/intel/09`) and the Official Rules readout (`docs/intel/08`). Each organizer rule is mapped to how the product meets it, the automated check that proves it, and what is still open. Where the Setup Guide is stricter than the Approach Guide, the stricter reading is used, and the difference is noted. Schedule items are left out by instruction.

## 1. Rule by rule

| # | Organizer rule | How we meet it | Automated proof (a check that can fail) | Status |
|---|---|---|---|---|
| 1 | Zetaris and Meterless: every submission must integrate both (Setup Guide: must run on the participant's machine; Zetaris is the center of every build) | Zetaris is the primary path for internal data over its REST API with typed views; the four Meterless engines are implemented from their specs and pass their conformance runners | Connection test to Zetaris on every run (`SELECT 1`, one registered table); a trace line for every Zetaris query; Meterless runner results committed as a report; an inert-stub test that makes the suite fail if either sponsor path is removed | Designed; credentials and Meterless route details outstanding |
| 2 | Cursor (with Space XAI) is the development environment | Build in Cursor with its Grok and Composer models; provider key kept out of Cursor settings | Cursor session log updated per session (`docs/sponsors/cursor-usage-log.md`) and checked for gaps | Designed |
| 3 | NVIDIA: integrate wherever it contributes (Approach Guide); the product must run on Nemotron (Setup Guide, stricter) | Nemotron through the standard model port is the primary profile (Super default, Nano for helpers, Ultra for deepest planning); the deterministic rule brain is the credential-free fallback | A trace line for every model call naming the model id; a test that the sponsor profile makes zero calls to any other provider | Designed; key and rate limits unverified |
| 4 | Languages, frameworks, models: open choice | TypeScript on Node 22 with our own kernel contracts; substrate decided by bake-off | Not applicable | Fits |
| 5 | Pre-existing work: work committed before the build window is not eligible, except declared pre-existing components | Nothing is committed before the window (hook enforced); open-source libraries and any adapted code are listed with licence in a declaration file | `window_guard` hook; a generated `docs/submission/pre-existing-components.md` from the dependency lockfile plus a manual list of adapted files; a test that every vendored file has a credit line | Designed; eligibility of uncommitted local work is an open organizer question |
| 6 | Runtime: bounded and predictable (target for a full run 5 to 10 minutes) | Timeouts on every external call, capped retries and turns enforced in code, budgets per phase, a fast mode for the jury, replay and symbolic check | A runtime budget test per phase with a failing threshold; a test that an endless-retry fault injection terminates; the run header prints the budget used | Designed; budgets unmeasured |
| 7 | Static data: keep the repository light; use samples | Curated samples only; large data via a download script into a gitignored folder; data README per source (URL, licence, subset, count, how to regenerate, limits) | `scripts/repo_size_check.py` in the gate; a test that every file under data/ has a README entry | Script exists; data not built |
| 8 | Secrets: no API keys committed | `.env` ignored; hooks scan every write; history scan before any push | `scripts/secret_scan.py` (tree and `--history`) in the gate; the write-guard hook | Scripts exist and run clean today |
| 9 | Environment variables: `.env.example` with placeholder values only | One `.env.example` listing every variable the code reads, all placeholders | A test that parses `.env.example`, fails on any value that looks real, and fails if the code reads a variable missing from the file or the file lists one the code never reads | Designed |
| 10 | Logs: save or print agent activity | A JSONL trace with the reason for each decision; a cleaned sample in `output_examples/traces/` | A test that every run emits the required events (plan, tool call, critic score, branch, fallback, report) and that every claim in the report maps to a trace line | Designed |
| 11 | Examples: include sample inputs and outputs | `input_examples/` and `output_examples/` for more than one case | A test that regenerates each example output from its input in `SAMPLE_MODE` and diffs it (allowed differences are listed); fails if an example is stale | Designed |
| 12 | No manual setup: data loading and execution automated | One command from a clean checkout loads data, starts services in sample mode and runs the demo; no runtime installs | The clean-room verifier runs the README literally on a fresh clone; a test that no step installs packages at runtime; a test that the run needs no human input | Designed |
| 13 | Submission through HackOS with the listed components | Demo video, deck, repository with README, sponsor technology explanation | `/submit-check` checklist, rules-auditor and judge-simulator passes | Outline exists |

## 2. Gates that go beyond the organizers' list

- **Determinism gate:** two runs of the same case in `SAMPLE_MODE` produce identical decisions and identical evidence hashes; differences in wall-clock fields are the only ones allowed.
- **Fault-injection gate:** kill Zetaris, kill the model endpoint, return malformed data, return nothing; the run must complete, say what it fell back to, and never present a fallback result as live.
- **Claims gate:** every sentence in the README, deck, video script and sponsor explanation that states a capability must point to a test or a trace; superlatives fail a wording lint.
- **Sponsor-honesty gate:** a sponsor is described as used only if its call site, trace line, tested fallback and a sourced note exist.
- **Reproducibility gate:** the published scores (detection rate, memory gain) are regenerated by one command and match the committed report within stated intervals.

## 3. Open items

- Zetaris platform bundle, registry credentials and the hand-created API key; Meterless route, credit and prompt library (placeholders in the Setup Guide); a free NVIDIA key and its rate limits.
- Organizer answers: how much code may be prepared in advance; whether running Zetaris locally and the product running on Nemotron are binding eligibility conditions (they appear in the Setup Guide and not in the Official Rules we hold).
- Build machine: 8 GB for Docker and 15 GB free disk.
