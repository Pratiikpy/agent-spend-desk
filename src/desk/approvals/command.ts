import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { ApprovalService } from "../dossier/approval.ts";
import { ephemeralSigner } from "../dossier/keys.ts";
import { formatUsd } from "../money.ts";
import { approvalHabit, openRequests, renderHabit, type PendingApproval } from "./habit.ts";

export interface ApprovalsPaths {
  dbPath: string;
}

export interface ApprovalsResult {
  text: string;
  ok: boolean;
}

const DAY = 86_400_000;

function until(iso: string, nowMs: number): string {
  const s = Math.round((Date.parse(iso) - nowMs) / 1000);
  if (s <= 0) return `ran out ${s > -90 ? `${-s} seconds` : s > -5400 ? `${Math.round(-s / 60)} minutes` : `${Math.round(-s / 3600)} hours`} ago`;
  return s < 90 ? `${s} seconds` : s < 5400 ? `${Math.round(s / 60)} minutes` : `${Math.round(s / 3600)} hours`;
}

/** Find one open request by its id or by a unique start of it (at least 6 characters, as `desk questions` allows). */
function find(open: PendingApproval[], given: string): PendingApproval | string {
  if (given === "") return "Name the request: desk approvals show <id>. `desk approvals` lists them.";
  const hits = open.filter((r) => r.requestId === given || (given.length >= 6 && r.requestId.startsWith(given)));
  if (hits.length === 1) return hits[0] as PendingApproval;
  if (hits.length > 1) return `"${given}" starts ${hits.length} requests; give more of the id.`;
  return `No open request starts with "${given}". \`desk approvals\` lists the open ones.`;
}

function card(r: PendingApproval, nowMs: number): string[] {
  const c = r.card;
  const diff = c.diff as { added?: string[] } | null;
  const replay = c.replay as { paused: number; landed_blocked: number; saved_micros: number } | null;
  const restrict = c.restrict as { narrows: boolean; grid_size: number } | null;
  const lines = [`Approval request ${r.requestId}`, `  action: ${r.actionKind.replaceAll("_", " ")}`, `  expires: in ${until(r.expiresAt, nowMs)}`];
  if (diff?.added && diff.added.length > 0) lines.push(`  rules added: ${diff.added.join(", ")}`);
  if (replay) lines.push(`  replay on the held-out period: ${replay.paused} sessions paused, ${replay.landed_blocked} of them with work that landed, ${formatUsd(replay.saved_micros)} not spent (an upper bound)`);
  if (restrict) lines.push(`  restrict check: ${restrict.narrows ? `narrows only, over all ${restrict.grid_size} cells` : "WIDENS the policy: do not approve"}`);
  lines.push(`  dollars affected: ${formatUsd(c.dollars_affected_micros)}; tasks affected: ${c.tasks_affected}`);
  const evasions = c.unresolved_evasions ?? [];
  if (evasions.length > 0) {
    lines.push(`  UNRESOLVED: the attacker found ${evasions.length} request${evasions.length === 1 ? "" : "s"} this policy still ${evasions.some((e) => e.verdict === "allow") ? "allows" : "only asks about"}:`);
    for (const e of evasions) lines.push(`    ${e.action} for ${e.waste_rule} with ${formatUsd(e.recoverable_micros)} recoverable${e.dimension ? `, stepping around ${e.dimension.replaceAll("_", " ")}` : ""}: ${e.verdict}`);
  } else if (c.unresolved_evasions !== undefined) lines.push("  The attacker found no request the policy still allows.");
  for (const s of c.claims) lines.push(`  ${s}`);
  lines.push("", `  action digest ${r.actionDigest}`);
  return lines;
}

/**
 * `desk approvals`: what is waiting, how decisions have been made, and the one way to read the evidence behind a card.
 * Showing a card is what the Desk counts as opening the evidence, so the monthly record of approvals made without it is real.
 */
export function approvalsCommand(sub: string | undefined, arg: string | undefined, paths: ApprovalsPaths, o: { now?: Date; days?: number } = {}): ApprovalsResult {
  const now = o.now ?? new Date();
  if (!existsSync(paths.dbPath)) return { ok: true, text: "No approval has ever been requested: there is no approval record yet. `desk propose --dossier` or `desk close --policy FILE --ask-approval` issues one." };
  const db = new DatabaseSync(paths.dbPath);
  try {
    const svc = new ApprovalService(db, ephemeralSigner(), () => now);
    const days = o.days ?? 30;
    if (sub === undefined || sub === "list" || sub === "habit") {
      const open = openRequests(db);
      const habit = approvalHabit(db, new Date(now.getTime() - days * DAY).toISOString(), new Date(now.getTime() + 1000).toISOString(), now.toISOString());
      const lines: string[] = [];
      if (sub !== "habit") {
        const waiting = open.filter((r) => r.expiresAt > now.toISOString());
        const lapsed = open.length - waiting.length;
        if (waiting.length === 0) lines.push("Nothing is waiting for your approval.");
        for (const r of waiting) lines.push(`${r.requestId}  ${r.actionKind.replaceAll("_", " ")}, expires in ${until(r.expiresAt, now.getTime())}, ${r.evidenceOpened ? "evidence opened" : "evidence not opened yet"}: desk approvals show ${r.requestId.slice(0, 8)}`);
        if (lapsed > 0) lines.push(`${lapsed} older request${lapsed === 1 ? "" : "s"} ran out of time with no answer.`);
        lines.push("");
      }
      lines.push(`Approvals, the last ${days} days:`, ...renderHabit(habit, `in the last ${days} days`).map((l) => `  ${l}`));
      return { ok: true, text: lines.join("\n") };
    }
    if (sub === "show" || sub === "deny") {
      const open = openRequests(db);
      const r = find(open, arg ?? "");
      if (typeof r === "string") return { ok: false, text: r };
      if (r.expiresAt <= now.toISOString()) return { ok: false, text: `Request ${r.requestId} ${until(r.expiresAt, now.getTime())}. It can no longer be approved; ask for a new one.` };
      if (sub === "show") {
        svc.present(r.requestId);
        svc.openEvidence(r.requestId);
        return { ok: true, text: [...card(r, now.getTime()), "", `  approve: desk approve ${r.requestId} ${r.actionDigest}`, `  deny:    desk approvals deny ${r.requestId.slice(0, 8)}`].join("\n") };
      }
      // A denial needs no echo from the owner: the digest is taken from the request, and a denial is always honoured.
      const out = svc.respond({ approvalRequestId: r.requestId, actionDigest: r.actionDigest, decision: "deny" }, { approver: "owner", verified: true }, { policyVersion: "", chainVersion: "" });
      if (out.status === "denied") return { ok: true, text: `Denied request ${r.requestId}. Nothing was changed.` };
      return { ok: false, text: `Not denied: ${out.status === "refused" ? out.reason.replaceAll("_", " ") : "unexpected outcome"}.` };
    }
    return { ok: false, text: `desk approvals: unknown subcommand "${sub}". Use: list, show <id>, deny <id>, habit.` };
  } finally {
    db.close();
  }
}
