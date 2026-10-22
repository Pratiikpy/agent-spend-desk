# Profile: shmsw25/FActScore

Reader: Haiku (low effort), 2026-10-16, about 99 seconds, 80k tokens, 29 tool calls. Local clone. Paths relative to `factscore/` unless stated.

Spot-check (reviewer, against the code): MIT licence (confirmed); no test directory (confirmed by listing); retrieval of five passages and the "True or False?" prompt at `factscorer.py:215-223` (confirmed); logit comparison of token ids 5852 and 7700 at `factscorer.py:238-241` (confirmed); NPM threshold 0.3 at `factscorer.py:259` (confirmed). Corrections by the reviewer: the reader wrote the length penalty as `score *= exp(1 - gamma/n)` for every response; the code applies it only when the number of facts is gamma or fewer, otherwise the penalty is 1 (`factscorer.py:188-190`). It also described the line `is_supported = True` (`factscorer.py:255`) as a fallback when the model is unavailable; it is the branch for running with no language model (retrieval-only mode), where every fact counts as supported. Result: PASS on structure, two details corrected.

## 1. What it is
A library that scores the factual precision of long text: split into atomic facts, check each against a knowledge source, report the share supported. MIT; EMNLP 2023.

## 2. Architecture map
Atomic-fact generator (`atomic_facts.py`), knowledge source with SQLite store and BM25 or embedding retrieval (`retrieval.py`), verification by a language model or the NPM masked-model scorer (`factscorer.py`, `npm.py`), pickle cache for model calls (`lm.py`).

## 3. Features and how each behaves
Input: topic and generated text. Output: per-fact support decisions, the score, the share of responses that answered, and facts per response. Defaults: Wikipedia snapshot of 2023-04-01, gamma 10, retrieval plus ChatGPT. Responses with no extracted facts are marked None. A topic missing from the knowledge base fails an assertion. Cost is about one dollar per 100 sentences (per the README).

## 4. How people use it
`pip install factscore`, download data, run the module with an input file and a model name, or call `get_score` from Python. Pre-computed results for twelve models are listed. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M4 claim decomposition, M5 support checking)
Decomposition: split by paragraph and sentence, retrieve the most similar demonstration by BM25, prompt a model with seven examples, split its bullet list into facts. Verification: retrieve five passages for each fact, ask True or False, read the answer from logits or text; optionally require the NPM probability above 0.3 as well. Score is the mean of supported facts, with the length penalty for short answers. Lost: no link from each fact back to its sentence, no confidence, binary decisions only, no quote from the evidence.

## 6. Agent patterns
A linear pipeline with caching and batches. No critic, no branching, no revision.

## 7. Model and data layer
InstructGPT or ChatGPT for decomposition and checking, optional LLaMA and RoBERTa-based NPM. Knowledge sources are pluggable through `register_knowledge_source`.

## 8. Hackathon-care checks
No trace or structured log. No sample mode, no Docker, no tests. Key read from a file. Reported correlation between the ChatGPT and LLaMA-plus-NPM verifiers is in the README (the reader's number 0.99 was not rechecked, NOT VERIFIED).

## 9. Traps seen
Retrieval-only mode scores every fact as supported; binary judgments with no evidence; the demonstration corpus is baked in; paid API calls dominate cost; the knowledge-base assertion gives an indirect error.

## 10. Reuse
MIT: copy with credit. Candidate parts: the demonstration-prompted decomposition, the pluggable knowledge-source abstraction, the cache of model calls.

## 11. Verdict: ADAPT for M4 and M5
Copy: (1) atomic-fact decomposition with retrieved demonstrations; (2) a pluggable knowledge source behind one interface; (3) caching model calls by prompt.
Avoid: (1) a mode where unchecked facts count as supported: unchecked must be recorded as unchecked; (2) binary verdicts with no quote or span; (3) facts that lose their link to the source sentence.
Where we are already ahead: every claim carries a verified quote and a certificate; FActScore keeps neither.
