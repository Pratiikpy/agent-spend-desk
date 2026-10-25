import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

import { hasInvisible, normalize } from "./text.ts";
import type { ApprovalSpec, Intent, Redaction, Risk, RiskFlag, RiskLevel, UserRef } from "./types.ts";

/**
 * The Guard stage (specification section 6): five independent layers, each returning pass, warn or block with a reason, reduced to one level.
 *
 *   1 injection   known patterns, role drift, out-of-band tool references, hidden or direction-changing characters, and an optional model check
 *   2 policy      the role and surface an intent is registered for, then declarative per-intent rules (first matching deny blocks; require-approval lifts to review)
 *   3 scope       does the intent fit this conversation; advisory, it lifts the level by one band and never blocks by itself
 *   4 pii         emails, phone numbers, card numbers, identity numbers, credentials: redacted before anything downstream sees the prompt, or blocked by pack
 *   5 rate        a token bucket per user, intent and surface, with time injected so a decision can be replayed
 *
 * Reduction: any block blocks; a warn lifts the level one band; a high-risk intent that ends at medium or high needs an approval. Warn loudly, block sparingly.
 *
 * Evidence is kept small on purpose. A detected injection payload is not copied into the decision: the flag carries the kind, the score and a short stub of the match.
 */
export interface InjectionPattern {
  id: string;
  kind: "pattern" | "role-drift" | "tool-ref";
  re: string;
  flags?: string;
  score: number;
}

export interface PolicyPack {
  id: string;
  version: number;
  injection?: {
    patterns?: InjectionPattern[];
    /** Score at or above which a request is blocked, and at or above which it is warned about. */
    blockAt?: number;
    warnAt?: number;
    /** A match inside a quotation, or after a word that says the text is being talked about, counts for this much of its score. 1 turns the discount off. */
    quotedFactor?: number;
    /** Take the matched text out of what is scored for intent (see `injectionSpans`). */
    strip?: boolean;
    /** Characters of a match kept as evidence. */
    evidenceChars?: number;
  };
  pii?: { redact?: string[]; block?: string[]; warn?: string[] };
  rate?: { capacity?: number; refillPerMinute?: number; highRiskCapacity?: number };
  scope?: { recentHighRiskLimit?: number };
  /** Declarative per-intent rules. */
  intents?: Record<string, IntentPolicy>;
}

export interface IntentPolicy {
  allow?: { roles?: string[]; surfaces?: string[]; params?: Record<string, { max?: number; min?: number; in?: (string | number)[] }> };
  deny?: { paramCombinations?: Record<string, unknown>[] };
  requireApproval?: Record<string, unknown>[];
}

const q = (re: string, flags = "i"): { re: string; flags: string } => ({ re, flags });

