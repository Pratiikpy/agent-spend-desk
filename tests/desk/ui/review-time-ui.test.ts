import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Gate } from "../../../src/desk/gate/gate.ts";
import { fixedPolicy } from "../../../src/desk/gate/policy-source.ts";
import { openLedger } from "../../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../../src/desk/ledger/ingest.ts";
import { parsePolicyYaml } from "../../../src/desk/policy/parse.ts";
import { loadSnapshot } from "../../../src/desk/pricing/pricebook.ts";
import { startUiServer, type UiServer } from "../../../src/desk/ui/server.ts";
import { assistantLine, humanPromptLine, testSnapshot } from "../helpers.ts";
import { POLICY_YAML } from "../gate/harness.ts";
import { installDom, ShimElement, walk } from "./support/dom-shim.ts";

/** The owner's review time on the Bill screen (DF-088): the wait from each question the gate asked to its approval, at the owner's rate, apart from model spend. */
const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const TOKEN = ["ui", "review", "token", "for", "tests", "0123456789abcdef"].join("-");
let work: string;
const servers: UiServer[] = [];

const start = async (env: Record<string, string>, gate: string | null): Promise<UiServer> => {
  const s = await startUiServer({
    ledgerPath: join(work, "ledger.db"), pricesPath: PRICES, policiesDir: "policies", port: 0, token: TOKEN, env, mode: "own_logs", dossierDbPath: null, gateDbPath: gate,
    nowMs: () => Date.parse("2026-10-21T10:00:00Z"), extra: { dossiersDir: join(work, "none"), pendingDir: join(work, "none"), memoryDir: join(work, "none") },
  } as never);
  servers.push(s);
  return s;
};
const bill = async (s: UiServer): Promise<Record<string, any>> => JSON.parse(await (await fetch(`${s.origin}/api/bill?range=all`, { headers: { "x-desk-token": TOKEN } })).text()) as Record<string, any>;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "desk-review-time-"));
  const log = join(work, "a.jsonl");
  writeFileSync(log, `${[humanPromptLine({ uuid: "p1", session: "s-1", ts: "2026-10-20T10:00:00.000Z" }), assistantLine({ id: "a1", session: "s-1", ts: "2026-10-20T10:01:00.000Z", output: 100_000 }), assistantLine({ id: "a2", session: "s-1", ts: "2026-10-20T11:00:00.000Z", output: 100_000 })].join("\n")}\n`);
  const db = openLedger(join(work, "ledger.db"));
  await ingestClaudeCode(db, [log], loadSnapshot(PRICES));
  db.close();
  // A gate with two questions asked of the owner: one answered after 90 seconds and one never.
  const clock = { ms: Date.parse("2026-10-20T10:05:00.000Z") };
  const gdb = new DatabaseSync(join(work, "gate.db"));
  const gate = new Gate({ db: gdb, prices: testSnapshot(), policy: fixedPolicy(parsePolicyYaml(POLICY_YAML)), now: () => clock.ms, person: "p-1" });
  const ask = (key: string) => gate.authorize({ session_id: "s-1", person: "p-1", project: "repo:acme/api", model: "claude-opus-5", input_tokens: 0, max_tokens: 1000, action: "cap.raise", idempotency_key: key });
  const first = ask("a");
  clock.ms += 90_000;
  ask("b");
  gate.approve({ approval_request_id: first.approvalRequest!.approval_request_id, action_digest: first.approvalRequest!.action_digest }, "owner");
  gdb.close();
}, 120_000);

afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  rmSync(work, { recursive: true, force: true });
});

describe("the Bill's review time", () => {
  it("prices the wait from each request to its approval at $120 an hour unless the owner says otherwise, and counts an unanswered question apart", async () => {
    const r = (await bill(await start({}, join(work, "gate.db"))))["reviewTime"];
    expect(r).toMatchObject({ approvals: 1, unanswered: 1, seconds: 90, usdPerHour: 120, micros: 90 * 33_333 });
    const own = (await bill(await start({ DESK_REVIEW_USD_PER_HOUR: "60" }, join(work, "gate.db"))))["reviewTime"];
    expect(own).toMatchObject({ usdPerHour: 60, micros: 90 * 16_667 });
    // A rate that is not a positive number is ignored, not read as free.
    expect((await bill(await start({ DESK_REVIEW_USD_PER_HOUR: "0" }, join(work, "gate.db"))))["reviewTime"].usdPerHour).toBe(120);
    expect((await bill(await start({ DESK_REVIEW_USD_PER_HOUR: "lots" }, join(work, "gate.db"))))["reviewTime"].usdPerHour).toBe(120);
  });

  it("is null with no gate database, and is not added to the model spend", async () => {
    const none = await bill(await start({}, null));
    expect(none["reviewTime"]).toBeNull();
    const withGate = await bill(await start({}, join(work, "gate.db")));
    expect(withGate["totals"].estimatedMicros).toBe(none["totals"].estimatedMicros);
  });

  it("is drawn as its own section, labelled as reported by the gate, with the wait and the rate in words", async () => {
    const server = await start({}, join(work, "gate.db"));
    const dom = installDom({ origin: server.origin });
    try {
      const api = async (path: string, p: Record<string, string> = {}): Promise<unknown> => {
        const url = new URL(path, server.origin);
        for (const [k, v] of Object.entries(p)) if (v !== "") url.searchParams.set(k, v);
        return (await fetch(url, { headers: { "x-desk-token": TOKEN } })).json();
      };
      const meta = await api("/api/meta");
      const mod = (await import(pathToFileURL(resolve("src/desk/ui/client/screens/bill.js")).href)) as { render(ctx: unknown): Promise<ShimElement> };
      const root = await mod.render({ api, params: new URLSearchParams({ range: "all" }), meta, range: "all", link: (x: string) => `#/${x}`, navigate() {}, rerender() {} });
      const note = [...walk(root)].map((w) => w.node).find((n): n is ShimElement => n instanceof ShimElement && n.getAttribute("data-review-time") === "true");
      expect(note?.textContent).toBe("1 question the gate asked was answered, after 1.5 minutes of waiting in all: $3.00 of your time at $120 an hour. 1 more has no answer yet and costs nothing until it is answered.");
      expect(root.textContent).toContain("Your review time");
      expect(root.textContent).toContain("not part of what the models cost");
    } finally {
      dom.restore();
    }
  });
});
