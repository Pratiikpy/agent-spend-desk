/**
 * Kuhn-Munkres assignment, for matching the elements of two unordered collections so that the pairs score as high as they can together (DF-101).
 * It takes a matrix of scores with one row per element of one side and one column per element of the other, and returns the pairs that make the
 * total largest, one column at most to each row. A matrix that is not square is padded with zeros, so the larger side's extra elements are left
 * unpaired. The method is the shortest-augmenting-path form with potentials, O(n^3); the tests check it against every permutation for small
 * matrices, because an assignment that is only nearly the best would make an output that is different look the same.
 */
export interface Assignment {
  /** The pairs [row, column] that were matched, rows ascending. A row or column that was left over is not in it. */
  pairs: [number, number][];
  /** The total of the matched scores. */
  total: number;
}

export function assign(scores: readonly (readonly number[])[]): Assignment {
  const rows = scores.length;
  const cols = rows === 0 ? 0 : scores[0]!.length;
  if (rows === 0 || cols === 0) return { pairs: [], total: 0 };
  for (const r of scores) {
    if (r.length !== cols) throw new RangeError("every row of the score matrix needs the same number of columns");
    for (const v of r) if (!Number.isFinite(v)) throw new RangeError("a score must be a finite number");
  }
  const n = Math.max(rows, cols);
  let top = 0;
  for (const r of scores) for (const v of r) if (v > top) top = v;
  // A cost to minimise: the largest score minus the score, with padding cells costing as much as a score of zero.
  const cost = (i: number, j: number): number => top - (i < rows && j < cols ? (scores[i] as readonly number[])[j]! : 0);

  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0] as number;
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - (u[i0] as number) - (v[j] as number);
        if (cur < (minv[j] as number)) {
          minv[j] = cur;
          way[j] = j0;
        }
        if ((minv[j] as number) < delta) {
          delta = minv[j] as number;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) {
          u[p[j] as number] = (u[p[j] as number] as number) + delta;
          v[j] = (v[j] as number) - delta;
        } else minv[j] = (minv[j] as number) - delta;
      }
      j0 = j1;
    } while ((p[j0] as number) !== 0);
    do {
      const j1 = way[j0] as number;
      p[j0] = p[j1] as number;
      j0 = j1;
    } while (j0 !== 0);
  }
  const pairs: [number, number][] = [];
  let total = 0;
  for (let j = 1; j <= n; j += 1) {
    const i = (p[j] as number) - 1;
    if (i < rows && j - 1 < cols) {
      pairs.push([i, j - 1]);
      total += (scores[i] as readonly number[])[j - 1]!;
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return { pairs, total };
}
