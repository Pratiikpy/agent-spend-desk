import type { ToolStep } from "./types.ts";

/**
 * The capability graph (specification section 7). An intent names abstract capabilities (`world.query`, `memory.recall`, `email.send`); the graph maps each to a concrete tool at the
 * moment of the decision, so that a tool can be swapped without touching an intent. Selection rules, in priority order: drop tools the user is not permitted to use; drop tools that
 * are offline; prefer the surface's kind of tool; take the cheapest that meets the latency target; prefer a local tool to a remote one.
 *
 * Scout never makes a tool up. A capability with no registered tool, or whose every tool is filtered out, is a typed error, and the decision either degrades or is re-planned.
 */
export interface ToolRegistration {
  capability: string;
  toolId: string;
  /** Called on every decision: an unavailable tool drops out by itself. */
  availability?: () => boolean;
  requiredPermissions?: string[];
  cost?: { perCall: number };
  latency?: { p95Ms: number };
  /** Surfaces this tool is the natural choice for ("chat" prefers conversational tools, "inbox" prefers email-first). */
  surfaces?: string[];
  local?: boolean;
}

export type Unresolved = { kind: "unresolvable-capability" | "permission" | "unavailable"; capability: string; detail: string };

export interface ResolveContext {
  permissions: ReadonlySet<string>;
  surface: string;
  latencyBudgetMs?: number;
  /** Tools to leave out, by id: what a re-plan is told is no longer working. */
  exclude?: ReadonlySet<string>;
}

/** Families group capabilities so that a policy can reason about a class of behaviour: this user may only read. */
export function familyOf(capability: string): "read" | "write" | "reason" | "act" | "other" {
  if (/^(?:world\.query|memory\.recall|file\.read|crm\.read|ledger\.|metrics\.read|report\.read|usage\.read)/.test(capability)) return "read";
  if (/^(?:world\.assert|memory\.commit|file\.write|policy\.|ledger\.write)/.test(capability)) return "write";
  if (/^(?:swarm\.run|markovian\.chain|reason\.)/.test(capability)) return "reason";
  if (/^(?:email\.|calendar\.|slack\.|approval\.|action\.|spend\.|deploy\.)/.test(capability)) return "act";
  return "other";
}

export class CapabilityGraph {
  private readonly tools = new Map<string, ToolRegistration[]>();
  private readonly needs = new Map<string, string[]>();

  register(r: ToolRegistration): this {
    this.tools.set(r.capability, [...(this.tools.get(r.capability) ?? []), r]);
    return this;
  }

  /** `swarm.run` needs `memory.recall` and `markovian.chain`: a capability can be composed of others. */
  dependsOn(capability: string, needs: readonly string[]): this {
    this.needs.set(capability, [...needs]);
    return this;
  }

  /** The capabilities an intent reaches, transitively, in a stable order. */
  closure(capabilities: readonly string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const visit = (c: string, path: readonly string[]): void => {
      if (seen.has(c) || path.includes(c)) return;
      seen.add(c);
      out.push(c);
      for (const n of this.needs.get(c) ?? []) visit(n, [...path, c]);
    };
    for (const c of capabilities) visit(c, []);
    return out;
  }

  registered(capability: string): readonly ToolRegistration[] {
    return this.tools.get(capability) ?? [];
  }

  knownToolIds(): Set<string> {
    return new Set([...this.tools.values()].flat().map((t) => t.toolId.toLowerCase()));
  }

