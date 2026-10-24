import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { gatewayCommand, renderImport } from "../../src/desk/gateway/command.ts";
import { gatewaySummary, importSpendLog, parseSpendLog, type SpendLogImport } from "../../src/desk/gateway/spend-log.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { testSnapshot } from "./helpers.ts";

type Parsed = Exclude<ReturnType<typeof parseSpendLog>, string>;

/**
 * Rows in the shape of LiteLLM's `LiteLLM_SpendLogs` table as its admin pages and database export them. Built from the table's
 * documented columns, not taken from one gateway's real export: a real export is the one thing this adapter has not been run on.
 */
const SENTINEL = "SECRET-CONVERSATION-TEXT-THAT-MUST-NEVER-BE-STORED";
const KEY_HASH = ["88dc28d0f030c55e", "d4ab77ed8faf0981"].join("");
const ROWS = [
  {
    request_id: "chatcmpl-aaa1",
    call_type: "acompletion",
    api_key: KEY_HASH,
    spend: 0.0409,
    total_tokens: 12_500,
    prompt_tokens: 12_000,
    completion_tokens: 500,
    startTime: "2026-10-20T10:00:00.000Z",
    endTime: "2026-10-20T10:00:03.000Z",
    model: "claude-opus-5",
    model_group: "opus",
    custom_llm_provider: "anthropic",
    api_base: "https://api.anthropic.com",
    user: "alice",
    session_id: "sess-1",
    metadata: { usage_object: { prompt_tokens: 12_000, completion_tokens: 500, cache_read_input_tokens: 8_000, cache_creation_input_tokens: 1_000 } },
    cache_hit: "False",
    status: "success",
    messages: [{ role: "user", content: SENTINEL }],
    response: { choices: [{ message: { content: SENTINEL } }] },
    proxy_server_request: { body: SENTINEL },
    requester_ip_address: "10.1.2.3",
    team_id: "team-1",
    request_tags: ["a"],
  },
  { request_id: "chatcmpl-aaa2", call_type: "acompletion", spend: 0.002, total_tokens: 1_100, prompt_tokens: 1_000, completion_tokens: 100, startTime: "2026-10-20T10:05:00.000Z", model: "claude-sonnet-5-5", user: "alice", session_id: "sess-1", metadata: {}, cache_hit: "False", status: "success", flavour: "vanilla" },
  { request_id: "chatcmpl-aaa3", spend: 0, total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, startTime: "2026-10-20T10:06:00.000Z", model: "claude-sonnet-5-5", cache_hit: "True", status: "success" },
  { request_id: "chatcmpl-aaa4", spend: 0.5, prompt_tokens: 100, completion_tokens: 10, startTime: "2026-10-20T10:07:00.000Z", model: "claude-sonnet-5-5", status: "failure" },
  { request_id: "chatcmpl-aaa1", spend: 9, prompt_tokens: 1, completion_tokens: 1, startTime: "2026-10-20T10:08:00.000Z", model: "claude-opus-5" }, // the same request again
  { request_id: "chatcmpl-aaa5", spend: 0.01, prompt_tokens: 800, completion_tokens: 50, startTime: "2026-10-21T08:00:00.000Z", model: "some-local-model", user: "bob" },
  { request_id: "chatcmpl-aaa6", spend: null, prompt_tokens: 2_000, completion_tokens: 200, startTime: "2026-10-21T08:30:00.000Z", model: "claude-sonnet-5-5", metadata: { usage_object: { prompt_tokens: 2_000, cache_read_input_tokens: 3_000 } } },
  { request_id: "chatcmpl-aaa7", spend: -3, prompt_tokens: 10, completion_tokens: 1, startTime: "2026-10-21T09:00:00.000Z", model: "claude-sonnet-5-5" },
  { spend: 0.1, prompt_tokens: 10, completion_tokens: 1, startTime: "2026-10-21T09:00:00.000Z", model: "claude-sonnet-5-5" },
  { request_id: "chatcmpl-aaa8", spend: 0.1, prompt_tokens: 10, completion_tokens: 1, startTime: "not a time", model: "claude-sonnet-5-5" },
  { request_id: "chatcmpl-aaa9", spend: 0.1, prompt_tokens: "many", completion_tokens: 1, startTime: "2026-10-21T09:00:00.000Z", model: "claude-sonnet-5-5" },
];

