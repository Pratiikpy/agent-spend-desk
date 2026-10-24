import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseOpenCodeMessage, readOpenCode } from "../../src/desk/ingest/opencode.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestOpenCode } from "../../src/desk/ledger/ingest-opencode.ts";
import { TempDir, testSnapshot } from "./helpers.ts";

const T0 = Date.UTC(2026, 9, 20, 10, 0, 0);

interface Msg {
  id: string;
  session?: string;
  role?: "assistant" | "user";
  provider?: string;
  model?: string;
  tokens?: { input: number; output: number; reasoning: number; read: number; write: number } | null;
  completed?: boolean;
  error?: boolean;
  finish?: string;
  created?: number;
  cost?: number;
  parts?: unknown[];
}

/** An OpenCode database with the tables and columns the reader uses, in the shape of a real 1.15 database (checked on one). */
function makeDb(path: string, sessions: { id: string; parent?: string | null; directory?: string; version?: string }[], messages: Msg[]): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE session (id text PRIMARY KEY, parent_id text, directory text NOT NULL, version text NOT NULL, time_created integer NOT NULL);
    CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
    CREATE TABLE part (id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
    CREATE TABLE credential (id text PRIMARY KEY, value text NOT NULL);
    INSERT INTO credential VALUES ('c1', 'SENTINEL-VALUE-THAT-MUST-NEVER-BE-READ');
  `);
  for (const s of sessions) db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run(s.id, s.parent ?? null, s.directory ?? "C:/work/app", s.version ?? "1.15.6", T0);
  let n = 0;
  for (const m of messages) {
    const created = m.created ?? T0 + n * 1000;
    const data: Record<string, unknown> =
      (m.role ?? "assistant") === "user"
        ? { role: "user", time: { created }, agent: "build" }
        : {
            parentID: "msg_parent",
            role: "assistant",
            mode: "build",
            agent: "build",
            path: { cwd: "C:/work/app", root: "C:/work/app" },
            cost: m.cost ?? 0,
            ...(m.tokens === null ? {} : { tokens: { input: m.tokens?.input ?? 0, output: m.tokens?.output ?? 0, reasoning: m.tokens?.reasoning ?? 0, cache: { read: m.tokens?.read ?? 0, write: m.tokens?.write ?? 0 } } }),
            modelID: m.model ?? "claude-sonnet-5-5",
            providerID: m.provider ?? "anthropic",
            time: m.completed === false ? { created } : { created, completed: created + 500 },
            ...(m.error ? { error: { name: "APIError", data: { message: "overloaded" } } } : {}),
            ...(m.finish ? { finish: m.finish } : {}),
          };
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(m.id, m.session ?? "ses_1", created, created, JSON.stringify(data));
    let p = 0;
    for (const part of m.parts ?? []) db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(`${m.id}_p${p++}`, m.id, m.session ?? "ses_1", created, created, JSON.stringify(part));
    n += 1;
  }
  db.close();
}

let dir: TempDir;
let ledger: Ledger;
beforeEach(() => {
  dir = new TempDir();
  ledger = openLedger(":memory:");
});
afterEach(() => {
  ledger.close();
  dir.dispose();
});
const dbPath = (): string => join(dir.path, "opencode.db");
const one = <T>(sql: string, ...args: (string | number)[]): T => ledger.prepare(sql).get(...args) as T;

describe("one OpenCode message", () => {
  const raw = (o: object): string => JSON.stringify(o);
  const base = { role: "assistant", modelID: "claude-sonnet-5-5", providerID: "anthropic", time: { created: T0, completed: T0 + 900 }, tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 300, write: 40 } }, cost: 0.5 };

  it("reads tokens, model, time and finish reason, and counts reasoning inside output as the other readers do", () => {
    const r = parseOpenCodeMessage("msg_1", "ses_1", false, raw({ ...base, finish: "tool-calls" }), [], null);
    expect(r).toMatchObject({
      call: { callId: "opencode:msg_1", sessionId: "opencode:ses_1", ts: new Date(T0).toISOString(), model: "claude-sonnet-5-5", inputTokens: 10, outputTokens: 25, reasoningTokens: 5, cacheReadTokens: 300, cacheWriteTokens: 40, stopReason: "tool-calls", isSidechain: false, isApiError: false, reportedCost: 0.5 },
    });
  });

  it("does not add reasoning to output when the message's own step totals show it is already inside", () => {
    const inclusive = parseOpenCodeMessage("msg_1", "ses_1", false, raw(base), [], 10 + 20 + 300 + 40);
    expect(inclusive).toMatchObject({ call: { outputTokens: 20, reasoningTokens: 5, reasoningInOutput: "contradicted" } });
    const disjoint = parseOpenCodeMessage("msg_1", "ses_1", false, raw(base), [], 10 + 20 + 5 + 300 + 40);
    expect(disjoint).toMatchObject({ call: { outputTokens: 25, reasoningInOutput: "confirmed" } });
    const unknown = parseOpenCodeMessage("msg_1", "ses_1", false, raw(base), [], 999);
    expect(unknown).toMatchObject({ call: { outputTokens: 25, reasoningInOutput: "unchecked" } });
  });

  it("names a model from another provider with its provider, so a first-party price is never applied to it", () => {
    const r = parseOpenCodeMessage("m", "s", false, raw({ ...base, providerID: "kilo", modelID: "anthropic/claude-opus-4.7-fast" }), [], null);
    expect(r).toMatchObject({ call: { model: "kilo/anthropic/claude-opus-4.7-fast" } });
  });

  it("skips what is not a finished model call, and says why", () => {
    expect(parseOpenCodeMessage("m", "s", false, raw({ role: "user", time: { created: T0 } }), [], null)).toEqual({ skip: "not-assistant" });
    expect(parseOpenCodeMessage("m", "s", false, raw({ ...base, time: { created: T0 } }), [], null)).toEqual({ skip: "unfinished" });
    expect(parseOpenCodeMessage("m", "s", false, raw({ ...base, tokens: undefined }), [], null)).toEqual({ skip: "no-tokens" });
    expect(parseOpenCodeMessage("m", "s", false, "{ not json", [], null)).toEqual({ skip: "malformed" });
    expect(parseOpenCodeMessage("m", "s", false, "[1]", [], null)).toEqual({ skip: "malformed" });
    expect(parseOpenCodeMessage("m", "s", false, raw({ ...base, tokens: { ...base.tokens, input: -1 } }), [], null)).toEqual({ skip: "bad-tokens" });
    expect(parseOpenCodeMessage("m", "s", false, raw({ ...base, tokens: { ...base.tokens, output: 1.5 } }), [], null)).toEqual({ skip: "bad-tokens" });
    expect(parseOpenCodeMessage("m", "s", false, raw({ ...base, tokens: { ...base.tokens, input: 2 ** 60 } }), [], null)).toEqual({ skip: "bad-tokens" });
    expect(parseOpenCodeMessage("m", "s", false, raw({ ...base, time: { created: "yesterday", completed: 1 } }), [], null)).toEqual({ skip: "bad-time" });
  });

  it("keeps a failed call, marked as one, with no tokens", () => {
    const r = parseOpenCodeMessage("m", "s", false, raw({ ...base, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, error: { name: "APIError" } }), [], null);
    expect(r).toMatchObject({ call: { isApiError: true, inputTokens: 0 } });
  });
});

describe("reading an OpenCode database into the ledger", () => {
  it("stores each finished call once, with its session, and prices a first-party model and no other", async () => {
    makeDb(dbPath(), [{ id: "ses_1", directory: "C:/work/app", version: "1.15.6" }], [
      { id: "m1", tokens: { input: 1000, output: 500, reasoning: 0, read: 2_000_000, write: 0 }, finish: "stop" },
      { id: "m2", provider: "kilo", model: "kilo-auto/free", tokens: { input: 50, output: 5, reasoning: 0, read: 0, write: 0 } },
      { role: "user", id: "m3" },
      { id: "m4", completed: false, tokens: { input: 1, output: 1, reasoning: 0, read: 0, write: 0 } },
    ]);
    const r = await ingestOpenCode(ledger, dbPath(), testSnapshot());
    expect(r).toMatchObject({ messages: 4, callsNew: 2, skipped: { "not-assistant": 1, unfinished: 1 }, unpricedCalls: 1 });
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM model_call").n).toBe(2);
    expect(one<{ tool: string; project_path: string; tool_version: string }>("SELECT tool, project_path, tool_version FROM session WHERE session_id = 'opencode:ses_1'")).toEqual({ tool: "opencode", project_path: "C:/work/app", tool_version: "1.15.6" });
    const priced = one<{ class: string; total_micros: number }>("SELECT class, total_micros FROM cost_event WHERE call_id = 'opencode:m1'");
    // Sonnet 5.5 at the test snapshot: $2 in, $10 out, $0.10 cache read per million tokens.
    expect(priced).toEqual({ class: "estimated", total_micros: 2000 + 5000 + 200_000 });
    expect(one<{ class: string; unpriced_reason: string }>("SELECT class, unpriced_reason FROM cost_event WHERE call_id = 'opencode:m2'")).toMatchObject({ class: "unpriced" });
  });

  it("reading it again stores nothing twice, and picks up a call that finished in between", async () => {
    makeDb(dbPath(), [{ id: "ses_1" }], [{ id: "m1", tokens: { input: 1, output: 1, reasoning: 0, read: 0, write: 0 } }, { id: "m2", completed: false, tokens: { input: 7, output: 7, reasoning: 0, read: 0, write: 0 } }]);
    expect((await ingestOpenCode(ledger, dbPath(), testSnapshot())).callsNew).toBe(1);
    expect((await ingestOpenCode(ledger, dbPath(), testSnapshot())).callsNew).toBe(0);
    const db = new DatabaseSync(dbPath());
    const row = db.prepare("SELECT data FROM message WHERE id = 'm2'").get() as { data: string };
    const data = JSON.parse(row.data) as { time: { created: number; completed?: number } };
    data.time.completed = data.time.created + 900;
    db.prepare("UPDATE message SET data = ? WHERE id = 'm2'").run(JSON.stringify(data));
    db.close();
    expect((await ingestOpenCode(ledger, dbPath(), testSnapshot())).callsNew).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) n FROM model_call").n).toBe(2);
  });

  it("marks a call in a sub-agent session, and keeps tool names but no text", async () => {
    makeDb(dbPath(), [{ id: "ses_1" }, { id: "ses_2", parent: "ses_1" }], [
      { id: "m1", session: "ses_1", tokens: { input: 1, output: 1, reasoning: 0, read: 0, write: 0 }, parts: [{ type: "tool", tool: "read", callID: "c1", state: { input: { path: "SECRET-PROMPT-TEXT" }, output: "FILE-CONTENT-SENTINEL" } }, { type: "text", text: "PROMPT-TEXT-SENTINEL" }, { type: "tool", tool: "bash", callID: "c2", state: {} }] },
      { id: "m2", session: "ses_2", tokens: { input: 1, output: 1, reasoning: 0, read: 0, write: 0 } },
    ]);
    await ingestOpenCode(ledger, dbPath(), testSnapshot());
    expect(one<{ tool_names: string; is_sidechain: number }>("SELECT tool_names, is_sidechain FROM model_call WHERE call_id = 'opencode:m1'")).toEqual({ tool_names: '["read","bash"]', is_sidechain: 0 });
    expect(one<{ is_sidechain: number }>("SELECT is_sidechain FROM model_call WHERE call_id = 'opencode:m2'").is_sidechain).toBe(1);
    const everything = JSON.stringify([ledger.prepare("SELECT * FROM model_call").all(), ledger.prepare("SELECT * FROM session").all(), ledger.prepare("SELECT * FROM tool_call").all()]);
    expect(everything).not.toMatch(/SENTINEL|SECRET-PROMPT/);
  });

  it("never reads the tables that hold credentials", async () => {
    makeDb(dbPath(), [{ id: "ses_1" }], [{ id: "m1", tokens: { input: 1, output: 1, reasoning: 0, read: 0, write: 0 } }]);
    await ingestOpenCode(ledger, dbPath(), testSnapshot());
    const everything = JSON.stringify(ledger.prepare("SELECT name FROM sqlite_master").all());
    expect(everything).not.toMatch(/credential/);
    expect(JSON.stringify([ledger.prepare("SELECT * FROM session").all(), ledger.prepare("SELECT * FROM model_call").all()])).not.toMatch(/MUST-NEVER-BE-READ/);
  });

  it("masks a credential-shaped string in a folder name before storing it", async () => {
    const fake = `sk-${"a1B2c3D4".repeat(5)}`;
    makeDb(dbPath(), [{ id: "ses_1", directory: `C:/work/${fake}/app` }], [{ id: "m1", tokens: { input: 1, output: 1, reasoning: 0, read: 0, write: 0 } }]);
    await ingestOpenCode(ledger, dbPath(), testSnapshot());
    const row = one<{ project_path: string }>("SELECT project_path FROM session WHERE session_id = 'opencode:ses_1'");
    expect(row.project_path).not.toContain(fake);
  });

  it("explains a missing file, a file that is not a database and a database that is not OpenCode's", async () => {
    await expect(ingestOpenCode(ledger, join(dir.path, "nothing.db"), testSnapshot())).rejects.toThrow(/not found/i);
    const junk = dir.file("junk.db", ["this is not sqlite"]);
    await expect(ingestOpenCode(ledger, junk, testSnapshot())).rejects.toThrow(/not an OpenCode database/i);
    const other = new DatabaseSync(join(dir.path, "other.db"));
    other.exec("CREATE TABLE t (x)");
    other.close();
    await expect(ingestOpenCode(ledger, join(dir.path, "other.db"), testSnapshot())).rejects.toThrow(/not an OpenCode database/i);
  });

  it("reads a database that is being written, without changing it", () => {
    makeDb(dbPath(), [{ id: "ses_1" }], [{ id: "m1", tokens: { input: 1, output: 1, reasoning: 0, read: 0, write: 0 } }]);
    const first = readOpenCode(dbPath(), new Set());
    expect(first.calls).toHaveLength(1);
    const check = new DatabaseSync(dbPath());
    expect((check.prepare("SELECT COUNT(*) n FROM message").get() as { n: number }).n).toBe(1);
    check.close();
  });

  it("counts how often the step totals confirm the reasoning convention", async () => {
    const step = (total: number) => ({ type: "step-finish", reason: "stop", tokens: { total, input: 10, output: 20, reasoning: 5, cache: { read: 0, write: 0 } } });
    makeDb(dbPath(), [{ id: "ses_1" }], [
      { id: "m1", tokens: { input: 10, output: 20, reasoning: 5, read: 0, write: 0 }, parts: [step(35)] },
      { id: "m2", tokens: { input: 10, output: 20, reasoning: 5, read: 0, write: 0 }, parts: [step(30)] },
      { id: "m3", tokens: { input: 10, output: 20, reasoning: 5, read: 0, write: 0 } },
    ]);
    const r = await ingestOpenCode(ledger, dbPath(), testSnapshot());
    expect(r.reasoningInOutput).toEqual({ confirmed: 1, contradicted: 1, unchecked: 1 });
    expect(one<{ output_tokens: number }>("SELECT output_tokens FROM model_call WHERE call_id = 'opencode:m1'").output_tokens).toBe(25);
    expect(one<{ output_tokens: number }>("SELECT output_tokens FROM model_call WHERE call_id = 'opencode:m2'").output_tokens).toBe(20);
  });
});
