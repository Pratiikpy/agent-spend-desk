import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeCommand, type CloseOptions } from "../../src/desk/close/command.ts";
import { isMonthLabel, lastCompleteMonth, monthBillInput, monthSpan, readMonthRows, summarise, type CostRow } from "../../src/desk/close/month-bill.ts";
import { buildDossier, BuildError } from "../../src/desk/dossier/build.ts";
import { ephemeralSigner } from "../../src/desk/dossier/keys.ts";
import { MemoryLog } from "../../src/desk/dossier/log.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { recomputeCosts, recordSnapshot } from "../../src/desk/ledger/ingest.ts";
import { hashModels, parseSnapshot, type PriceSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { verifyBundle } from "../../src/desk/verify/verify.ts";
import { OPUS5, SONNET55 } from "./helpers.ts";

const tmp = mkdtempSync(join(tmpdir(), "desk-close-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Opus 5 with the three price rules the ledger can carry: a long-prompt tier, a fast mode, and the US-only multiplier. */
function snapshot(): PriceSnapshot {
  const models = {
    "claude-opus-5": {
      ...OPUS5,
      longPrompt: { overPromptTokens: 200_000, inputPerMTokMicros: 10_000_000, outputPerMTokMicros: 37_500_000, cacheReadPerMTokMicros: 1_000_000, cacheWrite5mPerMTokMicros: 12_500_000, cacheWrite1hPerMTokMicros: 20_000_000 },
      fast: { inputPerMTokMicros: 10_000_000, outputPerMTokMicros: 50_000_000 },
      usOnly: true,
    },
    "claude-sonnet-5-5": SONNET55,
  };
  return parseSnapshot({ snapshotId: "month-test", source: "test", sourceUrl: "https://example.invalid/p.json", fetchedAt: "2026-09-01T00:00:00.000Z", license: "test", upstreamSha256: "0".repeat(64), note: "test", contentHash: hashModels(models as never), models });
}

interface Seed {
  session: string;
  ts: string;
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  speed?: string | null;
  geo?: string | null;
  state?: "kept" | "merged" | "committed" | "reverted" | "unlinked";
  conf?: "low" | "high";
}

function seedLedger(path: string, seeds: Seed[], snap: PriceSnapshot = snapshot()): Ledger {
  const db = openLedger(path);
  const seen = new Set<string>();
  let n = 0;
  for (const s of seeds) {
    if (!seen.has(s.session)) {
      seen.add(s.session);
      db.prepare("INSERT INTO session (session_id, tool, project_path, git_branch, started_at, ended_at, tool_version) VALUES (?, 'claude_code', 'D:/work/shop', 'main', ?, ?, '1')").run(s.session, s.ts, s.ts);
      if (s.state) db.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, ?, ?, 1, 't')").run(s.session, s.state, s.conf ?? "high");
    }
    n += 1;
    db.prepare(
      "INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error, speed, inference_geo) VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?, 0, 0, 'reported', 0, 0, ?, ?)",
    ).run(`c${n}`, s.session, s.ts, s.model ?? "claude-opus-5", s.input ?? 0, s.output ?? 0, s.cacheRead ?? 0, s.speed ?? null, s.geo ?? null);
  }
  recordSnapshot(db, snap);
  recomputeCosts(db, snap, new Set(Array.from({ length: n }, (_, i) => `c${i + 1}`)), { unpricedCalls: 0, unpricedModels: {} });
  return db;
}

const D = (day: number, hour = 10): string => `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

const SEEDS: Seed[] = [
  { session: "a", ts: D(1), output: 100_000, state: "kept" }, // $2.50
  { session: "a", ts: D(1, 11), output: 100_001, state: "kept" }, // $2.500025 -> a rounding case
  { session: "b", ts: D(2), output: 200_000, state: "merged" }, // $5.00
  { session: "c", ts: D(3), output: 40_000, state: "committed" }, // $1.00
  { session: "d", ts: D(4), output: 100_000, state: "reverted" }, // $2.50
  { session: "e", ts: D(5), output: 100_000, model: "claude-sonnet-5-5" }, // $1.00, no outcome: unlinked
  { session: "f", ts: D(6), output: 20_000, state: "unlinked", conf: "low" }, // $0.50
  { session: "g", ts: D(7), input: 150_000, cacheRead: 100_000, output: 1_000 }, // long prompt: 250k prompt tokens at the long tier
  { session: "h", ts: D(8), output: 100_000, speed: "fast" }, // fast mode: $5.00
  { session: "i", ts: D(9), output: 100_000, geo: "us" }, // US-only: $2.75
  { session: "j", ts: D(10), output: 50_000, model: "claude-mystery-1" }, // no price
  { session: "k", ts: D(30), output: 100_000, state: "merged" }, // the last day of the month
  { session: "l", ts: "2026-10-01T00:00:00.000Z", output: 999_000 }, // outside the month
  { session: "m", ts: "2026-08-31T23:59:59.999Z", output: 999_000 }, // outside the month
];

describe("month labels", () => {
  it("accepts a month and refuses anything else", () => {
    expect(isMonthLabel("2026-09")).toBe(true);
    for (const bad of ["2026-9", "2026-13", "2026-00", "26-09", "2026-09-01", "September", ""]) expect(isMonthLabel(bad)).toBe(false);
    expect(() => monthSpan("2026-13")).toThrowError(/2026-09/);
  });

  it("spans a month from its first instant to the first instant of the next, and knows leap years and the new year", () => {
    expect(monthSpan("2026-09")).toMatchObject({ since: "2026-09-01T00:00:00.000Z", until: "2026-10-01T00:00:00.000Z", firstDay: "2026-09-01", lastDay: "2026-09-30" });
    expect(monthSpan("2028-02").lastDay).toBe("2028-02-29");
    expect(monthSpan("2027-02").lastDay).toBe("2027-02-28");
    expect(monthSpan("2026-12")).toMatchObject({ until: "2027-01-01T00:00:00.000Z", lastDay: "2026-12-31" });
  });

  it("defaults to the last month that has ended", () => {
    expect(lastCompleteMonth(new Date("2026-10-25T12:00:00Z"))).toBe("2026-09");
    expect(lastCompleteMonth(new Date("2026-01-01T00:00:00Z"))).toBe("2025-12");
    expect(lastCompleteMonth(new Date("2026-03-31T23:59:59Z"))).toBe("2026-02");
  });
});

describe("the month's rows", () => {
  const snap = snapshot();
  const db = seedLedger(":memory:", SEEDS, snap);
  const rows = readMonthRows(db, "2026-09", new Map([[snap.snapshotId, snap]]), snap);
  const s = summarise(rows);

  it("holds exactly the calls of the month, none of the neighbours", () => {
    expect(s.calls).toBe(12);
    expect(rows.cost.every((r) => r.day.startsWith("2026-09"))).toBe(true);
    expect(rows.cost.some((r) => r.day === "2026-09-30")).toBe(true);
  });

  it("adds up to what the ledger says, split by landing state", () => {
    const total = (db.prepare("SELECT SUM(c.total_micros) t FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated' WHERE m.ts >= '2026-09-01' AND m.ts < '2026-10-01'").get() as { t: number }).t;
    expect(s.pricedMicros).toBe(total);
    expect(s.landedMicros).toBe(2_500_000 + 2_500_025 + 5_000_000 + 2_500_000 /* k */);
    expect(s.committedMicros).toBe(1_000_000);
    expect(s.revertedMicros).toBe(2_500_000);
    expect(s.weakMicros).toBe(500_000);
    expect(s.landedMicros + s.committedMicros + s.revertedMicros + s.unlinkedMicros).toBe(s.pricedMicros);
    expect(s.unpricedCalls).toBe(1);
  });

  it("keeps the rule-priced calls apart so a stranger can price them", () => {
    const long = rows.cost.filter((r) => r.tier === "long");
    expect(long).toHaveLength(1);
    expect(long[0]).toMatchObject({ calls: 1, input_tokens: 150_000, cache_read_tokens: 100_000, cost_micros: 150_000 * 10 + 100_000 * 1 + 1_000 * 37.5 });
    expect(rows.cost.find((r) => r.speed === "fast")).toMatchObject({ cost_micros: 5_000_000 });
    expect(rows.cost.find((r) => r.inference_geo === "us")).toMatchObject({ cost_micros: 2_750_000 });
    expect(rows.cost.find((r) => !r.priced)).toMatchObject({ model: "claude-mystery-1", cost_micros: 0, class: "unpriced" });
  });

  it("carries no session id, path or branch: nothing personal is in a row", () => {
    const text = JSON.stringify(rows);
    for (const secret of ["D:/work", "shop", "main", '"a"', "session"]) expect(text).not.toContain(secret);
  });

  it("says why a bill cannot be built when the ledger cites a price snapshot it was not given, or disagrees on a price", () => {
    const missing = readMonthRows(db, "2026-09", new Map(), snap);
    expect(missing.problems.join(" ")).toMatch(/month-test.*not among the price files/);
    const stale = parseSnapshot({ ...JSON.parse(JSON.stringify(snap)), snapshotId: "month-test", models: { "claude-opus-5": OPUS5 }, contentHash: hashModels({ "claude-opus-5": OPUS5 }) });
    const disagree = readMonthRows(db, "2026-09", new Map([["month-test", stale]]), stale);
    expect(disagree.problems.join(" ")).toMatch(/desk reprice/);
  });
});

describe("the month bill dossier", () => {
  const snap = snapshot();
  const db = seedLedger(":memory:", SEEDS, snap);
  const snapshots = new Map([[snap.snapshotId, snap]]);
  const signer = ephemeralSigner();
  const rows = readMonthRows(db, "2026-09", snapshots, snap);
  const bill = monthBillInput(rows, { snapshots, signer, tenant: "local", now: new Date("2026-10-02T00:00:00Z") });
  const built = buildDossier(bill.input);
  const pins = { version: 1 as const, keys: [{ keyid: signer.keyid, publicKey: signer.publicKey }] };

  it("verifies, level by level, with the signer's key pinned", () => {
    const report = verifyBundle(built.files, { pins });
    expect(report.overall).toBe("PASS");
    const byId = Object.fromEntries(report.levels.map((l) => [l.id, l.status]));
    expect(byId["V6-D"]).toBe("PASS");
    expect(byId["V8-D"]).toBe("PASS");
  });

  it("reads, beside the pass, how many of the citations in its sentences the sentences need, and does not fail a dossier for a decorative one", () => {
    const v8 = verifyBundle(built.files, { pins }).levels.find((l) => l.id === "V8-D")!;
    const note = v8.notes.find((n) => n.startsWith("citations: "));
    expect(note).toMatch(/^citations: \d+ of \d+ citations are needed by the sentence that makes them/);
    expect(v8.status).toBe("PASS");
  });

  it("states the figures the summary holds", () => {
    const claims = new Map<string, { value?: number; class?: string }>();
    for (const l of new TextDecoder().decode(built.files.get("claims.jsonl")).split("\n").filter(Boolean)) {
      const c = JSON.parse(l) as { type: string; id: string; value?: number; class?: string };
      if (c.type === "claim") claims.set(c.id, c);
    }
    expect(claims.get("spend")).toMatchObject({ value: Math.round(bill.summary.pricedMicros / 10_000) / 100, class: "estimated" });
    expect(claims.get("calls")?.value).toBe(12);
    expect(claims.get("unpriced")?.value).toBe(1);
    expect(claims.get("long_prompt")?.value).toBe(1);
    expect(claims.has("billed")).toBe(false); // no invoice, so no billed claim: the bill never invents the class
    expect(claims.get("committed")?.value).toBe(1);
  });

  it("is not a dossier a stranger can fool by changing a figure: a changed token count, cost or tier is refused", () => {
    const retarget = (edit: (r: CostRow) => void) => {
      const copy = JSON.parse(JSON.stringify(rows)) as typeof rows;
      edit(copy.cost.find((r) => r.priced && r.model === "claude-opus-5" && r.speed === "" && r.tier === "std" && r.calls === 2)!);
      return () => buildDossier(monthBillInput(copy, { snapshots, signer, tenant: "local", now: new Date() }).input);
    };
    // 2 calls of 100,000 and 100,001 output tokens: exactly 5,000,025 micro-USD, which the ledger recorded.
    expect(retarget(() => undefined)).not.toThrow();
    expect(retarget((r) => (r.cost_micros += 1))).not.toThrow(); // two calls may each have rounded half a micro-USD up
    expect(retarget((r) => (r.cost_micros += 2))).toThrowError(/further off than rounding allows/); // two micro-USD is more than two calls can round by
    expect(retarget((r) => (r.cost_micros -= 2))).toThrowError(/further off than rounding allows/);
    expect(retarget((r) => (r.output_tokens += 1_000_000))).toThrowError(BuildError);
    expect(retarget((r) => (r.tier = "long"))).toThrowError(/long-prompt/);
    expect(retarget((r) => (r.priced = false))).toThrowError(/marked unpriced/);
    expect(retarget((r) => (r.model = "claude-mystery-1"))).toThrowError(/marked priced, but the snapshot has no price/);
    expect(retarget((r) => (r.snapshot_id = "elsewhere"))).toThrowError(/snapshot/);
  });

  it("a fast-mode row priced at standard rates, or a standard row priced as fast, is refused", () => {
    const wrong = (edit: (r: CostRow) => void) => {
      const copy = JSON.parse(JSON.stringify(rows)) as typeof rows;
      edit(copy.cost.find((r) => r.speed === "fast")!);
      return () => buildDossier(monthBillInput(copy, { snapshots, signer, tenant: "local", now: new Date() }).input);
    };
    expect(wrong((r) => (r.cost_micros = 2_500_000))).toThrowError(/further off than rounding allows/);
    expect(wrong((r) => (r.speed = ""))).toThrowError(/further off than rounding allows/);
  });

  it("refuses to build when the month holds no call", () => {
    const none = readMonthRows(db, "2025-01", snapshots, snap);
    expect(() => monthBillInput(none, { snapshots, signer, tenant: "local", now: new Date() })).toThrowError(/no call in 2025-01/);
  });

  it("the rounding bound is exact: a half either way is allowed one way and refused the other", () => {
    // One call of 100,000 output tokens at $25 per million is exactly 2,500,000 micro-USD. A call whose numerator ends in .5 rounds up.
    const row = (cost: number, tokens: { out?: number; read?: number } = {}) => ({ day: "2026-09-01", model: "claude-opus-5", snapshot_id: snap.snapshotId, speed: "", inference_geo: "", tier: "std", priced: true, landing: "unlinked", weak: false, class: "estimated", calls: 1, input_tokens: 0, output_tokens: tokens.out ?? 0, cache_read_tokens: tokens.read ?? 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, cost_micros: cost });
    const build = (data: ReturnType<typeof row>) => {
      const l = new MemoryLog();
      l.append("month_cost", "calls", data);
      return () =>
        buildDossier({ kind: "month_bill", tenant: "t", period: { from: "2026-09-01", to: "2026-09-30" }, createdAt: "2026-10-01T00:00:00.000Z", audience: "auditor", disclosure: "full", log: l.rows, claims: [{ id: "spend", kind: "number", text: "Spend", unit: "usd", class: "estimated", decimals: 2, divisor: 1_000_000, computation: { fn: "cost_bounds@1", args: {}, range: { stream: "month_cost", from: 0, to: 0 } } }], snapshots: [snap], signer });
    };
    expect(build(row(2_500_000, { out: 100_000 }))).not.toThrow();
    expect(build(row(2_500_001, { out: 100_000 }))).toThrowError(/further off/); // off by a whole micro-USD for one call: more than half
    // One cache-read token costs exactly half a micro-USD at $0.50 per million, which the ledger rounds up to 1.
    expect(build(row(1, { read: 1 }))).not.toThrow();
    expect(build(row(0, { read: 1 }))).toThrowError(/further off/); // rounding down at exactly a half is not what the ledger does
    expect(build(row(2, { read: 1 }))).toThrowError(/further off/);
  });
});

describe("desk close", () => {
  const dir = join(tmp, "close");
  const prices = join(dir, "prices");
  const base = (over: Partial<CloseOptions> = {}): CloseOptions => ({
    dbPath: join(dir, "ledger.db"),
    pricesPath: join(prices, "snapshot.json"),
    pricesDir: prices,
    month: "2026-09",
    now: new Date("2026-10-02T00:00:00Z"),
    sign: false,
    askApproval: false,
    canaryRunsPath: join(dir, "no-canary.jsonl"),
    sample: false,
    keyPath: join(dir, "signer.key.pem"),
    dossierDir: join(dir, "dossiers"),
    propose: { minUsd: "2.00", cassetteDir: join(dir, "cassettes"), record: false, sampleMode: true, personFromBranch: false, outDir: join(dir, "proposals"), env: {} },
    ...over,
  });

  beforeAll(() => {
    mkdirSync(prices, { recursive: true });
    writeFileSync(join(prices, "snapshot.json"), JSON.stringify(snapshot()));
    writeFileSync(join(prices, "supplement.json"), JSON.stringify({ not: "a snapshot" }));
    seedLedger(join(dir, "ledger.db"), SEEDS).close();
  });

  it("reports every step without writing anything, and says what each missing piece would change", async () => {
    const r = await closeCommand(base());
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/Month close for 2026-09 \(UTC\)\n/);
    expect(r.text).toMatch(/\$[\d,]+\.\d\d estimated at list price over 12 calls \(1 on a model with no price/);
    expect(r.text).toMatch(/Billed: no invoice is imported for this month/);
    expect(r.text).toMatch(/anthropic: unreconciled \(estimated \$[\d.,]+, nothing billed on record\)/);
    expect(r.text).toMatch(/1 of 1 vendor month is not reconciled; it stays listed/);
    expect(r.text).toMatch(/No canary runs are stored at/);
    expect(r.text).toMatch(/Skipped: name the policy in force with --policy FILE/);
    expect(r.text).toMatch(/Not built\. desk close --month 2026-09 --sign/);
    expect(r.text).toMatch(/No policy was changed/);
    expect(existsSync(join(dir, "dossiers"))).toBe(false);
  });

  it("signs the dossier and plain Node, which has none of this project's tooling, verifies it", async () => {
    const r = await closeCommand(base({ sign: true }));
    expect(r.ok).toBe(true);
    const bundle = join(dir, "dossiers", "month-2026-09");
    expect(r.text).toMatch(/Verified here: PASS/);
    expect(existsSync(`${bundle}.pins.json`)).toBe(true);
    expect(JSON.parse(readFileSync(`${bundle}.pins.json`, "utf8")).keys).toHaveLength(1);
    const out = execFileSync(process.execPath, ["src/desk/verify/main.ts", bundle, "--pins", `${bundle}.pins.json`], { encoding: "utf8", cwd: process.cwd() });
    expect(out).toMatch(/RESULT: PASS/);
    expect(out).toMatch(/V6-D\s+PASS/);
    // Without the key pinned the same bundle is not trusted: the signature proves nothing about who signed.
    const noPins = (() => {
      try {
        return execFileSync(process.execPath, ["src/desk/verify/main.ts", bundle], { encoding: "utf8", cwd: process.cwd() });
      } catch (e) {
        return String((e as { stdout?: string }).stdout ?? e);
      }
    })();
    expect(noPins).not.toMatch(/RESULT: PASS/);
  });

  it("refuses to mix a second dossier into the first, and says so", async () => {
    const r = await closeCommand(base({ sign: true }));
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/Not written: .* is not empty; refusing to mix two dossiers/);
  });

  it("adds the billed class when an invoice is imported, and the dossier says which vendor months do and do not reconcile", async () => {
    const estimated = summarise(readMonthRows(seedLedger(":memory:", SEEDS), "2026-09", new Map([["month-test", snapshot()]]), snapshot())).pricedMicros;
    const withInvoice = (name: string, billed: number): CloseOptions => {
      const path = join(dir, `${name}.db`);
      const db = seedLedger(path, SEEDS);
      db.prepare("INSERT INTO invoice (invoice_id, vendor, invoice_number, currency, period_start, period_end, stated_total_micros, lines_total_micros, status, notes, source_name, source_sha256, imported_at) VALUES ('inv1', 'anthropic', 'A-1', 'USD', '2026-09-01', '2026-09-30', ?, ?, 'imported', '[]', 'sept.csv', ?, 't')").run(billed, billed, "0".repeat(64));
      db.prepare("INSERT INTO billed_line (invoice_id, line_no, day, model, description, quantity, amount_micros, locator) VALUES ('inv1', 1, NULL, NULL, 'usage', NULL, ?, 'row 1')").run(billed);
      db.close();
      return base({ dbPath: path, dossierDir: join(dir, name) , sign: true });
    };
    const ok = await closeCommand(withInvoice("matched", estimated));
    expect(ok.text).toMatch(/Billed: \$[\d,.]+ on the imported invoices, against \$[\d,.]+ estimated/);
    expect(ok.text).toMatch(/anthropic: reconciled \(billed/);
    expect(ok.text).toMatch(/Verified here: PASS/);
    const claims = readFileSync(join(dir, "matched", "month-2026-09", "claims.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string; class?: string; value?: number; text: string });
    expect(claims.find((c) => c.id === "billed")).toMatchObject({ class: "billed", value: Math.round(estimated / 10_000) / 100 });
    expect(claims.find((c) => c.id === "recon_open")?.value).toBe(0);
    expect(claims.find((c) => c.id === "s_billed")?.text ?? claims.find((c) => c.text.startsWith("The invoices"))?.text).toMatch(/^The invoices imported for the month charge \$/);

    const off = await closeCommand(withInvoice("off", Math.round(estimated * 1.1)));
    expect(off.text).toMatch(/anthropic: unreconciled \(billed/);
    expect(off.text).toMatch(/1 of 1 vendor month is not reconciled/);
    const offClaims = readFileSync(join(dir, "off", "month-2026-09", "claims.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string; value?: number });
    expect(offClaims.find((c) => c.id === "recon_open")?.value).toBe(1);
  });

  it("replays the policy over the month's sessions only, and asks for approval only when told to", async () => {
    const policy = join(dir, "policy.yaml");
    writeFileSync(policy, "version: 1" + String.fromCharCode(10) + "rules:" + String.fromCharCode(10) + "  - { id: allow-claude, kind: permit, when: { model: { in: [\"claude-*\"] } } }" + String.fromCharCode(10));
    const opts = base({ policyPath: policy, propose: { ...base().propose, sampleMode: false } });
    const r = await closeCommand(opts);
    // The window is the month: the calls on the first of October and the last of August are not in the proposal.
    expect(r.text).toMatch(/drafted from 2026-09-01 to 2026-09-10 \(10 sessions\), checked on 2026-09-30 to 2026-09-30 \(1 session, held out/);
    expect(r.text).not.toMatch(/2026-10|2026-08/);
    expect(r.text).not.toMatch(/No rule could stop/); // nothing was found, so there is nothing to escalate
    expect(r.text).toMatch(/No approval was requested\. Add --ask-approval/);
    expect(r.text).toMatch(/No policy was changed and nothing is waiting for approval\./);
    // Asking for approval without naming the policy is refused, not guessed.
    const bare = await closeCommand(base({ askApproval: true }));
    expect(bare.ok).toBe(false);
    expect(bare.text).toMatch(/--ask-approval needs the policy in force: add --policy FILE\./);
    // A policy file that is not there is said, and the close still reports the other steps.
    const gone = await closeCommand(base({ policyPath: join(dir, "missing.yaml") }));
    expect(gone.ok).toBe(false);
    expect(gone.text).toMatch(/Skipped: the policy file .*missing\.yaml does not exist/);
    expect(gone.text).toMatch(/1\. Spend/);
  });

  it("refuses a bad month and an empty month, and says which", async () => {
    expect((await closeCommand(base({ month: "september" }))).text).toMatch(/--month must look like 2026-09/);
    const empty = await closeCommand(base({ month: "2025-01" }));
    expect(empty.ok).toBe(false);
    expect(empty.text).toMatch(/holds no call in 2025-01/);
  });

  it("calls a month that is still running not final", async () => {
    const r = await closeCommand(base({ now: new Date("2026-09-20T00:00:00Z") }));
    expect(r.text.startsWith("Month close for 2026-09 (UTC), a month still running: nothing here is final")).toBe(true);
  });
});
