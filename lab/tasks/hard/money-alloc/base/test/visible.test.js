'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, format, add, mul, allocate } = require('../src/money.js');

test('parses and formats an amount', () => {
  assert.deepEqual(parse('1,234.50', 'USD'), { minor: 123450n, currency: 'USD' });
  assert.equal(format({ minor: 123450n, currency: 'USD' }), '1,234.50');
});

test('adds amounts of the same currency', () => {
  assert.deepEqual(add(parse('0.10', 'USD'), parse('0.20', 'USD')), { minor: 30n, currency: 'USD' });
});

test('a dollar split three ways has no lost cent', () => {
  assert.deepEqual(allocate({ minor: 100n, currency: 'USD' }, [1, 1, 1]).map((m) => m.minor), [34n, 33n, 33n]);
});

test('multiplication rounds half to even by default', () => {
  assert.equal(mul({ minor: 25n, currency: 'USD' }, '0.1').minor, 2n);
});