/** Built-in packs. `default` is conservative general-purpose; `adversarial-tight` lowers the injection thresholds and is composed with it for a hostile surface. */
export const BUILT_IN_PACKS: Readonly<Record<string, PolicyPack>> = {
  default: {
    id: "default",
    version: 1,
    injection: {
      blockAt: 0.8,
      warnAt: 0.4,
      quotedFactor: 1,
      evidenceChars: 24,
      patterns: [
        { id: "override", kind: "pattern", score: 0.95, ...q(String.raw`\b(?:ignore|disregard|forget|override|bypass|discard)\s+(?:(?:all|any|every|the|your|my|these|those|previous|prior|above|earlier|preceding|safety|security|system|original|existing|other)\s+){0,4}(?:instructions?|rules?|prompts?|guidelines?|polic(?:y|ies)|directives?|constraints?|restrictions?|safeguards?|guardrails?|programming|training|safety)\b`) },
        { id: "override-short", kind: "pattern", score: 0.85, ...q(String.raw`\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+|everything\s+)?(?:previous|prior|above|earlier|preceding)\b(?!\s+(?:typo|mistake|error|email|message\b|invoice|figure))`) },
        { id: "forget-told", kind: "pattern", score: 0.9, ...q(String.raw`\bforget\s+(?:everything|all|what)\b[^.?!\n]{0,30}\b(?:told|taught|instructed|said|know)\b`) },
        { id: "privilege", kind: "tool-ref", score: 0.85, ...q(String.raw`\b(?:give|grant|get|gain|provide|allow)\b[^.?!\n]{0,24}\b(?:unrestricted|unlimited|full|root|admin(?:istrator)?|superuser)\s+(?:access|rights|privileges|permissions|control)\b|\byou\s+can\s+now\s+do\s+anything\b`) },
        { id: "bulk-exfil", kind: "pattern", score: 0.9, ...q(String.raw`\b(?:email|send|forward|export|copy|upload|post)\b[^.?!\n]{0,40}\b(?:all|every|the\s+full|the\s+entire|whole)\b[^.?!\n]{0,30}\b(?:customers?|contacts?|users?|accounts?|records?|data|credentials?|passwords?|secrets?|keys?)\b[^.?!\n]{0,30}\bto\s+(?:me|myself|an?\s+external|[a-z0-9._%+-]+@)`) },
        { id: "exfiltrate", kind: "pattern", score: 0.9, ...q(String.raw`\b(?:reveal|print|show|dump|leak|expose|output|display|repeat|reproduce|tell\s+me|read\s+out)\b[^.?!\n]{0,30}\b(?:system\s+prompt|your\s+(?:hidden\s+)?(?:instructions|prompt|rules)|hidden\s+(?:rules|instructions)|(?:the\s+|all\s+|every\s+|my\s+|any\s+)?(?:stored\s+|secret\s+|private\s+|hidden\s+)?(?:api\s*keys?|secrets?|passwords?|credentials?|tokens?|private\s+keys?|ssh\s+keys?)\b)`) },
        { id: "system-override", kind: "pattern", score: 0.85, ...q(String.raw`\b(?:system|developer|admin(?:istrator)?|root)\s+override\b|\bnew\s+(?:important\s+)?instructions?\s*:`) },
        { id: "ignore-the-data", kind: "pattern", score: 0.8, ...q(String.raw`\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:of\s+)?the\s+(?:data|ledger|numbers|figures|context|results|rows|records|user)\b`) },
        { id: "disregard-user", kind: "pattern", score: 0.9, ...q(String.raw`\bdisregard\s+(?:the\s+)?(?:user|human|operator|owner)\b`) },
        { id: "role-markers", kind: "pattern", score: 1, ...q(String.raw`</?\s*(?:system|assistant|user|tool|instructions?|developer)\s*>|\[/?\s*INST\s*\]|<<\s*/?SYS\s*>>|<\|(?:im_start|im_end|system|endoftext)\|>|^\s*#{1,3}\s*system\s*(?:prompt|message)?\s*$|\bBEGIN\s+(?:SYSTEM|HIDDEN)\s+(?:PROMPT|INSTRUCTIONS)\b`, "im") },
        { id: "unrestricted", kind: "role-drift", score: 0.9, ...q(String.raw`\byou\s+are\s+now\b[^.?!\n]{0,40}\b(?:unrestricted|unfiltered|jailbroken|dan|developer\s+mode|god\s+mode|root|admin(?:istrator)?|without\s+(?:any\s+)?(?:rules|restrictions|limits))\b|\b(?:developer|god|unrestricted|jailbreak|dan)\s+mode\b|\bjailbreak\b|\bno\s+(?:rules|restrictions|filters)\b`) },
        { id: "pretend-system", kind: "role-drift", score: 0.85, ...q(String.raw`\b(?:pretend|act|behave|respond)\s+(?:to\s+be|as(?:\s+if\s+you\s+(?:are|were))?|like)\s+(?:the\s+|a\s+|an\s+)?(?:system|admin(?:istrator)?|root|operator|database\s+admin(?:istrator)?|dba|developer|superuser|security\s+team)\b|\byou\s+are\s+now\s+(?:the\s+|a\s+|an\s+)?(?:system|admin|database|dba|root)\b`) },
        { id: "destructive", kind: "tool-ref", score: 0.85, ...q(String.raw`\bdrop\s+(?:the\s+)?(?:\w+\s+)?(?:table|database|schema)\b|\brm\s+-rf\b|\bsudo\b|\btruncate\s+table\b|\bgrant\s+(?:me\s+|them\s+|everyone\s+)?(?:admin|root|superuser|full\s+access)\b|\bdisable\s+(?:the\s+)?(?:gate|guard|safety|policy|policies|approval|audit|logging|rate\s*limit)s?\b|\bturn\s+off\s+(?:the\s+)?(?:gate|guard|safety|approval|audit)\b`) },
        { id: "tool-ref", kind: "tool-ref", score: 0.85, ...q(String.raw`\b(?:use|call|invoke|run|open|launch|execute)\s+(?:the\s+)?([a-z][a-z0-9-]*(?:[_.][a-z0-9-]+)+)\b`) },
      ],
    },
    pii: {
      redact: ["email", "phone", "card", "ssn", "credential", "iban"],
      warn: ["credential"],
    },
    rate: { capacity: 30, refillPerMinute: 30, highRiskCapacity: 6 },
    scope: { recentHighRiskLimit: 3 },
  },
  "adversarial-tight": {
    id: "adversarial-tight",
    version: 1,
    injection: {
      blockAt: 0.6,
      warnAt: 0.3,
      patterns: [
        { id: "escaped-control", kind: "pattern", score: 0.4, ...q(String.raw`\\u(?:202[a-e]|200[b-f]|206[0-9]|feff)|\\x(?:00|1b|7f)`) },
        { id: "base64-blob", kind: "pattern", score: 0.45, ...q(String.raw`\b[A-Za-z0-9+/]{80,}={0,2}\b`, "") },
        { id: "translate-wrapper", kind: "pattern", score: 0.4, ...q(String.raw`\b(?:translate|decode|rot13|reverse|spell)\b[^.?!\n]{0,40}(?:ignore|disregard|reveal|grant|override)`) },
      ],
    },
  },
  enterprise: {
    id: "enterprise",
    version: 1,
    rate: { capacity: 20, refillPerMinute: 20, highRiskCapacity: 3 },
    scope: { recentHighRiskLimit: 2 },
  },
  regulated: {
    id: "regulated",
    version: 1,
    pii: { redact: ["email", "phone", "card", "ssn", "credential", "iban", "health"], block: ["card", "ssn", "health"] },
  },
};

