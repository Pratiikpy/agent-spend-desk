import type { IntentRegistry } from "./registry.ts";
import { contentStems, fnv1a, ngrams, normalize, stem, tokenize } from "./text.ts";
import type { Band, DecideContext, Intent } from "./types.ts";

/**
 * The Sense stage (specification section 4). Two stages, one formula:
 *
 *   finalScore = 0.40 lexical + 0.35 semantic + 0.20 contextual + 0.05 recency - riskPenalty
 *
 * Stage 1 is a weighted trigger scan over the whole registry, pure rules, always available, and must finish a full scan in under 16 ms (checked by `selfTest`). Stage 2 adds
 * a semantic term and a contextual term. If Stage 2 is not run, Stage 1's result stands.
 *
 * Choices the specification leaves open, made here:
 *  - The weights are used as a dot product over the terms that are present: a term that has no input in this call (no conversation context, no session) is left out and the rest are
 *    re-scaled to sum to one, so that a Stage-1 result is a confidence in [0, 1] that the bands can be applied to, as the specification's "Stage 1's result stands" requires.
 *  - Lexical weights are tf-idf over the registry's examples, descriptions and ids, so that a word every intent uses counts for little. Unigram, bigram and trigram matches are
 *    counted once, by their longest match. A word in the prompt that no intent knows lowers the confidence in proportion, because a prompt largely about something the registry
 *    does not cover should not clear the High band on the one word it shares.
 *  - The semantic term is a deterministic embedding of character trigrams, hashed into a fixed-size vector and compared by cosine to the nearest example or description of each
 *    intent. It is not a trained model and is labelled as such wherever it is reported.
 */
export const CANONICAL_WEIGHTS = { lexical: 0.4, semantic: 0.35, contextual: 0.2, recency: 0.05 } as const;
export type Weights = { lexical: number; semantic: number; contextual: number; recency: number };

/**
 * The weights this implementation uses by default. The specification's 0.40 / 0.35 / 0.20 / 0.05 assume a trained embedding model behind the semantic term; the built-in
 * stand-in compares character trigrams, which is a weaker signal about meaning, so it carries less of the score (the specification says the weights are configuration, tunable
 * per surface). A deployment that plugs in a real embedder should pass CANONICAL_WEIGHTS. The choice was made on the dev split and is reported with the results.
 */
export const STAND_IN_WEIGHTS: Weights = { lexical: 0.55, semantic: 0.2, contextual: 0.2, recency: 0.05 };

/**
 * How much a single word of a general concept counts as evidence on its own. "all" or "file" appears in many requests and says little about which intent is meant; a word that
 * names the work ("compare", "schedule") says a lot. A phrase counts as much as its most specific word, so two general words together are still general.
 */
export const DEFAULT_CONCEPT_WEIGHT: Readonly<Record<string, number>> = { bulk: 0.45, entity: 0.5, status: 0.6, show: 0.5, pull: 0.55, find: 0.55, meeting: 0.5, report: 0.7, research: 0.7, announce: 0.8, email: 0.8 };

export const DEFAULT_BANDS: readonly Band[] = [
  { name: "high", min: 0.8 },
  { name: "medium", min: 0.55 },
  { name: "low", min: 0.4 },
  { name: "reject", min: 0 },
];

export function bandOf(score: number, bands: readonly Band[] = DEFAULT_BANDS): Band["name"] {
  for (const b of bands) if (score >= b.min) return b.name;
  return "reject";
}

/**
 * Words that mean the same thing in a request, grouped by the concept they stand for. Both the registry's examples and a prompt are folded through the same table before anything is
 * compared, so "stalled", "gone quiet" and "slipping" meet whichever of them an example used. The table is configuration, not code: it is general request vocabulary (what people
 * say when they ask to summarise, compare, send, schedule, update), not a list of this registry's words, and a deployment may replace it. Words that would mean different things in
 * different requests are left out rather than guessed.
 */
