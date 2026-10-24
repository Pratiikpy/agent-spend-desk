import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openLedger } from "../../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../../src/desk/pricing/pricebook.ts";
import { readExcerpts } from "../../../src/desk/explain/lines.ts";
import { startUiServer, type UiServer } from "../../../src/desk/ui/server.ts";
import { assistantLine, humanPromptLine } from "../helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const TOKEN = ["ui", "launch", "token", "for", "tests", "0123456789abcdef"].join("-");
// A credential of a published shape, built at run time so that no such string sits in the source.
const CREDENTIAL = ["ghp", "_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("");

let work: string;
let server: UiServer;
let logPath: string;
let sessionId: string;
let loopBlock: string;

const resultLine = (toolUseId: string, ts: string, text: string, isError: boolean): string =>
  JSON.stringify({ type: "user", isSidechain: false, uuid: `res-${toolUseId}`, timestamp: ts, sessionId: "sess-loop", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: text, is_error: isError }] } });

const at = (min: number): string => `2026-10-20T10:${String(min).padStart(2, "0")}:00.000Z`;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "desk-block-"));
  const lines: string[] = [humanPromptLine({ uuid: "p0", session: "sess-loop", ts: at(0) })];
  // Six calls: the same failing command four times, then a fix, then an edit that works.
  for (const m of [1, 2, 3, 4]) {
    lines.push(assistantLine({ id: `msg_loop${m}`, session: "sess-loop", ts: at(m), output: 100_000, read: 5_000, tools: ["Bash"], toolInputs: [{ command: "npm run build --prefix D:/work/app" }] }));
    lines.push(resultLine(`tu_msg_loop${m}_0`, at(m), `error: build failed, token ${CREDENTIAL} was rejected`, true));
  }
  lines.push(assistantLine({ id: "msg_fix", session: "sess-loop", ts: at(5), output: 20_000, read: 5_000, tools: ["Edit"], toolInputs: [{ file_path: "src/build.ts" }] }));
  lines.push(resultLine("tu_msg_fix_0", at(5), "ok", false));
  logPath = join(work, "sess-loop.jsonl");
  writeFileSync(logPath, lines.join("\n") + "\n");
  const dbPath = join(work, "ledger.db");
  const db = openLedger(dbPath);
  await ingestClaudeCode(db, [logPath], loadSnapshot(PRICES));
  db.close();
  server = await startUiServer({
    ledgerPath: dbPath, pricesPath: PRICES, policiesDir: "policies", port: 0, token: TOKEN, env: {}, mode: "own_logs", dossierDbPath: null, gateDbPath: null,
    nowMs: () => Date.parse("2026-10-21T10:00:00Z"), extra: { dossiersDir: join(work, "none"), pendingDir: join(work, "none"), memoryDir: join(work, "none") },
  });
}, 60_000);

afterAll(async () => {
  await server?.close();
  rmSync(work, { recursive: true, force: true });
});

const get = async (path: string): Promise<{ status: number; body: Record<string, any> }> => {
  const res = await fetch(`${server.origin}${path}`, { headers: { "x-desk-token": TOKEN } });
  return { status: res.status, body: JSON.parse(await res.text()) as Record<string, any> };
};

describe("a session lists its waste blocks", () => {
  it("finds the loop, with its rule, cost and stop point", async () => {
    const list = await get("/api/sessions?range=all");
    sessionId = list.body["rows"][0].id;
    const d = (await get(`/api/session?id=${sessionId}`)).body;
    expect(d.blockCount).toBe(1);
    const b = d.blocks[0];
    expect(b).toMatchObject({ kind: "loops", rule: "C-LOOP-1", calls: 2 });
    expect(b.stopOffsetSec).toBe(120); // the third failure, two minutes after the first call
    loopBlock = b.id;
  });
});

