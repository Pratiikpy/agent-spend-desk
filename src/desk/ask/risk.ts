/**
 * The Risk Router: a code classifier that decides, before anything runs, whether a message is a question
 * about the ledger or a request to change spend or policy. It is not Meterless's Scout Intent engine (that
 * is not vendored here) and does not detect injection; it only keeps an action phrased as a question from
 * being answered as if it were a read. Text that tries to redirect the planner is flagged and carried on,
 * because nothing a question says can change what code reads from the ledger.
 */
export type Route = "read" | "spend_action" | "policy_change" | "unsafe";
/** What the older pattern router can return; Scout adds `unsafe`. */
export type RuleRoute = "read" | "spend_action" | "policy_change";

export interface RouteResult {
  route: RuleRoute;
  flags: string[];
}

const ACTION_VERBS = "set|raise|lower|increase|decrease|reduce|cap|limit|pause|stop|block|disable|enable|switch|route|approve|deny|cancel|kill|change|update|apply|turn off|turn on|revoke|grant|delete|remove|suspend|freeze|throttle|restrict|terminate|shut down|reset|rotate|purge|wipe|ban";
const ACTION_NOUNS = "cap|caps|budget|budgets|limit|limits|policy|policies|spend|model|models|route|routes|seat|seats|plan|quota|key|keys|rule|rules|agent|agents|team|teams|engineer|engineers|session|sessions|user|users|account|accounts|access|ledger|data|history";

const IMPERATIVE = new RegExp(`^\\s*(?:please\\s+|now\\s+|then\\s+)?(?:${ACTION_VERBS})\\b[^?]*\\b(?:${ACTION_NOUNS})\\b`, "i");
const REQUEST = new RegExp(`\\b(?:can|could|would|will|should)\\s+you\\s+(?:please\\s+)?(?:${ACTION_VERBS})\\b[^?]*\\b(?:${ACTION_NOUNS})\\b`, "i");
const POLICY = /\b(?:draft|write|propose|edit|amend|rewrite)\b[^?]*\bpolic(?:y|ies)\b/i;

const INJECTION = [
  /\bignore\b[^.?!]{0,30}\b(?:previous|prior|above|earlier|all)\b[^.?!]{0,30}\b(?:instruction|rule|prompt|message)s?\b/i,
  /\bdisregard\b[^.?!]{0,30}\b(?:system|previous|prior|instruction)/i,
  /\byou are now\b/i,
  /\b(?:reveal|print|show|repeat|output)\b[^.?!]{0,30}\b(?:system prompt|your instructions|api key|secret|password|token)\b/i,
  /\bdeveloper mode\b|\bjailbreak\b/i,
  /<\/?(?:system|assistant|tool|instructions?)>/i,
];

export function routeQuestion(question: string): RouteResult {
  const flags: string[] = [];
  for (const re of INJECTION) if (re.test(question)) flags.push("instruction_in_question");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(question)) flags.push("control_characters");
  const unique = [...new Set(flags)];
  if (POLICY.test(question)) return { route: "policy_change", flags: unique };
  if (IMPERATIVE.test(question) || REQUEST.test(question)) return { route: "spend_action", flags: unique };
  return { route: "read", flags: unique };
}

export const REFUSAL: Record<Exclude<Route, "read">, string> = {
  spend_action: "That reads as a request to change spend, not a question about the ledger. Ask does not change caps, routes or seats; a change goes through a drafted policy and the approval gate.",
  policy_change: "That reads as a request to change policy, not a question about the ledger. Ask does not edit policy; use the policy drafter, which checks a change before it is proposed.",
  unsafe: "That asks for something the Desk will not do from a question: reveal a key or its own instructions, switch off a safeguard, or change recorded history. Ask only reads the ledger.",
};
