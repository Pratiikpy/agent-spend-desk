# Profile: langchain-ai/langgraph

Reader: agy (Gemini, plan mode, file-reading tools only), 2026-10-16, about 9 minutes. Local clone (`libs/langgraph`, `libs/checkpoint`, `libs/prebuilt` and others). Paths are relative to `libs/langgraph/langgraph/` or `libs/checkpoint/` as in the reader's citations.

Spot-check (reviewer, against the code): resume re-executes the whole node from its start (`types.py:917`, confirmed); default `durability` is `"async"` (`pregel/main.py:2695-2696`, confirmed); the checkpoint README warns the serializer allows any Python type by default (`libs/checkpoint/README.md:55`, confirmed); the `keep_latest` prune note that delta channels would silently reconstruct as empty (`checkpoint/base/__init__.py:421-426`, confirmed); licence MIT (confirmed). The default `recursion_limit=25` was not located at the cited line (line 2665 only validates it). Result: PASS; the central finding is verified.

Why this profile matters for us: LangGraph is the strongest model of pause, resume, fork and replay, and it shows the exact hazard in our domain. A node that interrupts and later resumes runs its earlier code again, so a payment made before the interrupt would run twice. Our release step must be split so the irreversible call happens only after approval, once, with an idempotency key.

## 1. What it is
LangGraph is an orchestration framework for stateful, multi-actor agent workflows structured as graphs or Pregel loops ([README.md:11-24]). It coordinates durable execution, human-in-the-loop state pausing, and memory persistence across nodes ([README.md:37-43]).
Licence: MIT License ([LICENSE:1-3]).
Last commit: NOT VERIFIED.

## 2. Architecture map
- **Modules**: Monorepo containing `libs/langgraph` (Pregel loop, `StateGraph`), `libs/checkpoint` (persistence interfaces), `libs/checkpoint-sqlite`/`checkpoint-postgres` (savers), `libs/prebuilt` (`ToolNode`, `create_react_agent`), `libs/cli` (dev server/build), and `libs/sdk-py` ([AGENTS.md:32-39], [pyproject.toml:27-32]).
- **Data flow**: Input enters root channels -> `PregelLoop.tick()` schedules tasks ([pregel/_loop.py:633-650]) -> tasks read state and yield updates -> `apply_writes()` triggers channel reducers ([pregel/_loop.py:744-750]) -> checkpointer commits state and pending writes ([pregel/_loop.py:786]).
- **Entry points**: `StateGraph` ([graph/state.py:131]), compiled `Pregel` runner ([pregel/main.py:1]), and functional `@entrypoint`/`@task` decorators ([tests/test_pregel.py:66]).

## 3. Features and how each behaves
- **Inputs**: Dicts, TypedDicts, Pydantic models, or `Command` ([types.py:833-858]).
- **Outputs**: State dicts or stream chunks via `stream_mode` (`"values"`, `"updates"`, `"custom"`, `"messages"`, `"checkpoints"`, `"tasks"`, `"debug"`) ([pregel/main.py:2773-2787]).
- **Defaults**: `durability="async"` ([pregel/main.py:2798-2804]), `recursion_limit=25` ([pregel/main.py:2665]), interrupts `None` ([graph/state.py:1183-1184]).
- **Failure behaviour**: Exceeding step budget raises `GraphRecursionError` ([errors.py:68-73]); concurrent writes to unreduced channels raise `InvalidUpdateError` ([errors.py:91-98]); node errors halt execution unless caught by `RetryPolicy` or registered `error_handler` ([graph/state.py:675-677], [errors.py:150-168]).

## 4. How people use it
- **Install & first-run**: `pip install -U langgraph` ([README.md:27]). Build `StateGraph`, add nodes/edges, compile with checkpointer, invoke with `thread_id` ([types.py:930-975]).
- **Setups**: ReAct agent loops via `create_react_agent` ([chat_agent_executor.py:507-515]); production persistence via `PostgresSaver` ([checkpoint/memory/__init__.py:43]).
- **Tests**: Executed via `uv run pytest` ([Makefile:61-74]); Docker compose spins up PostgreSQL/Redis services ([Makefile:40-45]).
- **User feedback/issues**: NOT VERIFIED.

