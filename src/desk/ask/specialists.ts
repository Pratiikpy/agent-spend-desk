import type { Claim } from "../agents/claims.ts";
import { hashJson } from "../../runtime/canonical.ts";
import type { Json } from "../../runtime/json.ts";
import { digestRange, loadPeriods } from "../engines/carry.ts";
import { addDays, daysBetween, rangeBounds } from "../engines/days.ts";
import { folderName, sanitizeLabel } from "../engines/label.ts";
import type { EngineName } from "../engines/load.ts";
import type { OwnerMemory, OutcomeDefinition } from "../engines/memory.ts";
import { queryChangesBefore, type WorldHistory } from "../engines/world.ts";
import type { Ledger } from "../ledger/db.ts";
import type { LandingState } from "../outcomes/attribute.ts";
import { landingBreakdown } from "../outcomes/breakdown.ts";
import { stepHash, type Step, type StepOp } from "./program.ts";
import { count, date, entity, makeClaim, pct, say, sayList, tokensOf, usd, word, type Rendered, type Slot } from "./text.ts";
import type { Trace } from "../agents/trace.ts";

export type Specialist = "accountant" | "historian" | "memory" | "range_reader";

export interface Evidence {
  kind: "owner_note";
  id: string;
  learnedAt: string;
  content: string;
}

export interface StepResult {
  id: string;
  op: StepOp;
  specialist: Specialist;
  engine: EngineName | null;
  queryHash: string;
  resultHash: string;
  rowCount: number;
  data: Json;
  claims: Claim[];
  evidence: Evidence[];
  /** Why the step could not give an answer, or null when it did. */
  unknowable: string | null;
  error: string | null;
}

export interface Engines {
  /** null means the World Model is off (or the ledger is empty). */
  world: WorldHistory | null;
  /** null means H-MEM is off. */
  memory: OwnerMemory | null;
  /** false means Markovian is off. */
  markovian: boolean;
}

export interface Coverage {
  start: string;
  end: string;
}

export interface RunContext {
  db: Ledger;
  engines: Engines;
  coverage: Coverage | null;
  /** Largest number of estimated tokens a range step may spend on claims when no engine bounds it. */
  claimTokenBudget: number;
  results: Map<string, StepResult>;
  trace: Trace;
}

export const DEFAULT_CLAIM_TOKENS = 1000;
const TOP_ROWS = 5;

export function ledgerCoverage(db: Ledger): Coverage | null {
  const r = db.prepare("SELECT MIN(substr(ts, 1, 10)) AS a, MAX(substr(ts, 1, 10)) AS b FROM model_call").get() as { a: string | null; b: string | null };
  return r.a && r.b ? { start: r.a, end: r.b } : null;
}

const SPECIALIST: Record<StepOp, Specialist> = {
  spend: "accountant",
  top_sessions: "accountant",
  landing: "accountant",
  compare: "accountant",
  changes_before: "historian",
  recall: "memory",
  range_digest: "range_reader",
};

const ENGINE_OF: Record<StepOp, EngineName | null> = {
  spend: null,
  top_sessions: null,
  landing: null,
  compare: null,
  changes_before: "world_model",
  recall: "hmem",
  range_digest: "markovian",
};

interface Outcome {
  data: Json;
  rowCount: number;
  claims: Rendered[];
  /** Per claim: the figure slot, kind and class. Aligned with `claims`. */
  meta: ClaimMeta[];
  evidence?: Evidence[];
  unknowable?: string | null;
}

interface ClaimMeta {
  kind: Claim["kind"];
  figure?: Slot;
  class?: Claim["class"];
}

const fact: ClaimMeta = { kind: "fact" };
const num = (figure: Slot, cls?: Claim["class"]): ClaimMeta => ({ kind: "number", figure, ...(cls ? { class: cls } : {}) });

