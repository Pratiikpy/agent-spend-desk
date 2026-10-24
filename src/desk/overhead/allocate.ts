/**
 * Share-weighted allocation of shared and idle overhead (DF-095), after OpenCost's idle distribution: the overhead is shared among the projects
 * that landed work, in proportion to the dollars each landed, and every micro-dollar goes somewhere or is said to be unallocated.
 *
 *   A_p = floor(U × V_p / ΣV)        for each project p with V_p > 0
 *   R   = U − Σ A_p                   the micro-dollars the floors leave, given to the project with the most landed spend
 *
 * so that Σ A_p = U exactly, with no rounding drift. A project that landed nothing bears none of it. When no project landed
 * anything, the whole overhead stays in the unallocated bin: it is never divided arbitrarily and never dropped. The products are formed in BigInt,
 * because overhead and landed spend are each near 1e10 micro-dollars on a busy month and their product passes 2^53.
 */
export interface LandedProject {
  project: string;
  /** What the project's landed tasks cost directly, in micro-dollars. */
  micros: number;
}

export interface AllocationRow {
  project: string;
  directMicros: number;
  /** This project's share of the landed spend, 0 to 1. For display: the allocation itself is exact integer arithmetic. */
  weight: number;
  /** What the project is charged: its floor share, plus the residual when it is the project with the most landed spend. */
  allocatedMicros: number;
  /** The part of `allocatedMicros` that is the residual (0 for every project but one). */
  residualMicros: number;
}

export interface Allocation {
  overheadMicros: number;
  rows: AllocationRow[];
  /** The micro-dollars the floors left, and the project they were given to. */
  residualMicros: number;
  residualTo: string | null;
  /** Overhead that no project landed work to share: all of it when nothing landed, none otherwise. */
  unallocatedMicros: number;
}

function whole(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${what} must be a whole number of micro-dollars, not negative: ${n}`);
}

export function allocateOverhead(overheadMicros: number, landed: readonly LandedProject[]): Allocation {
  whole(overheadMicros, "the overhead");
  // The same project named twice is one project.
  const by = new Map<string, number>();
  for (const p of landed) {
    whole(p.micros, `the landed spend of ${p.project}`);
    by.set(p.project, (by.get(p.project) ?? 0) + p.micros);
  }
  const projects = [...by.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = projects.reduce((s, [, v]) => s + BigInt(v), 0n);
  if (total === 0n) return { overheadMicros, rows: [], residualMicros: 0, residualTo: null, unallocatedMicros: overheadMicros };
  const u = BigInt(overheadMicros);
  const floors = projects.map(([, v]) => (u * BigInt(v)) / total);
  const given = floors.reduce((s, f) => s + f, 0n);
  const residual = u - given;
  const rows: AllocationRow[] = projects.map(([project, v], i) => ({
    project,
    directMicros: v,
    weight: Number((BigInt(v) * 1_000_000n) / total) / 1_000_000,
    allocatedMicros: Number(floors[i] as bigint + (i === 0 ? residual : 0n)),
    residualMicros: i === 0 ? Number(residual) : 0,
  }));
  return { overheadMicros, rows, residualMicros: Number(residual), residualTo: (projects[0] as [string, number])[0], unallocatedMicros: 0 };
}
