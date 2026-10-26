// Team: the spend of several people, seen at the level of the viewer's role. Totals and groups of people come first; one person's own figures are a view that the owner has to turn on,
// and no view ranks people. Every view shown is written to the team's access log, which only an owner can read.
import { h } from "../lib/dom.js";
import { head, section, stat, table, footnote, pill, emptyState } from "../lib/ui.js";
import { usd, pct, int } from "../lib/fmt.js";

export const usesRange = false;

const ROLE = { viewer: "viewer", member: "member", lead: "lead", owner: "owner", none: "no access" };
const PHONE = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 720px)").matches;
// A table turns into a stack of cards on a phone, so a long one is cut to its latest rows there and says so; the figures around it still cover every row.
const LATEST = 14;
const latest = (rows, what) => {
  if (!PHONE || rows.length <= LATEST) return { rows, note: null };
  return { rows: rows.slice(-LATEST), note: h("p", { class: "note" }, `Showing the latest ${LATEST} of ${rows.length} ${what} on a small screen; a wider one shows them all.`) };
};
const day = (iso) => iso.slice(0, 10);
const at = (iso) => iso.replace("T", " ").slice(0, 16);
const notes = (v) => (v.notes && v.notes.length ? v.notes.map((n) => h("p", { class: "note" }, n)) : []);

function spendSection(v, d) {
  const cut = latest(d.days, "days");
  const rows = cut.rows;
  return section(
    "Spend by day",
    "estimated, the team in total",
    h("div", { class: "stats" }, stat("Team spend", usd(d.totalMicros), `list-price estimate, from ${int(d.teamPeople)} people`), stat("Calls", int(d.totalCalls), `${int(rows.length)} days with a report`), stat("Days held back", int(d.hiddenDays), d.hiddenDays ? `${usd(d.hiddenMicros)} of the total, with fewer than ${d.minGroup} people behind each day` : "no day had fewer than the minimum group")),
    rows.length === 0
      ? h("p", { class: "note" }, "No report covers these days.")
      : table("Days", [
          { label: "Day", render: (r) => r.day },
          { label: "People", num: true, render: (r) => (r.hidden ? "fewer than " + d.minGroup : int(r.people)) },
          { label: "Calls", num: true, render: (r) => (r.hidden ? "held back" : int(r.calls)) },
          { label: "Spend", num: true, render: (r) => (r.hidden ? "in the total only" : usd(r.micros)) },
        ], rows, { maxh: true }),
    cut.note,
    ...notes(d),
  );
}

function breakdownSection(v, d) {
  const title = d.kind === "models" ? "Spend by model" : "Spend by project";
  const word = d.kind === "models" ? "Model" : "Project";
  const rows = d.rows.slice();
  if (d.folded) rows.push({ name: `other (fewer than ${d.minGroup} people each)`, people: null, calls: d.folded.calls, micros: d.folded.micros, share: d.totalMicros === 0 ? 0 : d.folded.micros / d.totalMicros, folded: true });
  return section(
    title,
    "estimated, in alphabetical order, not in order of cost",
    rows.length === 0
      ? h("p", { class: "note" }, "Nothing is shown on its own: no line has the minimum group of people behind it.")
      : table(title, [
          { label: word, render: (r) => r.name },
          { label: "People", num: true, render: (r) => (r.people === null ? "" : int(r.people)) },
          { label: "Calls", num: true, render: (r) => int(r.calls) },
          { label: "Spend", num: true, render: (r) => usd(r.micros) },
          { label: "Share", num: true, render: (r) => pct(r.share, 1) },
        ], rows),
    ...notes(d),
  );
}

function landingSection(v, d) {
  return section(
    "What the spend bought",
    "estimated, the team in total",
    h("div", { class: "stats" }, stat("Landed", d.landedShare === null ? "n/a" : pct(d.landedShare, 1), "merged or kept, of the spend whose outcome is known"), stat("Landed spend", usd(d.landedMicros), `of ${usd(d.totalMicros)} in all`), stat("Reverted", usd(d.revertedMicros))),
    h("p", { class: "note" }, `Committed, not yet merged: ${usd(d.committedMicros)}. No commit linked: ${usd(d.unlinkedMicros)}. No outcome recorded: ${usd(d.noOutcomeMicros)}.`),
    ...notes(d),
  );
}

function meSection(v, d) {
  const cut = latest(d.days, "days");
  return section(
    "Your own spend",
    "estimated, from the reports you sent",
    d.days.length === 0
      ? h("p", { class: "note" }, "No report of yours covers these days.")
      : table("Your days", [
          { label: "Day", render: (r) => r.day },
          { label: "Calls", num: true, render: (r) => int(r.calls) },
          { label: "Spend", num: true, render: (r) => usd(r.micros) },
        ], cut.rows, { maxh: true }),
    cut.note,
    h("p", { class: "note" }, `${usd(d.totalMicros)} in all.`),
  );
}

