import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { evaluate, loadThresholds, type Evaluation } from "../../scout-intent/eval.ts";
import { Scout, type TextEmbedder } from "../../scout-intent/scout.ts";
import { SUPPORTED_QUESTIONS } from "../ask/plan-rules.ts";
import { REFUSAL } from "../ask/risk.ts";
import { embedderFromEnv } from "../embed/env.ts";
import { CassetteEmbedder, DEFAULT_EMBED_MODEL, type Embedder } from "../embed/port.ts";
import { loadRecallCases } from "../engines/recall-eval.ts";
import { CONFIGS, evaluateRoutes, loadRoutes, renderRouteEvaluation, type ConfigScore, type RouteEvaluation } from "./eval.ts";
import { SCOUT_RECORD } from "./info.ts";
import { createDeskScout, routeDeskQuestion } from "./router.ts";
import { readdirSync, readFileSync } from "node:fs";

const HARNESS = "evals/scout";
const CASSETTES = "data/sample/cassettes";

/** `desk scout "<question>"`: how the question would be routed, and why. Runs nothing else. */
export async function scoutQuestion(question: string, embedder: TextEmbedder | null = null): Promise<string> {
  if (question.trim() === "") return "Give a question, for example: desk scout \"Set the daily cap to $50\"";
  const scout = createDeskScout({ embedder });
  const r = await routeDeskQuestion(question, { scout });
  const d = await scout.decide({ prompt: question, user: { id: "owner", role: "owner" }, surface: "ask" });
  const out = [`route: ${r.route}${r.route === "read" ? " (Ask plans and answers it)" : " (Ask refuses it)"}`];
  out.push(`  decided by: ${r.source === "both" ? "Scout and the older rules agree" : r.source === "scout" ? "Scout (the older rules would have read it)" : r.source === "rules" ? "the older rules (Scout read it)" : r.source}`);
  out.push(`  Scout: ${d.candidates.slice(0, 3).map((c) => `${c.intent} ${c.score.toFixed(2)}`).join(", ")}; band ${d.band}${d.clarification ? `; would ask ${d.clarification.trigger}: ${d.clarification.question}` : ""}`);
  out.push(`  second stage: ${d.stage2 === "embedded" ? `vectors from ${d.embedder}` : d.stage2 === "degraded" ? `the built-in comparison, because the embedder failed (${d.degradedBecause ?? "no reason given"})` : d.stage2 === "skipped" ? "off" : "the built-in text comparison"}`);
  if (d.injection) out.push(`  instruction-like text: ${d.injection.ids.join(", ")}; read as: ${JSON.stringify(d.injection.residual)}`);
  if (r.flags.length > 0) out.push(`  flags: ${r.flags.join(", ")}`);
  if (r.route !== "read") out.push(`  ${r.reason ?? REFUSAL[r.route]}`);
  return out.join("\n");
}

type Gate = { pass: boolean; failures: string[]; notMet: string[] };
type DeskScores = Record<"dev" | "test", Record<(typeof CONFIGS)[number], Pick<ConfigScore, "accuracy" | "action_as_read" | "false_refusal" | "recall" | "flag_recall" | "flag_false_positive" | "counts">>>;

/** One full measurement: the Meterless harness's gate on its regression set, the paraphrases written for its registry, and the Desk's own route corpus. */
export interface ScoutBlock {
  examples: number;
  metrics: Record<string, number>;
  gate: Gate;
  v2: Record<"dev" | "test", { examples: number; metrics: Record<string, number>; gate: Gate; misses: number }>;
  desk: DeskScores;
}

export interface ScoutEvalRecord {
  version: 2;
  /** With the built-in character-trigram comparison, which needs no key and no network. */
  standIn: ScoutBlock;
  /** With a real embedder's recorded vectors, or null when none are recorded. The question sets are the same; dev was used to tune and test was read to report. */
  embedded: (ScoutBlock & { model: string }) | null;
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const roundAll = (m: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, r3(v)]));

async function harness(corpus: string, embedder: TextEmbedder | null): Promise<Evaluation> {
  const scout = new Scout({ intentRegistry: join(HARNESS, "fixtures/intents.json"), policyPack: ["default", "adversarial-tight"], ...(embedder ? { embedder } : {}) });
  return evaluate(scout, join(HARNESS, corpus), loadThresholds(join(HARNESS, "config/thresholds.yaml"), join(HARNESS, "config/thresholds-added.yaml")));
}

