import type { DatabaseSync } from "node:sqlite";

/**
 * Tables of the reservation ledger and the gate (spec 4.5, 10.5, 22.3). Reservations are events: a row
 * is never updated or deleted, and the database refuses to do either. Spent and reserved money are
 * sums over events, so they cannot drift from the record. Every row is chained to the one before it
 * by a hash, so a changed or removed row is found by recomputing the chain.
 */
const GATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS gate_event (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'authorized', 'settled', 'voided', 'expired', 'overage', 'observed', 'denied', 'asked', 'approved',
    'shadow_would_deny', 'idempotent_replayed', 'paused', 'resumed', 'bypass_opened', 'bypass_closed', 'bypass_allowed'
  )),
  reservation_id INTEGER,
  idempotency_key TEXT,
  budget_set TEXT,
  session_id TEXT,
  person TEXT,
  project TEXT,
  agent TEXT,
  model TEXT,
  tool TEXT,
  call_ref TEXT,
  amount_micros INTEGER NOT NULL DEFAULT 0 CHECK (amount_micros >= 0 AND amount_micros <= 9007199254740991),
  expires_at TEXT,
  reason_code TEXT,
  reason TEXT,
  verdict TEXT CHECK (verdict IS NULL OR verdict IN ('allow', 'ask', 'deny')),
  policy_version INTEGER,
  approval_id INTEGER,
  basis TEXT NOT NULL DEFAULT '{}',
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  sig TEXT
);
CREATE INDEX IF NOT EXISTS gate_event_reservation ON gate_event (reservation_id);
CREATE INDEX IF NOT EXISTS gate_event_person_ts ON gate_event (person, ts);
CREATE INDEX IF NOT EXISTS gate_event_session ON gate_event (session_id);

-- I-R1: one authorization per (budget set, idempotency key); a repeat returns the first decision.
CREATE UNIQUE INDEX IF NOT EXISTS gate_i_r1 ON gate_event (budget_set, idempotency_key) WHERE kind = 'authorized';
-- I-R3: at most one of settled or voided per authorization, and at most one expiry and one overage.
CREATE UNIQUE INDEX IF NOT EXISTS gate_i_r3_close ON gate_event (reservation_id) WHERE kind IN ('settled', 'voided');
CREATE UNIQUE INDEX IF NOT EXISTS gate_i_r3_expire ON gate_event (reservation_id) WHERE kind = 'expired';
CREATE UNIQUE INDEX IF NOT EXISTS gate_i_r3_overage ON gate_event (reservation_id) WHERE kind = 'overage' AND reservation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gate_observed_once ON gate_event (call_ref) WHERE kind = 'observed';
-- An approval is spent by one authorization.
CREATE UNIQUE INDEX IF NOT EXISTS gate_approval_once ON gate_event (approval_id) WHERE kind = 'authorized' AND approval_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS gate_event_no_update BEFORE UPDATE ON gate_event
BEGIN SELECT RAISE(ABORT, 'gate_event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gate_event_no_delete BEFORE DELETE ON gate_event
BEGIN SELECT RAISE(ABORT, 'gate_event is append-only'); END;

-- The budgets an event counts against, with the limit that applied when it was written (null: not enforced).
CREATE TABLE IF NOT EXISTS gate_event_budget (
  event_id INTEGER NOT NULL REFERENCES gate_event (id),
  budget_id TEXT NOT NULL,
  window_kind TEXT NOT NULL CHECK (window_kind IN ('day', 'month')),
  limit_micros INTEGER CHECK (limit_micros IS NULL OR limit_micros >= 0),
  PRIMARY KEY (event_id, budget_id)
);
CREATE INDEX IF NOT EXISTS gate_event_budget_budget ON gate_event_budget (budget_id);
CREATE TRIGGER IF NOT EXISTS gate_event_budget_no_update BEFORE UPDATE ON gate_event_budget
BEGIN SELECT RAISE(ABORT, 'gate_event_budget is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gate_event_budget_no_delete BEFORE DELETE ON gate_event_budget
BEGIN SELECT RAISE(ABORT, 'gate_event_budget is append-only'); END;

-- Tool-call idempotency (22.3). This table is state, not events: a key moves from in_flight to completed.
CREATE TABLE IF NOT EXISTS gate_tool_key (
  idempotency_key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  reservation_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('in_flight', 'completed', 'failed')),
  response_hash TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (expires_at >= created_at)
);

-- When the gate first saw each policy version, so that a new policy can run in shadow mode for a set time.
CREATE TABLE IF NOT EXISTS gate_policy_seen (
  digest TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  first_seen TEXT NOT NULL
);

-- How far the gate has read each session transcript, so that spend is counted once.
CREATE TABLE IF NOT EXISTS gate_transcript (
  session_id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  offset_bytes INTEGER NOT NULL CHECK (offset_bytes >= 0),
  last_model TEXT
);
`;

export function ensureGateSchema(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
  db.exec(GATE_SCHEMA);
}
