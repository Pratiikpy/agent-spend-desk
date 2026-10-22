import type { Claim, ClaimLedger, Sentence } from "./claims.ts";

export type RejectReason = "no_support" | "number_mismatch" | "class_mismatch" | "comparative_unsupported" | "quote_absent";

export interface Rejection {
  sentence: Sentence;
  reason: RejectReason;
  detail: string;
}

export interface AuditResult {
  accepted: Sentence[];
  rejected: Rejection[];
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const DATE_PATTERNS = [new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})(?:\\s+\\d{4})?\\b`, "g"), new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:,\\s*\\d{4})?\\b`, "g"), /\b\d{4}-\d{2}-\d{2}\b/g];

interface Found {
  raw: string;
  value: number;
  unit: "usd" | "pct" | "plain";
  decimals: number;
}

/** Numbers a reader would take as figures. Dates, identifiers such as C-LOOP-1 and ordinals are not figures. */
export function extractNumbers(text: string): Found[] {
  let t = text;
  for (const p of DATE_PATTERNS) t = t.replace(p, " ");
  const out: Found[] = [];
  const re = /(\$)?(?<![A-Za-z\-\d.])(\d[\d,]*(?:\.\d+)?)(%)?(?![A-Za-z\d])(?!-[A-Za-z])/g;
  for (const m of t.matchAll(re)) {
    const digits = (m[2] as string).replace(/,/g, "");
    const decimals = digits.includes(".") ? digits.split(".")[1]!.length : 0;
    const unit = m[1] ? "usd" : m[3] ? "pct" : "plain";
    out.push({ raw: m[0], value: Number(digits), unit, decimals });
  }
  return out;
}

function matchesClaim(f: Found, c: Claim): boolean {
  if (c.value === undefined) return false;
  const tolerance = 0.5 * 10 ** -f.decimals;
  const candidates = [c.value];
  // A percentage may be stated as a ratio and a ratio as a percentage.
  if (c.unit === "ratio") candidates.push(c.value * 100);
  if (f.unit === "usd" && c.unit !== "usd") return false;
  if (f.unit === "pct" && c.unit !== "pct" && c.unit !== "ratio") return false;
  if (f.unit === "plain" && (c.unit === "usd" || c.unit === "pct")) {
    // A bare number may restate a dollar or percent figure only if the sentence did not mark it, which we treat as a mismatch.
    return false;
  }
  return candidates.some((v) => Math.abs(v - f.value) <= tolerance + 1e-9);
}

const COMPARATIVE = /\b(as good as|as well as|equivalent|equal(?:ly)?|no (?:real )?difference|the same|better|worse|cheaper|more expensive|safe to|did not (?:hurt|reduce|change)|without (?:hurting|losing))\b/i;
const BILLED_WORDS = /\b(billed|invoice[ds]?|actual(?:ly)? (?:paid|charged)|you paid)\b/i;

/**
 * The code Auditor (spec 11.2, 12.3). Deterministic: a sentence passes only if every figure in it equals a
 * figure in a claim it cites (to the precision it states), no comparison is made without a comparison
 * claim that carries an interval, a "billed" word rests on a billed claim, and a quoted string appears in a
 * cited quote claim. It cannot make a bad sentence good; it can only refuse.
 */
export function auditSentences(sentences: readonly Sentence[], ledger: ClaimLedger): AuditResult {
  const accepted: Sentence[] = [];
  const rejected: Rejection[] = [];
  for (const s of sentences) {
    const fail = audit(s, ledger);
    if (fail) rejected.push({ sentence: s, ...fail });
    else accepted.push(s);
  }
  return { accepted, rejected };
}

function audit(s: Sentence, ledger: ClaimLedger): { reason: RejectReason; detail: string } | null {
  const cited: Claim[] = [];
  for (const id of s.cites) {
    const c = ledger.get(id);
    if (!c) return { reason: "no_support", detail: `cites unknown claim ${id}` };
    cited.push(c);
  }
  if (cited.length === 0) return { reason: "no_support", detail: "cites no claim" };

  for (const q of s.text.matchAll(/"([^"]{3,})"/g)) {
    const quoted = q[1] as string;
    if (!cited.some((c) => c.kind === "quote" && c.text.includes(quoted))) return { reason: "quote_absent", detail: `"${quoted}" is not in a cited quote` };
  }

  if (BILLED_WORDS.test(s.text) && !cited.some((c) => c.class === "billed")) {
    const cls = cited.map((c) => c.class).filter((x) => x !== undefined);
    return { reason: "class_mismatch", detail: `the sentence says billed but the cited figures are ${cls.length > 0 ? [...new Set(cls)].join("/") : "of unknown class"}` };
  }

  if (COMPARATIVE.test(s.text)) {
    const comparison = cited.find((c) => c.kind === "comparison");
    if (!comparison) return { reason: "comparative_unsupported", detail: "a comparison needs a cited comparison claim" };
    if (!comparison.interval) return { reason: "comparative_unsupported", detail: `claim ${comparison.id} has no interval, so it cannot show equality or a difference` };
  }

  for (const f of extractNumbers(s.text)) {
    if (!cited.some((c) => matchesClaim(f, c))) return { reason: "number_mismatch", detail: `${f.raw} matches no cited claim` };
  }
  return null;
}
