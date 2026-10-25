import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../../runtime/canonical.ts";

/**
 * The team's own record (DF-059), kept apart from anyone's ledger: who is in the team and which key is theirs, what role each was given (a log of grants and revocations, never
 * edited), the reports each member sent, and a hash-chained log of every request to see something, allowed or not. A team ledger is the reports of several people's ledgers put side
 * by side; nobody's raw ledger, prompt or path is in it.
 *
 * What this protects and what it does not: it decides what the Desk's commands and screens will show a person, and keeps a record of what they asked. It is not encryption. Anyone who
 * can read this file can read the reports in it, so the file belongs where only the people the owner trusts with all of it can reach.
 */
export type TeamDb = DatabaseSync;

export const ROLES = ["owner", "lead", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

const SCHEMA = `
CREATE TABLE team (
  team_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  per_person INTEGER NOT NULL DEFAULT 0 CHECK (per_person IN (0, 1)),
  min_group INTEGER NOT NULL DEFAULT 3 CHECK (min_group >= 1)
);
CREATE TABLE team_member (
  person_id TEXT PRIMARY KEY,
  display TEXT NOT NULL,
  key_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL
);
-- A role change is an event. The role a person holds is that of their latest event; 'none' is a revocation.
CREATE TABLE team_roles (
  seq INTEGER PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES team (team_id),
  person_id TEXT NOT NULL REFERENCES team_member (person_id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'lead', 'member', 'viewer', 'none')),
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL
);
CREATE TABLE team_report (
  digest TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES team_member (person_id),
  key_id TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX team_report_person ON team_report (person_id, received_at);
CREATE TABLE team_access_log (
  seq INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  person_id TEXT,
  key_id TEXT,
  role TEXT,
  view TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  reason TEXT NOT NULL,
  params TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TRIGGER team_roles_append_only_update BEFORE UPDATE ON team_roles BEGIN SELECT RAISE(ABORT, 'team_roles is append-only'); END;
CREATE TRIGGER team_roles_append_only_delete BEFORE DELETE ON team_roles BEGIN SELECT RAISE(ABORT, 'team_roles is append-only'); END;
CREATE TRIGGER team_access_log_append_only_update BEFORE UPDATE ON team_access_log BEGIN SELECT RAISE(ABORT, 'team_access_log is append-only'); END;
CREATE TRIGGER team_access_log_append_only_delete BEFORE DELETE ON team_access_log BEGIN SELECT RAISE(ABORT, 'team_access_log is append-only'); END;
CREATE TRIGGER team_report_append_only_update BEFORE UPDATE ON team_report BEGIN SELECT RAISE(ABORT, 'team_report is append-only'); END;
`;

export const TEAM_SCHEMA_VERSION = 1;

export function openTeam(path: string): TeamDb {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;");
  const v = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (v > TEAM_SCHEMA_VERSION) {
    db.close();
    throw new Error(`team schema version ${v} is newer than this build (${TEAM_SCHEMA_VERSION})`);
  }
  if (v < 1) {
    db.exec("BEGIN");
    try {
      db.exec(SCHEMA);
      db.exec(`PRAGMA user_version = ${TEAM_SCHEMA_VERSION}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      db.close();
      throw e;
    }
  }
  return db;
}

export interface TeamRow {
  team_id: string;
  name: string;
  created_at: string;
  per_person: number;
  min_group: number;
}

export function team(db: TeamDb): TeamRow | null {
  return (db.prepare("SELECT * FROM team LIMIT 1").get() as TeamRow | undefined) ?? null;
}

export interface Member {
  personId: string;
  display: string;
  keyId: string;
  publicKey: string;
  role: Role | "none";
  addedBy: string;
  addedAt: string;
}

/** Every member with the role their latest event gives them. */
export function members(db: TeamDb): Member[] {
  const rows = db
    .prepare(
      `SELECT m.person_id, m.display, m.key_id, m.public_key, m.added_by, m.added_at,
              COALESCE((SELECT r.role FROM team_roles r WHERE r.person_id = m.person_id ORDER BY r.seq DESC LIMIT 1), 'none') AS role
       FROM team_member m ORDER BY m.person_id`,
    )
    .all() as unknown as { person_id: string; display: string; key_id: string; public_key: string; added_by: string; added_at: string; role: Role | "none" }[];
  return rows.map((r) => ({ personId: r.person_id, display: r.display, keyId: r.key_id, publicKey: r.public_key, role: r.role, addedBy: r.added_by, addedAt: r.added_at }));
}

export function memberByKey(db: TeamDb, keyId: string): Member | null {
  return members(db).find((m) => m.keyId === keyId) ?? null;
}

export function memberById(db: TeamDb, personId: string): Member | null {
  return members(db).find((m) => m.personId === personId) ?? null;
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export interface AccessEntry {
  at: string;
  personId: string | null;
  keyId: string | null;
  role: Role | "none" | null;
  view: string;
  allowed: boolean;
  reason: string;
  params: Record<string, unknown>;
}

/** Append one line to the access log, chained to the one before it by hash. */
export function logAccess(db: TeamDb, e: AccessEntry): void {
  const prev = (db.prepare("SELECT hash FROM team_access_log ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined)?.hash ?? "0".repeat(64);
  const params = canonicalJson(e.params);
  const hash = sha256(canonicalJson({ prev, at: e.at, person: e.personId, key: e.keyId, role: e.role, view: e.view, allowed: e.allowed, reason: e.reason, params }));
  db.prepare("INSERT INTO team_access_log (at, person_id, key_id, role, view, allowed, reason, params, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(e.at, e.personId, e.keyId, e.role, e.view, e.allowed ? 1 : 0, e.reason, params, prev, hash);
}

/** Check the chain from the first line: each line's hash must follow from the one before it and its own fields. */
export function verifyAccessLog(db: TeamDb): { ok: boolean; lines: number; firstBad: number | null } {
  const rows = db.prepare("SELECT * FROM team_access_log ORDER BY seq").all() as unknown as { seq: number; at: string; person_id: string | null; key_id: string | null; role: Role | "none" | null; view: string; allowed: number; reason: string; params: string; prev_hash: string; hash: string }[];
  let prev = "0".repeat(64);
  for (const r of rows) {
    const want = sha256(canonicalJson({ prev, at: r.at, person: r.person_id, key: r.key_id, role: r.role, view: r.view, allowed: r.allowed === 1, reason: r.reason, params: r.params }));
    if (r.prev_hash !== prev || r.hash !== want) return { ok: false, lines: rows.length, firstBad: r.seq };
    prev = r.hash;
  }
  return { ok: true, lines: rows.length, firstBad: null };
}
