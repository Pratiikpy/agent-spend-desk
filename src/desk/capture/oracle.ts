import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { restoreSnapshot } from "../snapshot/shadow.ts";
import { dedupe, type TestStatus } from "./parsers.ts";
import { linkDeps, runTests, type RunOutcome, type TestPlan } from "./runner.ts";

/**
 * The oracle for a captured task: which tests decide it (DF-036). The contract is the one SWE-bench uses. Take the folder as it was before the change, add the tests the change
 * added or edited, and run them: that is "before". Run the same tests on the folder after the change: that is "after". A test that fails or is absent before and passes after is
 * FAIL_TO_PASS, the tests a correct change must make pass; one that passes in both is PASS_TO_PASS, the tests a correct change must not break. A task with no FAIL_TO_PASS test has
 * nothing that says the work was done, and is a weak oracle: it is kept only if the owner says so.
 *
 * The after run is made more than once, and a test whose result differs between runs is set aside as flaky and decides nothing: a task whose decisive test passes by chance would
 * make a route look better or worse by luck.
 */
export interface OracleInput {
  repo: string;
  /** Names of pinned snapshots (see `pinCommit`) of the commit before the change and of the commit after it. */
  baseRef: string;
  resultRef: string;
  /** Test files the change added or edited, and the support files under test folders it changed; every one is overlaid on the before folder. */
  overlay: readonly string[];
  /** The files among those that a test runner is pointed at. */
  runnable: readonly string[];
  plan: TestPlan;
  /** How many times the after run is made. At least 1; 2 by default. */
  repeatsAfter?: number;
  /** Folder for the sandboxes; a new one in the system temp folder by default, removed when the oracle is done. */
  workRoot?: string;
}

export interface RunSummary {
  tests: number;
  pass: number;
  fail: number;
  skip: number;
  ms: number;
  timedOut: boolean;
  exitCode: number | null;
  note: string | null;
}

export interface OracleResult {
  /** `unrunnable` when the after run gave no readable result: nothing below it says anything about the task. */
  status: "computed" | "unrunnable";
  oracle: "strong" | "weak" | "none";
  failToPass: string[];
  passToPass: string[];
  flaky: string[];
  /** Tests that fail after the change in every run: the change did not make them pass, so they decide nothing. */
  failingAfter: string[];
  before: RunSummary;
  after: RunSummary[];
  reasons: string[];
  /** The tail of what the before and the first after run printed. */
  log: { before: string; after: string };
}

const summary = (r: RunOutcome): RunSummary => {
  const m = dedupe(r.results);
  const count = (s: TestStatus): number => [...m.values()].filter((v) => v === s).length;
  return { tests: m.size, pass: count("pass"), fail: count("fail"), skip: count("skip"), ms: r.ms, timedOut: r.timedOut, exitCode: r.exitCode, note: r.note };
};

export function computeOracle(o: OracleInput): OracleResult {
  const repeats = Math.max(1, Math.min(o.repeatsAfter ?? 2, 5));
  const root = o.workRoot ?? mkdtempSync(join(tmpdir(), "desk-oracle-"));
  const reasons: string[] = [];
  try {
    const beforeDir = join(root, "before");
    const afterDir = join(root, "after");
    restoreSnapshot({ repo: o.repo, ref: o.baseRef, into: beforeDir });
    restoreSnapshot({ repo: o.repo, ref: o.resultRef, into: afterDir });
    for (const f of o.overlay) {
      const from = join(afterDir, ...f.split("/"));
      if (!existsSync(from)) continue;
      const to = join(beforeDir, ...f.split("/"));
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
    for (const dir of [beforeDir, afterDir]) {
      const note = linkDeps(dir, o.plan.depsFrom);
      if (note) reasons.push(note);
    }
    const files = o.runnable.filter((f) => existsSync(join(afterDir, ...f.split("/"))));
    if (files.length === 0) {
      reasons.push("none of the test files the change touched exists after it");
      const empty = { tests: 0, pass: 0, fail: 0, skip: 0, ms: 0, timedOut: false, exitCode: null, note: null };
      return { status: "unrunnable", oracle: "none", failToPass: [], passToPass: [], flaky: [], failingAfter: [], before: empty, after: [], reasons, log: { before: "", after: "" } };
    }
    const before = runTests({ dir: beforeDir, scratch: join(root, "out"), files, plan: o.plan, label: "before" });
    const afters: RunOutcome[] = [];
    for (let i = 0; i < repeats; i += 1) afters.push(runTests({ dir: afterDir, scratch: join(root, "out"), files, plan: o.plan, label: `after-${i}` }));
    const first = afters[0] as RunOutcome;
    const base = { before: summary(before), after: afters.map(summary), log: { before: before.log, after: first.log } };
    if (afters.some((a) => a.resultsMissing || a.timedOut)) {
      reasons.push(`the run after the change gave no readable results (${afters.map((a) => a.note ?? "ok").join("; ")})`);
      return { status: "unrunnable", oracle: "none", failToPass: [], passToPass: [], flaky: [], failingAfter: [], reasons, ...base };
    }
    const b = dedupe(before.results);
    const as = afters.map((a) => dedupe(a.results));
    const ids = new Set<string>(as.flatMap((m) => [...m.keys()]));
    const failToPass: string[] = [];
    const passToPass: string[] = [];
    const flaky: string[] = [];
    const failingAfter: string[] = [];
    for (const id of [...ids].sort()) {
      const seen = as.map((m) => m.get(id));
      const same = seen.every((s) => s === seen[0]);
      if (!same) {
        flaky.push(id);
        continue;
      }
      const after = seen[0];
      if (after === "fail") failingAfter.push(id);
      else if (after === "pass") (b.get(id) === "pass" ? passToPass : failToPass).push(id);
    }
    if (afters.some((a) => a.exitCode !== 0 && a.results.length > 0 && failingAfter.length === 0 && a.results.every((r) => r.status !== "fail"))) reasons.push("the command exited with an error although no test failed");
    let oracle: OracleResult["oracle"] = "none";
    if (failToPass.length > 0) oracle = "strong";
    else if (passToPass.length > 0 || (o.plan.preset === "custom" && (o.plan.format ?? "exit") === "exit" && as[0]!.size > 0)) oracle = "weak";
    if (failToPass.length === 0) reasons.push("no test fails before the change and passes after it, so nothing in the tests says the work was done");
    return { status: "computed", oracle, failToPass, passToPass, flaky, failingAfter, reasons, ...base };
  } finally {
    if (!o.workRoot) rmSync(root, { recursive: true, force: true });
  }
}
