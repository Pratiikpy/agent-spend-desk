'use strict';

const ID = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const VERSION = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${ID}(?:\\.${ID})*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`);
const PART = '(\\d+|[xX*])';
const PARTIAL = new RegExp(`^${PART}(?:\\.${PART})?(?:\\.${PART})?(?:-(${ID}(?:\\.${ID})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);

function parseVersion(text) {
  if (typeof text !== 'string') throw new TypeError('version must be a string');
  const m = VERSION.exec(text);
  if (!m) throw new Error(`invalid version: ${text}`);
  const nums = [m[1], m[2], m[3]].map(Number);
  if (!nums.every(Number.isSafeInteger)) throw new Error(`invalid version: ${text}`);
  return { major: nums[0], minor: nums[1], patch: nums[2], pre: m[4] ? m[4].split('.') : [] };
}

function compareIds(a, b) {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return Number(a) === Number(b) ? 0 : Number(a) < Number(b) ? -1 : 1;
  if (an) return -1;
  if (bn) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function compare(a, b) {
  for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i += 1) {
    if (a.pre[i] === undefined) return -1;
    if (b.pre[i] === undefined) return 1;
    const c = compareIds(a.pre[i], b.pre[i]);
    if (c !== 0) return c;
  }
  return 0;
}

const v = (major, minor, patch, pre = []) => ({ major, minor, patch, pre });
const NEVER = [{ op: 'never' }];

function parsePartial(text, range) {
  const m = PARTIAL.exec(text);
  if (!m) throw new Error(`invalid range: ${range}`);
  const wild = (s) => s === undefined || /^[xX*]$/.test(s);
  const parts = [m[1], m[2], m[3]];
  const out = { major: null, minor: null, patch: null, pre: m[4] ? m[4].split('.') : [] };
  if (!wild(parts[0])) {
    out.major = Number(parts[0]);
    if (!wild(parts[1])) {
      out.minor = Number(parts[1]);
      if (!wild(parts[2])) out.patch = Number(parts[2]);
    }
  }
  if (out.patch === null && out.pre.length > 0) throw new Error(`invalid range: ${range}`);
  for (const n of [out.major, out.minor, out.patch]) if (n !== null && !Number.isSafeInteger(n)) throw new Error(`invalid range: ${range}`);
  return out;
}

const gte = (x) => ({ op: '>=', v: x });
const lt = (x) => ({ op: '<', v: x });

/** The comparators a partial version stands for with a given operator. */
function primitive(op, p) {
  const { major: M, minor: m, patch: pt, pre } = p;
  if (M === null) return op === '>' || op === '<' ? NEVER : [];
  if (m === null) {
    if (op === '' || op === '=') return [gte(v(M, 0, 0)), lt(v(M + 1, 0, 0))];
    if (op === '>') return [gte(v(M + 1, 0, 0))];
    if (op === '>=') return [gte(v(M, 0, 0))];
    if (op === '<') return [lt(v(M, 0, 0))];
    return [lt(v(M + 1, 0, 0))];
  }
  if (pt === null) {
    if (op === '' || op === '=') return [gte(v(M, m, 0)), lt(v(M, m + 1, 0))];
    if (op === '>') return [gte(v(M, m + 1, 0))];
    if (op === '>=') return [gte(v(M, m, 0))];
    if (op === '<') return [lt(v(M, m, 0))];
    return [lt(v(M, m + 1, 0))];
  }
  const full = v(M, m, pt, pre);
  return [{ op: op === '' ? '=' : op, v: full }];
}

function tilde(p) {
  const { major: M, minor: m, patch: pt, pre } = p;
  if (M === null) return [];
  if (m === null) return [gte(v(M, 0, 0)), lt(v(M + 1, 0, 0))];
  if (pt === null) return [gte(v(M, m, 0)), lt(v(M, m + 1, 0))];
  return [gte(v(M, m, pt, pre)), lt(v(M, m + 1, 0))];
}

function caret(p) {
  const { major: M, minor: m, patch: pt, pre } = p;
  if (M === null) return [];
  if (m === null) return [gte(v(M, 0, 0)), lt(v(M + 1, 0, 0))];
  if (pt === null) {
    if (M > 0) return [gte(v(M, m, 0)), lt(v(M + 1, 0, 0))];
    return [gte(v(0, m, 0)), lt(v(0, m + 1, 0))];
  }
  const low = gte(v(M, m, pt, pre));
  if (M > 0) return [low, lt(v(M + 1, 0, 0))];
  if (m > 0) return [low, lt(v(0, m + 1, 0))];
  return [low, lt(v(0, 0, pt + 1))];
}

function hyphen(a, b, range) {
  const lo = parsePartial(a, range);
  const hi = parsePartial(b, range);
  const out = [];
  if (lo.major !== null) out.push(gte(v(lo.major, lo.minor ?? 0, lo.patch ?? 0, lo.patch === null ? [] : lo.pre)));
  if (hi.major !== null) {
    if (hi.minor === null) out.push(lt(v(hi.major + 1, 0, 0)));
    else if (hi.patch === null) out.push(lt(v(hi.major, hi.minor + 1, 0)));
    else out.push({ op: '<=', v: v(hi.major, hi.minor, hi.patch, hi.pre) });
  }
  return out;
}

function parseSet(text, range) {
  const t = text.trim();
  if (t === '') return [];
  const h = /^(\S+)\s+-\s+(\S+)$/.exec(t);
  if (h) return hyphen(h[1], h[2], range);
  const out = [];
  for (const token of t.split(/\s+/)) {
    const m = /^(<=|>=|<|>|=|~|\^)?(.+)$/.exec(token);
    if (!m) throw new Error(`invalid range: ${range}`);
    const p = parsePartial(m[2], range);
    const op = m[1] ?? '';
    if (op === '~') out.push(...tilde(p));
    else if (op === '^') out.push(...caret(p));
    else out.push(...primitive(op, p));
  }
  return out;
}

function parseRange(range) {
  if (typeof range !== 'string') throw new Error(`invalid range: ${range}`);
  return range.split('||').map((s) => parseSet(s, range));
}

function holds(c, ver) {
  if (c.op === 'never') return false;
  const r = compare(ver, c.v);
  switch (c.op) {
    case '>=':
      return r >= 0;
    case '>':
      return r > 0;
    case '<':
      return r < 0;
    case '<=':
      return r <= 0;
    default:
      return r === 0;
  }
}

function setSatisfies(set, ver, includePrerelease) {
  if (!set.every((c) => holds(c, ver))) return false;
  if (ver.pre.length === 0 || includePrerelease) return true;
  return set.some((c) => c.v && c.v.pre.length > 0 && c.v.major === ver.major && c.v.minor === ver.minor && c.v.patch === ver.patch);
}

function satisfies(version, range, options = {}) {
  const ver = parseVersion(version);
  const sets = parseRange(range);
  const include = options.includePrerelease === true;
  return sets.some((s) => setSatisfies(s, ver, include));
}

function maxSatisfying(versions, range, options = {}) {
  const sets = parseRange(range);
  const include = options.includePrerelease === true;
  let best = null;
  let bestParsed = null;
  for (const text of versions) {
    let ver;
    try {
      ver = parseVersion(text);
    } catch {
      continue;
    }
    if (!sets.some((s) => setSatisfies(s, ver, include))) continue;
    if (bestParsed === null || compare(ver, bestParsed) > 0) {
      best = text;
      bestParsed = ver;
    }
  }
  return best;
}

module.exports = { satisfies, maxSatisfying };
