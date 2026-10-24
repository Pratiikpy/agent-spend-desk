'use strict';

function parse(text, currency) {
  throw new Error('not implemented');
}
function format(money) {
  throw new Error('not implemented');
}
function add(a, b) {
  throw new Error('not implemented');
}
function sub(a, b) {
  throw new Error('not implemented');
}
function mul(money, factor, mode) {
  throw new Error('not implemented');
}
function allocate(money, weights) {
  throw new Error('not implemented');
}
function split(money, parts) {
  throw new Error('not implemented');
}

module.exports = { parse, format, add, sub, mul, allocate, split };
