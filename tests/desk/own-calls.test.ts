import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Budget, BudgetError, ASK_LIVE } from "../../src/desk/agents/budget.ts";
import { callModel, ModelError, type ModelPort, type ModelRequest, type ModelResponse } from "../../src/desk/agents/model.ts";
import { ledgerSink } from "../../src/desk/agents/own-ledger.ts";
import { completeOwn, setOwnCallSink } from "../../src/desk/agents/own-calls.ts";
import { MemoryTrace } from "../../src/desk/agents/trace.ts";
import { ask } from "../../src/desk/ask/ask.ts";
import { billCommand } from "../../src/desk/bill/command.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { forgetLedger } from "../../src/desk/security/forget.ts";
import { assistantLine, SONNET55, TempDir, testSnapshot } from "./helpers.ts";

const snap = testSnapshot();
let db: Ledger;
let dir: TempDir;
beforeEach(() => {
  db = openLedger(":memory:");
  dir = new TempDir();
});
afterEach(() => {
  setOwnCallSink(null);
  db.close();
  dir.dispose();
});

const reply = (over: Partial<ModelResponse> = {}): ModelResponse => ({ content: "ok", toolCalls: [], servedBy: "other", servedModel: "claude-sonnet-5-5", source: "live", usage: { inputTokens: 1000, outputTokens: 500, reasoningTokens: 0 }, ...over });
const port = (r: () => ModelResponse | Error): ModelPort => ({ async complete(): Promise<ModelResponse> { const x = r(); if (x instanceof Error) throw x; return x; } });
const req = (role = "ask_planner"): ModelRequest => ({ role, messages: [{ role: "user", content: "hello" }], maxTokens: 400 });
const rows = (): Record<string, unknown>[] => db.prepare("SELECT * FROM desk_call ORDER BY call_id").all() as Record<string, unknown>[];

