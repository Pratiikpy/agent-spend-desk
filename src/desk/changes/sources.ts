import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type { RunRow } from "../canary/runner.ts";
import { servedChanges } from "../canary/store.ts";
import type { Change, ChangeKind, HistoryEntity } from "../engines/ledger-history.ts";
import { sanitizeLabel } from "../engines/label.ts";
import type { Ledger } from "../ledger/db.ts";

/**
 * Everything beside the ledger's own calls that can change what a bill or a canary score looks like, as dated changes (DF-117): the model id the endpoint says it served, the policy the
 * gate was running, the price list, what the owner edited in the Desk's memory, what a kind of work was promoted or demoted to, and the policy changes the owner approved. Each is read
 * from where the Desk already keeps it, with the date it carries; nothing is guessed, and a source that is not there is listed as not read, so "nothing changed" is never said of a
 * thing that could not be seen.
 */
export interface ExtraHistory {
  entities: HistoryEntity[];
  changes: Change[];
  /** Sources that could not be read, each with why, so the answer can say what it could not see. */
  notRead: { source: string; why: string }[];
  /** Sources that were read, with the kind of change each can show, so "it did not change" is only said of something that was looked at. */
  read: { kind: ChangeKind; label: string }[];
}

export interface ExtraSources {
  db: Ledger;
  canaryRows?: readonly RunRow[];
  /** The gate's database, when there is one; the policy versions it has run are in it. */
  gateDbPath?: string | null;
  /** The owner's notes and definitions, as the memory holds them. */
  memoryNotes?: readonly { id: string; kind: string; learnedAt: string; content: string }[] | null;
}

const day = (iso: string): string => iso.slice(0, 10);

