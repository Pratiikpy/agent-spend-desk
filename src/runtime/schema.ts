import { SchemaError, type Issue } from "./errors.ts";
import { isPlainObject, type Json, type JsonObject } from "./json.ts";

export type { Issue } from "./errors.ts";

export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

export interface Schema<T> {
  readonly kind: string;
  parse(input: unknown, path?: string): Result<T>;
  toJsonSchema(): JsonObject;
}

export interface OptionalSchema<T> extends Schema<T | undefined> {
  readonly isOptional: true;
  readonly inner: Schema<T>;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (path: string, message: string): Result<never> => ({
  ok: false,
  issues: [{ path, message }],
});
const at = (path: string | undefined): string => path ?? "$";
const child = (path: string, key: string | number): string =>
  typeof key === "number" ? `${path}[${key}]` : `${path}.${key}`;

export function parseOrThrow<T>(schema: Schema<T>, input: unknown, context?: string): T {
  const result = schema.parse(input);
  if (!result.ok) throw new SchemaError(result.issues, context);
  return result.value;
}

export interface StringOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
}

export function string(options: StringOptions = {}): Schema<string> {
  return {
    kind: "string",
    parse(input, path) {
      if (typeof input !== "string") return fail(at(path), "expected string");
      if (options.minLength !== undefined && input.length < options.minLength) {
        return fail(at(path), `shorter than ${options.minLength}`);
      }
      if (options.maxLength !== undefined && input.length > options.maxLength) {
        return fail(at(path), `longer than ${options.maxLength}`);
      }
      if (options.pattern && !options.pattern.test(input)) {
        return fail(at(path), `does not match ${String(options.pattern)}`);
      }
      return ok(input);
    },
    toJsonSchema() {
      const schema: JsonObject = { type: "string" };
      if (options.minLength !== undefined) schema["minLength"] = options.minLength;
      if (options.maxLength !== undefined) schema["maxLength"] = options.maxLength;
      if (options.pattern) schema["pattern"] = options.pattern.source;
      return schema;
    },
  };
}

export interface NumberOptions {
  min?: number;
  max?: number;
  integer?: boolean;
}

export function number(options: NumberOptions = {}): Schema<number> {
  return {
    kind: options.integer ? "integer" : "number",
    parse(input, path) {
      if (typeof input !== "number" || !Number.isFinite(input)) {
        return fail(at(path), "expected finite number");
      }
      if (options.integer && !Number.isInteger(input)) return fail(at(path), "expected integer");
      if (options.min !== undefined && input < options.min) return fail(at(path), `below ${options.min}`);
      if (options.max !== undefined && input > options.max) return fail(at(path), `above ${options.max}`);
      return ok(input);
    },
    toJsonSchema() {
      const schema: JsonObject = { type: options.integer ? "integer" : "number" };
      if (options.min !== undefined) schema["minimum"] = options.min;
      if (options.max !== undefined) schema["maximum"] = options.max;
      return schema;
    },
  };
}

export const integer = (options: Omit<NumberOptions, "integer"> = {}): Schema<number> =>
  number({ ...options, integer: true });

export const boolean = (): Schema<boolean> => ({
  kind: "boolean",
  parse: (input, path) => (typeof input === "boolean" ? ok(input) : fail(at(path), "expected boolean")),
  toJsonSchema: () => ({ type: "boolean" }),
});

export function literal<const L extends string | number | boolean | null>(value: L): Schema<L> {
  return {
    kind: "literal",
    parse: (input, path) => (input === value ? ok(value) : fail(at(path), `expected ${JSON.stringify(value)}`)),
    toJsonSchema: () => ({ const: value }),
  };
}

export function oneOf<const V extends readonly string[]>(values: V): Schema<V[number]> {
  return {
    kind: "enum",
    parse(input, path) {
      if (typeof input === "string" && (values as readonly string[]).includes(input)) {
        return ok(input as V[number]);
      }
      return fail(at(path), `expected one of ${values.join(", ")}`);
    },
    toJsonSchema: () => ({ type: "string", enum: [...values] }),
  };
}

