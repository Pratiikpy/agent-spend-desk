import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditCommand } from "../../src/desk/billing/audit-command.ts";
import { disputePackInput, redactionProblems } from "../../src/desk/billing/audit-pack.ts";
import { renderAudit } from "../../src/desk/billing/audit-report.ts";
import { auditInvoices, DEFAULT_DEFINITION, parseDefinition, type Audit } from "../../src/desk/billing/audit.ts";
import { readCsvInvoice } from "../../src/desk/billing/import.ts";
import { storeInvoice } from "../../src/desk/billing/store.ts";
import { buildDossier } from "../../src/desk/dossier/build.ts";
import { createSignerFile, pinsFor } from "../../src/desk/dossier/keys.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { verifyBundle } from "../../src/desk/verify/verify.ts";
import { assistantLine, humanPromptLine } from "./helpers.ts";

/**
 * The bill auditor and the dispute pack (DF-062), end to end against a real ledger and real imported invoices. The ledger holds sessions on known days with known
 * outcomes; the invoice bills outcomes by the day; every expectation below was worked out by hand from that picture, not read back from the code.
 */
const PRICES = "data/prices/anthropic-litellm-2026-10-22.json";
const snapshot = loadSnapshot(PRICES);
const FOLDER = "/work/payroll-secret-project";
const NOW = new Date("2026-11-03T09:00:00Z");
// Path-shaped strings are built at run time, so that no personal-looking path sits in the source.
const WIN_PATH = ["C:", "Users", "someone", "code", "a.ts"].join("\\");
const UNIX_PATH = ["", "home", "someone", "repo"].join("/");

const at = (day: string, minute: number): string => new Date(Date.parse(`${day}T09:00:00.000Z`) + minute * 60_000).toISOString();
const result = (session: string, id: string, ts: string, text: string, isError: boolean): string =>
  JSON.stringify({ type: "user", isSidechain: false, uuid: `res-${id}`, timestamp: ts, sessionId: session, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: isError }] } });

/** A session of `n` calls a minute apart from `day` 09:00, the last `failing` of them calling a tool that fails the same way every time. */
function session(id: string, day: string, n: number, o: { failing?: number; startMinute?: number } = {}): string[] {
  const lines = [humanPromptLine({ uuid: `p-${id}`, session: id, ts: at(day, o.startMinute ?? 0) })];
  for (let i = 0; i < n; i += 1) {
    const ts = at(day, (o.startMinute ?? 0) + i + 1);
    lines.push(assistantLine({ id: `${id}-m${i}`, session: id, ts, output: 200_000, tools: ["Bash"], toolInputs: [{ command: `step ${i}` }], cwd: FOLDER }));
    const bad = i >= n - (o.failing ?? 0);
    lines.push(result(id, `tu_${id}-m${i}_0`, ts, bad ? "Error: permission denied" : "ok", bad));
  }
  return lines;
}

/** A session that starts in the afternoon of `day` and runs past midnight into the next day. */
function overnight(id: string, day: string, n: number): string[] {
  const lines = [humanPromptLine({ uuid: `p-${id}`, session: id, ts: at(day, 14 * 60) })];
  for (let i = 0; i < n; i += 1) {
    const ts = at(day, 14 * 60 + i * 60);
    lines.push(assistantLine({ id: `${id}-m${i}`, session: id, ts, output: 200_000, tools: ["Bash"], toolInputs: [{ command: `step ${i}` }], cwd: FOLDER }));
    lines.push(result(id, `tu_${id}-m${i}_0`, ts, "ok", false));
  }
  return lines;
}

const SESSIONS: { id: string; state: string; lines: string[] }[] = [
  { id: "sA", state: "merged", lines: session("sA", "2026-10-12", 5) },
  { id: "sB", state: "kept", lines: session("sB", "2026-10-12", 5, { startMinute: 20 }) },
  { id: "sC", state: "unlinked", lines: session("sC", "2026-10-12", 5, { startMinute: 40 }) },
  { id: "sD", state: "reverted", lines: session("sD", "2026-10-12", 5, { startMinute: 60 }) },
  { id: "sL", state: "unlinked", lines: session("sL", "2026-10-12", 6, { failing: 4, startMinute: 90 }) },
  { id: "sE", state: "merged", lines: session("sE", "2026-10-13", 5) },
  { id: "sF", state: "merged", lines: session("sF", "2026-10-13", 2, { startMinute: 30 }) },
  { id: "sG", state: "merged", lines: overnight("sG", "2026-10-14", 12) },
  { id: "sH", state: "merged", lines: session("sH", "2026-10-15", 5) },
];

