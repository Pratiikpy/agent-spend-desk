import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openLedger } from "../../../src/desk/ledger/db.ts";
import { ShimElement, walk } from "./support/dom-shim.ts";
import { renderAllScreens, startRichUi, type RichUi } from "./support/rich-ui.ts";

/** The morning brief says where the next task should go when a plan is close to a limit, and shows nothing when none is. */
const NOW = Date.parse("2026-10-24T12:00:00.000Z");
let ui: RichUi;
let calm: RichUi;

function readings(dir: string, claudePct: number): void {
  const db = openLedger(join(dir, "ledger.db"));
  db.prepare("INSERT OR IGNORE INTO session (session_id, tool) VALUES ('codex-quota-s', 'codex')").run();
  for (const [tool, session, pct, resetMin] of [["claude_code", "quota-claude-s", claudePct, 40], ["codex", "codex-quota-s", 30, 180]] as const) {
    if (tool === "claude_code") db.prepare("INSERT OR IGNORE INTO session (session_id, tool) VALUES (?, 'claude_code')").run(session);
    const resets = Math.floor((NOW + resetMin * 60_000) / 1000);
    for (const [back, p] of [[60, pct - 8], [30, pct - 4], [3, pct]] as const) {
      db.prepare("INSERT INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type, limit_id) VALUES (?, ?, ?, 'primary', 300, ?, ?, 'pro', NULL)").run(tool, session === "quota-claude-s" ? "quota-claude-s" : session, new Date(NOW - back * 60_000).toISOString(), p, resets);
    }
  }
  db.close();
}

beforeAll(async () => {
  ui = await startRichUi({ nowMs: () => NOW });
  readings(ui.dir, 97);
  calm = await startRichUi({ nowMs: () => NOW });
  readings(calm.dir, 40);
}, 600_000);
afterAll(async () => {
  await Promise.all([ui?.close(), calm?.close()]);
});

const brief = async (u: RichUi): Promise<{ quota: { from: string; fromLabel: string; action: string; to: string | null; toLabel: string | null; text: string[]; checkpoint: boolean }[] }> => {
  const res = await fetch(`${u.server.origin}/api/brief`, { headers: { "x-desk-token": u.token } });
  return (await res.json()) as never;
};

describe("the brief's routing suggestion", () => {
  it("names the plan close to a limit, where to go, and that a handoff comes first", async () => {
    const b = await brief(ui);
    expect(b.quota).toHaveLength(1);
    expect(b.quota[0]).toMatchObject({ from: "claude_code", fromLabel: "Claude Code", action: "route", to: "codex", toLabel: "Codex", checkpoint: true });
    expect(b.quota[0]!.text[0]).toBe("Move the next task from Claude Code to Codex.");
    expect(b.quota[0]!.text.join(" ")).toContain("Write the handoff first");
  });

  it("is empty when no plan is close to a limit", async () => {
    expect((await brief(calm)).quota).toEqual([]);
  });

  it("is drawn as a card with the plans named, and says it is a suggestion", async () => {
    const { screens } = await renderAllScreens(ui);
    const root = screens.find((s) => s.id === "brief")!.root;
    const nodes = [...walk(root)].map((w) => w.node).filter((n): n is ShimElement => n instanceof ShimElement);
    const block = nodes.find((n) => n.getAttribute("data-quota") === "true");
    expect(block, "the brief shows the suggestion").toBeDefined();
    expect(block!.textContent).toContain("Claude Code to Codex");
    expect(block!.textContent).toContain("Move the next task from Claude Code to Codex.");
    const page = root.textContent;
    expect(page).toContain("Where the next task should go");
    expect(page).toContain("A suggestion, not an action");
  });

  it("draws nothing when there is nothing to suggest", async () => {
    const { screens } = await renderAllScreens(calm);
    const nodes = [...walk(screens.find((s) => s.id === "brief")!.root)].map((w) => w.node).filter((n): n is ShimElement => n instanceof ShimElement);
    expect(nodes.some((n) => n.getAttribute("data-quota") === "true")).toBe(false);
  });
});
