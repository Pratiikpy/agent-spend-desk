'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { satisfies, maxSatisfying } = require('../src/range.js');

/** [version, range, expected, options] */
const check = (rows) => {
  for (const [version, range, expected, options] of rows) {
    assert.equal(satisfies(version, range, options), expected, `satisfies(${JSON.stringify(version)}, ${JSON.stringify(range)}${options ? `, ${JSON.stringify(options)}` : ''})`);
  }
};
const invalidVersion = (text) => (e) => e instanceof Error && !(e instanceof TypeError) && e.message === `invalid version: ${text}`;
const invalidRange = (text) => (e) => e instanceof Error && !(e instanceof TypeError) && e.message === `invalid range: ${text}`;

test('an exact version, with or without an equals sign, and build metadata never counts', () => {
  check([['1.2.3', '1.2.3', true], ['1.2.4', '1.2.3', false], ['1.2.3', '=1.2.3', true], ['1.2.3+build.5', '1.2.3', true], ['1.2.3', '1.2.3+other', true], ['1.2.3-beta', '1.2.3', false]]);
});

test('comparators and sets of comparators', () => {
  check([
    ['1.2.4', '>1.2.3 <1.2.5', true], ['1.2.5', '>1.2.3 <1.2.5', false], ['1.2.3', '>1.2.3 <1.2.5', false], ['1.2.3', '>=1.2.3 <=1.2.3', true], ['1.2.3', '<1.2.3', false],
    ['0.0.1', '<1.2.3', true], ['1.2.3', '<=1.2.3', true], ['10.0.0', '>9.9.9', true], ['1.10.0', '>1.9.0', true], ['1.5.0', '  >=1.2.3    <2.0.0  ', true],
  ]);
});

test('caret ranges keep the leftmost non-zero part fixed', () => {
  check([
    ['1.2.3', '^1.2.3', true], ['1.9.9', '^1.2.3', true], ['2.0.0', '^1.2.3', false], ['1.2.2', '^1.2.3', false],
    ['0.2.9', '^0.2.3', true], ['0.3.0', '^0.2.3', false], ['0.2.2', '^0.2.3', false], ['0.0.3', '^0.0.3', true], ['0.0.4', '^0.0.3', false], ['0.1.0', '^0.0.3', false],
    ['1.2.0', '^1.2.x', true], ['1.9.0', '^1.2.x', true], ['2.0.0', '^1.2.x', false], ['1.1.9', '^1.2.x', false],
    ['0.0.9', '^0.0.x', true], ['0.1.0', '^0.0.x', false], ['0.9.0', '^0.x', true], ['1.0.0', '^0.x', false], ['0.9.9', '^0', true], ['1.0.0', '^0', false],
    ['1.0.0', '^1', true], ['1.9.0', '^1.x', true], ['2.0.0', '^1', false], ['0.0.9', '^0.0', true], ['0.1.0', '^0.0', false], ['0.5.9', '^0.5', true], ['0.6.0', '^0.5', false], ['1.2.0', '^1.2', true], ['2.0.0', '^1.2', false],
  ]);
});

test('tilde ranges fix the minor part when it is given', () => {
  check([
    ['1.2.3', '~1.2.3', true], ['1.2.9', '~1.2.3', true], ['1.3.0', '~1.2.3', false], ['1.2.2', '~1.2.3', false], ['1.2.0', '~1.2', true], ['1.3.0', '~1.2', false],
    ['1.0.0', '~1', true], ['1.9.9', '~1', true], ['2.0.0', '~1', false], ['0.2.5', '~0.2.3', true], ['0.3.0', '~0.2.3', false], ['0.9.9', '~0', true], ['1.0.0', '~0', false], ['5.0.0', '~*', true],
  ]);
});

test('x-ranges and the empty range', () => {
  check([
    ['1.5.0', '1.x', true], ['1.5.0', '1.*', true], ['1.5.0', '1.X', true], ['1.5.0', '1', true], ['2.0.0', '1', false], ['1.2.9', '1.2.x', true], ['1.3.0', '1.2.x', false], ['1.2.9', '1.2', true],
    ['9.9.9', '*', true], ['9.9.9', '', true], ['9.9.9', 'x', true], ['9.9.9', '   ', true], ['0.0.0', '*', true], ['2.0.0', '1.x || 2.x', true], ['3.0.0', '1.x || 2.x', false],
  ]);
});

