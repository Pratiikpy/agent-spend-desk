import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { choosePort } from "../propose/command.ts";
import { LANGS, loadLocaleTasks, renderLocale, reportLocale, runLocale, type Lang, type LocaleReport, type LocaleRow } from "./locale-route.ts";

export const LOCALE_RECORD = "docs/verification/language/locale-route.json";
export const LOCALE_REPEATS = 3;
/** Recorded with this many repeats per task, in these languages: the committed record and the recordings behind it. */
export const LOCALE_LANGS: readonly Lang[] = ["ja", "hi"];

/** What is written to the repository: the report, and each attempt it was made from, so that the figures can be recomputed from the rows. */
export interface LocaleRecord {
  version: 1;
  report: LocaleReport;
  rows: LocaleRow[];
}


export async function runLocaleExperiment(o: { port: Parameters<typeof runLocale>[0]["port"]; langs: readonly Lang[]; repeats: number; concurrency?: number }): Promise<LocaleRecord> {
  const tasks = loadLocaleTasks();
  const rows = await runLocale({ port: o.port, tasks, langs: o.langs, repeats: o.repeats, concurrency: o.concurrency ?? 2 });
  return { version: 1, report: reportLocale(rows, { langs: o.langs, repeats: o.repeats }), rows };
}

/**
 * `desk language experiment`: run the locale route (translate to English, work, translate back) against sending the task in its own language, on the sixteen localised canary
 * tasks, and report the pass rates, the interval on their difference, and the tokens. In sample mode it replays the recordings; live it needs a model, and with `--record` it
 * writes the replies so that sample mode can replay them. `--write` stores the result in the repository.
 */
export async function localeExperimentCommand(o: { sampleMode: boolean; record: boolean; cassetteDir: string; env: Record<string, string | undefined>; lang: string | undefined; repeats: number | undefined; write: boolean }): Promise<string> {
  const langs = (o.lang ?? LOCALE_LANGS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const bad = langs.filter((l) => !(l in LANGS));
  if (bad.length > 0) return `Unknown language: ${bad.join(", ")}. The languages are ${Object.keys(LANGS).join(", ")}.`;
  const route = choosePort({ sampleMode: o.sampleMode, record: o.record, reuse: true, cassetteDir: o.cassetteDir, env: o.env });
  if (route.port === null) return `No model to run the route on: ${route.label}. Set MODEL_BASE_URL, MODEL_API_KEY and NEMOTRON_MODEL (or the NVIDIA names), or use --sample to replay the recordings.`;
  const record = await runLocaleExperiment({ port: route.port, langs: langs as Lang[], repeats: o.repeats ?? LOCALE_REPEATS });
  const out = [renderLocale(record.report), "", `model route: ${route.label}`];
  const failed = record.rows.filter((r) => r.score === null).length;
  if (failed > 0) out.push(`${failed} of ${record.rows.length} attempts produced no answer (the first reason: ${record.rows.find((r) => r.error)?.error ?? "none given"}); they are not counted as wrong.`);
  if (o.write) {
    mkdirSync(dirname(LOCALE_RECORD), { recursive: true });
    writeFileSync(LOCALE_RECORD, `${JSON.stringify(record, null, 2)}\n`);
    out.push(`wrote ${LOCALE_RECORD}`);
  }
  return out.join("\n");
}
