'use strict';

function topoSort(graph) {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) throw new TypeError('graph must be an object');
  const deps = new Map();
  for (const node of Object.keys(graph)) {
    const list = graph[node];
    if (!Array.isArray(list) || list.some((d) => typeof d !== 'string')) {
      throw new TypeError(`dependencies of ${node} must be an array of strings`);
    }
    deps.set(node, new Set(list));
  }
  for (const set of [...deps.values()]) {
    for (const d of set) if (!deps.has(d)) deps.set(d, new Set());
  }

  const waiting = new Map();
  const dependents = new Map();
  for (const [node, set] of deps) {
    waiting.set(node, set.size);
    for (const d of set) {
      if (!dependents.has(d)) dependents.set(d, []);
      dependents.get(d).push(node);
    }
  }

  const order = [];
  const ready = [...waiting].filter(([, count]) => count === 0).map(([node]) => node);
  while (ready.length > 0) {
    ready.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    const node = ready.shift();
    order.push(node);
    for (const next of dependents.get(node) || []) {
      waiting.set(next, waiting.get(next) - 1);
      if (waiting.get(next) === 0) ready.push(next);
    }
  }

  if (order.length < deps.size) {
    const placed = new Set(order);
    const stuck = [...deps.keys()].filter((n) => !placed.has(n)).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    throw new Error(`cycle detected among: ${stuck.join(', ')}`);
  }
  return order;
}

module.exports = { topoSort };
