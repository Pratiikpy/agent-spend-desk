# Profile: princeton-nlp/tree-of-thought-llm

Reader: Haiku (low effort), 2026-10-16, about 66 seconds, 73k tokens, 24 tool calls. Local clone. Paths relative to `src/tot/`.

Spot-check (reviewer, against the code): MIT licence (confirmed); per-prompt value cache and a duplicate candidate scoring 0 at `methods/bfs.py:8-26` (confirmed); greedy and sampling selection at `bfs.py:70-76` (confirmed); the step log `{step, x, ys, new_ys, values, select_new_ys}` at `bfs.py:83` (confirmed); value map `impossible 0.001, likely 1, sure 20` marked `# TODO: ad hoc` at `tasks/game24.py:90` (confirmed); README says the reproduced Game of 24 run scored 69% against the paper's 74% (confirmed, line 83). Reviewer addition: sampling selection divides by `sum(values)` (`bfs.py:71`), which fails if every value is 0; the reader missed it. Defaults the reader quoted (beam width 5, three evaluation samples) were not rechecked. Result: PASS.

## 1. What it is
Official code for Tree of Thoughts (Yao et al., 2023): search over partial reasoning steps with the model proposing and scoring them. MIT.

## 2. Architecture map
A task interface (`tasks/base.py`), tasks for Game of 24, creative writing and crosswords, a breadth-first search `solve()` in `methods/bfs.py`, an OpenAI wrapper in `models.py`, task prompts, logs of the paper's runs.

## 3. Features and how each behaves
Each step: generate candidate next thoughts (sample or propose), evaluate each (a value prompt or a vote across candidates), select the best k (greedy or sampled), continue. Duplicate candidates get value 0. Evaluation results are cached by prompt.

## 4. How people use it
`pip install tree-of-thoughts-llm`, set `OPENAI_API_KEY`, run the README snippet or `run.py` with task and method arguments. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M4/M5 search over reasoning, pruning)
State is the list of partial outputs. Value from the model's words ("sure", "likely", "impossible") mapped to fixed numbers and summed over samples. Pruning keeps only the top k per step; everything else is discarded with no way back. Lost: pruned branches and the reasons they scored low are kept only in the step log.

## 6. Agent patterns
One model acts as generator and evaluator in a fixed pipeline; no critic role separate from the generator; no fallback if an evaluation call fails.

## 7. Model and data layer
OpenAI chat models only (hardcoded names); tasks load local data files. A new model needs a code change in `models.py`.

## 8. Hackathon-care checks
Per-run JSON step log is good for traces. No sample mode, no Docker. Results and paper trajectories are included in `logs/` and the README is open about the 69% versus 74% gap.

## 9. Traps seen
Ad hoc value constants; sampling selection can divide by zero; an unparseable evaluation silently scores low; evaluation by the same model that generated the thoughts; no depth or cost bound beyond the step count.

## 10. Reuse
MIT: copy with credit. Candidate parts: the generate, evaluate, select loop; the cache; the step log.

## 11. Verdict: ADAPT for M4 and M5 as an optional bounded search over candidate explanations
Copy: (1) the generate-evaluate-select loop with a per-step log; (2) caching identical evaluations; (3) a task interface that keeps prompts out of the search code.
Avoid: (1) hand-set value constants: calibrate on our gold cases; (2) one model judging its own thoughts; (3) discarding pruned branches: keep them as recorded alternatives with the reason.
Where we are already ahead: candidates are checked by deterministic evidence checks and a separate attacker, not by the generator's own score.
