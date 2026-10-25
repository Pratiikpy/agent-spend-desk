import type { Ledger } from "../ledger/db.ts";

/**
 * Where answers are kept. An answer, the steps behind it and each sentence with the hashes of the queries
 * and results it rests on, so `verify-answer` can run the same steps again and say whether the sentences
 * still hold. These tables are written after the ledger has been read; the steps themselves run with the
 * connection set to query-only.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS ask_answer (
  answer_id TEXT PRIMARY KEY,
  asked_at TEXT NOT NULL,
  question TEXT NOT NULL,
  route TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('answered', 'unknowable', 'refused')),
  planner TEXT NOT NULL CHECK (planner IN ('model', 'rules', 'none')),
  explainer TEXT NOT NULL CHECK (explainer IN ('model', 'rules', 'none')),
  served_model TEXT,
  ablated TEXT NOT NULL,
  program_json TEXT,
  program_hash TEXT,
  note TEXT
);

-- How each question was routed before anything ran: what Scout Intent decided, what the older rules decided, which of them the route came from. No question text is kept here;
-- the answer row holds it, and this holds a hash so that a route can be tied to its question without copying it.
CREATE TABLE IF NOT EXISTS route_decision (
  route_decision_id INTEGER PRIMARY KEY,
  answer_id TEXT NOT NULL REFERENCES ask_answer (answer_id) ON DELETE CASCADE,
  decided_at TEXT NOT NULL,
  question_hash TEXT NOT NULL,
  route TEXT NOT NULL CHECK (route IN ('read', 'spend_action', 'policy_change', 'unsafe')),
  source TEXT NOT NULL CHECK (source IN ('scout', 'rules', 'both', 'off', 'failed')),
  scout_route TEXT,
  rules_route TEXT NOT NULL,
  intent TEXT,
  band TEXT,
  score REAL,
  clarification TEXT,
  flags TEXT NOT NULL,
  trace_id TEXT,
  contract_id TEXT,
  registry_version INTEGER,
  policy_pack TEXT,
  latency_ms REAL,
  stage2 TEXT,
  embedder TEXT
);

CREATE TABLE IF NOT EXISTS ask_step (
  answer_id TEXT NOT NULL REFERENCES ask_answer (answer_id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  op TEXT NOT NULL,
  specialist TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  unknowable TEXT,
  error TEXT,
  PRIMARY KEY (answer_id, step_id)
);

CREATE TABLE IF NOT EXISTS ask_sentence (
  answer_id TEXT NOT NULL REFERENCES ask_answer (answer_id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  cites_json TEXT NOT NULL,
  query_hashes_json TEXT NOT NULL,
  result_hashes_json TEXT NOT NULL,
  PRIMARY KEY (answer_id, idx)
);
`;

export function ensureAskSchema(db: Ledger): void {
  db.exec(DDL);
  // A ledger written before the router recorded its second stage has the table without these two columns.
  const have = new Set((db.prepare("PRAGMA table_info(route_decision)").all() as { name: string }[]).map((c) => c.name));
  if (!have.has("stage2")) db.exec("ALTER TABLE route_decision ADD COLUMN stage2 TEXT");
  if (!have.has("embedder")) db.exec("ALTER TABLE route_decision ADD COLUMN embedder TEXT");
}
