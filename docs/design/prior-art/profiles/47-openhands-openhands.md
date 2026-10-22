# Profile: OpenHands/OpenHands (Agent Canvas front end)

Reader: Haiku (low effort), 2026-10-16, about 112 seconds, 89k tokens, 41 tool calls. Shallow clone (depth 1), package `@openhands/agent-canvas` version 1.27.1 (deleted after the profile pass). Paths relative to `src/` unless stated.

Important scope note: the default branch of this repository is now the React and TypeScript front end that runs and watches coding agents. The agent engine, runtime and sandbox live in a separate Agent Server package that this clone does not contain. Everything below is about the event model and the confirmation flow as seen from the client side; the engine itself was NOT read.

Spot-check (reviewer, against the files): MIT licence, copyright OpenHands contributors (confirmed); package name and version (confirmed); the type files `types/agent-server/core/events/action-event.ts`, `observation-event.ts` and `core/base/critic.ts` exist (confirmed); an action event carries `security_risk` (documented as predicted by a model when a risk analyser is enabled) and an optional `critic_result` at `action-event.ts:46-66` (confirmed); `SecurityRisk` is the enum UNKNOWN, LOW, MEDIUM, HIGH at `core/base/common.ts:59-64` (confirmed). The confirmation API, pagination limits and the cloud fallback behaviour were not rechecked. Result: PASS on the types; the rest is the reader's account.

## 1. What it is
The control centre for coding agents (OpenHands and others) across local, remote and cloud backends: conversation view, event stream, confirmation, files, browser, settings. MIT.

## 2. Architecture map
A launcher script, an API layer for the agent server, cloud and automation adapters, a live event service over WebSocket, an event store, UI components and stores, typed event definitions, Playwright tests against a mock model server.

## 3. Features and how each behaves
Every agent step is an event with an id, time and source. An action event holds the agent's thought, the tool call, a grouping id for parallel calls, a risk label and an optional critic result (score, message, categorised features such as "loop behavior"). An observation event holds the tool output and the id of the action it answers; a user rejection is its own observation with a reason. Confirmation mode pauses risky actions until the user accepts or rejects. Event search is paginated with sort and time filters.

## 4. How people use it
Install the package and run it with no sandbox, or run it in Docker with a mounted workspace, or use the cloud. Tests: unit and browser tests. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M5/M8 coding pack, M9 event log)
The stream is an ordered, linked log: observations point back to actions by id, rejections carry reasons, risk is labelled per action, and a critic result rides on the action. State in the client is a cache plus a set of already-submitted confirmation ids to avoid double submission. Lost: the risk label comes from the model and is not independently checked; thinking blocks can be redacted after capture.

## 6. Agent patterns
Critic scores attached to actions; risk-conditioned confirmation; user rejection as an observation the agent must handle. Re-planning happens in the server and was not read.

## 7. Model and data layer
A model-neutral message shape (role, content, tool calls, thinking blocks) so any model maps in; REST and WebSocket to the agent server; cloud history API.

## 8. Hackathon-care checks
Events are JSON with ISO times. A mock model server allows UI tests with no real agent. Credentials stay in the backend. No evaluation numbers in this repository.

## 9. Traps seen
An older cloud backend that fails a time-filtered search returns an empty page instead of an error, which looks like "no events"; a demo fixture is pre-built content; model-assigned risk is unvalidated.

## 10. Reuse
MIT: copy with credit. Candidate parts: the event types (action, observation, rejection), the risk enum, the confirmation request and response shape, strict pagination for transcript export. The UI components are tied to the project's own libraries.

## 11. Verdict: ADAPT the event model for the coding and infrastructure pack; engine not assessed
Copy: (1) action and observation events linked by id, with the rejection reason as an observation; (2) a risk label on every action, which for us is derived by rule from the policy table, not predicted by a model; (3) a confirmation id set so a double click or a retry cannot approve twice.
Avoid: (1) an empty page as the answer to a failed query: an error with a reason; (2) risk predicted by the same model that proposes the action; (3) treating a client repository as evidence about the engine.
Follow-up: the agent server and runtime repositories are not read and stay on the list.
Where we are already ahead: a signed, hash-chained ledger and an offline verifier, not only a stream shown in a UI.
