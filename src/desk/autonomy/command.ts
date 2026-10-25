import { callGate } from "../gate/client.ts";
import type { Ledger } from "../ledger/db.ts";
import type { TaskMarker } from "../tasks/identity.ts";
import { AUTONOMY, TIERS, type Decision, type Tier } from "./matrix.ts";
import { applyDecisions, approvePromotion, echoOf, evaluateAll, history, setBlocked, storedTiers } from "./store.ts";

const n = (x: number): string => x.toLocaleString("en-US");
const pct = (x: number | null): string => (x === null ? "none" : `${(x * 100).toFixed(1)}%`);

export interface PushResult {
  ok: boolean;
  detail: string;
}
export type Push = (changes: { workflow: string; tier: Tier; reason: string }[]) => Promise<PushResult>;

export interface AutonomyOptions {
  nowMs?: number;
  markers?: readonly TaskMarker[];
  /** Tell the gate. Without it the command says the gate was not told. */
  push?: Push;
  apply?: boolean;
  echo?: string;
  reason?: string;
}

/** Push to the gate's owner route. The URL and token come from the environment; a missing token is said, not guessed around. */
export function gatePush(env: Readonly<Record<string, string | undefined>>): Push | undefined {
  const token = env["DESK_GATE_OWNER_TOKEN"];
  if (token === undefined || token.length === 0) return undefined;
  const url = env["DESK_GATE_URL"] ?? "http://127.0.0.1:8765";
  return async (changes) => {
    try {
      const r = await callGate(url, token, "/v1/admin/autonomy", { set: changes }, 3_000);
      return r.status === 200 ? { ok: true, detail: `the gate at ${url} now holds ${changes.length} tier${changes.length === 1 ? "" : "s"}` } : { ok: false, detail: `the gate at ${url} answered ${r.status}` };
    } catch (e) {
      return { ok: false, detail: `the gate at ${url} could not be reached (${(e as Error).message.slice(0, 80)})` };
    }
  };
}

function line(d: Decision): string {
  const e = d.evidence;
  const rate = e.n === 0 ? "no finished run" : `${e.success} of ${n(e.n)} landed and stayed (${pct(e.rate)}, lower bound ${pct(e.lower)})`;
  const extra = [e.pending > 0 ? `${n(e.pending)} not settled` : "", e.unlinked > 0 ? `${n(e.unlinked)} not tied to a commit` : ""].filter((x) => x !== "").join(", ");
  return `  ${d.workflow.padEnd(14)} ${d.tier.padEnd(16)} ${rate}${extra ? `; ${extra}` : ""}\n  ${" ".repeat(14)} ${d.action === "none" || d.action === "hold" ? "" : `${d.action === "demote" ? "demote" : "propose guarded_auto"}: `}${d.reason}${d.action === "propose_promotion" ? `\n  ${" ".repeat(14)} to approve: desk autonomy approve ${d.workflow} ${echoOf(d.digest)}` : ""}`;
}

async function pushAll(db: Ledger, push: Push | undefined): Promise<PushResult> {
  const all = [...storedTiers(db).values()];
  if (all.length === 0) return { ok: true, detail: "nothing to tell the gate" };
  if (push === undefined) return { ok: false, detail: "the gate was not told: set DESK_GATE_OWNER_TOKEN (and DESK_GATE_URL if it is not at http://127.0.0.1:8765), then run this again" };
  return push(all.map((t) => ({ workflow: t.workflow, tier: t.tier, reason: t.reason })));
}

