import { createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson, sha256Hex } from "../../runtime/canonical.ts";
import { assertSafeInt } from "../money.ts";
import { GateError, type BudgetRef, type BudgetTotals, type EventInput, type GateEventRow, type ReservationState, type ReservationView, type Violation, type WindowKind } from "./types.ts";

export const GENESIS_HASH = "0".repeat(64);
export const DEFAULT_RESERVATION_TTL_MS = 300_000;

type SqlRow = Record<string, unknown>;

function toRow(r: SqlRow): GateEventRow {
  return r as unknown as GateEventRow;
}

function hashOf(row: Omit<GateEventRow, "hash" | "sig">): string {
  return sha256Hex(`${row.prev_hash}\n${canonicalJson(row)}`);
}

export function signHash(key: string, hash: string): string {
  return createHmac("sha256", key).update(hash).digest("hex");
}

/** True when `sig` is the HMAC of `hash` under `key`. Compared in constant time. */
export function sigValid(key: string, hash: string, sig: string | null): boolean {
  if (sig === null) return false;
  const want = Buffer.from(signHash(key, hash), "hex");
  const got = Buffer.from(sig, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * The reservation ledger (spec 4.5): authorize, settle, void and expire are appended as events. Money is
 * integer micro-dollars. The caller wraps a decision in `tx` so that checking the totals and appending
 * the event happen under one write lock; SQLite has one writer, which is the same guarantee as a row lock.
 */
export class GateLedger {
  private inTx = false;

  constructor(
    readonly db: DatabaseSync,
    private readonly wall: () => number = Date.now,
  ) {}

  /**
   * The gate's time: the wall clock, but never earlier than the last event it recorded. A clock set back (by a person, a
   * virtual machine or a time service) therefore cannot reopen a window that is already spent, and the record stays in time
   * order. While the wall clock is behind, this time stands still, so a reservation or approval does not age until the
   * clock catches up. A clock set forward cannot be told from a machine that slept, so the gate follows it.
   */
  readonly now = (): number => {
    const wall = this.wall();
    const last = this.lastStampMs();
    return last > wall ? last : wall;
  };

  private lastStampMs(): number {
    const r = this.db.prepare("SELECT ts FROM gate_event ORDER BY id DESC LIMIT 1").get() as { ts?: string } | undefined;
    return r?.ts === undefined ? 0 : Date.parse(r.ts);
  }

  /** How far the wall clock is behind the last recorded event, in milliseconds; 0 when it is not. */
  clockBehindMs(): number {
    return Math.max(0, this.lastStampMs() - this.wall());
  }

  /** Run `fn` under BEGIN IMMEDIATE. A lock that cannot be taken in time throws, and the caller must fail closed. */
  tx<T>(fn: () => T): T {
    if (this.inTx) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.inTx = true;
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* the connection may already be gone; the original error is the one that matters */
      }
      throw error;
    } finally {
      this.inTx = false;
    }
  }

  nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  lastEvent(): GateEventRow | undefined {
    const r = this.db.prepare("SELECT * FROM gate_event ORDER BY id DESC LIMIT 1").get();
    return r === undefined ? undefined : toRow(r);
  }

  event(id: number): GateEventRow | undefined {
    const r = this.db.prepare("SELECT * FROM gate_event WHERE id = ?").get(id);
    return r === undefined ? undefined : toRow(r);
  }

  /** Append one event (and the budgets it counts against). Must run inside `tx`. */
  append(input: EventInput): GateEventRow {
    if (!this.inTx) throw new GateError("E_LEDGER", "append outside a transaction", 500);
    const money = input.amount_micros ?? 0;
    assertSafeInt(money, "amount_micros");
    const last = this.lastEvent();
    const id = (last?.id ?? 0) + 1;
    const base: Omit<GateEventRow, "hash" | "sig"> = {
      id,
      ts: this.nowIso(),
      kind: input.kind,
      reservation_id: input.reservation_id ?? (input.kind === "authorized" ? id : null),
      idempotency_key: input.idempotency_key ?? null,
      budget_set: input.budget_set ?? null,
      session_id: input.session_id ?? null,
      person: input.person ?? null,
      project: input.project ?? null,
      agent: input.agent ?? null,
      model: input.model ?? null,
      tool: input.tool ?? null,
      call_ref: input.call_ref ?? null,
      amount_micros: money,
      expires_at: input.expires_at ?? null,
      reason_code: input.reason_code ?? null,
      reason: input.reason ?? null,
      verdict: input.verdict ?? null,
      policy_version: input.policy_version ?? null,
      approval_id: input.approval_id ?? null,
      basis: canonicalJson(input.basis ?? {}),
      prev_hash: last?.hash ?? GENESIS_HASH,
    };
    const hash = hashOf(base);
    const row: GateEventRow = { ...base, hash, sig: input.signKey === undefined ? null : signHash(input.signKey, hash) };
    this.db
      .prepare(
        `INSERT INTO gate_event (id, ts, kind, reservation_id, idempotency_key, budget_set, session_id, person, project, agent, model, tool,
           call_ref, amount_micros, expires_at, reason_code, reason, verdict, policy_version, approval_id, basis, prev_hash, hash, sig)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id, row.ts, row.kind, row.reservation_id, row.idempotency_key, row.budget_set, row.session_id, row.person, row.project,
        row.agent, row.model, row.tool, row.call_ref, row.amount_micros, row.expires_at, row.reason_code, row.reason, row.verdict,
        row.policy_version, row.approval_id, row.basis, row.prev_hash, row.hash, row.sig,
      );
    const ins = this.db.prepare("INSERT INTO gate_event_budget (event_id, budget_id, window_kind, limit_micros) VALUES (?, ?, ?, ?)");
    for (const b of input.budgets ?? []) ins.run(id, b.budgetId, b.window, b.limitMicros);
    return row;
  }

  budgetsOf(eventId: number): BudgetRef[] {
    const rows = this.db.prepare("SELECT budget_id, window_kind, limit_micros FROM gate_event_budget WHERE event_id = ? ORDER BY budget_id").all(eventId) as SqlRow[];
    return rows.map((r) => ({ budgetId: String(r["budget_id"]), window: r["window_kind"] as WindowKind, limitMicros: r["limit_micros"] === null ? null : Number(r["limit_micros"]) }));
  }

  authorizedByKey(budgetSet: string, key: string): GateEventRow | undefined {
    const r = this.db.prepare("SELECT * FROM gate_event WHERE kind = 'authorized' AND budget_set = ? AND idempotency_key = ?").get(budgetSet, key);
    return r === undefined ? undefined : toRow(r);
  }

  /** Find a reservation by its id, or by the idempotency key it was authorized under. */
  findReservation(ref: { id?: number; key?: string }): ReservationView | undefined {
    let authorized: GateEventRow | undefined;
    if (ref.id !== undefined) {
      const r = this.db.prepare("SELECT * FROM gate_event WHERE kind = 'authorized' AND id = ?").get(ref.id);
      authorized = r === undefined ? undefined : toRow(r);
    } else if (ref.key !== undefined) {
      const rows = this.db.prepare("SELECT * FROM gate_event WHERE kind = 'authorized' AND idempotency_key = ? ORDER BY id DESC").all(ref.key) as SqlRow[];
      if (rows.length > 1) throw new GateError("E_AMBIGUOUS_KEY", "that idempotency key was used in more than one budget set; settle by reservation id", 409);
      authorized = rows[0] === undefined ? undefined : toRow(rows[0]);
    }
    if (authorized === undefined) return undefined;
    return this.viewOf(authorized);
  }

  private viewOf(authorized: GateEventRow): ReservationView {
    const later = (this.db.prepare("SELECT * FROM gate_event WHERE reservation_id = ? AND id <> ? ORDER BY id").all(authorized.id, authorized.id) as SqlRow[]).map(toRow);
    const settled = later.find((e) => e.kind === "settled");
    const voided = later.find((e) => e.kind === "voided");
    const expired = later.find((e) => e.kind === "expired");
    const overage = later.find((e) => e.kind === "overage");
    let state: ReservationState = "open";
    if (settled && expired) state = "late_settled";
    else if (settled) state = "settled";
    else if (voided) state = "voided";
    else if (expired) state = "expired";
    return { id: authorized.id, authorized, budgets: this.budgetsOf(authorized.id), state, settled, overage, closing: settled ?? voided ?? expired };
  }

  /**
   * What one person has spent and has reserved, narrowed to a session, a model or a project and to the time since an instant, summed over the events so that a
   * window survives a restart and cannot drift from the record. A reservation counts while it is open, whatever its age.
   */
  scopedTotals(f: { person: string; sessionId?: string; model?: string; project?: string; sinceIso?: string }): { spent: number; reserved: number } {
    const where: string[] = ["e.person = ?"];
    const args: (string | number)[] = [f.person];
    if (f.sessionId !== undefined) {
      where.push("e.session_id = ?");
      args.push(f.sessionId);
    }
    if (f.model !== undefined) {
      where.push("e.model = ?");
      args.push(f.model);
    }
    if (f.project !== undefined) {
      where.push("e.project = ?");
      args.push(f.project);
    }
    const filter = where.join(" AND ");
    const since = f.sinceIso === undefined ? "" : " AND e.ts >= ?";
    const spent = this.db
      .prepare(`SELECT COALESCE(SUM(e.amount_micros), 0) AS s FROM gate_event e WHERE e.kind IN ('settled', 'overage', 'observed') AND ${filter}${since}`)
      .get(...args, ...(f.sinceIso === undefined ? [] : [f.sinceIso])) as SqlRow;
    const reserved = this.db
      .prepare(
        `SELECT COALESCE(SUM(e.amount_micros), 0) AS s FROM gate_event e WHERE e.kind = 'authorized' AND ${filter}
           AND NOT EXISTS (SELECT 1 FROM gate_event c WHERE c.reservation_id = e.id AND c.id <> e.id AND c.kind IN ('settled', 'voided', 'expired'))`,
      )
      .get(...args) as SqlRow;
    return { spent: Number(spent["s"]), reserved: Number(reserved["s"]) };
  }

  /** Spent and reserved for one budget, summed over events so they cannot drift from the record. */
  budgetTotals(budgetId: string): BudgetTotals {
    const meta = this.db
      .prepare("SELECT window_kind, limit_micros FROM gate_event_budget WHERE budget_id = ? ORDER BY event_id DESC LIMIT 1")
      .get(budgetId) as SqlRow | undefined;
    const spent = this.db
      .prepare(
        `SELECT COALESCE(SUM(e.amount_micros), 0) AS s FROM gate_event e JOIN gate_event_budget b ON b.event_id = e.id
         WHERE b.budget_id = ? AND e.kind IN ('settled', 'overage', 'observed')`,
      )
      .get(budgetId) as SqlRow;
    const reserved = this.db
      .prepare(
        `SELECT COALESCE(SUM(a.amount_micros), 0) AS s FROM gate_event a JOIN gate_event_budget b ON b.event_id = a.id
         WHERE b.budget_id = ? AND a.kind = 'authorized'
           AND NOT EXISTS (SELECT 1 FROM gate_event c WHERE c.reservation_id = a.id AND c.id <> a.id AND c.kind IN ('settled', 'voided', 'expired'))`,
      )
      .get(budgetId) as SqlRow;
    const excused = this.db
      .prepare(
        `SELECT COALESCE(SUM(e.amount_micros), 0) AS s FROM gate_event e JOIN gate_event_budget b ON b.event_id = e.id
         WHERE b.budget_id = ? AND (e.kind = 'overage' OR (e.kind = 'settled' AND e.reason_code = 'late_settle'))`,
      )
      .get(budgetId) as SqlRow;
    return {
      budgetId,
      window: (meta?.["window_kind"] as WindowKind | undefined) ?? "day",
      spent: Number(spent["s"]),
      reserved: Number(reserved["s"]),
      excused: Number(excused["s"]),
      limit: meta === undefined || meta["limit_micros"] === null ? null : Number(meta["limit_micros"]),
    };
  }

  /** I-R4: authorizations past their expiry leave the reserved sum. Returns how many were expired. */
  expireDue(): number {
    const nowIso = this.nowIso();
    const due = this.db
      .prepare(
        `SELECT a.* FROM gate_event a WHERE a.kind = 'authorized' AND a.expires_at <= ?
           AND NOT EXISTS (SELECT 1 FROM gate_event c WHERE c.reservation_id = a.id AND c.id <> a.id AND c.kind IN ('settled', 'voided', 'expired'))
         ORDER BY a.id`,
      )
      .all(nowIso) as SqlRow[];
    if (due.length === 0) return 0;
    return this.tx(() => {
      let n = 0;
      for (const d of due.map(toRow)) {
        const again = this.findReservation({ id: d.id });
        if (again === undefined || again.state !== "open") continue;
        this.append({
          kind: "expired",
          reservation_id: d.id,
          idempotency_key: d.idempotency_key,
          budget_set: d.budget_set,
          session_id: d.session_id,
          person: d.person,
          amount_micros: d.amount_micros,
          reason_code: "expired",
          reason: `reservation passed its expiry ${d.expires_at ?? ""}`.trim(),
          budgets: this.budgetsOf(d.id),
        });
        n += 1;
      }
      return n;
    });
  }

  allEvents(): GateEventRow[] {
    return (this.db.prepare("SELECT * FROM gate_event ORDER BY id").all() as SqlRow[]).map(toRow);
  }

  allBudgetRows(): Map<number, BudgetRef[]> {
    const rows = this.db.prepare("SELECT event_id, budget_id, window_kind, limit_micros FROM gate_event_budget ORDER BY event_id, budget_id").all() as SqlRow[];
    const out = new Map<number, BudgetRef[]>();
    for (const r of rows) {
      const id = Number(r["event_id"]);
      const list = out.get(id) ?? [];
      list.push({ budgetId: String(r["budget_id"]), window: r["window_kind"] as WindowKind, limitMicros: r["limit_micros"] === null ? null : Number(r["limit_micros"]) });
      out.set(id, list);
    }
    return out;
  }

  /** The projections rebuilt from the events alone, as canonical JSON (byte-identical for the same events). */
  projectionJson(): string {
    return canonicalJson(foldEvents(this.allEvents(), this.allBudgetRows()));
  }

  /** Recompute the hash chain. A changed, removed or reordered row is reported. */
  verifyChain(): Violation[] {
    const out: Violation[] = [];
    let prev = GENESIS_HASH;
    let expectedId = 1;
    for (const row of this.allEvents()) {
      if (row.id !== expectedId) out.push({ invariant: "chain", eventId: row.id, message: `event ids skip from ${expectedId - 1} to ${row.id}` });
      expectedId = row.id + 1;
      if (row.prev_hash !== prev) out.push({ invariant: "chain", eventId: row.id, message: "prev_hash does not match the row before" });
      const { hash, sig: _sig, ...rest } = row;
      if (hashOf(rest) !== hash) out.push({ invariant: "chain", eventId: row.id, message: "hash does not match the row content" });
      prev = hash;
    }
    return out;
  }

  /** The scheduled integrity job: recompute I-R1 to I-R5 from the events (and the chain). Any violation fails the run closed. */
  integrity(): Violation[] {
    return [...this.verifyChain(), ...checkInvariants(this.allEvents(), this.allBudgetRows(), this.nowIso())];
  }
}

export interface BudgetState {
  budgetId: string;
  window: WindowKind;
  spent: number;
  reserved: number;
  excused: number;
  limit: number | null;
  available: number | null;
  state: "ok" | "at_limit" | "over_limit" | "unenforced";
}

export interface LedgerProjection {
  budgets: BudgetState[];
  open: { reservationId: number; amount: number; expiresAt: string | null }[];
  paused: string[];
  eventCount: number;
  headHash: string;
}

/** Pure fold of events into the projections `v_budget_state` and the open-reservation list. */
export function foldEvents(rows: readonly GateEventRow[], budgetsByEvent: ReadonlyMap<number, readonly BudgetRef[]>): LedgerProjection {
  const closed = new Set<number>();
  for (const r of rows) if ((r.kind === "settled" || r.kind === "voided" || r.kind === "expired") && r.reservation_id !== null) closed.add(r.reservation_id);
  const budgets = new Map<string, BudgetState>();
  const ensure = (b: BudgetRef): BudgetState => {
    let s = budgets.get(b.budgetId);
    if (s === undefined) {
      s = { budgetId: b.budgetId, window: b.window, spent: 0, reserved: 0, excused: 0, limit: null, available: null, state: "unenforced" };
      budgets.set(b.budgetId, s);
    }
    s.limit = b.limitMicros;
    return s;
  };
  const open: LedgerProjection["open"] = [];
  const paused = new Set<string>();
  for (const r of rows) {
    const refs = budgetsByEvent.get(r.id) ?? [];
    for (const b of refs) {
      const s = ensure(b);
      if (r.kind === "authorized" && !closed.has(r.id)) s.reserved += r.amount_micros;
      else if (r.kind === "settled" || r.kind === "observed") s.spent += r.amount_micros;
      else if (r.kind === "overage") {
        s.spent += r.amount_micros;
        s.excused += r.amount_micros;
      }
      if (r.kind === "settled" && r.reason_code === "late_settle") s.excused += r.amount_micros;
    }
    if (r.kind === "authorized" && !closed.has(r.id)) open.push({ reservationId: r.id, amount: r.amount_micros, expiresAt: r.expires_at });
    if (r.kind === "paused" && r.person !== null) paused.add(r.person);
    if (r.kind === "resumed" && r.person !== null) paused.delete(r.person);
  }
  const list = [...budgets.values()].sort((a, b) => (a.budgetId < b.budgetId ? -1 : 1));
  for (const s of list) {
    if (s.limit === null) {
      s.state = "unenforced";
      s.available = null;
    } else {
      s.available = Math.max(0, s.limit - s.spent - s.reserved);
      s.state = s.spent + s.reserved > s.limit ? "over_limit" : s.spent + s.reserved === s.limit ? "at_limit" : "ok";
    }
  }
  const head = rows[rows.length - 1];
  return { budgets: list, open, paused: [...paused].sort(), eventCount: rows.length, headHash: head?.hash ?? GENESIS_HASH };
}

/**
 * I-R1 to I-R5 recomputed from the events alone (spec 4.5). I-R5 is checked after every event, for the
 * budgets that event touches and only where a limit was in force: spent + reserved may exceed the limit
 * only by recorded overage and late settles.
 */
export function checkInvariants(rows: readonly GateEventRow[], budgetsByEvent: ReadonlyMap<number, readonly BudgetRef[]>, nowIso?: string): Violation[] {
  const out: Violation[] = [];
  const authorized = new Map<number, GateEventRow>();
  const keys = new Map<string, number>();
  const closers = new Map<number, GateEventRow[]>();
  const state = new Map<string, { spent: number; reserved: number; excused: number }>();
  const stateOf = (id: string) => {
    let s = state.get(id);
    if (s === undefined) {
      s = { spent: 0, reserved: 0, excused: 0 };
      state.set(id, s);
    }
    return s;
  };
  const closedReservations = new Set<number>();
  for (const r of rows) {
    const refs = budgetsByEvent.get(r.id) ?? [];
    if (!Number.isSafeInteger(r.amount_micros) || r.amount_micros < 0) out.push({ invariant: "shape", eventId: r.id, message: "amount is not a non-negative safe integer" });
    switch (r.kind) {
      case "authorized": {
        authorized.set(r.id, r);
        const k = `${r.budget_set ?? ""}\u0000${r.idempotency_key ?? ""}`;
        const prior = keys.get(k);
        if (prior !== undefined) out.push({ invariant: "I-R1", eventId: r.id, message: `idempotency key repeated within one budget set (first authorized at event ${prior})` });
        else keys.set(k, r.id);
        for (const b of refs) stateOf(b.budgetId).reserved += r.amount_micros;
        break;
      }
      case "settled":
      case "voided":
      case "expired": {
        const a = r.reservation_id === null ? undefined : authorized.get(r.reservation_id);
        if (a === undefined || r.reservation_id === null) {
          out.push({ invariant: "shape", eventId: r.id, message: `${r.kind} refers to no earlier authorization` });
          break;
        }
        const list = closers.get(r.reservation_id) ?? [];
        list.push(r);
        closers.set(r.reservation_id, list);
        if (r.kind === "settled" && r.amount_micros > a.amount_micros) out.push({ invariant: "I-R2", eventId: r.id, message: `settled ${r.amount_micros} exceeds reserved ${a.amount_micros}` });
        if (r.kind === "expired" && a.expires_at !== null && r.ts < a.expires_at) out.push({ invariant: "I-R4", eventId: r.id, message: "expired before its expires_at" });
        if (!closedReservations.has(r.reservation_id)) {
          closedReservations.add(r.reservation_id);
          for (const b of refs.length > 0 ? refs : (budgetsByEvent.get(a.id) ?? [])) stateOf(b.budgetId).reserved -= a.amount_micros;
        }
        if (r.kind === "settled") for (const b of refs) {
          stateOf(b.budgetId).spent += r.amount_micros;
          if (r.reason_code === "late_settle") stateOf(b.budgetId).excused += r.amount_micros;
        }
        break;
      }
      case "overage": {
        for (const b of refs) {
          const s = stateOf(b.budgetId);
          s.spent += r.amount_micros;
          s.excused += r.amount_micros;
        }
        break;
      }
      case "observed": {
        for (const b of refs) stateOf(b.budgetId).spent += r.amount_micros;
        break;
      }
      default:
        break;
    }
    for (const b of refs) {
      if (b.limitMicros === null) continue;
      const s = stateOf(b.budgetId);
      if (s.spent + s.reserved > b.limitMicros + s.excused) {
        out.push({ invariant: "I-R5", eventId: r.id, message: `budget ${b.budgetId}: spent ${s.spent} + reserved ${s.reserved} exceeds limit ${b.limitMicros} by more than the recorded overage ${s.excused}` });
      }
    }
  }
  for (const [id, list] of closers) {
    const settledOrVoided = list.filter((e) => e.kind === "settled" || e.kind === "voided");
    if (settledOrVoided.length > 1) out.push({ invariant: "I-R3", eventId: id, message: `more than one of settled/voided for reservation ${id}` });
    if (list.filter((e) => e.kind === "expired").length > 1) out.push({ invariant: "I-R3", eventId: id, message: `reservation ${id} expired twice` });
    const first = list[0];
    const voidedAfterExpiry = list.some((e) => e.kind === "voided") && list.some((e) => e.kind === "expired");
    if (voidedAfterExpiry) out.push({ invariant: "I-R3", eventId: id, message: `reservation ${id} was both expired and voided` });
    if (first !== undefined && list.some((e) => e.kind === "settled" && e.reason_code === "late_settle") && !list.some((e) => e.kind === "expired")) {
      out.push({ invariant: "I-R4", eventId: id, message: `reservation ${id} has a late settle without an expiry` });
    }
  }
  if (nowIso !== undefined) {
    for (const a of authorized.values()) {
      if (a.expires_at !== null && a.expires_at <= nowIso && !closers.has(a.id)) {
        out.push({ invariant: "I-R4", eventId: a.id, message: `authorization is past its expiry ${a.expires_at} and still counts as reserved` });
      }
    }
  }
  return out;
}