const CSV = [
  "Invoice,Date,Description,Quantity,Amount (USD)",
  "INV-77,2026-10-12,Resolution - billing,4,4.00",
  "INV-77,2026-10-13,Resolution - billing,2,2.00",
  "INV-77,2026-10-14,Resolution - login,1,1.00",
  "INV-77,2026-10-15,Resolution - login,2,2.00",
  "INV-77,2026-10-16,Resolution - billing,1,1.00",
  "INV-77,2026-10-17,Resolution credit,1,-1.00",
  "INV-77,,Resolution - misc,3,3.00",
  "INV-77,2026-10-18,Resolution - half,1.5,1.50",
  "INV-77,2026-10-20,Seat fee,1,5.00",
  "INV-77,2026-10-20,Seat fee,1,5.00",
  "INV-77,2026-10-21,Platform fee,1,50.00",
  "INV-77,2026-11-02,Resolution - billing,1,1.00",
].join("\n");

let work: string;
let db: Ledger;
beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "desk-audit-"));
  db = openLedger(":memory:");
  const paths: string[] = [];
  for (const s of SESSIONS) {
    const p = join(work, `${s.id}.jsonl`);
    writeFileSync(p, `${s.lines.join("\n")}\n`);
    paths.push(p);
  }
  await ingestClaudeCode(db, paths, snapshot);
  for (const s of SESSIONS) db.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, ?, 'high', 1, '2026-10-30T00:00:00Z')").run(s.id, s.state);
  storeInvoice(db, readCsvInvoice(CSV, { vendor: "supportbot", sourceName: "oct.csv" }));
}, 120_000);
afterAll(() => {
  db.close();
  rmSync(work, { recursive: true, force: true });
});

const run = (def = DEFAULT_DEFINITION, month = "2026-10"): Audit => {
  const r = auditInvoices(db, snapshot, { vendor: "supportbot", month, definition: def });
  if (r.kind !== "audit") throw new Error(r.reason);
  return r.audit;
};

describe("the definition", () => {
  it("reads a definition, fills what is left out from the default, and refuses a field that is wrong or not known", () => {
    expect(parseDefinition("{}")).toEqual(DEFAULT_DEFINITION);
    const d = parseDefinition(JSON.stringify({ unit: "resolution", lineMatch: "^Resolution", unitsFrom: "line", success: { landing: ["merged"] }, minCalls: 5, sample: 3, seed: 9 }));
    expect(d).toMatchObject({ unit: "resolution", unitsFrom: "line", success: { landing: ["merged"] }, minCalls: 5, sample: 3, seed: 9 });
    for (const [bad, why] of [
      ["not json", /not valid JSON/], ["[]", /must be a JSON object/], ['{"colour":1}', /field "colour" that is not known/], ['{"version":2}', /version must be 1/], ['{"unit":""}', /short word/],
      ['{"lineMatch":"("}', /not a valid regular expression/], ['{"lineMatch":""}', /1 to 200/], ['{"unitsFrom":"hours"}', /"quantity" or "line"/], ['{"success":{"landing":[]}}', /non-empty list/],
      ['{"success":{"landing":["reverted"]}}', /reverted session never counts/], ['{"success":{"landing":["merged"],"also":1}}', /an object with a landing list/], ['{"minCalls":0}', /whole number from 1/],
      ['{"minCalls":2.5}', /whole number/], ['{"sample":-1}', /whole number from 0/], ['{"seed":"x"}', /whole number/],
    ] as const) expect(() => parseDefinition(bad), bad).toThrow(why);
  });
});

