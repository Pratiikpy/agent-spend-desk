import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { recomputeCosts, recordSnapshot } from "../../src/desk/ledger/ingest.ts";
import { otelCommand } from "../../src/desk/otel/command.ts";
import { exportOtel } from "../../src/desk/otel/export.ts";
import { importOtel, parseOtel, type OtelImport } from "../../src/desk/otel/ingest.ts";
import { testSnapshot } from "./helpers.ts";

const tmp = mkdtempSync(join(tmpdir(), "desk-otel-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const snap = testSnapshot();
const T0 = Date.parse("2026-10-20T10:00:00.000Z");
const ns = (ms: number): string => String(BigInt(ms) * 1_000_000n);
type A = Record<string, string | number | boolean>;
const attrs = (o: A) =>
  Object.entries(o).map(([key, v]) => ({ key, value: typeof v === "string" ? { stringValue: v } : typeof v === "boolean" ? { boolValue: v } : Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v } }));

interface S {
  trace?: string;
  span: string;
  parent?: string;
  at?: number;
  flags?: number;
  name?: string;
  a: A;
}
const span = (s: S) => ({ traceId: s.trace ?? "t1".padEnd(32, "0"), spanId: s.span.padEnd(16, "0"), parentSpanId: s.parent ? s.parent.padEnd(16, "0") : "", name: s.name ?? "span", kind: 3, startTimeUnixNano: ns(s.at ?? T0), endTimeUnixNano: ns((s.at ?? T0) + 1000), ...(s.flags === undefined ? {} : { flags: s.flags }), attributes: attrs(s.a) });
const doc = (spans: unknown[], service = "shop-agent") => ({ resourceSpans: [{ resource: { attributes: attrs({ "service.name": service }) }, scopeSpans: [{ scope: { name: "test" }, spans }] }] });
const parsed = (d: unknown) => parseOtel(JSON.stringify(d)) as Exclude<ReturnType<typeof parseOtel>, string>;

describe("reading GenAI spans", () => {
  it("reads the current attribute names", () => {
    const p = parsed(doc([span({ span: "a1", a: { "gen_ai.operation.name": "chat", "gen_ai.provider.name": "anthropic", "gen_ai.request.model": "claude-opus-5", "gen_ai.response.model": "claude-opus-5", "gen_ai.usage.input_tokens": 1_000, "gen_ai.usage.output_tokens": 200, "gen_ai.conversation.id": "conv-1" } })]));
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]).toMatchObject({ model: "claude-opus-5", provider: "anthropic", inputTokens: 1_000, outputTokens: 200, session: "conv-1", service: "shop-agent", startedAt: "2026-10-20T10:00:00.000Z" });
  });

  it("reads the earlier names too: system, prompt and completion tokens", () => {
    const p = parsed(doc([span({ span: "a2", a: { "gen_ai.operation.name": "chat", "gen_ai.system": "openai", "gen_ai.request.model": "gpt-5", "gen_ai.usage.prompt_tokens": 700, "gen_ai.usage.completion_tokens": 90 } })]));
    expect(p.calls[0]).toMatchObject({ provider: "openai", model: "gpt-5", inputTokens: 700, outputTokens: 90, session: `trace-${"t1".padEnd(32, "0").slice(0, 16)}` });
  });

  it("takes cache tokens out of the input for a provider that counts them in it, and leaves them apart for Anthropic", () => {
    const common = { "gen_ai.operation.name": "chat", "gen_ai.request.model": "claude-opus-5", "gen_ai.usage.output_tokens": 10, "gen_ai.usage.cache_read.input_tokens": 600, "gen_ai.usage.cache_creation_input_tokens": 100 };
    const a = parsed(doc([span({ span: "c1", a: { ...common, "gen_ai.provider.name": "anthropic", "gen_ai.usage.input_tokens": 300 } })]));
    expect(a.calls[0]).toMatchObject({ inputTokens: 300, cacheReadTokens: 600, cacheWriteTokens: 100 });
    const o = parsed(doc([span({ span: "c2", a: { ...common, "gen_ai.provider.name": "openai", "gen_ai.usage.input_tokens": 1_000 } })]));
    expect(o.calls[0]).toMatchObject({ inputTokens: 300, cacheReadTokens: 600, cacheWriteTokens: 100 });
    const impossible = parsed(doc([span({ span: "c3", a: { ...common, "gen_ai.provider.name": "openai", "gen_ai.usage.input_tokens": 200 } })]));
    expect(impossible.calls[0]).toMatchObject({ inputTokens: 200 }); // more cache than input can only be apart
  });

  it("counts only the leaf: a parent that totals its children's usage is skipped, a sibling is not", () => {
    const usage = { "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 10 };
    const p = parsed(doc([
      span({ span: "p", name: "workflow", a: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "claude-opus-5", "gen_ai.usage.input_tokens": 300, "gen_ai.usage.output_tokens": 30 } }),
      span({ span: "k1", parent: "p", a: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "claude-opus-5", ...usage } }),
      span({ span: "mid", parent: "p", name: "agent step", a: { "gen_ai.operation.name": "invoke_agent" } }),
      span({ span: "k2", parent: "mid", a: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "claude-opus-5", ...usage } }),
      span({ span: "k3", parent: "p", a: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "claude-opus-5", ...usage } }),
    ]));
    expect(p.calls.map((c) => c.spanId.slice(0, 2)).sort()).toEqual(["k1", "k2", "k3"]);
    expect(p.skipped).toEqual({ "a span that totals the calls beneath it (counted once, at the leaf)": 1 });
    expect(p.calls.reduce((t, c) => t + c.inputTokens, 0)).toBe(300);
  });

  it("leaves out spans of traces that were not sampled, and counts them", () => {
    const a = { "gen_ai.operation.name": "chat", "gen_ai.request.model": "claude-opus-5", "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 10 };
    const p = parsed(doc([span({ span: "s1", flags: 1, a }), span({ span: "s2", flags: 0, a }), span({ span: "s3", flags: 256, a }), span({ span: "s4", a })]));
    expect(p.unsampled).toBe(2); // flags 0 and 256 have no sampled bit; a span with no flags is taken as sampled
    expect(p.calls.map((c) => c.spanId.slice(0, 2))).toEqual(["s1", "s4"]);
  });

  it("treats a missing attribute as a gap, never a zero", () => {
    const p = parsed(doc([
      span({ span: "g1", a: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "claude-opus-5" } }), // no tokens
      span({ span: "g2", a: { "gen_ai.operation.name": "chat", "gen_ai.usage.input_tokens": 5, "gen_ai.usage.output_tokens": 1 } }), // no model
      span({ span: "g3", a: { "gen_ai.operation.name": "embeddings", "gen_ai.request.model": "e", "gen_ai.usage.input_tokens": 5 } }), // not a chat
      span({ span: "g4", a: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "claude-opus-5", "gen_ai.usage.input_tokens": 5, "gen_ai.usage.output_tokens": 1 }, at: 0 }), // no usable time
      span({ span: "g5", a: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "claude-opus-5", "gen_ai.usage.input_tokens": 5 } }), // input only: output unknown, kept as 0 tokens
    ]));
    expect(p.skipped).toEqual({ "no token counts (a gap, not a zero)": 1, "no model name": 1, "no usable start time": 1 });
    expect(p.calls.map((c) => c.spanId.slice(0, 2))).toEqual(["g5"]);
  });

  it("never reads a prompt or a completion, lists an attribute it does not know, and reads the exporter's cost under any of its spellings", () => {
    const p = parsed(doc([span({ span: "x1", a: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "claude-opus-5", "gen_ai.usage.input_tokens": 5, "gen_ai.usage.output_tokens": 1, "gen_ai.prompt.0.content": "SECRET PROMPT", "gen_ai.completion.0.content": "SECRET REPLY", "gen_ai.input.messages": "SECRET", "gen_ai.future.thing": 1, "llm.usage.cost": 0.0123 } })]));
    expect(JSON.stringify(p)).not.toContain("SECRET");
    expect(p.unknownGenAiAttributes).toEqual(["gen_ai.future.thing"]);
    expect(p.calls[0]!.reportedMicros).toBe(12_300);
  });

  it("reads JSON Lines, one document a line, and refuses what is not a trace export", () => {
    const a = { "gen_ai.operation.name": "chat", "gen_ai.request.model": "claude-opus-5", "gen_ai.usage.input_tokens": 5, "gen_ai.usage.output_tokens": 1 };
    const lines = [doc([span({ span: "l1", a })]), doc([span({ span: "l2", a })])].map((x) => JSON.stringify(x)).join(String.fromCharCode(10));
    const p = parseOtel(lines) as Exclude<ReturnType<typeof parseOtel>, string>;
    expect(p.format).toBe("jsonl");
    expect(p.calls).toHaveLength(2);
    expect(parseOtel("")).toBe("The file is empty.");
    expect(parseOtel("{ not json")).toMatch(/neither one OTLP\/JSON document/);
    expect((parseOtel('{"hello": 1}') as { calls: unknown[] }).calls).toEqual([]);
  });
});

