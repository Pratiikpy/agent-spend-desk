# Prior-art teardown 06: orchestration and unified multi-agent systems (Track 3, Reasoning Architecture)

Date of review: 2026-10-13. Scope: seven clones under `research/track-3-reasoning-architecture/unified-all-three-tracks/`.
All paths below are relative to that folder unless they start with `docs/`.

## How this was done, and what it does not cover

- Method: static reading of source, prompts and configuration, plus targeted `grep` for the absence of features.
  **No third-party code was run, installed or modified.** Every behavioural claim comes from reading code, not from executing it.
  Claims marked **NOT VERIFIED** need execution, or a source that is not in the clone.
- "No X found" means a search of the named files or the whole clone returned nothing. It is a negative finding with the search stated, not proof of absence.
- Read in depth:
  `ClinicalAgents-Code/{med_orchestrator,mcts_state,mcts_search,mcts_config,state_memory}.py` and the call-LLM and parse helpers in `utils.py`;
  `TradingAgents/tradingagents/{graph/*,agents/{state,schemas,structured,rating,post_screen}.py,agents/managers/*,agents/risk_mgmt/conservative_debator.py,agents/analysts/turn.py,memory/{log,settlement}.py,default_config.py}`;
  `FinRobot/finrobot_desktop/finrobot/{engine/pipelines/{step,runner,validators}.py,artifact/contract.py,engine/models/numeric_claim.py,engine/agents/{factory.py,instructions/*.md},audit/transcript.py,routes/runs.py}`;
  `langgraph/libs/langgraph/langgraph/{types,errors}.py`, `pregel/{_loop,_algo,_retry,main}.py`, `libs/checkpoint/langgraph/checkpoint/base/__init__.py`;
  `crewAI/lib/crewai/src/crewai/{flow/runtime/__init__.py,flow/human_feedback.py,state/checkpoint_config.py,task.py,tasks/hallucination_guardrail.py,telemetry/constants.py}` and `lib/crewai-core/src/crewai_core/telemetry.py`;
  `autogen/python/packages/{autogen-agentchat/src/autogen_agentchat/{conditions,teams/_group_chat},autogen-core/src/autogen_core/{_intervention.py,_telemetry},autogen-ext/src/autogen_ext/models/cache}`;
  `openai-agents-python/src/agents/{run_config,run_state,guardrail,tool_guardrails,retry,exceptions,agent_output}.py`, `tracing/{processors,provider}.py`.
- **Not read or not covered:** `langgraph` `libs/{cli,sdk-py,sdk-js,checkpoint-postgres}` and docs/examples; `crewAI` `crew.py` beyond grep (hierarchical manager behaviour), `lib/crewai-tools`, `a2a/`, memory and knowledge subsystems;
  `autogen` `dotnet/`, `autogen-studio`, `autogen-magentic-one`, `agbench`; `openai-agents-python` `sandbox/`, `realtime/`, `voice/`, `mcp/`, session backends;
  `FinRobot` `finrobot_desktop/desktop` (Tauri/React), the 32 compute operators beyond the audit ones, the 56 skills; `TradingAgents` `cli/`, data vendors, `backtest.py` results.
  No paper, benchmark number or README performance claim was reproduced.
- Reuse stance: `ClinicalAgents-Code` has **no licence file**, so it is studied only and described in our own words; nothing from it is to be copied.
  TradingAgents and FinRobot are Apache-2.0 (reuse needs the licence text and notice, and FinRobot carries a trademark policy); we still re-implement ideas rather than copy code.

---

## 0. Summary table

| Repo | Licence (file in clone) | Commit (date) | One-line verdict |
|---|---|---|---|
| `ClinicalAgents-Code` | **None** (no licence file) | `e7dbd15513235e388cbb0dc0afafdfcbacefe420` (2026-08-10) | Best-designed code-enforced action mask, immutable snapshots and rollout budgets in the set. Not runnable as shipped (config and experience-memory modules missing). No crash resume, no trace of "why". |
| `TradingAgents` | Apache-2.0 (`TradingAgents/LICENSE`) | `1394a3f72aa4393e1a98f51b382434c4b4c2d972` (2026-10-03) | Clean LangGraph application with typed final outputs and outcome-settled memory. **There is no risk-manager veto in code**; the "risk manager" is a prompt. |
| `FinRobot` | Apache-2.0 (`FinRobot/LICENSE`, `NOTICE`, `TRADEMARK_POLICY.md`) | `2717499b8e30f242640af08c4ad9afd1113c2d45` (2026-09-28) | The only repo with real code-enforced output gates (step validators, derived-key rollback, persist-boundary contract). The advertised bull/bear/judge debate has prompts but **no code in this checkout**. |
| `langgraph` | MIT (`langgraph/LICENSE`) | `afbe7e48b17f62e139b5c6337ab934549e6dc73b` (2026-10-12) | Strongest durable-execution core (checkpoints, pending writes, interrupts, time travel). Default recursion limit is effectively unbounded; no token budget; no LLM record/replay found. |
| `crewAI` | MIT (`crewAI/LICENSE`) | `c0eda9f53889fb38d0352e2c9a738c653ab811b3` (2026-10-13) | Broadest feature surface (Flow DSL, checkpoint and fork, human feedback). Two hidden-nondeterminism sources (first-wins racing listeners, LLM-collapsed feedback routing) and default-on external telemetry. |
| `autogen` | Docs CC-BY-4.0 (`autogen/LICENSE`), code MIT (`autogen/LICENSE-CODE`) | `027ecf0a379bcc1d09956d46d12d44a3ad9cee14` (2026-04-06) | **Maintenance mode** per its README. Good termination-condition algebra, message intervention handlers and vendor-neutral OpenTelemetry. Token cap is soft. |
| `openai-agents-python` | MIT (`openai-agents-python/LICENSE`), v0.23.1 | `f53c62451c7f34c15f0c87fa745e05404025420f` (2026-10-13) | Best human-approval and guardrail ergonomics, versioned `RunState` snapshots. Default-on trace upload to the vendor; no token budget; routing by handoff is LLM-chosen. |

Cross-cutting findings that drive section 9:

1. **Only ClinicalAgents enforces a state-dependent action mask in code**, and only FinRobot gates final output in code. Nobody enforces both.
2. **No repo has a hard token or cost budget.** AutoGen's is checked after the tokens are spent. (Searched: `UsageLimits`, token and budget terms across TradingAgents, FinRobot, langgraph, openai-agents.)
3. **No repo records and replays LLM calls as a first-class mode.** langgraph, crewAI, openai-agents and FinRobot have scripted test doubles or event replay for observers. AutoGen has a response cache. None gives byte-identical re-execution of a past run.
4. **No repo makes a per-decision "why" a required field.** Rationale lives in free-text debate transcripts, prompts or log lines.
5. **Two vendors export traces by default** (crewAI, openai-agents). AutoGen is the only one that is vendor-neutral by default.

---

## 1. ClinicalAgents-Code

### 1.1 What it is
Research code for the KDD 26 paper "ClinicalAgents: Multi-Agent Orchestration for Clinical Decision Making with Dual-Memory" (README is two lines). About 6,300 lines of Python: an orchestrator (`med_orchestrator.py`, `MedOrchestrator`), five clinical agents (`agents/`: referral, doctor, imaging, diagnosis, treatment), an MCTS planner (`mcts_search.py`, `mcts_state.py`, `mcts_config.py`), a JSON working memory (`state_memory.py`) and a benchmark harness (`main.py`). It simulates a patient from a ground-truth case record, so it is a benchmark rig, not a deployable agent.

**It cannot run as shipped.** `med_orchestrator.py`, `mcts_config.py`, `mcts_state.py`, `state_memory.py`, `utils.py` and `main.py` import `app_config`, and the orchestrator imports `experience_memory`; neither module is in the clone (directory listing and grep). The second memory of the "dual-memory" design is therefore not inspectable; only its call sites are (`MedOrchestrator._run_rag_retrieval`, the `ExperienceMemory(...)` construction with held-out case ids and dataset fallback disabled).

### 1.2 Orchestration model
- **Shape:** a bounded decision loop, not a static graph. `MedOrchestrator.run` repeats until `mcts_step` reaches `eta` (default 4 in `StateMemory._default_state`; the configured constant is in the missing `app_config`). Each iteration: snapshot, detect missing evidence (LLM), search for the next action, execute it, maybe backtrack.
- **Action space** (`ACTION_SPACE`, 8 entries): `task1_referral`, `task2_doctor`, `task3_imaging`, `task4_diagnosis`, `task5_treatment`, `a_rag`, `a_back`, `a_term`.
- **Branching = code mask plus search.** `mcts_state.filter_valid_actions` is a pure function of state that removes impossible actions: no department means no doctor, imaging, diagnosis or treatment; no hypotheses means no imaging, diagnosis or treatment; no pending exams means no imaging; no diagnosis means no treatment; completed tasks are removed; `a_rag` only if experience memory exists; `a_back` only if there is missing evidence, an eligible earlier snapshot, recheck budget left and at least two steps of horizon left; once diagnosis and treatment exist only `a_term` remains. `MCTSSearch.search` then ranks the survivors: an LLM prior (`_score_actions`) picks Top-K, then N_sim round-robin rollouts with PUCT-style selection (`_paper_puct_score`, `_select_root_action`). Rollout transitions are produced by a *second* LLM.
- **State schema:** one flat dict, `StateMemory._default_state` (case fields, `task_status`, exam lists, `hypothesis_illness`, `recheck_total`/`max_recheck`, `mcts_*` counters, `mcts_snapshots`, `terminated_by`). No types, no validation beyond `_ensure_state_defaults` back-filling missing keys. Every `get`, `update` and `set` re-reads or rewrites the JSON file (`_load`, `_save`), so the file is always current, and two concurrent runs sharing a path would corrupt each other.
- **Retries:** none at the LLM-call level (`utils.call_llm_api` makes one attempt and raises `RuntimeError`). The clinical "recheck" is a bounded re-diagnosis loop: `_execute_task4_diagnosis` calls itself after fetching suggested exams, gated by `StateMemory.increment_recheck` and `_has_recheck_budget`.
- **Human-in-the-loop:** none.
- **Checkpoint/resume:** in-run only. `mcts_state.append_snapshot` stores immutable deep copies with stable ids; `resolve_backtrack_snapshot` resolves an LLM's backtrack request by id and refuses to degrade an unknown id into a positional guess; `recover_snapshot_state` restores clinical state while *preserving* history, step counters, snapshot list, recheck counters and budgets (the "monotonic" fields). A crash cannot be resumed: `_initialize_memory` calls `StateMemory.initialize`, which overwrites the state file.
- **Budgets:** `eta` (action horizon); `mcts_rollout_call_cap_per_search` and `..._total`; `max_recheck`; per-call `API_TIMEOUT` and `LLM_MAX_TOKENS` on every call. `MCTSSearch.search` raises `ValueError` if the per-search cap cannot fund a fair Top-K by N evaluation, and `run` stops with `terminated_by = "rollout_budget"` rather than run biased partial rollouts. No wall-clock budget; no token or cost budget.

