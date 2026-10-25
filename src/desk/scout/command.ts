import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { evaluate, loadThresholds, type Evaluation } from "../../scout-intent/eval.ts";
import { Scout } from "../../scout-intent/scout.ts";
import { REFUSAL } from "../ask/risk.ts";
import { CONFIGS, evaluateRoutes, loadRoutes, renderRouteEvaluation, type ConfigScore } from "./eval.ts";
import { SCOUT_RECORD } from "./info.ts";
import { createDeskScout, routeDeskQuestion } from "./router.ts";

const HARNESS = "evals/scout";

/** `desk scout "<question>"`: how the question would be routed, and why. Runs nothing else. */
export async function scoutQuestion(question: string): Promise<string> {
  if (question.trim() === "") return "Give a question, for example: desk scout \"Set the daily cap to $50\"";
  const scout = createDeskScout();
  const r = await routeDeskQuestion(question, { scout });
  const d = await scout.decide({ prompt: question, user: { id: "owner", role: "owner" }, surface: "ask" });
  const out = [`route: ${r.route}${r.route === "read" ? " (Ask plans and answers it)" : " (Ask refuses it)"}`];
  out.push(`  decided by: ${r.source === "both" ? "Scout and the older rules agree" : r.source === "scout" ? "Scout (the older rules would have read it)" : r.source === "rules" ? "the older rules (Scout read it)" : r.source}`);
  out.push(`  Scout: ${d.candidates.slice(0, 3).map((c) => `${c.intent} ${c.score.toFixed(2)}`).join(", ")}; band ${d.band}${d.clarification ? `; would ask ${d.clarification.trigger}: ${d.clarification.question}` : ""}`);
  if (d.injection) out.push(`  instruction-like text: ${d.injection.ids.join(", ")}; read as: ${JSON.stringify(d.injection.residual)}`);
  if (r.flags.length > 0) out.push(`  flags: ${r.flags.join(", ")}`);
  if (r.route !== "read") out.push(`  ${r.reason ?? REFUSAL[r.route]}`);
  return out.join("\n");
}

export interface ScoutEvalRecord {
  version: 1;
  /** The Meterless harness (v1 regression set, the specification's thresholds and the added measures) run against the Desk's Scout and the harness registry. */
  examples: number;
  metrics: Record<string, number>;
  gate: { pass: boolean; failures: string[]; notMet: string[] };
  /** The held-out paraphrase corpora written for the same registry. Dev was used to tune; test was read to report. */
  v2: Record<"dev" | "test", { examples: number; metrics: Record<string, number>; gate: { pass: boolean; failures: string[]; notMet: string[] }; misses: number }>;
  /** The Desk's own registry on its route corpus. */
  desk: Record<"dev" | "test", Record<(typeof CONFIGS)[number], Pick<ConfigScore, "accuracy" | "action_as_read" | "false_refusal" | "recall" | "flag_recall" | "flag_false_positive" | "counts">>>;
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const roundAll = (m: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, r3(v)]));

async function harness(corpus: string): Promise<Evaluation> {
  const scout = new Scout({ intentRegistry: join(HARNESS, "fixtures/intents.json"), policyPack: ["default", "adversarial-tight"] });
  return evaluate(scout, join(HARNESS, corpus), loadThresholds(join(HARNESS, "config/thresholds.yaml"), join(HARNESS, "config/thresholds-added.yaml")));
}

export async function scoutEvaluation(): Promise<{ record: ScoutEvalRecord; evaluations: { v1: Evaluation; dev: Evaluation; test: Evaluation }; routes: Record<"dev" | "test", Awaited<ReturnType<typeof evaluateRoutes>>> }> {
  const v1 = await harness("regression-set/v1");
  const dev = await harness("regression-set/v2/dev");
  const test = await harness("regression-set/v2/test");
  const routes = { dev: await evaluateRoutes(loadRoutes(join(HARNESS, "desk/dev/routes.jsonl")), createDeskScout()), test: await evaluateRoutes(loadRoutes(join(HARNESS, "desk/test/routes.jsonl")), createDeskScout()) };
  const pick = (e: Awaited<ReturnType<typeof evaluateRoutes>>): ScoutEvalRecord["desk"]["dev"] =>
    Object.fromEntries(CONFIGS.map((c) => {
      const s = e.scores[c];
      return [c, { accuracy: r3(s.accuracy), action_as_read: r3(s.action_as_read), false_refusal: r3(s.false_refusal), recall: roundAll(s.recall) as ConfigScore["recall"], flag_recall: r3(s.flag_recall), flag_false_positive: r3(s.flag_false_positive), counts: s.counts }];
    })) as ScoutEvalRecord["desk"]["dev"];
  const sum = (e: Evaluation): ScoutEvalRecord["v2"]["dev"] => ({ examples: e.examples, metrics: roundAll(e.metrics), gate: e.gate, misses: e.misses.length });
  const record: ScoutEvalRecord = { version: 1, examples: v1.examples, metrics: roundAll(v1.metrics), gate: v1.gate, v2: { dev: sum(dev), test: sum(test) }, desk: { dev: pick(routes.dev), test: pick(routes.test) } };
  return { record, evaluations: { v1, dev, test }, routes };
}

export async function scoutEvalCommand(o: { write: boolean }): Promise<string> {
  const { record, evaluations, routes } = await scoutEvaluation();
  const out: string[] = [];
  const show = (label: string, e: Evaluation): void => {
    out.push(`${label}: ${e.examples} examples; gate ${e.gate.pass ? "PASS" : "FAIL"}`);
    out.push(`  ${Object.entries(e.metrics).map(([k, v]) => `${k} ${v.toFixed(3)}`).join("  ")}`);
    for (const f of e.gate.failures.slice(0, 8)) out.push(`    below a hard line: ${f}`);
    for (const f of e.gate.notMet.slice(0, 6)) out.push(`    target not met: ${f}`);
  };
  show("Meterless harness v1 (the specification's thresholds)", evaluations.v1);
  out.push("");
  show("Paraphrase corpus for the harness registry, dev (tuned on)", evaluations.dev);
  out.push("");
  show("Paraphrase corpus for the harness registry, test (read to report)", evaluations.test);
  out.push("", renderRouteEvaluation(routes.dev, "Desk route corpus, dev (tuned on)", 0), "", renderRouteEvaluation(routes.test, "Desk route corpus, test (read to report)", 0));
  if (o.write) {
    mkdirSync(dirname(SCOUT_RECORD), { recursive: true });
    writeFileSync(SCOUT_RECORD, `${JSON.stringify(record, null, 2)}\n`);
    out.push("", `wrote ${SCOUT_RECORD}`);
  }
  return out.join("\n");
}
