import { baselineReproduction, withheldNotice } from "../replay/reproduction.ts";
import type { GateHealth } from "../gate/health.ts";
import { flagsFor, flagTotals } from "../security/flag.ts";
import { summariseEgress } from "../security/egress.ts";
import { manifestFromEnv } from "../security/net.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { computeReconciliations } from "../billing/reconcile.ts";
import { openQuestions } from "../outcomes/questions.ts";
import { approvalHabit, renderHabit, type ApprovalHabit } from "../approvals/habit.ts";
import { canaryCard, type CanaryCard } from "../canary/card.ts";
import { OWN_RUNS, SAMPLE_RUNS } from "../canary/command.ts";
import { nightLine, readGateNight } from "../gate/readout.ts";
import { addDays, isDate, localDate, localDayRange } from "./localday.ts";
import { ADAPTERS, CAPABILITY_KEYS, CAPABILITY_TITLE, NO_ADAPTER } from "../adapters/registry.ts";
import { explainBlock, findBlocks, type BlockKind } from "../explain/blocks.ts";
import { readExcerpts } from "../explain/lines.ts";
import { classCoverage, coverageLine } from "../bill/coverage.ts";
import { formatUsd } from "../money.ts";
import { buildReview, weekLabel, weekRange } from "../review/review.ts";
import { defaultMarkerPath, readMarkers } from "../tasks/markers.ts";
import { analyseCalls, buildAutopsy, CAUSES, type Autopsy, type AutopsyCall, type Cause, type PerCall } from "../autopsy/engine.ts";
import { loadAutopsyCalls } from "../autopsy/load.ts";
import { wasteEventsOf } from "../waste/load.ts";
import { delegationTrees } from "../delegation/tree.ts";
import { overheadView } from "../overhead/view.ts";
import { capLabel } from "../policy/types.ts";
import { ladder, readResults, TOOLS } from "../enforce/ladder.ts";
import { installedVersions } from "../enforce/version.ts";
import { buildCard } from "../card/build.ts";
import type { Ledger } from "../ledger/db.ts";
import { landingBreakdown } from "../outcomes/breakdown.ts";
import { reconcile, summariseReconciliation, type ReconcileRow } from "../reconcile/reconcile.ts";
import { groupLabel, limitGroups } from "../limits/fit.ts";
import { renderRunway, runwayDetail, runwayFromLedger, runwayHead } from "../limits/runway.ts";
import { plansView } from "../limits/plans.ts";
import { comparePrices, type ForeignRow } from "../pricing/compare.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { costBand, priceSensitivity } from "../pricing/sensitivity.ts";
import { describeWidening, restrictCheck } from "../policy/restrict.ts";
import { parsePolicyYaml } from "../policy/parse.ts";
import type { Policy } from "../policy/types.ts";
import { replaySessionsFromLedger } from "../replay/from-ledger.ts";
import { replayPolicy } from "../replay/policy-replay.ts";
import { windTunnel } from "../replay/wind-tunnel.ts";
import { createRedactor } from "../card/redact.ts";

/**
 * Everything the screens show, as plain JSON, computed from a read-only ledger with the same engines the
 * command line uses. Nothing here writes. Strings that came from logs (project folders) pass through the
 * card redactor and are shortened to a folder name, so an absolute path never reaches the browser.
 */
export interface UiContext {
  db: Ledger;
  snapshot: PriceSnapshot;
  policiesDir: string;
  mode: "sample" | "own_logs";
  ledgerName: string;
  env: Readonly<Record<string, string | undefined>>;
  nowMs: () => number;
  /** The approval record (dossier database), read for how approvals were made; null in the sample, which has none. */
  dossierDbPath?: string | null;
  /** Where the recorded results of the enforcement tests are kept; the Policy screen reads them. */
  enforcementPath?: string | null;
  /** The log of requests that left for a model; the Sources screen summarises it. Default `data/desk/egress.jsonl`. */
  egressLogPath?: string | null;
  /** The owner's time zone: "yesterday" is the calendar day that just ended there. Default UTC. */
  timeZone?: string;
  /** The gate's database, read for what it paused or denied; null when the gate is not running here. */
  gateDbPath?: string | null;
  /** Where the canary's stored runs are; default the Desk's own. */
  canaryRunsPath?: string;
  /** Asked once for each load of the shell: is the hook installed, and is the gate answering? Unset, nothing is probed and nothing is said. */
  gateHealth?: () => Promise<GateHealth>;
  /** A second source of list prices to check ours against, when one is on disk. */
  otherPrices?: { label: string; fetchedAt: string; models: Readonly<Record<string, ForeignRow>> } | null;
}

export class BadParam extends Error {}

const DAY = 86_400_000;

