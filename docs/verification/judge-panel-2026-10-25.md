# The judge panel, and when it may be believed (DF-038, DF-098)

When two runs of a task both pass the owner's tests, a model judge can be asked which change is better. A judge's opinion is not a measurement until it has been checked against the owner's own opinion, so the panel is held to rules before any score of its comes out.

## The rules

The panel lists at least three judges from at least two model families, and none of them is a model under test; a panel that breaks any of these does not start. Each judge sees each pair in both orders. A judge that does not prefer the same change in both orders is counted as saying tie. A pair's decision is the majority of the valid verdicts, and there is no decision when fewer than two judges answered or when no verdict has a majority. A judge whose call failed is recorded as `grader_failed` and does not vote. A change that is more than 1.3 times as long is not given the win for length: where the tests do not separate the two, the longer one is scored as a tie.

Agreement among the judges is measured with Krippendorff's alpha for labels with no order. It reproduces the published 0.743 for its author's worked example. It is undefined when every rating is the same, and is then reported as unmeasurable, not as perfect agreement.

## Admission

`desk judge admit` runs the panel over the owner's labelled pairs (at least 20) and records the result. The panel is admitted when alpha is at least 0.67 and it agrees with the owner on at least 85% of the pairs. It is excluded below either, and excluded when it has been given fewer than 20 labels. It is flagged, and not admitted, when it agrees on more than 92%, since a result that good is more likely a leak than a panel. `desk judge run` refuses a panel that was not admitted; `--advisory` allows a look, and everything printed under it is marked as no score and stored with the advisory flag.

## What was exercised

`tests/desk/judge.test.ts` (14) and `tests/desk/judge-run.test.ts` (3): alpha on the worked example and at its edges, every panel rule, both-order handling, tie and split scoring, length handling, admission at each threshold, and a panel put to work on a measured swap (refused before admission, advisory without it, scored once admitted, excluded again after a bad label set). The prove check `judge-panel-is-refused-until-it-agrees-with-the-owner` repeats the central refusals.

## Not covered

No admitted panel exists for this owner: that needs the owner's own labelled pairs, which only the owner can make. Among the models reachable here, only one family answered plain chat reliably, so a panel meeting the two-family rule could not be run live in this session. A live advisory run was therefore not made. Whether a panel of these models would be admitted is NOT VERIFIED.
