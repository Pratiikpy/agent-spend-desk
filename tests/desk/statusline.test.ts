import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { ingestCodex } from "../../src/desk/ledger/ingest-codex.ts";
import { ingestStatusline } from "../../src/desk/ledger/ingest-statusline.ts";
import { fitLimit, observeWindows } from "../../src/desk/limits/fit.ts";
import { gauge, installSnippet, parseStatusline, readSamples, recordSample } from "../../src/desk/statusline/statusline.ts";
import { codexLines } from "./codex-fixtures.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";

const NOW = new Date("2026-10-24T10:00:00.000Z");
const EPOCH = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** The input Claude Code sends a status line script, with the fields the documentation lists (read 2026-10-24). */
const input = (over: Record<string, unknown> = {}) => ({
  session_id: "sess-1",
  model: { id: "claude-opus-5", display_name: "Opus 5" },
  workspace: { current_dir: "/work/app" },
  version: "2.1.308",
  cost: { total_cost_usd: 4.2134, total_duration_ms: 90_000, total_lines_added: 10, total_lines_removed: 2 },
  context_window: { used_percentage: 37, context_window_size: 200_000 },
  rate_limits: { five_hour: { used_percentage: 23.5, resets_at: EPOCH("2026-10-24T13:00:00Z") }, seven_day: { used_percentage: 41, resets_at: EPOCH("2026-10-29T09:00:00Z") } },
  ...over,
});

let dir: TempDir;
let db: Ledger;
beforeEach(() => {
  dir = new TempDir();
  db = openLedger(":memory:");
});
afterEach(() => {
  db.close();
  dir.dispose();
});

describe("reading what Claude Code sends a status line", () => {
  it("keeps the session, the cost, the context share and both rate-limit windows", () => {
    const s = parseStatusline(input(), NOW)!;
    expect(s).toMatchObject({ ts: "2026-10-24T10:00:00.000Z", sessionId: "sess-1", model: "claude-opus-5", costUsd: 4.2134, contextPct: 37, version: "2.1.308" });
    expect(s.fiveHour).toEqual({ pct: 23.5, resetsAt: EPOCH("2026-10-24T13:00:00Z") });
    expect(s.sevenDay).toEqual({ pct: 41, resetsAt: EPOCH("2026-10-29T09:00:00Z") });
  });

  it("copes with the fields that may be absent: no rate limits (an API key user), a window dropped, a null context", () => {
    const none = parseStatusline(input({ rate_limits: undefined }), NOW)!;
    expect(none.fiveHour).toBeNull();
    expect(none.sevenDay).toBeNull();
    const one = parseStatusline(input({ rate_limits: { five_hour: { used_percentage: 5, resets_at: EPOCH("2026-10-24T13:00:00Z") } }, context_window: { used_percentage: null } }), NOW)!;
    expect(one.sevenDay).toBeNull();
    expect(one.contextPct).toBeNull();
  });

  it("refuses a percentage outside 0 to 100 as a window it cannot trust, and non-objects altogether", () => {
    expect(parseStatusline(input({ rate_limits: { five_hour: { used_percentage: 140, resets_at: 1 } } }), NOW)!.fiveHour).toBeNull();
    expect(parseStatusline(input({ rate_limits: { five_hour: { used_percentage: "9", resets_at: 1 } } }), NOW)!.fiveHour).toBeNull();
    expect(parseStatusline("text", NOW)).toBeNull();
    expect(parseStatusline(null, NOW)).toBeNull();
    expect(parseStatusline([], NOW)).toBeNull();
  });

  it("does not keep the working directory, the branch or any text the session holds", () => {
    const s = parseStatusline(input({ prompt: "secret prompt", transcript_path: "t.jsonl" }), NOW)!;
    expect(JSON.stringify(s)).not.toMatch(/work\/app|secret prompt|transcript/);
  });
});

describe("the gauge line", () => {
  it("shows the 5-hour and weekly percent, when the 5-hour window resets, and the cost", () => {
    const line = gauge(parseStatusline(input(), NOW)!, NOW);
    expect(line).toContain("5h 24%");
    expect(line).toContain("wk 41%");
    expect(line).toContain("resets in 3h");
    expect(line).toContain("$4.21");
  });

  it("drops a window that has already reset, as Claude Code does, and still prints something with no limits at all", () => {
    const stale = parseStatusline(input({ rate_limits: { five_hour: { used_percentage: 90, resets_at: EPOCH("2026-10-24T09:00:00Z") } } }), NOW)!;
    expect(gauge(stale, NOW)).not.toContain("5h");
    expect(gauge(parseStatusline(input({ rate_limits: undefined, cost: undefined }), NOW)!, NOW)).toMatch(/opus/i);
  });
});

