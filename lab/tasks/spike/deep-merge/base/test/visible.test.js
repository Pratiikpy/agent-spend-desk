'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { merge } = require('../src/merge.js');

test('merges nested objects with later sources winning', () => {
  assert.deepEqual(merge({ a: { b: 1, c: 2 } }, { a: { c: 3, d: 4 } }), { a: { b: 1, c: 3, d: 4 } });
});

test('arrays are replaced, not joined', () => {
  assert.deepEqual(merge({ list: [1, 2, 3] }, { list: [9] }), { list: [9] });
});

test('does not change its sources', () => {
  const a = { x: { y: 1 } };
  merge(a, { x: { z: 2 } });
  assert.deepEqual(a, { x: { y: 1 } });
});
