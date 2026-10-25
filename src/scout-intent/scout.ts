import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonical, HmacSigner, signContract, UlidFactory, verifyContract, type Signer, type VerifyOptions, type VerifyResult } from "./contract.ts";
import { CapabilityGraph, defaultGraph, type ResolveContext } from "./graph.ts";
import { Guard, type PolicyPack } from "./guard.ts";
import { interpret, type Interpretation } from "./interpret.ts";
import { DEFAULT_PROFILES, ModelRouter, dataClassOf } from "./models.ts";
import { IntentRegistry } from "./registry.ts";
import { bandOf, CANONICAL_WEIGHTS, DEFAULT_BANDS, Scorer, type EmbeddedSimilarity, type ScoredCandidate, type ScorerOptions, type Weights } from "./scoring.ts";
import { contentStems, normalize, tokenize } from "./text.ts";
import type {
  ApprovalRecord, Band, Clarification, DecideInput, Decision, ExecutionContract, Intent, IntentCandidate, ModelProfile, Redaction, Risk, RiskFlag, TelemetryEvent, TelemetrySink, ToolStep, UserRef,
} from "./types.ts";

/**
 * Scout: the decision that runs before an action (specification sections 2 to 9). `decide` runs Sense, Interpret, Guard, Route and Recommend in order and ends in a signed
 * contract, or in a block, a clarification, or a typed reason that no plan could be made. Scout does not execute anything: it decides, guards, routes and signs.
 *
 * Nothing is signed that must not be acted on. A block, a Low-band or ambiguous reading, a missing required parameter, and a plan with a missing tool produce no contract. A
 * high-risk intent produces one that carries no approval, which an executor refuses until one is recorded (`approve` issues the contract again with it).
 */
export interface ScoutOptions {
  intentRegistry: string | IntentRegistry;
  policyPack?: string | readonly string[] | PolicyPack;
  modelProfiles?: string | readonly ModelProfile[];
  capabilities?: CapabilityGraph;
  signer?: Signer;
  secret?: string | Buffer;
  /** Contract lifetime. The specification's default is five minutes and it is never extended. */
  ttlMs?: number;
  clock?: () => number;
  telemetry?: TelemetrySink;
  /** Run Stage 2 (the semantic and contextual terms). On by default; Stage 1 stands alone when off. */
  stage2?: boolean;
  bands?: readonly Band[];
  weights?: Weights;
  synonyms?: Readonly<Record<string, string>>;
  scorer?: Pick<ScorerOptions, "unknownWordCost" | "semanticFloor" | "semanticCeil" | "riskPenalty" | "conceptWeight">;
  /** Turn a name in a prompt into a stable id, where the surface has a directory of them. */
  resolveEntity?: (name: string) => string | undefined;
  /** The permissions a user holds, for tools that require them. The default grants all. */
  permissionsOf?: (user: UserRef) => ReadonlySet<string>;
  routing?: "local-first" | "cloud-first";
  /** Run the Stage-1 startup self-test (on by default). */
  selfTest?: boolean;
  injectionModel?: (text: string) => number;
  /** Prompts longer than this are cut before scoring, and the cut is flagged. */
  maxPromptChars?: number;
  /**
   * A text embedder for the second stage's semantic term, in place of the built-in character-trigram comparison. It is asked for the registry's examples once, as passages, and for each
   * prompt as a query. If it fails, the decision is made with the built-in comparison and says so (`stage2: "degraded"`); a failing embedder never blocks a decision.
   */
  embedder?: TextEmbedder;
  /** Merge weights with a real embedder; the specification's by default, which assume a trained model. */
  embeddedWeights?: Weights;
  /** The cosines that map to 0 and to 1 for the semantic term with a real embedder. */
  embeddedFloor?: number;
  embeddedCeil?: number;
  /** How long one prompt may wait for the embedder. */
  embedDeadlineMs?: number;
  /** Keep what each user did last, for the recency term and the continuity check. On by default; a surface whose requests are independent of one another turns it off so that a decision does not depend on the ones before it. */
  sessionMemory?: boolean;
}

const MAX_SESSIONS = 10_000;
const RETRY_EMBEDDER_AFTER_MS = 30_000;
/**
 * The cosines that map to 0 and to 1 for the semantic term. Chosen on the development paraphrases for the default model (nvidia/nemotron-3-embed-1b, whose cosines between a request
 * and the nearest example of its own intent are about 0.3 to 0.5, and between unrelated ones 0.1 to 0.2); another model needs its own range, which `embeddedFloor` and
 * `embeddedCeil` set. The specification's merge weights are kept.
 */
const EMBEDDED_FLOOR = 0.1;
const EMBEDDED_CEIL = 0.35;

