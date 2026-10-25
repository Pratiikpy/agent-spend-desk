import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { defaultKeyPath, loadOrCreateSigner, loadSigner, type Signer } from "../dossier/keys.ts";
import type { Ledger } from "../ledger/db.ts";
import { authorize, authorizeAdmin, VIEW_NAMES, VIEWS, type AdminAction, type View } from "./rbac.ts";
import { buildTeamReport, parsePublicKey, shapeProblem, signReport, verifyReport } from "./report.ts";
import { logAccess, members, memberByKey, memberById, ROLES, team, verifyAccessLog, type Member, type Role, type TeamDb } from "./store.ts";
import { accessLogView, breakdownView, landingView, meView, peopleView, renderView, rolesView, settingsView, spendView, type AnyView, type Span } from "./views.ts";

export const DEFAULT_TEAM_DB = "data/desk/team.db";
const PERSON_ID = /^[a-z0-9][a-z0-9._-]{0,31}$/;

export type Outcome<T = undefined> = { ok: true; text: string; data?: T } | { ok: false; text: string };

/** Who is asking: the member whose key signed the request, or nobody. The Desk has no passwords; a person is the holder of a key the owner has registered. */
export function identify(db: TeamDb, signer: Signer): Member | null {
  const m = memberByKey(db, signer.keyid);
  return m;
}

function logAdmin(db: TeamDb, who: Member | null, signer: Signer, action: AdminAction | string, allowed: boolean, reason: string, params: Record<string, unknown>, at: string): void {
  logAccess(db, { at, personId: who?.personId ?? null, keyId: signer.keyid, role: who?.role ?? null, view: `admin:${action}`, allowed, reason, params });
}

/** Run an admin action as `signer`: refused, and logged as refused, unless they are an owner. */
function asOwner(db: TeamDb, signer: Signer, action: AdminAction, params: Record<string, unknown>, now: () => string): { ok: true; who: Member } | { ok: false; text: string } {
  const who = identify(db, signer);
  const d = authorizeAdmin(who === null ? null : who.role, action);
  if (!d.allowed) {
    logAdmin(db, who, signer, action, false, d.reason, params, now());
    return { ok: false, text: `Denied: ${d.reason}.` };
  }
  return { ok: true, who: who as Member };
}

export function initTeam(db: TeamDb, signer: Signer, o: { name: string; person: string; display?: string }, now: () => string = () => new Date().toISOString()): Outcome {
  if (team(db) !== null) return { ok: false, text: "This team already exists; nothing was changed." };
  const name = o.name.trim();
  if (name === "" || name.length > 64) return { ok: false, text: "The team needs a name of 1 to 64 characters." };
  if (!PERSON_ID.test(o.person)) return { ok: false, text: `A person id is 1 to 32 lowercase letters, digits, dots, dashes or underscores, and starts with a letter or digit; ${JSON.stringify(o.person.slice(0, 40))} is not one.` };
  const at = now();
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO team (team_id, name, created_at) VALUES (?, ?, ?)").run("team-1", name, at);
    db.prepare("INSERT INTO team_member (person_id, display, key_id, public_key, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)").run(o.person, (o.display ?? o.person).slice(0, 64), signer.keyid, signer.publicKey, o.person, at);
    db.prepare("INSERT INTO team_roles (team_id, person_id, role, granted_by, granted_at) VALUES ('team-1', ?, 'owner', ?, ?)").run(o.person, o.person, at);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  logAccess(db, { at, personId: o.person, keyId: signer.keyid, role: "owner", view: "admin:init", allowed: true, reason: "the team was created", params: { name } });
  return { ok: true, text: `Team ${name} created. ${o.person} is its owner (key ${signer.keyid.slice(0, 12)}). Per-person views are off and the minimum group is 3.` };
}

