import { existsSync, readFileSync } from "node:fs";

import { ask } from "../ask/ask.ts";
import { ablation } from "../bench/ablation.ts";
import { RESULTS_FILE_D, RESULTS_FILE_E } from "../bench/command.ts";
import { readResults } from "../bench/run.ts";
import { OwnerMemory } from "../engines/memory.ts";
import { runYearCheck } from "../engines/year-check.ts";
import { scoutEvaluation } from "../scout/command.ts";
import type { EngineName } from "../engines/load.ts";
import { MemoryTrace } from "../agents/trace.ts";
import { configFromEnv } from "../../sponsors/zetaris/silo-port.ts";
import { ciSummary, fetchSiloFacts, reconcile } from "../silo/facts.ts";
import type { Ledger } from "../ledger/db.ts";
import type { Truth } from "../sample/gen.ts";
import { formatUsd } from "../money.ts";
import { input, measured, notVerified, ofN, pct, pValue, type Metric, type Section } from "./model.ts";

const CONFORMANCE = "data/sample/engines/conformance.json";
const SILO_CASSETTES = "data/sample/cassettes";
const CURSOR_LOG = "docs/sponsors/cursor-usage-log.md";

type Answer = Awaited<ReturnType<typeof ask>>;
const textOf = (r: Answer): string => r.sentences.map((s) => s.text).join(" ") + (r.note ? ` ${r.note}` : "");

/**
 * What each Meterless engine changes in an answer. The same question is asked with the engine on and off; an engine whose switch-off changes nothing is dropped from the claims,
 * and the section says so. The Markovian engine is asked a year of questions with the truth worked out from the rows.
 */
