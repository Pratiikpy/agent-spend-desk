import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { AgentAdapter } from "./agents.ts";
import { gradeWorkspace, type Grade } from "./grade.ts";
import type { ProxyEntry } from "./proxy.ts";
import { copyBase, taskHash, type Expected, type LabTask } from "./task.ts";

export const RUN_SCHEMA = "desk.lab.run.v1";

export type Outcome = "pass" | "fail" | "timeout" | "infra";

export interface Accounting {
  calls: number;
  retries: number;
  promptTokens: number;
  completionTokens: number;
  receipts: number;
  cacheHits: number;
  /** Calls the agent was given an error for, after the proxy's own retries. */
  modelErrors: number;
}

export interface RunRecord {
  schema: typeof RUN_SCHEMA;
  runId: string;
  taskId: string;
  taskHash: string;
  arm: string;
  repeat: number;
  seed: number;
  agent: { name: string; version: string };
  model: string;
  startedAt: string;
  wallMs: number;
  outcome: Outcome;
  /** For `infra`: what went wrong outside the agent. For `timeout`: the limit. */
  reason: string;
  grade: Grade;
  diff: { filesChanged: number; linesAdded: number; linesRemoved: number; touchedProtected: boolean };
  accounting: Accounting;
  agentExit: { code: number | null; timedOut: boolean; outputBytes: number };
  env: { node: string; platform: string; envHash: string };
  /** Where the agent's printed output was saved. */
  transcript: string;
}

export interface RunSpec {
  runId: string;
  task: LabTask;
  expected: Expected;
  arm: string;
  repeat: number;
  seed: number;
  agent: AgentAdapter;
  model: string;
  /** The proxy's base URL for this run, or the model endpoint itself when no proxy is used. */
  modelUrl: string;
  /** What the proxy recorded for this run, read after the agent has stopped. */
  entriesFor: (runId: string) => ProxyEntry[];
  /** Waits for the proxy to finish recording the run's last calls, which it only notices a moment after the agent is gone. */
  settle?: (runId: string) => Promise<void>;
  /** A folder for this run's workspace and configuration. It must be outside the repository: an agent can walk up from its workspace. */
  workDir: string;
  /** Where the transcript and the patch the agent produced are kept for good. Defaults to the run's own folder. */
  artifactsDir?: string;
  timeoutMs: number;
  keepWorkspace?: boolean;
  now?: () => Date;
}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", ["-c", "user.name=lab", "-c", "user.email=lab@localhost", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? "" };
}

/** Record the starting state, so what the agent changed is a diff and not a guess. */
export function snapshotWorkspace(ws: string): void {
  git(ws, ["init", "-q"]);
  writeFileSync(join(ws, ".git", "info", "exclude"), "node_modules\n");
  git(ws, ["add", "-A"]);
  git(ws, ["commit", "-q", "-m", "base", "--allow-empty"]);
}

export function diffWorkspace(ws: string, protectedPaths: string[]): RunRecord["diff"] {
  git(ws, ["add", "-A"]);
  const stat = git(ws, ["diff", "--cached", "--numstat", "HEAD"]);
  let filesChanged = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  let touchedProtected = false;
  for (const line of stat.out.split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim());
    if (!m) continue;
    filesChanged += 1;
    linesAdded += m[1] === "-" ? 0 : Number(m[1]);
    linesRemoved += m[2] === "-" ? 0 : Number(m[2]);
    const file = (m[3] ?? "").replace(/\\/g, "/");
    if (protectedPaths.some((p) => file === p || file.startsWith(p.endsWith("/") ? p : `${p}/`))) touchedProtected = true;
  }
  return { filesChanged, linesAdded, linesRemoved, touchedProtected };
}

export function accountFor(entries: ProxyEntry[]): Accounting {
  const a: Accounting = { calls: entries.length, retries: 0, promptTokens: 0, completionTokens: 0, receipts: 0, cacheHits: 0, modelErrors: 0 };
  for (const e of entries) {
    a.retries += e.retries;
    a.promptTokens += e.promptTokens ?? 0;
    a.completionTokens += e.completionTokens ?? 0;
    if (e.receiptId) a.receipts += 1;
    if (e.fromCache) a.cacheHits += 1;
    if (e.status >= 400 || e.error) a.modelErrors += 1;
  }
  return a;
}

/**
 * Decide the outcome. An infrastructure failure is one where the evidence says the agent never had a fair chance, and
 * it stays in the denominator as its own class instead of being dropped: a result that hides infrastructure failures
 * overstates the agent.
 */
