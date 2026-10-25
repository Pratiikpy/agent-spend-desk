import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { installDom, walk, ShimElement } from "./support/dom-shim.ts";
import { startRichUi, type RichUi } from "./support/rich-ui.ts";

/** Rule calibration (DF-034) where an owner meets it: the Policy screen's table and the weekly review's line. */
let ui: RichUi;
beforeAll(async () => {
  ui = await startRichUi();
}, 300_000);
afterAll(async () => {
  await ui?.close();
});

const get = async (path: string): Promise<Record<string, any>> => (await (await fetch(`${ui.server.origin}${path}`, { headers: { "x-desk-token": ui.token } })).json()) as Record<string, any>;

/** One screen of the real client code, against the real server, with the parameters given to that screen only. */
async function renderScreen(id: string, params: Record<string, string>): Promise<ShimElement> {
  const dom = installDom({ origin: ui.server.origin });
  try {
    const api = async (path: string, p: Record<string, string> = {}): Promise<unknown> => {
      const url = new URL(path, ui.server.origin);
      for (const [k, v] of Object.entries(p)) if (v !== "") url.searchParams.set(k, v);
      return (await fetch(url, { headers: { "x-desk-token": ui.token } })).json();
    };
    const meta = await api("/api/meta");
    const mod = (await import(pathToFileURL(resolve(`src/desk/ui/client/screens/${id}.js`)).href)) as { render(ctx: unknown): Promise<ShimElement> };
    return await mod.render({ api, params: new URLSearchParams(params), meta, range: params["range"] ?? "all", link: (x: string) => `#/${x}`, navigate() {}, rerender() {} });
  } finally {
    dom.restore();
  }
}

const POLICIES = ["daily-cap.yaml", "stop-loops.yaml", "velocity-and-session.yaml"];
type Row = { ruleId: string; flags: number; labelled: number; landed: number; landedShare: number | null; status: string; offer: unknown };
const calibration = async (to: string): Promise<Row[]> => ((await get(`/api/policy?range=all&to=${to}`))["replay"].calibration as Row[]) ?? [];

describe("the Policy screen's rule calibration", () => {
  it("carries, for each rule of the selected policy, its flags, how many have a known landing and landed, and a reading, and a rule that misfires carries an offer", async () => {
    let fired = 0;
    for (const to of POLICIES) {
      const rows = await calibration(to);
      expect(rows.length, to).toBeGreaterThan(0);
      for (const r of rows) {
        expect(["ok", "misfires", "not_enough_data", "never_fired"]).toContain(r.status);
        expect(r.labelled).toBeLessThanOrEqual(r.flags);
        expect(r.landed).toBeLessThanOrEqual(r.labelled);
        if (r.status === "misfires") expect(r.offer, `${to} ${r.ruleId}`).not.toBeNull();
        if (r.status !== "never_fired") fired += 1;
      }
    }
    // The three shipped policies are checked against the sample's sessions: at least one rule among them stops or asks about some.
    expect(fired).toBeGreaterThan(0);
  });

  it("is drawn as a table with a reading for each rule that fired, and an offer beside a rule that misfires, saying that it changes nothing", async () => {
    let drawn = 0;
    for (const to of POLICIES) {
      const rows = await calibration(to);
      if (!rows.some((r) => r.status !== "never_fired")) continue;
      const root = await renderScreen("policy", { range: "all", to });
      const els = [...walk(root)].map((w) => w.node).filter((n): n is ShimElement => n instanceof ShimElement);
      const text = root.textContent;
      expect(text).toContain("Rule calibration");
      expect(text).toContain("Each rule's stops and asks");
      expect(text).toContain("unknown is not the same as not landed");
      for (const r of rows.filter((x) => x.status === "misfires")) {
        const offer = els.find((e) => e.getAttribute("data-offer") === r.ruleId);
        expect(offer, `the offer for ${to} ${r.ruleId}`).toBeDefined();
        expect(offer!.textContent).toMatch(/your own edit to the file, not an approval|no higher threshold offered/);
      }
      drawn += 1;
    }
    expect(drawn).toBeGreaterThan(0);
  });

  it("draws no table for a policy none of whose rules stopped or asked about anything", async () => {
    const quiet = [];
    for (const to of POLICIES) if (!(await calibration(to)).some((r) => r.status !== "never_fired")) quiet.push(to);
    if (quiet.length === 0) return;
    expect((await renderScreen("policy", { range: "all", to: quiet[0]! })).textContent).not.toContain("Each rule's stops and asks");
  });
});

describe("the weekly review's calibration line", () => {
  it("says how many rules misfire, hold up or have too little to say, instead of saying it is not yet checked", async () => {
    const w = await get("/api/week");
    const line = w["review"].calibration as string;
    expect(line).not.toMatch(/have not been checked against your own history here/);
    expect(line).toMatch(/^(Of the \d+ rules? that fired in the last 90 days, \d+ misfires? on your data.*`desk calibrate rules` shows|No rule of the policy stopped or asked about a session in the last 90 days)/);
  });
});

describe("the Bill screen's month-end forecast (DF-035)", () => {
  it("carries the forecast and its record in the bill's data, and draws them under a label that says it is a forecast", async () => {
    const b = await get("/api/bill?range=all");
    const m = b["monthEnd"] as { method: string; month: string; asOf: string; spentMicros: number; daysLeft: number; pointMicros: number; lowMicros: number | null; highMicros: number | null; level: number; cohorts: { label: string; n: number; covered: number }[] };
    expect(m).not.toBeNull();
    expect(["seasonal", "linear"]).toContain(m.method);
    expect(m.level).toBe(0.8);
    expect(m.spentMicros).toBeGreaterThan(0);
    expect(m.cohorts.map((c) => c.label)).toEqual(["1 to 7 days ahead", "8 to 14 days ahead", "15 to 31 days ahead"]);
    for (const c of m.cohorts) expect(c.covered).toBeLessThanOrEqual(c.n);
    if (m.lowMicros !== null && m.highMicros !== null) {
      expect(m.lowMicros).toBeLessThanOrEqual(m.highMicros);
      expect(m.lowMicros).toBeGreaterThanOrEqual(m.spentMicros);
    } else expect(m.method === "linear" || m.daysLeft === 0 || m.lowMicros === null).toBe(true);
    const root = await renderScreen("bill", { range: "all" });
    const els = [...walk(root)].map((w) => w.node).filter((n): n is ShimElement => n instanceof ShimElement);
    expect(els.some((e) => e.getAttribute("data-month-end") === "true")).toBe(true);
    expect(root.textContent).toContain("Where the month ends");
    expect(root.textContent).toContain("a forecast of list-price estimates, not an invoice and not a limit".replace(/^a/, "A"));
  });
});
