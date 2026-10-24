import { homedir, userInfo } from "node:os";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson, hashJson } from "../../runtime/canonical.ts";
import { NULL_TRACE, type Trace } from "../agents/trace.ts";
import type { Micros } from "../money.ts";
import { evaluate, matches, routeOf } from "../policy/evaluate.ts";
import type { Policy, Request, Verdict } from "../policy/types.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { worstCaseReservation } from "./estimate.ts";
import { DEFAULT_RESERVATION_TTL_MS, GateLedger, sigValid } from "./ledger.ts";
import { readTranscriptDelta, resolveTranscript } from "./observe.ts";
import type { PolicySource, PolicyView } from "./policy-source.ts";
import { ensureGateSchema } from "./schema.ts";
import {
  GateError,
  type BudgetRef,
  type BudgetStanding,
  type GateDecision,
  type GateEventRow,
  type GateRequest,
  type ReservationView,
  type WindowKind,
} from "./types.ts";
import { derivedKey, parseGateRequest, parseSettle, parseVoid, str, asObject, optWhole, optStr, type SettleInput, type VoidInput } from "./validate.ts";

export const APPROVAL_TTL_MS = 15 * 60_000;
export const TOOL_KEY_TTL_MS = 300_000;

export type GateMode = "enforce" | "shadow";

export interface GateConfig {
  db: DatabaseSync;
  prices: PriceSnapshot;
  policy: PolicySource;
  now?: () => number;
  trace?: Trace;
  /** Shadow mode runs every check, records `shadow_would_deny`, and allows. Evaluated per call so it can end on a date. */
  mode?: () => GateMode;
  /** Key for the emergency switch's signature and for nothing else. Without it the switch cannot be opened. */
  ownerKey?: string;
  person?: string;
  /** Directories the gate may read session transcripts from. */
  transcriptRoots?: readonly string[];
  /** What a tool call is assumed to spend next, so that a session already at its cap is stopped (default 1 micro). */
  hookProbeMicros?: Micros;
  unpricedReserveMicros?: Readonly<Record<string, Micros>>;
  ttlMs?: number;
  /** A new policy runs in shadow mode for this long after the gate first sees it (spec 10.5: 7 days by default in the CLI). Ignored when `mode` is given. */
  shadowMs?: number;
  projectOf?: (cwd: string | null) => string;
  busyTimeoutMs?: number;
}

export interface SettleResult {
  reservationId: number;
  state: "settled" | "late_settled";
  settledMicros: Micros;
  overageMicros: Micros;
  late: boolean;
  /** True when this exact settle had already been recorded. */
  idempotent: boolean;
  paused: boolean;
}

export interface VoidResult {
  reservationId: number;
  state: string;
  idempotent: boolean;
}

export interface ToolBeginResult {
  status: "proceed" | "in_flight" | "replayed";
  idempotencyKey: string;
  decision: GateDecision | null;
  cachedResponse: unknown;
  resultHash: string | null;
}

export interface HookDecision {
  decision: "allow" | "ask" | "deny";
  reason: string;
  /** True when the gate could not decide and blocked as a precaution. */
  failedClosed: boolean;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}
function monthKey(iso: string): string {
  return iso.slice(0, 7);
}
export function budgetId(person: string, window: WindowKind, atIso: string): string {
  return `person:${person}|${window}:${window === "day" ? dayKey(atIso) : monthKey(atIso)}`;
}

function standingOf(b: BudgetRef, spent: Micros, reserved: Micros): BudgetStanding {
  return {
    window: b.window,
    budgetId: b.budgetId,
    spentMicros: spent,
    reservedMicros: reserved,
    limitMicros: b.limitMicros,
    remainingMicros: b.limitMicros === null ? null : Math.max(0, b.limitMicros - spent - reserved),
  };
}

/**
 * The gate (spec 10.5): reserve before the call, settle after it, deny when the reservation does not fit,
 * and refuse everything it cannot evaluate. Owns no model and no network; one SQLite file is its state.
 */
export class Gate {
  readonly ledger: GateLedger;
  private readonly cfg: GateConfig;
  private readonly trace: Trace;
  readonly person: string;

