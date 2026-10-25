import { citationFaithfulness, describeFaithfulness } from "../ask/faithfulness.ts";
import { canonicalJson, hashJson, sha256Hex } from "../../runtime/canonical.ts";
import { ClaimLedger, type Claim, type Sentence } from "../agents/claims.ts";
import { auditSentences, extractNumbers } from "../agents/audit.ts";
import { describeWidening, restrictCheck } from "../policy/restrict.ts";
import { parsePolicy } from "../policy/parse.ts";
import type { Policy } from "../policy/types.ts";
import { parseSnapshot, type PriceSnapshot } from "../pricing/pricebook.ts";
import { divRoundBig, knownComputation, runComputation, ComputationError, type CompEnv, type CompSpec } from "./computations.ts";
import { checkEnvelope, loadPins, strictBase64, type Pins } from "./dsse.ts";
import {
  AUDIENCES, DISCLOSURES, DOSSIER_KINDS, FILE_CHECKPOINT, FILE_CLAIMS, FILE_MANIFEST, FILE_PROOFS, FILE_STATEMENT, FILE_VERIFY_MD, GENESIS_HASH, HEX64, LIMITS,
  MANIFEST_SCHEMA, PAYLOAD_TYPE_APPROVAL, PAYLOAD_TYPE_CHECKPOINT, PAYLOAD_TYPE_STATEMENT, PREDICATE_TYPE, STATEMENT_TYPE, STREAM_PATTERN, WHAT_PASS_DOES_NOT_MEAN, WHAT_PASS_MEANS,
  blobPath, computeRowHash, type Row,
} from "./format.ts";
import { leafHash, verifyInclusion } from "./merkle.ts";
import { any, arr, bool, int, literal, num, obj, oneOf, record, str, validate, type Check } from "./validate.ts";

export type Status = "PASS" | "FAIL" | "INDETERMINATE" | "NOT_APPLICABLE";
export interface Finding {
  code: string;
  detail: string;
}
export interface LevelReport {
  id: string;
  name: string;
  status: Status;
  findings: Finding[];
  notes: string[];
}
export interface Report {
  overall: Status;
  pinned: boolean;
  levels: LevelReport[];
  means: string;
  doesNotMean: string;
}
export type Files = ReadonlyMap<string, Uint8Array>;

export class PinsError extends Error {}

class Level {
  readonly findings: Finding[] = [];
  readonly notes: string[] = [];
  private indeterminate = false;
  private notApplicable = false;
  readonly id: string;
  readonly name: string;
  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }
  fail(code: string, detail: string): void {
    this.findings.push({ code, detail });
  }
  unknown(code: string, detail: string): void {
    this.indeterminate = true;
    this.notes.push(`${code}: ${detail}`);
  }
  na(note: string): void {
    this.notApplicable = true;
    this.notes.push(note);
  }
  note(text: string): void {
    this.notes.push(text);
  }
  report(): LevelReport {
    const status: Status = this.findings.length > 0 ? "FAIL" : this.indeterminate ? "INDETERMINATE" : this.notApplicable ? "NOT_APPLICABLE" : "PASS";
    return { id: this.id, name: this.name, status, findings: this.findings, notes: this.notes };
  }
}

const dec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
// A plus sign is allowed because a price snapshot with supplements applied is named `base+supplement+supplement`.
const SAFE_PATH = /^[A-Za-z0-9._+-]+(\/[A-Za-z0-9._+-]+)*$/;
const ALLOWED_PREFIXES = ["rows/", "proofs/", "price_snapshots/", "policy/", "evidence/blobs/sha256/", "approvals/"];

function text(bytes: Uint8Array): string {
  return dec.decode(bytes);
}

/** Parse JSON and require the bytes to be exactly the canonical form, which also rejects duplicate keys and loose numbers. */
function parseCanonical(source: string): unknown {
  const value: unknown = JSON.parse(source);
  if (canonicalJson(value) !== source) throw new SyntaxError("not in canonical form");
  return value;
}

function parseLines(source: string): unknown[] {
  if (source === "") return [];
  if (!source.endsWith("\n")) throw new SyntaxError("last line is not terminated");
  return source
    .slice(0, -1)
    .split("\n")
    .map((line) => {
      if (line === "") throw new SyntaxError("blank line");
      return parseCanonical(line);
    });
}

const periodCheck = obj({ from: str({ min: 1, max: 40 }), to: str({ min: 1, max: 40 }) });
const hexCheck = str({ pattern: HEX64 });

const MANIFEST_CHECK: Check = obj({
  schema: literal(MANIFEST_SCHEMA),
  kind: oneOf(DOSSIER_KINDS),
  tenant: str({ min: 1, max: 100 }),
  period: periodCheck,
  created_at: str({ min: 1, max: 40 }),
  audience: oneOf(AUDIENCES),
  disclosure: oneOf(DISCLOSURES),
  signer_keyid: hexCheck,
  files: record(hexCheck, { max: LIMITS.maxFiles }),
  computations: arr(str({ max: 80 }), { max: 100 }),
});

const STATEMENT_CHECK: Check = obj({
  _type: literal(STATEMENT_TYPE),
  subject: arr(obj({ name: str({ max: 200 }), digest: obj({ sha256: hexCheck }) }), { min: 1, max: 1 }),
  predicateType: literal(PREDICATE_TYPE),
  predicate: obj(
    {
      kind: oneOf(DOSSIER_KINDS),
      period: periodCheck,
      checkpoint_root: hexCheck,
      checkpoint_size: int({ min: 0 }),
      claims_digest: hexCheck,
      price_snapshot_ids: arr(str({ max: 200 }), { max: 1000 }),
      policy_version_ids: arr(hexCheck, { max: 1000 }),
      approval_ids: arr(str({ max: 100 }), { max: 1000 }),
    },
    { action_digest: str({ pattern: /^sha256:[0-9a-f]{64}$/ }) },
  ),
});

