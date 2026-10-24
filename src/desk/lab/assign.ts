import { createHash } from "node:crypto";

import { seededRandom, shuffled } from "../stats/random.ts";

/**
 * Randomised assignment of Lab runs to arms, with the probability each run had written down. Randomisation is what
 * lets an effect be read as an effect of the arm and not of which tasks or which day an arm happened to get, and the
 * logged probability is what the counterfactual estimators need (a run assigned with probability p counts 1/p).
 *
 * Within each task the arms are balanced (the counts differ by at most one for equal weights), so a task is compared
 * with itself under each arm. Which arm gets the extra run when the repeats do not divide evenly is decided by
 * systematic randomised rounding, so over many seeds each arm's expected count is exactly its share. The order of
 * the labels is then shuffled, so the first or last repeat of a task favours no arm.
 */
export interface Arm {
  id: string;
  /** Relative share. 1 and 1 is an even split; 3 and 1 gives the second arm a quarter. */
  weight: number;
}

export interface Unit {
  taskId: string;
  repeat: number;
}

export interface Assignment extends Unit {
  arm: string;
  /** The probability this run had of getting this arm, from the weights. */
  propensity: number;
}

function subSeed(seed: number, taskId: string): number {
  return createHash("sha256").update(`${seed}\0${taskId}`).digest().readUInt32BE(0);
}

export function assignArms(units: readonly Unit[], arms: readonly Arm[], seed: number): Assignment[] {
  if (arms.length < 2) throw new RangeError("an assignment needs at least two arms");
  const ids = new Set<string>();
  for (const a of arms) {
    if (ids.has(a.id)) throw new RangeError(`duplicate arm ${a.id}`);
    ids.add(a.id);
    if (!Number.isFinite(a.weight) || a.weight <= 0) throw new RangeError(`arm ${a.id} needs a positive weight`);
  }
  const seen = new Set<string>();
  const byTask = new Map<string, Unit[]>();
  for (const u of units) {
    const key = `${u.taskId}#${u.repeat}`;
    if (seen.has(key)) throw new RangeError(`run ${key} is listed twice`);
    seen.add(key);
    byTask.set(u.taskId, [...(byTask.get(u.taskId) ?? []), u]);
  }
  const total = arms.reduce((s, a) => s + a.weight, 0);
  const out: Assignment[] = [];
  for (const [taskId, list] of [...byTask].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const n = list.length;
    const rand = seededRandom(subSeed(seed, taskId));
    // Systematic randomised rounding of n times each share: exact expected counts, and counts that add up to n.
    const u0 = rand();
    const labels: string[] = [];
    let cumulative = 0;
    for (const a of arms) {
      const before = Math.floor(cumulative - u0 + 1e-12);
      cumulative += (n * a.weight) / total;
      const after = Math.floor(cumulative - u0 + 1e-12);
      for (let k = 0; k < after - before; k += 1) labels.push(a.id);
    }
    // Rounding at the very end can leave one label short or over by floating point; the arms' order decides who takes the slack.
    while (labels.length < n) labels.push((arms[0] as Arm).id);
    labels.length = n;
    const order = shuffled(labels, subSeed(seed, `${taskId}:order`));
    const sorted = [...list].sort((a, b) => a.repeat - b.repeat);
    sorted.forEach((u, i) => {
      const arm = arms.find((a) => a.id === order[i]) as Arm;
      out.push({ ...u, arm: arm.id, propensity: arm.weight / total });
    });
  }
  return out;
}
