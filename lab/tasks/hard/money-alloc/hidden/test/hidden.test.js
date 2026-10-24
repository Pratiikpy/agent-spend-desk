'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, format, add, sub, mul, allocate, split } = require('../src/money.js');

const usd = (minor) => ({ minor: BigInt(minor), currency: 'USD' });
const errorWith = (message) => (e) => e instanceof Error && !(e instanceof TypeError) && e.message === message;

test('parse reads digits, optional thousands groups and a fraction with at most the currency exponent of digits', () => {
  assert.deepEqual(parse('1234.5', 'USD'), usd(123450));
  assert.deepEqual(parse('1,234.50', 'USD'), usd(123450));
  assert.deepEqual(parse('-0.05', 'USD'), usd(-5));
  assert.deepEqual(parse('0', 'USD'), usd(0));
  assert.deepEqual(parse('1,000,000.00', 'USD'), usd(100000000));
  assert.deepEqual(parse('1000000', 'USD'), usd(100000000));
  assert.deepEqual(parse('12', 'JPY'), { minor: 12n, currency: 'JPY' });
  assert.deepEqual(parse('1.5', 'KWD'), { minor: 1500n, currency: 'KWD' });
  assert.deepEqual(parse('1.500', 'KWD'), { minor: 1500n, currency: 'KWD' });
  assert.deepEqual(parse('0.1', 'EUR'), { minor: 10n, currency: 'EUR' });
  assert.deepEqual(parse('123456789012345678901234567890.99', 'USD'), usd(12345678901234567890123456789099n));
});

test('there is no negative zero', () => {
  assert.equal(parse('-0', 'USD').minor, 0n);
  assert.equal(format(parse('-0.00', 'USD')), '0.00');
});

test('parse refuses anything else, naming the text as it was given', () => {
  for (const text of ['', ' 1', '1 ', '1,2', '12,34,567', '1,23', ',123', '1.', '.5', '+1', '1e3', '--1', '1.234', 'abc', '1,234.5.6', '1 000', '$1', '1_000', '١٢']) {
    assert.throws(() => parse(text, 'USD'), errorWith(`invalid amount: ${text}`), JSON.stringify(text));
  }
  assert.throws(() => parse('1.5', 'JPY'), errorWith('invalid amount: 1.5'));
  assert.throws(() => parse('1.0', 'JPY'), errorWith('invalid amount: 1.0'));
  assert.throws(() => parse('1.2345', 'KWD'), errorWith('invalid amount: 1.2345'));
  assert.throws(() => parse('1', 'GBP'), errorWith('unknown currency: GBP'));
  assert.throws(() => parse('1', 'usd'), errorWith('unknown currency: usd'));
  assert.throws(() => parse('1', 'constructor'), errorWith('unknown currency: constructor'));
  assert.throws(() => parse('1', undefined), errorWith('unknown currency: undefined'));
  for (const bad of [1, null, undefined, {}]) assert.throws(() => parse(bad, 'USD'), (e) => e instanceof TypeError && e.message === 'amount must be a string');
});

test('format writes thousands groups, the full fraction and a minus sign for a negative amount', () => {
  assert.equal(format(parse('1,234,567.89', 'USD')), '1,234,567.89');
  assert.equal(format(usd(5)), '0.05');
  assert.equal(format(usd(-5)), '-0.05');
  assert.equal(format(usd(0)), '0.00');
  assert.equal(format(usd(100)), '1.00');
  assert.equal(format(usd(-123456)), '-1,234.56');
  assert.equal(format({ minor: 1234567n, currency: 'JPY' }), '1,234,567');
  assert.equal(format({ minor: 0n, currency: 'JPY' }), '0');
  assert.equal(format({ minor: 1n, currency: 'KWD' }), '0.001');
  assert.equal(format({ minor: -1234567n, currency: 'KWD' }), '-1,234.567');
  assert.equal(format({ minor: 10n ** 30n, currency: 'USD' }), '10,000,000,000,000,000,000,000,000,000.00');
  assert.equal(format({ minor: 999n, currency: 'USD' }), '9.99');
  assert.equal(format({ minor: 100000n, currency: 'USD' }), '1,000.00');
});

