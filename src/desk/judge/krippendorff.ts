/**
 * Krippendorff's alpha for labels with no order between them (DF-038). It says how far raters agree beyond what they would by chance given how often each label is used: 1 is
 * complete agreement, 0 is what chance gives, below 0 is worse than chance. Raters may skip a unit (a judge whose call failed), and a unit with fewer than two ratings says
 * nothing about agreement and is left out.
 *
 * Alpha is not defined when every rating is the same label: nothing in such data could have shown disagreement. It is returned as `null` and not as 1, because three judges
 * that always say "tie" have not shown that they agree about anything.
 */
export function krippendorffAlpha(units: readonly (readonly (string | null)[])[]): { alpha: number | null; units: number; pairable: number } {
  const marginal = new Map<string, number>();
  const coincide = new Map<string, number>();
  let n = 0;
  let used = 0;
  for (const u of units) {
    const ratings = u.filter((r): r is string => r !== null);
    const m = ratings.length;
    if (m < 2) continue;
    used += 1;
    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j < m; j += 1) {
        if (i === j) continue;
        const key = `${ratings[i]}\0${ratings[j]}`;
        coincide.set(key, (coincide.get(key) ?? 0) + 1 / (m - 1));
      }
    }
    for (const r of ratings) marginal.set(r, (marginal.get(r) ?? 0) + 1);
    n += m;
  }
  if (n <= 1) return { alpha: null, units: used, pairable: n };
  let observed = 0;
  for (const [key, v] of coincide) {
    const [c, k] = key.split("\0") as [string, string];
    if (c !== k) observed += v;
  }
  let expected = 0;
  const labels = [...marginal.keys()];
  for (const c of labels) for (const k of labels) if (c !== k) expected += (marginal.get(c) as number) * (marginal.get(k) as number);
  if (expected === 0) return { alpha: null, units: used, pairable: n };
  return { alpha: 1 - ((n - 1) * observed) / expected, units: used, pairable: n };
}
