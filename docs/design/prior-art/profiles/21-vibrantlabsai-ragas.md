# Profile: explodinggradients/ragas (now vibrantlabsai)

Reader: Haiku (low effort), 2026-10-16, about 82 seconds, 81k tokens, 33 tool calls. Local clone, commit 298b682. Paths relative to `src/ragas/` unless stated. (The current owner name of the repository is NOT VERIFIED.)

Spot-check (reviewer, against the code): Apache 2.0 header (confirmed); commit 298b682 (confirmed); faithfulness splits an answer into statements and returns a 0 or 1 verdict with a reason per statement from a context-based NLI prompt (`metrics/_faithfulness.py:58-74`, confirmed), and the score counts verdict-1 statements (`_compute_score`, line 182, confirmed); answer relevancy asks the model for a question from the answer plus a "noncommittal" flag (`metrics/_answer_relevance.py:28,38`, confirmed). The reader's claims on the context precision and recall prompts, the persona-driven test-set generator and the `with_debugging_logs` flag were not rechecked. Result: PASS on the parts checked.

## 1. What it is
An evaluation toolkit for LLM and RAG applications: metrics, test-set generation and CLI. Apache 2.0.

## 2. Architecture map
`metrics/` holds about 30 metric files plus a newer `collections/` set; `testset/synthesizers/` builds test sets from a knowledge graph; LLM and embedding wrappers cover LangChain and LlamaIndex. A metric takes a typed sample and returns a result object that can carry traces.

## 3. Features and how each behaves
Faithfulness (statement extraction, then per-statement support check against the context), context precision (was each retrieved chunk useful), context recall (which answer statements come from the context), answer relevancy (question regenerated from the answer, noncommittal flag), plus rubric, aspect-critic, tool-call and goal-accuracy metrics. Metrics check that required sample fields exist before scoring.

## 4. How people use it
`pip install ragas`, build a sample, call a metric's score method with an LLM. A quickstart command scaffolds an evaluation. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M11 evaluation, M4 claim support)
Faithfulness = supported statements divided by all statements, each verdict from an LLM reading the context. State sits in typed prompt and result objects, nothing carried across calls. Rules are prompt instructions with a few fixed examples. Limit: every metric is an LLM judgment; there is no deterministic check, no quote requirement, and no stored reason for a failed parse.

## 6. Agent patterns
None. Linear scoring; retries live in the model wrapper.

## 7. Model and data layer
Wrapper interfaces for LLMs and embeddings (OpenAI, Anthropic, LiteLLM and others); typed sample objects.

## 8. Hackathon-care checks
Result objects support a trace of inputs and outputs; debug logging is a flag. Docker only for benchmarks. No sample mode. Keys from the environment.

## 9. Traps seen
All-LLM judging; a bad JSON reply raises instead of recording a gap; presence-only input checks, an empty context passes; fixed prompt examples.

## 10. Reuse
Apache 2.0: copy with credit and notice. Candidate parts: the statement-then-verdict structure for faithfulness, the noncommittal check, typed sample and result objects with traces.

## 11. Verdict: ADAPT for M11; use as an outside cross-check, not as our judge
Copy: (1) faithfulness as supported statements over all statements, with a stored reason per verdict; (2) a noncommittal check so evasive answers do not pass as "no contradiction"; (3) typed sample and result objects that carry traces.
Avoid: (1) an LLM verdict as the only check: ours starts with a deterministic quote match; (2) raising on a bad reply with no recorded gap; (3) input validation that accepts empty context.
Where we are already ahead: deterministic guarantees with named boundaries (spec 9a); ragas scores are model opinions.
