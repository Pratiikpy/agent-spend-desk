import { canonicalJson, sha256Hex } from "../../runtime/canonical.ts";

/**
 * Names, limits and the row hash shared by the builder and the verifier. The verifier imports this file
 * and nothing from the builder, so a bug in the builder cannot be mirrored into the check that audits it.
 */
export const MANIFEST_SCHEMA = "desk.dossier.manifest/1";
export const STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
/** Our own predicate type URI (spec 11.4). */
export const PREDICATE_TYPE = "urn:desk:dossier:v1";
/** One of the two payload types in-toto's envelope spec permits (`application/vnd.in-toto+json`). */
export const PAYLOAD_TYPE_STATEMENT = "application/vnd.in-toto+json";
export const PAYLOAD_TYPE_CHECKPOINT = "application/vnd.desk.checkpoint+json";
export const PAYLOAD_TYPE_APPROVAL = "application/vnd.desk.approval+json";

export const FILE_MANIFEST = "manifest.json";
export const FILE_STATEMENT = "statement.dsse.json";
export const FILE_CLAIMS = "claims.jsonl";
export const FILE_CHECKPOINT = "checkpoint.json";
export const FILE_PROOFS = "proofs/inclusion.json";
export const FILE_VERIFY_MD = "VERIFY.md";

export const DOSSIER_KINDS = ["month_bill", "canary_evidence", "replay_report", "policy_change", "dispute_pack", "renewal_sheet"] as const;
export type DossierKind = (typeof DOSSIER_KINDS)[number];
export const AUDIENCES = ["reviewer", "auditor", "counterparty"] as const;
export const DISCLOSURES = ["full", "redacted"] as const;

/** Hard limits so a hostile bundle cannot exhaust memory or time. */
export const LIMITS = {
  maxFiles: 5_000,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxClaims: 10_000,
  maxRows: 200_000,
  maxResamples: 20_000,
  maxPathLength: 200,
} as const;

export const GENESIS_HASH = "0".repeat(64);

/** One entry of the append-only log. `row_hash` commits to the content and to the previous row of the same stream. */
export interface Row {
  stream: string;
  seq: number;
  kind: string;
  data: unknown;
  prev_hash: string;
  row_hash: string;
}

export function computeRowHash(row: Pick<Row, "stream" | "seq" | "kind" | "data" | "prev_hash">): string {
  return sha256Hex(canonicalJson({ stream: row.stream, seq: row.seq, kind: row.kind, data: row.data, prev_hash: row.prev_hash }));
}

export const STREAM_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const HEX64 = /^[0-9a-f]{64}$/;

export function rowsPath(stream: string): string {
  return `rows/${stream}.jsonl`;
}
export function snapshotPath(snapshotId: string): string {
  return `price_snapshots/${snapshotId}.json`;
}
export function policyPath(hex: string): string {
  return `policy/${hex}.json`;
}
export function restrictPath(hex: string): string {
  return `policy/restrict-${hex}.json`;
}
export function blobPath(hex: string): string {
  return `evidence/blobs/sha256/${hex}`;
}
export function approvalPath(requestId: string): string {
  return `approvals/${requestId}.json`;
}

export const WHAT_PASS_MEANS =
  "the rows are the rows the Desk's log committed to, the numbers follow from the rows by the stated computations, and the policy check reproduces.";
export const WHAT_PASS_DOES_NOT_MEAN =
  "PASS does not mean the agent logs were truthful, that estimated dollars equal the invoice, that a judge model's score is correct, or that the signer did not log false rows consistently.";
