import { createHash } from "node:crypto";

import { SchemaError } from "./errors.ts";
import { isPlainObject, type Json } from "./json.ts";

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no insignificant
 * whitespace, numbers in their shortest round-trip form with -0 normalised to 0.
 * State, cassette keys and hashes depend on this exact form, so it is owned here
 * and never delegated to a library whose output could change in an upgrade.
 *
 * Only plain JSON is accepted. `undefined`, functions, symbols, bigint, NaN,
 * infinities, class instances and cycles are rejected rather than silently dropped.
 */
export function canonicalJson(value: unknown): string {
  return serialise(value, "$", new Set());
}

function serialise(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number": {
      if (!Number.isFinite(value)) {
        throw new SchemaError([{ path, message: `non-finite number ${String(value)} is not JSON` }]);
      }
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    }
    case "object":
      break;
    default:
      throw new SchemaError([{ path, message: `${typeof value} is not JSON` }]);
  }

  const obj = value as object;
  if (seen.has(obj)) {
    throw new SchemaError([{ path, message: "cyclic structure" }]);
  }
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const parts = obj.map((item, i) => serialise(item, `${path}[${i}]`, seen));
      return `[${parts.join(",")}]`;
    }
    if (!isPlainObject(obj)) {
      throw new SchemaError([{ path, message: "only plain objects are JSON" }]);
    }
    const keys = Object.keys(obj).sort();
    const parts = keys.map((key) => {
      const child = obj[key];
      if (child === undefined) {
        throw new SchemaError([{ path: `${path}.${key}`, message: "undefined is not JSON; omit the key" }]);
      }
      return `${JSON.stringify(key)}:${serialise(child, `${path}.${key}`, seen)}`;
    });
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(obj);
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Hash of the canonical JSON form, prefixed so a bare hex string is never mistaken for one. */
export function hashJson(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

/** Normalise any value already known to be JSON-compatible into a deep, frozen copy. */
export function deepFreeze<T extends Json>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === "object" && !Object.isFrozen(child)) {
        deepFreeze(child as Json);
      }
    }
  }
  return value;
}
