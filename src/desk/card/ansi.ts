import { formatUsd } from "../money.ts";
import type { Card } from "./build.ts";

export interface AnsiOptions {
  color: boolean;
  width?: number;
}

function paint(on: boolean, code: string, s: string): string {
  return on ? `\u001b[${code}m${s}\u001b[0m` : s;
}

function pct(share: number): string {
  const p = share * 100;
  return `${p < 10 ? p.toFixed(1) : p.toFixed(0)}%`.padStart(5);
}

function utc(iso: string): string {
  return iso.replace("T", " ").slice(0, 16) + " UTC";
}

function wrap(text: string, width: number, indent: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line.length === 0) line = word;
    else if (indent.length + line.length + 1 + word.length <= width) line += " " + word;
    else {
      lines.push(indent + line);
      line = word;
    }
  }
  if (line) lines.push(indent + line);
  return lines;
}

/** The terminal card. Colour is used sparingly: dim for secondary text, red only where waste is large. */
export function renderCardAnsi(card: Card, opts: AnsiOptions): string {
  const c = opts.color;
  const width = Math.max(60, Math.min(opts.width ?? 100, 120));
  const dim = (s: string): string => paint(c, "2", s);
  const bold = (s: string): string => paint(c, "1", s);
  const red = (s: string): string => paint(c, "31", s);
  const out: string[] = [];
  out.push(`${bold("Where did the window go?")}  ${dim(card.mode === "sample" ? "(constructed sample)" : "(your logs)")}`);
  out.push(dim(`${utc(card.window.startIso)} to ${utc(card.window.endIso)}  ${card.window.hours} h window  ${card.totals.pricedCalls} priced calls`));
  out.push(`Estimated list-price cost ${bold(formatUsd(card.totals.estimatedMicros))}   burn ${bold(formatUsd(card.burnMicrosPerHour))}/h   idle + loops + cache misses ${card.wasteShare >= 0.25 ? red(pct(card.wasteShare).trim()) : bold(pct(card.wasteShare).trim())}`);
  out.push("");
  for (const cause of card.causes) {
    const bar = "#".repeat(Math.round(cause.share * 30));
    out.push(`${pct(cause.share)}  ${formatUsd(cause.micros).padStart(10)}  ${cause.label.padEnd(48)} ${bar}`);
  }
  out.push("");
  out.push(bold("Fixes, ranked by what the cause cost"));
  if (card.fixes.length === 0) out.push("  No cause is large enough (5% of the window) to call out a fix.");
  card.fixes.slice(0, 3).forEach((f, i) => {
    const wrapped = wrap(f.fix, width, "    ");
    wrapped[0] = ` ${i + 1}. ${wrapped[0]!.trimStart()}`;
    out.push(...wrapped);
    const saving = f.interval
      ? `${formatUsd(f.interval.lowMicros)} to ${formatUsd(f.interval.highMicros)} per window (80% interval, ${f.windowsUsed} of your windows)`
      : `up to ${formatUsd(f.addressableMicros)} in this window (upper bound, heuristic estimate)`;
    out.push(dim(`    ${saving}`));
  });
  out.push("");
  out.push(bold("What I could not know"));
  for (const item of card.couldNotKnow) {
    const wrapped = wrap(item, width, "  ");
    wrapped[0] = `- ${wrapped[0]!.trimStart()}`;
    out.push(...wrapped);
  }
  const r = card.redactions;
  const n = r.credential + r.high_entropy + r.path;
  out.push("");
  out.push(dim(`figures ${card.figuresHash.slice(0, 19)}  local only, no network${n > 0 ? `  ${n} values redacted` : ""}`));
  return out.join("\n");
}
