'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Cart } = require('../src/cart.js');
const { toCents, percentOf, formatCents } = require('../src/money.js');

test('converts dollars to cents', () => {
  assert.equal(toCents(19.99), 1999);
});

test('a plain percentage of an amount', () => {
  assert.equal(percentOf(2000, 10), 200);
});

test('a cart with one line and no discount or tax', () => {
  const s = new Cart().add('pen', 2.5, 4).summary();
  assert.equal(s.subtotalCents, 1000);
  assert.equal(s.totalCents, 1000);
});

test('formats a large amount with a thousands separator', () => {
  assert.equal(formatCents(123456), '$1,234.56');
});
