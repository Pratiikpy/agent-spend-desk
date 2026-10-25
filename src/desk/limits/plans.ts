import type { Ledger } from "../ledger/db.ts";
import { fitLimit, groupLabel, limitGroups, modelsOfTool, observeWindows, type LimitFit } from "./fit.ts";
import { runwayDetail, runwayFromLedger, runwayHead, type Runway } from "./runway.ts";

/**
 * Every plan the owner's tools report on, window by window (DF-008): how much of it is used and when it resets as the tool says
 * (the official figure), how much of it the tokens counted here would imply (a local estimate), and the outlook. The two are shown
 * beside each other and never merged, because they measure different things: the tool's percent includes every other device and use
 * of the plan, and our count includes only what these logs hold. Events on the plan, a window reaching its limit and a change of
 * model, are listed. A tool with no reading of its own gets a local count and is labelled as having no official figure.
 */
export interface PlanWindow {
  tool: string;
  toolLabel: string;
  planType: string | null;
  windowMinutes: number;
  label: string;
  /** Official: the tool's own reading. None: the tool has calls here and no reading of this window, so only a local count exists. */
  source: "official" | "none";
  official: { usedPct: number; resetsAt: string; minutesToReset: number; ageMinutes: number; state: Runway["state"]; head: string } | null;
  /** What the Desk's own count of tokens says about this window, beside the official figure. */
  local: { tokensSoFar: number; impliedPct: number | null; lowPct: number | null; highPct: number | null; agrees: boolean | null; note: string; tokensPerPercent?: number | null } | null;
  /** The outlook from past windows, or why there is none. */
  outlook: string;
  /** With too few past windows for an outlook: the pace of the last hour carried forward in a straight line, said to be exactly that. */
  linear: { minutesToFull: number; beforeReset: boolean; note: string } | null;
  /** The numbers behind the sentences above, for a caller that decides on them (the plan router): the history's verdict, and the minutes to full at the pace of the last hour. */
  numbers: { verdict: Runway["verdict"]; minutesToFull: number | null; tokensPerPercent: number | null } | null;
}

export interface PlanEvent {
  kind: "limit_hit" | "model_switch";
  at: string;
  tool: string;
  toolLabel: string;
  detail: string;
  /** A model switch within an hour after a limit hit on the same tool: it may have been the plan's doing, which the logs do not say. */
  afterLimitHit: boolean;
}

export interface PlansView {
  windows: PlanWindow[];
  events: PlanEvent[];
  notes: string[];
}

const toolLabel = (tool: string): string => (tool === "claude_code" ? "Claude Code" : tool === "codex" ? "Codex" : tool);
const MINUTE = 60_000;
const k = (x: number): string => (x >= 1_000_000 ? `${(x / 1_000_000).toFixed(1)}M` : `${Math.round(x / 1000)}K`);
/** A reading at or above this is a window that has reached its limit. */
export const HIT_AT = 99.5;

function tokensIn(db: Ledger, tool: string, fromMs: number, toMs: number): number {
  const pattern = modelsOfTool(tool);
  const rows = db
    .prepare("SELECT m.model AS model, m.input_tokens AS i, m.cache_read_tokens AS c, m.output_tokens AS o FROM model_call m JOIN session s ON s.session_id = m.session_id WHERE s.tool = ? AND m.ts > ? AND m.ts <= ?")
    .all(tool, new Date(fromMs).toISOString(), new Date(toMs).toISOString()) as unknown as { model: string; i: number; c: number; o: number }[];
  return rows.filter((r) => pattern(r.model)).reduce((s, r) => s + r.i + r.c + r.o, 0);
}

