import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import type { PlansView, PlanWindow } from "../../src/desk/limits/plans.ts";
import { quotaHistory, quotaNext, quotaRelease, quotaStatus } from "../../src/desk/quota/command.ts";
import { DEFAULT_POLICY, headroomOf, mayMove, pressed, recommend, type OwnedPlan } from "../../src/desk/quota/router.ts";
import { dispatches, heldReserves, inferPlans, logDispatch, plansFor, PlansFileError, readPlansFile, releaseDispatch } from "../../src/desk/quota/store.ts";

/**
 * The quota-aware plan router (DF-091). The cases are the situations a person with more than one plan is in: plenty of room, a window about to fill, the other plan also
 * full, a plan that reports nothing, a second account at the same vendor, and an API key paid by the token. The router has to move work only where it may, say why, and never
 * make a figure up.
 */
const claude: OwnedPlan = { id: "claude_code", tool: "claude_code", vendor: "anthropic", account: "owner", kind: "subscription", label: "Claude Code" };
const codex: OwnedPlan = { id: "codex", tool: "codex", vendor: "openai", account: "owner", kind: "subscription", label: "Codex" };
const apiKey: OwnedPlan = { id: "anthropic-api", tool: "anthropic-api", vendor: "anthropic", account: "owner", kind: "api_key", label: "Anthropic API key" };
const secondClaude: OwnedPlan = { id: "claude_code_2", tool: "claude_code_2", vendor: "anthropic", account: "someone-else", kind: "subscription", label: "Second Claude account" };

function win(tool: string, usedPct: number, o: { reset?: number; toFull?: number | null; perPct?: number | null; state?: string; age?: number; minutes?: number } = {}): PlanWindow {
  return {
    tool, toolLabel: tool, planType: "pro", windowMinutes: o.minutes ?? 300, label: o.minutes === 10_080 ? "weekly window" : "five-hour window", source: "official",
    official: { usedPct, resetsAt: "2026-10-25T18:00:00Z", minutesToReset: o.reset ?? 120, ageMinutes: o.age ?? 2, state: (o.state ?? "ok") as never, head: "" },
    local: null, outlook: "", linear: null,
    numbers: { verdict: null, minutesToFull: o.toFull ?? null, tokensPerPercent: o.perPct ?? null },
  };
}
const view = (...windows: PlanWindow[]): PlansView => ({ windows, events: [], notes: [] });

describe("how much room a plan has", () => {
  it("is read from the tightest window the tool reports, not the first", () => {
    const h = headroomOf(claude, view(win("claude_code", 40), win("claude_code", 97, { minutes: 10_080 })));
    expect(h).toMatchObject({ known: true, remainingPct: 3, binding: "weekly window" });
  });

  it("says nothing about a plan whose tool reports no window, and does not invent a figure", () => {
    const h = headroomOf(codex, view(win("claude_code", 10)));
    expect(h.known).toBe(false);
    expect(h.remainingPct).toBeNull();
    expect(h.notes[0]).toContain("reports no plan window of its own");
  });

  it("has no window to fill for an API key, which is paid by the token", () => {
    const h = headroomOf(apiKey, view());
    expect(h).toMatchObject({ known: true, perToken: true, remainingPct: null });
  });

  it("turns the share that is left into tokens only when the plan's history gives a rate", () => {
    expect(headroomOf(claude, view(win("claude_code", 90, { perPct: 10_000 }))).remainingTokens).toBe(100_000);
    expect(headroomOf(claude, view(win("claude_code", 90))).remainingTokens).toBeNull();
  });

  it("marks an old reading as stale and does not press on it", () => {
    const h = headroomOf(claude, view(win("claude_code", 99, { state: "stale", age: 400 })));
    expect(h.stale).toBe(true);
    expect(pressed(h, DEFAULT_POLICY).yes).toBe(false);
  });
});

describe("when a plan is close to a limit", () => {
  const p = DEFAULT_POLICY;
  it.each([
    ["5% left", win("claude_code", 95), true],
    ["more than 5% left", win("claude_code", 94), false],
    ["full in 14 minutes at the last hour's pace", win("claude_code", 60, { toFull: 14 }), true],
    ["full in 15 minutes", win("claude_code", 60, { toFull: 15 }), false],
    ["under the tokens kept for a handoff", win("claude_code", 85, { perPct: 1_000 }), true],
    ["exactly the tokens kept for a handoff", win("claude_code", 80, { perPct: 1_000 }), false],
  ])("%s", (_name, w, yes) => {
    expect(pressed(headroomOf(claude, view(w)), p).yes).toBe(yes);
  });
});

