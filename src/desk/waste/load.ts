import type { AutopsyCall, PerCall } from "../autopsy/engine.ts";
import type { Ledger } from "../ledger/db.ts";
import type { CompactionRecord, Landing } from "./bloat.ts";
import { detectWaste, type CallFacts, type WasteEvent } from "./detect.ts";

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

/** The waste events of these calls: the facts read from the ledger, then the rules. */
export function wasteEventsOf(db: Ledger, calls: readonly AutopsyCall[], analysis: ReadonlyMap<string, PerCall>, facts: ReadonlyMap<string, CallFacts> = loadCallFacts(db, calls)): WasteEvent[] {
  return detectWaste(calls, analysis, facts);
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
