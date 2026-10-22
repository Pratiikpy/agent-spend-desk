/** A small seeded generator for the simulations and the bootstrap. The same seed always gives the same stream. */
export class Rng {
  private s: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform on [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Standard normal by the polar method. */
  normal(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    for (;;) {
      const u = 2 * this.next() - 1;
      const v = 2 * this.next() - 1;
      const q = u * u + v * v;
      if (q > 0 && q < 1) {
        const f = Math.sqrt((-2 * Math.log(q)) / q);
        this.spare = v * f;
        return u * f;
      }
    }
  }

  /** Gamma(shape, 1) by Marsaglia and Tsang (2000); shape below 1 is boosted. */
  gamma(shape: number): number {
    if (!(shape > 0)) throw new RangeError("gamma shape must be positive");
    if (shape < 1) return this.gamma(shape + 1) * Math.pow(this.next(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.next();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  beta(a: number, b: number): number {
    const x = this.gamma(a);
    const y = this.gamma(b);
    return x / (x + y);
  }

  /** Binomial(n, p) as a sum of Bernoulli draws; n is small (repeats per day). */
  binomial(n: number, p: number): number {
    let k = 0;
    for (let i = 0; i < n; i += 1) if (this.next() < p) k += 1;
    return k;
  }

  /** Uniform integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** A generator for a child stream, so that adding a draw in one place does not shift the others. */
  child(label: number): Rng {
    return new Rng((this.s ^ Math.imul(label + 1, 0x9e3779b1)) >>> 0);
  }
}

/** A deterministic 32-bit seed from a string, for bootstrap streams keyed by the data. */
export function seedFromString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
