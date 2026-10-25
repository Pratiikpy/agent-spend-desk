import { readFileSync } from "node:fs";

import { CassettePort } from "../agents/model.ts";
import { perturbProgram } from "../ask/perturb.ts";
import { runA2 } from "../bench/arms.ts";
import { CASSETTES_E, QUESTIONS_FILE_E } from "../bench/command.ts";
import { buildQuestions } from "../bench/questions.ts";
import { attributionReliability, type FateTruth } from "../calibrate/attribution.ts";
import type { Ledger } from "../ledger/db.ts";
import { parsePolicyYaml } from "../policy/parse.ts";
import { loadSnapshot } from "../pricing/pricebook.ts";
import { fuzzRestrictCheck } from "../prove/fuzz.ts";
import { propose } from "../propose/run.ts";
import { replaySessionsFromLedger } from "../replay/from-ledger.ts";
import { input, measured, notApplicable, ofN, pct, type Metric, type Section } from "./model.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const SET_E_SEED = 20261028;
const FUZZ_SEED = 20261022;
const FUZZ_PAIRS = 3000;

/**
 * Do the citations hold the answer up, and does the answer come from the ledger? Every question of set E is answered again from the recordings, and for each answer the
 * Desk's own checks are read: each cited claim is taken away in turn to see whether the sentence still passes, and the answer's steps are run again after a known call is added
 * to the ledger inside the dates it covers, inside a savepoint that is rolled back.
 */
export async function faithfulnessSection(db: Ledger): Promise<Section> {
  const questions = buildQuestions(db, SET_E_SEED, "E");
  const port = new CassettePort(CASSETTES_E);
  let answered = 0;
  let sentences = 0;
  let citations = 0;
  let essential = 0;
  let decorative = 0;
  const verdicts = { pass: 0, fail: 0, not_run: 0 };
  const failed: string[] = [];
  for (const q of questions) {
    const out = await runA2({ db, port, question: q.text });
    if (out.error || !out.faithfulness) continue;
    answered += 1;
    sentences += out.faithfulness.sentences.length;
    citations += out.faithfulness.essential + out.faithfulness.decorative;
    essential += out.faithfulness.essential;
    decorative += out.faithfulness.decorative;
    if (out.program) {
      const r = await perturbProgram(db, out.program, q.id);
      verdicts[r.verdict] += 1;
      if (r.verdict === "fail") failed.push(q.id);
    }
  }
  const metrics: Metric[] = [
    measured("faithfulness.answers", "Answers written from the recordings (the rest were refused or unknowable)", ofN(answered, questions.length)),
    measured("faithfulness.sentences", "Sentences, and citations they carry", `${sentences}, ${citations}`),
    measured("faithfulness.needed", "Citations the sentence needs, and citations that are decoration", `${essential}, ${decorative}`),
    measured("faithfulness.perturbation", "Answers whose figures moved when a known call was added, held when it was added outside their dates, and could not be tested", `${verdicts.pass}, ${verdicts.fail} failed, ${verdicts.not_run}`),
  ];
  const findings = [
    `Of ${citations} citations on ${sentences} sentences in ${answered} answers, ${essential} were needed by the sentence that made them and ${decorative} were decoration.`,
    `Perturbation: ${verdicts.pass} answers read the ledger as it should (moved with a call inside their dates, held with one outside), ${verdicts.fail} did not${failed.length > 0 ? ` (${failed.join(", ")})` : ""}, ${verdicts.not_run} had nothing to perturb (a recalled note, a refusal).`,
  ];
  return {
    id: "faithfulness",
    title: "Do the citations hold the answer up",
    question: "Does each cited claim matter to its sentence, and do the answer's figures come from the ledger and not from the model?",
    reproduce: ["npm run desk -- scorecard", "npm run desk -- ask <question> --sample"],
    seed: SET_E_SEED,
    inputs: [input(QUESTIONS_FILE_E), input(`${CASSETTES_E}/`)],
    metrics,
    findings,
    limits: [
      "Necessity is read by the code Auditor: it says whether the sentence still passes without a claim, not whether a reader would still believe it.",
      "The exact movement rule is held for spend steps only; for other steps a figure that moved shows the answer reads the ledger, not that it reads the right rows.",
      "Steps with no dates are not perturbed.",
    ],
  };
}

