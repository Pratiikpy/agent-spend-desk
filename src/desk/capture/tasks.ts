import { createHash } from "node:crypto";

import { pinCommit } from "../snapshot/shadow.ts";
import type { Candidate } from "./candidates.ts";
import { computeOracle, type OracleResult } from "./oracle.ts";
import type { CaptureDb } from "./store.ts";
import type { TestPlan } from "./runner.ts";

/**
 * Captured tasks, from the first sight of a candidate to a frozen suite (DF-036). A task moves one way: seen (`candidate`, or `ineligible` with every reason), measured
 * (`computed`, with the tests that decide it), then reviewed by the owner (`accepted` or `rejected`). A task that has been measured or reviewed is never rewritten by a
 * later look at the same history, and a frozen suite is never edited.
 */
export type Status = "candidate" | "ineligible" | "computed" | "accepted" | "rejected";

export interface TaskRow {
  task_id: string;
  status: Status;
  repo_path: string;
  repo_label: string;
  session_id: string;
  base_sha: string;
  result_sha: string;
  commits_json: string;
  prompt: string;
  prompt_sha: string;
  prompt_count: number;
  injection_json: string;
  kind: string;
  area: string;
  files_json: string;
  test_files_json: string;
  runnable_json: string;
  diff_lines: number;
  reasons_json: string;
  base_ref: string | null;
  result_ref: string | null;
  plan_json: string | null;
  oracle: "strong" | "weak" | "none" | null;
  f2p_json: string | null;
  p2p_json: string | null;
  flaky_json: string | null;
  failing_after_json: string | null;
  oracle_json: string | null;
  computed_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  held_out: number | null;
  suite_id: string | null;
  captured_at: string;
}

const j = <T>(s: string | null, fallback: T): T => (s === null ? fallback : (JSON.parse(s) as T));

export function getTask(db: CaptureDb, id: string): TaskRow | undefined {
  return db.prepare("SELECT * FROM canary_task WHERE task_id = ?").get(id) as TaskRow | undefined;
}

export function listTasks(db: CaptureDb, status?: Status): TaskRow[] {
  return (status ? db.prepare("SELECT * FROM canary_task WHERE status = ? ORDER BY captured_at, task_id").all(status) : db.prepare("SELECT * FROM canary_task ORDER BY captured_at, task_id").all()) as unknown as TaskRow[];
}

/** Record a candidate. One that has been measured or reviewed is left as it is; one still only seen is brought up to date. */
export function recordCandidate(db: CaptureDb, c: Candidate, nowIso: string): "new" | "updated" | "kept" {
  const status: Status = c.eligible ? "candidate" : "ineligible";
  const existing = getTask(db, c.taskId);
  if (existing && existing.status !== "candidate" && existing.status !== "ineligible") return "kept";
  db.prepare(
    `INSERT INTO canary_task (task_id, status, repo_path, repo_label, session_id, base_sha, result_sha, commits_json, prompt, prompt_sha, prompt_count, injection_json, kind, area, files_json, test_files_json, runnable_json, diff_lines, reasons_json, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_id) DO UPDATE SET status = excluded.status, prompt = excluded.prompt, prompt_count = excluded.prompt_count, injection_json = excluded.injection_json, kind = excluded.kind, area = excluded.area,
       files_json = excluded.files_json, test_files_json = excluded.test_files_json, runnable_json = excluded.runnable_json, diff_lines = excluded.diff_lines, reasons_json = excluded.reasons_json`,
  ).run(c.taskId, status, c.repoRoot, c.repoLabel, c.sessionId, c.baseSha, c.resultSha, JSON.stringify(c.commits), c.prompt, c.promptSha, c.promptCount, JSON.stringify(c.injection), c.kind, c.area, JSON.stringify(c.files), JSON.stringify(c.testFiles), JSON.stringify(c.runnable), c.diffLines, JSON.stringify(c.reasons), nowIso);
  return existing ? "updated" : "new";
}

export class TaskError extends Error {}

export interface ComputeOptions {
  plan: TestPlan;
  /** Test files to run instead of the ones the change touched: how an owner gives a weak-oracle task a test (it can only be PASS_TO_PASS). */
  tests?: readonly string[];
  repeatsAfter?: number;
  /** The owner measures a task the Desk set aside, knowing its reasons. */
  force?: boolean;
  now?: () => Date;
}

