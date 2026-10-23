import { SchemaError, type Issue } from "./errors.ts";
import { isPlainObject, type Json, type JsonObject } from "./json.ts";

export type { Issue } from "./errors.ts";

export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

/** A check that turns an unknown value into a typed one, and can describe itself as a JSON Schema. */
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

const pass = <T>(value: T): Result<T> => ({ ok: true, value });
const miss = (path: string, message: string): Result<never> => ({ ok: false, issues: [{ path, message }] });
const root = (path?: string): string => path ?? "$";
const sub = (path: string, key: string | number): string => (typeof key === "number" ? `${path}[${key}]` : `${path}.${key}`);

/** Parse and return the value, or throw a SchemaError that names every place it did not fit. */
export function parseOrThrow<T>(schema: Schema<T>, input: unknown, context?: string): T {
  const r = schema.parse(input);
  if (!r.ok) throw new SchemaError(r.issues, context);
  return r.value;
}

/** Build a schema from a checker and the JSON Schema it stands for. */
function make<T>(kind: string, check: (input: unknown, path: string) => Result<T>, describe: () => JsonObject): Schema<T> {
  return { kind, parse: (input, path) => check(input, root(path)), toJsonSchema: describe };
}

/** Run a schema over each element and gather every failure, so one pass reports them all. */
function collect<T>(items: readonly unknown[], schema: Schema<T>, path: string): Result<T[]> {
  const values: T[] = [];
  const issues: Issue[] = [];
  items.forEach((item, i) => {
    const r = schema.parse(item, sub(path, i));
    if (r.ok) values.push(r.value);
    else issues.push(...r.issues);
  });
  return issues.length > 0 ? { ok: false, issues } : pass(values);
}

export interface StringOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
}

export function string(o: StringOptions = {}): Schema<string> {
  return make(
    "string",
    (input, path) => {
      if (typeof input !== "string") return miss(path, "expected string");
      if (o.minLength !== undefined && input.length < o.minLength) return miss(path, `shorter than ${o.minLength}`);
      if (o.maxLength !== undefined && input.length > o.maxLength) return miss(path, `longer than ${o.maxLength}`);
      if (o.pattern !== undefined && !o.pattern.test(input)) return miss(path, `does not match ${String(o.pattern)}`);
      return pass(input);
    },
    () => ({ type: "string", ...(o.minLength !== undefined ? { minLength: o.minLength } : {}), ...(o.maxLength !== undefined ? { maxLength: o.maxLength } : {}), ...(o.pattern ? { pattern: o.pattern.source } : {}) }),
  );
}

export interface NumberOptions {
  min?: number;
  max?: number;
  integer?: boolean;
}

export function number(o: NumberOptions = {}): Schema<number> {
  return make(
    o.integer ? "integer" : "number",
    (input, path) => {
      if (typeof input !== "number" || !Number.isFinite(input)) return miss(path, "expected finite number");
      if (o.integer && !Number.isInteger(input)) return miss(path, "expected integer");
      if (o.min !== undefined && input < o.min) return miss(path, `below ${o.min}`);
      if (o.max !== undefined && input > o.max) return miss(path, `above ${o.max}`);
      return pass(input);
    },
    () => ({ type: o.integer ? "integer" : "number", ...(o.min !== undefined ? { minimum: o.min } : {}), ...(o.max !== undefined ? { maximum: o.max } : {}) }),
  );
}

export const integer = (o: Omit<NumberOptions, "integer"> = {}): Schema<number> => number({ ...o, integer: true });

export const boolean = (): Schema<boolean> => make("boolean", (input, path) => (typeof input === "boolean" ? pass(input) : miss(path, "expected boolean")), () => ({ type: "boolean" }));

export function literal<const L extends string | number | boolean | null>(expected: L): Schema<L> {
  return make("literal", (input, path) => (input === expected ? pass(expected) : miss(path, `expected ${JSON.stringify(expected)}`)), () => ({ const: expected }));
}

export function oneOf<const V extends readonly string[]>(allowed: V): Schema<V[number]> {
  return make(
    "enum",
    (input, path) => (typeof input === "string" && allowed.includes(input) ? pass(input as V[number]) : miss(path, `expected one of ${allowed.join(", ")}`)),
    () => ({ type: "string", enum: [...allowed] }),
  );
}

export interface ArrayOptions {
  minItems?: number;
  maxItems?: number;
}

export function array<T>(item: Schema<T>, o: ArrayOptions = {}): Schema<T[]> {
  return make(
    "array",
    (input, path) => {
      if (!Array.isArray(input)) return miss(path, "expected array");
      if (o.minItems !== undefined && input.length < o.minItems) return miss(path, `fewer than ${o.minItems} items`);
      if (o.maxItems !== undefined && input.length > o.maxItems) return miss(path, `more than ${o.maxItems} items`);
      return collect(input, item, path);
    },
    () => ({ type: "array", items: item.toJsonSchema(), ...(o.minItems !== undefined ? { minItems: o.minItems } : {}), ...(o.maxItems !== undefined ? { maxItems: o.maxItems } : {}) }),
  );
}

