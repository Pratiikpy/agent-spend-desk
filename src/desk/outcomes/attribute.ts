import type { GitCommit } from "./git.ts";

export type Method = "explicit" | "trailer_window" | "file_overlap" | "time_window";
export type Confidence = "high" | "medium" | "low";
export type LandingState = "unlinked" | "committed" | "merged" | "kept" | "reverted";

export const LANDING_ORDER: Record<LandingState, number> = { unlinked: 0, committed: 1, merged: 2, kept: 3, reverted: -1 };

export const ATTRIBUTION = {
  /** A commit counts as inside a session's window if authored up to this long after the session's last call. */
  windowAfterMs: 30 * 60 * 1000,
  /** A merged commit older than this and not reverted counts as kept. */
  keptAfterMs: 7 * 24 * 60 * 60 * 1000,
  /** Time-window evidence alone needs at least this many calls, so a one-call session is not given a commit. */
  minCallsForTimeWindow: 5,
  /** Share of a commit's files that the session must have written to for the files to count as a match. */
  fileMatchShare: 0.5,
} as const;

export interface SessionFacts {
  sessionId: string;
  startMs: number;
  endMs: number;
  calls: number;
  /** Paths the session wrote to, relative to the repository root. */
  editedFiles: readonly string[];
  /** When the session last wrote to a file; a commit is expected soon after. Defaults to the end of the session. */
  lastEditMs?: number;
}

export interface Link {
  sessionId: string;
  sha: string;
  method: Method;
  confidence: Confidence;
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

interface Evidence {
  sessionId: string;
  method: Method;
  confidence: Confidence;
  /** Share of the commit's files the session wrote to. */
  fileShare: number;
  /** Distance in ms between the session's last call and the commit (0 inside the session). */
  gapMs: number;
}

function evidenceFor(s: SessionFacts, c: GitCommit): Evidence | null {
  const at = Date.parse(c.authoredAt);
  if (Number.isNaN(at)) return null;
  const inWindow = at >= s.startMs && at <= s.endMs + ATTRIBUTION.windowAfterMs;
  const edited = new Set(s.editedFiles);
  const matched = c.files.filter((f) => edited.has(f)).length;
  const fileShare = c.files.length === 0 ? 0 : matched / c.files.length;
  const filesMatch = fileShare >= ATTRIBUTION.fileMatchShare;
  // Closeness is measured from the session's last file write: the author commits soon after finishing the edit.
  const anchor = s.lastEditMs ?? s.endMs;
  const gapMs = Math.abs(at - anchor);
  const base = { sessionId: s.sessionId, fileShare, gapMs };
  if (c.agentTrailer && inWindow && filesMatch) return { ...base, method: "trailer_window", confidence: "high" };
  if (inWindow && filesMatch) return { ...base, method: "file_overlap", confidence: "medium" };
  if (c.agentTrailer && inWindow && s.editedFiles.length === 0) return { ...base, method: "trailer_window", confidence: "medium" };
  if (matched > 0 && at >= s.startMs) return { ...base, method: "file_overlap", confidence: "low" };
  if (inWindow && s.calls >= ATTRIBUTION.minCallsForTimeWindow) return { ...base, method: "time_window", confidence: "low" };
  return null;
}

/**
 * Attribute each commit to the one session most likely to have produced it (spec 7.3, adapted). Evidence,
 * strongest first: an agent trailer inside the session window and the files the session wrote (high);
 * the files inside the window (medium); partial file overlap or the time window alone (low). A commit goes
 * to the best-evidenced session; if two sessions are equally good the commit is linked to both at low
 * confidence, because the data cannot tell them apart. Names of files are compared, never their contents.
 */
export function assignCommits(sessions: readonly SessionFacts[], commits: readonly GitCommit[]): Link[] {
  const links: Link[] = [];
  for (const c of commits) {
    const all: Evidence[] = [];
    for (const s of sessions) {
      const e = evidenceFor(s, c);
      if (e) all.push(e);
    }
    if (all.length === 0) continue;
    all.sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || b.fileShare - a.fileShare || a.gapMs - b.gapMs);
    const best = all[0]!;
    const tied = all.filter((e) => e.confidence === best.confidence && e.fileShare === best.fileShare && e.gapMs === best.gapMs);
    if (tied.length === 1) links.push({ sessionId: best.sessionId, sha: c.sha, method: best.method, confidence: best.confidence });
    else for (const e of tied) links.push({ sessionId: e.sessionId, sha: c.sha, method: e.method, confidence: "low" });
  }
  return links;
}

export interface Outcome {
  state: LandingState;
  bestConfidence: Confidence | null;
  commits: number;
}

/**
 * The furthest a session got, from its links. Only links of medium or high confidence can move a session out
 * of `unlinked`: a weak link shows up in `bestConfidence` and the count, but cannot make work look landed or
 * reverted. Reverted wins among the trusted links: undone work did not land.
 */
export function outcomeOf(links: readonly Link[], commitsBySha: ReadonlyMap<string, GitCommit>, nowMs: number): Outcome {
  if (links.length === 0) return { state: "unlinked", bestConfidence: null, commits: 0 };
  let best: Confidence = "low";
  for (const l of links) if (RANK[l.confidence] > RANK[best]) best = l.confidence;
  const trusted = links.filter((l) => RANK[l.confidence] >= RANK.medium);
  if (trusted.length === 0) return { state: "unlinked", bestConfidence: best, commits: links.length };
  let state: LandingState = "committed";
  for (const l of trusted) {
    const c = commitsBySha.get(l.sha);
    if (!c) continue;
    if (c.reverted) return { state: "reverted", bestConfidence: best, commits: links.length };
    let s: LandingState = "committed";
    if (c.merged) s = nowMs - Date.parse(c.authoredAt) >= ATTRIBUTION.keptAfterMs ? "kept" : "merged";
    if (LANDING_ORDER[s] > LANDING_ORDER[state]) state = s;
  }
  return { state, bestConfidence: best, commits: links.length };
}
