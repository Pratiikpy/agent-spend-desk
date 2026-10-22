import { canonicalJson, hashJson, sha256Hex } from "../../runtime/canonical.ts";
import { parsePolicy } from "../policy/parse.ts";
import type { Policy } from "../policy/types.ts";
import { parseSnapshot, type PriceSnapshot } from "../pricing/pricebook.ts";
import { divRoundBig, runComputation, selectRows, type CompEnv, type CompSpec } from "../verify/computations.ts";
import type { Envelope, Pins } from "../verify/dsse.ts";
import {
  FILE_CHECKPOINT, FILE_CLAIMS, FILE_MANIFEST, FILE_PROOFS, FILE_STATEMENT, FILE_VERIFY_MD, MANIFEST_SCHEMA, PAYLOAD_TYPE_CHECKPOINT, PAYLOAD_TYPE_STATEMENT, PREDICATE_TYPE,
  STATEMENT_TYPE, blobPath, computeRowHash, policyPath, restrictPath, rowsPath, snapshotPath, type DossierKind, type Row,
} from "../verify/format.ts";
import { normalisedRestrict, verifyBundle, type Files } from "../verify/verify.ts";
import type { Signer } from "./keys.ts";
import { inclusionPath, merkleTreeHash } from "./merkle-build.ts";
import { signEnvelope } from "./sign.ts";
import { VERIFY_MD } from "./verify-md.ts";

export class BuildError extends Error {}

export interface ClaimInput {
  id: string;
  kind: "number" | "fact" | "comparison" | "quote";
  /** The statement of what is true; for a quote, the exact quoted text. */
  text: string;
  unit?: "usd" | "pct" | "count" | "ratio" | "none";
  class?: "billed" | "reported" | "estimated" | "unpriced" | "cassette" | "computed";
  /** Display decimals and the divisor from the computed integer (1e6 for micro-USD to USD, 100 for basis points to percent). */
  decimals?: number;
  divisor?: number;
  computation?: CompSpec;
  /** A comparison also publishes the interval its computation yields. */
  withInterval?: boolean;
  /** Quotes: the source bytes the quote is taken from. */
  evidence?: Uint8Array;
  /** Quotes: an explicit byte span; without it the first exact occurrence is used. */
  span?: { start: number; end: number };
}

export interface SentenceInput {
  id: string;
  text: string;
  cites: string[];
}

export interface PolicyInput {
  docs: unknown[];
  changes: { from: string; to: string; domain?: Record<string, string[]> }[];
}

export interface DossierMeta {
  kind: DossierKind;
  tenant: string;
  period: { from: string; to: string };
  createdAt: string;
  audience: "reviewer" | "auditor" | "counterparty";
  disclosure: "full" | "redacted";
}

export interface DossierInput extends DossierMeta {
  /** The whole ordered log the checkpoint covers; the leaf order is the array order. */
  log: readonly Row[];
  claims: ClaimInput[];
  sentences?: SentenceInput[];
  snapshots?: PriceSnapshot[];
  policies?: PolicyInput;
  /** Signed approval receipts (DSSE envelopes) to bundle. */
  approvals?: { requestId: string; envelope: Envelope }[];
  actionDigest?: string;
  signer: Signer;
  /** Rows to include beyond those the computations cite. */
  extraRows?: { stream: string; seq: number }[];
  /** Verify the result with the issuer's own pin before returning it. On by default. */
  selfCheck?: boolean;
}

const enc = new TextEncoder();

export function policyId(doc: unknown): string {
  return hashJson(doc);
}

function json(value: unknown): Uint8Array {
  return enc.encode(canonicalJson(value));
}

function lines(values: unknown[]): Uint8Array {
  return enc.encode(values.map((v) => canonicalJson(v) + "\n").join(""));
}

function display(computed: number, decimals: number, divisor: number): number {
  const neg = computed < 0;
  const mag = divRoundBig(BigInt(Math.abs(computed)) * 10n ** BigInt(decimals), BigInt(divisor));
  const n = Number(mag) / 10 ** decimals;
  return neg ? -n : n;
}

