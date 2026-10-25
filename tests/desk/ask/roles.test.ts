import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryTrace } from "../../../src/desk/agents/trace.ts";
import { ModelError, type ModelPort, type ModelRequest, type ModelResponse } from "../../../src/desk/agents/model.ts";
import { ALL_ROLES, ask, type AskResult } from "../../../src/desk/ask/ask.ts";
import { findJsonlLogs } from "../../../src/desk/ingest/discover.ts";
import { openLedger, type Ledger } from "../../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../../src/desk/pricing/pricebook.ts";
import { buildSample, sampleLogsDir } from "../../../src/desk/sample/gen.ts";

/**
 * The role switches the role-necessity ablation uses (DF-085). Each switch takes exactly one role out of the answer pipeline and leaves the rest as they are, so a
 * difference in outcome is the role's. The default is the product, and a run with the switches left alone must be the run without them.
 */
type Reply = (r: ModelRequest) => Partial<ModelResponse> | Error;
class Scripted implements ModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly byRole: Record<string, Reply>) {}
  async complete(r: ModelRequest): Promise<ModelResponse> {
    this.requests.push(r);
    const reply = this.byRole[r.role];
    if (!reply) throw new ModelError("non_transient", `no script for ${r.role}`);
    const x = reply(r);
    if (x instanceof Error) throw x;
    return { content: "", toolCalls: [], servedBy: "other", servedModel: "scripted", source: "live", usage: null, ...x };
  }
  count(role: string): number {
    return this.requests.filter((r) => r.role === role).length;
  }
}
const plan = (program: unknown): Reply => () => ({ toolCalls: [{ id: "t1", name: "plan_answer", arguments: program as Record<string, unknown> }] });
const sentences = (...s: { text: string; cites: string[] }[]): Reply => () => ({ content: JSON.stringify({ sentences: s }) });

let dir: string;
let db: Ledger;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "desk-roles-"));
  const out = join(dir, "sample");
  buildSample({ outDir: out, seed: 5, months: 0.6, engineers: 8, start: "2026-10-01" } as never);
  db = openLedger(":memory:");
  await ingestClaudeCode(db, findJsonlLogs(sampleLogsDir(out)), loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json"));
}, 180_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (question: string, extra: Partial<Parameters<typeof ask>[0]> = {}): Promise<AskResult> => ask({ db, question, port: null, record: false, ...extra });
const spend = (id: string, extra: Record<string, unknown> = {}) => ({ id, op: "spend", from: "2026-10-01", to: "2026-10-31", group: "none", ...extra });
const text = (r: AskResult): string => r.sentences.map((s) => s.text).join(" ");

describe("the default is the product", () => {
  it("has every role on, and an empty switch list changes nothing", async () => {
    expect(ALL_ROLES).toEqual({ planner: "model", planCritic: true, explainer: "model", auditor: true, reflexion: true });
    const script = () => new Scripted({ ask_planner: plan({ steps: [spend("a")] }), explainer: sentences({ text: "That is the spend.", cites: ["a.1"] }) });
    const a = await run("How much did we spend in October?", { port: script() });
    const b = await run("How much did we spend in October?", { port: script(), roles: {} });
    const c = await run("How much did we spend in October?", { port: script(), roles: ALL_ROLES });
    for (const x of [b, c]) {
      expect(x.planner).toBe(a.planner);
      expect(x.explainer).toBe(a.explainer);
      expect(text(x)).toBe(text(a));
      expect(x.steps.map((s) => s.resultHash)).toEqual(a.steps.map((s) => s.resultHash));
    }
  });
});

describe("taking the Planner out", () => {
  it("plans with the rule planner and never asks the Planner model, while the Explainer is still the model", async () => {
    const port = new Scripted({ ask_planner: () => new Error("the Planner must not be called"), explainer: sentences({ text: "That is the spend.", cites: ["s1.1"] }) });
    const r = await run("How much did we spend?", { port, roles: { planner: "rules" } });
    expect(port.count("ask_planner")).toBe(0);
    expect(r.planner).toBe("rules");
    expect(port.count("explainer")).toBe(1);
    expect(r.explainer).toBe("model");
    expect(r.status).toBe("answered");
  });
});

