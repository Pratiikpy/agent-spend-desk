import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { ephemeralSigner } from "../../src/desk/dossier/keys.ts";
import { openLedger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { PEOPLE, buildSampleTeam, reportFor, sampleSigner, TEAM_FROM } from "../../src/desk/sample/team.ts";
import { addMember, exportReport, identify, initTeam, mergeReports, setRole, setSettings, viewAs } from "../../src/desk/team/command.ts";
import { authorize, authorizeAdmin, VIEW_NAMES, VIEWS } from "../../src/desk/team/rbac.ts";
import { buildTeamReport, shapeProblem, signReport, verifyReport, parsePublicKey } from "../../src/desk/team/report.ts";
import { members, openTeam, ROLES, verifyAccessLog } from "../../src/desk/team/store.ts";
import { breakdownView, peopleView, personDays, spendView } from "../../src/desk/team/views.ts";
import { assistantLine, TempDir, testSnapshot } from "./helpers.ts";

/**
 * Team mode (DF-059): reports from several people, roles, aggregate views by default, a log of who looked. The sample team has its answers planted, so each case knows what a view
 * must show before it is run.
 */
const work = mkdtempSync(join(tmpdir(), "desk-team-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const as = (t: ReturnType<typeof buildSampleTeam>, who: string, view: string, o: Parameters<typeof viewAs>[3] = {}) => viewAs(t.db, t.signers[who]!, view, o);

describe("the role table", () => {
  it("allows each role the views the table names and denies every other, with the role that was needed", () => {
    const perPerson = { perPerson: true };
    for (const view of VIEW_NAMES) {
      for (const role of ROLES) {
        const d = authorize(role, view, perPerson);
        expect(d.allowed, `${role} on ${view}`).toBe(VIEWS[view].roles.includes(role));
        if (!d.allowed) {
          expect(d.reason).toContain(`'${view}' needs the role`);
          expect(d.reason).toContain(`you are`);
        }
      }
    }
  });

  it("denies a person who is not in the team, or whose access was withdrawn, whatever the view", () => {
    for (const view of VIEW_NAMES) {
      expect(authorize(null, view, { perPerson: true })).toMatchObject({ allowed: false, reason: "you are not in this team" });
      expect(authorize("none", view, { perPerson: true })).toMatchObject({ allowed: false, reason: "your access to this team was withdrawn" });
    }
  });

  it("keeps the view of one person closed until the owner opens it, and then open only to a lead or an owner", () => {
    expect(authorize("owner", "people", { perPerson: false })).toMatchObject({ allowed: false });
    expect(authorize("owner", "people", { perPerson: false })).toMatchObject({ reason: expect.stringMatching(/per-person views are off/) });
    expect(authorize("lead", "people", { perPerson: true }).allowed).toBe(true);
    expect(authorize("member", "people", { perPerson: true }).allowed).toBe(false);
    expect(authorize("viewer", "people", { perPerson: true }).allowed).toBe(false);
  });

  it("lets only an owner change the team", () => {
    for (const action of ["init", "add-member", "grant", "revoke", "settings", "merge"] as const) {
      expect(authorizeAdmin("owner", action).allowed).toBe(true);
      for (const role of ["lead", "member", "viewer", "none", null] as const) expect(authorizeAdmin(role, action).allowed).toBe(false);
    }
  });
});

describe("a denial, in the team", () => {
  it("is shown with the role that was needed, and written to the access log with who asked", () => {
    const t = buildSampleTeam();
    const r = as(t, "eli", "access-log");
    expect(r.allowed).toBe(false);
    expect(r.text).toBe("Denied: 'access-log' needs the role owner; you are a member.");
    const log = as(t, "ana", "access-log", { limit: 5 });
    expect(log.text).toMatch(/eli \(member\)  access-log  DENIED: 'access-log' needs the role owner/);
  });

  it("is given to every role that must be denied: each view, each role, in the real team", () => {
    const t = buildSampleTeam();
    setSettings(t.db, t.signers["ana"]!, { perPerson: true });
    for (const p of PEOPLE) {
      for (const view of VIEW_NAMES) {
        const r = as(t, p.id, view);
        expect(r.allowed, `${p.id} (${p.role}) on ${view}`).toBe(VIEWS[view].roles.includes(p.role));
      }
    }
  });

  it("is given to a key that is not in the team, and the attempt is logged with the key and not a name", () => {
    const t = buildSampleTeam();
    const stranger = ephemeralSigner();
    const r = viewAs(t.db, stranger, "spend");
    expect(r).toMatchObject({ allowed: false, text: "Denied: you are not in this team." });
    const log = t.db.prepare("SELECT person_id, key_id, allowed, view FROM team_access_log ORDER BY seq DESC LIMIT 1").get() as { person_id: string | null; key_id: string; allowed: number; view: string };
    expect(log).toMatchObject({ person_id: null, key_id: stranger.keyid, allowed: 0, view: "spend" });
  });

  it("is given to a person whose access was withdrawn, on the next request", () => {
    const t = buildSampleTeam();
    expect(as(t, "dev", "spend").allowed).toBe(true);
    expect(setRole(t.db, t.signers["ana"]!, { person: "dev", role: "none" }).ok).toBe(true);
    expect(as(t, "dev", "spend")).toMatchObject({ allowed: false, text: "Denied: your access to this team was withdrawn." });
  });

  it("is given to a view that does not exist, which is logged as well", () => {
    const t = buildSampleTeam();
    const r = as(t, "ana", "salaries");
    expect(r.allowed).toBe(false);
    expect(r.text).toContain('There is no view called "salaries"');
    expect((t.db.prepare("SELECT reason FROM team_access_log ORDER BY seq DESC LIMIT 1").get() as { reason: string }).reason).toBe("no such view");
  });
});

describe("aggregates", () => {
  it("add up to what was planted, in total and by model", () => {
    const t = buildSampleTeam();
    const s = spendView(t.db);
    expect(s.totalMicros).toBe(t.truth.totalMicros);
    expect(s.totalCalls).toBe(t.truth.totalCalls);
    const m = breakdownView(t.db, "models");
    const shown = m.rows.reduce((a, r) => a + r.micros, 0) + (m.folded?.micros ?? 0);
    expect(shown).toBe(t.truth.totalMicros);
    expect(m.rows.find((r) => r.name === "claude-opus-5")?.micros).toBe(t.truth.byModel["claude-opus-5"]);
  });

  it("fold a model or a project that fewer people than the minimum group used, and say so", () => {
    const t = buildSampleTeam();
    const m = breakdownView(t.db, "models");
    expect(m.rows.map((r) => r.name)).toEqual(["claude-opus-5", "claude-sonnet-5-5"]);
    expect(m.folded).toMatchObject({ lines: 1, micros: t.truth.byModel["claude-haiku-5-5"] });
    expect(m.notes.join(" ")).toMatch(/fewer than 3 people/);
    const p = breakdownView(t.db, "projects");
    expect(p.rows.map((r) => r.name)).toEqual(["payments-api", "web"]);
    expect(p.folded?.lines).toBe(3);
    expect(p.rows.every((r) => r.people >= 3)).toBe(true);
  });

  it("hide a day that fewer people than the minimum group worked, in the days and not in the total", () => {
    const t = buildSampleTeam();
    const s = spendView(t.db);
    const day = s.days.find((d) => d.day === t.truth.hiddenDay)!;
    expect(day).toMatchObject({ hidden: true, micros: null, calls: null, people: null });
    expect(s.hiddenDays).toBe(1);
    expect(s.totalMicros).toBe(t.truth.totalMicros);
    expect(as(t, "fay", "spend").text).toContain("2026-10-03  fewer than 3 people: in the total only");
  });

  it("show a line again when the owner lowers the minimum group, and fold more when it is raised", () => {
    const t = buildSampleTeam();
    expect(setSettings(t.db, t.signers["ana"]!, { minGroup: 2 }).ok).toBe(true);
    expect(breakdownView(t.db, "models").rows.map((r) => r.name)).toContain("claude-haiku-5-5");
    expect(setSettings(t.db, t.signers["ana"]!, { minGroup: 6 }).ok).toBe(true);
    expect(breakdownView(t.db, "models").rows.map((r) => r.name)).toEqual(["claude-sonnet-5-5"]);
  });

  it("show a team of fewer people than the minimum group only as a whole", () => {
    const db = openTeam(":memory:");
    const ana = sampleSigner("ana");
    initTeam(db, ana, { name: "two", person: "ana" });
    addMember(db, ana, { person: "ben", publicKey: sampleSigner("ben").publicKey });
    mergeReports(db, ana, [{ name: "a", envelope: signReport(reportFor(PEOPLE[0]!), ana) }, { name: "b", envelope: signReport(reportFor(PEOPLE[1]!), sampleSigner("ben")) }]);
    const s = spendView(db);
    expect(s.days.every((d) => d.hidden)).toBe(true);
    expect(s.totalMicros).toBeGreaterThan(0);
    expect(s.notes[0]).toMatch(/fewer than the minimum group of 3/);
    expect(breakdownView(db, "models").rows).toEqual([]);
  });

  it("do not cut the landing view by person, and keep spend with no outcome out of the share", () => {
    const t = buildSampleTeam();
    const l = as(t, "fay", "landing");
    expect(l.allowed).toBe(true);
    expect(l.text).toContain("landed (merged or kept)");
    expect(JSON.stringify(l.view)).not.toMatch(/"ana"|"chi"|personId/);
  });
});

describe("people are never ranked", () => {
  it("lists people by name when the owner has turned per-person views on, and in no other order, however much each spent", () => {
    const t = buildSampleTeam();
    expect(t.truth.byPerson["chi"]).toBeGreaterThan(t.truth.byPerson["ana"]! * 2);
    expect(as(t, "ben", "people").allowed).toBe(false);
    expect(setSettings(t.db, t.signers["ana"]!, { perPerson: true }).ok).toBe(true);
    const r = as(t, "ben", "people");
    expect(r.allowed).toBe(true);
    const names = peopleView(t.db).rows.map((x) => x.display);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    expect(names[0]).toBe("Ana Ferreira");
    expect(r.text).toContain("does not rank people");
  });

  it("gives the same order when the spending is reversed", () => {
    const a = buildSampleTeam();
    setSettings(a.db, a.signers["ana"]!, { perPerson: true });
    const before = peopleView(a.db).rows.map((x) => x.personId);
    const b = buildSampleTeam();
    setSettings(b.db, b.signers["ana"]!, { perPerson: true });
    b.db.exec("DROP TRIGGER team_report_append_only_update; UPDATE team_report SET payload_json = REPLACE(payload_json, '\"micros\":', '\"micros\":0,\"x\":') WHERE person_id = 'chi'");
    expect(peopleView(b.db).rows.map((x) => x.personId)).toEqual(before);
  });

  it("refuses to sort, and logs the request", () => {
    const t = buildSampleTeam();
    setSettings(t.db, t.signers["ana"]!, { perPerson: true });
    const r = as(t, "ben", "people", { sort: "spend" });
    expect(r).toMatchObject({ allowed: false });
    expect(r.text).toMatch(/does not rank people/);
    expect((t.db.prepare("SELECT allowed, reason FROM team_access_log ORDER BY seq DESC LIMIT 1").get() as { allowed: number; reason: string }).allowed).toBe(0);
  });

  it("shows a member only their own days in the me view", () => {
    const t = buildSampleTeam();
    const r = as(t, "dev", "me");
    expect(r.allowed).toBe(true);
    const mine = reportFor(PEOPLE.find((p) => p.id === "dev")!).days.reduce((s, d) => s + d.models.reduce((a, m) => a + m.micros, 0), 0);
    expect((r.view as { totalMicros: number }).totalMicros).toBe(mine);
    expect(as(t, "fay", "me").allowed).toBe(false);
  });
});

describe("reports", () => {
  it("are accepted from the member who signed them, once, and held as they were sent", () => {
    const t = buildSampleTeam();
    const again = mergeReports(t.db, t.signers["ana"]!, [{ name: "ana-again", envelope: signReport(reportFor(PEOPLE[0]!), t.signers["ana"]!) }]);
    expect(again).toMatchObject({ ok: true, data: { added: 0, already: 1, rejected: [] } });
    expect((t.db.prepare("SELECT COUNT(*) AS n FROM team_report").get() as { n: number }).n).toBe(PEOPLE.length);
  });

  it("are refused when signed by a key outside the team, altered, claiming to be someone else, or holding more than totals", () => {
    const t = buildSampleTeam();
    const ana = t.signers["ana"]!;
    const stranger = ephemeralSigner();
    const good = signReport(reportFor(PEOPLE[2]!), t.signers["chi"]!);
    const tampered = { ...good, payload: Buffer.from(Buffer.from(good.payload, "base64").toString("utf8").replace("claude-opus-5", "claude-opus-6")).toString("base64") };
    const impostor = signReport({ ...reportFor(PEOPLE[2]!), person: "ben" }, t.signers["chi"]!);
    const withText = signReport({ ...reportFor(PEOPLE[3]!), days: reportFor(PEOPLE[3]!).days.map((d) => ({ ...d, prompt: "refactor the secret thing" })) } as never, t.signers["dev"]!);
    const outsider = signReport(reportFor(PEOPLE[4]!), stranger);
    const r = mergeReports(t.db, ana, [
      { name: "tampered", envelope: tampered },
      { name: "impostor", envelope: impostor },
      { name: "withText", envelope: withText },
      { name: "outsider", envelope: outsider },
      { name: "junk", envelope: { not: "an envelope" } },
    ]);
    expect(r.ok).toBe(true);
    const data = (r as { data: { added: number; rejected: { name: string; why: string }[] } }).data;
    expect(data.added).toBe(0);
    const why = Object.fromEntries(data.rejected.map((x) => [x.name, x.why]));
    expect(why["tampered"]).toMatch(/signature_invalid/);
    expect(why["impostor"]).toMatch(/says it is from ben but it is signed by chi/);
    expect(why["withText"]).toMatch(/has a field it should not: prompt/);
    expect(why["outsider"]).toMatch(/not signed by a key of this team/);
    expect(why["junk"]).toMatch(/envelope_malformed/);
  });

  it("are refused from a member whose access was withdrawn, and taken in only by an owner", () => {
    const t = buildSampleTeam();
    setRole(t.db, t.signers["ana"]!, { person: "eli", role: "none" });
    const r = mergeReports(t.db, t.signers["ana"]!, [{ name: "eli", envelope: signReport({ ...reportFor(PEOPLE[4]!), period: { from: TEAM_FROM, to: "2026-11-30T00:00:00.000Z" } }, t.signers["eli"]!) }]);
    expect((r as { data: { rejected: unknown[] } }).data.rejected).toHaveLength(1);
    expect(mergeReports(t.db, t.signers["ben"]!, [])).toMatchObject({ ok: false, text: "Denied: 'merge' needs the role owner; you are a lead." });
  });

  it("let the later report for a day replace the earlier one for that person, without counting the day twice", () => {
    const t = buildSampleTeam();
    const before = spendView(t.db).totalMicros;
    const chi = reportFor(PEOPLE[2]!);
    const doubled: typeof chi = { ...chi, days: chi.days.map((d) => ({ ...d, models: d.models.map((m) => ({ ...m, micros: m.micros * 2 })) })) };
    mergeReports(t.db, t.signers["ana"]!, [{ name: "chi2", envelope: signReport(doubled, t.signers["chi"]!) }], () => "2026-11-02T09:00:00.000Z");
    const chiTotal = t.truth.byPerson["chi"]!;
    expect(spendView(t.db).totalMicros).toBe(before + chiTotal);
  });

  it("hold no text: the shape of a report allows counts, labels and dollars and nothing else", () => {
    const r = reportFor(PEOPLE[0]!);
    expect(shapeProblem(r)).toBeNull();
    expect(shapeProblem({ ...r, extra: 1 })).toMatch(/has a field it should not: extra/);
    expect(shapeProblem({ ...r, days: [{ ...r.days[0], sessionId: "s1" }] })).toMatch(/a day has a field it should not: sessionId/);
    expect(shapeProblem({ ...r, days: [{ ...r.days[0], models: [{ ...r.days[0]!.models[0], text: "x" }] }] })).toMatch(/a model line has a field it should not: text/);
    expect(shapeProblem({ ...r, person: "" })).toMatch(/names no person/);
    expect(shapeProblem({ ...r, days: [{ ...r.days[0], day: "yesterday" }] })).toMatch(/needs a date/);
  });

  it("are made from a real ledger with no path, prompt or session in them, and verify against the sender's key", async () => {
    const dir = new TempDir();
    const ledger = openLedger(":memory:");
    try {
      const folder = ["", "work", "private-client-project"].join("/");
      const file = dir.file("l.jsonl", [assistantLine({ id: "a", session: "secret-session-id", ts: "2026-10-20T10:00:00.000Z", model: "claude-sonnet-5-5", output: 500, cwd: folder }), assistantLine({ id: "b", session: "secret-session-id", ts: "2026-10-21T10:00:00.000Z", model: "claude-opus-5", output: 900, cwd: folder })]);
      await ingestClaudeCode(ledger, [file], testSnapshot());
      const signer = ephemeralSigner();
      const span = { fromIso: "2026-10-01T00:00:00.000Z", toIso: "2026-10-31T23:59:59.999Z" };
      const out = exportReport(ledger, signer, { person: "ana", ...span });
      expect(out.problem).toBeNull();
      const text = Buffer.from(out.envelope.payload, "base64").toString("utf8");
      expect(text).not.toContain("secret-session-id");
      expect(text).not.toContain(folder);
      expect(text).toContain("private-client-project");
      const anon = exportReport(ledger, signer, { person: "ana", ...span, anonymiseProjects: true });
      expect(Buffer.from(anon.envelope.payload, "base64").toString("utf8")).not.toContain("private-client-project");
      const keys = new Map([[signer.keyid, parsePublicKey(signer.publicKey)!]]);
      expect(verifyReport(out.envelope, keys).ok).toBe(true);
      expect(buildTeamReport(ledger, { person: "ana", ...span }).days.map((d) => d.day)).toEqual(["2026-10-20", "2026-10-21"]);
    } finally {
      ledger.close();
      dir.dispose();
    }
  });
});

describe("the owner's controls", () => {
  it("add a person by their key, once, and not by a bad key or an existing id or key", () => {
    const t = buildSampleTeam();
    const ana = t.signers["ana"]!;
    const gus = sampleSigner("gus");
    expect(addMember(t.db, ana, { person: "gus", publicKey: gus.publicKey, role: "member" })).toMatchObject({ ok: true });
    expect(identify(t.db, gus)?.role).toBe("member");
    expect(addMember(t.db, ana, { person: "gus", publicKey: sampleSigner("hal").publicKey }).ok).toBe(false);
    expect(addMember(t.db, ana, { person: "hal", publicKey: gus.publicKey })).toMatchObject({ ok: false, text: "That key already belongs to someone in the team." });
    expect(addMember(t.db, ana, { person: "hal", publicKey: "not a key" }).ok).toBe(false);
    expect(addMember(t.db, ana, { person: "Hal Smith", publicKey: sampleSigner("hal").publicKey }).ok).toBe(false);
    expect(addMember(t.db, t.signers["ben"]!, { person: "hal", publicKey: sampleSigner("hal").publicKey })).toMatchObject({ ok: false, text: "Denied: 'add-member' needs the role owner; you are a lead." });
  });

  it("change a role as an event, keeping every earlier one, and never leave the team without an owner", () => {
    const t = buildSampleTeam();
    const ana = t.signers["ana"]!;
    expect(setRole(t.db, ana, { person: "chi", role: "lead" }).ok).toBe(true);
    expect(members(t.db).find((m) => m.personId === "chi")?.role).toBe("lead");
    const history = t.db.prepare("SELECT role FROM team_roles WHERE person_id = 'chi' ORDER BY seq").all() as { role: string }[];
    expect(history.map((h) => h.role)).toEqual(["viewer", "member", "lead"]);
    expect(setRole(t.db, ana, { person: "ana", role: "lead" })).toMatchObject({ ok: false, text: expect.stringMatching(/last owner cannot be demoted/) });
    expect(setRole(t.db, ana, { person: "ana", role: "none" }).ok).toBe(false);
    expect(setRole(t.db, ana, { person: "ben", role: "owner" }).ok).toBe(true);
    expect(setRole(t.db, ana, { person: "ana", role: "lead" }).ok).toBe(true);
    expect(setRole(t.db, t.signers["chi"]!, { person: "chi", role: "owner" })).toMatchObject({ ok: false });
  });

  it("have no way to edit or delete a role event or a line of the access log", () => {
    const t = buildSampleTeam();
    expect(() => t.db.exec("UPDATE team_roles SET role = 'owner' WHERE person_id = 'fay'")).toThrow(/append-only/);
    expect(() => t.db.exec("DELETE FROM team_roles")).toThrow(/append-only/);
    expect(() => t.db.exec("UPDATE team_access_log SET allowed = 1")).toThrow(/append-only/);
    expect(() => t.db.exec("DELETE FROM team_access_log")).toThrow(/append-only/);
    expect(() => t.db.exec("UPDATE team_report SET person_id = 'ana'")).toThrow(/append-only/);
  });

  it("refuse a minimum group that is not a whole number from 1 to 20, and record every change of setting", () => {
    const t = buildSampleTeam();
    const ana = t.signers["ana"]!;
    for (const bad of [0, 21, 2.5, -1]) expect(setSettings(t.db, ana, { minGroup: bad }).ok).toBe(false);
    expect(setSettings(t.db, ana, { perPerson: true, minGroup: 4 }).ok).toBe(true);
    const log = as(t, "ana", "access-log", { limit: 3 }).text;
    expect(log).toMatch(/admin:settings/);
    expect(setSettings(t.db, t.signers["chi"]!, { perPerson: true })).toMatchObject({ ok: false });
  });

  it("make the team once", () => {
    const t = buildSampleTeam();
    expect(initTeam(t.db, t.signers["chi"]!, { name: "again", person: "chi" })).toMatchObject({ ok: false, text: expect.stringMatching(/already exists/) });
  });
});

describe("the access log", () => {
  it("is chained, so a line changed behind the Desk's back is found, and the line it was found at is named", () => {
    const path = join(work, "chain.db");
    const t = buildSampleTeam(path);
    as(t, "ana", "spend");
    as(t, "eli", "access-log");
    expect(verifyAccessLog(t.db)).toMatchObject({ ok: true, firstBad: null });
    t.db.exec("DROP TRIGGER team_access_log_append_only_update");
    t.db.exec("UPDATE team_access_log SET allowed = 1 WHERE view = 'access-log' AND person_id = 'eli'");
    const v = verifyAccessLog(t.db);
    expect(v.ok).toBe(false);
    expect(v.firstBad).toBe((t.db.prepare("SELECT seq FROM team_access_log WHERE view = 'access-log' AND person_id = 'eli'").get() as { seq: number }).seq);
    t.db.close();
  });

  it("records who asked, with which key, for what and with what limits", () => {
    const t = buildSampleTeam();
    as(t, "chi", "spend", { span: { from: "2026-10-05", to: "2026-10-10" } });
    const row = t.db.prepare("SELECT person_id, role, view, allowed, params FROM team_access_log ORDER BY seq DESC LIMIT 1").get() as { person_id: string; role: string; view: string; allowed: number; params: string };
    expect(row).toMatchObject({ person_id: "chi", role: "member", view: "spend", allowed: 1 });
    expect(JSON.parse(row.params)).toMatchObject({ from: "2026-10-05", to: "2026-10-10" });
  });
});

describe("a span", () => {
  it("limits every aggregate to the days asked for", () => {
    const t = buildSampleTeam();
    const week = spendView(t.db, { from: "2026-10-05", to: "2026-10-09" });
    expect(week.days.map((d) => d.day)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(week.totalMicros).toBeLessThan(spendView(t.db).totalMicros);
    expect(personDays(t.db, { from: "2026-10-05", to: "2026-10-05" }).every((p) => p.days.size <= 1)).toBe(true);
  });
});

describe("from the command line", () => {
  it("runs the whole path: a key, a team, a person added by public key, views seen as each person, and a denial", () => {
    const keys = join(work, "keys");
    const owner = { DESK_SIGNER_KEY: join(keys, "owner.pem") };
    const guest = { DESK_SIGNER_KEY: join(keys, "guest.pem") };
    const teamDb = join(work, "cli-team.db");
    const ledgerFile = join(work, "cli-ledger.db");
    const run = (env: Record<string, string>, ...args: string[]): string =>
      execFileSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "team", ...args, "--team-db", teamDb, "--db", ledgerFile], { env: { ...process.env, ...env }, encoding: "utf8" });
    const ownerKey = run(owner, "key");
    const guestKey = run(guest, "key");
    const pub = (text: string): string => /public key[^:]*: (\S+)/.exec(text)![1]!;
    expect(run(owner, "init", "--name", "cli", "--person", "owner1")).toMatch(/Team cli created/);
    const guestPub = join(work, "guest.pub");
    writeFileSync(guestPub, pub(guestKey));
    expect(run(owner, "add-member", "guest1", "--key", guestPub, "--role", "member")).toMatch(/guest1 added as member/);
    expect(run(guest, "view", "access-log")).toBe("Denied: 'access-log' needs the role owner; you are a member.\n");
    expect(run(guest, "view", "settings")).toMatch(/Denied: 'settings' needs the role owner/);
    expect(run(owner, "view", "roles")).toMatch(/guest1\)  member/);
    expect(run(owner, "verify-log")).toMatch(/every one follows from the one before it/);
    expect(pub(ownerKey)).not.toBe(pub(guestKey));
    expect(readFileSync(guestPub, "utf8")).toBe(pub(guestKey));
  }, 120_000);
});