export async function runStep(step: Step, ctx: RunContext): Promise<StepResult> {
  const queryHash = stepHash(step);
  const specialist = SPECIALIST[step.op];
  const base = { id: step.id, op: step.op, specialist, engine: ENGINE_OF[step.op], queryHash };
  try {
    ctx.db.exec("PRAGMA query_only = ON");
    const o = await execute(step, ctx);
    const resultHash = hashJson(o.data);
    const source = `ask:${step.op}:${queryHash.slice(7, 19)}`;
    const claims = o.claims.map((r, i) => {
      const m = o.meta[i] as ClaimMeta;
      return makeClaim({ id: `${step.id}.${i + 1}`, kind: m.kind, r, ...(m.figure ? { figure: m.figure } : {}), ...(m.class ? { class: m.class } : {}), source });
    });
    return { ...base, resultHash, rowCount: o.rowCount, data: o.data, claims, evidence: o.evidence ?? [], unknowable: o.unknowable ?? null, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ...base, resultHash: hashJson(message), rowCount: 0, data: null, claims: [], evidence: [], unknowable: null, error: message };
  } finally {
    ctx.db.exec("PRAGMA query_only = OFF");
  }
}

async function execute(step: Step, ctx: RunContext): Promise<Outcome> {
  switch (step.op) {
    case "spend":
      return spend(step, ctx);
    case "top_sessions":
      return topSessions(step, ctx);
    case "landing":
      return landing(step, ctx);
    case "compare":
      return compare(step, ctx);
    case "changes_before":
      return changesBefore(step, ctx);
    case "range_digest":
      return rangeDigestStep(step, ctx);
    case "recall":
      return recall(step, ctx);
  }
}

/* ------------------------------------------------------------------ accountant */

const GROUP_SQL: Record<"none" | "day" | "week" | "model", string> = {
  none: "''",
  day: "substr(m.ts, 1, 10)",
  week: "date(substr(m.ts, 1, 10), '-' || ((CAST(strftime('%w', substr(m.ts, 1, 10)) AS INTEGER) + 6) % 7) || ' days')",
  model: "m.model",
};

function emptyRange(ctx: RunContext, from: string, to: string, what: string): Outcome {
  const cov = ctx.coverage;
  const r: Rendered = cov
    ? say`No ${word(what)} were recorded between ${date(from)} and ${date(to)}; the ledger covers ${date(cov.start)} to ${date(cov.end)}.`
    : say`The ledger holds no model calls at all.`;
  return { data: { from, to, empty: true, coverage: cov ? { start: cov.start, end: cov.end } : null }, rowCount: 0, claims: [r], meta: [fact], unknowable: r.text };
}

function spend(step: Extract<Step, { op: "spend" }>, ctx: RunContext): Outcome {
  const { since, until } = rangeBounds(step.from, step.to);
  const params: (string | number)[] = [since, until];
  let filter = "";
  if (step.model !== undefined) {
    filter = " AND m.model = ?";
    params.push(step.model);
  }
  const rows = ctx.db
    .prepare(
      `SELECT ${GROUP_SQL[step.group]} AS g, COUNT(*) AS calls,
              COALESCE(SUM(CASE WHEN c.class = 'estimated' THEN c.total_micros ELSE 0 END), 0) AS micros,
              COALESCE(SUM(CASE WHEN c.class = 'unpriced' THEN 1 ELSE 0 END), 0) AS unpriced
       FROM model_call m JOIN cost_event c ON c.call_id = m.call_id
       WHERE m.ts >= ? AND m.ts < ?${filter} GROUP BY g ORDER BY g`,
    )
    .all(...params) as unknown as { g: string; calls: number; micros: number; unpriced: number }[];
  const totalCalls = rows.reduce((a, r) => a + r.calls, 0);
  const total = rows.reduce((a, r) => a + r.micros, 0);
  const unpriced = rows.reduce((a, r) => a + r.unpriced, 0);
  const data: Json = { from: step.from, to: step.to, group: step.group, model: step.model ?? null, totalMicros: total, totalCalls, unpricedCalls: unpriced, rows: rows.map((r) => ({ key: r.g, calls: r.calls, micros: r.micros, unpriced: r.unpriced })) };

  if (totalCalls === 0) {
    if (step.model !== undefined) return unknownModel(ctx, step.model, step.from, step.to, data);
    const o = emptyRange(ctx, step.from, step.to, "model calls");
    return { ...o, data };
  }
  const claims: Rendered[] = [];
  const meta: ClaimMeta[] = [];
  const add = (r: Rendered, m: ClaimMeta): void => {
    claims.push(r);
    meta.push(m);
  };
  if (step.model !== undefined) add(say`Estimated list-price spend on model ${entity(step.model)} between ${date(step.from)} and ${date(step.to)} was ${usd(total)}, an estimate from logged tokens and not a bill.`, num(usd(total), "estimated"));
  else add(say`Estimated list-price spend between ${date(step.from)} and ${date(step.to)} was ${usd(total)}, an estimate from logged tokens and not a bill.`, num(usd(total), "estimated"));
  add(say`That covers ${count(totalCalls)} model calls.`, num(count(totalCalls), "computed"));
  if (unpriced > 0) add(say`${count(unpriced)} of those calls were on models with no price and are not counted in the total.`, num(count(unpriced), "unpriced"));

  if (step.group !== "none") {
    const ranked = [...rows].sort((a, b) => b.micros - a.micros || a.g.localeCompare(b.g));
    const top = ranked.slice(0, TOP_ROWS);
    for (const r of top) {
      if (step.group === "model") add(say`Model ${entity(r.g)} cost ${usd(r.micros)}.`, num(usd(r.micros), "estimated"));
      else if (step.group === "day") add(say`The day ${date(r.g)} cost ${usd(r.micros)}.`, num(usd(r.micros), "estimated"));
      else add(say`The week starting ${date(r.g)} cost ${usd(r.micros)}.`, num(usd(r.micros), "estimated"));
    }
    const rest = ranked.slice(TOP_ROWS).reduce((a, r) => a + r.micros, 0);
    if (ranked.length > TOP_ROWS) add(say`Everything outside those ${word("five")} cost ${usd(rest)} in total.`, num(usd(rest), "estimated"));
  }
  return { data, rowCount: rows.length, claims, meta };
}

