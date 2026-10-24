import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { analyseCalls, buildAutopsy, CAUSES, type Autopsy, type AutopsyCall, type Cause, type PerCall } from "../autopsy/engine.ts";
import { loadAutopsyCalls } from "../autopsy/load.ts";
import { buildCard } from "../card/build.ts";
import type { Ledger } from "../ledger/db.ts";
import { landingBreakdown } from "../outcomes/breakdown.ts";
import { reconcile, summariseReconciliation, type ReconcileRow } from "../reconcile/reconcile.ts";
import { groupLabel, limitGroups } from "../limits/fit.ts";
import { renderRunway, runwayDetail, runwayFromLedger, runwayHead } from "../limits/runway.ts";
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
    price: { snapshotId: ctx.snapshot.snapshotId, fetchedAt: ctx.snapshot.fetchedAt },
    screens: SCREENS,
  };
}

/** The screen registry. A screen is listed only when the module behind it exists and has data to show. */
export const SCREENS = [
  { id: "brief", title: "Brief", number: "01" },
  { id: "bill", title: "Bill", number: "02" },
  { id: "autopsy", title: "Autopsy", number: "03" },
  { id: "sessions", title: "Sessions", number: "04" },
  { id: "outcomes", title: "Outcomes", number: "05" },
  { id: "policy", title: "Policy", number: "06" },
  { id: "canary", title: "Canary", number: "07" },
  { id: "ask", title: "Ask", number: "08" },
  { id: "organisation", title: "Org data", number: "09" },
  { id: "dossiers", title: "Dossiers", number: "10" },
  { id: "evidence", title: "Evidence", number: "11" },
  { id: "sources", title: "Doctor", number: "12" },
] as const;

// ---------------------------------------------------------------------------------------------- bill

/** What the tool recorded for its own cost in a period, from the processes whose last record falls in it; null when this ledger predates the table. */
function reportedInSpan(ctx: UiContext, span: Span): { rows: ReconcileRow[]; summary: ReturnType<typeof summariseReconciliation> } | null {
  const has = one<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'reported_cost'");
  if (!has || has.n === 0) return null;
  const rows = reconcile(ctx.db).filter((r) => r.observedAt !== null && r.observedAt >= span.sinceIso && r.observedAt <= span.untilIso);
  return { rows, summary: summariseReconciliation(rows) };
}

