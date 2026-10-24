'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Router } = require('../src/router.js');

test('slashes at either end and doubled slashes do not matter', () => {
  const r = new Router();
  r.add('/a/b/', 'x');
  for (const p of ['/a/b', '/a/b/', 'a/b', '//a//b', '/a/b//']) assert.equal(r.match(p)?.handler, 'x', p);
});

test('the root route matches / and the empty string', () => {
  const r = new Router();
  r.add('/', 'root');
  assert.equal(r.match('/')?.handler, 'root');
  assert.equal(r.match('')?.handler, 'root');
  assert.equal(r.match('/x'), null);
});

test('a failed static branch falls back to a parameter', () => {
  const r = new Router();
  r.add('/users/me/posts', 'posts').add('/users/:id/comments', 'comments');
  assert.deepEqual(r.match('/users/me/comments'), { handler: 'comments', params: { id: 'me' } });
  assert.deepEqual(r.match('/users/me/posts'), { handler: 'posts', params: {} });
});

test('a failed parameter branch falls back to a wildcard', () => {
  const r = new Router();
  r.add('/files/:name/info', 'info').add('/files/*', 'any');
  assert.deepEqual(r.match('/files/a.txt/info'), { handler: 'info', params: { name: 'a.txt' } });
  assert.deepEqual(r.match('/files/a.txt/raw'), { handler: 'any', params: { '*': 'a.txt/raw' } });
});

test('precedence is decided segment by segment from the left', () => {
  const r = new Router();
  r.add('/a/:x/c', 'param-first').add('/a/b/:y', 'static-first');
  assert.deepEqual(r.match('/a/b/c'), { handler: 'static-first', params: { y: 'c' } });
  assert.deepEqual(r.match('/a/z/c'), { handler: 'param-first', params: { x: 'z' } });
});

test('a wildcard needs at least one segment and captures the rest joined by a slash', () => {
  const r = new Router();
  r.add('/files/*', 'f');
  assert.equal(r.match('/files'), null);
  assert.equal(r.match('/files/'), null);
  assert.deepEqual(r.match('/files/a'), { handler: 'f', params: { '*': 'a' } });
  assert.deepEqual(r.match('/files/a/b/c'), { handler: 'f', params: { '*': 'a/b/c' } });
});

test('parameters are percent-decoded and so are static comparisons', () => {
  const r = new Router();
  r.add('/tags/:tag', 'tag').add('/café', 'cafe');
  assert.deepEqual(r.match('/tags/a%20b'), { handler: 'tag', params: { tag: 'a b' } });
  assert.equal(r.match('/caf%C3%A9')?.handler, 'cafe');
  assert.deepEqual(r.match('/tags/%E2%9C%93'), { handler: 'tag', params: { tag: '✓' } });
});

test('malformed percent-encoding anywhere in the path gives no match', () => {
  const r = new Router();
  r.add('/tags/:tag', 'tag').add('/static', 's');
  assert.equal(r.match('/tags/%E0%A4%A'), null);
  assert.equal(r.match('/static/%zz'), null);
  assert.equal(r.match('/%/static'), null);
});

test('several parameters are captured under their own names', () => {
  const r = new Router();
  r.add('/org/:org/repo/:repo/*', 'deep');
  assert.deepEqual(r.match('/org/acme/repo/tools/src/index.js'), { handler: 'deep', params: { org: 'acme', repo: 'tools', '*': 'src/index.js' } });
});

test('matching is case sensitive and handlers can be any value', () => {
  const r = new Router();
  const fn = () => 1;
  r.add('/Case', fn);
  assert.equal(r.match('/case'), null);
  assert.equal(r.match('/Case').handler, fn);
});

test('a route with the same shape is a duplicate, whatever its parameter names', () => {
  const r = new Router();
  r.add('/a/:x', 1).add('/a/b', 2).add('/a/*', 3);
  assert.throws(() => r.add('/a/:y', 4), (e) => e instanceof Error && e.message === 'duplicate route: /a/:y');
  assert.throws(() => r.add('/a/b/', 4), (e) => e.message === 'duplicate route: /a/b/');
  assert.throws(() => r.add('/a/*', 4), (e) => e.message === 'duplicate route: /a/*');
  assert.deepEqual(r.match('/a/q'), { handler: 1, params: { x: 'q' } });
});

test('routes that differ only after a shared parameter are not duplicates and keep their own names', () => {
  const r = new Router();
  r.add('/a/:x/b', 'one').add('/a/:y/c', 'two');
  assert.deepEqual(r.match('/a/1/b'), { handler: 'one', params: { x: '1' } });
  assert.deepEqual(r.match('/a/2/c'), { handler: 'two', params: { y: '2' } });
});

test('bad patterns are refused', () => {
  const r = new Router();
  for (const p of ['users', '', '/a/:', '/a/:1x', '/a/:x/:x', '/a/*/b', '/a/:__proto__', '/a/:x-y', 5, null]) {
    assert.throws(() => r.add(p, 'h'), (e) => e instanceof Error && e.message === `invalid route: ${p}`, String(p));
  }
});

test('a parameter named like an object property is an ordinary parameter', () => {
  const r = new Router();
  r.add('/p/:constructor/:toString', 'x');
  const m = r.match('/p/1/2');
  assert.deepEqual(m.params, { constructor: '1', toString: '2' });
  assert.equal(Object.getPrototypeOf(m.params), Object.prototype);
});

test('a path segment that looks like an object property does not match by accident', () => {
  const r = new Router();
  r.add('/a/b', 'x');
  assert.equal(r.match('/a/constructor'), null);
  assert.equal(r.match('/__proto__/b'), null);
  assert.equal(r.match('/toString'), null);
});

test('match with something that is not a string finds nothing', () => {
  const r = new Router();
  r.add('/', 'root');
  assert.equal(r.match(undefined), null);
  assert.equal(r.match(5), null);
});
