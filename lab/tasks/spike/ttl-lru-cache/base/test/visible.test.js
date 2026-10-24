'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TtlLruCache } = require('../src/cache.js');

function clock() {
  const c = { t: 0, now: () => c.t };
  return c;
}

test('get returns what set stored', () => {
  const c = clock();
  const cache = new TtlLruCache({ capacity: 2, ttlMs: 1000, now: c.now });
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('missing'), undefined);
});

test('an entry expires after its ttl', () => {
  const c = clock();
  const cache = new TtlLruCache({ capacity: 2, ttlMs: 1000, now: c.now });
  cache.set('a', 1);
  c.t = 1500;
  assert.equal(cache.get('a'), undefined);
});

test('the least recently used entry is evicted when the capacity is exceeded', () => {
  const c = clock();
  const cache = new TtlLruCache({ capacity: 2, ttlMs: 1000, now: c.now });
  cache.set('a', 1).set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('a'), true);
});
