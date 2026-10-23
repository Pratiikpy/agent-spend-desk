import { describe, expect, it } from "vitest";

import { canonicalJson, deepFreeze, hashJson, sha256Hex } from "../../src/runtime/canonical.ts";
import { AgentError, BudgetExceeded, CassetteMiss, PolicyRefusal, SchemaError } from "../../src/runtime/errors.ts";
import { isPlainObject } from "../../src/runtime/json.ts";
import { array, boolean, integer, json, literal, nullable, number, object, oneOf, optional, parseOrThrow, record, refine, string, union, variants } from "../../src/runtime/schema.ts";

describe("canonical JSON", () => {
  it("sorts keys, drops whitespace and writes -0 as 0", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"], c: { z: -0, y: 1.5 } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"y":1.5,"z":0}}');
  });

  it("gives the same text for the same data whatever order it was built in", () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
    expect(hashJson({ x: 1, y: 2 })).toBe(hashJson({ y: 2, x: 1 }));
  });

  it("hashes with a prefix and matches a known SHA-256", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashJson("abc")).toBe(`sha256:${sha256Hex('"abc"')}`);
  });

  it("refuses what is not JSON instead of dropping it", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    for (const bad of [undefined, () => 1, Symbol("s"), 10n, Number.NaN, Number.POSITIVE_INFINITY, new Date(), new Map(), cyclic, { a: undefined }]) {
      expect(() => canonicalJson(bad), String(bad)).toThrow(SchemaError);
    }
  });

  it("allows the same object twice when it is not a cycle", () => {
    const shared = { n: 1 };
    expect(canonicalJson([shared, shared])).toBe('[{"n":1},{"n":1}]');
  });

  it("freezes a value and everything inside it", () => {
    const v = deepFreeze({ a: { b: [1, { c: 2 }] } });
    expect(Object.isFrozen(v.a.b[1])).toBe(true);
    expect(() => {
      (v.a as { b: unknown[] }).b.push(3);
    }).toThrow();
  });

  it("tells a plain object from a class instance", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject(new Map())).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });
});

describe("errors", () => {
  it("carry a class and a code to route on", () => {
    expect(new BudgetExceeded("turns", "6 used")).toMatchObject({ errorClass: "budget", code: "budget_exceeded", dimension: "turns" });
    expect(new CassetteMiss("k1", "record it")).toMatchObject({ errorClass: "fatal", code: "cassette_miss", effectKey: "k1" });
    expect(new PolicyRefusal("no_permit", "no")).toMatchObject({ errorClass: "policy" });
    const e = new SchemaError([{ path: "$.a", message: "required" }], "program");
    expect(e).toBeInstanceOf(AgentError);
    expect(e.message).toBe("program: $.a: required");
    expect(e.name).toBe("SchemaError");
  });

  it("names the first five problems and counts the rest", () => {
    const e = new SchemaError(Array.from({ length: 8 }, (_, i) => ({ path: `$.f${i}`, message: "bad" })));
    expect(e.message).toContain("(+3 more)");
    expect(e.issues).toHaveLength(8);
  });
});

describe("schemas", () => {
  const point = object({ x: integer({ min: 0, max: 10 }), label: optional(string({ maxLength: 4 })), tag: oneOf(["a", "b"] as const) });

  it("parses a good value and returns only the declared fields", () => {
    expect(point.parse({ x: 3, tag: "a" })).toEqual({ ok: true, value: { x: 3, tag: "a" } });
  });

  it("reports every problem with its path, and refuses unknown keys", () => {
    const r = point.parse({ x: 11, label: "toolong", tag: "c", extra: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.issues.map((i) => i.path).sort();
      expect(paths).toEqual(["$.extra", "$.label", "$.tag", "$.x"]);
    }
  });

  it("requires a field that is not optional", () => {
    const r = point.parse({ tag: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toEqual([{ path: "$.x", message: "required" }]);
  });

  it("checks numbers, arrays, records, literals, nullables and unions", () => {
    expect(number({ min: 1 }).parse(0).ok).toBe(false);
    expect(integer().parse(1.5).ok).toBe(false);
    expect(number().parse(Number.NaN).ok).toBe(false);
    expect(array(boolean(), { minItems: 1, maxItems: 2 }).parse([]).ok).toBe(false);
    expect(array(boolean(), { maxItems: 2 }).parse([true, 1]).ok).toBe(false);
    expect(record(integer()).parse({ a: 1, b: 2 })).toEqual({ ok: true, value: { a: 1, b: 2 } });
    expect(record(integer()).parse({ a: "x" }).ok).toBe(false);
    expect(literal("go").parse("stop").ok).toBe(false);
    expect(nullable(string()).parse(null)).toEqual({ ok: true, value: null });
    expect(union(integer(), string()).parse("s")).toEqual({ ok: true, value: "s" });
    expect(union(integer(), string()).parse(true).ok).toBe(false);
  });

  it("tells variants apart by their tag and names the tag when it is wrong", () => {
    const step = variants("op", { add: object({ op: literal("add"), n: integer() }), stop: object({ op: literal("stop") }) });
    expect(step.parse({ op: "stop" }).ok).toBe(true);
    const bad = step.parse({ op: "mul" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0]?.path).toBe("$.op");
  });

  it("refines with a check the structure cannot express", () => {
    const ordered = refine(object({ a: integer(), b: integer() }), (v) => (v.a <= v.b ? null : "a is after b"));
    expect(ordered.parse({ a: 1, b: 2 }).ok).toBe(true);
    const r = ordered.parse({ a: 3, b: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.message).toBe("a is after b");
  });

  it("accepts any plain JSON and nothing else", () => {
    expect(json.parse({ a: [1, "x", null, { b: true }] }).ok).toBe(true);
    expect(json.parse({ a: Number.NaN }).ok).toBe(false);
    expect(json.parse(new Date()).ok).toBe(false);
  });

  it("throws a SchemaError with its context from parseOrThrow", () => {
    expect(() => parseOrThrow(point, { x: -1, tag: "a" }, "point")).toThrow(/^point: /);
    expect(parseOrThrow(point, { x: 1, tag: "b" })).toEqual({ x: 1, tag: "b" });
  });

  it("describes itself as a JSON Schema in a stable key order", () => {
    expect(JSON.stringify(point.toJsonSchema())).toBe(
      '{"type":"object","properties":{"x":{"type":"integer","minimum":0,"maximum":10},"label":{"type":"string","maxLength":4},"tag":{"type":"string","enum":["a","b"]}},"required":["x","tag"],"additionalProperties":false}',
    );
  });
});