### 1.3 Tracing and replay
- Console prints only; the clone's log lines have been replaced by a placeholder string ("log omitted"), so the human-readable trace is gone.
- Structured evidence that remains in state: `mcts_trajectory`, `workflow_action_history` (sequence index, action, source, stage), `backtrack_events`, `terminated_by`, and `MCTSSearch.last_search_stats` (children with visit count, Q value, prior).
- Per-case LLM usage tracker in `utils.py` (`start_case_llm_tracking`, `llm_phase`) feeds `main.build_orchestration_usage_summary`: call counts by API tag, base versus recheck phase, rollout calls, errors, with `schema_version` "1.1".
- **No per-decision "why".** The backtrack LLM returns a JSON decision, but its reasoning is not stored as a trace field.
- **Replay: no.** LLM temperature comes from the missing config; there is no cassette; MCTS rollouts are LLM-simulated.
- **Hidden nondeterminism found:** `list(set(...))` over strings when merging predicted exam lists in `_execute_task4_diagnosis`. Python's per-process string hash randomisation makes that iteration order differ between runs. Seen in code, not executed.

### 1.4 Guardrails and validation
`utils.parse_json_from_response` strips code fences and falls back to the first `{...}` or `[...]` match, returning `None` on failure; callers treat `None` as "use a default". Exams are checked against whitelists (`VALID_PHYSICAL_EXAMS`, `VALID_AUXILIARY_EXAMS`) and matched to the case record. `_detect_missing_evidence` fails closed (raises on invalid JSON). `_ensure_hypothesis_format` silently asks an LLM to *invent* confidences when hypotheses arrive as bare names (`_infer_hypothesis_confidence_with_llm`), a silent LLM fallback we should not copy. No typed schemas.

### 1.5 Pattern: dual memory, gates, veto
- **Dual memory** (as far as the code shows): a working memory (`StateMemory`) and a frozen experience memory of guidelines and prior cases (`ExperienceMemory`, module absent) that excludes held-out case ids to stop benchmark leakage.
- **Distinct-model rule enforced in code:** `MedOrchestrator._assert_distinct_rollout_model` raises `ValueError` at construction if the simulation model equals the acting model (after normalising provider prefixes). This is a good, cheap structural check against self-grading.
- **Gates:** what is *permitted* is decided by code (`filter_valid_actions`, `_has_recheck_budget`, `_has_mcts_action_budget`, `_should_backtrack_after_action`, a confidence cut-off of 0.85 in `_should_recheck_with_llm`). Whether evidence is *missing* is an LLM judgement (`_detect_missing_evidence`). There is no veto on the final diagnosis; `force_finalization` makes the run commit to the top hypothesis (`_finalize_current_diagnosis`).

### 1.6 Licence and commit
No licence file, so default copyright applies: no reuse. Commit `e7dbd15513235e388cbb0dc0afafdfcbacefe420`, 2026-08-10, message "upd".

### 1.7 ADOPT / BEAT
- **ADOPT (ideas, own implementation):** state-derived action mask as a pure function; immutable snapshots with stable ids and a restore that preserves monotonic counters so a rewind cannot refund a budget; budget checks that fail loudly rather than degrade fairness; construction-time check that judge and author models differ; per-run usage ledger split by phase.
- **BEAT:** typed state with validation; resume after a crash; a required `why` on every decision; deterministic merge order; no silent LLM defaults; a trace that survives (this one was stripped). Do **not** adopt LLM-simulated MCTS wholesale: each search costs Top-K by N_sim extra model calls and its rollouts are non-deterministic, which collides with the organizers' 5 to 10 minute target and our replay requirement. Whether it improves decisions beyond the paper's claim is NOT VERIFIED.

### 1.8 NOT VERIFIED
It has never been run (missing modules and datasets). Paper results not reproduced. Defaults for K, N_sim, D, rollout caps and temperature live in the missing config. Whether the experience memory prevents leakage cannot be checked because the module is absent.

---

## 2. TradingAgents

### 2.1 What it is
A multi-agent trading research framework built **on top of LangGraph** (`pyproject.toml`: `langgraph>=1.2.12`, `langchain-core`, `langgraph-checkpoint-sqlite`). Roles: four analysts, bull and bear researchers, a research manager, a trader, three risk analysts, a portfolio manager. Python 3.11, about 10,000 lines in `tradingagents/`, a CLI, and a test suite (`tests/`, dozens of files; not executed here).

