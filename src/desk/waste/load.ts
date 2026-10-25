import type { AutopsyCall, PerCall } from "../autopsy/engine.ts";
import type { Ledger } from "../ledger/db.ts";
import type { CompactionRecord, Landing } from "./bloat.ts";
import type { LandingState } from "../outcomes/attribute.ts";
import { detectWaste, type CallFacts, type OutcomeFacts, type WasteEvent } from "./detect.ts";

/**
 * What the waste rules need about each call beyond the autopsy's record: what each tool use returned (a folded hash, whether the tool said it
 * cut its output short, whether it failed) and which files it edited. Read from the ledger for the calls given, never from a log.
 */
export function loadCallFacts(db: Ledger, calls: readonly AutopsyCall[]): Map<string, CallFacts> {
  const out = new Map<string, CallFacts>();
  if (calls.length === 0) return out;
  const ids = new Set(calls.map((c) => c.callId));
  const sessions = [...new Set(calls.map((c) => c.sessionId))];
  const rows: { call_id: string; name: string; input_hash: string; result_hash: string | null; truncated: number | null; is_error: number | null; result_chars: number | null; path: string | null }[] = [];
  // In slices of sessions, so that a long window does not become one enormous statement.
  for (let i = 0; i < sessions.length; i += 400) {
    const slice = sessions.slice(i, i + 400);
    const part = db
      .prepare(
        `SELECT t.call_id, t.name, t.input_hash, r.result_hash, r.truncated, r.is_error, r.result_chars, e.path
         FROM tool_call t LEFT JOIN tool_result r ON r.tool_use_id = t.tool_use_id LEFT JOIN session_edit e ON e.tool_use_id = t.tool_use_id
         WHERE t.session_id IN (${slice.map(() => "?").join(",")})`,
      )
      .all(...slice) as unknown as typeof rows;
    for (const r of part) rows.push(r);
  }
  for (const r of rows) {
    if (!ids.has(r.call_id)) continue;
    const f = out.get(r.call_id) ?? { results: [], editedPaths: [] };
    f.results.push({ name: r.name, inputHash: r.input_hash, resultHash: r.result_hash, truncated: r.truncated === 1, isError: r.is_error === 1, ...(r.result_chars !== null ? { chars: r.result_chars } : {}) });
    if (r.path !== null) f.editedPaths.push(r.path);
    out.set(r.call_id, f);
  }
  return out;
}

/** The waste events of these calls: the facts read from the ledger, then the rules. The two rules that need outcomes run when git was scanned and are silent when it was not. */
export function wasteEventsOf(db: Ledger, calls: readonly AutopsyCall[], analysis: ReadonlyMap<string, PerCall>, facts: ReadonlyMap<string, CallFacts> = loadCallFacts(db, calls), outcomes: OutcomeFacts | null = loadOutcomeFacts(db)): WasteEvent[] {
  return detectWaste(calls, analysis, facts, outcomes ?? undefined);
}

/**
 * What the ledger holds about outcomes, for C-ABANDON and C-REVERT, or null when it holds none: no session has a landing state, or the ledger is older than the table.
 * A ledger where `desk landing` never ran says nothing about whether work landed, so these rules do not guess.
 */
export function loadOutcomeFacts(db: Ledger): OutcomeFacts | null {
  const has = (name: string): boolean => ((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { n: number }).n ?? 0) > 0;
  if (!has("session_outcome") || !has("git_commit")) return null;
  if (((db.prepare("SELECT COUNT(*) AS n FROM session_outcome").get() as { n: number }).n ?? 0) === 0) return null;
  const asOf = (db.prepare("SELECT MAX(ts) AS t FROM model_call").get() as { t: string | null }).t;
  if (asOf === null) return null;
  const stateOf = db.prepare("SELECT state, best_confidence FROM session_outcome WHERE session_id = ?");
  const countOf = db.prepare("SELECT COUNT(*) AS n, MAX(ts) AS last FROM model_call WHERE session_id = ?");
  const folderOf = db.prepare("SELECT project_path FROM session WHERE session_id = ?");
  // Other sessions in a folder, with the time of their first call; read once per folder, because a folder can hold hundreds of sessions.
  const startsIn = db.prepare("SELECT s.session_id AS id, MIN(m.ts) AS first FROM session s JOIN model_call m ON m.session_id = s.session_id WHERE s.project_path = ? GROUP BY s.session_id");
  const folderStarts = new Map<string, { id: string; ms: number }[]>();
  const landing = commitLanding(db);
  // Pull request facts, when `desk landing --prs` was run: which pull requests (by state) each commit is in. Read once, because there are few.
  const prsOf = new Map<string, { number: number; state: string }[]>();
  if (has("pr_fact")) {
    const rows = db.prepare("SELECT repo_id, number, state, commit_shas FROM pr_fact").all() as unknown as { repo_id: number; number: number; state: string; commit_shas: string }[];
    for (const r of rows) {
      for (const sha of JSON.parse(r.commit_shas) as string[]) {
        const key = `${r.repo_id}:${sha}`;
        const list = prsOf.get(key) ?? [];
        list.push({ number: r.number, state: r.state });
        prsOf.set(key, list);
      }
    }
  }
  const trustedLinks = db.prepare("SELECT repo_id, sha FROM session_commit WHERE session_id = ? AND confidence IN ('high', 'medium')");
  return {
    asOfMs: Date.parse(asOf),
    abandonedPrs(sessionId) {
      if (prsOf.size === 0) return null;
      if ((stateOf.get(sessionId) as { state: string } | undefined)?.state !== "committed") return null;
      const links = trustedLinks.all(sessionId) as unknown as { repo_id: number; sha: string }[];
      if (links.length === 0) return null;
      const numbers = new Set<number>();
      for (const l of links) {
        const prs = prsOf.get(`${l.repo_id}:${l.sha}`) ?? [];
        // A commit in no pull request, or in one that is open or merged, means the work was not turned down.
        if (prs.length === 0 || prs.some((p) => p.state !== "closed_unmerged")) return null;
        for (const p of prs) numbers.add(p.number);
      }
      return [...numbers].sort((a, b) => a - b);
    },
    state(sessionId) {
      const r = stateOf.get(sessionId) as { state: LandingState; best_confidence: "high" | "medium" | "low" | null } | undefined;
      return r ? { state: r.state, bestConfidence: r.best_confidence } : null;
    },
    landing,
    callCount: (sessionId) => (countOf.get(sessionId) as { n: number }).n,
    lastCallMs: (sessionId) => Date.parse((countOf.get(sessionId) as { last: string | null }).last ?? "") || 0,
    resumed(sessionId, endMs, withinMs) {
      const folder = (folderOf.get(sessionId) as { project_path: string | null } | undefined)?.project_path;
      // A session with no folder cannot be matched to a later one, so it is not taken for resumed; the landing check has already said "unknown" for it.
      if (!folder) return false;
      let list = folderStarts.get(folder);
      if (!list) {
        list = (startsIn.all(folder) as unknown as { id: string; first: string }[]).map((r) => ({ id: r.id, ms: Date.parse(r.first) }));
        folderStarts.set(folder, list);
      }
      return list.some((x) => x.id !== sessionId && x.ms > endMs && x.ms <= endMs + withinMs);
    },
  };
}

