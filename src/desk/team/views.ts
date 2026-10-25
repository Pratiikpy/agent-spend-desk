import { formatUsd } from "../money.ts";
import type { DayModel, DayOutcome, TeamDay, TeamReport } from "./report.ts";
import { members, team, type Member, type TeamDb } from "./store.ts";

/**
 * The views of the team's reports (DF-059). Every view of the team as a whole is an aggregate, and an aggregate that would be one person's own figures in disguise is not shown: a
 * line that fewer people than the team's minimum group contributed to is folded into one line that says so. A view of people lists them by name and by nothing else.
 */
export interface Span {
  from?: string;
  to?: string;
}

interface PersonDays {
  person: Member;
  days: Map<string, TeamDay>;
}

/** Each person's days, the latest report received for a day winning when two cover it. */
export function personDays(db: TeamDb, span: Span = {}): PersonDays[] {
  const rows = db
    .prepare("SELECT r.person_id AS person, r.payload_json AS payload FROM team_report r ORDER BY r.received_at, r.rowid")
    .all() as unknown as { person: string; payload: string }[];
  const roster = new Map(members(db).map((m) => [m.personId, m]));
  const by = new Map<string, PersonDays>();
  for (const r of rows) {
    const m = roster.get(r.person);
    if (!m) continue;
    const report = JSON.parse(r.payload) as TeamReport;
    let p = by.get(m.personId);
    if (!p) by.set(m.personId, (p = { person: m, days: new Map() }));
    for (const d of report.days) {
      if (span.from !== undefined && d.day < span.from.slice(0, 10)) continue;
      if (span.to !== undefined && d.day > span.to.slice(0, 10)) continue;
      p.days.set(d.day, d);
    }
  }
  return [...by.values()].sort((a, b) => a.person.personId.localeCompare(b.person.personId));
}

const sumModels = (list: readonly DayModel[]): { calls: number; micros: number; tokens: number } => list.reduce((s, m) => ({ calls: s.calls + m.calls, micros: s.micros + m.micros, tokens: s.tokens + m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheWriteTokens }), { calls: 0, micros: 0, tokens: 0 });

export interface Folded<T> {
  rows: T[];
  folded: { lines: number; contributors: number; micros: number; calls: number } | null;
}

export interface SpendView {
  kind: "spend";
  span: { from: string | null; to: string | null };
  teamPeople: number;
  minGroup: number;
  totalMicros: number;
  totalCalls: number;
  days: { day: string; people: number | null; calls: number | null; micros: number | null; hidden: boolean }[];
  hiddenDays: number;
  hiddenMicros: number;
  notes: string[];
}

export function spendView(db: TeamDb, span: Span = {}): SpendView {
  const t = team(db);
  const k = t?.min_group ?? 3;
  const people = personDays(db, span);
  const days = new Map<string, { who: Set<string>; calls: number; micros: number }>();
  for (const p of people) {
    for (const [day, d] of p.days) {
      const s = sumModels(d.models);
      const e = days.get(day) ?? { who: new Set<string>(), calls: 0, micros: 0 };
      e.who.add(p.person.personId);
      e.calls += s.calls;
      e.micros += s.micros;
      days.set(day, e);
    }
  }
  const rows = [...days].sort((a, b) => a[0].localeCompare(b[0])).map(([day, e]) => (e.who.size >= k ? { day, people: e.who.size, calls: e.calls, micros: e.micros, hidden: false } : { day, people: null, calls: null, micros: null, hidden: true }));
  const total = [...days.values()].reduce((s, e) => ({ calls: s.calls + e.calls, micros: s.micros + e.micros }), { calls: 0, micros: 0 });
  const hidden = [...days.values()].filter((e) => e.who.size < k);
  const notes: string[] = [];
  if (people.length < k) notes.push(`The team has ${people.length} ${people.length === 1 ? "person" : "people"} with reports, fewer than the minimum group of ${k}, so no day is shown on its own; the total is of everyone's reports together.`);
  else if (hidden.length > 0) notes.push(`${hidden.length} ${hidden.length === 1 ? "day" : "days"} had fewer than ${k} people working and ${hidden.length === 1 ? "is" : "are"} shown only in the total.`);
  return { kind: "spend", span: { from: span.from ?? null, to: span.to ?? null }, teamPeople: people.length, minGroup: k, totalMicros: total.micros, totalCalls: total.calls, days: rows, hiddenDays: hidden.length, hiddenMicros: hidden.reduce((s, e) => s + e.micros, 0), notes };
}

