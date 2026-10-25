import type { ModelProfile, ModelProfileRef, RiskClass } from "./types.ts";

/**
 * Model routing (specification section 8.1). A model profile declares a model with its limits and cost; the router picks one per task. Rules, in order: the profile must support
 * the capabilities the task needs, must be cleared for the data class of the input, and must fit the context; then the cost and latency budgets choose among what is left, a
 * high-risk intent preferring the more capable; a profile cleared only for public data is never a fallback for confidential data; local profiles win when the data is confidential or
 * restricted. A cost ceiling that no profile fits is a typed error, not a silent choice of the cheapest.
 */
export type DataClass = "public" | "internal" | "confidential" | "restricted";

export const DEFAULT_PROFILES: readonly ModelProfile[] = [
  { id: "local-fast", provider: "local", model: "small-instruct", context: 8_000, cost: { in: 0, out: 0 }, latency: { p95Ms: 1200 }, capabilities: ["text"], dataClasses: ["public", "internal", "confidential", "restricted"], fallbacks: ["local-capable"], local: true },
  { id: "local-capable", provider: "local", model: "capable-instruct", context: 32_000, cost: { in: 0, out: 0 }, latency: { p95Ms: 4000 }, capabilities: ["text", "json-mode", "function-calling"], dataClasses: ["public", "internal", "confidential", "restricted"], fallbacks: ["remote-fast"], local: true },
  { id: "remote-fast", provider: "remote", model: "fast", context: 128_000, cost: { in: 0.0001, out: 0.0004 }, latency: { p95Ms: 800 }, capabilities: ["text", "function-calling", "json-mode"], dataClasses: ["public"], fallbacks: ["remote-capable"] },
  { id: "remote-capable", provider: "remote", model: "capable", context: 200_000, cost: { in: 0.003, out: 0.015 }, latency: { p95Ms: 3000 }, capabilities: ["text", "function-calling", "json-mode", "vision"], dataClasses: ["public", "internal"] },
];

export interface RouteRequest {
  needs?: readonly string[];
  dataClass: DataClass;
  contextTokens?: number;
  riskClass: RiskClass;
  maxCostPerCall?: number;
  maxLatencyMs?: number;
  routing?: "local-first" | "cloud-first";
}

export type RouteResult = { ok: true; profile: ModelProfile; ref: ModelProfileRef; chain: string[] } | { ok: false; kind: "no-profile" | "cost-ceiling"; detail: string };

export const dataClassOf = (redactionKinds: readonly string[]): DataClass => {
  if (redactionKinds.some((k) => ["credential", "card", "ssn", "health", "iban"].includes(k))) return "restricted";
  if (redactionKinds.some((k) => ["email", "phone"].includes(k))) return "confidential";
  return "public";
};

export class ModelRouter {
  private readonly byId: ReadonlyMap<string, ModelProfile>;
  constructor(readonly profiles: readonly ModelProfile[] = DEFAULT_PROFILES) {
    this.byId = new Map(profiles.map((p) => [p.id, p]));
  }

  private cleared(p: ModelProfile, dc: DataClass): boolean {
    return p.dataClasses.includes(dc);
  }

  route(r: RouteRequest): RouteResult {
    const needs = r.needs ?? ["text"];
    const eligible = this.profiles.filter((p) => needs.every((n) => p.capabilities.includes(n)) && this.cleared(p, r.dataClass) && (r.contextTokens === undefined || p.context >= r.contextTokens));
    if (eligible.length === 0) return { ok: false, kind: "no-profile", detail: `no profile supports ${needs.join(", ")} for ${r.dataClass} data${r.contextTokens ? ` at ${r.contextTokens} tokens` : ""}` };
    const sensitive = r.dataClass === "confidential" || r.dataClass === "restricted";
    const within = eligible.filter((p) => (r.maxLatencyMs === undefined || p.latency.p95Ms <= r.maxLatencyMs) && (r.maxCostPerCall === undefined || p.cost.in + p.cost.out <= r.maxCostPerCall));
    if (within.length === 0) return { ok: false, kind: "cost-ceiling", detail: "every eligible profile is over the cost or latency ceiling" };
    const localFirst = (r.routing ?? "local-first") === "local-first";
    const quality = (p: ModelProfile): number => p.cost.in + p.cost.out + p.context / 1e6;
    const sorted = within.slice().sort((a, b) => {
      const local = Number(b.local ?? false) - Number(a.local ?? false);
      if (sensitive && local !== 0) return local;
      if (r.riskClass === "high") return quality(b) - quality(a) || a.id.localeCompare(b.id);
      if (localFirst && local !== 0) return local;
      return a.cost.in + a.cost.out - (b.cost.in + b.cost.out) || a.latency.p95Ms - b.latency.p95Ms || a.id.localeCompare(b.id);
    });
    const pick = sorted[0] as ModelProfile;
    // The chain of fallbacks the profile declares, each one cleared for the same data class and no one twice.
    const chain: string[] = [pick.id];
    for (let next = pick.fallbacks?.[0], guard = 0; next !== undefined && guard < 8; guard += 1) {
      const p = this.byId.get(next);
      if (!p || chain.includes(p.id) || !this.cleared(p, r.dataClass)) break;
      chain.push(p.id);
      next = p.fallbacks?.[0];
    }
    return { ok: true, profile: pick, ref: { id: pick.id, provider: pick.provider, model: pick.model, local: pick.local ?? false }, chain };
  }
}