/** A model name nobody used: say so and list the names that do exist, so the question can be corrected. */
function unknownModel(ctx: RunContext, model: string, from: string, to: string, data: Json): Outcome {
  const known = ctx.db.prepare("SELECT model, COUNT(*) AS n FROM model_call WHERE model NOT LIKE '<%' GROUP BY model ORDER BY n DESC, model LIMIT 3").all() as unknown as { model: string }[];
  const claims: Rendered[] = [say`No calls on model ${entity(model)} were recorded between ${date(from)} and ${date(to)}.`];
  const meta: ClaimMeta[] = [fact];
  if (known.length > 0) {
    claims.push(sayList("Models in this ledger include ", known.map((k) => entity(k.model)), "."));
    meta.push(fact);
  }
  return { data, rowCount: 0, claims, meta, unknowable: claims[0]?.text ?? null };
}

const STATE_WORD: Record<string, string> = {
  unlinked: "not tied to any commit",
  committed: "committed but not merged",
  merged: "merged",
  kept: "merged and kept",
  reverted: "reverted",
};

function topSessions(step: Extract<Step, { op: "top_sessions" }>, ctx: RunContext): Outcome {
  const { since, until } = rangeBounds(step.from, step.to);
  const rows = ctx.db
    .prepare(
      `SELECT m.session_id AS id, s.project_path AS path, COALESCE(o.state, 'unlinked') AS state, COUNT(*) AS calls,
              SUM(c.total_micros) AS micros
       FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated'
       LEFT JOIN session s ON s.session_id = m.session_id
       LEFT JOIN session_outcome o ON o.session_id = m.session_id
       WHERE m.ts >= ? AND m.ts < ? GROUP BY m.session_id ORDER BY micros DESC, m.session_id LIMIT ?`,
    )
    .all(since, until, step.limit) as unknown as { id: string; path: string | null; state: string; calls: number; micros: number }[];
  const data: Json = { from: step.from, to: step.to, limit: step.limit, rows: rows.map((r) => ({ session: r.id, folder: folderName(r.path), state: r.state, calls: r.calls, micros: r.micros })) };
  if (rows.length === 0) return { ...emptyRange(ctx, step.from, step.to, "priced model calls"), data };
  const claims: Rendered[] = [];
  const meta: ClaimMeta[] = [];
  for (const r of rows) {
    const label = /^[A-Za-z]/.test(r.id) ? r.id : `sess-${r.id}`;
    claims.push(say`Session ${entity(`sess-${sessionTag(label)}`)} in ${entity(folderName(r.path))} cost ${usd(r.micros)}; its work is ${word(STATE_WORD[r.state] ?? "in an unknown state")}.`);
    meta.push(num(usd(r.micros), "estimated"));
  }
  return { data, rowCount: rows.length, claims, meta };
}

