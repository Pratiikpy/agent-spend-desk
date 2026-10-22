# Profile: deepset-ai/haystack

Reader: agy (Gemini CLI, plan mode), 2026-10-16, 388 seconds, 825 words. Local clone. Paths relative to the repository root.

Spot-check (reviewer, against the code): Apache 2.0 (confirmed); pipeline telemetry is called on every run through `pipeline_running(self)` at `haystack/core/pipeline/pipeline.py:349` (confirmed; whether it can be switched off by an environment setting was not checked); a token-based secret raises on serialisation, "use an alternative secret type" at `haystack/utils/auth.py:150-158` (confirmed); lifecycle hook points `BEFORE_RUN`, `BEFORE_LLM`, `BEFORE_TOOL`, `AFTER_TOOL`, `AFTER_RUN`, `ON_EXIT` imported by the agent at `haystack/components/agents/agent.py:40-50` (confirmed); a blocked pipeline logs a warning and exits the loop at `pipeline.py:428-439` (confirmed). Corrections by the reviewer: the link fetcher's multi-URL behaviour is documented and logged, not silent, but with `raise_on_failure` false it appends an empty `ByteStream` for every failed URL (`link_content.py:330-341`), a placeholder that looks like content; the docs say only a single URL honours `raise_on_failure=True` (lines 276-283). Result: PASS.

## 1. What it is
deepset's open-source framework for retrieval and agent pipelines built as typed graphs of components. Apache 2.0.

## 2. Architecture map
A pipeline engine on a directed graph (NetworkX) with typed input and output sockets and a priority queue that schedules runnable components; components for retrievers, fetchers, routers, generators, agents and evaluators; document stores behind a protocol; a tracer with a no-op default; secrets and a deserialisation security module.

## 3. Features and how each behaves
`Pipeline.run` takes component-keyed inputs and returns the terminal outputs plus any outputs requested from intermediate components. A component can be limited to a number of runs. On an error or breakpoint the pipeline saves a snapshot and raises. The agent component loops until a step limit or the model stops, records the exit reason, keeps a typed state with merge rules per field, and runs hooks that can stop or force another step. A conditional router evaluates template expressions and raises if no route matches.

## 4. How people use it
`pip install haystack-ai`, assemble a store, retriever, prompt builder and generator, connect sockets, run. Tests with Hatch (unit and integration). Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M7 orchestration contracts, M1 fetchers, M8 secrets, human approval)
Typed sockets make wiring errors fail at build time. Run counts per component bound loops. Snapshot at a breakpoint is a pause-and-resume record, usable for approval before an irreversible step. Hooks at before-tool and after-tool are the natural place for policy checks. Secrets refuse to be written into saved configs. Deserialisation uses an allow list and denies `eval`, `exec`, `open` and `__import__`. Lost: intermediate outputs are dropped unless requested.

## 6. Agent patterns
Agent with typed state and merge handlers, agent-as-tool nesting, five hook points with stop and continue controls, conditional routing. No critic or confidence branching.

## 7. Model and data layer
A chat-generator protocol over a chat-message dataclass; clients created lazily in a warm-up step; document stores and byte-stream payloads behind protocols.

## 8. Hackathon-care checks
Span-based tracing with content muted unless enabled; structured logs truncated at 4,096 characters; fully offline with the in-memory store; built-in evaluators (exact match, context relevance, recall, MRR, NDCG, faithfulness). No Dockerfile at the root. Telemetry on by default.

## 9. Traps seen
Telemetry on every pipeline run; empty placeholder streams for failed fetches; a global dictionary behind the shared in-memory store; a blocked pipeline stops with only a warning; the in-memory store is ephemeral.

## 10. Reuse
Apache 2.0: copy with credit and notice. Candidate parts: typed sockets, run limits, snapshot and breakpoint pattern, secret refusal to serialise, deserialisation allow list, hook points.

## 11. Verdict: ADAPT for M7, M1 and M8
Copy: (1) typed wiring between components and per-component run limits; (2) a saved snapshot at every approval point; (3) secrets that cannot be serialised plus an allow list on anything loaded from a file.
Avoid: (1) a placeholder result for a failed fetch: record a gap; (2) telemetry in any default path (our rule: no outbound call that is not a declared source); (3) a blocked workflow that ends with a warning: a blocked case is a visible state.
Where we are already ahead: a release gate with certified decisions; here the pause points are generic.
