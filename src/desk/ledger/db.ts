import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Ledger = DatabaseSync;

const SCHEMA_V1 = `
CREATE TABLE ingest_source (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('claude_code')),
  path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  offset_bytes INTEGER NOT NULL CHECK (offset_bytes >= 0),
  last_ingested_at TEXT NOT NULL
);

CREATE TABLE ingest_run (
  run_id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  files INTEGER NOT NULL,
  lines_read INTEGER NOT NULL,
  calls_new INTEGER NOT NULL,
  calls_merged INTEGER NOT NULL,
  malformed_lines INTEGER NOT NULL,
  truncated_tails INTEGER NOT NULL,
  usage_conflicts INTEGER NOT NULL
);

CREATE TABLE session (
  session_id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  project_path TEXT,
  git_branch TEXT,
  tool_version TEXT,
  started_at TEXT,
  ended_at TEXT
);

CREATE TABLE model_call (
  call_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session (session_id),
  request_id TEXT,
  ts TEXT NOT NULL,
  model TEXT NOT NULL,
  is_sidechain INTEGER NOT NULL CHECK (is_sidechain IN (0, 1)),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  reasoning_tokens INTEGER NOT NULL CHECK (reasoning_tokens >= 0),
  cache_read_tokens INTEGER NOT NULL CHECK (cache_read_tokens >= 0),
  cache_write_5m_tokens INTEGER NOT NULL CHECK (cache_write_5m_tokens >= 0),
  cache_write_1h_tokens INTEGER NOT NULL CHECK (cache_write_1h_tokens >= 0),
  cache_ttl_basis TEXT NOT NULL CHECK (cache_ttl_basis IN ('reported', 'assumed-5m')),
  cache_split_mismatch INTEGER NOT NULL CHECK (cache_split_mismatch IN (0, 1)),
  service_tier TEXT,
  speed TEXT,
  stop_reason TEXT,
  is_api_error INTEGER NOT NULL CHECK (is_api_error IN (0, 1)),
  tool_names TEXT NOT NULL DEFAULT '[]',
  block_lines INTEGER NOT NULL DEFAULT 1 CHECK (block_lines >= 1),
  usage_conflicts INTEGER NOT NULL DEFAULT 0 CHECK (usage_conflicts >= 0),
  source_id INTEGER REFERENCES ingest_source (id)
);
CREATE INDEX model_call_session_ts ON model_call (session_id, ts);
CREATE INDEX model_call_ts ON model_call (ts);

CREATE TABLE price_snapshot (
  snapshot_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  license TEXT NOT NULL,
  upstream_sha256 TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  note TEXT NOT NULL
);

-- A cost is a list-price estimate computed from logged tokens, never a billing receipt.
CREATE TABLE cost_event (
  call_id TEXT PRIMARY KEY REFERENCES model_call (call_id),
  class TEXT NOT NULL CHECK (class IN ('estimated', 'unpriced')),
  snapshot_id TEXT REFERENCES price_snapshot (snapshot_id),
  matched_as TEXT,
  ladder_step TEXT,
  unpriced_reason TEXT,
  total_micros INTEGER,
  input_micros INTEGER,
  output_micros INTEGER,
  cache_read_micros INTEGER,
  cache_write_5m_micros INTEGER,
  cache_write_1h_micros INTEGER,
  CHECK ((class = 'estimated') = (total_micros IS NOT NULL)),
  CHECK ((class = 'estimated') = (snapshot_id IS NOT NULL)),
  CHECK ((class = 'unpriced') = (unpriced_reason IS NOT NULL)),
  CHECK (class = 'unpriced' OR
         total_micros = input_micros + output_micros + cache_read_micros + cache_write_5m_micros + cache_write_1h_micros)
);

CREATE VIEW v_cost_by_day_model AS
SELECT substr(m.ts, 1, 10) AS day,
       m.model AS model,
       COUNT(*) AS calls,
       SUM(m.input_tokens) AS input_tokens,
       SUM(m.output_tokens) AS output_tokens,
       SUM(m.cache_read_tokens) AS cache_read_tokens,
       SUM(m.cache_write_5m_tokens + m.cache_write_1h_tokens) AS cache_write_tokens,
       SUM(c.total_micros) AS estimated_micros,
       SUM(CASE WHEN c.class = 'unpriced' THEN 1 ELSE 0 END) AS unpriced_calls
FROM model_call m JOIN cost_event c ON c.call_id = m.call_id
GROUP BY day, model;
`;


