'use strict';

const { toCents } = require('./money.js');
const { lineNet, taxOn } = require('./pricing.js');

class Cart {
  constructor({ taxPercent = 0 } = {}) {
    this.taxPercent = taxPercent;
    this.items = [];
  }

  add(sku, unitPrice, quantity = 1, discountPercent = 0) {
    this.items.push({ sku, unitCents: toCents(unitPrice), quantity, discountPercent });
    return this;
  }

  summary() {
    const lines = [];
    let subtotalCents = 0;
    for (const item of this.items) {
      const lineCents = item.unitCents * item.quantity;
      const { discountCents, netCents } = lineNet(lineCents, item.discountPercent);
      lines.push({ sku: item.sku, lineCents, discountCents, netCents });
      subtotalCents += netCents;
    }
    const taxCents = taxOn(subtotalCents, this.taxPercent);
    return { lines, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
  }
}

module.exports = { Cart };
