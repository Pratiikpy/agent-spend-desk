import { CAUSES, analyseCalls, buildAutopsy, type Cause } from "../autopsy/engine.ts";
import { CAUSE_LABEL } from "../autopsy/card.ts";
import { loadAutopsyCalls } from "../autopsy/load.ts";
import type { Ledger } from "../ledger/db.ts";
import { limitGroups, groupLabel } from "../limits/fit.ts";
import { runwayFromLedger, runwayHead, runwayDetail } from "../limits/runway.ts";
import { formatUsd } from "../money.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import type { StatuslineSample } from "../statusline/statusline.ts";

/**
 * The live gauge (DF-003): what the work in the last few hours has cost, how fast, what each part of it is, and where the
 * plan's windows stand. Every figure is read from the ledger the Desk already keeps, so it equals the Bill and the autopsy
 * for the same span. A figure the sources do not have is `null` with the reason in `notes`, never zero; a plan reading older
 * than ten minutes is dropped, because a stale percent is worse than none.
 */
export interface GaugeOptions {
  nowMs: number;
  /** The span the spend and the split cover, ending now. Default 5, the length of the common plan window. */
  hours?: number;
  /** Limit the figures to one session. */
  sessionId?: string;
  /** The latest official readings the Claude Code status line recorded, newest last. */
  statusSamples?: readonly StatuslineSample[];
  /** A plan reading older than this is not shown. Default 600. */
  staleSeconds?: number;
}

export interface GaugeSplit {
  cause: Cause;
  label: string;
  micros: number;
  share: number;
}

export interface GaugeLimit {
  source: "status line" | "ledger";
  label: string;
  usedPct: number;
  /** Seconds since the reading was taken. */
  ageSeconds: number;
  resetsAt: string;
  minutesToReset: number;
  /** One sentence on whether it will last, from past windows of the same plan (ledger readings only), or why there is none. */
  outlook: string;
  /** At the pace of the last hour, when the window reaches 100%; null when the pace is flat or unknown. */
  paceFinish: string | null;
}

export interface Gauge {
  asOf: string;
  hours: number;
  scope: string;
  spendMicros: number | null;
  calls: number;
  unpricedCalls: number;
  /** The spend per hour over the last 30 minutes; null when nothing happened in them. */
  burnMicrosPerHour: number | null;
  /** Minutes since the last call, or null when there is none. */
  idleMinutes: number | null;
  split: GaugeSplit[];
  limits: GaugeLimit[];
  notes: string[];
}

const MIN = 60_000;

export function buildGauge(db: Ledger, snapshot: PriceSnapshot, o: GaugeOptions): Gauge {
  const hours = o.hours ?? 5;
  const stale = (o.staleSeconds ?? 600) * 1000;
  const now = o.nowMs;
  const since = new Date(now - hours * 60 * MIN).toISOString();
  const until = new Date(now).toISOString();
  const notes: string[] = [];

  let calls = loadAutopsyCalls(db, snapshot, since, until);
  if (o.sessionId !== undefined) calls = calls.filter((c) => c.sessionId === o.sessionId);
  const priced = calls.filter((c) => c.micros !== null);
  const unpricedCalls = calls.length - priced.length;
  const scope = o.sessionId !== undefined ? `session ${o.sessionId.slice(0, 8)}, last ${hours} h` : `all sessions, last ${hours} h`;

  let spend: number | null = null;
  let split: GaugeSplit[] = [];
  if (calls.length === 0) notes.push(`No call in the last ${hours} hours${o.sessionId !== undefined ? " for that session" : ""}; the spend is $0.00, not unknown.`);
  const per = analyseCalls(calls);
  const a = buildAutopsy(calls, now - hours * 60 * MIN, now, per);
  spend = a.totalMicros;
  if (a.totalMicros > 0) {
    split = CAUSES.map((c) => ({ cause: c, label: CAUSE_LABEL[c], micros: a.causes[c].micros, share: a.causes[c].micros / a.totalMicros }))
      .filter((s) => s.micros > 0)
      .sort((x, y) => y.micros - x.micros);
  }
  if (unpricedCalls > 0) notes.push(`${unpricedCalls} call${unpricedCalls === 1 ? "" : "s"} in the span ${unpricedCalls === 1 ? "has" : "have"} no price (tokens counted, no dollars invented), so the spend is a floor.`);

  // Burn: the spend in the last 30 minutes, per hour. With nothing in them it is not zero, it is not running.
  const recent = calls.filter((c) => c.tsMs >= now - 30 * MIN);
  const burn = recent.length === 0 ? null : (recent.reduce((s, c) => s + (c.micros ? c.micros.input + c.micros.output + c.micros.read + c.micros.write5m + c.micros.write1h : 0), 0) / 30) * 60;
  if (burn === null) notes.push("Burn rate: no call in the last 30 minutes, so no rate.");
  const last = calls.length === 0 ? null : Math.max(...calls.map((c) => c.tsMs));
  const idleMinutes = last === null ? null : Math.max(0, Math.round((now - last) / MIN));

  const limits: GaugeLimit[] = [];
  const nowDate = new Date(now);

  // Official readings from the Claude Code status line: the newest sample, if it is recent enough.
  const samples = o.statusSamples ?? [];
  const newest = samples[samples.length - 1];
  if (newest !== undefined) {
    const age = now - Date.parse(newest.ts);
    if (age > stale) notes.push(`The status line last reported ${Math.round(age / MIN)} minutes ago, too old to show a plan percent (limit ${Math.round(stale / MIN)} minutes).`);
    else {
      for (const [label, r] of [["Claude Code, 5-hour window", newest.fiveHour], ["Claude Code, weekly window", newest.sevenDay]] as const) {
        if (r === null) continue;
        const resets = r.resetsAt * 1000;
        if (resets <= now) continue;
        limits.push({ source: "status line", label, usedPct: r.pct, ageSeconds: Math.round(age / 1000), resetsAt: new Date(resets).toISOString(), minutesToReset: Math.round((resets - now) / MIN), outlook: "Read from Claude Code itself; no forecast without the past windows of this plan in the ledger.", paceFinish: null });
      }
    }
  } else notes.push("Claude Code's plan limits: no status line reading. `desk statusline install` shows how to turn it on.");

  // Plan readings the ledger holds (Codex writes them into its logs).
  const tools = db.prepare("SELECT DISTINCT tool FROM limit_sample WHERE tool != 'claude_code'").all() as unknown as { tool: string }[];
  for (const { tool } of tools) {
    const groups = limitGroups(db, tool, nowDate);
    const current = groups[0];
    if (!current) continue;
    for (const g of groups.filter((x) => x.planType === current.planType).sort((p, q) => p.windowMinutes - q.windowMinutes)) {
      const r = runwayFromLedger(db, { tool, windowMinutes: g.windowMinutes, planType: g.planType, now: nowDate });
      if (r.usedPct === null || r.resetsAt === null) continue;
      const age = r.ageMinutes === null ? Infinity : r.ageMinutes * MIN;
      if (r.state === "window_over") continue;
      if (age > stale) {
        notes.push(`${tool === "codex" ? "Codex" : tool} ${groupLabel(g)}: last reading ${r.ageMinutes} minutes ago, too old to show.`);
        continue;
      }
      let paceFinish: string | null = null;
      if (r.rise !== null && r.rise.points > 0 && r.rise.minutes > 0) {
        const minutesTo100 = ((100 - r.usedPct) / r.rise.points) * r.rise.minutes;
        if (Number.isFinite(minutesTo100) && minutesTo100 >= 0) paceFinish = new Date(now + minutesTo100 * MIN).toISOString();
      }
      limits.push({
        source: "ledger", label: `${tool === "codex" ? "Codex" : tool}, ${groupLabel(g)}`, usedPct: r.usedPct, ageSeconds: Math.round(age / 1000), resetsAt: r.resetsAt.toISOString(),
        minutesToReset: r.minutesToReset ?? 0, outlook: runwayDetail(r), paceFinish,
      });
      void runwayHead;
    }
  }
  return { asOf: until, hours, scope, spendMicros: spend, calls: calls.length, unpricedCalls, burnMicrosPerHour: burn === null ? null : Math.round(burn), idleMinutes, split, limits, notes };
}