describe("where work may move", () => {
  it("allows another vendor, and the same account's own API key", () => {
    expect(mayMove(claude, codex).ok).toBe(true);
    expect(mayMove(claude, apiKey).ok).toBe(true);
  });
  it("refuses another account at the same vendor, and the plan it is on", () => {
    expect(mayMove(claude, secondClaude)).toMatchObject({ ok: false });
    expect(mayMove(claude, secondClaude).why).toContain("another account at anthropic");
    expect(mayMove(claude, claude).ok).toBe(false);
  });
});

describe("the recommendation", () => {
  const plans = [claude, codex];
  it("stays when there is room", () => {
    const r = recommend({ from: "claude_code", plans, view: view(win("claude_code", 40, { toFull: 200 }), win("codex", 20)) });
    expect(r).toMatchObject({ action: "stay", code: "ok", checkpoint: false });
    expect(r.reasons[0]).toContain("60% of its five-hour window left");
  });

  it("routes to the owner's second tool when the first reaches 95% of its five-hour window, and says to write a handoff", () => {
    const r = recommend({ from: "claude_code", plans, view: view(win("claude_code", 95), win("codex", 30)) });
    expect(r).toMatchObject({ action: "route", to: "codex", code: "route", checkpoint: true, reserveTokens: 20_000, costsMoney: false });
    expect(r.reasons.join(" ")).toContain("Codex has 70% of its five-hour window left");
  });

  it("routes when the window would fill within fifteen minutes even with room left", () => {
    const r = recommend({ from: "claude_code", plans, view: view(win("claude_code", 50, { toFull: 10 }), win("codex", 30)) });
    expect(r.action).toBe("route");
    expect(r.reasons.join(" ")).toContain("would fill in 10 minutes");
  });

  it("prefers the plan with more room", () => {
    const three = [claude, codex, { ...codex, id: "codex2", tool: "codex2", vendor: "google", label: "Gemini" }];
    const r = recommend({ from: "claude_code", plans: three, view: view(win("claude_code", 96), win("codex", 60), win("codex2", 20)) });
    expect(r.to).toBe("codex2");
  });

  it("does not choose a plan that is itself close to a limit, and says why", () => {
    const r = recommend({ from: "claude_code", plans, view: view(win("claude_code", 96, { reset: 30 }), win("codex", 97, { reset: 600 })) });
    expect(r.action).toBe("wait");
    expect(r.refused[0]).toMatchObject({ plan: "codex" });
    expect(r.refused[0]!.why).toContain("3% of its five-hour window left");
  });

  it("does not choose a plan whose reading is old, or that reports nothing", () => {
    const stale = recommend({ from: "claude_code", plans, view: view(win("claude_code", 96, { reset: 30 }), win("codex", 10, { state: "stale", age: 600 })) });
    expect(stale.refused[0]!.why).toContain("too old");
    expect(stale.action).toBe("wait");
    const none = recommend({ from: "claude_code", plans, view: view(win("claude_code", 96, { reset: 30 })) });
    expect(none.refused[0]!.why).toContain("reports no plan window of its own");
  });

  it("never moves work to another account at the same vendor, even with nothing else free", () => {
    const r = recommend({ from: "claude_code", plans: [claude, secondClaude], view: view(win("claude_code", 97, { reset: 45 }), win("claude_code_2", 5)) });
    expect(r.action).toBe("wait");
    expect(r.to).toBeNull();
    expect(r.refused).toEqual([{ plan: "claude_code_2", why: expect.stringContaining("another account at anthropic") }]);
  });

  it("allows the same account's own API key, says it costs money, and prefers a fixed-price plan over it", () => {
    const keyOnly = recommend({ from: "claude_code", plans: [claude, apiKey], view: view(win("claude_code", 97)) });
    expect(keyOnly).toMatchObject({ action: "route", to: "anthropic-api", costsMoney: true });
    expect(keyOnly.reasons.join(" ")).toContain("costs money");
    const both = recommend({ from: "claude_code", plans: [claude, apiKey, codex], view: view(win("claude_code", 97), win("codex", 90)) });
    expect(both.to).toBe("codex");
  });

  it("waits for the reset when nothing else has room and the reset is within a day", () => {
    const r = recommend({ from: "claude_code", plans, view: view(win("claude_code", 97, { reset: 95 }), win("codex", 99, { reset: 300 })) });
    expect(r).toMatchObject({ action: "wait", code: "wait_for_reset", waitMinutes: 95, checkpoint: true });
  });

  it("refuses with quota_runway_depleted when nothing has room and the reset is more than a day away", () => {
    const r = recommend({ from: "claude_code", plans, view: view(win("claude_code", 99, { reset: 3 * 24 * 60 }), win("codex", 99)) });
    expect(r).toMatchObject({ action: "refuse", code: "quota_runway_depleted", checkpoint: true });
  });

  it("stays, and says why, when the plan the work is on reports nothing", () => {
    const r = recommend({ from: "codex", plans, view: view(win("claude_code", 99)) });
    expect(r).toMatchObject({ action: "stay", code: "no_reading", checkpoint: false });
    expect(r.reasons[0]).toContain("nothing to move work on");
  });

  it("refuses a plan it was not told about", () => {
    const r = recommend({ from: "gemini", plans, view: view() });
    expect(r.action).toBe("refuse");
    expect(r.reasons[0]).toContain("is not one of the plans listed (claude_code, codex)");
  });

  it("follows a different policy when the owner sets one", () => {
    const r = recommend({ from: "claude_code", plans, view: view(win("claude_code", 85), win("codex", 10)), policy: { failoverMinutes: 15, failoverRemainingPct: 20, reserveTokens: 0 } });
    expect(r.action).toBe("route");
  });

  it("is the same for the same input", () => {
    const v = view(win("claude_code", 96), win("codex", 40));
    expect(JSON.stringify(recommend({ from: "claude_code", plans, view: v }))).toBe(JSON.stringify(recommend({ from: "claude_code", plans, view: v })));
  });
});

