import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { parseResults, type ResultFormat, type TestResult } from "./parsers.ts";

/**
 * Running the owner's own tests in a folder that is not their working copy (DF-036). The folder is a restored snapshot, so a test that writes files writes them there; the
 * environment the tests see is a short list of what a process needs to start, plus `CI=1`, so that a key in the owner's shell is not in front of code it was not meant for; and a
 * run is stopped at a time limit (300 seconds by default, the spec's). The Desk does not isolate the network: a test that calls out will call out. The owner's test command is
 * the code they already run on their own machine, and the tests it runs are the tests of a commit they kept.
 */
export type Preset = "node" | "vitest" | "jest" | "pytest" | "custom";

export interface TestPlan {
  preset: Preset;
  /** For `custom`: a shell command with `{files}` where the test files go and `{out}` where a results file is written. */
  command?: string;
  /** For `custom`: what the command writes. `tap` and `exit` read the command's own output and exit code; `junit` and `json` read the file at `{out}`. */
  format?: ResultFormat;
  timeoutMs?: number;
  /** Folder whose `node_modules` is linked into the sandbox. Without it the sandbox has only what its commit holds. */
  depsFrom?: string;
}

export const DEFAULT_TEST_TIMEOUT_MS = 300_000;
const SAFE_FILE = /^[\w@./+-]+$/;
const KEEP_ENV = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "TEMP", "TMP", "TMPDIR", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)", "ProgramData", "LANG", "LC_ALL", "TZ"];

export function scrubbedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of KEEP_ENV) if (process.env[k] !== undefined) env[k] = process.env[k];
  env["CI"] = "1";
  env["NO_COLOR"] = "1";
  env["NODE_ENV"] = "test";
  env["DESK_CAPTURE"] = "1";
  return env;
}

export interface RunOutcome {
  results: TestResult[];
  exitCode: number | null;
  timedOut: boolean;
  /** True when the command gave no readable results, which is not the same as no tests failing. */
  resultsMissing: boolean;
  note: string | null;
  ms: number;
  /** The last of what the command printed, for the person reviewing a task. */
  log: string;
}

export class RunnerError extends Error {}

function command(plan: TestPlan, dir: string, files: readonly string[], out: string): { argv: string[]; shell: boolean; format: ResultFormat } {
  const list = [...files];
  switch (plan.preset) {
    case "node":
      return { argv: [process.execPath, "--test", "--test-reporter=junit", `--test-reporter-destination=${out}`, ...list], shell: false, format: "junit" };
    case "vitest":
      return { argv: [process.execPath, join(dir, "node_modules", "vitest", "vitest.mjs"), "run", "--reporter=json", `--outputFile=${out}`, ...list], shell: false, format: "json" };
    case "jest":
      return { argv: [process.execPath, join(dir, "node_modules", "jest", "bin", "jest.js"), "--json", `--outputFile=${out}`, "--runInBand", ...list], shell: false, format: "json" };
    case "pytest":
      return { argv: [process.platform === "win32" ? "python" : "python3", "-m", "pytest", `--junitxml=${out}`, "-q", ...list], shell: false, format: "junit" };
    default: {
      if (!plan.command) throw new RunnerError("a custom test plan needs a command");
      const text = plan.command.replace(/\{files\}/g, list.join(" ")).replace(/\{out\}/g, out.includes(" ") ? `"${out}"` : out);
      return { argv: [text], shell: true, format: plan.format ?? "exit" };
    }
  }
}

export function linkDeps(dir: string, from: string | undefined): string | null {
  if (!from) return null;
  const source = join(from, "node_modules");
  const target = join(dir, "node_modules");
  if (!existsSync(source) || existsSync(target)) return null;
  try {
    symlinkSync(source, target, "junction");
    return null;
  } catch (e) {
    return `could not link ${source}: ${(e as Error).message}`;
  }
}

export function runTests(o: { dir: string; scratch: string; files: readonly string[]; plan: TestPlan; label: string }): RunOutcome {
  // Node 22's reporter does not name the file a test is in, so a run of Node's own test runner is made one file at a time, and each result is the file's.
  if (o.plan.preset === "node" && o.files.length > 1) {
    const parts = o.files.map((f, i) => runTests({ ...o, files: [f], label: `${o.label}-${i}` }));
    const bad = parts.find((p) => p.exitCode !== 0 && p.exitCode !== null);
    return {
      results: parts.flatMap((p) => p.results),
      exitCode: parts.some((p) => p.exitCode === null) ? null : (bad?.exitCode ?? 0),
      timedOut: parts.some((p) => p.timedOut),
      resultsMissing: parts.some((p) => p.resultsMissing),
      note: parts.map((p) => p.note).find((n) => n !== null) ?? null,
      ms: parts.reduce((a, p) => a + p.ms, 0),
      log: parts.map((p) => p.log).join("\n").slice(-20_000),
    };
  }
  for (const f of o.files) if (!SAFE_FILE.test(f)) throw new RunnerError(`${JSON.stringify(f)} has characters the Desk will not pass to a test command; rename it or capture another task`);
  mkdirSync(o.scratch, { recursive: true });
  const out = join(o.scratch, `${o.label}.results`);
  const { argv, shell, format } = command(o.plan, o.dir, o.files, out);
  const started = Date.now();
  const r = spawnSync(argv[0] as string, argv.slice(1), {
    cwd: o.dir,
    env: scrubbedEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: o.plan.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS,
    shell,
    windowsHide: true,
  });
  const ms = Date.now() - started;
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" || r.signal === "SIGTERM";
  const printed = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const log = printed.length > 20_000 ? printed.slice(-20_000) : printed;
  if (r.error && !timedOut) return { results: [], exitCode: null, timedOut: false, resultsMissing: true, note: `the test command could not be run: ${r.error.message}`, ms, log };
  if (timedOut) return { results: [], exitCode: null, timedOut: true, resultsMissing: true, note: `the test command was stopped after ${((o.plan.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS) / 1000).toFixed(0)} seconds`, ms, log };
  let text = "";
  if (format === "junit" || format === "json") {
    if (!existsSync(out)) return { results: [], exitCode: r.status, timedOut: false, resultsMissing: true, note: "the test command wrote no results file", ms, log };
    text = readFileSync(out, "utf8");
  } else if (format === "tap") text = r.stdout ?? "";
  try {
    const results = parseResults(format, { text, root: o.dir, exitCode: r.status, ...(o.plan.preset === "node" ? { nodeQuotes: true } : {}), ...(o.plan.preset === "node" && o.files.length === 1 ? { defaultFile: join(o.dir, o.files[0] as string) } : {}) });
    return { results, exitCode: r.status, timedOut: false, resultsMissing: format !== "exit" && results.length === 0, note: results.length === 0 && format !== "exit" ? "the results file held no tests" : null, ms, log };
  } catch (e) {
    return { results: [], exitCode: r.status, timedOut: false, resultsMissing: true, note: `the results could not be read: ${(e as Error).message}`, ms, log };
  }
}