export class PolicyError extends Error {}

/** Load one pack from a built-in name or a YAML/JSON file, and compose several: patterns union, the stricter threshold wins, pii lists union, the smaller rate wins. */
export function loadPacks(spec: string | readonly string[] | PolicyPack | undefined): { pack: PolicyPack; version: string } {
  const list = spec === undefined ? ["default"] : typeof spec === "string" ? [spec] : Array.isArray(spec) ? [...spec] : [spec as PolicyPack];
  const packs: PolicyPack[] = list.map((s) => {
    if (typeof s !== "string") return s;
    const builtIn = BUILT_IN_PACKS[s];
    if (builtIn) return builtIn;
    if (!existsSync(s)) throw new PolicyError(`policy pack ${JSON.stringify(s)} is neither a built-in pack (${Object.keys(BUILT_IN_PACKS).join(", ")}) nor a file`);
    const raw = (/\.ya?ml$/i.test(s) ? parseYaml(readFileSync(s, "utf8")) : JSON.parse(readFileSync(s, "utf8"))) as PolicyPack;
    if (!raw || typeof raw.id !== "string" || !Number.isInteger(raw.version)) throw new PolicyError(`${s} must carry an id and an integer version`);
    return raw;
  });
  const inj = packs.map((p) => p.injection).filter((x): x is NonNullable<PolicyPack["injection"]> => x !== undefined);
  const merged: PolicyPack = {
    id: packs.map((p) => p.id).join("+"),
    version: Math.max(...packs.map((p) => p.version)),
    injection: {
      patterns: inj.flatMap((i) => i.patterns ?? []),
      blockAt: inj.length === 0 ? 0.8 : Math.min(...inj.map((i) => i.blockAt ?? 0.8)),
      warnAt: inj.length === 0 ? 0.4 : Math.min(...inj.map((i) => i.warnAt ?? 0.4)),
      quotedFactor: Math.min(...inj.map((i) => i.quotedFactor ?? 1), 1),
      evidenceChars: Math.min(...inj.map((i) => i.evidenceChars ?? 24), 24),
      strip: inj.some((i) => i.strip === true),
    },
    pii: {
      redact: [...new Set(packs.flatMap((p) => p.pii?.redact ?? []))],
      block: [...new Set(packs.flatMap((p) => p.pii?.block ?? []))],
      warn: [...new Set(packs.flatMap((p) => p.pii?.warn ?? []))],
    },
    rate: {
      capacity: Math.min(...packs.map((p) => p.rate?.capacity ?? Infinity), 1e9),
      refillPerMinute: Math.min(...packs.map((p) => p.rate?.refillPerMinute ?? Infinity), 1e9),
      highRiskCapacity: Math.min(...packs.map((p) => p.rate?.highRiskCapacity ?? Infinity), 1e9),
    },
    scope: { recentHighRiskLimit: Math.min(...packs.map((p) => p.scope?.recentHighRiskLimit ?? Infinity), 1e9) },
    intents: Object.assign({}, ...packs.map((p) => p.intents ?? {})),
  };
  return { pack: merged, version: packs.map((p) => `${p.id}@${p.version}`).join("+") };
}

