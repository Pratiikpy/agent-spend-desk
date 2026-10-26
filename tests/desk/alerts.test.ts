import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { alertsAdmin, collectRules, runCheck } from "../../src/desk/alerts/command.ts";
import { deliver, desktopCommand, formatForTerminal, type DeliveryDeps } from "../../src/desk/alerts/deliver.ts";
import { applyResults, history, listStates, recordDelivery, setPaused, type AlertEvent, type RuleResult } from "../../src/desk/alerts/engine.ts";
import { canaryRules, capRules, idleRule, pauseRules, reconciliationRules } from "../../src/desk/alerts/rules.ts";
import type { Gauge } from "../../src/desk/gauge/gauge.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { testSnapshot } from "./helpers.ts";

const T = (iso: string): Date => new Date(iso);
const rule = (over: Partial<RuleResult> = {}): RuleResult => ({ key: "cap:p:day", suite: "cap", state: "OK", title: "t", body: "b", evidence: "desk gate status", ...over });

describe("the alert engine", () => {
  it("is quiet the first time it sees a healthy rule, and speaks the first time it sees an unhealthy one", () => {
    const db = openLedger(":memory:");
    expect(applyResults(db, [rule()], T("2026-10-24T09:00:00Z")).fired).toEqual([]);
    const r = applyResults(db, [rule({ key: "cap:q:day", state: "WARNING" })], T("2026-10-24T09:00:00Z"));
    expect(r.fired.map((a) => [a.key, a.state, a.disposition])).toEqual([["cap:q:day", "WARNING", "fired"]]);
    db.close();
  });

  it("does not say the same thing twice, however often it is asked", () => {
    const db = openLedger(":memory:");
    const bad = rule({ state: "ALERT" });
    expect(applyResults(db, [bad], T("2026-10-24T09:00:00Z")).fired).toHaveLength(1);
    for (const t of ["09:15", "09:30", "18:00"]) expect(applyResults(db, [bad], T(`2026-10-24T${t}:00Z`)).fired).toEqual([]);
    expect(history(db)).toHaveLength(1);
    // Even the next day: it was said, and it has not changed.
    expect(applyResults(db, [bad], T("2026-10-25T09:00:00Z")).fired).toEqual([]);
    db.close();
  });

  it("always speaks when a warning becomes an alert, even after its suite spoke today", () => {
    const db = openLedger(":memory:");
    applyResults(db, [rule({ state: "WARNING" })], T("2026-10-24T09:00:00Z"));
    const r = applyResults(db, [rule({ state: "ALERT", title: "now an alert" })], T("2026-10-24T10:00:00Z"));
    expect(r.fired.map((a) => a.title)).toEqual(["now an alert"]);
    db.close();
  });

  it("lets a suite speak once a day, holds the rest back, records that once, and says them the next day if they are still true", () => {
    const db = openLedger(":memory:");
    const a = rule({ key: "cap:a:day", state: "WARNING" });
    const b = rule({ key: "cap:b:day", state: "WARNING" });
    const first = applyResults(db, [a, b], T("2026-10-24T09:00:00Z"));
    expect(first.fired.map((x) => x.key)).toEqual(["cap:a:day"]);
    expect(first.heldBack.map((x) => x.key)).toEqual(["cap:b:day"]);
    const second = applyResults(db, [a, b], T("2026-10-24T09:30:00Z"));
    expect(second.fired).toEqual([]);
    expect(second.heldBack).toEqual([]); // already recorded today
    expect(history(db).filter((e) => e.disposition === "suppressed_daily_limit")).toHaveLength(1);
    const next = applyResults(db, [a, b], T("2026-10-25T09:00:00Z"));
    expect(next.fired.map((x) => x.key)).toEqual(["cap:b:day"]);
    db.close();
  });

  it("lets two different suites each speak in a day", () => {
    const db = openLedger(":memory:");
    const r = applyResults(db, [rule({ key: "cap:a:day", state: "ALERT" }), rule({ key: "idle:agents", suite: "idle", state: "WARNING" })], T("2026-10-24T09:00:00Z"));
    expect(r.fired).toHaveLength(2);
    db.close();
  });

  it("records getting better without announcing it, and speaks again if it gets worse after that", () => {
    const db = openLedger(":memory:");
    applyResults(db, [rule({ state: "ALERT" })], T("2026-10-24T09:00:00Z"));
    const better = applyResults(db, [rule({ state: "OK" })], T("2026-10-24T10:00:00Z"));
    expect(better.fired).toEqual([]);
    expect(better.recovered.map((x) => x.disposition)).toEqual(["recovered"]);
    const worse = applyResults(db, [rule({ state: "ALERT" })], T("2026-10-25T10:00:00Z"));
    expect(worse.fired).toHaveLength(1);
    db.close();
  });

  it("never speaks about no data", () => {
    const db = openLedger(":memory:");
    expect(applyResults(db, [rule({ state: "NO_DATA" })], T("2026-10-24T09:00:00Z")).fired).toEqual([]);
    expect(applyResults(db, [rule({ state: "NO_DATA" })], T("2026-10-25T09:00:00Z")).fired).toEqual([]);
    expect(listStates(db)[0]?.state).toBe("NO_DATA");
    db.close();
  });

  it("does not evaluate or overwrite a rule the owner paused, notes that once a day, and picks it up again on resume", () => {
    const db = openLedger(":memory:");
    applyResults(db, [rule({ state: "OK" })], T("2026-10-24T09:00:00Z"));
    setPaused(db, "cap:p:day", true, T("2026-10-24T09:05:00Z"));
    const r1 = applyResults(db, [rule({ state: "ALERT" })], T("2026-10-24T10:00:00Z"));
    expect(r1).toMatchObject({ fired: [], paused: ["cap:p:day"] });
    applyResults(db, [rule({ state: "ALERT" })], T("2026-10-24T11:00:00Z"));
    expect(history(db).filter((e) => e.disposition === "suppressed_paused")).toHaveLength(1);
    expect(listStates(db)[0]).toMatchObject({ state: "OK", paused: true });
    setPaused(db, "cap:p:day", false, T("2026-10-24T12:00:00Z"));
    expect(applyResults(db, [rule({ state: "ALERT" })], T("2026-10-24T12:05:00Z")).fired).toHaveLength(1);
    db.close();
  });

  it("can pause a rule it has not seen yet, and keeps it healthy until resumed", () => {
    const db = openLedger(":memory:");
    setPaused(db, "canary:running", true);
    expect(listStates(db)[0]).toMatchObject({ key: "canary:running", suite: "canary", paused: true });
    expect(applyResults(db, [rule({ key: "canary:running", suite: "canary", state: "ALERT" })], T("2026-10-24T09:00:00Z")).fired).toEqual([]);
    db.close();
  });

  it("stores what was delivered beside the event", () => {
    const db = openLedger(":memory:");
    const r = applyResults(db, [rule({ state: "ALERT" })], T("2026-10-24T09:00:00Z"));
    recordDelivery(db, r.fired[0]!.alertId, [{ channel: "terminal", ok: true, detail: "printed" }, { channel: "webhook", ok: false, detail: "HTTP 500" }]);
    expect(history(db)[0]?.delivered).toEqual([{ channel: "terminal", ok: true, detail: "printed" }, { channel: "webhook", ok: false, detail: "HTTP 500" }]);
    db.close();
  });
});

