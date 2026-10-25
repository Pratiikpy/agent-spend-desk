import { createHash } from "node:crypto";

import type { Ledger } from "../ledger/db.ts";
import { identify, type TaskMarker } from "../tasks/identity.ts";
import { taskType } from "../estimate/estimate.ts";
import { wilson } from "../stats/intervals.ts";

/**
 * Earned autonomy (DF-093). A kind of work (a branch prefix: feat, fix, chore; or `session` for work with no label) starts supervised: the gate asks a person when a request
 * crosses a soft limit. A kind of work can earn the right to go on without asking, and loses it the moment it stops deserving it. What counts as deserving is measured on the
 * owner's own finished runs: a run is a success when its work landed and stayed (merged, at least 14 days old, never reverted) and a failure when it was reverted or sat
 * committed and unmerged for 14 days. A run still inside its 14 days, or never tied to a commit, is neither: it is counted apart and the rate is taken over the rest.
 *
 * Promotion is a proposal the owner approves by echoing the evidence's digest; demotion is automatic and instant. The Desk never promotes by itself, never goes past
 * `guarded_auto` by itself, and never lifts a block the owner set.
 */
export const TIERS = ["blocked", "supervised", "guarded_auto", "unassisted_auto"] as const;
export type Tier = (typeof TIERS)[number];

export const AUTONOMY = {
  /** The fewest finished runs of a kind before it can be promoted. */
  minTasks: 30,
  /** Promotion needs the Wilson 95% lower bound of the success rate to be at least this. */
  promoteLowerBound: 0.9,
  /** A promoted kind falls back when the lower bound drops under this. */
  demoteLowerBound: 0.85,
  /** A run is judged only once its work is this old. */
  settleDays: 14,
  /** A revert this recent takes a promoted kind back to supervised at once. */
  quickRevertDays: 7,
} as const;

const DAY = 86_400_000;

export interface CommitFact {
  authoredAtMs: number;
  merged: boolean;
  reverted: boolean;
  revertedAtMs: number | null;
}

export interface TaskFact {
  taskId: string;
  workflow: string;
  commits: CommitFact[];
}

export type TaskOutcome = "success" | "failure" | "pending";

export interface Classified {
  outcome: TaskOutcome;
  /** The most recent revert of any of the run's commits, when it has one. */
  revertedAtMs: number | null;
}

/** Judge one run at `nowMs`. Reverted is a failure at any age; landed is a success once every landed commit is old enough; committed and unmerged is a failure once it has sat that long. */
export function classify(t: TaskFact, nowMs: number): Classified {
  const reverts = t.commits.filter((c) => c.reverted).map((c) => c.revertedAtMs).filter((x): x is number => x !== null);
  const revertedAtMs = reverts.length > 0 ? Math.max(...reverts) : null;
  if (t.commits.some((c) => c.reverted)) return { outcome: "failure", revertedAtMs };
  const settle = AUTONOMY.settleDays * DAY;
  const landed = t.commits.filter((c) => c.merged);
  if (landed.length > 0) return { outcome: landed.every((c) => nowMs - c.authoredAtMs >= settle) ? "success" : "pending", revertedAtMs: null };
  const newest = Math.max(...t.commits.map((c) => c.authoredAtMs));
  return { outcome: nowMs - newest >= settle ? "failure" : "pending", revertedAtMs: null };
}

export interface WorkflowEvidence {
  workflow: string;
  success: number;
  failure: number;
  pending: number;
  /** Tasks of this kind with sessions the ledger could not tie to a commit: unknown, not counted. */
  unlinked: number;
  /** Finished runs, and the share that succeeded with its 95% Wilson interval. */
  n: number;
  rate: number | null;
  lower: number | null;
  upper: number | null;
  /** The newest revert among the kind's runs, and whether it falls inside the quick-revert window. */
  lastRevertMs: number | null;
  recentRevert: boolean;
  revertedSha7: string | null;
}

export interface Decision {
  workflow: string;
  tier: Tier;
  /** The tier it should be at, and why. Equal to `tier` when nothing changes. */
  next: Tier;
  action: "none" | "demote" | "propose_promotion" | "hold";
  reason: string;
  evidence: WorkflowEvidence;
  digest: string;
}