export const DEFAULT_CONCEPTS: Readonly<Record<string, readonly string[]>> = {
  show: ["show", "display", "list", "present", "view", "see"],
  pull: ["pull", "fetch", "retrieve", "get", "grab", "obtain"],
  find: ["find", "search", "locate", "lookup", "look", "identify", "spot", "discover", "pick"],
  summar: ["summarize", "summarise", "summary", "recap", "digest", "brief", "overview", "rundown", "gist", "highlight", "takeaway", "condense", "boil", "distill", "headline", "catch", "essentials"],
  plan: ["plan", "roadmap", "outline", "strategy", "programme", "program", "phased", "staged", "rollout", "blueprint", "timeline", "sketch", "map", "phases", "milestones", "quarters"],
  schedul: ["schedule", "book", "remind", "reminder", "calendar", "standup", "appointment", "block", "recurring"],
  draft: ["draft", "compose", "write", "prepare", "author", "phrase", "craft", "pen", "word"],
  email: ["email", "mail", "message", "reply", "nudge", "intro", "introduction", "followup", "inbox", "thread", "correspondence"],
  send: ["send", "dispatch", "ship", "deliver", "blast", "broadcast", "distribute", "publish"],
  bulk: ["all", "every", "entire", "whole", "everyone", "everybody", "each", "full", "everything"],
  announce: ["announcement", "newsletter", "notice", "notification", "greeting", "invitation", "apology", "bulletin", "invite", "broadcast"],
  compar: ["compare", "comparison", "contrast", "versus", "vs", "against", "evaluate", "weigh", "matrix", "stack", "better", "differences", "tradeoffs"],
  market: ["market", "landscape", "competitor", "rival", "competition", "competitive", "trend", "startup", "player", "emerging", "space", "segment", "industry", "sector", "vendor", "positioned", "positioning", "doing", "shipping"],
  research: ["research", "investigate", "study", "explore", "analyze", "analyse", "scan", "look"],
  stuck: ["stuck", "stalled", "stale", "slipping", "quiet", "cold", "dormant", "idle", "inactive", "languishing", "shaky", "risk", "risky", "sitting", "waiting"],
  recover: ["recover", "recovery", "rescue", "revive", "revival", "reengage", "winback", "wake", "restart", "unstick", "resurrect", "salvage", "reactivate"],
  deal: ["deal", "opportunity", "renewal", "pipeline", "negotiation", "negotiations", "prospect"],
  status: ["status", "stage", "stand", "standing", "progress", "where"],
  updat: ["update", "change", "modify", "edit", "set", "alter", "amend", "reassign", "move", "mark", "bump", "raise", "lower", "reduce", "increase", "close", "rename", "transfer"],
  entity: ["profile", "record", "file", "details", "info", "information", "stakeholder", "contact", "account", "customer", "client"],
  report: ["report", "deck", "document", "notes", "results", "figures", "numbers", "metrics", "kpi", "survey", "findings", "analysis", "minutes"],
  meeting: ["meeting", "call", "sync", "catchup", "session", "review", "demo", "workshop", "oneonone"],
};

/** The surface-word to concept table the scorer uses, from a concept list. Keys are stems, so a word and its inflections meet. */
export function conceptTable(concepts: Readonly<Record<string, readonly string[]>> = DEFAULT_CONCEPTS): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [concept, words] of Object.entries(concepts)) for (const w of words) if (out[stem(w.toLowerCase())] === undefined) out[stem(w.toLowerCase())] = concept;
  return out;
}

export const DEFAULT_SYNONYMS: Readonly<Record<string, string>> = conceptTable();

const apply = (stem: string, syn: Readonly<Record<string, string>>): string => syn[stem] ?? stem;

interface Gram {
  gram: string;
  n: number;
  start: number;
  end: number;
}

export interface Scan {
  /** Normalised prompt text the offsets refer to. */
  text: string;
  grams: Gram[];
  content: { stem: string; start: number; end: number }[];
  /** Per intent: the lexical score in [0, 1], and the span of the prompt the matched grams cover. */
  lexical: Map<string, { score: number; spanStart: number; spanEnd: number; matched: string[] }>;
  /** Content words no intent has any trigger for. */
  unmatched: number;
  matchedWeight: number;
  ms: number;
}

