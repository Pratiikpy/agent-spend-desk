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
}
