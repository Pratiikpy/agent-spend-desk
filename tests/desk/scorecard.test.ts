import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ArmId } from "../../src/desk/bench/arms.ts";
import type { BenchRow } from "../../src/desk/bench/run.ts";
import { ephemeralSigner } from "../../src/desk/dossier/keys.ts";
import { checkScorecard, signScorecard, writeScorecard, type ScorecardPaths } from "../../src/desk/scorecard/command.ts";
import { canonicalJson, digestDir, digestFile, measured, notApplicable, notVerified, type Scorecard } from "../../src/desk/scorecard/model.ts";
import { renderScorecard } from "../../src/desk/scorecard/render.ts";
import { repeatSection, rolesSection } from "../../src/desk/scorecard/roles.ts";
import { cursorSection } from "../../src/desk/scorecard/sponsors.ts";

/**
 * The scorecard's figures are computed, never typed, and a figure that goes against the Desk is published. Each case builds its own rows or files so that the answer is known
 * before the code is run. The full page, with the sample ledger and the replays from recordings, is recomputed by `desk prove` (scorecard-recomputes-byte-for-byte).
 */
let work: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "desk-scorecard-test-"));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

function row(qid: string, arm: ArmId, exact: boolean, o: Partial<BenchRow> = {}): BenchRow {
  return { qid, trial: 0, arm, category: "lookup", split: "dev", answer: "", error: null, exact, close: false, abstained: false, resisted: null, rejectedPremise: null, extraFigures: 0, modelCalls: 1, tokensIn: 0, tokensOut: 0, servedModel: "test-model", ms: 1, detail: "", ...o };
}

/** `n` questions; each arm gets the first `right[arm]` of them right. */
function rowsFor(n: number, right: Partial<Record<ArmId, number>>): BenchRow[] {
  const out: BenchRow[] = [];
  for (const [arm, k] of Object.entries(right) as [ArmId, number][]) for (let i = 0; i < n; i += 1) out.push(row(`Q${String(i + 1).padStart(2, "0")}`, arm, i < k));
  return out;
}

const metric = (s: { metrics: { id: string; value: string }[] }, id: string): string | undefined => s.metrics.find((m) => m.id === id)?.value;

describe("digests", () => {
  it("read CRLF and LF as the same file, and a changed byte as a different one", () => {
    const a = join(work, "a.txt");
    const b = join(work, "b.txt");
    writeFileSync(a, "one\ntwo\n");
    writeFileSync(b, "one\r\ntwo\r\n");
    expect(digestFile(a)).toBe(digestFile(b));
    writeFileSync(b, "one\r\ntwx\r\n");
    expect(digestFile(a)).not.toBe(digestFile(b));
    expect(digestFile(join(work, "absent"))).toBe("missing");
  });

  it("make a folder's digest depend on the names and contents, not on the order they were written", () => {
    const d1 = join(work, "d1");
    const d2 = join(work, "d2");
    mkdirSync(d1);
    mkdirSync(d2);
    writeFileSync(join(d1, "x.json"), "{}");
    writeFileSync(join(d1, "y.json"), "[]");
    writeFileSync(join(d2, "y.json"), "[]");
    writeFileSync(join(d2, "x.json"), "{}");
    expect(digestDir(d1)).toBe(digestDir(d2));
    writeFileSync(join(d2, "z.json"), "1");
    expect(digestDir(d1)).not.toBe(digestDir(d2));
    expect(digestDir(join(work, "nothing"))).toBe("missing");
  });
});