/** Eight characters after any leading "sess-", so a session id is short, starts with a letter in the label and never reads as a figure. */
function sessionTag(id: string): string {
  return sanitizeLabel(id.replace(/^sess-/, "")).replace(/[ /:@+.]/g, "").slice(0, 8);
}

export function describeLanded(states: readonly LandingState[]): string {
  const key = states.join("+");
  if (key === "kept") return "kept only";
  if (key === "merged+kept") return "merged or kept";
  if (key === "committed+merged+kept") return "committed, merged or kept";
  return states.join(", ");
}

function landing(step: Extract<Step, { op: "landing" }>, ctx: RunContext): Outcome {
  const { since, until } = rangeBounds(step.from, step.to);
  const b = landingBreakdown(ctx.db, since, until);
  const def: OutcomeDefinition | null = ctx.engines.memory ? ctx.engines.memory.outcomeDefinition() : null;
  const landedStates: readonly LandingState[] = def ? def.landed : ["merged", "kept"];
  const sum = (states: readonly LandingState[]): number => states.reduce((a, s) => a + b.byState[s].micros, 0);
  const landed = sum(landedStates);
  const reverted = b.byState.reverted.micros;
  const linkedNotLanded = (["committed", "merged", "kept"] as const).filter((s) => !landedStates.includes(s)).reduce((a, s) => a + b.byState[s].micros, 0);
  const unlinked = b.byState.unlinked.micros;
  const data: Json = {
    from: step.from,
    to: step.to,
    totalMicros: b.totalMicros,
    byState: Object.fromEntries(Object.entries(b.byState).map(([k, v]) => [k, { sessions: v.sessions, micros: v.micros }])),
    lowConfidenceMicros: b.lowConfidenceMicros,
    landedStates: [...landedStates],
    definition: def ? { source: def.source, memoryIds: def.memoryIds, learnedAt: def.learnedAt, unreadable: def.unreadable } : { source: "memory_off" },
  };
  if (b.totalMicros === 0) return { ...emptyRange(ctx, step.from, step.to, "priced model calls"), data };
  const claims: Rendered[] = [];
  const meta: ClaimMeta[] = [];
  const add = (r: Rendered, m: ClaimMeta): void => {
    claims.push(r);
    meta.push(m);
  };
  add(say`Estimated list-price spend between ${date(step.from)} and ${date(step.to)} was ${usd(b.totalMicros)}, an estimate from logged tokens and not a bill.`, num(usd(b.totalMicros), "estimated"));
  add(say`Spend on sessions whose work counts as landed (${word(describeLanded(landedStates))}) was ${usd(landed)}.`, num(usd(landed), "estimated"));
  add(say`Landed work was ${pct((landed / b.totalMicros) * 100)} of the spend in this period.`, num(pct((landed / b.totalMicros) * 100), "computed"));
  if (reverted > 0) add(say`Spend on sessions whose commits were reverted was ${usd(reverted)}.`, num(usd(reverted), "estimated"));
  if (linkedNotLanded > 0) add(say`Spend on sessions with commits that do not yet count as landed under this definition was ${usd(linkedNotLanded)}.`, num(usd(linkedNotLanded), "estimated"));
  add(say`Spend on sessions with no commit tied to them was ${usd(unlinked)}; that is unknown, not waste.`, num(usd(unlinked), "estimated"));
  if (b.lowConfidenceMicros > 0) add(say`Of the linked spend, ${usd(b.lowConfidenceMicros)} rests only on weak evidence and is not counted as landed.`, num(usd(b.lowConfidenceMicros), "estimated"));
  if (!def) add(say`Owner memory is off, so landed uses the default (merged or kept).`, fact);
  else if (def.source === "memory") add(say`Landed follows your note ${entity(def.memoryIds[0])} recorded on ${date(def.learnedAt ?? "")}.`, fact);
  else if (def.source === "conflict") add(say`Your notes ${entity(def.memoryIds[0])} and ${entity(def.memoryIds[1])} define landed differently, so the default (merged or kept) was used until one is replaced by a correction.`, fact);
  else add(say`No note of yours sets a definition, so landed uses the default (merged or kept).`, fact);
  return { data, rowCount: 1, claims, meta };
}