export interface ArrayOptions {
  minItems?: number;
  maxItems?: number;
}

export function array<T>(item: Schema<T>, options: ArrayOptions = {}): Schema<T[]> {
  return {
    kind: "array",
    parse(input, path) {
      const base = at(path);
      if (!Array.isArray(input)) return fail(base, "expected array");
      if (options.minItems !== undefined && input.length < options.minItems) {
        return fail(base, `fewer than ${options.minItems} items`);
      }
      if (options.maxItems !== undefined && input.length > options.maxItems) {
        return fail(base, `more than ${options.maxItems} items`);
      }
      const out: T[] = [];
      const issues: Issue[] = [];
      input.forEach((element, i) => {
        const r = item.parse(element, child(base, i));
        if (r.ok) out.push(r.value);
        else issues.push(...r.issues);
      });
      return issues.length > 0 ? { ok: false, issues } : ok(out);
    },
    toJsonSchema() {
      const schema: JsonObject = { type: "array", items: item.toJsonSchema() };
      if (options.minItems !== undefined) schema["minItems"] = options.minItems;
      if (options.maxItems !== undefined) schema["maxItems"] = options.maxItems;
      return schema;
    },
  };
}

export function record<T>(value: Schema<T>): Schema<Record<string, T>> {
  return {
    kind: "record",
    parse(input, path) {
      const base = at(path);
      if (!isPlainObject(input)) return fail(base, "expected object");
      const out: Record<string, T> = {};
      const issues: Issue[] = [];
      for (const key of Object.keys(input)) {
        const r = value.parse(input[key], child(base, key));
        if (r.ok) out[key] = r.value;
        else issues.push(...r.issues);
      }
      return issues.length > 0 ? { ok: false, issues } : ok(out);
    },
    toJsonSchema: () => ({ type: "object", additionalProperties: value.toJsonSchema() }),
  };
}

export function optional<T>(inner: Schema<T>): OptionalSchema<T> {
  return {
    kind: "optional",
    isOptional: true,
    inner,
    parse: (input, path) => (input === undefined ? ok(undefined) : inner.parse(input, path)),
    toJsonSchema: () => inner.toJsonSchema(),
  };
}

export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return {
    kind: "nullable",
    parse: (input, path) => (input === null ? ok(null) : inner.parse(input, path)),
    toJsonSchema: () => ({ anyOf: [inner.toJsonSchema(), { type: "null" }] }),
  };
}

export function union<const S extends readonly Schema<unknown>[]>(
  ...schemas: S
): Schema<Infer<S[number]>> {
  return {
    kind: "union",
    parse(input, path) {
      const collected: Issue[] = [];
      for (const schema of schemas) {
        const r = schema.parse(input, path);
        if (r.ok) return ok(r.value as Infer<S[number]>);
        collected.push(...r.issues);
      }
      return { ok: false, issues: [{ path: at(path), message: `matched no variant (${collected.map((i) => i.message).join(" | ")})` }] };
    },
    toJsonSchema: () => ({ anyOf: schemas.map((s) => s.toJsonSchema()) }),
  };
}

/** Discriminated union: parses by the value of `tag`, which keeps error messages precise. */
export function variants<const Tag extends string, const M extends Record<string, Schema<unknown>>>(
  tag: Tag,
  map: M,
): Schema<{ [K in keyof M]: Infer<M[K]> }[keyof M]> {
  return {
    kind: "variants",
    parse(input, path) {
      const base = at(path);
      if (!isPlainObject(input)) return fail(base, "expected object");
      const discriminator = input[tag];
      if (typeof discriminator !== "string" || !Object.hasOwn(map, discriminator)) {
        return fail(child(base, tag), `expected one of ${Object.keys(map).join(", ")}`);
      }
      const r = (map[discriminator] as Schema<unknown>).parse(input, path);
      return r.ok ? ok(r.value as { [K in keyof M]: Infer<M[K]> }[keyof M]) : r;
    },
    toJsonSchema: () => ({ oneOf: Object.values(map).map((s) => s.toJsonSchema()) }),
  };
}