test('format and parse are inverses', () => {
  for (const [minor, currency] of [[0n, 'USD'], [1n, 'USD'], [99n, 'EUR'], [-100000n, 'USD'], [123456789n, 'JPY'], [-1n, 'KWD'], [10n ** 25n + 7n, 'USD']]) {
    assert.deepEqual(parse(format({ minor, currency }), currency), { minor, currency });
  }
});

test('add and sub work in minor units, return new plain objects, and leave their arguments alone', () => {
  const a = usd(1050);
  const b = usd(295);
  const sum = add(a, b);
  const diff = sub(a, b);
  assert.deepEqual(sum, usd(1345));
  assert.deepEqual(diff, usd(755));
  assert.deepEqual(sub(b, a), usd(-755));
  assert.deepEqual(a, usd(1050));
  assert.deepEqual(b, usd(295));
  assert.notEqual(sum, a);
  assert.deepEqual(Object.keys(sum).sort(), ['currency', 'minor']);
  assert.equal(typeof sum.minor, 'bigint');
});

test('amounts of different currencies are never combined', () => {
  assert.throws(() => add(usd(1), { minor: 1n, currency: 'EUR' }), errorWith('currency mismatch: USD vs EUR'));
  assert.throws(() => sub({ minor: 1n, currency: 'JPY' }, usd(1)), errorWith('currency mismatch: JPY vs USD'));
});

test('mul rounds the exact product by the mode: half-even is the default', () => {
  const m = (n, f, mode) => mul(usd(n), f, mode).minor;
  assert.equal(m(25, '0.1'), 2n);
  assert.equal(m(35, '0.1'), 4n);
  assert.equal(m(-25, '0.1'), -2n);
  assert.equal(m(-35, '0.1'), -4n);
  assert.equal(m(26, '0.1'), 3n);
  assert.equal(m(24, '0.1'), 2n);
  assert.equal(m(25, '0.1', 'half-even'), 2n);
});

test('mul modes: half-up and half-down send exact halves away from zero and toward it', () => {
  const m = (n, f, mode) => mul(usd(n), f, mode).minor;
  assert.equal(m(25, '0.1', 'half-up'), 3n);
  assert.equal(m(-25, '0.1', 'half-up'), -3n);
  assert.equal(m(24, '0.1', 'half-up'), 2n);
  assert.equal(m(25, '0.1', 'half-down'), 2n);
  assert.equal(m(-25, '0.1', 'half-down'), -2n);
  assert.equal(m(26, '0.1', 'half-down'), 3n);
  assert.equal(m(-26, '0.1', 'half-down'), -3n);
});

test('mul modes: down and up go toward and away from zero, floor and ceil toward minus and plus infinity', () => {
  const m = (n, f, mode) => mul(usd(n), f, mode).minor;
  assert.equal(m(29, '0.1', 'down'), 2n);
  assert.equal(m(-29, '0.1', 'down'), -2n);
  assert.equal(m(21, '0.1', 'up'), 3n);
  assert.equal(m(-21, '0.1', 'up'), -3n);
  assert.equal(m(20, '0.1', 'up'), 2n);
  assert.equal(m(21, '0.1', 'floor'), 2n);
  assert.equal(m(-21, '0.1', 'floor'), -3n);
  assert.equal(m(20, '0.1', 'floor'), 2n);
  assert.equal(m(21, '0.1', 'ceil'), 3n);
  assert.equal(m(-21, '0.1', 'ceil'), -2n);
  assert.equal(m(-20, '0.1', 'ceil'), -2n);
});

