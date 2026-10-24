'use strict';

function toCents(amount) {
  return Math.round(amount * 100);
}

// A share of `cents`, as whole cents.
function percentOf(cents, percent) {
  return Math.round((cents * percent) / 100);
}

function formatCents(cents) {
  return '$' + (cents / 100).toFixed(2);
}

module.exports = { toCents, percentOf, formatCents };
