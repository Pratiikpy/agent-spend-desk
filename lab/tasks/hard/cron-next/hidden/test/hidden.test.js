'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextRun } = require('../src/cron.js');

const at = (s) => new Date(s);
const iso = (d) => (d === null ? null : d.toISOString());
const range = (a, b, step = 1) => {
  const out = [];
  for (let v = a; v <= b; v += step) out.push(v);
  return out;
};

// A search that shares nothing with the implementation: it takes the expanded field values written out by hand, walks the
// days from the one after the start, applies the day rule, and takes the first listed time that is later than the start.
function brute(c, afterMs) {
  const startMinute = Math.floor(afterMs / 60000) * 60000 + 60000;
  const first = new Date(startMinute);
  const day0 = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
  const limit = first.getUTCFullYear() + 9;
  for (let d = 0; ; d += 1) {
    const dayStart = day0 + d * 86400000;
    const dt = new Date(dayStart);
    if (dt.getUTCFullYear() > limit) return null;
    if (!c.month.includes(dt.getUTCMonth() + 1)) continue;
    const domOk = c.dom.includes(dt.getUTCDate());
    const dowOk = c.dow.includes(dt.getUTCDay());
    const ok = c.domStar || c.dowStar ? domOk && dowOk : domOk || dowOk;
    if (!ok) continue;
    for (const h of c.hour) {
      for (const m of c.minute) {
        const t = dayStart + h * 3600000 + m * 60000;
        if (t >= startMinute) return new Date(t);
      }
    }
  }
}

test('a time exactly on a matching minute is not returned, the next one is, and seconds and milliseconds are ignored', () => {
  assert.equal(iso(nextRun('* * * * *', at('2026-03-10T10:00:00.000Z'))), '2026-03-10T10:01:00.000Z');
  assert.equal(iso(nextRun('* * * * *', at('2026-03-10T10:00:59.999Z'))), '2026-03-10T10:01:00.000Z');
  assert.equal(iso(nextRun('0 10 * * *', at('2026-03-10T10:00:00.000Z'))), '2026-03-11T10:00:00.000Z');
  assert.equal(iso(nextRun('0 10 * * *', at('2026-03-10T09:59:59.999Z'))), '2026-03-10T10:00:00.000Z');
});

test('a list, a range and a step can be combined in one field', () => {
  assert.equal(iso(nextRun('1,10-12,20-30/5 8 * * *', at('2026-03-10T08:12:00Z'))), '2026-03-10T08:20:00.000Z');
  assert.equal(iso(nextRun('1,10-12,20-30/5 8 * * *', at('2026-03-10T08:30:00Z'))), '2026-03-11T08:01:00.000Z');
  assert.equal(iso(nextRun('1,10-12,20-30/5 8 * * *', at('2026-03-10T08:26:00Z'))), '2026-03-10T08:30:00.000Z');
});

test('a step from a start value runs to the largest value of the field', () => {
  assert.equal(iso(nextRun('5/20 * * * *', at('2026-03-10T10:06:00Z'))), '2026-03-10T10:25:00.000Z');
  assert.equal(iso(nextRun('5/20 * * * *', at('2026-03-10T10:46:00Z'))), '2026-03-10T11:05:00.000Z');
  assert.equal(iso(nextRun('*/15 * * * *', at('2026-03-10T10:31:00Z'))), '2026-03-10T10:45:00.000Z');
  assert.equal(iso(nextRun('0 */7 * * *', at('2026-03-10T21:00:00Z'))), '2026-03-11T00:00:00.000Z');
});

test('names of months and days are accepted in any case, alone and as the ends of a range', () => {
  assert.equal(iso(nextRun('0 0 1 jan *', at('2026-03-10T00:00:00Z'))), '2027-01-01T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 1 Mar-MAY *', at('2026-06-10T00:00:00Z'))), '2027-03-01T00:00:00.000Z');
  assert.equal(iso(nextRun('0 9 * * mon-FRI', at('2026-03-13T09:00:00Z'))), '2026-03-16T09:00:00.000Z');
  assert.equal(iso(nextRun('0 9 * * SAT,sun', at('2026-03-10T09:00:00Z'))), '2026-03-14T09:00:00.000Z');
});

test('day of week 0 and 7 are both Sunday, and a range may run up to 7', () => {
  assert.equal(iso(nextRun('0 0 * * 7', at('2026-03-10T00:00:00Z'))), '2026-03-15T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 * * 0', at('2026-03-10T00:00:00Z'))), '2026-03-15T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 * * 5-7', at('2026-03-13T00:00:00Z'))), '2026-03-14T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 * * 6-7', at('2026-03-14T00:00:00Z'))), '2026-03-15T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 * * 7-7', at('2026-03-10T00:00:00Z'))), '2026-03-15T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 * * */2', at('2026-03-10T00:00:00Z'))), '2026-03-12T00:00:00.000Z');
});

