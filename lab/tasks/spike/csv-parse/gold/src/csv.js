'use strict';

function parseCsv(text, options = {}) {
  const delimiter = options.delimiter === undefined ? ',' : options.delimiter;
  if (typeof delimiter !== 'string' || delimiter.length !== 1 || delimiter === '"' || delimiter === '\n' || delimiter === '\r') {
    throw new RangeError('delimiter must be one character other than a quote or a line break');
  }
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const n = text.length;
  const atFieldEnd = (i) => i >= n || text[i] === delimiter || text[i] === '\n' || (text[i] === '\r' && text[i + 1] === '\n');
  const rows = [];
  let i = 0;
  while (i < n) {
    const row = [];
    for (;;) {
      let field = '';
      if (text[i] === '"') {
        i += 1;
        for (;;) {
          if (i >= n) throw new SyntaxError('unterminated quoted field');
          const c = text[i];
          if (c === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i += 2;
              continue;
            }
            i += 1;
            break;
          }
          field += c;
          i += 1;
        }
        if (!atFieldEnd(i)) throw new SyntaxError(`unexpected character at position ${i}`);
      } else {
        while (!atFieldEnd(i)) {
          if (text[i] === '"') throw new SyntaxError(`unexpected quote at position ${i}`);
          field += text[i];
          i += 1;
        }
      }
      row.push(field);
      if (i >= n) break;
      if (text[i] === delimiter) {
        i += 1;
        if (i >= n) {
          row.push('');
          break;
        }
        continue;
      }
      i += text[i] === '\r' ? 2 : 1;
      break;
    }
    rows.push(row);
  }
  return rows;
}

module.exports = { parseCsv };