function localFor(db: Ledger, tool: string, planType: string | null, windowMinutes: number, official: NonNullable<PlanWindow["official"]>, now: Date): PlanWindow["local"] {
  const resetMs = Date.parse(official.resetsAt);
  const startMs = resetMs - windowMinutes * MINUTE;
  const tokensSoFar = tokensIn(db, tool, startMs, now.getTime());
  let fit: LimitFit | null = null;
  try {
    // Only windows that have finished teach what a percent is worth: the window being judged must not be part of the estimate that judges it.
    const finished = observeWindows(db, { tool, windowMinutes, planType, modelFilter: modelsOfTool(tool) }).filter((o) => o.resetsAt * 1000 <= now.getTime());
    fit = fitLimit(finished);
  } catch {
    fit = null;
  }
  if (fit === null || fit.abstained || fit.tokensPerPercent === null || fit.low === null || fit.high === null) {
    return { tokensSoFar, impliedPct: null, lowPct: null, highPct: null, agrees: null, note: `${k(tokensSoFar)} tokens counted in this window so far. ${fit?.reason ? `No estimate of what that is as a percent: ${fit.reason}.` : "No estimate of what that is as a percent."}` };
  }
  const implied = tokensSoFar / fit.tokensPerPercent;
  const lowPct = tokensSoFar / fit.high;
  const highPct = tokensSoFar / fit.low;
  const agrees = official.usedPct >= lowPct - 1 && official.usedPct <= highPct + 1;
  return {
    tokensSoFar,
    impliedPct: Math.min(100, implied),
    lowPct: Math.min(100, lowPct),
    highPct: Math.min(100, highPct),
    agrees,
    tokensPerPercent: fit.tokensPerPercent,
    note: agrees
      ? `${k(tokensSoFar)} tokens counted in this window would be about ${Math.round(Math.min(100, implied))}% on this plan's own history (${Math.round(Math.min(100, lowPct))}% to ${Math.round(Math.min(100, highPct))}%): consistent with the tool's figure.`
      : `${k(tokensSoFar)} tokens counted here would be about ${Math.round(Math.min(100, implied))}% (${Math.round(Math.min(100, lowPct))}% to ${Math.round(Math.min(100, highPct))}%) against the tool's ${Math.round(official.usedPct)}%. The tool's figure includes other devices and other uses of the plan that leave no trace in these logs; neither is changed to fit the other.`,
  };
}

/** The pace of the last hour carried straight forward: no history is consulted, and it says so. */
function linearFor(r: Runway): PlanWindow["linear"] {
  if (r.state !== "ok" || r.usedPct === null || r.minutesToReset === null || r.rise === null || r.rise.points <= 0 || r.rise.minutes <= 0) return null;
  const perMinute = r.rise.points / r.rise.minutes;
  const minutesToFull = Math.max(0, Math.round((100 - r.usedPct) / perMinute));
  const beforeReset = minutesToFull < r.minutesToReset;
  return { minutesToFull, beforeReset, note: `Linear, no history: at the pace of the last ${r.rise.minutes} minutes (${r.rise.points.toFixed(0)} points) it would reach 100% in ${minutesToFull} minutes, ${beforeReset ? "before" : "after"} the reset in ${r.minutesToReset}. That is a straight line, not a forecast.` };
}