type Row = Record<string, string | number | null>;
function all<T = Row>(db: Ledger, sql: string, ...params: (string | number)[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}
function one<T = Row>(db: Ledger, sql: string, ...params: (string | number)[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

/** A folder name for display: the last segment, redacted, control characters removed, length capped. */
export function projectName(path: string | null | undefined): string {
  if (!path) return "unknown";
  const last = path.split(/[\\/]/).filter(Boolean).at(-1) ?? "unknown";
  // eslint-disable-next-line no-control-regex
  const clean = createRedactor().clean(last).replace(/[\u0000-\u001f\u007f]/g, "");
  return clean.length > 60 ? clean.slice(0, 57) + "..." : clean;
}

export interface Span {
  sinceIso: string;
  untilIso: string;
  days: number | "all";
  lastIso: string | null;
}

/** `range` is a number of days up to the last call in the ledger, or "all". Anything else is refused. */
export function parseRange(raw: string | null | undefined, db: Ledger): Span {
  const bounds = one<{ a: string | null; b: string | null }>(db, "SELECT MIN(ts) a, MAX(ts) b FROM model_call");
  const last = bounds?.b ?? null;
  const value = raw ?? "30";
  if (value === "all") return { sinceIso: bounds?.a ?? "0000", untilIso: last ?? "9999", days: "all", lastIso: last };
  if (!/^\d{1,4}$/.test(value)) throw new BadParam("range must be a number of days (1 to 3650) or all");
  const n = Number(value);
  if (n < 1 || n > 3650) throw new BadParam("range must be a number of days (1 to 3650) or all");
  if (!last) return { sinceIso: "0000", untilIso: "9999", days: n, lastIso: null };
  return { sinceIso: new Date(Date.parse(last) - n * DAY).toISOString(), untilIso: last, days: n, lastIso: last };
}

export function parseInt0(raw: string | null | undefined, name: string, def: number, min: number, max: number): number {
  if (raw === null || raw === undefined) return def;
  if (!/^\d{1,9}$/.test(raw)) throw new BadParam(`${name} must be a whole number`);
  const n = Number(raw);
  if (n < min || n > max) throw new BadParam(`${name} must be between ${min} and ${max}`);
  return n;
}

// ---------------------------------------------------------------------------------------------- shared pieces

export interface CauseRow {
  cause: Cause;
  micros: number;
  share: number;
  calls: number;
}

function causeRows(a: Autopsy): CauseRow[] {
  const total = Math.max(1, a.totalMicros);
  return CAUSES.map((cause) => ({ cause, micros: a.causes[cause].micros, share: a.causes[cause].micros / total, calls: a.causes[cause].calls })).sort((x, y) => y.micros - x.micros);
}

function emptyState(ctx: UiContext): { state: "empty"; reason: string; hint: string } | null {
  const n = one<{ c: number }>(ctx.db, "SELECT COUNT(*) c FROM model_call")?.c ?? 0;
  if (n > 0) return null;
  return { state: "empty", reason: "The ledger has no model calls yet.", hint: "Run `desk ingest` to read your agent logs, or start with SAMPLE_MODE=true to open the constructed sample." };
}

interface Tally {
  estimatedMicros: number;
  pricedCalls: number;
  unpricedCalls: number;
}

function tally(db: Ledger, sinceIso: string, untilIso: string): Tally {
  const r = one<{ micros: number | null; priced: number | null; unpriced: number | null }>(
    db,
    `SELECT SUM(c.total_micros) micros, SUM(CASE WHEN c.class = 'estimated' THEN 1 ELSE 0 END) priced, SUM(CASE WHEN c.class = 'unpriced' THEN 1 ELSE 0 END) unpriced
     FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE m.ts >= ? AND m.ts <= ?`,
    sinceIso,
    untilIso,
  );
  return { estimatedMicros: r?.micros ?? 0, pricedCalls: r?.priced ?? 0, unpricedCalls: r?.unpriced ?? 0 };
}

function autopsyFor(ctx: UiContext, sinceIso: string, untilIso: string): { autopsy: Autopsy; calls: AutopsyCall[] } {
  const calls = loadAutopsyCalls(ctx.db, ctx.snapshot, sinceIso, untilIso);
  return { autopsy: buildAutopsy(calls, Date.parse(sinceIso), Date.parse(untilIso)), calls };
}

function landingRows(b: ReturnType<typeof landingBreakdown>): { state: string; sessions: number; micros: number; share: number }[] {
  const total = Math.max(1, b.totalMicros);
  return (["kept", "merged", "committed", "reverted", "unlinked"] as const).map((state) => ({ state, sessions: b.byState[state].sessions, micros: b.byState[state].micros, share: b.byState[state].micros / total }));
}

function hasLinks(db: Ledger): boolean {
  return (one<{ c: number }>(db, "SELECT COUNT(*) c FROM session_commit")?.c ?? 0) > 0;
}

// ---------------------------------------------------------------------------------------------- meta

/** How old the price list is. Past 60 days every estimate rests on prices that may have changed, and the shell says so on every screen. */
export const STALE_PRICE_DAYS = 60;
function priceFreshness(ctx: UiContext): { snapshotId: string; fetchedAt: string; ageDays: number | null; stale: boolean } {
  const fetched = Date.parse(ctx.snapshot.fetchedAt);
  const ageDays = Number.isNaN(fetched) ? null : Math.max(0, Math.floor((ctx.nowMs() - fetched) / DAY));
  return { snapshotId: ctx.snapshot.snapshotId, fetchedAt: ctx.snapshot.fetchedAt, ageDays, stale: ageDays !== null && ageDays > STALE_PRICE_DAYS };
}

export function meta(ctx: UiContext): object {
  const b = one<{ a: string | null; b: string | null; n: number }>(ctx.db, "SELECT MIN(ts) a, MAX(ts) b, COUNT(*) n FROM model_call");
  const sessions = one<{ n: number }>(ctx.db, "SELECT COUNT(*) n FROM session")?.n ?? 0;
  return {
    state: "ok",
    mode: ctx.mode,
    ledger: ctx.ledgerName,
    calls: b?.n ?? 0,
    sessions,
    firstIso: b?.a ?? null,
    lastIso: b?.b ?? null,
    price: priceFreshness(ctx),
    screens: SCREENS,
  };
}

/** The screen registry. A screen is listed only when the module behind it exists and has data to show. */
export const SCREENS = [
  { id: "brief", title: "Brief", number: "01" },
  { id: "week", title: "Week", number: "02" },
  { id: "bill", title: "Bill", number: "03" },
  { id: "autopsy", title: "Autopsy", number: "04" },
  { id: "sessions", title: "Sessions", number: "05" },
  { id: "outcomes", title: "Outcomes", number: "06" },
  { id: "policy", title: "Policy", number: "07" },
  { id: "canary", title: "Canary", number: "08" },
  { id: "ask", title: "Ask", number: "09" },
  { id: "organisation", title: "Org data", number: "10" },
  { id: "dossiers", title: "Dossiers", number: "11" },
  { id: "evidence", title: "Evidence", number: "12" },
  { id: "sources", title: "Doctor", number: "13" },
] as const;

// ---------------------------------------------------------------------------------------------- bill

/** What the tool recorded for its own cost in a period, from the processes whose last record falls in it; null when this ledger predates the table. */
function reportedInSpan(ctx: UiContext, span: Span): { rows: ReconcileRow[]; summary: ReturnType<typeof summariseReconciliation> } | null {
  const has = one<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'reported_cost'");
  if (!has || has.n === 0) return null;
  const rows = reconcile(ctx.db).filter((r) => r.observedAt !== null && r.observedAt >= span.sinceIso && r.observedAt <= span.untilIso);
  return { rows, summary: summariseReconciliation(rows) };
}

/** The overhead of the period and who shares it, for the Bill screen. */
export function overhead(ctx: UiContext, span: Span, bar: "committed" | "merged" | "kept"): object {
  const empty = emptyState(ctx);
  if (empty) return empty;
  const v = overheadView(ctx.db, ctx.snapshot, span.sinceIso, span.untilIso, bar);
  return {
    state: "ok",
    bar: v.bar,
    window: { from: v.sinceIso, to: v.untilIso },
    idleMicros: v.idleMicros,
    sharedMicros: v.sharedMicros,
    overheadMicros: v.overheadMicros,
    unallocatedMicros: v.allocation.unallocatedMicros,
    residualMicros: v.allocation.residualMicros,
    residualTo: v.allocation.residualTo === null ? null : projectName(v.allocation.residualTo),
    landedSessions: v.landedSessions,
    sessions: v.sessions,
    rows: v.allocation.rows.slice(0, 12).map((r) => ({ project: projectName(r.project), directMicros: r.directMicros, weight: r.weight, allocatedMicros: r.allocatedMicros })),
    moreRows: Math.max(0, v.allocation.rows.length - 12),
    alternatives: v.alternatives,
    snapshotId: ctx.snapshot.snapshotId,
  };
}

/**
 * The Desk's own model calls in the period (DF-077): what the tool that watches spend spent itself. Not part of the agents' figures above. A call on a model with no
 * price is counted and its tokens kept, with no dollars invented; a failed call is counted, and whether it was billed is unknown.
 */
function deskOwnBlock(ctx: UiContext, span: Span): object | null {
  const rows = all<{ role: string; calls: number; priced: number; unpriced: number; failed: number; micros: number; tin: number; tout: number }>(
    ctx.db,
    `SELECT role, COUNT(*) calls, SUM(class = 'estimated') priced, SUM(class != 'estimated' AND ok = 1) unpriced, SUM(ok = 0) failed,
            COALESCE(SUM(CASE WHEN class = 'estimated' THEN total_micros END), 0) micros, COALESCE(SUM(input_tokens), 0) tin, COALESCE(SUM(output_tokens), 0) tout
     FROM desk_call WHERE ts >= ? AND ts <= ? GROUP BY role ORDER BY micros DESC, calls DESC, role`,
    span.sinceIso,
    // The bill's header names whole days, and a period that ends at the last agent call ends that day: the Desk's own calls on the day count.
    `${span.untilIso.slice(0, 10)}T23:59:59.999Z`,
  );
  if (rows.length === 0) return null;
  const cap = Number(ctx.env["DESK_OWN_DAILY_CAP_USD"]);
  const today = new Date(ctx.nowMs()).toISOString().slice(0, 10);
  const spentToday = one<{ m: number }>(ctx.db, "SELECT COALESCE(SUM(total_micros), 0) m FROM desk_call WHERE class = 'estimated' AND ts >= ?", `${today}T00:00:00.000Z`)?.m ?? 0;
  const sum = (k: "calls" | "priced" | "unpriced" | "failed" | "micros" | "tin" | "tout"): number => rows.reduce((s, r) => s + Number(r[k]), 0);
  return {
    calls: sum("calls"), priced: sum("priced"), unpriced: sum("unpriced"), failed: sum("failed"), micros: sum("micros"), tokensIn: sum("tin"), tokensOut: sum("tout"),
    byRole: rows.map((r) => ({ role: r.role, calls: Number(r.calls), priced: Number(r.priced), unpriced: Number(r.unpriced), failed: Number(r.failed), micros: Number(r.micros) })),
    dailyCapMicros: Number.isFinite(cap) && cap > 0 ? Math.round(cap * 1_000_000) : null,
    spentTodayMicros: Number(spentToday),
  };
}

export function bill(ctx: UiContext, span: Span): object {
  const empty = emptyState(ctx);
  if (empty) return empty;
  const t = tally(ctx.db, span.sinceIso, span.untilIso);
  // Comparing the tool's own figure with the estimate reads every process once: do it once for the screen.
  const reported = reportedInSpan(ctx, span);
  const { autopsy } = autopsyFor(ctx, span.sinceIso, span.untilIso);
  const landing = landingBreakdown(ctx.db, span.sinceIso, span.untilIso);
  const landed = landing.byState.kept.sessions + landing.byState.merged.sessions;
  const landedMicros = landing.byState.kept.micros + landing.byState.merged.micros;
  const coverage = classCoverage(ctx.db, span.sinceIso, span.untilIso);
  const daily = all<{ day: string; micros: number; calls: number }>(ctx.db, "SELECT day, SUM(estimated_micros) micros, SUM(calls) calls FROM v_cost_by_day_model WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day", span.sinceIso.slice(0, 10), span.untilIso.slice(0, 10));
  const byModel = all<{ model: string; calls: number; micros: number | null; unpriced: number }>(
    ctx.db,
    "SELECT model, SUM(calls) calls, SUM(estimated_micros) micros, SUM(unpriced_calls) unpriced FROM v_cost_by_day_model WHERE day >= ? AND day <= ? GROUP BY model ORDER BY micros DESC",
    span.sinceIso.slice(0, 10),
    span.untilIso.slice(0, 10),
  );
  const byProject = all<{ project_path: string | null; micros: number; sessions: number }>(
    ctx.db,
    `SELECT s.project_path, SUM(c.total_micros) micros, COUNT(DISTINCT m.session_id) sessions
     FROM model_call m JOIN session s ON s.session_id = m.session_id JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated'
     WHERE m.ts >= ? AND m.ts <= ? GROUP BY s.project_path ORDER BY micros DESC LIMIT 500`,
    span.sinceIso,
    span.untilIso,
  );
  const merged = new Map<string, { project: string; micros: number; sessions: number }>();
  for (const p of byProject) {
    const name = projectName(p.project_path);
    const e = merged.get(name) ?? { project: name, micros: 0, sessions: 0 };
    e.micros += p.micros;
    e.sessions += p.sessions;
    merged.set(name, e);
  }
  return {
    state: "ok",
    span: { since: span.sinceIso, until: span.untilIso, days: span.days },
    window: { from: span.sinceIso, to: span.untilIso },
    coverage,
    coverageLine: coverageLine(coverage, formatUsd),
    totals: { ...t, pricedShare: t.pricedCalls + t.unpricedCalls === 0 ? 0 : t.pricedCalls / (t.pricedCalls + t.unpricedCalls) },
    classes: [
      billedClass(ctx, span),
      reportedClass(reported),
      { cls: "estimated", calls: t.pricedCalls, micros: t.estimatedMicros, note: "List price times logged tokens." },
      { cls: "unpriced", calls: t.unpricedCalls, note: "Models with no price row: tokens counted, no dollars invented. To say what a token of one is worth to you, run `desk prices add MODEL=IN,OUT` (dollars per million tokens), then `desk prices reprice`." },
    ],
    reconciliation: reconciliationSummary(reported),
    deskOwn: deskOwnBlock(ctx, span),
    priceBand: priceBand(ctx, span, t.estimatedMicros),
    pricing: pricingNotes(ctx, span),
    reconciliations: reconciliationRows(ctx, span),
    landing: { rows: landingRows(landing), totalMicros: landing.totalMicros, lowConfidenceMicros: landing.lowConfidenceMicros, linked: hasLinks(ctx.db) },
    costPerLandedSession: landed === 0 ? null : Math.round(landedMicros / landed),
    landedSessions: landed,
    causes: causeRows(autopsy),
    missSavingMicros: autopsy.missEvents.reduce((s, e) => s + e.savingMicros, 0),
    daily,
    byModel,
    byProject: [...merged.values()].sort((a, b) => b.micros - a.micros).slice(0, 12),
    snapshotId: ctx.snapshot.snapshotId,
  };
}

const PRICE_LABEL: Record<string, string> = { inputPerMTokMicros: "input", outputPerMTokMicros: "output", cacheReadPerMTokMicros: "cache read", cacheWrite5mPerMTokMicros: "cache write (5 minutes)", cacheWrite1hPerMTokMicros: "cache write (1 hour)" };

/** The estimate as a range when a second price source disagrees with ours on a price that applies to tokens in this period; null when there is no second source or no disagreement that matters. */
function priceBand(ctx: UiContext, span: Span, estimatedMicros: number): object | null {
  if (!ctx.otherPrices) return null;
  const items = priceSensitivity(ctx.db, comparePrices(ctx.snapshot, ctx.otherPrices.models), { since: span.sinceIso, until: span.untilIso });
  if (items.length === 0) return null;
  const band = costBand(estimatedMicros, items);
  return {
    source: ctx.otherPrices.label,
    fetchedAt: ctx.otherPrices.fetchedAt,
    estimateMicros: band.estimateMicros,
    lowMicros: band.lowMicros,
    highMicros: band.highMicros,
    items: items.map((i) => ({ model: i.model, price: PRICE_LABEL[i.field] ?? i.field, longPrompts: i.tier === "long", tokens: i.tokens, deltaMicros: i.deltaMicros })),
    note: "Two sources of list prices disagree on the prices above. Which one is in force is not verified here; an invoice or a usage export for these tokens settles it.",
  };
}

/** The billed class: what imported invoices say for this period. Without one, the note says what importing would change. */
function billedClass(ctx: UiContext, span: Span): object {
  const none = { cls: "billed", calls: 0, invoices: 0, note: "No invoice is imported, so nothing here is billed. Import one (`desk invoices import <file>`) and this class shows what you were charged; the estimate then becomes a check on it. With Zetaris connected, its invoice figures are on Org data." };
  const has = one<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'invoice'");
  if (!has || has.n === 0) return none;
  const r = one<{ micros: number | null; invoices: number; lines: number }>(
    ctx.db,
    `SELECT SUM(b.amount_micros) micros, COUNT(DISTINCT i.invoice_id) invoices, COUNT(*) lines FROM billed_line b JOIN invoice i ON i.invoice_id = b.invoice_id
     WHERE i.status = 'imported' AND i.currency = 'USD' AND COALESCE(b.day, i.period_start) >= ? AND COALESCE(b.day, i.period_start) <= ?`,
    span.sinceIso.slice(0, 10),
    span.untilIso.slice(0, 10),
  );
  if (!r || r.micros === null) return none;
  return { cls: "billed", calls: r.lines, invoices: r.invoices, micros: r.micros, note: `What ${r.invoices} imported invoice${r.invoices === 1 ? "" : "s"} charged for this period (USD, lines dated inside it). The invoice is the authority; the estimate below is a check on it.` };
}

/** Billed against estimated against reported, per vendor and month, for the months this period touches. */
function reconciliationRows(ctx: UiContext, span: Span): object[] {
  const has = one<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'invoice'");
  if (!has || has.n === 0 || (one<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM invoice")?.n ?? 0) === 0) return [];
  const from = span.sinceIso.slice(0, 7);
  const to = span.untilIso.slice(0, 7);
  return computeReconciliations(ctx.db)
    .filter((r) => r.period >= from && r.period <= to)
    .slice(-6)
    .map((r) => ({ vendor: r.vendor, period: r.period, currency: r.currency, billedMicros: r.billedMicros, estimatedMicros: r.estimatedMicros, reportedMicros: r.reportedMicros, gapMicros: r.gapMicros, status: r.status, reason: r.reason }));
}

const RULE_LABEL: Record<string, string> = {
  long_prompt: "priced at the long-prompt rates",
  fast_mode: "priced at fast-mode rates",
  us_only: "priced with the 1.1x US-only multiplier",
  "note:fast_mode_unpriced": "said fast on a model with no fast price (priced standard)",
  "note:speed_unrecorded": "on a model with a fast mode but no speed in the log (priced standard)",
  "note:us_only_unpriced": "said US-only on a model with no multiplier in the price book (priced standard)",
  "note:geo_unrecorded": "on a model with a US-only option but no geography in the log (priced standard)",
};

/** Which pricing rules applied to the calls in this period, and any repricing that changed what the ledger says. Null on a ledger too old to carry them. */
function pricingNotes(ctx: UiContext, span: Span): object | null {
  const has = (name: string): boolean => (one<{ n: number }>(ctx.db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '${name}'`)?.n ?? 0) > 0;
  if (!has("repricing")) return null;
  const rules = all<{ id: string; n: number }>(
    ctx.db,
    `SELECT j.value AS id, COUNT(*) AS n FROM model_call m JOIN cost_event c ON c.call_id = m.call_id, json_each(c.rule_ids) j
     WHERE m.ts >= ? AND m.ts <= ? GROUP BY j.value ORDER BY n DESC`,
    span.sinceIso,
    span.untilIso,
  );
  const repricings = all<{ id: number; at: string; to_snapshot: string; calls: number; delta: number; reason: string }>(
    ctx.db,
    "SELECT repricing_id id, at, to_snapshot, calls_changed calls, delta_micros delta, reason FROM repricing ORDER BY repricing_id DESC LIMIT 3",
  );
  return {
    rules: rules.map((r) => ({ id: r.id, calls: r.n, label: RULE_LABEL[r.id] ?? r.id, note: r.id.startsWith("note:") })),
    repricings: repricings.map((r) => ({ id: r.id, at: r.at, snapshot: r.to_snapshot, calls: r.calls, deltaMicros: r.delta, reason: r.reason })),
  };
}

function reportedClass(r: ReturnType<typeof reportedInSpan>): object {
  if (r === null) return { cls: "reported", calls: 0, processes: 0, note: "This ledger was written before the tool's own cost was read. Run `desk ingest` once to read it." };
  if (r.rows.length === 0) return { cls: "reported", calls: 0, processes: 0, note: "The tool recorded no cost of its own in this period (older Claude Code versions do not write one)." };
  return {
    cls: "reported",
    calls: r.rows.reduce((s, x) => s + x.calls, 0),
    processes: r.rows.length,
    micros: r.summary.reportedMicros,
    note: "The tool's own running total for those processes, cumulative from each process's start. It lags and undercounts when sub-agents run, and for Sonnet 5.5 it uses a cache-read price of $0.20 per million tokens where Anthropic's pricing page says $0.10 (see the price check under the headline). It is not an invoice.",
  };
}

function reconciliationSummary(r: ReturnType<typeof reportedInSpan>): object | null {
  if (r === null || r.rows.length === 0) return null;
  const s = r.summary;
  return {
    processes: s.processes,
    match: s.match,
    estimateLow: s.estimateLow,
    estimateHigh: s.estimateHigh,
    reportedMicros: s.reportedMicros,
    estimatedMicros: s.estimatedMicros,
    medianAbsPctError: s.medianAbsPctError,
    withoutSubAgents: s.withoutSubAgents,
    withSubAgents: s.withSubAgents,
    toleranceNote: "Agree means within 2% of the tool's own figure. Neither figure is an invoice.",
  };
}

// ---------------------------------------------------------------------------------------------- autopsy

export function autopsy(ctx: UiContext, hours: number, days: number): object {
  const empty = emptyState(ctx);
  if (empty) return empty;
  const calls = loadAutopsyCalls(ctx.db, ctx.snapshot, "0000", "9999");
  const runs = one<{ m: number; t: number; u: number; f: number }>(ctx.db, "SELECT COALESCE(SUM(malformed_lines),0) m, COALESCE(SUM(truncated_tails),0) t, COALESCE(SUM(usage_conflicts),0) u, COALESCE(SUM(files),0) f FROM ingest_run");
  const built = buildCard({
    calls,
    mode: ctx.mode,
    hours,
    days,
    ingest: { malformedLines: runs?.m ?? 0, truncatedTails: runs?.t ?? 0, usageConflicts: runs?.u ?? 0, logFilesFound: runs?.f ?? 0, searchedPaths: [] },
    landingKnown: hasLinks(ctx.db),
  });
  if ("empty" in built) return { state: "empty", reason: built.couldNotKnow[0] ?? "Nothing priced yet.", hint: "Run `desk ingest`, or open the constructed sample." };
  return { state: "ok", card: built };
}

// ---------------------------------------------------------------------------------------------- brief

/** A source whose last successful read is older than this is shown as stale on the brief. */
const STALE_SOURCE_HOURS = 36;
const SOURCE_LABEL: Record<string, string> = { claude_code: "Claude Code logs", codex: "Codex logs", opencode: "OpenCode logs", statusline: "Claude Code status line" };

/** The calendar day the brief is about, in the owner's zone: yesterday, or the last day with calls when yesterday has none. */
function briefDay(ctx: UiContext, tz: string, lastIso: string, forDay: string | null): { day: string; requested: string | null; today: boolean } {
  const lastLocal = localDate(Date.parse(lastIso), tz);
  if (forDay !== null) {
    // A day the owner asked for is shown as asked, with or without calls.
    const r = localDayRange(forDay, tz);
    const n = one<{ n: number }>(ctx.db, "SELECT COUNT(*) n FROM model_call WHERE ts >= ? AND ts < ?", new Date(r.startMs).toISOString(), new Date(r.endMs).toISOString())?.n ?? 0;
    return { day: forDay, requested: n === 0 ? forDay : null, today: forDay >= localDate(ctx.nowMs(), tz) && ctx.mode !== "sample" };
  }
  if (ctx.mode === "sample") {
    // A sample is dated in the future of any real clock, so it is briefed on its own last full day.
    const recent = all<{ day: string; n: number }>(ctx.db, "SELECT substr(ts, 1, 10) day, COUNT(*) n FROM model_call GROUP BY day ORDER BY day DESC LIMIT 15");
    const earlier = recent.slice(1).map((r) => r.n).sort((a, b) => a - b);
    const typical = earlier.length === 0 ? 0 : earlier[Math.floor(earlier.length / 2)]!;
    return { day: recent.length > 1 && recent[0]!.n < 0.3 * typical ? recent[1]!.day : recent[0]!.day, requested: null, today: false };
  }
  const todayLocal = localDate(ctx.nowMs(), tz);
  const wanted = addDays(todayLocal, -1);
  const r = localDayRange(wanted, tz);
  const n = one<{ n: number }>(ctx.db, "SELECT COUNT(*) n FROM model_call WHERE ts >= ? AND ts < ?", new Date(r.startMs).toISOString(), new Date(r.endMs).toISOString())?.n ?? 0;
  if (n > 0) return { day: wanted, requested: null, today: false };
  return { day: lastLocal, requested: wanted, today: lastLocal >= todayLocal };
}

/** Each source the ledger has read, when it was last read successfully, and whether that is too long ago to trust the brief for it. */
function sourceFreshness(ctx: UiContext): { id: string; label: string; lastReadAt: string; ageHours: number; stale: boolean }[] {
  // The last run of each reader, whether or not it found anything new: a source that did not change is not a source that was not read.
  return all<{ kind: string; last: string | null }>(ctx.db, "SELECT kind, MAX(finished_at) last FROM ingest_run GROUP BY kind ORDER BY kind")
    .filter((r) => r.last !== null)
    .map((r) => {
      const ageHours = Math.max(0, (ctx.nowMs() - Date.parse(r.last as string)) / 3_600_000);
      return { id: r.kind, label: SOURCE_LABEL[r.kind] ?? r.kind, lastReadAt: r.last as string, ageHours: Math.round(ageHours * 10) / 10, stale: ctx.mode !== "sample" && ageHours > STALE_SOURCE_HOURS };
    });
}

/**
 * The one thing worth doing, by rule. A canary that regressed (or whose platform moved) since the run before comes first, because
 * it touches every task. Otherwise the cause with the most dollars a change could recover, but only when it is measured on the
 * owner's own windows; an upper bound with no history behind it is not a recommendation. With neither, nothing is recommended
 * and the reason is said.
 */
export function chooseAction(canary: CanaryCard, fix: { cause: string; fix: string; basis: string; addressableMicros: number; interval: { lowMicros: number; highMicros: number } | null; windowsUsed: number; note: string } | null): { action: object | null; why: string } {
  if (canary.state === "ok" && canary.changed && (canary.verdict === "regressed" || canary.verdict === "harness_or_platform")) {
    return {
      action: {
        kind: "canary",
        title: canary.verdict === "regressed" ? "The canary says the model regressed" : "The platform or the harness moved: the canary cannot tell the model from it",
        detail: `${canary.words}, since ${canary.previous?.words.toLowerCase()} the run before: ${canary.because}.`,
        screen: "canary",
      },
      why: "",
    };
  }
  if (fix === null) return { action: null, why: "No cause is large enough to call out a fix." };
  if (fix.basis !== "own_history" || fix.interval === null) {
    return { action: null, why: `The largest candidate (${fix.cause.replaceAll("_", " ")}, at most $${(fix.addressableMicros / 1e6).toFixed(2)}) is an upper bound with too little of your own history behind it, so it is not recommended yet.` };
  }
  if (fix.addressableMicros < 1_000_000) return { action: null, why: "The largest measured candidate is under $1.00 a window: not worth a change." };
  return { action: { kind: "fix", cause: fix.cause, fix: fix.fix, basis: fix.basis, addressableMicros: fix.addressableMicros, interval: fix.interval, windowsUsed: fix.windowsUsed, note: fix.note, screen: "autopsy" }, why: "" };
}

export function brief(ctx: UiContext, forDay: string | null = null): object {
  const empty = emptyState(ctx);
  if (empty) return empty;
  if (forDay !== null && !isDate(forDay)) throw new BadParam("day must be a date such as 2026-10-24");
  const tz = ctx.timeZone ?? "UTC";
  const lastIso = one<{ b: string }>(ctx.db, "SELECT MAX(ts) b FROM model_call")!.b;
  const picked = briefDay(ctx, tz, lastIso, forDay);
  const day = picked.day;
  const range = localDayRange(day, tz);
  const prevDay = addDays(day, -1);
  const prevRange = localDayRange(prevDay, tz);
  // A window is half open, [start, end); the queries below take an inclusive end, so end is one millisecond earlier.
  const dayStart = new Date(range.startMs).toISOString();
  const dayEnd = new Date(range.endMs - 1).toISOString();
  const t = tally(ctx.db, dayStart, dayEnd);
  const prev = tally(ctx.db, new Date(prevRange.startMs).toISOString(), new Date(prevRange.endMs - 1).toISOString());
  const landing = landingBreakdown(ctx.db, dayStart, dayEnd);
  const { autopsy: a } = autopsyFor(ctx, dayStart, dayEnd);
  const byProject = all<{ project_path: string | null; micros: number }>(
    ctx.db,
    `SELECT s.project_path, SUM(c.total_micros) micros FROM model_call m JOIN session s ON s.session_id = m.session_id
     JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated' WHERE m.ts >= ? AND m.ts <= ? GROUP BY s.project_path ORDER BY micros DESC LIMIT 500`,
    dayStart,
    dayEnd,
  );
  const projects = new Map<string, number>();
  for (const p of byProject) projects.set(projectName(p.project_path), (projects.get(projectName(p.project_path)) ?? 0) + p.micros);
  const byModel = all<{ model: string; micros: number | null; calls: number }>(
    ctx.db,
    "SELECT m.model model, SUM(c.total_micros) micros, COUNT(*) calls FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE m.ts >= ? AND m.ts <= ? GROUP BY m.model ORDER BY micros DESC LIMIT 12",
    dayStart,
    dayEnd,
  );
  // The recommended action, by rule: see chooseAction.
  const calls = loadAutopsyCalls(ctx.db, ctx.snapshot, new Date(Date.parse(lastIso) - 14 * DAY).toISOString(), lastIso);
  const card = buildCard({ calls, mode: ctx.mode, hours: 5, days: 14, ingest: { malformedLines: 0, truncatedTails: 0, usageConflicts: 0, logFilesFound: 1, searchedPaths: [] }, landingKnown: hasLinks(ctx.db) });
  const fix = "empty" in card ? null : (card.fixes[0] ?? null);
  const canary = canaryCard(ctx.mode === "sample" ? SAMPLE_RUNS : (ctx.canaryRunsPath ?? OWN_RUNS), Math.min(ctx.nowMs(), range.endMs), ctx.mode === "sample", day);
  const chosen = chooseAction(canary, fix);
  // The gate's night is the briefed day up to now, or to the end of that day when it is a day in the past.
  const night = readGateNight(ctx.gateDbPath ?? null, dayStart, new Date(Math.min(ctx.nowMs() + 1000, range.endMs)).toISOString());
  const before = one<{ t: string | null }>(ctx.db, "SELECT MAX(ts) t FROM model_call WHERE ts < ?", dayStart)?.t ?? null;
  const after = one<{ t: string | null }>(ctx.db, "SELECT MIN(ts) t FROM model_call WHERE ts >= ?", new Date(range.endMs).toISOString())?.t ?? null;
  return {
    state: "ok",
    snapshotId: ctx.snapshot.snapshotId,
    day,
    timeZone: tz,
    window: { from: dayStart, to: dayEnd },
    previousDay: prevDay,
    /** The nearest days with calls on either side of this one, for stepping through; null at the ends of the ledger. */
    earlierDay: before === null ? null : localDate(Date.parse(before), tz),
    laterDay: after === null ? null : localDate(Date.parse(after), tz),
    /** Set when yesterday had no call: the brief shows the last day that did, and says so. */
    noCallOn: picked.requested,
    dayIsToday: picked.today,
    spend: t,
    previousSpend: prev,
    projects: [...projects].map(([project, micros]) => ({ project, micros })).sort((x, y) => y.micros - x.micros),
    models: byModel,
    landing: { rows: landingRows(landing), totalMicros: landing.totalMicros, linked: hasLinks(ctx.db) },
    causes: causeRows(a).slice(0, 5),
    runway: runwayRows(ctx),
    gate: night === null ? { state: "not_read", note: "The gate is not running here, so there is nothing to say about pauses or denials. `desk gate serve` starts it." } : { state: "ok", line: nightLine(night), ...night },
    canary,
    sources: sourceFreshness(ctx),
    lastCallAt: lastIso,
    action: chosen.action,
    noActionBecause: chosen.action === null ? chosen.why : null,
  };
}

/** Plan windows that were read within this long are shown on the brief; a tool not used for longer than this is left out of it. */
const RUNWAY_RECENT_DAYS = 7;
const RUNWAY_TOOLS = [["claude_code", "Claude Code"], ["codex", "Codex"]] as const;

/** For each tool with plan-limit readings, the windows of the plan in use: where each stands, and whether it will last until its reset. */
function runwayRows(ctx: UiContext): object[] {
  const has = one<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'limit_sample'");
  if (!has || has.n === 0) return [];
  const now = new Date(ctx.nowMs());
  const out: object[] = [];
  const view = plansView(ctx.db, now);
  for (const [tool, name] of RUNWAY_TOOLS) {
    const groups = limitGroups(ctx.db, tool, now);
    const current = groups[0];
    if (!current || now.getTime() - Date.parse(current.lastTs) > RUNWAY_RECENT_DAYS * DAY) continue;
    for (const g of groups.filter((x) => x.planType === current.planType).sort((a, b) => a.windowMinutes - b.windowMinutes)) {
      const label = `${name}, ${groupLabel(g)}`;
      const r = runwayFromLedger(ctx.db, { tool, windowMinutes: g.windowMinutes, planType: g.planType, now });
      const w = view.windows.find((x) => x.tool === tool && x.windowMinutes === g.windowMinutes && x.planType === g.planType);
      out.push({ label, ...r, resetsAt: r.resetsAt === null ? null : r.resetsAt.toISOString(), head: runwayHead(r), detail: runwayDetail(r), text: renderRunway(r, label), source: w?.source ?? "official", local: w?.local ?? null, linear: w?.linear ?? null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- sessions

const SORTS: Record<string, string> = { cost: "micros DESC", recent: "start DESC", calls: "calls DESC" };

/** What a link from another screen narrows the session list to: a window of its own, one project, one model, one landing state. */
export interface SessionFilter {
  from?: string;
  to?: string;
  project?: string;
  model?: string;
  /** A landing state, or `landed` for merged and kept together. */
  state?: string;
}

const LANDING_STATES = ["unlinked", "committed", "merged", "kept", "reverted"];

export function parseSessionFilter(p: URLSearchParams): SessionFilter {
  const f: SessionFilter = {};
  const iso = (name: "from" | "to"): void => {
    const v = p.get(name);
    if (v === null || v === "") return;
    if (v.length > 40 || Number.isNaN(Date.parse(v))) throw new BadParam(`${name} must be a date and time such as 2026-10-24T00:00:00.000Z`);
    f[name] = new Date(Date.parse(v)).toISOString();
  };
  iso("from");
  iso("to");
  if ((f.from === undefined) !== (f.to === undefined)) throw new BadParam("give both from and to, or neither");
  for (const name of ["project", "model"] as const) {
    const v = p.get(name);
    if (v === null || v === "") continue;
    if (v.length > 200) throw new BadParam(`${name} is too long`);
    f[name] = v;
  }
  const state = p.get("state");
  if (state !== null && state !== "") {
    if (state !== "landed" && !LANDING_STATES.includes(state)) throw new BadParam(`state must be landed or one of ${LANDING_STATES.join(", ")}`);
    f.state = state;
  }
  return f;
}

export function sessions(ctx: UiContext, span: Span, sort: string, limit: number, offset: number, filter: SessionFilter = {}): object {
  const empty = emptyState(ctx);
  if (empty) return empty;
  const order = SORTS[sort];
  if (!order) throw new BadParam("sort must be cost, recent or calls");
  const since = filter.from ?? span.sinceIso;
  const until = filter.to ?? span.untilIso;
  const where = ["m.ts >= ?", "m.ts <= ?"];
  const args: (string | number)[] = [since, until];
  if (filter.model !== undefined) {
    where.push("m.model = ?");
    args.push(filter.model);
  }
  if (filter.project !== undefined) {
    const paths = all<{ project_path: string | null }>(ctx.db, "SELECT DISTINCT project_path FROM session").map((r) => r.project_path).filter((pth) => projectName(pth) === filter.project);
    const named = paths.filter((x): x is string => x !== null);
    const clauses: string[] = [];
    if (named.length > 0) clauses.push(`s.project_path IN (${named.map(() => "?").join(",")})`);
    if (paths.includes(null)) clauses.push("s.project_path IS NULL");
    where.push(clauses.length === 0 ? "0" : `(${clauses.join(" OR ")})`);
    args.push(...named);
  }
  if (filter.state !== undefined) {
    if (filter.state === "landed") where.push("COALESCE(o.state, 'unlinked') IN ('kept', 'merged')");
    else {
      where.push("COALESCE(o.state, 'unlinked') = ?");
      args.push(filter.state);
    }
  }
  const from = "model_call m JOIN session s ON s.session_id = m.session_id LEFT JOIN cost_event c ON c.call_id = m.call_id LEFT JOIN session_outcome o ON o.session_id = m.session_id";
  const total = one<{ n: number }>(ctx.db, `SELECT COUNT(DISTINCT m.session_id) n FROM ${from} WHERE ${where.join(" AND ")}`, ...args)?.n ?? 0;
  const spend = one<{ micros: number | null }>(ctx.db, `SELECT SUM(c.total_micros) micros FROM ${from} WHERE ${where.join(" AND ")}`, ...args)?.micros ?? 0;
  const rows = all<{ session_id: string; project_path: string | null; start: string; end: string; calls: number; micros: number | null; unpriced: number; sub: number; state: string | null; conf: string | null; commits: number | null }>(
    ctx.db,
    `SELECT m.session_id, s.project_path, MIN(m.ts) start, MAX(m.ts) end, COUNT(*) calls, SUM(c.total_micros) micros,
            SUM(CASE WHEN c.class = 'unpriced' THEN 1 ELSE 0 END) unpriced, SUM(m.is_sidechain) sub, o.state, o.best_confidence conf, o.commits
     FROM ${from} WHERE ${where.join(" AND ")} GROUP BY m.session_id ORDER BY ${order}, m.session_id LIMIT ? OFFSET ?`,
    ...args,
    limit,
    offset,
  );
  return {
    state: "ok",
    total,
    limit,
    offset,
    sort,
    /** What the rows add up to, so a figure that linked here can be checked against them. */
    spendMicros: spend,
    filter: { ...filter, from: filter.from ?? null, to: filter.to ?? null },
    rows: rows.map((r) => ({ id: r.session_id, project: projectName(r.project_path), start: r.start, end: r.end, calls: r.calls, micros: r.micros ?? 0, unpricedCalls: r.unpriced, subagentCalls: r.sub, state: r.state ?? "unlinked", confidence: r.conf, commits: r.commits ?? 0 })),
  };
}

const KIND_TITLE: Record<BlockKind, string> = {
  loops: "A failing command repeated",
  idle: "The agent working on its own",
  subagents: "A delegated agent's run",
  cache_miss: "A context rewritten after the cache was lost",
  echo: "The same error again and again",
  truncation: "A cut-short result asked for again",
  churn: "One file edited again and again",
  reflection: "Calls with no tool and no one asking",
  orphan: "A delegated agent after its parent stopped",
};

const toolList = (raw: string): string[] => {
  try {
    const t: unknown = JSON.parse(raw);
    return Array.isArray(t) ? t.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
};

/** The tree of agents a session started, as the screen shows it: the first rows in the order a reader walks it, and what the rest add up to. */
function delegationBlock(ctx: UiContext, id: string): object | null {
  const tree = delegationTrees(ctx.db, { sessionIds: [id] })[0];
  if (!tree || tree.agents === 0) return null;
  const shown = tree.nodes.slice(0, 40);
  const rest = tree.nodes.slice(40);
  const clean = (name: string | null): string | null => (name === null ? null : createRedactor().clean(name).slice(0, 60));
  return {
    agents: tree.agents,
    maxDepth: tree.maxDepth,
    totalMicros: tree.totalMicros,
    unlinkedMicros: tree.unlinkedMicros,
    nodes: shown.map((n) => ({ key: n.key, name: clean(n.name), depth: n.depth, calls: n.calls, unpricedCalls: n.unpricedCalls, directMicros: n.directMicros, cumulativeMicros: n.cumulativeMicros, children: n.children, flags: n.flags })),
    more: rest.length === 0 ? null : { nodes: rest.length, directMicros: rest.reduce((s, n) => s + n.directMicros, 0) },
  };
}

/** One waste block of one session, explained: where the rule would have stopped it, how it matched, how the failure unfolded, the lines behind it, each call's price and what the session landed. */
export async function sessionBlock(ctx: UiContext, id: string, blockId: string): Promise<object> {
  if (id.length === 0 || id.length > 200 || blockId.length === 0 || blockId.length > 80) throw new BadParam("session id or block id is empty or too long");
  const span = one<{ a: string; b: string; n: number }>(ctx.db, "SELECT MIN(ts) a, MAX(ts) b, COUNT(*) n FROM model_call WHERE session_id = ?", id);
  if (!span || span.n === 0) return { state: "empty", reason: "No such session in this ledger.", hint: "Pick a session from the Sessions list." };
  const sessionCalls = loadAutopsyCalls(ctx.db, ctx.snapshot, span.a, span.b, { sessionId: id });
  const analysis = analyseCalls(sessionCalls);
  const autopsy = buildAutopsy(sessionCalls, Date.parse(span.a) - 1, Date.parse(span.b) + 1, analysis);
  const block = findBlocks(sessionCalls, analysis, autopsy.missEvents, wasteEventsOf(ctx.db, sessionCalls, analysis)).find((b) => b.id === blockId);
  if (!block) return { state: "empty", reason: "This session has no such waste block.", hint: "Blocks are recomputed from the calls; a ledger read again since the link was made may have changed them. Open the session and pick one." };
  const thread = sessionCalls.filter((c) => c.threadKey === block.threadKey).sort((a, b) => a.tsMs - b.tsMs || a.callId.localeCompare(b.callId));
  const factsRows = all<{ call_id: string; n: number }>(
    ctx.db,
    "SELECT t.call_id, COUNT(*) n FROM tool_call t LEFT JOIN tool_result r ON r.tool_use_id = t.tool_use_id WHERE t.session_id = ? AND r.tool_use_id IS NULL GROUP BY t.call_id",
    id,
  );
  const facts = new Map(factsRows.map((r) => [r.call_id, { withoutResult: r.n }]));
  const start = Date.parse(span.a);
  const exp = explainBlock(block, thread, new Map(autopsy.missEvents.map((m) => [m.callId, m])), facts, start);

  // The calls the explanation stands on: the chain that led in, then the block.
  const wanted = [...new Set([...exp.cascade.steps.map((s) => s.callId), ...block.calls.map((c) => c.callId)])].slice(0, 40);
  const marks = wanted.map(() => "?").join(",");
  const detail = all<{ call_id: string; ts: string; model: string; is_sidechain: number; class: string | null; snapshot_id: string | null; total_micros: number | null; unpriced_reason: string | null; tool_names: string; source_id: number | null }>(
    ctx.db,
    `SELECT m.call_id, m.ts, m.model, m.is_sidechain, c.class, c.snapshot_id, c.total_micros, c.unpriced_reason, m.tool_names, m.source_id
     FROM model_call m LEFT JOIN cost_event c ON c.call_id = m.call_id WHERE m.call_id IN (${marks}) ORDER BY m.ts, m.call_id`,
    ...wanted,
  );
  const inBlock = new Set(block.calls.map((c) => c.callId));
  const calls = detail.map((c) => ({
    id: c.call_id,
    offsetSec: Math.round((Date.parse(c.ts) - start) / 1000),
    model: c.model,
    sidechain: c.is_sidechain === 1,
    inBlock: inBlock.has(c.call_id),
    isStop: c.call_id === exp.stop.callId,
    isFirstBreak: c.call_id === exp.cascade.firstBreak?.callId,
    snapshotId: c.snapshot_id,
    micros: c.total_micros,
    unpricedReason: c.unpriced_reason,
    tools: toolList(c.tool_names),
  }));
  const sourceId = detail.find((c) => c.source_id !== null)?.source_id ?? null;
  const path = sourceId === null ? null : (one<{ path: string }>(ctx.db, "SELECT path FROM ingest_source WHERE id = ?", sourceId)?.path ?? null);
  const toolUses = new Map(all<{ tool_use_id: string; call_id: string }>(ctx.db, `SELECT tool_use_id, call_id FROM tool_call WHERE call_id IN (${marks})`, ...wanted).map((r) => [r.tool_use_id, r.call_id] as [string, string]));
  const lines = await readExcerpts(path, wanted, toolUses);

  const commits = all<{ sha: string; authored_at: string; method: string; confidence: string; merged: number; reverted: number }>(
    ctx.db,
    `SELECT g.sha, g.authored_at, sc.method, sc.confidence, g.merged, g.reverted FROM session_commit sc
     JOIN git_commit g ON g.repo_id = sc.repo_id AND g.sha = sc.sha WHERE sc.session_id = ? ORDER BY g.authored_at`,
    id,
  );
  const outcome = one<{ state: string; best_confidence: string | null }>(ctx.db, "SELECT state, best_confidence FROM session_outcome WHERE session_id = ?", id);
  const before = commits.filter((c) => Date.parse(c.authored_at) < block.startMs);
  const during = commits.filter((c) => Date.parse(c.authored_at) >= block.startMs && Date.parse(c.authored_at) <= block.endMs);
  const after = commits.filter((c) => Date.parse(c.authored_at) > block.endMs);
  const statement =
    commits.length === 0
      ? "No commit is tied to this session from the sources available, so no landing before or after this block can be shown. That is unknowable, not proof that nothing landed."
      : after.length === 0
        ? `Every commit tied to this session (${commits.length}) was made before or during this block; none was made after it, so stopping at the stop point would not have cut off a later landing that git shows.`
        : `${after.length} commit${after.length === 1 ? "" : "s"} tied to this session ${after.length === 1 ? "was" : "were"} made after this block ended: the session went on to land work, so stopping it at the stop point may have cost that.`;
  const redact = createRedactor();
  return {
    state: "ok",
    id,
    block: { id: block.id, kind: block.kind, title: KIND_TITLE[block.kind], rule: block.rule, calls: block.calls.length, micros: block.totalMicros, unpricedCalls: block.unpricedCalls, startOffsetSec: Math.round((block.startMs - start) / 1000), durationSec: Math.round((block.endMs - block.startMs) / 1000) },
    project: projectName(one<{ project_path: string | null }>(ctx.db, "SELECT project_path FROM session WHERE session_id = ?", id)?.project_path ?? null),
    stop: exp.stop,
    rule: exp.rule,
    cascade: exp.cascade,
    sentences: exp.sentences,
    calls,
    lines: { ...lines, excerpts: lines.excerpts.map((e) => ({ ...e, text: redact.clean(e.text) })) },
    landing: {
      state: outcome?.state ?? "unlinked",
      confidence: outcome?.best_confidence ?? null,
      commits: commits.length,
      before: before.length,
      during: during.length,
      after: after.map((c) => ({ sha: c.sha.slice(0, 9), authoredAt: c.authored_at, method: c.method, confidence: c.confidence, merged: c.merged === 1, reverted: c.reverted === 1 })),
      statement,
    },
    snapshotId: ctx.snapshot.snapshotId,
  };
}

const CAUSE_OF = (a: PerCall | undefined): "idle" | "loops" | "subagents" | "cache_miss" | "ordinary" => {
  if (!a) return "ordinary";
  if (a.wholeCall === "idle" || a.wholeCall === "loops" || a.wholeCall === "subagents") return a.wholeCall;
  return a.miss ? "cache_miss" : "ordinary";
};

export function session(ctx: UiContext, id: string): object {
  if (id.length === 0 || id.length > 200) throw new BadParam("session id is empty or too long");
  const head = one<{ session_id: string; project_path: string | null; tool: string; tool_version: string | null; git_branch: string | null }>(ctx.db, "SELECT session_id, project_path, tool, tool_version, git_branch FROM session WHERE session_id = ?", id);
  if (!head) return { state: "empty", reason: "No such session in this ledger.", hint: "Pick a session from the Sessions list." };
  const span = one<{ a: string; b: string; n: number }>(ctx.db, "SELECT MIN(ts) a, MAX(ts) b, COUNT(*) n FROM model_call WHERE session_id = ?", id);
  if (!span || span.n === 0) return { state: "empty", reason: "This session has no model calls.", hint: "It may have contained only prompts." };
  // A log whose clock ran backwards or forwards is shown in the order the log wrote it, and says so.
  const skew = one<{ s: number; f: number }>(ctx.db, "SELECT COALESCE(SUM(skewed_lines),0) s, COALESCE(SUM(future_lines),0) f FROM ingest_source WHERE id IN (SELECT DISTINCT source_id FROM model_call WHERE session_id = ?)", id);
  const skewed = Number(skew?.s ?? 0) > 0 || Number(skew?.f ?? 0) > 0;
  const LIMIT = 3000;
  const calls = all<{ call_id: string; ts: string; model: string; is_sidechain: number; input_tokens: number; output_tokens: number; reasoning_tokens: number; cache_read_tokens: number; cw5: number; cw1: number; stop_reason: string | null; is_api_error: number; tool_names: string; class: string | null; snapshot_id: string | null; total_micros: number | null; unpriced_reason: string | null }>(
    ctx.db,
    `SELECT m.call_id, m.ts, m.model, m.is_sidechain, m.input_tokens, m.output_tokens, m.reasoning_tokens, m.cache_read_tokens, m.cache_write_5m_tokens cw5, m.cache_write_1h_tokens cw1,
            m.stop_reason, m.is_api_error, m.tool_names, c.class, c.snapshot_id, c.total_micros, c.unpriced_reason
     FROM model_call m LEFT JOIN cost_event c ON c.call_id = m.call_id WHERE m.session_id = ? ORDER BY ${skewed ? "m.source_id, m.rowid" : "m.ts, m.call_id"} LIMIT ?`,
    id,
    LIMIT,
  );
  const sessionCalls = loadAutopsyCalls(ctx.db, ctx.snapshot, span.a, span.b, { sessionId: id });
  const analysis = analyseCalls(sessionCalls);
  const blocks = findBlocks(sessionCalls, analysis, buildAutopsy(sessionCalls, Date.parse(span.a) - 1, Date.parse(span.b) + 1, analysis).missEvents, wasteEventsOf(ctx.db, sessionCalls, analysis));
  const commits = all<{ sha: string; authored_at: string; method: string; confidence: string; merged: number; reverted: number; root: string }>(
    ctx.db,
    `SELECT g.sha, g.authored_at, sc.method, sc.confidence, g.merged, g.reverted, r.root FROM session_commit sc
     JOIN git_commit g ON g.repo_id = sc.repo_id AND g.sha = sc.sha JOIN repo r ON r.repo_id = sc.repo_id WHERE sc.session_id = ? ORDER BY g.authored_at`,
    id,
  );
  const outcome = one<{ state: string; best_confidence: string | null; commits: number }>(ctx.db, "SELECT state, best_confidence, commits FROM session_outcome WHERE session_id = ?", id);
  const start = Date.parse(span.a);
  const rows = calls.map((c) => {
    let tools: string[] = [];
    try {
      const parsed: unknown = JSON.parse(c.tool_names);
      if (Array.isArray(parsed)) tools = parsed.filter((x): x is string => typeof x === "string").slice(0, 8);
    } catch {
      tools = [];
    }
    return {
      id: c.call_id,
      offsetSec: Math.round((Date.parse(c.ts) - start) / 1000),
      ts: c.ts,
      model: c.model,
      sidechain: c.is_sidechain === 1,
      tokens: { input: c.input_tokens, output: c.output_tokens, reasoning: c.reasoning_tokens, read: c.cache_read_tokens, write: c.cw5 + c.cw1 },
      stopReason: c.stop_reason,
      apiError: c.is_api_error === 1,
      tools,
      class: c.class,
      snapshotId: c.snapshot_id,
      micros: c.total_micros,
      unpricedReason: c.unpriced_reason,
      cause: CAUSE_OF(analysis.get(c.call_id)),
    };
  });
  const byCause: Record<string, { calls: number; micros: number }> = {};
  for (const r of rows) {
    const e = (byCause[r.cause] ??= { calls: 0, micros: 0 });
    e.calls += 1;
    e.micros += r.micros ?? 0;
  }
  return {
    state: "ok",
    id,
    project: projectName(head.project_path),
    tool: head.tool,
    toolVersion: head.tool_version,
    branch: head.git_branch ? createRedactor().clean(head.git_branch).slice(0, 80) : null,
    startIso: span.a,
    endIso: span.b,
    callCount: span.n,
    truncated: span.n > LIMIT,
    calls: rows,
    byCause,
    blocks: blocks.slice(0, 50).map((b) => ({ id: b.id, kind: b.kind, rule: b.rule, calls: b.calls.length, micros: b.totalMicros, unpricedCalls: b.unpricedCalls, confidence: b.confidence ?? "high", stopOffsetSec: Math.round((b.startMs - start) / 1000), durationSec: Math.round((b.endMs - b.startMs) / 1000) })),
    blockCount: blocks.length,
    clock: skewed ? { skewedLines: Number(skew?.s ?? 0), futureLines: Number(skew?.f ?? 0) } : null,
    delegation: delegationBlock(ctx, id),
    untrusted: flagsFor(ctx.db, id).map((f) => ({ field: f.field, kind: f.kind, excerpt: f.excerpt })),
    landing: {
      state: outcome?.state ?? "unlinked",
      confidence: outcome?.best_confidence ?? null,
      commits: commits.map((c) => ({ sha: c.sha.slice(0, 9), authoredAt: c.authored_at, method: c.method, confidence: c.confidence, merged: c.merged === 1, reverted: c.reverted === 1, repo: projectName(c.root) })),
    },
    snapshotId: ctx.snapshot.snapshotId,
  };
}

// ---------------------------------------------------------------------------------------------- outcomes

/** How the sessions in a span were grouped into tasks, and the costliest tasks. Empty (not assigned) when the ledger has no task rows yet. */
function taskView(ctx: UiContext, span: Span): object {
  const has = one<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'task'");
  if (!has || has.n === 0 || (one<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM task")?.n ?? 0) === 0) return { assigned: false, methods: [], top: [] };
  const methods = all<{ method: string; tasks: number; sessions: number; micros: number | null }>(
    ctx.db,
    `SELECT t.method, COUNT(DISTINCT t.task_id) tasks, COUNT(DISTINCT m.session_id) sessions, SUM(c.total_micros) micros
     FROM model_call m JOIN task_session ts ON ts.session_id = m.session_id JOIN task t ON t.task_id = ts.task_id
     LEFT JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated' WHERE m.ts >= ? AND m.ts <= ? GROUP BY t.method`,
    span.sinceIso,
    span.untilIso,
  );
  const top = all<{ task_id: string; method: string; label: string; sessions: number; micros: number | null }>(
    ctx.db,
    `SELECT t.task_id, t.method, t.label, COUNT(DISTINCT m.session_id) sessions, SUM(c.total_micros) micros
     FROM model_call m JOIN task_session ts ON ts.session_id = m.session_id JOIN task t ON t.task_id = ts.task_id
     JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated' WHERE m.ts >= ? AND m.ts <= ? GROUP BY t.task_id ORDER BY micros DESC LIMIT 15`,
    span.sinceIso,
    span.untilIso,
  );
  const order = ["explicit", "ticket", "pull_request", "branch", "session"];
  const by = new Map(methods.map((m) => [m.method, m]));
  return {
    assigned: true,
    methods: order.map((method) => ({ method, tasks: by.get(method)?.tasks ?? 0, sessions: by.get(method)?.sessions ?? 0, micros: by.get(method)?.micros ?? 0 })),
    // The task id carries the project path, which the browser never gets; the label is what a person reads.
    top: top.map((t) => ({ method: t.method, label: t.label, sessions: t.sessions, micros: t.micros ?? 0 })),
  };
}

/** The open owner questions: how many, and the costliest few, with the command that answers one. Empty on a ledger too old to hold answers. */
function questionView(ctx: UiContext): object {
  const has = one<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'owner_answer'");
  if (!has || has.n === 0) return { open: 0, top: [] };
  const all = openQuestions(ctx.db, 100_000);
  return {
    open: all.length,
    top: all.slice(0, 5).map((q) => ({ id: q.id, sha: q.sha.slice(0, 7), commitAt: q.commitAt, project: projectName(q.project), sessionStart: q.sessionStart, sessionEnd: q.sessionEnd, spendMicros: q.spendMicros, method: q.method })),
  };
}

/** How approvals were made in a period, read from the approval record; null when there is none to read. */
export function readHabit(path: string | null, startMs: number, endMs: number, nowMs: number): ApprovalHabit | null {
  if (path === null || !existsSync(path)) return null;
  try {
    const d = new DatabaseSync(path, { readOnly: true });
    try {
      return approvalHabit(d, new Date(startMs).toISOString(), new Date(endMs).toISOString(), new Date(nowMs).toISOString());
    } finally {
      d.close();
    }
  } catch {
    return null;
  }
}

/** The weekly review as the screen shows it: the review, the weeks the ledger covers (newest first, at most eight) and the dates of the one shown. */
export function week(ctx: UiContext, label: string | null): object {
  const empty = emptyState(ctx);
  if (empty) return empty;
  const last = one<{ b: string }>(ctx.db, "SELECT MAX(ts) b FROM model_call")!.b;
  const first = one<{ a: string }>(ctx.db, "SELECT MIN(ts) a FROM model_call")!.a;
  let range;
  try {
    range = weekRange(label ?? undefined, ctx.nowMs());
  } catch (e) {
    throw new BadParam((e as Error).message);
  }
  // The default is the last complete week; a ledger that ends before it shows the week it ends in.
  if (label === null && Date.parse(last) < range.startMs) range = weekRange(weekLabel(Date.parse(last)), ctx.nowMs());
  const weeks: string[] = [];
  for (let t = Date.parse(last); t >= Date.parse(first) - 7 * DAY && weeks.length < 8; t -= 7 * DAY) {
    const w = weekLabel(t);
    if (!weeks.includes(w)) weeks.push(w);
  }
  if (!weeks.includes(range.label)) weeks.push(range.label);
  weeks.sort().reverse();
  const habit = readHabit(ctx.dossierDbPath ?? null, range.startMs, range.endMs, ctx.nowMs());
  const review = buildReview({ db: ctx.db, snapshot: ctx.snapshot, range, markers: ctx.mode === "own_logs" ? readMarkers(defaultMarkerPath()) : [], approvals: habit });
  return { state: "ok", weeks, review: { ...review, approvalLines: habit === null ? [] : renderHabit(habit, "in the week"), week: { label: review.week.label, start: new Date(review.week.startMs).toISOString().slice(0, 10), end: new Date(review.week.endMs - 1).toISOString().slice(0, 10) } } };
}

export function outcomes(ctx: UiContext, span: Span): object {
  const empty = emptyState(ctx);
  if (empty) return empty;
  const landing = landingBreakdown(ctx.db, span.sinceIso, span.untilIso);
  const byMethod = all<{ method: string; confidence: string; n: number }>(
    ctx.db,
    `SELECT sc.method, sc.confidence, COUNT(*) n FROM session_commit sc WHERE sc.session_id IN (SELECT DISTINCT session_id FROM model_call WHERE ts >= ? AND ts <= ?)
     GROUP BY sc.method, sc.confidence ORDER BY n DESC`,
    span.sinceIso,
    span.untilIso,
  );
  const repos = one<{ n: number }>(ctx.db, "SELECT COUNT(*) n FROM repo")?.n ?? 0;
  const commits = one<{ n: number; merged: number; reverted: number }>(ctx.db, "SELECT COUNT(*) n, COALESCE(SUM(merged),0) merged, COALESCE(SUM(reverted),0) reverted FROM git_commit")!;
  const rows = all<{ session_id: string; project_path: string | null; micros: number; state: string | null; conf: string | null; commits: number | null; method: string | null }>(
    ctx.db,
    `SELECT m.session_id, s.project_path, SUM(c.total_micros) micros, o.state, o.best_confidence conf, o.commits,
            (SELECT sc.method FROM session_commit sc WHERE sc.session_id = m.session_id ORDER BY CASE sc.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END LIMIT 1) method
     FROM model_call m JOIN session s ON s.session_id = m.session_id JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated'
     LEFT JOIN session_outcome o ON o.session_id = m.session_id WHERE m.ts >= ? AND m.ts <= ? GROUP BY m.session_id ORDER BY micros DESC LIMIT 25`,
    span.sinceIso,
    span.untilIso,
  );
  return {
    state: "ok",
    span: { since: span.sinceIso, until: span.untilIso, days: span.days },
    linked: hasLinks(ctx.db),
    repos,
    commits: { total: commits.n, merged: commits.merged, reverted: commits.reverted },
    landing: { rows: landingRows(landing), totalMicros: landing.totalMicros, lowConfidenceMicros: landing.lowConfidenceMicros },
    tasks: taskView(ctx, span),
    questions: questionView(ctx),
    byMethod: byMethod.map((m) => ({ method: m.method, confidence: m.confidence, links: m.n })),
    top: rows.map((r) => ({ id: r.session_id, project: projectName(r.project_path), micros: r.micros, state: r.state ?? "unlinked", confidence: r.conf, commits: r.commits ?? 0, method: r.method })),
  };
}

// ---------------------------------------------------------------------------------------------- policy

export function policyFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => /^[A-Za-z0-9._-]+\.ya?ml$/.test(f)).sort();
  } catch {
    return [];
  }
}

function describeRule(r: Policy["rules"][number]): string {
  const dims = [...Object.entries(r.when.finite).map(([d, v]) => `${d.replace("_", " ")} in ${(v ?? []).join(", ")}`), ...Object.entries(r.when.numeric).map(([d, iv]) => {
      const usd = (m: number): string => `$${(m / 1_000_000).toFixed(2)}`;
      const name = d.replace(/_micros$/, "").replace(/_/g, " ");
      const lo = Number.isFinite(iv.lo) ? `${iv.loOpen ? ">" : ">="} ${usd(iv.lo)}` : "";
      const hi = Number.isFinite(iv.hi) ? `${iv.hiOpen ? "<" : "<="} ${usd(iv.hi)}` : "";
      return `${name} ${[lo, hi].filter(Boolean).join(" and ")}`;
    })];
  const when = dims.length === 0 ? "every request" : dims.join("; ");
  if (r.kind === "permit") return `permit ${when}${r.cap ? `, ${capLabel(r.cap)} cap ${(r.cap.maxMicros / 1_000_000).toFixed(2)} USD` : ""}`;
  if (r.kind === "forbid") return `forbid ${when}, then ${r.action}`;
  return `route ${when}: ${Object.entries(r.modelMap).map(([a, b]) => `${a} to ${b}`).join(", ")}`;
}

function loadPolicy(dir: string, name: string, files: readonly string[]): { policy: Policy; text: string } | { error: string; text: string } {
  if (!files.includes(name)) throw new BadParam("unknown policy file");
  const text = readFileSync(join(dir, name), "utf8");
  try {
    return { policy: parsePolicyYaml(text), text };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "invalid policy", text };
  }
}

export function policy(ctx: UiContext, span: Span, fromName: string | null, toName: string | null): object {
  const files = policyFiles(ctx.policiesDir);
  if (files.length === 0) return { state: "empty", reason: "No policy files found in the policies folder.", hint: "Write a policy file (see policies/*.yaml in the repository) or run `desk draft`." };
  const to = toName ?? files[files.length - 1]!;
  const from = fromName ?? (files.length > 1 ? files.find((f) => f !== to) ?? null : null);
  const loaded = new Map<string, ReturnType<typeof loadPolicy>>();
  for (const f of files) loaded.set(f, loadPolicy(ctx.policiesDir, f, files));
  if (!files.includes(to)) throw new BadParam("unknown policy file");
  if (from && !files.includes(from)) throw new BadParam("unknown policy file");
  const list = files.map((f) => {
    const l = loaded.get(f)!;
    return "policy" in l
      ? { name: f, valid: true, rules: l.policy.rules.map((r) => ({ id: r.id, kind: r.kind, summary: describeRule(r) })), approvals: l.policy.approvals.length, source: l.text }
      : { name: f, valid: false, error: l.error, rules: [], approvals: 0, source: l.text };
  });
  const candidate = loaded.get(to)!;
  const baseline = from ? loaded.get(from)! : null;
  let restrict: object | null = null;
  if ("policy" in candidate && baseline && "policy" in baseline) {
    const r = restrictCheck(baseline.policy, candidate.policy);
    restrict = {
      from,
      to,
      narrows: r.narrows,
      gridSize: r.gridSize,
      mergedDims: r.mergedDims,
      outsideFragment: r.outsideFragment,
      widening: r.widening ? describeWidening(r.widening) : null,
      routeChanges: r.routeChanges.length,
    };
  }
  let replay: object | null = null;
  if ("policy" in candidate && !ledgerIsEmpty(ctx)) {
    const sessions = replaySessionsFromLedger(ctx.db, ctx.snapshot, span.sinceIso, span.untilIso);
    const reproduction = baselineReproduction(ctx.db, sessions, span.sinceIso, span.untilIso);
    const r = replayPolicy(candidate.policy, sessions);
    replay = !reproduction.reproduces ? { withheld: true, notice: withheldNotice(reproduction), mismatched: reproduction.mismatchedCount, sessions: sessions.length } : {
      policy: to,
      sessions: sessions.length,
      totalMicros: r.totalMicros,
      savedMicros: r.savedMicros,
      askedCalls: r.askedCalls,
      deniedCalls: r.deniedCalls,
      pausedSessions: r.paused.length,
      pausedByDefaultDeny: r.paused.filter((p) => p.verdictReason.includes("default deny")).length,
      landedTotal: r.landedTotal,
      landedBlocked: r.landedBlocked.length,
    };
  }
  const commands: Record<string, string> = {};
  for (const t of TOOLS) if (t.versionCommand) commands[t.tool] = t.versionCommand;
  const enforcement = ladder(readResults(ctx.enforcementPath ?? "data/desk/enforcement.json").results, installedVersions(commands, ctx.nowMs()));
  return { state: "ok", files: list, selected: { from, to }, enforcement, valid: "policy" in candidate, error: "error" in candidate ? candidate.error : null, restrict, replay, span: { since: span.sinceIso, until: span.untilIso, days: span.days } };
}

function ledgerIsEmpty(ctx: UiContext): boolean {
  return emptyState(ctx) !== null;
}

/** How the wind tunnel did against what happened, from the recorded coverage study; null when none is recorded. */
function measuredCoverage(): object | null {
  const file = "docs/verification/calibration/windtunnel.json";
  if (!existsSync(file)) return null;
  try {
    const c = JSON.parse(readFileSync(file, "utf8")) as { trials: unknown[]; inside: number; coverage: number; low: number; high: number; probability?: { raw: { ece: number } } };
    return { trials: c.trials.length, inside: c.inside, coverage: c.coverage, low: c.low, high: c.high, eceRaw: c.probability?.raw.ece ?? null };
  } catch {
    return null;
  }
}

export function tunnel(ctx: UiContext, span: Span, name: string): object {
  const files = policyFiles(ctx.policiesDir);
  const l = loadPolicy(ctx.policiesDir, name, files);
  if (!("policy" in l)) return { state: "error", message: l.error };
  if (ledgerIsEmpty(ctx)) return emptyState(ctx)!;
  const sessions = replaySessionsFromLedger(ctx.db, ctx.snapshot, span.sinceIso, span.untilIso);
  const reproduction = baselineReproduction(ctx.db, sessions, span.sinceIso, span.untilIso);
  if (!reproduction.reproduces) return { state: "error", message: withheldNotice(reproduction) };
  const t = windTunnel(l.policy, sessions);
  return { state: "ok", policy: name, ...t, measured: measuredCoverage() };
}

// ---------------------------------------------------------------------------------------------- sources

export function sources(ctx: UiContext): object {
  const ingest = all<{ kind: string; files: number; bytes: number | null; last: string | null }>(ctx.db, "SELECT kind, COUNT(*) files, SUM(size_bytes) bytes, MAX(last_ingested_at) last FROM ingest_source GROUP BY kind");
  const run = one<{ finished_at: string; files: number; lines_read: number; calls_new: number; malformed_lines: number; truncated_tails: number; usage_conflicts: number }>(ctx.db, "SELECT finished_at, files, lines_read, calls_new, malformed_lines, truncated_tails, usage_conflicts FROM ingest_run ORDER BY run_id DESC LIMIT 1");
  const totals = one<{ m: number; t: number; u: number; s: number; f: number }>(ctx.db, "SELECT COALESCE(SUM(malformed_lines),0) m, COALESCE(SUM(truncated_tails),0) t, COALESCE(SUM(usage_conflicts),0) u, COALESCE(SUM(skewed_lines),0) s, COALESCE(SUM(future_lines),0) f FROM ingest_run");
  const unpriced = all<{ model: string; reason: string | null; calls: number; tokens: number }>(
    ctx.db,
    `SELECT m.model, c.unpriced_reason reason, COUNT(*) calls, SUM(m.input_tokens + m.output_tokens + m.cache_read_tokens + m.cache_write_5m_tokens + m.cache_write_1h_tokens) tokens
     FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE c.class = 'unpriced' GROUP BY m.model, c.unpriced_reason ORDER BY calls DESC LIMIT 20`,
  );
  const repos = one<{ n: number }>(ctx.db, "SELECT COUNT(*) n FROM repo")?.n ?? 0;
  const fetched = Date.parse(ctx.snapshot.fetchedAt);
  const ageDays = Number.isNaN(fetched) ? null : Math.max(0, Math.floor((ctx.nowMs() - fetched) / DAY));
  const set = (name: string): boolean => (ctx.env[name] ?? "").length > 0;
  // A setting can have an alternative name (the model's three settings also go by NVIDIA_*); it counts as set when any of its names is.
  const endpoint = (label: string, settings: string[][], role: string): { label: string; configured: boolean; missing: string[]; role: string } => {
    const missing = settings.filter((names) => !names.some(set)).map((names) => names[0] as string);
    return { label, role, configured: missing.length === 0, missing };
  };
  return {
    state: "ok",
    mode: ctx.mode,
    ledger: ctx.ledgerName,
    adapters: ADAPTERS.map((a) => {
      const row = a.ledgerKind === null ? undefined : ingest.find((i) => i.kind === a.ledgerKind);
      return {
        id: a.id,
        title: a.title,
        tool: a.tool,
        how: a.how,
        command: a.command ?? null,
        found: row?.files ?? 0,
        bytes: row?.bytes ?? 0,
        lastIngestedAt: row?.last ?? null,
        capabilities: CAPABILITY_KEYS.map((k) => ({ key: k, title: CAPABILITY_TITLE[k], level: a.capabilities[k].level, note: a.capabilities[k].note })),
      };
    }),
    noAdapter: NO_ADAPTER.map((n) => ({ tool: n.tool, why: n.why })),
    lastRun: run ?? null,
    skipped: { malformedLines: totals?.m ?? 0, truncatedTails: totals?.t ?? 0, usageConflicts: totals?.u ?? 0, skewedLines: totals?.s ?? 0, futureLines: totals?.f ?? 0 },
    price: { snapshotId: ctx.snapshot.snapshotId, source: ctx.snapshot.source, fetchedAt: ctx.snapshot.fetchedAt, ageDays, models: Object.keys(ctx.snapshot.models).length, license: ctx.snapshot.license },
    unpriced,
    repos,
    endpoints: [
      endpoint("Zetaris", [["ZETARIS_REST_URL"], ["ZETARIS_API_KEY"], ["ZETARIS_ORG_ID"]], "Organisational sources (invoices, CI and pull requests, roster)."),
      endpoint("Nemotron model endpoint", [["MODEL_BASE_URL", "NVIDIA_BASE_URL"], ["MODEL_API_KEY", "NVIDIA_API_KEY"], ["NEMOTRON_MODEL", "NVIDIA_MODEL"]], "Language roles: drafter, auditor, explainer."),
    ],
    egress: egressBlock(ctx),
    untrusted: flagTotals(ctx.db),
    sampleMode: ctx.mode === "sample",
  };
}

/** Where this product's own code can send data, from the settings it runs with, and what has been sent. Never the text of a request. */
function egressBlock(ctx: UiContext): object {
  const m = manifestFromEnv(ctx.env);
  const log = summariseEgress(ctx.egressLogPath === null ? "" : (ctx.egressLogPath ?? ctx.env["DESK_EGRESS_LOG"] ?? "data/desk/egress.jsonl"));
  return {
    profile: m.profile,
    destinations: m.destinations.map((d) => ({ kind: d.kind, origin: d.origin, purpose: d.purpose, loopback: d.loopback, declaredBy: d.declaredBy, refused: m.profile === "local" && !d.loopback })),
    log: { requests: log.requests, bytes: log.bytes, redactions: log.redactions, first: log.first, last: log.last, hosts: log.hosts },
  };
}
