import { parse as parseYaml } from "yaml";

import { FINITE_DIMS, NUMERIC_DIMS, type Approval, type Cap, type Condition, type FiniteDim, type Interval, type NumericDim, type Policy, type Rule } from "./types.ts";

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new PolicyError(`${what} must be a mapping`);
  return v as Record<string, unknown>;
}

function str(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0) throw new PolicyError(`${what} must be a non-empty string`);
  return v;
}

/** Parse a decimal dollar string such as "40.00" into integer micro-dollars without floating point. */
export function usdToMicros(value: unknown, what: string): number {
  if (typeof value !== "string" && typeof value !== "number") throw new PolicyError(`${what} must be a dollar amount`);
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(value).trim());
  if (!m) throw new PolicyError(`${what}: "${String(value)}" is not a dollar amount with up to six decimals`);
  const micros = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
  if (!Number.isSafeInteger(micros)) throw new PolicyError(`${what}: amount is too large`);
  return micros;
}

function parseInterval(v: unknown, dim: NumericDim): Interval {
  const o = obj(v, `condition ${dim}`);
  const interval: Interval = { lo: -Infinity, loOpen: true, hi: Infinity, hiOpen: true };
  const num = (x: unknown): number => (dim.endsWith("_micros") ? usdToMicros(x, `condition ${dim}`) : Number(x));
  for (const [k, x] of Object.entries(o)) {
    if (k === "gt") Object.assign(interval, { lo: num(x), loOpen: true });
    else if (k === "gte") Object.assign(interval, { lo: num(x), loOpen: false });
    else if (k === "lt") Object.assign(interval, { hi: num(x), hiOpen: true });
    else if (k === "lte") Object.assign(interval, { hi: num(x), hiOpen: false });
    else throw new PolicyError(`condition ${dim}: unknown comparison "${k}" (use gt, gte, lt, lte)`);
  }
  return interval;
}

function parseCondition(raw: unknown, scopes: ReadonlyMap<string, readonly string[]>, what: string): Condition {
  const o = obj(raw ?? {}, `${what} when`);
  const cond: Condition = { finite: {}, numeric: {} };
  for (const [key, value] of Object.entries(o)) {
    if (key === "scope") {
      const id = str(value, `${what} scope`);
      const members = scopes.get(id);
      if (!members) throw new PolicyError(`${what}: unknown scope "${id}"`);
      cond.finite.project = intersect(cond.finite.project, members);
    } else if ((FINITE_DIMS as readonly string[]).includes(key)) {
      const set = obj(value, `${what} ${key}`)["in"];
      if (!Array.isArray(set) || set.length === 0 || set.some((x) => typeof x !== "string")) throw new PolicyError(`${what}: ${key} needs "in: [non-empty list of strings]"`);
      cond.finite[key as FiniteDim] = intersect(cond.finite[key as FiniteDim], set as string[]);
    } else if (key === "recoverable_usd") {
      cond.numeric.recoverable_micros = parseInterval(value, "recoverable_micros");
    } else if ((NUMERIC_DIMS as readonly string[]).includes(key)) {
      cond.numeric[key as NumericDim] = parseInterval(value, key as NumericDim);
    } else {
      throw new PolicyError(`${what}: unknown condition "${key}"`);
    }
  }
  return cond;
}

function intersect(a: readonly string[] | undefined, b: readonly string[]): readonly string[] {
  return a === undefined ? [...b] : a.filter((x) => b.includes(x));
}

function parseCap(raw: unknown, what: string): Cap {
  const o = obj(raw, `${what} cap`);
  const window = o["window"];
  if (window !== "day" && window !== "month") throw new PolicyError(`${what}: cap window must be day or month`);
  const warnAt = o["warn_at"] === undefined ? 0.5 : Number(o["warn_at"]);
  const askAt = o["ask_at"] === undefined ? 0.8 : Number(o["ask_at"]);
  if (!(warnAt > 0 && warnAt <= askAt && askAt <= 1)) throw new PolicyError(`${what}: need 0 < warn_at <= ask_at <= 1`);
  return { window, maxMicros: usdToMicros(o["max_usd"], `${what} max_usd`), warnAt, askAt };
}

export function parsePolicy(raw: unknown): Policy {
  const o = obj(raw, "policy");
  const version = Number(o["version"]);
  if (!Number.isInteger(version) || version < 1) throw new PolicyError("policy version must be a positive integer");
  const scopes = new Map<string, readonly string[]>();
  for (const s of (o["scopes"] as unknown[] | undefined) ?? []) {
    const so = obj(s, "scope");
    const match = obj(so["match"], "scope match");
    const projects = match["project"];
    if (!Array.isArray(projects) || projects.some((p) => typeof p !== "string")) throw new PolicyError("scope match needs a project list");
    scopes.set(str(so["id"], "scope id"), projects as string[]);
  }
  const ids = new Set<string>();
  const rules: Rule[] = [];
  for (const r of (o["rules"] as unknown[] | undefined) ?? []) {
    const ro = obj(r, "rule");
    const id = str(ro["id"], "rule id");
    if (ids.has(id)) throw new PolicyError(`duplicate rule id "${id}"`);
    ids.add(id);
    const when = parseCondition(ro["when"], scopes, `rule ${id}`);
    const kind = ro["kind"];
    if (kind === "permit") rules.push({ id, kind, when, ...(ro["cap"] !== undefined ? { cap: parseCap(ro["cap"], `rule ${id}`) } : {}) });
    else if (kind === "forbid") rules.push({ id, kind, when, action: str(ro["action"] ?? "deny", `rule ${id} action`) });
    else if (kind === "route") {
      const route = obj(ro["route"], `rule ${id} route`);
      const map = obj(route["model_map"], `rule ${id} model_map`);
      const modelMap: Record<string, string> = {};
      for (const [from, to] of Object.entries(map)) modelMap[from] = str(to, `rule ${id} model_map target`);
      rules.push({ id, kind, when, modelMap });
    } else throw new PolicyError(`rule ${id}: kind must be permit, forbid or route`);
  }
  const approvals: Approval[] = [];
  for (const a of (o["approvals"] as unknown[] | undefined) ?? []) {
    const ao = obj(a, "approval");
    const approvers = ao["approvers"];
    if (!Array.isArray(approvers) || approvers.length === 0) throw new PolicyError("approval needs approvers");
    approvals.push({ when: parseCondition(ao["when"], scopes, "approval"), approvers: approvers as string[] });
  }
  return { version, rules, approvals };
}

export function parsePolicyYaml(text: string): Policy {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new PolicyError(`policy is not valid YAML: ${(e as Error).message}`);
  }
  return parsePolicy(raw);
}
