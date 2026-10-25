import type { Ledger } from "../ledger/db.ts";
import { outcomeOf, type Link, type LandingState } from "../outcomes/attribute.ts";
import type { GitCommit } from "../outcomes/git.ts";
import { questionId, type Question } from "../outcomes/questions.ts";

/**
 * The value-of-information governor for questions to the owner (DF-107). Asking an owner is not free: each interruption costs the time to read it and the time to get
 * back to what they were doing, and an owner who is interrupted for a question that cannot change anything learns to answer without reading. So before the Desk asks, it
 * works out what the answer is worth, and asks now only if that is more than the interruption costs. Otherwise the question waits for the weekly review, with the
 * conservative answer in force until then.
 *
 * What an answer is worth. A question says "is this commit from this session?" with the Desk unsure. If the answer is no, the link is gone and the session's spend is
 * `unlinked`. If it is yes, the link is explicit and the session takes the commit's state. The answer changes a headline figure (the dollars that landed, the dollars that
 * were reverted) only when the commit is landed or reverted; for a commit that is only committed, no headline moves and the answer can wait. The value is the chance the
 * answer is yes times the dollars it would move: `p x spend`, with `p` taken from the owner's own earlier answers to the same kind of question once there are ten, and
 * one half before that, which is the least the Desk can claim to know.
 *
 * What an interruption costs. The owner's time at their rate ($120 an hour, 33,333 micro-dollars a second) for the time to read the question (20 s) and the time to get
 * back to work (180 s), scaled up by how loaded the owner already is: one plus the attention load of the gate (DF-088), so that the same question is worth interrupting for
 * less often when four agents are running.
 *
 * It fails safe: when the attention load cannot be read the question is queued, never asked, because an interruption that was not priced is the one to avoid.
 */
export const VOI = { reviewSeconds: 20, switchSeconds: 180, microsPerSecond: 33_333, defaultYes: 0.5, minAnswers: 10 } as const;

export type Interruption = "ask_now" | "queue";

export interface Decision {
  action: Interruption;
  /** What the answer is worth in micro-dollars of a headline figure, and what interrupting costs; null when either could not be worked out. */
  evoiMicros: number | null;
  costMicros: number | null;
  /** The attention load the cost was scaled by, or null when it could not be read. */
  load: number | null;
  reason: string;
  /** What stands until the question is answered. */
  meanwhile: string;
}

/** The cost of interrupting the owner now, scaled by how loaded they already are; null when the load is not known. */
export function interruptionCost(load: number | null): number | null {
  if (load === null) return null;
  return Math.round((VOI.reviewSeconds + VOI.switchSeconds) * VOI.microsPerSecond * (1 + Math.max(0, load)));
}

const usd = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;

/** Ask now only when the answer is worth more than the interruption; queue in every other case, including when either figure is unknown. */
export function decide(evoiMicros: number | null, load: number | null, meanwhile: string): Decision {
  const cost = interruptionCost(load);
  if (load === null || cost === null) return { action: "queue", evoiMicros, costMicros: null, load, reason: "the attention load could not be read, so the interruption was not priced; queued for the weekly review", meanwhile };
  if (evoiMicros === null) return { action: "queue", evoiMicros, costMicros: cost, load, reason: "what the answer is worth could not be worked out; queued for the weekly review", meanwhile };
  return evoiMicros > cost
    ? { action: "ask_now", evoiMicros, costMicros: cost, load, reason: `the answer is worth ${usd(evoiMicros)} and interrupting costs ${usd(cost)}`, meanwhile }
    : { action: "queue", evoiMicros, costMicros: cost, load, reason: `the answer is worth ${usd(evoiMicros)}, under the ${usd(cost)} an interruption costs; queued for the weekly review`, meanwhile };
}

/** The chance a question of this kind is answered yes: the share of the owner's own answers once there are enough, one half before. */
export function priorYes(db: Ledger): { p: number; basis: string } {
  const r = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(answer = 'yes'), 0) AS yes FROM owner_answer").get() as { n: number; yes: number };
  if (r.n < VOI.minAnswers) return { p: VOI.defaultYes, basis: `one half: ${r.n} earlier answer${r.n === 1 ? "" : "s"}, and the Desk reads none from fewer than ${VOI.minAnswers}` };
  // Laplace's rule, so that ten yeses in ten is not taken for certainty.
  return { p: (r.yes + 1) / (r.n + 2), basis: `${r.yes} yes in ${r.n} of your earlier answers` };
}

const isLanded = (s: LandingState): boolean => s === "merged" || s === "kept";

