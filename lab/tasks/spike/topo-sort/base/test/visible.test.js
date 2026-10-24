'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { topoSort } = require('../src/topo.js');

test('puts dependencies first', () => {
  assert.deepEqual(topoSort({ c: ['b'], b: ['a'], a: [] }), ['a', 'b', 'c']);
});

test('includes nodes that only appear as dependencies', () => {
  assert.deepEqual(topoSort({ app: ['lib'] }), ['lib', 'app']);
});

test('reports a cycle', () => {
  assert.throws(() => topoSort({ a: ['b'], b: ['a'] }), /cycle detected/);
});
