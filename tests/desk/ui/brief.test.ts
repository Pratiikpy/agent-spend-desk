import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GateLedger } from "../../../src/desk/gate/ledger.ts";
import { ensureGateSchema } from "../../../src/desk/gate/schema.ts";
import { openLedger, type Ledger } from "../../../src/desk/ledger/db.ts";
import { recomputeCosts, recordSnapshot } from "../../../src/desk/ledger/ingest.ts";
import { chooseAction } from "../../../src/desk/ui/queries.ts";
import { startUiServer, type UiServer } from "../../../src/desk/ui/server.ts";
import { testSnapshot } from "../helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const TOKEN = ["ui", "launch", "token", "for", "tests", "0123456789abcdef"].join("-");
const NOW = Date.parse("2026-10-26T07:00:00.000Z");

let work: string;

interface Seed {
  session: string;
  ts: string;
  project?: string;
  model?: string;
  output: number;
  state?: "kept" | "merged" | "committed" | "reverted" | "unlinked";
}

function ledgerAt(path: string, seeds: Seed[]): void {
  const db: Ledger = openLedger(path);
  const seen = new Set<string>();
  let n = 0;
  for (const s of seeds) {
    if (!seen.has(s.session)) {
      seen.add(s.session);
      db.prepare("INSERT INTO session (session_id, tool, project_path, git_branch, started_at, ended_at, tool_version) VALUES (?, 'claude_code', ?, 'main', ?, ?, '1')").run(s.session, s.project ?? "D:/work/shop", s.ts, s.ts);
      if (s.state) db.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, ?, 'high', 1, 't')").run(s.session, s.state);
    }
    n += 1;
    db.prepare(
      "INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES (?, ?, ?, ?, 0, 0, ?, 0, 0, 0, 0, 'reported', 0, 0)",
    ).run(`c${n}`, s.session, s.ts, s.model ?? "claude-opus-5", s.output);
  }
  recordSnapshot(db, testSnapshot());
  recomputeCosts(db, testSnapshot(), new Set(Array.from({ length: n }, (_, i) => `c${i + 1}`)), { unpricedCalls: 0, unpricedModels: {} });
  db.close();
}

// Opus 5 output is $25 per million tokens: 100,000 tokens are $2.50.
const CALLS: Seed[] = [
  { session: "a", ts: "2026-10-24T20:00:00.000Z", output: 100_000, state: "kept" }, // $2.50: 1:30 on the 25th in Kolkata
  { session: "b", ts: "2026-10-25T03:00:00.000Z", output: 200_000, state: "merged", project: "D:/work/api" }, // $5.00
  { session: "c", ts: "2026-10-25T20:00:00.000Z", output: 40_000, model: "claude-sonnet-5-5" }, // $0.40 at $10 per million: 01:30 on the 26th in Kolkata
];

const common = (extra: Record<string, unknown> = {}) => ({
  pricesPath: PRICES,
  policiesDir: "policies",
  port: 0,
  token: TOKEN,
  env: {},
  mode: "own_logs" as const,
  nowMs: () => NOW,
  dossierDbPath: null,
  gateDbPath: null,
  canaryRunsPath: join(work, "none.jsonl"),
  extra: { dossiersDir: join(work, "none"), pendingDir: join(work, "none"), memoryDir: join(work, "none") },
  ...extra,
});

const servers: UiServer[] = [];
async function serve(ledger: string, extra: Record<string, unknown> = {}): Promise<UiServer> {
  const s = await startUiServer({ ...common(extra), ledgerPath: ledger });
  servers.push(s);
  return s;
}
const get = async (s: UiServer, path: string): Promise<{ status: number; body: Record<string, any> }> => {
  const res = await fetch(`${s.origin}${path}`, { headers: { "x-desk-token": TOKEN } });
  return { status: res.status, body: JSON.parse(await res.text()) as Record<string, any> };
};
const brief = async (s: UiServer, day?: string): Promise<Record<string, any>> => (await get(s, `/api/brief${day ? `?day=${day}` : ""}`)).body;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "desk-brief-"));
  ledgerAt(join(work, "main.db"), CALLS);
});
afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  rmSync(work, { recursive: true, force: true });
});

