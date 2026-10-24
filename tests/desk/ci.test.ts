import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RunRow } from "../../src/desk/canary/runner.ts";
import { harnessHash, TASKS } from "../../src/desk/canary/tasks.ts";
import { readRows } from "../../src/desk/canary/store.ts";
import { ciCommand, ciWorkflowSnippet } from "../../src/desk/ci/command.ts";
import { ciGate } from "../../src/desk/ci/gate.ts";
import { ciStudy } from "../../src/desk/ci/simulate.ts";
import { testSnapshot } from "./helpers.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "desk-ci-"));
  dirs.push(d);
  return d;
};

interface Pack {
  /** The score of repeat `r` of task `i`: 1, 0 or null for an attempt that produced no score. */
  score: (i: number, r: number) => 0 | 1 | null;
  tasks?: number;
  repeats?: number;
  model?: string;
  harness?: string;
  tokensIn?: number;
  tokensOut?: number;
  tokens?: (i: number) => { in: number; out: number };
}

function pack(p: Pack): RunRow[] {
  const rows: RunRow[] = [];
  const n = p.tasks ?? TASKS.length;
  for (let i = 0; i < n; i += 1) {
    for (let r = 0; r < (p.repeats ?? 5); r += 1) {
      const tok = p.tokens?.(i);
      rows.push({
        day: 1, date: "2026-10-20", arm: "primary", taskId: (TASKS[i] as (typeof TASKS)[number]).id, servedModel: p.model ?? "claude-sonnet-5-5", score: p.score(i, r), error: null, latencyMs: 100,
        tokensIn: tok?.in ?? p.tokensIn ?? 200, tokensOut: tok?.out ?? p.tokensOut ?? 100, replySha: null, harness: p.harness ?? harnessHash(), cacheBypass: true,
      });
    }
  }
  return rows;
}

/** A baseline in which most tasks pass, with a little variation from task to task. */
const base = (i: number, r: number): 0 | 1 => ((i * 7 + r * 3) % 10 < 8 ? 1 : 0);