test('when both day fields are restricted either one may match', () => {
  // 13 March 2026 is a Friday, so use a month where the 13th and the first Friday differ.
  assert.equal(iso(nextRun('0 0 13 * FRI', at('2026-04-01T00:00:00Z'))), '2026-04-03T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 13 * FRI', at('2026-04-03T00:00:00Z'))), '2026-04-10T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 13 * FRI', at('2026-04-10T00:00:00Z'))), '2026-04-13T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 1,15 * MON', at('2026-04-01T00:00:00Z'))), '2026-04-06T00:00:00.000Z');
});

test('a day field that starts with a star makes both day fields have to match', () => {
  assert.equal(iso(nextRun('0 0 */2 * FRI', at('2026-04-01T00:00:00Z'))), '2026-04-03T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 */2 * FRI', at('2026-04-03T00:00:00Z'))), '2026-04-17T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 13 * *', at('2026-04-13T00:00:00Z'))), '2026-05-13T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 * * MON', at('2026-04-01T00:00:00Z'))), '2026-04-06T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 * * */3', at('2026-04-01T00:00:00Z'))), '2026-04-04T00:00:00.000Z');
});

test('a day that does not exist in a month never matches', () => {
  assert.equal(iso(nextRun('0 0 31 * *', at('2026-04-01T00:00:00Z'))), '2026-05-31T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 31 * *', at('2026-05-31T00:00:00Z'))), '2026-07-31T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 30 * *', at('2026-01-30T00:00:00Z'))), '2026-03-30T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 29 2 *', at('2026-01-01T00:00:00Z'))), '2028-02-29T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 29 2 *', at('2096-03-01T00:00:00Z'))), '2104-02-29T00:00:00.000Z');
  assert.equal(iso(nextRun('0 0 29 2 *', at('2024-02-29T00:00:00Z'))), '2028-02-29T00:00:00.000Z');
});

test('a date that never comes within nine years gives null', () => {
  assert.equal(nextRun('0 0 30 2 *', at('2026-01-01T00:00:00Z')), null);
  assert.equal(nextRun('0 0 31 4,6,9,11 *', at('2026-01-01T00:00:00Z')), null);
});

test('it crosses the end of a month, a year and a leap day', () => {
  assert.equal(iso(nextRun('59 23 31 12 *', at('2026-12-31T23:59:30Z'))), '2027-12-31T23:59:00.000Z');
  assert.equal(iso(nextRun('0 0 1 1 *', at('2026-12-31T23:59:30Z'))), '2027-01-01T00:00:00.000Z');
  assert.equal(iso(nextRun('* * * * *', at('2028-02-28T23:59:30Z'))), '2028-02-29T00:00:00.000Z');
  assert.equal(iso(nextRun('* * * * *', at('2100-02-28T23:59:30Z'))), '2100-03-01T00:00:00.000Z');
  assert.equal(iso(nextRun('15 3 * * *', at('2026-12-31T23:59:30Z'))), '2027-01-01T03:15:00.000Z');
});

test('it takes a Date or a number of milliseconds, returns a new Date, and leaves the one given alone', () => {
  const given = at('2026-03-10T10:00:30Z');
  const copy = given.getTime();
  const a = nextRun('* * * * *', given);
  const b = nextRun('* * * * *', given.getTime());
  assert.ok(a instanceof Date);
  assert.notEqual(a, given);
  assert.equal(given.getTime(), copy);
  assert.equal(a.getTime(), b.getTime());
});

test('something else, or a value that is not a time, is a TypeError', () => {
  for (const bad of ['2026-03-10', null, undefined, NaN, Infinity, new Date('nope'), {}, [1]]) {
    assert.throws(() => nextRun('* * * * *', bad), (e) => e instanceof TypeError && e.message === 'after must be a Date or a number of milliseconds', String(bad));
  }
});

test('bad expressions are refused with the expression as it was given', () => {
  const bad = [
    '', '   ', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * 32 * *', '* * * 0 *', '* * * 13 *', '* * * * 8',
    '*/0 * * * *', '5-1 * * * *', '1-2-3 * * * *', '1,,2 * * * *', ',1 * * * *', '1, * * * *', '*/ * * * *', '/5 * * * *', '*/2/3 * * * *',
    'a * * * *', '* * * JANUARY *', '* * * * */MON', '-1 * * * *', '+1 * * * *', '1.5 * * * *', '* * * * 7-0', '* * * foo *', '* * * * MONDAY', '1-* * * * *',
    '0 0 0-5 * *', '* * * * 1-8',
  ];
  for (const expression of bad) {
    assert.throws(() => nextRun(expression, at('2026-03-10T10:00:00Z')), (e) => e instanceof Error && !(e instanceof TypeError) && e.message === `invalid cron: ${expression}`, JSON.stringify(expression));
  }
  for (const notString of [5, null, undefined, {}]) {
    assert.throws(() => nextRun(notString, at('2026-03-10T10:00:00Z')), (e) => e instanceof Error && e.message === `invalid cron: ${notString}`);
  }
});

test('the edges of every field are accepted', () => {
  assert.equal(iso(nextRun('0 0 1 1 0', at('2026-01-01T00:00:00Z'))), '2026-01-04T00:00:00.000Z');
  assert.equal(iso(nextRun('59 23 31 12 7', at('2026-12-01T00:00:00Z'))), '2026-12-06T23:59:00.000Z');
  assert.ok(nextRun('0 0 1 1 *', at('2026-01-01T00:00:00Z')) instanceof Date);
});

