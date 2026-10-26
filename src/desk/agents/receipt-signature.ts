import { createHash, createPublicKey, verify } from "node:crypto";

/**
 * The signature on a Meterless Nightshift receipt. Nightshift 1.2.x writes beside every reply it routed a `meterless.receipt_envelope`:
 * `{ body, pubkey_b64, sig_b64 }`, where `body` holds the receipt (`schema: meterless.compute_receipt.v1`) and `sig_b64` is an Ed25519 signature over
 * the body as compact JSON. This module checks that signature with the public key the envelope names, and says which key that was, so a reader can
 * compare it with the key they trust. A valid signature shows that the runtime holding that key wrote this receipt and that nothing in it was
 * changed afterwards. It does not show that the key is Meterless's own: that is a pin the reader supplies.
 *
 * Checked against a real envelope on 2026-10-26: valid over the body with keys sorted and over the body in the order it arrived.
 */

export interface EnvelopeCheck {
  valid: boolean;
  /** Why it is not valid; absent when it is. */
  reason?: string;
  /** The first 16 hex characters of the SHA-256 of the raw public key: the short name of the signer. */
  keyId?: string;
  receiptId?: string;
  routedModel?: string;
  requestedModel?: string;
  signedAtMs?: number;
}

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

/** Compact JSON with every object's keys in sorted order: the form that does not depend on the order a producer happened to write. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort) : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v);
  return JSON.stringify(sort(value));
}

export function keyIdOf(rawPublicKey: Buffer): string {
  return createHash("sha256").update(rawPublicKey).digest("hex").slice(0, 16);
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Check an envelope. Never throws: anything malformed is a reason. `pin` is a key id the signer must match. */
export function verifyEnvelope(envelope: unknown, opts: { expectReceiptId?: string; pin?: string } = {}): EnvelopeCheck {
  if (!isObj(envelope)) return { valid: false, reason: "no envelope" };
  const { body, pubkey_b64: pub, sig_b64: sig } = envelope;
  if (!isObj(body)) return { valid: false, reason: "the envelope has no body" };
  if (typeof pub !== "string" || typeof sig !== "string") return { valid: false, reason: "the envelope has no public key or no signature" };
  const raw = Buffer.from(pub, "base64");
  const signature = Buffer.from(sig, "base64");
  if (raw.length !== 32) return { valid: false, reason: "the public key is not a 32-byte Ed25519 key" };
  if (signature.length !== 64) return { valid: false, reason: "the signature is not 64 bytes" };
  const receipt = isObj(body["receipt"]) ? (body["receipt"] as Record<string, unknown>) : undefined;
  if (!receipt || receipt["schema"] !== "meterless.compute_receipt.v1") return { valid: false, reason: "the body holds no meterless.compute_receipt.v1" };
  const keyId = keyIdOf(raw);
  const base = {
    keyId,
    ...(typeof receipt["receipt_id"] === "string" ? { receiptId: receipt["receipt_id"] } : {}),
    ...(typeof receipt["requested_model"] === "string" ? { requestedModel: receipt["requested_model"] } : {}),
    ...(isObj(receipt["winning_route"]) && typeof receipt["winning_route"]["model"] === "string" ? { routedModel: receipt["winning_route"]["model"] as string } : {}),
    ...(typeof body["ts_ms"] === "number" ? { signedAtMs: body["ts_ms"] } : {}),
  };
  let ok = false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: "der", type: "spki" });
    ok = verify(null, Buffer.from(canonicalJson(body), "utf8"), key, signature) || verify(null, Buffer.from(JSON.stringify(body), "utf8"), key, signature);
  } catch {
    ok = false;
  }
  if (!ok) return { valid: false, reason: "the signature does not match the receipt", ...base };
  if (opts.expectReceiptId !== undefined && base.receiptId !== opts.expectReceiptId) return { valid: false, reason: `the signed receipt is ${base.receiptId ?? "unnamed"}, not ${opts.expectReceiptId}`, ...base };
  if (opts.pin !== undefined && opts.pin !== keyId) return { valid: false, reason: `signed by key ${keyId}, not the pinned key ${opts.pin}`, ...base };
  return { valid: true, ...base };
}
