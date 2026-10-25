import { createHash, createPublicKey, randomBytes, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pae, strictBase64, type Envelope } from "./dsse.ts";

/**
 * A signed dossier in the shape the Sigstore tools read (DF-102). The dossier's statement is already an in-toto Statement v1 in a DSSE envelope; a Sigstore bundle (v0.3) wraps that
 * same envelope with what a verifier needs beside it: which key signed it, and optionally an RFC 3161 timestamp that says the signature existed by a given time. A person who has
 * `cosign` and the signer's public key can then check a dossier without any program of ours:
 *
 *   cosign verify-blob-attestation --key signer.pub --bundle statement.sigstore.json --type urn:desk:attestation:... --insecure-ignore-tlog manifest.json
 *
 * What this is not: the bundle carries no entry in a transparency log (Rekor) and no certificate from a certificate authority, because that needs a public service and an identity,
 * and a dossier is signed with a key the owner holds. A verifier is told to skip the log, and a bundle says so by having none. Nothing here claims the dossier was logged.
 */
export const BUNDLE_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";

export interface SigstoreBundle {
  mediaType: string;
  verificationMaterial: {
    publicKey: { hint: string };
    tlogEntries: unknown[];
    timestampVerificationData: { rfc3161Timestamps: { signedTimestamp: string }[] };
  };
  dsseEnvelope: { payload: string; payloadType: string; signatures: { sig: string; keyid: string }[] };
}

export function toSigstoreBundle(envelope: Envelope, o: { keyHint: string; timestamps?: readonly Uint8Array[] }): SigstoreBundle {
  if (envelope.signatures.length !== 1) throw new Error("a Sigstore bundle of this kind carries exactly one signature");
  const sig = envelope.signatures[0] as { sig: string };
  return {
    mediaType: BUNDLE_MEDIA_TYPE,
    verificationMaterial: {
      publicKey: { hint: o.keyHint },
      tlogEntries: [],
      timestampVerificationData: { rfc3161Timestamps: (o.timestamps ?? []).map((t) => ({ signedTimestamp: Buffer.from(t).toString("base64") })) },
    },
    // The envelope's own key id is left empty: the verifier is given the key, and a bundle must not make a claim about who signed it that the key does not.
    dsseEnvelope: { payload: envelope.payload, payloadType: envelope.payloadType, signatures: [{ sig: sig.sig, keyid: "" }] },
  };
}

export const FAILED = "ATTESTATION_VERIFICATION_FAILED";

export interface BundleReport {
  ok: boolean;
  /** One line for each thing that was checked, and what it found. A failure starts with ATTESTATION_VERIFICATION_FAILED. */
  findings: string[];
  statement: { predicateType: string; subject: { name: string; digest: Record<string, string> }[]; predicate: Record<string, unknown> } | null;
  timestamps: { count: number; granted: number; verified: boolean | null };
}

const fail = (findings: string[], why: string, timestamps?: BundleReport["timestamps"]): BundleReport => ({ ok: false, findings: [...findings, `${FAILED}: ${why}`], statement: null, timestamps: timestamps ?? { count: 0, granted: 0, verified: null } });

export interface VerifyOptions {
  /** The signer's public key, as SPKI PEM or DER, or the key object. */
  key: string | Uint8Array | KeyObject;
  /** Files the statement is about, by the name it gives them, to check their digests against its subjects. */
  artifacts?: ReadonlyMap<string, Uint8Array>;
  /** The predicate type the caller expects. */
  predicateType?: string;
  /** A certificate authority for the timestamp authority, PEM. With it, and with `openssl` on the path, a timestamp's signature is checked; without, it is only read. */
  tsaCa?: string;
}

function keyOf(k: VerifyOptions["key"]): KeyObject {
  if (typeof k === "string") return createPublicKey(k);
  if (k instanceof Uint8Array) return createPublicKey({ key: Buffer.from(k), format: "der", type: "spki" });
  return k;
}

const sha256Hex = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

