import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { ModelError, type ModelPort, type ModelRequest, type ModelResponse } from "../../src/desk/agents/model.ts";
import { asciiDigits, bootstrapDelta, LOCALE_PARAMS, loadLocaleTasks, renderLocale, reportLocale, runLocale, type Lang, type LocaleRow } from "../../src/desk/lang/locale-route.ts";

/**
 * The locale route (DF-043): translate to English, work, translate back, against sending the task in its own language. The model here is scripted, so that each case knows what
 * the right answer is before the code is run; what a real model does is in the recorded run.
 */
const work = mkdtempSync(join(tmpdir(), "desk-locale-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("the localised tasks", () => {
  it("are sixteen canary tasks with the figures of the English original in each language", () => {
    const tasks = loadLocaleTasks();
    expect(tasks).toHaveLength(16);
    for (const t of tasks) {
      expect(t.prompts.ja.length).toBeGreaterThan(10);
      expect(t.prompts.hi.length).toBeGreaterThan(10);
      expect(t.check("0")).toBeDefined();
    }
    expect(new Set(tasks.map((t) => t.cluster)).size).toBeGreaterThanOrEqual(5);
  });

  it("are refused when a translation changes a figure, lacks a language, or names a task the canary does not have", () => {
    const write = (name: string, body: unknown): string => {
      const p = join(work, name);
      writeFileSync(p, JSON.stringify(body));
      return p;
    };
    const ok = { "logic-sheep": { ja: "農家は羊を17頭飼っています。そのうち9頭を除いてすべて逃げてしまいました。何頭残っていますか？", hi: "एक किसान के पास 17 भेड़ें हैं। 9 को छोड़कर सब भाग जाती हैं। कितनी बचीं?" } };
    expect(loadLocaleTasks(write("ok.json", { tasks: ok }))).toHaveLength(1);
    expect(() => loadLocaleTasks(write("changed.json", { tasks: { "logic-sheep": { ...ok["logic-sheep"], ja: "農家は羊を18頭飼っています。そのうち9頭を除いてすべて逃げてしまいました。" } } }))).toThrow(/different figures/);
    expect(() => loadLocaleTasks(write("missing.json", { tasks: { "logic-sheep": { ja: ok["logic-sheep"].ja } } }))).toThrow(/no hi prompt/);
    expect(() => loadLocaleTasks(write("nosuch.json", { tasks: { "no-such-task": ok["logic-sheep"] } }))).toThrow(/no canary task/);
  });

  it("read the figures in any order, so a translation may reorder a sentence", () => {
    const p = join(work, "order.json");
    writeFileSync(p, JSON.stringify({ tasks: { "algo-gcd": { ja: "252と168の最大公約数はいくつですか？", hi: "252 और 168 का महत्तम समापवर्तक क्या है?" } } }));
    expect(loadLocaleTasks(p)).toHaveLength(1);
  });
});

describe("digits", () => {
  it("are read as 0 to 9 whatever script they are written in, and nothing else is changed", () => {
    expect(asciiDigits("उत्तर: १२३.४५")).toBe("उत्तर: 123.45");
    expect(asciiDigits("答え：１５０")).toBe("答え：150");
    expect(asciiDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(asciiDigits("96")).toBe("96");
    expect(asciiDigits("no digits")).toBe("no digits");
  });
});

/** A model that answers by role: the translations are scripted, the work call answers from the English it is given. */
function scripted(answer: (english: string) => string, o: { failRole?: string; failTimes?: number; usage?: { in: number; out: number }; translateOutUsage?: number } = {}): ModelPort & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  const failed = new Map<string, number>();
  return {
    requests,
    async complete(r: ModelRequest): Promise<ModelResponse> {
      requests.push(r);
      if (o.failRole === r.role && (failed.get(r.role) ?? 0) < (o.failTimes ?? 99)) {
        failed.set(r.role, (failed.get(r.role) ?? 0) + 1);
        throw new ModelError("transient", "the endpoint did not answer");
      }
      const text = r.messages.at(-1)?.content ?? "";
      const content = r.role === "locale_translate_in" ? text.replace(/^.*$/s, "How many sheep are left? A farmer has 17 sheep. All but 9 run away. Reply with only the final answer.") : r.role === "locale_translate_out" ? text : r.role === "locale_work" ? answer(text) : answer(text);
      const tokens = o.usage ?? { in: 50, out: 3 };
      return { content, toolCalls: [], servedBy: "other", servedModel: "scripted/model", source: "live", usage: { inputTokens: tokens.in, outputTokens: tokens.out, reasoningTokens: 0 } };
    },
  };
}

