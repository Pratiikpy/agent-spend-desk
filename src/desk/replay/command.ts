import { CassettePort, OpenAiPort, ReplayOrRecordPort, type ModelPort } from "../agents/model.ts";
import type { CaptureDb } from "../capture/store.ts";
import { getTask, listTasks, type TaskRow } from "../capture/tasks.ts";
import { jsonlEgress } from "../security/egress.ts";
import { renderSwap, type SwapReport } from "./report.ts";
import { itemsOf, recomputeReport, runSwap, type SwapRoute } from "./run.ts";

/**
 * `desk swap`: run two routes on the owner's captured tasks and say whether the cheaper one did the work as well (DF-042). A route is `name=model`; the model is whatever the
 * configured endpoint serves under that name. In sample mode no endpoint is called and the replies come from the recordings in the cassette folder; otherwise a reply that was not
 * recorded is asked of the endpoint and recorded, so a run that is stopped can be started again and a recorded run can be replayed offline.
 */
export interface SwapFlags {
  baseline?: string;
  candidate?: string;
  repeats?: string;
  suite?: string;
  maxLive?: string;
  budgetUsd?: string;
  priceBaseline?: string;
  priceCandidate?: string;
  resume?: string;
  margin?: string;
  maxTurns?: string;
  concurrency?: string;
  sample?: boolean;
  yes?: boolean;
}

export const SWAP_CASSETTES = "data/desk/replay-cassettes";

export function parseRoute(spec: string | undefined, label: string): { name: string; model: string } {
  const m = /^([a-z0-9][a-z0-9-]{0,30})=(.{1,120})$/.exec(spec ?? "");
  if (!m) throw new Error(`--${label} is name=model, with a name of lowercase letters, digits and dashes, such as strong=nvidia/nemotron-3.5-super-120b-a12b`);
  return { name: m[1] as string, model: m[2] as string };
}

function price(spec: string | undefined): { inPerM: number; outPerM: number } | undefined {
  if (!spec) return undefined;
  const [a, b] = spec.split(",").map(Number);
  if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) throw new Error("a price is two numbers, dollars per million tokens in and out, such as 0.2,0.6");
  return { inPerM: a, outPerM: b };
}

export function portFor(model: string, env: Record<string, string | undefined>, cassetteDir: string, sample: boolean): ModelPort {
  if (sample) return new CassettePort(cassetteDir);
  const baseUrl = env["MODEL_BASE_URL"] ?? env["NVIDIA_BASE_URL"];
  const apiKey = env["MODEL_API_KEY"] ?? env["NVIDIA_API_KEY"];
  if (!baseUrl || !apiKey) throw new Error("no model endpoint: set MODEL_BASE_URL and MODEL_API_KEY (or the NVIDIA_ names), or run with --sample to replay the recordings");
  const egress = env["DESK_EGRESS_LOG"] ?? "data/desk/egress.jsonl";
  // A swap makes hundreds of calls to one endpoint, and a free tier answers a burst of them with 429. The pauses are long enough for its window to pass.
  const live = new OpenAiPort({ baseUrl, apiKey, model, backoffMs: [20_000, 45_000, 90_000, 120_000], ...(egress === "off" ? {} : { onEgress: jsonlEgress(egress) }) });
  return new ReplayOrRecordPort(live, cassetteDir);
}

function poolOf(store: CaptureDb, suite: string | undefined): TaskRow[] {
  if (suite) {
    const row = store.prepare("SELECT task_ids_json FROM canary_suite WHERE suite_id = ?").get(suite) as { task_ids_json: string } | undefined;
    if (!row) throw new Error(`no suite ${suite}`);
    return (JSON.parse(row.task_ids_json) as string[]).map((id) => getTask(store, id)).filter((t): t is TaskRow => t !== undefined);
  }
  return listTasks(store, "accepted");
}

