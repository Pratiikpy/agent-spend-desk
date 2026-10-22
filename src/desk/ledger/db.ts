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

const MIGRATIONS: readonly string[] = [SCHEMA_V1];

export function openLedger(path: string): Ledger {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;");
  migrate(db);
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
    db.exec("BEGIN");
    try {
      db.exec(sql);
      version += 1;
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
