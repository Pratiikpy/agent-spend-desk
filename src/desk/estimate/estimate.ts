import type { Ledger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";
import { identify, type TaskMarker, type TaskMethod } from "../tasks/identity.ts";

/**
 * A cost range for a task you are about to start (DF-009), from what similar tasks cost before. It is a range with a sample
 * size, or it is nothing: with fewer than ten similar tasks there is no estimate, and there is never a point figure.
 *
 * Similar means, in order: the same type of task in the same repository, the same type anywhere, the same repository, any task.
 * The first of those with ten or more tasks is used, and what each earlier one had is shown. A task's type is the
 * part of its branch before the first slash (`fix/cart` is `fix`), a ticket's project key (`SHOP-142` is `shop`), the text before a
 * colon in a label you set (`fix: cart bug` is `fix`), else the label itself. Tasks come from `desk task` and the branch names the logs carry.
 *
 * Weighting: with more than five tasks, a task counts half as much for every 30 days it is old. The tail is kept: a very
 * costly task stays in, because trimming it would make the next one look cheaper than it can be.
 */
export const MIN_TASKS = 10;
export const HALF_LIFE_DAYS = 30;
const DAY = 86_400_000;

export interface PastTask {
  taskId: string;
  method: TaskMethod;
  label: string;
  projectPath: string | null;
  type: string;
  lastMs: number;
  micros: number;
}

export function taskType(method: TaskMethod, label: string): string {
  const l = label.trim();
  if (method === "branch") return (l.includes("/") ? l.slice(0, l.indexOf("/")) : "branch").toLowerCase();
  if (method === "ticket") return (l.split("-")[0] ?? l).toLowerCase();
  if (method === "pull_request") return "pull_request";
  if (method === "explicit") return (l.includes(":") ? l.slice(0, l.indexOf(":")) : l).trim().toLowerCase();
  return "session";
}

/**
 * Every task the ledger holds with what it cost. Tasks are worked out here from the sessions and the owner's labels, the same way
 * `assignTasks` works them out, so it reads a ledger it cannot write to and never depends on the task table being up to date.
 */
export function pastTasks(db: Ledger, markers: readonly TaskMarker[] = []): PastTask[] {
  const rows = db
    .prepare(
      `SELECT s.session_id id, s.project_path project, s.git_branch branch, s.started_at startedAt, MAX(m.ts) lastTs, SUM(c.total_micros) micros
       FROM session s JOIN model_call m ON m.session_id = s.session_id JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated' GROUP BY s.session_id HAVING micros > 0`,
    )
    .all() as unknown as { id: string; project: string | null; branch: string | null; startedAt: string | null; lastTs: string; micros: number }[];
  const byTask = new Map<string, PastTask>();
  for (const r of rows) {
    const id = identify({ sessionId: r.id, projectPath: r.project, gitBranch: r.branch, startedAt: r.startedAt }, markers);
    const last = Date.parse(r.lastTs);
    const t = byTask.get(id.taskId);
    if (t) {
      t.micros += r.micros;
      t.lastMs = Math.max(t.lastMs, last);
    } else byTask.set(id.taskId, { taskId: id.taskId, method: id.method, label: id.label, projectPath: r.project, type: taskType(id.method, id.label), lastMs: last, micros: r.micros });
  }
  return [...byTask.values()].sort((a, b) => a.lastMs - b.lastMs);
}

const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
export const inRepo = (t: PastTask, repo: string): boolean => t.projectPath !== null && (norm(t.projectPath) === norm(repo) || norm(t.projectPath).startsWith(`${norm(repo)}/`));

export interface Quantiles {
  p10: number;
  p50: number;
  p90: number;
}

/** Weighted quantile by cumulative weight: the smallest value whose cumulative weight reaches the fraction. */
export function weightedQuantile(sortedValues: readonly number[], weights: readonly number[], q: number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < sortedValues.length; i += 1) {
    acc += weights[i]!;
    if (acc >= q * total - 1e-9) return sortedValues[i]!;
  }
  return sortedValues[sortedValues.length - 1]!;
}

export function weightsFor(tasks: readonly PastTask[], nowMs: number): number[] {
  if (tasks.length <= 5) return tasks.map(() => 1);
  return tasks.map((t) => Math.pow(0.5, Math.max(0, nowMs - t.lastMs) / DAY / HALF_LIFE_DAYS));
}

export function quantiles(tasks: readonly PastTask[], nowMs: number): Quantiles {
  const order = [...tasks.keys()].sort((a, b) => tasks[a]!.micros - tasks[b]!.micros);
  const values = order.map((i) => tasks[i]!.micros);
  const w = weightsFor(tasks, nowMs);
  const weights = order.map((i) => w[i]!);
  return { p10: weightedQuantile(values, weights, 0.1), p50: weightedQuantile(values, weights, 0.5), p90: weightedQuantile(values, weights, 0.9) };
}

export interface Cohort {
  name: string;
  tasks: PastTask[];
}

export interface Scorecard {
  /** Tasks after the tenth in this cohort, each predicted only from the ones before it. */
  n: number;
  held: number;
}

export interface Estimate {
  type: string | null;
  repo: string | null;
  considered: { name: string; n: number }[];
  used: { name: string; n: number; firstMs: number; lastMs: number } | null;
  range: Quantiles | null;
  /** The weighted share of past tasks in the cohort that cost more than the cap, when a cap was given. */
  chanceOverCap: number | null;
  capMicros: number | null;
  scorecard: Scorecard | null;
  reason: string | null;
}

