'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyPatch, PatchError } = require('../src/patch.js');

const fails = (doc, patch, index, code) =>
  assert.throws(
    () => applyPatch(doc, patch),
    (e) => e instanceof PatchError && e instanceof Error && e.name === 'PatchError' && e.index === index && e.code === code && e.message === `operation ${index} failed: ${code}`,
    `${JSON.stringify(patch)} should fail with ${code} at ${index}`,
  );

// The examples of RFC 6902 appendix A.
test('RFC A.1 to A.5: add a member, add an array element, remove a member, remove an array element, replace a value', () => {
  assert.deepEqual(applyPatch({ foo: 'bar' }, [{ op: 'add', path: '/baz', value: 'qux' }]), { foo: 'bar', baz: 'qux' });
  assert.deepEqual(applyPatch({ foo: ['bar', 'baz'] }, [{ op: 'add', path: '/foo/1', value: 'qux' }]), { foo: ['bar', 'qux', 'baz'] });
  assert.deepEqual(applyPatch({ baz: 'qux', foo: 'bar' }, [{ op: 'remove', path: '/baz' }]), { foo: 'bar' });
  assert.deepEqual(applyPatch({ foo: ['bar', 'qux', 'baz'] }, [{ op: 'remove', path: '/foo/1' }]), { foo: ['bar', 'baz'] });
  assert.deepEqual(applyPatch({ baz: 'qux', foo: 'bar' }, [{ op: 'replace', path: '/baz', value: 'boo' }]), { baz: 'boo', foo: 'bar' });
});

test('RFC A.6 and A.7: moving a value and moving an array element', () => {
  assert.deepEqual(
    applyPatch({ foo: { bar: 'baz', waldo: 'fred' }, qux: { corge: 'grault' } }, [{ op: 'move', from: '/foo/waldo', path: '/qux/thud' }]),
    { foo: { bar: 'baz' }, qux: { corge: 'grault', thud: 'fred' } },
  );
  assert.deepEqual(applyPatch({ foo: ['all', 'grass', 'cows', 'eat'] }, [{ op: 'move', from: '/foo/1', path: '/foo/3' }]), { foo: ['all', 'cows', 'eat', 'grass'] });
});

test('RFC A.8 and A.9: a test that holds changes nothing, and one that does not hold fails', () => {
  const doc = { baz: 'qux', foo: ['a', 2, 'c'] };
  assert.deepEqual(applyPatch(doc, [{ op: 'test', path: '/baz', value: 'qux' }, { op: 'test', path: '/foo/1', value: 2 }]), doc);
  fails({ baz: 'qux' }, [{ op: 'test', path: '/baz', value: 'bar' }], 0, 'test_failed');
});

test('RFC A.10 to A.12: a nested object, unrecognised members are ignored, adding under a missing parent fails', () => {
  assert.deepEqual(applyPatch({ foo: 'bar' }, [{ op: 'add', path: '/child', value: { grandchild: {} } }]), { foo: 'bar', child: { grandchild: {} } });
  assert.deepEqual(applyPatch({ foo: 'bar' }, [{ op: 'add', path: '/baz', value: 'qux', xyz: 123 }]), { foo: 'bar', baz: 'qux' });
  fails({ foo: 'bar' }, [{ op: 'add', path: '/baz/bat', value: 'qux' }], 0, 'not_found');
});

test('RFC A.14 to A.16: escape order in pointers, a string is not a number, and appending an array', () => {
  const doc = { '/': 9, '~1': 10 };
  assert.deepEqual(applyPatch(doc, [{ op: 'test', path: '/~01', value: 10 }]), doc);
  fails(doc, [{ op: 'test', path: '/~01', value: '10' }], 0, 'test_failed');
  assert.deepEqual(applyPatch({ foo: ['bar'] }, [{ op: 'add', path: '/foo/-', value: ['abc', 'def'] }]), { foo: ['bar', ['abc', 'def']] });
});

test('pointers: the empty pointer is the whole document, ~1 is a slash and ~0 a tilde, and a bad pointer is refused', () => {
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'replace', path: '', value: [1, 2] }]), [1, 2]);
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'add', path: '', value: 'whole' }]), 'whole');
  assert.deepEqual(applyPatch({ 'a/b': 1, 'c~d': 2, '': 3 }, [{ op: 'replace', path: '/a~1b', value: 10 }, { op: 'replace', path: '/c~0d', value: 20 }, { op: 'replace', path: '/', value: 30 }]), { 'a/b': 10, 'c~d': 20, '': 30 });
  for (const path of ['a', 'a/b', '/a~', '/a~2', '/~', 5, null, undefined]) {
    fails({ a: 1 }, [{ op: 'test', path, value: 1 }], 0, 'invalid_pointer');
  }
});

