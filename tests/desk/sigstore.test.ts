import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { writeBundleDir } from "../../src/desk/dossier/bundle-io.ts";
import { pae, type Envelope } from "../../src/desk/verify/dsse.ts";
import { bundleCommand } from "../../src/desk/verify/bundle-command.ts";
import { BUNDLE_MEDIA_TYPE, FAILED, requestTimestamp, timestampQuery, timestampStatus, toSigstoreBundle, verifySigstoreBundle } from "../../src/desk/verify/sigstore.ts";
import { makeFixture } from "./dossier/fixture.ts";
import { opensslAvailable, startLocalTsa } from "./support/local-tsa.ts";

/**
 * Sigstore bundles of signed dossiers (DF-102): the bundle shape, what the offline check refuses, an RFC 3161 timestamp from a real authority, and `cosign` itself when it is
 * installed (point DESK_COSIGN at it), which is the check that matters: a tool of ours agreeing with our own tool says little.
 */
const root = mkdtempSync(join(tmpdir(), "desk-sigstore-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = (): string => {
  n += 1;
  const d = join(root, `d${n}`);
  mkdirSync(d, { recursive: true });
  return d;
};

function dossier() {
  const f = makeFixture();
  const dir = fresh();
  writeBundleDir(f.files, dir);
  const env = JSON.parse(readFileSync(join(dir, "statement.dsse.json"), "utf8")) as Envelope;
  const pub = createPublicKey({ key: Buffer.from(f.signer.publicKey, "base64"), format: "der", type: "spki" });
  return { f, dir, env, pub, pem: pub.export({ type: "spki", format: "pem" }).toString(), manifest: readFileSync(join(dir, "manifest.json")) };
}

describe("the bundle", () => {
  it("wraps the dossier's own statement and signature, names the key only by a hint, and has no transparency log entry", () => {
    const { env, f } = dossier();
    const b = toSigstoreBundle(env, { keyHint: f.signer.keyid });
    expect(b.mediaType).toBe(BUNDLE_MEDIA_TYPE);
    expect(b.dsseEnvelope.payload).toBe(env.payload);
    expect(b.dsseEnvelope.signatures).toEqual([{ sig: env.signatures[0]!.sig, keyid: "" }]);
    expect(b.verificationMaterial).toEqual({ publicKey: { hint: f.signer.keyid }, tlogEntries: [], timestampVerificationData: { rfc3161Timestamps: [] } });
    expect(() => toSigstoreBundle({ ...env, signatures: [...env.signatures, ...env.signatures] }, { keyHint: "x" })).toThrow(/exactly one signature/);
  });
});

describe("checking a bundle offline", () => {
  it("passes a dossier's bundle against the signer's key and the manifest it is about, and says what it did not check", () => {
    const { env, f, pem, manifest } = dossier();
    const r = verifySigstoreBundle(toSigstoreBundle(env, { keyHint: f.signer.keyid }), { key: pem, artifacts: new Map([["manifest.json", manifest]]) });
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual(expect.arrayContaining(["signature: verifies against the Ed25519 key given", expect.stringMatching(/^statement: in-toto v1, /), "subject: manifest.json matches its sha-256", "timestamp: none in the bundle", "transparency log: none in the bundle; nothing says this dossier was logged"]));
    expect(r.statement!.subject[0]!.name).toBe("manifest.json");
  });

  it("fails closed, with ATTESTATION_VERIFICATION_FAILED and the reason, on a wrong key, an altered payload, an altered signature, an altered manifest and a different predicate type", () => {
    const { env, f, pem, manifest } = dossier();
    const good = toSigstoreBundle(env, { keyHint: f.signer.keyid });
    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    const expectFail = (b: unknown, o: Parameters<typeof verifySigstoreBundle>[1], why: RegExp): void => {
      const r = verifySigstoreBundle(b, o);
      expect(r.ok).toBe(false);
      expect(r.findings[r.findings.length - 1]).toMatch(new RegExp(`^${FAILED}: `));
      expect(r.findings[r.findings.length - 1]).toMatch(why);
    };
    expectFail(good, { key: other }, /does not verify against that key/);
    const payload = JSON.parse(Buffer.from(env.payload, "base64").toString("utf8"));
    payload.predicate.kind = "tampered";
    expectFail({ ...good, dsseEnvelope: { ...good.dsseEnvelope, payload: Buffer.from(JSON.stringify(payload)).toString("base64") } }, { key: pem }, /does not verify/);
    const sig = Buffer.from(good.dsseEnvelope.signatures[0]!.sig, "base64");
    sig[0] = (sig[0] as number) ^ 1;
    expectFail({ ...good, dsseEnvelope: { ...good.dsseEnvelope, signatures: [{ sig: sig.toString("base64"), keyid: "" }] } }, { key: pem }, /does not verify/);
    expectFail(good, { key: pem, artifacts: new Map([["manifest.json", Buffer.concat([manifest, Buffer.from(" ")])]]) }, /manifest\.json does not match the statement's subject/);
    expectFail(good, { key: pem, artifacts: new Map([["claims.jsonl", manifest]]) }, /claims\.jsonl does not match/);
    expectFail(good, { key: pem, predicateType: "urn:other:v1" }, /not the urn:other:v1 that was asked for/);
    expectFail({ ...good, mediaType: "application/json" }, { key: pem }, /media type/);
    expectFail("not a bundle", { key: pem }, /not an object/);
    expectFail({ ...good, dsseEnvelope: { ...good.dsseEnvelope, signatures: [] } }, { key: pem }, /exactly one signature/);
    expectFail({ ...good, dsseEnvelope: { ...good.dsseEnvelope, payload: "not base64!" } }, { key: pem }, /not base64/);
    expectFail(good, { key: "not a key" }, /public key could not be read/);
  });

  it("accepts an ECDSA signature as well, the key type cosign's own keys have", () => {
    const kp = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const payload = Buffer.from(JSON.stringify({ _type: "https://in-toto.io/Statement/v1", subject: [{ name: "a", digest: { sha256: createHash("sha256").update("x").digest("hex") } }], predicateType: "urn:t:v1", predicate: {} }));
    const sig = cryptoSign("sha256", pae("application/vnd.in-toto+json", payload), kp.privateKey);
    const b = toSigstoreBundle({ payload: payload.toString("base64"), payloadType: "application/vnd.in-toto+json", signatures: [{ sig: sig.toString("base64") }] }, { keyHint: "ec" });
    expect(verifySigstoreBundle(b, { key: kp.publicKey, artifacts: new Map([["a", Buffer.from("x")]]) }).ok).toBe(true);
    expect(verifySigstoreBundle(b, { key: generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey }).findings.pop()).toMatch(/rsa key is not one this verifier accepts/);
  });
});

const cosign = process.env["DESK_COSIGN"] ?? "";
describe.skipIf(cosign === "" || !existsSync(cosign))("cosign, the tool a stranger would use", () => {
  it("verifies a dossier's bundle with the signer's public key and the manifest, offline, and refuses it when a byte of either is changed", () => {
    const { env, f, pem, manifest, dir } = dossier();
    const b = toSigstoreBundle(env, { keyHint: f.signer.keyid });
    const work = fresh();
    writeFileSync(join(work, "b.json"), JSON.stringify(b));
    writeFileSync(join(work, "signer.pub"), pem);
    writeFileSync(join(work, "manifest.json"), manifest);
    const type = (JSON.parse(Buffer.from(env.payload, "base64").toString("utf8")) as { predicateType: string }).predicateType;
    const run = (file: string): { status: number | null; out: string } => {
      const r = spawnSync(cosign, ["verify-blob-attestation", "--key", "signer.pub", "--bundle", "b.json", "--new-bundle-format", "--type", type, "--insecure-ignore-tlog", "--insecure-ignore-sct", file], { cwd: work, encoding: "utf8", windowsHide: true });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    };
    const ok = run("manifest.json");
    expect(ok.out).toContain("Verified OK");
    expect(ok.status).toBe(0);
    writeFileSync(join(work, "manifest.json"), Buffer.concat([manifest, Buffer.from(" ")]));
    expect(run("manifest.json").status).not.toBe(0);
    writeFileSync(join(work, "manifest.json"), manifest);
    const bad = JSON.parse(JSON.stringify(b));
    const sig = Buffer.from(bad.dsseEnvelope.signatures[0].sig, "base64");
    sig[3] = (sig[3] as number) ^ 1;
    bad.dsseEnvelope.signatures[0].sig = sig.toString("base64");
    writeFileSync(join(work, "b.json"), JSON.stringify(bad));
    expect(run("manifest.json").status).not.toBe(0);
    expect(dir).toBeTruthy();
  }, 120_000);
});

describe.skipIf(!opensslAvailable())("an RFC 3161 timestamp", () => {
  it("is a request that openssl reads as a SHA-256 request for the digest, with a nonce and the certificate asked for", async () => {
    const digest = createHash("sha256").update("a signature").digest();
    const { request } = timestampQuery(digest);
    const dir = fresh();
    writeFileSync(join(dir, "q.tsq"), request);
    const r = spawnSync("openssl", ["ts", "-query", "-in", "q.tsq", "-text"], { cwd: dir, encoding: "utf8", windowsHide: true });
    expect(r.stdout).toMatch(/Hash Algorithm: sha256/);
    const shown = r.stdout.split("\n").filter((l) => /^\s*[0-9a-f]{4} - /i.test(l)).map((l) => l.replace(/^\s*[0-9a-f]{4} - /i, "").slice(0, 47).replace(/[^0-9a-f]/gi, "")).join("").toLowerCase();
    expect(shown).toBe(digest.toString("hex"));
    expect(r.stdout).toMatch(/Certificate required: yes/);
    expect(r.stdout).toMatch(/Nonce: 0x01/);
    expect(() => timestampQuery(Buffer.alloc(31))).toThrow(/32 bytes/);
  });

  it("is granted by a real authority, put in the bundle, and verified by openssl against the authority's CA over this signature and no other", async () => {
    const tsa = await startLocalTsa();
    try {
      const { env, f, pem, manifest } = dossier();
      const sig = Buffer.from(env.signatures[0]!.sig, "base64");
      const stamp = await requestTimestamp(tsa.url, sig);
      expect(timestampStatus(stamp)).toBe(0);
      const b = toSigstoreBundle(env, { keyHint: f.signer.keyid, timestamps: [stamp] });
      const r = verifySigstoreBundle(b, { key: pem, artifacts: new Map([["manifest.json", manifest]]), tsaCa: tsa.caPem });
      expect(r.ok).toBe(true);
      expect(r.timestamps).toEqual({ count: 1, granted: 1, verified: true });
      expect(r.findings).toContain("timestamp: 1 granted, and verified against the authority given, over this signature");
      const unchecked = verifySigstoreBundle(b, { key: pem });
      expect(unchecked.findings).toContain("timestamp: 1 granted; not checked against an authority, because none was given");
      // The same timestamp laid on another dossier's signature does not stand for it.
      const other = dossier();
      const moved = toSigstoreBundle(other.env, { keyHint: f.signer.keyid, timestamps: [stamp] });
      const wrong = verifySigstoreBundle(moved, { key: other.pem, tsaCa: tsa.caPem });
      expect(wrong.ok).toBe(false);
      expect(wrong.findings.pop()).toMatch(/does not verify against the authority given, over this signature/);
      // Nor does it stand against an authority that did not make it.
      const stranger = await startLocalTsa();
      try {
        const bad = verifySigstoreBundle(b, { key: pem, tsaCa: stranger.caPem });
        expect(bad.ok).toBe(false);
      } finally {
        await stranger.close();
      }
    } finally {
      await tsa.close();
    }
  }, 120_000);

  it("is refused, and no bundle is made, when the authority will not grant it", async () => {
    const tsa = await startLocalTsa();
    try {
      tsa.refuse = true;
      await expect(requestTimestamp(tsa.url, Buffer.from("sig"))).rejects.toThrow(/answered 503/);
      const { dir } = dossier();
      const r = await bundleCommand({ sub: "make", args: [dir], flags: { tsa: tsa.url } });
      expect(r.code).toBe(1);
      expect(r.text).toMatch(/^ATTESTATION_VERIFICATION_FAILED: the timestamp authority answered 503/);
      expect(existsSync(join(dir, "statement.sigstore.json"))).toBe(false);
    } finally {
      await tsa.close();
    }
  }, 60_000);

  it("reads the status of a response: granted, refused, and what is not a response at all", () => {
    expect(timestampStatus(Buffer.from("3005300302 0100".replace(/ /g, ""), "hex"))).toBe(0);
    expect(timestampStatus(Buffer.from("3005300302 0102".replace(/ /g, ""), "hex"))).toBe(2);
    expect(timestampStatus(Buffer.from("hello"))).toBeNull();
    expect(timestampStatus(Buffer.alloc(0))).toBeNull();
  });
});

describe("from the command line", () => {
  it("makes a bundle from a dossier folder, checks it against the signer's key and the folder, and exits 1 when anything is wrong", async () => {
    const { dir, pem, f } = dossier();
    writeFileSync(join(dir, "signer.pub"), pem);
    const made = await bundleCommand({ sub: "make", args: [dir], flags: {} });
    expect(made.code).toBe(0);
    expect(made.text).toContain("cosign verify-blob-attestation --key signer.pub");
    expect(existsSync(join(dir, "statement.sigstore.json"))).toBe(true);
    const ok = await bundleCommand({ sub: "verify", args: [join(dir, "statement.sigstore.json")], flags: { key: join(dir, "signer.pub"), dossier: dir } });
    expect(ok.code).toBe(0);
    expect(ok.text).toMatch(/^PASS\n/);
    expect(ok.text).toContain("merkle root: the statement's root is the dossier checkpoint's");
    const pins = join(dir, "pins.json");
    writeFileSync(pins, JSON.stringify(f.pins));
    expect((await bundleCommand({ sub: "verify", args: [join(dir, "statement.sigstore.json")], flags: { pins } })).code).toBe(0);
    // A manifest with a byte changed.
    writeFileSync(join(dir, "manifest.json"), Buffer.concat([readFileSync(join(dir, "manifest.json")), Buffer.from(" ")]));
    const bad = await bundleCommand({ sub: "verify", args: [join(dir, "statement.sigstore.json")], flags: { key: join(dir, "signer.pub"), dossier: dir } });
    expect(bad.code).toBe(1);
    expect(bad.text).toMatch(/^FAIL\n[\s\S]*ATTESTATION_VERIFICATION_FAILED: manifest\.json does not match/);
    expect((await bundleCommand({ sub: "verify", args: [join(dir, "nope.json")], flags: { key: join(dir, "signer.pub") } })).code).toBe(2);
    expect((await bundleCommand({ sub: "verify", args: [join(dir, "statement.sigstore.json")], flags: {} })).code).toBe(2);
    expect((await bundleCommand({ sub: "make", args: [join(dir, "nowhere")], flags: {} })).code).toBe(2);
  });

  it("fails closed with the exit code the shell sees when the process is run", () => {
    const { dir, pem } = dossier();
    writeFileSync(join(dir, "signer.pub"), pem);
    const make = spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "bundle", "make", dir], { encoding: "utf8", windowsHide: true });
    expect(make.status).toBe(0);
    const bundle = join(dir, "statement.sigstore.json");
    const ok = spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "bundle", "verify", bundle, "--key", join(dir, "signer.pub"), "--folder", dir], { encoding: "utf8", windowsHide: true });
    expect(ok.status).toBe(0);
    const b = JSON.parse(readFileSync(bundle, "utf8"));
    b.dsseEnvelope.signatures[0].sig = Buffer.alloc(64, 1).toString("base64");
    writeFileSync(bundle, JSON.stringify(b));
    const bad = spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "bundle", "verify", bundle, "--key", join(dir, "signer.pub")], { encoding: "utf8", windowsHide: true });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("ATTESTATION_VERIFICATION_FAILED");
    expect(execFileSync).toBeTypeOf("function");
  }, 120_000);
});
