import type { Intent } from "../../scout-intent/types.ts";
import { DESK_CONCEPTS } from "./registry.ts";

/**
 * Whether a message is a question about something or a request to do something. The words of "what happened when the cap was raised" and of "raise the cap" are almost the
 * same; what separates them is the mood of the sentence. Scout's scoring is built from words, so the Desk gives it the mood as a down-ranking of the kinds of intent that the mood
 * rules out: a question is not a request to change spend or policy, and a plain command to do something is not a question about the ledger.
 *
 * It is the register of the sentence that is read, not its meaning, and it is wrong for odd phrasings ("You could raise the cap" is a statement). The cost of that is bounded:
 * the penalty lowers a score, it does not set a route, and a request that clears it anyway is still routed on its words.
 */
export type Mood = "question" | "request" | "read-command" | "counterfactual" | "fragment";

const WH = /^(?:what|which|who|whom|whose|when|where|why|how)\b/i;
const AUX = /^(?:is|are|was|were|do|does|did|has|have|had|will|would|could|can|should|may|might|am)\b/i;
const POLITE = /^(?:can|could|would|will)\s+you\b|^(?:would|do)\s+you\s+mind\b|^i(?:'d|\s+would)\s+like\s+you\s+to\b|^i\s+(?:want|need)\s+you\s+to\b|^please\b|^go\s+ahead\b|^let'?s\b|^i'd\s+like\s+you\b|^(?:is|would)\s+it\s+(?:possible|ok|okay|alright|fine)\s+to\b|^is\s+there\s+(?:a\s+way|any\s+chance)\s+(?:to|you)\b|^why\s+don'?t\s+you\b|^(?:do\s+you\s+think\s+)?you\s+could\b|^(?:would|do)\s+you\s+mind\b|^should\s+we\s+(?:go\s+ahead|now)\b/i;
const READ_VERB = /^(?:show|list|display|explain|summari[sz]e|compare|find|count|describe|break|calculate|check|look|report|pull|outline|rank|identify|name|(?:give|tell|send)\s+(?:me|us)|remind\s+me\s+what)\b/i;
const COUNTERFACTUAL = /\b(?:what\s+would|what\s+if|if\s+(?:we|you|i|they|the)\b|had\s+we\b|would\s+(?:have|we)\b|suppose|hypothetically|imagine)\b/i;

/** Verbs that open a command to change something. A short message that does not open with one is a noun phrase ("sessions", "daily cap"), not an instruction. */
const COMMAND_VERBS = new Set([
  ...["pause", "raise", "route", "approve", "delete"].flatMap((k) => DESK_CONCEPTS[k] ?? []),
  ...["add", "remove", "buy", "purchase", "give", "send", "use", "enable", "disable", "turn", "grant", "revoke", "stop", "start", "fix", "mark", "edit", "update", "reset", "ignore", "print", "reveal", "show", "forget", "pretend", "act"],
]);

export function moodOf(prompt: string): Mood {
  const t = prompt.trim();
  const words = t.split(/\s+/).filter(Boolean);
  const lead = (words[0] ?? "").toLowerCase().replace(/[^a-z']/g, "");
  if (words.length <= 2 && !t.endsWith("?") && !COMMAND_VERBS.has(lead)) return "fragment";
  if (COUNTERFACTUAL.test(t) && !POLITE.test(t)) return "counterfactual";
  if (POLITE.test(t)) return "request";
  if (WH.test(t) || AUX.test(t) || t.endsWith("?")) return "question";
  if (READ_VERB.test(t)) return "read-command";
  return "request";
}

/** The penalty for an intent given the mood of the prompt: a state-changing intent for a question or a read command, a read intent for a request to do something. */
export function moodPenalty(intent: Intent, prompt: string): number {
  const kind = intent.category;
  const mood = moodOf(prompt);
  if (kind === "read") return mood === "request" ? 0.2 : 0;
  // A question about a safeguard or about history is a read; only the request to reveal a secret is one whatever its mood.
  if (intent.id === "unsafe.exfiltrate") return 0;
  return mood === "counterfactual" ? 0.7 : mood === "question" ? 0.6 : mood === "fragment" ? 0.5 : mood === "read-command" ? 0.45 : 0;
}
