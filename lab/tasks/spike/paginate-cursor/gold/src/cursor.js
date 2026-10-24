'use strict';

function encodeCursor(id) {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  const invalid = () => new Error('invalid cursor');
  if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid();
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== 'id' || !Number.isSafeInteger(parsed.id)) throw invalid();
  // Only the canonical encoding is accepted, so one id has one cursor.
  if (encodeCursor(parsed.id) !== cursor) throw invalid();
  return parsed.id;
}

module.exports = { encodeCursor, decodeCursor };
