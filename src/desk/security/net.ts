/**
 * The egress manifest (DF-074): the only places this product's own code will open a connection to, and a `fetch` that cannot reach anywhere else.
 *
 * A destination is declared by the person who runs the command, by setting it: the model endpoint, the Zetaris instance, a webhook they asked
 * alerts to use, the upstream a gateway forwards to. Each call site builds its `fetch` from the one destination it is configured with, so a request to
 * any other origin is refused before a socket is opened (`E_EGRESS_UNDECLARED`), and so is a redirect to another origin, which a server could
 * otherwise use to move a request somewhere nobody declared. With `DESK_MODEL_PROFILE=local` only loopback destinations are allowed, declared or not.
 *
 * What this covers: the connections the Desk's own code makes. A tool the Desk watches, or one it launches for a live test, makes its own.
 */
export type DestinationKind = "model" | "zetaris" | "gate" | "webhook" | "gateway_upstream" | "lab_upstream";

export interface Destination {
  kind: DestinationKind;
  /** Scheme, host and port, for example `https://integrate.api.nvidia.com`. */
  origin: string;
  /** In words, what is sent there. */
  purpose: string;
  loopback: boolean;
  /** The setting that declared it, so the person can change or remove it. */
  declaredBy: string;
}

export type Profile = "standard" | "local";

export class EgressRefused extends Error {
  readonly code = "E_EGRESS_UNDECLARED";
  constructor(readonly origin: string, readonly reason: string) {
    super(`E_EGRESS_UNDECLARED: ${origin} ${reason}`);
    this.name = "EgressRefused";
  }
}

export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || h === "0:0:0:0:0:0:0:1" || /^127(?:\.\d{1,3}){3}$/.test(h) || h.endsWith(".localhost");
}

export function profileOf(env: Record<string, string | undefined>): Profile {
  return env["DESK_MODEL_PROFILE"]?.trim().toLowerCase() === "local" ? "local" : "standard";
}

export function destination(kind: DestinationKind, url: string, purpose: string, declaredBy: string): Destination | null {
  const origin = originOf(url);
  if (origin === null) return null;
  return { kind, origin, purpose, loopback: isLoopbackHost(new URL(origin).hostname), declaredBy };
}

/**
 * A `fetch` that only reaches the declared destinations. `local` refuses every destination that is not loopback, so a manifest that names a
 * remote host still cannot reach it in that profile. A redirect is not followed: the response is returned as it came, and a caller that
 * treats a 3xx as a failure (every caller here does) never connects to the place it points at.
 */
export function declaredFetch(declared: readonly Destination[], opts: { profile?: Profile; base?: typeof fetch } = {}): typeof fetch {
  const base = opts.base ?? fetch;
  const allowed = new Map(declared.map((d) => [d.origin, d]));
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const origin = originOf(raw);
    if (origin === null) throw new EgressRefused(raw.slice(0, 80), "is not an http or https address, so it is not a declared destination");
    const hit = allowed.get(origin);
    if (hit === undefined) {
      throw new EgressRefused(origin, `is not a declared destination (declared: ${declared.length === 0 ? "none" : [...allowed.keys()].join(", ")})`);
    }
    if ((opts.profile ?? "standard") === "local" && !hit.loopback) {
      throw new EgressRefused(origin, "is declared but not on this machine, and DESK_MODEL_PROFILE=local allows only loopback");
    }
    return base(input, { ...init, redirect: "manual" });
  }) as typeof fetch;
}

/** The destinations a run of the product can use, from the settings it was given. Nothing is listed that is not set. */
export function manifestFromEnv(env: Record<string, string | undefined>, extra: readonly Destination[] = []): { profile: Profile; destinations: Destination[] } {
  const out: Destination[] = [];
  const push = (d: Destination | null): void => {
    if (d !== null && !out.some((x) => x.origin === d.origin && x.kind === d.kind)) out.push(d);
  };
  const model = env["MODEL_BASE_URL"] ?? env["NVIDIA_BASE_URL"];
  if (model) push(destination("model", model, "model requests, with credential shapes masked and only what the question needs", env["MODEL_BASE_URL"] ? "MODEL_BASE_URL" : "NVIDIA_BASE_URL"));
  const zetaris = env["ZETARIS_REST_URL"];
  if (zetaris) push(destination("zetaris", zetaris, "read-only SQL statements over the invoice, CI and roster silos", "ZETARIS_REST_URL"));
  push(destination("gate", env["DESK_GATE_URL"] ?? "http://127.0.0.1:8765", "the local spend gate, on this machine", env["DESK_GATE_URL"] ? "DESK_GATE_URL" : "the default"));
  for (const d of extra) push(d);
  return { profile: profileOf(env), destinations: out };
}

/** For the Sources screen and `desk egress manifest`: one line per destination, and what is refused. */
export function describeManifest(m: { profile: Profile; destinations: readonly Destination[] }): string[] {
  const lines = [m.profile === "local" ? "Profile: local. Only destinations on this machine are allowed, declared or not." : "Profile: standard. Only the destinations below are allowed."];
  for (const d of m.destinations) lines.push(`${d.origin}${d.loopback ? " (this machine)" : ""}: ${d.purpose}. Declared by ${d.declaredBy}.${m.profile === "local" && !d.loopback ? " Refused in the local profile." : ""}`);
  if (m.destinations.length === 0) lines.push("No destination is declared: nothing leaves this machine.");
  lines.push("Any other address is refused before a connection is made.");
  return lines;
}
