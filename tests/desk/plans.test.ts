import { describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { plansView, renderPlans } from "../../src/desk/limits/plans.ts";

const H = 3_600_000;
const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

interface World {
  db: Ledger;
  call: (tool: string, ts: number, model: string, tokens: number, thread?: number) => void;
  sample: (tool: string, ts: number, kind: "primary" | "secondary", minutes: number, pct: number, resetsMs: number, plan?: string | null) => void;
}

function world(): World {
  const db = openLedger(":memory:");
  const sessions = new Set<string>();
  let n = 0;
  return {
    db,
    call(tool, ts, model, tokens, thread = 1) {
      const sid = `${tool}-s`;
      if (!sessions.has(sid)) {
        sessions.add(sid);
        db.prepare("INSERT INTO session (session_id, tool) VALUES (?, ?)").run(sid, tool);
      }
      n += 1;
      db.prepare("INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) SELECT ?, ?, 0, 0, 't' WHERE NOT EXISTS (SELECT 1 FROM ingest_source WHERE path = ?)").run(tool, `${tool}-${thread}.jsonl`, `${tool}-${thread}.jsonl`);
      const source = (db.prepare("SELECT id FROM ingest_source WHERE path = ?").get(`${tool}-${thread}.jsonl`) as { id: number }).id;
      db.prepare(
        "INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error, source_id) VALUES (?, ?, ?, ?, 0, ?, 0, 0, 0, 0, 0, 'reported', 0, 0, ?)",
      ).run(`c${n}`, sid, iso(ts), model, tokens, source);
    },
    sample(tool, ts, kind, minutes, pct, resetsMs, plan = "plus") {
      const sid = `${tool}-s`;
      if (!sessions.has(sid)) {
        sessions.add(sid);
        db.prepare("INSERT INTO session (session_id, tool) VALUES (?, ?)").run(sid, tool);
      }
      db.prepare("INSERT INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type, limit_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)").run(tool, sid, iso(ts), kind, minutes, pct, Math.floor(resetsMs / 1000), plan);
    },
  };
}

/** Twelve finished five-hour windows in which 500,000 tokens moved the percent from 10 to 60: 10,000 tokens a point, every time. */
function pastWindows(w: World, until: number): void {
  for (let i = 0; i < 12; i += 1) {
    const reset = until - (i + 1) * 6 * H;
    const start = reset - 5 * H;
    w.sample("codex", start + 600_000, "primary", 300, 10, reset);
    w.call("codex", start + H, "gpt-5", 500_000);
    w.sample("codex", start + 4 * H, "primary", 300, 60, reset);
  }
}

describe("a plan window as the tool says it and as the Desk counts it", () => {
  it("shows the tool's own figure beside a local count and says when they agree", () => {
    const w = world();
    pastWindows(w, NOW - 3 * H);
    const reset = NOW + 2 * H; // the window running: it began three hours ago
    w.sample("codex", NOW - 3 * H + 600_000, "primary", 300, 5, reset);
    w.call("codex", NOW - 2 * H, "gpt-5", 400_000);
    w.sample("codex", NOW - 600_000, "primary", 300, 40, reset);
    const v = plansView(w.db, new Date(NOW));
    const win = v.windows.find((x) => x.windowMinutes === 300)!;
    expect(win).toMatchObject({ source: "official", toolLabel: "Codex", planType: "plus" });
    expect(win.official).toMatchObject({ usedPct: 40, minutesToReset: 120, ageMinutes: 10 });
    expect(win.local).toMatchObject({ tokensSoFar: 400_000, impliedPct: 40, agrees: true });
    expect(win.local!.note).toBe("400K tokens counted in this window would be about 40% on this plan's own history (40% to 40%): consistent with the tool's figure.");
  });

  it("says plainly when they differ and changes neither", () => {
    const w = world();
    pastWindows(w, NOW - 3 * H);
    const reset = NOW + 2 * H;
    w.sample("codex", NOW - 3 * H + 600_000, "primary", 300, 5, reset);
    w.call("codex", NOW - 2 * H, "gpt-5", 400_000);
    w.sample("codex", NOW - 600_000, "primary", 300, 70, reset); // another device is using the plan too
    const win = plansView(w.db, new Date(NOW)).windows.find((x) => x.windowMinutes === 300)!;
    expect(win.official!.usedPct).toBe(70);
    expect(win.local).toMatchObject({ tokensSoFar: 400_000, impliedPct: 40, agrees: false });
    expect(win.local!.note).toMatch(/against the tool's 70%\. The tool's figure includes other devices and other uses of the plan that leave no trace in these logs; neither is changed to fit the other\./);
  });

  it("counts only the tool's own provider's models against its plan", () => {
    const w = world();
    pastWindows(w, NOW - 3 * H);
    const reset = NOW + 2 * H;
    w.sample("codex", NOW - 3 * H + 600_000, "primary", 300, 5, reset);
    w.call("codex", NOW - 2 * H, "gpt-5", 100_000);
    w.call("codex", NOW - 2 * H + 1000, "claude-opus-5", 900_000); // routed elsewhere: not this plan's
    w.sample("codex", NOW - 600_000, "primary", 300, 15, reset);
    expect(plansView(w.db, new Date(NOW)).windows.find((x) => x.windowMinutes === 300)!.local!.tokensSoFar).toBe(100_000);
  });

  it("gives no percent from too little history, and still counts the tokens", () => {
    const w = world();
    const reset = NOW + 2 * H;
    w.sample("codex", NOW - 3 * H, "primary", 300, 5, reset);
    w.call("codex", NOW - 2 * H, "gpt-5", 300_000);
    w.sample("codex", NOW - 600_000, "primary", 300, 30, reset);
    const win = plansView(w.db, new Date(NOW)).windows[0]!;
    expect(win.local).toMatchObject({ tokensSoFar: 300_000, impliedPct: null, agrees: null });
    expect(win.local!.note).toMatch(/^300K tokens counted in this window so far\. No estimate of what that is as a percent: only 0 windows moved the percent by 10 points or more; at least 8 are needed\.$/);
  });

  it("carries the last hour's pace in a straight line when there is too little history for an outlook, and says that is all it is", () => {
    const w = world();
    const reset = NOW + 4 * H;
    w.sample("codex", NOW - 50 * 60_000, "primary", 300, 20, reset);
    w.sample("codex", NOW - 60_000, "primary", 300, 40, reset); // 20 points in 49 minutes
    const win = plansView(w.db, new Date(NOW)).windows[0]!;
    expect(win.outlook).toMatch(/^No forecast/);
    expect(win.linear).toMatchObject({ minutesToFull: 147, beforeReset: true });
    expect(win.linear!.note).toBe("Linear, no history: at the pace of the last 49 minutes (20 points) it would reach 100% in 147 minutes, before the reset in 240. That is a straight line, not a forecast.");
  });

  it("does not draw a line from a stale or flat reading, or one that has fallen", () => {
    const w = world();
    w.sample("codex", NOW - 50 * 60_000, "primary", 300, 40, NOW + 4 * H);
    w.sample("codex", NOW - 60_000, "primary", 300, 40, NOW + 4 * H);
    expect(plansView(w.db, new Date(NOW)).windows[0]!.linear).toBeNull();
  });
});

describe("a tool with no reading of its own", () => {
  it("is a local count with no percent, and says how to get the real figure", () => {
    const w = world();
    w.call("claude_code", NOW - H, "claude-opus-5", 2_000_000);
    w.call("claude_code", NOW - 7 * H, "claude-opus-5", 9_000_000); // outside five hours
    const v = plansView(w.db, new Date(NOW));
    expect(v.windows).toHaveLength(1);
    expect(v.windows[0]).toMatchObject({ source: "none", official: null, toolLabel: "Claude Code" });
    expect(v.windows[0]!.local!.note).toBe("2.0M tokens counted in the last five hours. There is no reading of Claude Code's own plan windows, so there is no percent and no outlook.");
    expect(v.notes[0]).toMatch(/desk statusline install/);
  });

  it("is not shown for a tool the ledger has no session of", () => {
    expect(plansView(world().db, new Date(NOW)).windows).toEqual([]);
    expect(renderPlans(plansView(world().db, new Date(NOW)))).toBe("No plan to show: the ledger holds no Claude Code or Codex session.");
  });
});

describe("events on a plan", () => {
  it("lists a window reaching its limit once, and a model change within an hour of it as possibly the plan's doing", () => {
    const w = world();
    const reset = NOW + 2 * H;
    w.sample("claude_code", NOW - 4 * H, "primary", 300, 80, reset);
    w.sample("claude_code", NOW - 3 * H, "primary", 300, 99.6, reset);
    w.sample("claude_code", NOW - 2 * H, "primary", 300, 100, reset); // the same window again: not a second hit
    w.call("claude_code", NOW - 3 * H - 600_000, "claude-opus-5", 10);
    w.call("claude_code", NOW - 3 * H + 1_200_000, "claude-sonnet-5-5", 10); // twenty minutes after the hit
    w.call("claude_code", NOW - 10 * H, "claude-sonnet-5-5", 10);
    w.call("claude_code", NOW - 9 * H, "claude-opus-5", 10); // a change with no limit near it
    w.call("claude_code", NOW - 8 * H, "<synthetic>", 0); // an error placeholder is not a model
    w.call("claude_code", NOW - 7 * H, "claude-opus-5", 10);
    const v = plansView(w.db, new Date(NOW));
    expect(v.events.filter((e) => e.kind === "limit_hit")).toHaveLength(1);
    expect(v.events[0]!).toMatchObject({ kind: "model_switch", afterLimitHit: true });
    expect(v.events[0]!.detail).toBe("claude-opus-5 to claude-sonnet-5-5, within an hour of a limit hit (the logs do not say why)");
    const plain = v.events.filter((e) => e.kind === "model_switch" && !e.afterLimitHit);
    expect(plain.map((e) => e.detail)).toEqual(["claude-sonnet-5-5 to claude-opus-5"]);
    expect(v.events.some((e) => e.detail.includes("<synthetic>"))).toBe(false);
  });

  it("looks back fourteen days and no further, and filters by tool", () => {
    const w = world();
    w.call("codex", NOW - 20 * 24 * H, "gpt-5", 1);
    w.call("codex", NOW - 19 * 24 * H, "gpt-5-mini", 1);
    w.call("claude_code", NOW - 2 * 24 * H, "claude-opus-5", 1);
    w.call("claude_code", NOW - 24 * H, "claude-sonnet-5-5", 1);
    const v = plansView(w.db, new Date(NOW));
    expect(v.events).toHaveLength(1);
    expect(v.events[0]!.tool).toBe("claude_code");
    expect(plansView(w.db, new Date(NOW), { tool: "codex" }).events).toEqual([]);
    expect(plansView(w.db, new Date(NOW), { days: 30 }).events).toHaveLength(2);
  });

  it("prints a quiet fortnight as quiet", () => {
    const w = world();
    w.call("claude_code", NOW - H, "claude-opus-5", 10);
    expect(renderPlans(plansView(w.db, new Date(NOW)))).toContain("No window reached its limit and no model changed in the calls the Desk holds.");
  });
});