/** The state a session would have if the commit were really its own: its other links, and this one as an explicit, high-confidence one. */
function stateIf(db: Ledger, q: Question, nowMs: number): LandingState {
  const rows = db
    .prepare("SELECT sc.sha AS sha, sc.method AS method, sc.confidence AS confidence, g.authored_at AS authoredAt, g.merged AS merged, g.reverted AS reverted FROM session_commit sc JOIN git_commit g ON g.repo_id = sc.repo_id AND g.sha = sc.sha WHERE sc.session_id = ? AND sc.sha != ?")
    .all(q.sessionId, q.sha) as unknown as { sha: string; method: Link["method"]; confidence: Link["confidence"]; authoredAt: string; merged: number; reverted: number }[];
  const own = db.prepare("SELECT g.authored_at AS authoredAt, g.merged AS merged, g.reverted AS reverted FROM git_commit g JOIN repo r ON r.repo_id = g.repo_id WHERE r.root = ? AND g.sha = ?").get(q.repoRoot, q.sha) as { authoredAt: string; merged: number; reverted: number } | undefined;
  if (!own) return "unlinked";
  const commits = new Map<string, GitCommit>();
  const links: Link[] = [];
  const add = (sha: string, authoredAt: string, merged: number, reverted: number): void => {
    commits.set(sha, { sha, authoredAt, authorEmail: "", agentTrailer: false, files: [], merged: merged === 1, reverted: reverted === 1 });
  };
  for (const r of rows) {
    add(r.sha, r.authoredAt, r.merged, r.reverted);
    links.push({ sessionId: q.sessionId, sha: r.sha, method: r.method, confidence: r.confidence });
  }
  add(q.sha, own.authoredAt, own.merged, own.reverted);
  links.push({ sessionId: q.sessionId, sha: q.sha, method: "explicit", confidence: "high" });
  return outcomeOf(links, commits, nowMs).state;
}

/** The dollars a yes would move in a headline figure (landed, reverted) from where a no leaves them (unlinked); 0 for a commit that is only committed. */
export function stakesOf(db: Ledger, q: Question, nowMs: number): { micros: number; ifYes: LandingState } {
  const ifYes = stateIf(db, q, nowMs);
  return { micros: isLanded(ifYes) || ifYes === "reverted" ? q.spendMicros : 0, ifYes };
}

export interface GovernedQuestion {
  question: Question;
  ifYes: LandingState;
  decision: Decision;
}

/** Each question with what its answer is worth and whether to interrupt for it. The unanswered ones stay unlinked in the headline until answered: the conservative answer. */
export function governQuestions(db: Ledger, questions: readonly Question[], load: number | null, nowMs: number): { ask: GovernedQuestion[]; queued: GovernedQuestion[]; prior: { p: number; basis: string } } {
  const prior = priorYes(db);
  const ask: GovernedQuestion[] = [];
  const queued: GovernedQuestion[] = [];
  for (const q of questions) {
    const s = stakesOf(db, q, nowMs);
    const decision = decide(Math.round(prior.p * s.micros), load, "its spend stays unlinked, which is not counted as landed or as waste, until it is answered");
    (decision.action === "ask_now" ? ask : queued).push({ question: q, ifYes: s.ifYes, decision });
  }
  return { ask, queued, prior };
}

/** Record what the governor decided about each question, so that a held-back question is on the record with the figures it was held on (and not just absent from a prompt). */
export function recordDecisions(db: Ledger, governed: { ask: readonly GovernedQuestion[]; queued: readonly GovernedQuestion[]; prior: { p: number } }, decidedAt: Date): void {
  const insert = db.prepare("INSERT OR REPLACE INTO question_decision (question_id, decided_at, action, evoi_micros, cost_micros, load, p_yes, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  db.exec("SAVEPOINT question_decisions");
  try {
    for (const g of [...governed.ask, ...governed.queued]) {
      const d = g.decision;
      insert.run(g.question.id, decidedAt.toISOString(), d.action, d.evoiMicros, d.costMicros, d.load, governed.prior.p, d.reason);
    }
    db.exec("RELEASE question_decisions");
  } catch (e) {
    db.exec("ROLLBACK TO question_decisions; RELEASE question_decisions");
    throw e;
  }
}

/** The questions held back from interrupting the owner in a period and still open: a question answered since, or asked later, is no longer held back. */
export function heldBack(db: Ledger, sinceIso: string, untilIso: string): { questions: number; topEvoiMicros: number } {
  const rows = db
    .prepare(
      `SELECT d.question_id AS id, MAX(d.evoi_micros) AS evoi FROM question_decision d
       WHERE d.action = 'queue' AND d.decided_at >= ? AND d.decided_at < ?
         AND NOT EXISTS (SELECT 1 FROM question_decision a WHERE a.question_id = d.question_id AND a.action = 'ask_now')
       GROUP BY d.question_id`,
    )
    .all(sinceIso, untilIso) as unknown as { id: string; evoi: number | null }[];
  const answered = new Set((db.prepare("SELECT session_id AS s, repo_root AS r, sha FROM owner_answer").all() as unknown as { s: string; r: string; sha: string }[]).map((a) => questionId(a.s, a.r, a.sha)));
  const open = rows.filter((r) => !answered.has(r.id));
  return { questions: open.length, topEvoiMicros: Math.max(0, ...open.map((r) => r.evoi ?? 0)) };
}

/**
 * What waiting for the weekly review costs for a policy change that would save money: the dollars it would have saved each day, for the days the decision waits (half a
 * week on average). The landed work it would block is not in it, because a wait does not block anything. A change that saves little is not worth an interruption, and the
 * policy the gate was running meanwhile is the conservative one: a new policy runs in shadow mode first.
 */
export function policyWaitCost(savedMicrosOverPeriod: number, periodDays: number, daysToReview = 3.5): number {
  if (periodDays <= 0) return 0;
  return Math.round((savedMicrosOverPeriod / periodDays) * daysToReview);
}