const SCHEMA_V2 = `
CREATE TABLE tool_call (
  tool_use_id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL REFERENCES model_call (call_id),
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX tool_call_call ON tool_call (call_id);
CREATE INDEX tool_call_session_ts ON tool_call (session_id, ts);

-- A result can be read before or after its call is known, so it has its own table.
CREATE TABLE tool_result (
  tool_use_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  is_error INTEGER NOT NULL CHECK (is_error IN (0, 1)),
  result_chars INTEGER NOT NULL CHECK (result_chars >= 0)
);

-- Only that a person sent a prompt, and when. The text is never stored.
CREATE TABLE human_prompt (
  prompt_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX human_prompt_session_ts ON human_prompt (session_id, ts);
`;

const SCHEMA_V3 = `
-- Files a session wrote to (from file-editing tools). Local only: used to link sessions to commits.
CREATE TABLE session_edit (
  tool_use_id TEXT PRIMARY KEY REFERENCES tool_call (tool_use_id),
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX session_edit_session ON session_edit (session_id);

CREATE TABLE repo (
  repo_id INTEGER PRIMARY KEY,
  root TEXT NOT NULL UNIQUE,
  default_ref TEXT NOT NULL,
  scanned_at TEXT NOT NULL
);

CREATE TABLE git_commit (
  repo_id INTEGER NOT NULL REFERENCES repo (repo_id),
  sha TEXT NOT NULL,
  authored_at TEXT NOT NULL,
  author_email TEXT NOT NULL,
  agent_trailer INTEGER NOT NULL CHECK (agent_trailer IN (0, 1)),
  files TEXT NOT NULL,
  merged INTEGER NOT NULL CHECK (merged IN (0, 1)),
  reverted INTEGER NOT NULL CHECK (reverted IN (0, 1)),
  PRIMARY KEY (repo_id, sha)
);
CREATE INDEX git_commit_time ON git_commit (authored_at);

CREATE TABLE session_commit (
  session_id TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  sha TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('explicit', 'trailer_window', 'file_overlap', 'time_window')),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  PRIMARY KEY (session_id, repo_id, sha),
  FOREIGN KEY (repo_id, sha) REFERENCES git_commit (repo_id, sha)
);

-- The furthest a session's work got, derived from git alone. A state needing CI (checks_green) is not claimed here.
CREATE TABLE session_outcome (
  session_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('unlinked', 'committed', 'merged', 'kept', 'reverted')),
  best_confidence TEXT CHECK (best_confidence IN ('high', 'medium', 'low')),
  commits INTEGER NOT NULL,
  computed_at TEXT NOT NULL
);
`;

// The cost Claude Code recorded for itself, kept apart from every estimate so that a computed figure can never overwrite it.
const SCHEMA_V4 = `
CREATE TABLE reported_cost (
  session_id TEXT NOT NULL,
  process_start_ms INTEGER NOT NULL,
  total_micros INTEGER NOT NULL CHECK (total_micros >= 0),
  api_duration_ms INTEGER,
  lines_added INTEGER,
  lines_removed INTEGER,
  unknown_model_cost INTEGER NOT NULL CHECK (unknown_model_cost IN (0, 1)),
  -- The time of the last message read before this record in its file: the counter covers nothing later than that.
  observed_ts TEXT,
  PRIMARY KEY (session_id, process_start_ms)
);

CREATE TABLE reported_model_usage (
  session_id TEXT NOT NULL,
  process_start_ms INTEGER NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  thinking_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  cost_micros INTEGER NOT NULL CHECK (cost_micros >= 0),
  PRIMARY KEY (session_id, process_start_ms, model)
);
`;

