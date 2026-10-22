import { DatabaseSync } from "node:sqlite";

import { MemoryTrace } from "../../../src/desk/agents/trace.ts";
import { Gate, type GateConfig } from "../../../src/desk/gate/gate.ts";
import { fixedPolicy, type PolicySource } from "../../../src/desk/gate/policy-source.ts";
import { parsePolicyYaml } from "../../../src/desk/policy/parse.ts";
import { testSnapshot } from "../helpers.ts";

export const T0 = Date.parse("2026-10-22T09:00:00.000Z");

export const POLICY_YAML = `
version: 1
rules:
  - id: allow-claude
    kind: permit
    when: { model: { in: ["claude-*"] } }
    cap: { window: day, max_usd: "10.00", warn_at: 0.5, ask_at: 0.8 }
  - id: month-cap
    kind: permit
    when: { model: { in: ["claude-*"] } }
    cap: { window: month, max_usd: "100.00", warn_at: 0.5, ask_at: 0.9 }
  - id: stop-loops
    kind: forbid
    when: { waste_rule: { in: ["C-LOOP-1"] }, recoverable_usd: { gt: "2.00" } }
    action: pause_with_checkpoint
  - id: route-docs
    kind: route
    when: { task_type: { in: ["docs"] } }
    route: { model_map: { "claude-opus-5": "claude-sonnet-5-5" } }
approvals:
  - when: { action: { in: ["cap.raise"] } }
    approvers: ["owner"]
`;

export interface Clock {
  ms: number;
  now: () => number;
  advance(ms: number): void;
}

export function clock(start = T0): Clock {
  const c: Clock = {
    ms: start,
    now: () => c.ms,
    advance(ms: number) {
      c.ms += ms;
    },
  };
  return c;
}

export interface Rig {
  gate: Gate;
  db: DatabaseSync;
  clock: Clock;
  trace: MemoryTrace;
}

export function rig(over: Partial<GateConfig> & { policyYaml?: string; policy?: PolicySource } = {}): Rig {
  const c = clock();
  const db = over.db ?? new DatabaseSync(":memory:");
  const trace = new MemoryTrace();
  const { policyYaml, policy, ...rest } = over;
  const gate = new Gate({
    db,
    prices: testSnapshot(),
    policy: policy ?? fixedPolicy(parsePolicyYaml(policyYaml ?? POLICY_YAML)),
    now: c.now,
    person: "p-1",
    trace,
    ownerKey: "owner-key-for-tests-0123456789",
    ...rest,
  });
  return { gate, db, clock: c, trace };
}

/** An authorize request for the test person on opus; 100,000 output tokens reserve $2.50. */
export function call(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { session_id: "s-1", person: "p-1", project: "repo:acme/api", model: "claude-opus-5", input_tokens: 0, max_tokens: 100_000, ...over };
}

export const USD = (n: number): number => Math.round(n * 1_000_000);

/** A small seeded generator, so a failing random run can be replayed. */
export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
