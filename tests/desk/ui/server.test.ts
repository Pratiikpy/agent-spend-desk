import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findJsonlLogs } from "../../../src/desk/ingest/discover.ts";
import { openLedger } from "../../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../../src/desk/ledger/ingest.ts";
import { linkOutcomes } from "../../../src/desk/outcomes/link.ts";
import { readCsvInvoice } from "../../../src/desk/billing/import.ts";
import { storeInvoice } from "../../../src/desk/billing/store.ts";
import { assignTasks } from "../../../src/desk/tasks/assign.ts";
import { hashModels, loadSnapshot, parseSnapshot } from "../../../src/desk/pricing/pricebook.ts";
import { repriceLedger } from "../../../src/desk/pricing/reprice.ts";
import { buildSample, sampleLogsDir, sampleReposDir } from "../../../src/desk/sample/gen.ts";
import { TEAM_OF_REPO } from "../../../src/desk/silo/seed.ts";
import { startUiServer, type UiServer } from "../../../src/desk/ui/server.ts";

const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const TOKEN = ["ui", "launch", "token", "for", "tests", "0123456789abcdef"].join("-");

let dir: string;
let full: UiServer;
let empty: UiServer;
let broken: UiServer;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "desk-ui-"));
  const out = join(dir, "sample");
  buildSample({ outDir: out, seed: 3, months: 0.4, engineers: 6 });
  const dbPath = join(dir, "ledger.db");
  const db = openLedger(dbPath);
  await ingestClaudeCode(db, findJsonlLogs(sampleLogsDir(out)), loadSnapshot(PRICES));
  linkOutcomes(db, Object.keys(TEAM_OF_REPO).map((n) => join(sampleReposDir(out), n)), Date.parse("2026-12-01T00:00:00Z"));
  assignTasks(db, []);
  // An invoice for the busiest month that says what the estimate says, model by model, so the month reconciles.
  const month = (db.prepare("SELECT substr(ts, 1, 7) m FROM model_call GROUP BY m ORDER BY COUNT(*) DESC LIMIT 1").get() as { m: string }).m;
  const perModel = db.prepare("SELECT m.model model, SUM(c.total_micros) micros FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated' WHERE substr(m.ts, 1, 7) = ? AND m.model LIKE 'claude%' GROUP BY m.model").all(month) as unknown as { model: string; micros: number }[];
  storeInvoice(db, readCsvInvoice(["model,cost_usd", ...perModel.map((r) => `${r.model},${(r.micros / 1e6).toFixed(6)}`)].join("\n"), { sourceName: "month.csv", period: month }));
  // A price corrected after the logs were read: the busiest model's output price goes up by $1 per million tokens.
  const busiest = (db.prepare("SELECT model FROM model_call GROUP BY model ORDER BY COUNT(*) DESC LIMIT 1").get() as { model: string }).model;
  const base = loadSnapshot(PRICES);
  const models = { ...base.models, [busiest]: { ...base.models[busiest]!, outputPerMTokMicros: base.models[busiest]!.outputPerMTokMicros + 1_000_000 } };
  repriceLedger(db, parseSnapshot({ ...base, snapshotId: `${base.snapshotId}-corrected`, models, contentHash: hashModels(models) }), { reason: "output price corrected" });
  db.close();
  const emptyPath = join(dir, "empty.db");
  openLedger(emptyPath).close();
  const brokenPath = join(dir, "broken.db");
  writeFileSync(brokenPath, "this is not a sqlite database at all");
  const common = { pricesPath: PRICES, policiesDir: "policies", port: 0, token: TOKEN, env: {}, extra: { dossiersDir: join(dir, "none"), pendingDir: join(dir, "none"), memoryDir: join(dir, "memory"), cassetteDir: join(dir, "none") } };
  full = await startUiServer({ ...common, ledgerPath: dbPath, mode: "sample" });
  empty = await startUiServer({ ...common, ledgerPath: emptyPath, mode: "own_logs" });
  broken = await startUiServer({ ...common, ledgerPath: brokenPath, mode: "own_logs" });
}, 180_000);

afterAll(async () => {
  await Promise.all([full?.close(), empty?.close(), broken?.close()]);
  rmSync(dir, { recursive: true, force: true });
});

