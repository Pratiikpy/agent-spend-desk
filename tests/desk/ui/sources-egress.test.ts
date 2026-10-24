import { afterEach, describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../../../src/desk/ledger/db.ts";
import { sources, type UiContext } from "../../../src/desk/ui/queries.ts";
import { testSnapshot } from "../helpers.ts";

interface Dest {
  kind: string;
  origin: string;
  loopback: boolean;
  refused: boolean;
}
interface Endpoint {
  label: string;
  configured: boolean;
  missing: string[];
}
interface Shape {
  endpoints: Endpoint[];
  egress: { profile: string; destinations: Dest[]; log: { requests: number } };
}

let db: Ledger | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

function view(env: Record<string, string>, egressLogPath: string | null = null): Shape {
  db = openLedger(":memory:");
  const ctx: UiContext = { db, snapshot: testSnapshot(), policiesDir: "policies", mode: "own_logs", ledgerName: "ledger", env, nowMs: () => Date.UTC(2026, 9, 25), egressLogPath };
  return sources(ctx) as Shape;
}

// Stand-in values, assembled at run time so that nothing here looks like a real credential.
const KEY = ["stand", "in", "0123456789"].join("-");

describe("the Sources screen's services and egress, from the settings the product actually reads", () => {
  it("counts the model as configured by either set of names, and Zetaris by its three", () => {
    const a = view({ MODEL_BASE_URL: "http://127.0.0.1:8088/v1", MODEL_API_KEY: KEY, NEMOTRON_MODEL: "m", ZETARIS_REST_URL: "http://localhost:8888/api", ZETARIS_API_KEY: KEY, ZETARIS_ORG_ID: "o" });
    expect(a.endpoints.map((e) => [e.label, e.configured])).toEqual([["Zetaris", true], ["Nemotron model endpoint", true]]);
    const b = view({ NVIDIA_BASE_URL: "https://integrate.api.nvidia.com/v1", NVIDIA_API_KEY: KEY, NVIDIA_MODEL: "m" });
    expect(b.endpoints.find((e) => e.label === "Nemotron model endpoint")?.configured).toBe(true);
    const c = view({ MODEL_BASE_URL: "http://127.0.0.1:8088/v1" });
    expect(c.endpoints.find((e) => e.label === "Nemotron model endpoint")).toMatchObject({ configured: false, missing: ["MODEL_API_KEY", "NEMOTRON_MODEL"] });
    expect(JSON.stringify([a, b, c])).not.toContain(KEY);
  });

  it("lists the model and Zetaris as declared destinations when they are set, and the local gate always", () => {
    const v = view({ MODEL_BASE_URL: "https://integrate.api.nvidia.com/v1", ZETARIS_REST_URL: "http://localhost:8888/api" });
    expect(v.egress.profile).toBe("standard");
    expect(v.egress.destinations.map((d) => [d.kind, d.origin, d.loopback, d.refused])).toEqual([
      ["model", "https://integrate.api.nvidia.com", false, false],
      ["zetaris", "http://localhost:8888", true, false],
      ["gate", "http://127.0.0.1:8765", true, false],
    ]);
  });

  it("marks a destination refused when the profile is local and it is not on this machine", () => {
    const v = view({ MODEL_BASE_URL: "https://integrate.api.nvidia.com/v1", DESK_MODEL_PROFILE: "local" });
    expect(v.egress.profile).toBe("local");
    expect(v.egress.destinations.find((d) => d.kind === "model")?.refused).toBe(true);
    expect(v.egress.destinations.find((d) => d.kind === "gate")?.refused).toBe(false);
  });

  it("says nothing was sent when there is no log", () => {
    expect(view({}, null).egress.log.requests).toBe(0);
  });
});
