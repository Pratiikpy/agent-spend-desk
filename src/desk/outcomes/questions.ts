import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type { Ledger } from "../ledger/db.ts";
import { formatUsd } from "../money.ts";
import type { Link } from "./attribute.ts";
import { governQuestions, recordDecisions } from "../questions/governor.ts";

/**
 * The owner-question queue (DF-006). Where the Desk is not sure which session a commit came from, it asks: "Is commit a1b2c3d
 * from this session? yes, no or skip." The answer is recorded as an explicit attribution (yes) or removes the link (no), and is
 * applied every time landing is recomputed. Skipping records nothing, so a skipped question stays open. An answer decides who a
 * commit belongs to and nothing else: what the commit became (committed, merged, kept, reverted) still comes from git, so no
 * answer can make work look more landed than its commit is.
 */
export interface OwnerAnswer {
  sessionId: string;
  repoRoot: string;
  sha: string;
  answer: "yes" | "no";
}

export interface Question {
  id: string;
  sessionId: string;
  repoRoot: string;
  sha: string;
  commitAt: string;
  method: string;
  project: string | null;
  sessionStart: string;
  sessionEnd: string;
  spendMicros: number;
}

export const questionId = (sessionId: string, repoRoot: string, sha: string): string => `q-${createHash("sha256").update(`${sessionId}|${repoRoot}|${sha}`).digest("hex").slice(0, 8)}`;

/** Apply the owner's answers to the links computed for one repository. A "no" removes a link; a "yes" makes it explicit and high, even where the guess had missed it. */
export function applyAnswers(links: readonly Link[], answers: readonly OwnerAnswer[], knownCommits: ReadonlySet<string>, knownSessions: ReadonlySet<string>): Link[] {
  const byKey = new Map(answers.map((a) => [`${a.sessionId}|${a.sha}`, a.answer]));
  const out: Link[] = [];
  const have = new Set<string>();
  for (const l of links) {
    const a = byKey.get(`${l.sessionId}|${l.sha}`);
    if (a === "no") continue;
    out.push(a === "yes" ? { ...l, method: "explicit", confidence: "high" } : l);
    have.add(`${l.sessionId}|${l.sha}`);
  }
  for (const a of answers) {
    if (a.answer !== "yes" || have.has(`${a.sessionId}|${a.sha}`)) continue;
    if (knownCommits.has(a.sha) && knownSessions.has(a.sessionId)) out.push({ sessionId: a.sessionId, sha: a.sha, method: "explicit", confidence: "high" });
  }
  return out;
}

export function answersForRepo(db: Ledger, repoRoot: string): OwnerAnswer[] {
  return db.prepare("SELECT session_id AS sessionId, repo_root AS repoRoot, sha, answer FROM owner_answer WHERE repo_root = ?").all(repoRoot) as unknown as OwnerAnswer[];
}

/** The unanswered questions, the session that cost the most first: an answer about a $40 session is worth more than one about a $0.30 one. */
export function openQuestions(db: Ledger, limit = 200): Question[] {
  const rows = db
    .prepare(
      `SELECT sc.session_id sessionId, r.root repoRoot, sc.sha sha, gc.authored_at commitAt, sc.method method, s.project_path project,
              (SELECT MIN(ts) FROM model_call WHERE session_id = sc.session_id) sessionStart, (SELECT MAX(ts) FROM model_call WHERE session_id = sc.session_id) sessionEnd,
              COALESCE((SELECT SUM(c.total_micros) FROM model_call m JOIN cost_event c ON c.call_id = m.call_id AND c.class = 'estimated' WHERE m.session_id = sc.session_id), 0) spend
       FROM session_commit sc JOIN repo r ON r.repo_id = sc.repo_id JOIN git_commit gc ON gc.repo_id = sc.repo_id AND gc.sha = sc.sha JOIN session s ON s.session_id = sc.session_id
       WHERE sc.confidence = 'low' AND NOT EXISTS (SELECT 1 FROM owner_answer a WHERE a.session_id = sc.session_id AND a.repo_root = r.root AND a.sha = sc.sha)
       ORDER BY spend DESC, sc.session_id, sc.sha LIMIT ?`,
    )
    .all(limit) as unknown as (Omit<Question, "id" | "spendMicros"> & { spend: number })[];
  return rows.map((r) => ({ id: questionId(r.sessionId, r.repoRoot, r.sha), sessionId: r.sessionId, repoRoot: r.repoRoot, sha: r.sha, commitAt: r.commitAt, method: r.method, project: r.project, sessionStart: r.sessionStart, sessionEnd: r.sessionEnd, spendMicros: r.spend }));
}

export type AnswerResult = { kind: "recorded"; question: Question; answer: "yes" | "no" } | { kind: "unknown" };