/** What Scout needs of an embedder: vectors for texts, unit length, in the order given. The Desk's embedder port has exactly this shape. */
export interface TextEmbedder {
  readonly id: string;
  embed(texts: readonly string[], kind: "query" | "passage", deadlineMs?: number): Promise<ArrayLike<number>[]>;
}

const SEGMENT = /\s*(?:[;,]|\band then\b|\bthen\b|\band also\b|\bplus\b|\bafter that\b|\band\b)\s*/i;
const CONFIDENCE_FOR_HIGH_RISK = 0.95;
const TIE_WINDOW = 0.05;

const labelOf = (i: Intent): string => (i.description.split(/\s[—-]\s|\.\s|\.$/)[0] ?? i.description).trim().replace(/^./, (c) => c.toLowerCase()).slice(0, 90);

export class Scout {
  readonly registry: IntentRegistry;
  readonly capabilities: CapabilityGraph;
  readonly policyPackVersion: string;
  readonly bands: readonly Band[];
  private readonly scorer: Scorer;
  private readonly guard: Guard;
  private readonly router: ModelRouter;
  private readonly signer: Signer;
  private readonly ulid: UlidFactory;
  private readonly clock: () => number;
  private readonly ttlMs: number;
  private readonly stage2: boolean;
  private readonly sink: TelemetrySink | undefined;
  private readonly opts: ScoutOptions;
  private readonly sessions = new Map<string, string[]>();
  private readonly remember: boolean;
  private protoVectors: { at: number; value: Promise<Map<string, ArrayLike<number>[]> | null> } | null = null;
  private lastEmbedFailure: string | null = null;
  private readonly issued = new Map<string, ExecutionContract>();
  private readonly log: TelemetryEvent[] = [];
  readonly startup: { medianMs: number; probes: number } | null;

  constructor(options: ScoutOptions) {
    this.opts = options;
    this.remember = options.sessionMemory ?? true;
    this.registry = typeof options.intentRegistry === "string" ? IntentRegistry.fromFile(options.intentRegistry) : options.intentRegistry;
    this.clock = options.clock ?? (() => Date.now());
    this.capabilities = options.capabilities ?? defaultGraph();
    this.guard = new Guard(options.policyPack, this.clock, options.injectionModel);
    this.policyPackVersion = this.guard.version;
    const profiles = typeof options.modelProfiles === "string" ? (JSON.parse(readFileSync(options.modelProfiles, "utf8")) as { profiles?: ModelProfile[] } | ModelProfile[]) : options.modelProfiles;
    this.router = new ModelRouter(Array.isArray(profiles) ? profiles : profiles && "profiles" in (profiles as object) ? ((profiles as { profiles: ModelProfile[] }).profiles) : DEFAULT_PROFILES);
    this.signer = options.signer ?? new HmacSigner(options.secret ?? randomBytes(32));
    this.ulid = new UlidFactory(this.clock);
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.stage2 = options.stage2 ?? true;
    this.bands = options.bands ?? DEFAULT_BANDS;
    this.sink = options.telemetry;
    this.scorer = new Scorer(this.registry, { ...(options.weights ? { weights: options.weights } : {}), bands: this.bands, ...(options.synonyms ? { synonyms: options.synonyms } : {}), ...(options.scorer ?? {}) });
    this.startup = options.selfTest === false ? null : (({ medianMs, probes }) => ({ medianMs, probes }))(this.scorer.selfTest());
  }

  private emit(event: TelemetryEvent["event"], traceId: string, detail: Record<string, unknown>): void {
    const e: TelemetryEvent = { event, traceId, at: new Date(this.clock()).toISOString(), detail };
    this.log.push(e);
    if (this.log.length > 5000) this.log.shift();
    this.sink?.(e);
  }

  /** The events Scout has emitted, newest last. A decision can be reconstructed from its trace id. */
  events(traceId?: string): readonly TelemetryEvent[] {
    return traceId === undefined ? this.log : this.log.filter((e) => e.traceId === traceId);
  }

  /** The Sense stage alone. */
  async classify(input: { prompt: string; surface: string }): Promise<{ candidates: IntentCandidate[] }> {
    const scan = this.scorer.scan(input.prompt);
    return { candidates: this.scorer.rescore(input.prompt, scan, { stage2: this.stage2 }).slice(0, 5).map((c) => ({ intent: c.intent, score: round(c.score) })) };
  }

