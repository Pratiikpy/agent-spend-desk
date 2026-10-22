import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { configFromEnv } from "../../sponsors/zetaris/silo-port.ts";
import { ask } from "../ask/ask.ts";
import { CassettePort, portFromEnv, type ModelPort } from "../agents/model.ts";
import { Budget, ASK_LIVE, ASK_SAMPLE } from "../agents/budget.ts";
import { MemoryTrace } from "../agents/trace.ts";
import { ENGINE_NAMES, type EngineName } from "../engines/load.ts";
import { OwnerMemory } from "../engines/memory.ts";
import { SUPPORTED_QUESTIONS } from "../ask/plan-rules.ts";
import { ciSummary, fetchSiloFacts, reconcile } from "../silo/facts.ts";
import { readBundleDir } from "../verify/read-dir.ts";
import { verifyBundle } from "../verify/verify.ts";
import { OWN_RUNS, SAMPLE_RUNS } from "../canary/command.ts";
import { buildSeries, readRows, servedChanges } from "../canary/store.ts";
import { TASKS } from "../canary/tasks.ts";
import { DEFAULT_CONFIG, earliestCallDay, evaluateAt, makeContext } from "../canary/verdict.ts";
import { BadParam, type UiContext } from "./queries.ts";

export interface ExtraPaths {
  cassetteDir: string;
  memoryDir: string;
  dossiersDir: string;
  pendingDir: string;
}

function modelFor(ctx: UiContext, paths: ExtraPaths): { port: ModelPort | null; label: string } {
  if (ctx.mode === "sample") return { port: new CassettePort(paths.cassetteDir), label: "recorded replies (sample mode)" };
  try {
    return { port: portFromEnv({ ...ctx.env, SAMPLE_MODE: "false" }, paths.cassetteDir), label: "live model" };
  } catch {
    return { port: null, label: "no model configured: the rule planner and rule explainer run" };
  }
}

/** Ask the Desk. The ledger connection is read-only, so the answer is not recorded here; `desk ask` records. */
export async function askScreen(ctx: UiContext, paths: ExtraPaths, question: string, ablateRaw: string): Promise<object> {
  const q = question.trim();
  if (q.length > 500) throw new BadParam("the question is longer than 500 characters");
  const ablate = new Set<EngineName>();
  for (const name of ablateRaw.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (!(ENGINE_NAMES as readonly string[]).includes(name)) throw new BadParam(`unknown engine ${name.slice(0, 30)}`);
    ablate.add(name as EngineName);
  }
  const suggestions = SUPPORTED_QUESTIONS;
  if (q === "") return { state: "ok", question: "", suggestions, engines: [...ENGINE_NAMES] };
  const model = modelFor(ctx, paths);
  const trace = new MemoryTrace();
  const memory = await OwnerMemory.open({ persistDir: paths.memoryDir });
  const r = await ask({ db: ctx.db, question: q, ablate, port: model.port, memory, trace, record: false, budget: new Budget(ctx.mode === "sample" ? ASK_SAMPLE : ASK_LIVE) });
  const events = trace.events
    .filter((e) => ["desk.engine", "desk.step", "desk.audit", "revision.applied", "fallback.used", "desk.route", "desk.plan"].includes(e.event))
    .map((e) => ({ event: e.event, why: e.why, role: e.role ?? null, detail: e.detail }));
  return {
    state: "ok",
    question: q,
    suggestions,
    engines: [...ENGINE_NAMES],
    ablated: r.ablated,
    status: r.status,
    route: r.route,
    planner: r.planner,
    explainer: r.explainer,
    servedModel: r.servedModel,
    modelRoute: model.label,
    sentences: r.sentences.map((s) => ({ text: s.text, cites: s.cites })),
    note: r.note,
    steps: r.steps.map((s) => ({ id: s.id, op: s.op, specialist: s.specialist, engine: s.engine, rows: s.rowCount, queryHash: s.queryHash, resultHash: s.resultHash, unknowable: s.unknowable })),
    events,
  };
}

