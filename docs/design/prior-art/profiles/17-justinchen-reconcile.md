# Profile: dinobby/ReConcile

Reader: Haiku (low effort), 2026-10-16, about 71 seconds, 72k tokens, 13 tool calls. Local clone. Paths relative to the repository root. (The repository owner name is NOT VERIFIED; the licence names Justin Chih-Yao Chen.)

Spot-check (reviewer, against the code): MIT licence (confirmed); confidence buckets in `trans_confidence` at `utils.py:145-151` (confirmed, with a correction: 0.6 or less gives 0.1, between 0.6 and 0.8 gives 0.3, 0.8 to 0.9 gives 0.5, 0.9 to 1 gives 0.8, exactly 1 gives 1, and any value above 1 returns nothing); weighted vote and majority vote at `utils.py:158-176` (confirmed); invalid-output fallback `invalid_result` returns a random answer with confidence 0.0, or "0" for GSM8k, at `utils.py:106-123` (confirmed; the confidence 0.0 means the fake answer carries the smallest weight 0.1 but is not flagged as a fallback). Result: PASS.

## 1. What it is
Code for ReConcile (Chen, Saha, Bansal, 2023): several different models discuss a question over rounds and reach a confidence-weighted consensus. MIT.

## 2. Architecture map
`run.py` drives two phases (independent answers, then discussion rounds); `generation.py` has per-model calls with backoff; `utils.py` has parsing, voting and debate prompt construction; `claude.py` is a web-session client; `data_utils.py` loads four datasets.

## 3. Features and how each behaves
Each model returns reasoning, answer and a confidence. Rounds default to 2. In each round a model sees, for each distinct answer, how many agents chose it and one agent's reasoning, then revises. Optional "convincing" examples from earlier corrections are added.

## 4. How people use it
`pip install -r requirements.txt`, keys in `.env`, `python run.py --num_samples 100 --dataset SQA --round 2`. Results are pickled. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M3/M5 consensus between models)
Each answer's weight is the sum of bucketed confidences of the models that gave it (a tiny constant added for the first), the winner is the highest weight; majority vote is also computed. Debate prompt groups agents by answer and shows the count and one reasoning text. Lost: which model changed its mind and why; the buckets have no stated justification.

## 6. Agent patterns
Three fixed model roles, no separate critic; each model is also the judge of the others in the discussion prompt; fallback is the random answer; rate limits stop the run.

## 7. Model and data layer
Three vendor models hardcoded by name (an OpenAI-style client, Google PaLM, and a web-session Claude client); static datasets.

## 8. Hackathon-care checks
Results saved as a pickle, no structured trace. No sample mode, no Docker. Per-round accuracy for single models, majority vote and weighted vote is reported. The web-session Claude client is a fragile access method and would not pass our rules.

## 9. Traps seen
A fake answer is substituted when parsing fails, so the vote cannot tell it from a real one; confidence buckets are arbitrary; values above 1 break the bucket function; model names are hardcoded; pickled output.

## 10. Reuse
MIT: copy with credit. Candidate parts: confidence-weighted voting across heterogeneous models, the answer-grouped discussion prompt, the per-round state dictionary.

## 11. Verdict: ADAPT for M3 and M5 as a tie-break and disagreement signal
Copy: (1) weighted voting across different model families, with calibrated weights; (2) a discussion prompt grouped by answer with the supporting evidence; (3) a state record of every round and every model's answer.
Avoid: (1) substituting a random answer on a parse failure: record an "invalid" vote and exclude it; (2) uncalibrated confidence buckets: calibrate on gold cases or use a measured score; (3) vendor names fixed in code.
Where we are already ahead: disagreement between models is only a signal; the decision still needs a verified quote and a replayed rule.
