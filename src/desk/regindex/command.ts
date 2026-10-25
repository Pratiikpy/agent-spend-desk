import type { CaptureDb } from "../capture/store.ts";
import { bytesOf, buildPayload, digestOf, IndexRefused, publish, readConsent, writeConsent } from "./index.ts";

export const CONSENT_PATH = "data/desk/index-consent.json";

/** `desk index`: the opt-in regression index. Off by default; preview shows the exact payload, accept pins its hash, publish sends those bytes and no others. */
export async function indexCommand(o: { sub: string | undefined; canaryRunsPath: string; store: CaptureDb | null; env: Record<string, string | undefined>; consentPath?: string; now?: () => Date; fetchImpl?: typeof fetch }): Promise<{ text: string; code: number }> {
  const sub = o.sub ?? "help";
  const consentPath = o.consentPath ?? CONSENT_PATH;
  const on = o.env["DESK_INDEX"] === "on";
  const payload = (): ReturnType<typeof buildPayload> => buildPayload({ canaryRunsPath: o.canaryRunsPath, ...(o.store ? { store: o.store } : {}), ...(o.now ? { now: o.now } : {}) });
  try {
    if (sub === "status") {
      const c = readConsent(consentPath);
      return { text: [`The regression index is ${on ? "ON" : "OFF"}.`, on ? (o.env["DESK_INDEX_URL"] ? `It would send to ${o.env["DESK_INDEX_URL"]}.` : "No address is set (DESK_INDEX_URL), so nothing can be sent.") : "Nothing is sent. DESK_INDEX=on turns it on.", c ? `A payload (${c.digest.slice(0, 12)}) was accepted on ${c.acceptedAt.slice(0, 10)}.` : "No payload has been accepted."].join("\n"), code: 0 };
    }
    if (sub === "preview") {
      const p = payload();
      return { text: [bytesOf(p).trimEnd(), "", `That is everything that would be sent, ${p.suites.length} suite${p.suites.length === 1 ? "" : "s"}, ${Buffer.byteLength(bytesOf(p))} bytes, hash ${digestOf(p)}.`, on ? "desk index accept accepts exactly this." : "The index is off, so nothing is sent whatever you accept. DESK_INDEX=on turns it on."].join("\n"), code: 0 };
    }
    if (sub === "accept") {
      const p = payload();
      writeConsent(consentPath, { digest: digestOf(p), acceptedAt: (o.now ?? (() => new Date()))().toISOString() });
      return { text: `Accepted the payload with hash ${digestOf(p).slice(0, 16)}. desk index publish sends it, and refuses if what would be sent has changed.`, code: 0 };
    }
    if (sub === "publish") {
      const r = await publish({ payload: payload(), consent: readConsent(consentPath), env: o.env, ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) });
      return { text: `Sent ${r.sent} bytes (hash ${r.digest.slice(0, 16)}); the index answered ${r.status}.`, code: r.status >= 200 && r.status < 300 ? 0 : 1 };
    }
  } catch (e) {
    return { text: e instanceof IndexRefused ? `Not sent: ${e.message}` : `Could not ${sub}: ${(e as Error).message}`, code: 1 };
  }
  return { text: ["desk index: share per-suite aggregates, if you choose to (off by default)", "  status | preview | accept | publish", "  DESK_INDEX=on and DESK_INDEX_URL=https://... turn it on; nothing is sent without a preview you accepted, and what is sent is the previewed bytes"].join("\n"), code: 0 };
}