export function classify(input: { grade: Grade; timedOut: boolean; exitCode: number | null; accounting: Accounting; lastEntry: ProxyEntry | undefined; usesModel: boolean }): { outcome: Outcome; reason: string } {
  const { grade, timedOut, exitCode, accounting, lastEntry, usesModel } = input;
  if (grade.verdict === "infra") return { outcome: "infra", reason: grade.reason };
  if (grade.verdict === "pass") return { outcome: "pass", reason: "every expected test passed" };
  if (usesModel && accounting.calls === 0) return { outcome: "infra", reason: exitCode === null || exitCode !== 0 ? "the agent exited without making a model call" : "the agent made no model call" };
  if (usesModel && lastEntry && (lastEntry.status >= 400 || lastEntry.error)) return { outcome: "infra", reason: `the last model call failed (${lastEntry.error ?? `HTTP ${lastEntry.status}`})` };
  if (timedOut) return { outcome: "timeout", reason: "the agent did not finish within its time limit" };
  return { outcome: "fail", reason: grade.reason };
}

export function environmentHash(parts: { agent: string; agentVersion: string; model: string; taskHash: string }): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({ ...parts, node: process.version, platform: process.platform, arch: process.arch, schema: RUN_SCHEMA })).digest("hex")}`;
}

export async function runOnce(spec: RunSpec): Promise<RunRecord> {
  const now = spec.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const t0 = Date.now();
  // Absolute, because the agent runs with the workspace as its working directory and would resolve a relative path against that.
  const runDir = resolve(spec.workDir, spec.runId);
  const rel = relative(process.cwd(), runDir);
  if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) {
    throw new Error(`the work folder ${runDir} is inside the repository; an agent could read the hidden tests from there. Use a folder outside it.`);
  }
  const ws = join(runDir, "ws");
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });
  copyBase(spec.task, ws);
  snapshotWorkspace(ws);

  const hash = taskHash(spec.task);
  const agentVersion = spec.agent.version();
  let result: Awaited<ReturnType<AgentAdapter["run"]>>;
  try {
    result = await spec.agent.run({ task: spec.task, workspace: ws, runDir, modelUrl: spec.modelUrl, model: spec.model, timeoutMs: spec.timeoutMs });
  } catch (e) {
    result = { exitCode: null, timedOut: false, output: `[agent adapter error: ${(e as Error).message}]` };
  }

  await spec.settle?.(spec.runId);
  const entries = spec.entriesFor(spec.runId);
  const accounting = accountFor(entries);
  const diff = diffWorkspace(ws, spec.task.protected);
  const grade = gradeWorkspace(spec.task, ws, spec.expected, { scratch: join(runDir, "grading") });
  const { outcome, reason } = classify({ grade, timedOut: result.timedOut, exitCode: result.exitCode, accounting, lastEntry: entries[entries.length - 1], usesModel: spec.modelUrl !== "" });

  const keepDir = spec.artifactsDir ? resolve(spec.artifactsDir) : runDir;
  mkdirSync(keepDir, { recursive: true });
  const transcript = join(keepDir, `${spec.runId}.transcript.log`);
  writeFileSync(transcript, result.output);
  // The patch the agent produced, so a failure can be read later without the workspace.
  git(ws, ["add", "-A"]);
  const patch = git(ws, ["diff", "--cached", "HEAD"]).out;
  if (patch !== "") writeFileSync(join(keepDir, `${spec.runId}.patch`), patch.slice(0, 200_000));
  const record: RunRecord = {
    schema: RUN_SCHEMA,
    runId: spec.runId,
    taskId: spec.task.id,
    taskHash: hash,
    arm: spec.arm,
    repeat: spec.repeat,
    seed: spec.seed,
    agent: { name: spec.agent.name, version: agentVersion },
    model: spec.model,
    startedAt,
    wallMs: Date.now() - t0,
    outcome,
    reason,
    grade,
    diff,
    accounting,
    agentExit: { code: result.exitCode, timedOut: result.timedOut, outputBytes: Buffer.byteLength(result.output) },
    env: { node: process.version, platform: process.platform, envHash: environmentHash({ agent: spec.agent.name, agentVersion, model: spec.model, taskHash: hash }) },
    transcript,
  };
  // A passing run's workspace is of no further use; the others are kept, because a failure is read (the diff, the transcript) to tell a
  // wrong answer from a defective task before the result is believed.
  if (!spec.keepWorkspace && outcome === "pass") rmSync(ws, { recursive: true, force: true });
  return record;
}

export function appendRecord(path: string, record: RunRecord): void {
  mkdirSync(join(path, ".."), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}
