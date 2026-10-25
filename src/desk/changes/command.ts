import { existsSync } from "node:fs";

import { OwnerMemory } from "../engines/memory.ts";
import { buildWorldModel, queryChangesBefore, type WorldHistory } from "../engines/world.ts";
import type { Ledger } from "../ledger/db.ts";
import { readRows } from "../canary/store.ts";
import { addDays } from "../engines/days.ts";
import { collectExtraHistory } from "./sources.ts";
import { changeLines } from "./render.ts";

export interface ChangeOptions {
  db: Ledger;
  canaryRunsPath?: string;
  gateDbPath?: string | null;
  memoryDir?: string;
  /** Leave the World Model out (`--ablate world_model`): what changed is then unknowable, and says so. */
  worldOff?: boolean;
}

/** The change history: the ledger's, and everything beside it that was read. Null when the ledger has no call. */
export async function loadChangeHistory(o: ChangeOptions): Promise<WorldHistory | null> {
  const rows = o.canaryRunsPath !== undefined && existsSync(o.canaryRunsPath) ? readRows(o.canaryRunsPath).rows : [];
  let notes: { id: string; kind: string; learnedAt: string; content: string }[] | null = null;
  if (o.memoryDir !== undefined) {
    try {
      notes = (await OwnerMemory.open({ persistDir: o.memoryDir })).all().filter((m) => m.kind === "note" || m.kind === "outcome_definition").map((m) => ({ id: m.id, kind: m.kind, learnedAt: m.learnedAt, content: m.content }));
    } catch {
      notes = null;
    }
  }
  const extra = collectExtraHistory({ db: o.db, canaryRows: rows, gateDbPath: o.gateDbPath ?? null, memoryNotes: notes });
  return buildWorldModel(o.db, extra);
}

const UNKNOWABLE = "unknowable: no entity history is available, so what changed cannot be listed.";

/** `desk changes [--before DATE] [--days N]` and `desk changes audit`. */
export async function changesCommand(args: readonly string[], o: ChangeOptions & { before?: string; days?: number }): Promise<{ ok: boolean; text: string }> {
  const [sub] = args;
  if (o.worldOff) return { ok: true, text: UNKNOWABLE };
  const w = await loadChangeHistory(o);
  if (w === null) return { ok: true, text: "The ledger holds no call, so there is no history to list. Run desk ingest first." };
  if (sub === "audit") {
    const a = w.wm.audit();
    const head = `${a.length} entries in the model's audit trail (${w.wm.events().length} events; ${w.sessions} sessions and ${w.relationships} relationships drawn). The last ${Math.min(a.length, 25)}:`;
    return { ok: true, text: [head, ...a.slice(-25).map((e) => `  ${e.seq}  ${e.at.slice(0, 10)}  ${e.kind}  by ${e.actor}  ${e.summary}`)].join("\n") };
  }
  if (sub !== undefined && sub !== "list") throw new Error("Use: desk changes [--before DATE] [--days N] | audit");
  const date = o.before ?? addDays(w.end, 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--before is a date such as ${w.end}, not "${date}"`);
  const days = o.days ?? 14;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("--days is a whole number from 1 to 365");
  const q = queryChangesBefore(w, date, days);
  return { ok: true, text: ["What changed before " + date + `, over ${days} days (the ledger covers ${w.start} to ${w.end}):`, ...changeLines(q)].join("\n") };
}

/**
 * The lines the canary's verdict carries about what changed before it: everything the history shows in the fortnight before the verdict's day, with the sessions each touched. Without
 * the World Model the verdict says what it could not know, and loses its "consistent with" line, because nothing was looked at to be consistent with.
 */
export async function canaryAttribution(o: ChangeOptions & { verdictDate: string; since: string }): Promise<{ lines: string[] }> {
  if (o.worldOff) return { lines: [`  what changed before this: ${UNKNOWABLE}`] };
  const w = await loadChangeHistory(o);
  if (w === null) return { lines: ["  what changed before this: unknowable, the ledger holds no call to build a history from."] };
  // From the last day of the baseline to the verdict's day: a change before the baseline ended is in the baseline; a change in this span is a candidate for the drop.
  const span = Math.max(1, Math.round((Date.parse(`${o.verdictDate}T00:00:00Z`) - Date.parse(`${o.since}T00:00:00Z`)) / 86_400_000) + 1);
  const q = queryChangesBefore(w, addDays(o.verdictDate, 1), span);
  if (q.beforeLedger || q.afterLedger) return { lines: [`  what changed before this: ${changeLines(q)[0]}`] };
  const lines: string[] = [];
  if (q.changed.length === 0) lines.push(`  nothing was recorded as changed between ${o.since} and ${o.verdictDate}; nothing here is consistent with this drop`);
  else {
    lines.push(`  consistent with, not caused by (changes from ${o.since}, the last baseline day, to ${o.verdictDate}):`);
    for (const l of changeLines(q, { limit: 8 }).slice(1)) lines.push(`  ${l}`);
    return { lines };
  }
  const tail = changeLines(q).slice(1);
  for (const l of tail) lines.push(`  ${l}`);
  return { lines };
}
