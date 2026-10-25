import { existsSync, readFileSync } from "node:fs";

import type { CaptureDb } from "../capture/store.ts";
import { getTask } from "../capture/tasks.ts";
import { itemsOf } from "../replay/run.ts";
import type { ItemResult } from "../replay/agent.ts";
import { admit, type Admission, type ChannelStatus, type LabelledPair } from "./admission.ts";
import { krippendorffAlpha } from "./krippendorff.ts";
import { judgePair, lengthNormalised, panelId, validatePanel, type Judge, type PairResult, type Verdict } from "./panel.ts";

/**
 * Putting the panel to work on a swap (DF-038, DF-098). For every task and repeat in which both routes made a change, the two changes go to the panel, in both orders, with the
 * routes' names hidden. The baseline's change is A. The panel's score is used only when the panel has been admitted against the owner's own labels; until then a run can be made
 * for a look, marked advisory, and nothing it says is a score.
 */
export interface JudgeSpec {
  id: string;
  family: string;
  model: string;
}

export function loadJudgeSpecs(path: string): JudgeSpec[] {
  if (!existsSync(path)) throw new Error(`no judges file at ${path}. It lists the panel: { "judges": [ { "id": "g1", "family": "google", "model": "google/gemma-4-31b-it" } ] }`);
  const doc = JSON.parse(readFileSync(path, "utf8")) as { judges?: unknown };
  if (!Array.isArray(doc.judges)) throw new Error(`${path} has no "judges" list`);
  return doc.judges.map((j, i) => {
    const o = j as Record<string, unknown>;
    if (typeof o["id"] !== "string" || typeof o["family"] !== "string" || typeof o["model"] !== "string") throw new Error(`judge ${i + 1} in ${path} needs an id, a family and a model`);
    return { id: o["id"], family: o["family"], model: o["model"] };
  });
}

export function latestAdmission(db: CaptureDb, panel: string): { status: ChannelStatus; alpha: number | null; agreement: number | null; labels: number; at: string } | null {
  const row = db.prepare("SELECT status, alpha, agreement, labels, created_at FROM judge_admission WHERE panel_id = ? ORDER BY admission_id DESC LIMIT 1").get(panel) as { status: ChannelStatus; alpha: number | null; agreement: number | null; labels: number; created_at: string } | undefined;
  return row ? { status: row.status, alpha: row.alpha, agreement: row.agreement, labels: row.labels, at: row.created_at } : null;
}

export interface LabelFile {
  id: string;
  task: string;
  a: string;
  b: string;
  owner: Verdict;
}

export function readLabels(path: string): LabelFile[] {
  const doc = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const list = Array.isArray(doc) ? doc : (doc as { labels?: unknown }).labels;
  if (!Array.isArray(list)) throw new Error(`${path} should be a list of { id, task, a, b, owner } where owner is "A", "B" or "tie"`);
  return list.map((x, i) => {
    const o = x as Record<string, unknown>;
    if (typeof o["id"] !== "string" || typeof o["task"] !== "string" || typeof o["a"] !== "string" || typeof o["b"] !== "string" || !["A", "B", "tie"].includes(o["owner"] as string)) throw new Error(`label ${i + 1} in ${path} needs an id, a task, two changes a and b, and an owner verdict of A, B or tie`);
    return { id: o["id"], task: o["task"], a: o["a"], b: o["b"], owner: o["owner"] as Verdict };
  });
}

