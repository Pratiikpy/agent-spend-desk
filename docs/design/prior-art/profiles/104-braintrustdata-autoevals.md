# Profile: braintrustdata/autoevals

Reader: agy (Gemini), 2026-10-20. Inspected via GitHub API and raw tree fetches (last commit `1607425` on 2026-10-08; stars: 1,063 on 2026-10-20). Licence read first: MIT (`LICENSE:1-3` confirmed).

## 1. What it is
A dual-language evaluation library for AI model outputs providing LLM-as-a-judge, RAG, and deterministic heuristic metrics (`README.md:3-9`, `AGENTS.md:7`). MIT Licence (`LICENSE:1-3`). Last commit read: `1607425` (2026-10-08). Reader: agy (Gemini), 2026-10-20.

## 2. Architecture map
Parallel implementations in TypeScript (`js/`) and Python (`py/autoevals/`) sharing YAML prompt templates in `templates/` (`AGENTS.md:47-53`).
- **Core Abstraction**: `Score` dataclass (`name`, `score` $\in [0, 1]$, `metadata`) and `Scorer` base class with synchronous `eval()` and async `eval_async()` (`py/autoevals/score.py:9-52`, `js/score.ts:3-21`).
- **LLM Pipeline**: YAML template rendered via Chevron/Mustache, dispatched to OpenAI chat completions enforcing tool call `select_choice` with JSON Schema parameter validation, returning discrete choice and CoT `reasons` (`py/autoevals/llm.py:115-133, 262-278`).
- **Modules**: LLM judges (`llm.py`), RAGAS metrics (`ragas.py`), text similarity (`string.py`), numeric comparison (`number.py`), recursive JSON diff (`json.py`), bipartite list assignment (`list.py`), moderation (`moderation.py`), and AI proxy gateway/LiteLLM routing (`oai.py`, `litellm.py`).
- **Calibration Engine**: `evals/src/autoevals.eval.ts` pulling CoQA validation splits via DuckDB parquet streaming (`evals/src/sync_datasets.ts:14-23`) and scoring evaluators with `NumericDiff` (`evals/src/autoevals.eval.ts:66-95`).

## 3. Features and how each behaves
- **LLM Judges**: `Factuality` compares submission against expert ground truth across 5 categorical grades: A=0.4 (subset), B=0.6 (superset), C=1.0 (exact details), D=0.0 (disagreement), E=1.0 (immaterial difference) (`templates/factuality.yaml:15-25`). `Battle` evaluates pairwise preference as binary Yes=1.0 / No=0.0 (`templates/battle.yaml:16-18`). `ClosedQA` checks criteria satisfaction (Y=1.0 / N=0.0) (`templates/closed_q_a.yaml:13-15`). `Security` flags malicious text (Yes=0.0, No=1.0, Unsure=0.5) (`templates/security.yaml:5-8`).
- **RAG Evaluators**: `ContextRelevancy` extracts sentences and computes character ratio over raw context length (`py/autoevals/ragas.py:402-405`). `Faithfulness` extracts atomic claims and scores binary attribution (`py/autoevals/ragas.py:803-806`). `AnswerCorrectness` computes statement $F_1 = \frac{\text{TP}}{\text{TP} + 0.5(\text{FP} + \text{FN})}$ and blends with cosine embedding similarity via weights 0.75 / 0.25 (`py/autoevals/ragas.py:1342-1345, 1408-1413`).
- **Heuristic Scorers**: `Levenshtein` normalized string distance $1 - \frac{\text{dist}}{\max(\text{len}_1, \text{len}_2)}$ (`py/autoevals/string.py:56-62`). `NumericDiff` normalized error $1 - \frac{|e - o|}{|e| + |o|}$ (`py/autoevals/number.py:47-51`). `JSONDiff` recursive structural traversal delegating primitives to Levenshtein and NumericDiff (`py/autoevals/json.py:167-191`). `ListContains` Hungarian linear sum assignment on pairwise distances via Scipy (`py/autoevals/list.py:72-84`).
- **Defaults & Failures**: Default model defaults to `gpt-5-mini` or global `init()` config (`py/autoevals/oai.py:496-498`). Deprecated `Score.error` field now prints stderr warning while exceptions propagate to caller (`py/autoevals/score.py:22-40`). Malformed tool responses raise `ValueError` (`py/autoevals/llm.py:265-268`).

## 4. How people use it
Installed via `pip install autoevals` or `npm install autoevals` (`README.md:37, 43`). Instantiated directly (e.g. `evaluator = Factuality()`) and invoked inline or passed into Braintrust `Eval` task suites (`README.md:61-72`, `evals/src/autoevals.eval.ts:90`). Colocated unit tests mock LLM responses using `respx` and `msw` (`AGENTS.md:104-106`). User issue and community feedback: NOT VERIFIED (external GitHub issues not cloned).

## 5. Mechanism for the Desk
- **Exact Data Model to Copy**: The unified `Score` record (`name: str`, `score: float | None` $\in [0, 1]$, `metadata: dict`) where `None` signifies an inapplicable/skipped check (`py/autoevals/score.py:9-35`). Ideal contract for Desk canary runs, receipt verification, and replay passes.
- **Formulas & Rules to Copy**:
  - Tool-enforced classifier schema: Constraining the judge LLM via function call `select_choice` with enumerated strings and mandatory CoT `reasons` (`py/autoevals/llm.py:115-133`) prevents unstructured text parsing failures.
  - Multi-variable RAG blending: `AnswerCorrectness` formulation balancing deterministic statement-level $F_1$ classification with continuous embedding similarity (`py/autoevals/ragas.py:1342-1413`).
  - Maximum bipartite matching for set/list verification: Hungarian assignment (`scipy.optimize.linear_sum_assignment`) over pairwise metric matrices (`py/autoevals/list.py:72-84`).