const CHECKPOINT_CHECK: Check = obj({
  origin: str({ min: 1, max: 100 }),
  size: int({ min: 0 }),
  root_hash: hexCheck,
  heads: record(obj({ seq: int({ min: 0 }), row_hash: hexCheck }), { key: STREAM_PATTERN, max: 1000 }),
  timestamp: str({ min: 1, max: 40 }),
});

const PROOFS_CHECK: Check = obj({
  size: int({ min: 0 }),
  root: hexCheck,
  proofs: arr(
    obj({ global_index: int({ min: 0 }), stream: str({ pattern: STREAM_PATTERN }), seq: int({ min: 0 }), row_hash: hexCheck, path: arr(hexCheck, { max: 64 }) }),
    { max: LIMITS.maxRows },
  ),
});

const ROW_CHECK: Check = obj({ stream: str({ pattern: STREAM_PATTERN }), seq: int({ min: 0 }), kind: str({ min: 1, max: 100 }), data: any, prev_hash: hexCheck, row_hash: hexCheck });

const COMP_CHECK: Check = obj(
  { fn: str({ min: 1, max: 80 }), args: record(any, { max: 50 }) },
  {
    range: obj({ stream: str({ pattern: STREAM_PATTERN }), from: int({ min: 0 }), to: int({ min: 0 }) }),
    rows: arr(obj({ stream: str({ pattern: STREAM_PATTERN }), seq: int({ min: 0 }) }), { max: LIMITS.maxRows }),
  },
);

const CLAIM_CHECK: Check = obj(
  { type: literal("claim"), id: str({ min: 1, max: 100 }), kind: oneOf(["number", "fact", "comparison", "quote"]), text: str({ min: 1, max: 20_000 }) },
  {
    unit: oneOf(["usd", "pct", "count", "ratio", "none"]),
    class: oneOf(["billed", "reported", "estimated", "unpriced", "cassette", "computed"]),
    value: num,
    decimals: int({ min: 0, max: 6 }),
    divisor: int({ min: 1, max: 1_000_000_000 }),
    interval: obj({ low: num, high: num, level: num }),
    computation: COMP_CHECK,
    support: obj({ blob: hexCheck, start: int({ min: 0 }), end: int({ min: 0 }), status: oneOf(["exact", "normalised"]) }),
    quote_sha256: hexCheck,
  },
);

const SENTENCE_CHECK: Check = obj({ type: literal("sentence"), id: str({ min: 1, max: 100 }), text: str({ min: 1, max: 20_000 }), cites: arr(str({ max: 100 }), { max: 100 }) });

const RESTRICT_CHECK: Check = obj({
  from: hexCheck,
  to: hexCheck,
  domain: record(arr(str({ max: 200 }), { max: 1000 }), { max: 20 }),
  result: obj({ narrows: bool, grid_size: int({ min: 0 }), outside_fragment: bool, merged_dims: arr(str({ max: 80 }), { max: 20 }), route_changes: int({ min: 0 }), widening: any }),
});

const APPROVAL_CHECK: Check = obj({
  approval_request_id: str({ min: 1, max: 100 }),
  action_digest: str({ pattern: /^sha256:[0-9a-f]{64}$/ }),
  policy_version: str({ pattern: /^sha256:[0-9a-f]{64}$/ }),
  chain_version: str({ min: 1, max: 100 }),
  approver: str({ min: 1, max: 200 }),
  decision: literal("approve"),
  decided_at: str({ min: 1, max: 40 }),
});

interface ParsedClaim {
  id: string;
  kind: string;
  text: string;
  unit?: string;
  class?: string;
  value?: number;
  decimals?: number;
  divisor?: number;
  interval?: { low: number; high: number; level: number };
  computation?: CompSpec;
  support?: { blob: string; start: number; end: number; status: "exact" | "normalised" };
  quote_sha256?: string;
}

interface Manifest {
  kind: string;
  period: { from: string; to: string };
  disclosure: string;
  signer_keyid: string;
  files: Record<string, string>;
  computations: string[];
}

interface Statement {
  subject: { name: string; digest: { sha256: string } }[];
  predicate: {
    kind: string;
    period: { from: string; to: string };
    checkpoint_root: string;
    checkpoint_size: number;
    claims_digest: string;
    price_snapshot_ids: string[];
    policy_version_ids: string[];
    approval_ids: string[];
    action_digest?: string;
  };
}

interface Checkpoint {
  size: number;
  root_hash: string;
  heads: Record<string, { seq: number; row_hash: string }>;
}

interface Proofs {
  size: number;
  root: string;
  proofs: { global_index: number; stream: string; seq: number; row_hash: string; path: string[] }[];
}

interface Parsed {
  manifest?: Manifest;
  manifestBytes?: Uint8Array;
  statementEnvelope?: unknown;
  statement?: Statement;
  checkpointEnvelope?: unknown;
  checkpoint?: Checkpoint;
  claimsBytes?: Uint8Array;
  claims: ParsedClaim[];
  sentences: Sentence[];
  proofs?: Proofs;
  rows: Row[];
  rowIndex: Map<string, Map<number, Row>>;
  snapshots: Map<string, PriceSnapshot>;
  policyDocs: Map<string, unknown>;
  restricts: { path: string; value: { from: string; to: string; domain: Record<string, string[]>; result: Record<string, unknown> } }[];
  approvalEnvelopes: Map<string, unknown>;
}

/**
 * Verify a dossier bundle offline (spec 11.5). Levels V0 to V5 are the core levels, V6-D to V8-D recompute the
 * Desk's numbers from the bundled rows, VA binds an approval to the action. Nothing here reads the network or
 * the Desk's database: the only inputs are the bundle's bytes and the pinned public keys.
 */
