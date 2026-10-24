'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { match } = require('../src/glob.js');

/** [pattern, path, expected, options] */
const check = (rows) => {
  for (const [pattern, path, expected, options] of rows) {
    assert.equal(match(pattern, path, options), expected, `match(${JSON.stringify(pattern)}, ${JSON.stringify(path)}${options ? `, ${JSON.stringify(options)}` : ''})`);
  }
};

test('a star matches any run of characters, including none, inside one segment', () => {
  check([
    ['*', 'a', true], ['*', 'abc', true], ['a*', 'a', true], ['a*c', 'abbbc', true], ['a*c', 'ac', true], ['a*c', 'abd', false],
    ['*a*', 'bab', true], ['*.js', 'x.js', true], ['*.js', 'x.jsx', false], ['*', 'a/b', false], ['a/*', 'a/b', true], ['a/*', 'a/b/c', false],
    ['a/*/c', 'a/b/c', true], ['a/*/c', 'a/c', false], ['*b', 'aab', true], ['*b', 'aba', false],
  ]);
});

test('a question mark is exactly one character, and a character is a whole code point', () => {
  check([['?', 'a', true], ['?', 'ab', false], ['a?c', 'abc', true], ['a?c', 'ac', false], ['??', 'ab', true], ['?', '😀', true], ['??', '😀😀', true], ['?', '😀😀', false], ['?', 'é', true]]);
});

test('a backslash makes the next character ordinary', () => {
  check([['\\*', '*', true], ['\\*', 'a', false], ['a\\?c', 'a?c', true], ['a\\?c', 'abc', false], ['\\[a\\]', '[a]', true], ['\\\\', '\\', true], ['a\\b', 'ab', true], ['\\{a,b\\}', '{a,b}', true]]);
});

test('classes: members, ranges, negation with ! or ^, a leading ] or - as a plain character', () => {
  check([
    ['[abc]', 'b', true], ['[abc]', 'd', false], ['[a-c]', 'b', true], ['[a-c]', 'd', false], ['[!a-c]', 'd', true], ['[!a-c]', 'b', false], ['[^a-c]', 'd', true], ['[^a-c]', 'a', false],
    ['[]a]', ']', true], ['[]a]', 'a', true], ['[]a]', 'b', false], ['[!]a]', 'b', true], ['[!]a]', ']', false],
    ['[a-]', '-', true], ['[a-]', 'a', true], ['[a-]', 'b', false], ['[-a]', '-', true], ['[-a]', 'b', false],
    ['[z-a]', 'm', false], ['[!z-a]', 'm', true], ['[a-cx-z]', 'y', true], ['[a-cx-z]', 'm', false], ['[0-9][0-9]', '42', true], ['[0-9][0-9]', '4a', false],
    ['[\\]]', ']', true], ['[a\\-z]', '-', true], ['[a\\-z]', 'b', false], ['[a\\-z]', 'z', true], ['[[]', '[', true], ['x[a-c]*', 'xbcd', true],
  ]);
});

test('a class that is not closed is just the characters', () => {
  check([['[a', '[a', true], ['[a', 'a', false], ['a[', 'a[', true], ['[]', '[]', true], ['[!]', '[!]', true], ['[a-', '[a-', true]]);
});

test('a slash always separates segments, even where a class seems to contain it', () => {
  check([['a[/]b', 'a/b', false], ['a[/]b', 'a[/]b', true], ['[a/b]', 'a', false]]);
});

test('a star, a question mark or a class does not match a leading dot; a literal dot does', () => {
  check([
    ['*', '.a', false], ['.*', '.a', true], ['?a', '.a', false], ['[.]a', '.a', false], ['\\.a', '.a', true], ['.a', '.a', true], ['*a', 'x.a', true],
    ['*', '..', false], ['..', '..', true], ['.*', '..', true], ['.', '.', true], ['a/*', 'a/.b', false], ['a/.*', 'a/.b', true], ['a/*/c', 'a/.b/c', false],
    ['{.a,b}', '.a', true], ['{*,.a}', '.a', true], ['{*,b}', '.a', false], ['*/*', 'x/.y', false],
  ]);
});

