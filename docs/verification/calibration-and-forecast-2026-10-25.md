# Rule calibration and the month-end forecast (2026-10-25)

Features DF-034 (threshold calibration on the owner's history) and DF-035 (forecasts with a scorecard). Both read the owner's own ledger and make no claim beyond it.

## Rule calibration (`desk calibrate rules`, the Policy screen, the weekly review's line)

For each rule of a policy, the policy is replayed over the recorded sessions and every session the rule stopped, or asked about, is looked at to see whether its work landed afterwards. A rule whose flags landed more than a fifth of the time, over at least twenty flags with a known landing, "misfires on your data". Nothing is changed.

- A flag is a stop or an ask (the owner may have said no). The spend after each stop point is added up per rule: an upper bound on what the rule saved.
- A session whose landing is not known (git was not scanned for it) is left out of the share. Unknown is not the same as not landed, and counting it as not landed would make every rule look better than it is.
- For a rule with a number in it (a dollar threshold on recoverable waste, or a cap), higher values are tried (1.25, 1.5, 2, 3, 5, 10 times), each replayed over the same sessions, and the lowest that brings the remaining flags under the limit is offered, with the dollars the rule would then stop less. It is a loosening, so the offer is a policy file (`--propose`) and the answer of the restrict-only check naming a request the new policy allows that the old one did not; applying it is the owner's own edit, not an approval. A rule with no number says it has none to raise.
- The weekly review's calibration line now says how many rules misfire, hold up or have too little to say, in place of the sentence that none was checked.
- Detection thresholds (how many repeats make a loop) are not changed by this. They are constants of the rules, shown on screen. What is calibrated is the policy's own rules, the ones that stop work.

What ran: `tests/desk/calibrate-rules.test.ts` (12: attribution of a stop to its rule, exact limits at twenty flags and a fifth landed, unknown landing left out, the lowest offer that clears the limit and the case where none does, a cap, a rule with no number, the default deny as its own row, the sentences), `tests/desk/ui/calibration-ui.test.ts` (the table and its offers on the Policy screen for each shipped policy, and the review line).

On the sample ledger (987 sessions, 734 with a known landing), the shipped `velocity-and-session.yaml`'s day cap is stopping or asking about 242 sessions, 87% of which landed, so it "misfires on your data"; replayed at 3 times the cap ($450) it would flag none, and stop $1,375.40 less. That is a fact about a constructed sample whose daily spend is far above $150, not a recommendation. `stop-loops.yaml` flags 21 sessions with 4 of a known landing: not enough data.

On this machine's own ledger: 428 sessions, **3 with a known landing**. Every rule that fired reads "not enough data", and the line says what would give it more to read (`desk landing`). So the check is built, runs on a real ledger and has so far had almost nothing real to read.

## Month-end forecast (`desk forecast`, the Bill screen's "Where the month ends")

What has been spent plus, for each remaining day, the average of the same weekday over the last four weeks. The range is the forecast's own past errors: the same forecast is made on each of the previous eight weeks of days using only what was known then, and the 10th and 90th percentiles of the gap to what happened are added to today's forecast. The middle estimate is the forecast moved by the middle of those errors. A month cannot end below what was spent, so neither end goes under it. With under four weeks of days it is a straight line, labelled as one, with no range.

The record is made the same way: walking forward through the history, each forecast is made with the range the eight weeks before would have given and checked afterwards, by how far ahead it looked (1 to 7, 8 to 14, 15 to 31 days) with the count. A range meant to hold 80% of the time that held under 70% of the last 20 is widened by how much more it missed than it should have (capped at 3 times) and the answer says so.

What ran: `tests/desk/forecast.test.ts` (18: the weekday average and its look-ahead, no future data seen, a range of no width on a series it forecasts exactly, the straight line, the finished month, too few past forecasts for a range, coverage near its claim on steady noise, the scorecard unchanged by what comes after, widening when the series breaks and not on 19 forecasts or at 70% exactly, and a range that never goes under what was spent) and the Bill test.

Defects found on the way: the first test of the middle estimate found a range entirely below the spend already made (a series whose forecasts had all run high gave an upper end under what had been spent). Both ends are now clamped to the spend, and the middle estimate is the forecast moved by the middle of its own errors, so it can no longer sit outside the range beside it. The same-weekday lookup collapsed to one day when it looked more than a week ahead; it now takes the four latest same-weekday days known on the origin.

On this machine's ledger the forecast said, for October: $8,547.24 through the 25th, likely $8,547.24 to $16,494.46 by the end of the month (80%), most likely $10,429.16, widened 2.8 times because the last 20 ranges held 45% of the time. By how far ahead: 35 of 54 held (65%) at 1 to 7 days, 6 of 18 (33%) at 8 to 14, 4 of 15 (27%) at 15 to 31. Spend on this ledger is lumpy, so the ranges are wide and the honest reading is that a weekly pattern is a poor model of it.

## Not covered

- **The record is a backtest, not a log of live forecasts.** Every forecast it scores is one the Desk would have made on a past day; no forecast made on the day is stored and scored later. A stored record would start empty and fill over months.
- The scorecard needs about twelve weeks of days before the first forecast can be checked (four for the weekly pattern, eight for the range), and it has few forecasts to score on a ledger of a few months, so the counts are small and are shown.
- The forecast is of list-price estimates in the ledger, not of an invoice. A day in the ledger with no calls counts as zero, whether the tool was not used or the log was missing.
- The window runway with a run-out probability is the existing quota runway (DF-008), checked against real windows in `docs/verification/runway-2026-10-24.md`; it is not rebuilt here.
- Rule calibration reads the landing the ledger holds. Landing for a session outside every scanned repository is unknown and is left out, which on a ledger with few scanned repositories leaves almost every rule at "not enough data". Landing is also a two-sided signal: a stop can be right and the work still land later by another route.
- A higher cap or threshold is offered only from what history shows. It does not model that a rule's presence changes behaviour.