export function verifyBundle(files: Files, options: { pins?: unknown } = {}): Report {
  let pins: Pins | undefined;
  let keys = new Map<string, import("node:crypto").KeyObject>();
  if (options.pins !== undefined) {
    const loaded = loadPins(options.pins);
    if (!loaded.ok) throw new PinsError(loaded.reason);
    pins = loaded.pins;
    keys = loaded.keys;
  }
  const p: Parsed = { claims: [], sentences: [], rows: [], rowIndex: new Map(), snapshots: new Map(), policyDocs: new Map(), restricts: [], approvalEnvelopes: new Map() };
  const v0 = new Level("V0", "bundle structure");
  const v1 = new Level("V1", "schema and canonical form");
  const v2 = new Level("V2", "hashes and row chain");
  const v3 = new Level("V3", "signature and statement binding");
  const v4 = new Level("V4", "inclusion proofs against the signed checkpoint");
  const v5 = new Level("V5", "quote re-check");
  const v6 = new Level("V6-D", "recompute cited computations");
  const v7 = new Level("V7-D", "re-run the restrict-only check");
  const v8 = new Level("V8-D", "claim ledger: every sentence figure traces to a recomputed claim");
  const va = new Level("VA", "approval bound to the action");

  guard(v0, () => structure(files, v0));
  guard(v1, () => parseAll(files, p, v1));
  guard(v2, () => hashes(files, p, v2));
  guard(v3, () => signatures(p, pins !== undefined, keys, v3));
  guard(v4, () => inclusion(p, pins !== undefined, keys, v4));
  guard(v5, () => quotes(files, p, v5));
  const v6ok = new Set<string>();
  guard(v6, () => recompute(p, v6, v6ok));
  guard(v7, () => restrictLevel(p, v7));
  guard(v8, () => claimLedger(p, v6ok, v8));
  guard(va, () => approvals(p, pins !== undefined, keys, va));

  const levels = [v0, v1, v2, v3, v4, v5, v6, v7, v8, va].map((l) => l.report());
  let overall: Status = "PASS";
  if (levels.some((l) => l.status === "FAIL")) overall = "FAIL";
  else if (pins === undefined || levels.some((l) => l.status === "INDETERMINATE")) overall = "INDETERMINATE";
  return { overall, pinned: pins !== undefined, levels, means: WHAT_PASS_MEANS, doesNotMean: WHAT_PASS_DOES_NOT_MEAN };
}

/** An unexpected exception is a failure, never a pass: a hostile bundle must not be able to crash its way to green. */
function guard(level: Level, body: () => void): void {
  try {
    body();
  } catch (e) {
    level.fail("verifier_exception", e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : "unexpected error");
  }
}

function structure(files: Files, v0: Level): void {
  if (files.size === 0) return v0.fail("empty_bundle", "the bundle contains no files");
  if (files.size > LIMITS.maxFiles) return v0.fail("limit_exceeded", `more than ${LIMITS.maxFiles} files`);
  let total = 0;
  const lower = new Map<string, string>();
  for (const [path, bytes] of files) {
    total += bytes.length;
    if (bytes.length > LIMITS.maxFileBytes) v0.fail("limit_exceeded", `${path.slice(0, 80)} is larger than ${LIMITS.maxFileBytes} bytes`);
    if (path.length > LIMITS.maxPathLength || !SAFE_PATH.test(path) || path.split("/").some((s) => s === "." || s === "..")) {
      v0.fail("unsafe_path", `path ${JSON.stringify(path.slice(0, 80))} is not plain ASCII relative path`);
      continue;
    }
    const key = path.toLowerCase();
    const earlier = lower.get(key);
    if (earlier !== undefined) v0.fail("path_collision", `${path} and ${earlier} differ only by case`);
    lower.set(key, path);
    const top = [FILE_MANIFEST, FILE_STATEMENT, FILE_CLAIMS, FILE_CHECKPOINT, FILE_VERIFY_MD].includes(path);
    if (!top && !ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) v0.fail("unexpected_file", `${path} is not a file a dossier has`);
  }
  if (total > LIMITS.maxTotalBytes) v0.fail("limit_exceeded", `bundle is larger than ${LIMITS.maxTotalBytes} bytes`);
  for (const required of [FILE_MANIFEST, FILE_STATEMENT, FILE_CLAIMS, FILE_CHECKPOINT, FILE_VERIFY_MD]) {
    if (!files.has(required)) v0.fail("missing_file", `${required} is required`);
  }
}

function readJson(files: Files, path: string, v1: Level): unknown {
  const bytes = files.get(path);
  if (!bytes) return undefined;
  try {
    return parseCanonical(text(bytes));
  } catch (e) {
    v1.fail(e instanceof SyntaxError && e.message === "not in canonical form" ? "non_canonical_json" : "malformed_json", `${path}: ${e instanceof Error ? e.message.slice(0, 120) : "unreadable"}`);
    return undefined;
  }
}

function checked<T>(check: Check, value: unknown, path: string, v1: Level): T | undefined {
  const issues = validate(check, value);
  if (issues.length > 0) {
    for (const i of issues.slice(0, 5)) v1.fail("schema", `${path}${i.path.slice(1)}: ${i.message}`);
    return undefined;
  }
  return value as T;
}