test('array indexes: decimal digits with no leading zero, the end marker only for add, and no index past the end', () => {
  const doc = { a: ['x', 'y', 'z'] };
  assert.deepEqual(applyPatch(doc, [{ op: 'add', path: '/a/3', value: 'w' }]), { a: ['x', 'y', 'z', 'w'] });
  assert.deepEqual(applyPatch(doc, [{ op: 'add', path: '/a/0', value: 'w' }]), { a: ['w', 'x', 'y', 'z'] });
  fails(doc, [{ op: 'add', path: '/a/4', value: 'w' }], 0, 'out_of_bounds');
  for (const seg of ['01', '-1', '1.5', 'x', '+1', ' 1', '']) fails(doc, [{ op: 'add', path: `/a/${seg}`, value: 'w' }], 0, 'invalid_pointer');
  fails(doc, [{ op: 'remove', path: '/a/-' }], 0, 'invalid_pointer');
  fails(doc, [{ op: 'replace', path: '/a/-', value: 1 }], 0, 'invalid_pointer');
  fails(doc, [{ op: 'test', path: '/a/-', value: 1 }], 0, 'invalid_pointer');
  fails(doc, [{ op: 'remove', path: '/a/3' }], 0, 'not_found');
  fails(doc, [{ op: 'replace', path: '/a/3', value: 1 }], 0, 'not_found');
  fails(doc, [{ op: 'add', path: '/a/-/b', value: 1 }], 0, 'invalid_pointer');
  assert.deepEqual(applyPatch(doc, [{ op: 'replace', path: '/a/2', value: 'Z' }]), { a: ['x', 'y', 'Z'] });
});

test('add replaces an existing member; remove and replace need the target to exist', () => {
  assert.deepEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'add', path: '/a', value: 9 }]), { a: 9, b: 2 });
  fails({ a: 1 }, [{ op: 'remove', path: '/b' }], 0, 'not_found');
  fails({ a: 1 }, [{ op: 'replace', path: '/b', value: 1 }], 0, 'not_found');
  fails({ a: 1 }, [{ op: 'replace', path: '/b/c', value: 1 }], 0, 'not_found');
  fails({ a: 1 }, [{ op: 'remove', path: '' }], 0, 'invalid_operation');
  fails({ a: 'text' }, [{ op: 'add', path: '/a/b', value: 1 }], 0, 'not_found');
});

test('move: from must exist, equal paths do nothing, a path inside the source is refused', () => {
  fails({ a: 1 }, [{ op: 'move', from: '/b', path: '/c' }], 0, 'not_found');
  assert.deepEqual(applyPatch({ a: { b: 1 } }, [{ op: 'move', from: '/a/b', path: '/a/b' }]), { a: { b: 1 } });
  fails({ a: { b: 1 } }, [{ op: 'move', from: '/a/c', path: '/a/c' }], 0, 'not_found');
  fails({ a: { b: 1 } }, [{ op: 'move', from: '/a', path: '/a/b/c' }], 0, 'invalid_operation');
  assert.deepEqual(applyPatch({ a: { b: 1 } }, [{ op: 'move', from: '/a/b', path: '/a/b2' }]), { a: { b2: 1 } });
  assert.deepEqual(applyPatch({ a: [1, 2, 3] }, [{ op: 'move', from: '/a/0', path: '/a/-' }]), { a: [2, 3, 1] });
  assert.deepEqual(applyPatch({ a: { x: 1 }, b: {} }, [{ op: 'move', from: '/a', path: '/b/inner' }]), { b: { inner: { x: 1 } } });
});

test('copy makes an independent copy', () => {
  const out = applyPatch({ a: { list: [1, 2] } }, [{ op: 'copy', from: '/a', path: '/b' }, { op: 'add', path: '/b/list/-', value: 3 }]);
  assert.deepEqual(out, { a: { list: [1, 2] }, b: { list: [1, 2, 3] } });
  fails({ a: 1 }, [{ op: 'copy', from: '/z', path: '/b' }], 0, 'not_found');
});

test('test compares by value: key order does not matter, arrays are ordered, types are not coerced', () => {
  const doc = { a: { x: 1, y: [1, { z: null }] }, n: 1, s: '1', t: true, nul: null };
  assert.deepEqual(applyPatch(doc, [{ op: 'test', path: '/a', value: { y: [1, { z: null }], x: 1 } }]), doc);
  fails(doc, [{ op: 'test', path: '/a/y', value: [{ z: null }, 1] }], 0, 'test_failed');
  fails(doc, [{ op: 'test', path: '/n', value: '1' }], 0, 'test_failed');
  fails(doc, [{ op: 'test', path: '/s', value: 1 }], 0, 'test_failed');
  fails(doc, [{ op: 'test', path: '/t', value: 1 }], 0, 'test_failed');
  fails(doc, [{ op: 'test', path: '/nul', value: 0 }], 0, 'test_failed');
  fails(doc, [{ op: 'test', path: '/a', value: { x: 1 } }], 0, 'test_failed');
  assert.deepEqual(applyPatch(doc, [{ op: 'test', path: '/nul', value: null }]), doc);
  assert.deepEqual(applyPatch(doc, [{ op: 'test', path: '', value: doc }]), doc);
  fails(doc, [{ op: 'test', path: '/missing', value: null }], 0, 'not_found');
});