/** The three silos Zetaris joins, as the Desk reads them: live when configured, recorded in sample mode. */
export async function silosScreen(ctx: UiContext, paths: ExtraPaths): Promise<object> {
  const trace = new MemoryTrace();
  const sample = ctx.mode === "sample";
  const facts = await fetchSiloFacts({ sample, cassetteDir: paths.cassetteDir, record: false, config: sample ? null : configFromEnv(ctx.env), trace });
  const none = Object.values(facts.served).every((v) => v === "fallback");
  const rec = reconcile(ctx.db, facts.invoices);
  const ci = ciSummary(ctx.db, facts.prs);
  const lines = trace.events.filter((e) => e.event === "desk.ingest").map((e) => e.detail);
  return {
    state: "ok",
    sample,
    served: facts.served,
    reasons: facts.reasons,
    available: !none,
    headline: facts.headline,
    classes: { billedMicros: rec.billedMicros, estimatedOnlyMicros: rec.estimatedOnlyMicros, ledgerEstimatedMicros: rec.ledgerEstimatedMicros, billedShare: rec.billedShare, estimatedOfBilledMicros: rec.estimatedOfBilledMicros },
    teamMonths: rec.teamMonths,
    ci: facts.prs.length > 0 ? ci : null,
    skipped: facts.skipped,
    trace: lines,
    queries: ["invoices (S3-style file)", "pull requests (Postgres)", "roster (REST)"],
  };
}

interface Listed {
  id: string;
  createdAt: string | null;
  kind: string | null;
  sizeBytes: number;
  overall: string;
  levels: { id: string; name: string; status: string; findings: { code: string; detail: string }[]; notes: string[] }[];
  pinned: boolean;
  means: string;
  doesNotMean: string;
  error: string | null;
}

function dirSize(dir: string): number {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    n += st.isDirectory() ? dirSize(p) : st.size;
  }
  return n;
}

/** Signed dossiers on disk, each checked again now by the offline verifier, and requests still waiting for approval. */
export function dossiersScreen(paths: ExtraPaths): object {
  const bundles: Listed[] = [];
  if (existsSync(paths.dossiersDir)) {
    for (const id of readdirSync(paths.dossiersDir).sort().reverse()) {
      const dir = join(paths.dossiersDir, id);
      if (!statSync(dir).isDirectory()) continue;
      const base: Listed = { id, createdAt: null, kind: null, sizeBytes: dirSize(dir), overall: "FAIL", levels: [], pinned: false, means: "", doesNotMean: "", error: null };
      try {
        const files = readBundleDir(dir);
        const pinsPath = join(paths.dossiersDir, `${id}.pins.json`);
        const pins = existsSync(pinsPath) ? (JSON.parse(readFileSync(pinsPath, "utf8")) as unknown) : undefined;
        const report = verifyBundle(files, pins === undefined ? {} : { pins });
        let manifest: { kind?: string; created_at?: string } = {};
        try {
          manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))) as typeof manifest;
        } catch {
          /* the report already says what is wrong */
        }
        bundles.push({ ...base, createdAt: manifest.created_at ?? null, kind: manifest.kind ?? null, overall: report.overall, levels: report.levels.map((l) => ({ id: l.id, name: l.name, status: l.status, findings: l.findings, notes: l.notes })), pinned: report.pinned, means: report.means, doesNotMean: report.doesNotMean });
      } catch (e) {
        bundles.push({ ...base, error: e instanceof Error ? e.message.slice(0, 200) : "could not read this folder" });
      }
    }
  }
  const pending: { requestId: string; claims: string[]; ruleIds: string[] }[] = [];
  if (existsSync(paths.pendingDir)) {
    for (const id of readdirSync(paths.pendingDir)) {
      try {
        const pack = JSON.parse(readFileSync(join(paths.pendingDir, id, "pack.json"), "utf8")) as { card?: { claims?: string[] }; ruleIdsAdded?: string[] };
        if (!existsSync(join(paths.dossiersDir, id.slice(0, 8)))) pending.push({ requestId: id, claims: pack.card?.claims ?? [], ruleIds: pack.ruleIdsAdded ?? [] });
      } catch {
        /* a half-written request is not listed */
      }
    }
  }
  return { state: "ok", bundles, pending, verifyCommand: "node src/desk/verify/main.ts <folder> --pins <file>" };
}