function parseAll(files: Files, p: Parsed, v1: Level): void {
  const manifestRaw = readJson(files, FILE_MANIFEST, v1);
  if (manifestRaw !== undefined) {
    const m = checked<Manifest>(MANIFEST_CHECK, manifestRaw, FILE_MANIFEST, v1);
    if (m) {
      p.manifest = m;
      p.manifestBytes = files.get(FILE_MANIFEST) as Uint8Array;
    }
  }

  p.statementEnvelope = readJson(files, FILE_STATEMENT, v1);
  if (p.statementEnvelope !== undefined) {
    const e = p.statementEnvelope as { payload?: unknown };
    const payload = typeof e.payload === "string" ? strictBase64(e.payload) : null;
    if (!payload) v1.fail("schema", `${FILE_STATEMENT}: payload is not strict base64`);
    else {
      try {
        const statement = parseCanonical(text(payload));
        const s = checked<Statement>(STATEMENT_CHECK, statement, "statement", v1);
        if (s) p.statement = s;
      } catch {
        v1.fail("malformed_json", "statement payload is not canonical JSON");
      }
    }
  }

  p.checkpointEnvelope = readJson(files, FILE_CHECKPOINT, v1);
  if (p.checkpointEnvelope !== undefined) {
    const e = p.checkpointEnvelope as { payload?: unknown };
    const payload = typeof e.payload === "string" ? strictBase64(e.payload) : null;
    if (!payload) v1.fail("schema", `${FILE_CHECKPOINT}: payload is not strict base64`);
    else {
      try {
        const c = checked<Checkpoint>(CHECKPOINT_CHECK, parseCanonical(text(payload)), "checkpoint", v1);
        if (c) p.checkpoint = c;
      } catch {
        v1.fail("malformed_json", "checkpoint payload is not canonical JSON");
      }
    }
  }

  const claimsBytes = files.get(FILE_CLAIMS);
  if (claimsBytes) {
    p.claimsBytes = claimsBytes;
    try {
      const lines = parseLines(text(claimsBytes));
      if (lines.length > LIMITS.maxClaims) v1.fail("limit_exceeded", `more than ${LIMITS.maxClaims} claim lines`);
      let sawSentence = false;
      let lastClaimId: string | undefined;
      lines.slice(0, LIMITS.maxClaims).forEach((line, i) => {
        const kind = typeof line === "object" && line !== null ? (line as { type?: unknown }).type : undefined;
        if (kind === "claim") {
          const c = checked<ParsedClaim & { type: string }>(CLAIM_CHECK, line, `claims.jsonl:${i + 1}`, v1);
          if (c) {
            if (sawSentence || (lastClaimId !== undefined && c.id <= lastClaimId)) v1.fail("claims_not_sorted", `claims.jsonl:${i + 1}: claims come first, in ascending id order, then the sentences`);
            lastClaimId = c.id;
            p.claims.push(c);
          }
        } else if (kind === "sentence") {
          sawSentence = true;
          const s = checked<{ text: string; cites: string[]; id: string }>(SENTENCE_CHECK, line, `claims.jsonl:${i + 1}`, v1);
          if (s) p.sentences.push({ text: s.text, cites: s.cites });
        } else v1.fail("schema", `claims.jsonl:${i + 1}: type must be claim or sentence`);
      });
    } catch (e) {
      v1.fail(e instanceof SyntaxError && e.message === "not in canonical form" ? "non_canonical_json" : "malformed_json", `claims.jsonl: ${e instanceof Error ? e.message.slice(0, 120) : "unreadable"}`);
    }
  }

  const proofsRaw = readJson(files, FILE_PROOFS, v1);
  if (proofsRaw !== undefined) p.proofs = checked<Proofs>(PROOFS_CHECK, proofsRaw, FILE_PROOFS, v1);

  for (const [path, bytes] of files) {
    if (path.startsWith("rows/")) {
      const m = /^rows\/([a-z][a-z0-9_]{0,63})\.jsonl$/.exec(path);
      if (!m) {
        v1.fail("schema", `${path}: rows files are named rows/<stream>.jsonl`);
        continue;
      }
      try {
        parseLines(text(bytes)).forEach((line, i) => {
          const row = checked<Row>(ROW_CHECK, line, `${path}:${i + 1}`, v1);
          if (!row) return;
          if (row.stream !== m[1]) return void v1.fail("schema", `${path}:${i + 1}: row.stream ${row.stream} does not match the file`);
          p.rows.push(row);
        });
      } catch (e) {
        v1.fail("malformed_json", `${path}: ${e instanceof Error ? e.message.slice(0, 120) : "unreadable"}`);
      }
    } else if (path.startsWith("price_snapshots/")) {
      const raw = readJson(files, path, v1);
      if (raw === undefined) continue;
      try {
        const snap = parseSnapshot(raw);
        if (`price_snapshots/${snap.snapshotId}.json` !== path) v1.fail("schema", `${path}: snapshotId ${snap.snapshotId} does not match the file name`);
        else p.snapshots.set(snap.snapshotId, snap);
      } catch (e) {
        v1.fail("schema", `${path}: ${e instanceof Error ? e.message.slice(0, 160) : "invalid snapshot"}`);
      }
    } else if (path.startsWith("policy/restrict-")) {
      const raw = readJson(files, path, v1);
      const r = raw === undefined ? undefined : checked<{ from: string; to: string; domain: Record<string, string[]>; result: Record<string, unknown> }>(RESTRICT_CHECK, raw, path, v1);
      if (r) p.restricts.push({ path, value: r });
    } else if (path.startsWith("policy/")) {
      const raw = readJson(files, path, v1);
      const m = /^policy\/([0-9a-f]{64})\.json$/.exec(path);
      if (!m) v1.fail("schema", `${path}: policy files are named policy/<sha256>.json`);
      else if (raw !== undefined) p.policyDocs.set(m[1] as string, raw);
    } else if (path.startsWith("approvals/")) {
      const raw = readJson(files, path, v1);
      if (raw !== undefined) p.approvalEnvelopes.set(path, raw);
    }
  }
  for (const r of p.rows) {
    let byseq = p.rowIndex.get(r.stream);
    if (!byseq) p.rowIndex.set(r.stream, (byseq = new Map()));
    if (!byseq.has(r.seq)) byseq.set(r.seq, r);
  }
}

