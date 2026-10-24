'use strict';

// A cursor remembers how many items came before the next page.
function encodeCursor(position) {
  return Buffer.from(JSON.stringify({ i: position })).toString('base64');
}

function decodeCursor(cursor) {
  return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')).i;
}

module.exports = { encodeCursor, decodeCursor };
