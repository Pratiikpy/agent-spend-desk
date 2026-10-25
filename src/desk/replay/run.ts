import { createHash } from "node:crypto";

import type { ModelPort, ModelRequest, ModelResponse } from "../agents/model.ts";
import type { CaptureDb } from "../capture/store.ts";
import type { TestPlan } from "../capture/runner.ts";
import { getTask, type TaskRow } from "../capture/tasks.ts";
import { runItem, DEFAULT_ITEM_LIMITS, type ItemLimits, type ItemResult, type ItemStatus, type Route, type TaskForReplay } from "./agent.ts";
import { reportSwap, SWAP_PARAMS, type SwapReport, type TaskMeta } from "./report.ts";

/**
 * A swap: two routes run on the same tasks, in the same order, a task at a time, so that a run stopped early holds whole tasks (DF-042). Every item is written to the store as it
 * finishes, so a run that is stopped, or stops at a cap, can be started again and makes only the items it lacks. Caps are enforced in code: a limit on live model calls and a limit
 * on estimated spend, each checked before an item starts; an item that has started is allowed to finish. A run that stops at a cap reports a partial cohort as partial.
 */
export interface SwapRoute extends Route {
  port: ModelPort;
  /** US dollars per million tokens in and out. Without it the report counts tokens only; a free tier's price is not guessed. */
  price?: { inPerM: number; outPerM: number };
}

export interface SwapOptions {
  store: CaptureDb;
  tasks: readonly TaskRow[];
  baseline: SwapRoute;
  candidate: SwapRoute;
  repeats: number;
  limits?: Partial<ItemLimits>;
  /** Stop starting items once this many model calls have gone to a live endpoint (a recorded reply is not a live call). */
  maxLiveCalls?: number;
  budgetUsd?: number;
  concurrency?: number;
  suiteId?: string;
  /** Resume this run: items already stored are kept, and the ones that errored or were not run are made. */
  runId?: string;
  onItem?: (r: ItemResult, done: number, planned: number) => void;
  now?: () => Date;
  margin?: number;
  gate?: number;
  resamples?: number;
  seed?: number;
}

export interface SwapResult {
  runId: string;
  report: SwapReport;
  items: ItemResult[];
  liveCalls: number;
  estimatedUsd: number | null;
}

const j = <T>(s: string | null, f: T): T => (s === null ? f : (JSON.parse(s) as T));

export function taskForReplay(t: TaskRow): TaskForReplay {
  const plan = j<{ preset: TestPlan["preset"]; command?: string | null; format?: TestPlan["format"] | null; timeoutMs?: number | null }>(t.plan_json, { preset: "node" });
  const extra = j<{ runnable?: string[]; overlay?: string[] }>(t.oracle_json, {});
  return {
    taskId: t.task_id,
    prompt: t.prompt,
    repoPath: t.repo_path,
    baseRef: t.base_ref as string,
    resultRef: t.result_ref as string,
    overlay: extra.overlay ?? j<string[]>(t.test_files_json, []),
    runnable: extra.runnable ?? j<string[]>(t.runnable_json, []),
    failToPass: j<string[]>(t.f2p_json, []),
    passToPass: j<string[]>(t.p2p_json, []).filter((x) => !x.startsWith("(and ")),
    flaky: j<string[]>(t.flaky_json, []),
    plan: { preset: plan.preset, ...(plan.command ? { command: plan.command } : {}), ...(plan.format ? { format: plan.format } : {}), ...(plan.timeoutMs ? { timeoutMs: plan.timeoutMs } : {}), depsFrom: t.repo_path },
    oracle: t.oracle === "strong" ? "strong" : "weak",
  };
}

class CountingPort implements ModelPort {
  live = 0;
  constructor(private readonly inner: ModelPort) {}
  async complete(request: ModelRequest, deadlineMs: number): Promise<ModelResponse> {
    const r = await this.inner.complete(request, deadlineMs);
    if (r.source === "live") this.live += 1;
    return r;
  }
}

const rowOf = (runId: string, r: ItemResult): unknown[] => [
  runId, r.taskId, r.route, r.repeat, r.status, r.failToPassPassed, r.failToPassTotal, r.passToPassPassed, r.passToPassTotal, r.turns, r.modelCalls, r.tokensIn, r.tokensOut, r.ms, r.tool.executed, r.tool.recording, r.tool.stub, r.tool.refused, r.tool.diverged,
  JSON.stringify(r.touched), r.divergence, r.error, r.stopped, r.servedModel, r.patch,
];