## 5. Mechanism for our module
- **Core logic**: Dynamic `interrupt(value)` raises `GraphInterrupt`, pausing execution and surfacing an `Interrupt(id, value)` ([types.py:903-1046]). Static breakpoints pause before/after nodes via `interrupt_before`/`interrupt_after` ([graph/state.py:1183-1184], [pregel/_loop.py:696-702]).
- **State kept**: Checkpoints store version `v`, timestamp `ts`, unique `id`, `channel_values`, `channel_versions`, `versions_seen`, and sorted `pending_writes` ([checkpoint/base/__init__.py:93-125], [185-196]).
- **Replay & fork**: `get_state_history()` inspects checkpoint lineage ([pregel/main.py:1514-1553]). Passing an earlier `checkpoint_id` forks a branch marked `source="fork"` or `"update"` ([pregel/main.py:1657-1784], [checkpoint/base/__init__.py:42-49]).
- **Limits & what is lost**: Resuming requires `Command(resume=...)` ([types.py:842-846]). The engine resumes from the node start, **re-executing all logic prior to `interrupt()`** ([types.py:918-919]). Pre-interrupt side-effects run again.

## 6. Agent patterns
- **Shared state**: Typed schemas with field-level reducers (e.g. `add_messages`) ([graph/state.py:131-139], [chat_agent_executor.py:57-60]).
- **Roles & critic loops**: Cycles between LLM generation, validation/critic nodes, and `ToolNode` ([chat_agent_executor.py:861-897]).
- **Branching & fallbacks**: Conditional edges dispatch routes or emit `Send(node, arg)` packets for parallel fan-out ([types.py:738-782]). Node error handlers route via `Command(goto=...)` ([graph/state.py:677], [errors.py:150-160]).

## 7. Model and data layer
- **Models**: LangChain `BaseChatModel` or callables plug into nodes; tools bind via `bind_tools()` ([chat_agent_executor.py:568-590]).
- **Data storage**: `BaseCheckpointSaver` persists supersteps per thread to memory, SQLite, or Postgres ([checkpoint/base/__init__.py:199-239]). `BaseStore` provides cross-thread hierarchical key-value storage with vector search ([store/base/__init__.py:1-60]).
- **Injection**: `ToolNode` injects `InjectedState` and `InjectedStore` directly into tool arguments ([tool_node.py:19-22], [574-621]).

## 8. Hackathon-care checks
- **Tracing**: LangSmith integration with `TracePolicy` payload filtering ([types.py:542-568]).
- **Offline / Sample**: Zero-dependency `InMemorySaver` ([checkpoint/memory/__init__.py:34-43]) and `InMemoryStore`.
- **Docker / CLI**: `langgraph dev` provides local hot-reload; `langgraph up` launches Docker server ([cli/README.md:41-67]).
- **Evals & numbers**: NOT VERIFIED.
- **Security**: Checkpoints serialize arbitrary Python types by default unless `LANGGRAPH_STRICT_MSGPACK=true` ([checkpoint/README.md:54-56]). CLI checks Git dependency URLs for credentials ([cli/README.md:106]).
- **Demo path**: Fast in-memory state graph via `langgraph dev --no-browser` ([cli/README.md:46-52]).

## 9. Traps seen
- **Full node re-execution**: Resuming an interrupted node re-executes all code from line 1 up to `interrupt()` ([types.py:918-919]).
- **Silent pruning loss**: `prune` with `"keep_latest"` silently breaks `DeltaChannel` ancestor write chains, returning empty state without error ([checkpoint/base/__init__.py:411-426]).
- **Insecure deserialization default**: `JsonPlusSerializer` allows arbitrary Python types unless constrained ([checkpoint/README.md:54-56]).
- **Silent cancellation**: User `asyncio.CancelledError` was swallowed as normal shutdown until wrapped in `NodeCancelledError` ([errors.py:169-182]).

## 10. Reuse
- **Licence class**: MIT License ([LICENSE:1-21]).
- **What may be copied**: Checkpoint schemas (`CheckpointTuple`, `StateSnapshot`), `Command`/`Interrupt` models, channel reducers, and serializer protocols, with copyright credit to LangChain, Inc. ([LICENSE:12-13]).

## 11. Verdict
**Verdict**: Adapt. Superstep checkpoints and `Command(resume=...)` suit state machines, but node re-execution is hazardous for irreversible actions (e.g. paying before an interrupt would double-execute).
- **Three to copy**:
  1. `Command(resume=..., update=..., goto=...)` control flow ([types.py:833-858]).
  2. Isolating pending writes alongside immutable checkpoints via `writes_sort_key` ([checkpoint/base/__init__.py:140-148], [185-196]).
  3. Pre-interrupt schema validation via `response_schema` ([types.py:988-994], [1014-1036]).
- **Three to avoid**:
  1. Re-executing node bodies from scratch upon interrupt resume ([types.py:918-919]).
  2. Unrestricted deserialization defaults in checkpointers ([checkpoint/README.md:54-56]).
  3. Silent empty states during checkpoint pruning walks ([checkpoint/base/__init__.py:421-426]).
