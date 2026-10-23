import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { configFromEnv } from "../../sponsors/zetaris/silo-port.ts";
import { filesFor, setARows } from "../bench/command.ts";
import { ARMS, passK, readResults, tally, type BenchRow } from "../bench/run.ts";
import { COVERAGE_FILE, CONTROL_FILE } from "../calibrate/command.ts";
import { attributionReliability } from "../calibrate/attribution.ts";
import type { TunnelCoverage } from "../calibrate/windtunnel.ts";
import { OWN_RUNS, SAMPLE_RUNS } from "../canary/command.ts";
import { readRows } from "../canary/store.ts";
import { LEARNING_REPORT, type StoredReport } from "../lessons/command.ts";
import { openRegret, scoreDecisions } from "../regret/regret.ts";
import { replaySessionsFromLedger } from "../replay/from-ledger.ts";
import { routeReplay } from "../route/replay.ts";
import { seatReturn } from "../seats/seats.ts";
import { fetchSiloFacts } from "../silo/facts.ts";
import type { ExtraPaths } from "./extra.ts";
import type { UiContext } from "./queries.ts";

/** Everything the Desk has measured about itself, read from what is recorded. Each block says plainly when it is not. */
type Block<T> = ({ state: "ok" } & T) | { state: "missing"; hint: string };

function guarded<T>(hint: string, f: () => T): Block<T> | { state: "missing"; hint: string } {
  try {
    return { state: "ok", ...(f() as object) } as Block<T>;
  } catch (e) {
    return { state: "missing", hint: `${hint} (${e instanceof Error ? e.message.slice(0, 120) : "unreadable"})` };
  }
}

function benchBlock(): object {
  const cell = (rows: BenchRow[], arm: string): { exact: number; n: number } => {
    const c = tally(rows.filter((r) => r.arm === arm && (r.trial ?? 0) === 0));
    return { exact: c.exact, n: c.n };
  };
  const a = filesFor("A");
  const b = filesFor("B");
  const rowsA = existsSync(a.results) ? setARows().rows : [];
  const rowsB = existsSync(b.results) ? readResults(b.results) : [];
  return {
    setA: rowsA.length === 0 ? null : ARMS.map((arm) => ({ arm, ...cell(rowsA, arm) })),
    setB: rowsB.length === 0 ? null : ARMS.map((arm) => ({ arm, ...cell(rowsB, arm), pass3: ((): number | null => { const p = passK(rowsB.filter((r) => (r.trial ?? 0) > 0), arm, 3); return p ? p.value : null; })() })),
  };
}

export async function evidenceScreen(ctx: UiContext, paths: ExtraPaths): Promise<object> {
  const runs = ctx.mode === "sample" ? SAMPLE_RUNS : OWN_RUNS;
  const sessions = replaySessionsFromLedger(ctx.db, ctx.snapshot, "0000", "9999", { personFromBranch: ctx.mode === "sample" });

  const route = guarded("Route replay needs recorded canary runs.", () => {
    const report = existsSync(runs) ? routeReplay(readRows(runs).rows, { tolerance: 0.1 }) : null;
    if (!report) throw new Error("fewer than two models in the recorded tasks");
    return {
      strongModel: report.strongModel,
      cheapModel: report.cheapModel,
      delta: report.delta,
      low: report.interval.low,
      high: report.interval.high,
      tolerance: report.tolerance,
      clusters: report.clusters.map((c) => ({ cluster: c.cluster, tasks: c.tasks, chosenDrop: c.chosenDrop, confirmedDrop: c.confirmedDrop, routable: c.routable })),
      tokens: report.tokens,
    };
  });

  let seats: object;
  try {
    const facts = await fetchSiloFacts({ sample: ctx.mode === "sample", cassetteDir: paths.cassetteDir, record: false, config: configFromEnv(ctx.env), disabled: false });
    if (facts.roster.length === 0 || sessions.length === 0) seats = { state: "missing", hint: "Seat return needs the Zetaris roster and sessions in the ledger." };
    else {
      const asOfMs = Math.max(...sessions.map((s) => s.startMs));
      seats = { state: "ok", windowDays: 21, lines: seatReturn(sessions, facts.roster, { asOfMs, windowDays: 21 }).map((l) => ({ team: l.team, plan: l.seatPlan, seats: l.seats, active: l.activePeople, idle: l.idleSeats, idleUsd: l.idleUsdPerMonth })) };
    }
  } catch (e) {
    seats = { state: "missing", hint: `Seat return could not read the roster (${e instanceof Error ? e.message.slice(0, 100) : "error"}).` };
  }

  const truthPath = join(paths.sampleDir, "truth.json");
  const links = guarded("Link confidence is checked against planted truth, which only the constructed sample has.", () => {
    if (!existsSync(truthPath)) throw new Error("no truth file");
    const truth = (JSON.parse(readFileSync(truthPath, "utf8")) as { sessions: { id: string; fate: "landed" | "unlanded" | "reverted" }[] }).sessions;
    const r = attributionReliability(ctx.db, truth);
    return { levels: r.levels.map((l) => ({ level: l.level, n: l.n, rate: l.rate, low: l.low, high: l.high })), ordered: r.ordered, stateRight: r.stateRight, stateTotal: r.stateTotal };
  });

  const coverage = (file: string): object | null => (existsSync(file) ? (() => { const c = JSON.parse(readFileSync(file, "utf8")) as TunnelCoverage; return { control: c.control === true, trials: c.trials.length, inside: c.inside, coverage: c.coverage, low: c.low, high: c.high, drift: c.driftFlagged, eceRaw: c.probability?.raw.ece ?? null, eceSmoothed: c.probability?.smoothed.ece ?? null, brierRaw: c.probability?.raw.brier ?? null, brierSmoothed: c.probability?.smoothed.brier ?? null }; })() : null);
  const tunnel = guarded("The wind-tunnel coverage study is recorded by scripts/calibrate-windtunnel.ts.", () => {
    const planted = coverage(COVERAGE_FILE);
    if (!planted) throw new Error("no study recorded");
    return { planted, control: coverage(CONTROL_FILE) };
  });

  const regret = guarded("Decisions are recorded when a policy is proposed with --dossier.", () => {
    if (!existsSync(paths.regretPath)) throw new Error("no decisions recorded");
    const db = openRegret(paths.regretPath);
    try {
      const lines = scoreDecisions(db, []);
      if (lines.length === 0) throw new Error("no decisions recorded");
      return { decisions: lines.map((l) => ({ id: l.decisionId, decision: l.decision, decidedAtMs: l.decidedAtMs, options: l.options.map((o) => ({ option: o.option, label: o.label, low: o.predictedLow, high: o.predictedHigh, realised: o.realised, blocked: o.blockedLanded, inside: o.inside, regret: o.regret, status: o.status })) })) };
    } finally {
      db.close();
    }
  });

  const learning = guarded("The learning run is recorded by `desk lessons learn`.", () => {
    if (!existsSync(LEARNING_REPORT)) throw new Error("no learning run recorded");
    const r = JSON.parse(readFileSync(LEARNING_REPORT, "utf8")) as StoredReport;
    return { mistakes: r.mistakes, resolved: r.resolved, unresolved: r.unresolved, regression: r.regression, rounds: r.rounds.map((k) => ({ round: k.round, lessons: k.lessons.length, exact: k.exact, n: k.n, change: k.change, reverted: k.reverted, novel: k.novel })) };
  });

  const benchmark = guarded("The benchmark is recorded under docs/verification/benchmark/.", () => benchBlock());

  return { state: "ok", sample: ctx.mode === "sample", benchmark, route, seats, links, tunnel, regret, learning };
}