  private segments(prompt: string): { text: string; start: number }[] {
    const text = normalize(prompt);
    const out: { text: string; start: number }[] = [];
    let at = 0;
    const re = new RegExp(SEGMENT.source, "gi");
    let m: RegExpExecArray | null;
    const cuts: { from: number; to: number }[] = [];
    while ((m = re.exec(text)) !== null) {
      if (m[0] === "") re.lastIndex += 1;
      else cuts.push({ from: m.index, to: m.index + m[0].length });
    }
    for (const c of cuts) {
      out.push({ text: text.slice(at, c.from), start: at });
      at = c.to;
    }
    out.push({ text: text.slice(at), start: at });
    // A fragment too short to carry an intent is joined to the one before it.
    const merged: { text: string; start: number }[] = [];
    for (const s of out) {
      const content = contentStems(tokenize(s.text));
      if (content.length < 2 && merged.length > 0) merged[merged.length - 1] = { text: `${merged[merged.length - 1]?.text} ${s.text}`.trim(), start: merged[merged.length - 1]?.start ?? s.start };
      else if (content.length > 0 || merged.length === 0) merged.push(s);
    }
    return merged;
  }

  /**
   * Two or more segments of the prompt that each, on their own, reach at least the Medium band for a different intent, with at least one of them High (section 4.5: the plan
   * is of High candidates on disjoint spans, and the secondary ones are everything at or above the Medium floor). Segments are cut at commas, semicolons and conjunctions, so the
   * spans are disjoint by construction.
   */
  private multi(prompt: string, context: DecideInput["context"], sem: ReadonlyMap<string, EmbeddedSimilarity> = new Map()): IntentCandidate[] {
    const parts = this.segments(prompt);
    if (parts.length < 2 || parts.length > 5) return [];
    const found: IntentCandidate[] = [];
    const medium = this.bands.find((b) => b.name === "medium")?.min ?? 0.55;
    for (const p of parts) {
      const scan = this.scorer.scan(p.text);
      const top = this.scorer.rescore(p.text, scan, { stage2: this.stage2, context, semantic: sem.get(p.text) }).find((c) => c.intent !== "GENERAL");
      if (top && top.score >= medium && !found.some((f) => f.intent === top.intent)) found.push({ intent: top.intent, score: round(top.score), span: p.text });
    }
    return found.length >= 2 && found.some((f) => bandOf(f.score, this.bands) === "high") ? found : [];
  }

  /** The registry's examples and descriptions as passage vectors, asked for once. A failure is remembered for half a minute and then tried again. */
  private prototypes(): Promise<Map<string, ArrayLike<number>[]> | null> {
    const embedder = this.opts.embedder;
    if (!embedder) return Promise.resolve(null);
    const now = this.clock();
    if (this.protoVectors && (this.protoVectors.at < 0 || now - this.protoVectors.at < RETRY_EMBEDDER_AFTER_MS)) return this.protoVectors.value;
    const texts = this.scorer.prototypeTexts();
    const value = embedder.embed(texts.map((t) => t.text), "passage", Math.max(30_000, this.opts.embedDeadlineMs ?? 0)).then(
      (vectors) => {
        const by = new Map<string, ArrayLike<number>[]>();
        texts.forEach((t, i) => by.set(t.intent, [...(by.get(t.intent) ?? []), vectors[i] as ArrayLike<number>]));
        if (this.protoVectors) this.protoVectors.at = -1;
        return by;
      },
      (e: unknown) => {
        this.lastEmbedFailure = e instanceof Error ? e.message.slice(0, 160) : "the embedder failed";
        return null;
      },
    );
    this.protoVectors = { at: now, value };
    return value;
  }

  /**
   * For each of the texts, the cosine with the nearest example of every intent, or a failure when the embedder cannot be reached (the decision is then made with the built-in
   * comparison). The prompt and its segments go in one request. Null means no embedder is configured.
   */
  private async semantics(texts: readonly string[]): Promise<{ per: Map<string, EmbeddedSimilarity>; failure: string | null } | null> {
    const embedder = this.opts.embedder;
    if (!embedder || !this.stage2) return null;
    const protos = await this.prototypes();
    if (protos === null) return { per: new Map(), failure: this.lastEmbedFailure ?? "the registry's examples could not be embedded" };
    try {
      const unique = [...new Set(texts)];
      const vectors = await embedder.embed(unique, "query", this.opts.embedDeadlineMs ?? 8_000);
      const per = new Map<string, EmbeddedSimilarity>();
      unique.forEach((t, k) => {
        const q = vectors[k] as ArrayLike<number>;
        const nearest = new Map<string, number>();
        for (const [id, vs] of protos) {
          let best = 0;
          for (const v of vs) {
            let d = 0;
            const n = Math.min(q.length, v.length);
            for (let j = 0; j < n; j += 1) d += (q[j] as number) * (v[j] as number);
            if (d > best) best = d;
          }
          nearest.set(id, best);
        }
        per.set(t, { nearest, weights: this.opts.embeddedWeights ?? CANONICAL_WEIGHTS, floor: this.opts.embeddedFloor ?? EMBEDDED_FLOOR, ceil: this.opts.embeddedCeil ?? EMBEDDED_CEIL });
      });
      return { per, failure: null };
    } catch (e) {
      this.lastEmbedFailure = e instanceof Error ? e.message.slice(0, 160) : "the embedder failed";
      return { per: new Map(), failure: this.lastEmbedFailure };
    }
  }

