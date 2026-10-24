'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Cart } = require('../src/cart.js');
const { percentOf, formatCents } = require('../src/money.js');

test('a half rounds up even where floating point would land just below it', () => {
  assert.equal(percentOf(3000, 1.15), 35);
  assert.equal(percentOf(3000, 4.35), 131);
  assert.equal(percentOf(5, 10), 1);
  assert.equal(percentOf(1030, 15), 155);
});

test('a negative half rounds away from zero and zero is never negative', () => {
  assert.equal(percentOf(-50, 1), -1);
  assert.equal(percentOf(-5, 10), -1);
  assert.ok(Object.is(percentOf(-1, 10), 0));
  assert.ok(Object.is(percentOf(0, 25), 0));
  assert.equal(percentOf(-1000, 12.5), -125);
});

test('percentages with two decimals are exact', () => {
  assert.equal(percentOf(10000, 8.25), 825);
  assert.equal(percentOf(1999, 0.01), 0);
  assert.equal(percentOf(5000, 0.01), 1);
  assert.equal(percentOf(123456, 100), 123456);
});

test('each line is discounted and rounded on its own', () => {
  const s = new Cart().add('a', 0.05, 1, 10).add('b', 0.05, 1, 10).summary();
  assert.deepEqual(s.lines.map((l) => l.discountCents), [1, 1]);
  assert.deepEqual(s.lines.map((l) => l.netCents), [4, 4]);
  assert.equal(s.subtotalCents, 8);
});

test('quantity multiplies the unit price before the discount', () => {
  const s = new Cart().add('a', 10.05, 3, 15).summary();
  assert.equal(s.lines[0].lineCents, 3015);
  assert.equal(s.lines[0].discountCents, 452);
  assert.equal(s.lines[0].netCents, 2563);
});

test('tax is rounded once, on the subtotal', () => {
  const cart = new Cart({ taxPercent: 10 });
  cart.add('a', 0.05).add('b', 0.05).add('c', 0.05);
  const s = cart.summary();
  assert.equal(s.subtotalCents, 15);
  assert.equal(s.taxCents, 2);
  assert.equal(s.totalCents, 17);
});

test('a full cart adds up', () => {
  const cart = new Cart({ taxPercent: 8.25 });
  cart.add('book', 12.99, 2, 10).add('lamp', 45.5, 1).add('cable', 3.35, 3, 12.5);
  const s = cart.summary();
  assert.deepEqual(s.lines, [
    { sku: 'book', lineCents: 2598, discountCents: 260, netCents: 2338 },
    { sku: 'lamp', lineCents: 4550, discountCents: 0, netCents: 4550 },
    { sku: 'cable', lineCents: 1005, discountCents: 126, netCents: 879 },
  ]);
  assert.equal(s.subtotalCents, 7767);
  assert.equal(s.taxCents, 641);
  assert.equal(s.totalCents, 8408);
});

test('an empty cart is zero', () => {
  assert.deepEqual(new Cart({ taxPercent: 20 }).summary(), { lines: [], subtotalCents: 0, taxCents: 0, totalCents: 0 });
});

test('amounts print with separators, two decimals and the minus sign first', () => {
  assert.equal(formatCents(0), '$0.00');
  assert.equal(formatCents(5), '$0.05');
  assert.equal(formatCents(99999), '$999.99');
  assert.equal(formatCents(100000), '$1,000.00');
  assert.equal(formatCents(123456789), '$1,234,567.89');
  assert.equal(formatCents(-5), '-$0.05');
  assert.equal(formatCents(-123456), '-$1,234.56');
});
