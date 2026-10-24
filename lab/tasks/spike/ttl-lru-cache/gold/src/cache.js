'use strict';

function checkTtl(ttlMs) {
  if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError('ttlMs must be a positive number');
}

class TtlLruCache {
  constructor(options) {
    const { capacity, ttlMs, now = Date.now } = options || {};
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
    checkTtl(ttlMs);
    this._capacity = capacity;
    this._ttl = ttlMs;
    this._now = now;
    // Map iteration order is insertion order, so the first key is the least recently used.
    this._map = new Map();
  }

  _live(key) {
    const entry = this._map.get(key);
    if (entry === undefined) return undefined;
    if (this._now() >= entry.expires) {
      this._map.delete(key);
      return undefined;
    }
    return entry;
  }

  _purge() {
    const t = this._now();
    for (const [key, entry] of this._map) if (t >= entry.expires) this._map.delete(key);
  }

  set(key, value, ttlMs) {
    if (ttlMs !== undefined) checkTtl(ttlMs);
    const ttl = ttlMs === undefined ? this._ttl : ttlMs;
    this._map.delete(key);
    this._map.set(key, { value, expires: this._now() + ttl });
    if (this._map.size > this._capacity) {
      this._purge();
      if (this._map.size > this._capacity) this._map.delete(this._map.keys().next().value);
    }
    return this;
  }

  get(key) {
    const entry = this._live(key);
    if (entry === undefined) return undefined;
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.value;
  }

  peek(key) {
    const entry = this._live(key);
    return entry === undefined ? undefined : entry.value;
  }

  has(key) {
    return this._live(key) !== undefined;
  }

  delete(key) {
    const live = this._live(key) !== undefined;
    this._map.delete(key);
    return live;
  }

  get size() {
    this._purge();
    return this._map.size;
  }

  keys() {
    this._purge();
    return [...this._map.keys()];
  }
}

module.exports = { TtlLruCache };