describe("the brief is about yesterday in the owner's own zone", () => {
  it("in UTC, yesterday is the 25th: the call at 03:00 and the one at 20:00", async () => {
    const d = await brief(await serve(join(work, "main.db"), { timeZone: "UTC" }));
    expect(d.day).toBe("2026-10-25");
    expect(d.window).toEqual({ from: "2026-10-25T00:00:00.000Z", to: "2026-10-25T23:59:59.999Z" });
    expect(d.spend.estimatedMicros).toBe(5_000_000 + 400_000);
    expect(d.noCallOn).toBeNull();
  });

  it("in Kolkata, yesterday started at 18:30 UTC on the 24th, so the evening call of the 24th belongs to it and the evening call of the 25th does not", async () => {
    const d = await brief(await serve(join(work, "main.db"), { timeZone: "Asia/Kolkata" }));
    expect(d.day).toBe("2026-10-25");
    expect(d.window).toEqual({ from: "2026-10-24T18:30:00.000Z", to: "2026-10-25T18:29:59.999Z" }); // the end is the last millisecond of the day
    expect(d.spend.estimatedMicros).toBe(2_500_000 + 5_000_000);
  });

  it("in Los Angeles, now is midnight on the 26th, so yesterday is the 25th from 07:00 UTC: only the evening call", async () => {
    const d = await brief(await serve(join(work, "main.db"), { timeZone: "America/Los_Angeles" }));
    expect(d.day).toBe("2026-10-25");
    expect(d.window.from).toBe("2026-10-25T07:00:00.000Z");
    expect(d.spend.estimatedMicros).toBe(400_000);
  });

  it("says so when yesterday has no call, and briefs the last day that has one", async () => {
    const s = await serve(join(work, "main.db"), { timeZone: "UTC", nowMs: () => Date.parse("2026-10-29T10:00:00Z") });
    const d = await brief(s);
    expect(d.noCallOn).toBe("2026-10-28");
    expect(d.day).toBe("2026-10-25");
    expect(d.dayIsToday).toBe(false);
  });

  it("says the day is not finished when the only calls are from today", async () => {
    const path = join(work, "today.db");
    ledgerAt(path, [{ session: "t", ts: "2026-10-26T01:00:00.000Z", output: 100_000 }]);
    const d = await brief(await serve(path, { timeZone: "UTC" }));
    expect(d.day).toBe("2026-10-26");
    expect(d.noCallOn).toBe("2026-10-25");
    expect(d.dayIsToday).toBe(true);
  });

  it("steps through days with calls, in the owner's zone, and shows a day asked for as asked", async () => {
    const s = await serve(join(work, "main.db"), { timeZone: "UTC" });
    const first = await brief(s, "2026-10-24");
    expect(first).toMatchObject({ day: "2026-10-24", earlierDay: null, laterDay: "2026-10-25", spend: { estimatedMicros: 2_500_000 } });
    const mid = await brief(s, "2026-10-25");
    expect(mid).toMatchObject({ earlierDay: "2026-10-24", laterDay: null });
    const none = await brief(s, "2026-10-27");
    expect(none).toMatchObject({ day: "2026-10-27", noCallOn: "2026-10-27", spend: { estimatedMicros: 0 }, earlierDay: "2026-10-25" });
    expect((await get(s, "/api/brief?day=24-10-2026")).status).toBe(400);
    expect((await get(s, "/api/brief?day=2026-02-30")).status).toBe(400);
  });
});