type Shape = Record<string, Schema<unknown>>;
type OptionalKeys<S extends Shape> = {
  [K in keyof S]: S[K] extends OptionalSchema<unknown> ? K : never;
}[keyof S];
type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type ObjectOf<S extends Shape> = Simplify<
  { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & {
    [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined>;
  }
>;

/** Strict object: unknown keys are an error, so a typo or an injected field never passes silently. */
export function object<S extends Shape>(shape: S): Schema<ObjectOf<S>> {
  const keys = Object.keys(shape);
  return {
    kind: "object",
    parse(input, path) {
      const base = at(path);
      if (!isPlainObject(input)) return fail(base, "expected object");
      const issues: Issue[] = [];
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        const fieldSchema = shape[key] as Schema<unknown>;
        const value = input[key];
        const isOptional = (fieldSchema as Partial<OptionalSchema<unknown>>).isOptional === true;
        if (value === undefined && !isOptional) {
          issues.push({ path: child(base, key), message: "required" });
          continue;
        }
        const r = fieldSchema.parse(value, child(base, key));
        if (!r.ok) issues.push(...r.issues);
        else if (r.value !== undefined) out[key] = r.value;
      }
      for (const key of Object.keys(input)) {
        if (!Object.hasOwn(shape, key)) issues.push({ path: child(base, key), message: "unknown key" });
      }
      return issues.length > 0 ? { ok: false, issues } : ok(out as ObjectOf<S>);
    },
    toJsonSchema() {
      const properties: JsonObject = {};
      const required: string[] = [];
      for (const key of keys) {
        const fieldSchema = shape[key] as Schema<unknown>;
        properties[key] = fieldSchema.toJsonSchema();
        if ((fieldSchema as Partial<OptionalSchema<unknown>>).isOptional !== true) required.push(key);
      }
      return { type: "object", properties, required, additionalProperties: false };
    },
  };
}

/** Any plain JSON value, validated structurally. */
export const json: Schema<Json> = (() => {
  const walk = (input: unknown, path: string): Result<Json> => {
    if (input === null || typeof input === "boolean" || typeof input === "string") return ok(input);
    if (typeof input === "number") {
      return Number.isFinite(input) ? ok(input) : fail(path, "non-finite number");
    }
    if (Array.isArray(input)) {
      const out: Json[] = [];
      const issues: Issue[] = [];
      input.forEach((el, i) => {
        const r = walk(el, child(path, i));
        if (r.ok) out.push(r.value);
        else issues.push(...r.issues);
      });
      return issues.length > 0 ? { ok: false, issues } : ok(out);
    }
    if (isPlainObject(input)) {
      const out: JsonObject = {};
      const issues: Issue[] = [];
      for (const key of Object.keys(input)) {
        const r = walk(input[key], child(path, key));
        if (r.ok) out[key] = r.value;
        else issues.push(...r.issues);
      }
      return issues.length > 0 ? { ok: false, issues } : ok(out);
    }
    return fail(path, "not JSON");
  };
  return { kind: "json", parse: (input, path) => walk(input, at(path)), toJsonSchema: () => ({}) };
})();

/** Add a semantic check that the structural schema cannot express. */
export function refine<T>(schema: Schema<T>, check: (value: T) => string | null, label = "refine"): Schema<T> {
  return {
    kind: label,
    parse(input, path) {
      const r = schema.parse(input, path);
      if (!r.ok) return r;
      const problem = check(r.value);
      return problem === null ? r : fail(at(path), problem);
    },
    toJsonSchema: () => schema.toJsonSchema(),
  };
}
