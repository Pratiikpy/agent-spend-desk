# Profile: bytedance/deer-flow (DeerFlow 2.0)

Reader: Haiku (low effort), 2026-10-16, about 102 seconds, 109k tokens, 27 tool calls. Shallow clone (depth 1), deleted after the profile pass. Paths relative to `backend/` unless stated.

Spot-check (reviewer, against the files): MIT licence, copyright Bytedance (confirmed); the nine-step middleware chain in strict order (thread data, uploads, sandbox, summarisation, to-do list, title, memory, image view, clarification last) at `backend/README.md:55-70` (confirmed); loop detection checks repeated tool-call sets and per-tool frequency, and a hard limit stops the whole batch before tools run (README, confirmed); at most 3 sub-agents per turn with a 15-minute timeout at README line 93 (confirmed; the reader's other figures such as a 1,800-second default and a delegation cap of 6 were not rechecked). Result: PASS on the parts checked; the rest is the reader's account.

## 1. What it is
ByteDance's open "super agent harness" on LangGraph: a lead agent with sub-agents, per-thread sandboxes, skills, memory and a gateway API. Version 2.0 is a rewrite. MIT.

## 2. Architecture map
One gateway process embeds the agent runtime. The lead agent runs through a chain of middlewares; sub-agents run in an executor with concurrency limits; a thread state with custom merge functions carries artifacts, goals, summary, sandbox and uploaded files; memory extraction runs in the background; a run event store keeps events as JSONL or in a database. A harness package is split from the application and the split is enforced in CI.

## 3. Features and how each behaves
Built-in tools for shell (off unless a container sandbox is used), listing, reading, writing and editing files; web search and fetch; MCP servers; skills discovered from folders with a scan before use. A `task()` tool delegates to sub-agents with acceptance criteria checked in code afterwards. Sandboxes are isolated per thread with virtual paths. Missing credentials for an enabled provider raise at model creation.

## 4. How people use it
`make setup`, `make config`, `make install`, `make dev`, or `make up` for Docker; open the web UI. Offline tests in shards and opt-in live tests. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M4 delegation, M7 runtime middleware)
Middleware ordering is the control surface: each concern (isolation, summarisation, memory, clarification) is a step with a fixed position. State merge functions make updates idempotent. Delegation checks results with an acceptance list (files exist, commands were really run), and the code says plainly that this proves execution, not that the claim is correct. Memory extraction is debounced and scoped by thread, user and agent. Lost: resuming from a delta checkpoint cannot fork a branch.

## 6. Agent patterns
Lead agent with a general-purpose sub-agent and a shell specialist, allowed-sub-agent lists per custom agent, loop detection, clarification interrupt, summarisation near token limits. No separate critic.

## 7. Model and data layer
A chat-model factory, tracing attached once at the graph root (a documented invariant to avoid duplicate spans), MCP configuration cached with an explicit reset, skills from public and custom folders, memory facts as per-user Markdown with YAML front matter.

## 8. Hackathon-care checks
Run events with model, stop reason and token counts; compose file bound to loopback by default; a credential broker sidecar keeps secrets out of the sandbox; input sanitisation middleware; benchmark rules require pinned data and stored manifests. Sample mode: NOT VERIFIED.

## 9. Traps seen
Memory read failures stop the turn (fail closed); a sub-agent timeout does not prove completion; two separate concurrency limits; the nine-step chain is order-sensitive.

## 10. Reuse
MIT: copy with credit. Candidate parts: the middleware chain, merge functions on shared state, the lease-based batch pattern, acceptance checks for delegated work, the credential broker sidecar, the harness and app split.

## 11. Verdict: ADAPT for M7 and M4
Copy: (1) a fixed-order middleware chain where each safety concern is a named step; (2) acceptance checks on delegated work, with the caveat stated in the report; (3) a credential broker so secrets never enter the sandbox or the model context.
Avoid: (1) two overlapping concurrency limits; (2) an order-sensitive chain with no validator: ours checks the order at start-up; (3) treating "the command ran" as "the claim is right".
Where we are already ahead: the acceptance checks here prove execution only; ours prove the quote exists in the stored text.