export function addMember(db: TeamDb, signer: Signer, o: { person: string; display?: string; publicKey: string; role?: Role }, now: () => string = () => new Date().toISOString()): Outcome {
  const params = { person: o.person, role: o.role ?? "viewer" };
  const auth = asOwner(db, signer, "add-member", params, now);
  if (!auth.ok) return auth;
  if (!PERSON_ID.test(o.person)) return { ok: false, text: `A person id is 1 to 32 lowercase letters, digits, dots, dashes or underscores, and starts with a letter or digit; ${JSON.stringify(o.person.slice(0, 40))} is not one.` };
  const role = o.role ?? "viewer";
  if (!ROLES.includes(role)) return { ok: false, text: `The roles are ${ROLES.join(", ")}.` };
  const key = parsePublicKey(o.publicKey);
  if (!key) return { ok: false, text: "That is not an Ed25519 public key in base64 (the form `desk team key` prints)." };
  const der = key.export({ format: "der", type: "spki" });
  const keyId = createKeyId(der);
  if (memberById(db, o.person)) return { ok: false, text: `${o.person} is already in the team.` };
  if (memberByKey(db, keyId)) return { ok: false, text: "That key already belongs to someone in the team." };
  const at = now();
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO team_member (person_id, display, key_id, public_key, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)").run(o.person, (o.display ?? o.person).slice(0, 64), keyId, Buffer.from(der).toString("base64"), auth.who.personId, at);
    db.prepare("INSERT INTO team_roles (team_id, person_id, role, granted_by, granted_at) VALUES ('team-1', ?, ?, ?, ?)").run(o.person, role, auth.who.personId, at);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  logAdmin(db, auth.who, signer, "add-member", true, `${o.person} was added as ${role}`, params, at);
  return { ok: true, text: `${o.person} added as ${role} (key ${keyId.slice(0, 12)}).` };
}

const createKeyId = (der: Uint8Array): string => createHash("sha256").update(der).digest("hex");

const owners = (db: TeamDb): Member[] => members(db).filter((m) => m.role === "owner");

export function setRole(db: TeamDb, signer: Signer, o: { person: string; role: Role | "none" }, now: () => string = () => new Date().toISOString()): Outcome {
  const action: AdminAction = o.role === "none" ? "revoke" : "grant";
  const params = { person: o.person, role: o.role };
  const auth = asOwner(db, signer, action, params, now);
  if (!auth.ok) return auth;
  const target = memberById(db, o.person);
  if (!target) return { ok: false, text: `${o.person} is not in this team.` };
  if (o.role !== "none" && !ROLES.includes(o.role)) return { ok: false, text: `The roles are ${ROLES.join(", ")}.` };
  if (target.role === "owner" && o.role !== "owner" && owners(db).length <= 1) {
    logAdmin(db, auth.who, signer, action, false, "the last owner cannot be demoted or withdrawn", params, now());
    return { ok: false, text: "Denied: the last owner cannot be demoted or withdrawn, or the team could not be managed again." };
  }
  if (target.role === o.role) return { ok: true, text: `${o.person} already holds ${o.role === "none" ? "no role" : `the role ${o.role}`}.` };
  const at = now();
  db.prepare("INSERT INTO team_roles (team_id, person_id, role, granted_by, granted_at) VALUES ('team-1', ?, ?, ?, ?)").run(o.person, o.role, auth.who.personId, at);
  logAdmin(db, auth.who, signer, action, true, `${o.person} went from ${target.role} to ${o.role}`, params, at);
  return { ok: true, text: o.role === "none" ? `${o.person}'s access was withdrawn. The reports they sent stay in the team's totals; they can no longer see anything or send more.` : `${o.person} is now ${o.role === "owner" || o.role === "lead" ? "an" : "a"} ${o.role}.` };
}