function envFor(log: readonly Row[], snapshots: readonly PriceSnapshot[], policies: ReadonlyMap<string, Policy>): CompEnv {
  const rows = new Map<string, Map<number, Row>>();
  for (const r of log) {
    let m = rows.get(r.stream);
    if (!m) rows.set(r.stream, (m = new Map()));
    m.set(r.seq, r);
  }
  return { rows, snapshots: new Map(snapshots.map((s) => [s.snapshotId, s])), policies };
}

function assertLogConsistent(log: readonly Row[]): void {
  const heads = new Map<string, Row>();
  for (const r of log) {
    if (computeRowHash(r) !== r.row_hash) throw new BuildError(`log row ${r.stream}#${r.seq} does not hash to its row_hash`);
    const prev = heads.get(r.stream);
    if (prev ? r.seq !== prev.seq + 1 || r.prev_hash !== prev.row_hash : r.seq !== 0) throw new BuildError(`log stream ${r.stream} is not a contiguous chain at #${r.seq}`);
    heads.set(r.stream, r);
  }
}

/** Where a quote sits in its evidence, as UTF-8 byte offsets. Only an exact occurrence is located; a quote that is not there is refused. */
function locateQuote(evidence: Uint8Array, quote: string, span?: { start: number; end: number }): { start: number; end: number } {
  if (span) return span;
  const source = new TextDecoder("utf-8", { fatal: true }).decode(evidence);
  const at = source.indexOf(quote);
  if (at < 0) throw new BuildError(`quote ${JSON.stringify(quote.slice(0, 60))} is not in its evidence`);
  const start = Buffer.byteLength(source.slice(0, at));
  return { start, end: start + Buffer.byteLength(quote) };
}

