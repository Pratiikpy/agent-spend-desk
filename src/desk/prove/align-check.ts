import { alignJson, assign } from "../align/index.ts";

/**
 * Tool-output alignment (DF-101): the assignment finds the best pairing of every small matrix tried, an output with its keys and lists in another order scores exactly 1, a near
 * match scores between the pass line and 1, a wrong one scores under a half, one that adds or drops fields loses for it, and output that is not JSON is compared as words and
 * marked low confidence. Seeded, so the same matrices are tried on every run.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function best(m: number[][]): number {
  const cols = (m[0] as number[]).length;
  const used = new Array<boolean>(cols).fill(false);
  let top = 0;
  const go = (i: number, acc: number): void => {
    if (i === m.length) {
      top = Math.max(top, acc);
      return;
    }
    go(i + 1, acc);
    for (let j = 0; j < cols; j += 1) {
      if (used[j]) continue;
      used[j] = true;
      go(i + 1, acc + ((m[i] as number[])[j] as number));
      used[j] = false;
    }
  };
  go(0, 0);
  return top;
}

export function alignProve(): { ok: boolean; detail: string } {
  const fails: string[] = [];
  const rnd = lcg(20261025);
  let worst = 0;
  const matrices = 120;
  for (let t = 0; t < matrices; t += 1) {
    const rows = 1 + Math.floor(rnd() * 6);
    const cols = 1 + Math.floor(rnd() * 6);
    const m = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.round(rnd() * 100) / 100));
    worst = Math.max(worst, Math.abs(assign(m).total - best(m)));
  }
  if (worst > 1e-9) fails.push(`the assignment missed the best total by ${worst}`);

  const reference = { id: 7, name: "alice", tags: ["a", "b", "c"], address: { city: "Lisbon", zip: "1000" }, items: [{ sku: "x1", qty: 2 }, { sku: "y2", qty: 5 }] };
  const shuffled = { items: [{ qty: 5, sku: "y2" }, { qty: 2, sku: "x1" }], address: { zip: "1000", city: "Lisbon" }, tags: ["c", "a", "b"], name: "alice", id: 7 };
  const same = alignJson(reference, shuffled);
  if (same.score !== 1 || !same.pass) fails.push(`a reordered output scored ${same.score}`);
  const near = alignJson({ name: "alice", age: 30 }, { name: "alicia", age: 30 });
  if (!(near.score > 0.85 && near.score < 1)) fails.push(`a near match scored ${near.score}`);
  const wrong = alignJson(reference, { id: 99, name: "zed", tags: ["x"], address: { city: "Oslo", zip: "0150" }, items: [] });
  if (!(wrong.score < 0.5 && !wrong.pass)) fails.push(`a wrong output scored ${wrong.score}`);
  const dropped = alignJson({ a: 1, b: 2 }, { a: 1 });
  const added = alignJson({ a: 1 }, { a: 1, b: 2 });
  if (dropped.score !== 0.5 || added.score !== 0.5) fails.push(`a dropped field scored ${dropped.score} and an added one ${added.score}`);
  const prose = alignJson({ a: 1 }, "I could not find anything");
  if (prose.mode !== "text" || prose.confidence !== "low") fails.push("output that is not JSON was not marked low confidence");

  if (fails.length > 0) return { ok: false, detail: fails.join("; ") };
  return { ok: true, detail: `the assignment reached the highest total of every permutation on ${matrices} seeded matrices; a reordered output scored 1, a near match ${near.score.toFixed(3)}, a wrong one ${wrong.score.toFixed(3)}, a dropped or an added field 0.5, and prose was compared as words with low confidence` };
}