// A second tool's logs (Codex), and the plan-limit readings those logs carry. A source's kind was limited to the first tool by a CHECK that
// SQLite cannot widen in place, so the table is rebuilt. That has to be done with reference checking off, and the references are checked
// again before the migration commits (see `migrate`).
const FOREIGN_KEYS_OFF = "-- desk:foreign-keys-off";
const SCHEMA_V5 = `${FOREIGN_KEYS_OFF}

CREATE TABLE ingest_source_v5 (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('claude_code', 'codex')),
  path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  offset_bytes INTEGER NOT NULL CHECK (offset_bytes >= 0),
  last_ingested_at TEXT NOT NULL
);
INSERT INTO ingest_source_v5 SELECT id, kind, path, size_bytes, offset_bytes, last_ingested_at FROM ingest_source;
DROP TABLE ingest_source;
ALTER TABLE ingest_source_v5 RENAME TO ingest_source;

-- What a tool itself says about the plan's rate limit: percent used in a window, and when the window resets.
CREATE TABLE limit_sample (
  tool TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('primary', 'secondary')),
  window_minutes INTEGER NOT NULL CHECK (window_minutes > 0),
  used_percent REAL NOT NULL CHECK (used_percent >= 0),
  resets_at INTEGER NOT NULL,
  plan_type TEXT,
  limit_id TEXT,
  PRIMARY KEY (tool, session_id, ts, kind)
);
CREATE INDEX limit_sample_window ON limit_sample (tool, kind, resets_at, ts);
`;

// A third tool's sessions (OpenCode, read from its database). The source kind is widened the same way as in version 5.
const SCHEMA_V6 = `${FOREIGN_KEYS_OFF}

CREATE TABLE ingest_source_v6 (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('claude_code', 'codex', 'opencode')),
  path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  offset_bytes INTEGER NOT NULL CHECK (offset_bytes >= 0),
  last_ingested_at TEXT NOT NULL
);
INSERT INTO ingest_source_v6 SELECT id, kind, path, size_bytes, offset_bytes, last_ingested_at FROM ingest_source;
DROP TABLE ingest_source;
ALTER TABLE ingest_source_v6 RENAME TO ingest_source;
`;

// Which task a session belongs to (DF-030). Rebuilt from the sessions and the owner's labels each time, so it holds no history of its own.
const SCHEMA_V7 = `
CREATE TABLE task (
  task_id TEXT PRIMARY KEY,
  method TEXT NOT NULL CHECK (method IN ('explicit', 'ticket', 'pull_request', 'branch', 'session')),
  label TEXT NOT NULL,
  project_path TEXT,
  first_ts TEXT,
  last_ts TEXT
);
CREATE TABLE task_session (
  session_id TEXT PRIMARY KEY REFERENCES session (session_id),
  task_id TEXT NOT NULL REFERENCES task (task_id)
);
CREATE INDEX task_session_task ON task_session (task_id);
`;

// The rules that priced a call (DF-026), where in the world its inference ran, and a cost that is replaced is kept (DF-029).
// A cost_event is the current price of a call; when a repricing changes it, the old event moves to cost_event_history.
const SCHEMA_V8 = `
ALTER TABLE model_call ADD COLUMN inference_geo TEXT;
ALTER TABLE cost_event ADD COLUMN rule_ids TEXT NOT NULL DEFAULT '[]';

CREATE TABLE repricing (
  repricing_id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  to_snapshot TEXT NOT NULL REFERENCES price_snapshot (snapshot_id),
  from_ts TEXT,
  until_ts TEXT,
  reason TEXT NOT NULL,
  calls_changed INTEGER NOT NULL CHECK (calls_changed >= 0),
  delta_micros INTEGER NOT NULL
);

CREATE TABLE cost_event_history (
  history_id INTEGER PRIMARY KEY,
  call_id TEXT NOT NULL REFERENCES model_call (call_id),
  class TEXT NOT NULL CHECK (class IN ('estimated', 'unpriced')),
  snapshot_id TEXT REFERENCES price_snapshot (snapshot_id),
  matched_as TEXT,
  ladder_step TEXT,
  unpriced_reason TEXT,
  total_micros INTEGER,
  input_micros INTEGER,
  output_micros INTEGER,
  cache_read_micros INTEGER,
  cache_write_5m_micros INTEGER,
  cache_write_1h_micros INTEGER,
  rule_ids TEXT NOT NULL DEFAULT '[]',
  repricing_id INTEGER NOT NULL REFERENCES repricing (repricing_id)
);
CREATE INDEX cost_event_history_call ON cost_event_history (call_id);
CREATE INDEX cost_event_history_repricing ON cost_event_history (repricing_id);
`;