describe("the rules", () => {
  const cap = (spent: number, over: Partial<Parameters<typeof capRules>[0][number]> = {}) => capRules([{ person: "p", window: "day", limitMicros: 10_000_000, spentMicros: spent, reservedMicros: 0, ...over }])[0]!;

  it("judges a cap by how much is used: the warn fraction and the ask fraction are warnings, 85% and the limit are alerts", () => {
    expect(cap(4_000_000).state).toBe("OK");
    expect(cap(5_000_000).state).toBe("WARNING"); // the default warn fraction, 50%
    expect(cap(8_000_000).state).toBe("WARNING"); // the default ask fraction, 80%
    expect(cap(8_500_000).state).toBe("ALERT");
    expect(cap(10_000_000).state).toBe("ALERT");
    expect(cap(12_000_000).body).toMatch(/reached/);
  });

  it("uses the fractions the policy sets, and counts money held for calls in flight", () => {
    expect(cap(2_000_000, { warnAt: 0.2 }).state).toBe("WARNING");
    expect(cap(0, { reservedMicros: 9_000_000 }).state).toBe("ALERT");
    expect(cap(6_000_000, { warnAt: 0.7, askAt: 0.9 }).state).toBe("OK");
  });

  it("has no rule for a person with no cap", () => {
    expect(capRules([{ person: "p", window: "day", limitMicros: null, spentMicros: 9, reservedMicros: 0 }])).toEqual([]);
  });

  it("makes a paused person an alert and an unpaused one healthy", () => {
    expect(pauseRules([{ person: "a", paused: true }, { person: "b", paused: false }]).map((r) => [r.key, r.state])).toEqual([["gate:paused:a", "ALERT"], ["gate:paused:b", "OK"]]);
  });

  const gauge = (idleMicros: number, calls = 5): Gauge => ({ asOf: "2026-10-24T12:00:00.000Z", hours: 1, scope: "x", spendMicros: 20_000_000, calls, unpricedCalls: 0, burnMicrosPerHour: null, idleMinutes: 1, split: idleMicros > 0 ? [{ cause: "idle", label: "Idle", micros: idleMicros, share: 0.1 }] : [], limits: [], notes: [] });
  it("calls idle spend of $2 a warning and $10 an alert, and says nothing when there were no calls", () => {
    expect(idleRule(gauge(1_000_000)).state).toBe("OK");
    expect(idleRule(gauge(2_000_000)).state).toBe("WARNING");
    expect(idleRule(gauge(10_000_000)).state).toBe("ALERT");
    expect(idleRule(gauge(0, 0)).state).toBe("NO_DATA");
  });

  it("reads the canary's verdict and whether it is still running, with three days as the line", () => {
    const now = T("2026-10-24T12:00:00Z");
    const v = (verdict: string) => ({ verdict }) as never;
    expect(canaryRules({ verdict: v("regressed"), lastRunDate: "2026-10-24", now }).map((r) => [r.key, r.state])).toEqual([["canary:verdict", "ALERT"], ["canary:running", "OK"]]);
    expect(canaryRules({ verdict: v("harness_or_platform"), lastRunDate: "2026-10-24", now })[0]?.state).toBe("WARNING");
    expect(canaryRules({ verdict: v("steady"), lastRunDate: "2026-10-24", now })[0]?.state).toBe("OK");
    expect(canaryRules({ verdict: v("steady"), lastRunDate: "2026-10-22", now })[1]?.state).toBe("OK"); // 2 days
    const late = canaryRules({ verdict: v("steady"), lastRunDate: "2026-10-21", now })[1]!;
    expect(late.state).toBe("ALERT");
    expect(late.title).toBe("The canary has not run for 3 days");
    expect(canaryRules({ verdict: null, lastRunDate: null, now }).map((r) => r.state)).toEqual(["NO_DATA", "NO_DATA"]);
  });

  it("does not raise an alert from a canary file whose dates are still to come, because that is a recorded scenario and not daily runs", () => {
    const now = T("2026-10-24T12:00:00Z");
    const v = (verdict: string) => ({ verdict }) as never;
    const rules = canaryRules({ verdict: v("regressed"), lastRunDate: "2026-10-29", now });
    expect(rules.map((r) => r.state)).toEqual(["NO_DATA", "NO_DATA"]);
    expect(rules[0]?.body).toMatch(/recorded scenario with assigned dates/);
    // Tomorrow's date is not enough to call it a scenario: clocks and time zones differ by a day.
    expect(canaryRules({ verdict: v("regressed"), lastRunDate: "2026-10-25", now })[0]?.state).toBe("ALERT");
  });

  it("calls an unreconciled month with an invoice a warning, and ignores months with no invoice", () => {
    const row = (status: "reconciled" | "partial" | "unreconciled", billed: number | null) => ({ vendor: "anthropic", period: "2026-10", currency: "USD", billedMicros: billed, estimatedMicros: 1, reportedMicros: null, gapMicros: 1, status, reason: "why", unmatchedBilledMicros: 0, unmatchedEstimatedMicros: 0, invoices: [] });
    expect(reconciliationRules([row("unreconciled", 5), row("partial", 5), row("reconciled", 5), row("unreconciled", null)]).map((r) => r.state)).toEqual(["WARNING", "OK", "OK"]);
  });
});