describe("the quality verdict", () => {
  it("passes a candidate that scores the same, and says what it ruled out", () => {
    const r = ciGate({ baseline: pack({ score: base }), candidate: pack({ score: base }) });
    expect(r.verdict).toBe("pass");
    expect(r.exitCode).toBe(0);
    expect(r.quality.delta).toBe(0);
    expect(r.quality.reason).toMatch(/no drop of 3 points or more/);
    expect(r.quality.tasks).toBe(TASKS.length);
  });

  it("fails a candidate that fell across the suite, in both halves of the tasks", () => {
    const worse = (i: number, r: number): 0 | 1 => (base(i, r) === 1 && (i + r) % 3 === 0 ? 0 : base(i, r));
    const r = ciGate({ baseline: pack({ score: base }), candidate: pack({ score: worse }) });
    expect(r.verdict).toBe("fail");
    expect(r.exitCode).toBe(1);
    expect(r.quality.delta!).toBeLessThan(-0.03);
    expect(r.quality.ci!.high).toBeLessThan(0);
    expect(r.quality.heldOutDelta!).toBeLessThan(0);
    expect(r.quality.reason).toContain("and the held-out half of the tasks fell too");
    expect(r.headline).toMatch(/^FAIL: quality: the pass rate fell -/);
  });

  it("calls a rise a pass, and says it rose", () => {
    const better = (i: number, r: number): 0 | 1 => (base(i, r) === 0 && (i + r) % 2 === 0 ? 1 : base(i, r));
    const r = ciGate({ baseline: pack({ score: base }), candidate: pack({ score: better }) });
    expect(r.verdict).toBe("pass");
    expect(r.quality.reason).toMatch(/^the pass rate rose \+/);
  });

  it("does not fail a fall carried by one task of twenty: the interval cannot rule out no change", () => {
    const some = 20;
    const baseline = pack({ tasks: some, score: () => 1 });
    const candidate = pack({ tasks: some, score: (i) => (i === 0 ? 0 : 1) }); // one task of twenty fell from always to never: -5 points
    const r = ciGate({ baseline, candidate });
    expect(r.verdict).toBe("inconclusive");
    expect(r.exitCode).toBe(3);
    expect(r.quality.delta!).toBeCloseTo(-0.05, 5);
    expect(r.quality.reason).toMatch(/so a drop that size is not ruled out, and it does not show one either/);
  });

  it("does not fail a fall that the held-out half of the tasks does not share", () => {
    // Only the even tasks fell. The held-out half is every second task by position.
    const baseline = pack({ score: () => 1 });
    const candidate = pack({ score: (i, r) => (i % 2 === 0 && r < 3 ? 0 : 1) });
    const r = ciGate({ baseline, candidate });
    expect(r.verdict).toBe("inconclusive");
    expect(r.quality.reason).toMatch(/the held-out half of the tasks did not fall with it/);
  });

  it("is inconclusive, not a pass, when the interval cannot rule out a drop and cannot show one", () => {
    // The kinds of task that gain and the kinds that lose roughly cancel: a small mean change with a wide interval, because a kind of task is one unit.
    const kind = (i: number): number => Math.floor(i / 4);
    const candidate = pack({ score: (i, r) => (kind(i) % 2 === 0 ? 1 : r < 2 ? 1 : 0) });
    const baseline = pack({ score: (i, r) => (kind(i) % 2 === 0 ? (r < 2 ? 1 : 0) : 1) });
    const r = ciGate({ baseline, candidate });
    expect(r.verdict).toBe("inconclusive");
    expect(r.exitCode).toBe(3);
    expect(r.quality.reason).toMatch(/so a drop that size is not ruled out, and it does not show one either/);
  });

  it("is inconclusive with too few tasks, and says how many are the fewest", () => {
    const r = ciGate({ baseline: pack({ tasks: 8, score: () => 1 }), candidate: pack({ tasks: 8, score: () => 1 }) });
    expect(r.verdict).toBe("inconclusive");
    expect(r.quality.reason).toBe("only 8 tasks have scores on both sides; 12 are the fewest that can support a call");
  });

  it("is inconclusive when too many of the candidate's attempts produced no score", () => {
    const candidate = pack({ score: (i, r) => ((i + r) % 8 === 0 ? null : base(i, r)) });
    const r = ciGate({ baseline: pack({ score: base }), candidate });
    expect(r.verdict).toBe("inconclusive");
    expect(r.quality.reason).toMatch(/12% of the candidate's attempts produced no score/);
  });

  it("is inconclusive when the harness changed, because the tasks or their checks differ", () => {
    const r = ciGate({ baseline: pack({ score: base }), candidate: pack({ score: base, harness: "v9:sha256:other" }) });
    expect(r.verdict).toBe("inconclusive");
    expect(r.quality.reason).toMatch(/the harness changed between the baseline and the candidate/);
  });

  it("says when there is nothing to compare, instead of passing", () => {
    expect(ciGate({ baseline: [], candidate: pack({ score: base }) }).quality.reason).toMatch(/the baseline holds no primary-arm runs/);
    expect(ciGate({ baseline: pack({ score: base }), candidate: [] }).quality.reason).toMatch(/the candidate holds no primary-arm runs/);
    const controlOnly = pack({ score: base }).map((r) => ({ ...r, arm: "control" as const }));
    expect(ciGate({ baseline: controlOnly, candidate: pack({ score: base }) }).verdict).toBe("inconclusive");
  });

  it("notes a change of the model served, since that is usually the change under test", () => {
    const r = ciGate({ baseline: pack({ score: base, model: "claude-sonnet-5-5" }), candidate: pack({ score: base, model: "claude-opus-5" }) });
    expect(r.notes).toContain("the model served changed: claude-sonnet-5-5 in the baseline, claude-opus-5 in the candidate");
  });

  it("gives the same answer twice", () => {
    const worse = (i: number, r: number): 0 | 1 => (base(i, r) === 1 && (i + r) % 3 === 0 ? 0 : base(i, r));
    const a = ciGate({ baseline: pack({ score: base }), candidate: pack({ score: worse }) });
    const b = ciGate({ baseline: pack({ score: base }), candidate: pack({ score: worse }) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("the cost verdict", () => {
  const snapshot = testSnapshot();
  const same = (i: number, r: number): 0 | 1 => base(i, r);
  // Tokens vary a little from task to task, so that the intervals are not degenerate.
  const tok = (scale: number) => (i: number) => ({ in: Math.round((200 + (i % 5) * 20) * scale), out: Math.round((100 + (i % 4) * 10) * scale) });

  it("passes when cost per attempt did not rise past the bound, with the interval that shows it", () => {
    const r = ciGate({ baseline: pack({ score: same, tokens: tok(1) }), candidate: pack({ score: same, tokens: tok(1.02) }), maxCostIncrease: 0.1, snapshot });
    expect(r.cost.verdict).toBe("pass");
    expect(r.cost.change!).toBeCloseTo(0.02, 2);
    expect(r.verdict).toBe("pass");
  });

  it("fails when the interval for the rise lies wholly past the bound", () => {
    const r = ciGate({ baseline: pack({ score: same, tokens: tok(1) }), candidate: pack({ score: same, tokens: tok(2) }), maxCostIncrease: 0.1, snapshot });
    expect(r.cost.verdict).toBe("fail");
    expect(r.verdict).toBe("fail");
    expect(r.exitCode).toBe(1);
    expect(r.headline).toMatch(/cost: cost per attempt rose \+100\.0%/);
  });

  it("is inconclusive when the interval reaches past the bound without showing the rise", () => {
    // A rise of 12% in the mean, but carried by a few tasks, so the interval is wide.
    const kind = (i: number): number => Math.floor(i / 4);
    const noisy = (i: number) => ({ in: kind(i) % 2 === 0 ? 400 : 20, out: kind(i) % 2 === 0 ? 100 : 20 });
    const quiet = (i: number) => ({ in: kind(i) % 2 === 0 ? 20 : 400, out: kind(i) % 2 === 0 ? 20 : 100 });
    const r = ciGate({ baseline: pack({ score: same, tokens: quiet }), candidate: pack({ score: same, tokens: noisy }), maxCostIncrease: 0.1, snapshot });
    expect(r.cost.verdict).toBe("inconclusive");
    expect(r.exitCode).toBe(3);
  });

  it("does not guess a cost for a model with no price, and says it was not evaluated", () => {
    const r = ciGate({ baseline: pack({ score: same, model: "some-local-model" }), candidate: pack({ score: same, model: "some-local-model" }), maxCostIncrease: 0.1, snapshot });
    expect(r.cost.verdict).toBe("not_evaluated");
    expect(r.cost.reason).toMatch(/has no price/);
    expect(r.verdict).toBe("pass"); // quality alone decides when cost cannot be priced, and the note says so
    expect(r.notes.some((n) => n.startsWith("cost not evaluated"))).toBe(true);
  });

  it("is not evaluated when no bound was set, or no price list was given", () => {
    expect(ciGate({ baseline: pack({ score: same }), candidate: pack({ score: same }), snapshot }).cost.reason).toBe("no cost bound was set");
    expect(ciGate({ baseline: pack({ score: same }), candidate: pack({ score: same }), maxCostIncrease: 0.1 }).cost.reason).toMatch(/no price list was given/);
  });

  it("fails on a cost rise even when quality held, and on a fall in quality even when cost fell", () => {
    expect(ciGate({ baseline: pack({ score: same, tokens: tok(1) }), candidate: pack({ score: same, tokens: tok(3) }), maxCostIncrease: 0.2, snapshot }).verdict).toBe("fail");
    const worse = (i: number, r: number): 0 | 1 => (base(i, r) === 1 && (i + r) % 3 === 0 ? 0 : base(i, r));
    expect(ciGate({ baseline: pack({ score: same, tokens: tok(1) }), candidate: pack({ score: worse, tokens: tok(0.5) }), maxCostIncrease: 0.2, snapshot }).verdict).toBe("fail");
  });
});

function write(dir: string, name: string, rows: RunRow[]): string {
  const p = join(dir, name);
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

describe("desk ci, the command a pipeline calls", () => {
  const worse = (i: number, r: number): 0 | 1 => (base(i, r) === 1 && (i + r) % 3 === 0 ? 0 : base(i, r));

  it("exits 0 for a pass, 1 for a fail and 3 for an inconclusive, which is never a pass", () => {
    const d = tmp();
    const b = write(d, "base.jsonl", pack({ score: base }));
    expect(ciCommand({ baselinePath: b, candidatePath: write(d, "same.jsonl", pack({ score: base })), format: "text" }).exitCode).toBe(0);
    expect(ciCommand({ baselinePath: b, candidatePath: write(d, "worse.jsonl", pack({ score: worse })), format: "text" }).exitCode).toBe(1);
    const few = ciCommand({ baselinePath: b, candidatePath: write(d, "few.jsonl", pack({ tasks: 6, score: base })), format: "text" });
    expect(few.exitCode).toBe(3);
    expect(few.text).toMatch(/^INCONCLUSIVE:/);
  });

  it("exits 2 when it could not run, and says why", () => {
    const d = tmp();
    const b = write(d, "base.jsonl", pack({ score: base }));
    expect(ciCommand({ baselinePath: join(d, "missing.jsonl"), candidatePath: b, format: "text" })).toMatchObject({ exitCode: 2 });
    expect(ciCommand({ baselinePath: join(d, "missing.jsonl"), candidatePath: b, format: "text" }).text).toMatch(/--baseline .* does not exist/);
    writeFileSync(join(d, "junk.jsonl"), "not json\n{}\n");
    expect(ciCommand({ baselinePath: b, candidatePath: join(d, "junk.jsonl"), format: "text" }).text).toMatch(/holds no usable canary rows \(2 lines were skipped\)/);
    expect(ciCommand({ baselinePath: b, candidatePath: b, minDelta: 5, format: "text" }).text).toMatch(/--min-delta must be between 0 and 1/);
    expect(ciCommand({ baselinePath: b, candidatePath: b, level: 0.1, format: "text" }).exitCode).toBe(2);
    expect(ciCommand({ baselinePath: b, candidatePath: b, maxCostIncrease: -1, format: "text" }).exitCode).toBe(2);
    expect(ciCommand({ baselinePath: b, candidatePath: b, maxCostIncrease: 0.1, pricesPath: join(d, "nope.json"), format: "text" }).text).toMatch(/the price list could not be read/);
  });

  it("lets the pipeline decide what an inconclusive result does, and says it is not a pass when it lets it through", () => {
    const d = tmp();
    const b = write(d, "base.jsonl", pack({ score: base }));
    const c = write(d, "few.jsonl", pack({ tasks: 6, score: base }));
    expect(ciCommand({ baselinePath: b, candidatePath: c, format: "text", onInconclusive: "fail" }).exitCode).toBe(1);
    const lenient = ciCommand({ baselinePath: b, candidatePath: c, format: "text", onInconclusive: "pass" });
    expect(lenient.exitCode).toBe(0);
    expect(lenient.text).toContain("exits 0 only because --on-inconclusive pass was given; that is not a pass");
    expect(lenient.result!.verdict).toBe("inconclusive");
    // A fail is never softened by that setting.
    expect(ciCommand({ baselinePath: b, candidatePath: write(d, "worse.jsonl", pack({ score: worse })), format: "text", onInconclusive: "pass" }).exitCode).toBe(1);
  });

  it("prints the verdict as text, as JSON and as a pull-request comment", () => {
    const d = tmp();
    const b = write(d, "base.jsonl", pack({ score: base }));
    const c = write(d, "worse.jsonl", pack({ score: worse }));
    const text = ciCommand({ baselinePath: b, candidatePath: c, format: "text" }).text;
    expect(text).toContain("Quality: fail.");
    expect(text).toContain("Exit codes: 0 pass, 1 fail, 2 could not run, 3 inconclusive (never a pass).");
    const json = JSON.parse(ciCommand({ baselinePath: b, candidatePath: c, format: "json" }).text) as { verdict: string; exit_code: number; quality: { delta: number } };
    expect(json).toMatchObject({ verdict: "fail", exit_code: 1 });
    expect(json.quality.delta).toBeLessThan(-0.03);
    const md = ciCommand({ baselinePath: b, candidatePath: c, format: "markdown" }).text;
    expect(md).toMatch(/^### Canary gate: FAIL/);
    expect(md).toContain("| Pass rate (52 paired tasks) |");
    expect(md).toContain("_Inconclusive is never a pass");
  });

  it("writes an evidence pack that names its inputs by hash and carries the settings and the per-task table", () => {
    const d = tmp();
    const b = write(d, "base.jsonl", pack({ score: base }));
    const c = write(d, "worse.jsonl", pack({ score: worse }));
    const out = join(d, "evidence");
    const r = ciCommand({ baselinePath: b, candidatePath: c, format: "text", evidenceDir: out, minDelta: 0.05 });
    expect(r.text).toContain("Evidence written to");
    const pack1 = JSON.parse(readFileSync(join(out, "ci-gate.json"), "utf8")) as { schema: string; verdict: string; settings: { min_delta: number }; inputs: { baseline: { sha256: string; rows: number } }; result: { quality: { perTask: unknown[] } } };
    expect(pack1).toMatchObject({ schema: "desk.ci-gate.v1", verdict: "fail", settings: { min_delta: 0.05 } });
    expect(pack1.inputs.baseline.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pack1.inputs.baseline.rows).toBe(TASKS.length * 5);
    expect(pack1.result.quality.perTask).toHaveLength(TASKS.length);
    expect(readFileSync(join(out, "ci-gate.md"), "utf8")).toMatch(/^### Canary gate: FAIL/);
  });

  it("gates on cost when a bound is given, pricing the tokens from the price list", () => {
    const d = tmp();
    const tok = (scale: number) => (i: number) => ({ in: Math.round((200 + (i % 5) * 20) * scale), out: Math.round((100 + (i % 4) * 10) * scale) });
    const b = write(d, "base.jsonl", pack({ score: base, tokens: tok(1) }));
    const c = write(d, "costly.jsonl", pack({ score: base, tokens: tok(2) }));
    const r = ciCommand({ baselinePath: b, candidatePath: c, format: "text", maxCostIncrease: 0.1 });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/Cost: fail\. cost per attempt rose \+100\.0%/);
    expect(ciCommand({ baselinePath: b, candidatePath: c, format: "text" }).exitCode).toBe(0); // no bound, no cost gate
  });

  it("prints a pipeline step that uses the exit-code contract", () => {
    const yaml = ciWorkflowSnippet();
    expect(yaml).toContain("npm run desk -- ci --baseline");
    expect(yaml).toContain("0 pass, 1 fail, 3 inconclusive (never a pass), 2 could not run");
    expect(yaml).toContain("canary run --runs candidate.jsonl");
  });
});

describe("the gate on the recorded 30-day canary, where a regression was planted on day 15", () => {
  const { rows } = readRows("data/sample/canary/runs.jsonl");
  const week = (from: number, to: number): RunRow[] => rows.filter((r) => r.day >= from && r.day <= to);

  it("fails the pack run after the planted regression, with the size of the fall", () => {
    const r = ciGate({ baseline: week(1, 7), candidate: week(15, 15) });
    expect(r.verdict).toBe("fail");
    expect(r.exitCode).toBe(1);
    expect(r.quality.delta!).toBeLessThan(-0.3);
    expect(r.quality.ci!.high).toBeLessThan(-0.2);
  });

  it("does not pass the quiet week: one pack of 52 tasks cannot rule out a drop of 3 points at 99%, and says so", () => {
    const r = ciGate({ baseline: week(1, 7), candidate: week(8, 14) });
    expect(r.verdict).toBe("inconclusive");
    expect(r.exitCode).toBe(3);
    expect(r.quality.ci!.low).toBeLessThan(-0.03);
    expect(r.quality.ci!.low).toBeGreaterThan(-0.07);
    // A change that matters less to the team can be certified: at 6 points the same week passes.
    const lenient = ciGate({ baseline: week(1, 7), candidate: week(8, 14), minDelta: 0.06 });
    expect(lenient.verdict).toBe("pass");
  });

  it("makes no call on a day when a tenth of the attempts produced no score, rather than reading a fall into it", () => {
    const r = ciGate({ baseline: week(1, 7), candidate: week(14, 14) });
    expect(r.verdict).toBe("inconclusive");
    expect(r.quality.reason).toMatch(/produced no score/);
  });
});

describe("the gate on packs whose truth is known (a seeded study, no model)", () => {
  // Task pass probabilities spread from 0.97 to 0.10, five repeats of each of the 52 tasks per pack, 400 pairs per row below.
  it("rarely calls a fall when nothing changed, and mostly makes no call either way", () => {
    const s = ciStudy({ trials: 400, drop: 0, seed: 20261025 });
    expect(s.verdicts.fail).toBeLessThanOrEqual(8); // 2% of 400; measured 1 (0.25%)
    expect(s.verdicts.inconclusive).toBeGreaterThan(300); // a pack this size seldom certifies "no drop of 3 points"; it says so rather than pass
    expect(s.verdicts.pass + s.verdicts.fail + s.verdicts.inconclusive).toBe(400);
  }, 60_000);

  it("finds a large fall nearly always and a small one seldom, which is what an interval this wide can do", () => {
    const big = ciStudy({ trials: 400, drop: 0.2, seed: 20261025 });
    const mid = ciStudy({ trials: 400, drop: 0.1, seed: 20261025 });
    const small = ciStudy({ trials: 400, drop: 0.03, seed: 20261025 });
    expect(big.verdicts.fail).toBeGreaterThan(360); // measured 383 of 400
    expect(mid.verdicts.fail).toBeGreaterThan(120); // measured 190: a 10-point fall is called about half the time
    expect(mid.verdicts.fail).toBeLessThan(big.verdicts.fail);
    expect(small.verdicts.fail).toBeLessThan(mid.verdicts.fail);
    expect(big.verdicts.pass + mid.verdicts.pass + small.verdicts.pass).toBeLessThan(12); // a real fall is almost never passed
  }, 120_000);
});