describe("every figure on the brief can be reproduced from the rows behind it", () => {
  it("spend, each landing state, each project and each model add up from the sessions its link opens", async () => {
    const s = await serve(join(work, "main.db"), { timeZone: "UTC" });
    const d = await brief(s);
    const rows = async (q: string): Promise<Record<string, any>> => (await get(s, `/api/sessions?from=${encodeURIComponent(d.window.from)}&to=${encodeURIComponent(d.window.to)}&limit=200${q}`)).body;
    const all = await rows("");
    expect(all.spendMicros).toBe(d.spend.estimatedMicros);
    expect(all.rows.reduce((t: number, r: { micros: number }) => t + r.micros, 0)).toBe(d.spend.estimatedMicros);
    for (const r of d.landing.rows as { state: string; micros: number; sessions: number }[]) {
      const sub = await rows(`&state=${r.state}`);
      expect({ state: r.state, micros: sub.spendMicros, sessions: sub.total }).toEqual({ state: r.state, micros: r.micros, sessions: r.sessions });
    }
    const landed = await rows("&state=landed");
    expect(landed.spendMicros).toBe(5_000_000);
    for (const p of d.projects as { project: string; micros: number }[]) expect((await rows(`&project=${encodeURIComponent(p.project)}`)).spendMicros).toBe(p.micros);
    for (const m of d.models as { model: string; micros: number; calls: number }[]) {
      const sub = await rows(`&model=${encodeURIComponent(m.model)}`);
      expect(sub.spendMicros).toBe(m.micros);
      expect(sub.rows.reduce((t: number, r: { calls: number }) => t + r.calls, 0)).toBe(m.calls);
    }
  });

  it("refuses a malformed narrowing instead of ignoring it", async () => {
    const s = await serve(join(work, "main.db"), { timeZone: "UTC" });
    for (const bad of ["from=yesterday&to=today", "from=2026-10-25T00:00:00Z", "state=winning", "project=" + "x".repeat(300)]) expect((await get(s, `/api/sessions?${bad}`)).status).toBe(400);
    const nothing = await get(s, "/api/sessions?project=no-such-project&from=2026-10-25T00:00:00Z&to=2026-10-26T00:00:00Z");
    expect(nothing.body).toMatchObject({ total: 0, spendMicros: 0, rows: [] });
  });
});

describe("what the gate did while the owner was away", () => {
  it("says the gate is not running when there is no gate database, which is not the same as a quiet night", async () => {
    const d = await brief(await serve(join(work, "main.db"), { timeZone: "UTC" }));
    expect(d.gate.state).toBe("not_read");
    expect(d.gate.note).toMatch(/not running here/);
  });

  it("counts the night's denials, pauses and approvals asked for, shows the latest first, and leaves out other days", async () => {
    const gatePath = join(work, "gate.db");
    const gdb = new DatabaseSync(gatePath);
    ensureGateSchema(gdb);
    let t = Date.parse("2026-10-24T23:00:00Z"); // the night before the briefed day: not counted
    const led = new GateLedger(gdb, () => t);
    const put = (at: string, input: Parameters<GateLedger["append"]>[0]): number => {
      t = Date.parse(at);
      return led.tx(() => led.append(input)).id;
    };
    put("2026-10-24T23:00:00Z", { kind: "denied", project: "D:/work/shop", reason_code: "cap", reason: "the day's cap was reached" });
    put("2026-10-25T01:00:00Z", { kind: "denied", project: "D:/work/shop", model: "claude-opus-5", reason_code: "cap", reason: "the day's cap was reached" });
    put("2026-10-25T02:00:00Z", { kind: "denied", project: "D:/work/api", tool: "Bash", reason_code: "loop", reason: "the same failing command a third time" });
    put("2026-10-25T03:00:00Z", { kind: "paused", project: "D:/work/api", reason_code: "loop", reason: "paused with a checkpoint" });
    const asked1 = put("2026-10-25T04:00:00Z", { kind: "asked", project: "D:/work/shop", reason_code: "ask", reason: "over 80% of the day's cap" });
    put("2026-10-25T05:00:00Z", { kind: "asked", project: "D:/work/shop", reason_code: "ask", reason: "over 80% of the day's cap" });
    put("2026-10-25T04:05:00Z", { kind: "approved", approval_id: asked1, reason_code: "approved", reason: "approved by owner" });
    put("2026-10-25T06:00:00Z", { kind: "settled", amount_micros: 1_000_000 }); // not an event the brief reports
    gdb.close();
    const d = await brief(await serve(join(work, "main.db"), { timeZone: "UTC", gateDbPath: gatePath, nowMs: () => Date.parse("2026-10-26T08:00:00Z") }));
    expect(d.gate.state).toBe("ok");
    expect(d.gate.counts).toMatchObject({ denied: 2, paused: 1, asked: 2 });
    expect(d.gate.total).toBe(5);
    expect(d.gate.line).toBe("2 requests denied, 1 sessions paused, 2 approvals asked for.");
    expect(d.gate.events[0].kind).toBe("asked"); // the newest first (id order)
    const asked = (d.gate.events as { kind: string; answered: boolean | null }[]).filter((e) => e.kind === "asked");
    expect(asked.map((e) => e.answered).sort()).toEqual([false, true]);
    expect(JSON.stringify(d.gate)).not.toContain("the day's cap was reached\"," + "\"" + "x"); // reasons are code-written lines, kept whole or dropped
  });

  it("says a quiet night was quiet", async () => {
    const gatePath = join(work, "quiet-gate.db");
    const gdb = new DatabaseSync(gatePath);
    ensureGateSchema(gdb);
    gdb.close();
    const d = await brief(await serve(join(work, "main.db"), { timeZone: "UTC", gateDbPath: gatePath }));
    expect(d.gate).toMatchObject({ state: "ok", total: 0, line: "The gate denied nothing, paused nothing and asked for nothing." });
  });
});

