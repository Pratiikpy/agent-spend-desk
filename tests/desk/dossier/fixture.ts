import { DatabaseSync } from "node:sqlite";

import { ApprovalService, digestOfAction, type Action } from "../../../src/desk/dossier/approval.ts";
import { buildContent, buildDossier, policyId, type Assembled, type DossierInput } from "../../../src/desk/dossier/build.ts";
import { ephemeralSigner, pinsFor, type Signer } from "../../../src/desk/dossier/keys.ts";
import { MemoryLog } from "../../../src/desk/dossier/log.ts";
import { listPriceCost } from "../../../src/desk/cost/cost.ts";
import { resolvePrice } from "../../../src/desk/pricing/pricebook.ts";
import type { Pins } from "../../../src/desk/verify/dsse.ts";
import type { Row } from "../../../src/desk/verify/format.ts";
import { testSnapshot } from "../helpers.ts";

export const EVIDENCE_TEXT = "Order form\nplan: team seats for the whole engineering group\nrenewal: annual\n";
export const QUOTE = "team seats for the whole engineering group";

export const POLICY_PREV = { version: 1, rules: [{ id: "allow-all", kind: "permit", when: {} }] };
export const POLICY_NEXT = {
  version: 2,
  rules: [
    { id: "allow-all", kind: "permit", when: {} },
    { id: "stop-loops", kind: "forbid", when: { waste_rule: { in: ["C-LOOP-1"] }, recoverable_usd: { gt: "2.00" } }, action: "pause_with_checkpoint" },
  ],
};
/** Removes the forbid but adds a permit with no restriction: a widening of POLICY_NEXT. */
export const POLICY_WIDER = { version: 3, rules: [{ id: "allow-all", kind: "permit", when: {} }] };

const CALLS = [
  { model: "claude-opus-5", input: 120_000, output: 4_000, read: 800_000, w5: 30_000, w1: 0, waste: "none" },
  { model: "claude-opus-5", input: 90_000, output: 2_500, read: 950_000, w5: 0, w1: 10_000, waste: "C-LOOP-1" },
  { model: "claude-sonnet-5-5", input: 40_000, output: 9_000, read: 100_000, w5: 5_000, w1: 0, waste: "none" },
  { model: "claude-opus-5", input: 1_000, output: 200, read: 0, w5: 0, w1: 0, waste: "none" },
  { model: "claude-sonnet-5-5", input: 77_777, output: 1_234, read: 321_000, w5: 12_345, w1: 0, waste: "C-LOOP-1" },
  { model: "sonnet", input: 5_000, output: 500, read: 0, w5: 0, w1: 0, waste: "none" },
  { model: "claude-opus-5", input: 60_000, output: 6_000, read: 600_000, w5: 0, w1: 0, waste: "none" },
  { model: "claude-opus-5", input: 3, output: 1, read: 0, w5: 0, w1: 0, waste: "none" },
] as const;

export interface Fixture {
  signer: Signer;
  pins: Pins;
  log: MemoryLog;
  input: DossierInput;
  files: Map<string, Uint8Array>;
  assembled: Assembled;
  totalMicros: number;
  loopMicros: number;
  callCount: number;
  ids: { prev: string; next: string };
  approvalRequestId?: string;
}

export interface FixtureOptions {
  kind?: "month_bill" | "policy_change";
  disclosure?: "full" | "redacted";
  signer?: Signer;
  withApproval?: boolean;
  extraClaims?: DossierInput["claims"];
  extraSentences?: NonNullable<DossierInput["sentences"]>;
  mutateInput?: (input: DossierInput) => void;
}

