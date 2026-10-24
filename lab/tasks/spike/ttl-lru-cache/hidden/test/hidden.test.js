'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TtlLruCache } = require('../src/cache.js');

function clock() {
  const c = { t: 0, now: () => c.t };
  return c;
}

function make(capacity, ttlMs) {
  const c = clock();
  return { c, cache: new TtlLruCache({ capacity, ttlMs, now: c.now }) };
}

test('an entry is live one millisecond before its ttl and expired exactly at it', () => {
  const { c, cache } = make(3, 1000);
  cache.set('a', 1);
  c.t = 999;
  assert.equal(cache.get('a'), 1);
  c.t = 1000;
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.size, 0);
});

test('get does not extend the expiry', () => {
  const { c, cache } = make(3, 1000);
  cache.set('a', 1);
  c.t = 900;
  assert.equal(cache.get('a'), 1);
  c.t = 1000;
  assert.equal(cache.get('a'), undefined);
});

test('setting an existing key replaces the value and restarts the expiry', () => {
  const { c, cache } = make(3, 1000);
  cache.set('a', 1);
  c.t = 900;
  cache.set('a', 2);
  c.t = 1500;
  assert.equal(cache.get('a'), 2);
  c.t = 1900;
  assert.equal(cache.get('a'), undefined);
});

test('a per-call ttl overrides the default', () => {
  const { c, cache } = make(3, 1000);
  cache.set('short', 1, 100);
  cache.set('long', 2, 5000);
  c.t = 100;
  assert.equal(cache.has('short'), false);
  c.t = 4999;
  assert.equal(cache.has('long'), true);
});

test('peek does not refresh recency, get does', () => {
  const { cache } = make(2, 1000);
  cache.set('a', 1).set('b', 2);
  assert.equal(cache.peek('a'), 1);
  cache.set('c', 3);
  assert.deepEqual(cache.keys(), ['b', 'c']);
  cache.get('b');
  cache.set('d', 4);
  assert.deepEqual(cache.keys(), ['b', 'd']);
});

test('has does not refresh recency and is true for a stored undefined value', () => {
  const { cache } = make(2, 1000);
  cache.set('a', undefined).set('b', 2);
  assert.equal(cache.has('a'), true);
  cache.set('c', 3);
  assert.equal(cache.has('a'), false);
  assert.deepEqual(cache.keys(), ['b', 'c']);
});

test('expired entries are removed before a live one is evicted', () => {
  const { c, cache } = make(2, 1000);
  cache.set('short', 1, 100);
  cache.set('long', 2);
  cache.get('short');
  c.t = 150;
  cache.set('fresh', 3);
  assert.deepEqual(cache.keys(), ['long', 'fresh']);
});

test('size and keys leave out expired entries and keys run from least to most recently used', () => {
  const { c, cache } = make(5, 1000);
  cache.set('a', 1, 50).set('b', 2).set('c', 3);
  cache.get('b');
  assert.deepEqual(cache.keys(), ['a', 'c', 'b']);
  c.t = 60;
  assert.deepEqual(cache.keys(), ['c', 'b']);
  assert.equal(cache.size, 2);
});

test('delete reports whether a live entry was removed', () => {
  const { c, cache } = make(3, 1000);
  cache.set('a', 1).set('b', 2, 10);
  assert.equal(cache.delete('a'), true);
  assert.equal(cache.delete('a'), false);
  c.t = 10;
  assert.equal(cache.delete('b'), false);
  assert.equal(cache.size, 0);
});

test('a capacity of one keeps only the newest entry', () => {
  const { cache } = make(1, 1000);
  cache.set('a', 1).set('b', 2);
  assert.deepEqual(cache.keys(), ['b']);
  assert.equal(cache.get('a'), undefined);
});

test('replacing a key at full capacity evicts nothing', () => {
  const { cache } = make(2, 1000);
  cache.set('a', 1).set('b', 2).set('a', 10);
  assert.deepEqual(cache.keys(), ['b', 'a']);
  assert.equal(cache.get('a'), 10);
});

test('set returns the cache', () => {
  const { cache } = make(2, 1000);
  assert.equal(cache.set('a', 1), cache);
});

test('the constructor and set validate their arguments', () => {
  const bad = (opts, message) => assert.throws(() => new TtlLruCache(opts), (e) => e instanceof RangeError && e.message === message);
  bad({ capacity: 0, ttlMs: 10 }, 'capacity must be a positive integer');
  bad({ capacity: 1.5, ttlMs: 10 }, 'capacity must be a positive integer');
  bad({ capacity: '2', ttlMs: 10 }, 'capacity must be a positive integer');
  bad({ capacity: 2, ttlMs: 0 }, 'ttlMs must be a positive number');
  bad({ capacity: 2, ttlMs: Infinity }, 'ttlMs must be a positive number');
  bad({ capacity: 2, ttlMs: -5 }, 'ttlMs must be a positive number');
  const cache = new TtlLruCache({ capacity: 2, ttlMs: 10 });
  assert.throws(() => cache.set('a', 1, 0), (e) => e instanceof RangeError && e.message === 'ttlMs must be a positive number');
  assert.equal(cache.has('a'), false);
});

test('without an injected clock it uses Date.now', () => {
  const cache = new TtlLruCache({ capacity: 2, ttlMs: 60000 });
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
});
