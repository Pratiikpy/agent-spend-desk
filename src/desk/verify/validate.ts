/**
 * A very small structural validator. It exists so that the verifier needs no schema library and so that
 * every unknown field is an error: a signed file with an extra key is not the file the builder wrote.
 */
export interface Issue {
  path: string;
  message: string;
}

export type Check = (value: unknown, path: string, issues: Issue[]) => void;

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export const str =
  (opts: { pattern?: RegExp; max?: number; min?: number } = {}): Check =>
  (v, path, issues) => {
    if (typeof v !== "string") return void issues.push({ path, message: `expected a string, got ${describe(v)}` });
    if (opts.pattern && !opts.pattern.test(v)) issues.push({ path, message: `does not match ${opts.pattern}` });
    if (opts.max !== undefined && v.length > opts.max) issues.push({ path, message: `longer than ${opts.max}` });
    if (opts.min !== undefined && v.length < opts.min) issues.push({ path, message: `shorter than ${opts.min}` });
  };

export const int =
  (opts: { min?: number; max?: number } = {}): Check =>
  (v, path, issues) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v)) return void issues.push({ path, message: `expected a safe integer, got ${describe(v)}` });
    if (opts.min !== undefined && v < opts.min) issues.push({ path, message: `below ${opts.min}` });
    if (opts.max !== undefined && v > opts.max) issues.push({ path, message: `above ${opts.max}` });
  };

export const num: Check = (v, path, issues) => {
  if (typeof v !== "number" || !Number.isFinite(v)) issues.push({ path, message: `expected a finite number, got ${describe(v)}` });
};

export const bool: Check = (v, path, issues) => {
  if (typeof v !== "boolean") issues.push({ path, message: `expected a boolean, got ${describe(v)}` });
};

export const oneOf =
  (values: readonly string[]): Check =>
  (v, path, issues) => {
    if (typeof v !== "string" || !values.includes(v)) issues.push({ path, message: `expected one of ${values.join(", ")}` });
  };

export const literal =
  (expected: string | number | boolean): Check =>
  (v, path, issues) => {
    if (v !== expected) issues.push({ path, message: `expected ${JSON.stringify(expected)}` });
  };

export const any: Check = () => undefined;

export const arr =
  (item: Check, opts: { max?: number; min?: number } = {}): Check =>
  (v, path, issues) => {
    if (!Array.isArray(v)) return void issues.push({ path, message: `expected an array, got ${describe(v)}` });
    if (opts.max !== undefined && v.length > opts.max) issues.push({ path, message: `more than ${opts.max} items` });
    if (opts.min !== undefined && v.length < opts.min) issues.push({ path, message: `fewer than ${opts.min} items` });
    v.slice(0, opts.max ?? v.length).forEach((x, i) => item(x, `${path}[${i}]`, issues));
  };

export const record =
  (value: Check, opts: { key?: RegExp; max?: number } = {}): Check =>
  (v, path, issues) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return void issues.push({ path, message: `expected an object, got ${describe(v)}` });
    const entries = Object.entries(v);
    if (opts.max !== undefined && entries.length > opts.max) issues.push({ path, message: `more than ${opts.max} keys` });
    for (const [k, x] of entries) {
      if (opts.key && !opts.key.test(k)) issues.push({ path: `${path}.${k}`, message: "key does not match the allowed pattern" });
      value(x, `${path}.${k}`, issues);
    }
  };

export const obj =
  (required: Record<string, Check>, optional: Record<string, Check> = {}): Check =>
  (v, path, issues) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return void issues.push({ path, message: `expected an object, got ${describe(v)}` });
    const o = v as Record<string, unknown>;
    for (const [k, check] of Object.entries(required)) {
      if (!(k in o)) issues.push({ path: `${path}.${k}`, message: "required field is missing" });
      else check(o[k], `${path}.${k}`, issues);
    }
    for (const [k, check] of Object.entries(optional)) if (k in o) check(o[k], `${path}.${k}`, issues);
    for (const k of Object.keys(o)) if (!(k in required) && !(k in optional)) issues.push({ path: `${path}.${k}`, message: "unknown field" });
  };

export const nullable =
  (check: Check): Check =>
  (v, path, issues) => {
    if (v !== null) check(v, path, issues);
  };

export const either =
  (...checks: Check[]): Check =>
  (v, path, issues) => {
    const attempts: Issue[][] = checks.map((c) => {
      const local: Issue[] = [];
      c(v, path, local);
      return local;
    });
    if (attempts.every((a) => a.length > 0)) issues.push(...(attempts[0] as Issue[]));
  };

export function validate(check: Check, value: unknown): Issue[] {
  const issues: Issue[] = [];
  check(value, "$", issues);
  return issues;
}
