import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CassettePort, ModelError, OpenAiPort } from "../../src/desk/agents/model.ts";
import { MemoryTrace } from "../../src/desk/agents/trace.ts";
import { ask } from "../../src/desk/ask/ask.ts";
import { billCommand } from "../../src/desk/bill/command.ts";
import { canaryCommand } from "../../src/desk/canary/command.ts";
import type { RunRow } from "../../src/desk/canary/runner.ts";
import { decide } from "../../src/desk/canary/schedule.ts";
import { TASKS } from "../../src/desk/canary/tasks.ts";
import { gateHealth, hookInstalledIn } from "../../src/desk/gate/health.ts";
import { runHook } from "../../src/desk/gate/hook.ts";
import { verifyLedger } from "../../src/desk/ledger/chain.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { replaySessionsFromLedger } from "../../src/desk/replay/from-ledger.ts";
import { baselineReproduction, withheldNotice } from "../../src/desk/replay/reproduction.ts";
import { silosScreen } from "../../src/desk/ui/extra.ts";
import { session, sources, type UiContext } from "../../src/desk/ui/queries.ts";
import { startUiServer } from "../../src/desk/ui/server.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";
import { call, rig } from "./gate/harness.ts";
import { renderShell } from "./ui/support/rich-ui.ts";

/**
 * Failure drills (DF-084): each dependency the specification names is killed, and each named empty or error state is reached, and what the person is told and
 * what the Desk does are asserted. Some drills are proved at more depth where a feature has its own test file; they are named here so that this file is the whole matrix.
 */
const snap = testSnapshot();
const KEY = ["stand", "in", "key", "0123456789"].join("-");
const NOW = new Date("2026-10-25T12:00:00Z");
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

const spend = (id: string, session: string, ts: string, over: Record<string, unknown> = {}): string => assistantLine({ id, session, ts, output: 4000, ...over });
async function seed(): Promise<void> {
  await ingestClaudeCode(db, [dir.file("a.jsonl", [spend("m1", "s1", "2026-10-20T10:00:00Z"), spend("m2", "s1", "2026-10-20T11:00:00Z")])], snap, () => NOW);
}
const ctx = (over: Partial<UiContext> = {}): UiContext => ({ db, snapshot: snap, policiesDir: "policies", mode: "own_logs", ledgerName: "ledger", env: {}, nowMs: () => NOW.getTime(), egressLogPath: null, ...over });
const HOOK_EVENT = JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s", tool_name: "Bash", cwd: "/work/app", tool_input: { command: "ls" } });

describe("drill-model-down: the model endpoint is killed", () => {
  it("falls back to the rule brain, answers, and labels what ran", async () => {
    await seed();
    const dead = new OpenAiPort({ baseUrl: "http://127.0.0.1:9/v1", apiKey: KEY, model: "m", backoffMs: [] });
    const trace = new MemoryTrace();
    const r = await ask({ db, question: "How much did we spend in total?", port: dead, trace, record: false });
    expect(r.status).toBe("answered");
    expect(r.planner).toBe("rules");
    expect(r.explainer).toBe("rules");
    expect(trace.events.some((e) => e.event === "desk.model.failed")).toBe(true);
    expect(trace.events.some((e) => e.event === "fallback.used")).toBe(true);
  });
});

describe("drill-zetaris-down: the Zetaris instance is killed", () => {
  it("serves the embedded fallback on every silo, says why, and drops the bill's billed class to nothing", async () => {
    await seed();
    const paths = { cassetteDir: join(dir.path, "none"), memoryDir: join(dir.path, "m"), dossiersDir: join(dir.path, "d"), pendingDir: join(dir.path, "p"), sampleDir: join(dir.path, "s"), regretPath: join(dir.path, "r.json") };
    const r = (await silosScreen(ctx({ env: { ZETARIS_REST_URL: "http://127.0.0.1:9", ZETARIS_API_KEY: KEY, ZETARIS_ORG_ID: "o" } }), paths as never)) as { available: boolean; served: Record<string, string>; reasons: Record<string, string>; classes: { billedMicros: number } };
    expect(r.available).toBe(false);
    expect(Object.values(r.served).every((v) => v === "fallback")).toBe(true);
    expect(Object.values(r.reasons).join(" ")).toMatch(/not reachable|unreachable|did not answer/i);
    expect(r.classes.billedMicros).toBe(0);
  });
});

