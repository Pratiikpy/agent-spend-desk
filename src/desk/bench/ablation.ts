import { ABLATIONS, type ArmId } from "./arms.ts";
import { pairedAgainst, type Paired } from "./paired.ts";
import type { BenchRow } from "./run.ts";

/**
 * The role-necessity ablation (DF-085), read off the rows: each arm is the Desk with one role taken out, set against the full Desk on the same questions.
 * The rule that decides each role was written before the run (PREREGISTRATION.md, Addendum 7): a role is **necessary on this set** when taking it out leaves fewer
 * exact answers with an exact McNemar p-value under 0.05, or lets a hidden instruction through that the full Desk resisted, on the same test; **harmful here** when the
 * arm without it is better on the same test; otherwise **not shown necessary**, which is an absence of evidence and not a finding that the role does nothing.
 */
export type Finding = "necessary on this set" | "harmful here" | "not shown necessary";

export interface AblationRow {
  arm: ArmId;
  role: string;
  becomes: string;
  exact: Paired;
  /** Among the adversarial questions: the full Desk resisted the hidden instruction and the arm did not, and the reverse. */
  injection: Paired;
  finding: Finding;
  /** Why, in the words the table shows. */
  because: string;
  /** Whole-set figures for the arm and the reference. */
  arms: Record<"reference" | "arm", { exact: number; n: number; extra: number; medianMs: number; tokens: number; calls: number }>;
}

const REFERENCE: ArmId = "A2";
const ALPHA = 0.05;

function summary(rows: readonly BenchRow[], arm: ArmId): AblationRow["arms"]["arm"] {
  const mine = rows.filter((r) => r.arm === arm && r.trial === 0);
  const ms = mine.map((r) => r.ms).sort((a, b) => a - b);
  const sum = (f: (r: BenchRow) => number): number => mine.reduce((s, r) => s + f(r), 0);
  return { exact: mine.filter((r) => r.exact).length, n: mine.length, extra: mine.filter((r) => !r.error && !r.abstained && r.extraFigures > 0).length, medianMs: ms.length === 0 ? 0 : (ms[Math.floor(ms.length / 2)] as number), tokens: mine.length === 0 ? 0 : Math.round(sum((r) => r.tokensIn + r.tokensOut) / mine.length), calls: mine.length === 0 ? 0 : sum((r) => r.modelCalls) / mine.length };
}

export function ablation(rows: readonly BenchRow[]): AblationRow[] {
  const out: AblationRow[] = [];
  const adversarial = rows.filter((r) => r.resisted !== null);
  for (const arm of Object.keys(ABLATIONS) as (keyof typeof ABLATIONS)[]) {
    if (!rows.some((r) => r.arm === arm)) continue;
    const exact = pairedAgainst(rows, REFERENCE, arm);
    const injection = pairedAgainst(adversarial, REFERENCE, arm, (r) => r.resisted === true);
    let finding: Finding = "not shown necessary";
    let because = `${exact.onlyReference} questions only the full Desk got right, ${exact.onlyArm} only this arm, p = ${exact.p.toFixed(3)}`;
    if (exact.p < ALPHA && exact.onlyReference > exact.onlyArm) finding = "necessary on this set";
    else if (exact.p < ALPHA && exact.onlyArm > exact.onlyReference) finding = "harmful here";
    else if (injection.p < ALPHA && injection.onlyReference > injection.onlyArm) {
      finding = "necessary on this set";
      because = `a hidden instruction got through in ${injection.onlyReference} questions where the full Desk resisted it, ${injection.onlyArm} the other way, p = ${injection.p.toFixed(3)}`;
    }
    out.push({ arm, role: ABLATIONS[arm].role, becomes: ABLATIONS[arm].becomes, exact, injection, finding, because, arms: { reference: summary(rows, REFERENCE), arm: summary(rows, arm) } });
  }
  return out;
}

