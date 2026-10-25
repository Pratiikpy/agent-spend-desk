# Failure drills and every error state (2026-10-25)

Feature DF-084 built. Each dependency the specification names (section 16.1) is killed, and each empty or error state it names (section 14.3) is reached, in `tests/desk/drills.test.ts`, which asserts what the Desk does and what the person is told. Some drills have more depth in the file of the feature they belong to; they are listed here so that this is the whole matrix.

## The matrix

| Dependency killed, or state | What the Desk does | Where it is tested |
|---|---|---|
| Model endpoint | the rule planner and rule explainer answer; the trace carries the failure and the fallback | `drill-model-down` |
| Zetaris | the embedded fallback on every silo, a reason for each, the billed class falls to nothing | `drill-zetaris-down` |
| Ledger cannot be written (the gate) | the hook denies and says it failed closed; an authorization is not allowed | `drill-ledger-readonly` |
| Enforcement endpoint (the gate process) | the hook blocks within 250 ms and says why; the emergency switch opens and is logged | `drill-gate-down`, `tests/desk/gate/gate.test.ts` |
| Price row missing | the call is counted as unpriced, the bill says so and names the command that adds a price, an enforced call on that model is denied | `drill-unpriced`, `owner-prices.test.ts` |
| Disk full | `E_DISK_FULL` with the ledger's path; the file being read is not kept, the files before it are kept whole; the chain is intact; the same command finishes once there is room | `drill-disk-full` |
| Clock skew in logs | lines stamped behind the line above them or in the future are counted; the session shows the calls in the order the log wrote them and says so | `drill-clock-skew`, `clock-skew.test.ts` |
| Canary harness changed | no run is added to the old series; a new baseline is asked for | `drill-harness-change` |
| Replay cassette missing | `E_CASSETTE_MISS` names the role and the command that records it; Ask falls back to its rules | `drill-cassette-miss` |
| No logs found | the card says it found none and names the folders it searched | the empty-state drill |
| Logs but no repositories | the bill says nothing can be called landed and that unlinked is unknowable, not waste | the empty-state drill |
| Canary not yet eligible | it says on which date the first call is possible | the empty-state drill |
| Canary skipped | the reason and the meter (plan window percent, estimated cost against the budget) | the empty-state drill |
| Replay withheld | the baseline did not reproduce the ledger: the sessions that differ are listed | the empty-state drill |
| Enforcement endpoint down | a red banner on every screen: the hook is installed and the gate is silent, so every guarded call is blocked, with the commands to start the gate or open it for 30 minutes | `enforcement endpoint down` drills |
| Ledger chain broken | fatal: the event, and the way back | `ledger-chain.test.ts` |

## What the drills found

- **A hook allowed while the gate's ledger could not be written.** An allow records nothing, so a read-only or full ledger went on allowing in silence, while the specification says the gate must deny. Every hook check now writes a heartbeat row first; a write that fails is a denial that says it failed closed.
- **A full disk was reported as "cannot rollback - no transaction is active".** SQLite had already ended the transaction, and the rollback that followed threw a second error that hid the first. An ingest now rolls back quietly and says `E_DISK_FULL`, with the ledger's path and what to do.
- **Five of the named states did not exist.** There was no clock-skew handling, no date on the canary's "not yet", no red banner for a silent gate, no way to give a price to a model the list lacks (`desk prices add MODEL=IN,OUT`, which the owner's rows are marked as theirs in the price snapshot and are ignored once the list prices the model), and nothing that withheld a replay whose baseline did not match the record. Each was built and is tested.
- **A drill premise was wrong.** The replay takes its costs from the ledger, so a different price list could not make its baseline differ; the check now compares the sessions with what the ledger stored and runs the replay engine over a policy that permits everything, which must change nothing. It was run on this machine's ledger (428 sessions, $33,474.85) and reproduces.
- On this machine's logs the clock rule flags 186 lines in 11 of 3,761 files, touching 8 of 424 sessions, and none in the future.

## Not covered

- A real full volume was not filled: the drill limits the SQLite file's size, which raises the same error.
- The Zetaris and model drills kill the endpoint with a refused connection. A hung endpoint is covered by the timeouts in their own tests, not here.
- The red banner reads Claude Code's settings files (the user's and the project's) for the hook and probes the gate on loopback. A tool wired through the gateway door instead of the hook is not detected as "installed".
- The banner names the command to open the gate; the interface is read-only and does not open it from the page.
- The 60-second threshold for a line to count as skewed is a judgment: a smaller one flags ordinary parallel work, a larger one misses a clock set back by a few minutes.
- The empty-state drills check the text and the numbers, not how each looks; the screens were looked at as they were built.
