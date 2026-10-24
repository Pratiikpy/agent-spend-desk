/**
 * The feature status table: for each of the specification's features, whether the code has it. The table is data
 * (`docs/design/desk/feature-status.json`), a test checks it against the specification's own list and against the
 * files it cites, and this module turns it into the readable page. A status is a judgement; what the machinery
 * guarantees is that no feature is missing from the table and no cited file is missing from the repository.
 */
export type FeatureStatus = "built" | "partial" | "absent";

export interface FeatureRow {
  id: string;
  status: FeatureStatus;
  evidence: string[];
  missing: string;
}

export interface FeatureListing {
  id: string;
  title: string;
}

export interface FeatureSummary {
  built: number;
  partial: number;
  absent: number;
}

export function summariseFeatures(rows: readonly FeatureRow[]): FeatureSummary {
  const s: FeatureSummary = { built: 0, partial: 0, absent: 0 };
  for (const r of rows) s[r.status] += 1;
  return s;
}

const cell = (text: string): string => text.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

/** The page `docs/design/desk/07-feature-status.md` is generated from: counts first, then one row per feature. */
export function renderFeatureStatus(rows: readonly FeatureRow[], listing: readonly FeatureListing[]): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const s = summariseFeatures(rows);
  const out: string[] = [];
  out.push("# Feature status: what the code has, against the 129 specified features");
  out.push("");
  out.push("Generated from `feature-status.json` by `npm run desk -- status` and checked by `tests/desk/feature-status.test.ts`. The specification is `02-feature-list.md`, which was written as design; this page says how much of it exists.");
  out.push("");
  out.push(`**${s.built} built, ${s.partial} partial, ${s.absent} absent** of ${rows.length}.`);
  out.push("");
  out.push("How to read a status. *Built*: the core of the feature as specified exists and a test, a `desk prove` check or a verification record exercises it. *Partial*: a real part exists and the missing part is named. *Absent*: no code was found. A status is a judgement made by reading and searching, which is why every row cites the files it rests on. A built feature can still be shallow; the \"missing\" column says so where known.");
  out.push("");
  out.push("| Feature | Status | Evidence | Missing |");
  out.push("|---|---|---|---|");
  for (const f of listing) {
    const r = byId.get(f.id);
    if (!r) continue;
    out.push(`| ${f.id} ${cell(f.title)} | ${r.status} | ${r.evidence.map((e) => `\`${e}\``).join(", ") || "none"} | ${cell(r.missing) || "-"} |`);
  }
  out.push("");
  return out.join("\n");
}
