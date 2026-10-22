# Profile: Arize-ai/phoenix

Reader: Claude Sonnet, 2026-10-20. Remote read through `gh api` and raw fetches, no clone. Licence read first: `LICENSE:1` is Elastic License 2.0 (GitHub reports "NOASSERTION"), 11,916 stars, last commit read 2026-10-20T13:17Z (checked 2026-10-20). ELv2 forbids providing the software to third parties as a hosted or managed service (`LICENSE:10`) and bars circumventing licence-key functionality (`LICENSE:12`): **mechanism only, rebuild from the idea; copy no code.** Paths are under `src/phoenix/`.

## 1. What it is
Arize's open-source AI observability and evaluation app: OpenInference/OTLP trace ingestion, span and trace annotations, datasets, experiments, prompts, evaluators, and per-span cost. Python/FastAPI with SQLAlchemy on SQLite or Postgres; React UI.

## 2. Architecture map
Spans arrive over OTLP. GenAI-convention spans are converted to OpenInference attributes (`trace/gen_ai/conversion.py`, 700 lines), the span is stored (`db/insertion/span.py`), and cost is calculated by `server/cost_tracking/` from the span's attributes and a model store (`span_cost_calculator.py:13-42`). Tables of interest are all in `db/models.py` (3,520 lines).

## 3. Features and how each behaves
Cost is a first-class table pair: `SpanCost` (`models.py:2853-2964`) holds `total_cost`, `prompt_cost`, `completion_cost` and matching token counts, keyed to span and trace with `span_start_time` indexed; `SpanCostDetail` (2967-2988) holds one row per `(token_type, is_prompt)` with tokens, cost and cost per token. Annotations are separate rows per span, trace, document, session and experiment run (`SpanAnnotation` 1274-1313, `TraceAnnotation` 1316, `DocumentAnnotation` 1355, `ProjectSessionAnnotation` 1399). Experiments tie a dataset version to runs (`Experiment` 1680-1700, `ExperimentRun` 1781-1822, `ExperimentRunAnnotation` 1825-1850).

## 4. How people use it
`pip install arize-phoenix`, point an OpenInference or OTel exporter at it, browse traces and cost, run experiments from a dataset. Usage evidence beyond the repository: NOT VERIFIED.


## 5. Mechanism for the Desk
**Model match** (`server/cost_tracking/cost_model_lookup.py`). Each model row has a compiled regex `name_pattern`, optional `provider`, `start_time`, `is_built_in` (`models.py:2569-2616`). A span matches when `start_time <= span start` and the regex finds the model name (cost_model_lookup.py:137-143). With several candidates: user-defined models are tried before built-in ones, a provider match is preferred inside a tier, then the highest tuple of (regex specificity score, start_time, tie-break) wins, built-in ties going to the lowest id and user ties to the highest (30-44, 153-171). Time-bounded rows give correct historical prices. Specificity scoring lives in `regex_specificity.py` (file read: NOT VERIFIED).

**Per-token-type pricing** (`TokenPrice`, `models.py:2619-2641`): `token_type`, `is_prompt`, `base_rate`, optional `customization`. The calculator demands that a prompt side, if present, has an `input` price and a completion side an `output` price, else it raises (`cost_details_calculator.py:63-73`). Detailed counts come from `llm.token_count.prompt_details` and `completion_details`; any detailed type without its own price falls back to `input` or `output` (119-146). Remaining default tokens are total minus details, per the docstring (88-90; code after line 160 not read in full).

**Threshold surcharge**: a price can switch to `new_rate` when a named span attribute exceeds a threshold (`token_cost_calculator.py:25-41`), which models long-context surcharges. If the attribute is absent, base rate applies silently (37-38).

**Totals**: `SpanCost.append_detail` adds only truthy cost and tokens, so an unpriced token type contributes tokens but zero cost to the span (2951-2964). `total_cost_per_token` is a SQL expression. Token totals are repaired when only a total was sent: if total exceeds prompt plus completion, the missing side is derived (`helpers.py:16-64`); any exception returns zeros and logs (`helpers.py` end).

**OTel gen_ai input**: `gen_ai.usage.input_tokens` becomes prompt tokens, cache read and write become prompt-detail buckets, total is input plus output (`trace/gen_ai/conversion.py:127-148`). The convention says input already includes cached tokens (see profile 72), so cache buckets are subtracted from "input" in the details pass; this matches Langfuse's rule.

**Evals**: annotations are score (float), label, explanation, `annotator_kind` LLM, CODE or HUMAN, a `source` API or APP, and a unique key `(name, span, identifier)` (`models.py:1280-1312`), so one named score can be overwritten per identifier. Evaluators are rows of kind LLM, CODE or BUILTIN (`models.py:2991-3020`).

**What it does not do**: no outcome link from cost to a result the user cares about; cost per span is estimated from list prices, with no invoice reconciliation; no caps or stop action; no scheduled canary on the owner's own task set (experiments are manual or SDK driven; scheduling NOT VERIFIED); no replay on a cheaper route with a pass rate.

## 6. Agent patterns
Not an agent system; evaluators are single calls.


## 7. Model and data layer
Built-in price manifest `server/cost_tracking/model_cost_manifest.json`; user-defined rows override it. `SpanCostCalculator` takes a `GenerativeModelStore` (`span_cost_calculator.py:9,14-18`); the lookup supports incremental `merge` with soft deletes (`cost_model_lookup.py:53-68`); the store daemon's code: NOT VERIFIED.


## 8. Hackathon-care checks
One pip install on SQLite is a good model for our offline mode. Trace format is OpenInference (`llm.*` names).


## 9. Traps seen
ELv2; unpriced token types silently cost zero; a missing surcharge attribute silently falls back to base rate; `float` money columns (`models.py:2879`).


## 10. Reuse
Elastic License 2.0: mechanism only. Rebuild: time-bounded regex model rows with specificity ordering; the two-table cost shape (span total plus per-type detail rows).

## 11. Verdict: ADAPT
Copy: (1) time-bounded, regex-matched price rows with user rows overriding built-in ones; (2) one cost-detail row per token type so every bucket is auditable; (3) a threshold-based surcharge rule keyed on a span attribute.
Avoid: (1) float money columns; (2) silent zero for an unpriced type; (3) requiring both an `input` and `output` price or raising, which makes a half-defined model unusable instead of flagged.
