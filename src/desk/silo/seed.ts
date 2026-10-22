import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { Ledger } from "../ledger/db.ts";
import { personOfBranch } from "../replay/from-ledger.ts";

/**
 * Seed files for the three synthetic organisational silos that Zetaris joins (spec 5.7, 13.1, 25.2), derived from
 * the constructed sample so that the silo facts describe the same team the logs describe:
 *   invoices   provider invoice lines per team, day and model, as CSV files for an S3-style bucket;
 *   ci         one pull-request row per commit, as SQL for a Postgres database;
 *   roster     teams and seats, as a JSON file for a REST endpoint.
 * Every value here is SYNTHETIC (spec 5.9, D7). Invoice amounts are the ledger's list-price estimate times a
 * per-team-month factor between 0.93 and 1.03, because a real invoice differs from a list-price estimate and the
 * reconciliation has to show a real difference rather than agree by construction. The CI result per commit is
 * drawn from the commit hash (about 9% red), so it is repeatable.
 */
export const TEAM_OF_REPO: Record<string, string> = {
  "payments-api": "payments",
  "web-app": "growth",
  "mobile-client": "growth",
  "data-pipeline": "discovery",
  infra: "platform",
};

export const SEATS: Record<string, { plan: string; price: number }> = {
  payments: { plan: "claude-max-5x", price: 100 },
  growth: { plan: "cursor-pro", price: 20 },
  discovery: { plan: "claude-max-5x", price: 100 },
  platform: { plan: "claude-max-5x", price: 100 },
};

const unit = (key: string): number => parseInt(createHash("sha256").update(key).digest("hex").slice(0, 8), 16) / 0xffffffff;

export function invoiceFactor(team: string, month: string): number {
  return Math.round((0.93 + unit(`invoice|${team}|${month}`) * 0.1) * 10_000) / 10_000;
}

export function ciGreen(sha: string): boolean {
  return unit(`ci|${sha}`) >= 0.09;
}

const sqlText = (s: string): string => `'${s.replaceAll("'", "''")}'`;
const csvCell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

export interface InvoiceLine {
  invoiceId: string;
  vendor: string;
  workspace: string;
  day: string;
  sku: string;
  model: string;
  unit: string;
  quantity: number;
  amountUsd: number;
}

export interface PrRow {
  prId: number;
  repo: string;
  team: string;
  headSha: string;
  mergedAt: string | null;
  checksGreen: boolean;
  reverted: boolean;
}

export interface RosterRow {
  team: string;
  lead: string;
  seats: number;
  seatPlan: string;
  seatPriceUsd: number;
}

export interface SiloSeed {
  invoiceLines: InvoiceLine[];
  pullRequests: PrRow[];
  roster: RosterRow[];
}

