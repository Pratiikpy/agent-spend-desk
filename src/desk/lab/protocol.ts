import type { RunRecord } from "./runner.ts";
import { summarise } from "./stats.ts";

/**
 * The go criteria of `docs/lab/00-spike-protocol.md`, applied to a batch of runs. They were written before the first run
 * and this is the code that holds the results to them, so the thresholds are here and not in anyone's judgement after
 * the fact.
 */
export interface Criterion {
  id: "informative" | "infrastructure" | "receipts" | "task_defects" | "reproduction";
  /** true: met. false: not met. null: not yet decidable. */
  ok: boolean | null;
  detail: string;
}

export interface ProtocolResult {
  criteria: Criterion[];
  verdict: "go" | "no_go" | "pending_reproduction" | "no_data";
  next: string;
}

export interface ProtocolOptions {
  /** Task defects found by reading failed runs and not yet fixed. */
  openTaskDefects: number;
  /** A second batch on another day, same tasks and settings. */
  second?: RunRecord[];
  /** A task is informative when its pass rate lies in this band. */
  band?: [number, number];
}

export const THRESHOLDS = { informativeShare: 0.25, infraShare: 0.15, reproductionPoints: 0.15, reproductionRank: 0.6 };

function ranks(xs: readonly number[]): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const out = new Array<number>(xs.length).fill(0);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && (order[j + 1] as { x: number }).x === (order[i] as { x: number }).x) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[(order[k] as { i: number }).i] = avg;
    i = j + 1;
  }
  return out;
}

/** Spearman's rank correlation, with ties given their average rank. Zero when either side is constant. */
export function spearman(a: readonly number[], b: readonly number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    num += ((ra[i] as number) - ma) * ((rb[i] as number) - mb);
    da += ((ra[i] as number) - ma) ** 2;
    db += ((rb[i] as number) - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

export function evaluateProtocol(records: RunRecord[], opts: ProtocolOptions): ProtocolResult {
  if (records.length === 0) return { criteria: [], verdict: "no_data", next: "Run the batch first." };
  const [lo, hi] = opts.band ?? [0.2, 0.8];
  const s = summarise(records);
  const informative = s.tasks.filter((t) => t.rate >= lo && t.rate <= hi).length;
  const infra = records.filter((r) => r.outcome === "infra").length;
  const called = records.filter((r) => r.accounting.calls > 0);
  const withReceipt = called.filter((r) => r.accounting.receipts > 0).length;

  const criteria: Criterion[] = [
    { id: "informative", ok: informative / s.tasks.length >= THRESHOLDS.informativeShare, detail: `${informative} of ${s.tasks.length} tasks have a pass rate from ${pct(lo)} to ${pct(hi)} (needs at least ${pct(THRESHOLDS.informativeShare)} of tasks)` },
    { id: "infrastructure", ok: infra / records.length <= THRESHOLDS.infraShare, detail: `${infra} of ${records.length} runs were infrastructure failures, ${pct(infra / records.length)} (at most ${pct(THRESHOLDS.infraShare)})` },
    { id: "receipts", ok: called.length > 0 && withReceipt === called.length, detail: `${withReceipt} of ${called.length} runs that called the model have a Nightshift receipt on at least one call` },
    { id: "task_defects", ok: opts.openTaskDefects === 0, detail: opts.openTaskDefects === 0 ? "no open task defect found in failed runs" : `${opts.openTaskDefects} task defect(s) found in failed runs are not fixed` },
  ];

  if (opts.second && opts.second.length > 0) {
    const t2 = summarise(opts.second);
    const common = s.tasks.filter((t) => t2.tasks.some((u) => u.taskId === t.taskId));
    const a = common.map((t) => t.rate);
    const b = common.map((t) => (t2.tasks.find((u) => u.taskId === t.taskId) as { rate: number }).rate);
    const diff = Math.abs(s.overallRate - t2.overallRate);
    const rho = common.length >= 3 ? spearman(a, b) : 0;
    criteria.push({
      id: "reproduction",
      ok: diff <= THRESHOLDS.reproductionPoints && rho >= THRESHOLDS.reproductionRank,
      detail: `overall pass rate ${pct(s.overallRate)} then ${pct(t2.overallRate)} (${Math.round(diff * 100)} points apart, at most ${Math.round(THRESHOLDS.reproductionPoints * 100)}); rank correlation of per-task rates ${rho.toFixed(2)} over ${common.length} tasks (at least ${THRESHOLDS.reproductionRank})`,
    });
  } else {
    criteria.push({ id: "reproduction", ok: null, detail: "needs a second batch on another day with the same tasks and settings" });
  }

  const failed = criteria.filter((c) => c.ok === false);
  const pending = criteria.some((c) => c.ok === null);
  const verdict: ProtocolResult["verdict"] = failed.length > 0 ? "no_go" : pending ? "pending_reproduction" : "go";
  let next: string;
  if (verdict === "go") next = "Build the Lab on this agent and these tasks, grow the corpus to mined tasks, and choose sample sizes by simulation from this batch.";
  else if (verdict === "pending_reproduction") next = "Run the same batch on another day and compare.";
  else if (failed.some((c) => c.id === "informative")) next = "The tasks are too easy or too hard for this model: change the tasks, not the threshold, and run the spike again.";
  else if (failed.some((c) => c.id === "infrastructure")) next = "Lower the load or change the endpoint; report the infrastructure share with every result meanwhile.";
  else if (failed.some((c) => c.id === "task_defects")) next = "Fix each task defect, re-audit the task and repeat that task's runs.";
  else if (failed.some((c) => c.id === "receipts")) next = "Find why some calls carry no receipt before claiming the runs went through Nightshift.";
  else next = "Report the size of the day-to-day difference and find its source before running any intervention.";
  return { criteria, verdict, next };
}

export function renderProtocol(r: ProtocolResult): string {
  const mark = (ok: boolean | null): string => (ok === null ? "PENDING" : ok ? "MET    " : "NOT MET");
  return [...r.criteria.map((c) => `${mark(c.ok)} ${c.id}: ${c.detail}`), `Verdict: ${r.verdict.replace(/_/g, " ")}.`, `Next: ${r.next}`].join("\n");
}
