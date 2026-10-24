'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextRun } = require('../src/cron.js');

const at = (s) => new Date(s);

test('every minute gives the next whole minute', () => {
  assert.deepEqual(nextRun('* * * * *', at('2026-03-10T10:00:30Z')), at('2026-03-10T10:01:00Z'));
});

test('a fixed time of day', () => {
  assert.deepEqual(nextRun('30 14 * * *', at('2026-03-10T15:00:00Z')), at('2026-03-11T14:30:00Z'));
});

test('a bad expression is refused with the expression in the message', () => {
  assert.throws(() => nextRun('* * * *', new Date()), (e) => e instanceof Error && e.message === 'invalid cron: * * * *');
});
