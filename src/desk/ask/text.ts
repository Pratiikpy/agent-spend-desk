import { auditSentences } from "../agents/audit.ts";
import { ClaimLedger, type Claim, type CostClass, type Unit } from "../agents/claims.ts";
import { sanitizeLabel } from "../engines/label.ts";
import { formatUsd } from "../money.ts";

/**
 * Answer text is built from templates whose fixed words contain no digits. Every number, date and name
 * enters through a typed slot, so a figure in an answer can only be one the ledger produced. The template
 * function throws on a digit in its fixed text: a template bug is found when the template runs, not when a
 * reader spots a wrong number.
 */
export type Slot =
  | { kind: "usd"; micros: number }
  | { kind: "count"; n: number }
  | { kind: "pct"; value: number; decimals: number }
  | { kind: "date"; iso: string }
  | { kind: "entity"; label: string }
  | { kind: "word"; text: string };

export const usd = (micros: number): Slot => ({ kind: "usd", micros });
export const count = (n: number): Slot => ({ kind: "count", n });
export const pct = (value: number, decimals = 1): Slot => ({ kind: "pct", value, decimals });
export const date = (iso: string): Slot => ({ kind: "date", iso });
export const entity = (raw: unknown): Slot => ({ kind: "entity", label: sanitizeLabel(raw) });
export const word = (text: string): Slot => {
  if (/\d/.test(text)) throw new Error(`template word contains a digit: ${text}`);
  return { kind: "word", text };
};

export function show(slot: Slot): string {
  switch (slot.kind) {
    case "usd":
      return formatUsd(slot.micros);
    case "count":
      return slot.n.toLocaleString("en-US");
    case "pct":
      return `${slot.value.toFixed(slot.decimals)}%`;
    case "date":
      return slot.iso;
    case "entity":
      return `\`${slot.label}\``;
    case "word":
      return slot.text;
  }
}

export interface Rendered {
  text: string;
  slots: Slot[];
}

/** Tag a template literal: `say\`Spend was ${usd(n)}.\``. */
export function say(strings: TemplateStringsArray, ...slots: Slot[]): Rendered {
  let text = "";
  strings.forEach((part, i) => {
    if (/\d/.test(part)) throw new Error(`template text contains a digit: ${JSON.stringify(part)}`);
    text += part;
    const slot = slots[i];
    if (slot) text += show(slot);
  });
  return { text, slots };
}

/** A sentence with a variable number of slots joined by commas: `Models seen include a, b and c.` */
export function sayList(prefix: string, slots: Slot[], suffix: string): Rendered {
  if (/\d/.test(prefix) || /\d/.test(suffix)) throw new Error("template text contains a digit");
  const shown = slots.map(show);
  const joined = shown.length <= 1 ? shown.join("") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1] as string}`;
  return { text: `${prefix}${joined}${suffix}`, slots };
}

/** The figure a slot stands for, as the number the Auditor will read from its text. */
export function figureOf(slot: Slot): { value: number; unit: Unit } | null {
  switch (slot.kind) {
    case "usd":
      return { value: Number(formatUsd(slot.micros).replace(/[$,]/g, "")), unit: "usd" };
    case "count":
      return { value: slot.n, unit: "count" };
    case "pct":
      return { value: Number(slot.value.toFixed(slot.decimals)), unit: "pct" };
    default:
      return null;
  }
}

export interface ClaimInput {
  id: string;
  kind: Claim["kind"];
  r: Rendered;
  /** The slot whose figure the claim states. Omit for a claim with no figure. */
  figure?: Slot;
  class?: CostClass;
  source: string;
}

/**
 * Build a claim and check, at once, the property the rule brain relies on: the claim's own text, cited
 * on its own, passes the code Auditor. A template that states two figures, or a figure that does not match
 * the claim's value, throws here.
 */
export function makeClaim(input: ClaimInput): Claim {
  const fig = input.figure ? figureOf(input.figure) : null;
  const claim: Claim = {
    id: input.id,
    kind: input.kind,
    text: input.r.text,
    ...(fig ? { value: fig.value, unit: fig.unit } : {}),
    ...(input.class ? { class: input.class } : {}),
    source: input.source,
  };
  const check = auditSentences([{ text: claim.text, cites: [claim.id] }], new ClaimLedger([claim]));
  if (check.rejected.length > 0) {
    const why = check.rejected[0];
    throw new Error(`claim ${input.id} does not pass its own audit (${why?.reason}: ${why?.detail}): ${claim.text}`);
  }
  return claim;
}

/** Whole-word estimate used for every budget in this module: characters divided by four, rounded up. */
export const tokensOf = (text: string): number => Math.ceil(text.length / 4);