  /**
   * What is read for intent: the prompt cut to its length limit, with the instruction-like text of a surface that strips it taken out, and the texts a real embedder is asked about
   * (that text and the segments it may be cut into).
   */
  private sensing(raw: string): { prompt: string; stripped: ReturnType<Guard["injectionSpans"]>; sensed: string; texts: string[] } {
    const max = this.opts.maxPromptChars ?? 8_000;
    const prompt = raw.length > max ? raw.slice(0, max) : raw;
    // A surface that reads text as data takes the injection patterns' matches out of what is scored for intent: the instruction aimed at the assistant is evidence of an attack,
    // and it must not also steer what the request is taken to be. The guard still judges the whole prompt.
    const stripped = this.guard.pack.injection?.strip === true ? this.guard.injectionSpans(prompt, new Set(), this.capabilities.knownToolIds()).filter((h) => h.score >= (this.guard.pack.injection?.warnAt ?? 0.4)) : [];
    const sensed = stripped.length === 0 ? prompt : stripSpans(normalize(prompt), stripped);
    const parts = this.segments(sensed);
    return { prompt, stripped, sensed, texts: [sensed, ...(parts.length >= 2 && parts.length <= 5 ? parts.map((p) => p.text) : [])] };
  }

  /** The query texts a decision on this prompt asks an embedder for, and the passage texts it needs once. */
  embeddingTexts(prompt: string): { queries: string[]; passages: string[] } {
    return { queries: [...new Set(this.sensing(prompt).texts)], passages: this.scorer.prototypeTexts().map((t) => t.text) };
  }

