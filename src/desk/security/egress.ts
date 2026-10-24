import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The egress log: one line for every request that left this machine for a model. It records where the request went, how
 * big it was, a hash of what was sent and how many secrets were masked before sending. It never records the text, so
 * the log is safe to show; the user can read what left without it becoming a second copy of their data.
 */
export interface EgressEntry {
  ts: string;
  host: string;
  role: string;
  bytes: number;
  sha256: string;
  redactions: number;
}

export function jsonlEgress(path: string): (e: EgressEntry) => void {
  return (e) => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, JSON.stringify(e) + "\n");
    } catch {
      /* a log that cannot be written must not stop a call */
    }
  };
}

export interface EgressSummary {
  requests: number;
  bytes: number;
  redactions: number;
  hosts: { host: string; requests: number; bytes: number }[];
  roles: { role: string; requests: number }[];
  first: string | null;
  last: string | null;
}

export function summariseEgress(path: string): EgressSummary {
  const out: EgressSummary = { requests: 0, bytes: 0, redactions: 0, hosts: [], roles: [], first: null, last: null };
  if (!existsSync(path)) return out;
  const hosts = new Map<string, { requests: number; bytes: number }>();
  const roles = new Map<string, number>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let e: EgressEntry;
    try {
      e = JSON.parse(line) as EgressEntry;
    } catch {
      continue;
    }
    if (typeof e.host !== "string" || typeof e.bytes !== "number") continue;
    out.requests += 1;
    out.bytes += e.bytes;
    out.redactions += typeof e.redactions === "number" ? e.redactions : 0;
    const h = hosts.get(e.host) ?? { requests: 0, bytes: 0 };
    h.requests += 1;
    h.bytes += e.bytes;
    hosts.set(e.host, h);
    roles.set(e.role, (roles.get(e.role) ?? 0) + 1);
    out.first ??= e.ts;
    out.last = e.ts;
  }
  out.hosts = [...hosts.entries()].map(([host, v]) => ({ host, ...v })).sort((a, b) => b.requests - a.requests);
  out.roles = [...roles.entries()].map(([role, requests]) => ({ role, requests })).sort((a, b) => b.requests - a.requests);
  return out;
}
