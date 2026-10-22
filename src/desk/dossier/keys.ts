import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { keyIdOf, type Pins } from "../verify/dsse.ts";

export class KeyError extends Error {}

/** The signer for dossiers (spec 15.4). The private key lives in a closure and in the key file, never in any object that can be printed. */
export interface Signer {
  readonly keyid: string;
  /** Base64 of the SPKI DER public key, the form pins use. */
  readonly publicKey: string;
  sign(message: Uint8Array): Buffer;
}

export function defaultKeyPath(env: Record<string, string | undefined> = process.env): string {
  return env["DESK_SIGNER_KEY"] ?? join(homedir(), ".desk", "signer.key.pem");
}

/** A key inside any git work tree could be committed by accident, so it is refused outright. */
export function assertOutsideRepo(path: string): void {
  let dir = dirname(resolve(path));
  for (;;) {
    if (existsSync(join(dir, ".git"))) throw new KeyError(`refusing to keep a signing key inside a git work tree (${dir})`);
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function signerFrom(privateKey: KeyObject): Signer {
  if (privateKey.asymmetricKeyType !== "ed25519") throw new KeyError("the signing key must be Ed25519");
  const der = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const keyid = keyIdOf(der);
  const publicKey = der.toString("base64");
  return {
    keyid,
    publicKey,
    sign: (message) => cryptoSign(null, Buffer.from(message), privateKey),
  };
}

/** Restrict the key file to the current user. POSIX modes are set at creation; on Windows the ACL is narrowed with icacls, best effort. */
function restrictOnWindows(path: string): boolean {
  const user = process.env["USERNAME"];
  if (process.platform !== "win32" || !user) return false;
  try {
    execFileSync("icacls", [path, "/inheritance:r", "/grant:r", `${user}:F`], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export interface CreatedKey {
  signer: Signer;
  path: string;
  /** False when the platform gave no way to narrow access; the caller should say so. */
  permissionsRestricted: boolean;
}

export function createSignerFile(path: string = defaultKeyPath()): CreatedKey {
  const full = resolve(path);
  assertOutsideRepo(full);
  if (existsSync(full)) throw new KeyError(`${full} already exists; refusing to overwrite a signing key`);
  mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8" });
  writeFileSync(full, pem, { flag: "wx", mode: 0o600 });
  const restricted = process.platform === "win32" ? restrictOnWindows(full) : true;
  return { signer: signerFrom(privateKey), path: full, permissionsRestricted: restricted };
}

export function loadSigner(path: string = defaultKeyPath()): Signer {
  const full = resolve(path);
  assertOutsideRepo(full);
  if (!existsSync(full)) throw new KeyError(`no signing key at ${full}`);
  if (process.platform !== "win32" && (statSync(full).mode & 0o077) !== 0) throw new KeyError(`${full} is readable by others; run chmod 600 on it`);
  let key: KeyObject;
  try {
    key = createPrivateKey(readFileSync(full));
  } catch {
    throw new KeyError(`${full} does not hold a private key`);
  }
  return signerFrom(key);
}

export function loadOrCreateSigner(path: string = defaultKeyPath()): { signer: Signer; created: boolean; permissionsRestricted: boolean } {
  if (existsSync(resolve(path))) return { signer: loadSigner(path), created: false, permissionsRestricted: true };
  const c = createSignerFile(path);
  return { signer: c.signer, created: true, permissionsRestricted: c.permissionsRestricted };
}

export function pinsFor(...signers: Signer[]): Pins {
  return { version: 1, keys: signers.map((s) => ({ keyid: s.keyid, publicKey: s.publicKey })) };
}

/** An in-memory signer for tests and for tooling that must not touch the disk. */
export function ephemeralSigner(): Signer {
  return signerFrom(generateKeyPairSync("ed25519").privateKey);
}
