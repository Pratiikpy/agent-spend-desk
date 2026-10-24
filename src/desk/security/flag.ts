import type { Ledger } from "../ledger/db.ts";
import { scanInjection, type InjectionKind } from "./injection.ts";

/**
 * After an ingest, look at every piece of log text the ledger keeps for instruction-like content and record what was found: which session, which field,
 * what kind, and a short cleaned excerpt. The scan is over distinct values, so a value repeated across thousands of calls is read once; it is idempotent,
 * so running it after every ingest only adds what is new. It reads and records. It changes no cost, no landing state and no policy, and nothing is
 * deleted: the text itself is already masked on the way in, and a model is never shown a name that was flagged (see `sanitizeLabel`).
 */
export type FlaggedField = "project_path" | "git_branch" | "tool_version" | "edited_path" | "model";

export interface UntrustedFlag {
  sessionId: string;
  field: FlaggedField;
  kind: InjectionKind;
  excerpt: string;
  foundAt: string;
}

interface Source {
  field: FlaggedField;
  /** Distinct values, each with the sessions that carry it. */
  values: string;
  sessions: string;
}

const SOURCES: readonly Source[] = [
  { field: "project_path", values: "SELECT DISTINCT project_path AS v FROM session WHERE project_path IS NOT NULL", sessions: "SELECT session_id AS s FROM session WHERE project_path = ?" },
  { field: "git_branch", values: "SELECT DISTINCT git_branch AS v FROM session WHERE git_branch IS NOT NULL", sessions: "SELECT session_id AS s FROM session WHERE git_branch = ?" },
  { field: "tool_version", values: "SELECT DISTINCT tool_version AS v FROM session WHERE tool_version IS NOT NULL", sessions: "SELECT session_id AS s FROM session WHERE tool_version = ?" },
  { field: "edited_path", values: "SELECT DISTINCT path AS v FROM session_edit WHERE path IS NOT NULL", sessions: "SELECT DISTINCT session_id AS s FROM session_edit WHERE path = ?" },
  { field: "model", values: "SELECT DISTINCT model AS v FROM model_call WHERE model IS NOT NULL", sessions: "SELECT DISTINCT session_id AS s FROM model_call WHERE model = ?" },
];

/** Returns how many new flags were recorded. */
export function flagUntrustedText(db: Ledger, nowIso: string): number {
  const insert = db.prepare("INSERT OR IGNORE INTO untrusted_flag (session_id, field, kind, excerpt, found_at) VALUES (?, ?, ?, ?, ?)");
  let added = 0;
  for (const src of SOURCES) {
    const sessionsOf = db.prepare(src.sessions);
    for (const row of db.prepare(src.values).all() as { v: string }[]) {
      const findings = scanInjection(row.v);
      if (findings.length === 0) continue;
      for (const s of sessionsOf.all(row.v) as { s: string }[]) {
        for (const f of findings) added += Number(insert.run(s.s, src.field, f.kind, f.excerpt, nowIso).changes);
      }
    }
  }
  return added;
}

export function flagsFor(db: Ledger, sessionId: string): UntrustedFlag[] {
  return (db.prepare("SELECT session_id AS sessionId, field, kind, excerpt, found_at AS foundAt FROM untrusted_flag WHERE session_id = ? ORDER BY field, kind").all(sessionId) as unknown as UntrustedFlag[]);
}

export function flagTotals(db: Ledger): { sessions: number; flags: number; byKind: { kind: string; flags: number }[] } {
  const t = db.prepare("SELECT COUNT(DISTINCT session_id) AS s, COUNT(*) AS f FROM untrusted_flag").get() as { s: number; f: number };
  const byKind = db.prepare("SELECT kind, COUNT(*) AS flags FROM untrusted_flag GROUP BY kind ORDER BY flags DESC, kind").all() as unknown as { kind: string; flags: number }[];
  return { sessions: Number(t.s), flags: Number(t.f), byKind };
}