export function record<T>(value: Schema<T>): Schema<Record<string, T>> {
  return make(
    "record",
    (input, path) => {
      if (!isPlainObject(input)) return miss(path, "expected object");
      const keys = Object.keys(input);
      const r = collect(keys.map((k) => input[k]), value, path);
      if (!r.ok) return r;
      return pass(Object.fromEntries(keys.map((k, i) => [k, r.value[i] as T])));
    },
    () => ({ type: "object", additionalProperties: value.toJsonSchema() }),
  );
}

export function optional<T>(inner: Schema<T>): OptionalSchema<T> {
  return { kind: "optional", isOptional: true, inner, parse: (input, path) => (input === undefined ? pass(undefined) : inner.parse(input, path)), toJsonSchema: () => inner.toJsonSchema() };
}

export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return make("nullable", (input, path) => (input === null ? pass(null) : inner.parse(input, path)), () => ({ anyOf: [inner.toJsonSchema(), { type: "null" }] }));
}

export function union<const S extends readonly Schema<unknown>[]>(...options: S): Schema<Infer<S[number]>> {
  return make(
    "union",
    (input, path) => {
      const why: string[] = [];
      for (const option of options) {
        const r = option.parse(input, path);
        if (r.ok) return pass(r.value as Infer<S[number]>);
        why.push(...r.issues.map((i) => i.message));
      }
      return miss(path, `matched no variant (${why.join(" | ")})`);
    },
    () => ({ anyOf: options.map((s) => s.toJsonSchema()) }),
  );
}

/** A union told apart by one field, so a failure names the field that was wrong and not every variant. */
export function variants<const Tag extends string, const M extends Record<string, Schema<unknown>>>(tag: Tag, map: M): Schema<{ [K in keyof M]: Infer<M[K]> }[keyof M]> {
  return make(
    "variants",
    (input, path) => {
      if (!isPlainObject(input)) return miss(path, "expected object");
      const which = input[tag];
      if (typeof which !== "string" || !Object.hasOwn(map, which)) return miss(sub(path, tag), `expected one of ${Object.keys(map).join(", ")}`);
      return (map[which] as Schema<unknown>).parse(input, path) as Result<{ [K in keyof M]: Infer<M[K]> }[keyof M]>;
    },
    () => ({ oneOf: Object.values(map).map((s) => s.toJsonSchema()) }),
  );
}

type Shape = Record<string, Schema<unknown>>;
type OptionalKeys<S extends Shape> = { [K in keyof S]: S[K] extends OptionalSchema<unknown> ? K : never }[keyof S];
type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type ObjectOf<S extends Shape> = Simplify<{ [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & { [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined> }>;

const isOptional = (s: Schema<unknown>): boolean => (s as Partial<OptionalSchema<unknown>>).isOptional === true;

/** An object with exactly these fields. A field nobody declared is an error, so a typo or an injected key never passes. */
export function object<S extends Shape>(shape: S): Schema<ObjectOf<S>> {
  const fields = Object.entries(shape);
  return make(
    "object",
    (input, path) => {
      if (!isPlainObject(input)) return miss(path, "expected object");
      const issues: Issue[] = [];
      const out: Record<string, unknown> = {};
      for (const [key, field] of fields) {
        const at = sub(path, key);
        const raw = input[key];
        if (raw === undefined && !isOptional(field)) {
          issues.push({ path: at, message: "required" });
          continue;
        }
        const r = field.parse(raw, at);
        if (!r.ok) issues.push(...r.issues);
        else if (r.value !== undefined) out[key] = r.value;
      }
      for (const key of Object.keys(input)) if (!Object.hasOwn(shape, key)) issues.push({ path: sub(path, key), message: "unknown key" });
      return issues.length > 0 ? { ok: false, issues } : pass(out as ObjectOf<S>);
    },
    () => ({
      type: "object",
      properties: Object.fromEntries(fields.map(([key, field]) => [key, field.toJsonSchema()])),
      required: fields.filter(([, field]) => !isOptional(field)).map(([key]) => key),
      additionalProperties: false,
    }),
  );
}

function plainJson(input: unknown, path: string): Result<Json> {
  if (input === null || typeof input === "boolean" || typeof input === "string") return pass(input);
  if (typeof input === "number") return Number.isFinite(input) ? pass(input) : miss(path, "non-finite number");
  if (Array.isArray(input)) return collect(input, json, path);
  if (isPlainObject(input)) {
    const keys = Object.keys(input);
    const r = collect(keys.map((k) => input[k]), json, path);
    if (!r.ok) return r;
    return pass(Object.fromEntries(keys.map((k, i) => [k, r.value[i] as Json])));
  }
  return miss(path, "not JSON");
}

/** Any plain JSON value, checked all the way down. */
export const json: Schema<Json> = make("json", plainJson, () => ({}));

/** Add a check the structure alone cannot express; return a message to refuse the value, or null to accept it. */
export function refine<T>(schema: Schema<T>, check: (value: T) => string | null, label = "refine"): Schema<T> {
  return make(
    label,
    (input, path) => {
      const r = schema.parse(input, path);
      if (!r.ok) return r;
      const problem = check(r.value);
      return problem === null ? r : miss(path, problem);
    },
    () => schema.toJsonSchema(),
  );
}
