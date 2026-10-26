import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `metadata.json` at the repository root says what each sponsor does in the product, where, and the evidence. The organizers published no format for it, so this test
 * holds it to what can be held: it is valid JSON, every file it names exists, and what it says about the video, the repository and the track agrees with the README.
 */
const meta = JSON.parse(readFileSync("metadata.json", "utf8")) as Record<string, unknown> & {
  repository: string;
  demo_video: string;
  track: string;
  slide_deck: string;
  pre_existing_components: string;
  sponsors: Record<string, { required: boolean; status: string; role: string; where: string[]; evidence: string[] }>;
};
const readme = readFileSync("README.md", "utf8");

const paths = (list: readonly string[]): string[] => list.filter((p) => /^[\w.\-]+\/[\w./\-]*$|\.(md|json|ts|pdf)$/.test(p) && !p.startsWith("desk ") && !p.startsWith("npm "));

describe("metadata.json", () => {
  it("names the four sponsors, and each one says what it does and where", () => {
    expect(Object.keys(meta.sponsors).sort()).toEqual(["cursor", "meterless", "nvidia", "zetaris"]);
    for (const [name, s] of Object.entries(meta.sponsors)) {
      expect(s.role.length, name).toBeGreaterThan(40);
      expect(["working", "not used"], name).toContain(s.status);
    }
    expect(meta.sponsors["zetaris"]!.required && meta.sponsors["meterless"]!.required).toBe(true);
  });

  it("names only files that exist", () => {
    const named = [meta.slide_deck, meta.pre_existing_components, ...Object.values(meta.sponsors).flatMap((s) => [...s.where, ...s.evidence])];
    const missing = paths(named).filter((p) => !existsSync(p));
    expect(missing).toEqual([]);
  });

  it("agrees with the README on the track, the repository and the video", () => {
    expect(readme).toContain(meta.demo_video);
    expect(readme).toContain(meta.repository);
    expect(meta.track).toMatch(/Track 3/);
    expect(readme).toMatch(/Track 3/);
  });

  it("claims no Cursor use", () => {
    expect(meta.sponsors["cursor"]!.status).toBe("not used");
  });
});
