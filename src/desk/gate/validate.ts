import { canonicalJson, sha256Hex } from "../../runtime/canonical.ts";
import { MAX_INPUT_TOKENS } from "./estimate.ts";
import { GateError, type GateRequest } from "./types.ts";

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** One billion dollars in micros: a larger amount is a mistake or an attack, and is refused. */
export const MAX_MICROS = 1_000_000_000_000_000;

function obj(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new GateError("E_INVALID", `${what} must be a JSON object`);
  return raw as Record<string, unknown>;
}

export function str(o: Record<string, unknown>, key: string, fallback?: string): string {
  const v = o[key];
  if (v === undefined || v === null) {
    if (fallback !== undefined) return fallback;
    throw new GateError("E_INVALID", `${key} is required`);
  }
  if (typeof v !== "string" || v.length === 0 || v.length > 256 || CONTROL.test(v)) {
    throw new GateError("E_INVALID", `${key} must be a non-empty string of at most 256 characters with no control characters`);
  }
  return v;
}

function optStr(o: Record<string, unknown>, key: string): string | null {
  return o[key] === undefined || o[key] === null ? null : str(o, key);
}

/** A whole, non-negative, safe number. A float, NaN, a string, a negative or an oversized value is refused, never rounded. */
export function wholeNumber(o: Record<string, unknown>, key: string, max: number): number {
  const v = o[key];
  if (v === undefined || v === null) throw new GateError("E_INVALID", `${key} is required`);
  return checkWhole(v, key, max);
}

function checkWhole(v: unknown, key: string, max: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > max) {
    throw new GateError("E_INVALID", `${key} must be a whole number from 0 to ${max}`);
  }
  return v;
}

function optWhole(o: Record<string, unknown>, key: string, max: number): number | null {
  const v = o[key];
  return v === undefined || v === null ? null : checkWhole(v, key, max);
}

/** Read and check an authorize request. Unknown fields are ignored; every known field is checked. */
export function parseGateRequest(raw: unknown): GateRequest {
  const o = obj(raw, "request");
  const n = optWhole(o, "n", 64) ?? 1;
  if (n < 1) throw new GateError("E_INVALID", "n must be at least 1");
  return {
    session_id: str(o, "session_id"),
    person: str(o, "person"),
    project: str(o, "project", "unknown"),
    agent: str(o, "agent", "agent:main"),
    model: str(o, "model"),
    task_type: str(o, "task_type", "code"),
    waste_rule: str(o, "waste_rule", "none"),
    action: str(o, "action", "call"),
    tool: optStr(o, "tool"),
    recoverable_micros: optWhole(o, "recoverable_micros", MAX_MICROS) ?? 0,
    idempotency_key: optStr(o, "idempotency_key"),
    estimate_micros: optWhole(o, "estimate_micros", MAX_MICROS),
    input_tokens: optWhole(o, "input_tokens", MAX_INPUT_TOKENS),
    max_tokens: optWhole(o, "max_tokens", Number.MAX_SAFE_INTEGER),
    n,
    ttl_ms: optWhole(o, "ttl_ms", 86_400_000),
    call_ref: optStr(o, "call_ref"),
    approval_id: optWhole(o, "approval_id", Number.MAX_SAFE_INTEGER),
  };
}

export interface SettleInput {
  reservation_id: number | null;
  idempotency_key: string | null;
  actual_micros: number;
  call_ref: string | null;
}

export function parseSettle(raw: unknown): SettleInput {
  const o = obj(raw, "request");
  const reservation_id = optWhole(o, "reservation_id", Number.MAX_SAFE_INTEGER);
  const idempotency_key = optStr(o, "idempotency_key");
  if (reservation_id === null && idempotency_key === null) throw new GateError("E_INVALID", "name the reservation: reservation_id or idempotency_key");
  return { reservation_id, idempotency_key, actual_micros: wholeNumber(o, "actual_micros", MAX_MICROS), call_ref: optStr(o, "call_ref") };
}

export interface VoidInput {
  reservation_id: number | null;
  idempotency_key: string | null;
}

export function parseVoid(raw: unknown): VoidInput {
  const o = obj(raw, "request");
  const reservation_id = optWhole(o, "reservation_id", Number.MAX_SAFE_INTEGER);
  const idempotency_key = optStr(o, "idempotency_key");
  if (reservation_id === null && idempotency_key === null) throw new GateError("E_INVALID", "name the reservation: reservation_id or idempotency_key");
  return { reservation_id, idempotency_key };
}

/** The key a call gets when its caller supplies none: the same request always yields the same key (spec 10.5). */
export function derivedKey(req: GateRequest, attempt = 0): string {
  const material = { s: req.session_id, p: req.person, m: req.model, a: req.action, t: req.tool, i: req.input_tokens, x: req.max_tokens, n: req.n, e: req.estimate_micros, c: req.call_ref, attempt };
  return `k_${sha256Hex(canonicalJson(material)).slice(0, 40)}`;
}

export { obj as asObject, optStr, optWhole };
