import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { BudgetError } from "../agents/budget.ts";
import { ModelError, type ChatMessage, type ModelPort } from "../agents/model.ts";
import { completeOwn } from "../agents/own-calls.ts";
import { runTests, linkDeps, type TestPlan } from "../capture/runner.ts";
import { dedupe } from "../capture/parsers.ts";
import { restoreSnapshot, SNAPSHOT_REF_PREFIX } from "../snapshot/shadow.ts";
import { Toolbox, type Recording } from "./toolbox.ts";

/**
 * One task run once on one route (DF-042). The route's model is given the task's prompt and a sandbox that holds the repository as it was before the work, and the tools of
 * `Toolbox`, and is let work until it stops asking for tools. Then the task is graded by the tests that decided it when it was captured: the tests the change added are laid
 * over the sandbox, replacing anything the model wrote at those paths, and run; every FAIL_TO_PASS test must now pass and every PASS_TO_PASS test must still pass. The model
 * is never shown which tests those are, nor the tests the change added.
 *
 * What an item can end as: `pass`, `fail`, `diverged` (the model asked for something that could change the world and was not on the recording, so the item stops and is not
 * comparable), `error` (the model or the network failed, and no score exists), or `over_budget` (a limit on turns, tokens or time was reached before the model finished, which
 * is a failure of the work and is graded as one, with the tests as they stand).
 */
