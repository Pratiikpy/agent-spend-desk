import type { RunRecord } from "./runner.ts";

export { clopperPearsonUpper, wilson } from "../stats/intervals.ts";
import { wilson } from "../stats/intervals.ts";

export interface TaskRow {
  taskId: string;
  n: number;
  pass: number;
  fail: number;
  timeout: number;
  infra: number;
  rate: number;
  low: number;
  high: number;
  /** Pass rate counting only runs the agent had a fair chance at (infrastructure failures left out), shown beside the main one. */
  fairRate: number | null;
  meanWallSec: number;
  meanCalls: number;
  meanTokens: number;
}

export interface Summary {
  runs: number;
  tasks: TaskRow[];
  overallRate: number;
  infraShare: number;
  /** Tasks whose pass rate is between 20% and 80%, where an intervention can show an effect in either direction. */
  informativeTasks: number;
  alwaysPass: number;
  neverPass: number;
  /** Share of the variance in outcomes that is between tasks (an intraclass correlation from a one-way decomposition). */
  betweenTaskShare: number | null;
  meanWallSec: number;
  meanCalls: number;
  receiptShare: number | null;
}

export function summarise(records: RunRecord[]): Summary {
  const byTask = new Map<string, RunRecord[]>();
  for (const r of records) {
    const list = byTask.get(r.taskId) ?? [];
    list.push(r);
    byTask.set(r.taskId, list);
  }
  const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const tasks: TaskRow[] = [...byTask.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([taskId, rs]) => {
      const pass = rs.filter((r) => r.outcome === "pass").length;
      const infra = rs.filter((r) => r.outcome === "infra").length;
      const fair = rs.length - infra;
      const ci = wilson(pass, rs.length);
      return {
        taskId,
        n: rs.length,
        pass,
        fail: rs.filter((r) => r.outcome === "fail").length,
        timeout: rs.filter((r) => r.outcome === "timeout").length,
        infra,
        rate: pass / rs.length,
        low: ci.low,
        high: ci.high,
        fairRate: fair > 0 ? pass / fair : null,
        meanWallSec: mean(rs.map((r) => r.wallMs / 1000)),
        meanCalls: mean(rs.map((r) => r.accounting.calls)),
        meanTokens: mean(rs.map((r) => r.accounting.promptTokens + r.accounting.completionTokens)),
      };
    });

  // One-way ANOVA decomposition of a 0/1 outcome by task (balanced approximation using the mean group size).
  let betweenTaskShare: number | null = null;
  const k = tasks.length;
  const N = records.length;
  if (k >= 2 && N > k) {
    const grand = records.filter((r) => r.outcome === "pass").length / N;
    const ssb = tasks.reduce((s, t) => s + t.n * (t.rate - grand) ** 2, 0);
    const ssw = tasks.reduce((s, t) => s + t.n * t.rate * (1 - t.rate), 0);
    const msb = ssb / (k - 1);
    const msw = ssw / (N - k);
    const n0 = (N - tasks.reduce((s, t) => s + t.n * t.n, 0) / N) / (k - 1);
    const denom = msb + (n0 - 1) * msw;
    betweenTaskShare = denom > 0 ? Math.max(0, Math.min(1, (msb - msw) / denom)) : null;
  }
  const withCalls = records.filter((r) => r.accounting.calls > 0);
  return {
    runs: N,
    tasks,
    overallRate: N === 0 ? 0 : records.filter((r) => r.outcome === "pass").length / N,
    infraShare: N === 0 ? 0 : records.filter((r) => r.outcome === "infra").length / N,
    informativeTasks: tasks.filter((t) => t.rate >= 0.2 && t.rate <= 0.8).length,
    alwaysPass: tasks.filter((t) => t.pass === t.n).length,
    neverPass: tasks.filter((t) => t.pass === 0).length,
    betweenTaskShare,
    meanWallSec: mean(records.map((r) => r.wallMs / 1000)),
    meanCalls: mean(records.map((r) => r.accounting.calls)),
    receiptShare: withCalls.length === 0 ? null : withCalls.filter((r) => r.accounting.receipts > 0).length / withCalls.length,
  };
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

export function renderSummary(s: Summary): string {
  const lines: string[] = [];
  lines.push(`${s.runs} runs over ${s.tasks.length} tasks. Overall pass rate ${pct(s.overallRate)}; infrastructure failures ${pct(s.infraShare)} of runs.`);
  lines.push("task".padEnd(18) + "runs  pass fail tmo infra  rate (95% interval)   fair  wall s  calls  tokens");
  for (const t of s.tasks) {
    lines.push(
      `${t.taskId.padEnd(18)}${String(t.n).padStart(4)}  ${String(t.pass).padStart(4)} ${String(t.fail).padStart(4)} ${String(t.timeout).padStart(3)} ${String(t.infra).padStart(5)}  ${pct(t.rate).padStart(4)} (${pct(t.low)}-${pct(t.high)})`.padEnd(70) +
        `${t.fairRate === null ? "  n/a" : pct(t.fairRate).padStart(5)}  ${t.meanWallSec.toFixed(0).padStart(6)}  ${t.meanCalls.toFixed(1).padStart(5)}  ${Math.round(t.meanTokens).toString().padStart(6)}`,
    );
  }
  lines.push(`Tasks between 20% and 80%: ${s.informativeTasks} of ${s.tasks.length}. Always pass: ${s.alwaysPass}. Never pass: ${s.neverPass}.`);
  if (s.betweenTaskShare !== null) lines.push(`Share of outcome variance that is between tasks (intraclass correlation): ${pct(s.betweenTaskShare)}.`);
  lines.push(`Mean ${s.meanWallSec.toFixed(0)} s and ${s.meanCalls.toFixed(1)} model calls per run.${s.receiptShare === null ? "" : ` Runs whose calls carried a Nightshift receipt: ${pct(s.receiptShare)}.`}`);
  return lines.join("\n");
}

export { seededRandom, shuffled } from "../stats/random.ts";