  async decide(input: DecideInput): Promise<Decision> {
    const t0 = performance.now();
    if (!input || typeof input.prompt !== "string" || typeof input.surface !== "string") throw new TypeError("decide needs a prompt and a surface, both strings");
    const traceId = this.ulid.next();
    const user: UserRef = { id: input.user?.id ?? "anonymous", role: input.user?.role ?? "anonymous" };
    const recents = this.remember ? this.sessions.get(user.id) ?? [] : [];
    const context = input.context;
    const { prompt, stripped, sensed, texts } = this.sensing(input.prompt);

    // Sense. With a real embedder the prompt and the segments it may be cut into are embedded together, so one request serves the whole decision.
    const semantics = await this.semantics(texts);
    const stage2: Decision["stage2"] = !this.stage2 ? "skipped" : semantics === null ? "used" : semantics.failure === null ? "embedded" : "degraded";
    const scan = this.scorer.scan(sensed);
    const scored = this.scorer.rescore(sensed, scan, { stage2: this.stage2, context, sessionRecents: recents, semantic: semantics?.failure === null ? semantics.per.get(sensed) : undefined });
    const candidates: IntentCandidate[] = scored.slice(0, 5).map((c) => ({ intent: c.intent, score: round(c.score) }));
    const top = scored[0] as ScoredCandidate;
    const second = scored[1];
    let band = bandOf(top.score, this.bands);
    const plan = this.multi(sensed, context, semantics?.failure === null ? semantics.per : undefined);
    let intents: IntentCandidate[];
    let primary: Intent;
    if (plan.length >= 2 && band !== "high") {
      intents = plan;
      primary = this.registry.get((plan[0] as IntentCandidate).intent) as Intent;
      band = "high";
    } else if (plan.length >= 2 && !plan.some((p) => p.intent === top.intent)) {
      intents = plan;
      primary = this.registry.get((plan[0] as IntentCandidate).intent) as Intent;
    } else if (plan.length >= 2) {
      intents = [{ intent: top.intent, score: round(top.score), span: scan.text.slice(top.spanStart, top.spanEnd) }, ...plan.filter((p) => p.intent !== top.intent)];
      primary = this.registry.get(top.intent) as Intent;
    } else if (band === "reject") {
      primary = this.registry.get("GENERAL") as Intent;
      intents = [{ intent: "GENERAL", score: round(top.score) }];
    } else {
      primary = this.registry.get(top.intent) as Intent;
      intents = [{ intent: top.intent, score: round(top.score), span: scan.text.slice(top.spanStart, top.spanEnd) }];
    }
    const involved = intents.map((x) => this.registry.get(x.intent) as Intent);

    // Interpret, on the prompt with PII redacted: nothing downstream reads a raw address or key.
    const redactedFirst = this.guard.check({ prompt, intent: null, user, surface: input.surface, params: {}, recentIntents: [], reachable: new Set(), knownTools: new Set(), riskClassOf: () => undefined });
    const reading: Interpretation = interpret(primary, stripped.length === 0 ? redactedFirst.redactedPrompt : sensed, input.context?.entities, (input.context?.activeWorkflow !== undefined) || Object.keys(input.context?.entities ?? {}).length > 0 || (input.context?.memory?.length ?? 0) > 0 || (input.context?.recentIntents?.length ?? 0) > 0);
    if (this.opts.resolveEntity) for (const name of Object.keys(reading.references)) reading.references[name] = this.opts.resolveEntity(name) ?? (reading.references[name] as string);

    // Guard, once per intent in the plan, and reduced together. The prompt itself was judged above for injection and PII; each intent adds its policy, scope and rate layers.
    const reachable = new Set(this.capabilities.closure(involved.flatMap((i) => i.capabilities.map(cap))));
    const knownTools = this.capabilities.knownToolIds();
    const risks: Risk[] = [];
    // A high-risk intent that is only a guess (Low or Reject band) is never acted on, so it is not judged against the user's role either: the user is not blocked for something they
    // were not clearly asking for. The guess is still offered back as an option if the request is clarified.
    const guessed = band === "low" || band === "reject";
    const fallback = this.registry.get("GENERAL") as Intent;
    for (const i of involved) {
      risks.push(this.guard.check({ prompt, intent: guessed && i.riskClass === "high" ? fallback : i, user, surface: input.surface, params: reading.parameters, recentIntents: recents, reachable, knownTools, riskClassOf: (id) => this.registry.get(id)?.riskClass }));
    }
    const risk = reduceRisks(risks);
    const redactedPrompt = (risks[0] as ReturnType<Guard["check"]>).redactedPrompt;

    const finish = (d: Omit<Decision, "traceId" | "candidates" | "intents" | "band" | "stage2" | "latencyMs" | "intent" | "parameters" | "references" | "risk"> & Partial<Pick<Decision, "risk">>): Decision => {
      const decision: Decision = {
        ...(stripped.length > 0 ? { injection: { ids: [...new Set(stripped.map((h) => h.id))], residual: sensed } } : {}),
        traceId, candidates, intents, band, stage2, ...(semantics?.failure ? { degradedBecause: semantics.failure } : {}), ...(this.opts.embedder ? { embedder: this.opts.embedder.id } : {}), intent: primary.id, parameters: reading.parameters, references: reading.references, risk, latencyMs: Math.round((performance.now() - t0) * 100) / 100, ...d,
      };
      this.emit("scout.decision", traceId, { intent: decision.intent, band, risk: decision.risk.level, stage2: decision.stage2, ...(decision.degradedBecause ? { degradedBecause: decision.degradedBecause } : {}), latencyMs: decision.latencyMs, clarification: decision.clarification?.trigger ?? null, contract: decision.executionContract?.contractId ?? null, blocked: decision.risk.reason ?? null });
      return decision;
    };

    if (risk.level === "block") return finish({ toolPlan: [] });

    // Clarification triggers (section 4.6). The first that applies is the one reported.
    let clarification: Clarification | undefined;
    const options = candidates.filter((c) => c.intent !== "GENERAL" && c.score > 0).slice(0, 4);
    const option = (c: IntentCandidate): { label: string; intent: string } => ({ label: labelOf(this.registry.get(c.intent) as Intent), intent: c.intent });
    const explain = (a: string): string => `Did you want to ${a}?`;
    // The fallback winning outright is an answer, not an uncertainty: chit-chat and general questions the registry does not cover go to GENERAL, with nothing to clarify.
    const general = primary.id === "GENERAL" && intents.length === 1;
    const imperative = !/^(?:what|who|whom|whose|which|when|where|why|how|is|are|was|were|do|does|did|can|could|would|should|will)\b/i.test(prompt.trim()) && !prompt.trim().endsWith("?");
    if (general && reading.unresolved.length === 0 && !(band === "reject" && imperative && Object.keys(reading.references).length > 0)) {
      /* no clarification */
    } else if (band === "low" && options.length > 0 && !general) clarification = { trigger: "low-band", question: explain(options.slice(0, 3).map((c) => option(c).label).join(", or to ")), options: options.slice(0, 3).map(option) };
    else if (band === "reject" && intents.length === 1 && (reading.unresolved.length > 0 || (imperative && Object.keys(reading.references).length > 0))) {
      const about = Object.keys(reading.references).length ? ` about ${Object.keys(reading.references).slice(0, 2).join(" and ")}` : reading.unresolved.length > 0 ? ` with "${reading.unresolved[0]}"` : "";
      clarification = { trigger: "low-band", question: `What should I do${about}?${options.length > 0 ? ` ${explain(options.slice(0, 3).map((c) => option(c).label).join(", or to "))}` : ""}`, options: options.slice(0, 3).map(option) };
    } else if (band === "medium" && second && second.intent !== "GENERAL" && top.score - second.score < TIE_WINDOW && intents.length === 1) {
      clarification = { trigger: "tie", question: explain(options.slice(0, 2).map((c) => option(c).label).join(", or to ")), options: options.slice(0, 2).map(option) };
    } else if (reading.missing.length > 0 || reading.unresolved.length > 0 || reading.invalid.length > 0) {
      const what = reading.unresolved.length > 0 ? `which "${reading.unresolved[0]}"` : reading.missing.length > 0 ? reading.missing.join(", ") : reading.invalid.map((x) => x.name).join(", ");
      clarification = { trigger: "params", question: `I need ${what} to ${labelOf(primary)}.`, options: [] };
    } else if (primary.riskClass === "high" && top.score < CONFIDENCE_FOR_HIGH_RISK && intents.length === 1) {
      clarification = { trigger: "high-risk", question: `Confirm: ${labelOf(primary)}?`, options: [{ label: "Yes, go ahead", intent: primary.id }, ...options.filter((o) => o.intent !== primary.id).slice(0, 2).map(option)] };
    }
    if (clarification) this.emit("scout.clarification", traceId, { trigger: clarification.trigger, intent: primary.id });
    // A high-risk confirmation does not withhold the contract: the contract is what the executor refuses until an approval is recorded.
    const withhold = clarification !== undefined && clarification.trigger !== "high-risk";
    if (withhold) return finish({ toolPlan: [], clarification });

    // Remember what the user did, for the recency term of the next decision.
    if (this.remember) {
      this.sessions.delete(user.id);
      this.sessions.set(user.id, [primary.id, ...recents].slice(0, 5));
      // The oldest sessions go first, so a long-lived process that sees many users does not grow without bound.
      if (this.sessions.size > MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value as string);
    }

    // Route.
    if (primary.id === "GENERAL" && intents.length === 1) {
      const contract = this.issue({ traceId, parentId: undefined, primary, intents, reading, risk, redactedPrompt, plan: [], capabilities: [], user, surface: input.surface, confidence: top.score, candidates });
      return finish({ toolPlan: [], ...(clarification ? { clarification } : {}), executionContract: contract });
    }
    const permissions = this.opts.permissionsOf ? this.opts.permissionsOf(user) : new Set<string>(["*"]);
    const needed = involved.flatMap((i) => i.capabilities);
    const required = needed.filter((c) => !c.endsWith("?")).map(cap);
    const optional = needed.filter((c) => c.endsWith("?")).map(cap);
    const ctx: ResolveContext = { permissions, surface: input.surface };
    const routed = this.capabilities.plan([...new Set(required)], ctx, { parameters: reading.parameters, references: reading.references });
    if (!routed.ok) return finish({ toolPlan: routed.resolved, unresolved: { kind: routed.kind, capability: routed.capability, detail: routed.detail }, ...(clarification ? { clarification } : {}) });
    const steps = [...routed.steps];
    const degraded: string[] = [];
    for (const c of optional) {
      const r = this.capabilities.resolve(c, ctx);
      if (r.ok) steps.push({ capability: c, tool: r.tool.toolId, input: { parameters: reading.parameters, references: reading.references } });
      else degraded.push(c);
    }
    const caps = [...new Set([...routed.capabilities, ...steps.map((s) => s.capability)])];
    const contract = this.issue({ traceId, parentId: undefined, primary, intents, reading, risk, redactedPrompt, plan: steps, capabilities: caps, user, surface: input.surface, confidence: top.score, candidates });
    return finish({ toolPlan: steps, ...(degraded.length ? { degraded } : {}), ...(clarification ? { clarification } : {}), executionContract: contract });
  }