export function plansView(db: Ledger, now: Date, opts: { tool?: string; days?: number } = {}): PlansView {
  const has = (db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name = 'limit_sample'").get() as { n: number }).n > 0;
  const tools = (db.prepare("SELECT DISTINCT tool FROM session ORDER BY tool").all() as unknown as { tool: string }[]).map((r) => r.tool).filter((t) => t === "claude_code" || t === "codex");
  const wanted = opts.tool === undefined ? tools : tools.filter((t) => t === opts.tool);
  const windows: PlanWindow[] = [];
  const notes: string[] = [];
  for (const tool of wanted) {
    const groups = has ? limitGroups(db, tool, now) : [];
    const current = groups[0];
    if (!current) {
      const day = tokensIn(db, tool, now.getTime() - 5 * 60 * MINUTE, now.getTime());
      windows.push({ tool, toolLabel: toolLabel(tool), planType: null, windowMinutes: 300, label: "five-hour window (a local count)", source: "none", official: null, local: { tokensSoFar: day, impliedPct: null, lowPct: null, highPct: null, agrees: null, note: `${k(day)} tokens counted in the last five hours. There is no reading of ${toolLabel(tool)}'s own plan windows, so there is no percent and no outlook.` }, outlook: "No official reading, so no outlook.", linear: null, numbers: null });
      notes.push(tool === "claude_code" ? "Claude Code reports its plan windows only through its status line: `desk statusline install` turns that on. Until it does, Claude Code windows are a local count with no percent." : `${toolLabel(tool)} has no plan reading in this ledger.`);
      continue;
    }
    for (const g of groups.filter((x) => x.planType === current.planType).sort((a, b) => a.windowMinutes - b.windowMinutes)) {
      const r = runwayFromLedger(db, { tool, windowMinutes: g.windowMinutes, planType: g.planType, now });
      const official: PlanWindow["official"] = r.usedPct === null || r.resetsAt === null ? null : { usedPct: r.usedPct, resetsAt: r.resetsAt.toISOString(), minutesToReset: r.minutesToReset ?? 0, ageMinutes: r.ageMinutes ?? 0, state: r.state, head: runwayHead(r) };
      windows.push({
        tool,
        toolLabel: toolLabel(tool),
        planType: g.planType,
        windowMinutes: g.windowMinutes,
        label: groupLabel(g),
        source: official ? "official" : "none",
        official,
        local: official && r.state !== "window_over" ? localFor(db, tool, g.planType, g.windowMinutes, official, now) : null,
        outlook: runwayDetail(r),
        linear: r.outlook === null ? linearFor(r) : null,
        numbers: { verdict: r.verdict, minutesToFull: linearFor(r)?.minutesToFull ?? null, tokensPerPercent: null },
      });
      const added = windows[windows.length - 1] as PlanWindow;
      if (added.numbers && added.local) added.numbers.tokensPerPercent = added.local.tokensPerPercent ?? null;
    }
  }

  const days = opts.days ?? 14;
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const events: PlanEvent[] = [];
  if (has) {
    const hits = db
      .prepare(
        `SELECT tool, window_minutes AS wm, plan_type AS plan, resets_at AS resetsAt, MIN(ts) AS at FROM limit_sample WHERE used_percent >= ? AND ts >= ? AND ts <= ? GROUP BY tool, window_minutes, plan_type, resets_at ORDER BY at`,
      )
      .all(HIT_AT, since, now.toISOString()) as unknown as { tool: string; wm: number; plan: string | null; resetsAt: number; at: string }[];
    for (const h of hits) {
      if (opts.tool !== undefined && h.tool !== opts.tool) continue;
      events.push({ kind: "limit_hit", at: h.at, tool: h.tool, toolLabel: toolLabel(h.tool), detail: `the ${groupLabel({ windowMinutes: h.wm, planType: h.plan })} reached its limit; it resets ${new Date(h.resetsAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`, afterLimitHit: false });
    }
  }
  const switches = db
    .prepare(
      `SELECT at, tool, from_model, to_model FROM (
         SELECT m.ts AS at, s.tool AS tool, m.model AS to_model, LAG(m.model) OVER (PARTITION BY m.source_id ORDER BY m.ts, m.call_id) AS from_model, m.is_sidechain AS side
         FROM model_call m JOIN session s ON s.session_id = m.session_id WHERE m.ts >= ? AND m.ts <= ? AND m.is_sidechain = 0 AND m.model NOT LIKE '<%'
       ) WHERE from_model IS NOT NULL AND from_model != to_model ORDER BY at DESC LIMIT 200`,
    )
    .all(new Date(Date.parse(since) - 6 * 3_600_000).toISOString(), now.toISOString()) as unknown as { at: string; tool: string; from_model: string; to_model: string }[];
  const hitTimes = events.filter((e) => e.kind === "limit_hit").map((e) => ({ tool: e.tool, ms: Date.parse(e.at) }));
  for (const sw of switches) {
    if (sw.at < since || (opts.tool !== undefined && sw.tool !== opts.tool)) continue;
    const ms = Date.parse(sw.at);
    const after = hitTimes.some((h) => h.tool === sw.tool && ms >= h.ms && ms - h.ms <= 60 * MINUTE);
    events.push({ kind: "model_switch", at: sw.at, tool: sw.tool, toolLabel: toolLabel(sw.tool), detail: `${sw.from_model} to ${sw.to_model}${after ? ", within an hour of a limit hit (the logs do not say why)" : ""}`, afterLimitHit: after });
  }
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { windows, events: events.slice(0, 40), notes };
}

export function renderPlans(v: PlansView): string {
  if (v.windows.length === 0) return "No plan to show: the ledger holds no Claude Code or Codex session.";
  const out: string[] = [];
  for (const w of v.windows) {
    out.push(`${w.toolLabel}, ${w.label}`);
    if (w.official) {
      out.push(`  official: ${w.official.head}`);
      out.push(`  ${w.outlook}`);
      if (w.linear) out.push(`  ${w.linear.note}`);
    } else out.push("  official: none");
    if (w.local) out.push(`  local: ${w.local.note}`);
    out.push("");
  }
  out.push("Events, last 14 days");
  if (v.events.length === 0) out.push("  No window reached its limit and no model changed in the calls the Desk holds.");
  for (const e of v.events.slice(0, 15)) out.push(`  ${e.at.slice(0, 16).replace("T", " ")} UTC  ${e.toolLabel}: ${e.kind === "limit_hit" ? "limit hit, " : "model changed, "}${e.detail}`);
  if (v.events.length > 15) out.push(`  and ${v.events.length - 15} more`);
  for (const n of v.notes) out.push("", n);
  out.push("", "The official figure is the tool's own reading. The local one is a count of the tokens these logs hold, shown beside it and never merged with it.");
  return out.join("\n");
}