async function get(s: UiServer, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; text: string }> {
  const res = await fetch(`${s.origin}${path}`, { headers });
  return { status: res.status, headers: res.headers, text: await res.text() };
}
const api = (s: UiServer, path: string) => get(s, path, { "x-desk-token": TOKEN });
const json = async (s: UiServer, path: string): Promise<Record<string, any>> => JSON.parse((await api(s, path)).text) as Record<string, any>;

/** An HTTP request with exactly the Host header and method given, which fetch will not let a script set. */
function raw(s: UiServer, opts: { path: string; method?: string; host?: string; origin?: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: s.port, path: opts.path, method: opts.method ?? "GET", headers: { Host: opts.host ?? `127.0.0.1:${s.port}`, ...(opts.origin ? { Origin: opts.origin } : {}), "x-desk-token": TOKEN } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("the server's doors", () => {
  it("serves the page without a token and refuses every API call without one", async () => {
    expect((await get(full, "/")).status).toBe(200);
    expect((await get(full, "/api/meta")).status).toBe(401);
    expect((await get(full, "/api/meta", { "x-desk-token": "wrong-token-wrong-token" })).status).toBe(401);
    expect((await get(full, "/api/meta", { "x-desk-token": "" })).status).toBe(401);
    expect((await get(full, `/api/meta?t=${TOKEN}`)).status).toBe(200);
  });

  it("sends the security headers on every answer and loads nothing from elsewhere", async () => {
    const page = await get(full, "/");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(page.headers.get("content-security-policy")).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.text).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|www\.w3\.org)/);
  });

  it("refuses a foreign Host header, a foreign Origin, and every method but GET and HEAD", async () => {
    expect(await raw(full, { path: "/api/meta", host: "evil.example" })).toBe(403);
    expect(await raw(full, { path: "/api/meta", host: `localhost:${full.port}` })).toBe(200);
    expect(await raw(full, { path: "/api/meta", origin: "http://evil.example" })).toBe(403);
    expect(await raw(full, { path: "/api/meta", origin: `http://127.0.0.1:${full.port}` })).toBe(200);
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) expect(await raw(full, { path: "/api/meta", method }), method).toBe(405);
    expect(await raw(full, { path: "/api/meta", method: "HEAD" })).toBe(200);
  });

  it("serves only files it listed at start: no traversal, no encoded dots, no absolute paths", async () => {
    for (const p of ["/../package.json", "/%2e%2e/package.json", "/..%2fpackage.json", "/fonts/../../package.json", "//etc/passwd", "/styles.css/../../package.json", "/screens/../../../package.json", "/.env", "/src/desk/cli.ts"]) {
      const r = await get(full, p).catch(() => ({ status: 0, text: "" }));
      expect([400, 403, 404, 0], p).toContain(r.status);
      expect(r.text).not.toContain("plumbline");
    }
    expect((await get(full, "/styles.css")).status).toBe(200);
    expect((await get(full, "/fonts/Outfit-Regular.ttf")).status).toBe(200);
    expect((await get(full, "/fonts/nonexistent.ttf")).status).toBe(404);
  });

  it("refuses a URL that is too long", async () => {
    expect((await get(full, `/${"a".repeat(3000)}`)).status).toBe(414);
  });
});

