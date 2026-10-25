import type { ClaimInput, DossierInput, SentenceInput } from "../dossier/build.ts";
import type { Signer } from "../dossier/keys.ts";
import { MemoryLog } from "../dossier/log.ts";
import { formatUsd } from "../money.ts";
import type { Row } from "../verify/format.ts";
import type { Audit } from "./audit.ts";
import { monthSpan } from "../close/month-bill.ts";

/**
 * The dispute pack (DF-062): the audit as a signed dossier a counterparty can check, with nothing in it the owner did not mean to hand over. It holds the vendor's own
 * lines, how many outcomes the owner's logs back for each day, and the sums. It holds no prompt, no code, no file path, no session id and no project name: every row
 * is built from a short list of fields, and `redactionProblems` refuses a row that carries anything else, or text that looks like a path or a block of code.
 *
 * What the verifier recomputes is the sums over these rows. The rule that gives the outcomes out to lines (a session backs one outcome, the one that ends soonest first)
 * is not recomputed by it; the pack says so, and carries each day's counts so that a person can redo the rule by hand.
 */
const LINE_FIELDS = ["invoice", "line", "day", "description", "units", "supported_units", "unsupported_units", "amount_micros", "disputed_micros", "verdict", "class"] as const;
const DAY_FIELDS = ["day", "sessions", "qualifying_sessions", "billed_units", "supported_units", "attributable_micros", "class"] as const;
const DUP_FIELDS = ["day", "description", "copies", "amount_micros", "duplicate_micros", "class"] as const;

