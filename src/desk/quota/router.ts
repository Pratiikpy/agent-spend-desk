import type { PlansView, PlanWindow } from "../limits/plans.ts";

/**
 * The quota-aware plan router (DF-091). The owner has more than one place to do work: a Claude Code plan, a Codex plan, perhaps an API key. Each plan has rolling windows (five
 * hours, a week) whose use the tools report. When the plan a task would run on is close to a limit, the router says which of the owner's other plans has room, or that the task
 * should wait for a reset, or that nothing is available; and it says to write a handoff first, so that the stop is clean.
 *
 * What it will not do. It never moves work between two accounts of one vendor to get past a limit, whoever owns them: a limit belongs to an account, and a second account of
 * the same vendor is a way round it, not another plan. Switching from a subscription to the same account's own API key, which is paid by the token, is allowed and is said to
 * cost money. It never invents a reading: a plan with no report from its tool is not a candidate and the router says so. It never drops a request: it names a plan, a wait, or a
 * refusal with a reason.
 */
export type PlanKind = "subscription" | "api_key";

export interface OwnedPlan {
  id: string;
  /** The tool the plan's windows are reported by (`claude_code`, `codex`), or the name of an API key's route. */
  tool: string;
  vendor: string;
  /** Which account at that vendor. Two plans with the same vendor and a different account are never failover for each other. */
  account: string;
  kind: PlanKind;
  label: string;
}

export interface RouterPolicy {
  /** Fail over when the window would fill within this many minutes at the pace of the last hour. */
  failoverMinutes: number;
  /** Fail over when this share or less of the tightest window is left. */
  failoverRemainingPct: number;
  /** Tokens kept back on the plan being left, for the handoff that closes the work cleanly. */
  reserveTokens: number;
}

export const DEFAULT_POLICY: RouterPolicy = { failoverMinutes: 15, failoverRemainingPct: 5, reserveTokens: 20_000 };

export interface Headroom {
  plan: OwnedPlan;
  /** False when the plan's tool has no report of its own windows: nothing is said about its room. */
  known: boolean;
  /** The share of the tightest window that is left, and which window that is. */
  remainingPct: number | null;
  binding: string | null;
  /** At the pace of the last hour, minutes until the tightest window is full; null when there is no pace to go on. */
  minutesToFull: number | null;
  minutesToReset: number | null;
  /** What the remaining share is in tokens, when this plan's history gives a rate for it. */
  remainingTokens: number | null;
  /** The reading is too old to act on. */
  stale: boolean;
  /** Pay-per-token: has no window, so no share is left to report. */
  perToken: boolean;
  notes: string[];
}

export type Action = "stay" | "route" | "wait" | "refuse";

export interface Recommendation {
  action: Action;
  from: string;
  to: string | null;
  /** Machine-readable cause when the action is a refusal. */
  code: "ok" | "route" | "wait_for_reset" | "quota_runway_depleted" | "no_reading" | null;
  reasons: string[];
  /** Write the handoff and stop cleanly before the limit is reached. */
  checkpoint: boolean;
  waitMinutes: number | null;
  reserveTokens: number;
  considered: Headroom[];
  /** Plans that were not candidates, and why. */
  refused: { plan: string; why: string }[];
  /** A route to a plan paid by the token costs money; the router says so. */
  costsMoney: boolean;
}

const windowsOf = (view: PlansView, plan: OwnedPlan): PlanWindow[] => view.windows.filter((w) => w.tool === plan.tool);

/** How much room a plan has: its tightest window, as the tool reports it. */
export function headroomOf(plan: OwnedPlan, view: PlansView): Headroom {
  const base: Headroom = { plan, known: false, remainingPct: null, binding: null, minutesToFull: null, minutesToReset: null, remainingTokens: null, stale: false, perToken: plan.kind === "api_key", notes: [] };
  if (plan.kind === "api_key") return { ...base, known: true, notes: ["Paid by the token: no window to fill. What it costs counts against your caps."] };
  const reported = windowsOf(view, plan).filter((w) => w.official !== null);
  if (reported.length === 0) return { ...base, notes: [`${plan.label} reports no plan window of its own, so nothing is said about its room.`] };
  let tight: PlanWindow | null = null;
  for (const w of reported) if (tight === null || (w.official as NonNullable<PlanWindow["official"]>).usedPct > (tight.official as NonNullable<PlanWindow["official"]>).usedPct) tight = w;
  const t = tight as PlanWindow;
  const o = t.official as NonNullable<PlanWindow["official"]>;
  const stale = o.state === "stale";
  const remainingPct = Math.max(0, 100 - o.usedPct);
  const perPct = t.numbers?.tokensPerPercent ?? null;
  const fullIn = [...reported].map((w) => w.numbers?.minutesToFull ?? null).filter((m): m is number => m !== null);
  return {
    ...base,
    known: true,
    remainingPct,
    binding: t.label,
    minutesToFull: fullIn.length === 0 ? null : Math.min(...fullIn),
    minutesToReset: o.minutesToReset,
    remainingTokens: perPct === null ? null : Math.round(remainingPct * perPct),
    stale,
    notes: stale ? [`The last reading of ${plan.label} is ${Math.round(o.ageMinutes)} minutes old.`] : [],
  };
}

