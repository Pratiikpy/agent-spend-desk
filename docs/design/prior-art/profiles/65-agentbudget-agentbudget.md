# Profile: AgentBudget/agentbudget

Reader: Claude Sonnet, 2026-10-20. Remote read (no clone). Paths relative to repo root. Licence read first: Apache-2.0 (LICENSE; GitHub API). Last commit read: 2026-10-01. Stars 109 (2026-10-20). Spot-check: ledger.py:62-65, circuit_breaker.py:25-38, _patch.py:528/551 re-read against the file after writing; all matched. The repo's CI/test results were not run (NOT VERIFIED that the suite passes).

## 1. What it is
An in-process Python SDK (plus Go and TypeScript ports under `sdks/`) that puts a dollar cap on one agent session: wrap an LLM response or track a tool cost, raise `BudgetExhausted` or `LoopDetected` (README.md:30, 89-90). Not a proxy, no server (README.md:482-487).

## 2. Architecture map
`AgentBudget` builds a fresh `Ledger` and `CircuitBreaker` per session (budget.py:117-129); `BudgetSession.wrap/track` price a call and record it (session.py:104-161); `_patch.py` monkey-patches OpenAI/Anthropic so `init()` needs no code change (README.md:42-62). Integrations: LangChain, AutoGen, CrewAI (integrations/crewai.py:22-63, a thin wrapper whose `track` the caller must call by hand).

## 3. Features and behaviour
Soft limit (default 90%, fires once: circuit_breaker.py:63-72), hard limit, loop detection, nested child sessions with rollup (session.py:186-229), `finalization_reserve` that lowers the hard cap (budget.py:86-91), webhooks, streaming capture (`_patch.py:111-190`), runtime price registration (pricing.py:113-127). Invalid costs (NaN, negative) are rejected (ledger.py:13-22 in the validate function).

## 4. How people use it
`pip install agentbudget`, then `agentbudget.init("$5.00")` (README.md:42-60). Tests: 18 Python test files, `tests/test_unit.py` has 148 test functions, circuit breaker 10, ledger 8, nested 6 (counted with grep); CI runs Python 3.9 to 3.13 plus Go and TS (`.github/workflows/ci.yml`).

## 5. Mechanism for the Desk
Data model: `CostEvent{cost, cost_type LLM|TOOL, timestamp, model, input_tokens, output_tokens, tool_name, metadata}` (types.py:19-30). No outcome field, only free-form `metadata`.
Ledger rule: under a lock, `new_total = spent + cost; if new_total > budget: raise` (ledger.py:61-66). Two losses: (a) the cost is recorded only AFTER the call returns (`_patch.py:528` calls the SDK, `:551` records), so there is no reserve step and one call can overshoot; (b) the overshooting event is not stored (it raises before append, ledger.py:64), so `total_spent` understates real spend exactly when it matters.
Loop rule: key = model name or tool name (session.py:126, 160), a list of timestamps per key, trip when `>= 10` calls in 60 s (circuit_breaker.py:27-38). It never looks at arguments, results or progress, so 10 legitimate parallel calls to one model trip it, and a slow loop (one call per 70 s) never does. `LoopDetector` has no lock (circuit_breaker.py:25 versus the lock in `CircuitBreaker`, :56).
Pricing: input and output tokens only (pricing.py:189-193). No cache read/write, no reasoning surcharge. An unknown model logs a warning and records nothing (session.py:127-134): a silent undercount.
Children: a child gets `min(max_spend, parent.remaining)` and a default `CircuitBreaker()` with no callbacks (session.py:204-210); rollup happens at exit only (:224-229), so parent spend is stale while the child runs.
Do better: reserve before the call (upper bound = prompt estimate + `max_tokens` x output price), record unknown-model calls as "unpriced" instead of dropping them, store the overshooting event, key loops on (tool, args hash, result hash) not on name.

## 6. Agent patterns
None. It is a guard, not an agent. Callbacks (`on_soft_limit`, `on_hard_limit`, `on_loop_detected`) are the only hooks.

## 7. Model and data layer
Static price table generated from `pricing.json` (scripts/generate_pricing.py; CI checks it is in sync). Fuzzy match strips date suffixes (pricing.py:130-145). Prices go stale without a release or a `register_model` call.

## 8. Hackathon-care checks
Offline, no keys, one pip install. Report is a plain dict (session.py:231-247), no JSONL trace. Per-session ledger is in memory only: lost at process exit, so no monthly view.

## 9. Traps seen
README says the agent "can never silently burn through your budget" (README.md:30) and loops are caught "before they drain the budget" (:282); neither holds for the overshoot and name-keyed loop cases above. Drop-in mode keeps one session per thread or task (README.md:62-68), so a multi-process fleet has no shared cap. Metadata is untyped.

## 10. Reuse
Apache-2.0: copy with credit. Candidates: the `finalization_reserve` idea, the stream wrapper that records usage in a `finally` (`_patch.py:111-190`), the soft-limit-once flag.

## 11. Verdict: ADAPT (idea only), do not adopt the ledger
Copy: (1) streaming usage capture that survives early break; (2) `would_exceed(estimate)` as a pre-call probe; (3) finalization reserve so a run can write its summary.
Avoid: (1) post-call recording as "enforcement"; (2) loop keys on name only; (3) dropping unpriced calls silently.
Missing for the Desk: any link from a cost event to an outcome, and any forecast.
