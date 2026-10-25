import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openLedger } from "../ledger/db.ts";
import { ingestClaudeCode } from "../ledger/ingest.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import { HARNESS_TOKENS, LANGUAGE_FROM, LANGUAGE_TO, PLANTED_CELLS, writeLanguageLogs } from "../sample/language.ts";
import { LANG_PARAMS, languageSurcharge, type LangReport } from "./surcharge.ts";

const SNAPSHOT = "data/prices/anthropic-litellm-2026-10-22.json";
/** How far a measured ratio may be from the planted one, as a share of it. The tasks carry noise of six per cent either way, and the harness text is fitted, not known. */
export const RATIO_TOLERANCE = 0.08;

export interface LangRow {
  script: string;
  model: string;
  planted: { tasks: number; ratio: number | null };
  measured: { tasks: number; ratio: number | null; status: string };
  ok: boolean;
  why: string;
}

export interface LangCheck {
  report: LangReport;
  rows: LangRow[];
  baselines: { model: string; plantedRate: number; measuredRate: number; measuredOverhead: number; ok: boolean }[];
  labelsAgree: boolean;
  labelDetail: string;
  ok: boolean;
}

/** Ingest the planted sessions, measure them, and compare each cell with what was planted: the ratio, or the reason there is no figure. */
export async function runLanguageCheck(): Promise<LangCheck> {
  const dir = mkdtempSync(join(tmpdir(), "desk-language-"));
  try {
    const db = openLedger(":memory:");
    try {
      await ingestClaudeCode(db, writeLanguageLogs(join(dir, "logs")), loadSnapshot(SNAPSHOT));
      const report = languageSurcharge(db, LANGUAGE_FROM, LANGUAGE_TO);
      const recorded = new Map((db.prepare("SELECT script, COUNT(*) AS n FROM human_prompt GROUP BY script").all() as unknown as { script: string; n: number }[]).map((r) => [r.script, r.n]));
      const plantedByScript = new Map<string, number>();
      for (const c of PLANTED_CELLS) plantedByScript.set(c.script, (plantedByScript.get(c.script) ?? 0) + c.tasks);
      // Each session opens with an English prompt that is not a task.
      const sessions = (db.prepare("SELECT COUNT(*) AS n FROM session").get() as { n: number }).n;
      plantedByScript.set("en", (plantedByScript.get("en") ?? 0) + sessions);
      const wrong = [...plantedByScript].filter(([s, n]) => (recorded.get(s) ?? 0) !== n).map(([s, n]) => `${s}: ${recorded.get(s) ?? 0} recorded, ${n} written`);
      const extra = [...recorded.keys()].filter((s) => !plantedByScript.has(s));
      const labelsAgree = wrong.length === 0 && extra.length === 0;

      const plantedBase = new Map(PLANTED_CELLS.filter((c) => c.script === "en").map((c) => [c.model, c]));
      const baselines = report.baselines.map((b) => {
        const p = plantedBase.get(b.model);
        const ok = !b.fitted || (p !== undefined && Math.abs(b.tokensPerChar - p.rate) / p.rate <= 0.05 && Math.abs(b.overheadTokens - HARNESS_TOKENS) <= 25);
        return { model: b.model, plantedRate: p?.rate ?? Number.NaN, measuredRate: b.tokensPerChar, measuredOverhead: b.overheadTokens, ok };
      });

      const rows: LangRow[] = [];
      for (const c of PLANTED_CELLS) {
        if (c.script === "en") continue;
        const base = plantedBase.get(c.model);
        const baseTasks = base?.tasks ?? 0;
        const expectShown = c.tasks >= LANG_PARAMS.minTasks && baseTasks >= LANG_PARAMS.minTasks;
        const ratio = base ? c.rate / base.rate : null;
        const cell = report.cells.find((x) => x.script === c.script && x.model === c.model);
        const measured = { tasks: cell?.tasks ?? 0, ratio: cell?.ratio ?? null, status: cell?.status ?? "missing" };
        let ok: boolean;
        let why: string;
        if (expectShown) {
          const close = measured.ratio !== null && ratio !== null && Math.abs(measured.ratio - ratio) / ratio <= RATIO_TOLERANCE;
          ok = measured.status === "shown" && close;
          why = ok ? "ratio recovered" : measured.status !== "shown" ? "should have been shown" : `ratio ${measured.ratio?.toFixed(2)} against ${ratio?.toFixed(2)} planted`;
        } else {
          ok = measured.status === "not enough data" && measured.ratio === null;
          why = ok ? "refused for too few tasks, as planted" : "a figure was given where there was too little data";
        }
        rows.push({ script: c.script, model: c.model, planted: { tasks: c.tasks, ratio: expectShown ? ratio : null }, measured, ok, why });
      }
      const ok = labelsAgree && rows.every((r) => r.ok) && baselines.every((b) => b.ok);
      return { report, rows, baselines, labelsAgree, labelDetail: labelsAgree ? "every prompt was labelled with the script it was written in" : [...wrong, ...extra.map((s) => `${s}: recorded but not planted`)].join("; "), ok };
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function renderLanguageCheck(c: LangCheck): string {
  const out: string[] = ["Language surcharge against a ledger with it planted"];
  out.push(c.labelsAgree ? `labels: ${c.labelDetail}` : `labels DIFFER: ${c.labelDetail}`);
  for (const b of c.baselines) out.push(`English on ${b.model}: planted ${b.plantedRate.toFixed(3)} tokens per character and ${HARNESS_TOKENS} of harness text; measured ${b.measuredRate.toFixed(3)} and ${b.measuredOverhead}${b.ok ? "" : "  <-- OFF"}`);
  for (const r of c.rows) {
    const planted = r.planted.ratio === null ? "no figure expected" : `${r.planted.ratio.toFixed(2)} times English`;
    const measured = r.measured.ratio === null ? r.measured.status : `${r.measured.ratio.toFixed(2)} times English`;
    out.push(`${r.script} on ${r.model}: ${r.planted.tasks} tasks planted, ${planted}; measured ${measured} from ${r.measured.tasks} tasks: ${r.ok ? "ok" : "WRONG"} (${r.why})`);
  }
  out.push(c.ok ? "Every cell was recovered or refused as planted." : "Some cell was not recovered as planted.");
  return out.join("\n");
}
