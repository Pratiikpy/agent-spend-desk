import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadEngineModule, type HmemLike, type HmemRecord } from "./load.ts";
import { sanitizeLabel } from "./label.ts";
import { authorRulesFrom, type AuthorRules } from "../outcomes/author-rules.ts";
import type { LandingState } from "../outcomes/attribute.ts";

/**
 * The Desk's use of the Meterless H-MEM engine: the owner's own words (what counts as work that landed, a
 * correction, a note) stored with a source, a confidence and supersession, and read back when a question
 * depends on them. A definition the owner replaced is kept and penalised, never deleted, so the earlier
 * answer can still be explained.
 */
export const OUTCOME_TAG = "desk:outcome_definition";
export const NOTE_TAG = "desk:note";
export const PRECEDENT_TAG = "desk:precedent";
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
    private readonly dir: string | null = null,
  ) {}

  /** `miner` is the generator the engine uses to take memories out of text; without one it reads text by its model-free rule. */
  static async open(opts: { persistDir?: string; clock?: () => number; miner?: (prompt: string) => Promise<string> } = {}): Promise<OwnerMemory> {
    const mod = await loadEngineModule("hmem");
    const Ctor = mod["HMEM"] as new (o: { clock?: () => number; persistDir?: string; actor?: string; minerFn?: (prompt: string) => Promise<string> }) => HmemLike;
    const clock = opts.clock ?? Date.now;
    return new OwnerMemory(new Ctor({ clock, actor: OWNER, ...(opts.persistDir ? { persistDir: opts.persistDir } : {}), ...(opts.miner ? { minerFn: opts.miner } : {}) }), clock, opts.persistDir ?? null);
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

  /**
   * The owner says whether a memory helped. The engine moves its confidence by a fixed step (+0.05 helpful, -0.03 not helpful, -0.2 wrong), which changes how it ranks the next time
   * it is recalled; the change is in the engine's trust ledger with who made it.
   */
  feedback(id: string, kind: "helpful" | "not_helpful" | "wrong"): { before: number; after: number } {
    const rec = this.hmem.store.get(id);
    if (!rec) throw new RangeError(`no memory ${sanitizeLabel(id)}`);
    const before = rec.confidence;
    this.hmem.feedback(id, kind);
    return { before, after: this.hmem.store.get(id)?.confidence ?? before };
  }

  /**
   * Durable statements taken from something the owner said, as memories of the kind `note`. Without a generator this is the engine's model-free path: a sentence of 20 to 300
   * characters that says what is preferred, decided or must hold. Each is a short-term memory until sleep consolidates it.
   */
  async mine(text: string, event: "user_correction" | "chat_message" = "user_correction"): Promise<HmemRecord[]> {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean === "") throw new RangeError("there is nothing to mine");
    if (clean.length > 8_000) throw new RangeError("mine at most 8000 characters at a time");
    const made = await this.hmem.mine(event, clean);
    for (const m of made) this.hmem.store.update(m.id, { tags: [...m.tags, NOTE_TAG], source: OWNER });
    for (const c of this.hmem.conflicts.scan()) this.hmem.conflicts.autoResolve(c);
    return made;
  }

  /**
   * What the sleep cycle would do now, held to what the Desk may let it do. The engine would archive or fold together any memory that is old and rarely recalled, and that includes the
   * owner's own words, a definition of what landed, and the record of a policy change they approved. None of those is the engine's to delete: only statements it mined itself can be
   * archived or folded into one, and everything short-term can be consolidated into long-term, which loses nothing. Changes nothing.
   */
  sleepPreview(): { toConsolidate: string[]; toArchive: string[]; toSynthesize: string[][]; kept: number } {
    const plan = this.hmem.sleep.preview();
    const mined = new Set(this.hmem.store.all().filter((m) => m.tags.some((t) => t.startsWith("event:")) && !m.tags.includes(PRECEDENT_TAG) && !m.tags.includes(OUTCOME_TAG)).map((m) => m.id));
    const toArchive = plan.toArchive.filter((id) => mined.has(id));
    const toSynthesize = plan.toSynthesize.filter((g) => g.every((id) => mined.has(id)));
    const kept = plan.toArchive.length - toArchive.length + plan.toSynthesize.reduce((n, g) => n + g.length, 0) - toSynthesize.reduce((n, g) => n + g.length, 0);
    return { toConsolidate: plan.toConsolidate, toArchive, toSynthesize, kept };
  }

  /**
   * Run the sleep cycle on that plan. The whole memory is written to a backup file first, so that `restore` works from another run of the program (the engine's own backup lives only
   * in the process that made it). Returns the backup's id.
   */
  sleep(): { backupId: string; consolidated: number; archived: number; synthesized: number; actionLog: string[] } {
    if (this.dir === null) throw new RangeError("this memory is not kept on disk, so a backup cannot be written");
    const plan = this.sleepPreview();
    const backupId = `sleep-${new Date(this.clock()).toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;
    mkdirSync(join(this.dir, "backups"), { recursive: true });
    writeFileSync(join(this.dir, "backups", `${backupId}.json`), JSON.stringify(this.hmem.store.snapshotAll()), { flag: "wx" });
    const r = this.hmem.sleep.execute({ toConsolidate: plan.toConsolidate, toArchive: plan.toArchive, toSynthesize: plan.toSynthesize });
    return { ...r, backupId };
  }

  restore(backupId: string): void {
    if (this.dir === null) throw new RangeError("this memory is not kept on disk");
    if (!/^sleep-\d{8}T\d{6}$/.test(backupId)) throw new RangeError(`${sanitizeLabel(backupId)} is not a backup id (they look like sleep-20261025T093000)`);
    const file = join(this.dir, "backups", `${backupId}.json`);
    if (!existsSync(file)) throw new RangeError(`no backup ${backupId} in ${this.dir}`);
    const snap = JSON.parse(readFileSync(file, "utf8")) as { records: HmemRecord[]; seq: number };
    this.hmem.store.restoreAll(snap.records, snap.seq);
  }

  /** One memory with its confidence and the trust ledger's record of how it came to be. */
  show(id: string): { id: string; content: string; confidence: number; tags: string[]; superseded: boolean; supersedes: string | null; history: { action: string; actor: string; at: string }[] } | null {
    const m = this.hmem.store.get(id);
    if (!m) return null;
    return {
      id: m.id, content: m.content, confidence: Math.round(m.confidence * 1000) / 1000, tags: m.tags, superseded: m.supersededBy !== undefined, supersedes: m.supersedes ?? null,
      history: this.hmem.ledger.history(id).map((h) => ({ action: h.action, actor: h.actor, at: new Date(h.timestamp).toISOString() })),
    };
  }

  /** A precedent: a policy change the owner approved, with what it was expected to do, stored so that a later proposal can cite it. An earlier precedent on the same rule is superseded, not deleted. */
  addPrecedent(input: { content: string; ruleIds: readonly string[]; decisionId: string; supersedes?: string; at?: number }): HmemRecord {
    const content = input.content.replace(/\s+/g, " ").trim();
    if (content === "") throw new RangeError("a precedent needs some text");
    if (input.supersedes !== undefined && !this.hmem.store.get(input.supersedes)) throw new RangeError(`no memory ${sanitizeLabel(input.supersedes)} to supersede`);
    const now = input.at ?? this.clock();
    const record = this.hmem.store.add({
      content,
      type: "factual",
      layer: "long_term",
      tags: [PRECEDENT_TAG, `desk:decision:${input.decisionId}`, ...input.ruleIds.map((r) => `desk:rule:${r}`)],
      confidence: 0.8,
      source: OWNER,
      ...(input.supersedes ? { supersedes: input.supersedes } : {}),
      provenance: { origin: "plan_completion", learnedAt: now, label: `decision ${input.decisionId}` },
    });
    if (input.supersedes) this.hmem.store.update(input.supersedes, { supersededBy: record.id });
    return record;
  }

  /** Memories of a kind, ranked for a query by the engine's hybrid score; the threshold is on the final score, after the confidence multiplier. */
  recallTagged(tag: string, query: string, topN = 3, threshold = 0.35): { id: string; content: string; relevance: number; superseded: boolean; confidence: number; tags: string[]; learnedAt: string }[] {
    const r = this.hmem.query(query, { topN: 25, threshold });
    return r.memories
      .filter(({ memory }) => memory.tags.includes(tag))
      .slice(0, topN)
      .map(({ memory, relevance }) => ({ id: memory.id, content: memory.content, relevance: Math.round(relevance * 1000) / 1000, superseded: memory.supersededBy !== undefined, confidence: memory.confidence, tags: memory.tags, learnedAt: new Date(memory.timestamp).toISOString().slice(0, 10) }));
  }

  byTag(tag: string): HmemRecord[] {
    return this.hmem.store.all().filter((m) => m.tags.includes(tag));
  }

  /** What the owner has said about who made commits, from live notes (DF-116). A note a newer one replaced is not read; two live notes that disagree are listed, not applied. */
  authorRules(): AuthorRules {
    return authorRulesFrom(this.hmem.store.all().filter((m) => m.tags.includes(NOTE_TAG) && !m.supersededBy).map((m) => ({ id: m.id, content: m.content })));
  }

  /** A hash input that changes when the memory changes, for recording what an answer rested on. */
  fingerprint(): string {
    return this.hmem.store
      .all()
      .map((m) => `${m.id}:${m.supersededBy ?? ""}:${m.content}`)
      .join("|");
  }
}