test('the document passed in is never changed, and the result shares nothing with it or with the patch', () => {
  const doc = { a: { b: [1, 2] }, c: 3 };
  const patch = [{ op: 'add', path: '/a/b/-', value: { deep: [1] } }, { op: 'replace', path: '/c', value: 4 }];
  const snapshotDoc = JSON.stringify(doc);
  const snapshotPatch = JSON.stringify(patch);
  const out = applyPatch(doc, patch);
  assert.equal(JSON.stringify(doc), snapshotDoc);
  assert.equal(JSON.stringify(patch), snapshotPatch);
  out.a.b[2].deep.push(2);
  out.a.b.push('x');
  assert.equal(JSON.stringify(patch), snapshotPatch);
  assert.equal(JSON.stringify(doc), snapshotDoc);
  assert.notEqual(out, doc);
  assert.notEqual(out.a, doc.a);
});

test('it is all or nothing: a failing operation leaves nothing applied and says which one failed', () => {
  const doc = { a: 1 };
  const patch = [{ op: 'add', path: '/b', value: 2 }, { op: 'add', path: '/c', value: 3 }, { op: 'test', path: '/a', value: 99 }, { op: 'add', path: '/d', value: 4 }];
  fails(doc, patch, 2, 'test_failed');
  assert.deepEqual(doc, { a: 1 });
  fails(doc, [{ op: 'add', path: '/x', value: 1 }, { op: 'remove', path: '/nope' }], 1, 'not_found');
});

test('operations see the result of the ones before them', () => {
  assert.deepEqual(
    applyPatch({ list: [] }, [{ op: 'add', path: '/list/-', value: 'a' }, { op: 'add', path: '/list/-', value: 'b' }, { op: 'add', path: '/list/0', value: 'first' }, { op: 'remove', path: '/list/1' }]),
    { list: ['first', 'b'] },
  );
});

test('bad operations are refused: unknown or missing op, missing value, missing from, a patch that is not an array', () => {
  fails({}, [{ op: 'frobnicate', path: '/a' }], 0, 'invalid_operation');
  fails({}, [{ path: '/a', value: 1 }], 0, 'invalid_operation');
  fails({}, [{ op: 7, path: '/a', value: 1 }], 0, 'invalid_operation');
  fails({}, ['add'], 0, 'invalid_operation');
  fails({}, [null], 0, 'invalid_operation');
  fails({}, [{ op: 'add', path: '/a' }], 0, 'invalid_operation');
  fails({ a: 1 }, [{ op: 'replace', path: '/a' }], 0, 'invalid_operation');
  fails({ a: 1 }, [{ op: 'test', path: '/a' }], 0, 'invalid_operation');
  fails({ a: 1 }, [{ op: 'move', path: '/b' }], 0, 'invalid_operation');
  fails({ a: 1 }, [{ op: 'copy', path: '/b', from: 3 }], 0, 'invalid_operation');
  for (const bad of [{}, 'x', null, undefined, 5]) assert.throws(() => applyPatch({}, bad), (e) => e instanceof TypeError && e.message === 'patch must be an array');
  assert.deepEqual(applyPatch({ a: 1 }, []), { a: 1 });
});

test('a value of null is a value: it can be added, replaced and tested', () => {
  assert.deepEqual(applyPatch({}, [{ op: 'add', path: '/a', value: null }]), { a: null });
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'replace', path: '/a', value: null }]), { a: null });
});

test('keys named like object properties are ordinary keys and never reach a prototype', () => {
  const out = applyPatch({}, [
    { op: 'add', path: '/__proto__', value: { polluted: true } },
    { op: 'add', path: '/constructor', value: { prototype: { polluted: true } } },
    { op: 'add', path: '/prototype', value: 1 },
  ]);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(out).sort(), ['__proto__', 'constructor', 'prototype']);
  assert.deepEqual(Object.getOwnPropertyDescriptor(out, '__proto__').value, { polluted: true });
  fails({}, [{ op: 'remove', path: '/__proto__' }], 0, 'not_found');
  fails({}, [{ op: 'test', path: '/constructor', value: 1 }], 0, 'not_found');
  fails({ a: {} }, [{ op: 'add', path: '/a/__proto__/x', value: 1 }], 0, 'not_found');
  const parsed = JSON.parse('{"__proto__": {"x": 1}}');
  const again = applyPatch(parsed, [{ op: 'replace', path: '/__proto__/x', value: 2 }]);
  assert.equal(Object.getPrototypeOf(again), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(again, '__proto__').value, { x: 2 });
});
