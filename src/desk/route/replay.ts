import { Rng } from "../canary/rng.ts";
import type { RunRow } from "../canary/runner.ts";
import { TASKS } from "../canary/tasks.ts";

/**
 * Route replay (DK7): the tasks the canary already ran on two models are a recorded replay of the same work on two
 * routes. For each task, the cheaper route's pass rate is set against the stronger route's, with an interval that
 * resamples clusters of related tasks, and the saving is stated in tokens (dollars only when the caller supplies a
 * price, because the price of the free tier is not published and is not guessed).
 *
 * A route is recommended for a kind of task only if it holds up twice: on half the tasks of that kind, and again on
 * the other half. That is a screen with a small sample, not a proof, and the report says how many tasks stand behind
 * each line.
 */
export interface Price {
  /** US dollars per million input tokens and per million output tokens. */
  inPerM: number;
  outPerM: number;
}

export interface RouteTask {
  taskId: string;
  cluster: string;
  strong: number | null;
  cheap: number | null;
  strongRuns: number;
  cheapRuns: number;
}

export interface RouteCluster {
  cluster: string;
  tasks: number;
  /** Change in pass rate, cheap minus strong, on the tasks used to choose and on the tasks held back to confirm. */
  chosenDrop: number | null;
  confirmedDrop: number | null;
  routable: boolean;
}

export interface TokenUse {
  callsStrong: number;
  callsCheap: number;
  tokensPerCallStrong: number;
  tokensPerCallCheap: number;
  usdPerCallStrong: number | null;
  usdPerCallCheap: number | null;
}

export interface RouteReport {
  strongModel: string;
  cheapModel: string;
  tasks: RouteTask[];
  clusters: RouteCluster[];
  /** Mean change in pass rate over tasks, cheap minus strong, with a 95% interval from resampling clusters. */
  delta: number;
  interval: { low: number; high: number };
  tolerance: number;
  tokens: TokenUse;
}