describe("holding the lines to the owner's definition", () => {
  it("gives out the owner's sessions one to an outcome, day by day, and works out which billed outcomes nothing backs", () => {
    const a = run();
    // 12 Oct: four billed, two sessions meet the definition (merged sA, kept sB); unlinked sC, reverted sD and unlinked sL do not.
    // 13 Oct: two billed, sE backs one; sF is merged but has two calls, under the three the definition asks for.
    // 14 Oct: one billed, backed by sG, which ran from 14 Oct into 15 Oct.  15 Oct: two billed, sG is already backing the 14th, sH backs one.
    // 16 Oct: one billed and no session at all.  The half-outcome, the credit and the undated line cannot be judged.
    const by = (day: string) => a.lines.filter((l) => l.day === day);
    expect(by("2026-10-12")[0]).toMatchObject({ units: 4, supportedUnits: 2, unsupportedUnits: 2, disputedMicros: 2_000_000, verdict: "partly_supported" });
    expect(by("2026-10-13")[0]).toMatchObject({ units: 2, supportedUnits: 1, unsupportedUnits: 1, disputedMicros: 1_000_000, verdict: "partly_supported" });
    expect(by("2026-10-14")[0]).toMatchObject({ units: 1, supportedUnits: 1, unsupportedUnits: 0, disputedMicros: 0, verdict: "supported" });
    expect(by("2026-10-15")[0]).toMatchObject({ units: 2, supportedUnits: 1, unsupportedUnits: 1, disputedMicros: 1_000_000, verdict: "partly_supported" });
    expect(by("2026-10-16")[0]).toMatchObject({ units: 1, supportedUnits: 0, unsupportedUnits: 1, disputedMicros: 1_000_000, verdict: "no_session" });
    expect(a.totals).toMatchObject({ billedUnits: 10, supportedUnits: 5, unsupportedUnits: 5, judgedMicros: 10_000_000, disputedMicros: 5_000_000 });
    expect(a.lines.every((l) => l.supportedUnits + l.unsupportedUnits === l.units)).toBe(true);
  });

  it("says what it could not judge and why, and what it left out", () => {
    const c = run().coverage;
    expect(c).toMatchObject({ invoices: 1, lines: 12, heldInvoices: 0, outsideMonthLines: 1 });
    expect(c.perOutcomeLines).toBe(8); // seven dated outcome lines and the undated one; the Seat, Platform and November lines are not
    const why = c.notJudged.map((x) => x.reason);
    expect(why.some((w) => /credit or refund/.test(w))).toBe(true);
    expect(why.some((w) => /not a whole number of outcomes/.test(w))).toBe(true);
    expect(why.some((w) => /no date on the line/.test(w))).toBe(true);
    expect(c.notJudged.find((x) => /no date/.test(x.reason))).toMatchObject({ lines: 1, micros: 3_000_000 });
  });

  it("gives a session to the outcome that needs it, not the first one that could use it (an overnight session and a short one)", async () => {
    const d = openLedger(":memory:");
    const files = [
      ["X", overnight("X", "2026-10-14", 12), "merged"],
      ["Y", session("Y", "2026-10-14", 5, { startMinute: 10 }), "merged"],
    ] as const;
    const paths = files.map(([id, lines]) => {
      const p = join(work, `edf-${id}.jsonl`);
      writeFileSync(p, `${lines.join("\n")}\n`);
      return p;
    });
    await ingestClaudeCode(d, paths, snapshot);
    for (const [id, , state] of files) d.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, ?, 'high', 1, 'x')").run(id, state);
    storeInvoice(d, readCsvInvoice(["Date,Description,Quantity,Amount (USD)", "2026-10-14,Resolution,1,1.00", "2026-10-15,Resolution,1,1.00"].join("\n"), { vendor: "supportbot", sourceName: "edf.csv" }));
    const r = auditInvoices(d, snapshot, { vendor: "supportbot", month: "2026-10" });
    expect(r.kind === "audit" && r.audit.totals).toMatchObject({ billedUnits: 2, supportedUnits: 2, unsupportedUnits: 0 });
    d.close();
  });

  it("counts a committed session only if the definition says so, and never a reverted one", () => {
    const strict = run({ ...DEFAULT_DEFINITION, success: { landing: ["merged"] } });
    expect(strict.totals.supportedUnits).toBe(4); // sB is kept, not merged, so 12 Oct loses one
    const loose = run({ ...DEFAULT_DEFINITION, success: { landing: ["committed", "merged", "kept"] }, minCalls: 1 });
    expect(loose.totals.supportedUnits).toBe(6); // sF now qualifies on 13 Oct; sD (reverted) and sC and sL (unlinked) still do not
  });

  it("reads one outcome per line when the definition says so", () => {
    const a = run({ ...DEFAULT_DEFINITION, unitsFrom: "line", lineMatch: "^Resolution - (billing|login)$" });
    expect(a.lines).toHaveLength(5); // the five dated billing and login lines of October; the November one is outside the month and the half line does not match
    expect(a.lines.every((l) => l.units === 1)).toBe(true);
  });

  it("draws the supported lines to check by hand with the seed, the same each time", () => {
    const d = { ...DEFAULT_DEFINITION, sample: 2, seed: 7 };
    const a = run(d);
    expect(a.spotCheck).toHaveLength(1); // only one line (14 Oct) is wholly supported
    expect(a.spotCheck[0]!.day).toBe("2026-10-14");
    expect(run(d).spotCheck).toEqual(a.spotCheck);
    expect(run({ ...d, sample: 0 }).spotCheck).toEqual([]);
  });

  it("finds a line charged twice and prices the extra copy, and does not call a single charge a duplicate", () => {
    const a = run();
    expect(a.duplicates).toHaveLength(1);
    expect(a.duplicates[0]).toMatchObject({ day: "2026-10-20", description: "Seat fee", copies: 2, amountMicros: 5_000_000, duplicateMicros: 5_000_000 });
    expect(a.totals.duplicateMicros).toBe(5_000_000);
  });

  it("puts part of a day's charge down to loops and failures from that day's own model spend, and not on a day with none", () => {
    const a = run();
    const d12 = a.days.find((d) => d.day === "2026-10-12")!;
    const rows = db.prepare("SELECT SUM(c.total_micros) AS m FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated' WHERE m.ts >= '2026-10-12T00:00:00Z' AND m.ts < '2026-10-13T00:00:00Z'").get() as { m: number };
    expect(d12.spendMicros).toBe(rows.m);
    expect(d12.wasteMicros).toBeGreaterThan(0);
    expect(d12.wasteMicros).toBeLessThan(d12.spendMicros);
    expect(d12.attributableMicros).toBe(Math.round((d12.billedMicros * d12.wasteMicros) / d12.spendMicros));
    for (const d of a.days.filter((x) => x.day !== "2026-10-12")) expect(d.attributableMicros, d.day).toBe(0);
    expect(a.totals.attributableMicros).toBe(d12.attributableMicros);
    expect(a.totals.loopEvents).toBe(1);
  });
});