const snap = testSnapshot();
const asJson = (rows: unknown[]): string => JSON.stringify(rows);
const asJsonl = (rows: unknown[]): string => rows.map((r) => JSON.stringify(r)).join(String.fromCharCode(10));
const CRLF = String.fromCharCode(13, 10);
const pseudonym = (name: string): string => `user-${createHash("sha256").update(name).digest("hex").slice(0, 8)}`;

describe("reading a spend log", () => {
  it("takes the tokens, the model, the time and the gateway's own cost, and splits the cache out of the prompt", () => {
    const p = parseSpendLog(asJson(ROWS)) as Parsed;
    expect(p.format).toBe("json");
    const a = p.rows.find((r) => r.requestId === "chatcmpl-aaa1")!;
    expect(a).toMatchObject({ model: "claude-opus-5", startedAt: "2026-10-20T10:00:00.000Z", inputTokens: 3_000, outputTokens: 500, cacheReadTokens: 8_000, cacheWriteTokens: 1_000, spendMicros: 40_900, session: "sess-1", cacheUnsplit: false, inconsistent: false });
    const noSplit = p.rows.find((r) => r.requestId === "chatcmpl-aaa2")!;
    expect(noSplit).toMatchObject({ inputTokens: 1_000, cacheReadTokens: 0, cacheUnsplit: true });
  });

  it("leaves out what it should not take, and says what each omission was", () => {
    const p = parseSpendLog(asJson(ROWS)) as Parsed;
    expect(p.skipped).toEqual({
      "served from the gateway's own cache (no model call)": 1,
      "a failed request": 1,
      "no request id": 1,
      "no usable start time": 1,
      "no usable token counts": 1,
    });
    expect(p.duplicates).toBe(1);
    expect(p.rows.map((r) => r.requestId)).toEqual(["chatcmpl-aaa1", "chatcmpl-aaa2", "chatcmpl-aaa5", "chatcmpl-aaa6", "chatcmpl-aaa7"]);
    expect(p.unknownColumns).toEqual(["flavour"]);
    expect(p.contentColumnsNotRead).toEqual(["api_key", "messages", "proxy_server_request", "requester_ip_address", "response"]);
    expect(p.rows.find((r) => r.requestId === "chatcmpl-aaa7")!.spendMicros).toBeNull(); // a negative cost is not a cost
    expect(p.rows.find((r) => r.requestId === "chatcmpl-aaa6")!.spendMicros).toBeNull(); // a null cost is none
  });

  it("clamps a cache count larger than the prompt and says the row did not add up", () => {
    const p = parseSpendLog(asJson(ROWS)) as Parsed;
    expect(p.rows.find((x) => x.requestId === "chatcmpl-aaa6")!).toMatchObject({ inconsistent: true, inputTokens: 0, cacheReadTokens: 2_000 });
  });

  it("never keeps a person's name: a user becomes a pseudonym, a gateway session id stays", () => {
    const p = parseSpendLog(asJson(ROWS)) as Parsed;
    expect(p.rows.find((x) => x.requestId === "chatcmpl-aaa1")!.session).toBe("sess-1");
    expect(p.rows.find((x) => x.requestId === "chatcmpl-aaa5")!.session).toBe(pseudonym("bob"));
    expect(p.rows.find((x) => x.requestId === "chatcmpl-aaa6")!.session).toBeNull();
  });

  it("reads JSON Lines, a JSON object with a data list, and CSV, to the same rows", () => {
    const plain = parseSpendLog(asJson(ROWS.slice(0, 2))) as Parsed;
    const jsonl = parseSpendLog(asJsonl(ROWS.slice(0, 2))) as Parsed;
    const wrapped = parseSpendLog(JSON.stringify({ data: ROWS.slice(0, 2) })) as Parsed;
    expect(jsonl.format).toBe("jsonl");
    expect(jsonl.rows).toEqual(plain.rows);
    expect(wrapped.rows).toEqual(plain.rows);
    const head = "request_id,spend,prompt_tokens,completion_tokens,startTime,model,session_id,metadata";
    const bad = parseSpendLog([head, `r1,0.01,"1,000",200,2026-10-20T10:00:00Z,claude-sonnet-5-5,s1,`].join(CRLF)) as Parsed;
    expect(bad.skipped).toEqual({ "no usable token counts": 1 }); // "1,000" is not a whole number: not guessed at
    const csv = parseSpendLog([head, `r1,0.01,1000,200,2026-10-20T10:00:00Z,claude-sonnet-5-5,s1,"{""usage_object"":{""cache_read_input_tokens"":400}}"`].join(CRLF)) as Parsed;
    expect(csv.format).toBe("csv");
    expect(csv.rows[0]).toMatchObject({ requestId: "r1", inputTokens: 600, cacheReadTokens: 400, spendMicros: 10_000, session: "s1" });
  });

  it("refuses what is not a spend log, saying why", () => {
    expect(parseSpendLog("[{ not json")).toMatch(/neither one JSON document nor one object per line/);
    expect(parseSpendLog("request_id")).toBe("The file has no data row.");
    expect(parseSpendLog("")).toBe("The file has no data row.");
    expect((parseSpendLog("[]") as Parsed).rows).toEqual([]);
    expect((parseSpendLog('{"data": "nothing"}') as Parsed).rows).toEqual([]);
  });
});

