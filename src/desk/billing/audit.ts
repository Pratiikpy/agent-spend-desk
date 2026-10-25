import { analyseCalls } from "../autopsy/engine.ts";
import { loadAutopsyCalls } from "../autopsy/load.ts";
import { monthSpan } from "../close/month-bill.ts";
import type { Ledger } from "../ledger/db.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { loadCallFacts, wasteEventsOf } from "../waste/load.ts";

/**
 * The bill auditor (DF-062). A vendor that bills per outcome (a resolution, a completed task, a credit) decides for itself what a success is. The auditor holds each
 * billed line to the owner's own definition of one: for each day, how many sessions in the owner's logs met it, set against how many outcomes the vendor billed for that
 * day. It also lists lines that look billed twice and itemises what the day's charge may have gone to loops and failures. What it can see is the owner's side only, the
 * agent tools whose logs the Desk reads; an outcome the vendor produced somewhere the Desk cannot see is, to the auditor, an outcome with nothing behind it, so every
 * disputed figure is a claim to put to the vendor, never a finding that the vendor overbilled.
 */
export interface OutcomeDefinition {
  version: 1;
  /** What one billed outcome is called in sentences: "resolution", "task", "credit". */
  unit: string;
  /** A billed line is a per-outcome line when its description matches this expression (case-insensitive). */
  lineMatch: string;
  /** How many outcomes a line bills: its quantity, or one for the line. */
  unitsFrom: "quantity" | "line";
  /** A session backs an outcome when its work reached one of these states. A reverted session never does. */
  success: { landing: ("committed" | "merged" | "kept")[] };
  /** A session with fewer calls than this is too small to back an outcome. */
  minCalls: number;
  /** How many supported lines to print for the owner to spot-check, drawn with the seed below. */
  sample: number;
  seed: number;
}

export const DEFAULT_DEFINITION: OutcomeDefinition = {
  version: 1,
  unit: "outcome",
  lineMatch: "resolution|outcome|task|credit|agent run|completion",
  unitsFrom: "quantity",
  success: { landing: ["merged", "kept"] },
  minCalls: 3,
  sample: 10,
  seed: 1,
};

const KEYS = ["version", "unit", "lineMatch", "unitsFrom", "success", "minCalls", "sample", "seed"];