function compare(step: Extract<Step, { op: "compare" }>, ctx: RunContext): Outcome {
  const a = ctx.results.get(step.a);
  const b = ctx.results.get(step.b);
  const microsOf = (r: StepResult | undefined): number | null => {
    const d = r?.data as { totalMicros?: number } | null | undefined;
    return r && !r.unknowable && !r.error && d && typeof d.totalMicros === "number" ? d.totalMicros : null;
  };
  const ma = microsOf(a);
  const mb = microsOf(b);
  if (ma === null || mb === null) {
    const r = say`The two periods cannot be compared because one of them has no priced calls.`;
    return { data: { a: step.a, b: step.b, comparable: false }, rowCount: 0, claims: [r], meta: [fact], unknowable: r.text };
  }
  const diff = mb - ma;
  const data: Json = { a: step.a, b: step.b, firstMicros: ma, secondMicros: mb, differenceMicros: diff, comparable: true };
  const claims: Rendered[] = [];
  const meta: ClaimMeta[] = [];
  if (diff === 0) {
    claims.push(say`Both periods cost ${usd(ma)}.`);
    meta.push(num(usd(ma), "estimated"));
  } else {
    claims.push(say`The second period cost ${usd(Math.abs(diff))} ${word(diff > 0 ? "more" : "less")} than the first.`);
    meta.push(num(usd(Math.abs(diff)), "computed"));
  }
  if (ma > 0 && diff !== 0) {
    const p = (mb / ma) * 100;
    claims.push(say`The second period was ${pct(p)} of the first.`);
    meta.push(num(pct(p), "computed"));
  }
  return { data, rowCount: 1, claims, meta };
}

/* ------------------------------------------------------------------ historian (World Model) */

const KIND_NOUN = { model: "Model", tool_version: "Tool version", plan: "Plan setting" } as const;

function changesBefore(step: Extract<Step, { op: "changes_before" }>, ctx: RunContext): Outcome {
  const w = ctx.engines.world;
  if (!w) {
    const r = say`No entity history is available, so what changed before ${date(step.date)} is unknowable.`;
    return { data: { date: step.date, days: step.days, history: false }, rowCount: 0, claims: [r], meta: [fact], unknowable: r.text };
  }
  const q = queryChangesBefore(w, step.date, step.days);
  const data: Json = {
    date: q.date,
    days: q.days,
    windowStart: q.windowStart,
    ledgerStart: q.ledgerStart,
    ledgerEnd: q.ledgerEnd,
    changed: q.changed.map((c) => ({ day: c.day, kind: c.kind, entityKind: c.entityKind, label: c.label, detail: c.detail as Json })),
    unchanged: q.unchanged.map((u) => ({ entityKind: u.entityKind, label: u.label, since: u.since })),
  };
  if (q.beforeLedger || q.afterLedger) {
    const r = q.beforeLedger
      ? say`The date ${date(step.date)} is not after the first day the ledger covers (${date(q.ledgerStart)}), so no history exists before it.`
      : say`The date ${date(step.date)} is after the last day the ledger covers (${date(q.ledgerEnd)}), so changes before it are not known.`;
    return { data, rowCount: 0, claims: [r], meta: [fact], unknowable: r.text };
  }
  const claims: Rendered[] = [];
  const meta: ClaimMeta[] = [];
  const add = (r: Rendered, m: ClaimMeta): void => {
    claims.push(r);
    meta.push(m);
  };
  if (q.changed.length === 0) {
    add(say`No change to models, tool versions or plan settings was recorded between ${date(q.windowStart)} and ${date(step.date)}.`, fact);
  } else {
    add(say`${count(q.changed.length)} changes were recorded between ${date(q.windowStart)} and ${date(step.date)}.`, num(count(q.changed.length), "computed"));
    for (const c of q.changed.slice(0, 8)) {
      const e = entity(c.label);
      const noun = word(KIND_NOUN[c.entityKind]);
      if (c.kind === "model_first_seen" || c.kind === "tool_version_first_seen" || c.kind === "plan_first_seen") add(say`${noun} ${e} first appeared on ${date(c.day)}.`, fact);
      else if (c.kind === "model_last_seen" || c.kind === "plan_last_seen") add(say`${noun} ${e} was last used on ${date(String(c.detail["lastDay"]))}.`, fact);
      else {
        add(say`Model ${e} made up ${pct(Number(c.detail["to"]))} of calls in the week starting ${date(c.day)}.`, num(pct(Number(c.detail["to"])), "computed"));
        add(say`In the week before that, model ${e} made up ${pct(Number(c.detail["from"]))} of calls.`, num(pct(Number(c.detail["from"])), "computed"));
      }
    }
    if (q.changed.length > 8) add(say`${count(q.changed.length - 8)} further changes in that window are not listed.`, num(count(q.changed.length - 8), "computed"));
  }
  const quota = { model: 3, tool_version: 2, plan: 2 } as const;
  for (const kind of ["model", "tool_version", "plan"] as const) {
    for (const u of q.unchanged.filter((x) => x.entityKind === kind).slice(0, quota[kind])) {
      add(say`${word(KIND_NOUN[kind])} ${entity(u.label)} was in use throughout the window and stayed as it was.`, fact);
    }
  }
  return { data, rowCount: q.changed.length, claims, meta };
}

