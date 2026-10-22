import type { DatabaseSync } from "node:sqlite";

/**
 * Tables owned by the dossier module (spec 4.10, 10.3). Created on demand so that the module does not need
 * the ledger's own migration to know about it. The log is append-only: updates and deletes are refused by
 * triggers, so a recorded row cannot be changed in place.
 */
export function ensureDossierSchema(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS dossier_log (
  global_index INTEGER PRIMARY KEY AUTOINCREMENT,
  stream TEXT NOT NULL CHECK (length(stream) BETWEEN 1 AND 64),
  seq INTEGER NOT NULL CHECK (seq >= 0),
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  prev_hash TEXT NOT NULL CHECK (length(prev_hash) = 64),
  row_hash TEXT NOT NULL UNIQUE CHECK (length(row_hash) = 64),
  UNIQUE (stream, seq)
);
CREATE TRIGGER IF NOT EXISTS dossier_log_no_update BEFORE UPDATE ON dossier_log BEGIN SELECT RAISE(ABORT, 'dossier_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS dossier_log_no_delete BEFORE DELETE ON dossier_log BEGIN SELECT RAISE(ABORT, 'dossier_log is append-only'); END;

CREATE TABLE IF NOT EXISTS dossier (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  bundle_path TEXT NOT NULL,
  bundle_digest TEXT NOT NULL CHECK (bundle_digest LIKE 'sha256:%'),
  signer_role TEXT NOT NULL DEFAULT 'decision',
  checkpoint_ref TEXT NOT NULL,
  audience TEXT NOT NULL,
  disclosure TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_request (
  approval_request_id TEXT PRIMARY KEY,
  action_kind TEXT NOT NULL,
  action_digest TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  chain_version TEXT NOT NULL,
  approvers TEXT NOT NULL,
  card TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  presented_at TEXT,
  evidence_opened_at TEXT
);

CREATE TABLE IF NOT EXISTS approval_decision (
  approval_request_id TEXT PRIMARY KEY REFERENCES approval_request (approval_request_id),
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'deny')),
  reason TEXT NOT NULL,
  approver TEXT,
  decided_at TEXT NOT NULL,
  receipt TEXT
);
CREATE TRIGGER IF NOT EXISTS approval_decision_no_update BEFORE UPDATE ON approval_decision BEGIN SELECT RAISE(ABORT, 'approval_decision is final'); END;
CREATE TRIGGER IF NOT EXISTS approval_decision_no_delete BEFORE DELETE ON approval_decision BEGIN SELECT RAISE(ABORT, 'approval_decision is final'); END;

CREATE TABLE IF NOT EXISTS approval_rejected_response (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_request_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  at TEXT NOT NULL
);
`);
}
