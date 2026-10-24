'use strict';

const EXPONENT = { USD: 2, EUR: 2, JPY: 0, KWD: 3 };
const MODES = ['half-even', 'half-up', 'half-down', 'down', 'up', 'floor', 'ceil'];

function exponentOf(currency) {
  if (typeof currency !== 'string' || !Object.prototype.hasOwnProperty.call(EXPONENT, currency)) throw new Error(`unknown currency: ${currency}`);
  return EXPONENT[currency];
}

function make(minor, currency) {
  return { minor, currency };
}

function check(m) {
  if (m === null || typeof m !== 'object' || typeof m.minor !== 'bigint') throw new TypeError('not an amount of money');
  exponentOf(m.currency);
}

function parse(text, currency) {
  if (typeof text !== 'string') throw new TypeError('amount must be a string');
  const exp = exponentOf(currency);
  const m = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error(`invalid amount: ${text}`);
  const frac = m[3] ?? '';
  if (frac.length > exp) throw new Error(`invalid amount: ${text}`);
  const digits = `${m[2].replace(/,/g, '')}${frac.padEnd(exp, '0')}`;
  const value = BigInt(digits);
  return make(m[1] && value !== 0n ? -value : value, currency);
}

function format(m) {
  check(m);
  const exp = exponentOf(m.currency);
  const negative = m.minor < 0n;
  const digits = (negative ? -m.minor : m.minor).toString().padStart(exp + 1, '0');
  const whole = digits.slice(0, digits.length - exp).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = exp === 0 ? '' : `.${digits.slice(digits.length - exp)}`;
  return `${negative ? '-' : ''}${whole}${frac}`;
}

function sameCurrency(a, b) {
  check(a);
  check(b);
  if (a.currency !== b.currency) throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
}

function add(a, b) {
  sameCurrency(a, b);
  return make(a.minor + b.minor, a.currency);
}

function sub(a, b) {
  sameCurrency(a, b);
  return make(a.minor - b.minor, a.currency);
}

/** Divide n by d (d > 0) and round the exact quotient by `mode`. */
function divRound(n, d, mode) {
  const negative = n < 0n;
  const abs = negative ? -n : n;
  let q = abs / d;
  const r = abs % d;
  if (r !== 0n) {
    const twice = r * 2n;
    let bump;
    switch (mode) {
      case 'half-even':
        bump = twice > d || (twice === d && q % 2n === 1n);
        break;
      case 'half-up':
        bump = twice >= d;
        break;
      case 'half-down':
        bump = twice > d;
        break;
      case 'down':
        bump = false;
        break;
      case 'up':
        bump = true;
        break;
      case 'floor':
        bump = negative;
        break;
      case 'ceil':
        bump = !negative;
        break;
      default:
        throw new Error(`unknown rounding mode: ${mode}`);
    }
    if (bump) q += 1n;
  }
  return negative ? -q : q;
}

function mul(m, factor, mode = 'half-even') {
  check(m);
  if (!MODES.includes(mode)) throw new Error(`unknown rounding mode: ${mode}`);
  const f = typeof factor === 'string' ? /^(-)?(\d+)(?:\.(\d+))?$/.exec(factor) : null;
  if (!f) throw new Error(`invalid factor: ${factor}`);
  const frac = f[3] ?? '';
  const numerator = BigInt(`${f[2]}${frac}`) * (f[1] ? -1n : 1n);
  return make(divRound(m.minor * numerator, 10n ** BigInt(frac.length), mode), m.currency);
}

function allocate(m, weights) {
  check(m);
  const ok = Array.isArray(weights) && weights.length > 0 && weights.every((w) => Number.isSafeInteger(w) && w >= 0) && weights.some((w) => w > 0);
  if (!ok) throw new Error('weights must be non-negative whole numbers with a positive sum');
  const total = weights.reduce((s, w) => s + BigInt(w), 0n);
  const negative = m.minor < 0n;
  const abs = negative ? -m.minor : m.minor;
  const parts = weights.map((w) => ({ base: (abs * BigInt(w)) / total, rem: (abs * BigInt(w)) % total }));
  let left = abs - parts.reduce((s, p) => s + p.base, 0n);
  const order = parts.map((p, i) => i).sort((i, j) => (parts[j].rem > parts[i].rem ? 1 : parts[j].rem < parts[i].rem ? -1 : i - j));
  for (const i of order) {
    if (left === 0n) break;
    parts[i].base += 1n;
    left -= 1n;
  }
  return parts.map((p) => make(negative ? -p.base : p.base, m.currency));
}

function split(m, n) {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('parts must be a positive whole number');
  return allocate(m, Array(n).fill(1));
}

module.exports = { parse, format, add, sub, mul, allocate, split };
