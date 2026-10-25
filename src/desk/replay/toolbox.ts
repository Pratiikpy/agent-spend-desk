import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ToolSpec } from "../agents/model.ts";
import { runTests, type TestPlan } from "../capture/runner.ts";
import { canonicalJson } from "../../runtime/canonical.ts";
import { maskForKey, normalizeInput, type Trajectory } from "../trajectory/read.ts";
import { classifyTool, type Effect, type ToolClass, type ToolKind } from "../trajectory/tools.ts";

/**
 * The tools a replayed model is given, and the rule that nothing it asks for can reach outside the sandbox (DF-041). A replay runs a different model on a task that was done once
 * before. That model will ask for what it likes, so each call is decided by what it is and never by what it says it is for:
 *
 * - the tools the Desk offers (Read, Glob, Grep, LS, Edit, Write, RunTests) are run, inside the sandbox folder and nowhere else: a path that leaves it, by `..`, by an absolute
 *   path, or through a link, is refused, and nothing is written to `.git` or `node_modules`;
 * - any other call is classed by what it could do (`classifyTool`). A call that only reads is answered from the recording if the same call was recorded, and otherwise refused with
 *   a message. A call that could change something, a shell command that cannot be shown to only read, a call to the network, another agent or a tool not known, is never run: if
 *   the recording holds the same call, its recorded result is served; if it does not, the item DIVERGES and the replay stops there, because nothing can say what the call would
 *   have done, and a result that comes after a guess is not a result.
 *
 * A call is the same call when its tool and its redacted input, with the sandbox's own folder written as `<cwd>`, hash to a key the recording holds.
 */
export type How = "executed" | "recording" | "stub" | "refused" | "diverged";

export interface Outcome {
  name: string;
  class: ToolClass;
  effect: Effect;
  how: How;
  content: string;
  isError: boolean;
  /** For a divergence or a refusal, what the call was and why it was not run. */
  note: string | null;
}

export interface Recorded {
  result: string;
  isError: boolean;
  tool: string;
}

/** A session's recorded calls and results, by the key a call is looked up by. */
export type Recording = ReadonlyMap<string, Recorded>;

export function recordingOf(t: Trajectory): Recording {
  const m = new Map<string, Recorded>();
  for (const s of t.steps) if (s.result.present && !s.result.truncated && s.result.text !== null) m.set(s.keySha, { result: s.result.text, isError: s.result.isError, tool: s.tool });
  return m;
}

export interface Limits {
  readBytes: number;
  writeBytes: number;
  resultChars: number;
  matches: number;
  files: number;
  testRuns: number;
  grepMs: number;
}

export const DEFAULT_LIMITS: Limits = { readBytes: 400_000, writeBytes: 1_000_000, resultChars: 30_000, matches: 200, files: 500, testRuns: 12, grepMs: 5000 };

export interface ToolboxOptions {
  /** The sandbox folder: where every offered tool works and the only place it can. */
  dir: string;
  recording?: Recording;
  /** The owner's tests, for the RunTests tool. Without them RunTests says there are none. */
  tests?: { plan: TestPlan; files: readonly string[]; scratch: string };
  /** Folders outside the sandbox that may be read and never written (the linked dependencies). */
  readRoots?: readonly string[];
  limits?: Partial<Limits>;
  overrides?: ReadonlyMap<string, ToolKind>;
}

const OFFERED = ["Read", "Glob", "Grep", "LS", "Edit", "Write", "RunTests"] as const;
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/**
 * What a test run printed, made the same from one run to the next: the sandbox's own folder is written as <repo> and the timings are taken out. A replay's model calls are recorded
 * by the text they were sent, so a test result that carried the folder it ran in or how long it took would make every replay a new conversation and none of them repeatable.
 */
export function steady(text: string, dir: string): string {
  const forward = dir.replace(/\\/g, "/");
  const folder = forward.split("/").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\\\/]");
  return text
    .replace(new RegExp(folder, "gi"), "<repo>")
    .replace(/<repo>([^\s"')\]]*)/g, (_m, rest: string) => `<repo>${rest.replace(/\\/g, "/")}`)
    .replace(/\b(?:duration_ms|time)["']?\s*[:=]\s*["']?[\d.]+["']?/gi, "")
    .replace(/\b\d+(?:\.\d+)?\s?ms\b/g, "")
    .replace(/0x[0-9a-f]{6,}/gi, "0x…");
}
const SKIP_DIRS = new Set([".git", "node_modules"]);

function samePath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function under(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)) || samePath(root, target);
}

