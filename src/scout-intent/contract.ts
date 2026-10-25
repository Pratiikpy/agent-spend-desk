import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { ApprovalRecord, ExecutionContract } from "./types.ts";

/**
 * The execution contract (specification section 8.2): the only thing a downstream engine accepts. It is signed with HMAC-SHA256 over its canonical JSON, expires (five minutes by
 * default, never extended), is immutable once signed, and carries the exact set of capabilities the executor may use. An executor verifies on receipt and refuses an unsigned, altered,
 * expired or out-of-scope contract, and a high-risk one without its approvals. The HMAC is an integrity check, not a defence against a party who holds the secret; the signer is a
 * plug-in so that a stronger scheme can replace it.
 */
export interface Signer {
  sign(canonical: string): string;
  verify(canonical: string, signature: string): boolean;
}

/** JSON with sorted keys and no insignificant whitespace; `undefined` fields are left out, as `JSON.stringify` leaves them out. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v === undefined ? null : v)).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

export class HmacSigner implements Signer {
  private readonly secret: Buffer;
  constructor(secret: string | Buffer) {
    this.secret = Buffer.from(secret);
    if (this.secret.length < 16) throw new RangeError("a contract secret needs at least 16 bytes");
  }
  sign(text: string): string {
    return createHmac("sha256", this.secret).update(text).digest("hex");
  }
  verify(text: string, signature: string): boolean {
    const want = Buffer.from(this.sign(text), "hex");
    const got = /^[0-9a-f]{64}$/.test(signature) ? Buffer.from(signature, "hex") : null;
    return got !== null && got.length === want.length && timingSafeEqual(got, want);
  }
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A monotonic ULID generator: ten characters of time, sixteen of randomness, and within one millisecond the randomness is incremented so that ids still sort in issue order. */
export class UlidFactory {
  private lastMs = -1;
  private lastRand: number[] = [];
  constructor(private readonly clock: () => number = () => Date.now(), private readonly random: () => number[] = () => [...randomBytes(16)].map((b) => b & 31)) {}
  next(): string {
    const ms = Math.max(this.clock(), this.lastMs);
    let rand: number[];
    if (ms === this.lastMs) {
      rand = [...this.lastRand];
      for (let i = rand.length - 1; i >= 0; i -= 1) {
        if ((rand[i] as number) < 31) {
          rand[i] = (rand[i] as number) + 1;
          break;
        }
        rand[i] = 0;
      }
    } else rand = this.random();
    this.lastMs = ms;
    this.lastRand = rand;
    let t = ms;
    let time = "";
    for (let i = 0; i < 10; i += 1) {
      time = CROCKFORD[t % 32] + time;
      t = Math.floor(t / 32);
    }
    return time + rand.map((r) => CROCKFORD[r]).join("");
  }
}

export type VerifyFailure = "unsigned" | "tampered" | "expired" | "scope-mismatch" | "approval-missing" | "registry-drift" | "malformed";
export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure; detail: string };

export function signContract(unsigned: Omit<ExecutionContract, "signature" | "signedBy">, signer: Signer): ExecutionContract {
  const body = { ...unsigned, signedBy: "scout" as const };
  return { ...body, signature: signer.sign(canonical(body)) };
}

export interface VerifyOptions {
  signer: Signer;
  now: Date;
  /** The capabilities the executor is about to use; any outside the contract's scope refuses it. */
  using?: readonly string[];
  /** The registry version the executor knows; a different one is drift. */
  registryVersion?: number;
}

/**
 * What an executor does on receipt. It checks, in this order: the shape, the signature over everything but itself, the expiry, the registry version, the scope of what it is about
 * to do, and the approvals a high-risk contract needs. The first failure is the answer.
 */
export function verifyContract(c: unknown, o: VerifyOptions): VerifyResult {
  const k = c as Partial<ExecutionContract> | null;
  if (!k || typeof k !== "object" || typeof k.contractId !== "string" || !k.intent || !k.risk || !k.scope || !Array.isArray(k.toolPlan)) return { ok: false, reason: "malformed", detail: "not a contract" };
  if (typeof k.signature !== "string" || k.signature === "") return { ok: false, reason: "unsigned", detail: "the contract carries no signature" };
  const { signature, ...rest } = k as ExecutionContract;
  if (rest.signedBy !== "scout" || !o.signer.verify(canonical(rest), signature)) return { ok: false, reason: "tampered", detail: "the signature does not match the contract" };
  if (Date.parse(rest.expiresAt) <= o.now.getTime()) return { ok: false, reason: "expired", detail: `the contract expired at ${rest.expiresAt}` };
  if (o.registryVersion !== undefined && rest.registryVersion !== o.registryVersion) return { ok: false, reason: "registry-drift", detail: `the contract was issued under registry ${rest.registryVersion}, not ${o.registryVersion}` };
  const outside = (o.using ?? []).filter((u) => !rest.scope.capabilities.includes(u));
  if (outside.length > 0) return { ok: false, reason: "scope-mismatch", detail: `${outside.join(", ")} ${outside.length === 1 ? "is" : "are"} outside the contract's capabilities` };
  if (rest.risk.level === "high" && !rest.risk.approvals.some((a: ApprovalRecord) => a.kind === "user-confirm" || a.kind === "operator-review")) {
    return { ok: false, reason: "approval-missing", detail: "a high-risk contract needs a recorded approval before it is acted on" };
  }
  return { ok: true };
}
