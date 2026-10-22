import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseClaudeCodeLine } from "../../src/desk/ingest/claude-code.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { assistantLine, humanPromptLine, TempDir, testSnapshot, toolResultLine } from "./helpers.ts";

let dir: TempDir;
let db: Ledger;
const snap = testSnapshot();

beforeEach(() => {
  dir = new TempDir();
  db = openLedger(":memory:");
});
afterEach(() => {
  db.close();
  dir.dispose();
});

const one = <T>(sql: string, ...args: (string | number)[]): T => db.prepare(sql).get(...args) as T;

describe("claude code line parser", () => {
  it("reads usage, the cache split and tool names, and keeps no message text", () => {
    const out = parseClaudeCodeLine(assistantLine({ id: "m1", input: 2, output: 507, read: 32_581, write1h: 55_844, thinking: 406, tools: ["Bash", "Read"] }));
    expect(out.kind).toBe("call");
    if (out.kind !== "call") return;
    expect(out.call).toMatchObject({
      callId: "m1", inputTokens: 2, outputTokens: 507, reasoningTokens: 406, cacheReadTokens: 32_581,
      cacheWrite5mTokens: 0, cacheWrite1hTokens: 55_844, cacheTtlBasis: "reported", cacheSplitMismatch: false,
      toolNames: ["Bash", "Read"],
    });
    expect(JSON.stringify(out.call)).not.toContain("content");
  });

  it("assumes the 5-minute rate when only a total is reported, and says so", () => {
    const out = parseClaudeCodeLine(assistantLine({ id: "m2", write5m: 1000, omitCacheSplit: true }));
    expect(out.kind === "call" && out.call).toMatchObject({ cacheWrite5mTokens: 1000, cacheWrite1hTokens: 0, cacheTtlBasis: "assumed-5m" });
  });

  it("flags a cache split that does not add up", () => {
    const obj = JSON.parse(assistantLine({ id: "m3", write5m: 10, write1h: 20 })) as { message: { usage: { cache_creation_input_tokens: number } } };
    obj.message.usage.cache_creation_input_tokens = 99;
    const out = parseClaudeCodeLine(JSON.stringify(obj));
    expect(out.kind === "call" && out.call.cacheSplitMismatch).toBe(true);
  });

  it("ignores other line types and reports junk with a reason", () => {
    expect(parseClaudeCodeLine('{"type":"user","message":{}}')).toEqual({ kind: "ignored" });
    expect(parseClaudeCodeLine("")).toEqual({ kind: "ignored" });
    expect(parseClaudeCodeLine("not json")).toEqual({ kind: "malformed", reason: "invalid-json" });
    expect(parseClaudeCodeLine("[1,2]")).toEqual({ kind: "malformed", reason: "not-an-object" });
    expect(parseClaudeCodeLine('{"type":"assistant","message":{"usage":{}}}')).toEqual({ kind: "malformed", reason: "assistant-without-message-id" });
    expect(parseClaudeCodeLine('{"type":"assistant"}')).toEqual({ kind: "malformed", reason: "assistant-without-message" });
  });

  it("treats negative, fractional and string token counts as zero, not as data", () => {
    const obj = JSON.parse(assistantLine({ id: "m4", input: 5 })) as { message: { usage: Record<string, unknown> } };
    obj.message.usage["input_tokens"] = -5;
    obj.message.usage["output_tokens"] = 1.5;
    obj.message.usage["cache_read_input_tokens"] = "7";
    const out = parseClaudeCodeLine(JSON.stringify(obj));
    expect(out.kind === "call" && out.call).toMatchObject({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
  });
});

describe("ingest into the ledger", () => {
  it("counts one API call once when it is written as several lines", async () => {
    const f = dir.file("a.jsonl", [
      assistantLine({ id: "m1", block: 0, input: 2, output: 507, read: 32_581, write1h: 55_844 }),
      assistantLine({ id: "m1", block: 1, input: 2, output: 507, read: 32_581, write1h: 55_844, tools: ["Bash"] }),
    ]);
    const report = await ingestClaudeCode(db, [f], snap);
    expect(report).toMatchObject({ callsNew: 1, callsMerged: 1, usageConflicts: 0 });
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM model_call").n).toBe(1);
    const call = one<{ block_lines: number; tool_names: string }>("SELECT block_lines, tool_names FROM model_call");
    expect(call.block_lines).toBe(2);
    expect(JSON.parse(call.tool_names)).toEqual(["Bash"]);
    expect(one<{ total_micros: number }>("SELECT total_micros FROM cost_event").total_micros).toBe(587_416);
  });

  it("is idempotent: reading the same bytes again changes nothing", async () => {
    const f = dir.file("a.jsonl", [assistantLine({ id: "m1", output: 100 }), assistantLine({ id: "m2", output: 200 })]);
    await ingestClaudeCode(db, [f], snap);
    const second = await ingestClaudeCode(db, [f], snap);
    expect(second).toMatchObject({ linesRead: 0, callsNew: 0, callsMerged: 0 });
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM model_call").n).toBe(2);
  });

  it("reads only what was appended", async () => {
    const f = dir.file("a.jsonl", [assistantLine({ id: "m1", output: 100 })]);
    await ingestClaudeCode(db, [f], snap);
    dir.append(f, [assistantLine({ id: "m2", output: 200 })]);
    const r = await ingestClaudeCode(db, [f], snap);
    expect(r).toMatchObject({ linesRead: 1, callsNew: 1 });
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM model_call").n).toBe(2);
  });

  it("leaves a half-written last line for the next run and does not count it as bad data", async () => {
    const full = assistantLine({ id: "m2", output: 200 });
    const f = dir.file("a.jsonl", [assistantLine({ id: "m1", output: 100 })]);
    dir.append(f, [full.slice(0, 40)], false);
    const first = await ingestClaudeCode(db, [f], snap);
    expect(first).toMatchObject({ callsNew: 1, truncatedTails: 1, malformedLines: 0 });
    dir.append(f, [full.slice(40)]);
    const second = await ingestClaudeCode(db, [f], snap);
    expect(second.callsNew).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM model_call").n).toBe(2);
  });

  it("does not double count a resumed session that copies earlier messages into a new file", async () => {
    const a = dir.file("a.jsonl", [assistantLine({ id: "m1", output: 100 }), assistantLine({ id: "m2", output: 200 })]);
    const b = dir.file("b.jsonl", [assistantLine({ id: "m1", output: 100 }), assistantLine({ id: "m2", output: 200 }), assistantLine({ id: "m3", output: 300 })]);
    await ingestClaudeCode(db, [a, b], snap);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM model_call").n).toBe(3);
    expect(one<{ s: number }>("SELECT SUM(output_tokens) s FROM model_call").s).toBe(600);
  });

  it("takes the final output count as a streaming call grows, and does not call that a conflict", async () => {
    // Real subagent logs: block 0 reports output 5 and block 1 reports 143 for the same call.
    const f = dir.file("a.jsonl", [assistantLine({ id: "m1", output: 5, read: 28_457, write5m: 56_645 }), assistantLine({ id: "m1", block: 1, output: 143, read: 28_457, write5m: 56_645 })]);
    const r = await ingestClaudeCode(db, [f], snap);
    expect(r.usageConflicts).toBe(0);
    expect(one<{ output_tokens: number; usage_conflicts: number }>("SELECT output_tokens, usage_conflicts FROM model_call")).toEqual({ output_tokens: 143, usage_conflicts: 0 });
  });

  it("is order independent: the larger output wins even if the lines arrive reversed, but that is counted", async () => {
    const f = dir.file("a.jsonl", [assistantLine({ id: "m1", block: 1, output: 143 }), assistantLine({ id: "m1", block: 0, output: 5 })]);
    const r = await ingestClaudeCode(db, [f], snap);
    expect(one<{ output_tokens: number }>("SELECT output_tokens FROM model_call").output_tokens).toBe(143);
    expect(r.outputRegressions).toBe(1);
    expect(r.usageConflicts).toBe(0);
  });

  it("counts a real conflict when input or cache counts change between lines of one call", async () => {
    const f = dir.file("a.jsonl", [assistantLine({ id: "m1", output: 10, read: 100 }), assistantLine({ id: "m1", block: 1, output: 10, read: 999 })]);
    const r = await ingestClaudeCode(db, [f], snap);
    expect(r.usageConflicts).toBe(1);
    expect(one<{ cache_read_tokens: number; usage_conflicts: number }>("SELECT cache_read_tokens, usage_conflicts FROM model_call")).toEqual({ cache_read_tokens: 999, usage_conflicts: 1 });
  });

  it("counts tokens for an unpriced model, labels it, and never prices it at zero", async () => {
    const f = dir.file("a.jsonl", [assistantLine({ id: "m1", model: "sonnet", input: 100, output: 50 }), assistantLine({ id: "m2", model: "gpt-9", output: 5 })]);
    const r = await ingestClaudeCode(db, [f], snap);
    expect(r.unpricedCalls).toBe(2);
    expect(r.unpricedModels).toEqual({ sonnet: "alias-without-version", "gpt-9": "unknown-model" });
    const row = one<{ class: string; total_micros: number | null; unpriced_reason: string }>("SELECT class, total_micros, unpriced_reason FROM cost_event WHERE call_id = 'm1'");
    expect(row).toEqual({ class: "unpriced", total_micros: null, unpriced_reason: "alias-without-version" });
    expect(one<{ t: number }>("SELECT SUM(input_tokens + output_tokens) t FROM model_call").t).toBe(155);
  });

  it("survives junk: empty file, blank lines, binary garbage and a truncated JSON line in the middle", async () => {
    const empty = dir.file("empty.jsonl", []);
    const junk = dir.file("junk.jsonl", ["", "\u0000\u0001garbage", "{", assistantLine({ id: "ok", output: 10 }), "[1]"]);
    const r = await ingestClaudeCode(db, [empty, junk], snap);
    expect(r.callsNew).toBe(1);
    expect(r.malformedLines).toBe(3);
    expect(r.malformedReasons).toMatchObject({ "invalid-json": 2, "not-an-object": 1 });
  });

  it("starts over when a file shrinks, and still counts each call once", async () => {
    const f = dir.file("a.jsonl", [assistantLine({ id: "m1", output: 100 }), assistantLine({ id: "m2", output: 200 })]);
    await ingestClaudeCode(db, [f], snap);
    dir.file("a.jsonl", [assistantLine({ id: "m1", output: 100 })]);
    const r = await ingestClaudeCode(db, [f], snap);
    expect(r.resetFiles).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM model_call").n).toBe(2);
  });

  it("records the session span, the sidechain flag and the price snapshot used", async () => {
    const f = dir.file("a.jsonl", [
      assistantLine({ id: "m1", ts: "2026-10-20T10:00:00.000Z", sidechain: true, output: 1 }),
      assistantLine({ id: "m2", ts: "2026-10-20T11:30:00.000Z", output: 1 }),
    ]);
    await ingestClaudeCode(db, [f], snap);
    expect(one<{ started_at: string; ended_at: string }>("SELECT started_at, ended_at FROM session")).toEqual({ started_at: "2026-10-20T10:00:00.000Z", ended_at: "2026-10-20T11:30:00.000Z" });
    expect(one<{ is_sidechain: number }>("SELECT is_sidechain FROM model_call WHERE call_id = 'm1'").is_sidechain).toBe(1);
    expect(one<{ snapshot_id: string; class: string }>("SELECT snapshot_id, class FROM cost_event WHERE call_id = 'm2'")).toEqual({ snapshot_id: "test-snapshot", class: "estimated" });
  });

  it("enforces cost invariants in the database itself", () => {
    expect(() => db.exec("INSERT INTO cost_event (call_id, class) VALUES ('x', 'estimated')")).toThrow();
    expect(() => db.exec("INSERT INTO cost_event (call_id, class, unpriced_reason) VALUES ('x', 'unpriced', NULL)")).toThrow();
  });

  it("rolls a file back if reading fails part-way, leaving the offset unchanged", async () => {
    const f = dir.file("a.jsonl", [assistantLine({ id: "m1", output: 100 })]);
    await ingestClaudeCode(db, [f], snap);
    await expect(ingestClaudeCode(db, [dir.path + "/does-not-exist.jsonl"], snap)).rejects.toThrow();
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM model_call").n).toBe(1);
  });
});

describe("tool calls, results and human prompts", () => {
  it("records tool uses with a stable input hash and no input text", () => {
    const a = parseClaudeCodeLine(assistantLine({ id: "m1", tools: ["Bash"], toolInputs: [{ command: "npm test", description: "run" }] }));
    const b = parseClaudeCodeLine(assistantLine({ id: "m2", tools: ["Bash"], toolInputs: [{ description: "run", command: "npm test" }] }));
    const c = parseClaudeCodeLine(assistantLine({ id: "m3", tools: ["Bash"], toolInputs: [{ command: "npm run build" }] }));
    if (a.kind !== "call" || b.kind !== "call" || c.kind !== "call") throw new Error("expected calls");
    expect(a.call.toolUses[0]?.inputHash).toBe(b.call.toolUses[0]?.inputHash); // key order does not matter
    expect(a.call.toolUses[0]?.inputHash).not.toBe(c.call.toolUses[0]?.inputHash);
    expect(JSON.stringify(a.call)).not.toContain("npm test");
  });

  it("reads tool results (string and block content) and flags errors", () => {
    const r = parseClaudeCodeLine(toolResultLine({ toolUseId: "tu_a", chars: 120, isError: true }));
    expect(r).toMatchObject({ kind: "tool_results", results: [{ toolUseId: "tu_a", isError: true, resultChars: 120 }] });
    const blocks = parseClaudeCodeLine(toolResultLine({ toolUseId: "tu_b", chars: 33, blocks: true }));
    expect(blocks).toMatchObject({ kind: "tool_results", results: [{ resultChars: 33 }] });
  });

  it("counts a human prompt but not subagent prompts, meta text or blank text", () => {
    expect(parseClaudeCodeLine(humanPromptLine({ uuid: "u1" })).kind).toBe("human_prompt");
    expect(parseClaudeCodeLine(humanPromptLine({ uuid: "u2", blocks: true })).kind).toBe("human_prompt");
    expect(parseClaudeCodeLine(humanPromptLine({ uuid: "u3", sidechain: true })).kind).toBe("ignored");
    expect(parseClaudeCodeLine(humanPromptLine({ uuid: "u4", meta: true })).kind).toBe("ignored");
    expect(parseClaudeCodeLine(humanPromptLine({ uuid: "u5", empty: true })).kind).toBe("ignored");
  });

  it("stores them idempotently and links results to calls even when the result is read first", async () => {
    const f = dir.file("a.jsonl", [
      humanPromptLine({ uuid: "u1" }),
      toolResultLine({ toolUseId: "tu_m1_0", chars: 500 }), // result before its call is known
      assistantLine({ id: "m1", tools: ["Read"], output: 10 }),
    ]);
    await ingestClaudeCode(db, [f], snap);
    await ingestClaudeCode(db, [f], snap);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM human_prompt").n).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM tool_call").n).toBe(1);
    const joined = one<{ name: string; result_chars: number; is_error: number }>(
      "SELECT t.name, r.result_chars, r.is_error FROM tool_call t JOIN tool_result r USING (tool_use_id)",
    );
    expect(joined).toEqual({ name: "Read", result_chars: 500, is_error: 0 });
  });
});
