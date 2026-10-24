import { describe, expect, it } from "vitest";

import { assignArms, type Arm } from "../../../src/desk/lab/assign.ts";
import { pairedTest, requiredTasks, simulatePower, studentTCdf } from "../../../src/desk/lab/power.ts";
import { clopperPearsonUpper } from "../../../src/desk/stats/intervals.ts";

const units = (tasks: number, repeats: number) => Array.from({ length: tasks }, (_, t) => Array.from({ length: repeats }, (_, r) => ({ taskId: `task-${t}`, repeat: r + 1 }))).flat();
const ARMS: Arm[] = [{ id: "baseline", weight: 1 }, { id: "desk", weight: 1 }];

describe("assigning runs to arms", () => {
  it("gives every run exactly one arm and logs the probability it had", () => {
    const a = assignArms(units(6, 4), ARMS, 11);
    expect(a).toHaveLength(24);
    expect(new Set(a.map((x) => `${x.taskId}#${x.repeat}`)).size).toBe(24);
    for (const x of a) {
      expect(["baseline", "desk"]).toContain(x.arm);
      expect(x.propensity).toBe(0.5);
    }
  });

  it("balances the arms within every task, so a task is not compared with a different task", () => {
    const a = assignArms(units(9, 5), ARMS, 3);
    for (let t = 0; t < 9; t += 1) {
      const mine = a.filter((x) => x.taskId === `task-${t}`);
      const nBase = mine.filter((x) => x.arm === "baseline").length;
      expect(Math.abs(nBase - (mine.length - nBase))).toBeLessThanOrEqual(1);
    }
  });

  it("is the same assignment for the same seed and a different one for another", () => {
    expect(assignArms(units(8, 4), ARMS, 5)).toEqual(assignArms(units(8, 4), ARMS, 5));
    expect(assignArms(units(8, 4), ARMS, 5).map((x) => x.arm)).not.toEqual(assignArms(units(8, 4), ARMS, 6).map((x) => x.arm));
  });

  it("does not let the first or last run of a task favour an arm: over many seeds each arm leads about half the time", () => {
    let desk = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      if (assignArms(units(1, 3), ARMS, seed)[0]!.arm === "desk") desk += 1;
    }
    expect(desk).toBeGreaterThan(160);
    expect(desk).toBeLessThan(240);
  });

  it("follows unequal weights and logs each arm's own probability", () => {
    const arms: Arm[] = [{ id: "baseline", weight: 3 }, { id: "desk", weight: 1 }];
    const a = assignArms(units(40, 8), arms, 21);
    const share = a.filter((x) => x.arm === "desk").length / a.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
    expect(a.find((x) => x.arm === "desk")!.propensity).toBe(0.25);
    expect(a.find((x) => x.arm === "baseline")!.propensity).toBe(0.75);
  });

  it("covers three arms, and refuses empty, duplicate or non-positive arms and a run listed twice", () => {
    const three = assignArms(units(6, 6), [{ id: "a", weight: 1 }, { id: "b", weight: 1 }, { id: "c", weight: 1 }], 2);
    expect(new Set(three.map((x) => x.arm)).size).toBe(3);
    expect(() => assignArms(units(2, 2), [], 1)).toThrow(/at least two arms/);
    expect(() => assignArms(units(2, 2), [{ id: "a", weight: 1 }], 1)).toThrow(/at least two arms/);
    expect(() => assignArms(units(2, 2), [{ id: "a", weight: 1 }, { id: "a", weight: 1 }], 1)).toThrow(/duplicate arm/);
    expect(() => assignArms(units(2, 2), [{ id: "a", weight: 0 }, { id: "b", weight: 1 }], 1)).toThrow(/weight/);
    expect(() => assignArms([...units(1, 1), ...units(1, 1)], ARMS, 1)).toThrow(/listed twice/);
  });
});

