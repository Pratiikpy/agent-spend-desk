# Profile: vectimus/vectimus

Reader: Haiku (low effort), 2026-10-16, about 98 seconds, 86k tokens, 31 tool calls. Shallow clone (depth 1), commit 99ee6c7 (deleted after the profile pass). Paths relative to `src/vectimus/` unless stated. A small project (about 38 stars at the time of reading); popularity is no evidence of quality here.

Spot-check (reviewer, against the code): Apache 2.0 (confirmed); commit 99ee6c7 "evaluator-redos" (confirmed); an evaluation error returns DENY with the reason "Evaluation error (fail closed)", file or script content is also checked line by line against shell-command rules when the first pass allows, and in observe mode a DENY or ESCALATE is logged and turned into ALLOW with "[observe]" prefixed to the reason, all at `engine/evaluator.py:170-213` (confirmed); an audit write failure prints one line to stderr and the hook still answers, at `engine/audit.py:28-40` (confirmed); receipts are signed with Ed25519 over RFC 8785 canonical JSON at `engine/receipts.py:4,23` (confirmed). The "under 10 ms" claim, the eleven policy packs and the daily policy-sync service were not verified (the reader noted the sync service is outside the repository). Result: PASS.

## 1. What it is
A policy layer that evaluates AI-agent tool calls before they run, with forbid-only rules in the Cedar language, hooks for coding agents and a signed audit trail. Apache 2.0.

## 2. Architecture map
Adapters normalise a tool call (Claude Code, Cursor, Copilot, Gemini) into one event; a policy engine evaluates it with Cedar; a decision (allow, deny, escalate) goes back to the hook; audit records and signed receipts are written; a daemon caches engines per project and mode; middleware exists for LangGraph and a plugin for Google's agent kit.

## 3. Features and how each behaves
Rules are forbid-only with annotations (id, description, incident, controls, suggested alternative, enforcement), so default is allow only if no rule forbids, with an error treated as deny. Modes: deny, escalate (log and block), observe (log and allow). Per-project and global overrides in a config file. Policy packs cover destructive operations, secrets, supply chain, infrastructure, database, git safety, MCP safety and agent governance (per README).

## 4. How people use it
`pipx install vectimus`, `vectimus init` (detects existing tool configs and allows the MCP servers already in use), `vectimus observe on` to trial, then enforce; optional shared server. Tests with pytest. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M5/M8 pre-action gate)
Cedar's positional "policy0, policy1" reasons are mapped back to the rule ids kept in annotations. Every decision carries the matched rule ids, the reason and a suggested alternative. Receipts bind the event and the decision under a signature so they can be checked later. Lost: audit failures are not fatal, so a decision can exist without its record; the schema of audit records has no version field (reader's account).

## 6. Agent patterns
No agent loop: a synchronous gate in the tool-call path. Escalate is logging plus blocking, with no human loop of its own.

## 7. Model and data layer
No model and no embeddings; hand-written rules and bundled packs; adapters per host; background rule sync (can be disabled).

## 8. Hackathon-care checks
JSONL audit with file locking and mode 0600; signed receipts; observe mode as a safe trial; one-command install; no built-in evaluation suite and no performance benchmark in the repository.

## 9. Traps seen
Observe mode left on turns the whole gate into a logger; script extraction for the line-by-line check can miss complex payloads; audit loss is silent to the agent; claims about compliance mappings and speed are unproven here; the policy pack is maintained outside the repository.

## 10. Reuse
Apache 2.0: copy with credit and notice. Candidate parts: rule annotations and the mapping back to ids, the second pass over file contents, the observe-mode design, signed receipts over canonical JSON, adapters that normalise host tool calls, the daemon cache.

## 11. Verdict: ADAPT for the coding and infrastructure pack of M5/M8; a close precedent for the release gate
Copy: (1) rule annotations that carry id, incident, controls and a suggested alternative into every decision; (2) an observe mode that records what would have been blocked, with an alarm if it stays on; (3) signed, canonical receipts for each decision.
Avoid: (1) letting an audit write fail while the action proceeds: for an irreversible action the decision is not final until its record is stored; (2) an escalate mode that only logs and blocks: ours is a routed approval with a bound request digest; (3) unversioned audit schemas.
Where we are already ahead: a restrict-only trust lattice, evidence-backed decisions, an override-to-rule loop and an offline verifier; Vectimus matches patterns in tool calls.
