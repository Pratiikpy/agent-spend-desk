import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Gauge } from "./gauge.ts";

/**
 * Keeping the gauge fresh (DF-003): a loop that renders once, then again whenever a log file changes, and a small cache the
 * Claude Code status line command reads so that it can show the burn rate and the split without opening the ledger. The
 * cache uses only what is needed for one line and is ignored once it is ten minutes old.
 */
export interface WatchOptions {
  /** The newest modification time (ms) across the log files; changes when a log grows or a new one appears. */
  poll: () => number;
  /** Read what is new and draw the gauge. Runs once at the start and again after each change. */
  refresh: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  intervalMs: number;
  shouldStop: () => boolean;
}

/** Returns the number of times it refreshed. */
export async function watchLogs(o: WatchOptions): Promise<number> {
  let refreshed = 0;
  let seen = o.poll();
  await o.refresh();
  refreshed += 1;
  while (!o.shouldStop()) {
    await o.sleep(o.intervalMs);
    if (o.shouldStop()) break;
    const now = o.poll();
    if (now !== seen) {
      seen = now;
      await o.refresh();
      refreshed += 1;
    }
  }
  return refreshed;
}

export function newestMtimeMs(files: readonly string[]): number {
  let newest = 0;
  for (const f of files) {
    try {
      newest = Math.max(newest, statSync(f).mtimeMs);
    } catch {
      /* a file that vanished between the listing and the stat does not move the clock */
    }
  }
  return newest;
}

export const gaugeCachePath = (env: Record<string, string | undefined> = process.env): string => env["DESK_GAUGE_CACHE"] ?? join(homedir(), ".desk", "gauge.json");

interface Cache {
  at: string;
  hours: number;
  spendMicros: number | null;
  burnMicrosPerHour: number | null;
  top: { label: string; share: number } | null;
}

export function writeGaugeCache(path: string, g: Gauge): void {
  const cache: Cache = {
    at: g.asOf,
    hours: g.hours,
    spendMicros: g.spendMicros,
    burnMicrosPerHour: g.burnMicrosPerHour,
    top: g.split[0] ? { label: g.split[0].label.split(" (")[0]!.toLowerCase(), share: g.split[0].share } : null,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cache)}\n`);
}

const usd = (micros: number): string => `$${(micros / 1_000_000).toFixed(micros >= 100_000_000 ? 0 : 2)}`;

/** What the status line appends: the burn rate and the biggest cause, from the cache, or null when it is missing, unreadable or old. */
export function gaugeSuffix(path: string, nowMs: number, maxAgeMs = 600_000): string | null {
  try {
    if (!existsSync(path)) return null;
    const c = JSON.parse(readFileSync(path, "utf8")) as Cache;
    const age = nowMs - Date.parse(c.at);
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return null;
    const parts: string[] = [];
    if (c.burnMicrosPerHour !== null) parts.push(`${usd(c.burnMicrosPerHour)}/h`);
    if (c.spendMicros !== null) parts.push(`${usd(c.spendMicros)}/${c.hours}h`);
    if (c.top) parts.push(`${c.top.label} ${Math.round(c.top.share * 100)}%`);
    return parts.length === 0 ? null : parts.join(" · ");
  } catch {
    return null;
  }
}
