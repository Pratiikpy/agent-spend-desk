import { createHash } from "node:crypto";
import { basename } from "node:path";

import type { Ledger } from "../ledger/db.ts";
import { git } from "../snapshot/git.ts";
import { findSessionLog, readHumanPrompts, redactPrompt } from "./prompts.ts";

/**
 * Candidate tasks from the owner's own history (DF-036). A candidate is a session that the ledger tied, with high or medium confidence, to commits that were merged and kept:
 * the prompt the owner gave, the commit the work started from, and the commit it ended at. Most sessions are not tasks. A task must be small enough to be given to an agent
 * again, have its starting point in git, have a prompt that was not the end of a long conversation, and leave tests that can say whether it was done. Each candidate that fails a
 * check is recorded with every reason it failed, so that the owner sees what the history held and why most of it is not a test, and never has it dropped without being told.
 */
export interface CandidateOptions {
  /** Only these repositories (their roots). Default: every repository the ledger has scanned. */
  repos?: readonly string[];
  maxFiles?: number;
  maxDiffLines?: number;
  /** The most human prompts the session may have had before its last commit. */
  maxPrompts?: number;
  minPromptChars?: number;
}

export const DEFAULTS = { maxFiles: 12, maxDiffLines: 600, maxPrompts: 2, minPromptChars: 25 } as const;

export type Kind = "bugfix" | "feature" | "refactor" | "docs" | "other";

export interface Candidate {
  taskId: string;
  repoRoot: string;
  repoLabel: string;
  sessionId: string;
  baseSha: string;
  resultSha: string;
  commits: string[];
  prompt: string;
  promptSha: string;
  promptCount: number;
  injection: string[];
  kind: Kind;
  area: string;
  files: string[];
  testFiles: string[];
  runnable: string[];
  diffLines: number;
  eligible: boolean;
  reasons: string[];
}

export interface DiscoveryReport {
  considered: number;
  candidates: Candidate[];
  /** Why candidates were set aside, with the number each reason set aside; a candidate with several reasons counts under each. */
  reasonCounts: Record<string, number>;
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

const TEST_DIRS = new Set(["test", "tests", "__tests__", "spec", "specs"]);
const RUNNABLE = /(^|\/)(test_[^/]*\.py|[^/]*_test\.(py|go)|[^/]*\.(test|spec)\.[cm]?[jt]sx?)$/i;
const DEPENDENCY_FILES = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|Pipfile(\.lock)?|go\.(mod|sum)|Cargo\.(toml|lock))$/;
const DOC_FILE = /\.(md|mdx|rst|txt|adoc)$/i;

export function isTestPath(path: string): boolean {
  const parts = path.split("/");
  const name = parts[parts.length - 1] ?? "";
  return parts.slice(0, -1).some((p) => TEST_DIRS.has(p.toLowerCase())) || /\.(test|spec)\./i.test(name) || /(^test_|_test\.)/i.test(name) || RUNNABLE.test(path);
}

export function isRunnableTest(path: string): boolean {
  return RUNNABLE.test(path);
}

export function kindOf(prompt: string, subjects: readonly string[], files: readonly string[]): Kind {
  if (files.length > 0 && files.every((f) => DOC_FILE.test(f))) return "docs";
  const text = `${prompt}\n${subjects.join("\n")}`;
  if (/\b(fix(es|ed)?|bug|broken|crash(es|ed)?|wrong|incorrect|regression|fails?|failing)\b/i.test(text)) return "bugfix";
  if (/\b(refactor|rename|clean ?up|restructure|simplif(y|ied)|reorgani[sz]e|extract|move)\b/i.test(text)) return "refactor";
  if (/\b(add|implement|build|create|support|introduce|new)\b/i.test(text)) return "feature";
  return "other";
}

export function areaOf(files: readonly string[]): string {
  const source = files.filter((f) => !isTestPath(f));
  const path = source[0] ?? files[0] ?? "";
  const parts = path.split("/");
  if (parts.length < 2) return "(root)";
  if (["src", "lib", "app", "packages", "pkg", "cmd", "internal"].includes(parts[0] as string) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0] as string;
}

interface LinkRow {
  session_id: string;
  sha: string;
  authored_at: string;
  root: string;
  started_at: string | null;
}

function numstat(root: string, base: string, result: string): { lines: number; files: { path: string; status: string }[] } {
  const names = git(["diff", "--name-status", "--no-renames", "-z", base, result], { cwd: root }).split("\0").filter(Boolean);
  const files: { path: string; status: string }[] = [];
  for (let i = 0; i + 1 < names.length; i += 2) files.push({ status: names[i] as string, path: names[i + 1] as string });
  let lines = 0;
  for (const l of git(["diff", "--numstat", "--no-renames", base, result], { cwd: root }).split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(l);
    if (m && m[1] !== "-" && m[2] !== "-") lines += Number(m[1]) + Number(m[2]);
  }
  return { lines, files };
}

