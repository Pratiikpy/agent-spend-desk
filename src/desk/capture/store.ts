import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The store for what the Desk captures from the owner's own work in order to test routes on it: snapshots of a workspace, the tasks made from history, the trajectories of the
 * agent runs behind them, and what replaying them on another route found. It is a file of its own and not the ledger, because the ledger holds no text from a prompt and this
 * holds the redacted prompt a task is made from; the ledger can be shared with a team and this cannot.
 *
 * Tables are added by numbered steps. A step that has run is never edited; a change is a new step.
 */
export type CaptureDb = DatabaseSync;

export const DEFAULT_CAPTURE_DB = "data/desk/capture.db";

const STEPS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE workspace_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  repo_path TEXT NOT NULL,
  repo_label TEXT NOT NULL,
  ref TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  index_commit TEXT NOT NULL,
  untracked_commit TEXT NOT NULL,
  created_at TEXT NOT NULL,
  tracked_changed INTEGER NOT NULL,
  staged_changed INTEGER NOT NULL,
  untracked INTEGER NOT NULL,
  untracked_bytes INTEGER NOT NULL,
  cap_bytes INTEGER NOT NULL,
  -- 1 when the snapshot does not hold everything the workspace held (files left out, a lock, a conflict): a replay from it must say so.
  snapshot_partial INTEGER NOT NULL CHECK (snapshot_partial IN (0, 1)),
  excluded_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `
-- A task made from the owner's history: the redacted prompt, the commit the work started from and the commit it ended at, and the tests that decide it.
CREATE TABLE canary_task (
  task_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'ineligible', 'computed', 'accepted', 'rejected')),
  repo_path TEXT NOT NULL,
  repo_label TEXT NOT NULL,
  session_id TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  result_sha TEXT NOT NULL,
  commits_json TEXT NOT NULL,
  prompt TEXT NOT NULL,
  prompt_sha TEXT NOT NULL,
  prompt_count INTEGER NOT NULL,
  injection_json TEXT NOT NULL,
  kind TEXT NOT NULL,
  area TEXT NOT NULL,
  files_json TEXT NOT NULL,
  test_files_json TEXT NOT NULL,
  runnable_json TEXT NOT NULL,
  diff_lines INTEGER NOT NULL,
  reasons_json TEXT NOT NULL,
  -- Pinned snapshots (workspace_snapshots) of the commit before the work and the commit after it.
  base_ref TEXT,
  result_ref TEXT,
  plan_json TEXT,
  oracle TEXT CHECK (oracle IN ('strong', 'weak', 'none')),
  f2p_json TEXT,
  p2p_json TEXT,
  flaky_json TEXT,
  failing_after_json TEXT,
  oracle_json TEXT,
  computed_at TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  held_out INTEGER CHECK (held_out IN (0, 1)),
  suite_id TEXT,
  captured_at TEXT NOT NULL
);
CREATE INDEX canary_task_status ON canary_task (status);

-- A frozen set of tasks. Its hash covers every task's prompt, commits and deciding tests, so a suite that was run and a suite that is shown cannot differ without the hash saying so.
CREATE TABLE canary_suite (
  suite_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  task_ids_json TEXT NOT NULL,
  held_out_json TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  families_json TEXT NOT NULL,
  params_json TEXT NOT NULL
);
CREATE TRIGGER canary_suite_frozen_update BEFORE UPDATE ON canary_suite BEGIN SELECT RAISE(ABORT, 'a frozen suite is not edited'); END;
CREATE TRIGGER canary_suite_frozen_delete BEFORE DELETE ON canary_suite BEGIN SELECT RAISE(ABORT, 'a frozen suite is not edited'); END;
`,
  },
  {
    version: 3,
    sql: `
-- Where a task came from: the owner's history, or a directory of tasks written or mined elsewhere (the Lab's layout), brought in as a small repository of its own.
ALTER TABLE canary_task ADD COLUMN source TEXT NOT NULL DEFAULT 'history' CHECK (source IN ('history', 'lab'));
ALTER TABLE canary_task ADD COLUMN origin_json TEXT;
`,
  },
  {
    version: 4,
    sql: `
-- What an agent did in one session, rebuilt from its log: counts always, and the redacted inputs and results of each call when the owner asked for them to be kept.
CREATE TABLE trajectory (
  trajectory_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('log', 'gateway', 'wrapper')),
  log_sha TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  prompts INTEGER NOT NULL,
  assistant_messages INTEGER NOT NULL,
  compactions INTEGER NOT NULL,
  sidechain_lines INTEGER NOT NULL,
  malformed_lines INTEGER NOT NULL,
  tool_calls INTEGER NOT NULL,
  read_only_calls INTEGER NOT NULL,
  mutating_calls INTEGER NOT NULL,
  results_present INTEGER NOT NULL,
  results_missing INTEGER NOT NULL,
  results_cut_short INTEGER NOT NULL,
  eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
  replay_class TEXT CHECK (replay_class IN ('full', 'tools_only', 'insufficient')),
  reasons_json TEXT NOT NULL,
  kept_text INTEGER NOT NULL CHECK (kept_text IN (0, 1)),
  captured_at TEXT NOT NULL
);
CREATE INDEX trajectory_session ON trajectory (session_id);
CREATE TABLE trajectory_step (
  trajectory_id TEXT NOT NULL REFERENCES trajectory (trajectory_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  ts TEXT,
  tool TEXT NOT NULL,
  tool_class TEXT NOT NULL CHECK (tool_class IN ('read_only', 'mutating')),
  effect TEXT NOT NULL,
  -- The tool and its redacted input, hashed with the session's folder written as <cwd>: the key a recorded result is looked up by.
  key_sha TEXT NOT NULL,
  input_text TEXT,
  result_present INTEGER NOT NULL CHECK (result_present IN (0, 1)),
  result_text TEXT,
  result_chars INTEGER NOT NULL,
  result_truncated INTEGER NOT NULL CHECK (result_truncated IN (0, 1)),
  is_error INTEGER NOT NULL CHECK (is_error IN (0, 1)),
  PRIMARY KEY (trajectory_id, seq)
);
CREATE INDEX trajectory_step_key ON trajectory_step (trajectory_id, key_sha);
`,
  },
  {
    version: 5,
    sql: `
-- A swap: two routes run on the same tasks, and what was found. The report is kept whole beside the parameters that made it.
CREATE TABLE replay_run (
  run_id TEXT PRIMARY KEY,
  suite_id TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  baseline TEXT NOT NULL,
  candidate TEXT NOT NULL,
  params_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'partial', 'withheld')),
  report_json TEXT
);
CREATE TABLE replay_item (
  run_id TEXT NOT NULL REFERENCES replay_run (run_id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  route TEXT NOT NULL,
  repeat INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'diverged', 'error', 'over_budget')),
  fail_to_pass_passed INTEGER NOT NULL,
  fail_to_pass_total INTEGER NOT NULL,
  pass_to_pass_passed INTEGER NOT NULL,
  pass_to_pass_total INTEGER NOT NULL,
  turns INTEGER NOT NULL,
  model_calls INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  tool_executed INTEGER NOT NULL,
  tool_served_from_recording INTEGER NOT NULL,
  tool_stubbed INTEGER NOT NULL,
  tool_refused INTEGER NOT NULL,
  tool_diverged INTEGER NOT NULL,
  touched_json TEXT NOT NULL,
  divergence TEXT,
  error TEXT,
  stopped TEXT,
  served_model TEXT,
  PRIMARY KEY (run_id, task_id, route, repeat)
);
`,
  },
  {
    version: 6,
    sql: `
-- What the model left: the change it made to the files it touched, as a unified diff, cut to a length a judge can read.
ALTER TABLE replay_item ADD COLUMN patch_text TEXT;
`,
  },
  {
    version: 7,
    sql: `
-- Whether a panel of judges has been checked against the owner's own labels, and what the check found. A panel that is not admitted scores nothing.
CREATE TABLE judge_admission (
  admission_id INTEGER PRIMARY KEY,
  panel_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  judges_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('admitted', 'flagged', 'excluded')),
  alpha REAL,
  agreement REAL,
  labels INTEGER NOT NULL,
  undecided INTEGER NOT NULL,
  reasons_json TEXT NOT NULL
);
-- What a panel said about a pair of changes from a swap, in both orders, and the scores made from it.
CREATE TABLE judge_pair (
  run_id TEXT NOT NULL REFERENCES replay_run (run_id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  repeat INTEGER NOT NULL,
  panel_id TEXT NOT NULL,
  advisory INTEGER NOT NULL CHECK (advisory IN (0, 1)),
  decision TEXT,
  why TEXT NOT NULL,
  -- 1 when the baseline's change won, 0 when the candidate's did, 0.5 for a tie; null when the panel gave no decision.
  baseline_score REAL,
  baseline_score_length_normalised REAL,
  length_penalised INTEGER NOT NULL CHECK (length_penalised IN (0, 1)),
  inconsistent_judges INTEGER NOT NULL,
  failed_judges INTEGER NOT NULL,
  judges_json TEXT NOT NULL,
  PRIMARY KEY (run_id, task_id, repeat, panel_id)
);
`,
  },
  {
    version: 8,
    sql: `
-- What a panel said about each pair the owner labelled, with the share of its judges that sided with its decision: the data a panel's confidence is calibrated on.
CREATE TABLE judge_label (
  panel_id TEXT NOT NULL,
  admission_id INTEGER NOT NULL REFERENCES judge_admission (admission_id) ON DELETE CASCADE,
  label_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  decision TEXT,
  agreeing_share REAL,
  PRIMARY KEY (admission_id, label_id)
);
-- A calibration of one surface of the Desk's judgement, and the curve behind it.
CREATE TABLE calibration_metrics (
  metric_id INTEGER PRIMARY KEY,
  surface TEXT NOT NULL CHECK (surface IN ('attribution', 'forecast', 'judge_panel', 'auditor')),
  created_at TEXT NOT NULL,
  n INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('calibrated', 'uncalibrated_default')),
  reason TEXT,
  ece REAL,
  brier REAL,
  threshold REAL NOT NULL,
  precision_at_threshold REAL,
  coverage_at_threshold REAL,
  abstain_always INTEGER NOT NULL
);
CREATE TABLE calibration_curves (
  metric_id INTEGER NOT NULL REFERENCES calibration_metrics (metric_id) ON DELETE CASCADE,
  bin INTEGER NOT NULL,
  low REAL NOT NULL,
  high REAL NOT NULL,
  n INTEGER NOT NULL,
  mean_predicted REAL NOT NULL,
  observed REAL NOT NULL,
  PRIMARY KEY (metric_id, bin)
);
`,
  },
];

export const CAPTURE_SCHEMA_VERSION = STEPS[STEPS.length - 1]!.version;

export function openCapture(path: string): CaptureDb {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;");
  const have = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (have > CAPTURE_SCHEMA_VERSION) {
    db.close();
    throw new Error(`capture store version ${have} is newer than this build (${CAPTURE_SCHEMA_VERSION})`);
  }
  for (const step of STEPS) {
    if (step.version <= have) continue;
    db.exec("BEGIN");
    try {
      db.exec(step.sql);
      db.exec(`PRAGMA user_version = ${step.version}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      db.close();
      throw e;
    }
  }
  return db;
}
