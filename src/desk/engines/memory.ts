import { loadEngineModule, type HmemLike, type HmemRecord } from "./load.ts";
import { sanitizeLabel } from "./label.ts";
import type { LandingState } from "../outcomes/attribute.ts";

/**
 * The Desk's use of the Meterless H-MEM engine: the owner's own words (what counts as work that landed, a
 * correction, a note) stored with a source, a confidence and supersession, and read back when a question
 * depends on them. A definition the owner replaced is kept and penalised, never deleted, so the earlier
 * answer can still be explained.
 */
export const OUTCOME_TAG = "desk:outcome_definition";
export const NOTE_TAG = "desk:note";
export const OWNER = "owner";

/** Without a memory, a session's work counts as landed when it was merged or kept. */
export const DEFAULT_LANDED: readonly LandingState[] = ["merged", "kept"];

export type DefinitionSource = "default" | "memory" | "conflict";

export interface OutcomeDefinition {
  landed: readonly LandingState[];
  source: DefinitionSource;
  /** The memory the definition came from (source "memory"), or the ones in disagreement (source "conflict"). */
  memoryIds: string[];
  learnedAt: string | null;
  /** Live definitions that could not be read, so the owner can be told they were ignored. */
  unreadable: string[];
}

export interface RememberInput {
  kind: "outcome_definition" | "note";
  content: string;
  /** The memory this one replaces. The older record is kept and marked superseded. */
  supersedes?: string;
}

export interface Recalled {
  id: string;
  learnedAt: string;
  kind: "outcome_definition" | "note" | "other";
  content: string;
  relevance: number;
  superseded: boolean;
}

const MAX_MEMORY_CHARS = 500;

/**
 * Reads a plain-language definition of "landed". The strictest state the owner names wins: a note that
 * says kept means kept only; one that says merged means merged or kept; one that says committed means any
 * of the three. A note that names none of them cannot be read and is reported, not guessed at.
 */
export function parseLandedStates(content: string): LandingState[] | null {
  const t = content.toLowerCase();
  const mentions = (w: string): boolean => new RegExp(`\\b${w}\\b`).test(t);
  if (mentions("committed") || mentions("commit")) return ["committed", "merged", "kept"];
  if (mentions("merged") || mentions("merge")) return ["merged", "kept"];
  if (mentions("kept")) return ["kept"];
  return null;
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export class OwnerMemory {
  private constructor(
    private readonly hmem: HmemLike,
    private readonly clock: () => number,
  ) {}

  static async open(opts: { persistDir?: string; clock?: () => number } = {}): Promise<OwnerMemory> {
    const mod = await loadEngineModule("hmem");
    const Ctor = mod["HMEM"] as new (o: { clock?: () => number; persistDir?: string; actor?: string }) => HmemLike;
    const clock = opts.clock ?? Date.now;
    return new OwnerMemory(new Ctor({ clock, actor: OWNER, ...(opts.persistDir ? { persistDir: opts.persistDir } : {}) }), clock);
  }

  remember(input: RememberInput): HmemRecord {
    const content = input.content.replace(/\s+/g, " ").trim();
    if (content === "") throw new RangeError("a memory needs some text");
    if (content.length > MAX_MEMORY_CHARS) throw new RangeError(`a memory is at most ${MAX_MEMORY_CHARS} characters`);
    if (input.supersedes !== undefined && !this.hmem.store.get(input.supersedes)) throw new RangeError(`no memory ${sanitizeLabel(input.supersedes)} to replace`);
    if (input.kind === "outcome_definition" && parseLandedStates(content) === null) {
      throw new RangeError("an outcome definition must say which stage counts as landed: committed, merged or kept");
    }
    const now = this.clock();
    const record = this.hmem.store.add({
      content,
      type: "preference",
      layer: "long_term",
      tags: [input.kind === "outcome_definition" ? OUTCOME_TAG : NOTE_TAG],
      confidence: 0.9,
      source: OWNER,
      ...(input.supersedes ? { supersedes: input.supersedes } : {}),
      provenance: { origin: "user_correction", learnedAt: now, label: OWNER },
    });
    if (input.supersedes) this.hmem.store.update(input.supersedes, { supersededBy: record.id });
    // The engine's own conflict pass; it settles a pair only when it is at least 0.70 sure and queues the rest.
    for (const c of this.hmem.conflicts.scan()) this.hmem.conflicts.autoResolve(c);
    return record;
  }

  /** The definition of "landed" in force. Conflicting live definitions are not guessed between. */
  outcomeDefinition(): OutcomeDefinition {
    const live = this.hmem.store.all().filter((m) => m.tags.includes(OUTCOME_TAG) && !m.supersededBy);
    const readable: { rec: HmemRecord; states: LandingState[] }[] = [];
    const unreadable: string[] = [];
    for (const rec of live) {
      const states = parseLandedStates(rec.content);
      if (states) readable.push({ rec, states });
      else unreadable.push(rec.id);
    }
    if (readable.length === 0) return { landed: DEFAULT_LANDED, source: "default", memoryIds: [], learnedAt: null, unreadable };
    const first = readable[0] as { rec: HmemRecord; states: LandingState[] };
    if (readable.every((r) => same(r.states, first.states))) {
      const newest = readable.reduce((a, b) => (b.rec.timestamp > a.rec.timestamp ? b : a));
      return { landed: first.states, source: "memory", memoryIds: [newest.rec.id], learnedAt: new Date(newest.rec.timestamp).toISOString().slice(0, 10), unreadable };
    }
    return { landed: DEFAULT_LANDED, source: "conflict", memoryIds: readable.map((r) => r.rec.id), learnedAt: null, unreadable };
  }

  /** Ranked recall by the engine's hybrid score. Superseded notes can come back, marked as such. */
  recall(query: string, topN = 5): Recalled[] {
    const r = this.hmem.query(query, { topN });
    return r.memories.map(({ memory, relevance }) => ({
      id: memory.id,
      learnedAt: new Date(memory.timestamp).toISOString().slice(0, 10),
      kind: memory.tags.includes(OUTCOME_TAG) ? "outcome_definition" : memory.tags.includes(NOTE_TAG) ? "note" : "other",
      content: memory.content,
      relevance: Math.round(relevance * 1000) / 1000,
      superseded: memory.supersededBy !== undefined,
    }));
  }

  all(): { id: string; kind: string; superseded: boolean; content: string; learnedAt: string }[] {
    return this.hmem.store.all().map((m) => ({
      id: m.id,
      kind: m.tags.includes(OUTCOME_TAG) ? "outcome_definition" : "note",
      superseded: m.supersededBy !== undefined,
      content: m.content,
      learnedAt: new Date(m.timestamp).toISOString().slice(0, 10),
    }));
  }

  /** A hash input that changes when the memory changes, for recording what an answer rested on. */
  fingerprint(): string {
    return this.hmem.store
      .all()
      .map((m) => `${m.id}:${m.supersededBy ?? ""}:${m.content}`)
      .join("|");
  }
}