export function verifySigstoreBundle(bundle: unknown, o: VerifyOptions): BundleReport {
  const found: string[] = [];
  if (typeof bundle !== "object" || bundle === null || Array.isArray(bundle)) return fail(found, "the bundle is not an object");
  const b = bundle as Partial<SigstoreBundle>;
  if (b.mediaType !== BUNDLE_MEDIA_TYPE) return fail(found, `the bundle's media type is ${JSON.stringify(b.mediaType)}, not ${BUNDLE_MEDIA_TYPE}`);
  found.push("media type: Sigstore bundle v0.3");
  const env = b.dsseEnvelope;
  if (!env || typeof env.payload !== "string" || typeof env.payloadType !== "string" || !Array.isArray(env.signatures) || env.signatures.length !== 1) return fail(found, "the DSSE envelope is missing, or does not have exactly one signature");
  const payload = strictBase64(env.payload);
  const sig = strictBase64(env.signatures[0]?.sig ?? "");
  if (!payload || !sig) return fail(found, "the payload or the signature is not base64");
  let key: KeyObject;
  try {
    key = keyOf(o.key);
  } catch {
    return fail(found, "the public key could not be read");
  }
  const alg = key.asymmetricKeyType;
  if (alg !== "ed25519" && alg !== "ec") return fail(found, `a ${String(alg)} key is not one this verifier accepts`);
  const ok = cryptoVerify(alg === "ed25519" ? null : "sha256", pae(env.payloadType, payload), key, sig);
  if (!ok) return fail(found, "the signature does not verify against that key over the payload");
  found.push(`signature: verifies against the ${alg === "ed25519" ? "Ed25519" : "ECDSA"} key given`);
  if (env.payloadType !== "application/vnd.in-toto+json") return fail(found, `the payload type is ${env.payloadType}, not an in-toto statement`);
  let statement: { _type?: unknown; predicateType?: unknown; subject?: unknown; predicate?: unknown };
  try {
    statement = JSON.parse(payload.toString("utf8"));
  } catch {
    return fail(found, "the payload is not JSON");
  }
  if (statement._type !== "https://in-toto.io/Statement/v1") return fail(found, `the statement's type is ${String(statement._type)}, not in-toto Statement v1`);
  if (typeof statement.predicateType !== "string" || !Array.isArray(statement.subject) || statement.subject.length === 0 || typeof statement.predicate !== "object" || statement.predicate === null) return fail(found, "the statement lacks a predicate type, a subject or a predicate");
  if (o.predicateType !== undefined && statement.predicateType !== o.predicateType) return fail(found, `the predicate type is ${statement.predicateType}, not the ${o.predicateType} that was asked for`);
  found.push(`statement: in-toto v1, ${statement.predicateType}`);
  const subjects = statement.subject as { name?: unknown; digest?: Record<string, unknown> }[];
  if (o.artifacts) {
    for (const [name, bytes] of o.artifacts) {
      const s = subjects.find((x) => x.name === name);
      if (!s || s.digest?.["sha256"] !== sha256Hex(bytes)) return fail(found, `${name} does not match the statement's subject (the bytes differ, or the statement is not about it)`);
      found.push(`subject: ${name} matches its sha-256`);
    }
  }
  const stamps = b.verificationMaterial?.timestampVerificationData?.rfc3161Timestamps ?? [];
  const ts: BundleReport["timestamps"] = { count: stamps.length, granted: 0, verified: null };
  for (const t of stamps) {
    const der = strictBase64(t.signedTimestamp ?? "");
    const status = der ? timestampStatus(der) : null;
    if (status === null || (status !== 0 && status !== 1)) return fail(found, "a timestamp in the bundle is not a granted RFC 3161 response", ts);
    ts.granted += 1;
  }
  if (stamps.length > 0) {
    if (o.tsaCa) {
      const checked = (stamps as { signedTimestamp: string }[]).map((t) => checkTimestamp(strictBase64(t.signedTimestamp) as Buffer, sig, o.tsaCa as string));
      if (checked.some((c) => c === false)) return fail(found, "a timestamp does not verify against the authority given, over this signature", ts);
      ts.verified = checked.every((c) => c === true) ? true : null;
      found.push(ts.verified ? `timestamp: ${ts.granted} granted, and verified against the authority given, over this signature` : `timestamp: ${ts.granted} granted; the signature could not be checked here (openssl was not found)`);
    } else {
      found.push(`timestamp: ${ts.granted} granted; not checked against an authority, because none was given`);
    }
  } else found.push("timestamp: none in the bundle");
  found.push("transparency log: none in the bundle; nothing says this dossier was logged");
  return { ok: true, findings: found, statement: { predicateType: statement.predicateType, subject: subjects as never, predicate: statement.predicate as Record<string, unknown> }, timestamps: ts };
}

