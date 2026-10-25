import { createHash } from "node:crypto";

import { routeQuestion as legacyRoute } from "../ask/risk.ts";
import { BUILT_IN_PACKS, type PolicyPack } from "../../scout-intent/guard.ts";
import { Scout } from "../../scout-intent/scout.ts";
import type { Decision } from "../../scout-intent/types.ts";
import { moodPenalty } from "./mood.ts";
import { deskRegistry, DESK_CONCEPT_WEIGHT, DESK_SYNONYMS } from "./registry.ts";

/**
 * The Risk Router, on Meterless Scout Intent (DF-119). Before Ask plans anything, the question is decided by Scout over the Desk's intent registry, and what comes back is one of
 * four routes: read, spend_action, policy_change, unsafe. Only a read goes on to the Planner. The other three are refused with a reason, and nothing is run.
 *
 * Three rules, each about what happens when the router is wrong or missing:
 *  - It fails closed. If Scout throws, the question is routed to `unsafe` and refused: a router that cannot decide never lets a question through as a read.
 *  - It is the stricter of two. The Desk's older rule router (a few patterns for imperative requests) still runs, and the stricter route of the two is used, so that Scout can only
 *    add refusals. Whether Scout adds anything over the rules is measured (`desk scout eval`), not assumed.
 *  - Instruction-like text inside a question is flagged and carried on, not blocked. Ask runs a typed program over the ledger, so nothing a question says can change what is read;
 *    a message that is only an injection has no ledger question in it and is routed on what it asks for. A flagged match inside a quotation counts for half.
 *
 * Switched off (`--ablate scout_intent`), nothing is routed and every question is a read. That is the ablation's state, and it fails the action-phrased-as-a-question cases by design.
 */
export type DeskRoute = "read" | "spend_action" | "policy_change" | "unsafe";

export interface ScoutDetail {
  traceId: string;
  intent: string | null;
  band: string;
  score: number;
  alternates: { intent: string; score: number }[];
  clarification: string | null;
  riskLevel: string;
  latencyMs: number;
  registryVersion: number;
  policyPack: string;
  contractId: string | null;
}

export interface DeskRouteResult {
  route: DeskRoute;
  flags: string[];
  /** Which part decided: Scout, the older rules, both agreeing, nothing (ablated), or a failure (refused). */
  source: "scout" | "rules" | "both" | "off" | "failed";
  scout: ScoutDetail | null;
  /** The route each part gave on its own, for the record and for the comparison. */
  scoutRoute: DeskRoute | null;
  rulesRoute: DeskRoute;
  reason?: string;
}

const ORDER: DeskRoute[] = ["read", "spend_action", "policy_change", "unsafe"];
const strictest = (a: DeskRoute, b: DeskRoute): DeskRoute => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);
const KIND: Record<string, DeskRoute> = { read: "read", action: "spend_action", policy: "policy_change", unsafe: "unsafe" };

/** The Desk's policy pack: the built-in default with the injection layer set to warn and never block, no rate limit, and a quoted match counting for half. */
export function deskPack(): PolicyPack {
  const base = BUILT_IN_PACKS["default"] as PolicyPack;
  return {
    ...base,
    id: "desk",
    version: 1,
    injection: { ...base.injection, blockAt: 1.01, warnAt: 0.4, quotedFactor: 0.5, strip: true },
    rate: { capacity: 1_000_000, refillPerMinute: 1_000_000, highRiskCapacity: 1_000_000 },
    scope: { recentHighRiskLimit: 1_000_000 },
  };
}

export function createDeskScout(clock?: () => number): Scout {
  return new Scout({
    intentRegistry: deskRegistry(),
    policyPack: deskPack(),
    synonyms: DESK_SYNONYMS,
    scorer: { conceptWeight: DESK_CONCEPT_WEIGHT, riskPenalty: moodPenalty },
    selfTest: true,
    // Each question stands alone: the same question gets the same decision whatever was asked before it.
    sessionMemory: false,
    ...(clock ? { clock } : {}),
  });
}

let shared: Scout | null = null;
/** One Scout for the process: building it runs the Stage-1 startup self-test. */
export function deskScout(): Scout {
  return (shared ??= createDeskScout());
}