export function bill(ctx: UiContext, span: Span): object {
  const empty = emptyState(ctx);
  if (empty) return empty;
  const t = tally(ctx.db, span.sinceIso, span.untilIso);
  const { autopsy } = autopsyFor(ctx, span.sinceIso, span.untilIso);
  const landing = landingBreakdown(ctx.db, span.sinceIso, span.untilIso);
  const landed = landing.byState.kept.sessions + landing.byState.merged.sessions;
  const landedMicros = landing.byState.kept.micros + landing.byState.merged.micros;
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
     WHERE m.ts >= ? AND m.ts <= ? GROUP BY s.project_path ORDER BY micros DESC LIMIT 12`,
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
    totals: { ...t, pricedShare: t.pricedCalls + t.unpricedCalls === 0 ? 0 : t.pricedCalls / (t.pricedCalls + t.unpricedCalls) },
    classes: [
      { cls: "billed", calls: 0, note: "Invoices are not read on this screen. When Zetaris is connected the invoice figures are on Org data." },
      reportedClass(reportedInSpan(ctx, span)),
      { cls: "estimated", calls: t.pricedCalls, micros: t.estimatedMicros, note: "List price times logged tokens." },
      { cls: "unpriced", calls: t.unpricedCalls, note: "Models with no price row: tokens counted, no dollars invented." },
    ],
    reconciliation: reconciliationSummary(reportedInSpan(ctx, span)),
    priceBand: priceBand(ctx, span, t.estimatedMicros),
    landing: { rows: landingRows(landing), totalMicros: landing.totalMicros, lowConfidenceMicros: landing.lowConfidenceMicros, linked: hasLinks(ctx.db) },
    costPerLandedSession: landed === 0 ? null : Math.round(landedMicros / landed),
    landedSessions: landed,
    causes: causeRows(autopsy),
    missSavingMicros: autopsy.missEvents.reduce((s, e) => s + e.savingMicros, 0),
    daily,
    byModel,
    byProject: [...merged.values()].sort((a, b) => b.micros - a.micros),
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

export function brief(ctx: UiContext): object {
  const empty = emptyState(ctx);
  if (empty) return empty;
  const lastIso = one<{ b: string }>(ctx.db, "SELECT MAX(ts) b FROM model_call")!.b;
  // The brief is about a whole day. If the last day in the ledger is a stub (far fewer calls than the days before it,
  // because the logs end partway through), brief the day before instead of comparing a morning with a full day.
  const recent = all<{ day: string; n: number }>(ctx.db, "SELECT substr(ts, 1, 10) day, COUNT(*) n FROM model_call GROUP BY day ORDER BY day DESC LIMIT 15");
  const lastDay = recent[0]!;
  const earlier = recent.slice(1).map((r) => r.n).sort((a, b) => a - b);
  const typical = earlier.length === 0 ? 0 : earlier[Math.floor(earlier.length / 2)]!;
  const day = recent.length > 1 && lastDay.n < 0.3 * typical ? recent[1]!.day : lastDay.day;
  const dayStart = `${day}T00:00:00.000Z`;
  const dayEnd = `${day}T23:59:59.999Z`;
  const prevDay = new Date(Date.parse(dayStart) - DAY).toISOString().slice(0, 10);
  const t = tally(ctx.db, dayStart, dayEnd);
  const prev = tally(ctx.db, `${prevDay}T00:00:00.000Z`, `${prevDay}T23:59:59.999Z`);
  const landing = landingBreakdown(ctx.db, dayStart, dayEnd);
  const { autopsy: a } = autopsyFor(ctx, dayStart, dayEnd);
  const byProject = all<{ project_path: string | null; micros: number }>(
    ctx.db,
    `SELECT s.project_path, SUM(c.total_micros) micros FROM model_call m JOIN session s ON s.session_id = m.session_id
     JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated' WHERE m.ts >= ? AND m.ts <= ? GROUP BY s.project_path ORDER BY micros DESC LIMIT 20`,
    dayStart,
    dayEnd,
  );
  const projects = new Map<string, number>();
  for (const p of byProject) projects.set(projectName(p.project_path), (projects.get(projectName(p.project_path)) ?? 0) + p.micros);
  const byModel = all<{ model: string; micros: number | null; calls: number }>(ctx.db, "SELECT model, SUM(estimated_micros) micros, SUM(calls) calls FROM v_cost_by_day_model WHERE day = ? GROUP BY model ORDER BY micros DESC", day);
  // The one recommended action: the largest measured fix from the whole ledger, else the largest cause of the day.
  const calls = loadAutopsyCalls(ctx.db, ctx.snapshot, new Date(Date.parse(lastIso) - 14 * DAY).toISOString(), lastIso);
  const card = buildCard({ calls, mode: ctx.mode, hours: 5, days: 14, ingest: { malformedLines: 0, truncatedTails: 0, usageConflicts: 0, logFilesFound: 1, searchedPaths: [] }, landingKnown: hasLinks(ctx.db) });
  const fix = "empty" in card ? null : (card.fixes[0] ?? null);
  return {
    state: "ok",
    day,
    previousDay: prevDay,
    spend: t,
    previousSpend: prev,
    projects: [...projects].map(([project, micros]) => ({ project, micros })).sort((x, y) => y.micros - x.micros),
    models: byModel,
    landing: { rows: landingRows(landing), totalMicros: landing.totalMicros, linked: hasLinks(ctx.db) },
    causes: causeRows(a).slice(0, 5),
    runway: runwayRows(ctx),
    action: fix ? { cause: fix.cause, fix: fix.fix, basis: fix.basis, addressableMicros: fix.addressableMicros, interval: fix.interval, windowsUsed: fix.windowsUsed, note: fix.note } : null,
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
  for (const [tool, name] of RUNWAY_TOOLS) {
    const groups = limitGroups(ctx.db, tool, now);
    const current = groups[0];
    if (!current || now.getTime() - Date.parse(current.lastTs) > RUNWAY_RECENT_DAYS * DAY) continue;
    for (const g of groups.filter((x) => x.planType === current.planType).sort((a, b) => a.windowMinutes - b.windowMinutes)) {
      const label = `${name}, ${groupLabel(g)}`;
      const r = runwayFromLedger(ctx.db, { tool, windowMinutes: g.windowMinutes, planType: g.planType, now });
      out.push({ label, ...r, resetsAt: r.resetsAt === null ? null : r.resetsAt.toISOString(), head: runwayHead(r), detail: runwayDetail(r), text: renderRunway(r, label) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- sessions

const SORTS: Record<string, string> = { cost: "micros DESC", recent: "start DESC", calls: "calls DESC" };

export function sessions(ctx: UiContext, span: Span, sort: string, limit: number, offset: number): object {
  const empty = emptyState(ctx);
  if (empty) return empty;
  const order = SORTS[sort];
  if (!order) throw new BadParam("sort must be cost, recent or calls");
  const total = one<{ n: number }>(ctx.db, "SELECT COUNT(DISTINCT session_id) n FROM model_call WHERE ts >= ? AND ts <= ?", span.sinceIso, span.untilIso)?.n ?? 0;
  const rows = all<{ session_id: string; project_path: string | null; start: string; end: string; calls: number; micros: number | null; unpriced: number; sub: number; state: string | null; conf: string | null; commits: number | null }>(
    ctx.db,
    `SELECT m.session_id, s.project_path, MIN(m.ts) start, MAX(m.ts) end, COUNT(*) calls, SUM(c.total_micros) micros,
            SUM(CASE WHEN c.class = 'unpriced' THEN 1 ELSE 0 END) unpriced, SUM(m.is_sidechain) sub, o.state, o.best_confidence conf, o.commits
     FROM model_call m JOIN session s ON s.session_id = m.session_id LEFT JOIN cost_event c ON c.call_id = m.call_id
     LEFT JOIN session_outcome o ON o.session_id = m.session_id
     WHERE m.ts >= ? AND m.ts <= ? GROUP BY m.session_id ORDER BY ${order}, m.session_id LIMIT ? OFFSET ?`,
    span.sinceIso,
    span.untilIso,
    limit,
    offset,
  );
  return {
    state: "ok",
    total,
    limit,
    offset,
    sort,
    rows: rows.map((r) => ({ id: r.session_id, project: projectName(r.project_path), start: r.start, end: r.end, calls: r.calls, micros: r.micros ?? 0, unpricedCalls: r.unpriced, subagentCalls: r.sub, state: r.state ?? "unlinked", confidence: r.conf, commits: r.commits ?? 0 })),
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
  const LIMIT = 3000;
  const calls = all<{ call_id: string; ts: string; model: string; is_sidechain: number; input_tokens: number; output_tokens: number; reasoning_tokens: number; cache_read_tokens: number; cw5: number; cw1: number; stop_reason: string | null; is_api_error: number; tool_names: string; class: string | null; snapshot_id: string | null; total_micros: number | null; unpriced_reason: string | null }>(
    ctx.db,
    `SELECT m.call_id, m.ts, m.model, m.is_sidechain, m.input_tokens, m.output_tokens, m.reasoning_tokens, m.cache_read_tokens, m.cache_write_5m_tokens cw5, m.cache_write_1h_tokens cw1,
            m.stop_reason, m.is_api_error, m.tool_names, c.class, c.snapshot_id, c.total_micros, c.unpriced_reason
     FROM model_call m LEFT JOIN cost_event c ON c.call_id = m.call_id WHERE m.session_id = ? ORDER BY m.ts, m.call_id LIMIT ?`,
    id,
    LIMIT,
  );
  const sessionCalls = loadAutopsyCalls(ctx.db, ctx.snapshot, span.a, span.b).filter((c) => c.sessionId === id);
  const analysis = analyseCalls(sessionCalls);
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
    landing: {
      state: outcome?.state ?? "unlinked",
      confidence: outcome?.best_confidence ?? null,
      commits: commits.map((c) => ({ sha: c.sha.slice(0, 9), authoredAt: c.authored_at, method: c.method, confidence: c.confidence, merged: c.merged === 1, reverted: c.reverted === 1, repo: projectName(c.root) })),
    },
    snapshotId: ctx.snapshot.snapshotId,
  };
}

// ---------------------------------------------------------------------------------------------- outcomes

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
  if (r.kind === "permit") return `permit ${when}${r.cap ? `, ${r.cap.window} cap ${(r.cap.maxMicros / 1_000_000).toFixed(2)} USD` : ""}`;
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
    const r = replayPolicy(candidate.policy, sessions);
    replay = {
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
  return { state: "ok", files: list, selected: { from, to }, valid: "policy" in candidate, error: "error" in candidate ? candidate.error : null, restrict, replay, span: { since: span.sinceIso, until: span.untilIso, days: span.days } };
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
  const t = windTunnel(l.policy, sessions);
  return { state: "ok", policy: name, ...t, measured: measuredCoverage() };
}

// ---------------------------------------------------------------------------------------------- sources

export function sources(ctx: UiContext): object {
  const ingest = all<{ kind: string; files: number; bytes: number | null; last: string | null }>(ctx.db, "SELECT kind, COUNT(*) files, SUM(size_bytes) bytes, MAX(last_ingested_at) last FROM ingest_source GROUP BY kind");
  const run = one<{ finished_at: string; files: number; lines_read: number; calls_new: number; malformed_lines: number; truncated_tails: number; usage_conflicts: number }>(ctx.db, "SELECT finished_at, files, lines_read, calls_new, malformed_lines, truncated_tails, usage_conflicts FROM ingest_run ORDER BY run_id DESC LIMIT 1");
  const totals = one<{ m: number; t: number; u: number }>(ctx.db, "SELECT COALESCE(SUM(malformed_lines),0) m, COALESCE(SUM(truncated_tails),0) t, COALESCE(SUM(usage_conflicts),0) u FROM ingest_run");
  const unpriced = all<{ model: string; reason: string | null; calls: number; tokens: number }>(
    ctx.db,
    `SELECT m.model, c.unpriced_reason reason, COUNT(*) calls, SUM(m.input_tokens + m.output_tokens + m.cache_read_tokens + m.cache_write_5m_tokens + m.cache_write_1h_tokens) tokens
     FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE c.class = 'unpriced' GROUP BY m.model, c.unpriced_reason ORDER BY calls DESC LIMIT 20`,
  );
  const repos = one<{ n: number }>(ctx.db, "SELECT COUNT(*) n FROM repo")?.n ?? 0;
  const fetched = Date.parse(ctx.snapshot.fetchedAt);
  const ageDays = Number.isNaN(fetched) ? null : Math.max(0, Math.floor((ctx.nowMs() - fetched) / DAY));
  const set = (name: string): boolean => (ctx.env[name] ?? "").length > 0;
  const endpoint = (label: string, names: string[], role: string): { label: string; configured: boolean; missing: string[]; role: string } => ({ label, role, configured: names.every(set), missing: names.filter((n) => !set(n)) });
  return {
    state: "ok",
    mode: ctx.mode,
    ledger: ctx.ledgerName,
    adapters: [
      { id: "claude_code", title: "Claude Code local logs", found: ingest.find((i) => i.kind === "claude_code")?.files ?? 0, bytes: ingest.find((i) => i.kind === "claude_code")?.bytes ?? 0, lastIngestedAt: ingest.find((i) => i.kind === "claude_code")?.last ?? null },
    ],
    lastRun: run ?? null,
    skipped: { malformedLines: totals?.m ?? 0, truncatedTails: totals?.t ?? 0, usageConflicts: totals?.u ?? 0 },
    price: { snapshotId: ctx.snapshot.snapshotId, source: ctx.snapshot.source, fetchedAt: ctx.snapshot.fetchedAt, ageDays, models: Object.keys(ctx.snapshot.models).length, license: ctx.snapshot.license },
    unpriced,
    repos,
    endpoints: [
      endpoint("Zetaris", ["ZETARIS_REST_URL", "ZETARIS_API_KEY", "ZETARIS_ORG_ID"], "Organisational sources (invoices, CI and pull requests, roster)."),
      endpoint("Nemotron model endpoint", ["NVIDIA_API_KEY", "NVIDIA_BASE_URL", "NVIDIA_MODEL"], "Language roles: drafter, auditor, explainer."),
    ],
    sampleMode: ctx.mode === "sample",
  };
}
