import { analyseCalls, buildAutopsy } from "../autopsy/engine.ts";
import { loadAutopsyCalls } from "../autopsy/load.ts";
import { buildCard } from "../card/build.ts";
import { MIN_TASKS, pastTasks, scorecardOf, type Scorecard } from "../estimate/estimate.ts";
import type { Ledger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";
import { landingBreakdown } from "../outcomes/breakdown.ts";
import { openQuestions } from "../outcomes/questions.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { taskType } from "../estimate/estimate.ts";
import { renderHabit, type ApprovalHabit } from "../approvals/habit.ts";
import { identify, type TaskMarker, type TaskMethod } from "../tasks/identity.ts";

/**
 * The weekly review (DF-011): one page for one ISO week (Monday to Sunday, UTC) that says where the money went, what it
 * bought, how the ledger's own forecasts did, what is in doubt, what drifted, and at most three changes worth making, each
 * with the evidence the Desk has for it. A suggestion appears only when a rule can show its saving in the owner's own
 * calls; with fewer than seven days of data the page says so and still shows what it has.
 */
const DAY = 86_400_000;

export interface WeekRange {
  label: string;
  startMs: number;
  /** Exclusive end: the next Monday 00:00 UTC. */
  endMs: number;
}

/** The ISO week a date falls in, as year and week number. */
export function isoWeekOf(ms: number): { year: number; week: number } {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday is 0
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3);
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const week1Monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  return { year, week: Math.floor((Math.floor(thursday / DAY) * DAY - week1Monday) / (7 * DAY)) + 1 };
}