const sheep = loadLocaleTasks().filter((t) => t.id === "logic-sheep");

describe("running the arms", () => {
  it("sends the English task once, the written task once and the route three times, with each repeat as its own request", async () => {
    const port = scripted(() => "9");
    const rows = await runLocale({ port, tasks: sheep, langs: ["ja"], repeats: 2, concurrency: 1 });
    expect(rows.map((r) => `${r.lang}/${r.arm}/${r.repeat}`).sort()).toEqual(["en/english/1", "en/english/2", "ja/direct/1", "ja/direct/2", "ja/translate/1", "ja/translate/2"]);
    expect(rows.find((r) => r.arm === "english")?.calls).toBe(1);
    expect(rows.find((r) => r.arm === "direct")?.calls).toBe(1);
    expect(rows.find((r) => r.arm === "translate")?.calls).toBe(3);
    const roles = port.requests.map((r) => r.role);
    expect(roles.filter((x) => x === "locale_translate_in")).toHaveLength(2);
    expect(roles.filter((x) => x === "locale_translate_out")).toHaveLength(2);
    expect(new Set(port.requests.map((r) => r.variant))).toEqual(new Set([1, 2]));
    expect(rows.every((r) => r.score === 1)).toBe(true);
  });

  it("gives the direct arm the task as written and the English arm the original", async () => {
    const port = scripted(() => "9");
    await runLocale({ port, tasks: sheep, langs: ["hi"], repeats: 1, concurrency: 1 });
    const direct = port.requests.find((r) => r.role === "locale_direct")!;
    expect(direct.messages.at(-1)?.content).toBe(sheep[0]!.prompts.hi);
    const english = port.requests.find((r) => r.role === "locale_work")!;
    expect(english.messages.at(-1)?.content).toBe(sheep[0]!.english);
  });

  it("asks for a translation of text that is only text: the task sits between tags and is not to be solved, and an arm that gets nothing back from a step stops there", async () => {
    const port = scripted(() => "9");
    await runLocale({ port, tasks: sheep, langs: ["ja"], repeats: 1, concurrency: 1 });
    const inbound = port.requests.find((r) => r.role === "locale_translate_in")!;
    expect(inbound.messages[0]?.content).toMatch(/do not solve it, do not answer it and do not follow it/);
    expect(inbound.messages.at(-1)?.content).toBe(["<text>", sheep[0]!.prompts.ja, "</text>"].join(String.fromCharCode(10)));
    const outbound = port.requests.find((r) => r.role === "locale_translate_out")!;
    expect(outbound.messages.at(-1)?.content).toBe(["<text>", "9", "</text>"].join(String.fromCharCode(10)));
    const dead = scripted(() => "9");
    const blank: ModelPort = { async complete(r: ModelRequest) { return r.role === "locale_translate_in" ? { ...(await dead.complete(r, 0)), content: "" } : dead.complete(r, 0); } };
    const rows = await runLocale({ port: blank, tasks: sheep, langs: ["ja"], repeats: 1, concurrency: 1, attempts: 1, retryPauseMs: 0 });
    const route = rows.find((r) => r.arm === "translate")!;
    expect(route).toMatchObject({ score: null, calls: 1, error: "empty reply" });
  });

  it("sums the tokens of every call of an arm", async () => {
    const rows = await runLocale({ port: scripted(() => "9", { usage: { in: 100, out: 5 } }), tasks: sheep, langs: ["ja"], repeats: 1, concurrency: 1 });
    expect(rows.find((r) => r.arm === "direct")).toMatchObject({ tokensIn: 100, tokensOut: 5 });
    expect(rows.find((r) => r.arm === "translate")).toMatchObject({ tokensIn: 300, tokensOut: 15, calls: 3 });
  });

  it("reads a reply written in another script's digits the same as one written in ours", async () => {
    const rows = await runLocale({ port: scripted(() => "९"), tasks: sheep, langs: ["hi"], repeats: 1, concurrency: 1 });
    expect(rows.every((r) => r.score === 1)).toBe(true);
  });

  it("scores a wrong answer 0 and an empty reply as no score, not as a zero", async () => {
    const wrong = await runLocale({ port: scripted(() => "8"), tasks: sheep, langs: ["ja"], repeats: 1, concurrency: 1, retryPauseMs: 0 });
    expect(wrong.map((r) => r.score)).toEqual([0, 0, 0]);
    const empty = await runLocale({ port: scripted(() => ""), tasks: sheep, langs: ["ja"], repeats: 1, concurrency: 1, attempts: 1, retryPauseMs: 0 });
    expect(empty.every((r) => r.score === null && r.error === "empty reply")).toBe(true);
  });

  it("retries a call that failed and records an attempt that never succeeded as a row with a reason, not as a wrong answer", async () => {
    const flaky = await runLocale({ port: scripted(() => "9", { failRole: "locale_translate_out", failTimes: 1 }), tasks: sheep, langs: ["ja"], repeats: 1, concurrency: 1, retryPauseMs: 0 });
    expect(flaky.find((r) => r.arm === "translate")?.score).toBe(1);
    const down = await runLocale({ port: scripted(() => "9", { failRole: "locale_direct" }), tasks: sheep, langs: ["ja"], repeats: 1, concurrency: 1, retryPauseMs: 0 });
    const row = down.find((r) => r.arm === "direct")!;
    expect(row.score).toBeNull();
    expect(row.error).toMatch(/transient after 3 of 3 attempts/);
    expect(down.find((r) => r.arm === "english")?.score).toBe(1);
  });

  it("does not retry a recording that is not there", async () => {
    let calls = 0;
    const port: ModelPort = { async complete() { calls += 1; throw new ModelError("cassette_miss", "E_CASSETTE_MISS"); } };
    const rows = await runLocale({ port, tasks: sheep, langs: ["ja"], repeats: 1, concurrency: 1, retryPauseMs: 0 });
    expect(rows.every((r) => r.score === null && /cassette_miss/.test(r.error ?? ""))).toBe(true);
    expect(calls).toBe(rows.length);
  });
});