describe("the canary card and the one recommended action", () => {
  it("shows the verdict as of the briefed day and says when it changed and when the canary has stopped", async () => {
    const runs = join(work, "canary", "runs.jsonl");
    mkdirSync(join(work, "canary"), { recursive: true });
    // The sample scenario's runs are dated 2026-09-30 to 2026-10-29; its model was switched on purpose partway through. The file is used as it
    // is: its rows carry the harness's first name, which is read as the current one, so the verdicts do not depend on which compiler runs the test.
    copyFileSync("data/sample/canary/runs.jsonl", runs);
    const s = await serve(join(work, "main.db"), { timeZone: "UTC", canaryRunsPath: runs, nowMs: () => Date.parse("2026-10-30T10:00:00Z") });
    const late = (await brief(s, "2026-10-29")).canary;
    expect(late).toMatchObject({ state: "ok", verdict: "regressed", date: "2026-10-29", notRunning: false });
    const early = (await brief(s, "2026-10-05")).canary;
    expect(early).toMatchObject({ state: "ok", verdict: "inconclusive" });
    expect(early.eligibleFrom).toMatch(/^2026-/); // too young to call, with the date a call becomes possible
    // Walk the sample's days until the verdict first becomes regressed: that day, and only that day, is a change.
    const changed: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      const date = new Date(Date.parse("2026-09-30T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
      const c = (await brief(s, date)).canary;
      if (c.state === "ok" && c.changed) changed.push(`${date} ${c.previous.verdict}->${c.verdict}`);
    }
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.some((x) => x.endsWith("->regressed"))).toBe(true);
    // A week after the last run, the canary is not running.
    const later = await serve(join(work, "main.db"), { timeZone: "UTC", canaryRunsPath: runs, nowMs: () => Date.parse("2026-11-12T10:00:00Z") });
    const stopped = (await brief(later, "2026-11-11")).canary;
    expect(stopped).toMatchObject({ notRunning: true, lastRun: "2026-10-29" });
    expect(stopped.daysSinceRun).toBeGreaterThanOrEqual(3);
  });

  const FIX = (over: Record<string, unknown> = {}) => ({ cause: "idle", fix: "Close idle sessions", basis: "own_history", addressableMicros: 12_000_000, interval: { lowMicros: 5_000_000, highMicros: 20_000_000 }, windowsUsed: 9, note: "n", ...over });
  const CARD = (over: Record<string, unknown> = {}) => ({ state: "ok" as const, verdict: "steady" as const, words: "Steady", because: "no change", day: 20, changed: false, previous: { verdict: "steady" as const, words: "Steady" }, ...over });

  it("recommends a regressed canary first, then the largest measured saving, and otherwise nothing, with the reason", () => {
    const regressed = chooseAction(CARD({ verdict: "regressed", words: "Regressed", changed: true, previous: { verdict: "steady", words: "Steady" } }) as never, FIX());
    expect(regressed.action).toMatchObject({ kind: "canary", screen: "canary" });
    expect((regressed.action as { title: string }).title).toMatch(/regressed/);
    const platform = chooseAction(CARD({ verdict: "harness_or_platform", words: "x", changed: true }) as never, null);
    expect((platform.action as { title: string }).title).toMatch(/platform or the harness moved/);
    // A canary that was already regressed yesterday is not news today: the saving is the action.
    expect(chooseAction(CARD({ verdict: "regressed", changed: false }) as never, FIX()).action).toMatchObject({ kind: "fix", cause: "idle" });
    expect(chooseAction({ state: "none", reason: "x" }, FIX()).action).toMatchObject({ kind: "fix" });

    const heuristic = chooseAction(CARD() as never, FIX({ basis: "heuristic_estimate", interval: null }));
    expect(heuristic.action).toBeNull();
    expect(heuristic.why).toMatch(/upper bound with too little of your own history behind it, so it is not recommended yet/);
    const small = chooseAction(CARD() as never, FIX({ addressableMicros: 400_000 }));
    expect(small.action).toBeNull();
    expect(small.why).toMatch(/under \$1\.00 a window/);
    const nothing = chooseAction(CARD() as never, null);
    expect(nothing).toEqual({ action: null, why: "No cause is large enough to call out a fix." });
  });
});

