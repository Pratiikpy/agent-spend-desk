import { existsSync, readFileSync } from "node:fs";

/**
 * The recorded live swap (DF-042): the figures in its report are recomputed from the stored per-item results, and the rule that withholds a comparison when the baseline does
 * not reproduce its own recorded passes is applied to them again. The model calls themselves are not replayed: their recordings are not kept in the repository.
 */
export const SWAP_RECORD = "docs/verification/swap/run-992eb04991.json";

interface Item { route: string; status: string; turns: number }
interface Rec {
  baseline: string;
  candidate: string;
  report: { verdict: string; gate: { rate: number | null; scored: number; required: number; met: boolean }; routes: { route: string; items: number; scored: number; passes: number; rate: number | null; errors: number; diverged: number; turnsPerItem: number | null }[] };
  items: Item[];
}

export function swapRecordProve(): { ok: boolean; skipped?: string; detail: string } {
  if (!existsSync(SWAP_RECORD)) return { ok: false, skipped: "no recorded swap", detail: `no record at ${SWAP_RECORD}` };
  const r = JSON.parse(readFileSync(SWAP_RECORD, "utf8")) as Rec;
  const fails: string[] = [];
  for (const route of r.report.routes) {
    const mine = r.items.filter((i) => i.route === route.route);
    const scored = mine.filter((i) => ["pass", "fail", "over_budget"].includes(i.status));
    const passes = scored.filter((i) => i.status === "pass").length;
    if (mine.length !== route.items || scored.length !== route.scored || passes !== route.passes) fails.push(`${route.route}: report says ${route.passes}/${route.scored} of ${route.items}, items give ${passes}/${scored.length} of ${mine.length}`);
    if (route.errors !== mine.filter((i) => i.status === "error").length || route.diverged !== mine.filter((i) => i.status === "diverged").length) fails.push(`${route.route}: errors or diverged differ`);
    if (route.rate !== null && Math.abs(route.rate - passes / scored.length) > 1e-9) fails.push(`${route.route}: rate differs`);
  }
  const g = r.report.gate;
  if (g.met !== (g.rate !== null && g.rate >= g.required)) fails.push("the gate's met flag does not follow from its rate");
  if (!g.met && r.report.verdict !== "withheld") fails.push("a comparison was given although the baseline did not reproduce its recorded passes");
  return fails.length === 0 ? { ok: true, detail: `recomputed ${r.items.length} stored items of the live run: both routes' counts and rates match the report, and the comparison was ${r.report.verdict} because the baseline reproduced ${((g.rate ?? 0) * 100).toFixed(1)}% against the ${(g.required * 100).toFixed(0)}% required` } : { ok: false, detail: fails.join("; ") };
}