// Invoices and usage exports the owner imported, their lines with the place each came from, and what they were reconciled against (DF-024, DF-027).
const SCHEMA_V9 = `
CREATE TABLE invoice (
  invoice_id TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,
  invoice_number TEXT,
  currency TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  stated_total_micros INTEGER,
  lines_total_micros INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('imported', 'sum_mismatch', 'conflict')),
  notes TEXT NOT NULL DEFAULT '[]',
  source_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
CREATE UNIQUE INDEX invoice_number ON invoice (vendor, invoice_number) WHERE invoice_number IS NOT NULL;

CREATE TABLE billed_line (
  invoice_id TEXT NOT NULL REFERENCES invoice (invoice_id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  day TEXT,
  model TEXT,
  description TEXT NOT NULL,
  quantity REAL,
  amount_micros INTEGER NOT NULL,
  locator TEXT NOT NULL,
  PRIMARY KEY (invoice_id, line_no)
);
CREATE INDEX billed_line_day ON billed_line (day);

CREATE TABLE reconciliation (
  vendor TEXT NOT NULL,
  period TEXT NOT NULL,
  currency TEXT NOT NULL,
  billed_micros INTEGER,
  estimated_micros INTEGER NOT NULL,
  reported_micros INTEGER,
  gap_micros INTEGER,
  status TEXT NOT NULL CHECK (status IN ('reconciled', 'partial', 'unreconciled')),
  reason TEXT NOT NULL,
  unmatched_billed_micros INTEGER NOT NULL DEFAULT 0,
  unmatched_estimated_micros INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (vendor, period, currency)
);
`;

// Finding the newest call a file produced, which every read of a changed or new file does, scanned the whole call table.
const SCHEMA_V10 = `
CREATE INDEX model_call_source_ts ON model_call (source_id, ts);
`;

// Alerts (DF-010): what each rule last said, what was last spoken about it, and every decision to speak or stay quiet.
const SCHEMA_V11 = `
CREATE TABLE alert_state (
  key TEXT PRIMARY KEY,
  suite TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('OK', 'WARNING', 'ALERT', 'NO_DATA')),
  spoken_state TEXT CHECK (spoken_state IN ('OK', 'WARNING', 'ALERT', 'NO_DATA')),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  since TEXT NOT NULL,
  evaluated_at TEXT NOT NULL
);

CREATE TABLE alert_event (
  alert_id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  key TEXT NOT NULL,
  suite TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('OK', 'WARNING', 'ALERT', 'NO_DATA')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  evidence TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('fired', 'suppressed_daily_limit', 'suppressed_paused', 'recovered')),
  delivered TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX alert_event_day ON alert_event (suite, disposition, ts);
`;

// What the owner said when asked whether a commit came from a session (DF-006). Kept by repository folder, not by id, so it survives a rescan.
const SCHEMA_V12 = `
CREATE TABLE owner_answer (
  session_id TEXT NOT NULL,
  repo_root TEXT NOT NULL,
  sha TEXT NOT NULL,
  answer TEXT NOT NULL CHECK (answer IN ('yes', 'no')),
  answered_at TEXT NOT NULL,
  PRIMARY KEY (session_id, repo_root, sha)
);
`;

