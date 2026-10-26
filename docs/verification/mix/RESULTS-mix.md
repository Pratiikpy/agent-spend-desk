# Does the architecture carry a small model, and does a mix of Nemotron models hold? Set F, run 2026-10-26

Preregistered in Addendum 8 of `docs/verification/benchmark/PREREGISTRATION.md` (commit `1f09ba4`), before any model was run on set F. Sixty new draws (seed 20261031, hash `sha256:414cc20f…f427`), one greedy run per question, live through Meterless Nightshift 1.2.3, eleven arm-runs, with the limits the code gives every arm (8 model calls, 10 tool calls, 6 turns, 900 seconds a question, 360 seconds a call; the "240 seconds" in Addendum 8 repeats an older misstatement, corrected in the erratum at the end of the preregistration). Each run's rows are in `docs/verification/mix/<run>.jsonl`, its recordings in `data/sample/bench-cassettes-f-<run>/`.

## Exact answers (of 60), median seconds per question

| Model | One call (A0) | Tool agent (A1) | Desk (A2) | Desk, median s |
|---|---|---|---|---|
| Lightning 30B (3B active) | 7 | 26 | **54** | 7.8 |
| Super-vl 120B (12B active) | 13 | 47 | **60** | 11.2 |
| Ultra 550B (55B active) | 12 | 51 | **59** | 7.0 |

| Mix of the Desk | Planner | Explainer | Exact | Median s |
|---|---|---|---|---|
| MIX-UL | Ultra | Lightning | **60** | 15.6 |
| MIX-LU | Lightning | Ultra | **50** | 14.7 |

Paired exact McNemar tests on the same 60 questions (questions the first arm got right and the second wrong, the reverse, p): Desk against tool agent on Lightning 32 / 4, p < 0.001; on Super-vl 13 / 0, p = 0.0002; on Ultra 9 / 1, p = 0.02. Tool agent against one call: p < 0.001 on all three. MIX-UL against Desk on Ultra 1 / 0, p = 1; MIX-LU against Desk on Lightning 0 / 4, p = 0.125; Desk on Ultra against on Lightning 6 / 1, p = 0.125.

## The seven predictions

1. **Held.** On every model the Desk beat the tool agent and the tool agent beat one call.
2. **Held.** The Desk on Lightning answered 54, the bar was 48.
3. **Held.** Spread of the Desk across the three models: 6 (60 against 54), the bar was at most 6; spread of the tool agent 25 (51 against 26), the bar was at least 8. A spread of exactly 6 meets the prediction and is a small margin.
4. **Held.** MIX-UL 60, Desk on Ultra 59.
5. **Did not hold.** MIX-LU answered 50, four below the Desk on Lightning (54); the bar was within 2. In two of the four the plan differed from the Lightning run's (Q15 filtered on a model named `none`; Q39 planned a spend answer where the Lightning run abstained); in the other two (Q56, Q58, both "how many model calls") the Lightning run stated the call count and the mix's answer gave spend and sessions started instead, with no call count. The same model at temperature 0 does not give the same plan every time, so part of the four may be run-to-run variation of the Planner; the set was run once per arm and **NOT VERIFIED** whether a repeat would close the gap. What the data do support is that a large Explainer did not make a small Planner's run better here.
6. **Did not hold.** Predicted order from fastest: Desk on Lightning, MIX-UL, Desk on Ultra. Observed: Desk on Ultra 7.0 s, Lightning 7.8 s, MIX-LU 14.7 s, MIX-UL 15.6 s. The runs shared one machine and a two-way concurrency, and the Nightshift service's queue was not controlled; seconds are reported as measured and are not a clean speed comparison.
7. **Held.** All 1,044 recorded Nightshift receipts verify against the one signing key (`desk receipts data/sample/bench-cassettes-f-<run> --pin e92caae86b5f702e`), and in each run the model named in the receipts is the one the arm asked for: the mixes show Planner on one model and Explainer on the other.

## What this does and does not show

- On this set the architecture carries the small model: the Desk on a 3B-active model answered 54 of 60, more than the tool agent on the 550B model (51), which is a statement about these 60 questions, not about models in general.
- The Planner is where model size mattered: a large Planner with a small Explainer matched the all-large run (60 and 59), a small Planner with a large Explainer did not (50, against 54 for small throughout). This agrees with Addendum 7, where the Planner was the role shown necessary. With one run per arm it is a pattern in 60 questions, not an established effect (p = 0.125 for the gap above).
- A hold-out caveat: set F has 15 questions whose texts appear in earlier sets (ten unanswerable fixed texts, five draws), and the Desk's Ask path has changed since set D; the Desk was not changed to suit set F.
- Not covered: repeated runs of the same arm, other temperatures, models other than these three, questions written by someone other than the builder, a mix that gives the Auditor or the plan critic its own model.
- Unsigned or unclaimed: six recordings (three on Lightning, three on Super-vl) carry no receipt and are not claimed as Nightshift's; their cause was not checked.
