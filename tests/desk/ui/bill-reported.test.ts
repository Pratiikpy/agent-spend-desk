import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openLedger } from "../../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../../src/desk/pricing/pricebook.ts";
import { startUiServer, type UiServer } from "../../../src/desk/ui/server.ts";
import { assistantLine } from "../helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const TOKEN = ["ui", "launch", "token", "for", "tests", "0123456789abcdef"].join("-");

let dir: string;
let withCost: UiServer;
let without: UiServer;
let old: UiServer;

const costState = (session: string, start: string, total: number, usd: number): string =>
  JSON.stringify({ type: "cost-state", sessionId: session, totalCostUSD: total, totalAPIDuration: 1, totalLinesAdded: 0, totalLinesRemoved: 0, startTime: Date.parse(start), modelUsage: { "claude-opus-5": { inputTokens: 0, outputTokens: 1_000_000, thinkingTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: usd } }, hasUnknownModelCost: false });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "desk-bill-reported-"));
  const logs = join(dir, "logs", "p");
  mkdirSync(logs, { recursive: true });
  // Opus 5 output costs $25 per million at the snapshot's prices: one million tokens is $25.
  const call = (id: string, session: string, ts: string) => assistantLine({ id, session, ts, output: 1_000_000, model: "claude-opus-5" });
  writeFileSync(join(logs, "a.jsonl"), [
    call("a1", "plain", "2026-10-20T10:00:00Z"),
    costState("plain", "2026-10-20T09:00:00Z", 25, 25),
    assistantLine({ id: "b1", session: "agents", ts: "2026-10-20T11:00:00Z", output: 4_000_000, model: "claude-opus-5", sidechain: true }),
    costState("agents", "2026-10-20T10:30:00Z", 25, 25),
  ].join("\n") + "\n");
  writeFileSync(join(logs, "b.jsonl"), `${call("c1", "bare", "2026-10-20T12:00:00Z")}\n`);

  const make = async (name: string, files: string[]): Promise<string> => {
    const path = join(dir, `${name}.db`);
    const db = openLedger(path);
    await ingestClaudeCode(db, files, loadSnapshot(PRICES));
    db.close();
    return path;
  };
  const common = { pricesPath: PRICES, policiesDir: "policies", port: 0, token: TOKEN, env: {}, extra: { dossiersDir: join(dir, "none"), pendingDir: join(dir, "none"), memoryDir: join(dir, "memory"), tracesDir: join(dir, "traces") } as never, mode: "own_logs" as const };
  withCost = await startUiServer({ ...common, ledgerPath: await make("with", [join(logs, "a.jsonl")]) });
  without = await startUiServer({ ...common, ledgerPath: await make("without", [join(logs, "b.jsonl")]) });

  // A ledger from before the tool's own cost was read: schema version 3, no reported tables.
  const oldPath = await make("old", [join(logs, "b.jsonl")]);
  const raw = openLedger(oldPath);
  raw.exec("DROP TABLE reported_cost; DROP TABLE reported_model_usage; PRAGMA user_version = 3;");
  raw.close();
  old = await startUiServer({ ...common, ledgerPath: oldPath });
}, 120_000);

afterAll(async () => {
  await Promise.all([withCost?.close(), without?.close(), old?.close()]);
  rmSync(dir, { recursive: true, force: true });
});

const bill = async (s: UiServer): Promise<Record<string, any>> => {
  const res = await fetch(`${s.origin}/api/bill`, { headers: { "x-desk-token": TOKEN } });
  return JSON.parse(await res.text()) as Record<string, any>;
};

describe("the Bill screen and the tool's own cost", () => {
  it("shows the cost the tool recorded as its own class, beside the estimate, and says what it is not", async () => {
    const b = await bill(withCost);
    const reported = b["classes"].find((c: { cls: string }) => c.cls === "reported");
    expect(reported).toMatchObject({ processes: 2, micros: 50_000_000 });
    expect(reported.note).toMatch(/not an invoice/);
    expect(b["classes"].find((c: { cls: string }) => c.cls === "estimated").micros).toBe(125_000_000);
  });

  it("reconciles the two and splits out the process that used sub-agents", async () => {
    const r = (await bill(withCost))["reconciliation"];
    expect(r).toMatchObject({ processes: 2, match: 1, estimateHigh: 1, reportedMicros: 50_000_000, estimatedMicros: 125_000_000 });
    expect(r.withSubAgents).toMatchObject({ processes: 1, reportedMicros: 25_000_000, estimatedMicros: 100_000_000 });
    expect(r.withoutSubAgents).toMatchObject({ processes: 1, match: 1 });
  });

  it("says plainly when the tool recorded no cost in the period", async () => {
    const b = await bill(without);
    const reported = b["classes"].find((c: { cls: string }) => c.cls === "reported");
    expect(reported.processes).toBe(0);
    expect(reported.note).toMatch(/recorded no cost of its own/);
    expect(b["reconciliation"]).toBeNull();
  });

  it("still serves a ledger from before the table existed, and says how to read the cost", async () => {
    const b = await bill(old);
    expect(b["state"]).toBe("ok");
    expect(b["classes"].find((c: { cls: string }) => c.cls === "reported").note).toMatch(/desk ingest/);
  });
});
