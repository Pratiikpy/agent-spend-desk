# Gate enforcement: what was run against the real Claude Code, 2026-10-22

The gate is the local reserve endpoint (`src/desk/gate/`). Claude Code reaches it through a `PreToolUse` hook
(`src/desk/gate/hook-main.ts`). The hook contract (exit code 2 blocks the call and its stderr goes to the model;
any other failure lets the call through, so every failure inside the adapter is turned into exit 2) was read from the
Claude Code hooks documentation the same day. This file records runs, not design.

Setup for each run: `npx tsx src/desk/cli.ts gate serve --policy <file> --db <file> --shadow-for 0 --port 8791`
with `DESK_GATE_TOKEN` and `DESK_GATE_URL` set, a settings file with one `PreToolUse` hook on `Bash`, and
`claude -p "Use the Bash tool to run exactly: echo ENFORCED_MARKER_123 ..." --settings <file> --allowedTools Bash`
(Claude Code 2.1.308).

| Run | Gate state | Result |
|---|---|---|
| 1 | not running | Bash was blocked: "Desk gate could not decide and is blocking as a precaution: the gate at http://127.0.0.1:8791 is not reachable." The command never ran. |
| 2 | running, policy permits only a model nothing uses | Bash was blocked with "Desk gate: no permit matches (default deny)." The command never ran. |
| 3 | running, policy permits everything | Bash ran and returned `ENFORCED_MARKER_123`. |

What this shows: for Claude Code with the hook installed, a denied call is actually blocked, and an unreachable gate
blocks (fail closed). Run 3 is the control: the block in run 2 is the policy and not the hook failing.

What it does not show: any tool without a hook (Codex, Cursor, a plain API script) is not stopped; those are
advisory through the MCP server or must be pointed at the reserve endpoint. A user who removes the hook from their
settings is not stopped either. The emergency switch, shadow mode and the approval card were exercised in unit tests
only (`tests/desk/gate/`), not through Claude Code.

Two defects were found by the tests written for this and fixed: the owner routes could not be reached with the owner
token (the agent token check ran first), and `integrity` reported a reservation whose time had run out as still
counted because expiry is written lazily (it now sweeps first).

## Bypass suite, 2026-10-24

`tests/desk/gate/bypass.test.ts` and the earlier gate tests, case by case. "Blocked" means a test shows the gate refusing or the attempt having no effect; "outside" means the gate cannot see it and says so.

| Case | Result | Where |
|---|---|---|
| Four processes ask at once on one database (24 requests, a cap that fits three) | Blocked. No more than three were allowed, the reserved total never passed the cap, every other answer was a deny, an ask or a coded refusal, and the hash chain and invariants came out clean | `bypass.test.ts`, real child processes |
| The same request key from two processes | Blocked. One reservation per key | `bypass.test.ts` |
| An approval replayed, used twice | Blocked. An approval is spent by its first use, also after the gate restarts on the same database | `gate.test.ts`, `bypass.test.ts` |
| An approval used for a different action, or by another person | Blocked | `bypass.test.ts` |
| A forged or wrong action digest | Blocked | `gate.test.ts` |
| The checker crashes, is unreachable, is slow or answers oddly | Blocked: the hook turns every failure into exit 2 | `gate.test.ts`, run 1 above |
| Clock set back | Blocked. The gate never uses a time earlier than its last recorded event, so a spent day does not reopen; the record stays in time order; `gate status` says how far behind the clock is. While the clock is behind, the gate's time stands still, so reservations and approvals do not age until it catches up. The test fails when the anchor is removed (checked) | `bypass.test.ts` |
| Clock set forward | **Outside.** A forward step cannot be told from a machine that slept, so the next day's budget opens. Detecting it needs a time source the gate does not have | `bypass.test.ts` states this |
| The hook removed from the agent's settings | **Outside.** Only the proxy door of Phase 6 would see it; not built |  |
| A direct API call, a tool with no hook | **Outside**, unless the tool is pointed at the gateway door (`docs/verification/gateway-2026-10-24.md`), which meters OpenAI-compatible chat completions and refuses other writes; a tool that ignores its base-URL setting is still outside |  |

Not covered: a gate database edited by hand is detected by the hash chain only when the edit breaks it (a complete rewrite of the chain, with the owner key not involved for ordinary events, is not detected); the whole suite ran on Windows only; the four-process race used Node's SQLite binding with a 15-second busy wait, and other bindings were not tried.