/** The compactions the logs record in a period, keyed by the log file they were read from, like the calls of that thread. */
export function loadCompactions(db: Ledger, sinceIso: string, untilIso: string): CompactionRecord[] {
  const rows = db
    .prepare("SELECT source_id, session_id, ts, trigger, pre_tokens, post_tokens FROM session_compaction WHERE ts >= ? AND ts <= ? ORDER BY ts")
    .all(sinceIso, untilIso) as unknown as { source_id: number | null; session_id: string; ts: string; trigger: string; pre_tokens: number; post_tokens: number | null }[];
  return rows.map((r) => ({ sessionId: r.session_id, threadKey: String(r.source_id ?? r.session_id), tsMs: Date.parse(r.ts), trigger: r.trigger, preTokens: r.pre_tokens, postTokens: r.post_tokens }));
}

const pathKey = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * What is known of the work a session landed between two times: a commit tied to the session (`landed`), a commit in the session's repository
 * that is not tied to it (`possible`), none in a repository the ledger scanned (`none`), or a folder that is not inside a scanned repository
 * (`unknown`). A session with no commit tied to it is never taken for one that landed nothing unless its whole repository was quiet.
 */
export function commitLanding(db: Ledger): (sessionId: string, fromMs: number, toMs: number) => Landing {
  const tiedCache = new Map<string, number[]>();
  const tied = db.prepare("SELECT g.authored_at FROM session_commit sc JOIN git_commit g ON g.repo_id = sc.repo_id AND g.sha = sc.sha WHERE sc.session_id = ?");
  const folderOf = db.prepare("SELECT project_path FROM session WHERE session_id = ?");
  const repos = (db.prepare("SELECT repo_id, root, scanned_at FROM repo").all() as unknown as { repo_id: number; root: string; scanned_at: string }[])
    .filter((r) => r.root !== "." && !r.root.startsWith("./"))
    .map((r) => ({ id: r.repo_id, key: pathKey(r.root), scannedMs: Date.parse(r.scanned_at) }));
  const commitCache = new Map<number, number[]>();
  const commitsOf = db.prepare("SELECT authored_at FROM git_commit WHERE repo_id = ?");
  const inside = (times: readonly number[], from: number, to: number): boolean => times.some((t) => t >= from && t <= to);
  return (sessionId, fromMs, toMs) => {
    let mine = tiedCache.get(sessionId);
    if (!mine) {
      mine = (tied.all(sessionId) as unknown as { authored_at: string }[]).map((r) => Date.parse(r.authored_at)).filter((t) => !Number.isNaN(t));
      tiedCache.set(sessionId, mine);
    }
    if (inside(mine, fromMs, toMs)) return "landed";
    const folder = (folderOf.get(sessionId) as { project_path: string | null } | undefined)?.project_path;
    if (!folder) return "unknown";
    const key = pathKey(folder);
    const repo = repos.filter((r) => key === r.key || key.startsWith(`${r.key}/`)).sort((a, b) => b.key.length - a.key.length)[0];
    // A scan that ran before the phase ended cannot say what came after it.
    if (!repo || Number.isNaN(repo.scannedMs) || repo.scannedMs < toMs) return "unknown";
    let all = commitCache.get(repo.id);
    if (!all) {
      all = (commitsOf.all(repo.id) as unknown as { authored_at: string }[]).map((r) => Date.parse(r.authored_at)).filter((t) => !Number.isNaN(t));
      commitCache.set(repo.id, all);
    }
    return inside(all, fromMs, toMs) ? "possible" : "none";
  };
}
