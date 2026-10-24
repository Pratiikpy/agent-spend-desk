# Verification

Each file here records a check that was run, with what it covered and what it did not. Read them as records, not as claims: a figure is only as good as the "Not covered" section beside it. Dates are when the check was run.

| Record | What was checked | Date |
|---|---|---|
| `ledger-vs-ccusage.md` | The Claude Code log reader and cost formula against ccusage, day by day and model by model | 2026-10-22 |
| `gate-enforcement.md` | The spend gate against the real Claude Code hook; the bypass suite (four processes at once, replayed and misused approvals, a clock set back) and what lies outside the boundary | 2026-10-22, 2026-10-24 |
| `gateway-2026-10-24.md` | The gateway door for tools with no hook: the OpenAI chat route against a real endpoint, the Anthropic messages route against a fake one | 2026-10-24 |
| `reconciliation-2026-10-24.md` | The cost Claude Code recorded for itself against our estimate, process by process, on 218,000 calls | 2026-10-24 |
| `price-sources-2026-10-24.md` | The price book against a second source: 89 of 90 prices agree and the one that does not is unresolved | 2026-10-24 |
| `codex-reader-and-limit-fit-2026-10-24.md` | The Codex reader, and what a percent of a plan limit costs in tokens, per plan and window length (with the pooling error found and corrected) | 2026-10-24 |
| `opencode-reader-2026-10-24.md` | The OpenCode reader, equal to the Lab's proxy token for token once OpenCode's own title call is set aside | 2026-10-24 |
| `runway-2026-10-24.md` | Whether a plan window will last: a pace projection that failed and the past-window forecast that replaced it, checked time-ordered on 110 windows | 2026-10-24 |
| `canary-simulation.md` | The daily regression statistic's false-alarm rate, by simulation | 2026-10-22 |
| `canary-first-run/` | The first real run of the canary on 16 tasks | 2026-10-22 |
| `calibration/` | How well session-to-commit link confidence and the policy simulator match known answers | 2026-10-22 |
| `benchmark/`, `learning/` | The pre-registered Ask benchmark (sets A to D), its results, and the learning loop; the v3 results are being re-recorded | 2026-10-22 to 2026-10-24 |
| `ui-sweep.md` | Every screen photographed in light and dark at desktop and phone width and read as a designer would | 2026-10-23 |

The experiment protocol for the Lab, and every change made to it during a run, is in `../lab/00-spike-protocol.md`. `desk prove` re-runs the checks that can be re-run from the repository alone.
