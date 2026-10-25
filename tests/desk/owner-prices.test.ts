import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { loadSnapshot, setSnapshotOverlay } from "../../src/desk/pricing/pricebook.ts";
import { activateOwnerPrices, addOwnerPrice, describeOwnerPrices, readOwnerPrices, removeOwnerPrice } from "../../src/desk/pricing/owner.ts";
import { repriceLedger } from "../../src/desk/pricing/reprice.ts";
import { assistantLine, TempDir } from "./helpers.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
let dir: TempDir;
let db: Ledger;
beforeEach(() => {
  dir = new TempDir();
  db = openLedger(":memory:");
});
afterEach(() => {
  setSnapshotOverlay(null);
  db.close();
  dir.dispose();
});

const file = (): string => join(dir.path, "owner-prices.json");

describe("prices the owner sets for a model the vendor list does not cover", () => {
  it("adds, lists and removes a row, and refuses one it cannot read", () => {
    expect(addOwnerPrice("nvidia/nemotron-test=0.5,2.5", file())).toEqual({ model: "nvidia/nemotron-test", price: { inputUsdPerMTok: 0.5, outputUsdPerMTok: 2.5 } });
    expect(readOwnerPrices(file())).toEqual({ "nvidia/nemotron-test": { inputUsdPerMTok: 0.5, outputUsdPerMTok: 2.5 } });
    for (const bad of ["nvidia/nemotron-test", "m=1", "m=a,b", "m=-1,2", "m=1,2,3", "=1,2", "m=2000000,1"]) expect(() => addOwnerPrice(bad, file()), bad).toThrow();
    expect(removeOwnerPrice("nvidia/nemotron-test", file())).toBe(true);
    expect(removeOwnerPrice("nvidia/nemotron-test", file())).toBe(false);
    expect(readOwnerPrices(file())).toEqual({});
  });

  it("is said in words: with none it says what a model with no price does, and with one it says the row is the owner's", () => {
    const snap = loadSnapshot(PRICES);
    expect(describeOwnerPrices(snap, file()).join(" ")).toContain("no dollars are invented");
    addOwnerPrice("free-model=0.1,0.2", file());
    expect(describeOwnerPrices(snap, file())).toEqual(["free-model: $0.1 in, $0.2 out per million tokens"]);
  });

  it("is applied to every price list loaded after it is switched on, marked as the owner's and not a vendor's, and not when it is off", () => {
    addOwnerPrice("free-model=1,4", file());
    expect(loadSnapshot(PRICES).models["free-model"]).toBeUndefined();
    expect(activateOwnerPrices(file())).toBe(1);
    const snap = loadSnapshot(PRICES);
    expect(snap.models["free-model"]).toMatchObject({ inputPerMTokMicros: 1_000_000, outputPerMTokMicros: 4_000_000 });
    expect(snap.snapshotId).toMatch(/\+owner-prices$/);
    expect(snap.note).toContain("set by the owner and are not a vendor's list prices");
    setSnapshotOverlay(null);
    expect(loadSnapshot(PRICES).models["free-model"]).toBeUndefined();
  });

  it("leaves the vendor's price for a model the list covers, and says its owner row is ignored", () => {
    const snap = loadSnapshot(PRICES);
    const covered = Object.keys(snap.models)[0] as string;
    addOwnerPrice(`${covered}=99,99`, file());
    activateOwnerPrices(file());
    expect(loadSnapshot(PRICES).models[covered]).toEqual(snap.models[covered]);
    expect(describeOwnerPrices(snap, file())[0]).toContain("the price list now covers this model, so this row is ignored");
  });

  it("turns a call on an unpriced model from counted into estimated once a row is added and the ledger is priced again", async () => {
    const line = assistantLine({ id: "m1", ts: "2026-10-20T10:00:00Z", model: "free-model", input: 10_000, output: 5_000 });
    await ingestClaudeCode(db, [dir.file("a.jsonl", [line])], loadSnapshot(PRICES));
    const before = db.prepare("SELECT class, total_micros FROM cost_event").get() as { class: string; total_micros: number | null };
    expect(before).toMatchObject({ class: "unpriced", total_micros: null });
    addOwnerPrice("free-model=2,10", file());
    activateOwnerPrices(file());
    repriceLedger(db, loadSnapshot(PRICES), { reason: "owner price added" });
    const after = db.prepare("SELECT class, total_micros FROM cost_event").get() as { class: string; total_micros: number };
    // 10,000 tokens in at $2 per million and 5,000 out at $10 per million: $0.02 and $0.05.
    expect(after).toMatchObject({ class: "estimated", total_micros: 70_000 });
  });
});
