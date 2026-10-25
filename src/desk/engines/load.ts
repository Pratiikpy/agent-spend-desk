/**
 * The Meterless engines live in src/engines/ and are compiled under their own tsconfig (their code is
 * Meterless's reference, unchanged). Importing them statically would pull their files into the Desk's
 * stricter type check, so they are loaded at run time through a path built here and typed by the small
 * structural interfaces below. Only the parts the Desk calls are described.
 */
export type EngineName = "world_model" | "markovian" | "hmem";
export const ENGINE_NAMES: readonly EngineName[] = ["world_model", "markovian", "hmem"];

const FOLDER: Record<EngineName, string> = { world_model: "world-model", markovian: "markovian", hmem: "hmem" };

const cache = new Map<EngineName, Record<string, unknown>>();

export async function loadEngineModule(name: EngineName): Promise<Record<string, unknown>> {
  const hit = cache.get(name);
  if (hit) return hit;
  const specifier = ["..", "..", "engines", FOLDER[name], "index.ts"].join("/");
  const mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
  cache.set(name, mod);
  return mod;
}

export interface WmProvenance {
  kind: string;
  by?: string;
  at: string;
}

export interface WmEntity {
  id: string;
  type: string;
  name?: string;
  attrs: Record<string, unknown>;
  createdAt: string;
}

export interface WmFact {
  id: string;
  about: string;
  predicate: string;
  value: unknown;
  assertedAt: string;
}

export interface WmEvent {
  id: string;
  seq: number;
  kind: string;
  at: string;
  payload: unknown;
}

export interface WorldModelLike {
  upsertEntity(input: { type: string; name?: string; externalKey?: { system: string; id: string }; attrs?: Record<string, unknown>; source: WmProvenance }): Promise<WmEntity>;
  assertFact(input: { about: string; predicate: string; value: unknown; confidence?: number; source: WmProvenance }): Promise<WmFact>;
  events(): readonly WmEvent[];
  view(name: string): unknown;
}

export interface WmFactsView {
  about(id: string): WmFact[];
}
export interface WmGraphView {
  entity(id: string): WmEntity | undefined;
  query(opts: { type?: string }): WmEntity[];
}
export interface WmSnapshotView {
  entityAt(id: string, at: string): WmEntity | undefined;
}

export interface HmemRecord {
  id: string;
  content: string;
  tags: string[];
  confidence: number;
  source: string;
  timestamp: number;
  supersedes?: string;
  supersededBy?: string;
  provenance: { origin: string; learnedAt: number; label: string };
}

export interface HmemLike {
  store: {
    add(input: { content: string; type?: string; layer?: string; tags?: string[]; confidence?: number; source: string; supersedes?: string; provenance?: { origin: string; learnedAt: number; label: string } }): HmemRecord;
    all(): HmemRecord[];
    get(id: string): HmemRecord | undefined;
    update(id: string, patch: Partial<HmemRecord>): HmemRecord;
    snapshotAll(): { records: HmemRecord[]; seq: number };
    restoreAll(records: HmemRecord[], seq: number): void;
  };
  query(query: string, opts?: { topN?: number; threshold?: number }): { memories: { memory: HmemRecord; relevance: number }[]; context: string; trace: { retrievalReason: string; strategy: string; scores: Record<string, number> } };
  conflicts: {
    scan(): { id: string; memoryA: string; memoryB: string; reason: string; confidence: number; resolved: boolean }[];
    autoResolve(c: { id: string; memoryA: string; memoryB: string; reason: string; confidence: number; resolved: boolean }): "resolved" | "queued";
  };
  /** A memory that helped, did not, or was wrong moves its confidence by the engine's fixed steps (+0.05, -0.03, -0.2). */
  feedback(memoryId: string, kind: "helpful" | "not_helpful" | "wrong"): void;
  /** Durable statements taken from something the owner said or did. Without a generator this is the engine's model-free path. */
  mine(event: "chat_message" | "user_correction" | "file_save" | "file_open" | "file_edit" | "model_response" | "plan_completion", text: string): Promise<HmemRecord[]>;
  sleep: {
    preview(): { toConsolidate: string[]; toArchive: string[]; toSynthesize: string[][] };
    execute(preview?: { toConsolidate: string[]; toArchive: string[]; toSynthesize: string[][] }): { backupId: string; consolidated: number; archived: number; synthesized: number; actionLog: string[] };
    restore(backupId: string): void;
  };
  ledger: { history(memoryId: string): { action: string; actor: string; timestamp: number; details?: Record<string, unknown> }[] };
}

export interface MarkovianRunLike {
  status: string;
  chunks: { id: number; tokens: number; carryover: string; content: string }[];
  output: string;
  totalTokensUsed: number;
  totalTokensSaved: number;
  efficiencyPercent: number;
  chunkConfig: { chunkSize: number; maxChunks: number; carryoverTokens: number; overlapTokens: number };
  error?: string;
}

export interface MarkovianLike {
  config: { chunkSize: number; maxChunks: number; carryoverTokens: number; overlapTokens: number };
  run(options: { goal: string; mode?: string; reflect?: boolean; stepFn: (args: { goal: string; carryover: string; step: number; prompt: string }) => Promise<{ content: string }> | { content: string } }): Promise<MarkovianRunLike>;
}
