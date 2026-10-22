# Profile: crewAIInc/crewAI

Reader: agy (Gemini CLI, plan mode), 2026-10-16, 382 seconds, 765 words. Local clone. Paths relative to `lib/crewai/src/crewai/` unless stated.

Spot-check (reviewer, against the code): `allow_delegation` default false and `max_iter` default 25 at `agents/agent_builder/base_agent.py:280,287` (confirmed); memory ranking `semantic * 0.5 + recency decay * 0.3 + importance * 0.2`, decay `0.5 ** (age_days / half_life)` at `memory/types.py:364-372` (confirmed for the formula; the default weights at lines 148-183 were not rechecked); delegation tool turns every exception into an error string at `tools/agent_tools/base_agent_tools.py:121-124` (confirmed). Result: PASS.

## 1. What it is
A multi-agent orchestration framework: role, goal and backstory agents run tasks in a sequential or hierarchical crew. MIT.

## 2. Architecture map
`agent/core.py`, `crew.py`, `task.py`, `memory/unified_memory.py`, `agents/crew_agent_executor.py`, a CLI package. A crew's `kickoff` runs the process, tasks execute through an agent executor loop, and a task output flows to the crew output.

## 3. Features and how each behaves
Agents (delegation off by default, 25 iterations, 2 retries); tasks with expected output, optional guardrails (3 retries by default) and optional human input; crews with sequential or hierarchical process, memory and cache off by default. A failed kickoff emits an event and raises.

## 4. How people use it
`pip install crewai`, then `crewai run` or a Python script. Tests are pytest across five libraries. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M4 delegation, M5 critic, M6 memory)
Delegation injects "delegate work" and "ask question" tools; the target agent is found by normalised role string and run on a synthetic task. Guardrails: a function checks a task output, and on failure its error text is added to the prompt for another try, up to the retry limit. Memory (LanceDB): each record scores by semantic similarity, recency decay with a 30-day half-life, and importance; deep recall expands the query when confidence is low. Lost: pending memory writes are lost on abrupt exit unless drained.

## 6. Agent patterns
Roles by prompt; guardrail retry loop; human review loop; a conditional task that runs based on the previous output; model fallbacks through LiteLLM. Shared state is concatenated task context.

## 7. Model and data layer
Base LLM class plus LiteLLM; tool and knowledge-source classes; MCP server config.

## 8. Hackathon-care checks
OpenTelemetry spans and an internal event bus. Tests can replay recorded calls and block the network. Evaluators and an evaluation CLI exist. Prompt-injection defences: NOT VERIFIED. Terminal human review blocks on `input()`, so it fails in headless runs.

## 9. Traps seen
Delegation matches agents by role text; all delegation errors become strings the model reads; JSON parse failure returns nothing silently (`task.py:1246`, not rechecked); knowledge-store errors log a warning and continue; two empty stub methods; blocking terminal prompt.

## 10. Reuse
MIT: copy with credit. Candidate parts: the memory ranking formula, the guardrail retry-with-feedback loop, tool argument schemas, the task output structure.

## 11. Verdict: ADAPT M5 guardrail retries and M6 ranking; REJECT string delegation and the terminal prompt
Copy: (1) the recency-decay composite score (we add a certainty term and a validity window); (2) retry with the failure reason fed back, capped; (3) typed tool arguments.
Avoid: (1) swallowing delegation errors into text with no audit record; (2) a blocking terminal prompt for approval; (3) dispatch by role string instead of stable ids.
Where we are already ahead: approval is an out-of-band, certified step; stable agent ids in the registry.
