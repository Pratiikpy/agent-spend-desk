'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { match } = require('../src/glob.js');

test('star stays inside a segment and double star crosses segments', () => {
  assert.equal(match('src/*.js', 'src/a.js'), true);
  assert.equal(match('src/*.js', 'src/lib/a.js'), false);
  assert.equal(match('src/**/*.js', 'src/lib/a.js'), true);
});

test('alternatives in braces', () => {
  assert.equal(match('a.{js,ts}', 'a.ts'), true);
  assert.equal(match('a.{js,ts}', 'a.css'), false);
});

test('a bad path is refused with the path in the message', () => {
  assert.throws(() => match('*', 'a//b'), (e) => e instanceof Error && e.message === 'invalid path: a//b');
});
