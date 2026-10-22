import type { Ledger } from "../ledger/db.ts";
import { addDays } from "./days.ts";
import { deriveHistory, type ChangeKind, type EntityKind, type LedgerHistory } from "./ledger-history.ts";
import { loadEngineModule, type WmEntity, type WmFactsView, type WmGraphView, type WorldModelLike } from "./load.ts";

/**
 * The Desk's use of the Meterless World Model: an event-sourced history of the things that shape a
 * bill (model ids, tool versions, plan tiers), built from the ledger and queried for "what changed before
 * <date>". Every fact is written with provenance and a timestamp taken from the ledger, never the wall
 * clock, so the same ledger always yields the same event log.
 */
const BY = "desk-ledger";
const dayTs = (day: string): string => `${day}T00:00:00.000Z`;
const CHANGE_PREFIX = "change.";

export interface WorldHistory {
  wm: WorldModelLike;
  start: string;
  end: string;
  events: number;
}

export async function buildWorldModel(db: Ledger): Promise<WorldHistory | null> {
  const history = deriveHistory(db);
  if (!history) return null;
  const mod = await loadEngineModule("world_model");
  const Ctor = mod["WorldModel"] as new (opts: { namespace: string; storage: "memory" }) => WorldModelLike;
  const wm = new Ctor({ namespace: "desk-ledger-history", storage: "memory" });
  await populate(wm, history);
  return { wm, start: history.start, end: history.end, events: wm.events().length };
}

async function populate(wm: WorldModelLike, h: LedgerHistory): Promise<void> {
  const ledger = await wm.upsertEntity({ type: "ledger", name: "ledger", externalKey: { system: "ledger", id: "main" }, source: { kind: "api", by: BY, at: dayTs(h.start) } });
  await wm.assertFact({ about: ledger.id, predicate: "covers_from", value: h.start, confidence: 1, source: { kind: "api", by: BY, at: dayTs(h.start) } });
  await wm.assertFact({ about: ledger.id, predicate: "covers_to", value: h.end, confidence: 1, source: { kind: "api", by: BY, at: dayTs(h.end) } });
  const ids = new Map<string, string>();
  for (const e of h.entities) {
    const ent = await wm.upsertEntity({ type: e.kind, name: e.label, externalKey: { system: "ledger", id: `${e.kind}:${e.key}` }, attrs: { calls: e.calls }, source: { kind: "api", by: BY, at: dayTs(e.firstDay) } });
    ids.set(`${e.kind}:${e.key}`, ent.id);
    await wm.assertFact({ about: ent.id, predicate: "first_seen", value: e.firstDay, confidence: 1, source: { kind: "api", by: BY, at: dayTs(e.firstDay) } });
    await wm.assertFact({ about: ent.id, predicate: "last_seen", value: e.lastDay, confidence: 1, source: { kind: "api", by: BY, at: dayTs(e.lastDay) } });
  }
  for (const c of h.changes) {
    const about = ids.get(`${c.entityKind}:${c.entityKey}`);
    if (!about) continue;
    await wm.assertFact({
      about,
      predicate: `${CHANGE_PREFIX}${c.kind}@${c.day}`,
      value: { kind: c.kind, day: c.day, ...c.detail },
      confidence: 1,
      source: { kind: "api", by: BY, at: dayTs(c.day) },
    });
  }
}

export interface ChangeView {
  day: string;
  kind: ChangeKind;
  entityKind: EntityKind;
  label: string;
  detail: Record<string, string | number>;
}

export interface UnchangedView {
  entityKind: EntityKind;
  label: string;
  since: string;
}

export interface ChangesBefore {
  date: string;
  days: number;
  windowStart: string;
  ledgerStart: string;
  ledgerEnd: string;
  /** The date is before the first day the ledger covers, so there is no history to look at. */
  beforeLedger: boolean;
  /** The date is after the last day the ledger covers: a change after the ledger ends is not known. */
  afterLedger: boolean;
  changed: ChangeView[];
  unchanged: UnchangedView[];
}

/** Reads only the World Model's event log and views; the ledger is not touched. */
export function queryChangesBefore(w: WorldHistory, date: string, days: number): ChangesBefore {
  const windowStart = addDays(date, -days);
  const facts = w.wm.view("facts") as WmFactsView;
  const graph = w.wm.view("graph") as WmGraphView;
  const out: ChangesBefore = {
    date,
    days,
    windowStart,
    ledgerStart: w.start,
    ledgerEnd: w.end,
    beforeLedger: date <= w.start,
    afterLedger: date > addDays(w.end, 1),
    changed: [],
    unchanged: [],
  };
  if (out.beforeLedger) return out;

  const changedEntities = new Set<string>();
  for (const ev of w.wm.events()) {
    if (ev.kind !== "assertFact") continue;
    const f = ev.payload as { about: string; predicate: string; value: Record<string, string | number> };
    if (!f.predicate.startsWith(CHANGE_PREFIX)) continue;
    const day = String(f.value["day"]);
    if (day < windowStart || day >= date) continue;
    const ent: WmEntity | undefined = graph.entity(f.about);
    if (!ent) continue;
    const { kind: _kind, day: _day, ...detail } = f.value;
    void _kind;
    void _day;
    out.changed.push({ day, kind: f.value["kind"] as ChangeKind, entityKind: ent.type as EntityKind, label: ent.name ?? ent.id, detail });
    changedEntities.add(ent.id);
  }
  out.changed.sort((a, b) => a.day.localeCompare(b.day) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));

  const dayBefore = addDays(date, -1);
  for (const type of ["model", "tool_version", "plan"] as const) {
    const ents = graph.query({ type }).filter((e) => !changedEntities.has(e.id));
    ents.sort((a, b) => Number(b.attrs["calls"] ?? 0) - Number(a.attrs["calls"] ?? 0) || (a.name ?? "").localeCompare(b.name ?? ""));
    for (const e of ents) {
      const fs = facts.about(e.id);
      const first = fs.find((f) => f.predicate === "first_seen")?.value;
      const last = fs.find((f) => f.predicate === "last_seen")?.value;
      if (typeof first !== "string" || typeof last !== "string") continue;
      if ((first < windowStart || first === w.start) && last >= dayBefore) out.unchanged.push({ entityKind: type, label: e.name ?? e.id, since: first });
    }
  }
  return out;
}
