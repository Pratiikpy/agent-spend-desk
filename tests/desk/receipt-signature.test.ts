import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";

import { canonicalJson, keyIdOf, verifyEnvelope } from "../../src/desk/agents/receipt-signature.ts";

/**
 * The signature check on a Meterless Nightshift receipt. The keys here are generated for the test; a real envelope from the installed
 * Nightshift 1.2.3 was checked by hand on 2026-10-26 and is in `docs/verification/nightshift-receipts/`, which `desk receipts` and
 * `desk prove` check again.
 */
function pair(): { raw: Buffer; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { raw: Buffer.from(spki.subarray(spki.length - 32)), privateKey };
}

function envelope(over: { body?: Record<string, unknown>; keys?: ReturnType<typeof pair>; signOrder?: "sorted" | "given" } = {}) {
  const keys = over.keys ?? pair();
  const body = over.body ?? {
    signer: "meterlessd",
    ts_ms: 1792982497217,
    receipt: { schema: "meterless.compute_receipt.v1", receipt_id: "rcpt_req_1", requested_model: "nvidia/nemotron-3.5-lightning-30b-a3b", winning_route: { model: "nvidia/nemotron-3.5-lightning-30b-a3b", provider: "nvidia" }, note: "café — ok" },
  };
  const text = over.signOrder === "given" ? JSON.stringify(body) : canonicalJson(body);
  const sig = sign(null, Buffer.from(text, "utf8"), keys.privateKey);
  return { body, pubkey_b64: keys.raw.toString("base64"), sig_b64: sig.toString("base64") };
}

describe("a Nightshift receipt envelope", () => {
  it("is valid when its Ed25519 signature holds, and names the signer and the model", () => {
    const keys = pair();
    const r = verifyEnvelope(envelope({ keys }));
    expect(r.valid).toBe(true);
    expect(r.keyId).toBe(keyIdOf(keys.raw));
    expect(r.receiptId).toBe("rcpt_req_1");
    expect(r.routedModel).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(r.signedAtMs).toBe(1792982497217);
  });

  it("is valid whether the body was signed with its keys sorted or in the order it was written", () => {
    expect(verifyEnvelope(envelope({ signOrder: "given" })).valid).toBe(true);
    expect(verifyEnvelope(envelope({ signOrder: "sorted" })).valid).toBe(true);
  });

  it("is refused when one character of the receipt changes", () => {
    const e = envelope();
    (e.body.receipt as Record<string, unknown>)["requested_model"] = "nvidia/nemotron-3-ultra-550b-a55b";
    const r = verifyEnvelope(e);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/does not match/);
  });

  it("is refused when the signature or the key is swapped for another", () => {
    const a = envelope();
    const b = envelope();
    expect(verifyEnvelope({ ...a, sig_b64: b.sig_b64 }).valid).toBe(false);
    expect(verifyEnvelope({ ...a, pubkey_b64: b.pubkey_b64 }).valid).toBe(false);
  });

  it("is refused when it signs a different receipt than the reply names", () => {
    const r = verifyEnvelope(envelope(), { expectReceiptId: "rcpt_req_2" });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/rcpt_req_1, not rcpt_req_2/);
  });

  it("is refused when the signer is not the key the reader pinned, and accepted when it is", () => {
    const keys = pair();
    expect(verifyEnvelope(envelope({ keys }), { pin: keyIdOf(keys.raw) }).valid).toBe(true);
    const other = verifyEnvelope(envelope({ keys }), { pin: "0000000000000000" });
    expect(other.valid).toBe(false);
    expect(other.reason).toMatch(/not the pinned key/);
  });

  it("is a reason, never a throw, for anything malformed", () => {
    for (const bad of [undefined, null, "text", 7, [], {}, { body: {} }, { body: {}, pubkey_b64: "AA==", sig_b64: "AA==" }, { body: { receipt: { schema: "other" } }, pubkey_b64: Buffer.alloc(32).toString("base64"), sig_b64: Buffer.alloc(64).toString("base64") }]) {
      const r = verifyEnvelope(bad);
      expect(r.valid).toBe(false);
      expect(typeof r.reason).toBe("string");
    }
  });
});
