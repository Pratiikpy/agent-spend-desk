// Confidence intervals for a proportion, shared by the Lab and the decision records.

/** Wilson score interval for a proportion: better behaved than the normal interval at small n and at 0 or 1. */
export function wilson(k: number, n: number, z = 1.959964): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 1 };
  const p = k / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** Exact (Clopper-Pearson) upper bound for a proportion, found by bisection on the binomial tail. */
export function clopperPearsonUpper(k: number, n: number, alpha = 0.05): number {
  if (n <= 0) return 1;
  if (k >= n) return 1;
  // P(X <= k | p) = alpha at the upper bound.
  const cdf = (p: number): number => {
    let sum = 0;
    let term = Math.pow(1 - p, n);
    sum += term;
    for (let i = 1; i <= k; i += 1) {
      term *= ((n - i + 1) / i) * (p / (1 - p));
      sum += term;
    }
    return sum;
  };
  let lo = k / n;
  let hi = 1 - 1e-12;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
