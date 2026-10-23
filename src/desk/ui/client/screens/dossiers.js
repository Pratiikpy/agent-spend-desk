// Dossiers: signed records a stranger can check offline. Each is verified again here by the same verifier the
// command line uses, and its output is shown as it is.
import { h } from "../lib/dom.js";
import { head, section, emptyState, table, footnote, pill } from "../lib/ui.js";
import { stamp } from "../lib/fmt.js";

export const usesRange = false;

function bytes(n) {
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export async function render(ctx) {
  const d = await ctx.api("/api/dossiers");
  const pending = d.pending.length
    ? section(
        "Waiting for you",
        "not approved yet",
        ...d.pending.map((p) =>
          h(
            "div",
            { class: "card" },
            h("h3", null, "A policy change is waiting for approval"),
            h("ul", { class: "list" }, ...p.claims.map((c) => h("li", null, c))),
            h("p", { class: "note" }, `Rules added: ${p.ruleIds.join(", ") || "none"}.`),
            h("p", { class: "note" }, "Approve by echoing the action digest printed when the request was issued:"),
            h("pre", { class: "src" }, `desk approve ${p.requestId} <action digest>`),
          ),
        ),
      )
    : null;
  if (d.bundles.length === 0 && !pending) {
    return h("div", null, head("Dossiers", "None yet"), emptyState({ reason: "No signed dossier exists yet.", hint: "desk propose --dossier, then desk approve <request> <digest>" }));
  }
  return h(
    "div",
    null,
    head("Dossiers", "Records you can check offline", "A dossier carries its own evidence. Anyone can verify it without the Desk, a network or an account."),
    pending,
    ...d.bundles.map((b) =>
      section(
        b.kind ? b.kind.replace("_", " ") : "bundle",
        b.createdAt ? stamp(b.createdAt) : b.id,
        b.error
          ? h("div", { class: "state error", role: "alert" }, h("span", { class: "kicker" }, "Could not read"), h("p", null, b.error))
          : h(
              "div",
              null,
              h("div", { class: b.overall === "PASS" ? "bigverdict pass" : "bigverdict fail" }, b.overall === "PASS" ? "PASS" : b.overall === "FAIL" ? "FAIL" : b.overall),
              h("p", { class: "note" }, `${b.id}, ${bytes(b.sizeBytes)}. ${b.pinned ? "Signer pinned." : "No pin was given, so the signer is not established."}`),
              table(
                "What the verifier checked",
                [
                  { label: "Level", id: true, render: (l) => l.id },
                  { label: "Result", render: (l) => pill(l.status === "NOT_APPLICABLE" ? "not applicable" : l.status, l.status === "PASS" ? "live" : l.status === "FAIL" ? "risk" : "") },
                  { label: "Check", render: (l) => h("span", null, l.name, ...l.findings.map((f) => h("div", { class: "muted" }, `${f.code}: ${f.detail}`)), ...l.notes.map((n) => h("div", { class: "muted" }, n))) },
                ],
                b.levels,
              ),
              h("p", { class: "note" }, `PASS means: ${b.means}`),
              h("p", { class: "note" }, b.doesNotMean),
              h("pre", { class: "src" }, `node src/desk/verify/main.ts data/desk/dossiers/${b.id} --pins data/desk/dossiers/${b.id}.pins.json`),
            ),
      ),
    ),
    footnote("The verifier runs on plain Node with no network. Change one byte of a bundle and it names the row."),
  );
}