  private issue(a: {
    traceId: string; parentId: string | undefined; primary: Intent; intents: IntentCandidate[]; reading: Interpretation; risk: Risk; redactedPrompt: string; plan: ToolStep[]; capabilities: string[]; user: UserRef; surface: string; confidence: number; candidates: IntentCandidate[]; approvals?: ApprovalRecord[];
  }): ExecutionContract {
    const redactionKinds = a.risk.redactions.map((r: Redaction) => r.kind);
    const dataClass = dataClassOf(redactionKinds);
    const routed = this.router.route({ needs: a.plan.length > 0 ? ["text", "function-calling"] : ["text"], dataClass, riskClass: a.primary.riskClass, routing: this.opts.routing ?? "local-first" });
    const profile = routed.ok ? routed.ref : { id: "none", provider: "none", model: "none", local: true };
    const now = this.clock();
    const level = a.risk.level === "block" ? "high" : a.risk.level;
    const unsigned = {
      contractId: this.ulid.next(),
      ...(a.parentId ? { parentId: a.parentId } : {}),
      traceId: a.traceId,
      intent: {
        primary: { id: a.primary.id },
        parameters: a.reading.parameters,
        references: a.reading.references,
        confidence: round(a.confidence),
        alternates: a.candidates.filter((c) => c.intent !== a.primary.id).slice(0, 4),
        ...(a.intents.length > 1 ? { secondary: a.intents.slice(1) } : {}),
      },
      risk: { level, flags: a.risk.flags, redactions: a.risk.redactions, approvals: a.approvals ?? [] },
      toolPlan: a.plan,
      modelProfile: profile,
      scope: { user: a.user, surface: a.surface, capabilities: a.capabilities },
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      registryVersion: this.registry.registryVersion,
      policyPackVersion: this.policyPackVersion,
    } satisfies Omit<ExecutionContract, "signature" | "signedBy">;
    const contract = signContract(unsigned, this.signer);
    this.issued.set(contract.contractId, contract);
    if (this.issued.size > 2000) this.issued.delete(this.issued.keys().next().value as string);
    this.emit("contract.issued", a.traceId, { contractId: contract.contractId, intent: a.primary.id, risk: level, profile: profile.id, parentId: a.parentId ?? null });
    return contract;
  }