/** Tasks of the ledger with their commits, from links of at least medium confidence: a low-confidence link is a guess and decides nothing about autonomy. */
export function taskFacts(db: Ledger, markers: readonly TaskMarker[] = []): { facts: TaskFact[]; unlinked: Map<string, number>; revertedSha: Map<string, string> } {
  const sessions = db
    .prepare("SELECT session_id AS id, project_path AS project, git_branch AS branch, started_at AS startedAt FROM session WHERE EXISTS (SELECT 1 FROM model_call m WHERE m.session_id = session.session_id)")
    .all() as unknown as { id: string; project: string | null; branch: string | null; startedAt: string | null }[];
  const commitsBySession = new Map<string, (CommitFact & { sha: string })[]>();
  for (const r of db
    .prepare(
      `SELECT sc.session_id AS sid, g.sha AS sha, g.authored_at AS at, g.merged AS merged, g.reverted AS reverted, g.reverted_at AS revertedAt
       FROM session_commit sc JOIN git_commit g ON g.repo_id = sc.repo_id AND g.sha = sc.sha WHERE sc.confidence IN ('high', 'medium')`,
    )
    .all() as unknown as { sid: string; sha: string; at: string; merged: number; reverted: number; revertedAt: string | null }[]) {
    const list = commitsBySession.get(r.sid) ?? [];
    list.push({ sha: r.sha, authoredAtMs: Date.parse(r.at), merged: r.merged === 1, reverted: r.reverted === 1, revertedAtMs: r.revertedAt ? Date.parse(r.revertedAt) : null });
    commitsBySession.set(r.sid, list);
  }
  const byTask = new Map<string, { workflow: string; commits: Map<string, CommitFact> }>();
  const unlinked = new Map<string, Set<string>>();
  const revertedSha = new Map<string, string>();
  for (const s of sessions) {
    // The unit is a run: one session of an agent, which is what the gate sees. A branch groups many runs over weeks and one reverted commit would fail the lot.
    const t = identify({ sessionId: s.id, projectPath: s.project, gitBranch: s.branch, startedAt: s.startedAt }, markers);
    const workflow = taskType(t.method, t.label);
    const cs = commitsBySession.get(s.id) ?? [];
    if (cs.length === 0) {
      const set = unlinked.get(workflow) ?? new Set<string>();
      set.add(s.id);
      unlinked.set(workflow, set);
      continue;
    }
    const entry = { workflow, commits: new Map<string, CommitFact>() };
    for (const c of cs) {
      entry.commits.set(c.sha, c);
      if (c.reverted) revertedSha.set(s.id, c.sha);
    }
    byTask.set(s.id, entry);
  }
  const facts: TaskFact[] = [...byTask.entries()].map(([taskId, v]) => ({ taskId, workflow: v.workflow, commits: [...v.commits.values()] }));
  const counts = new Map<string, number>();
  for (const [w, ids] of unlinked) counts.set(w, ids.size);
  return { facts, unlinked: counts, revertedSha };
}

export function evidenceFor(facts: readonly TaskFact[], unlinked: ReadonlyMap<string, number>, revertedSha: ReadonlyMap<string, string>, nowMs: number): WorkflowEvidence[] {
  const workflows = new Set<string>([...facts.map((f) => f.workflow), ...unlinked.keys()]);
  const out: WorkflowEvidence[] = [];
  for (const workflow of [...workflows].sort()) {
    let success = 0;
    let failure = 0;
    let pending = 0;
    let lastRevertMs: number | null = null;
    let sha: string | null = null;
    for (const t of facts.filter((f) => f.workflow === workflow)) {
      const c = classify(t, nowMs);
      if (c.outcome === "success") success += 1;
      else if (c.outcome === "failure") failure += 1;
      else pending += 1;
      if (c.revertedAtMs !== null && (lastRevertMs === null || c.revertedAtMs > lastRevertMs)) {
        lastRevertMs = c.revertedAtMs;
        sha = revertedSha.get(t.taskId) ?? null;
      }
    }
    const n = success + failure;
    const w = n > 0 ? wilson(success, n) : null;
    out.push({
      workflow, success, failure, pending, unlinked: unlinked.get(workflow) ?? 0, n, rate: n > 0 ? success / n : null, lower: w?.low ?? null, upper: w?.high ?? null, lastRevertMs,
      recentRevert: lastRevertMs !== null && nowMs - lastRevertMs <= AUTONOMY.quickRevertDays * DAY && nowMs >= lastRevertMs, revertedSha7: sha === null ? null : sha.slice(0, 7),
    });
  }
  return out;
}

