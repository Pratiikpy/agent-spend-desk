import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { demo } from "../../src/desk/demo.ts";
import { SAMPLE_RUNS } from "../../src/desk/canary/command.ts";
import { canaryFigures, steadyRows } from "../../src/desk/demo-figures.ts";
import { readRows } from "../../src/desk/canary/store.ts";

/**
 * The demo (DF-014 to DF-019, DF-114): every scene reproduces offline inside the video's budget, opens on the user's question, closes on the command to run on their own logs,
 * and the same figures move when the sample is changed.
 */
const root = mkdtempSync(join(tmpdir(), "desk-demo-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";

describe("the demo", () => {
  it("runs every scene offline in under the 230 second budget, opens on the question and closes on the command for the judge's own logs", async () => {
    const lines: string[] = [];
    const t0 = Date.now();
    await demo({ sampleDir: join(root, "sample"), prices: PRICES, cassetteDir: "data/sample/cassettes", out: (t) => lines.push(t) });
    const seconds = (Date.now() - t0) / 1000;
    const text = lines.join("\n");
    expect(seconds).toBeLessThanOrEqual(230);
    const headings = [...text.matchAll(/^(Opening|Scene \w+|Closing)  (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual(["Opening", "Scene 0", "Scene 1", "Scene 1b", "Scene 2", "Scene 3", "Scene 4", "Scene 4b", "Scene 4c", "Scene 4d", "Closing"]);
    expect(text).toMatch(/Opening {2}Where did my limit go\?/);
    expect(text).toMatch(/Closing {2}Run it on your own logs\nRun `desk` on your own logs right now/);
    expect(text).toMatch(/Canary, day \d+ .*regressed/s);
    expect(text).toMatch(/biggest waste block: C-[A-Z]+-?\d?, \$\d+\.\d\d, \d+ calls/);
    expect(text).toMatch(/PASS/);
    expect(text).not.toMatch(/E_CASSETTE_MISS|undefined|NaN/);
  }, 230_000);

  it("shows every figure moving when the sample is changed, and the canary turning steady when the model never changed", async () => {
    const lines: string[] = [];
    await demo({ sampleDir: join(root, "sample"), prices: PRICES, cassetteDir: "data/sample/cassettes", out: (t) => lines.push(t), compare: true, mutate: 20261101 });
    const text = lines.join("\n");
    expect(text).toMatch(/scene 2 {2}canary verdict, day 30\n {6}recorded: regressed\n {6}changed: {2}steady/);
    expect(text).toMatch(/scene 0 {2}estimated spend over the sample .*\n {6}recorded: \$[\d.]+ over [\d,]+ calls\n {6}changed: {2}\$[\d.]+ over [\d,]+ calls/);
    expect(text).toMatch(/\d+ of \d+ figures moved\./);
  }, 230_000);

  it("makes a canary file in which the model never changed, from the recorded one, without touching the recorded one", () => {
    const rows = readRows(SAMPLE_RUNS).rows;
    const before = JSON.stringify(rows);
    const steady = steadyRows(rows);
    expect(JSON.stringify(rows)).toBe(before);
    expect(steady).toHaveLength(rows.length);
    expect(canaryFigures(rows).find((f) => f.id === "canary.verdict")?.value).toBe("regressed");
    expect(canaryFigures(steady).find((f) => f.id === "canary.verdict")?.value).toBe("steady");
    expect(steady.filter((r) => r.day <= 14).every((r, i) => r === rows.filter((x) => x.day <= 14)[i])).toBe(true);
  });
});