/** The checks a hostile or careless policy edit has to get past. */
export async function attacksSection(db: Ledger): Promise<Section> {
  const fuzz = fuzzRestrictCheck({ pairs: FUZZ_PAIRS, seed: FUZZ_SEED });
  const broken = fuzzRestrictCheck({ pairs: 400, seed: FUZZ_SEED }, (() => ({ narrows: true, routeChanges: [], gridSize: 0, mergedDims: [], outsideFragment: false })) as never);
  const sessions = replaySessionsFromLedger(db, loadSnapshot(PRICES), "0000", "9999", { personFromBranch: true });
  const current = parsePolicyYaml(readFileSync("policies/daily-cap.yaml", "utf8"));
  const run = await propose({ current, sessions, splitMs: Date.UTC(2026, 9, 1), targetMinMicros: 2_000_000, port: null });
  const metrics: Metric[] = [
    measured("attacks.fuzz.pairs", "Policy edit pairs checked against an independent oracle, and pairs that narrow the policy", `${fuzz.pairs}, ${fuzz.narrowing}`),
    measured("attacks.fuzz.escapes", "Edits the restrict-only check let through that widen the policy, and edits it wrongly refused", `${fuzz.escapes.length}, ${fuzz.misses.length}`),
    measured("attacks.fuzz.control", "A checker that always says \"narrows\": pairs on which it is caught", ofN(broken.escapes.length, 400)),
    measured("attacks.evasions", "Evasions of a drafted policy found by probing, closed, and left standing", `${run.hardened.closed.length + run.hardened.unresolved.length}, ${run.hardened.closed.length}, ${run.hardened.unresolved.length}`),
    measured("attacks.landed-blocked", "Landed sessions the hardened policy would block in the held-out period", ofN(run.heldOut.landedBlocked.length, run.heldOutSessions)),
  ];
  const findings = [
    `The restrict-only check agreed with an independent oracle on ${fuzz.pairs} policy edits (${fuzz.narrowing} narrowing): ${fuzz.escapes.length} widening edits got through and ${fuzz.misses.length} narrowing edits were refused. A checker that always says "narrows" is caught on ${broken.escapes.length} of 400 pairs, so the fuzzer can see an escape.`,
    `A drafted policy was probed for ways round it: ${run.hardened.closed.length} closed by a rule change that still narrows the policy, ${run.hardened.unresolved.length} left standing and shown on the approval card.`,
  ];
  return {
    id: "attacks",
    title: "Do policy attacks survive",
    question: "Can an edited policy widen what is allowed without the check noticing, and can a drafted rule be stepped round?",
    reproduce: ["npm run desk -- prove", "npm run desk -- propose --sample --no-model"],
    seed: FUZZ_SEED,
    inputs: [input("policies/daily-cap.yaml"), input("src/desk/prove/fuzz.ts")],
    metrics,
    findings,
    limits: [
      "The fuzzer generates policies from the checker's own grammar; an edit outside that grammar is not tried.",
      "The probing is code, run with the rule brain. A model attacker reading the same draft was not run for this page.",
    ],
  };
}

/** Does the stated confidence of a link mean what it says? The levels are words, so there is no expected calibration error to report. */
export function calibrationSection(db: Ledger, truth: readonly FateTruth[]): Section {
  const r = attributionReliability(db, truth);
  const metrics: Metric[] = [];
  for (const l of r.levels) metrics.push(measured(`calibration.${l.level}`, `${l.level}: links that are right`, `${l.right} of ${l.n}`, l.n === 0 ? undefined : `${pct(l.right, l.n)}, 95% interval ${(l.low * 100).toFixed(1)}% to ${(l.high * 100).toFixed(1)}%`));
  metrics.push(measured("calibration.ordered", "High is at least as reliable as medium, and medium as low", r.ordered ? "yes" : "no"));
  metrics.push(measured("calibration.state", "Linked sessions whose landing state matches the planted fate", ofN(r.stateRight, r.stateTotal)));
  metrics.push(notApplicable("calibration.ece", "Expected calibration error", "the confidence levels are words, not probabilities; a reliability table is reported instead, and no error is computed from them"));
  return {
    id: "calibration",
    title: "Does confidence mean what it says",
    question: "When the Desk ties a session to a commit and calls the link high, medium or low, how often is it right?",
    reproduce: ["npm run desk -- calibrate --sample"],
    seed: null,
    inputs: [input("src/desk/calibrate/attribution.ts")],
    metrics,
    findings: [`Linked at each level against the planted truth of the constructed sample: ${r.levels.filter((l) => l.n > 0).map((l) => `${l.level} ${l.right} of ${l.n}`).join(", ")}. The levels ${r.ordered ? "are" : "are not"} ordered as their names promise.`],
    limits: ["Planted truth exists only in the constructed sample. On a real ledger the same table needs landing to be known, and on this machine's ledger it is known for a small share of sessions."],
  };
}