export async function enginesSection(db: Ledger, truth: Truth): Promise<Section> {
  const metrics: Metric[] = [];
  const findings: string[] = [];
  const dropped: string[] = [];
  const asked = async (question: string, ablate: EngineName[], memory?: OwnerMemory): Promise<Answer> => ask({ db, question, port: null, record: false, ablate: new Set(ablate), ...(memory ? { memory } : {}), trace: new MemoryTrace() });

  // World Model: what changed before a date. The sample has one planted change, a new tool version on a known day, so the answer can be graded.
  const wmQ = "What changed before 2026-10-15?";
  const wmOn = await asked(wmQ, []);
  const wmOff = await asked(wmQ, ["world_model"]);
  const planted = truth.plantedChange;
  const plantedDay = planted.atIso.slice(0, 10);
  const statesPlanted = (r: Answer): boolean => r.sentences.some((x) => x.text.includes(planted.toolVersion) && x.text.includes(plantedDay));
  metrics.push(measured("engines.world_model.on", "World Model on: status, sentences, and states the planted tool-version change on its day", `${wmOn.status}, ${wmOn.sentences.length}, ${statesPlanted(wmOn) ? "yes" : "no"}`));
  metrics.push(measured("engines.world_model.off", "World Model off: status, sentences, and states the planted change", `${wmOff.status}, ${wmOff.sentences.length}, ${statesPlanted(wmOff) ? "yes" : "no"}`));
  if (statesPlanted(wmOn) && !statesPlanted(wmOff)) findings.push(`World Model: asked "${wmQ}", the answer with the engine has ${wmOn.sentences.length} sentences and states the tool version planted on ${plantedDay}; without it the question is ${wmOff.status}.`);
  else dropped.push("World Model");

  // H-MEM: an owner's definition of "landed" used in an answer, and the owner's own words recalled.
  let t = Date.UTC(2026, 9, 20, 9, 0, 0);
  const memory = await OwnerMemory.open({ clock: () => (t += 60_000) });
  memory.remember({ content: "Landed means committed, merged or kept.", kind: "outcome_definition" });
  memory.remember({ content: "Work on the billing module counts as landed once it is merged and the checks are green.", kind: "note" });
  const hmQ = "How much of our spend landed?";
  const hmOn = await asked(hmQ, [], memory);
  const hmOff = await asked(hmQ, ["hmem"], memory);
  const statesDefinition = (r: Answer): boolean => /committed, merged or kept/.test(textOf(r));
  metrics.push(measured("engines.hmem.on", "H-MEM on: the answer states the owner's definition of landed", statesDefinition(hmOn) ? "yes" : "no"));
  metrics.push(measured("engines.hmem.off", "H-MEM off: the answer states the owner's definition of landed", statesDefinition(hmOff) ? "yes" : "no"));
  const recallQ = "What did I tell you about landed work?";
  const recOn = await asked(recallQ, [], memory);
  const recOff = await asked(recallQ, ["hmem"], memory);
  const wordsOn = recOn.yourWords?.length ?? 0;
  metrics.push(measured("engines.hmem.recall", `H-MEM on and off: the owner's notes returned for "${recallQ}"`, `${wordsOn}, ${recOff.yourWords?.length ?? 0}`, `with the engine off the Desk says: ${recOff.note ?? recOff.status}`));
  const unrelated = await asked("What did I tell you about the weather in Paris?", [], memory);
  metrics.push(measured("engines.hmem.recall-unrelated", "H-MEM on: notes returned for a question no note is about", String(unrelated.yourWords?.length ?? 0)));
  if ((statesDefinition(hmOn) && !statesDefinition(hmOff)) || (wordsOn > 0 && (recOff.yourWords?.length ?? 0) === 0)) {
    findings.push(`H-MEM: with a definition of landed remembered, the answer to "${hmQ}" ${statesDefinition(hmOn) ? "states it" : "does not state it"} with the engine and ${statesDefinition(hmOff) ? "states it" : "does not state it"} without; "${recallQ}" returns ${wordsOn} of the owner's notes with the engine and none without, and a question no note is about returns ${unrelated.yourWords?.length ?? 0}.`);
  } else dropped.push("H-MEM");

  // Markovian: a twelve-month ledger and five year-long questions, truth from the rows.
  const year = await runYearCheck();
  const on = year.rows.filter((r) => r.on.holds).length;
  const off = year.rows.filter((r) => r.off.holds).length;
  metrics.push(measured("engines.markovian.on", "Markovian on: year-long answers matching the rows", ofN(on, year.rows.length)));
  metrics.push(measured("engines.markovian.off", "Markovian off: year-long answers matching the rows", ofN(off, year.rows.length)));
  metrics.push(measured("engines.markovian.carry", "Markovian: largest state carried, against its budget (estimated tokens)", `${year.engine.maxCarryoverTokens} of ${year.engine.carryoverBudgetTokens}`));
  metrics.push(measured("engines.markovian.saved", "Markovian: tokens saved over carrying the whole history, on this ledger", `${year.engine.tokensSaved}`, "the periods are smaller than the state that carries them, so nothing is saved at this size"));
  if (on > off) findings.push(`Markovian: on a generated twelve-month ledger of ${year.calls.toLocaleString("en-US")} calls, ${on} of ${year.rows.length} year-long answers match the rows with the engine and ${off} without it. The carry stays inside its budget and does not grow with the range; at this size it saves no tokens.`);
  else dropped.push("Markovian");

  // Scout Intent: the router that reads a request before Ask plans anything. Measured on the questions written for the Desk, with the engine on, the older rules alone, and the engine off.
  const scout = await scoutEvaluation();
  const sc = (split: "dev" | "test") => scout.routes[split].scores;
  const ts = sc("test");
  const d = sc("dev");
  const share = (x: number): string => pct(Math.round(x * 1000), 1000);
  metrics.push(measured("engines.scout_intent.test.accuracy", `Scout Intent: ${ts.default.counts.total} test questions routed to the right kind, with Scout, with the older rules alone, with Scout off`, `${share(ts.default.accuracy)}, ${share(ts.rules.accuracy)}, ${share(ts.off.accuracy)}`, "the test split was written before tuning and is reported, not tuned on"));
  metrics.push(measured("engines.scout_intent.test.action_as_read", `Scout Intent: of ${ts.default.counts.nonRead} test requests to change spend or policy or to reveal something, the share that reach the planner as questions: with Scout, rules alone, Scout off`, `${share(ts.default.action_as_read)}, ${share(ts.rules.action_as_read)}, ${share(ts.off.action_as_read)}`));
  metrics.push(measured("engines.scout_intent.test.false_refusal", `Scout Intent: of ${ts.default.counts.read} plain test questions about the ledger, the share refused`, `${share(ts.default.false_refusal)}, ${share(ts.rules.false_refusal)}`, "with Scout, rules alone"));
  metrics.push(measured("engines.scout_intent.test.recall", "Scout Intent: test requests caught, by kind (spend change, policy change, unsafe), with Scout", `${share(ts.default.recall.spend_action)}, ${share(ts.default.recall.policy_change)}, ${share(ts.default.recall.unsafe)}`));
  metrics.push(measured("engines.scout_intent.test.flags", `Scout Intent: of ${ts.default.counts.flagged} test questions that carry instruction-like text, the share flagged; of the clean ones, the share flagged anyway`, `${share(ts.default.flag_recall)}, ${share(ts.default.flag_false_positive)}`));
  metrics.push(measured("engines.scout_intent.dev.accuracy", `Scout Intent: the ${d.default.counts.total} development questions the router was tuned on, same three settings`, `${share(d.default.accuracy)}, ${share(d.rules.accuracy)}, ${share(d.off.accuracy)}`, "tuned on, so higher than it would be on questions nobody has looked at"));
  const v1 = scout.evaluations.v1;
  const v2 = scout.evaluations.test;
  metrics.push(measured("engines.scout_intent.harness.v1", `Scout Intent: the Meterless harness's gate on its ${v1.examples}-example regression set`, v1.gate.pass ? "pass" : "fail", "the examples are the registry's own prompts, so this shows the harness runs, not that routing generalises"));
  metrics.push(measured("engines.scout_intent.harness.v2", `Scout Intent: the Meterless harness's gate on ${v2.examples} paraphrases written for its registry (intent top-1, top-3, tool precision)`, `${v2.gate.pass ? "pass" : "fail"}: ${v2.metrics["intent_top1"]?.toFixed(3)}, ${v2.metrics["intent_top3_recall"]?.toFixed(3)}, ${v2.metrics["tool_precision"]?.toFixed(3)}`, `hard lines missed: ${v2.gate.failures.length}; the specification asks for intent top-1 of 0.85 or more`));
  if (ts.default.action_as_read < ts.rules.action_as_read) {
    findings.push(`Scout Intent: on ${ts.default.counts.total} test questions (${ts.default.counts.read} plain, ${ts.default.counts.nonRead} that ask for a change or a secret) ${share(ts.default.action_as_read)} of the requests reach the planner as questions with Scout, ${share(ts.rules.action_as_read)} with the older word rules alone and ${share(ts.off.action_as_read)} with Scout off; ${share(ts.default.false_refusal)} of the plain questions are refused. The router reads the request before any step runs, and on a failure it refuses.`);
  } else dropped.push("Scout Intent");

  // Conformance of the three vendored engines, recorded by `desk prove`.
  if (existsSync(CONFORMANCE)) {
    const rec = JSON.parse(readFileSync(CONFORMANCE, "utf8")) as { source: string; results: { engine: string; passed: number; total: number; expected: number }[] };
    for (const r of rec.results) metrics.push(measured(`engines.conformance.${r.engine}`, `${r.engine}: the vendored engine's own conformance checks passed`, ofN(r.passed, r.total), r.total === r.expected ? undefined : `expected ${r.expected}`));
    findings.push(`The three vendored engines pass their own conformance runners (${rec.results.map((r) => `${r.engine} ${r.passed}/${r.total}`).join(", ")}) against ${rec.source}.`);
  }
  if (dropped.length > 0) findings.push(`${dropped.join(" and ")}: switching the engine off changed nothing on these questions, so it is dropped from the claims.`);
  return {
    id: "engines",
    title: "What each Meterless engine changes in an answer",
    question: "Asked the same question with the engine on and off, does the answer change, and is the changed answer the right one?",
    reproduce: ["npm run desk -- prove", "npm run desk -- engines year", "npm run desk -- ask \"What changed before 2026-10-15?\" --sample --ablate world_model"],
    seed: 20261030,
    inputs: [input("src/desk/sample/year.ts"), input("evals/scout/desk/dev/routes.jsonl"), input("evals/scout/desk/test/routes.jsonl"), input("evals/scout/regression-set/v1/"), input("evals/scout/regression-set/v2/"), input("src/desk/scout/registry.ts")],
    metrics,
    findings,
    limits: [
      "Scout Intent is the Desk's own implementation of Meterless's specification (Meterless ships no reference code for it): its second stage is a hashed character-trigram stand-in for the specification's embedding, with the weights changed to match, and the question sets were written by the people who built the router.",
      "The three vendored engines are the Meterless reference implementations vendored into this repository, with the Desk's own wrappers. The Markovian chunk generator is code, not a language model.",
      "Each comparison is a handful of questions on a constructed ledger. They show the engine changes the answer, not how often it would on a real one.",
      "The twelve-month ledger is generated from a seed; no real user's year has been read.",
    ],
  };
}

