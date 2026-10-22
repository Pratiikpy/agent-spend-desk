# Profile: microsoft/agent-governance-toolkit

Licence: MIT (`gh api repos/microsoft/agent-governance-toolkit/license`). Last commit read: 2026-10-20T09:46Z. Stars 6,452 (2026-10-20). Reader: Claude Sonnet, 2026-10-20. Read through the GitHub API and raw files, no clone. Paths below are relative to `agent-governance-python/`; the repository has 6,162 files in five languages, only the Python policy, approval, budget and audit code was read.

## 1. What it is
A multi-language "policy enforcement, zero-trust identity, sandboxing" kit for agents. The relevant part is `agent-mesh` (policy engine, approval handlers, audit chain, a budget tracker) and `agent-compliance` (policy replay in CI).

## 2. Architecture map
`agent-mesh/src/agentmesh/governance/`: `policy.py` (rules and engine), `conflict_resolution.py`, `approval.py` and `approval_webhook.py`, `audit.py`, `budget.py`. `agent-os/.../integrations/token_budget.py` is a second, separate budget tracker. `agent-compliance/.../policy_test.py` replays fixtures. Also .NET, Go and TypeScript ports with `Cedar`/`OPA` backends (`agent-governance-dotnet/src/AgentGovernance/Policy/CedarPolicyBackend.cs`, file list only).

## 3. Features and how each behaves
Rule: `name`, `stage` (pre_input, pre_tool, post_tool, pre_output), a `condition` string, `action` in allow, deny, warn, require_approval, log, a `limit` such as "100/hour", `approvers`, `priority` (`policy.py:96-135`). Evaluation collects every matching rule, then a conflict strategy picks one: priority_first_match, deny_overrides, allow_overrides, most_specific_wins (`policy.py:1069-1078`). An unrecognised policy scope is ranked as most specific so a corrupted deny cannot lose (`policy.py:1114-1128`). A rate limit applies to the winning rule and trips on the (N+1)th call (`policy.py:1163-1180`).

## 4. How people use it
`govern(my_tool, policy="policy.yaml", approval_handler=handler)` (`approval.py:10-18`); `agt test policies/ fixtures/` in CI (`policy_test.py:18-24`). Usage evidence beyond the repo: NOT VERIFIED.

## 5. Mechanism for the Desk
Budget (`budget.py:31-135`): `BudgetConfig{max_tokens=100000, max_cost_usd=10.0, window="1h"}`; per agent id `{tokens_used, cost_used, window_start}`; the window is tumbling, reset on the next access once `now - window_start >= window` (`budget.py:82-86`). `check_budget` denies if `used + estimated > max_tokens`, or if `cost_used > max_cost_usd` (`budget.py:109-129`). What it gets wrong, read in the code: the cost test has no estimate and uses `>` so the call that crosses the cap still goes through; state lives in a Python dict (lost on restart); the window is a wall-clock tumble so a burst at the window edge doubles the cap; the docstring says "as a policy rule type" but `policy.py` contains no reference to budget (grep, 0 matches), so the budget is not part of the written policy that the engine evaluates. `token_budget.py` warns at 0.8 of the cap (`:41`) but its progress bar computes `round(percentage / 10)` on a 0-1 fraction (`:105`), so the bar is always empty.
Approval gate: `require_approval` pauses, the handler returns `ApprovalDecision{approved, approver, reason, decided_at}`; fail-safe default `AutoRejectApproval` (`approval.py:111-133`); callback errors and timeouts deny (`:173-195`). The legacy `WebhookApproval` trusts a body-supplied approver and is deprecated (`:255-268`). The replacement `parse_webhook_response` requires the response to echo `approval_request_id` and `action_digest`, honours a deny always, and honours an approve only if a `response_verifier` returns a verified principal (`approval_webhook.py:73-119`). The payload carries request id, decision id, action digest, policy version, chain version and expiry (`:55-58`). This is the best approval-gate contract read in this pass.
Audit: each entry hashes `entry_id, timestamp, event_type, agent_did, action, resource, data, outcome, previous_hash` with SHA-256 over `json.dumps(sort_keys=True)` (`audit.py:173-191`), plus a Merkle chain (`audit.py:278`). No signature on entries was seen in the lines read; offline verification by a stranger: NOT VERIFIED.
Policy-change safety: only replay. Fixtures hold an `expected_verdict`; the report is `total, passed, failed`, and `ok` requires at least one fixture (`policy_test.py:56-83`). The fixtures are hand-written; nothing derived from past real runs, and no check that a new policy is no wider than the old (file-name search for diff, widen, subsume, attenuate found only `escalation.py`; `diff_policy.py` is about git diff size limits, `diff_policy.py:3-11`).

## 6. Agent patterns
Not an agent system. A gate before a tool call or output. Hooks for Claude Code, Codex, Copilot and Gemini CLIs exist as separate folders (file names only).

## 7. Model and data layer
Model-agnostic: cost and tokens are fed in by the caller (`record_usage(agent_id, tokens, cost_usd)`, `budget.py:88-94`). No price table was seen in the budget code, so dollar cost is whatever the caller passes.

## 8. Hackathon-care checks
Offline, no keys needed for the engine. CI gate exists. Honest numbers: none seen.

## 9. Traps seen
Docstring claims not matched by wiring (budget as a rule type). Two budget trackers with different semantics. Cost cap off by one call. Deprecated unsafe paths kept by default; strict mode is opt-in (`approval.py:34-46`).

## 10. Reuse
MIT: may copy with credit.

## 11. Verdict: ADAPT
Copy: (1) the action-bound approval echo (request id, action digest, verified approver, deny always honoured, anything malformed denies); (2) conflict strategies with a fail-closed scope rank; (3) a CI replay report with an exit code.
Avoid: (1) in-memory tumbling-window budgets; (2) a cost check that lets the crossing call through; (3) a budget outside the written policy.
Already better in our plan: a policy that includes spend and outcome caps in one document, replay of real past cases, and a signed offline dossier.