export function setSettings(db: TeamDb, signer: Signer, o: { perPerson?: boolean; minGroup?: number }, now: () => string = () => new Date().toISOString()): Outcome {
  const params = { perPerson: o.perPerson ?? null, minGroup: o.minGroup ?? null };
  const auth = asOwner(db, signer, "settings", params, now);
  if (!auth.ok) return auth;
  if (o.minGroup !== undefined && (!Number.isInteger(o.minGroup) || o.minGroup < 1 || o.minGroup > 20)) return { ok: false, text: "The minimum group is a whole number from 1 to 20." };
  const before = team(db);
  if (!before) return { ok: false, text: "There is no team here yet." };
  if (o.perPerson !== undefined) db.prepare("UPDATE team SET per_person = ?").run(o.perPerson ? 1 : 0);
  if (o.minGroup !== undefined) db.prepare("UPDATE team SET min_group = ?").run(o.minGroup);
  const lowered = o.minGroup !== undefined && o.minGroup < before.min_group;
  logAdmin(db, auth.who, signer, "settings", true, `per-person ${o.perPerson === undefined ? "unchanged" : o.perPerson ? "on" : "off"}, minimum group ${o.minGroup ?? before.min_group}`, params, now());
  return { ok: true, text: `Settings changed. ${o.perPerson === true ? "Per-person views are on: leads and owners can now list each person's own spend, by name. " : ""}${lowered ? `The minimum group is now ${o.minGroup}: lines with fewer people than before will be shown.` : ""}`.trim() };
}

export interface MergeResult {
  added: number;
  already: number;
  rejected: { name: string; why: string }[];
}

