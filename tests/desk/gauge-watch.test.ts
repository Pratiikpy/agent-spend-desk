import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildGauge } from "../../src/desk/gauge/gauge.ts";
import { gaugeSuffix, newestMtimeMs, watchLogs, writeGaugeCache } from "../../src/desk/gauge/watch.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { recomputeCosts, recordSnapshot } from "../../src/desk/ledger/ingest.ts";
import { testSnapshot } from "./helpers.ts";

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "desk-gauge-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("watching the logs", () => {
  it("draws once at the start and again only when a log changed", async () => {
    const polls = [100, 100, 200, 200, 200, 300];
    let i = 0;
    let sleeps = 0;
    const refreshed = await watchLogs({
      poll: () => polls[Math.min(i++, polls.length - 1)]!,
      refresh: async () => undefined,
      sleep: async () => {
        sleeps += 1;
      },
      intervalMs: 3000,
      shouldStop: () => sleeps >= 6,
    });
    // The start, then the change to 200 and the change to 300.
    expect(refreshed).toBe(3);
  });

  it("stops at once when told to, without drawing again", async () => {
    let refreshes = 0;
    const n = await watchLogs({ poll: () => 1, refresh: async () => void (refreshes += 1), sleep: async () => undefined, intervalMs: 1, shouldStop: () => true });
    expect([n, refreshes]).toEqual([1, 1]);
  });

  it("finds the newest modification time, and ignores a file that is gone", () => {
    const d = tmp();
    writeFileSync(join(d, "a.jsonl"), "x");
    expect(newestMtimeMs([join(d, "a.jsonl"), join(d, "gone.jsonl")])).toBeGreaterThan(0);
    expect(newestMtimeMs([join(d, "gone.jsonl")])).toBe(0);
    expect(newestMtimeMs([])).toBe(0);
  });
});

function gaugeAt(nowMs: number) {
  const db = openLedger(":memory:");
  db.prepare("INSERT INTO session (session_id, tool) VALUES ('s', 'claude_code')").run();
  db.prepare("INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES ('c', 's', ?, 'claude-opus-5', 0, 0, 40000, 0, 0, 0, 0, 'reported', 0, 0)").run(new Date(nowMs - 60_000).toISOString());
  recordSnapshot(db, testSnapshot());
  recomputeCosts(db, testSnapshot(), new Set(["c"]), { unpricedCalls: 0, unpricedModels: {} });
  const g = buildGauge(db, testSnapshot(), { nowMs });
  db.close();
  return g;
}

describe("the status line's cache of the gauge", () => {
  const NOW = Date.parse("2026-10-24T12:00:00.000Z");

  it("holds the burn, the spend and the biggest cause for one line, and expires after ten minutes", () => {
    const f = join(tmp(), "gauge.json");
    writeGaugeCache(f, gaugeAt(NOW));
    expect(gaugeSuffix(f, NOW + 1000)).toMatch(/^\$2\.00\/h · \$1\.00\/5h · [a-z ,-]+ 100%$/);
    expect(gaugeSuffix(f, NOW + 599_000)).not.toBeNull();
    expect(gaugeSuffix(f, NOW + 601_000)).toBeNull();
  });

  it("is nothing when it is missing, corrupt or from the future", () => {
    const d = tmp();
    expect(gaugeSuffix(join(d, "none.json"), NOW)).toBeNull();
    writeFileSync(join(d, "bad.json"), "{not json");
    expect(gaugeSuffix(join(d, "bad.json"), NOW)).toBeNull();
    const f = join(d, "future.json");
    writeGaugeCache(f, gaugeAt(NOW));
    expect(gaugeSuffix(f, NOW - 3_600_000)).toBeNull();
  });

  it("is added to the status line by the real status line command, and the line is as before without it", () => {
    const d = tmp();
    const cache = join(d, "gauge.json");
    const now = Date.now();
    writeGaugeCache(cache, gaugeAt(now));
    const payload = JSON.stringify({ session_id: "abc", model: { id: "claude-opus-5" }, rate_limits: { five_hour: { used_percentage: 33, resets_at: Math.floor(now / 1000) + 3600 } } });
    const run = (env: Record<string, string>) => spawnSync(process.execPath, ["src/desk/statusline/main.ts"], { input: payload, encoding: "utf8", env: { ...process.env, DESK_STATUSLINE_LOG: join(d, "sl.jsonl"), ...env } });
    const withCache = run({ DESK_GAUGE_CACHE: cache });
    expect(withCache.status).toBe(0);
    expect(withCache.stdout).toMatch(/claude-opus-5 · 5h 33% \(resets in 1h?[^)]*\) · \$2\.00\/h · \$1\.00\/5h/);
    const without = run({ DESK_GAUGE_CACHE: join(d, "missing.json") });
    expect(without.stdout.trim()).toMatch(/^claude-opus-5 · 5h 33% \(resets in [^)]*\)$/);
  });
});

describe("desk gauge", () => {
  it("prints a one-line gauge from a ledger, and the detailed view, and says so plainly for an empty ledger", () => {
    const d = tmp();
    const dbFile = join(d, "ledger.db");
    const now = Date.now();
    const db = openLedger(dbFile);
    db.prepare("INSERT INTO session (session_id, tool) VALUES ('s', 'claude_code')").run();
    db.prepare("INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES ('c', 's', ?, 'claude-opus-5', 0, 0, 40000, 0, 0, 0, 0, 'reported', 0, 0)").run(new Date(now - 120_000).toISOString());
    recordSnapshot(db, testSnapshot());
    recomputeCosts(db, testSnapshot(), new Set(["c"]), { unpricedCalls: 0, unpricedModels: {} });
    db.close();
    const env = { ...process.env, DESK_GAUGE_CACHE: join(d, "g.json"), DESK_STATUSLINE_LOG: join(d, "none.jsonl") };
    const run = (...a: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "gauge", "--no-ingest", "--db", dbFile, "--prices", "data/prices/anthropic-litellm-2026-10-22.json", ...a], { encoding: "utf8", env });
    const line = run("--line");
    expect(line.status).toBe(0);
    expect(line.stdout.trim().split("\n")).toHaveLength(1);
    const full = run();
    expect(full.stdout).toMatch(/Spend\s+\$\d/);
    expect(full.stdout).toMatch(/Burn\s+/);
    expect(run("--hours", "0").status).not.toBe(0);
    expect(run("--hours", "abc").stderr).toMatch(/--hours must be a number/);
  });
});