describe("the roles section", () => {
  it("calls a role necessary when taking it out loses questions, and not shown necessary when nothing differs", () => {
    const s = rolesSection(rowsFor(40, { A2: 40, A3: 40, A7: 20 }));
    expect(metric(s, "roles.A7.finding")).toBe("necessary on this set");
    expect(metric(s, "roles.A3.finding")).toBe("not shown necessary");
    expect(metric(s, "roles.A2.exact")).toBe("40 of 40");
    expect(metric(s, "roles.A7.exact")).toBe("20 of 40");
    expect(s.findings.join(" ")).toContain("not claimed as useful, and it is not called useless");
  });

  it("publishes a role found harmful, with the counts, and does not hide it", () => {
    const s = rolesSection(rowsFor(40, { A2: 20, A5: 40 }));
    expect(metric(s, "roles.A5.finding")).toBe("harmful here");
    expect(s.findings.some((f) => f.includes("revision loop: harmful here"))).toBe(true);
    const m = s.metrics.find((x) => x.id === "roles.A5.finding")!;
    expect((m as { note?: string }).note).toContain("0 questions only the full Desk got right, 20 only this arm");
  });

  it("marks a prediction that did not hold as failed, and one that cannot be checked as not verified", () => {
    const s = rolesSection(rowsFor(40, { A2: 30, A6: 30, A7: 30 }));
    const p1 = s.metrics.find((m) => m.id === "roles.prediction.1")!;
    expect(p1.value).toBe("failed");
    const p8 = s.metrics.find((m) => m.id === "roles.prediction.8")!;
    expect(p8.status).toBe("not_verified");
    expect(p8.value).toContain("seconds NOT VERIFIED");
  });

  it("does not claim the Auditor is necessary under a fault unless clean answers differ", () => {
    const rows = [...rowsFor(40, { A2: 40, A4: 40 }), ...rowsFor(40, { A2F: 40, A4F: 40 })];
    const s = rolesSection(rows);
    const m = s.metrics.find((x) => x.id === "roles.auditor.under-fault")!;
    expect(m.note ?? "").toContain("not shown necessary under this fault");
  });

  it("says nothing about an arm that was not run, and does not fail on an empty set", () => {
    const s = rolesSection([]);
    expect(s.metrics.filter((m) => m.id.endsWith(".exact"))).toEqual([]);
    expect(s.findings.join(" ")).toContain("predictions");
  });

  it("is the same when run twice on the same rows", () => {
    const rows = rowsFor(40, { A2: 40, A3: 39, A7: 20 });
    expect(JSON.stringify(rolesSection(rows))).toBe(JSON.stringify(rolesSection(rows)));
  });
});

describe("the repeat-run section", () => {
  it("marks pass^k not verified when too few trials were recorded", () => {
    const rows = [...rowsFor(10, { A2: 10 }), ...Array.from({ length: 10 }, (_, i) => ({ ...row(`Q${String(i + 1).padStart(2, "0")}`, "A2", true), trial: 1 }))];
    const s = repeatSection(rows);
    const p2 = s.metrics.find((m) => m.id === "repeat.A2.pass2");
    expect(p2).toBeUndefined();
    expect(metric(s, "repeat.A2.pass1")).toBe("100.0%");
  });

  it("computes pass^k as the chance that k trials of a question are all exact", () => {
    // Two questions, three sampled trials each: Q01 right in all three, Q02 right in one of three. pass^1 = (1 + 1/3) / 2, pass^3 = (1 + 0) / 2.
    const rows: BenchRow[] = [];
    for (const [q, hits] of [["Q01", [true, true, true]], ["Q02", [true, false, false]]] as const) hits.forEach((h, i) => rows.push({ ...row(q, "A2", h), trial: i + 1 }));
    const s = repeatSection(rows);
    expect(metric(s, "repeat.A2.pass1")).toBe("66.7%");
    expect(metric(s, "repeat.A2.pass3")).toBe("50.0%");
  });
});

describe("the Cursor section", () => {
  it("counts the sessions written in the log and says NOT VERIFIED when there are none", () => {
    const empty = join(work, "cursor-empty.md");
    writeFileSync(empty, "# Cursor\n\n## Session log\n\n| Date (UTC) | Who |\n|---|---|\n| | |\n");
    const none = cursorSection(empty);
    expect(none.metrics[0]!.status).toBe("not_verified");
    expect(none.findings.join(" ")).toContain("No claim about Cursor is made");
    const used = join(work, "cursor-used.md");
    writeFileSync(used, "# Cursor\n\n| Date (UTC) | Who |\n|---|---|\n| 2026-10-26 | A | refactor |\n| 2026-10-27 | A | tests |\n");
    const some = cursorSection(used);
    expect(some.metrics[0]).toMatchObject({ status: "measured", value: "2" });
  });

  it("says NOT VERIFIED when the log does not exist", () => {
    expect(cursorSection(join(work, "missing.md")).metrics[0]!.status).toBe("not_verified");
  });
});

function card(): Scorecard {
  return {
    version: 1,
    sections: [
      {
        id: "a",
        title: "A section",
        question: "Is it?",
        reproduce: ["npm run desk -- scorecard"],
        seed: 7,
        inputs: [{ path: "x.json", digest: "sha256:0123456789abcdef0123" }],
        metrics: [measured("a.1", "A pipe | in a label", "3 of 4", "a | note"), notVerified("a.2", "Unmeasured", "no way to measure it yet"), notApplicable("a.3", "Not a thing", "does not exist here")],
        findings: ["It is."],
        limits: ["It is small."],
      },
    ],
  };
}

