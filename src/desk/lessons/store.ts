import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Precedent } from "../ask/ask.ts";
import type { AnswerProgram } from "../ask/program.ts";
import { hashJson } from "../../runtime/canonical.ts";

/**
 * Lessons: what the Desk keeps from its own mistakes. A mistake is an answer the checker found wrong. The lesson holds
 * the question, what a right answer had to say, and the change that follows: a plan that was run and scored right, kept
 * as a precedent for questions of the same shape. No model weights change. Every lesson is also a regression test:
 * asked again with the lessons in force, its own question must now come out right.
 */
export type LessonKind = "wrong_plan" | "auditor_rejection" | "owner_correction" | "false_alarm" | "prediction_miss";
export type ChangeKind = "precedent" | "none";
/** pending: a plan was verified and the lesson waits for its round. unresolved: no plan was found, so nothing changes. */
export type LessonStatus = "pending" | "accepted" | "reverted" | "unresolved";

export interface Lesson {
  id: string;
  kind: LessonKind;
  question: string;
  /** What a right answer had to state, as the checker holds it. */
  expected: unknown;
  changeKind: ChangeKind;
  /** The plan that gave a verified answer, when the change is a precedent. */
  program: AnswerProgram | null;
  /** How many plans were tried before one was verified. */
  attempts: number;
  round: number | null;
  status: LessonStatus;
  createdAt: string;
}

export interface RoundRow {
  round: number;
  nLessons: number;
  exact: number;
  n: number;
  /** Held-out error: the share of held-out questions answered wrong. */
  heldoutError: number;
  intervalLow: number;
  intervalHigh: number;
  reverted: boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lesson (
  lesson_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('wrong_plan','auditor_rejection','owner_correction','false_alarm','prediction_miss')),
  question TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  expected_json TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('precedent','none')),
  change_ref TEXT,
  program_json TEXT,
  attempts INTEGER NOT NULL,
  round INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','reverted','unresolved')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lesson_round (
  round INTEGER PRIMARY KEY,
  n_lessons INTEGER NOT NULL,
  exact INTEGER NOT NULL,
  n INTEGER NOT NULL,
  heldout_error REAL NOT NULL,
  interval_low REAL NOT NULL,
  interval_high REAL NOT NULL,
  reverted INTEGER NOT NULL
);
`;

export function openLessons(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

export function addLesson(db: DatabaseSync, l: Omit<Lesson, "id" | "status" | "round"> & { status?: LessonStatus; round?: number | null }): Lesson {
  const id = `L-${hashJson({ k: l.kind, q: l.question } as never).slice(7, 19)}`;
  const status = l.status ?? (l.changeKind === "precedent" ? "pending" : "unresolved");
  db.prepare(
    "INSERT OR REPLACE INTO lesson (lesson_id, kind, question, input_hash, expected_json, change_kind, change_ref, program_json, attempts, round, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, l.kind, l.question, hashJson({ q: l.question } as never), JSON.stringify(l.expected), l.changeKind, l.program ? hashJson(l.program as never) : null, l.program ? JSON.stringify(l.program) : null, l.attempts, l.round ?? null, status, l.createdAt);
  return { ...l, id, status, round: l.round ?? null };
}

interface LessonRow {
  lesson_id: string;
  kind: LessonKind;
  question: string;
  expected_json: string;
  change_kind: ChangeKind;
  program_json: string | null;
  attempts: number;
  round: number | null;
  status: LessonStatus;
  created_at: string;
}

export function allLessons(db: DatabaseSync): Lesson[] {
  const rows = db.prepare("SELECT * FROM lesson ORDER BY created_at, lesson_id").all() as unknown as LessonRow[];
  return rows.map((r) => ({ id: r.lesson_id, kind: r.kind, question: r.question, expected: JSON.parse(r.expected_json) as unknown, changeKind: r.change_kind, program: r.program_json ? (JSON.parse(r.program_json) as AnswerProgram) : null, attempts: r.attempts, round: r.round, status: r.status, createdAt: r.created_at }));
}

/** The precedents in force: lessons that were accepted and carry a plan. */
export function precedentsInForce(db: DatabaseSync, upToRound: number | null = null): Precedent[] {
  return allLessons(db)
    .filter((l) => l.status === "accepted" && l.changeKind === "precedent" && l.program !== null && (upToRound === null || (l.round !== null && l.round <= upToRound)))
    .map((l) => ({ id: l.id, question: l.question, program: l.program! }));
}

export function setStatus(db: DatabaseSync, id: string, status: LessonStatus): void {
  db.prepare("UPDATE lesson SET status = ? WHERE lesson_id = ?").run(status, id);
}

export function addRound(db: DatabaseSync, r: RoundRow): void {
  db.prepare("INSERT OR REPLACE INTO lesson_round (round, n_lessons, exact, n, heldout_error, interval_low, interval_high, reverted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(r.round, r.nLessons, r.exact, r.n, r.heldoutError, r.intervalLow, r.intervalHigh, r.reverted ? 1 : 0);
}

export function allRounds(db: DatabaseSync): RoundRow[] {
  const rows = db.prepare("SELECT * FROM lesson_round ORDER BY round").all() as unknown as { round: number; n_lessons: number; exact: number; n: number; heldout_error: number; interval_low: number; interval_high: number; reverted: number }[];
  return rows.map((r) => ({ round: r.round, nLessons: r.n_lessons, exact: r.exact, n: r.n, heldoutError: r.heldout_error, intervalLow: r.interval_low, intervalHigh: r.interval_high, reverted: r.reverted === 1 }));
}
