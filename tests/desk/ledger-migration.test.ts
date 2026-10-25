import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OLDEST_READABLE_VERSION, openLedger, SCHEMA_VERSION } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";

let dir: TempDir;
beforeEach(() => {
  dir = new TempDir();
});
afterEach(() => dir.dispose());

// The tables a later version added, dropped when a test puts a ledger back at an older version. Each new migration adds its tables here.
const DROP_AFTER_V6 = "DROP TABLE IF EXISTS route_dispatch; DROP TABLE IF EXISTS dossier_replay; DROP TABLE IF EXISTS carry_state; DROP TABLE IF EXISTS precedent_outcome; DROP TABLE IF EXISTS policy_precedent; DROP TABLE IF EXISTS autonomy_event; DROP TABLE IF EXISTS workflow_autonomy; ALTER TABLE git_commit DROP COLUMN reverted_at; DROP TABLE IF EXISTS question_decision; DROP TABLE IF EXISTS pr_fact; DROP TABLE IF EXISTS ledger_event; ALTER TABLE ingest_source DROP COLUMN content_digest; ALTER TABLE ingest_run DROP COLUMN future_lines; ALTER TABLE ingest_run DROP COLUMN skewed_lines; ALTER TABLE ingest_source DROP COLUMN future_lines; ALTER TABLE ingest_source DROP COLUMN skewed_lines; DROP TABLE IF EXISTS desk_call; DROP TABLE IF EXISTS untrusted_flag; DROP TABLE IF EXISTS workflow_run; ALTER TABLE ingest_source DROP COLUMN workflow_run; DROP TABLE IF EXISTS delegation_edge; ALTER TABLE ingest_source DROP COLUMN agent_id; DROP TABLE IF EXISTS session_compaction; ALTER TABLE model_call DROP COLUMN tool_version; ALTER TABLE tool_result DROP COLUMN result_hash; ALTER TABLE tool_result DROP COLUMN truncated; DROP TABLE IF EXISTS call_reported_cost; DROP TABLE IF EXISTS owner_answer; DROP TABLE IF EXISTS alert_event; DROP TABLE IF EXISTS alert_state; DROP INDEX IF EXISTS model_call_source_ts; DROP TABLE IF EXISTS reconciliation; DROP TABLE IF EXISTS billed_line; DROP TABLE IF EXISTS invoice; DROP TABLE IF EXISTS cost_event_history; DROP TABLE IF EXISTS repricing; ALTER TABLE model_call DROP COLUMN inference_geo; ALTER TABLE cost_event DROP COLUMN rule_ids; DROP TABLE IF EXISTS task_session; DROP TABLE IF EXISTS task;";

