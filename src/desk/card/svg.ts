import { formatUsd } from "../money.ts";
import type { Card } from "./build.ts";

/**
 * The card as a single SVG, in the Blank brand kit: ink on white, one green accent kept for verified states,
 * Redline only for risk, Outfit for text and JetBrains Mono for figures and labels. No gradients, no shadows.
 * The SVG is self-contained apart from the two font families, which the PNG renderer loads from assets/fonts.
 */
const INK = "#0A0A0A";
const PAPER = "#FFFFFF";
const VEIL = "#F8FAFC";
const LINE = "#E5E7EB";
const GRAPHITE = "#6B7280";
const REDLINE = "#C2410C";
const SANS = "Outfit, sans-serif";
const MONO = "'JetBrains Mono', monospace";

/** Shorter names for the bars, where the label column is narrow. */
const SHORT_LABEL: Record<string, string> = {
  idle: "Idle and background work",
  loops: "Loops (same call repeated)",
  subagents: "Sub-agents",
  tool_output: "Tool output sent back",
  cache_misses: "Cache misses",
  reasoning: "Reasoning (thinking tokens)",
  history_rereads: "Re-reading the conversation",
  new_work: "New work",
};

export const CARD_WIDTH = 1200;
const PAD = 64;
const INNER = CARD_WIDTH - PAD * 2;

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Greedy word wrap on a character budget; a word longer than the budget is kept whole. */
export function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= maxChars) line += " " + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function utc(iso: string): string {
  return iso.replace("T", " ").slice(0, 16) + " UTC";
}

function pct(share: number): string {
  const p = share * 100;
  return `${p < 10 ? p.toFixed(1) : p.toFixed(0)}%`;
}

function money(micros: number): string {
  return formatUsd(micros);
}

function fixSaving(f: Card["fixes"][number]): string {
  if (f.interval) return `${money(f.interval.lowMicros)} to ${money(f.interval.highMicros)} per window, 80% interval over ${f.windowsUsed} of your windows`;
  return `up to ${money(f.addressableMicros)} in this window, an upper bound (heuristic estimate)`;
}

