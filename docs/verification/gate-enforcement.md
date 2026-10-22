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
