import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

/**
 * A Lab task: a small repository frozen at a base state, a prompt, and a grader that is a test run, never a model's
 * opinion of its own work. The agent sees `base/`. The grader restores every protected path from `base/`, adds the
 * `hidden/` tests, runs the named test files and compares the result with the sets the audit recorded in `expected.json`.
 */
export interface LabTask {
  schema: "desk.lab.task.v1";
  id: string;
  title: string;
  kind: "feature" | "bugfix";
  /** What the agent is told. It must state every behaviour the hidden tests check. */
  prompt: string;
  test: {
    /** Test files the grader runs, relative to the repository root. They may be in `base/`, in `hidden/`, or both. */
    files: string[];
    /** How long the grader lets the test run take before it counts as a failure. */
    timeoutSec: number;
  };
  /** Paths the grader restores from `base/` before grading, so an agent cannot pass by editing or deleting tests. */
  protected: string[];
  origin: { type: "handwritten" | "mined"; licence: string; source?: string; note?: string };
  /** The directory the task was loaded from. Not part of task.json. */
  dir: string;
}

export interface Expected {
  fail_to_pass: string[];
  pass_to_pass: string[];
  total: number;
}

export class TaskError extends Error {}

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const SAFE_PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9_./@-]+$/;

function str(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  if (typeof v !== "string" || v.trim() === "") throw new TaskError(`task.json: ${k} must be a non-empty string`);
  return v;
}

function strList(o: Record<string, unknown>, k: string, min = 1): string[] {
  const v = o[k];
  if (!Array.isArray(v) || v.length < min || v.some((x) => typeof x !== "string" || !SAFE_PATH.test(x))) {
    throw new TaskError(`task.json: ${k} must list at least ${min} plain relative path(s)`);
  }
  return v as string[];
}

export function loadTask(dir: string): LabTask {
  const file = join(dir, "task.json");
  if (!existsSync(file)) throw new TaskError(`${dir}: no task.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new TaskError(`${file}: not JSON (${(e as Error).message})`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new TaskError(`${file}: must be an object`);
  const o = raw as Record<string, unknown>;
  if (o["schema"] !== "desk.lab.task.v1") throw new TaskError(`${file}: schema must be desk.lab.task.v1`);
  const known = new Set(["schema", "id", "title", "kind", "prompt", "test", "protected", "origin"]);
  for (const k of Object.keys(o)) if (!known.has(k)) throw new TaskError(`${file}: unknown field ${k}`);

  const id = str(o, "id");
  if (!ID.test(id)) throw new TaskError(`${file}: id must be lowercase letters, digits and dashes`);
  const base = basename(dir);
  if (base !== id) throw new TaskError(`${file}: id ${id} does not match its folder ${base}`);
  const kind = str(o, "kind");
  if (kind !== "feature" && kind !== "bugfix") throw new TaskError(`${file}: kind must be feature or bugfix`);
  const t = o["test"];
  if (t === null || typeof t !== "object" || Array.isArray(t)) throw new TaskError(`${file}: test must be an object`);
  const test = t as Record<string, unknown>;
  const timeoutSec = test["timeoutSec"];
  if (typeof timeoutSec !== "number" || !Number.isInteger(timeoutSec) || timeoutSec < 5 || timeoutSec > 600) throw new TaskError(`${file}: test.timeoutSec must be a whole number from 5 to 600`);
  const og = o["origin"];
  if (og === null || typeof og !== "object" || Array.isArray(og)) throw new TaskError(`${file}: origin must be an object`);
  const origin = og as Record<string, unknown>;
  const otype = str(origin, "type");
  if (otype !== "handwritten" && otype !== "mined") throw new TaskError(`${file}: origin.type must be handwritten or mined`);
  const task: LabTask = {
    schema: "desk.lab.task.v1",
    id,
    title: str(o, "title"),
    kind,
    prompt: str(o, "prompt"),
    test: { files: strList(test, "files"), timeoutSec },
    protected: strList(o, "protected"),
    origin: {
      type: otype,
      licence: str(origin, "licence"),
      ...(typeof origin["source"] === "string" ? { source: origin["source"] } : {}),
      ...(typeof origin["note"] === "string" ? { note: origin["note"] } : {}),
    },
    dir,
  };
  for (const sub of ["base", "gold", "hidden"]) if (!existsSync(join(dir, sub)) || !statSync(join(dir, sub)).isDirectory()) throw new TaskError(`${dir}: missing ${sub}/`);
  for (const f of task.test.files) {
    if (!existsSync(join(dir, "base", f)) && !existsSync(join(dir, "hidden", f))) throw new TaskError(`${dir}: test file ${f} is in neither base/ nor hidden/`);
  }
  for (const p of task.protected) {
    if (!existsSync(join(dir, "base", p)) && !existsSync(join(dir, "hidden", p))) throw new TaskError(`${dir}: protected path ${p} is in neither base/ nor hidden/`);
  }
  return task;
}

export function loadTasks(root: string): LabTask[] {
  if (!existsSync(root)) throw new TaskError(`${root}: no such folder`);
  const out: LabTask[] = [];
  for (const name of readdirSync(root).sort()) {
    const dir = join(root, name);
    if (statSync(dir).isDirectory() && existsSync(join(dir, "task.json"))) out.push(loadTask(dir));
  }
  const seen = new Set<string>();
  for (const t of out) {
    if (seen.has(t.id)) throw new TaskError(`duplicate task id ${t.id}`);
    seen.add(t.id);
  }
  return out;
}

export function walkFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".git" || name === "node_modules") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) visit(p);
      else out.push(relative(root, p).split(sep).join("/"));
    }
  };
  if (existsSync(root)) visit(root);
  return out;
}

/** A hash over everything that defines the task: its description, the starting repository, the gold change and the hidden tests. */
export function taskHash(task: LabTask): string {
  const h = createHash("sha256");
  for (const part of ["task.json", "expected.json"]) {
    const p = join(task.dir, part);
    if (existsSync(p)) h.update(`${part}\0${readFileSync(p, "utf8")}\0`);
  }
  for (const sub of ["base", "gold", "hidden"]) {
    for (const f of walkFiles(join(task.dir, sub))) h.update(`${sub}/${f}\0${readFileSync(join(task.dir, sub, f))}\0`);
  }
  return `sha256:${h.digest("hex")}`;
}

export function readExpected(task: LabTask): Expected | null {
  const p = join(task.dir, "expected.json");
  if (!existsSync(p)) return null;
  const o = JSON.parse(readFileSync(p, "utf8")) as Partial<Expected>;
  if (!Array.isArray(o.fail_to_pass) || !Array.isArray(o.pass_to_pass) || typeof o.total !== "number") throw new TaskError(`${p}: malformed`);
  return { fail_to_pass: o.fail_to_pass, pass_to_pass: o.pass_to_pass, total: o.total };
}

/** Copy the starting repository into `dest`. The hidden tests and the gold change are not copied: the agent never sees them. */
export function copyBase(task: LabTask, dest: string): void {
  mkdirSync(dest, { recursive: true });
  cpSync(join(task.dir, "base"), dest, { recursive: true });
}

/** Apply the gold change on top of a workspace: every file under `gold/` replaces or adds the file at the same path. */
export function overlayGold(task: LabTask, dest: string): void {
  cpSync(join(task.dir, "gold"), dest, { recursive: true });
}