test('the dot option lets wildcards match a leading dot', () => {
  check([['*', '.a', true, { dot: true }], ['a/*', 'a/.b', true, { dot: true }], ['**', '.a/b', true, { dot: true }], ['a/**/b', 'a/.x/b', true, { dot: true }], ['?a', '.a', true, { dot: true }], ['[.]a', '.a', true, { dot: true }], ['*', '.a', false, { dot: false }], ['*', '.a', false, { dot: 1 }], ['*', '.a', false, {}]]);
});

test('a double star that is a whole segment matches any number of segments, none included', () => {
  check([
    ['**', 'a', true], ['**', 'a/b/c', true], ['a/**', 'a', true], ['a/**', 'a/b/c', true], ['**/a', 'a', true], ['**/a', 'x/y/a', true], ['**/a', 'x/y/b', false],
    ['a/**/b', 'a/b', true], ['a/**/b', 'a/x/y/b', true], ['a/**/b', 'a/x/y/c', false], ['**/**', 'a', true], ['**/**', 'a/b', true], ['**/*.js', 'a/b/c.js', true],
    ['**/*.js', 'c.js', true], ['**/*.js', 'a/b/c.jsx', false], ['a/**/**/b', 'a/b', true], ['a/**/b/**', 'a/x/b/y/z', true], ['a/**/b/**', 'a/x/c/y/z', false],
  ]);
});

test('a double star does not walk into a directory that starts with a dot, unless the dot option is on', () => {
  check([['**', '.a', false], ['**', 'a/.b/c', false], ['**', 'a/b', true], ['a/**/b', 'a/.x/b', false], ['a/**/.b', 'a/x/.b', true], ['**/*.js', 'a/.b/c.js', false], ['**/*.js', 'a/.b/c.js', true, { dot: true }], ['**/.env', 'a/b/.env', true]]);
});

test('a double star that is part of a longer segment acts as a single star', () => {
  check([['a**b', 'a/b', false], ['a**b', 'axxb', true], ['a**b', 'ab', true], ['**a', 'xa', true], ['**a', 'x/a', false], ['***', 'a', true], ['***', 'a/b', false], ['a/***', 'a/b/c', false], ['\\*\\*', 'x', false], ['\\*\\*', '**', true]]);
});

test('braces list alternatives, which may be empty, nested, or contain slashes; a brace group with no comma is just characters', () => {
  check([
    ['a{b,c}d', 'abd', true], ['a{b,c}d', 'acd', true], ['a{b,c}d', 'ad', false], ['a{,b}d', 'ad', true], ['a{,b}d', 'abd', true], ['{a,b}{c,d}', 'bc', true], ['{a,b}{c,d}', 'ad', true],
    ['{a,b}{c,d}', 'ab', false], ['{a,{b,c}}', 'c', true], ['{a,{b,c}}', 'a', true], ['{a,{b,c}}', 'd', false], ['a/{b,c/d}/e', 'a/c/d/e', true], ['a/{b,c/d}/e', 'a/b/e', true], ['a/{b,c/d}/e', 'a/c/e', false],
    ['{*.js,*.ts}', 'x.ts', true], ['{*.js,*.ts}', 'x.css', false], ['{a,b}/*', 'a/x', true], ['{a,b}', 'c', false],
    ['{a}', '{a}', true], ['{a}', 'a', false], ['{}', '{}', true], ['{*}', '{x}', true], ['{*}', 'x', false], ['{a{b,c}}', '{ab}', true], ['{a{b,c}}', '{ac}', true],
  ]);
});

test('braces that are not closed, a closing brace on its own, commas outside braces, and escaped braces are plain characters', () => {
  check([['a{b', 'a{b', true], ['a}b', 'a}b', true], ['a,b', 'a,b', true], ['{a,b', '{a,b', true], ['{a,b}c}', 'ac}', true], ['{a,b}c}', 'bc}', true], ['a\\{b,c\\}', 'a{b,c}', true], ['a\\{b,c\\}', 'ab', false], ['x{a,b\\}', 'x{a,b}', true]]);
});

test('a leading exclamation mark negates the whole pattern, once, and an escaped one does not', () => {
  check([['!*.js', 'a.js', false], ['!*.js', 'a.txt', true], ['!a', 'a', false], ['!a', 'b', true], ['!!a', 'a', true], ['!!a', '!a', false], ['\\!a', '!a', true], ['\\!a', 'a', false], ['!{a,b}', 'c', true], ['!{a,b}', 'b', false], ['!**', 'a/b', false], ['!a/*', 'a/b/c', true]]);
});

