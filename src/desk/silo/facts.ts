import { basename } from "node:path";

import { NULL_TRACE, type Trace } from "../agents/trace.ts";
import { Q_HEADLINE, Q_INVOICES, Q_PULL_REQUESTS, Q_ROSTER } from "../../sponsors/zetaris/queries.ts";
import { serve, type ServeOptions, type ServedFrom, type SiloRows } from "../../sponsors/zetaris/silo-port.ts";
import type { Ledger } from "../ledger/db.ts";
import { TEAM_OF_REPO } from "./seed.ts";

/** What the three silos say, after parsing: numbers are numbers, and rows that do not parse are counted, not guessed. */
export interface InvoiceFact {
  invoiceId: string;
  team: string;
  day: string;
  model: string;
  amountMicros: number;
}

export interface PrFact {
  headSha: string;
  team: string;
  merged: boolean;
  checksGreen: boolean;
  reverted: boolean;
}

export interface RosterFact {
  team: string;
  seats: number;
  seatPlan: string;
  /** What one seat costs a month, when the roster says. */
  seatPriceUsd: number | null;
}

export interface HeadlineRow {
  team: string;
  seats: number;
  seatPlan: string;
  landedPrs: number;
  billedUsd: number | null;
  usdPerLandedPr: number | null;
}

export interface SiloFacts {
  invoices: InvoiceFact[];
  prs: PrFact[];
  roster: RosterFact[];
  headline: HeadlineRow[];
  /** Rows that did not parse, by silo. */
  skipped: { invoices: number; prs: number; roster: number; headline: number };
  /** How each silo's rows reached us. A silo that fell back is absent from the lists above. */
  served: Record<"invoices" | "prs" | "roster" | "headline", ServedFrom>;
  /** Why a silo fell back, when it did. */
  reasons: string[];
}

function col(rows: SiloRows, name: string): number {
  const i = rows.headers.indexOf(name);
  if (i < 0) throw new Error(`the answer has no column ${name}`);
  return i;
}

const num = (s: string): number | null => (s !== "" && Number.isFinite(Number(s)) ? Number(s) : null);
const bool = (s: string): boolean | null => (s === "true" || s === "t" || s === "1" ? true : s === "false" || s === "f" || s === "0" ? false : null);

export function parseInvoices(rows: SiloRows): { facts: InvoiceFact[]; skipped: number } {
  const [id, team, day, model, amt] = ["invoice_id", "workspace", "day", "model", "amount_usd"].map((n) => col(rows, n)) as [number, number, number, number, number];
  const facts: InvoiceFact[] = [];
  let skipped = 0;
  for (const r of rows.rows) {
    const usd = num(r[amt]!);
    if (usd === null || usd < 0 || !/^\d{4}-\d{2}-\d{2}/.test(r[day]!) || !r[team]) {
      skipped += 1;
      continue;
    }
    facts.push({ invoiceId: r[id]!, team: r[team]!, day: r[day]!.slice(0, 10), model: r[model]!, amountMicros: Math.round(usd * 1_000_000) });
  }
  return { facts, skipped };
}

export function parsePrs(rows: SiloRows): { facts: PrFact[]; skipped: number } {
  const [sha, team, merged, green, rev] = ["head_sha", "team", "merged_at", "checks_green", "reverted"].map((n) => col(rows, n)) as [number, number, number, number, number];
  const facts: PrFact[] = [];
  let skipped = 0;
  for (const r of rows.rows) {
    const g = bool(r[green]!);
    const v = bool(r[rev]!);
    if (!r[sha] || !r[team] || g === null || v === null) {
      skipped += 1;
      continue;
    }
    facts.push({ headSha: r[sha]!, team: r[team]!, merged: r[merged]! !== "", checksGreen: g, reverted: v });
  }
  return { facts, skipped };
}

