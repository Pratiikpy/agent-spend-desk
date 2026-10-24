'use strict';

const { encodeCursor, decodeCursor } = require('./cursor.js');

function page(items, options = {}) {
  const limit = options.limit === undefined ? 10 : options.limit;
  const start = options.cursor ? decodeCursor(options.cursor) : 0;
  const slice = items.slice(start, start + limit);
  const nextCursor = slice.length === limit ? encodeCursor(start + limit) : null;
  return { items: slice, nextCursor };
}

module.exports = { page };