const QUOTE_LEAD = /(?:titled|named|called|labelled|labeled|says?|said|reads?|containing|contains?|text|string|phrase|message|log)\W{0,3}[:"'“‘`(\[]?\s*$/i;

interface PiiRule {
  kind: string;
  re: RegExp;
  check?: (m: string) => boolean;
}

function luhn(digits: string): boolean {
  const d = digits.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i += 1) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

const PII: PiiRule[] = [
  { kind: "credential", re: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|\b(?:password|passwd|pwd|secret|api[_ -]?key|token)\s*(?:is|=|:)\s*\S{6,}/gi },
  { kind: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: "card", re: /\b(?:\d[ -]?){13,19}\b/g, check: luhn },
  { kind: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: "iban", re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  { kind: "phone", re: /(?<![\d-])(?:\+?\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}\b/g },
  { kind: "health", re: /\b(?:diagnos(?:is|ed)|prescription|patient\s+(?:id|record)|medical\s+record|icd-?10|hipaa)\b/gi },
];

export interface GuardInput {
  prompt: string;
  intent: Intent | null;
  user: UserRef;
  surface: string;
  params: Record<string, unknown>;
  /** The intents of the user's last turns, newest first. */
  recentIntents: readonly string[];
  /** The capability names an intent may reach, for the out-of-band tool check. */
  reachable: ReadonlySet<string>;
  /** Names of tools the deployment knows, so that a prompt naming one is not mistaken for naming a hidden one. */
  knownTools: ReadonlySet<string>;
  /** Registry lookup for the risk class of recent intents. */
  riskClassOf: (id: string) => Intent["riskClass"] | undefined;
}

export interface GuardOutput extends Risk {
  /** The prompt with PII redacted, for downstream. */
  redactedPrompt: string;
  injectionScore: number;
}

/** A token bucket per key. Time is passed in, so a decision can be replayed. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  take(key: string, capacity: number, refillPerMinute: number, nowMs: number): boolean {
    const b = this.buckets.get(key) ?? { tokens: capacity, at: nowMs };
    const refilled = Math.min(capacity, b.tokens + ((nowMs - b.at) / 60_000) * refillPerMinute);
    if (refilled < 1) {
      this.buckets.set(key, { tokens: refilled, at: nowMs });
      return false;
    }
    this.buckets.set(key, { tokens: refilled - 1, at: nowMs });
    return true;
  }
}

const LEVELS: RiskLevel[] = ["low", "medium", "high", "block"];
const lift = (l: RiskLevel): RiskLevel => LEVELS[Math.min(2, LEVELS.indexOf(l) + 1)] as RiskLevel;

const matchesCondition = (cond: Record<string, unknown>, params: Record<string, unknown>): boolean =>
  Object.entries(cond).every(([k, want]) => {
    const got = params[k];
    if (want !== null && typeof want === "object") {
      const w = want as { gt?: number; gte?: number; lt?: number; lte?: number };
      const n = typeof got === "number" ? got : Number.NaN;
      return (w.gt === undefined || n > w.gt) && (w.gte === undefined || n >= w.gte) && (w.lt === undefined || n < w.lt) && (w.lte === undefined || n <= w.lte);
    }
    return got === want;
  });

export class Guard {
  readonly pack: PolicyPack;
  readonly version: string;
  private readonly patterns: { p: InjectionPattern; re: RegExp }[];
  private readonly limiter = new RateLimiter();
  private readonly recentHighRisk = new Map<string, number[]>();

  constructor(spec: string | readonly string[] | PolicyPack | undefined, private readonly now: () => number = () => Date.now(), private readonly injectionModel?: (text: string) => number) {
    const loaded = loadPacks(spec);
    this.pack = loaded.pack;
    this.version = loaded.version;
    this.patterns = (this.pack.injection?.patterns ?? []).map((p) => ({ p, re: new RegExp(p.re, `${p.flags ?? "i"}g`.replace(/g+/g, "g")) }));
  }

  /**
   * Where the injection patterns match in the (normalised) prompt, with the pattern that matched and its score after the quotation discount. For a surface that reads text as data
   * and carries on (the Desk), these spans are taken out of what is scored for intent, so that the instruction aimed at the assistant cannot steer what the request is taken to be.
   */
  injectionSpans(prompt: string, reachable: ReadonlySet<string> = new Set(), knownTools: ReadonlySet<string> = new Set()): { id: string; kind: InjectionPattern["kind"]; start: number; end: number; score: number }[] {
    const cfg = this.pack.injection ?? {};
    const text = normalize(prompt);
    const out: { id: string; kind: InjectionPattern["kind"]; start: number; end: number; score: number }[] = [];
    for (const { p, re } of this.patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m[0] === "") {
          re.lastIndex += 1;
          continue;
        }
        if (p.id === "tool-ref") {
          const name = (m[1] ?? "").toLowerCase();
          if (reachable.has(name) || knownTools.has(name)) continue;
        }
        const before = text.slice(Math.max(0, m.index - 40), m.index);
        const quoted = (cfg.quotedFactor ?? 1) < 1 && (QUOTE_LEAD.test(before) || /["“‘`]\s*$/.test(before));
        out.push({ id: p.id, kind: p.kind, start: m.index, end: m.index + m[0].length, score: quoted ? p.score * (cfg.quotedFactor ?? 1) : p.score });
      }
    }
    return out;
  }

  private injection(input: GuardInput, text: string): { flags: RiskFlag[]; score: number } {
    const cfg = this.pack.injection ?? {};
    const hits: { id: string; kind: InjectionPattern["kind"]; score: number; stub: string }[] = [];
    for (const { p, re } of this.patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m[0] === "") {
          re.lastIndex += 1;
          continue;
        }
        let score = p.score;
        if (p.id === "tool-ref") {
          // An identifier the deployment knows, or a capability the intent can reach, is a legitimate request to use that tool.
          const name = (m[1] ?? "").toLowerCase();
          if (input.reachable.has(name) || input.knownTools.has(name)) continue;
        }
        const before = text.slice(Math.max(0, m.index - 40), m.index);
        const quoted = (cfg.quotedFactor ?? 1) < 1 && (QUOTE_LEAD.test(before) || /["“‘`]\s*$/.test(before));
        if (quoted) score *= cfg.quotedFactor ?? 1;
        hits.push({ id: p.id, kind: p.kind, score, stub: m[0].slice(0, cfg.evidenceChars ?? 24) });
      }
    }
    // Characters that hide text or flip its direction are evidence on their own, and weaker than a spoken instruction.
    if (hasInvisible(input.prompt)) hits.push({ id: "hidden-characters", kind: "pattern", score: 0.4, stub: "hidden or direction-changing characters" });
    if (this.injectionModel) {
      const s = this.injectionModel(text);
      if (s >= (cfg.warnAt ?? 0.4)) hits.push({ id: "model", kind: "pattern", score: s, stub: "model check" });
    }
    if (hits.length === 0) return { flags: [], score: 0 };
    const top = Math.max(...hits.map((h) => h.score));
    const kinds = new Set(hits.map((h) => h.id));
    // Several different signals in one prompt are worse than one.
    const score = Math.min(1, top + 0.05 * (kinds.size - 1));
    const level: "block" | "warn" | null = score >= (cfg.blockAt ?? 0.8) ? "block" : score >= (cfg.warnAt ?? 0.4) ? "warn" : null;
    if (level === null) return { flags: [], score };
    const best = hits.find((h) => h.score === top) as (typeof hits)[number];
    return { flags: [{ layer: "injection", level, kind: best.kind, reason: `the request carries ${best.kind === "tool-ref" ? "a reference to a tool outside what this intent can reach" : best.kind === "role-drift" ? "an attempt to change the assistant's role" : "an instruction aimed at the assistant"} (${best.id})`, score: Math.round(score * 100) / 100, evidence: [...new Set(hits.map((h) => h.id))] }], score };
  }

  private policy(input: GuardInput): { flags: RiskFlag[]; approvals: ApprovalSpec[] } {
    const flags: RiskFlag[] = [];
    const approvals: ApprovalSpec[] = [];
    const i = input.intent;
    if (i === null) return { flags, approvals };
    if (!i.roles.includes("*") && !i.roles.includes(input.user.role)) flags.push({ layer: "policy", level: "block", kind: "role", reason: `the role ${input.user.role} may not invoke ${i.id}` });
    else if (!i.surfaces.includes("*") && !i.surfaces.includes(input.surface)) flags.push({ layer: "policy", level: "block", kind: "surface", reason: `${i.id} may not be invoked from the ${input.surface} surface` });
    const rule = this.pack.intents?.[i.id];
    if (rule) {
      if (rule.allow?.roles && !rule.allow.roles.includes(input.user.role)) flags.push({ layer: "policy", level: "block", kind: "role", reason: `policy for ${i.id} does not allow the role ${input.user.role}` });
      if (rule.allow?.surfaces && !rule.allow.surfaces.includes(input.surface)) flags.push({ layer: "policy", level: "block", kind: "surface", reason: `policy for ${i.id} does not allow the ${input.surface} surface` });
      for (const [name, b] of Object.entries(rule.allow?.params ?? {})) {
        const v = input.params[name];
        if (typeof v === "number" && ((b.max !== undefined && v > b.max) || (b.min !== undefined && v < b.min))) flags.push({ layer: "policy", level: "block", kind: "param-bound", reason: `${name} is ${v}, outside what policy allows for ${i.id}` });
        if (v !== undefined && b.in && !b.in.includes(v as string | number)) flags.push({ layer: "policy", level: "block", kind: "param-bound", reason: `${name} is not one of the values policy allows for ${i.id}` });
      }
      for (const combo of rule.deny?.paramCombinations ?? []) if (matchesCondition(combo, input.params)) flags.push({ layer: "policy", level: "block", kind: "param-combination", reason: `policy for ${i.id} denies this combination of parameters` });
      for (const cond of rule.requireApproval ?? []) if (matchesCondition(cond, input.params)) approvals.push({ kind: "operator-review", why: `policy for ${i.id} requires a review for ${JSON.stringify(cond)}` });
    }
    return { flags, approvals };
  }

  private scope(input: GuardInput): RiskFlag[] {
    const flags: RiskFlag[] = [];
    const i = input.intent;
    if (i === null) return flags;
    // Session continuity: a high-risk intent right after turns of an unrelated category.
    const last = input.recentIntents.slice(0, 3);
    if (i.riskClass === "high" && last.length >= 2 && last.every((r) => r.split(".")[0] !== i.category)) {
      flags.push({ layer: "scope", level: "warn", kind: "continuity", reason: `${i.id} follows ${last.length} turns about something else` });
    }
    // Recency: too many high-risk actions from this user in a short window.
    if (i.riskClass === "high") {
      const key = input.user.id;
      const now = this.now();
      const list = (this.recentHighRisk.get(key) ?? []).filter((t) => now - t < 10 * 60_000);
      list.push(now);
      this.recentHighRisk.set(key, list);
      if (list.length > (this.pack.scope?.recentHighRiskLimit ?? 3)) flags.push({ layer: "scope", level: "warn", kind: "recency", reason: `${list.length} high-risk requests from this user in ten minutes` });
    }
    return flags;
  }

  private piiLayer(text: string): { flags: RiskFlag[]; redactions: Redaction[]; redacted: string } {
    const cfg = this.pack.pii ?? {};
    const flags: RiskFlag[] = [];
    const redactions: Redaction[] = [];
    let redacted = text;
    for (const rule of PII) {
      const doRedact = cfg.redact?.includes(rule.kind) ?? false;
      const doBlock = cfg.block?.includes(rule.kind) ?? false;
      const doWarn = cfg.warn?.includes(rule.kind) ?? false;
      if (!doRedact && !doBlock && !doWarn) continue;
      let count = 0;
      redacted = redacted.replace(rule.re, (m) => {
        if (rule.check && !rule.check(m)) return m;
        count += 1;
        return `[redacted ${rule.kind}]`;
      });
      if (count === 0) continue;
      if (doRedact) redactions.push({ kind: rule.kind, count });
      if (doBlock) flags.push({ layer: "pii", level: "block", kind: rule.kind, reason: `the request contains ${rule.kind} data this pack does not accept` });
      else if (doWarn) flags.push({ layer: "pii", level: "warn", kind: rule.kind, reason: `the request contains ${rule.kind} data, which was redacted` });
    }
    return { flags, redactions, redacted };
  }

  private rate(input: GuardInput): RiskFlag[] {
    const i = input.intent;
    if (i === null) return [];
    const r = this.pack.rate ?? {};
    const cap = i.riskClass === "high" ? (r.highRiskCapacity ?? 6) : (r.capacity ?? 30);
    const ok = this.limiter.take(`${input.user.id}|${i.id}|${input.surface}`, cap, r.refillPerMinute ?? 30, this.now());
    return ok ? [] : [{ layer: "rate", level: "block", kind: "rate-limit", reason: `too many ${i.id} requests from ${input.user.id} on ${input.surface}` }];
  }

  /** Run all five layers and reduce them. Injection is judged on the prompt as given, before redaction, so that redaction cannot hide it. */
  check(input: GuardInput): GuardOutput {
    const text = normalize(input.prompt);
    const inj = this.injection(input, text);
    const pol = this.policy(input);
    const scope = this.scope(input);
    const pii = this.piiLayer(text);
    const rate = this.rate(input);
    const flags = [...inj.flags, ...pol.flags, ...scope, ...pii.flags, ...rate];
    const blocked = flags.find((f) => f.level === "block");
    const base: RiskLevel = input.intent?.riskClass ?? "low";
    let level: RiskLevel = base;
    if (blocked) level = "block";
    else if (flags.some((f) => f.level === "warn")) level = lift(base);
    const approvals: ApprovalSpec[] = [...pol.approvals];
    if (level !== "block" && input.intent?.riskClass === "high" && (level === "medium" || level === "high")) approvals.push({ kind: "user-confirm", why: `${input.intent.id} is a high-risk intent` });
    if (level !== "block" && pol.approvals.length > 0 && level !== "high") level = lift(level);
    return { level, flags, redactions: pii.redactions, ...(blocked ? { reason: blocked.reason } : {}), ...(approvals.length > 0 ? { approvalsRequired: approvals } : {}), redactedPrompt: pii.redacted, injectionScore: inj.score };
  }
}