export function collectExtraHistory(s: ExtraSources): ExtraHistory {
  const out: ExtraHistory = { entities: [], changes: [], notRead: [], read: [] };

  // The model id the endpoint reported for the canary, per arm: a change of it is the first thing to look at when a score drops.
  if (s.canaryRows !== undefined && s.canaryRows.length > 0) {
    for (const arm of ["primary", "control"] as const) {
      const ch = servedChanges(s.canaryRows, arm);
      const all = new Set(s.canaryRows.filter((r) => r.arm === arm && r.servedModel !== null).map((r) => r.servedModel as string));
      for (const m of all) {
        const days = s.canaryRows.filter((r) => r.arm === arm && r.servedModel === m).map((r) => r.date).sort();
        out.entities.push({ kind: "served_model", key: `${arm}:${m}`, label: `${arm} arm served ${sanitizeLabel(m)}`, firstDay: days[0] as string, lastDay: days[days.length - 1] as string, calls: days.length });
      }
      for (const c of ch) out.changes.push({ kind: "served_model_changed", entityKind: "served_model", entityKey: `${arm}:${c.to}`, day: c.date || String(c.day), detail: { arm, from: sanitizeLabel(c.from), to: sanitizeLabel(c.to) } });
    }
    out.read.push({ kind: "served_model_changed", label: "the model id the endpoint served" });
  } else out.notRead.push({ source: "the canary's served model", why: "no canary run is recorded" });

  // The policy versions the gate has run.
  if (s.gateDbPath === undefined || s.gateDbPath === null || !existsSync(s.gateDbPath)) out.notRead.push({ source: "the gate's policy versions", why: "no gate database is here" });
  else {
    const g = new DatabaseSync(s.gateDbPath, { readOnly: true });
    try {
      const rows = g.prepare("SELECT digest, version, first_seen FROM gate_policy_seen ORDER BY first_seen, version").all() as unknown as { digest: string; version: number; first_seen: string }[];
      rows.forEach((r, i) => {
        out.entities.push({ kind: "policy", key: r.digest, label: `policy version ${r.version}`, firstDay: day(r.first_seen), lastDay: day(rows[i + 1]?.first_seen ?? r.first_seen), calls: 0 });
        if (i > 0) out.changes.push({ kind: "policy_changed", entityKind: "policy", entityKey: r.digest, day: day(r.first_seen), detail: { version: r.version, from: rows[i - 1]!.version } });
      });
      out.read.push({ kind: "policy_changed", label: "the policy the gate was running" });
    } catch {
      out.notRead.push({ source: "the gate's policy versions", why: "the gate database has no record of them" });
    } finally {
      g.close();
    }
  }

  // The price lists the ledger has been priced with.
  const prices = s.db.prepare("SELECT snapshot_id, fetched_at FROM price_snapshot ORDER BY fetched_at, snapshot_id").all() as unknown as { snapshot_id: string; fetched_at: string }[];
  prices.forEach((p, i) => {
    out.entities.push({ kind: "price_list", key: p.snapshot_id, label: `price list ${sanitizeLabel(p.snapshot_id)}`, firstDay: day(p.fetched_at), lastDay: day(prices[i + 1]?.fetched_at ?? p.fetched_at), calls: 0 });
    if (i > 0) out.changes.push({ kind: "price_list_changed", entityKind: "price_list", entityKey: p.snapshot_id, day: day(p.fetched_at), detail: { from: sanitizeLabel(prices[i - 1]!.snapshot_id) } });
  });
  out.read.push({ kind: "price_list_changed", label: "the price list" });

  // What the owner edited in the memory.
  if (s.memoryNotes === undefined || s.memoryNotes === null) out.notRead.push({ source: "the owner's notes", why: "the memory was not opened" });
  else {
    for (const n of s.memoryNotes) {
      out.entities.push({ kind: "owner_edit", key: n.id, label: `${n.kind === "outcome_definition" ? "definition of landed" : "note"} ${n.id}`, firstDay: n.learnedAt, lastDay: n.learnedAt, calls: 0 });
      out.changes.push({ kind: "owner_edit", entityKind: "owner_edit", entityKey: n.id, day: n.learnedAt, detail: { kind: n.kind } });
    }
    out.read.push({ kind: "owner_edit", label: "the owner's notes and definitions" });
  }

  // What a kind of work was promoted, demoted or blocked to; the policy changes the owner approved.
  const autonomy = s.db.prepare("SELECT event_id AS id, workflow, at, kind, to_tier AS toTier FROM autonomy_event WHERE kind IN ('promoted', 'demoted', 'blocked', 'unblocked') ORDER BY event_id").all() as unknown as { id: number; workflow: string; at: string; kind: string; toTier: string }[];
  for (const a of autonomy) {
    out.entities.push({ kind: "owner_edit", key: `autonomy:${a.id}`, label: `${a.workflow} ${a.kind} to ${a.toTier}`, firstDay: day(a.at), lastDay: day(a.at), calls: 0 });
    out.changes.push({ kind: "autonomy_changed", entityKind: "owner_edit", entityKey: `autonomy:${a.id}`, day: day(a.at), detail: { workflow: sanitizeLabel(a.workflow), to: a.toTier } });
  }
  out.read.push({ kind: "autonomy_changed", label: "what any kind of work has earned" });
  const precedents = s.db.prepare("SELECT precedent_id AS id, adopted_at_ms AS at, summary FROM policy_precedent ORDER BY adopted_at_ms").all() as unknown as { id: string; at: number; summary: string }[];
  for (const p of precedents) {
    const d = new Date(p.at).toISOString().slice(0, 10);
    out.entities.push({ kind: "owner_edit", key: `precedent:${p.id}`, label: `approved policy change ${sanitizeLabel(p.id)}`, firstDay: d, lastDay: d, calls: 0 });
    out.changes.push({ kind: "precedent_adopted", entityKind: "owner_edit", entityKey: `precedent:${p.id}`, day: d, detail: { id: sanitizeLabel(p.id) } });
  }
  out.read.push({ kind: "precedent_adopted", label: "the policy changes you approved" });
  return out;
}