export interface ScoredCandidate {
  intent: string;
  score: number;
  lexical: number;
  semantic: number;
  contextual: number;
  recency: number;
  penalty: number;
  spanStart: number;
  spanEnd: number;
}

export interface ScorerOptions {
  weights?: Weights;
  bands?: readonly Band[];
  synonyms?: Readonly<Record<string, string>>;
  /** Down-rank intents that a request for a blocked action points at. Defaults to none. */
  riskPenalty?: (intent: Intent, prompt: string) => number;
  /** The weight, in units of one typical trigger word, that an unknown content word takes from the confidence. */
  unknownWordCost?: number;
  evidenceMass?: number;
  /** Per-concept scale for the weight of that concept's single words. */
  conceptWeight?: Readonly<Record<string, number>>;
  semanticFloor?: number;
  semanticCeil?: number;
}

const N_WEIGHT = [0, 1, 1.5, 2];
const DIM = 256;

function embedTrigrams(text: string): Float64Array {
  const v = new Float64Array(DIM);
  const padded = ` ${text} `;
  for (let i = 0; i + 3 <= padded.length; i += 1) {
    const h = fnv1a(padded.slice(i, i + 3));
    const sign = (h >>> 9) % 2 === 0 ? 1 : -1;
    v[h % DIM] = (v[h % DIM] as number) + sign;
  }
  let norm = 0;
  for (let i = 0; i < DIM; i += 1) norm += (v[i] as number) ** 2;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < DIM; i += 1) v[i] = (v[i] as number) / norm;
  return v;
}

const cosine = (a: Float64Array, b: Float64Array): number => {
  let d = 0;
  for (let i = 0; i < DIM; i += 1) d += (a[i] as number) * (b[i] as number);
  return d;
};

export class Scorer {
  readonly weights: Weights;
  readonly bands: readonly Band[];
  private readonly synonyms: Readonly<Record<string, string>>;
  private readonly conceptWeight: Readonly<Record<string, number>>;
  private readonly penalty: NonNullable<ScorerOptions["riskPenalty"]>;
  private readonly unknownCost: number;
  /** The weight of matched evidence at which an intent's lexical score is fully trusted; less than this is scaled down in proportion. */
  private readonly evidenceMass: number;
  private readonly semFloor: number;
  private readonly semCeil: number;
  /** gram -> intent id -> weight */
  private readonly index = new Map<string, Map<string, number>>();
  private readonly maxWeight = new Map<string, number>();
  /** Each intent's examples and description as embeddings: a prompt is compared to the nearest one. */
  private readonly prototypes = new Map<string, Float64Array[]>();
  private readonly known = new Set<string>();
  private readonly intents: readonly Intent[];

  constructor(readonly registry: IntentRegistry, opts: ScorerOptions = {}) {
    this.weights = opts.weights ?? STAND_IN_WEIGHTS;
    this.conceptWeight = opts.conceptWeight ?? DEFAULT_CONCEPT_WEIGHT;
    this.bands = opts.bands ?? DEFAULT_BANDS;
    this.synonyms = opts.synonyms ?? DEFAULT_SYNONYMS;
    this.penalty = opts.riskPenalty ?? (() => 0);
    this.unknownCost = opts.unknownWordCost ?? 0.2;
    this.evidenceMass = opts.evidenceMass ?? 2.5;
    this.semFloor = opts.semanticFloor ?? 0.25;
    this.semCeil = opts.semanticCeil ?? 0.85;
    this.intents = registry.intents;
    this.compile();
  }

  private stemsOf(text: string): { stem: string; start: number; end: number }[] {
    const t = normalize(text);
    return contentStems(tokenize(t)).map((c) => ({ ...c, stem: apply(c.stem, this.synonyms) }));
  }

