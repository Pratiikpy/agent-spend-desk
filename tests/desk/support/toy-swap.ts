import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "vitest";

import { ModelError, type ModelPort, type ModelRequest, type ModelResponse, type ToolCall } from "../../../src/desk/agents/model.ts";
import { importLabTasks } from "../../../src/desk/capture/import-lab.ts";
import { openCapture, type CaptureDb } from "../../../src/desk/capture/store.ts";
import { computeTask, listTasks, reviewTask, type TaskRow } from "../../../src/desk/capture/tasks.ts";

/** Small tasks in the Lab's layout, a model that follows a script, and the helpers to measure and accept the tasks: what the replay tests are built from. */
const root = mkdtempSync(join(tmpdir(), "desk-replay-run-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
export const fresh = (name: string): string => join(root, `${name}-${(n += 1)}`);
export const put = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** A folder of small tasks in the Lab's layout: a stub that does nothing, a visible test, a hidden test, and the change that solves it. */
export function toyLab(count: number): { dir: string; names: string[]; gold: Map<string, string> } {
  const dir = fresh("lab");
  const names = ["inc", "dbl", "neg", "sq", "cube", "half", "abs", "tri"].slice(0, count);
  const body: Record<string, [string, string]> = { inc: ["x + 1", "[[1, 2], [5, 6]]"], dbl: ["x * 2", "[[2, 4], [7, 14]]"], neg: ["-x", "[[3, -3], [-4, 4]]"], sq: ["x * x", "[[3, 9], [5, 25]]"], cube: ["x * x * x", "[[2, 8], [3, 27]]"], half: ["x / 2", "[[4, 2], [10, 5]]"], abs: ["Math.abs(x)", "[[-3, 3], [4, 4]]"], tri: ["x * 3", "[[1, 3], [5, 15]]"] };
  const gold = new Map<string, string>();
  for (const id of names) {
    const t = join(dir, id);
    const [expr, cases] = body[id] as [string, string];
    put(join(t, "task.json"), JSON.stringify({ schema: "desk.lab.task.v1", id, title: id, kind: "feature", prompt: `Implement ${id}(x) in src/${id}.js so that it returns ${expr.replace(/x/g, "the argument")}. It is a stub that returns null.`, test: { files: ["test/visible.test.js", "test/hidden.test.js"], timeoutSec: 30 }, protected: ["test"], origin: { type: "handwritten", licence: "MIT" } }));
    put(join(t, "base", "package.json"), '{"name":"toy","version":"1.0.0","scripts":{"test":"node --test"}}\n');
    put(join(t, "base", "src", `${id}.js`), `exports.${id} = () => null;\n`);
    put(join(t, "base", "test", "visible.test.js"), `const t = require("node:test"); const a = require("node:assert"); const m = require("../src/${id}.js");\nt("returns something", () => a.notStrictEqual(m.${id}(1), undefined));\n`);
    put(join(t, "gold", "src", `${id}.js`), `exports.${id} = (x) => ${expr};\n`);
    gold.set(id, `exports.${id} = (x) => ${expr};\n`);
    put(join(t, "hidden", "test", "hidden.test.js"), `const t = require("node:test"); const a = require("node:assert"); const m = require("../src/${id}.js");\nfor (const [x, want] of ${cases}) t("${id} of " + x, () => a.strictEqual(m.${id}(x), want));\n`);
  }
  return { dir, names, gold };
}

export type Script = (req: ModelRequest, turn: number) => Partial<ModelResponse> & { throws?: ModelError };

export class Scripted implements ModelPort {
  calls = 0;
  constructor(private readonly script: Script, private readonly source: "live" | "cassette" = "live") {}
  async complete(req: ModelRequest): Promise<ModelResponse> {
    const turn = req.messages.filter((m) => m.role === "assistant").length;
    this.calls += 1;
    const s = this.script(req, turn);
    if (s.throws) throw s.throws;
    return { content: "", toolCalls: [], servedBy: "other", servedModel: "scripted-model", source: this.source, usage: { inputTokens: 100, outputTokens: 50, reasoningTokens: 0 }, ...s };
  }
}

export const call = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({ id, name, arguments: args });
export const taskId = (req: ModelRequest): string => /Implement (\w+)\(x\)/.exec(req.messages.find((m) => m.role === "user")!.content)![1] as string;

export function solver(gold: Map<string, string>): Script {
  return (req, turn) => {
    const id = taskId(req);
    if (turn === 0) return { toolCalls: [call("c1", "Read", { file_path: `src/${id}.js` })] };
    if (turn === 1) return { toolCalls: [call("c2", "Write", { file_path: `src/${id}.js`, content: gold.get(id) as string })] };
    if (turn === 2) return { toolCalls: [call("c3", "RunTests", {})] };
    return { content: "Done." };
  };
}

export async function measured(count: number): Promise<{ store: CaptureDb; tasks: TaskRow[]; gold: Map<string, string>; names: string[] }> {
  const lab = toyLab(count);
  const store = openCapture(":memory:");
  importLabTasks(store, lab.dir, fresh("repos"), "2026-10-25T00:00:00Z");
  for (const t of listTasks(store)) {
    computeTask(store, t.task_id, { plan: { preset: "node" } });
    reviewTask(store, t.task_id, "accept");
  }
  return { store, tasks: listTasks(store, "accepted"), gold: lab.gold, names: lab.names };
}

