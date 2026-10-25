import type { Flip, FlipCertificate } from "../flip.ts";
import { DEFAULT_CONFIG, evaluateAt, type Context, type Verdict, type VerdictConfig, type VerdictKind } from "./verdict.ts";

const REASON_WORDS: Record<string, string> = {
  regression_rule_met: "the regression rule holds",
  improvement_rule_met: "the improvement rule holds",
  rests_on_one_task: "the change rests on one task",
  no_control_arm: "no control arm ran, so a platform cause cannot be excluded",
  control_arm_moved: "the control arm moved the same way",
  held_out_half_disagrees: "the held-out half of the tasks disagrees",
  below_minimum_effect: "the change is under the smallest that can be called",
  not_in_both_windows: "the change shows in only one of the two windows",
  interval_wide: "the interval is too wide to call",
  within_detectable_range: "the change is within what the data can detect",
  too_few_tasks: "too few tasks remain to call",
  error_rate: "too many attempts produced no score",
  harness_or_agent_version_changed: "the harness or the agent version changed",
};

const words = (v: Verdict): string => REASON_WORDS[v.reason] ?? v.reason.replace(/_/g, " ");

/**
 * What would flip the canary's verdict as of day `t`: each task left out in turn (the others keep their places, so the held-out half does not shift), and the control arm
 * left out. A verdict is only as firm as the smallest of these. Stops when `budgetMs` has passed and then says the search was not finished.
 */
export function canaryFlips(ctx: Context, t: number, cfg: VerdictConfig = DEFAULT_CONFIG, opts: { budgetMs?: number; nowMs?: () => number } = {}): FlipCertificate {
  const now = opts.nowMs ?? Date.now;
  const started = now();
  const budget = opts.budgetMs ?? 8_000;
  const base = evaluateAt(ctx, t, cfg);
  const arm = ctx.series.primary;
  const flips: (Flip & { influence: number })[] = [];
  const candidates = arm.taskIds.length + (ctx.control ? 1 : 0);
  let tried = 0;
  const w1 = base.windows[1];
  const influenceOf = (i: number): number => Math.abs(w1?.d.find((x) => x.task === i)?.value ?? 0);
  const kind = (v: Verdict): VerdictKind => v.verdict;

  // The task that moves the verdict most is tried first, so a partial search has looked where a flip is likeliest.
  const order = Array.from({ length: arm.taskIds.length }, (_, i) => i).sort((a, b) => influenceOf(b) - influenceOf(a) || a - b);
  for (const i of order) {
    if (now() - started > budget) break;
    tried += 1;
    const v = evaluateAt(ctx, t, cfg, { dropTask: i });
    if (kind(v) !== kind(base)) {
      const id = arm.taskIds[i] as string;
      flips.push({ kind: "remove_task", subject: id, change: `Leave task ${id} out`, from: kind(base), to: kind(v), because: words(v), influence: influenceOf(i) });
    }
  }
  if (ctx.control && now() - started <= budget) {
    tried += 1;
    const v = evaluateAt({ ...ctx, control: null }, t, cfg);
    if (kind(v) !== kind(base)) flips.push({ kind: "remove_control_arm", subject: "the control arm", change: "Leave the control arm out", from: kind(base), to: kind(v), because: words(v), influence: 0 });
  }
  flips.sort((a, b) => b.influence - a.influence);
  const smallest = flips[0] ?? null;
  return {
    subject: `the canary's verdict on day ${t}`,
    verdict: kind(base),
    flips: flips.map(({ influence: _i, ...f }) => f),
    smallest: smallest === null ? null : (({ influence: _i, ...f }) => f)(smallest),
    tried,
    candidates,
    completeness: tried >= candidates ? "complete" : "partial",
  };
}