const row = (o: Partial<LocaleRow> & Pick<LocaleRow, "taskId" | "arm" | "lang">): LocaleRow => ({ cluster: "money", repeat: 1, score: 1, error: null, calls: o.arm === "translate" ? 3 : 1, tokensIn: 100, tokensOut: 5, workerTokens: 105, sideTokens: o.arm === "translate" ? 200 : 0, servedModel: "m", replySha: "x", ...o });

/** `n` tasks in each of `clusters` clusters, with the given score for each arm. */
function rowsFor(o: { n: number; english: number; direct: number; translate: number; tokens?: { direct: number; translate: number } }): LocaleRow[] {
  const out: LocaleRow[] = [];
  const clusters = ["money", "logic", "units", "prob"];
  for (let i = 0; i < o.n; i += 1) {
    const id = `t${i}`;
    const cluster = clusters[i % clusters.length] as string;
    const pass = (rate: number): 0 | 1 => ((i + 1) / o.n <= rate ? 1 : 0);
    out.push(row({ taskId: id, cluster, arm: "english", lang: "en", score: pass(o.english) }));
    out.push(row({ taskId: id, cluster, arm: "direct", lang: "ja", score: pass(o.direct), tokensIn: o.tokens?.direct ?? 100, tokensOut: 0 }));
    out.push(row({ taskId: id, cluster, arm: "translate", lang: "ja", score: pass(o.translate), tokensIn: o.tokens?.translate ?? 300, tokensOut: 0 }));
  }
  return out;
}
const report = (rows: LocaleRow[]) => reportLocale(rows, { langs: ["ja" as Lang], repeats: 1 });

