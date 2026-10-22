# Profile: NVIDIA-NeMo/Guardrails

Licence: Apache-2.0 per `LICENSE.md:2` (the GitHub API reports NOASSERTION because of the file name). Last commit read: 2026-10-20T07:40Z. Stars 7,333 (2026-10-20). Reader: Claude Sonnet, 2026-10-20. Read through the GitHub API and raw files, no clone. Repository has 2,801 files; read: rail outcome type, self-check input and output rails, tool-call rail, violation types, one example config.

## 1. What it is
A toolkit of "rails" (checks before and after a model call, and around tool calls) configured in YAML plus a flow language (Colang). It decides allow, block or transform; it does not meter money.

## 2. Architecture map
`nemoguardrails/actions/rail_outcome.py` (the verdict type), `library/*` (self_check, jailbreak_detection, sensitive_data_detection, hallucination, tool_safety_check, policyai), `guardrails/iorails.py` (newer engine with parallel rails), `guardrails/actions/tool_call_action.py` and `tool_result_action.py`, `colang/` (two language versions and runtimes).

## 3. Features and how each behaves
Config lists rail flows by stage: `rails.input.flows`, output, tool_call, tool_result, each with a `parallel` switch (`iorails.py:886-889`; `examples/configs/jailbreak_detection/config.yml:14-17`). A self-check rail asks an LLM with a task prompt whether input is allowed; an empty input is blocked (`library/self_check/input_check/actions.py:76-77`). On block the flow either raises a typed exception if `enable_rails_exceptions` is set, or the bot says a refusal, then aborts (`input_check/flows.co:4-9`).

## 4. How people use it
Write `config.yml` and Colang files, load `RailsConfig`, call generate. Usage evidence beyond the repo: NOT VERIFIED.

## 5. Mechanism for the Desk
Verdict type: `RailOutcome{decision, reason, metadata, transforms, failed}` with decision ALLOW, BLOCK or TRANSFORM and nothing else (`rail_outcome.py:50-55, 80-92`). Invariants enforced in `__post_init__`: transforms non-empty if and only if TRANSFORM; `failed` only on BLOCK (`:106-114`). The docstring states "A BLOCK always means stop; there is no soft-block flag" and that rendering (exception, message, language) is not part of the decision (`:37-39`). A rail that raises is converted into `RailOutcome.failure`, a BLOCK with `failed=True`, so a crash fails closed and is distinguishable from a real refusal (`:147-160`; `tool_rail_action.py:67-83`).
Tool-call rail: local, no model call. Every call must name a tool in the declared toolset and its arguments must satisfy that tool's JSON Schema; every failing call is reported (`tool_call_action.py:40-85`). Violations carry a machine-readable type (18 values, for example tool_not_allowed, arguments_invalid), the tool name, call id, a JSON Pointer to the failing argument and the failing schema keyword, and "never contain argument values or tool-result content" (`options.py:120-174`). Callers switch on the type, never on the text.
Lessons for a spend policy: (1) a typed decision with a separate "the checker itself failed" bit; (2) per-violation structured evidence with a pointer to the exact field; (3) deterministic structural checks before any LLM check; (4) a budget could be expressed as a tool-call rail over `{tool, estimated_cost}` arguments.
Missing for the Desk: no concept of money, tokens, quota or a window (grep of the file list for budget, spend, cost outside tests and docs found none); no human approval step (decisions are allow, block, transform; an ask-a-human outcome does not exist); no signed or hash-chained record of decisions; no check that a config edit only tightens rails. The logging module (`logging/processing_log.py`, `explain.py`) was listed, not read.

## 6. Agent patterns
Sequential rails around one model call; parallel mode runs input rails alongside generation (`iorails.py:1403`). A failed rail blocks. No planner or critic.

## 7. Model and data layer
Rails that need a model call a configured LLM through a task manager; the tool rails are model-free (`tool_rail_action.py:60-61`). Cost of the rail LLM calls is not tracked by the rail.

## 8. Hackathon-care checks
Needs a model key for LLM rails; tool and structural rails run offline. Telemetry spans per action (`tool_rail_action.py:79`). Honest numbers: none read.

## 9. Traps seen
An LLM judge as the gate is non-deterministic and can be talked round (prompt-injection exposure NOT VERIFIED here). Two engines (Colang and IORails) with partial feature overlap: unsupported flows are routed, not rejected (`iorails.py:494, 815`). Colang is a second language to learn and test.

## 10. Reuse
Apache-2.0: may copy with credit. The verdict type is small enough to rebuild in TypeScript in under 100 lines.

## 11. Verdict: ADAPT (the verdict and violation model only)
Copy: (1) the three-way verdict with the `failed` flag so a crash is a block and is labelled; (2) violation records keyed by type with a JSON Pointer and schema keyword and no payload values; (3) structural allowlist plus schema check before any model check.
Avoid: (1) an LLM self-check as the sole gate on money; (2) two engines with different feature sets; (3) decisions that vanish after the call, with no durable record.
