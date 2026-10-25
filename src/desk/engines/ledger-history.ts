import type { Ledger } from "../ledger/db.ts";
import { addDays, daysBetween } from "./days.ts";
import { sanitizeLabel } from "./label.ts";

/**
 * What the ledger says changed, as dated events. This is the raw material the World Model is given: the
 * model ids, tool versions and plan tiers the owner's agents used, when each first and last appeared, and
 * when a model's share of calls moved. A thing present on the first day of the ledger did not "change".
 */
export type EntityKind = "model" | "tool_version" | "plan" | "served_model" | "policy" | "price_list" | "owner_edit";
export type ChangeKind =
  | "model_first_seen" | "model_last_seen" | "model_share_shift" | "tool_version_first_seen" | "plan_first_seen" | "plan_last_seen"
  | "served_model_changed" | "policy_changed" | "price_list_changed" | "owner_edit" | "autonomy_changed" | "precedent_adopted";

export interface HistoryEntity {
  kind: EntityKind;
  key: string;
  label: string;
  firstDay: string;
  lastDay: string;
  calls: number;
}

export interface Change {
  kind: ChangeKind;
  entityKind: EntityKind;
  entityKey: string;
  /** The day the change took effect. */
  day: string;
  detail: Record<string, string | number>;
}

export interface LedgerHistory {
  start: string;
  end: string;
  entities: HistoryEntity[];
  changes: Change[];
}

/** A model whose share of calls moved by at least this much from one week to the next is a share shift. */
export const SHARE_SHIFT = 0.1;
/** Weeks with fewer calls than this in total are too thin for a share to mean anything. */
export const MIN_WEEK_CALLS = 50;
/** A thing last seen this many days or more before the ledger ends has stopped being used. */
export const STOPPED_AFTER_DAYS = 3;

const placeholder = (model: string): boolean => /^<.*>$/.test(model);

export function deriveHistory(db: Ledger): LedgerHistory | null {
  const range = db.prepare("SELECT MIN(substr(ts, 1, 10)) AS a, MAX(substr(ts, 1, 10)) AS b FROM model_call").get() as { a: string | null; b: string | null };
  if (!range.a || !range.b) return null;
  const start = range.a;
  const end = range.b;
  const entities: HistoryEntity[] = [];
  const changes: Change[] = [];

  const models = db
    .prepare("SELECT model AS k, MIN(substr(ts, 1, 10)) AS a, MAX(substr(ts, 1, 10)) AS b, COUNT(*) AS n FROM model_call GROUP BY model ORDER BY model")
    .all() as unknown as { k: string; a: string; b: string; n: number }[];
  for (const m of models) {
    if (placeholder(m.k)) continue;
    entities.push({ kind: "model", key: m.k, label: sanitizeLabel(m.k), firstDay: m.a, lastDay: m.b, calls: m.n });
    if (m.a > start) changes.push({ kind: "model_first_seen", entityKind: "model", entityKey: m.k, day: m.a, detail: { calls: m.n } });
    if (daysBetween(m.b, end) >= STOPPED_AFTER_DAYS) changes.push({ kind: "model_last_seen", entityKind: "model", entityKey: m.k, day: addDays(m.b, 1), detail: { lastDay: m.b } });
  }

  const versions = db
    .prepare("SELECT tool_version AS k, MIN(substr(started_at, 1, 10)) AS a, MAX(substr(started_at, 1, 10)) AS b, COUNT(*) AS n FROM session WHERE tool_version IS NOT NULL AND started_at IS NOT NULL GROUP BY tool_version ORDER BY tool_version")
    .all() as unknown as { k: string; a: string; b: string; n: number }[];
  for (const v of versions) {
    entities.push({ kind: "tool_version", key: v.k, label: `v${sanitizeLabel(v.k)}`, firstDay: v.a, lastDay: v.b, calls: v.n });
    if (v.a > start) changes.push({ kind: "tool_version_first_seen", entityKind: "tool_version", entityKey: v.k, day: v.a, detail: { sessions: v.n } });
  }

  const plans = db
    .prepare("SELECT COALESCE(service_tier, 'unknown') AS t, COALESCE(speed, 'unknown') AS s, MIN(substr(ts, 1, 10)) AS a, MAX(substr(ts, 1, 10)) AS b, COUNT(*) AS n FROM model_call GROUP BY 1, 2 ORDER BY 1, 2")
    .all() as unknown as { t: string; s: string; a: string; b: string; n: number }[];
  for (const p of plans) {
    const key = `${p.t}/${p.s}`;
    entities.push({ kind: "plan", key, label: `tier ${sanitizeLabel(p.t)} speed ${sanitizeLabel(p.s)}`, firstDay: p.a, lastDay: p.b, calls: p.n });
    if (p.a > start) changes.push({ kind: "plan_first_seen", entityKind: "plan", entityKey: key, day: p.a, detail: { calls: p.n } });
    if (daysBetween(p.b, end) >= STOPPED_AFTER_DAYS) changes.push({ kind: "plan_last_seen", entityKind: "plan", entityKey: key, day: addDays(p.b, 1), detail: { lastDay: p.b } });
  }

  const weekly = db
    .prepare(
      `SELECT model AS k, CAST((julianday(substr(ts, 1, 10)) - julianday(?)) / 7 AS INTEGER) AS wk, COUNT(*) AS n
       FROM model_call WHERE model NOT LIKE '<%' GROUP BY model, wk`,
    )
    .all(start) as unknown as { k: string; wk: number; n: number }[];
  const byWeek = new Map<number, Map<string, number>>();
  for (const r of weekly) {
    const w = byWeek.get(r.wk) ?? new Map<string, number>();
    w.set(r.k, r.n);
    byWeek.set(r.wk, w);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  for (let i = 1; i < weeks.length; i += 1) {
    const prevWeek = weeks[i - 1] as number;
    const thisWeek = weeks[i] as number;
    if (thisWeek !== prevWeek + 1) continue;
    const prev = byWeek.get(prevWeek) as Map<string, number>;
    const cur = byWeek.get(thisWeek) as Map<string, number>;
    const prevTotal = [...prev.values()].reduce((a, b) => a + b, 0);
    const curTotal = [...cur.values()].reduce((a, b) => a + b, 0);
    if (prevTotal < MIN_WEEK_CALLS || curTotal < MIN_WEEK_CALLS) continue;
    for (const [model, n] of cur) {
      const before = prev.get(model);
      if (before === undefined) continue; // a model that appeared has its own event
      const a = before / prevTotal;
      const b = n / curTotal;
      if (Math.abs(b - a) >= SHARE_SHIFT) {
        changes.push({
          kind: "model_share_shift",
          entityKind: "model",
          entityKey: model,
          day: addDays(start, thisWeek * 7),
          detail: { from: Math.round(a * 1000) / 10, to: Math.round(b * 1000) / 10 },
        });
      }
    }
  }
  changes.sort((x, y) => x.day.localeCompare(y.day) || x.kind.localeCompare(y.kind) || x.entityKey.localeCompare(y.entityKey));
  return { start, end, entities, changes };
}
