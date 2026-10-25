import { writeFileSync } from "node:fs";

import type { Ledger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { bill, type Span, type UiContext } from "../ui/queries.ts";
import { monthSpan } from "../close/month-bill.ts";
import { billLines, toCsv } from "./export.ts";

export interface BillOptions {
  db: Ledger;
  snapshot: PriceSnapshot;
  mode: "sample" | "own_logs";
  /** A calendar month, 2026-09; or since and until as dates. With none of them: everything in the ledger. */
  month?: string;
  since?: string;
  until?: string;
  exportAs?: "csv" | "json";
  /** Where to write the export; without it the export is the output. */
  out?: string;
  now?: Date;
}

export interface BillResult {
  text: string;
  ok: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const usd = formatUsd;

/** A period as a span the screens' query understands: a calendar month, or dates, or everything the ledger holds. A string is the reason it could not be read. */
export function spanOf(o: { db: Ledger; month?: string | undefined; since?: string | undefined; until?: string | undefined }): Span | string {
  if (o.month !== undefined && (o.since !== undefined || o.until !== undefined)) return "Give a month, or --since and --until, not both.";
  if (o.month !== undefined) {
    let m;
    try {
      m = monthSpan(o.month);
    } catch (e) {
      return (e as Error).message;
    }
    return { sinceIso: m.since, untilIso: `${m.lastDay}T23:59:59.999Z`, days: Number(m.lastDay.slice(8)), lastIso: null };
  }
  for (const [name, v] of [["--since", o.since], ["--until", o.until]] as const) if (v !== undefined && !DATE.test(v)) return `${name} must be a date such as 2026-09-01, got "${v}".`;
  const bounds = o.db.prepare("SELECT MIN(ts) a, MAX(ts) b FROM model_call").get() as unknown as { a: string | null; b: string | null };
  const since = o.since !== undefined ? `${o.since}T00:00:00.000Z` : (bounds.a ?? "0000");
  const until = o.until !== undefined ? `${o.until}T23:59:59.999Z` : (bounds.b ?? "9999");
  if (since > until) return "--since is after --until.";
  const days = bounds.a === null ? 1 : Math.max(1, Math.round((Date.parse(until) - Date.parse(since)) / 86_400_000));
  return { sinceIso: since, untilIso: until, days, lastIso: bounds.b };
}

interface Row {
  [k: string]: any;
}

/** The bill as text: the same figures the Bill screen shows, from the same query. */
export function renderBill(b: Row, span: Span): string {
  const out: string[] = [];
  const from = span.sinceIso.slice(0, 10);
  const to = span.untilIso.slice(0, 10);
  out.push(`Bill, ${from} to ${to}: ${usd(b["totals"].estimatedMicros)} estimated at list price over ${b["totals"].pricedCalls.toLocaleString("en-US")} priced calls.`);
  out.push("An estimate from logged tokens, not an invoice.");
  out.push("");
  out.push("Kinds of figure");
  out.push(`  ${b["coverageLine"]}`);
  for (const c of b["classes"] as Row[]) out.push(`  ${String(c["cls"]).padEnd(10)} ${c["note"]}`);
  if ((b["reconciliations"] as Row[]).length > 0) {
    out.push("");
    out.push("Billed against estimated");
    for (const r of b["reconciliations"] as Row[]) {
      const billed = r["billedMicros"] === null ? "none" : r["currency"] === "USD" ? usd(r["billedMicros"]) : `${r["currency"]} ${(r["billedMicros"] / 1e6).toFixed(2)}`;
      out.push(`  ${r["vendor"]} ${r["period"]}: billed ${billed}, estimated ${usd(r["estimatedMicros"])}, ${r["status"]}: ${r["reason"]}`);
      if (r["flip"]) out.push(`    what would flip it: ${r["flip"]}`);
    }
  }
  const landing = b["landing"] as Row;
  out.push("");
  out.push("What it bought");
  if (!landing["linked"]) out.push("  No repository is linked, so nothing can be called landed. Every session is unlinked: unknowable, not waste.");
  else {
    for (const r of landing["rows"] as Row[]) if (r["micros"] > 0) out.push(`  ${String(r["state"]).padEnd(10)} ${usd(r["micros"]).padStart(12)}  ${(r["share"] * 100).toFixed(1).padStart(5)}%  ${r["sessions"]} session${r["sessions"] === 1 ? "" : "s"}`);
    out.push(`  ${usd(landing["lowConfidenceMicros"])} of linked spend rests on weak evidence and is not counted as landed.`);
    out.push(b["costPerLandedSession"] === null ? "  No session landed, so there is no cost per landed session." : `  ${usd(b["costPerLandedSession"])} per landed session over ${b["landedSessions"]} session${b["landedSessions"] === 1 ? "" : "s"}.`);
  }
  out.push("");
  out.push("Where it went");
  for (const c of b["causes"] as Row[]) out.push(`  ${String(c["cause"]).padEnd(14)} ${usd(c["micros"]).padStart(12)}  ${(c["share"] * 100).toFixed(1).padStart(5)}%`);
  const own = b["deskOwn"] as Row | null;
  if (own) {
    out.push("");
    out.push("The Desk's own model calls (not in the agents' figures above)");
    out.push(`  ${own["calls"].toLocaleString("en-US")} calls, ${own["tokensIn"].toLocaleString("en-US")} tokens in and ${own["tokensOut"].toLocaleString("en-US")} out: ${own["priced"] === 0 ? "no call was priced" : `${usd(own["micros"])} estimated on ${own["priced"].toLocaleString("en-US")} priced calls`}${own["unpriced"] > 0 ? `; ${own["unpriced"].toLocaleString("en-US")} on a model with no price (counted, not priced)` : ""}${own["failed"] > 0 ? `; ${own["failed"].toLocaleString("en-US")} failed (whether billed is unknown)` : ""}.`);
    for (const r of own["byRole"] as Row[]) out.push(`  ${String(r["role"]).padEnd(18)} ${String(r["calls"]).padStart(6)} calls ${(r["priced"] === 0 ? "not priced" : usd(r["micros"])).padStart(12)}`);
    out.push(own["dailyCapMicros"] === null ? "  No daily limit is set (DESK_OWN_DAILY_CAP_USD)." : `  Today ${usd(own["spentTodayMicros"])} of a daily limit of ${usd(own["dailyCapMicros"])}.`);
  }
  const pricing = b["pricing"] as Row | null;
  if (pricing && (pricing["rules"] as Row[]).length > 0) {
    out.push("");
    out.push("Pricing rules in the period");
    for (const r of pricing["rules"] as Row[]) out.push(`  ${r["calls"].toLocaleString("en-US")} calls ${r["label"]}${r["note"] ? " (recorded, not guessed)" : ""}`);
  }
  if (b["priceBand"]) {
    const pb = b["priceBand"] as Row;
    out.push("");
    out.push(`Price check: ${pb["source"]} disagrees with our price book; the estimate is between ${usd(pb["lowMicros"])} and ${usd(pb["highMicros"])}.`);
  }
  const top = (rows: Row[], label: string, name: string): void => {
    out.push("");
    out.push(label);
    for (const r of rows.slice(0, 10)) out.push(`  ${String(r[name]).padEnd(28)} ${(r["micros"] === null ? "unpriced" : usd(r["micros"])).padStart(12)}`);
  };
  top(b["byModel"], "By model", "model");
  top(b["byProject"], "By project", "project");
  out.push("");
  out.push(`Price snapshot ${b["snapshotId"]}. The export (--export csv or json) holds every day, project, model and landing state as a row.`);
  return out.join("\n");
}

/** `desk bill`: the bill as text or as an export, for a month or any dates. Reads only. */
export function billCommand(o: BillOptions): BillResult {
  const span = spanOf(o);
  if (typeof span === "string") return { ok: false, text: span };
  if (o.exportAs !== undefined && o.exportAs !== "csv" && o.exportAs !== "json") return { ok: false, text: `--export must be csv or json, got "${o.exportAs as string}".` };
  const ctx: UiContext = { db: o.db, snapshot: o.snapshot, policiesDir: "policies", mode: o.mode, ledgerName: "ledger", env: {}, nowMs: () => (o.now ?? new Date()).getTime() };
  const b = bill(ctx, span) as Row;
  if (b["state"] === "empty") return { ok: false, text: `${b["reason"]} ${b["hint"]}` };
  if (b["totals"].pricedCalls === 0 && b["totals"].unpricedCalls === 0) return { ok: false, text: `The ledger holds no call between ${span.sinceIso.slice(0, 10)} and ${span.untilIso.slice(0, 10)}. Run desk ingest, or name other dates.` };
  if (o.exportAs === undefined) return { ok: true, text: renderBill(b, span) };
  const lines = billLines(o.db, span.sinceIso, span.untilIso);
  const body =
    o.exportAs === "csv"
      ? toCsv(lines)
      : `${JSON.stringify({ schema: "desk.bill.v1", period: { from: span.sinceIso.slice(0, 10), to: span.untilIso.slice(0, 10) }, snapshot: o.snapshot.snapshotId, note: "Estimated lines are list price times logged tokens, not an invoice. Billed lines are what imported invoices charge.", bill: b, lines }, null, 2)}\n`;
  if (o.out === undefined) return { ok: true, text: body.replace(/\r?\n$/, "") };
  writeFileSync(o.out, body);
  return { ok: true, text: `Wrote ${lines.length} line${lines.length === 1 ? "" : "s"} (${o.exportAs}) to ${o.out}.` };
}
