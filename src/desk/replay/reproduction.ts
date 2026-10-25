import type { Ledger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";
import { parsePolicyYaml } from "../policy/parse.ts";
import { replayPolicy, type ReplaySession } from "./policy-replay.ts";

/**
 * A replay says what a policy would have done to recorded sessions. Before it is allowed to say anything, its baseline must reproduce the record, in two ways. The
 * sessions it was given must add up to what the ledger stored for the same window, session by session; and the replay engine, run with a policy that permits everything,
 * must come out with the same total and pause nothing. When either fails (calls dropped on the way from the ledger to the replay, a cost that does not match its session, an
 * engine that does not leave an empty policy alone), a saving computed from those sessions is a difference between two accounts, not a property of the policy, so the replay
 * is withheld, with the sessions that do not reproduce.
 */
export interface Reproduction {
  reproduces: boolean;
  /** The engine, run with a policy that permits everything, reproduced the total and paused nothing. */
  engineReproduces: boolean;
  sessions: number;
  replayMicros: number;
  ledgerMicros: number;
  mismatchedCount: number;
  /** The first ten, largest difference first. */
  mismatched: { sessionId: string; replayMicros: number; ledgerMicros: number }[];
}

const PERMIT_ALL = parsePolicyYaml(["version: 1", "rules:", "  - id: permit-everything", "    kind: permit", "    when: {}", ""].join("\n"));

export function baselineReproduction(db: Ledger, sessions: readonly ReplaySession[], sinceIso: string, untilIso: string): Reproduction {
  const stored = new Map<string, number>();
  const rows = db
    .prepare(
      `SELECT m.session_id AS id, COALESCE(SUM(c.total_micros), 0) AS micros
       FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated'
       WHERE m.ts >= ? AND m.ts <= ? GROUP BY m.session_id`,
    )
    .all(sinceIso, untilIso) as { id: string; micros: number }[];
  for (const r of rows) stored.set(r.id, Number(r.micros));
  let replayMicros = 0;
  let ledgerMicros = 0;
  const bad: { sessionId: string; replayMicros: number; ledgerMicros: number }[] = [];
  for (const s of sessions) {
    const replay = s.calls.reduce((sum, c) => sum + c.costMicros, 0);
    const ledger = stored.get(s.id) ?? 0;
    replayMicros += replay;
    ledgerMicros += ledger;
    if (replay !== ledger) bad.push({ sessionId: s.id, replayMicros: replay, ledgerMicros: ledger });
  }
  // Sessions the ledger holds in the window that the replay was never given are a difference too.
  const given = new Set(sessions.map((x) => x.id));
  for (const [id, micros] of stored) {
    if (!given.has(id) && micros !== 0) {
      bad.push({ sessionId: id, replayMicros: 0, ledgerMicros: micros });
      ledgerMicros += micros;
    }
  }
  bad.sort((a, b) => Math.abs(b.replayMicros - b.ledgerMicros) - Math.abs(a.replayMicros - a.ledgerMicros));
  const engine = replayPolicy(PERMIT_ALL, sessions);
  const engineReproduces = engine.totalMicros === replayMicros && engine.paused.length === 0 && engine.savedMicros === 0;
  return { reproduces: bad.length === 0 && engineReproduces, engineReproduces, sessions: sessions.length, replayMicros, ledgerMicros, mismatchedCount: bad.length, mismatched: bad.slice(0, 10) };
}

/** What a withheld replay says in place of its figures. */
export function withheldNotice(r: Reproduction): string {
  const engine = r.engineReproduces ? "" : " The replay engine, run with a policy that permits everything, did not leave the record alone.";
  const list = r.mismatched.map((m) => `${m.sessionId.slice(0, 8)} replays at ${formatUsd(m.replayMicros)}, the ledger holds ${formatUsd(m.ledgerMicros)}`).join("; ");
  return [
    `Replay withheld: its baseline does not reproduce the ledger. Of ${r.sessions.toLocaleString("en-US")} sessions, ${r.mismatchedCount.toLocaleString("en-US")} replay at a different cost than the ledger stored (${formatUsd(r.replayMicros)} against ${formatUsd(r.ledgerMicros)} in all).${engine}`,
    list === "" ? "" : `First: ${list}.`,
    "A saving computed from numbers that do not match the record would be a difference between two accounts of the same spend, not a property of the policy. Run `desk ledger verify --deep` to see whether the ledger itself is intact, and `desk prices reprice --preview` to see whether its prices would move.",
  ]
    .filter((x) => x !== "")
    .join("\n");
}
