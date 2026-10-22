# Profile: spiatrenka/coding-agent-flight-recorder

Reader: Claude Sonnet, 2026-10-20. Remote reads, no clone. Paths relative to the repository root; line numbers are those of the raw file. Licence read first: MIT (`gh api repos/.../license`). Stars 2; last commit (pushed_at) 2026-09-13; analyzer version 1.3.0 (`src/analyze/index.ts:50`).

## 1. What it is
Local post-hoc forensics for coding-agent runs. It reads Claude Code and OpenCode session data already on disk, segments it into runs, and grades each run `productive`, `unchanged`, `questionable`, `wasteful` or `risky` (`README.md:8-14`, `src/model.ts:60`). Zero runtime dependencies, no network.

## 2. Architecture map
`sources/` importers fill a normalised `Run` (`src/model.ts`, "the contract", lines 1-10); `analyze/{loops,risk,verify,cost}.ts` are pure functions `Run -> Finding[]`; `analyze/index.ts` assigns the verdict and a stop point; `store.ts` is SQLite; `server.ts` serves loopback only. Idle gap that ends a run: 1800 s (`README.md:110`).

## 3. Features and how each behaves
Loop detectors: identical tool call 3 or more times; same command failing 2 or more times; one file edited 4 or more times (`src/analyze/loops.ts:24-27`). The churn detector lowers severity when a check ran between the edits, because 6 of 11 real churn findings were iteration (`loops.ts:168-178`). A stop point is the earliest finding of medium severity or above, suppressed when fewer than 5 events followed (`index.ts:293-319`).

## 4. How people use it
`npx coding-agent-flight-recorder demo`, then `serve` (`README.md:16-19`). Tests cover detectors, store, server, security. Usage evidence beyond the repository: NOT VERIFIED.

## 5. Mechanism for the Desk
**The grade is a first-match cascade** (`docs/GRADING.md:33-43`): risk override; no diff with possible shell writes is `questionable`; no diff and (cost at or above $1.00 or a loop) is `wasteful`; diff with a loop and unverified is `wasteful`; diff with verification `passed` is `productive`; failing or not-run is `questionable`; no diff and no loop is `unchanged`. Copy the cascade and the printed rule name per run (`labelRule`, `index.ts:87`).

**Verification from evidence, not words.** Check commands are test, build and lint. Only the last outcome per normalised command counts, so fail-then-pass is a fix (`src/analyze/verify.ts:116-120,147-156`). `passed` needs every distinct check green. The detector `verify.unbacked_claim` fires when the assistant says "41/41 tests pass" and no check passed (`verify.ts:33-52,180-217`). Neither tool records exit codes reliably, so outcomes come from runner output, and an unrecognised format is inconclusive, never passed (`docs/GRADING.md:138-140`).

**Honesty about the unknown.** Every field a source cannot provide is nullable and "means unknown. Nothing here defaults to a fabricated zero" (`model.ts:8-9`). Cost is `null` unless priced, `costIsEstimate` is separate, and a real reported cost is never overwritten by a modelled one (`model.ts:151-154`, `src/analyze/cost.ts:7-9,112-118`). The price table carries a "last checked" date shown in every report (`cost.ts:33`). A shell command that may have written files sets `mutatesFiles` so "no tool edits" is not read as "no changes" (`model.ts:114-119`); such a run is `questionable`, not `wasteful` (`index.ts:198-211`).

**Duration decides nothing.** Over a 509-run corpus, a time condition made `unchanged` unreachable above five minutes and caused 45% of `wasteful` verdicts; repetition and spend are the signals (`index.ts:213-219`, `docs/GRADING.md:45-52`). Copy: never call a long run idle on elapsed time alone.

**What it does NOT do, checked.** It does not read the repository. The only git field is the branch name (`sources/claudeCode.ts:276,301`); a search of `cli.ts`, `store.ts` and `postmortem.ts` found no `git ` command, merge, revert or PR logic. "Productive" means "checks were green inside the transcript", not "landed". The task brief's phrase "grades runs against the repo" is therefore NOT accurate for the code as read.

## 6. Agent patterns
None; it analyses agents. Deterministic by design: "The same Run always produces the same Analysis" (`index.ts:4-6`), which makes a later model narrator measurable.

## 7. Model and data layer
`Source` seam with Claude Code JSONL and OpenCode (SQLite and legacy JSON). Parsing is tolerant because formats change; a mapped-nothing entry becomes `other` plus a drift note (`model.ts:20-23`). The OpenCode story (data moved to SQLite, old directory frozen) is a warning that "installed" checks pass on stale data (`README.md:128-131`).

## 8. Hackathon-care checks
Offline, synthetic `demo`, scrubbing in `redact.ts`, security tests present. Strong on corpus-measured thresholds with the numbers written next to the code.

## 9. Traps seen
Thresholds (3 identical calls, 2 failures, 4 edits, $1.00) are fixed and arbitrary beyond the corpus note. A blocked destructive command still forces `risky` (`docs/GRADING.md:105-108`). Grade says nothing about merge, revert or cost on a subscription plan.

## 10. Reuse
MIT: the cascade, detector definitions and null-means-unknown rule may be reused with credit.

## 11. Verdict: ADOPT the run-grading cascade and null-means-unknown rule; ADD the repository half it lacks
Copy: (1) first-match cascade with the matching rule named on screen; (2) last-outcome-per-command verification and the unbacked-claim detector; (3) estimated versus reported cost as separate fields.
Avoid: (1) calling transcript-green "productive" without a landing check; (2) fixed thresholds without a per-owner calibration; (3) treating a blocked action as the same severity as a done one.