export interface BreakdownView {
  kind: "models" | "projects";
  minGroup: number;
  teamPeople: number;
  rows: { name: string; people: number; calls: number; micros: number; share: number }[];
  folded: { lines: number; micros: number; calls: number } | null;
  totalMicros: number;
  notes: string[];
}

/** Spend by model or by project over the period, a line shown only when at least the minimum group of people contributed to it, and the rest folded into one. Ordered by name, not by amount. */
export function breakdownView(db: TeamDb, kind: "models" | "projects", span: Span = {}): BreakdownView {
  const k = team(db)?.min_group ?? 3;
  const people = personDays(db, span);
  const lines = new Map<string, { who: Set<string>; calls: number; micros: number }>();
  for (const p of people) {
    for (const d of p.days.values()) {
      const items = kind === "models" ? d.models.map((m) => ({ name: m.model, calls: m.calls, micros: m.micros })) : d.projects.map((q) => ({ name: q.label, calls: q.calls, micros: q.micros }));
      for (const it of items) {
        const e = lines.get(it.name) ?? { who: new Set<string>(), calls: 0, micros: 0 };
        e.who.add(p.person.personId);
        e.calls += it.calls;
        e.micros += it.micros;
        lines.set(it.name, e);
      }
    }
  }
  const total = [...lines.values()].reduce((s, e) => s + e.micros, 0);
  const shown = [...lines].filter(([, e]) => e.who.size >= k).sort((a, b) => a[0].localeCompare(b[0]));
  const foldedLines = [...lines].filter(([, e]) => e.who.size < k);
  const folded = foldedLines.length === 0 ? null : { lines: foldedLines.length, micros: foldedLines.reduce((s, [, e]) => s + e.micros, 0), calls: foldedLines.reduce((s, [, e]) => s + e.calls, 0) };
  const notes: string[] = [];
  if (folded) notes.push(`${folded.lines} ${kind === "models" ? "model" : "project"}${folded.lines === 1 ? "" : "s"} had fewer than ${k} people using ${folded.lines === 1 ? "it" : "them"} and ${folded.lines === 1 ? "is" : "are"} folded into one line, so that no line is one person's own figure.`);
  notes.push("The lines are in alphabetical order, not in order of cost.");
  return { kind, minGroup: k, teamPeople: people.length, rows: shown.map(([name, e]) => ({ name, people: e.who.size, calls: e.calls, micros: e.micros, share: total === 0 ? 0 : e.micros / total })), folded, totalMicros: total, notes };
}

export interface LandingView {
  kind: "landing";
  totalMicros: number;
  /** The Desk's default meaning of landed: merged or kept. */
  landedMicros: number;
  committedMicros: number;
  revertedMicros: number;
  unlinkedMicros: number;
  noOutcomeMicros: number;
  landedShare: number | null;
  notes: string[];
}

export function landingView(db: TeamDb, span: Span = {}): LandingView {
  const sum: DayOutcome = { unlinked: 0, committed: 0, merged: 0, kept: 0, reverted: 0, none: 0 };
  for (const p of personDays(db, span)) for (const d of p.days.values()) for (const key of Object.keys(sum) as (keyof DayOutcome)[]) sum[key] += d.outcomes[key];
  const total = Object.values(sum).reduce((a, b) => a + b, 0);
  const landed = sum.merged + sum.kept;
  const known = total - sum.none;
  return {
    kind: "landing",
    totalMicros: total,
    landedMicros: landed,
    committedMicros: sum.committed,
    revertedMicros: sum.reverted,
    unlinkedMicros: sum.unlinked,
    noOutcomeMicros: sum.none,
    landedShare: known <= 0 ? null : landed / known,
    notes: ["Landed means merged or kept. The share is of the spend whose outcome the ledgers know; spend with no outcome recorded is shown apart and is in no share.", "This is the team in total; it is not cut by person."],
  };
}

