import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { setSnapshotOverlay, type PriceSnapshot } from "./pricebook.ts";
import { parseVirtualPrices, withVirtualPrices, type OwnerPrice } from "./virtual.ts";

/**
 * Prices the owner sets for a model the vendor's list does not cover (DF-084: "no price for N models: add a row"). A model with no price is counted and its tokens
 * kept, with no dollars invented; this is how the owner says what a token of it is worth to them, so that a cap in dollars on it means something. The rows are the
 * owner's and say so in the price snapshot; a model the list later prices ignores its owner row, and `desk prices owner` says so.
 */
export const DEFAULT_OWNER_PRICES = "data/desk/owner-prices.json";

export type OwnerPrices = Record<string, OwnerPrice>;

export function readOwnerPrices(path: string = DEFAULT_OWNER_PRICES): OwnerPrices {
  if (!existsSync(path)) return {};
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as { prices?: OwnerPrices };
    const out: OwnerPrices = {};
    for (const [model, p] of Object.entries(j.prices ?? {})) {
      if (typeof p?.inputUsdPerMTok === "number" && typeof p?.outputUsdPerMTok === "number") out[model] = { inputUsdPerMTok: p.inputUsdPerMTok, outputUsdPerMTok: p.outputUsdPerMTok };
    }
    return out;
  } catch {
    return {};
  }
}

function write(path: string, prices: OwnerPrices): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ note: "Prices the owner set for models the vendor list does not cover, in dollars per million tokens. Written by `desk prices add`.", prices }, null, 2)}\n`);
}

/** Add or replace one row from `MODEL=IN,OUT`, checking it the way the gate's `--price` does. Returns the row. */
export function addOwnerPrice(spec: string, path: string = DEFAULT_OWNER_PRICES): { model: string; price: OwnerPrice } {
  const parsed = parseVirtualPrices([spec]);
  const model = Object.keys(parsed)[0] as string;
  const price = parsed[model] as OwnerPrice;
  // Validate by applying it to an empty list: the same range checks the gate uses.
  withVirtualPrices({ snapshotId: "check", source: "check", sourceUrl: "", fetchedAt: "", license: "", upstreamSha256: "", note: "", contentHash: "", models: {} } as unknown as PriceSnapshot, { [model]: price });
  const all = readOwnerPrices(path);
  all[model] = price;
  write(path, all);
  return { model, price };
}

export function removeOwnerPrice(model: string, path: string = DEFAULT_OWNER_PRICES): boolean {
  const all = readOwnerPrices(path);
  if (!(model in all)) return false;
  delete all[model];
  write(path, all);
  return true;
}

/** Make every price list loaded from now on carry the owner's rows for models it does not price. Does nothing when there is no file. */
export function activateOwnerPrices(path: string = DEFAULT_OWNER_PRICES): number {
  const rows = readOwnerPrices(path);
  const n = Object.keys(rows).length;
  if (n === 0) {
    setSnapshotOverlay(null);
    return 0;
  }
  setSnapshotOverlay((snap) => {
    const uncovered = Object.fromEntries(Object.entries(rows).filter(([model]) => !(model in snap.models)));
    return withVirtualPrices(snap, uncovered);
  });
  return n;
}

export function describeOwnerPrices(snapshot: PriceSnapshot, path: string = DEFAULT_OWNER_PRICES): string[] {
  const rows = readOwnerPrices(path);
  const models = Object.keys(rows).sort();
  if (models.length === 0) return ["No owner prices. A model with no price in the list is counted, its tokens kept, and no dollars are invented. Add a row with `desk prices add MODEL=IN,OUT` (dollars per million tokens)."];
  return models.map((m) => {
    const p = rows[m] as OwnerPrice;
    const covered = m in snapshot.models;
    return `${m}: $${p.inputUsdPerMTok} in, $${p.outputUsdPerMTok} out per million tokens${covered ? " (the price list now covers this model, so this row is ignored)" : ""}`;
  });
}