function hashes(files: Files, p: Parsed, v2: Level): void {
  if (!p.manifest) return v2.unknown("skipped_prerequisite", "no valid manifest");
  const listed = p.manifest.files;
  for (const [path, bytes] of files) {
    if (path === FILE_MANIFEST || path === FILE_STATEMENT) continue;
    const want = listed[path];
    if (want === undefined) v2.fail("unlisted_file", `${path} is not in the manifest`);
    else if (sha256Hex(bytes) !== want) v2.fail("hash_mismatch", `${path} does not match its manifest hash`);
  }
  for (const path of Object.keys(listed)) if (!files.has(path)) v2.fail("missing_file", `${path} is listed in the manifest but absent`);
  if (listed[FILE_MANIFEST] !== undefined || listed[FILE_STATEMENT] !== undefined) v2.fail("manifest_self_reference", "the manifest must not list itself or the statement");

  const seen = new Map<string, Row[]>();
  for (const r of p.rows) seen.set(r.stream, [...(seen.get(r.stream) ?? []), r]);
  for (const [stream, list] of seen) {
    let prev: Row | undefined;
    const seqs = new Set<number>();
    for (const r of list) {
      if (seqs.has(r.seq)) v2.fail("duplicated_row", `${stream}#${r.seq} appears twice`);
      seqs.add(r.seq);
      if (prev && r.seq <= prev.seq) v2.fail("rows_out_of_order", `${stream}#${r.seq} follows #${prev.seq}`);
      if (computeRowHash(r) !== r.row_hash) v2.fail("row_hash_mismatch", `${stream}#${r.seq} does not hash to its row_hash`);
      if (r.seq === 0 && r.prev_hash !== GENESIS_HASH) v2.fail("chain_break", `${stream}#0 must have the genesis prev_hash`);
      if (prev && r.seq === prev.seq + 1 && r.prev_hash !== prev.row_hash) v2.fail("chain_break", `${stream}#${r.seq} does not link to #${prev.seq}`);
      prev = r;
    }
  }
  if (p.rows.length > LIMITS.maxRows) v2.fail("limit_exceeded", "too many rows");

  for (const [path, bytes] of files) {
    if (path.startsWith("evidence/blobs/sha256/") && path !== blobPath(sha256Hex(bytes))) v2.fail("blob_name_mismatch", `${path} is not named by the SHA-256 of its bytes`);
  }
  for (const [hex, doc] of p.policyDocs) {
    let id: string;
    try {
      id = hashJson(doc);
    } catch {
      v2.fail("policy_id_mismatch", `policy/${hex}.json cannot be hashed`);
      continue;
    }
    if (id !== `sha256:${hex}`) v2.fail("policy_id_mismatch", `policy/${hex}.json does not hash to its name`);
  }
}

function decodeAndCheck(envelope: unknown, type: string, keys: ReadonlyMap<string, import("node:crypto").KeyObject>) {
  return checkEnvelope(envelope, type, keys);
}