test('mul is exact for large amounts and long factors', () => {
  assert.equal(mul(usd(10000), '1.075').minor, 10750n);
  assert.equal(mul({ minor: 12345678901234567890n, currency: 'USD' }, '0.5').minor, 6172839450617283945n);
  assert.equal(mul({ minor: 12345678901234567891n, currency: 'USD' }, '0.5', 'half-even').minor, 6172839450617283946n);
  assert.equal(mul({ minor: 12345678901234567891n, currency: 'USD' }, '0.5', 'down').minor, 6172839450617283945n);
  assert.equal(mul(usd(100), '0.005').minor, 0n);
  assert.equal(mul(usd(100), '0.005', 'half-up').minor, 1n);
  assert.equal(mul(usd(300), '0.0049999999999999999999').minor, 1n);
  assert.equal(mul(usd(100), '-0.5').minor, -50n);
  assert.equal(mul(usd(100), '0').minor, 0n);
  assert.equal(mul(usd(100), '2').minor, 200n);
  assert.equal(mul(usd(-100), '-2').minor, 200n);
  assert.equal(mul(usd(7), '0.3333333333333333333333').minor, 2n);
  assert.equal(mul({ minor: 5n, currency: 'JPY' }, '0.5').minor, 2n);
  assert.equal(mul({ minor: 7n, currency: 'JPY' }, '0.5').minor, 4n);
  assert.deepEqual(mul(usd(100), '1.5'), usd(150));
});

test('mul refuses a factor that is not a plain decimal string and a mode it does not know', () => {
  for (const factor of ['', '.5', '1.', '+1', '1e2', ' 1', '1 ', 'abc', '1.2.3', '--1', 1.5, 2, null, undefined, {}]) {
    assert.throws(() => mul(usd(100), factor), errorWith(`invalid factor: ${factor}`), String(factor));
  }
  for (const mode of ['banker', 'HALF-UP', 'round', '', 'half_even']) assert.throws(() => mul(usd(100), '1', mode), errorWith(`unknown rounding mode: ${mode}`), mode);
});

test('allocate shares an amount by whole-number weights and no minor unit is lost: the largest remainders get the extra units, earlier parts first on a tie', () => {
  assert.deepEqual(allocate(usd(100), [1, 1, 1]), [usd(34), usd(33), usd(33)]);
  assert.deepEqual(allocate(usd(5), [3, 7]), [usd(2), usd(3)]);
  assert.deepEqual(allocate(usd(5), [70, 30]), [usd(4), usd(1)]);
  assert.deepEqual(allocate(usd(10), [1, 0, 2]), [usd(3), usd(0), usd(7)]);
  assert.deepEqual(allocate(usd(101), [1, 1]), [usd(51), usd(50)]);
  assert.deepEqual(allocate(usd(2), [1, 1, 1]), [usd(1), usd(1), usd(0)]);
  assert.deepEqual(allocate(usd(1), [1, 1, 1]), [usd(1), usd(0), usd(0)]);
  assert.deepEqual(allocate(usd(100), [5]), [usd(100)]);
  assert.deepEqual(allocate(usd(0), [1, 2]), [usd(0), usd(0)]);
  assert.deepEqual(allocate(usd(7), [0, 1, 0]), [usd(0), usd(7), usd(0)]);
  assert.deepEqual(allocate(usd(100), [1, 2, 3, 4]), [usd(10), usd(20), usd(30), usd(40)]);
  assert.deepEqual(allocate(usd(10), [3, 3, 3]), [usd(4), usd(3), usd(3)]);
});

test('allocate treats a negative amount by its size and gives every part the minus sign', () => {
  assert.deepEqual(allocate(usd(-100), [1, 1, 1]), [usd(-34), usd(-33), usd(-33)]);
  assert.deepEqual(allocate(usd(-5), [3, 7]), [usd(-2), usd(-3)]);
  assert.equal(allocate(usd(-1), [1, 1])[1].minor, 0n);
});