describe("importing a spend log", () => {
  const run = () => {
    const db = openLedger(":memory:");
    const r = importSpendLog(db, asJson(ROWS), "spend.json", snap, () => new Date("2026-10-25T00:00:00Z"));
    if (typeof r === "string") throw new Error(r);
    return { db, r };
  };

  it("prices the tokens at list price and keeps the gateway's cost beside it", () => {
    const { db, r } = run();
    expect(r).toMatchObject({ rows: 5, callsNew: 5, callsAlreadyHeld: 0, withReportedCost: 3, withoutReportedCost: 2, cacheUnsplit: 3, inconsistent: 1 });
    const call = db
      .prepare("SELECT m.input_tokens i, m.output_tokens o, m.cache_read_tokens cr, m.cache_write_5m_tokens cw, c.total_micros est, p.amount_micros rep, s.tool tool FROM model_call m JOIN session s ON s.session_id = m.session_id JOIN cost_event c ON c.call_id = m.call_id LEFT JOIN call_reported_cost p ON p.call_id = m.call_id WHERE m.call_id = 'litellm:chatcmpl-aaa1'")
      .get() as Record<string, number | string>;
    // 3,000 input at $5, 500 output at $25, 8,000 cache read at $0.50, 1,000 cache write at $6.25 per million.
    expect(call).toMatchObject({ i: 3_000, o: 500, cr: 8_000, cw: 1_000, est: 37_750, rep: 40_900, tool: "litellm" });
  });

  it("never stores a conversation, a key, an address or a name", () => {
    const { db } = run();
    const dump = JSON.stringify([db.prepare("SELECT * FROM model_call").all(), db.prepare("SELECT * FROM session").all(), db.prepare("SELECT * FROM ingest_source").all(), db.prepare("SELECT * FROM call_reported_cost").all()]);
    for (const secret of [SENTINEL, KEY_HASH.slice(0, 12), "10.1.2.3", "team-1", "alice", "bob"]) expect(dump).not.toContain(secret);
    expect(dump).toContain(pseudonym("bob"));
  });

  it("reads the same file twice as once, a renamed copy as the same file, and a changed export as new", () => {
    const { db } = run();
    expect(importSpendLog(db, asJson(ROWS), "renamed.json", snap)).toMatchObject({ callsNew: 0, callsAlreadyHeld: 5 });
    expect((db.prepare("SELECT COUNT(*) n FROM ingest_source WHERE kind = 'gateway'").get() as { n: number }).n).toBe(1);
    const more = importSpendLog(db, asJson([...ROWS, { request_id: "chatcmpl-new", spend: 0.5, prompt_tokens: 100, completion_tokens: 10, startTime: "2026-10-22T08:00:00.000Z", model: "claude-opus-5" }]), "later.json", snap);
    expect(more).toMatchObject({ callsNew: 1, callsAlreadyHeld: 5 });
    expect((db.prepare("SELECT COUNT(*) n FROM ingest_source WHERE kind = 'gateway'").get() as { n: number }).n).toBe(2);
    expect((db.prepare("SELECT COUNT(*) n FROM call_reported_cost").get() as { n: number }).n).toBe(4);
  });

  it("counts a model with no price and invents no dollars for it", () => {
    const { db, r } = run();
    expect(r.unpricedCalls).toBe(1);
    expect(Object.keys(r.unpricedModels)).toEqual(["some-local-model"]);
    expect((db.prepare("SELECT class FROM cost_event WHERE call_id = 'litellm:chatcmpl-aaa5'").get() as { class: string }).class).toBe("unpriced");
  });

  it("puts the calls in sessions of their own and gives each a span", () => {
    const { db } = run();
    const s = db.prepare("SELECT session_id, started_at, ended_at FROM session ORDER BY session_id").all() as { session_id: string; started_at: string; ended_at: string }[];
    expect(s.map((x) => x.session_id)).toEqual([`litellm:${pseudonym("bob")}`, "litellm:gateway", "litellm:sess-1"].sort());
    expect(s.every((x) => x.started_at !== null && x.ended_at !== null)).toBe(true);
    expect(s.find((x) => x.session_id === "litellm:sess-1")).toMatchObject({ started_at: "2026-10-20T10:00:00.000Z", ended_at: "2026-10-20T10:05:00.000Z" });
  });

  it("is refused when the file is not a spend log, and changes nothing", () => {
    const db = openLedger(":memory:");
    expect(importSpendLog(db, "[{ nope", "x.json", snap)).toMatch(/neither one JSON document/);
    expect((db.prepare("SELECT COUNT(*) n FROM model_call").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) n FROM ingest_source").get() as { n: number }).n).toBe(0);
  });
});

describe("the gateway's cost against list price", () => {
  it("summarises per model over the calls that carry both, and says nothing about a call that does not", () => {
    const db = openLedger(":memory:");
    importSpendLog(db, asJson(ROWS), "spend.json", snap);
    const rows = gatewaySummary(db);
    const opus = rows.find((r) => r.model === "claude-opus-5")!;
    expect(opus).toMatchObject({ calls: 1, withReported: 1, estimatedMicros: 37_750, reportedMicros: 40_900 });
    expect(opus.gap).toBeCloseTo(40_900 / 37_750 - 1, 6);
    const sonnet = rows.find((r) => r.model === "claude-sonnet-5-5")!;
    expect(sonnet.calls).toBe(3);
    expect(sonnet.withReported).toBe(1);
    expect(rows.find((r) => r.model === "some-local-model")!.gap).toBeNull(); // unpriced: nothing to compare
  });

  it("is said in words and by the command, with every refusal naming the fix", () => {
    const db = openLedger(":memory:");
    expect(gatewayCommand(db, "summary", undefined, snap).text).toBe("No gateway call is held. Import a spend log with: desk gateway import <file>.");
    expect(gatewayCommand(db, "import", undefined, snap)).toEqual({ ok: false, text: "Name the spend log: desk gateway import <file.json|file.jsonl|file.csv>." });
    expect(gatewayCommand(db, "import", "no-such-file.json", snap)).toEqual({ ok: false, text: "No such file: no-such-file.json." });
    expect(gatewayCommand(db, "frob", undefined, snap).text).toMatch(/unknown subcommand "frob"/);
    const r = importSpendLog(db, asJson(ROWS), "spend.json", snap) as SpendLogImport;
    const text = renderImport(r);
    expect(text).toContain("Read 5 requests from spend.json (JSON): 5 new calls, 0 already held.");
    expect(text).toContain("The gateway's own cost: 3 with one, 2 without. It is stored beside the list-price estimate and replaces nothing.");
    expect(text).toContain("Not read: 1 served from the gateway's own cache (no model call); 1 a failed request;");
    expect(text).toContain("1 repeated request id was read once.");
    expect(text).toContain("3 rows have no cache split: all its prompt tokens are priced as fresh input, which overstates a model whose cache reads cost less.");
    expect(text).toContain("1 row reported more cache tokens than its prompt held: the cache was scaled down to fit and the row is flagged.");
    expect(text).toContain("1 call is on a model with no price: some-local-model.");
    expect(text).toContain("Columns present and never read: api_key, messages, proxy_server_request, requester_ip_address, response.");
    expect(text).toContain("Columns not recognised and ignored: flavour.");
  });
});
