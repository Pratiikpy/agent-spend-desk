'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv } = require('../src/csv.js');

test('CRLF and LF both end a row, and a final line break adds no row', () => {
  assert.deepEqual(parseCsv('a,b\r\nc,d\r\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseCsv('a,b\nc,d\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseCsv('a,b\n'), [['a', 'b']]);
});

test('a doubled quote inside a quoted field is one quote', () => {
  assert.deepEqual(parseCsv('"he said ""hi""",x'), [['he said "hi"', 'x']]);
  assert.deepEqual(parseCsv('""""'), [['"']]);
});

test('a quoted field keeps line breaks exactly as written', () => {
  assert.deepEqual(parseCsv('"line1\nline2",b\n"c\r\nd",e'), [['line1\nline2', 'b'], ['c\r\nd', 'e']]);
});

test('empty fields are empty strings, including quoted ones and trailing ones', () => {
  assert.deepEqual(parseCsv('a,,c'), [['a', '', 'c']]);
  assert.deepEqual(parseCsv(',,'), [['', '', '']]);
  assert.deepEqual(parseCsv('a,'), [['a', '']]);
  assert.deepEqual(parseCsv('a,\nb,'), [['a', ''], ['b', '']]);
  assert.deepEqual(parseCsv('"",x'), [['', 'x']]);
});

test('a blank line is a row with one empty string', () => {
  assert.deepEqual(parseCsv('a\n\nb'), [['a'], [''], ['b']]);
  assert.deepEqual(parseCsv('\n'), [['']]);
  assert.deepEqual(parseCsv('a\r\n\r\nb'), [['a'], [''], ['b']]);
});

test('a lone carriage return is not a line break', () => {
  assert.deepEqual(parseCsv('a\rb,c'), [['a\rb', 'c']]);
});

test('nothing is trimmed', () => {
  assert.deepEqual(parseCsv(' a , b '), [[' a ', ' b ']]);
  assert.deepEqual(parseCsv('"  x  ",y'), [['  x  ', 'y']]);
});

test('a leading byte order mark is removed', () => {
  assert.deepEqual(parseCsv('﻿a,b'), [['a', 'b']]);
  assert.deepEqual(parseCsv('﻿"a",b'), [['a', 'b']]);
});

test('a custom delimiter works and the comma becomes ordinary text', () => {
  assert.deepEqual(parseCsv('a;b,c\n"x;y";z', { delimiter: ';' }), [['a', 'b,c'], ['x;y', 'z']]);
  assert.deepEqual(parseCsv('a\tb', { delimiter: '\t' }), [['a', 'b']]);
});

test('an invalid delimiter or text is refused', () => {
  const badDelimiter = (d) => assert.throws(() => parseCsv('a', { delimiter: d }), (e) => e instanceof RangeError && e.message === 'delimiter must be one character other than a quote or a line break');
  for (const d of ['', ',,', '"', '\n', '\r', 5, null]) badDelimiter(d);
  assert.throws(() => parseCsv(null), (e) => e instanceof TypeError && e.message === 'text must be a string');
  assert.throws(() => parseCsv(42), (e) => e instanceof TypeError && e.message === 'text must be a string');
});

test('input that ends inside a quoted field is an error', () => {
  assert.throws(() => parseCsv('a,"b'), (e) => e instanceof SyntaxError && e.message === 'unterminated quoted field');
  assert.throws(() => parseCsv('"a""'), (e) => e instanceof SyntaxError && e.message === 'unterminated quoted field');
});

test('a quote inside an unquoted field is an error with its position', () => {
  assert.throws(() => parseCsv('ab"c'), (e) => e instanceof SyntaxError && e.message === 'unexpected quote at position 2');
  assert.throws(() => parseCsv('x,y\nab"c'), (e) => e instanceof SyntaxError && e.message === 'unexpected quote at position 6');
});

test('a character after a closing quote is an error with its position', () => {
  assert.throws(() => parseCsv('"a"b'), (e) => e instanceof SyntaxError && e.message === 'unexpected character at position 3');
  assert.throws(() => parseCsv('"a" ,b'), (e) => e instanceof SyntaxError && e.message === 'unexpected character at position 3');
  assert.throws(() => parseCsv('﻿"a"b'), (e) => e instanceof SyntaxError && e.message === 'unexpected character at position 3');
});

test('a large input is parsed in reasonable time', () => {
  const row = 'a,"b,c",d\n';
  const rows = parseCsv(row.repeat(20000));
  assert.equal(rows.length, 20000);
  assert.deepEqual(rows[19999], ['a', 'b,c', 'd']);
});