describe("one block explained", () => {
  it("says where the rule would have acted, how it matched, and the chain from the first break", async () => {
    const d = (await get(`/api/session/block?id=${sessionId}&block=${loopBlock}`)).body;
    expect(d.state).toBe("ok");
    expect(d.block).toMatchObject({ title: "A failing command repeated", rule: "C-LOOP-1", calls: 2 });
    expect(d.stop).toMatchObject({ offsetSec: 120, callsAfter: 1 }); // two minutes after the session's first call
    expect(d.stop.why).toBe("the 3rd identical failing Bash call inside 12 calls, with no prompt from you in between");
    expect(d.stop.savingMicros).toBe(d.block.micros);
    expect(d.rule).toEqual({ id: "C-LOOP-1", params: { repeats: 3, window_calls: 12 }, observed: { failing_tool: "Bash", repeats_seen: 3 } });
    expect(d.cascade.firstBreak).toMatchObject({ tool: "Bash", callsBeforeStop: 2 });
    expect(d.cascade.confidence).toBe("high");
    expect(d.cascade.steps).toHaveLength(4);
    expect(d.sentences[0].text).toMatch(/^Bash failed with the same input 3 times, first at 10:01:00 UTC, and the agent kept calling it for 1 more call\.$/);
    expect(d.sentences[1].text).toContain(`Stopping there would have saved $${(d.stop.savingMicros / 1e6).toFixed(2)}`);
  });

  it("shows each call's price snapshot and marks the first break, the stop point and the calls in the block", async () => {
    const d = (await get(`/api/session/block?id=${sessionId}&block=${loopBlock}`)).body;
    expect(d.calls.map((c: { isFirstBreak: boolean; isStop: boolean; inBlock: boolean }) => [c.isFirstBreak, c.isStop, c.inBlock])).toEqual([[true, false, false], [false, false, false], [false, true, true], [false, false, true]]);
    expect(d.calls.every((c: { snapshotId: string; micros: number }) => c.snapshotId === "litellm-anthropic-2026-10-22" && c.micros > 0)).toBe(true);
    expect(d.snapshotId).toBe("litellm-anthropic-2026-10-22");
  });

  it("reads the lines from the log, redacted and cut short, and never says where the log is", async () => {
    const res = await get(`/api/session/block?id=${sessionId}&block=${loopBlock}`);
    const d = res.body;
    const kinds = d.lines.excerpts.map((e: { role: string }) => e.role);
    expect(kinds.filter((k: string) => k === "tool_use")).toHaveLength(4);
    expect(kinds.filter((k: string) => k === "tool_result")).toHaveLength(4);
    const use = d.lines.excerpts.find((e: { role: string }) => e.role === "tool_use");
    expect(use).toMatchObject({ tool: "Bash" });
    expect(use.text).toContain("npm run build --prefix");
    const result = d.lines.excerpts.find((e: { role: string }) => e.role === "tool_result");
    expect(result).toMatchObject({ isError: true });
    expect(result.text).toContain("(redacted)");
    expect(JSON.stringify(res.body)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(res.body)).not.toContain(work);
    expect(JSON.stringify(res.body)).not.toContain("D:/work/app"); // a path in a command is shortened or masked
    expect(d.lines.missingCalls).toEqual([]);
    expect(d.lines.missingResults).toEqual([]);
    expect(d.lines.unreadable).toBeNull();
  });

  it("says what the session landed, and that no commit means unknown, not proof", async () => {
    const d = (await get(`/api/session/block?id=${sessionId}&block=${loopBlock}`)).body;
    expect(d.landing).toMatchObject({ commits: 0, state: "unlinked" });
    expect(d.landing.statement).toMatch(/^No commit is tied to this session from the sources available/);
    expect(d.landing.statement).toMatch(/unknowable, not proof that nothing landed/);
  });

  it("refuses what it does not have: an unknown session or block, an oversized id", async () => {
    expect((await get(`/api/session/block?id=nope&block=${loopBlock}`)).body.state).toBe("empty");
    expect((await get(`/api/session/block?id=${sessionId}&block=loops-zzzzzzzzzz`)).body.reason).toMatch(/no such waste block/);
    expect((await get(`/api/session/block?id=${sessionId}&block=${"x".repeat(100)}`)).status).toBe(400);
    expect((await get(`/api/session/block?id=${sessionId}`)).status).toBe(400);
  });
});

describe("the log lines are read honestly", () => {
  it("shows a gap, not a guess, when the file has gone or a call is not in it", async () => {
    const gone = await readExcerpts(join(work, "moved.jsonl"), ["msg_loop1"], new Map([["tu_msg_loop1_0", "msg_loop1"]]));
    expect(gone.unreadable).toMatch(/no longer where it was read from/);
    expect(gone.missingCalls).toEqual(["msg_loop1"]);
    const some = await readExcerpts(logPath, ["msg_loop1", "msg_not_there"], new Map([["tu_msg_loop1_0", "msg_loop1"], ["tu_missing", "msg_loop1"]]));
    expect(some.missingCalls).toEqual(["msg_not_there"]);
    expect(some.missingResults).toEqual(["tu_missing"]);
    expect(some.excerpts.filter((e) => e.callId === "msg_loop1")).toHaveLength(2);
    expect((await readExcerpts(null, ["a"], new Map())).unreadable).toMatch(/does not say which log file/);
    expect((await readExcerpts(join(work, "notes.txt"), ["a"], new Map())).unreadable).toMatch(/does not say which log file/);
  });

  it("keeps a long line short", async () => {
    const long = assistantLine({ id: "msg_long", session: "sess-x", ts: at(0), output: 1, tools: ["Bash"], toolInputs: [{ command: "echo " + "word ".repeat(200) }] });
    const p = join(work, "long.jsonl");
    writeFileSync(p, long + "\n");
    const r = await readExcerpts(p, ["msg_long"], new Map());
    expect(r.excerpts[0]!.text.length).toBeLessThanOrEqual(240);
    expect(r.excerpts[0]!.text.endsWith("...")).toBe(true);
  });
});