// ---------------------------------------------------------------------------------------------- RFC 3161

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const der = (tag: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
const SHA256_OID = Buffer.from("0609608648016503040201", "hex");

/** A TimeStampReq for a SHA-256 digest (RFC 3161 section 2.4.1), asking for the authority's certificate in the reply and carrying a fresh nonce. */
export function timestampQuery(digest: Uint8Array): { request: Buffer; nonce: Buffer } {
  if (digest.length !== 32) throw new Error("a SHA-256 digest is 32 bytes");
  const nonce = Buffer.concat([Buffer.from([0x01]), randomBytes(7)]);
  const imprint = der(0x30, Buffer.concat([der(0x30, Buffer.concat([SHA256_OID, Buffer.from([0x05, 0x00])])), der(0x04, Buffer.from(digest))]));
  const request = der(0x30, Buffer.concat([der(0x02, Buffer.from([0x01])), imprint, der(0x02, nonce), der(0x01, Buffer.from([0xff]))]));
  return { request, nonce };
}

/** The PKIStatus of a TimeStampResp: 0 granted, 1 granted with modifications, 2 and above refused; null when it is not one. */
export function timestampStatus(resp: Uint8Array): number | null {
  const b = Buffer.from(resp);
  const readLen = (at: number): { len: number; next: number } | null => {
    const first = b[at];
    if (first === undefined) return null;
    if (first < 0x80) return { len: first, next: at + 1 };
    const n = first & 0x7f;
    if (n === 0 || n > 4 || at + 1 + n > b.length) return null;
    let len = 0;
    for (let i = 0; i < n; i += 1) len = len * 256 + (b[at + 1 + i] as number);
    return { len, next: at + 1 + n };
  };
  if (b[0] !== 0x30) return null;
  const outer = readLen(1);
  if (!outer || b[outer.next] !== 0x30) return null;
  const info = readLen(outer.next + 1);
  if (!info || b[info.next] !== 0x02) return null;
  const intLen = readLen(info.next + 1);
  if (!intLen || intLen.len !== 1) return null;
  return b[intLen.next] ?? null;
}

/** Ask an RFC 3161 authority to timestamp a signature. The authority sees a hash of the signature and nothing else. */
export async function requestTimestamp(url: string, signature: Uint8Array, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const { request } = timestampQuery(createHash("sha256").update(signature).digest());
  const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/timestamp-query" }, body: new Uint8Array(request), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`the timestamp authority answered ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  const status = timestampStatus(body);
  if (status !== 0 && status !== 1) throw new Error(`the timestamp authority did not grant the timestamp (status ${String(status)})`);
  return body;
}

/** True or false when openssl can check the response against the authority's CA over this signature; null when openssl is not there to ask. */
export function checkTimestamp(response: Uint8Array, signature: Uint8Array, caPem: string): boolean | null {
  const dir = mkdtempSync(join(tmpdir(), "desk-tsr-"));
  try {
    writeFileSync(join(dir, "r.tsr"), response);
    writeFileSync(join(dir, "ca.pem"), caPem);
    const r = spawnSync("openssl", ["ts", "-verify", "-in", "r.tsr", "-digest", createHash("sha256").update(signature).digest("hex"), "-CAfile", "ca.pem"], { cwd: dir, encoding: "utf8", windowsHide: true });
    if (r.error) return null;
    return r.status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
