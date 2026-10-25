import { contentStems, normalize, tokenize } from "./text.ts";
import type { Intent, ParameterProperty } from "./types.ts";

/**
 * The Interpret stage (specification section 5): bind the intent's parameters and the entities it refers to from the prompt, coerce and validate them against the schema, and say
 * which required ones could not be bound. Interpret never changes a score.
 *
 * The binding is deliberately plain. A number is bound to a parameter only when the schema says the parameter is a number and the prompt has one next to a word that says what it
 * counts or what it is worth; an enum is bound only when exactly one of its values is named; a string is bound only to a name or a phrase the prompt makes unambiguous. A value that
 * fails its schema (out of range, not in the enum) is reported and not bound, so that a required parameter that cannot be bound becomes a question to the user and not a guess.
 */
export interface Interpretation {
  parameters: Record<string, unknown>;
  /** Names in the prompt, bound to the surface's ids where it has them and marked `unverified:` where it does not. */
  references: Record<string, string>;
  /** Required parameters that could not be bound, and values that were found and failed the schema. */
  missing: string[];
  invalid: { name: string; value: unknown; why: string }[];
  /** Phrases that point at something the conversation does not supply: "the thing we talked about". */
  unresolved: string[];
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100 };

function moneyOf(token: string): number | null {
  const m = /^\$?(\d+(?:[.,]\d+)*)(k|m|b|thousand|million|billion)?$/i.exec(token.replace(/,/g, ""));
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  return Number.isNaN(n) ? null : n * (unit === "k" || unit === "thousand" ? 1e3 : unit === "m" || unit === "million" ? 1e6 : unit === "b" || unit === "billion" ? 1e9 : 1);
}

const DEICTIC = [
  /\bthe (?:thing|stuff|issue|situation|matter|one|task|project) (?:we|i|you|they) (?:talked|spoke|discussed|mentioned|agreed|decided)\b/i,
  /\bwhat (?:we|i|you|they) (?:talked|spoke|discussed|mentioned|agreed|decided)(?: about)?\b/i,
  /\b(?:as|like) (?:we|i|you) (?:said|discussed|agreed)\b/i,
  /\bthe other (?:one|thing|day)\b/i,
  /\b(?:that|this) one\b/i,
];

const COMMAND_PRONOUN = /^\W*(?:(?:please|kindly|can you|could you|would you|will you)\s+)*(?!(?:thanks|thank|great|cool|nice|ok|okay|yes|no|good|wow|perfect|awesome|sure|right)\b)[a-z]+\s+(it|that|this|them|those|these)\b/i;

const HEAD_NOUNS =new Set(["deal", "account", "renewal", "customer", "contact", "attendee", "attendees", "team", "project", "model", "agent", "session", "client", "invoice", "report", "board", "plan", "week", "quarter"]);

/** Proper-noun groups: runs of capitalised words that are not the first word of a sentence. */
export function entityNames(prompt: string): string[] {
  const text = normalize(prompt);
  const tokens = tokenize(text);
  const out: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length > 0) out.push(run.join(" "));
    run = [];
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i] as ReturnType<typeof tokenize>[number];
    const written = text.slice(t.start, t.end);
    const named = t.proper || (/^\p{Lu}[\p{L}\p{N}]+$/u.test(written) && !t.stop && i > 0 && !HEAD_NOUNS.has(t.raw) && /^[A-Z]{2,}$/.test(written));
    if (named) run.push(written);
    else flush();
  }
  flush();
  return out;
}

function bindNumber(name: string, prop: ParameterProperty, prompt: string): number | undefined {
  const lower = prompt.toLowerCase();
  const countish = /^(?:count|limit|top|n|number|size|max|num)/i.test(name);
  const moneyish = /(?:value|amount|price|cost|budget|min|max|spend|total)/i.test(name) && !countish;
  const tokens = tokenize(lower);
  const candidates: { n: number; i: number; money: boolean }[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const raw = (tokens[i] as { raw: string }).raw;
    const word = NUMBER_WORDS[raw];
    const money = moneyOf(raw);
    if (word !== undefined) candidates.push({ n: word, i, money: false });
    else if (money !== null) candidates.push({ n: money, i, money: /^\$/.test(raw) || /(?:k|m|b|thousand|million|billion)$/i.test(raw) });
  }
  if (candidates.length === 0) return undefined;
  if (moneyish) {
    const m = candidates.find((c) => c.money);
    return m?.n;
  }
  if (countish || prop.type === "integer") {
    for (const c of candidates) {
      if (c.money) continue;
      const before = (tokens[c.i - 1] as { raw: string } | undefined)?.raw ?? "";
      const after = (tokens[c.i + 1] as { raw: string } | undefined)?.raw ?? "";
      if (["top", "first", "last", "next", "latest", "worst", "best"].includes(before) || /^(?:deal|email|renewal|account|customer|session|model|item|result|task|stuck|at|open)/.test(after) || /^[a-z]+s$/.test(after)) return c.n;
    }
    // "the Acme deal": a single subject, one.
    return undefined;
  }
  return candidates[0]?.n;
}

