import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { sampleEnv } from "../../src/desk/prove/env.ts";
import { DEFAULT_SAMPLE } from "../../src/desk/sample/gen.ts";
import { SAMPLE_NOW_MS } from "../../src/desk/sample/clock.ts";

/**
 * The constructed sample has a clock of its own. Its merged commits turn from merged to kept a week after they were written, and they run to 4 November 2026, so read at the
 * real time of day the same sample gave different landing figures from one day to the next, and model replies recorded against it stopped matching the questions put to them.
 * Landing is judged at SAMPLE_NOW_MS wherever the sample is read.
 */
const work = mkdtempSync(join(tmpdir(), "desk-sample-clock-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
afterEach(() => vi.useRealTimers());

const SMALL = { ...DEFAULT_SAMPLE, engineers: 3 };

const states = (db: Awaited<ReturnType<typeof sampleEnv>>["db"]): Record<string, number> =>
  Object.fromEntries((db.prepare("SELECT state, COUNT(*) AS n FROM session_outcome GROUP BY state ORDER BY state").all() as unknown as { state: string; n: number }[]).map((r) => [r.state, r.n]));

describe("the sample's clock", () => {
  it("gives the same landing figures whatever the real date is", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-25T05:00:00Z"));
    const early = await sampleEnv(join(work, "a"), undefined, SMALL);
    const a = states(early.db);
    early.db.close();
    vi.setSystemTime(new Date("2027-03-01T05:00:00Z"));
    const late = await sampleEnv(join(work, "b"), undefined, SMALL);
    const b = states(late.db);
    late.db.close();
    expect(b).toEqual(a);
    expect(Object.keys(a)).toContain("merged");
  }, 120_000);

  it("is not the real clock: a later instant moves merged commits to kept", async () => {
    const dir = join(work, "c");
    const now = await sampleEnv(dir, SAMPLE_NOW_MS, SMALL);
    const pinned = states(now.db);
    now.db.close();
    const later = await sampleEnv(dir, Date.UTC(2027, 0, 1), SMALL);
    const moved = states(later.db);
    later.db.close();
    expect(moved["kept"] ?? 0).toBeGreaterThan(pinned["kept"] ?? 0);
    expect(moved["merged"] ?? 0).toBeLessThan(pinned["merged"] ?? 0);
  }, 120_000);

  it("lies inside the interval in which the sample's recordings were made", () => {
    expect(SAMPLE_NOW_MS).toBeGreaterThan(Date.UTC(2026, 9, 23, 21, 51));
    expect(SAMPLE_NOW_MS).toBeLessThan(Date.UTC(2026, 9, 25, 15, 42));
  });
});
