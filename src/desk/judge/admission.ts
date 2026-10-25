import { krippendorffAlpha } from "./krippendorff.ts";
import type { PairResult, Verdict } from "./panel.ts";

/**
 * Whether a panel may be believed (DF-038). A panel's verdicts are used for nothing until it has been checked against the owner's own judgement of the same pairs. The check has
 * two parts and both must hold. The judges must agree with one another (Krippendorff's alpha of at least 0.67, the lowest figure the method's author would draw even tentative
 * conclusions from), and the panel's decision must agree with the owner's on at least 85% of at least 20 pairs the owner has labelled.
 *
 * Agreement above 92% is admitted but flagged: a panel that matches a person that closely on a small set may have been shown the answers, or the pairs may be too easy to say
 * anything, and the owner is told so rather than reassured.
 */
export const ADMISSION = { minAlpha: 0.67, minAgreement: 0.85, flagAbove: 0.92, minLabels: 20 } as const;

export interface LabelledPair {
  id: string;
  owner: Verdict;
  panel: PairResult;
}

export type ChannelStatus = "admitted" | "flagged" | "excluded";

export interface Admission {
  status: ChannelStatus;
  alpha: number | null;
  agreement: number | null;
  labels: number;
  /** Pairs the panel gave no decision for, which count as disagreements with the owner. */
  undecided: number;
  reasons: string[];
}

export function admit(pairs: readonly LabelledPair[]): Admission {
  const reasons: string[] = [];
  const alpha = krippendorffAlpha(pairs.map((p) => p.panel.judges.map((j) => (j.verdict === "grader_failed" ? null : j.verdict))));
  const decided = pairs.filter((p) => p.panel.decision !== null);
  const agree = pairs.filter((p) => p.panel.decision !== null && p.panel.decision === p.owner).length;
  const agreement = pairs.length === 0 ? null : agree / pairs.length;
  const undecided = pairs.length - decided.length;
  if (pairs.length < ADMISSION.minLabels) reasons.push(`${pairs.length} labelled pairs; admission needs at least ${ADMISSION.minLabels}`);
  if (alpha.alpha === null) reasons.push("the judges' agreement could not be measured: they gave one verdict throughout, or too few pairs have two judges");
  else if (alpha.alpha < ADMISSION.minAlpha) reasons.push(`the judges agree with each other at alpha ${alpha.alpha.toFixed(2)}, under ${ADMISSION.minAlpha}`);
  if (agreement !== null && agreement < ADMISSION.minAgreement) reasons.push(`the panel agrees with the owner on ${(100 * agreement).toFixed(0)}% of the pairs, under ${(100 * ADMISSION.minAgreement).toFixed(0)}%`);
  if (reasons.length > 0) return { status: "excluded", alpha: alpha.alpha, agreement, labels: pairs.length, undecided, reasons };
  if (agreement !== null && agreement > ADMISSION.flagAbove) return { status: "flagged", alpha: alpha.alpha, agreement, labels: pairs.length, undecided, reasons: [`the panel agrees with the owner on ${(100 * agreement).toFixed(0)}% of ${pairs.length} pairs, above ${(100 * ADMISSION.flagAbove).toFixed(0)}%: check that the pairs were not too easy and the panel was not shown the owner's answers`] };
  return { status: "admitted", alpha: alpha.alpha, agreement, labels: pairs.length, undecided, reasons: [] };
}