describe("the Desk's own calls are written to its ledger, priced like any other", () => {
  it("records a call with its role, model, tokens and an estimate that is the tokens times the list price", async () => {
    setOwnCallSink(ledgerSink(db, snap));
    await callModel(port(() => reply()), req("explainer"), { budget: new Budget(ASK_LIVE) });
    const [r] = rows();
    expect(r).toMatchObject({ role: "explainer", served_model: "claude-sonnet-5-5", source: "live", input_tokens: 1000, output_tokens: 500, ok: 1, class: "estimated", snapshot_id: "test-snapshot" });
    // 1000 tokens at $2 per million and 500 at $10 per million, recomputed here and not read from the code under test.
    expect(r!["total_micros"]).toBe((1000 * SONNET55.inputPerMTokMicros + 500 * SONNET55.outputPerMTokMicros) / 1_000_000);
  });

  it("counts a call on a model with no price and does not invent a dollar figure, and does not refuse it", async () => {
    setOwnCallSink(ledgerSink(db, snap, { dailyCapMicros: 1, configuredModel: () => "nvidia/free-tier-model" }));
    const p = port(() => reply({ servedModel: "nvidia/free-tier-model" }));
    await callModel(p, req(), { budget: new Budget(ASK_LIVE) }); // a cap of one micro-dollar, and a model with no price: counted, not denied
    expect(rows()[0]).toMatchObject({ class: "unpriced", total_micros: null, input_tokens: 1000 });
    expect(String(rows()[0]!["unpriced_reason"])).toContain("no price for this model");
  });

  it("records a failed call as failed, with a cleaned reason and no dollars", async () => {
    setOwnCallSink(ledgerSink(db, snap));
    await expect(callModel(port(() => new ModelError("transient", 'HTTP 503: {"error": "busy"}\n')), req(), { budget: new Budget(ASK_LIVE) })).rejects.toBeInstanceOf(ModelError);
    expect(rows()[0]).toMatchObject({ ok: 0, class: "unpriced", total_micros: null });
    expect(String(rows()[0]!["error"])).not.toMatch(/["{}\n]/);
    expect(String(rows()[0]!["unpriced_reason"])).toContain("failed");
  });

  it("does not write a reply that was replayed from a recording: it sent nothing and cost nothing", async () => {
    setOwnCallSink(ledgerSink(db, snap));
    await callModel(port(() => reply({ source: "cassette", servedBy: "cassette" })), req(), { budget: new Budget(ASK_LIVE) });
    expect(rows()).toEqual([]);
  });

  it("writes nothing when no sink is set, which is how the tests and the proof run", async () => {
    await callModel(port(() => reply()), req(), { budget: new Budget(ASK_LIVE) });
    expect(rows()).toEqual([]);
  });

  it("records a call a role makes outside callModel, as the canary does", async () => {
    setOwnCallSink(ledgerSink(db, snap));
    await completeOwn(port(() => reply()), req("canary_primary"), 1000);
    expect(rows().map((r) => [r["role"], r["class"]])).toEqual([["canary_primary", "estimated"]]);
  });

  it("is what an Ask run writes: one row per model call it made, and the same count the trace shows", async () => {
    setOwnCallSink(ledgerSink(db, snap));
    await ingestClaudeCode(db, [dir.file("a.jsonl", [assistantLine({ id: "m1", ts: "2026-10-20T10:00:00Z", output: 4000 })])], snap);
    const trace = new MemoryTrace();
    const p: ModelPort = {
      async complete(r: ModelRequest): Promise<ModelResponse> {
        if (r.role === "ask_planner") return reply({ toolCalls: [{ id: "t1", name: "plan_answer", arguments: { steps: [{ id: "s1", op: "spend", from: "2026-10-20", to: "2026-10-20", group: "none" }] } }] });
        return reply({ content: "{}" });
      },
    };
    await ask({ db, question: "How much did we spend in total?", port: p, trace, record: false });
    const calls = trace.events.filter((e) => e.event === "desk.model").length;
    expect(calls).toBeGreaterThan(0);
    expect(rows()).toHaveLength(calls);
    expect(rows().some((r) => r["role"] === "ask_planner")).toBe(true);
  });
});

describe("a daily limit on the Desk's own calls", () => {
  it("refuses a call that could pass it before it is sent, and Ask falls back to its rules and says why", async () => {
    // One micro-dollar a day, and a priced model: any call could cost more than that.
    setOwnCallSink(ledgerSink(db, snap, { dailyCapMicros: 1, configuredModel: () => "claude-sonnet-5-5" }));
    let sent = 0;
    const p = port(() => { sent += 1; return reply(); });
    await expect(callModel(p, req(), { budget: new Budget(ASK_LIVE) })).rejects.toBeInstanceOf(BudgetError);
    expect(sent).toBe(0);
    await ingestClaudeCode(db, [dir.file("a.jsonl", [assistantLine({ id: "m1", ts: "2026-10-20T10:00:00Z", output: 4000 })])], snap);
    const trace = new MemoryTrace();
    const r = await ask({ db, question: "How much did we spend in total?", port: p, trace, record: false });
    expect(sent).toBe(0);
    expect(r.planner).toBe("rules");
    expect(r.status).toBe("answered");
    expect(JSON.stringify(trace.events)).toContain("own_spend");
  });

  it("allows calls until the day's estimated spend plus the next worst case would pass the limit, and counts only today", async () => {
    let now = new Date("2026-10-25T10:00:00Z");
    // A request of about 100 tokens in and 400 out costs $0.0042 at worst on the test model; a limit of $0.01 allows two and refuses the third.
    setOwnCallSink(ledgerSink(db, snap, { dailyCapMicros: 10_000, configuredModel: () => "claude-sonnet-5-5", now: () => now }));
    const p = port(() => reply({ usage: { inputTokens: 100, outputTokens: 400, reasoningTokens: 0 } }));
    await callModel(p, req(), { budget: new Budget(ASK_LIVE) }); // 100 in + 400 out = $0.0042
    await callModel(p, req(), { budget: new Budget(ASK_LIVE) }); // $0.0084 spent
    await expect(callModel(p, req(), { budget: new Budget(ASK_LIVE) })).rejects.toThrow(/own_spend/);
    // The next UTC day starts again from zero.
    now = new Date("2026-10-26T00:00:01Z");
    await callModel(p, req(), { budget: new Budget(ASK_LIVE) });
    expect(rows()).toHaveLength(3);
  });

  it("says in the error what was spent and what the limit is", async () => {
    const now = new Date("2026-10-25T10:00:00Z");
    setOwnCallSink(ledgerSink(db, snap, { dailyCapMicros: 2_000_000, configuredModel: () => "claude-sonnet-5-5", now: () => now }));
    db.prepare("INSERT INTO desk_call (ts, role, source, ms, ok, class, total_micros) VALUES (?, 'ask_planner', 'live', 1, 1, 'estimated', 1990000)").run("2026-10-25T08:00:00.000Z");
    const big: ModelRequest = { role: "ask_planner", messages: [{ role: "user", content: "hello" }], maxTokens: 2000 };
    const e = (await callModel(port(() => reply()), big, { budget: new Budget(ASK_LIVE) }).catch((x: unknown) => x)) as BudgetError;
    expect(e.code).toBe("E_BUDGET_EXCEEDED");
    expect(e.message).toBe("E_BUDGET_EXCEEDED: own_spend: today's own model calls cost $1.99 and this one could cost up to $0.02, past the limit of $2.00");
  });
});

describe("on the bill", () => {
  async function seed(): Promise<void> {
    await ingestClaudeCode(db, [dir.file("a.jsonl", [assistantLine({ id: "m1", ts: "2026-10-20T10:00:00Z", output: 4000 })])], snap);
    setOwnCallSink(ledgerSink(db, snap, { now: () => new Date("2026-10-20T12:00:00Z") }));
    const p = port(() => reply());
    for (const role of ["ask_planner", "ask_planner", "explainer"]) await callModel(p, req(role), { budget: new Budget(ASK_LIVE) });
    await callModel(port(() => reply({ servedModel: "nvidia/free-tier-model" })), req("canary_primary"), { budget: new Budget(ASK_LIVE) });
    await callModel(port(() => new ModelError("non_transient", "HTTP 400")), req("explainer"), { budget: new Budget(ASK_LIVE) }).catch(() => undefined);
  }

  it("shows the Desk's own calls apart from the agents', with the totals the rows add up to", async () => {
    await seed();
    const r = billCommand({ db, snapshot: snap, mode: "own_logs", month: undefined, since: undefined, until: undefined, now: new Date() } as never);
    expect(r.ok, r.text).toBe(true);
    expect(r.text).toContain("The Desk's own model calls (not in the agents' figures above)");
    // Three priced calls of 1,000 in and 500 out at $2 and $10 a million: $0.007 each, $0.021 in all.
    expect(r.text).toContain("5 calls, 4,000 tokens in and 2,000 out: $0.02 estimated on 3 priced calls");
    expect(r.text).toContain("1 on a model with no price (counted, not priced)");
    expect(r.text).toContain("1 failed (whether billed is unknown)");
    expect(r.text).toContain("ask_planner");
    expect(r.text).toContain("No daily limit is set (DESK_OWN_DAILY_CAP_USD).");
  });

  it("is not in the agents' spend: the bill's total is the agents' calls alone", async () => {
    await seed();
    const withOwn = billCommand({ db, snapshot: snap, mode: "own_logs", now: new Date() } as never);
    const noOwn = openLedger(":memory:");
    try {
      await ingestClaudeCode(noOwn, [dir.file("b.jsonl", [assistantLine({ id: "m1", ts: "2026-10-20T10:00:00Z", output: 4000 })])], snap);
      const plain = billCommand({ db: noOwn, snapshot: snap, mode: "own_logs", now: new Date() } as never);
      const head = (t: string): string => t.split("\n")[0]!;
      expect(head(withOwn.text)).toBe(head(plain.text));
      expect(plain.text).not.toContain("The Desk's own model calls");
    } finally {
      noOwn.close();
    }
  });

  it("is removed by forgetting everything, and by forgetting before a date", async () => {
    await seed();
    const before = rows().length;
    expect(before).toBe(5);
    db.prepare("UPDATE desk_call SET ts = '2026-09-01T00:00:00.000Z' WHERE call_id <= 2").run();
    forgetLedger(db, { before: "2026-10-01" });
    expect(rows()).toHaveLength(3);
    forgetLedger(db, { all: true });
    expect(rows()).toHaveLength(0);
  });
});
