// Outcomes: what each session landed as, and how sure the link is. Unlinked is unknowable, never waste.
import { h } from "../lib/dom.js";
import { head, section, stat, emptyState, table, footnote, pill, PROV } from "../lib/ui.js";
import { num } from "../lib/prov.js";
import { usd, pct, int, STATE_LABEL, STATE_NOTE } from "../lib/fmt.js";
import { stackedBar, swatch } from "../lib/charts.js";

export const usesRange = true;

// Where the Desk is not sure which session a commit came from it asks. The screen only reads; answering is a command, so a stray click cannot change what the Desk believes.
function questionsSection(d) {
  const q = d.questions;
  if (!q || q.open === 0) return null;
  return section(
    "Questions",
    `${int(q.open)} open`,
    h("p", { class: "note" }, "A link the Desk is not sure of is not counted as landed. Your yes or no is kept and applied the next time landing is computed; a question you skip stays open."),
    table(
      "Is this commit from this session?",
      [
        { label: "Commit", id: true, render: (r) => r.sha },
        { label: "Made", render: (r) => r.commitAt.slice(0, 16).replace("T", " ") },
        { label: "Session", render: (r) => `${r.project}, ${r.sessionStart.slice(0, 16).replace("T", " ")} to ${r.sessionEnd.slice(11, 16)}` },
        { label: "Cost", num: true, render: (r) => usd(r.spendMicros) },
        { label: "Answer with", render: (r) => h("code", null, `desk questions answer ${r.id} yes|no`) },
      ],
      q.top,
      { maxh: true },
    ),
    q.open > q.top.length ? h("p", { class: "note" }, `${int(q.open - q.top.length)} more: desk questions lists them, desk questions ask goes through them.`) : null,
  );
}

const METHOD_LABEL = { explicit: "A label you set", ticket: "A ticket key in the branch", pull_request: "A pull request number in the branch", branch: "A feature branch", session: "The session itself" };

// Which task each session belongs to, and how that was decided. A session on no feature branch is its own task: no prompt text is kept, so nothing is grouped by what it was about.
function tasksSection(d) {
  if (!d.tasks || !d.tasks.assigned) return section("Tasks", "not identified yet", h("p", { class: "note" }, "Tasks are identified when logs are read: run `desk ingest`, then `desk task list`. Set a label for the work you start with `desk task <label>`."));
  return section(
    "Tasks",
    "how sessions were grouped",
    h("p", { class: "note" }, "A task is the work a session belongs to: your label, else a ticket key or pull request number in the branch name, else the feature branch, else the session itself."),
    h(
      "div",
      { class: "pair wide" },
      table("How tasks were identified", [{ label: "Method", render: (r) => METHOD_LABEL[r.method] || r.method }, { label: "Tasks", num: true, render: (r) => int(r.tasks) }, { label: "Sessions", num: true, render: (r) => int(r.sessions) }, { label: "Spend", num: true, render: (r) => usd(r.micros) }], d.tasks.methods),
      table("Costliest tasks", [{ label: "Task", render: (r) => r.label }, { label: "Identified by", render: (r) => (METHOD_LABEL[r.method] || r.method).toLowerCase() }, { label: "Sessions", num: true, render: (r) => int(r.sessions) }, { label: "Spend", num: true, render: (r) => usd(r.micros) }], d.tasks.top, { maxh: true }),
    ),
  );
}

export async function render(ctx) {
  const d = await ctx.api("/api/outcomes", { range: ctx.range });
  if (d.state === "empty") return h("div", null, head("Outcomes", "Nothing to attribute yet"), emptyState(d));
  if (!d.linked) {
    return h(
      "div",
      null,
      head("Outcomes", "No repository linked", "Without a link between a session and a commit, nothing can be called landed."),
      tasksSection(d),
      section("Next step", "one command", h("div", { class: "state" }, h("span", { class: "kicker" }, "Link repositories"), h("p", null, "The Desk matches a session to a commit by the files it wrote, the time, and the agent trailer on the commit. It reads file names, never contents."), h("p", { class: "hint" }, "desk landing --repo <path-to-your-repo>"))),
    );
  }
  const rows = d.landing.rows;
  return h(
    "div",
    null,
    head("Outcomes", "What the work became", `${int(d.repos)} repositories, ${int(d.commits.total)} commits, ${int(d.commits.merged)} merged, ${int(d.commits.reverted)} reverted.`),
    section(
      "By state",
      "spend",
      h(
        "div",
        { class: "pair wide" },
        h("div", null, stackedBar(rows, d.landing.totalMicros), h("p", { class: "note" }, `${usd(d.landing.lowConfidenceMicros)} of linked spend rests on weak evidence (a time window or a partial file match) and is not counted as landed.`)),
        table("Landing states", [{ label: "State", render: (r) => h("span", null, swatch(r.state), STATE_LABEL[r.state]) }, { label: "Sessions", num: true, render: (r) => int(r.sessions) }, { label: "Spend", num: true, render: (r) => num(usd(r.micros), PROV.estimated("the price book", { Note: STATE_NOTE[r.state] })) }, { label: "Share", num: true, render: (r) => pct(r.share) }], rows),
      ),
    ),
    section(
      "Evidence",
      "how links were made",
      h("p", { class: "note" }, "A link is only as good as its evidence. High means an agent trailer and the files both agree; medium means the files agree inside the session window; low means a time window or part of the files. Only medium and high can move a session out of unlinked."),
      table("Links by method", [{ label: "Method", render: (r) => r.method.replace("_", " ") }, { label: "Confidence", render: (r) => pill(r.confidence, r.confidence === "high" ? "live" : "") }, { label: "Links", num: true, render: (r) => int(r.links) }], d.byMethod),
    ),
    questionsSection(d),
    tasksSection(d),
    section(
      "Largest sessions",
      "by spend",
      table(
        "Sessions",
        [
          { label: "Session", id: true, render: (r) => h("a", { href: ctx.link("sessions", { id: r.id }) }, r.id.length > 22 ? r.id.slice(0, 20) + "..." : r.id) },
          { label: "Project", render: (r) => r.project },
          { label: "Spend", num: true, render: (r) => usd(r.micros) },
          { label: "Landed as", render: (r) => pill(STATE_LABEL[r.state] || r.state, r.state === "kept" || r.state === "merged" ? "live" : r.state === "reverted" ? "risk" : "") },
          { label: "Evidence", render: (r) => (r.method ? `${r.method.replace("_", " ")}, ${r.confidence}` : "none") },
        ],
        d.top,
        { maxh: true },
      ),
    ),
    footnote("Landing comes from git alone here. Whether checks passed needs the CI silo: see Organisation."),
  );
}