  resolve(capability: string, ctx: ResolveContext): { ok: true; tool: ToolRegistration } | ({ ok: false } & Unresolved) {
    const all = this.registered(capability);
    if (all.length === 0) return { ok: false, kind: "unresolvable-capability", capability, detail: `no tool is registered for ${capability}` };
    const holds = (p: string): boolean => ctx.permissions.has("*") || ctx.permissions.has(p);
    const permitted = all.filter((t) => (t.requiredPermissions ?? []).every(holds));
    if (permitted.length === 0) return { ok: false, kind: "permission", capability, detail: `every tool for ${capability} needs a permission this user does not hold (${[...new Set(all.flatMap((t) => t.requiredPermissions ?? []))].join(", ")})` };
    const live = permitted.filter((t) => !ctx.exclude?.has(t.toolId) && (t.availability ? t.availability() : true));
    if (live.length === 0) return { ok: false, kind: "unavailable", capability, detail: `every permitted tool for ${capability} is offline or rate-limited` };
    const fitsLatency = ctx.latencyBudgetMs === undefined ? live : live.filter((t) => (t.latency?.p95Ms ?? 0) <= (ctx.latencyBudgetMs as number));
    const pool = fitsLatency.length > 0 ? fitsLatency : live;
    const preferred = pool.filter((t) => t.surfaces?.includes(ctx.surface));
    const choose = (preferred.length > 0 ? preferred : pool).slice().sort((a, b) => (a.cost?.perCall ?? 0) - (b.cost?.perCall ?? 0) || Number(b.local ?? false) - Number(a.local ?? false) || a.toolId.localeCompare(b.toolId));
    return { ok: true, tool: choose[0] as ToolRegistration };
  }

  /** The ordered tool plan for a set of capabilities, or the first one that cannot be resolved. */
  plan(capabilities: readonly string[], ctx: ResolveContext, input: Record<string, unknown>): { ok: true; steps: ToolStep[]; capabilities: string[] } | ({ ok: false; resolved: ToolStep[] } & Unresolved) {
    const all = this.closure(capabilities);
    const steps: ToolStep[] = [];
    for (const c of all) {
      const r = this.resolve(c, ctx);
      if (!r.ok) return { ...r, resolved: steps };
      steps.push({ capability: c, tool: r.tool.toolId, input });
    }
    return { ok: true, steps, capabilities: all };
  }

  /** Can this intent run end to end for this user in this session: the resolved plan, or the first missing capability. */
  canRun(capabilities: readonly string[], ctx: ResolveContext): { runnable: boolean; plan: ToolStep[]; blocked?: Unresolved } {
    const p = this.plan(capabilities, ctx, {});
    return p.ok ? { runnable: true, plan: p.steps } : { runnable: false, plan: p.resolved, blocked: { kind: p.kind, capability: p.capability, detail: p.detail } };
  }
}

/**
 * The tools the Meterless engines are reached by, as the specification names them. A deployment that wants other tools passes its own graph; with none, these let a registry written
 * in the specification's vocabulary produce plans. Each is local-first. They are bindings to names, not clients.
 */
export function defaultGraph(): CapabilityGraph {
  const g = new CapabilityGraph();
  const local = (capability: string, toolId: string, p95Ms = 40): void => void g.register({ capability, toolId, local: true, cost: { perCall: 0 }, latency: { p95Ms } });
  local("world.query", "meterless.world-model.graph");
  local("world.assert", "meterless.world-model.assert");
  local("memory.recall", "meterless.hmem.retrieve");
  local("memory.commit", "meterless.hmem.commit");
  local("markovian.chain", "meterless.markovian.chain", 2000);
  local("swarm.run", "meterless.swarm.execute", 5000);
  local("approval.require", "scout.approval");
  g.register({ capability: "email.draft", toolId: "mail.draft", local: true, cost: { perCall: 0 }, latency: { p95Ms: 300 }, surfaces: ["chat", "inbox"] });
  g.register({ capability: "email.send", toolId: "smtp.send", cost: { perCall: 0 }, latency: { p95Ms: 800 }, surfaces: ["inbox"] });
  g.register({ capability: "calendar.create", toolId: "calendar.create", cost: { perCall: 0 }, latency: { p95Ms: 500 } });
  g.dependsOn("swarm.run", ["memory.recall", "markovian.chain"]);
  return g;
}
