# Do the citations hold the answer up, and does the answer come from the ledger? (2026-10-25)

Feature DF-108. Two checks, both in code, both run on every answer the Desk gives and on any recorded answer.

## Citation necessity (leave one out, against the Auditor)

A sentence lists the claims that support it. A listed claim the sentence does not need makes the sentence look better supported than it is. The test takes each cited claim away in turn and asks the same code Auditor that accepted the sentence whether it still passes. If it does, that claim was decorative for that sentence; if not, the sentence needs it. It costs no model call, so it runs on every answer: the answer's checks print `citations: 3 of 3 citations are needed by the sentence that makes them`, the Ask screen shows the same line and names a decorative claim beside its sentence, and the dossier verifier's claim-ledger level (V8-D) prints it as a reading beside its pass.

What it can say is what the Auditor checks: that every figure in a sentence is in a cited claim, that a class word (billed, estimated) agrees with a cited claim, that a comparison cites an interval. A cited claim that only gives the reader context, carrying no figure or word the sentence uses, is decorative by this test, and the sentence may be better for it; the answer says "decorative" and never "wrong". A reading, not a verdict: a decorative citation does not fail a dossier.

## Perturbation (does the answer come from the ledger)

The answer's own steps are run again after the ledger has been changed by one known call, inside a savepoint that is rolled back. A call costing a million dollars is added on the quietest day inside the dates the answer covers, on a model it reads, in a session that began then, and the figures must move. A call is added before every date the answer covers and nothing may move. A step that does not move for a call it reads is not reading the ledger (a hard-coded answer looks like this); a step that moves for a call outside its dates reads more than it says. For a spend step the rule is exact (it moves if and only if the call is inside its dates and on its model); other steps are held to the aggregate rule that at least one moves inside and none outside. `desk verify-answer <id> --perturb` runs it.

## What ran

- `tests/desk/ask/faithfulness.test.ts` (7): a claim essential when the sentence stops passing without it and decorative when it does not, a sentence that states two figures needing both, a figure-less sentence with two cites (both decorative), a billed word and a comparison each needing their own claim, a repeated cite counted once, a claim the ledger does not hold.
- `tests/desk/ask/perturb.test.ts` (13): the whole-period spend, exact movement by dates and by model, a figure worked out from a spend, rollback even when a step throws, the order statistics (most expensive session, median day, days over a figure, count of sessions, landing), an injected runner that ignores the ledger (fails: moved no step), one that reads everything (fails: moved for a call outside its dates), the exact spend rule both ways, and nothing to perturb when a step has no dates or the ledger has no call in them. The command reports the perturbation beside the check that the recorded steps still give the same results.
- `tests/desk/ui/ask-citations.test.ts` (2) and the claim ledger check in `tests/desk/close.test.ts`.
- **On real answers.** The 50 questions of set E that the Desk answered (of 60; the other 10 are the unanswerable and refused), replayed from their recordings: 194 sentences, 195 citations, **195 needed, 0 decorative**, so the Explainer on this model, held to the Auditor, cites what it uses. The perturbation: **50 of 50 pass**, and the ledger was left as it was (no perturbation session remains).
- Run once on a real answer from this machine's ledger (242,335 calls): the spend between two dates moved with a call added inside them, held for one added a year before, and the ledger copy was unchanged.

## A defect in the check, found by running it on real answers

The first version added a call of one dollar. It passed in every test I had written, and **failed 4 of 50 real answers**: the most expensive single session (twice), the median daily spend and a count of days over $150. A dollar does not make a new busiest session, cross a median or a threshold, so those answers did not move, and the check called a correct answer one that was not reading the ledger. The call is now a million dollars on the quietest day, in a session that began then, which becomes the busiest session, crosses the median and the threshold, and counts as a session. The tests for those shapes were written after the real failure, as the check should have been tested from the start.

## Not covered

- The specification's leave-one-out re-asks a model (at most five times an answer) whether the conclusion changes. This one asks the code Auditor, which is exact for what it checks and free, and says nothing about whether a model's reading of the answer would change; the two measure different things, and only this one is built.
- The minimal flip, validated by recomputation, is the flip certificate of DF-068 (every candidate is a recomputation with one fact changed), not repeated here.
- Month-close summaries get the citation reading but not the perturbation: their figures are recomputed from rows by the verifier (V6-D) in a different way.
- Steps with no dates (a recalled note) are not perturbed; the result says `not_run` and why.
- The exact rule is held for spend steps only. For the others, a perturbation that moved something proves the answer reads the ledger and not that it reads the right rows.
- The perturbation writes to the ledger inside a savepoint and rolls it back. A process killed between the two leaves an uncommitted transaction that SQLite discards on the next open; it was not tested with a kill.