describe("the ledger schema", () => {
  it("is at version 29 and a reader can use version 3 and later", () => {
    expect(SCHEMA_VERSION).toBe(29);
    expect(OLDEST_READABLE_VERSION).toBe(3);
  });

  it("upgrades a version 4 ledger without losing a row or breaking a reference, and then takes a Codex source", async () => {
    const path = join(dir.path, "old.db");
    // Build a ledger with real rows, then put it back at version 4 with the old narrower table.
    const first = openLedger(path);
    await ingestClaudeCode(first, [dir.file("a.jsonl", [assistantLine({ id: "m1", session: "s1", ts: "2026-10-20T10:00:00Z", output: 10 }), assistantLine({ id: "m2", session: "s1", ts: "2026-10-20T10:01:00Z", output: 20 })])], testSnapshot());
    const before = { sources: first.prepare("SELECT id, kind, path, size_bytes, offset_bytes, last_ingested_at FROM ingest_source").all(), calls: first.prepare("SELECT call_id, source_id, output_tokens FROM model_call ORDER BY call_id").all() };
    first.exec(`PRAGMA foreign_keys = OFF; ${DROP_AFTER_V6} DROP TABLE limit_sample; PRAGMA user_version = 4;`);
    first.exec(`
      CREATE TABLE ingest_source_old (id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('claude_code')), path TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0), offset_bytes INTEGER NOT NULL CHECK (offset_bytes >= 0), last_ingested_at TEXT NOT NULL);
      INSERT INTO ingest_source_old SELECT id, kind, path, size_bytes, offset_bytes, last_ingested_at FROM ingest_source;
      DROP TABLE ingest_source;
      ALTER TABLE ingest_source_old RENAME TO ingest_source;
    `);
    expect(() => first.prepare("INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES ('codex', 'x', 0, 0, 't')").run()).toThrow(/CHECK/);
    first.close();

    const upgraded = openLedger(path);
    try {
      expect((upgraded.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(29);
      expect(upgraded.prepare("SELECT id, kind, path, size_bytes, offset_bytes, last_ingested_at FROM ingest_source").all()).toEqual(before.sources);
      expect(upgraded.prepare("SELECT call_id, source_id, output_tokens FROM model_call ORDER BY call_id").all()).toEqual(before.calls);
      expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(upgraded.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      upgraded.prepare("INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES ('codex', 'y', 0, 0, 't')").run();
      expect(() => upgraded.prepare("INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES ('other', 'z', 0, 0, 't')").run()).toThrow(/CHECK/);
      // the table that existed before the upgrade still enforces its reference to the source
      expect(() => upgraded.prepare("DELETE FROM ingest_source WHERE id = ?").run((before.sources[0] as { id: number }).id)).toThrow(/FOREIGN KEY/);
    } finally {
      upgraded.close();
    }
  });

  it("upgrades a version 5 ledger, keeps its sources and calls, and then takes an OpenCode source", async () => {
    const path = join(dir.path, "v5.db");
    const first = openLedger(path);
    await ingestClaudeCode(first, [dir.file("a.jsonl", [assistantLine({ id: "m1", session: "s1", ts: "2026-10-20T10:00:00Z", output: 10 })])], testSnapshot());
    first.prepare("INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES ('codex', 'c.jsonl', 5, 5, 't')").run();
    const before = { sources: first.prepare("SELECT id, kind, path, size_bytes, offset_bytes, last_ingested_at FROM ingest_source ORDER BY id").all(), calls: first.prepare("SELECT call_id, source_id FROM model_call").all() };
    // Put it back at version 5 with the table as that version had it.
    first.exec(`
      PRAGMA foreign_keys = OFF;
      ${DROP_AFTER_V6}
      CREATE TABLE ingest_source_old (id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('claude_code', 'codex')), path TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0), offset_bytes INTEGER NOT NULL CHECK (offset_bytes >= 0), last_ingested_at TEXT NOT NULL);
      INSERT INTO ingest_source_old SELECT id, kind, path, size_bytes, offset_bytes, last_ingested_at FROM ingest_source;
      DROP TABLE ingest_source;
      ALTER TABLE ingest_source_old RENAME TO ingest_source;
      PRAGMA user_version = 5;
    `);
    expect(() => first.prepare("INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES ('opencode', 'x', 0, 0, 't')").run()).toThrow(/CHECK/);
    first.close();
    const upgraded = openLedger(path);
    try {
      expect(upgraded.prepare("SELECT id, kind, path, size_bytes, offset_bytes, last_ingested_at FROM ingest_source ORDER BY id").all()).toEqual(before.sources);
      expect(upgraded.prepare("SELECT call_id, source_id FROM model_call").all()).toEqual(before.calls);
      expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      upgraded.prepare("INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES ('opencode', 'o.db', 0, 0, 't')").run();
      expect(() => upgraded.prepare("INSERT INTO ingest_source (kind, path, size_bytes, offset_bytes, last_ingested_at) VALUES ('other', 'z', 0, 0, 't')").run()).toThrow(/CHECK/);
    } finally {
      upgraded.close();
    }
  });

  it("opens a fresh ledger at the newest version and refuses one from a newer build", () => {
    const fresh = openLedger(":memory:");
    expect((fresh.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(29);
    fresh.close();
    const path = join(dir.path, "future.db");
    const f = new DatabaseSync(path);
    f.exec("PRAGMA user_version = 99");
    f.close();
    expect(() => openLedger(path)).toThrow(/newer than this build/);
  });
});
