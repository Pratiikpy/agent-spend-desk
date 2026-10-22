# Profile: mastra-ai/mastra

Reader: Haiku (low effort), 2026-10-16, about 118 seconds, 95k tokens, 46 tool calls. Shallow clone (depth 1), commit 6dc66e6c, core version 1.78.1-alpha.0 (deleted after the profile pass). TypeScript, so this is a direct comparison for our own runtime. Paths relative to `packages/core/src/` unless stated.

Spot-check (reviewer, against the files): `LICENSE.md` says everything under any directory named `ee/` (auth, agent-builder and editor enterprise parts) is under a separate enterprise licence, third-party parts keep their own licences, and the rest is Apache 2.0, copyright Kepler Software (confirmed); commit 6dc66e6c and version 1.78.1-alpha.0 (confirmed); package list includes core, memory, evals, rag, mcp, server, deployer, loggers (confirmed). The loop, workflow-suspend and memory-processor details and line numbers were not rechecked and are the reader's account. Result: PASS on licence and identity; the rest unverified.

## 1. What it is
A TypeScript framework for agents and workflows: tool-calling agents, a graph workflow engine with suspend and resume, memory, evaluations, tracing, a studio UI and a model router for many providers. Apache 2.0 outside `ee/` folders.

## 2. Architecture map
In `core`: agent runtime, workflow engine, loop (model step dispatcher), memory, tools, evals hooks, observability spans, model router. Separate packages for memory, RAG, evals scorers, MCP, server adapters, deployers.

## 3. Features and how each behaves
Agents call tools in a loop with a step limit (default 10 per the reader) and can delegate to sub-agents. Workflows are declarative graphs (branch, parallel, for-each, sleep, conditions); a step can suspend, and the engine stores status and payload with timestamps and resumes from that snapshot. Memory has three modes (last messages, semantic recall by embeddings, working-memory template) plus fact extraction. Built-in tools include asking the user (suspend and prompt) and plan or goal tools. Scorers run as hooks after a step, with optional sampling.

## 4. How people use it
`npm create mastra@latest`; define agents and workflows in one entry file; call `generate` or `run`. Examples cover tools, memory, evals, durable agents and voice. Tests with Vitest. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M7 runtime, M13 approvals)
Suspend and resume: the engine persists a snapshot (status, output, suspend payload, started and suspended times), guards against overwrite on resume, and calls the step's resume function. By the reader's account, tool calls in flight at the time of suspension are not memoised and run again on resume, which is the same hazard seen in LangGraph (profile 07): our release step must be split and use a one-time key. Processors (memory, filters) run in sequence before the model call.

## 6. Agent patterns
Monolithic agent with tools; delegation to sub-agents by reference with a registry of earlier results so work is not repeated; no built-in critic or confidence branching.

## 7. Model and data layer
A router over 40 or more providers; storage adapters for in-memory, Postgres and Redis; external embeddings.

## 8. Hackathon-care checks
Spans with W3C trace context exported as JSON or through OpenTelemetry; no offline or replay mode in the base framework; processor errors are only logged at debug level (reader's account); no sandbox for tool functions.

## 9. Traps seen
Silent processor and memory failures; tool re-execution on resume; no fallback model; free-form tool descriptions with validation only at execution.

## 10. Reuse
Apache 2.0 outside `ee/`: copy with credit and notice. Do not copy `ee/` code. Candidate parts: suspend snapshot shape, processor pipeline, delegation reference registry.

## 11. Verdict: ADAPT for M7 and M13; use as a design comparison for our own TypeScript runtime
Copy: (1) a snapshot shape with status, payload and three timestamps, with a guard against overwriting a resumed step; (2) memory and filters as ordered processors in front of the model call; (3) references to earlier delegated results so the same work is not repeated, with the result wrapped as untrusted data.
Avoid: (1) re-running tool calls on resume; (2) debug-level logging of processor failures; (3) a single agent deciding everything.
Where we are already ahead: the release capability is single-use across crash and concurrency, and every failure is a recorded gap.
