import { existsSync } from "node:fs";

import { defaultKeyPath, KeyError, loadSigner, type Signer } from "../dossier/keys.ts";
import { PEOPLE, buildSampleTeam, type SampleTeam } from "../sample/team.ts";
import { viewAs } from "../team/command.ts";
import { authorize, VIEW_NAMES, VIEWS, type View } from "../team/rbac.ts";
import { openTeam, team, type TeamDb } from "../team/store.ts";
import type { AnyView } from "../team/views.ts";
import { BadParam, type UiContext } from "./queries.ts";

/** Where the team's database is read from, and how long a sample team keeps its access log. The Desk has one signing key per machine; the screen is that key's view of the team. */
export interface TeamPaths {
  teamDbPath: string;
}

let sampleTeam: SampleTeam | null = null;
const sampleOnce = (): SampleTeam => (sampleTeam ??= buildSampleTeam());

export interface TeamScreen {
  state: "ok" | "empty";
  sample: boolean;
  reason?: string;
  hint?: string;
  team?: { name: string; perPerson: boolean; minGroup: number; members: number };
  you?: { personId: string; display: string; role: string; keyId: string } | null;
  /** Sample only: the people the screen can be looked at as, so that each role's view can be seen. Live, the screen is the machine's own key and nothing else. */
  lookAs?: { id: string; display: string; role: string }[];
  as?: string | null;
  views?: { name: View; what: string; roles: string[]; allowed: boolean; reason: string | null; data: AnyView | null }[];
}

const accessLimit = 20;

function emptyScreen(sample: boolean, reason: string, hint: string): TeamScreen {
  return { state: "empty", sample, reason, hint };
}

/**
 * The team, seen by the holder of this machine's signing key. Each view that the key's role holds is computed and one line is written to the team's access log for it, as for a
 * command on the command line; a view the role does not hold is listed with the role it needs and is not requested, so it is not logged as a refusal the person never made. Someone
 * whose key is not in the team gets one logged refusal and sees nothing of the team's numbers.
 */
export function teamScreen(ctx: UiContext, paths: TeamPaths, p: URLSearchParams): TeamScreen {
  const sample = ctx.mode === "sample";
  let db: TeamDb;
  let signer: Signer;
  let as: string | null = null;
  if (sample) {
    const t = sampleOnce();
    db = t.db;
    as = p.get("as") ?? "ben";
    if (!PEOPLE.some((x) => x.id === as)) throw new BadParam(`as: ${JSON.stringify(as)} is not one of the sample team (${PEOPLE.map((x) => x.id).join(", ")})`);
    signer = t.signers[as] as Signer;
  } else {
    if (!existsSync(paths.teamDbPath)) return emptyScreen(false, "There is no team on this machine.", "desk team init <name> --person <you> makes one, and you become its owner. Everyone else sends a signed report with desk team export.");
    try {
      signer = loadSigner(defaultKeyPath(ctx.env));
    } catch (e) {
      if (e instanceof KeyError) return emptyScreen(false, "This machine has no signing key, so it cannot be identified as a member of a team.", "desk team key makes one and prints the public key to give to the owner.");
      throw e;
    }
    db = openTeam(paths.teamDbPath);
  }
  try {
    const t = team(db);
    if (!t) return emptyScreen(sample, "The team database exists but no team has been made in it.", "desk team init <name> --person <you>");
    const members = db.prepare("SELECT COUNT(*) AS n FROM team_member").get() as { n: number };
    const first = viewAs(db, signer, "spend");
    const who = first.who;
    const views: NonNullable<TeamScreen["views"]> = [];
    for (const name of VIEW_NAMES) {
      const def = VIEWS[name];
      const d = authorize(who === null ? null : who.role, name, { perPerson: t.per_person === 1 });
      if (!d.allowed) {
        views.push({ name, what: def.what, roles: [...def.roles], allowed: false, reason: d.reason, data: null });
        continue;
      }
      const r = name === "spend" ? first : viewAs(db, signer, name, name === "access-log" ? { limit: accessLimit } : {});
      views.push({ name, what: def.what, roles: [...def.roles], allowed: r.allowed, reason: r.allowed ? null : r.text, data: r.view ?? null });
    }
    return {
      state: "ok",
      sample,
      team: { name: t.name, perPerson: t.per_person === 1, minGroup: t.min_group, members: members.n },
      you: who === null ? null : { personId: who.personId, display: who.display, role: who.role, keyId: who.keyId },
      ...(sample ? { lookAs: PEOPLE.map((x) => ({ id: x.id, display: x.display, role: x.role })) } : {}),
      as,
      views,
    };
  } finally {
    if (!sample) db.close();
  }
}
