# Profile: microsoft/autogen

Reader: agy (Gemini CLI, plan mode), 2026-10-16, 385 seconds, 805 words. Local clone. Paths relative to `python/packages/` unless stated.

Spot-check (reviewer, against the code): inner team reset after each turn at `_society_of_mind_agent.py:250` (confirmed); speaker-selection fallback to the previous speaker or the first participant at `_selector_group_chat.py:302-308` (confirmed, but it logs a warning, so it is a logged fallback, not a fully silent one; the reader's "silent" is corrected); Magentic-One defaults `max_stalls=3`, `max_turns=20` (confirmed from the docstring at `_magentic_one_group_chat.py:52-53`); approval gate returning exit code 1 when code is not approved at `_code_executor_agent.py:711-715` (confirmed). Result: PASS; one wording fix.

## 1. What it is
An event-driven multi-agent framework (actor runtime, chat teams, extensions, studio GUI, benchmark harness). Code MIT, documentation CC-BY-4.0. The README says it is now in community maintenance in favour of Microsoft Agent Framework.

## 2. Architecture map
`autogen-core` (actor runtime with publish and RPC dispatch), `autogen-agentchat` (agents, teams, termination), `autogen-ext` (model clients, tools, Docker executors), `autogen-studio`, `agbench`. Messages are typed envelopes handled by decorated methods on routed agents.

## 3. Features and how each behaves
Assistant agent (model plus tools); selector group chat (a model picks the next speaker from role descriptions); Magentic-One orchestrator (a progress ledger with satisfied, progress and loop flags, stall counter, re-plan); code executor with an approval hook.

## 4. How people use it
`pip install autogen-agentchat autogen-ext[openai]`, then async scripts that stream a run to the console, or MCP tool servers. Tests via `poe test`. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M4 delegation, M5 critic loops, M10 registry)
Registry: agent factories and instances stored in the runtime; declarative components load only from a trusted namespace list. Delegation three ways: an agent exposed as a tool, a whole team wrapped as one agent, swarm handoff messages. Critic loop: the Magentic-One ledger counts stalls and, at the limit, re-plans and resets all agents. Lost: the wrapped team's state is cleared after every turn; ledger decisions are booleans with no confidence.

## 6. Agent patterns
Many: selector, round-robin, swarm, ledger-driven orchestrator with inner and outer loops, termination conditions such as an "APPROVE" mention. Shared state is the group message thread. No confidence branching.

## 7. Model and data layer
A model-client protocol with OpenAI and Azure clients; tools, MCP workbench, cache store. A replay client plays back scripted answers with no network.

## 8. Hackathon-care checks
Structured event classes (model call, message, dropped message) go to a logger, with OpenTelemetry spans. Offline replay client exists. Docker needed for the executor and the benchmark harness. README warns MCP servers can run local commands. Published benchmark numbers: NOT VERIFIED.

## 9. Traps seen
Speaker-selection failure falls back to the previous speaker with only a warning; wrapped team state reset after each turn; an agent used as a tool needs parallel tool calls turned off or its state corrupts (`tools/_agent.py:26-30`, not rechecked); the project is in maintenance mode.

## 10. Reuse
MIT code: copy with credit. Candidate parts: the approval request and response objects, the event schemas, trusted-namespace component loading, the replay model client.

## 11. Verdict: ADAPT for M4, M5 and M10
Copy: (1) the approval request before any irreversible execution, with the reason recorded when refused; (2) typed event schemas for model calls, messages and dropped messages; (3) a replay model client for offline and test runs.
Avoid: (1) a fallback speaker when selection fails: fail closed and record it; (2) clearing an inner team's state with no record; (3) stateful agents exposed as tools without a concurrency guard.
Where we are already ahead: approval is a gated, certified release with replay; AutoGen's approval is a yes or no on a code block.
