import { analyseCalls } from "../autopsy/engine.ts";
import { loadAutopsyCalls } from "../autopsy/load.ts";
import type { Ledger } from "../ledger/db.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { callCostMicros } from "../replay/from-ledger.ts";
import { allocateOverhead, type Allocation } from "./allocate.ts";

/** How far a session's work must have got for its project to share the overhead. The spec asks for work kept for days; a lower bar is the owner's to choose. */
export type LandedBar = "committed" | "merged" | "kept";
const ORDER: Record<string, number> = { unlinked: 0, committed: 1, merged: 2, kept: 3, reverted: -1 };

export interface OverheadView {
  sinceIso: string;
  untilIso: string;
  bar: LandedBar;
  /** Idle work (calls with no prompt behind them) and calls in sessions with no project folder: what no project's tasks own. */
  idleMicros: number;
  sharedMicros: number;
  overheadMicros: number;
  /** Sessions that reached the bar, and how many sessions the period holds in all. */
  landedSessions: number;
  sessions: number;
  allocation: Allocation;
  /** What each lower bar would have shared the overhead among, so that the choice is seen rather than guessed. */
  alternatives: { bar: LandedBar; projects: number; landedMicros: number }[];
  unpricedCalls: number;
}

const folderName = (p: string | null): string => (p === null ? "unknown" : (p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p));

/**
 * The overhead of a period and who shares it. Overhead is the cost of idle calls and of calls in sessions with no project folder; a project's
 * landed spend is what the rest of its sessions cost, for the sessions whose work reached the bar. Every call is counted once: an idle call is overhead
 * even in a project that landed.
 */
export function overheadView(db: Ledger, snapshot: PriceSnapshot, sinceIso: string, untilIso: string, bar: LandedBar = "kept"): OverheadView {
  const calls = loadAutopsyCalls(db, snapshot, sinceIso, untilIso);
  const analysis = analyseCalls(calls);
  const folderOf = new Map((db.prepare("SELECT session_id, project_path FROM session").all() as unknown as { session_id: string; project_path: string | null }[]).map((r) => [r.session_id, r.project_path]));
  const stateOf = new Map((db.prepare("SELECT session_id, state FROM session_outcome").all() as unknown as { session_id: string; state: string }[]).map((r) => [r.session_id, r.state]));
  let idle = 0;
  let shared = 0;
  let unpriced = 0;
  const sessions = new Set<string>();
  const direct = new Map<string, Map<string, number>>(); // session -> project -> micros
  for (const c of calls) {
    sessions.add(c.sessionId);
    if (c.micros === null) unpriced += 1;
    const cost = callCostMicros(c);
    const folder = folderOf.get(c.sessionId) ?? null;
    if (analysis.get(c.callId)?.wholeCall === "idle") idle += cost;
    else if (folder === null) shared += cost;
    else {
      const m = direct.get(c.sessionId) ?? new Map<string, number>();
      const p = folderName(folder);
      m.set(p, (m.get(p) ?? 0) + cost);
      direct.set(c.sessionId, m);
    }
  }
  const landedBy = (b: LandedBar): Map<string, number> => {
    const out = new Map<string, number>();
    for (const [session, projects] of direct) {
      if ((ORDER[stateOf.get(session) ?? "unlinked"] ?? 0) < (ORDER[b] as number)) continue;
      for (const [p, micros] of projects) out.set(p, (out.get(p) ?? 0) + micros);
    }
    return out;
  };
  const landed = landedBy(bar);
  const landedSessions = [...direct.keys()].filter((s) => (ORDER[stateOf.get(s) ?? "unlinked"] ?? 0) >= (ORDER[bar] as number)).length;
  const overhead = idle + shared;
  return {
    sinceIso,
    untilIso,
    bar,
    idleMicros: idle,
    sharedMicros: shared,
    overheadMicros: overhead,
    landedSessions,
    sessions: sessions.size,
    allocation: allocateOverhead(overhead, [...landed].map(([project, micros]) => ({ project, micros }))),
    alternatives: (["committed", "merged", "kept"] as const).map((b) => {
      const l = landedBy(b);
      return { bar: b, projects: [...l.values()].filter((v) => v > 0).length, landedMicros: [...l.values()].reduce((s, v) => s + v, 0) };
    }),
    unpricedCalls: unpriced,
  };
}

const usd = (m: number): string => `$${(m / 1_000_000).toFixed(2)}`;

/** `desk overhead` in words. */
export function renderOverhead(v: OverheadView): string {
  const out = [`Shared overhead, ${v.sinceIso.slice(0, 10)} to ${v.untilIso.slice(0, 10)}: ${usd(v.overheadMicros)} (idle work ${usd(v.idleMicros)}, sessions with no project folder ${usd(v.sharedMicros)}), over ${v.sessions} session${v.sessions === 1 ? "" : "s"}.`];
  if (v.allocation.rows.length === 0) {
    out.push(`Nothing is allocated: no project has work that reached "${v.bar}" in this period, so ${usd(v.allocation.unallocatedMicros)} stays unallocated rather than being divided by guess.`);
    const alt = v.alternatives.filter((a) => a.projects > 0 && a.bar !== v.bar);
    if (alt.length > 0) out.push(`At a lower bar it would be shared: ${alt.map((a) => `"${a.bar}" among ${a.projects} project${a.projects === 1 ? "" : "s"} (${usd(a.landedMicros)} landed)`).join("; ")}. desk overhead --landed ${alt[0]!.bar} shows it.`);
    else out.push("No project has work at any of the bars (committed, merged, kept): the commit links the ledger holds are few, and a missing link is unknown, not proof that nothing landed.");
    return out.join("\n");
  }
  out.push(`Shared among the ${v.allocation.rows.length} project${v.allocation.rows.length === 1 ? "" : "s"} with work that reached "${v.bar}", in proportion to the dollars each landed:`);
  out.push(`${"project".padEnd(24)}${"landed".padStart(11)}${"share".padStart(9)}${"overhead".padStart(11)}${"with overhead".padStart(15)}`);
  for (const r of v.allocation.rows) out.push(`${r.project.slice(0, 22).padEnd(24)}${usd(r.directMicros).padStart(11)}${`${(r.weight * 100).toFixed(1)}%`.padStart(9)}${usd(r.allocatedMicros).padStart(11)}${usd(r.directMicros + r.allocatedMicros).padStart(15)}`);
  const total = v.allocation.rows.reduce((s, r) => s + r.allocatedMicros, 0);
  out.push(`Allocated ${usd(total)} of ${usd(v.overheadMicros)}: exactly the overhead, to the micro-dollar${v.allocation.residualMicros > 0 ? `; the ${v.allocation.residualMicros} micro-dollar${v.allocation.residualMicros === 1 ? "" : "s"} left over by rounding went to ${v.allocation.residualTo}, the project with the most landed spend` : ""}.`);
  out.push(`A project that landed nothing bears none of it. ${v.landedSessions} of ${v.sessions} sessions reached "${v.bar}"; a commit missing from the ledger is unknown, not proof that nothing landed.`);
  const wider = v.alternatives.filter((a) => a.projects > v.allocation.rows.length);
  if (wider.length > 0) out.push(`At a lower bar more projects would share it: ${wider.map((a) => `"${a.bar}" among ${a.projects}`).join("; ")}. desk overhead --landed ${wider[0]!.bar} shows it.`);
  return out.join("\n");
}
