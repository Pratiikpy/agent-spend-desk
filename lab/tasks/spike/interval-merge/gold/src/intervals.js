'use strict';

function mergeIntervals(intervals) {
  if (!Array.isArray(intervals)) throw new TypeError('intervals must be an array');
  intervals.forEach((iv, i) => {
    if (!Array.isArray(iv) || iv.length !== 2 || !Number.isFinite(iv[0]) || !Number.isFinite(iv[1])) {
      throw new TypeError(`invalid interval at index ${i}`);
    }
    if (iv[0] > iv[1]) throw new RangeError(`invalid interval at index ${i}`);
  });
  const sorted = intervals.map(([s, e]) => [s, e]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push(iv);
  }
  return out;
}

module.exports = { mergeIntervals };
