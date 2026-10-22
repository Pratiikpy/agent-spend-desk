/**
 * The shape the regression statistic reads: for each task and each day, the scored samples of that day.
 * The database path (store.ts) and the simulator (simulate.ts) both build this, so the statistic that is
 * simulated is the statistic that runs on real data.
 */
export interface Cell {
  /** Samples that produced a score (pass or fail). Failures of the harness are not scores. */
  n: number;
  sum: number;
  sumSq: number;
  /** Attempts that produced no score: infra failures, refusals, grader failures. */
  err: number;
  /** All attempts (scored plus err). */
  total: number;
  /** Money spent on the day's attempts, in micro-USD. */
  cost: number;
  /** Money spent on attempts that passed (score >= 0.5), micro-USD, for cost per passing task. */
  passCost: number;
  /** Attempts that passed. */
  passes: number;
}

export const EMPTY_CELL: Cell = Object.freeze({ n: 0, sum: 0, sumSq: 0, err: 0, total: 0, cost: 0, passCost: 0, passes: 0 });

export interface ArmSeries {
  taskIds: string[];
  /** Cluster key per task (template or repository area, spec 4.7). */
  cluster: string[];
  /** True for the half of the tasks that no tuning screen ever shows (spec 8.2.5). */
  held: boolean[];
  /** cells[task][day - 1] for day 1 .. days. */
  cells: Cell[][];
}

export interface Series {
  primary: ArmSeries;
  control: ArmSeries | null;
  /** Number of days with data, counted from day 1 = the first run after the pin. */
  days: number;
  /** The harness hash equals the baseline's in the windows being compared. */
  harnessUnchanged: boolean;
  /** The agent tool version observed equals the baseline's. */
  agentVersionUnchanged: boolean;
}

/** Cumulative sums per task so that any window is two lookups. */
export class Prefix {
  private readonly acc: Float64Array[];
  readonly tasks: number;
  readonly days: number;
  private static readonly FIELDS = ["n", "sum", "sumSq", "err", "total", "cost", "passCost", "passes"] as const;

  constructor(arm: ArmSeries, days: number) {
    this.tasks = arm.taskIds.length;
    this.days = days;
    this.acc = [];
    for (let i = 0; i < this.tasks; i += 1) {
      const a = new Float64Array((days + 1) * Prefix.FIELDS.length);
      const row = arm.cells[i] ?? [];
      for (let d = 1; d <= days; d += 1) {
        const c = row[d - 1] ?? EMPTY_CELL;
        for (let f = 0; f < Prefix.FIELDS.length; f += 1) {
          const key = Prefix.FIELDS[f] as keyof Cell;
          a[d * Prefix.FIELDS.length + f] = (a[(d - 1) * Prefix.FIELDS.length + f] as number) + (c[key] as number);
        }
      }
      this.acc.push(a);
    }
  }

  /** The sum of a field over days from..to inclusive (1-based) for one task. */
  window(task: number, from: number, to: number): Cell {
    const a = this.acc[task] as Float64Array;
    const F = Prefix.FIELDS.length;
    const out: Record<string, number> = {};
    for (let f = 0; f < F; f += 1) {
      out[Prefix.FIELDS[f] as string] = (a[to * F + f] as number) - (a[(from - 1) * F + f] as number);
    }
    return out as unknown as Cell;
  }
}

export function addCell(a: Cell, b: Cell): Cell {
  return { n: a.n + b.n, sum: a.sum + b.sum, sumSq: a.sumSq + b.sumSq, err: a.err + b.err, total: a.total + b.total, cost: a.cost + b.cost, passCost: a.passCost + b.passCost, passes: a.passes + b.passes };
}
