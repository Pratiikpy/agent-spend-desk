import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { auditTask } from "../../../src/desk/lab/audit.ts";
import { gradeWorkspace, parseTap } from "../../../src/desk/lab/grade.ts";
import { copyBase, loadTask, overlayGold, taskHash, TaskError } from "../../../src/desk/lab/task.ts";
import { TempDir } from "../helpers.ts";

const REAL = "lab/tasks/spike/interval-merge";

let dir: TempDir;
beforeEach(() => {
  dir = new TempDir();
});
afterEach(() => dir.dispose());

const HEAD = "const t = require('node:test'); const a = require('node:assert/strict'); const { add } = require('../src/add.js');\n";
const VISIBLE = `${HEAD}t('adds two numbers', () => a.equal(add(2, 3), 5));\nt('ignores zero', () => a.equal(add(0, 0), 0));\n`;
const HIDDEN = `${HEAD}t('adds negatives', () => a.equal(add(-2, -3), -5));\n`;

/** A complete task written into a temp folder, so each test can break one thing. */
function makeTask(over: { id: string; packageJson?: string; base?: string; gold?: string; visible?: string; hidden?: string; protectedPaths?: string[]; extraJson?: Record<string, unknown> }): string {
  const root = join(dir.path, over.id);
  for (const d of ["base/src", "base/test", "gold/src", "hidden/test"]) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, "base/package.json"), over.packageJson ?? '{"name":"toy","private":true,"scripts":{"test":"node --test"}}\n');
  writeFileSync(join(root, "base/src/add.js"), over.base ?? "exports.add = (a, b) => a - b;\n");
  writeFileSync(join(root, "gold/src/add.js"), over.gold ?? "exports.add = (a, b) => a + b;\n");
  writeFileSync(join(root, "base/test/visible.test.js"), over.visible ?? VISIBLE);
  writeFileSync(join(root, "hidden/test/hidden.test.js"), over.hidden ?? HIDDEN);
  writeFileSync(
    join(root, "task.json"),
    JSON.stringify({
      schema: "desk.lab.task.v1",
      id: over.id,
      title: "Toy add",
      kind: "bugfix",
      prompt: "add() subtracts. Make it add.",
      test: { files: ["test/visible.test.js", "test/hidden.test.js"], timeoutSec: 30 },
      protected: over.protectedPaths ?? ["test"],
      origin: { type: "handwritten", licence: "MIT" },
      ...(over.extraJson ?? {}),
    }),
  );
  return root;
}