// Two more kinds of source (a gateway's spend log and OpenTelemetry spans, DF-022 and DF-023), and what a source itself said a call cost,
// kept beside the estimate and never in place of it.
const SCHEMA_V13 = `${FOREIGN_KEYS_OFF}

CREATE TABLE ingest_source_v13 (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('claude_code', 'codex', 'opencode', 'gateway', 'otel')),
  path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  offset_bytes INTEGER NOT NULL CHECK (offset_bytes >= 0),
  last_ingested_at TEXT NOT NULL
);
INSERT INTO ingest_source_v13 SELECT id, kind, path, size_bytes, offset_bytes, last_ingested_at FROM ingest_source;
DROP TABLE ingest_source;
ALTER TABLE ingest_source_v13 RENAME TO ingest_source;

CREATE TABLE call_reported_cost (
  call_id TEXT PRIMARY KEY REFERENCES model_call (call_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_micros INTEGER NOT NULL CHECK (amount_micros >= 0),
  observed_at TEXT NOT NULL
);
CREATE INDEX call_reported_cost_source ON call_reported_cost (source);
`;

// What a tool result looked like without keeping what it said (DF-033, DF-092): a hash of the result with its numbers and identifiers folded away, so that
// the same error coming back with a new line number or time reads as the same error, and whether the tool said it cut its own output short.
const SCHEMA_V14 = `
ALTER TABLE tool_result ADD COLUMN result_hash TEXT;
ALTER TABLE tool_result ADD COLUMN truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1));
`;

// A compaction is the moment an agent summarised its conversation to make room: the log says when, what started it, and how many tokens the context held
// before and after (DF-096, DF-089). The client version of each call lets a cache that was lost after an update be told apart from one that was not.
const SCHEMA_V15 = `
CREATE TABLE session_compaction (
  session_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  trigger TEXT NOT NULL,
  pre_tokens INTEGER NOT NULL CHECK (pre_tokens >= 0),
  post_tokens INTEGER CHECK (post_tokens IS NULL OR post_tokens >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  -- The log file it was read from: a delegated agent compacts its own context, apart from the agent that started it.
  source_id INTEGER REFERENCES ingest_source (id),
  PRIMARY KEY (session_id, ts)
);
ALTER TABLE model_call ADD COLUMN tool_version TEXT;
`;

// Who started a delegated agent (DF-094). A delegated agent writes its own log and carries an agent id; the agent that started it is the one whose log holds
// the result that names that id. The task text is never read: only the id, which log it appeared in, and when.
const SCHEMA_V16 = `
ALTER TABLE ingest_source ADD COLUMN agent_id TEXT;
CREATE TABLE delegation_edge (
  session_id TEXT NOT NULL,
  child_agent_id TEXT NOT NULL,
  parent_source_id INTEGER REFERENCES ingest_source (id),
  ts TEXT NOT NULL,
  PRIMARY KEY (session_id, child_agent_id)
);
`;

// A workflow is a script that starts a batch of agents: the agent logs sit in a folder named after the run, and the result that launched the run, in the log of
// whichever agent started it, names the run (DF-094). The workflow's name is the owner's own label for the script; its summary is never read.
const SCHEMA_V17 = `
ALTER TABLE ingest_source ADD COLUMN workflow_run TEXT;
CREATE TABLE workflow_run (
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  parent_source_id INTEGER REFERENCES ingest_source (id),
  name TEXT,
  ts TEXT NOT NULL,
  PRIMARY KEY (session_id, run_id)
);
`;

const SCHEMA_V18 = `
CREATE TABLE untrusted_flag (
  session_id TEXT NOT NULL,
  field TEXT NOT NULL,
  kind TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  found_at TEXT NOT NULL,
  PRIMARY KEY (session_id, field, kind)
);
`;

const SCHEMA_V19 = `
CREATE TABLE desk_call (
  call_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  role TEXT NOT NULL,
  served_model TEXT,
  served_by TEXT,
  source TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  class TEXT NOT NULL,
  total_micros INTEGER,
  snapshot_id TEXT,
  unpriced_reason TEXT
);
CREATE INDEX desk_call_ts ON desk_call (ts);
`;