function bindEnum(prop: ParameterProperty, prompt: string): { value?: string | number; ambiguous: boolean } {
  const lower = ` ${normalize(prompt).toLowerCase()} `;
  const hits = (prop.enum ?? []).filter((v) => new RegExp(`\\b${String(v).toLowerCase().replace(/[-_]/g, "[-_ ]?")}s?\\b`).test(lower));
  if (hits.length === 1) return { value: hits[0] as string | number, ambiguous: false };
  return { ambiguous: hits.length > 1 };
}

const STAGES = ["prospecting", "qualification", "proposal", "negotiation", "closed-won", "closed-lost", "closed won", "closed lost", "renewal", "onboarding", "discovery"];

function bindString(name: string, prompt: string, names: string[]): string | undefined {
  const lower = normalize(prompt).toLowerCase();
  if (/stage/i.test(name)) {
    const st = STAGES.find((s) => lower.includes(s));
    return st?.replace(" ", "-");
  }
  if (/period|window|range|when|horizon|date/i.test(name)) {
    const m = /\b(?:this|last|next|past|previous)\s+(?:week|month|quarter|year|day)\b|\bq[1-4](?:\s+\d{4})?\b|\b\d+[- ](?:month|week|day|year)s?\b|\btoday\b|\byesterday\b|\btomorrow\b|\bnext\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i.exec(lower);
    return m?.[0];
  }
  if (/account|customer|company|recipient|subject|target|name|contact|owner|client/i.test(name)) return names[0];
  return undefined;
}

export function interpret(intent: Intent, prompt: string, entities?: Record<string, string>, resolvable = false): Interpretation {
  const text = normalize(prompt);
  const names = entityNames(text);
  const parameters: Record<string, unknown> = {};
  const invalid: Interpretation["invalid"] = [];
  const props = intent.parameters.properties ?? {};
  for (const [name, prop] of Object.entries(props)) {
    let value: unknown;
    if (prop.enum) {
      const e = bindEnum(prop, text);
      if (e.value !== undefined) value = e.value;
      else if (e.ambiguous) invalid.push({ name, value: null, why: "more than one allowed value is named" });
    } else if (prop.type === "integer" || prop.type === "number") {
      const n = bindNumber(name, prop, text);
      if (n !== undefined) {
        if (prop.type === "integer" && !Number.isInteger(n)) invalid.push({ name, value: n, why: "not a whole number" });
        else if ((prop.minimum !== undefined && n < prop.minimum) || (prop.maximum !== undefined && n > prop.maximum)) invalid.push({ name, value: n, why: `outside ${prop.minimum ?? "-"} to ${prop.maximum ?? "-"}` });
        else value = n;
      }
    } else if (prop.type === "array") {
      if (names.length > 0) value = names;
      else {
        const m = /\b(?:compare|versus|vs\.?)\s+(.+?)(?:\.|$)/i.exec(text);
        if (m && m[1]) value = m[1].split(/\s*(?:,|\band\b|\bvs\.?\b|\bversus\b)\s*/i).filter(Boolean);
      }
    } else if (prop.type === "boolean") {
      continue;
    } else {
      value = bindString(name, text, names);
    }
    if (value !== undefined) parameters[name] = value;
  }
  const missing = (intent.parameters.required ?? []).filter((r) => parameters[r] === undefined);
  const references: Record<string, string> = {};
  for (const n of names) references[n] = entities?.[n] ?? `unverified:${n.toLowerCase().replace(/\s+/g, "-")}`;
  // Something the conversation is supposed to supply: a phrase that points back ("what we agreed"), or a request that is only a verb and a pronoun ("fix that", "summarize it").
  // If the surface has told Scout what the conversation is about (an active workflow, known entities, memory), the pointer may resolve there, and nothing is flagged.
  const unresolved: string[] = [];
  if (!resolvable) {
    for (const re of DEICTIC) {
      const m = re.exec(text);
      if (m) unresolved.push(m[0]);
    }
    if (unresolved.length === 0 && names.length === 0 && contentStems(tokenize(text)).length <= 2) {
      // "the usual" and "the same" point back wherever they stand. A bare pronoun points back only as the object of a command ("fix that", "please summarize it"); in "thanks, that was
      // helpful" it points at nothing the Desk is asked to find.
      const bare = /\b(?:the usual|the same|one)\b/i.exec(text) ?? COMMAND_PRONOUN.exec(text);
      if (bare) unresolved.push(bare[1] ?? bare[0]);
    }
  }
  return { parameters, references, missing, invalid, unresolved };
}
