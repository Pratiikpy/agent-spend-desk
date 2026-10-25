import { describe, expect, it } from "vitest";

import { ClaimLedger, type Claim, type Sentence } from "../../../src/desk/agents/claims.ts";
import { citationFaithfulness, describeFaithfulness } from "../../../src/desk/ask/faithfulness.ts";

const usd = (id: string, value: number, text = `That cost $${value.toFixed(2)}.`): Claim => ({ id, kind: "number", text, value, unit: "usd", class: "estimated", source: "test" });
const fact = (id: string, text: string): Claim => ({ id, kind: "fact", text, source: "test" });
const ledger = (...claims: Claim[]): ClaimLedger => new ClaimLedger(claims);

describe("which of the cited claims a sentence needs", () => {
  it("calls a claim essential when the sentence stops passing the Auditor without it, and decorative when it does not", () => {
    const l = ledger(usd("a.1", 10), usd("b.1", 20));
    const f = citationFaithfulness([{ text: "That was $10.00 in all.", cites: ["a.1", "b.1"] }], l);
    expect(f.sentences[0]).toMatchObject({ essential: ["a.1"], decorative: ["b.1"] });
    expect(f).toMatchObject({ essential: 1, decorative: 1, essentialShare: 0.5 });
  });

  it("needs every claim whose figure the sentence states, and the only claim a sentence cites", () => {
    const l = ledger(usd("a.1", 10), usd("b.1", 20));
    const two = citationFaithfulness([{ text: "That was $10.00 and $20.00.", cites: ["a.1", "b.1"] }], l);
    expect(two.sentences[0]).toMatchObject({ essential: ["a.1", "b.1"], decorative: [] });
    const one = citationFaithfulness([{ text: "That was $10.00.", cites: ["a.1"] }], l);
    expect(one.sentences[0]).toMatchObject({ essential: ["a.1"], decorative: [] });
  });

  it("calls every citation of a sentence with no figure decorative when two cites each suffice, and says so rather than 'wrong'", () => {
    const l = ledger(fact("a.1", "A note."), fact("b.1", "Another note."));
    const f = citationFaithfulness([{ text: "Here is the context.", cites: ["a.1", "b.1"] }], l);
    expect(f.sentences[0]).toMatchObject({ essential: [], decorative: ["a.1", "b.1"] });
    expect(describeFaithfulness(f)).toBe("0 of 2 citations are needed by the sentence that makes them; decorative: sentence 1 (a.1, b.1)");
  });

  it("needs the claim a class word rests on: a sentence that says billed cannot lose its billed claim", () => {
    const billed: Claim = { ...usd("a.1", 10), class: "billed" };
    const l = ledger(billed, usd("b.1", 10));
    const f = citationFaithfulness([{ text: "You were billed $10.00.", cites: ["a.1", "b.1"] }], l);
    expect(f.sentences[0]).toMatchObject({ essential: ["a.1"], decorative: ["b.1"] });
  });

  it("needs the comparison claim, with its interval, that a comparative sentence rests on", () => {
    const cmp: Claim = { id: "c.1", kind: "comparison", text: "A was cheaper than B by $5.00.", value: 5, unit: "usd", interval: { low: 3, high: 7, level: 0.95 }, source: "test" };
    const l = ledger(cmp, usd("a.1", 5));
    const f = citationFaithfulness([{ text: "A was cheaper than B, by $5.00.", cites: ["c.1", "a.1"] }], l);
    expect(f.sentences[0]!.essential).toContain("c.1");
    expect(f.sentences[0]!.decorative).toContain("a.1");
  });

  it("counts a repeated citation once, tests each sentence on its own, and has nothing to say when no sentence cites anything", () => {
    const l = ledger(usd("a.1", 10), usd("b.1", 20));
    const s: Sentence[] = [{ text: "That was $10.00.", cites: ["a.1", "a.1"] }, { text: "That was $20.00.", cites: ["b.1", "a.1"] }];
    const f = citationFaithfulness(s, l);
    expect(f.sentences.map((x) => [x.essential, x.decorative])).toEqual([[["a.1"], []], [["b.1"], ["a.1"]]]);
    expect(f).toMatchObject({ essential: 2, decorative: 1 });
    const none = citationFaithfulness([], l);
    expect(none.essentialShare).toBeNull();
    expect(describeFaithfulness(none)).toBe("no citation to test");
  });

  it("treats a claim the ledger does not hold as one the sentence cannot rest on, so it is never called decorative", () => {
    const l = ledger(usd("a.1", 10));
    const f = citationFaithfulness([{ text: "That was $10.00.", cites: ["a.1", "ghost"] }], l);
    // Without a.1 the sentence cites only a claim that does not exist, which fails; without the ghost it stands. The ghost is decorative; the real claim is essential.
    expect(f.sentences[0]).toMatchObject({ essential: ["a.1"], decorative: ["ghost"] });
  });
});
