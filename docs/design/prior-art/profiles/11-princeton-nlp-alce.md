# Profile: princeton-nlp/ALCE

Reader: Haiku (low effort), 2026-10-16, about 89 seconds, 86k tokens, 28 tool calls. Local clone. Paths relative to the repository root.

Spot-check (reviewer, against the code): MIT licence (confirmed); NLI model `google/t5_xxl_true_nli_mixture` at `eval.py:29` (confirmed); a sentence with no citation, or a citation number beyond the document list, scores zero entailment at `eval.py:362-367` (confirmed); citation precision counts at `eval.py:353-417` (confirmed). Corrections by the reviewer: the reader's "silent failure on malformed ranges" is wrong, each case is logged at `eval.py:361` and scores zero by design; its "reinspect AutoAIS for licensing" was not examined and stays NOT VERIFIED. Result: PASS on mechanism.

## 1. What it is
A benchmark and evaluation code for LLM answers with citations (ASQA, QAMPARI, ELI5). It measures whether each cited passage supports each sentence. MIT.

## 2. Architecture map
Prompt and generation script `run.py`, evaluation `eval.py`, retrieval wrapper `searcher.py`, post-hoc citation `post_hoc_cite.py`, configs and prompts in folders, human evaluation data in `human_eval/`.

## 3. Features and how each behaves
Generation with in-context demonstrations and cited documents; an interactive mode where the model asks for documents; evaluation of fluency, correctness and citation quality. Out-of-range or missing citations score zero.

## 4. How people use it
`download_data.sh`, run `run.py` with a config, then `eval.py --f <result> --citations`. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M4 explanation, citation checks)
Citation recall: for each sentence, strip the citation marks, join the cited passages, and ask an NLI model whether they entail the sentence (1 or 0). Citation precision: for a sentence with several citations that passes recall, each citation is dropped in turn and counted as useless if the rest still entail the sentence. Scores average over sentences. Lost: sentence-level only, no span-level evidence, quotes are not required, and the entailment model is a learned judge, not a deterministic check.

## 6. Agent patterns
A linear pipeline. The interactive mode is one model choosing documents between turns. No critic loop; the metrics run after the fact. API calls retry up to five times.

## 7. Model and data layer
T5-XXL NLI judge, GTR-T5 or TF-IDF retrieval, OpenAI and Hugging Face generators. Data: JSON with question, output, and docs (title, text).

## 8. Hackathon-care checks
Seeded configs and pre-downloaded data. Logs show each judgment but are not written as a structured trace. Human evaluation with agreement scores is included, which is the strength here. No sample mode, no Docker.

## 9. Traps seen
Citation format fixed to `[N]` with 1-based numbers; the judge model is large and slow; one global model load; sentences are the unit, so a long sentence with several claims gets one verdict.

## 10. Reuse
MIT: copy with credit. Candidate parts: the recall and precision definitions, the drop-one-citation test, the citation regex.

## 11. Verdict: ADOPT the metric definitions for M4 evaluation; ADAPT the checker
Copy: (1) recall as "cited evidence jointly entails the claim"; (2) precision by removing one citation at a time; (3) human-agreement check of the metric before trusting it.
Avoid: (1) a learned NLI judge as the only check: we require a verbatim quote check first, then entailment as a second opinion; (2) sentence-level units for multi-claim sentences; (3) metrics with no stored trace.
Where we are already ahead: deterministic quote verification and certificates; ALCE only grades after generation.
