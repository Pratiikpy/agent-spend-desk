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
let withAgents: string;
let alone: string;

const at = (min: number): string => `2026-10-20T10:${String(min).padStart(2, "0")}:00.000Z`;
const launch = (child: string, ts: string, session: string, agent?: string): string =>
  JSON.stringify({
    type: "user",
    isSidechain: agent !== undefined,
    ...(agent ? { agentId: agent } : {}),
    uuid: `launch-${child}`,
    timestamp: ts,
    sessionId: session,
    toolUseResult: { isAsync: true, status: "async_launched", agentId: child },
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tu_${child}`, content: "launched" }] },
  });

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "desk-deleg-"));
  const main = join(work, "sess-tree.jsonl");
  writeFileSync(main, [humanPromptLine({ uuid: "p0", session: "sess-tree", ts: at(0) }), assistantLine({ id: "m1", session: "sess-tree", ts: at(1), output: 10_000 }), launch("aaaa1111bbbb2222", at(2), "sess-tree")].join("\n") + "\n");
  const a = join(work, "agent-aaaa1111bbbb2222.jsonl");
  writeFileSync(a, [assistantLine({ id: "a1", session: "sess-tree", ts: at(3), output: 40_000, sidechain: true, agent: "aaaa1111bbbb2222" }), launch("cccc3333dddd4444", at(4), "sess-tree", "aaaa1111bbbb2222")].join("\n") + "\n");
  const b = join(work, "agent-cccc3333dddd4444.jsonl");
  writeFileSync(b, assistantLine({ id: "b1", session: "sess-tree", ts: at(5), output: 20_000, sidechain: true, agent: "cccc3333dddd4444" }) + "\n");
  const solo = join(work, "sess-solo.jsonl");
  writeFileSync(solo, [humanPromptLine({ uuid: "p1", session: "sess-solo", ts: at(10) }), assistantLine({ id: "s1", session: "sess-solo", ts: at(11), output: 10_000 })].join("\n") + "\n");
  const dbPath = join(work, "ledger.db");
  const db = openLedger(dbPath);
  await ingestClaudeCode(db, [main, a, b, solo], loadSnapshot(PRICES));
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

const get = async (path: string): Promise<Record<string, any>> => {
  const res = await fetch(`${server.origin}${path}`, { headers: { "x-desk-token": TOKEN } });
  return JSON.parse(await res.text()) as Record<string, any>;
};

describe("a session shows the agents it started", () => {
  it("lists the tree in the order a reader walks it, with each agent alone and with the agents it started", async () => {
    const list = await get("/api/sessions?range=all");
    withAgents = list["rows"].find((r: { id: string }) => r.id === "sess-tree").id;
    alone = list["rows"].find((r: { id: string }) => r.id === "sess-solo").id;
    const d = (await get(`/api/session?id=${withAgents}`))["delegation"];
    expect(d).toMatchObject({ agents: 2, maxDepth: 2, unlinkedMicros: 0, more: null });
    expect(d.nodes.map((n: { key: string; depth: number }) => [n.key, n.depth])).toEqual([["main", 0], ["aaaa1111bbbb2222", 1], ["cccc3333dddd4444", 2]]);
    const [root, first, second] = d.nodes;
    expect(first.cumulativeMicros).toBe(first.directMicros + second.directMicros);
    expect(root.cumulativeMicros).toBe(d.totalMicros);
    expect(root.cumulativeMicros).toBe(root.directMicros + first.cumulativeMicros);
  });

  it("has nothing to say about a session that started no agent", async () => {
    expect((await get(`/api/session?id=${alone}`))["delegation"]).toBeNull();
  });
});