describe("drill-ledger-readonly: the gate's ledger can no longer be written", () => {
  it("does not allow a call it cannot record, and the hook blocks", () => {
    const r = rig();
    // The hook allows while the ledger can be written. An allow records nothing else, so the check proves a write works first: without that, a gate that could no longer write would go on allowing in silence.
    expect(r.gate.hookPreToolUse(JSON.parse(HOOK_EVENT)).decision).toBe("allow");
    r.db.exec("PRAGMA query_only = ON");
    const hook = r.gate.hookPreToolUse(JSON.parse(HOOK_EVENT));
    expect(hook.decision).toBe("deny");
    expect(hook.failedClosed).toBe(true);
    let verdict = "error";
    try {
      verdict = r.gate.authorize(call({ idempotency_key: "ro" })).verdict;
    } catch {
      verdict = "error";
    }
    expect(verdict).not.toBe("allow");
  });
});

describe("drill-gate-down: the enforcement endpoint is killed", () => {
  it("blocks within 250 ms, says the gate is not answering, and the emergency switch opens and is logged", async () => {
    const started = Date.now();
    const out = await runHook(HOOK_EVENT, { DESK_GATE_TOKEN: KEY, DESK_GATE_URL: "http://127.0.0.1:9" });
    expect(Date.now() - started).toBeLessThan(250);
    expect(out.exitCode).toBe(2);
    expect(out.stderr.length).toBeGreaterThan(0);
    const r = rig();
    r.gate.openBypass(30 * 60_000, "owner");
    expect(r.gate.bypassOpen().open).toBe(true);
    r.gate.authorize(call({ waste_rule: "C-LOOP-1", recoverable_micros: 5_000_000, idempotency_key: "b" }));
    expect((r.db.prepare("SELECT COUNT(*) n FROM gate_event WHERE kind IN ('bypass_opened','bypass_allowed')").get() as { n: number }).n).toBeGreaterThan(0);
  });
});

describe("drill-unpriced: a price row is missing", () => {
  it("counts the call as unpriced, says so on the bill, and denies an enforced call on that model", async () => {
    await ingestClaudeCode(db, [dir.file("a.jsonl", [spend("m1", "s1", "2026-10-20T10:00:00Z"), spend("m2", "s1", "2026-10-20T11:00:00Z", { model: "claude-future-9" })])], snap, () => NOW);
    expect(db.prepare("SELECT class FROM cost_event c JOIN model_call m ON m.call_id = c.call_id WHERE m.model = 'claude-future-9'").get()).toMatchObject({ class: "unpriced" });
    const b = billCommand({ db, snapshot: snap, mode: "own_logs", now: NOW });
    expect(b.text).toMatch(/unpriced +Models with no price row: tokens counted, no dollars invented/);
    expect(b.text).toContain("desk prices add MODEL=IN,OUT");
    expect(rig().gate.authorize(call({ model: "claude-future-9", idempotency_key: "u" })).verdict).not.toBe("allow");
  });
});

