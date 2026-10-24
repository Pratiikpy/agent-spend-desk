'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { satisfies, maxSatisfying } = require('../src/range.js');

test('caret and tilde ranges', () => {
  assert.equal(satisfies('1.4.0', '^1.2.3'), true);
  assert.equal(satisfies('2.0.0', '^1.2.3'), false);
  assert.equal(satisfies('1.2.9', '~1.2.3'), true);
  assert.equal(satisfies('1.3.0', '~1.2.3'), false);
});

test('the highest version in a range', () => {
  assert.equal(maxSatisfying(['1.2.3', '1.9.0', '2.0.0'], '^1'), '1.9.0');
});

test('a bad version is refused with the text in the message', () => {
  assert.throws(() => satisfies('1.2', '*'), (e) => e instanceof Error && e.message === 'invalid version: 1.2');
});
