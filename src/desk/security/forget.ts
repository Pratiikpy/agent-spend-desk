import { rollbackQuietly } from "../ledger/db.ts";
import { sealLedger } from "../ledger/chain.ts";
import type { Ledger } from "../ledger/db.ts";

/**
 * Forgetting: the user's right to take data back out. It removes sessions and everything that hangs off them (calls,
 * costs, tool calls, edits, results, prompts, outcomes, commit links), the log-file cursors that would otherwise skip
 * those logs on the next read, and, for a whole forget, the repositories and commits. Then it truncates the
 * write-ahead log and vacuums, so removed text is not left in free pages. Price snapshots are public data and stay.
 * It refuses to run when told nothing, so a call with no scope cannot wipe a ledger by accident.
 */
export interface ForgetScope {
  /** Sessions whose project path contains this text. */
  project?: string;
  /** Sessions that started before this day (YYYY-MM-DD). */
  before?: string;
  /** Everything. */
  all?: boolean;
}

// Where the Desk keeps files outside the ledger that hold the same kinds of data; a whole forget removes them too (see `forgetFiles`).
export interface ForgetReport {
  sessions: number;
  calls: number;
}

const BY_SESSION = ["tool_result", "human_prompt", "session_compaction", "delegation_edge", "workflow_run", "untrusted_flag", "session_outcome", "session_commit", "reported_cost", "reported_model_usage", "limit_sample", "task_session", "owner_answer"] as const;

export function forgetPreview(db: Ledger, scope: ForgetScope): ForgetReport {
  const ids = chooseSessions(db, scope);
  let calls = 0;
  for (const id of ids) calls += Number((db.prepare("SELECT COUNT(*) AS n FROM model_call WHERE session_id = ?").get(id) as { n: number }).n);
  return { sessions: ids.length, calls };
}

function chooseSessions(db: Ledger, scope: ForgetScope): string[] {
  if (!scope.all && scope.project === undefined && scope.before === undefined) {
    throw new Error("forget needs a scope: give project, before or all");
  }
  if (scope.before !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(scope.before)) throw new Error("before must be a day, YYYY-MM-DD");
  if (scope.project !== undefined && scope.project.trim().length < 3) throw new Error("project must be at least 3 characters, so a short text cannot match everything");

  const ids = new Set<string>();
  if (scope.all) for (const r of db.prepare("SELECT session_id FROM session").all() as { session_id: string }[]) ids.add(r.session_id);
  if (scope.project !== undefined) {
    for (const r of db.prepare("SELECT session_id FROM session WHERE instr(project_path, ?) > 0").all(scope.project) as { session_id: string }[]) ids.add(r.session_id);
  }
  if (scope.before !== undefined) {
    for (const r of db.prepare("SELECT s.session_id FROM session s WHERE COALESCE((SELECT MIN(substr(m.ts, 1, 10)) FROM model_call m WHERE m.session_id = s.session_id), substr(s.started_at, 1, 10), '9999-12-31') < ?").all(scope.before) as { session_id: string }[]) ids.add(r.session_id);
  }

  return [...ids];
}

export function forgetLedger(db: Ledger, scope: ForgetScope): ForgetReport {
  const ids = chooseSessions(db, scope);
  let calls = 0;
  db.exec("BEGIN");
  try {
    const del = (sql: string, id: string): number => Number(db.prepare(sql).run(id).changes);
    for (const id of ids) {
      del("DELETE FROM session_edit WHERE session_id = ?", id);
      del("DELETE FROM tool_call WHERE session_id = ?", id);
      del("DELETE FROM call_reported_cost WHERE call_id IN (SELECT call_id FROM model_call WHERE session_id = ?)", id);
      del("DELETE FROM cost_event_history WHERE call_id IN (SELECT call_id FROM model_call WHERE session_id = ?)", id);
      del("DELETE FROM cost_event WHERE call_id IN (SELECT call_id FROM model_call WHERE session_id = ?)", id);
      calls += del("DELETE FROM model_call WHERE session_id = ?", id);
      for (const t of BY_SESSION) del(`DELETE FROM ${t} WHERE session_id = ?`, id);
      del("DELETE FROM session WHERE session_id = ?", id);
    }
    // A log-file cursor with no call left pointing at it would make the next ingest skip the file's old lines.
    // A task with no session left, and a repricing with no cost left to explain, say nothing and are dropped.
    db.exec("DELETE FROM task WHERE task_id NOT IN (SELECT DISTINCT task_id FROM task_session)");
    db.exec("DELETE FROM repricing WHERE repricing_id NOT IN (SELECT DISTINCT repricing_id FROM cost_event_history)");
    db.exec("DELETE FROM ingest_source WHERE id NOT IN (SELECT DISTINCT source_id FROM model_call WHERE source_id IS NOT NULL)");
    // The Desk's own model calls are not a session's. A whole forget takes them all, and a forget before a date takes the ones before it.
    if (scope.all) db.exec("DELETE FROM desk_call");
    else if (scope.before !== undefined) db.prepare("DELETE FROM desk_call WHERE ts < ?").run(`${scope.before}T00:00:00.000Z`);
    // A whole forget also takes what the owner imported or the Desk decided about the money: invoices with their lines, reconciliations and alert history.
    if (scope.all) db.exec("DELETE FROM session_commit; DELETE FROM git_commit; DELETE FROM repo; DELETE FROM ingest_run; DELETE FROM billed_line; DELETE FROM invoice; DELETE FROM reconciliation; DELETE FROM alert_event; DELETE FROM alert_state; DELETE FROM owner_answer; DELETE FROM repricing;");
    if (!scope.all && scope.project !== undefined) {
      // A repository whose path names the project goes with it, together with its commits and their links.
      const repos = (db.prepare("SELECT repo_id FROM repo WHERE instr(root, ?) > 0").all(scope.project) as { repo_id: number }[]).map((r) => r.repo_id);
      for (const id of repos) {
        db.prepare("DELETE FROM session_commit WHERE repo_id = ?").run(id);
        db.prepare("DELETE FROM git_commit WHERE repo_id = ?").run(id);
        db.prepare("DELETE FROM repo WHERE repo_id = ?").run(id);
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    rollbackQuietly(db);
    throw e;
  }
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    /* an in-memory ledger has no write-ahead log */
  }
  db.exec("VACUUM");
  // A forget is an event too: the sources' digests are taken again over what is left, so the chain still holds and a deletion made by hand does not.
  sealLedger(db, "forget", { all: scope.all === true, by_project: scope.project !== undefined, before: scope.before ?? null, sessions: ids.length, calls }, { sources: "all" });
  return { sessions: ids.length, calls };
}
