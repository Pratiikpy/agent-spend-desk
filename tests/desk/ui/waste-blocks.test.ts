import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openLedger } from "../../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../../src/desk/pricing/pricebook.ts";
import { startUiServer, type UiServer } from "../../../src/desk/ui/server.ts";
import { assistantLine, humanPromptLine } from "../helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const TOKEN = ["ui", "launch", "token", "for", "tests", "0123456789abcdef"].join("-");

let work: string;
let server: UiServer;
let sessionId: string;

const resultLine = (toolUseId: string, ts: string, text: string, isError: boolean): string =>
  JSON.stringify({ type: "user", isSidechain: false, uuid: `res-${toolUseId}`, timestamp: ts, sessionId: "sess-waste", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: text, is_error: isError }] } });

const at = (min: number): string => `2026-10-20T10:${String(min).padStart(2, "0")}:00.000Z`;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "desk-waste-"));
  const lines: string[] = [humanPromptLine({ uuid: "p0", session: "sess-waste", ts: at(0) })];
  // Five different commands that all fail with the same error, then the same file edited five times with nothing run in between.
  ["build", "lint", "test", "typecheck", "bundle"].forEach((task, i) => {
    const m = i + 1;
    lines.push(assistantLine({ id: `msg_echo${m}`, session: "sess-waste", ts: at(m), output: 60_000, read: 5_000, tools: ["Bash"], toolInputs: [{ command: `npm run ${task}` }] }));
    lines.push(resultLine(`tu_msg_echo${m}_0`, at(m), `Error: the script is blocked by the sandbox policy (pid ${1000 + i})`, true));
  });
  for (const m of [10, 11, 12, 13, 14]) {
    lines.push(assistantLine({ id: `msg_edit${m}`, session: "sess-waste", ts: at(m), output: 30_000, read: 5_000, tools: ["Edit"], toolInputs: [{ file_path: "src/app.ts", old_string: `a${m}`, new_string: `b${m}` }] }));
    lines.push(resultLine(`tu_msg_edit${m}_0`, at(m), "The file src/app.ts has been updated.", false));
  }
  const logPath = join(work, "sess-waste.jsonl");
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

describe("a session lists the blocks the extra rules find", () => {
  it("finds the same error from five different commands, from the third on, and the edits that ran nothing between", async () => {
    sessionId = (await get("/api/sessions?range=all")).body["rows"][0].id;
    const d = (await get(`/api/session?id=${sessionId}`)).body;
    const kinds = d.blocks.map((b: { kind: string }) => b.kind).sort();
    expect(kinds).toEqual(["churn", "echo"]);
    const echo = d.blocks.find((b: { kind: string }) => b.kind === "echo");
    expect(echo).toMatchObject({ rule: "C-LOOP-2", calls: 3, confidence: "high" });
    expect(echo.stopOffsetSec).toBe(120); // the third failure, two minutes after the first call
    const churn = d.blocks.find((b: { kind: string }) => b.kind === "churn");
    expect(churn).toMatchObject({ rule: "C-CHURN", calls: 2, confidence: "low" }); // the fourth and fifth edit
  });
});

describe("a block of the extra rules is explained like any other", () => {
  it("says what the rule saw and where it would have acted, without keeping the error's text", async () => {
    const list = (await get(`/api/session?id=${sessionId}`)).body;
    const id = list.blocks.find((b: { kind: string }) => b.kind === "echo").id;
    const res = await get(`/api/session/block?id=${sessionId}&block=${id}`);
    const d = res.body;
    expect(d.state).toBe("ok");
    expect(d.block).toMatchObject({ title: "The same error again and again", rule: "C-LOOP-2", calls: 3 });
    expect(d.stop.why).toBe("the 3rd time Bash returned the same error, with no success of Bash and no prompt from you in between");
    expect(d.rule).toEqual({ id: "C-LOOP-2", params: { repeats: 3 }, observed: { failing_tool: "Bash", calls_flagged: 3 } });
    expect(d.sentences[0].text).toMatch(/^Bash returned the same error again and again, and the agent kept calling it for 3 calls from the third time on\.$/);
    expect(d.sentences[0].basis).toMatch(/the text of the error is not kept/);
  });

  it("calls a heuristic a heuristic", async () => {
    const list = (await get(`/api/session?id=${sessionId}`)).body;
    const id = list.blocks.find((b: { kind: string }) => b.kind === "churn").id;
    const d = (await get(`/api/session/block?id=${sessionId}&block=${id}`)).body;
    expect(d.block).toMatchObject({ title: "One file edited again and again", rule: "C-CHURN" });
    expect(d.cascade.confidence).toBe("low");
    expect(d.cascade.why).toMatch(/may be a file being written well/);
    expect(d.sentences[0].text).toMatch(/This may be one change made in parts, which is work that was needed\.$/);
  });
});