export function parseRoster(rows: SiloRows): { facts: RosterFact[]; skipped: number } {
  const [team, seats, plan] = ["team", "seats", "seat_plan"].map((n) => col(rows, n)) as [number, number, number];
  const price = rows.headers.indexOf("seat_price_usd");
  const facts: RosterFact[] = [];
  let skipped = 0;
  for (const r of rows.rows) {
    const n = num(r[seats]!);
    if (!r[team] || n === null || n < 0) {
      skipped += 1;
      continue;
    }
    facts.push({ team: r[team]!, seats: n, seatPlan: r[plan]!, seatPriceUsd: price < 0 ? null : num(r[price]!) });
  }
  return { facts, skipped };
}

export function parseHeadline(rows: SiloRows): { facts: HeadlineRow[]; skipped: number } {
  const [team, seats, plan, landed, billed, per] = ["team", "seats", "seat_plan", "landed_prs", "billed_usd", "usd_per_landed_pr"].map((n) => col(rows, n)) as [number, number, number, number, number, number];
  const facts: HeadlineRow[] = [];
  let skipped = 0;
  for (const r of rows.rows) {
    const l = num(r[landed]!);
    const s = num(r[seats]!);
    if (!r[team] || l === null || s === null) {
      skipped += 1;
      continue;
    }
    facts.push({ team: r[team]!, seats: s, seatPlan: r[plan]!, landedPrs: l, billedUsd: num(r[billed]!), usdPerLandedPr: num(r[per]!) });
  }
  return { facts, skipped };
}

/** Run the four statements under the serving rule and parse what came back. A malformed answer is a fallback for that silo, with the reason. */
export async function fetchSiloFacts(o: ServeOptions): Promise<SiloFacts> {
  const trace: Trace = o.trace ?? NULL_TRACE;
  const out: SiloFacts = { invoices: [], prs: [], roster: [], headline: [], skipped: { invoices: 0, prs: 0, roster: 0, headline: 0 }, served: { invoices: "fallback", prs: "fallback", roster: "fallback", headline: "fallback" }, reasons: [] };
  const jobs: [keyof SiloFacts["served"], string, (r: SiloRows) => { facts: unknown[]; skipped: number }, (facts: unknown[]) => void][] = [
    ["invoices", Q_INVOICES, parseInvoices, (f) => (out.invoices = f as InvoiceFact[])],
    ["prs", Q_PULL_REQUESTS, parsePrs, (f) => (out.prs = f as PrFact[])],
    ["roster", Q_ROSTER, parseRoster, (f) => (out.roster = f as RosterFact[])],
    ["headline", Q_HEADLINE, parseHeadline, (f) => (out.headline = f as HeadlineRow[])],
  ];
  for (const [name, sql, parse, set] of jobs) {
    const s = await serve(sql, { ...o, trace });
    if (!s.result) {
      out.reasons.push(`${name}: ${s.reason ?? "no rows"}`);
      continue;
    }
    try {
      const p = parse(s.result);
      set(p.facts);
      out.skipped[name] = p.skipped;
      out.served[name] = s.servedFrom;
    } catch (e) {
      out.reasons.push(`${name}: ${(e as Error).message}`);
      trace.emit({ event: "desk.ingest", why: "computed", detail: { port: "silo", op: "zetaris.parse", silo: name, servedFrom: "fallback", reason: (e as Error).message } });
    }
  }
  return out;
}

// ---- reconciliation against the ledger ---------------------------------------------------------------------

export interface TeamMonth {
  team: string;
  month: string;
  estimatedMicros: number;
  billedMicros: number;
  /** Billed minus estimated, as a share of estimated. */
  deltaShare: number;
}

export interface Reconciliation {
  ledgerEstimatedMicros: number;
  /** Dollars the invoices cover: the invoice amounts for team-months that have one. */
  billedMicros: number;
  /** Ledger estimate for the same team-months, to compare with billed. */
  estimatedOfBilledMicros: number;
  /** Ledger estimate for team-months with no invoice, and for repositories that map to no team. */
  estimatedOnlyMicros: number;
  teamMonths: TeamMonth[];
  /** Of the dollars in the ledger, the share that has an invoice behind it. */
  billedShare: number;
}

export function teamOfProject(project: string | null): string | null {
  if (!project) return null;
  return TEAM_OF_REPO[basename(project.replaceAll("\\", "/"))] ?? null;
}

