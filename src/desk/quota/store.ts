import { existsSync, readFileSync } from "node:fs";

import type { Ledger } from "../ledger/db.ts";
import type { OwnedPlan, PlanKind, Recommendation } from "./router.ts";

/** The vendor behind a tool whose windows are reported. A tool the Desk does not know is its own vendor. */
export function vendorOf(tool: string): string {
  if (tool === "claude_code" || tool === "claude") return "anthropic";
  if (tool === "codex" || tool === "openai") return "openai";
  return tool;
}

const LABELS: Record<string, string> = { claude_code: "Claude Code", codex: "Codex" };

/**
 * The plans the router may move work between: one subscription plan for each tool that has sessions in the ledger (the account is the owner's own), and anything the owner
 * lists in a file. A listed plan with the same id replaces the inferred one. The file is the owner's statement of what they hold; the router does not look for accounts.
 */
export function inferPlans(db: Ledger): OwnedPlan[] {
  const tools = (db.prepare("SELECT DISTINCT tool FROM session ORDER BY tool").all() as unknown as { tool: string }[]).map((r) => r.tool).filter((t) => t === "claude_code" || t === "codex");
  return tools.map((tool) => ({ id: tool, tool, vendor: vendorOf(tool), account: "owner", kind: "subscription" as PlanKind, label: LABELS[tool] ?? tool }));
}

export class PlansFileError extends Error {}

export function readPlansFile(path: string): OwnedPlan[] {
  if (!existsSync(path)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new PlansFileError(`${path} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const list = (raw as { plans?: unknown }).plans;
  if (!Array.isArray(list)) throw new PlansFileError(`${path} must hold {"plans": [...]}`);
  return list.map((p, i): OwnedPlan => {
    const o = p as Record<string, unknown>;
    for (const k of ["id", "tool", "vendor", "account", "label"] as const) {
      if (typeof o[k] !== "string" || (o[k] as string).trim() === "") throw new PlansFileError(`${path}: plan ${i + 1} needs a non-empty "${k}"`);
    }
    if (o["kind"] !== "subscription" && o["kind"] !== "api_key") throw new PlansFileError(`${path}: plan ${i + 1} needs "kind": "subscription" or "api_key"`);
    return { id: o["id"] as string, tool: o["tool"] as string, vendor: o["vendor"] as string, account: o["account"] as string, kind: o["kind"] as PlanKind, label: o["label"] as string };
  });
}

export function plansFor(db: Ledger, file: string | null): OwnedPlan[] {
  const byId = new Map(inferPlans(db).map((p) => [p.id, p]));
  if (file) for (const p of readPlansFile(file)) byId.set(p.id, p);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export interface Dispatch {
  id: number;
  decidedAt: string;
  from: string;
  to: string | null;
  action: string;
  code: string | null;
  reasons: string[];
  reserveTokens: number;
  checkpoint: boolean;
  waitMinutes: number | null;
  task: string | null;
  releasedAt: string | null;
}

export function logDispatch(db: Ledger, r: Recommendation, at: string, task: string | null): number {
  // A reserve is held only when work is leaving the plan: staying on it keeps nothing back.
  const reserve = r.action === "stay" ? 0 : r.reserveTokens;
  const res = db
    .prepare("INSERT INTO route_dispatch (decided_at, from_plan, to_plan, action, code, reasons, reserve_tokens, checkpoint, wait_minutes, task) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(at, r.from, r.to, r.action, r.code, JSON.stringify(r.reasons), reserve, r.checkpoint ? 1 : 0, r.waitMinutes, task);
  return Number(res.lastInsertRowid);
}

const rowOf = (r: Record<string, unknown>): Dispatch => ({
  id: Number(r["dispatch_id"]),
  decidedAt: String(r["decided_at"]),
  from: String(r["from_plan"]),
  to: r["to_plan"] === null ? null : String(r["to_plan"]),
  action: String(r["action"]),
  code: r["code"] === null ? null : String(r["code"]),
  reasons: JSON.parse(String(r["reasons"])) as string[],
  reserveTokens: Number(r["reserve_tokens"]),
  checkpoint: Number(r["checkpoint"]) === 1,
  waitMinutes: r["wait_minutes"] === null ? null : Number(r["wait_minutes"]),
  task: r["task"] === null ? null : String(r["task"]),
  releasedAt: r["released_at"] === null ? null : String(r["released_at"]),
});

export function dispatches(db: Ledger, o: { sinceIso?: string; limit?: number } = {}): Dispatch[] {
  const rows = db.prepare("SELECT * FROM route_dispatch WHERE decided_at >= ? ORDER BY dispatch_id DESC LIMIT ?").all(o.sinceIso ?? "0000", o.limit ?? 100) as unknown as Record<string, unknown>[];
  return rows.map(rowOf);
}

/** The reserve kept back for a handoff is released once the handoff is written or the plan has reset. */
export function releaseDispatch(db: Ledger, id: number, at: string): boolean {
  return Number(db.prepare("UPDATE route_dispatch SET released_at = ? WHERE dispatch_id = ? AND released_at IS NULL AND reserve_tokens > 0").run(at, id).changes) > 0;
}

/** Tokens held back right now on each plan, for reserves not yet released. */
export function heldReserves(db: Ledger): Map<string, number> {
  const rows = db.prepare("SELECT from_plan AS plan, SUM(reserve_tokens) AS n FROM route_dispatch WHERE released_at IS NULL AND reserve_tokens > 0 GROUP BY from_plan").all() as unknown as { plan: string; n: number }[];
  return new Map(rows.map((r) => [r.plan, r.n]));
}