describe("the screens' data", () => {
  it("lists the screens, the ledger span and the price snapshot", async () => {
    const m = await json(full, "/api/meta");
    expect(m.screens.map((s: { id: string }) => s.id)).toEqual(["brief", "week", "bill", "autopsy", "sessions", "outcomes", "policy", "canary", "ask", "organisation", "team", "dossiers", "evidence", "sources"]);
    expect(m.calls).toBeGreaterThan(100);
    expect(m.mode).toBe("sample");
  });

  it("gives every screen real figures that agree with each other", async () => {
    const bill = await json(full, "/api/bill?range=all");
    const autopsy = await json(full, "/api/autopsy?hours=5&days=30");
    const outcomes = await json(full, "/api/outcomes?range=all");
    const brief = await json(full, "/api/brief");
    expect(bill.state).toBe("ok");
    expect(bill.totals.estimatedMicros).toBeGreaterThan(0);
    expect(bill.landing.totalMicros).toBe(outcomes.landing.totalMicros);
    expect(bill.landing.rows.reduce((s: number, r: { micros: number }) => s + r.micros, 0)).toBe(bill.landing.totalMicros);
    expect(autopsy.card.causes.reduce((s: number, c: { micros: number }) => s + c.micros, 0)).toBe(autopsy.card.totals.estimatedMicros);
    expect(brief.state).toBe("ok");
    expect(brief.causes.length).toBeGreaterThan(0);
  });

  it("shows what the imported invoice says, and a reconciliation of the month against the estimate", async () => {
    const bill = await json(full, "/api/bill?range=all");
    const billed = bill.classes.find((c: { cls: string }) => c.cls === "billed");
    expect(billed.invoices).toBe(1);
    expect(billed.micros).toBeGreaterThan(0);
    expect(billed.note).toMatch(/imported invoice/);
    expect(bill.reconciliations.length).toBeGreaterThan(0);
    const row = bill.reconciliations.find((r: { billedMicros: number | null }) => r.billedMicros !== null);
    expect(row.vendor).toBe("anthropic");
    expect(row.billedMicros).toBe(billed.micros);
    expect(["reconciled", "partial", "unreconciled"]).toContain(row.status);
  });

  it("says on the Bill that the ledger was repriced, to which snapshot and why, and keeps the other screens in step with it", async () => {
    const bill = await json(full, "/api/bill?range=all");
    const autopsy = await json(full, "/api/autopsy?hours=5&days=30");
    expect(bill.pricing.repricings[0]).toMatchObject({ reason: "output price corrected" });
    expect(bill.pricing.repricings[0].snapshot).toMatch(/-corrected$/);
    expect(bill.pricing.repricings[0].calls).toBeGreaterThan(0);
    expect(bill.pricing.repricings[0].deltaMicros).toBeGreaterThan(0);
    expect(autopsy.card.causes.reduce((s: number, c: { micros: number }) => s + c.micros, 0)).toBe(autopsy.card.totals.estimatedMicros);
    // The screens read the one cost the ledger now holds: the Bill's landing split still adds up to its own total after the repricing.
    expect(bill.landing.rows.reduce((t: number, r: { micros: number }) => t + r.micros, 0)).toBe(bill.landing.totalMicros);
  });

  it("gives the weekly review for a named week and for the default, and never more spend than the Bill holds", async () => {
    const dflt = await json(full, "/api/week");
    expect(dflt.state).toBe("ok");
    expect(dflt.weeks.length).toBeGreaterThan(0);
    expect(dflt.weeks.length).toBeLessThanOrEqual(8);
    expect([...dflt.weeks].sort().reverse()).toEqual(dflt.weeks);
    const label = dflt.review.week.label;
    expect(label).toMatch(/^\d{4}-W\d{2}$/);
    const named = await json(full, `/api/week?week=${label}`);
    expect(named.review.spend).toEqual(dflt.review.spend);
    // The week's spend is the Bill's spend over the same days.
    const bill = await json(full, `/api/bill?range=all`);
    expect(named.review.spend.micros).toBeLessThanOrEqual(bill.totals.estimatedMicros);
    expect(named.review.suggestions.length).toBeLessThanOrEqual(3);
    expect(named.review.trend).toHaveLength(4);
    expect((await api(full, "/api/week?week=nonsense")).status).toBe(400);
  });

  it("lists the open owner questions with the command that answers one, and no path", async () => {
    const outcomes = await json(full, "/api/outcomes?range=all");
    expect(outcomes.questions.open).toBeGreaterThanOrEqual(outcomes.questions.top.length);
    expect(outcomes.questions.top.length).toBeLessThanOrEqual(5);
    for (const q of outcomes.questions.top) {
      expect(q.id).toMatch(/^q-[0-9a-f]{8}$/);
      expect(q.sha).toMatch(/^[0-9a-f]{7}$/);
      expect(q.project).not.toMatch(/[\\/]/);
    }
  });

  it("shows how sessions were grouped into tasks, and the same spend as the other screens", async () => {
    const outcomes = await json(full, "/api/outcomes?range=all");
    const bill = await json(full, "/api/bill?range=all");
    expect(outcomes.tasks.assigned).toBe(true);
    expect(outcomes.tasks.methods.map((m: { method: string }) => m.method)).toEqual(["explicit", "ticket", "pull_request", "branch", "session"]);
    const total = outcomes.tasks.methods.reduce((s: number, m: { micros: number }) => s + m.micros, 0);
    expect(total).toBe(bill.totals.estimatedMicros);
    expect(outcomes.tasks.top.length).toBeGreaterThan(0);
    expect(outcomes.tasks.top.every((t: { micros: number }) => t.micros > 0)).toBe(true);
  });

  it("gives the evidence screen a state for every block, and says plainly which are not recorded", async () => {
    const e = await json(full, "/api/evidence");
    expect(e.state).toBe("ok");
    for (const k of ["benchmark", "route", "seats", "links", "tunnel", "regret", "learning"]) expect(["ok", "missing"], k).toContain(e[k].state);
    for (const k of ["benchmark", "route", "seats", "links", "tunnel", "regret", "learning"]) if (e[k].state === "missing") expect(String(e[k].hint).length, k).toBeGreaterThan(10);
  });

  it("lists sessions and opens one with its calls and commits", async () => {
    const list = await json(full, "/api/sessions?range=all&sort=cost&limit=5");
    expect(list.rows).toHaveLength(5);
    expect(list.rows[0].micros).toBeGreaterThanOrEqual(list.rows[1].micros);
    const one = await json(full, `/api/session?id=${encodeURIComponent(list.rows[0].id)}`);
    expect(one.state).toBe("ok");
    expect(one.calls.length).toBe(one.callCount);
    expect(JSON.stringify(one)).not.toMatch(/[A-Za-z]:\\\\|\/home\/|\/Users\//);
  });

  it("never sends an absolute path to the browser", async () => {
    for (const p of ["/api/brief", "/api/bill?range=all", "/api/sessions?range=all", "/api/outcomes?range=all", "/api/sources", "/api/policy?range=all"]) {
      const text = (await api(full, p)).text;
      expect(text, p).not.toMatch(/[A-Za-z]:\\\\Users|\/Users\/|\/home\//);
    }
  });

  it("checks one policy against another and replays it", async () => {
    const p = await json(full, "/api/policy?range=all&from=daily-cap.yaml&to=stop-loops.yaml");
    expect(p.state).toBe("ok");
    expect(p.restrict).toMatchObject({ from: "daily-cap.yaml", to: "stop-loops.yaml" });
    expect(p.replay.sessions).toBeGreaterThan(0);
    expect(p.files.map((f: { name: string }) => f.name)).toContain("stop-loops.yaml");
  });

  it("says, tool by tool, what the Desk can actually stop, and never calls anything enforced without a recorded test", async () => {
    const p = await json(full, "/api/policy?range=all");
    const rows = p.enforcement as { tool: string; level: string; reason: string }[];
    expect(rows.map((r) => r.tool)).toContain("claude_code");
    expect(rows.find((r) => r.tool === "cursor")).toMatchObject({ level: "notify_only" });
    expect(rows.find((r) => r.tool === "cursor")!.reason).toContain("notify only");
    // The fixture has no recorded results of its own: the shared results file may or may not exist on the machine running this, so only what cannot depend on it is asserted.
    for (const r of rows) expect(["enforced", "advisory", "notify_only"]).toContain(r.level);
    expect(rows.find((r) => r.tool === "codex")!.level).not.toBe("enforced");
  });

  it("answers a question, refuses an action, and says unknowable for nonsense", async () => {
    const a = await json(full, `/api/ask?q=${encodeURIComponent("How much did we spend?")}`);
    expect(a.status).toBe("answered");
    expect(a.sentences.length).toBeGreaterThan(0);
    expect((await json(full, `/api/ask?q=${encodeURIComponent("Set the cap to $1")}`)).status).toBe("refused");
    expect((await json(full, `/api/ask?q=${encodeURIComponent("what is the meaning of life")}`)).status).toBe("unknowable");
    const off = await json(full, `/api/ask?q=${encodeURIComponent("What changed before 2026-10-15?")}&ablate=world_model`);
    expect(off.ablated).toEqual(["world_model"]);
  });

  it("lists no dossiers and no silos honestly when there are none", async () => {
    const d = await json(full, "/api/dossiers");
    expect(d.bundles).toEqual([]);
    const s = await json(full, "/api/silos");
    expect(s.available).toBe(false);
    expect(s.classes.billedMicros).toBe(0);
  });

  it("reports sources and configured services without printing a key", async () => {
    const s = await json(full, "/api/sources");
    expect(s.state).toBe("ok");
    expect(s.endpoints.every((e: { configured: boolean }) => e.configured === false)).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/nvapi|sk-/);
  });

  it("lists where data can leave this machine, from the settings, with the egress log's totals and never a request's text", async () => {
    const s = await json(full, "/api/sources");
    expect(s.egress.profile).toBe("standard");
    // The test server runs with no model or Zetaris setting, so the only declared destination is the local gate.
    expect(s.egress.destinations.map((d: { kind: string; loopback: boolean }) => [d.kind, d.loopback])).toEqual([["gate", true]]);
    expect(s.egress.log).toMatchObject({ requests: expect.any(Number), bytes: expect.any(Number), redactions: expect.any(Number) });
    expect(JSON.stringify(s.egress)).not.toMatch(/messages|content/);
  });
});

describe("bad input and bad ledgers", () => {
  it("refuses junk parameters with a 400 and a reason", async () => {
    for (const p of ["/api/bill?range=abc", "/api/bill?range=0", "/api/bill?range=99999", "/api/sessions?sort=drop", "/api/sessions?limit=-1", "/api/sessions?offset=x", "/api/autopsy?hours=0", "/api/autopsy?days=1e9", "/api/week?week=nonsense", "/api/week?week=2021-W53", "/api/ask?q=x&ablate=nonsense"]) {
      const r = await api(full, p);
      expect(r.status, p).toBe(400);
      expect(JSON.parse(r.text).message.length).toBeGreaterThan(0);
    }
    expect((await api(full, `/api/ask?q=${"x".repeat(600)}`)).status).toBe(400);
  });

  it("says a session does not exist, and refuses an empty or huge id", async () => {
    expect((await json(full, "/api/session?id=nope")).state).toBe("empty");
    expect((await api(full, "/api/session?id=")).status).toBe(400);
    expect((await api(full, `/api/session?id=${"a".repeat(300)}`)).status).toBe(400);
  });

  it("shows an empty state, not an error, for an empty ledger", async () => {
    for (const p of ["/api/brief", "/api/bill", "/api/autopsy", "/api/sessions", "/api/outcomes"]) expect((await json(empty, p)).state, p).toBe("empty");
  });

  it("starts on a file that is not a ledger and says so on every screen", async () => {
    expect(broken.ledgerProblem).toMatch(/could not be opened|not a database/i);
    const b = await json(broken, "/api/brief");
    expect(b.state).toBe("empty");
    expect(b.reason).toMatch(/could not be opened|not a database/i);
  });

  it("opens the ledger read-only: nothing in the file changes while screens are read", async () => {
    const before = statSync(join(dir, "ledger.db")).mtimeMs;
    for (const p of ["/api/brief", "/api/bill", "/api/outcomes", "/api/policy", "/api/ask?q=How%20much%20did%20we%20spend%3F"]) await api(full, p);
    expect(statSync(join(dir, "ledger.db")).mtimeMs).toBe(before);
  });
});

describe("the client code", () => {
  const root = join(process.cwd(), "src", "desk", "ui", "client");
  const files: string[] = [];
  const walk = (d: string): void => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : files.push(join(d, n))));
  walk(root);

  it("has a screen for every registered screen and requests nothing from another origin", () => {
    for (const id of ["brief", "week", "bill", "autopsy", "sessions", "outcomes", "policy", "canary", "ask", "organisation", "team", "dossiers", "sources"]) expect(files.some((f) => f.endsWith(`${id}.js`)), id).toBe(true);
    for (const f of files.filter((x) => /\.(js|html|css)$/.test(x))) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
      expect(text, f).not.toMatch(/\binnerHTML\b|\binsertAdjacentHTML\b|\beval\(|new Function\(/);
    }
  });

  it("sets no inline style attribute, which the page's policy would block", () => {
    for (const f of files.filter((x) => x.endsWith(".js"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/\bstyle\s*:\s*["'`][a-z-]+\s*:/i);
  });
});
