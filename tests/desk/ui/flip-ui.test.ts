import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readCsvInvoice } from "../../../src/desk/billing/import.ts";
import { storeInvoice } from "../../../src/desk/billing/store.ts";
import { openLedger } from "../../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../../src/desk/pricing/pricebook.ts";
import { startUiServer, type UiServer } from "../../../src/desk/ui/server.ts";
import { assistantLine } from "../helpers.ts";
import { installDom, walk, ShimElement, ShimText } from "./support/dom-shim.ts";
import { renderAllScreens, startRichUi, type RichUi } from "./support/rich-ui.ts";

/**
 * The one fact that would flip a verdict (DF-068), where a reader meets it: the Bill screen's reconciliation row and the canary. A real ledger with a real
 * imported invoice and a second price source that disagrees, so the answer is not written into the test.
 */
const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const TOKEN = ["ui", "flip", "token", "for", "tests", "0123456789abcdef"].join("-");
const NOW = Date.parse("2026-10-25T12:00:00Z");

const portkey = (cacheReadCents: number): string =>
  JSON.stringify({
    fetchedAt: "2026-10-24T12:00:00.000Z",
    models: {
      default: {},
      "claude-sonnet-5-5": { pricing_config: { pay_as_you_go: { request_token: { price: 0.0002 }, response_token: { price: 0.001 }, cache_read_input_token: { price: cacheReadCents }, cache_write_input_token: { price: 0.00025 }, additional_units: {} } } },
    },
  });

let dir: string;
let withSource: UiServer;
let agreeing: UiServer;
let noSource: UiServer;
let estimatedMicros: number;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "desk-flip-ui-"));
  const logs = join(dir, "logs");
  mkdirSync(logs, { recursive: true });
  // Two million Sonnet 5.5 cache-read tokens in October: $0.20 at our price, $0.40 at Portkey's.
  writeFileSync(join(logs, "a.jsonl"), `${assistantLine({ id: "a1", model: "claude-sonnet-5-5", read: 2_000_000, input: 1000, output: 1000, ts: "2026-10-20T10:00:00Z" })}\n`);
  const ledgerPath = join(dir, "ledger.db");
  const db = openLedger(ledgerPath);
  await ingestClaudeCode(db, [join(logs, "a.jsonl")], loadSnapshot(PRICES));
  estimatedMicros = (db.prepare("SELECT SUM(c.total_micros) s FROM cost_event c WHERE c.class = 'estimated'").get() as { s: number }).s;
  // The invoice is what the ledger would say if Portkey's cache read price were the one in force: $0.20 more than our estimate, the whole month, the same model.
  const billed = ((estimatedMicros + 200_000) / 1e6).toFixed(6);
  storeInvoice(db, readCsvInvoice(`model,cost_usd\nclaude-sonnet-5-5,${billed}`, { sourceName: "october.csv", period: "2026-10" }));
  db.close();
  writeFileSync(join(dir, "differs.json"), portkey(0.00002));
  writeFileSync(join(dir, "same.json"), portkey(0.00001));
  const common = {
    ledgerPath, pricesPath: PRICES, policiesDir: "policies", port: 0, token: TOKEN, env: {}, mode: "own_logs" as const, nowMs: () => NOW,
    extra: { dossiersDir: join(dir, "none"), pendingDir: join(dir, "none"), memoryDir: join(dir, "memory"), tracesDir: join(dir, "traces") },
  };
  withSource = await startUiServer({ ...common, otherPricesPath: join(dir, "differs.json") } as never);
  agreeing = await startUiServer({ ...common, otherPricesPath: join(dir, "same.json") } as never);
  noSource = await startUiServer({ ...common, otherPricesPath: join(dir, "missing.json") } as never);
}, 120_000);

afterAll(async () => {
  await Promise.all([withSource?.close(), agreeing?.close(), noSource?.close()]);
  rmSync(dir, { recursive: true, force: true });
});

const bill = async (s: UiServer): Promise<Record<string, any>> => JSON.parse(await (await fetch(`${s.origin}/api/bill?range=all`, { headers: { "x-desk-token": TOKEN } })).text()) as Record<string, any>;

