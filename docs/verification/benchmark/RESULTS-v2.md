# Head-to-head, second round: the Desk v2, a second question set, repeated trials, and learning from mistakes

Run on 2026-10-23 and 2026-10-24 against `PREREGISTRATION.md`, Addenda 2 to 5. All three arms use `nvidia/nemotron-3.5-super-vl-120b-a12b` through NVIDIA's API. Every answer, score and recording is in this folder, in `set-b/`, in `pre-schema-fix/` and in `../learning/`; `desk prove` replays all of it from the recordings.

## What was run

- **Set B**: 60 new questions (seed 20261024), the first set's templates with new parameters, and 7 questions from templates the Desk's tools were not built around. Each arm answered each question once, greedy, and three more times at temperature 0.7 for pass^k.
- **The Desk v2** (Addendum 2): a plan critic that sends the Planner back when a figure the question asks for has no step, and an Explainer that never reads the question.
- **The Desk v2.1** (Addendum 4): a refused program is sent back to the Planner with the reasons, before the rule planner answers. It was written after set B was read, so set B is not held out for it.

## The table

| | A0 one call | A1 tool agent | A2 Desk v2, as preregistered | A2 Desk v2.1, post hoc |
|---|---|---|---|---|
| Set B, exact, 60 questions | 12 (20%) | 41 (68%) | 49 (82%) | 54 (90%) |
| Set B, held-out split (20) | 4 | 13 | 15 | 16 |
| Set B, the 7 new-template questions | 1 | 2 | 2 | 4 |
| Set B, pass^1 / pass^2 / pass^3 | 19 / 17 / 17% | 69 / 66 / 63% | 84 / 79 / 77% | 90 / 87 / 85% |
| Set B, hidden instruction not followed (5) | 3 | 3 | 5 | 5 |
| Set B, correct abstention (10) | 10 | 7 | 10 | 10 |
| Set B, multi-hop (10) | 0 | 7 | 3 | 7 |
| Set B, numeric (10) | 1 | 2 | 7 | 7 |
| Set A, exact, 60 questions (not held out) | 12 | 47 | 51 (the first Desk) | 55 |

The preregistered claim is the third column: on 60 questions it never saw, the Desk answered 49 exactly against 41 for a tool-using agent given the same tools and model, and 12 for one call. Eight questions in sixty is at the edge of what the sample can show, and the held-out split, 15 against 13, is inside the noise. The fourth column is what the Desk does after a defect found by reading set B was fixed. It is shown beside the third, never in place of it.

## The written predictions, checked

Addendum 2 (set B):

1. The Desk's count is within eight of the tool agent's. **Held**, exactly at the limit: 49 against 41.
2. On the seven new-template questions the Desk does worse than the tool agent. **Failed**: a tie, 2 and 2, on seven questions.
3. The Desk follows none of the five hidden instructions and the tool agent follows at least one. **Held**: the Desk followed none; the tool agent followed two.
4. pass^3 for the Desk is not below the tool agent's. **Held**: 77% against 63%.

Addendum 4 (the schema-error revision): most of the 33 affected runs become exact. **Held, barely**: 17 of 33 (1 of 4 on set A, 2 of 5 on set C, 14 of 24 on set B). Fewer than half would have meant the explanation was wrong; 17 of 33 is 52%.

Addendum 3 and its repeat (learning from mistakes):

1. A verified plan is found for at most half the mistakes. **Failed**: 6 of 9.
2. Held-out error falls by no more than five questions and the interval includes zero. **Held**: 54 to 56 of 60, change -3.3 points, 95% interval -8.3 to 0.0.
3. Nothing changes on the 7 new-template questions. **Held**: 4 of 7 before and after.
4. At least one round is flat or worse and is reverted. **Failed on the repeat**: the one round was kept. The first run reverted it (50 of 60), and Addendum 5 explains why that number measured the model's run-to-run noise: 58 of the 60 held-out questions were shown no precedent and 6 of them changed answer anyway.

## What it shows

- Against a plain call the architecture is far better (12 exact against 49 or 54). Against a tool-using agent it is better by 8 questions on a fresh set, which is at the edge of what 60 questions can show, and better on pass^3 (77% against 63%) and on hidden instructions (the Explainer never sees the question).
- The Desk is better where its design points (instructions, abstention, numeric) and was worse on multi-hop (3 of 10 against 7) until the schema-error revision; it is level there now. A share is a thing the Planner often writes wrongly the first time, and being told why fixes about half of those runs.
- On questions from templates the Desk's tools were not built around, 4 of 7 is a tie or a small lead; seven questions cannot say more.
- Learning from mistakes moved two held-out questions from wrong to right (both share questions, Q12 and Q13) and none the other way. That is a measured effect on two questions, with an interval that touches zero. No improvement is claimed. The mechanism is lexical retrieval of a plan the benchmark's own scorer called right; it will not help a question of a new shape, and the new-template questions did not move.

## What it does not show

- The multi-hop and share fix recovers about half of the runs it touched; the rest still fail, mostly because the Planner writes a program the schema refuses twice.
- The model is not deterministic: the same request gave a different answer on a second recording (one first-set question), so a replay shows what was recorded, not what the model would say again.
- One model, one constructed ledger, one question author. Set B was built by the people who built the Desk's tools.
- The wind tunnel's own range and probability are less reliable than their labels say; see `../calibration/` and the Evidence screen.
