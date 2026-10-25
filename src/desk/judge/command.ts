import type { CaptureDb } from "../capture/store.ts";
import { portFor, SWAP_CASSETTES } from "../replay/command.ts";
import { ADMISSION } from "./admission.ts";
import type { Judge } from "./panel.ts";
import { PanelConfigError, panelId } from "./panel.ts";
import { judgeRun, latestAdmission, loadJudgeSpecs, readLabels, renderJudged, runAdmission } from "./run.ts";

export const DEFAULT_JUDGES = "data/desk/judges.json";

export interface JudgeFlags {
  judges?: string;
  labels?: string;
  advisory?: boolean;
  limit?: string;
  sample?: boolean;
}

/** `desk judge`: check a panel of judges against your own labels, and put it to work on the changes two routes made. */
export async function judgeCommand(o: { sub: string | undefined; args: string[]; flags: JudgeFlags; store: CaptureDb; env: Record<string, string | undefined> }): Promise<string> {
  const sub = o.sub ?? "help";
  try {
    const specs = sub === "help" ? [] : loadJudgeSpecs(o.flags.judges ?? DEFAULT_JUDGES);
    const sample = o.flags.sample === true || o.env["SAMPLE_MODE"] === "true";
    const dir = o.env["DESK_SWAP_CASSETTES"] ?? SWAP_CASSETTES;
    const judges: Judge[] = specs.map((s) => ({ ...s, port: portFor(s.model, o.env, dir, sample) }));
    if (sub === "status") {
      const panel = panelId(specs);
      const a = latestAdmission(o.store, panel);
      return a === null ? `Panel ${panel} (${specs.map((s) => `${s.id}: ${s.family}`).join(", ")}) has not been checked against your labels, so it scores nothing.` : `Panel ${panel}: ${a.status}, judges agree at alpha ${a.alpha === null ? "not defined" : a.alpha.toFixed(2)}, ${a.agreement === null ? "no" : `${(100 * a.agreement).toFixed(0)}%`} agreement with you on ${a.labels} labelled pairs (${a.at.slice(0, 10)}).`;
    }
    if (sub === "admit") {
      if (!o.flags.labels) return `Give the pairs you have judged yourself: desk judge admit --labels FILE, a list of { id, task, a, b, owner } with owner "A", "B" or "tie". At least ${ADMISSION.minLabels} are needed.`;
      const row = o.store.prepare("SELECT params_json FROM replay_run ORDER BY created_at DESC LIMIT 1").get() as { params_json: string } | undefined;
      const under = row ? underTestOf(row.params_json) : [];
      const a = await runAdmission(o.store, judges, readLabels(o.flags.labels), under);
      return [`panel ${a.panel}: ${a.status.toUpperCase()}`, `judges agree with each other at alpha ${a.alpha === null ? "not defined" : a.alpha.toFixed(2)} (needs ${ADMISSION.minAlpha}); the panel agrees with you on ${a.agreement === null ? "none" : `${(100 * a.agreement).toFixed(0)}%`} of ${a.labels} pairs (needs ${(100 * ADMISSION.minAgreement).toFixed(0)}%); ${a.undecided} pairs were undecided.`, ...a.reasons.map((r) => `  ${r}`)].join("\n");
    }
    if (sub === "run") {
      const runId = o.args[0] ?? "";
      const run = o.store.prepare("SELECT baseline, candidate, params_json FROM replay_run WHERE run_id = ?").get(runId) as { baseline: string; candidate: string; params_json: string } | undefined;
      if (!run) return `No run ${JSON.stringify(runId)}. desk swap list shows them.`;
      const r = await judgeRun(o.store, runId, judges, { baseline: run.baseline, candidate: run.candidate, underTest: underTestOf(run.params_json), ...(o.flags.advisory ? { advisory: true } : {}), ...(o.flags.limit ? { limit: Number(o.flags.limit) } : {}) });
      return renderJudged(r);
    }
  } catch (e) {
    return e instanceof PanelConfigError ? `The panel cannot start: ${e.message}.` : `Could not ${sub}: ${(e as Error).message}`;
  }
  return [
    "desk judge: a panel of judges for what tests cannot decide, believed only once it agrees with you",
    "  status                      is the panel in data/desk/judges.json admitted?",
    `  admit --labels FILE         judge ${ADMISSION.minLabels} or more pairs you have judged yourself, and compare`,
    "  run <swap run> [--advisory] judge the two routes' changes in both orders; without admission only --advisory, which scores nothing",
    "  --judges FILE               the panel: { \"judges\": [ { \"id\", \"family\", \"model\" } ] }",
  ].join("\n");
}

function underTestOf(paramsJson: string): string[] {
  try {
    const p = JSON.parse(paramsJson) as { routes?: { baseline?: { model?: string }; candidate?: { model?: string } } };
    return [p.routes?.baseline?.model, p.routes?.candidate?.model].filter((m): m is string => typeof m === "string");
  } catch {
    return [];
  }
}