interface ItemRow {
  task_id: string;
  route: string;
  repeat: number;
  status: ItemStatus;
  fail_to_pass_passed: number;
  fail_to_pass_total: number;
  pass_to_pass_passed: number;
  pass_to_pass_total: number;
  turns: number;
  model_calls: number;
  tokens_in: number;
  tokens_out: number;
  ms: number;
  tool_executed: number;
  tool_served_from_recording: number;
  tool_stubbed: number;
  tool_refused: number;
  tool_diverged: number;
  touched_json: string;
  divergence: string | null;
  error: string | null;
  stopped: string | null;
  served_model: string | null;
  patch_text: string | null;
}

export function itemsOf(store: CaptureDb, runId: string): ItemResult[] {
  const rows = store.prepare("SELECT * FROM replay_item WHERE run_id = ? ORDER BY task_id, route, repeat").all(runId) as unknown as ItemRow[];
  return rows.map((r) => ({
    taskId: r.task_id, route: r.route, repeat: r.repeat, status: r.status, failToPassPassed: r.fail_to_pass_passed, failToPassTotal: r.fail_to_pass_total, passToPassPassed: r.pass_to_pass_passed, passToPassTotal: r.pass_to_pass_total,
    turns: r.turns, modelCalls: r.model_calls, tokensIn: r.tokens_in, tokensOut: r.tokens_out, ms: r.ms,
    tool: { executed: r.tool_executed, recording: r.tool_served_from_recording, stub: r.tool_stubbed, refused: r.tool_refused, diverged: r.tool_diverged },
    touched: j<string[]>(r.touched_json, []), divergence: r.divergence, error: r.error, servedModel: r.served_model, stopped: r.stopped, patch: r.patch_text ?? "",
  }));
}

