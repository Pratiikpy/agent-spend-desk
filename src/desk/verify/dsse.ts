import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";

/** DSSE v1 (secure-systems-lab/dsse protocol.md and envelope.md v1.0.2), read from the spec on 2026-10-22. */
export function pae(payloadType: string, body: Uint8Array): Buffer {
  const type = Buffer.from(payloadType, "utf8");
  return Buffer.concat([Buffer.from(`DSSEv1 ${type.length} `, "ascii"), type, Buffer.from(` ${body.length} `, "ascii"), Buffer.from(body)]);
}

export interface Envelope {
  payload: string;
  payloadType: string;
  signatures: { keyid?: string; sig: string }[];
}

export interface PinnedKey {
  keyid: string;
  publicKey: string;
}

export interface Pins {
  version: 1;
  keys: PinnedKey[];
}

export function keyIdOf(spkiDer: Uint8Array): string {
  return createHash("sha256").update(spkiDer).digest("hex");
}

/** Strict base64: standard or URL-safe alphabet, no whitespace, canonical padding. Returns null if it is not exactly that. */
export function strictBase64(text: string): Buffer | null {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(text)) return null;
  const std = text.replace(/-/g, "+").replace(/_/g, "/");
  if (std.length % 4 !== 0) return null;
  const buf = Buffer.from(std, "base64");
  return buf.toString("base64") === std ? buf : null;
}

export type PinsProblem = { ok: false; reason: string } | { ok: true; pins: Pins; keys: Map<string, KeyObject> };

export function loadPins(raw: unknown): PinsProblem {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, reason: "pins must be an object" };
  const o = raw as Record<string, unknown>;
  if (o["version"] !== 1 || !Array.isArray(o["keys"])) return { ok: false, reason: "pins need version 1 and a keys array" };
  const keys = new Map<string, KeyObject>();
  const list: PinnedKey[] = [];
  for (const k of o["keys"] as unknown[]) {
    if (typeof k !== "object" || k === null) return { ok: false, reason: "a pinned key must be an object" };
    const e = k as Record<string, unknown>;
    if (typeof e["keyid"] !== "string" || typeof e["publicKey"] !== "string") return { ok: false, reason: "a pinned key needs keyid and publicKey" };
    const der = strictBase64(e["publicKey"]);
    if (!der) return { ok: false, reason: `pinned key ${e["keyid"]}: publicKey is not base64` };
    let key: KeyObject;
    try {
      key = createPublicKey({ key: der, format: "der", type: "spki" });
    } catch {
      return { ok: false, reason: `pinned key ${e["keyid"]}: not a valid SPKI public key` };
    }
    if (key.asymmetricKeyType !== "ed25519") return { ok: false, reason: `pinned key ${e["keyid"]}: only Ed25519 is accepted` };
    if (keyIdOf(der) !== e["keyid"]) return { ok: false, reason: `pinned key ${e["keyid"]}: keyid is not the SHA-256 of the public key` };
    keys.set(e["keyid"], key);
    list.push({ keyid: e["keyid"], publicKey: e["publicKey"] });
  }
  return { ok: true, pins: { version: 1, keys: list }, keys };
}

export type EnvelopeCheck =
  | { ok: true; payload: Buffer; keyid: string }
  | { ok: false; code: "envelope_malformed" | "payload_type_mismatch" | "no_signature" | "signer_not_pinned" | "signature_invalid"; detail: string };

/**
 * Decode an envelope and check its signatures against pinned keys. The returned payload is the exact byte
 * sequence that was verified: callers must parse that, never re-read the envelope (DSSE security note).
 * At least one signature by a pinned key must verify; a signature that names a pinned key and fails
 * is a failure even if another verifies.
 */
export function checkEnvelope(envelope: unknown, expectedType: string, keys: ReadonlyMap<string, KeyObject>): EnvelopeCheck {
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) return { ok: false, code: "envelope_malformed", detail: "not an object" };
  const e = envelope as Record<string, unknown>;
  if (typeof e["payload"] !== "string" || typeof e["payloadType"] !== "string" || !Array.isArray(e["signatures"])) {
    return { ok: false, code: "envelope_malformed", detail: "payload, payloadType and signatures are required" };
  }
  const payload = strictBase64(e["payload"]);
  if (!payload) return { ok: false, code: "envelope_malformed", detail: "payload is not strict base64" };
  if (e["payloadType"] !== expectedType) return { ok: false, code: "payload_type_mismatch", detail: `expected ${expectedType}, got ${e["payloadType"]}` };
  if (e["signatures"].length === 0) return { ok: false, code: "no_signature", detail: "the envelope carries no signature" };
  const signed = pae(e["payloadType"], payload);
  let verified: string | null = null;
  for (const s of e["signatures"] as unknown[]) {
    if (typeof s !== "object" || s === null) return { ok: false, code: "envelope_malformed", detail: "a signature must be an object" };
    const sig = s as Record<string, unknown>;
    if (typeof sig["sig"] !== "string" || (sig["keyid"] !== undefined && typeof sig["keyid"] !== "string")) {
      return { ok: false, code: "envelope_malformed", detail: "a signature needs a string sig and an optional string keyid" };
    }
    const bytes = strictBase64(sig["sig"]);
    if (!bytes || bytes.length !== 64) return { ok: false, code: "signature_invalid", detail: "signature is not 64 base64 bytes" };
    const named = typeof sig["keyid"] === "string" && sig["keyid"] !== "";
    const candidates = named ? [sig["keyid"] as string].filter((id) => keys.has(id)) : [...keys.keys()];
    for (const id of candidates) {
      const ok = cryptoVerify(null, signed, keys.get(id) as KeyObject, bytes);
      if (ok) verified = id;
      else if (named) return { ok: false, code: "signature_invalid", detail: `signature by pinned key ${id} does not verify` };
    }
  }
  if (verified === null) return { ok: false, code: "signer_not_pinned", detail: "no signature is by a pinned key" };
  return { ok: true, payload, keyid: verified };
}
