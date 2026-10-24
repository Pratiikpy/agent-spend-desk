import { describe, expect, it } from "vitest";

import { controlTasks, dateIs, harnessHash, LEGACY_HARNESS_NAMES, lastNumberIs, listIs, numbersTailAre, TASKS, timeIs, wordIs } from "../../../src/desk/canary/tasks.ts";

/**
 * The harness is named from what each checker declares, not from its source text. These tables are the other half of that bargain:
 * they score a fixed set of answers with every kind of checker, so that changing what a checker does without raising its version
 * fails here, instead of silently making every stored baseline look like a different harness or, worse, the same one.
 */
describe("the checkers do what their declared version says", () => {
  it("lastNumberIs reads the last number, tolerates a thousands comma and a little rounding, and nothing else", () => {
    const c = lastNumberIs(27.05);
    expect([c("27.05"), c("Change: $27.05"), c("working: 50 - 22.95 = 27.05"), c("27.054"), c("27.1"), c("27.05 is wrong, it is 28"), c(""), c("none")]).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect(lastNumberIs(2315.25)("2,315.25")).toBe(1);
    expect(lastNumberIs(96, 0)("96.0")).toBe(1);
    expect(lastNumberIs(96, 0)("96.01")).toBe(0);
  });

  it("wordIs accepts the word alone or as the last word, in any case, and not a different word", () => {
    const c = wordIs("Cy");
    expect([c("Cy"), c("cy."), c("The third tallest is Cy"), c("Cyrus"), c("Bo"), c("")]).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it("listIs reads the tail of the answer as an ordered list", () => {
    const c = listIs(["ann", "bo", "cy"]);
    expect([c("Ann, Bo, Cy"), c("The order is: ann bo cy"), c("cy, bo, ann"), c("ann bo"), c("")]).toEqual([1, 1, 0, 0, 0]);
  });

  it("dateIs and timeIs take the last date or time in the answer", () => {
    expect([dateIs("2026-03-04")("It is 2026-03-04."), dateIs("2026-03-04")("2026-03-05 then 2026-03-04"), dateIs("2026-03-04")("2026-03-04 then 2026-03-05"), dateIs("2026-03-04")("March 4")]).toEqual([1, 1, 0, 0]);
    expect([timeIs("09:05")("9:05"), timeIs("09:05")("at 09:05 sharp"), timeIs("09:05")("09:50"), timeIs("09:05")("noon")]).toEqual([1, 1, 0, 0]);
  });

  it("numbersTailAre needs the last numbers, in order", () => {
    const c = numbersTailAre([3, 5, 8]);
    expect([c("3, 5, 8"), c("1 2 3 5 8"), c("8, 5, 3"), c("5, 8"), c("3 5 8 13")]).toEqual([1, 1, 0, 0, 0]);
  });
});

describe("the harness has a name that does not depend on the compiler", () => {
  it("is pinned: changing a task, a prompt or a checker changes it, on purpose and visibly", () => {
    expect(harnessHash()).toBe(LEGACY_HARNESS_NAMES["sha256:d320fcfa0c60be6d6a9f72a1d7adfb26d2b9db9cd195d42eec00d2c66116ded7"]);
  });

  it("is made from declared kinds, and every task declares one", () => {
    for (const t of TASKS) {
      const spec = (t.check as unknown as { spec?: { kind: string; version: number; args: unknown[] } }).spec;
      expect(spec, t.id).toBeDefined();
      expect(spec!.version).toBeGreaterThanOrEqual(1);
    }
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length);
  });

  it("names the old source-text hash as the same harness, and only that one", () => {
    expect(Object.keys(LEGACY_HARNESS_NAMES)).toEqual(["sha256:d320fcfa0c60be6d6a9f72a1d7adfb26d2b9db9cd195d42eec00d2c66116ded7"]);
  });
});

describe("the control arm's tasks", () => {
  it("are three, from three different clusters, the same every day", () => {
    const a = controlTasks();
    expect(a).toHaveLength(3);
    expect(new Set(a.map((t) => t.cluster)).size).toBe(3);
    expect(controlTasks().map((t) => t.id)).toEqual(a.map((t) => t.id));
  });
});
