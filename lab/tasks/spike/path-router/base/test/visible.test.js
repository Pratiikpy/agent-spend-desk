'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Router } = require('../src/router.js');

test('matches a static route', () => {
  const r = new Router();
  r.add('/health', 'h');
  assert.deepEqual(r.match('/health'), { handler: 'h', params: {} });
  assert.equal(r.match('/other'), null);
});

test('captures a parameter', () => {
  const r = new Router();
  r.add('/users/:id', 'u');
  assert.deepEqual(r.match('/users/42'), { handler: 'u', params: { id: '42' } });
});

test('a static segment wins over a parameter', () => {
  const r = new Router();
  r.add('/users/:id', 'param').add('/users/me', 'static');
  assert.equal(r.match('/users/me').handler, 'static');
  assert.equal(r.match('/users/7').handler, 'param');
});
