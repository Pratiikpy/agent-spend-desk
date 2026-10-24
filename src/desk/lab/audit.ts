import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gradeWorkspace, prepareGradingCopy, runTests } from "./grade.ts";
import { copyBase, overlayGold, walkFiles, type Expected, type LabTask } from "./task.ts";

/**
 * The task validity audit. SWE-bench's own audits found tasks whose tests reject correct fixes or demand details the
 * description never states, and agents that pass by changing the tests. Before any run, each task must therefore show:
 * the gold change passes every test, the starting state fails at least one, test names are unique and stable, the
 * result is not flaky, and four cheating moves fail: deleting the tests, replacing them, exiting early, and doing nothing.
 */
export interface AuditFinding {
  check: string;
  ok: boolean;
  detail: string;
}

export interface AuditResult {
  taskId: string;
  ok: boolean;
  findings: AuditFinding[];
  expected: Expected | null;
}

export function auditTask(task: LabTask, opts: { gradeRepeats?: number } = {}): AuditResult {
  const findings: AuditFinding[] = [];
  const add = (check: string, ok: boolean, detail: string): boolean => {
    findings.push({ check, ok, detail });
    return ok;
  };
  const scratch = mkdtempSync(join(tmpdir(), "desk-lab-audit-"));
  try {
    const baseWs = join(scratch, "base");
    const goldWs = join(scratch, "gold");
    copyBase(task, baseWs);
    copyBase(task, goldWs);
    overlayGold(task, goldWs);

    const runOn = (ws: string) => {
      const copy = prepareGradingCopy(task, ws, join(scratch, "copies"));
      try {
        return runTests(task, copy);
      } finally {
        rmSync(copy, { recursive: true, force: true });
      }
    };

    const base = runOn(baseWs);
    const gold = runOn(goldWs);
    const names = (r: typeof base) => r.tap.tests.map((t) => t.name);
    const unique = (xs: string[]) => new Set(xs).size === xs.length;

    add("tests-run-on-base", base.tap.tests.length > 0 && base.tap.summary !== null, `${base.tap.tests.length} tests reported on the starting state`);
    add("tests-run-on-gold", gold.tap.tests.length > 0 && gold.tap.summary !== null, `${gold.tap.tests.length} tests reported with the gold change`);
    add("test-names-unique", unique(names(base)) && unique(names(gold)), "every test has its own name, so results can be matched by name");
    add("same-tests-before-and-after", JSON.stringify(names(base).slice().sort()) === JSON.stringify(names(gold).slice().sort()), "the gold change adds and removes no test");
    const goldFailed = gold.tap.tests.filter((t) => !t.ok).map((t) => t.name);
    add("gold-passes-everything", goldFailed.length === 0 && !gold.timedOut, goldFailed.length === 0 ? "the gold change passes every test" : `fails with the gold change: ${goldFailed.join("; ")}`);
    // The agent is told to run `npm test`. Without a test script in the repository, npm walks up to a parent package.json and runs
    // something else entirely, which is how four of the first ten spike tasks sent the agent to the wrong test suite.
    let testScript = "";
    try {
      const pkg = JSON.parse(readFileSync(join(baseWs, "package.json"), "utf8")) as { scripts?: { test?: unknown } };
      testScript = typeof pkg.scripts?.test === "string" ? pkg.scripts.test : "";
    } catch {
      /* no package.json, or not JSON */
    }
    add("npm-test-runs-the-task-tests", /\bnode\b.*--test\b/.test(testScript), testScript === "" ? "base/package.json has no test script, so `npm test` would run a parent project's suite" : `\`npm test\` runs: ${testScript}`);
    add("no-skipped-tests", ![...base.tap.tests, ...gold.tap.tests].some((t) => t.skipped), "no test is skipped or marked todo");

    const failToPass = base.tap.tests.filter((t) => !t.ok).map((t) => t.name);
    const passToPass = base.tap.tests.filter((t) => t.ok).map((t) => t.name);
    add("starting-state-fails", failToPass.length > 0, `${failToPass.length} test(s) fail before the change`);
    const expected: Expected = { fail_to_pass: failToPass, pass_to_pass: passToPass, total: base.tap.tests.length };

    const repeats = opts.gradeRepeats ?? 3;
    let stable = true;
    for (let i = 0; i < repeats; i += 1) {
      const g = gradeWorkspace(task, goldWs, expected, { scratch: join(scratch, "copies") });
      if (g.verdict !== "pass") stable = false;
    }
    add("gold-grades-pass-every-time", stable, `the gold change passed in ${repeats} of ${repeats} graded runs`);

    const rejects = (check: string, ws: string, what: string): void => {
      const g = gradeWorkspace(task, ws, expected, { scratch: join(scratch, "copies") });
      add(check, g.verdict === "fail", g.verdict === "fail" ? `${what}: graded fail (${g.reason})` : `${what}: graded ${g.verdict}, which is wrong`);
    };

    rejects("rejects-doing-nothing", baseWs, "the starting state unchanged");

    const deleted = join(scratch, "deleted");
    copyBase(task, deleted);
    for (const p of task.protected) rmSync(join(deleted, p), { recursive: true, force: true });
    rejects("rejects-deleted-tests", deleted, "the protected tests deleted");

    const neutered = join(scratch, "neutered");
    copyBase(task, neutered);
    for (const f of task.test.files) writeFileSync(join(neutered, f), "process.exit(0);\n");
    rejects("rejects-replaced-tests", neutered, "the test files replaced by an immediate exit");

    const early = join(scratch, "early");
    copyBase(task, early);
    for (const f of walkFiles(early)) {
      if (f.endsWith(".js") && !task.protected.some((p) => f === p || f.startsWith(p.endsWith("/") ? p : `${p}/`))) {
        writeFileSync(join(early, f), `${readFileSync(join(early, f), "utf8")}\nprocess.exit(0);\n`);
      }
    }
    rejects("rejects-early-exit", early, "source files that exit with success when loaded");

    const ok = findings.every((f) => f.ok);
    return { taskId: task.id, ok, findings, expected: ok ? expected : null };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function writeExpected(task: LabTask, expected: Expected): void {
  writeFileSync(join(task.dir, "expected.json"), `${JSON.stringify(expected, null, 2)}\n`);
}

export function renderAudit(results: AuditResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${r.ok ? "PASS" : "FAIL"} ${r.taskId}${r.expected ? ` (${r.expected.total} tests, ${r.expected.fail_to_pass.length} must go from failing to passing)` : ""}`);
    for (const f of r.findings) if (!f.ok) lines.push(`  FAIL ${f.check}: ${f.detail}`);
  }
  return lines.join("\n");
}

