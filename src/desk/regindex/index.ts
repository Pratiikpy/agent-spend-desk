import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { canonicalJson } from "../../runtime/canonical.ts";
import { readRows } from "../canary/store.ts";
import { buildSeries } from "../canary/store.ts";
import { evaluateAt, makeContext } from "../canary/verdict.ts";
import { TASKS } from "../canary/tasks.ts";
import type { CaptureDb } from "../capture/store.ts";
import { declaredFetch, destination } from "../security/net.ts";

/**
 * The opt-in regression index (DF-064). It is off. When the owner turns it on, a preview shows the exact payload before anything is sent, and what is sent is those bytes: the
 * payload is hashed when it is previewed, the owner accepts that hash, and the send refuses a payload whose hash is not the accepted one. The payload holds aggregates only: for
 * each suite of tasks, the model the endpoint says it served, the pass rate, the steps a run took, the canary's verdict, and the version of this tool. It holds no task text, no
 * prompt, no path, no repository name, no person, and no date finer than a day.
 */
export const INDEX_SCHEMA = "desk.regression-index.v1";

export interface IndexSuite {
  kind: "canary" | "swap";
  /** The harness name of the canary pack, or the hash of the frozen suite: a name for the set of tasks that says nothing of what is in them. */
  suite: string;
  model: string;
  tasks: number;
  runs: number;
  passRate: number | null;
  /** Mean model calls a run took (swap runs); null where one run is one call. */
  steps: number | null;
  /** The canary's verdict at its latest day; null for a swap. */
  verdict: string | null;
}

export interface IndexPayload {
  schema: typeof INDEX_SCHEMA;
  tool: { name: "desk"; version: string };
  /** The day it was made, to the day. */
  generated: string;
  suites: IndexSuite[];
}

export function digestOf(p: IndexPayload): string {
  return createHash("sha256").update(canonicalJson(p as never)).digest("hex");
}

export function bytesOf(p: IndexPayload): string {
  return `${JSON.stringify(p, null, 2)}\n`;
}

export function toolVersion(): string {
  try {
    return (JSON.parse(readFileSync("package.json", "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export interface BuildOptions {
  canaryRunsPath?: string;
  store?: CaptureDb;
  now?: () => Date;
}

export function buildPayload(o: BuildOptions): IndexPayload {
  const suites: IndexSuite[] = [];
  if (o.canaryRunsPath && existsSync(o.canaryRunsPath)) {
    const { rows } = readRows(o.canaryRunsPath);
    const primary = rows.filter((r) => r.arm === "primary");
    const series = buildSeries(rows);
    if (primary.length > 0 && series) {
      const day = series.days;
      const v = evaluateAt(makeContext(series), day);
      const scored = primary.filter((r) => r.score !== null);
      const served = [...primary].reverse().find((r) => r.servedModel !== null)?.servedModel ?? "unknown";
      suites.push({ kind: "canary", suite: primary[primary.length - 1]!.harness, model: served, tasks: TASKS.length, runs: scored.length, passRate: scored.length === 0 ? null : scored.reduce((s, r) => s + (r.score as number), 0) / scored.length, steps: null, verdict: v.verdict });
    }
  }
  if (o.store) {
    const runs = o.store.prepare("SELECT run_id, suite_id, baseline, candidate, params_json FROM replay_run WHERE status IN ('complete', 'partial', 'withheld') ORDER BY created_at").all() as { run_id: string; suite_id: string | null; baseline: string; candidate: string; params_json: string }[];
    for (const r of runs) {
      const params = JSON.parse(r.params_json) as { routes?: { baseline?: { name: string; model: string }; candidate?: { name: string; model: string } }; tasks?: string[] };
      const label = r.suite_id ?? `run-${createHash("sha256").update(JSON.stringify(params.tasks ?? [])).digest("hex").slice(0, 12)}`;
      for (const route of [params.routes?.baseline, params.routes?.candidate]) {
        if (!route) continue;
        const items = o.store.prepare("SELECT status, turns FROM replay_item WHERE run_id = ? AND route = ? AND status IN ('pass', 'fail', 'over_budget')").all(r.run_id, route.name) as { status: string; turns: number }[];
        if (items.length === 0) continue;
        suites.push({ kind: "swap", suite: label, model: route.model, tasks: params.tasks?.length ?? 0, runs: items.length, passRate: items.filter((i) => i.status === "pass").length / items.length, steps: items.reduce((s, i) => s + i.turns, 0) / items.length, verdict: null });
      }
    }
  }
  const round = (x: number | null): number | null => (x === null ? null : Math.round(x * 1000) / 1000);
  return { schema: INDEX_SCHEMA, tool: { name: "desk", version: toolVersion() }, generated: (o.now ?? (() => new Date()))().toISOString().slice(0, 10), suites: suites.map((s) => ({ ...s, passRate: round(s.passRate), steps: round(s.steps) })) };
}

export interface Consent {
  digest: string;
  acceptedAt: string;
}

export function readConsent(path: string): Consent | null {
  try {
    const c = JSON.parse(readFileSync(path, "utf8")) as Consent;
    return typeof c.digest === "string" ? c : null;
  } catch {
    return null;
  }
}

export function writeConsent(path: string, c: Consent): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(c, null, 2)}\n`);
}

export class IndexRefused extends Error {}

/** Send the previewed payload and nothing else, to the one address declared for it, and only if it is the payload that was accepted. */
export async function publish(o: { payload: IndexPayload; consent: Consent | null; env: Record<string, string | undefined>; fetchImpl?: typeof fetch }): Promise<{ status: number; sent: number; digest: string }> {
  if (o.env["DESK_INDEX"] !== "on") throw new IndexRefused("the regression index is off. Turn it on with DESK_INDEX=on, preview the payload with desk index preview, and accept it with desk index accept.");
  const url = o.env["DESK_INDEX_URL"];
  const dest = url ? destination("index", url, "the regression index: per-suite aggregates the owner previewed and accepted, with no task text", "DESK_INDEX_URL") : null;
  if (!dest) throw new IndexRefused("no address is declared for the index: set DESK_INDEX_URL.");
  const digest = digestOf(o.payload);
  if (!o.consent) throw new IndexRefused("the payload has not been previewed and accepted. desk index preview shows it; desk index accept accepts exactly what it showed.");
  if (o.consent.digest !== digest) throw new IndexRefused(`the payload is not the one that was accepted (accepted ${o.consent.digest.slice(0, 12)}, this is ${digest.slice(0, 12)}); it changed since you looked. Preview it again.`);
  const body = bytesOf(o.payload);
  const f = o.fetchImpl ?? declaredFetch([dest]);
  const res = await f(url as string, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(30_000) });
  if (res.status >= 300 && res.status < 400) throw new IndexRefused(`the address answered with a redirect (${res.status}) and it was not followed, because a redirect would send the payload somewhere nobody declared.`);
  return { status: res.status, sent: Buffer.byteLength(body), digest };
}