  private compile(): void {
    const N = this.intents.length;
    // tf per intent per gram, from examples (1.0), the description (0.35), and the words of the id (0.8).
    const tf = new Map<string, Map<string, number>>();
    const bump = (id: string, text: string, weight: number): void => {
      const content = this.stemsOf(text);
      for (const g of ngrams(content)) {
        let per = tf.get(g.gram);
        if (!per) tf.set(g.gram, (per = new Map()));
        per.set(id, (per.get(id) ?? 0) + weight);
      }
    };
    for (const i of this.intents) {
      for (const e of i.examples) bump(i.id, e, 1);
      bump(i.id, i.description, 0.35);
      bump(i.id, i.id.replace(/[._-]/g, " "), 0.8);
    }
    for (const [gram, per] of tf) {
      const n = gram.split(" ").length;
      const idf = Math.log(1 + N / per.size);
      const row = new Map<string, number>();
      let best = 0;
      for (const [id, t] of per) {
        const w = (N_WEIGHT[n] as number) * idf * Math.min(1.5, 0.6 + 0.4 * t) * Math.max(...gram.split(" ").map((tok) => this.conceptWeight[tok] ?? 1));
        row.set(id, w);
        if (w > best) best = w;
      }
      this.index.set(gram, row);
      this.maxWeight.set(gram, best);
      if (n === 1) this.known.add(gram);
    }
    for (const i of this.intents) {
      const texts = [...i.examples, i.description];
      this.prototypes.set(i.id, texts.map((t) => embedTrigrams(this.stemsOf(t).map((s) => s.stem).join(" "))));
    }
  }

  /** Stage 1: the weighted trigger scan over the full registry. Pure rules. */
  scan(prompt: string): Scan {
    const t0 = performance.now();
    const text = normalize(prompt);
    const content = this.stemsOf(text);
    const grams = ngrams(content);
    // Longest matches first, claiming the words they cover, so that a trigram is not also counted as its bigrams and unigrams.
    const claimed = new Array<boolean>(content.length).fill(false);
    const maximal: { gram: string; from: number; to: number }[] = [];
    for (let n = 3; n >= 1; n -= 1) {
      for (let i = 0; i + n <= content.length; i += 1) {
        const gram = content.slice(i, i + n).map((c) => c.stem).join(" ");
        if (!this.index.has(gram)) continue;
        if (claimed.slice(i, i + n).some(Boolean)) continue;
        for (let k = i; k < i + n; k += 1) claimed[k] = true;
        maximal.push({ gram, from: i, to: i + n - 1 });
      }
    }
    let matchedWeight = 0;
    for (const m of maximal) matchedWeight += this.maxWeight.get(m.gram) as number;
    const unmatched = claimed.filter((c) => !c).length;
    const coverage = matchedWeight === 0 ? 0 : matchedWeight / (matchedWeight + this.unknownCost * unmatched);
    const lexical = new Map<string, { score: number; spanStart: number; spanEnd: number; matched: string[] }>();
    for (const i of this.intents) {
      let sum = 0;
      let spanStart = Infinity;
      let spanEnd = -Infinity;
      const matched: string[] = [];
      for (const m of maximal) {
        const w = this.index.get(m.gram)?.get(i.id);
        if (w === undefined) continue;
        sum += w;
        matched.push(m.gram);
        spanStart = Math.min(spanStart, (content[m.from] as { start: number }).start);
        spanEnd = Math.max(spanEnd, (content[m.to] as { end: number }).end);
      }
      lexical.set(i.id, { score: matchedWeight === 0 ? 0 : Math.min(1, (sum / matchedWeight) * coverage * Math.min(1, sum / this.evidenceMass)), spanStart: Number.isFinite(spanStart) ? spanStart : 0, spanEnd: Number.isFinite(spanEnd) ? spanEnd : 0, matched });
    }
    void grams;
    return { text, grams, content, lexical, unmatched, matchedWeight, ms: performance.now() - t0 };
  }