/** Zetaris: the organisation's sources behind an agent bill, with and without it. Read from the recorded statements, so it needs no running Zetaris. */
export async function zetarisSection(db: Ledger): Promise<Section> {
  const run = async (disabled: boolean) => {
    const trace = new MemoryTrace();
    const facts = await fetchSiloFacts({ sample: true, cassetteDir: SILO_CASSETTES, record: false, config: configFromEnv({}), disabled, trace });
    return { facts, rec: reconcile(db, facts.invoices), ci: ciSummary(db, facts.prs) };
  };
  const on = await run(false);
  const off = await run(true);
  const served = (r: typeof on): string => Object.values(r.facts.served).join("/");
  const metrics: Metric[] = [
    measured("zetaris.on.served", "Zetaris on: how the four statements were served", served(on)),
    measured("zetaris.off.served", "Zetaris off: how the four statements were served", served(off)),
    measured("zetaris.on.billed", "Billed share of the ledger's list-price estimate, with Zetaris", pct(Math.round(on.rec.billedShare * 1000), 1000), `${formatUsd(on.rec.billedMicros)} of invoice amounts`),
    measured("zetaris.off.billed", "Billed share, without Zetaris", pct(Math.round(off.rec.billedShare * 1000), 1000), "every figure is an estimate"),
    measured("zetaris.on.teams", "Teams in the spend-per-landed-pull-request table, with and without Zetaris", `${on.facts.headline.length}, ${off.facts.headline.length}`),
    measured("zetaris.on.prs", "Pull requests with known CI facts, with and without Zetaris", `${on.facts.prs.length}, ${off.facts.prs.length}`),
  ];
  const findings = [
    on.facts.headline.length > 0 && off.facts.headline.length === 0
      ? `With Zetaris the Desk joins invoices, CI and the team roster: ${pct(Math.round(on.rec.billedShare * 1000), 1000)} of the ledger is covered by invoices, ${on.facts.headline.length} teams have a spend-per-landed-pull-request figure, and ${on.facts.prs.length} pull requests have CI facts. Without it the invoice share is ${pct(Math.round(off.rec.billedShare * 1000), 1000)} and the table is empty.`
      : "Switching Zetaris off did not change the table, so it is dropped from the claims.",
  ];
  return {
    id: "zetaris",
    title: "What Zetaris changes",
    question: "With the organisational silos behind Zetaris and without them, what can the Desk say about the bill?",
    reproduce: ["npm run desk -- silos --sample", "npm run desk -- silos --sample --no-zetaris"],
    seed: null,
    inputs: [input(`${SILO_CASSETTES}/`)],
    metrics,
    findings,
    limits: [
      "The silos are three synthetic sources seeded from the sample ledger. The statements are replayed from recordings made against a local Zetaris instance; this page does not run Zetaris.",
      "A fallback is labelled and never partial rows: with Zetaris off the Desk says what it could not join.",
    ],
  };
}

