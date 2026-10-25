import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { decodeVector, dot, encodeVector, type Embedder } from "../embed/port.ts";

/**
 * Meaning for the owner's notes. The H-MEM engine ranks with its own deterministic hash embedder, and that is left as it is (the vendored files are not edited); what a real
 * embedder adds is a second reading of how close a note is to a question, kept beside the engine in a file of its own. A note's vector is made once, when the note first meets a
 * question, and kept: the file holds one int8-scaled vector per note, keyed by the note's id and a hash of its text, so an edited or replaced note is embedded again and a deleted
 * one leaves nothing behind.
 */
interface Stored {
  model: string;
  notes: Record<string, { hash: string; vector: string }>;
}

const slug = (model: string): string => model.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
const hashOf = (text: string): string => createHash("sha256").update(text.normalize("NFKC").trim()).digest("hex").slice(0, 16);

export class SemanticIndex {
  private readonly notes = new Map<string, { hash: string; vector: Float32Array }>();
  private readonly queries = new Map<string, Float32Array>();
  private readonly file: string | null;

  constructor(readonly embedder: Embedder, dir: string | null) {
    this.file = dir === null ? null : join(dir, `semantic-${slug(embedder.id)}.json`);
    if (this.file !== null && existsSync(this.file)) {
      try {
        const s = JSON.parse(readFileSync(this.file, "utf8")) as Stored;
        if (s.model === embedder.id) for (const [id, n] of Object.entries(s.notes)) this.notes.set(id, { hash: n.hash, vector: decodeVector(n.vector) });
      } catch {
        /* a damaged file is rebuilt as notes are asked about */
      }
    }
  }

  /**
   * Make sure the notes and the questions have vectors. Returns what went wrong, or null: a failure leaves the notes it could not embed without a vector, and a note without one
   * is read by words alone.
   */
  async prime(notes: readonly { id: string; content: string }[], queries: readonly string[], deadlineMs = 20_000): Promise<string | null> {
    try {
      const need = notes.filter((n) => this.notes.get(n.id)?.hash !== hashOf(n.content));
      if (need.length > 0) {
        const vs = await this.embedder.embed(need.map((n) => n.content), "passage", deadlineMs);
        need.forEach((n, i) => this.notes.set(n.id, { hash: hashOf(n.content), vector: vs[i] as Float32Array }));
        this.save(new Set(notes.map((n) => n.id)));
      }
      const unseen = [...new Set(queries)].filter((q) => !this.queries.has(q));
      if (unseen.length > 0) {
        const vs = await this.embedder.embed(unseen, "query", deadlineMs);
        unseen.forEach((q, i) => this.queries.set(q, vs[i] as Float32Array));
      }
      return null;
    } catch (e) {
      return e instanceof Error ? e.message.slice(0, 160) : "the embedder failed";
    }
  }

  /** The cosine of a question with a note, or null when either has no vector. */
  similarity(query: string, id: string, content: string): number | null {
    const n = this.notes.get(id);
    const q = this.queries.get(query);
    if (!n || !q || n.hash !== hashOf(content) || n.vector.length === 0 || q.length === 0) return null;
    return dot(q, n.vector);
  }

  private save(keep: ReadonlySet<string>): void {
    if (this.file === null) return;
    try {
      const out: Stored = { model: this.embedder.id, notes: {} };
      for (const [id, n] of [...this.notes].sort((a, b) => a[0].localeCompare(b[0]))) if (keep.has(id)) out.notes[id] = { hash: n.hash, vector: encodeVector(n.vector) };
      mkdirSync(join(this.file, ".."), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(out)}\n`);
      renameSync(tmp, this.file);
    } catch {
      /* the vectors are a cache of what the embedder said; losing the file costs another call, not a note */
    }
  }
}
