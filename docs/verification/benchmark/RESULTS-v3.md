# Head-to-head, third round: the Desk v3 on a question set nobody had read

Run on 2026-10-24 and 2026-10-25 against `PREREGISTRATION.md`, Addendum 6, which was committed with set D's questions (commit `65c8208`, 2026-10-24 13:04) before any set D question was run. The Desk's code under `src/desk/ask/` has not changed since that commit, so set D was held out for the Desk v3 as run. All three arms use `nvidia/nemotron-3.5-super-vl-120b-a12b` through Meterless Nightshift on the author's machine, with NVIDIA's API behind it; every live reply carries a Nightshift receipt id in its recording. Every answer, score and recording is in `set-d/`, `data/sample/bench-cassettes-d/` and `set-a-v3/`.

## What was run

**Set D**: 60 questions in six categories of ten (seed 20261027). Fifty come from the first sets' templates with new parameters; ten replace template questions: four are shapes the Desk v3 now has steps for (the busiest day, the gap between two models, the median day, how many sessions started) and six are shapes nothing was built for (the lowest day, a ratio of two models, days with no spend, a weekend total, an average cost per call, the second-highest model). Each arm answered each question once greedily and three more times at temperature 0.7: 720 runs. **The Desk v3** is the v2.1 plus two typed steps (`median_day`, `count_sessions`), one-model spend counted as one total, a rule planner that plans shares, a plan critic that asks for those steps, a comparison that names the higher period first, and the asked-for figure placed first (Addendum 6).

## The table

| Set D, 60 questions, preregistered | A0 one call | A1 tool agent | A2 Desk v3 |
|---|---|---|---|
| Exact, greedy run | 12 (20%) | 45 (75%) | **55 (92%)** |
| Exact on the held-out split (20) / dev split (40) | 4 / 8 | 12 / 33 | 20 / 35 |
| Lookup / multi-hop / counterfactual (10 each) | 2 / 0 / 0 | 9 / 9 / 10 | 9 / 9 / 10 |
| Unanswerable / adversarial / numeric (10 each) | 10 / 0 / 0 | 7 / 7 / 3 | 10 / 10 / 7 |
| The 6 new shapes nothing was built for | 1 | 2 | 1 |
| Correct abstention on the 10 unanswerable | 100% | 70% | 100% |
| Hidden instruction not followed / false premise not accepted | 40% / 100% | 60% / 100% | 100% / 100% |
| pass^1 / pass^2 / pass^3 over four runs | 19 / 19 / 18% | 76 / 72 / 70% | 89 / 87 / 85% |
| Questions whose answer changed between runs | 1 | 6 | 4 |
| Model calls, tokens, median seconds per question | 1.0, 7,658, 6.9 | 2.1, 2,763, 13.7 | 1.8, 3,495, 19.7 |
| Runs that ended in an error with no answer | 0 | 0 | 0 |

## The seven written predictions, checked

1. The Desk v3 answers at least 48 of 60 exactly (greedy). **Held**: 55.
2. On the six new shapes it answers at most 3 exactly. **Held**: 1 of 6.
3. On the four shapes it now has steps for it answers at least 3 exactly. **Held**: all four, and all 54 questions that are not new shapes were exact.
4. The tool agent answers fewer exactly than the Desk by at least 5. **Held**: 45 against 55, ten fewer.
5. The Desk's pass^3 is at least 75%. **Held**: 85%.
6. It follows none of the five hidden instructions and accepts none of the five false premises. **Held**: 100% and 100%.
7. It abstains correctly on all ten unanswerable questions. **Held**: 10 of 10.

All seven held. That is not the same as the Desk being excellent: what the table cannot show is below.

## What the table does not show

- **The five misses are the five new shapes the Desk has no step for** (the lowest day, a ratio, days with no spend, a weekend total, an average cost per call). It answered the sixth, the second-highest model, with the steps it has. A question outside the steps the Desk was built with is missed or abstained; that was the prediction and it is how the system is built. The tool agent, which can write any computation, missed four of the same five (it answered the average cost per call) and eleven more that the Desk answered.
- **Nine questions were not exact in all four runs of the Desk**: the five new shapes (wrong every time) and four that varied between runs. At temperature 0.7 the Planner sometimes plans differently; the Desk is not deterministic where the model is not.
- **Numeric questions are the Desk's weakest category** (7 of 10), and all three of its numeric misses are new shapes it has no step for.
- **Sets A and B are not held out for v3** and are reported only post hoc, beside the preregistered table: on v3 the Desk answered **60 of 60 on set A** (the tool agent 44, one call 13; the v2.1 had 55) and **60 of 60 on set B** (tool agent 41, one call 12; the v2.1 had 54, the first Desk 49), with pass^3 92% on set B. Set B's misses were read to build the v3, so a perfect score there says the fixes worked, not that the Desk generalises. Set C was not re-run on v3.
- **Infrastructure.** 36 rows of set D, and one row of set A, were runs that ended in an API or network error and were run again; a question's later row replaced its error row. One set A question took ten minutes because of rate-limit back-off. No answer was changed by hand.
- Ten questions out of sixty is a margin this size of set cannot make certain; the preregistered predictions, written before the run and all held, are the stronger evidence, and the paired comparison on 20 held-out questions the weaker.
- One model (Nemotron) served all three arms; another model could move all three.
- The learning loop on set B (Addendum 3) found nothing to learn from on v3: 60 of 60 exact in round 0, zero mistakes, so its lessons have not been exercised since the v3.

## Reproduce

From a fresh clone, with no key: `npm run desk -- bench report --set D --sample`, `--set B`, and `--set A --results docs/verification/benchmark/set-a-v3/results.jsonl` print the tables above from the committed results; `desk bench run --set D --arm A0,A1,A2 --sample` replays every recorded model reply from `data/sample/bench-cassettes-d/` and recomputes every score (`desk prove` runs this and checks the figures). Running them live needs `MODEL_BASE_URL`, `MODEL_API_KEY` and `NEMOTRON_MODEL` in `.env`.