- **What They Get Wrong / Lose**:
  - Arbitrary uncalibrated rubric weights: `templates/factuality.yaml:20-25` assigns static weights (0.4 for subset, 0.6 for superset) without empirical grounding.
  - Fragile heuristic ratios: `ContextRelevancy` divides concatenated character length of extracted sentences by context length (`py/autoevals/ragas.py:402`), penalizing concise synthesis and hallucinating lengths $> 1.0$.
  - No offline cryptographic verification: Outputs are ephemeral float scores without tamper-evident signatures or source proof.
- **What We Do Better in the Desk**:
  - Plumbline certified dossiers: Every canary and receipt produces a signed manifest binding input hash, exact quotes, policy rules, and verifier version offline.
  - Pre-deployment replay calibration: Testing rule and model migrations against historical runs to compute precision/recall delta prior to updating production canaries.
  - Deterministic quote verification: Replacing fuzzy hallucination checks with cryptographic sub-string citations against raw ingested documents.

## 6. Agent patterns
Primarily single-turn judge architectures. Multi-turn dialogue evaluation is supported via `_compute_thread_vars_sync`, which ingests trace objects, strips system prompts, and exposes Mustache variables (`{{thread}}`, `{{thread_count}}`, `{{human_ai_pairs}}`) to evaluate conversation dynamics (`py/autoevals/llm.py:414-430`, `py/autoevals/thread_utils.py:64-69`).

## 7. Model and data layer
Pluggable client seam wrapping `openai.OpenAI` v0/v1 (`py/autoevals/oai.py:65-80, 583-600`). Defaults to Braintrust AI Gateway (`https://gateway.braintrust.dev`) when configured (`py/autoevals/oai.py:12-21`). Direct multi-provider routing (Anthropic, Bedrock, Gemini, Ollama) is supported natively via `LiteLLMClient` adapter without external proxy dependencies (`py/autoevals/litellm.py:1-43`).

## 8. Hackathon-care checks
- **Tracing**: Attaches span metadata (`purpose: "scorer"`) for Braintrust SDK tracing (`py/autoevals/oai.py:616-618`); lacks standalone offline JSONL telemetry.
- **Sample/Offline Mode**: Heuristics (`Levenshtein`, `NumericDiff`, `JSONDiff`, `ListContains`) execute completely offline (`py/autoevals/string.py:52-63`, `py/autoevals/list.py:47-52`).
- **Docker/One-Command**: No Docker setup. Managed via `uv sync` / `pnpm test` (`AGENTS.md:14-30`).
- **Honest Evals**: Live CI action `.github/workflows/eval.yaml:49-54` executes `autoevals.eval.ts` against real CoQA benchmark data.

## 9. Traps seen
- **Documentation Discrepancies**: `SCORERS.md:61-65` claims `Battle` supports tie scores (0.5), but `templates/battle.yaml:16-18` enforces binary Yes (1.0) / No (0.0). `SCORERS.md:417-428` claims `NumericDiff` accepts `max_diff` and `relative` flags, but actual code implements only symmetric normalized diff (`py/autoevals/number.py:47-51`, `js/number.ts:14-18`).
- **Proxy-Dependent Caching**: `run_cached_request` maintains no local cache store; caching occurs exclusively upstream on the proprietary Braintrust Gateway (`py/autoevals/oai.py:628-646`, `README.md:109`).
- **Unbounded Rate-Limit Loop**: Hardcoded 100-retry loop with multiplicative sleep can block threads indefinitely on rate exhaustion (`py/autoevals/oai.py:635-643`).

## 10. Reuse
MIT Licence (`LICENSE:1-21`): Full reuse permitted with notice. High-value candidate components:
1. Tool-choice classification prompt scaffolding (`py/autoevals/llm.py:115-133`).
2. Hungarian assignment bipartite matching for set comparison (`py/autoevals/list.py:72-84`).
3. LiteLLM protocol adapter bridging OpenAI client interfaces to multi-provider engines (`py/autoevals/litellm.py:29-50`).

## 11. Verdict: ADAPT for Desk quality-drift canaries and outcome receipt scoring
- **Three Things to Copy**:
  1. Tool-calling constrained scoring: Enforcing JSON schema tool calls (`select_choice`) with mandatory CoT rationale to eliminate regex parsing brittleness (`py/autoevals/llm.py:115-133, 262-278`).
  2. Bipartite set alignment (`ListContains`): Pairwise distance matrices resolved via `scipy.optimize.linear_sum_assignment` (`py/autoevals/list.py:72-84`).
  3. Parquet benchmark calibration via DuckDB: Streaming ground-truth evaluation datasets directly into CI test harnesses (`evals/src/sync_datasets.ts:14-23`).
- **Three Things to Avoid**:
  1. Arbitrary heuristic ratios like `ContextRelevancy` character counts (`py/autoevals/ragas.py:402-405`).
  2. Hidden proprietary proxy dependencies marketed as local caching features (`py/autoevals/oai.py:628-646`).
  3. Speculative documentation drift between published docs and production prompt templates.
- **Where the Desk is Already Ahead**: Plumbline enforces tamper-evident signed decision receipts, strict substring source-quote verification, and historical replay certificates, none of which exist in autoevals' float-only pipeline.