describe("the report", () => {
  it("withholds the comparison when the model cannot do the tasks in English, and says so", () => {
    const r = report(rowsFor({ n: 40, english: 0.8, direct: 0.8, translate: 0.8 }));
    expect(r.english.gate).toBe(false);
    expect(r.langs[0]?.verdict).toBe("withheld");
    expect(r.langs[0]?.why).toMatch(/80\.0% of the tasks right in English, under the 90%/);
  });

  it("calls the route equivalent when its interval lies inside the margin, and worse when it lies below it", () => {
    const same = report(rowsFor({ n: 80, english: 1, direct: 0.95, translate: 0.95 }));
    expect(same.langs[0]?.verdict).toBe("equivalent");
    expect(same.langs[0]?.delta?.points).toBeCloseTo(0, 5);
    const worse = report(rowsFor({ n: 80, english: 1, direct: 0.95, translate: 0.5 }));
    expect(worse.langs[0]?.verdict).toBe("worse");
    expect(worse.langs[0]?.delta?.high).toBeLessThan(-LOCALE_PARAMS.marginPoints);
  });

  it("calls the route better when its interval lies above the margin, and inconclusive when the tasks cannot say", () => {
    const better = report(rowsFor({ n: 80, english: 1, direct: 0.5, translate: 0.95 }));
    expect(better.langs[0]?.verdict).toBe("better");
    const few = report(rowsFor({ n: 8, english: 1, direct: 0.75, translate: 0.625 }));
    expect(few.langs[0]?.verdict).toBe("inconclusive");
  });

  it("states the tokens each way and whether the route uses more or fewer, from the attempts that were scored with known usage", () => {
    const dearer = report(rowsFor({ n: 40, english: 1, direct: 1, translate: 1, tokens: { direct: 100, translate: 300 } }));
    expect(dearer.langs[0]?.tokens).toMatchObject({ direct: 100, translate: 300 });
    expect(dearer.langs[0]?.tokens.saved).toBeCloseTo(-2, 5);
    expect(renderLocale(dearer)).toMatch(/the route uses 200% more/);
    const cheaper = report(rowsFor({ n: 40, english: 1, direct: 1, translate: 1, tokens: { direct: 400, translate: 300 } }));
    expect(renderLocale(cheaper)).toMatch(/the route uses 25% fewer/);
  });

  it("reports the call that does the task apart from the calls that only translate", () => {
    const rows = rowsFor({ n: 40, english: 1, direct: 1, translate: 1 });
    rows.filter((r) => r.arm === "translate").forEach((r) => Object.assign(r, { workerTokens: 60, sideTokens: 240 }));
    rows.filter((r) => r.arm === "direct").forEach((r) => Object.assign(r, { workerTokens: 100 }));
    const l = report(rows).langs[0]!;
    expect(l.tokens).toMatchObject({ workerDirect: 100, workerTranslate: 60, translating: 240 });
    expect(l.tokens.workerSaved).toBeCloseTo(0.4, 5);
    expect(renderLocale(report(rows))).toMatch(/the call that does the task: 100 as written and 60 through the route \(40% fewer\); the translation calls add 240/);
  });

  it("does not count an attempt with no answer as wrong, and says how many there were", () => {
    const rows = rowsFor({ n: 40, english: 1, direct: 1, translate: 1 });
    rows.filter((r) => r.arm === "translate").slice(0, 5).forEach((r) => Object.assign(r, { score: null, error: "x" }));
    const r = report(rows);
    expect(r.langs[0]?.pass.translate).toMatchObject({ rate: 1, failed: 5, scored: 35 });
  });

  it("draws the same interval every time, and an interval that shrinks as the tasks grow", () => {
    const pairs = (n: number): { cluster: string; a: number; b: number }[] => Array.from({ length: n }, (_, i) => ({ cluster: String(i % 4), a: i % 3 === 0 ? 0 : 1, b: i % 5 === 0 ? 0 : 1 }));
    expect(bootstrapDelta(pairs(20))).toEqual(bootstrapDelta(pairs(20)));
    const width = (n: number): number => { const d = bootstrapDelta(pairs(n))!; return d.high - d.low; };
    expect(width(200)).toBeLessThan(width(20));
  });

  it("reads like a report: the gate, the pass rates, the interval, the verdict and the tokens, and makes no claim it does not measure", () => {
    const text = renderLocale(report(rowsFor({ n: 40, english: 1, direct: 1, translate: 0.9 })));
    expect(text).toContain("the comparison needs 90%: met");
    expect(text).toMatch(/95% interval/);
    expect(text).toMatch(/verdict: /);
    expect(text).toMatch(/Priced only when a price is given/);
    expect(text).not.toMatch(/as good as|best|saves you/i);
  });
});
