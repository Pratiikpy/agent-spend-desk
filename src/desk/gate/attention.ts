import type { DatabaseSync } from "node:sqlite";

/**
 * The supervision attention-load governor (DF-088). An owner can only watch so many agents and answer so many questions an hour before they stop reading what they approve.
 * The governor reads the gate's own record of what each person's agents have been doing and what they have been asked, and when starting one more agent would put the
 * person past what they can supervise, the gate refuses the new agent with a reason that says so. It never touches an agent that is already running.
 *
 *   active agents   the person's other sessions with a gate event in the last ten minutes (an agent that has been quiet for ten minutes has stopped, whatever its process does)
 *   interruptions   approval requests the gate has made of the person in the last hour
 *   load            the larger of active / the most agents allowed and interruptions / the most questions an hour allowed, counting the one that would start
 *
 * At 80% the load is a warning on the decision; a new agent is refused when the person already has the most agents allowed, or has already been asked the most questions an
 * hour allows (one more agent is one more person-hour of review). An emergency bypass the owner has opened with their key allows it. Defaults are the specification's: four
 * agents, ten questions an hour, $120 an hour of the owner's time.
 */
export interface AttentionLimits {
  maxConcurrent: number;
  maxInterruptionsPerHour: number;
  /** How long after its last gate event a session still counts as an active agent. */
  activeWindowMs: number;
  /** The share of the budget at which the load is a warning. */
  warnAt: number;
  /** What an hour of the owner's attention is worth, in micro-dollars per second; $120 an hour is 33,333. */
  microsPerSecond: number;
}

export const DEFAULT_ATTENTION: AttentionLimits = { maxConcurrent: 4, maxInterruptionsPerHour: 10, activeWindowMs: 10 * 60_000, warnAt: 0.8, microsPerSecond: 33_333 };

export type AttentionLevel = "ok" | "warn" | "full";

export interface Attention {
  /** Whose load it is; "everyone" when it was asked for the whole machine, as a person who is not named in the gate's records. */
  person: string;
  /** Other sessions of the person with a gate event in the active window, newest first. */
  activeSessions: string[];
  interruptions: number;
  /** The load if one more agent started now, 0 to 1 and over. */
  load: number;
  /** The load as it stands now, without the agent that would start: the larger of agents working / most allowed and questions asked / most allowed. */
  current: number;
  level: AttentionLevel;
  limits: AttentionLimits;
}

export const ATTENTION_REASON = "attention_budget_exceeded";

/** Gate events that show an agent is working or is being asked something. A refusal of a new agent for this very reason is not one: it started nothing. */
const ACTIVE = "kind IN ('authorized', 'observed', 'asked', 'approved', 'denied', 'settled') AND NOT (kind = 'denied' AND reason_code = 'attention_budget_exceeded')";

export function attentionOf(db: DatabaseSync, person: string | null, nowMs: number, exceptSession: string | null, limits: AttentionLimits = DEFAULT_ATTENTION): Attention {
  const activeSince = new Date(nowMs - limits.activeWindowMs).toISOString();
  const hourAgo = new Date(nowMs - 3_600_000).toISOString();
  const rows = db
    .prepare(`SELECT session_id, MAX(ts) AS last FROM gate_event WHERE (? IS NULL OR person = ?) AND ts >= ? AND session_id IS NOT NULL AND ${ACTIVE} GROUP BY session_id ORDER BY last DESC`)
    .all(person, person, activeSince) as unknown as { session_id: string; last: string }[];
  const active = rows.map((r) => r.session_id).filter((id) => id !== exceptSession);
  const interruptions = (db.prepare("SELECT COUNT(*) AS n FROM gate_event WHERE (? IS NULL OR person = ?) AND ts >= ? AND kind = 'asked'").get(person, person, hourAgo) as { n: number }).n;
  // Counting the agent that would start: one more of the active ones, and the questions already asked.
  const load = Math.max((active.length + 1) / limits.maxConcurrent, interruptions / limits.maxInterruptionsPerHour);
  const level: AttentionLevel = active.length >= limits.maxConcurrent || interruptions >= limits.maxInterruptionsPerHour ? "full" : load >= limits.warnAt ? "warn" : "ok";
  const current = Math.max(active.length / limits.maxConcurrent, interruptions / limits.maxInterruptionsPerHour);
  return { person: person ?? "everyone", activeSessions: active, interruptions, load, current, level, limits };
}