  /** Stage 2 and the merge: add the semantic and contextual terms to a scan and return every intent scored, best first. */
  rescore(prompt: string, scan: Scan, o: { stage2: boolean; context?: DecideContext | undefined; sessionRecents?: readonly string[] | undefined }): ScoredCandidate[] {
    const w = this.weights;
    const hasContext = o.context !== undefined && (o.context.activeWorkflow !== undefined || (o.context.recentIntents?.length ?? 0) > 0 || (o.context.memory?.length ?? 0) > 0);
    const hasSession = (o.sessionRecents?.length ?? 0) > 0;
    const q = o.stage2 ? embedTrigrams(scan.content.map((c) => c.stem).join(" ")) : null;
    const memStems = hasContext ? new Set((o.context?.memory ?? []).flatMap((m) => this.stemsOf(m).map((s) => s.stem))) : new Set<string>();
    const recents = [...(o.context?.recentIntents ?? []), ...(o.sessionRecents ?? [])];
    const out: ScoredCandidate[] = [];
    for (const i of this.intents) {
      const lex = scan.lexical.get(i.id) as { score: number; spanStart: number; spanEnd: number };
      const nearest = q ? Math.max(0, ...(this.prototypes.get(i.id) ?? []).map((p) => cosine(q, p))) : 0;
      const semantic = q ? Math.min(1, Math.max(0, (nearest - this.semFloor) / (this.semCeil - this.semFloor))) : 0;
      let contextual = 0;
      if (hasContext) {
        if (o.context?.activeWorkflow === i.id) contextual = 1;
        else {
          const k = (o.context?.recentIntents ?? []).indexOf(i.id);
          if (k >= 0) contextual = Math.max(contextual, 0.7 - 0.15 * k);
        }
        if (memStems.size > 0) {
          const mine = new Set(this.stemsOf([...i.examples, i.description].join(" ")).map((s) => s.stem));
          let shared = 0;
          for (const s of memStems) if (mine.has(s)) shared += 1;
          contextual = Math.max(contextual, Math.min(0.8, shared / Math.max(4, memStems.size)));
        }
      }
      const rk = recents.indexOf(i.id);
      const recency = hasSession || rk >= 0 ? (rk < 0 ? 0 : Math.max(0, 1 - 0.3 * rk)) : 0;
      // The terms present in this call, re-scaled to sum to one.
      let total = w.lexical;
      let sum = w.lexical * lex.score;
      if (o.stage2) {
        total += w.semantic;
        sum += w.semantic * semantic;
      }
      if (hasContext) {
        total += w.contextual;
        sum += w.contextual * contextual;
      }
      if (hasSession || hasContext) {
        total += w.recency;
        sum += w.recency * recency;
      }
      const penalty = this.penalty(i, prompt);
      out.push({ intent: i.id, score: Math.min(1, Math.max(0, sum / total - penalty)), lexical: lex.score, semantic, contextual, recency, penalty, spanStart: lex.spanStart, spanEnd: lex.spanEnd });
    }
    return out.sort((a, b) => b.score - a.score || a.intent.localeCompare(b.intent));
  }

  /**
   * The startup self-test: a full-registry scan over a fixed probe set must finish inside the budget, or Scout refuses to start. The probes are built from the registry's own examples
   * (a scan of a prompt the registry knows touches the most of the index), plus prompts it does not know. The median of repeated scans is judged, not the first, which pays for JIT warm-up.
   */
  selfTest(budgetMs = 16, repeats = 5): { ok: true; medianMs: number; probes: number } {
    const probes = [...this.intents.flatMap((i) => i.examples.slice(0, 2)), "hello there", "what is the weather like", "x ".repeat(200)].slice(0, 120);
    const times: number[] = [];
    for (let r = 0; r < repeats; r += 1) {
      const t0 = performance.now();
      for (const p of probes) this.scan(p);
      times.push((performance.now() - t0) / probes.length);
    }
    times.sort((a, b) => a - b);
    const medianMs = times[Math.floor(times.length / 2)] as number;
    if (medianMs > budgetMs) throw new Error(`Scout's Stage-1 scan took ${medianMs.toFixed(2)} ms over a ${this.intents.length}-intent registry, above the ${budgetMs} ms budget; it will not start`);
    return { ok: true, medianMs, probes: probes.length };
  }
}
