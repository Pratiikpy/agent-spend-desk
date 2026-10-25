import { readFileSync } from "node:fs";

import { scoreToolOutput } from "./index.ts";

/** `desk align <reference> <output>`: score one structured output against a reference, each a JSON file, and say where it lost points. */
export function alignCommand(o: { args: string[]; threshold?: string; ordered?: boolean; coerce?: boolean }): string {
  const [refPath, obsPath] = o.args;
  if (!refPath || !obsPath) return "Name two files: desk align <reference.json> <output.json> [--threshold 0.85] [--ordered] [--coerce]";
  let reference: string;
  let observed: string;
  try {
    reference = readFileSync(refPath, "utf8");
    observed = readFileSync(obsPath, "utf8");
  } catch (e) {
    return `Could not read a file: ${(e as Error).message}`;
  }
  const threshold = o.threshold === undefined ? undefined : Number(o.threshold);
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) return "The threshold is a number from 0 to 1.";
  const r = scoreToolOutput({ reference, observed, ...(threshold === undefined ? {} : { threshold }), ...(o.ordered ? { orderedLists: true } : {}), ...(o.coerce ? { coerceNumericStrings: true } : {}) });
  const a = r.alignment;
  const lines = [`score ${a.score.toFixed(3)}, ${a.pass ? "passes" : "does not pass"} at ${(threshold ?? 0.85).toFixed(2)}; compared as ${a.mode === "structured" ? "structure" : "words"}, confidence ${r.label}`];
  if (a.note) lines.push(`note: ${a.note}`);
  const lost = a.details.filter((d) => d.score < 1);
  if (lost.length > 0) {
    lines.push("where it lost points:");
    for (const d of lost.slice(0, 25)) lines.push(`  ${d.path === "" ? "(top)" : d.path}  ${d.kind}${d.observedKey ? ` as ${d.observedKey}` : ""}  ${d.score.toFixed(2)}`);
    if (lost.length > 25 || a.detailsTruncated) lines.push("  and more");
  }
  return lines.join("\n");
}
