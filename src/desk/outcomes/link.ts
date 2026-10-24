import { resolve, sep } from "node:path";

import type { Ledger } from "../ledger/db.ts";
import { assignCommits, outcomeOf, type Confidence, type LandingState, type Link, type SessionFacts } from "./attribute.ts";
import { pseudonym } from "../security/secrets.ts";
import { relativeTo, scanRepo, type GitCommit } from "./git.ts";

export interface LinkReport {
  repos: number;
  commits: number;
  sessions: number;
  links: number;
  byState: Record<LandingState, number>;
}

function normal(path: string): string {
  const abs = resolve(path);
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

function isUnder(root: string, path: string): boolean {
  const r = normal(root);
  const p = normal(path);
  return p === r || p.startsWith(r.endsWith(sep) ? r : r + sep);
}

/**
 * Read the given repositories, link sessions to commits and record each session's landing state.
 * Re-running recomputes all links and outcomes from current git state (merges and reverts happen
 * after the session). Sessions that touch no repository stay `unlinked`, and that share is reported,
 * never folded into waste.
 */
export function linkOutcomes(db: Ledger, repoRoots: readonly string[], nowMs: number): LinkReport {
  const report: LinkReport = { repos: 0, commits: 0, sessions: 0, links: 0, byState: { unlinked: 0, committed: 0, merged: 0, kept: 0, reverted: 0 } };
  const sessions = db
    .prepare(
      `SELECT s.session_id, s.project_path, MIN(m.ts) AS start_ts, MAX(m.ts) AS end_ts, COUNT(*) AS calls
       FROM session s JOIN model_call m ON m.session_id = s.session_id GROUP BY s.session_id`,
    )
    .all() as unknown as { session_id: string; project_path: string | null; start_ts: string; end_ts: string; calls: number }[];
  const editsBySession = new Map<string, string[]>();
  const lastEditBySession = new Map<string, number>();
  for (const e of db.prepare("SELECT session_id, path, ts FROM session_edit").all() as unknown as { session_id: string; path: string; ts: string }[]) {
    const list = editsBySession.get(e.session_id) ?? [];
    list.push(e.path);
    editsBySession.set(e.session_id, list);
    const t = Date.parse(e.ts);
    if (!Number.isNaN(t)) lastEditBySession.set(e.session_id, Math.max(lastEditBySession.get(e.session_id) ?? 0, t));
  }

  const earliest = sessions.reduce((min, s) => (s.start_ts < min ? s.start_ts : min), sessions[0]?.start_ts ?? new Date(nowMs).toISOString());
  const since = new Date(Date.parse(earliest) - 24 * 60 * 60 * 1000).toISOString();

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM session_commit; DELETE FROM session_outcome;");
    const bySession = new Map<string, { links: Link[]; commits: Map<string, GitCommit> }>();
    const insertRepo = db.prepare(
      `INSERT INTO repo (root, default_ref, scanned_at) VALUES (?, ?, ?)
       ON CONFLICT (root) DO UPDATE SET default_ref = excluded.default_ref, scanned_at = excluded.scanned_at RETURNING repo_id`,
    );
    const insertCommit = db.prepare(
      `INSERT OR REPLACE INTO git_commit (repo_id, sha, authored_at, author_email, agent_trailer, files, merged, reverted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertLink = db.prepare("INSERT OR REPLACE INTO session_commit (session_id, repo_id, sha, method, confidence) VALUES (?, ?, ?, ?, ?)");

    for (const root of repoRoots) {
      const scan = scanRepo(root, since);
      const repoId = (insertRepo.get(root, scan.defaultRef, new Date(nowMs).toISOString()) as { repo_id: number }).repo_id;
      report.repos += 1;
      for (const c of scan.commits) {
        insertCommit.run(repoId, c.sha, c.authoredAt, pseudonym(c.authorEmail), c.agentTrailer ? 1 : 0, JSON.stringify(c.files), c.merged ? 1 : 0, c.reverted ? 1 : 0);
        report.commits += 1;
      }
      const commitMap = new Map(scan.commits.map((c) => [c.sha, c]));
      const facts: SessionFacts[] = [];
      for (const s of sessions) {
        const edited = (editsBySession.get(s.session_id) ?? []).map((p) => relativeTo(root, p)).filter((p): p is string => p !== null);
        const inRepo = (s.project_path !== null && isUnder(root, s.project_path)) || edited.length > 0;
        if (inRepo) facts.push({ sessionId: s.session_id, startMs: Date.parse(s.start_ts), endMs: Date.parse(s.end_ts), calls: s.calls, editedFiles: edited, ...(lastEditBySession.has(s.session_id) ? { lastEditMs: lastEditBySession.get(s.session_id)! } : {}) });
      }
      for (const l of assignCommits(facts, scan.commits)) {
        const entry = bySession.get(l.sessionId) ?? { links: [], commits: new Map<string, GitCommit>() };
        entry.links.push(l);
        const c = commitMap.get(l.sha);
        if (c) entry.commits.set(l.sha, c);
        insertLink.run(l.sessionId, repoId, l.sha, l.method, l.confidence);
        report.links += 1;
        bySession.set(l.sessionId, entry);
      }
    }

    const insertOutcome = db.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, ?, ?, ?, ?)");
    for (const s of sessions) {
      report.sessions += 1;
      const entry = bySession.get(s.session_id);
      const o = entry ? outcomeOf(entry.links, entry.commits, nowMs) : { state: "unlinked" as LandingState, bestConfidence: null as Confidence | null, commits: 0 };
      report.byState[o.state] += 1;
      insertOutcome.run(s.session_id, o.state, o.bestConfidence, o.commits, new Date(nowMs).toISOString());
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return report;
}
