import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { exportStaticUi, fileFor, keyOf } from "../../../src/desk/ui/export.ts";
import type { UiServer } from "../../../src/desk/ui/server.ts";

/**
 * The hosted copy of the screens (`desk ui --export`): the page reads recorded answers from files instead of asking a server. Tested against a stand-in that answers a few
 * endpoints in process, so that what is checked is the export itself: the key a request is stored under, what is written, what is refused, and that the copy holds nothing
 * of the machine it was made on.
 */
let dir: string;
const asked: string[] = [];

const standIn = (mode: string): UiServer =>
  ({
    answer: async (path: string, params: Record<string, string>) => {
      asked.push(keyOf(path, params));
      if (path === "/api/meta") return { status: 200, body: { mode, screens: [] } };
      if (path === "/api/bill") return { status: 200, body: { state: "ok", range: params["range"] } };
      if (path === "/api/week") return { status: 200, body: { state: "ok", weeks: params["week"] ? [] : ["2026-W43", "2026-W42"] } };
      if (path === "/api/ask") return { status: 200, body: { state: "ok", suggestions: ["a question"], engines: ["world_model"], q: params["q"] ?? "" } };
      return { status: 404, body: null };
    },
  }) as unknown as UiServer;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "desk-export-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the key a recorded answer is stored under", () => {
  it("is the path and the non-empty parameters, sorted, the same as the page builds it", () => {
    expect(keyOf("/api/bill", { range: "30" })).toBe("/api/bill?range=30");
    expect(keyOf("/api/sessions", { sort: "cost", range: "7", limit: "50", offset: "0" })).toBe("/api/sessions?limit=50&offset=0&range=7&sort=cost");
    expect(keyOf("/api/ask", { q: "", ablate: "hmem" })).toBe("/api/ask?ablate=hmem");
    expect(keyOf("/api/meta")).toBe("/api/meta?");
    expect(fileFor("/api/meta?")).toMatch(/^[0-9a-f]{24}[.]json$/);
  });
});

describe("exportStaticUi", () => {
  it("writes the page, its scripts and fonts, and every answer it could record, and says what it could not", async () => {
    const out = join(dir, "site");
    const r = await exportStaticUi(standIn("sample"), out);
    const data = {
      entries: Object.fromEntries(
        readdirSync(join(out, "data")).map((f) => {
          const j = JSON.parse(readFileSync(join(out, "data", f), "utf8")) as { key: string; body: { range?: string } };
          return [j.key, j.body];
        }),
      ),
    } as { entries: Record<string, { range?: string }> };
    expect(readdirSync(join(out, "data")).sort()).toEqual(Object.keys(data.entries).map(fileFor).sort());
    expect(data.entries["/api/meta?"]).toBeDefined();
    expect(data.entries["/api/bill?range=30"]?.range).toBe("30");
    expect(Object.keys(data.entries).filter((k) => k.startsWith("/api/bill?")).length).toBe(5);
    expect(data.entries["/api/week?week=2026-W42"]).toBeDefined();
    expect(Object.keys(data.entries).some((k) => k.startsWith("/api/ask?ablate=world_model&q="))).toBe(true);
    expect(r.entries).toBe(Object.keys(data.entries).length);
    expect(r.skipped.length).toBeGreaterThan(0);
    const files = readdirSync(out);
    for (const f of ["index.html", "app.js", "styles.css", "data", "fonts", "lib", "screens"]) expect(files, f).toContain(f);
  });

  it("tells the page to read its answers from the recorded files, and keeps every address relative and the page's own", () => {
    const html = readFileSync(join(dir, "site", "index.html"), "utf8");
    expect(html).toContain('<meta name="desk-static" content="data/">');
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain('href="styles.css"');
    expect(html).toContain('src="app.js"');
    expect(html).not.toMatch(/(?:href|src)="\/(?!\/)/);
    expect(readFileSync(join(dir, "site", "styles.css"), "utf8")).not.toContain('url("/');
  });

  it("holds nothing of the machine it was made on", () => {
    const files = [...readdirSync(join(dir, "site", "data")).map((f) => join(dir, "site", "data", f)), join(dir, "site", "index.html"), join(dir, "site", "app.js")];
    const all = files.map((f) => readFileSync(f, "utf8")).join(" ");
    expect(all).not.toContain(dir);
  });

  it("refuses to export anything but the constructed sample", async () => {
    await expect(exportStaticUi(standIn("own_logs"), join(dir, "own"))).rejects.toThrow(/constructed sample/);
  });
});
