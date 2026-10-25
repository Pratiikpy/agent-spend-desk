import { createPublicKey, type KeyObject } from "node:crypto";

import { canonicalJson } from "../../runtime/canonical.ts";
import { signEnvelope } from "../dossier/sign.ts";
import type { Signer } from "../dossier/keys.ts";
import { folderName } from "../engines/label.ts";
import type { Ledger } from "../ledger/db.ts";
import { checkEnvelope, strictBase64, type Envelope } from "../verify/dsse.ts";
import { sha256 } from "./store.ts";

/**
 * What one person sends the team (DF-059): their own ledger's totals by day, in the three cuts the team views need, and nothing else. No prompt, no path, no session id, no commit,
 * no call: a day's calls and tokens and dollars by model, by project label, and by what the work came to (landed, reverted, unlinked). Signed with the sender's key, so that the team
 * can tell who it came from and that it was not changed on the way. The dollars are the ledger's list-price estimate, as they are everywhere in the Desk.
 */
export const REPORT_PAYLOAD_TYPE = "application/vnd.desk.team-report+json";

export interface DayModel {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  micros: number;
}
export interface DayProject {
  label: string;
  calls: number;
  micros: number;
}
/** Dollars of the day by what the session's work came to, from the outcome the ledger holds: `none` when it holds none for the session. */
export type DayOutcome = Record<"unlinked" | "committed" | "merged" | "kept" | "reverted" | "none", number>;

export interface TeamDay {
  day: string;
  models: DayModel[];
  projects: DayProject[];
  outcomes: DayOutcome;
}

export interface TeamReport {
  version: 1;
  /** The person the sender says they are; the team checks it against the key that signed. */
  person: string;
  period: { from: string; to: string };
  priceSnapshot: string | null;
  unpricedCalls: number;
  days: TeamDay[];
}

const emptyOutcomes = (): DayOutcome => ({ unlinked: 0, committed: 0, merged: 0, kept: 0, reverted: 0, none: 0 });

export function buildTeamReport(db: Ledger, o: { person: string; fromIso: string; toIso: string; anonymiseProjects?: boolean }): TeamReport {
  const models = db
    .prepare(
      `SELECT substr(m.ts, 1, 10) AS day, m.model AS model, COUNT(*) AS calls, SUM(m.input_tokens) AS i, SUM(m.output_tokens) AS o, SUM(m.cache_read_tokens) AS cr,
              SUM(m.cache_write_5m_tokens + m.cache_write_1h_tokens) AS cw, COALESCE(SUM(CASE WHEN c.class = 'estimated' THEN c.total_micros END), 0) AS micros
       FROM model_call m LEFT JOIN cost_event c ON c.call_id = m.call_id WHERE m.ts >= ? AND m.ts <= ? GROUP BY day, m.model ORDER BY day, m.model`,
    )
    .all(o.fromIso, o.toIso) as unknown as { day: string; model: string; calls: number; i: number; o: number; cr: number; cw: number; micros: number }[];
  const projects = db
    .prepare(
      `SELECT substr(m.ts, 1, 10) AS day, s.project_path AS path, COUNT(*) AS calls, COALESCE(SUM(CASE WHEN c.class = 'estimated' THEN c.total_micros END), 0) AS micros
       FROM model_call m LEFT JOIN session s ON s.session_id = m.session_id LEFT JOIN cost_event c ON c.call_id = m.call_id WHERE m.ts >= ? AND m.ts <= ? GROUP BY day, s.project_path ORDER BY day`,
    )
    .all(o.fromIso, o.toIso) as unknown as { day: string; path: string | null; calls: number; micros: number }[];
  const outcomes = db
    .prepare(
      `SELECT substr(m.ts, 1, 10) AS day, COALESCE(so.state, 'none') AS state, COALESCE(SUM(CASE WHEN c.class = 'estimated' THEN c.total_micros END), 0) AS micros
       FROM model_call m LEFT JOIN cost_event c ON c.call_id = m.call_id LEFT JOIN session_outcome so ON so.session_id = m.session_id WHERE m.ts >= ? AND m.ts <= ? GROUP BY day, state`,
    )
    .all(o.fromIso, o.toIso) as unknown as { day: string; state: keyof DayOutcome; micros: number }[];
  const unpriced = (db.prepare("SELECT COUNT(*) AS n FROM model_call m LEFT JOIN cost_event c ON c.call_id = m.call_id WHERE m.ts >= ? AND m.ts <= ? AND COALESCE(c.class, 'unpriced') <> 'estimated'").get(o.fromIso, o.toIso) as { n: number }).n;
  const snapshot = (db.prepare("SELECT c.snapshot_id AS id FROM cost_event c JOIN model_call m ON m.call_id = c.call_id WHERE m.ts >= ? AND m.ts <= ? AND c.snapshot_id IS NOT NULL ORDER BY m.ts DESC LIMIT 1").get(o.fromIso, o.toIso) as { id: string } | undefined)?.id ?? null;

  const days = new Map<string, TeamDay>();
  const day = (d: string): TeamDay => {
    let x = days.get(d);
    if (!x) days.set(d, (x = { day: d, models: [], projects: [], outcomes: emptyOutcomes() }));
    return x;
  };
  for (const r of models) day(r.day).models.push({ model: r.model, calls: r.calls, inputTokens: r.i, outputTokens: r.o, cacheReadTokens: r.cr, cacheWriteTokens: r.cw, micros: r.micros });
  const labelOf = (path: string | null): string => {
    const base = folderName(path);
    return o.anonymiseProjects ? `project-${sha256(base).slice(0, 8)}` : base;
  };
  for (const r of projects) {
    const d = day(r.day);
    const label = labelOf(r.path);
    const mine = d.projects.find((p) => p.label === label);
    if (mine) {
      mine.calls += r.calls;
      mine.micros += r.micros;
    } else d.projects.push({ label, calls: r.calls, micros: r.micros });
  }
  for (const r of outcomes) day(r.day).outcomes[r.state] += r.micros;
  const list = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  for (const d of list) d.projects.sort((a, b) => a.label.localeCompare(b.label));
  return { version: 1, person: o.person, period: { from: o.fromIso, to: o.toIso }, priceSnapshot: snapshot, unpricedCalls: unpriced, days: list };
}

