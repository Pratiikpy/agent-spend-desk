# The tool-call exactly-once guard (2026-10-25)

Feature DF-090 built. A tool that mutates (a payment, a ticket, an email) must not run twice because a network call timed out, an agent retried, or a session resumed from a checkpoint. The guard was in the gate's code and reachable through the local HTTP door and the MCP door (`tool_begin`, `tool_complete`) but had no test and three gaps; this note says what it does now and what ran.

## What it does

- **A key** is a hash of the session, the tool name and the arguments (the arguments in canonical form, so the same arguments in another order are the same call). `tool_begin` records it as in flight and says `proceed`; a second begin with the same key says `in_flight` (HTTP 409) while the first runs, and `replayed` with the first run's response once it has completed, for five minutes. A run that failed is marked failed and may be retried, because nothing was done. After five minutes a key is free again.
- **Mutating by default.** Read, Glob, Grep, LS, NotebookRead, WebSearch, WebFetch and TaskOutput pass through (`passthrough: true`, no key recorded) unless the caller sends `dedupe: true`; an owner can list more read-only tools (`readOnlyTools`). Every other tool, and any the guard does not know, is held to one run. Spend a caller asks to reserve is still reserved for a pass-through tool.
- **It fails closed.** A ledger that cannot be written refuses the begin (the tool does not run). A key held by a different session, tool or arguments (a hash collision, or an edited row) refuses with `E_KEY_COLLISION`. Arguments that are not plain JSON are refused.
- **Responses are masked.** A tool's response is kept so a retry can be answered from it; credential-shaped strings are masked before it is stored, and a retry gets back what was stored.
- Each duplicate suppressed is recorded as an `idempotent_replayed` event with a zero debit.

## What ran

`tests/desk/gate/tool-guard.test.ts` (16):

- **20 retries of one mutating call sent at once run it exactly once**, and every one that did not run is told `in_flight` or `replayed`; after it finishes, a retry gets the first run's response.
- **Two gates on one database file, as two processes, run it once**, and **four real processes** (`tool-worker.ts`, started together on a shared clock) each asking five times for the same call are told to proceed exactly once, 19 times `in_flight`, with no error.
- 20 retries that each ask to reserve spend make **one reservation**; each duplicate is an event with a zero debit.
- A failed run may be retried; the hold lasts five minutes less a second and not five minutes and a second; different arguments, tool or session are different calls; argument order does not matter.
- Read-only tools pass through with no key; `dedupe: true` holds one; an owner-listed tool passes; an unknown tool is held.
- A read-only ledger refuses; a key held by another call refuses with the collision named; arguments that are not JSON are refused.
- A credential-shaped string in a response is not in the stored row and not in the replay.
- Through the HTTP door: 409 for a duplicate still running, 200 with the cached response once complete.

## Not covered

- **The gateway door does not see tool executions.** It meters model requests, which carry no tool run, so the guard lives on the reserve endpoint and the MCP door; an agent that does not call `tool_begin` before it runs a tool is not guarded, which the enforcement ladder already states for tools the Desk cannot reach.
- **It guards the Desk's own record of a call, not the tool.** A tool that has side effects before the agent asks the guard, or one the agent runs on a path that never asks, can still run twice. The guard cannot know what a tool did.
- A response larger than 256 KB is refused for caching, which refuses the completion, not the run.
- The five-minute window is the specification's; a retry after it runs again by design.
- The built-in read-only list is a judgment about common tools (Read, Glob and the like); a tool on it that an owner's setup makes mutating needs `dedupe: true`.
- The race test runs four processes on one machine; it does not prove behaviour over a network file system, where SQLite's locking is weaker.
