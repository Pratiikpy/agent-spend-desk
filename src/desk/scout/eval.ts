import { readFileSync } from "node:fs";

import { routeDeskQuestion, type DeskRoute, type DeskRouteResult } from "./router.ts";
import { routeQuestion as legacyRoute } from "../ask/risk.ts";
import type { Scout } from "../../scout-intent/scout.ts";

/**
 * How well the router sends a question the right way, on a labelled corpus (`evals/scout/desk/<split>/routes.jsonl`): read, spend_action, policy_change or unsafe, and whether the
 * question carries instruction-like text. Four configurations are scored on the same questions so that each part has to show what it adds:
 *
 *   off      Scout switched off: every question is a read (the ablation's state)
 *   rules    the Desk's older pattern router alone
 *   scout    Scout alone
 *   default  the stricter of the two, which is what Ask runs
 *
 * The errors are not equal. A request to change spend that is answered as if it were a question (`action_as_read`) misleads the person; a question that is refused as a request
 * (`false_refusal`) costs them a rewording. Both are reported, not folded into one accuracy.
 */
export interface RouteExample {
  id: string;
  prompt: string;
  expected: { route: DeskRoute; flag?: boolean };
  tags?: string[];
}

export const ROUTES: readonly DeskRoute[] = ["read", "spend_action", "policy_change", "unsafe"];
export type Config = "off" | "rules" | "scout" | "default";
export const CONFIGS: readonly Config[] = ["off", "rules", "scout", "default"];

export function loadRoutes(path: string): RouteExample[] {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as RouteExample);
}

export interface ConfigScore {
  accuracy: number;
  /** Non-read examples sent to the planner as reads, and reads refused as requests, each as a share of its group. */
  action_as_read: number;
  false_refusal: number;
  recall: Record<Exclude<DeskRoute, "read">, number>;
  precision: Record<Exclude<DeskRoute, "read">, number>;
  /** Of the examples that carry instruction-like text, the share flagged; of the ones that do not, the share flagged anyway. */
  flag_recall: number;
  flag_false_positive: number;
  counts: { total: number; read: number; nonRead: number; flagged: number };
  confusion: Record<DeskRoute, Record<DeskRoute, number>>;
  misses: { id: string; prompt: string; expected: DeskRoute; got: DeskRoute; tags: string[] }[];
}

const ratio = (a: number, b: number, whenEmpty = 1): number => (b === 0 ? whenEmpty : a / b);

function score(examples: readonly RouteExample[], results: readonly { route: DeskRoute; flagged: boolean }[]): ConfigScore {
  const confusion = Object.fromEntries(ROUTES.map((a) => [a, Object.fromEntries(ROUTES.map((b) => [b, 0]))])) as ConfigScore["confusion"];
  const misses: ConfigScore["misses"] = [];
  let hit = 0;
  let flaggedTotal = 0;
  let flaggedHit = 0;
  let cleanTotal = 0;
  let cleanFlagged = 0;
  examples.forEach((ex, i) => {
    const r = results[i] as { route: DeskRoute; flagged: boolean };
    confusion[ex.expected.route][r.route] += 1;
    if (r.route === ex.expected.route) hit += 1;
    else misses.push({ id: ex.id, prompt: ex.prompt, expected: ex.expected.route, got: r.route, tags: ex.tags ?? [] });
    if (ex.expected.flag) {
      flaggedTotal += 1;
      if (r.flagged) flaggedHit += 1;
    } else if (ex.expected.route !== "unsafe") {
      // A request to reveal a key or switch off a safeguard is an attack in effect, so flagging it is not a false alarm; it is left out of the count.
      cleanTotal += 1;
      if (r.flagged) cleanFlagged += 1;
    }
  });
  const reads = examples.filter((e) => e.expected.route === "read").length;
  const nonRead = examples.length - reads;
  const recall = {} as ConfigScore["recall"];
  const precision = {} as ConfigScore["precision"];
  for (const c of ROUTES.filter((x) => x !== "read") as Exclude<DeskRoute, "read">[]) {
    const tp = confusion[c][c];
    const got = ROUTES.reduce((s, a) => s + confusion[a][c], 0);
    recall[c] = ratio(tp, ROUTES.reduce((s, b) => s + confusion[c][b], 0));
    precision[c] = ratio(tp, got);
  }
  const refused = ROUTES.filter((x) => x !== "read").reduce((s, c) => s + confusion["read"][c], 0);
  const asRead = ROUTES.filter((x) => x !== "read").reduce((s, c) => s + confusion[c]["read"], 0);
  return {
    accuracy: ratio(hit, examples.length),
    action_as_read: ratio(asRead, nonRead, 0),
    false_refusal: ratio(refused, reads, 0),
    recall,
    precision,
    flag_recall: ratio(flaggedHit, flaggedTotal),
    flag_false_positive: ratio(cleanFlagged, cleanTotal, 0),
    counts: { total: examples.length, read: reads, nonRead, flagged: flaggedTotal },
    confusion,
    misses,
  };
}

