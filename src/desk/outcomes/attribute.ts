import type { GitCommit } from "./git.ts";

export type Method = "explicit" | "trailer_window" | "file_overlap" | "time_window";
export type Confidence = "high" | "medium" | "low";
export type LandingState = "unlinked" | "committed" | "merged" | "kept" | "reverted";

export const LANDING_ORDER: Record<LandingState, number> = { unlinked: 0, committed: 1, merged: 2, kept: 3, reverted: -1 };

export const ATTRIBUTION = {
  /** A commit counts as the session's if it was authored up to this long after the session's last call. */
  windowAfterMs: 30 * 60 * 1000,
  /** A merged commit older than this and not reverted counts as kept. */
  keptAfterMs: 7 * 24 * 60 * 60 * 1000,
  /** Time-window evidence alone needs at least this many calls, so a one-call session is not given a commit. */
  minCallsForTimeWindow: 5,
} as const;

export interface SessionFacts {
  sessionId: string;
  startMs: number;
  endMs: number;
  calls: number;
  /** Paths the session wrote to, relative to the repository root. */
  editedFiles: readonly string[];
}

export interface Link {
  sessionId: string;
  sha: string;
  method: Method;
  confidence: Confidence;
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Link one session to the commits of one repository (spec 7.3, adapted). Evidence, strongest first:
 * an agent trailer inside the session window (high); changed files that the session wrote to, inside
 * the window (medium); changed files alone, or the window alone with enough calls (low). The window
 * is the session span plus 30 minutes. File names are compared, not line contents, so file overlap
 * alone never reaches medium. Where two kinds of evidence point at one commit the stronger one is kept.
 */
export function linkSession(session: SessionFacts, commits: readonly GitCommit[]): Link[] {
  const links: Link[] = [];
  const edited = new Set(session.editedFiles);
  for (const c of commits) {
    const at = Date.parse(c.authoredAt);
    if (Number.isNaN(at)) continue;
    const inWindow = at >= session.startMs && at <= session.endMs + ATTRIBUTION.windowAfterMs;
    const overlaps = c.files.some((f) => edited.has(f));
    let link: Link | undefined;
    if (c.agentTrailer && inWindow) link = { sessionId: session.sessionId, sha: c.sha, method: "trailer_window", confidence: "high" };
    else if (overlaps && inWindow) link = { sessionId: session.sessionId, sha: c.sha, method: "file_overlap", confidence: "medium" };
    else if (overlaps) link = { sessionId: session.sessionId, sha: c.sha, method: "file_overlap", confidence: "low" };
    else if (inWindow && session.calls >= ATTRIBUTION.minCallsForTimeWindow) link = { sessionId: session.sessionId, sha: c.sha, method: "time_window", confidence: "low" };
    if (link) links.push(link);
  }
  return links;
}

export interface Outcome {
  state: LandingState;
  bestConfidence: Confidence | null;
  commits: number;
}

/** The furthest a session got, from the commits linked to it. Reverted wins: work that was undone did not land. */
export function outcomeOf(links: readonly Link[], commitsBySha: ReadonlyMap<string, GitCommit>, nowMs: number): Outcome {
  if (links.length === 0) return { state: "unlinked", bestConfidence: null, commits: 0 };
  let state: LandingState = "committed";
  let best: Confidence = "low";
  for (const l of links) {
    if (RANK[l.confidence] > RANK[best]) best = l.confidence;
    const c = commitsBySha.get(l.sha);
    if (!c) continue;
    if (c.reverted) {
      state = "reverted";
      break;
    }
    let s: LandingState = "committed";
    if (c.merged) s = nowMs - Date.parse(c.authoredAt) >= ATTRIBUTION.keptAfterMs ? "kept" : "merged";
    if (LANDING_ORDER[s] > LANDING_ORDER[state]) state = s;
  }
  return { state, bestConfidence: best, commits: links.length };
}
