import type { Ledger } from "../ledger/db.ts";

/**
 * Alerts on the owner's schedule (DF-010). A rule looks at the state of things and says OK, WARNING, ALERT or NO_DATA; this
 * engine decides whether that is worth interrupting someone for. The rules it follows, taken from how monitoring systems
 * avoid crying wolf:
 *
 *  - The first time a rule is seen, it speaks only if it is unhealthy.
 *  - A rule speaks when its state differs from the state it last spoke (or stayed quiet) about; saying the same thing again is suppressed.
 *  - Going from WARNING to ALERT always speaks. Otherwise a rule's suite (cap, canary, idle, reconciliation, gate) speaks at most once per UTC day;
 *    what was held back speaks the next day if it is still true, because it did not count as spoken.
 *  - NO_DATA never speaks: no data is not a problem a person can fix by being woken.
 *  - A rule the owner paused is never evaluated and never overwritten.
 *  - Getting better is recorded, not announced.
 */
export type AlertState = "OK" | "WARNING" | "ALERT" | "NO_DATA";
export type Suite = "cap" | "idle" | "canary" | "reconciliation" | "gate";

export interface RuleResult {
  key: string;
  suite: Suite;
  state: AlertState;
  title: string;
  body: string;
  /** How to see the evidence: a command or a screen. */
  evidence: string;
}

export type Disposition = "fired" | "suppressed_daily_limit" | "suppressed_paused" | "recovered";

export interface AlertEvent {
  alertId: number;
  ts: string;
  key: string;
  suite: Suite;
  state: AlertState;
  title: string;
  body: string;
  evidence: string;
  disposition: Disposition;
  delivered: { channel: string; ok: boolean; detail: string }[];
}

const RANK: Record<AlertState, number> = { OK: 0, NO_DATA: 0, WARNING: 1, ALERT: 2 };
const unhealthy = (s: AlertState): boolean => s === "WARNING" || s === "ALERT";

interface StateRow {
  key: string;
  suite: string;
  state: AlertState;
  spoken: AlertState | null;
  paused: number;
}

export interface ApplyReport {
  fired: AlertEvent[];
  heldBack: AlertEvent[];
  recovered: AlertEvent[];
  paused: string[];
}

/** Apply one round of rule results to the stored states, return what should be delivered, and record every decision. */
export function applyResults(db: Ledger, results: readonly RuleResult[], now: Date): ApplyReport {
  const at = now.toISOString();
  const today = at.slice(0, 10);
  const report: ApplyReport = { fired: [], heldBack: [], recovered: [], paused: [] };
  const get = db.prepare("SELECT key, suite, state, spoken_state AS spoken, paused FROM alert_state WHERE key = ?");
  const put = db.prepare(
    `INSERT INTO alert_state (key, suite, state, spoken_state, paused, since, evaluated_at) VALUES (?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT (key) DO UPDATE SET suite = excluded.suite, state = excluded.state, spoken_state = excluded.spoken_state,
       since = CASE WHEN alert_state.state = excluded.state THEN alert_state.since ELSE excluded.since END, evaluated_at = excluded.evaluated_at`,
  );
  const record = db.prepare(
    "INSERT INTO alert_event (ts, key, suite, state, title, body, evidence, disposition, delivered) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]')",
  );
  const firedToday = db.prepare("SELECT COUNT(*) n FROM alert_event WHERE suite = ? AND disposition = 'fired' AND substr(ts, 1, 10) = ?");
  // A held-back or paused decision is written once a day per rule and state, not at every check.
  const alreadyToday = db.prepare("SELECT COUNT(*) n FROM alert_event WHERE key = ? AND state = ? AND disposition = ? AND substr(ts, 1, 10) = ?");
  const once = (r: RuleResult, d: Disposition): AlertEvent | null => ((alreadyToday.get(r.key, r.state, d, today) as { n: number }).n > 0 ? null : event(r, d));

  const event = (r: RuleResult, disposition: Disposition): AlertEvent => {
    const id = Number(record.run(at, r.key, r.suite, r.state, r.title, r.body, r.evidence, disposition).lastInsertRowid);
    return { alertId: id, ts: at, key: r.key, suite: r.suite, state: r.state, title: r.title, body: r.body, evidence: r.evidence, disposition, delivered: [] };
  };

  db.exec("BEGIN");
  try {
    for (const r of results) {
      const prev = get.get(r.key) as StateRow | undefined;
      if (prev?.paused === 1) {
        report.paused.push(r.key);
        if (unhealthy(r.state)) once(r, "suppressed_paused");
        continue;
      }
      // The state it last spoke about, or stayed quiet about. NO_DATA is quiet by definition.
      const spoken: AlertState | null = prev?.spoken ?? null;
      let nextSpoken: AlertState | null = spoken;
      if (prev === undefined) {
        // First evaluation: it speaks only if unhealthy.
        if (!unhealthy(r.state)) nextSpoken = r.state;
      }
      if (!unhealthy(r.state)) {
        if (prev !== undefined && unhealthy(prev.state) && r.state === "OK") report.recovered.push(event(r, "recovered"));
        nextSpoken = r.state;
      } else if (r.state !== spoken) {
        const escalation = spoken !== null && unhealthy(spoken) && RANK[r.state] > RANK[spoken];
        const used = (firedToday.get(r.suite, today) as { n: number }).n;
        if (used > 0 && !escalation) {
          const held = once(r, "suppressed_daily_limit");
          if (held !== null) report.heldBack.push(held);
        }
        else {
          report.fired.push(event(r, "fired"));
          nextSpoken = r.state;
        }
      }
      put.run(r.key, r.suite, r.state, nextSpoken, at, at);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return report;
}

export function recordDelivery(db: Ledger, alertId: number, delivered: AlertEvent["delivered"]): void {
  db.prepare("UPDATE alert_event SET delivered = ? WHERE alert_id = ?").run(JSON.stringify(delivered), alertId);
}

export interface StoredState {
  key: string;
  suite: Suite;
  state: AlertState;
  paused: boolean;
  since: string;
  evaluatedAt: string;
}

export function listStates(db: Ledger): StoredState[] {
  return (db.prepare("SELECT key, suite, state, paused, since, evaluated_at AS evaluatedAt FROM alert_state ORDER BY suite, key").all() as unknown as (Omit<StoredState, "paused"> & { paused: number })[]).map((r) => ({ ...r, paused: r.paused === 1 }));
}

/** Pause a rule: it is not evaluated and its state is kept as it was until it is resumed. A key not seen yet is created paused, in the state OK. */
export function setPaused(db: Ledger, key: string, paused: boolean, now: Date = new Date()): void {
  const at = now.toISOString();
  const suite = key.split(":")[0] ?? "gate";
  db.prepare(
    `INSERT INTO alert_state (key, suite, state, spoken_state, paused, since, evaluated_at) VALUES (?, ?, 'OK', 'OK', ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET paused = excluded.paused`,
  ).run(key, suite, paused ? 1 : 0, at, at);
}

export function history(db: Ledger, limit = 30): AlertEvent[] {
  const rows = db.prepare("SELECT alert_id AS alertId, ts, key, suite, state, title, body, evidence, disposition, delivered FROM alert_event ORDER BY alert_id DESC LIMIT ?").all(limit) as unknown as (Omit<AlertEvent, "delivered"> & { delivered: string })[];
  return rows.map((r) => ({ ...r, delivered: JSON.parse(r.delivered) as AlertEvent["delivered"] }));
}