function normalise(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

export interface Assembled {
  content: Map<string, Uint8Array>;
  meta: DossierMeta;
  computations: string[];
  actionDigest?: string;
}

/** Everything except the manifest and the signed statement. */
export function buildContent(input: DossierInput): Assembled {
  assertLogConsistent(input.log);
  const snapshots = (input.snapshots ?? []).map((s) => parseSnapshot(JSON.parse(JSON.stringify(s))));
  const policyDocs = input.policies?.docs ?? [];
  const parsedPolicies = new Map<string, Policy>();
  for (const doc of policyDocs) {
    const id = policyId(doc);
    let p: Policy;
    try {
      p = parsePolicy(doc);
    } catch (e) {
      throw new BuildError(`policy ${id} does not parse: ${e instanceof Error ? e.message : "invalid"}`);
    }
    parsedPolicies.set(id, p);
    parsedPolicies.set(id.slice("sha256:".length), p);
  }
  const env = envFor(input.log, snapshots, parsedPolicies);
  const content = new Map<string, Uint8Array>();

  const ids = new Set<string>();
  const claimLines: unknown[] = [];
  const cited = new Map<string, Row>();
  const fns = new Set<string>();
  const blobs = new Map<string, Uint8Array>();
  for (const c of input.claims) {
    if (ids.has(c.id)) throw new BuildError(`claim id ${c.id} is used twice`);
    ids.add(c.id);
    const line: Record<string, unknown> = { type: "claim", id: c.id, kind: c.kind, text: c.text };
    if (c.unit !== undefined) line["unit"] = c.unit;
    if (c.class !== undefined) line["class"] = c.class;
    if (c.kind === "quote") {
      if (!c.evidence) throw new BuildError(`quote claim ${c.id} needs its evidence`);
      const span = locateQuote(c.evidence, c.text, c.span);
      const spanText = new TextDecoder("utf-8", { fatal: true }).decode(c.evidence.subarray(span.start, span.end));
      const status = spanText === c.text ? "exact" : normalise(spanText) === normalise(c.text) ? "normalised" : null;
      if (status === null) throw new BuildError(`quote claim ${c.id}: the cited span does not hold the quote`);
      const blob = sha256Hex(c.evidence);
      if (input.disclosure === "full") {
        blobs.set(blob, c.evidence);
        line["support"] = { blob, start: span.start, end: span.end, status };
      } else {
        line["text"] = "[withheld]";
        line["quote_sha256"] = sha256Hex(enc.encode(c.text));
      }
    }
    if (c.computation) {
      const spec = c.computation;
      fns.add(spec.fn);
      let out;
      try {
        out = runComputation(spec, env);
      } catch (e) {
        throw new BuildError(`claim ${c.id}: ${e instanceof Error ? e.message : "computation failed"}`);
      }
      if (c.class !== undefined && !out.allowedClasses.includes(c.class)) {
        throw new BuildError(`claim ${c.id}: ${spec.fn} cannot support class ${c.class}`);
      }
      const decimals = c.decimals ?? 0;
      const divisor = c.divisor ?? 1;
      line["decimals"] = decimals;
      line["divisor"] = divisor;
      line["value"] = display(out.values["value"] as number, decimals, divisor);
      if (c.withInterval) {
        if (out.values["low"] === undefined || out.values["high"] === undefined) throw new BuildError(`claim ${c.id}: ${spec.fn} produces no interval`);
        line["interval"] = {
          low: display(out.values["low"], decimals, divisor),
          high: display(out.values["high"], decimals, divisor),
          level: typeof spec.args["level_bp"] === "number" ? spec.args["level_bp"] / 100 : 0,
        };
      }
      line["computation"] = { fn: spec.fn, args: spec.args, ...(spec.range ? { range: spec.range } : {}), ...(spec.rows ? { rows: spec.rows } : {}) };
      if (spec.range || spec.rows) for (const r of selectRows(spec, env)) cited.set(`${r.stream}#${r.seq}`, r);
    }
    claimLines.push(line);
  }
  for (const ref of input.extraRows ?? []) {
    const r = env.rows.get(ref.stream)?.get(ref.seq);
    if (!r) throw new BuildError(`extra row ${ref.stream}#${ref.seq} is not in the log`);
    cited.set(`${ref.stream}#${ref.seq}`, r);
  }
  claimLines.sort((x, y) => ((x as { id: string }).id < (y as { id: string }).id ? -1 : (x as { id: string }).id > (y as { id: string }).id ? 1 : 0));
  for (const s of input.sentences ?? []) {
    if (ids.has(s.id)) throw new BuildError(`id ${s.id} is used twice`);
    ids.add(s.id);
    claimLines.push({ type: "sentence", id: s.id, text: s.text, cites: s.cites });
  }
  content.set(FILE_CLAIMS, lines(claimLines));

  const byStream = new Map<string, Row[]>();
  for (const r of cited.values()) byStream.set(r.stream, [...(byStream.get(r.stream) ?? []), r]);
  for (const [stream, rows] of byStream) content.set(rowsPath(stream), lines(rows.sort((a, b) => a.seq - b.seq)));

  const leaves = input.log.map((r) => Buffer.from(r.row_hash, "hex"));
  const root = merkleTreeHash(leaves);
  const heads: Record<string, { seq: number; row_hash: string }> = {};
  for (const r of input.log) heads[r.stream] = { seq: r.seq, row_hash: r.row_hash };
  const index = new Map(input.log.map((r, i) => [`${r.stream}#${r.seq}`, i]));
  const proofs = [...cited.values()]
    .map((r) => {
      const i = index.get(`${r.stream}#${r.seq}`) as number;
      return { global_index: i, stream: r.stream, seq: r.seq, row_hash: r.row_hash, path: inclusionPath(i, leaves).map((b) => b.toString("hex")) };
    })
    .sort((a, b) => a.global_index - b.global_index);
  content.set(FILE_PROOFS, json({ size: leaves.length, root: root.toString("hex"), proofs }));
  const checkpoint = { origin: "desk-log", size: leaves.length, root_hash: root.toString("hex"), heads, timestamp: input.createdAt };
  content.set(FILE_CHECKPOINT, json(signEnvelope(PAYLOAD_TYPE_CHECKPOINT, json(checkpoint), input.signer)));

  for (const s of snapshots) content.set(snapshotPath(s.snapshotId), json(s));
  for (const doc of policyDocs) content.set(policyPath(policyId(doc).slice("sha256:".length)), json(doc));
  for (const ch of input.policies?.changes ?? []) {
    const prev = parsedPolicies.get(ch.from);
    const next = parsedPolicies.get(ch.to);
    if (!prev || !next) throw new BuildError(`policy change ${ch.from} -> ${ch.to} names a policy that was not given`);
    const domain = ch.domain ?? {};
    content.set(
      restrictPath(ch.to.slice("sha256:".length)),
      json({ from: ch.from.slice("sha256:".length), to: ch.to.slice("sha256:".length), domain, result: normalisedRestrict(prev, next, domain) }),
    );
  }
  for (const [hex, bytes] of blobs) content.set(blobPath(hex), bytes);
  for (const a of input.approvals ?? []) content.set(`approvals/${a.requestId}.json`, json(a.envelope));
  content.set(FILE_VERIFY_MD, enc.encode(VERIFY_MD));
  return { content, meta: input, computations: [...fns].sort(), ...(input.actionDigest ? { actionDigest: input.actionDigest } : {}) };
}

/**
 * Add the manifest (hash of every other file) and the signed in-toto statement over the manifest. Exported so
 * tests can re-sign a tampered bundle exactly as a dishonest issuer holding the key would.
 */
export function assemble(a: Assembled, signer: Signer): Map<string, Uint8Array> {
  const files = new Map(a.content);
  const listed: Record<string, string> = {};
  for (const [path, bytes] of files) listed[path] = sha256Hex(bytes);
  const manifest = {
    schema: MANIFEST_SCHEMA,
    kind: a.meta.kind,
    tenant: a.meta.tenant,
    period: a.meta.period,
    created_at: a.meta.createdAt,
    audience: a.meta.audience,
    disclosure: a.meta.disclosure,
    signer_keyid: signer.keyid,
    files: listed,
    computations: a.computations,
  };
  const manifestBytes = json(manifest);
  files.set(FILE_MANIFEST, manifestBytes);

  const checkpointEnvelope = JSON.parse(new TextDecoder().decode(files.get(FILE_CHECKPOINT))) as Envelope;
  const checkpoint = JSON.parse(Buffer.from(checkpointEnvelope.payload, "base64").toString("utf8")) as { root_hash: string; size: number };
  const idsUnder = (prefix: string, re: RegExp): string[] =>
    [...files.keys()].filter((p) => p.startsWith(prefix)).flatMap((p) => {
      const m = re.exec(p);
      return m ? [m[1] as string] : [];
    });
  const statement = {
    _type: STATEMENT_TYPE,
    subject: [{ name: FILE_MANIFEST, digest: { sha256: sha256Hex(manifestBytes) } }],
    predicateType: PREDICATE_TYPE,
    predicate: {
      kind: a.meta.kind,
      period: a.meta.period,
      checkpoint_root: checkpoint.root_hash,
      checkpoint_size: checkpoint.size,
      claims_digest: sha256Hex(files.get(FILE_CLAIMS) as Uint8Array),
      price_snapshot_ids: idsUnder("price_snapshots/", /^price_snapshots\/(.+)\.json$/).sort(),
      policy_version_ids: idsUnder("policy/", /^policy\/([0-9a-f]{64})\.json$/).sort(),
      approval_ids: idsUnder("approvals/", /^approvals\/(.+)\.json$/).sort(),
      ...(a.actionDigest ? { action_digest: a.actionDigest } : {}),
    },
  };
  files.set(FILE_STATEMENT, json(signEnvelope(PAYLOAD_TYPE_STATEMENT, json(statement), signer)));
  return files;
}

export function buildDossier(input: DossierInput): { files: Files & Map<string, Uint8Array>; pins: Pins } {
  const assembled = buildContent(input);
  const files = assemble(assembled, input.signer);
  const pins: Pins = { version: 1, keys: [{ keyid: input.signer.keyid, publicKey: input.signer.publicKey }] };
  if (input.selfCheck !== false) {
    const report = verifyBundle(files, { pins });
    if (report.overall !== "PASS") {
      const why = report.levels.flatMap((l) => l.findings.map((f) => `${l.id} ${f.code}: ${f.detail}`)).slice(0, 4);
      throw new BuildError(`the dossier does not verify (${report.overall}): ${why.join("; ") || "indeterminate"}`);
    }
  }
  return { files, pins };
}