  /** What an executor does on receipt. Emits `contract.verified`, `contract.expired` or `contract.refused`. */
  verify(contract: unknown, o: { engine: string; using?: readonly string[] }): VerifyResult {
    const opts: VerifyOptions = { signer: this.signer, now: new Date(this.clock()), registryVersion: this.registry.registryVersion, ...(o.using ? { using: o.using } : {}) };
    const r = verifyContract(contract, opts);
    const c = contract as Partial<ExecutionContract> | null;
    const id = typeof c?.contractId === "string" ? c.contractId : "unknown";
    const trace = typeof c?.traceId === "string" ? c.traceId : "unknown";
    if (r.ok) this.emit("contract.verified", trace, { contractId: id, engine: o.engine });
    else if (r.reason === "expired") this.emit("contract.expired", trace, { contractId: id, engine: o.engine });
    else this.emit("contract.refused", trace, { contractId: id, engine: o.engine, reason: r.reason });
    return r;
  }

  /** Record an approval and issue the contract again with it. The first contract is untouched; the new one names it as its parent. */
  approve(parent: ExecutionContract, approval: ApprovalRecord): ExecutionContract {
    const known = this.issued.get(parent.contractId);
    if (!known || canonical(known) !== canonical(parent)) throw new Error("only a contract this Scout issued, unaltered, can be approved");
    const primary = this.registry.get(known.intent.primary.id) as Intent;
    return this.reissue(known, primary, [...known.risk.approvals, approval], known.toolPlan, known.scope.capabilities);
  }

  private reissue(parent: ExecutionContract, primary: Intent, approvals: ApprovalRecord[], plan: ToolStep[], capabilities: string[]): ExecutionContract {
    return this.issue({
      traceId: parent.traceId, parentId: parent.contractId, primary, intents: [{ intent: primary.id, score: parent.intent.confidence }, ...(parent.intent.secondary ?? [])],
      reading: { parameters: parent.intent.parameters, references: parent.intent.references, missing: [], invalid: [], unresolved: [] },
      risk: { level: parent.risk.level, flags: parent.risk.flags, redactions: parent.risk.redactions }, redactedPrompt: "", plan, capabilities, user: parent.scope.user, surface: parent.scope.surface,
      confidence: parent.intent.confidence, candidates: parent.intent.alternates, approvals,
    });
  }

