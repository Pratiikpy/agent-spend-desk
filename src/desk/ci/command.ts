import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readRows } from "../canary/store.ts";
import { loadSnapshot, type PriceSnapshot } from "../pricing/pricebook.ts";
import { ciGate, type CiResult } from "./gate.ts";

export interface CiCommandOptions {
  baselinePath: string;
  candidatePath: string;
  minDelta?: number;
  level?: number;
  errorRateMax?: number;
  minTasks?: number;
  maxCostIncrease?: number | null;
  pricesPath?: string;
  format: "text" | "json" | "markdown";
  /** A folder to write the evidence pack to: the verdict, the per-task table, the settings and the hash of each input. */
  evidenceDir?: string;
  /** What an inconclusive result does to the exit code. Default is 3: inconclusive is never a pass. */
  onInconclusive?: "fail" | "pass" | "inconclusive";
}

export interface CiCommandResult {
  /** 0 pass, 1 fail, 2 could not run, 3 inconclusive. */
  exitCode: 0 | 1 | 2 | 3;
  text: string;
  result?: CiResult;
}

const pct = (x: number | null, signed = false): string => (x === null ? "n/a" : `${signed && x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
const pts = (x: number | null): string => (x === null ? "n/a" : `${x >= 0 ? "+" : "-"}${Math.abs(x * 100).toFixed(1)} points`);
const sha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

function inRange(name: string, v: number | undefined, lo: number, hi: number): string | null {
  return v === undefined || (Number.isFinite(v) && v >= lo && v <= hi) ? null : `${name} must be between ${lo} and ${hi}, got ${v}`;
}

export function renderCiText(r: CiResult): string {
  const q = r.quality;
  const out = [r.headline, ""];
  out.push(`Quality: ${q.verdict}. ${q.reason}.`);
  if (q.delta !== null) out.push(`  ${q.tasks} paired tasks: pass rate ${pct(q.baselineMean)} to ${pct(q.candidateMean)}, change ${pts(q.delta)}${q.ci ? `, interval ${pts(q.ci.low)} to ${pts(q.ci.high)}` : ""}${q.heldOutDelta !== null ? `, held-out half ${pts(q.heldOutDelta)}` : ""}.`);
  out.push(`Cost: ${r.cost.verdict === "not_evaluated" ? "not evaluated" : r.cost.verdict}. ${r.cost.reason}.`);
  for (const n of r.notes) out.push(`Note: ${n}.`);
  out.push("", "Exit codes: 0 pass, 1 fail, 2 could not run, 3 inconclusive (never a pass).");
  return out.join("\n");
}

export function renderCiMarkdown(r: CiResult): string {
  const q = r.quality;
  const rows = q.perTask.filter((t) => t.delta !== 0).slice(0, 10);
  const out = [`### Canary gate: ${r.verdict.toUpperCase()}`, "", r.headline.replace(/^[A-Z]+: /, ""), "", "| | Baseline | Candidate | Change |", "|---|---|---|---|"];
  out.push(`| Pass rate (${q.tasks} paired tasks) | ${pct(q.baselineMean)} | ${pct(q.candidateMean)} | ${pts(q.delta)}${q.ci ? ` (interval ${pts(q.ci.low)} to ${pts(q.ci.high)})` : ""} |`);
  if (r.cost.change !== null) out.push(`| Cost per attempt | $${((r.cost.baselineMicros ?? 0) / 1_000_000).toFixed(5)} | $${((r.cost.candidateMicros ?? 0) / 1_000_000).toFixed(5)} | ${pct(r.cost.change, true)}${r.cost.ci ? ` (interval ${pct(r.cost.ci.low, true)} to ${pct(r.cost.ci.high, true)})` : ""} |`);
  if (rows.length > 0) {
    out.push("", "Tasks that moved most:", "", "| Task | Baseline | Candidate |", "|---|---|---|");
    for (const t of rows) out.push(`| ${t.id} | ${pct(t.baseline)} | ${pct(t.candidate)} |`);
  }
  for (const n of r.notes) out.push("", `_${n}._`);
  out.push("", "_Inconclusive is never a pass: more attempts or more tasks are needed to call it._");
  return out.join("\n");
}