describe("the log and the reserve", () => {
  let db: Ledger;
  beforeAll(() => {
    db = openLedger(":memory:");
  });
  afterAll(() => db.close());
  const plans = [claude, codex];

  it("holds a reserve for a move and none for staying, and releases it once", () => {
    const stay = logDispatch(db, recommend({ from: "claude_code", plans, view: view(win("claude_code", 10), win("codex", 10)) }), "2026-10-25T10:00:00Z", null);
    const move = logDispatch(db, recommend({ from: "claude_code", plans, view: view(win("claude_code", 97), win("codex", 10)) }), "2026-10-25T10:05:00Z", "refactor");
    expect(heldReserves(db).get("claude_code")).toBe(20_000);
    expect(releaseDispatch(db, stay, "2026-10-25T10:10:00Z")).toBe(false);
    expect(releaseDispatch(db, move, "2026-10-25T10:10:00Z")).toBe(true);
    expect(releaseDispatch(db, move, "2026-10-25T10:11:00Z")).toBe(false);
    expect(heldReserves(db).size).toBe(0);
    const log = dispatches(db);
    expect(log.map((d) => d.action)).toEqual(["route", "stay"]);
    expect(log[0]).toMatchObject({ from: "claude_code", to: "codex", checkpoint: true, task: "refactor", releasedAt: "2026-10-25T10:10:00Z" });
  });

  it("rejects an action the table does not know", () => {
    expect(() => db.prepare("INSERT INTO route_dispatch (decided_at, from_plan, action, reasons, reserve_tokens, checkpoint) VALUES ('t', 'x', 'drop', '[]', 0, 0)").run()).toThrow();
  });
});