/** `desk autonomy ...`: what each kind of work has earned, and the owner's say over it. */
export async function autonomyCommand(args: readonly string[], db: Ledger, o: AutonomyOptions = {}): Promise<{ ok: boolean; text: string }> {
  const [sub, ...rest] = args;
  const now = o.nowMs ?? Date.now();
  if (sub === undefined || sub === "status") {
    const ds = evaluateAll(db, now, o.markers);
    if (ds.length === 0) return { ok: true, text: "No finished or unfinished run in the ledger has been tied to a commit yet, so no kind of work has a record to judge. Run desk landing first." };
    const head = `What each kind of work has earned (a run is judged once its work is ${AUTONOMY.settleDays} days old; ${AUTONOMY.minTasks} finished runs and a lower bound of ${pct(AUTONOMY.promoteLowerBound)} earn guarded_auto):`;
    return { ok: true, text: [head, ...ds.map(line), "", "Every kind starts supervised: the gate asks you at a soft limit. A promoted kind goes back the moment a commit of it is reverted within 7 days, or its lower bound drops under 85%."].join("\n") };
  }
  if (sub === "evaluate") {
    const ds = evaluateAll(db, now, o.markers);
    const lines = ds.length === 0 ? ["No kind of work has a record yet."] : ds.map(line);
    if (!o.apply) return { ok: true, text: [...lines, "", "Nothing was changed. desk autonomy evaluate --apply demotes where the evidence says to, records the promotions it proposes, and tells the gate."].join("\n") };
    const applied = applyDecisions(db, ds, now);
    const told = await pushAll(db, o.push);
    const out = [...lines, ""];
    for (const d of applied.demoted) out.push(`Demoted ${d.workflow} to supervised: ${d.reason}.`);
    for (const d of applied.proposed) out.push(`Proposed ${d.workflow} for guarded_auto. Nothing changes until you approve: desk autonomy approve ${d.workflow} ${echoOf(d.digest)}`);
    if (applied.demoted.length === 0 && applied.proposed.length === 0) out.push("No tier changed and no new promotion is proposed.");
    out.push(`Gate: ${told.detail}.`);
    return { ok: told.ok, text: out.join("\n") };
  }
  if (sub === "approve") {
    const [workflow, echoArg] = rest;
    if (!workflow) throw new Error("Use: desk autonomy approve <kind of work> <evidence code>   (desk autonomy status prints the code)");
    const r = approvePromotion(db, workflow, echoArg ?? o.echo ?? "", now, o.markers);
    if (!r.ok) return { ok: false, text: r.reason };
    const told = await pushAll(db, o.push);
    return { ok: told.ok, text: [`Promoted ${workflow} to guarded_auto: ${r.decision.reason}.`, `Gate: ${told.detail}.`, told.ok ? "A soft limit no longer asks about this kind of work; a hard cap, a forbidden action and a revert within 7 days still stop it." : "The ledger holds the promotion, but the gate does not enforce it until it is told."].join("\n") };
  }
  if (sub === "block" || sub === "unblock") {
    const [workflow] = rest;
    if (!workflow) throw new Error(`Use: desk autonomy ${sub} <kind of work>`);
    const r = setBlocked(db, workflow, sub === "block", now, o.reason ?? (sub === "block" ? "blocked by the owner" : "block lifted by the owner"));
    if (!r.ok) return { ok: false, text: r.message };
    const told = await pushAll(db, o.push);
    return { ok: told.ok, text: `${r.message}\nGate: ${told.detail}.` };
  }
  if (sub === "history") {
    const [workflow] = rest;
    if (!workflow) throw new Error("Use: desk autonomy history <kind of work>");
    const h = history(db, workflow, 20);
    return { ok: true, text: h.length === 0 ? `No change has been recorded for "${workflow}".` : [`Changes to "${workflow}", newest first:`, ...h.map((x) => `  ${x.at.slice(0, 16).replace("T", " ")}  ${x.kind.padEnd(9)} ${x.from ?? "-"} to ${x.to ?? "-"}: ${x.reason}`)].join("\n") };
  }
  throw new Error(`Use: desk autonomy status | evaluate [--apply] | approve <kind> <code> | block <kind> | unblock <kind> | history <kind>   (tiers: ${TIERS.join(", ")})`);
}
