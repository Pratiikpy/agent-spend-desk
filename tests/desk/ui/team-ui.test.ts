import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSignerFile, loadSigner } from "../../../src/desk/dossier/keys.ts";
import { openLedger } from "../../../src/desk/ledger/db.ts";
import { buildSampleTeam } from "../../../src/desk/sample/team.ts";
import { addMember } from "../../../src/desk/team/command.ts";
import { openTeam } from "../../../src/desk/team/store.ts";
import { startUiServer } from "../../../src/desk/ui/server.ts";
import { walk, ShimElement } from "./support/dom-shim.ts";
import { renderAllScreens, startRichUi, type RichUi } from "./support/rich-ui.ts";

/** The Team screen: the views a role holds, the ones it does not, and the rule that a request the screen makes is written to the access log. */
let ui: RichUi;
beforeAll(async () => {
  ui = await startRichUi();
}, 600_000);
afterAll(async () => {
  await ui?.close();
});

interface TeamJson {
  state: string;
  sample: boolean;
  reason?: string;
  you: { personId: string; role: string } | null;
  as: string | null;
  team: { perPerson: boolean; minGroup: number; members: number };
  views: { name: string; allowed: boolean; reason: string | null; data: { kind: string; lines?: { person: string; view: string; allowed: boolean }[]; rows?: { display?: string }[] } | null }[];
}
const team = async (server: { origin: string; token?: string }, token: string, q = ""): Promise<{ status: number; body: TeamJson }> => {
  const res = await fetch(`${server.origin}/api/team${q}`, { headers: { "x-desk-token": token } });
  return { status: res.status, body: (await res.json()) as TeamJson };
};
const names = (b: TeamJson, allowed: boolean): string[] => b.views.filter((v) => v.allowed === allowed).map((v) => v.name);

describe("the Team screen in the sample", () => {
  it("shows a lead the aggregates, the roles and their own spend, and says why it closed the rest", async () => {
    const { status, body } = await team(ui.server, ui.token);
    expect(status).toBe(200);
    expect(body.you).toMatchObject({ personId: "ben", role: "lead" });
    expect(names(body, true)).toEqual(["spend", "models", "projects", "landing", "me", "roles"]);
    expect(names(body, false)).toEqual(["people", "access-log", "settings"]);
    expect(body.views.find((v) => v.name === "people")!.reason).toMatch(/per-person views are off/);
    expect(body.views.find((v) => v.name === "access-log")!.reason).toBe("'access-log' needs the role owner; you are a lead");
    expect(body.views.find((v) => v.name === "people")!.data).toBeNull();
  });

  it("shows an owner the access log, and the log holds what the other roles asked for", async () => {
    await team(ui.server, ui.token, "?as=fay");
    const { body } = await team(ui.server, ui.token, "?as=ana");
    expect(body.you).toMatchObject({ personId: "ana", role: "owner" });
    expect(names(body, false)).toEqual(["people"]);
    const log = body.views.find((v) => v.name === "access-log")!.data!;
    expect(log.kind).toBe("access-log");
    expect(log.lines!.some((l) => l.person.includes("fay") && l.view === "spend" && l.allowed)).toBe(true);
    expect(log.lines!.some((l) => l.person.includes("ben") && l.view === "roles" && l.allowed)).toBe(true);
  });

  it("shows a viewer only the team's totals", async () => {
    const { body } = await team(ui.server, ui.token, "?as=fay");
    expect(names(body, true)).toEqual(["spend", "models", "projects", "landing"]);
    expect(JSON.stringify(body.views.filter((v) => v.allowed).map((v) => v.data))).not.toMatch(/"personId"/);
  });

  it("refuses a name that is not in the sample team", async () => {
    const r = await team(ui.server, ui.token, "?as=mallory");
    expect(r.status).toBe(400);
  });

  it("is a screen of the interface that renders for every role, with the closed views listed, and nothing from another origin", async () => {
    const { screens, meta } = await renderAllScreens(ui);
    expect(meta.screens.map((s) => s.id)).toContain("team");
    const screen = screens.find((s) => s.id === "team")!;
    const text = [...walk(screen.root)].map((w) => w.node).filter((n): n is ShimElement => n instanceof ShimElement).map((n) => n.textContent ?? "").join(" ");
    expect(text).toContain("Spend by day");
    expect(text).toContain("Closed to your role");
    expect(text).toContain("alphabetical order, not in order of cost");
    expect(text).not.toContain("listed by name, never ranked");
  });
});