  /**
   * A downstream engine could not do a step. It asks again with the contract it had as parent and a reason; the new contract shares the trace id and a fresh lifetime. Tools named
   * in the reason or in `state.excludeTools` are left out of the new plan. Approvals carry over only if the new plan reaches nothing the old one did not: a re-plan cannot widen
   * what an approval covered.
   */
  async replan(input: { parent: string; reason: string; state?: { excludeTools?: string[] } }): Promise<Decision> {
    const parent = this.issued.get(input.parent);
    if (!parent) throw new Error(`no contract ${input.parent} was issued here, or it has been forgotten`);
    const primary = this.registry.get(parent.intent.primary.id) as Intent;
    const named = [...this.capabilities.knownToolIds()].filter((t) => input.reason.toLowerCase().includes(t));
    const exclude = new Set<string>([...named, ...(input.state?.excludeTools ?? []).map((t) => t.toLowerCase())]);
    const permissions = this.opts.permissionsOf ? this.opts.permissionsOf(parent.scope.user) : new Set<string>(["*"]);
    const routed = this.capabilities.plan(parent.scope.capabilities, { permissions, surface: parent.scope.surface, exclude }, { parameters: parent.intent.parameters, references: parent.intent.references });
    const t = performance.now();
    const base = { traceId: parent.traceId, candidates: parent.intent.alternates, intents: [{ intent: primary.id, score: parent.intent.confidence }], band: bandOf(parent.intent.confidence, this.bands), stage2: "skipped" as const, intent: primary.id, parameters: parent.intent.parameters, references: parent.intent.references, risk: { level: parent.risk.level, flags: parent.risk.flags, redactions: parent.risk.redactions } as Risk };
    if (!routed.ok) {
      this.emit("scout.decision", parent.traceId, { replan: true, parent: parent.contractId, unresolved: routed.capability, reason: input.reason });
      return { ...base, toolPlan: routed.resolved, unresolved: { kind: routed.kind, capability: routed.capability, detail: routed.detail }, latencyMs: Math.round((performance.now() - t) * 100) / 100 };
    }
    const widened = routed.capabilities.some((c) => !parent.scope.capabilities.includes(c));
    const approvals = widened ? [] : parent.risk.approvals;
    const contract = this.reissue(parent, primary, approvals, routed.steps, routed.capabilities);
    this.emit("scout.decision", parent.traceId, { replan: true, parent: parent.contractId, contract: contract.contractId, reason: input.reason, approvalsCarried: approvals.length });
    return { ...base, toolPlan: routed.steps, executionContract: contract, latencyMs: Math.round((performance.now() - t) * 100) / 100 };
  }

  /** The user corrected the routing: "no, I meant ...". Counted by the override-frequency metric. */
  noteOverride(traceId: string, from: string, to: string): void {
    this.emit("scout.override", traceId, { from, to });
  }

  /** Whether an intent could run end to end for a user, as the graph stands now: the resolved plan or the first capability that is missing. */
  canRun(intentId: string, user: Partial<UserRef> = {}, surface = "chat"): ReturnType<CapabilityGraph["canRun"]> {
    const i = this.registry.get(intentId);
    if (!i) return { runnable: false, plan: [], blocked: { kind: "unresolvable-capability", capability: intentId, detail: `${intentId} is not in the registry` } };
    const permissions = this.opts.permissionsOf ? this.opts.permissionsOf({ id: user.id ?? "anonymous", role: user.role ?? "anonymous" }) : new Set<string>(["*"]);
    return this.capabilities.canRun(i.capabilities.filter((c) => !c.endsWith("?")).map(cap), { permissions, surface });
  }
}

/** The text with each span replaced by a space. Spans may overlap. */
function stripSpans(text: string, spans: readonly { start: number; end: number }[]): string {
  const keep = Array.from(text, () => true);
  for (const s of spans) for (let i = s.start; i < Math.min(s.end, keep.length); i += 1) keep[i] = false;
  return Array.from(text, (ch, i) => (keep[i] ? ch : " ")).join("").replace(/\s+/g, " ").trim();
}

const cap = (c: string): string => (c.endsWith("?") ? c.slice(0, -1) : c);
const round = (n: number): number => Math.round(n * 1000) / 1000;

const ORDER = ["low", "medium", "high", "block"] as const;

/** The strictest of several risks: the highest level, every flag, every redaction once, every approval needed. */
function reduceRisks(risks: readonly Risk[]): Risk {
  const level = risks.reduce<Risk["level"]>((acc, r) => (ORDER.indexOf(r.level) > ORDER.indexOf(acc) ? r.level : acc), "low");
  const flags: RiskFlag[] = [];
  const seen = new Set<string>();
  for (const r of risks) for (const f of r.flags) {
    const key = `${f.layer}|${f.kind}|${f.reason}`;
    if (!seen.has(key)) {
      seen.add(key);
      flags.push(f);
    }
  }
  const redactions = risks[0]?.redactions ?? [];
  const approvals = risks.flatMap((r) => r.approvalsRequired ?? []);
  const blocked = risks.find((r) => r.level === "block");
  return { level, flags, redactions, ...(blocked?.reason ? { reason: blocked.reason } : {}), ...(approvals.length > 0 ? { approvalsRequired: approvals } : {}) };
}