describe("the Bill screen's reconciliation row", () => {
  it("starts unreconciled on our price, and names the model whose other price would reconcile it", async () => {
    const b = await bill(withSource);
    const [r] = b["reconciliations"] as { status: string; period: string; flip: string | null }[];
    expect(r?.period).toBe("2026-10");
    expect(r?.status).toBe("unreconciled");
    expect(r?.flip).toMatch(/^Price claude-sonnet-5-5 as Portkey does \(\+\$0\.20 on this month's estimate\), and the verdict goes from unreconciled to reconciled/);
    expect(r?.flip).toMatch(/within 2% of the invoice, the whole month covered/);
    expect(r?.flip).toMatch(/The one candidate change was tried\./);
  });

  it("says nothing disputed applies when the two sources agree", async () => {
    const [r] = (await bill(agreeing))["reconciliations"] as { flip: string | null }[];
    expect(r?.flip).toBe("There is no single change to test for this unreconciled verdict (no price the two sources disagree on applies to this month).");
  });

  it("makes no claim when there is no second source to test against", async () => {
    const [r] = (await bill(noSource))["reconciliations"] as { status: string; flip: string | null }[];
    expect(r?.status).toBe("unreconciled");
    expect(r?.flip).toBeNull();
  });

  it("does not say no invoice is imported when one is, but has no line dated inside the period", async () => {
    const b = await bill(withSource);
    const billed = (b["classes"] as { cls: string; note: string }[]).find((c) => c.cls === "billed");
    expect(billed?.note).toMatch(/^1 invoice is imported, but none has a line dated inside this period/);
    expect(billed?.note).not.toMatch(/No invoice is imported/);
  });

  it("agrees with what the estimate actually becomes under the other price", async () => {
    // The flip is a claim about arithmetic the Desk did; check it against the figures it was built from.
    const b = await bill(withSource);
    expect(b["priceBand"].highMicros).toBe(estimatedMicros + 200_000);
    const [r] = b["reconciliations"] as { billedMicros: number }[];
    expect(r?.billedMicros).toBe(b["priceBand"].highMicros);
  });
});

describe("the screens", () => {
  let ui: RichUi;
  beforeAll(async () => {
    ui = await startRichUi();
  }, 300_000);
  afterAll(async () => {
    await ui?.close();
  });

  const text = (root: ShimElement): string => [...walk(root)].filter((w) => w.node instanceof ShimText).map((w) => (w.node as ShimText).data).join(" ");

  it("the Bill screen has a column for it when a second price source was read, and none when there is no source to test against", async () => {
    const render = async (server: UiServer): Promise<string> => {
      const dom = installDom({ origin: server.origin });
      try {
        const api = async (path: string, p: Record<string, string> = {}): Promise<unknown> => {
          const url = new URL(path, server.origin);
          for (const [k, v] of Object.entries(p)) if (v !== "") url.searchParams.set(k, v);
          return (await fetch(url, { headers: { "x-desk-token": TOKEN } })).json();
        };
        const meta = await api("/api/meta");
        const mod = (await import(pathToFileURL(resolve("src/desk/ui/client/screens/bill.js")).href)) as { render(ctx: unknown): Promise<ShimElement> };
        return text(await mod.render({ api, params: new URLSearchParams({ range: "all" }), meta, range: "all", link: (s: string) => `#/${s}`, navigate() {}, rerender() {} }));
      } finally {
        dom.restore();
      }
    };
    const withColumn = await render(withSource);
    expect(withColumn).toContain("What would flip it");
    expect(withColumn).toContain("Price claude-sonnet-5-5 as Portkey does");
    expect(await render(noSource)).not.toContain("What would flip it");
  });

  it("the canary screen shows a line for it", async () => {
    const { screens } = await renderAllScreens(ui, { range: "all" });
    const canary = screens.find((s) => s.id === "canary")!;
    const flip = [...walk(canary.root)].map((w) => w.node).find((n): n is ShimElement => n instanceof ShimElement && n.getAttribute("data-flip") === "true");
    expect(flip, "the canary screen shows what would flip its verdict").toBeDefined();
    expect(flip!.textContent).toMatch(/^What would flip this verdict: /);
    expect(flip!.textContent).toMatch(/candidate changes were tried/);
  });

  it("the Brief's canary card carries the same sentence once the canary can call, and says nothing while it is too young", async () => {
    // The constructed scenario is dated 2026-10-01 onward; the brief for a day shows the canary as it stood on that day.
    const briefOn = async (day: string): Promise<{ api: { state: string; flip: string | null; verdict: string }; node: ShimElement | undefined }> => {
      const res = await fetch(`${ui.server.origin}/api/brief?day=${day}`, { headers: { "x-desk-token": ui.token } });
      const body = (await res.json()) as { canary: { state: string; flip: string | null; verdict: string } };
      const { screens } = await renderAllScreens(ui, { range: "all", day });
      const root = screens.find((sc) => sc.id === "brief")!.root;
      return { api: body.canary, node: [...walk(root)].map((w) => w.node).find((n): n is ShimElement => n instanceof ShimElement && n.getAttribute("data-flip") === "true") };
    };
    const early = await briefOn("2026-10-12");
    expect(early.api.state).toBe("ok");
    expect(early.api.verdict).toBe("inconclusive");
    expect(early.api.flip).toBeNull();
    expect(early.node).toBeUndefined();
    const late = await briefOn("2026-10-29");
    expect(late.api.verdict).toBe("regressed");
    expect(late.api.flip).toMatch(/^Leave the control arm out, and the verdict goes from regressed to inconclusive/);
    expect(late.node?.textContent).toMatch(/^What would flip it: Leave the control arm out/);
  }, 300_000);

  it("the canary's API carries the same sentence", async () => {
    const res = await fetch(`${ui.server.origin}/api/canary`, { headers: { "x-desk-token": ui.token } });
    const d = (await res.json()) as { state: string; flip: string | null; verdict: string };
    expect(d.state).toBe("ok");
    expect(typeof d.flip).toBe("string");
  });
});
