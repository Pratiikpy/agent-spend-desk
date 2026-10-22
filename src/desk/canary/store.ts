import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { RunRow } from "./runner.ts";
import { EMPTY_CELL, type ArmSeries, type Cell, type Series } from "./series.ts";
import { TASKS, harnessHash } from "./tasks.ts";

/** Rows are kept as JSON lines: appended as each pack finishes, so a long run that stops can resume where it was. */
export function appendRows(path: string, rows: readonly RunRow[]): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function readRows(path: string): { rows: RunRow[]; skipped: number } {
  if (!existsSync(path)) return { rows: [], skipped: 0 };
  const rows: RunRow[] = [];
  let skipped = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const r = JSON.parse(line) as RunRow;
      if (typeof r.day === "number" && Number.isInteger(r.day) && r.day >= 1 && (r.arm === "primary" || r.arm === "control") && typeof r.taskId === "string" && (r.score === null || r.score === 0 || r.score === 1)) rows.push(r);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { rows, skipped };
}

function cell(rows: readonly RunRow[]): Cell {
  let c: Cell = { ...EMPTY_CELL };
  for (const r of rows) {
    c = r.score === null
      ? { ...c, err: c.err + 1, total: c.total + 1 }
      : { ...c, n: c.n + 1, sum: c.sum + r.score, sumSq: c.sumSq + r.score * r.score, total: c.total + 1, passes: c.passes + r.score };
  }
  return c;
}

function armOf(rows: readonly RunRow[], arm: RunRow["arm"], days: number): ArmSeries | null {
  const mine = rows.filter((r) => r.arm === arm);
  if (mine.length === 0) return null;
  const taskIds = TASKS.map((t) => t.id);
  const cells: Cell[][] = taskIds.map((id) => {
    const byDay: Cell[] = [];
    for (let d = 1; d <= days; d += 1) byDay.push(cell(mine.filter((r) => r.taskId === id && r.day === d)));
    return byDay;
  });
  // The held-out half is every second task, fixed by position, so no tuning screen ever shows it.
  return { taskIds, cluster: TASKS.map((t) => t.cluster), held: taskIds.map((_, i) => i % 2 === 1), cells };
}

/** The shape the regression statistic reads, built from stored rows. */
export function buildSeries(rows: readonly RunRow[]): Series | null {
  if (rows.length === 0) return null;
  const days = Math.max(...rows.map((r) => r.day));
  const primary = armOf(rows, "primary", days);
  if (!primary) return null;
  const current = harnessHash();
  const harnessUnchanged = rows.every((r) => r.harness === current);
  return { primary, control: armOf(rows, "control", days), days, harnessUnchanged, agentVersionUnchanged: true };
}

export interface ServedChange {
  day: number;
  date: string;
  from: string;
  to: string;
}

/** Days on which the model an arm reports having served changed. Seen in the replies, not assumed from configuration. */
export function servedChanges(rows: readonly RunRow[], arm: RunRow["arm"]): ServedChange[] {
  const byDay = new Map<number, Map<string, number>>();
  const dates = new Map<number, string>();
  for (const r of rows) {
    if (r.arm !== arm || r.servedModel === null) continue;
    const m = byDay.get(r.day) ?? new Map<string, number>();
    m.set(r.servedModel, (m.get(r.servedModel) ?? 0) + 1);
    byDay.set(r.day, m);
    dates.set(r.day, r.date);
  }
  const out: ServedChange[] = [];
  let prev: string | null = null;
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const top = [...byDay.get(day)!.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    if (prev !== null && top !== prev) out.push({ day, date: dates.get(day) ?? "", from: prev, to: top });
    prev = top;
  }
  return out;
}
