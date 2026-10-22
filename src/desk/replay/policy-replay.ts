import { evaluate } from "../policy/evaluate.ts";
import type { Policy, Request } from "../policy/types.ts";

/** One recorded call reduced to what the policy can talk about. Times are offsets from the session start. */
export interface ReplayCall {
  offsetMs: number;
  costMicros: number;
  model: string;
  /** Waste rule the autopsy engine attached to this call (for example C-LOOP-1), or "none". */
  wasteRule: string;
  /** What stopping at this call would have saved from the same waste. */
  recoverableMicros: number;
}

export interface ReplaySession {
  id: string;
  person: string;
  project: string;
  agent: string;
  taskType: string;
  startMs: number;
  /** True when the session's work reached a merge or better (the landed tasks the policy must not block). */
  landed: boolean;
  calls: readonly ReplayCall[];
}

export interface ReplayOptions {
  /** How an `ask` verdict is counted. Asks are always reported; by default the owner is assumed to approve. */
  askAs: "approved" | "denied";
}

export interface PausedSession {
  sessionId: string;
  at: number;
  verdictReason: string;
  landed: boolean;
}

export interface ReplayResult {
  totalMicros: number;
  /** Cost of the calls that would not have been made. An upper bound on savings: it assumes a paused session does nothing more, including useful work. */
  savedMicros: number;
  askedCalls: number;
  deniedCalls: number;
  paused: PausedSession[];
  landedTotal: number;
  /** Landed sessions that the policy would have paused. */
  landedBlocked: string[];
}

const DAY = 86_400_000;

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

/**
 * Run recorded sessions through a policy, in time order, as if it had been in force. A denied call
 * pauses its session: that call and every later call of the session are not made and their cost counts
 * as saved. Spend that feeds caps counts only calls that were made. The result is a counterfactual
 * on the recorded month; it assumes the work would simply have stopped, which is why the wind tunnel
 * and a held-out month are shown beside it.
 */
export function replayPolicy(policy: Policy, sessions: readonly ReplaySession[], options: ReplayOptions = { askAs: "approved" }): ReplayResult {
  type Event = { t: number; s: number; c: number };
  const events: Event[] = [];
  sessions.forEach((s, si) => s.calls.forEach((c, ci) => events.push({ t: s.startMs + c.offsetMs, s: si, c: ci })));
  events.sort((a, b) => a.t - b.t || a.s - b.s || a.c - b.c);

  const day = new Map<string, number>();
  const month = new Map<string, number>();
  const pausedAt = new Map<number, PausedSession>();
  let total = 0;
  let saved = 0;
  let asked = 0;
  let denied = 0;

  for (const ev of events) {
    const session = sessions[ev.s]!;
    const call = session.calls[ev.c]!;
    total += call.costMicros;
    if (pausedAt.has(ev.s)) {
      saved += call.costMicros;
      continue;
    }
    const dk = `${session.person}|${dayKey(ev.t)}`;
    const mk = `${session.person}|${monthKey(ev.t)}`;
    const req: Request = {
      project: session.project,
      person: session.person,
      agent: session.agent,
      model: call.model,
      task_type: session.taskType,
      waste_rule: call.wasteRule,
      action: "call",
      recoverable_micros: call.recoverableMicros,
      day_spend_after_micros: (day.get(dk) ?? 0) + call.costMicros,
      month_spend_after_micros: (month.get(mk) ?? 0) + call.costMicros,
    };
    const d = evaluate(policy, req);
    let stop = d.verdict === "deny";
    if (d.verdict === "ask") {
      asked += 1;
      if (options.askAs === "denied") stop = true;
    }
    if (stop) {
      denied += 1;
      saved += call.costMicros;
      pausedAt.set(ev.s, { sessionId: session.id, at: ev.t, verdictReason: d.reasons.join("; ") || d.verdict, landed: session.landed });
      continue;
    }
    day.set(dk, (day.get(dk) ?? 0) + call.costMicros);
    month.set(mk, (month.get(mk) ?? 0) + call.costMicros);
  }

  const paused = [...pausedAt.values()];
  const landedTotal = sessions.filter((s) => s.landed).length;
  return {
    totalMicros: total,
    savedMicros: saved,
    askedCalls: asked,
    deniedCalls: denied,
    paused,
    landedTotal,
    landedBlocked: paused.filter((p) => p.landed).map((p) => p.sessionId),
  };
}

export { DAY };
