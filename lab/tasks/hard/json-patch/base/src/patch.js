'use strict';

class PatchError extends Error {}

function applyPatch(document, patch) {
  throw new Error('not implemented');
}

module.exports = { applyPatch, PatchError };
