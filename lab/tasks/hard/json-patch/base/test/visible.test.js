'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyPatch, PatchError } = require('../src/patch.js');

test('adds an object member', () => {
  assert.deepEqual(applyPatch({ foo: 'bar' }, [{ op: 'add', path: '/baz', value: 'qux' }]), { foo: 'bar', baz: 'qux' });
});

test('inserts into an array', () => {
  assert.deepEqual(applyPatch({ foo: ['bar', 'baz'] }, [{ op: 'add', path: '/foo/1', value: 'qux' }]), { foo: ['bar', 'qux', 'baz'] });
});

test('a failed test operation is a PatchError that says which operation failed', () => {
  assert.throws(
    () => applyPatch({ baz: 'qux' }, [{ op: 'test', path: '/baz', value: 'bar' }]),
    (e) => e instanceof PatchError && e.index === 0 && e.code === 'test_failed',
  );
});
