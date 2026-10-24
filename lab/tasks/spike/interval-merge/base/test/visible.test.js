'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeIntervals } = require('../src/intervals.js');

test('merges overlapping intervals', () => {
  assert.deepEqual(mergeIntervals([[1, 3], [2, 6], [8, 10]]), [[1, 6], [8, 10]]);
});

test('returns an empty list for no intervals', () => {
  assert.deepEqual(mergeIntervals([]), []);
});

test('sorts the result by start', () => {
  assert.deepEqual(mergeIntervals([[8, 10], [1, 2]]), [[1, 2], [8, 10]]);
});
