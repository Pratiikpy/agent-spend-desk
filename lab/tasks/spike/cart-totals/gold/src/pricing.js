'use strict';

const { percentOf } = require('./money.js');

// What a line costs once its discount is taken off, in cents.
function lineNet(lineCents, discountPercent) {
  const discountCents = percentOf(lineCents, discountPercent);
  return { discountCents, netCents: lineCents - discountCents };
}

function taxOn(cents, taxPercent) {
  return percentOf(cents, taxPercent);
}

module.exports = { lineNet, taxOn };
