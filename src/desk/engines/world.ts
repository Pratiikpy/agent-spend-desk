import type { Ledger } from "../ledger/db.ts";
import { addDays } from "./days.ts";
import { deriveHistory, type ChangeKind, type EntityKind, type LedgerHistory } from "./ledger-history.ts";
import type { ExtraHistory } from "../changes/sources.ts";
import { identify } from "../tasks/identity.ts";
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
  /** Sources beside the ledger that were not read, with why, and sources that were read and held no change. */
  notRead: { source: string; why: string }[];
  read: { kind: ChangeKind; label: string }[];
  /** Sessions in the graph, and the relationships drawn from them to the models and tool versions they ran on. */
  sessions: number;
  relationships: number;
  /** Whether the sessions were drawn. When they were not, a change carries no count of sessions rather than a count of none. */
  drawn: boolean;
}

/** How many of the newest sessions are drawn into the graph with their relationships; older ones still count in the model and tool-version histories. */
export const SESSION_CAP = 5_000;

export async function buildWorldModel(db: Ledger, extra?: ExtraHistory): Promise<WorldHistory | null> {
  const base = deriveHistory(db);
  if (!base) return null;
  const history: LedgerHistory = extra === undefined ? base : { ...base, entities: [...base.entities, ...extra.entities], changes: [...base.changes, ...extra.changes].sort((x, y) => x.day.localeCompare(y.day) || x.kind.localeCompare(y.kind) || x.entityKey.localeCompare(y.entityKey)) };
  const mod = await loadEngineModule("world_model");
  const Ctor = mod["WorldModel"] as new (opts: { namespace: string; storage: "memory" }) => WorldModelLike;
  const wm = new Ctor({ namespace: "desk-ledger-history", storage: "memory" });
  const ids = await populate(wm, history);
  // The sessions and their relationships are drawn only for a history built with its beside-the-ledger sources; a question put to Ask is answered from the ledger's own history, unchanged.
  const graph = extra === undefined ? { sessions: 0, relationships: 0 } : await drawSessions(wm, db, ids);
  return { wm, start: history.start, end: history.end, events: wm.events().length, notRead: extra?.notRead ?? [], read: extra?.read ?? [], sessions: graph.sessions, relationships: graph.relationships, drawn: extra !== undefined };
}

/** Sessions as entities, each related to the model ids and the tool version it ran on, so "what ran on the thing that changed" is a walk along relationships. */
async function drawSessions(wm: WorldModelLike, db: Ledger, ids: ReadonlyMap<string, string>): Promise<{ sessions: number; relationships: number }> {
  const rows = db
    .prepare(
      `SELECT s.session_id AS id, s.tool AS tool, s.tool_version AS version, s.project_path AS project, s.git_branch AS branch, s.started_at AS startedAt, MIN(substr(m.ts, 1, 10)) AS first, COUNT(*) AS calls, GROUP_CONCAT(DISTINCT m.model) AS models
       FROM session s JOIN model_call m ON m.session_id = s.session_id GROUP BY s.session_id ORDER BY first DESC, s.session_id LIMIT ?`,
    )
    .all(SESSION_CAP) as unknown as { id: string; tool: string; version: string | null; project: string | null; branch: string | null; startedAt: string | null; first: string; calls: number; models: string }[];
  let relationships = 0;
  const hubs = new Map<string, string>();
  const hub = async (type: string, key: string, name: string, day: string): Promise<string> => {
    const have = hubs.get(`${type}:${key}`);
    if (have !== undefined) return have;
    const e = await wm.upsertEntity({ type, name, externalKey: { system: "ledger", id: `${type}:${key}` }, attrs: {}, source: { kind: "api", by: BY, at: dayTs(day) } });
    hubs.set(`${type}:${key}`, e.id);
    return e.id;
  };
  for (const r of rows) {
    const s = await wm.upsertEntity({ type: "session", name: r.id, externalKey: { system: "ledger", id: `session:${r.id}` }, attrs: { firstDay: r.first, calls: r.calls }, source: { kind: "api", by: BY, at: dayTs(r.first) } });
    // The agent that ran it, and the task it was part of (the same identity `desk task list` uses).
    await wm.relate({ from: s.id, type: "run_by", to: await hub("agent", r.tool, r.tool, r.first), source: { kind: "api", by: BY, at: dayTs(r.first) } });
    const t = identify({ sessionId: r.id, projectPath: r.project, gitBranch: r.branch, startedAt: r.startedAt }, []);
    await wm.relate({ from: s.id, type: "part_of", to: await hub("task", t.taskId, t.label, r.first), source: { kind: "api", by: BY, at: dayTs(r.first) } });
    relationships += 2;
    for (const model of (r.models ?? "").split(",")) {
      const to = ids.get(`model:${model}`);
      if (to === undefined) continue;
      await wm.relate({ from: s.id, type: "ran_on", to, source: { kind: "api", by: BY, at: dayTs(r.first) } });
      relationships += 1;
    }
    const v = r.version === null ? undefined : ids.get(`tool_version:${r.version}`);
    if (v !== undefined) {
      await wm.relate({ from: s.id, type: "ran_with", to: v, source: { kind: "api", by: BY, at: dayTs(r.first) } });
      relationships += 1;
    }
  }
  return { sessions: rows.length, relationships };
}

async function populate(wm: WorldModelLike, h: LedgerHistory): Promise<Map<string, string>> {
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
  return ids;
}

export interface ChangeView {
  day: string;
  kind: ChangeKind;
  entityKind: EntityKind;
  label: string;
  detail: Record<string, string | number>;
  /** Sessions that began on or after the change and are related to the thing that changed (a model id, a tool version), and the first of them: null for a change with nothing to relate. */
  affectedSessions: number | null;
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
  /** Sources beside the ledger that were read and held no change in the window, and ones that could not be read. */
  unchangedSources: string[];
  notRead: { source: string; why: string }[];
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
    unchangedSources: [],
    notRead: w.notRead,
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
    // Sessions related to the thing that changed, that began on or after the day it changed and before the date asked about.
    const via = !w.drawn ? null : ent.type === "model" ? "ran_on" : ent.type === "tool_version" ? "ran_with" : null;
    const affectedSessions = via === null ? null : graph.incoming(ent.id, { via }).filter((s) => String(s.attrs["firstDay"] ?? "") >= day && String(s.attrs["firstDay"] ?? "") < date).length;
    out.changed.push({ day, kind: f.value["kind"] as ChangeKind, entityKind: ent.type as EntityKind, label: ent.name ?? ent.id, detail, affectedSessions });
    changedEntities.add(ent.id);
  }
  out.changed.sort((a, b) => a.day.localeCompare(b.day) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
  // A source that was read and shows no change in the window is said to have stayed as it was; one that was not read is not.
  out.unchangedSources = w.read.filter((r) => !out.changed.some((c) => c.kind === r.kind)).map((r) => r.label);

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