describe("the Team screen on a machine with its own key", () => {
  let dir = "";
  const live = async (env: Record<string, string>, teamDbPath: string): Promise<{ server: Awaited<ReturnType<typeof startUiServer>>; token: string }> => {
    const dbPath = join(dir, "live-ledger.db");
    openLedger(dbPath).close();
    const server = await startUiServer({ pricesPath: "data/prices/anthropic-litellm-2026-10-22.json", policiesDir: "policies", port: 0, token: "t".repeat(32), env, ledgerPath: dbPath, mode: "live", extra: { teamDbPath } as never } as never);
    return { server, token: "t".repeat(32) };
  };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "desk-team-live-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("says what is missing when there is no team, and when there is no key", async () => {
    const mine = join(dir, "mine.pem");
    createSignerFile(mine);
    const none = await live({ DESK_SIGNER_KEY: mine }, join(dir, "no-such-team.db"));
    try {
      const r = await team(none.server, none.token);
      expect(r.body).toMatchObject({ state: "empty", sample: false });
      expect(r.body.reason).toMatch(/no team on this machine/);
    } finally {
      await none.server.close();
    }
    const t = buildSampleTeam(join(dir, "nokey.db"));
    t.db.close();
    const nokey = await live({ DESK_SIGNER_KEY: join(dir, "absent.pem") }, join(dir, "nokey.db"));
    try {
      const r = await team(nokey.server, nokey.token);
      expect(r.body.state).toBe("empty");
      expect(r.body.reason).toMatch(/no signing key/);
    } finally {
      await nokey.server.close();
    }
  });

  it("identifies the machine by its key: a member sees what the role holds, a stranger sees nothing and is logged", async () => {
    const path = join(dir, "team.db");
    const t = buildSampleTeam(path);
    const mine = join(dir, "member.pem");
    createSignerFile(mine);
    expect(addMember(t.db, t.signers["ana"]!, { person: "me", display: "Me", publicKey: loadSigner(mine).publicKey, role: "lead" }).ok).toBe(true);
    t.db.close();

    const asMember = await live({ DESK_SIGNER_KEY: mine }, path);
    try {
      const r = await team(asMember.server, asMember.token, "?as=ana");
      expect(r.body.you).toMatchObject({ personId: "me", role: "lead" });
      expect(r.body.as).toBeNull();
      expect(names(r.body, true)).toContain("spend");
      expect(names(r.body, false)).toContain("access-log");
    } finally {
      await asMember.server.close();
    }

    const stranger = join(dir, "stranger.pem");
    createSignerFile(stranger);
    const asStranger = await live({ DESK_SIGNER_KEY: stranger }, path);
    try {
      const r = await team(asStranger.server, asStranger.token);
      expect(r.body.you).toBeNull();
      expect(r.body.views.every((v) => !v.allowed && v.data === null)).toBe(true);
      expect(r.body.views[0]!.reason).toBe("you are not in this team");
    } finally {
      await asStranger.server.close();
    }

    const check = openTeam(path);
    const last = check.prepare("SELECT person_id, allowed, view, reason FROM team_access_log WHERE person_id IS NULL ORDER BY seq DESC LIMIT 1").get() as { person_id: string | null; allowed: number; view: string; reason: string };
    check.close();
    expect(last).toMatchObject({ allowed: 0, view: "spend", reason: "you are not in this team" });
  }, 120_000);
});
