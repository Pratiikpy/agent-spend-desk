import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { CAPTURE_SCHEMA_VERSION, DEFAULT_CAPTURE_DB } from "../capture/store.ts";

/**
 * The owner's own tasks, read for the Canary screen (DF-036): how many candidates were found in their history, which were accepted and how well each is decided by tests, the
 * suites frozen from them, and the replays run on them. The screen only reads: accepting or rejecting a task is a command, because the UI never changes anything. The store is
 * opened read-only, so looking at it cannot create or migrate it.
 */
export interface TaskLine {
  kind: string;
  area: string;
  repo: string;
  oracle: "strong" | "weak" | "none" | null;
  diffLines: number;
  heldOut: boolean | null;
  source: "history" | "lab";
}

export interface TasksPanel {
  state: "none" | "older" | "ok";
  hint: string;
  counts: Record<string, number>;
  accepted: TaskLine[];
  families: { kind: string; area: string; tasks: number }[];
  suites: { hash: string; createdAt: string; tasks: number; heldOut: number; families: number }[];
  swaps: { runId: string; createdAt: string; baseline: string; candidate: string; status: string; verdict: string | null; why: string | null }[];
}

const NONE: TasksPanel = {
  state: "none",
  hint: "No tasks have been captured yet. desk capture candidates looks through your history for work that has tests; desk capture compute runs them; desk capture accept keeps the good ones.",
  counts: {},
  accepted: [],
  families: [],
  suites: [],
  swaps: [],
};

export function tasksPanel(path: string = DEFAULT_CAPTURE_DB): TasksPanel {
  if (!existsSync(path)) return NONE;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version < CAPTURE_SCHEMA_VERSION) return { ...NONE, state: "older", hint: "The capture store is from an older build. Any desk capture command brings it up to date." };
    const counts: Record<string, number> = {};
    for (const r of db.prepare("SELECT status, COUNT(*) n FROM canary_task GROUP BY status").all() as { status: string; n: number }[]) counts[r.status] = r.n;
    const accepted = (db.prepare("SELECT kind, area, repo_label AS repo, oracle, diff_lines AS diffLines, held_out AS heldOut, source FROM canary_task WHERE status = 'accepted' ORDER BY kind, area, task_id LIMIT 60").all() as { kind: string; area: string; repo: string; oracle: TaskLine["oracle"]; diffLines: number; heldOut: number | null; source: TaskLine["source"] }[]).map((t) => ({ ...t, heldOut: t.heldOut === null ? null : t.heldOut === 1 }));
    const families = db.prepare("SELECT kind, area, COUNT(*) tasks FROM canary_task WHERE status = 'accepted' GROUP BY kind, area ORDER BY kind, area").all() as TasksPanel["families"];
    const suites = (db.prepare("SELECT hash, created_at AS createdAt, task_ids_json AS ids, held_out_json AS held, families_json AS fams FROM canary_suite ORDER BY created_at DESC LIMIT 5").all() as { hash: string; createdAt: string; ids: string; held: string; fams: string }[]).map((s) => ({ hash: s.hash, createdAt: s.createdAt, tasks: (JSON.parse(s.ids) as unknown[]).length, heldOut: (JSON.parse(s.held) as unknown[]).length, families: (JSON.parse(s.fams) as unknown[]).length }));
    const swaps = (db.prepare("SELECT run_id AS runId, created_at AS createdAt, baseline, candidate, status, report_json AS report FROM replay_run ORDER BY created_at DESC LIMIT 5").all() as { runId: string; createdAt: string; baseline: string; candidate: string; status: string; report: string | null }[]).map((r) => {
      const rep = r.report ? (JSON.parse(r.report) as { verdict?: string; why?: string }) : null;
      return { runId: r.runId, createdAt: r.createdAt, baseline: r.baseline, candidate: r.candidate, status: r.status, verdict: rep?.verdict ?? null, why: rep?.why ?? null };
    });
    return { state: "ok", hint: "", counts, accepted, families, suites, swaps };
  } catch {
    return { ...NONE, hint: "The capture store could not be read." };
  } finally {
    db?.close();
  }
}
