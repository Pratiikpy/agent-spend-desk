/**
 * Claims are the only things an answer may state. Specialists and the ledger write them; the Explainer
 * can cite them but cannot write one (spec 12.3, shared state). A claim carries its provenance class so
 * a sentence cannot call an estimate a bill.
 */
export type Unit = "usd" | "pct" | "count" | "ratio" | "none";
export type CostClass = "billed" | "reported" | "estimated" | "unpriced" | "cassette" | "computed";

export interface Claim {
  id: string;
  kind: "number" | "fact" | "comparison" | "quote";
  /** The plain-language statement of what is true. The Explainer may rephrase it but not strengthen it. */
  text: string;
  value?: number;
  unit?: Unit;
  /** How this number was obtained. A sentence may call a figure "billed" only if its class is billed. */
  class?: CostClass;
  /** Comparisons only: the interval the difference lies in. A comparison without one cannot support "as good as". */
  interval?: { low: number; high: number; level: number };
  /** The typed query or computation that produced the claim. */
  source: string;
}

export interface Sentence {
  text: string;
  cites: string[];
}

export class ClaimLedger {
  private readonly byId = new Map<string, Claim>();

  constructor(claims: readonly Claim[] = []) {
    for (const c of claims) this.add(c);
  }

  add(claim: Claim): void {
    if (this.byId.has(claim.id)) throw new Error(`duplicate claim id ${claim.id}`);
    this.byId.set(claim.id, claim);
  }

  get(id: string): Claim | undefined {
    return this.byId.get(id);
  }

  all(): Claim[] {
    return [...this.byId.values()];
  }
}
