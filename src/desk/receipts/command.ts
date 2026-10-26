import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { verifyEnvelope, type EnvelopeCheck } from "../agents/receipt-signature.ts";

/**
 * `desk receipts`: check the signatures on the Meterless Nightshift receipts that came back with the model's replies. Every recorded reply that
 * Nightshift served carries a receipt; Nightshift 1.2.x also signs it (Ed25519). This command reads recordings and receipt logs, checks every
 * signature it finds, and says per role which model answered. A receipt recorded before signatures were kept is counted and named as unsigned: it
 * is a record of what the reply said, not something a stranger can check. It never calls a network and never reads a key.
 */
export const RECEIPTS_USAGE = [
  "desk receipts [PATH ...] [--pin KEY_ID]            check every receipt signature under the folders and files given",
  "desk receipts export CASSETTE_DIR OUT.json         write the signed receipts of a recording folder to one log that others can check",
  "  PATH defaults to docs/verification/nightshift-receipts and data/sample. --pin names the key the signer must be (the first 16 hex characters printed by this command).",
].join("\n");

export const LOG_KIND = "desk.nightshift_receipts/1";

export interface ReceiptEntry {
  role: string;
  /** The recording's request hash, or the position in a log. */
  ref: string;
  receiptId: string;
  routedModel: string | null;
  envelope?: unknown;
  file: string;
}

export interface ReceiptsReport {
  total: number;
  unsigned: number;
  signed: number;
  valid: number;
  invalid: { entry: ReceiptEntry; check: EnvelopeCheck }[];
  keys: Map<string, number>;
  /** role -> model -> count, over receipts whose signature is valid. */
  roles: Map<string, Map<string, number>>;
  /** role -> model -> count, over the receipts with no signature. */
  unsignedRoles: Map<string, Map<string, number>>;
}

function walk(path: string, out: string[]): void {
  if (!existsSync(path)) return;
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path).sort()) walk(join(path, name), out);
  } else if (path.endsWith(".json")) out.push(path);
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** The receipts in one file: a recording (one reply) or a receipt log (many). Anything else holds none. */
export function entriesOf(file: string, text: string): ReceiptEntry[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isObj(v)) return [];
  if (v["kind"] === LOG_KIND && Array.isArray(v["calls"])) {
    return (v["calls"] as unknown[]).flatMap((c, i) => {
      if (!isObj(c) || typeof c["receiptId"] !== "string") return [];
      return [{ role: typeof c["role"] === "string" ? c["role"] : "unknown", ref: `#${i + 1}`, receiptId: c["receiptId"], routedModel: typeof c["routedModel"] === "string" ? c["routedModel"] : null, ...(c["envelope"] !== undefined ? { envelope: c["envelope"] } : {}), file }];
    });
  }
  const response = isObj(v["response"]) ? (v["response"] as Record<string, unknown>) : undefined;
  const receipt = response && isObj(response["receipt"]) ? (response["receipt"] as Record<string, unknown>) : undefined;
  if (!receipt || typeof receipt["id"] !== "string") return [];
  return [{ role: typeof v["role"] === "string" ? v["role"] : "unknown", ref: typeof v["key"] === "string" ? v["key"] : file, receiptId: receipt["id"], routedModel: typeof receipt["routedModel"] === "string" ? receipt["routedModel"] : null, ...(receipt["envelope"] !== undefined ? { envelope: receipt["envelope"] } : {}), file }];
}

export function checkAll(paths: readonly string[], pin?: string): ReceiptsReport {
  const files: string[] = [];
  for (const p of paths) walk(p, files);
  const rep: ReceiptsReport = { total: 0, unsigned: 0, signed: 0, valid: 0, invalid: [], keys: new Map(), roles: new Map(), unsignedRoles: new Map() };
  const bump = (m: Map<string, Map<string, number>>, role: string, model: string): void => {
    const row = m.get(role) ?? new Map<string, number>();
    row.set(model, (row.get(model) ?? 0) + 1);
    m.set(role, row);
  };
  for (const f of files) {
    for (const e of entriesOf(f, readFileSync(f, "utf8"))) {
      rep.total++;
      if (e.envelope === undefined) {
        rep.unsigned++;
        bump(rep.unsignedRoles, e.role, e.routedModel ?? "unnamed");
        continue;
      }
      rep.signed++;
      const check = verifyEnvelope(e.envelope, { expectReceiptId: e.receiptId, ...(pin ? { pin } : {}) });
      if (check.valid) {
        rep.valid++;
        if (check.keyId) rep.keys.set(check.keyId, (rep.keys.get(check.keyId) ?? 0) + 1);
        bump(rep.roles, e.role, check.routedModel ?? e.routedModel ?? "unnamed");
      } else rep.invalid.push({ entry: e, check });
    }
  }
  return rep;
}