test('a comparator with a partial version means the whole family it names', () => {
  check([
    ['1.2.9', '>1.2', false], ['1.3.0', '>1.2', true], ['1.2.0', '>=1.2', true], ['1.1.9', '>=1.2', false], ['1.1.9', '<1.2', true], ['1.2.0', '<1.2', false], ['1.2.9', '<=1.2', true], ['1.3.0', '<=1.2', false],
    ['1.9.9', '>1', false], ['2.0.0', '>1', true], ['1.0.0', '>=1', true], ['0.9.9', '>=1', false], ['0.9.9', '<1', true], ['1.0.0', '<1', false], ['1.9.9', '<=1', true], ['2.0.0', '<=1', false],
    ['1.2.3', '>1.2.x', false], ['1.3.0', '>1.2.x', true], ['5.0.0', '>=*', true], ['5.0.0', '<=*', true], ['5.0.0', '>*', false], ['5.0.0', '<*', false], ['1.2.3', '=1.2', true], ['1.3.0', '=1.2', false],
  ]);
});

test('hyphen ranges include both ends, and a partial upper end means the whole family', () => {
  check([
    ['1.2.3', '1.2.3 - 2.3.4', true], ['2.3.4', '1.2.3 - 2.3.4', true], ['2.3.5', '1.2.3 - 2.3.4', false], ['1.2.2', '1.2.3 - 2.3.4', false],
    ['1.2.0', '1.2 - 2.3.4', true], ['1.1.9', '1.2 - 2.3.4', false], ['2.3.99', '1.2.3 - 2.3', true], ['2.4.0', '1.2.3 - 2.3', false], ['2.99.0', '1.2.3 - 2', true], ['3.0.0', '1.2.3 - 2', false],
    ['1.0.0', '1 - 2', true], ['2.9.9', '1 - 2', true], ['3.0.0', '1 - 2', false], ['0.9.9', '1 - 2', false], ['5.0.0', '1.2.3 - *', true], ['1.2.2', '1.2.3 - *', false],
  ]);
});

test('alternatives with || each stand on their own, and an empty alternative means any version', () => {
  check([
    ['2.5.0', '^1.2.3 || ^2.0.0', true], ['3.0.0', '^1.2.3 || ^2.0.0', false], ['1.2.3', '^1.2.3||^2.0.0', true], ['6.0.0', '1.x || >=2.5.0 || 5.0.0 - 7.2.3', true], ['4.0.0', '1.x || >=2.5.0 || 5.0.0 - 7.2.3', true],
    ['2.4.0', '1.x || >=2.5.0 || 5.0.0 - 7.2.3', false], ['0.5.0', '1.x || >=2.5.0 || 5.0.0 - 7.2.3', false], ['9.9.9', '1.2.3 ||', true], ['9.9.9', '||', true], ['9.9.9', '<1.0.0 ||', true],
  ]);
});

test('a prerelease satisfies a set only when one of its comparators names a prerelease of the same major.minor.patch', () => {
  check([
    ['1.2.3-beta.2', '>=1.2.3-beta.1', true], ['1.2.3-beta.2', '^1.2.3-beta.1', true], ['1.2.3-beta.2', '~1.2.3-beta.1', true], ['1.2.3-beta.2', '1.2.3-beta.2', true], ['1.2.3-beta.2', '1.2.3-beta.1', false],
    ['1.2.4-beta.1', '>=1.2.3-beta.1 <2.0.0', false], ['1.2.3-beta', '>=1.2.0', false], ['1.2.3-beta', '^1.2.0', false], ['2.0.0-rc.1', '<2.0.0', false], ['2.0.0-rc.1', '<2.0.0-rc.2', true],
    ['2.0.0-rc.3', '<2.0.0-rc.2', false], ['1.0.0-alpha', '*', false], ['1.0.0-alpha', '1.x', false], ['1.0.0-alpha', '>=0.0.0', false], ['1.2.3-beta.2', '>=1.2.3-beta.1 || <1.0.0', true],
    ['1.2.3-beta.2', '>=1.2.3-beta.5 || 1.2.3-beta.1', false], ['1.2.3-beta.2', '<1.0.0 || >=1.2.3-beta.1', true], ['1.2.3', '>=1.2.3-beta.1', true], ['3.0.0-pre', '>=1.2.3-beta.1', false], ['1.2.3-beta.1', '1.2.3 - 1.2.3', false],
    ['1.2.3-beta.2', '1.2.3-beta.1 - 1.2.3', true],
  ]);
});

test('with includePrerelease a prerelease is judged by its place in the order alone', () => {
  check([
    ['1.0.0-alpha', '*', true, { includePrerelease: true }], ['2.0.0-rc.1', '<2.0.0', true, { includePrerelease: true }], ['1.2.4-beta.1', '>=1.2.3 <2.0.0', true, { includePrerelease: true }],
    ['1.2.2-beta.1', '>=1.2.3 <2.0.0', false, { includePrerelease: true }], ['1.0.0-alpha', '*', false, { includePrerelease: 1 }], ['1.0.0-alpha', '*', false, { includePrerelease: false }], ['1.0.0-alpha', '*', false, {}],
  ]);
});

