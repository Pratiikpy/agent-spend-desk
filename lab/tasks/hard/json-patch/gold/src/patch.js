'use strict';

class PatchError extends Error {
  constructor(index, code) {
    super(`operation ${index} failed: ${code}`);
    this.name = 'PatchError';
    this.index = index;
    this.code = code;
  }
}

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (isObject(v)) {
    const out = {};
    for (const k of Object.keys(v)) Object.defineProperty(out, k, { value: clone(v[k]), enumerable: true, writable: true, configurable: true });
    return out;
  }
  return v;
}

function equal(a, b) {
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => hasOwn(b, k) && equal(a[k], b[k]));
  }
  return a === b;
}

function parsePointer(pointer, index) {
  if (typeof pointer !== 'string') throw new PatchError(index, 'invalid_pointer');
  if (pointer === '') return [];
  if (pointer[0] !== '/') throw new PatchError(index, 'invalid_pointer');
  return pointer
    .slice(1)
    .split('/')
    .map((seg) => {
      if (/~(?![01])/.test(seg)) throw new PatchError(index, 'invalid_pointer');
      return seg.replace(/~1/g, '/').replace(/~0/g, '~');
    });
}

function arrayIndex(seg, length, allowEnd, index) {
  if (seg === '-' && allowEnd) return length;
  if (!/^(0|[1-9][0-9]*)$/.test(seg)) throw new PatchError(index, 'invalid_pointer');
  return Number(seg);
}

/** The container that holds the target, and the final segment. The parent must exist. */
function locate(doc, tokens, index) {
  let node = doc;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const seg = tokens[i];
    if (Array.isArray(node)) {
      const at = arrayIndex(seg, node.length, false, index);
      if (at >= node.length) throw new PatchError(index, 'not_found');
      node = node[at];
    } else if (isObject(node)) {
      if (!hasOwn(node, seg)) throw new PatchError(index, 'not_found');
      node = node[seg];
    } else {
      throw new PatchError(index, 'not_found');
    }
  }
  return { parent: node, key: tokens[tokens.length - 1] };
}

function setOwn(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

function getAt(doc, tokens, index) {
  if (tokens.length === 0) return doc;
  const { parent, key } = locate(doc, tokens, index);
  if (Array.isArray(parent)) {
    const at = arrayIndex(key, parent.length, false, index);
    if (at >= parent.length) throw new PatchError(index, 'not_found');
    return parent[at];
  }
  if (isObject(parent) && hasOwn(parent, key)) return parent[key];
  throw new PatchError(index, 'not_found');
}

function addAt(doc, tokens, value, index) {
  if (tokens.length === 0) return value;
  const { parent, key } = locate(doc, tokens, index);
  if (Array.isArray(parent)) {
    const at = arrayIndex(key, parent.length, true, index);
    if (at > parent.length) throw new PatchError(index, 'out_of_bounds');
    parent.splice(at, 0, value);
  } else if (isObject(parent)) {
    setOwn(parent, key, value);
  } else {
    throw new PatchError(index, 'not_found');
  }
  return doc;
}

function removeAt(doc, tokens, index) {
  if (tokens.length === 0) throw new PatchError(index, 'invalid_operation');
  const { parent, key } = locate(doc, tokens, index);
  if (Array.isArray(parent)) {
    const at = arrayIndex(key, parent.length, false, index);
    if (at >= parent.length) throw new PatchError(index, 'not_found');
    return { doc, removed: parent.splice(at, 1)[0] };
  }
  if (isObject(parent) && hasOwn(parent, key)) {
    const removed = parent[key];
    delete parent[key];
    return { doc, removed };
  }
  throw new PatchError(index, 'not_found');
}

function applyPatch(document, patch) {
  if (!Array.isArray(patch)) throw new TypeError('patch must be an array');
  let doc = clone(document);
  patch.forEach((op, index) => {
    if (!isObject(op) || typeof op.op !== 'string') throw new PatchError(index, 'invalid_operation');
    const name = op.op;
    if (!['add', 'remove', 'replace', 'move', 'copy', 'test'].includes(name)) throw new PatchError(index, 'invalid_operation');
    const path = parsePointer(op.path, index);
    if ((name === 'add' || name === 'replace' || name === 'test') && !hasOwn(op, 'value')) throw new PatchError(index, 'invalid_operation');
    if ((name === 'move' || name === 'copy') && typeof op.from !== 'string') throw new PatchError(index, 'invalid_operation');
    if (name === 'add') {
      doc = addAt(doc, path, clone(op.value), index);
    } else if (name === 'remove') {
      doc = removeAt(doc, path, index).doc;
    } else if (name === 'replace') {
      if (path.length === 0) {
        doc = clone(op.value);
      } else {
        getAt(doc, path, index);
        const { parent, key } = locate(doc, path, index);
        if (Array.isArray(parent)) parent[arrayIndex(key, parent.length, false, index)] = clone(op.value);
        else setOwn(parent, key, clone(op.value));
      }
    } else if (name === 'test') {
      if (!equal(getAt(doc, path, index), op.value)) throw new PatchError(index, 'test_failed');
    } else {
      const from = parsePointer(op.from, index);
      if (name === 'copy') {
        doc = addAt(doc, path, clone(getAt(doc, from, index)), index);
      } else {
        if (path.length > from.length && from.every((s, i) => s === path[i])) throw new PatchError(index, 'invalid_operation');
        if (from.length === path.length && from.every((s, i) => s === path[i])) {
          getAt(doc, from, index);
        } else {
          const { removed } = removeAt(doc, from, index);
          doc = addAt(doc, path, removed, index);
        }
      }
    }
  });
  return doc;
}

module.exports = { applyPatch, PatchError };