/** Hold the two commits under pinned names, run the owner's tests before and after, and record which tests decide the task. */
export function computeTask(db: CaptureDb, id: string, o: ComputeOptions): { task: TaskRow; oracle: OracleResult } {
  const t = getTask(db, id);
  if (!t) throw new TaskError(`no task ${JSON.stringify(id)}`);
  if (t.status === "accepted" || t.status === "rejected") throw new TaskError(`${id} was already reviewed (${t.status}); its tests are not measured again`);
  if (t.status === "ineligible" && !o.force) throw new TaskError(`${id} was set aside: ${j<string[]>(t.reasons_json, []).join("; ")}. Measure it anyway with --force.`);
  const touched = j<string[]>(t.test_files_json, []);
  const runnable = o.tests ? [...o.tests] : j<string[]>(t.runnable_json, []);
  if (runnable.length === 0) throw new TaskError(`${id} has no test file to run: the change touched none. Give existing tests with --tests to measure it as a weak oracle.`);
  const baseRef = `task-${id}-base`;
  const resultRef = `task-${id}-result`;
  pinCommit({ repo: t.repo_path, name: baseRef, commit: t.base_sha, replace: true });
  pinCommit({ repo: t.repo_path, name: resultRef, commit: t.result_sha, replace: true });
  const plan: TestPlan = { depsFrom: t.repo_path, ...o.plan };
  const oracle = computeOracle({ repo: t.repo_path, baseRef, resultRef, overlay: o.tests ? [] : touched, runnable, plan, ...(o.repeatsAfter ? { repeatsAfter: o.repeatsAfter } : {}) });
  const cap = (a: string[], n: number): string[] => (a.length > n ? [...a.slice(0, n), `(and ${a.length - n} more)`] : a);
  const at = (o.now ?? (() => new Date()))().toISOString();
  const keep = JSON.stringify({ before: oracle.before, after: oracle.after, reasons: oracle.reasons, log: { before: oracle.log.before.slice(-4000), after: oracle.log.after.slice(-4000) }, runnable, overlay: o.tests ? [] : touched });
  db.prepare(
    `UPDATE canary_task SET status = 'computed', base_ref = ?, result_ref = ?, plan_json = ?, oracle = ?, f2p_json = ?, p2p_json = ?, flaky_json = ?, failing_after_json = ?, oracle_json = ?, computed_at = ? WHERE task_id = ?`,
  ).run(baseRef, resultRef, JSON.stringify({ preset: plan.preset, command: plan.command ?? null, format: plan.format ?? null, timeoutMs: plan.timeoutMs ?? null }), oracle.oracle, JSON.stringify(oracle.failToPass), JSON.stringify(cap(oracle.passToPass, 200)), JSON.stringify(oracle.flaky), JSON.stringify(cap(oracle.failingAfter, 50)), keep, at, id);
  return { task: getTask(db, id) as TaskRow, oracle };
}

export interface ReviewOptions {
  /** The owner says a task with no deciding test is to be kept, as a weak oracle. */
  weak?: boolean;
  /** The owner has read that the prompt holds instruction-like text and keeps the task anyway. */
  ackInjection?: boolean;
  note?: string;
  now?: () => Date;
}

export function reviewTask(db: CaptureDb, id: string, decision: "accept" | "reject", o: ReviewOptions = {}): TaskRow {
  const t = getTask(db, id);
  if (!t) throw new TaskError(`no task ${JSON.stringify(id)}`);
  if (t.suite_id) throw new TaskError(`${id} is in the frozen suite ${t.suite_id}; a frozen suite is not edited`);
  const at = (o.now ?? (() => new Date()))().toISOString();
  if (decision === "reject") {
    db.prepare("UPDATE canary_task SET status = 'rejected', reviewed_at = ?, review_note = ? WHERE task_id = ?").run(at, o.note ?? null, id);
    return getTask(db, id) as TaskRow;
  }
  if (t.status !== "computed" && t.status !== "rejected") throw new TaskError(t.status === "accepted" ? `${id} is already accepted` : `${id} has not been measured (${t.status}); run its tests first`);
  if (t.status === "rejected" && !t.oracle) throw new TaskError(`${id} was rejected before it was measured`);
  if (t.oracle === "none" || t.oracle === null) throw new TaskError(`${id} has no test that decides it, so it cannot be a task`);
  if (t.oracle === "weak" && !o.weak) throw new TaskError(`${id} has no test that fails before the change and passes after it, so it is a weak oracle: nothing says the work was done. Accept it with --weak if you want it kept as one.`);
  const injection = j<string[]>(t.injection_json, []);
  if (injection.length > 0 && !o.ackInjection) throw new TaskError(`${id}'s prompt holds instruction-like text (${injection.join(", ")}). Read it with desk capture show ${id}, then accept it with --ack-injection; it will only ever run in a sandbox.`);
  db.prepare("UPDATE canary_task SET status = 'accepted', reviewed_at = ?, review_note = ? WHERE task_id = ?").run(at, o.note ?? null, id);
  return getTask(db, id) as TaskRow;
}

