'use strict';

function toCents(amount) {
  return Math.round(amount * 100);
}

// A share of `cents`, as whole cents, rounded half away from zero. The percentage has at most two decimals, so it is
// held as whole hundredths of a percent and everything after that is integer arithmetic.
function percentOf(cents, percent) {
  const hundredths = Math.round(percent * 100);
  const scaled = cents * hundredths;
  const rounded = Math.floor((Math.abs(scaled) * 2 + 10000) / 20000);
  return scaled < 0 && rounded !== 0 ? -rounded : rounded;
}

function formatCents(cents) {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rest = String(abs % 100).padStart(2, '0');
  return `${cents < 0 ? '-' : ''}$${dollars}.${rest}`;
}

module.exports = { toCents, percentOf, formatCents };
