import { auditSentences } from "../agents/audit.ts";
import type { ClaimLedger, Sentence } from "../agents/claims.ts";

/**
 * Whether the claims an answer cites are the claims it rests on (DF-108). A sentence lists the claims that support it; a listed claim the sentence does not need is a
 * decoration: it makes the sentence look better supported than it is. The test is leave-one-out against the same Auditor that accepted the sentence: take one cited
 * claim away, ask the Auditor again, and see whether the sentence still stands. If it does, that claim added nothing the Auditor could find, and it is decorative for that
 * sentence. If it does not, the sentence needs it.
 *
 * It is code and costs no model call, which is why it can be run on every answer. What it can say is limited to what the Auditor checks: that the numbers in a sentence are in
 * the claims it cites, that a class word (billed, estimated) agrees with a cited claim, that a comparison cites an interval. A claim that is only context for the reader and
 * carries no number or word the sentence uses is decorative by this test, and the sentence may still be better for it; the answer says "decorative", never "wrong".
 */
export interface SentenceFaithfulness {
  index: number;
  cites: string[];
  /** Cited claims without which the sentence no longer passes the Auditor. */
  essential: string[];
  /** Cited claims that can be taken away with the sentence still passing. */
  decorative: string[];
}

export interface Faithfulness {
  sentences: SentenceFaithfulness[];
  essential: number;
  decorative: number;
  /** Essential citations as a share of all citations, or null when there are none to test. */
  essentialShare: number | null;
}

export function citationFaithfulness(sentences: readonly Sentence[], ledger: ClaimLedger): Faithfulness {
  const out: SentenceFaithfulness[] = [];
  let essential = 0;
  let decorative = 0;
  sentences.forEach((s, index) => {
    const cites = [...new Set(s.cites)];
    const mine: SentenceFaithfulness = { index, cites, essential: [], decorative: [] };
    for (const c of cites) {
      const rest = cites.filter((x) => x !== c);
      // With nothing left to cite the sentence fails the Auditor for want of a citation, so the only claim a sentence cites is essential to it.
      const stands = rest.length > 0 && auditSentences([{ ...s, cites: rest }], ledger).rejected.length === 0;
      (stands ? mine.decorative : mine.essential).push(c);
    }
    essential += mine.essential.length;
    decorative += mine.decorative.length;
    out.push(mine);
  });
  const total = essential + decorative;
  return { sentences: out, essential, decorative, essentialShare: total === 0 ? null : essential / total };
}

/** One line for the answer: how many citations are needed, and which sentence cites a claim it does not need. */
export function describeFaithfulness(f: Faithfulness): string {
  if (f.essentialShare === null) return "no citation to test";
  const dec = f.sentences.filter((s) => s.decorative.length > 0).map((s) => `sentence ${s.index + 1} (${s.decorative.join(", ")})`);
  return `${f.essential} of ${f.essential + f.decorative} citations are needed by the sentence that makes them${dec.length > 0 ? `; decorative: ${dec.join("; ")}` : ""}`;
}