export interface ScoutMeasurement {
  block: ScoutBlock;
  evaluations: { v1: Evaluation; dev: Evaluation; test: Evaluation };
  routes: Record<"dev" | "test", RouteEvaluation>;
}

export async function measureScout(embedder: TextEmbedder | null): Promise<ScoutMeasurement> {
  const v1 = await harness("regression-set/v1", embedder);
  const dev = await harness("regression-set/v2/dev", embedder);
  const test = await harness("regression-set/v2/test", embedder);
  const routes = {
    dev: await evaluateRoutes(loadRoutes(join(HARNESS, "desk/dev/routes.jsonl")), createDeskScout({ embedder })),
    test: await evaluateRoutes(loadRoutes(join(HARNESS, "desk/test/routes.jsonl")), createDeskScout({ embedder })),
  };
  const pick = (e: RouteEvaluation): DeskScores["dev"] =>
    Object.fromEntries(
      CONFIGS.map((c) => {
        const s = e.scores[c];
        return [c, { accuracy: r3(s.accuracy), action_as_read: r3(s.action_as_read), false_refusal: r3(s.false_refusal), recall: roundAll(s.recall) as ConfigScore["recall"], flag_recall: r3(s.flag_recall), flag_false_positive: r3(s.flag_false_positive), counts: s.counts }];
      }),
    ) as DeskScores["dev"];
  const sum = (e: Evaluation): ScoutBlock["v2"]["dev"] => ({ examples: e.examples, metrics: roundAll(e.metrics), gate: e.gate, misses: e.misses.length });
  return { block: { examples: v1.examples, metrics: roundAll(v1.metrics), gate: v1.gate, v2: { dev: sum(dev), test: sum(test) }, desk: { dev: pick(routes.dev), test: pick(routes.test) } }, evaluations: { v1, dev, test }, routes };
}

/** The recorded vectors, or null when there are none for the default model. */
export function recordedEmbedder(dir = CASSETTES, model = DEFAULT_EMBED_MODEL): CassetteEmbedder | null {
  const c = new CassetteEmbedder(dir, model);
  return anyRecording(dir, model) ? c : null;
}

function anyRecording(dir: string, model: string): boolean {
  const prefix = `embed-${model.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}-`;
  try {
    return readdirSync(dir).some((f) => f.startsWith(prefix));
  } catch {
    return false;
  }
}

export async function scoutEvaluation(): Promise<{ record: ScoutEvalRecord; standIn: ScoutMeasurement; embedded: ScoutMeasurement | null; embeddedError: string | null }> {
  const standIn = await measureScout(null);
  const emb = recordedEmbedder();
  let embedded: ScoutMeasurement | null = null;
  let embeddedError: string | null = null;
  if (emb) {
    try {
      embedded = await measureScout(emb);
      if (embedded.evaluations.v1.examples === 0) embedded = null;
      else if (!everyDecisionEmbedded(embedded)) embeddedError = "some decisions fell back to the built-in comparison: the recording is missing vectors for texts the corpora now ask for; run: npm run desk -- scout record";
    } catch (e) {
      embeddedError = (e as Error).message;
    }
  }
  const record: ScoutEvalRecord = { version: 2, standIn: standIn.block, embedded: embedded && embeddedError === null ? { model: emb?.id ?? DEFAULT_EMBED_MODEL, ...embedded.block } : null };
  return { record, standIn, embedded, embeddedError };
}

/** True when the recording held every vector the corpora asked for. A decision that fell back to the built-in comparison is counted in the evaluation, so it has to be refused here. */
function everyDecisionEmbedded(m: ScoutMeasurement): boolean {
  return m.routes.dev.degraded === 0 && m.routes.test.degraded === 0 && m.evaluations.v1.degraded === 0 && m.evaluations.dev.degraded === 0 && m.evaluations.test.degraded === 0;
}

function showEvaluation(label: string, e: Evaluation, out: string[]): void {
  out.push(`${label}: ${e.examples} examples; gate ${e.gate.pass ? "PASS" : "FAIL"}`);
  out.push(`  ${Object.entries(e.metrics).map(([k, v]) => `${k} ${v.toFixed(3)}`).join("  ")}`);
  for (const f of e.gate.failures.slice(0, 8)) out.push(`    below a hard line: ${f}`);
  for (const f of e.gate.notMet.slice(0, 6)) out.push(`    target not met: ${f}`);
}

