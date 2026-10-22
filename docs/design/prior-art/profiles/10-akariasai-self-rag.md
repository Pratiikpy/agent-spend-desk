# Profile: AkariAsai/self-rag

Reader: Haiku (low effort), 2026-10-16, about 85 seconds, 86k tokens, 24 tool calls. Local clone. Paths relative to `retrieval_lm/` unless stated.

Spot-check (reviewer, against the code): MIT licence (confirmed); grounding score `(fully + 0.5 * partially) / sum` at `run_short_form.py:139-140` (confirmed); final score `w_rel * relevance + w_sup * ground + w_use * utility` at `run_short_form.py:156-157` and `run_long_form_static.py:94-95` (confirmed); missing reflection tokens silently get log-probability -100 at `run_short_form.py:77,108,120,131` (confirmed). Corrections by the reviewer: the reader said the retrieval threshold defaults to 0.2 and is "hardcoded"; the command-line default is none (`run_short_form.py:270-271`), the function default is 0.5 (line 53), and 0.2 appears only in the README example. The utility weight is 0.5 in the functions but 1.0 on the command line (line 285). Result: PASS on mechanism, FAIL on defaults (fixed below).

## 1. What it is
Code and models for Self-RAG (ICLR 2024): a language model trained to decide when to retrieve, generate, and critique its own output with special reflection tokens. MIT.

## 2. Architecture map
A generator model with extended vocabulary (7B and 13B Llama 2 checkpoints), a critic model used to label training data, Contriever for retrieval, vLLM serving with log-probabilities. Inference scripts: `run_short_form.py` and `run_long_form_static.py`. Training data creation lives in `data_creation/` (critic, then generator).

## 3. Features and how each behaves
Reflection tokens: retrieve or not; passage relevant or not; output fully, partially or not supported; utility 1 to 5. Adaptive retrieval compares the retrieve and no-retrieve token probabilities with a threshold. Segment-level beam search ranks candidate continuations by the weighted token scores.

## 4. How people use it
Install requirements, download the checkpoints, run the short-form script with a task file, optional flags for grounding, utility and sequence score. Training needs a six-step data pipeline that depends on GPT-4 labels. No tests; evaluation relies on external tools (ALCE, FActScore). Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M5 critic, M4 explanation)
Scores are read from token log-probabilities at the first occurrence of each reflection token and normalised within each group. Support score gives full credit for "fully supported" and half for "partially". Utility maps the five levels to -1 to 1. The weighted sum chooses the beam. There is no external verifier: the model grades its own output, and the scores are calibration-free numbers from one model. Not read: the training loss and the critic data prompts.

## 6. Agent patterns
No agent loop. A single model critiques inside generation; confidence-based branching is the retrieve threshold and the beam. No separate evaluator, no revision after a failed critique.

## 7. Model and data layer
Llama 2 base, Contriever embeddings (768 dimensions), vLLM. Datasets: PopQA, ARC, PubHealth, ASQA, with Wikipedia passages. Paths and models are arguments.

## 8. Hackathon-care checks
No sample mode, no Docker, no structured trace; decisions exist only as scores. Evaluation scripts are in `metrics.py`. GPU-heavy to run. No sanitisation of retrieved text.

## 9. Traps seen
Absent reflection tokens become -100 without any warning; the code assumes the first occurrence of a token is the judgment position; different default weights in the functions and the command line; training depends on GPT-4 critic labels; the multi-step data pipeline has no single script.

## 10. Reuse
MIT: copy with credit. Candidate parts: the weighted multi-criterion scoring over support, relevance and utility; the idea of a retrieve-or-not decision with a threshold. The model weights and training code do not fit our stack.

## 11. Verdict: ADAPT the scoring idea for M5; do not adopt the system
Copy: (1) separate scores for relevance, support and usefulness combined by explicit weights; (2) a half-credit rule for partial support, with the weights written down; (3) a retrieve-or-not threshold that is a visible parameter.
Avoid: (1) a model grading its own output with no outside check: our claims need quote verification and a replay; (2) silent default scores when a signal is missing, record a gap instead; (3) defaults that differ between code paths.
Where we are already ahead: deterministic quote checks and certified decisions; Self-RAG's support score is a probability from the same model.
