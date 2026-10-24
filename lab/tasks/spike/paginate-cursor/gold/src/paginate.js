'use strict';

const { encodeCursor, decodeCursor } = require('./cursor.js');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function page(items, options = {}) {
  const requested = options.limit === undefined ? DEFAULT_LIMIT : options.limit;
  if (!Number.isInteger(requested) || requested < 1) throw new RangeError('limit must be a positive integer');
  const limit = Math.min(requested, MAX_LIMIT);
  const hasCursor = options.cursor !== undefined && options.cursor !== null;
  const after = hasCursor ? decodeCursor(options.cursor) : -Infinity;

  const remaining = items.filter((item) => item.id > after);
  const slice = remaining.slice(0, limit);
  const nextCursor = remaining.length > limit ? encodeCursor(slice[slice.length - 1].id) : null;
  return { items: slice, nextCursor };
}

module.exports = { page };
