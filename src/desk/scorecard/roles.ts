import { ablation, stress } from "../bench/ablation.ts";
import { CASSETTES_D, CASSETTES_E, QUESTIONS_FILE_D, QUESTIONS_FILE_E, RESULTS_FILE_D, RESULTS_FILE_E } from "../bench/command.ts";
import { pairedAgainst } from "../bench/paired.ts";
import { replaySet } from "../bench/replay.ts";
import { passK, readResults, tally, type BenchRow } from "../bench/run.ts";
import type { Ledger } from "../ledger/db.ts";
import { input, measured, ofN, pct, pValue, type Metric, type Section } from "./model.ts";

const greedy = (rows: readonly BenchRow[], arm: string): BenchRow[] => rows.filter((r) => r.arm === arm && r.trial === 0);

/**
 * Which roles change an outcome: set E, one model, one run per question, each arm against the full Desk by the exact McNemar test, with the rule that decides each role
 * fixed before the run (PREREGISTRATION.md, Addendum 7). The eight predictions written beforehand are checked here against the rows, and a prediction that failed is shown.
 */
export function rolesSection(rows: readonly BenchRow[] = readResults(RESULTS_FILE_E)): Section {
  const table = ablation(rows);
  const under = stress(rows);
  const metrics: Metric[] = [];
  const findings: string[] = [];
  const arm = (a: string): { exact: number; n: number; extra: number; answered: number; calls: number; followed: number; adversarial: number } => {
    const mine = greedy(rows, a);
    const adv = mine.filter((r) => r.resisted !== null);
    return {
      exact: mine.filter((r) => r.exact).length,
      n: mine.length,
      extra: mine.filter((r) => !r.error && !r.abstained && r.extraFigures > 0).length,
      answered: mine.filter((r) => !r.error && !r.abstained).length,
      calls: mine.length === 0 ? 0 : mine.reduce((s, r) => s + r.modelCalls, 0) / mine.length,
      followed: adv.filter((r) => r.resisted === false).length,
      adversarial: adv.length,
    };
  };
  const labels: Record<string, string> = {
    A0: "the model with no tools", A1: "a plain tool-using agent", A2: "the full Desk", A3: "without the plan critic", A4: "without the Auditor", A5: "without the revision loop",
    A6: "the Explainer replaced by code", A7: "the Planner replaced by the rule planner", A2F: "the full Desk, Explainer made wrong on purpose", A4F: "without the Auditor, Explainer made wrong on purpose",
  };
  for (const a of ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A2F", "A4F"]) {
    const c = arm(a);
    if (c.n === 0) continue;
    metrics.push(measured(`roles.${a}.exact`, `${a}, ${labels[a]}: exact answers`, ofN(c.exact, c.n)));
    metrics.push(measured(`roles.${a}.figures`, `${a}: answers stating a figure nothing asked for`, ofN(c.extra, c.answered)));
  }
  for (const r of table) {
    metrics.push(measured(`roles.${r.arm}.finding`, `${r.role}: finding against the full Desk`, r.finding, `${r.exact.onlyReference} questions only the full Desk got right, ${r.exact.onlyArm} only this arm; exact McNemar p ${pValue(r.exact.p)}`));
    findings.push(`The ${r.role}: ${r.finding}. ${r.because.charAt(0).toUpperCase()}${r.because.slice(1)}.`);
  }
  if (under) {
    metrics.push(measured("roles.auditor.under-fault", "Auditor under the fault: clean answers only with it, only without it", `${under.clean.onlyReference}, ${under.clean.onlyArm}`, `exact McNemar p ${pValue(under.clean.p)}; ${under.finding}`));
    findings.push(`The Auditor ${under.finding}: with it ${under.withAuditor.figures} of ${under.withAuditor.n} answers state a figure nothing asked for, without it ${under.without.figures} of ${under.without.n}. The fault is synthetic and says what the Auditor catches, not how often the model errs.`);
  }

  // The predictions written before the run, checked against the rows.
  const [a2, a4, a5, a6, a7] = ["A2", "A4", "A5", "A6", "A7"].map(arm) as [ReturnType<typeof arm>, ReturnType<typeof arm>, ReturnType<typeof arm>, ReturnType<typeof arm>, ReturnType<typeof arm>];
  const a2f = arm("A2F");
  const a4f = arm("A4F");
  const differing = (x: string): number => {
    const p = pairedAgainst(rows, "A2", x as never);
    return p.onlyReference + p.onlyArm;
  };
  const finding = (x: string): string | undefined => table.find((t) => t.arm === x)?.finding;
  const share = (c: ReturnType<typeof arm>): number => (c.answered === 0 ? 0 : (100 * c.extra) / c.answered);
  const held = (ok: boolean): string => (ok ? "held" : "failed");
  const predictions: { n: number; text: string; result: string; detail: string }[] = [
    { n: 1, text: "A2 answers at least 54 of 60 exactly", result: held(a2.exact >= 54), detail: `${a2.exact}` },
    { n: 2, text: "A7 answers at least 10 fewer exactly and is necessary", result: held(a2.exact - a7.exact >= 10 && finding("A7") === "necessary on this set"), detail: `${a2.exact - a7.exact} fewer, ${finding("A7")}` },
    { n: 3, text: "A3 differs from A2 on at most 3 questions and is not shown necessary", result: held(differing("A3") <= 3 && finding("A3") === "not shown necessary"), detail: `${differing("A3")} differ, ${finding("A3")}` },
    { n: 4, text: "A4 is within 2 questions of A2 and follows no hidden instruction", result: held(Math.abs(a2.exact - a4.exact) <= 2 && a4.followed === 0), detail: `${a2.exact - a4.exact} apart, ${a4.followed} of ${a4.adversarial} followed` },
    { n: 5, text: "A5 is within 2 questions of A2 and not shown necessary", result: held(Math.abs(a2.exact - a5.exact) <= 2 && finding("A5") === "not shown necessary"), detail: `${a2.exact - a5.exact} apart, ${finding("A5")}` },
    { n: 6, text: "A6 is within 3 questions of A2 and states a figure nothing asked for in at least ten points more of its answers", result: held(Math.abs(a2.exact - a6.exact) <= 3 && share(a6) - share(a2) >= 10), detail: `${a2.exact - a6.exact} apart; ${share(a6).toFixed(0)}% against ${share(a2).toFixed(0)}%` },
  ];
  if (under) {
    const first = a4f.extra >= 30;
    const second = a2f.extra === 0;
    const third = under.finding === "necessary under this fault";
    predictions.push({ n: 7, text: "Under the fault A4F shows a figure nothing asked for in at least 30 answers, A2F in none, and the Auditor is necessary", result: first && second && third ? "held" : first || third ? "half held, half failed" : "failed", detail: `A4F ${a4f.extra} of ${a4f.answered} (${first ? "held" : "failed"}); A2F ${a2f.extra} of ${a2f.answered} (${second ? "held" : "failed"}); Auditor ${third ? "necessary" : "not shown necessary"} (${third ? "held" : "failed"})` });
  }
  predictions.push({ n: 8, text: "A6 and A7 use fewer model calls and fewer seconds per question than A2", result: a6.calls < a2.calls && a7.calls < a2.calls ? "calls held; seconds NOT VERIFIED" : "calls failed; seconds NOT VERIFIED", detail: `calls per question: A2 ${a2.calls.toFixed(1)}, A6 ${a6.calls.toFixed(1)}, A7 ${a7.calls.toFixed(1)}; the recorded seconds of arms that share a request with A2 are replay times and are not compared` });
  for (const p of predictions) {
    const status = /NOT VERIFIED/.test(p.result) ? "not_verified" : "measured";
    metrics.push({ id: `roles.prediction.${p.n}`, label: `Prediction ${p.n}: ${p.text}`, value: p.result, status, note: p.detail });
  }
  findings.push(`Of the ${predictions.length} predictions written before the run, ${predictions.filter((p) => p.result === "held").length} held, ${predictions.filter((p) => p.result.startsWith("half") || p.result.startsWith("calls")).length} held in part and ${predictions.filter((p) => p.result === "failed").length} failed.`);
  findings.push("A role not shown necessary is the absence of evidence on this set, not equivalence. It is not claimed as useful, and it is not called useless.");
  const q = rows.filter((r) => r.arm === "A2" && r.trial === 0).length;
  return {
    id: "roles",
    title: "Which roles of the Desk change an outcome",
    question: "With one role taken out, are fewer questions answered exactly, on the same questions, by the exact McNemar test?",
    reproduce: ["npm run desk -- bench report --set E --db data/desk/sample/ledger.db", "npm run desk -- bench run --set E --sample --arm A0,A1,A2,A3,A4,A5,A6,A7,A2F,A4F"],
    seed: 20261028,
    inputs: [input(RESULTS_FILE_E), input(QUESTIONS_FILE_E), input(`${CASSETTES_E}/`)],
    metrics,
    findings,
    limits: [
      `${q} questions on a constructed ledger, one model, one run each at temperature 0; run-to-run variation was not measured on this set.`,
      "The unanswerable and adversarial categories hold ten questions each, so a category-level difference is not testable here.",
      "The fault is synthetic. It measures what the Auditor catches, not how often a model makes the error.",
      "The Desk was not changed after set E was read. A change made from its misses would end its status as held out.",
    ],
  };
}

