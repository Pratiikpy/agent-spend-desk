import type { Ledger } from "../ledger/db.ts";
import type { Disagreement, PriceComparison } from "./compare.ts";

/**
 * What a disagreement between two price sources is worth in this ledger: the tokens a disputed price applies to,
 * times the gap. A cost estimate that rests on a disputed price is shown as a range, not as one number.
 */
export interface Sensitivity {
  model: string;
  field: Exclude<Disagreement["field"], "overPromptTokens">;
  tier: "base" | "long";
  tokens: number;
  /** The other source's price minus ours, in micro-dollars per million tokens. */
  gapPerMTokMicros: number;
  /** What the estimate would change by if the other source were right, in micro-dollars. */
  deltaMicros: number;
}

const COLUMN: Record<Sensitivity["field"], string> = {
  inputPerMTokMicros: "m.input_tokens",
  outputPerMTokMicros: "m.output_tokens",
  cacheReadPerMTokMicros: "m.cache_read_tokens",
  cacheWrite5mPerMTokMicros: "m.cache_write_5m_tokens",
  cacheWrite1hPerMTokMicros: "m.cache_write_1h_tokens",
};

const PROMPT = "(m.input_tokens + m.cache_read_tokens + m.cache_write_5m_tokens + m.cache_write_1h_tokens)";

export interface Window {
  since?: string;
  until?: string;
}

export function priceSensitivity(db: Ledger, comparison: PriceComparison, window: Window = {}): Sensitivity[] {
  const out: Sensitivity[] = [];
  for (const d of comparison.disagreements) {
    if (d.field === "overPromptTokens") continue;
    const threshold = comparison.tierThresholds[d.model];
    let tierSql = "";
    const args: (string | number)[] = [d.model];
    if (threshold !== undefined) {
      tierSql = d.tier === "long" ? ` AND ${PROMPT} > ?` : ` AND ${PROMPT} <= ?`;
      args.push(threshold);
    }
    let windowSql = "";
    if (window.since) {
      windowSql += " AND m.ts >= ?";
      args.push(window.since);
    }
    if (window.until) {
      windowSql += " AND m.ts <= ?";
      args.push(window.until);
    }
    const row = db
      .prepare(`SELECT COALESCE(SUM(${COLUMN[d.field]}), 0) AS tokens FROM model_call m JOIN cost_event c ON c.call_id = m.call_id WHERE c.class = 'estimated' AND c.matched_as = ?${tierSql}${windowSql}`)
      .get(...args) as { tokens: number };
    if (row.tokens === 0) continue;
    const gap = d.theirs - d.ours;
    out.push({ model: d.model, field: d.field, tier: d.tier, tokens: row.tokens, gapPerMTokMicros: gap, deltaMicros: Math.round((row.tokens * gap) / 1_000_000) });
  }
  return out;
}

export interface CostBand {
  estimateMicros: number;
  lowMicros: number;
  highMicros: number;
}

/** The estimate with every disputed price taken the other way, in the direction that lowers it and in the one that raises it. */
export function costBand(estimateMicros: number, list: readonly Sensitivity[]): CostBand {
  let low = estimateMicros;
  let high = estimateMicros;
  for (const s of list) {
    if (s.deltaMicros < 0) low += s.deltaMicros;
    else high += s.deltaMicros;
  }
  return { estimateMicros, lowMicros: low, highMicros: high };
}

const FIELD_LABEL: Record<Sensitivity["field"], string> = {
  inputPerMTokMicros: "input",
  outputPerMTokMicros: "output",
  cacheReadPerMTokMicros: "cache read",
  cacheWrite5mPerMTokMicros: "cache write (5 minutes)",
  cacheWrite1hPerMTokMicros: "cache write (1 hour)",
};

const usd = (micros: number): string => `$${(Math.abs(micros) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function renderSensitivity(list: readonly Sensitivity[], labels: { ours: string; theirs: string }): string {
  if (list.length === 0) return "";
  const lines = list.map((s) => {
    const dir = s.deltaMicros >= 0 ? "more" : "less";
    return `- ${s.model}${s.tier === "long" ? " (long prompts)" : ""}, ${FIELD_LABEL[s.field]}: ${s.tokens.toLocaleString("en-US")} tokens in this ledger; if ${labels.theirs} is right and ${labels.ours} is not, the estimate is ${usd(s.deltaMicros)} ${dir}.`;
  });
  return ["Cost estimate sensitivity to the disputed prices:", ...lines].join("\n");
}
