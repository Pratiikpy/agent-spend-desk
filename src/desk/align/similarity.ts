/** Edit distance over any two sequences, with two rows of memory. Used on characters for the text of one field and on words for a reply that is not JSON. */
export function editDistance<T>(a: readonly T[], b: readonly T[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length] as number;
}

/** One minus the edit distance over the longer length: 1 for the same sequence, 0 for nothing in common. Two empty sequences are the same. */
export function sequenceSimilarity<T>(a: readonly T[], b: readonly T[]): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - editDistance(a, b) / longest;
}

/** Text compared by its characters, counting a code point as one. */
export function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  return sequenceSimilarity([...a], [...b]);
}

/** Text compared by its words, for a reply that is not structured. */
export function wordSimilarity(a: string, b: string): number {
  return sequenceSimilarity(a.split(/\s+/).filter(Boolean), b.split(/\s+/).filter(Boolean));
}

/** Two numbers compared by how far apart they are against the larger: equal is 1, a value twice the other is one half, opposite signs are 0. */
export function numberSimilarity(a: number, b: number): number {
  if (a === b) return 1;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return 1;
  return Math.max(0, 1 - Math.abs(a - b) / scale);
}