function deps(over: Partial<DeliveryDeps> = {}): DeliveryDeps & { printed: string[]; ran: { program: string; args: string[]; env: Record<string, string> }[] } {
  const printed: string[] = [];
  const ran: { program: string; args: string[]; env: Record<string, string> }[] = [];
  return {
    printed, ran,
    fetch: (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch,
    run: (program, args, env) => {
      ran.push({ program, args, env });
      return { status: 0 };
    },
    sleep: async () => undefined,
    print: (l) => void printed.push(l),
    platform: "linux",
    ...over,
  };
}

const alert: AlertEvent = { alertId: 1, ts: "2026-10-24T09:00:00.000Z", key: "cap:p:day", suite: "cap", state: "ALERT", title: "p's day cap is 90% used", body: "$9.00 of $10.00", evidence: "desk gate status", disposition: "fired", delivered: [] };

describe("delivering an alert", () => {
  it("prints it for the terminal, with what to look at", () => {
    const d = deps();
    return deliver(alert, {}, d).then((r) => {
      expect(r).toEqual([{ channel: "terminal", ok: true, detail: "printed" }]);
      expect(d.printed[0]).toBe(formatForTerminal(alert));
      expect(d.printed[0]).toMatch(/ALERT {2}p's day cap is 90% used\n {9}\$9\.00 of \$10\.00\n {9}See: desk gate status/);
    });
  });

  it("passes the text to a desktop notification through the environment on Windows and macOS, never in the command line", async () => {
    for (const platform of ["win32", "darwin"]) {
      const d = deps({ platform });
      const r = await deliver(alert, { terminal: false, desktop: true }, d);
      expect(r).toEqual([{ channel: "desktop", ok: true, detail: "shown" }]);
      expect(d.ran[0]!.args.join(" ")).not.toContain("90% used");
      expect(d.ran[0]!.env).toMatchObject({ DESK_ALERT_TITLE: alert.title, DESK_ALERT_BODY: alert.body });
    }
    expect(desktopCommand("win32").program).toBe("powershell.exe");
    expect(desktopCommand("darwin").program).toBe("osascript");
  });

  it("gives notify-send the text after --, so that a title that starts with a dash is not an option", async () => {
    const d = deps({ platform: "linux" });
    await deliver({ ...alert, title: "--version" }, { terminal: false, desktop: true }, d);
    expect(d.ran[0]).toMatchObject({ program: "notify-send", args: ["--app-name=desk", "--", "--version", alert.body] });
  });

  it("reports a desktop notification that could not be shown, and goes on to the next channel", async () => {
    const d = deps({ run: () => ({ status: null, error: "spawn notify-send ENOENT" }) });
    const r = await deliver(alert, { desktop: true }, d);
    expect(r.map((x) => [x.channel, x.ok])).toEqual([["terminal", true], ["desktop", false]]);
    expect(r[1]?.detail).toMatch(/ENOENT/);
  });

  it("runs the owner's command with the alert in the environment", async () => {
    const d = deps();
    const r = await deliver(alert, { terminal: false, command: ["my-notifier", "--loud"] }, d);
    expect(r).toEqual([{ channel: "command", ok: true, detail: "ran" }]);
    expect(d.ran[0]).toMatchObject({ program: "my-notifier", args: ["--loud"], env: { DESK_ALERT_STATE: "ALERT", DESK_ALERT_EVIDENCE: "desk gate status" } });
  });

  it("posts only the title, body, state, evidence, key and time to a webhook, and does nothing without a URL", async () => {
    let seen: { url: string; body: Record<string, unknown> } | null = null;
    const d = deps({ fetch: (async (url: string, init: RequestInit) => { seen = { url, body: JSON.parse(String(init.body)) as Record<string, unknown> }; return new Response("ok", { status: 200 }); }) as unknown as typeof fetch });
    expect(await deliver(alert, { terminal: false }, d)).toEqual([]);
    expect(seen).toBeNull();
    const r = await deliver(alert, { terminal: false, webhook: "https://hooks.example.test/x" }, d);
    expect(r).toEqual([{ channel: "webhook", ok: true, detail: "HTTP 200" }]);
    expect(Object.keys(seen!.body).sort()).toEqual(["at", "body", "evidence", "key", "source", "state", "title"]);
  });

  it("retries a webhook that fails with a server error, with backoff, up to the cap, and then gives up without throwing", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const d = deps({ fetch: (async () => { calls += 1; return new Response("no", { status: 503 }); }) as unknown as typeof fetch, sleep: async (ms) => void sleeps.push(ms) });
    const r = await deliver(alert, { terminal: false, webhook: "https://hooks.example.test/x" }, d);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([250, 500]);
    expect(r[0]).toEqual({ channel: "webhook", ok: false, detail: "HTTP 503 (gave up after 3 attempts)" });
  });

  it("recovers when a retry works, does not retry a client error, and says when it timed out or could not connect", async () => {
    let n = 0;
    const flaky = deps({ fetch: (async () => (++n < 2 ? new Response("x", { status: 500 }) : new Response("ok", { status: 200 }))) as unknown as typeof fetch });
    expect((await deliver(alert, { terminal: false, webhook: "https://h.test" }, flaky))[0]).toEqual({ channel: "webhook", ok: true, detail: "HTTP 200" });
    let calls = 0;
    const gone = deps({ fetch: (async () => { calls += 1; return new Response("no", { status: 404 }); }) as unknown as typeof fetch });
    expect((await deliver(alert, { terminal: false, webhook: "https://h.test" }, gone))[0]?.detail).toBe("HTTP 404 (gave up after 3 attempts)");
    expect(calls).toBe(1);
    const down = deps({ fetch: (async () => { throw new Error("connect ECONNREFUSED"); }) as unknown as typeof fetch, webhookAttempts: 1 });
    expect((await deliver(alert, { terminal: false, webhook: "https://h.test" }, down))[0]?.detail).toBe("connect ECONNREFUSED (gave up after 1 attempt)");
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("desk alerts check", () => {
  it("reads the idle, canary and reconciliation rules from real state, sends what is new, and notes what it could not read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "desk-alerts-"));
    dirs.push(dir);
    const db = openLedger(":memory:");
    const now = T("2026-10-24T12:00:00Z");
    // A canary file whose last run is five days old: the canary has stopped.
    const runs = join(dir, "runs.jsonl");
    const row = (day: number, date: string) => JSON.stringify({ day, date, arm: "primary", taskId: "t1", servedModel: "m", score: 1, error: null, latencyMs: 1, tokensIn: 1, tokensOut: 1, replySha: "x", harness: "h", cacheBypass: true });
    writeFileSync(runs, `${row(1, "2026-10-19")}\n`);
    const d = deps();
    const text = await runCheck({ db, snapshot: testSnapshot(), now, canaryRunsPath: runs, gate: null, channels: { terminal: true }, deps: d });
    expect(text).toMatch(/rules checked: 1 unhealthy, 1 alert sent/);
    expect(text).toMatch(/Caps and pauses: not checked\. Say where the gate is with --policy FILE/);
    expect(d.printed.join("\n")).toMatch(/The canary has not run for 5 days/);
    // Asked again, it says nothing new.
    const d2 = deps();
    const again = await runCheck({ db, snapshot: testSnapshot(), now: T("2026-10-24T12:15:00Z"), canaryRunsPath: runs, gate: null, channels: { terminal: true }, deps: d2 });
    expect(again).toMatch(/0 alerts sent/);
    expect(d2.printed).toEqual([]);
    expect(history(db)[0]?.delivered).toEqual([{ channel: "terminal", ok: true, detail: "printed" }]);
    db.close();
  });

  it("collects no canary rule failure for a file that does not exist, and says caps are not checked when the gate files are missing", () => {
    const db = openLedger(":memory:");
    const r = collectRules({ db, snapshot: testSnapshot(), now: T("2026-10-24T12:00:00Z"), canaryRunsPath: "does-not-exist.jsonl", gate: { policyPath: "nope.yaml", dbPath: "nope.db", person: "p" } });
    expect(r.notes.join(" ")).toMatch(/not checked, because nope\.yaml or nope\.db does not exist/);
    expect(r.rules.map((x) => x.key)).toEqual(["idle:agents", "canary:verdict", "canary:running"]);
    expect(r.rules.every((x) => x.state === "NO_DATA")).toBe(true);
    db.close();
  });
});

describe("desk alerts list, history, pause and resume", () => {
  it("lists rules by state, shows the history with what was delivered, and pauses and resumes by key", () => {
    const db = openLedger(":memory:");
    expect(alertsAdmin("list", undefined, db)).toMatch(/No rule has been checked yet/);
    expect(alertsAdmin("history", undefined, db)).toMatch(/No alert has been decided yet/);
    const r = applyResults(db, [rule({ state: "ALERT" })], T("2026-10-24T09:00:00Z"));
    recordDelivery(db, r.fired[0]!.alertId, [{ channel: "terminal", ok: true, detail: "printed" }]);
    expect(alertsAdmin("list", undefined, db)).toMatch(/ALERT {4}cap:p:day {32}since 2026-10-24 09:00/);
    expect(alertsAdmin("history", undefined, db)).toMatch(/fired {18}ALERT {3}t {2}\[terminal\]/);
    expect(alertsAdmin("pause", "cap:p:day", db)).toMatch(/is paused: it is not evaluated/);
    expect(alertsAdmin("list", undefined, db)).toMatch(/PAUSED/);
    expect(alertsAdmin("resume", "cap:p:day", db)).toMatch(/is resumed/);
    expect(() => alertsAdmin("pause", undefined, db)).toThrowError(/Use: desk alerts pause/);
    expect(() => alertsAdmin("frobnicate", undefined, db)).toThrowError(/Use: desk alerts check/);
    db.close();
  });
});

describe("desk alerts on the command line", () => {
  it("prints the scheduler command for each system, and installs nothing", async () => {
    const { scheduleSnippet } = await import("../../src/desk/alerts/command.ts");
    expect(scheduleSnippet("D:\\work\\desk", "win32", "--policy p.yaml")).toMatch(/schtasks \/Create \/SC MINUTE \/MO 15 \/TN "desk alerts" \/TR "cmd \/c cd \/d D:\\work\\desk && npm run desk --silent -- alerts check --policy p\.yaml"/);
    expect(scheduleSnippet("/srv/desk", "linux")).toMatch(/^Linux \(cron\), every 15 minutes[\s\S]*\*\/15 \* \* \* \* cd \/srv\/desk && npm run desk --silent -- alerts check\n/);
    expect(scheduleSnippet("/opt/desk", "darwin")).toMatch(/<key>StartInterval<\/key><integer>900<\/integer>/);
    for (const p of ["win32", "linux", "darwin"] as const) expect(scheduleSnippet("/x", p)).toMatch(/does not install it/);
  });

  it("checks a ledger, lists what it saw, and pauses a rule", async () => {
    const { spawnSync } = await import("node:child_process");
    const dir = mkdtempSync(join(tmpdir(), "desk-alerts-cli-"));
    dirs.push(dir);
    const dbFile = join(dir, "ledger.db");
    openLedger(dbFile).close();
    const run = (...a: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "alerts", ...a, "--db", dbFile], { encoding: "utf8", env: { ...process.env, DESK_STATUSLINE_LOG: join(dir, "none.jsonl") } });
    const first = run("check");
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/\d+ rules checked: \d+ unhealthy, \d+ alerts? sent/);
    expect(first.stdout).toMatch(/Caps and pauses: not checked/);
    const list = run("list");
    expect(list.status).toBe(0);
    expect(list.stdout).toMatch(/idle:agents/);
    expect(run("pause", "idle:agents").stdout).toMatch(/idle:agents is paused/);
    expect(run("list").stdout).toMatch(/PAUSED/);
    expect(run("bogus").stderr).toMatch(/Use: desk alerts check/);
  }, 120_000);
});