/** The canary: pass rate per day for each arm, the verdict as of the last day, and what the verdict rests on. */
export function canaryScreen(ctx: UiContext): object {
  const path = ctx.mode === "sample" ? SAMPLE_RUNS : OWN_RUNS;
  const { rows } = readRows(path);
  const series = buildSeries(rows);
  if (!series) {
    return { state: "empty", reason: "No canary runs yet.", hint: `A canary needs ${DEFAULT_CONFIG.baselineDays} baseline days and two ${DEFAULT_CONFIG.windowDays}-day windows: nothing can be called before day ${earliestCallDay()}. Run \`desk canary run\` daily.` };
  }
  const days = series.days;
  const dates = new Map(rows.map((r) => [r.day, r.date]));
  const rate = (arm: "primary" | "control", day: number): number | null => {
    const r = rows.filter((x) => x.arm === arm && x.day === day && x.score !== null);
    return r.length === 0 ? null : r.reduce((a, x) => a + (x.score as number), 0) / r.length;
  };
  const line = (arm: "primary" | "control") => Array.from({ length: days }, (_, i) => ({ day: i + 1, date: dates.get(i + 1) ?? "", rate: rate(arm, i + 1) }));
  const v = evaluateAt(makeContext(series), days);
  const b = DEFAULT_CONFIG.baselineDays;
  const w = DEFAULT_CONFIG.windowDays;
  const meanOf = (arm: "primary" | "control", from: number, to: number): number | null => {
    const r = rows.filter((x) => x.arm === arm && x.day >= from && x.day <= to && x.score !== null);
    return r.length === 0 ? null : r.reduce((a, x) => a + (x.score as number), 0) / r.length;
  };
  const perTask = TASKS.map((t) => ({ id: t.id, cluster: t.cluster, baseline: taskMean(rows, "primary", t.id, 1, b), latest: taskMean(rows, "primary", t.id, days - w + 1, days) }));
  const last = v.control.length > 0 ? v.control[v.control.length - 1]!.reading : null;
  return {
    state: "ok",
    sample: ctx.mode === "sample",
    days,
    baselineDays: b,
    windowDays: w,
    earliestCallDay: earliestCallDay(),
    verdict: v.verdict,
    reason: v.reason,
    delta: v.delta,
    ci: v.ci,
    mde: v.mde,
    mdeVerdict: v.mdeVerdict,
    tasksUsed: v.tasksUsed,
    errorRate: v.errorRate,
    harnessUnchanged: v.harnessUnchanged,
    control: last ? { moved: last.moved, delta: last.delta, low: last.low, high: last.high, tasks: last.tasks } : null,
    controlRan: series.control !== null,
    notes: v.notes,
    primary: line("primary"),
    controlArm: series.control ? line("control") : null,
    baselineMean: { primary: meanOf("primary", 1, b), control: meanOf("control", 1, b) },
    latestMean: { primary: meanOf("primary", days - w + 1, days), control: meanOf("control", days - w + 1, days) },
    served: servedChanges(rows, "primary"),
    controlServed: servedChanges(rows, "control"),
    perTask,
    tasks: TASKS.length,
  };
}

function taskMean(rows: readonly { arm: string; taskId: string; day: number; score: 0 | 1 | null }[], arm: string, id: string, from: number, to: number): number | null {
  const r = rows.filter((x) => x.arm === arm && x.taskId === id && x.day >= from && x.day <= to && x.score !== null);
  return r.length === 0 ? null : r.reduce((a, x) => a + (x.score as number), 0) / r.length;
}
