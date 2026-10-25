# Calibration across the four surfaces (DF-106)

`desk calibrate surfaces` reads each place the Desk states a confidence from the data it already keeps, and calibrates them alike: ten equal-width bins, the expected calibration error, the Brier score, a text reliability diagram, and an abstain threshold, which is the lowest confidence at and above which the answers were right at least 80% of the time. With fewer than 50 pairs nothing is tuned: a default threshold is used and the output says `UNCALIBRATED DEFAULT` (attribution: high only; judge panel 0.85; auditor 0.80; forecast 0.70). The results are kept in the capture store (`calibration_metrics`, `calibration_curves`).

## What it said on the constructed sample (2026-10-25)

- **Attribution** (734 links with a known fate): the levels are words, so no curve is drawn. Links are right 99% of the time at every level, so the lowest level is enough and nothing needs to abstain.
- **Forecast** (the wind tunnel's stated chance of blocking landed work, 64 constructed months): expected calibration error 0.28 on the smoothed chance. The chance says 94% in the top bin and is right 54% of the time; no confidence reaches 80%, so the surface says to abstain throughout. This is a finding against the forecast, not a pass.
- **Judge panel**: no labelled pairs exist yet (they come from `desk judge admit` on the owner's own labels), so the default threshold stands.
- **Auditor** (50 answers of benchmark set E, the share of cited claims that were needed): every answer scored 1.0 and every answer was right, so the error is 0 and says nothing about whether the score would separate a good answer from a bad one. It is reported as calibrated on 50 pairs, and this sentence is the caveat.

## Tested

`tests/desk/calibration-surfaces.test.ts` (9) and the `desk prove` check `confidence-surfaces-are-calibrated-and-the-default-says-it-is-one`: zero error for an honest confidence, 0.40 for a 95% confidence that is right 55% of the time, the threshold landing where answers reach 80%, none invented where nothing does, a few lucky answers at the top not trusted, a forecast read by the side it favours, and under 50 pairs giving the default.

## Not covered

The calibration is not written into the signed policy-change dossier; it is printed and stored. The judge panel and the auditor have too little varied data on this machine to say anything yet. Equal-width bins with few pairs per bin are noisy.
