import { readFileSync } from "node:fs";

import { CassetteEmbedder, DEFAULT_EMBED_MODEL, type EmbedKind, type Embedder } from "../embed/port.ts";
import { evaluateRecall, RECALL_RECORD, recallRecord, type RecallScore } from "../engines/recall-eval.ts";

const CASSETTES = "data/sample/cassettes";
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`);
const wrongShare = (s: RecallScore): number => (s.wrongNotes.recalled === 0 ? 0 : s.wrongNotes.wrong / s.wrongNotes.recalled);

/**
 * The owner's notes found by meaning, from the repository. Recomputed from the recorded vectors and compared with the committed record byte for byte; on both splits the vectors
 * must find at least what words alone find, recall fewer notes that are not about the question, and recall no more for questions about nothing. Then two controls that must hold
 * when the embedder is worse than useless: one that always fails, and one that has no vector for the notes, must each give exactly what words alone give, and be reported as having
 * fallen back.
 */
export async function embedProve(): Promise<{ ok: boolean; detail: string }> {
  const emb = new CassetteEmbedder(CASSETTES, DEFAULT_EMBED_MODEL);
  const record = await recallRecord(emb);
  let committed: string;
  try {
    committed = readFileSync(RECALL_RECORD, "utf8").replace(/\r\n/g, "\n");
  } catch {
    return { ok: false, detail: `${RECALL_RECORD} is missing; run: npm run desk -- embed eval --write` };
  }
  if (committed !== `${JSON.stringify(record, null, 2)}\n`) return { ok: false, detail: `${RECALL_RECORD} no longer matches what the code produces; run: npm run desk -- embed eval --write, and read the difference before committing it` };
  for (const split of ["dev", "test"] as const) {
    const { words, vectors } = record[split];
    if (vectors.fellBack !== 0) return { ok: false, detail: `${vectors.fellBack} ${split} questions fell back to words: the recording lacks vectors for texts the question set uses; run: npm run desk -- embed record` };
    if (vectors.about.found < words.about.found) return { ok: false, detail: `on ${split} the vectors find a note for ${vectors.about.found} questions and words alone find ${words.about.found}` };
    if (!(wrongShare(vectors) < wrongShare(words))) return { ok: false, detail: `on ${split} the vectors do not recall a smaller share of notes that are not about the question (${pct(vectors.wrongNotes.wrong, vectors.wrongNotes.recalled)} against ${pct(words.wrongNotes.wrong, words.wrongNotes.recalled)})` };
    if (vectors.unrelated.recalledSomething > words.unrelated.recalledSomething) return { ok: false, detail: `on ${split} the vectors recall a note for more questions about nothing than words do` };
  }

  const down: Embedder = { id: "down/embedder", source: "live", embed: async (_t: readonly string[], _k: EmbedKind) => { throw new Error("injected failure"); } };
  const empty = new CassetteEmbedder("data/sample/no-such-cassettes", DEFAULT_EMBED_MODEL);
  for (const split of ["dev", "test"] as const) {
    const words = await evaluateRecall(split, null);
    for (const [name, e] of [["an embedder that fails", down], ["a recording with no vectors", empty]] as const) {
      const s = await evaluateRecall(split, e);
      const same = JSON.stringify({ ...s, embedder: null, fellBack: 0 }) === JSON.stringify({ ...words, fellBack: 0 });
      if (!same) return { ok: false, detail: `on ${split}, ${name} changed what is recalled instead of falling back to words` };
      if (s.fellBack !== s.questions) return { ok: false, detail: `on ${split}, ${name} fell back for ${s.fellBack} of ${s.questions} questions and did not report the rest` };
    }
  }

  const d = record.dev;
  const t = record.test;
  return {
    ok: true,
    detail: `the recall record is reproduced byte for byte; with ${record.model}'s recorded vectors the notes a question is about are found for ${d.vectors.about.found} of ${d.vectors.about.total} development questions against ${d.words.about.found} by words, and ${t.vectors.about.found} of ${t.vectors.about.total} test questions against ${t.words.about.found}; notes recalled that are not about the question fall from ${pct(d.words.wrongNotes.wrong, d.words.wrongNotes.recalled)} to ${pct(d.vectors.wrongNotes.wrong, d.vectors.wrongNotes.recalled)} (development) and ${pct(t.words.wrongNotes.wrong, t.words.wrongNotes.recalled)} to ${pct(t.vectors.wrongNotes.wrong, t.vectors.wrongNotes.recalled)} (test); a failing embedder and a recording with no vectors each give what words give, reported as a fall back`,
  };
}