const SCHEMA_V20 = `
ALTER TABLE ingest_source ADD COLUMN skewed_lines INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingest_source ADD COLUMN future_lines INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingest_run ADD COLUMN skewed_lines INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingest_run ADD COLUMN future_lines INTEGER NOT NULL DEFAULT 0;
`;

const SCHEMA_V21 = `
CREATE TABLE ledger_event (
  seq INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  sources_root TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  row_hash TEXT NOT NULL
);
ALTER TABLE ingest_source ADD COLUMN content_digest TEXT;
`;

const SCHEMA_V22 = `
CREATE TABLE pr_fact (
  repo_id INTEGER NOT NULL REFERENCES repo (repo_id),
  number INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'merged', 'closed_unmerged', 'superseded')),
  closed_at TEXT,
  head_ref TEXT,
  commit_shas TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (repo_id, number)
);
`;

const MIGRATIONS: readonly string[] = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V8, SCHEMA_V9, SCHEMA_V10, SCHEMA_V11, SCHEMA_V12, SCHEMA_V13, SCHEMA_V14, SCHEMA_V15, SCHEMA_V16, SCHEMA_V17, SCHEMA_V18, SCHEMA_V19, SCHEMA_V20, SCHEMA_V21, SCHEMA_V22];

/** The schema version this build writes: the number of migrations. A reader compares a ledger's `user_version` with it. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/** The oldest ledger a read-only reader can use. Version 3 has no table for the tool's own recorded cost; readers check for it. */
export const OLDEST_READABLE_VERSION = 3;

export function openLedger(path: string): Ledger {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;");
  try {
    migrate(db);
  } catch (error) {
    // A ledger that cannot be used must not stay open: on Windows an open file cannot be moved or deleted.
    db.close();
    throw error;
  }
  return db;
}

function migrate(db: Ledger): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  let version = row.user_version;
  if (version > MIGRATIONS.length) {
    throw new Error(`ledger schema version ${version} is newer than this build (${MIGRATIONS.length})`);
  }
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    if (sql === undefined) throw new Error("missing migration");
    const offDuring = sql.startsWith(FOREIGN_KEYS_OFF);
    if (offDuring) db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      if (offDuring) {
        const broken = db.prepare("PRAGMA foreign_key_check").all();
        if (broken.length > 0) throw new Error(`migration ${version + 1} left ${broken.length} broken reference(s)`);
      }
      version += 1;
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      if (offDuring) db.exec("PRAGMA foreign_keys = ON");
    }
  }
}

/**
 * A write that failed because the disk was full or the file reached its size limit is said in words, with the path: a bare "database or disk is full" tells a person
 * neither which file nor what to do. Every other error passes through unchanged.
 */
export function explainSqliteError(db: Ledger, error: unknown): unknown {
  const e = error as { errcode?: number; message?: string } | null;
  if (e !== null && typeof e === "object" && (e.errcode === 13 || /database or disk is full|SQLITE_FULL/i.test(String(e.message)))) {
    let path = "the ledger";
    try {
      const main = (db.prepare("PRAGMA database_list").all() as { name: string; file: string }[]).find((d) => d.name === "main");
      path = main !== undefined && main.file !== "" ? main.file : "an in-memory ledger";
    } catch {
      /* the path is a courtesy; the message stands without it */
    }
    return Object.assign(new Error(`E_DISK_FULL: the ledger at ${path} could not be written, because the disk is full or the file reached its size limit. The file this run was reading was not kept, and every file before it was kept whole. Free some space and run the same command again: it carries on from where each file was left.`), { code: "E_DISK_FULL" });
  }
  return error;
}

/** Roll back, and say nothing if there is nothing to roll back: after a full disk or an I/O error SQLite has already ended the transaction, and a second error would hide the first. */
export function rollbackQuietly(db: Ledger): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    /* already rolled back by SQLite */
  }
}
