'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isValid, compare, sortVersions } = require('../src/semver.js');

test('prerelease precedence follows the specification chain', () => {
  const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
  for (let i = 0; i < chain.length - 1; i += 1) {
    assert.equal(compare(chain[i], chain[i + 1]), -1, `${chain[i]} < ${chain[i + 1]}`);
    assert.equal(compare(chain[i + 1], chain[i]), 1, `${chain[i + 1]} > ${chain[i]}`);
  }
});

test('numeric prerelease identifiers compare as numbers', () => {
  assert.equal(compare('1.0.0-beta.2', '1.0.0-beta.11'), -1);
  assert.equal(compare('1.0.0-2', '1.0.0-10'), -1);
});

test('a numeric identifier is lower than an alphanumeric one', () => {
  assert.equal(compare('1.0.0-99', '1.0.0-a'), -1);
  assert.equal(compare('1.0.0-alpha.1', '1.0.0-alpha.a'), -1);
});

test('alphanumeric identifiers compare in ASCII order', () => {
  assert.equal(compare('1.0.0-Beta', '1.0.0-alpha'), -1);
  assert.equal(compare('1.0.0-alpha', '1.0.0-alpha-1'), -1);
  assert.equal(compare('1.0.0-a-b', '1.0.0-a.b'), 1);
});

test('more identifiers are higher when the shared ones are equal', () => {
  assert.equal(compare('1.0.0-alpha', '1.0.0-alpha.0'), -1);
  assert.equal(compare('1.0.0-a.b.c', '1.0.0-a.b'), 1);
});

test('build metadata is ignored', () => {
  assert.equal(compare('1.0.0+build.1', '1.0.0+build.2'), 0);
  assert.equal(compare('1.0.0-rc.1+a', '1.0.0-rc.1'), 0);
  assert.equal(compare('1.0.1+zzz', '1.0.0+aaa'), 1);
});

test('very long numbers do not lose precision', () => {
  assert.equal(compare('1.0.0-9007199254740993', '1.0.0-9007199254740992'), 1);
  assert.equal(compare('9007199254740993.0.0', '9007199254740992.0.0'), 1);
  assert.equal(compare('1.0.0-alpha.9007199254740993', '1.0.0-alpha.9007199254740992'), 1);
});

test('isValid accepts the forms the specification lists', () => {
  for (const v of ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-0.3.7', '1.0.0-x.7.z.92', '1.0.0-x-y-z.--', '1.0.0+20130313144700', '1.0.0-beta+exp.sha.5114f85', '1.0.0+21AF26D3----117B344092BD', '0.0.0', '10.20.30']) {
    assert.equal(isValid(v), true, v);
  }
});

test('isValid refuses malformed versions without throwing', () => {
  for (const v of ['1', '1.0', '01.0.0', '1.00.0', '1.0.00', 'v1.0.0', ' 1.0.0', '1.0.0 ', '1.0.0-', '1.0.0-01', '1.0.0-alpha..1', '1.0.0+', '1.0.0+a..b', '1.0.0-al_pha', '1.0.0.0', '', '-1.0.0', '1.0.0-+a']) {
    assert.equal(isValid(v), false, JSON.stringify(v));
  }
  for (const v of [null, undefined, 1, {}, ['1.0.0']]) assert.equal(isValid(v), false);
});

test('compare throws a TypeError naming the first invalid argument', () => {
  assert.throws(() => compare('x', '1.0.0'), (e) => e instanceof TypeError && e.message === 'invalid version: x');
  assert.throws(() => compare('1.0.0', '1.0'), (e) => e instanceof TypeError && e.message === 'invalid version: 1.0');
  assert.throws(() => compare('bad', 'worse'), (e) => e instanceof TypeError && e.message === 'invalid version: bad');
  assert.throws(() => compare(1, '1.0.0'), (e) => e instanceof TypeError && e.message === 'invalid version: 1');
});

test('sortVersions returns a new ascending array and keeps equal versions in input order', () => {
  const input = ['1.0.0+b', '1.0.0+a', '1.0.0-rc.1', '0.9.0', '1.0.0-beta.11', '1.0.0-beta.2'];
  const copy = [...input];
  const out = sortVersions(input);
  assert.deepEqual(out, ['0.9.0', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0+b', '1.0.0+a']);
  assert.deepEqual(input, copy);
  assert.notEqual(out, input);
});

test('sortVersions validates its input', () => {
  assert.throws(() => sortVersions('1.0.0'), (e) => e instanceof TypeError && e.message === 'versions must be an array');
  assert.throws(() => sortVersions(['1.0.0', 'oops', 'worse']), (e) => e instanceof TypeError && e.message === 'invalid version: oops');
  assert.deepEqual(sortVersions([]), []);
});
