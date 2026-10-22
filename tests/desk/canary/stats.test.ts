import { describe, expect, it } from "vitest";

import { Rng } from "../../../src/desk/canary/rng.ts";
import { betaIncReg, betaQuantile, clopperPearson, clusterInterval, clusterMean, effectiveClusters, mdeFromSe, normalCdf, normalQuantile, tCdf, tQuantile } from "../../../src/desk/canary/stats.ts";

// Reference values were produced with SciPy 1.17.1 (scipy.stats.t.ppf, norm.ppf, beta.ppf, beta.cdf, t.cdf).
describe("distribution functions against SciPy", () => {
  it.each([
    [0.995, 3, 5.840909309733355],
    [0.995, 5, 4.032142983555228],
    [0.995, 7, 3.4994832973504924],
    [0.995, 11, 3.105806515539281],
    [0.995, 23, 2.807335683769999],
    [0.975, 2, 4.302652729749462],
    [0.975, 10, 2.2281388519862744],
    [0.995, 1, 63.656741162871526],
  ])("t quantile p=%s df=%s", (p, df, want) => {
    expect(tQuantile(p, df)).toBeCloseTo(want, 8);
  });

  it("t CDF, both tails", () => {
    expect(tCdf(1.7, 6)).toBeCloseTo(0.9299801726875513, 10);
    expect(tCdf(-2.9, 3)).toBeCloseTo(0.03125112099832271, 10);
  });

  it("normal quantile and CDF", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 10);
    expect(normalQuantile(0.999)).toBeCloseTo(3.090232306167813, 10);
    expect(normalCdf(1.2345)).toBeCloseTo(0.8914916766373298, 10);
  });

  it("incomplete beta and Clopper-Pearson", () => {
    expect(betaIncReg(0.3, 2.5, 4.5)).toBeCloseTo(0.4065390166824594, 10);
    expect(betaQuantile(0.025, 3, 10)).toBeCloseTo(0.054860644527992726, 9);
    expect(betaQuantile(0.975, 4, 9)).toBeCloseTo(0.5718584618781891, 9);
    // zero alarms in 500 histories: exact 95% upper bound is 1 - 0.025^(1/500)
    expect(clopperPearson(0, 500).high).toBeCloseTo(1 - Math.pow(0.025, 1 / 500), 9);
    expect(clopperPearson(0, 500).low).toBe(0);
  });

  it("rejects impossible input", () => {
    expect(() => tQuantile(0, 5)).toThrow();
    expect(() => tCdf(1, 0)).toThrow();
    expect(() => clopperPearson(6, 5)).toThrow();
  });
});

describe("cluster-robust mean", () => {
  it("matches the formula by hand for a small case", () => {
    // values 1,2 in cluster a; 4,5 in cluster b. mean 3. cluster sums of deviations: (-2)+(-1) = -3, (1)+(2) = 3.
    // SE^2 = G/(G-1) * (9+9) / K^2 = 2 * 18 / 16 = 2.25
    const e = clusterMean([
      { value: 1, cluster: "a" },
      { value: 2, cluster: "a" },
      { value: 4, cluster: "b" },
      { value: 5, cluster: "b" },
    ]);
    expect(e.mean).toBe(3);
    expect(e.se).toBeCloseTo(1.5, 12);
    expect(e.g).toBe(2);
  });

  it("with one cluster there is no standard error, and with fewer than four clusters each task is its own cluster", () => {
    expect(clusterMean([{ value: 1, cluster: "a" }, { value: 2, cluster: "a" }]).se).toBeNaN();
    const three = [
      { value: 1, cluster: "a" },
      { value: 2, cluster: "a" },
      { value: 4, cluster: "b" },
      { value: 5, cluster: "c" },
    ];
    expect(new Set(effectiveClusters(three).map((i) => i.cluster)).size).toBe(4);
  });

  it("an empty list gives NaN and no interval", () => {
    expect(clusterMean([]).mean).toBeNaN();
    expect(clusterInterval([], 0.99, "t")).toBeNull();
  });

  it("the t interval is the mean plus or minus t(0.995, G-1) times the standard error", () => {
    const rng = new Rng(3);
    const items = Array.from({ length: 24 }, (_, i) => ({ value: rng.normal() * 0.1, cluster: `c${i % 6}` }));
    const iv = clusterInterval(items, 0.99, "t")!;
    const e = clusterMean(items);
    expect(iv.high - e.mean).toBeCloseTo(tQuantile(0.995, 5) * e.se, 10);
    expect(iv.g).toBe(6);
  });

  it("the bootstrap-t interval is reproducible and contains the mean", () => {
    const rng = new Rng(9);
    const items = Array.from({ length: 16 }, (_, i) => ({ value: rng.normal() * 0.1 - 0.05, cluster: `c${i % 4}` }));
    const a = clusterInterval(items, 0.99, "bootstrap_t")!;
    const b = clusterInterval(items, 0.99, "bootstrap_t")!;
    expect(a).toEqual(b);
    expect(a.low).toBeLessThan(a.mean);
    expect(a.high).toBeGreaterThan(a.mean);
  });

  it("all-equal values give a zero-width t interval, and the bootstrap declines instead of dividing by zero", () => {
    const flat = Array.from({ length: 12 }, (_, i) => ({ value: 0, cluster: `c${i % 4}` }));
    const t = clusterInterval(flat, 0.99, "t")!;
    expect(t.low).toBe(0);
    expect(t.high).toBe(0);
    expect(clusterInterval(flat, 0.99, "bootstrap_t")).toBeNull();
  });

  it("NaN in an input value poisons the estimate rather than being skipped", () => {
    const e = clusterMean([{ value: NaN, cluster: "a" }, { value: 1, cluster: "b" }]);
    expect(Number.isNaN(e.mean)).toBe(true);
  });

  it("MDE is (t + 0.842) times the standard error", () => {
    expect(mdeFromSe(0.02, 6)).toBeCloseTo((tQuantile(0.995, 5) + 0.8416212335729143) * 0.02, 12);
  });
});

describe("the generator", () => {
  it("is reproducible and has the right moments", () => {
    const a = new Rng(1);
    const b = new Rng(1);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
    const r = new Rng(2);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i += 1) sum += r.beta(3.6, 2.4);
    expect(sum / n).toBeCloseTo(0.6, 1);
    let bin = 0;
    for (let i = 0; i < n; i += 1) bin += r.binomial(5, 0.3);
    expect(bin / n).toBeCloseTo(1.5, 1);
  });
});