### 2.2 Orchestration model
- **Graph** (`tradingagents/graph/setup.py`, `GraphSetup.setup_graph`): `START` fans out to the selected analysts (each its own compiled subgraph, `_analyst_graph`) and a `Memory Log` node in parallel; the list-form `add_edge(first_steps, "Bull Researcher")` is the fan-in join. Then Bull and Bear alternate through conditional edges (`ConditionalLogic.should_continue_debate`) until `count >= 2 * max_debate_rounds`, then `Research Manager`, `Trader`, then Aggressive, Conservative, Neutral rotate (`should_continue_risk_analysis`) until `count >= 3 * max_risk_discuss_rounds`, then `Portfolio Manager`, `END`.
- **State** (`agents/state.py`): `AgentState(MessagesState)`, a `TypedDict` of strings (reports, plans, ratings) plus two nested `TypedDict`s, `InvestDebateState` and `RiskDebateState`, whose debate histories are **concatenated strings** with a `count`. No reducers beyond the messages channel; analysts avoid write conflicts by returning only their own report key (`_analyst_graph` builds an `output_schema` with a single key).
- **Branching:** routers return node names. A past crash class is recorded in code: `DEBATE_PATH_MAP` and `RISK_ANALYSIS_PATH_MAP` list every possible target so a router cannot return an unmapped label (issue #1088).
- **Retries:** delegated to the provider SDK (`llm_max_retries` passed through `llm_clients/factory.py`). One application-level retry exists: if a structured-output call fails, `agents/structured.invoke_structured` returns `None` and the caller re-asks as free text. `agents/post_screen.system_one` has its own 3-attempt exponential backoff with jitter and `Retry-After` handling, for an optional third-party screening service.
- **Human-in-the-loop:** none in the graph.
- **Checkpoint/resume** (`graph/checkpointer.py`, `trading_graph.py`): optional (`checkpoint_enabled`, default `False`), per-ticker SQLite via LangGraph's `SqliteSaver`. `thread_id` is a hash of ticker, date and a **run signature** (`_run_signature`): selected analysts, debate and risk depth, asset type, a portfolio fingerprint, layout markers and a SHA-256 digest of the whole config except paths and retry settings. A resume under different settings therefore starts fresh instead of continuing a stale graph. Resume is `invoke(None)`; the checkpoint is deleted on success (`clear_checkpoint_on_success`).
- **Budgets:** `max_debate_rounds` and `max_risk_discuss_rounds` (both default 1), `max_recur_limit` 100, `max_tool_rounds` 20 per analyst, optional `max_tokens` and `temperature` passthrough. The constructor checks `2 * max_tool_rounds + 2 < max_recur_limit`. When an analyst uses all its tool rounds the graph routes to a `wrap_up` node that calls the model **without tools** and ends the analyst (`analysts/turn.take_turn`, `WRAP_UP`), so a model that keeps calling tools cannot reach the recursion limit (#1420). No wall-clock or token/cost budget found in `default_config.py` or `llm_clients/factory.py`.

### 2.3 Tracing and replay
- A LangChain callback (`cli/stats_handler.StatsCallbackHandler`) counts LLM and tool calls for the CLI. Final state is written to `full_states_log_<date>.json` (all reports, both debate histories, plans, final decision, and an allow-listed `run_settings` that excludes keys, endpoints and paths) and rendered to markdown and HTML (`reporting.py`, `report_html.py`).
- The memory log (`memory/log.py`) is an append-only markdown file of `[date | ticker | rating | pending]` entries, idempotent per ticker and date, file-locked. `memory/settlement.py` later scores each decision against a benchmark (raw and alpha return over a holding window), asks the model for a reflection, and the Portfolio Manager reads those lessons. A point-in-time filter (`_memory_as_of`, #1251) stops a historical run seeing lessons that were not yet resolved by its trade date.
- **No per-decision "why" field**; the debate text is the rationale. **Replay: no.** Temperature defaults to `None`, there are no seeds, and the data layer is live (the repo has look-ahead tests, `tests/test_fundamentals_lookahead.py`, `tests/test_date_boundaries.py`, which reduce but do not remove drift). Checkpoint resume re-uses completed node outputs; it is not re-execution.

### 2.4 Guardrails and validation
Pydantic schemas with provider-native structured output (`agents/schemas.py`): `ResearchPlan`, `TraderProposal`, `PortfolioDecision`, `SentimentReport`, each rendered back to markdown (`render_*`). Defensive coercion for model slop: `_coerce_optional_float` turns "N/A", "15%" or "150-160" into `None` instead of failing the whole decision. Rating handling (`agents/rating.py`): a strict label parser that returns `REVIEW` (never `Hold`) when the rating is missing or ambiguous, because "a decision nobody can read is not a Hold" (#1170). That sentinel is the repo's one fail-safe on output.

### 2.5 Pattern: bull/bear, risk manager, memory, and the veto
- **Bull/bear debate:** alternating prompts, capped by a counter in code; the Research Manager (the "deep" model tier) emits a structured `ResearchPlan` with a five-tier recommendation.
- **Risk team:** a three-way rotation (aggressive, conservative, neutral) judged by the Portfolio Manager.
- **Is there a veto? No.** `agents/managers/portfolio_manager.py` builds one prompt from the research plan, the trader proposal, the risk debate and past lessons, and calls the model for a `PortfolioDecision`. Its rating is stored as `final_rating`. Nothing compares it with the Trader's action, caps position size, enforces the Trader's `stop_loss` (an optional float no code reads back), or lets the risk team block anything. A search of `tradingagents/` and `cli/` for veto, override, reject, risk limit, max position and guardrail found no such logic. The only code-enforced controls are the round counters, the tool-round cap, schema validation and the `REVIEW` sentinel. **The "risk management veto" is prompt-level only.**
- **Memory:** a single decision-and-reflection log, not a dual memory.

### 2.6 Licence and commit
Apache-2.0. Commit `1394a3f72aa4393e1a98f51b382434c4b4c2d972`, 2026-10-03, "Merge pull request #1478 from TauricResearch/v0.6.0".

### 2.7 ADOPT / BEAT
- **ADOPT:** fan-out where each parallel worker owns a private history and returns only its own key; total path maps so a router cannot return an undeclared target; a code-enforced "stop calling tools, write the answer" turn instead of a prompt hope; a checkpoint identity that hashes everything that changes the graph; `REVIEW`-not-`Hold` for unreadable output; outcome-settled memory with a point-in-time filter and idempotent writes; allow-listed run settings in saved logs.
- **BEAT:** a real code gate between proposal and decision; typed debate state instead of concatenated strings; wall-clock and token budgets; a `why` per decision; deterministic replay; budgets that count retries.

### 2.8 NOT VERIFIED
Not run. Trading quality and the README's performance claims were not examined. No wall-clock budget exists in the files searched; timeouts may be set by provider defaults (`llm_clients/*` only forward a `timeout` kwarg). Behaviour when a provider lacks structured output was read, not exercised. Cost per run unknown.

---

## 3. FinRobot

### 3.1 What it is
Three generations in one repo (README "Where to start"): **V0** `finrobot_autogen/` (AutoGen group chats; `agents/workflow.py` sets `human_input_mode="NEVER"` and `max_consecutive_auto_reply=10`), **V1** `finrobot_equity/` (OpenAI Agents SDK `Runner.run` in `core/src/modules/equity_agents/agent_manager.py`), and **V2** `finrobot_desktop/` (PydanticAI, FastAPI, SQLite, Tauri), which the README calls the production system. This teardown is about V2.

### 3.2 Orchestration model
- **Shape:** a *Lead Agent* (`engine/orchestrator.create_lead_agent`, a PydanticAI agent whose tools wrap pipelines, built by `_make_pipeline_tool`) hands off to **code-enforced pipelines**: `Pipeline` in `engine/pipelines/runner.py` is an ordered list of `PipelineStep`s executed by plain Python. Seven pipelines: equity research, DCF, comps, LBO, DDM, earnings, IC memo.
- **Step contract** (`engine/pipelines/step.py`, `PipelineStep`): `name`, `agent`, `validator`, `executor`, `required_data`, `skill_section`, and three fields worth stealing:
  - `critical`: failure after retries raises `PipelineStepError` and aborts the run (hard prerequisites such as data collection).
  - `deterministic`: the executor is a pure function, so a validation failure skips the re-prompt loop (re-running yields identical output, burning the budget for nothing; BUG-059 in the comment).
  - `derived_keys`: sibling state keys built from the same output; if the output is rejected they are rolled back with it.
- **State:** `results` (prose per step) and `structured_results` (typed objects per step) dicts, plus `failed_validations` and `run_warnings`, assembled into `PipelineResult` (`engine/pipelines/result.py`).
- **Branching:** essentially none; the topology is a fixed list. Variation is by pipeline choice and by degrade behaviour.
- **Retries** (`Pipeline._run_step`, `max_retries = 3`): execute, store, validate; on validation failure re-prompt with the validator's error. A *separate* exception-retry path handles recoverable errors (fixed delays 2, 5, 10 s, `_RETRY_DELAYS`) without consuming the validation budget. Error classification is by **substring of the exception text** (`_RECOVERABLE_SUBSTRINGS` such as "429", "timeout"; `_FATAL_SUBSTRINGS` such as "insufficient balance", "context_length_exceeded", "invalid api key"). Fatal errors abort regardless of `critical`; a non-critical step otherwise **degrades**: the rejected structured output and its `derived_keys` are popped, the failure is recorded, the run continues, and the UI shows an amber "degraded" marker (BUG-058).
- **Human-in-the-loop:** none in pipelines. Chat skills carry "interactive checkpoint" phrases (`engine/skills/pipeline_methodology.py`), which are prompt-level.
- **Checkpoint/resume:** none at step level found. The SSE stream supports `Last-Event-ID` reconnect (`routes/runs.py`); `cancel_run` cancels a live task and finalises orphaned records. Finished runs are saved as versioned artifacts with lineage (`parent_artifact_id`, `source_artifact_id` for re-runs).
- **Budgets:** per-step retries; an app-wide run semaphore (`deps.run_semaphore`, acquired once in `Pipeline.execute`); prompt-size budgets with progressive re-compaction (`_PROMPT_MAX_*`); HTTP timeouts in `config.py`. A search for `UsageLimits`, `usage_limits` and `request_limit` found nothing, so **no token or cost cap**, and the lead agent's tool loop is bounded only by PydanticAI defaults (not inspected).

### 3.3 Tracing and replay
- `audit/transcript.py`: append-only per-session JSONL in a per-user sessions directory, mode 0600, event kinds `user_msg | assistant_text | tool_call | tool_result | error | session_start | session_end` with `timestamp`, `session_id`, `data`. It **scrubs credentials** (key=value shapes, `Authorization: Bearer`, bare `sk-` keys) before writing and caps retention at 500 sessions (`audit/persistence.py`).
- Run events are persisted with sequence ids for SSE resume. Replay here means *reading a transcript*, not re-executing. Unit tests use PydanticAI's `FunctionModel` and `TestModel` (`tests/unit/test_orchestrator.py`).
- A different, valuable trace: the **numeric-audit ledger** (`engine/models/numeric_claim.py`): each number that reaches a report is a `NumericClaim` with value, currency and period, provenance, and `Finding`s of severity `info | review | blocked_field`.

### 3.4 Guardrails and validation (the strong part)
- Typed models for every result (`engine/models/financial.py`), validators per step (`engine/pipelines/validators.py`, 689 lines), six audit operators (`engine/compute/operators/audit/`: currency caliber, EV bridge, narrative divergence, narrative-to-number grounding, sector sign, TTM period).
- **Persist-boundary contract** (`artifact/contract.py`, `enforce_artifact_contract`, called in `Pipeline._execute_steps` before `artifact_store.save`): pure clauses C1 (headline target versus market within a calibrated band), C1b (methods corroborate each other), C2 (malformed amount), C3 (basis matches headline), C4 (currency), C6 (soft disclosure), C7 (no resurrection of a withheld number). A hard violation **withholds the value, keeps the verdict**: it nulls every slot the headline could hide in (`_scrub_headline_slots`), sets `valuation_withheld` with a reason, neutralises the tagline, appends `[CONTRACT/*]` warnings. It never raises (an exception would blank the whole run). The design comments say explicitly that the old "REVIEW, refuse to rate" state was removed.
- Data-agent tool inputs are validated (`validate_ticker`, `ModelRetry` on an unknown data type), news headlines are flattened and wrapped as untrusted text, and numbers come from one canonical, provenance-stamped contract (`engine/agents/factory.py`).
- Stated principle (README): numbers are code-calculated, narrative is LLM-assisted, every output is provenance-tracked.

### 3.5 Pattern: bull/bear/judge, and how gating is enforced
- **Advertised:** nine agents including `bull`, `bear`, `judge` (README, `finrobot_desktop/README.md`). **In this checkout:** `engine/agents/factory.py` defines `SUB_AGENT_ROLES = (data, analysis, modeling, synthesis, report)` only. The three debate roles exist solely as prompt files in `engine/agents/instructions/` (`bull_agent.md`, `bear_agent.md`, `judge_agent.md`). A search of all `*.py` for `SideCase`, `evidence_id`, `judge_agent` and `bull_agent` returned nothing; the only files containing `evidence_id` are the two prompt files.
- What those prompts specify (paraphrased): each side returns at most five claims, each citing evidence ids drawn from a supplied deterministic evidence table; the model may not write numbers itself (a render layer fills values from the ids); an argument that cannot be backed is omitted; the judge returns BUY, HOLD or SELL, a 0 to 1 conviction, a "swing factor" tied to a debatable assumption, and a "change my mind" condition, and may never abstain. The prompts say unsupported arguments "will be bounced by the verification layer".
- **Enforcement status: prompt-level in this snapshot.** The verification layer the prompts mention was not found in code. The debate may live in code that is not part of this checkout. **NOT VERIFIED** that evidence ids are checked anywhere.
- What *is* enforced in code is the value gate in 3.4 (validators, audit ledger, contract). That is a real, tested mechanism (the repo has `tests/audit/` and `tests/unit/test_orchestrator.py`), but it gates numbers, not the debate.

### 3.6 Licence and commit
Apache-2.0 with `NOTICE` and `TRADEMARK_POLICY.md` ("FinRobot" and "AI4Finance" are trademarks, so do not reuse the names). Commit `2717499b8e30f242640af08c4ad9afd1113c2d45`, 2026-09-28, "docs: lead with decision intelligence and the four-part principle".

### 3.7 ADOPT / BEAT
- **ADOPT:** the `critical`, `deterministic` and `derived_keys` step flags; validate-before-propagate with rollback of derived keys; a persist-boundary output contract of pure clauses with *value-withhold* semantics; a finding ledger with severities; code-computed numbers with LLM narration only; model-cites-ids, renderer-fills-values (but enforced in code); credential scrubbing at the trace sink; degrade-not-crash with a visible marker.
- **BEAT:** classify errors by type, not by substring; add step-level resume; add token and wall-clock budgets; make the debate real and its evidence-id check executable; add deterministic replay; give every decision a `why`; keep the debate gate in code rather than in a prompt file.

### 3.8 NOT VERIFIED
Not run; tests not executed. Whether the debate exists in code elsewhere. PydanticAI's own default request cap for the lead agent. Whether `routes/runs.py` or `run_store` offers any pipeline resume beyond SSE (only that file was searched for resume, cancel and orphan). Completeness of provenance beyond the code paths read.

---

## 4. langgraph

### 4.1 What it is
LangChain's graph runtime for stateful agents (monorepo `libs/`: `langgraph`, `prebuilt`, `checkpoint`, `checkpoint-postgres`, `checkpoint-sqlite`, `checkpoint-conformance`, `cli`, `sdk-py`, `sdk-js`). The execution model is Pregel-style bulk-synchronous: super-steps in which all ready nodes run, then their writes are applied.

### 4.2 Orchestration model
- **Loop:** `pregel/_loop.py` `PregelLoop.tick` prepares the next tasks (`_algo.prepare_next_tasks`), checks `interrupt_before`, executes, then `after_tick` calls `_algo.apply_writes`. `apply_writes` **sorts tasks by path before applying**, so merged state does not depend on completion order. Task ids are xxhash digests of the checkpoint namespace, step and name (`_algo.py`), which is what lets pending writes line up on resume.
- **State:** `StateGraph` (`graph/state.py`) takes a `TypedDict`, Pydantic model or dataclass. Each key is a *channel* (`channels/`): `LastValue`, `BinaryOperatorAggregate` (reducers, e.g. append), `Topic`, `EphemeralValue`, `NamedBarrierValue` (join), and a beta `DeltaChannel`. Reducer purity and commutativity are the author's responsibility.
- **Branching:** conditional edges with `path_map`; `Send` for dynamic fan-out (map-reduce); `Command(goto, update, resume)` lets a node both update state and route.
- **Retries** (`types.RetryPolicy`): initial interval 0.5 s, factor 2, max interval 128 s, `max_attempts` 3, jitter on, `retry_on` predicate. Run in `pregel/_retry.run_with_retry`. Retries are **not charged to any budget**.
- **Timeouts:** `types.TimeoutPolicy` (`run_timeout` hard per attempt, `idle_timeout` refreshed by progress or heartbeat; relies on cooperative asyncio cancellation, with a documented caveat for blocking code), `Pregel.step_timeout`, `NodeTimeoutError`. `max_concurrency` in the run config (`_internal/_config.py`).
- **Human-in-the-loop:** `interrupt(value, response_schema=...)` in `types.py` raises `GraphInterrupt`; resume is `Command(resume=...)`. Semantics to know: the node **re-executes from its start** on resume, and multiple interrupts in one node are matched by index. A resume value is validated against the `response_schema` and, if invalid, nothing is saved so it can be answered again. Static breakpoints: `interrupt_before` and `interrupt_after` at compile or invoke time. Requires a checkpointer.
- **Checkpoint/resume:** `BaseCheckpointSaver` (`libs/checkpoint/langgraph/checkpoint/base/__init__.py`): `put`, `put_writes`, `get_tuple`, `list`, `delete_thread`, `copy_thread`, `prune`. A `Checkpoint` has `id` (monotonic), `ts`, `channel_values`, `channel_versions`, `versions_seen`; metadata has `source` (`input | loop | update | fork`), `step`, `parents`, `run_id`. **Pending writes** of tasks that succeeded in a failed super-step are persisted and re-applied on resume (`_reapply_writes_to_succeeded_nodes`). `durability` is `"sync" | "async" | "exit"` with default **`"async"`** (`pregel/main.py`): the next step starts while the previous checkpoint is still being written, so a crash can lose the last step. `get_state_history`, `update_state`, `bulk_update_state` give time travel and forking. Serialisation is msgpack/JSON-plus with an allow-list and an encrypted option (`checkpoint/serde/`).
- **Budgets:** `recursion_limit` is the only global turn cap; the loop stops at `step + recursion_limit + 1` with `GraphRecursionError`. **The default in this checkout is `LANGGRAPH_DEFAULT_RECURSION_LIMIT`, defaulting to 10007** (`_internal/_config.py`), which is effectively unbounded for an LLM loop. No token, cost or wall-clock-per-run budget found (per-node `TimeoutPolicy` and `step_timeout` only).

### 4.3 Tracing and replay
- Stream modes `values | updates | messages | custom | checkpoints | tasks | debug` (`types.py` stream-part types). Tracing goes through LangChain callbacks to LangSmith when configured; `TracePolicy` lets a node redact or summarise its own recorded inputs and outputs. Whether LangSmith export is on by default is **NOT VERIFIED** (not read).
- **Replay:** time travel re-runs from a chosen `checkpoint_id`; nodes after it execute again, so model calls fire again. A search of `libs/langgraph` and `libs/checkpoint` for cassette and VCR terms found none. Deterministic *application* of writes is a real property; deterministic *effects* are not provided.

### 4.4 Guardrails and validation
Pydantic state classes are supported (the graph module imports `BaseModel`/`TypeAdapter`); `prebuilt/tool_validator.py` validates tool calls. Exactly when node outputs are validated for a Pydantic state is **NOT VERIFIED**. No output guardrail framework.

### 4.5 Pattern
Not a pattern repo; it is the runtime under TradingAgents. Gates are whatever conditional edges you write.

### 4.6 Licence and commit
MIT. Commit `afbe7e48b17f62e139b5c6337ab934549e6dc73b`, 2026-10-12, "release(checkpoint-postgres): 3.1.3 (#9287)".

### 4.7 ADOPT / BEAT
- **ADOPT:** canonical write-application order independent of completion order; deterministic task ids; pending writes so a crash mid-step does not repay finished work; a response schema on resume that does not commit on failure; typed timeout policy with a hard per-attempt cap; checkpoint metadata of `source`, `step`, `parents`, `run_id`; fork as a first-class operation.
- **BEAT:** a finite default turn limit; token and wall-clock budgets that include retries; `sync` durability by default; interrupts only at step boundaries so no node re-executes (a hazard if a node had side effects before the interrupt call); mandatory `why`; cassettes; serialisation that is plain canonical JSON owned by us, not tied to a library version or class paths.

### 4.8 NOT VERIFIED
Not run. Pydantic validation timing. Crash behaviour under `durability="async"` (read, not exercised). LangSmith default. `cli`, SDKs and Postgres saver unread. Performance and scaling.

---

## 5. crewAI

### 5.1 What it is
A Python multi-agent framework with two layers: **Crew** (agents, tasks, `Process.sequential | hierarchical`, `process.py`) and **Flow** (event-driven workflow DSL). Monorepo `lib/`: `crewai`, `crewai-core`, `crewai-tools`, `crewai-files`, `cli`, `devtools`. Studied: the Flow runtime, task guardrails, checkpoint state and telemetry. `crew.py` (2,559 lines) was skimmed via grep only.

### 5.2 Orchestration model
- **Flow** (`flow/dsl/`, `flow/runtime/__init__.py`, `Flow`): decorators `@start`, `@listen`, `@router`, with `or_`/`and_` conditions; a serialisable `FlowDefinition` (`flow/flow_definition.py`); state is a Pydantic `FlowState` or dict. Routers return label strings that listeners subscribe to.
- **First-wins racing:** for `or_` conditions, `Flow._execute_racing_listeners` runs listeners concurrently, takes the first to finish (`asyncio.as_completed`) and **cancels the rest**. Which branch wins depends on latency, so it is a source of nondeterminism by design.
- **Retries:** task guardrails (`task.py`, `guardrail_max_retries`): a failed guardrail re-runs the agent with the error as context, up to the limit, then raises a generic exception. Agents have `max_iter` (default 25, `agents/agent_builder/base_agent.py`), `max_rpm`, `max_execution_time` (`agent/core.py`).
- **Loop guard:** `Flow.max_method_calls` default 100; exceeding it raises `RecursionError` (`_execute_single_listener` path).
- **Human-in-the-loop:** `@human_feedback` (`flow/human_feedback.py`, `flow/dsl/_human_feedback.py`), `Flow.ask`, async feedback providers (`flow/async_feedback/`), `Flow.from_pending` and `resume`/`resume_async`. Free-text feedback is mapped to one of the declared outcomes **by an LLM** (`_collapse_to_outcome`, structured `Literal` output with a plain-prompt fallback, raising `HumanFeedbackCollapseError`). That makes a router decision nondeterministic.
- **Checkpoint/resume:** `state/checkpoint_config.py` `CheckpointConfig` (default location `./.checkpoints`, JSON or SQLite provider) writes a checkpoint **when configured event types fire** (a very long `Literal` of event names). `Flow.from_checkpoint` restores completed method names, method outputs, call counts and state (`_restore_from_checkpoint`); completed methods are skipped while resuming. `Flow.fork(config, branch)` creates a new execution branch. Granularity is the Flow method; work inside an agent loop is not resumable.
- **Budgets:** `max_iter`, `max_rpm`, `max_execution_time`, `guardrail_max_retries`, `max_method_calls`. Aggregated usage metrics exist (`Flow.usage_metrics`), but no hard token cap was found (not an exhaustive search).

### 5.3 Tracing and replay
- A typed event bus (`events/event_bus.py`, well over a hundred event types listed in `checkpoint_config.py`), an event record graph with parent, causal and sequential edges (`state/event_record.py`), and hooks before and after LLM and tool calls (`hooks/`, `HookAborted`).
- `Flow._replay_recorded_events` re-dispatches recorded method events **to listeners** after a restore; it does not re-run model calls.
- **Telemetry is on unless disabled.** `crewai_core/telemetry.py` returns early only if `OTEL_SDK_DISABLED`, `CREWAI_DISABLE_TELEMETRY` or `CREWAI_DISABLE_TRACKING` is set; otherwise it builds an OTLP exporter to `https://telemetry.crewai.com:4319` (`telemetry/constants.py`). The module docstring says prompts, responses and task text are not collected unless the user opts in via `share_crew`. Network behaviour was not tested.

### 5.4 Guardrails and validation
`Task.guardrails` accepts callables returning `(ok, result_or_error)` or a plain-language string that an LLM evaluates (`tasks/llm_guardrail.py`). `output_pydantic` and `output_json` give typed outputs. **`HallucinationGuardrail` is a no-op placeholder in the open-source repo** (its own docstring says so), a reminder that named features can be hollow.

### 5.5 Pattern
Not a trading or clinical pattern. Hierarchical process uses a manager LLM that delegates: LLM-chosen routing (not studied in depth).

### 5.6 Licence and commit
MIT. Commit `c0eda9f53889fb38d0352e2c9a738c653ab811b3`, 2026-10-13, "docs: consolidate MongoDB documentation improvements (#8097)".

### 5.7 ADOPT / BEAT
- **ADOPT:** the explicit loop guard on listener re-entry; serialisable flow definition (our graph as hashable data); checkpoint plus fork; pending-feedback persistence so a human can answer hours later; a typed event record with causal edges.
- **BEAT:** no LLM in routing decisions unless it is a recorded, labelled effect; no first-wins races; no default-on external export; checkpoint inside the step loop, not only at method boundaries; a hard token budget; real (not placeholder) validators.

### 5.8 NOT VERIFIED
Not run. Hierarchical manager behaviour. Absence of a hard token cap beyond targeted searches. Whether telemetry transmits at run time. Memory, knowledge, A2A and tools libraries unread.

---

## 6. autogen

### 6.1 What it is
Microsoft's multi-agent framework, now in **maintenance mode** by its own README ("community managed", points new users to Microsoft Agent Framework). Python packages `autogen-core` (actor-model runtime), `autogen-agentchat` (teams), `autogen-ext`, `autogen-studio`, `magentic-one`. Docs are CC-BY-4.0; code is MIT.

### 6.2 Orchestration model
- **Core:** `SingleThreadedAgentRuntime` with typed messages, topics and subscriptions, `CancellationToken`, and `agent_save_state` / `agent_load_state`.
- **Teams** (`autogen_agentchat/teams/_group_chat/`): `RoundRobinGroupChat`, `SelectorGroupChat` (an LLM picks the next speaker; `max_selector_attempts`; optional `selector_func` and `candidate_func` to override or filter), `Swarm` (handoffs), `GraphFlow` (a `DiGraph` with conditional edges and activation groups; `graph_validate` and `has_cycles_with_exit` reject cycles that have no exit), and Magentic-One.
- **Message intervention** (`autogen_core/_intervention.py`): `InterventionHandler.on_send / on_publish / on_response` can modify or `DropMessage` any message at the runtime boundary. This is a genuine in-code gate on inter-agent traffic.
- **Termination algebra** (`conditions/_terminations.py`): `MaxMessageTermination`, `TextMentionTermination`, `TokenUsageTermination`, `TimeoutTermination`, `HandoffTermination`, `ExternalTermination`, `FunctionCallTermination`, `FunctionalTermination`, and more, combinable. `max_turns` is enforced by the group-chat manager (`_base_group_chat_manager._apply_termination_condition`).
- **Token budget is soft:** `TokenUsageTermination.__call__` adds usage from messages that have **already arrived** and then reports termination, so a single turn can overshoot the cap.
- **Human-in-the-loop:** `HandoffTermination` stops the team so a user can respond; `ExternalTermination` lets an outside signal stop it.
- **Checkpoint/resume:** `BaseGroupChat.save_state` / `load_state` collect per-agent states plus manager state (message thread, turn count; `GraphFlowManager.save_state` also stores the remaining-edge counters, activation flags and the ready queue). Resume is `load_state` then `run`. There is no automatic per-step durable checkpointing.
- **Retries:** at the model-client level (`max_retries` in `autogen_ext/models/openai`), not in orchestration.

### 6.3 Tracing and replay
OpenTelemetry through `autogen_core/_telemetry/_tracing.py` with GenAI semantic conventions (`_genai.py`); `NoOpTracerProvider` unless the application supplies one, and `AUTOGEN_DISABLE_RUNTIME_TRACING=true` switches it off. **Vendor-neutral by default.** `autogen_ext/models/cache/_chat_completion_cache.py` wraps a model client with a store keyed by a SHA-256 of the serialised request, which memoises calls (a crude cassette); it is not tied to a trace, has no graph hash and no miss-is-error mode as far as read.

### 6.4 Guardrails and validation
Pydantic message classes; structured output via `output_content_type`; no output-guardrail framework beyond intervention handlers and termination conditions.

### 6.5 Pattern
Generic. The LLM-chosen speaker in `SelectorGroupChat` is a routing decision made by a model.

### 6.6 Licence and commit
Docs `LICENSE` is Creative Commons Attribution 4.0; code `LICENSE-CODE` is MIT. Commit `027ecf0a379bcc1d09956d46d12d44a3ad9cee14`, 2026-04-06, "Update maintenance mode banner in readme (#7521)".

### 6.7 ADOPT / BEAT
- **ADOPT:** composable termination conditions as values (`a | b`, `a & b`) evaluated by the runtime; message-level interceptors; cycle-needs-exit validation at construction; OpenTelemetry GenAI naming as an optional trace exporter (our JSONL stays primary).
- **BEAT:** pre-call token reservation so the cap cannot be overshot; no LLM speaker selection as control flow; per-step durable checkpoints; cassettes bound to a graph hash.

### 6.8 NOT VERIFIED
Not run. Cache key composition beyond "SHA-256 of serialised data". Merge ordering for parallel `GraphFlow` branches. Runtime queue ordering under concurrent publishers. The .NET stack. The successor framework was out of scope.

---

## 7. openai-agents-python

### 7.1 What it is
OpenAI's Python SDK for agent loops (package version 0.23.1 in `pyproject.toml`): `Agent` (instructions, tools, handoffs, guardrails, `output_type`), `Runner.run` (loop in `run_internal/run_loop.py`), sessions, tracing, MCP, sandbox, realtime and voice.

### 7.2 Orchestration model
- **Loop:** model turn, then tool calls, handoff or final output, repeat. **Handoffs are tool calls** the model chooses (`handoffs/__init__.py`, `Handoff` with `input_filter` and `is_enabled`), so routing is LLM-decided; there is no static graph.
- **State:** `RunContextWrapper` for caller data; `RunState` (`run_state.py`) is the serialisable snapshot: turn, current agent, original input, model responses, generated items, context, approvals, max turns.
- **Retries/timeouts:** `ModelRetrySettings` with backoff and policies (`retry.py`), `ModelTimeoutError`, per-tool `timeout_seconds` (`tool.py`) raising `ToolTimeoutError`.
- **Human-in-the-loop:** tool approval. A tool marked as needing approval stops the run with interruptions (`ToolApprovalItem`, `run_internal/approvals.py`); the caller approves or rejects on the `RunState` and resumes. Interruptions are step-boundary, not mid-node.
- **Checkpoint/resume:** `RunState.to_json` / from-JSON with an explicit schema version: `CURRENT_SCHEMA_VERSION = "1.20"` and a table of version summaries and supported versions. Context serialisation is "intentionally conservative" with warnings when a custom context cannot be rebuilt. Server-managed conversation ids (`previous_response_id`, `conversation_id`) are supported, which couples state to the vendor.
- **Budgets:** `max_turns` default **10** (`run_config.DEFAULT_MAX_TURNS`); exceeding raises `MaxTurnsExceeded` unless a run error handler finalises. No token, cost or run-level wall-clock budget found in `src/agents` (searched; only an unrelated span-size budget in the experimental Codex tool).

### 7.3 Tracing and replay
Rich span types (`tracing/span_data.py`): agent, task, turn, function, generation, response, handoff, guardrail, MCP tools. **Default exporter uploads to the vendor** (`BackendSpanExporter`, `https://api.openai.com/v1/traces/ingest`, `tracing/processors.py`) unless `OPENAI_AGENTS_DISABLE_TRACING` is set or `tracing_disabled` is passed; the env flag is read once and cached (`tracing/provider.py`). Processors are pluggable. `testing/model.py` provides a scripted model for deterministic unit tests; no record-and-replay of live runs found.

### 7.4 Guardrails and validation
`InputGuardrail` and `OutputGuardrail` return `GuardrailFunctionOutput(tripwire_triggered)`; a tripwire raises `InputGuardrailTripwireTriggered` or `OutputGuardrailTripwireTriggered`. **Input guardrails run in parallel with the model by default** (`run_in_parallel = True`), so the model call may already have been made when the tripwire fires; a blocking mode exists. Tool guardrails (`tool_guardrails.py`) can allow, reject the content, or raise. `output_type` is validated with a type adapter and raises `ModelBehaviorError` on bad JSON (`agent_output.py`). Typed exceptions: `MaxTurnsExceeded`, `ModelBehaviorError`, `ModelRefusalError`, `ModelTimeoutError`, `ToolTimeoutError`, `UserError`, tripwire classes (`exceptions.py`).

### 7.5 Pattern
Generic. Multi-LLM support exists through extensions (`extensions/models/litellm_model.py`, `any_llm_model.py`), but the strongest features are tied to the Responses API.

### 7.6 Licence and commit
MIT. Commit `f53c62451c7f34c15f0c87fa745e05404025420f`, 2026-10-13, "docs: add native Decisions API integration recipes (#5357)".

### 7.7 ADOPT / BEAT
- **ADOPT:** typed exception taxonomy; approvals as a first-class serialisable state; a schema-versioned snapshot with a supported-versions table; tripwire guardrails with explicit behaviours; a scripted model for tests.
- **BEAT:** blocking guardrails by default for anything that gates action; a token and wall-clock budget; trace export off unless a sink is configured; routing as explicit graph edges, with model-chosen routing only as a recorded, labelled decision.

### 7.8 NOT VERIFIED
Not run. Server-side behaviour of the Responses API. Whether an approval survives a process restart beyond what `RunState` documents. Sandbox, realtime, voice, MCP and session backends unread.

---

## 8. Comparison matrix

| Capability | Clinical | Trading | FinRobot V2 | langgraph | crewAI | autogen | openai-agents |
|---|---|---|---|---|---|---|---|
| Typed, validated state | No (dict) | Partial (TypedDict) | Yes (Pydantic results) | Partial | Yes (Pydantic flow state) | Partial (messages) | Partial |
| Hard turn cap | `eta` | rounds, `recursion_limit` 100 | step retries only | `recursion_limit`, **default 10007** | `max_iter` 25, `max_method_calls` 100 | `max_turns` | `max_turns` 10 |
| Wall-clock cap | per call only | none found | HTTP timeouts, cancel | per node attempt, `step_timeout` | per task | `TimeoutTermination` | per tool, per model call |
| Token or cost cap | none | none | none | none | none found | soft, after spend | none found |
| Retries counted in budgets | partly (recheck) | no | no | no | no | no | no |
| Checkpoint/resume | in-run snapshots only | via LangGraph, opt-in | none at step level | yes, durable | yes, method level | `save_state` between runs | `RunState` for interrupts |
| Human approval | no | no | no | `interrupt` (node re-executes) | feedback, LLM-collapsed routing | handoff termination | tool approvals |
| Code-enforced output gate | action mask | no (REVIEW sentinel only) | **yes** (validators, contract) | primitives only | callable guardrails | interceptors | tripwires (parallel by default) |
| Record and replay of LLM calls | no | no | no | no | events to listeners only | response cache | scripted test model |
| Per-decision `why` required | no | no | partly (audit findings) | no | no | no | no |
| Default external trace export | no | no | no | LangSmith when configured (NOT VERIFIED default) | **yes**, opt-out | no | **yes**, opt-out |

---

## 9. Our own orchestration runtime

Decision recorded by the owner: **no dependency on any of these frameworks; everything is our own TypeScript.** This section specifies the runtime. It is a design. Nothing here is built or tested yet, so every claim about how it will behave is **NOT VERIFIED** until the acceptance tests in 9.12 pass. "Best-in-class" is not claimed; 9.12 defines the measurable criteria and the comparison that would justify it.

### 9.1 Principles (each one answers a failure seen above)

1. **Every control-flow decision is made by code or recorded as a labelled effect.** No hidden model-made routing (AutoGen selector, crewAI feedback collapse, OpenAI handoffs, Clinical MCTS priors). A model may *advise* a decision; the decision event says who decided.
2. **All nondeterminism enters through injected ports** (model, tools, clock, random, ids, scheduler). That is what makes record and replay possible.
3. **Budgets are hard, pre-checked and include retries.** The runtime never relies on a prompt to stop.
4. **A proposal cannot become state or an action without passing a gate, enforced by types.**
5. **Failure is typed and degraded visibly.** Never a silent default, never a fabricated value.
6. **State is canonical JSON we own**, so checkpoints, cassettes and hashes do not depend on a library version.
7. **Zero runtime dependencies** in the core (Node built-ins only; TypeScript and a test runner as dev tools). Adapters for model providers and sponsor engines live outside the core behind ports.

### 9.2 Module layout (under `src/runtime/`)

`schema.ts` (tiny validator combinators plus JSON-Schema emission), `state.ts` (state spec, reducers, canonical JSON, hashing), `graph.ts` (nodes, edges, compile-time validation), `budget.ts`, `ports.ts` (ModelPort, ToolPort, Clock, Rng, Ids, Scheduler, ApprovalPort, MemoryPort, ContextPort), `effects.ts` (metered, recorded wrappers), `cassette.ts`, `trace.ts`, `checkpoint.ts`, `gates.ts`, `fanout.ts`, `errors.ts`, `runner.ts`, `testing/` (scripted model, crash injector, fan-in shuffler, cassette tools). Decision for the owner: a hand-written 300-line validator vs Zod. Recommendation: hand-written core `Schema<T>` (`parse(unknown): Result<T>` plus `toJsonSchema()`), with a Zod adapter allowed outside the core, because cassette keys and schema hashes must not change when a validator library updates. This is a stability argument, not an effort one.

### 9.3 Typed shared state

```ts
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

interface StateSpec<S> {
  schema: Schema<S>;                              // validated at run start, after every commit, on resume
  reducers: { [K in keyof S]?: Reducer<S[K]> };   // default 'last'; 'append' | 'merge' | pure fn
  monotonic: (keyof S)[];                         // survive a rewind: counters, spent budgets, trace seq
}
```
Rules: state is plain JSON (no class instances or functions); it is hashed canonically (sorted keys, normalised numbers) after each commit (`stateHash`); a step receives a deep-frozen **projection** of only the keys it declares in `reads`, which is also the natural place to bound context carryover (the Meterless Markovian and H-MEM engine specs map here; **NOT VERIFIED**, see 9.14).

### 9.4 Step contract

```ts
interface Step<S, I, O> {
  id: StepId;
  kind: 'llm' | 'tool' | 'pure' | 'human' | 'gate' | 'join';
  reads: (keyof S)[];  writes: (keyof S)[];       // undeclared writes are rejected at commit
  input: Schema<I>;   output: Schema<O>;
  timeoutMs: number;                              // required, no "infinite"
  budget?: Partial<Budget>;                       // tighter than the run's
  critical: boolean;                              // failure aborts the run (FinRobot)
  deterministic: boolean;                         // pure: skip validation-retry loop (FinRobot)
  derives?: (keyof S)[];                          // rolled back with a rejected output (FinRobot)
  validate?: (out: O, s: Readonly<S>) => Finding[]; // severity: info | review | blocked
  retry: RetryPolicy;                             // classes of error, not message substrings
  onFail: 'abort' | 'degrade' | { fallback: StepId };
  run(ctx: StepCtx<S>, input: I): Promise<StepResult<O>>;   // ctx exposes ports only
}
```
`ctx` is the only handle to the outside world: `ctx.model`, `ctx.tools`, `ctx.clock`, `ctx.rng`, `ctx.ids`. A lint rule (`no-restricted-globals` for `fetch`, `Date`, `Math.random`, `crypto.randomUUID`, `setTimeout` outside the scheduler) backs this up. **Honest limit:** JavaScript cannot sandbox a step; a determined step can still import `node:http`. In replay mode the test harness replaces those globals with throwing stubs, which catches accidents, not malice.

### 9.5 Graph, conditional edges, loops

The graph is static data that is hashed (`graphHash`); only fan-out lists may be dynamic, never topology. Edge kinds: `seq`, `cond`, `fanout`/`join`, `loop`.

```ts
type Route<T extends StepId> = { next: T; why: Why };           // a router MUST return a Why
cond<From, T>(from: From, router: (s: Readonly<S>) => Route<T>, targets: readonly T[]): Edge;
```
- The router's return type is the union of its declared targets, so an undeclared target is a compile error (the TradingAgents #1088 class, caught earlier than at run time).
- Every cycle carries `maxVisits`; compile-time validation rejects an unbounded cycle, an unreachable node, a write-set overlap between parallel branches, and a gate with no veto route (AutoGen's cycle-needs-exit idea).
- **Confidence-conditional edges.** `byConfidence({ floor, evidenceMin })` is a helper that returns `Route` with a `why` built from the inputs it saw (for example `confidence 0.62 < floor 0.70; evidence 2 < 3`). Confidence should be *derived in code* where possible (coverage of required evidence, critic rubric score, agreement across independent samples). A self-reported model confidence is treated as uncalibrated until measured against labelled cases (the repo's `docs/design/agent-pairings.md` already uses a 0 to 3 rubric with a 7 of 9 pass mark; that rubric is the natural source).

### 9.6 Budgets enforced in code

```ts
interface Budget { turns: number; modelCalls: number; toolCalls: number;
                   wallClockMs: number; inputTokens: number; outputTokens: number; }
```
- Hierarchy: run, step, call. Children draw from the parent; `split(parent, weights)` carves per-branch slices so a fan-out branch cannot starve its siblings.
- **Pre-call reservation:** before a model call, the meter reserves `estimatedInputTokens + request.maxOutputTokens`. If the reservation does not fit, the call is refused with `BudgetExceeded{ which }`. Worst-case spend is therefore known *before* the call, unlike AutoGen's after-the-fact check and unlike every other repo here. Estimation error is bounded by using the provider's counted usage to settle the reservation after the call; a tokenizer mismatch can only make the estimate conservative (reserve the larger of two estimates). **NOT VERIFIED** per provider.
- **Retries and fallbacks spend budget** and appear in the trace.
- Wall clock counts *active* time (paused approvals do not burn it), uses `AbortSignal` propagation, and the effective deadline is `min(run, step)`.
- **Reserve for finalisation:** the graph may mark a `finalize` node; when remaining turns or time fall under a reserve fraction, the runtime forces the route to `finalize` (code, not a prompt; contrast the TradingAgents wrap-up turn, which is a code route in a loop but only for tool rounds).
- Starting values to tune from traces, not conclusions: the organizers' target for one full agent run is 5 to 10 minutes, so a run wall-clock default near the upper end, with per-step caps well below it.
- Cost in currency is an optional field fed by a price table supplied by an adapter. Whatever Meterless exposes about metering is **NOT VERIFIED** (`docs/sponsors/meterless-integration-notes.md`).

### 9.7 Deterministic mode with record and replay cassettes

Modes: `live`, `record`, `replay`. Every external effect is a typed, keyed record.

- **Effect key** = SHA-256 of canonical JSON of `{ stepId, effectKind, occurrenceIndexWithinStep, request }`, where a model request includes model id, messages, tool schemas, temperature, max tokens, response-schema hash and seed. Cassette header: `{ v, graphHash, runtimeVersion, createdAt }`.
- **Replay is strict by default:** a missing key raises `CassetteMiss` (a failure with a `why`), a `graphHash` or `runtimeVersion` mismatch refuses to start unless `--allow-drift` is passed, and the resulting trace must equal the recorded trace after normalising wall-clock fields. Hybrid "replay what you can, go live otherwise" exists only behind an explicit flag and marks the trace `mode: "hybrid"`.
- Clock, random and id generation are effects too: `ctx.clock.now()` is recorded; `ctx.rng` is seeded from `runId` and its draws are recorded; retry jitter comes from `ctx.rng`, so even backoff is reproducible.
- **Concurrency does not leak into results:** fan-in merges in branch-index order (9.9). Branch events carry `(branchPath, localSeq)`; replay equality compares traces sorted by that key, so scheduling differences do not fail the comparison.
- Cassettes redact secrets before writing (the FinRobot scrubber idea) and are scanned by `scripts/secret_scan.py` before they enter `output_examples/`.
- **Honesty constraint for the hackathon:** `SAMPLE_MODE` is replay of cassettes *recorded from real runs*, labelled `mode: "replay"` in the trace and in any UI. Replay on a different input is a `CassetteMiss`, not a canned answer, which keeps the "no hardcoded outputs" rule intact. Live-mode determinism is best effort only, because sampling at temperature 0 is not guaranteed identical across calls or provider updates (NOT VERIFIED per provider); cassettes are the only reliable determinism.
- Side benefit: **counterfactual gate tests.** Replay a recorded run with a changed threshold or gate rule to see which branch changes, with zero model spend. This is how a "veto" gets proven to fire.

### 9.8 JSONL trace schema with a `why` per decision

One JSON object per line, append-only, flushed per event.

```jsonc
{ "v": 1, "runId": "…", "seq": 17, "branch": "", "localSeq": 17,
  "ts": "…",                 // from ctx.clock, so replay is stable
  "mode": "live|record|replay|hybrid",
  "type": "run.start|step.start|step.end|effect|decision|gate|retry|fallback|budget|checkpoint|interrupt|resume|fanout|join|run.end",
  "step": "critic", "attempt": 1,
  "decision": {                // present iff type is decision, gate, retry, fallback, budget, interrupt, resume
    "kind": "route|retry|fallback|veto|constrain|withhold|stop|degrade|approve|deny",
    "decider": "code|model|human",
    "rule": "gate.size_cap",   // stable id of the rule or router
    "inputs": { "confidence": 0.62, "floor": 0.7 },   // the facts the rule saw
    "chosen": "revise", "alternatives": ["finalize"],
    "why": "confidence 0.62 < floor 0.70",           // REQUIRED, non-empty, bounded length
    "evidence": [ { "kind": "tool|doc|state", "ref": "…", "hash": "…" } ] },
  "effect": { "kind": "model|tool|clock|rng", "key": "…", "source": "live|cassette|recorded",
              "model": "…", "tokensIn": 0, "tokensOut": 0, "ms": 0, "finish": "stop" },
  "state": { "hashBefore": "…", "hashAfter": "…", "patchKeys": ["plan"] },
  "budget": { "spent": { }, "remaining": { } },
  "error": { "class": "transient|validation|budget|policy|fatal", "code": "…", "message": "…" } }
```
- The `decision` event type cannot be constructed without `why` (the helper functions are the only emitters). For `decider: "code"` the `why` is generated from `rule` and `inputs`, so it is true by construction. For `decider: "model"` it is the model's stated rationale, validated non-empty and bounded, and flagged as a claim by the decider field.
- This is the file the organizers ask for (`logs/`, with a cleaned sample in `output_examples/traces/`); compatibility with the `/trace-review` skill's expected input is NOT VERIFIED and should be checked when that skill is next read. An OpenTelemetry exporter (GenAI naming, as AutoGen does) can sit on the trace sink as an option; it is never the primary record and never on by default.

### 9.9 Parallel fan-out and fan-in

```ts
fanout({ branches, concurrency, budgetSplit, join: 'all' | 'allSettled' | { quorum: number }, then: StepId })
```
- Each branch receives an immutable snapshot of its read set, a private scratch space and its own budget slice, and may write only its declared keys (disjoint across branches; checked at compile time for static fan-out, at run time for dynamic lists).
- **Merge order is branch index, never completion order** (langgraph's sorted-write idea, made explicit). There is **no `race` join**: first-wins (crewAI) makes results latency-dependent. A deadline-based "take whatever finished" policy, if ever needed, would be an explicit recorded effect.
- `allSettled` hands the join a list of typed `Settled<O>` values so failures are data; `all` applies each branch's `onFail`; `quorum(k)` is deterministic because the first k *by branch index* that succeeded are used after all have settled or timed out.
- A critical branch failure aborts siblings through the shared `AbortSignal`. Concurrency is capped by a fair semaphore (the FinRobot run-semaphore idea) so provider rate limits are respected.

### 9.10 Checkpoint and resume

- After every step commit the runtime appends a checkpoint: `{ runId, seq, graphHash, state, stateHash, frontier, budgetsSpent, effectLogOffset, schemaVersion }`. Default durability is **synchronous** (a crash loses at most the step in flight); an `async` mode is opt-in and recorded in the trace.
- **Write-ahead effect log:** a model or tool response is appended to the effect log *before* the step commits. If the process dies between a paid response and the commit, resume reads the response from the log and does not pay again (the purpose of langgraph's pending writes).
- Storage is a port; the default is an append-only file with atomic rename. Content is canonical JSON with an explicit `schemaVersion` and a migration table (the openai-agents `RunState` discipline).
- `resume(runId)`: load the last checkpoint whose hash verifies, refuse if `graphHash` differs unless a migration is supplied (TradingAgents' run-signature idea), continue at the frontier. **Budgets and monotonic fields are restored, not reset.** Contrast ClinicalAgents, whose `run()` re-initialises state.
- `fork(checkpointId, patch)` creates a new run with a parent pointer (time travel). `rewind(toCheckpoint)` restores domain state but preserves `monotonic` fields, bounded by a rewind counter (the ClinicalAgents snapshot semantics, with the budget hole closed).

### 9.11 Human approval interrupts, gates, fallbacks

**Approvals.** A `human` step returns `Interrupt{ id, reason, payload, responseSchema, expiresAt }`. The runtime writes a checkpoint with status `awaiting`, then **exits the process cleanly**; nothing is held open. `approve(runId, interruptId, response)` validates against `responseSchema` and, on failure, commits nothing (langgraph's property). Interrupts are step boundaries, so no node ever re-executes (avoids langgraph's repeat-side-effects hazard). Tools declare `effect: 'read' | 'write' | 'irreversible'`; an irreversible call without an approved gate verdict is unrepresentable. Unanswered approvals past `expiresAt` resolve to **deny** (fail closed), with a `why`. In tests the approver is scripted; in replay, human responses are recorded effects.

**Gates (how a veto is enforced in code, not in a prompt).**
```ts
type Proposal<T> = { readonly kind: 'proposal'; readonly value: T; readonly by: StepId };
declare const approvedBrand: unique symbol;
type Approved<T> = { readonly [approvedBrand]: true; readonly value: T; readonly gate: GateId; readonly verdictSeq: number };

type Verdict<T> =
  | { kind: 'allow';     why: Why }
  | { kind: 'constrain'; patch: Partial<T>;      why: Why }   // clamp a size, strip a field
  | { kind: 'withhold';  fields: (keyof T)[];    why: Why }   // keep the judgement, drop the value (FinRobot)
  | { kind: 'veto';      route: StepId;          why: Why };  // discard the proposal, take the safe branch

type Gate<S, T> = (state: Readonly<S>, proposal: T) => Verdict<T>;   // synchronous and pure
```
Only `gate.apply(proposal)` produces `Approved<T>`. State commits for proposal-typed keys and every tool that acts on the world accept `Approved<T>` only. A model can supply *facts* to a gate (for example a risk assessment written into state by an earlier step), but thresholds, comparisons and the veto itself are code. A gate that throws resolves to its declared safe verdict (`onGateError: 'closed'` by default). A persist-boundary **output contract** (FinRobot) runs the same machinery over the final artifact: a list of pure clauses, hard ones withhold values, none ever throws. Evidence discipline: model outputs cite ids from a code-built evidence table; unknown ids are a validation failure; numbers are filled in by code from the table, never typed by the model.

**Failure and fallback.** Error classes are values, not substrings: `transient` (rate limit, timeout, 5xx: retry with seeded jittered backoff, honouring `Retry-After`, bounded and budget-charged), `validation` (re-prompt with the validator's finding, at most N, then fallback), `budget` (route to `finalize`), `policy` (a gate refused: never retried), `fatal` (auth, billing, unsupported config: abort even a non-critical step). A step's `onFail` chain is explicit: primary, then a named fallback step (for example a smaller model or recorded sample data), then `degrade`. Every transition is a trace event with a `why`. A degraded run's output type **requires** a `degraded: { step, reason }[]` field so a UI cannot hide it. Silent fabricated defaults (the ClinicalAgents confidence inference) are not representable: a default is a visible step.

### 9.12 Acceptance tests and criteria (what would justify "best-in-class")

Measurable criteria, each with a test that must exist before any such claim is made:

1. **Replay equality:** record a run, replay it, assert an identical normalised trace and final state hash, over at least 20 varied runs.
2. **Crash safety:** kill the process after every effect and every commit boundary of a reference run (a crash-injection harness), resume, assert the same final state hash and no repeated paid effect.
3. **Budget soundness:** an adversarial scripted model that always returns the maximum output; assert total tokens, calls, turns and wall clock never exceed the budget, including retries.
4. **Order independence:** randomise branch completion delays 1,000 times; assert identical merged state.
5. **Gate integrity:** a type-level test that a `Proposal` cannot be passed where `Approved` is required; a counterfactual replay in which a recorded risky proposal is vetoed and the safe branch runs; a thrown gate resolves closed.
6. **Failure drills (the project's test-failure-first rule):** kill each dependency, force the critic to reject, feed empty and junk input, assert typed errors, visible degradation and no silent defaults.
7. **Trace completeness:** a trace linter that fails if any routing, retry, fallback, veto, stop or budget event lacks a non-empty `why`, or if state changes occur between events without a commit event.
8. **Comparison:** a written feature-by-feature check against sections 1 to 8, repeated on the built code, reporting where each framework is still better.

Until 1 to 8 pass, the runtime is "specified", not "verified".

### 9.13 What we do better, and what we consciously omit

Better, with the reason tied to a finding above (each is a design intent until 9.12 passes):

| Against | What the design adds |
|---|---|
| langgraph | A finite default turn limit; a token and wall-clock budget that counts retries; synchronous durability by default; interrupts at step boundaries so no node re-executes; mandatory `why`; record and replay of effects; checkpoints in plain canonical JSON we own. |
| crewAI | No first-wins races; no LLM-collapsed routing; no default-on external telemetry; checkpoint granularity at the step and effect level; a hard token cap; validators that are real. |
| autogen | A pre-call token reservation (autogen's cap is checked after spend); no model speaker selection as control flow; per-step durable checkpoints; cassettes bound to a graph hash. |
| openai-agents | Blocking gates for anything that acts; token and wall-clock budgets; no vendor-coupled state or default upload; routing as explicit edges. |
| TradingAgents | An actual veto in code; typed debate state; budgets beyond rounds; a `why` per decision. |
| FinRobot | Resume, replay and budgets added to its gate ideas; a debate whose evidence-id check is executable. |
| ClinicalAgents | Crash resume; typed state; trace of why; no silent LLM defaults; deterministic merges. |

Where the frameworks are still better, stated plainly: langgraph and crewAI have years of production hardening, Postgres and cloud checkpoint backends, streaming and a visual debugger; openai-agents has first-party tooling for hosted tools and sandboxes; FinRobot has 32 tested finance operators. We do not match any of that.

Conscious omissions, each with its reason (none is "too much work"):

- **Distributed or remote execution, database checkpoint backends:** a bounded single-machine run with no manual setup is the organizers' reproducibility requirement. The checkpoint store is a port, so a database can be added without touching the core.
- **LLM-chosen routing as a control-flow primitive** (selector, handoff, manager agent): it defeats replay and the `why` guarantee. A model may advise a gate; it does not own the edge.
- **MCTS with LLM-simulated rollouts:** non-deterministic and costs Top-K by N_sim model calls per step against a 5 to 10 minute target. Revisit only if an experiment shows a measured gain on our own evaluation set.
- **Role-play persona layers, backstories and crews:** not control flow; they belong in prompts.
- **Built-in memory, RAG or knowledge stores inside the runtime:** these are application concerns behind `MemoryPort` and `ContextPort`.
- **Dynamic topology and generated graphs:** the graph must be hashable data for checkpoint identity and cassette binding.
- **A visual graph editor and a token-streaming UI:** the trace tail is the observability surface; streaming can read it.

### 9.14 Lock-in and hidden-nondeterminism audit of the frameworks (why the design looks this way)

Lock-in:
- **Telemetry and data egress:** crewAI exports to a vendor endpoint unless an env flag is set (`crewai_core/telemetry.py`); openai-agents uploads traces to `api.openai.com` unless disabled (`tracing/processors.py`). AutoGen is the only neutral default. A hackathon submission with a local-first sponsor (Meterless) should not leak traces by default.
- **State format coupling:** langgraph checkpoints depend on its serialiser and an allow-list of class paths; crewAI resolves entities through an event-type map; openai-agents' snapshot format has reached schema version 1.20 (`CURRENT_SCHEMA_VERSION`), which suggests state formats keep changing with the library. Owning canonical JSON with our own migration table removes that dependency.
- **Provider coupling:** openai-agents' server-managed conversation state; TradingAgents' provider matrix through LangChain. The `ModelPort` boundary keeps adapters thin.
- **Maintenance risk:** AutoGen is in maintenance mode; a design built on it would inherit that.
- **Hollow features:** crewAI's `HallucinationGuardrail` is a placeholder in the open-source tree; FinRobot's debate exists as prompts in this checkout. Treat a framework feature as real only after finding code that runs it.

Hidden nondeterminism found or inferred:
1. Sampling: TradingAgents leaves temperature unset and has no seed; Clinical reads temperature from a missing config.
2. First-wins listeners: crewAI `_execute_racing_listeners` (latency decides the branch).
3. Model-made routing: AutoGen `SelectorGroupChat`, crewAI `_collapse_to_outcome`, OpenAI handoffs, Clinical MCTS priors and simulated transitions.
4. Merge order: handled well by langgraph's sorted writes and by TradingAgents' disjoint keys; not verified for AutoGen `GraphFlow`.
5. Jittered backoff drawn from the global random source (langgraph `RetryPolicy(jitter=True)`, TradingAgents `post_screen`).
6. Hash-ordering: Clinical's `list(set(...))` over strings.
7. "Today" and live data: mitigated in TradingAgents by an explicit trade date and look-ahead tests, but live vendors still change.
8. Re-prompting after validation failure changes the output (FinRobot's `deterministic` flag exists to avoid pointless re-runs).
9. Provider-side model updates: invisible to every framework; only a cassette pins an outcome.

### 9.15 Sponsor and decision hooks (no claims beyond what is sourced)

- The runtime exposes `ModelPort`, `ToolPort`, `MemoryPort` and `ContextPort`. Whether and how the required sponsors fit those ports is **NOT VERIFIED**. Meterless is described in `docs/sponsors/meterless-integration-notes.md` as a local-first stack of engine specs (H-MEM memory, World Model, Markovian bounded-carryover reasoning, Scout Intent) implemented from `AGENTS.md` specs with conformance suites; mapping the step `reads` projection and the checkpoint to those specs requires reading `research/sponsor-reference/Meterless/engines/*` first. No sponsor use is claimed until a `src/` call site, a trace line and a tested fallback exist (project rule 7).
- Decisions for the owner: (a) own validator core versus Zod adapter in the core (recommended: own core, see 9.2); (b) which of H-MEM, Markovian or World Model, if any, backs `MemoryPort` and `ContextPort`; (c) the track and use case, which are still open questions and are deliberately not assumed anywhere in this design.

### 9.16 Build order by dependency (quality gates, not dates)

1. `schema`, `state` (canonical JSON, hashing), `errors`, `trace` with the `why` type, `ports`: gate = trace linter and state-hash tests pass.
2. `budget`, `effects` (metered wrappers): gate = criterion 3.
3. `cassette`, record and replay: gate = criterion 1.
4. `graph` compile-time validation and `runner`: gate = routing, loop-bound and unreachable-node tests.
5. `checkpoint` and resume: gate = criterion 2.
6. `gates`, output contract, error classes and fallbacks: gate = criteria 5 and 6.
7. `fanout`: gate = criterion 4.
8. `human` steps and approvals: gate = approve, deny, expire and invalid-response tests.
9. Comparison pass (criterion 8) and an independent review before any quality claim.