export interface MeView {
  kind: "me";
  person: string;
  days: { day: string; calls: number; micros: number }[];
  totalMicros: number;
}

export function meView(db: TeamDb, personId: string, span: Span = {}): MeView {
  const mine = personDays(db, span).find((p) => p.person.personId === personId);
  const days = mine ? [...mine.days.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ day: d.day, calls: sumModels(d.models).calls, micros: sumModels(d.models).micros })) : [];
  return { kind: "me", person: personId, days, totalMicros: days.reduce((s, d) => s + d.micros, 0) };
}

export interface PeopleView {
  kind: "people";
  /** By display name, then by id. There is no other order and no total that ranks. */
  rows: { personId: string; display: string; role: string; daysReported: number; calls: number; micros: number }[];
  notes: string[];
}

export function peopleView(db: TeamDb, span: Span = {}): PeopleView {
  const spent = new Map(personDays(db, span).map((p) => [p.person.personId, p]));
  const rows = members(db)
    .slice()
    .sort((a, b) => a.display.localeCompare(b.display, "en", { sensitivity: "base" }) || a.personId.localeCompare(b.personId))
    .map((m) => {
      const p = spent.get(m.personId);
      const all = p ? [...p.days.values()].flatMap((d) => d.models) : [];
      const s = sumModels(all);
      return { personId: m.personId, display: m.display, role: m.role, daysReported: p ? p.days.size : 0, calls: s.calls, micros: s.micros };
    });
  return { kind: "people", rows, notes: ["Listed by name. The Desk does not rank people and offers no way to sort them by spend or by anything else."] };
}

export interface RolesView {
  kind: "roles";
  rows: { personId: string; display: string; role: string; keyId: string; addedBy: string; addedAt: string }[];
  history: { seq: number; personId: string; role: string; grantedBy: string; grantedAt: string }[];
}

export function rolesView(db: TeamDb): RolesView {
  const history = db.prepare("SELECT seq, person_id, role, granted_by, granted_at FROM team_roles ORDER BY seq").all() as unknown as { seq: number; person_id: string; role: string; granted_by: string; granted_at: string }[];
  return {
    kind: "roles",
    rows: members(db).map((m) => ({ personId: m.personId, display: m.display, role: m.role, keyId: m.keyId.slice(0, 12), addedBy: m.addedBy, addedAt: m.addedAt })),
    history: history.map((h) => ({ seq: h.seq, personId: h.person_id, role: h.role, grantedBy: h.granted_by, grantedAt: h.granted_at })),
  };
}

export interface AccessLogView {
  kind: "access-log";
  lines: { seq: number; at: string; person: string; role: string; view: string; allowed: boolean; reason: string }[];
  total: number;
}

export function accessLogView(db: TeamDb, limit = 50): AccessLogView {
  const total = (db.prepare("SELECT COUNT(*) AS n FROM team_access_log").get() as { n: number }).n;
  const rows = db.prepare("SELECT seq, at, person_id, key_id, role, view, allowed, reason FROM team_access_log ORDER BY seq DESC LIMIT ?").all(limit) as unknown as { seq: number; at: string; person_id: string | null; key_id: string | null; role: string | null; view: string; allowed: number; reason: string }[];
  return { kind: "access-log", total, lines: rows.reverse().map((r) => ({ seq: r.seq, at: r.at, person: r.person_id ?? (r.key_id ? `unknown key ${r.key_id.slice(0, 8)}` : "unknown"), role: r.role ?? "none", view: r.view, allowed: r.allowed === 1, reason: r.reason })) };
}

export interface SettingsView {
  kind: "settings";
  name: string;
  perPerson: boolean;
  minGroup: number;
  members: number;
  reports: number;
}

export function settingsView(db: TeamDb): SettingsView {
  const t = team(db);
  return { kind: "settings", name: t?.name ?? "", perPerson: t?.per_person === 1, minGroup: t?.min_group ?? 3, members: members(db).filter((m) => m.role !== "none").length, reports: (db.prepare("SELECT COUNT(*) AS n FROM team_report").get() as { n: number }).n };
}

