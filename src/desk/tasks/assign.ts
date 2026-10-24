import type { Ledger } from "../ledger/db.ts";
import { identify, TASK_METHODS, type TaskMarker, type TaskMethod } from "./identity.ts";
import { readMarkers } from "./markers.ts";

interface SessionRow {
  session_id: string;
  project_path: string | null;
  git_branch: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface TaskAssignment {
  sessions: number;
  tasks: number;
  byMethod: Record<TaskMethod, number>;
}

/**
 * Give every session a task and every task its time span. Safe to run again: it replaces the assignment, so a new
 * label or a newly ingested session is picked up, and an old label that was removed stops applying.
 */
export function assignTasks(db: Ledger, markers: readonly TaskMarker[]): TaskAssignment {
  const sessions = db.prepare("SELECT session_id, project_path, git_branch, started_at, ended_at FROM session").all() as unknown as SessionRow[];
  const byMethod: Record<TaskMethod, number> = { explicit: 0, ticket: 0, pull_request: 0, branch: 0, session: 0 };
  const tasks = new Map<string, { method: TaskMethod; label: string; project: string | null; first: string | null; last: string | null; ids: string[] }>();
  for (const s of sessions) {
    const id = identify({ sessionId: s.session_id, projectPath: s.project_path, gitBranch: s.git_branch, startedAt: s.started_at }, markers);
    const t = tasks.get(id.taskId) ?? { method: id.method, label: id.label, project: s.project_path, first: null, last: null, ids: [] };
    t.ids.push(s.session_id);
    if (s.started_at !== null && (t.first === null || s.started_at < t.first)) t.first = s.started_at;
    const end = s.ended_at ?? s.started_at;
    if (end !== null && (t.last === null || end > t.last)) t.last = end;
    tasks.set(id.taskId, t);
  }
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM task_session; DELETE FROM task;");
    const addTask = db.prepare("INSERT INTO task (task_id, method, label, project_path, first_ts, last_ts) VALUES (?, ?, ?, ?, ?, ?)");
    const addLink = db.prepare("INSERT INTO task_session (session_id, task_id) VALUES (?, ?)");
    for (const [taskId, t] of tasks) {
      addTask.run(taskId, t.method, t.label, t.project, t.first, t.last);
      byMethod[t.method] += 1;
      for (const sid of t.ids) addLink.run(sid, taskId);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { sessions: sessions.length, tasks: tasks.size, byMethod };
}

export interface MethodShare {
  method: TaskMethod;
  tasks: number;
  sessions: number;
  /** Estimated spend of the sessions in these tasks, in micro-dollars. */
  spendMicros: number;
}

/** How tasks were identified: per method, the tasks, their sessions and their spend. A method with no task is listed with zeros. */
export function methodShares(db: Ledger, sinceIso?: string, untilIso?: string): MethodShare[] {
  const rows = db
    .prepare(
      `SELECT t.method AS method, COUNT(DISTINCT t.task_id) AS tasks, COUNT(DISTINCT ts.session_id) AS sessions, COALESCE(SUM(c.total_micros), 0) AS spend
       FROM task t JOIN task_session ts ON ts.task_id = t.task_id
       LEFT JOIN model_call m ON m.session_id = ts.session_id AND (? IS NULL OR m.ts >= ?) AND (? IS NULL OR m.ts <= ?)
       LEFT JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated'
       GROUP BY t.method`,
    )
    .all(sinceIso ?? null, sinceIso ?? null, untilIso ?? null, untilIso ?? null) as unknown as { method: TaskMethod; tasks: number; sessions: number; spend: number }[];
  const by = new Map(rows.map((r) => [r.method, r]));
  return TASK_METHODS.map((method) => ({ method, tasks: by.get(method)?.tasks ?? 0, sessions: by.get(method)?.sessions ?? 0, spendMicros: by.get(method)?.spend ?? 0 }));
}

/** One task's spend and sessions, newest first, for the Outcomes screen and the weekly review. */
export function tasksWithSpend(db: Ledger, limit: number): { taskId: string; method: TaskMethod; label: string; sessions: number; spendMicros: number; lastTs: string | null }[] {
  return (
    db
      .prepare(
        `SELECT t.task_id AS taskId, t.method AS method, t.label AS label, COUNT(DISTINCT ts.session_id) AS sessions,
                COALESCE(SUM(c.total_micros), 0) AS spendMicros, t.last_ts AS lastTs
         FROM task t JOIN task_session ts ON ts.task_id = t.task_id
         LEFT JOIN model_call m ON m.session_id = ts.session_id
         LEFT JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated'
         GROUP BY t.task_id ORDER BY t.last_ts DESC LIMIT ?`,
      )
      .all(limit) as unknown as { taskId: string; method: TaskMethod; label: string; sessions: number; spendMicros: number; lastTs: string | null }[]
  );
}

/** Re-assign tasks from the ledger and the owner's label file. A sample is built from constructed data, so no one's labels are read for it. */
export function refreshTasks(db: Ledger, opts: { useLabels: boolean; markerPath: string }): TaskAssignment {
  return assignTasks(db, opts.useLabels ? readMarkers(opts.markerPath) : []);
}
