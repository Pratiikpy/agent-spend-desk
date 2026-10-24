'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { topoSort } = require('../src/topo.js');

test('ready nodes are taken in ascending order, and a newly ready node waits its turn', () => {
  assert.deepEqual(topoSort({ d: ['a'], a: [], b: [], c: [] }), ['a', 'b', 'c', 'd']);
  assert.deepEqual(topoSort({ b: [], a: [], c: ['a'] }), ['a', 'b', 'c']);
});

test('a node that becomes ready is ordered among the ready nodes by name', () => {
  assert.deepEqual(topoSort({ z: [], y: [], b: ['z'] }), ['y', 'z', 'b']);
  assert.deepEqual(topoSort({ m: [], n: [], a: ['m'] }), ['m', 'a', 'n']);
});

test('a chain is ordered by dependency whatever the names', () => {
  assert.deepEqual(topoSort({ a: ['y'], y: ['z'], z: [] }), ['z', 'y', 'a']);
});

test('repeated dependencies are ignored', () => {
  assert.deepEqual(topoSort({ a: ['b', 'b', 'b'], b: [] }), ['b', 'a']);
});

test('the input is not changed', () => {
  const g = { b: ['a', 'x'], a: [] };
  const copy = JSON.parse(JSON.stringify(g));
  topoSort(g);
  assert.deepEqual(g, copy);
  assert.deepEqual(Object.keys(g), ['b', 'a']);
});

test('an empty graph gives an empty list', () => {
  assert.deepEqual(topoSort({}), []);
});

test('a cycle lists its nodes in ascending order', () => {
  assert.throws(() => topoSort({ b: ['a'], a: ['c'], c: ['b'] }), (e) => e instanceof Error && e.message === 'cycle detected among: a, b, c');
});

test('a self-dependency is a cycle', () => {
  assert.throws(() => topoSort({ a: ['a'] }), (e) => e.message === 'cycle detected among: a');
});

test('nodes that depend on a cycle are listed too', () => {
  assert.throws(() => topoSort({ a: ['b'], b: ['a'], c: ['a'], e: ['c'], d: [] }), (e) => e.message === 'cycle detected among: a, b, c, e');
});

test('nodes the cycle depends on, and unrelated nodes, are not listed', () => {
  assert.throws(() => topoSort({ a: ['x', 'b'], b: ['a'], k: [], x: [] }), (e) => e.message === 'cycle detected among: a, b');
});

test('a graph is not a cycle just because two nodes share a dependency', () => {
  assert.deepEqual(topoSort({ a: ['c'], b: ['c'], c: [] }), ['c', 'a', 'b']);
});

test('a graph that is not a plain object is refused', () => {
  for (const g of [null, undefined, [], 'a', 5]) {
    assert.throws(() => topoSort(g), (e) => e instanceof TypeError && e.message === 'graph must be an object');
  }
});

test('dependencies must be arrays of strings, reported for the first bad node in key order', () => {
  assert.throws(() => topoSort({ a: [], b: 'a', c: [1] }), (e) => e instanceof TypeError && e.message === 'dependencies of b must be an array of strings');
  assert.throws(() => topoSort({ a: [1], b: null }), (e) => e instanceof TypeError && e.message === 'dependencies of a must be an array of strings');
});

test('a larger graph is ordered correctly', () => {
  const g = {};
  for (let i = 0; i < 500; i += 1) g[`n${String(i).padStart(3, '0')}`] = i === 0 ? [] : [`n${String(Math.floor(i / 2)).padStart(3, '0')}`];
  const order = topoSort(g);
  assert.equal(order.length, 500);
  assert.equal(order[0], 'n000');
  const pos = new Map(order.map((n, i) => [n, i]));
  for (const [n, ds] of Object.entries(g)) for (const d of ds) assert.ok(pos.get(d) < pos.get(n));
});