/** What kind of request a decision is. The kind of the intent that won, or the strictest kind among intents that tie or are planned together. */
export function routeOfDecision(d: Decision): DeskRoute {
  if (d.risk.level === "block") return "unsafe";
  let route: DeskRoute = "read";
  const named = d.intents.map((i) => i.intent).filter((i) => i !== "GENERAL");
  for (const id of named) route = strictest(route, KIND[id.split(".")[0] as string] ?? "read");
  // Ranked but not chosen: a request-for-change that ties with a read within the tie window, or a clarification between kinds, takes the stricter kind.
  const top = d.candidates[0];
  if (top && d.clarification) {
    for (const c of d.candidates.slice(0, 3)) {
      const kind = KIND[c.intent.split(".")[0] as string] ?? "read";
      // A close second that is "unsafe" decides only when it is the top: a bare "pause" sits near "switch off a safeguard" in the words, and refusing it for that would give the wrong reason.
      if (c.intent !== "GENERAL" && c.score >= top.score - 0.05 && c.score >= 0.4 && (kind !== "unsafe" || c === top)) route = strictest(route, kind);
    }
  }
  return route;
}

const HARD_INJECTION = new Set(["exfiltrate", "bulk-exfil", "destructive", "privilege", "unrestricted", "pretend-system", "role-markers", "tool-ref"]);

/** After the attack was taken out, a question about the ledger is left: a read intent ahead of the Reject band. */
function hasReadQuestion(d: Decision): boolean {
  const top = d.candidates[0];
  return top !== undefined && top.intent.startsWith("read.") && top.score >= 0.4;
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

export interface DeskRouterOptions {
  scout?: Scout | null;
  /** Switch Scout off (the ablation): every question is a read. */
  off?: boolean;
}

/** Route a question. Never throws: a failure of the router is a refusal. */
export async function routeDeskQuestion(question: string, o: DeskRouterOptions = {}): Promise<DeskRouteResult> {
  const rules = legacyRoute(question);
  const rulesRoute: DeskRoute = rules.route;
  if (o.off) return { route: "read", flags: [], source: "off", scout: null, scoutRoute: null, rulesRoute };
  let decision: Decision;
  try {
    decision = await (o.scout ?? deskScout()).decide({ prompt: question, user: { id: "owner", role: "owner" }, surface: "ask" });
  } catch (e) {
    return { route: "unsafe", flags: rules.flags, source: "failed", scout: null, scoutRoute: null, rulesRoute, reason: `The router could not decide (${e instanceof Error ? e.message.slice(0, 120) : "an error"}), so nothing was run.` };
  }
  let scoutRoute = routeOfDecision(decision);
  // A message that is only an attack on the assistant has no ledger question left once the attack is taken out. If what it asks for is to reveal a secret, switch off a safeguard or
  // act with a privilege, that is a request the Desk refuses; a plain "ignore your instructions" with nothing after it is flagged and left to find nothing to answer.
  if (decision.injection && scoutRoute === "read" && !hasReadQuestion(decision) && decision.injection.ids.some((id) => HARD_INJECTION.has(id))) scoutRoute = "unsafe";
  const route = strictest(scoutRoute, rulesRoute);
  const flags = new Set(rules.flags);
  for (const f of decision.risk.flags) {
    if (f.layer === "injection") flags.add(f.kind === "pattern" && /hidden/.test(f.evidence?.join(" ") ?? "") ? "control_characters" : "instruction_in_question");
  }
  const top = decision.candidates[0];
  const detail: ScoutDetail = {
    traceId: decision.traceId, intent: decision.intent, band: decision.band, score: top?.score ?? 0, alternates: decision.candidates.slice(0, 3), clarification: decision.clarification?.trigger ?? null,
    riskLevel: decision.risk.level, latencyMs: decision.latencyMs, registryVersion: (o.scout ?? deskScout()).registry.registryVersion, policyPack: (o.scout ?? deskScout()).policyPackVersion, contractId: decision.executionContract?.contractId ?? null,
  };
  return { route, flags: [...flags], source: scoutRoute === rulesRoute ? "both" : ORDER.indexOf(scoutRoute) > ORDER.indexOf(rulesRoute) ? "scout" : "rules", scout: detail, scoutRoute, rulesRoute };
}

export const questionHash = (q: string): string => `sha256:${sha(q.normalize("NFKC").trim().toLowerCase())}`;
