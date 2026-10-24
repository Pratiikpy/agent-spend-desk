import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * What the gate did while the owner was away (DF-002): requests it denied, sessions it paused, approvals it asked for, and
 * calls it would have denied had the policy been enforcing. Read from the gate's own append-only event table, never written.
 */
export type NightKind = "denied" | "paused" | "asked" | "shadow_would_deny" | "bypass_opened" | "bypass_allowed" | "expired";

export interface NightEvent {
  id: number;
  ts: string;
  kind: NightKind;
  project: string | null;
  model: string | null;
  tool: string | null;
  reasonCode: string | null;
  reason: string | null;
  amountMicros: number;
  /** For an approval that was asked: whether it was answered. */
  answered: boolean | null;
}

export interface GateNight {
  counts: Record<NightKind, number>;
  /** The newest events first, at most `limit`. */
  events: NightEvent[];
  total: number;
}

const KINDS: readonly NightKind[] = ["denied", "paused", "asked", "shadow_would_deny", "bypass_opened", "bypass_allowed", "expired"];

/**
 * The events of a window. Null when there is no gate database to read (the gate was never started here), which is not the
 * same as a night on which it did nothing: the caller says which.
 */
export function readGateNight(path: string | null, sinceIso: string, untilIso: string, limit = 8): GateNight | null {
  if (path === null || !existsSync(path)) return null;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch {
    return null;
  }
  try {
    const table = (db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name = 'gate_event'").get() as { n: number }).n;
    if (table === 0) return null;
    const marks = KINDS.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT e.id, e.ts, e.kind, e.project, e.model, e.tool, e.reason_code, e.reason, e.amount_micros,
                CASE WHEN e.kind = 'asked' THEN EXISTS (SELECT 1 FROM gate_event a WHERE a.kind = 'approved' AND a.approval_id = e.id) ELSE NULL END answered
         FROM gate_event e WHERE e.ts >= ? AND e.ts < ? AND e.kind IN (${marks}) ORDER BY e.id DESC`,
      )
      .all(sinceIso, untilIso, ...KINDS) as unknown as { id: number; ts: string; kind: NightKind; project: string | null; model: string | null; tool: string | null; reason_code: string | null; reason: string | null; amount_micros: number; answered: number | null }[];
    const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<NightKind, number>;
    for (const r of rows) counts[r.kind] += 1;
    return {
      counts,
      total: rows.length,
      events: rows.slice(0, limit).map((r) => ({
        id: r.id,
        ts: r.ts,
        kind: r.kind,
        project: r.project,
        model: r.model,
        tool: r.tool,
        reasonCode: r.reason_code,
        reason: r.reason !== null && r.reason.length <= 200 ? r.reason : null,
        amountMicros: r.amount_micros,
        answered: r.answered === null ? null : r.answered === 1,
      })),
    };
  } finally {
    db.close();
  }
}

const WORDS: Record<NightKind, [string, string]> = {
  denied: ["request", "requests denied"],
  paused: ["session", "sessions paused"],
  asked: ["approval", "approvals asked for"],
  shadow_would_deny: ["call", "calls that would have been denied (the policy was not enforcing)"],
  bypass_opened: ["bypass", "bypasses opened"],
  bypass_allowed: ["call", "calls let through under a bypass"],
  expired: ["reservation", "reservations that ran out"],
};

/** One line saying what happened, or that nothing did. */
export function nightLine(n: GateNight): string {
  if (n.total === 0) return "The gate denied nothing, paused nothing and asked for nothing.";
  const parts = KINDS.filter((k) => n.counts[k] > 0).map((k) => `${n.counts[k]} ${WORDS[k][1]}`);
  return `${parts.join(", ")}.`;
}
