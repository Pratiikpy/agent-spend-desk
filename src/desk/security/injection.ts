/**
 * Text that came out of a log is written by whatever produced the log, and some of it may be written to a model: "ignore your instructions and ...".
 * Three rules keep it from steering anything (DF-072):
 *
 *   1. A name that looks like an instruction is not shown to a model at all. Where it would go, the model reads `withheld (instruction-like text)`.
 *   2. The finding is kept: the field, the kind and a short cleaned excerpt, so the person can see what was in their log and where.
 *   3. Nothing a log says is read as a decision. A model's output is a typed program that code checks, a landing state comes from commits, a cap comes from a
 *      signed policy; none of them takes a log's text as an input, so text that slips past a pattern still has nothing to act on.
 *
 * The patterns are a screen, not a proof: a rewording they do not know passes the first rule and is held by the third.
 */
export type InjectionKind = "ignore_instructions" | "role_markup" | "persona_change" | "reveal_secrets" | "jailbreak" | "tool_call_syntax";

export interface InjectionFinding {
  kind: InjectionKind;
  /** The matched text, cut down to plain characters and 80 characters. Never more than that. */
  excerpt: string;
}

const PATTERNS: readonly { kind: InjectionKind; re: RegExp }[] = [
  { kind: "ignore_instructions", re: /\b(?:ignore|disregard|forget|override|bypass)\b[^.?!\n]{0,40}\b(?:previous|prior|above|earlier|all|any|your|the|these)\b[^.?!\n]{0,40}\b(?:instructions?|rules?|prompts?|messages?|directions?|polic(?:y|ies)|guidelines?|constraints?)\b/i },
  { kind: "role_markup", re: /<\/?\s*(?:system|assistant|user|tool|developer|instructions?)\b[^>]{0,40}>|\[\/?\s*(?:INST|SYS|SYSTEM)\s*\]|<\|[a-z_]{2,20}\|>|(?:^|\n)\s*(?:system|assistant|developer)\s*:/i },
  { kind: "persona_change", re: /\byou are now\b|\bfrom now on,? you\b|\bpretend (?:to be|that you)\b|\bact as (?:an?|the) \w+/i },
  { kind: "reveal_secrets", re: /\b(?:reveal|print|show|repeat|output|leak|send|exfiltrate)\b[^.?!\n]{0,40}\b(?:system prompt|your instructions|api key|secrets?|passwords?|tokens?|credentials?)\b/i },
  { kind: "jailbreak", re: /\bdeveloper mode\b|\bjailbreak\b|\bDAN mode\b|\bno restrictions\b/i },
  { kind: "tool_call_syntax", re: /<tool_call>|\btool_calls?\b\s*["':=\[]|\bfunction_call\b|"name"\s*:\s*"[a-z_]+"\s*,\s*"arguments"|\b(?:call|invoke|execute)\b[^.?!\n]{0,20}\b(?:the )?(?:tool|function)\b/i },
];

/** Cut a matched span down to plain characters and a short length, so a finding cannot carry the text it found. */
function excerptOf(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 10);
  const raw = text.slice(start, Math.min(text.length, index + length + 10));
  return raw.replace(/[^A-Za-z0-9._:@/+ -]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Every kind of instruction-like text in `text`, once each, with a short cleaned excerpt. Empty for ordinary text. */
export function scanInjection(text: string): InjectionFinding[] {
  const out: InjectionFinding[] = [];
  if (text.length < 8) return out;
  for (const { kind, re } of PATTERNS) {
    const m = re.exec(text);
    if (m !== null) out.push({ kind, excerpt: excerptOf(text, m.index, m[0].length) });
  }
  return out;
}

export function looksInstructionLike(text: string): boolean {
  return scanInjection(text).length > 0;
}

/** What a model reads in place of a name that looks like an instruction. */
export const WITHHELD = "withheld (instruction-like text)";