test('prerelease precedence follows semver 2.0: numbers by value, names by text, numbers before names, a shorter list before a longer one, a prerelease before its release', () => {
  const order = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
  for (let i = 0; i < order.length; i += 1) {
    for (let j = 0; j < order.length; j += 1) {
      assert.equal(satisfies(order[i], `<${order[j]}`, { includePrerelease: true }), i < j, `${order[i]} < ${order[j]}`);
      assert.equal(satisfies(order[i], `>=${order[j]}`, { includePrerelease: true }), i >= j, `${order[i]} >= ${order[j]}`);
    }
  }
  assert.equal(satisfies('1.0.0-2', '<1.0.0-10', { includePrerelease: true }), true);
  assert.equal(satisfies('1.0.0-2', '<1.0.0-a', { includePrerelease: true }), true);
  assert.equal(satisfies('1.0.0-a', '<1.0.0-2', { includePrerelease: true }), false);
  assert.equal(satisfies('1.0.0-Alpha', '<1.0.0-alpha', { includePrerelease: true }), true);
  assert.equal(satisfies('1.0.0-a-b', '1.0.0-a-b'), true);
});

test('maxSatisfying gives the highest version in the range, the first of equals, and null when none', () => {
  assert.equal(maxSatisfying(['1.2.3', '1.9.0', '2.0.0', '1.10.0', '0.9.0'], '^1'), '1.10.0');
  assert.equal(maxSatisfying(['1.0.0+a', '1.0.0+b'], '*'), '1.0.0+a');
  assert.equal(maxSatisfying(['3.0.0', '4.0.0'], '^1'), null);
  assert.equal(maxSatisfying([], '*'), null);
  assert.equal(maxSatisfying(['1.0.0-alpha', '1.0.0-beta'], '*'), null);
  assert.equal(maxSatisfying(['1.0.0-alpha', '1.0.0-beta.2', '1.0.0-beta.11'], '*', { includePrerelease: true }), '1.0.0-beta.11');
  assert.equal(maxSatisfying(['1.2.3-beta.2', '1.2.3-beta.7', '1.2.3-alpha'], '>=1.2.3-beta.1'), '1.2.3-beta.7');
  assert.equal(maxSatisfying(['1.2.3', 'nonsense', 'v2.0.0', '1.5.0', '01.0.0'], '^1'), '1.5.0');
  assert.equal(maxSatisfying(['0.1.0', '1.0.0-rc.1', '1.0.0'], '<2.0.0 || 1.0.0-rc.1'), '1.0.0');
});

test('a version has to be exactly major.minor.patch with an optional prerelease and build: nothing else is accepted', () => {
  for (const version of ['1.2', '1', 'v1.2.3', '01.2.3', '1.02.3', '1.2.03', '1.2.3.4', '1.2.3-', '1.2.3-01', '1.2.3-a..b', '1.2.3-a.', '1.2.3+', '1.2.3+a..b', ' 1.2.3', '1.2.3 ', '-1.2.3', '1.2.x', '', 'a.b.c', '1.2.3-@', '99999999999999999999.0.0']) {
    assert.throws(() => satisfies(version, '*'), invalidVersion(version), JSON.stringify(version));
  }
  for (const version of [1, null, undefined, {}, ['1.2.3']]) assert.throws(() => satisfies(version, '*'), (e) => e instanceof TypeError && e.message === 'version must be a string');
  for (const version of ['0.0.0', '1.2.3-0', '1.2.3-0a', '1.2.3-a-b.c-d', '1.2.3-0.0', '1.2.3+001', '1.2.3-x.7.z.92+20130313144700']) assert.doesNotThrow(() => satisfies(version, '*'), version);
});

test('a range has to be made of the forms above: anything else is refused with the range as it was given', () => {
  for (const range of ['>=', '^', '~', '1.2.3 -', '- 1.2.3', '1.2.3 - 2.0.0 - 3.0.0', 'foo', '1.2.3.4', '>>1', '~~1', '^^1', '>= 1.2.3', '1.2.3 <', '=>1.2.3', '1.2-beta', '>1.2.3-', '1.x.x.x', '^1.2.3-', '1..2', '1.2.3 || foo', 'a.b.c', '>=1.2.3 <=', '~>1', '*.*.1a']) {
    assert.throws(() => satisfies('1.2.3', range), invalidRange(range), JSON.stringify(range));
  }
  for (const range of [1, null, undefined, {}, ['1']]) assert.throws(() => satisfies('1.2.3', range), invalidRange(range));
  assert.throws(() => maxSatisfying(['1.2.3'], 'foo'), invalidRange('foo'));
});
