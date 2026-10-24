import { existsSync, readFileSync, statSync } from "node:fs";

import type { Ledger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { gatewaySummary, importSpendLog, type SpendLogImport } from "./spend-log.ts";

const MAX_BYTES = 200 * 1024 * 1024;
const n = (x: number): string => x.toLocaleString("en-US");
const plural = (x: number, one: string, many: string): string => `${n(x)} ${x === 1 ? one : many}`;

export function renderImport(r: SpendLogImport): string {
  const out: string[] = [];
  out.push(`Read ${plural(r.rows, "request", "requests")} from ${r.file} (${r.format.toUpperCase()}): ${plural(r.callsNew, "new call", "new calls")}, ${n(r.callsAlreadyHeld)} already held.`);
  out.push(`  The gateway's own cost: ${n(r.withReportedCost)} with one${r.withoutReportedCost > 0 ? `, ${n(r.withoutReportedCost)} without` : ""}. It is stored beside the list-price estimate and replaces nothing.`);
  const skipped = Object.entries(r.skipped);
  if (skipped.length > 0) out.push(`  Not read: ${skipped.map(([why, c]) => `${n(c)} ${why}`).join("; ")}.`);
  if (r.duplicates > 0) out.push(`  ${plural(r.duplicates, "repeated request id was", "repeated request ids were")} read once.`);
  if (r.cacheUnsplit > 0) out.push(`  ${plural(r.cacheUnsplit, "row has", "rows have")} no cache split: all its prompt tokens are priced as fresh input, which overstates a model whose cache reads cost less.`);
  if (r.inconsistent > 0) out.push(`  ${plural(r.inconsistent, "row reported", "rows reported")} more cache tokens than its prompt held: the cache was scaled down to fit and the row is flagged.`);
  if (r.unpricedCalls > 0) out.push(`  ${plural(r.unpricedCalls, "call is", "calls are")} on a model with no price: ${Object.keys(r.unpricedModels).slice(0, 5).join(", ")}. Tokens are counted and no dollars are invented.`);
  if (r.contentColumnsNotRead.length > 0) out.push(`  Columns present and never read: ${r.contentColumnsNotRead.join(", ")}.`);
  if (r.unknownColumns.length > 0) out.push(`  Columns not recognised and ignored: ${r.unknownColumns.join(", ")}.`);
  return out.join("\n");
}

export function renderSummary(rows: ReturnType<typeof gatewaySummary>): string {
  if (rows.length === 0) return "No gateway call is held. Import a spend log with: desk gateway import <file>.";
  const out = ["Gateway cost against list price, per model, over the calls that carry both:"];
  for (const r of rows) {
    const gap = r.gap === null ? "no reported cost to compare" : `${r.gap >= 0 ? "+" : ""}${(r.gap * 100).toFixed(1)}% reported against estimated`;
    out.push(`  ${r.model.padEnd(32)} ${plural(r.calls, "call", "calls").padStart(12)}  reported ${formatUsd(r.reportedMicros).padStart(10)}  estimated ${formatUsd(r.estimatedMicros).padStart(10)}  ${gap}`);
  }
  out.push("A gap is a difference between two measurements, not an error in either: a gateway may price a cache hit, a discount or a routed provider differently from list price.");
  return out.join("\n");
}

export function gatewayCommand(db: Ledger, sub: string | undefined, arg: string | undefined, snapshot: PriceSnapshot): { ok: boolean; text: string } {
  if (sub === "import") {
    if (arg === undefined || arg === "") return { ok: false, text: "Name the spend log: desk gateway import <file.json|file.jsonl|file.csv>." };
    if (!existsSync(arg)) return { ok: false, text: `No such file: ${arg}.` };
    if (statSync(arg).size > MAX_BYTES) return { ok: false, text: `${arg} is larger than ${MAX_BYTES / 1024 / 1024} MB; split the export.` };
    const r = importSpendLog(db, readFileSync(arg, "utf8"), arg, snapshot);
    return typeof r === "string" ? { ok: false, text: `${arg}: ${r}` } : { ok: true, text: renderImport(r) };
  }
  if (sub === undefined || sub === "summary") return { ok: true, text: renderSummary(gatewaySummary(db)) };
  return { ok: false, text: `desk gateway: unknown subcommand "${sub}". Use: import <file>, summary.` };
}
