import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { explicitLabel, type TaskMarker } from "./identity.ts";

/** Where explicit task labels are written: one JSON line per label, beside the status line readings. */
export const defaultMarkerPath = (env: Record<string, string | undefined> = process.env): string => env["DESK_TASKS_FILE"] ?? join(homedir(), ".desk", "tasks.jsonl");

export function readMarkers(path: string): TaskMarker[] {
  if (!existsSync(path)) return [];
  const out: TaskMarker[] = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const j = JSON.parse(line) as { ts?: unknown; label?: unknown; project?: unknown };
      if (typeof j.ts !== "string" || Number.isNaN(Date.parse(j.ts))) continue;
      if (j.label !== null && typeof j.label !== "string") continue;
      if (j.project !== null && j.project !== undefined && typeof j.project !== "string") continue;
      out.push({ ts: j.ts, label: j.label, project: typeof j.project === "string" ? j.project : null });
    } catch {
      // A line that is not JSON is skipped; the file is written by the owner's own tools and may be edited by hand.
    }
  }
  return out;
}

export function appendMarker(path: string, marker: TaskMarker): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(marker)}\n`);
}

/** The label a wrapper put in the environment, if there is one (a blank value is no label). */
export function labelFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  const v = env["DESK_TASK"]?.trim();
  return v === undefined || v === "" ? null : v;
}

/**
 * A wrapper put a label in DESK_TASK: record it for this folder, once. Returns whether a marker was written. It reads the
 * label file again before writing, so a session start that repeats the label does not grow the file.
 */
export function markFromEnv(markerPath: string, cwd: string, nowIso: string, env: Record<string, string | undefined> = process.env): boolean {
  const label = labelFromEnv(env);
  if (label === null) return false;
  const current = explicitLabel({ sessionId: "", projectPath: cwd, gitBranch: null, startedAt: nowIso }, readMarkers(markerPath));
  if (current === label) return false;
  appendMarker(markerPath, { ts: nowIso, label, project: cwd });
  return true;
}
