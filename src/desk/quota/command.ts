import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Ledger } from "../ledger/db.ts";
import { plansView, type PlansView } from "../limits/plans.ts";
import { DEFAULT_POLICY, headroomOf, pressed, recommend, type Headroom, type OwnedPlan, type Recommendation, type RouterPolicy } from "./router.ts";
import { dispatches, heldReserves, logDispatch, plansFor, releaseDispatch } from "./store.ts";

const pct = (x: number | null): string => (x === null ? "no figure" : `${x.toFixed(0)}% left`);

function headroomLine(h: Headroom, p: RouterPolicy, held: number): string {
  if (h.perToken) return `  ${h.plan.label} (${h.plan.id}): paid by the token, no window`;
  if (!h.known) return `  ${h.plan.label} (${h.plan.id}): no report of its own windows, so nothing is said about its room`;
  const bits = [pct(h.remainingPct), h.binding ? `tightest: ${h.binding}` : null, h.minutesToReset !== null ? `resets in ${h.minutesToReset} min` : null, h.minutesToFull !== null ? `at the last hour's pace full in ${h.minutesToFull} min` : null, h.stale ? "reading is old" : null].filter((x): x is string => x !== null);
  const press = pressed(h, p);
  return `  ${h.plan.label} (${h.plan.id}): ${bits.join("; ")}${press.yes ? "  <- close to a limit" : ""}${held > 0 ? `; ${held.toLocaleString("en-US")} tokens held back for a handoff` : ""}`;
}

export function renderRecommendation(r: Recommendation, plans: readonly OwnedPlan[]): string {
  const label = (id: string | null): string => plans.find((p) => p.id === id)?.label ?? id ?? "none";
  const head =
    r.action === "stay"
      ? r.code === "no_reading"
        ? `Stay on ${label(r.from)}: nothing can be said about its room.`
        : `Stay on ${label(r.from)}.`
      : r.action === "route"
        ? `Move the next task from ${label(r.from)} to ${label(r.to)}.`
        : r.action === "wait"
          ? `Wait for ${label(r.from)} to reset in ${r.waitMinutes} minutes; no other plan of yours has room.`
          : `Do not start the task: ${r.code === "quota_runway_depleted" ? "quota_runway_depleted" : "refused"}. No other plan of yours has room, and the reset is not near.`;
  const out = [head, ...r.reasons.map((x) => `  ${x}.`)];
  if (r.costsMoney) out.push("  This one is paid by the token, so it costs money beyond the plan.");
  if (r.checkpoint) out.push(`  Write the handoff first (${r.reserveTokens.toLocaleString("en-US")} tokens are held back on ${label(r.from)} for it), then stop on ${label(r.from)}.`);
  for (const x of r.refused) out.push(`  Not an option: ${label(x.plan)}: ${x.why}.`);
  return out.join("\n");
}

export function quotaHandoff(r: Recommendation, plans: readonly OwnedPlan[], id: number, at: string, task: string | null): string {
  const label = (p: string | null): string => plans.find((x) => x.id === p)?.label ?? p ?? "none";
  return [
    `# Handoff ${id}: ${label(r.from)} is close to a limit`,
    "",
    `Written ${at}${task ? ` for a task of type ${task}` : ""}.`,
    "",
    ...r.reasons.map((x) => `- ${x}.`),
    "",
    r.action === "route" ? `Continue on ${label(r.to)}.` : r.action === "wait" ? `Resume on ${label(r.from)} in ${r.waitMinutes} minutes, when it resets.` : "No plan of yours has room now.",
    "",
    "## Where the work stands",
    "",
    "Write below what is done, what is open, and the branch, so that the next session can pick this up from here.",
    "",
  ].join("\n");
}

export interface QuotaOptions {
  db: Ledger;
  now: Date;
  plansFile: string | null;
  policy?: RouterPolicy;
}

export function quotaStatus(o: QuotaOptions): { text: string; plans: OwnedPlan[]; view: PlansView } {
  const plans = plansFor(o.db, o.plansFile);
  const view = plansView(o.db, o.now);
  const policy = o.policy ?? DEFAULT_POLICY;
  if (plans.length === 0) return { text: "No plans to read: the ledger holds no Claude Code or Codex sessions, and no plans file lists any. List the plans you hold with --plans <file>.", plans, view };
  const held = heldReserves(o.db);
  const lines = ["Where each of your plans stands", ...plans.map((p) => headroomLine(headroomOf(p, view), policy, held.get(p.id) ?? 0))];
  const pressedPlans = plans.filter((p) => pressed(headroomOf(p, view), policy).yes);
  if (pressedPlans.length === 0) lines.push("", "None is close to a limit.");
  else for (const p of pressedPlans) lines.push("", renderRecommendation(recommend({ from: p.id, plans, view, policy }), plans));
  return { text: lines.join("\n"), plans, view };
}

export interface NextOptions extends QuotaOptions {
  from: string;
  task: string | null;
  dryRun: boolean;
  handoffDir: string;
}

export function quotaNext(o: NextOptions): { text: string; recommendation: Recommendation; dispatchId: number | null; handoff: string | null } {
  const plans = plansFor(o.db, o.plansFile);
  const view = plansView(o.db, o.now);
  const recommendation = recommend({ from: o.from, plans, view, ...(o.policy ? { policy: o.policy } : {}) });
  const lines = [renderRecommendation(recommendation, plans)];
  let id: number | null = null;
  let handoff: string | null = null;
  if (!o.dryRun && plans.some((p) => p.id === o.from)) {
    id = logDispatch(o.db, recommendation, o.now.toISOString(), o.task);
    if (recommendation.checkpoint) {
      handoff = join(o.handoffDir, `quota-handoff-${id}.md`);
      mkdirSync(dirname(handoff), { recursive: true });
      writeFileSync(handoff, quotaHandoff(recommendation, plans, id, o.now.toISOString(), o.task));
      lines.push(`  Handoff file: ${handoff}`);
    }
    lines.push(`  Logged as dispatch ${id}${recommendation.checkpoint ? `; release the held tokens with: desk quota release ${id}` : ""}.`);
  } else if (o.dryRun) lines.push("  Dry run: nothing was logged and no handoff was written.");
  return { text: lines.join("\n"), recommendation, dispatchId: id, handoff };
}

export function quotaHistory(o: { db: Ledger; days: number; now: Date }): string {
  const rows = dispatches(o.db, { sinceIso: new Date(o.now.getTime() - o.days * 86_400_000).toISOString() });
  if (rows.length === 0) return `No routing decision in the last ${o.days} days.`;
  return rows.map((d) => `${d.id}  ${d.decidedAt.slice(0, 16).replace("T", " ")}  ${d.action.padEnd(6)} ${d.from}${d.to ? ` -> ${d.to}` : ""}${d.waitMinutes !== null ? ` (wait ${d.waitMinutes} min)` : ""}${d.reserveTokens > 0 ? `  held ${d.reserveTokens.toLocaleString("en-US")} tokens${d.releasedAt ? `, released ${d.releasedAt.slice(0, 16).replace("T", " ")}` : ""}` : ""}  ${d.reasons[0] ?? ""}`).join("\n");
}

export function quotaRelease(o: { db: Ledger; id: number; now: Date }): string {
  return releaseDispatch(o.db, o.id, o.now.toISOString()) ? `Released the tokens held back for dispatch ${o.id}.` : `Dispatch ${o.id} holds nothing to release (it does not exist, holds no reserve, or was released already).`;
}