/** Read the sample ledger (after `desk landing` linked the repositories) and derive the three silos. */
export function deriveSeed(db: Ledger): SiloSeed {
  const calls = db
    .prepare(
      `SELECT s.project_path AS project, substr(m.ts, 1, 10) AS day, m.model AS model, SUM(c.total_micros) AS micros,
              SUM(m.input_tokens + m.output_tokens + m.cache_read_tokens + m.cache_write_5m_tokens + m.cache_write_1h_tokens) AS tokens
       FROM model_call m JOIN cost_event c ON c.call_id = m.call_id JOIN session s ON s.session_id = m.session_id
       WHERE c.class = 'estimated' GROUP BY project, day, model`,
    )
    .all() as unknown as { project: string | null; day: string; model: string; micros: number; tokens: number }[];
  const byKey = new Map<string, { team: string; day: string; model: string; micros: number; tokens: number }>();
  for (const c of calls) {
    const repo = c.project ? basename(c.project.replaceAll("\\", "/")) : "";
    const team = TEAM_OF_REPO[repo];
    if (!team) continue;
    const k = `${team}|${c.day}|${c.model}`;
    const e = byKey.get(k) ?? { team, day: c.day, model: c.model, micros: 0, tokens: 0 };
    e.micros += c.micros;
    e.tokens += c.tokens;
    byKey.set(k, e);
  }
  const invoiceLines: InvoiceLine[] = [...byKey.values()]
    .sort((a, b) => a.day.localeCompare(b.day) || a.team.localeCompare(b.team) || a.model.localeCompare(b.model))
    .map((e) => {
      const month = e.day.slice(0, 7);
      return {
        invoiceId: `INV-${e.team.toUpperCase()}-${month}`,
        vendor: "anthropic",
        workspace: e.team,
        day: e.day,
        sku: "api-usage",
        model: e.model,
        unit: "mtok",
        quantity: Math.round((e.tokens / 1e6) * 1e6) / 1e6,
        amountUsd: Math.round((e.micros / 1e6) * invoiceFactor(e.team, month) * 1e6) / 1e6,
      };
    });

  const commits = db
    .prepare(
      `SELECT r.root AS root, g.sha AS sha, g.authored_at AS at, g.merged AS merged, g.reverted AS reverted
       FROM git_commit g JOIN repo r ON r.repo_id = g.repo_id ORDER BY g.authored_at, g.sha`,
    )
    .all() as unknown as { root: string; sha: string; at: string; merged: number; reverted: number }[];
  const pullRequests: PrRow[] = [];
  for (const c of commits) {
    const repo = basename(c.root.replaceAll("\\", "/"));
    const team = TEAM_OF_REPO[repo];
    if (!team) continue;
    pullRequests.push({ prId: pullRequests.length + 1, repo, team, headSha: c.sha, mergedAt: c.merged ? c.at.replace("T", " ").replace(/(Z|[+-]\d\d:\d\d)$/, "").slice(0, 19) : null, checksGreen: ciGreen(c.sha), reverted: c.reverted === 1 });
  }

  const people = db.prepare("SELECT project_path AS project, git_branch AS branch FROM session").all() as unknown as { project: string | null; branch: string | null }[];
  // A seat belongs to the team where its holder opened most sessions per repository the team owns, so a team with
  // two repositories does not collect every seat.
  const reposOf = (team: string): number => Object.values(TEAM_OF_REPO).filter((t) => t === team).length;
  const counts = new Map<string, Map<string, number>>();
  for (const p of people) {
    const team = p.project ? TEAM_OF_REPO[basename(p.project.replaceAll("\\", "/"))] : undefined;
    const who = personOfBranch(p.branch);
    if (!team || !who) continue;
    const perTeam = counts.get(who) ?? new Map<string, number>();
    perTeam.set(team, (perTeam.get(team) ?? 0) + 1);
    counts.set(who, perTeam);
  }
  const byTeam = new Map<string, Set<string>>();
  for (const [who, perTeam] of counts) {
    const [home] = [...perTeam].sort((a, b) => b[1] / reposOf(b[0]) - a[1] / reposOf(a[0]) || a[0].localeCompare(b[0]))[0]!;
    (byTeam.get(home) ?? byTeam.set(home, new Set()).get(home)!).add(who);
  }
  const roster: RosterRow[] = Object.keys(SEATS)
    .sort()
    .map((team, i) => ({ team, lead: `Team Lead ${String.fromCharCode(65 + i)}`, seats: byTeam.get(team)?.size ?? 0, seatPlan: SEATS[team]!.plan, seatPriceUsd: SEATS[team]!.price }))
    .filter((r) => r.seats > 0);
  return { invoiceLines, pullRequests, roster };
}

export function invoicesCsv(lines: readonly InvoiceLine[]): string {
  const head = "invoice_id,vendor,workspace,day,sku,model,unit,quantity,amount_usd";
  return [head, ...lines.map((l) => [l.invoiceId, l.vendor, l.workspace, l.day, l.sku, l.model, l.unit, String(l.quantity), l.amountUsd.toFixed(6)].map(csvCell).join(","))].join("\n") + "\n";
}

export function ciSql(prs: readonly PrRow[]): string {
  const out = [
    "-- Synthetic CI and pull-request silo, derived from the constructed sample. All rows are invented.",
    "DROP TABLE IF EXISTS pull_requests;",
    "CREATE TABLE pull_requests (",
    "  pr_id        INTEGER PRIMARY KEY,",
    "  repo         TEXT NOT NULL,",
    "  team         TEXT NOT NULL,",
    "  head_sha     TEXT NOT NULL,",
    "  merged_at    TIMESTAMP,",
    "  checks_green BOOLEAN NOT NULL,",
    "  reverted     BOOLEAN NOT NULL DEFAULT FALSE",
    ");",
  ];
  const chunk = 400;
  for (let i = 0; i < prs.length; i += chunk) {
    const rows = prs.slice(i, i + chunk).map((p) => `(${p.prId}, ${sqlText(p.repo)}, ${sqlText(p.team)}, ${sqlText(p.headSha)}, ${p.mergedAt ? sqlText(p.mergedAt) : "NULL"}, ${p.checksGreen ? "TRUE" : "FALSE"}, ${p.reverted ? "TRUE" : "FALSE"})`);
    out.push(`INSERT INTO pull_requests VALUES\n  ${rows.join(",\n  ")};`);
  }
  return out.join("\n") + "\n";
}

export function rosterJson(roster: readonly RosterRow[]): string {
  return JSON.stringify(roster.map((r) => ({ team: r.team, lead: r.lead, seats: r.seats, seat_plan: r.seatPlan, seat_price_usd: r.seatPriceUsd })), null, 2) + "\n";
}

/** Write the three seed files under `dir`; returns their paths. */
export function writeSeed(seed: SiloSeed, dir: string): { invoices: string; ci: string; roster: string } {
  const invoices = join(dir, "invoices", "sample", "invoice-lines.csv");
  const ci = join(dir, "ci-seed.sql");
  const roster = join(dir, "roster", "roster.json");
  for (const p of [invoices, ci, roster]) mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(invoices, invoicesCsv(seed.invoiceLines));
  writeFileSync(ci, ciSql(seed.pullRequests));
  writeFileSync(roster, rosterJson(seed.roster));
  return { invoices, ci, roster };
}
