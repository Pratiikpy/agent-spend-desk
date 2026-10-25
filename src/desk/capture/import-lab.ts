import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { CREDENTIAL_SHAPES } from "../card/redact.ts";
import { loadTasks, readExpected, taskHash, walkFiles, overlayGold, copyBase, type LabTask } from "../lab/task.ts";
import { scanInjection } from "../security/injection.ts";
import { git } from "../snapshot/git.ts";
import { isRunnableTest, isTestPath } from "./candidates.ts";
import type { CaptureDb } from "./store.ts";


/**
 * Tasks written or mined elsewhere, in the Lab's layout, brought in beside the ones from history (DF-036). A Lab task is a folder: the repository as it starts (`base/`), the change
 * that solves it (`gold/`), the tests that were kept out of the agent's sight (`hidden/`) and the prompt. Each is turned into a small git repository of its own with two
 * commits, the starting point and the solved state with the hidden tests, so that from there on it is the same kind of thing as a task made from history: the same oracle is run
 * on it, by the same code, and the Lab's own list of tests that must pass (`expected.json`) is a second opinion to hold the measured ones against.
 */
export interface ImportReport {
  imported: string[];
  skipped: { id: string; why: string }[];
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const AUTHOR = { GIT_AUTHOR_NAME: "desk", GIT_AUTHOR_EMAIL: "desk@localhost", GIT_COMMITTER_NAME: "desk", GIT_COMMITTER_EMAIL: "desk@localhost", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };

function commitAll(repo: string, message: string): string {
  git(["add", "-A", "--force"], { cwd: repo });
  git(["-c", "core.autocrlf=false", "commit", "-q", "--allow-empty", "-m", message], { cwd: repo, env: AUTHOR });
  return git(["rev-parse", "HEAD"], { cwd: repo }).trim();
}

export function importLabTasks(db: CaptureDb, labRoot: string, reposRoot: string, nowIso: string): ImportReport {
  const tasks = loadTasks(labRoot);
  const report: ImportReport = { imported: [], skipped: [] };
  for (const t of tasks) {
    const why = importOne(db, t, reposRoot, nowIso);
    if (why === null) report.imported.push(t.id);
    else report.skipped.push({ id: t.id, why });
  }
  return report;
}

function importOne(db: CaptureDb, t: LabTask, reposRoot: string, nowIso: string): string | null {
  for (const shape of CREDENTIAL_SHAPES.filter((r) => !r.source.includes("api[_-]?key"))) {
    shape.lastIndex = 0;
    if (shape.test(t.prompt)) return "its prompt holds something shaped like a credential";
  }
  const repo = resolve(reposRoot, t.id);
  const existing = db.prepare("SELECT status FROM canary_task WHERE source = 'lab' AND repo_label = ?").get(`lab-${t.id}`) as { status: string } | undefined;
  if (existing && existing.status !== "candidate" && existing.status !== "ineligible" && existing.status !== "computed") return `already ${existing.status}`;
  rmSync(repo, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  git(["init", "-q", "-b", "main"], { cwd: repo });
  copyBase(t, repo);
  const base = commitAll(repo, `${t.id}: the repository as the task starts`);
  overlayGold(t, repo);
  cpSync(join(t.dir, "hidden"), repo, { recursive: true });
  const result = commitAll(repo, `${t.id}: solved, with the hidden tests`);
  const files = git(["diff", "--name-only", "--no-renames", base, result], { cwd: repo }).split("\n").filter(Boolean);
  const lines = git(["diff", "--numstat", "--no-renames", base, result], { cwd: repo }).split("\n").reduce((n, l) => {
    const m = /^(\d+)\t(\d+)\t/.exec(l);
    return m ? n + Number(m[1]) + Number(m[2]) : n;
  }, 0);
  const hidden = walkFiles(join(t.dir, "hidden"));
  const runnable = [...new Set(t.test.files)].filter((f) => existsSync(join(repo, f)) && (isRunnableTest(f) || isTestPath(f)));
  const taskId = sha256(`lab|${t.id}|${taskHash(t)}`).slice(0, 12);
  const expected = readExpected(t);
  const origin = { ...t.origin, taskHash: taskHash(t), title: t.title, expected: expected ? { fail_to_pass: expected.fail_to_pass.length, pass_to_pass: expected.pass_to_pass.length } : null, hidden };
  db.prepare(
    `INSERT INTO canary_task (task_id, status, repo_path, repo_label, session_id, base_sha, result_sha, commits_json, prompt, prompt_sha, prompt_count, injection_json, kind, area, files_json, test_files_json, runnable_json, diff_lines, reasons_json, captured_at, source, origin_json)
     VALUES (?, 'candidate', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'lab', ?)
     ON CONFLICT(task_id) DO UPDATE SET repo_path = excluded.repo_path, base_sha = excluded.base_sha, result_sha = excluded.result_sha, files_json = excluded.files_json`,
  ).run(taskId, repo, `lab-${t.id}`, `lab:${t.id}`, base, result, JSON.stringify([base, result]), t.prompt, sha256(t.prompt), JSON.stringify(scanInjection(t.prompt).map((f) => f.kind)), t.kind, "lab", JSON.stringify(files), JSON.stringify(files.filter(isTestPath)), JSON.stringify(runnable), lines, nowIso, JSON.stringify(origin));
  return null;
}

/** The Lab's own list of tests that must pass, for holding a measured oracle against. Names only: the Lab lists the title of each test, the Desk's ids carry the file. */
export function labExpected(t: LabTask): { failToPass: string[]; passToPass: string[] } | null {
  const e = readExpected(t);
  return e ? { failToPass: e.fail_to_pass, passToPass: e.pass_to_pass } : null;
}
