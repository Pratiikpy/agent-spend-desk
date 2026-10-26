import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkAll, LOG_KIND } from "../receipts/command.ts";

/**
 * The signed Nightshift receipts kept in `docs/verification/nightshift-receipts/` (live calls of 2026-10-26): every signature holds, and the same log with one
 * number changed, one signature swapped for another call's, or read against another key is refused. A check that finds every receipt valid proves nothing until
 * it has refused a changed one.
 */
const LOG = "docs/verification/nightshift-receipts/2026-10-26.json";

interface Call {
  role: string;
  receiptId: string;
  routedModel: string | null;
  envelope: { body: { receipt: { usage?: { latency_ms?: number } } }; sig_b64: string; pubkey_b64: string };
}

export function receiptsProve(): { ok: boolean; detail: string } {
  const root = mkdtempSync(join(tmpdir(), "desk-prove-receipts-"));
  const fails: string[] = [];
  try {
    const log = JSON.parse(readFileSync(LOG, "utf8")) as { kind: string; calls: Call[] };
    if (log.kind !== LOG_KIND || log.calls.length < 8) fails.push("the committed log is not the expected receipt log");
    const real = checkAll([LOG]);
    if (real.valid !== real.total || real.total !== log.calls.length || real.invalid.length > 0) fails.push(`only ${real.valid} of ${real.total} committed receipts verify`);
    const keys = [...real.keys.keys()];
    if (keys.length !== 1) fails.push(`the log names ${keys.length} signing keys, not one`);
    const roles = new Set(log.calls.map((c) => c.role));
    for (const r of ["ask_planner", "explainer", "policy_drafter", "policy_attacker"]) if (!roles.has(r)) fails.push(`no receipt for the ${r} role`);
    const write = (name: string, mutate: (c: Call[]) => void): string => {
      const copy = JSON.parse(JSON.stringify(log)) as { calls: Call[] };
      mutate(copy.calls);
      const p = join(root, name);
      writeFileSync(p, JSON.stringify(copy));
      return p;
    };
    const changed = checkAll([write("changed.json", (c) => { const u = c[0]!.envelope.body.receipt.usage ?? (c[0]!.envelope.body.receipt.usage = {}); u.latency_ms = (u.latency_ms ?? 0) + 1; })]);
    if (changed.invalid.length !== 1) fails.push("one changed number in one receipt was not refused");
    const swapped = checkAll([write("swapped.json", (c) => { const a = c[0]!.envelope; a.sig_b64 = c[1]!.envelope.sig_b64; })]);
    if (swapped.invalid.length !== 1) fails.push("a signature taken from another call was not refused");
    const wrongPin = checkAll([LOG], "0000000000000000");
    if (wrongPin.valid !== 0) fails.push("a log read against another key was accepted");
    const pinned = checkAll([LOG], keys[0]);
    if (pinned.valid !== real.total) fails.push("the log was refused against the key that signed it");
    return fails.length === 0
      ? { ok: true, detail: `all ${real.total} signed receipts (${[...roles].sort().join(", ")}) verify against key ${keys[0]}; one changed number, one swapped signature and another key were each refused` }
      : { ok: false, detail: fails.join("; ") };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