const PATH_LIKE = /(^|[\s"'(])([A-Za-z]:[\\/]|\\\\|\/(?:home|Users|var|etc|tmp|opt|usr|mnt|root)\/)/;
const CODE_LIKE = /```|;\s*$|=>|\bfunction\s*\(|\bimport\s+\{|<\/?[a-z][a-z0-9]*[ >]/m;

/** Why a row may not go in the pack, one line each; empty when it may. */
export function redactionProblems(stream: string, row: Record<string, unknown>): string[] {
  const allowed: readonly string[] = stream === "audit_line" ? LINE_FIELDS : stream === "audit_day" ? DAY_FIELDS : stream === "audit_dup" ? DUP_FIELDS : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (!allowed.includes(k)) out.push(`${stream}.${k} is not a field a dispute pack carries`);
    else if (typeof v === "string") {
      if (v.length > 200) out.push(`${stream}.${k} is ${v.length} characters; a pack carries short vendor text only`);
      else if (/[\r\n]/.test(v)) out.push(`${stream}.${k} has a line break in it`);
      else if (PATH_LIKE.test(v)) out.push(`${stream}.${k} looks like a file path`);
      else if (CODE_LIKE.test(v)) out.push(`${stream}.${k} looks like code`);
    } else if (v !== null && typeof v !== "number" && typeof v !== "boolean") out.push(`${stream}.${k} is not text, a number or a flag`);
  }
  return out;
}

export interface PackInput {
  input: DossierInput;
  /** How many rows and which streams, for the command to report. */
  rows: { lines: number; days: number; duplicates: number };
}

const n = (x: number): string => x.toLocaleString("en-US");

export function disputePackInput(a: Audit, o: { signer: Signer; tenant: string; now: Date }): PackInput {
  const span = monthSpan(a.month);
  const log = new MemoryLog();
  const problems: string[] = [];
  const add = (stream: string, kind: string, row: Record<string, unknown>): void => {
    problems.push(...redactionProblems(stream, row));
    log.append(stream, kind, row);
  };
  for (const l of a.lines) {
    add("audit_line", "line", {
      invoice: l.invoiceNumber ?? l.invoiceId.slice(0, 16), line: l.lineNo, day: l.day, description: l.description, units: l.units, supported_units: l.supportedUnits,
      unsupported_units: l.unsupportedUnits, amount_micros: l.amountMicros, disputed_micros: l.disputedMicros, verdict: l.verdict, class: "billed",
    });
  }
  for (const d of a.days) {
    add("audit_day", "day", { day: d.day, sessions: d.sessions, qualifying_sessions: d.qualifying, billed_units: d.billedUnits, supported_units: d.supportedUnits, attributable_micros: d.attributableMicros, class: "estimated" });
  }
  for (const d of a.duplicates) {
    add("audit_dup", "duplicate", { day: d.day, description: d.description, copies: d.copies, amount_micros: d.amountMicros, duplicate_micros: d.duplicateMicros, class: "billed" });
  }
  if (problems.length > 0) throw new RangeError(`the pack was not built: ${problems[0]}`);

  const range = (stream: string, count: number) => ({ stream, from: 0, to: count - 1 });
  const nl = a.lines.length;
  const nd = a.days.length;
  const nu = a.duplicates.length;
  const count = (id: string, text: string, field: string, stream: string, rows: number): ClaimInput => ({
    id, kind: "number", text, unit: "count", class: "computed", decimals: 0, divisor: 1, computation: { fn: "sum@1", args: { field }, range: range(stream, rows) },
  });
  const usd = (id: string, text: string, field: string, stream: string, rows: number, cls: "billed" | "computed" | "estimated"): ClaimInput => ({
    id, kind: "number", text, unit: "usd", class: cls, decimals: 2, divisor: 1_000_000,
    computation: { fn: "sum@1", args: cls === "computed" ? { field } : { field, class_field: "class" }, range: range(stream, rows) },
  });
  const claims: ClaimInput[] = [
    count("units_billed", `${a.definition.unit}s on the judged lines`, "units", "audit_line", nl),
    count("units_supported", `${a.definition.unit}s the owner's logs back`, "supported_units", "audit_line", nl),
    count("units_unsupported", `${a.definition.unit}s with no session behind them`, "unsupported_units", "audit_line", nl),
    usd("judged", "Charged on the judged lines", "amount_micros", "audit_line", nl, "billed"),
    usd("disputed", "The share of those lines that the unsupported outcomes make up", "disputed_micros", "audit_line", nl, "computed"),
  ];
  if (nd > 0 && a.totals.attributableMicros > 0) claims.push(usd("loops", "Charge that may have gone to loops and failures", "attributable_micros", "audit_day", nd, "estimated"));
  if (nu > 0) {
    claims.push(
      { id: "dup_groups", kind: "number", text: "Lines that appear more than once", unit: "count", class: "computed", decimals: 0, divisor: 1, computation: { fn: "count@1", args: {}, range: range("audit_dup", nu) } },
      usd("dup_amount", "Charged for the extra copies", "duplicate_micros", "audit_dup", nu, "billed"),
    );
  }

  const unit = a.definition.unit;
  const t = a.totals;
  const sentences: SentenceInput[] = [
    { id: "s_units", text: `The judged lines charge for ${n(t.billedUnits)} ${unit}s; the owner's logs back ${n(t.supportedUnits)} of them and ${n(t.unsupportedUnits)} have no session behind them.`, cites: ["units_billed", "units_supported", "units_unsupported"] },
    { id: "s_amount", text: `The judged lines charge ${formatUsd(t.judgedMicros)}, and the ${n(t.unsupportedUnits)} unsupported ${unit}s make up ${formatUsd(t.disputedMicros)} of it.`, cites: ["judged", "units_unsupported", "disputed"] },
  ];
  if (nu > 0) sentences.push({ id: "s_dup", text: `${n(nu)} line${nu === 1 ? " appears" : "s appear"} more than once; the extra copies charge ${formatUsd(t.duplicateMicros)}.`, cites: ["dup_groups", "dup_amount"] });
  if (claims.some((c) => c.id === "loops")) sentences.push({ id: "s_loops", text: `${formatUsd(t.attributableMicros)} of the charge may have gone to loops and failures, if the charge follows the share of model spend those took each day.`, cites: ["loops"] });

  const input: DossierInput = {
    kind: "dispute_pack", tenant: o.tenant, period: { from: span.firstDay, to: span.lastDay }, createdAt: o.now.toISOString(), audience: "counterparty", disclosure: "redacted",
    log: log.rows as Row[], claims, sentences, signer: o.signer,
  };
  return { input, rows: { lines: nl, days: nd, duplicates: nu } };
}
