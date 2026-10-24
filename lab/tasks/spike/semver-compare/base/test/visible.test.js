'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isValid, compare } = require('../src/semver.js');

test('orders by major, minor and patch as numbers', () => {
  assert.equal(compare('1.2.3', '1.10.0'), -1);
  assert.equal(compare('2.0.0', '1.9.9'), 1);
  assert.equal(compare('1.2.3', '1.2.3'), 0);
});

test('a release is higher than its own prerelease', () => {
  assert.equal(compare('1.0.0', '1.0.0-rc.1'), 1);
});

test('isValid accepts a plain version and refuses a short one', () => {
  assert.equal(isValid('1.2.3'), true);
  assert.equal(isValid('1.2'), false);
});
