'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv } = require('../src/csv.js');

test('splits simple rows and fields', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('reads a quoted field containing a comma', () => {
  assert.deepEqual(parseCsv('"a,b",c'), [['a,b', 'c']]);
});

test('empty text has no rows', () => {
  assert.deepEqual(parseCsv(''), []);
});
