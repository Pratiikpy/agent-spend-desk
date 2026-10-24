import { existsSync, readFileSync, statSync } from "node:fs";

import type { Ledger } from "../ledger/db.ts";
import { findJsonlLogs } from "../ingest/discover.ts";

/**
 * Claude Code deletes a session log once it is older than `cleanupPeriodDays` (30 by default), at startup. The ledger
 * keeps what it has read, so a log that was read before it was deleted costs nothing; one that was not read is gone.
 * This module finds the logs that are about to be deleted and have not been read, so the person is told before it
 * happens. It reads the setting and the file dates and changes nothing.
 *
 * Sources: the default of 30 days and the deletion at startup are in Claude Code's documentation as reported by the
 * press and issue trackers on 2026-10-24; that deletion goes by the file's modification time is one user's observation,
 * not documented, so the report calls its dates estimates.
 */
export const DEFAULT_CLEANUP_DAYS = 30;
const DAY = 86_400_000;

export interface CleanupSetting {
  days: number;
  source: "settings" | "default";
}

export function readCleanupDays(settingsPath: string): CleanupSetting {
  const fallback: CleanupSetting = { days: DEFAULT_CLEANUP_DAYS, source: "default" };
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
    const v = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)["cleanupPeriodDays"] : undefined;
    return typeof v === "number" && Number.isInteger(v) && v >= 1 ? { days: v, source: "settings" } : fallback;
  } catch {
    return fallback;
  }
}

export interface LogFile {
  path: string;
  mtimeMs: number;
  sizeBytes: number;
}

export function scanLogs(root: string): LogFile[] {
  if (!existsSync(root)) return [];
  const out: LogFile[] = [];
  for (const path of findJsonlLogs(root)) {
    try {
      const st = statSync(path);
      out.push({ path, mtimeMs: st.mtimeMs, sizeBytes: st.size });
    } catch {
      /* a file deleted between the walk and the stat is simply gone */
    }
  }
  return out;
}

export interface Bucket {
  files: number;
  bytes: number;
  unreadFiles: number;
  unreadBytes: number;
  /** Whole days until the first of these files is due, for files not yet past the limit. */
  daysUntilFirst: number | null;
}

export interface RetentionReport {
  retentionDays: number;
  retentionSource: CleanupSetting["source"];
  horizonDays: number;
  files: number;
  bytes: number;
  oldestAgeDays: number | null;
  /** Files that will pass the limit within the horizon. */
  goingWithin: Bucket;
  /** Files already past the limit that are still on disk (Claude Code has not run its cleanup since). */
  alreadyPast: Bucket;
}

export interface RetentionInput {
  files: readonly LogFile[];
  db: Ledger;
  retentionDays: number;
  retentionSource: CleanupSetting["source"];
  now: Date;
  horizonDays: number;
}

function emptyBucket(): Bucket {
  return { files: 0, bytes: 0, unreadFiles: 0, unreadBytes: 0, daysUntilFirst: null };
}

export function retentionReport(input: RetentionInput): RetentionReport {
  const read = new Map<string, number>();
  for (const row of input.db.prepare("SELECT path, offset_bytes FROM ingest_source").all() as { path: string; offset_bytes: number }[]) read.set(row.path, row.offset_bytes);
  const goingWithin = emptyBucket();
  const alreadyPast = emptyBucket();
  let oldest: number | null = null;
  let bytes = 0;
  let firstRemaining: number | null = null;
  for (const f of input.files) {
    bytes += f.sizeBytes;
    const ageMs = input.now.getTime() - f.mtimeMs;
    const ageDays = ageMs / DAY;
    if (oldest === null || ageDays > oldest) oldest = ageDays;
    const remainingDays = input.retentionDays - ageDays;
    const bucket = remainingDays <= 0 ? alreadyPast : remainingDays < input.horizonDays ? goingWithin : null;
    if (!bucket) continue;
    const unread = Math.max(0, f.sizeBytes - (read.get(f.path) ?? 0));
    bucket.files += 1;
    bucket.bytes += f.sizeBytes;
    if (unread > 0) {
      bucket.unreadFiles += 1;
      bucket.unreadBytes += unread;
    }
    if (bucket === goingWithin && (firstRemaining === null || remainingDays < firstRemaining)) firstRemaining = remainingDays;
  }
  if (firstRemaining !== null) goingWithin.daysUntilFirst = Math.max(0, Math.ceil(firstRemaining - 1e-6));
  return {
    retentionDays: input.retentionDays,
    retentionSource: input.retentionSource,
    horizonDays: input.horizonDays,
    files: input.files.length,
    bytes,
    oldestAgeDays: oldest === null ? null : Math.floor(oldest + 1e-6),
    goingWithin,
    alreadyPast,
  };
}

