import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifyChain } from "../../src/desk/ledger/chain.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { importEventsFile } from "../../src/desk/ledger/ingest-events.ts";
import { eventsCommand } from "../../src/desk/open/command.ts";
import { checkRecord, EVENTS_SCHEMA, eventLine, formatEvents, jsonSchema, KEY_ORDER, LIMITS, NATIVE_TOOLS, parseEvents, type CallRecord } from "../../src/desk/open/events.ts";
import { exportEvents } from "../../src/desk/open/export.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { assistantLine, humanPromptLine } from "./helpers.ts";

/** The open ledger format (DF-063): what a valid file is, what is refused and why, what reaches the ledger, and what the Desk writes for another tool. */
const snapshot = loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json");
const HEADER = JSON.stringify({ schema: EVENTS_SCHEMA, type: "header", tool: "aider-ish", tool_version: "1.2" });
const call = (o: Partial<CallRecord> & { call_id: string }): string =>
  JSON.stringify({ type: "call", session_id: "s1", ts: "2026-10-20T10:00:00.000Z", model: "claude-opus-5", input_tokens: 100, output_tokens: 50, ...o });
const file = (...lines: string[]): string => `${lines.join("\n")}\n`;

let work: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "desk-events-"));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));
const write = (name: string, text: string): string => {
  const p = join(work, name);
  writeFileSync(p, text);
  return p;
};

