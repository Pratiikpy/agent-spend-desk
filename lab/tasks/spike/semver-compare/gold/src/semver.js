'use strict';

const NUM = '0|[1-9][0-9]*';
const PRE_ID = '0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*';
const BUILD_ID = '[0-9A-Za-z-]+';
const RE = new RegExp(
  `^(${NUM})\\.(${NUM})\\.(${NUM})(?:-((?:${PRE_ID})(?:\\.(?:${PRE_ID}))*))?(?:\\+(${BUILD_ID}(?:\\.${BUILD_ID})*))?$`,
);

function parse(version) {
  const m = typeof version === 'string' ? RE.exec(version) : null;
  if (!m) throw new TypeError(`invalid version: ${String(version)}`);
  return { core: [BigInt(m[1]), BigInt(m[2]), BigInt(m[3])], pre: m[4] === undefined ? [] : m[4].split('.') };
}

function isValid(version) {
  return typeof version === 'string' && RE.test(version);
}

function compareIdentifier(x, y) {
  const xNumeric = /^[0-9]+$/.test(x);
  const yNumeric = /^[0-9]+$/.test(y);
  if (xNumeric && yNumeric) {
    const a = BigInt(x);
    const b = BigInt(y);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (xNumeric) return -1;
  if (yNumeric) return 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

function compare(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  const shared = Math.min(pa.pre.length, pb.pre.length);
  for (let i = 0; i < shared; i += 1) {
    const c = compareIdentifier(pa.pre[i], pb.pre[i]);
    if (c !== 0) return c;
  }
  return pa.pre.length === pb.pre.length ? 0 : pa.pre.length < pb.pre.length ? -1 : 1;
}

function sortVersions(versions) {
  if (!Array.isArray(versions)) throw new TypeError('versions must be an array');
  for (const v of versions) parse(v);
  return [...versions].sort(compare);
}

module.exports = { isValid, compare, sortVersions };
