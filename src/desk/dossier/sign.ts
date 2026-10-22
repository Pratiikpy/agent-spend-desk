import { pae, type Envelope } from "../verify/dsse.ts";
import type { Signer } from "./keys.ts";

/** A DSSE JSON envelope (envelope.md v1.0.2) signed over PAE(payloadType, payload). */
export function signEnvelope(payloadType: string, payload: Uint8Array, signer: Signer): Envelope {
  return {
    payload: Buffer.from(payload).toString("base64"),
    payloadType,
    signatures: [{ keyid: signer.keyid, sig: signer.sign(pae(payloadType, payload)).toString("base64") }],
  };
}