export async function runSwap(o: SwapOptions): Promise<SwapResult> {
  if (o.baseline.name === o.candidate.name) throw new Error("the two routes need different names");
  const now = o.now ?? (() => new Date());
  const tasks = o.tasks.filter((t) => (t.status === "accepted" || t.status === "computed") && t.base_ref && t.result_ref && t.oracle && t.oracle !== "none");
  const metas: TaskMeta[] = tasks.map((t) => ({ taskId: t.task_id, kind: t.kind, area: t.area, oracle: t.oracle === "strong" ? "strong" : "weak" }));
  const planned = tasks.length * 2 * o.repeats;
  const params = { repeats: o.repeats, limits: { ...DEFAULT_ITEM_LIMITS, ...(o.limits ?? {}) }, maxLiveCalls: o.maxLiveCalls ?? null, budgetUsd: o.budgetUsd ?? null, margin: o.margin ?? SWAP_PARAMS.marginPoints, gate: o.gate ?? SWAP_PARAMS.reproductionGate, resamples: o.resamples ?? SWAP_PARAMS.resamples, seed: o.seed ?? SWAP_PARAMS.seed, tasks: tasks.map((t) => t.task_id), routes: { baseline: { name: o.baseline.name, model: o.baseline.model }, candidate: { name: o.candidate.name, model: o.candidate.model } } };
  const runId = o.runId ?? `run-${createHash("sha256").update(`${now().toISOString()}|${JSON.stringify(params)}`).digest("hex").slice(0, 10)}`;
  if (!o.runId) o.store.prepare("INSERT INTO replay_run (run_id, suite_id, created_at, baseline, candidate, params_json, status) VALUES (?, ?, ?, ?, ?, ?, 'running')").run(runId, o.suiteId ?? null, now().toISOString(), o.baseline.name, o.candidate.name, JSON.stringify(params));
  else if (!o.store.prepare("SELECT 1 FROM replay_run WHERE run_id = ?").get(runId)) throw new Error(`no run ${runId} to resume`);
  const have = new Map(itemsOf(o.store, runId).filter((i) => i.status !== "error").map((i) => [`${i.taskId}|${i.route}|${i.repeat}`, i]));
  const baseline = { ...o.baseline, port: new CountingPort(o.baseline.port) };
  const candidate = { ...o.candidate, port: new CountingPort(o.candidate.port) };
  const queue: { task: TaskRow; route: SwapRoute & { port: CountingPort }; repeat: number }[] = [];
  for (const t of tasks) for (let r = 1; r <= o.repeats; r += 1) for (const route of [baseline, candidate]) if (!have.has(`${t.task_id}|${route.name}|${r}`)) queue.push({ task: t, route, repeat: r });
  const results = new Map(have);
  const insert = o.store.prepare(
    `INSERT OR REPLACE INTO replay_item (run_id, task_id, route, repeat, status, fail_to_pass_passed, fail_to_pass_total, pass_to_pass_passed, pass_to_pass_total, turns, model_calls, tokens_in, tokens_out, ms, tool_executed, tool_served_from_recording, tool_stubbed, tool_refused, tool_diverged, touched_json, divergence, error, stopped, served_model, patch_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let next = 0;
  let spent = 0;
  const live = (): number => baseline.port.live + candidate.port.live;
  const priced = (r: ItemResult, route: SwapRoute): number => (route.price ? (r.tokensIn * route.price.inPerM + r.tokensOut * route.price.outPerM) / 1_000_000 : 0);
  const anyPrice = o.baseline.price !== undefined || o.candidate.price !== undefined;
  let capped = false;
  const worker = async (): Promise<void> => {
    for (;;) {
      if ((o.maxLiveCalls !== undefined && live() >= o.maxLiveCalls) || (o.budgetUsd !== undefined && anyPrice && spent >= o.budgetUsd)) {
        capped = true;
        return;
      }
      const i = next;
      next += 1;
      const q = queue[i];
      if (!q) return;
      const result = await runItem({ task: taskForReplay(q.task), route: q.route, repeat: q.repeat, port: q.route.port, ...(o.limits ? { limits: o.limits } : {}) });
      spent += priced(result, q.route);
      insert.run(...(rowOf(runId, result) as never[]));
      results.set(`${result.taskId}|${result.route}|${result.repeat}`, result);
      o.onItem?.(result, results.size, planned);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 2, 4)) }, worker));
  // The report is a function of what is stored, not of what this process saw: a run that was resumed, or that another process also wrote to, reports the same.
  const items = itemsOf(o.store, runId);
  const report = reportSwap({ tasks: metas, items, baseline: o.baseline.name, candidate: o.candidate.name, planned, ...(o.margin !== undefined ? { margin: o.margin } : {}), ...(o.gate !== undefined ? { gate: o.gate } : {}), ...(o.resamples !== undefined ? { resamples: o.resamples } : {}), ...(o.seed !== undefined ? { seed: o.seed } : {}) });
  if (capped) report.partial = true;
  const status = report.partial ? "partial" : report.verdict === "withheld" ? "withheld" : "complete";
  o.store.prepare("UPDATE replay_run SET finished_at = ?, status = ?, report_json = ? WHERE run_id = ?").run(now().toISOString(), status, JSON.stringify(report), runId);
  return { runId, report, items, liveCalls: live(), estimatedUsd: anyPrice ? spent : null };
}

/**
 * The report of a run, made again from the items stored for it and the parameters it was started with, and stored in place of the one it had. The report is a function of
 * those items; this is how a report is made to agree with them after a run that was resumed or written to by more than one process.
 */
export function recomputeReport(store: CaptureDb, runId: string): SwapReport | null {
  const row = store.prepare("SELECT baseline, candidate, params_json, status FROM replay_run WHERE run_id = ?").get(runId) as { baseline: string; candidate: string; params_json: string; status: string } | undefined;
  if (!row || row.status === "running") return null;
  const params = JSON.parse(row.params_json) as { repeats: number; margin: number; gate: number; resamples: number; seed: number; tasks: string[] };
  const metas: TaskMeta[] = [];
  for (const id of params.tasks) {
    const t = getTask(store, id);
    if (t && t.oracle && t.oracle !== "none") metas.push({ taskId: t.task_id, kind: t.kind, area: t.area, oracle: t.oracle === "strong" ? "strong" : "weak" });
  }
  const items = itemsOf(store, runId);
  const planned = metas.length * 2 * params.repeats;
  const report = reportSwap({ tasks: metas, items, baseline: row.baseline, candidate: row.candidate, planned, margin: params.margin, gate: params.gate, resamples: params.resamples, seed: params.seed });
  const status = report.partial ? "partial" : report.verdict === "withheld" ? "withheld" : "complete";
  store.prepare("UPDATE replay_run SET status = ?, report_json = ? WHERE run_id = ?").run(status, JSON.stringify(report), runId);
  return report;
}