export interface Family {
  kind: string;
  area: string;
  tasks: string[];
}

export function families(db: CaptureDb, status: Status = "accepted"): Family[] {
  const m = new Map<string, Family>();
  for (const t of listTasks(db, status)) {
    const key = `${t.kind}\0${t.area}`;
    const f = m.get(key) ?? { kind: t.kind, area: t.area, tasks: [] };
    f.tasks.push(t.task_id);
    m.set(key, f);
  }
  return [...m.values()].sort((a, b) => (a.kind + a.area < b.kind + b.area ? -1 : 1));
}

export interface FreezeOptions {
  min?: number;
  max?: number;
  now?: () => Date;
}

export interface Suite {
  suiteId: string;
  hash: string;
  taskIds: string[];
  heldOut: string[];
  families: Family[];
  /** Kinds of work no accepted task covers; reported, never filled. */
  emptyKinds: string[];
}

const KINDS = ["bugfix", "feature", "refactor", "other"];

/** The hash of what a suite holds: each task's prompt, commits and deciding tests, so that it changes if any of them does. */
export function suiteHash(tasks: readonly TaskRow[]): string {
  const h = createHash("sha256");
  for (const t of [...tasks].sort((a, b) => (a.task_id < b.task_id ? -1 : 1))) h.update(JSON.stringify([t.task_id, t.prompt_sha, t.base_sha, t.result_sha, t.oracle, t.f2p_json, t.p2p_json, t.flaky_json])).update("\n");
  return h.digest("hex");
}

/**
 * Freeze the accepted tasks that are not in a suite yet. When there are more than the most a suite holds, tasks are taken from each family in turn so that no one kind of work
 * fills it; every second task of a family, in the order of their ids, is held out and never shown to anything that tunes a route. The suite is refused when it has fewer
 * tasks than the least (12), unless the owner lowers the least on purpose, and then it says it is small.
 */
export function freezeSuite(db: CaptureDb, o: FreezeOptions = {}): Suite {
  const min = o.min ?? 12;
  const max = o.max ?? 40;
  const pool = listTasks(db, "accepted").filter((t) => !t.suite_id);
  if (pool.length < Math.max(1, min)) throw new TaskError(`${pool.length} accepted task${pool.length === 1 ? "" : "s"} are not in a suite and a suite needs at least ${min}. Accept more, or freeze a smaller one on purpose with --min.`);
  const byFamily = new Map<string, TaskRow[]>();
  for (const t of pool) byFamily.set(`${t.kind}\0${t.area}`, [...(byFamily.get(`${t.kind}\0${t.area}`) ?? []), t]);
  const queues = [...byFamily.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v.sort((a, b) => (a.task_id < b.task_id ? -1 : 1)));
  const chosen: TaskRow[] = [];
  for (let round = 0; chosen.length < max && queues.some((q) => q[round]); round += 1) for (const q of queues) if (q[round] && chosen.length < max) chosen.push(q[round] as TaskRow);
  const heldOut: string[] = [];
  const perFamily = new Map<string, TaskRow[]>();
  for (const t of chosen) perFamily.set(`${t.kind}\0${t.area}`, [...(perFamily.get(`${t.kind}\0${t.area}`) ?? []), t]);
  for (const list of perFamily.values()) list.sort((a, b) => (a.task_id < b.task_id ? -1 : 1)).forEach((t, i) => (i % 2 === 1 ? heldOut.push(t.task_id) : undefined));
  const hash = suiteHash(chosen);
  const suiteId = `suite-${hash.slice(0, 10)}`;
  const at = (o.now ?? (() => new Date()))().toISOString();
  const fam = [...perFamily.entries()].map(([k, v]) => ({ kind: k.split("\0")[0] as string, area: k.split("\0")[1] as string, tasks: v.map((t) => t.task_id) }));
  const taskIds = chosen.map((t) => t.task_id).sort();
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO canary_suite (suite_id, created_at, task_ids_json, held_out_json, hash, families_json, params_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(suiteId, at, JSON.stringify(taskIds), JSON.stringify(heldOut.sort()), hash, JSON.stringify(fam), JSON.stringify({ min, max, small: chosen.length < 12 }));
    const mark = db.prepare("UPDATE canary_task SET suite_id = ?, held_out = ? WHERE task_id = ?");
    for (const t of chosen) mark.run(suiteId, heldOut.includes(t.task_id) ? 1 : 0, t.task_id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const covered = new Set(chosen.map((t) => t.kind));
  return { suiteId, hash, taskIds, heldOut: heldOut.sort(), families: fam, emptyKinds: KINDS.filter((k) => !covered.has(k)) };
}
