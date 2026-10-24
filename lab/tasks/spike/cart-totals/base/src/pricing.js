'use strict';

const { percentOf } = require('./money.js');

// What a line costs once its discount is taken off, in cents.
function lineNet(lineCents, discountPercent) {
  const net = Math.round(lineCents * (1 - discountPercent / 100));
  return { discountCents: lineCents - net, netCents: net };
}

function taxOn(cents, taxPercent) {
  return percentOf(cents, taxPercent);
}

module.exports = { lineNet, taxOn };