function table(m: Map<string, Map<string, number>>): string[] {
  const lines: string[] = [];
  for (const [role, models] of [...m.entries()].sort()) {
    for (const [model, n] of [...models.entries()].sort()) lines.push(`  ${role.padEnd(20)} ${model.padEnd(46)} ${String(n).padStart(4)}`);
  }
  return lines;
}

export function receiptsCommand(o: { args: readonly string[]; pin?: string }): { text: string; code: number } {
  if (o.args[0] === "export") {
    const [, dir, out] = o.args;
    if (!dir || !out) return { text: RECEIPTS_USAGE, code: 2 };
    const files: string[] = [];
    walk(dir, files);
    const calls = files
      .flatMap((f) => entriesOf(f, readFileSync(f, "utf8")))
      .filter((e) => e.envelope !== undefined)
      .map((e) => ({ role: e.role, receiptId: e.receiptId, routedModel: e.routedModel, envelope: e.envelope }));
    if (calls.length === 0) return { text: `No signed receipt under ${dir}: nothing was written. Receipts are signed by Nightshift 1.2.x and kept from the build that added the envelope.`, code: 1 };
    const rep = checkAll([dir]);
    if (rep.invalid.length > 0) return { text: `${rep.invalid.length} receipt${rep.invalid.length === 1 ? "" : "s"} under ${dir} fail${rep.invalid.length === 1 ? "s" : ""} the signature check, so no log was written.`, code: 1 };
    writeFileSync(out, JSON.stringify({ kind: LOG_KIND, note: "Signed receipts of live model calls served by Meterless Nightshift. Check them with: desk receipts <this file>. Each envelope is Nightshift's own: an Ed25519 signature over the receipt body.", calls }, null, 1) + "\n");
    return { text: `Wrote ${calls.length} signed receipts to ${out}.`, code: 0 };
  }
  const paths = o.args.length > 0 ? [...o.args] : ["docs/verification/nightshift-receipts", "data/sample"];
  if (!paths.some((p) => existsSync(p))) return { text: `Nothing to read: none of ${paths.join(", ")} exists.`, code: 2 };
  const r = checkAll(paths, o.pin);
  const out: string[] = [];
  out.push(`Nightshift receipts under ${paths.join(", ")}`);
  out.push(`  ${r.total} receipts: ${r.signed} signed (${r.valid} signatures valid, ${r.invalid.length} not), ${r.unsigned} unsigned`);
  if (r.keys.size > 0) out.push(`  signed by ${[...r.keys.entries()].map(([k, n]) => `key ${k} (${n})`).join(", ")}${o.pin ? `; pinned to ${o.pin}` : ""}`);
  if (r.roles.size > 0) {
    out.push("", "Signed and valid: which model answered each role", "  role                 model                                           calls", ...table(r.roles));
  }
  if (r.unsigned > 0) {
    out.push("", `Unsigned receipts (recorded before signatures were kept; they say what the reply claimed, and cannot be checked):`, ...table(r.unsignedRoles).slice(0, 12));
    if (r.unsignedRoles.size > 6) out.push("  ...");
  }
  if (r.invalid.length > 0) {
    out.push("", "Failed:");
    for (const f of r.invalid.slice(0, 10)) out.push(`  ${f.entry.file} (${f.entry.role}, ${f.entry.receiptId}): ${f.check.reason ?? "invalid"}`);
  }
  out.push("", "A valid signature shows that the key named above wrote this receipt and that nothing in it changed afterwards. It does not show that the key is Meterless's: compare the key id with the one you trust (--pin).");
  return { text: out.join("\n"), code: r.invalid.length > 0 ? 1 : 0 };
}
