'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TokenBucket } = require('../src/bucket.js');

function clock() {
  const c = { t: 0, now: () => c.t };
  return c;
}

test('starts full and spends tokens', () => {
  const c = clock();
  const b = new TokenBucket({ capacity: 3, refillPerSec: 1, now: c.now });
  assert.equal(b.tryTake(), true);
  assert.equal(b.tryTake(2), true);
  assert.equal(b.tryTake(), false);
});

test('refills over time', () => {
  const c = clock();
  const b = new TokenBucket({ capacity: 3, refillPerSec: 1, now: c.now });
  b.tryTake(3);
  c.t = 2000;
  assert.equal(b.available(), 2);
});

test('never holds more than its capacity', () => {
  const c = clock();
  const b = new TokenBucket({ capacity: 3, refillPerSec: 1, now: c.now });
  c.t = 60000;
  assert.equal(b.available(), 3);
});