describe("the t distribution and the paired test", () => {
  it("matches known values of Student's t", () => {
    expect(studentTCdf(0, 9)).toBeCloseTo(0.5, 10);
    expect(2 * (1 - studentTCdf(2.262, 9))).toBeCloseTo(0.05, 3);
    expect(2 * (1 - studentTCdf(2.086, 20))).toBeCloseTo(0.05, 3);
    expect(studentTCdf(-1.5, 5) + studentTCdf(1.5, 5)).toBeCloseTo(1, 10);
    expect(2 * (1 - studentTCdf(12.706, 1))).toBeCloseTo(0.05, 3);
  });

  it("tests a paired difference across tasks, not across runs: repeats of one task are not independent", () => {
    const base = [0.2, 0.4, 0.5, 0.6, 0.3, 0.7, 0.5, 0.4, 0.6, 0.5];
    const better = base.map((x) => x + 0.1);
    const r = pairedTest(better, base);
    expect(r.meanDifference).toBeCloseTo(0.1, 10);
    expect(r.pValue).toBeLessThan(0.001);
    const same = pairedTest(base, base);
    expect(same.pValue).toBe(1);
    expect(pairedTest([0.5, 0.4, 0.6], [0.4, 0.5, 0.6]).pValue).toBeGreaterThan(0.5);
    expect(() => pairedTest([1], [1])).toThrow(/at least two/);
    expect(() => pairedTest([1, 2], [1])).toThrow(/same length/);
  });
});

describe("power, by simulation from a pilot", () => {
  const pilot = [0.1, 0.3, 0.5, 0.5, 0.7, 0.9, 0.4, 0.6, 0.5, 0.3, 0.8, 0.2, 0.5, 0.6, 0.4, 0.7, 0.5, 0.3, 0.6, 0.5];

  it("rejects about 5% of the time when nothing has changed, with an exact bound on that rate", () => {
    const r = simulatePower({ baselineRates: pilot, repeats: 5, effect: 0, trials: 1000, seed: 9 });
    expect(r.rejectionRate).toBeGreaterThan(0.02);
    expect(r.rejectionRate).toBeLessThan(0.09);
    expect(clopperPearsonUpper(Math.round(r.rejectionRate * 1000), 1000)).toBeLessThan(0.1);
  });

  it("detects a large effect nearly always and a tiny one rarely, and more tasks mean more power", () => {
    const big = simulatePower({ baselineRates: pilot, repeats: 5, effect: 0.25, trials: 600, seed: 9 });
    const tiny = simulatePower({ baselineRates: pilot, repeats: 5, effect: 0.02, trials: 600, seed: 9 });
    expect(big.rejectionRate).toBeGreaterThan(0.95);
    expect(tiny.rejectionRate).toBeLessThan(0.2);
    const few = simulatePower({ baselineRates: pilot.slice(0, 8), repeats: 5, effect: 0.1, trials: 800, seed: 9 });
    const many = simulatePower({ baselineRates: [...pilot, ...pilot, ...pilot], repeats: 5, effect: 0.1, trials: 800, seed: 9 });
    expect(many.rejectionRate).toBeGreaterThan(few.rejectionRate);
  });

  it("is the same for the same seed", () => {
    const a = simulatePower({ baselineRates: pilot, repeats: 4, effect: 0.1, trials: 300, seed: 4 });
    expect(a).toEqual(simulatePower({ baselineRates: pilot, repeats: 4, effect: 0.1, trials: 300, seed: 4 }));
  });

  it("finds how many tasks an effect needs for 80% power, and says when the pilot cannot get there", () => {
    const need = requiredTasks({ baselineRates: pilot, repeats: 5, effect: 0.15, targetPower: 0.8, maxTasks: 200, trials: 400, seed: 2 });
    expect(need.tasks).not.toBeNull();
    expect(need.tasks!).toBeGreaterThan(5);
    expect(need.tasks!).toBeLessThan(80);
    expect(need.power).toBeGreaterThanOrEqual(0.78);
    const none = requiredTasks({ baselineRates: pilot, repeats: 5, effect: 0.001, targetPower: 0.8, maxTasks: 40, trials: 200, seed: 2 });
    expect(none.tasks).toBeNull();
  });

  it("refuses rates outside 0 to 1 and too small a pilot", () => {
    expect(() => simulatePower({ baselineRates: [0.5, 1.2], repeats: 3, effect: 0.1, trials: 10, seed: 1 })).toThrow(/rates/);
    expect(() => simulatePower({ baselineRates: [0.5], repeats: 3, effect: 0.1, trials: 10, seed: 1 })).toThrow(/at least two/);
  });
});
