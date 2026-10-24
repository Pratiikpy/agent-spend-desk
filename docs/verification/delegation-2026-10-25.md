# Delegation trees: which agent started which, and what each cost with everything it started (2026-10-25)

Feature DF-094 built. `desk delegation` and a Delegation section on the session screen.

## Where the edges come from

Nothing is guessed from timing or names. A delegated agent writes its own log and stamps every line with its id; the agent that started it is the one whose log holds a record that names that id. Three records are read, the first that exists wins:

- **The result that launched the agent** (a structured field of the tool result, `agentId`), in the log of the agent that started it. This is how current clients record it.
- **The notice an older client queues when a delegated agent finishes**, which names the agent (`<task-id>`, an id of the shape agents have; a background shell task's id is not one), in the log of the agent that started it. Found when the first version left 169 of one session's 244 agents with no starter: the launching result of that client carries no id at all.
- **A workflow run** (a script that starts a batch of agents). The result that launched it names the run; the batch's agent logs sit in a folder named after the run. A workflow is a node of its own, with no calls, started by whichever agent's log holds the launching result. Without this, 680 of the 1,643 agents of the largest session hung under "unlinked".

The task text, the workflow's summary and every path in these records are never read. The workflow's own label for its script (cut to 60 characters) is kept, because a tree of run ids alone is unreadable.

## What it shows

For each session: every agent alone, and with all the agents it started (`C_cumulative = C_direct + Σ children`), the depth, and flags: `deep_delegation_risk` (deeper than five levels), `delegation_loop` (the logs say A started B and B started A; the loop is cut and each agent still counts once) and `unlinked_delegation`. An agent whose starter no log names hangs under a synthetic `unlinked` node, so the roll-up never drops a dollar: the cost of the root is the cost of every call of the session, which the tests hold the code to. The spec's `agent_role` is not shown: it would need the task text.

On this machine: 11 sessions started delegated agents; 2,022 edges, 3,326 agent logs named, 75 workflow runs in 7 sessions. The largest session: 1,643 agents, $12,192.36 in all, of which $8,195.47 is the main thread, 3 levels deep. Sessions deeper than five levels: none. Loops: none. One agent in the 244 of the qloo session still has no named starter and is shown as unlinked.

## What ran

`tests/desk/delegation.test.ts` (parsing, the roll-up and its invariants, depth and loop flags, a resumed session's chain of logs, ingest, backfill, forget), `delegation-workflows.test.ts`, `delegation-notices.test.ts`, `ui/delegation-ui.test.ts`, the migration test (schema 17). Full suite: 103 files, 1,347 tests. `desk delegation` was run on this machine's ledger for 150 days and one session's tree; the session screen was photographed in light at desktop width and in dark at phone width (no sideways scroll, console clean).

## Not covered

- **No OpenTelemetry `gen_ai.handoff.*` spans are read**; those are the spec's other source of edges, and the OpenTelemetry importer does not read them. A trace from another tool therefore has no tree.
- Codex and OpenCode record no delegated agents that the Desk reads; their sessions have a root only.
- Clients of different ages record a delegation differently; the three records above are the ones found on this machine's logs. A client that records the starter another way would leave its agents unlinked until a reader is added, which the report shows rather than hides.
- Depth above five and loops have been seen only on constructed trees, not on a real log.
- A resumed session that copies earlier messages into a new file keeps each call under the first log it was read from, so an agent's cost follows its first log.