/** Read the owner's definition from JSON. Every field is optional and falls back to the default; a field that is present and wrong is refused, and so is a field that is not known. */
export function parseDefinition(text: string): OutcomeDefinition {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RangeError("the definition is not valid JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new RangeError("the definition must be a JSON object");
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) throw new RangeError(`the definition has a field "${k}" that is not known (known: ${KEYS.join(", ")})`);
  const d: OutcomeDefinition = { ...DEFAULT_DEFINITION, success: { landing: [...DEFAULT_DEFINITION.success.landing] } };
  if (o["version"] !== undefined && o["version"] !== 1) throw new RangeError("version must be 1");
  if (o["unit"] !== undefined) {
    if (typeof o["unit"] !== "string" || !/^[a-z][a-z -]{0,39}$/i.test(o["unit"])) throw new RangeError("unit must be a short word such as resolution");
    d.unit = o["unit"];
  }
  if (o["lineMatch"] !== undefined) {
    if (typeof o["lineMatch"] !== "string" || o["lineMatch"].length === 0 || o["lineMatch"].length > 200) throw new RangeError("lineMatch must be a regular expression of 1 to 200 characters");
    try {
      new RegExp(o["lineMatch"], "i");
    } catch {
      throw new RangeError("lineMatch is not a valid regular expression");
    }
    d.lineMatch = o["lineMatch"];
  }
  if (o["unitsFrom"] !== undefined) {
    if (o["unitsFrom"] !== "quantity" && o["unitsFrom"] !== "line") throw new RangeError('unitsFrom must be "quantity" or "line"');
    d.unitsFrom = o["unitsFrom"];
  }
  if (o["success"] !== undefined) {
    const s = o["success"] as { landing?: unknown } | null;
    if (typeof s !== "object" || s === null || Array.isArray(s) || Object.keys(s).some((k) => k !== "landing")) throw new RangeError("success must be an object with a landing list");
    if (!Array.isArray(s.landing) || s.landing.length === 0 || s.landing.some((x) => x !== "committed" && x !== "merged" && x !== "kept")) throw new RangeError('success.landing is a non-empty list of "committed", "merged" and "kept" (a reverted session never counts)');
    d.success = { landing: [...new Set(s.landing as ("committed" | "merged" | "kept")[])] };
  }
  const whole = (k: "minCalls" | "sample" | "seed", min: number, max: number): void => {
    if (o[k] === undefined) return;
    const v = o[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new RangeError(`${k} must be a whole number from ${min} to ${max}`);
    d[k] = v;
  };
  whole("minCalls", 1, 1000);
  whole("sample", 0, 200);
  whole("seed", 0, 2 ** 31 - 1);
  return d;
}

export type LineVerdict = "supported" | "partly_supported" | "unsupported" | "no_session";

export interface AuditLine {
  invoiceId: string;
  invoiceNumber: string | null;
  lineNo: number;
  day: string;
  description: string;
  units: number;
  amountMicros: number;
  supportedUnits: number;
  unsupportedUnits: number;
  /** The share of the line's amount that the unsupported units make up, in micro-units. */
  disputedMicros: number;
  verdict: LineVerdict;
}

export interface AuditDay {
  day: string;
  /** Sessions with a call that day, and of those the ones that could back an outcome (met the definition and are not already backing another day's). */
  sessions: number;
  qualifying: number;
  billedUnits: number;
  supportedUnits: number;
  billedMicros: number;
  /** The estimated model spend of the day, and the part of it the loop and failure rules flag. */
  spendMicros: number;
  wasteMicros: number;
  /** What the day's charge may have gone to loops and failures, on the assumption that it follows the share of model spend that went to them. */
  attributableMicros: number;
}

export interface Duplicate {
  day: string;
  description: string;
  quantity: number | null;
  amountMicros: number;
  copies: number;
  /** What the extra copies cost: the amount times one less than the copies. */
  duplicateMicros: number;
  lines: { invoiceId: string; lineNo: number }[];
}

export interface AuditCoverage {
  invoices: number;
  lines: number;
  amountMicros: number;
  perOutcomeLines: number;
  perOutcomeMicros: number;
  /** Per-outcome lines that could not be judged, with the reason, because a judgement would need a fact the line does not carry. */
  notJudged: { reason: string; lines: number; micros: number }[];
  /** Invoices left out because they were on hold for a sum mismatch. */
  heldInvoices: number;
  /** Lines of these invoices dated outside the month, which this audit does not read. */
  outsideMonthLines: number;
}

export interface Audit {
  vendor: string;
  month: string;
  currency: string;
  definition: OutcomeDefinition;
  coverage: AuditCoverage;
  lines: AuditLine[];
  days: AuditDay[];
  duplicates: Duplicate[];
  totals: {
    billedUnits: number;
    supportedUnits: number;
    unsupportedUnits: number;
    judgedMicros: number;
    disputedMicros: number;
    duplicateMicros: number;
    attributableMicros: number;
    loopEvents: number;
  };
  /** The supported lines drawn for the owner to check by hand. */
  spotCheck: AuditLine[];
}

export type AuditResult = { kind: "audit"; audit: Audit } | { kind: "cannot_run"; reason: string };

interface RawLine {
  invoiceId: string;
  invoiceNumber: string | null;
  lineNo: number;
  day: string | null;
  model: string | null;
  description: string;
  quantity: number | null;
  amountMicros: number;
  currency: string;
}

const DAY_MS = 86_400_000;
const dayOf = (iso: string): string => iso.slice(0, 10);
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** A small seeded generator, so that the lines drawn to check by hand are the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Round a share of an integer amount to the nearest unit without leaving the integers. */
function shareOf(amount: number, num: number, den: number): number {
  if (den <= 0) return 0;
  return Number((BigInt(amount) * BigInt(num) * 2n + BigInt(den)) / (BigInt(den) * 2n));
}

export interface AuditOptions {
  vendor: string;
  /** `YYYY-MM`. */
  month: string;
  definition?: OutcomeDefinition;
}

/** Hold one month of one vendor's invoice lines to the owner's definition of an outcome. Reads the ledger and writes nothing. */
export function auditInvoices(db: Ledger, snapshot: PriceSnapshot, o: AuditOptions): AuditResult {
  const def = o.definition ?? DEFAULT_DEFINITION;
  const span = monthSpan(o.month);
  const vendor = o.vendor.trim().toLowerCase();
  const invoiceRows = db
    .prepare("SELECT invoice_id AS id, status, currency FROM invoice WHERE vendor = ? AND period_start <= ? AND period_end >= ? ORDER BY invoice_id")
    .all(vendor, span.lastDay, span.firstDay) as unknown as { id: string; status: string; currency: string }[];
  if (invoiceRows.length === 0) return { kind: "cannot_run", reason: `no invoice from ${vendor} covers ${o.month}; import one with desk invoices import` };
  const used = invoiceRows.filter((i) => i.status === "imported");
  const held = invoiceRows.length - used.length;
  if (used.length === 0) return { kind: "cannot_run", reason: `every ${vendor} invoice for ${o.month} is on hold for a sum mismatch; check it and desk invoices accept it first` };
  const currencies = [...new Set(used.map((i) => i.currency))];
  if (currencies.length > 1) return { kind: "cannot_run", reason: `the ${vendor} invoices for ${o.month} are in more than one currency (${currencies.sort().join(", ")}), and nothing is converted` };
  const currency = currencies[0] as string;

  const lineStmt = db.prepare(
    `SELECT b.invoice_id AS invoiceId, i.invoice_number AS invoiceNumber, b.line_no AS lineNo, b.day AS day, b.model AS model, b.description AS description,
            b.quantity AS quantity, b.amount_micros AS amountMicros, i.currency AS currency
     FROM billed_line b JOIN invoice i ON i.invoice_id = b.invoice_id WHERE b.invoice_id = ? ORDER BY b.line_no`,
  );
  const all: RawLine[] = used.flatMap((i) => lineStmt.all(i.id) as unknown as RawLine[]);
  const inMonth = all.filter((l) => l.day !== null && l.day >= span.firstDay && l.day <= span.lastDay);
  const undated = all.filter((l) => l.day === null);
  const re = new RegExp(def.lineMatch, "i");
  const perOutcome = [...inMonth, ...undated].filter((l) => re.test(l.description));
  if (perOutcome.length === 0) {
    return {
      kind: "cannot_run",
      reason: `none of the ${inMonth.length} dated line${inMonth.length === 1 ? "" : "s"} of the ${vendor} invoices for ${o.month} looks like a per-outcome line (the definition matches /${def.lineMatch}/i); a vendor that bills for tokens or seats has no outcomes to hold to a definition`,
    };
  }

  // Which per-outcome lines can be judged, and how many outcomes each bills.
  const notJudged = new Map<string, { lines: number; micros: number }>();
  const skip = (reason: string, l: RawLine): void => {
    const x = notJudged.get(reason) ?? { lines: 0, micros: 0 };
    x.lines += 1;
    x.micros += l.amountMicros;
    notJudged.set(reason, x);
  };
  const judged: { raw: RawLine; units: number }[] = [];
  for (const l of perOutcome) {
    if (l.day === null) {
      skip("no date on the line, so there is no day to hold it to", l);
      continue;
    }
    if (l.amountMicros <= 0) {
      skip("a credit or refund, which is not a charge for an outcome", l);
      continue;
    }
    if (def.unitsFrom === "line") {
      judged.push({ raw: l, units: 1 });
      continue;
    }
    if (l.quantity === null || !Number.isFinite(l.quantity)) skip("no quantity on the line, so the number of outcomes billed is not known", l);
    else if (!Number.isInteger(l.quantity) || l.quantity <= 0) skip("a quantity that is not a whole number of outcomes", l);
    else judged.push({ raw: l, units: l.quantity });
  }
  if (judged.length === 0) return { kind: "cannot_run", reason: `${perOutcome.length} line${perOutcome.length === 1 ? " looks" : "s look"} like per-outcome lines but none carries a whole-number quantity of outcomes; set "unitsFrom": "line" if each line is one outcome` };

  // The owner's sessions: when each ran, how big it was, and what its work became.
  const sessions = db
    .prepare(
      `SELECT m.session_id AS id, MIN(m.ts) AS first, MAX(m.ts) AS last, COUNT(*) AS calls, COALESCE(o.state, 'unlinked') AS state
       FROM model_call m LEFT JOIN session_outcome o ON o.session_id = m.session_id
       WHERE m.session_id IS NOT NULL AND m.ts >= ? AND m.ts < ? GROUP BY m.session_id`,
    )
    .all(new Date(Date.parse(span.since) - 2 * DAY_MS).toISOString(), new Date(Date.parse(span.until) + 2 * DAY_MS).toISOString()) as unknown as { id: string; first: string; last: string; calls: number; state: string }[];
  const success = new Set<string>(def.success.landing);
  const backers = sessions
    .filter((s) => success.has(s.state) && s.calls >= def.minCalls)
    .map((s) => ({ id: s.id, from: dayOf(s.first), to: dayOf(s.last) }))
    .sort((a, b) => a.to.localeCompare(b.to) || a.from.localeCompare(b.from) || a.id.localeCompare(b.id));

  // Outcomes by day, in the order the lines come, then the backing sessions given out one to an outcome, the one that ends soonest first.
  const days = [...new Set(judged.map((j) => j.raw.day as string))].sort();
  const taken = new Set<string>();
  const supportedOnDay = new Map<string, number>();
  const qualifyingOnDay = new Map<string, number>();
  for (const d of days) {
    const available = backers.filter((b) => b.from <= d && b.to >= d && !taken.has(b.id));
    qualifyingOnDay.set(d, available.length);
    const wanted = judged.filter((j) => j.raw.day === d).reduce((n, j) => n + j.units, 0);
    const give = available.slice(0, wanted);
    for (const b of give) taken.add(b.id);
    supportedOnDay.set(d, give.length);
  }

  const lines: AuditLine[] = [];
  const remaining = new Map(supportedOnDay);
  for (const j of [...judged].sort((a, b) => (a.raw.day as string).localeCompare(b.raw.day as string) || a.raw.invoiceId.localeCompare(b.raw.invoiceId) || a.raw.lineNo - b.raw.lineNo)) {
    const d = j.raw.day as string;
    const left = remaining.get(d) ?? 0;
    const supportedUnits = Math.min(j.units, left);
    remaining.set(d, left - supportedUnits);
    const unsupportedUnits = j.units - supportedUnits;
    const dayHasSession = sessions.some((s) => dayOf(s.first) <= d && dayOf(s.last) >= d);
    lines.push({
      invoiceId: j.raw.invoiceId, invoiceNumber: j.raw.invoiceNumber, lineNo: j.raw.lineNo, day: d, description: j.raw.description, units: j.units, amountMicros: j.raw.amountMicros,
      supportedUnits, unsupportedUnits, disputedMicros: shareOf(j.raw.amountMicros, unsupportedUnits, j.units),
      verdict: unsupportedUnits === 0 ? "supported" : supportedUnits > 0 ? "partly_supported" : dayHasSession ? "unsupported" : "no_session",
    });
  }

  // What the day's model spend went to loops and failures. Both rules are the ones that need no judgement about the work: the same error repeated, and output cut off and redone.
  const first = days[0] as string;
  const last = days[days.length - 1] as string;
  const calls = loadAutopsyCalls(db, snapshot, `${first}T00:00:00.000Z`, `${addDays(last, 1)}T00:00:00.000Z`);
  const events = calls.length === 0 ? [] : wasteEventsOf(db, calls, analyseCalls(calls), loadCallFacts(db, calls), null).filter((e) => e.rule === "C-LOOP-2" || e.rule === "C-TRUNC");
  const spendByDay = new Map<string, number>();
  for (const r of db
    .prepare(`SELECT substr(m.ts, 1, 10) AS day, SUM(c.total_micros) AS micros FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated' WHERE m.ts >= ? AND m.ts < ? GROUP BY day`)
    .all(`${first}T00:00:00.000Z`, `${addDays(last, 1)}T00:00:00.000Z`) as unknown as { day: string; micros: number }[]) spendByDay.set(r.day, r.micros);
  const wasteByDay = new Map<string, number>();
  for (const e of events) {
    const d = new Date(Math.min(...e.calls.map((c) => c.tsMs))).toISOString().slice(0, 10);
    wasteByDay.set(d, (wasteByDay.get(d) ?? 0) + e.micros);
  }

  const dayRows: AuditDay[] = days.map((d) => {
    const dayLines = lines.filter((l) => l.day === d);
    const billedMicros = dayLines.reduce((n, l) => n + l.amountMicros, 0);
    const spend = spendByDay.get(d) ?? 0;
    const waste = Math.min(wasteByDay.get(d) ?? 0, spend);
    return {
      day: d,
      sessions: sessions.filter((s) => dayOf(s.first) <= d && dayOf(s.last) >= d).length,
      qualifying: qualifyingOnDay.get(d) ?? 0,
      billedUnits: dayLines.reduce((n, l) => n + l.units, 0),
      supportedUnits: dayLines.reduce((n, l) => n + l.supportedUnits, 0),
      billedMicros,
      spendMicros: spend,
      wasteMicros: waste,
      attributableMicros: shareOf(billedMicros, waste, spend),
    };
  });

  // The same line twice: one day, one description, one quantity, one amount, across every invoice of the vendor for the month, outcome lines or not.
  const groups = new Map<string, RawLine[]>();
  for (const l of inMonth) {
    if (l.amountMicros <= 0) continue;
    const key = JSON.stringify([l.day, l.description, l.quantity, l.amountMicros, l.model]);
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const duplicates: Duplicate[] = [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const f = g[0] as RawLine;
      return {
        day: f.day as string, description: f.description, quantity: f.quantity, amountMicros: f.amountMicros, copies: g.length, duplicateMicros: f.amountMicros * (g.length - 1),
        lines: g.map((x) => ({ invoiceId: x.invoiceId, lineNo: x.lineNo })),
      };
    })
    .sort((a, b) => b.duplicateMicros - a.duplicateMicros || a.day.localeCompare(b.day) || a.description.localeCompare(b.description));

  // Supported lines drawn at random for the owner to check by hand, the same draw every time.
  const rand = mulberry32(def.seed);
  const pool = lines.filter((l) => l.verdict === "supported");
  const drawn: AuditLine[] = [];
  const left = [...pool];
  while (drawn.length < def.sample && left.length > 0) drawn.push(left.splice(Math.floor(rand() * left.length), 1)[0] as AuditLine);
  drawn.sort((a, b) => a.day.localeCompare(b.day) || a.lineNo - b.lineNo);

  const sumBy = <T,>(xs: readonly T[], f: (x: T) => number): number => xs.reduce((n, x) => n + f(x), 0);
  const audit: Audit = {
    vendor, month: o.month, currency, definition: def,
    coverage: {
      invoices: used.length, lines: all.length, amountMicros: sumBy(all, (l) => l.amountMicros), perOutcomeLines: perOutcome.length, perOutcomeMicros: sumBy(perOutcome, (l) => l.amountMicros),
      notJudged: [...notJudged.entries()].map(([reason, x]) => ({ reason, ...x })).sort((a, b) => b.micros - a.micros),
      heldInvoices: held, outsideMonthLines: all.length - inMonth.length - undated.length,
    },
    lines, days: dayRows, duplicates,
    totals: {
      billedUnits: sumBy(lines, (l) => l.units), supportedUnits: sumBy(lines, (l) => l.supportedUnits), unsupportedUnits: sumBy(lines, (l) => l.unsupportedUnits),
      judgedMicros: sumBy(lines, (l) => l.amountMicros), disputedMicros: sumBy(lines, (l) => l.disputedMicros), duplicateMicros: sumBy(duplicates, (d) => d.duplicateMicros),
      attributableMicros: sumBy(dayRows, (d) => d.attributableMicros), loopEvents: events.length,
    },
    spotCheck: drawn,
  };
  return { kind: "audit", audit };
}