export async function scoutEvalCommand(o: { write: boolean }): Promise<string> {
  const { record, standIn, embedded, embeddedError } = await scoutEvaluation();
  const out: string[] = ["With the built-in character-trigram comparison", ""];
  showEvaluation("Meterless harness v1 (the specification's thresholds)", standIn.evaluations.v1, out);
  out.push("");
  showEvaluation("Paraphrase corpus for the harness registry, dev (tuned on)", standIn.evaluations.dev, out);
  out.push("");
  showEvaluation("Paraphrase corpus for the harness registry, test (read to report)", standIn.evaluations.test, out);
  out.push("", renderRouteEvaluation(standIn.routes.dev, "Desk route corpus, dev (tuned on)", 0), "", renderRouteEvaluation(standIn.routes.test, "Desk route corpus, test (read to report)", 0));
  if (embedded) {
    out.push("", `With recorded ${DEFAULT_EMBED_MODEL} vectors${embeddedError ? ` (NOT RECORDED in the file: ${embeddedError})` : ""}`, "");
    showEvaluation("Meterless harness v1", embedded.evaluations.v1, out);
    out.push("");
    showEvaluation("Paraphrase corpus for the harness registry, dev (tuned on)", embedded.evaluations.dev, out);
    out.push("");
    showEvaluation("Paraphrase corpus for the harness registry, test (read to report)", embedded.evaluations.test, out);
    out.push("", renderRouteEvaluation(embedded.routes.dev, "Desk route corpus, dev (tuned on)", 0), "", renderRouteEvaluation(embedded.routes.test, "Desk route corpus, test (read to report)", 0));
  } else out.push("", "No recorded embedding vectors: run npm run desk -- scout record (needs NVIDIA_API_KEY) to measure with a real embedder.");
  if (o.write) {
    mkdirSync(dirname(SCOUT_RECORD), { recursive: true });
    writeFileSync(SCOUT_RECORD, `${JSON.stringify(record, null, 2)}\n`);
    out.push("", `wrote ${SCOUT_RECORD}${record.embedded ? "" : " (without embedded results)"}`);
  }
  return out.join("\n");
}

function corpusPrompts(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith(".jsonl")) for (const line of readFileSync(p, "utf8").split("\n")) if (line.trim() !== "") out.push((JSON.parse(line) as { prompt: string }).prompt);
    }
  };
  walk(join(HARNESS, "regression-set"));
  walk(join(HARNESS, "desk"));
  return out;
}

/**
 * Record the embedding vectors the evaluation and the sample-mode Ask screen need: the registries' examples as passages, and every prompt the corpora (and the screen's suggested
 * questions) will put to a decision, as the exact texts the decision embeds. Needs a live endpoint. Texts already recorded are not asked for again, so an interrupted run resumes.
 */
export async function recordEmbeddings(env: Record<string, string | undefined>, dir = CASSETTES): Promise<string> {
  const choice = embedderFromEnv(env, dir, { sampleMode: false, record: true, force: true });
  const embedder: Embedder | null = choice.embedder;
  if (!embedder) return `Nothing recorded: ${choice.label}. Set NVIDIA_API_KEY and NVIDIA_BASE_URL (or DESK_EMBED_API_KEY and DESK_EMBED_BASE_URL).`;
  const fixture = new Scout({ intentRegistry: join(HARNESS, "fixtures/intents.json"), policyPack: ["default", "adversarial-tight"] });
  const desk = createDeskScout();
  const queries = new Set<string>();
  const passages = new Set<string>();
  const take = (s: Scout, prompts: readonly string[]): void => {
    for (const p of prompts) {
      const t = s.embeddingTexts(p);
      t.queries.forEach((q) => queries.add(q));
      t.passages.forEach((x) => passages.add(x));
    }
  };
  const all = corpusPrompts();
  take(fixture, all);
  take(desk, [...all, ...SUPPORTED_QUESTIONS]);
  // The owner's-notes recall questions: the notes as passages, the questions as queries.
  for (const split of ["dev", "test"] as const) {
    const { notes, cases } = loadRecallCases(split);
    notes.forEach((n) => passages.add(n.content));
    cases.forEach((c) => queries.add(c.question));
  }
  // The registries' passages go in once each, whichever Scout asked for them.
  const before = { passages: passages.size, queries: queries.size };
  await embedder.embed([...passages], "passage", 120_000);
  await embedder.embed([...queries], "query", 600_000);
  return `recorded ${before.passages} passage texts and ${before.queries} query texts with ${embedder.id} into ${dir} (${choice.label})`;
}