/** Compare invoice dollars with the ledger's list-price estimate per team and month. With no invoices, everything is estimated. */
export function reconcile(db: Ledger, invoices: readonly InvoiceFact[]): Reconciliation {
  const rows = db
    .prepare(
      `SELECT s.project_path AS project, substr(m.ts, 1, 7) AS month, SUM(c.total_micros) AS micros
       FROM model_call m JOIN cost_event c ON c.call_id = m.call_id JOIN session s ON s.session_id = m.session_id
       WHERE c.class = 'estimated' GROUP BY project, month`,
    )
    .all() as unknown as { project: string | null; month: string; micros: number }[];
  const est = new Map<string, number>();
  let ledgerTotal = 0;
  let unmapped = 0;
  for (const r of rows) {
    ledgerTotal += r.micros;
    const team = teamOfProject(r.project);
    if (!team) {
      unmapped += r.micros;
      continue;
    }
    est.set(`${team}|${r.month}`, (est.get(`${team}|${r.month}`) ?? 0) + r.micros);
  }
  const billed = new Map<string, number>();
  for (const i of invoices) billed.set(`${i.team}|${i.day.slice(0, 7)}`, (billed.get(`${i.team}|${i.day.slice(0, 7)}`) ?? 0) + i.amountMicros);

  const teamMonths: TeamMonth[] = [];
  let billedTotal = 0;
  let estOfBilled = 0;
  let estOnly = unmapped;
  for (const [k, e] of est) {
    const [team, month] = k.split("|") as [string, string];
    const b = billed.get(k);
    if (b === undefined) {
      estOnly += e;
      continue;
    }
    billedTotal += b;
    estOfBilled += e;
    teamMonths.push({ team, month, estimatedMicros: e, billedMicros: b, deltaShare: e === 0 ? 0 : (b - e) / e });
  }
  teamMonths.sort((a, b) => a.month.localeCompare(b.month) || a.team.localeCompare(b.team));
  return { ledgerEstimatedMicros: ledgerTotal, billedMicros: billedTotal, estimatedOfBilledMicros: estOfBilled, estimatedOnlyMicros: estOnly, teamMonths, billedShare: ledgerTotal === 0 ? 0 : estOfBilled / ledgerTotal };
}

export interface CiSummary {
  /** Sessions whose work reached a merge or better (landed) that have a pull-request row. */
  landedWithCi: number;
  landedGreen: number;
  /** Landed on a red check: merged although the checks failed. */
  landedRed: number;
  landedNoPr: number;
  /** Landed sessions whose pull request was reverted. */
  landedReverted: number;
}

/** Join the pull-request rows to the sessions through the commit each session was linked to. */
export function ciSummary(db: Ledger, prs: readonly PrFact[]): CiSummary {
  const bySha = new Map(prs.map((p) => [p.headSha, p]));
  const rows = db
    .prepare(
      `SELECT o.session_id AS id, c.sha AS sha FROM session_outcome o
       LEFT JOIN session_commit c ON c.session_id = o.session_id AND c.confidence IN ('high', 'medium')
       WHERE o.state IN ('merged', 'kept')`,
    )
    .all() as unknown as { id: string; sha: string | null }[];
  const perSession = new Map<string, PrFact[]>();
  for (const r of rows) {
    const list = perSession.get(r.id) ?? [];
    const pr = r.sha ? bySha.get(r.sha) : undefined;
    if (pr) list.push(pr);
    perSession.set(r.id, list);
  }
  const s: CiSummary = { landedWithCi: 0, landedGreen: 0, landedRed: 0, landedNoPr: 0, landedReverted: 0 };
  for (const list of perSession.values()) {
    if (list.length === 0) {
      s.landedNoPr += 1;
      continue;
    }
    s.landedWithCi += 1;
    if (list.some((p) => p.reverted)) s.landedReverted += 1;
    if (list.every((p) => p.checksGreen)) s.landedGreen += 1;
    else s.landedRed += 1;
  }
  return s;
}
