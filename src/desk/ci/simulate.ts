import { Rng } from "../canary/rng.ts";
import type { RunRow } from "../canary/runner.ts";
import { harnessHash, TASKS } from "../canary/tasks.ts";
import { ciGate, type CiOptions, type CiVerdict } from "./gate.ts";

/**
 * How the CI gate behaves when the truth is known: packs drawn from task pass probabilities, one for the baseline and one for the candidate, where the
 * candidate's probabilities are the baseline's less a stated drop. Nothing here uses a model; the probabilities are a fixed spread from tasks that nearly
 * always pass to tasks that mostly fail, because a suite whose tasks all pass or all fail has no variance to show.
 */
export interface CiStudy {
  trials: number;
  drop: number;
  verdicts: Record<CiVerdict, number>;
}

const profile = (i: number): number => [0.97, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.25, 0.1][i % 9] as number;

function pack(rng: Rng, p: (i: number) => number, repeats: number): RunRow[] {
  const rows: RunRow[] = [];
  const harness = harnessHash();
  TASKS.forEach((t, i) => {
    for (let r = 0; r < repeats; r += 1) {
      rows.push({ day: 1, date: "2026-10-20", arm: "primary", taskId: t.id, servedModel: "claude-sonnet-5-5", score: rng.next() < p(i) ? 1 : 0, error: null, latencyMs: 1, tokensIn: 200, tokensOut: 100, replySha: null, harness, cacheBypass: true });
    }
  });
  return rows;
}

/** Run the gate on `trials` independent pairs of packs whose truth differs by `drop` (0 for no change, 0.1 for ten points on every task). */
export function ciStudy(o: { trials: number; drop: number; seed: number; repeats?: number; options?: Omit<CiOptions, "baseline" | "candidate"> }): CiStudy {
  const rng = new Rng(o.seed);
  const verdicts: Record<CiVerdict, number> = { pass: 0, fail: 0, inconclusive: 0 };
  for (let n = 0; n < o.trials; n += 1) {
    const baseline = pack(rng, profile, o.repeats ?? 5);
    const candidate = pack(rng, (i) => Math.max(0, profile(i) - o.drop), o.repeats ?? 5);
    verdicts[ciGate({ ...o.options, baseline, candidate }).verdict] += 1;
  }
  return { trials: o.trials, drop: o.drop, verdicts };
}