describe("taking the plan critic out", () => {
  const needsDaily = "What was the average spend per day in October?";
  it("lets the first plan stand when it lacks the derived figure the question asks for", async () => {
    const only = { steps: [spend("a")] };
    const withCritic = new Scripted({ ask_planner: plan(only), explainer: sentences({ text: "That is the spend.", cites: ["a.1"] }) });
    const t1 = new MemoryTrace();
    await run(needsDaily, { port: withCritic, trace: t1 });
    expect(withCritic.count("ask_planner")).toBe(2);
    expect(t1.events.some((e) => e.event === "desk.plan.critique")).toBe(true);
    const without = new Scripted({ ask_planner: plan(only), explainer: sentences({ text: "That is the spend.", cites: ["a.1"] }) });
    const t2 = new MemoryTrace();
    const r = await run(needsDaily, { port: without, trace: t2, roles: { planCritic: false } });
    expect(without.count("ask_planner")).toBe(1);
    expect(t2.events.some((e) => e.event === "desk.plan.critique")).toBe(false);
    expect(r.program?.steps.map((s) => s.op)).toEqual(["spend"]);
  });
});

describe("taking the Explainer out", () => {
  it("states each claim as its own sentence from code and never asks the Explainer model", async () => {
    const port = new Scripted({ ask_planner: plan({ steps: [spend("a")] }), explainer: () => new Error("the Explainer must not be called") });
    const r = await run("How much did we spend in October?", { port, roles: { explainer: "rules" } });
    expect(port.count("explainer")).toBe(0);
    expect(r.explainer).toBe("rules");
    expect(r.planner).toBe("model");
    expect(r.status).toBe("answered");
    expect(r.sentences.every((s) => s.cites.length === 1)).toBe(true);
  });
});

describe("taking the Auditor out", () => {
  const unsupported = { text: "Spending was $9,999,999.00 and rising.", cites: ["a.1"] };
  it("shows a sentence the Auditor would have removed, and nothing was checked", async () => {
    const script = () => new Scripted({ ask_planner: plan({ steps: [spend("a")] }), explainer: sentences(unsupported) });
    const checked = await run("How much did we spend in October?", { port: script() });
    expect(text(checked)).not.toContain("9,999,999");
    expect(checked.status).toBe("unknowable");
    const trace = new MemoryTrace();
    const unchecked = await run("How much did we spend in October?", { port: script(), trace, roles: { auditor: false } });
    expect(text(unchecked)).toContain("Spending was $9,999,999.00 and rising.");
    expect(unchecked.status).toBe("answered");
    expect(trace.events.filter((e) => e.event === "desk.audit").every((e) => (e.detail as { audited: boolean }).audited === false)).toBe(true);
    expect(trace.events.some((e) => e.event === "revision.applied")).toBe(false);
  });
});

describe("taking the revision loop out", () => {
  it("still removes the unsupported sentence, but does not ask the Explainer to revise it", async () => {
    let call = 0;
    const explainer: Reply = () => {
      call += 1;
      const s = call === 1 ? { text: "The Desk spent $1,234,567.89 in total.", cites: ["s1.1"] } : { text: "The spend was an estimate from logged tokens.", cites: ["s1.1"] };
      return { content: JSON.stringify({ sentences: [s] }) };
    };
    const withLoop = new Scripted({ explainer });
    const trace1 = new MemoryTrace();
    const a = await run("How much did we spend?", { port: withLoop, trace: trace1 });
    expect(withLoop.count("explainer")).toBe(2);
    expect(a.sentences).toHaveLength(1);
    expect(trace1.events.some((e) => e.event === "revision.applied")).toBe(true);
    call = 0;
    const noLoop = new Scripted({ explainer });
    const trace2 = new MemoryTrace();
    const b = await run("How much did we spend?", { port: noLoop, trace: trace2, roles: { reflexion: false } });
    expect(noLoop.count("explainer")).toBe(1);
    expect(b.sentences).toHaveLength(0);
    expect(trace2.events.some((e) => e.event === "revision.applied")).toBe(false);
    expect(text(b)).not.toContain("1,234,567.89");
  });
});