export function signReport(report: TeamReport, signer: Signer): Envelope {
  return signEnvelope(REPORT_PAYLOAD_TYPE, new TextEncoder().encode(canonicalJson(report)), signer);
}

export type ReportCheck = { ok: true; report: TeamReport; keyId: string; digest: string } | { ok: false; why: string };

/** Check an envelope against the keys of the team, and the report in it against its own shape. The sender is the key that signed, and the report's own `person` must be that member. */
export function verifyReport(envelope: unknown, keys: ReadonlyMap<string, KeyObject>): ReportCheck {
  const c = checkEnvelope(envelope, REPORT_PAYLOAD_TYPE, keys);
  if (!c.ok) return { ok: false, why: c.code === "signer_not_pinned" ? "it is not signed by a key of this team" : `${c.code}: ${c.detail}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(c.payload.toString("utf8"));
  } catch {
    return { ok: false, why: "the signed payload is not JSON" };
  }
  const bad = shapeProblem(parsed);
  if (bad) return { ok: false, why: bad };
  return { ok: true, report: parsed as TeamReport, keyId: c.keyid, digest: sha256(c.payload.toString("utf8")) };
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;

/** What a report may hold and nothing more: a surprise key in it is refused, because the shape is the promise that no text is in it. */
export function shapeProblem(x: unknown): string | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return "the report is not an object";
  const r = x as Record<string, unknown>;
  const only = (o: Record<string, unknown>, keys: string[], where: string): string | null => {
    const extra = Object.keys(o).filter((k) => !keys.includes(k));
    return extra.length > 0 ? `${where} has a field it should not: ${extra[0]}` : null;
  };
  const e0 = only(r, ["version", "person", "period", "priceSnapshot", "unpricedCalls", "days"], "the report");
  if (e0) return e0;
  if (r["version"] !== 1) return "the report is not version 1";
  if (typeof r["person"] !== "string" || r["person"] === "" || r["person"].length > 64) return "the report names no person";
  const p = r["period"] as Record<string, unknown> | undefined;
  if (!p || typeof p["from"] !== "string" || typeof p["to"] !== "string" || Number.isNaN(Date.parse(p["from"])) || Number.isNaN(Date.parse(p["to"]))) return "the report has no period";
  if (r["priceSnapshot"] !== null && typeof r["priceSnapshot"] !== "string") return "priceSnapshot must be a string or null";
  if (!isNum(r["unpricedCalls"])) return "unpricedCalls must be a number";
  if (!Array.isArray(r["days"])) return "days must be a list";
  for (const d of r["days"] as unknown[]) {
    if (typeof d !== "object" || d === null) return "a day must be an object";
    const day = d as Record<string, unknown>;
    const e1 = only(day, ["day", "models", "projects", "outcomes"], "a day");
    if (e1) return e1;
    if (typeof day["day"] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day["day"])) return "a day needs a date";
    if (!Array.isArray(day["models"]) || !Array.isArray(day["projects"]) || typeof day["outcomes"] !== "object" || day["outcomes"] === null) return "a day needs models, projects and outcomes";
    for (const m of day["models"] as Record<string, unknown>[]) {
      const e2 = only(m, ["model", "calls", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "micros"], "a model line");
      if (e2) return e2;
      if (typeof m["model"] !== "string" || ![m["calls"], m["inputTokens"], m["outputTokens"], m["cacheReadTokens"], m["cacheWriteTokens"], m["micros"]].every(isNum)) return "a model line is malformed";
    }
    for (const q of day["projects"] as Record<string, unknown>[]) {
      const e3 = only(q, ["label", "calls", "micros"], "a project line");
      if (e3) return e3;
      if (typeof q["label"] !== "string" || q["label"].length > 80 || !isNum(q["calls"]) || !isNum(q["micros"])) return "a project line is malformed";
    }
    const o = day["outcomes"] as Record<string, unknown>;
    const e4 = only(o, ["unlinked", "committed", "merged", "kept", "reverted", "none"], "the outcomes");
    if (e4) return e4;
    if (!["unlinked", "committed", "merged", "kept", "reverted", "none"].every((k) => isNum(o[k]))) return "the outcomes are malformed";
  }
  return null;
}

/** A member's key as the team keeps it: the base64 SPKI, checked to be an Ed25519 public key. */
export function parsePublicKey(spkiBase64: string): KeyObject | null {
  const der = strictBase64(spkiBase64);
  if (!der) return null;
  try {
    const k = createPublicKey({ key: der, format: "der", type: "spki" });
    return k.asymmetricKeyType === "ed25519" ? k : null;
  } catch {
    return null;
  }
}