describe("reading a file", () => {
  it("accepts a header, sessions and calls, and keeps what they say", () => {
    const p = parseEvents(file(HEADER, JSON.stringify({ type: "session", session_id: "s1", project_path: "/work/shop" }), call({ call_id: "c1", cache_read_tokens: 5, tool_names: ["Bash"] }), call({ call_id: "c2", reported_cost_micros: 1200, reported_currency: "USD" })));
    expect(p.problems).toEqual([]);
    expect(p.header).toMatchObject({ tool: "aider-ish", tool_version: "1.2" });
    expect(p.sessions).toHaveLength(1);
    expect(p.calls.map((c) => c.call_id)).toEqual(["c1", "c2"]);
  });

  it("names the line and the field of each problem, and refuses the whole file", () => {
    const cases: [string, string, RegExp][] = [
      ["not json", "{nope", /not valid JSON/],
      ["an array", "[1]", /not a JSON object/],
      ["an unknown type", JSON.stringify({ type: "bill" }), /type must be "header", "session" or "call"/],
      ["an unknown field", call({ call_id: "c1", colour: "red" } as never), /colour is not a field of a call record/],
      ["a missing required field", JSON.stringify({ type: "call", call_id: "c1", session_id: "s1", ts: "2026-10-20T10:00:00Z", model: "m", input_tokens: 1 }), /output_tokens is required/],
      ["a negative count", call({ call_id: "c1", input_tokens: -1 }), /input_tokens must be a whole number/],
      ["a fractional count", call({ call_id: "c1", output_tokens: 1.5 }), /output_tokens must be a whole number/],
      ["a count that is text", call({ call_id: "c1", input_tokens: "12" as never }), /input_tokens must be a whole number/],
      ["a count beyond what a call holds", call({ call_id: "c1", input_tokens: 1e12 }), /input_tokens must be a whole number from 0 to 10,000,000,000/],
      ["a time without Z", call({ call_id: "c1", ts: "2026-10-20T10:00:00+02:00" }), /ts must be an ISO 8601 UTC time/],
      ["a time that is not a date", call({ call_id: "c1", ts: "2026-13-45T10:00:00Z" }), /ts must be an ISO 8601 UTC time/],
      ["a time no real call has", call({ call_id: "c1", ts: "1999-01-01T00:00:00Z" }), /ts 1999-01-01T00:00:00Z is outside 2015 to 2100/],
      ["both kinds of cache write", call({ call_id: "c1", cache_write_tokens: 1, cache_write_5m_tokens: 1 }), /cache_write_tokens and the 5m\/1h split are both given/],
      ["more reasoning than output", call({ call_id: "c1", reasoning_tokens: 51 }), /reasoning_tokens is more than output_tokens/],
      ["a cost with no currency", call({ call_id: "c1", reported_cost_micros: 5 }), /reported_cost_micros needs reported_currency/],
      ["a currency that is not a code", call({ call_id: "c1", reported_cost_micros: 5, reported_currency: "dollars" }), /reported_currency must be a three-letter code/],
      ["a control character in an id", call({ call_id: "a\u0007b" }), /control character/],
      ["an empty model", call({ call_id: "c1", model: "" }), /model must not be empty/],
      ["a flag that is not a flag", call({ call_id: "c1", is_api_error: "yes" as never }), /is_api_error must be true, false or null/],
      ["tool names that are not names", call({ call_id: "c1", tool_names: [""] }), /tool_names\[0\] must not be empty/],
    ];
    for (const [label, line, why] of cases) {
      const p = parseEvents(file(HEADER, line));
      expect(p.problems.length, label).toBeGreaterThan(0);
      expect(p.problems[0]!.line, label).toBe(2);
      expect(p.problems[0]!.message, label).toMatch(why);
    }
  });

  it("wants the header first, one header, a known schema, and says when the schema is newer", () => {
    expect(parseEvents(file(call({ call_id: "c1" }))).problems[0]).toMatchObject({ line: 1, field: "type" });
    expect(parseEvents(file(call({ call_id: "c1" }))).problems[0]!.message).toMatch(/the first record must be the header/);
    expect(parseEvents(file(HEADER, HEADER)).problems[0]!.message).toMatch(/a second header/);
    expect(parseEvents(file(JSON.stringify({ schema: "desk.events/2", type: "header", tool: "x1" }))).problems[0]!.message).toMatch(/newer than this reader understands/);
    expect(parseEvents(file(JSON.stringify({ schema: "other/1", type: "header", tool: "x1" }))).problems[0]!.message).toMatch(/schema must be "desk.events\/1"/);
    expect(parseEvents(file(JSON.stringify({ schema: EVENTS_SCHEMA, type: "header", tool: "Bad Tool" }))).problems[0]!.message).toMatch(/tool must be an id/);
    expect(parseEvents("").problems[0]!.message).toMatch(/file is empty/);
  });

  it("refuses a call or a session named twice, and a line longer than the limit", () => {
    expect(parseEvents(file(HEADER, call({ call_id: "c1" }), call({ call_id: "c1" }))).problems[0]).toMatchObject({ line: 3, message: "call c1 appears twice" });
    const s = JSON.stringify({ type: "session", session_id: "s1" });
    expect(parseEvents(file(HEADER, s, s)).problems[0]!.message).toBe("session s1 is described twice");
    expect(parseEvents(file(HEADER, call({ call_id: "c1", model: "m".repeat(LIMITS.lineBytes) }))).problems[0]!.message).toMatch(/longer than 65,536 bytes/);
  });

  it("lists the first 50 problems and counts the rest", () => {
    const bad = Array.from({ length: 80 }, (_, i) => call({ call_id: `c${i}`, input_tokens: -1 }));
    const p = parseEvents(file(HEADER, ...bad));
    expect(p.problems).toHaveLength(LIMITS.problemsListed);
    expect(p.moreProblems).toBe(30);
  });

  it("is lenient about blank lines and Windows line endings, and about nothing else", () => {
    const p = parseEvents(`${HEADER}\r\n\r\n${call({ call_id: "c1" })}\r\n`);
    expect(p.problems).toEqual([]);
    expect(p.calls).toHaveLength(1);
  });

  it("accepts nulls as unknown, and never reads an unknown field as zero", () => {
    const p = parseEvents(file(HEADER, call({ call_id: "c1", cache_read_tokens: null, reasoning_tokens: null, request_id: null, tool_names: null, is_sidechain: null })));
    expect(p.problems).toEqual([]);
    expect(p.calls[0]!.cache_read_tokens).toBeNull();
  });
});

