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
  if (d.state !== "ok") return h("div", null, head("Doctor", "Not available"), emptyState(d));
  const stale = d.price.ageDays !== null && d.price.ageDays > 60;
  return h(
    "div",
    null,
    head("Doctor", "What the Desk read", "Where the numbers come from, what is missing, and which services are reachable."),
    section(
      "Agent logs",
      "read-only",
      table("Adapters", [{ label: "Adapter", render: (r) => r.title }, { label: "Files", num: true, render: (r) => int(r.found) }, { label: "Size", num: true, render: (r) => bytes(r.bytes) }, { label: "Last read", render: (r) => (r.lastIngestedAt ? stamp(r.lastIngestedAt) : "never") }], d.adapters),
      d.lastRun ? h("p", { class: "note" }, `Last run: ${int(d.lastRun.files)} files, ${int(d.lastRun.lines_read)} lines, ${int(d.lastRun.calls_new)} new calls.`) : h("p", { class: "note" }, "No ingest has run yet."),
      d.skipped.malformedLines + d.skipped.truncatedTails + d.skipped.usageConflicts > 0 ? h("p", { class: "note" }, `Skipped so far: ${int(d.skipped.malformedLines)} unreadable lines, ${int(d.skipped.truncatedTails)} unfinished last lines, ${int(d.skipped.usageConflicts)} usage conflicts.`) : null,
    ),
    section(
      "What each source can tell",
      "declared, not inferred",
      h(
        "div",
        { class: "cards" },
        ...d.adapters.map((a) =>
          h(
            "div",
            { class: "card", "data-adapter": a.id },
            h("h3", null, a.title),
            h("p", { class: "note" }, a.how === "import" ? `Read when you import a file: ${a.command}` : a.found > 0 ? `${int(a.found)} file${a.found === 1 ? "" : "s"} read.` : "Nothing read yet."),
            h("ul", { class: "list" }, ...a.capabilities.map((c) => h("li", null, pill(c.level === "yes" ? "yes" : c.level === "partial" ? "partly" : "no", c.level === "yes" ? "live" : c.level === "partial" ? "" : "risk"), ` ${c.title}: ${c.note}`))),
          ),
        ),
      ),
      h("p", { class: "note" }, "A source that does not carry something leaves a gap in the Desk, never a zero."),
      d.noAdapter.length > 0 ? h("div", null, h("h3", null, "Tools with no adapter"), h("ul", { class: "list" }, ...d.noAdapter.map((n) => h("li", null, `${n.tool}: ${n.why}.`)))) : null,
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
    section(
      "Where data can leave this machine",
      d.egress.profile === "local" ? "local profile" : "declared destinations",
      d.egress.destinations.length === 0
        ? h("p", { class: "note" }, "No destination is declared: nothing leaves this machine.")
        : table("Destinations", [
            { label: "Address", id: true, render: (r) => r.origin },
            { label: "What is sent", render: (r) => r.purpose },
            { label: "Where", render: (r) => (r.refused ? "refused in the local profile" : r.loopback ? "this machine" : "another machine") },
            { label: "Declared by", render: (r) => r.declaredBy },
          ], d.egress.destinations),
      d.egress.log.requests === 0
        ? h("p", { class: "note" }, "No request has left for a model since the log began, or the log does not exist yet. Offline and sample runs send nothing.")
        : h("p", { class: "note" }, `${int(d.egress.log.requests)} requests to a model, ${bytes(d.egress.log.bytes)} in all, ${int(d.egress.log.redactions)} secret-shaped strings masked before sending. The log holds a size and a hash for each request, never the text.`),
      h("p", { class: "note" }, "Any other address is refused before a connection is made, and so is a redirect to one. Set DESK_MODEL_PROFILE=local to allow only destinations on this machine."),
    ),
    d.untrusted && d.untrusted.flags > 0
      ? section(
          "Instruction-like text in your logs",
          "found, held back, harmless to the figures",
          h("p", { class: "note" }, `${int(d.untrusted.flags)} field${d.untrusted.flags === 1 ? "" : "s"} in ${int(d.untrusted.sessions)} session${d.untrusted.sessions === 1 ? "" : "s"} (${d.untrusted.byKind.map((k) => `${k.kind.replace(/_/g, " ")} ${int(k.flags)}`).join(", ")}). Open a session to see where. These names are never shown to a model, and no cost, outcome or cap reads them.`),
        )
      : null,
    section("Repositories", "for landing", h("p", { class: "note" }, d.repos === 0 ? "No repository is linked. Outcomes stay unlinked until one is." : `${int(d.repos)} repositories are linked.`)),
    footnote(d.sampleMode ? "Sample mode: a constructed scenario." : "Your own logs. Nothing leaves this machine except to the destinations above.", `ledger ${d.ledger}`),
  );
}