export async function swapCommand(o: { sub: string | undefined; args: string[]; flags: SwapFlags; store: CaptureDb; env: Record<string, string | undefined>; out?: (line: string) => void }): Promise<string> {
  const sub = o.sub ?? "help";
  try {
    if (sub === "list") {
      const rows = o.store.prepare("SELECT run_id, created_at, baseline, candidate, status, report_json FROM replay_run ORDER BY created_at").all() as { run_id: string; created_at: string; baseline: string; candidate: string; status: string; report_json: string | null }[];
      if (rows.length === 0) return "No swap has been run. desk swap run --baseline strong=<model> --candidate cheap=<model>";
      return rows.map((r) => `${r.run_id}  ${r.created_at.slice(0, 16).replace("T", " ")}  ${r.candidate} against ${r.baseline}  ${r.status}${r.report_json ? `  ${(JSON.parse(r.report_json) as SwapReport).verdict}` : ""}`).join("\n");
    }
    if (sub === "report") {
      const row = o.store.prepare("SELECT report_json, status FROM replay_run WHERE run_id = ?").get(o.args[0] ?? "") as { report_json: string | null; status: string } | undefined;
      if (!row) return `No run ${JSON.stringify(o.args[0] ?? "")}. desk swap list shows them.`;
      // A report is a function of the stored items, so it is made again from them each time it is asked for, and a stored one that disagreed is replaced.
      const fresh = recomputeReport(o.store, o.args[0] ?? "");
      if (fresh) return renderSwap(fresh);
      return row.report_json ? renderSwap(JSON.parse(row.report_json) as SwapReport) : `The run is ${row.status} and has no report yet.`;
    }
    if (sub === "run") {
      const b = parseRoute(o.flags.baseline, "baseline");
      const c = parseRoute(o.flags.candidate, "candidate");
      const sample = o.flags.sample === true || o.env["SAMPLE_MODE"] === "true";
      const tasks = poolOf(o.store, o.flags.suite).filter((t) => t.base_ref && t.result_ref && t.oracle && t.oracle !== "none");
      if (tasks.length === 0) return "There are no accepted tasks to run. desk capture list shows them; desk capture accept <id> accepts one.";
      const repeats = o.flags.repeats ? Number(o.flags.repeats) : 3;
      if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) return "--repeats is a whole number from 1 to 10.";
      const planned = tasks.length * 2 * repeats;
      if (!sample && !o.flags.yes && !o.flags.resume) return `This would run ${tasks.length} tasks on two routes, ${repeats} times each: ${planned} runs, each of up to ${o.flags.maxTurns ?? 30} model calls, against ${o.env["MODEL_BASE_URL"] ?? o.env["NVIDIA_BASE_URL"] ?? "the configured endpoint"}. Add --yes to go ahead, and --max-live N or --budget-usd X to cap it.`;
      const dir = o.env["DESK_SWAP_CASSETTES"] ?? SWAP_CASSETTES;
      const mk = (r: { name: string; model: string }, p: string | undefined): SwapRoute => ({ name: r.name, model: r.model, port: portFor(r.model, o.env, dir, sample), ...(price(p) ? { price: price(p) as { inPerM: number; outPerM: number } } : {}) });
      const out = await runSwap({
        store: o.store, tasks, baseline: mk(b, o.flags.priceBaseline), candidate: mk(c, o.flags.priceCandidate), repeats,
        ...(o.flags.suite ? { suiteId: o.flags.suite } : {}), ...(o.flags.resume ? { runId: o.flags.resume } : {}),
        ...(o.flags.maxLive ? { maxLiveCalls: Number(o.flags.maxLive) } : {}), ...(o.flags.budgetUsd ? { budgetUsd: Number(o.flags.budgetUsd) } : {}), ...(o.flags.margin ? { margin: Number(o.flags.margin) } : {}),
        ...(o.flags.maxTurns ? { limits: { maxTurns: Number(o.flags.maxTurns) } } : {}), ...(o.flags.concurrency ? { concurrency: Number(o.flags.concurrency) } : {}),
        onItem: (r, done, total) => o.out?.(`${done}/${total}  ${r.route}  ${r.taskId}  repeat ${r.repeat}  ${r.status}${r.divergence ? ` (${r.divergence.slice(0, 80)})` : ""}${r.error ? ` (${r.error.slice(0, 80)})` : ""}`),
      });
      return `${renderSwap(out.report)}\n\nrun ${out.runId}: ${out.liveCalls} live model calls${out.estimatedUsd === null ? "" : `, about $${out.estimatedUsd.toFixed(2)} at the prices given`}; desk swap report ${out.runId} shows it again.`;
    }
    if (sub === "items") {
      const items = itemsOf(o.store, o.args[0] ?? "");
      return items.length === 0 ? "No items for that run." : items.map((i) => `${i.taskId}  ${i.route.padEnd(8)} #${i.repeat}  ${i.status.padEnd(11)} ${i.failToPassPassed}/${i.failToPassTotal} deciding tests, ${i.turns} turns, ${i.tokensIn + i.tokensOut} tokens${i.divergence ? `  diverged: ${i.divergence.slice(0, 90)}` : ""}${i.error ? `  error: ${i.error.slice(0, 90)}` : ""}`).join("\n");
    }
  } catch (e) {
    return `Could not ${sub}: ${(e as Error).message}`;
  }
  return [
    "desk swap: would a cheaper route have done your work as well?",
    "  run --baseline name=model --candidate name=model [--repeats 3] [--suite ID] [--max-live N] [--budget-usd X] [--price-baseline in,out --price-candidate in,out] [--max-turns 30] [--yes] [--sample]",
    "  report <run> | items <run> | list",
    "  --resume <run> makes only the items a stopped run lacks",
  ].join("\n");
}