/** Take in the reports people sent. Each is checked against the keys of the team's members, and must be signed by the member it names. */
export function mergeReports(db: TeamDb, signer: Signer, files: { name: string; envelope: unknown }[], now: () => string = () => new Date().toISOString()): Outcome<MergeResult> {
  const auth = asOwner(db, signer, "merge", { files: files.length }, now);
  if (!auth.ok) return auth;
  const live = members(db).filter((m) => m.role !== "none");
  const keys = new Map<string, import("node:crypto").KeyObject>();
  for (const m of live) {
    const k = parsePublicKey(m.publicKey);
    if (k) keys.set(m.keyId, k);
  }
  const result: MergeResult = { added: 0, already: 0, rejected: [] };
  const at = now();
  for (const f of files) {
    const c = verifyReport(f.envelope, keys);
    if (!c.ok) {
      result.rejected.push({ name: f.name, why: c.why });
      continue;
    }
    const sender = live.find((m) => m.keyId === c.keyId) as Member;
    if (c.report.person !== sender.personId) {
      result.rejected.push({ name: f.name, why: `it says it is from ${c.report.person} but it is signed by ${sender.personId}` });
      continue;
    }
    const exists = db.prepare("SELECT 1 FROM team_report WHERE digest = ?").get(c.digest);
    if (exists) {
      result.already += 1;
      continue;
    }
    db.prepare("INSERT INTO team_report (digest, person_id, key_id, period_from, period_to, received_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(c.digest, sender.personId, c.keyId, c.report.period.from, c.report.period.to, at, JSON.stringify(c.report));
    result.added += 1;
  }
  logAdmin(db, auth.who, signer, "merge", true, `${result.added} reports taken in, ${result.already} already held, ${result.rejected.length} refused`, { files: files.length }, at);
  const lines = [`${result.added} report${result.added === 1 ? "" : "s"} taken in, ${result.already} already held, ${result.rejected.length} refused.`];
  for (const r of result.rejected) lines.push(`  refused ${r.name}: ${r.why}`);
  return { ok: true, text: lines.join("\n"), data: result };
}

/** A member's report from their own ledger, signed with their key. It needs no team database: they send the file. */
export function exportReport(ledger: Ledger, signer: Signer, o: { person: string; fromIso: string; toIso: string; anonymiseProjects?: boolean }): { envelope: ReturnType<typeof signReport>; days: number; problem: string | null } {
  const report = buildTeamReport(ledger, o);
  return { envelope: signReport(report, signer), days: report.days.length, problem: shapeProblem(report) };
}

export interface ViewOptions {
  span?: Span;
  limit?: number;
  /** Asked for by a caller who wants people in an order of spend. Refused, and the refusal logged. */
  sort?: string;
}

export interface ViewResult {
  allowed: boolean;
  text: string;
  view?: AnyView;
  who: Member | null;
}

/** Ask to see a view as the holder of `signer`: identified, checked against the role table, written to the access log whether allowed or not, and only then computed. */
export function viewAs(db: TeamDb, signer: Signer, name: string, o: ViewOptions = {}, now: () => string = () => new Date().toISOString()): ViewResult {
  const at = now();
  const who = identify(db, signer);
  const params: Record<string, unknown> = { from: o.span?.from ?? null, to: o.span?.to ?? null, limit: o.limit ?? null, sort: o.sort ?? null };
  if (!(VIEW_NAMES as string[]).includes(name)) {
    logAccess(db, { at, personId: who?.personId ?? null, keyId: signer.keyid, role: who?.role ?? null, view: name.slice(0, 40), allowed: false, reason: "no such view", params });
    return { allowed: false, text: `There is no view called ${JSON.stringify(name.slice(0, 40))}. The views are ${VIEW_NAMES.join(", ")}.`, who };
  }
  const view = name as View;
  const t = team(db);
  const decision = authorize(who === null ? null : who.role, view, { perPerson: t?.per_person === 1 });
  const deny = (reason: string): ViewResult => {
    logAccess(db, { at, personId: who?.personId ?? null, keyId: signer.keyid, role: who?.role ?? null, view, allowed: false, reason, params });
    return { allowed: false, text: `Denied: ${reason}.`, who };
  };
  if (!decision.allowed) return deny(decision.reason);
  if (o.sort !== undefined) return deny("the Desk does not rank people, so there is no way to sort a view by spend or by anything else");
  const span = o.span ?? {};
  const data: AnyView =
    view === "spend" ? spendView(db, span)
    : view === "models" ? breakdownView(db, "models", span)
    : view === "projects" ? breakdownView(db, "projects", span)
    : view === "landing" ? landingView(db, span)
    : view === "me" ? meView(db, (who as Member).personId, span)
    : view === "people" ? peopleView(db, span)
    : view === "roles" ? rolesView(db)
    : view === "access-log" ? accessLogView(db, o.limit ?? 50)
    : settingsView(db);
  logAccess(db, { at, personId: who?.personId ?? null, keyId: signer.keyid, role: who?.role ?? null, view, allowed: true, reason: "allowed by the role table", params });
  return { allowed: true, text: renderView(data), view: data, who };
}

/** `desk team <sub> ...`, for the command line. */
export async function teamCommand(o: { sub: string | undefined; args: string[]; teamDb: TeamDb | null; openTeamDb: () => TeamDb; ledger: () => Ledger; env: Record<string, string | undefined>; flags: { from?: string; to?: string; person?: string; display?: string; key?: string; role?: string; out?: string; perPerson?: string; minGroup?: string; limit?: string; sort?: string; anonymise?: boolean; name?: string } }): Promise<string> {
  const sub = o.sub ?? "help";
  const keyPath = defaultKeyPath(o.env);
  if (sub === "help" || sub === undefined) return HELP;
  if (sub === "key") {
    const { signer, created } = loadOrCreateSigner(keyPath);
    return [`public key (give this to the owner of the team): ${signer.publicKey}`, `key id: ${signer.keyid}`, created ? `A signing key was created at ${keyPath}.` : `Your signing key is at ${keyPath}.`].join("\n");
  }
  if (sub === "export") {
    const person = o.flags.person ?? "";
    if (!PERSON_ID.test(person)) return "Say who the report is from with --person <id>, the id the owner added you under.";
    const { signer } = loadOrCreateSigner(keyPath);
    const from = o.flags.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
    const to = o.flags.to ?? new Date().toISOString();
    const r = exportReport(o.ledger(), signer, { person, fromIso: from, toIso: to, ...(o.flags.anonymise ? { anonymiseProjects: true } : {}) });
    if (r.problem) return `The report was not written: ${r.problem}.`;
    const out = o.flags.out ?? `team-report-${person}.dsse.json`;
    writeFileSync(out, `${JSON.stringify(r.envelope, null, 2)}\n`);
    return `Wrote ${out}: ${r.days} days of ${person}'s spend by model, project and outcome, signed with key ${signer.keyid.slice(0, 12)}. It holds no prompt, path, session or commit.${o.flags.anonymise ? " Project names are replaced by codes." : ""}`;
  }
  const db = o.teamDb ?? o.openTeamDb();
  const signer = sub === "init" ? loadOrCreateSigner(keyPath).signer : loadSigner(keyPath);
  const text = (r: { text: string }): string => r.text;
  if (sub === "init") return text(initTeam(db, signer, { name: o.flags.name ?? o.args[0] ?? "", person: o.flags.person ?? "owner", ...(o.flags.display ? { display: o.flags.display } : {}) }));
  if (sub === "add-member") {
    const person = o.args[0] ?? "";
    const raw = o.flags.key ?? "";
    let publicKey = raw;
    try {
      const body = readFileSync(raw, "utf8");
      const m = /-----BEGIN PUBLIC KEY-----([\s\S]*?)-----END PUBLIC KEY-----/.exec(body);
      publicKey = m ? (m[1] as string).replace(/\s+/g, "") : body.trim();
    } catch {
      /* not a file: the key itself */
    }
    return text(addMember(db, signer, { person, publicKey, ...(o.flags.display ? { display: o.flags.display } : {}), ...(o.flags.role ? { role: o.flags.role as Role } : {}) }));
  }
  if (sub === "grant") return text(setRole(db, signer, { person: o.args[0] ?? "", role: (o.args[1] ?? "") as Role }));
  if (sub === "revoke") return text(setRole(db, signer, { person: o.args[0] ?? "", role: "none" }));
  if (sub === "settings") {
    if (o.flags.perPerson === undefined && o.flags.minGroup === undefined) {
      const r = viewAs(db, signer, "settings");
      return r.text;
    }
    const mg = o.flags.minGroup === undefined ? undefined : Number(o.flags.minGroup);
    return text(setSettings(db, signer, { ...(o.flags.perPerson === undefined ? {} : { perPerson: o.flags.perPerson === "on" }), ...(mg === undefined ? {} : { minGroup: mg }) }));
  }
  if (sub === "merge") {
    const files = o.args.map((name) => {
      try {
        return { name, envelope: JSON.parse(readFileSync(name, "utf8")) as unknown };
      } catch {
        return { name, envelope: null };
      }
    });
    if (files.length === 0) return "Name the report files to take in: desk team merge team-report-ana.dsse.json team-report-ben.dsse.json";
    return text(mergeReports(db, signer, files));
  }
  if (sub === "verify-log") {
    const v = verifyAccessLog(db);
    return v.ok ? `The access log holds ${v.lines} lines and every one follows from the one before it.` : `The access log was changed: line ${v.firstBad} does not follow from the line before it.`;
  }
  if (sub === "view") {
    const name = o.args[0] ?? "";
    const from = o.flags.from, to = o.flags.to;
    const span: Span = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
    return viewAs(db, signer, name, { span, ...(o.flags.limit ? { limit: Number(o.flags.limit) } : {}), ...(o.flags.sort ? { sort: o.flags.sort } : {}) }).text;
  }
  return `Unknown team command ${JSON.stringify(sub)}.\n${HELP}`;
}

const HELP = [
  "desk team: a team's spend across people and machines, with each person seeing what their role allows",
  "  key                         print your public key, to give to the owner (creates a signing key if you have none)",
  "  export --person ID          write your ledger's totals by day as a signed report to send to the team (no prompts, paths or sessions)",
  "  init NAME --person ID       create the team here; you are its owner",
  "  add-member ID --key FILE    (owner) add a person by their public key; --role viewer|member|lead|owner",
  "  grant ID ROLE | revoke ID   (owner) change a role, or withdraw access",
  "  settings [--per-person on|off] [--min-group N]   (owner)",
  "  merge FILE...               (owner) take in the reports people sent",
  `  view ${VIEW_NAMES.join(" | ")}`,
  "  verify-log                  check that the access log has not been changed",
].join("\n");

export { VIEWS };