describe("the plans the router may use", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "desk-quota-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("are one subscription for each tool with sessions, and a file adds to them and replaces by id", () => {
    const db = openLedger(":memory:");
    db.prepare("INSERT INTO session (session_id, tool) VALUES ('a', 'claude_code'), ('b', 'codex'), ('c', 'opencode')").run();
    expect(inferPlans(db).map((p) => p.id)).toEqual(["claude_code", "codex"]);
    const file = join(dir, "plans.json");
    writeFileSync(file, JSON.stringify({ plans: [{ id: "codex", tool: "codex", vendor: "openai", account: "work", kind: "subscription", label: "Codex (work)" }, { id: "key", tool: "key", vendor: "anthropic", account: "owner", kind: "api_key", label: "API key" }] }));
    const all = plansFor(db, file);
    expect(all.map((p) => p.id)).toEqual(["claude_code", "codex", "key"]);
    expect(all.find((p) => p.id === "codex")!.account).toBe("work");
    expect(plansFor(db, join(dir, "absent.json")).map((p) => p.id)).toEqual(["claude_code", "codex"]);
    db.close();
  });

  it("say which field is wrong in a file that is not valid", () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(() => readPlansFile(bad)).toThrow(PlansFileError);
    writeFileSync(bad, JSON.stringify({ plans: [{ id: "x", tool: "t", vendor: "v", account: "a", kind: "free", label: "L" }] }));
    expect(() => readPlansFile(bad)).toThrow(/plan 1 needs "kind"/);
    writeFileSync(bad, JSON.stringify({ plans: [{ id: "x", tool: "t", vendor: "", account: "a", kind: "subscription", label: "L" }] }));
    expect(() => readPlansFile(bad)).toThrow(/needs a non-empty "vendor"/);
    writeFileSync(bad, JSON.stringify({ nope: [] }));
    expect(() => readPlansFile(bad)).toThrow(/must hold/);
  });
});

describe("from a ledger with readings", () => {
  const NOW = new Date("2026-10-24T12:00:00.000Z");
  const iso = (ms: number): string => new Date(ms).toISOString();
  let db: Ledger;
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "desk-quota-ledger-"));
    db = openLedger(":memory:");
    for (const [tool, pct, resetMin] of [["claude_code", 97, 40], ["codex", 30, 180]] as const) {
      db.prepare("INSERT INTO session (session_id, tool) VALUES (?, ?)").run(`${tool}-s`, tool);
      const resets = Math.floor((NOW.getTime() + resetMin * 60_000) / 1000);
      for (const [back, p] of [[60, pct - 8], [30, pct - 4], [5, pct]] as const) {
        db.prepare("INSERT INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type, limit_id) VALUES (?, ?, ?, 'primary', 300, ?, ?, 'pro', NULL)").run(tool, `${tool}-s`, iso(NOW.getTime() - back * 60_000), p, resets);
      }
    }
  });
  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("shows each plan's room and, for the one close to a limit, where to go", () => {
    const s = quotaStatus({ db, now: NOW, plansFile: null });
    expect(s.text).toContain("Claude Code (claude_code): 3% left");
    expect(s.text).toContain("Codex (codex): 70% left");
    expect(s.text).toContain("<- close to a limit");
    expect(s.text).toContain("Move the next task from Claude Code to Codex.");
  });

  it("decides, writes a handoff, holds the reserve, logs it, and releases it", () => {
    const r = quotaNext({ db, now: NOW, plansFile: null, from: "claude_code", task: "refactor", dryRun: false, handoffDir: dir });
    expect(r.recommendation).toMatchObject({ action: "route", to: "codex" });
    expect(r.dispatchId).not.toBeNull();
    expect(existsSync(r.handoff!)).toBe(true);
    const handoff = readFileSync(r.handoff!, "utf8");
    expect(handoff).toContain("Claude Code is close to a limit");
    expect(handoff).toContain("Continue on Codex.");
    expect(heldReserves(db).get("claude_code")).toBe(20_000);
    expect(quotaStatus({ db, now: NOW, plansFile: null }).text).toContain("20,000 tokens held back for a handoff");
    expect(quotaHistory({ db, days: 7, now: NOW })).toContain("route  claude_code -> codex");
    expect(quotaRelease({ db, id: r.dispatchId!, now: NOW })).toContain("Released");
    expect(quotaRelease({ db, id: r.dispatchId!, now: NOW })).toContain("holds nothing to release");
  });

  it("writes and logs nothing on a dry run, and logs nothing for a plan it does not know", () => {
    const before = dispatches(db).length;
    const dry = quotaNext({ db, now: NOW, plansFile: null, from: "claude_code", task: null, dryRun: true, handoffDir: dir });
    expect(dry.dispatchId).toBeNull();
    expect(dry.text).toContain("Dry run");
    const unknown = quotaNext({ db, now: NOW, plansFile: null, from: "nope", task: null, dryRun: false, handoffDir: dir });
    expect(unknown.recommendation.action).toBe("refuse");
    expect(dispatches(db).length).toBe(before);
  });

  it("says plainly that a ledger with no sessions has no plans to read", () => {
    const empty = openLedger(":memory:");
    expect(quotaStatus({ db: empty, now: NOW, plansFile: null }).text).toContain("No plans to read");
    empty.close();
  });
});