export type AnyView = SpendView | BreakdownView | LandingView | MeView | PeopleView | RolesView | AccessLogView | SettingsView;

const usd = (m: number): string => formatUsd(m);
const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

export function renderView(v: AnyView): string {
  switch (v.kind) {
    case "spend": {
      const out = [`Team spend${v.span.from || v.span.to ? ` ${v.span.from?.slice(0, 10) ?? ""} to ${v.span.to?.slice(0, 10) ?? ""}` : ""}: ${usd(v.totalMicros)} over ${v.totalCalls.toLocaleString("en-US")} calls, from ${v.teamPeople} ${v.teamPeople === 1 ? "person" : "people"} (list-price estimate)`];
      for (const d of v.days) out.push(d.hidden ? `  ${d.day}  fewer than ${v.minGroup} people: in the total only` : `  ${d.day}  ${usd(d.micros as number)}  ${(d.calls as number).toLocaleString("en-US")} calls  ${d.people} people`);
      return [...out, ...v.notes.map((n) => `Note: ${n}`)].join("\n");
    }
    case "models":
    case "projects": {
      const out = [`Team spend by ${v.kind === "models" ? "model" : "project"}: ${usd(v.totalMicros)} in all, from ${v.teamPeople} ${v.teamPeople === 1 ? "person" : "people"}`];
      for (const r of v.rows) out.push(`  ${r.name}  ${usd(r.micros)}  ${pct(r.share)}  ${r.calls.toLocaleString("en-US")} calls  ${r.people} people`);
      if (v.folded) out.push(`  other (fewer than ${v.minGroup} people each)  ${usd(v.folded.micros)}  ${v.folded.calls.toLocaleString("en-US")} calls  ${v.folded.lines} ${v.kind === "models" ? "models" : "projects"}`);
      return [...out, ...v.notes.map((n) => `Note: ${n}`)].join("\n");
    }
    case "landing":
      return [
        `What the team's spend bought: ${usd(v.totalMicros)} in all`,
        `  landed (merged or kept)  ${usd(v.landedMicros)}${v.landedShare === null ? "" : `  ${pct(v.landedShare)} of the spend whose outcome is known`}`,
        `  committed, not yet merged  ${usd(v.committedMicros)}`,
        `  reverted  ${usd(v.revertedMicros)}`,
        `  no commit linked  ${usd(v.unlinkedMicros)}`,
        `  no outcome recorded  ${usd(v.noOutcomeMicros)}`,
        ...v.notes.map((n) => `Note: ${n}`),
      ].join("\n");
    case "me":
      return [`Your own spend: ${usd(v.totalMicros)}`, ...v.days.map((d) => `  ${d.day}  ${usd(d.micros)}  ${d.calls.toLocaleString("en-US")} calls`)].join("\n");
    case "people":
      return [`People in the team, by name`, ...v.rows.map((r) => `  ${r.display} (${r.personId}, ${r.role})  ${usd(r.micros)}  ${r.calls.toLocaleString("en-US")} calls  ${r.daysReported} days reported`), ...v.notes.map((n) => `Note: ${n}`)].join("\n");
    case "roles":
      return [`Roles`, ...v.rows.map((r) => `  ${r.display} (${r.personId})  ${r.role}  key ${r.keyId}  added by ${r.addedBy} on ${r.addedAt.slice(0, 10)}`), "", "Every change of role, oldest first:", ...v.history.map((h) => `  ${h.seq}  ${h.grantedAt.slice(0, 19)}  ${h.personId} became ${h.role === "none" ? "withdrawn" : h.role}  (by ${h.grantedBy})`)].join("\n");
    case "access-log":
      return [`Access log: the last ${v.lines.length} of ${v.total} requests`, ...v.lines.map((l) => `  ${l.seq}  ${l.at.slice(0, 19)}  ${l.person} (${l.role})  ${l.view}  ${l.allowed ? "allowed" : `DENIED: ${l.reason}`}`)].join("\n");
    case "settings":
      return [`Team ${v.name}`, `  per-person views: ${v.perPerson ? "on" : "off"}`, `  minimum group: ${v.minGroup} people`, `  members: ${v.members}`, `  reports held: ${v.reports}`].join("\n");
  }
}
