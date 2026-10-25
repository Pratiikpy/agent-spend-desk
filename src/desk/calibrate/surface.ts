import { calibrationOf, type Calibration } from "./windtunnel.ts";

/**
 * Calibration of a stated confidence against what happened, for one surface of the Desk's judgement (DF-106). A surface gives pairs of a stated probability and whether it
 * turned out right. From them this makes ten equal-width bins, the expected calibration error and the Brier score, and tunes the abstain threshold: the lowest stated
 * confidence at and above which the answers were right at least 80% of the time. With fewer than 50 pairs nothing is tuned and a conservative default is used, said to be a default.
 */
export const BINS = 10;
export const MIN_SAMPLES = 50;
export const TARGET_PRECISION = 0.8;

/** Used when a surface has too few pairs to tune from. They are not tuned values, and the output says so. */
export const DEFAULT_THRESHOLDS: Record<SurfaceName, number> = { attribution: 0.7, forecast: 0.7, judge_panel: 0.85, auditor: 0.8 };

export type SurfaceName = "attribution" | "forecast" | "judge_panel" | "auditor";

export interface Sample {
  /** The stated confidence, 0 to 1. */
  p: number;
  /** Whether the thing the confidence was about turned out as stated (for a forecast: whether the event happened). */
  right: boolean;
}

export interface SurfaceResult {
  surface: SurfaceName;
  n: number;
  status: "calibrated" | "uncalibrated_default";
  /** Why the default was used, when it was. */
  reason: string | null;
  calibration: Calibration | null;
  /** Below this stated confidence the Desk abstains and asks a person. */
  threshold: number;
  /** Observed precision of the pairs at or above the threshold, and how many they are, when tuned. */
  precisionAtThreshold: number | null;
  coverageAtThreshold: number | null;
  /** True when no threshold reaches the target precision on these pairs, so the surface should abstain throughout. */
  abstainAlways: boolean;
  /** For a surface whose confidence is a word, the word the threshold stands for. */
  thresholdLabel?: string;
}

/**
 * `event` says the stated probability is that something will happen (a forecast), so a call is made by the side the probability favours and its confidence is the larger of p and
 * 1 - p. Without it the stated probability is a claim to be right (a judge, an auditor, a link), and it is its own confidence.
 */
export function calibrateSurface(surface: SurfaceName, samples: readonly Sample[], opts: { target?: number; minSamples?: number; event?: boolean } = {}): SurfaceResult {
  const target = opts.target ?? TARGET_PRECISION;
  const min = opts.minSamples ?? MIN_SAMPLES;
  const usable = samples.filter((s) => Number.isFinite(s.p) && s.p >= 0 && s.p <= 1);
  const fallback = DEFAULT_THRESHOLDS[surface];
  if (usable.length < min) {
    return { surface, n: usable.length, status: "uncalibrated_default", reason: `${usable.length} pairs; tuning needs at least ${min}, so the default threshold ${fallback} is used`, calibration: usable.length === 0 ? null : calibrationOf(usable.map((s) => s.p), usable.map((s) => s.right), BINS), threshold: fallback, precisionAtThreshold: null, coverageAtThreshold: null, abstainAlways: false };
  }
  const calibration = calibrationOf(usable.map((s) => s.p), usable.map((s) => s.right), BINS);
  // Candidate thresholds are the distinct confidences: the lowest one whose answers at or above it meet the target, and are not a few lucky answers.
  const calls = usable.map((s) => (opts.event ? { conf: Math.max(s.p, 1 - s.p), ok: s.p >= 0.5 === s.right } : { conf: s.p, ok: s.right }));
  const values = [...new Set(calls.map((c) => c.conf))].sort((a, b) => a - b);
  let chosen: { t: number; precision: number; n: number } | null = null;
  for (const t of values) {
    const above = calls.filter((c) => c.conf >= t);
    if (above.length < Math.min(10, Math.ceil(usable.length / 5))) break;
    const precision = above.filter((c) => c.ok).length / above.length;
    if (precision >= target) {
      chosen = { t, precision, n: above.length };
      break;
    }
  }
  if (!chosen) return { surface, n: usable.length, status: "calibrated", reason: `no threshold reaches ${Math.round(target * 100)}% precision on these pairs`, calibration, threshold: 1, precisionAtThreshold: null, coverageAtThreshold: 0, abstainAlways: true };
  return { surface, n: usable.length, status: "calibrated", reason: null, calibration, threshold: chosen.t, precisionAtThreshold: chosen.precision, coverageAtThreshold: chosen.n / usable.length, abstainAlways: false };
}

/** A reliability diagram as text: for each bin, how often the stated confidence was right against what it stated. */
export function renderReliability(r: SurfaceResult): string {
  const lines = [`${r.surface}: ${r.n} pairs, ${r.status === "calibrated" ? "calibrated" : "UNCALIBRATED DEFAULT"}`];
  if (r.calibration) {
    lines.push(`  expected calibration error ${r.calibration.ece.toFixed(3)}, Brier ${r.calibration.brier.toFixed(3)}, right ${(r.calibration.baseRate * 100).toFixed(0)}% overall`);
    for (const b of r.calibration.bins) {
      if (b.n === 0) continue;
      const bar = "#".repeat(Math.round(b.observed * 20)).padEnd(20, ".");
      lines.push(`  ${b.low.toFixed(1)}-${b.high.toFixed(1)}  n=${String(b.n).padStart(4)}  said ${(b.meanPredicted * 100).toFixed(0).padStart(3)}%  right ${(b.observed * 100).toFixed(0).padStart(3)}%  ${bar}`);
    }
  }
  lines.push(r.abstainAlways ? `  abstain threshold: none reaches the target, so abstain throughout (${r.reason})` : r.status === "calibrated" ? `  abstain below ${r.thresholdLabel ?? r.threshold.toFixed(2)}: ${((r.precisionAtThreshold ?? 0) * 100).toFixed(0)}% right at or above it, covering ${((r.coverageAtThreshold ?? 0) * 100).toFixed(0)}% of the pairs` : `  abstain below ${r.thresholdLabel ?? r.threshold} (default: ${r.reason})`);
  return lines.join("\n");
}