test('allocate keeps the currency and handles amounts far beyond the safe integer range', () => {
  const big = { minor: 10n ** 25n, currency: 'KWD' };
  const parts = allocate(big, [1, 2, 3]);
  assert.equal(parts.reduce((s, p) => s + p.minor, 0n), 10n ** 25n);
  assert.deepEqual(parts.map((p) => p.currency), ['KWD', 'KWD', 'KWD']);
  assert.deepEqual(parts.map((p) => p.minor), [1666666666666666666666667n, 3333333333333333333333333n, 5000000000000000000000000n]);
});

test('allocate refuses weights that are not non-negative whole numbers with a positive sum, and does not change the array it is given', () => {
  for (const weights of [[], [0, 0], [-1, 2], [1.5, 1], ['1', 2], null, undefined, [1, NaN], [2 ** 53], 5, [1, Infinity]]) {
    assert.throws(() => allocate(usd(100), weights), errorWith('weights must be non-negative whole numbers with a positive sum'), String(weights));
  }
  const weights = [3, 1, 2];
  allocate(usd(100), weights);
  assert.deepEqual(weights, [3, 1, 2]);
});

test('allocate always adds up exactly, and no part is more than one unit away from its exact share', () => {
  let seed = 424242;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let round = 0; round < 400; round += 1) {
    const amount = BigInt(rnd(100000)) * (rnd(2) === 0 ? 1n : -1n);
    const weights = Array.from({ length: 1 + rnd(6) }, () => rnd(8));
    if (weights.every((w) => w === 0)) weights[0] = 1;
    const parts = allocate({ minor: amount, currency: 'USD' }, weights);
    const total = weights.reduce((s, w) => s + BigInt(w), 0n);
    assert.equal(parts.reduce((s, p) => s + p.minor, 0n), amount);
    parts.forEach((p, i) => {
      const exact = (amount * BigInt(weights[i])) / total;
      const diff = p.minor - exact;
      assert.ok(diff >= -1n && diff <= 1n, `part ${i} of ${amount} by ${weights}`);
      if (weights[i] === 0) assert.equal(p.minor, 0n);
      if (amount >= 0n) assert.ok(p.minor >= 0n);
      else assert.ok(p.minor <= 0n);
    });
  }
});

test('split shares an amount into equal parts, the extra units going to the first parts', () => {
  assert.deepEqual(split(usd(100), 3), [usd(34), usd(33), usd(33)]);
  assert.deepEqual(split(usd(100), 1), [usd(100)]);
  assert.deepEqual(split(usd(-100), 3), [usd(-34), usd(-33), usd(-33)]);
  assert.deepEqual(split(usd(5), 4), [usd(2), usd(1), usd(1), usd(1)]);
  assert.deepEqual(split({ minor: 10n, currency: 'JPY' }, 4), [{ minor: 3n, currency: 'JPY' }, { minor: 3n, currency: 'JPY' }, { minor: 2n, currency: 'JPY' }, { minor: 2n, currency: 'JPY' }]);
  for (const n of [0, -1, 1.5, NaN, '3', null, undefined, 2 ** 53]) assert.throws(() => split(usd(100), n), errorWith('parts must be a positive whole number'), String(n));
});

test('a value that is not an amount of money is a TypeError', () => {
  for (const bad of [null, undefined, 5, '1.00', { minor: 5, currency: 'USD' }, { currency: 'USD' }]) {
    assert.throws(() => format(bad), (e) => e instanceof TypeError && e.message === 'not an amount of money');
    assert.throws(() => add(bad, usd(1)), (e) => e instanceof TypeError && e.message === 'not an amount of money');
    assert.throws(() => mul(bad, '1'), (e) => e instanceof TypeError && e.message === 'not an amount of money');
    assert.throws(() => allocate(bad, [1]), (e) => e instanceof TypeError && e.message === 'not an amount of money');
  }
});