function signatures(p: Parsed, pinned: boolean, keys: ReadonlyMap<string, import("node:crypto").KeyObject>, v3: Level): void {
  const { manifest, statement } = p;
  if (!manifest || !statement || !p.manifestBytes) return v3.unknown("skipped_prerequisite", "no valid manifest and statement");
  const st = statement;
  if (st.subject[0]?.name !== FILE_MANIFEST) v3.fail("statement_subject", `the subject must be ${FILE_MANIFEST}`);
  if (st.subject[0]?.digest.sha256 !== sha256Hex(p.manifestBytes)) v3.fail("statement_subject", "the statement does not commit to this manifest");
  const pr = st.predicate;
  if (pr.kind !== manifest.kind) v3.fail("predicate_mismatch", "predicate.kind differs from the manifest");
  if (canonicalJson(pr.period) !== canonicalJson(manifest.period)) v3.fail("predicate_mismatch", "predicate.period differs from the manifest");
  if (p.claimsBytes && pr.claims_digest !== sha256Hex(p.claimsBytes)) v3.fail("predicate_mismatch", "predicate.claims_digest does not match claims.jsonl");
  if (p.checkpoint) {
    if (pr.checkpoint_root !== p.checkpoint.root_hash) v3.fail("predicate_mismatch", "predicate.checkpoint_root differs from the checkpoint");
    if (pr.checkpoint_size !== p.checkpoint.size) v3.fail("predicate_mismatch", "predicate.checkpoint_size differs from the checkpoint");
  }
  const sorted = (xs: string[]) => canonicalJson([...xs].sort());
  if (sorted(pr.price_snapshot_ids) !== sorted([...p.snapshots.keys()])) v3.fail("predicate_mismatch", "predicate.price_snapshot_ids differ from the bundled snapshots");
  if (sorted(pr.policy_version_ids) !== sorted([...p.policyDocs.keys()])) v3.fail("predicate_mismatch", "predicate.policy_version_ids differ from the bundled policies");
  const approvalIds = [...(p.approvalEnvelopes.keys() as Iterable<string>)].map((path) => path.replace(/^approvals\//, "").replace(/\.json$/, ""));
  if (sorted(pr.approval_ids) !== sorted(approvalIds)) v3.fail("predicate_mismatch", "predicate.approval_ids differ from the bundled approvals");
  if (pr.action_digest === undefined && approvalIds.length > 0) v3.fail("predicate_mismatch", "approvals are bundled but the statement names no action_digest");
  if (!pinned) return v3.unknown("no_pins", "no pinned keys were given, so the signature is not checked; a verdict of PASS needs --pins");
  const sig = decodeAndCheck(p.statementEnvelope, PAYLOAD_TYPE_STATEMENT, keys);
  if (!sig.ok) return v3.fail("ATTESTATION_VERIFICATION_FAILED", `${sig.code}: ${sig.detail}`);
  if (sig.keyid !== manifest.signer_keyid) v3.fail("signer_mismatch", "the statement is signed by a different key than the manifest names");
}

function inclusion(p: Parsed, pinned: boolean, keys: ReadonlyMap<string, import("node:crypto").KeyObject>, v4: Level): void {
  const { checkpoint, proofs } = p;
  if (!checkpoint || !proofs) return v4.unknown("skipped_prerequisite", "no valid checkpoint and proofs");
  if (!pinned) v4.unknown("no_pins", "the checkpoint signature is not checked without pinned keys");
  else {
    const sig = decodeAndCheck(p.checkpointEnvelope, PAYLOAD_TYPE_CHECKPOINT, keys);
    if (!sig.ok) v4.fail("ATTESTATION_VERIFICATION_FAILED", `checkpoint ${sig.code}: ${sig.detail}`);
    else if (p.manifest && sig.keyid !== p.manifest.signer_keyid) v4.fail("signer_mismatch", "the checkpoint is signed by a different key than the manifest names");
  }
  if (proofs.size !== checkpoint.size) v4.fail("proof_checkpoint_mismatch", "proofs.size differs from the checkpoint size");
  if (proofs.root !== checkpoint.root_hash) v4.fail("proof_checkpoint_mismatch", "proofs.root differs from the checkpoint root");
  const byKey = new Map<string, Proofs["proofs"][number]>();
  const indexes = new Set<number>();
  for (const pr of proofs.proofs) {
    const key = `${pr.stream}#${pr.seq}`;
    if (byKey.has(key)) v4.fail("duplicate_proof", `two proofs for ${key}`);
    byKey.set(key, pr);
    if (indexes.has(pr.global_index)) v4.fail("duplicate_proof", `two rows claim leaf ${pr.global_index}`);
    indexes.add(pr.global_index);
    if (!p.rowIndex.get(pr.stream)?.has(pr.seq)) v4.fail("proof_for_unknown_row", `${key} has a proof but no row in the bundle`);
  }
  const root = Buffer.from(checkpoint.root_hash, "hex");
  for (const r of p.rows) {
    const key = `${r.stream}#${r.seq}`;
    const pr = byKey.get(key);
    if (!pr) {
      v4.fail("proof_missing", `${key} has no inclusion proof`);
      continue;
    }
    if (pr.row_hash !== r.row_hash) v4.fail("proof_row_mismatch", `${key}: the proof is for a different row`);
    else if (!verifyInclusion(leafHash(Buffer.from(r.row_hash, "hex")), pr.global_index, checkpoint.size, pr.path.map((h) => Buffer.from(h, "hex")), root)) {
      v4.fail("inclusion_proof_invalid", `${key} is not included in the signed checkpoint`);
    }
    const head = checkpoint.heads[r.stream];
    if (!head) v4.fail("row_beyond_head", `${key}: the checkpoint has no stream ${r.stream}`);
    else if (r.seq > head.seq) v4.fail("row_beyond_head", `${key} is later than the checkpoint head #${head.seq}`);
    else if (r.seq === head.seq && r.row_hash !== head.row_hash) v4.fail("head_mismatch", `${key} differs from the checkpoint head`);
  }
  if (p.rows.length === 0) v4.note("no rows are cited, so there are no inclusion proofs to check");
}

function normalise(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

function quotes(files: Files, p: Parsed, v5: Level): void {
  const quoteClaims = p.claims.filter((c) => c.kind === "quote");
  if (quoteClaims.length === 0) return v5.na("the dossier cites no quotes");
  const redacted = p.manifest?.disclosure === "redacted";
  let unchecked = 0;
  for (const c of quoteClaims) {
    if (!c.support) {
      if (redacted && c.quote_sha256) {
        unchecked += 1;
        continue;
      }
      v5.fail("quote_unlocated", `claim ${c.id} is a quote with no source locator`);
      continue;
    }
    const blob = files.get(blobPath(c.support.blob));
    if (!blob) {
      if (redacted) unchecked += 1;
      else v5.fail("blob_missing", `claim ${c.id} cites evidence ${c.support.blob.slice(0, 12)} that is not in the bundle`);
      continue;
    }
    const { start, end } = c.support;
    if (end < start || end > blob.length) {
      v5.fail("quote_span_invalid", `claim ${c.id}: span ${start}..${end} lies outside the evidence`);
      continue;
    }
    let span: string;
    try {
      text(blob);
      span = text(blob.subarray(start, end));
    } catch {
      v5.fail("quote_span_invalid", `claim ${c.id}: the span does not fall on character boundaries of valid UTF-8`);
      continue;
    }
    let found: "exact" | "normalised" | "absent" = "absent";
    if (span === c.text) found = "exact";
    else if (normalise(span) === normalise(c.text)) found = "normalised";
    if (found === "absent") {
      const elsewhere = text(blob).includes(c.text);
      v5.fail(elsewhere ? "quote_outside_span" : "quote_absent", `claim ${c.id}: the quoted text is ${elsewhere ? "in the evidence but not at the cited span" : "not in the evidence"}`);
    } else if (found !== c.support.status) v5.fail("quote_status_mismatch", `claim ${c.id}: recorded as ${c.support.status}, recomputed as ${found}`);
  }
  if (unchecked > 0) v5.note(`${unchecked} quote(s) cannot be re-checked at this disclosure level (evidence is withheld)`);
  if (unchecked === quoteClaims.length) v5.na("every quote is withheld at this disclosure level");
}

function compEnv(p: Parsed): CompEnv {
  const policies = new Map<string, Policy>();
  for (const [hex, doc] of p.policyDocs) {
    try {
      policies.set(`sha256:${hex}`, parsePolicy(doc));
      policies.set(hex, parsePolicy(doc));
    } catch {
      /* reported by V7-D */
    }
  }
  return { rows: p.rowIndex, snapshots: p.snapshots, policies };
}

function displayEquals(value: number | undefined, computed: number, decimals: number, divisor: number): boolean {
  if (value === undefined) return false;
  const scaled = value * 10 ** decimals;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-6) return false;
  if (computed < 0) {
    const mag = divRoundBig(BigInt(-computed) * 10n ** BigInt(decimals), BigInt(divisor));
    return BigInt(rounded) === -mag;
  }
  return BigInt(rounded) === divRoundBig(BigInt(computed) * 10n ** BigInt(decimals), BigInt(divisor));
}

function recompute(p: Parsed, v6: Level, ok: Set<string>): void {
  if (!p.manifest) return v6.unknown("skipped_prerequisite", "no valid manifest");
  const env = compEnv(p);
  const used = new Set<string>();
  let any = false;
  for (const c of p.claims) {
    if (!c.computation) continue;
    any = true;
    const spec = c.computation as CompSpec;
    used.add(spec.fn);
    if (!knownComputation(spec.fn)) {
      v6.unknown("unknown_computation", `claim ${c.id} cites ${spec.fn}, which this verifier cannot recompute`);
      continue;
    }
    let out;
    try {
      out = runComputation(spec, env);
    } catch (e) {
      if (e instanceof ComputationError) v6.fail(e.code, `claim ${c.id}: ${e.message}`);
      else throw e;
      continue;
    }
    const decimals = c.decimals ?? 0;
    const divisor = c.divisor ?? 1;
    let good = true;
    const value = out.values["value"] as number;
    if (!displayEquals(c.value, value, decimals, divisor)) {
      v6.fail("value_mismatch", `claim ${c.id}: shows ${String(c.value)} but ${spec.fn} computes ${value}/${divisor} to ${decimals} decimals`);
      good = false;
    }
    if (c.interval) {
      const low = out.values["low"];
      const high = out.values["high"];
      if (low === undefined || high === undefined) {
        v6.fail("interval_unsupported", `claim ${c.id}: ${spec.fn} produces no interval`);
        good = false;
      } else if (!displayEquals(c.interval.low, low, decimals, divisor) || !displayEquals(c.interval.high, high, decimals, divisor)) {
        v6.fail("interval_mismatch", `claim ${c.id}: the interval differs from the recomputed one`);
        good = false;
      } else if (spec.fn === "paired_diff_ci@1" && c.interval.level !== (spec.args["level_bp"] as number) / 100) {
        v6.fail("interval_mismatch", `claim ${c.id}: the stated level differs from level_bp`);
        good = false;
      }
    }
    if (c.class !== undefined && !out.allowedClasses.includes(c.class)) {
      v6.fail("class_not_supported", `claim ${c.id}: labelled ${c.class}, but ${spec.fn} can only support ${out.allowedClasses.length > 0 ? out.allowedClasses.join("/") : "no class"}`);
      good = false;
    }
    if (good) ok.add(c.id);
  }
  const listed = [...p.manifest.computations].sort();
  const actual = [...used].sort();
  if (canonicalJson(listed) !== canonicalJson(actual)) v6.fail("computation_list_mismatch", `manifest lists ${JSON.stringify(listed)} but the claims use ${JSON.stringify(actual)}`);
  if (!any) v6.na("no claim cites a computation");
}

export function normalisedRestrict(prev: Policy, next: Policy, domain: Record<string, readonly string[]>): Record<string, unknown> {
  const r = restrictCheck(prev, next, domain);
  return {
    narrows: r.narrows,
    grid_size: r.gridSize,
    outside_fragment: r.outsideFragment,
    merged_dims: [...r.mergedDims].sort(),
    route_changes: r.routeChanges.length,
    widening: r.widening ? { description: describeWidening(r.widening), was: r.widening.was, now: r.widening.now } : null,
  };
}

function restrictLevel(p: Parsed, v7: Level): void {
  const parsed = new Map<string, Policy>();
  for (const [hex, doc] of p.policyDocs) {
    try {
      parsed.set(hex, parsePolicy(doc));
    } catch (e) {
      v7.fail("policy_unparseable", `policy/${hex}.json: ${e instanceof Error ? e.message.slice(0, 160) : "invalid policy"}`);
    }
  }
  if (p.restricts.length === 0) return v7.na("no policy change is recorded");
  for (const { path, value } of p.restricts) {
    const prev = parsed.get(value.from);
    const next = parsed.get(value.to);
    if (!prev || !next) {
      v7.fail("policy_missing", `${path} names a policy that is not bundled`);
      continue;
    }
    if (path !== `policy/restrict-${value.to}.json`) v7.fail("restrict_name", `${path} must be named by its target policy`);
    const again = normalisedRestrict(prev, next, value.domain);
    if (again["narrows"] === false) v7.note(`${path}: this change WIDENS the policy (${(again["widening"] as { description: string } | null)?.description ?? "no counterexample"})`);
    if (canonicalJson(again) !== canonicalJson(value.result)) v7.fail("restrict_mismatch", `${path}: the recorded check differs from a fresh run (fresh narrows=${String(again["narrows"])})`);
  }
}

function claimLedger(p: Parsed, v6ok: ReadonlySet<string>, v8: Level): void {
  const ledger = new ClaimLedger();
  for (const c of p.claims) {
    if (c.kind === "number" || c.kind === "comparison") {
      if (!c.computation) v8.fail("number_without_computation", `claim ${c.id} states a figure with no computation behind it`);
      else if (!v6ok.has(c.id) && knownComputation(c.computation.fn)) v8.fail("claim_not_reproduced", `claim ${c.id} was not reproduced by V6-D`);
      else if (!knownComputation(c.computation.fn)) v8.unknown("unknown_computation", `claim ${c.id}`);
    } else if (!c.computation && extractNumbers(c.text).length > 0 && c.kind !== "quote") {
      v8.fail("number_without_computation", `claim ${c.id} contains a figure but names no computation`);
    }
    const claim: Claim = { id: c.id, kind: c.kind as Claim["kind"], text: c.text, source: c.computation?.fn ?? "none" };
    if (c.value !== undefined) claim.value = c.value;
    if (c.unit !== undefined) claim.unit = c.unit as NonNullable<Claim["unit"]>;
    if (c.class !== undefined) claim.class = c.class as NonNullable<Claim["class"]>;
    if (c.interval) claim.interval = c.interval;
    try {
      ledger.add(claim);
    } catch {
      v8.fail("duplicate_claim_id", `claim id ${c.id} appears twice`);
    }
  }
  if (p.sentences.length === 0) return v8.na("the dossier displays no sentences");
  for (const s of p.sentences) figureProblems(s, ledger, v8);
  for (const rej of auditSentences(p.sentences, ledger).rejected) {
    v8.fail(rej.reason, `"${rej.sentence.text.slice(0, 80)}": ${rej.detail}`);
  }
  // Which of the cited claims each sentence needs, by taking each away and asking the Auditor again. A reading, not a verdict: a decorative citation does not make a dossier wrong.
  if (v8.findings.length === 0) v8.note(`citations: ${describeFaithfulness(citationFaithfulness(p.sentences, ledger))}`);
}

/**
 * Gaps the code Auditor leaves, closed here so that a dossier cannot slip a figure past it: digits that are not
 * ASCII (the Auditor does not see them) and negative figures (its pattern skips a number that follows a minus sign).
 */
function figureProblems(sentence: Sentence, ledger: ClaimLedger, v8: Level): void {
  const label = `"${sentence.text.slice(0, 80)}"`;
  for (const ch of sentence.text) {
    if ((/\p{Nd}/u.test(ch) && !/[0-9]/.test(ch)) || "＄％＋－．，".includes(ch)) {
      v8.fail("non_ascii_figure", `${label} writes a figure with non-ASCII digits or symbols, which the figure check cannot read`);
      break;
    }
  }
  const cited = sentence.cites.map((id) => ledger.get(id)).filter((c): c is Claim => c !== undefined);
  for (const m of sentence.text.matchAll(/(?<![\p{L}\p{N}_.])[-−](\s?)(\$?)(\d[\d,]*(?:\.\d+)?)(%?)/gu)) {
    const digits = (m[3] as string).replace(/,/g, "");
    const decimals = digits.includes(".") ? digits.split(".")[1]!.length : 0;
    const magnitude = Number(digits);
    const tolerance = 0.5 * 10 ** -decimals + 1e-9;
    const unit = m[2] ? "usd" : m[4] ? "pct" : null;
    const ok = cited.some((c) => c.value !== undefined && Math.abs(c.value + magnitude) <= tolerance && (unit === null ? c.unit !== "usd" && c.unit !== "pct" : c.unit === unit || (unit === "pct" && c.unit === "ratio")));
    if (!ok) v8.fail("signed_number_unmatched", `${label}: -${m[2]}${m[3]}${m[4]} matches no cited claim of that sign`);
  }
}

function approvals(p: Parsed, pinned: boolean, keys: ReadonlyMap<string, import("node:crypto").KeyObject>, va: Level): void {
  const kind = p.manifest?.kind;
  const actionDigest = p.statement?.predicate.action_digest;
  if (p.approvalEnvelopes.size === 0) {
    if (kind === "policy_change") va.fail("approval_missing", "a policy-change dossier needs an approval receipt");
    else va.na("this dossier records no approval");
    return;
  }
  if (!pinned) va.unknown("no_pins", "approval signatures are not checked without pinned keys");
  for (const [path, envelope] of p.approvalEnvelopes) {
    let payload: Buffer | undefined;
    if (pinned) {
      const sig = decodeAndCheck(envelope, PAYLOAD_TYPE_APPROVAL, keys);
      if (!sig.ok) {
        va.fail("ATTESTATION_VERIFICATION_FAILED", `${path}: ${sig.code}: ${sig.detail}`);
        continue;
      }
      payload = sig.payload;
    } else {
      const e = envelope as { payload?: unknown };
      payload = typeof e.payload === "string" ? (strictBase64(e.payload) ?? undefined) : undefined;
      if (!payload) {
        va.fail("envelope_malformed", `${path}: payload is not strict base64`);
        continue;
      }
    }
    let receipt: Record<string, unknown>;
    try {
      const raw = parseCanonical(text(payload));
      const issues = validate(APPROVAL_CHECK, raw);
      if (issues.length > 0) {
        va.fail("schema", `${path}: ${issues[0]?.path.slice(1)} ${issues[0]?.message}`);
        continue;
      }
      receipt = raw as Record<string, unknown>;
    } catch {
      va.fail("malformed_json", `${path}: the receipt is not canonical JSON`);
      continue;
    }
    if (path !== `approvals/${receipt["approval_request_id"] as string}.json`) va.fail("approval_name", `${path} does not match its approval_request_id`);
    if (receipt["action_digest"] !== actionDigest) va.fail("approval_digest_mismatch", `${path}: the approval is for a different action than the one this dossier records`);
    const known = [...p.policyDocs.keys()].map((h) => `sha256:${h}`);
    if (!known.includes(receipt["policy_version"] as string)) va.fail("approval_policy_unknown", `${path}: the approved policy version is not bundled`);
  }
  if (kind === "policy_change" && actionDigest === undefined) va.fail("approval_missing", "the statement names no action_digest");
}