/* ------------------------------------------------------------------ range reader (Markovian) */

function rangeDigestStep(step: Extract<Step, { op: "range_digest" }>, ctx: RunContext): Promise<Outcome> | Outcome {
  const span = daysBetween(step.from, step.to) + 1;
  if (ctx.engines.markovian) return digestWithEngine(step, ctx, span);
  return digestDirect(step, ctx, span);
}

async function digestWithEngine(step: Extract<Step, { op: "range_digest" }>, ctx: RunContext, span: number): Promise<Outcome> {
  const d = await digestRange(ctx.db, step.from, step.to);
  const data: Json = { ...(d as unknown as Record<string, Json>), engine: "markovian", span };
  if (d.totalCalls === 0) return { ...emptyRange(ctx, step.from, step.to, "model calls"), data };
  const claims: Rendered[] = [];
  const meta: ClaimMeta[] = [];
  const add = (r: Rendered, m: ClaimMeta): void => {
    claims.push(r);
    meta.push(m);
  };
  add(say`Estimated list-price spend between ${date(step.from)} and ${date(step.to)} was ${usd(d.totalMicros)}, an estimate from logged tokens and not a bill.`, num(usd(d.totalMicros), "estimated"));
  add(say`The whole range was read in ${count(d.periods)} periods.`, num(count(d.periods), "computed"));
  add(say`Each period covered ${count(d.bucketDays)} days.`, num(count(d.bucketDays), "computed"));
  if (d.peak) add(say`The costliest period started on ${date(d.peak.label)} and cost ${usd(d.peak.micros)}.`, num(usd(d.peak.micros), "estimated"));
  for (const m of d.topModels) add(say`Model ${entity(m.model)} cost ${usd(m.micros)} in the range.`, num(usd(m.micros), "estimated"));
  const third = Math.floor(d.series.length / 3);
  if (third >= 1) {
    const first = d.series.slice(0, third).reduce((a, b) => a + b, 0);
    const last = d.series.slice(d.series.length - third).reduce((a, b) => a + b, 0);
    if (first > 0) add(say`Spending in the last third of the range was ${pct((last / first) * 100)} of the first third.`, num(pct((last / first) * 100), "computed"));
  }
  if (d.unpricedCalls > 0) add(say`${count(d.unpricedCalls)} calls in the range were on models with no price and are not counted.`, num(count(d.unpricedCalls), "unpriced"));
  return { data, rowCount: d.periods, claims, meta };
}

/**
 * The same question with the engine off: periods are listed newest first as claims until the token budget
 * for claims is used up, and what does not fit is counted but not itemised. The peak, the top models and the
 * trend are not stated, because they cannot be stated over periods that were left out.
 */
