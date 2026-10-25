import { admit, type LabelledPair } from "../judge/admission.ts";
import { krippendorffAlpha } from "../judge/krippendorff.ts";
import { lengthNormalised, validatePanel, PanelConfigError, type PairResult, type Verdict } from "../judge/panel.ts";

/**
 * The judge panel (DF-038, DF-098) against what it must refuse. The agreement measure reproduces the published figure for its author's worked example; a panel that includes the
 * model under test, has one family or has fewer than three judges is refused; a panel that agrees with the owner on too few labels, or on suspiciously many, or that gave one verdict
 * throughout, is not admitted as it stands; and a longer answer is not rewarded for its length.
 */
const result = (verdicts: Verdict[], decision: Verdict): PairResult => ({ judges: verdicts.map((v, i) => ({ judge: `j${i}`, verdict: v, asShown: [null, null], inconsistent: false })), decision, why: "", raw: decision === "A" ? 1 : decision === "B" ? 0 : 0.5 });

export function judgeProve(): { ok: boolean; detail: string } {
  const fails: string[] = [];
  const a = [1, 2, 3, 3, 2, 1, 4, 1, 2, null, null, null];
  const b = [1, 2, 3, 3, 2, 2, 4, 1, 2, 5, null, 3];
  const c = [null, 3, 3, 3, 2, 3, 4, 2, 2, 5, 1, null];
  const d = [1, 2, 3, 3, 2, 4, 4, 1, 2, 5, 1, null];
  const alpha = krippendorffAlpha(a.map((_, i) => [a[i], b[i], c[i], d[i]].map((x) => (x === null ? null : String(x)))));
  if (alpha.alpha === null || Math.abs(alpha.alpha - 0.743) > 0.0005) fails.push(`alpha is ${alpha.alpha}, not the published 0.743`);
  if (krippendorffAlpha([["tie", "tie", "tie"], ["tie", "tie", "tie"]]).alpha !== null) fails.push("judges that always said tie were given an agreement figure");

  const j = (id: string, family: string, model: string) => ({ id, family, model });
  const refused = (judges: ReturnType<typeof j>[], under: string[]): boolean => {
    try {
      validatePanel(judges, under);
      return false;
    } catch (e) {
      return e instanceof PanelConfigError;
    }
  };
  if (!refused([j("a", "x", "m1"), j("b", "y", "m2"), j("c", "y", "m3")], ["m3"])) fails.push("a panel containing the model under test was accepted");
  if (!refused([j("a", "x", "m1"), j("b", "x", "m2"), j("c", "x", "m3")], [])) fails.push("a panel of one family was accepted");
  if (!refused([j("a", "x", "m1"), j("b", "y", "m2")], [])) fails.push("a panel of two judges was accepted");
  if (refused([j("a", "x", "m1"), j("b", "y", "m2"), j("c", "y", "m3")], ["m9"])) fails.push("a sound panel was refused");

  const pairs = (n: number, agree: number, spread: boolean): LabelledPair[] =>
    Array.from({ length: n }, (_, i) => {
      const truth: Verdict = spread ? (["A", "B", "tie"] as const)[i % 3]! : "A";
      const decision: Verdict = i < agree ? truth : truth === "A" ? "B" : "A";
      return { id: `l${i}`, owner: truth, panel: result([decision, decision, decision], decision) };
    });
  if (admit(pairs(20, 18, true)).status !== "admitted") fails.push("a panel that agrees with the owner on 90% was not admitted");
  if (admit(pairs(20, 12, true)).status !== "excluded") fails.push("a panel that agrees on 60% was admitted");
  if (admit(pairs(20, 20, true)).status !== "flagged") fails.push("a panel that agrees on every label was not flagged");
  if (admit(pairs(10, 10, true)).status !== "excluded") fails.push("ten labels were enough");
  if (admit(pairs(24, 24, false)).status === "admitted") fails.push("judges that gave one verdict throughout were admitted");

  const same = lengthNormalised("A", { length: 400, tests: 3 }, { length: 100, tests: 3 });
  const better = lengthNormalised("A", { length: 400, tests: 4 }, { length: 100, tests: 3 });
  if (!same.penalised || same.score === 1) fails.push("a longer change was rewarded for its length");
  if (better.penalised) fails.push("a longer change that passes more tests was penalised");
  return fails.length === 0 ? { ok: true, detail: "alpha reproduced the published 0.743; a panel with the model under test, one family or two judges was refused; admission passed 90% agreement, excluded 60% and 10 labels, flagged 100%, and refused judges with one verdict throughout; length alone won nothing" } : { ok: false, detail: fails.join("; ") };
}