const size = (bytes: number): string => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);
const plural = (n: number, word: string): string => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

export function renderRetention(r: RetentionReport): string {
  if (r.files === 0) return "There are no log files to check.";
  const setting = r.retentionSource === "settings" ? "set in your settings" : "the default";
  const lines = [
    `Claude Code deletes logs older than ${r.retentionDays} days (${setting}). ${plural(r.files, "log file")} on disk (${size(r.bytes)}); the oldest is ${r.oldestAgeDays} days old.`,
  ];
  let risk = false;
  if (r.alreadyPast.files > 0) {
    lines.push(`${plural(r.alreadyPast.files, "file")} (${size(r.alreadyPast.bytes)}) are already past that age and still on disk, so Claude Code has either not run its cleanup since or is not deleting them here.${r.alreadyPast.unreadFiles > 0 ? ` ${plural(r.alreadyPast.unreadFiles, "of them")} (${size(r.alreadyPast.unreadBytes)} unread) is not in the ledger and may be lost at its next cleanup.` : ""}`);
    risk ||= r.alreadyPast.unreadFiles > 0;
  }
  if (r.goingWithin.files > 0) {
    const first = r.goingWithin.daysUntilFirst === null ? "" : `, the first in about ${plural(r.goingWithin.daysUntilFirst, "day")}`;
    lines.push(`${plural(r.goingWithin.files, "file")} (${size(r.goingWithin.bytes)}) will pass that age within ${r.horizonDays} days${first}.${r.goingWithin.unreadFiles > 0 ? ` ${plural(r.goingWithin.unreadFiles, "of them")} (${size(r.goingWithin.unreadBytes)} unread) is not in the ledger yet.` : " All of it is in the ledger."}`);
    risk ||= r.goingWithin.unreadFiles > 0;
  }
  if (risk) lines.push("Read them now with: desk ingest. To keep logs longer, raise cleanupPeriodDays in ~/.claude/settings.json (this command never edits it).");
  else if (r.alreadyPast.files === 0 && r.goingWithin.files === 0) lines.push(`Nothing is due to be deleted in the next ${r.horizonDays} days.`);
  lines.push("The dates are estimates: Claude Code's documentation says logs older than the period are deleted at startup, and one user reports that it goes by the file's modification time.");
  return lines.join("\n");
}

/** Commands that run `desk ingest` once a day. Printed for the person to apply; this module installs nothing. */
export function scheduleSnippets(repoRoot: string, platform: NodeJS.Platform): string {
  const root = repoRoot.replace(/\\/g, "/").replace(/\/$/, "");
  const note = "This only prints the command: desk does not install it. Run it yourself, and remove it with the matching delete command.";
  if (platform === "win32") {
    return [
      `Windows (Task Scheduler), once a day at 09:00:`,
      `schtasks /Create /SC DAILY /ST 09:00 /TN "desk ingest" /TR "cmd /c cd /d ${root.replace(/\//g, "\\")} && npm run desk --silent -- ingest"`,
      `Remove it with: schtasks /Delete /TN "desk ingest" /F`,
      note,
    ].join("\n");
  }
  if (platform === "darwin") {
    return [
      `macOS (launchd). Save as ~/Library/LaunchAgents/desk.ingest.plist, then run: launchctl load ~/Library/LaunchAgents/desk.ingest.plist`,
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<plist version="1.0"><dict>`,
      `  <key>Label</key><string>desk.ingest</string>`,
      `  <key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>cd ${root} &amp;&amp; npm run desk --silent -- ingest</string></array>`,
      `  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>`,
      `</dict></plist>`,
      note,
    ].join("\n");
  }
  return [`Linux (cron), once a day at 09:00. Add this line with crontab -e:`, `0 9 * * * cd ${root} && npm run desk --silent -- ingest`, note].join("\n");
}
