import type { Role } from "./store.ts";

/**
 * Who may see what (DF-059). The table is the whole of it: a view is allowed to a role or it is not, and a denial names the role that is needed. Views of the team as a whole are
 * aggregates and are open to everyone in it; a view of one person is closed unless the owner has turned per-person views on, and then open only to those the table names. No view
 * ranks people: the one that lists them lists them by name.
 */
export type View = "spend" | "models" | "projects" | "landing" | "me" | "people" | "roles" | "access-log" | "settings";

export interface ViewRule {
  /** The roles that may see it, lowest first. */
  roles: readonly Role[];
  what: string;
  /** True when it shows something about one person and is off until the owner turns per-person views on. */
  perPerson?: true;
}

export const VIEWS: Record<View, ViewRule> = {
  spend: { roles: ["viewer", "member", "lead", "owner"], what: "the team's spend by day, in total" },
  models: { roles: ["viewer", "member", "lead", "owner"], what: "the team's spend by model; a model used by fewer people than the team's minimum group is folded into one line" },
  projects: { roles: ["viewer", "member", "lead", "owner"], what: "the team's spend by project; a project worked on by fewer people than the minimum group is folded into one line" },
  landing: { roles: ["viewer", "member", "lead", "owner"], what: "what the team's spend bought: the share of it that landed, in total" },
  me: { roles: ["member", "lead", "owner"], what: "your own spend by day, from your own reports" },
  people: { roles: ["lead", "owner"], what: "spend by person, listed by name and never ranked", perPerson: true },
  roles: { roles: ["lead", "owner"], what: "who is in the team and the role each holds" },
  "access-log": { roles: ["owner"], what: "every request to see something, who made it, and whether it was allowed" },
  settings: { roles: ["owner"], what: "the team's settings: per-person views and the minimum group" },
};

export const VIEW_NAMES = Object.keys(VIEWS) as View[];

export type Decision = { allowed: true } | { allowed: false; reason: string; needs: readonly Role[] | null };

const RANK: Record<Role, number> = { viewer: 0, member: 1, lead: 2, owner: 3 };
export const roleAtLeast = (role: Role, floor: Role): boolean => RANK[role] >= RANK[floor];

/** Whether this role may see this view in a team with these settings. A denial says what was needed, not only that it was not allowed. */
export function authorize(role: Role | "none" | null, view: View, settings: { perPerson: boolean }): Decision {
  const rule = VIEWS[view];
  if (role === null || role === "none") return { allowed: false, reason: role === "none" ? "your access to this team was withdrawn" : "you are not in this team", needs: null };
  if (!rule.roles.includes(role)) {
    const need = rule.roles[0] as Role;
    return { allowed: false, reason: `'${view}' needs the role ${rule.roles.length === 1 ? need : `${need} or higher`}; you are ${article(role)} ${role}`, needs: rule.roles };
  }
  if (rule.perPerson === true && !settings.perPerson) {
    return { allowed: false, reason: `'${view}' shows one person at a time and per-person views are off for this team; the owner can turn them on`, needs: null };
  }
  return { allowed: true };
}

const article = (word: string): string => (/^[aeiou]/i.test(word) ? "an" : "a");

/** What the owner may do to the team itself; nobody else may do any of it. */
export const ADMIN_ACTIONS = ["init", "add-member", "grant", "revoke", "settings", "merge"] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export function authorizeAdmin(role: Role | "none" | null, action: AdminAction): Decision {
  if (role === "owner") return { allowed: true };
  return { allowed: false, reason: `'${action}' needs the role owner; ${role === null ? "you are not in this team" : `you are ${article(role)} ${role}`}`, needs: ["owner"] };
}
