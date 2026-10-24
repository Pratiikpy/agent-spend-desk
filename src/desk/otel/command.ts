import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

import type { Ledger } from "../ledger/db.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { exportOtel } from "./export.ts";
import { importOtel, renderOtelImport } from "./ingest.ts";

const MAX_BYTES = 500 * 1024 * 1024;

/** `desk otel import FILE` reads an OTLP/JSON export of traces; `desk otel export [--since D] [--until D] [--output FILE]` writes the Desk's own record as GenAI spans. */
export function otelCommand(db: Ledger, sub: string | undefined, arg: string | undefined, snapshot: PriceSnapshot, o: { since?: string; until?: string; output?: string } = {}): { ok: boolean; text: string } {
  if (sub === "import") {
    if (arg === undefined || arg === "") return { ok: false, text: "Name the export: desk otel import <file.json|file.jsonl>." };
    if (!existsSync(arg)) return { ok: false, text: `No such file: ${arg}.` };
    if (statSync(arg).size > MAX_BYTES) return { ok: false, text: `${arg} is larger than ${MAX_BYTES / 1024 / 1024} MB; split the export.` };
    const r = importOtel(db, readFileSync(arg, "utf8"), arg, snapshot);
    return typeof r === "string" ? { ok: false, text: `${arg}: ${r}` } : { ok: true, text: renderOtelImport(r) };
  }
  if (sub === "export") {
    for (const [name, v] of [["--since", o.since], ["--until", o.until]] as const) if (v !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, text: `${name} must be a date such as 2026-09-01, got "${v}".` };
    const since = o.since !== undefined ? `${o.since}T00:00:00.000Z` : "0000";
    const until = o.until !== undefined ? `${o.until}T23:59:59.999Z` : "9999";
    const out = exportOtel(db, since, until);
    if (out.calls === 0) return { ok: false, text: "The ledger holds no call in that period, so there is nothing to export." };
    const body = `${JSON.stringify(out.doc)}\n`;
    if (o.output === undefined) return { ok: true, text: body.trimEnd() };
    writeFileSync(o.output, body);
    return { ok: true, text: `Wrote ${out.calls} call${out.calls === 1 ? "" : "s"} in ${out.sessions} session${out.sessions === 1 ? "" : "s"} as OTLP/JSON GenAI spans to ${o.output}. desk.budget.reservation_id and desk.retry_of are not emitted: nothing in the ledger holds them.` };
  }
  return { ok: false, text: `desk otel: ${sub === undefined ? "name a subcommand" : `unknown subcommand "${sub}"`}. Use: import <file>, export.` };
}
