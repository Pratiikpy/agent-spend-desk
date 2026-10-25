# Which roles of the Desk change an outcome: results on question set E (2026-10-25)

Feature DF-085. The method, the arms, the decision rule and eight predictions were fixed in [Addendum 7 of the preregistration](../benchmark/PREREGISTRATION.md) and committed (4ae8530) before any model was run on set E. Nothing about set E was changed after seeing a result. The recorded runs are `set-e/results.jsonl`, the model replies are in `data/sample/bench-cassettes-e/`, and `desk prove` replays all 600 final recorded runs (60 questions in each of ten arms) from those replies and scores them again (check `ablation-set-e-reproduces-from-recordings`).

Reproduce the table: `npm run desk -- bench report --set E --db data/desk/sample/ledger.db`.

## What was run

Sixty questions in six categories of ten, on the constructed sample ledger, one run each at temperature 0, the same model and settings for every arm (Nemotron through NVIDIA's free API). A0 and A1 are the plain baselines, A2 is the full Desk. A3 to A7 each take one role out; A2F and A4F read an Explainer whose first figure is changed by code, with and without the Auditor.

| | exact (of 60) | answers stating a figure nothing asked for (of the answers given) | what it is |
|---|---|---|---|
| A0 | 12 | 44 of 48 | the model with no tools |
| A1 | 48 | 6 of 47 | a plain tool-using agent |
| **A2** | **60** | 32 of 50 | the full Desk |
| A3 | 60 | 32 of 50 | without the plan critic |
| A4 | 60 | 32 of 50 | without the Auditor |
| A5 | 60 | 32 of 50 | without the revision loop |
| A6 | 60 | 47 of 50 | the Explainer replaced by code |
| A7 | 30 | 42 of 51 | the Planner replaced by the rule planner |
| A2F | 45 | 24 of 46 | A2, Explainer made wrong on purpose |
| A4F | 46 | 50 of 50 | A4, Explainer made wrong on purpose |

(The column of extra figures counts any figure the answer states beyond the one asked for, true or not; it does not separate a corrupted figure from a true figure of context. The exact counts and the full per-category table are in the report.)

## What each role shows

Each ablation arm against A2, on the same questions, by the exact McNemar test (two-sided), as the preregistration fixed:

- **The Planner: necessary on this set.** Without it 30 questions are lost and none gained (p < 0.001). The rule planner cannot compute a share, an average or a count of days, and every counterfactual question (0 of 10) fails.
- **The plan critic: not shown necessary.** 60 of 60, no question differs.
- **The revision loop: not shown necessary.** 60 of 60, no question differs.
- **The Explainer: not shown necessary on exactness.** 60 of 60 with code stating each claim. The answers differ in text: with code, 47 of 50 answers state a figure nothing asked for, against 32 of 50.
- **The Auditor: not shown necessary on good runs (60 of 60 without it), necessary under the fault.** With the Explainer's first figure corrupted, the arm with the Auditor has 26 clean answers the arm without it does not, and the arm without it has none the arm with it lacks (p < 0.001). The Auditor removes the corrupted sentence; the fault is synthetic and says what the Auditor does when the Explainer is wrong, not how often the Explainer is wrong.

**"Not shown necessary" is the absence of evidence on this set, not equivalence.** Sixty questions, one model and one run each cannot show that a role changes nothing. The README, the deck and the product description do not call such a role useless, and the product is not changed on this evidence alone.

## The preregistered predictions

1. A2 answers at least 54 exactly: **held** (60).
2. A7 answers at least 10 fewer exactly and is necessary: **held** (30 fewer, p < 0.001).
3. A3 differs from A2 on at most 3 questions and is not shown necessary: **held** (0 differ).
4. A4 within 2 questions of A2 and follows no hidden instruction: **held** (0 differ; the instruction was resisted by every arm A2 to A6).
5. A5 within 2 questions of A2, not shown necessary: **held** (0 differ).
6. A6 within 3 questions of A2 on exactness and at least ten points more answers with a figure nothing asked for: **held** (0 differ; 47 of 50 against 32 of 50, 30 points more).
7. Under the fault, A4F shows a wrong figure in at least 30 answers and A2F in none: **half held, half failed.** A4F has 50 of 50 answers with a figure nothing asked for, against 24 of 46 for A2F, and 26 more clean answers with the Auditor. The prediction said A2F would have none; it has 24, because the metric counts every figure beyond the one asked, and A2 without any fault already states one in 32 of 50 answers. The metric cannot tell a corrupted figure from a true context figure, so "in none" was a prediction the metric could not satisfy as written.
8. A6 and A7 use fewer model calls and fewer seconds per question than A2: **calls held** (1.0 and 0.8 against 1.8); **seconds NOT VERIFIED for A6** and not comparable for A3 to A5. The runs of arms that share a request with A2 were served from the recorded reply, so their time is the time to read a file (0.3 s), not the latency of the model. A7's 2.7 s median is from live calls and is lower than A2's 59.7 s, which includes the Planner's long reasoning and the free API's back-off, so it also carries the load of that day.

## What this does and does not say

- It says: on 60 questions about a constructed ledger, with one model, the Planner is the role the answers depend on, and the Auditor is what stands between a wrong Explainer and the reader. It says the other roles were not shown to change an exact answer.
- It does not say the plan critic, the revision loop or the Explainer are useless, that they would not matter on harder questions, on a weaker model, or on a ledger from real use, or that the Planner would be necessary for any other pipeline.
- The Desk was not changed because of these results. If reading set E's misses had led to a change, set E would stop being held out for the changed version.
- One run per question, temperature 0: run-to-run variation was not measured on set E (set D's repeated runs gave pass^k on a different set).
- The file holds 649 rows for 600 final results. The 49 superseded rows ended in a transient error from the free API or, for A2, in an earlier run in which the model did not answer in time; each was retried by running the same command again, and the report reads the last row of each question.
- The unanswerable and adversarial categories have ten questions each, so a category-level difference is not testable here.
- A1 has one question that ended in an error ("no answer within 6 turns"), which is a result of that arm and not a transient fault; it counts as not exact.