/** A glob over paths with `/` separators: `**` crosses folders, `*` and `?` do not. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i += 1;
        if (glob[i + 1] === "/") {
          i += 1;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end > i) {
        re += `(?:${glob.slice(i + 1, end).split(",").map((x) => x.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|")})`;
        i = end;
      } else re += "\\{";
    } else re += c.replace(/[.+^$()|[\]\\}]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export class Toolbox {
  readonly dir: string;
  private readonly realRoot: string;
  private readonly limits: Limits;
  private readonly recording: Recording;
  private readonly readRoots: string[];
  private testRuns = 0;
  /** What was done, by how: for the accounting of a replay. */
  readonly counts: Record<How, number> = { executed: 0, recording: 0, stub: 0, refused: 0, diverged: 0 };
  /** Files the model wrote or edited, relative to the sandbox. */
  readonly touched = new Set<string>();
  /** Set when a call that could change something was asked for and was not on the recording: the replay stops here. */
  divergence: string | null = null;
  readonly log: Outcome[] = [];

  constructor(private readonly o: ToolboxOptions) {
    this.dir = resolve(o.dir);
    this.realRoot = realpathSync(this.dir);
    this.limits = { ...DEFAULT_LIMITS, ...(o.limits ?? {}) };
    this.recording = o.recording ?? new Map();
    this.readRoots = (o.readRoots ?? []).filter((r) => existsSync(r)).map((r) => realpathSync(r));
  }

  specs(): ToolSpec[] {
    const path = { type: "string", description: "A path inside the repository, relative to its root." };
    return [
      { name: "Read", description: "Read a file. Returns its lines numbered. Use offset and limit for a long file.", parameters: { type: "object", properties: { file_path: path, offset: { type: "integer" }, limit: { type: "integer" } }, required: ["file_path"] } },
      { name: "Glob", description: "List files whose path matches a glob such as src/**/*.js.", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } },
      { name: "Grep", description: "Search file contents for a regular expression. Returns path:line:text.", parameters: { type: "object", properties: { pattern: { type: "string" }, path: path, glob: { type: "string" } }, required: ["pattern"] } },
      { name: "LS", description: "List a directory.", parameters: { type: "object", properties: { path: path } } },
      { name: "Edit", description: "Replace one exact string in a file with another. old_string must occur once, unless replace_all is true.", parameters: { type: "object", properties: { file_path: path, old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } }, required: ["file_path", "old_string", "new_string"] } },
      { name: "Write", description: "Create or overwrite a file with the given content.", parameters: { type: "object", properties: { file_path: path, content: { type: "string" } }, required: ["file_path", "content"] } },
      { name: "RunTests", description: "Run the project's tests. Optionally name the test files to run.", parameters: { type: "object", properties: { files: { type: "array", items: { type: "string" } } } } },
    ];
  }

  /** The folder as the model is told of it: always the same, whatever the sandbox's real name. */
  static readonly ROOT_NAME = "the repository";

  private key(name: string, input: unknown): string {
    const normalized = normalizeInput(input ?? {}, this.dir, maskForKey);
    return sha(`${name}\0${canonicalJson(normalized)}`).slice(0, 16);
  }

  /** The real path of a path the model gave, if it is inside the sandbox (or, for reading, a folder it may read); otherwise why not. */
  private inside(p: unknown, o: { write: boolean }): { path: string } | { why: string } {
    if (typeof p !== "string" || p === "" || p.includes("\0")) return { why: "a path is needed" };
    const wanted = isAbsolute(p) ? resolve(p) : resolve(this.dir, p);
    const lexical = relative(this.dir, wanted);
    const segments = lexical.split(sep);
    if (o.write && (segments.includes(".git") || segments.includes("node_modules"))) return { why: "nothing is written under .git or node_modules" };
    if (!o.write && segments.includes(".git")) return { why: "the repository's own history is not readable here" };
    // The nearest part of the path that exists decides where it really is, so that a link cannot lead out and a new file can still be made.
    let probe = wanted;
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
    let real: string;
    try {
      real = realpathSync(probe);
    } catch {
      return { why: "the path could not be resolved" };
    }
    const tail = relative(probe, wanted);
    const resolved = tail === "" ? real : join(real, tail);
    if (under(this.realRoot, resolved)) return { path: wanted };
    if (!o.write && this.readRoots.some((r) => under(r, resolved)) && segments[0] === "node_modules") return { path: wanted };
    return { why: "that path is outside the repository" };
  }

  private walk(max: number): string[] {
    const out: string[] = [];
    const visit = (d: string): void => {
      if (out.length >= max) return;
      for (const name of readdirSync(d).sort()) {
        if (SKIP_DIRS.has(name)) continue;
        const p = join(d, name);
        let st;
        try {
          st = lstatSync(p);
        } catch {
          continue;
        }
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) visit(p);
        else if (st.isFile()) out.push(relative(this.dir, p).split(sep).join("/"));
        if (out.length >= max) return;
      }
    };
    visit(this.dir);
    return out;
  }

  private done(name: string, kind: ToolKind, how: How, content: string, isError: boolean, note: string | null = null): Outcome {
    const cut = content.length > this.limits.resultChars ? `${content.slice(0, this.limits.resultChars)}\n[output cut at ${this.limits.resultChars} characters]` : content;
    const out: Outcome = { name, class: kind.class, effect: kind.effect, how, content: cut, isError, note };
    this.counts[how] += 1;
    this.log.push(out);
    return out;
  }

  call(name: string, args: unknown): Outcome {
    const a = typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
    if (this.divergence !== null) return this.done(name, classifyTool(name, a, this.o.overrides), "refused", "the replay has diverged and is stopped", true, this.divergence);
    if ((OFFERED as readonly string[]).includes(name)) return this.offered(name, a);
    const kind = classifyTool(name, a, this.o.overrides);
    const recorded = this.recording.get(this.key(name, a));
    if (recorded) return this.done(name, kind, "recording", recorded.result, recorded.isError, "the same call was recorded; its recorded result is given and nothing was run");
    if (kind.class === "read_only") return this.done(name, kind, "stub", `${name} is not available in a replay. Use Read, Glob, Grep and LS to read the repository, Edit and Write to change files, and RunTests to run the tests.`, true, `not run: ${kind.why}`);
    this.divergence = `the model asked for ${name}${name === "Bash" && typeof a["command"] === "string" ? ` with ${JSON.stringify((a["command"] as string).slice(0, 100))}` : ""}, which could change something and was not recorded (${kind.why}); it was not run`;
    return this.done(name, kind, "diverged", `${name} is not available in a replay.`, true, this.divergence);
  }

  private offered(name: string, a: Record<string, unknown>): Outcome {
    const kind: ToolKind = name === "RunTests" ? { class: "mutating", effect: "shell", why: "runs the owner's tests in the sandbox" } : classifyTool(name, a);
    const fail = (msg: string): Outcome => this.done(name, kind, "refused", msg, true, msg);
    switch (name) {
      case "Read": {
        const r = this.inside(a["file_path"], { write: false });
        if ("why" in r) return fail(`Read refused: ${r.why}.`);
        if (!existsSync(r.path) || !statSync(r.path).isFile()) return fail(`Read: ${String(a["file_path"])} is not a file.`);
        const bytes = readFileSync(r.path);
        if (bytes.subarray(0, 8000).includes(0)) return fail("Read: that file is binary.");
        const lines = bytes.subarray(0, this.limits.readBytes).toString("utf8").split("\n");
        const offset = Math.max(0, Number.isInteger(a["offset"]) ? (a["offset"] as number) : 0);
        const limit = Math.min(2000, Number.isInteger(a["limit"]) ? (a["limit"] as number) : 2000);
        const slice = lines.slice(offset, offset + limit);
        const cut = bytes.length > this.limits.readBytes ? `\n[file cut at ${this.limits.readBytes} bytes]` : "";
        return this.done(name, kind, "executed", `${slice.map((l, i) => `${String(offset + i + 1).padStart(6)}\t${l}`).join("\n")}${cut}`, false);
      }
      case "LS": {
        const r = this.inside(a["path"] ?? ".", { write: false });
        if ("why" in r) return fail(`LS refused: ${r.why}.`);
        if (!existsSync(r.path) || !statSync(r.path).isDirectory()) return fail(`LS: ${String(a["path"] ?? ".")} is not a directory.`);
        const entries = readdirSync(r.path, { withFileTypes: true }).filter((e) => e.name !== ".git").sort((x, y) => (x.name < y.name ? -1 : 1));
        return this.done(name, kind, "executed", entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n") || "(empty)", false);
      }
      case "Glob": {
        if (typeof a["pattern"] !== "string" || a["pattern"].length > 300) return fail("Glob: a pattern is needed.");
        const re = globToRegExp(a["pattern"].replace(/^\.\//, ""));
        const hits = this.walk(20_000).filter((f) => re.test(f)).slice(0, this.limits.files);
        return this.done(name, kind, "executed", hits.length > 0 ? hits.join("\n") : "(no files match)", false);
      }
      case "Grep": {
        if (typeof a["pattern"] !== "string" || a["pattern"] === "" || a["pattern"].length > 200) return fail("Grep: a pattern of up to 200 characters is needed.");
        let re: RegExp;
        try {
          re = new RegExp(a["pattern"]);
        } catch (e) {
          return fail(`Grep: not a valid regular expression (${(e as Error).message.slice(0, 80)}).`);
        }
        const scope = a["path"] === undefined ? { path: this.dir } : this.inside(a["path"], { write: false });
        if ("why" in scope) return fail(`Grep refused: ${scope.why}.`);
        const only = typeof a["glob"] === "string" ? globToRegExp(a["glob"]) : null;
        const started = Date.now();
        const out: string[] = [];
        for (const f of this.walk(20_000)) {
          if (Date.now() - started > this.limits.grepMs) {
            out.push("[search stopped: too slow]");
            break;
          }
          const full = join(this.dir, ...f.split("/"));
          if (!under(scope.path, full) && !samePath(scope.path, full)) continue;
          if (only && !only.test(f) && !only.test(f.split("/").pop() as string)) continue;
          let text: string;
          try {
            const b = readFileSync(full);
            if (b.subarray(0, 8000).includes(0) || b.length > 2_000_000) continue;
            text = b.toString("utf8");
          } catch {
            continue;
          }
          const lines = text.split("\n");
          for (let i = 0; i < lines.length && out.length < this.limits.matches; i += 1) if (re.test((lines[i] as string).slice(0, 2000))) out.push(`${f}:${i + 1}:${(lines[i] as string).slice(0, 300)}`);
          if (out.length >= this.limits.matches) break;
        }
        return this.done(name, kind, "executed", out.length > 0 ? out.join("\n") : "(no matches)", false);
      }
      case "Write":
      case "Edit": {
        const r = this.inside(a["file_path"], { write: true });
        if ("why" in r) return fail(`${name} refused: ${r.why}.`);
        const rel = relative(this.dir, r.path).split(sep).join("/");
        if (name === "Write") {
          if (typeof a["content"] !== "string") return fail("Write: content is needed.");
          if (Buffer.byteLength(a["content"]) > this.limits.writeBytes) return fail(`Write: more than ${this.limits.writeBytes} bytes.`);
          mkdirSync(dirname(r.path), { recursive: true });
          writeFileSync(r.path, a["content"]);
          this.touched.add(rel);
          return this.done(name, kind, "executed", `Wrote ${rel}.`, false);
        }
        if (typeof a["old_string"] !== "string" || typeof a["new_string"] !== "string" || a["old_string"] === "") return fail("Edit: old_string and new_string are needed.");
        if (!existsSync(r.path) || !statSync(r.path).isFile()) return fail(`Edit: ${rel} is not a file.`);
        const text = readFileSync(r.path, "utf8");
        const count = text.split(a["old_string"]).length - 1;
        if (count === 0) return fail("Edit: old_string was not found.");
        if (count > 1 && a["replace_all"] !== true) return fail(`Edit: old_string occurs ${count} times; give more of the text around it, or set replace_all.`);
        const next = a["replace_all"] === true ? text.split(a["old_string"]).join(a["new_string"]) : text.replace(a["old_string"], () => a["new_string"] as string);
        if (Buffer.byteLength(next) > this.limits.writeBytes) return fail(`Edit: the file would pass ${this.limits.writeBytes} bytes.`);
        writeFileSync(r.path, next);
        this.touched.add(rel);
        return this.done(name, kind, "executed", `Edited ${rel}${a["replace_all"] === true ? ` (${count} places)` : ""}.`, false);
      }
      default: {
        const t = this.o.tests;
        if (!t) return fail("RunTests: this task has no tests to run.");
        if (this.testRuns >= this.limits.testRuns) return fail(`RunTests: the tests have been run ${this.limits.testRuns} times, the most a replay allows.`);
        this.testRuns += 1;
        const asked = Array.isArray(a["files"]) ? (a["files"] as unknown[]).filter((f): f is string => typeof f === "string") : [];
        const files = asked.length > 0 ? asked.filter((f) => t.files.includes(f)) : [...t.files];
        if (files.length === 0) return fail(`RunTests: name test files among ${t.files.join(", ")}.`);
        const run = runTests({ dir: this.dir, scratch: t.scratch, files, plan: t.plan, label: `replay-${this.testRuns}` });
        const status = new Map<string, number>();
        for (const r of run.results) status.set(r.status, (status.get(r.status) ?? 0) + 1);
        const failing = run.results.filter((r) => r.status === "fail").slice(0, 20).map((r) => `  failing: ${r.id}${r.detail ? ` - ${steady(r.detail.split("\n")[0] as string, this.dir).slice(0, 200)}` : ""}`);
        const head = run.resultsMissing ? `The tests gave no results${run.note ? ` (${steady(run.note, this.dir)})` : ""}.` : `${status.get("pass") ?? 0} passed, ${status.get("fail") ?? 0} failed, ${status.get("skip") ?? 0} skipped.`;
        const tail = run.resultsMissing ? steady(run.log.slice(-800), this.dir) : "";
        return this.done(name, kind, "executed", [head, ...failing, tail].filter(Boolean).join("\n"), run.resultsMissing || (status.get("fail") ?? 0) > 0, null);
      }
    }
  }
}