function peopleSection(v, d) {
  return section(
    "People",
    "estimated, listed by name, never ranked",
    table("People", [
      { label: "Name", render: (r) => r.display },
      { label: "Role", render: (r) => ROLE[r.role] || r.role },
      { label: "Days reported", num: true, render: (r) => int(r.daysReported) },
      { label: "Calls", num: true, render: (r) => int(r.calls) },
      { label: "Spend", num: true, render: (r) => usd(r.micros) },
    ], d.rows),
    ...notes(d),
  );
}

function rolesSection(v, d) {
  return section(
    "Roles",
    "who is in the team",
    table("Members", [
      { label: "Name", render: (r) => `${r.display} (${r.personId})` },
      { label: "Role", render: (r) => ROLE[r.role] || r.role },
      { label: "Key", id: true, render: (r) => r.keyId.slice(0, 12) },
      { label: "Added by", render: (r) => `${r.addedBy}, ${day(r.addedAt)}` },
    ], d.rows),
    d.history.length > d.rows.length ? h("p", { class: "note" }, `${int(d.history.length)} role events are kept; none can be changed or removed.`) : null,
  );
}

function accessSection(v, d) {
  const cut = latest(d.lines, "requests");
  return section(
    "Access log",
    d.lines.length === d.total ? `all ${int(d.total)} requests` : `the last ${int(d.lines.length)} of ${int(d.total)} requests`,
    d.lines.length === 0
      ? h("p", { class: "note" }, "Nothing has been asked yet.")
      : table("Requests", [
          { label: "#", num: true, render: (r) => int(r.seq) },
          { label: "When", render: (r) => at(r.at) },
          { label: "Who", render: (r) => r.person },
          { label: "Asked for", render: (r) => r.view },
          { label: "Result", render: (r) => (r.allowed ? pill("allowed", "live") : pill("refused", "risk")) },
          { label: "Why", render: (r) => r.reason },
        ], cut.rows, { maxh: true }),
    cut.note,
    h("p", { class: "note" }, "Each line is chained to the one before it, so a line changed afterwards is found by desk team verify-log."),
  );
}

function settingsSection(v, d) {
  return section(
    "Settings",
    "set by an owner",
    h("div", { class: "stats" }, stat("Per-person views", d.perPerson ? "on" : "off", d.perPerson ? "leads and owners can list people, by name" : "no view lists one person's spend"), stat("Minimum group", int(d.minGroup), "a line with fewer people behind it is folded or held back"), stat("Reports held", int(d.reports), `from ${int(d.members)} members`)),
  );
}

const SECTION = { spend: spendSection, models: breakdownSection, projects: breakdownSection, landing: landingSection, me: meSection, people: peopleSection, roles: rolesSection, "access-log": accessSection, settings: settingsSection };

export async function render(ctx) {
  const as = ctx.params.get("as") || "";
  const d = await ctx.api("/api/team", as ? { as } : {});
  if (d.state === "empty") return h("div", null, head("Team", "No team here yet"), emptyState(d));

  const picker = d.sample
    ? (() => {
        const el = h("select", { id: "team-as", "aria-label": "View the team as" }, ...d.lookAs.map((p) => h("option", { value: p.id }, `${p.display} (${ROLE[p.role]})`)));
        el.value = d.as || "";
        el.addEventListener("change", () => ctx.navigate("team", { as: el.value }));
        return h("div", { class: "controls" }, h("label", null, "View the team as", el));
      })()
    : null;

  if (d.you === null) {
    return h(
      "div",
      null,
      head("Team", d.team.name, "Your key is not in this team, so none of its numbers are shown."),
      h("div", { class: "state error", role: "alert" }, h("span", { class: "kicker" }, "Not a member"), h("p", null, "This machine's signing key is not one the owner has added. The request was written to the team's access log."), h("p", { class: "hint" }, "desk team key prints your public key to give to the owner; the owner adds you with desk team add-member.")),
      picker,
    );
  }

  const open = d.views.filter((x) => x.allowed && x.data);
  const closed = d.views.filter((x) => !x.allowed);
  const blocks = open.map((x) => SECTION[x.name](x, x.data));
  return h(
    "div",
    null,
    head("Team", d.team.name, "Spend across people and machines, at the level your role allows. A person is never ranked, and a line with too few people behind it is folded."),
    picker,
    section(
      "You",
      "this machine's signing key",
      h("div", { class: "stats" }, stat("Signed in as", d.you.display, `${ROLE[d.you.role]}, key ${d.you.keyId.slice(0, 12)}`), stat("Members", int(d.team.members)), stat("Minimum group", int(d.team.minGroup), "people behind a line before it is shown"), stat("Per-person views", d.team.perPerson ? "on" : "off")),
    ),
    ...blocks,
    closed.length
      ? section(
          "Closed to your role",
          "not requested, so not logged",
          table("Views your role does not hold", [
            { label: "View", render: (r) => r.name },
            { label: "What it shows", render: (r) => r.what },
            { label: "Why closed", render: (r) => r.reason },
          ], closed),
        )
      : null,
    footnote("Each view above was written to the team's access log when it was opened. Dollars are list-price estimates from each person's logged tokens, not an invoice. Reports are signed by the person they come from and hold counts and dollars only: no prompt, path, session or commit."),
  );
}
