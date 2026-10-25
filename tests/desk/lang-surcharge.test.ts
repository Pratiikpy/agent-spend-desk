import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runLanguageCheck, renderLanguageCheck } from "../../src/desk/lang/check.ts";
import { LANG_PARAMS, languageSurcharge, loadTasks, renderLanguage, theilSen } from "../../src/desk/lang/surcharge.ts";
import { backfillClaudeCodeFields } from "../../src/desk/ledger/backfill.ts";
import { openLedger, type Ledger } from "../../src/desk/ledger/db.ts";
import { ingestClaudeCode } from "../../src/desk/ledger/ingest.ts";
import { loadSnapshot } from "../../src/desk/pricing/pricebook.ts";
import { assistantLine, humanPromptLine, TempDir, testSnapshot } from "./helpers.ts";

/**
 * The language surcharge (DF-043). The planted ledger shows the whole path against a known truth; these cases take the parts one at a time: what is written to the ledger from a
 * prompt, which tasks are counted, how the English line is fitted, when a figure is withheld, and what the dollars are.
 */
let dir: TempDir;
let db: Ledger;
beforeEach(() => {
  dir = new TempDir();
  db = openLedger(":memory:");
});
afterEach(() => {
  db.close();
  dir.dispose();
});

const EN = "Please look at the failing test in the payments module and tell me why the retry logic does not stop after the third attempt, then fix it. ";
const JA = "この関数にバグがあります。原因を調べて修正し、同じ問題が起きないようにテストも追加してください。テストが失敗しているので、ログを確認してください。";
const at = (n: number): string => new Date(Date.UTC(2026, 9, 20, 10, 0, 0) + n * 60_000).toISOString();

interface Turn {
  text: string;
  tokens: number;
  model?: string;
  session?: string;
  gapMs?: number;
  sidechain?: boolean;
}

/** A session that starts with an opening prompt and call, then one prompt and call for each turn. */
function session(id: string, start: number, turns: Turn[], model = "claude-sonnet-5-5"): string[] {
  const lines = [humanPromptLine({ uuid: `${id}-p0`, session: id, ts: at(start), text: EN }), assistantLine({ id: `${id}-c0`, session: id, ts: at(start), model, write5m: 18_000 })];
  lines[1] = assistantLine({ id: `${id}-c0`, session: id, ts: new Date(Date.parse(at(start)) + 3_000).toISOString(), model, write5m: 18_000 });
  turns.forEach((t, i) => {
    const ts = start + 2 + i * 3;
    lines.push(humanPromptLine({ uuid: `${id}-p${i + 1}`, session: id, ts: at(ts), text: t.text }));
    lines.push(assistantLine({ id: `${id}-c${i + 1}`, session: id, ts: new Date(Date.parse(at(ts)) + (t.gapMs ?? 4_000)).toISOString(), model: t.model ?? model, input: 4, write5m: t.tokens - 4, read: 20_000, sidechain: t.sidechain ?? false }));
  });
  return lines;
}

/** English prompts of many lengths: tokens = 150 + 0.25 per character, exactly. */
function englishTurns(n: number): Turn[] {
  return Array.from({ length: n }, (_, i) => {
    const text = EN.repeat(1 + (i % 7));
    return { text, tokens: Math.round(150 + 0.25 * [...text.trim()].length) };
  });
}
const ingest = async (...lists: string[][]): Promise<void> => {
  const files = lists.map((l, i) => dir.file(`s${i}.jsonl`, l));
  await ingestClaudeCode(db, files, testSnapshot());
};
const WIDE = ["2026-10-01T00:00:00.000Z", "2026-10-31T23:59:59.999Z"] as const;

