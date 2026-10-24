import type { Ledger } from "../ledger/db.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { spanOf } from "../bill/command.ts";
import { overheadView, renderOverhead, type LandedBar, type OverheadView } from "./view.ts";

/** `desk overhead`: who shares the idle and unowned spend of a period, and by how much. Reads only. */
export function overheadCommand(o: { db: Ledger; snapshot: PriceSnapshot; month?: string; since?: string; until?: string; landed?: string }): { ok: boolean; text: string; view?: OverheadView } {
  if (o.landed !== undefined && o.landed !== "committed" && o.landed !== "merged" && o.landed !== "kept") return { ok: false, text: `--landed is committed, merged or kept, not "${o.landed}".` };
  const span = spanOf(o);
  if (typeof span === "string") return { ok: false, text: span };
  const view = overheadView(o.db, o.snapshot, span.sinceIso, span.untilIso, (o.landed ?? "kept") as LandedBar);
  if (view.sessions === 0) return { ok: false, text: `The ledger holds no call between ${span.sinceIso.slice(0, 10)} and ${span.untilIso.slice(0, 10)}.` };
  return { ok: true, text: renderOverhead(view), view };
}