describe("the page", () => {
  it("escapes a pipe in a cell, lists every unmeasured metric under Not measured, and is the same each time", () => {
    const text = renderScorecard(card());
    expect(text).toContain("A pipe \\| in a label | 3 of 4 | a \\| note");
    expect(text).toContain("## Not measured");
    expect(text).toContain("A section: Unmeasured. NOT VERIFIED: no way to measure it yet");
    expect(text).toContain("A section: Not a thing. Not applicable: does not exist here");
    expect(renderScorecard(card())).toBe(text);
  });

  it("says every metric was measured when none was left out", () => {
    const c = card();
    c.sections[0]!.metrics = [measured("a.1", "L", "1")];
    expect(renderScorecard(c)).toContain("Every metric on this page was measured.");
  });
});

describe("checking the page against the committed files", () => {
  const paths = (name: string): ScorecardPaths => ({ md: join(work, name, "page.md"), json: join(work, name, "page.json"), dsse: join(work, name, "page.dsse.json"), pins: join(work, name, "pins.json") });

  it("passes for files written from the same scorecard, with CRLF line endings too", () => {
    const p = paths("ok");
    writeScorecard(card(), p);
    expect(checkScorecard(card(), p)).toEqual({ ok: true, problems: [] });
    writeFileSync(p.md, renderScorecard(card()).replace(/\n/g, "\r\n"));
    expect(checkScorecard(card(), p).ok).toBe(true);
  });

  it("names the first line that differs when the page or its JSON was edited, and when a file is missing", () => {
    const p = paths("edit");
    writeScorecard(card(), p);
    writeFileSync(p.md, renderScorecard(card()).replace("3 of 4", "4 of 4"));
    const r = checkScorecard(card(), p);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/page\.md differs from the recomputed page \(line \d+/);
    expect(r.problems.join(" ")).toContain('"| A pipe \\\\| in a label | 4 of 4');
    writeScorecard(card(), p);
    writeFileSync(p.json, canonicalJson(card()).replace('"seed": 7', '"seed": 8'));
    expect(checkScorecard(card(), p).problems.join(" ")).toContain("page.json differs");
    rmSync(p.md);
    expect(checkScorecard(card(), p).problems.join(" ")).toContain("page.md is missing");
  });

  it("fails when the numbers changed since the page was written", () => {
    const p = paths("stale");
    writeScorecard(card(), p);
    const changed = card();
    changed.sections[0]!.metrics[0] = measured("a.1", "A pipe | in a label", "2 of 4");
    expect(checkScorecard(changed, p).ok).toBe(false);
  });

  it("verifies a signed scorecard, and refuses one whose payload, signer or pins are wrong", () => {
    const p = paths("signed");
    const signer = ephemeralSigner();
    writeScorecard(card(), p);
    signScorecard(card(), signer, p);
    expect(checkScorecard(card(), p)).toEqual({ ok: true, problems: [] });

    // The page was changed after it was signed: the signature is on the old numbers.
    const changed = card();
    changed.sections[0]!.metrics[0] = measured("a.1", "A pipe | in a label", "2 of 4");
    const p2 = paths("signed-changed");
    writeScorecard(changed, p2);
    signScorecard(card(), signer, p2);
    expect(checkScorecard(changed, p2).problems.join(" ")).toContain("the signed payload is not the recomputed scorecard");

    // Pinned to a different key.
    const p3 = paths("signed-other-key");
    writeScorecard(card(), p3);
    signScorecard(card(), signer, p3);
    const other = ephemeralSigner();
    writeFileSync(p3.pins, `${JSON.stringify({ version: 1, keys: [{ keyid: other.keyid, publicKey: other.publicKey }] })}\n`);
    expect(checkScorecard(card(), p3).problems.join(" ")).toMatch(/does not verify/);

    // Signed but the pins are gone.
    rmSync(p.pins);
    expect(checkScorecard(card(), p).problems.join(" ")).toContain("pins");
  });
});

describe("the Scout Intent rows of the committed scorecard", () => {
  it("are measured, not left as NOT VERIFIED, and say how the router was tuned and who wrote the questions", () => {
    const card = JSON.parse(readFileSync("docs/evaluation/reasoning-scorecard.json", "utf8")) as Scorecard;
    const engines = card.sections.find((s) => s.id === "engines")!;
    const rows = engines.metrics.filter((m) => m.id.startsWith("engines.scout_intent"));
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows.every((m) => m.status === "measured")).toBe(true);
    expect(rows.find((m) => m.id === "engines.scout_intent.test.accuracy")?.note).toMatch(/not tuned on/);
    expect(rows.find((m) => m.id === "engines.scout_intent.harness.v2")?.value).toMatch(/^fail: /);
    expect(engines.limits.join(" ")).toMatch(/written by the people who built the router/);
    expect(engines.inputs.map((i) => i.path)).toContain("evals/scout/desk/test/routes.jsonl");
  });
});
