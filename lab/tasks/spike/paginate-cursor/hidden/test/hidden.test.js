'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { page } = require('../src/paginate.js');
const { encodeCursor, decodeCursor } = require('../src/cursor.js');

const make = (n) => Array.from({ length: n }, (_, i) => ({ id: (i + 1) * 10 }));
const ids = (p) => p.items.map((x) => x.id);

test('a final full page has no cursor and there is no empty page after it', () => {
  const items = make(20);
  const p1 = page(items, { limit: 10 });
  const p2 = page(items, { limit: 10, cursor: p1.nextCursor });
  assert.equal(p2.items.length, 10);
  assert.equal(p2.nextCursor, null);
});

test('a limit equal to the number of items returns everything with no cursor', () => {
  const p = page(make(5), { limit: 5 });
  assert.equal(p.items.length, 5);
  assert.equal(p.nextCursor, null);
});

test('no items gives an empty page and no cursor', () => {
  assert.deepEqual(page([], {}), { items: [], nextCursor: null });
  assert.deepEqual(page([], { limit: 3 }), { items: [], nextCursor: null });
});

test('the default limit is 10 and the largest is 100', () => {
  const items = make(300);
  assert.equal(page(items).items.length, 10);
  assert.equal(page(items, { limit: 100 }).items.length, 100);
  assert.equal(page(items, { limit: 5000 }).items.length, 100);
  assert.notEqual(page(items, { limit: 5000 }).nextCursor, null);
});

test('a limit that is not a positive integer is refused before the cursor is looked at', () => {
  for (const limit of [0, -1, 2.5, '5', NaN, null]) {
    assert.throws(() => page(make(5), { limit, cursor: 'garbage!' }), (e) => e instanceof RangeError && e.message === 'limit must be a positive integer');
  }
});

test('the cursor is the id of the last item shown, so deleting items does not skip anything', () => {
  const items = make(12);
  const p1 = page(items, { limit: 5 });
  assert.deepEqual(ids(p1), [10, 20, 30, 40, 50]);
  const afterDelete = items.filter((x) => x.id !== 10 && x.id !== 30 && x.id !== 60);
  const p2 = page(afterDelete, { limit: 5, cursor: p1.nextCursor });
  assert.deepEqual(ids(p2), [70, 80, 90, 100, 110]);
});

test('items added before the cursor do not repeat anything', () => {
  const items = make(12);
  const p1 = page(items, { limit: 5 });
  const withNew = [{ id: 5 }, { id: 15 }, ...items];
  withNew.sort((a, b) => a.id - b.id);
  const p2 = page(withNew, { limit: 5, cursor: p1.nextCursor });
  assert.deepEqual(ids(p2), [60, 70, 80, 90, 100]);
});

test('a cursor to an id that no longer exists still works', () => {
  const items = make(10);
  const cursor = page(items, { limit: 3 }).nextCursor;
  const without30 = items.filter((x) => x.id !== 30);
  assert.deepEqual(ids(page(without30, { limit: 2, cursor })), [40, 50]);
});

test('undefined and null cursors mean the first page', () => {
  const items = make(4);
  assert.deepEqual(ids(page(items, { limit: 2, cursor: undefined })), [10, 20]);
  assert.deepEqual(ids(page(items, { limit: 2, cursor: null })), [10, 20]);
});

test('walking every page returns every item once', () => {
  const items = make(57);
  const seen = [];
  let cursor;
  let pages = 0;
  do {
    const p = page(items, { limit: 8, cursor });
    seen.push(...ids(p));
    cursor = p.nextCursor;
    pages += 1;
  } while (cursor);
  assert.deepEqual(seen, items.map((x) => x.id));
  assert.equal(pages, 8);
});

test('a cursor is base64url of {"id":n} without padding', () => {
  assert.equal(encodeCursor(5), Buffer.from('{"id":5}').toString('base64url'));
  assert.equal(encodeCursor(5), 'eyJpZCI6NX0');
  assert.equal(decodeCursor(encodeCursor(123456)), 123456);
  assert.equal(decodeCursor(encodeCursor(-7)), -7);
  assert.ok(!/[+/=]/.test(encodeCursor(999999999)));
});

test('a bad cursor is an invalid cursor error, from page and from decodeCursor', () => {
  const bad = [
    42,
    {},
    '',
    'not a cursor',
    'eyJpZCI6NX0=',
    ' eyJpZCI6NX0',
    'eyJpZCI6NX0\n',
    'eyJpZCI6NX0+',
    Buffer.from('{"id":"5"}').toString('base64url'),
    Buffer.from('{"id":5.5}').toString('base64url'),
    Buffer.from('{"id":5,"x":1}').toString('base64url'),
    Buffer.from('{"i":5}').toString('base64url'),
    Buffer.from('[5]').toString('base64url'),
    Buffer.from('5').toString('base64url'),
    Buffer.from('null').toString('base64url'),
    Buffer.from('{"id":9007199254740993}').toString('base64url'),
    Buffer.from('{broken').toString('base64url'),
    Buffer.from('{"id": 5}').toString('base64url'),
  ];
  for (const cursor of bad) {
    assert.throws(() => decodeCursor(cursor), (e) => e instanceof Error && e.message === 'invalid cursor', `decode ${JSON.stringify(cursor)}`);
    assert.throws(() => page(make(3), { cursor }), (e) => e instanceof Error && e.message === 'invalid cursor', `page ${JSON.stringify(cursor)}`);
  }
});