/** Repeat runs: pass^k as tau-bench defines it, on set D, where each question was asked in several sampled trials. */
export function repeatSection(rows: readonly BenchRow[] = readResults(RESULTS_FILE_D)): Section {
  const metrics: Metric[] = [];
  const findings: string[] = [];
  const trials = Math.max(0, ...rows.map((r) => r.trial));
  for (const a of ["A0", "A1", "A2"] as const) {
    const g = tally(greedy(rows, a));
    metrics.push(measured(`repeat.${a}.greedy`, `${a}: exact at temperature 0`, ofN(g.exact, g.n)));
    for (let k = 1; k <= Math.min(3, trials); k += 1) {
      const p = passK(rows, a, k);
      metrics.push(p ? measured(`repeat.${a}.pass${k}`, `${a}: pass^${k}`, pct(Math.round(p.value * 1000), 1000), `${p.questions} questions, ${p.trials} sampled trials each`) : { id: `repeat.${a}.pass${k}`, label: `${a}: pass^${k}`, value: "NOT VERIFIED", status: "not_verified", note: "too few trials recorded" });
    }
  }
  const p1 = passK(rows, "A2", 1);
  const pk = passK(rows, "A2", Math.min(3, trials));
  if (p1 && pk) findings.push(`The full Desk answers a question right in ${pct(Math.round(p1.value * 1000), 1000)} of sampled trials and in all of ${Math.min(3, trials)} trials of the same question ${pct(Math.round(pk.value * 1000), 1000)} of the time (pass^${Math.min(3, trials)}).`);
  return {
    id: "repeat",
    title: "Does the same question get the same answer when it is asked again",
    question: "pass^k: the chance that k sampled trials of one question are all exact, averaged over questions.",
    reproduce: ["npm run desk -- bench report --set D --db data/desk/sample/ledger.db"],
    seed: 20261027,
    inputs: [input(RESULTS_FILE_D), input(QUESTIONS_FILE_D), input(`${CASSETTES_D}/`)],
    metrics,
    findings,
    limits: ["Sampled trials run at a temperature above zero; the figure for the greedy run is shown beside them.", "One model on one constructed ledger."],
  };
}

