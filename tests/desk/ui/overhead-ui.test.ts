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

const at = (min: number): string => `2026-10-20T${String(10 + Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00.000Z`;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "desk-overhead-"));
  const shop = join(work, "shop.jsonl");
  writeFileSync(shop, [humanPromptLine({ uuid: "p1", session: "s-shop", ts: at(0) }), assistantLine({ id: "sh1", session: "s-shop", ts: at(1), output: 100_000, cwd: "D:/work/shop" }), assistantLine({ id: "sh2", session: "s-shop", ts: at(100), output: 40_000, cwd: "D:/work/shop" })].join("\n") + "\n");
  const docs = join(work, "docs.jsonl");
  writeFileSync(docs, [humanPromptLine({ uuid: "p2", session: "s-docs", ts: at(0) }), assistantLine({ id: "dc1", session: "s-docs", ts: at(2), output: 200_000, cwd: "D:/work/docs" })].join("\n") + "\n");
  const dbPath = join(work, "ledger.db");
  const db = openLedger(dbPath);
  await ingestClaudeCode(db, [shop, docs], loadSnapshot(PRICES));
  const outcome = db.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, ?, 'high', 1, 't')");
  outcome.run("s-shop", "kept");
  outcome.run("s-docs", "committed");
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

describe("the overhead of a period for the Bill screen", () => {
  it("shares the idle work among the projects that kept work, and the shares add up to it", async () => {
    const o = (await get("/api/overhead?range=all")).body;
    expect(o).toMatchObject({ state: "ok", bar: "kept", landedSessions: 1, sessions: 2, unallocatedMicros: 0 });
    expect(o["idleMicros"]).toBeGreaterThan(0);
    expect(o["rows"].map((r: { project: string }) => r.project)).toEqual(["shop"]);
    expect(o["rows"][0].allocatedMicros).toBe(o["overheadMicros"]);
    expect(o["alternatives"].map((a: { bar: string; projects: number }) => [a.bar, a.projects])).toEqual([["committed", 2], ["merged", 1], ["kept", 1]]);
  });

  it("shares among more projects at a lower bar", async () => {
    const o = (await get("/api/overhead?range=all&landed=committed")).body;
    expect(o["rows"].map((r: { project: string }) => r.project).sort()).toEqual(["docs", "shop"]);
    expect(o["rows"].reduce((s: number, r: { allocatedMicros: number }) => s + r.allocatedMicros, 0)).toBe(o["overheadMicros"]);
  });

  it("refuses a bar that is not one", async () => {
    expect((await get("/api/overhead?range=all&landed=forever")).status).toBe(400);
  });
});
