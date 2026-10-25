import { createPublicKey } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { strictBase64, type Envelope } from "./dsse.ts";
import { FAILED, requestTimestamp, toSigstoreBundle, verifySigstoreBundle } from "./sigstore.ts";

export interface BundleFlags {
  tsa?: string;
  out?: string;
  key?: string;
  pins?: string;
  dossier?: string;
  tsaCa?: string;
  type?: string;
}

/** The result of a command that can fail closed: text for the person and the exit code the shell sees. */
export interface BundleOutcome {
  text: string;
  code: number;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** `desk bundle make <dossier folder>` and `desk bundle verify <bundle>`: a dossier a person with `cosign` can check, and a check that needs nothing of ours. */
export async function bundleCommand(o: { sub: string | undefined; args: string[]; flags: BundleFlags; fetchImpl?: typeof fetch }): Promise<BundleOutcome> {
  const sub = o.sub ?? "help";
  try {
    if (sub === "make") {
      const dir = o.args[0];
      if (!dir || !existsSync(join(dir, "statement.dsse.json"))) return { text: "Name a dossier folder that holds statement.dsse.json: desk bundle make <folder> [--tsa URL] [--output FILE]", code: 2 };
      const env = readJson(join(dir, "statement.dsse.json")) as Envelope;
      const keyid = env.signatures[0]?.keyid ?? "";
      const sig = strictBase64(env.signatures[0]?.sig ?? "");
      if (!sig) return { text: "The statement's signature is not base64.", code: 2 };
      const stamps: Buffer[] = [];
      if (o.flags.tsa) stamps.push(await requestTimestamp(o.flags.tsa, sig, o.fetchImpl));
      const bundle = toSigstoreBundle(env, { keyHint: keyid, timestamps: stamps });
      const out = o.flags.out ?? join(dir, "statement.sigstore.json");
      writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
      const payload = JSON.parse(Buffer.from(env.payload, "base64").toString("utf8")) as { predicateType: string };
      return { text: [`Wrote ${out}.`, `It can be checked with cosign, with the signer's public key as a PEM file:`, `  cosign verify-blob-attestation --key signer.pub --bundle ${out} --type ${payload.predicateType} --insecure-ignore-tlog ${join(dir, "manifest.json")}`, stamps.length > 0 ? `A timestamp from ${o.flags.tsa} is in it, over a hash of the signature.` : "It carries no timestamp (--tsa URL asks an RFC 3161 authority for one) and no transparency log entry.", `Or with ours: desk bundle verify ${out} --key signer.pub --folder ${dir}`].join("\n"), code: 0 };
    }
    if (sub === "verify") {
      const file = o.args[0];
      if (!file || !existsSync(file)) return { text: "Name a bundle file: desk bundle verify <file> --key signer.pub [--folder FOLDER] [--tsa-ca CA.pem]", code: 2 };
      let key: string | Uint8Array | undefined;
      if (o.flags.key) key = readFileSync(o.flags.key, "utf8");
      else if (o.flags.pins) {
        const pins = readJson(o.flags.pins) as { keys?: { publicKey?: string }[] };
        const der = strictBase64(pins.keys?.[0]?.publicKey ?? "");
        if (!der) return { text: "The pins file has no key to check against.", code: 2 };
        key = createPublicKey({ key: der, format: "der", type: "spki" }).export({ format: "pem", type: "spki" }).toString();
      }
      if (key === undefined) return { text: "Give the signer's public key: --key signer.pub, or --pins pins.json.", code: 2 };
      const artifacts = new Map<string, Uint8Array>();
      let checkpointRoot: string | null = null;
      if (o.flags.dossier) {
        artifacts.set("manifest.json", readFileSync(join(o.flags.dossier, "manifest.json")));
        const cp = readJson(join(o.flags.dossier, "checkpoint.json")) as Envelope;
        checkpointRoot = (JSON.parse(Buffer.from(cp.payload, "base64").toString("utf8")) as { root_hash?: string }).root_hash ?? null;
      }
      const r = verifySigstoreBundle(readJson(file), { key, artifacts, ...(o.flags.type ? { predicateType: o.flags.type } : {}), ...(o.flags.tsaCa ? { tsaCa: readFileSync(o.flags.tsaCa, "utf8") } : {}) });
      if (r.ok && checkpointRoot !== null && r.statement?.predicate["checkpoint_root"] !== checkpointRoot) {
        return { text: [...r.findings, `${FAILED}: the statement's Merkle root is ${String(r.statement?.predicate["checkpoint_root"])} and the dossier's checkpoint says ${checkpointRoot}`].join("\n"), code: 1 };
      }
      if (r.ok && checkpointRoot !== null) r.findings.push("merkle root: the statement's root is the dossier checkpoint's");
      return { text: [r.ok ? "PASS" : "FAIL", ...r.findings.map((f) => `  ${f}`)].join("\n"), code: r.ok ? 0 : 1 };
    }
  } catch (e) {
    return { text: `${FAILED}: ${(e as Error).message}`, code: 1 };
  }
  return { text: ["desk bundle: a signed dossier in the shape cosign reads", "  make <dossier folder> [--tsa URL] [--output FILE]      wrap its statement as a Sigstore bundle, with an RFC 3161 timestamp if an authority is named", "  verify <bundle> --key signer.pub [--folder FOLDER] [--tsa-ca CA.pem] [--type PREDICATE]   check it offline; exit 1 on any failure"].join("\n"), code: 0 };
}
