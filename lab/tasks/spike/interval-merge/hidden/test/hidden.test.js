'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeIntervals } = require('../src/intervals.js');

test('intervals that touch are merged', () => {
  assert.deepEqual(mergeIntervals([[1, 4], [4, 5]]), [[1, 5]]);
});

test('an interval inside another does not shrink it', () => {
  assert.deepEqual(mergeIntervals([[1, 10], [2, 3], [4, 5]]), [[1, 10]]);
});

test('zero-length intervals are kept and merge when they touch', () => {
  assert.deepEqual(mergeIntervals([[3, 3], [5, 5], [3, 4]]), [[3, 4], [5, 5]]);
});

test('negative and fractional values work', () => {
  assert.deepEqual(mergeIntervals([[-5, -1], [-2, 0.5], [0.5, 1.5]]), [[-5, 1.5]]);
});

test('the input and its inner arrays are not changed', () => {
  const input = [[5, 8], [1, 6]];
  const copy = JSON.parse(JSON.stringify(input));
  const out = mergeIntervals(input);
  assert.deepEqual(input, copy);
  assert.notEqual(out[0], input[1]);
  out[0][0] = 99;
  assert.deepEqual(input, copy);
});

test('a start greater than its end throws a RangeError naming the first bad index', () => {
  assert.throws(() => mergeIntervals([[1, 2], [5, 3], [9, 1]]), (e) => e instanceof RangeError && e.message === 'invalid interval at index 1');
});

test('a malformed element throws a TypeError naming its index', () => {
  assert.throws(() => mergeIntervals([[1, 2], [3]]), (e) => e instanceof TypeError && e.message === 'invalid interval at index 1');
  assert.throws(() => mergeIntervals([[1, NaN]]), (e) => e instanceof TypeError && e.message === 'invalid interval at index 0');
  assert.throws(() => mergeIntervals([[1, '2']]), (e) => e instanceof TypeError && e.message === 'invalid interval at index 0');
});

test('input that is not an array throws a TypeError', () => {
  assert.throws(() => mergeIntervals(null), (e) => e instanceof TypeError && e.message === 'intervals must be an array');
  assert.throws(() => mergeIntervals('1-2'), (e) => e instanceof TypeError && e.message === 'intervals must be an array');
});

test('the first problem in input order is the one reported', () => {
  assert.throws(() => mergeIntervals([[2, 1], [1]]), (e) => e instanceof RangeError && e.message === 'invalid interval at index 0');
});
