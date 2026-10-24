'use strict';

/** Find the brace group that starts at `open`: its end, and the positions of its top-level commas; null when it never closes. */
function braceGroup(p, open) {
  let depth = 0;
  const commas = [];
  for (let i = open; i < p.length; i += 1) {
    const c = p[i];
    if (c === '\\') {
      i += 1;
    } else if (c === '[') {
      const end = classEnd(p, i);
      if (end !== -1) i = end;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) return { close: i, commas };
    } else if (c === ',' && depth === 1) {
      commas.push(i);
    }
  }
  return null;
}

/** Where a class that opens at `open` ends, or -1 when it is not closed. */
function classEnd(p, open) {
  let i = open + 1;
  if (p[i] === '!' || p[i] === '^') i += 1;
  if (p[i] === ']') i += 1;
  for (; i < p.length; i += 1) {
    if (p[i] === '\\') i += 1;
    else if (p[i] === ']') return i;
  }
  return -1;
}

/** All patterns a pattern stands for once its alternations are written out. */
function expand(p) {
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '\\') {
      i += 1;
    } else if (c === '[') {
      const end = classEnd(p, i);
      if (end !== -1) i = end;
    } else if (c === '{') {
      const g = braceGroup(p, i);
      if (g === null) continue;
      if (g.commas.length === 0) {
        // Not an alternation: the braces are ordinary characters, but what is inside may still contain some.
        const inner = expand(p.slice(i + 1, g.close));
        const rest = expand(p.slice(g.close + 1));
        const out = [];
        for (const a of inner) for (const b of rest) out.push(`${p.slice(0, i)}\\{${a}\\}${b}`);
        return out;
      }
      const cuts = [i, ...g.commas, g.close];
      const alts = [];
      for (let k = 0; k < cuts.length - 1; k += 1) alts.push(p.slice(cuts[k] + 1, cuts[k + 1]));
      const rest = expand(p.slice(g.close + 1));
      const out = [];
      for (const alt of alts) for (const a of expand(alt)) for (const b of rest) out.push(`${p.slice(0, i)}${a}${b}`);
      return out;
    }
  }
  return [p];
}

/** A segment as a list of tokens: a literal character, any one character, any run, or a class. */
function tokens(seg) {
  const out = [];
  const chars = Array.from(seg);
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    if (c === '\\' && i + 1 < chars.length) {
      i += 1;
      out.push({ t: 'lit', c: chars[i] });
    } else if (c === '*') {
      if (out.length === 0 || out[out.length - 1].t !== 'star') out.push({ t: 'star' });
    } else if (c === '?') {
      out.push({ t: 'any' });
    } else if (c === '[') {
      const rest = chars.slice(i).join('');
      const end = classEnd(rest, 0);
      if (end === -1) {
        out.push({ t: 'lit', c: '[' });
      } else {
        const inner = Array.from(rest.slice(1, end));
        let neg = false;
        let j = 0;
        if (inner[0] === '!' || inner[0] === '^') {
          neg = true;
          j = 1;
        }
        const items = [];
        for (; j < inner.length; j += 1) {
          let a = inner[j];
          if (a === '\\' && j + 1 < inner.length) {
            j += 1;
            a = inner[j];
          }
          if (inner[j + 1] === '-' && j + 2 < inner.length) {
            let b = inner[j + 2];
            let skip = 2;
            if (b === '\\' && j + 3 < inner.length) {
              b = inner[j + 3];
              skip = 3;
            }
            items.push([a, b]);
            j += skip;
          } else {
            items.push([a, a]);
          }
        }
        out.push({ t: 'class', neg, items });
        i += Array.from(rest.slice(0, end + 1)).length - 1;
      }
    } else {
      out.push({ t: 'lit', c });
    }
  }
  return out;
}

function sameChar(a, b, nocase) {
  return a === b || (nocase && a.toLowerCase() === b.toLowerCase());
}

function inClass(tok, ch, nocase) {
  const cp = ch.codePointAt(0);
  const variants = nocase ? [ch, ch.toLowerCase(), ch.toUpperCase()] : [ch];
  const hit = tok.items.some(([a, b]) => variants.some((v) => v.codePointAt(0) >= a.codePointAt(0) && v.codePointAt(0) <= b.codePointAt(0)));
  void cp;
  return tok.neg ? !hit : hit;
}

function matchSegment(patSeg, pathSeg, opts) {
  const toks = tokens(patSeg);
  const chars = Array.from(pathSeg);
  if (chars[0] === '.' && !opts.dot) {
    const first = toks[0];
    if (!first || first.t !== 'lit' || first.c !== '.') return false;
  }
  const memo = new Map();
  const go = (ti, ci) => {
    const key = ti * (chars.length + 1) + ci;
    if (memo.has(key)) return memo.get(key);
    let r;
    if (ti === toks.length) r = ci === chars.length;
    else {
      const t = toks[ti];
      if (t.t === 'star') {
        r = false;
        for (let k = ci; k <= chars.length && !r; k += 1) r = go(ti + 1, k);
      } else if (ci >= chars.length) r = false;
      else if (t.t === 'any') r = go(ti + 1, ci + 1);
      else if (t.t === 'lit') r = sameChar(t.c, chars[ci], opts.nocase) && go(ti + 1, ci + 1);
      else r = inClass(t, chars[ci], opts.nocase) && go(ti + 1, ci + 1);
    }
    memo.set(key, r);
    return r;
  };
  return go(0, 0);
}

function matchPath(patSegs, pathSegs, opts) {
  const memo = new Map();
  const go = (pi, si) => {
    const key = pi * (pathSegs.length + 1) + si;
    if (memo.has(key)) return memo.get(key);
    let r;
    if (pi === patSegs.length) r = si === pathSegs.length;
    else if (patSegs[pi] === '**') {
      r = go(pi + 1, si);
      for (let k = si; k < pathSegs.length && !r; k += 1) {
        if (pathSegs[k][0] === '.' && !opts.dot) break;
        r = go(pi + 1, k + 1);
      }
    } else if (si >= pathSegs.length) r = false;
    else r = matchSegment(patSegs[pi], pathSegs[si], opts) && go(pi + 1, si + 1);
    memo.set(key, r);
    return r;
  };
  return go(0, 0);
}

function match(pattern, path, options = {}) {
  if (typeof pattern !== 'string' || typeof path !== 'string') throw new TypeError('pattern and path must be strings');
  if (path === '' || path.startsWith('/') || path.endsWith('/') || path.includes('//')) throw new Error(`invalid path: ${path}`);
  let body = pattern;
  let negate = false;
  if (body.startsWith('!')) {
    negate = true;
    body = body.slice(1);
  }
  if (body === '' || body.startsWith('/') || body.endsWith('/') || body.includes('//')) throw new Error(`invalid pattern: ${pattern}`);
  const opts = { dot: options.dot === true, nocase: options.nocase === true };
  const pathSegs = path.split('/');
  const hit = expand(body).some((p) => {
    const segs = p.split('/');
    if (segs.some((s) => s === '')) return false;
    return matchPath(segs, pathSegs, opts);
  });
  return negate ? !hit : hit;
}

module.exports = { match };
