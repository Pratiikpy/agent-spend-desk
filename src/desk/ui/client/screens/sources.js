// Sources and doctor: what was read, what is missing, which services are configured. Never prints a key.
import { h } from "../lib/dom.js";
import { head, section, emptyState, table, footnote, pill } from "../lib/ui.js";
import { int, stamp } from "../lib/fmt.js";

export const usesRange = false;

function bytes(n) {
  if (!n) return "0 B";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export async function render(ctx) {
  const d = await ctx.api("/api/sources");
  if (d.state !== "ok") return h("div", null, head("Sources", "Not available"), emptyState(d));
  const stale = d.price.ageDays !== null && d.price.ageDays > 60;
  return h(
    "div",
    null,
    head("Sources", "What the Desk read", "Where the numbers come from, what is missing, and which services are reachable."),
    section(
      "Agent logs",
      "read-only",
      table("Adapters", [{ label: "Adapter", render: (r) => r.title }, { label: "Files", num: true, render: (r) => int(r.found) }, { label: "Size", num: true, render: (r) => bytes(r.bytes) }, { label: "Last read", render: (r) => (r.lastIngestedAt ? stamp(r.lastIngestedAt) : "never") }], d.adapters),
      d.lastRun ? h("p", { class: "note" }, `Last run: ${int(d.lastRun.files)} files, ${int(d.lastRun.lines_read)} lines, ${int(d.lastRun.calls_new)} new calls.`) : h("p", { class: "note" }, "No ingest has run yet."),
      d.skipped.malformedLines + d.skipped.truncatedTails + d.skipped.usageConflicts > 0 ? h("p", { class: "note" }, `Skipped so far: ${int(d.skipped.malformedLines)} unreadable lines, ${int(d.skipped.truncatedTails)} unfinished last lines, ${int(d.skipped.usageConflicts)} usage conflicts.`) : null,
    ),
    section(
      "Prices",
      "snapshot",
      h(
        "dl",
        { class: "kv" },
        h("dt", null, "Snapshot"), h("dd", { class: "mono" }, d.price.snapshotId),
        h("dt", null, "Source"), h("dd", null, d.price.source),
        h("dt", null, "Fetched"), h("dd", null, `${stamp(d.price.fetchedAt)}${d.price.ageDays !== null ? `, ${d.price.ageDays} days ago` : ""}`),
        h("dt", null, "Models priced"), h("dd", null, int(d.price.models)),
        h("dt", null, "Licence"), h("dd", null, d.price.license),
      ),
      stale ? h("p", { class: "note" }, "This snapshot is old. Prices change; rebuild it with scripts/build-price-snapshot.ts.") : null,
      d.unpriced.length === 0 ? h("p", { class: "note" }, "Every model in the ledger has a price row.") : table("Unpriced models", [{ label: "Model", id: true, render: (r) => r.model }, { label: "Why", render: (r) => r.reason || "no row" }, { label: "Calls", num: true, render: (r) => int(r.calls) }, { label: "Tokens", num: true, render: (r) => int(r.tokens) }], d.unpriced),
    ),
    section(
      "Services",
      "configured, not probed",
      h("div", { class: "cards" }, ...d.endpoints.map((e) => h("div", { class: "card s" }, h("h3", null, e.label), h("p", { class: "note" }, e.role), h("p", null, pill(e.configured ? "configured" : "not configured", e.configured ? "live" : ""), e.missing.length > 0 ? h("span", { class: "muted mono" }, ` missing ${e.missing.join(", ")}`) : null)))),
      h("p", { class: "note" }, "Keys are read from the environment and never shown. Without them the Desk uses recorded replies and local sources, and says so on each answer."),
    ),
    section("Repositories", "for landing", h("p", { class: "note" }, d.repos === 0 ? "No repository is linked. Outcomes stay unlinked until one is." : `${int(d.repos)} repositories are linked.`)),
    footnote(d.sampleMode ? "Sample mode: a constructed scenario." : "Your own logs. Nothing leaves this machine.", `ledger ${d.ledger}`),
  );
}