/** Whether a plan is close enough to a limit that work on it should move. */
export function pressed(h: Headroom, p: RouterPolicy): { yes: boolean; why: string[] } {
  if (!h.known || h.perToken || h.stale || h.remainingPct === null) return { yes: false, why: [] };
  const why: string[] = [];
  if (h.remainingPct <= p.failoverRemainingPct) why.push(`${h.plan.label} has ${h.remainingPct.toFixed(0)}% of its ${h.binding ?? "window"} left`);
  if (h.minutesToFull !== null && h.minutesToFull < p.failoverMinutes) why.push(`at the pace of the last hour ${h.plan.label} would fill in ${h.minutesToFull} minutes`);
  if (h.remainingTokens !== null && h.remainingTokens < p.reserveTokens) why.push(`about ${h.remainingTokens.toLocaleString("en-US")} tokens are left on ${h.plan.label}, under the ${p.reserveTokens.toLocaleString("en-US")} kept back for a handoff`);
  return { yes: why.length > 0, why };
}

/** Whether work may move from one plan to another. */
export function mayMove(from: OwnedPlan, to: OwnedPlan): { ok: boolean; why: string } {
  if (from.id === to.id) return { ok: false, why: "that is the plan the work is on" };
  if (from.vendor === to.vendor && from.account !== to.account) return { ok: false, why: `${to.label} is another account at ${to.vendor}; moving work between accounts of one vendor to get past a limit is not done` };
  return { ok: true, why: "" };
}

export interface RecommendInput {
  from: string;
  plans: readonly OwnedPlan[];
  view: PlansView;
  policy?: RouterPolicy;
}

export function recommend(i: RecommendInput): Recommendation {
  const policy = i.policy ?? DEFAULT_POLICY;
  const source = i.plans.find((p) => p.id === i.from);
  const empty: Recommendation = { action: "refuse", from: i.from, to: null, code: null, reasons: [], checkpoint: false, waitMinutes: null, reserveTokens: policy.reserveTokens, considered: [], refused: [], costsMoney: false };
  if (!source) return { ...empty, reasons: [`${i.from} is not one of the plans listed (${i.plans.map((p) => p.id).join(", ") || "none"}).`] };
  const all = i.plans.map((p) => headroomOf(p, i.view));
  const here = all.find((h) => h.plan.id === source.id) as Headroom;
  if (!here.known) return { ...empty, action: "stay", code: "no_reading", reasons: [`${here.notes[0] ?? "No reading."} The router has nothing to move work on.`], considered: all };
  const press = pressed(here, policy);
  if (!press.yes) {
    const reasons = here.perToken ? ["The plan is paid by the token: there is no window to fill."] : [`${source.label} has ${here.remainingPct?.toFixed(0)}% of its ${here.binding ?? "window"} left${here.minutesToFull !== null ? `, and at the pace of the last hour would fill in ${here.minutesToFull} minutes` : ""}.`];
    return { ...empty, action: "stay", code: "ok", reasons: [...reasons, ...here.notes], considered: all };
  }

  const refused: Recommendation["refused"] = [];
  const candidates: Headroom[] = [];
  for (const h of all) {
    if (h.plan.id === source.id) continue;
    const may = mayMove(source, h.plan);
    if (!may.ok) {
      refused.push({ plan: h.plan.id, why: may.why });
      continue;
    }
    if (!h.known) {
      refused.push({ plan: h.plan.id, why: h.notes[0] ?? "no reading" });
      continue;
    }
    if (h.stale) {
      refused.push({ plan: h.plan.id, why: `its last reading is too old to rely on` });
      continue;
    }
    const p = pressed(h, policy);
    if (p.yes) {
      refused.push({ plan: h.plan.id, why: p.why.join("; ") });
      continue;
    }
    candidates.push(h);
  }
  // The most room first; a plan with a fixed price before one paid by the token, since it costs nothing more.
  candidates.sort((a, b) => Number(a.perToken) - Number(b.perToken) || (b.remainingPct ?? 100) - (a.remainingPct ?? 100) || a.plan.id.localeCompare(b.plan.id));
  const target = candidates[0];
  if (target) {
    return {
      ...empty,
      action: "route",
      to: target.plan.id,
      code: "route",
      reasons: [...press.why, target.perToken ? `${target.plan.label} is paid by the token, so this costs money; it has no window to fill` : `${target.plan.label} has ${target.remainingPct?.toFixed(0)}% of its ${target.binding ?? "window"} left`],
      checkpoint: true,
      considered: all,
      refused,
      costsMoney: target.perToken,
    };
  }
  // Nowhere to go: wait for the reset when it is near enough to be worth waiting for, and otherwise refuse with the reason. Nothing is dropped.
  const reset = here.minutesToReset;
  if (reset !== null && reset <= 24 * 60) {
    return { ...empty, action: "wait", code: "wait_for_reset", reasons: [...press.why, `no other plan of yours has room; ${source.label} resets in ${reset} minutes`], checkpoint: true, waitMinutes: reset, considered: all, refused };
  }
  return { ...empty, action: "refuse", code: "quota_runway_depleted", reasons: [...press.why, "no other plan of yours has room, and the reset is not near"], checkpoint: true, considered: all, refused };
}
