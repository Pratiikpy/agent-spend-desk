'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { page } = require('../src/paginate.js');

const make = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

test('the first page holds the first items and offers a cursor', () => {
  const p = page(make(25), { limit: 10 });
  assert.deepEqual(p.items.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.notEqual(p.nextCursor, null);
});

test('following the cursor reaches the next page', () => {
  const items = make(25);
  const first = page(items, { limit: 10 });
  const second = page(items, { limit: 10, cursor: first.nextCursor });
  assert.deepEqual(second.items.map((x) => x.id), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
});

test('a short last page has no cursor', () => {
  const items = make(25);
  const p2 = page(items, { limit: 10, cursor: page(items, { limit: 10 }).nextCursor });
  const p3 = page(items, { limit: 10, cursor: p2.nextCursor });
  assert.equal(p3.items.length, 5);
  assert.equal(p3.nextCursor, null);
});