describe("writing a file", () => {
  it("writes the keys of each record in a fixed order and nothing that is undefined, so the same record is the same bytes", () => {
    const a = eventLine({ type: "call", output_tokens: 2, input_tokens: 1, model: "m", ts: "2026-10-20T10:00:00Z", session_id: "s", call_id: "c", cache_read_tokens: undefined } as never);
    expect(a).toBe('{"type":"call","call_id":"c","session_id":"s","ts":"2026-10-20T10:00:00Z","model":"m","input_tokens":1,"output_tokens":2}');
    const text = formatEvents(
      { schema: EVENTS_SCHEMA, type: "header", tool: "t1" },
      [{ type: "session", session_id: "b" }, { type: "session", session_id: "a" }],
      [
        { type: "call", call_id: "c2", session_id: "a", ts: "2026-10-20T10:00:01Z", model: "m", input_tokens: 1, output_tokens: 1 },
        { type: "call", call_id: "c1", session_id: "a", ts: "2026-10-20T10:00:01Z", model: "m", input_tokens: 1, output_tokens: 1 },
      ],
    );
    expect(text.split("\n").map((l) => (l ? (JSON.parse(l) as { call_id?: string; session_id?: string }).call_id ?? (JSON.parse(l) as { session_id?: string }).session_id ?? "header" : ""))).toEqual(["header", "a", "b", "c1", "c2", ""]);
    expect(parseEvents(text).problems).toEqual([]);
  });

  it("publishes a JSON Schema that names exactly the fields the reader accepts, with the same requirements", () => {
    const schema = jsonSchema() as { oneOf: { title: string; required: string[]; properties: Record<string, unknown>; additionalProperties: boolean }[] };
    for (const kind of ["header", "session", "call"] as const) {
      const s = schema.oneOf.find((x) => x.title === kind)!;
      expect(Object.keys(s.properties).sort(), kind).toEqual([...KEY_ORDER[kind]].sort());
      expect(s.additionalProperties).toBe(false);
      // The reader and the schema agree on what is required: leaving each required field out is a problem, and leaving the optional ones out is not.
      for (const req of s.required) expect(checkRecord(kind, Object.fromEntries(Object.entries(FULL[kind]).filter(([k]) => k !== req))).some((p) => p.message === `${req} is required`), `${kind}.${req}`).toBe(true);
      // A reported cost and its currency go together, so they are left out together.
      for (const opt of KEY_ORDER[kind].filter((k) => !s.required.includes(k))) expect(checkRecord(kind, Object.fromEntries(Object.entries(FULL[kind]).filter(([k]) => k !== opt && !(opt === "reported_currency" && k === "reported_cost_micros")))), `${kind}.${opt}`).toEqual([]);
    }
    expect(readFileSync("docs/schema/desk-events-1.schema.json", "utf8")).toBe(`${JSON.stringify(schema, null, 2)}\n`);
  });
});

const FULL: Record<"header" | "session" | "call", Record<string, unknown>> = {
  header: { schema: EVENTS_SCHEMA, type: "header", tool: "x1", tool_version: "1", produced_at: "2026-10-20T10:00:00Z" },
  session: { type: "session", session_id: "s", tool: "x1", project_path: "/work/a", git_branch: "main", tool_version: "1" },
  call: {
    type: "call", call_id: "c", session_id: "s", ts: "2026-10-20T10:00:00Z", model: "m", input_tokens: 1, output_tokens: 2, request_id: "r", reasoning_tokens: 1, cache_read_tokens: 1, cache_write_5m_tokens: 1, cache_write_1h_tokens: 1,
    service_tier: "standard", speed: "standard", stop_reason: "end_turn", is_sidechain: false, is_api_error: false, tool_names: ["a"], reported_cost_micros: 1, reported_currency: "USD",
  },
};

