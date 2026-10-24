'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { merge } = require('../src/merge.js');

test('no sources gives an empty object, and null or undefined sources are skipped', () => {
  assert.deepEqual(merge(), {});
  assert.deepEqual(merge(null, { a: 1 }, undefined, { b: 2 }), { a: 1, b: 2 });
});

test('undefined skips the key, null overwrites it', () => {
  assert.deepEqual(merge({ a: 1, b: 2 }, { a: undefined, b: null, c: undefined }), { a: 1, b: null });
  assert.equal(Object.hasOwn(merge({ c: undefined }), 'c'), false);
  assert.equal(Object.hasOwn(merge({ n: { c: undefined } }), 'n'), true);
});

test('an object replaces a primitive and a primitive replaces an object', () => {
  assert.deepEqual(merge({ a: 1 }, { a: { b: 2 } }), { a: { b: 2 } });
  assert.deepEqual(merge({ a: { b: 2 } }, { a: 1 }), { a: 1 });
  assert.deepEqual(merge({ a: [1] }, { a: { b: 2 } }), { a: { b: 2 } });
  assert.deepEqual(merge({ a: { b: 2 } }, { a: [1] }), { a: [1] });
});

test('the result shares no object or array with any source', () => {
  const s1 = { o: { deep: { v: 1 } }, arr: [{ x: 1 }, [2]] };
  const out = merge(s1);
  assert.notEqual(out.o, s1.o);
  assert.notEqual(out.o.deep, s1.o.deep);
  assert.notEqual(out.arr, s1.arr);
  assert.notEqual(out.arr[0], s1.arr[0]);
  assert.notEqual(out.arr[1], s1.arr[1]);
  out.o.deep.v = 99;
  out.arr[0].x = 99;
  assert.equal(s1.o.deep.v, 1);
  assert.equal(s1.arr[0].x, 1);
});

test('a source is not changed even when later sources merge into the same keys', () => {
  const s1 = { a: { b: 1 } };
  const s2 = { a: { c: 2 } };
  const out = merge(s1, s2);
  assert.deepEqual(s1, { a: { b: 1 } });
  assert.deepEqual(s2, { a: { c: 2 } });
  assert.deepEqual(out, { a: { b: 1, c: 2 } });
});

test('dates, maps, functions and class instances are kept by reference', () => {
  class Point { constructor() { this.x = 1; } }
  const d = new Date(0);
  const m = new Map([[1, 2]]);
  const f = () => 1;
  const p = new Point();
  const out = merge({ d, m, f, p });
  assert.equal(out.d, d);
  assert.equal(out.m, m);
  assert.equal(out.f, f);
  assert.equal(out.p, p);
});

test('a class instance is not merged into, it replaces', () => {
  class Point { constructor() { this.x = 1; } }
  const p = new Point();
  const out = merge({ a: { y: 2 } }, { a: p }, { a: { z: 3 } });
  assert.deepEqual(out, { a: { z: 3 } });
  assert.equal(p.z, undefined);
});

test('prototype pollution through __proto__ does nothing', () => {
  const evil = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
  const out = merge({}, evil);
  assert.equal({}.polluted, undefined);
  assert.equal(out.polluted, undefined);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.deepEqual(out, { safe: 1 });
});

test('nested __proto__, constructor and prototype keys are ignored at every depth', () => {
  const evil = JSON.parse('{"a":{"__proto__":{"polluted2":true},"constructor":{"prototype":{"polluted3":true}},"prototype":{"p":1},"ok":1}}');
  const out = merge({ a: { keep: 1 } }, evil);
  assert.equal({}.polluted2, undefined);
  assert.equal({}.polluted3, undefined);
  assert.deepEqual(out, { a: { keep: 1, ok: 1 } });
  assert.deepEqual(merge({ constructor: { prototype: { z: 1 } }, prototype: 1, v: 2 }), { v: 2 });
});

test('blocked keys inside arrays of objects are dropped too', () => {
  const evil = JSON.parse('{"list":[{"__proto__":{"polluted4":true},"n":1}]}');
  const out = merge(evil);
  assert.equal({}.polluted4, undefined);
  assert.deepEqual(out, { list: [{ n: 1 }] });
});

test('objects with a null prototype count as plain', () => {
  const bare = Object.create(null);
  bare.k = 1;
  const out = merge({ a: { j: 0 } }, { a: bare });
  assert.deepEqual(out, { a: { j: 0, k: 1 } });
  assert.deepEqual(merge(bare), { k: 1 });
});

test('a source that is not a plain object is refused', () => {
  for (const bad of [[1], 'text', 5, true, new Map(), new Date(), () => 1, new (class A {})()]) {
    assert.throws(() => merge({ a: 1 }, bad), (e) => e instanceof TypeError && e.message === 'sources must be plain objects');
  }
});

test('a cycle is refused wherever it is', () => {
  const direct = { a: 1 };
  direct.self = direct;
  assert.throws(() => merge(direct), (e) => e instanceof TypeError && e.message === 'circular reference');
  const indirect = { x: { y: {} } };
  indirect.x.y.back = indirect.x;
  assert.throws(() => merge({ a: 1 }, indirect), (e) => e.message === 'circular reference');
  const arr = [];
  arr.push(arr);
  assert.throws(() => merge({ list: arr }), (e) => e.message === 'circular reference');
  const viaArray = { items: [] };
  viaArray.items.push({ owner: viaArray });
  assert.throws(() => merge(viaArray), (e) => e.message === 'circular reference');
});

test('the same object used twice without a cycle is fine', () => {
  const shared = { v: 1 };
  const out = merge({ a: shared, b: shared, c: [shared, shared] });
  assert.deepEqual(out, { a: { v: 1 }, b: { v: 1 }, c: [{ v: 1 }, { v: 1 }] });
  assert.notEqual(out.a, out.b);
});

test('only own enumerable string keys are read', () => {
  const src = { own: 2 };
  Object.defineProperty(src, 'hidden', { value: 3, enumerable: false });
  const sym = Symbol('s');
  src[sym] = 4;
  const out = merge({ a: 0 }, src);
  assert.deepEqual(Object.keys(out).sort(), ['a', 'own']);
  assert.equal(out.hidden, undefined);
  assert.equal(out[sym], undefined);
});
