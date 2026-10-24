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
let ledgerPath: string;
let withBand: UiServer;
let agreeing: UiServer;
let noSource: UiServer;
let broken: UiServer;

/** Portkey's record for Sonnet 5.5 at our price book's other prices, with the cache read price (US cents per token) given. */
const portkeyFile = (cacheReadCents: number): string =>
  JSON.stringify({
    fetchedAt: "2026-10-24T12:00:00.000Z",
    models: {
      default: {},
      "claude-sonnet-5-5": {
        pricing_config: { pay_as_you_go: { request_token: { price: 0.0002 }, response_token: { price: 0.001 }, cache_read_input_token: { price: cacheReadCents }, cache_write_input_token: { price: 0.00025 }, additional_units: { cache_write_1h: { price: 0.0004 } } } },
      },
    },
  });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "desk-bill-band-"));
  const logs = join(dir, "logs");
  mkdirSync(logs, { recursive: true });
  // Two million Sonnet 5.5 cache-read tokens in the last 30 days: $0.20 at our price ($0.10 per million), $0.40 at Portkey's ($0.20 per million).
  // A call months earlier holds three million more: it belongs to the whole ledger but not to the last 30 days.
  const call = (id: string, read: number, ts: string) => assistantLine({ id, model: "claude-sonnet-5-5", read, input: 1000, output: 1000, ts });
  writeFileSync(join(logs, "a.jsonl"), `${call("a1", 2_000_000, "2026-10-20T10:00:00Z")}\n${call("a0", 3_000_000, "2026-08-01T10:00:00Z")}\n`);
  ledgerPath = join(dir, "ledger.db");
  const db = openLedger(ledgerPath);
  await ingestClaudeCode(db, [join(logs, "a.jsonl")], loadSnapshot(PRICES));
  db.close();
  writeFileSync(join(dir, "differs.json"), portkeyFile(0.00002));
  writeFileSync(join(dir, "same.json"), portkeyFile(0.00001));
  writeFileSync(join(dir, "broken.json"), "{ not json");
  const common = { ledgerPath, pricesPath: PRICES, policiesDir: "policies", port: 0, token: TOKEN, env: {}, mode: "own_logs" as const, extra: { dossiersDir: join(dir, "none"), pendingDir: join(dir, "none"), memoryDir: join(dir, "none") } };
  withBand = await startUiServer({ ...common, otherPricesPath: join(dir, "differs.json") });
  agreeing = await startUiServer({ ...common, otherPricesPath: join(dir, "same.json") });
  noSource = await startUiServer({ ...common, otherPricesPath: join(dir, "missing.json") });
  broken = await startUiServer({ ...common, otherPricesPath: join(dir, "broken.json") });
}, 120_000);

afterAll(async () => {
  await Promise.all([withBand?.close(), agreeing?.close(), noSource?.close(), broken?.close()]);
  rmSync(dir, { recursive: true, force: true });
});

const bill = async (s: UiServer, query = ""): Promise<Record<string, any>> => {
  const res = await fetch(`${s.origin}/api/bill${query}`, { headers: { "x-desk-token": TOKEN } });
  return JSON.parse(await res.text()) as Record<string, any>;
};

describe("the Bill screen and a disagreeing second price source", () => {
  it("shows the estimate as a range, naming the model, the price, the tokens and the source", async () => {
    const b = await bill(withBand);
    expect(b["priceBand"]).toMatchObject({ source: "Portkey", fetchedAt: "2026-10-24", items: [{ model: "claude-sonnet-5-5", price: "cache read", longPrompts: false, tokens: 2_000_000, deltaMicros: 200_000 }] });
    expect(b["priceBand"].highMicros - b["priceBand"].estimateMicros).toBe(200_000);
    expect(b["priceBand"].lowMicros).toBe(b["priceBand"].estimateMicros);
    expect(b["priceBand"].estimateMicros).toBe(b["totals"].estimatedMicros);
    expect(b["priceBand"].note).toMatch(/not verified/);
  });

  it("shows nothing when the sources agree, when there is no second source, and when its file cannot be read", async () => {
    expect((await bill(agreeing))["priceBand"]).toBeNull();
    expect((await bill(noSource))["priceBand"]).toBeNull();
    const b = await bill(broken);
    expect(b["state"]).toBe("ok");
    expect(b["priceBand"]).toBeNull();
  });

  it("counts only the tokens in the period shown", async () => {
    expect((await bill(withBand))["priceBand"].items[0].tokens).toBe(2_000_000);
    expect((await bill(withBand, "?range=all"))["priceBand"].items[0].tokens).toBe(5_000_000);
  });
});
