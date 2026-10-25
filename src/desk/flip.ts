/**
 * The one fact that would flip a verdict (DF-068). A verdict is a call made from data, and how firm it is shows in what it would take to change it. A flip certificate
 * names the smallest change found that turns the verdict into a different one, or says that none was found in the changes tried. It is a search over a fixed list of
 * candidate changes, each of one fact: leave one task out, leave the control arm out, price one model as the other source does, change one session's landing, take one pause away. When the search ran out of time it
 * says it did not finish, and "no flip found" is then not a claim that none exists.
 */
export interface Flip {
  kind: "remove_task" | "remove_control_arm" | "swap_price" | "move_landing" | "remove_pause";
  /** What was changed: a task id, "the control arm", or a model. */
  subject: string;
  /** The change in words. */
  change: string;
  from: string;
  to: string;
  /** Why the verdict changed, in the verdict's own words. */
  because: string;
}

export interface FlipCertificate {
  /** What was judged, in words. */
  subject: string;
  verdict: string;
  flips: Flip[];
  /** The flip to show: the one the verdict is most sensitive to. Null when none was found. */
  smallest: Flip | null;
  tried: number;
  candidates: number;
  completeness: "complete" | "partial";
  /** Why there was nothing to test, when `candidates` is 0: said in the sentence, so an empty search does not read as a firm verdict. */
  noneBecause?: string;
  /** What the thing judged is called in the sentence; `verdict` unless a recommendation or a status reads better. */
  noun?: string;
}

export function describeFlip(c: FlipCertificate): string {
  const one = c.candidates === 1;
  const done =
    c.completeness === "complete"
      ? one
        ? "The one candidate change was tried."
        : `All ${c.candidates} candidate changes were tried.`
      : `${c.tried} of ${c.candidates} candidate changes were tried before the time ran out, so a flip may exist that was not found.`;
  const noun = c.noun ?? "verdict";
  const what = c.noun ? `this ${noun} (${c.verdict})` : `this ${c.verdict} verdict`;
  if (c.candidates === 0) return `There is no single change to test for ${what}${c.noneBecause ? ` (${c.noneBecause})` : ""}.`;
  if (c.smallest === null) return `No single change flips ${what}. ${done}`;
  const more = c.flips.length > 1 ? ` ${c.flips.length - 1} other single change${c.flips.length === 2 ? "" : "s"} would also flip it.` : "";
  return `${c.smallest.change}, and the ${noun} goes from ${c.smallest.from} to ${c.smallest.to} (${c.smallest.because}).${more} ${done}`;
}