/** The model against the rule brain, read from the two benchmark sets. */
export function modelSection(): Section {
  const rowsE = readResults(RESULTS_FILE_E);
  const rowsD = readResults(RESULTS_FILE_D);
  const served = [...new Set([...rowsE, ...rowsD].filter((r) => r.arm === "A2" || r.arm === "A1" || r.arm === "A0").map((r) => r.servedModel).filter((m): m is string => m !== null))].sort();
  const a7 = ablation(rowsE).find((r) => r.arm === "A7");
  const metrics: Metric[] = [measured("model.served", "Model that served the recorded runs", served.join(", ") || "none recorded")];
  const findings: string[] = [];
  if (a7) {
    metrics.push(measured("model.planner", "Planner is the model, against the rule planner: exact answers", `${a7.arms.reference.exact} of ${a7.arms.reference.n}, ${a7.arms.arm.exact} of ${a7.arms.arm.n}`, `exact McNemar p ${pValue(a7.exact.p)}`));
    findings.push(`Replacing the model Planner with the rule planner leaves ${a7.arms.arm.exact} of ${a7.arms.arm.n} questions exact against ${a7.arms.reference.exact} of ${a7.arms.reference.n} (${a7.finding}). The rule planner cannot compute a share, an average or a count of days.`);
  }
  metrics.push(notVerified("model.tool_call_rate", "Tool-calling success rate of the model through the provider", "the rate is not published; the benchmark rows record answers, not tool-call attempts"));
  return {
    id: "model",
    title: "The model against the rule brain",
    question: "On the same questions, how much of the result depends on the language model?",
    reproduce: ["npm run desk -- bench report --set E --db data/desk/sample/ledger.db"],
    seed: 20261028,
    inputs: [input(RESULTS_FILE_E), input(RESULTS_FILE_D)],
    metrics,
    findings,
    limits: ["One model family, as served by the provider named above. A different model was not run.", "Latency is not compared: recorded seconds for arms that share a request with the full Desk are replay times."],
  };
}

/** The Cursor log: how many sessions of real use are written down. */
export function cursorSection(path: string = CURSOR_LOG): Section {
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  // A session is a row of the log table that starts with a date.
  const sessions = (text.match(/^\|\s*\d{4}-\d{2}-\d{2}\b/gm) ?? []).length;
  const metrics: Metric[] =
    sessions > 0
      ? [measured("cursor.sessions", "Cursor sessions written down in the usage log", String(sessions))]
      : [notVerified("cursor.sessions", "Cursor sessions written down in the usage log", "the log holds no session; nothing here claims Cursor was used")];
  return {
    id: "cursor",
    title: "Cursor",
    question: "Is there a written record of the product being built in Cursor?",
    reproduce: [`read ${path}`],
    seed: null,
    inputs: [input(path)],
    metrics,
    findings: sessions > 0 ? [`The usage log lists ${sessions} sessions.`] : ["The usage log is empty. No claim about Cursor is made on this page."],
    limits: ["Counts the sessions in the file. It does not show what was done in them."],
  };
}