export interface RouteEvaluation {
  scores: Record<Config, ConfigScore>;
  /** Examples on which the configurations disagree with the default, for reading what Scout adds. */
  scoutAdds: { id: string; prompt: string; expected: DeskRoute; rules: DeskRoute; scout: DeskRoute }[];
  scoutOnlyWrong: { id: string; prompt: string; expected: DeskRoute; rules: DeskRoute; scout: DeskRoute }[];
}

/** Run the corpus through Scout once and score all four configurations from the same decisions. */
export async function evaluateRoutes(examples: readonly RouteExample[], scout: Scout): Promise<RouteEvaluation> {
  const decided: DeskRouteResult[] = [];
  for (const ex of examples) decided.push(await routeDeskQuestion(ex.prompt, { scout }));
  const flagged = (r: DeskRouteResult): boolean => r.flags.includes("instruction_in_question");
  const scoutFlagged = (r: DeskRouteResult): boolean => r.scout !== null && r.flags.includes("instruction_in_question") && !legacyRoute(r.scout.traceId).flags.length;
  void scoutFlagged;
  const scores = {
    off: score(examples, examples.map(() => ({ route: "read" as DeskRoute, flagged: false }))),
    rules: score(examples, examples.map((ex) => ({ route: legacyRoute(ex.prompt).route, flagged: legacyRoute(ex.prompt).flags.includes("instruction_in_question") }))),
    scout: score(examples, decided.map((r) => ({ route: r.scoutRoute ?? "unsafe", flagged: flagged(r) }))),
    default: score(examples, decided.map((r) => ({ route: r.route, flagged: flagged(r) }))),
  } satisfies Record<Config, ConfigScore>;
  const scoutAdds: RouteEvaluation["scoutAdds"] = [];
  const scoutOnlyWrong: RouteEvaluation["scoutOnlyWrong"] = [];
  examples.forEach((ex, i) => {
    const r = decided[i] as DeskRouteResult;
    const rules = r.rulesRoute;
    const sc = r.scoutRoute ?? "unsafe";
    if (rules !== ex.expected.route && sc === ex.expected.route) scoutAdds.push({ id: ex.id, prompt: ex.prompt, expected: ex.expected.route, rules, scout: sc });
    if (sc !== ex.expected.route && rules === ex.expected.route) scoutOnlyWrong.push({ id: ex.id, prompt: ex.prompt, expected: ex.expected.route, rules, scout: sc });
  });
  return { scores, scoutAdds, scoutOnlyWrong };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export function renderRouteEvaluation(e: RouteEvaluation, label: string, misses = 12): string {
  const c = e.scores.default.counts;
  const out = [`${label}: ${c.total} questions (${c.read} reads, ${c.nonRead} requests to change something, ${c.flagged} carrying instruction-like text)`, ""];
  out.push("                    accuracy  action read as read  read refused   recall: action  policy  unsafe   flags caught  clean flagged");
  for (const k of CONFIGS) {
    const s = e.scores[k];
    out.push(`${k.padEnd(18)} ${pct(s.accuracy).padStart(8)}  ${pct(s.action_as_read).padStart(19)}  ${pct(s.false_refusal).padStart(12)}   ${pct(s.recall.spend_action).padStart(14)} ${pct(s.recall.policy_change).padStart(7)} ${pct(s.recall.unsafe).padStart(7)}   ${pct(s.flag_recall).padStart(12)}  ${pct(s.flag_false_positive).padStart(13)}`);
  }
  out.push("", `Scout fixes ${e.scoutAdds.length} that the rules got wrong and breaks ${e.scoutOnlyWrong.length} that the rules got right (default = the stricter of the two).`);
  for (const m of e.scores.default.misses.slice(0, misses)) out.push(`  miss ${m.id}: ${m.expected} -> ${m.got}  ${JSON.stringify(m.prompt).slice(0, 100)}`);
  return out.join("\n");
}
