import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Claude Code's plan limit, from the one place it is documented: the JSON Claude Code sends a status line script on
 * stdin (https://code.claude.com/docs/en/statusline, read 2026-10-24). For claude.ai Pro and Max users it carries
 * `rate_limits.five_hour` and `rate_limits.seven_day`, each with `used_percentage` (0 to 100) and `resets_at` (epoch
 * seconds), after the session's first API response. This module keeps a small sample of those fields (never the working
 * directory, the branch, a prompt or a path), prints a short gauge line, and writes samples to a log that
 * `desk ingest --agent statusline` reads into the ledger beside Codex's readings.
 *
 * It uses only Node built-ins so that the status line command starts fast: Claude Code runs it often.
 */
export interface LimitReading {
  pct: number;
  /** Seconds since the epoch. */
  resetsAt: number;
}

export interface StatuslineSample {
  ts: string;
  sessionId: string | null;
  model: string | null;
  version: string | null;
  costUsd: number | null;
  contextPct: number | null;
  fiveHour: LimitReading | null;
  sevenDay: LimitReading | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function reading(v: unknown): LimitReading | null {
  if (!isObject(v)) return null;
  const pct = num(v["used_percentage"]);
  const resetsAt = num(v["resets_at"]);
  if (pct === null || resetsAt === null || pct < 0 || pct > 100 || resetsAt <= 0) return null;
  return { pct, resetsAt };
}

export function parseStatusline(input: unknown, now: Date): StatuslineSample | null {
  if (!isObject(input)) return null;
  const model = input["model"];
  const cost = input["cost"];
  const ctx = input["context_window"];
  const limits = input["rate_limits"];
  return {
    ts: now.toISOString(),
    sessionId: str(input["session_id"]),
    model: isObject(model) ? (str(model["id"]) ?? str(model["display_name"])) : null,
    version: str(input["version"]),
    costUsd: isObject(cost) ? num(cost["total_cost_usd"]) : null,
    contextPct: isObject(ctx) ? num(ctx["used_percentage"]) : null,
    fiveHour: isObject(limits) ? reading(limits["five_hour"]) : null,
    sevenDay: isObject(limits) ? reading(limits["seven_day"]) : null,
  };
}

function until(resetsAtSec: number, now: Date): string | null {
  const minutes = Math.round((resetsAtSec * 1000 - now.getTime()) / 60_000);
  if (minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`;
}

/** One line for the status line: model, 5-hour and weekly percent (a window that has reset is left out, as Claude Code does), cost, context. */
export function gauge(s: StatuslineSample, now: Date): string {
  const parts: string[] = [];
  if (s.model) parts.push(s.model);
  if (s.fiveHour) {
    const left = until(s.fiveHour.resetsAt, now);
    if (left !== null) parts.push(`5h ${Math.round(s.fiveHour.pct)}% (resets in ${left})`);
  }
  if (s.sevenDay && until(s.sevenDay.resetsAt, now) !== null) parts.push(`wk ${Math.round(s.sevenDay.pct)}%`);
  if (s.costUsd !== null) parts.push(`$${s.costUsd.toFixed(2)}`);
  if (s.contextPct !== null) parts.push(`ctx ${Math.round(s.contextPct)}%`);
  return parts.join(" · ");
}

export function statuslineLogPath(env: Record<string, string | undefined> = process.env): string {
  return env["DESK_STATUSLINE_LOG"] ?? join(homedir(), ".desk", "statusline.jsonl");
}

const same = (a: LimitReading | null, b: LimitReading | null): boolean => (a === null || b === null ? a === b : a.pct === b.pct && a.resetsAt === b.resetsAt);

function tail(path: string, bytes: number): string {
  const size = statSync(path).size;
  const fd = openSync(path, "r");
  try {
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function parseLine(line: string): StatuslineSample | null {
  try {
    const o = JSON.parse(line) as unknown;
    if (!isObject(o) || typeof o["ts"] !== "string" || Number.isNaN(Date.parse(o["ts"]))) return null;
    return o as unknown as StatuslineSample;
  } catch {
    return null;
  }
}

export interface RecordOptions {
  /** A sample with nothing changed is kept only this often. */
  minGapMs?: number;
  /** When the log is longer than this, the older half is dropped. */
  maxBytes?: number;
}

/**
 * Append a sample if the session's limits changed since its last sample or a minute has passed, so the log holds the
 * readings that matter and not every redraw. Returns whether it wrote one. The log is capped.
 */
export function recordSample(path: string, s: StatuslineSample, opts: RecordOptions = {}): boolean {
  const minGap = opts.minGapMs ?? 60_000;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  if (s.fiveHour === null && s.sevenDay === null) return false;
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const size = statSync(path).size;
    if (size > maxBytes) {
      const keep = readSamples(path).slice(-Math.floor(readSamples(path).length / 2));
      writeFileSync(path, keep.map((x) => `${JSON.stringify(x)}\n`).join(""));
    } else {
      const lines = tail(path, 64 * 1024).split("\n");
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const prev = parseLine(lines[i] as string);
        if (!prev || prev.sessionId !== s.sessionId) continue;
        const unchanged = same(prev.fiveHour, s.fiveHour) && same(prev.sevenDay, s.sevenDay);
        if (unchanged && Date.parse(s.ts) - Date.parse(prev.ts) < minGap) return false;
        break;
      }
    }
  }
  appendFileSync(path, `${JSON.stringify(s)}\n`);
  return true;
}

export function readSamples(path: string): StatuslineSample[] {
  if (!existsSync(path)) return [];
  const out: StatuslineSample[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim() === "" ? null : parseLine(line);
    if (s) out.push(s);
  }
  return out;
}

/** The setting to add to `~/.claude/settings.json`. Printed for the user to apply: this product never edits Claude Code's settings. */
export function installSnippet(repoRoot: string): string {
  const root = repoRoot.replace(/\\/g, "/").replace(/\/$/, "");
  return `"statusLine": { "type": "command", "command": "node ${root}/src/desk/statusline/main.ts" }`;
}
