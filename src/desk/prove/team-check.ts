import { ephemeralSigner } from "../dossier/keys.ts";
import { PEOPLE, buildSampleTeam, reportFor } from "../sample/team.ts";
import { mergeReports, setSettings, viewAs } from "../team/command.ts";
import { VIEWS, VIEW_NAMES } from "../team/rbac.ts";
import { signReport } from "../team/report.ts";
import { verifyAccessLog } from "../team/store.ts";
import { breakdownView, peopleView, spendView } from "../team/views.ts";

/**
 * Team mode against a team whose answers are planted (DF-059). Six people send signed reports; the check asks what a team must get right and what it must never do:
 * add the reports up exactly, fold a line one or two people stand behind, hide a day too few people worked, refuse every view a role does not hold (and write the refusal
 * down), refuse a report that is altered, forged, unsigned by the team or holds text, never list people in an order of spend, and notice a changed line of the access log.
 */
export function teamProve(): { ok: boolean; detail: string } {
  const t = buildSampleTeam();
  const fails: string[] = [];
  const s = spendView(t.db);
  if (s.totalMicros !== t.truth.totalMicros || s.totalCalls !== t.truth.totalCalls) fails.push(`the total is ${s.totalMicros} micros over ${s.totalCalls} calls, planted ${t.truth.totalMicros} over ${t.truth.totalCalls}`);

  const models = breakdownView(t.db, "models");
  const shown = models.rows.reduce((a, r) => a + r.micros, 0) + (models.folded?.micros ?? 0);
  if (shown !== t.truth.totalMicros) fails.push("the models do not add up to the total");
  if (models.rows.some((r) => r.people < 3)) fails.push("a model used by fewer than 3 people is shown on its own");
  if (models.folded === null || models.folded.micros !== t.truth.byModel["claude-haiku-5-5"]) fails.push("the model two people used was not folded");
  const hidden = s.days.find((d) => d.day === t.truth.hiddenDay);
  if (!hidden || !hidden.hidden || hidden.micros !== null) fails.push("a day one person worked was shown");

  let denied = 0;
  setSettings(t.db, t.signers["ana"]!, { perPerson: true });
  for (const p of PEOPLE) {
    for (const v of VIEW_NAMES) {
      const r = viewAs(t.db, t.signers[p.id]!, v);
      const expected = VIEWS[v].roles.includes(p.role);
      if (r.allowed !== expected) fails.push(`${p.id} (${p.role}) ${r.allowed ? "was shown" : "was refused"} ${v}`);
      if (!r.allowed) denied += 1;
    }
  }
  if (viewAs(t.db, ephemeralSigner(), "spend").allowed) fails.push("a key outside the team was shown the spend");

  const names = peopleView(t.db).rows.map((r) => r.display);
  if (names.join("|") !== [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })).join("|")) fails.push("people are not in alphabetical order");
  if (names[0] !== "Ana Ferreira" || t.truth.byPerson["chi"]! <= t.truth.byPerson["ana"]!) fails.push("the planted top spender is not planted as one");
  if (viewAs(t.db, t.signers["ben"]!, "people", { sort: "spend" }).allowed) fails.push("a sort of people by spend was allowed");

  const owner = t.signers["ana"]!;
  const good = signReport(reportFor(PEOPLE[2]!), t.signers["chi"]!);
  const altered = { ...good, payload: Buffer.from(Buffer.from(good.payload, "base64").toString("utf8").replace("claude-opus-5", "claude-opus-6")).toString("base64") };
  const forged = signReport({ ...reportFor(PEOPLE[2]!), person: "ben" }, t.signers["chi"]!);
  const withText = signReport({ ...reportFor(PEOPLE[3]!), days: reportFor(PEOPLE[3]!).days.map((d) => ({ ...d, prompt: "text that must not be here" })) } as never, t.signers["dev"]!);
  const outside = signReport(reportFor(PEOPLE[4]!), ephemeralSigner());
  const merged = mergeReports(t.db, owner, [{ name: "altered", envelope: altered }, { name: "forged", envelope: forged }, { name: "text", envelope: withText }, { name: "outside", envelope: outside }]);
  const refused = merged.ok && merged.data ? merged.data.rejected.length : 0;
  if (refused !== 4) fails.push(`${refused} of 4 bad reports were refused`);
  if (spendView(t.db).totalMicros !== t.truth.totalMicros) fails.push("a refused report changed the total");

  const intact = verifyAccessLog(t.db);
  if (!intact.ok) fails.push("the access log did not verify as written");
  t.db.exec("DROP TRIGGER team_access_log_append_only_update");
  t.db.exec("UPDATE team_access_log SET allowed = 1 WHERE allowed = 0 AND seq = (SELECT MIN(seq) FROM team_access_log WHERE allowed = 0)");
  if (verifyAccessLog(t.db).ok) fails.push("a changed line of the access log was not noticed");

  if (fails.length > 0) return { ok: false, detail: fails.join("; ") };
  return { ok: true, detail: `${PEOPLE.length} people's signed reports add up to the planted total; ${models.folded?.lines ?? 0} model folded and 1 day hidden for having fewer than 3 people behind it; ${denied} role-and-view requests refused and logged; 4 altered, forged, unsigned or text-bearing reports refused; people listed A to Z though the top spender is not first; a changed log line is found` };
}
