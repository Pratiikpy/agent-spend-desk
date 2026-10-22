# Profile: google-deepmind/long-form-factuality (SAFE)

Reader: Haiku (low effort), 2026-10-16, about 79 seconds, 87k tokens, 21 tool calls. Local clone. Paths relative to the repository root.

Spot-check (reviewer, against the code): `max_steps = 5`, `max_retries = 10`, `num_searches = 3` at `eval/safe/config.py:47-56` (confirmed); licence: the clone's LICENSE file states MIT only for `third_party/factscore/*` and the rest of the repository is covered by the top-level licence, read by the reader as Apache 2.0 (the full licence text was not re-read, so Apache 2.0 for the main code is NOT VERIFIED); claim splitting is delegated to the third-party FActScore code (confirmed by listing `third_party/`). Other line references and the cost figures were not rechecked. Result: PASS with caveats.

## 1. What it is
Google DeepMind's benchmark (LongFact) and method (SAFE, Search-Augmented Factuality Evaluator) for the factuality of long answers (Wei et al., 2024).

## 2. Architecture map
Four stages: split into atomic facts (FActScore code), rewrite each fact to be self-contained, classify whether it is relevant to the prompt, then verify it with a search loop. Entry in `eval/safe/search_augmented_factuality_eval.py`; model and search wrappers in `common/`.

## 3. Features and how each behaves
Per fact: an LLM rewrites vague references; an LLM decides relevance (defaults to relevant if parsing fails); the model issues up to five Google (Serper) queries one after another, each informed by earlier results; a final LLM call decides supported or not. The result counts supported, unsupported and irrelevant facts per response.

## 4. How people use it
Conda environment, add OpenAI and Serper keys to a config file, run the evaluation module on a result file. Unit tests per module with a fake model. Cost per response is stated in the README (about $0.20 to $0.40; not rechecked). Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M4/M5 claim check by search)
The search loop is the useful part: next query = model's choice given what it already learned, capped at five. A record per statement keeps the fact, the revised fact, the relevance, the search results and the final label. Lost: the model's reasoning text is dropped and only the bracketed label is kept.

## 6. Agent patterns
One model in a fixed pipeline; retries are for parse failures, not for disagreement. No critic, no branching on confidence.

## 7. Model and data layer
A model base class with OpenAI and Anthropic subclasses and a fake model for tests; Serper Google search only.

## 8. Hackathon-care checks
Good unit tests with a fake model. The per-statement record is a usable trace. The README reports 72% agreement with human raters and wins 76% of disagreements (as stated there; not rechecked). No sample mode or Docker.

## 9. Traps seen
Parse failures retry up to 10 times per step with no backoff or total time bound; relevance defaults to "relevant" on a failed parse; labels extracted by regex; model reasoning discarded; search is open web, not our connectors.

## 10. Reuse
Apache 2.0 for the main code (NOT VERIFIED beyond the file header) and MIT for the third-party part: copy with credit once the licence text is confirmed. Candidate parts: the iterative query loop, the self-containment rewrite, relevance filtering before verification.

## 11. Verdict: ADAPT for M4 and M5
Copy: (1) the iterative evidence search where each query depends on what is already known, with a hard cap; (2) rewriting a claim to be self-contained before checking it; (3) relevance filtering before spending evidence queries.
Avoid: (1) defaulting to "relevant" or to a label when parsing fails: record a gap; (2) throwing away the reasoning; keep it in the trace; (3) unbounded retries.
Where we are already ahead: searching our own sources with a verbatim quote requirement and a separate attacker that tries to refute each finding.