function digestDirect(step: Extract<Step, { op: "range_digest" }>, ctx: RunContext, span: number): Outcome {
  const bucket = span <= 62 ? 1 : 7;
  const periods = loadPeriods(ctx.db, step.from, step.to, bucket);
  const totalMicros = periods.reduce((a, p) => a + p.micros, 0);
  const totalCalls = periods.reduce((a, p) => a + p.calls, 0);
  const data: Json = { engine: null, from: step.from, to: step.to, bucketDays: bucket, periods: periods.length, totalMicros, totalCalls, series: periods.map((p) => p.micros), span };
  if (totalCalls === 0) return { ...emptyRange(ctx, step.from, step.to, "model calls"), data };
  const claims: Rendered[] = [];
  const meta: ClaimMeta[] = [];
  const head = say`Estimated list-price spend between ${date(step.from)} and ${date(step.to)} was ${usd(totalMicros)}, an estimate from logged tokens and not a bill.`;
  claims.push(head);
  meta.push(num(usd(totalMicros), "estimated"));
  let used = tokensOf(head.text);
  const noun = bucket === 1 ? "day" : "week starting";
  let shown = 0;
  for (let i = periods.length - 1; i >= 0; i -= 1) {
    const p = periods[i] as (typeof periods)[number];
    const r = say`The ${word(noun)} ${date(p.label)} cost ${usd(p.micros)}.`;
    if (used + tokensOf(r.text) > ctx.claimTokenBudget) break;
    used += tokensOf(r.text);
    claims.push(r);
    meta.push(num(usd(p.micros), "estimated"));
    shown += 1;
  }
  const omitted = periods.length - shown;
  if (omitted > 0) {
    const omittedMicros = periods.slice(0, omitted).reduce((a, p) => a + p.micros, 0);
    claims.push(say`${count(omitted)} earlier periods are not itemised here because the answer ran out of room.`);
    meta.push(num(count(omitted), "computed"));
    claims.push(say`Together those earlier periods cost ${usd(omittedMicros)}.`);
    meta.push(num(usd(omittedMicros), "estimated"));
  }
  return { data: { ...(data as Record<string, Json>), itemised: shown, omitted }, rowCount: shown, claims, meta };
}

/* ------------------------------------------------------------------ memory (H-MEM) */

function recall(step: Extract<Step, { op: "recall" }>, ctx: RunContext): Outcome {
  const m = ctx.engines.memory;
  if (!m) {
    const r = say`Owner memory is off, so nothing you told the Desk before can be recalled.`;
    return { data: { query: step.query, memory: false }, rowCount: 0, claims: [r], meta: [fact], unknowable: r.text };
  }
  const found = m.recall(step.query);
  const data: Json = { query: step.query, memory: true, found: found.map((f) => ({ id: f.id, learnedAt: f.learnedAt, kind: f.kind, relevance: f.relevance, superseded: f.superseded, content: f.content })), fingerprint: hashJson(m.fingerprint()) };
  const evidence: Evidence[] = found.map((f) => ({ kind: "owner_note", id: f.id, learnedAt: f.learnedAt, content: f.content }));
  if (found.length === 0) {
    const r = say`No note of yours matches this question.`;
    return { data, rowCount: 0, claims: [r], meta: [fact], evidence, unknowable: r.text };
  }
  const claims: Rendered[] = [say`${count(found.length)} notes of yours match this question.`];
  const meta: ClaimMeta[] = [num(count(found.length), "computed")];
  for (const f of found) {
    claims.push(f.superseded ? say`Note ${entity(f.id)} (${word(f.kind.replace("_", " "))}, recorded on ${date(f.learnedAt)}) has since been replaced by a later note.` : say`Note ${entity(f.id)} (${word(f.kind.replace("_", " "))}) was recorded on ${date(f.learnedAt)}.`);
    meta.push(fact);
  }
  return { data, rowCount: found.length, claims, meta, evidence };
}

/** Used by tests and the CLI to see which days a window looks at. */
export function windowOf(date: string, days: number): { from: string; to: string } {
  return { from: addDays(date, -days), to: addDays(date, -1) };
}