/** True when the session has not been seen by the gate for longer than the active window: a launch, as far as the governor is concerned. */
export function isLaunch(db: DatabaseSync, sessionId: string, nowMs: number, limits: AttentionLimits = DEFAULT_ATTENTION): boolean {
  const since = new Date(nowMs - limits.activeWindowMs).toISOString();
  const row = db.prepare(`SELECT 1 AS seen FROM gate_event WHERE session_id = ? AND ts >= ? AND ${ACTIVE} LIMIT 1`).get(sessionId, since);
  return row === undefined;
}

/** The reason to refuse a new agent, or null. */
export function launchDenial(a: Attention): string | null {
  if (a.activeSessions.length >= a.limits.maxConcurrent) {
    return `${a.person} already has ${a.activeSessions.length} agents working (the most allowed is ${a.limits.maxConcurrent}); a ${a.activeSessions.length + 1}th is more than one person can supervise. Wait for one to finish, or have the owner open the emergency bypass.`;
  }
  if (a.interruptions >= a.limits.maxInterruptionsPerHour) {
    return `${a.person} has been asked ${a.interruptions} questions in the last hour (the most allowed is ${a.limits.maxInterruptionsPerHour}); another agent would only add to them. Answer the open questions first, or have the owner open the emergency bypass.`;
  }
  return null;
}

/** What the owner's time on the questions the gate asked costs: the seconds from each request to its answer, priced at the owner's rate. */
export interface ReviewOverhead {
  /** The rate the time was priced at, in dollars an hour: $120 unless the owner said otherwise. */
  usdPerHour: number;
  approvals: number;
  /** Questions with no answer yet, which cost nothing until they are answered. */
  unanswered: number;
  seconds: number;
  micros: number;
  /** The longest waits, for the sessions they held up. */
  slowest: { session: string | null; seconds: number }[];
}

/**
 * The review time spent in a period, from the gate's record: each `asked` event is matched to the `approved` event that answered it (they carry the same request),
 * and the gap is the review. A denial is an answer as well. The rate is the owner's, so a number priced here is theirs and says so; it is never added to model spend.
 */
export function reviewOverhead(db: DatabaseSync, sinceIso: string, untilIso: string, limits: AttentionLimits = DEFAULT_ATTENTION): ReviewOverhead {
  const asked = db.prepare("SELECT id, ts, session_id, approval_id FROM gate_event WHERE kind = 'asked' AND ts >= ? AND ts <= ? ORDER BY id").all(sinceIso, untilIso) as unknown as { id: number; ts: string; session_id: string | null; approval_id: number | null }[];
  const answers = db.prepare("SELECT ts, approval_id, kind FROM gate_event WHERE kind IN ('approved') AND approval_id IS NOT NULL AND ts >= ?").all(sinceIso) as unknown as { ts: string; approval_id: number }[];
  const answeredAt = new Map(answers.map((a) => [a.approval_id, Date.parse(a.ts)]));
  const waits: { session: string | null; seconds: number }[] = [];
  let unanswered = 0;
  for (const q of asked) {
    // An approval names the request it answers by that request's own event id.
    const end = answeredAt.get(q.id);
    if (end === undefined) unanswered += 1;
    else waits.push({ session: q.session_id, seconds: Math.max(0, (end - Date.parse(q.ts)) / 1000) });
  }
  const seconds = waits.reduce((s, w) => s + w.seconds, 0);
  return { usdPerHour: Math.round(((limits.microsPerSecond * 3600) / 1_000_000) * 100) / 100, approvals: waits.length, unanswered, seconds, micros: Math.round(seconds * limits.microsPerSecond), slowest: [...waits].sort((a, b) => b.seconds - a.seconds).slice(0, 3) };
}
