import { readFileSync } from "node:fs";

import { CassettePort } from "../agents/model.ts";
import { LOCALE_LANGS, LOCALE_RECORD, LOCALE_REPEATS, runLocaleExperiment, type LocaleRecord } from "../lang/locale-command.ts";
import { reportLocale, type LocaleRow } from "../lang/locale-route.ts";

const CASSETTES = "data/sample/cassettes";

/**
 * The locale route experiment, from the repository (DF-043). The recorded replies are replayed through the same code and the report is compared with the committed record, row
 * for row; then the judging is shown to work in both directions by changing the rows themselves: with every answer of the route made wrong, the verdict must be "worse", and
 * with the route made to answer exactly as the written task did, it must be "equivalent". A judge that called every route the same, or every route worse, would show nothing by
 * calling the recorded one either.
 */
export async function localeProve(): Promise<{ ok: boolean; detail: string }> {
  let committed: LocaleRecord;
  try {
    committed = JSON.parse(readFileSync(LOCALE_RECORD, "utf8")) as LocaleRecord;
  } catch {
    return { ok: false, detail: `${LOCALE_RECORD} is missing; run: npm run desk -- language experiment --record --write (needs a model)` };
  }
  const replayed = await runLocaleExperiment({ port: new CassettePort(CASSETTES), langs: LOCALE_LANGS, repeats: LOCALE_REPEATS, concurrency: 4 });
  if (JSON.stringify(replayed, null, 2) !== JSON.stringify(committed, null, 2)) {
    const missed = replayed.rows.filter((r) => r.error?.includes("cassette_miss")).length;
    return { ok: false, detail: missed > 0 ? `${missed} attempts have no recording: record them with: npm run desk -- language experiment --record --write` : `${LOCALE_RECORD} no longer matches what the recordings give; read the difference, then run: npm run desk -- language experiment --write` };
  }
  const rows = committed.rows;
  const opts = { langs: LOCALE_LANGS, repeats: LOCALE_REPEATS };
  const broken: LocaleRow[] = rows.map((r) => (r.arm === "translate" && r.score !== null ? { ...r, score: 0 as const } : r));
  const wrong = reportLocale(broken, opts);
  if (committed.report.english.gate && wrong.langs.some((l) => l.verdict !== "worse")) return { ok: false, detail: `with every answer of the route made wrong the verdict was ${wrong.langs.map((l) => l.verdict).join(", ")}, not worse` };
  const direct = new Map(rows.filter((r) => r.arm === "direct").map((r) => [`${r.lang}/${r.taskId}/${r.repeat}`, r.score]));
  const same: LocaleRow[] = rows.map((r) => (r.arm === "translate" ? { ...r, score: direct.get(`${r.lang}/${r.taskId}/${r.repeat}`) ?? r.score } : r));
  const equal = reportLocale(same, opts);
  if (committed.report.english.gate && equal.langs.some((l) => l.verdict !== "equivalent")) return { ok: false, detail: `with the route answering exactly as the written task did the verdict was ${equal.langs.map((l) => l.verdict).join(", ")}, not equivalent` };
  const gateOff = reportLocale(rows.map((r) => (r.arm === "english" && r.score !== null ? { ...r, score: 0 as const } : r)), opts);
  if (gateOff.langs.some((l) => l.verdict !== "withheld")) return { ok: false, detail: "with the English arm failing, the comparison was not withheld" };

  const r = committed.report;
  const per = r.langs.map((l) => `${l.lang}: ${l.verdict} (${l.delta ? `${l.delta.points.toFixed(1)} points, ${l.delta.low.toFixed(1)} to ${l.delta.high.toFixed(1)}` : "no interval"})`).join("; ");
  return { ok: true, detail: `the recorded run replays row for row (${rows.length} attempts); in English ${r.english.rate === null ? "no answers" : `${(100 * r.english.rate).toFixed(0)}%`} right; ${per}; the judge calls a route with every answer wrong worse, one that answers as the written task does equivalent, and withholds when English fails` };
}