/** `desk ci`: the canary gate for a pipeline. Reads two run files, prints a verdict, and sets the exit code the pipeline acts on. */
export function ciCommand(o: CiCommandOptions): CiCommandResult {
  const bad =
    inRange("--min-delta", o.minDelta, 0, 1) ?? inRange("--level", o.level, 0.5, 0.9999) ?? inRange("--error-rate-max", o.errorRateMax, 0, 1) ?? inRange("--min-tasks", o.minTasks, 2, 1000) ??
    (o.maxCostIncrease === undefined || o.maxCostIncrease === null ? null : inRange("--max-cost-increase", o.maxCostIncrease, 0, 100));
  if (bad) return { exitCode: 2, text: `desk ci: ${bad}.` };
  for (const [name, p] of [["--baseline", o.baselinePath], ["--candidate", o.candidatePath]] as const) {
    if (!existsSync(p)) return { exitCode: 2, text: `desk ci: ${name} ${p} does not exist. The baseline is the canary runs recorded on the main branch; the candidate is the pack run on this change.` };
  }
  const b = readRows(o.baselinePath);
  const c = readRows(o.candidatePath);
  if (b.rows.length === 0) return { exitCode: 2, text: `desk ci: the baseline ${o.baselinePath} holds no usable canary rows (${b.skipped} lines were skipped).` };
  if (c.rows.length === 0) return { exitCode: 2, text: `desk ci: the candidate ${o.candidatePath} holds no usable canary rows (${c.skipped} lines were skipped).` };
  let snapshot: PriceSnapshot | null = null;
  if (o.maxCostIncrease !== undefined && o.maxCostIncrease !== null) {
    try {
      snapshot = loadSnapshot(o.pricesPath ?? "data/prices/anthropic-litellm-2026-10-22.json");
    } catch (e) {
      return { exitCode: 2, text: `desk ci: the price list could not be read (${e instanceof Error ? e.message : String(e)}), and a cost bound was asked for.` };
    }
  }
  const result = ciGate({
    baseline: b.rows,
    candidate: c.rows,
    ...(o.minDelta !== undefined ? { minDelta: o.minDelta } : {}),
    ...(o.level !== undefined ? { level: o.level } : {}),
    ...(o.errorRateMax !== undefined ? { errorRateMax: o.errorRateMax } : {}),
    ...(o.minTasks !== undefined ? { minTasks: o.minTasks } : {}),
    maxCostIncrease: o.maxCostIncrease ?? null,
    snapshot,
  });
  let exitCode: 0 | 1 | 2 | 3 = result.exitCode;
  const notes: string[] = [];
  if (result.verdict === "inconclusive" && o.onInconclusive === "fail") exitCode = 1;
  if (result.verdict === "inconclusive" && o.onInconclusive === "pass") {
    exitCode = 0;
    notes.push("The result is inconclusive. It exits 0 only because --on-inconclusive pass was given; that is not a pass.");
  }
  if (b.skipped > 0 || c.skipped > 0) notes.push(`${b.skipped} baseline and ${c.skipped} candidate lines were not usable and were skipped.`);
  if (o.evidenceDir !== undefined) {
    mkdirSync(o.evidenceDir, { recursive: true });
    const pack = {
      schema: "desk.ci-gate.v1",
      verdict: result.verdict,
      exit_code: exitCode,
      settings: { min_delta: o.minDelta ?? 0.03, level: o.level ?? 0.99, error_rate_max: o.errorRateMax ?? 0.05, min_tasks: o.minTasks ?? 12, max_cost_increase: o.maxCostIncrease ?? null, on_inconclusive: o.onInconclusive ?? "inconclusive" },
      inputs: { baseline: { path: o.baselinePath, sha256: sha(o.baselinePath), rows: b.rows.length }, candidate: { path: o.candidatePath, sha256: sha(o.candidatePath), rows: c.rows.length } },
      result,
    };
    writeFileSync(join(o.evidenceDir, "ci-gate.json"), `${JSON.stringify(pack, null, 2)}\n`);
    writeFileSync(join(o.evidenceDir, "ci-gate.md"), `${renderCiMarkdown(result)}\n`);
    notes.push(`Evidence written to ${join(o.evidenceDir, "ci-gate.json")} and ci-gate.md.`);
  }
  const body = o.format === "json" ? JSON.stringify({ exit_code: exitCode, ...result }, null, 2) : o.format === "markdown" ? renderCiMarkdown(result) : renderCiText(result);
  return { exitCode, text: o.format === "json" ? body : [body, ...notes.map((n) => (o.format === "markdown" ? `_${n}_` : n))].join("\n"), result };
}

/** A workflow step a pipeline can copy: runs the candidate pack on the change and gates on the exit code. */
export function ciWorkflowSnippet(): string {
  return [
    "# .github/workflows/canary-gate.yml: fails the pull request when the canary suite worsens or cost rises past 10%",
    "name: canary-gate",
    "on: pull_request",
    "jobs:",
    "  gate:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-node@v4",
    "        with: { node-version: 22 }",
    "      - run: npm ci",
    "      # The candidate pack: the canary tasks run on this change's model settings (the secrets are the pipeline's own).",
    "      - run: npm run desk -- canary run --runs candidate.jsonl",
    "        env: { MODEL_BASE_URL: ${{ secrets.MODEL_BASE_URL }}, MODEL_API_KEY: ${{ secrets.MODEL_API_KEY }}, NEMOTRON_MODEL: ${{ vars.CANDIDATE_MODEL }} }",
    "      # 0 pass, 1 fail, 3 inconclusive (never a pass), 2 could not run. The step fails on any non-zero exit.",
    "      - run: npm run desk -- ci --baseline data/desk/canary/runs.jsonl --candidate candidate.jsonl --max-cost-increase 0.10 --evidence ci-evidence --format markdown >> $GITHUB_STEP_SUMMARY",
    "      - uses: actions/upload-artifact@v4",
    "        if: always()",
    "        with: { name: ci-evidence, path: ci-evidence }",
  ].join("\n");
}
