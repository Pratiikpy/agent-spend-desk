import { describe, expect, it } from "vitest";

import { evaluate, globMatch, routeOf } from "../../src/desk/policy/evaluate.ts";
import { parsePolicy, parsePolicyYaml, PolicyError, usdToMicros } from "../../src/desk/policy/parse.ts";
import { describeWidening, OTHER, restrictCheck } from "../../src/desk/policy/restrict.ts";
import { VERDICT_ORDER, type Policy, type Request } from "../../src/desk/policy/types.ts";

const req = (over: Partial<Request> = {}): Request => ({
  project: "repo:acme/api", person: "p-1", agent: "agent:main", model: "claude-opus-5", task_type: "code", waste_rule: "none", action: "call",
  recoverable_micros: 0, day_spend_after_micros: 0, month_spend_after_micros: 0, ...over,
});

const BASE = `
version: 3
scopes:
  - id: team
    match: { project: ["repo:acme/api", "repo:acme/web"] }
rules:
  - id: daily-cap
    kind: permit
    when: { scope: team, model: { in: ["claude-*"] } }
    cap: { window: day, max_usd: "40.00", warn_at: 0.5, ask_at: 0.8 }
  - id: loop-stop
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
const base = (): Policy => parsePolicyYaml(BASE);
const withRules = (p: Policy, rules: Policy["rules"]): Policy => ({ ...p, rules });

describe("policy parsing", () => {
  it("reads money as exact integer micros", () => {
    expect(usdToMicros("40.00", "x")).toBe(40_000_000);
    expect(usdToMicros("0.000001", "x")).toBe(1);
    expect(usdToMicros("12", "x")).toBe(12_000_000);
    expect(() => usdToMicros("1.0000001", "x")).toThrow(PolicyError);
    expect(() => usdToMicros("-1", "x")).toThrow(PolicyError);
    expect(() => usdToMicros("abc", "x")).toThrow(PolicyError);
  });

  it("rejects bad documents with a clear reason", () => {
    expect(() => parsePolicyYaml("version: 0")).toThrow(/version/);
    expect(() => parsePolicyYaml("version: 1\nrules:\n  - id: a\n    kind: permit\n  - id: a\n    kind: permit")).toThrow(/duplicate/);
    expect(() => parsePolicyYaml("version: 1\nrules:\n  - id: a\n    kind: maybe")).toThrow(/kind/);
    expect(() => parsePolicyYaml("version: 1\nrules:\n  - id: a\n    kind: permit\n    when: { colour: { in: [x] } }")).toThrow(/unknown condition/);
    expect(() => parsePolicyYaml("version: 1\nrules:\n  - id: a\n    kind: permit\n    when: { scope: nope }")).toThrow(/unknown scope/);
    expect(() => parsePolicyYaml("version: 1\nrules:\n  - id: a\n    kind: permit\n    cap: { window: week, max_usd: '1' }")).toThrow(/window/);
    expect(() => parsePolicyYaml("version: 1\nrules:\n  - id: a\n    kind: permit\n    cap: { window: day, max_usd: '1', warn_at: 0.9, ask_at: 0.5 }")).toThrow(/warn_at/);
    expect(() => parsePolicyYaml(": : :")).toThrow(PolicyError);
    expect(() => parsePolicy("not a mapping")).toThrow(PolicyError);
  });
});

describe("evaluation", () => {
  const p = base();

  it("denies by default and allows what a permit covers", () => {
    expect(evaluate(p, req({ model: "gpt-9" })).verdict).toBe("deny");
    expect(evaluate(p, req({ project: "repo:other/x" })).verdict).toBe("deny");
    expect(evaluate(p, req()).verdict).toBe("allow");
  });

  it("asks at the ask threshold and denies over the cap, with exact boundaries", () => {
    expect(evaluate(p, req({ day_spend_after_micros: 31_999_999 })).verdict).toBe("allow");
    expect(evaluate(p, req({ day_spend_after_micros: 32_000_000 })).verdict).toBe("ask");
    expect(evaluate(p, req({ day_spend_after_micros: 40_000_000 })).verdict).toBe("ask");
    expect(evaluate(p, req({ day_spend_after_micros: 40_000_001 })).verdict).toBe("deny");
  });

  it("lets a forbid override a permit and returns its action", () => {
    const d = evaluate(p, req({ waste_rule: "C-LOOP-1", recoverable_micros: 2_000_001 }));
    expect(d).toMatchObject({ verdict: "deny", action: "pause_with_checkpoint", failed: false });
    expect(evaluate(p, req({ waste_rule: "C-LOOP-1", recoverable_micros: 2_000_000 })).verdict).toBe("allow"); // gt is exclusive
  });

  it("turns allow into ask when an approval rule matches, never the reverse", () => {
    expect(evaluate(p, req({ action: "cap.raise" })).verdict).toBe("ask");
    expect(evaluate(p, req({ action: "cap.raise", model: "gpt-9" })).verdict).toBe("deny");
  });

  it("routes without changing the verdict", () => {
    expect(routeOf(p, req({ task_type: "docs" }))).toBe("claude-sonnet-5-5");
    expect(routeOf(p, req({ task_type: "code" }))).toBe("claude-opus-5");
    expect(evaluate(p, req({ task_type: "docs" })).verdict).toBe("allow");
  });

  it("matches patterns without regex surprises", () => {
    expect(globMatch("claude-*", "claude-opus-5")).toBe(true);
    expect(globMatch("*-5", "claude-opus-5")).toBe(true);
    expect(globMatch("claude-*-5", "claude-opus-5")).toBe(true);
    expect(globMatch("claude-*", "gpt-claude-x")).toBe(false);
    expect(globMatch("a.b", "axb")).toBe(false);
    expect(globMatch("claude-opus-5", "claude-opus-5")).toBe(true);
  });
});

describe("restrict-only check", () => {
  const old = base();

  it("accepts an identical policy and a lowered cap", () => {
    expect(restrictCheck(old, old).narrows).toBe(true);
    const lower = parsePolicyYaml(BASE.replace('max_usd: "40.00"', 'max_usd: "30.00"'));
    expect(restrictCheck(old, lower).narrows).toBe(true);
  });

  it("accepts a new forbid and a removed permit", () => {
    const extra = withRules(old, [...old.rules, { id: "no-gpt", kind: "forbid", when: { finite: { model: ["claude-opus-5"] }, numeric: {} }, action: "deny" }]);
    expect(restrictCheck(old, extra).narrows).toBe(true);
    expect(restrictCheck(old, withRules(old, old.rules.filter((r) => r.id !== "daily-cap"))).narrows).toBe(true);
  });

  it("rejects a raised cap and names the request it newly allows", () => {
    const higher = parsePolicyYaml(BASE.replace('max_usd: "40.00"', 'max_usd: "50.00"'));
    const r = restrictCheck(old, higher);
    expect(r.narrows).toBe(false);
    expect(r.widening).toMatchObject({ was: "deny", now: "ask" });
    expect(describeWidening(r.widening!)).toMatch(/was deny, now/);
  });

  it("rejects a removed forbid, a wider model pattern and a new permit", () => {
    expect(restrictCheck(old, withRules(old, old.rules.filter((r) => r.id !== "loop-stop"))).narrows).toBe(false);
    const wide = parsePolicyYaml(BASE.replace('model: { in: ["claude-*"] }', 'model: { in: ["claude-*", "gpt-*"] }'));
    expect(restrictCheck(old, wide).narrows).toBe(false);
    const extra = withRules(old, [...old.rules, { id: "open", kind: "permit", when: { finite: {}, numeric: {} } }]);
    expect(restrictCheck(old, extra).narrows).toBe(false);
  });

  it("flags a route change as behaviour change, not a narrowing", () => {
    const rerouted = parsePolicyYaml(BASE.replace("claude-sonnet-5-5", "claude-haiku-5-5"));
    const r = restrictCheck(old, rerouted);
    expect(r.narrows).toBe(true);
    expect(r.routeChanges.length).toBeGreaterThan(0);
    expect(r.routeChanges[0]).toMatchObject({ was: "claude-sonnet-5-5", now: "claude-haiku-5-5" });
  });

  it("does not hide a widening inside a dimension that only an unchanged rule mentions", () => {
    // `person` appears only in an unchanged forbid. The edit widens `model` only. A checker that merged
    // `person` into one cell (because no CHANGED rule mentions it) could test only the forbidden person and miss it.
    const prev = parsePolicyYaml(`
