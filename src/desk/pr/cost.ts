import { basename } from "node:path";

import type { Ledger } from "../ledger/db.ts";

/**
 * What the agent work behind one change cost, from the sessions the ledger has tied to the change's commits. A session
 * can produce commits in several changes, so each session is counted in proportion to the share of its commits that are in
 * this change; the session's whole cost is shown beside it. Costs are list-price estimates from logged tokens, never an
 * invoice, and a session on a model with no price is shown as unpriced and adds nothing.
 */
export type Confidence = "high" | "medium" | "low";

export interface PrSession {
  sessionId: string;
  project: string | null;
  commitsInChange: number;
  commitsInAll: number;
  /** The weakest link between this session and a commit of the change. */
  weakest: Confidence;
  calls: number;
  unpricedCalls: number;
  /** The session's whole estimated cost, null when none of its calls is priced. */
  fullMicros: number | null;
  /** The part counted for this change: the whole cost times commits in the change over commits in all. */
  shareMicros: number | null;
}

export interface PrCost {
  /** Commits in the change. */
  commits: number;
  /** Of them, tied to at least one session; known to the ledger but tied to none; not in the ledger at all (the repository was not scanned since). */
  tiedCommits: number;
  untiedCommits: number;
  unseenCommits: number;
  sessions: PrSession[];
  shareMicros: number;
  fullMicros: number;
  byConfidence: Record<Confidence, number>;
  unpricedCalls: number;
}

const RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

export function prCost(db: Ledger, repoRoot: string, shas: readonly string[]): PrCost {
  const empty: PrCost = { commits: shas.length, tiedCommits: 0, untiedCommits: 0, unseenCommits: shas.length, sessions: [], shareMicros: 0, fullMicros: 0, byConfidence: { high: 0, medium: 0, low: 0 }, unpricedCalls: 0 };
  const repo = db.prepare("SELECT repo_id FROM repo WHERE root = ?").get(repoRoot) as { repo_id: number } | undefined;
  if (!repo || shas.length === 0) return empty;

  const known = db.prepare("SELECT 1 FROM git_commit WHERE repo_id = ? AND sha = ?");
  const links = db.prepare("SELECT session_id AS sessionId, confidence FROM session_commit WHERE repo_id = ? AND sha = ?");
  const inChange = new Map<string, { n: number; weakest: Confidence }>();
  let tied = 0;
  let untied = 0;
  let unseen = 0;
  for (const sha of shas) {
    if (!known.get(repo.repo_id, sha)) {
      unseen += 1;
      continue;
    }
    const rows = links.all(repo.repo_id, sha) as unknown as { sessionId: string; confidence: Confidence }[];
    if (rows.length === 0) untied += 1;
    else tied += 1;
    for (const r of rows) {
      const have = inChange.get(r.sessionId);
      if (!have) inChange.set(r.sessionId, { n: 1, weakest: r.confidence });
      else {
        have.n += 1;
        if (RANK[r.confidence] < RANK[have.weakest]) have.weakest = r.confidence;
      }
    }
  }

  const allCommits = db.prepare("SELECT COUNT(*) AS n FROM session_commit WHERE session_id = ?");
  const cost = db.prepare(
    `SELECT COUNT(*) AS calls, SUM(CASE WHEN c.class = 'unpriced' THEN 1 ELSE 0 END) AS unpriced, SUM(c.total_micros) AS micros
     FROM model_call m LEFT JOIN cost_event c ON c.call_id = m.call_id WHERE m.session_id = ?`,
  );
  const project = db.prepare("SELECT project_path FROM session WHERE session_id = ?");
  const sessions: PrSession[] = [];
  const byConfidence: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
  let share = 0;
  let full = 0;
  let unpricedCalls = 0;
  for (const [sessionId, link] of inChange) {
    const total = (allCommits.get(sessionId) as { n: number }).n;
    const c = cost.get(sessionId) as { calls: number; unpriced: number | null; micros: number | null };
    const fullMicros = c.micros;
    const shareMicros = fullMicros === null ? null : Math.round((fullMicros * link.n) / Math.max(link.n, total));
    const p = project.get(sessionId) as { project_path: string | null } | undefined;
    sessions.push({ sessionId, project: p?.project_path ?? null, commitsInChange: link.n, commitsInAll: Math.max(link.n, total), weakest: link.weakest, calls: c.calls, unpricedCalls: c.unpriced ?? 0, fullMicros, shareMicros });
    if (fullMicros !== null) full += fullMicros;
    if (shareMicros !== null) {
      share += shareMicros;
      byConfidence[link.weakest] += shareMicros;
    }
    unpricedCalls += c.unpriced ?? 0;
  }
  sessions.sort((a, b) => (b.shareMicros ?? -1) - (a.shareMicros ?? -1) || a.sessionId.localeCompare(b.sessionId));
  return { commits: shas.length, tiedCommits: tied, untiedCommits: untied, unseenCommits: unseen, sessions, shareMicros: share, fullMicros: full, byConfidence, unpricedCalls };
}

const usd = (micros: number): string => `$${(micros / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Markdown for a pull request description or comment. */
export function renderPr(r: PrCost): string {
  const lines = ["### Agent cost of this change", ""];
  if (r.commits === 0) return [...lines, "There are no commits in this change."].join("\n");
  if (r.sessions.length === 0) {
    const why =
      r.unseenCommits === r.commits && r.commits > 0
        ? `None of the ${plural(r.commits, "commit")} in this change is in the ledger yet; run \`desk landing\` first.`
        : `No agent session is tied to any of the ${plural(r.commits, "commit")} in this change.`;
    lines.push(why, "", "Sessions are tied to commits by an explicit marker, by the files the session wrote, or by timing; none matched.");
    return lines.join("\n");
  }
  lines.push(
    `Estimated at list prices from the agents' own logs: **${usd(r.shareMicros)}** across ${plural(r.sessions.length, "session")}. The sessions cost ${usd(r.fullMicros)} in all; each is counted in proportion to the commits of it that are in this change.`,
    "",
    "| Session | Commits here / in all | Counted | Whole session | Tie |",
    "|---|---|---|---|---|",
  );
  for (const s of r.sessions) {
    lines.push(`| ${s.sessionId.slice(0, 8)}${s.project ? ` (${basename(s.project)})` : ""} | ${s.commitsInChange} / ${s.commitsInAll} | ${s.shareMicros === null ? "unpriced" : usd(s.shareMicros)} | ${s.fullMicros === null ? "unpriced" : usd(s.fullMicros)} | ${s.weakest} |`);
  }
  lines.push("", `${r.tiedCommits} of ${plural(r.commits, "commit")} in this change ${r.tiedCommits === 1 ? "is" : "are"} tied to a session${r.untiedCommits + r.unseenCommits > 0 ? `; ${r.untiedCommits} ${r.untiedCommits === 1 ? "is" : "are"} tied to none${r.unseenCommits > 0 ? ` and ${r.unseenCommits} not yet in the ledger` : ""}` : ""}.`);
  const conf = (["high", "medium", "low"] as const).filter((c) => r.byConfidence[c] > 0).map((c) => `${usd(r.byConfidence[c])} ${c}`);
  if (conf.length > 0) lines.push(`How firmly the cost is tied to this change: ${conf.join(", ")}.`);
  if (r.unpricedCalls > 0) lines.push(`${plural(r.unpricedCalls, "call")} on a model with no price are not counted.`);
  lines.push("", "This is an estimate, not an invoice. Sessions that left no commit in this change are not counted.");
  return lines.join("\n");
}
