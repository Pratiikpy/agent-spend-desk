# Profile: openai/openai-agents-python

Reader: agy (Gemini CLI, plan mode), 2026-10-16, 354 seconds, 701 words. Local clone, version 0.23.1. Paths relative to `src/agents/` unless stated.

Spot-check (reviewer, against the code and docs): input guardrails run only for the first agent on turn 0, at `run.py:1038-1043` and `docs/guardrails.md:14` (confirmed); `run_in_parallel` default true at `guardrail.py:100` (confirmed); the docs say that in parallel mode the agent may already have used tokens and run tools before a tripwire cancels it, and that `run_in_parallel=False` runs the guardrail first (`docs/guardrails.md:36-40`, confirmed). Correction by the reviewer: a blocking mode exists, so the trap is the default, not a missing option. Result: PASS.

## 1. What it is
OpenAI's agent framework: agents, tools, handoffs, guardrails, sessions and tracing. MIT.

## 2. Architecture map
`agent.py` (agent definition), `run.py` (the loop), `guardrail.py` and `tool_guardrails.py`, `handoffs/`, `tracing/`, `memory/session.py`, `models/` (Responses, Chat Completions, LiteLLM), `testing/` (scripted model).

## 3. Features and how each behaves
Input guardrails (first agent, turn 0), output guardrails (the agent that produces the final output), tool guardrails (every guarded function tool call, three outcomes: allow, reject with content, raise). Handoffs are synthetic `transfer_to_<agent>` tools; the next agent gets the transcript unless filtered. Tool approvals pause a run and resume from a saved run state.

## 4. How people use it
`pip install openai-agents`, then `Runner.run_sync(agent, "...")`. Sessions persist history in SQLite, Postgres, Redis or Mongo. Tests use a scripted model. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M5 guardrails, handoffs, tracing; M10 registry)
A guardrail returns an output with a tripwire flag; a tripped wire raises an exception and halts the run. Tool guardrails check arguments before and results after execution. Tracing builds a tree of spans per run with context variables and exports in batches. Registry: none; handoff targets are static lists on each agent, and the "registration" module only adds an identifying string. Lost: no precedent, no autonomy levels, no policy resolution.

## 6. Agent patterns
Separate agents with their own prompts and tools; reciprocal handoffs can form a critic loop; a max-turns error handler; model retry policies. No confidence branching.

## 7. Model and data layer
A model interface with several providers; function tools, MCP servers, session backends.

## 8. Hackathon-care checks
JSON spans, fields truncated at 100 KB; tracing exports to OpenAI's trace endpoint by default, so it must be switched off or redirected for private data (sensitive data can be excluded with a flag). A scripted model gives offline tests. Malformed tool approvals fail closed. Benchmark numbers: NOT VERIFIED.

## 9. Traps seen
Input guardrails skipped for later agents in a handoff chain; the parallel guardrail default lets tools run before the check finishes; default trace export to an outside service; no registry or central policy.

## 10. Reuse
MIT: copy with credit. Candidate parts: the three-outcome tool guardrail, pause and resume with a saved run state, the scripted model for tests.

## 11. Verdict: ADAPT for M5; REJECT for M10
Copy: (1) allow, reject-with-content, raise as the three outcomes of a pre-execution check; (2) pause and resume from a serialised run state, with our rule that the irreversible call happens once, after approval, with an idempotency key; (3) a scripted model for deterministic tests.
Avoid: (1) guardrails that run on the first agent only: every agent and every handoff is checked; (2) running checks in parallel with irreversible tools: always blocking; (3) exporting traces to an outside service by default.
Where we are already ahead: a release gate with certified decisions, a central registry and policy; here the checks are per-agent code.