describe("when the audit cannot run", () => {
  const cannot = (vendor: string, month: string, def = DEFAULT_DEFINITION): string => {
    const r = auditInvoices(db, snapshot, { vendor, month, definition: def });
    if (r.kind === "audit") throw new Error("it ran");
    return r.reason;
  };

  it("says so for a vendor or a month with no invoice, and for a bill that has no per-outcome lines", () => {
    expect(cannot("nobody", "2026-10")).toMatch(/no invoice from nobody covers 2026-10/);
    expect(cannot("supportbot", "2026-09")).toMatch(/no invoice from supportbot covers 2026-09/);
    expect(cannot("supportbot", "2026-10", { ...DEFAULT_DEFINITION, lineMatch: "^zzz$" })).toMatch(/looks like a per-outcome line.*a vendor that bills for tokens or seats has no outcomes/);
  });

  it("says so when the lines carry no whole-number quantity, naming the setting that would help", () => {
    const d = openLedger(":memory:");
    storeInvoice(d, readCsvInvoice(["Date,Description,Amount (USD)", "2026-10-03,Resolution,1.00"].join("\n"), { vendor: "supportbot", sourceName: "q.csv" }));
    const r = auditInvoices(d, snapshot, { vendor: "supportbot", month: "2026-10" });
    expect(r.kind === "cannot_run" && r.reason).toMatch(/none carries a whole-number quantity of outcomes; set "unitsFrom": "line"/);
    d.close();
  });

  it("leaves out an invoice on hold for a sum mismatch and says so, and refuses a mix of currencies", () => {
    const d = openLedger(":memory:");
    storeInvoice(d, readCsvInvoice(["Date,Description,Quantity,Amount (USD)", "2026-10-03,Resolution,1,1.00", "Total,,,9.00"].join("\n"), { vendor: "supportbot", sourceName: "held.csv" }));
    const held = auditInvoices(d, snapshot, { vendor: "supportbot", month: "2026-10" });
    expect(held.kind === "cannot_run" && held.reason).toMatch(/every supportbot invoice for 2026-10 is on hold for a sum mismatch/);
    storeInvoice(d, readCsvInvoice(["Invoice,Date,Description,Quantity,Amount (USD)", "B-1,2026-10-04,Resolution,1,1.00"].join("\n"), { vendor: "supportbot", sourceName: "ok.csv" }));
    const some = auditInvoices(d, snapshot, { vendor: "supportbot", month: "2026-10" });
    expect(some.kind === "audit" && some.audit.coverage.heldInvoices).toBe(1);
    storeInvoice(d, readCsvInvoice(["Invoice,Date,Description,Quantity,Amount,Currency", "B-2,2026-10-05,Resolution,1,2.00,EUR"].join("\n"), { vendor: "supportbot", sourceName: "eur.csv" }));
    const mixed = auditInvoices(d, snapshot, { vendor: "supportbot", month: "2026-10" });
    expect(mixed.kind === "cannot_run" && mixed.reason).toMatch(/more than one currency \(EUR, USD\)/);
    d.close();
  });
});

