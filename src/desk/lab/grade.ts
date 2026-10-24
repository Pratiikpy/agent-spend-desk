import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Expected, LabTask } from "./task.ts";

/**
 * The grader. It never reads what the agent said. It copies the workspace, restores every protected path from the
 * task's base state, adds the hidden tests, runs the test files and compares the named results with the sets the
 * audit recorded. An agent therefore cannot pass by editing, deleting or skipping tests, or by exiting early.
 */
export interface TapResult {
  tests: { name: string; ok: boolean; skipped: boolean }[];
  summary: { tests: number; pass: number; fail: number; skipped: number; todo: number } | null;
}

export function parseTap(out: string): TapResult {
  const tests: TapResult["tests"] = [];
  const num: Record<string, number> = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^(not )?ok \d+ - (.*)$/.exec(line);
    if (m) {
      const rest = m[2] ?? "";
      const skipped = /\s#\s(?:SKIP|TODO)\b/i.test(rest);
      tests.push({ name: rest.replace(/\s#\s(?:SKIP|TODO)\b.*$/i, "").trim(), ok: m[1] === undefined && !skipped, skipped });
      continue;
    }
    const s = /^# (tests|pass|fail|skipped|todo) (\d+)$/.exec(line);
    if (s) num[s[1] as string] = Number(s[2]);
  }
  const summary = "tests" in num && "pass" in num && "fail" in num ? { tests: num["tests"] ?? 0, pass: num["pass"] ?? 0, fail: num["fail"] ?? 0, skipped: num["skipped"] ?? 0, todo: num["todo"] ?? 0 } : null;
  return { tests, summary };
}

export interface Grade {
  /** pass: every expected test passed. fail: the code is wrong. infra: the grader could not run (so it is no verdict on the code). */
  verdict: "pass" | "fail" | "infra";
  f2pPassed: number;
  f2pTotal: number;
  p2pPassed: number;
  p2pTotal: number;
  ran: number;
  expectedTotal: number;
  failed: string[];
  reason: string;
  timedOut: boolean;
}

export interface GradeOptions {
  /** Where grading copies go. Defaults to the system temp folder. */
  scratch?: string;
  /** Keep the grading copy for inspection. */
  keep?: boolean;
}

const KEEP_ENV = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LANG", "TZ"];

function minimalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of KEEP_ENV) if (process.env[k] !== undefined) env[k] = process.env[k];
  env["CI"] = "1";
  return env;
}

/** Make the grading copy: the workspace, then protected paths restored from base, then the hidden files. */
export function prepareGradingCopy(task: LabTask, workspace: string, scratch: string): string {
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, "grade-"));
  cpSync(workspace, dir, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(src) });
  for (const p of task.protected) rmSync(join(dir, p), { recursive: true, force: true });
  for (const p of task.protected) {
    const from = join(task.dir, "base", p);
    if (existsSync(from)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      cpSync(from, join(dir, p), { recursive: true });
    }
  }
  const hidden = join(task.dir, "hidden");
  if (existsSync(hidden)) cpSync(hidden, dir, { recursive: true });
  return dir;
}

export function runTests(task: LabTask, dir: string): { tap: TapResult; exitCode: number | null; timedOut: boolean; stderr: string } {
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...task.test.files], {
    cwd: dir,
    env: minimalEnv(),
    encoding: "utf8",
    timeout: task.test.timeoutSec * 1000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  return { tap: parseTap(r.stdout ?? ""), exitCode: r.status, timedOut, stderr: (r.stderr ?? "").slice(-2000) };
}

export function gradeWorkspace(task: LabTask, workspace: string, expected: Expected, opts: GradeOptions = {}): Grade {
  const scratch = opts.scratch ?? join(tmpdir(), "desk-lab-grade");
  const dir = prepareGradingCopy(task, workspace, scratch);
  try {
    const { tap, timedOut, stderr } = runTests(task, dir);
    const byName = new Map<string, boolean>();
    for (const t of tap.tests) byName.set(t.name, (byName.get(t.name) ?? true) && t.ok);
    const f2p = expected.fail_to_pass;
    const p2p = expected.pass_to_pass;
    const failed = [...f2p, ...p2p].filter((n) => byName.get(n) !== true);
    const base: Omit<Grade, "verdict" | "reason"> = {
      f2pPassed: f2p.filter((n) => byName.get(n) === true).length,
      f2pTotal: f2p.length,
      p2pPassed: p2p.filter((n) => byName.get(n) === true).length,
      p2pTotal: p2p.length,
      ran: tap.tests.length,
      expectedTotal: expected.total,
      failed,
      timedOut,
    };
    if (timedOut) return { ...base, verdict: "fail", reason: `the tests did not finish in ${task.test.timeoutSec} s` };
    if (tap.summary === null) return { ...base, verdict: "fail", reason: `the test run printed no summary (${stderr.replace(/\s+/g, " ").trim().slice(0, 160) || "no error text"})` };
    if (tap.tests.length < expected.total) return { ...base, verdict: "fail", reason: `only ${tap.tests.length} of ${expected.total} tests ran` };
    if (failed.length > 0) return { ...base, verdict: "fail", reason: `${failed.length} expected test(s) did not pass` };
    return { ...base, verdict: "pass", reason: "every expected test passed" };
  } catch (e) {
    return { verdict: "infra", f2pPassed: 0, f2pTotal: expected.fail_to_pass.length, p2pPassed: 0, p2pTotal: expected.pass_to_pass.length, ran: 0, expectedTotal: expected.total, failed: [], reason: `grader error: ${(e as Error).message}`, timedOut: false };
  } finally {
    if (!opts.keep) rmSync(dir, { recursive: true, force: true });
  }
}