export function digestOf(e: WorkflowEvidence, nowMs: number): string {
  return createHash("sha256")
    .update(JSON.stringify({ w: e.workflow, s: e.success, f: e.failure, p: e.pending, u: e.unlinked, l: e.lower === null ? null : Math.round(e.lower * 1e6), r: e.lastRevertMs, day: new Date(nowMs).toISOString().slice(0, 10) }))
    .digest("hex");
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/**
 * What each kind of work's tier should be. The rules, in order: a blocked kind stays blocked (only its owner lifts that); a promoted kind goes back to supervised the moment a
 * commit of it was reverted in the last 7 days or its lower bound is under 0.85; a supervised kind with enough finished runs, a lower bound of at least 0.90 and no revert in the
 * last 14 days is proposed for promotion to `guarded_auto`, which waits for the owner. Everything else holds, with the reason it holds.
 */
export function decide(evidence: readonly WorkflowEvidence[], current: ReadonlyMap<string, Tier>, nowMs: number): Decision[] {
  return evidence.map((e) => {
    const tier = current.get(e.workflow) ?? "supervised";
    const digest = digestOf(e, nowMs);
    const base = { workflow: e.workflow, tier, evidence: e, digest };
    if (tier === "blocked") return { ...base, next: tier, action: "none" as const, reason: "blocked by its owner; only the owner lifts that" };
    if (tier === "guarded_auto" || tier === "unassisted_auto") {
      if (e.recentRevert) return { ...base, next: "supervised" as Tier, action: "demote" as const, reason: `a commit of this work was reverted on ${new Date(e.lastRevertMs as number).toISOString().slice(0, 10)}${e.revertedSha7 ? ` (${e.revertedSha7})` : ""}, inside the last ${AUTONOMY.quickRevertDays} days` };
      if (e.lower !== null && e.n >= AUTONOMY.minTasks && e.lower < AUTONOMY.demoteLowerBound) return { ...base, next: "supervised" as Tier, action: "demote" as const, reason: `the lower bound of its success rate is ${pct(e.lower)} over ${e.n} finished runs, under ${pct(AUTONOMY.demoteLowerBound)}` };
      return { ...base, next: tier, action: "none" as const, reason: e.lower === null ? "no finished run yet to count against it" : `lower bound ${pct(e.lower)} over ${e.n} finished runs; it keeps its tier` };
    }
    if (e.n < AUTONOMY.minTasks) return { ...base, next: tier, action: "hold" as const, reason: `${e.n} finished run${e.n === 1 ? "" : "s"}; it needs ${AUTONOMY.minTasks} before it can be promoted` };
    if (e.lastRevertMs !== null && nowMs - e.lastRevertMs <= AUTONOMY.settleDays * DAY) return { ...base, next: tier, action: "hold" as const, reason: `a commit of this work was reverted on ${new Date(e.lastRevertMs).toISOString().slice(0, 10)}, inside the last ${AUTONOMY.settleDays} days` };
    if (e.lower === null || e.lower < AUTONOMY.promoteLowerBound) return { ...base, next: tier, action: "hold" as const, reason: `the lower bound of its success rate is ${e.lower === null ? "unknown" : pct(e.lower)} over ${e.n} finished runs; promotion needs ${pct(AUTONOMY.promoteLowerBound)}` };
    return { ...base, next: "guarded_auto" as Tier, action: "propose_promotion" as const, reason: `${e.success} of ${e.n} finished runs landed and stayed, lower bound ${pct(e.lower)}, no revert in ${AUTONOMY.settleDays} days` };
  });
}