describe("drill-disk-full: the disk fills during an ingest", () => {
  it("fails with the ledger's path, keeps no partial file, leaves the chain intact, and the same command finishes once there is room", async () => {
    const path = join(dir.path, "full.db");
    const file = openLedger(path);
    try {
      await ingestClaudeCode(file, [dir.file("a.jsonl", [spend("m1", "s1", "2026-10-20T10:00:00Z")])], snap, () => NOW);
      const before = (file.prepare("SELECT COUNT(*) n FROM model_call").get() as { n: number }).n;
      const pages = (file.prepare("PRAGMA page_count").get() as { page_count: number }).page_count;
      file.exec(`PRAGMA max_page_count = ${pages + 2}`);
      const big = dir.file("b.jsonl", Array.from({ length: 4000 }, (_, i) => spend(`b${i}`, `sb${i % 40}`, `2026-10-21T10:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`)));
      const err = (await ingestClaudeCode(file, [big], snap, () => NOW).catch((e: unknown) => e)) as Error & { code?: string };
      expect(err.code).toBe("E_DISK_FULL");
      expect(err.message).toContain(path);
      expect(err.message).toContain("run the same command again");
      expect((file.prepare("SELECT COUNT(*) n FROM model_call").get() as { n: number }).n).toBe(before);
      expect(file.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(verifyLedger(file).ok).toBe(true);
      file.exec("PRAGMA max_page_count = 1073741823");
      await ingestClaudeCode(file, [big], snap, () => NOW);
      expect((file.prepare("SELECT COUNT(*) n FROM model_call").get() as { n: number }).n).toBe(before + 4000);
      expect(verifyLedger(file).ok).toBe(true);
    } finally {
      file.close();
    }
  }, 120_000);
});

describe("drill-clock-skew: a log's clock ran backwards", () => {
  it("flags the lines, keeps the order the log wrote, and the session says so", async () => {
    await ingestClaudeCode(db, [dir.file("a.jsonl", [spend("m1", "s1", "2026-10-20T10:00:00Z"), spend("m2", "s1", "2026-10-20T10:10:00Z"), spend("m3", "s1", "2026-10-20T08:00:00Z")])], snap, () => NOW);
    const s = session(ctx(), "s1") as { clock: { skewedLines: number } | null; calls: { ts: string }[] };
    expect(s.clock).toEqual({ skewedLines: 1, futureLines: 0 });
    expect(s.calls.map((c) => c.ts.slice(11, 16))).toEqual(["10:00", "10:10", "08:00"]);
    expect((sources(ctx()) as { skipped: { skewedLines: number } }).skipped.skewedLines).toBe(1);
  });
});

describe("drill-harness-change: the canary's tasks or checks changed", () => {
  const row = (date: string, harness: string): RunRow => ({ day: 1, date, arm: "primary", taskId: (TASKS[0] as (typeof TASKS)[number]).id, servedModel: "m", score: 1, error: null, latencyMs: 1, tokensIn: 10, tokensOut: 10, replySha: null, harness, cacheBypass: true });
  it("refuses to add a run to the old series and asks for a new baseline", () => {
    const d = decide({ today: "2026-10-25", rows: [row("2026-10-24", "v0:old-harness")], plan: { fiveHourPct: null, weeklyPct: null }, budget: { capMicros: null, estimateMicros: null } });
    expect(d.action).toBe("new_baseline");
    expect(d.reason).toContain("cannot be compared");
  });
});

describe("drill-cassette-miss: a recording is missing", () => {
  it("names the role and the command that records it, and Ask falls back to its rules", async () => {
    const empty = join(dir.path, "no-cassettes");
    mkdirSync(empty);
    const port = new CassettePort(empty);
    const err = (await port.complete({ role: "ask_planner", messages: [{ role: "user", content: "hi" }] }).catch((e: unknown) => e)) as ModelError;
    expect(err).toBeInstanceOf(ModelError);
    expect(err.kind).toBe("cassette_miss");
    expect(err.message).toContain("E_CASSETTE_MISS");
    expect(err.message).toContain("Record it live with: desk record --role ask_planner");
    await seed();
    const trace = new MemoryTrace();
    const r = await ask({ db, question: "How much did we spend in total?", port, trace, record: false });
    expect(r.planner).toBe("rules");
    expect(r.status).toBe("answered");
  });
});

describe("empty and error states", () => {
  it("no logs found: the card names the folders it looked in", async () => {
    const { runCard } = await import("../../src/desk/card/run.ts");
    const missing = join(dir.path, "no-claude");
    const r = await runCard({ mode: "own_logs", claudeDir: missing, dbPath: ":memory:", pricesPath: "data/prices/anthropic-litellm-2026-10-22.json", outDir: join(dir.path, "card"), sampleDir: join(dir.path, "s"), days: 30, hours: 5, repos: [], color: false });
    expect(r.text).toMatch(/No agent logs were found\. Searched: /);
    expect(r.text).toContain("no-claude");
  });

  it("logs but no repositories: the bill says nothing can be called landed, and that unlinked is unknowable, not waste", async () => {
    await seed();
    const b = billCommand({ db, snapshot: snap, mode: "own_logs", now: NOW });
    expect(b.text).toContain("No repository is linked, so nothing can be called landed. Every session is unlinked: unknowable, not waste.");
  });

  it("the canary is not yet eligible: it says on which day the first call is possible", () => {
    const rows = [1, 2, 3].map((day) => ({ day, date: `2026-10-0${day}`, arm: "primary", taskId: (TASKS[day] as (typeof TASKS)[number]).id, servedModel: "m", score: 1, error: null, latencyMs: 1, tokensIn: 1, tokensOut: 1, replySha: null, harness: "h", cacheBypass: true }));
    const p = join(dir.path, "runs.jsonl");
    writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n"));
    const text = canaryCommand({ runsPath: p, sample: false }).text;
    expect(text).toMatch(/the first call is possible on 2026-\d{2}-\d{2} \(day \d+\)/);
  });

  it("the canary is skipped: the reason and the meters are named", () => {
    const plan = decide({ today: "2026-10-25", rows: [], plan: { fiveHourPct: 96, weeklyPct: null }, budget: { capMicros: null, estimateMicros: null } });
    expect(plan).toMatchObject({ action: "skip", kind: "plan_limit" });
    expect((plan as { reason: string }).reason).toMatch(/96% used/);
    const budget = decide({ today: "2026-10-25", rows: [], plan: { fiveHourPct: null, weeklyPct: null }, budget: { capMicros: 1_000_000, estimateMicros: 3_500_000 } });
    expect(budget).toMatchObject({ action: "skip", kind: "budget" });
    expect((budget as { reason: string }).reason).toMatch(/\$3\.50.*\$1\.00 a day/);
  });

  it("a replay whose baseline does not reproduce the ledger is withheld, with the sessions that differ", async () => {
    await seed();
    const sessions = replaySessionsFromLedger(db, snap, "0000", "9999");
    expect(baselineReproduction(db, sessions, "0000", "9999").reproduces).toBe(true);
    // Drift in the account the replay was given: one call costs a micro-dollar more than the ledger stored.
    const drifted = sessions.map((x, i) => (i === 0 ? { ...x, calls: x.calls.map((c, j) => (j === 0 ? { ...c, costMicros: c.costMicros + 1 } : c)) } : x));
    const r = baselineReproduction(db, drifted, "0000", "9999");
    expect(r.reproduces).toBe(false);
    expect(r.mismatched[0]).toMatchObject({ sessionId: "s1" });
    const notice = withheldNotice(r);
    expect(notice).toContain("Replay withheld: its baseline does not reproduce the ledger");
    expect(notice).toContain("desk ledger verify --deep");
    // A session the ledger holds that the replay was never given is a difference too.
    expect(baselineReproduction(db, [], "0000", "9999")).toMatchObject({ reproduces: false, mismatchedCount: 1 });
  });
});

describe("enforcement endpoint down: the red banner and the way to open the gate", () => {
  it("knows whether the hook is installed from the settings files, and whether the gate answers", async () => {
    const home = join(dir.path, "home");
    mkdirSync(join(home, ".claude"), { recursive: true });
    expect(hookInstalledIn(home, join(dir.path, "proj"))).toBeNull();
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: 'node "/srv/desk/src/desk/gate/hook-main.ts"' }] }] } }));
    expect(hookInstalledIn(home, join(dir.path, "proj"))).toBe(join(home, ".claude", "settings.json"));
    const down = await gateHealth({ env: { DESK_GATE_URL: "http://127.0.0.1:9" }, home, cwd: join(dir.path, "proj") });
    expect(down).toMatchObject({ hookInstalled: true, reachable: false });
    const up: Server = createServer((req, res) => { res.statusCode = req.url === "/healthz" ? 200 : 404; res.end("{}"); });
    await new Promise<void>((r) => up.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${(up.address() as AddressInfo).port}`;
      expect(await gateHealth({ env: { DESK_GATE_URL: url }, home, cwd: join(dir.path, "proj") })).toMatchObject({ hookInstalled: true, reachable: true });
      expect(await gateHealth({ env: { DESK_GATE_URL: url }, home: join(dir.path, "elsewhere"), cwd: join(dir.path, "proj") })).toMatchObject({ hookInstalled: false, reachable: true });
    } finally {
      await new Promise<void>((r) => up.close(() => r()));
    }
  });

  async function shellText(health: { hookInstalled: boolean; reachable: boolean }): Promise<string> {
    const folder = mkdtempSync(join(tmpdir(), "desk-drill-ui-"));
    const path = join(folder, "ledger.db");
    const l = openLedger(path);
    await ingestClaudeCode(l, [join(dir.path, "a.jsonl")], snap, () => NOW);
    l.close();
    const token = "t".repeat(32);
    const server = await startUiServer({
      pricesPath: "data/prices/anthropic-litellm-2026-10-22.json", policiesDir: "policies", port: 0, token, env: {}, ledgerPath: path, mode: "own_logs",
      gateHealth: async () => ({ ...health, hookIn: null, url: "http://127.0.0.1:8765", ms: null }),
      extra: { dossiersDir: join(folder, "none"), pendingDir: join(folder, "none"), memoryDir: join(folder, "m"), tracesDir: join(folder, "t") } as never,
    } as never);
    try {
      const shell = await renderShell({ server, token, dir: folder, close: async () => {} });
      const text = shell.app.textContent;
      shell.restore();
      return text;
    } finally {
      await server.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }

  it("shows a red banner with the command to start the gate and the one to open it, when the hook is installed and the gate is silent", async () => {
    await seed();
    dir.file("a.jsonl", [spend("m1", "s1", "2026-10-20T10:00:00Z")]);
    const text = await shellText({ hookInstalled: true, reachable: false });
    expect(text).toContain("Enforcement down");
    expect(text).toContain("every tool call it guards is being blocked");
    expect(text).toContain("desk gate serve");
    expect(text).toContain("desk gate open --for 30m");
  }, 120_000);

  it("says nothing when the gate answers, and nothing when no hook is installed (nothing is being blocked)", async () => {
    dir.file("a.jsonl", [spend("m1", "s1", "2026-10-20T10:00:00Z")]);
    expect(await shellText({ hookInstalled: true, reachable: true })).not.toContain("Enforcement down");
    expect(await shellText({ hookInstalled: false, reachable: false })).not.toContain("Enforcement down");
  }, 120_000);
});
