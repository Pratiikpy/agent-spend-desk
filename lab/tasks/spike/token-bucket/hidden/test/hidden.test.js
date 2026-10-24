'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TokenBucket } = require('../src/bucket.js');

function clock(t = 0) {
  const c = { t, now: () => c.t };
  return c;
}

test('fractional tokens accrue', () => {
  const c = clock();
  const b = new TokenBucket({ capacity: 10, refillPerSec: 2, now: c.now });
  b.tryTake(10);
  c.t = 250;
  assert.equal(b.available(), 0.5);
  assert.equal(b.tryTake(), false);
  c.t = 500;
  assert.equal(b.tryTake(), true);
  assert.equal(b.available(), 0);
});

test('a failed take removes nothing', () => {
  const c = clock();
  const b = new TokenBucket({ capacity: 5, refillPerSec: 1, now: c.now });
  b.tryTake(4);
  assert.equal(b.tryTake(2), false);
  assert.equal(b.available(), 1);
});

test('asking for more than the capacity is always refused', () => {
  const c = clock();
  const b = new TokenBucket({ capacity: 5, refillPerSec: 1, now: c.now });
  assert.equal(b.tryTake(6), false);
  c.t = 100000;
  assert.equal(b.tryTake(6), false);
  assert.equal(b.available(), 5);
});

test('waitMs is zero when the tokens are there and rounds up otherwise', () => {
  const c = clock();
  const b = new TokenBucket({ capacity: 5, refillPerSec: 3, now: c.now });
  assert.equal(b.waitMs(5), 0);
  b.tryTake(5);
  assert.equal(b.waitMs(1), 334);
  c.t = 100;
  assert.equal(b.waitMs(1), 234);
  assert.equal(b.waitMs(2), 567);
});

test('waitMs is infinite for more than the capacity and waiting that long works', () => {
  const c = clock();
  const b = new TokenBucket({ capacity: 4, refillPerSec: 500, now: c.now });
  assert.equal(b.waitMs(5), Infinity);
  b.tryTake(4);
  const wait = b.waitMs(2);
  assert.equal(wait, 4);
  c.t += wait;
  assert.equal(b.tryTake(2), true);
});

test('a clock that moves backwards loses nothing and gains nothing', () => {
  const c = clock(10000);
  const b = new TokenBucket({ capacity: 10, refillPerSec: 1, now: c.now });
  b.tryTake(10);
  c.t = 12000;
  assert.equal(b.available(), 2);
  c.t = 5000;
  assert.equal(b.available(), 2);
  c.t = 6000;
  assert.equal(b.available(), 3);
});

test('the bucket starts counting from the moment it was created', () => {
  const c = clock(1000000);
  const b = new TokenBucket({ capacity: 2, refillPerSec: 1, now: c.now });
  b.tryTake(2);
  c.t += 1000;
  assert.equal(b.available(), 1);
});

test('n is checked first and a bad n changes nothing', () => {
  const c = clock();
  const b = new TokenBucket({ capacity: 3, refillPerSec: 1, now: c.now });
  b.tryTake(3);
  c.t = 1000;
  for (const n of [0, -1, 1.5, '2', NaN, null]) {
    assert.throws(() => b.tryTake(n), (e) => e instanceof RangeError && e.message === 'n must be a positive integer');
    assert.throws(() => b.waitMs(n), (e) => e instanceof RangeError && e.message === 'n must be a positive integer');
  }
  assert.equal(b.available(), 1);
});

test('the constructor validates its arguments', () => {
  const bad = (opts, message) => assert.throws(() => new TokenBucket(opts), (e) => e instanceof RangeError && e.message === message);
  bad({ capacity: 0, refillPerSec: 1 }, 'capacity must be a positive integer');
  bad({ capacity: 2.5, refillPerSec: 1 }, 'capacity must be a positive integer');
  bad({ capacity: 2, refillPerSec: 0 }, 'refillPerSec must be a positive number');
  bad({ capacity: 2, refillPerSec: Infinity }, 'refillPerSec must be a positive number');
  bad({ capacity: 2, refillPerSec: '1' }, 'refillPerSec must be a positive number');
});

test('without an injected clock it uses Date.now', () => {
  const b = new TokenBucket({ capacity: 2, refillPerSec: 1 });
  assert.equal(b.tryTake(2), true);
  assert.equal(b.tryTake(), false);
});