export interface Route {
  /** A name that is the same every time and fits in a file name: it is part of the recording's key. */
  name: string;
  /** The model's identity as the port serves it, for the report. The port itself decides what is called. */
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface TaskForReplay {
  taskId: string;
  prompt: string;
  repoPath: string;
  baseRef: string;
  resultRef: string;
  /** Test files the change added or edited; every one is laid over the sandbox for grading. */
  overlay: readonly string[];
  /** Test files a test runner is pointed at. */
  runnable: readonly string[];
  failToPass: readonly string[];
  passToPass: readonly string[];
  flaky: readonly string[];
  plan: TestPlan;
  /** A task that did not fail before and pass after is not graded on a deciding test; its report row is kept apart. */
  oracle: "strong" | "weak";
}

export interface ItemLimits {
  maxTurns: number;
  /** Tokens, in plus out, over all of the item's model calls. */
  maxTokens: number;
  wallMs: number;
  callDeadlineMs: number;
}

export const DEFAULT_ITEM_LIMITS: ItemLimits = { maxTurns: 30, maxTokens: 400_000, wallMs: 600_000, callDeadlineMs: 120_000 };

export type ItemStatus = "pass" | "fail" | "diverged" | "error" | "over_budget";

export interface ItemResult {
  taskId: string;
  route: string;
  repeat: number;
  status: ItemStatus;
  failToPassPassed: number;
  failToPassTotal: number;
  passToPassPassed: number;
  passToPassTotal: number;
  turns: number;
  modelCalls: number;
  tokensIn: number;
  tokensOut: number;
  ms: number;
  tool: { executed: number; recording: number; stub: number; refused: number; diverged: number };
  touched: string[];
  divergence: string | null;
  error: string | null;
  servedModel: string | null;
  /** What ended the run when it was not the model's own finish. */
  stopped: string | null;
  /** The change the model made, as a unified diff of the files it touched against the starting point, cut at 40,000 characters. Empty when it touched nothing. */
  patch: string;
}

export const SYSTEM_PROMPT = [
  "You are a software engineer working in a repository. You are given a task. Use the tools to read the code, change it, and run the tests; the project's tests are run with RunTests.",
  "Make the change the task describes, in the repository's own files. When the work is done, reply with a short summary and no tool call. Do not ask the person questions.",
].join(" ");

export interface ReplayItemOptions {
  task: TaskForReplay;
  route: Route;
  repeat: number;
  port: ModelPort;
  limits?: Partial<ItemLimits>;
  /** The recorded session this task was captured from, for serving calls that were recorded. */
  recording?: Recording;
  /** Keep the sandbox after the item, for looking at what the model left. */
  keep?: boolean;
  now?: () => number;
}

function sandboxFrom(task: TaskForReplay, root: string): string {
  const dir = join(root, "work");
  restoreSnapshot({ repo: task.repoPath, ref: task.baseRef, into: dir });
  linkDeps(dir, task.plan.depsFrom ?? task.repoPath);
  return dir;
}

export const PATCH_CAP = 40_000;

/** A unified diff of each file the model touched against the file as it was at the starting point. A file that did not exist there is a whole new file. */
export function patchOf(t: TaskForReplay, dir: string, touched: readonly string[], scratch: string): string {
  const out: string[] = [];
  const empty = join(scratch, "patch-empty");
  const old = join(scratch, "patch-old");
  writeFileSync(empty, "");
  for (const path of touched) {
    const now = join(dir, ...path.split("/"));
    if (!existsSync(now)) {
      out.push(`deleted ${path}`);
      continue;
    }
    const was = spawnSync("git", ["cat-file", "blob", `${SNAPSHOT_REF_PREFIX}${t.baseRef}:${path}`], { cwd: t.repoPath, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(old, was.status === 0 ? (was.stdout as Buffer) : "");
    const d = spawnSync("git", ["diff", "--no-index", "--no-color", "--", was.status === 0 ? old : empty, now], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    const text = (d.stdout ?? "").split("\n").filter((l) => !/^(diff --git|index |new file mode|old mode|new mode)/.test(l)).map((l) => (l.startsWith("--- ") ? `--- a/${path}` : l.startsWith("+++ ") ? `+++ b/${path}` : l)).join("\n");
    if (text.trim() !== "") out.push(text.trimEnd());
  }
  const all = out.join("\n");
  return all.length > PATCH_CAP ? `${all.slice(0, PATCH_CAP)}\n[patch cut at ${PATCH_CAP} characters]` : all;
}

export async function runItem(o: ReplayItemOptions): Promise<ItemResult> {
  const limits = { ...DEFAULT_ITEM_LIMITS, ...(o.limits ?? {}) };
  const now = o.now ?? Date.now;
  const started = now();
  const root = mkdtempSync(join(tmpdir(), "desk-replay-"));
  const t = o.task;
  const result: ItemResult = {
    taskId: t.taskId, route: o.route.name, repeat: o.repeat, status: "error", failToPassPassed: 0, failToPassTotal: t.failToPass.length, passToPassPassed: 0, passToPassTotal: t.passToPass.length,
    turns: 0, modelCalls: 0, tokensIn: 0, tokensOut: 0, ms: 0, tool: { executed: 0, recording: 0, stub: 0, refused: 0, diverged: 0 }, touched: [], divergence: null, error: null, servedModel: null, stopped: null, patch: "",
  };
  try {
    const dir = sandboxFrom(t, root);
    const visible = t.runnable.filter((f) => existsSync(join(dir, ...f.split("/"))));
    const box = new Toolbox({
      dir,
      ...(o.recording ? { recording: o.recording } : {}),
      readRoots: t.plan.depsFrom || t.repoPath ? [join(t.plan.depsFrom ?? t.repoPath, "node_modules")] : [],
      ...(visible.length > 0 ? { tests: { plan: t.plan, files: visible, scratch: join(root, "out") } } : {}),
    });
    const messages: ChatMessage[] = [
      { role: "system", content: o.route.systemPrompt ?? SYSTEM_PROMPT },
      { role: "user", content: t.prompt },
    ];
    const role = `replay_${o.route.name}`;
    let finished = false;
    for (let turn = 0; turn < limits.maxTurns && !finished; turn += 1) {
      if (now() - started > limits.wallMs) {
        result.stopped = `the time limit of ${Math.round(limits.wallMs / 1000)} seconds was reached`;
        break;
      }
      if (result.tokensIn + result.tokensOut > limits.maxTokens) {
        result.stopped = `the limit of ${limits.maxTokens} tokens was reached`;
        break;
      }
      let resp;
      try {
        resp = await completeOwn(o.port, { role, messages, tools: box.specs(), temperature: o.route.temperature ?? 0, maxTokens: o.route.maxTokens ?? 4096, variant: o.repeat }, Math.min(limits.callDeadlineMs, Math.max(1000, limits.wallMs - (now() - started))));
      } catch (e) {
        result.error = e instanceof BudgetError ? `the Desk's own spend limit: ${e.message}` : e instanceof ModelError ? `${e.kind}${e.status ? ` ${e.status}` : ""}: ${e.message.slice(0, 160)}` : `unexpected: ${(e as Error).message.slice(0, 160)}`;
        result.status = "error";
        result.ms = now() - started;
        return result;
      }
      result.turns += 1;
      result.modelCalls += 1;
      result.tokensIn += resp.usage?.inputTokens ?? 0;
      result.tokensOut += resp.usage?.outputTokens ?? 0;
      result.servedModel = resp.servedModel;
      if (resp.toolCalls.length === 0) {
        if (turn === 0 && resp.content.trim() === "") {
          result.error = "the model gave an empty reply";
          result.status = "error";
          result.ms = now() - started;
          return result;
        }
        finished = true;
        break;
      }
      messages.push({ role: "assistant", content: resp.content, tool_calls: resp.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) });
      for (const call of resp.toolCalls) {
        const out = box.call(call.name, call.arguments);
        messages.push({ role: "tool", tool_call_id: call.id, content: out.content });
      }
      if (box.divergence !== null) {
        result.divergence = box.divergence;
        break;
      }
    }
    Object.assign(result.tool, box.counts);
    result.touched = [...box.touched].sort();
    result.patch = patchOf(t, dir, result.touched, root);
    if (box.divergence !== null) {
      result.status = "diverged";
      result.ms = now() - started;
      return result;
    }
    if (!finished && result.stopped === null) result.stopped = `the limit of ${limits.maxTurns} turns was reached`;

    // Grading: the tests that decided the task when it was captured, laid over what the model left.
    const resultDir = join(root, "result");
    restoreSnapshot({ repo: t.repoPath, ref: t.resultRef, into: resultDir });
    for (const f of t.overlay) {
      const from = join(resultDir, ...f.split("/"));
      if (!existsSync(from)) continue;
      const to = join(dir, ...f.split("/"));
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
    const run = runTests({ dir, scratch: join(root, "grade"), files: t.runnable.filter((f) => existsSync(join(dir, ...f.split("/")))), plan: t.plan, label: "grade" });
    if (run.resultsMissing && t.runnable.length > 0) {
      // The tests would not run at all: the work left something that stops them loading, which is a failure of the work and is graded as one.
      result.status = result.stopped ? "over_budget" : "fail";
      result.error = null;
      result.ms = now() - started;
      return result;
    }
    const got = dedupe(run.results);
    const flaky = new Set(t.flaky);
    const ok = (ids: readonly string[]): number => ids.filter((id) => !flaky.has(id) && got.get(id) === "pass").length;
    result.failToPassPassed = ok(t.failToPass);
    result.passToPassPassed = ok(t.passToPass);
    const need = (ids: readonly string[]): number => ids.filter((id) => !flaky.has(id)).length;
    const passed = result.failToPassPassed === need(t.failToPass) && result.passToPassPassed === need(t.passToPass) && (t.failToPass.length > 0 || t.passToPass.length > 0);
    result.status = passed ? "pass" : result.stopped ? "over_budget" : "fail";
    if (passed && result.stopped) result.status = "pass";
    result.ms = now() - started;
    return result;
  } catch (e) {
    result.error = `the replay itself failed: ${(e as Error).message.slice(0, 200)}`;
    result.status = "error";
    result.ms = now() - started;
    return result;
  } finally {
    if (!o.keep) rmSync(root, { recursive: true, force: true });
  }
}