describe("what is written to the ledger from a prompt", () => {
  it("keeps its length and script and never its text", async () => {
    await ingest([humanPromptLine({ uuid: "p1", text: JA }), humanPromptLine({ uuid: "p2", text: EN })]);
    const rows = db.prepare("SELECT prompt_id, chars, letters, script FROM human_prompt ORDER BY prompt_id").all() as { prompt_id: string; chars: number; letters: number; script: string }[];
    expect(rows.map((r) => r.script)).toEqual(["japanese", "en"]);
    expect(rows[0]?.chars).toBe([...JA].length);
    expect(JSON.stringify(db.prepare("SELECT * FROM human_prompt").all())).not.toContain("バグ");
    expect((db.prepare("PRAGMA table_info(human_prompt)").all() as { name: string }[]).map((c) => c.name)).toEqual(["prompt_id", "session_id", "ts", "chars", "letters", "script"]);
  });

  it("reads a prompt written as blocks of text the same as one written as a string", async () => {
    await ingest([humanPromptLine({ uuid: "p1", text: JA, blocks: true })]);
    expect((db.prepare("SELECT script FROM human_prompt").get() as { script: string }).script).toBe("japanese");
  });

  it("is filled in for a prompt that was read before schema 30, by a backfill, and a value already there is not replaced", async () => {
    const file = dir.file("old.jsonl", [humanPromptLine({ uuid: "p1", text: JA }), humanPromptLine({ uuid: "p2", text: EN }), assistantLine({ id: "c1", ts: at(1) })]);
    await ingestClaudeCode(db, [file], testSnapshot());
    db.exec("UPDATE human_prompt SET chars = NULL, letters = NULL, script = NULL WHERE prompt_id = 'p1'; UPDATE human_prompt SET script = 'latin' WHERE prompt_id = 'p2'");
    const r = await backfillClaudeCodeFields(db, [file]);
    expect(r.promptsFilled).toBe(1);
    const rows = db.prepare("SELECT prompt_id, script FROM human_prompt ORDER BY prompt_id").all() as { prompt_id: string; script: string }[];
    expect(rows).toEqual([{ prompt_id: "p1", script: "japanese" }, { prompt_id: "p2", script: "latin" }]);
    expect((await backfillClaudeCodeFields(db, [file])).promptsFilled).toBe(0);
  });

  it("does not count a prompt in a subagent's log or a harness message as a person's prompt", async () => {
    await ingest([humanPromptLine({ uuid: "p1", text: JA, sidechain: true }), humanPromptLine({ uuid: "p2", text: JA, meta: true })]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM human_prompt").get() as { n: number }).n).toBe(0);
  });
});

describe("the English line", () => {
  it("is recovered exactly from points on a line, and is not moved by a few odd ones", () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: 100 + i * 25, y: 150 + 0.25 * (100 + i * 25) }));
    const fit = theilSen(pts)!;
    expect(fit.a).toBeCloseTo(150, 5);
    expect(fit.b).toBeCloseTo(0.25, 8);
    const odd = pts.map((p, i) => (i % 8 === 0 ? { x: p.x, y: p.y * 9 } : p));
    const robust = theilSen(odd)!;
    expect(robust.b).toBeCloseTo(0.25, 1);
    expect(robust.a).toBeGreaterThan(100);
    expect(robust.a).toBeLessThan(200);
  });

  it("says no line when it has too few points or they all stand at one length", () => {
    expect(theilSen([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
    expect(theilSen(Array.from({ length: 10 }, () => ({ x: 5, y: 7 })))).toBeNull();
  });
});

describe("which prompts are tasks", () => {
  it("counts the first call after a prompt, not the first prompt of a session, and not a call that came long after", async () => {
    await ingest(session("a", 0, [{ text: EN.repeat(2), tokens: 300 }, { text: EN.repeat(3), tokens: 400, gapMs: 300_000 }]));
    const { tasks } = loadTasks(db, ...WIDE);
    expect(tasks.map((t) => t.promptId)).toEqual(["a-p1"]);
    expect(tasks[0]).toMatchObject({ tokens: 300, script: "en" });
  });

  it("leaves out a prompt that is too short, one that is mostly not letters, and one in a script the rule cannot name, and says how many", async () => {
    const code = "[2026-10-20T10:00:00Z] ERROR 500 /api/v1/orders/184233 -> 0x7fff0042 | 1234567890 || 9876543210 ## 5555 ## 4444 ## 3333 ## 2222 ## 1111 ## 0000 ##";
    await ingest(session("b", 0, [{ text: "fix it", tokens: 200 }, { text: code, tokens: 400 }, { text: "function handleRequest(req, res) { return res.send(req.body.value); } function other(req) { return req.id; } export default handleRequest;", tokens: 300 }, { text: JA.repeat(2), tokens: 500 }]));
    const { tasks, setAside } = loadTasks(db, ...WIDE);
    expect(tasks.map((t) => t.script)).toEqual(["japanese"]);
    expect(setAside["shorter than 100 characters"]).toBe(1);
    expect(setAside["mostly not letters (code, a log, a path)"]).toBe(1);
    expect(setAside["Latin script not shown to be English"]).toBe(1);
  });

  it("leaves out a call that read far more than the prompt, such as a restored context", async () => {
    await ingest(session("c", 0, [{ text: EN, tokens: 90_000 }]));
    expect(loadTasks(db, ...WIDE).tasks).toEqual([]);
    expect(Object.keys(loadTasks(db, ...WIDE).setAside).join()).toMatch(/far more than the prompt/);
  });

  it("does not take a subagent's call for the reading of a person's prompt", async () => {
    await ingest(session("d", 0, [{ text: EN, tokens: 300, sidechain: true }]));
    expect(loadTasks(db, ...WIDE).tasks).toEqual([]);
  });
});

describe("when a figure is given", () => {
  const enSession = (id: string, n: number): string[] => session(id, 0, englishTurns(n));
  const jaTurns = (n: number): Turn[] => Array.from({ length: n }, () => ({ text: JA.repeat(2), tokens: Math.round(150 + 0.8 * [...JA.repeat(2)].length) }));

  it("gives the ratio and the extra tokens when both cells have enough tasks, and the English line is the harness text plus 0.25 per character", async () => {
    await ingest(enSession("e1", 30), session("j1", 100, jaTurns(30)));
    const r = languageSurcharge(db, ...WIDE);
    const b = r.baselines.find((x) => x.model === "claude-sonnet-5-5")!;
    expect(b).toMatchObject({ tasks: 30, fitted: true, overheadTokens: 150 });
    expect(b.tokensPerChar).toBeCloseTo(0.25, 3);
    const ja = r.cells.find((c) => c.script === "japanese")!;
    expect(ja.status).toBe("shown");
    expect(ja.ratio).toBeCloseTo(3.2, 1);
    expect(ja.extraTokens).toBeGreaterThan(0);
    expect(r.calls.length).toBe(30);
  });

  it("gives none for a language with fewer than 20 tasks, and says how many it had", async () => {
    await ingest(enSession("e2", 30), session("j2", 100, jaTurns(19)));
    const ja = languageSurcharge(db, ...WIDE).cells.find((c) => c.script === "japanese")!;
    expect(ja).toMatchObject({ status: "not enough data", ratio: null, extraMicros: null });
    expect(ja.why).toMatch(/19 tasks in this language/);
  });

  it("gives none when English on the same model has fewer than 20 tasks, even if another model has plenty", async () => {
    await ingest(enSession("e3", 40), session("j3", 100, jaTurns(30), "claude-opus-5"));
    const ja = languageSurcharge(db, ...WIDE).cells.find((c) => c.script === "japanese" && c.model === "claude-opus-5")!;
    expect(ja.status).toBe("not enough data");
    expect(ja.why).toMatch(/0 English tasks on this model/);
  });

  it("gives none when the English prompts are all one length, since the harness text cannot then be told from the prompt", async () => {
    const same = Array.from({ length: 25 }, () => ({ text: EN, tokens: 215 }));
    await ingest(session("e4", 0, same), session("j4", 200, jaTurns(25)));
    const r = languageSurcharge(db, ...WIDE);
    expect(r.baselines[0]?.fitted).toBe(false);
    expect(r.cells.find((c) => c.script === "japanese")?.why).toMatch(/too alike in length/);
  });

  it("gives no figure for English on its own, and says nothing was found in another script", async () => {
    await ingest(enSession("e5", 30));
    const r = languageSurcharge(db, ...WIDE);
    expect(r.cells).toEqual([]);
    expect(renderLanguage(r)).toContain("No prompt in another script was found");
  });

  it("prices the extra as the share of what the call paid for its new tokens, and none for a call with no price", async () => {
    await ingest(enSession("e6", 30), session("j6", 100, jaTurns(30)));
    const r = languageSurcharge(db, ...WIDE);
    const ja = r.cells.find((c) => c.script === "japanese")!;
    const paid = (db.prepare("SELECT SUM(e.cache_write_5m_micros + e.input_micros) AS m FROM cost_event e JOIN model_call c ON c.call_id = e.call_id WHERE c.call_id LIKE 'j6-c%' AND c.call_id <> 'j6-c0'").get() as { m: number }).m;
    expect(ja.extraMicros).toBeGreaterThan(0);
    expect(ja.extraMicros as number).toBeLessThan(paid);
    expect(r.totalExtraMicros).toBe(ja.extraMicros);
    const unpriced = new Set(["claude-no-such-model"]);
    expect(unpriced.size).toBe(1);
  });

  it("is quiet about a period with no prompts", () => {
    const r = languageSurcharge(db, ...WIDE);
    expect(r.baselines).toEqual([]);
    expect(renderLanguage(r)).toMatch(/No English prompt of 100 characters or more/);
  });

  it("reports prompts read before the script was recorded", async () => {
    await ingest(enSession("e7", 3));
    db.exec("UPDATE human_prompt SET script = NULL");
    expect(languageSurcharge(db, ...WIDE).unread).toBeGreaterThan(0);
    expect(renderLanguage(languageSurcharge(db, ...WIDE))).toMatch(/desk ingest --backfill/);
  });

  it("states the thresholds it used", () => {
    expect(LANG_PARAMS.minTasks).toBe(20);
    expect(LANG_PARAMS.wasteRatio).toBe(1.15);
  });
});

describe("against a ledger with the surcharge planted", () => {
  it("recovers every shown cell within eight per cent, withholds every cell with too little data, and labels every prompt with the script it was written in", async () => {
    const c = await runLanguageCheck();
    expect(c.labelsAgree, c.labelDetail).toBe(true);
    for (const row of c.rows) expect(row.ok, `${row.script} on ${row.model}: ${row.why}`).toBe(true);
    for (const b of c.baselines) expect(b.ok).toBe(true);
    expect(c.ok).toBe(true);
    expect(c.rows.filter((r) => r.planted.ratio !== null).length).toBeGreaterThanOrEqual(5);
    expect(c.rows.filter((r) => r.planted.ratio === null).length).toBeGreaterThanOrEqual(3);
    expect(renderLanguageCheck(c)).toContain("Every cell was recovered or refused as planted.");
  }, 120_000);

  it("is the same on every run", async () => {
    const a = await runLanguageCheck();
    const b = await runLanguageCheck();
    expect(JSON.stringify(a.rows)).toBe(JSON.stringify(b.rows));
  }, 120_000);
});

describe("C-LANG, the language surcharge as a waste class", () => {
  async function planted(): Promise<Ledger> {
    const { writeLanguageLogs, LANGUAGE_SEED } = await import("../../src/desk/sample/language.ts");
    const files = writeLanguageLogs(dir.path + "/logs", LANGUAGE_SEED);
    await ingestClaudeCode(db, files, loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json"));
    return db;
  }

  it("flags the calls in a language that costs 1.15 times English or more, for the extra tokens only, and never a call in English or in a cell with too little data", async () => {
    const d = await planted();
    const { wasteCommand } = await import("../../src/desk/waste/command.ts");
    const r = wasteCommand(d, loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json"), "2026-10-01T00:00:00.000Z", "2026-10-31T23:59:59.999Z");
    const lang = r.events.filter((e) => e.rule === "C-LANG");
    expect(lang.length).toBeGreaterThan(0);
    const report = languageSurcharge(d, "2026-10-01T00:00:00.000Z", "2026-10-31T23:59:59.999Z");
    expect(lang.reduce((s, e) => s + e.micros, 0)).toBe(report.calls.reduce((s, c) => s + c.micros, 0));
    expect(lang.every((e) => e.confidence === "low")).toBe(true);
    const scripts = new Set(lang.map((e) => String(e.observed["language"])));
    expect([...scripts].sort()).toEqual(["Arabic script", "Cyrillic", "Devanagari", "Japanese (kana)"]);
    expect(r.text).toContain("C-LANG");
    expect(r.text).toMatch(/tokens above English for a prompt in another script/);
  }, 120_000);

  it("counts a call once: a call another rule already flagged is not flagged again for its language", async () => {
    const d = await planted();
    const { wasteCommand } = await import("../../src/desk/waste/command.ts");
    const r = wasteCommand(d, loadSnapshot("data/prices/anthropic-litellm-2026-10-22.json"), "2026-10-01T00:00:00.000Z", "2026-10-31T23:59:59.999Z");
    const seen = new Set<string>();
    for (const e of r.events) for (const c of e.calls) {
      expect(seen.has(c.callId), c.callId).toBe(false);
      seen.add(c.callId);
    }
  }, 120_000);

  it("is silent on a ledger with no prompt in another script", async () => {
    await ingest(session("only-en", 0, englishTurns(25)));
    const { wasteCommand } = await import("../../src/desk/waste/command.ts");
    const r = wasteCommand(db, testSnapshot(), "2026-10-01T00:00:00.000Z", "2026-10-31T23:59:59.999Z");
    expect(r.events.filter((e) => e.rule === "C-LANG")).toEqual([]);
  });
});
