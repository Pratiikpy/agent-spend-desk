import { runLanguageCheck } from "../lang/check.ts";

/**
 * The language surcharge against a ledger with it planted (DF-043): every cell with enough prompts must come back within eight per cent of its planted ratio, every cell without
 * enough must be refused with a reason and no figure, and every prompt must have been labelled with the script it was written in. Run through the same reader as any ledger.
 */
export async function languageProve(): Promise<{ ok: boolean; detail: string }> {
  const c = await runLanguageCheck();
  if (!c.labelsAgree) return { ok: false, detail: `prompts were labelled with the wrong script: ${c.labelDetail}` };
  const bad = c.rows.filter((r) => !r.ok);
  if (bad.length > 0) return { ok: false, detail: bad.map((r) => `${r.script} on ${r.model}: ${r.why}`).join("; ") };
  const off = c.baselines.filter((b) => !b.ok);
  if (off.length > 0) return { ok: false, detail: `the English line is off on ${off.map((b) => b.model).join(", ")}` };
  const shown = c.rows.filter((r) => r.planted.ratio !== null);
  const withheld = c.rows.length - shown.length;
  const worst = Math.max(...shown.map((r) => Math.abs((r.measured.ratio as number) - (r.planted.ratio as number)) / (r.planted.ratio as number)));
  return { ok: true, detail: `${shown.length} planted cells recovered, the worst within ${(100 * worst).toFixed(1)}% of its planted ratio; ${withheld} cells with too few prompts withheld without a figure; every prompt labelled with its script; the English line on each model recovered` };
}
