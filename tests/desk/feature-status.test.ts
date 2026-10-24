import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { renderFeatureStatus, summariseFeatures, type FeatureRow } from "../../src/desk/status/features.ts";

const LIST = "docs/design/desk/02-feature-list.md";
const TABLE = "docs/design/desk/feature-status.json";

const rows = (JSON.parse(readFileSync(TABLE, "utf8")) as { features: FeatureRow[] }).features;
const listed = [...readFileSync(LIST, "utf8").matchAll(/^### (DF-\d{3}) (.+)$/gm)].map((m) => ({ id: m[1]!, title: m[2]!.trim() }));

describe("the feature status table", () => {
  it("has exactly one row for every feature the specification lists, and no other", () => {
    expect(listed).toHaveLength(129);
    expect(rows.map((r) => r.id).sort()).toEqual(listed.map((f) => f.id).sort());
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("uses only the three statuses", () => {
    for (const r of rows) expect(["built", "partial", "absent"]).toContain(r.status);
  });

  it("cites a file that exists for every feature it calls built or partial, and a test or a prove check for every built one", () => {
    for (const r of rows) {
      if (r.status === "absent") continue;
      expect(r.evidence.length, `${r.id} has no evidence`).toBeGreaterThan(0);
      for (const path of r.evidence) expect(existsSync(path), `${r.id} cites ${path}, which does not exist`).toBe(true);
      if (r.status === "built") {
        const exercised = r.evidence.some((p) => p.startsWith("tests/") || p === "src/desk/prove/run.ts" || p.startsWith("docs/verification/"));
        expect(exercised, `${r.id} is built but cites no test, prove check or verification record`).toBe(true);
      }
    }
  });

  it("names what is missing for every feature that is not built", () => {
    for (const r of rows) {
      if (r.status === "built") continue;
      expect(r.missing.trim().length, `${r.id} does not say what is missing`).toBeGreaterThan(10);
    }
  });

  it("does not let an absent feature cite code", () => {
    for (const r of rows.filter((x) => x.status === "absent")) {
      expect(r.evidence.every((p) => p.startsWith("docs/")), `${r.id} is absent but cites code`).toBe(true);
    }
  });

  it("counts and renders the table the same way every time", () => {
    const s = summariseFeatures(rows);
    expect(s.built + s.partial + s.absent).toBe(129);
    const text = renderFeatureStatus(rows, listed);
    expect(text).toBe(renderFeatureStatus(rows, listed));
    expect(text).toContain(`${s.built} built`);
    expect(text).toContain("DF-129");
    expect(text).not.toMatch(/undefined|NaN/);
  });
});
