import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The reasoning scorecard (DF-109) and the sponsor scorecard (DF-122) are one page, built from sections. Every number in a section is computed by the function that builds
 * it, from files in the repository or from a run of the code, and none is typed. A metric that cannot be measured says so: `not_verified` where a measurement was possible and
 * has not been made, `not_applicable` where the quantity does not exist for this product.
 */
export type MetricStatus = "measured" | "not_verified" | "not_applicable";

export interface Metric {
  id: string;
  label: string;
  value: string;
  status: MetricStatus;
  /** Said beside the value when it needs a limit or a reason. */
  note?: string;
}

export interface Input {
  path: string;
  /** Content digest with line endings normalised, so a checkout on any system gives the same one; `missing` when the path does not exist. */
  digest: string;
}

export interface Section {
  id: string;
  title: string;
  /** What this section asks. */
  question: string;
  /** Commands that regenerate its numbers. */
  reproduce: string[];
  seed: number | null;
  inputs: Input[];
  metrics: Metric[];
  /** What the numbers say, in sentences built from them. */
  findings: string[];
  /** What the section does not show. */
  limits: string[];
}

export interface Scorecard {
  version: 1;
  sections: Section[];
}

const sha = (data: string | Buffer): string => `sha256:${createHash("sha256").update(data).digest("hex")}`;

/** A text file's digest with CRLF read as LF. */
export function digestFile(path: string): string {
  if (!existsSync(path)) return "missing";
  const bytes = readFileSync(path);
  return sha(bytes.includes(13) ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8") : bytes);
}

/** A folder's digest: every file's name and normalised content digest, in name order. */
export function digestDir(path: string): string {
  if (!existsSync(path) || !statSync(path).isDirectory()) return "missing";
  const names = readdirSync(path).filter((n) => statSync(join(path, n)).isFile()).sort();
  return sha(names.map((n) => `${n} ${digestFile(join(path, n))}`).join("\n"));
}

export const input = (path: string): Input => ({ path, digest: path.endsWith("/") ? digestDir(path.slice(0, -1)) : digestFile(path) });

export const measured = (id: string, label: string, value: string, note?: string): Metric => ({ id, label, value, status: "measured", ...(note ? { note } : {}) });
export const notVerified = (id: string, label: string, note: string): Metric => ({ id, label, value: "NOT VERIFIED", status: "not_verified", note });
export const notApplicable = (id: string, label: string, note: string): Metric => ({ id, label, value: "not applicable", status: "not_applicable", note });

/** Stable text for a scorecard: the same object always gives the same bytes. */
export function canonicalJson(card: Scorecard): string {
  return `${JSON.stringify(card, null, 2)}\n`;
}

export const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`);
export const ofN = (a: number, b: number): string => `${a} of ${b}`;
/** A p-value as the table shows it: three decimals, or `< 0.001`. */
export const pValue = (p: number): string => (p < 0.001 ? "< 0.001" : p.toFixed(3));
