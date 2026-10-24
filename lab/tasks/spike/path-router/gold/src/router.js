'use strict';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function segments(path) {
  return path.split('/').filter((s) => s !== '');
}

function node() {
  return { statics: new Map(), param: null, wild: null, route: null };
}

class Router {
  constructor() {
    this._root = node();
    this._shapes = new Set();
  }

  add(pattern, handler) {
    const invalid = () => new Error(`invalid route: ${pattern}`);
    if (typeof pattern !== 'string' || !pattern.startsWith('/')) throw invalid();
    const parts = segments(pattern);
    const names = [];
    const shape = [];
    parts.forEach((part, i) => {
      if (part === '*') {
        if (i !== parts.length - 1) throw invalid();
        shape.push('*');
      } else if (part.startsWith(':')) {
        const name = part.slice(1);
        if (!NAME.test(name) || name === '__proto__' || names.includes(name)) throw invalid();
        names.push(name);
        shape.push(':');
      } else {
        shape.push(`=${part}`);
      }
    });
    const key = shape.join('/');
    if (this._shapes.has(key)) throw new Error(`duplicate route: ${pattern}`);
    this._shapes.add(key);

    let at = this._root;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (part === '*') {
        at.wild = { handler, names: [...names, '*'] };
        return this;
      }
      if (part.startsWith(':')) {
        at.param = at.param || node();
        at = at.param;
      } else {
        if (!at.statics.has(part)) at.statics.set(part, node());
        at = at.statics.get(part);
      }
    }
    at.route = { handler, names };
    return this;
  }

  match(path) {
    if (typeof path !== 'string') return null;
    let parts;
    try {
      parts = segments(path).map((s) => decodeURIComponent(s));
    } catch {
      return null;
    }
    const found = walk(this._root, parts, 0, []);
    if (!found) return null;
    const params = {};
    found.route.names.forEach((name, i) => {
      params[name] = found.values[i];
    });
    return { handler: found.route.handler, params };
  }
}

function walk(at, parts, i, values) {
  if (i === parts.length) return at.route ? { route: at.route, values } : null;
  const part = parts[i];
  const next = at.statics.get(part);
  if (next) {
    const hit = walk(next, parts, i + 1, values);
    if (hit) return hit;
  }
  if (at.param) {
    const hit = walk(at.param, parts, i + 1, [...values, part]);
    if (hit) return hit;
  }
  if (at.wild) return { route: at.wild, values: [...values, parts.slice(i).join('/')] };
  return null;
}

module.exports = { Router };