function ledgerOf(): Ledger {
  return openLedger(":memory:");
}

describe("importing spans", () => {
  const D = doc([
    span({ span: "i1", a: { "gen_ai.operation.name": "chat", "gen_ai.provider.name": "anthropic", "gen_ai.request.model": "claude-opus-5", "gen_ai.usage.input_tokens": 3_000, "gen_ai.usage.output_tokens": 500, "gen_ai.usage.cache_read.input_tokens": 8_000, "gen_ai.usage.cache_creation.input_tokens": 1_000, "gen_ai.conversation.id": "conv-1", "llm.usage.cost": 0.05 } }),
    span({ span: "i2", at: T0 + 60_000, a: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "some-local-model", "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 10, "gen_ai.conversation.id": "conv-1" } }),
  ]);

  it("prices the tokens at list price, keeps the exporter's cost beside it, and is idempotent", () => {
    const db = ledgerOf();
    const r = importOtel(db, JSON.stringify(D), "trace.json", snap) as OtelImport;
    expect(r).toMatchObject({ calls: 2, callsNew: 2, callsAlreadyHeld: 0, withReportedCost: 1, unpricedCalls: 1 });
    const a = db.prepare("SELECT c.total_micros est, p.amount_micros rep, m.session_id sid, s.tool tool, s.project_path service FROM model_call m JOIN cost_event c ON c.call_id = m.call_id LEFT JOIN call_reported_cost p ON p.call_id = m.call_id JOIN session s ON s.session_id = m.session_id WHERE m.model = 'claude-opus-5'").get() as Record<string, string | number>;
    // 3,000 input at $5, 500 output at $25, 8,000 cache read at $0.50, 1,000 cache write at $6.25 per million.
    expect(a).toMatchObject({ est: 37_750, rep: 50_000, sid: "otel:conv-1", tool: "otel", service: "shop-agent" });
    expect(importOtel(db, JSON.stringify(D), "again.json", snap)).toMatchObject({ callsNew: 0, callsAlreadyHeld: 2 });
    expect((db.prepare("SELECT COUNT(*) n FROM model_call").get() as { n: number }).n).toBe(2);
    expect((db.prepare("SELECT class FROM cost_event WHERE call_id LIKE '%i2%'").get() as { class: string }).class).toBe("unpriced");
  });

  it("is refused when it is not a trace export, and changes nothing", () => {
    const db = ledgerOf();
    expect(importOtel(db, "{ nope", "x.json", snap)).toMatch(/neither one OTLP\/JSON document/);
    expect((db.prepare("SELECT COUNT(*) n FROM ingest_source").get() as { n: number }).n).toBe(0);
  });
});

describe("writing the Desk's own record as spans", () => {
  function seeded(): Ledger {
    const db = ledgerOf();
    db.prepare("INSERT INTO session (session_id, tool, project_path, git_branch, started_at, ended_at) VALUES ('s1', 'claude_code', 'D:/work/shop', 'fix/cart', '2026-10-20T10:00:00.000Z', '2026-10-20T10:30:00.000Z'), ('s2', 'codex', 'D:/work/api', 'main', '2026-10-21T10:00:00.000Z', '2026-10-21T10:30:00.000Z')").run();
    const add = db.prepare("INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?, ?, 0, 'reported', 0, 0)");
    add.run("c1", "s1", "2026-10-20T10:10:00.000Z", "claude-opus-5", 3_000, 500, 8_000, 1_000);
    add.run("c2", "s1", "2026-10-20T10:20:00.000Z", "claude-sonnet-5-5", 1_000, 100, 0, 0);
    add.run("c3", "s2", "2026-10-21T10:10:00.000Z", "gpt-5", 4_000, 300, 1_000, 0);
    recordSnapshot(db, snap);
    recomputeCosts(db, snap, new Set(["c1", "c2", "c3"]), { unpricedCalls: 0, unpricedModels: {} });
    db.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES ('s1', 'merged', 'high', 1, 't')").run();
    db.prepare("INSERT INTO task (task_id, method, label, project_path, first_ts, last_ts) VALUES ('task-1', 'branch', 'fix/cart', NULL, NULL, NULL)").run();
    db.prepare("INSERT INTO task_session (session_id, task_id) VALUES ('s1', 'task-1')").run();
    db.prepare("INSERT INTO call_reported_cost (call_id, source, currency, amount_micros, observed_at) VALUES ('c2', 'opencode', 'USD', 4000, 't')").run();
    return db;
  }

  it("emits a span per session and per call, with the cost on the calls only and the desk.* attributes where the ledger has them", () => {
    const out = exportOtel(seeded(), "0000", "9999");
    expect(out).toMatchObject({ sessions: 2, calls: 3 });
    const all = JSON.stringify(out.doc);
    const spans = (out.doc.resourceSpans[0] as { scopeSpans: { spans: { name: string; parentSpanId: string; attributes: { key: string; value: Record<string, unknown> }[] }[] }[] }).scopeSpans[0]!.spans;
    expect(spans).toHaveLength(5);
    const roots = spans.filter((s) => s.parentSpanId === "");
    expect(roots).toHaveLength(2);
    for (const r of roots) expect(r.attributes.some((a) => a.key.startsWith("desk.cost") || a.key.startsWith("gen_ai.usage"))).toBe(false); // a parent carries no cost: it would be counted twice
    const c1 = spans.find((s) => s.name === "chat claude-opus-5")!;
    const get = (s: typeof c1, k: string) => s.attributes.find((a) => a.key === k)?.value;
    expect(get(c1, "desk.cost.estimated_usd")).toEqual({ doubleValue: 0.03775 });
    expect(get(c1, "desk.cost.class")).toEqual({ stringValue: "estimated" });
    expect(get(c1, "desk.task.id")).toEqual({ stringValue: "task-1" });
    expect(get(c1, "desk.outcome.state")).toEqual({ stringValue: "merged" });
    expect(get(c1, "gen_ai.usage.input_tokens")).toEqual({ intValue: "3000" }); // Anthropic's count leaves the cache out
    expect(get(spans.find((s) => s.name === "chat gpt-5")!, "gen_ai.usage.input_tokens")).toEqual({ intValue: "5000" }); // OpenAI's includes it
    expect(get(spans.find((s) => s.name === "chat claude-sonnet-5-5")!, "desk.cost.reported_usd")).toEqual({ doubleValue: 0.004 });
    expect(all).not.toContain("desk.budget.reservation_id");
    expect(all).not.toContain("desk.retry_of");
    expect(all).not.toContain("D:/work"); // no folder, no branch
    expect(all).not.toContain("fix/cart");
  });

  it("reads back as the same calls, the same tokens and the same estimated dollars", () => {
    const source = seeded();
    const back = ledgerOf();
    const r = importOtel(back, JSON.stringify(exportOtel(source, "0000", "9999").doc), "desk.json", snap) as OtelImport;
    expect(r).toMatchObject({ calls: 3, callsNew: 3, unpricedCalls: 1 }); // gpt-5 has no price in the test snapshot, here as in the source
    const sum = (db: Ledger): { i: number; o: number; cr: number; cw: number; micros: number } =>
      db.prepare("SELECT SUM(m.input_tokens) i, SUM(m.output_tokens) o, SUM(m.cache_read_tokens) cr, SUM(m.cache_write_5m_tokens + m.cache_write_1h_tokens) cw, SUM(c.total_micros) micros FROM model_call m JOIN cost_event c ON c.call_id = m.call_id").get() as { i: number; o: number; cr: number; cw: number; micros: number };
    expect(sum(back)).toEqual(sum(source));
    expect((back.prepare("SELECT COUNT(*) n FROM session").get() as { n: number }).n).toBe(2);
    expect((back.prepare("SELECT amount_micros a FROM call_reported_cost").get() as { a: number }).a).toBe(4_000);
  });

  it("exports a period, refuses a bad date, and says when there is nothing", () => {
    const db = seeded();
    const first = otelCommand(db, "export", undefined, snap, { until: "2026-10-20" });
    expect(first.ok).toBe(true);
    expect(JSON.parse(first.text).resourceSpans[0].scopeSpans[0].spans).toHaveLength(3); // one session and two calls
    expect(otelCommand(db, "export", undefined, snap, { since: "yesterday" })).toEqual({ ok: false, text: '--since must be a date such as 2026-09-01, got "yesterday".' });
    expect(otelCommand(db, "export", undefined, snap, { since: "2030-01-01" }).text).toMatch(/no call in that period/);
    const file = join(tmp, "out.json");
    expect(otelCommand(db, "export", undefined, snap, { output: file }).text).toMatch(/^Wrote 3 calls in 2 sessions as OTLP\/JSON GenAI spans to .*desk\.budget\.reservation_id and desk\.retry_of are not emitted/);
    expect(JSON.parse(readFileSync(file, "utf8")).resourceSpans).toHaveLength(1);
    expect(otelCommand(db, undefined, undefined, snap).text).toMatch(/name a subcommand/);
    expect(otelCommand(db, "frob", undefined, snap).text).toMatch(/unknown subcommand "frob"/);
    expect(otelCommand(db, "import", undefined, snap).text).toMatch(/Name the export/);
    expect(otelCommand(db, "import", join(tmp, "missing.json"), snap).ok).toBe(false);
  });
});
