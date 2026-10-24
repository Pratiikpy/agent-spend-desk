import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { readCleanupDays, renderRetention, retentionReport, scanLogs, scheduleSnippets } from "../../src/desk/retention/retention.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";

const NOW = new Date("2026-10-24T12:00:00.000Z");
const DAY = 86_400_000;

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

/** A log file of `lines`, last modified `ageDays` before NOW. */
function logFile(name: string, ageDays: number, lines: string[]): string {
  const sub = join(dir.path, "projects", "p");
  mkdirSync(sub, { recursive: true });
  const path = join(sub, name);
  writeFileSync(path, `${lines.join("\n")}\n`);
  const when = new Date(NOW.getTime() - ageDays * DAY);
  utimesSync(path, when, when);
  return path;
}

describe("what Claude Code will delete", () => {
  it("reads the cleanup period from the user's settings, and says when it is the default", () => {
    const set = (v: unknown) => {
      const p = join(dir.path, "settings.json");
      writeFileSync(p, JSON.stringify(v));
      return p;
    };
    expect(readCleanupDays(set({ cleanupPeriodDays: 90 }))).toEqual({ days: 90, source: "settings" });
    expect(readCleanupDays(set({ theme: "dark" }))).toEqual({ days: 30, source: "default" });
    expect(readCleanupDays(join(dir.path, "missing.json"))).toEqual({ days: 30, source: "default" });
    writeFileSync(join(dir.path, "bad.json"), "{ not json");
    expect(readCleanupDays(join(dir.path, "bad.json"))).toEqual({ days: 30, source: "default" });
    expect(readCleanupDays(set({ cleanupPeriodDays: "ninety" }))).toEqual({ days: 30, source: "default" });
    expect(readCleanupDays(set({ cleanupPeriodDays: -5 }))).toEqual({ days: 30, source: "default" });
    expect(readCleanupDays(set({ cleanupPeriodDays: 2.5 }))).toEqual({ days: 30, source: "default" });
  });

  it("finds log files with their age and size", () => {
    logFile("a.jsonl", 3, [assistantLine({ id: "a" })]);
    logFile("b.jsonl", 40, [assistantLine({ id: "b" })]);
    const found = scanLogs(join(dir.path, "projects"));
    expect(found).toHaveLength(2);
    expect(found.map((f) => Math.round((NOW.getTime() - f.mtimeMs) / DAY)).sort((x, y) => x - y)).toEqual([3, 40]);
    expect(found.every((f) => f.sizeBytes > 0)).toBe(true);
    expect(scanLogs(join(dir.path, "nowhere"))).toEqual([]);
  });

  it("counts the files that will go within the horizon and are not in the ledger yet, apart from the ones already read", async () => {
    const safe = logFile("safe.jsonl", 29, [assistantLine({ id: "s1" })]);
    logFile("risky.jsonl", 27, [assistantLine({ id: "r1" }), assistantLine({ id: "r2" })]);
    logFile("fresh.jsonl", 2, [assistantLine({ id: "f1" })]);
    await ingestClaudeCode(db, [safe], testSnapshot());
    const files = scanLogs(join(dir.path, "projects"));
    const r = retentionReport({ files, db, retentionDays: 30, retentionSource: "default", now: NOW, horizonDays: 7 });
    expect(r.files).toBe(3);
    expect(r.oldestAgeDays).toBe(29);
    expect(r.goingWithin.files).toBe(2);
    expect(r.goingWithin.unreadFiles).toBe(1);
    expect(r.goingWithin.unreadBytes).toBeGreaterThan(0);
    expect(r.goingWithin.daysUntilFirst).toBe(1);
    expect(r.alreadyPast.files).toBe(0);
  });

  it("treats a file with new lines since it was read as partly unread, and one past the limit as already due", async () => {
    const f = logFile("grow.jsonl", 28, [assistantLine({ id: "g1" })]);
    await ingestClaudeCode(db, [f], testSnapshot());
    writeFileSync(f, `${assistantLine({ id: "g1" })}\n${assistantLine({ id: "g2" })}\n`);
    const when = new Date(NOW.getTime() - 28 * DAY);
    utimesSync(f, when, when);
    logFile("old.jsonl", 35, [assistantLine({ id: "o1" })]);
    const r = retentionReport({ files: scanLogs(join(dir.path, "projects")), db, retentionDays: 30, retentionSource: "default", now: NOW, horizonDays: 7 });
    expect(r.goingWithin.unreadFiles).toBe(1);
    expect(r.alreadyPast).toMatchObject({ files: 1, unreadFiles: 1 });
  });

  it("says plainly when nothing is at risk, and when there are no logs at all", async () => {
    const f = logFile("ok.jsonl", 3, [assistantLine({ id: "k1" })]);
    await ingestClaudeCode(db, [f], testSnapshot());
    const calm = renderRetention(retentionReport({ files: scanLogs(join(dir.path, "projects")), db, retentionDays: 30, retentionSource: "settings", now: NOW, horizonDays: 7 }));
    expect(calm).toMatch(/nothing is due to be deleted/i);
    expect(calm).toMatch(/set in your settings/i);
    const none = renderRetention(retentionReport({ files: [], db, retentionDays: 30, retentionSource: "default", now: NOW, horizonDays: 7 }));
    expect(none).toMatch(/no log files/i);
  });

  it("warns, with the numbers and what to run, when unread files are about to be deleted", async () => {
    logFile("risky.jsonl", 27, [assistantLine({ id: "r1" })]);
    const text = renderRetention(retentionReport({ files: scanLogs(join(dir.path, "projects")), db, retentionDays: 30, retentionSource: "default", now: NOW, horizonDays: 7 }));
    expect(text).toMatch(/1 file/);
    expect(text).toMatch(/not in the ledger/i);
    expect(text).toMatch(/desk ingest/);
    expect(text).toMatch(/30 days \(the default\)/);
  });
});

describe("running ingest on a schedule", () => {
  it("prints a command for each platform without installing anything", () => {
    const win = scheduleSnippets("C:/work/desk", "win32");
    expect(win).toMatch(/schtasks \/Create/);
    expect(win).toContain("cd /d C:\\work\\desk &&");
    expect(win).toMatch(/ingest/);
    const mac = scheduleSnippets("/work/desk", "darwin");
    expect(mac).toMatch(/launchd|LaunchAgents/i);
    const linux = scheduleSnippets("/work/desk", "linux");
    expect(linux).toMatch(/crontab|cron/);
    expect(linux).toMatch(/\/work\/desk/);
    for (const text of [win, mac, linux]) expect(text).toMatch(/does not install/i);
  });
});