export function weekLabel(startMs: number): string {
  const { year, week } = isoWeekOf(startMs);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The week named `YYYY-Www`, or the last complete week before `nowMs` when none is named. */
export function weekRange(label: string | undefined, nowMs: number): WeekRange {
  if (label !== undefined) {
    const m = /^(\d{4})-W(\d{2})$/.exec(label);
    if (!m) throw new Error('--week must look like 2026-W43 (an ISO week: Monday to Sunday, UTC)');
    const year = Number(m[1]);
    const week = Number(m[2]);
    if (week < 1 || week > 53) throw new Error("--week: an ISO week number is 1 to 53");
    const jan4 = Date.UTC(year, 0, 4);
    const start = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY + (week - 1) * 7 * DAY;
    if (weekLabel(start) !== label) throw new Error(`--week: ${year} has no week ${week}`);
    return { label, startMs: start, endMs: start + 7 * DAY };
  }
  const today = new Date(nowMs);
  const monday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const start = monday - 7 * DAY;
  return { label: weekLabel(start), startMs: start, endMs: monday };
}

export interface WorkflowRow {
  type: string;
  tasks: number;
  spendMicros: number;
  landedMicros: number;
  unlinkedMicros: number;
}

export interface TrendPoint {
  label: string;
  spendMicros: number;
  landedMicros: number;
  landedTasks: number;
  costPerLandedTaskMicros: number | null;
}

export interface DriftEvent {
  kind: "model_share" | "new_model" | "tool_version" | "unpriced_model";
  text: string;
}

export interface Suggestion {
  cause: string;
  text: string;
  basis: "own_history" | "heuristic_estimate";
  windowMicros: number;
  addressableMicros: number;
  interval: { lowMicros: number; highMicros: number } | null;
  note: string;
}

export type { ApprovalHabit };

export interface WeeklyReview {
  week: WeekRange;
  daysWithData: number;
  enoughData: boolean;
  spend: { micros: number; calls: number; unpricedCalls: number; previousMicros: number | null };
  landing: { landedMicros: number; committedMicros: number; revertedMicros: number; unlinkedMicros: number; lowConfidenceMicros: number };
  wasteShare: number | null;
  workflows: WorkflowRow[];
  trend: TrendPoint[];
  forecast: Scorecard | null;
  calibration: string;
  questions: { open: number; costliest: { id: string; spendMicros: number }[] };
  drift: DriftEvent[];
  approvals: ApprovalHabit | null;
  suggestions: Suggestion[];
  notes: string[];
}

interface Span {
  since: string;
  until: string;
}

const span = (r: { startMs: number; endMs: number }): Span => ({ since: new Date(r.startMs).toISOString(), until: new Date(r.endMs - 1).toISOString() });

function weekSpend(db: Ledger, s: Span): number {
  return (db.prepare("SELECT COALESCE(SUM(c.total_micros), 0) n FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated' WHERE m.ts >= ? AND m.ts <= ?").get(s.since, s.until) as { n: number }).n;
}

export interface ReviewInputs {
  db: Ledger;
  snapshot: PriceSnapshot;
  range: WeekRange;
  approvals?: ApprovalHabit | null;
  /** The owner's task labels, so that a labelled stretch of work is one task. */
  markers?: readonly TaskMarker[];
}

export function buildReview(i: ReviewInputs): WeeklyReview {
  const { db, snapshot, range } = i;
  const s = span(range);
  const notes: string[] = [];

  const days = (db.prepare("SELECT COUNT(DISTINCT substr(m.ts, 1, 10)) n FROM model_call m WHERE m.ts >= ? AND m.ts <= ?").get(s.since, s.until) as { n: number }).n;
  const totals = db.prepare("SELECT COUNT(*) calls, SUM(CASE WHEN c.class = 'unpriced' THEN 1 ELSE 0 END) unpriced, COALESCE(SUM(c.total_micros), 0) micros FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE m.ts >= ? AND m.ts <= ?").get(s.since, s.until) as { calls: number; unpriced: number | null; micros: number };
  const prevRange = { startMs: range.startMs - 7 * DAY, endMs: range.startMs };
  const previous = weekSpend(db, span(prevRange));
  const earliest = (db.prepare("SELECT MIN(ts) t FROM model_call").get() as { t: string | null }).t;
  const hadPrevious = earliest !== null && Date.parse(earliest) < range.startMs;
  const enough = days >= 7;
  if (totals.calls === 0) notes.push(`No call in ${range.label}.`);
  else if (!enough) notes.push(`Only ${days} of the 7 days in ${range.label} have any call, so the totals are for part of a week and the comparison with the week before is not like for like.`);

  const landing = landingBreakdown(db, s.since, s.until);
  const landed = landing.byState.kept.micros + landing.byState.merged.micros;

  // Autopsy of the week: the waste a rule can see without judgement.
  const calls = loadAutopsyCalls(db, snapshot, s.since, s.until);
  let wasteShare: number | null = null;
  if (calls.length > 0) {
    const a = buildAutopsy(calls, range.startMs, range.endMs, analyseCalls(calls));
    if (a.totalMicros > 0) wasteShare = (a.causes.idle.micros + a.causes.loops.micros + a.causes.cache_misses.micros) / a.totalMicros;
  }

  // The task of every session, worked out from the sessions and the owner's labels the way `desk task list` does, so a ledger that was not written to recently still has them.
  const taskOf = new Map<string, { id: string; method: TaskMethod; label: string }>();
  for (const x of db.prepare("SELECT session_id id, project_path project, git_branch branch, started_at startedAt FROM session").all() as unknown as { id: string; project: string | null; branch: string | null; startedAt: string | null }[]) {
    const t = identify({ sessionId: x.id, projectPath: x.project, gitBranch: x.branch, startedAt: x.startedAt }, i.markers ?? []);
    taskOf.set(x.id, { id: t.taskId, method: t.method, label: t.label });
  }

  // By workflow (task type): what each kind of work cost and how much of it landed.
  const sessionRows = db
    .prepare(
      `SELECT m.session_id session, COALESCE(o.state, 'unlinked') state, SUM(c.total_micros) micros
       FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated' LEFT JOIN session_outcome o ON o.session_id = m.session_id
       WHERE m.ts >= ? AND m.ts <= ? GROUP BY m.session_id`,
    )
    .all(s.since, s.until) as unknown as { session: string; state: string; micros: number }[];
  const taskRows = sessionRows.flatMap((r) => {
    const t = taskOf.get(r.session);
    return t ? [{ id: t.id, method: t.method, label: t.label, state: r.state, micros: r.micros }] : [];
  });
  const wf = new Map<string, { tasks: Set<string>; spend: number; landed: number; unlinked: number }>();
  for (const r of taskRows) {
    const type = taskType(r.method, r.label);
    const w = wf.get(type) ?? { tasks: new Set<string>(), spend: 0, landed: 0, unlinked: 0 };
    w.tasks.add(r.id);
    w.spend += r.micros;
    if (r.state === "kept" || r.state === "merged") w.landed += r.micros;
    if (r.state === "unlinked") w.unlinked += r.micros;
    wf.set(type, w);
  }
  const workflows = [...wf.entries()].map(([type, w]) => ({ type, tasks: w.tasks.size, spendMicros: w.spend, landedMicros: w.landed, unlinkedMicros: w.unlinked })).sort((a, b) => b.spendMicros - a.spendMicros);

  // The last four weeks: spend, landed spend, and what each landed task cost.
  const trend: TrendPoint[] = [];
  for (let k = 3; k >= 0; k -= 1) {
    const r = { startMs: range.startMs - k * 7 * DAY, endMs: range.endMs - k * 7 * DAY };
    const ws = span(r);
    const b = landingBreakdown(db, ws.since, ws.until);
    const lm = b.byState.kept.micros + b.byState.merged.micros;
    const landedSessions = db
      .prepare("SELECT DISTINCT m.session_id session FROM model_call m JOIN session_outcome o ON o.session_id = m.session_id AND o.state IN ('kept', 'merged') WHERE m.ts >= ? AND m.ts <= ?")
      .all(ws.since, ws.until) as unknown as { session: string }[];
    const landedTasks = new Set(landedSessions.flatMap((x) => (taskOf.has(x.session) ? [taskOf.get(x.session)!.id] : []))).size;
    trend.push({ label: weekLabel(r.startMs), spendMicros: b.totalMicros, landedMicros: lm, landedTasks, costPerLandedTaskMicros: landedTasks === 0 ? null : Math.round(lm / landedTasks) });
  }

  // The forecast scorecard: how the pre-run estimate's range has done over every task the ledger holds.
  const tasks = pastTasks(db, i.markers ?? []);
  const forecast = tasks.length > MIN_TASKS ? scorecardOf(tasks, range.endMs) : null;

  const qs = openQuestions(db, 100_000);
  const drift = driftEvents(db, snapshot, range);

  // Suggestions: only where a rule shows its saving in this week's own calls.
  const suggestions: Suggestion[] = [];
  if (calls.length > 0) {
    const card = buildCard({ calls, mode: "own_logs", hours: 5, days: 7, ingest: { malformedLines: 0, truncatedTails: 0, usageConflicts: 0, logFilesFound: 1, searchedPaths: [] }, landingKnown: landing.byState.unlinked.micros < landing.totalMicros });
    if (!("empty" in card)) {
      for (const f of card.fixes.slice(0, 3)) suggestions.push({ cause: f.cause, text: f.fix, basis: f.basis, windowMicros: f.windowMicros, addressableMicros: f.addressableMicros, interval: f.interval, note: f.note });
    }
  }

  return {
    week: range,
    daysWithData: days,
    enoughData: enough,
    spend: { micros: totals.micros, calls: totals.calls, unpricedCalls: totals.unpriced ?? 0, previousMicros: hadPrevious ? previous : null },
    landing: {
      landedMicros: landed,
      committedMicros: landing.byState.committed.micros,
      revertedMicros: landing.byState.reverted.micros,
      unlinkedMicros: landing.byState.unlinked.micros,
      lowConfidenceMicros: landing.lowConfidenceMicros,
    },
    wasteShare,
    workflows,
    trend,
    forecast,
    calibration: "Rule thresholds are not calibrated on your own history yet (they are the defaults the autopsy ships with); see the threshold check when it exists.",
    questions: { open: qs.length, costliest: qs.slice(0, 3).map((q) => ({ id: q.id, spendMicros: q.spendMicros })) },
    drift,
    approvals: i.approvals ?? null,
    suggestions,
    notes,
  };
}

/** What changed against the week before: the models spend moved to, new models, new tool versions, models with no price. */
function driftEvents(db: Ledger, _snapshot: PriceSnapshot, range: WeekRange): DriftEvent[] {
  const out: DriftEvent[] = [];
  const share = (r: { startMs: number; endMs: number }): Map<string, number> => {
    const s = span(r);
    const rows = db.prepare("SELECT m.model model, SUM(c.total_micros) micros FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated' WHERE m.ts >= ? AND m.ts <= ? GROUP BY m.model").all(s.since, s.until) as unknown as { model: string; micros: number }[];
    const total = rows.reduce((a, b) => a + b.micros, 0);
    return new Map(rows.map((r2) => [r2.model, total === 0 ? 0 : r2.micros / total]));
  };
  const now = share(range);
  const before = share({ startMs: range.startMs - 7 * DAY, endMs: range.startMs });
  const hadBefore = before.size > 0;
  // Every model either week had: one that appeared, one that vanished and one whose share moved by 15 points or more.
  for (const model of new Set([...now.keys(), ...before.keys()])) {
    const v = now.get(model) ?? 0;
    const b = before.get(model) ?? 0;
    if (hadBefore && b === 0 && v >= 0.02) out.push({ kind: "new_model", text: `${model} is new this week and took ${Math.round(v * 100)}% of the spend.` });
    else if (hadBefore && Math.abs(v - b) >= 0.15) out.push({ kind: "model_share", text: `${model} went from ${Math.round(b * 100)}% to ${Math.round(v * 100)}% of the spend.` });
  }
  const s = span(range);
  const versions = db
    .prepare(
      `SELECT DISTINCT s.tool_version v FROM session s JOIN model_call m ON m.session_id = s.session_id WHERE m.ts >= ? AND m.ts <= ? AND s.tool_version IS NOT NULL
       AND s.tool_version NOT IN (SELECT DISTINCT s2.tool_version FROM session s2 JOIN model_call m2 ON m2.session_id = s2.session_id WHERE m2.ts < ? AND s2.tool_version IS NOT NULL)`,
    )
    .all(s.since, s.until, s.since) as unknown as { v: string }[];
  if (hadBefore) for (const v of versions) out.push({ kind: "tool_version", text: `A tool version first seen this week: ${v.v}.` });
  const unpriced = db.prepare("SELECT m.model model, COUNT(*) n FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'unpriced' WHERE m.ts >= ? AND m.ts <= ? GROUP BY m.model ORDER BY n DESC LIMIT 3").all(s.since, s.until) as unknown as { model: string; n: number }[];
  for (const u of unpriced) out.push({ kind: "unpriced_model", text: `${u.model} has no price in the price book (${u.n} calls): its dollars are not in any total.` });
  return out;
}

const usd = formatUsd;
const sgn = (m: number): string => `${m < 0 ? "-" : "+"}${usd(Math.abs(m))}`;
const dayName = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function renderReview(r: WeeklyReview, markdown = false): string {
  const h = (t: string): string => (markdown ? `\n## ${t}\n` : `\n${t}`);
  const out: string[] = [];
  out.push(markdown ? `# Week ${r.week.label}` : `Week ${r.week.label}  (${dayName(r.week.startMs)} to ${dayName(r.week.endMs - 1)}, UTC)`);
  for (const n of r.notes) out.push(markdown ? `> ${n}` : `  Note: ${n}`);
  const change = r.spend.previousMicros === null || r.spend.previousMicros === 0 ? "" : ` (the week before: ${usd(r.spend.previousMicros)}, ${sgn(r.spend.micros - r.spend.previousMicros)})`;
  out.push(`Spend ${usd(r.spend.micros)} over ${r.spend.calls.toLocaleString("en-US")} calls on ${r.daysWithData} day${r.daysWithData === 1 ? "" : "s"}${change}${r.spend.unpricedCalls > 0 ? `; ${r.spend.unpricedCalls} calls have no price and are not in it` : ""}.`);

  out.push(h("What it bought"));
  const l = r.landing;
  out.push(`  Landed (merged or kept): ${usd(l.landedMicros)}. Committed only: ${usd(l.committedMicros)}. Reverted: ${usd(l.revertedMicros)}. Not tied to any commit: ${usd(l.unlinkedMicros)}${l.lowConfidenceMicros > 0 ? `, of which ${usd(l.lowConfidenceMicros)} rests on a weak link that is not counted` : ""}. Unlinked is unknown, not waste.`);
  if (r.wasteShare !== null) out.push(`  Waste a rule can see without judgement (idle, loops, cache misses): ${Math.round(r.wasteShare * 100)}% of the week's spend.`);

  out.push(h("By workflow"));
  if (r.workflows.length === 0) out.push("  No tasks in this week.");
  for (const w of r.workflows.slice(0, 8)) out.push(`  ${w.type.padEnd(16)} ${String(w.tasks).padStart(4)} tasks  ${usd(w.spendMicros).padStart(10)}  landed ${usd(w.landedMicros).padStart(10)}  not tied ${usd(w.unlinkedMicros).padStart(10)}`);

  out.push(h("Cost per landed task, the last four weeks"));
  for (const t of r.trend) out.push(`  ${t.label}  spend ${usd(t.spendMicros).padStart(10)}  landed ${usd(t.landedMicros).padStart(10)}  ${t.costPerLandedTaskMicros === null ? "no task landed".padStart(22) : `${t.landedTasks} task${t.landedTasks === 1 ? "" : "s"}, ${usd(t.costPerLandedTaskMicros)} each`}`);

  out.push(h("How the forecasts did"));
  out.push(r.forecast ? `  The pre-run estimate's range held the real cost of ${r.forecast.held} of ${r.forecast.n} later tasks (${Math.round((100 * r.forecast.held) / r.forecast.n)}%; it aims at 80%).` : `  Not enough tasks to test the estimate yet (it needs more than ${MIN_TASKS}).`);
  out.push(`  ${r.calibration}`);

  out.push(h("In doubt"));
  out.push(r.questions.open === 0 ? "  No open question." : `  ${r.questions.open} open question${r.questions.open === 1 ? "" : "s"} about which session a commit came from (desk questions); the costliest session is ${usd(r.questions.costliest[0]!.spendMicros)}.`);

  out.push(h("What changed"));
  if (r.drift.length === 0) out.push("  Nothing moved against the week before.");
  for (const d of r.drift) out.push(`  ${d.text}`);

  out.push(h("Approvals"));
  if (r.approvals === null) out.push("  Not read: no approval record exists yet (desk approvals), or the gate was not named.");
  else out.push(...renderHabit(r.approvals, "in the week").map((l) => `  ${l}`));

  out.push(h("Changes worth making (at most three)"));
  if (r.suggestions.length === 0) out.push("  None: no rule shows a saving in this week's calls.");
  r.suggestions.forEach((s, i) => {
    out.push(`  ${i + 1}. ${s.text}`);
    out.push(`     This cost ${usd(s.windowMicros)} this week; the part a change could avoid is ${usd(s.addressableMicros)}${s.interval ? ` (usually between ${usd(s.interval.lowMicros)} and ${usd(s.interval.highMicros)} a window in your own history)` : s.basis === "heuristic_estimate" ? " at most (an upper bound: the logs cannot say how much is avoidable)" : ""}. ${s.note}`);
  });
  if (!r.enoughData) out.push("\nThis is part of a week: judge the suggestions with that in mind.");
  return out.join("\n");
}
