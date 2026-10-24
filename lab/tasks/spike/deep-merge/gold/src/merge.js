'use strict';

const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);

function isPlain(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// A deep copy of plain objects and arrays; anything else is kept by reference. `path` holds the containers being
// copied right now, so a container reached again while it is still open is a cycle.
function copy(value, path) {
  if (Array.isArray(value)) {
    if (path.has(value)) throw new TypeError('circular reference');
    path.add(value);
    const out = value.map((item) => copy(item, path));
    path.delete(value);
    return out;
  }
  if (isPlain(value)) {
    if (path.has(value)) throw new TypeError('circular reference');
    path.add(value);
    const out = {};
    for (const key of Object.keys(value)) {
      if (BLOCKED.has(key) || value[key] === undefined) continue;
      out[key] = copy(value[key], path);
    }
    path.delete(value);
    return out;
  }
  return value;
}

function mergeInto(target, source, path) {
  for (const key of Object.keys(source)) {
    if (BLOCKED.has(key)) continue;
    const value = source[key];
    if (value === undefined) continue;
    if (isPlain(value)) {
      if (path.has(value)) throw new TypeError('circular reference');
      path.add(value);
      const existing = Object.hasOwn(target, key) ? target[key] : undefined;
      if (!isPlain(existing)) target[key] = {};
      mergeInto(target[key], value, path);
      path.delete(value);
    } else {
      target[key] = copy(value, path);
    }
  }
}

function merge(...sources) {
  const result = {};
  for (const source of sources) {
    if (source === null || source === undefined) continue;
    if (!isPlain(source)) throw new TypeError('sources must be plain objects');
    mergeInto(result, source, new Set([source]));
  }
  return result;
}

module.exports = { merge };