describe("loading a task", () => {
  it("loads the real spike task and hashes it the same way twice", () => {
    const t = loadTask(REAL);
    expect(t.id).toBe("interval-merge");
    expect(taskHash(t)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(taskHash(t)).toBe(taskHash(loadTask(REAL)));
  });

  it("refuses a task whose id does not match its folder, an unknown field, or a path that climbs out", () => {
    expect(() => loadTask(makeTask({ id: "toy-a", extraJson: { id: "toy-b" } }))).toThrow(TaskError);
    expect(() => loadTask(makeTask({ id: "toy-c", extraJson: { surprise: 1 } }))).toThrow(/unknown field/);
    expect(() => loadTask(makeTask({ id: "toy-d", protectedPaths: ["../outside"] }))).toThrow(/relative path/);
  });

  it("refuses a task that names a protected path which exists nowhere", () => {
    expect(() => loadTask(makeTask({ id: "toy-e", protectedPaths: ["nothing-here"] }))).toThrow(/neither base\/ nor hidden\//);
  });

  it("changes its hash when the hidden tests change", () => {
    const root = makeTask({ id: "toy-f" });
    const before = taskHash(loadTask(root));
    writeFileSync(join(root, "hidden/test/hidden.test.js"), `${readFileSync(join(root, "hidden/test/hidden.test.js"), "utf8")}\n// changed\n`);
    expect(taskHash(loadTask(root))).not.toBe(before);
  });
});

describe("reading test output", () => {
  it("reads test names and outcomes from TAP, ignores nested lines, and sees skips and todos as not passed", () => {
    const tap = ["TAP version 13", "# Subtest: a", "ok 1 - a", "  ---", "  duration_ms: 1", "  ...", "not ok 2 - b", "ok 3 - c # SKIP later", "ok 4 - d # TODO soon", "1..4", "# tests 4", "# pass 1", "# fail 1", "# skipped 1", "# todo 1"].join("\n");
    const r = parseTap(tap);
    expect(r.tests).toEqual([
      { name: "a", ok: true, skipped: false },
      { name: "b", ok: false, skipped: false },
      { name: "c", ok: false, skipped: true },
      { name: "d", ok: false, skipped: true },
    ]);
    expect(r.summary).toEqual({ tests: 4, pass: 1, fail: 1, skipped: 1, todo: 1 });
  });

  it("returns no summary for output that is not a test run", () => {
    expect(parseTap("Error: Cannot find module").summary).toBeNull();
  });
});

describe("the audit", () => {
  it("passes the real spike task and records which tests must go from failing to passing", () => {
    const r = auditTask(loadTask(REAL));
    expect(r.findings.filter((f) => !f.ok)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.expected?.total).toBe(12);
    expect(r.expected?.fail_to_pass.length).toBe(12);
    expect(r.expected?.pass_to_pass.length).toBe(0);
  });

  it("passes a sound toy task and sorts its tests into must-flip and must-stay-green", () => {
    const r = auditTask(loadTask(makeTask({ id: "toy-g" })));
    expect(r.ok).toBe(true);
    expect(r.expected?.pass_to_pass).toEqual(["ignores zero"]);
    expect([...(r.expected?.fail_to_pass ?? [])].sort()).toEqual(["adds negatives", "adds two numbers"]);
  });

  it("fails a task whose gold change leaves a test failing", () => {
    const r = auditTask(loadTask(makeTask({ id: "toy-h", gold: "exports.add = (a, b) => a + b + 1;\n" })));
    expect(r.ok).toBe(false);
    expect(r.findings.find((f) => f.check === "gold-passes-everything")?.ok).toBe(false);
    expect(r.expected).toBeNull();
  });

  it("fails a task where nothing fails before the change, because it measures nothing", () => {
    const r = auditTask(loadTask(makeTask({ id: "toy-i", base: "exports.add = (a, b) => a + b;\n" })));
    expect(r.ok).toBe(false);
    expect(r.findings.find((f) => f.check === "starting-state-fails")?.ok).toBe(false);
  });

  it("fails a task with two tests of the same name", () => {
    const dup = `${HEAD}t('same', () => a.equal(add(2, 3), 5));\nt('same', () => a.equal(add(1, 1), 2));\n`;
    expect(auditTask(loadTask(makeTask({ id: "toy-j", visible: dup }))).findings.find((f) => f.check === "test-names-unique")?.ok).toBe(false);
  });

  it("fails a task whose repository has no test script, since npm would then run a parent project's suite", () => {
    const r = auditTask(loadTask(makeTask({ id: "toy-np", packageJson: '{"name":"toy","private":true}\n' })));
    expect(r.ok).toBe(false);
    expect(r.findings.find((f) => f.check === "npm-test-runs-the-task-tests")?.detail).toMatch(/parent project/);
    const other = auditTask(loadTask(makeTask({ id: "toy-np2", packageJson: '{"scripts":{"test":"vitest run"}}\n' })));
    expect(other.findings.find((f) => f.check === "npm-test-runs-the-task-tests")?.ok).toBe(false);
  });

  it("fails a task with a skipped test", () => {
    const skip = `${HEAD}t('adds two numbers', () => a.equal(add(2, 3), 5));\nt('later', { skip: true }, () => {});\n`;
    expect(auditTask(loadTask(makeTask({ id: "toy-k", visible: skip }))).findings.find((f) => f.check === "no-skipped-tests")?.ok).toBe(false);
  });

  it("fails a task whose tests give different results from one run to the next", () => {
    const flaky = [
      "const t = require('node:test'); const a = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');",
      "t('flips', () => {",
      "  const f = path.join(__dirname, '..', 'count.txt');",
      "  let n = 0; try { n = Number(fs.readFileSync(f, 'utf8')); } catch {}",
      "  fs.writeFileSync(f, String(n + 1));",
      "  a.ok(n % 2 === 1);",
      "});",
      "",
    ].join("\n");
    const root = makeTask({ id: "toy-l", base: "exports.add = (a, b) => a + b;\n", hidden: flaky, visible: `${HEAD}t('adds two numbers', () => a.equal(add(2, 3), 5));\n` });
    // The counter lives next to the test, and the grader copies the workspace fresh each time, so it would reset.
    // Persist it outside the copy instead, through the temp folder the tests share.
    writeFileSync(join(root, "hidden/test/hidden.test.js"), flaky.replace("path.join(__dirname, '..', 'count.txt')", `${JSON.stringify(join(dir.path, "flaky-count.txt"))}`));
    const r = auditTask(loadTask(root), { gradeRepeats: 4 });
    expect(r.ok).toBe(false);
  });
});

describe("grading a workspace", () => {
  const sound = (id: string) => {
    const t = loadTask(makeTask({ id }));
    const r = auditTask(t);
    expect(r.ok).toBe(true);
    return { t, e: r.expected! };
  };

  it("passes the gold change and fails the starting state", () => {
    const { t, e } = sound("toy-m");
    const ws = join(dir.path, "ws-m");
    copyBase(t, ws);
    expect(gradeWorkspace(t, ws, e).verdict).toBe("fail");
    overlayGold(t, ws);
    expect(gradeWorkspace(t, ws, e)).toMatchObject({ verdict: "pass", f2pPassed: e.fail_to_pass.length, ran: e.total });
  });

  it("passes a different correct solution, not only the gold one", () => {
    const { t, e } = sound("toy-n");
    const ws = join(dir.path, "ws-n");
    copyBase(t, ws);
    writeFileSync(join(ws, "src/add.js"), "exports.add = function add(a, b) { return -(-a - b); };\n");
    expect(gradeWorkspace(t, ws, e).verdict).toBe("pass");
  });

  it("restores edited tests, so rewriting a test to expect the wrong answer does not pass", () => {
    const { t, e } = sound("toy-o");
    const ws = join(dir.path, "ws-o");
    copyBase(t, ws);
    writeFileSync(join(ws, "test/visible.test.js"), "const t = require('node:test'); t('adds two numbers', () => {}); t('ignores zero', () => {});\n");
    expect(gradeWorkspace(t, ws, e).verdict).toBe("fail");
  });

  it("puts a tampered hidden test back, so a correct fix still passes", () => {
    const { t, e } = sound("toy-p");
    const ws = join(dir.path, "ws-p");
    copyBase(t, ws);
    overlayGold(t, ws);
    mkdirSync(join(ws, "test"), { recursive: true });
    writeFileSync(join(ws, "test/hidden.test.js"), "const t = require('node:test'); t('adds negatives', () => {});\n");
    expect(gradeWorkspace(t, ws, e).verdict).toBe("pass");
  });

  it("fails a run that hangs, within the task's time limit", () => {
    const { t, e } = sound("toy-q");
    const quick = { ...t, test: { ...t.test, timeoutSec: 5 } };
    const ws = join(dir.path, "ws-q");
    copyBase(t, ws);
    overlayGold(t, ws);
    writeFileSync(join(ws, "src/add.js"), "while (true) {}\n");
    const g = gradeWorkspace(quick, ws, e);
    expect(g.verdict).toBe("fail");
    expect(g.timedOut).toBe(true);
  });

  it("writes nothing into the agent's workspace while grading", () => {
    const { t, e } = sound("toy-r");
    const ws = join(dir.path, "ws-r");
    copyBase(t, ws);
    overlayGold(t, ws);
    const before = readFileSync(join(ws, "src/add.js"), "utf8");
    gradeWorkspace(t, ws, e);
    expect(readFileSync(join(ws, "src/add.js"), "utf8")).toBe(before);
    expect(() => readFileSync(join(ws, "test/hidden.test.js"))).toThrow();
  });
});
