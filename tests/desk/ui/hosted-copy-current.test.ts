import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The hosted copy in `docs/demo/` is made by `npm run desk -- ui --sample --export docs/demo`. Its scripts and styles are the screens' own files; this test fails when a screen
 * changes and the copy was not made again, so that the page people open on the web is never an older product than the one in the repository.
 */
const SRC = "src/desk/ui/client";
const COPY = "docs/demo";
const normal = (f: string): string => readFileSync(f, "utf8").replace(/\r\n/g, "\n");

function walk(dir: string, prefix = ""): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n), `${prefix}${n}/`) : [`${prefix}${n}`]));
}

describe("the hosted copy of the screens", () => {
  it("holds every script and style of the screens, unchanged", () => {
    expect(existsSync(join(COPY, "index.html"))).toBe(true);
    const stale = walk(SRC).filter((f) => f !== "index.html" && /\.(js|css)$/.test(f) && (!existsSync(join(COPY, f)) || normal(join(SRC, f)) !== normal(join(COPY, f))));
    expect(stale, "re-make the copy: npm run desk -- ui --sample --export docs/demo").toEqual([]);
  });

  it("is the screens' own page with the recorded-answers tag added, and nothing else changed", () => {
    const page = normal(join(SRC, "index.html"));
    const copy = normal(join(COPY, "index.html"));
    expect(copy).toContain('<meta name="desk-static" content="data/">');
    expect(copy.replace(/<meta name="desk-static"[^\n]*\n<meta http-equiv="Content-Security-Policy"[^\n]*\n/, "")).toBe(page);
  });
});