export function renderCardSvg(card: Card): string {
  const out: string[] = [];
  let y = PAD;
  const text = (x: number, yy: number, s: string, o: { size: number; fill?: string; family?: string; weight?: number; anchor?: "start" | "end"; spacing?: string }): void => {
    out.push(
      `<text x="${x}" y="${yy}" font-family="${o.family ?? SANS}" font-size="${o.size}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? INK}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.spacing ? ` letter-spacing="${o.spacing}"` : ""}>${esc(s)}</text>`,
    );
  };

  // header: kicker left, wordmark right
  text(PAD, y + 14, card.mode === "sample" ? "LIMIT AUTOPSY  /  CONSTRUCTED SAMPLE" : "LIMIT AUTOPSY  /  YOUR LOGS", { size: 15, fill: GRAPHITE, family: MONO, spacing: "0.12em" });
  text(CARD_WIDTH - PAD, y + 20, "desk.", { size: 30, weight: 600, anchor: "end", spacing: "-0.04em" });
  y += 78;
  text(PAD, y, "Where did the window go?", { size: 64, weight: 600, spacing: "-0.045em" });
  y += 40;
  text(PAD, y, `${utc(card.window.startIso)} to ${utc(card.window.endIso)}  /  ${card.window.hours} h  /  ${card.totals.pricedCalls.toLocaleString("en-US")} priced calls`, { size: 18, fill: GRAPHITE, family: MONO });
  y += 40;

  // stat cards
  const waste = card.wasteShare;
  const stats: [string, string, string?][] = [
    ["ESTIMATED LIST-PRICE COST", money(card.totals.estimatedMicros)],
    ["BURN PER HOUR", money(card.burnMicrosPerHour)],
    ["IDLE + LOOPS + CACHE MISSES", pct(waste), waste >= 0.25 ? REDLINE : undefined],
  ];
  const gap = 16;
  const cardW = (INNER - gap * 2) / 3;
  stats.forEach(([label, value, colour], i) => {
    const x = PAD + i * (cardW + gap);
    out.push(`<rect x="${x}" y="${y}" width="${cardW}" height="104" rx="12" fill="${VEIL}" stroke="${LINE}" stroke-width="1"/>`);
    text(x + 22, y + 34, label, { size: 13, fill: GRAPHITE, family: MONO, spacing: "0.1em" });
    text(x + 22, y + 82, value, { size: 44, weight: 600, fill: colour ?? INK, spacing: "-0.03em" });
  });
  y += 104 + 44;

  // causes
  const labelW = 470;
  const trackX = PAD + labelW;
  const trackW = 360;
  for (const c of card.causes) {
    text(PAD, y + 5, SHORT_LABEL[c.cause] ?? c.label, { size: 22, fill: c.cause === "new_work" ? GRAPHITE : INK });
    out.push(`<rect x="${trackX}" y="${y - 14}" width="${trackW}" height="14" rx="2" fill="${LINE}"/>`);
    const w = Math.max(c.micros > 0 ? 2 : 0, Math.round(trackW * c.share));
    if (w > 0) out.push(`<rect x="${trackX}" y="${y - 14}" width="${w}" height="14" rx="2" fill="${INK}"/>`);
    text(trackX + trackW + 24, y, pct(c.share), { size: 20, family: MONO, weight: 500 });
    text(CARD_WIDTH - PAD, y, money(c.micros), { size: 20, family: MONO, fill: GRAPHITE, anchor: "end" });
    y += 44;
  }
  y += 14;
  out.push(`<line x1="${PAD}" y1="${y}" x2="${CARD_WIDTH - PAD}" y2="${y}" stroke="${LINE}" stroke-width="1"/>`);
  y += 44;

  // fixes
  text(PAD, y, "FIXES, RANKED BY WHAT THE CAUSE COST", { size: 15, fill: GRAPHITE, family: MONO, spacing: "0.12em" });
  y += 40;
  const fixes = card.fixes.slice(0, 3);
  if (fixes.length === 0) {
    text(PAD, y, "No cause is large enough (5% of the window) to call out a fix.", { size: 22 });
    y += 40;
  }
  fixes.forEach((f, i) => {
    text(PAD, y, String(i + 1).padStart(2, "0"), { size: 18, family: MONO, fill: GRAPHITE });
    for (const line of wrap(f.fix, 88)) {
      text(PAD + 56, y, line, { size: 22 });
      y += 31;
    }
    text(PAD + 56, y, fixSaving(f), { size: 16, family: MONO, fill: GRAPHITE });
    y += 46;
  });
  y += 6;
  out.push(`<line x1="${PAD}" y1="${y}" x2="${CARD_WIDTH - PAD}" y2="${y}" stroke="${LINE}" stroke-width="1"/>`);
  y += 44;

  // what I could not know
  text(PAD, y, "WHAT I COULD NOT KNOW", { size: 15, fill: GRAPHITE, family: MONO, spacing: "0.12em" });
  y += 36;
  for (const item of card.couldNotKnow) {
    const lines = wrap(item, 104);
    lines.forEach((line, i) => {
      text(PAD, y, (i === 0 ? "- " : "  ") + line, { size: 18, fill: GRAPHITE });
      y += 27;
    });
    y += 5;
  }
  y += 22;
  out.push(`<rect x="${PAD}" y="${y}" width="56" height="8" fill="${INK}"/>`);
  text(PAD + 76, y + 8, `figures ${card.figuresHash.slice(0, 19)}`, { size: 14, family: MONO, fill: GRAPHITE });
  text(CARD_WIDTH - PAD, y + 8, "Local only. Nothing left this machine.", { size: 14, family: MONO, fill: GRAPHITE, anchor: "end" });
  y += 8 + PAD;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${y}" viewBox="0 0 ${CARD_WIDTH} ${y}"><rect width="${CARD_WIDTH}" height="${y}" fill="${PAPER}"/>${out.join("")}</svg>`;
}