version: 1
rules:
  - { id: ban, kind: forbid, when: { person: { in: [bob] } }, action: deny }
  - { id: ok, kind: permit, when: { model: { in: [a] } } }
`);
    const next = parsePolicyYaml(`
version: 1
rules:
  - { id: ban, kind: forbid, when: { person: { in: [bob] } }, action: deny }
  - { id: ok, kind: permit, when: { model: { in: [a, b] } } }
`);
    const r = restrictCheck(prev, next);
    expect(r.narrows).toBe(false);
    expect(r.mergedDims).not.toContain("person");
    expect(r.widening?.request.model).toBe("b");
    expect(r.widening?.request.person).not.toBe("bob");
  });

  it("merges only dimensions that appear in no rule of either policy", () => {
    const r = restrictCheck(old, old);
    expect(r.mergedDims).toEqual(expect.arrayContaining(["agent", "month_spend_after_micros"]));
    expect(r.mergedDims).not.toContain("model");
    expect(r.mergedDims).not.toContain("day_spend_after_micros");
  });

  it("reports outside_fragment instead of guessing when the grid is too large", () => {
    const r = restrictCheck(old, old, { model: Array.from({ length: 50 }, (_, i) => `m${i}`) }, 100);
    expect(r.outsideFragment).toBe(true);
    expect(r.narrows).toBe(false);
  });
});

// A seeded random test: the checker must agree with brute force over many sampled requests.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MODELS = ["a", "b", "c"];
const PEOPLE = ["p1", "p2"];

function randomPolicy(rand: () => number): Policy {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const subset = (xs: readonly string[]): string[] => xs.filter(() => rand() < 0.5).concat(rand() < 0.15 ? [] : []).filter((x, i, a) => a.indexOf(x) === i);
  const rules: Policy["rules"][number][] = [];
  const n = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i += 1) {
    const finite: Record<string, string[]> = {};
    const m = subset(MODELS);
    if (m.length > 0 && rand() < 0.7) finite["model"] = m;
    const pe = subset(PEOPLE);
    if (pe.length > 0 && rand() < 0.5) finite["person"] = pe;
    const kind = rand() < 0.7 ? "permit" : "forbid";
    const cap = kind === "permit" && rand() < 0.6 ? { window: "day" as const, maxMicros: pick([10, 20, 30, 40]) * 1_000_000, warnAt: 0.5, askAt: pick([0.5, 0.8]) } : undefined;
    const numeric = rand() < 0.3 ? { recoverable_micros: { lo: pick([0, 1_000_000, 2_000_000]), loOpen: rand() < 0.5, hi: Infinity, hiOpen: true } } : {};
    if (kind === "permit") rules.push({ id: `r${i}`, kind, when: { finite, numeric }, ...(cap ? { cap } : {}) });
    else rules.push({ id: `r${i}`, kind, when: { finite, numeric }, action: "deny" });
  }
  return { version: 1, rules, approvals: rand() < 0.3 ? [{ when: { finite: { person: ["p2"] }, numeric: {} }, approvers: ["owner"] }] : [] };
}

describe("restrict-only check against brute force", () => {
  it("agrees with exhaustive sampling on 400 random policy pairs", () => {
    const rand = rng(20261022);
    const spends = [0, 5, 10, 11, 15, 16, 20, 21, 24, 25, 30, 31, 32, 40, 41].map((x) => x * 1_000_000);
    const recs = [0, 1_000_000, 1_000_001, 2_000_000, 2_000_001, 5_000_000];
    let widened = 0;
    for (let k = 0; k < 400; k += 1) {
      const prev = randomPolicy(rand);
      const next = randomPolicy(rand);
      const result = restrictCheck(prev, next, { model: MODELS, person: PEOPLE });
      expect(result.outsideFragment).toBe(false);
      let brute: Request | undefined;
      outer: for (const model of [...MODELS, "z"]) {
        for (const person of [...PEOPLE, "zz"]) {
          for (const d of spends) {
            for (const rc of recs) {
              const r = req({ model, person, day_spend_after_micros: d, recoverable_micros: rc });
              if (VERDICT_ORDER[evaluate(next, r).verdict] > VERDICT_ORDER[evaluate(prev, r).verdict]) {
                brute = r;
                break outer;
              }
            }
          }
        }
      }
      if (brute) {
        widened += 1;
        expect(result.narrows, `pair ${k}: brute force found a widening the checker missed`).toBe(false);
      }
      if (result.widening) {
        const w = result.widening;
        expect(VERDICT_ORDER[evaluate(next, w.request).verdict]).toBeGreaterThan(VERDICT_ORDER[evaluate(prev, w.request).verdict]);
        expect(w.request.model === OTHER || typeof w.request.model === "string").toBe(true);
      }
    }
    expect(widened).toBeGreaterThan(40); // the sample really contains widenings, so the test has teeth
  });
});