describe("a source that has not been read lately is said to be stale", () => {
  it("shows when each source was last read and flags one that is more than a day and a half old", async () => {
    const path = join(work, "stale.db");
    ledgerAt(path, [{ session: "s", ts: "2026-10-25T10:00:00.000Z", output: 100_000 }]);
    const db = openLedger(path);
    const run = db.prepare("INSERT INTO ingest_run (kind, started_at, finished_at, files, lines_read, calls_new, calls_merged, malformed_lines, truncated_tails, usage_conflicts) VALUES (?, ?, ?, 1, 1, 0, 0, 0, 0, 0)");
    run.run("claude_code", "2026-10-23T23:59:00.000Z", "2026-10-24T00:00:00.000Z");
    run.run("claude_code", "2026-10-24T00:01:00.000Z", "2026-10-24T00:02:00.000Z"); // nothing new in it: still the last time it was read
    run.run("codex", "2026-10-26T05:59:00.000Z", "2026-10-26T06:00:00.000Z");
    db.close();
    const d = await brief(await serve(path, { timeZone: "UTC" }));
    const byId = Object.fromEntries((d.sources as { id: string; stale: boolean; ageHours: number }[]).map((x) => [x.id, x]));
    expect(byId["claude_code"]).toMatchObject({ stale: true, ageHours: 55 });
    expect(byId["codex"]).toMatchObject({ stale: false, ageHours: 1 });
  });
});

describe("the bill's figures open the rows behind them too", () => {
  it("states what kind of figure stands behind the dollars, and each model, project, state and day reproduces from its sessions", async () => {
    const s = await serve(join(work, "main.db"), { timeZone: "UTC" });
    const res = await get(s, "/api/bill?range=all");
    const d = res.body;
    expect(d.coverageLine).toMatch(/^\$7\.90: 0\.0% in months an invoice covers, 0\.0% in processes that recorded their own cost, 100\.0% only our estimate\.$/);
    expect(d.window.from).toBe("2026-10-24T20:00:00.000Z");
    const rows = async (q: string): Promise<Record<string, any>> => (await get(s, `/api/sessions?from=${encodeURIComponent(d.window.from)}&to=${encodeURIComponent(d.window.to)}&limit=200${q}`)).body;
    expect((await rows("")).spendMicros).toBe(d.totals.estimatedMicros);
    for (const m of d.byModel as { model: string; micros: number }[]) expect((await rows(`&model=${encodeURIComponent(m.model)}`)).spendMicros).toBe(m.micros);
    for (const p of d.byProject as { project: string; micros: number }[]) expect((await rows(`&project=${encodeURIComponent(p.project)}`)).spendMicros).toBe(p.micros);
    for (const r of d.landing.rows as { state: string; micros: number }[]) expect((await rows(`&state=${r.state}`)).spendMicros).toBe(r.micros);
    for (const day of d.daily as { day: string; micros: number }[]) {
      const w = (await get(s, `/api/sessions?from=${day.day}T00%3A00%3A00.000Z&to=${day.day}T23%3A59%3A59.999Z&limit=200`)).body;
      expect(w.spendMicros).toBe(day.micros);
    }
  });
});