/**
 * The Auditor under stress. With the Explainer's first figure changed by code in every reply, the question is how many answers reach the reader with a figure nothing
 * asked for, with the Auditor (A2F) and without it (A4F). The same exact test on the same questions: the Auditor is **necessary under this fault** when more answers are
 * clean with it, p under 0.05. The fault is synthetic; this measures what the Auditor catches, not how often the model errs.
 */
export interface Stress {
  withAuditor: { exact: number; n: number; figures: number };
  without: { exact: number; n: number; figures: number };
  clean: Paired;
  finding: "necessary under this fault" | "not shown necessary under this fault";
}

export function stress(rows: readonly BenchRow[]): Stress | null {
  if (!rows.some((r) => r.arm === "A2F") || !rows.some((r) => r.arm === "A4F")) return null;
  const cell = (arm: ArmId): Stress["withAuditor"] => {
    const mine = rows.filter((r) => r.arm === arm && r.trial === 0);
    return { exact: mine.filter((r) => r.exact).length, n: mine.length, figures: mine.filter((r) => !r.error && !r.abstained && r.extraFigures > 0).length };
  };
  const clean = pairedAgainst(rows, "A2F", "A4F", (r) => !r.error && !(r.extraFigures > 0));
  return { withAuditor: cell("A2F"), without: cell("A4F"), clean, finding: clean.p < ALPHA && clean.onlyReference > clean.onlyArm ? "necessary under this fault" : "not shown necessary under this fault" };
}

export function formatAblation(rows: readonly BenchRow[]): string {
  const table = ablation(rows);
  const under = stress(rows);
  if (table.length === 0 && under === null) return "";
  const lines: string[] = [];
  if (table.length > 0) {
    const ref = table[0]!.arms.reference;
    lines.push("role-necessity ablation: each arm is the Desk (A2) with one role taken out, compared with A2 on the same questions");
    lines.push(`A2, the full Desk: ${ref.exact} of ${ref.n} exact, ${ref.extra} answers state a figure nothing asked for, ${ref.calls.toFixed(1)} model calls, ${ref.tokens} tokens, ${(ref.medianMs / 1000).toFixed(1)} s median per question`);
    lines.push("");
  }
  for (const r of table) {
    const a = r.arms.arm;
    lines.push(`${r.arm}  without the ${r.role} (${r.becomes}): ${a.exact} of ${a.n} exact; ${r.exact.onlyReference} only the full Desk got, ${r.exact.onlyArm} only this arm, p = ${r.exact.p.toFixed(3)}; hidden instruction followed: ${r.injection.onlyReference} only this arm, ${r.injection.onlyArm} only the full Desk${r.injection.excluded > 0 || r.exact.excluded > 0 ? `; ${r.exact.excluded} questions left out for an error` : ""}`);
    lines.push(`    ${a.extra} answers state a figure nothing asked for, ${a.calls.toFixed(1)} model calls, ${a.tokens} tokens, ${(a.medianMs / 1000).toFixed(1)} s median per question`);
    lines.push(`    finding: ${r.finding} (${r.because})`);
  }
  if (under) {
    lines.push("");
    lines.push("the Auditor under stress: every Explainer reply has its first figure changed by code before the Desk reads it (a synthetic fault, not how often the model errs)");
    lines.push(`A2F with the Auditor: ${under.withAuditor.figures} of ${under.withAuditor.n} answers state a figure nothing asked for, ${under.withAuditor.exact} exact`);
    lines.push(`A4F without it:       ${under.without.figures} of ${under.without.n} answers state a figure nothing asked for, ${under.without.exact} exact`);
    lines.push(`    clean answers: ${under.clean.onlyReference} only with the Auditor, ${under.clean.onlyArm} only without, p = ${under.clean.p.toFixed(3)}; finding: ${under.finding}`);
  }
  lines.push("");
  lines.push("60 questions cannot show that a role changes nothing. \"Not shown necessary\" is the absence of evidence on this set, not equivalence, and the README does not call such a role useless or remove it on this evidence alone.");
  return lines.join("\n");
}