/** Record an answer by question id (or a unique prefix of it). Answering again changes the earlier answer. */
export function answerQuestion(db: Ledger, id: string, answer: "yes" | "no", now: Date = new Date()): AnswerResult {
  const wanted = id.toLowerCase().startsWith("q-") ? id.toLowerCase() : `q-${id.toLowerCase()}`;
  // An answered question is no longer open, so a changed mind looks the id up among the answers as well.
  const open = openQuestions(db, 100_000).filter((q) => q.id.startsWith(wanted));
  const answered = (db.prepare("SELECT session_id s, repo_root r, sha FROM owner_answer").all() as unknown as { s: string; r: string; sha: string }[]).filter((a) => questionId(a.s, a.r, a.sha).startsWith(wanted));
  const matches = [...new Set([...open.map((q) => q.id), ...answered.map((a) => questionId(a.s, a.r, a.sha))])];
  if (matches.length !== 1) return { kind: "unknown" };
  const q = open.find((x) => x.id === matches[0]) ?? (() => {
    const a = answered.find((x) => questionId(x.s, x.r, x.sha) === matches[0])!;
    return { id: matches[0]!, sessionId: a.s, repoRoot: a.r, sha: a.sha, commitAt: "", method: "", project: null, sessionStart: "", sessionEnd: "", spendMicros: 0 } satisfies Question;
  })();
  db.prepare("INSERT INTO owner_answer (session_id, repo_root, sha, answer, answered_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (session_id, repo_root, sha) DO UPDATE SET answer = excluded.answer, answered_at = excluded.answered_at").run(q.sessionId, q.repoRoot, q.sha, answer, now.toISOString());
  return { kind: "recorded", question: q, answer };
}

/** What waits, and why, in a line: how many, the dollars the most valuable of them could move, and what the cost of interrupting was read from. */
function queueLine(g: { queued: { decision: { evoiMicros: number | null; costMicros: number | null } }[] }, note: string): string {
  if (g.queued.length === 0) return "";
  const top = Math.max(0, ...g.queued.map((q) => q.decision.evoiMicros ?? 0));
  const cost = g.queued[0]!.decision.costMicros;
  return `${g.queued.length} wait${g.queued.length === 1 ? "s" : ""} for the weekly review, the most valuable worth ${formatUsd(top)}${cost === null ? "" : ` against ${formatUsd(cost)} to interrupt you`} (${note}). \`desk questions ask --all\` goes through them now.`;
}

const METHOD_WORDS: Record<string, string> = { time_window: "it was made close to when the session ran, and nothing else matches", file_overlap: "the session wrote files the commit changed, but too few of them or at the wrong time", trailer_window: "the commit carries an agent trailer", explicit: "you said so" };
const short = (iso: string): string => iso.slice(0, 16).replace("T", " ");

export function renderQuestion(q: Question, n: number, of: number): string {
  return [
    `Question ${n} of ${of}   [${q.id}]`,
    `  Is commit ${q.sha.slice(0, 7)} (${short(q.commitAt)} UTC) from the session that ran ${short(q.sessionStart)} to ${short(q.sessionEnd)}${q.project ? ` in ${q.project.split(/[\\/]/).filter(Boolean).pop()}` : ""}, which cost ${formatUsd(q.spendMicros)}?`,
    `  Why it is asked: ${METHOD_WORDS[q.method] ?? q.method}, so the Desk is not sure.`,
  ].join("\n");
}

/** Ask the open questions one at a time on a terminal: y, n, s to skip (it stays open), q to stop. Returns how many were answered. */
export async function askLoop(db: Ledger, input: Readable, output: Writable, now: () => Date = () => new Date(), governed?: { load: number | null; note: string }): Promise<{ asked: number; answered: number; queued: number }> {
  const all = openQuestions(db, 50);
  // With the governor, only a question whose answer is worth more than interrupting for is asked now; the rest wait, unlinked, for the weekly review (DF-107).
  const gov = governed ? governQuestions(db, all, governed.load, now().getTime()) : null;
  const qs = gov ? gov.ask.map((g) => g.question) : all;
  const queued = gov ? gov.queued.length : 0;
  if (gov) recordDecisions(db, gov, now());
  if (qs.length === 0) {
    output.write(all.length === 0 ? "No open question. Nothing the Desk linked is in doubt.\n" : `${all.length} open question${all.length === 1 ? "" : "s"}, and none is worth interrupting you for: ${queueLine(gov!, governed!.note)}\n`);
    return { asked: 0, answered: 0, queued };
  }
  const rl = createInterface({ input, crlfDelay: Infinity });
  const lines = rl[Symbol.asyncIterator]();
  let asked = 0;
  let answered = 0;
  for (const [i, q] of qs.entries()) {
    output.write(`${renderQuestion(q, i + 1, qs.length)}\n  yes / no / skip / quit > `);
    const next = await lines.next();
    if (next.done) break;
    asked += 1;
    const a = String(next.value).trim().toLowerCase();
    if (a === "q" || a === "quit") break;
    if (a === "y" || a === "yes" || a === "n" || a === "no") {
      answerQuestion(db, q.id, a.startsWith("y") ? "yes" : "no", now());
      answered += 1;
    } else output.write("  skipped; it stays open.\n");
  }
  rl.close();
  output.write(`${answered} answered, ${asked - answered} left open.${gov && queued > 0 ? ` ${queueLine(gov, governed!.note)}` : ""} Landing is recomputed the next time it runs (desk landing).\n`);
  return { asked, answered, queued };
}