/** Judge the owner's labelled pairs, compare the panel with the owner, and keep what was found. */
export async function runAdmission(db: CaptureDb, judges: readonly Judge[], labels: readonly LabelFile[], underTest: readonly string[], now: () => Date = () => new Date()): Promise<Admission & { panel: string }> {
  validatePanel(judges, underTest);
  const pairs: LabelledPair[] = [];
  for (const l of labels) pairs.push({ id: l.id, owner: l.owner, panel: await judgePair(judges, { task: l.task, a: l.a, b: l.b }) });
  const a = admit(pairs);
  const panel = panelId(judges);
  const inserted = db.prepare("INSERT INTO judge_admission (panel_id, created_at, judges_json, status, alpha, agreement, labels, undecided, reasons_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(panel, now().toISOString(), JSON.stringify(judges.map((j) => ({ id: j.id, family: j.family, model: j.model }))), a.status, a.alpha, a.agreement, a.labels, a.undecided, JSON.stringify(a.reasons));
  // What the panel said about each pair, with the share of its valid judges that sided with its decision: what its confidence is calibrated on.
  for (const p of pairs) {
    const valid = p.panel.judges.filter((j) => j.verdict !== "grader_failed");
    const share = p.panel.decision === null || valid.length === 0 ? null : valid.filter((j) => j.verdict === p.panel.decision).length / valid.length;
    db.prepare("INSERT INTO judge_label (panel_id, admission_id, label_id, owner, decision, agreeing_share) VALUES (?, ?, ?, ?, ?, ?)").run(panel, Number(inserted.lastInsertRowid), p.id, p.owner, p.panel.decision, share);
  }
  return { ...a, panel };
}

export interface JudgedRun {
  panel: string;
  admission: ChannelStatus | "none";
  advisory: boolean;
  pairs: { taskId: string; repeat: number; decision: Verdict | null; why: string; baseline: number | null; normalised: number | null; penalised: boolean; inconsistent: number; failed: number }[];
  /** How far the judges agreed with one another over these pairs. */
  alpha: number | null;
  /** The share of decided pairs the baseline's change won, the length-normalised one beside the raw one, and the pairs that were not decided. */
  baselineWinRate: number | null;
  baselineWinRateLengthNormalised: number | null;
  undecided: number;
}

const testsOf = (i: ItemResult): number => i.failToPassPassed + i.passToPassPassed;

export async function judgeRun(db: CaptureDb, runId: string, judges: readonly Judge[], o: { baseline: string; candidate: string; advisory?: boolean; underTest: readonly string[]; limit?: number }): Promise<JudgedRun> {
  validatePanel(judges, o.underTest);
  const panel = panelId(judges);
  const adm = latestAdmission(db, panel);
  const admitted = adm !== null && (adm.status === "admitted" || adm.status === "flagged");
  if (!admitted && !o.advisory) throw new Error(adm === null ? `this panel (${panel}) has not been checked against your labels, so it scores nothing. desk judge admit --labels FILE checks it; --advisory looks without scoring.` : `this panel (${panel}) was excluded when it was checked (${adm.status}), so it scores nothing.`);
  const items = itemsOf(db, runId);
  const by = new Map<string, { a?: ItemResult; b?: ItemResult }>();
  for (const i of items) {
    if (i.status === "error" || i.status === "diverged") continue;
    const k = `${i.taskId}|${i.repeat}`;
    const e = by.get(k) ?? {};
    if (i.route === o.baseline) e.a = i;
    else if (i.route === o.candidate) e.b = i;
    by.set(k, e);
  }
  const pairs: JudgedRun["pairs"] = [];
  const units: (string | null)[][] = [];
  let seen = 0;
  for (const [k, e] of [...by.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    if (!e.a || !e.b) continue;
    if (o.limit !== undefined && seen >= o.limit) break;
    seen += 1;
    const [taskId, repeat] = k.split("|") as [string, string];
    const task = getTask(db, taskId);
    if (!task) continue;
    const r: PairResult = await judgePair(judges, { task: task.prompt, a: e.a.patch, b: e.b.patch });
    const norm = lengthNormalised(r.decision, { length: e.a.patch.length, tests: testsOf(e.a) }, { length: e.b.patch.length, tests: testsOf(e.b) });
    pairs.push({ taskId, repeat: Number(repeat), decision: r.decision, why: r.why, baseline: r.raw, normalised: norm.score, penalised: norm.penalised, inconsistent: r.judges.filter((j) => j.inconsistent).length, failed: r.judges.filter((j) => j.verdict === "grader_failed").length });
    units.push(r.judges.map((j) => (j.verdict === "grader_failed" ? null : j.verdict)));
    db.prepare(
      `INSERT OR REPLACE INTO judge_pair (run_id, task_id, repeat, panel_id, advisory, decision, why, baseline_score, baseline_score_length_normalised, length_penalised, inconsistent_judges, failed_judges, judges_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(runId, taskId, Number(repeat), panel, admitted ? 0 : 1, r.decision, r.why, r.raw, norm.score, norm.penalised ? 1 : 0, pairs[pairs.length - 1]!.inconsistent, pairs[pairs.length - 1]!.failed, JSON.stringify(r.judges));
  }
  const decided = pairs.filter((p) => p.baseline !== null);
  const mean = (xs: (number | null)[]): number | null => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
  };
  return {
    panel,
    admission: adm === null ? "none" : adm.status,
    advisory: !admitted,
    pairs,
    alpha: krippendorffAlpha(units).alpha,
    baselineWinRate: mean(decided.map((p) => p.baseline)),
    baselineWinRateLengthNormalised: mean(decided.map((p) => p.normalised)),
    undecided: pairs.length - decided.length,
  };
}

export function renderJudged(r: JudgedRun): string {
  const pct = (x: number | null): string => (x === null ? "no score" : `${(100 * x).toFixed(0)}%`);
  const lines = [r.advisory ? `ADVISORY: panel ${r.panel} has not been admitted (${r.admission}), so none of this is a score and none of it is in any report.` : `panel ${r.panel}, admitted against your labels (${r.admission}).`];
  lines.push(`${r.pairs.length} pairs of changes judged in both orders; ${r.undecided} without a decision.`);
  lines.push(`the baseline's change won ${pct(r.baselineWinRate)} of the decided pairs (${pct(r.baselineWinRateLengthNormalised)} when a win by a longer change with no better tests counts as a tie)`);
  lines.push(`the judges agreed with one another at alpha ${r.alpha === null ? "not defined" : r.alpha.toFixed(2)}`);
  const inconsistent = r.pairs.reduce((n, p) => n + p.inconsistent, 0);
  if (inconsistent > 0) lines.push(`${inconsistent} judge verdicts changed with the order the changes were shown in, and were counted as ties`);
  const penalised = r.pairs.filter((p) => p.penalised).length;
  if (penalised > 0) lines.push(`${penalised} wins went to the longer change with no better test result and were counted as ties`);
  return lines.join("\n");
}