const hm = (minutes: number): string => (minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}` : `${minutes}m`);
const clock = (iso: string): string => iso.slice(11, 16);

/** One line, for a status line or a prompt. A missing figure is a dash. */
export function gaugeLine(g: Gauge): string {
  const parts: string[] = [`${g.spendMicros === null ? "—" : formatUsd(g.spendMicros)}/${g.hours}h`];
  parts.push(g.burnMicrosPerHour === null ? "— /h" : `${formatUsd(g.burnMicrosPerHour)}/h`);
  for (const l of g.limits.slice(0, 2)) parts.push(`${l.label.replace(/^Claude Code, |, .*window$/g, "").replace(/ window$/, "")} ${Math.round(l.usedPct)}% (resets ${hm(l.minutesToReset)})`);
  if (g.split.length > 0) parts.push(g.split.slice(0, 2).map((s) => `${s.label.split(" (")[0]!.toLowerCase()} ${Math.round(s.share * 100)}%`).join(" · "));
  return parts.join(" · ");
}

/** The detailed view. */
export function renderGauge(g: Gauge): string {
  const out: string[] = [];
  out.push(`Gauge as of ${g.asOf.slice(11, 19)} UTC · ${g.scope}`);
  out.push(`  Spend       ${g.spendMicros === null ? "—" : formatUsd(g.spendMicros)}   ${g.calls} call${g.calls === 1 ? "" : "s"}${g.idleMinutes !== null ? `, last ${g.idleMinutes === 0 ? "just now" : `${hm(g.idleMinutes)} ago`}` : ""}`);
  out.push(`  Burn        ${g.burnMicrosPerHour === null ? "— (nothing in the last 30 minutes)" : `${formatUsd(g.burnMicrosPerHour)} an hour over the last 30 minutes`}`);
  if (g.split.length > 0) {
    out.push("  Where it went");
    for (const s of g.split) out.push(`    ${String(Math.round(s.share * 100)).padStart(3)}%  ${formatUsd(s.micros).padStart(9)}  ${s.label}`);
  }
  if (g.limits.length > 0) {
    out.push("  Plan windows");
    for (const l of g.limits) {
      out.push(`    ${l.label}: ${Math.round(l.usedPct)}% used, resets in ${hm(l.minutesToReset)} (${clock(l.resetsAt)} UTC), read ${l.ageSeconds < 90 ? `${l.ageSeconds} s` : `${Math.round(l.ageSeconds / 60)} min`} ago [${l.source}]`);
      out.push(`      ${l.outlook}`);
      if (l.paceFinish !== null) out.push(`      At the pace of the last hour it reaches 100% at about ${clock(l.paceFinish)} UTC${Date.parse(l.paceFinish) < Date.parse(l.resetsAt) ? ", before the reset" : ", after the reset"}. A pace, not a forecast.`);
    }
  }
  for (const n of g.notes) out.push(`  - ${n}`);
  return out.join("\n");
}
