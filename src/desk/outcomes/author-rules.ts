import { pseudonym } from "../security/secrets.ts";

/**
 * What the owner has said about who made a commit (DF-116): "Commits by release-bot@acme.test are human" or "Commits by ci@acme.test are agent work". A Co-Authored-By trailer naming an
 * agent vendor is the Desk's only sign that a commit was made by an agent, and anyone can write one; the owner knows which authors do and which do not. The statement overrides the
 * trailer for that author, and it can be replaced like any memory. Two live statements that disagree about one author are not guessed between: neither is applied, and they are listed.
 */
export type AuthorKind = "human" | "agent";

export interface AuthorRule {
  /** The author as the owner wrote it. */
  author: string;
  kind: AuthorKind;
  memoryId: string;
}

const RULE = /\bcommits?\s+(?:by|from)\s+([^\s,;]+@[^\s,;]+?)[,;.]?\s+(?:are|is|were)\s+(?:made\s+by\s+)?(?:a\s+)?(human|agent|bot)(?:\s+work)?\b/i;

/** The rule a sentence states, or null when it states none. */
export function parseAuthorRule(content: string): { author: string; kind: AuthorKind } | null {
  const m = RULE.exec(content);
  if (m === null) return null;
  return { author: (m[1] as string).toLowerCase(), kind: (m[2] as string).toLowerCase() === "human" ? "human" : "agent" };
}

export interface AuthorRules {
  /** By the pseudonym the ledger stores for an author, so a rule applies to commits without the ledger holding the address. */
  byPseudonym: Map<string, AuthorRule>;
  /** Authors two live statements disagree about; neither is applied. */
  conflicts: string[];
}

export function authorRulesFrom(notes: readonly { id: string; content: string }[]): AuthorRules {
  const seen = new Map<string, AuthorRule[]>();
  for (const n of notes) {
    const r = parseAuthorRule(n.content);
    if (r === null) continue;
    const list = seen.get(r.author) ?? [];
    list.push({ ...r, memoryId: n.id });
    seen.set(r.author, list);
  }
  const byPseudonym = new Map<string, AuthorRule>();
  const conflicts: string[] = [];
  for (const [author, list] of seen) {
    if (new Set(list.map((x) => x.kind)).size > 1) conflicts.push(author);
    else byPseudonym.set(pseudonym(author), list[list.length - 1] as AuthorRule);
  }
  return { byPseudonym, conflicts };
}