export function discoverCandidates(db: Ledger, o: CandidateOptions = {}): DiscoveryReport {
  const lim = { ...DEFAULTS, ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) } as typeof DEFAULTS & CandidateOptions;
  const rows = db
    .prepare(
      `SELECT sc.session_id, sc.sha, gc.authored_at, r.root, s.started_at
       FROM session_outcome so
       JOIN session_commit sc ON sc.session_id = so.session_id
       JOIN git_commit gc ON gc.repo_id = sc.repo_id AND gc.sha = sc.sha
       JOIN repo r ON r.repo_id = sc.repo_id
       LEFT JOIN session s ON s.session_id = so.session_id
       WHERE so.state IN ('merged', 'kept') AND sc.confidence IN ('high', 'medium') AND gc.merged = 1 AND gc.reverted = 0
       ORDER BY sc.session_id, r.root, gc.authored_at`,
    )
    .all() as unknown as LinkRow[];
  const groups = new Map<string, LinkRow[]>();
  for (const r of rows) {
    if (o.repos && !o.repos.some((x) => x.replace(/\\/g, "/").toLowerCase() === r.root.replace(/\\/g, "/").toLowerCase())) continue;
    const k = `${r.session_id}\0${r.root}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const report: DiscoveryReport = { considered: groups.size, candidates: [], reasonCounts: {} };
  for (const links of groups.values()) {
    const first = links[0] as LinkRow;
    const root = first.root;
    const sessionId = first.session_id;
    const reasons: string[] = [];
    const commits = links.map((l) => l.sha);
    let base = "";
    let result = "";
    let files: { path: string; status: string }[] = [];
    let lines = 0;
    let subjects: string[] = [];
    try {
      base = git(["rev-parse", "--verify", `${commits[0]}^`], { cwd: root }).trim();
      result = git(["rev-parse", "--verify", `${commits[commits.length - 1]}`], { cwd: root }).trim();
      const between = git(["rev-list", "--reverse", "--parents", `${base}..${result}`], { cwd: root }).split("\n").filter(Boolean);
      const shas = between.map((l) => l.split(" ")[0] as string);
      if (between.some((l) => l.split(" ").length > 2)) reasons.push("a merge commit sits in the range");
      else if (shas.length !== commits.length || shas.some((s) => !commits.includes(s))) reasons.push(`${shas.length} commits sit between the starting point and the result and ${commits.length} are the session's, so the change is not the session's alone`);
      subjects = git(["log", "--format=%s", `${base}..${result}`], { cwd: root }).split("\n").filter(Boolean);
      const d = numstat(root, base, result);
      files = d.files;
      lines = d.lines;
    } catch (e) {
      const msg = (e as Error).message;
      reasons.push(/unknown revision|bad revision|ambiguous argument|\^: /.test(msg) || /rev-parse/.test(msg) ? "a commit or its parent is not in the repository (a root commit, or history was rewritten)" : `git could not read the range: ${msg.slice(0, 80)}`);
    }

    const paths = files.map((f) => f.path);
    const testFiles = paths.filter((p) => isTestPath(p));
    const runnable = files.filter((f) => f.status !== "D" && isRunnableTest(f.path)).map((f) => f.path);
    if (paths.length > lim.maxFiles) reasons.push(`${paths.length} files changed, more than ${lim.maxFiles}`);
    if (lines > lim.maxDiffLines) reasons.push(`${lines} lines changed, more than ${lim.maxDiffLines}`);
    if (paths.some((p) => DEPENDENCY_FILES.test(p))) reasons.push("dependencies changed, and a sandbox links the dependencies the repository has now");
    if (paths.length > 0 && paths.every((p) => DOC_FILE.test(p))) reasons.push("only documentation changed");
    if (runnable.length === 0 && paths.length > 0) reasons.push("no test file was added or edited, so there is nothing to tell whether the work was done");

    let prompt = "";
    let promptSha = "";
    let promptCount = 0;
    let injection: string[] = [];
    const log = findSessionLog(db, sessionId);
    if (!log) reasons.push("the session's log is not where the ledger read it, so its prompt cannot be read");
    else {
      try {
        const last = links[links.length - 1] as LinkRow;
        const all = readHumanPrompts(log).filter((p) => p.ts <= last.authored_at);
        promptCount = all.length;
        if (all.length === 0) reasons.push("no prompt in the log came before the commit");
        else {
          const red = redactPrompt((all[0] as { text: string }).text, sha256);
          prompt = red.text;
          promptSha = red.sha;
          injection = red.injection;
          if (red.text.length < lim.minPromptChars) reasons.push(`the prompt is ${red.text.length} characters, too short to say what to do`);
          if (red.truncated) reasons.push("the prompt is longer than a task carries and was cut");
          if (promptCount > lim.maxPrompts) reasons.push(`the work took ${promptCount} prompts, more than ${lim.maxPrompts}; the first alone would not say what the later ones corrected`);
        }
      } catch (e) {
        reasons.push(`the log could not be read: ${(e as Error).message.slice(0, 80)}`);
      }
    }

    const label = basename(root);
    const taskId = sha256(`${label}|${base}|${result}|${promptSha}`).slice(0, 12);
    const c: Candidate = {
      taskId, repoRoot: root, repoLabel: label, sessionId, baseSha: base, resultSha: result, commits, prompt, promptSha, promptCount, injection,
      kind: kindOf(prompt, subjects, paths), area: areaOf(paths), files: paths, testFiles, runnable, diffLines: lines, eligible: reasons.length === 0, reasons,
    };
    report.candidates.push(c);
    for (const r of reasons) {
      const key = r.replace(/\d+/g, "N");
      report.reasonCounts[key] = (report.reasonCounts[key] ?? 0) + 1;
    }
  }
  return report;
}