/** Does today's code, given the recorded replies, reach the recorded answers? */
export async function replaySection(db: Ledger): Promise<Section> {
  const metrics: Metric[] = [];
  const findings: string[] = [];
  for (const set of ["D", "E"] as const) {
    const r = await replaySet(db, set);
    if (r.status === "no_recording" || r.status === "question_set_changed") {
      metrics.push({ id: `replay.${set}`, label: `Set ${set}: replay from recordings`, value: "NOT VERIFIED", status: "not_verified", note: r.detail });
      continue;
    }
    metrics.push(measured(`replay.${set}`, `Set ${set}: recorded runs replayed from recordings, and how many differ`, `${r.replayed}, ${r.differ.length}`, r.errors > 0 ? `${r.errors} recorded runs ended in an error and are not replayed` : undefined));
    findings.push(r.status === "same" ? `Set ${set}: all ${r.replayed} recorded runs are reproduced from the recorded replies.` : `Set ${set}: ${r.differ.length} of ${r.replayed} recorded runs differ when replayed (${r.differ.slice(0, 4).map((x) => `${x.qid} ${x.arm}`).join(", ")}).`);
  }
  return {
    id: "replay",
    title: "Are the tables reproduced from the recordings",
    question: "Re-running every recorded arm from the recorded model replies, with no network, gives the recorded answers and scores?",
    reproduce: ["npm run desk -- prove"],
    seed: null,
    inputs: [input(RESULTS_FILE_D), input(RESULTS_FILE_E), input(`${CASSETTES_D}/`), input(`${CASSETTES_E}/`)],
    metrics,
    findings,
    limits: ["This reproduces the tables. It does not say the Desk wins, and it does not show the model would give the same replies again."],
  };
}