describe("into the ledger", () => {
  let db: Ledger;
  beforeAll(() => {
    db = openLedger(":memory:");
  });
  afterAll(() => db.close());

  it("stores a valid file with ids prefixed by the tool, priced at list price from the tokens, and keeps a reported cost beside the estimate", async () => {
    const p = write("good.jsonl", file(
      HEADER,
      JSON.stringify({ type: "session", session_id: "s1", project_path: "/work/shop", git_branch: "main" }),
      call({ call_id: "c1", input_tokens: 1000, output_tokens: 500, cache_read_tokens: 200, cache_write_5m_tokens: 300, cache_write_1h_tokens: 100, speed: "standard", tool_names: ["Bash"], stop_reason: "end_turn" }),
      call({ call_id: "c2", model: "no-such-model-9", reported_cost_micros: 7000, reported_currency: "USD", cache_write_tokens: 40 }),
    ));
    const r = await importEventsFile(db, p, snapshot, () => new Date("2026-10-25T00:00:00Z"));
    expect(r).toMatchObject({ tool: "aider-ish", sessions: 1, calls: 2, callsNew: 2, callsAlreadyHeld: 0, withReportedCost: 1, cacheWriteUnsplit: 1, unpricedCalls: 1 });
    const c1 = db.prepare("SELECT * FROM model_call WHERE call_id = 'ev:aider-ish:c1'").get() as Record<string, unknown>;
    expect(c1).toMatchObject({ session_id: "ev:aider-ish:s1", input_tokens: 1000, output_tokens: 500, cache_read_tokens: 200, cache_write_5m_tokens: 300, cache_write_1h_tokens: 100, cache_ttl_basis: "reported", speed: "standard", tool_names: '["Bash"]' });
    expect(db.prepare("SELECT cache_write_5m_tokens AS w, cache_ttl_basis AS b FROM model_call WHERE call_id = 'ev:aider-ish:c2'").get()).toEqual({ w: 40, b: "assumed-5m" });
    expect(db.prepare("SELECT tool, project_path, git_branch, tool_version FROM session WHERE session_id = 'ev:aider-ish:s1'").get()).toEqual({ tool: "aider-ish", project_path: "/work/shop", git_branch: "main", tool_version: "1.2" });
    expect((db.prepare("SELECT total_micros AS m FROM cost_event WHERE call_id = 'ev:aider-ish:c1' AND class = 'estimated'").get() as { m: number }).m).toBeGreaterThan(0);
    expect(db.prepare("SELECT class FROM cost_event WHERE call_id = 'ev:aider-ish:c2'").get()).toEqual({ class: "unpriced" });
    expect(db.prepare("SELECT source, currency, amount_micros FROM call_reported_cost WHERE call_id = 'ev:aider-ish:c2'").get()).toEqual({ source: "ev:aider-ish", currency: "USD", amount_micros: 7000 });
    expect(db.prepare("SELECT kind FROM ingest_source WHERE path LIKE 'events:aider-ish:%'").all()).toEqual([{ kind: "events" }]);
    expect(verifyChain(db).ok).toBe(true);
  });

  it("stores nothing twice when the same file is read again, or a file that repeats some of its calls", async () => {
    const again = await importEventsFile(db, join(work, "good.jsonl"), snapshot);
    expect(again).toMatchObject({ callsNew: 0, callsAlreadyHeld: 2 });
    const more = write("more.jsonl", file(HEADER, call({ call_id: "c1" }), call({ call_id: "c3", ts: "2026-10-20T10:05:00Z" })));
    expect(await importEventsFile(db, more, snapshot)).toMatchObject({ callsNew: 1, callsAlreadyHeld: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM model_call WHERE call_id LIKE 'ev:aider-ish:%'").get()).toEqual({ n: 3 });
  });

  it("keeps two tools that number their calls the same apart", async () => {
    const a = write("other.jsonl", file(JSON.stringify({ schema: EVENTS_SCHEMA, type: "header", tool: "other-tool" }), call({ call_id: "c1" })));
    expect(await importEventsFile(db, a, snapshot)).toMatchObject({ callsNew: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM model_call WHERE call_id IN ('ev:aider-ish:c1', 'ev:other-tool:c1')").get()).toEqual({ n: 2 });
  });

  it("refuses a file with an invalid line and writes nothing, not even the valid lines", async () => {
    const before = db.prepare("SELECT (SELECT COUNT(*) FROM model_call) AS calls, (SELECT COUNT(*) FROM ingest_source) AS sources, (SELECT COUNT(*) FROM session) AS sessions").get();
    const p = write("bad.jsonl", file(JSON.stringify({ schema: EVENTS_SCHEMA, type: "header", tool: "third-tool" }), call({ call_id: "ok" }), call({ call_id: "bad", input_tokens: -4 })));
    const r = await importEventsFile(db, p, snapshot);
    expect(r).toMatchObject({ kind: "refused" });
    expect("problems" in r && r.problems[0]).toMatchObject({ line: 3, field: "input_tokens" });
    expect(db.prepare("SELECT (SELECT COUNT(*) FROM model_call) AS calls, (SELECT COUNT(*) FROM ingest_source) AS sources, (SELECT COUNT(*) FROM session) AS sessions").get()).toEqual(before);
  });

  it("refuses a file that says it is from a source the Desk reads itself, so no call is counted twice", async () => {
    for (const tool of ["claude_code", "codex", "desk", "litellm"]) {
      const p = write(`native-${tool}.jsonl`, file(JSON.stringify({ schema: EVENTS_SCHEMA, type: "header", tool }), call({ call_id: "c1" })));
      const r = await importEventsFile(db, p, snapshot);
      expect(r, tool).toMatchObject({ kind: "refused" });
      expect("reason" in r && r.reason).toMatch(/would count them twice/);
    }
    const viaSession = write("native-session.jsonl", file(HEADER, JSON.stringify({ type: "session", session_id: "s1", tool: "codex" }), call({ call_id: "zz" })));
    expect(await importEventsFile(db, viaSession, snapshot)).toMatchObject({ kind: "refused" });
    expect(NATIVE_TOOLS).toContain("claude_code");
  });

  it("masks a secret that a folder or branch name carries", async () => {
    const secret = ["sk", "ant", "api03", "A".repeat(40)].join("-");
    const p = write("secret.jsonl", file(JSON.stringify({ schema: EVENTS_SCHEMA, type: "header", tool: "leaky" }), JSON.stringify({ type: "session", session_id: "s1", project_path: `/work/${secret}`, git_branch: "main" }), call({ call_id: "c1" })));
    await importEventsFile(db, p, snapshot);
    const stored = (db.prepare("SELECT project_path AS p FROM session WHERE session_id = 'ev:leaky:s1'").get() as { p: string }).p;
    expect(stored).not.toContain(secret);
  });
});

describe("out of the ledger, for another tool", () => {
  it("writes the Desk's own record as desk.events/1 that reads back clean, with no estimate, no prompt and no folder unless asked", async () => {
    const src = openLedger(":memory:");
    const log = join(work, "claude.jsonl");
    writeFileSync(log, `${[
      humanPromptLine({ uuid: "p1", session: "s-claude", ts: "2026-10-20T10:00:00.000Z" }),
      assistantLine({ id: "a1", session: "s-claude", ts: "2026-10-20T10:01:00.000Z", output: 1234, input: 77, read: 500, write5m: 20, write1h: 30, tools: ["Bash"], cwd: "/work/payroll-secret-project" }),
      assistantLine({ id: "a2", session: "s-claude", ts: "2026-10-20T10:02:00.000Z", output: 99, input: 5 }),
    ].join("\n")}\n`);
    await ingestClaudeCode(src, [log], snapshot);
    const out = join(work, "export.jsonl");
    const r = exportEvents(src, out, { now: new Date("2026-10-25T00:00:00Z") });
    expect(r).toMatchObject({ sessions: 1, calls: 2, withPaths: false, skipped: 0 });
    const text = readFileSync(out, "utf8");
    expect(parseEvents(text).problems).toEqual([]);
    expect(text).not.toContain("payroll-secret-project");
    expect(text).not.toContain("please do the thing");
    expect(text).not.toMatch(/estimated|total_micros|cost_micros":\d+,"reported_currency":null/);
    const calls = parseEvents(text).calls;
    expect(calls[0]).toMatchObject({ input_tokens: 77, output_tokens: 1234, cache_read_tokens: 500, cache_write_5m_tokens: 20, cache_write_1h_tokens: 30, tool_names: ["Bash"] });
    // The sums are the ledger's.
    const ledgerOut = (src.prepare("SELECT SUM(output_tokens) AS o FROM model_call").get() as { o: number }).o;
    expect(calls.reduce((n, c) => n + c.output_tokens, 0)).toBe(ledgerOut);
    const withPaths = join(work, "export-paths.jsonl");
    exportEvents(src, withPaths, { withPaths: true });
    expect(readFileSync(withPaths, "utf8")).toContain("payroll-secret-project");
    src.close();
  });

  it("will not overwrite a file, says when there is nothing to write, narrows by tool and date, and does not feed itself back in", async () => {
    const src = openLedger(":memory:");
    const log = join(work, "claude2.jsonl");
    writeFileSync(log, `${[humanPromptLine({ uuid: "p1", session: "s-c2", ts: "2026-10-20T10:00:00.000Z" }), assistantLine({ id: "b1", session: "s-c2", ts: "2026-10-20T10:01:00.000Z", output: 10 })].join("\n")}\n`);
    await ingestClaudeCode(src, [log], snapshot);
    const out = join(work, "export2.jsonl");
    const first = await eventsCommand(["export"], src, { snapshot, out });
    expect(first.ok).toBe(true);
    expect(first.text).toContain("and read it back clean");
    expect(first.text).toContain("Folders and branches are left out");
    expect(await eventsCommand(["export"], src, { snapshot, out })).toMatchObject({ ok: false });
    expect((await eventsCommand(["export"], src, { snapshot, out: join(work, "e3.jsonl"), tool: "codex" })).text).toMatch(/no call in that range/);
    expect((await eventsCommand(["export"], src, { snapshot, out: join(work, "e4.jsonl"), since: "2030-01-01" })).text).toMatch(/no call in that range/);
    // What the Desk wrote is from "desk", a source it reads natively, so reading it back in is refused rather than counted twice.
    const back = await eventsCommand(["import", out], src, { snapshot });
    expect(back.ok).toBe(false);
    expect(back.text).toMatch(/would count them twice/);
    await expect(eventsCommand(["export"], src, { snapshot })).rejects.toThrow(/--output/);
    src.close();
  });

  it("validates files from the command, valid and not, and prints the schema", async () => {
    const good = write("v-good.jsonl", file(HEADER, call({ call_id: "c1" })));
    const bad = write("v-bad.jsonl", file(HEADER, call({ call_id: "c1", ts: "yesterday" })));
    const r = await eventsCommand(["validate", good, bad, join(work, "missing.jsonl")], null, { snapshot });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("valid desk.events/1: header from aider-ish, 0 sessions, 1 call.");
    expect(r.text).toMatch(/v-bad\.jsonl: not a valid desk\.events\/1 file\.\n {2}line 2, ts: ts must be an ISO 8601 UTC time/);
    expect(r.text).toContain("missing.jsonl: no such file.");
    expect(JSON.parse((await eventsCommand(["schema"], null, { snapshot })).text).title).toBe(EVENTS_SCHEMA);
    await expect(eventsCommand(["validate"], null, { snapshot })).rejects.toThrow(/Use: desk events validate/);
    await expect(eventsCommand(["bogus"], null, { snapshot })).rejects.toThrow(/Use: desk events/);
  });
});
