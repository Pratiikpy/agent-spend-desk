# Profile: langchain-ai/langgraph (checkpoint, persistence and time-travel code only)

Reader: Claude Sonnet, 2026-10-20. Remote read only (raw files via curl, no clone). Scope is limited to the checkpoint library and the replay logic in the Pregel loop; the rest of the framework was not read. Paths are relative to the repository root; where a line number stands alone it refers to the file named most recently in the same paragraph (`_loop.py` is `libs/langgraph/langgraph/pregel/_loop.py`, `base/__init__.py` is `libs/checkpoint/langgraph/checkpoint/base/__init__.py`). Line numbers are from the files as fetched on 2026-10-20.

## 1. What it is
The persistence layer of LangGraph: a `Checkpoint` snapshot per superstep, per-task "pending writes", and a loop that resumes, forks or replays from any checkpoint. Licence: MIT, "Copyright (c) 2024 LangChain, Inc." (LICENSE:1-3), read first. Stars 43577, pushed 2026-10-20 (`gh api`, 2026-10-20). Last commit read: a24fc97, 2026-10-20 10:09Z.

## 2. Architecture map
- Snapshot type: `libs/checkpoint/langgraph/checkpoint/base/__init__.py`. Saver base class `BaseCheckpointSaver` at :199, with `get_tuple` (:262), `list(filter, before, limit)` (:277-299), `put` (:301), `put_writes` (:324), `delete_thread` (:344), `copy_thread` (:374), `prune` (:398).
- Loop: `libs/langgraph/langgraph/pregel/_loop.py` (resume, replay, fork); task ids in `pregel/_algo.py`; `get_state_history` at `pregel/main.py:1514`; subgraph replay state in `libs/langgraph/langgraph/_internal/_replay.py`.

## 3. Features and how each behaves
Stored per step: a `Checkpoint` with `id` (unique, monotonic), `ts`, `channel_values`, `channel_versions`, `versions_seen` (which versions each node has consumed, used to decide what runs next) and `updated_channels` (base/__init__.py:93-124). Metadata: `source` in `input | loop | update | fork`, `step` (-1 for input, 0 first loop), `parents`, `run_id` (:39-62). A `CheckpointTuple` carries the checkpoint, metadata, parent config and `pending_writes` (:140-147). `PendingWrite` is `(task_id, channel, value)` (:32), so a step that failed halfway keeps the writes of tasks that finished.

## 4. How people use it
Compile with a checkpointer, call with a `thread_id`; `get_state_history` lists snapshots; a past `checkpoint_id` forks or replays. Tests: `libs/langgraph/tests/test_time_travel.py` (present, not read). Usage evidence: NOT VERIFIED.

## 5. Mechanism for the Desk (replay and side effects)
What replay re-executes. The loop distinguishes **resume** from **time travel**. On resume, finished tasks' stored writes are handed back and not rerun (`libs/langgraph/langgraph/pregel/_loop.py:822-825`: pending writes are reapplied only `if not self.is_replaying`). On time travel, "Finished tasks rerun only on time travel" (:971-974), so every node after the chosen checkpoint **executes again for real**. There is no recorded-result substitution for tools or model calls and no side-effect classification. A grep of `_loop.py` and `func/__init__.py` for "idempot" and "determinis" found nothing (2026-10-20). The caller owns idempotency.

What is made safe: interrupts. On time travel the cached `RESUME` writes are dropped so `interrupt()` fires again instead of returning a stale answer (:948-950, :975-978). A time-travel run first saves a `fork` checkpoint so the new branch is its own history (:1079-1102). Subgraphs on first visit load the latest checkpoint **before** the replay point (`libs/langgraph/langgraph/_internal/_replay.py:52-73`).

Task identity. A task id is a hash over the checkpoint id bytes, namespace, step, node name and triggers (`libs/langgraph/langgraph/pregel/_algo.py:437, 615-622`). A fork gets a new checkpoint id, so task ids change; stale interrupt writes are therefore cleared (`_loop.py:1095-1098`). So task id cannot serve as an idempotency key across a replay.

Durability. `Durability = Literal["sync","async","exit"]` (`libs/langgraph/langgraph/types.py:98`), default `"async"` (`libs/langgraph/langgraph/pregel/main.py:2696`). Task writes are persisted as they finish unless the mode is `"exit"` (`_loop.py:515`). In `"exit"` mode a crash loses the run's progress.

`@task` results are cached in the checkpoint so "compose_essay task will not be re-executed" on resume, with the requirement that inputs and outputs be serializable (`libs/langgraph/langgraph/func/__init__.py:154, 340-341`).

What the Desk learns: checkpoint stores **state**, not cost. `Checkpoint` and metadata hold no tokens, model, price or latency (base/__init__.py:39-124). Whether message objects in `channel_values` carry usage numbers: NOT VERIFIED.

## 6. Agent patterns
Not applicable to this slice (interrupts, `Command(resume=...)`, `Send`, namespaced subgraphs exist).

## 7. Model and data layer
Pluggable serde (jsonplus, msgpack, encrypted wrapper in `libs/checkpoint/langgraph/checkpoint/serde/`); allowlist and encryption details: NOT VERIFIED. Database backends live in packages not read.

## 8. Hackathon-care checks
In-memory saver needs no setup. Replay is deterministic only if node code is; nothing here checks that.

## 9. Traps seen
Replay re-fires side effects. `exit` durability loses progress on a crash. Checkpoints grow every step; `prune` is an explicit call (base/__init__.py:398). Behaviour on schema drift after code changes: NOT VERIFIED.

## 10. Reuse
MIT: may reuse with credit. The shape is worth rebuilding in TypeScript rather than importing.

## 11. Verdict: ADAPT
Copy: (1) per-step snapshot plus per-task pending writes, so partial progress survives and finished work is not redone on resume; (2) the resume-versus-time-travel split with a **fork checkpoint** so a replay never mutates the original history; (3) a replay run's metadata `source` and `parents` so every replay is traceable to its origin.
Avoid: (1) re-executing mutating tools on replay with no substitution and no side-effect class (Reenact and Kitaru both fix this); (2) task ids that change on fork as the only identity; (3) a checkpoint with no cost or model fields, since the Desk needs both per step.
