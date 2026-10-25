import { calibrateSurface, type Sample } from "../calibrate/surface.ts";

/**
 * The calibration of a surface (DF-106) on pairs made to have a known answer: a confidence that is right as often as it says has no error; one that is not has the error that is
 * arithmetic; the abstain threshold lands where the answers reach 80%; no threshold is invented when none reaches it; and under fifty pairs the result says it is a default.
 */
const make = (spec: [number, number, number][]): Sample[] => spec.flatMap(([p, n, right]) => Array.from({ length: n }, (_, i) => ({ p, right: i < right })));

export function surfaceProve(): { ok: boolean; detail: string } {
  const fails: string[] = [];
  const honest = calibrateSurface("auditor", make([[0.9, 100, 90], [0.6, 100, 60]]));
  if (!honest.calibration || honest.calibration.ece > 1e-9 || honest.calibration.bins.length !== 10) fails.push("a confidence that is right as often as it says was given an error");
  const over = calibrateSurface("auditor", make([[0.95, 100, 55]]));
  if (!over.calibration || Math.abs(over.calibration.ece - 0.4) > 1e-9) fails.push("a 95% confidence that is right 55% of the time did not give an error of 0.40");
  const tuned = calibrateSurface("judge_panel", make([[0.5, 80, 40], [0.7, 80, 56], [0.9, 80, 72]]));
  if (tuned.threshold !== 0.7 || tuned.status !== "calibrated") fails.push(`the abstain threshold is ${tuned.threshold}, not 0.7`);
  const none = calibrateSurface("judge_panel", make([[0.6, 100, 55], [0.9, 100, 60]]));
  if (!none.abstainAlways) fails.push("a threshold was invented where no confidence reaches 80%");
  const few = calibrateSurface("judge_panel", make([[0.9, 40, 40]]));
  if (few.status !== "uncalibrated_default" || few.threshold !== 0.85) fails.push("forty pairs were enough to tune");
  return fails.length === 0 ? { ok: true, detail: "ten bins; zero error for an honest confidence and 0.40 for a 95% confidence that is right 55% of the time; the abstain threshold landed at 0.70 where answers reach 80%; none was invented where nothing does; forty pairs gave the default and said so" } : { ok: false, detail: fails.join("; ") };
}