/** A dossier that exercises every computation, a quote, a policy change and an approval. */
export function makeFixture(opts: FixtureOptions = {}): Fixture {
  const signer = opts.signer ?? ephemeralSigner();
  const snapshot = testSnapshot();
  const log = new MemoryLog();
  let total = 0;
  let loop = 0;
  CALLS.forEach((c, i) => {
    const price = resolvePrice(snapshot, c.model);
    const cost = price.kind === "priced" ? listPriceCost({ inputTokens: c.input, outputTokens: c.output, cacheReadTokens: c.read, cacheWrite5mTokens: c.w5, cacheWrite1hTokens: c.w1 }, price.row).totalMicros : 0;
    total += cost;
    if (c.waste === "C-LOOP-1") loop += cost;
    log.append("model_call", "call", {
      model: c.model,
      snapshot_id: snapshot.snapshotId,
      input_tokens: c.input,
      output_tokens: c.output,
      cache_read_tokens: c.read,
      cache_write_5m_tokens: c.w5,
      cache_write_1h_tokens: c.w1,
      cost_micros: cost,
      waste_rule: c.waste,
      session: `s${i % 3}`,
    });
    log.append("canary_sample", "paired", { task: `t${i}`, before: 70 + i * 3, after: 66 + ((i * 7) % 9) });
    if (i % 2 === 0) log.append("other_stream", "note", { n: i });
  });
  for (let i = 8; i < 14; i += 1) log.append("canary_sample", "paired", { task: `t${i}`, before: 60 + i, after: 58 + ((i * 5) % 11) });

  const prev = policyId(POLICY_PREV);
  const next = policyId(POLICY_NEXT);
  const kind = opts.kind ?? "month_bill";
  const hex = (id: string) => id.slice("sha256:".length);
  const bp = Math.floor((loop * 10_000 * 2 + total) / (total * 2));
  const pct1 = Math.floor((bp * 10 * 2 + 100) / 200) / 10;

  const claims: DossierInput["claims"] = [
    { id: "c_cost", kind: "number", unit: "usd", class: "estimated", decimals: 2, divisor: 1_000_000, text: "Estimated list-price spend across the eight calls", computation: { fn: "cost_micros@1", args: {}, range: { stream: "model_call", from: 0, to: 7 } } },
    { id: "c_loop", kind: "number", unit: "pct", class: "computed", decimals: 1, divisor: 100, text: "Share of the spend that went to looping calls", computation: { fn: "ratio_bp@1", args: { field: "cost_micros", where: { waste_rule: "C-LOOP-1" } }, range: { stream: "model_call", from: 0, to: 7 } } },
    { id: "c_n", kind: "number", unit: "count", class: "computed", decimals: 0, divisor: 1, text: "Calls in the period", computation: { fn: "count@1", args: {}, range: { stream: "model_call", from: 0, to: 7 } } },
    {
      id: "c_cmp",
      kind: "comparison",
      unit: "none",
      class: "computed",
      decimals: 3,
      divisor: 1000,
      withInterval: true,
      text: "Paired change in score between the two arms",
      computation: { fn: "paired_diff_ci@1", args: { a: "before", b: "after", seed: 7, resamples: 2000, level_bp: 9500 }, range: { stream: "canary_sample", from: 0, to: 13 } },
    },
    { id: "c_restrict", kind: "fact", text: "The new policy only narrows the old one", decimals: 0, divisor: 1, computation: { fn: "restrict_narrows@1", args: { from: hex(prev), to: hex(next) } } },
    { id: "c_quote", kind: "quote", text: QUOTE, evidence: new TextEncoder().encode(EVIDENCE_TEXT) },
    ...(opts.extraClaims ?? []),
  ];
  const sentences: NonNullable<DossierInput["sentences"]> = [
    { id: "s1", text: `Estimated spend was $${(total / 1_000_000).toFixed(2)}.`, cites: ["c_cost"] },
    { id: "s2", text: `Looping calls were ${pct1.toFixed(1)}% of the estimated spend.`, cites: ["c_loop", "c_cost"] },
    { id: "s3", text: `The document reads "${QUOTE}".`, cites: ["c_quote"] },
    { id: "s4", text: "The new policy only narrows the old one.", cites: ["c_restrict"] },
    ...(opts.extraSentences ?? []),
  ];

  let approvals: DossierInput["approvals"];
  let actionDigest: string | undefined;
  let approvalRequestId: string | undefined;
  if (kind === "policy_change" || opts.withApproval) {
    const db = new DatabaseSync(":memory:");
    const svc = new ApprovalService(db, signer, () => new Date("2026-10-22T10:00:00.000Z"));
    const action: Action = { kind: "policy_change", payload: { from: prev, to: next } };
    const req = svc.issue(action, {
      policyVersion: prev,
      chainVersion: "head-1",
      approvers: ["owner"],
      card: { diff: { added: ["stop-loops"] }, replay: { paused: 4, landed_blocked: 0, saved_micros: 611_000_000 }, restrict: { narrows: true, grid_size: 12 }, dollars_affected_micros: 611_000_000, tasks_affected: 4, claims: [] },
    });
    const out = svc.respond({ approvalRequestId: req.approvalRequestId, actionDigest: digestOfAction(action), decision: "approve" }, { approver: "owner", verified: true }, { policyVersion: prev, chainVersion: "head-1" });
    if (out.status !== "approved") throw new Error("fixture approval failed");
    approvals = [{ requestId: req.approvalRequestId, envelope: out.receipt }];
    actionDigest = digestOfAction(action);
    approvalRequestId = req.approvalRequestId;
  }

  const input: DossierInput = {
    kind,
    tenant: "acme-eng",
    period: { from: "2026-10-01", to: "2026-10-31" },
    createdAt: "2026-10-22T12:00:00.000Z",
    audience: "reviewer",
    disclosure: opts.disclosure ?? "full",
    log: log.rows as Row[],
    claims,
    sentences,
    snapshots: [snapshot],
    policies: { docs: [POLICY_PREV, POLICY_NEXT], changes: [{ from: prev, to: next }] },
    ...(approvals ? { approvals } : {}),
    ...(actionDigest ? { actionDigest } : {}),
    signer,
  };
  opts.mutateInput?.(input);
  const assembled = buildContent(input);
  // The ordinary path, so the fixture also exercises buildDossier's own self-check.
  const built = buildDossier({ ...input, selfCheck: true });
  return {
    signer,
    pins: pinsFor(signer),
    log,
    input,
    files: new Map(built.files),
    assembled,
    totalMicros: total,
    loopMicros: loop,
    callCount: CALLS.length,
    ids: { prev, next },
    ...(approvalRequestId ? { approvalRequestId } : {}),
  };
}
