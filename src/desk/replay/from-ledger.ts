import { analyseThread, type AutopsyCall, type Cause } from "../autopsy/engine.ts";
import { loadAutopsyCalls } from "../autopsy/load.ts";
import type { Ledger } from "../ledger/db.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import type { ReplayCall, ReplaySession } from "./policy-replay.ts";

/** Waste-rule ids the policy language can name. They map one-to-one to autopsy causes. */
export const WASTE_RULE: Partial<Record<Cause, string>> = {
  loops: "C-LOOP-1",
  idle: "C-IDLE-1",
  subagents: "C-FANOUT-1",
};

export function callCostMicros(c: AutopsyCall): number {
  if (!c.micros) return 0;
  return c.micros.input + c.micros.output + c.micros.read + c.micros.write5m + c.micros.write1h;
}

export interface BridgeOptions {
  /**
   * Read the person from the git branch prefix (`eng07/topic` is eng07). Teams that name branches after the
   * author get per-person caps; everyone else is "me". It is an inference from a naming convention, so it is
   * off unless asked for, and the sample scenario turns it on.
   */
  personFromBranch?: boolean;
}

/** The author prefix of a branch name, or null when the branch has no `name/topic` shape. */
export function personOfBranch(branch: string | null): string | null {
  const m = /^([a-z][a-z0-9_-]{1,30})\/[^/]+/i.exec(branch ?? "");
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Turn recorded calls into replay sessions. Each call carries the waste rule the autopsy attached to
 * it, and `recoverableMicros` is what stopping at that call would save from the same run of waste: the
 * cost of this call and every following call of the same run in the same thread. Unpriced calls cost
 * zero here and are never invented a price. A session counts as landed when its work was merged or kept.
 */
export function replaySessionsFromLedger(db: Ledger, snapshot: PriceSnapshot, sinceIso: string, untilIso: string, options: BridgeOptions = {}): ReplaySession[] {
  const calls = loadAutopsyCalls(db, snapshot, sinceIso, untilIso);
  const byThread = new Map<string, AutopsyCall[]>();
  for (const c of calls) {
    const list = byThread.get(c.threadKey) ?? [];
    list.push(c);
    byThread.set(c.threadKey, list);
  }

  const rule = new Map<string, string>();
  const recoverable = new Map<string, number>();
  for (const thread of byThread.values()) {
    const sorted = [...thread].sort((a, b) => a.tsMs - b.tsMs || a.callId.localeCompare(b.callId));
    const analysis = analyseThread(sorted);
    let runTotal = 0;
    let runRule: string | undefined;
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const c = sorted[i]!;
      const whole = analysis.get(c.callId)?.wholeCall;
      const id = whole ? WASTE_RULE[whole] : undefined;
      if (id !== undefined) {
        runTotal = runRule === id ? runTotal + callCostMicros(c) : callCostMicros(c);
        runRule = id;
        rule.set(c.callId, id);
        recoverable.set(c.callId, runTotal);
      } else {
        runTotal = 0;
        runRule = undefined;
      }
    }
  }

  const info = new Map<string, { project: string; landed: boolean; person: string }>();
  const rows = db
    .prepare(`SELECT s.session_id, s.project_path, s.git_branch, o.state FROM session s LEFT JOIN session_outcome o ON o.session_id = s.session_id`)
    .all() as unknown as { session_id: string; project_path: string | null; git_branch: string | null; state: string | null }[];
  for (const r of rows) info.set(r.session_id, { project: r.project_path ?? "unknown", landed: r.state === "merged" || r.state === "kept", person: (options.personFromBranch ? personOfBranch(r.git_branch) : null) ?? "me" });

  const bySession = new Map<string, AutopsyCall[]>();
  for (const c of calls) {
    const list = bySession.get(c.sessionId) ?? [];
    list.push(c);
    bySession.set(c.sessionId, list);
  }
  const sessions: ReplaySession[] = [];
  for (const [sessionId, list] of bySession) {
    const sorted = [...list].sort((a, b) => a.tsMs - b.tsMs);
    const start = sorted[0]!.tsMs;
    const meta = info.get(sessionId) ?? { project: "unknown", landed: false, person: "me" };
    const replayCalls: ReplayCall[] = sorted.map((c) => ({
      offsetMs: c.tsMs - start,
      costMicros: callCostMicros(c),
      model: c.model,
      wasteRule: rule.get(c.callId) ?? "none",
      recoverableMicros: recoverable.get(c.callId) ?? 0,
    }));
    sessions.push({ id: sessionId, person: meta.person, project: meta.project, agent: sorted.some((c) => c.isSidechain) ? "mixed" : "main", taskType: "code", startMs: start, landed: meta.landed, calls: replayCalls });
  }
  return sessions.sort((a, b) => a.startMs - b.startMs);
}