export interface RouteOptions {
  tolerance: number;
  price?: { strong: Price; cheap: Price };
  seed?: number;
  resamples?: number;
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

function passRates(rows: readonly RunRow[], model: string): Map<string, { pass: number; runs: number }> {
  const by = new Map<string, { pass: number; runs: number }>();
  for (const r of rows) {
    if (r.servedModel !== model || r.score === null) continue;
    const e = by.get(r.taskId) ?? { pass: 0, runs: 0 };
    e.pass += r.score;
    e.runs += 1;
    by.set(r.taskId, e);
  }
  return by;
}

/** The two models in the rows: the stronger is the one that passed more. Null when the rows hold fewer than two. */
export function routesIn(rows: readonly RunRow[]): { strong: string; cheap: string } | null {
  const tally = new Map<string, { pass: number; n: number }>();
  for (const r of rows) {
    if (r.servedModel === null || r.score === null) continue;
    const t = tally.get(r.servedModel) ?? { pass: 0, n: 0 };
    t.pass += r.score;
    t.n += 1;
    tally.set(r.servedModel, t);
  }
  const ranked = [...tally.entries()].filter(([, t]) => t.n >= 30).sort((a, b) => b[1].pass / b[1].n - a[1].pass / a[1].n);
  return ranked.length < 2 ? null : { strong: ranked[0]![0], cheap: ranked[ranked.length - 1]![0] };
}

export function routeReplay(rows: readonly RunRow[], o: RouteOptions): RouteReport | null {
  const models = routesIn(rows);
  if (!models) return null;
  const strong = passRates(rows, models.strong);
  const cheap = passRates(rows, models.cheap);
  const tasks: RouteTask[] = TASKS.map((t) => {
    const s = strong.get(t.id);
    const c = cheap.get(t.id);
    return { taskId: t.id, cluster: t.cluster, strong: s ? s.pass / s.runs : null, cheap: c ? c.pass / c.runs : null, strongRuns: s?.runs ?? 0, cheapRuns: c?.runs ?? 0 };
  });
  const paired = tasks.map((t, i) => ({ ...t, index: i })).filter((t) => t.strong !== null && t.cheap !== null);

  const clusterNames = [...new Set(paired.map((t) => t.cluster))];
  const clusters: RouteCluster[] = clusterNames.map((name) => {
    const own = paired.filter((t) => t.cluster === name);
    const drop = (list: typeof own): number | null => (list.length === 0 ? null : mean(list.map((t) => t.cheap! - t.strong!)));
    const chosenDrop = drop(own.filter((t) => t.index % 2 === 0));
    const confirmedDrop = drop(own.filter((t) => t.index % 2 === 1));
    const routable = chosenDrop !== null && confirmedDrop !== null && chosenDrop >= -o.tolerance && confirmedDrop >= -o.tolerance;
    return { cluster: name, tasks: own.length, chosenDrop, confirmedDrop, routable };
  });

  const delta = mean(paired.map((t) => t.cheap! - t.strong!));
  const rng = new Rng(o.seed ?? 20261023);
  const draws: number[] = [];
  const byCluster = new Map(clusterNames.map((c) => [c, paired.filter((t) => t.cluster === c)]));
  for (let i = 0; i < (o.resamples ?? 2000); i += 1) {
    const picked = clusterNames.map(() => byCluster.get(clusterNames[Math.floor(rng.next() * clusterNames.length)]!)!).flat();
    draws.push(mean(picked.map((t) => t.cheap! - t.strong!)));
  }
  draws.sort((a, b) => a - b);

  const use = (model: string): { calls: number; perCall: number } => {
    const used = rows.filter((r) => r.servedModel === model && r.tokensIn !== null && r.tokensOut !== null);
    return { calls: used.length, perCall: mean(used.map((r) => (r.tokensIn as number) + (r.tokensOut as number))) };
  };
  const dollars = (model: string, p: Price | undefined): number | null => {
    if (!p) return null;
    const used = rows.filter((r) => r.servedModel === model && r.tokensIn !== null && r.tokensOut !== null);
    return used.length === 0 ? null : mean(used.map((r) => ((r.tokensIn as number) * p.inPerM + (r.tokensOut as number) * p.outPerM) / 1_000_000));
  };
  const sUse = use(models.strong);
  const cUse = use(models.cheap);
  return {
    strongModel: models.strong,
    cheapModel: models.cheap,
    tasks,
    clusters,
    delta,
    interval: { low: draws[Math.floor(draws.length * 0.025)] ?? delta, high: draws[Math.ceil(draws.length * 0.975) - 1] ?? delta },
    tolerance: o.tolerance,
    tokens: { callsStrong: sUse.calls, callsCheap: cUse.calls, tokensPerCallStrong: sUse.perCall, tokensPerCallCheap: cUse.perCall, usdPerCallStrong: dollars(models.strong, o.price?.strong), usdPerCallCheap: dollars(models.cheap, o.price?.cheap) },
  };
}

const pts = (x: number | null): string => (x === null ? "n/a" : `${x >= 0 ? "+" : "-"}${Math.abs(x * 100).toFixed(0)} points`);

export function renderRoute(r: RouteReport): string {
  const out: string[] = [];
  out.push(`Route replay: the same ${r.tasks.filter((t) => t.strong !== null && t.cheap !== null).length} recorded tasks on two routes`);
  out.push(`  strong route ${r.strongModel}, cheaper route ${r.cheapModel}`);
  out.push(`  pass rate on the cheaper route: ${pts(r.delta)} against the strong one (95% interval ${pts(r.interval.low)} to ${pts(r.interval.high)}, resampling clusters of related tasks)`);
  out.push("");
  out.push(`By kind of task (a kind is routable when the cheaper route is within ${(r.tolerance * 100).toFixed(0)} points on half its tasks and again on the other half):`);
  for (const c of [...r.clusters].sort((a, b) => Number(b.routable) - Number(a.routable) || a.cluster.localeCompare(b.cluster))) {
    out.push(`  ${c.cluster.padEnd(12)} ${c.routable ? "route to the cheaper model" : "keep on the strong model"}   chosen on ${pts(c.chosenDrop)}, confirmed on ${pts(c.confirmedDrop)}   (${c.tasks} tasks)`);
  }
  const routable = r.clusters.filter((c) => c.routable);
  out.push("");
  out.push(routable.length === 0 ? "No kind of task passed both halves, so nothing here should be routed to the cheaper model." : `${routable.length} of ${r.clusters.length} kinds held up on both halves: ${routable.map((c) => c.cluster).join(", ")}. With ${routable.reduce((a, c) => a + c.tasks, 0)} tasks behind that, treat it as a screen to confirm on your own tasks, not a proof.`);
  const t = r.tokens;
  out.push(`Tokens per call: ${Math.round(t.tokensPerCallStrong)} on the strong route, ${Math.round(t.tokensPerCallCheap)} on the cheaper one (${t.callsStrong} and ${t.callsCheap} recorded calls).`);
  if (t.usdPerCallStrong !== null && t.usdPerCallCheap !== null) out.push(`At the prices you gave: $${t.usdPerCallStrong.toFixed(5)} against $${t.usdPerCallCheap.toFixed(5)} a call.`);
  else out.push("Dollars are not stated: the price of these models on the free tier is not published (NOT VERIFIED). Give --price-strong and --price-cheap as input:output dollars per million tokens to see them.");
  return out.join("\n");
}
