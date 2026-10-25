import type { Metric, Scorecard, Section } from "./model.ts";

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function metricTable(metrics: readonly Metric[]): string[] {
  if (metrics.length === 0) return [];
  const out = ["| Measure | Value | Note |", "|---|---|---|"];
  for (const m of metrics) out.push(`| ${cell(m.label)} | ${cell(m.value)} | ${cell(m.note ?? "")} |`);
  return out;
}

function renderSection(s: Section): string[] {
  const out = [`## ${s.title}`, "", `**Asks:** ${s.question}`, ""];
  if (s.findings.length > 0) out.push(...s.findings.map((f) => `- ${f}`), "");
  out.push(...metricTable(s.metrics), "");
  out.push(`Reproduce: ${s.reproduce.map((c) => `\`${c}\``).join("; ")}${s.seed !== null ? `. Seed ${s.seed}.` : "."}`, "");
  if (s.inputs.length > 0) out.push(`Inputs: ${s.inputs.map((i) => `\`${i.path}\` ${i.digest === "missing" ? "(missing)" : i.digest.slice(0, 19)}`).join("; ")}`, "");
  if (s.limits.length > 0) out.push("What this does not show:", "", ...s.limits.map((l) => `- ${l}`), "");
  return out;
}

/** The published page. Everything on it comes from the scorecard object; nothing is added by hand. */
export function renderScorecard(card: Scorecard): string {
  const open = card.sections.flatMap((s) => s.metrics.filter((m) => m.status !== "measured").map((m) => ({ section: s.title, metric: m })));
  const out = [
    "# Reasoning and sponsor scorecard",
    "",
    "Every number on this page is computed by `npm run desk -- scorecard` from files in this repository or from a run of the code, and the page is rewritten by that command; none is typed. `npm run desk -- scorecard --check` recomputes it and fails if this file differs by one byte. A quantity that was not measured says NOT VERIFIED, and one that does not exist for this product says so.",
    "",
    "A result that goes against the Desk is published as it falls. A role that is not shown necessary is not claimed as useful and is not called useless: sixty questions cannot show that a part changes nothing.",
    "",
    `Contents: ${card.sections.map((s) => s.title).join("; ")}.`,
    "",
  ];
  for (const s of card.sections) out.push(...renderSection(s));
  out.push("## Not measured", "");
  if (open.length === 0) out.push("Every metric on this page was measured.");
  else out.push(...open.map((o) => `- ${o.section}: ${o.metric.label}. ${o.metric.status === "not_verified" ? "NOT VERIFIED" : "Not applicable"}: ${o.metric.note ?? ""}`));
  out.push("");
  return out.join("\n");
}