test('fields may be separated by any run of spaces or tabs and the whole may be padded', () => {
  assert.equal(iso(nextRun('  30\t14   *  *\t* \n', at('2026-03-10T15:00:00Z'))), '2026-03-11T14:30:00.000Z');
});

test('it agrees with a day-by-day search over many expressions and starting times', () => {
  const all = (a, b) => range(a, b);
  const cases = [
    { e: '* * * * *', minute: all(0, 59), hour: all(0, 23), dom: all(1, 31), month: all(1, 12), dow: all(0, 6), domStar: true, dowStar: true },
    { e: '0 0 * * *', minute: [0], hour: [0], dom: all(1, 31), month: all(1, 12), dow: all(0, 6), domStar: true, dowStar: true },
    { e: '*/10 */6 * * *', minute: range(0, 50, 10), hour: [0, 6, 12, 18], dom: all(1, 31), month: all(1, 12), dow: all(0, 6), domStar: true, dowStar: true },
    { e: '7,37 9-17 * * 1-5', minute: [7, 37], hour: all(9, 17), dom: all(1, 31), month: all(1, 12), dow: [1, 2, 3, 4, 5], domStar: true, dowStar: false },
    { e: '0 12 1,15 * *', minute: [0], hour: [12], dom: [1, 15], month: all(1, 12), dow: all(0, 6), domStar: false, dowStar: true },
    { e: '0 12 1,15 * 1', minute: [0], hour: [12], dom: [1, 15], month: all(1, 12), dow: [1], domStar: false, dowStar: false },
    { e: '30 4 */2 * 5', minute: [30], hour: [4], dom: range(1, 31, 2), month: all(1, 12), dow: [5], domStar: true, dowStar: false },
    { e: '0 0 29 2 *', minute: [0], hour: [0], dom: [29], month: [2], dow: all(0, 6), domStar: false, dowStar: true },
    { e: '0 0 29 2 6', minute: [0], hour: [0], dom: [29], month: [2], dow: [6], domStar: false, dowStar: false },
    { e: '15 23 31 * *', minute: [15], hour: [23], dom: [31], month: all(1, 12), dow: all(0, 6), domStar: false, dowStar: true },
    { e: '0 0 * 2,4,6 6,0', minute: [0], hour: [0], dom: all(1, 31), month: [2, 4, 6], dow: [0, 6], domStar: true, dowStar: false },
    { e: '5 5 5 5 5', minute: [5], hour: [5], dom: [5], month: [5], dow: [5], domStar: false, dowStar: false },
    { e: '*/20 22-23,0-2 * 12,1 *', minute: [0, 20, 40], hour: [0, 1, 2, 22, 23], dom: all(1, 31), month: [1, 12], dow: all(0, 6), domStar: true, dowStar: true },
    { e: '0 0 1-7 * 1', minute: [0], hour: [0], dom: range(1, 7), month: all(1, 12), dow: [1], domStar: false, dowStar: false },
    { e: '59 23 28-31 * *', minute: [59], hour: [23], dom: range(28, 31), month: all(1, 12), dow: all(0, 6), domStar: false, dowStar: true },
    { e: '0 8 * * 7', minute: [0], hour: [8], dom: all(1, 31), month: all(1, 12), dow: [0], domStar: true, dowStar: false },
    { e: '10-50/20 3 10 * *', minute: [10, 30, 50], hour: [3], dom: [10], month: all(1, 12), dow: all(0, 6), domStar: false, dowStar: true },
    { e: '0 0 30 2 *', minute: [0], hour: [0], dom: [30], month: [2], dow: all(0, 6), domStar: false, dowStar: true },
    { e: '0 0 31 4,6,9,11 *', minute: [0], hour: [0], dom: [31], month: [4, 6, 9, 11], dow: all(0, 6), domStar: false, dowStar: true },
    { e: '0 */5 * * */2', minute: [0], hour: range(0, 23, 5), dom: all(1, 31), month: all(1, 12), dow: [0, 2, 4, 6], domStar: true, dowStar: true },
  ];
  const starts = [
    '2026-01-01T00:00:00Z', '2026-02-28T23:59:59Z', '2026-03-10T10:17:42Z', '2026-06-30T23:59:00Z', '2026-12-31T23:59:59.999Z',
    '2027-07-04T12:00:00Z', '2028-02-28T23:30:00Z', '2028-02-29T12:00:00Z', '2099-12-31T23:59:59Z', '2096-03-01T00:00:00Z', '2100-02-28T00:00:00Z', '2031-11-30T04:04:04Z',
  ];
  for (const c of cases) {
    for (const s of starts) {
      const expected = brute(c, at(s).getTime());
      const got = nextRun(c.e, at(s));
      assert.equal(got === null ? null : got.toISOString(), expected === null ? null : expected.toISOString(), `${c.e} after ${s}`);
    }
  }
});