/**
 * How well the range has done in this cohort: walk its tasks in time order and, for each from the eleventh on, ask whether
 * its real cost fell between the 10th and 90th percentile computed only from the tasks before it. It should hold for about 80%.
 */
export function scorecardOf(tasks: readonly PastTask[], nowMs: number): Scorecard | null {
  if (tasks.length <= MIN_TASKS) return null;
  let held = 0;
  let n = 0;
  for (let i = MIN_TASKS; i < tasks.length; i += 1) {
    const q = quantiles(tasks.slice(0, i), Math.min(nowMs, tasks[i]!.lastMs));
    n += 1;
    if (tasks[i]!.micros >= q.p10 && tasks[i]!.micros <= q.p90) held += 1;
  }
  return { n, held };
}

export function estimateTask(tasks: readonly PastTask[], o: { type?: string; repo?: string; capMicros?: number; nowMs: number }): Estimate {
  const type = o.type?.trim().toLowerCase() || null;
  const repo = o.repo?.trim() || null;
  const chain: Cohort[] = [];
  if (type && repo) chain.push({ name: `type "${type}" in this repository`, tasks: tasks.filter((t) => t.type === type && inRepo(t, repo)) });
  if (type) chain.push({ name: `type "${type}" anywhere`, tasks: tasks.filter((t) => t.type === type) });
  if (repo) chain.push({ name: "any type in this repository", tasks: tasks.filter((t) => inRepo(t, repo)) });
  chain.push({ name: "any task", tasks: [...tasks] });
  const considered = chain.map((c) => ({ name: c.name, n: c.tasks.length }));
  const pick = chain.find((c) => c.tasks.length >= MIN_TASKS);
  if (!pick) {
    const most = Math.max(...considered.map((c) => c.n));
    return { type, repo, considered, used: null, range: null, chanceOverCap: null, capMicros: o.capMicros ?? null, scorecard: null, reason: `no estimate: fewer than ${MIN_TASKS} similar tasks (the most any comparison had is ${most})` };
  }
  const range = quantiles(pick.tasks, o.nowMs);
  let chance: number | null = null;
  if (o.capMicros !== undefined) {
    const w = weightsFor(pick.tasks, o.nowMs);
    const total = w.reduce((a, b) => a + b, 0);
    chance = pick.tasks.reduce((s, t, i) => s + (t.micros > o.capMicros! ? w[i]! : 0), 0) / total;
  }
  return {
    type, repo, considered,
    used: { name: pick.name, n: pick.tasks.length, firstMs: pick.tasks[0]!.lastMs, lastMs: pick.tasks[pick.tasks.length - 1]!.lastMs },
    range, chanceOverCap: chance, capMicros: o.capMicros ?? null, scorecard: scorecardOf(pick.tasks, o.nowMs), reason: null,
  };
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function renderEstimate(e: Estimate): string {
  const what = [e.type ? `type "${e.type}"` : null, e.repo ? "this repository" : null].filter(Boolean).join(", ") || "any task";
  const out: string[] = [`Estimate for a task (${what}), from what similar tasks cost before:`];
  for (const c of e.considered) out.push(`  ${c.name}: ${c.n} task${c.n === 1 ? "" : "s"}${e.used?.name === c.name ? "  <- used" : ""}`);
  if (e.range === null || e.used === null) {
    out.push("", `${e.reason ?? "no estimate"}. A range from fewer tasks would be a guess; nothing is shown in its place.`);
    return out.join("\n");
  }
  out.push("", `  Likely between ${formatUsd(e.range.p10)} and ${formatUsd(e.range.p90)}; the middle is ${formatUsd(e.range.p50)}.`);
  out.push(`  That is the 10th to the 90th percentile of ${e.used.n} tasks finished ${day(e.used.firstMs)} to ${day(e.used.lastMs)}. One task in ten has cost more than the top of it, and the top of the range is not a ceiling.`);
  if (e.capMicros !== null && e.chanceOverCap !== null) out.push(`  Against the cap of ${formatUsd(e.capMicros)}: ${Math.round(e.chanceOverCap * 100)}% of those tasks cost more than that.`);
  if (e.scorecard) out.push(`  Scorecard: this kind of range held the real cost in ${e.scorecard.held} of ${e.scorecard.n} later tasks (${Math.round((100 * e.scorecard.held) / e.scorecard.n)}%; about 80% is what it is meant to hold). ${e.scorecard.n < 20 ? "That is a small sample." : ""}`.trimEnd());
  else out.push("  Scorecard: too few tasks to test how often this kind of range has held.");
  out.push("  Tasks are the sessions that share a label, a ticket, a pull request or a branch; their cost is the list-price estimate.");
  return out.join("\n");
}

/** The estimate as plain data, for the MCP tool: a range with its sample size, or the reason there is none. Money is in micro-dollars. */
export function estimateToJson(e: Estimate): Record<string, unknown> {
  return {
    estimate: e.range === null ? null : { p10Micros: e.range.p10, p50Micros: e.range.p50, p90Micros: e.range.p90 },
    basedOn: e.used === null ? null : { cohort: e.used.name, tasks: e.used.n, firstFinished: new Date(e.used.firstMs).toISOString(), lastFinished: new Date(e.used.lastMs).toISOString() },
    considered: e.considered,
    chanceOverCap: e.chanceOverCap,
    scorecard: e.scorecard,
    reason: e.reason,
    note: "A range from similar past tasks. The top of it is not a ceiling: one task in ten costs more.",
  };
}