describe("the text", () => {
  it("says what was read, what the logs back, the largest lines to put to the vendor, the doubled line, the loops and what to check by hand", () => {
    const text = renderAudit(run({ ...DEFAULT_DEFINITION, sample: 5 }));
    expect(text).toContain("Bill audit for supportbot, 2026-10 (UTC days)");
    expect(text).toContain("Held to your definition: a outcome is a session whose work was merged or kept, with at least 3 calls. A reverted session never counts.");
    expect(text).toContain("10 outcomes charged on the judged lines ($10.00); your logs back 5, and 5 have no session behind them: $5.00.");
    expect(text).toContain("That is a claim to put to the vendor, not a finding.");
    expect(text).toMatch(/2026-10-12 {2}"Resolution - billing" {2}4 charged, 2 backed, 2 not: \$2\.00 of \$4\.00 {2}\(INV-77 line 1\)/);
    expect(text).toMatch(/2026-10-16 .*\(INV-77 line 5; no session of yours that day\)/);
    expect(text).toContain("1 line appears more than once");
    expect(text).toContain('2026-10-20  "Seat fee"  2 copies of $5.00');
    expect(text).toMatch(/\$[\d.]+ of the charge may have gone to loops and failures \(1 found/);
    expect(text).toContain("not part of the disputed figure");
    expect(text).toContain("Backed lines to check by hand (1 drawn with seed 1):");
  });
});

describe("the dispute pack", () => {
  const signer = (): ReturnType<typeof createSignerFile>["signer"] => createSignerFile(join(mkdtempSync(join(tmpdir(), "desk-audit-key-")), "key.json")).signer;

  it("is built, signed and passes the offline verifier, and its figures are the audit's", () => {
    const a = run();
    const s = signer();
    const pack = disputePackInput(a, { signer: s, tenant: "local", now: NOW });
    expect(pack.rows).toEqual({ lines: 5, days: 5, duplicates: 1 });
    expect(pack.input).toMatchObject({ kind: "dispute_pack", audience: "counterparty", disclosure: "redacted" });
    const built = buildDossier(pack.input);
    const report = verifyBundle(built.files, { pins: pinsFor(s) });
    expect(report.overall).toBe("PASS");
    expect(pack.input.claims.map((c) => c.id)).toEqual(["units_billed", "units_supported", "units_unsupported", "judged", "disputed", "loops", "dup_groups", "dup_amount"]);
    const text = (pack.input.sentences ?? []).map((x) => x.text).join(" ");
    expect(text).toContain("The judged lines charge for 10 outcomes; the owner's logs back 5 of them and 5 have no session behind them.");
    expect(text).toContain("The judged lines charge $10.00, and the 5 unsupported outcomes make up $5.00 of it.");
    expect(text).toContain("1 line appears more than once; the extra copies charge $5.00.");
  });

  it("carries nothing but the vendor's lines, the day counts and the sums: no session id, no project path, no prompt text", () => {
    const s = signer();
    const built = buildDossier(disputePackInput(run(), { signer: s, tenant: "local", now: NOW }).input);
    const all = [...built.files.values()].map((b) => Buffer.from(b).toString("utf8")).join("\n");
    for (const forbidden of ['"sA"', '"sB"', '"sL"', '"sG"', "payroll-secret-project", "/work/", "please do the thing", "step 0", "permission denied"]) {
      expect(all.includes(forbidden), forbidden).toBe(false);
    }
    expect(all).toContain("Resolution - billing");
  });

  it("is refused by the verifier when a row is changed after signing", () => {
    const s = signer();
    const built = buildDossier(disputePackInput(run(), { signer: s, tenant: "local", now: NOW }).input);
    const files = new Map(built.files);
    const path = [...files.keys()].find((k) => k.startsWith("rows/audit_line"))!;
    const before = Buffer.from(files.get(path)!).toString("utf8");
    const text = before.replace('"unsupported_units":2', '"unsupported_units":0');
    expect(text).not.toBe(before);
    files.set(path, new TextEncoder().encode(text));
    expect(verifyBundle(files, { pins: pinsFor(s) }).overall).toBe("FAIL");
  });

  it("refuses to put a path, a block of code, a long text or an unknown field in a row", () => {
    expect(redactionProblems("audit_line", { description: "Resolution - billing", units: 4 })).toEqual([]);
    expect(redactionProblems("audit_line", { description: `see ${WIN_PATH}` })[0]).toMatch(/looks like a file path/);
    expect(redactionProblems("audit_line", { description: `opened ${UNIX_PATH}` })[0]).toMatch(/looks like a file path/);
    expect(redactionProblems("audit_line", { description: "```ts const a = 1; ```" })[0]).toMatch(/looks like code/);
    expect(redactionProblems("audit_line", { description: "x".repeat(201) })[0]).toMatch(/201 characters/);
    expect(redactionProblems("audit_line", { description: "a\nb" })[0]).toMatch(/line break/);
    expect(redactionProblems("audit_line", { session_id: "s1" })[0]).toMatch(/audit_line.session_id is not a field/);
    expect(redactionProblems("audit_day", { project: "x" })[0]).toMatch(/not a field/);
    expect(redactionProblems("other", { day: "x" })[0]).toMatch(/not a field/);
    expect(redactionProblems("audit_line", { description: { nested: 1 } })[0]).toMatch(/not text, a number or a flag/);
  });

  it("refuses to build when a vendor's own description would put a path in the pack", () => {
    const a = run();
    const bad: Audit = { ...a, lines: a.lines.map((l, i) => (i === 0 ? { ...l, description: `Resolution at ${WIN_PATH}` } : l)) };
    expect(() => disputePackInput(bad, { signer: signer(), tenant: "local", now: NOW })).toThrow(/the pack was not built: audit_line.description looks like a file path/);
  });
});

describe("desk invoices audit", () => {
  it("runs with a definition file, writes a verified pack, and says what the verifier does and does not recompute", () => {
    const out = mkdtempSync(join(tmpdir(), "desk-audit-out-"));
    const def = join(out, "definition.json");
    writeFileSync(def, JSON.stringify({ unit: "resolution", lineMatch: "^Resolution", sample: 2 }));
    const r = auditCommand(db, { snapshot, month: "2026-10", definitionPath: def, packDir: join(out, "packs"), keyPath: join(out, "key.json"), now: NOW });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Bill audit for supportbot, 2026-10");
    expect(r.text).toContain("a resolution is a session whose work was merged or kept");
    expect(r.text).not.toContain("No --definition was given");
    expect(r.text).toContain("Verified here: PASS");
    expect(r.text).toContain("It does not recompute how outcomes were given out to lines");
    expect(r.text).toContain("A signing key was created");
    const dir = join(out, "packs", "dispute-supportbot-2026-10");
    expect(statSync(dir).isDirectory()).toBe(true);
    expect(readdirSync(dir).length).toBeGreaterThan(3);
    expect(statSync(`${dir}.pins.json`).isFile()).toBe(true);
    expect(readFileSync(`${dir}.pins.json`, "utf8")).not.toContain("PRIVATE");
    rmSync(out, { recursive: true, force: true });
  });

  it("uses the default definition and says so, picks the one vendor that has an invoice, and refuses a second pack in the same folder", () => {
    const out = mkdtempSync(join(tmpdir(), "desk-audit-out-"));
    const r = auditCommand(db, { snapshot, month: "2026-10", now: NOW });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("No --definition was given, so the default definition is used: a outcome is a session whose work was merged or kept.");
    const first = auditCommand(db, { snapshot, month: "2026-10", packDir: out, keyPath: join(out, "k.json"), now: NOW });
    expect(first.ok).toBe(true);
    const second = auditCommand(db, { snapshot, month: "2026-10", packDir: out, keyPath: join(out, "k.json"), now: NOW });
    expect(second.ok).toBe(false);
    expect(second.text).toMatch(/The dispute pack was not built: .* is not empty/);
    rmSync(out, { recursive: true, force: true });
  });

  it("fails plainly on a bad month, a missing or broken definition file, no invoice, and several vendors", () => {
    expect(auditCommand(db, { snapshot, month: "October", now: NOW })).toEqual({ ok: false, text: '--month must look like 2026-10, got "October".' });
    expect(auditCommand(db, { snapshot, month: "2026-10", definitionPath: join(work, "nope.json"), now: NOW }).text).toMatch(/does not exist/);
    const bad = join(work, "bad.json");
    writeFileSync(bad, '{"unit":3}');
    expect(auditCommand(db, { snapshot, month: "2026-10", definitionPath: bad, now: NOW }).text).toMatch(/was not read: unit must be a short word/);
    expect(auditCommand(db, { snapshot, month: "2026-08", now: NOW }).text).toMatch(/No invoice covers 2026-08/);
    expect(auditCommand(db, { snapshot, month: "2026-10", vendor: "other", now: NOW }).text).toMatch(/The audit cannot run: no invoice from other covers 2026-10/);
    const d = openLedger(":memory:");
    for (const v of ["alpha", "beta"]) storeInvoice(d, readCsvInvoice(["Invoice,Date,Description,Quantity,Amount (USD)", `${v}-1,2026-10-03,Resolution,1,1.00`].join("\n"), { vendor: v, sourceName: `${v}.csv` }));
    expect(auditCommand(d, { snapshot, month: "2026-10", now: NOW }).text).toBe("Invoices from alpha, beta cover 2026-10. Say which to audit with --vendor.");
    d.close();
  });

  it("runs through the real command line against a ledger file, and writes a pack that the stand-alone verifier passes", async () => {
    const out = mkdtempSync(join(tmpdir(), "desk-audit-cli-"));
    const file = join(out, "ledger.db");
    const fileDb = openLedger(file);
    await ingestClaudeCode(fileDb, SESSIONS.map((x) => join(work, `${x.id}.jsonl`)), snapshot);
    for (const x of SESSIONS) fileDb.prepare("INSERT INTO session_outcome (session_id, state, best_confidence, commits, computed_at) VALUES (?, ?, 'high', 1, 'x')").run(x.id, x.state);
    storeInvoice(fileDb, readCsvInvoice(CSV, { vendor: "supportbot", sourceName: "oct.csv" }));
    fileDb.close();
    const env = { ...process.env, DESK_SIGNER_KEY: join(out, "signer.pem") };
    const audit = spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "invoices", "audit", "--db", file, "--month", "2026-10", "--pack", join(out, "packs")], { encoding: "utf8", env });
    expect(audit.status, audit.stderr).toBe(0);
    expect(audit.stdout).toContain("10 outcomes charged on the judged lines ($10.00); your logs back 5");
    expect(audit.stdout).toContain("Verified here: PASS");
    const dir = join(out, "packs", "dispute-supportbot-2026-10");
    const verify = spawnSync(process.execPath, ["--import", "tsx", "src/desk/verify/main.ts", dir, "--pins", `${dir}.pins.json`], { encoding: "utf8" });
    expect(verify.status, verify.stdout + verify.stderr).toBe(0);
    expect(verify.stdout).toContain("RESULT: PASS");
    const none = spawnSync(process.execPath, ["--import", "tsx", "src/desk/cli.ts", "invoices", "audit", "--db", file, "--month", "2026-09"], { encoding: "utf8", env });
    expect(none.status).toBe(1);
    expect(none.stdout).toContain("No invoice covers 2026-09.");
    rmSync(out, { recursive: true, force: true });
  }, 120_000);
});
