import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Embedder } from "../embed/port.ts";
import { OwnerMemory, type RecallTuning } from "./memory.ts";

/**
 * How well the owner's notes are found when a question is put to them, with and without an embedder. A set of notes, and questions that each say which notes they are about (or
 * none): the rate at which a question finds the note it is about, and the rate at which a question about nothing in the notes finds one anyway. Written by the people who built
 * the recall, so it shows that the two readings differ and where, not how often a real owner's phrasing is found.
 */
const DIR = "evals/memory";

export interface RecallCase {
  id: string;
  question: string;
  about: string[];
}

export interface RecallScore {
  split: "dev" | "test";
  questions: number;
  /** Questions about some note: how many found at least one note they are about, and how many found every note they are about. */
  about: { total: number; found: number; foundAll: number };
  /** Of the notes recalled for those questions, the share that were not about the question. */
  wrongNotes: { recalled: number; wrong: number };
  /** Questions about nothing in the notes: how many found a note anyway. */
  unrelated: { total: number; recalledSomething: number };
  /** The questions that did not find what they are about, for reading. */
  misses: { id: string; question: string; wanted: string[]; got: string[] }[];
  /** The embedder's id, or null for words alone. Recalls that fell back to words because the embedder failed are counted here. */
  embedder: string | null;
  fellBack: number;
}

export function loadRecallCases(split: "dev" | "test", dir = DIR): { notes: { id: string; content: string }[]; cases: RecallCase[] } {
  const notes = (JSON.parse(readFileSync(join(dir, "notes.json"), "utf8")) as { notes: { id: string; content: string }[] }).notes;
  const cases = readFileSync(join(dir, `${split}.jsonl`), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as RecallCase);
  return { notes, cases };
}

export async function evaluateRecall(split: "dev" | "test", embedder: Embedder | null, dir = DIR, tuning: RecallTuning = {}): Promise<RecallScore> {
  const { notes, cases } = loadRecallCases(split, dir);
  let t = Date.UTC(2026, 9, 20, 9, 0, 0);
  const memory = await OwnerMemory.open({ clock: () => (t += 60_000) });
  const idOf = new Map<string, string>();
  for (const n of notes) idOf.set(memory.remember({ kind: "note", content: n.content }).id, n.id);
  if (embedder) memory.attach(embedder, tuning);
  const score: RecallScore = { split, questions: cases.length, about: { total: 0, found: 0, foundAll: 0 }, wrongNotes: { recalled: 0, wrong: 0 }, unrelated: { total: 0, recalledSomething: 0 }, misses: [], embedder: embedder?.id ?? null, fellBack: 0 };
  for (const c of cases) {
    if (embedder) {
      await memory.prime([c.question]);
      if (memory.lastEmbedFailure !== null) score.fellBack += 1;
    }
    const got = memory.recall(c.question, 5).map((r) => idOf.get(r.id) ?? r.id);
    if (c.about.length === 0) {
      score.unrelated.total += 1;
      if (got.length > 0) {
        score.unrelated.recalledSomething += 1;
        score.misses.push({ id: c.id, question: c.question, wanted: [], got });
      }
      continue;
    }
    score.about.total += 1;
    const hit = c.about.filter((w) => got.includes(w));
    if (hit.length > 0) score.about.found += 1;
    if (hit.length === c.about.length) score.about.foundAll += 1;
    else score.misses.push({ id: c.id, question: c.question, wanted: c.about, got });
    score.wrongNotes.recalled += got.length;
    score.wrongNotes.wrong += got.filter((g) => !c.about.includes(g)).length;
  }
  return score;
}

export const RECALL_RECORD = "docs/verification/embed/recall.json";

/** What is written to the repository: both splits, by words alone and with the recorded vectors, so a later run can be compared with it byte for byte. */
export interface RecallRecord {
  version: 1;
  model: string;
  notes: number;
  dev: { words: RecallScore; vectors: RecallScore };
  test: { words: RecallScore; vectors: RecallScore };
}

export async function recallRecord(embedder: Embedder, dir = DIR): Promise<RecallRecord> {
  const notes = loadRecallCases("dev", dir).notes.length;
  return {
    version: 1,
    model: embedder.id,
    notes,
    dev: { words: await evaluateRecall("dev", null, dir), vectors: await evaluateRecall("dev", embedder, dir) },
    test: { words: await evaluateRecall("test", null, dir), vectors: await evaluateRecall("test", embedder, dir) },
  };
}

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`);

export function renderRecall(scores: readonly RecallScore[]): string {
  const out: string[] = [];
  for (const s of scores) {
    out.push(`${s.split} (${s.questions} questions, ${s.embedder ?? "words alone"}${s.fellBack > 0 ? `, ${s.fellBack} fell back to words` : ""})`);
    out.push(`  finds a note it is about: ${s.about.found} of ${s.about.total} (${pct(s.about.found, s.about.total)}); finds every note it is about: ${s.about.foundAll} of ${s.about.total} (${pct(s.about.foundAll, s.about.total)})`);
    out.push(`  of ${s.wrongNotes.recalled} notes recalled for those questions, ${s.wrongNotes.wrong} were not about the question (${pct(s.wrongNotes.wrong, s.wrongNotes.recalled)})`);
    out.push(`  questions about nothing in the notes that found a note anyway: ${s.unrelated.recalledSomething} of ${s.unrelated.total}`);
  }
  return out.join("\n");
}