describe("the sample log", () => {
  it("appends a sample when something changed or a minute has passed, and not otherwise", () => {
    const path = join(dir.path, "sl.jsonl");
    const first = parseStatusline(input(), NOW)!;
    expect(recordSample(path, first)).toBe(true);
    expect(recordSample(path, { ...first, ts: "2026-10-24T10:00:05.000Z" })).toBe(false);
    expect(recordSample(path, { ...first, ts: "2026-10-24T10:00:10.000Z", fiveHour: { pct: 24.5, resetsAt: first.fiveHour!.resetsAt } })).toBe(true);
    expect(recordSample(path, { ...first, ts: "2026-10-24T10:02:00.000Z" })).toBe(true);
    expect(readSamples(path)).toHaveLength(3);
  });

  it("keeps the logs of different sessions apart, and never lets the file grow past its cap", () => {
    const path = join(dir.path, "sl.jsonl");
    const a = parseStatusline(input(), NOW)!;
    expect(recordSample(path, a)).toBe(true);
    expect(recordSample(path, { ...a, sessionId: "sess-2" })).toBe(true);
    writeFileSync(path, "x".repeat(2000));
    expect(recordSample(path, { ...a, ts: "2026-10-24T11:00:00.000Z" }, { maxBytes: 1000 })).toBe(true);
    expect(statSync(path).size).toBeLessThan(1000);
    expect(readSamples(path)).toHaveLength(1);
  });

  it("skips damaged lines when reading", () => {
    const path = join(dir.path, "sl.jsonl");
    recordSample(path, parseStatusline(input(), NOW)!);
    writeFileSync(path, `not json\n${readFileSync(path, "utf8")}{"ts":"x"`);
    expect(readSamples(path)).toHaveLength(1);
  });
});

describe("telling the user how to turn it on", () => {
  it("prints a settings snippet that runs this command, with forward slashes in the path", () => {
    const snippet = installSnippet("C:\\work\\desk");
    expect(snippet).toContain('"statusLine"');
    expect(snippet).toContain("C:/work/desk");
    expect(snippet).not.toContain("\\\\");
    expect(JSON.parse(`{${snippet}}`).statusLine.type).toBe("command");
  });
});

describe("the readings in the ledger", () => {
  const samples = (n: number) =>
    Array.from({ length: n }, (_, w) => {
      const start = Date.UTC(2026, 8, 1 + w, 8, 0, 0);
      const resetsAt = Math.floor(start / 1000) + 5 * 3600;
      return Array.from({ length: 12 }, (_, k) => parseStatusline(input({ session_id: `w${w}`, rate_limits: { five_hour: { used_percentage: k * 2, resets_at: resetsAt }, seven_day: { used_percentage: 10 + k, resets_at: resetsAt + 400_000 } } }), new Date(start + k * 60_000))!);
    }).flat();

  it("stores them as the plan limit of Claude Code, once each, and reads the same ones again without duplicating", () => {
    const s = samples(2);
    const r = ingestStatusline(db, s);
    expect(r.limitSamples).toBeGreaterThan(0);
    const again = ingestStatusline(db, s);
    expect(again.limitSamples).toBe(0);
    expect(db.prepare("SELECT tool, kind, window_minutes, limit_id FROM limit_sample GROUP BY tool, kind").all()).toEqual([
      { tool: "claude_code", kind: "primary", window_minutes: 300, limit_id: "claude" },
      { tool: "claude_code", kind: "secondary", window_minutes: 10_080, limit_id: "claude" },
    ]);
  });

  it("feeds the same limit fit, with Claude models counted and other models not", async () => {
    // twelve 5-hour windows, each with 12 readings that move the percent by 22 points, and Claude calls of 40,000 tokens between them
    ingestStatusline(db, samples(12));
    const lines: string[] = [];
    for (let w = 0; w < 12; w += 1) {
      const start = Date.UTC(2026, 8, 1 + w, 8, 0, 0);
      for (let k = 1; k <= 11; k += 1) lines.push(assistantLine({ id: `c${w}-${k}`, session: `w${w}`, ts: new Date(start + k * 60_000 - 1000).toISOString(), output: 40_000, model: "claude-opus-5" }));
      lines.push(assistantLine({ id: `k${w}`, session: `w${w}`, ts: new Date(start + 5 * 60_000 + 500).toISOString(), output: 9_000_000, model: "kimi-k3" }));
    }
    await ingestClaudeCode(db, [dir.file("claude.jsonl", lines)], testSnapshot());
    const obs = observeWindows(db, { tool: "claude_code", kind: "primary" });
    expect(obs).toHaveLength(12);
    expect(obs[0]).toMatchObject({ dPct: 22, calls: 11 });
    const fit = fitLimit(obs, { seed: 3 });
    expect(fit.abstained).toBe(false);
    expect(fit.tokensPerPercent).toBeGreaterThan(15_000);
    expect(fit.tokensPerPercent).toBeLessThan(21_000);
  });

  it("leaves the Codex readings alone when both are in one ledger", async () => {
    ingestStatusline(db, samples(1));
    await ingestCodex(db, [dir.file("x.jsonl", [codexLines.meta({ id: "cx" }), codexLines.turn("2026-10-01T10:00:01.000Z", "gpt-5.5"), codexLines.count("2026-10-01T10:00:05.000Z", { input: 100, cached: 0, output: 10, reasoning: 0 }, undefined, { primary: { used: 3, minutes: 300, resetsAt: 1_790_000_000 }, plan: "plus" })])], testSnapshot());
    expect(db.prepare("SELECT tool, COUNT(*) n FROM limit_sample GROUP BY tool ORDER BY tool").all().map((r) => (r as { tool: string }).tool)).toEqual(["claude_code", "codex"]);
  });
});
