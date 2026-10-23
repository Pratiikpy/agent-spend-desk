# Head-to-head benchmark: results

Run on 2026-10-23 against `PREREGISTRATION.md` (question set `sha256:8d61892d4f3c`). All three arms use `nvidia/nemotron-3.5-super-vl-120b-a12b` through NVIDIA's API. Every answer and score is in `results.jsonl`; `npm run desk -- bench report --sample` prints the table, and `npm run desk -- prove` replays all 180 runs from the recorded replies and checks they score the same (it passes, and it does not say the Desk wins).

## The table

| | A0 one call | A1 tool agent | A2 the Desk |
|---|---|---|---|
| Exact, all 60 questions | 12 (20%) | 47 (78%) | 51 (85%) |
| Exact, dev split (40) | 8 (20%) | 32 (80%) | 35 (88%) |
| Exact, held-out split (20) | 4 (20%) | 15 (75%) | 16 (80%) |
| Close, within 1% | 25% | 85% | 85% |
| Lookup (10) | 20% | 100% | 100% |
| Multi-hop (10) | 0% | 80% | 60% |
| Counterfactual (10) | 0% | 90% | 100% |
| Unanswerable, correct abstention (10) | 100% | 80% | 100% |
| Adversarial (10) | 0% | 60% | 90% |
| Numeric (10) | 0% | 60% | 60% |
| Answers stating a figure nothing asked for | 85% | 12% | 10% |
| Model calls per question | 1.0 | 1.9 | 2.0 |
| Tokens per question | 7,656 | 2,533 | 2,914 |
| Median seconds per question | 12.4 | 23.4 | 20.0 |

## What it shows

- Asking the model once with a summary in the prompt is the wrong way to do this. It sums a column of daily figures badly (12 of 60 exact) and states a figure nobody asked for in 85% of its answers.
- The Desk's answers are 4 questions better than the tool-using agent's over all 60, and 1 question better on the 20 held-out (16 against 15). That is inside the noise for sixty questions and is not a finding. We do not claim the architecture beats a tool-using agent on exactness. Nothing in these numbers supports that claim; they support only "far better than a single call, and about level with an agent that has the same tools".
- Where the Desk is different: it abstained correctly on all ten unanswerable questions (the agent on eight), it is ahead on the adversarial category (9 of 10, against 6), and it states about as few unrequested figures as the agent (10% against 12%). It is behind on multi-hop (6 of 10 against 8).

## How the Desk got here, and why the first run is also published

The first run of the Desk on the 40 dev questions (`results-dev-run-1.jsonl`) was 20 of 40 against the agent's 31 of 40. Two of the four written predictions failed on dev (1 and 2), one held (3, a tie) and one held as predicted (4). The answers showed why (the Desk stated the ingredients of a derived figure and never the figure; it could not decline a question the ledger cannot hold, and once said that moving to a model never used "would have saved" the whole spend). Using only the dev questions we added four steps that code works out (share, average per day, percentage of a spend, days above a figure) and a way for the Planner to decline. The dev result went to 35 of 40, which is a result of tuning on those 40 questions. The held-out 20 were run once afterwards, with the Desk and the baselines frozen. The held-out figure, 16 of 20, is the one to quote, with its width: it is 20 questions.

## What the Desk still gets wrong (all nine misses, in the file)

- Four share questions (Q11 to Q14, one held out): the Planner asked for the model's spend and did not ask for the share step, so the answer is an ingredient and not the percentage. The new step exists; the model does not reliably use it.
- A hidden instruction followed (Q42, held out): the answer ends with the word BANANA. The Auditor checks figures, not extra words, and the Explainer complied. The agent made the same mistake on the same question.
- Two numeric questions where the Desk stated the spend and never converted to thousands of dollars (Q54, Q55).
- A count of model calls (Q58): the Planner declined with "model call counts are not tracked", although the spend step states how many calls it covers. The new decline path over-fired.
- One question answered with an unrelated list of sessions (Q57).

## What this does not show

One model and one constructed ledger, one run of each question and arm at temperature 0, so nothing about reliability over repeated runs (the pass^k check stays NOT RUN). The questions were generated from templates the Desk's tools were built around, so the lookup and numeric categories favour it by design. The scoring rules are ours; they are strict (a dollar figure must be right to the cent for "exact") and are written down before the run.
