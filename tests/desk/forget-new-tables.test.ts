import { describe, expect, it } from "vitest";

import { readCsvInvoice } from "../../src/desk/billing/import.ts";
import { reconcileLedger } from "../../src/desk/billing/reconcile.ts";
import { storeInvoice } from "../../src/desk/billing/store.ts";
import { applyResults } from "../../src/desk/alerts/engine.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { recomputeCosts, recordSnapshot } from "../../src/desk/ledger/ingest.ts";
import { hashModels, parseSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { repriceLedger } from "../../src/desk/pricing/reprice.ts";
import { forgetLedger } from "../../src/desk/security/forget.ts";
import { assignTasks } from "../../src/desk/tasks/assign.ts";
import { testSnapshot } from "./helpers.ts";

function ledger(): Ledger {
  const db = openLedger(":memory:");
  db.prepare("INSERT INTO session (session_id, tool, project_path, git_branch, started_at, ended_at) VALUES ('s1', 'claude_code', 'D:/work/shop', 'fix/cart', '2026-10-20T10:00:00.000Z', '2026-10-20T11:00:00.000Z'), ('s2', 'claude_code', 'D:/work/other', 'feat/x', '2026-10-21T10:00:00.000Z', '2026-10-21T11:00:00.000Z')").run();
  const add = db.prepare("INSERT INTO model_call (call_id, session_id, ts, model, is_sidechain, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cache_ttl_basis, cache_split_mismatch, is_api_error) VALUES (?, ?, ?, 'claude-opus-5', 0, 0, 100000, 0, 0, 0, 0, 'reported', 0, 0)");
  add.run("c1", "s1", "2026-10-20T10:30:00.000Z");
  add.run("c2", "s2", "2026-10-21T10:30:00.000Z");
  recordSnapshot(db, testSnapshot());
  recomputeCosts(db, testSnapshot(), new Set(["c1", "c2"]), { unpricedCalls: 0, unpricedModels: {} });
  // A repricing: both calls get a new cost and keep the old one in the history.
  const base = testSnapshot();
  const models = { ...base.models, "claude-opus-5": { ...base.models["claude-opus-5"]!, outputPerMTokMicros: 30_000_000 } };
  repriceLedger(db, parseSnapshot({ ...base, snapshotId: "corrected", models, contentHash: hashModels(models) }), { reason: "test" });
  assignTasks(db, []);
  db.prepare("INSERT INTO owner_answer (session_id, repo_root, sha, answer, answered_at) VALUES ('s1', 'D:/work/shop', 'abc', 'yes', 't'), ('s2', 'D:/work/other', 'def', 'no', 't')").run();
  storeInvoice(db, readCsvInvoice("date,model,cost_usd\n2026-10-20,claude-opus-5,1.00\n", { sourceName: "i.csv" }));
  reconcileLedger(db);
  applyResults(db, [{ key: "cap:p:day", suite: "cap", state: "ALERT", title: "t", body: "b", evidence: "e" }], new Date("2026-10-24T09:00:00Z"));
  return db;
}

const count = (db: Ledger, table: string): number => (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;

describe("forgetting, with everything the later versions added", () => {
  it("removes one project's sessions without tripping over tasks, cost history or answers, and keeps the other project's", () => {
    const db = ledger();
    expect(count(db, "cost_event_history")).toBe(2);
    const r = forgetLedger(db, { project: "shop" });
    expect(r).toEqual({ sessions: 1, calls: 1 });
    expect(count(db, "model_call")).toBe(1);
    expect(count(db, "cost_event_history")).toBe(1);
    expect(count(db, "task_session")).toBe(1);
    expect(count(db, "task")).toBe(1);
    expect(count(db, "owner_answer")).toBe(1);
    expect(count(db, "repricing")).toBe(1); // still explains the other project's cost
    db.close();
  });

  it("drops a repricing when no cost is left to explain", () => {
    const db = ledger();
    forgetLedger(db, { project: "shop" });
    forgetLedger(db, { project: "other" });
    expect(count(db, "repricing")).toBe(0);
    db.close();
  });

  it("forgets everything on a whole forget: invoices with their lines, reconciliations, alert history, answers and tasks", () => {
    const db = ledger();
    expect([count(db, "invoice"), count(db, "billed_line"), count(db, "reconciliation"), count(db, "alert_event"), count(db, "alert_state")].every((n) => n > 0)).toBe(true);
    forgetLedger(db, { all: true });
    for (const t of ["session", "model_call", "cost_event", "cost_event_history", "repricing", "task", "task_session", "owner_answer", "invoice", "billed_line", "reconciliation", "alert_event", "alert_state"]) expect(count(db, t), t).toBe(0);
    db.close();
  });
});
