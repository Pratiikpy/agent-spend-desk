import { formatUsd } from "../money.ts";
import type { Audit, AuditLine } from "./audit.ts";

const n = (x: number): string => x.toLocaleString("en-US");
const money = (micros: number, currency: string): string => (currency === "USD" ? formatUsd(micros) : `${currency} ${(micros / 1_000_000).toFixed(2)}`);

const LANDING_WORDS: Record<string, string> = { committed: "committed", merged: "merged", kept: "kept" };

function lineText(l: AuditLine, currency: string): string {
  const where = `${l.invoiceNumber ?? l.invoiceId.slice(0, 12)} line ${l.lineNo}`;
  const body = l.verdict === "supported" ? `${n(l.units)} charged, all backed` : `${n(l.units)} charged, ${n(l.supportedUnits)} backed, ${n(l.unsupportedUnits)} not: ${money(l.disputedMicros, currency)} of ${money(l.amountMicros, currency)}`;
  return `  ${l.day}  "${l.description.slice(0, 48)}"  ${body}  (${where}${l.verdict === "no_session" ? "; no session of yours that day" : ""})`;
}

/** The audit as text, in the order a person reads it: the definition held to, how much of the bill it could judge, what is unsupported, what looks doubled, what loops cost. */
export function renderAudit(a: Audit, o: { listed?: number } = {}): string {
  const out: string[] = [];
  const d = a.definition;
  const landing = d.success.landing.map((s) => LANDING_WORDS[s] ?? s).join(" or ");
  out.push(`Bill audit for ${a.vendor}, ${a.month} (UTC days)`);
  out.push(`Held to your definition: a ${d.unit} is a session whose work was ${landing}, with at least ${n(d.minCalls)} calls. A reverted session never counts.`);
  const c = a.coverage;
  out.push(`Read ${n(c.invoices)} invoice${c.invoices === 1 ? "" : "s"} with ${n(c.lines)} line${c.lines === 1 ? "" : "s"}, ${money(c.amountMicros, a.currency)}; ${n(c.perOutcomeLines)} line${c.perOutcomeLines === 1 ? "" : "s"} (${money(c.perOutcomeMicros, a.currency)}) look like per-outcome lines.`);
  for (const nj of c.notJudged) out.push(`  Not judged: ${n(nj.lines)} line${nj.lines === 1 ? "" : "s"}, ${money(nj.micros, a.currency)}: ${nj.reason}.`);
  if (c.heldInvoices > 0) out.push(`  ${n(c.heldInvoices)} invoice${c.heldInvoices === 1 ? " is" : "s are"} on hold for a sum mismatch and left out.`);
  if (c.outsideMonthLines > 0) out.push(`  ${n(c.outsideMonthLines)} line${c.outsideMonthLines === 1 ? "" : "s"} are dated outside ${a.month} and not read here.`);
  out.push("");

  const t = a.totals;
  out.push(`${n(t.billedUnits)} ${d.unit}${t.billedUnits === 1 ? "" : "s"} charged on the judged lines (${money(t.judgedMicros, a.currency)}); your logs back ${n(t.supportedUnits)}, and ${n(t.unsupportedUnits)} have no session behind them: ${money(t.disputedMicros, a.currency)}.`);
  out.push("That is a claim to put to the vendor, not a finding. The Desk reads only the agent tools whose logs it has; an outcome produced anywhere else looks, from here, like one with nothing behind it. A session backs one outcome, the one that ends soonest first, and a day is a UTC day.");
  const disputed = a.lines.filter((l) => l.unsupportedUnits > 0).sort((x, y) => y.disputedMicros - x.disputedMicros || x.day.localeCompare(y.day));
  if (disputed.length > 0) {
    const shown = o.listed ?? 10;
    out.push("");
    out.push(`Lines to put to the vendor, the largest first${disputed.length > shown ? ` (${n(shown)} of ${n(disputed.length)})` : ""}:`);
    for (const l of disputed.slice(0, shown)) out.push(lineText(l, a.currency));
  } else out.push("Every judged line is backed by a session that meets your definition.");

  out.push("");
  if (a.duplicates.length === 0) out.push("No line appears twice.");
  else {
    out.push(`${n(a.duplicates.length)} line${a.duplicates.length === 1 ? " appears" : "s appear"} more than once (same day, description, quantity and amount); the extra copies charge ${money(t.duplicateMicros, a.currency)}. Two charges can be real, so ask the vendor:`);
    for (const x of a.duplicates.slice(0, 10)) out.push(`  ${x.day}  "${x.description.slice(0, 48)}"  ${n(x.copies)} copies of ${money(x.amountMicros, a.currency)}`);
  }

  out.push("");
  if (t.attributableMicros === 0) out.push(`No loop or failure rule fired on a day with a charge, so none of the charge is put down to them (${n(t.loopEvents)} found in the period).`);
  else {
    out.push(`${money(t.attributableMicros, a.currency)} of the charge may have gone to loops and failures (${n(t.loopEvents)} found: the same error repeated, output cut off and redone). This is an estimate: it assumes each day's charge follows the share of that day's model spend those took, and it is not part of the disputed figure, since a vendor may bill a failed attempt by its own terms.`);
    for (const x of a.days.filter((y) => y.attributableMicros > 0).sort((p, q) => q.attributableMicros - p.attributableMicros).slice(0, 5)) {
      out.push(`  ${x.day}  ${money(x.attributableMicros, a.currency)} of ${money(x.billedMicros, a.currency)} charged (${formatUsd(x.wasteMicros)} of ${formatUsd(x.spendMicros)} model spend)`);
    }
  }
  if (a.spotCheck.length > 0) {
    out.push("");
    out.push(`Backed lines to check by hand (${n(a.spotCheck.length)} drawn with seed ${d.seed}):`);
    for (const l of a.spotCheck) out.push(lineText(l, a.currency));
  }
  return out.join("\n");
}
