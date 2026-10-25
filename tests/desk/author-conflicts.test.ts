import { describe, expect, it } from "vitest";

import { OwnerMemory } from "../../src/desk/engines/memory.ts";
import { pseudonym } from "../../src/desk/security/secrets.ts";

/**
 * Two statements about one author that disagree (DF-116). The engine's detector looks for always and never, not for human and agent, so the Desk puts such a pair to the engine's own
 * gate as a conflict it is certain of. The gate settles it only when its decision confidence is 0.70 or more; the loser is marked superseded and kept; below that, neither
 * statement is applied and the author is listed.
 */
async function pair(): Promise<{ m: OwnerMemory; human: string; agent: string }> {
  let t = Date.UTC(2026, 9, 20, 9, 0, 0);
  const m = await OwnerMemory.open({ clock: () => (t += 60_000) });
  const human = m.remember({ kind: "note", content: "Commits by bot@acme.test are human." }).id;
  const agent = m.remember({ kind: "note", content: "Commits by bot@acme.test are agent work." }).id;
  return { m, human, agent };
}
const who = pseudonym("bot@acme.test");

describe("contradictory statements about one author", () => {
  it("are left alone when the engine is not sure which to trust: neither is applied and the author is listed", async () => {
    const { m } = await pair();
    expect(m.authorRules().conflicts).toEqual(["bot@acme.test"]);
    expect(m.authorRules().byPseudonym.has(who)).toBe(false);
    expect(m.all().filter((n) => n.superseded)).toEqual([]);
  });

  it("settle when the engine's gate is passed: the loser is marked superseded and kept, and the winner is applied", async () => {
    const { m, human, agent } = await pair();
    for (let i = 0; i < 3; i += 1) m.feedback(human, "wrong");
    expect(m.all().find((n) => n.id === human)?.superseded).toBe(true);
    expect(m.all().find((n) => n.id === agent)?.superseded).toBe(false);
    expect(m.all().map((n) => n.id)).toContain(human);
    expect(m.authorRules().conflicts).toEqual([]);
    expect(m.authorRules().byPseudonym.get(who)).toMatchObject({ kind: "agent", memoryId: agent });
  });

  it("do not settle on a single doubt: one wrong mark is below the gate", async () => {
    const { m, human } = await pair();
    m.feedback(human, "wrong");
    expect(m.authorRules().conflicts).toEqual(["bot@acme.test"]);
  });

  it("settle when the second statement arrives, if the first has already been doubted enough", async () => {
    let t = Date.UTC(2026, 9, 20, 9, 0, 0);
    const m = await OwnerMemory.open({ clock: () => (t += 60_000) });
    const first = m.remember({ kind: "note", content: "Commits by bot@acme.test are human." });
    for (let i = 0; i < 3; i += 1) m.feedback(first.id, "wrong");
    const second = m.remember({ kind: "note", content: "Commits by bot@acme.test are agent work." });
    expect(m.all().find((n) => n.id === first.id)?.superseded).toBe(true);
    expect(m.authorRules().byPseudonym.get(who)).toMatchObject({ kind: "agent", memoryId: second.id });
  });

  it("are not touched when they agree, or when they are about different authors", async () => {
    let t = Date.UTC(2026, 9, 20, 9, 0, 0);
    const m = await OwnerMemory.open({ clock: () => (t += 60_000) });
    m.remember({ kind: "note", content: "Commits by a@acme.test are human." });
    m.remember({ kind: "note", content: "Commits by a@acme.test are human." });
    m.remember({ kind: "note", content: "Commits by b@acme.test are agent work." });
    expect(m.authorRules().conflicts).toEqual([]);
    expect(m.all().filter((n) => n.superseded)).toEqual([]);
  });

  it("are replaced in the ordinary way when the owner says which one replaces which", async () => {
    let t = Date.UTC(2026, 9, 20, 9, 0, 0);
    const m = await OwnerMemory.open({ clock: () => (t += 60_000) });
    const first = m.remember({ kind: "note", content: "Commits by bot@acme.test are human." });
    m.remember({ kind: "note", content: "Commits by bot@acme.test are agent work.", supersedes: first.id });
    expect(m.authorRules().conflicts).toEqual([]);
    expect(m.authorRules().byPseudonym.get(who)?.kind).toBe("agent");
  });
});
