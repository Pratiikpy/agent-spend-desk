# Profile: zenml-io/kitaru (recorded sessions replayed against a swapped model, prompt or code)

Reader: Claude Sonnet, 2026-10-20. Search record: `gh search repos kitaru` returned `zenml-io/kitaru` ("Agent traces you can run, not just read.", 310 stars). Remote read only, nothing run. The replay and evaluation contracts were read; the server and most adapters were not. Paths are relative to the repository root; line numbers are from files as fetched on 2026-10-20.

## 1. What it is
Replay-based evals for agents: record or import production runs as sessions, replay them against a new model, prompt or code version, and compare evaluations, cost and tokens before shipping (README.md:10, :35-43). Self-hosted, from the ZenML team. Licence: Apache-2.0 (LICENSE:1-5), read first. Stars 310, pushed 2026-10-20. Last commit read: e7e55f7, 2026-10-08.

## 2. Architecture map
A server (FastAPI plus Postgres) holds sessions, nodes, replays, evaluations, cohorts, experiments; **workers run in the user's environment** and execute replays and evaluators (README.md:125-127). Adapters wrap PydanticAI, LangGraph, OpenAI Agents, Claude Agent SDK, Mastra, Vercel AI SDK (:112-121); importers read Langfuse, LangSmith, Braintrust, Logfire, Phoenix, MLflow (:41).

## 3. Features and how each behaves
A replay takes a baseline session, an optional agent version, override and tool policy, and at least one evaluator (api_models/v1/replay.py:69-94). A "fork" is a replay that carries an override (docs/book/concepts/replay.md:68). SDK retries are idempotent; a manual CLI re-run is not (docs/book/guides/replay-and-overrides.md:35).

## 4. How people use it
`kitaru login --local`, wrap or import, then an assistant-driven investigation skill (README.md:47-108). Usage by others: NOT VERIFIED.

## 5. Mechanism for the Desk

**Recorded-session format.** A session is nodes of type `llm_call, tool_call, subagent_call, span`, each with parent link, status, error, timings, inputs, outputs, `requested_model` and served `model`, `tokens`, `cost`, `model_params`, `tool_name` and a tool `cache_key` (api_models/v1/session_node.py:34-40, :62-122, :231). Tokens are input, output, cached, reasoning, rolled up per session (docs/book/guides/llm-calls.md:8-13). In the PydanticAI adapter cost is priced at call time from the `genai-prices` table by model, provider and request timestamp, or by a user calculator, and each node is stamped `status: estimated | unavailable | disabled` plus `source` (plugins/packages/pydantic-ai/src/kitaru_pydantic_ai/capability.py:398-445).

**What replays deterministically.** Only **tools**. Replay re-runs the agent's real code from the top (docs/book/concepts/replay.md:87). Model calls are not served from the recording: the adapter swaps the model and calls the real one, and history is consulted only for tools (capability.py:668-703, :782-835), so a replay spends real tokens. A tool key is `sha256(name, NUL, canonical JSON inputs)`, or none if the inputs are not JSON (cache_keys.py:21-45). Repeated identical calls get recorded results in order; past the last is a miss (docs/book/guides/tool-policies.md:92). Matching is guaranteed only within one adapter (:84).

**Tool policy.** Per tool or default: `history` (scope baseline, cohort version or agent; `on_miss` fail, passthrough or error_result), `static`, `passthrough`, `llm` (api_models/v1/replay_config.py:28-126). **With no policy the default is passthrough**: a replayed `refund_payment` "refunds the card again" (replay-and-overrides.md:105).

**Swapped-model replay and how it is judged.** `override.model` swaps one model or an old-to-new map; `system_prompt`, `prompt`, `model_params` are the other knobs (replay_config.py:51-61). Discipline: observed, an **unchanged** replay that must reproduce it ("if this does not hold up ... stop"), then a fork with one change (replay-and-overrides.md:41-45). That reproduction check is advice; no automatic gate was found. A new tool path hits `on_miss`: `fail` stops, `error_result` lets the agent respond and an evaluator assess it (tool-policies.md:68). Judging is by versioned evaluators writing typed rows (score, bool, string, categorical, `passed`, explanation) (docs/book/concepts/evaluators.md:14-64). The ten built-in ones are deterministic and descriptive, leaving `passed` unset (deterministic-evaluations.md:26). Human labels are rows too, and an evaluator is calibrated against them before it may gate (evaluators.md:66-88). An experiment replays an immutable cohort: "numbers average, booleans count into pass rates"; a failed replay fails the run so "the numbers never silently shrink their denominator" (experiments.md:99-101; regression-suite.md:64).

**Honest limits.** The docs' example "held on 18 of 20 tickets and cut cost 41%" is illustrative, not a result (experiments.md:99). Recorded cost "is an observability number ... not an invoice ... Treat deltas as reliable and absolute values as estimates" (llm-calls.md:60). Nothing found on repeated runs, variance or significance for live model calls (grep of docs, 2026-10-20): NOT VERIFIED. LangGraph replay is conditional on construction path (GAPS.md:285-289). Importer-backed adapters cannot replay with overrides or policies (docs/book/concepts/agents-and-sessions.md:51, :65).

**For the Desk.** The closest existing product to "replay last month's tasks on a cheaper route", and proof the claim is real engineering: replays spend real tokens, tool paths diverge, quality needs evaluators plus human calibration. Better for the Desk: report pass rate **with an interval and repeat count**, price both sides from one versioned table, and show how many tasks were actually comparable (no divergence) so the buyer sees the real sample.

## 6. Agent patterns
An assistant-driven investigation loop (README.md:96-108); replays are not agentic.

## 7. Model and data layer
Provider-agnostic via adapters; judge evaluators call a model and need a provider connection (evaluators.md:12, :49).

## 8. Hackathon-care checks
Heavy: server, Postgres or Docker, a worker (README.md:59-66). Live replay needs provider keys; checked-in traces and deterministic evaluators need no model (README.md:87).

## 9. Traps seen
Passthrough default; reproduction check left to the user; cost deltas with no variance; history matching varies by adapter.

## 10. Reuse
Apache-2.0: may reuse with credit and notice. The contracts are the value; the stack is too heavy to adopt whole.

## 11. Verdict: ADAPT
Copy: (1) the three-session discipline as an automatic gate that withholds a verdict when reproduction fails; (2) per-tool policy (`history`, `static`, `passthrough`) with explicit `on_miss`, defaulting to the safe choice; (3) priced-at-call-time cost stamped `estimated/unavailable` with its source.
Avoid: (1) passthrough as default; (2) cost deltas with no repeat count or interval; (3) a server-plus-worker footprint for a judge's demo.