  constructor(cfg: GateConfig) {
    this.cfg = cfg;
    cfg.db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(cfg.busyTimeoutMs ?? 200))};`);
    ensureGateSchema(cfg.db);
    cfg.db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(cfg.busyTimeoutMs ?? 200))};`);
    this.ledger = new GateLedger(cfg.db, cfg.now ?? Date.now);
    this.trace = cfg.trace ?? NULL_TRACE;
    this.person = cfg.person ?? safeUser();
  }

  private mode(): GateMode {
    if (this.cfg.mode !== undefined) return this.cfg.mode();
    if (this.cfg.shadowMs === undefined || this.cfg.shadowMs <= 0) return "enforce";
    let view: PolicyView;
    try {
      view = this.policyView();
    } catch {
      return "enforce";
    }
    const row = this.cfg.db.prepare("SELECT first_seen FROM gate_policy_seen WHERE digest = ?").get(view.digest) as { first_seen?: string } | undefined;
    let first = row?.first_seen;
    if (first === undefined) {
      first = this.ledger.nowIso();
      this.cfg.db.prepare("INSERT OR IGNORE INTO gate_policy_seen (digest, version, first_seen) VALUES (?, ?, ?)").run(view.digest, view.version, first);
    }
    return Date.parse(first) + this.cfg.shadowMs > this.ledger.now() ? "shadow" : "enforce";
  }

  /** How far the machine's clock is behind the last event the gate recorded. Above zero means the clock was set back; the gate holds its own time until it catches up. */
  clockBehindMs(): number {
    return this.ledger.clockBehindMs();
  }

  private ttl(req: { ttl_ms: number | null }): number {
    return req.ttl_ms ?? this.cfg.ttlMs ?? DEFAULT_RESERVATION_TTL_MS;
  }

  // ---- state of the switch ------------------------------------------------------------------------------

  /** The emergency switch is open only when the latest switch event is a validly signed `bypass_opened` that has not run out. */
  bypassOpen(): { open: boolean; expiresAt: string | null; reason: string } {
    const last = this.cfg.db.prepare("SELECT * FROM gate_event WHERE kind IN ('bypass_opened', 'bypass_closed') ORDER BY id DESC LIMIT 1").get() as unknown as GateEventRow | undefined;
    if (last === undefined || last.kind === "bypass_closed") return { open: false, expiresAt: null, reason: "closed" };
    if (last.expires_at === null || last.expires_at <= this.ledger.nowIso()) return { open: false, expiresAt: last.expires_at, reason: "expired" };
    if (this.cfg.ownerKey === undefined || !sigValid(this.cfg.ownerKey, last.hash, last.sig)) return { open: false, expiresAt: last.expires_at, reason: "signature_invalid" };
    return { open: true, expiresAt: last.expires_at, reason: "open" };
  }

  /** Owner only: allow everything for a limited time. Written as a signed event so that it shows in the month record. */
  openBypass(forMs: number, owner: string): GateEventRow {
    if (this.cfg.ownerKey === undefined) throw new GateError("E_NO_OWNER_KEY", "the emergency switch needs an owner key (DESK_GATE_OWNER_TOKEN); none is configured", 403);
    if (!Number.isSafeInteger(forMs) || forMs < 1000 || forMs > 24 * 3_600_000) throw new GateError("E_INVALID", "the switch can be opened for 1 second to 24 hours", 400);
    return this.ledger.tx(() => {
      const row = this.ledger.append({
        kind: "bypass_opened",
        person: owner,
        expires_at: new Date(this.ledger.now() + forMs).toISOString(),
        reason_code: "bypass",
        reason: `owner ${owner} opened the gate for ${Math.round(forMs / 1000)} s`,
        basis: { owner, forMs },
        signKey: this.cfg.ownerKey,
      });
      this.trace.emit({ event: "risk.flag", why: "rule", detail: { op: "gate.bypass", state: "opened", expiresAt: row.expires_at, eventId: row.id } });
      return row;
    });
  }

  closeBypass(owner: string): GateEventRow {
    return this.ledger.tx(() => {
      const row = this.ledger.append({ kind: "bypass_closed", person: owner, reason_code: "bypass_closed", reason: `owner ${owner} closed the gate switch`, basis: { owner } });
      this.trace.emit({ event: "risk.flag", why: "rule", detail: { op: "gate.bypass", state: "closed", eventId: row.id } });
      return row;
    });
  }

  isPaused(person: string): boolean {
    const r = this.cfg.db.prepare("SELECT kind FROM gate_event WHERE person = ? AND kind IN ('paused', 'resumed') ORDER BY id DESC LIMIT 1").get(person) as { kind?: string } | undefined;
    return r?.kind === "paused";
  }

  pause(person: string, owner: string, why: string): void {
    this.ledger.tx(() => {
      this.ledger.append({ kind: "paused", person, reason_code: "paused", reason: why, basis: { by: owner } });
    });
  }

  resume(person: string, owner: string): void {
    this.ledger.tx(() => {
      this.ledger.append({ kind: "resumed", person, reason_code: "resumed", reason: `resumed by ${owner}`, basis: { by: owner } });
    });
  }

  // ---- limits and standing -----------------------------------------------------------------------------

  /** The tightest cap in force for this request, per window: every matching cap applies, so the smallest binds (spec 10.2). */
  private limitsFor(policy: Policy, req: Request): Record<WindowKind, Micros | null> {
    const out: Record<WindowKind, Micros | null> = { day: null, month: null };
    for (const rule of policy.rules) {
      if (rule.kind !== "permit" || rule.cap === undefined || !matches(rule.when, req)) continue;
      const cur = out[rule.cap.window];
      out[rule.cap.window] = cur === null ? rule.cap.maxMicros : Math.min(cur, rule.cap.maxMicros);
    }
    return out;
  }

  private budgetsFor(person: string, atIso: string, limits: Record<WindowKind, Micros | null>, enforced: boolean): BudgetRef[] {
    return (["day", "month"] as const).map((window) => ({
      budgetId: budgetId(person, window, atIso),
      window,
      limitMicros: enforced ? limits[window] : null,
    }));
  }

  private requestFor(g: GateRequest, daySpend: Micros, monthSpend: Micros): Request {
    return {
      project: g.project,
      person: g.person,
      agent: g.agent,
      model: g.model,
      task_type: g.task_type,
      waste_rule: g.waste_rule,
      action: g.action,
      recoverable_micros: g.recoverable_micros,
      day_spend_after_micros: daySpend,
      month_spend_after_micros: monthSpend,
    };
  }

  /** What is left in the person's day and month, under the caps that apply to the named project, model and agent. */
  budgetLeft(raw: unknown): { person: string; asOf: string; standing: BudgetStanding[]; policyVersion: number } {
    const o = asObject(raw, "request");
    const person = optStr(o, "person") ?? this.person;
    const view = this.policyView();
    const g = parseGateRequest({ session_id: "budget-left", person, project: optStr(o, "project") ?? "unknown", agent: optStr(o, "agent") ?? "agent:main", model: optStr(o, "model") ?? "unknown-model" });
    this.ledger.expireDue();
    const nowIso = this.ledger.nowIso();
    const totalsDay = this.ledger.budgetTotals(budgetId(person, "day", nowIso));
    const totalsMonth = this.ledger.budgetTotals(budgetId(person, "month", nowIso));
    const limits = this.limitsFor(view.policy, this.requestFor(g, totalsDay.spent + totalsDay.reserved, totalsMonth.spent + totalsMonth.reserved));
    const refs = this.budgetsFor(person, nowIso, limits, true);
    return {
      person,
      asOf: nowIso,
      policyVersion: view.version,
      standing: refs.map((b) => {
        const t = b.window === "day" ? totalsDay : totalsMonth;
        return standingOf(b, t.spent, t.reserved);
      }),
    };
  }

  private policyView(): PolicyView {
    return this.cfg.policy.current();
  }

  /** The policy now in force (throws GateError E_POLICY_UNAVAILABLE when it cannot be read). */
  currentPolicy(): PolicyView {
    return this.policyView();
  }

  // ---- authorize ------------------------------------------------------------------------------------------

  /**
   * Reserve the worst case for one call on every budget it counts against, in one transaction. Never throws
   * for a request it cannot approve: the answer is a deny with a reason. It throws GateError only for a request
   * that is malformed, and for a ledger that cannot be written (the caller then fails closed).
   */
  authorize(raw: unknown): GateDecision {
    const g = parseGateRequest(raw);
    return this.authorizeParsed(g);
  }

  authorizeParsed(g: GateRequest): GateDecision {
    return this.ledger.tx(() => this.authorizeLocked(g));
  }

  private denyEarly(g: GateRequest, code: string, reason: string, failed: boolean, policyVersion: number | null, key: string): GateDecision {
    const row = this.ledger.append({
      kind: "denied",
      idempotency_key: key,
      session_id: g.session_id,
      person: g.person,
      project: g.project,
      agent: g.agent,
      model: g.model,
      tool: g.tool,
      reason_code: code,
      reason,
      verdict: "deny",
      policy_version: policyVersion,
      basis: { failed },
    });
    this.trace.emit({ event: "desk.authorize", why: "rule", detail: { verdict: "deny", reasonCode: code, failed, eventId: row.id, model: g.model } });
    return {
      verdict: "deny",
      failed,
      shadow: false,
      reasonCode: code,
      reasons: [reason],
      matched: [],
      action: null,
      reservationId: null,
      idempotencyKey: key,
      idempotent: false,
      reservedMicros: 0,
      expiresAt: null,
      routedModel: g.model,
      standing: [],
      policyVersion,
      approvalRequest: null,
      basis: {},
    };
  }

  private authorizeLocked(g: GateRequest): GateDecision {
    this.ledger.expireDue();
    const nowIso = this.ledger.nowIso();
    const key = g.idempotency_key ?? derivedKey(g);

    let view: PolicyView;
    try {
      view = this.policyView();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.denyEarly(g, "policy_unavailable", message, true, null, key);
    }

    const bypass = this.bypassOpen();
    const enforced = !bypass.open;

    // The budget set is known before the money is: one day budget and one month budget for the person.
    const dayId = budgetId(g.person, "day", nowIso);
    const monthId = budgetId(g.person, "month", nowIso);
    const budgetSet = [dayId, monthId].sort().join(",");

    // I-R1: a repeated authorize returns the first decision.
    const prior = this.ledger.authorizedByKey(budgetSet, key);
    if (prior !== undefined) {
      const first = JSON.parse(prior.basis) as { decision?: GateDecision };
      const view2 = this.ledger.findReservation({ id: prior.id });
      this.ledger.append({
        kind: "idempotent_replayed",
        reservation_id: prior.id,
        idempotency_key: key,
        budget_set: budgetSet,
        session_id: g.session_id,
        person: g.person,
        reason_code: "idempotent_replayed",
        reason: `repeat of authorization ${prior.id}; no new reservation`,
        basis: { state: view2?.state ?? "unknown" },
      });
      if (first.decision === undefined) throw new GateError("E_LEDGER", `authorization ${prior.id} has no stored decision`, 500);
      return { ...first.decision, idempotent: true, reservationId: prior.id, idempotencyKey: key };
    }

    if (enforced && this.isPaused(g.person)) {
      return this.denyEarly(g, "paused", `${g.person} is paused after a budget overshoot; the owner must resume them`, false, view.version, key);
    }

    const est = worstCaseReservation(this.cfg.prices, {
      model: g.model,
      inputTokens: g.input_tokens,
      maxTokens: g.max_tokens,
      n: g.n,
      explicitMicros: g.estimate_micros,
      ...(this.cfg.unpricedReserveMicros !== undefined ? { unpricedReserveMicros: this.cfg.unpricedReserveMicros } : {}),
    });
    if (!est.ok) {
      if (!enforced) {
        this.ledger.append({ kind: "bypass_allowed", idempotency_key: key, session_id: g.session_id, person: g.person, model: g.model, reason_code: est.code, reason: est.reason });
      } else {
        return this.denyEarly(g, est.code, est.reason, false, view.version, key);
      }
    }
    const reserve = est.ok ? est.micros : 0;

    const dayT = this.ledger.budgetTotals(dayId);
    const monthT = this.ledger.budgetTotals(monthId);
    const dayAfter = dayT.spent + dayT.reserved + reserve;
    const monthAfter = monthT.spent + monthT.reserved + reserve;
    if (!Number.isSafeInteger(dayAfter) || !Number.isSafeInteger(monthAfter)) {
      return this.denyEarly(g, "amount_overflow", "the amounts involved do not fit in a safe integer", true, view.version, key);
    }
    const preq = this.requestFor(g, dayAfter, monthAfter);
    const verdict = evaluate(view.policy, preq);
    const limits = this.limitsFor(view.policy, preq);
    const mode = this.mode();
    const shadow = mode === "shadow";
    const routedModel = routeOf(view.policy, preq);

    let finalVerdict: Verdict = verdict.verdict;
    let reasonCode = verdict.verdict === "allow" ? "allowed" : verdict.verdict === "ask" ? "ask_required" : (verdict.action ? "forbidden" : verdict.reasons.some((r) => r.startsWith("cap ")) ? "cap_exceeded" : "no_permit");
    const reasons = [...verdict.reasons];

    // Belt and braces: whatever the policy said, a reservation that would break I-R5 on a capped budget is refused.
    if (finalVerdict !== "deny" && enforced) {
      for (const [t, w] of [[dayT, "day"], [monthT, "month"]] as const) {
        const lim = limits[w];
        if (lim !== null && t.spent + t.reserved + reserve > lim) {
          finalVerdict = "deny";
          reasonCode = "capacity";
          reasons.push(`capacity: ${w} spend ${t.spent} + reserved ${t.reserved} + this reservation ${reserve} exceeds the ${w} cap ${lim}`);
        }
      }
    }

    const digest = hashJson({ s: g.session_id, p: g.person, pr: g.project, a: g.agent, m: g.model, t: g.task_type, w: g.waste_rule, x: g.action, tool: g.tool, r: reserve, pv: view.version });

    // An owner approval, echoed back with its id, turns one `ask` into an allow. It never overrides a deny.
    if (finalVerdict === "ask" && g.approval_id !== null) {
      const ok = this.approvalValid(g.approval_id, digest);
      if (ok === true) {
        finalVerdict = "allow";
        reasonCode = "approved";
        reasons.push(`approved by the owner (approval ${g.approval_id})`);
      } else {
        reasons.push(ok);
      }
    }

    const standing = (refs: BudgetRef[]): BudgetStanding[] => refs.map((b) => standingOf(b, (b.window === "day" ? dayT : monthT).spent, (b.window === "day" ? dayT : monthT).reserved + (finalVerdict === "allow" ? reserve : 0)));

    if (!enforced) {
      const refs = this.budgetsFor(g.person, nowIso, limits, false);
      const d = this.writeAuthorized(g, key, budgetSet, view, refs, reserve, routedModel, [...reasons, `emergency switch open until ${bypass.expiresAt}`], [], null, "bypass", false, est.ok ? est.basis : {}, digest, standing(refs));
      this.ledger.append({ kind: "bypass_allowed", reservation_id: d.reservationId, idempotency_key: key, session_id: g.session_id, person: g.person, model: g.model, reason_code: "bypass", reason: `would have been ${verdict.verdict}: ${verdict.reasons.join("; ") || "no objection"}`, basis: { wouldBe: verdict.verdict } });
      return d;
    }

    if (finalVerdict === "allow") {
      const refs = this.budgetsFor(g.person, nowIso, limits, true);
      return this.writeAuthorized(g, key, budgetSet, view, refs, reserve, routedModel, reasons, verdict.matched, verdict.action ?? null, reasonCode, false, est.ok ? est.basis : {}, digest, standing(refs));
    }

    if (shadow) {
      this.ledger.append({
        kind: "shadow_would_deny",
        idempotency_key: key,
        session_id: g.session_id,
        person: g.person,
        project: g.project,
        agent: g.agent,
        model: g.model,
        tool: g.tool,
        amount_micros: reserve,
        reason_code: reasonCode,
        reason: reasons.join("; "),
        verdict: finalVerdict,
        policy_version: view.version,
        basis: { matched: verdict.matched, action: verdict.action ?? null },
      });
      const refs = this.budgetsFor(g.person, nowIso, limits, false);
      return this.writeAuthorized(g, key, budgetSet, view, refs, reserve, routedModel, [...reasons, "shadow mode: allowed, would have been " + finalVerdict], verdict.matched, verdict.action ?? null, `shadow_${reasonCode}`, true, est.ok ? est.basis : {}, digest, standing(refs));
    }

    if (finalVerdict === "ask") {
      const row = this.ledger.append({
        kind: "asked",
        idempotency_key: key,
        session_id: g.session_id,
        person: g.person,
        project: g.project,
        agent: g.agent,
        model: g.model,
        tool: g.tool,
        amount_micros: reserve,
        reason_code: reasonCode,
        reason: reasons.join("; "),
        verdict: "ask",
        policy_version: view.version,
        basis: { action_digest: digest, matched: verdict.matched },
      });
      this.trace.emit({ event: "desk.authorize", why: "rule", detail: { verdict: "ask", reasonCode, eventId: row.id, model: g.model, reservedMicros: reserve } });
      return {
        verdict: "ask", failed: false, shadow: false, reasonCode, reasons, matched: verdict.matched, action: null, reservationId: null, idempotencyKey: key,
        idempotent: false, reservedMicros: 0, expiresAt: null, routedModel, standing: standing(this.budgetsFor(g.person, nowIso, limits, true)), policyVersion: view.version,
        approvalRequest: { approval_request_id: row.id, action_digest: digest }, basis: {},
      };
    }

    // deny: recorded, not cached (a transient denial is not an authorization, so a retry is evaluated afresh)
    const row = this.ledger.append({
      kind: "denied",
      idempotency_key: key,
      session_id: g.session_id,
      person: g.person,
      project: g.project,
      agent: g.agent,
      model: g.model,
      tool: g.tool,
      amount_micros: reserve,
      reason_code: reasonCode,
      reason: reasons.join("; "),
      verdict: "deny",
      policy_version: view.version,
      basis: { matched: verdict.matched, action: verdict.action ?? null },
    });
    this.trace.emit({ event: "desk.authorize", why: "rule", detail: { verdict: "deny", reasonCode, eventId: row.id, model: g.model, reservedMicros: reserve, matched: verdict.matched } });
    return {
      verdict: "deny", failed: false, shadow: false, reasonCode, reasons, matched: verdict.matched, action: verdict.action ?? null, reservationId: null, idempotencyKey: key,
      idempotent: false, reservedMicros: 0, expiresAt: null, routedModel, standing: standing(this.budgetsFor(g.person, nowIso, limits, true)), policyVersion: view.version,
      approvalRequest: null, basis: {},
    };
  }

  private writeAuthorized(
    g: GateRequest, key: string, budgetSet: string, view: PolicyView, refs: BudgetRef[], reserve: Micros, routedModel: string,
    reasons: string[], matched: string[], action: string | null, reasonCode: string, shadow: boolean, estimateBasis: Record<string, unknown>, digest: string, standing: BudgetStanding[],
  ): GateDecision {
    const expiresAt = new Date(this.ledger.now() + this.ttl(g)).toISOString();
    const decision: GateDecision = {
      verdict: "allow", failed: false, shadow, reasonCode, reasons, matched, action, reservationId: null, idempotencyKey: key, idempotent: false,
      reservedMicros: reserve, expiresAt, routedModel, standing, policyVersion: view.version, approvalRequest: null, basis: estimateBasis,
    };
    const row = this.ledger.append({
      kind: "authorized",
      idempotency_key: key,
      budget_set: budgetSet,
      session_id: g.session_id,
      person: g.person,
      project: g.project,
      agent: g.agent,
      model: g.model,
      tool: g.tool,
      call_ref: g.call_ref,
      amount_micros: reserve,
      expires_at: expiresAt,
      reason_code: reasonCode,
      reason: reasons.join("; ") || "allowed",
      verdict: "allow",
      policy_version: view.version,
      approval_id: g.approval_id !== null && reasonCode === "approved" ? g.approval_id : null,
      basis: { decision: { ...decision, reservationId: null }, estimate: estimateBasis, action_digest: digest },
      budgets: refs,
    });
    decision.reservationId = row.id;
    this.trace.emit({ event: "desk.authorize", why: "rule", detail: { verdict: "allow", reasonCode, reservationId: row.id, reservedMicros: reserve, model: g.model, shadow, policyVersion: view.version } });
    return decision;
  }

  // ---- approvals (spec 10.3) --------------------------------------------------------------------------

  private approvalValid(approvalId: number, digest: string): true | string {
    const asked = this.ledger.event(approvalId);
    if (asked === undefined || asked.kind !== "asked") return `approval ${approvalId} is not an approval request`;
    const approved = this.cfg.db.prepare("SELECT * FROM gate_event WHERE kind = 'approved' AND approval_id = ? ORDER BY id LIMIT 1").get(approvalId) as unknown as GateEventRow | undefined;
    if (approved === undefined) return `approval ${approvalId} has not been granted`;
    const want = (JSON.parse(asked.basis) as { action_digest?: string }).action_digest;
    if (want !== digest) return `approval ${approvalId} was granted for a different action (digest mismatch)`;
    if (approved.expires_at !== null && approved.expires_at <= this.ledger.nowIso()) return `approval ${approvalId} has expired`;
    const used = this.cfg.db.prepare("SELECT id FROM gate_event WHERE kind = 'authorized' AND approval_id = ?").get(approvalId);
    if (used !== undefined) return `approval ${approvalId} was already used`;
    return true;
  }

  /** The owner grants an approval by echoing the request id and the action digest. Anything that does not match is refused. */
  approve(raw: unknown, approver: string): { approvalId: number; expiresAt: string } {
    const o = asObject(raw, "request");
    const id = optWhole(o, "approval_request_id", Number.MAX_SAFE_INTEGER);
    const digest = optStr(o, "action_digest");
    if (id === null || digest === null) throw new GateError("E_INVALID", "an approval must echo approval_request_id and action_digest", 400);
    return this.ledger.tx(() => {
      const asked = this.ledger.event(id);
      if (asked === undefined || asked.kind !== "asked") throw new GateError("E_APPROVAL", `no approval request ${id}`, 404);
      const want = (JSON.parse(asked.basis) as { action_digest?: string }).action_digest;
      if (want !== digest) throw new GateError("E_APPROVAL", "action_digest does not match the request; nothing was approved", 409);
      const age = this.ledger.now() - Date.parse(asked.ts);
      if (age > APPROVAL_TTL_MS) throw new GateError("E_APPROVAL", "the approval request has expired", 410);
      const already = this.cfg.db.prepare("SELECT id FROM gate_event WHERE kind = 'approved' AND approval_id = ?").get(id);
      if (already !== undefined) throw new GateError("E_APPROVAL", "that request was already approved", 409);
      const expiresAt = new Date(this.ledger.now() + APPROVAL_TTL_MS).toISOString();
      const row = this.ledger.append({
        kind: "approved", approval_id: id, person: asked.person, session_id: asked.session_id, expires_at: expiresAt,
        reason_code: "approved", reason: `approved by ${approver}`, basis: { approver, action_digest: digest },
      });
      this.trace.emit({ event: "desk.approve", why: "rule", detail: { approvalId: id, approver, eventId: row.id } });
      return { approvalId: id, expiresAt };
    });
  }

  // ---- settle and void -------------------------------------------------------------------------------

  settle(raw: unknown): SettleResult {
    return this.settleParsed(parseSettle(raw));
  }

  settleParsed(s: SettleInput): SettleResult {
    return this.ledger.tx(() => {
      this.ledger.expireDue();
      const view = this.reservationOf(s.reservation_id, s.idempotency_key);
      if (view.state === "voided") throw new GateError("E_ALREADY_CLOSED", `reservation ${view.id} was voided and cannot be settled`, 409);
      if (view.state === "settled" || view.state === "late_settled") {
        const prev = view.settled!;
        const total = prev.amount_micros + (view.overage?.amount_micros ?? 0);
        if (total === s.actual_micros) return { reservationId: view.id, state: view.state, settledMicros: prev.amount_micros, overageMicros: view.overage?.amount_micros ?? 0, late: view.state === "late_settled", idempotent: true, paused: this.isPaused(view.authorized.person ?? "") };
        throw new GateError("E_ALREADY_CLOSED", `reservation ${view.id} was already settled at ${total}; a second settle at ${s.actual_micros} is refused`, 409);
      }
      const reserved = view.authorized.amount_micros;
      const late = view.state === "expired";
      const settled = Math.min(s.actual_micros, reserved);
      const over = s.actual_micros - settled;
      const base = {
        reservation_id: view.id, idempotency_key: view.authorized.idempotency_key, budget_set: view.authorized.budget_set, session_id: view.authorized.session_id,
        person: view.authorized.person, project: view.authorized.project, agent: view.authorized.agent, model: view.authorized.model, call_ref: s.call_ref ?? view.authorized.call_ref,
        budgets: view.budgets,
      };
      this.ledger.append({ ...base, kind: "settled", amount_micros: settled, reason_code: late ? "late_settle" : "settled", reason: late ? "settled after the reservation expired (late settle)" : "settled", basis: { actual: s.actual_micros, reserved } });
      let paused = false;
      if (over > 0) {
        this.ledger.append({ ...base, kind: "overage", amount_micros: over, reason_code: "E_BUDGET_OVERSHOOT", reason: `actual ${s.actual_micros} exceeded the reservation ${reserved} by ${over}`, basis: { actual: s.actual_micros, reserved } });
        if (view.authorized.person !== null && !this.isPaused(view.authorized.person)) {
          this.ledger.append({ kind: "paused", person: view.authorized.person, reason_code: "E_BUDGET_OVERSHOOT", reason: `paused after an overshoot of ${over} on reservation ${view.id}`, basis: { reservation: view.id } });
        }
        paused = true;
        this.trace.emit({ event: "risk.flag", why: "computed", detail: { code: "E_BUDGET_OVERSHOOT", reservationId: view.id, overageMicros: over } });
      }
      this.trace.emit({ event: "desk.settle", why: "computed", detail: { reservationId: view.id, settledMicros: settled, overageMicros: over, late } });
      return { reservationId: view.id, state: late ? "late_settled" : "settled", settledMicros: settled, overageMicros: over, late, idempotent: false, paused };
    });
  }

  voidReservation(raw: unknown): VoidResult {
    return this.voidParsed(parseVoid(raw));
  }

  voidParsed(v: VoidInput): VoidResult {
    return this.ledger.tx(() => {
      this.ledger.expireDue();
      const view = this.reservationOf(v.reservation_id, v.idempotency_key);
      if (view.state === "voided") return { reservationId: view.id, state: "voided", idempotent: true };
      if (view.state !== "open") throw new GateError("E_ALREADY_CLOSED", `reservation ${view.id} is ${view.state} and cannot be voided`, 409);
      this.ledger.append({
        kind: "voided", reservation_id: view.id, idempotency_key: view.authorized.idempotency_key, budget_set: view.authorized.budget_set, session_id: view.authorized.session_id,
        person: view.authorized.person, amount_micros: view.authorized.amount_micros, reason_code: "voided", reason: "voided by the caller (the call did not happen)", budgets: view.budgets,
      });
      this.trace.emit({ event: "desk.settle", why: "computed", detail: { reservationId: view.id, voided: true } });
      return { reservationId: view.id, state: "voided", idempotent: false };
    });
  }

  private reservationOf(id: number | null, key: string | null): ReservationView {
    const view = this.ledger.findReservation({ ...(id !== null ? { id } : {}), ...(id === null && key !== null ? { key } : {}) });
    if (view === undefined) throw new GateError("E_UNKNOWN_RESERVATION", "no such reservation", 404);
    return view;
  }

  // ---- observed spend (tools that cannot ask first) --------------------------------------------------

  /**
   * Record spend that has already happened, read from a session transcript. Spend that does not fit under a
   * cap is recorded as the part that fits and an overage for the rest: it happened, so it is counted in full.
   * Each call is counted once, however many times the transcript is read.
   */
  observeCall(call: { callId: string; ts: string; model: string; micros: Micros; sessionId: string; person: string; project: string }): { recorded: boolean } {
    return this.ledger.tx(() => {
      const ref = `cc:${call.callId}`;
      const seen = this.cfg.db.prepare("SELECT id FROM gate_event WHERE kind = 'observed' AND call_ref = ?").get(ref);
      if (seen !== undefined) return { recorded: false };
      const view = this.policyView();
      const dayId = budgetId(call.person, "day", call.ts);
      const monthId = budgetId(call.person, "month", call.ts);
      const dayT = this.ledger.budgetTotals(dayId);
      const monthT = this.ledger.budgetTotals(monthId);
      const req = this.requestFor(
        { session_id: call.sessionId, person: call.person, project: call.project, agent: "agent:main", model: call.model, task_type: "code", waste_rule: "none", action: "call", tool: null, recoverable_micros: 0, idempotency_key: null, estimate_micros: null, input_tokens: null, max_tokens: null, n: 1, ttl_ms: null, call_ref: ref, approval_id: null },
        dayT.spent + dayT.reserved + call.micros,
        monthT.spent + monthT.reserved + call.micros,
      );
      const limits = this.limitsFor(view.policy, req);
      const refs = this.budgetsFor(call.person, call.ts, limits, true);
      let fits = call.micros;
      for (const [t, w] of [[dayT, "day"], [monthT, "month"]] as const) {
        const lim = limits[w];
        if (lim !== null) fits = Math.min(fits, Math.max(0, lim - t.spent - t.reserved));
      }
      const common = { idempotency_key: ref, session_id: call.sessionId, person: call.person, project: call.project, model: call.model, call_ref: ref, budgets: refs };
      this.ledger.append({ ...common, kind: "observed", amount_micros: fits, reason_code: "observed", reason: "spend read from the session transcript", basis: { callTs: call.ts, micros: call.micros } });
      if (fits < call.micros) {
        this.ledger.append({ ...common, kind: "overage", reservation_id: null, amount_micros: call.micros - fits, reason_code: "E_BUDGET_OVERSHOOT", reason: "observed spend above the cap", basis: { callTs: call.ts, micros: call.micros } });
        this.trace.emit({ event: "risk.flag", why: "computed", detail: { code: "E_BUDGET_OVERSHOOT", source: "transcript", overageMicros: call.micros - fits } });
      }
      return { recorded: true };
    });
  }

  /** Read what a session transcript has added since the last look and record it. Returns the last model seen. */
  observeTranscript(sessionId: string, path: string, person: string, project: string): { recordedCalls: number; unpricedCalls: number; lastModel: string | null; malformedLines: number } {
    const roots = this.cfg.transcriptRoots ?? [join(homedir(), ".claude", "projects")];
    const real = resolveTranscript(path, roots);
    const cur = this.cfg.db.prepare("SELECT * FROM gate_transcript WHERE session_id = ?").get(sessionId) as { path: string; offset_bytes: number; last_model: string | null } | undefined;
    const start = cur !== undefined && cur.path === real ? cur.offset_bytes : 0;
    const delta = readTranscriptDelta(real, start, this.cfg.prices);
    let recorded = 0;
    let unpriced = 0;
    const cutoff = this.ledger.now() - 40 * 86_400_000;
    for (const c of delta.calls) {
      if (Date.parse(c.ts) < cutoff || Number.isNaN(Date.parse(c.ts))) continue;
      if (c.micros === null) {
        unpriced += 1;
        continue;
      }
      if (this.observeCall({ callId: c.callId, ts: c.ts, model: c.model, micros: c.micros, sessionId, person, project }).recorded) recorded += 1;
    }
    const lastModel = delta.lastModel ?? cur?.last_model ?? null;
    this.cfg.db.prepare("INSERT INTO gate_transcript (session_id, path, offset_bytes, last_model) VALUES (?, ?, ?, ?) ON CONFLICT (session_id) DO UPDATE SET path = excluded.path, offset_bytes = excluded.offset_bytes, last_model = excluded.last_model").run(sessionId, real, delta.newOffset, lastModel);
    return { recordedCalls: recorded, unpricedCalls: unpriced, lastModel, malformedLines: delta.malformedLines };
  }

  // ---- tool-call idempotency guard (22.3) --------------------------------------------------------------

  /**
   * Begin a tool call that must not run twice. The key is SHA-256 over session, tool and the canonical
   * arguments. A key in flight is refused (409 for the HTTP door); a key completed within the TTL returns the
   * cached response and a zero-debit event. A database error here blocks the call: a mutating tool is never
   * run on a guard that could not be checked.
   */
  toolBegin(raw: unknown): ToolBeginResult {
    const o = asObject(raw, "request");
    const sessionId = str(o, "session_id");
    const toolName = str(o, "tool_name");
    const args = o["arguments"] ?? {};
    let canonical: string;
    try {
      canonical = canonicalJson(args);
    } catch {
      throw new GateError("E_INVALID", "arguments must be plain JSON", 400);
    }
    const argsHash = hashJson(args);
    const key = `tk_${hashJson({ s: sessionId, t: toolName, a: args }).slice(7, 55)}`;
    if (canonical.length > 65_536) throw new GateError("E_INVALID", "arguments are too large", 413);
    return this.ledger.tx(() => {
      const nowIso = this.ledger.nowIso();
      const row = this.cfg.db.prepare("SELECT * FROM gate_tool_key WHERE idempotency_key = ?").get(key) as
        | { status: "in_flight" | "completed" | "failed"; response_json: string | null; response_hash: string | null; expires_at: string }
        | undefined;
      if (row !== undefined && row.expires_at > nowIso) {
        if (row.status === "in_flight") {
          this.ledger.append({ kind: "idempotent_replayed", idempotency_key: key, session_id: sessionId, tool: toolName, reason_code: "idempotent_in_flight", reason: "duplicate suppressed: the same tool call is still running" });
          return { status: "in_flight", idempotencyKey: key, decision: null, cachedResponse: null, resultHash: null };
        }
        if (row.status === "completed") {
          this.ledger.append({ kind: "idempotent_replayed", idempotency_key: key, session_id: sessionId, tool: toolName, amount_micros: 0, reason_code: "idempotent_replayed", reason: "returned the cached response; zero debit" });
          return { status: "replayed", idempotencyKey: key, decision: null, cachedResponse: row.response_json === null ? null : JSON.parse(row.response_json), resultHash: row.response_hash };
        }
      }
      const reserveRaw = o["reserve"];
      let decision: GateDecision | null = null;
      if (reserveRaw !== undefined && reserveRaw !== null) {
        const r = asObject(reserveRaw, "reserve");
        decision = this.authorizeParsed(parseGateRequest({ session_id: sessionId, tool: toolName, ...r, idempotency_key: key }));
        if (decision.verdict !== "allow") return { status: "proceed", idempotencyKey: key, decision, cachedResponse: null, resultHash: null };
      }
      const expires = new Date(this.ledger.now() + TOOL_KEY_TTL_MS).toISOString();
      this.cfg.db
        .prepare(
          `INSERT INTO gate_tool_key (idempotency_key, session_id, tool_name, arguments_hash, reservation_id, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, 'in_flight', ?, ?)
           ON CONFLICT (idempotency_key) DO UPDATE SET status = 'in_flight', response_hash = NULL, response_json = NULL, reservation_id = excluded.reservation_id, created_at = excluded.created_at, expires_at = excluded.expires_at`,
        )
        .run(key, sessionId, toolName, argsHash, decision?.reservationId ?? null, nowIso, expires);
      return { status: "proceed", idempotencyKey: key, decision, cachedResponse: null, resultHash: null };
    });
  }

  toolComplete(raw: unknown): { idempotencyKey: string; status: "completed" | "failed"; resultHash: string | null } {
    const o = asObject(raw, "request");
    const key = str(o, "idempotency_key");
    const failed = o["failed"] === true;
    const response = o["response"] ?? null;
    let json: string;
    try {
      json = canonicalJson(response);
    } catch {
      throw new GateError("E_INVALID", "response must be plain JSON", 400);
    }
    if (json.length > 262_144) throw new GateError("E_INVALID", "response is too large to cache", 413);
    return this.ledger.tx(() => {
      const row = this.cfg.db.prepare("SELECT status FROM gate_tool_key WHERE idempotency_key = ?").get(key) as { status: string } | undefined;
      if (row === undefined) throw new GateError("E_UNKNOWN_KEY", "no tool call began under that key", 404);
      const status = failed ? "failed" : "completed";
      const hash = failed ? null : hashJson(response);
      this.cfg.db.prepare("UPDATE gate_tool_key SET status = ?, response_hash = ?, response_json = ? WHERE idempotency_key = ?").run(status, hash, failed ? null : json, key);
      return { idempotencyKey: key, status, resultHash: hash };
    });
  }

  // ---- hook (Claude Code PreToolUse) -------------------------------------------------------------------

  /**
   * Decide whether a tool call may start. Claude Code's PreToolUse hook runs before a tool, not before a
   * model call, so this reads the spend the session has logged so far, charges it to the day and month
   * budgets, and refuses the tool call when the person is at or over a cap. The model call that is already in
   * flight when the check runs is not covered; that bound is stated in the product, not hidden.
   */
  hookPreToolUse(raw: unknown): HookDecision {
    let input: Record<string, unknown>;
    try {
      input = asObject(raw, "hook input");
    } catch (error) {
      return { decision: "deny", reason: error instanceof Error ? error.message : String(error), failedClosed: true };
    }
    try {
      if (input["hook_event_name"] !== "PreToolUse") throw new GateError("E_INVALID", `this adapter handles PreToolUse, not ${String(input["hook_event_name"])}`);
      const sessionId = str(input, "session_id");
      const toolName = str(input, "tool_name");
      const cwd = typeof input["cwd"] === "string" ? (input["cwd"] as string) : null;
      const project = this.cfg.projectOf !== undefined ? this.cfg.projectOf(cwd) : cwd === null ? "unknown" : basename(cwd);
      const person = this.person;
      let lastModel: string | null = null;
      const tp = input["transcript_path"];
      if (typeof tp === "string" && tp.length > 0) {
        try {
          lastModel = this.observeTranscript(sessionId, tp, person, project).lastModel;
        } catch (error) {
          if (!(error instanceof GateError && error.code === "E_TRANSCRIPT_MISSING")) throw error;
        }
      }
      const model = lastModel ?? (this.cfg.db.prepare("SELECT last_model FROM gate_transcript WHERE session_id = ?").get(sessionId) as { last_model?: string | null } | undefined)?.last_model ?? "claude-unknown";
      const d = this.checkOnly(
        { session_id: sessionId, person, project, agent: "agent:main", model, task_type: "code", waste_rule: "none", action: "tool_call", tool: toolName, recoverable_micros: 0, idempotency_key: null, estimate_micros: this.cfg.hookProbeMicros ?? 1, input_tokens: null, max_tokens: null, n: 1, ttl_ms: null, call_ref: null, approval_id: null },
      );
      if (d.verdict === "allow") return { decision: "allow", reason: d.reasons.join("; ") || "allowed", failedClosed: false };
      const stop = d.action === "pause_with_checkpoint" ? " Finish the current step, write a short handoff (what is done, what is open, the branch) and stop." : "";
      return { decision: d.verdict, reason: `Desk gate: ${d.reasons.join("; ") || d.reasonCode}.${stop}`, failedClosed: d.failed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { decision: "deny", reason: `Desk gate could not decide and is blocking as a precaution: ${message}`, failedClosed: true };
    }
  }

  /** Evaluate a request without reserving anything. Denials and asks are recorded; an allow writes nothing. */
  checkOnly(g: GateRequest): GateDecision {
    return this.ledger.tx(() => {
      this.ledger.expireDue();
      const nowIso = this.ledger.nowIso();
      const key = derivedKey(g, Math.floor(this.ledger.now() / 1000));
      let view: PolicyView;
      try {
        view = this.policyView();
      } catch (error) {
        return this.denyEarly(g, "policy_unavailable", error instanceof Error ? error.message : String(error), true, null, key);
      }
      const bypass = this.bypassOpen();
      if (bypass.open) {
        this.ledger.append({ kind: "bypass_allowed", session_id: g.session_id, person: g.person, tool: g.tool, reason_code: "bypass", reason: `emergency switch open until ${bypass.expiresAt}` });
        return { verdict: "allow", failed: false, shadow: false, reasonCode: "bypass", reasons: [`emergency switch open until ${bypass.expiresAt}`], matched: [], action: null, reservationId: null, idempotencyKey: key, idempotent: false, reservedMicros: 0, expiresAt: null, routedModel: g.model, standing: [], policyVersion: view.version, approvalRequest: null, basis: {} };
      }
      if (this.isPaused(g.person)) return this.denyEarly(g, "paused", `${g.person} is paused after a budget overshoot; the owner must resume them`, false, view.version, key);
      const dayT = this.ledger.budgetTotals(budgetId(g.person, "day", nowIso));
      const monthT = this.ledger.budgetTotals(budgetId(g.person, "month", nowIso));
      const probe = g.estimate_micros ?? 1;
      const preq = this.requestFor(g, dayT.spent + dayT.reserved + probe, monthT.spent + monthT.reserved + probe);
      const verdict = evaluate(view.policy, preq);
      const limits = this.limitsFor(view.policy, preq);
      const refs = this.budgetsFor(g.person, nowIso, limits, true);
      const standing = refs.map((b) => standingOf(b, (b.window === "day" ? dayT : monthT).spent, (b.window === "day" ? dayT : monthT).reserved));
      const reasonCode = verdict.verdict === "allow" ? "allowed" : verdict.verdict === "ask" ? "ask_required" : verdict.action ? "forbidden" : verdict.reasons.some((r) => r.startsWith("cap ")) ? "cap_exceeded" : "no_permit";
      const base: GateDecision = {
        verdict: verdict.verdict, failed: false, shadow: false, reasonCode, reasons: verdict.reasons, matched: verdict.matched, action: verdict.action ?? null, reservationId: null,
        idempotencyKey: key, idempotent: false, reservedMicros: 0, expiresAt: null, routedModel: routeOf(view.policy, preq), standing, policyVersion: view.version, approvalRequest: null, basis: {},
      };
      if (verdict.verdict === "allow") return base;
      if (this.mode() === "shadow") {
        this.ledger.append({ kind: "shadow_would_deny", session_id: g.session_id, person: g.person, project: g.project, model: g.model, tool: g.tool, reason_code: reasonCode, reason: verdict.reasons.join("; "), verdict: verdict.verdict, policy_version: view.version, basis: { matched: verdict.matched } });
        return { ...base, verdict: "allow", shadow: true, reasons: [...verdict.reasons, `shadow mode: allowed, would have been ${verdict.verdict}`] };
      }
      this.ledger.append({
        kind: verdict.verdict === "ask" ? "asked" : "denied", session_id: g.session_id, person: g.person, project: g.project, agent: g.agent, model: g.model, tool: g.tool, reason_code: reasonCode,
        reason: verdict.reasons.join("; "), verdict: verdict.verdict, policy_version: view.version, basis: { matched: verdict.matched, action: verdict.action ?? null, action_digest: hashJson({ s: g.session_id, t: g.tool, pv: view.version }) },
      });
      this.trace.emit({ event: "desk.authorize", why: "rule", detail: { verdict: verdict.verdict, reasonCode, surface: "hook", tool: g.tool } });
      return base;
    });
  }

  integrity() {
    // Expiry is written lazily, on the next write. Sweep first, so a reservation whose time ran out while nothing
    // else happened is recorded as expired rather than reported as an authorization that is still counted.
    this.ledger.expireDue();
    return this.ledger.integrity();
  }
}

function safeUser(): string {
  try {
    return userInfo().username || "owner";
  } catch {
    return "owner";
  }
}
