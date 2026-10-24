import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openLedger } from "../../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../../src/desk/pricing/pricebook.ts";
import { startUiServer, type UiServer } from "../../../src/desk/ui/server.ts";
import { assistantLine, TempDir } from "../helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const TOKEN = ["ui", "launch", "token", "for", "tests", "0123456789abcdef"].join("-");
const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const HOUR = 3_600_000;

let work: string;
let withLimits: UiServer;
let without: UiServer;
let oldReadings: UiServer;
let old: UiServer;

/** 40 finished 5-hour windows on the plus plan, each with readings at 20%, 40%, 60% and 80% of the way through and one at the end. */
function addWindows(db: ReturnType<typeof openLedger>, tool: string, endMs: number, count: number): void {
  db.prepare("INSERT OR IGNORE INTO session (session_id, tool) VALUES (?, ?)").run(`${tool}:s`, tool);
  const put = db.prepare("INSERT INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type, limit_id) VALUES (?, ?, ?, 'primary', 300, ?, ?, 'plus', NULL)");
  for (let i = 0; i < count; i += 1) {
    const reset = endMs - i * 6 * HOUR;
    const pace = 20 + (i % 5) * 20;
    for (const [f, share] of [[0.2, 0.25], [0.4, 0.5], [0.6, 0.75], [0.8, 1], [0.95, 1]] as const) {
      put.run(tool, `${tool}:s`, new Date(reset - (1 - f) * 5 * HOUR).toISOString(), Math.min(100, Math.round(pace * share)), Math.floor(reset / 1000));
    }
  }
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "desk-brief-runway-"));
  const t = new TempDir();
  const logs = t.file("a.jsonl", [assistantLine({ id: "a1", ts: "2026-10-23T10:00:00Z", output: 1000, model: "claude-opus-5" })]);
  const make = async (name: string, fill?: (db: ReturnType<typeof openLedger>) => void, downgrade = false): Promise<string> => {
    const path = join(work, `${name}.db`);
    const db = openLedger(path);
    await ingestClaudeCode(db, [logs], loadSnapshot(PRICES));
    fill?.(db);
    if (downgrade) db.exec("DROP TABLE limit_sample; PRAGMA user_version = 4;");
    db.close();
    return path;
  };
  const common = { pricesPath: PRICES, policiesDir: "policies", port: 0, token: TOKEN, env: {}, mode: "own_logs" as const, nowMs: () => NOW, extra: { dossiersDir: join(work, "none"), pendingDir: join(work, "none"), memoryDir: join(work, "none") } };
  withLimits = await startUiServer({
    ...common,
    ledgerPath: await make("with", (db) => {
      addWindows(db, "codex", NOW - 3 * HOUR, 40);
      // The window in progress: 2 hours in, 40% used, reading made a minute ago.
      db.prepare("INSERT INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type, limit_id) VALUES ('codex', 'codex:s', ?, 'primary', 300, 40, ?, 'plus', NULL)").run(new Date(NOW - 60_000).toISOString(), Math.floor((NOW + 3 * HOUR) / 1000));
      db.prepare("INSERT INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type, limit_id) VALUES ('codex', 'codex:s', ?, 'primary', 300, 38, ?, 'plus', NULL)").run(new Date(NOW - 20 * 60_000).toISOString(), Math.floor((NOW + 3 * HOUR) / 1000));
    }),
  });
  without = await startUiServer({ ...common, ledgerPath: await make("without") });
  oldReadings = await startUiServer({ ...common, ledgerPath: await make("stale", (db) => addWindows(db, "codex", NOW - 20 * 24 * HOUR, 40)) });
  old = await startUiServer({ ...common, ledgerPath: await make("old", undefined, true) });
}, 120_000);

afterAll(async () => {
  await Promise.all([withLimits?.close(), without?.close(), oldReadings?.close(), old?.close()]);
  rmSync(work, { recursive: true, force: true });
});

const brief = async (s: UiServer): Promise<Record<string, any>> => {
  const res = await fetch(`${s.origin}/api/brief`, { headers: { "x-desk-token": TOKEN } });
  return JSON.parse(await res.text()) as Record<string, any>;
};

describe("the plan limits on the morning brief", () => {
  it("shows where the window in use stands, the outlook from past windows and the sentence", async () => {
    const b = await brief(withLimits);
    expect(b["runway"]).toHaveLength(1);
    const r = b["runway"][0];
    expect(r).toMatchObject({ label: "Codex, plus plan, 5-hour window", state: "ok", usedPct: 40, minutesToReset: 180 });
    expect(r.outlook).toMatchObject({ windows: 10 });
    expect(r.outlook.chance).toBeGreaterThanOrEqual(0);
    expect(r.outlook.chance).toBeLessThanOrEqual(1);
    expect(r.rise).toEqual({ points: 2, minutes: 19 });
    expect(r.text).toMatch(/^Codex, plus plan, 5-hour window: 40% used, resets in 3 h/);
    expect(r.text).toMatch(/similar past windows ended at 95% or more/);
  });

  it("shows nothing for a tool without readings, for readings more than a week old, and for a ledger from before the table existed", async () => {
    expect((await brief(without))["runway"]).toEqual([]);
    expect((await brief(oldReadings))["runway"]).toEqual([]);
    const b = await brief(old);
    expect(b["state"]).toBe("ok");
    expect(b["runway"]).toEqual([]);
  });
});