test('with nocase, letters match in either case, in literals and in classes', () => {
  check([['A*', 'abc', false], ['A*', 'abc', true, { nocase: true }], ['[A-Z]', 'q', false], ['[A-Z]', 'q', true, { nocase: true }], ['[a-z]', 'Q', true, { nocase: true }], ['[!a-z]', 'Q', false, { nocase: true }], ['É', 'é', true, { nocase: true }], ['É', 'é', false], ['A', 'a', false, { nocase: 1 }]]);
});

test('several features together', () => {
  check([
    ['src/**/*.{js,ts}', 'src/a/b/c.ts', true], ['src/**/*.{js,ts}', 'src/c.js', true], ['src/**/*.{js,ts}', 'lib/c.js', false], ['src/**/test?/*.js', 'src/a/test1/x.js', true],
    ['src/**/test?/*.js', 'src/a/test12/x.js', false], ['!**/node_modules/**', 'a/node_modules/b/c.js', false], ['!**/node_modules/**', 'a/lib/c.js', true], ['**/[!_]*.{md,txt}', 'docs/a/readme.md', true],
    ['**/[!_]*.{md,txt}', 'docs/a/_hidden.md', false], ['**/.*', 'a/b/.gitignore', true], ['**/.*', 'a/b/c', false],
  ]);
});

test('a path with an empty segment, or one that starts or ends with a slash, or is empty, is refused', () => {
  for (const path of ['', '/a', 'a/', 'a//b', '/']) assert.throws(() => match('**', path), (e) => e instanceof Error && !(e instanceof TypeError) && e.message === `invalid path: ${path}`, JSON.stringify(path));
});

test('a pattern that is empty, starts or ends with a slash or has an empty segment is refused, and so is a lone exclamation mark', () => {
  for (const pattern of ['', '/a', 'a/', 'a//b', '!', '!/a', '!a/', '/']) assert.throws(() => match(pattern, 'a'), (e) => e instanceof Error && !(e instanceof TypeError) && e.message === `invalid pattern: ${pattern}`, JSON.stringify(pattern));
});

test('anything but two strings is a TypeError', () => {
  for (const [p, s] of [[1, 'a'], ['a', 1], [null, 'a'], ['a', undefined], [{}, []], [['a'], 'a']]) {
    assert.throws(() => match(p, s), (e) => e instanceof TypeError && e.message === 'pattern and path must be strings');
  }
});

// A second opinion on single segments: the same rules written as regular expressions, over many generated cases.
test('it agrees with a regular-expression translation on generated single-segment patterns and paths', () => {
  let seed = 20260424;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pieces = [
    { glob: 'a', re: 'a', dot: false }, { glob: 'b', re: 'b', dot: false }, { glob: '*', re: '[^/]*', dot: false }, { glob: '?', re: '[^/]', dot: false },
    { glob: '[ab]', re: '[ab]', dot: false }, { glob: '[!a]', re: '[^a/]', dot: false }, { glob: '[a-b]', re: '[a-b]', dot: false }, { glob: '\\*', re: '\\*', dot: false },
    { glob: '.', re: '\\.', dot: true }, { glob: '\\.', re: '\\.', dot: true }, { glob: '[^b]', re: '[^b/]', dot: false },
  ];
  const paths = ['a', 'b', 'ab', 'ba', 'aab', 'abab', '.a', '.', '..', 'a.', 'a.b', '*', 'a*', 'b.', '.ab', 'bb', 'abb', '.*'];
  for (let n = 0; n < 600; n += 1) {
    const len = 1 + Math.floor(rnd() * 4);
    const chosen = Array.from({ length: len }, () => pieces[Math.floor(rnd() * pieces.length)]);
    const glob = chosen.map((p) => p.glob).join('');
    const re = new RegExp(`^${chosen.map((p) => p.re).join('')}$`, 'u');
    for (const path of paths) {
      const leadingDotOk = !path.startsWith('.') || chosen[0].dot;
      const expected = re.test(path) && leadingDotOk;
      assert.equal(match(glob, path), expected, `match(${JSON.stringify(glob)}, ${JSON.stringify(path)})`);
    }
  }
});
