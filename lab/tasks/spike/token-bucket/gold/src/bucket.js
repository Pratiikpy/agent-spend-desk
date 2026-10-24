'use strict';

function checkCount(n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a positive integer');
}

class TokenBucket {
  constructor(options) {
    const { capacity, refillPerSec, now = Date.now } = options || {};
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
    if (typeof refillPerSec !== 'number' || !Number.isFinite(refillPerSec) || refillPerSec <= 0) {
      throw new RangeError('refillPerSec must be a positive number');
    }
    this._capacity = capacity;
    this._rate = refillPerSec;
    this._now = now;
    this._tokens = capacity;
    this._last = now();
  }

  _refill() {
    const t = this._now();
    const elapsed = Math.max(0, t - this._last);
    this._last = t;
    this._tokens = Math.min(this._capacity, this._tokens + (elapsed * this._rate) / 1000);
  }

  available() {
    this._refill();
    return this._tokens;
  }

  tryTake(n = 1) {
    checkCount(n);
    this._refill();
    if (n > this._capacity || this._tokens < n) return false;
    this._tokens -= n;
    return true;
  }

  waitMs(n = 1) {
    checkCount(n);
    this._refill();
    if (n > this._capacity) return Infinity;
    if (this._tokens >= n) return 0;
    return Math.ceil(((n - this._tokens) * 1000) / this._rate);
  }
}

module.exports = { TokenBucket };
