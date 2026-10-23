import { createHash } from "node:crypto";

import { SchemaError } from "./errors.ts";
import { isPlainObject, type Json } from "./json.ts";

/**
 * Canonical JSON: keys sorted by UTF-16 code unit, no whitespace, numbers in their shortest round-trip form, and
 * -0 written as 0. Hashes, signatures and recorded keys depend on this exact text, so it is written here and not
 * borrowed from a library whose output could change with a version.
 *
 * Only plain JSON is accepted. `undefined`, functions, symbols, bigint, NaN, infinities, class instances and cycles
 * are errors rather than being dropped without a word.
 */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  write(value, "$", [], out);
  return out.join("");
}

function reject(path: string, message: string): never {
  throw new SchemaError([{ path, message }]);
}

function write(value: unknown, path: string, stack: object[], out: string[]): void {
  if (value === null) return void out.push("null");
  if (typeof value === "boolean") return void out.push(value ? "true" : "false");
  if (typeof value === "string") return void out.push(JSON.stringify(value));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject(path, `non-finite number ${String(value)} is not JSON`);
    return void out.push(Object.is(value, -0) ? "0" : JSON.stringify(value));
  }
  if (typeof value !== "object") reject(path, `${typeof value} is not JSON`);
  if (stack.includes(value)) reject(path, "cyclic structure");
  stack.push(value);
  if (Array.isArray(value)) {
    out.push("[");
    value.forEach((item, i) => {
      if (i > 0) out.push(",");
      write(item, `${path}[${i}]`, stack, out);
    });
    out.push("]");
  } else if (isPlainObject(value)) {
    out.push("{");
    Object.keys(value)
      .sort()
      .forEach((key, i) => {
        const item = value[key];
        if (item === undefined) reject(`${path}.${key}`, "undefined is not JSON; omit the key");
        if (i > 0) out.push(",");
        out.push(JSON.stringify(key), ":");
        write(item, `${path}.${key}`, stack, out);
      });
    out.push("}");
  } else {
    reject(path, "only plain objects are JSON");
  }
  stack.pop();
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The hash of a value's canonical text, with a prefix so a bare hex string is never taken for one. */
export function hashJson(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

/** Freeze a JSON value and everything inside it. */
export function deepFreeze<T extends Json>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner as Json);
  }
  return value;
}
